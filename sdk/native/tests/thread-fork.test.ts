import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

import { Thread, ForkOptions } from "../src/thread";
import type { CodexForkArgs } from "../src/exec";

describe("Thread.fork", () => {
  const ORIGINAL_ENV = process.env.CODEX_TEST_SKIP_GIT_REPO_CHECK;

  beforeEach(() => {
    process.env.CODEX_TEST_SKIP_GIT_REPO_CHECK = "1";
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.CODEX_TEST_SKIP_GIT_REPO_CHECK;
    } else {
      process.env.CODEX_TEST_SKIP_GIT_REPO_CHECK = ORIGINAL_ENV;
    }
  });

  it("creates a new thread with merged options", async () => {
    const forkArgs: CodexForkArgs[] = [];
    const exec = {
      fork: jest.fn(async (args: CodexForkArgs) => {
        forkArgs.push(args);
        return { threadId: "forked-thread-id", rolloutPath: "/tmp/rollout.jsonl" };
      }),
    };

    const baseOptions = { baseUrl: "https://api.local", apiKey: "sk-test" };
    const threadOptions = {
      model: "gpt-5-codex-mini",
      sandboxMode: "workspace-write" as const,
      approvalMode: "on-request" as const,
      skipGitRepoCheck: true,
    };

    const thread = new Thread(exec as any, baseOptions, threadOptions, "original-thread-id");

    const forkOptions: ForkOptions = {
      nthUserMessage: 1,
      threadOptions: {
        model: "gpt-5-codex",
      },
    };

    const forked = await thread.fork(forkOptions);

    expect(exec.fork).toHaveBeenCalledTimes(1);
    expect(forkArgs[0]).toMatchObject({
      threadId: "original-thread-id",
      nthUserMessage: 1,
      baseUrl: baseOptions.baseUrl,
      apiKey: baseOptions.apiKey,
      model: "gpt-5-codex",
      sandboxMode: "workspace-write",
      approvalMode: "on-request",
      skipGitRepoCheck: true,
    });

    expect(forked.id).toBe("forked-thread-id");
  });

  it("throws when nthUserMessage is missing", async () => {
    const exec = {
      fork: jest.fn(),
    };
    const thread = new Thread(exec as any, {}, { skipGitRepoCheck: true }, "thread-1");
    await expect(thread.fork({} as ForkOptions)).rejects.toThrow("nthUserMessage");
  });
});

