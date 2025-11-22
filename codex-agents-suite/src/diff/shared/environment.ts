import fs from "node:fs";
import path from "node:path";
import process from "node:process";

type DiffEnv = {
  repository: string;
  baseBranch: string;
  model: string;
  maxFiles: number;
  baseUrl?: string;
  apiKey?: string;
};

function findGitRoot(cwd: string): string | null {
  let current = cwd;
  while (current !== path.parse(current).root) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }
    current = path.dirname(current);
  }
  return null;
}

function detectDefaultRepo(): string {
  const gitRoot = findGitRoot(process.cwd());
  if (gitRoot) {
    return gitRoot;
  }
  const legacyPath = "/Volumes/sandisk/codex/codex-agents-suite";
  if (fs.existsSync(path.join(legacyPath, ".git"))) {
    return legacyPath;
  }
  return process.cwd();
}

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

const DEFAULT_DIFF_MODEL = "gpt-5.1-codex-mini";
const DEFAULT_MAX_FILES = 12;
const DEFAULT_BASE = "main";

export function loadDiffEnvironment(): DiffEnv {
  const repository = process.env.CX_DIFF_AGENT_REPO ?? process.env.CODEX_AGENTS_REPO ?? detectDefaultRepo();
  const baseBranch =
    process.env.CX_DIFF_AGENT_BASE ?? process.env.CODEX_AGENTS_BASE ?? process.env.CODEX_BASE_BRANCH ?? DEFAULT_BASE;
  const model = process.env.CX_DIFF_AGENT_MODEL ?? process.env.CODEX_AGENTS_MODEL ?? DEFAULT_DIFF_MODEL;
  const maxFiles = parseIntEnv(process.env.CX_DIFF_AGENT_MAX_FILES ?? process.env.CODEX_AGENTS_MAX_FILES, DEFAULT_MAX_FILES);

  return {
    repository,
    baseBranch,
    model,
    maxFiles,
    baseUrl: process.env.CODEX_BASE_URL,
    apiKey: process.env.CODEX_API_KEY,
  };
}

export function describeDiffEnvironment(env: DiffEnv): string {
  const safeRepo = env.repository === process.cwd() ? "." : env.repository;
  return `repo=${safeRepo} base=${env.baseBranch} model=${env.model} maxFiles=${env.maxFiles}`;
}

export type { DiffEnv };
