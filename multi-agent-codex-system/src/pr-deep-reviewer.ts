import { Agent, Runner, handoff } from "@openai/agents";
import type { JsonSchemaDefinition } from "@openai/agents-core";
import { Codex, CodexProvider, type ThreadEvent, type ThreadItem } from "@codex-native/sdk";
import { DEFAULT_MODEL } from "./constants.js";
import {
  IntentionResponseSchema,
  RecommendationResponseSchema,
  IntentionOutputType,
  RecommendationOutputType,
  coerceStructuredOutput,
  type Intention,
  type Recommendation,
} from "./schemas.js";
import type { MultiAgentConfig, PrStatusSummary, RepoContext, ReviewAnalysis } from "./types.js";
import type { LspDiagnosticsBridge } from "@codex-native/sdk";
import { formatPrStatus, formatRepoContext } from "./repo.js";
import { attachApplyPatchReminder } from "./reminders/applyPatchReminder.js";

type ReviewOutputFinding = {
  title: string;
  body: string;
  confidence_score: number;
  priority: number;
  code_location: {
    absolute_file_path: string;
    line_range: { start: number; end: number };
  };
};

type ReviewOutputEvent = {
  findings: ReviewOutputFinding[] | null;
  overall_correctness: string;
  overall_explanation: string;
  overall_confidence_score: number;
};

class PRDeepReviewer {
  private codex: Codex;
  private provider: CodexProvider;
  private runner: Runner;

  constructor(private readonly config: MultiAgentConfig, private readonly diagnostics?: LspDiagnosticsBridge) {
    this.codex = new Codex({ baseUrl: config.baseUrl, apiKey: config.apiKey });
    this.provider = new CodexProvider({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      defaultModel: config.model ?? DEFAULT_MODEL,
      workingDirectory: config.workingDirectory,
      skipGitRepoCheck: config.skipGitRepoCheck,
    });
    this.runner = new Runner({ modelProvider: this.provider });
  }

