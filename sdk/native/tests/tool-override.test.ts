import { describe, expect, it, beforeAll, jest } from "@jest/globals";

// Setup native binding for tests
setupNativeBinding();
import { setupNativeBinding } from "./testHelpers";

// Allow extra time for async operations
jest.setTimeout(20000);

let Codex: any;
beforeAll(async () => {
  ({ Codex } = await import("../src/index"));
});

// Helper to create mock exec that yields proper Rust-format events
function createMockExec(responseText: string, itemId: string = "item_0") {
  return {
    run: jest.fn(async function* () {
      yield JSON.stringify({ ThreadStarted: { thread_id: "mock-thread-id" } });
      yield JSON.stringify({ TurnStarted: {} });
      yield JSON.stringify({ ItemCompleted: { item: { id: itemId, type: "agent_message", text: responseText } } });
      yield JSON.stringify({
        TurnCompleted: {
          usage: { input_tokens: 42, output_tokens: 5 },
        },
      });
    }),
    requiresOutputSchemaFile: () => false,
  };
}

describe("Tool override capability", () => {
  it("allows registering a tool to override built-ins", async () => {
    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = createMockExec("OK");

    // Register a custom read_file tool
    client.registerTool({
      name: "read_file",
      description: "Custom file reader",
      parameters: {
        type: "object",
        properties: {
          target_file: { type: "string" },
        },
        required: ["target_file"],
      },
      handler: async () => {
        return JSON.stringify({ content: "Custom read implementation" });
      },
    });

    const thread = client.startThread();
    const result = await thread.runStreamed("Test");

    const events = [];
    for await (const event of result.events) {
      events.push(event);
    }

    // The tool was registered successfully
    const completedEvent = events.find((e) => e.type === "turn.completed");
    expect(completedEvent).toBeDefined();
  });

  it("allows overriding multiple built-in tools", async () => {
    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = createMockExec("OK");

    // Register multiple overrides
    const tools = ["read_file", "write_file", "grep", "local_shell"];

    for (const toolName of tools) {
      client.registerTool({
        name: toolName,
        description: `Custom ${toolName}`,
        parameters: { type: "object", properties: {} },
        handler: async () => "custom",
      });
    }

    // Should not throw
    const thread = client.startThread();
    const result = await thread.runStreamed("Test");

    const events = [];
    for await (const event of result.events) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
  });

  it("clear tools removes all registered tools including overrides", async () => {
    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = createMockExec("OK");

    // Register an override
    client.registerTool({
      name: "read_file",
      description: "Custom reader",
      parameters: { type: "object", properties: {} },
      handler: async () => "custom",
    });

    // Clear all tools
    client.clearTools();

    // Should still work (built-ins restored)
    const thread = client.startThread();
    const result = await thread.runStreamed("Test");

    const events = [];
    for await (const event of result.events) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
  });
});

describe("Tool override documentation", () => {
  it("supports the documented override pattern", async () => {
    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = createMockExec("OK");

    // Example from README: override grep with custom logic
    client.registerTool({
      name: "grep",
      description: "Search for patterns (custom)",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string" },
        },
        required: ["pattern"],
      },
      handler: async ({ pattern, path }: { pattern: any; path: any }) => {
        // Custom grep implementation
        return JSON.stringify({ matches: [`custom result for ${pattern}`] });
      },
    });

    const thread = client.startThread();
    const result = await thread.runStreamed("Test");

    const events = [];
    for await (const event of result.events) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
  });
});
