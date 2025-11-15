import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ApprovalMode, SandboxMode, WorkspaceWriteOptions, ReasoningEffort, ReasoningSummary } from "./threadOptions";

const CLI_ENTRYPOINT_ENV = "CODEX_NODE_CLI_ENTRYPOINT";

export type NativeRunRequest = {
  prompt: string;
  threadId?: string;
  images?: string[];
  model?: string;
  oss?: boolean;
  sandboxMode?: SandboxMode;
  approvalMode?: ApprovalMode;
  workspaceWriteOptions?: WorkspaceWriteOptions;
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  outputSchema?: unknown;
  baseUrl?: string;
  apiKey?: string;
  linuxSandboxPath?: string;
  reasoningEffort?: ReasoningEffort;
  reasoningSummary?: ReasoningSummary;
  /** @deprecated Use sandboxMode and approvalMode instead */
  fullAuto?: boolean;
  reviewMode?: boolean;
  reviewHint?: string;
};

export type NativeForkRequest = {
  threadId: string;
  nthUserMessage: number;
  model?: string;
  oss?: boolean;
  sandboxMode?: SandboxMode;
  approvalMode?: ApprovalMode;
  workspaceWriteOptions?: WorkspaceWriteOptions;
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  baseUrl?: string;
  apiKey?: string;
  linuxSandboxPath?: string;
  fullAuto?: boolean;
};

export type NativeConversationConfig = {
  model?: string;
  oss?: boolean;
  sandboxMode?: SandboxMode;
  approvalMode?: ApprovalMode;
  workspaceWriteOptions?: WorkspaceWriteOptions;
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  baseUrl?: string;
  apiKey?: string;
  linuxSandboxPath?: string;
  reasoningEffort?: ReasoningEffort;
  reasoningSummary?: ReasoningSummary;
  fullAuto?: boolean;
};

export type NativeConversationListRequest = {
  config?: NativeConversationConfig;
  pageSize?: number;
  cursor?: string;
  modelProviders?: string[];
};

export type NativeConversationSummary = {
  id: string;
  path: string;
  createdAt?: string;
  updatedAt?: string;
};

export type NativeConversationListPage = {
  conversations: NativeConversationSummary[];
  nextCursor?: string;
  numScannedFiles: number;
  reachedScanCap: boolean;
};

export type NativeDeleteConversationRequest = {
  id: string;
  config?: NativeConversationConfig;
};

export type NativeDeleteConversationResult = {
  deleted: boolean;
};

export type NativeResumeFromRolloutRequest = {
  rolloutPath: string;
  config?: NativeConversationConfig;
};

export type NativeTuiRequest = {
  prompt?: string;
  images?: string[];
  model?: string;
  oss?: boolean;
  sandboxMode?: SandboxMode;
  approvalMode?: ApprovalMode;
  resumeSessionId?: string;
  resumeLast?: boolean;
  resumePicker?: boolean;
  fullAuto?: boolean;
  dangerouslyBypassApprovalsAndSandbox?: boolean;
  workingDirectory?: string;
  configProfile?: string;
  configOverrides?: string[];
  addDir?: string[];
  webSearch?: boolean;
  linuxSandboxPath?: string;
  baseUrl?: string;
  apiKey?: string;
  reasoningEffort?: ReasoningEffort;
  reasoningSummary?: ReasoningSummary;
};

export type PlanStatus = "pending" | "in_progress" | "completed";

export type NativeEmitBackgroundEventRequest = {
  threadId: string;
  message: string;
};

export type NativeEmitPlanUpdateRequest = {
  threadId: string;
  explanation?: string;
  plan: Array<{
    step: string;
    status: PlanStatus;
  }>;
};

export type NativeModifyPlanRequest = {
  threadId: string;
  operations: PlanOperation[];
};

export type PlanOperation =
  | { type: "add"; item: { step: string; status?: PlanStatus } }
  | { type: "update"; index: number; updates: { step?: string; status?: PlanStatus } }
  | { type: "remove"; index: number }
  | { type: "reorder"; newOrder: number[] };

export type NativeToolInterceptorNativeContext = {
  invocation: NativeToolInvocation;
  token: string;
};

export type NativeTokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
};

export type NativeUpdateActionKind = "npmGlobalLatest" | "bunGlobalLatest" | "brewUpgrade";

