import { ApprovalMode, SandboxMode, WorkspaceWriteOptions } from "./threadOptions";
import {
  NativeBinding,
  NativeConversationListPage,
  NativeConversationListRequest,
  NativeDeleteConversationRequest,
  NativeDeleteConversationResult,
  NativeForkRequest,
  NativeForkResult,
  NativeResumeFromRolloutRequest,
  NativeRunRequest,
  getNativeBinding,
} from "./nativeBinding";

export type CodexExecArgs = {
  input: string;
  baseUrl?: string;
  apiKey?: string;
  threadId?: string | null;
  images?: string[];
  model?: string;
  /** Use local OSS provider via Ollama (pulls models as needed) */
  oss?: boolean;
  sandboxMode?: SandboxMode;
  approvalMode?: ApprovalMode;
  workspaceWriteOptions?: WorkspaceWriteOptions;
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  outputSchemaFile?: string;
  outputSchema?: unknown;
  /** @deprecated Use sandboxMode and approvalMode instead */
  fullAuto?: boolean;
  review?: ReviewExecOptions | null;
};

export type ReviewExecOptions = {
  userFacingHint?: string;
};

export type CodexForkArgs = {
  threadId: string;
  nthUserMessage: number;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  oss?: boolean;
  sandboxMode?: SandboxMode;
  approvalMode?: ApprovalMode;
  workspaceWriteOptions?: WorkspaceWriteOptions;
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  linuxSandboxPath?: string;
  fullAuto?: boolean;
};

/**
 * CodexExec for the native package - uses NAPI bindings exclusively.
 * No CLI fallback.
 */
export class CodexExec {
  private readonly native: NativeBinding;

  constructor() {
    const nativeBinding = getNativeBinding();
    if (!nativeBinding) {
      throw new Error(
        "Native NAPI binding not available. Make sure @openai/codex-native is properly installed and built."
      );
    }
    this.native = nativeBinding;
  }

  requiresOutputSchemaFile(): boolean {
    return false;
  }

  async *run(args: CodexExecArgs): AsyncGenerator<string> {
    const binding = this.native;
    const queue = new AsyncQueue<string>();

    // Validate model selection before crossing the N-API boundary.
    validateModel(args.model, args.oss === true);

    const request: NativeRunRequest = {
      prompt: args.input,
      threadId: args.threadId ?? undefined,
      images: args.images && args.images.length > 0 ? args.images : undefined,
      model: args.model,
      oss: args.oss,
      approvalMode: args.approvalMode,
      workspaceWriteOptions: args.workspaceWriteOptions,
      sandboxMode: args.sandboxMode,
      workingDirectory: args.workingDirectory,
      skipGitRepoCheck: args.skipGitRepoCheck,
      outputSchema: args.outputSchema,
      baseUrl: args.baseUrl,
      apiKey: args.apiKey,
      fullAuto: args.fullAuto,
      reviewMode: args.review ? true : undefined,
      reviewHint: args.review?.userFacingHint,
    };

    let runPromise: Promise<void> = Promise.resolve();
    try {
      runPromise = binding
        .runThreadStream(request, (err, eventJson) => {
          if (err) {
            queue.fail(err);
            return;
          }
          try {
            queue.push(eventJson ?? "null");
          } catch (error) {
            queue.fail(error);
          }
        })
        .then(
          () => {
            queue.end();
          },
          (error) => {
            queue.fail(error);
          },
        );
    } catch (error) {
      queue.fail(error);
      throw error;
    }

    let loopError: unknown;
    try {
      for await (const value of queue) {
        yield value;
      }
      await runPromise;
    } catch (error) {
      loopError = error;
      throw error;
    } finally {
      queue.end();
      if (loopError) {
        await runPromise.catch(() => {});
      }
    }
  }

