import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { MAX_CONTEXT_CHARS } from "./constants.js";
import type { ConflictContext, RemoteComparison, RemoteRefs } from "./types.js";

const execFileAsync = promisify(execFile);

export class GitRepo {
  constructor(private readonly cwd: string) {}

  async runGit(args: string[], allowFailure = false): Promise<{ stdout: string; stderr: string }> {
    try {
      const { stdout, stderr } = await execFileAsync("git", args, { cwd: this.cwd });
      return { stdout: stdout.toString(), stderr: stderr.toString() };
    } catch (error: any) {
      if (allowFailure && error?.stdout) {
        return { stdout: error.stdout.toString(), stderr: error.stderr?.toString() ?? "" };
      }
      throw error;
    }
  }

  async listConflictPaths(): Promise<string[]> {
    const { stdout } = await this.runGit(["diff", "--name-only", "--diff-filter=U"]);
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  async stageFile(relPath: string): Promise<void> {
    await this.runGit(["add", relPath]);
  }

  async getStatusShort(): Promise<string> {
    const { stdout } = await this.runGit(["status", "--short"], true);
    return stdout.trim();
  }

  async getDiffStat(): Promise<string> {
    const { stdout } = await this.runGit(["diff", "--stat", "--color=never"], true);
    return stdout.trim();
  }

  async getRecentCommits(limit = 6): Promise<string> {
    const { stdout } = await this.runGit(["log", `-${limit}`, "--oneline"], true);
    return stdout.trim();
  }

  async getBranchName(): Promise<string | null> {
    const { stdout } = await this.runGit(["rev-parse", "--abbrev-ref", "HEAD"], true);
    const branch = stdout.trim();
    return branch.length ? branch : null;
  }

  async readWorkingFile(relPath: string): Promise<string | null> {
    const absolute = path.join(this.cwd, relPath);
    try {
      const content = await fs.readFile(absolute, "utf8");
      return content;
    } catch {
      return null;
    }
  }

  async showStageFile(relPath: string, stage: 1 | 2 | 3): Promise<string | null> {
    try {
      const { stdout } = await this.runGit(["show", `:${stage}:${relPath}`]);
      return stdout;
    } catch {
      return null;
    }
  }

  async collectConflicts(remotes?: RemoteRefs): Promise<ConflictContext[]> {
    const paths = await this.listConflictPaths();
    const results: ConflictContext[] = [];
    for (const filePath of paths) {
      results.push(await this.describeConflict(filePath, remotes));
    }
    return results;
  }

  private async describeConflict(filePath: string, remotes?: RemoteRefs): Promise<ConflictContext> {
    const working = await this.readWorkingFile(filePath);
    const diff = await this.runGit(["diff", "--color=never", "--unified=1", "--", filePath], true);
    const base = await this.showStageFile(filePath, 1);
    const ours = await this.showStageFile(filePath, 2);
    const theirs = await this.showStageFile(filePath, 3);
    const originRefContent =
      remotes?.originRef && remotes.originRef.length
        ? await this.showRefFile(remotes.originRef, filePath)
        : null;
    const upstreamRefContent =
      remotes?.upstreamRef && remotes.upstreamRef.length
        ? await this.showRefFile(remotes.upstreamRef, filePath)
        : null;
    const originVsUpstreamDiff =
      remotes?.originRef && remotes?.upstreamRef
        ? await this.diffFileBetweenRefs(remotes.originRef, remotes.upstreamRef, filePath)
        : null;
    const baseVsOursDiff = await this.diffStageBlobs(filePath, 1, 2);
    const baseVsTheirsDiff = await this.diffStageBlobs(filePath, 1, 3);
    const oursVsTheirsDiff = await this.diffStageBlobs(filePath, 2, 3);
    const recentHistory = await this.getRecentHistory(filePath, 5);
    const localIntentLog = await this.getLocalIntentLog(remotes?.upstreamRef, filePath, 3);

    return {
      path: filePath,
      language: detectLanguage(filePath),
      lineCount: working ? countLines(working) : null,
      conflictMarkers: working ? countMarkers(working) : null,
      diffExcerpt: limitText(diff.stdout, 2000),
      workingExcerpt: limitText(working, 1500),
      baseExcerpt: limitText(base, 800),
      oursExcerpt: limitText(ours, 800),
      theirsExcerpt: limitText(theirs, 800),
      originRefContent: limitText(originRefContent, 800),
      upstreamRefContent: limitText(upstreamRefContent, 800),
      originVsUpstreamDiff: limitText(originVsUpstreamDiff, 1200),
      baseVsOursDiff: limitText(baseVsOursDiff, 1200),
      baseVsTheirsDiff: limitText(baseVsTheirsDiff, 1200),
      oursVsTheirsDiff: limitText(oursVsTheirsDiff, 1200),
      recentHistory: limitText(recentHistory, 800),
      localIntentLog: limitText(localIntentLog, 800),
    };
  }

  private async showRefFile(ref: string, relPath: string): Promise<string | null> {
    try {
      const { stdout } = await this.runGit(["show", `${ref}:${relPath}`]);
      return stdout;
    } catch {
      return null;
    }
  }

  private async diffStageBlobs(filePath: string, left: 1 | 2 | 3, right: 1 | 2 | 3): Promise<string | null> {
    try {
      const leftSpec = `:${left}:${filePath}`;
      const rightSpec = `:${right}:${filePath}`;
      const { stdout } = await this.runGit(["diff", "--color=never", "--unified=1", leftSpec, rightSpec], true);
      return stdout.trim() ? stdout : null;
    } catch {
      return null;
    }
  }

  private async diffFileBetweenRefs(refA: string, refB: string, relPath: string): Promise<string | null> {
    try {
      const { stdout } = await this.runGit(
        ["diff", "--color=never", `${refA}...${refB}`, "--", relPath],
        true,
      );
      return stdout.trim() ? stdout : null;
    } catch {
      return null;
    }
  }

  private async getRecentHistory(relPath: string, limit: number): Promise<string | null> {
    try {
      const { stdout } = await this.runGit(["log", "-n", String(limit), "--oneline", "--", relPath], true);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  private async getLocalIntentLog(
    upstreamRef: string | null | undefined,
    relPath: string,
    limit: number,
  ): Promise<string | null> {
    if (!upstreamRef) {
      return null;
    }
    try {
      const { stdout } = await this.runGit(
        ["log", "--oneline", "-n", String(limit), `${upstreamRef}..HEAD`, "--", relPath],
        true,
      );
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  async compareRefs(originRef?: string | null, upstreamRef?: string | null): Promise<RemoteComparison | null> {
    if (!originRef || !upstreamRef) {
      return null;
    }
    try {
      const [diffAB, diffBA, logAB, logBA] = await Promise.all([
        this.runGit(["diff", "--stat", "--color=never", `${originRef}..${upstreamRef}`], true),
        this.runGit(["diff", "--stat", "--color=never", `${upstreamRef}..${originRef}`], true),
        this.runGit(["log", `${originRef}..${upstreamRef}`, "--oneline", "-n", "8"], true),
        this.runGit(["log", `${upstreamRef}..${originRef}`, "--oneline", "-n", "8"], true),
      ]);
      return {
        originRef,
        upstreamRef,
        commitsMissingFromOrigin: logAB.stdout.trim() || null,
        commitsMissingFromUpstream: logBA.stdout.trim() || null,
        diffstatOriginToUpstream: diffAB.stdout.trim() || null,
        diffstatUpstreamToOrigin: diffBA.stdout.trim() || null,
      };
    } catch {
      return null;
    }
  }

  async isMergeInProgress(): Promise<boolean> {
    try {
      await execFileAsync("git", ["rev-parse", "-q", "--verify", "MERGE_HEAD"], { cwd: this.cwd });
      return true;
    } catch {
      return false;
    }
  }
}

export function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".rs") return "Rust";
  if (ext === ".ts" || ext === ".tsx") return "TypeScript";
  if (ext === ".js" || ext === ".jsx") return "JavaScript";
  if (ext === ".md") return "Markdown";
  if (ext === ".json") return "JSON";
  if (ext === ".yml" || ext === ".yaml") return "YAML";
  if (ext === ".toml") return "TOML";
  if (ext === ".py") return "Python";
  if (ext === ".sh") return "Shell";
  return "Unknown";
}

export function countLines(text: string): number {
  return text.split(/\r?\n/).length;
}

export function countMarkers(text: string): number {
  const matches = text.match(/<{7,}|>{7,}|={7,}/g);
  return matches ? matches.length : 0;
}

export function limitText(text: string | null, limit = MAX_CONTEXT_CHARS): string | null {
  if (!text) return null;
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n… truncated (${text.length - limit} additional chars)`;
}

export function indent(text: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}
