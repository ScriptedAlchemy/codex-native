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
} from "./nativeBinding";

// OpenAI Agents framework integration
export { CodexProvider, codexTool } from "./agents";
export type { CodexProviderOptions, CodexToolOptions } from "./agents";
export { formatStream } from "./agents";
export type { FormattedStream, FormatStreamOptions, ToolCallEvent } from "./agents";

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

// SSE test helpers (exposed for TypeScript tests)
// Re-export the native binding functions directly
import { getNativeBinding } from "./nativeBinding";
export {
  reverieListConversations,
  reverieSearchConversations,
  reverieGetConversationInsights,
  fastEmbedInit,
  fastEmbedEmbed,
  tokenizerCount,
  tokenizerEncode,
  tokenizerDecode,
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
