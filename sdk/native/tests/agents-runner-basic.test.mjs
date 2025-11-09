/**
 * Basic Agents runner integration validating our CodexProvider interop with
 * the OpenAI Agents SDK per guides:
 * - https://openai.github.io/openai-agents-js/guides/agents/
 * - https://openai.github.io/openai-agents-js/guides/running-agents/
 */

import { describe, it, expect, beforeAll } from "@jest/globals";
import { fileURLToPath } from "node:url";
import {
  startResponsesTestProxy,
  sse,
  responseStarted,
  assistantMessage,
  responseCompleted,
} from "./responsesProxy.mjs";

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

describe("Agents Runner + CodexProvider - basic flow", () => {
  it("runs Agent via Runner with CodexProvider and returns final output", async () => {
    const { Agent, Runner } = await import("@openai/agents");

    const { url, close } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(
          responseStarted("response_1"),
          assistantMessage("Hello from Agents + Codex!", "item_1"),
          responseCompleted("response_1"),
        ),
      ],
    });

    try {
      const provider = new CodexProvider({
        baseUrl: url,
        skipGitRepoCheck: true,
      });

      const agent = new Agent({
        name: "HelloAgent",
        instructions: "Respond with a friendly greeting.",
      });

      const runner = new Runner({ modelProvider: provider });
      const result = await runner.run(agent, "Say hello");

      expect(result).toBeDefined();
      expect(typeof result.finalOutput).toBe("string");
      expect(result.finalOutput).toContain("Hello");
    } finally {
      await close();
    }
  }, 15000);
});


