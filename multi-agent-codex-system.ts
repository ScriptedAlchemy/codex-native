/**
 * Multi-Agent Codex System - Advanced PR Reviewer & CI Checker
 *
 * This script orchestrates several specialized agents to review the current branch,
 * inspect CI health, and hand off into interactive Codex TUI sessions. It combines:
 *   1. Automated `codex.review()` runs for branch diffs
 *   2. Multi-agent analysis (intent, risk, quality, CI focus)
 *   3. GitHub PR status inspection via `gh pr view/checks`
 *   4. Thread forking so CI analysis can branch off while preserving review context
 *   5. Optional reverie lookup for prior lessons (with embedding-based re-ranking)
 *
 * Embedding Support:
 * To enable semantic re-ranking of reveries via FastEmbed, configure:
 *   config.embedder = {
 *     initOptions: { model: "BAAI/bge-large-en-v1.5" },
 *     embedRequest: { normalize: true }
 *   };
 *
 * The system will:
 * - First recall candidates with native keyword search (fast, broad)
 * - Re-rank top candidates using semantic similarity (slow, precise)
 * - Blend scores: 70% semantic + 30% keyword
 */

import * as process from "node:process";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { Agent, Runner, handoff } from "@openai/agents";
import { z } from "zod";
import {
  Codex,
  CodexProvider,
  type Thread,
  type NativeTuiExitInfo,
  fastEmbedInit,
  fastEmbedEmbed,
  type FastEmbedInitOptions,
  type FastEmbedEmbedRequest,
} from "@codex-native/sdk";
import type { JsonSchemaDefinition } from "@openai/agents-core";
import zodToJsonSchema from "zod-to-json-schema";

const DEFAULT_MODEL = "gpt-5-codex";
const DEFAULT_MINI_MODEL = "gpt-5-codex-mini";
const FALLBACK_BASE_BRANCH = "main";
const MAX_CONTEXT_LINES = 140;
const MAX_CONTEXT_CHARS = 4800;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MultiAgentConfig = {
  baseUrl?: string;
  apiKey?: string;
  workingDirectory: string;
  skipGitRepoCheck: boolean;
  interactive?: boolean;
  reviewBranch?: boolean;
  ciCheck?: boolean;
  reverieQuery?: string;
  model?: string;
  baseBranchOverride?: string;
  embedder?: FastEmbedConfig;
  suppressedChecks?: Array<"lint" | "tests" | "build" | "security">;
};

type FastEmbedConfig = {
  initOptions: FastEmbedInitOptions;
  embedRequest: Omit<FastEmbedEmbedRequest, "inputs" | "projectRoot">;
};

const IntentionSchema = z.object({
  category: z
    .enum(["Feature", "Refactor", "BugFix", "Performance", "Security", "DevEx", "Architecture", "Testing"])
    .describe("High-level intention category"),
  title: z.string().min(5).max(160),
  summary: z.string().min(10).max(800),
  impactScope: z.enum(["local", "module", "system"]).default("module"),
  evidence: z.array(z.string()).default([]),
});
type Intention = z.infer<typeof IntentionSchema>;
const IntentionListSchema = z.array(IntentionSchema).min(1).max(12);

const RecommendationSchema = z.object({
  category: z.enum(["Code", "Tests", "Docs", "Tooling", "DevEx", "Observability"]),
  title: z.string().min(5).max(160),
  priority: z.enum(["P0", "P1", "P2", "P3"]),
  effort: z.enum(["Low", "Medium", "High"]).default("Medium"),
  description: z.string().min(10).max(400),
  location: z.string().max(200).optional().default(""),
  example: z.string().max(400).optional().default(""),
});
type Recommendation = z.infer<typeof RecommendationSchema>;
const RecommendationListSchema = z.array(RecommendationSchema).min(1).max(10);

const CiIssueSchema = z.object({
  source: z.enum(["lint", "tests", "build", "security"]).or(z.string()),
  severity: z.enum(["P0", "P1", "P2", "P3"]),
  title: z.string().min(5).max(160),
  summary: z.string().min(10).max(400),
  suggestedCommands: z.array(z.string()).default([]),
  files: z.array(z.string()).default([]),
  owner: z.string().optional(),
  autoFixable: z.boolean().default(false),
});
type CiIssue = z.infer<typeof CiIssueSchema>;
const CiIssueListSchema = z.array(CiIssueSchema).min(1).max(12);

