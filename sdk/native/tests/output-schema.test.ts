import { describe, expect, it, beforeAll, jest } from "@jest/globals";

// Setup native binding for tests
setupNativeBinding();
import { setupNativeBinding } from "./testHelpers";
import { promises as fs } from "node:fs";

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
          usage: { input_tokens: 42, output_tokens: 5, cached_input_tokens: 12 },
        },
      });
    }),
    requiresOutputSchemaFile: () => false,
  };
}

// Helper to create mock exec that captures arguments
function createMockExecWithCapture(responseText: string, captureCallback: (args: any) => void) {
  return {
    run: jest.fn(async function* (args: any) {
      captureCallback(args);
      yield JSON.stringify({ ThreadStarted: { thread_id: "mock-thread-id" } });
      yield JSON.stringify({ TurnStarted: {} });
      yield JSON.stringify({ ItemCompleted: { item: { id: "item_0", type: "agent_message", text: responseText } } });
      yield JSON.stringify({
        TurnCompleted: {
          usage: { input_tokens: 42, output_tokens: 5, cached_input_tokens: 12 },
        },
      });
    }),
    requiresOutputSchemaFile: () => false,
  };
}

describe("Output schema file optimization", () => {
  it("does not create temp schema file for native runs", async () => {
    const schema = {
      type: "object",
      properties: {
        answer: { type: "string" },
      },
      required: ["answer"],
    };

    let capturedArgs: any = null;
    const mkdtempSpy = jest.spyOn(fs, "mkdtemp");

    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = createMockExecWithCapture('{"answer":"42"}', (args) => {
      capturedArgs = args;
    });

    try {
      const thread = client.startThread();
      const streamed = await thread.runStreamed("structured", { outputSchema: schema });
      for await (const _ of streamed.events) {
        // drain events
      }

      // Verify schema was passed through to exec (may be normalized with additionalProperties: false)
      expect(capturedArgs).toBeDefined();
      expect(capturedArgs.outputSchema).toBeDefined();
      expect(capturedArgs.outputSchema.type).toEqual("object");
      expect(capturedArgs.outputSchema.properties?.answer?.type).toEqual("string");
      expect(capturedArgs.outputSchema.required).toEqual(["answer"]);
      // No temp directory should be created for native runs
      expect(mkdtempSpy).not.toHaveBeenCalled();
    } finally {
      mkdtempSpy.mockRestore();
    }
  });

  it("normalizes schema with additionalProperties", async () => {
    const schemaWithoutAdditionalProperties = {
      type: "object",
      properties: {
        name: { type: "string" },
      },
    };

    let capturedArgs: any = null;
    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = createMockExecWithCapture('{"name":"test"}', (args) => {
      capturedArgs = args;
    });

    const thread = client.startThread();
    const streamed = await thread.runStreamed("test", {
      outputSchema: schemaWithoutAdditionalProperties,
    });

    for await (const _ of streamed.events) {
      // drain
    }

    // Verify schema was passed through (normalized with additionalProperties: false)
    expect(capturedArgs).toBeDefined();
    expect(capturedArgs.outputSchema).toBeDefined();
    expect(capturedArgs.outputSchema.type).toEqual("object");
    expect(capturedArgs.outputSchema.properties?.name?.type).toEqual("string");
    // Schema is normalized to add additionalProperties: false
    expect(capturedArgs.outputSchema.additionalProperties).toBe(false);
  });

  it("preserves explicit additionalProperties setting", async () => {
    const schemaWithExplicitTrue = {
      type: "object",
      properties: {
        data: { type: "string" },
      },
      additionalProperties: true,
    };

    let capturedArgs: any = null;
    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = createMockExecWithCapture('{"data":"ok"}', (args) => {
      capturedArgs = args;
    });

    const thread = client.startThread();
    const streamed = await thread.runStreamed("test", {
      outputSchema: schemaWithExplicitTrue,
    });

    for await (const _ of streamed.events) {
      // drain
    }

    // Should preserve the explicit true
    expect(capturedArgs).toBeDefined();
    expect(capturedArgs.outputSchema?.additionalProperties).toBe(true);
  });

  it("handles undefined schema gracefully", async () => {
    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = createMockExec("OK");

    const thread = client.startThread();
    const streamed = await thread.runStreamed("test", {
      outputSchema: undefined,
    });

    const events = [];
    for await (const event of streamed.events) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
  });

  it("accepts OpenAI-style json_schema wrapper and normalizes", async () => {
    const wrapper = {
      type: "json_schema",
      json_schema: {
        name: "custom_name",
        strict: true,
        schema: {
          type: "object",
          properties: { answer: { type: "string" } },
          required: ["answer"],
        },
      },
    };

    let capturedArgs: any = null;
    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = createMockExecWithCapture('{"answer":"42"}', (args) => {
      capturedArgs = args;
    });

    const thread = client.startThread();
    const streamed = await thread.runStreamed("structured", { outputSchema: wrapper });
    for await (const _ of streamed.events) {
      // drain events
    }

    // Verify schema was passed through (wrapper is unwrapped and normalized)
    expect(capturedArgs).toBeDefined();
    expect(capturedArgs.outputSchema).toBeDefined();
    // The wrapper is unwrapped and inner schema is extracted
    expect(capturedArgs.outputSchema.type).toEqual("object");
    expect(capturedArgs.outputSchema.properties?.answer?.type).toEqual("string");
    expect(capturedArgs.outputSchema.required).toEqual(["answer"]);
  });
});

describe("Schema validation", () => {
  it("rejects non-object schemas", async () => {
    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = createMockExec("OK");

    const thread = client.startThread();
    const result = await thread.runStreamed("test", { outputSchema: "not an object" });

    // Error should be thrown when iterating the events generator
    await expect(async () => {
      for await (const _ of result.events) {
        // will throw before yielding
      }
    }).rejects.toThrow("outputSchema must be a plain JSON object");
  });

  it("rejects array schemas", async () => {
    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = createMockExec("OK");

    const thread = client.startThread();
    const result = await thread.runStreamed("test", { outputSchema: [] });

    // Error should be thrown when iterating the events generator
    await expect(async () => {
      for await (const _ of result.events) {
        // will throw before yielding
      }
    }).rejects.toThrow("outputSchema must be a plain JSON object");
  });

  it("accepts valid JSON object schemas", async () => {
    const validSchema = {
      type: "object",
      properties: {
        result: { type: "string" },
        count: { type: "number" },
      },
    };

    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = createMockExec('{"result":"test","count":5}');

    const thread = client.startThread();
    const streamed = await thread.runStreamed("test", { outputSchema: validSchema });

    const events = [];
    for await (const event of streamed.events) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
  });
});
