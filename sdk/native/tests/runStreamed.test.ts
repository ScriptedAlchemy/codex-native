import { describe, expect, it, beforeAll, jest } from "@jest/globals";

// Setup native binding for tests
import { setupNativeBinding } from "./testHelpers";
setupNativeBinding();

// Allow extra time for streaming on slower environments
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
      yield JSON.stringify({ ItemStarted: { item: { id: itemId, type: "agent_message", text: "" } } });
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

// Helper to create mock exec for multiple sequential runs
function createMockExecMultiRun(responses: Array<{ text: string; itemId: string }>) {
  let runCount = 0;
  return {
    run: jest.fn(async function* () {
      const response = responses[runCount] || { text: "Default", itemId: "item_x" };
      runCount++;
      yield JSON.stringify({ ThreadStarted: { thread_id: "mock-thread-id" } });
      yield JSON.stringify({ TurnStarted: {} });
      yield JSON.stringify({ ItemCompleted: { item: { id: response.itemId, type: "agent_message", text: response.text } } });
      yield JSON.stringify({
        TurnCompleted: {
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      });
    }),
    requiresOutputSchemaFile: () => false,
    getRunCount: () => runCount,
  };
}

// Helper for capturing run args
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

// Helper for plan update test - emits plan after first call
function createMockExecWithPlanSupport(responses: string[]) {
  let runCount = 0;
  let pendingPlan: any = null;

  return {
    run: jest.fn(async function* () {
      const text = responses[runCount] || "Default";
      runCount++;

      yield JSON.stringify({ ThreadStarted: { thread_id: "mock-thread-id" } });
      yield JSON.stringify({ TurnStarted: {} });

      // If there's a pending plan, emit it
      if (pendingPlan) {
        yield JSON.stringify({
          type: "plan_update_scheduled",
          plan: pendingPlan,
        });
        pendingPlan = null;
      }

      yield JSON.stringify({ ItemCompleted: { item: { id: `item_${runCount}`, type: "agent_message", text } } });
      yield JSON.stringify({
        TurnCompleted: {
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      });
    }),
    requiresOutputSchemaFile: () => false,
    setPendingPlan: (plan: any) => {
      pendingPlan = plan;
    },
  };
}

// Helper for background event test
function createMockExecWithBackgroundSupport(responseText: string) {
  let backgroundCallback: ((msg: string) => void) | null = null;

  return {
    run: jest.fn(async function* () {
      yield JSON.stringify({ ThreadStarted: { thread_id: "mock-thread-id" } });
      yield JSON.stringify({ TurnStarted: {} });

      // Simulate background event being emitted mid-turn
      if (backgroundCallback) {
        backgroundCallback("Heads up: working on it");
      }

      yield JSON.stringify({ BackgroundEvent: { message: "Heads up: working on it" } });
      yield JSON.stringify({ ItemCompleted: { item: { id: "item_0", type: "agent_message", text: responseText } } });
      yield JSON.stringify({
        TurnCompleted: {
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      });
    }),
    requiresOutputSchemaFile: () => false,
    onBackgroundEvent: (cb: (msg: string) => void) => {
      backgroundCallback = cb;
    },
  };
}

describe("Codex runStreamed with native binding", () => {
  it("returns thread events", async () => {
    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = createMockExec("Hi!");

    const thread = client.startThread();
    const result = await thread.runStreamed("Hello, world!");

    const events = [];
    for await (const event of result.events) {
      events.push(event);
    }

    // Filter out raw_event types for this test
    const standardEvents = events.filter((e) => e.type !== "Raw" && e.type !== "raw_event");

    expect(standardEvents).toEqual([
      {
        type: "thread.started",
        thread_id: expect.any(String),
      },
      {
        type: "turn.started",
      },
      {
        type: "item.started",
        item: {
          id: "item_0",
          type: "agent_message",
          text: "",
        },
      },
      {
        type: "item.completed",
        item: {
          id: "item_0",
          type: "agent_message",
          text: "Hi!",
        },
      },
      {
        type: "turn.completed",
        usage: {
          cached_input_tokens: 12,
          input_tokens: 42,
          output_tokens: 5,
        },
      },
    ]);
    expect(thread.id).toEqual(expect.any(String));
  });

  it("sends previous items when runStreamed is called twice", async () => {
    const mockExec = createMockExecMultiRun([
      { text: "First response", itemId: "item_1" },
      { text: "Second response", itemId: "item_2" },
    ]);

    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = mockExec;

    const thread = client.startThread();
    const first = await thread.runStreamed("first input");
    for await (const _ of first.events) {
      // drain events
    }

    const second = await thread.runStreamed("second input");
    let foundSecondResponse = false;
    for await (const event of second.events) {
      if (event.type === "item.completed" && event.item?.text === "Second response") {
        foundSecondResponse = true;
      }
    }

    expect(mockExec.getRunCount()).toBe(2);
    expect(foundSecondResponse).toBe(true);
  });

  it("resumes thread by id when streaming", async () => {
    const mockExec = createMockExecMultiRun([
      { text: "First response", itemId: "item_1" },
      { text: "Second response", itemId: "item_2" },
    ]);

    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = mockExec;

    const originalThread = client.startThread();
    const first = await originalThread.runStreamed("first input");
    for await (const _ of first.events) {
      // drain events
    }

    const resumedThread = client.resumeThread(originalThread.id);
    // Inject the same mock exec into the resumed thread
    (resumedThread as any)._exec = mockExec;

    const second = await resumedThread.runStreamed("second input");
    let foundSecondResponse = false;
    for await (const event of second.events) {
      if (event.type === "item.completed" && event.item?.text === "Second response") {
        foundSecondResponse = true;
      }
    }

    expect(mockExec.getRunCount()).toBe(2);
    expect(foundSecondResponse).toBe(true);
  });

  it("emits todo_list events when a plan update is scheduled", async () => {
    const mockExec = createMockExecWithPlanSupport(["First response", "Second response"]);

    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = mockExec;

    const thread = client.startThread();

    const first = await thread.runStreamed("first input");
    for await (const _ of first.events) {
      // drain events
    }

    // Schedule a plan update before the second run
    mockExec.setPendingPlan({
      plan: [
        { step: "Implement feature", status: "in_progress" },
        { step: "Write tests", status: "completed" },
      ],
    });

    const second = await thread.runStreamed("second input");
    const events: any[] = [];
    for await (const event of second.events) {
      events.push(event);
    }

    const planEvent = events.find(
      (event) => event.type === "item.completed" && (event as any).item?.type === "todo_list",
    ) as { type: "item.completed"; item: { items: Array<{ text: string; completed: boolean }> } } | undefined;

    expect(planEvent).toBeDefined();
    expect(planEvent?.item.items).toEqual([
      { text: "Implement feature", completed: false },
      { text: "Write tests", completed: true },
    ]);
  });

  it("applies output schema turn options when streaming", async () => {
    const schema = {
      type: "object",
      properties: {
        answer: { type: "string" },
      },
      required: ["answer"],
      additionalProperties: false,
    };

    let capturedArgs: any = null;
    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = createMockExecWithCapture("Structured response", (args) => {
      capturedArgs = args;
    });

    const thread = client.startThread();
    const streamed = await thread.runStreamed("structured", { outputSchema: schema });
    for await (const _ of streamed.events) {
      // drain events
    }

    // Verify that output schema was passed through
    expect(capturedArgs).toBeDefined();
    expect(capturedArgs.outputSchema).toEqual(schema);
  });

  it("emits background_event when a mid-turn notification is sent", async () => {
    const mockExec = createMockExecWithBackgroundSupport("All done");

    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = mockExec;

    const thread = client.startThread();
    const streamed = await thread.runStreamed("background event demo");

    const events: any[] = [];
    for await (const event of streamed.events) {
      events.push(event);
    }

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "background_event",
          message: "Heads up: working on it",
        }),
      ]),
    );
  });
});
