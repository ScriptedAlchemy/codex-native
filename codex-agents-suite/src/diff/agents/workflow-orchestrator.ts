import { run } from "@openai/agents";
import { Codex, type Thread, LspManager, formatDiagnosticsWithSummary } from "@codex-native/sdk";
import type { AgentWorkflowConfig, CoordinatorInput } from "./types.js";
import type { WorkerOutcome, ConflictContext, RemoteComparison } from "../merge/types.js";
import { createCoordinatorAgent } from "./coordinator-agent.js";
import { createReviewerAgent, formatReviewerInput } from "./reviewer-agent.js";
import { runOpenCodeResolution } from "./opencode-wrapper.js";
import { ApprovalSupervisor } from "../merge/supervisor.js";
import { GitRepo } from "../merge/git.js";
import { logInfo, logWarn } from "../merge/logging.js";

const DEFAULT_OPEN_CODE_SEVERITY_THRESHOLD = 1200;

/**
 * Agent workflow orchestrator using @openai/agents SDK.
 * Drives: Coordinator → Worker(s) → Reviewer pipeline.
 */
export class AgentWorkflowOrchestrator {
  private readonly git: GitRepo;
  private readonly approvalSupervisor: ApprovalSupervisor | null;
  private supervisorLogThread: Thread | null;
  private coordinatorThread: Thread | null = null;
  private readonly activeFiles = new Set<string>();
  private readonly pathLocks = new Map<string, Promise<void>>();

  constructor(private readonly config: AgentWorkflowConfig) {
    this.git = new GitRepo(this.config.workingDirectory);
    const { supervisor, logThread } = this.buildSupervisor();
    this.approvalSupervisor = supervisor;
    this.supervisorLogThread = logThread;
  }

  async execute(input: CoordinatorInput): Promise<{
    success: boolean;
    outcomes: WorkerOutcome[];
    coordinatorPlan: string | null;
    transcript: string;
  }> {
    logInfo("agent", "Starting agent-based merge workflow");

    // Phase 1: Coordinator plans global strategy
    const coordinatorPlan = await this.runCoordinatorPhase(input);
    await this.syncSupervisorContext(coordinatorPlan, input);

    // Phase 2: Workers resolve individual conflicts
    const workerOutcomes = await this.runWorkerPhase(
      input.conflicts,
      coordinatorPlan,
      input.remoteComparison ?? null,
    );

    // Phase 2.5: Post-resolution LSP validation (collect diagnostics after conflicts resolved)
    let lspDiagnosticsSummary: string | null = null;
    if (workerOutcomes.every((o) => o.success)) {
      lspDiagnosticsSummary = await this.collectPostResolutionDiagnostics(
        workerOutcomes.map((o) => o.path),
      );
    }

    // Phase 3: Reviewer validates overall outcome (with LSP diagnostics if available)
    const reviewerSummary = await this.runReviewerPhase(
      workerOutcomes,
      input.remoteComparison,
      lspDiagnosticsSummary,
    );

    const success = workerOutcomes.every((o) => o.success) && (await this.isAllResolved());
    if (success) {
      // Optional validation pass to surface any lingering issues post-merge.
      await this.runReviewerPhase(workerOutcomes, input.remoteComparison, true);
    }
    const transcript = this.generateTranscript(coordinatorPlan, workerOutcomes, reviewerSummary);

    return {
      success,
      outcomes: workerOutcomes,
      coordinatorPlan,
      transcript,
    };
  }

  private async syncSupervisorContext(plan: string | null, snapshot: CoordinatorInput): Promise<void> {
    if (!this.supervisorLogThread) {
      return;
    }
    try {
      const statusLine = snapshot.statusShort ?? "<status unavailable>";
      const diffStat = snapshot.diffStat ?? "<diffstat unavailable>";
      const remote = snapshot.remoteComparison
        ? `${snapshot.remoteComparison.originRef} ↔ ${snapshot.remoteComparison.upstreamRef}`
        : "(no remote comparison)";
      await this.supervisorLogThread.run(
        `Supervisor context\nStatus: ${statusLine}\nDiffstat: ${diffStat}\nRemote: ${remote}\nPlan:\n${(plan ?? "<none>").slice(0, 1500)}`,
      );
    } catch (error) {
      logWarn("supervisor", `Failed to log supervisor context: ${error}`);
    }
  }

