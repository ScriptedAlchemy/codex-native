#!/usr/bin/env tsx
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  fastEmbedInit,
  fastEmbedEmbed,
  reverieListConversations,
  reverieGetConversationInsights,
  type ReverieConversation,
} from "@codex-native/sdk";

const POSITIVE_SEED_IDS = [
  "rollout-2025-11-05T13-59-05-019a5607-d493-7142-a063-1d8702021b9b",
  "rollout-2025-11-15T19-10-48-019a8aa4-d0c1-7fc0-9eab-ac100e98e7fd",
];

const NEGATIVE_SEED_IDS = [
  "rollout-2025-11-08T15-31-01-019a65cf-1393-73e3-980b-a693f23d56af",
  "rollout-2025-11-08T15-47-02-019a65dd-c099-70f3-9636-d2248eef21fa",
  "rollout-2025-11-08T15-40-48-019a65d8-08da-7723-84ad-7b9ba4861095",
];

const DEFAULT_MODEL = "BAAI/bge-large-en-v1.5";

function usage(message?: string, code = 1): never {
  if (message) {
    console.error(message);
  }
  console.error(
    "Usage: pnpm dlx tsx scripts/curate-reveries.ts [--limit 400] [--min-score 0.05] [--top 20] [--model BAAI/bge-large-en-v1.5] [--output FILE]",
  );
  process.exit(code);
}

