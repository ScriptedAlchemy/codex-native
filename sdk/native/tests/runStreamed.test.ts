import { describe, expect, it, beforeAll, jest } from "@jest/globals";

// Setup native binding for tests
setupNativeBinding();
import { setupNativeBinding } from "./testHelpers";
import { promises as fs } from "node:fs";

// Allow extra time for streaming on slower environments
jest.setTimeout(20000);
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

describe("Codex runStreamed with native binding", () => {
  it("returns thread events", async () => {
    const { url, close } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [sse(responseStarted(), assistantMessage("Hi!"), responseCompleted())],
    });

    try {
      const client = createClient(url);
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
    } finally {
      await close();
    }
  });

  it("sends previous items when runStreamed is called twice", async () => {
    const { url, close, requests } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(
          responseStarted("response_1"),
          assistantMessage("First response", "item_1"),
          responseCompleted("response_1"),
        ),
        sse(
          responseStarted("response_2"),
          assistantMessage("Second response", "item_2"),
          responseCompleted("response_2"),
        ),
      ],
    });

    try {
      const client = createClient(url);
      const thread = client.startThread();
      const first = await thread.runStreamed("first input");
      for await (const _ of first.events) {
        // drain events
      }

      const second = await thread.runStreamed("second input");
      for await (const _ of second.events) {
        // drain events
      }

      const assistantEntry = requests[1]!.json.input.find((entry: any) => entry.role === "assistant");
      const assistantText = assistantEntry?.content?.find((item: any) => item.type === "output_text")?.text;
      expect(assistantText).toBe("First response");
    } finally {
      await close();
    }
  });

  it("resumes thread by id when streaming", async () => {
    const { url, close, requests } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(
          responseStarted("response_1"),
          assistantMessage("First response", "item_1"),
          responseCompleted("response_1"),
        ),
        sse(
          responseStarted("response_2"),
          assistantMessage("Second response", "item_2"),
          responseCompleted("response_2"),
        ),
      ],
    });

    try {
      const client = createClient(url);
      const originalThread = client.startThread();
      const first = await originalThread.runStreamed("first input");
      for await (const _ of first.events) {
        // drain events
      }

      const resumedThread = client.resumeThread(originalThread.id);
      const second = await resumedThread.runStreamed("second input");
      for await (const _ of second.events) {
        // drain events
      }

      const assistantEntry = requests[1]!.json.input.find((entry: any) => entry.role === "assistant");
      const assistantText = assistantEntry?.content?.find((item: any) => item.type === "output_text")?.text;
      expect(assistantText).toBe("First response");
    } finally {
      await close();
    }
  });

  it("emits todo_list events when a plan update is scheduled", async () => {
    const { url, close } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(
          responseStarted("response_1"),
          assistantMessage("First response", "item_1"),
          responseCompleted("response_1"),
        ),
        sse(
          responseStarted("response_2"),
          assistantMessage("Second response", "item_2"),
          responseCompleted("response_2"),
        ),
      ],
    });

    try {
      const client = createClient(url);
      const thread = client.startThread();

      const first = await thread.runStreamed("first input");
      for await (const _ of first.events) {
        // drain events
      }

      thread.updatePlan({
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
    } finally {
      await close();
    }
  });

  it("applies output schema turn options when streaming", async () => {
    const { url, close, requests } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(
          responseStarted("response_1"),
          assistantMessage("Structured response", "item_1"),
          responseCompleted("response_1"),
        ),
      ],
    });

    const schema = {
      type: "object",
      properties: {
        answer: { type: "string" },
      },
      required: ["answer"],
      additionalProperties: false,
    };

    const mkdtempSpy = jest.spyOn(fs, "mkdtemp");
    try {
      const client = createClient(url);
      const thread = client.startThread();
      const streamed = await thread.runStreamed("structured", { outputSchema: schema });
      for await (const _ of streamed.events) {
        // drain events
      }

      const payload = requests[0]!.json;
      expect(payload.text?.format).toEqual({
        name: "codex_output_schema",
        type: "json_schema",
        strict: true,
        schema,
      });
      expect(mkdtempSpy).not.toHaveBeenCalled();
    } finally {
      mkdtempSpy.mockRestore();
      await close();
    }
  });

  it("emits background_event when a mid-turn notification is sent", async () => {
    const { url, close } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(
          responseStarted("response_1"),
          assistantMessage("All done", "item_1"),
          responseCompleted("response_1"),
        ),
      ],
    });

    try {
      const client = createClient(url);
      const thread = client.startThread();
      const streamed = await thread.runStreamed("background event demo");

      const events: any[] = [];
      for await (const event of streamed.events) {
        events.push(event);
        if (event.type === "turn.started") {
          await thread.sendBackgroundEvent("Heads up: working on it");
        }
      }

      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "background_event",
            message: "Heads up: working on it",
          }),
        ]),
      );
    } finally {
      await close();
    }
  });
});
