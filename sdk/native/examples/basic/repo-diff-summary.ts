#!/usr/bin/env -S pnpm dlx tsx
/**
 * Example: Repo Diff Summary via Codex Native SDK
 *
 * Demonstrates how to call the Rust-backed collectRepoDiffSummary helper from Node.
 *
 * Usage:
 *   pnpm dlx tsx sdk/native/examples/basic/repo-diff-summary.ts [repoPath?]
 *
 * Environment variables:
 *   CX_BASE_BRANCH   - optional override for base branch (default: detected upstream or main)
 *   CX_MAX_FILES     - optional integer limit of files to fetch
 */

import path from "node:path";
import process from "node:process";

import { collectRepoDiffSummary } from "@codex-native/sdk";

async function main(): Promise<void> {
  const repoCandidate = process.argv[2]
    ? path.resolve(process.argv[2]!)
    : process.cwd();
  const baseBranchOverride = process.env.CX_BASE_BRANCH;
  const maxFiles = parseInt(process.env.CX_MAX_FILES ?? "", 10);

  const summary = await collectRepoDiffSummary({
    cwd: repoCandidate,
    baseBranchOverride,
    maxFiles: Number.isFinite(maxFiles) && maxFiles > 0 ? maxFiles : undefined,
  });

  console.log("\n📁 Repo:", summary.repoPath);
  console.log("🌿 Branch:", summary.branch, "->", summary.baseBranch);
  console.log("🔗 Merge base:", summary.mergeBase);
  if (summary.upstreamRef) {
    console.log("↗️  Upstream ref:", summary.upstreamRef);
  }

  console.log("\n== git status -sb ==\n" + summary.statusSummary);
  console.log("\n== git diff --stat ==\n" + summary.diffStat);
  console.log("\n== recent commits ==\n" + summary.recentCommits);

  console.log(`\nChanged files (showing ${summary.changedFiles.length} of ${summary.totalChangedFiles})`);
  summary.changedFiles.forEach((file, index) => {
    console.log(`\n[${index + 1}] ${file.status} ${file.path}`);
    if (file.previousPath) {
      console.log(`    renamed from ${file.previousPath}`);
    }
    console.log(file.truncated ? `${file.diff}\n(truncated)` : file.diff);
  });
}

void main().catch((error) => {
  console.error("Failed to collect diff summary:", error);
  process.exitCode = 1;
});