type CliOptions = {
  limit: number;
  minScore: number;
  top: number;
  model: string;
  output?: string;
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    limit: 400,
    minScore: 0.05,
    top: 25,
    model: DEFAULT_MODEL,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--limit":
        opts.limit = Number(argv[++i]);
        break;
      case "--min-score":
        opts.minScore = Number(argv[++i]);
        break;
      case "--top":
        opts.top = Number(argv[++i]);
        break;
      case "--model":
        opts.model = argv[++i];
        break;
      case "--output":
        opts.output = argv[++i];
        break;
      case "--help":
      case "-h":
        usage(undefined, 0);
        break;
      default:
        usage(`Unknown option ${arg}`);
    }
  }

  if (!Number.isFinite(opts.limit) || opts.limit <= 0) {
    usage("--limit must be > 0");
  }
  if (!Number.isFinite(opts.minScore)) {
    usage("--min-score must be numeric");
  }
  if (!Number.isFinite(opts.top) || opts.top <= 0) {
    usage("--top must be > 0");
  }
  return opts;
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  console.log(`📁 Using Codex home: ${codexHome}`);

  const conversations = await loadConversations(codexHome, options.limit);
  if (!conversations.length) {
    console.error("No conversations found.");
    process.exit(1);
  }
  console.log(`🗂  Loaded ${conversations.length} conversations for scoring.`);

  console.log(`⚙️  Initialising fastembed model: ${options.model}`);
  await fastEmbedInit({
    model: options.model,
    cacheDir: path.join(codexHome, "cache", "fastembed"),
    showDownloadProgress: true,
  });

  const [positiveSummaries, negativeSummaries, candidateSummaries] = await Promise.all([
    loadSeedSummaries(codexHome, POSITIVE_SEED_IDS),
    loadSeedSummaries(codexHome, NEGATIVE_SEED_IDS),
    Promise.all(conversations.map((conversation) => summarizeConversation(conversation))),
  ]);

  const summarySegments = [
    ...positiveSummaries.map((text) => ({ text, label: "positive" })),
    ...negativeSummaries.map((text) => ({ text, label: "negative" })),
    ...candidateSummaries.map((text) => ({ text, label: "candidate" })),
  ];

  const texts = summarySegments.map((entry) => entry.text);
  console.log(`🧮 Embedding ${texts.length} summaries (pos=${positiveSummaries.length}, neg=${negativeSummaries.length}, candidate=${candidateSummaries.length}).`);

  const embeddings = await fastEmbedEmbed({
    inputs: texts,
    normalize: true,
    cache: true,
    batchSize: 32,
  });

  const posEmbeds = embeddings.slice(0, positiveSummaries.length);
  const negEmbeds = embeddings.slice(positiveSummaries.length, positiveSummaries.length + negativeSummaries.length);
  const candidateEmbeds = embeddings.slice(posEmbeds.length + negEmbeds.length);

  const scored = candidateEmbeds.map((embedding, idx) => {
    const posScore = maxSimilarity(embedding, posEmbeds);
    const negScore = maxSimilarity(embedding, negEmbeds);
    return {
      conversation: conversations[idx],
      summary: candidateSummaries[idx],
      posScore,
      negScore,
      score: posScore - negScore,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  const curated = scored.filter((entry) => entry.score >= options.minScore).slice(0, options.top);

  console.log(`
✅ Curated ${curated.length} conversations (threshold=${options.minScore}).`);
  for (const entry of curated) {
    reportEntry(entry);
  }

  if (scored.length) {
    console.log("\n🚫 Sample of filtered-out conversations (lowest scores):");
    for (const entry of scored.slice(-Math.min(5, scored.length)).reverse()) {
      reportEntry(entry);
    }
  }

  if (options.output) {
    const curatedIds = curated.map((entry) => entry.conversation.id);
    const outputData = {
      generated: new Date().toISOString(),
      minScore: options.minScore,
      count: curatedIds.length,
      ids: curatedIds,
    };
    await fs.writeFile(options.output, JSON.stringify(outputData, null, 2), "utf-8");
    console.log(`\n💾 Saved ${curatedIds.length} curated IDs to ${options.output}`);
  }
}

function reportEntry(entry: {
  conversation: ReverieConversation;
  summary: string;
  posScore: number;
  negScore: number;
  score: number;
}): void {
  const preview = entry.summary.replace(/\s+/g, " ").slice(0, 160);
  console.log(
    `• ${entry.conversation.id} | score=${entry.score.toFixed(3)} (pos=${entry.posScore.toFixed(3)}, neg=${entry.negScore.toFixed(3)})\n  ${preview}...`,
  );
}

async function loadConversations(codexHome: string, limit: number): Promise<ReverieConversation[]> {
  const batchSize = 200;
  let offset = 0;
  const conversations: ReverieConversation[] = [];

  while (conversations.length < limit) {
    const remaining = limit - conversations.length;
    const batch = await reverieListConversations(codexHome, Math.min(batchSize, remaining), offset);
    if (!batch.length) {
      break;
    }
    conversations.push(...batch);
    offset += batch.length;
  }
  return conversations;
}

async function loadSeedSummaries(codexHome: string, ids: string[]): Promise<string[]> {
  const summaries: string[] = [];
  for (const id of ids) {
    const filePath = await conversationPathFromId(codexHome, id);
    if (!filePath) {
      console.warn(`⚠️  Seed ${id} not found on disk.`);
      continue;
    }
    const text = await summarizePath(filePath);
    if (text) {
      summaries.push(text);
    }
  }
  return summaries;
}

async function summarizeConversation(conversation: ReverieConversation): Promise<string> {
  if (conversation.path) {
    const text = await summarizePath(conversation.path);
    if (text) {
      return text;
    }
  }
  const fallback = [...(conversation.headRecordsToon ?? []), ...(conversation.tailRecordsToon ?? [])]
    .map(cleanText)
    .filter(Boolean)
    .join("\n\n");
  return truncate(fallback, 4000);
}

async function summarizePath(conversationPath: string): Promise<string> {
  try {
    const insights = await reverieGetConversationInsights(conversationPath);
    if (insights && insights.length) {
      const cleaned = insights.map(cleanText).filter(Boolean);
      if (cleaned.length) {
        return truncate(cleaned.join("\n\n"), 4000);
      }
    }
    const raw = await fs.readFile(conversationPath, "utf8");
    const cleaned = raw
      .split(/\r?\n/)
      .filter((line) => line.trim().startsWith("{"))
      .slice(0, 60)
      .join("\n");
    return truncate(cleanText(cleaned), 4000);
  } catch (error) {
    console.warn(`⚠️  Failed to summarize ${conversationPath}:`, error);
    return "";
  }
}

function cleanText(text: string): string {
  return text
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, "")
    .replace(/# AGENTS.md instructions/gi, "")
    .replace(/```[^`]*```/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text: string, limit: number): string {
  if (!text) {
    return "";
  }
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function conversationPathFromId(codexHome: string, id: string): string | null {
  const match = id.match(/rollout-(\d{4})-(\d{2})-(\d{2})T/);
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  const filePath = path.join(codexHome, "sessions", year, month, day, `${id}.jsonl`);
  return filePath;
}

function maxSimilarity(vec: number[], seeds: number[][]): number {
  if (!seeds.length) {
    return 0;
  }
  let max = -Infinity;
  for (const seed of seeds) {
    const sim = cosine(vec, seed);
    if (sim > max) {
      max = sim;
    }
  }
  return max;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let i = 0; i < a.length && i < b.length; i += 1) {
    dot += a[i] * b[i];
    aNorm += a[i] * a[i];
    bNorm += b[i] * b[i];
  }
  if (aNorm === 0 || bNorm === 0) {
    return 0;
  }
  return dot / Math.sqrt(aNorm * bNorm);
}

run().catch((error) => {
  console.error("Curator failed:", error);
  process.exit(1);
});