const CiFixSchema = z.object({
  title: z.string().min(5).max(160),
  priority: z.enum(["P0", "P1", "P2", "P3"]),
  steps: z.array(z.string()).default([]),
  owner: z.string().optional(),
  etaHours: z.number().min(0).max(40).optional(),
  commands: z.array(z.string()).default([]),
});
type CiFix = z.infer<typeof CiFixSchema>;
const CiFixListSchema = z.array(CiFixSchema).min(1).max(15);

function buildJsonSchemaFromZod(schema: z.ZodTypeAny, name: string) {
  const json = zodToJsonSchema(schema, { name, target: "openAi" }) as any;
  if (json?.definitions?.[name]) {
    return json.definitions[name];
  }
  return json;
}

function buildJsonOutputType(schema: z.ZodTypeAny, name: string): JsonSchemaDefinition {
  return {
    type: "json_schema",
    name,
    strict: true,
    schema: buildJsonSchemaFromZod(schema, name),
  };
}

const IntentionOutputType = buildJsonOutputType(IntentionListSchema, "Intentions");
const RecommendationOutputType = buildJsonOutputType(RecommendationListSchema, "Recommendations");
const CiIssueOutputType = buildJsonOutputType(CiIssueListSchema, "CiIssueList");
const CiFixOutputType = buildJsonOutputType(CiFixListSchema, "CiFixList");

function coerceStructuredOutput<T>(value: unknown, schema: z.ZodType<T>, fallback: T): T {
  if (value == null) {
    return fallback;
  }
  try {
    const candidate = typeof value === "string" ? JSON.parse(value) : value;
    return schema.parse(candidate);
  } catch (error) {
    console.warn("Failed to parse structured agent output", error);
    return fallback;
  }
}

type RepoContext = {
  cwd: string;
  branch: string;
  baseBranch: string;
  statusSummary: string;
  diffStat: string;
  diffSample: string;
  recentCommits: string;
};

type StatusCheck = {
  name: string;
  status: string;
  conclusion?: string;
  url?: string;
  workflow?: string;
};

type PrStatusSummary = {
  number?: number;
  title?: string;
  mergeState?: string;
  headRef?: string;
  baseRef?: string;
  statuses: StatusCheck[];
  ghChecksText?: string;
};

type ReviewAnalysis = {
  summary: string;
  intentions: Intention[];
  recommendations: Recommendation[];
  repoContext: RepoContext;
  prStatus?: PrStatusSummary | null;
  thread: Thread;
  ciHandoff?: Thread;
};

type CiAnalysis = {
  issues: CiIssue[];
  fixes: CiFix[];
  confidence: number;
  thread: Thread;
};

type CiCheckKind = "lint" | "tests" | "build" | "security";

type ReverieResult = {
  conversationId: string;
  timestamp: string;
  relevance: number;
  excerpt: string;
  insights: string[];
};

