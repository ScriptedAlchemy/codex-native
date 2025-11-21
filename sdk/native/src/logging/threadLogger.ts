import type { Thread } from "../thread";
import type { ThreadEvent } from "../events";
import type { ThreadItem } from "../items";
import type { TurnOptions } from "../turnOptions";
import type { Usage } from "../events";
import type { ThreadLoggingSink } from "./types";
import type { ScopedLogger } from "./logger";

const THREAD_EVENT_TEXT_LIMIT = 400;

/**
 * Create a thread logging sink from a scoped logger
 */
export function createThreadLogger(scopedLogger: ScopedLogger, onUsage?: (usage: Usage) => void): ThreadLoggingSink {
  return {
    info: (message: string) => scopedLogger.info(message),
    warn: (message: string) => scopedLogger.warn(message),
    recordUsage: onUsage,
  };
}

/**
 * Run a thread turn with automatic event logging
 */
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

/**
 * Log a thread event to a sink
 */
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
      if ("recordUsage" in sink && sink.recordUsage) {
        sink.recordUsage(event.usage);
      }
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
    case "raw_event":
      return;
    default:
      return;
  }
}

/**
 * Describe a thread item for logging
 */
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
    default: {
      // Exhaustive check - this should never happen
      const _exhaustive: never = item;
      return "unknown event";
    }
  }
}

/**
 * Summarize text for logging (truncate if too long)
 */
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
