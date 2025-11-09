import { describe, expect, it, beforeAll } from "@jest/globals";
import { fileURLToPath } from "node:url";
import {
  assistantMessage,
  responseCompleted,
  responseStarted,
  sse,
  startResponsesTestProxy,
} from "./responsesProxy.mjs";

function resolveNativeBindingPath() {
  const { platform, arch } = process;
  if (platform === "darwin") {
    const suffix = arch === "arm64" ? "arm64" : "x64";
    return fileURLToPath(new URL(`../codex_native.darwin-${suffix}.node`, import.meta.url));
  }
  if (platform === "win32") {
    const suffix = arch === "arm64" ? "arm64" : "x64";
    return fileURLToPath(new URL(`../codex_native.win32-${suffix}-msvc.node`, import.meta.url));
  }
  if (platform === "linux") {
    const suffix = process.env.MUSL ? "musl" : "gnu";
    return fileURLToPath(new URL(`../codex_native.linux-${arch}-${suffix}.node`, import.meta.url));
  }
  throw new Error(`Unsupported platform for tests: ${platform} ${arch}`);
}

process.env.CODEX_NATIVE_BINDING = resolveNativeBindingPath();

let Codex;
beforeAll(async () => {
  ({ Codex } = await import("../dist/index.mjs"));
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
      const client = new Codex({ baseUrl: url, apiKey: "test" });

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
      const followUp = requests[1].json;
      const toolOutputEntry = followUp.input.find((e) => e.type === "function_call_output");
      expect(toolOutputEntry).toBeDefined();
      expect(toolOutputEntry.output).toContain("custom grep failure");
    } finally {
      await close();
    }
  }, 15000);
});


