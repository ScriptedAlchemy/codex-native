import { describe, expect, it } from "@jest/globals";

import { convertRustEventToThreadEvent } from "../src/events/convert";

describe("convertRustEventToThreadEvent", () => {
  it("converts thread started events", () => {
    const input = { ThreadStarted: { thread_id: "thread-1" } };
    const event = convertRustEventToThreadEvent(input);
    expect(event.type).toBe("thread.started");
    if (event.type === "thread.started") {
      expect(event.thread_id).toBe("thread-1");
    }
  });

  it("converts turn completion and background events from Rust payloads", () => {
    const completed = convertRustEventToThreadEvent({
      TurnCompleted: { usage: { input: 1, output: 2 } },
    });
    expect(completed.type).toBe("turn.completed");
    if (completed.type === "turn.completed") {
      expect(completed.usage).toEqual({ input: 1, output: 2 });
    }

    const background = convertRustEventToThreadEvent({
      BackgroundEvent: { message: "Diagnostics ready" },
    });
    expect(background.type).toBe("background_event");
    if (background.type === "background_event") {
      expect(background.message).toBe("Diagnostics ready");
    }
  });

  it("converts plan_update_scheduled into a todo list item", () => {
    const now = Date.now;
    Date.now = () => 1700000000000;
    const event = convertRustEventToThreadEvent({
      type: "plan_update_scheduled",
      plan: {
        plan: [
          { step: "a", status: "pending" },
          { step: "b", status: "completed" },
        ],
      },
    });
    Date.now = now;

    expect(event.type).toBe("item.completed");
    if (event.type === "item.completed" && event.item?.type === "todo_list") {
      expect(event.item.items).toEqual([
        { text: "a", completed: false },
        { text: "b", completed: true },
      ]);
    } else {
      throw new Error("plan update should map to item.completed todo_list");
    }
  });

  it("returns custom events unchanged", () => {
    const input = { type: "custom", payload: 123 };
    const event = convertRustEventToThreadEvent(input);
    expect(event).toBe(input);
  });
});
