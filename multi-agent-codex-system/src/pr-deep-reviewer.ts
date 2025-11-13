import { Agent, Runner, handoff } from "@openai/agents";
import type { JsonSchemaDefinition } from "@openai/agents-core";
import { Codex, CodexProvider } from "@codex-native/sdk";
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

    const reviewResult = await this.codex.review({
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
}

export { PRDeepReviewer };
