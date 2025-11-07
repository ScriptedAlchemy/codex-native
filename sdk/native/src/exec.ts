import { SandboxMode } from "./threadOptions";
import { NativeBinding, NativeRunRequest, getNativeBinding } from "./nativeBinding";

export type CodexExecArgs = {
  input: string;
  baseUrl?: string;
  apiKey?: string;
  threadId?: string | null;
  images?: string[];
  model?: string;
  sandboxMode?: SandboxMode;
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  outputSchemaFile?: string;
  outputSchema?: unknown;
  fullAuto?: boolean;
  review?: ReviewExecOptions | null;
};

export type ReviewExecOptions = {
  userFacingHint?: string;
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

    const request: NativeRunRequest = {
      prompt: args.input,
      threadId: args.threadId ?? undefined,
      images: args.images && args.images.length > 0 ? args.images : undefined,
      model: args.model,
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
