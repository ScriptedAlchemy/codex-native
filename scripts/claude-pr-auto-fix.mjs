#!/usr/bin/env node

/**
 * Automation script that monitors open PRs for failing checks and
 * coordinates remediation via Claude Code in headless mode.
 *
 * Requirements:
 *   - GitHub CLI (`gh`) authenticated to the target repository.
 *   - Claude Code CLI (`claude`) available in PATH.
 *
 * Workflow:
 *   1. Stash any local modifications temporarily.
 *   2. Fetch all open PRs.
 *   2. Run `gh pr checks --watch` on each PR concurrently.
 *   3. Collect PRs whose checks fail into a remediation queue.
 *   4. Sequentially process the queue:
 *        a. Checkout the PR branch.
 *        b. Launch Claude Code in headless mode with context about the failure.
 *        c. Ensure changes are committed and pushed.
 *        d. Re-run `gh pr checks` to confirm fixes.
 *
 * The script logs progress and surfaces any remediation failures at the end.
 */

import { spawn } from "node:child_process";
import process from "node:process";
import os from "node:os";

const GH_CMD = process.env.GH_PATH ?? "gh";
const CLAUDE_CMD = process.env.CLAUDE_PATH ?? "claude";
const CONCURRENCY = Math.max(Number.parseInt(process.env.CHECK_CONCURRENCY ?? "", 10) || os.cpus().length, 1);
const MAX_PROMPT_LOG_CHARS = 10_000;

class FailureProcessor {
  #queue = [];
  #processing = false;
  #closed = false;
  #resolveDone;
  #donePromise;

  processed = 0;
  issues = [];

  constructor() {
    this.#donePromise = new Promise((resolve) => {
      this.#resolveDone = resolve;
    });
  }

  enqueueFailure(failure) {
    if (this.#closed) {
      throw new Error("Cannot enqueue failures after processor has been closed");
    }
    this.#queue.push(failure);
    if (!this.#processing) {
      void this.#drain();
    }
  }

  close() {
    this.#closed = true;
    if (!this.#processing && this.#queue.length === 0) {
      this.#resolveDone();
    }
  }

  async done() {
    if (this.#closed && !this.#processing && this.#queue.length === 0) {
      return { processed: this.processed, issues: this.issues };
    }
    await this.#donePromise;
    return { processed: this.processed, issues: this.issues };
  }

  async #drain() {
    if (this.#processing) {
      return;
    }
    this.#processing = true;
    while (this.#queue.length > 0) {
      const failure = this.#queue.shift();
      if (!failure) {
        continue;
      }
      this.processed += 1;
      process.stdout.write(`\n🛠️ Remediating PR #${failure.pr.number} (${failure.pr.title})\n`);
      try {
        await processFailure(failure.pr, `${failure.outcome.stdout}\n${failure.outcome.stderr}`);
      } catch (error) {
        this.issues.push({ pr: failure.pr, error });
        process.stderr.write(
          `❌ Remediation failed for PR #${failure.pr.number}: ${(error && error.message) || error}\n`,
        );
      }
    }
    this.#processing = false;
    if (this.#closed && this.#queue.length === 0) {
      this.#resolveDone();
    }
  }
}

async function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      stderr += `${error.message}\n`;
      resolve({
        command,
        args,
        stdout,
        stderr,
        exitCode: 1,
        error,
      });
    });

    child.on("close", (code) => {
      resolve({
        command,
        args,
        stdout,
        stderr,
        exitCode: code ?? 0,
      });
    });
  });
}

async function fetchOpenPullRequests() {
  const args = ["pr", "list", "--state", "open", "--json", "number,title,headRefName,url"];
  const result = await runCommand(GH_CMD, args);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to fetch open PRs:\n${result.stderr || result.stdout}`);
  }

  try {
    return JSON.parse(result.stdout).map((pr) => ({
      number: pr.number,
      title: pr.title,
      headRefName: pr.headRefName,
      url: pr.url,
    }));
  } catch (error) {
    throw new Error(`Unable to parse gh response: ${(error && error.message) || error}`);
  }
}

async function monitorPrChecks(prs, failureProcessor) {
  const queue = [...prs];
  const workers = [];
  let failureCount = 0;

  async function worker() {
    while (queue.length > 0) {
      const pr = queue.shift();
      if (!pr) {
        break;
      }
      const watchArgs = ["pr", "checks", String(pr.number), "--watch"];
      const outcome = await runCommand(GH_CMD, watchArgs);
      logCheckResult(pr, outcome);
      if (outcome.exitCode !== 0) {
        failureCount += 1;
        failureProcessor.enqueueFailure({ pr, outcome });
      }
    }
  }

  for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i += 1) {
    workers.push(worker());
  }

  await Promise.all(workers);
  failureProcessor.close();
  return { total: prs.length, failures: failureCount };
}

function logCheckResult(pr, outcome) {
  const status = outcome.exitCode === 0 ? "passed" : "failed";
  const icon = outcome.exitCode === 0 ? "✅" : "❌";
  process.stdout.write(`${icon} PR #${pr.number} (${pr.title}) checks ${status}\n`);
  if (outcome.exitCode !== 0) {
    process.stdout.write(`   stderr:\n${indent(outcome.stderr || "(none)")}\n`);
  }
}

