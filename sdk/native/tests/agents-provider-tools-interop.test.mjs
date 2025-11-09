/**
 * Validate that Agents tools passed in ModelRequest are registered with CodexProvider
 * Reference: https://openai.github.io/openai-agents-js/
 */

import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { fileURLToPath } from "node:url";

function resolveNativeBindingPath() {
  const triplet = (() => {
    const { platform, arch } = process;
    if (platform === "darwin") {
      return arch === "arm64" ? "codex_native.darwin-arm64.node" : "codex_native.darwin-x64.node";
    }
    if (platform === "linux") {
      const suffix = process.env.MUSL ? "musl" : "gnu";
      return `codex_native.${platform}-${arch}-${suffix}.node`;
    }
    if (platform === "win32") {
      return arch === "arm64"
        ? "codex_native.win32-arm64-msvc.node"
        : "codex_native.win32-x64-msvc.node";
    }
    throw new Error(`Unsupported platform for tests: ${platform} ${arch}`);
  })();
  return fileURLToPath(new URL(`../${triplet}`, import.meta.url));
}

process.env.CODEX_NATIVE_BINDING = resolveNativeBindingPath();

let CodexProvider;
beforeAll(async () => {
  ({ CodexProvider } = await import("../dist/index.mjs"));
});

describe("Agents tools interop", () => {
  // Skip in CI - this test requires backend authentication
  const testFn = process.env.CI ? it.skip : it;

  testFn("registers function tools with Codex when provided in ModelRequest", async () => {
    const provider = new CodexProvider({ skipGitRepoCheck: true });
    const model = provider.getModel("gpt-5-codex");

    // Spy on registration logging to confirm registration path is executed.
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    const tool = {
      type: "function",
      name: "say_hello",
      description: "Says hello",
      parameters: { type: "object", properties: { name: { type: "string" } } },
      execute: async ({ name }) => `Hello, ${name}!`,
    };

    await model.getResponse({
      systemInstructions: "You are a tool testing agent",
      input: "test",
      modelSettings: {},
      tools: [tool],
      // No structured output to keep this test focused on registration path
      outputType: undefined,
      handoffs: [],
      tracing: { enabled: false },
    });

    // The provider should have attempted registration (observe log)
    expect(logSpy).toHaveBeenCalled();
    const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("Registered tool with Codex: say_hello");
    logSpy.mockRestore();
  }, 30000); // Increased timeout for CI environments
});