  async reviewBranch(repoContext: RepoContext, prStatus?: PrStatusSummary | null): Promise<ReviewAnalysis> {
    console.log("🔍 Running codex.review() for branch analysis...");
    const target = repoContext.baseBranch
      ? ({ type: "branch", baseBranch: repoContext.baseBranch } as const)
      : ({ type: "current_changes" } as const);

    const reviewResult = await this.runReviewWithLogging({
      target,
      threadOptions: {
        model: this.config.model ?? DEFAULT_MODEL,
        workingDirectory: repoContext.cwd,
        skipGitRepoCheck: this.config.skipGitRepoCheck,
        fullAuto: true,
      },
    });

    const contextBlock = formatRepoContext(repoContext);
    const prBlock = formatPrStatus(prStatus);

    const model = await this.provider.getModel();

    const intentionAnalyzer = new Agent<unknown, JsonSchemaDefinition>({
      name: "IntentionAnalyzer",
      model,
      outputType: IntentionOutputType,
      instructions: `# Intention Analysis Agent

You are analyzing developer intent and architectural decisions behind code changes.

## Your Task
Extract the key intentions, goals, and architectural decisions from the provided diff and review context.

## Guidelines
1. Focus on the "why" not the "what" - understand motivations, not just mechanics
2. Identify explicit patterns: refactoring, feature additions, bug fixes, performance improvements
3. Note any architectural shifts: new abstractions, design pattern changes, dependency updates
4. Consider cross-cutting concerns: testability, maintainability, scalability implications
5. Flag any apparent mismatches between stated goals (from commits/PR) and actual changes
6. Distinguish between intentional changes vs. incidental side effects

## Output Format
Provide 5-8 bullet points in this format:
- **[Category]** Brief description of intent or architectural decision
  - Supporting evidence from diff (file/line references)
  - Impact: [scope of change - local/module/system-wide]

Categories: Feature, Refactor, BugFix, Performance, Security, DevEx, Architecture, Testing

## Constraints
- Be specific - cite actual files, functions, or modules
- Avoid speculation - stick to observable changes
- Distinguish between primary goals and secondary effects
- Each bullet should be actionable for follow-up analysis

## JSON Output
Return a JSON array matching the Intention schema (category, title, summary, impactScope, evidence)`,
    });
    const qualityReviewer = new Agent<unknown, JsonSchemaDefinition>({
      name: "QualityReviewer",
      model,
      outputType: RecommendationOutputType,
      instructions: `# Code Quality & DevEx Reviewer

You are evaluating code quality, test coverage, and developer experience improvements.

## Your Task
Identify actionable improvements to code quality, testing, and team productivity.

## Evaluation Criteria

### Code Quality
1. Readability: naming, structure, complexity
2. Maintainability: modularity, coupling, documentation
3. Consistency: style alignment with codebase norms
4. Error handling: edge cases, validation, failure modes

### Test Coverage
1. Missing test cases: edge cases, error paths, integration scenarios
2. Test quality: brittleness, clarity, isolation
3. Test gaps: untested modules, uncovered branches

### DevEx (Developer Experience)
1. Documentation: inline comments, README updates, API docs
2. Tooling: build improvements, debugging aids, dev scripts
3. Onboarding: clarity for new contributors
4. Feedback loops: error messages, logging, observability

## Output Format
Provide 6-10 recommendations in this format:
- **[Category] Recommendation Title**
  - **Priority**: P0 (critical) / P1 (high) / P2 (medium) / P3 (low)
  - **Effort**: [Low/Medium/High] - estimated implementation complexity
  - Description: What to improve and why it matters
  - Location: Specific files, functions, or modules
  - Example: Concrete code snippet or test case to add (if applicable)

## Constraints
- Prioritize improvements with high impact / effort ratio
- Suggest follow-up tasks, not just observations
- Balance thoroughness with pragmatism - match the repo's quality bar
- Focus on improvements that will benefit future changes, not just this PR

## JSON Output
Return a JSON array of recommendations following the Recommendation schema (category, title, priority, effort, description, location, optional example)`,
    });

    intentionAnalyzer.handoffs = [handoff(qualityReviewer)];
    qualityReviewer.handoffs = [];

    const intentionResult = await (this.runner.run as typeof this.runner.run)(
      intentionAnalyzer,
      `Repo context:\n${contextBlock}\n\nPR status:\n${prBlock}\n\nReview summary:\n${reviewResult.finalResponse}\n\nExtract the key intentions and architectural goals in <=8 bullets.`,
    );
    const intentions = coerceStructuredOutput(
      intentionResult.finalOutput,
      IntentionResponseSchema as any,
      { items: [] },
    ).items as Intention[];
    const qualityResult = await (this.runner.run as typeof this.runner.run)(
      qualityReviewer,
      `Context:\n${contextBlock}\n\nReview:\n${reviewResult.finalResponse}\n\nIntentions:\n${JSON.stringify(intentions, null, 2)}\n\nProvide actionable recommendations (tests to add, refactors, follow-up tasks).`,
    );
    const recommendations = coerceStructuredOutput(
      qualityResult.finalOutput,
      RecommendationResponseSchema as any,
      { items: [] },
    ).items as Recommendation[];

    const reviewThread = this.codex.startThread({
      model: this.config.model ?? DEFAULT_MODEL,
      workingDirectory: repoContext.cwd,
      skipGitRepoCheck: this.config.skipGitRepoCheck,
      approvalMode: "on-request",
      sandboxMode: "workspace-write",
    });
    this.diagnostics?.attach(reviewThread);
    attachApplyPatchReminder(reviewThread, "workspace-write");

    await reviewThread.run(`You already completed an automated branch review.\n\nBranch: ${repoContext.branch}\nBase: ${repoContext.baseBranch}\n\nRepo signals:\n${contextBlock}\n\nPR status summary:\n${prBlock}\n\nAutomated review findings:\n${reviewResult.finalResponse}\n\nSummarize the most critical insights and propose next investigative steps.`);

    await reviewThread.run(`Log any CI or QA follow-ups you believe are necessary. You may soon fork to a CI triage agent; acknowledge by replying with a short checklist and the token 'CI-HANDOFF-READY'.`);

    const intentionLines = intentions
      .map((item) => `• [${item.category}] ${item.title ?? item.summary} (${item.impactScope})`)
      .join("\n");
    const recommendationLines = recommendations
      .map((rec) => `• [${rec.priority}] ${rec.title ?? rec.description} — ${rec.category}`)
      .join("\n");
    await reviewThread.run(
      `PR Review Ready\n\nSummary:\n${reviewResult.finalResponse ?? "(no summary)"}\n\nIntentions:\n${intentionLines}\n\nRecommendations:\n${recommendationLines}`,
    );

    let ciHandoff;
    try {
      ciHandoff = await reviewThread.fork({
        nthUserMessage: 1,
        threadOptions: {
          model: this.config.model ?? DEFAULT_MODEL,
          workingDirectory: repoContext.cwd,
          skipGitRepoCheck: this.config.skipGitRepoCheck,
          approvalMode: "on-request",
          sandboxMode: "workspace-write",
        },
      });
      if (ciHandoff) {
        this.diagnostics?.attach(ciHandoff);
        attachApplyPatchReminder(ciHandoff, "workspace-write");
      }
    } catch (error) {
      console.warn("⚠️ Unable to fork thread for CI handoff:", error);
    }

    return {
      summary: reviewResult.finalResponse ?? "",
      intentions,
      recommendations,
      repoContext,
      prStatus,
      thread: reviewThread,
      ciHandoff,
    };
  }

