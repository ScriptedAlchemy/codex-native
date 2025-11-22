#!/usr/bin/env node

/**
 * Merge Conflict Solver CLI
 *
 * Lightweight wrapper so you can run the merge workflow directly from any git
 * repo via:
 *
 *   pnpm exec tsx codex-agents-suite/src/diff/merge-solver-cli.ts
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { createDefaultSolverConfig, MergeConflictSolver } from "./merge-conflict-solver.js";
import { GitRepo } from "./merge/git.js";

function assertGitRepo(cwd: string): void {
  const gitPath = path.join(cwd, ".git");
  if (!fs.existsSync(gitPath)) {
    throw new Error(`No git repository found at ${cwd}`);
  }
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  assertGitRepo(cwd);

  const git = new GitRepo(cwd);
  let shouldAbortOnFailure = true;
  let cleanupRunning = false;

  const abortMergeIfNeeded = async (reason: string): Promise<void> => {
    if (!shouldAbortOnFailure || cleanupRunning) {
      return;
    }
    cleanupRunning = true;
    try {
      if (await git.isMergeInProgress()) {
        console.error(`[merge-solver-cli] ${reason}; aborting in-progress merge to reset state...`);
        await git.runGit(["merge", "--abort"], true);
        console.error("[merge-solver-cli] Merge aborted.");
      }
    } catch (abortError) {
      console.error("[merge-solver-cli] Failed to abort merge:", abortError);
    } finally {
      cleanupRunning = false;
    }
  };

  const exitOnSignal = (signal: NodeJS.Signals): void => {
    void (async () => {
      await abortMergeIfNeeded(`Received ${signal}`);
      process.exit(1);
    })();
  };
  process.once("SIGINT", () => exitOnSignal("SIGINT"));
  process.once("SIGTERM", () => exitOnSignal("SIGTERM"));
  process.once("uncaughtException", (err) => {
    console.error("merge-solver-cli failed with uncaught exception:", err);
    void (async () => {
      await abortMergeIfNeeded("Uncaught exception");
      process.exit(1);
    })();
  });
  process.once("unhandledRejection", (reason) => {
    console.error("merge-solver-cli failed with unhandled rejection:", reason);
    void (async () => {
      await abortMergeIfNeeded("Unhandled rejection");
      process.exit(1);
    })();
  });
  process.once("beforeExit", (code) => {
    void abortMergeIfNeeded(`Process exiting (code ${code ?? 0}) with merge still in progress`);
  });

  try {
    const solver = new MergeConflictSolver(createDefaultSolverConfig(cwd));
    await solver.run();
    const mergeActive = await git.isMergeInProgress();
    const remainingConflicts = await git.listConflictPaths();
    if (!mergeActive && remainingConflicts.length === 0) {
      shouldAbortOnFailure = false;
    } else {
      const conflictMsg =
        remainingConflicts.length > 0
          ? `${remainingConflicts.length} conflicted file${remainingConflicts.length === 1 ? "" : "s"}`
          : "merge still in progress";
      await abortMergeIfNeeded(
        `Solver completed but left ${conflictMsg}; cleaning up to restore a clean working tree`,
      );
      shouldAbortOnFailure = false;
    }
  } catch (error) {
    console.error("merge-solver-cli failed:", error);
    process.exitCode = 1;
  } finally {
    if (process.exitCode && process.exitCode !== 0) {
      await abortMergeIfNeeded("CLI exited with an error");
    }
  }
}

void main();
