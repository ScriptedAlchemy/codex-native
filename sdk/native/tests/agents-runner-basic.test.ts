/**
 * Basic Agents runner integration validating our CodexProvider interop with
 * the OpenAI Agents SDK per guides:
 * - https://openai.github.io/openai-agents-js/guides/agents/
 * - https://openai.github.io/openai-agents-js/guides/running-agents/
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
function createMockCodex(responseText: string = "Hello from Agents + Codex!") {
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

describe("Agents Runner + CodexProvider - basic flow", () => {
  it("runs Agent via Runner with CodexProvider and returns final output", async () => {
    const { Agent, Runner } = await import("@openai/agents");

    // Create mock Codex backend
    const mockCodex = createMockCodex("Hello from Agents + Codex!");

    const provider = new CodexProvider({
      skipGitRepoCheck: true,
    });

    // Inject mock Codex to avoid real network calls
    (provider as any).codex = mockCodex;

    const agent = new Agent({
      name: "HelloAgent",
      instructions: "Respond with a friendly greeting.",
    });

    const runner = new Runner({ modelProvider: provider });
    const result = await runner.run(agent, "Say hello");

    expect(result).toBeDefined();
    expect(typeof result.finalOutput).toBe("string");
    expect(result.finalOutput).toContain("Hello");
  });
});
