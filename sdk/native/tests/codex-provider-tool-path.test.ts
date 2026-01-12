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

    // Ensure the tool is registered with the native binding via CodexProvider's request path.
    // The executor is resolved via the global registry (registerCodexToolExecutor).
    (provider as any).getModel("test-model");

    // Register the tool through Codex so the native binding has a real handler.
    // This validates the tool payload wiring end-to-end at the binding boundary.
    (provider as any).codex?.registerTool?.({
      name: "js_tool_roundtrip",
      description: "Echo symbol",
      parameters: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] },
      handler: async (inv: NativeToolInvocation) => {
        const parsed = inv.arguments ? JSON.parse(inv.arguments) : {};
        return { output: JSON.stringify({ echoed: parsed.symbol }) };
      },
    });

    const invocation: NativeToolInvocation = {
      toolName: "js_tool_roundtrip",
      callId: "call-roundtrip",
      arguments: JSON.stringify({ symbol: "AAPL" }),
    };

    const result = await binding!.callRegisteredToolForTest!("js_tool_roundtrip", invocation);

    // NativeToolResponse.success is optional; treat "no error" as success.
    expect(result.error ?? null).toBeNull();
    expect(result.output).toBe(JSON.stringify({ echoed: "AAPL" }));
  });

  it("delivers custom input payloads (ToolPayload::Custom) intact to JS executor", async () => {
    const provider = new CodexProvider();
    const binding = getNativeBinding();
    expect(binding?.callRegisteredToolForTest).toBeDefined();

    (provider as any).getModel("test-model");

    (provider as any).codex?.registerTool?.({
      name: "js_tool_custom_input",
      description: "Raw input passthrough",
      parameters: { type: "object", properties: {} },
      handler: async (inv: NativeToolInvocation) => {
        return { output: JSON.stringify({ raw: inv.input ?? null }) };
      },
    });

    const invocation: NativeToolInvocation = {
      toolName: "js_tool_custom_input",
      callId: "call-custom",
      input: "raw-json-string",
    };

    const result = await binding!.callRegisteredToolForTest!("js_tool_custom_input", invocation);

    expect(result.error ?? null).toBeNull();
    expect(result.output).toBe(JSON.stringify({ raw: "raw-json-string" }));
  });
});