  private async runReviewWithLogging(options: Parameters<Codex["review"]>[0]): Promise<Awaited<ReturnType<Codex["review"]>> & { items: ThreadItem[] }> {
    const stream = await this.codex.reviewStreamed(options);
    const items: ThreadItem[] = [];
    let finalResponse = "";
    let usage: Awaited<ReturnType<Codex["review"]>>["usage"] = null;
    let turnFailure: string | null = null;

    for await (const event of stream.events) {
      if (!event) {
        continue;
      }
      this.logReviewEvent(event);

      if (event.type === "item.completed") {
        items.push(event.item);
        if (event.item.type === "agent_message") {
          finalResponse = event.item.text;
        }
      } else if (event.type === "exited_review_mode" && event.review_output) {
        finalResponse = this.formatReviewOutput(event.review_output) ?? finalResponse;
      } else if (event.type === "turn.completed") {
        usage = event.usage;
      } else if (event.type === "turn.failed") {
        turnFailure = event.error.message;
        break;
      }
    }

    if (turnFailure) {
      throw new Error(turnFailure);
    }

    return { items, finalResponse, usage };
  }

  private formatReviewOutput(output: ReviewOutputEvent): string | null {
    let reviewText = output.overall_explanation ?? "";

    if (output.findings && output.findings.length > 0) {
      if (reviewText) {
        reviewText += "\n\n";
      }
      reviewText += "## Review Findings\n\n";
      output.findings.forEach((finding, index) => {
        reviewText += `### ${index + 1}. ${finding.title}\n`;
        reviewText += `${finding.body}\n`;
        reviewText += `**Priority:** ${finding.priority} | **Confidence:** ${finding.confidence_score}\n`;
        reviewText += `**Location:** ${finding.code_location.absolute_file_path}:${finding.code_location.line_range.start}-${finding.code_location.line_range.end}\n\n`;
      });
    }

    return reviewText || null;
  }

  private logReviewEvent(event: ThreadEvent): void {
    switch (event.type) {
      case "thread.started":
        console.log(`🧵 Review thread started (${event.thread_id})`);
        break;
      case "turn.started":
        console.log("🔄 Review turn started");
        break;
      case "turn.completed":
        console.log(
          `✅ Review turn completed (usage: ${event.usage.input_tokens + event.usage.output_tokens} tokens)`,
        );
        break;
      case "turn.failed":
        console.warn("⚠️ Review turn failed:", event.error.message);
        break;
      case "background_event":
        console.log(`📡 ${event.message}`);
        break;
      case "item.started":
        this.logItemEvent("started", event.item);
        break;
      case "item.completed":
        this.logItemEvent("completed", event.item);
        break;
      case "item.updated":
        this.logItemEvent("updated", event.item);
        break;
      default:
        break;
    }
  }

  private logItemEvent(phase: "started" | "completed" | "updated", item: ThreadItem): void {
    switch (item.type) {
      case "command_execution":
        console.log(`🛠️  Command ${phase}: ${item.command}`);
        if (item.status === "completed" && item.exit_code !== undefined) {
          console.log(`   ↳ exit code ${item.exit_code}`);
        }
        break;
      case "file_change":
        console.log(`📄 Patch ${phase}: ${item.changes.length} file(s) (${item.status})`);
        break;
      case "mcp_tool_call":
        console.log(`🔌 MCP ${phase}: ${item.server}.${item.tool}`);
        break;
      case "web_search":
        console.log(`🌐 Web search ${phase}: ${item.query}`);
        break;
      case "agent_message":
        if (phase === "completed") {
          const preview = item.text.length > 200 ? `${item.text.slice(0, 200)}…` : item.text;
          console.log(`🤖 Agent message: ${preview}`);
        }
        break;
      case "todo_list":
        console.log(`📝 Plan ${phase}: ${item.items.length} step(s)`);
        break;
      case "error":
        console.warn(`⚠️ Error ${phase}: ${item.message}`);
        break;
      default:
        break;
    }
  }
}

export { PRDeepReviewer };
