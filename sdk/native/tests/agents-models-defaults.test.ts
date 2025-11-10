/**
 * Validate model resolution paths per Agents SDK docs:
 * - https://openai.github.io/openai-agents-js/guides/models/
 * - https://openai.github.io/openai-agents-js/guides/running-agents/
 */

import { describe, it, expect, beforeAll } from "@jest/globals";
import { setupNativeBinding } from "./testHelpers";
import {
  startResponsesTestProxy,
  sse,
  responseStarted,
  assistantMessage,
  responseCompleted,
} from "./responsesProxy";

// Setup native binding for tests
setupNativeBinding();

let CodexProvider: any;
beforeAll(async () => {
  ({ CodexProvider } = await import("../src/index"));
});

const isCI = process.env.CI === "true" || process.env.CI === "1";
const mockEnv = process.env.CODEX_NATIVE_RUN_AGENTS_MOCK;
const shouldRunMockTests = mockEnv !== "0";
const mockTest = shouldRunMockTests ? it : it.skip;
describe("Agents models defaults/resolution with CodexProvider", () => {
  mockTest("uses provider defaultModel when agent doesn't specify", async () => {
    const { url, close, requests } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(
          responseStarted("response_1"),
          assistantMessage("runner default model ok"),
          responseCompleted("response_1"),
        ),
      ],
    });

    try {
      const provider = new CodexProvider({ baseUrl: url, skipGitRepoCheck: true, defaultModel: "gpt-5-codex" });
      const model = provider.getModel(); // Use default model
      const result = await model.getResponse({
        systemInstructions: "Respond plainly.",
        input: "hello",
        modelSettings: {},
        tools: [],
        outputType: undefined,
        handoffs: [],
        tracing: { enabled: false },
      });
      expect(result).toBeDefined();
      expect(requests.length).toBeGreaterThan(0);
      expect(requests[0]?.json?.model).toBe("gpt-5-codex");
    } finally {
      await close();
    }
  }, 15000);

  mockTest("accepts agent-level model name over provider default", async () => {
    const { url, close, requests } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(
          responseStarted("response_1"),
          assistantMessage("agent model ok"),
          responseCompleted("response_1"),
        ),
      ],
    });

    try {
      const provider = new CodexProvider({ baseUrl: url, skipGitRepoCheck: true, defaultModel: "gpt-5" });
      const model = provider.getModel("gpt-5-codex"); // Override default
      const result = await model.getResponse({
        systemInstructions: "Respond plainly.",
        input: "hello",
        modelSettings: {},
        tools: [],
        outputType: undefined,
        handoffs: [],
        tracing: { enabled: false },
      });
      expect(result).toBeDefined();
      expect(requests.length).toBeGreaterThan(0);
      expect(requests[0]?.json?.model).toBe("gpt-5-codex");
    } finally {
      await close();
    }
  }, 15000);

  it("rejects unsupported non-GPT-5 model names", async () => {
    const provider = new CodexProvider({ skipGitRepoCheck: true });
    const model = provider.getModel("gpt-4.1"); // not allowed in our binding
    await expect(async () => {
      await model.getResponse({
        systemInstructions: "You are a test",
        input: "hi",
        modelSettings: {},
        tools: [],
        outputType: undefined,
        handoffs: [],
        tracing: { enabled: false },
      });
    }).rejects.toThrow(/Invalid model "gpt-4\.1"/);
  });

  const ossEnv = process.env.CODEX_NATIVE_RUN_OSS_TEST;
  const shouldRunOss = (!isCI && ossEnv !== "0") || ossEnv === "1";
  (shouldRunOss ? it : it.skip)("accepts OSS model when provider is configured for OSS", async () => {
    const { Agent, Runner } = await import("@openai/agents");
    const { url, close } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(
          responseStarted("response_1"),
          assistantMessage("oss ok"),
          responseCompleted("response_1"),
        ),
      ],
    });

    try {
      const provider = new CodexProvider({ baseUrl: url, skipGitRepoCheck: true, oss: true });
      const runner = new Runner({ modelProvider: provider, model: "gpt-oss:20b" });
      const agent = new Agent({ name: "OSSAgent", instructions: "Respond plainly." });
      const result = await runner.run(agent, "hello");
      expect(result.finalOutput).toContain("oss ok");
    } finally {
      await close();
    }
  }, 15000);
});