export type NativeUpdateActionInfo = {
  kind: NativeUpdateActionKind;
  command: string;
};

export type NativeTuiExitInfo = {
  tokenUsage: NativeTokenUsage;
  conversationId?: string;
  updateAction?: NativeUpdateActionInfo;
};

export type NativeTuiSession = {
  wait(): Promise<NativeTuiExitInfo>;
  shutdown(): void;
  readonly closed: boolean;
};

// ============================================================================ 
// Repo diff summaries
// ============================================================================ 

export type RepoDiffFileChange = {
  path: string;
  status: string;
  diff: string;
  truncated: boolean;
  previousPath?: string | null;
};

export type RepoDiffSummary = {
  repoPath: string;
  branch: string;
  baseBranch: string;
  upstreamRef?: string | null;
  mergeBase: string;
  statusSummary: string;
  diffStat: string;
  recentCommits: string;
  changedFiles: RepoDiffFileChange[];
  totalChangedFiles: number;
};

export type RepoDiffSummaryOptions = {
  cwd?: string;
  baseBranchOverride?: string;
  maxFiles?: number;
  diffContextLines?: number;
  diffCharLimit?: number;
};

// ============================================================================
// Reverie System Types
// ============================================================================

export type ReverieConversation = {
  id: string;
  path: string;
  createdAt?: string;
  updatedAt?: string;
  headRecords: string[];
  tailRecords: string[];
  headRecordsToon: string[];
  tailRecordsToon: string[];
};

export type ReverieSearchResult = {
  conversation: ReverieConversation;
  relevanceScore: number;
  matchingExcerpts: string[];
  insights: string[];
  rerankerScore?: number;
};

export type FastEmbedRerankerModelCode =
  | "BAAI/bge-reranker-base"
  | "rozgo/bge-reranker-v2-m3"
  | "jinaai/jina-reranker-v1-turbo-en"
  | "jinaai/jina-reranker-v2-base-multilingual";

export type ReverieSemanticSearchOptions = {
  limit?: number;
  maxCandidates?: number;
  projectRoot?: string;
  batchSize?: number;
  normalize?: boolean;
  cache?: boolean;
  rerankerModel?: FastEmbedRerankerModelCode;
  rerankerCacheDir?: string;
  rerankerMaxLength?: number;
  rerankerShowProgress?: boolean;
  rerankerBatchSize?: number;
  rerankerTopK?: number;
};

export type ReverieSemanticIndexStats = {
  conversationsIndexed: number;
  documentsEmbedded: number;
  batches: number;
};

// ============================================================================
// FastEmbed Types
// ============================================================================

export type FastEmbedInitOptions = {
  model?: string;
  cacheDir?: string;
  maxLength?: number;
  showDownloadProgress?: boolean;
};

export type FastEmbedEmbedRequest = {
  inputs: string[];
  batchSize?: number;
  normalize?: boolean;
  projectRoot?: string;
  cache?: boolean;
};

// ============================================================================
// Tokenizer Types
// ============================================================================

export type TokenizerOptions = {
  model?: string;
  encoding?: "o200k_base" | "cl100k_base";
};

export type TokenizerEncodeOptions = TokenizerOptions & {
  withSpecialTokens?: boolean;
};

function ensureCliEntrypointEnv(): void {
  if (process.env[CLI_ENTRYPOINT_ENV]) {
    return;
  }

  const filename = fileURLToPath(import.meta.url);
  const dirname = path.dirname(filename);
  const candidates = [
    path.resolve(dirname, "cli.cjs"),
    path.resolve(dirname, "../cli.cjs"),
    path.resolve(dirname, "../dist/cli.cjs"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      process.env[CLI_ENTRYPOINT_ENV] = candidate;
      break;
    }
  }
}

ensureCliEntrypointEnv();

