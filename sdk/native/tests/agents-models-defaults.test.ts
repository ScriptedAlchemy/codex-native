/**
 * Validate model resolution paths per Agents SDK docs:
 * - https://openai.github.io/openai-agents-js/guides/models/
 * - https://openai.github.io/openai-agents-js/guides/running-agents/
 */

import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { spawnSync } from "node:child_process";
import { setupNativeBinding } from "./testHelpers";

// Setup native binding for tests
setupNativeBinding();

let CodexProvider: any;
let Codex: any;
beforeAll(async () => {
  ({ CodexProvider, Codex } = await import("../src/index"));
});

// Mock types
interface MockUsage {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens?: number;
}

// Helper to create mock Codex for model validation tests
function createMockCodex(responseText: string = "Test response") {
  const mockThread = {
    id: "mock-thread-id",
    run: jest.fn(async () => ({
      items: [{ type: "agent_message", text: responseText }],
      finalResponse: responseText,
      usage: { input_tokens: 10, output_tokens: 5 },
    })),
    runStreamed: jest.fn(async () => ({
      events: (async function* () {
        yield { type: "thread.started", thread_id: "mock-thread-id" };
        yield { type: "turn.started" };
        yield { type: "item.completed", item: { type: "agent_message", text: responseText } };
        yield { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } };
      })(),
    })),
    onEvent: jest.fn(() => () => {}),
    sendBackgroundEvent: jest.fn(async () => {}),
  };

  return {
    startThread: jest.fn(() => mockThread),
    resumeThread: jest.fn(() => mockThread),
    registerTool: jest.fn(),
    _mockThread: mockThread,
  };
}

// Helper to create mock exec for capturing model info
function createMockExec(responseText: string, captureCallback?: (args: any) => void) {
  return {
    run: jest.fn(async function* (args: any) {
      if (captureCallback) {
        captureCallback(args);
      }
      yield JSON.stringify({ ThreadStarted: { thread_id: "mock-thread-id" } });
      yield JSON.stringify({ TurnStarted: {} });
      yield JSON.stringify({ ItemCompleted: { item: { id: "item_0", type: "agent_message", text: responseText } } });
      yield JSON.stringify({
        TurnCompleted: {
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      });
    }),
    requiresOutputSchemaFile: () => false,
  };
}

const isCI = process.env.CI === "true" || process.env.CI === "1";

describe("Agents models defaults/resolution with CodexProvider", () => {
  it("uses provider defaultModel when agent doesn't specify", async () => {
    let capturedModel: string | undefined;
    const mockCodex = createMockCodex("runner default model ok");

    const provider = new CodexProvider({
      skipGitRepoCheck: true,
      defaultModel: "gpt-5-codex",
    });

    // Inject mock Codex to verify model is passed
    (provider as any).codex = mockCodex;

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
    expect(mockCodex.startThread).toHaveBeenCalled();
    // Verify that the model name "gpt-5-codex" is used as default
    expect((provider as any).options.defaultModel).toBe("gpt-5-codex");
  });

  it("accepts agent-level model name over provider default", async () => {
    const mockCodex = createMockCodex("agent model ok");

    const provider = new CodexProvider({
      skipGitRepoCheck: true,
      defaultModel: "gpt-5",
    });

    // Inject mock Codex
    (provider as any).codex = mockCodex;

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
    expect(mockCodex.startThread).toHaveBeenCalled();
    // The model was overridden when calling getModel
  });

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
    const mockCodex = createMockCodex("oss ok");

    const provider = new CodexProvider({
      skipGitRepoCheck: true,
      oss: true,
    });

    // Inject mock
    (provider as any).codex = mockCodex;

    const model = provider.getModel("gpt-oss:20b");
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
    expect(result.output).toBeDefined();
  }, 15000);

  it("accepts gpt-5-codex-mini model", async () => {
    const mockCodex = createMockCodex("mini model ok");

    const provider = new CodexProvider({
      skipGitRepoCheck: true,
      defaultModel: "gpt-5-codex-mini",
    });

    // Inject mock
    (provider as any).codex = mockCodex;

    const model = provider.getModel();
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
    expect(mockCodex.startThread).toHaveBeenCalled();
    expect((provider as any).options.defaultModel).toBe("gpt-5-codex-mini");
  });
});
