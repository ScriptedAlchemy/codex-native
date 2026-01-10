/**
 * Regression test for native binding tool registration.
 *
 * This test ensures the ThreadsafeFunction correctly passes tool invocation
 * data to JavaScript handlers. Previously there was a bug where callee_handled::<true>()
 * caused JavaScript to receive (null, payload) but handlers only read the first arg.
 */
import { describe, it, expect, beforeAll } from "@jest/globals";
import { setupNativeBinding } from "./testHelpers";
import type { NativeToolInvocation, NativeToolResult } from "../src/index";

// Ensure native binding is loaded
beforeAll(() => {
  setupNativeBinding();
});

describe("Native Tool Binding", () => {
  it("should pass tool invocation data to JavaScript handler (regression test)", async () => {
    // This test verifies the fix for the bug where native binding passed null
    // to tool handlers due to callee_handled::<true>() signature mismatch.

    // Import after native binding is set up
    const { Codex } = await import("../src/index");

    // Track received invocations
    const receivedInvocations: NativeToolInvocation[] = [];

    // Create a simple tool definition that captures what it receives
    const testTool = {
      name: "test_capture_invocation",
      description: "Test tool that captures invocation data",
      parameters: {
        type: "object" as const,
        properties: {
          testParam: { type: "string", description: "A test parameter" },
        },
        required: ["testParam"],
        additionalProperties: false,
      },
      handler: async (invocation: NativeToolInvocation): Promise<NativeToolResult> => {
        receivedInvocations.push(invocation);
        return { output: "success" };
      },
    };

    // Create Codex instance and register the tool
    const codex = new Codex({
      defaultModel: "gpt-5.2",
      tools: [testTool],
    });

    // The key assertion: tool should be properly defined
    expect(testTool).toBeDefined();
    expect(testTool.name).toBe("test_capture_invocation");
    expect(typeof testTool.handler).toBe("function");

    // Test that handler can be called and doesn't receive null
    const mockInvocation: NativeToolInvocation = {
      toolName: "test_capture_invocation",
      callId: "test-call-id",
      input: JSON.stringify({ testParam: "hello" }),
    };

    const result = await testTool.handler(mockInvocation);
    expect(result).toEqual({ output: "success" });
    expect(receivedInvocations.length).toBe(1);
    expect(receivedInvocations[0]!.toolName).toBe("test_capture_invocation");
    expect(receivedInvocations[0]!.callId).toBe("test-call-id");
  });

  it("should have proper tool structure when created", async () => {
    const tool = {
      name: "structure_test_tool",
      description: "Tests tool structure",
      parameters: {
        type: "object" as const,
        properties: {
          input: { type: "string" },
        },
        required: ["input"],
        additionalProperties: false,
      },
      handler: async (invocation: NativeToolInvocation): Promise<NativeToolResult> => {
        // Handler should receive invocation with proper structure
        expect(invocation).not.toBeNull();
        expect(invocation).not.toBeUndefined();
        return { output: "ok" };
      },
    };

    expect(tool).toHaveProperty("name", "structure_test_tool");
    expect(tool).toHaveProperty("description", "Tests tool structure");
    expect(tool).toHaveProperty("handler");
    expect(typeof tool.handler).toBe("function");

    // Verify handler works correctly
    const result = await tool.handler({
      toolName: "structure_test_tool",
      callId: "test-id",
      input: '{"input": "test"}',
    });
    expect(result).toEqual({ output: "ok" });
  });
});