export type NativeBinding = {
  runThread(request: NativeRunRequest): Promise<string[]>;
  runThreadStream(
    request: NativeRunRequest,
    onEvent: (err: unknown, eventJson?: string) => void,
  ): Promise<void>;
  compactThread(request: NativeRunRequest): Promise<string[]>;
  forkThread(request: NativeForkRequest): Promise<NativeForkResult>;
  listConversations(request: NativeConversationListRequest): Promise<NativeConversationListPage>;
  deleteConversation(request: NativeDeleteConversationRequest): Promise<NativeDeleteConversationResult>;
  resumeConversationFromRollout(request: NativeResumeFromRolloutRequest): Promise<NativeForkResult>;
  runTui(request: NativeTuiRequest): Promise<NativeTuiExitInfo>;
  tuiTestRun?(request: {
    width: number;
    height: number;
    viewport: { x: number; y: number; width: number; height: number };
    lines: string[];
  }): Promise<string[]>;
  callToolBuiltin(token: string, invocation?: NativeToolInvocation): Promise<NativeToolResult>;
  clearRegisteredTools(): void;
  registerTool(info: NativeToolInfo, handler: (call: NativeToolInvocation) => Promise<NativeToolResult> | NativeToolResult): void;
  registerToolInterceptor(toolName: string, handler: (context: NativeToolInterceptorNativeContext) => Promise<NativeToolResult> | NativeToolResult): void;
  registerApprovalCallback?(
    handler: (request: ApprovalRequest) => boolean | Promise<boolean>,
  ): void;
  emitBackgroundEvent(request: NativeEmitBackgroundEventRequest): Promise<void>;
  emitPlanUpdate(request: NativeEmitPlanUpdateRequest): Promise<void>;
  modifyPlan(request: NativeModifyPlanRequest): Promise<void>;
  startTui?(request: NativeTuiRequest): NativeTuiSession;
  // SSE test helpers (exposed for TypeScript tests)
  ev_completed(id: string): string;
  ev_response_created(id: string): string;
  ev_assistant_message(id: string, text: string): string;
  ev_function_call(callId: string, name: string, args: string): string;
  sse(events: string[]): string;
  // Cloud tasks support (JSON-string payload responses)
  cloudTasksList?(env?: string, baseUrl?: string, apiKey?: string): Promise<string>;
  cloudTasksGetDiff?(taskId: string, baseUrl?: string, apiKey?: string): Promise<string>;
  cloudTasksApplyPreflight?(
    taskId: string,
    diffOverride?: string,
    baseUrl?: string,
    apiKey?: string,
  ): Promise<string>;
  cloudTasksApply?(
    taskId: string,
    diffOverride?: string,
    baseUrl?: string,
    apiKey?: string,
  ): Promise<string>;
  cloudTasksCreate?(
    envId: string,
    prompt: string,
    gitRef?: string,
    qaMode?: boolean,
    bestOfN?: number,
    baseUrl?: string,
    apiKey?: string,
  ): Promise<string>;
  // Reverie system - conversation search and insights
  reverieListConversations(codexHomePath: string, limit?: number, offset?: number): Promise<ReverieConversation[]>;
  reverieSearchConversations(codexHomePath: string, query: string, limit?: number): Promise<ReverieSearchResult[]>;
  reverieSearchSemantic?(
    codexHomePath: string,
    context: string,
    options?: ReverieSemanticSearchOptions,
  ): Promise<ReverieSearchResult[]>;
  reverieIndexSemantic?(
    codexHomePath: string,
    options?: ReverieSemanticSearchOptions,
  ): Promise<ReverieSemanticIndexStats>;
  reverieGetConversationInsights(conversationPath: string, query?: string): Promise<string[]>;
  toonEncode(value: unknown): string;
  // FastEmbed hooks
  fastEmbedInit?(options: FastEmbedInitOptions): Promise<void>;
  fastEmbedEmbed?(request: FastEmbedEmbedRequest): Promise<number[][]>;
  // Tokenizer helpers
  tokenizerCount(text: string, options?: TokenizerOptions): number;
  tokenizerEncode(text: string, options?: TokenizerEncodeOptions): number[];
  tokenizerDecode(tokens: number[], options?: TokenizerOptions): string;
  collectRepoDiffSummary?(
    cwd: string,
    baseBranchOverride?: string,
    options?: NativeRepoDiffOptions,
  ): Promise<RepoDiffSummary>;
};

export type NativeToolInfo = {
  name: string;
  description?: string;
  parameters?: unknown;
  strict?: boolean;
  supportsParallel?: boolean;
};

export type NativeToolInvocation = {
  toolName: string;
  callId: string;
  arguments?: string;
  input?: string;
};

