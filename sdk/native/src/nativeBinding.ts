import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ApprovalMode,
  SandboxMode,
  WorkspaceWriteOptions,
  ReasoningEffort,
  ReasoningSummary,
  McpServerConfig,
  Personality,
  WebSearchMode,
  DynamicToolSpec,
} from "./threadOptions";

const CLI_ENTRYPOINT_ENV = "CODEX_NODE_CLI_ENTRYPOINT";

type NativeByteRange = {
  start: number;
  end: number;
};

type NativeTextElement = {
  byte_range: NativeByteRange;
  placeholder?: string;
};

export type NativeUserInputItem =
  | { type: "text"; text: string; text_elements?: NativeTextElement[] }
  | { type: "local_image"; path: string }
  | { type: "image"; image_url: string }
  | { type: "skill"; name: string; path: string }
  | { type: "mention"; name: string; path: string }
  | { type: "skill_inline"; name: string; contents: string };

export type NativeRunRequest = {
  prompt: string;
  threadId?: string;
  inputItems?: NativeUserInputItem[];
  images?: string[];
  model?: string;
  modelProvider?: string;
  oss?: boolean;
  sandboxMode?: SandboxMode;
  approvalMode?: ApprovalMode;
  workspaceWriteOptions?: WorkspaceWriteOptions;
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  outputSchema?: unknown;
  toolChoice?: unknown;
  baseUrl?: string;
  apiKey?: string;
  linuxSandboxPath?: string;
  reasoningEffort?: ReasoningEffort;
  reasoningSummary?: ReasoningSummary;
  personality?: Personality;
  turnPersonality?: Personality;
  ephemeral?: boolean;
  webSearchMode?: WebSearchMode;
  dynamicTools?: DynamicToolSpec[];
  reviewMode?: boolean;
  reviewHint?: string;
  /** MCP servers to register, keyed by server name */
  mcp?: Record<string, McpServerConfig>;
  /**
   * When false, ignores globally registered MCP servers from config.toml.
   * When true (default), merges the `mcp` option with global config.
   */
  inheritMcp?: boolean;
};

export type NativeForkRequest = {
  threadId: string;
  nthUserMessage: number;
  model?: string;
  modelProvider?: string;
  oss?: boolean;
  sandboxMode?: SandboxMode;
  approvalMode?: ApprovalMode;
  workspaceWriteOptions?: WorkspaceWriteOptions;
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  baseUrl?: string;
  apiKey?: string;
  linuxSandboxPath?: string;
};

