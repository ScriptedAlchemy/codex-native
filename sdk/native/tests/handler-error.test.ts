import { describe, expect, it, beforeAll } from "@jest/globals";

// Setup native binding for tests
setupNativeBinding();
import { setupNativeBinding } from "./testHelpers";
import {
  assistantMessage,
  responseCompleted,
  responseStarted,
  sse,
  startResponsesTestProxy,
} from "./responsesProxy";



let Codex: any;
beforeAll(async () => {
  ({ Codex } = await import("../src/index"));
});

describe("native tool handler error path", () => {
  it("returns error content when handler returns { error }", async () => {
    const toolCallId = "tool_call_err";
    const firstResponse = sse(
      responseStarted("response_tool"),
      {
        type: "response.output_item.done",
        item: {
          id: toolCallId,
          type: "function_call",
          name: "grep",
          call_id: toolCallId,
          arguments: JSON.stringify({ pattern: "foo", path: "." }),
        },
      },
      responseCompleted("response_tool"),
    );

    const finalResponse = sse(
      responseStarted("response_final"),
      assistantMessage("OK", "assistant_message"),
      responseCompleted("response_final"),
    );

    const { url, close, requests } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [firstResponse, finalResponse],
    });

    try {
      const client = new Codex({ baseUrl: url, apiKey: "test", skipGitRepoCheck: true });

      // Override grep to return an error payload
      client.registerTool({
        name: "grep",
        description: "Custom grep",
        parameters: { type: "object", properties: {} },
        handler: () => ({ error: "custom grep failure" }),
      });

      const thread = client.startThread();
      const result = await thread.run("invoke grep");
      expect(result.finalResponse).toBe("OK");

      // The follow-up request should contain a function_call_output with the error content
      expect(requests.length).toBeGreaterThanOrEqual(2);
      const followUp = requests[1]?.json;
      const toolOutputEntry = followUp.input.find((e: any) => e.type === "function_call_output");
      expect(toolOutputEntry).toBeDefined();
      expect(toolOutputEntry.output).toContain("custom grep failure");
    } finally {
      await close();
    }
  }, 15000);
});