export type NativeToolResult = {
  output?: string;
  success?: boolean;
  error?: string;
};

export type NativeForkResult = {
  threadId: string;
  rolloutPath: string;
};

export type ApprovalRequest = {
  type: "shell" | "file_write" | "network_access";
  details?: unknown;
};

type NativeRepoDiffOptions = {
  maxFiles?: number;
  diffContextLines?: number;
  diffCharLimit?: number;
};

let cachedBinding: NativeBinding | null | undefined;

function getImportMetaUrl(): string | undefined {
  try {
    return Function(
      "return typeof import.meta !== 'undefined' && import.meta.url ? import.meta.url : undefined;",
    )() as string | undefined;
  } catch {
    return undefined;
  }
}

function resolveBindingEntryPath(): string {
  if (typeof __dirname === "string") {
    return path.resolve(__dirname, "..", "index.js");
  }

  const importMetaUrl = getImportMetaUrl();
  if (importMetaUrl) {
    try {
      const filePath = fileURLToPath(importMetaUrl);
      return path.resolve(path.dirname(filePath), "..", "index.js");
    } catch {
      // fall through to process.cwd()
    }
  }

  return path.resolve(process.cwd(), "index.js");
}

function resolveRequire() {
  const globalRequire = (globalThis as typeof globalThis & { require?: NodeJS.Require }).require;
  if (typeof globalRequire === "function") {
    return globalRequire;
  }

  if (typeof __filename === "string") {
    try {
      return createRequire(__filename);
    } catch {
      // fall through to other strategies
    }
  }

  const importMetaUrl = getImportMetaUrl();
  if (importMetaUrl) {
    try {
      return createRequire(importMetaUrl);
    } catch {
      // fall through to fallback strategy
    }
  }

  const fallbackBase = typeof __dirname === "string" ? __dirname : process.cwd();
  const fallbackPath = path.join(fallbackBase, "noop.js");
  return createRequire(fallbackPath);
}

export function getNativeBinding(): NativeBinding | null {
  if (cachedBinding !== undefined) {
    return cachedBinding;
  }

  const requireFn = resolveRequire();
  const envPath = process.env.CODEX_NATIVE_BINDING;
  if (envPath && envPath.length > 0) {
    // Let napi-rs generated index.js honor this override
    process.env.NAPI_RS_NATIVE_LIBRARY_PATH = envPath;
  }
  const bindingEntryPath = resolveBindingEntryPath();

  // For sdk/native: load the NAPI binding from the package root
  // The index.js is auto-generated by napi-rs and loads the .node file
  try {
    const binding: NativeBinding = requireFn(bindingEntryPath);
    cachedBinding = binding;
    return cachedBinding;
  } catch (error) {
    console.warn("Failed to load native NAPI binding:", error);
    cachedBinding = null;
    return cachedBinding;
  }
}

// SSE test helpers (exposed for TypeScript tests)
export function ev_completed(id: string): string {
  const binding = getNativeBinding();
  if (!binding) throw new Error("Native binding not available");
  return (binding as any).evCompleted(id);
}

export function ev_response_created(id: string): string {
  const binding = getNativeBinding();
  if (!binding) throw new Error("Native binding not available");
  return (binding as any).evResponseCreated(id);
}

export function ev_assistant_message(id: string, text: string): string {
  const binding = getNativeBinding();
  if (!binding) throw new Error("Native binding not available");
  return (binding as any).evAssistantMessage(id, text);
}

export function ev_function_call(callId: string, name: string, args: string): string {
  const binding = getNativeBinding();
  if (!binding) throw new Error("Native binding not available");
  return (binding as any).evFunctionCall(callId, name, args);
}

export function sse(events: string[]): string {
  const binding = getNativeBinding();
  if (!binding) throw new Error("Native binding not available");
  return (binding as any).sse(events);
}

export function runApplyPatch(patch: string): void {
  if (!patch) {
    throw new Error("apply_patch requires patch contents");
  }
  const binding = getNativeBinding();
  if (!binding) throw new Error("Native binding not available");
  (binding as any).runApplyPatch(patch);
}

