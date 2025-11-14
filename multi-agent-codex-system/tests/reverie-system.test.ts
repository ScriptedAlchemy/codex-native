import assert from "node:assert/strict";
import type { ReverieSemanticSearchOptions } from "@codex-native/sdk";
import { ReverieSystem } from "../src/reverie.js";
import type { MultiAgentConfig, ReverieResult } from "../src/types.js";

let initCalls = 0;
let lastIndexOptions: any = null;
let lastSearchOptions: ReverieSemanticSearchOptions | null = null;

const mockSearch = async (
  _home: string,
  _context: string,
  options?: ReverieSemanticSearchOptions,
) => {
  lastSearchOptions = options ?? null;
  const now = new Date().toISOString();
  return [
    {
      conversation: { id: "match-1", createdAt: now, headRecords: [], tailRecords: [] },
      relevanceScore: 0.9,
      matchingExcerpts: ["fix flaky tests"],
      insights: ["Retry failed jobs"],
    },
    {
      conversation: { id: "match-2", createdAt: now, headRecords: [], tailRecords: [] },
      relevanceScore: 0.4,
      matchingExcerpts: ["irrelevant"],
      insights: [],
    },
  ];
};

const mockIndex = async (_home: string, options: any) => {
  lastIndexOptions = options;
  return {
    conversationsIndexed: 50,
    documentsEmbedded: 50,
    batches: 4,
  };
};

const mockInit = async () => {
  initCalls += 1;
};

const config: MultiAgentConfig = {
  workingDirectory: process.cwd(),
  skipGitRepoCheck: true,
  embedder: {
    initOptions: { model: "test-model" },
    embedRequest: { normalize: true, cache: true, batchSize: 32 },
  },
  reverieIndexLimit: 10,
  reverieIndexMaxCandidates: 20,
};

const reverie = new ReverieSystem(config, {
  searchSemantic: mockSearch,
  indexSemantic: mockIndex,
  fastEmbedInit: mockInit,
});

const results = await reverie.searchReveriesFromText("  diagnose build  ", { limit: 1 });
assert.equal(results.length, 1);
assert.equal(results[0].conversationId, "match-1");
assert.ok(results[0].insights[0].includes("Retry"));
assert.equal(lastSearchOptions?.rerankerModel, config.reverieRerankerModel);
assert.equal(lastSearchOptions?.rerankerBatchSize, config.reverieRerankerBatchSize);

const originalLog = console.log;
const logLines: string[] = [];
console.log = (...args: unknown[]) => {
  logLines.push(args.join(" "));
};

await reverie.warmSemanticIndex();

console.log = originalLog;

assert.equal(initCalls, 1, "fastEmbedInit should be invoked once");
assert.ok(lastIndexOptions, "reverieIndexSemantic should receive options");
assert.equal(lastIndexOptions.limit, config.reverieIndexLimit);
assert.equal(lastIndexOptions.maxCandidates, config.reverieIndexMaxCandidates);
assert.ok(
  logLines.some((line) => line.includes("Pre-indexing reveries")),
  "should announce indexing start",
);
assert.ok(
  logLines.some((line) => line.includes("Reverie indexing complete")),
  "should announce indexing completion",
);

console.log("Reverie system tests passed ✔");
