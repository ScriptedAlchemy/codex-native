/**
 * Reverie semantic search evaluator.
 *
 * Usage:
 *   npx tsx examples/reverie/eval/index.ts --limit=3 --max-results=3
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { randomUUID } from "node:crypto";

import {
  encodeToToon as nativeEncodeToToon,
  fastEmbedInit,
  reverieIndexSemantic,
  reverieListConversations,
  type ReverieSemanticSearchOptions,
} from "@codex-native/sdk";

import { loadReasoningSlices, type ReasoningSlice } from "./dataset";
import {
  DEFAULT_STRATEGIES,
  executeStrategy,
  clipText,
  type SearchStrategy,
  type StrategyRun,
} from "./strategies";
import { createStrategyJudge, type JudgeVerdict } from "./judge";
import { Scoreboard } from "./scoreboard";
import { encode as encodeToonFallback } from "@toon-format/toon";

const DEFAULT_EMBED_MODEL = process.env.REVERIE_EMBED_MODEL ?? "BAAI/bge-small-en-v1.5";
const DEFAULT_JUDGE_MODEL = process.env.REVERIE_EVAL_JUDGE_MODEL ?? "gpt-5.1";
const DEFAULT_CACHE_DIR = process.env.REVERIE_EVAL_CACHE ?? path.join(os.tmpdir(), "codex-reverie-eval-cache");
const DEFAULT_PROJECT_ROOT = process.cwd();
const DEFAULT_LIMIT = Number(process.env.REVERIE_EVAL_LIMIT ?? 3);
const DEFAULT_CONVO_LIMIT = Number(process.env.REVERIE_EVAL_CONVO_LIMIT ?? 18);
const DEFAULT_MAX_RESULTS = Number(process.env.REVERIE_EVAL_RESULTS ?? 3);

const SEARCH_OPTIONS: ReverieSemanticSearchOptions = {
  maxCandidates: 32,
  batchSize: 16,
  normalize: true,
  cache: true,
};

const COLOR = {
  header: "\x1b[95m",
  info: "\x1b[36m",
  success: "\x1b[92m",
  warning: "\x1b[91m",
  muted: "\x1b[90m",
  reset: "\x1b[0m",
} as const;

const REASONING_SNIPPET = `• I've noted that the Clippy fix has updated the code, and while we don't
  need to inspect all the changes, we definitely must run relevant tests.
  The instructions say to run tests for specific projects that changed. Since
  we've touched codex-core and codex-exec, I'll run cargo test -p codex-core
  and cargo test -p codex-exec. For the common/core/protocol modifications,
  I could ask for user permission to run cargo test --all-features, but let's
  stick to the relevant crates for now.`;

type CliOptions = {
  codexHome?: string;
  sliceLimit: number;
  conversationLimit: number;
  topResults: number;
  embedModel: string;
  embedCacheDir: string;
  judgeModel: string;
  strategyFilter: string[] | null;
  projectRoot: string;
  datasetFile?: string;
  chunkSize: number;
  chunkOverlap: number;
};

/**
 * Edit this object to tweak the harness defaults without touching CLI flags.
 * CLI args still override these values when provided.
 */
