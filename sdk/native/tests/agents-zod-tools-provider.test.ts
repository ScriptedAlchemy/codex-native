/**
 * Validate @openai/agents 'tool' (zod-based) tools flow through CodexProvider.
 * Docs reference:
 * - https://openai.github.io/openai-agents-js/guides/agents/
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

// Helper to create mock Codex thread for provider tests
function createMockCodex(responseText: string = "Tool registered and run completed") {
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

describe("Agents zod tools with CodexProvider", () => {
  it("registers zod-based tools and runs Agent", async () => {
    const { Agent, Runner, tool } = await import("@openai/agents");
    const { z } = await import("zod");

    // Create mock Codex backend
    const mockCodex = createMockCodex("Tool registered and run completed");

    // Intercept registration log to assert tool registration
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    try {
      const helloTool = tool({
        name: "say_hello",
        description: "Says hello",
        parameters: z.object({ name: z.string() }),
        async execute({ name }) {
          return `Hello, ${name}!`;
        },
      });

      const provider = new CodexProvider({
        skipGitRepoCheck: true,
      });

      // Inject mock Codex to avoid real network calls
      (provider as any).codex = mockCodex;

      const agent = new Agent({
        name: "ToolAgent",
        instructions: "Be helpful and use tools when appropriate.",
        tools: [helloTool],
      });

      const runner = new Runner({ modelProvider: provider });
      const result = await runner.run(agent, "Say hello to Alice");

      expect(result.finalOutput).toBeDefined();
      // Registration message emitted by the provider during tool registration
      const logs = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logs).toContain("Registered tool with Codex: say_hello");
    } finally {
      logSpy.mockRestore();
    }
  });
});
