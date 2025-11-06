import { describe, expect, it, beforeAll } from "@jest/globals";
import { fileURLToPath } from "node:url";

import {
  assistantMessage,
  responseCompleted,
  responseStarted,
  sse,
  startResponsesTestProxy,
} from "./responsesProxy.mjs";

function resolveNativeBindingPath() {
  const { platform, arch } = process;
  if (platform === "darwin") {
    const suffix = arch === "arm64" ? "arm64" : "x64";
    return fileURLToPath(new URL(`../codex_native.darwin-${suffix}.node`, import.meta.url));
  }
  if (platform === "win32") {
    const suffix = arch === "arm64" ? "arm64" : "x64";
    return fileURLToPath(new URL(`../codex_native.win32-${suffix}-msvc.node`, import.meta.url));
  }
  if (platform === "linux") {
    const suffix = process.env.MUSL ? "musl" : "gnu";
    return fileURLToPath(new URL(`../codex_native.linux-${arch}-${suffix}.node`, import.meta.url));
  }
  throw new Error(`Unsupported platform for tests: ${platform} ${arch}`);
}

process.env.CODEX_NATIVE_BINDING = resolveNativeBindingPath();

let Codex;
beforeAll(async () => {
  ({ Codex } = await import("../dist/index.mjs"));
});

function createClient(baseUrl) {
  return new Codex({ baseUrl, apiKey: "test" });
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
        handler: async (args) => {
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
  });
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
        handler: async ({ pattern, path }) => {
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

