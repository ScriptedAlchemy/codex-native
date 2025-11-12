import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const noopExitInfo = {
  tokenUsage: {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  },
  conversationId: undefined,
};

describe("startTui / runTui", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("runTui forwards abort signal to session.shutdown", async () => {
    const waitMock = jest.fn<() => Promise<typeof noopExitInfo>>().mockResolvedValue(noopExitInfo);
    const shutdownMock = jest.fn();

    jest.unstable_mockModule("../src/nativeBinding", () => ({
      getNativeBinding: () => ({
        startTui: () => ({
          wait: waitMock,
          shutdown: shutdownMock,
          closed: false,
        }),
      }),
    }));

    const { runTui } = await import("../src/tui");
    const controller = new AbortController();

    const resultPromise = runTui({}, { signal: controller.signal });
    controller.abort();

    const result = await resultPromise;

    expect(result).toEqual(noopExitInfo);
    expect(waitMock).toHaveBeenCalledTimes(1);
    expect(shutdownMock).toHaveBeenCalledTimes(1);
  });

  it("startTui falls back to legacy runTui binding when startTui is unavailable", async () => {
    const runTuiMock = jest.fn<() => Promise<typeof noopExitInfo>>().mockResolvedValue(noopExitInfo);

    jest.unstable_mockModule("../src/nativeBinding", () => ({
      getNativeBinding: () => ({
        runTui: runTuiMock,
      }),
    }));

    const { startTui } = await import("../src/tui");

    const session = await startTui({});
    await expect(session.wait()).resolves.toEqual(noopExitInfo);
    expect(runTuiMock).toHaveBeenCalledTimes(1);
    expect(session.closed).toBe(true);
    expect(() => session.shutdown()).toThrow(/Programmatic shutdown is not supported/);
  });
});


