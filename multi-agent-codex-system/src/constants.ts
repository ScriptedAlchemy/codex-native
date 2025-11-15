import * as process from "node:process";
import type { MultiAgentConfig } from "./types.js";

export const DEFAULT_MODEL = "gpt-5.1-codex";
export const DEFAULT_MINI_MODEL = "gpt-5.1-codex-mini";
export const FALLBACK_BASE_BRANCH = "main";
export const MAX_CONTEXT_LINES = 140;
export const MAX_CONTEXT_CHARS = 4800;

export const CONFIG: MultiAgentConfig = {
  workingDirectory: process.cwd(),
  skipGitRepoCheck: true,
  reviewBranch: true,
  ciCheck: true,
  interactive: true,
  model: DEFAULT_MODEL,
  sandboxMode: "danger-full-access",
  approvalMode: "never",
  embedder: {
    initOptions: {
      model: "BAAI/bge-large-en-v1.5",
    },
    embedRequest: {
      normalize: true,
      cache: true,
      batchSize: 64,
    },
  },
  suppressedChecks: [],
  enableLspDiagnostics: true,
  lspWaitForDiagnostics: true,
  implementFixes: true,
  autoReverieHints: true,
  reverieHintIntervalMs: 120_000,
  reverieHintMinScore: 0.45,
  reverieHintMaxMatches: 2,
  reverieHintContextChars: 800,
  reverieHintReasoningWeight: 0.6,
  reverieHintDialogueWeight: 0.4,
  reverieHintMinReasoningChars: 120,
  reverieHintMinDialogueChars: 160,
  reverieHintUseMiniModel: true,
  reverieHintModel: DEFAULT_MINI_MODEL,
  reverieWarmIndexOnStart: true,
  reverieIndexLimit: 200,
  reverieIndexMaxCandidates: 400,
  reverieRerankerModel: "BAAI/bge-reranker-v2-m3",
  reverieRerankerBatchSize: 8,
  reverieRerankerTopK: 20,
  reverieMiniAcceptThreshold: 0.25,
  structuredOutputMode: "actions-only",
};
