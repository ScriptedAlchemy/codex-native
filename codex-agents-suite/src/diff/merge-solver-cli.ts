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

function assertGitRepo(cwd: string): void {
  const gitPath = path.join(cwd, ".git");
  if (!fs.existsSync(gitPath)) {
    throw new Error(`No git repository found at ${cwd}`);
  }
}

async function main(): Promise<void> {
  try {
    const cwd = process.cwd();
    assertGitRepo(cwd);
    const solver = new MergeConflictSolver(createDefaultSolverConfig(cwd));
    await solver.run();
  } catch (error) {
    console.error("merge-solver-cli failed:", error);
    process.exitCode = 1;
  }
}

void main();
