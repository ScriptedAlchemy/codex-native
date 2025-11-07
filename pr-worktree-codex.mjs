#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { Codex } from "@codex-native/sdk";

const DEFAULT_REMOTE = "origin";
const DEFAULT_CONCURRENCY = Math.max(os.cpus().length - 1, 1);

async function main() {
  const config = await buildConfig();

  await ensureBinaryAvailable("git");
  await ensureBinaryAvailable("gh");
  await ensureBinaryAvailable("pnpm");

  await fs.mkdir(config.worktreeRoot, { recursive: true });

  const prs = await listOpenPullRequests(config);
  if (prs.length === 0) {
    console.log("No open pull requests detected. Nothing to do.");
    return;
  }

  console.log(`Discovered ${prs.length} open pull request${prs.length === 1 ? "" : "s"}.`);

  const existingWorktrees = await getExistingWorktreePaths(config.repoRoot);
  const gitMutex = createMutex();
  const installMutex = createMutex();
  const codex = new Codex();

  const results = await runWithConcurrency(prs, config.concurrency, async (pr) => {
    const safeSlug = slugifyRef(pr.headRefName) || `head-${pr.number}`;
    const worktreeDir = `pr-${pr.number}-${safeSlug}`;
    const worktreePath = path.join(config.worktreeRoot, worktreeDir);
    const remoteRef = `refs/remotes/${config.remote}/pr-worktree/${pr.number}`;
    let createdWorktree = false;

    try {
      await gitMutex.run(async () => {
        await runCommand("git", [
          "fetch",
          "--force",
          config.remote,
          `pull/${pr.number}/head:${remoteRef}`,
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
            "--detach",
            worktreePath,
            remoteRef,
          ], { cwd: config.repoRoot });
          existingWorktrees.add(worktreePath);
          console.log(`[PR ${pr.number}] Created worktree at ${worktreePath}`);
          createdWorktree = true;
        } else {
          await runCommand("git", ["reset", "--hard", remoteRef], { cwd: worktreePath });
          await runCommand("git", ["clean", "-fdx"], { cwd: worktreePath });
          console.log(`[PR ${pr.number}] Refreshed existing worktree at ${worktreePath}`);
        }
      });
    } catch (error) {
      console.error(`[PR ${pr.number}] Failed to prepare worktree:`, error);
      return { pr, worktreePath, error };
    }

    const needsInstall = createdWorktree || !(await pathExists(path.join(worktreePath, "node_modules")));

    if (needsInstall) {
      try {
        console.log(`[PR ${pr.number}] Running pnpm install...`);
        await installMutex.run(async () => {
          await runCommand("pnpm", ["install"], { cwd: worktreePath });
        });
      } catch (error) {
        console.error(`[PR ${pr.number}] pnpm install failed:`, error);
        return { pr, worktreePath, error };
      }
    }

    if (config.dryRun) {
      console.log(`[PR ${pr.number}] Dry run enabled; skipping Codex automation.`);
      return { pr, worktreePath };
    }

    try {
      const thread = codex.startThread({
        workingDirectory: worktreePath,
        sandboxMode: "workspace-write",
        fullAuto: true,
      });

      const prompt = buildAgentPrompt(pr, worktreePath);
      console.log(`[PR ${pr.number}] Starting Codex turn...`);

      const turn = await thread.run(prompt);

      console.log(`[PR ${pr.number}] Codex summary:`);
      console.log(turn.finalResponse.trim());

      return { pr, worktreePath, turn };
    } catch (error) {
      console.error(`[PR ${pr.number}] Codex automation failed:`, error);
      return { pr, worktreePath, error };
    }
  });

  summarizeResults(results);
}

async function buildConfig() {
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

  return { repoRoot, worktreeRoot, concurrency, remote, dryRun };
}

function printUsage() {
  console.log(`Usage: node pr-worktree-codex.mjs [options]

Options:
  --repo <path>            Override repository root (default: current directory)
  --worktree-root <path>   Directory to place PR worktrees (default: ../codex-pr-worktrees)
  --remote <name>          Remote to fetch pull requests from (default: origin)
  --concurrency <n>        Maximum concurrent Codex runs (default: cpu count - 1)
  --dry-run                Prepare worktrees without invoking Codex
  --help                   Show this message
`);
}

async function ensureBinaryAvailable(binary) {
  try {
    await runCommand(binary, ["--version"]);
  } catch (error) {
    throw new Error(`Required binary '${binary}' is not available in PATH`);
  }
}

async function listOpenPullRequests(config) {
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

  return parsed.map((entry) => ({
    number: entry.number,
    title: entry.title,
    headRefName: entry.headRefName,
    headRepository: entry.headRepository ?? null,
    headRepositoryOwner: entry.headRepositoryOwner ?? null,
    url: entry.url,
  }));
}

async function getExistingWorktreePaths(repoRoot) {
  const { stdout } = await runCommand("git", ["worktree", "list", "--porcelain"], { cwd: repoRoot });

  const blocks = stdout.split(/\n(?=worktree )/).map((block) => block.trim()).filter(Boolean);
  const paths = new Set();

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
  let chain = Promise.resolve();
  return {
    run(fn) {
      const next = chain.then(() => fn());
      chain = next.catch(() => {});
      return next;
    },
  };
}

async function runWithConcurrency(items, concurrency, handler) {
  if (items.length === 0) {
    return [];
  }

  const effectiveConcurrency = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array(items.length);
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

function slugifyRef(ref) {
  return ref.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function buildAgentPrompt(pr, worktreePath) {
  return [
    `You are an automated Codex maintainer responsible for validating pull request #${pr.number}.`,
    `The worktree directory is ${worktreePath}.`,
    `Tasks:`,
    "1. Run 'gh pr checks " + pr.number + "' to gather CI status.",
    "2. Investigate and fix any failures using the available repository tools.",
    "3. Re-run 'gh pr checks " + pr.number + "' after applying fixes.",
    "4. Summarize the resulting status and any manual follow-ups required.",
    "Always operate from the repository root, use shell commands responsibly, and include test results in the summary.",
  ].join("\n");
}

async function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      ...options,
    }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function summarizeResults(results) {
  const successes = [];
  const failures = [];

  for (const result of results) {
    if (!result) {
      continue;
    }

    if (result.error) {
      const message = result.error instanceof Error ? result.error.message : String(result.error);
      failures.push({ number: result.pr.number, message });
    } else {
      successes.push(result.pr.number);
    }
  }

  console.log("\n=== Summary ===");

  if (successes.length) {
    console.log(`Codex processed PRs: ${successes.join(", ")}`);
  }

  if (failures.length) {
    console.log("Failures:");
    for (const failure of failures) {
      console.log(`- PR ${failure.number}: ${failure.message}`);
    }
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});


