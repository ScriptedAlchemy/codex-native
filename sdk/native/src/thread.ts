import * as fs from "node:fs";
import * as path from "node:path";

import { CodexOptions } from "./codexOptions";
import { ThreadEvent, ThreadError, Usage } from "./events";
import { convertRustEventToThreadEvent } from "./events/convert";
import { CodexExec, CodexForkArgs } from "./exec";
import { ThreadItem } from "./items";
import { ThreadOptions } from "./threadOptions";
import { TurnOptions } from "./turnOptions";
import { createOutputSchemaFile, normalizeOutputSchema } from "./outputSchemaFile";
import { runTui, startTui } from "./tui";
import { getNativeBinding } from "./nativeBinding";
import type { NativeTuiRequest, NativeTuiExitInfo, ApprovalRequest } from "./nativeBinding";
import type { RunTuiOptions, TuiSession } from "./tui";
import { attachLspDiagnostics } from "./lsp";

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

export type ForkOptions = {
  nthUserMessage: number;
  threadOptions?: Partial<ThreadOptions>;
};

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
  private _eventListeners: Array<(event: ThreadEvent) => void> = [];
  private _approvalHandler: ((request: ApprovalRequest) => boolean | Promise<boolean>) | null = null;

  /** Returns the ID of the thread. Populated after the first turn starts. */
  public get id(): string | null {
    return this._id;
  }

  /**
   * Register an event listener for thread events.
   * @param listener Callback function that receives ThreadEvent objects
   * @returns Unsubscribe function to remove the listener
   */
  onEvent(listener: (event: ThreadEvent) => void): () => void {
    this._eventListeners.push(listener);
    return () => {
      const index = this._eventListeners.indexOf(listener);
      if (index !== -1) {
        this._eventListeners.splice(index, 1);
      }
    };
  }

  /**
   * Remove an event listener.
   * @param listener The listener function to remove
   */
  offEvent(listener: (event: ThreadEvent) => void): void {
    const index = this._eventListeners.indexOf(listener);
    if (index !== -1) {
      this._eventListeners.splice(index, 1);
    }
  }

  /**
   * Register a callback to handle approval requests from the agent.
   * The handler should return true to approve the action, false to deny it.
   *
   * @param handler Callback function that receives ApprovalRequest and returns approval decision
   * @example
   * ```typescript
   * thread.onApprovalRequest(async (request) => {
   *   console.log(`Approval requested for ${request.type}`);
   *   return true; // Auto-approve
   * });
   * ```
   */
  onApprovalRequest(handler: (request: ApprovalRequest) => boolean | Promise<boolean>): void {
    this._approvalHandler = handler;
    const binding = getNativeBinding();
    if (binding && typeof binding.registerApprovalCallback === "function") {
      binding.registerApprovalCallback(handler);
    }
  }

  /**
   * Emit a background notification while the agent is running the current turn.
   * The message is surfaced to event subscribers but does not modify the user input queue.
   *
   * @throws Error if the thread has not been started yet.
   */
  async sendBackgroundEvent(message: string): Promise<void> {
    const trimmed = message?.toString();
    if (!trimmed || trimmed.trim().length === 0) {
      throw new Error("Background event message must be a non-empty string");
    }
    if (!this._id) {
      throw new Error("Cannot emit a background event before the thread has started");
    }
    const binding = getNativeBinding();
    if (!binding || typeof binding.emitBackgroundEvent !== "function") {
      throw new Error("emitBackgroundEvent is not available in this build");
    }
    await binding.emitBackgroundEvent({ threadId: this._id, message: trimmed });
  }

  /**
   * Programmatically update the agent's plan/todo list.
   * The plan will be applied at the start of the next turn.
   *
   * @param args The plan update arguments
   * @throws Error if no thread ID is available
   */
  updatePlan(args: {
    explanation?: string;
    plan: Array<{
      step: string;
      status: "pending" | "in_progress" | "completed";
    }>;
  }): void {
    if (!this._id) {
      throw new Error("Cannot update plan: no active thread");
    }

    const binding = getNativeBinding();
    if (!binding || typeof binding.emitPlanUpdate !== 'function') {
      throw new Error("emitPlanUpdate is not available in this build");
    }

    binding.emitPlanUpdate({
      threadId: this._id,
      explanation: args.explanation,
      plan: args.plan,
    });
  }

  /**
   * Modify the agent's plan/todo list with granular operations.
   * Changes will be applied at the start of the next turn.
   *
   * @param operations Array of operations to perform on the plan
   * @throws Error if no thread ID is available
   */
  modifyPlan(operations: Array<
    | { type: "add"; item: { step: string; status?: "pending" | "in_progress" | "completed" } }
    | { type: "update"; index: number; updates: Partial<{ step: string; status: "pending" | "in_progress" | "completed" }> }
    | { type: "remove"; index: number }
    | { type: "reorder"; newOrder: number[] }
  >): void {
    if (!this._id) {
      throw new Error("Cannot modify plan: no active thread");
    }

    const binding = getNativeBinding();
    if (!binding || typeof binding.modifyPlan !== 'function') {
      throw new Error("modifyPlan is not available in this build");
    }

    binding.modifyPlan({
      threadId: this._id,
      operations,
    });
  }

  /**
   * Add a new todo item to the agent's plan.
   *
   * @param step The todo step description
   * @param status The initial status (defaults to "pending")
   */
  addTodo(step: string, status: "pending" | "in_progress" | "completed" = "pending"): void {
    this.modifyPlan([{ type: "add", item: { step, status } }]);
  }

  /**
   * Update an existing todo item.
   *
   * @param index The index of the todo item to update
   * @param updates The updates to apply
   */
  updateTodo(
    index: number,
    updates: Partial<{ step: string; status: "pending" | "in_progress" | "completed" }>
  ): void {
    this.modifyPlan([{ type: "update", index, updates }]);
  }

  /**
   * Remove a todo item from the plan.
   *
   * @param index The index of the todo item to remove
   */
  removeTodo(index: number): void {
    this.modifyPlan([{ type: "remove", index }]);
  }

  /**
   * Reorder the todo items in the plan.
   *
   * @param newOrder Array of indices representing the new order
   */
  reorderTodos(newOrder: number[]): void {
    this.modifyPlan([{ type: "reorder", newOrder }]);
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
      model: this._threadOptions?.model ?? this._options.defaultModel,
      sandboxMode: this._threadOptions?.sandboxMode,
      approvalMode: this._threadOptions?.approvalMode,
      workspaceWriteOptions: this._threadOptions?.workspaceWriteOptions,
      workingDirectory: this._threadOptions?.workingDirectory,
      skipGitRepoCheck,
      modelProvider: this._options.modelProvider,
    });
    // No return value needed; compaction modifies server-side history.
    if (!Array.isArray(events)) {
      throw new Error("Compact did not return event list");
    }
  }

  /**
   * Fork this thread at the specified user message, returning a new thread that starts
   * from the conversation history prior to that message.
   *
   * @param options Fork configuration including which user message to branch before and optional thread overrides.
   */
  async fork(options: ForkOptions): Promise<Thread> {
    if (!this._id) {
      throw new Error("Cannot fork: no active thread");
    }
    const nthUserMessage = options?.nthUserMessage;
    if (
      typeof nthUserMessage !== "number" ||
      !Number.isInteger(nthUserMessage) ||
      nthUserMessage < 0
    ) {
      throw new Error("nthUserMessage must be a non-negative integer");
    }

    const overrides = options.threadOptions ?? {};
    const nextThreadOptions: ThreadOptions = {
      ...this._threadOptions,
      ...overrides,
    };

    const skipGitRepoCheck =
      nextThreadOptions.skipGitRepoCheck ??
      (typeof process !== "undefined" &&
        process.env &&
        process.env.CODEX_TEST_SKIP_GIT_REPO_CHECK === "1");
    nextThreadOptions.skipGitRepoCheck = skipGitRepoCheck;

    if (!skipGitRepoCheck) {
      assertTrustedDirectory(nextThreadOptions.workingDirectory);
    }

    const forkArgs: CodexForkArgs = {
      threadId: this._id,
      nthUserMessage,
      baseUrl: this._options.baseUrl,
      apiKey: this._options.apiKey,
      model: nextThreadOptions.model ?? this._options.defaultModel,
      oss: nextThreadOptions.oss,
      sandboxMode: nextThreadOptions.sandboxMode,
      approvalMode: nextThreadOptions.approvalMode,
      workspaceWriteOptions: nextThreadOptions.workspaceWriteOptions,
      workingDirectory: nextThreadOptions.workingDirectory,
      skipGitRepoCheck,
      fullAuto: nextThreadOptions.fullAuto,
      modelProvider: this._options.modelProvider,
    };

    const result = await this._exec.fork(forkArgs);

    return new Thread(
      this._exec,
      this._options,
      nextThreadOptions,
      result.threadId,
    );
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
      oss: turnOptions?.oss ?? options?.oss,
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
          throw new Error(`Failed to parse item: ${item}. Parse error: ${error}`);
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

        // Notify event listeners
        for (const listener of this._eventListeners) {
          try {
            listener(threadEvent);
          } catch (error) {
            // Don't let listener errors break the stream
            console.warn("Thread event listener threw error:", error);
          }
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

  private buildTuiRequest(overrides: Partial<NativeTuiRequest> = {}): NativeTuiRequest {
    const skipGitRepoCheck =
      this._threadOptions?.skipGitRepoCheck ??
      (typeof process !== "undefined" &&
        process.env &&
        process.env.CODEX_TEST_SKIP_GIT_REPO_CHECK === "1");
    if (!skipGitRepoCheck) {
      assertTrustedDirectory(this._threadOptions?.workingDirectory);
    }

    const request: NativeTuiRequest = { ...overrides };
    const assignIfUndefined = <K extends keyof NativeTuiRequest>(
      key: K,
      value: NativeTuiRequest[K] | undefined,
    ) => {
      if (request[key] === undefined && value !== undefined) {
        request[key] = value;
      }
    };

    assignIfUndefined("model", this._threadOptions?.model ?? this._options.defaultModel);
    assignIfUndefined("oss", this._threadOptions?.oss);
    assignIfUndefined("sandboxMode", this._threadOptions?.sandboxMode);
    assignIfUndefined("approvalMode", this._threadOptions?.approvalMode);
    assignIfUndefined("fullAuto", this._threadOptions?.fullAuto);
    assignIfUndefined("workingDirectory", this._threadOptions?.workingDirectory);
    assignIfUndefined("baseUrl", this._options.baseUrl);
    assignIfUndefined("apiKey", this._options.apiKey);

    if (
      request.resumeSessionId === undefined &&
      request.resumePicker !== true &&
      request.resumeLast !== true &&
      this._id
    ) {
      request.resumeSessionId = this._id;
    }

    return request;
  }

  /**
   * Launches the interactive Codex TUI (Terminal User Interface) for this thread and returns a session handle.
   *
   * The handle allows advanced workflows where the TUI can be started and stopped programmatically,
   * while preserving the underlying conversation state.
   */
  launchTui(overrides: Partial<NativeTuiRequest> = {}): TuiSession {
    const request = this.buildTuiRequest(overrides);
    const detachLsp = this.attachDefaultLspBridge(request);
    const session = startTui(request);
    return this.wrapTuiSession(session, detachLsp);
  }

  /**
   * Launches the interactive Codex TUI (Terminal User Interface) for this thread.
   *
   * This method enables seamless transition from programmatic agent interaction to
   * interactive terminal chat within the same session. The TUI takes over the terminal
   * and allows you to continue the conversation interactively.
   *
   * @param overrides - Optional configuration to override thread defaults. Supports all TUI options
   *                    including prompt, sandbox mode, approval mode, and resume options.
   * @param options - Optional run options including an AbortSignal to request shutdown.
   * @returns A Promise that resolves to TUI exit information including:
   *          - tokenUsage: Token consumption statistics
   *          - conversationId: Session ID for resuming later
   *          - updateAction: Optional suggested update command
   * @throws {Error} If not in a trusted git repository (unless skipGitRepoCheck is set)
   * @throws {Error} If the terminal is not interactive (TTY required)
   */
  async tui(
    overrides: Partial<NativeTuiRequest> = {},
    options: RunTuiOptions = {},
  ): Promise<NativeTuiExitInfo> {
    const request = this.buildTuiRequest(overrides);
    const detachLsp = this.attachDefaultLspBridge(request);
    try {
      return await runTui(request, options);
    } finally {
      detachLsp();
    }
  }

  private wrapTuiSession(session: TuiSession, cleanup: () => void): TuiSession {
    let released = false;
    const release = () => {
      if (released) {
        return;
      }
      released = true;
      cleanup();
    };
    return {
      wait: async () => {
        try {
          return await session.wait();
        } finally {
          release();
        }
      },
      shutdown: () => {
        release();
        session.shutdown();
      },
      get closed() {
        return session.closed;
      },
    };
  }

  private attachDefaultLspBridge(request: NativeTuiRequest): () => void {
    const workingDirectory =
      request.workingDirectory ??
      this._threadOptions?.workingDirectory ??
      (typeof process !== "undefined" && typeof process.cwd === "function"
        ? process.cwd()
        : ".");
    return attachLspDiagnostics(this, {
      workingDirectory,
      waitForDiagnostics: true,
    });
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
