/**
 * Validate Agents ModelRequest.outputType -> Codex Responses text.format mapping
 * Reference: https://openai.github.io/openai-agents-js/
 */

import { describe, it, expect, beforeAll } from "@jest/globals";
import { fileURLToPath } from "node:url";
import {
  startResponsesTestProxy,
  sse,
  responseStarted,
  assistantMessage,
  responseCompleted,
} from "./responsesProxy.mjs";

function resolveNativeBindingPath() {
  const triplet = (() => {
    const { platform, arch } = process;
    if (platform === "darwin") {
      return arch === "arm64" ? "codex_native.darwin-arm64.node" : "codex_native.darwin-x64.node";
    }
    if (platform === "linux") {
      const suffix = process.env.MUSL ? "musl" : "gnu";
      return `codex_native.${platform}-${arch}-${suffix}.node`;
    }
    if (platform === "win32") {
      return arch === "arm64"
        ? "codex_native.win32-arm64-msvc.node"
        : "codex_native.win32-x64-msvc.node";
    }
    throw new Error(`Unsupported platform for tests: ${platform} ${arch}`);
  })();
  return fileURLToPath(new URL(`../${triplet}`, import.meta.url));
}

process.env.CODEX_NATIVE_BINDING = resolveNativeBindingPath();

let CodexProvider;
beforeAll(async () => {
  ({ CodexProvider } = await import("../dist/index.mjs"));
});

describe("Agents structured output -> Responses text.format", () => {
  it("passes OpenAI-style json_schema wrapper through provider", async () => {
    const wrapper = {
      type: "json_schema",
      json_schema: {
        name: "agent_output",
        strict: true,
        schema: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        },
      },
    };

    const { url, close, requests } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(responseStarted(), assistantMessage('{"value":"ok"}'), responseCompleted()),
      ],
    });

    try {
      const provider = new CodexProvider({ baseUrl: url, apiKey: "test", skipGitRepoCheck: true });
      const model = provider.getModel("gpt-5-codex");

      await model.getResponse({
        systemInstructions: "You are a test agent",
        input: "Return JSON",
        modelSettings: {},
        tools: [],
        outputType: wrapper,
        handoffs: [],
        tracing: { enabled: false },
      });

      const payload = requests[0]?.json;
      expect(payload).toBeDefined();
      expect(payload.text?.format?.type).toEqual("json_schema");
      // Name is currently fixed in core to "codex_output_schema"
      expect(payload.text?.format?.schema?.type).toEqual("object");
      expect(payload.text?.format?.schema?.properties?.value?.type).toEqual("string");
      expect(payload.text?.format?.strict).toBe(true);
    } finally {
      await close();
    }
  }, 15000);
});


