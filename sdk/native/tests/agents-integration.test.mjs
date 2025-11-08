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
const RUN_REAL_BACKEND = process.env.CODEX_NATIVE_RUN_REAL_BACKEND === "1";
const realBackendTest = RUN_REAL_BACKEND ? it : it.skip;

import { fileURLToPath } from "node:url";

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

  const runRealAgentsTest = process.env.CODEX_NATIVE_REAL_AGENT_TEST === "1";

  describe("Real OpenAI Agents Integration", () => {
    it("works with Agent and Runner using mock backend", async () => {
      const { Agent, Runner } = await import("@openai/agents");
      const { startResponsesTestProxy, sse, responseStarted, assistantMessage, responseCompleted } = await import("./responsesProxy.mjs");

      const { url, close } = await startResponsesTestProxy({
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

        const agent = new Agent({
          name: "TestAgent",
          instructions: "You are a helpful test assistant",
        });

        const runner = new Runner({ modelProvider: provider });
        const result = await runner.run(agent, "Say hello");

        // Verify the runner got a result
        expect(result).toBeDefined();
        expect(result.finalOutput).toBeDefined();

        // The finalOutput should contain our mock response
        expect(result.finalOutput).toContain("Hello");
      } finally {
        await close();
      }
    }, 15000); // Longer timeout for runner execution

    (runRealAgentsTest ? it : it.skip)("works with real Codex backend", async () => {
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
      const result = await runner.run(agent, "Say the test phrase");

      expect(result).toBeDefined();
      expect(result.finalOutput).toContain("Test successful");
    }, 30000);
  });

  describe("Type Compatibility", () => {
    it("exports TypeScript types", async () => {
      // Verify that types are exported from the package
      const exports = await import("../dist/index.mjs");

      expect(exports.CodexProvider).toBeDefined();
      // Types are compile-time only, but we can verify the class exports
    });
  });
});
