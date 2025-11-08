#!/usr/bin/env node

import { execFile } from "node:child_process";
import type { ChildProcess, ExecFileException, ExecFileOptions } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { Codex, type SandboxMode, type Thread, type ThreadEvent, type ThreadItem, type ThreadOptions, type Usage } from "@codex-native/sdk";
type CommandResult = { stdout: string; stderr: string };
type CommandWithOutputResult = { stdout: string; stderr: string; exitCode: number };
type CommandError = ExecFileException & {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
};

interface RunCommandWithOutputOptions extends ExecFileOptions {
  onStdout?: (chunk: Buffer | string) => void;
  onStderr?: (chunk: Buffer | string) => void;
}

interface PushStatus {
  success: boolean;
  skipped: boolean;
  reason: string;
  source?: string;
  error?: unknown;
}

interface GhChecksResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

interface RunConfig {
  repoRoot: string;
  worktreeRoot: string;
  concurrency: number;
  remote: string;
  dryRun: boolean;
  repoSlug: string | null;
  repoOwner: string | null;
  maxFixAttempts: number;
}

type CodexTurnSummary = {
  finalResponse: string;
  items: ThreadItem[];
  usage: Usage | null;
};

type MergeVerification = {
  state?: string;
  error?: unknown;
};

type RunResult = {
  pr: PullRequestInfo;
  worktreePath: string;
  localBranch?: string;
  mergeTurn?: CodexTurnSummary;
  fixTurns?: CodexTurnSummary[];
  pushAllowed?: boolean;
  pushStatuses?: PushStatus[];
  ghChecks?: GhChecksResult;
  mergePrTurn?: CodexTurnSummary | null;
  prMerged?: boolean;
  mergeVerification?: MergeVerification | null;
  buildFixTurns?: CodexTurnSummary[];
  dryRun?: boolean;
  error?: unknown;
};

type PushOutcome = PushStatus & { pr: PullRequestInfo };

type CleanupOutcome = {
  path: string;
  success: boolean;
  error?: unknown;
};

type BuildErrorDetails = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  message: string;
};

type ThreadKind = "build" | "merge" | "fix" | "merge_pr";

type ThreadRegistryRecord = Partial<Record<ThreadKind, string>>;

type ThreadRegistryData = Record<string, ThreadRegistryRecord>;

interface PullRequestInfo {
  number: number;
  title: string;
  headRefName: string;
  headRepositoryOwnerLogin: string | null;
  headRepositoryName: string | null;
  url: string;
}

const DEFAULT_REMOTE = "origin";
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_FIX_ATTEMPTS = 3;
const THREAD_REGISTRY_FILENAME = ".codex-pr-threads.json";
const activeProcesses = new Set<ChildProcess>();

function registerProcess(child: ChildProcess) {
  activeProcesses.add(child);
  child.on("exit", () => activeProcesses.delete(child));
  return child;
}

function cleanupAllProcesses() {
  for (const child of activeProcesses) {
    try {
      child.kill("SIGTERM");
    } catch (error) {
      // Ignore errors during cleanup
    }
  }
  activeProcesses.clear();
}

