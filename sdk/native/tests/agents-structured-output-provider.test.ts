/**
 * Validate Agents ModelRequest.outputType -> Codex Responses text.format mapping
 * Reference: https://openai.github.io/openai-agents-js/
 */

import { describe, it, expect, beforeAll } from "@jest/globals";
import { setupNativeBinding } from "./testHelpers";

// Setup native binding for tests
setupNativeBinding();
import {
  startResponsesTestProxy,
  sse,
  responseStarted,
  assistantMessage,
  responseCompleted,
} from "./responsesProxy";



let CodexProvider: any;
beforeAll(async () => {
  ({ CodexProvider } = await import("../src/index"));
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


