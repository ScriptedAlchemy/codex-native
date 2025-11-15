import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { type NativeRunRequest, getNativeBinding } from "../nativeBinding";
import { parseApprovalModeFlag, parseSandboxModeFlag } from "./optionParsers";
import { emitWarnings, runBeforeStartHooks, runEventHooks } from "./hooks";
import { applyElevatedRunDefaults } from "./elevatedDefaults";
import type {
  CliContext,
  CommandName,
  RunCommandOptions,
} from "./types";

export async function executeRunCommand(
  argv: RunCommandOptions,
  context: CliContext,
): Promise<void> {
  const { combinedConfig } = context;
  emitWarnings(combinedConfig.warnings);
  const warningCount = combinedConfig.warnings.length;

  const prompt = await resolvePrompt(argv, combinedConfig.runDefaults.prompt, context.cwd);
  const request = await buildRunRequest({
    prompt,
    argv,
    combinedDefaults: combinedConfig.runDefaults,
    cwd: context.cwd,
  });

  if (!request.skipGitRepoCheck) {
    await assertTrustedDirectory(request.workingDirectory);
  }

  validateModel(request.model, request.oss === true);

  const hookContext = {
    command: "run" as CommandName,
    cwd: context.cwd,
    options: argv,
  };

  await runBeforeStartHooks(combinedConfig.beforeStartHooks, hookContext, combinedConfig.warnings);

  const binding = getNativeBinding();
  if (!binding) {
    throw new Error("Native N-API binding is not available.");
  }

  const queue = new AsyncQueue<string>();
  let conversationId: string | null = null;
  const handleEvent = async (eventJson: string | null | undefined) => {
    if (!eventJson) {
      return;
    }
    process.stdout.write(eventJson);
    process.stdout.write("\n");

    let eventPayload: unknown = eventJson;
    try {
      eventPayload = JSON.parse(eventJson);
    } catch {
      // Leave as string if parsing fails.
    }

    conversationId ??= extractConversationId(eventPayload);
    await runEventHooks(
      combinedConfig.onEventHooks,
      eventPayload,
      hookContext,
      combinedConfig.warnings,
    );
  };

  let runPromise: Promise<void> = Promise.resolve();
  runPromise = binding
    .runThreadStream(request, (err, eventJson) => {
      if (err) {
        queue.fail(err);
        return;
      }
      queue.push(eventJson ?? null);
    })
    .then(
      () => queue.end(),
      (error) => {
        queue.fail(error);
      },
    );

  let loopError: unknown;
  try {
    for await (const eventJson of queue) {
      try {
        await handleEvent(eventJson);
      } catch (error) {
        combinedConfig.warnings.push(
          `Event handler failed: ${(error as Error).message ?? String(error)}`,
        );
      }
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

  if (conversationId) {
    process.stdout.write(`\nTo resume, run: codex-native tui --resume ${conversationId}\n`);
  }

  emitWarnings(combinedConfig.warnings, warningCount);
}

async function resolvePrompt(
  argv: RunCommandOptions,
  defaultPrompt: string | undefined,
  cwd: string,
): Promise<string> {
  if (argv.prompt && argv.prompt.trim().length > 0) {
    return argv.prompt;
  }
  if (defaultPrompt && defaultPrompt.trim().length > 0) {
    return defaultPrompt;
  }

  const stdinPrompt = await readPromptFromStdin();
  if (stdinPrompt && stdinPrompt.trim().length > 0) {
    return stdinPrompt;
  }

  if (argv.threadId) {
    // Resume runs without a prompt are permitted.
    return "";
  }

  const baseMessage = "No prompt provided. Supply a prompt or pipe one via stdin.";
  if (process.stdin.isTTY) {
    throw new Error(baseMessage);
  }
  throw new Error(baseMessage);
}

async function buildRunRequest(params: {
  prompt: string;
  argv: RunCommandOptions;
  combinedDefaults: Partial<NativeRunRequest>;
  cwd: string;
}): Promise<NativeRunRequest> {
  const { prompt, argv, combinedDefaults, cwd } = params;
  const request: NativeRunRequest = {
    ...(combinedDefaults as NativeRunRequest),
    prompt,
  };

  if (combinedDefaults.images) {
    request.images = [...combinedDefaults.images];
  }
  if (combinedDefaults.workspaceWriteOptions) {
    request.workspaceWriteOptions = { ...combinedDefaults.workspaceWriteOptions };
  }

  if (argv.model !== undefined) request.model = argv.model;
  if (argv.oss !== undefined) request.oss = argv.oss;
  const sandboxMode = parseSandboxModeFlag(argv.sandbox, "--sandbox");
  if (sandboxMode !== undefined) {
    request.sandboxMode = sandboxMode;
  }

  const approvalMode = parseApprovalModeFlag(argv.approval, "--approval");
  if (approvalMode !== undefined) {
    request.approvalMode = approvalMode;
  }
  if (argv.threadId !== undefined) request.threadId = argv.threadId;
  if (argv.baseUrl !== undefined) request.baseUrl = argv.baseUrl;
  if (argv.apiKey !== undefined) request.apiKey = argv.apiKey;
  if (argv.linuxSandboxPath !== undefined) request.linuxSandboxPath = argv.linuxSandboxPath;
  if (argv.fullAuto !== undefined) request.fullAuto = argv.fullAuto;
  if (argv.skipGitRepoCheck !== undefined) request.skipGitRepoCheck = argv.skipGitRepoCheck;
  if (argv.cd !== undefined) request.workingDirectory = argv.cd;
  if (argv.reviewMode !== undefined) request.reviewMode = argv.reviewMode;
  if (argv.reviewHint !== undefined) request.reviewHint = argv.reviewHint;

  const images = [
    ...(Array.isArray(request.images) ? request.images : []),
    ...(argv.image ?? []),
  ];
  request.images = images.length > 0 ? images : undefined;

  if (argv.schema) {
    request.outputSchema = await readJsonFile(argv.schema);
  }

  applyElevatedRunDefaults(request, cwd);
  return request;
}

async function readJsonFile(filePath: string): Promise<unknown> {
  const absolute = path.resolve(process.cwd(), filePath);
  const data = await fsPromises.readFile(absolute, "utf8");
  try {
    return JSON.parse(data);
  } catch (error) {
    throw new Error(
      `Failed to parse JSON schema from ${absolute}: ${(error as Error).message ?? error}`,
    );
  }
}

async function readPromptFromStdin(): Promise<string | null> {
  if (process.stdin.isTTY) {
    return null;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) {
    return null;
  }
  return Buffer.concat(chunks).toString("utf8").trimEnd();
}

function extractConversationId(eventPayload: unknown): string | null {
  if (!eventPayload || typeof eventPayload !== "object") {
    return null;
  }

  const record = eventPayload as Record<string, unknown>;

  if (typeof record.session_id === "string") {
    return record.session_id;
  }

  const sessionConfigured = record.SessionConfigured ?? record.sessionConfigured;
  if (sessionConfigured && typeof sessionConfigured === "object") {
    const configuredSessionId = (sessionConfigured as Record<string, unknown>).session_id;
    if (typeof configuredSessionId === "string") {
      return configuredSessionId;
    }
  }

  const nestedSession =
    typeof record.session === "object" && record.session
      ? (record.session as Record<string, unknown>).id
      : undefined;
  if (typeof nestedSession === "string") {
    return nestedSession;
  }

  return null;
}

function validateModel(model: string | undefined, oss: boolean): void {
  if (!model) return;
  const trimmed = String(model).trim();
  if (oss) {
    if (!trimmed.startsWith("gpt-oss:")) {
      throw new Error(
        `Invalid model "${trimmed}" for OSS mode. Use models prefixed with "gpt-oss:", e.g. "gpt-oss:20b".`,
      );
    }
    return;
  }
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
        .join(", " )}.`,
    );
  }
}

async function assertTrustedDirectory(workingDirectory?: string): Promise<void> {
  const directory = workingDirectory ? path.resolve(workingDirectory) : process.cwd();
  if (await findGitRoot(directory)) {
    return;
  }
  throw new Error(
    "Not inside a trusted directory and --skip-git-repo-check was not specified.",
  );
}

async function findGitRoot(startDir: string): Promise<string | null> {
  let current = path.resolve(startDir);

  while (true) {
    const gitPath = path.join(current, ".git");
    if (fs.existsSync(gitPath)) {
      try {
        const stats = await fsPromises.stat(gitPath);
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

class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = [];
  private waiters: Array<{ resolve: (value: IteratorResult<T>) => void; reject: (error: unknown) => void }> = [];
  private ended = false;
  private error: unknown;

  push(value: T | null) {
    if (this.ended) return;
    if (value === null) {
      return;
    }
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
