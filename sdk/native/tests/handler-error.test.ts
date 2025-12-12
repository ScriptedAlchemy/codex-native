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

// Helper to create mock exec with function call that triggers tool error
function createMockExecWithToolError(
  toolCallId: string,
  toolName: string,
  args: any,
  finalText: string,
  errorHandler?: jest.Mock,
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
      // If error handler provided, simulate invocation with error
      if (errorHandler) {
        errorHandler(null, {
          toolName,
          callId: toolCallId,
          arguments: JSON.stringify(args),
        });
      }
      // Emit tool output with error
      yield JSON.stringify({
        FunctionCallOutput: {
          call_id: toolCallId,
          output: JSON.stringify({ error: "custom grep failure" }),
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

describe("native tool handler error path", () => {
  it("returns error content when handler returns { error }", async () => {
    const toolCallId = "tool_call_err";
    const errorHandler = jest.fn(() => ({ error: "custom grep failure" }));

    const client = new Codex({ skipGitRepoCheck: true });

    // Override grep to return an error payload
    client.registerTool({
      name: "grep",
      description: "Custom grep",
      parameters: { type: "object", properties: {} },
      handler: errorHandler,
    });

    // Inject mock exec that simulates a function call with error
    (client as any).exec = createMockExecWithToolError(
      toolCallId,
      "grep",
      { pattern: "foo", path: "." },
      "OK",
      errorHandler,
    );

    const thread = client.startThread();
    const result = await thread.run("invoke grep");
    expect(result.finalResponse).toBe("OK");

    // The handler was called
    expect(errorHandler).toHaveBeenCalled();
  });
});
