import { describe, expect, it, beforeAll } from "@jest/globals";
import { fileURLToPath } from "node:url";

function resolveNativeBindingPath() {
  const { platform, arch } = process;
  if (platform === "darwin") {
    const suffix = arch === "arm64" ? "arm64" : "x64";
    return fileURLToPath(new URL(`../codex_native.darwin-${suffix}.node`, import.meta.url));
  }
  if (platform === "win32") {
    const suffix = arch === "arm64" ? "arm64" : "x64";
    return fileURLToPath(new URL(`../codex_native.win32-${suffix}-msvc.node`, import.meta.url));
  }
  if (platform === "linux") {
    const suffix = process.env.MUSL ? "musl" : "gnu";
    return fileURLToPath(new URL(`../codex_native.linux-${arch}-${suffix}.node`, import.meta.url));
  }
  throw new Error(`Unsupported platform for tests: ${platform} ${arch}`);
}

// Align with other JS tests: point to the built native binding.
process.env.CODEX_NATIVE_BINDING = resolveNativeBindingPath();

const RUN_REAL = process.env.CODEX_NATIVE_RUN_REAL_BACKEND === "1";
const cloudTest = RUN_REAL ? it : it.skip;

let CloudTasks;
beforeAll(async () => {
  ({ CloudTasks } = await import("../dist/index.mjs"));
});

describe("CloudTasks wrapper (real backend gated)", () => {
  cloudTest("lists tasks from real backend", async () => {
    const baseUrl = process.env.CODEX_NATIVE_CLOUD_BASE_URL || "https://chatgpt.com/backend-api";
    const apiKey = process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY || "";
    const client = new CloudTasks({ baseUrl, apiKey });
    const list = await client.list(undefined);
    expect(Array.isArray(list)).toBe(true);
  }, 15000);
});


