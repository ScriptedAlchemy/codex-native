import { Agent, Runner } from "@openai/agents";
import type { JsonSchemaDefinition } from "@openai/agents-core";
import { Codex, CodexProvider, type NativeTuiExitInfo, type Thread } from "@codex-native/sdk";
import type { LspDiagnosticsBridge } from "@codex-native/sdk";
import { DEFAULT_MODEL, DEFAULT_MINI_MODEL } from "./constants.js";
import {
  CiFixResponseSchema,
  CiIssueResponseSchema,
  CiFixOutputType,
  CiIssueOutputType,
  coerceStructuredOutput,
  type CiFix,
  type CiIssue,
} from "./schemas.js";
import type {
  CiAnalysis,
  CiCheckKind,
  MultiAgentConfig,
  PrStatusSummary,
  RepoContext,
  StructuredOutputMode,
} from "./types.js";
import { formatPrStatus, formatRepoContext } from "./repo.js";
import { attachApplyPatchReminder } from "./reminders/applyPatchReminder.js";

class CICheckerSystem {
  private codex: Codex;
  private provider: CodexProvider;
  private runner: Runner;

  constructor(private readonly config: MultiAgentConfig, private readonly diagnostics?: LspDiagnosticsBridge) {
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
    const parsed = coerceStructuredOutput(raw, CiIssueResponseSchema as any, { items: [] }).items as CiIssue[];
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
        const detailParts = [
          fix.steps?.length ? `Steps: ${fix.steps.join(" | ")}` : null,
          fix.commands?.length ? `Commands: ${fix.commands.join(" | ")}` : null,
        ].filter(Boolean) as string[];
        const suffix = detailParts.length ? ` — ${detailParts.join("; ")}` : "";
        return `#${idx + 1} [${fix.priority}] ${fix.title}${suffix}`;
      })
      .join("\n");
  }

  async checkAndFixCI(
    repoContext: RepoContext,
    prStatus: PrStatusSummary | null,
    ciThread?: Thread,
  ): Promise<CiAnalysis> {
    console.log("🔧 Running CI analysis agents...");
    const model = await this.provider.getModel();
    const ciSignal = `${formatRepoContext(repoContext)}

PR/CI Status:
${formatPrStatus(prStatus)}

GH checks:
${prStatus?.ghChecksText ?? "<no gh pr checks output>"}`;

    const useStructuredIssues = this.shouldUseStructuredOutput("ci-issues");
    const useStructuredFixes = this.shouldUseStructuredOutput("ci-fixes");

    const lintChecker = new Agent<unknown, JsonSchemaDefinition>({
      name: "LintChecker",
      model,
      ...(useStructuredIssues ? { outputType: CiIssueOutputType } : {}),
      instructions: `# Lint & Static Analysis Checker

You detect lint, formatting, and static-analysis issues that will fail CI.

## Task
Return likely lint failures as structured JSON (severity, files, commands).

## JSON Output
Respond with a JSON array of CiIssue objects. Set "source" to "lint" for every entry.`,
    });
    const testChecker = new Agent<unknown, JsonSchemaDefinition>({
      name: "TestChecker",
      model,
      ...(useStructuredIssues ? { outputType: CiIssueOutputType } : {}),
      instructions: `# Test Failure Forecaster

You predict failing or missing tests before CI finishes.

## Task
Return likely test failures or missing suites as structured JSON.

## JSON Output
Respond with a JSON array of CiIssue objects. Set "source" to "tests" for every entry.`,
    });
    const buildChecker = new Agent<unknown, JsonSchemaDefinition>({
      name: "BuildChecker",
      model,
      ...(useStructuredIssues ? { outputType: CiIssueOutputType } : {}),
      instructions: `# Build & Dependency Checker

You are detecting build, packaging, and dependency issues before CI runs.

## Task
Return likely build blockers as structured JSON.

## JSON Output
Respond with a JSON array of CiIssue objects. Set "source" to "build" for every entry.`,
    });
    const securityChecker = new Agent<unknown, JsonSchemaDefinition>({
      name: "SecurityChecker",
      model,
      ...(useStructuredIssues ? { outputType: CiIssueOutputType } : {}),
      instructions: `# Security & Secrets Checker

You are identifying security vulnerabilities and secrets hygiene issues.

## Task
Return likely security failures as structured JSON.

## JSON Output
Respond with a JSON array of CiIssue objects. Set "source" to "security" for every entry.`,
    });
    const fixer = new Agent<unknown, JsonSchemaDefinition>({
      name: "CIFixer",
      model,
      ...(useStructuredFixes ? { outputType: CiFixOutputType } : {}),
      instructions: `# CI Issue Remediation Planner

You synthesize issues from multiple checkers and output an ordered remediation plan.

## Task
Cluster issues by priority, propose commands.

## JSON Output
Respond with a JSON array of CiFix objects (title, priority, steps, commands).`,
    });

    const prompts = {
      lint: `${ciSignal}

Task: enumerate lint/static-analysis issues likely to fail CI. Include file hints or commands.`,
      tests: `${ciSignal}

Task: identify tests likely to fail or be missing. Include pytest/cargo/jest commands.`,
      build: `${ciSignal}

Task: identify build or dependency issues across OS targets.`,
      security: `${ciSignal}

Task: point out security vulnerabilities or secrets hygiene risks in this diff.`,
    } as const;

    const runIssueAgent = async (kind: CiCheckKind, agent: Agent<unknown, JsonSchemaDefinition>, prompt: string) => {
      if (this.isSuppressed(kind)) {
        return [] as CiIssue[];
      }
      const result = await (this.runner.run as typeof this.runner.run)(agent, prompt);
      return this.parseIssueOutput(result.finalOutput, kind);
    };

    const [lintIssues, testIssues, buildIssues, securityIssues] = await Promise.all([
      runIssueAgent("lint", lintChecker, prompts.lint),
      runIssueAgent("tests", testChecker, prompts.tests),
      runIssueAgent("build", buildChecker, prompts.build),
      runIssueAgent("security", securityChecker, prompts.security),
    ]);

    const issues = [...lintIssues, ...testIssues, ...buildIssues, ...securityIssues];

    const fixerContext = `${ciSignal}

Structured issues JSON:
${JSON.stringify(issues, null, 2)}`;
    const fixerResult = await (this.runner.run as typeof this.runner.run)(
      fixer,
      `${fixerContext}

Produce a prioritized remediation checklist with owners and commands.`,
    );
    const fixes = coerceStructuredOutput(
      fixerResult.finalOutput,
      CiFixResponseSchema as any,
      { items: [] },
    ).items as CiFix[];
    const confidence = Math.min(0.99, Math.max(0.2, fixes.length / Math.max(1, issues.length + 2)));

    const thread =
      ciThread ??
      this.codex.startThread({
        model: this.config.model ?? DEFAULT_MODEL,
        workingDirectory: repoContext.cwd,
        skipGitRepoCheck: this.config.skipGitRepoCheck,
        approvalMode: this.config.approvalMode ?? "on-request",
        sandboxMode: this.config.sandboxMode ?? "workspace-write",
      });
    if (!ciThread) {
      attachApplyPatchReminder(thread, this.config.sandboxMode ?? "workspace-write");
    }
    this.diagnostics?.attach(thread);

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

  private shouldUseStructuredOutput(scope: "ci-issues" | "ci-fixes"): boolean {
    const mode: StructuredOutputMode = this.config.structuredOutputMode ?? "actions-only";
    if (mode === "always") {
      return true;
    }
    if (mode === "never") {
      return false;
    }
    return scope === "ci-fixes";
  }
}

export { CICheckerSystem };
