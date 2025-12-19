export type {
  ThreadEvent,
  ThreadStartedEvent,
  TurnStartedEvent,
  TurnCompletedEvent,
  TurnFailedEvent,
  ItemStartedEvent,
  ItemUpdatedEvent,
  ItemCompletedEvent,
  ThreadError,
  ThreadErrorEvent,
  Usage,
} from "./events";
export type {
  ThreadItem,
  AgentMessageItem,
  ReasoningItem,
  CommandExecutionItem,
  CommandExecutionStatus,
  FileChangeItem,
  PatchApplyStatus,
  PatchChangeKind,
  FileUpdateChange,
  McpToolCallItem,
  McpToolCallStatus,
  WebSearchItem,
  TodoListItem,
  TodoItem,
  ErrorItem,
} from "./items";

export { Thread } from "./thread";
export type { RunResult, RunStreamedResult, Input, UserInput, ForkOptions } from "./thread";

export { Codex } from "./codex";
export type { ConversationListOptions, ConversationListPage, ConversationSummary } from "./codex";

export type { CodexOptions, NativeToolDefinition } from "./codexOptions";
export type { NativeToolInterceptorContext } from "./codex";
export type { NativeToolInvocation, NativeToolResult, NativeForkResult } from "./nativeBinding";
export type { ApprovalRequest } from "./nativeBinding";
export type { TokenizerOptions, TokenizerEncodeOptions } from "./nativeBinding";

export { startTui, runTui } from "./tui";
export type {
  NativeTuiRequest,
  NativeTuiExitInfo,
  NativeTokenUsage,
  NativeUpdateActionInfo,
  NativeUpdateActionKind,
  RunTuiOptions,
  TuiSession,
} from "./tui";

export type { ThreadOptions, ApprovalMode, SandboxMode } from "./threadOptions";
export type { TurnOptions } from "./turnOptions";
export type { SkillDefinition, SkillMentionTrigger } from "./skills";
export type {
  ReviewInvocationOptions,
  ReviewTarget,
  CurrentChangesReview,
  BranchReview,
  CommitReview,
  CustomReview,
} from "./reviewOptions";
export type {
  FastEmbedInitOptions,
  FastEmbedEmbedRequest,
  RepoDiffSummary,
  RepoDiffFileChange,
  RepoDiffSummaryOptions,
} from "./nativeBinding";

// LSP diagnostics integration
export {
  LspDiagnosticsBridge,
  attachLspDiagnostics,
  LspManager,
  DEFAULT_SERVERS,
  findServerForFile,
  resolveWorkspaceRoot,
  formatDiagnosticsForBackgroundEvent,
  formatDiagnosticsForTool,
  formatDiagnosticsWithSummary,
  filterBySeverity,
  summarizeDiagnostics,
} from "./lsp";
export type {
  FileDiagnostics,
  LspDiagnosticSeverity,
  LspManagerOptions,
  LspServerConfig,
  NormalizedDiagnostic,
  WorkspaceLocator,
  DiagnosticSeverity,
} from "./lsp";

// OpenAI Agents framework integration
export { CodexProvider, codexTool } from "./agents";
export type { CodexProviderOptions, CodexToolOptions } from "./agents";
export { formatStream } from "./agents";
export type { FormattedStream, FormatStreamOptions, ToolCallEvent } from "./agents";
export { OpenCodeAgent } from "./agents";
export type { OpenCodeAgentOptions, DelegationResult, PermissionDecision, PermissionRequest } from "./agents";

// Cloud tasks (remote agent tasks; applied locally)
export { CloudTasks } from "./cloudTasks";
export type {
  CloudTaskSummary,
  CloudTasksOptions,
  CloudApplyOutcome,
  CloudTaskStatus,
  CloudApplyStatus,
  DiffSummary as CloudDiffSummary,
} from "./cloudTasks";

// Unified logging system
export { Logger, ScopedLogger, logger, createThreadLogger, runThreadTurnWithLogs, LogLevel } from "./logging";
export type { LogScope, LoggerConfig, LogOutput, ThreadLoggingSink, LogEntry } from "./logging";

// Reverie semantic search and quality filtering
export {
  DEFAULT_REVERIE_LIMIT,
  DEFAULT_REVERIE_MAX_CANDIDATES,
  REVERIE_EMBED_MODEL,
  REVERIE_RERANKER_MODEL,
  REVERIE_CANDIDATE_MULTIPLIER,
  REVERIE_LLM_GRADE_THRESHOLD,
  DEFAULT_RERANKER_TOP_K,
  DEFAULT_RERANKER_BATCH_SIZE,
  isValidReverieExcerpt,
  deduplicateReverieInsights,
  applyQualityPipeline,
  logReverieSearch,
  logReverieFiltering,
  logReverieInsights,
  logReverieHintQuality,
  logLLMGrading,
  logApprovedReveries,
  logMultiLevelSearch,
  logLevelResults,
  logMultiLevelSummary,
  truncateText,
  gradeReverieRelevance,
  gradeReveriesInParallel,
  extractKeySymbols,
  searchReveries,
  applyReveriePipeline,
  applyFileReveriePipeline,
  searchMultiLevel,
  searchProjectLevel,
  searchBranchLevel,
  searchFileLevel,
  buildProjectContext,
  buildBranchContext,
  buildFileContext,
  contextToQuery,
  formatFileList,
} from "./reverie";
export type {
  ReverieInsight,
  ReverieEpisodeSummary,
  ReverieSearchOptions,
  GradingOptions,
  ReverieFilterStats,
  ReverieResult,
  QualityFilterStats,
  AgentRunner,
  ReveriePipelineOptions,
  ReveriePipelineResult,
  ReverieSearchLevel,
  ProjectLevelContext,
  BranchLevelContext,
  FileLevelContext,
  ReverieContext,
} from "./reverie";

// SSE test helpers (exposed for TypeScript tests)
// Re-export the native binding functions directly
import { getNativeBinding } from "./nativeBinding";
export {
  reverieListConversations,
  reverieSearchConversations,
  reverieSearchSemantic,
  reverieIndexSemantic,
  reverieGetConversationInsights,
  encodeToToon,
  fastEmbedInit,
  fastEmbedEmbed,
  tokenizerCount,
  tokenizerEncode,
  tokenizerDecode,
  collectRepoDiffSummary,
} from "./nativeBinding";

export type {
  ReverieSemanticSearchOptions,
  ReverieSemanticIndexStats,
  FastEmbedRerankerModelCode,
} from "./nativeBinding";

export function evCompleted(id: string): string {
  const binding = getNativeBinding();
  if (!binding) throw new Error("Native binding not available");
  return (binding as any).evCompleted(id);
}

export function evResponseCreated(id: string): string {
  const binding = getNativeBinding();
  if (!binding) throw new Error("Native binding not available");
  return (binding as any).evResponseCreated(id);
}

export function evAssistantMessage(id: string, text: string): string {
  const binding = getNativeBinding();
  if (!binding) throw new Error("Native binding not available");
  return (binding as any).evAssistantMessage(id, text);
}

export function evFunctionCall(callId: string, name: string, args: string): string {
  const binding = getNativeBinding();
  if (!binding) throw new Error("Native binding not available");
  return (binding as any).evFunctionCall(callId, name, args);
}

export function sse(events: string[]): string {
  const binding = getNativeBinding();
  if (!binding) throw new Error("Native binding not available");
  return (binding as any).sse(events);
}
