import { Codex } from "@codex-native/sdk";
import { DEFAULT_MODEL } from "./constants.js";
import { CICheckerSystem } from "./ci-checker-system.js";
import { PRDeepReviewer } from "./pr-deep-reviewer.js";
import { ReverieSystem } from "./reverie.js";
import { collectPrStatus, collectRepoContext, formatPrStatus, formatRepoContext } from "./repo.js";
import type { CiAnalysis, MultiAgentConfig, PrStatusSummary, RepoContext, ReviewAnalysis } from "./types.js";

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

export { MultiAgentOrchestrator };