  private async runCoordinatorPhase(input: CoordinatorInput): Promise<string | null> {
    logInfo("coordinator", "Running coordinator agent...");

    const { agent } = createCoordinatorAgent({
      workingDirectory: this.config.workingDirectory,
      baseUrl: this.config.baseUrl,
      apiKey: this.config.apiKey,
      sandboxMode: this.config.sandboxMode,
      approvalMode: this.config.approvalMode,
      skipGitRepoCheck: this.config.skipGitRepoCheck,
      model: this.config.coordinatorModel,
      coordinatorInstructions: this.config.coordinatorInstructions,
      approvalSupervisor: this.approvalSupervisor,
      reasoningEffort: this.config.reasoningEffort ?? "high",
    });

    const slimInput = this.shrinkCoordinatorInput(input);
    const result = await run(agent, JSON.stringify(slimInput));
    if (!result?.finalOutput || typeof result.finalOutput !== "string") {
      throw new Error("Coordinator produced invalid output");
    }
    return result.finalOutput;
  }

  private async runWorkerPhase(
    conflicts: CoordinatorInput["conflicts"],
    coordinatorPlan: string | null,
    remoteComparison: RemoteComparison | null,
  ): Promise<WorkerOutcome[]> {
    logInfo("worker", `Processing ${conflicts.length} conflicts...`);

    // Prioritize config files first (critical infrastructure)
    const prioritizedConflicts = this.prioritizeConfigFiles(conflicts);

    const outcomes: WorkerOutcome[] = [];
    const simpleConflicts = prioritizedConflicts.filter((c) => !this.isComplex(c));
    const complexConflicts = prioritizedConflicts.filter((c) => this.isComplex(c));
    const maxConcurrent = Math.max(1, this.config.maxConcurrentSimpleWorkers ?? 1);
    const active = new Set<Promise<void>>();

    logInfo(
      "worker",
      `Queue split: ${simpleConflicts.length} simple, ${complexConflicts.length} complex (max ${maxConcurrent} simple in parallel)`,
    );

    const schedule = (conflict: ConflictContext): void => {
      const prior = this.pathLocks.get(conflict.path) ?? Promise.resolve();
      const task = prior
        .then(() => this.handleConflict(conflict, coordinatorPlan, remoteComparison))
        .then((outcome) => {
          outcomes.push(outcome);
        })
        .catch((error) => {
          logWarn("worker", `Unhandled error: ${error}`, conflict.path);
          outcomes.push({
            path: conflict.path,
            success: false,
            error: String(error),
          });
        })
        .finally(() => {
          this.activeFiles.delete(conflict.path);
          active.delete(task);
          this.pathLocks.delete(conflict.path);
        });
      active.add(task);
      this.pathLocks.set(conflict.path, task);
    };

    for (const conflict of simpleConflicts) {
      while (active.size >= maxConcurrent) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.race(active);
      }
      if (this.activeFiles.has(conflict.path)) {
        // wait for existing processing of same file
        // eslint-disable-next-line no-await-in-loop
        await Promise.race(active);
      }
      this.activeFiles.add(conflict.path);
      schedule(conflict);
    }

    if (active.size > 0) {
      await Promise.all(active);
    }

    for (const conflict of complexConflicts) {
      if (this.activeFiles.has(conflict.path)) {
        await Promise.all(active);
        this.activeFiles.delete(conflict.path);
      }
      this.activeFiles.add(conflict.path);
      const outcome = await this.handleConflict(conflict, coordinatorPlan, remoteComparison);
      outcomes.push(outcome);
      this.activeFiles.delete(conflict.path);
    }

