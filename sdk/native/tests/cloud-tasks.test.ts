import { describe, expect, it, beforeAll } from "@jest/globals";

// Setup native binding for tests
setupNativeBinding();
import { setupNativeBinding } from "./testHelpers";


// Align with other JS tests: point to the built native binding.

const RUN_REAL = process.env.CODEX_NATIVE_RUN_REAL_BACKEND === "1";
const cloudTest = RUN_REAL ? it : it.skip;

let CloudTasks: any;
beforeAll(async () => {
  ({ CloudTasks } = await import("../src/index"));
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


