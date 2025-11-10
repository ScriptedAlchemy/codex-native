/**
 * Validate @openai/agents 'tool' (zod-based) tools flow through CodexProvider.
 * Docs reference:
 * - https://openai.github.io/openai-agents-js/guides/agents/
 */

import { describe, it, expect, beforeAll, jest } from "@jest/globals";
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

describe("Agents zod tools with CodexProvider", () => {
  it("registers zod-based tools and runs Agent", async () => {
    const { Agent, Runner, tool } = await import("@openai/agents");
    const { z } = await import("zod");

    // Mock backend
    const { url, close } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(
          responseStarted("response_1"),
          assistantMessage("Tool registered and run completed", "item_1"),
          responseCompleted("response_1"),
        ),
      ],
    });

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
        baseUrl: url,
        skipGitRepoCheck: true,
      });

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
      await close();
    }
  }, 15000);
});


