import { describe, expect, it, beforeAll, jest } from "@jest/globals";

// Setup native binding for tests
setupNativeBinding();
import { setupNativeBinding } from "./testHelpers";

// Allow extra time for async operations
jest.setTimeout(20000);

let Codex: any;

beforeAll(async () => {
  ({ Codex } = await import("../src/index"));
});

// Helper to create mock exec that yields proper Rust-format events
function createMockExec(responseText: string, itemId: string = "item_0") {
  return {
    run: jest.fn(async function* () {
      yield JSON.stringify({ ThreadStarted: { thread_id: "mock-thread-id" } });
      yield JSON.stringify({ TurnStarted: {} });
      yield JSON.stringify({ ItemCompleted: { item: { id: itemId, type: "agent_message", text: responseText } } });
      yield JSON.stringify({
        TurnCompleted: {
          usage: { input_tokens: 42, output_tokens: 5 },
        },
      });
    }),
    requiresOutputSchemaFile: () => false,
  };
}

// Helper to create mock exec with function call that triggers tool execution
function createMockExecWithFunctionCall(toolCallId: string, toolName: string, args: any, finalText: string) {
  return {
    run: jest.fn(async function* () {
      yield JSON.stringify({ ThreadStarted: { thread_id: "mock-thread-id" } });
      yield JSON.stringify({ TurnStarted: {} });
      // Emit function call event
      yield JSON.stringify({
        FunctionCall: {
          call_id: toolCallId,
          name: toolName,
          arguments: JSON.stringify(args),
        },
      });
      // Emit tool output
      yield JSON.stringify({
        FunctionCallOutput: {
          call_id: toolCallId,
          output: JSON.stringify({ intercepted: true }),
        },
      });
      yield JSON.stringify({ ItemCompleted: { item: { id: "item_0", type: "agent_message", text: finalText } } });
      yield JSON.stringify({
        TurnCompleted: {
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      });
    }),
    requiresOutputSchemaFile: () => false,
  };
}

describe("native tool interceptors", () => {
  describe("tool registration", () => {
    it("registers a custom tool with Codex", () => {
      const client = new Codex({ skipGitRepoCheck: true });

      const toolDef = {
        name: "test_tool",
        description: "A test tool",
        parameters: {
          type: "object",
          properties: {
            input: { type: "string" },
          },
          required: ["input"],
        },
        handler: async () => JSON.stringify({ result: "ok" }),
      };

      // Should not throw
      expect(() => client.registerTool(toolDef)).not.toThrow();
    });

    it("registers multiple tools", () => {
      const client = new Codex({ skipGitRepoCheck: true });

      const tools = [
        {
          name: "tool_a",
          description: "Tool A",
          parameters: { type: "object", properties: {} },
          handler: async () => "A",
        },
        {
          name: "tool_b",
          description: "Tool B",
          parameters: { type: "object", properties: {} },
          handler: async () => "B",
        },
      ];

      for (const tool of tools) {
        expect(() => client.registerTool(tool)).not.toThrow();
      }
    });
  });

  describe("interceptor registration", () => {
    it("registers a tool interceptor", () => {
      const client = new Codex({ skipGitRepoCheck: true });

      // First register the tool
      client.registerTool({
        name: "interceptable_tool",
        description: "Tool to intercept",
        parameters: { type: "object", properties: {} },
        handler: async () => JSON.stringify({ original: true }),
      });

      // Then register interceptor - should not throw
      expect(() => {
        client.registerToolInterceptor("interceptable_tool", async ({ invocation, callBuiltin }: any) => {
          return {
            output: JSON.stringify({ intercepted: true }),
            success: true,
          };
        });
      }).not.toThrow();
    });

    it("can register interceptor for builtin tools", () => {
      const client = new Codex({ skipGitRepoCheck: true });

      // Register interceptor for read_file (builtin tool)
      expect(() => {
        client.registerToolInterceptor("read_file", async ({ invocation, callBuiltin }: any) => {
          const result = await callBuiltin(invocation);
          return {
            output: `Modified: ${result.output}`,
            success: true,
          };
        });
      }).not.toThrow();
    });
  });

  describe("interceptor callback logic", () => {
    it("interceptor can modify output", async () => {
      const mockInvocation = {
        name: "test_tool",
        arguments: JSON.stringify({ input: "test" }),
        callId: "call_123",
      };

      const mockBuiltinResult = {
        output: JSON.stringify({ original: true }),
        success: true,
      };

      // Test the interceptor callback logic in isolation
      const interceptorHandler = async ({ invocation, callBuiltin }: any) => {
        const builtinResult = await callBuiltin(invocation);
        const parsed = JSON.parse(builtinResult.output || "{}");
        return {
          output: JSON.stringify({ ...parsed, intercepted: true }),
          success: true,
        };
      };

      // Simulate calling the interceptor with mock callBuiltin
      const mockCallBuiltin = jest.fn(async () => mockBuiltinResult);
      const result = await interceptorHandler({
        invocation: mockInvocation,
        callBuiltin: mockCallBuiltin,
      });

      expect(mockCallBuiltin).toHaveBeenCalledWith(mockInvocation);
      expect(result.success).toBe(true);
      const output = JSON.parse(result.output);
      expect(output.original).toBe(true);
      expect(output.intercepted).toBe(true);
    });

    it("interceptor handles builtin failure gracefully", async () => {
      const mockInvocation = {
        name: "test_tool",
        arguments: "{}",
        callId: "call_456",
      };

      const interceptorHandler = async ({ invocation, callBuiltin }: any) => {
        try {
          const builtinResult = await callBuiltin(invocation);
          return {
            output: builtinResult.output,
            success: builtinResult.success,
          };
        } catch (error) {
          return {
            output: JSON.stringify({ error: "Builtin failed", intercepted: true }),
            success: false,
          };
        }
      };

      // Simulate callBuiltin throwing
      const mockCallBuiltin = jest.fn(async () => {
        throw new Error("Builtin execution failed");
      });

      const result = await interceptorHandler({
        invocation: mockInvocation,
        callBuiltin: mockCallBuiltin,
      });

      expect(result.success).toBe(false);
      const output = JSON.parse(result.output);
      expect(output.intercepted).toBe(true);
    });

    it("interceptor can skip calling builtin", async () => {
      const mockInvocation = {
        name: "override_tool",
        arguments: JSON.stringify({ value: 42 }),
        callId: "call_789",
      };

      // Interceptor that completely overrides builtin
      const interceptorHandler = async ({ invocation }: any) => {
        const args = JSON.parse(invocation.arguments);
        return {
          output: JSON.stringify({ custom: true, doubled: args.value * 2 }),
          success: true,
        };
      };

      const mockCallBuiltin = jest.fn();

      const result = await interceptorHandler({
        invocation: mockInvocation,
        callBuiltin: mockCallBuiltin,
      });

      expect(mockCallBuiltin).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      const output = JSON.parse(result.output);
      expect(output.custom).toBe(true);
      expect(output.doubled).toBe(84);
    });
  });

  describe("thread with tools", () => {
    it("runs thread with registered tools", async () => {
      const client = new Codex({ skipGitRepoCheck: true });
      (client as any).exec = createMockExec("Tool run complete");

      client.registerTool({
        name: "my_tool",
        description: "A custom tool",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
        },
        handler: async () => JSON.stringify({ found: true }),
      });

      const thread = client.startThread();
      const result = await thread.run("Use my_tool to search");

      expect(result.finalResponse).toBe("Tool run complete");
    });

    it("runs streamed with tools", async () => {
      const client = new Codex({ skipGitRepoCheck: true });
      (client as any).exec = createMockExec("Streaming complete");

      client.registerTool({
        name: "stream_tool",
        description: "A streaming tool",
        parameters: { type: "object", properties: {} },
        handler: async () => "streamed",
      });

      const thread = client.startThread();
      const streamed = await thread.runStreamed("Stream with tool");

      const events = [];
      for await (const event of streamed.events) {
        events.push(event);
      }

      const turnCompleted = events.find((e) => e.type === "turn.completed");
      expect(turnCompleted).toBeDefined();
    });
  });

  describe("clearTools", () => {
    it("clears registered tools", () => {
      const client = new Codex({ skipGitRepoCheck: true });

      client.registerTool({
        name: "temp_tool",
        description: "Temporary tool",
        parameters: { type: "object", properties: {} },
        handler: async () => "temp",
      });

      // Should not throw
      expect(() => client.clearTools()).not.toThrow();
    });
  });

  describe("tool with interceptor flow", () => {
    it("processes function call events from mock exec", async () => {
      const client = new Codex({ skipGitRepoCheck: true });
      (client as any).exec = createMockExecWithFunctionCall(
        "call_123",
        "intercepted_tool",
        { payload: "test" },
        "Function processed",
      );

      // Register tool and interceptor
      let toolCalled = false;
      client.registerTool({
        name: "intercepted_tool",
        description: "Tool with interceptor",
        parameters: {
          type: "object",
          properties: {
            payload: { type: "string" },
          },
        },
        handler: async () => {
          toolCalled = true;
          return JSON.stringify({ from_handler: true });
        },
      });

      let interceptorCalled = false;
      client.registerToolInterceptor("intercepted_tool", async ({ invocation, callBuiltin }: any) => {
        interceptorCalled = true;
        // In a real scenario, callBuiltin would invoke the handler
        // With mocking, we just simulate the behavior
        return {
          output: JSON.stringify({ intercepted: true, callId: invocation.callId }),
          success: true,
        };
      });

      const thread = client.startThread();
      const result = await thread.run("Execute function");

      // The mock exec yields the events, so we get the final response
      expect(result.finalResponse).toBe("Function processed");

      // Note: With exec-level mocking, the actual tool/interceptor execution
      // doesn't happen because that occurs in the native Rust code.
      // The mock just yields pre-defined events.
      // This test verifies the event processing works correctly.
    });
  });
});
