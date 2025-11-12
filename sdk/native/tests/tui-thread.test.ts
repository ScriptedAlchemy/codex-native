import { describe, expect, it, beforeEach, jest } from "@jest/globals";

import type {
  NativeTuiExitInfo,
  NativeTuiRequest,
  RunTuiOptions,
  TuiSession,
} from "../src/tui";

type RunTuiFn = (
  request: NativeTuiRequest,
  options?: RunTuiOptions,
) => Promise<NativeTuiExitInfo>;
const runTuiMock = jest.fn<RunTuiFn>();
type StartTuiFn = (request: NativeTuiRequest) => Promise<TuiSession>;
const startTuiMock = jest.fn<StartTuiFn>();

jest.unstable_mockModule("../src/tui", () => ({
  runTui: runTuiMock,
  startTui: startTuiMock,
}));

const { Thread } = await import("../src/thread");

const mockExitInfo = (conversationId: string): NativeTuiExitInfo => ({
  tokenUsage: {
    inputTokens: 1,
    cachedInputTokens: 0,
    outputTokens: 2,
    reasoningOutputTokens: 0,
    totalTokens: 3,
  },
  conversationId,
});

describe("Thread.tui", () => {
  beforeEach(() => {
    runTuiMock.mockReset();
    startTuiMock.mockReset();
  });

  it("reuses thread defaults and resumes existing session", async () => {
    runTuiMock.mockResolvedValue(mockExitInfo("resume-123"));

    const thread = new Thread(
      {} as any,
      { baseUrl: "https://api.example.com", apiKey: "test-key" },
      {
        model: "gpt-5-codex",
        sandboxMode: "workspace-write",
        approvalMode: "on-request",
        workingDirectory: "/tmp/project",
        skipGitRepoCheck: true,
      },
      "resume-123",
    );

    const result = await thread.tui();

    expect(runTuiMock).toHaveBeenCalledTimes(1);
    expect(runTuiMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5-codex",
        sandboxMode: "workspace-write",
        approvalMode: "on-request",
        workingDirectory: "/tmp/project",
        resumeSessionId: "resume-123",
        baseUrl: "https://api.example.com",
        apiKey: "test-key",
      }),
      {},
    );
    expect(result).toEqual(mockExitInfo("resume-123"));
  });

  it("respects overrides and avoids forcing resume when picker requested", async () => {
    runTuiMock.mockResolvedValue(mockExitInfo("from-picker"));

    const thread = new Thread(
      {} as any,
      {},
      {
        sandboxMode: "danger-full-access",
        approvalMode: "untrusted",
        skipGitRepoCheck: true,
      },
      "resume-123",
    );

    await thread.tui({
      resumePicker: true,
      prompt: "Help me debug",
      sandboxMode: "read-only",
    });

    expect(runTuiMock).toHaveBeenCalledTimes(1);
    const call = runTuiMock.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) {
      throw new Error("runTui was not invoked");
    }
    const [request, options] = call;
    expect(request).toBeDefined();
    if (!request) {
      throw new Error("runTui request argument missing");
    }
    expect(request.resumePicker).toBe(true);
    expect(request.resumeSessionId).toBeUndefined();
    expect(request.sandboxMode).toBe("read-only");
    expect(request.prompt).toBe("Help me debug");
    expect(options).toEqual({});
  });

  it("launchTui returns session handle from binding", async () => {
    const session = {
      wait: jest.fn(),
      shutdown: jest.fn(),
      closed: false,
    } as unknown as TuiSession;
    startTuiMock.mockResolvedValue(session);

    const thread = new Thread(
      {} as any,
      {},
      {
        skipGitRepoCheck: true,
      },
      "resume-123",
    );

    const handle = await thread.launchTui({ prompt: "Hello" });

    expect(startTuiMock).toHaveBeenCalledTimes(1);
    expect(startTuiMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Hello",
        resumeSessionId: "resume-123",
      }),
    );
    expect(handle).toBe(session);
  });

  it("forwards run options to runTui", async () => {
    runTuiMock.mockResolvedValue(mockExitInfo("resume-123"));
    const thread = new Thread(
      {} as any,
      {},
      {
        skipGitRepoCheck: true,
      },
      "resume-123",
    );

    const controller = new AbortController();

    await thread.tui({}, { signal: controller.signal });

    expect(runTuiMock).toHaveBeenCalledTimes(1);
    const call = runTuiMock.mock.calls[0];
    if (!call) {
      throw new Error("runTui was not invoked");
    }
    const [request, options] = call;
    expect(request.resumeSessionId).toBe("resume-123");
    expect(options).toEqual({ signal: controller.signal });
  });
});

