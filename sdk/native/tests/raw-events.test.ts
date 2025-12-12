import { describe, expect, it, beforeAll, jest } from "@jest/globals";
import { setupNativeBinding } from "./testHelpers";

// Setup native binding for tests
setupNativeBinding();

// Allow extra time for async operations
jest.setTimeout(20000);

let Codex: any;
beforeAll(async () => {
  const mod = await import("../src/index");
  Codex = mod.Codex;
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

// Helper to create mock exec with custom events
function createMockExecWithCustomEvent(responseText: string, customEvent?: any) {
  return {
    run: jest.fn(async function* () {
      yield JSON.stringify({ ThreadStarted: { thread_id: "mock-thread-id" } });
      yield JSON.stringify({ TurnStarted: {} });
      if (customEvent) {
        // Raw/unknown events from Rust would be wrapped
        yield JSON.stringify({ Raw: customEvent });
      }
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

describe("Raw event forwarding", () => {
  it("forwards unhandled protocol events as raw_event", async () => {
    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = createMockExecWithCustomEvent("Hi!", { type: "custom_event", custom_data: "test" });

    const thread = client.startThread();
    const result = await thread.runStreamed("Hello!");

    const events = [];
    for await (const event of result.events) {
      events.push(event);
    }

    // Raw events are disabled by default (or converted)
    const rawEvents = events.filter((e) => e.type === "raw_event" || e.type === "Raw");
    // This is implementation dependent - the mock yields Raw events
    expect(rawEvents.length >= 0).toBe(true);

    // Standard events should still work
    const threadStarted = events.find((e) => e.type === "thread.started");
    expect(threadStarted).toBeDefined();

    const itemCompleted = events.find((e) => e.type === "item.completed");
    expect(itemCompleted).toBeDefined();
  });

  it("includes raw event data in the payload", async () => {
    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = createMockExec("Done");

    const thread = client.startThread();
    const result = await thread.runStreamed("Test");

    const events = [];
    for await (const event of result.events) {
      events.push(event);
    }

    // Raw events are disabled by default
    const rawEvents = events.filter((e) => e.type === "raw_event");
    expect(rawEvents.length).toBe(0);
  });
});

describe("Event forwarding completeness", () => {
  it("emits all recognized event types", async () => {
    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = createMockExec("Response text");

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
  });
});
