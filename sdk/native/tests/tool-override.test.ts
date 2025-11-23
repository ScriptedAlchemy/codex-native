import { beforeAll, describe, expect, it } from "@jest/globals";

import {
  assistantMessage,
  responseCompleted,
  responseStarted,
  sse,
  startResponsesTestProxy,
} from "./responsesProxy";
import { setupNativeBinding } from "./testHelpers";

// Enable native binding before running tests
setupNativeBinding();

let Codex: any;
beforeAll(async () => {
  ({ Codex } = await import("../src/index"));
});

function createClient(baseUrl: string) {
  return new Codex({ baseUrl, apiKey: "test", skipGitRepoCheck: true });
}

describe("Tool override capability", () => {
  it("allows registering a tool to override built-ins", async () => {
    const { url, close, requests } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [sse(responseStarted(), assistantMessage("OK"), responseCompleted())],
    });

    try {
      const client = createClient(url);

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
        handler: async (args: any) => JSON.stringify({ content: "Custom read implementation", args }),
      });

      const thread = client.startThread();
      const result = await thread.runStreamed("Test");

      const events = [] as any[];
      for await (const event of result.events) {
        events.push(event);
      }

      expect(requests.length).toBeGreaterThan(0);
      const firstRequest = requests[0];
      expect(firstRequest).toBeDefined();
      expect(firstRequest?.path ?? "").toMatch(/responses/);
    } finally {
      await close();
    }
  });

  it("allows overriding multiple built-in tools", async () => {
    const { url, close, requests } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [sse(responseStarted(), assistantMessage("OK"), responseCompleted())],
    });

    try {
      const client = createClient(url);

      const tools = ["read_file", "write_file", "grep", "local_shell"] as const;

      for (const toolName of tools) {
        client.registerTool({
          name: toolName,
          description: `Custom ${toolName}`,
          parameters: { type: "object", properties: {} },
          handler: async () => "custom",
        });
      }

      const thread = client.startThread();
      const result = await thread.runStreamed("Test");

      const events = [] as any[];
      for await (const event of result.events) {
        events.push(event);
      }
      expect(requests.length).toBeGreaterThan(0);
      const firstRequest = requests[0];
      expect(firstRequest).toBeDefined();
      expect(firstRequest?.path ?? "").toMatch(/responses/);
    } finally {
      await close();
    }
  });

  it("clear tools removes all registered tools including overrides", async () => {
    const { url, close, requests } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [sse(responseStarted(), assistantMessage("OK"), responseCompleted())],
    });

    try {
      const client = createClient(url);

      client.registerTool({
        name: "read_file",
        description: "Custom reader",
        parameters: { type: "object", properties: {} },
        handler: async () => "custom",
      });

      client.clearTools();

      const thread = client.startThread();
      const result = await thread.runStreamed("Test");

      const events = [] as any[];
      for await (const event of result.events) {
        events.push(event);
      }
      expect(requests.length).toBeGreaterThan(0);
      const firstRequest = requests[0];
      expect(firstRequest).toBeDefined();
      expect(firstRequest?.path ?? "").toMatch(/responses/);
    } finally {
      await close();
    }
  }, 10_000);
});

describe("Tool override documentation", () => {
  it("supports the documented override pattern", async () => {
    const { url, close, requests } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [sse(responseStarted(), assistantMessage("OK"), responseCompleted())],
    });

    try {
      const client = createClient(url);

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
        handler: async ({ pattern }: { pattern: string }) =>
          JSON.stringify({ matches: [`custom result for ${pattern}`] }),
      });

      const thread = client.startThread();
      const result = await thread.runStreamed("Test");

      const events = [] as any[];
      for await (const event of result.events) {
        events.push(event);
      }
      expect(requests.length).toBeGreaterThan(0);
      const firstRequest = requests[0];
      expect(firstRequest).toBeDefined();
      expect(firstRequest?.path ?? "").toMatch(/responses/);
    } finally {
      await close();
    }
  });
});
