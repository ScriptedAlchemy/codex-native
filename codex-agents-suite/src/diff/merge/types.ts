import type { ApprovalMode, SandboxMode, Thread } from "@codex-native/sdk";

export type SolverConfig = {
  workingDirectory: string;
  coordinatorModel: string;
  workerModel: string;
  reviewerModel: string;
  supervisorModel?: string;
  workerModelHigh?: string;
  workerModelLow?: string;
  highReasoningMatchers?: string[];
  lowReasoningMatchers?: string[];
  sandboxMode: SandboxMode;
  approvalMode: ApprovalMode;
  baseUrl?: string;
  apiKey?: string;
  skipGitRepoCheck: boolean;
  originRef?: string | null;
  upstreamRef?: string | null;
};

export type RepoSnapshot = {
  branch: string | null;
  statusShort: string;
  diffStat: string;
  recentCommits: string;
  conflicts: ConflictContext[];
  remoteComparison?: RemoteComparison | null;
};

export type ConflictContext = {
  path: string;
  language: string;
  lineCount: number | null;
  conflictMarkers: number | null;
  diffExcerpt: string | null;
  workingExcerpt: string | null;
  baseExcerpt: string | null;
  oursExcerpt: string | null;
  theirsExcerpt: string | null;
  originRefContent?: string | null;
  upstreamRefContent?: string | null;
  originVsUpstreamDiff?: string | null;
  baseVsOursDiff?: string | null;
  baseVsTheirsDiff?: string | null;
  oursVsTheirsDiff?: string | null;
  recentHistory?: string | null;
  localIntentLog?: string | null;
};

export type RemoteComparison = {
  originRef: string;
  upstreamRef: string;
  commitsMissingFromOrigin: string | null;
  commitsMissingFromUpstream: string | null;
  diffstatOriginToUpstream: string | null;
  diffstatUpstreamToOrigin: string | null;
};

export type RemoteRefs = {
  originRef?: string | null;
  upstreamRef?: string | null;
};

export type ApprovalContext = {
  conflictPath?: string;
  coordinatorPlan?: string | null;
  remoteInfo?: RemoteComparison | null;
  extraNotes?: string;
};

export type SupervisorDecision = {
  decision: "approve" | "deny";
  reason: string;
  corrective_actions?: string[];
};

export type SupervisorOptions = {
  model: string;
  workingDirectory: string;
  sandboxMode: SandboxMode;
};

export type WorkerOutcome = {
  path: string;
  success: boolean;
  summary?: string;
  threadId?: string;
  error?: string;
  validationStatus?: "ok" | "fail";
};

export type CiFailure = {
  label: string;
  snippet: string;
  pathHints: string[];
};

export type CiCoordinatorTask = {
  label: string;
  owner?: string;
  scope?: string;
  commands: string[];
  notes?: string;
  blockedBy?: string[];
};

export type CiCoordinatorPlan = {
  summary: string;
  tasks: CiCoordinatorTask[];
};

export type ThreadProvider = () => Thread | null;