export type NativeConversationConfig = {
  model?: string;
  modelProvider?: string;
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
  personality?: Personality;
  ephemeral?: boolean;
  webSearchMode?: WebSearchMode;
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
  modelProvider?: string;
  oss?: boolean;
  sandboxMode?: SandboxMode;
  approvalMode?: ApprovalMode;
  resumeSessionId?: string;
  resumeLast?: boolean;
  resumePicker?: boolean;
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
  cwd?: string;
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
  callRegisteredToolForTest?(
    toolName: string,
    invocation: NativeToolInvocation,
  ): Promise<NativeToolResult>;
  clearRegisteredTools(): void;
  registerTool(info: NativeToolInfo, handler: (call: NativeToolInvocation) => Promise<NativeToolResult> | NativeToolResult): void;
  registerToolInterceptor(toolName: string, handler: (context: NativeToolInterceptorNativeContext) => Promise<NativeToolResult> | NativeToolResult): void;
  listRegisteredTools(): NativeToolInfo[];
  registerApprovalCallback?(
    handler: (request: ApprovalRequest) => boolean | Promise<boolean>,
  ): void;
  emitBackgroundEvent(request: NativeEmitBackgroundEventRequest): Promise<void>;
  emitPlanUpdate(request: NativeEmitPlanUpdateRequest): Promise<void>;
  modifyPlan(request: NativeModifyPlanRequest): Promise<void>;
  startTui(request: NativeTuiRequest): NativeTuiSession;
  // SSE test helpers (exposed for TypeScript tests)
  ev_completed(id: string): string;
  ev_response_created(id: string): string;
  ev_assistant_message(id: string, text: string): string;
  ev_function_call(callId: string, name: string, args: string): string;
  sse(events: string[]): string;
  ensureTokioRuntime?: () => void;
  isTokioRuntimeAvailable?: () => boolean;
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
  context?: string;
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

function resolvePackageRoots(): string[] {
  const roots: string[] = [];
  const pushRoot = (root: string | undefined) => {
    if (!root) {
      return;
    }
    if (!roots.includes(root)) {
      roots.push(root);
    }
  };

  if (typeof __dirname === "string") {
    pushRoot(path.resolve(__dirname, ".."));
  }

  const importMetaUrl = getImportMetaUrl();
  if (importMetaUrl) {
    try {
      const filePath = fileURLToPath(importMetaUrl);
      pushRoot(path.resolve(path.dirname(filePath), ".."));
    } catch {
      // fall through to process.cwd()
    }
  }

  pushRoot(process.cwd());
  return roots;
}

function isFileMusl(file: string): boolean {
  return file.includes("libc.musl-") || file.includes("ld-musl-");
}

function isMusl(): boolean {
  if (process.platform !== "linux") {
    return false;
  }

  try {
    return fs.readFileSync("/usr/bin/ldd", "utf8").includes("musl");
  } catch {
    // ignore and fall back to report checks
  }

  const report =
    typeof process.report?.getReport === "function"
      ? (process.report.getReport() as { header?: { glibcVersionRuntime?: string }; sharedObjects?: string[] })
      : null;
  if (!report) {
    return false;
  }
  if (report.header && report.header.glibcVersionRuntime) {
    return false;
  }
  if (Array.isArray(report.sharedObjects) && report.sharedObjects.some(isFileMusl)) {
    return true;
  }

  try {
    return require("node:child_process").execSync("ldd --version", { encoding: "utf8" }).includes("musl");
  } catch {
    return false;
  }
}

function resolvePlatformPackageName(): string | null {
  const platformArchAbi = resolvePlatformArchAbi();
  return platformArchAbi ? `@codex-native/sdk-${platformArchAbi}` : null;
}

function resolvePlatformArchAbi(): string | null {
  if (process.platform === "darwin") {
    if (process.arch === "arm64" || process.arch === "x64") {
      return `darwin-${process.arch}`;
    }
    return null;
  }

  if (process.platform === "linux") {
    if (process.arch === "arm64" || process.arch === "x64") {
      return `linux-${process.arch}-${isMusl() ? "musl" : "gnu"}`;
    }
    return null;
  }

  if (process.platform === "win32") {
    if (process.arch === "arm64" || process.arch === "x64") {
      return `win32-${process.arch}-msvc`;
    }
    return null;
  }

  return null;
}

function resolveLocalBinaryCandidates(): string[] {
  const platformArchAbi = resolvePlatformArchAbi();
  if (!platformArchAbi) {
    return [];
  }

  const filename = `codex_native.${platformArchAbi}.node`;
  const candidates: string[] = [];

  // Check locations in order:
  // 1. dist/ (where our build outputs for local dev)
  // 2. npm/<platform>/ (where napi prepublish copies for publishing)
  for (const root of resolvePackageRoots()) {
    candidates.push(path.join(root, "dist", filename));
    candidates.push(path.join(root, "npm", platformArchAbi, filename));
  }

  return candidates;
}

function tryRequireNativeBinding(requireFn: NodeJS.Require, candidate: string): NativeBinding | null {
  try {
    const binding: NativeBinding = requireFn(candidate);
    binding.ensureTokioRuntime?.();
    return binding;
  } catch {
    return null;
  }
}

function resolveRequire() {
  // Always prefer a require anchored to this package, not a global/root require.
  // In pnpm workspace layouts, relying on the process CWD can make optional
  // platform packages (e.g. @codex-native/sdk-darwin-arm64) unreachable from
  // the main package.
  if (typeof __filename === "string") {
    try {
      return createRequire(__filename);
    } catch {
      // fall through
    }
  }

  const importMetaUrl = getImportMetaUrl();
  if (importMetaUrl) {
    try {
      return createRequire(importMetaUrl);
    } catch {
      // fall through
    }
  }

  // Final fallback: still create a stable require, but avoid globalThis.require
  // and prefer a package-adjacent path.
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
    // Allow napi-rs loaders and direct requires to honor the override.
    process.env.NAPI_RS_NATIVE_LIBRARY_PATH = envPath;
  }
  if (envPath && envPath.length > 0) {
    const binding = tryRequireNativeBinding(requireFn, envPath);
    if (binding) {
      cachedBinding = binding;
      return cachedBinding;
    }
  }

  let lastError: unknown;

  const localBinaryCandidates = resolveLocalBinaryCandidates();
  for (const candidate of localBinaryCandidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    const binding = tryRequireNativeBinding(requireFn, candidate);
    if (binding) {
      cachedBinding = binding;
      return cachedBinding;
    }
  }

  const platformPackage = resolvePlatformPackageName();
  if (platformPackage) {
    const binding = tryRequireNativeBinding(requireFn, platformPackage);
    if (binding) {
      cachedBinding = binding;
      return cachedBinding;
    }
  }

  const error =
    lastError ??
    new Error(
      `Native binding entrypoint not found. Checked: ${localBinaryCandidates.join(
        ", ",
      )} and ${platformPackage ?? "no platform package"}`,
    );
  console.warn("Failed to load native NAPI binding:", error);
  cachedBinding = null;
  return cachedBinding;
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
