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
const runTuiMock: jest.MockedFunction<RunTuiFn> = jest.fn();
type StartTuiFn = (request: NativeTuiRequest) => TuiSession | Promise<TuiSession>;
const startTuiMock: jest.MockedFunction<StartTuiFn> = jest.fn();
const detachSpies: jest.Mock[] = [];
type AttachLspDiagnosticsFn = (
  thread: unknown,
  options: { workingDirectory: string; waitForDiagnostics?: boolean },
) => () => void;
const attachLspDiagnosticsMock: jest.MockedFunction<AttachLspDiagnosticsFn> = jest.fn(
  () => {
    const detach = jest.fn(() => undefined);
    detachSpies.push(detach);
    return detach;
  },
);

jest.unstable_mockModule("../src/tui", () => ({
  runTui: runTuiMock,
  startTui: startTuiMock,
}));
jest.unstable_mockModule("../src/lsp", () => ({
  attachLspDiagnostics: attachLspDiagnosticsMock,
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
    attachLspDiagnosticsMock.mockClear();
    detachSpies.length = 0;
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

  it("attaches and detaches LSP diagnostics when running TUI", async () => {
    runTuiMock.mockResolvedValue(mockExitInfo("diag-run"));

    const thread = new Thread(
      {} as any,
      {},
      {
        workingDirectory: "/repo",
        skipGitRepoCheck: true,
      },
      "diag-run",
    );

    await thread.tui({ workingDirectory: "/repo" });

    expect(attachLspDiagnosticsMock).toHaveBeenCalledTimes(1);
    const [threadArg, optionsArg] = attachLspDiagnosticsMock.mock.calls[0]!;
    expect(threadArg).toBe(thread);
    expect(optionsArg).toEqual({ workingDirectory: "/repo", waitForDiagnostics: true });
    expect(detachSpies[0]).toHaveBeenCalledTimes(1);
  });

  it("wraps launchTui handles and detaches diagnostics on completion", async () => {
    const wait = jest.fn(async () => mockExitInfo("launch"));
    const shutdown = jest.fn();
    const session = { wait, shutdown, closed: false } as unknown as TuiSession;
    startTuiMock.mockReturnValue(session);

    const thread = new Thread(
      {} as any,
      {},
      {
        workingDirectory: "/repo",
        skipGitRepoCheck: true,
      },
      "resume-123",
    );

    const handle = thread.launchTui({ prompt: "Hello" });

    expect(startTuiMock).toHaveBeenCalledTimes(1);
    expect(startTuiMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Hello",
        resumeSessionId: "resume-123",
      }),
    );
    expect(attachLspDiagnosticsMock).toHaveBeenCalledTimes(1);
    const detachOnWait = detachSpies[0];
    await handle.wait();
    expect(wait).toHaveBeenCalledTimes(1);
    expect(detachOnWait).toHaveBeenCalledTimes(1);

    const shutdownSessionWait = jest.fn();
    const shutdownSessionShutdown = jest.fn();
    const shutdownSession = {
      wait: shutdownSessionWait,
      shutdown: shutdownSessionShutdown,
      closed: false,
    } as unknown as TuiSession;
    startTuiMock.mockReturnValue(shutdownSession);
    const secondHandle = thread.launchTui({});
    const detachOnShutdown = detachSpies[1];
    secondHandle.shutdown();
    expect(shutdownSessionShutdown).toHaveBeenCalledTimes(1);
    expect(detachOnShutdown).toHaveBeenCalledTimes(1);
  });
});
