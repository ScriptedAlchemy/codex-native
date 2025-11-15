/**
 * Example: Reverie Semantic Search & Indexing Stats
 *
 * This script demonstrates how to:
 *   1. Locate Codex reverie transcripts under ~/.codex/sessions
 *   2. Pre-warm the semantic index (embeddings cache + chunk batches)
 *   3. Run a semantic search against the reasoning excerpt from a real agent
 *   4. Inspect which conversations/chunks were matched along with cache stats
 *
 * Usage:
 *   npx tsx examples/reverie/manual-semantic-search.ts
 *
 * Optional env vars:
 *   CODEX_HOME            Use an alternate Codex data directory
 *   REVERIE_EMBED_MODEL   Override the FastEmbed model id (defaults to BAAI/bge-small-en-v1.5)
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { randomUUID } from "node:crypto";

import {
  fastEmbedInit,
  reverieIndexSemantic,
  reverieListConversations,
  reverieSearchSemantic,
  encodeToToon,
  type ReverieConversation,
  type ReverieSearchResult,
} from "@codex-native/sdk";
import { encode as encodeToon } from "@toon-format/toon";

const MODEL_ID = process.env.REVERIE_EMBED_MODEL ?? "BAAI/bge-small-en-v1.5";
const EMBED_CACHE_DIR = path.join(os.tmpdir(), "codex-reverie-example-cache");
const SEARCH_LIMIT = 3;
const SEARCH_OPTIONS = {
  limit: SEARCH_LIMIT,
  maxCandidates: 24,
  batchSize: 16,
  normalize: true,
  cache: true,
};

const PREVIEW_LIMIT = 5;

const REASONING_SNIPPET = `• I've noted that the Clippy fix has updated the code, and while we don't
  need to inspect all the changes, we definitely must run relevant tests.
  The instructions say to run tests for specific projects that changed. Since
  we've touched codex-core and codex-exec, I'll run cargo test -p codex-core
  and cargo test -p codex-exec. For the common/core/protocol modifications,
  I could ask for user permission to run cargo test --all-features, but let's
  stick to the relevant crates for now.`;

const COLOR_CODES = {
  heading: "\x1b[95m",
  info: "\x1b[36m",
  preview: "\x1b[33m",
  indexing: "\x1b[93m",
  cache: "\x1b[35m",
  stats: "\x1b[32m",
  result: "\x1b[92m",
  insight: "\x1b[96m",
  warning: "\x1b[91m",
  muted: "\x1b[90m",
  reset: "\x1b[0m",
} as const;

type ColorName = Exclude<keyof typeof COLOR_CODES, "reset">;

const LEGEND: Array<{ label: string; desc: string; color: ColorName }> = [
  { label: "Heading", desc: "Scenario overview", color: "heading" },
  { label: "Info", desc: "Environment + configuration", color: "info" },
  { label: "Preview", desc: "Conversation metadata", color: "preview" },
  { label: "Index", desc: "Embedding/index steps", color: "indexing" },
  { label: "Cache", desc: "FastEmbed cache stats", color: "cache" },
  { label: "Stats", desc: "Aggregated metrics", color: "stats" },
  { label: "Result", desc: "Semantic matches", color: "result" },
  { label: "Insight", desc: "Derived explanations", color: "insight" },
  { label: "Muted", desc: "Raw transcript excerpts", color: "muted" },
];

function colorize(text: string, color: ColorName): string {
  return `${COLOR_CODES[color]}${text}${COLOR_CODES.reset}`;
}

function indent(text: string, prefix = "  "): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

type RecordSummary = {
  title: string;
  snippet?: string;
  annotation?: string;
  color?: ColorName;
  rawLength: number;
  snippetLength?: number;
  truncated?: boolean;
};

function summarizeRecord(raw: string): RecordSummary {
  const trimmed = raw.trim();
  const rawLength = trimmed.length;
  if (!trimmed) {
    return { title: "(empty line)", rawLength: 0, snippetLength: 0, truncated: false };
  }

  const plainPreview = summarizePlainText(trimmed, rawLength);
  if (plainPreview) {
    return plainPreview;
  }

  const parsed = safeJsonParse<any>(trimmed);
  if (!parsed || typeof parsed !== "object") {
    return fallbackSummary(trimmed, rawLength);
  }

  if (parsed.type === "session_meta") {
    const instructions = typeof parsed.payload?.instructions === "string" ? parsed.payload.instructions : undefined;
    const summary = typeof parsed.payload?.summary === "string" ? parsed.payload.summary : "session metadata";
    const snippetInfo = instructions ? clipSnippet(instructions) : undefined;
    return {
      title: `session_meta — ${summary}`,
      snippet: snippetInfo?.text,
      snippetLength: snippetInfo?.displayedLength,
      rawLength: snippetInfo?.rawLength ?? rawLength,
      truncated: snippetInfo?.truncated,
      annotation: instructions ? describeInstructionLength(instructions.length) : undefined,
      color: "preview",
    };
  }

  if (parsed.type === "event_msg") {
    const messageType = parsed.payload?.type ?? "event";
    if (messageType === "user_message" && typeof parsed.payload?.message === "string") {
      const snippetInfo = clipSnippet(parsed.payload.message);
      return {
        title: `user message (${parsed.payload.message.length} chars)`,
        snippet: snippetInfo?.text,
        snippetLength: snippetInfo?.displayedLength,
        rawLength: snippetInfo?.rawLength ?? parsed.payload.message.length,
        truncated: snippetInfo?.truncated,
        color: "info",
      };
    }
    const fallbackSnippet = parsed.payload?.message ? clipSnippet(String(parsed.payload.message)) : undefined;
    return {
      title: `event_msg (${messageType})`,
      snippet: fallbackSnippet?.text,
      snippetLength: fallbackSnippet?.displayedLength,
      rawLength: fallbackSnippet?.rawLength ?? rawLength,
      truncated: fallbackSnippet?.truncated,
      color: "preview",
    };
  }

  if (parsed.type === "response_item") {
    const role = parsed.payload?.role ?? "assistant";
    const text = extractContentText(parsed.payload?.content);
    const snippetInfo = text ? clipSnippet(text) : undefined;
    return {
      title: `${role} response (${text?.length ?? 0} chars)`,
      snippet: snippetInfo?.text,
      snippetLength: snippetInfo?.displayedLength,
      rawLength: snippetInfo?.rawLength ?? rawLength,
      truncated: snippetInfo?.truncated,
      color: role === "assistant" ? "result" : "info",
    };
  }

  if (parsed.type === "message" && typeof parsed.role === "string") {
    const text = extractContentText(parsed.content);
    const snippetInfo = text ? clipSnippet(text) : undefined;
    return {
      title: `${parsed.role} message (${text?.length ?? 0} chars)`,
      snippet: snippetInfo?.text,
      snippetLength: snippetInfo?.displayedLength,
      rawLength: snippetInfo?.rawLength ?? rawLength,
      truncated: snippetInfo?.truncated,
      color: parsed.role === "assistant" ? "result" : "info",
    };
  }

  return fallbackSummary(trimmed, rawLength);
}

function summarizePlainText(text: string, rawLength: number): RecordSummary | null {
  if (text.startsWith("<environment_context>")) {
    const snippetInfo = clipSnippet(text);
    return {
      title: "environment_context payload",
      snippet: snippetInfo?.text,
      snippetLength: snippetInfo?.displayedLength ?? 0,
      rawLength: snippetInfo?.rawLength ?? rawLength,
      truncated: snippetInfo?.truncated ?? false,
      annotation: "Environment context (cwd, sandbox, approvals).",
      color: "info",
    };
  }
  if (text.startsWith("<system>")) {
    const snippetInfo = clipSnippet(text);
    return {
      title: "system prompt block",
      snippet: snippetInfo?.text,
      snippetLength: snippetInfo?.displayedLength ?? 0,
      rawLength: snippetInfo?.rawLength ?? rawLength,
      truncated: snippetInfo?.truncated ?? false,
      annotation: "System message saved in transcript.",
      color: "info",
    };
  }
  return null;
}

function fallbackSummary(text: string, rawLength: number): RecordSummary {
  const snippetInfo = clipSnippet(text);
  return {
    title: `Raw snippet (${rawLength} chars)`,
    snippet: snippetInfo?.text,
    snippetLength: snippetInfo?.displayedLength ?? 0,
    rawLength: snippetInfo?.rawLength ?? rawLength,
    truncated: snippetInfo?.truncated ?? false,
  };
}

type SnippetInfo = {
  text: string;
  displayedLength: number;
  rawLength: number;
  truncated: boolean;
};

function clipSnippet(text: string, maxLen = 140): SnippetInfo | undefined {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length <= maxLen) {
    return {
      text: normalized,
      displayedLength: normalized.length,
      rawLength: normalized.length,
      truncated: false,
    };
  }
  const shortened = normalized.slice(0, Math.max(maxLen - 1, 1)).trimEnd();
  return {
    text: `${shortened}…`,
    displayedLength: shortened.length + 1,
    rawLength: normalized.length,
    truncated: true,
  };
}

function describeInstructionLength(length: number): string {
  return `AGENTS instructions (~${length} chars).`;
}

function extractContentText(content: unknown): string | undefined {
  if (Array.isArray(content)) {
    const collected = content
      .map((item) => (typeof item?.text === "string" ? item.text : undefined))
      .filter((value): value is string => Boolean(value));
    if (collected.length > 0) {
      return collected.join(" ");
    }
  }
  if (typeof content === "string") {
    return content;
  }
  return undefined;
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  console.log(colorize("🧠 Reverie Semantic Search Walkthrough", "heading"));
  console.log();

  const codexHome = resolveCodexHome();
  console.log(colorize(`CODEX_HOME => ${codexHome}`, "info"));
  console.log(colorize(`Embed cache => ${EMBED_CACHE_DIR}`, "info"));
  console.log(colorize(`Model => ${MODEL_ID}`, "info"));
  console.log();

  const reasoningToon = encodeToToon({ reasoning: REASONING_SNIPPET.trim().split("\n") });
  console.log(colorize("Reasoning snippet encoded via TOON helper:", "preview"));
  console.log(colorize(indent(reasoningToon), "muted"));
  console.log();

  await ensureDemoConversations(codexHome);

  await fastEmbedInit({
    model: MODEL_ID,
    cacheDir: EMBED_CACHE_DIR,
    maxLength: 768,
    showDownloadProgress: true,
  });

  const conversations = await reverieListConversations(codexHome, 10, 0);
  if (conversations.length === 0) {
    console.log(colorize("No reverie transcripts available – nothing to index.", "warning"));
    return;
  }

  printConversationPreview(conversations);

  console.log();
  console.log(colorize("📦 Indexing conversations into the semantic cache...", "indexing"));
  console.log();
  const indexStats = await reverieIndexSemantic(codexHome, {
    ...SEARCH_OPTIONS,
    projectRoot: process.cwd(),
  });

  await describeCacheDirectory(EMBED_CACHE_DIR);
  printIndexStats(indexStats);

  console.log();
  console.log(colorize("🔎 Running semantic search with the reasoning excerpt provided in the prompt...", "result"));
  console.log();
  await runSemanticSearch(codexHome);
  printLegend();
}

function resolveCodexHome(): string {
  if (process.env.CODEX_HOME) {
    return path.resolve(process.env.CODEX_HOME);
  }
  return path.join(os.homedir() ?? process.cwd(), ".codex");
}

async function ensureDemoConversations(codexHome: string): Promise<void> {
  await fs.mkdir(codexHome, { recursive: true });

  try {
    const existing = await reverieListConversations(codexHome, 1, 0);
    if (existing.length > 0) {
      console.log(colorize(`Found ${existing.length} existing conversation(s); using real data.`, "info"));
      console.log();
      return;
    }
  } catch (error) {
    console.warn(colorize("Unable to list existing conversations, seeding demo data.", "warning"), error);
  }

  console.log(colorize("No reveries found – seeding a self-contained demo dataset...", "warning"));
  console.log();
  await seedDemoDataset(codexHome);
}

async function seedDemoDataset(codexHome: string): Promise<void> {
  const seeds = [
    makeConversationSeed({
      timestamp: "2025-11-14T14:30:00Z",
      summary: "Clippy regression + targeted test plan",
      userMessage: "Codex, audit the Clippy fixes and tell me which tests to run.",
      assistantMessages: [
        REASONING_SNIPPET,
        "I'll focus on codex-core and codex-exec then summarize next steps.",
      ],
    }),
    makeConversationSeed({
      timestamp: "2025-11-13T22:10:00Z",
      summary: "Deployment rehearsals",
      userMessage: "Capture lessons learned from the release sprint.",
      assistantMessages: [
        "Documented rollout rehearsal steps and approvals for telemetry agents.",
        "Flagged flaky load tests plus on-call mitigation tasks.",
      ],
    }),
  ];

  for (const seed of seeds) {
    await writeConversation(codexHome, seed);
  }

  console.log(colorize(`Seeded ${seeds.length} reverie conversation(s) under ${codexHome}.`, "info"));
  console.log();
}

type ConversationSeed = {
  timestamp: string;
  summary: string;
  userMessage: string;
  assistantMessages: string[];
};

function makeConversationSeed(seed: ConversationSeed) {
  const conversationId = randomUUID();
  const pathParts = timestampToParts(seed.timestamp);
  const fileName = `rollout-${pathParts.slug}-${conversationId}.jsonl`;
  const relDir = path.join("sessions", pathParts.year, pathParts.month, pathParts.day);
  const relativePath = path.join(relDir, fileName);
  return { ...seed, id: conversationId, relativePath };
}

async function writeConversation(codexHome: string, seed: ReturnType<typeof makeConversationSeed>): Promise<void> {
  const fullPath = path.join(codexHome, seed.relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });

  const lines = [
    JSON.stringify({
      timestamp: seed.timestamp,
      type: "session_meta",
      payload: {
        id: seed.id,
        timestamp: seed.timestamp,
        instructions: null,
        cwd: codexHome,
        originator: "reverie-demo",
        cli_version: "0.0.0",
        model_provider: "demo",
        summary: seed.summary,
      },
    }),
    JSON.stringify({
      timestamp: seed.timestamp,
      type: "event_msg",
      payload: {
        type: "user_message",
        message: seed.userMessage,
      },
    }),
    ...seed.assistantMessages.map((text, idx) =>
      JSON.stringify({
        timestamp: new Date(Date.parse(seed.timestamp) + (idx + 1) * 1000).toISOString(),
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text }],
        },
      }),
    ),
  ];

  await fs.writeFile(fullPath, lines.join("\n") + "\n", "utf8");
}

function timestampToParts(timestamp: string): { year: string; month: string; day: string; slug: string } {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear().toString();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const iso = date.toISOString().split(".")[0]?.replace("Z", "") ?? "";
  const slug = iso.replace(/:/g, "-");
  return { year, month, day, slug };
}

function printConversationPreview(conversations: ReverieConversation[]): void {
  const preview = conversations.slice(0, 3);
  console.log(colorize("🗂️  Conversations queued for indexing (showing up to 3):", "preview"));
  preview.forEach((convo, idx) => {
    console.log();
    console.log(colorize(`#${idx + 1} ${convo.id}`, "info"));
    console.log(colorize(indent(`Path: ${convo.path}`), "muted"));
    if (convo.createdAt) {
      console.log(colorize(indent(`Created: ${convo.createdAt}`), "muted"));
    }
    if (convo.updatedAt) {
      console.log(colorize(indent(`Updated: ${convo.updatedAt}`), "muted"));
    }
    const headSummaries = pickRecords(convo.headRecordsToon, convo.headRecords).map((line) => summarizeRecord(line));
    const tailSummaries = pickRecords(convo.tailRecordsToon, convo.tailRecords).map((line) => summarizeRecord(line));
    const headDisplay = takeSummaries(filterNoisySummaries(headSummaries), PREVIEW_LIMIT);
    const tailDisplay = takeSummaries(filterNoisySummaries(tailSummaries), PREVIEW_LIMIT);
    if (headDisplay.length > 0) {
      console.log(colorize(indent("Head excerpt:"), "preview"));
      headDisplay.forEach((summary) => printExcerptSummary(summary));
    }
    if (tailDisplay.length > 0) {
      console.log(colorize(indent("Tail excerpt:"), "preview"));
      tailDisplay.forEach((summary) => printExcerptSummary(summary));
    }
  });
}

function printExcerptLine(line: string): void {
  printExcerptSummary(summarizeRecord(line));
}

function printExcerptSummary(summary: RecordSummary, label = "•"): void {
  console.log(colorize(indent(`${label} ${summary.title}`, "    "), summary.color ?? "muted"));
  if (summary.snippet) {
    console.log(colorize(indent(summary.snippet, "      "), "muted"));
    const snippetLen = summary.snippetLength ?? summary.snippet.length;
    const hiddenChars = Math.max(summary.rawLength - snippetLen, 0);
    if (hiddenChars > 0) {
      console.log(
        colorize(
          indent(
            `↳ showing ${snippetLen} of ${summary.rawLength} chars (${hiddenChars} hidden in reverie)`,
            "      ",
          ),
          "insight",
        ),
      );
    }
  }
  if (summary.annotation) {
    console.log(colorize(indent(`↳ ${summary.annotation}`, "      "), "insight"));
  }
}

function printIndexStats(stats: Awaited<ReturnType<typeof reverieIndexSemantic>>): void {
  console.log();
  console.log(colorize("📊 Indexing Stats:", "stats"));
  console.log(colorize(`Conversations indexed: ${stats.conversationsIndexed}`, "stats"));
  console.log(colorize(`Documents embedded (chunk count): ${stats.documentsEmbedded}`, "stats"));
  console.log(colorize(`Embedding batches: ${stats.batches}`, "stats"));
  if (stats.conversationsIndexed > 0) {
    const avg = stats.documentsEmbedded / stats.conversationsIndexed;
    console.log(colorize(`Avg chunks per conversation: ${avg.toFixed(2)}`, "stats"));
  }
}

async function describeCacheDirectory(dir: string): Promise<void> {
  try {
    const summary = await walkDir(dir);
    console.log();
    console.log(colorize("📁 Embed Cache Summary:", "cache"));
    console.log(colorize(`Directory: ${dir}`, "cache"));
    console.log(colorize(`Files: ${summary.files}`, "cache"));
    console.log(colorize(`Subdirectories: ${summary.directories}`, "cache"));
    console.log(colorize(`Size: ${(summary.bytes / (1024 * 1024)).toFixed(2)} MiB`, "cache"));
  } catch (error) {
    console.warn(colorize(`Unable to describe cache directory ${dir}:`, "warning"), error);
  }
}

type DirSummary = { files: number; directories: number; bytes: number };

async function walkDir(dir: string): Promise<DirSummary> {
  const summary: DirSummary = { files: 0, directories: 0, bytes: 0 };
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      summary.directories += 1;
      const child = await walkDir(entryPath);
      summary.files += child.files;
      summary.directories += child.directories;
      summary.bytes += child.bytes;
    } else if (entry.isFile()) {
      summary.files += 1;
      const stats = await fs.stat(entryPath);
      summary.bytes += stats.size;
    }
  }
  return summary;
}

async function runSemanticSearch(codexHome: string): Promise<void> {
  console.log(colorize("Query snippet:", "info"));
  console.log(colorize(indent(REASONING_SNIPPET), "muted"));
  console.log();

  const results = await reverieSearchSemantic(codexHome, REASONING_SNIPPET, {
    ...SEARCH_OPTIONS,
    projectRoot: process.cwd(),
  });

  if (results.length === 0) {
    console.log("No semantic matches found.");
    return;
  }

  printSearchResults(results);
}

function printSearchResults(results: ReverieSearchResult[]): void {
  console.log(colorize(`Found ${results.length} conversation(s). Showing up to ${SEARCH_LIMIT}.`, "result"));
  console.log();
  results.slice(0, SEARCH_LIMIT).forEach((result, idx) => {
    const rawSummaries = result.matchingExcerpts.map((excerpt) => summarizeRecord(excerpt.trim()));
    const displaySummaries = filterNoisySummaries(rawSummaries);
    const hiddenChunks = Math.max(rawSummaries.length - displaySummaries.length, 0);
    const chunkLabel = hiddenChunks > 0
      ? `Matching chunk excerpts (${displaySummaries.length} shown of ${rawSummaries.length})`
      : `Matching chunk excerpts (${displaySummaries.length})`;

    console.log(colorize(`Result #${idx + 1}`, "result"));
    console.log(colorize(indent(`Conversation: ${result.conversation.path}`), "muted"));
    console.log(colorize(indent(`Relevance score: ${result.relevanceScore.toFixed(4)}`), "result"));
    if (typeof result.rerankerScore === "number") {
      console.log(colorize(indent(`Reranker score: ${result.rerankerScore.toFixed(4)}`), "result"));
    }
    if (rawSummaries.length > 0) {
      console.log(colorize(indent(chunkLabel), "preview"));
      displaySummaries.forEach((summary, chunkIdx) => {
        printExcerptSummary(summary, `[${chunkIdx + 1}]`);
      });
    }

    const filteredInsights = filterNoisyInsights(result.insights);
    if (filteredInsights.values.length > 0) {
      const insightLabel = filteredInsights.hidden > 0
        ? `Insights (${filteredInsights.values.length} shown of ${result.insights.length}):`
        : "Insights:";
      console.log(colorize(indent(insightLabel), "preview"));
      filteredInsights.values.forEach((insight) => {
        console.log(colorize(indent(`• ${insight}`, "    "), "insight"));
      });
    }

    console.log();
  });
}

function printLegend(): void {
  console.log(colorize("Legend", "heading"));
  LEGEND.forEach((entry) => {
    const label = colorize(entry.label.padEnd(8), entry.color);
    console.log(`${label} ${entry.desc}`);
  });
}

function pickRecords(preferred: string[], fallback: string[]): string[] {
  return preferred.length > 0 ? preferred : fallback;
}

function takeSummaries(summaries: RecordSummary[], limit = PREVIEW_LIMIT): RecordSummary[] {
  if (summaries.length <= limit) {
    return summaries;
  }
  return summaries.slice(0, limit);
}

function filterNoisySummaries(summaries: RecordSummary[]): RecordSummary[] {
  const filtered = summaries.filter((summary) => !isNoisySummary(summary));
  return filtered.length > 0 ? filtered : summaries;
}

function isNoisySummary(summary: RecordSummary): boolean {
  const title = summary.title.toLowerCase();
  const snippet = summary.snippet ?? "";
  if (title.startsWith("session_meta")) {
    return true;
  }
  if (title.includes("environment_context") || containsInstructionMarker(snippet)) {
    return true;
  }
  if (title.includes("system prompt block")) {
    return true;
  }
  if (summary.rawLength > 4000 && containsInstructionMarker(snippet)) {
    return true;
  }
  return false;
}

type FilteredInsights = {
  values: string[];
  hidden: number;
};

function filterNoisyInsights(values: string[]): FilteredInsights {
  const filtered = values.filter((value) => !containsInstructionMarker(value));
  if (filtered.length === 0) {
    return { values, hidden: 0 };
  }
  return { values: filtered, hidden: values.length - filtered.length };
}

function containsInstructionMarker(input: string | undefined): boolean {
  if (!input) {
    return false;
  }
  const normalized = input.toLowerCase();
  return (
    normalized.includes("# agents.md instructions") ||
    normalized.includes("<environment_context") ||
    normalized.includes("<system>") ||
    normalized.includes("codex-rs folder where the rust code lives")
  );
}

main().catch((error) => {
  console.error("\n❌ Reverie semantic search demo failed:", error);
  process.exitCode = 1;
});