type ProcessedReverie = ReverieResult & {
  rawRelevance: number;
  headRecords: string[];
  tailRecords: string[];
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONFIG: MultiAgentConfig = {
  workingDirectory: process.cwd(),
  skipGitRepoCheck: true,
  reviewBranch: true,
  ciCheck: true,
  interactive: false,
  model: DEFAULT_MODEL,
  // Default to a heavier preset for production agents (tests can override with bge-small/e5-small).
  embedder: {
    initOptions: {
      model: "BAAI/bge-large-en-v1.5",
    },
    embedRequest: {
      normalize: true,
      cache: true,
    },
  },
  suppressedChecks: [],
};

// ---------------------------------------------------------------------------
// Shell helpers
// ---------------------------------------------------------------------------

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

function runCommand(cmd: string, args: string[], cwd: string): CommandResult {
  try {
    const result = spawnSync(cmd, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      code: result.status ?? 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch (error) {
    return { code: -1, stdout: "", stderr: String(error) };
  }
}

function limitText(input: string, maxLines = MAX_CONTEXT_LINES, maxChars = MAX_CONTEXT_CHARS): string {
  if (!input) return "";
  const lines = input.split(/\r?\n/);
  const trimmed = lines.slice(0, maxLines).join("\n");
  if (trimmed.length <= maxChars) {
    return trimmed.trimEnd();
  }
  return `${trimmed.slice(0, maxChars - 3)}...`;
}

function detectBaseBranch(cwd: string, override?: string): string {
  if (override) return override;
  const upstream = runCommand("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd);
  if (upstream.code === 0) {
    const value = upstream.stdout.trim();
    const slash = value.lastIndexOf("/");
    return slash === -1 ? value : value.slice(slash + 1);
  }
  return FALLBACK_BASE_BRANCH;
}

function collectRepoContext(cwd: string, baseOverride?: string): RepoContext {
  const branch = runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd).stdout.trim() || "unknown";
  const baseBranch = detectBaseBranch(cwd, baseOverride);
  const statusSummary = limitText(runCommand("git", ["status", "-sb"], cwd).stdout || "<no status>");
  const diffStat = limitText(runCommand("git", ["--no-pager", "diff", "--stat"], cwd).stdout || "<no diff>");
  const diffSample = limitText(runCommand("git", ["--no-pager", "diff", "-U3"], cwd).stdout || "<no diff sample>");
  const recentCommits = limitText(
    runCommand("git", ["--no-pager", "log", "-5", "--oneline"], cwd).stdout || "<no commits>",
    20,
    1200,
  );

  return {
    cwd,
    branch,
    baseBranch,
    statusSummary,
    diffStat,
    diffSample,
    recentCommits,
  };
}

function collectPrStatus(cwd: string): PrStatusSummary | null {
  const view = runCommand("gh", [
    "pr",
    "view",
    "--json",
    "number,title,mergeStateStatus,statusCheckRollup,headRefName,baseRefName",
  ], cwd);
  if (view.code !== 0) {
    return null;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(view.stdout);
  } catch {
    return null;
  }

  const statuses: StatusCheck[] = Array.isArray(parsed.statusCheckRollup)
    ? parsed.statusCheckRollup.map((item: any) => ({
        name: item?.name ?? item?.workflowName ?? "<unknown>",
        status: item?.status ?? "UNKNOWN",
        conclusion: item?.conclusion ?? undefined,
        url: item?.detailsUrl ?? undefined,
        workflow: item?.workflowName ?? undefined,
      }))
    : [];

  const checksText = runCommand("gh", ["pr", "checks"], cwd);

  return {
    number: parsed.number,
    title: parsed.title,
    mergeState: parsed.mergeStateStatus,
    headRef: parsed.headRefName,
    baseRef: parsed.baseRefName,
    statuses,
    ghChecksText: checksText.code === 0 ? limitText(checksText.stdout, 200, 4000) : undefined,
  };
}

function formatRepoContext(context: RepoContext): string {
  return `Branch: ${context.branch}\nBase: ${context.baseBranch}\nStatus:\n${context.statusSummary}\n\nDiff Stat:\n${context.diffStat}\n\nRecent Commits:\n${context.recentCommits}`;
}

function formatPrStatus(summary?: PrStatusSummary | null): string {
  if (!summary) {
    return "No open PR detected (gh pr view failed).";
  }
  const header = summary.number
    ? `PR #${summary.number} (${summary.title ?? "no title"}) [${summary.mergeState ?? "UNKNOWN"}]`
    : "PR status unknown";
  const statuses = summary.statuses.length === 0
    ? "(no checks reported)"
    : summary.statuses
        .map((s) => `- ${s.name}: ${s.status}${s.conclusion ? ` (${s.conclusion})` : ""}`)
        .join("\n");
  return `${header}\nHead: ${summary.headRef ?? "?"} -> Base: ${summary.baseRef ?? "?"}\nChecks:\n${statuses}`;
}

// ---------------------------------------------------------------------------
// PR Deep Reviewer
// ---------------------------------------------------------------------------

class PRDeepReviewer {
  private codex: Codex;
  private provider: CodexProvider;
  private runner: Runner;

  constructor(private readonly config: MultiAgentConfig) {
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
      ? { type: "branch", baseBranch: repoContext.baseBranch } as const
      : { type: "current_changes" } as const;

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

    const intentionResult = await this.runner.run(
      intentionAnalyzer,
      `Repo context:\n${contextBlock}\n\nPR status:\n${prBlock}\n\nReview summary:\n${reviewResult.finalResponse}\n\nExtract the key intentions and architectural goals in <=8 bullets.`,
    );
    const intentions = coerceStructuredOutput(intentionResult.finalOutput, IntentionListSchema, []);
    const qualityResult = await this.runner.run(
      qualityReviewer,
      `Context:\n${contextBlock}\n\nReview:\n${reviewResult.finalResponse}\n\nIntentions:\n${JSON.stringify(intentions, null, 2)}\n\nProvide actionable recommendations (tests to add, refactors, follow-up tasks).`,
    );
    const recommendations = coerceStructuredOutput(qualityResult.finalOutput, RecommendationListSchema, []);

    const reviewThread = this.codex.startThread({
      model: this.config.model ?? DEFAULT_MODEL,
      workingDirectory: repoContext.cwd,
      skipGitRepoCheck: this.config.skipGitRepoCheck,
      approvalMode: "on-request",
      sandboxMode: "workspace-write",
    });

    await reviewThread.run(`You already completed an automated branch review.\n\nBranch: ${repoContext.branch}\nBase: ${repoContext.baseBranch}\n\nRepo signals:\n${contextBlock}\n\nPR status summary:\n${prBlock}\n\nAutomated review findings:\n${reviewResult.finalResponse}\n\nSummarize the most critical insights and propose next investigative steps before I join via TUI.`);

    await reviewThread.run(`Log any CI or QA follow-ups you believe are necessary. You may soon fork to a CI triage agent; acknowledge by replying with a short checklist and the token 'CI-HANDOFF-READY'.`);

    let ciHandoff: Thread | undefined;
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

  async launchInteractiveReview(thread: Thread, data: ReviewAnalysis): Promise<NativeTuiExitInfo> {
    const intentionLines = data.intentions
      .map((item) => `• [${item.category}] ${item.title ?? item.summary} (${item.impactScope})`)
      .join("\n");
    const recommendationLines = data.recommendations
      .map((rec) => `• [${rec.priority}] ${rec.title ?? rec.description} — ${rec.category}`)
      .join("\n");
    const prompt = `PR Review Ready\n\nSummary:\n${data.summary}\n\nIntentions:\n${intentionLines}\n\nRecommendations:\n${recommendationLines}\n\nEnter the TUI and drill into any file or test you want.`;
    return thread.tui({ prompt, model: this.config.model ?? DEFAULT_MODEL });
  }
}

// ---------------------------------------------------------------------------
// CI Checker System
// ---------------------------------------------------------------------------

class CICheckerSystem {
  private codex: Codex;
  private provider: CodexProvider;
  private runner: Runner;

  constructor(private readonly config: MultiAgentConfig) {
    this.codex = new Codex({ baseUrl: config.baseUrl, apiKey: config.apiKey });
    this.provider = new CodexProvider({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      defaultModel: DEFAULT_MINI_MODEL,
      workingDirectory: config.workingDirectory,
      skipGitRepoCheck: config.skipGitRepoCheck,
    });
    this.runner = new Runner({ modelProvider: this.provider });
  }

  private isSuppressed(kind: CiCheckKind): boolean {
    return (this.config.suppressedChecks ?? []).includes(kind);
  }

  private parseIssueOutput(raw: unknown, fallbackSource: CiCheckKind): CiIssue[] {
    const parsed = coerceStructuredOutput(raw, CiIssueListSchema, []);
    return parsed.map((issue) => ({
      ...issue,
      source: issue.source ?? fallbackSource,
    }));
  }

  private formatIssueSummary(issues: CiIssue[]): string {
    if (issues.length === 0) {
      return "(no structured CI issues detected)";
    }
    return issues
      .map((issue, idx) => {
        const files = issue.files?.length ? ` Files: ${issue.files.join(", ")}` : "";
        const commands = issue.suggestedCommands?.length ? ` Commands: ${issue.suggestedCommands.join(" | ")}` : "";
        return `#${idx + 1} [${issue.severity}] (${issue.source}) ${issue.title}\n${issue.summary}${files}${commands}`;
      })
      .join("\n\n");
  }

  private formatFixSummary(fixes: CiFix[]): string {
    if (fixes.length === 0) {
      return "(no remediation steps synthesized)";
    }
    return fixes
      .map((fix, idx) => {
        const steps = fix.steps?.length ? ` Steps: ${fix.steps.join(" | ")}` : "";
        const commands = fix.commands?.length ? ` Commands: ${fix.commands.join(" | ")}` : "";
        return `#${idx + 1} [${fix.priority}] ${fix.title}${steps}${commands}`;
      })
      .join("\n");
  }

  async checkAndFixCI(
    repoContext: RepoContext,
    prStatus: PrStatusSummary | null,
    ciThread?: Thread,
  ): Promise<CiAnalysis> {
    console.log('🔧 Running CI analysis agents...');
    const model = await this.provider.getModel();
    const ciSignal = `${formatRepoContext(repoContext)}

PR/CI Status:
${formatPrStatus(prStatus)}

GH checks:
${prStatus?.ghChecksText ?? '<no gh pr checks output>'}`;

    const lintChecker = new Agent({
      name: 'LintChecker',
      model,
      outputType: CiIssueOutputType,
      instructions: `# Lint & Static Analysis Checker

You are predicting lint, style, and static analysis issues before CI runs.

## Task
Return the most likely lint/static-analysis failures as structured JSON.

## JSON Output
Respond with a JSON array of CiIssue objects. Set "source" to "lint" for every entry.`,
    });
    const testChecker = new Agent({
      name: 'TestChecker',
      model,
      outputType: CiIssueOutputType,
      instructions: `# Test Failure Predictor

You are predicting test failures and coverage gaps before CI runs.

## Task
Return projected failing tests as structured JSON.

## JSON Output
Respond with a JSON array of CiIssue objects. Set "source" to "tests" for every entry.`,
    });
    const buildChecker = new Agent({
      name: 'BuildChecker',
      model,
      outputType: CiIssueOutputType,
      instructions: `# Build & Dependency Checker

You are detecting build, packaging, and dependency issues before CI runs.

## Task
Return likely build blockers as structured JSON.

## JSON Output
Respond with a JSON array of CiIssue objects. Set "source" to "build" for every entry.`,
    });
    const securityChecker = new Agent({
      name: 'SecurityChecker',
      model,
      outputType: CiIssueOutputType,
      instructions: `# Security & Secrets Checker

You are identifying security vulnerabilities and secrets hygiene issues.

## Task
Return likely security failures as structured JSON.

## JSON Output
Respond with a JSON array of CiIssue objects. Set "source" to "security" for every entry.`,
    });
    const fixer = new Agent({
      name: 'CIFixer',
      model,
      outputType: CiFixOutputType,
      instructions: `# CI Issue Remediation Planner

You synthesize issues from multiple checkers and output an ordered remediation plan.

## Task
Cluster issues by priority, propose owners, commands, and ETA.

## JSON Output
Respond with a JSON array of CiFix objects (title, priority, steps, commands, owner, etaHours).`,
    });

    const prompts = {
      lint: `${ciSignal}

Task: enumerate lint/static-analysis issues likely to fail CI. Include file hints or commands.`,
      test: `${ciSignal}

Task: identify tests likely to fail or be missing. Include pytest/cargo/jest commands.`,
      build: `${ciSignal}

Task: identify build or dependency issues across OS targets.`,
      security: `${ciSignal}

Task: point out security vulnerabilities or secrets hygiene risks in this diff.`,
    } as const;

    const runIssueAgent = async (kind: CiCheckKind, agent: Agent, prompt: string) => {
      if (this.isSuppressed(kind)) {
        return [] as CiIssue[];
      }
      const result = await this.runner.run(agent, prompt);
      return this.parseIssueOutput(result.finalOutput, kind);
    };

    const [lintIssues, testIssues, buildIssues, securityIssues] = await Promise.all([
      runIssueAgent('lint', lintChecker, prompts.lint),
      runIssueAgent('tests', testChecker, prompts.test),
      runIssueAgent('build', buildChecker, prompts.build),
      runIssueAgent('security', securityChecker, prompts.security),
    ]);

    const issues = [...lintIssues, ...testIssues, ...buildIssues, ...securityIssues];

    const fixerContext = `${ciSignal}

Structured issues JSON:
${JSON.stringify(issues, null, 2)}`;
    const fixerResult = await this.runner.run(
      fixer,
      `${fixerContext}

Produce a prioritized remediation checklist with owners and commands.`,
    );
    const fixes = coerceStructuredOutput(fixerResult.finalOutput, CiFixListSchema, []);
    const confidence = Math.min(0.99, Math.max(0.2, fixes.length / Math.max(1, issues.length + 2)));

    const thread =
      ciThread ??
      this.codex.startThread({
        model: this.config.model ?? DEFAULT_MODEL,
        workingDirectory: repoContext.cwd,
        skipGitRepoCheck: this.config.skipGitRepoCheck,
        approvalMode: 'on-request',
        sandboxMode: 'workspace-write',
      });

    const issueSummary = this.formatIssueSummary(issues);
    const fixSummary = this.formatFixSummary(fixes);
    await thread.run(`CI signal summary as of ${new Date().toISOString()}

${ciSignal}

Issues:
${issueSummary}

Recommended fixes:
${fixSummary}

Return a short confirmation and be ready to continue interactively.`);

    return {
      issues,
      fixes,
      confidence,
      thread,
    };
  }

  async launchInteractiveFixing(thread: Thread, data: CiAnalysis): Promise<NativeTuiExitInfo> {
    const prompt = `CI Analysis
Confidence: ${(data.confidence * 100).toFixed(1)}%

Issues:
${this.formatIssueSummary(data.issues)}

Fixes:
${this.formatFixSummary(data.fixes)}

Let's jump into the TUI and apply/validate these fixes.`;
    return thread.tui({ prompt, model: this.config.model ?? DEFAULT_MODEL });
  }
}
// ---------------------------------------------------------------------------
// Reverie System Helpers
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dot = 0, aMag = 0, bMag = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aMag += a[i] * a[i];
    bMag += b[i] * b[i];
  }

  if (aMag === 0 || bMag === 0) return 0;
  return dot / (Math.sqrt(aMag) * Math.sqrt(bMag));
}

function extractCompactTextFromRecords(headRecords: string[], tailRecords: string[], insights: string[]): string {
  const texts: string[] = [];

  // Extract from head records
  for (const line of headRecords) {
    try {
      const obj = JSON.parse(line);
      const content = obj?.content || obj?.text;
      if (typeof content === "string" && content.trim()) {
        texts.push(content);
      }
    } catch {
      // ignore parse errors
    }
  }

  // Extract from tail records
  for (const line of tailRecords) {
    try {
      const obj = JSON.parse(line);
      const content = obj?.content || obj?.text;
      if (typeof content === "string" && content.trim()) {
        texts.push(content);
      }
    } catch {
      // ignore parse errors
    }
  }

  // Include insights
  texts.push(...insights);

  // Limit total length to avoid embedding large documents
  const combined = texts.join(" ").slice(0, 4000);
  return combined;
}

function resolveCodexHome(): string {
  return process.env.CODEX_HOME || path.join(process.env.HOME || process.cwd(), ".codex");
}


// ---------------------------------------------------------------------------
// Reverie System (with embedding re-ranking)
// ---------------------------------------------------------------------------

class ReverieSystem {
  private embedderReady = false;

  constructor(private readonly config: MultiAgentConfig) {}

  async searchReveries(query: string): Promise<ReverieResult[]> {
    console.log(`🔍 Searching reveries for: "${query}"`);
    const codexHome = resolveCodexHome();
    console.log(`📁 Codex home: ${codexHome}`);

    // Prefer native reverie functions if available
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const native: any = require("@codex-native/sdk");
      if (native && typeof native.reverieSearchConversations === "function") {
        const results = await native.reverieSearchConversations(codexHome, query, 25);

        // Filter to conversations whose SessionMeta.cwd is inside our workingDirectory
        const projectRoot = path.resolve(this.config.workingDirectory);
        const scoped = (results as any[]).filter((r) => {
          const head: string[] | undefined = r?.conversation?.headRecords;
          if (!Array.isArray(head) || head.length === 0) return false;
          for (const line of head) {
            try {
              const obj = JSON.parse(line);
              const cwd = obj?.meta?.cwd || obj?.cwd; // handle SessionMetaLine vs flattened
              if (typeof cwd === "string") {
                const normalized = path.resolve(cwd);
                if (normalized === projectRoot || normalized.startsWith(projectRoot + path.sep)) {
                  return true;
                }
              }
            } catch {
              // ignore parse errors
            }
          }
          return false;
        });

        // Re-rank with embeddings if embedder is available
        let processed: ProcessedReverie[] = scoped.map((r) => ({
          conversationId: r.conversation?.id || "unknown",
          timestamp: r.conversation?.createdAt || new Date().toISOString(),
          relevance: typeof r.relevanceScore === "number" ? r.relevanceScore : 0.7,
          excerpt: (r.matchingExcerpts && r.matchingExcerpts[0]) || "",
          insights: Array.isArray(r.insights) ? r.insights : [],
          // Store raw data for embedding processing
          headRecords: Array.isArray(r.conversation?.headRecords) ? r.conversation.headRecords : [],
          tailRecords: Array.isArray(r.conversation?.tailRecords) ? r.conversation.tailRecords : [],
          rawRelevance: typeof r.relevanceScore === "number" ? r.relevanceScore : 0.7,
        }));

        if (this.config.embedder) {
          processed = await this.rerankWithEmbeddings(query, processed);
        }

        // Return top 10 results, remove internal fields
        return processed.slice(0, 10).map(({ headRecords, tailRecords, rawRelevance, ...result }) => result);
      }
    } catch {
      // ignore and fall through to empty result
    }

    return [];
  }

  private async ensureEmbedderReady(): Promise<void> {
    if (this.embedderReady || !this.config.embedder) {
      return;
    }
    await fastEmbedInit(this.config.embedder.initOptions);
    this.embedderReady = true;
  }

  private async rerankWithEmbeddings(
    query: string,
    items: ProcessedReverie[],
  ): Promise<ProcessedReverie[]> {
    if (!this.config.embedder || items.length === 0) {
      return items;
    }
    try {
      await this.ensureEmbedderReady();

      const docTexts = items.map((item) =>
        extractCompactTextFromRecords(item.headRecords, item.tailRecords, item.insights),
      );
      const projectRoot = path.resolve(this.config.workingDirectory);
      const baseRequest = this.config.embedder.embedRequest ?? {};
      const embedRequest: FastEmbedEmbedRequest = {
        ...baseRequest,
        projectRoot,
        cache: baseRequest.cache ?? true,
        inputs: [query, ...docTexts],
      };

      const embeddings = await fastEmbedEmbed(embedRequest);
      if (embeddings.length !== docTexts.length + 1) {
        throw new Error("Embedding API returned unexpected length");
      }

      const [queryVector, ...docVectors] = embeddings;
      if (!queryVector) {
        return items;
      }

      const reranked = items.map((item, idx) => {
        const docEmbedding = docVectors[idx];
        if (!docEmbedding) {
          return item;
        }
        const semanticScore = cosineSimilarity(queryVector, docEmbedding);
        const blendedScore = 0.7 * semanticScore + 0.3 * item.rawRelevance;
        return { ...item, relevance: blendedScore };
      });
      reranked.sort((a, b) => b.relevance - a.relevance);
      return reranked;
    } catch (error) {
      console.warn("Embedding re-ranking failed:", error);
      return items;
    }
  }

  async injectReverie(thread: Thread, reveries: ReverieResult[], query: string): Promise<void> {
    if (reveries.length === 0) return;
    const note = `Injecting reverie learnings for '${query}':\n${reveries
      .map((r, idx) => `#${idx + 1} (${Math.round(r.relevance * 100)}%): ${r.insights.join("; ")}`)
      .join("\n")}`;
    await thread.run(note);
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

class MultiAgentOrchestrator {
  private reviewer: PRDeepReviewer;
  private ciChecker: CICheckerSystem;
  private reverie: ReverieSystem;

  constructor(private readonly config: MultiAgentConfig) {
    this.reviewer = new PRDeepReviewer(config);
    this.ciChecker = new CICheckerSystem(config);
    this.reverie = new ReverieSystem(config);
  }

  async runWorkflow(): Promise<void> {
    console.log("🚀 Multi-Agent Codex Workflow started");
    const repoContext = collectRepoContext(this.config.workingDirectory, this.config.baseBranchOverride);
    const prStatus = collectPrStatus(this.config.workingDirectory);

    let reviewData: ReviewAnalysis | null = null;

    if (this.config.reviewBranch) {
      reviewData = await this.reviewer.reviewBranch(repoContext, prStatus);
      logReviewSummary(reviewData);
      if (this.config.interactive) {
        await this.reviewer.launchInteractiveReview(reviewData.thread, reviewData);
      }
    }

    if (this.config.ciCheck) {
      const ciResult = await this.ciChecker.checkAndFixCI(repoContext, prStatus, reviewData?.ciHandoff);
      logCiSummary(ciResult);
      if (this.config.interactive) {
        await this.ciChecker.launchInteractiveFixing(ciResult.thread, ciResult);
      }
    }

    if (this.config.reverieQuery) {
      const reveries = await this.reverie.searchReveries(this.config.reverieQuery);
      const codex = new Codex({ baseUrl: this.config.baseUrl, apiKey: this.config.apiKey });
      const thread = codex.startThread({
        model: this.config.model ?? DEFAULT_MODEL,
        workingDirectory: this.config.workingDirectory,
        skipGitRepoCheck: this.config.skipGitRepoCheck,
      });
      await this.reverie.injectReverie(thread, reveries, this.config.reverieQuery);
      if (this.config.interactive) {
        await thread.tui({
          prompt: `Injected ${reveries.length} reverie insight(s) for '${this.config.reverieQuery}'. Continue the discussion.`,
        });
      }
    }

    if (!this.config.reviewBranch && !this.config.ciCheck && !this.config.reverieQuery) {
      await this.runIntegratedSession(repoContext, prStatus);
    }
  }

  private async runIntegratedSession(repoContext: RepoContext, prStatus: PrStatusSummary | null) {
    const codex = new Codex({ baseUrl: this.config.baseUrl, apiKey: this.config.apiKey });
    const thread = codex.startThread({
      model: this.config.model ?? DEFAULT_MODEL,
      workingDirectory: this.config.workingDirectory,
      skipGitRepoCheck: this.config.skipGitRepoCheck,
    });

    const prompt = `Integrated Multi-Agent Session\n\nRepo context:\n${formatRepoContext(repoContext)}\n\nPR status:\n${formatPrStatus(prStatus)}\n\nAvailable commands:\n- type 'review branch' to start automated review\n- type 'check ci' to inspect CI\n- type 'reverie <topic>' to search past insights\n\nHow can I help?`;

    if (this.config.interactive) {
      await thread.tui({ prompt });
    } else {
      const turn = await thread.run(prompt);
      console.log("🤖", turn.finalResponse);
    }
  }
}

function logReviewSummary(data: ReviewAnalysis): void {
  console.log("\n📋 Review Summary");
  console.log("Summary:", data.summary.slice(0, 600), "...\n");
  console.log(
    "Top Intentions:",
    data.intentions.slice(0, 5).map((item) => ({
      category: item.category,
      title: item.title,
      impact: item.impactScope,
    })),
  );
  console.log(
    "Recommendations:",
    data.recommendations.slice(0, 5).map((rec) => ({
      category: rec.category,
      title: rec.title,
      priority: rec.priority,
    })),
  );
}

function logCiSummary(data: CiAnalysis): void {
  console.log("\n🔧 CI Summary");
  console.log(
    "Issues:",
    data.issues.slice(0, 5).map((issue) => ({
      source: issue.source,
      severity: issue.severity,
      title: issue.title,
    })),
  );
  console.log(
    "Fixes:",
    data.fixes.slice(0, 5).map((fix) => ({
      priority: fix.priority,
      title: fix.title,
    })),
  );
  console.log("Confidence:", `${(data.confidence * 100).toFixed(1)}%`);
}

// ---------------------------------------------------------------------------
// Example: Using with OpenAI Embeddings
// ---------------------------------------------------------------------------

/*
// Example embedder configuration using FastEmbed via the native SDK:

const config: MultiAgentConfig = {
  workingDirectory: process.cwd(),
  skipGitRepoCheck: true,
  embedder: {
    initOptions: {
      model: "BAAI/bge-large-en-v1.5",
    },
    embedRequest: {
      normalize: true,
    },
  },
};
*/

async function main(): Promise<void> {
  const config: MultiAgentConfig = { ...CONFIG };
  if (config.interactive && (!process.stdout.isTTY || !process.stdin.isTTY)) {
    console.error("❌ Interactive mode requires a TTY terminal.");
    process.exit(1);
  }
  const orchestrator = new MultiAgentOrchestrator(config);
  await orchestrator.runWorkflow();
}

if (require.main === module) {
  main().catch((error) => {
    console.error("💥 Fatal error:", error);
    process.exit(1);
  });
}

export {
  MultiAgentOrchestrator,
  PRDeepReviewer,
  CICheckerSystem,
  ReverieSystem,
  type MultiAgentConfig,
  type ReviewAnalysis,
  type CiAnalysis,
  type RepoContext,
};
