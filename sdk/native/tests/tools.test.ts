import { describe, expect, it, beforeAll, jest } from "@jest/globals";
import { setupNativeBinding } from "./testHelpers";

// Setup native binding for tests
setupNativeBinding();

// Setup native binding for tests

import { assistantMessage, responseCompleted, responseStarted, sse, startResponsesTestProxy } from "./responsesProxy";



let Codex: any;

beforeAll(async () => {
  ({ Codex } = await import("../src/index"));
});

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
    const handler = jest.fn((err, invocation) => {
      console.log("native tool invocation", err, invocation);
      const args = (invocation as any)?.arguments;
      const parsed = args ? JSON.parse(args) : {};
      return { output: `tool-output:${parsed.text ?? ""}`, success: true };
    });

    const firstResponse = sse(
      responseStarted("response_tool"),
      {
        type: "response.output_item.done",
        item: {
          id: toolCallId,
          type: "function_call",
          name: "echo",
          call_id: toolCallId,
          arguments: JSON.stringify({ text: "hello" }),
        },
      },
      responseCompleted("response_tool"),
    );

    const finalResponse = sse(
      responseStarted("response_final"),
      assistantMessage("Tool says hi", "assistant_message"),
      responseCompleted("response_final"),
    );

    const { url, close, requests } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [firstResponse, finalResponse],
    });

    try {
      const codex = new Codex({ baseUrl: url, apiKey: "test", skipGitRepoCheck: true });
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

      const thread = codex.startThread({ skipGitRepoCheck: true });
      const result = await thread.run("call the tool");

      expect(handler).toHaveBeenCalledTimes(1);
      const err = handler.mock.calls[0]?.[0];
      const invocation = handler.mock.calls[0]?.[1] as any;
      expect(err).toBeNull();
      expect(invocation).toBeTruthy();
      expect(invocation?.toolName).toBe("echo");
      expect(invocation?.callId).toBe(toolCallId);
      expect(JSON.parse(invocation?.arguments ?? "{}")).toEqual({ text: "hello" });

      expect(requests.length).toBeGreaterThanOrEqual(2);
      const followUp = requests[1]?.json;
      const toolOutputEntry = followUp?.input?.find((entry: any) => entry.type === "function_call_output");
      expect(toolOutputEntry).toBeDefined();
      // FunctionCallOutputPayload serializes as a plain string when content_items is None
      expect(toolOutputEntry.output).toBe("tool-output:hello");

      expect(result.finalResponse).toBe("Tool says hi");
    } finally {
      await close();
    }
  });
});
