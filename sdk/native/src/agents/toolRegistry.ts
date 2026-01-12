import type { NativeToolInvocation, NativeToolResult } from "../nativeBinding";

export interface ToolExecutionContext {
  name: string;
  callId: string;
  arguments: unknown;
  rawInvocation: NativeToolInvocation;
}

// Tool executors may return raw strings, native tool results, lightweight result wrappers,
// or arbitrary JSON-serializable objects (which will be JSON.stringified).
export type ToolExecutorResult =
  | string
  | NativeToolResult
  | { output?: string; error?: string; success?: boolean }
  | Record<string, unknown>
  | unknown[]
  | number
  | boolean
  | null
  | void;
export type ToolExecutor = (context: ToolExecutionContext) => Promise<ToolExecutorResult> | ToolExecutorResult;

const executors = new Map<string, ToolExecutor>();

export function registerCodexToolExecutor(name: string, executor: ToolExecutor) {
  executors.set(name, executor);
}

export function getCodexToolExecutor(name: string): ToolExecutor | undefined {
  return executors.get(name);
}

export function clearCodexToolExecutors() {
  executors.clear();
}