function indent(text) {
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? `   ${line}` : line))
    .join("\n");
}

async function stashWorkingTreeIfNeeded() {
  const status = await runCommand("git", ["status", "--porcelain"]);
  if (status.stdout.trim().length === 0) {
    return null;
  }

  process.stdout.write("🧺 Working tree is dirty. Automatically stashing changes before proceeding...\n");
  const stashName = `claude-pr-auto-fix-${Date.now()}`;
  const stashResult = await runCommand("git", ["stash", "push", "-u", "-m", stashName]);
  if (stashResult.exitCode !== 0) {
    throw new Error(`Failed to stash local changes:\n${stashResult.stderr || stashResult.stdout}`);
  }

  const listResult = await runCommand("git", ["stash", "list"]);
  if (listResult.exitCode !== 0) {
    throw new Error(`Unable to verify newly created stash:\n${listResult.stderr || listResult.stdout}`);
  }

  const ref = parseStashReference(listResult.stdout, stashName);
  if (!ref) {
    throw new Error("Stash was created but could not be located. Please recover manually.");
  }

  process.stdout.write(`🧺 Stashed local changes as ${ref}\n`);
  return ref;
}

function parseStashReference(listOutput, message) {
  return listOutput
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const match = line.match(/^(stash@\{\d+\}):\s+(.*)$/);
      if (!match) {
        return null;
      }
      return { ref: match[1], description: match[2] };
    })
    .filter(Boolean)
    .find((entry) => entry.description && entry.description.includes(message))?.ref;
}

async function restoreStash(stashRef) {
  if (!stashRef) {
    return;
  }
  process.stdout.write(`🔄 Restoring stashed work from ${stashRef}\n`);
  const popResult = await runCommand("git", ["stash", "pop", stashRef]);
  if (popResult.exitCode !== 0) {
    throw new Error(`Failed to reapply stashed changes:\n${popResult.stderr || popResult.stdout}`);
  }
}