function escapeForAppleScriptPath(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

process.on("SIGINT", () => {
  console.log("\nReceived SIGINT, cleaning up...");
  cleanupAllProcesses();
  process.exit(130);
});

process.on("SIGTERM", () => {
  console.log("\nReceived SIGTERM, cleaning up...");
  cleanupAllProcesses();
  process.exit(143);
});

const THREAD_KIND_VALUES: ThreadKind[] = ["build", "merge", "fix", "merge_pr"];

const THREAD_KIND_LABELS: Record<ThreadKind, string> = {
  build: "build remediation",
  merge: "merge preparation",
  fix: "remediation",
  merge_pr: "PR merge",
};

class ThreadRegistry {
  private readonly filePath: string;
  private data: ThreadRegistryData = {};
  private loaded = false;
  private loadingPromise: Promise<void> | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async initialize(): Promise<void> {
    await this.ensureLoaded();
  }

  async get(prNumber: number, kind: ThreadKind): Promise<string | null> {
    await this.ensureLoaded();
    const key = String(prNumber);
    return this.data[key]?.[kind] ?? null;
  }

  async set(prNumber: number, kind: ThreadKind, threadId: string): Promise<void> {
    if (!threadId) {
      return;
    }
    await this.runExclusive(async () => {
      await this.ensureLoaded();
      const key = String(prNumber);
      if (!this.data[key]) {
        this.data[key] = {};
      }
      this.data[key]![kind] = threadId;
      await this.persist();
    });
  }

  async clear(prNumber: number, kind?: ThreadKind): Promise<void> {
    await this.runExclusive(async () => {
      await this.ensureLoaded();
      const key = String(prNumber);
      const record = this.data[key];
      if (!record) {
        return;
      }
      if (kind) {
        delete record[kind];
        if (Object.keys(record).length === 0) {
          delete this.data[key];
        }
      } else {
        delete this.data[key];
      }
      await this.persist();
    });
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    if (this.loadingPromise) {
      await this.loadingPromise;
      return;
    }
    this.loadingPromise = (async () => {
      try {
        const contents = await fs.readFile(this.filePath, "utf8");
        this.data = this.normalizeData(JSON.parse(contents));
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code !== "ENOENT") {
          console.warn(`Failed to load Codex thread registry at ${this.filePath}: ${error instanceof Error ? error.message : String(error)}`);
        }
        this.data = {};
      }
      this.loaded = true;
    })();
    await this.loadingPromise;
  }

  private normalizeData(value: unknown): ThreadRegistryData {
    if (!value || typeof value !== "object") {
      return {};
    }
    const normalized: ThreadRegistryData = {};
    for (const [prNumber, recordValue] of Object.entries(value as Record<string, unknown>)) {
      if (!recordValue || typeof recordValue !== "object") {
        continue;
      }
      const record: ThreadRegistryRecord = {};
      for (const kind of THREAD_KIND_VALUES) {
        const threadId = (recordValue as Record<string, unknown>)[kind];
        if (typeof threadId === "string" && threadId.trim()) {
          record[kind] = threadId;
        }
      }
      if (Object.keys(record).length > 0) {
        normalized[prNumber] = record;
      }
    }
    return normalized;
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(this.data, null, 2)}\n`);
  }

  private runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = this.writeChain.then(() => fn());
    this.writeChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

type ThreadAcquisitionParams = {
  codex: Codex;
  registry: ThreadRegistry;
  prNumber: number;
  kind: ThreadKind;
  prefix: string;
  makeThreadOptions: () => ThreadOptions;
};

async function acquireThreadForKind(params: ThreadAcquisitionParams): Promise<Thread> {
  const { codex, registry, prNumber, kind, makeThreadOptions } = params;
  const existingId = await registry.get(prNumber, kind);
  if (existingId) {
    try {
      console.log(`🔄 [PR ${prNumber}] Resuming ${THREAD_KIND_LABELS[kind]} thread`);
      return codex.resumeThread(existingId, makeThreadOptions());
    } catch (error) {
      console.log(`⚠️  [PR ${prNumber}] Failed to resume thread, starting new one`);
      await clearThreadIdWithWarning(registry, prNumber, kind);
    }
  }

  console.log(`🆕 [PR ${prNumber}] Starting new ${THREAD_KIND_LABELS[kind]} thread`);
  return codex.startThread(makeThreadOptions());
}

async function persistThreadIdWithWarning(
  registry: ThreadRegistry,
  prNumber: number,
  kind: ThreadKind,
  threadId: string | null,
): Promise<void> {
  if (!threadId) {
    return;
  }
  try {
    await registry.set(prNumber, kind, threadId);
  } catch (error) {
    console.log(`⚠️  [PR ${prNumber}] Warning: failed to persist thread id: ${formatErrorMessage(error)}`);
  }
}

async function clearThreadIdWithWarning(
  registry: ThreadRegistry,
  prNumber: number,
  kind: ThreadKind,
): Promise<void> {
  try {
    await registry.clear(prNumber, kind);
  } catch (error) {
    console.log(`⚠️  [PR ${prNumber}] Warning: failed to clear thread id: ${formatErrorMessage(error)}`);
  }
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function main() {
  const config = await buildConfig();

  await ensureBinaryAvailable("git");
  await ensureBinaryAvailable("gh");
  await ensureBinaryAvailable("pnpm");

  await fs.mkdir(config.worktreeRoot, { recursive: true });
  const threadRegistryPath = path.join(config.repoRoot, THREAD_REGISTRY_FILENAME);
  const threadRegistry = new ThreadRegistry(threadRegistryPath);
  await threadRegistry.initialize();

  const prs = await listOpenPullRequests(config);
  if (prs.length === 0) {
    console.log("🎉 No open pull requests detected. Nothing to do.");
    return;
  }

  console.log(`🔍 Processing ${prs.length} open pull request${prs.length === 1 ? "" : "s"} with concurrency ${config.concurrency}`);

  const existingWorktrees = await getExistingWorktreePaths(config.repoRoot);
  const createdWorktrees = new Set<string>();
  const gitMutex = createMutex();
  const installMutex = createMutex();

  const results = await runWithConcurrency<PullRequestInfo, RunResult>(prs, config.concurrency, async (pr) => {
    const safeSlug = slugifyRef(pr.headRefName) || `head-${pr.number}`;
    const worktreeDir = `pr-${pr.number}-${safeSlug}`;
    const worktreePath = path.join(config.worktreeRoot, worktreeDir);
    const fetchRef = `pull/${pr.number}/head`;
    const localBranch = pr.headRefName;
    let createdWorktree = false;

    const basePrefix = formatPrefix(pr);
    const pushAllowed = isPushAllowed(pr, config);
    const pushStatuses: PushStatus[] = pushAllowed
      ? []
      : [{ success: false, skipped: true, reason: "push-not-allowed", source: "pre" }];
    const buildFixTurns: CodexTurnSummary[] = [];

    try {
      await gitMutex.run(async () => {
        await runCommand("git", [
          "fetch",
          "--force",
          config.remote,
          `+${fetchRef}:refs/remotes/${config.remote}/${pr.headRefName}`,
        ], { cwd: config.repoRoot });

        const knownWorktree = existingWorktrees.has(worktreePath);
        const pathAlreadyExists = await pathExists(worktreePath);

        if (!knownWorktree && pathAlreadyExists) {
          // Remove stale directory so worktree add succeeds.
          await fs.rm(worktreePath, { recursive: true, force: true });
        }

        if (!knownWorktree) {
          await runCommand("git", [
            "worktree",
            "add",
            "--force",
            "-B",
            localBranch,
            worktreePath,
            `refs/remotes/${config.remote}/${pr.headRefName}`,
          ], { cwd: config.repoRoot });
          existingWorktrees.add(worktreePath);
          createdWorktrees.add(worktreePath);
          console.log(`✓ [PR ${pr.number}] Created worktree`);
          createdWorktree = true;
        } else {
          await runCommand("git", ["reset", "--hard", `refs/remotes/${config.remote}/${pr.headRefName}`], { cwd: worktreePath });
          await runCommand("git", ["clean", "-fdx"], { cwd: worktreePath });
          console.log(`✓ [PR ${pr.number}] Refreshed worktree`);
        }

        await runCommand("git", ["branch", `--set-upstream-to=${config.remote}/${pr.headRefName}`, localBranch], { cwd: worktreePath });
      });
    } catch (error) {
      console.error(`[PR ${pr.number}] Failed to prepare worktree:`, error);
      return { pr, worktreePath, error };
    }

    try {
      await runCommand("git", ["fetch", config.remote, "main"], { cwd: worktreePath });
    } catch (error) {
      console.warn(`[PR ${pr.number}] Warning: failed to fetch ${config.remote}/main: ${formatCommandError(error)}`);
    }

    const needsInstall = createdWorktree || !(await pathExists(path.join(worktreePath, "node_modules")));
    let codexInstance: Codex | null = null;
    const ensureCodexInstance = () => {
      if (!codexInstance) {
        codexInstance = new Codex();
      }
      return codexInstance;
    };

    if (needsInstall) {
      try {
        console.log(`📦 [PR ${pr.number}] Running pnpm install...`);
        await installMutex.run(async () => {
          await runCommand("pnpm", ["install"], { cwd: worktreePath });
        });
        console.log(`✓ [PR ${pr.number}] Installation complete`);
      } catch (error) {
        console.error(`❌ [PR ${pr.number}] pnpm install failed:`, error);
        return { pr, worktreePath, error };
      }
    }

    const runBuildAll = async (): Promise<BuildErrorDetails | null> => {
      console.log(`🔨 [PR ${pr.number}] Building sdk...`);
      try {
        await runCommand("pnpm", ["run", "sdk:build"], { cwd: worktreePath });
        console.log(`✓ [PR ${pr.number}] Build completed successfully`);
        return null;
      } catch (error) {
        const commandError = error as Partial<CommandError> & { code?: number };
        const stdout = normalizeCommandOutput(commandError.stdout);
        const stderr = normalizeCommandOutput(commandError.stderr);
        const exitCode = typeof commandError.exitCode === "number"
          ? commandError.exitCode
          : commandError.code ?? null;
        const message = commandError.message ?? (error instanceof Error ? error.message : String(error));
        console.log(`❌ [PR ${pr.number}] Build failed (exit ${exitCode ?? "unknown"})`);
        return { stdout, stderr, exitCode, message };
      }
    };

    let buildError = await runBuildAll();
    let buildAttempts = 0;

    while (buildError && !config.dryRun && buildAttempts < config.maxFixAttempts) {
      buildAttempts += 1;
      const codex = ensureCodexInstance();
      const sandboxMode: SandboxMode = "danger-full-access";
      const makeThreadOptions = (): ThreadOptions => ({
        workingDirectory: worktreePath,
        sandboxMode,
        skipGitRepoCheck: true,
      });
      const buildPrefix = `${basePrefix} [build#${buildAttempts}]`;
      const buildThread = await acquireThreadForKind({
        codex,
        registry: threadRegistry,
        prNumber: pr.number,
        kind: "build",
        prefix: buildPrefix,
        makeThreadOptions,
      });
      const buildPrompt = buildBuildFailurePrompt(pr, worktreePath, buildError, buildAttempts);
      console.log(`\n🛠️  [PR ${pr.number}] Build remediation attempt #${buildAttempts}`);
      console.log(`────────────────────────────────────────────────────────────────────────────────`);
      let buildFixTurn: CodexTurnSummary;
      try {
        buildFixTurn = await runCodexTurnWithLogging(buildThread, buildPrompt, buildPrefix);
      } finally {
        await persistThreadIdWithWarning(threadRegistry, pr.number, "build", buildThread.id);
      }
      buildFixTurns.push(buildFixTurn);
      console.log(`\n📝 Build remediation summary:`);
      console.log(buildFixTurn.finalResponse.trim());
      logTurnHighlights(buildPrefix, buildFixTurn.items);

      if (pushAllowed) {
        try {
          await ensurePushed(pr, worktreePath, config.remote, localBranch);
          pushStatuses.push({ success: true, skipped: false, reason: `post-build-${buildAttempts}`, source: "build" });
          console.log(`🚀 [PR ${pr.number}] Pushed build fixes`);
        } catch (pushError) {
          pushStatuses.push({ success: false, skipped: false, reason: `post-build-${buildAttempts}-failed`, source: "build", error: pushError });
          console.log(`❌ [PR ${pr.number}] Push failed: ${formatCommandError(pushError)}`);
        }
      } else {
        console.log(`⚠️  [PR ${pr.number}] Push unavailable (external fork)`);
      }

      buildError = await runBuildAll();
    }

    if (buildError) {
      console.log(`⚠️  [PR ${pr.number}] Build still failing after ${buildAttempts} attempt(s)`);
    }

    if (config.dryRun) {
      console.log(`🏃 [PR ${pr.number}] Dry run mode; skipping automation`);
      return { pr, worktreePath, dryRun: true };
    }

    try {
      const codex = ensureCodexInstance();
      const sandboxMode: SandboxMode = "danger-full-access";

      const makeThreadOptions = (): ThreadOptions => ({
        workingDirectory: worktreePath,
        sandboxMode,
        skipGitRepoCheck: true,
      });

      const mergePrefix = `${basePrefix} [merge]`;
      const mergeThread = await acquireThreadForKind({
        codex,
        registry: threadRegistry,
        prNumber: pr.number,
        kind: "merge",
        prefix: mergePrefix,
        makeThreadOptions,
      });
      const mergePrompt = buildMergePrompt(pr, worktreePath);
      console.log(`\n🔀 [PR ${pr.number}] Merging main branch`);
      console.log(`────────────────────────────────────────────────────────────────────────────────`);
      let mergeTurn: CodexTurnSummary;
      try {
        mergeTurn = await runCodexTurnWithLogging(mergeThread, mergePrompt, mergePrefix);
      } finally {
        await persistThreadIdWithWarning(threadRegistry, pr.number, "merge", mergeThread.id);
      }

      console.log(`\n📝 Merge summary:`);
      console.log(mergeTurn.finalResponse.trim());
      logTurnHighlights(mergePrefix, mergeTurn.items);

      const newExamples = await detectNewExamples(worktreePath, config.remote);

      let ghChecksResult = await runGhPrChecks(pr, worktreePath, basePrefix);

      const fixTurns: CodexTurnSummary[] = [];
      let mergePrTurn: CodexTurnSummary | null = null;
      let prMerged = false;
      let mergeVerification: MergeVerification | null = null;

      if (pushAllowed) {
        try {
          await ensurePushed(pr, worktreePath, config.remote, localBranch);
          pushStatuses.push({ success: true, skipped: false, reason: "post-merge", source: "merge" });
          console.log(`🚀 [PR ${pr.number}] Pushed merge changes`);
        } catch (pushError) {
          pushStatuses.push({ success: false, skipped: false, reason: "post-merge-failed", source: "merge", error: pushError });
          console.log(`❌ [PR ${pr.number}] Push failed: ${formatCommandError(pushError)}`);
          throw pushError;
        }
      } else {
        console.log(`⚠️  [PR ${pr.number}] Push unavailable (external fork)`);
      }

      let attempts = 0;
      while (!ghChecksResult.success && attempts < config.maxFixAttempts) {
        attempts += 1;

        const fixPrefix = `${basePrefix} [checks#${attempts}]`;
        const fixThread = await acquireThreadForKind({
          codex,
          registry: threadRegistry,
          prNumber: pr.number,
          kind: "fix",
          prefix: fixPrefix,
          makeThreadOptions,
        });
        const fixPrompt = buildFixPrompt(pr, worktreePath, newExamples, ghChecksResult, attempts);
        console.log(`\n🛠️  [PR ${pr.number}] CI remediation attempt #${attempts}`);
        console.log(`────────────────────────────────────────────────────────────────────────────────`);

        let fixTurn: CodexTurnSummary;
        try {
          fixTurn = await runCodexTurnWithLogging(fixThread, fixPrompt, fixPrefix);
        } finally {
          await persistThreadIdWithWarning(threadRegistry, pr.number, "fix", fixThread.id);
        }
        fixTurns.push(fixTurn);

        console.log(`\n📝 Remediation summary:`);
        console.log(fixTurn.finalResponse.trim());
        logTurnHighlights(fixPrefix, fixTurn.items);

        if (pushAllowed) {
          try {
            await ensurePushed(pr, worktreePath, config.remote, localBranch);
            pushStatuses.push({ success: true, skipped: false, reason: `post-fix-${attempts}`, source: "fix" });
            console.log(`🚀 [PR ${pr.number}] Pushed CI fixes`);
          } catch (pushError) {
            pushStatuses.push({ success: false, skipped: false, reason: `post-fix-${attempts}-failed`, source: "fix", error: pushError });
            console.log(`❌ [PR ${pr.number}] Push failed: ${formatCommandError(pushError)}`);
            throw pushError;
          }
        } else {
          console.log(`⚠️  [PR ${pr.number}] Push unavailable (external fork)`);
        }

        ghChecksResult = await runGhPrChecks(pr, worktreePath, basePrefix);
      }

      if (!ghChecksResult.success) {
        console.log(`⚠️  [PR ${pr.number}] CI checks still failing after ${attempts} attempt(s)`);
      } else if (!pushAllowed) {
        console.log(`✅ [PR ${pr.number}] CI checks passed (manual merge required for external fork)`);
      } else {
        console.log(`✅ [PR ${pr.number}] CI checks passed; preparing to merge`);

        const mergePrPrefix = `${basePrefix} [pr-merge]`;
        const mergePrThread = await acquireThreadForKind({
          codex,
          registry: threadRegistry,
          prNumber: pr.number,
          kind: "merge_pr",
          prefix: mergePrPrefix,
          makeThreadOptions,
        });
        const mergePrPrompt = buildPrMergePrompt(pr, worktreePath);
        console.log(`\n🎯 [PR ${pr.number}] Merging pull request`);
        console.log(`────────────────────────────────────────────────────────────────────────────────`);

        try {
          mergePrTurn = await runCodexTurnWithLogging(mergePrThread, mergePrPrompt, mergePrPrefix);
        } finally {
          await persistThreadIdWithWarning(threadRegistry, pr.number, "merge_pr", mergePrThread.id);
        }

        console.log(`\n📝 PR merge summary:`);
        console.log(mergePrTurn.finalResponse.trim());
        logTurnHighlights(mergePrPrefix, mergePrTurn.items);

        try {
          const { stdout } = await runCommand("gh", [
            "pr",
            "view",
            String(pr.number),
            "--json",
            "state",
            "--jq",
            ".state",
          ], { cwd: worktreePath });
          const state = stdout.trim();
          mergeVerification = { state };
          if (state && state.toUpperCase() === "MERGED") {
            prMerged = true;
            console.log(`🎉 [PR ${pr.number}] Successfully merged!`);
          } else {
            console.log(`⚠️  [PR ${pr.number}] Post-merge state: ${state || "unknown"}`);
          }
        } catch (verifyError) {
          mergeVerification = { error: verifyError };
          console.log(`❌ [PR ${pr.number}] Failed to verify merge: ${formatCommandError(verifyError)}`);
        }
      }

      return {
        pr,
        worktreePath,
        localBranch,
        mergeTurn,
        fixTurns,
        pushAllowed,
        pushStatuses,
        ghChecks: ghChecksResult,
        mergePrTurn,
        prMerged,
        mergeVerification,
        buildFixTurns,
      };
    } catch (error) {
      console.error(`[PR ${pr.number}] Codex automation failed:`, error);
      return { pr, worktreePath, error, buildFixTurns };
    }
  });

  const pushOutcomes: PushOutcome[] = [];
  for (const result of results) {
    if (!result || result.error || result.dryRun) {
      continue;
    }

    if (Array.isArray(result.pushStatuses) && result.pushStatuses.length > 0) {
      for (const status of result.pushStatuses) {
        if (status.reason === "push-not-allowed") {
          console.log(`[PR ${result.pr.number}] Push skipped (head repository owner differs from ${config.repoOwner ?? "origin owner"}).`);
        }
        pushOutcomes.push({ pr: result.pr, ...status });
      }
      continue;
    }

    if (!result.pushAllowed) {
      console.log(`[PR ${result.pr.number}] Push skipped (head repository owner differs from ${config.repoOwner ?? "origin owner"}).`);
      pushOutcomes.push({ pr: result.pr, success: false, skipped: true, reason: "push-not-allowed" });
      continue;
    }

    try {
      const localBranch = result.localBranch ?? result.pr.headRefName;
      await ensurePushed(result.pr, result.worktreePath, config.remote, localBranch);
      pushOutcomes.push({ pr: result.pr, success: true, skipped: false, reason: "post-run", source: "post" });
    } catch (error) {
      pushOutcomes.push({ pr: result.pr, success: false, skipped: false, reason: "post-run-failed", source: "post", error });
      console.error(`[PR ${result.pr.number}] Post-run push failed:`, error);
    }
  }

  const cleanupOutcomes: CleanupOutcome[] = [];
  for (const worktreePath of createdWorktrees) {
    try {
      if (process.platform === "darwin") {
        const escapedPath = escapeForAppleScriptPath(worktreePath);
        await runCommand("osascript", [
          "-e",
          `tell application "Finder" to delete POSIX file "${escapedPath}"`,
        ]);
      } else {
        const trashPath = path.join(os.tmpdir(), `codex-worktree-trash-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        await fs.rename(worktreePath, trashPath);
        fs.rm(trashPath, { recursive: true, force: true }).catch(() => {});
      }
      await runCommand("git", ["worktree", "prune"], { cwd: config.repoRoot });
      cleanupOutcomes.push({ path: worktreePath, success: true });
    } catch (error) {
      cleanupOutcomes.push({ path: worktreePath, success: false, error });
      console.error(`Failed to clean worktree ${worktreePath}:`, error);
    }
  }

  summarizeResults(results, pushOutcomes, cleanupOutcomes);
}

async function buildConfig(): Promise<RunConfig> {
  const args = process.argv.slice(2);
  let repoRoot = process.cwd();
  let worktreeRoot = path.resolve(repoRoot, "..", "codex-pr-worktrees");
  let concurrency = DEFAULT_CONCURRENCY;
  let remote = DEFAULT_REMOTE;
  let dryRun = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case "--repo": {
        const value = args[i + 1];
        if (!value) {
          throw new Error("--repo flag requires a path argument");
        }
        repoRoot = path.resolve(value);
        i += 1;
        break;
      }
      case "--worktree-root": {
        const value = args[i + 1];
        if (!value) {
          throw new Error("--worktree-root flag requires a path argument");
        }
        worktreeRoot = path.resolve(value);
        i += 1;
        break;
      }
      case "--concurrency": {
        const value = Number(args[i + 1]);
        if (!Number.isFinite(value) || value <= 0) {
          throw new Error("--concurrency flag requires a positive integer");
        }
        concurrency = Math.floor(value);
        i += 1;
        break;
      }
      case "--remote": {
        const value = args[i + 1];
        if (!value) {
          throw new Error("--remote flag requires a remote name");
        }
        remote = value;
        i += 1;
        break;
      }
      case "--dry-run":
        dryRun = true;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      default:
        if (arg.startsWith("-")) {
          console.warn(`Unknown option ${arg} (ignored).`);
        }
        break;
    }
  }

  const repoSlug = await resolveRepoSlug(repoRoot, remote);
  const repoOwner = repoSlug ? repoSlug.split("/")[0] : null;

  const maxFixAttemptsEnv = process.env.CODEX_PR_WORKTREE_MAX_FIX_ATTEMPTS;
  const maxFixAttempts = maxFixAttemptsEnv ? Number(maxFixAttemptsEnv) : DEFAULT_MAX_FIX_ATTEMPTS;

  const resolvedMaxFixAttempts = Number.isFinite(maxFixAttempts) && maxFixAttempts > 0
    ? Math.floor(maxFixAttempts)
    : DEFAULT_MAX_FIX_ATTEMPTS;

  return { repoRoot, worktreeRoot, concurrency, remote, dryRun, repoSlug, repoOwner, maxFixAttempts: resolvedMaxFixAttempts };
}

function printUsage() {
  console.log(`Usage:
  pnpm pr [options]
  pnpm dlx tsx pr-worktree-codex.ts [options]

Options:
  --repo <path>            Override repository root (default: current directory)
  --worktree-root <path>   Directory to place PR worktrees (default: ../codex-pr-worktrees)
  --remote <name>          Remote to fetch pull requests from (default: origin)
  --concurrency <n>        Maximum concurrent Codex runs (default: cpu count - 1)
  --dry-run                Prepare worktrees without invoking Codex
  --help                   Show this message
`);
}

async function ensureBinaryAvailable(binary: string) {
  try {
    await runCommand(binary, ["--version"]);
  } catch (error) {
    throw new Error(`Required binary '${binary}' is not available in PATH`);
  }
}

async function listOpenPullRequests(config: RunConfig): Promise<PullRequestInfo[]> {
  const jsonFields = [
    "number",
    "title",
    "headRefName",
    "headRepository",
    "headRepositoryOwner",
    "url",
  ];

  const args = [
    "pr",
    "list",
    "--state",
    "open",
    "--limit",
    "200",
    "--json",
    jsonFields.join(","),
  ];

  const { stdout } = await runCommand("gh", args, { cwd: config.repoRoot });
  const parsed = JSON.parse(stdout);

  return parsed.map((entry: any) => ({
    number: entry.number,
    title: entry.title,
    headRefName: entry.headRefName,
    headRepositoryOwnerLogin: entry.headRepositoryOwner?.login ?? null,
    headRepositoryName: entry.headRepository?.name ?? null,
    url: entry.url,
  }));
}

async function getExistingWorktreePaths(repoRoot: string): Promise<Set<string>> {
  const { stdout } = await runCommand("git", ["worktree", "list", "--porcelain"], { cwd: repoRoot });

  const blocks = stdout.split(/\n(?=worktree )/).map((block) => block.trim()).filter(Boolean);
  const paths = new Set<string>();

  for (const block of blocks) {
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) {
        const worktreePath = line.substring("worktree ".length).trim();
        paths.add(path.resolve(worktreePath));
      }
    }
  }

  return paths;
}

function createMutex() {
  let chain: Promise<void> = Promise.resolve();
  return {
    run<T>(fn: () => Promise<T> | T): Promise<T> {
      const next = chain.then(() => fn());
      chain = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
}

async function runWithConcurrency<T, R>(items: T[], concurrency: number, handler: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const effectiveConcurrency = Math.max(1, Math.min(concurrency, items.length));
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (true) {
      const currentIndex = index;
      index += 1;
      if (currentIndex >= items.length) {
        break;
      }
      results[currentIndex] = await handler(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: effectiveConcurrency }, () => worker());
  await Promise.all(workers);
  return results;
}

function slugifyRef(ref: string): string {
  return ref.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function buildMergePrompt(pr: PullRequestInfo, worktreePath: string): string {
  return [
    `You are a Codex automation agent working inside ${worktreePath}.`,
    "First, ensure the branch is fully up to date with the latest main branch.",
    "Steps:",
    "1. Run 'git status' to confirm the working tree is clean (resolve or stash anything unexpected).",
    "2. Fetch the latest main branch with 'git fetch origin main'.",
    "3. Merge main into this branch with 'git merge origin/main'. If conflicts arise, resolve them yourself: open the conflicting files, remove conflict markers, preserve both sides as appropriate, re-run 'git status' to verify all conflicts are cleared, and use 'git add' plus 'git merge --continue' to complete the merge.",
    "4. After resolving conflicts, run appropriate builds/tests if necessary to ensure the merged result is healthy.",
    "5. Commit the merge (or conflict resolutions) with a clear message if new commits are created.",
    "6. Review 'git status' for any staged or unstaged files (even if they pre-existed the merge work); commit everything that should live on the branch so the tree is clean.",
    "7. Push the branch back to its remote (git push) so that CI sees the latest work.",
    "8. Provide a brief summary of the merge result, calling out any conflicts you resolved and tests you ran.",
  ].join("\n");
}

function buildFixPrompt(
  pr: PullRequestInfo,
  worktreePath: string,
  examplePaths: string[] = [],
  ghChecksResult: GhChecksResult | null = null,
  attemptNumber = 1,
): string {
  const instructions = [
    `You are an automated Codex maintainer responsible for validating pull request #${pr.number}.`,
    `The worktree directory is ${worktreePath}.`,
    `Tasks:`,
    `Remediation attempt #${attemptNumber}: address any failing CI checks thoroughly.`,
    "1. Run 'gh pr checks --watch " + pr.number + "' from the repository root to monitor CI failures until they are resolved.",
    "2. Investigate failing checks, apply fixes, and commit the necessary changes with clear messages.",
    "3. Push your commits back to the PR branch (" + pr.headRefName + ") once checks succeed.",
    "4. Provide a final summary including CI status, tests executed, and any remaining manual actions.",
    "Use shell commands responsibly and ensure no failing checks remain before finishing.",
    "If any 'package-lock.json' files (or other lockfiles from npm/yarn) are present, delete them so that pnpm stays the sole package manager.",
  ];

  if (examplePaths.length > 0) {
    instructions.push("Detected new example files:");
    for (const example of examplePaths) {
      instructions.push(`- ${example}`);
    }
    instructions.push("Before running any examples, build the native SDK by executing 'pnpm run sdk:build'. If the build fails, fix the issues and rerun until it succeeds.");
    instructions.push("For each new example, run it (e.g. 'pnpm exec tsx <path>' or the appropriate command) and fix any issues until it succeeds; do not mock or fake success.");
    instructions.push("Ensure the example works without requiring users to set custom API keys or secrets; rely on the built-in Codex authentication that is already logged in.");
  }

  if (ghChecksResult && !ghChecksResult.success) {
    instructions.push("Previous automated run of 'gh pr checks --watch " + pr.number + "' failed with the following output:");
    if (ghChecksResult.stdout) {
      instructions.push("--- stdout ---");
      instructions.push(ghChecksResult.stdout.trim());
    }
    if (ghChecksResult.stderr) {
      instructions.push("--- stderr ---");
      instructions.push(ghChecksResult.stderr.trim());
    }
    instructions.push("Investigate these failures, apply the necessary fixes, rerun the checks, and confirm they pass.");
  }

  return instructions.join("\n");
}

function buildBuildFailurePrompt(
  pr: PullRequestInfo,
  worktreePath: string,
  error: BuildErrorDetails,
  attemptNumber: number,
): string {
  const sections = [
    `You are an automated Codex maintainer addressing a build failure for pull request #${pr.number}.`,
    `Working directory: ${worktreePath}.`,
    `Command failing: pnpm run sdk:build`,
    `Attempt #: ${attemptNumber}.`,
    "Tasks:",
    "1. Investigate why 'pnpm run sdk:build' failed.",
    "2. Apply code changes or dependency updates necessary to fix the build.",
    "3. Re-run 'pnpm run sdk:build' until it succeeds.",
    "4. Commit the fixes with clear messages and ensure the working tree is clean.",
    "5. Provide a concise summary of the fix, including tests or commands executed.",
  ];

  if (error.exitCode !== null) {
    sections.push(`Previous run exit code: ${error.exitCode}.`);
  }

  if (error.stdout.trim()) {
    sections.push("--- pnpm run sdk:build stdout ---");
    sections.push(error.stdout.trim());
  }

  if (error.stderr.trim()) {
    sections.push("--- pnpm run sdk:build stderr ---");
    sections.push(error.stderr.trim());
  }

  sections.push("Do not skip rerunning the build; keep iterating until it passes.");

  return sections.join("\n");
}

function buildPrMergePrompt(pr: PullRequestInfo, worktreePath: string): string {
  return [
    `You are an automated Codex maintainer finalizing pull request #${pr.number}.`,
    `The worktree directory is ${worktreePath}.`,
    "All required checks have passed. Merge this pull request into the main branch using the GitHub CLI.",
    "Steps:",
    "1. Run 'git status -sb' to ensure there are no uncommitted changes left over from earlier automation.",
    "2. Confirm the pull request is still open with 'gh pr view " + pr.number + " --json state --jq .state'. If it is already merged or closed, stop and report.",
    "3. Merge the pull request using 'gh pr merge " + pr.number + " --merge --delete-branch --confirm'.",
    "4. If the merge command fails, investigate, resolve the issue (for example by syncing main again), and retry until the merge succeeds or you can explain why it cannot be merged.",
    "5. After merging, verify the PR state is MERGED and report the merge commit URL or number.",
    "Provide a concise summary of the merge outcome and any follow-up actions.",
  ].join("\n");
}

async function ensurePushed(pr: PullRequestInfo, worktreePath: string, remote: string, localBranch: string): Promise<void> {
  await runCommand("git", ["add", "-A"], { cwd: worktreePath });

  try {
    await runCommand("git", ["commit", "-m", `chore: codex fixes for PR #${pr.number}`], { cwd: worktreePath });
  } catch (error) {
    if (!isNothingToCommit(error)) {
      throw error;
    }
  }

  try {
    await runCommand("git", ["push", remote, localBranch], { cwd: worktreePath });
  } catch (error) {
    throw error;
  }
}

function isNothingToCommit(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const stdout = normalizeCommandOutput((error as Partial<CommandError>).stdout);
  const stderr = normalizeCommandOutput((error as Partial<CommandError>).stderr);
  return /nothing to commit/i.test(`${stderr}${stdout}`);
}

function formatPrefix(pr: PullRequestInfo): string {
  return `[PR ${pr.number}]`;
}

function logTurnHighlights(prefix: string, items: ThreadItem[]) {
  if (!items || items.length === 0) {
    return;
  }
  const summary = summarizeTurnItems(items);
  if (summary.commands.length > 0) {
    console.log(formatCommandSummary(summary.commands));
  }
  if (summary.toolCalls.length > 0) {
    console.log(formatToolSummary(summary.toolCalls));
  }
  if (summary.filesChanged > 0) {
    console.log(`📄 Files changed: ${summary.filesChanged}`);
  }
}

type CommandExecutionSummary = {
  command: string;
  status?: string;
};

type ToolCallSummary = {
  server?: string | null;
  tool?: string | null;
  status?: string | null;
};

type TurnItemsSummary = {
  commands: CommandExecutionSummary[];
  toolCalls: ToolCallSummary[];
  filesChanged: number;
};

function summarizeTurnItems(items: ThreadItem[]): TurnItemsSummary {
  const summary: TurnItemsSummary = { commands: [], toolCalls: [], filesChanged: 0 };
  for (const item of items) {
    switch (item.type) {
      case "command_execution":
        if (typeof item.command === "string") {
          summary.commands.push({ command: item.command, status: item.status });
        }
        break;
      case "mcp_tool_call":
        summary.toolCalls.push({ server: item.server, tool: item.tool, status: item.status });
        break;
      case "file_change":
        if (Array.isArray((item as { changes?: unknown[] }).changes)) {
          summary.filesChanged += (item as { changes?: unknown[] }).changes?.length ?? 0;
        }
        break;
      default:
        break;
    }
  }
  return summary;
}

function formatCommandSummary(commands: CommandExecutionSummary[]): string {
  const aggregate = new Map<string, { command: string; status?: string; priority: number }>();
  for (const entry of commands) {
    const command = entry.command.trim();
    if (!command) {
      continue;
    }
    const prioritized = aggregate.get(command);
    const priority = statusPriority(entry.status);
    if (!prioritized || priority > prioritized.priority) {
      aggregate.set(command, { command, status: entry.status, priority });
    }
  }
  const formatted = Array.from(aggregate.values())
    .sort((a, b) => a.command.localeCompare(b.command))
    .map((entry) => `${statusSymbol(entry.status)} ${entry.command}`);
  return `Commands (${formatted.length}): ${formatted.join(', ')}`;
}

function formatToolSummary(toolCalls: ToolCallSummary[]): string {
  const aggregate = new Map<string, { label: string; status?: string; priority: number }>();
  for (const entry of toolCalls) {
    const label = [entry.server, entry.tool].filter(Boolean).join("::") || "tool";
    const priority = statusPriority(entry.status);
    const existing = aggregate.get(label);
    if (!existing || priority > existing.priority) {
      aggregate.set(label, { label, status: entry.status ?? undefined, priority });
    }
  }
  const formatted = Array.from(aggregate.values())
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((entry) => `${statusSymbol(entry.status)} ${entry.label}`);
  return `Tools (${formatted.length}): ${formatted.join(', ')}`;
}

function statusPriority(status?: string | null): number {
  switch (status) {
    case "failed":
    case "error":
      return 3;
    case "completed":
      return 2;
    case "in_progress":
      return 1;
    default:
      return 0;
  }
}

function statusSymbol(status?: string | null): string {
  switch (status) {
    case "completed":
      return "✓";
    case "failed":
    case "error":
      return "✖";
    case "in_progress":
      return "…";
    default:
      return "•";
  }
}

function normalizeCommandOutput(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }
  if (Buffer.isBuffer(output)) {
    return output.toString("utf8");
  }
  if (output === null || output === undefined) {
    return "";
  }
  if (typeof output === "object" && typeof (output as { toString: unknown }).toString === "function") {
    try {
      return (output as { toString: () => string }).toString();
    } catch {
      return String(output);
    }
  }
  return String(output);
}

function formatCommandError(error: unknown): string {
  if (!error || typeof error !== "object") {
    return normalizeCommandOutput(error);
  }

  const commandError = error as Partial<CommandError> & { message?: string };
  const stderr = normalizeCommandOutput(commandError.stderr);
  const stdout = normalizeCommandOutput(commandError.stdout);
  const message = commandError.message ?? (error instanceof Error ? error.message : "");

  return [stderr, stdout, message].filter((part) => part.length > 0).join(" ") || "unknown error";
}

function isPushAllowed(pr: PullRequestInfo, config: RunConfig): boolean {
  const repoOwner = config.repoOwner;
  if (!repoOwner) {
    return true;
  }
  const prOwner = pr.headRepositoryOwnerLogin;
  if (!prOwner) {
    return true;
  }
  return prOwner.toLowerCase() === repoOwner.toLowerCase();
}

async function detectNewExamples(worktreePath: string, remote: string): Promise<string[]> {
  try {
    const { stdout } = await runCommand("git", ["diff", "--name-status", `${remote}/main...HEAD`], { cwd: worktreePath });
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/\s+/))
      .filter(([status, file]) => status === "A" && file?.startsWith("sdk/native/examples/"))
      .map(([, file]) => file);
  } catch (error) {
    console.warn(`Failed to detect new examples: ${formatCommandError(error)}`);
    return [];
  }
}

