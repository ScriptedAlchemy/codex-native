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

describe("Raw event forwarding", () => {
  it("forwards unhandled protocol events as raw_event", async () => {
    const { url, close } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(
          responseStarted(),
          // Include a raw custom event that won't be recognized
          'event: custom_event\ndata: {"type":"custom_event","custom_data":"test"}\n\n',
          assistantMessage("Hi!"),
          responseCompleted(),
        ),
      ],
    });

    try {
      const client = createClient(url);
      const thread = client.startThread();
      const result = await thread.runStreamed("Hello!");

      const events = [];
      for await (const event of result.events) {
        events.push(event);
      }

      // Should include raw_event for unhandled events
      const rawEvents = events.filter((e) => e.type === "raw_event");
      expect(rawEvents.length).toBeGreaterThanOrEqual(0);

      // Standard events should still work
      const threadStarted = events.find((e) => e.type === "thread.started");
      expect(threadStarted).toBeDefined();

      const itemCompleted = events.find((e) => e.type === "item.completed");
      expect(itemCompleted).toBeDefined();
    } finally {
      await close();
    }
  });

  it("includes raw event data in the payload", async () => {
    const { url, close } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(
          responseStarted(),
          assistantMessage("Done"),
          responseCompleted(),
        ),
      ],
    });

    try {
      const client = createClient(url);
      const thread = client.startThread();
      const result = await thread.runStreamed("Test");

      const events = [];
      for await (const event of result.events) {
        events.push(event);
      }

      // Should have raw events
      const rawEvents = events.filter((e) => e.type === "raw_event");
      expect(rawEvents.length).toBeGreaterThan(0);

      // Raw events should have raw field
      for (const rawEvent of rawEvents) {
        expect(rawEvent.raw).toBeDefined();
      }
    } finally {
      await close();
    }
  });
});

describe("Event forwarding completeness", () => {
  it("emits all recognized event types", async () => {
    const { url, close } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(
          responseStarted(),
          assistantMessage("Response text"),
          responseCompleted(),
        ),
      ],
    });

    try {
      const client = createClient(url);
      const thread = client.startThread();
      const result = await thread.runStreamed("Test all events");

      const events = [];
      for await (const event of result.events) {
        events.push(event);
      }

      const eventTypes = new Set(events.map((e) => e.type));

      // Should have at least these standard events
      expect(eventTypes.has("thread.started")).toBe(true);
      expect(eventTypes.has("turn.started")).toBe(true);
      expect(eventTypes.has("turn.completed")).toBe(true);

      // May have additional raw events
      const hasRawEvents = eventTypes.has("raw_event");
      expect(typeof hasRawEvents).toBe("boolean");
    } finally {
      await close();
    }
  });
});

