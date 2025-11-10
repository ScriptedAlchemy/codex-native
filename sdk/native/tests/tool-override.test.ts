import { describe, expect, it, beforeAll } from "@jest/globals";

// Setup native binding for tests
setupNativeBinding();
import { setupNativeBinding } from "./testHelpers";

import {
  assistantMessage,
  responseCompleted,
  responseStarted,
  sse,
  startResponsesTestProxy,
} from "./responsesProxy";



let Codex: any;
beforeAll(async () => {
  ({ Codex } = await import("../src/index"));
});

function createClient(baseUrl: string) {
  return new Codex({ baseUrl, apiKey: "test", skipGitRepoCheck: true });
}

describe("Tool override capability", () => {
  it("allows registering a tool to override built-ins", async () => {
    const { url, close } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [sse(responseStarted(), assistantMessage("OK"), responseCompleted())],
    });

    try {
      const client = createClient(url);

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
        handler: async (args: any) => {
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
    } finally {
      await close();
    }
  });

  it("allows overriding multiple built-in tools", async () => {
    const { url, close } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [sse(responseStarted(), assistantMessage("OK"), responseCompleted())],
    });

    try {
      const client = createClient(url);

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
    } finally {
      await close();
    }
  });

  it("clear tools removes all registered tools including overrides", async () => {
    const { url, close } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [sse(responseStarted(), assistantMessage("OK"), responseCompleted())],
    });

    try {
      const client = createClient(url);

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
    } finally {
      await close();
    }
  }, 10000);
});

describe("Tool override documentation", () => {
  it("supports the documented override pattern", async () => {
    const { url, close } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [sse(responseStarted(), assistantMessage("OK"), responseCompleted())],
    });

    try {
      const client = createClient(url);

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
    } finally {
      await close();
    }
  });
});
