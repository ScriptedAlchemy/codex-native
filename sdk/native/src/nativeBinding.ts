import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ApprovalMode, SandboxMode, WorkspaceWriteOptions } from "./threadOptions";

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
  /** @deprecated Use sandboxMode and approvalMode instead */
  fullAuto?: boolean;
  reviewMode?: boolean;
  reviewHint?: string;
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
};

export type PlanStatus = "pending" | "in_progress" | "completed";

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

export type NativeBinding = {
  runThread(request: NativeRunRequest): Promise<string[]>;
  runThreadStream(
    request: NativeRunRequest,
    onEvent: (err: unknown, eventJson?: string) => void,
  ): Promise<void>;
  compactThread(request: NativeRunRequest): Promise<string[]>;
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
  emitPlanUpdate(request: NativeEmitPlanUpdateRequest): Promise<void>;
  modifyPlan(request: NativeModifyPlanRequest): Promise<void>;
  startTui?(request: NativeTuiRequest): Promise<NativeTuiSession>;
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

export type ApprovalRequest = {
  type: "shell" | "file_write" | "network_access";
  details?: unknown;
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
