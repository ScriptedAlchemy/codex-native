import { Codex } from "@codex-native/sdk";
import { DEFAULT_MODEL } from "./constants.js";
import { CICheckerSystem } from "./ci-checker-system.js";
import { PRDeepReviewer } from "./pr-deep-reviewer.js";
import { ReverieSystem } from "./reverie.js";
import { collectPrStatus, collectRepoContext, formatPrStatus, formatRepoContext } from "./repo.js";
import type { CiAnalysis, MultiAgentConfig, PrStatusSummary, RepoContext, ReviewAnalysis } from "./types.js";
import { runThreadTui } from "./tui-util.js";
import { LspDiagnosticsBridge } from "@codex-native/sdk";
import { attachApplyPatchReminder } from "./reminders/applyPatchReminder.js";

class MultiAgentOrchestrator {
  private reviewer: PRDeepReviewer;
  private ciChecker: CICheckerSystem;
  private reverie: ReverieSystem;
  private diagnostics?: LspDiagnosticsBridge;

  constructor(private readonly config: MultiAgentConfig) {
    if (config.enableLspDiagnostics) {
      this.diagnostics = new LspDiagnosticsBridge({
        workingDirectory: config.workingDirectory,
        waitForDiagnostics: config.lspWaitForDiagnostics,
      });
    }
    this.reviewer = new PRDeepReviewer(config, this.diagnostics);
    this.ciChecker = new CICheckerSystem(config, this.diagnostics);
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
      await runThreadTui(
        reviewData.thread,
        {
          prompt: buildReviewPrompt(reviewData),
          model: this.config.model ?? DEFAULT_MODEL,
        },
        "PR review",
      );
    }

    if (this.config.ciCheck) {
      const ciResult = await this.ciChecker.checkAndFixCI(repoContext, prStatus, reviewData?.ciHandoff);
      logCiSummary(ciResult);
      await runThreadTui(
        ciResult.thread,
        {
          prompt: buildCiPrompt(ciResult),
          model: this.config.model ?? DEFAULT_MODEL,
        },
        "CI triage",
      );
    }

    if (this.config.reverieQuery) {
      const reveries = await this.reverie.searchReveries(this.config.reverieQuery);
      const codex = new Codex({ baseUrl: this.config.baseUrl, apiKey: this.config.apiKey });
      const thread = codex.startThread({
        model: this.config.model ?? DEFAULT_MODEL,
        workingDirectory: this.config.workingDirectory,
        skipGitRepoCheck: this.config.skipGitRepoCheck,
      });
      const detach = this.diagnostics?.attach(thread);
      const reminderCleanup = attachApplyPatchReminder(thread, "danger-full-access");
      await this.reverie.injectReverie(thread, reveries, this.config.reverieQuery);
      await runThreadTui(
        thread,
        {
          prompt: `Injected ${reveries.length} reverie insight(s) for '${this.config.reverieQuery}'. Explore history here, then close this TUI to continue.`,
          model: this.config.model ?? DEFAULT_MODEL,
        },
        "Reverie insights",
      );
      detach?.();
      reminderCleanup();
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
    const detach = this.diagnostics?.attach(thread);
    const reminderCleanup = attachApplyPatchReminder(thread, "danger-full-access");

    const prompt = `Integrated Multi-Agent Session\n\nRepo context:\n${formatRepoContext(repoContext)}\n\nPR status:\n${formatPrStatus(prStatus)}\n\nAvailable commands:\n- type 'review branch' to start automated review\n- type 'check ci' to inspect CI\n- type 'reverie <topic>' to search past insights\n\nHow can I help?`;

    await runThreadTui(
      thread,
      {
        prompt,
        model: this.config.model ?? DEFAULT_MODEL,
      },
      "Integrated session",
    );
    detach?.();
    reminderCleanup();
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

function buildReviewPrompt(data: ReviewAnalysis): string {
  const intentions = data.intentions
    .map((item) => `• [${item.category}] ${item.title ?? item.summary} (${item.impactScope})`)
    .join("\n");
  const recommendations = data.recommendations
    .map((rec) => `• [${rec.priority}] ${rec.title ?? rec.description} — ${rec.category}`)
    .join("\n");
  return `PR Review Ready\n\nSummary:\n${data.summary}\n\nIntentions:\n${intentions}\n\nRecommendations:\n${recommendations}`;
}

function buildCiPrompt(data: CiAnalysis): string {
  return `CI Analysis\nConfidence: ${(data.confidence * 100).toFixed(1)}%\n\nIssues:\n${data
    .issues.slice(0, 10)
    .map((issue, idx) => `#${idx + 1} [${issue.severity}] (${issue.source}) ${issue.title}`)
    .join("\n")}\n\nFixes:\n${data
    .fixes.slice(0, 10)
    .map((fix, idx) => `#${idx + 1} [${fix.priority}] ${fix.title}`)
    .join("\n")}`;
}

export { MultiAgentOrchestrator };
