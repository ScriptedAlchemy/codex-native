/**
 * Validate that Agents tools passed in ModelRequest are registered with CodexProvider
 * Reference: https://openai.github.io/openai-agents-js/
 */

import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { setupNativeBinding } from "./testHelpers";

// Setup native binding for tests
setupNativeBinding();

// Allow extra time for async operations
jest.setTimeout(20000);

let CodexProvider: any;
beforeAll(async () => {
  ({ CodexProvider } = await import("../src/index"));
});

// Helper to create mock Codex for provider tests
function createMockCodex(responseText: string = "tool registration ok") {
  const mockThread = {
    id: "mock-thread-id",
    run: jest.fn(async () => ({
      items: [{ type: "agent_message", text: responseText }],
      finalResponse: responseText,
      usage: { input_tokens: 10, output_tokens: 5 },
    })),
    runStreamed: jest.fn(async () => ({
      events: (async function* () {
        yield { type: "thread.started", thread_id: "mock-thread-id" };
        yield { type: "turn.started" };
        yield { type: "item.completed", item: { type: "agent_message", text: responseText } };
        yield { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } };
      })(),
    })),
    onEvent: jest.fn(() => () => {}),
    sendBackgroundEvent: jest.fn(async () => {}),
  };

  return {
    startThread: jest.fn(() => mockThread),
    resumeThread: jest.fn(() => mockThread),
    registerTool: jest.fn(),
    _mockThread: mockThread,
  };
}

describe("Agents tools interop", () => {
  it("registers function tools with Codex when provided in ModelRequest", async () => {
    // Create mock Codex backend
    const mockCodex = createMockCodex("tool registration ok");

    const provider = new CodexProvider({ skipGitRepoCheck: true });

    // Inject mock Codex to avoid real network calls
    (provider as any).codex = mockCodex;

    const model = provider.getModel("gpt-5-codex");

    // Spy on registration logging to confirm registration path is executed.
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    const tool = {
      type: "function",
      name: "say_hello",
      description: "Says hello",
      parameters: { type: "object", properties: { name: { type: "string" } } },
      execute: async ({ name }: { name: any }) => `Hello, ${name}!`,
    };

    try {
      await model.getResponse({
        systemInstructions: "You are a tool testing agent",
        input: "test",
        modelSettings: {},
        tools: [tool],
        // No structured output to keep this test focused on registration path
        outputType: undefined,
        handoffs: [],
        tracing: { enabled: false },
      });

      // The provider should have attempted registration (observe log)
      expect(logSpy).toHaveBeenCalled();
      const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain("Registered tool with Codex: say_hello");
    } finally {
      logSpy.mockRestore();
    }
  });
});
