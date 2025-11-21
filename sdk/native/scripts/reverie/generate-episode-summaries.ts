#!/usr/bin/env tsx
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { reverieListConversations } from "../../src/nativeBinding.js";
import type { ReverieEpisodeSummary } from "../../src/reverie/types";

const EPISODES_FILENAME = "reverie_episodes.json";

async function main() {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const repoRoot = process.argv[2] || process.cwd();

  const conversations = await reverieListConversations(codexHome, 500, 0);
  const summaries: ReverieEpisodeSummary[] = conversations.map((conversation, index) =>
    buildEpisodeSummary(conversation, index, repoRoot),
  );

  await fs.writeFile(
    path.join(codexHome, EPISODES_FILENAME),
    JSON.stringify(summaries, null, 2),
    "utf8",
  );
  console.log(`Wrote ${summaries.length} episode summaries to ${path.join(codexHome, EPISODES_FILENAME)}`);
}

function buildEpisodeSummary(conversation: any, index: number, repoRoot: string): ReverieEpisodeSummary {
  const sourceLines = [...conversation.headRecordsToon, ...conversation.tailRecordsToon]
    .map((line: string) => line.trim())
    .filter((line: string) => line.length > 0);

  const summary = summarizeLines(sourceLines);
  const keyDecisions = extractKeyDecisions(sourceLines).slice(0, 5);
  const importance = estimateImportance(summary, keyDecisions);

  return {
    conversationId: conversation.id,
    episodeId: `${conversation.id}-${index}`,
    timestamp: conversation.updatedAt || conversation.createdAt || new Date().toISOString(),
    summary,
    keyDecisions,
    importance,
  };
}

function summarizeLines(lines: string[]): string {
  if (!lines.length) {
    return "";
  }
  const firstChunk = lines.slice(0, 2).join(" ");
  const lastChunk = lines.slice(-2).join(" ");
  const merged = `${firstChunk}\n\n${lastChunk}`.trim();
  return merged.length > 800 ? `${merged.slice(0, 797)}…` : merged;
}

function extractKeyDecisions(lines: string[]): string[] {
  const results: string[] = [];
  for (const line of lines) {
    if (line.startsWith("- ") || line.startsWith("* ")) {
      results.push(line.replace(/^[-*]\s*/, "").slice(0, 200));
    } else if (/\b(run|fix|update|deploy)\b/i.test(line)) {
      results.push(line.slice(0, 200));
    }
  }
  return results;
}

function estimateImportance(summary: string, keyDecisions: string[]): number {
  const text = `${summary} ${keyDecisions.join(" ")}`.toLowerCase();
  if (/error|failure|incident|panic|critical/.test(text)) {
    return 9;
  }
  if (/deploy|release|benchmark/.test(text)) {
    return 7;
  }
  if (/refactor|cleanup|docs/.test(text)) {
    return 5;
  }
  return 4;
}

main().catch((error) => {
  console.error("Failed to generate episode summaries", error);
  process.exit(1);
});
