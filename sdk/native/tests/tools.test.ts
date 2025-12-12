import { describe, expect, it, beforeAll, jest } from "@jest/globals";
import { setupNativeBinding } from "./testHelpers";

// Setup native binding for tests
setupNativeBinding();

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
function createMockExecWithFunctionCall(
  toolCallId: string,
  toolName: string,
  args: any,
  finalText: string,
  toolHandler?: jest.Mock,
) {
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
      // If handler provided, simulate invocation
      if (toolHandler) {
        toolHandler(null, {
          toolName,
          callId: toolCallId,
          arguments: JSON.stringify(args),
        });
      }
      // Emit tool output
      yield JSON.stringify({
        FunctionCallOutput: {
          call_id: toolCallId,
          output: JSON.stringify({ output: `tool-output:${args.text ?? ""}` }),
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

describe("native tool registration", () => {
  it("registers a simple native tool", () => {
    const codex = new Codex({ skipGitRepoCheck: true });
    expect(() =>
      codex.registerTool({
        name: "echo",
        parameters: { type: "object", properties: {} },
        handler: () => ({ output: "ok" }),
      }),
    ).not.toThrow();
  });

  it("invokes registered tool handlers and forwards outputs", async () => {
    const toolCallId = "tool_call_1";
    const handler = jest.fn((err: any, invocation: any) => {
      const args = invocation?.arguments;
      const parsed = args ? JSON.parse(args) : {};
      return { output: `tool-output:${parsed.text ?? ""}`, success: true };
    });

    const codex = new Codex({ skipGitRepoCheck: true });

    // Register the tool
    codex.registerTool({
      name: "echo",
      description: "Echo tool",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
        },
        required: ["text"],
      },
      handler,
    });

    // Inject mock exec that simulates a function call
    (codex as any).exec = createMockExecWithFunctionCall(
      toolCallId,
      "echo",
      { text: "hello" },
      "Tool says hi",
      handler,
    );

    const thread = codex.startThread({ skipGitRepoCheck: true });
    const result = await thread.run("call the tool");

    // Handler was called by the mock
    expect(handler).toHaveBeenCalled();
    const invocation = handler.mock.calls[0]?.[1] as any;
    expect(invocation).toBeTruthy();
    expect(invocation?.toolName).toBe("echo");
    expect(invocation?.callId).toBe(toolCallId);
    expect(JSON.parse(invocation?.arguments ?? "{}")).toEqual({ text: "hello" });

    expect(result.finalResponse).toBe("Tool says hi");
  });
});
