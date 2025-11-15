import type { FastEmbedEmbedRequest, FastEmbedInitOptions, Thread, SandboxMode, ApprovalMode } from "@codex-native/sdk";
import type { CiFix, CiIssue, Intention, Recommendation } from "./schemas.js";

export type CiCheckKind = "lint" | "tests" | "build" | "security";

export type FastEmbedConfig = {
  initOptions: FastEmbedInitOptions;
  embedRequest: Omit<FastEmbedEmbedRequest, "inputs" | "projectRoot">;
};

export type StructuredOutputMode = "always" | "actions-only" | "never";

export type MultiAgentConfig = {
  baseUrl?: string;
  apiKey?: string;
  workingDirectory: string;
  skipGitRepoCheck: boolean;
  interactive?: boolean;
  reviewBranch?: boolean;
  ciCheck?: boolean;
  reverieQuery?: string;
  model?: string;
  sandboxMode?: SandboxMode;
  approvalMode?: ApprovalMode;
  baseBranchOverride?: string;
  embedder?: FastEmbedConfig;
  suppressedChecks?: CiCheckKind[];
  enableLspDiagnostics?: boolean;
  lspWaitForDiagnostics?: boolean;
  implementFixes?: boolean;
  autoReverieHints?: boolean;
  reverieHintIntervalMs?: number;
  reverieHintMinScore?: number;
  reverieHintMaxMatches?: number;
  reverieHintContextChars?: number;
  reverieHintReasoningWeight?: number;
  reverieHintDialogueWeight?: number;
  reverieHintMinReasoningChars?: number;
  reverieHintMinDialogueChars?: number;
  reverieHintUseMiniModel?: boolean;
  reverieHintModel?: string;
  reverieWarmIndexOnStart?: boolean;
  reverieIndexLimit?: number;
  reverieIndexMaxCandidates?: number;
  reverieRerankerModel?: string;
  reverieRerankerBatchSize?: number;
  reverieRerankerTopK?: number;
  reverieMiniAcceptThreshold?: number;
  structuredOutputMode?: StructuredOutputMode;
};

export type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type RepoContext = {
  cwd: string;
  branch: string;
  baseBranch: string;
  statusSummary: string;
  diffStat: string;
  diffSample: string;
  recentCommits: string;
};

export type StatusCheck = {
  name: string;
  status: string;
  conclusion?: string;
  url?: string;
  workflow?: string;
};

export type PrStatusSummary = {
  number?: number;
  title?: string;
  mergeState?: string;
  headRef?: string;
  baseRef?: string;
  statuses: StatusCheck[];
  ghChecksText?: string;
};

export type ReviewAnalysis = {
  summary: string;
  intentions: Intention[];
  recommendations: Recommendation[];
  repoContext: RepoContext;
  prStatus?: PrStatusSummary | null;
  thread: Thread;
  ciHandoff?: Thread;
};

export type CiAnalysis = {
  issues: CiIssue[];
  fixes: CiFix[];
  confidence: number;
  thread: Thread;
};

export type ReverieResult = {
  conversationId: string;
  timestamp: string;
  relevance: number;
  excerpt: string;
  insights: string[];
};

export type ProcessedReverie = ReverieResult & {
  rawRelevance: number;
  headRecords: string[];
  tailRecords: string[];
};
