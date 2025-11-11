/**
 * Validate model resolution paths per Agents SDK docs:
 * - https://openai.github.io/openai-agents-js/guides/models/
 * - https://openai.github.io/openai-agents-js/guides/running-agents/
 */

import { describe, it, expect, beforeAll } from "@jest/globals";
import { spawnSync } from "node:child_process";
import { setupNativeBinding } from "./testHelpers";
import {
  startResponsesTestProxy,
  sse,
  responseStarted,
  assistantMessage,
  responseCompleted,
} from "./responsesProxy";

// Setup native binding for tests
setupNativeBinding();

let CodexProvider: any;
beforeAll(async () => {
  ({ CodexProvider } = await import("../src/index"));
});

const isCI = process.env.CI === "true" || process.env.CI === "1";
const mockEnv = process.env.CODEX_NATIVE_RUN_AGENTS_MOCK;
const shouldRunMockTests = mockEnv !== "0";
const mockTest = shouldRunMockTests ? it : it.skip;
describe("Agents models defaults/resolution with CodexProvider", () => {
  mockTest("uses provider defaultModel when agent doesn't specify", async () => {
    const { url, close, requests } = await startResponsesTestProxy({
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
      const provider = new CodexProvider({ baseUrl: url, skipGitRepoCheck: true, defaultModel: "gpt-5-codex" });
      const model = provider.getModel(); // Use default model
      const result = await model.getResponse({
        systemInstructions: "Respond plainly.",
        input: "hello",
        modelSettings: {},
        tools: [],
        outputType: undefined,
        handoffs: [],
        tracing: { enabled: false },
      });
      expect(result).toBeDefined();
      expect(requests.length).toBeGreaterThan(0);
      expect(requests[0]?.json?.model).toBe("gpt-5-codex");
    } finally {
      await close();
    }
  }, 15000);

  mockTest("accepts agent-level model name over provider default", async () => {
    const { url, close, requests } = await startResponsesTestProxy({
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
      const provider = new CodexProvider({ baseUrl: url, skipGitRepoCheck: true, defaultModel: "gpt-5" });
      const model = provider.getModel("gpt-5-codex"); // Override default
      const result = await model.getResponse({
        systemInstructions: "Respond plainly.",
        input: "hello",
        modelSettings: {},
        tools: [],
        outputType: undefined,
        handoffs: [],
        tracing: { enabled: false },
      });
      expect(result).toBeDefined();
      expect(requests.length).toBeGreaterThan(0);
      expect(requests[0]?.json?.model).toBe("gpt-5-codex");
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

function parseEnvBoolean(value: string | undefined): boolean | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }
  return null;
}

type OllamaEndpoint = {
  hostname: string;
  port: number;
  protocol: "http:" | "https:";
};

function resolveOllamaEndpoint(): OllamaEndpoint {
  const raw = process.env.OLLAMA_HOST?.trim();
  if (!raw) {
    return { hostname: "127.0.0.1", port: 11434, protocol: "http:" };
  }
  try {
    const candidate = raw.includes("://") ? raw : `http://${raw}`;
    const url = new URL(candidate);
    const protocol = (url.protocol === "https:" ? "https:" : "http:") as OllamaEndpoint["protocol"];
    const port =
      url.port !== ""
        ? Number.parseInt(url.port, 10)
        : protocol === "https:"
          ? 443
          : 11434;
    return {
      hostname: url.hostname || "127.0.0.1",
      port: Number.isFinite(port) ? port : 11434,
      protocol,
    };
  } catch {
    return { hostname: raw, port: 11434, protocol: "http:" };
  }
}

function isOllamaAvailable(): boolean {
  try {
    const endpoint = resolveOllamaEndpoint();
    const moduleName = endpoint.protocol === "https:" ? "node:https" : "node:http";
    const script = `
const mod = require(${JSON.stringify(moduleName)});
const options = ${JSON.stringify({
  hostname: endpoint.hostname,
  port: endpoint.port,
  path: "/api/version",
  method: "GET",
  timeout: 500,
})};
const req = mod.request(options, (res) => {
  res.resume();
  res.on("end", () => {
    process.exit(res.statusCode && res.statusCode >= 200 && res.statusCode < 300 ? 0 : 1);
  });
});
req.on("timeout", () => {
  req.destroy();
  process.exit(1);
});
req.on("error", () => process.exit(1));
req.end();
setTimeout(() => process.exit(1), 1500).unref();
`;
    const result = spawnSync(process.execPath, ["-e", script], { stdio: "ignore" });
    return result.status === 0;
  } catch {
    return false;
  }
}

const ossEnv = process.env.CODEX_NATIVE_RUN_OSS_TEST;
const ossEnvPreference = parseEnvBoolean(ossEnv);
const autoDetectedOllama = ossEnvPreference === null && !isCI && isOllamaAvailable();
if (ossEnvPreference === null && !autoDetectedOllama) {
  console.warn(
    "Skipping OSS integration test: no running Ollama server detected. " +
      'Set CODEX_NATIVE_RUN_OSS_TEST=1 to force running the test.',
  );
}
const shouldRunOss = ossEnvPreference === true || (ossEnvPreference === null && autoDetectedOllama);

(shouldRunOss ? it : it.skip)("accepts OSS model when provider is configured for OSS", async () => {
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


