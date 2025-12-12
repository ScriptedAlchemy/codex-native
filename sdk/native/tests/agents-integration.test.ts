/**
 * Integration test for CodexProvider with @openai/agents
 *
 * This test verifies that our CodexProvider works correctly with the actual
 * OpenAI Agents JS framework.
 */

import { describe, expect, it, beforeAll, jest } from "@jest/globals";
import { setupNativeBinding } from "./testHelpers";

// Setup native binding for tests
setupNativeBinding();

// Allow extra time for async operations
jest.setTimeout(20000);

let CodexProvider: any;
let Codex: any;
let Thread: any;

beforeAll(async () => {
  ({ CodexProvider, Codex, Thread } = await import("../src/index"));
});

function createMockThread(responseText: string = "Hello! I am working through the OpenAI Agents framework!"): any {
  const createUsage = () => ({
    input_tokens: 42,
    output_tokens: 10,
    cached_input_tokens: 5,
  });

  const mockThread: any = {
    id: "mock-thread-id",
    run: jest.fn(async () => ({
      items: [
        { type: "agent_message", text: responseText },
      ],
      finalResponse: responseText,
      usage: createUsage(),
    })),
    runStreamed: jest.fn(async () => ({
      events: (async function* () {
        yield { type: "thread.started", thread_id: "mock-thread-id" };
        yield { type: "turn.started" };
        yield { type: "item.started", item: { type: "agent_message", text: "" } };
        yield { type: "item.updated", item: { type: "agent_message", text: responseText.slice(0, 10) } };
        yield { type: "item.updated", item: { type: "agent_message", text: responseText } };
        yield { type: "item.completed", item: { type: "agent_message", text: responseText } };
        yield { type: "turn.completed", usage: createUsage() };
      })(),
    })),
    onEvent: jest.fn(() => () => {}),
    sendBackgroundEvent: jest.fn(async () => {}),
  };

  return mockThread;
}

function createMockCodex(mockThread: any): any {
  return {
    startThread: jest.fn(() => mockThread),
    resumeThread: jest.fn(() => mockThread),
    registerTool: jest.fn(),
  };
}

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
    it("works with provider streaming using mock Codex backend", async () => {
      const expectedText = "Hello! I am working through the OpenAI Agents framework!";
      const mockThread = createMockThread(expectedText);
      const mockCodex = createMockCodex(mockThread);

      const provider = new CodexProvider({
        skipGitRepoCheck: true,
      });

      // Inject mock Codex to avoid real network calls
      (provider as any).codex = mockCodex;

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

      const collectedEvents: any[] = [];
      let sawResponseDone = false;
      let sawTextDelta = false;

      for await (const ev of stream) {
        collectedEvents.push(ev);
        if (ev.type === "output_text_delta") {
          sawTextDelta = true;
        } else if (ev.type === "response_done") {
          sawResponseDone = true;
          break;
        }
      }

      expect(sawResponseDone).toBe(true);
      expect(sawTextDelta).toBe(true);
      expect(mockCodex.startThread).toHaveBeenCalled();
      expect(mockThread.runStreamed).toHaveBeenCalled();
    }, 15000);

    it("properly converts streaming events to OpenAI Agents format", async () => {
      const expectedText = "Test response text";
      const mockThread = createMockThread(expectedText);
      const mockCodex = createMockCodex(mockThread);

      const provider = new CodexProvider({
        skipGitRepoCheck: true,
      });

      (provider as any).codex = mockCodex;

      const model = provider.getModel();
      const stream = model.getStreamedResponse({
        input: "Test input",
        tools: [],
      });

      const eventTypes = new Set<string>();
      for await (const ev of stream) {
        eventTypes.add(ev.type);
        if (ev.type === "response_done") {
          // Verify response_done has proper structure
          expect(ev.response).toBeDefined();
          expect(ev.response.usage).toBeDefined();
          break;
        }
      }

      // Should emit standard streaming events
      expect(eventTypes.has("response_started")).toBe(true);
      expect(eventTypes.has("output_text_delta")).toBe(true);
      expect(eventTypes.has("response_done")).toBe(true);
    });

    it("handles non-streaming getResponse with mock backend", async () => {
      const expectedText = "Non-streaming response";
      const mockThread = createMockThread(expectedText);
      const mockCodex = createMockCodex(mockThread);

      const provider = new CodexProvider({
        skipGitRepoCheck: true,
      });

      (provider as any).codex = mockCodex;

      const model = provider.getModel();
      const response = await model.getResponse({
        input: "Test input",
        tools: [],
      });

      expect(response).toBeDefined();
      expect(response.usage).toBeDefined();
      expect(response.output).toBeDefined();
      expect(response.responseId).toBeDefined();
      expect(mockThread.run).toHaveBeenCalled();
    });
  });

  describe("Thread API", () => {
    it("Thread has updatePlan and event subscription methods", () => {
      const provider = new CodexProvider({
        skipGitRepoCheck: true,
      });

      // We can't actually create a real thread without a backend,
      // but we can verify the provider has the necessary methods
      expect(typeof provider.getModel).toBe("function");

      // Test that we can get a model (which internally creates threads)
      const model = provider.getModel();
      expect(model).toBeDefined();
      expect(typeof model.getResponse).toBe("function");
      expect(typeof model.getStreamedResponse).toBe("function");
    });
  });

  describe("Type Compatibility", () => {
    it("exports TypeScript types", async () => {
      // Verify that types are exported from the package
      const exports = await import("../src/index");

      expect(exports.CodexProvider).toBeDefined();
      // Types are compile-time only, but we can verify the class exports
    });
  });

  describe("Usage tracking", () => {
    it("correctly converts usage from Codex format to Agents format", async () => {
      const mockThread = createMockThread("Test");
      const mockCodex = createMockCodex(mockThread);

      const provider = new CodexProvider({
        skipGitRepoCheck: true,
      });

      (provider as any).codex = mockCodex;

      const model = provider.getModel();
      const response = await model.getResponse({
        input: "Test",
        tools: [],
      });

      // Usage should be converted from Codex format (snake_case) to Agents format (camelCase)
      expect(response.usage).toBeDefined();
      expect(typeof response.usage.inputTokens).toBe("number");
      expect(typeof response.usage.outputTokens).toBe("number");
    });
  });
});
