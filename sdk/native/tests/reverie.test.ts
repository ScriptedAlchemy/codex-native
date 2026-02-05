import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, beforeAll, expect } from "@jest/globals";
import { setupNativeBinding } from "./testHelpers";

setupNativeBinding();

let reverieListConversations: any;
let reverieSearchConversations: any;
let reverieSearchSemantic: any;
let reverieIndexSemantic: any;
let reverieGetConversationInsights: any;
let fastEmbedInit: any;
let encodeToToon: any;

beforeAll(async () => {
  const mod = await import("../src/index");
  reverieListConversations = mod.reverieListConversations;
  reverieSearchConversations = mod.reverieSearchConversations;
  reverieSearchSemantic = mod.reverieSearchSemantic;
  reverieIndexSemantic = mod.reverieIndexSemantic;
  reverieGetConversationInsights = mod.reverieGetConversationInsights;
  fastEmbedInit = mod.fastEmbedInit;
  encodeToToon = mod.encodeToToon;
});

const LONG_TIMEOUT_MS = 120_000;

function writeJsonl(file: string, lines: string[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
}

function makeFakeCodexHome(): { home: string; convoPath: string } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-reverie-"));
  const day = path.join(home, "sessions", "2025", "01", "01");
  const uuid = "019a0000-0000-0000-0000-000000000001";
  const convoPath = path.join(day, `rollout-2025-01-01T12-00-00-${uuid}.jsonl`);

  const sessionMeta = {
    timestamp: "2025-01-01T12:00:00Z",
    type: "session_meta",
    payload: {
      id: uuid,
      timestamp: "2025-01-01T12:00:00Z",
      instructions: null,
      cwd: home,  // Use the actual temp directory path
      originator: "test",
      cli_version: "0.0.0",
      model_provider: "test-provider"
    }
  };

  const userEvent = {
    timestamp: "2025-01-01T12:00:01Z",
    type: "event_msg",
    payload: {
      type: "user_message",
      message: "We fixed the auth timeout bug by adjusting retries with reverie test keyword"
    }
  };

  // ResponseItem::Message - payload contains type, role, and content array
  // ContentItem::OutputText has type "output_text"
  const assistantMessage = {
    timestamp: "2025-01-01T12:00:02Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: "The auth timeout issue has been resolved using exponential backoff in the reverie system"
        }
      ]
    }
  };

  const secondMessage = {
    timestamp: "2025-01-01T12:00:03Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: "Successfully authenticated with retry logic for reverie integration"
        }
      ]
    }
  };

  writeJsonl(convoPath, [
    JSON.stringify(sessionMeta),
    JSON.stringify(userEvent),
    JSON.stringify(assistantMessage),
    JSON.stringify(secondMessage)
  ]);
  return { home, convoPath };
}

describe("Reverie native helpers", () => {
  it("lists conversations", async () => {
    const { home } = makeFakeCodexHome();
    const list = await reverieListConversations(home, 10, 0);
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    const first = list[0];
    expect(first.path).toContain("rollout-2025-01-01T12-00-00");
    expect(first.path.endsWith(".jsonl")).toBe(true);
    expect(first.cwd).toBe(home);
    expect(Array.isArray(first.headRecordsToon)).toBe(true);
    expect(first.headRecordsToon.length).toBe(first.headRecords.length);
    expect(first.headRecordsToon[0]).not.toHaveLength(0);
  });

  it("searches conversations by keyword", async () => {
    const { home } = makeFakeCodexHome();

    // First verify we can list conversations
    const list = await reverieListConversations(home, 10, 0);
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);

    // Search for "auth" which appears in the content field that gets extracted
    const results = await reverieSearchConversations(home, "auth", 10);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].relevanceScore).toBeGreaterThan(0);
  });

  it("returns filtered insights for a conversation", async () => {
    const { convoPath } = makeFakeCodexHome();
    const insights = await reverieGetConversationInsights(convoPath, "auth");
    expect(Array.isArray(insights)).toBe(true);
    expect(insights.some((s: string) => s.toLowerCase().includes("auth"))).toBe(true);
  });

  it(
    "returns semantic matches using FastEmbed",
    async () => {
      const { home } = makeFakeCodexHome();
      const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-reverie-cache-"));

      await fastEmbedInit({
        model: "BAAI/bge-small-en-v1.5",
        cacheDir,
        maxLength: 512,
        showDownloadProgress: false,
      });

      const results = await reverieSearchSemantic(home, "auth timeout fix", {
        projectRoot: home,
        limit: 5,
        normalize: true,
        cache: true,
      });

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].relevanceScore).toBeGreaterThan(0);
    },
    LONG_TIMEOUT_MS,
  );

  it(
    "indexes reveries to warm the cache",
    async () => {
      const { home } = makeFakeCodexHome();
      await fastEmbedInit({
        model: "BAAI/bge-small-en-v1.5",
        maxLength: 256,
        showDownloadProgress: false,
      });

      const stats = await reverieIndexSemantic(home, {
        limit: 5,
        maxCandidates: 5,
        projectRoot: home,
        normalize: true,
        cache: true,
      });

      expect(stats.documentsEmbedded).toBeGreaterThan(0);
      expect(stats.batches).toBeGreaterThan(0);
    },
    LONG_TIMEOUT_MS,
  );

  it("encodes arbitrary payloads to TOON", () => {
    const encoded = encodeToToon({
      items: [
        { sku: "A1", qty: 2 },
        { sku: "B2", qty: 1 },
      ],
    });
    expect(encoded).toContain("items[2]");
    expect(encoded).toContain("sku");
  });
});