const HARNESS_DEFAULTS: CliOptions = {
  codexHome: process.env.CODEX_HOME,
  sliceLimit: DEFAULT_LIMIT,
  conversationLimit: DEFAULT_CONVO_LIMIT,
  topResults: DEFAULT_MAX_RESULTS,
  embedModel: DEFAULT_EMBED_MODEL,
  embedCacheDir: DEFAULT_CACHE_DIR,
  judgeModel: DEFAULT_JUDGE_MODEL,
  strategyFilter: null,
  projectRoot: DEFAULT_PROJECT_ROOT,
  datasetFile: undefined,
  chunkSize: 8,
  chunkOverlap: 3,
};

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const codexHome = cli.codexHome ?? resolveCodexHome();

  console.log(colorize("🧪 Reverie Evaluation Harness", "header"));
  console.log(colorize(`CODEX_HOME => ${codexHome}`, "info"));
  const judgeModel = coerceJudgeModel(cli.judgeModel);
  console.log(colorize(`Judge model => ${judgeModel.label}`, "info"));
  if (judgeModel.warning) {
    console.log(colorize(judgeModel.warning, "warning"));
  }
  console.log(colorize(`Embed model => ${cli.embedModel}`, "info"));
  console.log(colorize(`Embed cache => ${cli.embedCacheDir}`, "info"));
  if (cli.datasetFile) {
    console.log(colorize(`Dataset file => ${cli.datasetFile}`, "info"));
  }

  await ensureDemoConversations(codexHome);

  await fastEmbedInit({
    model: cli.embedModel,
    cacheDir: cli.embedCacheDir,
    maxLength: 768,
    showDownloadProgress: true,
  });

  await reverieIndexSemantic(codexHome, {
    ...SEARCH_OPTIONS,
    projectRoot: cli.projectRoot,
    limit: cli.topResults,
  });

  let slices: ReasoningSlice[];
  if (cli.datasetFile) {
    slices = await loadSlicesFromFile(cli.datasetFile);
  } else {
    slices = await loadReasoningSlices({
      codexHome,
      maxSlices: cli.sliceLimit,
      conversationLimit: cli.conversationLimit,
      chunkSize: cli.chunkSize,
      chunkOverlap: cli.chunkOverlap,
    });
  }

  if (slices.length === 0) {
    console.log(colorize("No reasoning slices found. Seed additional data and retry.", "warning"));
    return;
  }

  const strategies = selectStrategies(cli.strategyFilter);
  console.log(colorize(`Strategies => ${strategies.map((s) => s.id).join(", ")}`, "info"));

  const judge = await createStrategyJudge({
    modelName: judgeModel.providerModel,
    instructions: judgeModel.instructions,
    strategyIds: strategies.map((s) => s.id),
  });

  const scoreboard = new Scoreboard(strategies);

  for (let idx = 0; idx < slices.length; idx += 1) {
    const slice = slices[idx];
    console.log();
    console.log(colorize(`═ Scenario ${idx + 1}/${slices.length}: ${slice.conversationId}`, "header"));
    printSliceOverview(slice);

    const runs: StrategyRun[] = [];
    for (const strategy of strategies) {
      const run = await executeStrategy({
        codexHome,
        slice,
        strategy,
        searchOptions: { ...SEARCH_OPTIONS, projectRoot: cli.projectRoot },
        maxResults: cli.topResults,
      });
      runs.push(run);
      printStrategyRun(run, slice);
    }

    try {
      const verdict = await judge.evaluate({ slice, runs });
      scoreboard.record(verdict);
      printVerdict(verdict);
    } catch (error) {
      console.error(colorize(`Judge evaluation failed: ${describeError(error)}`, "warning"));
    }
  }

  scoreboard.render();
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { ...HARNESS_DEFAULTS };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    const [key, value] = arg.split("=");
    switch (key) {
      case "--codex-home":
        options.codexHome = value ? path.resolve(value) : undefined;
        break;
      case "--limit":
        options.sliceLimit = value ? Number(value) : options.sliceLimit;
        break;
      case "--max-results":
        options.topResults = value ? Number(value) : options.topResults;
        break;
      case "--convo-limit":
        options.conversationLimit = value ? Number(value) : options.conversationLimit;
        break;
      case "--embed-model":
        options.embedModel = value ?? options.embedModel;
        break;
      case "--embed-cache":
        options.embedCacheDir = value ? path.resolve(value) : options.embedCacheDir;
        break;
      case "--judge-model":
        options.judgeModel = value ?? options.judgeModel;
        break;
      case "--strategies":
        options.strategyFilter = value ? value.split(",").map((s) => s.trim()).filter(Boolean) : null;
        break;
      case "--project-root":
        options.projectRoot = value ? path.resolve(value) : options.projectRoot;
        break;
      case "--dataset":
        options.datasetFile = value ? path.resolve(value) : undefined;
        break;
      case "--chunk-size":
        options.chunkSize = value ? Number(value) : options.chunkSize;
        break;
      case "--chunk-overlap":
        options.chunkOverlap = value ? Number(value) : options.chunkOverlap;
        break;
      default:
        console.warn(colorize(`Unknown flag ${arg}`, "warning"));
    }
  }

  return options;
}

function selectStrategies(filter: string[] | null): SearchStrategy[] {
  if (!filter || filter.length === 0) {
    return DEFAULT_STRATEGIES;
  }
  const lookup = new Map(DEFAULT_STRATEGIES.map((strategy) => [strategy.id, strategy] as const));
  const selected = filter.map((id) => lookup.get(id)).filter((strategy): strategy is SearchStrategy => Boolean(strategy));
  return selected.length > 0 ? selected : DEFAULT_STRATEGIES;
}

function printUsage(): void {
  console.log(`Reverie semantic evaluator options:
  --codex-home=<path>      Override CODEX_HOME
  --limit=<n>              Number of reasoning slices to score (default ${DEFAULT_LIMIT})
  --max-results=<n>        Number of semantic hits per strategy (default ${DEFAULT_MAX_RESULTS})
  --convo-limit=<n>        Number of transcripts to scan for slices (default ${DEFAULT_CONVO_LIMIT})
  --embed-model=<id>       FastEmbed model id
  --embed-cache=<dir>      Embeddings cache directory
  --judge-model=<id>       GPT judge model (default ${DEFAULT_JUDGE_MODEL})
  --strategies=a,b,c       Restrict to specific strategy ids
  --project-root=<path>    Project root for reverie indexing
  --dataset=<file>         Use a pre-generated slices JSON (skip live extraction)
  --chunk-size=<n>         Events per slice chunk when sampling
  --chunk-overlap=<n>      Event overlap between chunks`);
}


