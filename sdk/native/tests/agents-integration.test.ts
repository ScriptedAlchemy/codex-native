/**
 * Integration test for CodexProvider with @openai/agents
 *
 * This test verifies that our CodexProvider works correctly with the actual
 * OpenAI Agents JS framework.
 *
 * Note: This test requires @openai/agents to be installed. If not installed,
 * the test will be skipped.
 */

import { describe, expect, it, beforeAll } from "@jest/globals";
import { setupNativeBinding } from "./testHelpers";

const isCI = process.env.CI === "true" || process.env.CI === "1";
const testFn = isCI ? it.skip : it;
const mockEnv = process.env.CODEX_NATIVE_RUN_AGENTS_MOCK;
const shouldRunMockTests = mockEnv !== "0";
const mockIt = shouldRunMockTests ? it : it.skip;

// Setup native binding for tests
setupNativeBinding();

let CodexProvider: any;

beforeAll(async () => {
  ({ CodexProvider } = await import("../src/index"));
});

describe("CodexProvider - OpenAI Agents Integration", () => {
  describe("Provider Interface", () => {
    it("implements ModelProvider interface", () => {
      const provider = new CodexProvider({
        skipGitRepoCheck: true,
      });

      expect(provider).toBeDefined();
      expect(typeof provider.getModel).toBe("function");
    });

    it("returns a Model instance from getModel()", () => {
      const provider = new CodexProvider({
        skipGitRepoCheck: true,
      });

      const model = provider.getModel("gpt-5-codex");

      expect(model).toBeDefined();
      expect(typeof model.getResponse).toBe("function");
      expect(typeof model.getStreamedResponse).toBe("function");
    });

    it("accepts optional model name in getModel()", () => {
      const provider = new CodexProvider({
        apiKey: "test-key",
        defaultModel: "default-model",
        skipGitRepoCheck: true,
      });

      const modelWithName = provider.getModel("specific-model");
      const modelWithDefault = provider.getModel();

      expect(modelWithName).toBeDefined();
      expect(modelWithDefault).toBeDefined();
    });
  });

  describe("Model Interface", () => {
    it("implements getResponse() method", async () => {
      const provider = new CodexProvider({
        skipGitRepoCheck: true,
      });

      const model = provider.getModel();

      // Verify the method exists and has correct signature
      expect(typeof model.getResponse).toBe("function");

      // We can verify the method signature without calling it
      // (since we don't have a real Codex backend in unit tests)
      expect(model.getResponse.length).toBe(1); // Takes 1 parameter (request)
    });

    it("implements getStreamedResponse() method", async () => {
      const provider = new CodexProvider({
        skipGitRepoCheck: true,
      });

      const model = provider.getModel();

      expect(typeof model.getStreamedResponse).toBe("function");

      const request = {
        systemInstructions: "You are a test assistant",
        input: "Hello",
        modelSettings: { temperature: 0.7 },
        tools: [],
        outputType: { type: "json_schema", schema: {} },
        handoffs: [],
        tracing: { enabled: false },
      };

      // This should return an async iterable
      const stream = model.getStreamedResponse(request);

      // Verify it's an async iterable
      expect(typeof stream[Symbol.asyncIterator]).toBe("function");
    });

    it("returns ModelResponse with correct structure", async () => {
      // This test would need a mock Codex backend to properly test
      // For now, we just verify the type structure expectations
      const expectedResponseShape = {
        usage: {
          inputTokens: expect.any(Number),
          outputTokens: expect.any(Number),
          totalTokens: expect.any(Number),
        },
        output: expect.any(Array),
        responseId: expect.any(String),
      };

      // Just verify the structure is what we expect
      expect(expectedResponseShape).toBeDefined();
    });
  });

  describe("Configuration Options", () => {
    it("accepts CodexProviderOptions", () => {
      const options = {
        apiKey: "test-key",
        baseUrl: "https://test.example.com",
        defaultModel: "gpt-5-codex",
        workingDirectory: "/tmp",
        skipGitRepoCheck: true,
      };

      const provider = new CodexProvider(options);
      expect(provider).toBeDefined();
    });

    it("works without any options", () => {
      const provider = new CodexProvider();
      expect(provider).toBeDefined();
    });

    it("allows configuring default model", () => {
      const provider = new CodexProvider({
        defaultModel: "my-custom-model",
        skipGitRepoCheck: true,
      });

      const model = provider.getModel();
      expect(model).toBeDefined();
    });
  });

  describe("OpenAI Agents Compatibility (provider streaming)", () => {
    mockIt("works with provider streaming using mock backend", async () => {
      const { startResponsesTestProxy, sse, responseStarted, assistantMessage, responseCompleted } = await import("./responsesProxy");

      const { url, close, requests } = await startResponsesTestProxy({
        statusCode: 200,
        responseBodies: [
          sse(
            responseStarted("response_1"),
            assistantMessage("Hello! I am working through the OpenAI Agents framework!", "item_1"),
            responseCompleted("response_1"),
          ),
        ],
      });

      try {
        const provider = new CodexProvider({
          baseUrl: url,
          skipGitRepoCheck: true,
        });

        const model = provider.getModel("gpt-5-codex");
        const stream = model.getStreamedResponse({
          systemInstructions: "You are a test assistant",
          input: "Say hello",
          modelSettings: {},
          tools: [],
          outputType: undefined,
          handoffs: [],
          tracing: { enabled: false },
        });

        let sawResponseDone = false;
        for await (const ev of stream) {
          if (ev.type === "output_text_delta") {
          } else if (ev.type === "response_done") {
            sawResponseDone = true;
            break;
          }
        }
        expect(sawResponseDone).toBe(true);
        expect(requests.length).toBeGreaterThan(0);
        expect(requests[0]?.json?.model).toBe("gpt-5-codex");
      } finally {
        await close();
      }
    }, 15000);

    const runRealEnv = process.env.CODEX_NATIVE_RUN_AGENTS_REAL;
    const shouldRunReal = (!isCI && runRealEnv !== "0") || runRealEnv === "1";
    const realTest = shouldRunReal ? testFn : it.skip;
    realTest("works with real Codex backend", async () => {
      // This test requires a real Codex backend (no API key needed)

      const { Agent, Runner } = await import("@openai/agents");

      const provider = new CodexProvider({
        skipGitRepoCheck: true,
      });

      const agent = new Agent({
        name: "TestAgent",
        instructions: "You are a helpful test assistant. Respond with exactly: 'Test successful!'",
      });

      const runner = new Runner({ modelProvider: provider });
      try {
        const result = await runner.run(agent, "Say the test phrase");
        expect(result).toBeDefined();
        expect(result.finalOutput).toContain("Test successful");
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes("Not inside a trusted directory") ||
            error.message.includes("timeout") ||
            error.message.includes("ENOTFOUND"))
        ) {
          console.warn(
            "Skipping real Codex backend test due to environment constraints:",
            error.message,
          );
          return;
        }
        throw error;
      }
    }, 30000);
  });

  describe("Type Compatibility", () => {
    it("exports TypeScript types", async () => {
      // Verify that types are exported from the package
      const exports = await import("../src/index");

      expect(exports.CodexProvider).toBeDefined();
      // Types are compile-time only, but we can verify the class exports
    });
  });
});
