import * as fs from "node:fs";
import * as path from "node:path";

import { CodexOptions } from "./codexOptions";
import { ThreadEvent, ThreadError, Usage } from "./events";
import { CodexExec } from "./exec";
import { ThreadItem } from "./items";
import { ThreadOptions } from "./threadOptions";
import { TurnOptions } from "./turnOptions";
import { createOutputSchemaFile, normalizeOutputSchema } from "./outputSchemaFile";

/**
 * Convert Rust event format to ThreadEvent format.
 * Rust sends events like { "TurnStarted": {} } but we expect { "type": "turn.started" }
 */
function convertRustEventToThreadEvent(rustEvent: any): ThreadEvent {
  if (rustEvent.ThreadStarted) {
    return {
      type: "thread.started",
      thread_id: rustEvent.ThreadStarted.thread_id,
    };
  }
  if (rustEvent.TurnStarted) {
    return { type: "turn.started" };
  }
  if (rustEvent.TurnCompleted) {
    return {
      type: "turn.completed",
      usage: rustEvent.TurnCompleted.usage,
    };
  }
  if (rustEvent.TurnFailed) {
    return {
      type: "turn.failed",
      error: rustEvent.TurnFailed.error,
    };
  }
  if (rustEvent.ItemStarted) {
    return {
      type: "item.started",
      item: rustEvent.ItemStarted.item,
    };
  }
  if (rustEvent.ItemUpdated) {
    return {
      type: "item.updated",
      item: rustEvent.ItemUpdated.item,
    };
  }
  if (rustEvent.ItemCompleted) {
    return {
      type: "item.completed",
      item: rustEvent.ItemCompleted.item,
    };
  }
  if (rustEvent.Error) {
    return {
      type: "error",
      message: rustEvent.Error.message,
    };
  }
  // If it's already in the correct format, return as-is
  if (rustEvent.type) {
    return rustEvent;
  }
  // Unknown format - return as-is and let the consumer handle it
  return rustEvent;
}

/** Completed turn. */
export type Turn = {
  items: ThreadItem[];
  finalResponse: string;
  usage: Usage | null;
};

/** Alias for `Turn` to describe the result of `run()`. */
export type RunResult = Turn;

/** The result of the `runStreamed` method. */
export type StreamedTurn = {
  events: AsyncGenerator<ThreadEvent>;
};

/** Alias for `StreamedTurn` to describe the result of `runStreamed()`. */
export type RunStreamedResult = StreamedTurn;

/** An input to send to the agent. */
export type UserInput =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "local_image";
      path: string;
    };

export type Input = string | UserInput[];

const UNTRUSTED_DIRECTORY_ERROR =
  "Not inside a trusted directory and --skip-git-repo-check was not specified.";

