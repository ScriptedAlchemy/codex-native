#!/usr/bin/env tsx
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  fastEmbedInit,
  reverieSearchConversations,
  reverieSearchSemantic,
  type ReverieSemanticSearchOptions,
} from "@codex-native/sdk";

function usage(message?: string, code = message ? 1 : 0): never {
  if (message) {
    console.error("Error:", message);
  }
  console.error(
    `Usage: pnpm dlx tsx scripts/reverie-smoke.ts --query "<text>" [--semantic] [--limit 5] [--working-dir <path>] [--embed-model <model>]`,
  );
  process.exit(code);
}

type CliOptions = {
  query: string;
  limit: number;
  semantic: boolean;
  workingDir: string;
  embedModel?: string;
  maxCandidates: number;
};

function parseArgs(argv: string[]): CliOptions {
  const opts: Partial<CliOptions> = {
    limit: 5,
    semantic: false,
    workingDir: process.cwd(),
    maxCandidates: 80,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--query":
      case "-q":
        opts.query = argv[++i];
        break;
      case "--limit":
      case "-l":
        opts.limit = Number(argv[++i]);
        break;
      case "--max-candidates":
        opts.maxCandidates = Number(argv[++i]);
        break;
      case "--semantic":
        opts.semantic = true;
        break;
      case "--working-dir":
      case "-C":
        opts.workingDir = argv[++i];
        break;
      case "--embed-model":
        opts.embedModel = argv[++i];
        break;
      case "--help":
      case "-h":
        usage(undefined, 0);
        break;
      default:
        usage(`unknown option ${arg}`);
    }
  }

  if (!opts.query) {
    usage("--query is required");
  }
  if (!opts.limit || opts.limit < 1) {
    usage("--limit must be >= 1");
  }
  if (!opts.maxCandidates || opts.maxCandidates < opts.limit!) {
    opts.maxCandidates = Math.max(opts.limit!, 40);
  }
  return opts as CliOptions;
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const projectRoot = path.resolve(options.workingDir);

  if (options.semantic) {
    const model = options.embedModel ?? "BAAI/bge-small-en-v1.5";
    console.log(`⚙️  Initialising fastembed model: ${model}`);
    await fastEmbedInit({
      model,
      cacheDir: path.join(codexHome, "cache", "fastembed"),
      showDownloadProgress: true,
    });
    const semanticOptions: ReverieSemanticSearchOptions = {
      limit: options.limit,
      maxCandidates: options.maxCandidates,
      projectRoot,
      normalize: true,
      cache: true,
    };
    console.log(
      `🔍 Running semantic reverie search (limit=${options.limit}, candidates=${options.maxCandidates}) in ${projectRoot}`,
    );
    const results = await reverieSearchSemantic(codexHome, options.query, semanticOptions);
    reportResults(results);
  } else {
    console.log(`🔍 Running keyword reverie search (limit=${options.limit}) in ${projectRoot}`);
    const results = await reverieSearchConversations(codexHome, options.query, options.limit);
    reportResults(results);
  }
}

type Result = Awaited<ReturnType<typeof reverieSearchSemantic>>[number];

function reportResults(results: Result[]): void {
  if (!results.length) {
    console.warn("⚠️  No reveries matched the query.");
    process.exitCode = 1;
    return;
  }
  console.log(`✅ Found ${results.length} reverie match(es).`);
  for (const [idx, match] of results.entries()) {
    const relevanceValue =
      match.relevanceScore ??
      // Fallback fields for keyword search output types.
      (match as any).relevance ??
      (match as any).relevance_score ??
      0;
    const summary = {
      index: idx + 1,
      conversation: match.conversation.id,
      relevance: Number(relevanceValue).toFixed(3),
      timestamp: match.conversation.createdAt ?? (match as any).timestamp,
      excerpt: match.matchingExcerpts?.[0] ?? (match as any).excerpt ?? "",
      insights: match.insights?.slice(0, 3) ?? [],
    };
    console.log(JSON.stringify(summary, null, 2));
  }
}

run().catch((error) => {
  console.error("Reverie smoke test failed:", error);
  process.exit(1);
});
