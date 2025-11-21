import type { NativeToolInfo, NativeToolInvocation, NativeToolResult } from "./nativeBinding";

export type NativeToolDefinition = NativeToolInfo & {
  handler: (call: NativeToolInvocation) => Promise<NativeToolResult> | NativeToolResult;
};

export type CodexOptions = {
  codexPathOverride?: string;
  baseUrl?: string;
  apiKey?: string;
  /** Optional model provider override to use instead of the default */
  modelProvider?: string;
  /** Default model to use when a thread omits an explicit choice */
  defaultModel?: string;
  tools?: NativeToolDefinition[];
  /**
   * When true, constructor will not clear already-registered tools on the native binding.
   * Useful when other code (CLI, plugins) pre-register tools before instantiating Codex.
   */
  preserveRegisteredTools?: boolean;
};