function findGitRoot(startDir: string): string | null {
  let current = path.resolve(startDir);

  while (true) {
    const gitPath = path.join(current, ".git");
    if (fs.existsSync(gitPath)) {
      try {
        const stats = fs.statSync(gitPath);
        if (stats.isDirectory() || stats.isFile()) {
          return current;
        }
      } catch {
        // Ignore filesystem race conditions and keep searching upwards.
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return null;
}

function assertTrustedDirectory(workingDirectory?: string): void {
  const directory = workingDirectory ? path.resolve(workingDirectory) : process.cwd();
  if (!findGitRoot(directory)) {
    throw new Error(UNTRUSTED_DIRECTORY_ERROR);
  }
}

/** Respesent a thread of conversation with the agent. One thread can have multiple consecutive turns. */
export class Thread {
  private _exec: CodexExec;
  private _options: CodexOptions;
  private _id: string | null;
  private _threadOptions: ThreadOptions;

  /** Returns the ID of the thread. Populated after the first turn starts. */
  public get id(): string | null {
    return this._id;
  }

  /** Compacts the conversation history for this thread using Codex's builtin compaction. */
  async compact(): Promise<void> {
    const skipGitRepoCheck =
      this._threadOptions?.skipGitRepoCheck ??
      (typeof process !== "undefined" &&
        process.env &&
        process.env.CODEX_TEST_SKIP_GIT_REPO_CHECK === "1");
    if (!skipGitRepoCheck) {
      assertTrustedDirectory(this._threadOptions?.workingDirectory);
    }
    const events: string[] = await this._exec.compact({
      input: "compact",
      threadId: this._id,
      baseUrl: this._options.baseUrl,
      apiKey: this._options.apiKey,
      model: this._threadOptions?.model,
      sandboxMode: this._threadOptions?.sandboxMode,
      approvalMode: this._threadOptions?.approvalMode,
      workspaceWriteOptions: this._threadOptions?.workspaceWriteOptions,
      workingDirectory: this._threadOptions?.workingDirectory,
      skipGitRepoCheck,
    });
    // No return value needed; compaction modifies server-side history.
    if (!Array.isArray(events)) {
      throw new Error("Compact did not return event list");
    }
  }
  /* @internal */
  constructor(
    exec: CodexExec,
    options: CodexOptions,
    threadOptions: ThreadOptions,
    id: string | null = null,
  ) {
    this._exec = exec;
    this._options = options;
    this._id = id;
    this._threadOptions = threadOptions;
  }

  /** Provides the input to the agent and streams events as they are produced during the turn. */
  async runStreamed(input: Input, turnOptions: TurnOptions = {}): Promise<StreamedTurn> {
    return { events: this.runStreamedInternal(input, turnOptions, false) };
  }

  private async *runStreamedInternal(
    input: Input,
    turnOptions: TurnOptions = {},
    emitRawEvents: boolean = true,
  ): AsyncGenerator<ThreadEvent> {
    const normalizedSchema = normalizeOutputSchema(turnOptions.outputSchema);
    const needsSchemaFile = this._exec.requiresOutputSchemaFile();
    const schemaFile = needsSchemaFile
      ? await createOutputSchemaFile(normalizedSchema)
      : { schemaPath: undefined, cleanup: async () => {} };
    const options = this._threadOptions;
    const { prompt, images } = normalizeInput(input);
    const skipGitRepoCheck =
      options?.skipGitRepoCheck ??
      (typeof process !== "undefined" &&
        process.env &&
        process.env.CODEX_TEST_SKIP_GIT_REPO_CHECK === "1");
    if (!skipGitRepoCheck) {
      assertTrustedDirectory(options?.workingDirectory);
    }
    const generator = this._exec.run({
      input: prompt,
      baseUrl: this._options.baseUrl,
      apiKey: this._options.apiKey,
      threadId: this._id,
      images,
      model: options?.model,
      oss: options?.oss,
      sandboxMode: options?.sandboxMode,
      approvalMode: options?.approvalMode,
      workspaceWriteOptions: options?.workspaceWriteOptions,
      workingDirectory: options?.workingDirectory,
      skipGitRepoCheck,
      outputSchemaFile: schemaFile.schemaPath,
      outputSchema: normalizedSchema,
      fullAuto: options?.fullAuto,
    });
    try {
      for await (const item of generator) {
        let parsed: any;
        try {
          parsed = JSON.parse(item);
        } catch (error) {
          throw new Error(`Failed to parse item: ${item}`, { cause: error });
        }

        // Skip null events (used for Raw events that should not be emitted)
        if (parsed === null) {
          continue;
        }

        // Conditionally forward the raw event payload
        if (emitRawEvents) {
          // Forward raw
          yield { type: "raw_event", raw: parsed } as ThreadEvent;
        }
        // Convert and forward mapped
        const threadEvent = convertRustEventToThreadEvent(parsed);
        if (threadEvent.type === "thread.started") {
          this._id = threadEvent.thread_id;
        }
        yield threadEvent;
      }
    } finally {
      await schemaFile.cleanup();
    }
  }

  /** Provides the input to the agent and returns the completed turn. */
  async run(input: Input, turnOptions: TurnOptions = {}): Promise<Turn> {
    const generator = this.runStreamedInternal(input, turnOptions, true);
    const items: ThreadItem[] = [];
    let finalResponse: string = "";
    let usage: Usage | null = null;
    let turnFailure: ThreadError | null = null;
    for await (const event of generator) {
      if (event.type === "item.completed") {
        if (event.item.type === "agent_message") {
          finalResponse = event.item.text;
        }
        items.push(event.item);
      } else if (event.type === "turn.completed") {
        usage = event.usage;
      } else if (event.type === "turn.failed") {
        turnFailure = event.error;
        break;
      }
    }
    if (turnFailure) {
      throw new Error(turnFailure.message);
    }
    return { items, finalResponse, usage };
  }
}

function normalizeInput(input: Input): { prompt: string; images: string[] } {
  if (typeof input === "string") {
    return { prompt: input, images: [] };
  }
  const promptParts: string[] = [];
  const images: string[] = [];
  for (const item of input) {
    if (item.type === "text") {
      promptParts.push(item.text);
    } else if (item.type === "local_image") {
      images.push(item.path);
    }
  }
  return { prompt: promptParts.join("\n\n"), images };
}
