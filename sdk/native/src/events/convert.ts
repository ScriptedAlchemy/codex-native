import type { ThreadEvent } from "../events";

/**
 * Converts the raw Rust event payload emitted by the native binding into the structured
 * {@link ThreadEvent} shape expected by the TypeScript SDK.
 */
export function convertRustEventToThreadEvent(rustEvent: any): ThreadEvent {
  if (rustEvent?.ThreadStarted) {
    return {
      type: "thread.started",
      thread_id: rustEvent.ThreadStarted.thread_id,
    };
  }
  if (rustEvent?.TurnStarted) {
    return { type: "turn.started" };
  }
  if (rustEvent?.TurnCompleted) {
    return {
      type: "turn.completed",
      usage: rustEvent.TurnCompleted.usage,
    };
  }
  if (rustEvent?.TurnFailed) {
    return {
      type: "turn.failed",
      error: rustEvent.TurnFailed.error,
    };
  }
  if (rustEvent?.ItemStarted) {
    return {
      type: "item.started",
      item: rustEvent.ItemStarted.item,
    };
  }
  if (rustEvent?.ItemUpdated) {
    return {
      type: "item.updated",
      item: rustEvent.ItemUpdated.item,
    };
  }
  if (rustEvent?.ItemCompleted) {
    return {
      type: "item.completed",
      item: rustEvent.ItemCompleted.item,
    };
  }
  if (rustEvent?.Error) {
    return {
      type: "error",
      message: rustEvent.Error.message,
    };
  }
  if (rustEvent?.BackgroundEvent) {
    return {
      type: "background_event",
      message: rustEvent.BackgroundEvent.message,
    };
  }
  if (rustEvent?.type === "background_event" && typeof rustEvent.message === "string") {
    return {
      type: "background_event",
      message: rustEvent.message,
    };
  }
  if (rustEvent?.type === "plan_update_scheduled" && rustEvent.plan) {
    const planData = rustEvent.plan;
    const planItems = planData.plan || [];
    return {
      type: "item.completed",
      item: {
        id: `plan-${Date.now()}`,
        type: "todo_list",
        items: planItems.map((item: any) => ({
          text: item.step,
          completed: item.status === "completed",
        })),
      },
    } as ThreadEvent;
  }
  if (rustEvent?.type) {
    return rustEvent as ThreadEvent;
  }
  return rustEvent as ThreadEvent;
}
