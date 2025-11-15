import type { Thread, ThreadEvent, ThreadItem, TurnOptions, Usage } from "@codex-native/sdk";

const THREAD_EVENT_TEXT_LIMIT = 400;

export type ThreadLoggingSink = {
  info(message: string): void;
  warn(message: string): void;
  recordUsage?(usage: Usage): void;
};

export async function runThreadTurnWithLogs(
  thread: Thread,
  sink: ThreadLoggingSink,
  prompt: string,
  turnOptions?: TurnOptions,
) {
  const unsubscribe = thread.onEvent((event) => logThreadEvent(event, sink));
  try {
    if (turnOptions) {
      return await thread.run(prompt, turnOptions);
    }
    return await thread.run(prompt);
  } finally {
    unsubscribe();
  }
}

function logThreadEvent(event: ThreadEvent, sink: ThreadLoggingSink): void {
  switch (event.type) {
    case "thread.started":
      sink.info(`Thread started (id: ${event.thread_id})`);
      return;
    case "turn.started":
      sink.info("Turn started");
      return;
    case "turn.completed":
      sink.info(
        `Turn completed (input ${event.usage.input_tokens}, cached ${event.usage.cached_input_tokens}, output ${event.usage.output_tokens})`,
      );
      sink.recordUsage?.(event.usage);
      return;
    case "turn.failed":
      sink.warn(`Turn failed: ${event.error.message}`);
      return;
    case "item.started":
      sink.info(`Item started: ${describeThreadItemForLog(event.item)}`);
      return;
    case "item.updated":
      sink.info(`Item updated: ${describeThreadItemForLog(event.item)}`);
      return;
    case "item.completed": {
      const message = `Item completed: ${describeThreadItemForLog(event.item)}`;
      if (event.item.type === "error") {
        sink.warn(message);
      } else {
        sink.info(message);
      }
      return;
    }
    case "background_event":
      sink.info(`Background: ${summarizeLogText(event.message)}`);
      return;
    case "exited_review_mode":
      sink.info("Exited review mode");
      return;
    case "error":
      sink.warn(`Stream error: ${event.message}`);
      return;
    default:
      return;
  }
}

function describeThreadItemForLog(item: ThreadItem): string {
  switch (item.type) {
    case "agent_message":
      return `agent message → ${summarizeLogText(item.text)}`;
    case "reasoning":
      return `reasoning → ${summarizeLogText(item.text)}`;
    case "command_execution": {
      const exit = item.exit_code !== undefined ? ` exit=${item.exit_code}` : "";
      return `command "${summarizeLogText(item.command)}" [${item.status}${exit}]`;
    }
    case "file_change": {
      const changeList = item.changes.map((change) => `${change.kind}:${change.path}`).join(", ");
      return `file change [${item.status}] ${summarizeLogText(changeList)}`;
    }
    case "mcp_tool_call":
      return `mcp ${item.server}.${item.tool} [${item.status}]`;
    case "web_search":
      return `web search "${summarizeLogText(item.query)}"`;
    case "todo_list": {
      const completed = item.items.filter((todo) => todo.completed).length;
      return `todo list ${completed}/${item.items.length}`;
    }
    case "error":
      return `error → ${summarizeLogText(item.message)}`;
    default:
      return "event";
  }
}

function summarizeLogText(text: string | undefined, limit = THREAD_EVENT_TEXT_LIMIT): string {
  if (!text) {
    return "";
  }
  const flattened = text.replace(/\s+/g, " ").trim();
  if (flattened.length <= limit) {
    return flattened;
  }
  return `${flattened.slice(0, limit)}…`;
}
