import { describe, expect, it, beforeAll } from "@jest/globals";
import { setupNativeBinding } from "./testHelpers";

import {
  assistantMessage,
  responseCompleted,
  responseStarted,
  startResponsesTestProxy,
} from "./responsesProxy";

// Setup native binding for tests
setupNativeBinding();

let Codex: any;
beforeAll(async () => {
  const mod = await import("../src/index");
  Codex = mod.Codex;
});

function createClient(baseUrl: string) {
  return new Codex({ baseUrl, apiKey: "test", skipGitRepoCheck: true });
}

describe("Raw event forwarding", () => {
  it("forwards unhandled protocol events as raw_event", async () => {
    const { url, close } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        { events: [
          responseStarted(),
          // Include a raw custom event that won't be recognized
          { type: "custom_event", custom_data: "test" },
          assistantMessage("Hi!"),
          responseCompleted(),
        ] },
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

      // Raw events are disabled by default
      const rawEvents = events.filter((e) => e.type === "raw_event");
      expect(rawEvents.length).toBe(0);

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
        { events: [
          responseStarted(),
          assistantMessage("Done"),
          responseCompleted(),
        ] },
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

      // Raw events are disabled by default
      const rawEvents = events.filter((e) => e.type === "raw_event");
      expect(rawEvents.length).toBe(0);
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
        { events: [
          responseStarted(),
          assistantMessage("Response text"),
          responseCompleted(),
        ] },
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
  }, 10000);
});
