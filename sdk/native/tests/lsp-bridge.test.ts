import path from "node:path";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import type { Thread } from "../src/thread";
import type { ThreadEvent } from "../src/events";
import type { FileDiagnostics } from "../src/lsp/types";
const collectDiagnosticsMock = jest.fn(async () => [] as FileDiagnostics[]);

jest.unstable_mockModule("../src/lsp/manager", () => {
  return {
    LspManager: jest.fn().mockImplementation(() => ({
      collectDiagnostics: collectDiagnosticsMock,
      dispose: jest.fn(),
    })),
  };
});

const { LspDiagnosticsBridge } = await import("../src/lsp/bridge");

describe("LspDiagnosticsBridge", () => {
  beforeEach(() => {
    collectDiagnosticsMock.mockReset();
  });

  it("sends a background event when file changes produce diagnostics", async () => {
    const { thread, emit, sendBackgroundEvent } = createThreadHarness();
    const bridge = new LspDiagnosticsBridge({
      workingDirectory: "/repo",
      waitForDiagnostics: true,
    });
    bridge.attach(thread);

    collectDiagnosticsMock.mockResolvedValue([
      {
        path: path.resolve("/repo", "src/app.ts"),
        diagnostics: [
          {
            message: "Unused variable",
            severity: "warning",
            source: "tsc",
            code: "TS6133",
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          },
        ],
      },
    ]);

    emit({
      type: "item.completed",
      item: {
        id: "file-change-1",
        type: "file_change",
        status: "completed",
        changes: [{ path: "src/app.ts", kind: "update" }],
      },
    });

    await flushAsync();

    expect(collectDiagnosticsMock).toHaveBeenCalledWith([
      path.resolve("/repo", "src/app.ts"),
    ]);
    expect(sendBackgroundEvent).toHaveBeenCalledTimes(1);
    expect(getFirstBackgroundMessage(sendBackgroundEvent)).toContain("src/app.ts");
  });

  it("queues diagnostics when read_file MCP calls inspect a file", async () => {
    const { thread, emit, sendBackgroundEvent } = createThreadHarness();
    const bridge = new LspDiagnosticsBridge({
      workingDirectory: "/repo",
    });
    bridge.attach(thread);

    collectDiagnosticsMock.mockResolvedValue([
      {
        path: path.resolve("/repo", "README.md"),
        diagnostics: [
          {
            message: "Trailing whitespace",
            severity: "info",
            source: "markdownlint",
            code: "MD009",
            range: { start: { line: 4, character: 0 }, end: { line: 4, character: 1 } },
          },
        ],
      },
    ]);

    emit({
      type: "item.completed",
      item: {
        id: "tool-1",
        type: "mcp_tool_call",
        server: "fs",
        tool: "read_file",
        status: "completed",
        arguments: { path: "README.md" },
      },
    });

    await flushAsync();

    expect(collectDiagnosticsMock).toHaveBeenCalledWith([
      path.resolve("/repo", "README.md"),
    ]);
    expect(sendBackgroundEvent).toHaveBeenCalledTimes(1);
    const message = getFirstBackgroundMessage(sendBackgroundEvent);
    expect(message).toContain("README.md");
    expect(message).toContain("Trailing whitespace");
  });

  it("does not emit background events when diagnostics are empty", async () => {
    const { thread, emit, sendBackgroundEvent } = createThreadHarness();
    const bridge = new LspDiagnosticsBridge({ workingDirectory: "/repo" });
    bridge.attach(thread);

    collectDiagnosticsMock.mockResolvedValue([]);

    emit({
      type: "item.completed",
      item: {
        id: "file-change-skip",
        type: "file_change",
        status: "completed",
        changes: [{ path: "src/skip.ts", kind: "update" }],
      },
    });

    await flushAsync();

    expect(sendBackgroundEvent).not.toHaveBeenCalled();
  });
});

function getFirstBackgroundMessage(mockFn: ReturnType<typeof jest.fn>): string {
  const calls = mockFn.mock.calls as Array<[string]>;
  const first = calls[0];
  if (!first) {
    throw new Error("background event was never emitted");
  }
  return first[0];
}

function createThreadHarness() {
  const listeners: Array<(event: ThreadEvent) => void> = [];
  const sendBackgroundEvent = jest.fn(async () => undefined);

  const thread = {
    onEvent: (listener: (event: ThreadEvent) => void) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index !== -1) {
          listeners.splice(index, 1);
        }
      };
    },
    sendBackgroundEvent,
  } as unknown as Thread;

  return {
    thread,
    sendBackgroundEvent,
    emit(event: ThreadEvent) {
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}