async function currentBranch() {
  const result = await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (result.exitCode !== 0) {
    throw new Error(`Unable to determine current branch:\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function trimLog(log) {
  if (log.length <= MAX_PROMPT_LOG_CHARS) {
    return log;
  }
  return `${log.slice(-MAX_PROMPT_LOG_CHARS)}\n\n[log truncated to last ${MAX_PROMPT_LOG_CHARS} characters]`;
}

async function runClaudeForFailure(pr, failureLog) {
  const systemPrompt = [
    "You are a senior software engineer tasked with fixing CI failures.",
    "You may run shell commands, git, and gh CLI as needed.",
    "Ensure you are on the correct branch before making changes.",
    "Investigate the failing checks and resolve them.",
    "Run appropriate tests or checks to confirm the fix.",
    "Stage, commit, and push your changes when finished.",
    "Provide a concise summary of what you changed at the end.",
  ].join(" ");

  const userPrompt = [
    `Repository PR: #${pr.number} - ${pr.title} (${pr.url})`,
    `Branch: ${pr.headRefName}`,
    "",
    "The prior run of `gh pr checks --watch` failed with the following output:",
    "```",
    trimLog(failureLog),
    "```",
    "",
    "Please fix the failing checks. If additional context is needed, feel free to rerun `gh pr checks` or other commands. After applying fixes, ensure the branch is pushed.",
  ].join("\n");

  const args = [
    "-p",
    userPrompt,
    "--output-format",
    "json",
    "--append-system-prompt",
    systemPrompt,
    "--allowedTools",
    "Bash,Git,Read,gh",
  ];

  const result = await runCommand(CLAUDE_CMD, args, { env: process.env });
  if (result.exitCode !== 0) {
    throw new Error(`Claude CLI exited with ${result.exitCode}\n${result.stderr || result.stdout}`);
  }
  process.stdout.write(`🧠 Claude response for PR #${pr.number}:\n${indent(result.stdout)}\n`);
}

async function commitAndPushIfNeeded(pr) {
  const diffStatus = await runCommand("git", ["status", "--porcelain"]);
  if (diffStatus.stdout.trim().length > 0) {
    process.stdout.write(`📦 Detected uncommitted changes for PR #${pr.number}, committing...\n`);
    const addResult = await runCommand("git", ["add", "--all"]);
    if (addResult.exitCode !== 0) {
      throw new Error(`Failed to stage changes:\n${addResult.stderr || addResult.stdout}`);
    }

    const commitMessage = `Automated fix for PR #${pr.number}`;
    const commitResult = await runCommand("git", ["commit", "-m", commitMessage]);
    if (commitResult.exitCode !== 0) {
      throw new Error(`Failed to commit changes:\n${commitResult.stderr || commitResult.stdout}`);
    }
  }

  await pushCurrentBranch(pr);
}

async function pushCurrentBranch(pr) {
  const branch = await currentBranch();
  const pushResult = await runCommand("git", ["push"]);
  if (pushResult.exitCode === 0) {
    process.stdout.write(`🚀 Pushed fixes for PR #${pr.number} on ${branch}\n`);
    return;
  }

  const upstreamMatch = /set the remote as upstream/i.test(pushResult.stderr);
  if (upstreamMatch) {
    const setUpstream = await runCommand("git", ["push", "--set-upstream", "origin", branch]);
    if (setUpstream.exitCode !== 0) {
      throw new Error(`Failed to push with upstream for branch ${branch}:\n${setUpstream.stderr || setUpstream.stdout}`);
    }
    process.stdout.write(`🚀 Pushed fixes for PR #${pr.number} (new upstream ${branch})\n`);
    return;
  }

  throw new Error(`Failed to push changes:\n${pushResult.stderr || pushResult.stdout}`);
}

async function rerunChecks(pr) {
  const result = await runCommand(GH_CMD, ["pr", "checks", String(pr.number), "--watch"]);
  if (result.exitCode !== 0) {
    process.stdout.write(`⚠️ Unable to rerun checks for PR #${pr.number}:\n${indent(result.stderr || result.stdout)}\n`);
    return false;
  }
  process.stdout.write(`🔁 Post-fix checks for PR #${pr.number}:\n${indent(result.stdout)}\n`);
  return true;
}

async function restoreBranch(originalBranch) {
  const result = await runCommand("git", ["checkout", originalBranch]);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to restore original branch ${originalBranch}:\n${result.stderr || result.stdout}`);
  }
}

async function checkoutPr(pr) {
  const result = await runCommand(GH_CMD, ["pr", "checkout", String(pr.number)]);
  if (result.exitCode !== 0) {
    throw new Error(`Unable to checkout PR #${pr.number}:\n${result.stderr || result.stdout}`);
  }
}

async function processFailure(pr, failureLog) {
  const startingBranch = await currentBranch();
  try {
    await checkoutPr(pr);
    await runClaudeForFailure(pr, failureLog);
    await commitAndPushIfNeeded(pr);
    await rerunChecks(pr);
  } finally {
    await restoreBranch(startingBranch);
  }
}

async function main() {
  let stashRef = null;
  try {
    stashRef = await stashWorkingTreeIfNeeded();
    const prs = await fetchOpenPullRequests();
    if (prs.length === 0) {
      process.stdout.write("🎉 No open pull requests found.\n");
      return;
    }
    process.stdout.write(`🔍 Monitoring ${prs.length} open PR(s) with concurrency ${CONCURRENCY}\n`);

    const failureProcessor = new FailureProcessor();
    const monitorSummary = await monitorPrChecks(prs, failureProcessor);
    const remediationSummary = await failureProcessor.done();

    if (monitorSummary.failures === 0) {
      process.stdout.write("✅ All PR checks passed. No remediation needed.\n");
      return;
    }

    if (remediationSummary.processed === 0) {
      process.stderr.write("⚠️ Failures detected, but remediation queue was empty. Please investigate manually.\n");
      process.exitCode = 1;
      return;
    }

    if (remediationSummary.issues.length > 0) {
      process.stderr.write("\n❗ Summary of remediation failures:\n");
      for (const { pr, error } of remediationSummary.issues) {
        process.stderr.write(`   - PR #${pr.number} (${pr.title}): ${(error && error.message) || error}\n`);
      }
      process.exitCode = 1;
      return;
    }

    process.stdout.write("\n🎉 All failing PRs have been processed and pushed.\n");
  } catch (error) {
    process.stderr.write(`Unhandled error: ${(error && error.message) || error}\n`);
    process.exitCode = 1;
  } finally {
    if (stashRef) {
      try {
        await restoreStash(stashRef);
      } catch (stashError) {
        process.stderr.write(
          `⚠️ Unable to restore stashed work (${stashRef}). Please recover manually:\n${
            (stashError && stashError.message) || stashError
          }\n`,
        );
        process.exitCode = 1;
      }
    }
  }
}

await main();


