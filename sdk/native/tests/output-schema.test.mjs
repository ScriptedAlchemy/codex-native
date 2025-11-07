import { describe, expect, it, beforeAll, jest } from "@jest/globals";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";

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

describe("Output schema file optimization", () => {
  it("does not create temp schema file for native runs", async () => {
    const schema = {
      type: "object",
      properties: {
        answer: { type: "string" },
      },
      required: ["answer"],
    };

    const { url, close, requests } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(responseStarted(), assistantMessage('{"answer":"42"}'), responseCompleted()),
      ],
    });

    const mkdtempSpy = jest.spyOn(fs, "mkdtemp");
    try {
      const client = createClient(url);
      const thread = client.startThread();
      const streamed = await thread.runStreamed("structured", { outputSchema: schema });
      for await (const _ of streamed.events) {
        // drain events
      }

      const payload = requests[0].json;
      expect(payload.text?.format?.name).toEqual("codex_output_schema");
      expect(payload.text?.format?.type).toEqual("json_schema");
      expect(payload.text?.format?.strict).toEqual(true);
      // Schema should include additionalProperties: false
      expect(payload.text?.format?.schema?.additionalProperties).toBe(false);
      // No temp directory should be created for native runs
      expect(mkdtempSpy).not.toHaveBeenCalled();
    } finally {
      mkdtempSpy.mockRestore();
      await close();
    }
  });

  it("normalizes schema with additionalProperties", async () => {
    const schemaWithoutAdditionalProperties = {
      type: "object",
      properties: {
        name: { type: "string" },
      },
    };

    const { url, close, requests } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(responseStarted(), assistantMessage('{"name":"test"}'), responseCompleted()),
      ],
    });

    try {
      const client = createClient(url);
      const thread = client.startThread();
      const streamed = await thread.runStreamed("test", {
        outputSchema: schemaWithoutAdditionalProperties,
      });

      for await (const _ of streamed.events) {
        // drain
      }

      const payload = requests[0].json;
      // Should add additionalProperties: false
      expect(payload.text?.format?.schema?.additionalProperties).toBe(false);
    } finally {
      await close();
    }
  });

  it("preserves explicit additionalProperties setting", async () => {
    const schemaWithExplicitTrue = {
      type: "object",
      properties: {
        data: { type: "string" },
      },
      additionalProperties: true,
    };

    const { url, close, requests } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(responseStarted(), assistantMessage('{"data":"ok"}'), responseCompleted()),
      ],
    });

    try {
      const client = createClient(url);
      const thread = client.startThread();
      const streamed = await thread.runStreamed("test", {
        outputSchema: schemaWithExplicitTrue,
      });

      for await (const _ of streamed.events) {
        // drain
      }

      const payload = requests[0].json;
      // Should preserve the explicit true
      expect(payload.text?.format?.schema?.additionalProperties).toBe(true);
    } finally {
      await close();
    }
  });

  it("handles undefined schema gracefully", async () => {
    const { url, close } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [sse(responseStarted(), assistantMessage("OK"), responseCompleted())],
    });

    try {
      const client = createClient(url);
      const thread = client.startThread();
      const streamed = await thread.runStreamed("test", {
        outputSchema: undefined,
      });

      const events = [];
      for await (const event of streamed.events) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });
});

describe("Schema validation", () => {
  it("rejects non-object schemas", async () => {
    const client = new Codex({ baseUrl: "http://invalid", apiKey: "test" });
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
    const client = new Codex({ baseUrl: "http://invalid", apiKey: "test" });
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

    const { url, close } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(
          responseStarted(),
          assistantMessage('{"result":"test","count":5}'),
          responseCompleted(),
        ),
      ],
    });

    try {
      const client = createClient(url);
      const thread = client.startThread();
      const streamed = await thread.runStreamed("test", { outputSchema: validSchema });

      const events = [];
      for await (const event of streamed.events) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });
});

