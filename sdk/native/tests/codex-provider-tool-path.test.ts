/**
 * JS-side regression tests to ensure native tool callbacks deliver non-null
 * invocation payloads end-to-end through CodexProvider.
 */
import { describe, expect, it, jest } from "@jest/globals";
import { setupNativeBinding } from "./testHelpers";
import { getNativeBinding, CodexProvider } from "../src/index";
import type { NativeToolInvocation } from "../src/nativeBinding";

setupNativeBinding();
jest.setTimeout(20_000);

describe("CodexProvider native tool invocation path", () => {
  it("delivers function payloads from native binding through CodexProvider handler", async () => {
    const provider = new CodexProvider();
    const binding = getNativeBinding();
    expect(binding?.callRegisteredToolForTest).toBeDefined();

    // Register the tool via the provider's request registration path.
    (provider as any).registerRequestTools?.([
      {
        type: "function",
        name: "js_tool_roundtrip",
        description: "Echo symbol",
        parameters: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] },
      },
    ]);

    // Inject executor expected by executeToolViaFramework.
    (provider as any).toolExecutors.set("js_tool_roundtrip", async (ctx: any) => {
      return { echoed: ctx.arguments.symbol };
    });

    const invocation: NativeToolInvocation = {
      toolName: "js_tool_roundtrip",
      callId: "call-roundtrip",
      arguments: JSON.stringify({ symbol: "AAPL" }),
    };

    const result = await binding!.callRegisteredToolForTest!("js_tool_roundtrip", invocation);

    expect(result.success).toBe(true);
    expect(result.output).toBe(JSON.stringify({ echoed: "AAPL" }));
  });

  it("delivers custom input payloads (ToolPayload::Custom) intact to JS executor", async () => {
    const provider = new CodexProvider();
    const binding = getNativeBinding();
    expect(binding?.callRegisteredToolForTest).toBeDefined();

    (provider as any).registerRequestTools?.([
      {
        type: "function",
        name: "js_tool_custom_input",
        description: "Raw input passthrough",
        parameters: { type: "object", properties: {} },
      },
    ]);

    (provider as any).toolExecutors.set("js_tool_custom_input", async (ctx: any) => {
      return { raw: ctx.rawInvocation?.input ?? null };
    });

    const invocation: NativeToolInvocation = {
      toolName: "js_tool_custom_input",
      callId: "call-custom",
      input: "raw-json-string",
    };

    const result = await binding!.callRegisteredToolForTest!("js_tool_custom_input", invocation);

    expect(result.success).toBe(true);
    expect(result.output).toBe(JSON.stringify({ raw: "raw-json-string" }));
  });
});
