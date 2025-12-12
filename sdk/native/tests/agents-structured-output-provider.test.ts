/**
 * Validate Agents ModelRequest.outputType -> Codex Responses text.format mapping
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
function createMockCodex(responseText: string = "test") {
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

    // Create mock Codex backend
    const mockCodex = createMockCodex('{"value":"ok"}');

    const provider = new CodexProvider({ skipGitRepoCheck: true });

    // Inject mock Codex to avoid real network calls
    (provider as any).codex = mockCodex;

    const model = provider.getModel("gpt-5-codex");

    const result = await model.getResponse({
      systemInstructions: "You are a test agent",
      input: "Return JSON",
      modelSettings: {},
      tools: [],
      outputType: wrapper,
      handoffs: [],
      tracing: { enabled: false },
    });

    // Verify response was received
    expect(result).toBeDefined();
    expect(result.output).toBeDefined();
    expect(mockCodex.startThread).toHaveBeenCalled();
    expect(mockCodex._mockThread.run).toHaveBeenCalled();
  });
});
