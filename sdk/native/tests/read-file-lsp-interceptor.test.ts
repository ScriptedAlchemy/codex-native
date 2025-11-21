import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import type { FileDiagnostics } from "../src/lsp/types";
import type {
  NativeToolInterceptorNativeContext,
  NativeToolInvocation,
  NativeToolResult,
} from "../src/nativeBinding";

const registerToolInterceptorMock = jest.fn();
// Use loose typing for Jest mocks to avoid over-constraining TS generics in this test.
// The shapes are validated at runtime by how Codex uses these callbacks.
const callToolBuiltinMock: any = jest.fn();
const collectDiagnosticsMock: any = jest.fn();

jest.unstable_mockModule("../src/nativeBinding", () => {
  return {
    getNativeBinding: () => ({
      callToolBuiltin: callToolBuiltinMock,
      registerToolInterceptor: registerToolInterceptorMock,
      clearRegisteredTools: jest.fn(),
    }),
  };
});

jest.unstable_mockModule("../src/lsp/manager", () => {
  return {
    LspManager: jest.fn().mockImplementation(() => ({
      collectDiagnostics: collectDiagnosticsMock,
      dispose: jest.fn(),
    })),
  };
});

jest.unstable_mockModule("../src/lsp/format", () => {
  return {
    formatDiagnosticsForTool: (diagnostics: FileDiagnostics[]): string => {
      return diagnostics
        .map((entry) => `${entry.path}: ${entry.diagnostics.length} issues`)
        .join("\n");
    },
    formatDiagnosticsForBackgroundEvent: () => "",
  };
});

const { Codex } = await import("../src/codex");

describe("Codex read_file LSP interceptor", () => {
  beforeEach(() => {
    registerToolInterceptorMock.mockReset();
    callToolBuiltinMock.mockReset();
    collectDiagnosticsMock.mockReset();
  });

  it("prepends diagnostics to successful read_file output", async () => {
    // Constructing Codex wires up the interceptor.
    // Native binding is mocked above.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const client = new Codex();

    expect(registerToolInterceptorMock).toHaveBeenCalledTimes(1);
    const [toolName, interceptor] = registerToolInterceptorMock.mock.calls[0]!;
    expect(toolName).toBe("read_file");
    expect(typeof interceptor).toBe("function");

    const invocation: NativeToolInvocation = {
      toolName: "read_file",
      callId: "call-1",
      arguments: JSON.stringify({ file_path: "/repo/src/app.ts" }),
    };

    callToolBuiltinMock.mockResolvedValue({
      output: "L1: const x = 1;",
      success: true,
    });

    collectDiagnosticsMock.mockResolvedValue([
      {
        path: "/repo/src/app.ts",
        diagnostics: [
          {
            message: "Unused variable x",
            severity: "warning",
            source: "tsc",
            code: "TS6133",
            range: {
              start: { line: 0, character: 6 },
              end: { line: 0, character: 7 },
            },
          },
        ],
      },
    ]);

    const context: NativeToolInterceptorNativeContext = {
      invocation,
      token: "token-1",
    };

    const result = await (interceptor as any)(context);

    expect(callToolBuiltinMock).toHaveBeenCalledTimes(1);
    expect(callToolBuiltinMock).toHaveBeenCalledWith("token-1", invocation);
    expect(collectDiagnosticsMock).toHaveBeenCalledWith(["/repo/src/app.ts"]);
    expect(result.success).toBe(true);
    expect(result.output).toContain("LSP diagnostics for /repo/src/app.ts:");
    expect(result.output).toContain("/repo/src/app.ts: 1 issues");
    expect(result.output).toContain("L1: const x = 1;");
  });

  it("leaves output unchanged when diagnostics are empty", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const client = new Codex();

    const [, interceptor] = registerToolInterceptorMock.mock.calls[0]!;

    const invocation: NativeToolInvocation = {
      toolName: "read_file",
      callId: "call-2",
      arguments: JSON.stringify({ file_path: "/repo/src/ok.ts" }),
    };

    callToolBuiltinMock.mockResolvedValue({
      output: "L1: console.log('ok');",
      success: true,
    });

    collectDiagnosticsMock.mockResolvedValue([]);

    const context: NativeToolInterceptorNativeContext = {
      invocation,
      token: "token-2",
    };

    const result = await (interceptor as any)(context);

    expect(callToolBuiltinMock).toHaveBeenCalledTimes(1);
    expect(collectDiagnosticsMock).toHaveBeenCalledWith(["/repo/src/ok.ts"]);
    expect(result.output).toBe("L1: console.log('ok');");
  });
});