    return outcomes;
  }

  private async runReviewerPhase(
    outcomes: WorkerOutcome[],
    remoteComparison: CoordinatorInput["remoteComparison"],
    lspDiagnostics: string | null = null,
    validationMode = false,
  ): Promise<string | null> {
    logInfo(validationMode ? "validation" : "reviewer", "Running reviewer agent...");

    const { agent } = createReviewerAgent({
      workingDirectory: this.config.workingDirectory,
      baseUrl: this.config.baseUrl,
      apiKey: this.config.apiKey,
      sandboxMode: this.config.sandboxMode,
      skipGitRepoCheck: this.config.skipGitRepoCheck,
      model: this.config.reviewerModel,
      reviewerInstructions: this.config.reviewerInstructions,
      approvalSupervisor: this.approvalSupervisor,
      reasoningEffort: this.config.reasoningEffort ?? "high",
    });

    const status = await this.git.getStatusShort();
    const diffStat = await this.git.getDiffStat();
    const remaining = await this.git.listConflictPaths();

    const reviewerPrompt = formatReviewerInput({
      outcomes,
      remoteComparison: remoteComparison ?? null,
      status,
      diffStat,
      remaining,
      validationMode,
      lspDiagnostics: typeof lspDiagnostics === "string" ? lspDiagnostics : null,
    });
    const result = await run(agent, reviewerPrompt);

    return result?.finalOutput ?? null;
  }

  private computeSeverity(conflict: ConflictContext): number {
    const markers = conflict.conflictMarkers ?? 0;
    const lines = conflict.lineCount ?? 0;
    return markers * 10 + lines;
  }

  private isComplex(conflict: ConflictContext): boolean {
    const threshold = this.config.openCodeSeverityThreshold ?? DEFAULT_OPEN_CODE_SEVERITY_THRESHOLD;
    return this.computeSeverity(conflict) >= threshold;
  }

  /**
   * Prioritize config files (YAML, TOML, JSON, etc.) to be resolved first
   * since they're critical infrastructure that other files may depend on
   */
  private prioritizeConfigFiles(conflicts: ConflictContext[]): ConflictContext[] {
    const configExtensions = new Set([
      '.yml',
      '.yaml',
      '.toml',
      '.json',
      '.lock', // package-lock.json, Cargo.lock, etc.
      '.config.js',
      '.config.ts',
    ]);

    const isConfigFile = (path: string): boolean => {
      const lowerPath = path.toLowerCase();
      // Check extensions
      if (Array.from(configExtensions).some((ext) => lowerPath.endsWith(ext))) {
        return true;
      }
      // Check specific config file names
      if (
        lowerPath.includes('package.json') ||
        lowerPath.includes('tsconfig.json') ||
        lowerPath.includes('cargo.toml') ||
        lowerPath.includes('pyproject.toml')
      ) {
        return true;
      }
      return false;
    };

    // Separate config files from non-config files
    const configFiles: ConflictContext[] = [];
    const otherFiles: ConflictContext[] = [];

    for (const conflict of conflicts) {
      if (isConfigFile(conflict.path)) {
        configFiles.push(conflict);
      } else {
        otherFiles.push(conflict);
      }
    }

    // Log prioritization if config files found
    if (configFiles.length > 0) {
      logInfo(
        "worker",
        `Prioritizing ${configFiles.length} config file${configFiles.length !== 1 ? "s" : ""} to resolve first`,
      );
    }

    // Return config files first, then other files
    return [...configFiles, ...otherFiles];
  }

  private async handleConflict(
    conflict: ConflictContext,
    coordinatorPlan: string | null,
    remoteComparison: RemoteComparison | null,
  ): Promise<WorkerOutcome> {
    // Default: Delegate all conflicts to OpenCode with supervisor oversight
    // Supervisor provides multi-turn guidance and feedback
    return await this.runOpenCode(conflict, coordinatorPlan, remoteComparison);
  }

  private async runOpenCode(
    conflict: ConflictContext,
    coordinatorPlan: string | null,
    remoteComparison: RemoteComparison | null,
  ): Promise<WorkerOutcome> {
    logInfo("worker", "Delegating to OpenCode with supervisor oversight", conflict.path);
    // Supervisor uses the smart/expensive model (e.g., gpt-5.1-codex-max)
    const supervisorModel = this.config.workerModelHigh ?? this.config.workerModel;
    // OpenCode uses the cheap/fast model (e.g., claude-sonnet-4-5)
    const openCodeModel = this.config.workerModelLow ?? "anthropic/claude-sonnet-4-5-20250929";
    const outcome = await runOpenCodeResolution(conflict, {
      workingDirectory: this.config.workingDirectory,
      sandboxMode: this.config.sandboxMode,
      approvalSupervisor: this.approvalSupervisor,
      supervisorModel,
      openCodeModel,
      baseUrl: this.config.baseUrl,
      apiKey: this.config.apiKey,
      coordinatorPlan,
      remoteInfo: remoteComparison,
      approvalMode: this.config.approvalMode,
    });

    // Stage the file if conflict markers were successfully removed
    if (outcome.success) {
      try {
        await this.git.stageFile(conflict.path);
        logInfo("worker", `Staged resolved file: ${conflict.path}`, conflict.path);
      } catch (error: any) {
        logWarn("worker", `Failed to stage ${conflict.path}: ${error.message}`, conflict.path);
      }
    }

    const resolved = await this.isResolved(conflict.path);
    return {
      ...outcome,
      success: outcome.success && resolved,
      error: resolved ? outcome.error : "Conflict still present after OpenCode run",
    };
  }

  private async isResolved(conflictPath: string): Promise<boolean> {
    const remaining = await this.git.listConflictPaths();
    return !remaining.includes(conflictPath);
  }

  private async isAllResolved(): Promise<boolean> {
    const remaining = await this.git.listConflictPaths();
    return remaining.length === 0;
  }

  private async collectPostResolutionDiagnostics(resolvedFiles: string[]): Promise<string | null> {
    try {
      logInfo("lsp", `Collecting diagnostics for ${resolvedFiles.length} resolved files...`);

      const lspManager = new LspManager({
        workingDirectory: this.config.workingDirectory,
        waitForDiagnostics: true,
      });

      const diagnostics = await lspManager.collectDiagnostics(resolvedFiles);
      await lspManager.dispose();

      if (diagnostics.length === 0) {
        logInfo("lsp", "No LSP diagnostics found - all files passed validation!");
        return null;
      }

      const summary = formatDiagnosticsWithSummary(diagnostics, this.config.workingDirectory, {
        minSeverity: "warning", // Show warnings and errors, skip info/hints
        maxPerFile: 10,
      });

      logInfo("lsp", `Found diagnostics in ${diagnostics.length} files`);
      return summary;
    } catch (error) {
      logWarn("lsp", `Failed to collect LSP diagnostics: ${error}`);
      return null;
    }
  }

  private buildSupervisor(): { supervisor: ApprovalSupervisor | null; logThread: Thread | null } {
    const model = this.config.supervisorModel ?? this.config.coordinatorModel;
    if (!model) {
      return { supervisor: null, logThread: null };
    }
    try {
      const codex = new Codex({ baseUrl: this.config.baseUrl, apiKey: this.config.apiKey });
      const logThread = codex.startThread({
        model,
        sandboxMode: this.config.sandboxMode,
        approvalMode: this.config.approvalMode,
        workingDirectory: this.config.workingDirectory,
        skipGitRepoCheck: true,
      });
      const supervisor = new ApprovalSupervisor(
        codex,
        {
          model,
          workingDirectory: this.config.workingDirectory,
          sandboxMode: this.config.sandboxMode,
        },
        () => logThread,
      );
      if (!supervisor.isAvailable()) {
        return { supervisor: null, logThread: null };
      }
      return { supervisor, logThread };
    } catch (error) {
      logWarn("supervisor", `Unable to initialize approval supervisor: ${error}`);
      return { supervisor: null, logThread: null };
    }
  }

  private generateTranscript(
    coordinatorPlan: string | null,
    outcomes: WorkerOutcome[],
    reviewerSummary: string | null,
  ): string {
    const parts: string[] = [];

    parts.push("## Coordinator Plan\n");
    parts.push(coordinatorPlan ? coordinatorPlan.slice(0, 500) : "<no plan generated>");

    parts.push("\n\n## Worker Outcomes\n");
    for (const outcome of outcomes) {
      parts.push(`- ${outcome.path}: ${outcome.success ? "✓" : "✗"}`);
      if (outcome.summary) parts.push(` ${outcome.summary.slice(0, 100)}`);
      if (outcome.error) parts.push(` ERROR: ${outcome.error}`);
      parts.push("\n");
    }

    parts.push("\n## Reviewer Summary\n");
    parts.push(reviewerSummary ? reviewerSummary.slice(0, 500) : "<no summary>");

    return parts.join("");
  }

  private shrinkCoordinatorInput(input: CoordinatorInput): CoordinatorInput {
    const truncate = (text: string | null | undefined, max = 2000): string | null => {
      if (!text) return null;
      return text.length > max ? `${text.slice(0, max)}\n\n…truncated` : text;
    };

    const slimConflicts = input.conflicts.map((c) => ({
      path: c.path,
      language: c.language,
      lineCount: c.lineCount,
      conflictMarkers: c.conflictMarkers,
      diffExcerpt: truncate(c.diffExcerpt, 1800),
      workingExcerpt: truncate(c.workingExcerpt, 1200),
      baseExcerpt: null,
      oursExcerpt: null,
      theirsExcerpt: null,
      originRefContent: null,
      upstreamRefContent: null,
      originVsUpstreamDiff: null,
      baseVsOursDiff: null,
      baseVsTheirsDiff: null,
      oursVsTheirsDiff: null,
      recentHistory: null,
      localIntentLog: null,
    }));

    return {
      ...input,
      statusShort: truncate(input.statusShort, 1200) ?? "",
      diffStat: truncate(input.diffStat, 2000) ?? "",
      recentCommits: truncate(input.recentCommits, 1200) ?? "",
      conflicts: slimConflicts,
      remoteComparison: input.remoteComparison
        ? {
            ...input.remoteComparison,
            commitsMissingFromOrigin: truncate(input.remoteComparison.commitsMissingFromOrigin, 800),
            commitsMissingFromUpstream: truncate(input.remoteComparison.commitsMissingFromUpstream, 800),
            diffstatOriginToUpstream: truncate(input.remoteComparison.diffstatOriginToUpstream, 800),
            diffstatUpstreamToOrigin: truncate(input.remoteComparison.diffstatUpstreamToOrigin, 800),
          }
        : null,
    };
  }
}