async function runCodexTurnWithLogging(thread: Thread, prompt: string, prefix: string) {
  const { events } = await thread.runStreamed(prompt);
  const items = new Map<string, ThreadItem>();
  let finalResponse = "";
  let usage: Usage | null = null;

  try {
    for await (const event of events) {
      handleEventLogging(event, prefix);

      switch (event.type) {
        case "item.started":
        case "item.updated":
        case "item.completed":
          if (event.item) {
            items.set(event.item.id, event.item);
            if (event.item.type === "agent_message") {
              finalResponse = event.item.text;
            }
          }
          break;
        case "turn.completed":
          usage = event.usage ?? null;
          break;
        case "turn.failed":
          throw new Error(event.error?.message ?? "Codex turn failed");
        case "error":
          throw new Error(event.message ?? "Codex stream error");
        default:
          break;
      }
    }
  } catch (error) {
    logWithPrefix(prefix, `Codex stream aborted: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }

  return {
    finalResponse,
    items: Array.from(items.values()),
    usage,
  };
}

function handleEventLogging(event: ThreadEvent, prefix: string) {
  switch (event.type) {
    case "thread.started":
      console.log(`🔗 Session: ${event.thread_id.slice(0, 8)}`);
      break;
    case "turn.started":
      // Suppress verbose turn started messages
      break;
    case "turn.completed":
      console.log(`${formatUsage(event.usage)}`);
      break;
    case "turn.failed":
      console.log(`❌ Turn failed: ${event.error?.message ?? "unknown error"}`);
      break;
    case "item.started":
      logItemEvent("started", event.item);
      break;
    case "item.updated":
      // Suppress verbose item updates
      break;
    case "item.completed":
      logItemEvent("completed", event.item);
      break;
    case "error":
      console.log(`❌ Stream error: ${event.message}`);
      break;
    case "exited_review_mode":
      console.log(`🔄 Exited review mode`);
      break;
    default:
      break;
  }
}

function formatUsage(usage: Usage | null) {
  if (!usage) {
    return "✓ Turn completed";
  }
  return `✓ Turn completed (in=${usage.input_tokens ?? 0}, cached=${usage.cached_input_tokens ?? 0}, out=${usage.output_tokens ?? 0})`;
}

function logItemEvent(phase: string, item?: ThreadItem) {
  if (!item) {
    return;
  }

  switch (item.type) {
    case "agent_message":
      if (phase === "started" && item.text) {
        console.log(`💭 ${truncate(item.text, 150)}`);
      }
      break;
    case "command_execution":
      if (phase === "started") {
        console.log(`🔧 Bash: ${item.command}`);
      } else if (phase === "completed") {
        if (item.status === "failed" || item.status === "error") {
          console.log(`❌ Tool error: ${item.command}`);
        } else {
          console.log(`✓ Tool completed`);
        }
      }
      break;
    case "file_change":
      if (phase === "completed") {
        console.log(`✓ File changes: ${item.changes.length} file(s)`);
      }
      break;
    case "mcp_tool_call":
      if (phase === "started") {
        console.log(`🔧 ${item.server}::${item.tool}`);
      } else if (phase === "completed") {
        if (item.status === "failed" || item.status === "error") {
          console.log(`❌ Tool error: ${item.server}::${item.tool}`);
        } else {
          console.log(`✓ Tool completed`);
        }
      }
      break;
    case "todo_list":
      if (phase === "completed") {
        console.log(`✓ Todo list: ${item.items.length} item(s)`);
      }
      break;
    case "error":
      console.log(`❌ Error: ${item.message}`);
      break;
    case "web_search":
      if (phase === "started") {
        console.log(`🔍 Web search: ${item.query}`);
      } else if (phase === "completed") {
        console.log(`✓ Search completed`);
      }
      break;
    default:
      break;
  }
}

function truncate(text: string | undefined, maxLength: number) {
  if (!text || text.length <= maxLength) {
    return text ?? "";
  }
  return `${text.slice(0, maxLength)}…`;
}

async function runCommand(command: string, args: string[] = [], options: ExecFileOptions = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      ...options,
    }, (error, stdout, stderr) => {
      const stdoutText = normalizeCommandOutput(stdout);
      const stderrText = normalizeCommandOutput(stderr);
      if (error) {
        const commandError = error as CommandError;
        commandError.stdout = stdoutText;
        commandError.stderr = stderrText;
        reject(commandError);
        return;
      }
      resolve({ stdout: stdoutText, stderr: stderrText });
    });
    registerProcess(child);
  });
}

async function runCommandWithOutput(
  command: string,
  args: string[] = [],
  options: RunCommandWithOutputOptions = {},
): Promise<CommandWithOutputResult> {
  return new Promise((resolve, reject) => {
    const { onStdout, onStderr, ...execOptions } = options;
    const child = execFile(command, args, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      ...execOptions,
    }, (error, stdout, stderr) => {
      const stdoutText = normalizeCommandOutput(stdout);
      const stderrText = normalizeCommandOutput(stderr);
      if (error) {
        const commandError = error as CommandError;
        commandError.stdout = stdoutText;
        commandError.stderr = stderrText;
        commandError.exitCode = typeof error.code === "number" ? error.code : null;
        reject(commandError);
        return;
      }
      resolve({ stdout: stdoutText, stderr: stderrText, exitCode: 0 });
    });

    registerProcess(child);

    if (onStdout && child.stdout) {
      child.stdout.on("data", onStdout);
    }

    if (onStderr && child.stderr) {
      child.stderr.on("data", onStderr);
    }
  });
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function isGhAuthenticated(): Promise<boolean> {
  try {
    await runCommand("gh", ["auth", "status"], {});
    return true;
  } catch (error) {
    return false;
  }
}

async function runGhPrChecks(pr: PullRequestInfo, worktreePath: string, basePrefix: string): Promise<GhChecksResult> {
  // Check if gh is authenticated first
  const isAuthenticated = await isGhAuthenticated();
  if (!isAuthenticated) {
    console.log(`⚠️  [PR ${pr.number}] Skipping CI checks (gh not authenticated)`);
    return {
      success: false,
      stdout: "",
      stderr: "gh CLI not authenticated",
      exitCode: null
    };
  }

  console.log(`🔍 [PR ${pr.number}] Watching CI checks...`);

  try {
      const result = await runCommandWithOutput("gh", [
        "pr",
        "checks",
        "--watch",
        "--interval",
        "90",
        String(pr.number),
      ], {
      cwd: worktreePath,
      onStdout: (data) => {
        const text = typeof data === "string" ? data : data.toString();
        if (text.trim()) process.stdout.write(text);
      },
      onStderr: (data) => {
        const text = typeof data === "string" ? data : data.toString();
        if (text.trim()) process.stderr.write(text);
      },
    });

    console.log(`✅ [PR ${pr.number}] CI checks passed`);
    return { success: true, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
  } catch (error) {
    const commandError = error as Partial<CommandError> & { code?: number };
    const stdout = normalizeCommandOutput(commandError.stdout);
    const stderr = normalizeCommandOutput(commandError.stderr);
    const exitCode = typeof commandError.exitCode === "number" ? commandError.exitCode : commandError.code ?? null;
    console.log(`❌ [PR ${pr.number}] CI checks failed (exit ${exitCode ?? "unknown"})`);
    return { success: false, stdout, stderr, exitCode };
  }
}

async function resolveRepoSlug(repoRoot: string, remote: string): Promise<string | null> {
  try {
    const { stdout } = await runCommand("git", ["remote", "get-url", remote], { cwd: repoRoot });
    const url = stdout.trim();
    const slug = parseRepoSlug(url);
    if (slug) {
      return slug;
    }
  } catch (error) {
    console.warn(`Warning: failed to resolve remote URL for ${remote}: ${formatCommandError(error)}`);
  }

  try {
    const { stdout } = await runCommand("gh", ["repo", "view", "--json", "nameWithOwner"], { cwd: repoRoot });
    const parsed = JSON.parse(stdout);
    if (parsed?.nameWithOwner) {
      return parsed.nameWithOwner;
    }
  } catch (error) {
    console.warn(`Warning: failed to query repo slug via gh: ${formatCommandError(error)}`);
  }

  return null;
}

function parseRepoSlug(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }

  const sshMatch = url.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }

  const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  return null;
}

function summarizeResults(results: RunResult[], pushOutcomes: PushOutcome[], cleanupOutcomes: CleanupOutcome[]): void {
  const agentSuccesses: number[] = [];
  const agentFailures: { number: number; message: string }[] = [];
  const dryRuns: number[] = [];
  const ghFailures: { number: number; output: { stdout: string; stderr: string; exitCode: number | null } }[] = [];
  const mergedPrs: number[] = [];
  const mergeIssues: { number: number; message: string }[] = [];
  const remediationAttempts: { number: number; attempts: number }[] = [];
  const buildAttempts: { number: number; attempts: number }[] = [];

  for (const result of results) {
    if (!result) {
      continue;
    }

    if (result.dryRun) {
      dryRuns.push(result.pr.number);
    } else if (result.error) {
      const message = result.error instanceof Error ? result.error.message : String(result.error);
      agentFailures.push({ number: result.pr.number, message });
    } else {
      agentSuccesses.push(result.pr.number);
      if (result.ghChecks && !result.ghChecks.success) {
        ghFailures.push({ number: result.pr.number, output: { stdout: result.ghChecks.stdout, stderr: result.ghChecks.stderr, exitCode: result.ghChecks.exitCode } });
      }
      if (Array.isArray(result.buildFixTurns) && result.buildFixTurns.length > 0) {
        buildAttempts.push({ number: result.pr.number, attempts: result.buildFixTurns.length });
      }
      if (Array.isArray(result.fixTurns) && result.fixTurns.length > 0) {
        mergeIssues.push({
          number: result.pr.number,
          message: `Remediation attempts: ${result.fixTurns.length}`,
        });
      }
      if (Array.isArray(result.fixTurns) && result.fixTurns.length > 0) {
        remediationAttempts.push({ number: result.pr.number, attempts: result.fixTurns.length });
      }

      if (result.mergePrTurn) {
        if (result.prMerged) {
          mergedPrs.push(result.pr.number);
        } else {
          const mergeMessage = result.mergeVerification?.error
            ? (result.mergeVerification.error instanceof Error
                ? result.mergeVerification.error.message
                : String(result.mergeVerification.error))
            : `state=${result.mergeVerification?.state ?? "unknown"}`;
          mergeIssues.push({ number: result.pr.number, message: mergeMessage });
        }
      }
    }
  }

  console.log("\n=== Summary ===");

  if (agentSuccesses.length) {
    console.log(`Codex processed PRs: ${agentSuccesses.join(", ")}`);
  }

  if (dryRuns.length) {
    console.log(`Dry run only (no Codex execution): ${dryRuns.join(", ")}`);
  }

  if (agentFailures.length) {
    console.log("Codex failures:");
    for (const failure of agentFailures) {
      console.log(`- PR ${failure.number}: ${failure.message}`);
    }
  }

  if (ghFailures.length) {
    console.log("gh pr checks failures (before Codex remediation):");
    for (const failure of ghFailures) {
      console.log(`- PR ${failure.number}: exit ${failure.output.exitCode ?? "unknown"}`);
    }
  }

  if (mergedPrs.length) {
    console.log(`PRs merged automatically: ${mergedPrs.join(", ")}`);
  }

  if (buildAttempts.length) {
    console.log("PRs requiring build remediation attempts:");
    for (const entry of buildAttempts) {
      console.log(`- PR ${entry.number}: ${entry.attempts} attempt(s)`);
    }
  }

  if (remediationAttempts.length) {
    console.log("PRs requiring remediation attempts:");
    for (const entry of remediationAttempts) {
      console.log(`- PR ${entry.number}: ${entry.attempts} attempt(s)`);
    }
  }

  if (mergeIssues.length) {
    console.log("PR merge verification issues:");
    for (const issue of mergeIssues) {
      console.log(`- PR ${issue.number}: ${issue.message}`);
    }
  }

  const pushFailures = pushOutcomes.filter((outcome) => !outcome.success && !outcome.skipped);
  const pushSkipped = pushOutcomes.filter((outcome) => outcome.skipped);
  if (pushFailures.length) {
    console.log("Push failures:");
    for (const failure of pushFailures) {
      const message = failure.error instanceof Error ? failure.error.message : String(failure.error);
      console.log(`- PR ${failure.pr.number}: ${message}`);
    }
  }

  if (pushSkipped.length) {
    console.log("Push skipped:");
    for (const skipped of pushSkipped) {
      const reasonText = skipped.reason ? ` (${skipped.reason})` : "";
      console.log(`- PR ${skipped.pr.number}${reasonText}`);
    }
  }

  const cleanupFailures = cleanupOutcomes.filter((outcome) => !outcome.success);
  if (cleanupFailures.length) {
    console.log("Cleanup failures:");
    for (const failure of cleanupFailures) {
      const message = failure.error instanceof Error ? failure.error.message : String(failure.error);
      console.log(`- ${failure.path}: ${message}`);
    }
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