// Reverie system helpers
export async function reverieListConversations(
  codexHomePath: string,
  limit?: number,
  offset?: number,
): Promise<ReverieConversation[]> {
  const binding = getNativeBinding();
  if (!binding?.reverieListConversations) throw new Error("Native binding not available or reverie functions not supported");
  return (binding as any).reverieListConversations(codexHomePath, limit, offset);
}

export async function reverieSearchConversations(
  codexHomePath: string,
  query: string,
  limit?: number,
): Promise<ReverieSearchResult[]> {
  const binding = getNativeBinding();
  if (!binding?.reverieSearchConversations) throw new Error("Native binding not available or reverie functions not supported");
  return (binding as any).reverieSearchConversations(codexHomePath, query, limit);
}

export async function reverieSearchSemantic(
  codexHomePath: string,
  context: string,
  options?: ReverieSemanticSearchOptions,
): Promise<ReverieSearchResult[]> {
  const binding = getNativeBinding();
  if (!binding?.reverieSearchSemantic) throw new Error("Native binding not available or reverie functions not supported");
  return (binding as any).reverieSearchSemantic(codexHomePath, context, options);
}

export async function reverieIndexSemantic(
  codexHomePath: string,
  options?: ReverieSemanticSearchOptions,
): Promise<ReverieSemanticIndexStats> {
  const binding = getNativeBinding();
  if (!binding?.reverieIndexSemantic) throw new Error("Native binding not available or reverie functions not supported");
  return (binding as any).reverieIndexSemantic(codexHomePath, options);
}

export async function reverieGetConversationInsights(
  conversationPath: string,
  query?: string,
): Promise<string[]> {
  const binding = getNativeBinding();
  if (!binding?.reverieGetConversationInsights) throw new Error("Native binding not available or reverie functions not supported");
  return (binding as any).reverieGetConversationInsights(conversationPath, query);
}

export function encodeToToon(value: unknown): string {
  const binding = getNativeBinding();
  if (!binding?.toonEncode) throw new Error("Native binding not available or toon encoder not supported");
  return (binding as any).toonEncode(value);
}

// FastEmbed helpers
export async function fastEmbedInit(options: FastEmbedInitOptions): Promise<void> {
  const binding = getNativeBinding();
  if (!binding?.fastEmbedInit) throw new Error("Native binding not available or FastEmbed functions not supported");
  await binding.fastEmbedInit(options);
}

export async function fastEmbedEmbed(request: FastEmbedEmbedRequest): Promise<number[][]> {
  const binding = getNativeBinding();
  if (!binding?.fastEmbedEmbed) throw new Error("Native binding not available or FastEmbed functions not supported");
  return binding.fastEmbedEmbed(request);
}

// Tokenizer helpers
export function tokenizerCount(text: string, options?: TokenizerOptions): number {
  const binding = getNativeBinding();
  if (!binding?.tokenizerCount) throw new Error("Native binding not available or tokenizer functions not supported");
  return (binding as any).tokenizerCount(text, options);
}

export function tokenizerEncode(text: string, options?: TokenizerEncodeOptions): number[] {
  const binding = getNativeBinding();
  if (!binding?.tokenizerEncode) throw new Error("Native binding not available or tokenizer functions not supported");
  return (binding as any).tokenizerEncode(text, options);
}

export function tokenizerDecode(tokens: number[], options?: TokenizerOptions): string {
  const binding = getNativeBinding();
  if (!binding?.tokenizerDecode) throw new Error("Native binding not available or tokenizer functions not supported");
  return (binding as any).tokenizerDecode(tokens, options);
}

export async function collectRepoDiffSummary(
  options?: RepoDiffSummaryOptions,
): Promise<RepoDiffSummary> {
  const binding = getNativeBinding();
  if (!binding?.collectRepoDiffSummary) {
    throw new Error("Native binding not available or repo diff helpers not supported");
  }
  const cwd = options?.cwd ?? process.cwd();
  const nativeOptions: NativeRepoDiffOptions | undefined =
    options &&
    (options.maxFiles !== undefined ||
      options.diffContextLines !== undefined ||
      options.diffCharLimit !== undefined)
      ? {
          maxFiles: options.maxFiles,
          diffContextLines: options.diffContextLines,
          diffCharLimit: options.diffCharLimit,
        }
      : undefined;
  return binding.collectRepoDiffSummary(cwd, options?.baseBranchOverride, nativeOptions);
}
