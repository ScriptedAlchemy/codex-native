import type { NativeToolInfo, NativeToolInvocation, NativeToolResult } from "./nativeBinding";

export type NativeToolDefinition = NativeToolInfo & {
  handler: (call: NativeToolInvocation) => Promise<NativeToolResult> | NativeToolResult;
};

export type CodexOptions = {
  codexPathOverride?: string;
  baseUrl?: string;
  apiKey?: string;
  tools?: NativeToolDefinition[];
};
