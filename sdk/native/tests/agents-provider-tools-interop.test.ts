/**
 * Validate that Agents tools passed in ModelRequest are registered with CodexProvider
 * Reference: https://openai.github.io/openai-agents-js/
 */

import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { setupNativeBinding } from "./testHelpers";

// Setup native binding for tests
setupNativeBinding();



let CodexProvider: any;
beforeAll(async () => {
  ({ CodexProvider } = await import("../src/index"));
});

describe("Agents tools interop", () => {
  // Skip in CI - this test requires backend authentication
  const testFn = process.env.CI ? it.skip : it;

  testFn("registers function tools with Codex when provided in ModelRequest", async () => {
    const provider = new CodexProvider({ skipGitRepoCheck: true });
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
    logSpy.mockRestore();
  }, 30000); // Increased timeout for CI environments
});


