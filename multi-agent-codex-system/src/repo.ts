import { spawnSync } from "node:child_process";
import type { CommandResult, PrStatusSummary, RepoContext, StatusCheck } from "./types.js";
import { FALLBACK_BASE_BRANCH, MAX_CONTEXT_CHARS, MAX_CONTEXT_LINES } from "./constants.js";

function runCommand(cmd: string, args: string[], cwd: string): CommandResult {
  try {
    const result = spawnSync(cmd, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      code: result.status ?? 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch (error) {
    return { code: -1, stdout: "", stderr: String(error) };
  }
}

function limitText(input: string, maxLines = MAX_CONTEXT_LINES, maxChars = MAX_CONTEXT_CHARS): string {
  if (!input) return "";
  const lines = input.split(/\r?\n/);
  const trimmed = lines.slice(0, maxLines).join("\n");
  if (trimmed.length <= maxChars) {
    return trimmed.trimEnd();
  }
  return `${trimmed.slice(0, maxChars - 3)}...`;
}

function detectBaseBranch(cwd: string, override?: string): string {
  if (override) return override;
  const upstream = runCommand("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd);
  if (upstream.code === 0) {
    const value = upstream.stdout.trim();
    const slash = value.lastIndexOf("/");
    return slash === -1 ? value : value.slice(slash + 1);
  }
  return FALLBACK_BASE_BRANCH;
}

function collectRepoContext(cwd: string, baseOverride?: string): RepoContext {
  const branch = runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd).stdout.trim() || "unknown";
  const baseBranch = detectBaseBranch(cwd, baseOverride);
  const statusSummary = limitText(runCommand("git", ["status", "-sb"], cwd).stdout || "<no status>");
  const diffStat = limitText(runCommand("git", ["--no-pager", "diff", "--stat"], cwd).stdout || "<no diff>");
  const diffSample = limitText(runCommand("git", ["--no-pager", "diff", "-U3"], cwd).stdout || "<no diff sample>");
  const recentCommits = limitText(
    runCommand("git", ["--no-pager", "log", "-5", "--oneline"], cwd).stdout || "<no commits>",
    20,
    1200,
  );

  return {
    cwd,
    branch,
    baseBranch,
    statusSummary,
    diffStat,
    diffSample,
    recentCommits,
  };
}

function collectPrStatus(cwd: string): PrStatusSummary | null {
  const view = runCommand(
    "gh",
    ["pr", "view", "--json", "number,title,mergeStateStatus,statusCheckRollup,headRefName,baseRefName"],
    cwd,
  );
  if (view.code !== 0) {
    return null;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(view.stdout);
  } catch {
    return null;
  }

  const statuses: StatusCheck[] = Array.isArray(parsed.statusCheckRollup)
    ? parsed.statusCheckRollup.map((item: any) => ({
        name: item?.name ?? item?.workflowName ?? "<unknown>",
        status: item?.status ?? "UNKNOWN",
        conclusion: item?.conclusion ?? undefined,
        url: item?.detailsUrl ?? undefined,
        workflow: item?.workflowName ?? undefined,
      }))
    : [];

  const checksText = runCommand("gh", ["pr", "checks"], cwd);

  return {
    number: parsed.number,
    title: parsed.title,
    mergeState: parsed.mergeStateStatus,
    headRef: parsed.headRefName,
    baseRef: parsed.baseRefName,
    statuses,
    ghChecksText: checksText.code === 0 ? limitText(checksText.stdout, 200, 4000) : undefined,
  };
}

function formatRepoContext(context: RepoContext): string {
  return `Branch: ${context.branch}\nBase: ${context.baseBranch}\nStatus:\n${context.statusSummary}\n\nDiff Stat:\n${context.diffStat}\n\nRecent Commits:\n${context.recentCommits}`;
}

function formatPrStatus(summary?: PrStatusSummary | null): string {
  if (!summary) {
    return "No open PR detected (gh pr view failed).";
  }
  const header = summary.number
    ? `PR #${summary.number} (${summary.title ?? "no title"}) [${summary.mergeState ?? "UNKNOWN"}]`
    : "PR status unknown";
  const statuses = summary.statuses.length === 0
    ? "(no checks reported)"
    : summary.statuses
        .map((s) => `- ${s.name}: ${s.status}${s.conclusion ? ` (${s.conclusion})` : ""}`)
        .join("\n");
  return `${header}\nHead: ${summary.headRef ?? "?"} -> Base: ${summary.baseRef ?? "?"}\nChecks:\n${statuses}`;
}

export { collectPrStatus, collectRepoContext, formatPrStatus, formatRepoContext, runCommand };
