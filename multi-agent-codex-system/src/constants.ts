import * as process from "node:process";
import type { MultiAgentConfig } from "./types.js";

export const DEFAULT_MODEL = "gpt-5-codex";
export const DEFAULT_MINI_MODEL = "gpt-5-codex-mini";
export const FALLBACK_BASE_BRANCH = "main";
export const MAX_CONTEXT_LINES = 140;
export const MAX_CONTEXT_CHARS = 4800;

export const CONFIG: MultiAgentConfig = {
  workingDirectory: process.cwd(),
  skipGitRepoCheck: true,
  reviewBranch: true,
  ciCheck: true,
  interactive: false,
  model: DEFAULT_MODEL,
  embedder: {
    initOptions: {
      model: "BAAI/bge-large-en-v1.5",
    },
    embedRequest: {
      normalize: true,
      cache: true,
    },
  },
  suppressedChecks: [],
};