  async compact(args: CodexExecArgs): Promise<string[]> {
    validateModel(args.model, args.oss === true);
    const request: NativeRunRequest = {
      prompt: args.input,
      threadId: args.threadId ?? undefined,
      images: args.images && args.images.length > 0 ? args.images : undefined,
      model: args.model,
      oss: args.oss,
      sandboxMode: args.sandboxMode,
      approvalMode: args.approvalMode,
      workspaceWriteOptions: args.workspaceWriteOptions,
      workingDirectory: args.workingDirectory,
      skipGitRepoCheck: args.skipGitRepoCheck,
      outputSchema: args.outputSchema,
      baseUrl: args.baseUrl,
      apiKey: args.apiKey,
      fullAuto: args.fullAuto,
      reviewMode: args.review ? true : undefined,
      reviewHint: args.review?.userFacingHint,
    };
    return this.native.compactThread(request);
  }

  async fork(args: CodexForkArgs): Promise<NativeForkResult> {
    if (!args.threadId) {
      throw new Error("threadId is required to fork a conversation");
    }
    const request: NativeForkRequest = {
      threadId: args.threadId,
      nthUserMessage: args.nthUserMessage,
      model: args.model,
      oss: args.oss,
      sandboxMode: args.sandboxMode,
      approvalMode: args.approvalMode,
      workspaceWriteOptions: args.workspaceWriteOptions,
      workingDirectory: args.workingDirectory,
      skipGitRepoCheck: args.skipGitRepoCheck,
      baseUrl: args.baseUrl,
      apiKey: args.apiKey,
      linuxSandboxPath: args.linuxSandboxPath,
      fullAuto: args.fullAuto,
    };
    return this.native.forkThread(request);
  }

  async listConversations(
    request: NativeConversationListRequest,
  ): Promise<NativeConversationListPage> {
    return this.native.listConversations(request);
  }

  async deleteConversation(
    request: NativeDeleteConversationRequest,
  ): Promise<NativeDeleteConversationResult> {
    return this.native.deleteConversation(request);
  }

  async resumeConversationFromRollout(
    request: NativeResumeFromRolloutRequest,
  ): Promise<NativeForkResult> {
    return this.native.resumeConversationFromRollout(request);
  }
}

type Resolver<T> = {
  resolve: (result: IteratorResult<T>) => void;
  reject: (error: unknown) => void;
};

class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = [];
  private waiters: Resolver<T>[] = [];
  private ended = false;
  private error: unknown;

  push(value: T) {
    if (this.ended) return;
    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter.resolve({ value, done: false });
      return;
    }
    this.buffer.push(value);
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) {
      waiter.resolve({ value: undefined as never, done: true });
    }
  }

  fail(error: unknown) {
    if (this.ended) return;
    this.error = error;
    this.ended = true;
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) {
      waiter.reject(error);
    }
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.buffer.length > 0) {
      const value = this.buffer.shift()!;
      return { value, done: false };
    }
    if (this.error) {
      return Promise.reject(this.error);
    }
    if (this.ended) {
      return { value: undefined as never, done: true };
    }

    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return this;
  }
}

function validateModel(model: string | undefined | null, oss: boolean): void {
  if (!model) return;
  const trimmed = String(model).trim();
  if (oss) {
    // In OSS mode, only accept gpt-oss:* models
    if (!trimmed.startsWith("gpt-oss:")) {
      throw new Error(
        `Invalid model "${trimmed}" for OSS mode. Use models prefixed with "gpt-oss:", e.g. "gpt-oss:20b".`
      );
    }
    return;
  }
  // Non-OSS mode: restrict to supported hosted models
  const allowed = new Set([
    "gpt-5",
    "gpt-5-codex",
    "gpt-5-codex-mini",
    "gpt-5.1",
    "gpt-5.1-codex",
    "gpt-5.1-codex-mini",
  ]);
  if (!allowed.has(trimmed)) {
    throw new Error(
      `Invalid model "${trimmed}". Supported models are ${Array.from(allowed)
        .map((m) => `"${m}"`)
        .join(", " )}.`
    );
  }
}