function toToon(value: unknown): string {
  try {
    return nativeEncodeToToon(value as any);
  } catch (error) {
    return encodeToonFallback(value as any);
  }
}
function printSliceOverview(slice: ReasoningSlice): void {
  console.log(colorize("Reasoning snippet:", "info"));
  console.log(colorize(indent(toToon({ reasoning: slice.reasoningText.split("\n") })), "muted"));
  if (typeof slice.chunkIndex === "number") {
    console.log(
      colorize(
        `Chunk index ${slice.chunkIndex}${slice.chunkSize ? ` (${slice.chunkSize} events)` : ""} — source=${slice.reasoningSource}`,
        "muted",
      ),
    );
  }
  if (slice.userMessage) {
    console.log(colorize("User message:", "info"));
    console.log(colorize(indent(slice.userMessage), "muted"));
  }
  if (slice.assistantResponse) {
    console.log(colorize("Assistant response:", "info"));
    console.log(colorize(indent(slice.assistantResponse), "muted"));
  }
}

async function loadSlicesFromFile(filePath: string): Promise<ReasoningSlice[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((entry): entry is ReasoningSlice => Boolean(entry?.reasoningText));
    }
  } catch (error) {
    console.error(colorize(`Failed to load dataset ${filePath}: ${describeError(error)}`, "warning"));
  }
  return [];
}

function coerceJudgeModel(name: string): {
  label: string;
  providerModel: string;
  warning?: string;
  instructions?: string;
} {
  const trimmed = name.trim();
  if (trimmed === "gpt-5.1") {
    return {
      label: "gpt-5.1 (alias → gpt-5-codex)",
      providerModel: "gpt-5-codex",
      warning: "gpt-5.1 is unavailable locally; aliasing to gpt-5-codex for scoring.",
      instructions:
        "You are simulating GPT-5.1 as a retrieval judge. Acknowledge any confidence penalties introduced by aliasing to gpt-5-codex.",
    };
  }
  return { label: trimmed, providerModel: trimmed };
}

function printStrategyRun(run: StrategyRun, slice: ReasoningSlice): void {
  console.log();
  console.log(colorize(`▶ ${run.strategy.label} (${run.strategy.id})`, "info"));
  if (run.skipped) {
    console.log(colorize(`  Skipped: ${run.skipReason ?? "missing input"}`, "warning"));
    return;
  }
  if (run.error) {
    console.log(colorize(`  Error: ${run.error}`, "warning"));
    return;
  }
  console.log(colorize(`  Query => ${clipText(run.query) ?? "(empty)"}`, "muted"));
  const autoScore = run.autoScore.matchedSourceConversation
    ? `hit (rank ${run.autoScore.sourceRank})`
    : "did not hit source";
  console.log(colorize(`  Source conversation => ${autoScore}`, run.autoScore.matchedSourceConversation ? "success" : "muted"));

  if (run.results.length === 0) {
    console.log(colorize("  No semantic matches.", "warning"));
    return;
  }

  run.results.forEach((result, idx) => {
    const tag = result.conversation.id === slice.conversationId ? colorize("[source]", "success") : "";
    const reranker = typeof result.rerankerScore === "number" ? ` reranker=${result.rerankerScore.toFixed(3)}` : "";
    console.log(colorize(`  ${idx + 1}. score=${result.relevanceScore.toFixed(3)}${reranker} ${tag}`, "muted"));
    const excerpt = summarizeResultExcerpt(result);
    if (excerpt) {
      console.log(colorize(indent(excerpt), "muted"));
    }
  });
}

function summarizeResultExcerpt(result: StrategyRun["results"][number]): string | undefined {
  const fragments = [
    ...(result.matchingExcerpts ?? []),
    ...(result.insights ?? []),
  ];
  if (fragments.length === 0) {
    return undefined;
  }
  return clipText(fragments.join(" | "));
}

function printVerdict(verdict: JudgeVerdict): void {
  console.log();
  console.log(colorize(`🏆 Judge winner: ${verdict.winner}`, "success"));
  console.log(colorize(indent(verdict.summary), "muted"));
  verdict.scoreboard.forEach((row) => {
    console.log(colorize(`  ${row.placement}. ${row.strategy} — ${row.justification}`, "info"));
  });
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
      return;
    }
  } catch (error) {
    console.warn(colorize("Unable to list conversations; seeding demo data.", "warning"), error);
  }
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

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function colorize(text: string, tone: keyof typeof COLOR): string {
  return `${COLOR[tone]}${text}${COLOR.reset}`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error) => {
  console.error(colorize(`Fatal error: ${describeError(error)}`, "warning"));
  process.exit(1);
});
