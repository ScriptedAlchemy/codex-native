/**
 * Validate model resolution paths per Agents SDK docs:
 * - https://openai.github.io/openai-agents-js/guides/models/
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

describe("Agents models defaults/resolution with CodexProvider", () => {
  it("uses Runner-level default model when agent doesn't specify", async () => {
    const { Agent, Runner } = await import("@openai/agents");
    const { url, close } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(
          responseStarted("response_1"),
          assistantMessage("runner default model ok"),
          responseCompleted("response_1"),
        ),
      ],
    });

    try {
      const provider = new CodexProvider({ baseUrl: url, skipGitRepoCheck: true });
      const runner = new Runner({ modelProvider: provider, model: "gpt-5-codex" });
      const agent = new Agent({ name: "NoModel", instructions: "Respond plainly." });
      const result = await runner.run(agent, "hello");
      expect(result.finalOutput).toContain("ok");
    } finally {
      await close();
    }
  }, 15000);

  it("accepts agent-level model and overrides runner model", async () => {
    const { Agent, Runner } = await import("@openai/agents");
    const { url, close } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(
          responseStarted("response_1"),
          assistantMessage("agent model ok"),
          responseCompleted("response_1"),
        ),
      ],
    });

    try {
      const provider = new CodexProvider({ baseUrl: url, skipGitRepoCheck: true });
      const runner = new Runner({ modelProvider: provider, model: "gpt-5" });
      const agent = new Agent({
        name: "AgentModel",
        instructions: "Respond plainly.",
        model: "gpt-5-codex",
      });
      const result = await runner.run(agent, "hello");
      expect(result.finalOutput).toContain("ok");
    } finally {
      await close();
    }
  }, 15000);

  it("rejects unsupported non-GPT-5 model names", async () => {
    const provider = new CodexProvider({ skipGitRepoCheck: true });
    const model = provider.getModel("gpt-4.1"); // not allowed in our binding
    await expect(async () => {
      await model.getResponse({
        systemInstructions: "You are a test",
        input: "hi",
        modelSettings: {},
        tools: [],
        outputType: undefined,
        handoffs: [],
        tracing: { enabled: false },
      });
    }).rejects.toThrow(/Invalid model "gpt-4\.1"/);
  });

  const RUN_OSS = process.env.CODEX_NATIVE_RUN_OSS_TEST === "1";
  (RUN_OSS ? it : it.skip)("accepts OSS model when provider is configured for OSS", async () => {
    const { Agent, Runner } = await import("@openai/agents");
    const { url, close } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(
          responseStarted("response_1"),
          assistantMessage("oss ok"),
          responseCompleted("response_1"),
        ),
      ],
    });

    try {
      const provider = new CodexProvider({ baseUrl: url, skipGitRepoCheck: true, oss: true });
      const runner = new Runner({ modelProvider: provider, model: "gpt-oss:20b" });
      const agent = new Agent({ name: "OSSAgent", instructions: "Respond plainly." });
      const result = await runner.run(agent, "hello");
      expect(result.finalOutput).toContain("oss ok");
    } finally {
      await close();
    }
  }, 15000);
});


