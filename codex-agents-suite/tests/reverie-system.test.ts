import test from "node:test";
import assert from "node:assert/strict";
import type { ReverieSemanticSearchOptions, Thread } from "@codex-native/sdk";
import { ReverieSystem } from "../src/reverie.js";
import type { MultiAgentConfig } from "../src/types.js";

test("ReverieSystem search & warm indexing uses embedder hooks", async () => {
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
    reverieRerankerModel: "rozgo/bge-reranker-v2-m3",
    reverieRerankerBatchSize: 4,
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
});

test("ReverieSystem skips semantic search when embedder config missing", async () => {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.join(" "));
  };

  const config: MultiAgentConfig = {
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
  };
  const reverie = new ReverieSystem(config);
  const results = await reverie.searchReveriesFromText(" flaky test triage ");
  console.warn = originalWarn;

  assert.equal(results.length, 0, "semantic search should be disabled");
  assert.ok(
    warnings.some((line) => line.includes("semantic search disabled")),
    "should emit warning about missing embedder",
  );
});

test("injectReverie posts formatted summary exactly once", async () => {
  const config: MultiAgentConfig = {
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
  };
  const reverie = new ReverieSystem(config);
  const runCalls: string[] = [];
  const backgroundEvents: string[] = [];
  const mockThread = {
    async run(note: string) {
      runCalls.push(note);
      return { finalResponse: note };
    },
    async sendBackgroundEvent(message: string) {
      backgroundEvents.push(message);
    },
  } as unknown as Thread;

  await reverie.injectReverie(
    mockThread,
    [
      {
        conversationId: "conv-42",
        timestamp: "2025-01-01T00:00:00Z",
        relevance: 0.78,
        excerpt: "rerun migrations",
        insights: ["Re-run migrations with --force"],
      },
    ],
    "migration failures",
  );

  assert.equal(runCalls.length, 1, "thread.run should be called once for non-empty reveries");
  assert.ok(runCalls[0].includes("migration failures"));
  assert.ok(runCalls[0].includes("Re-run migrations"));
  assert.equal(backgroundEvents.length, 1, "background event should be emitted for reverie hints");
  assert.ok(backgroundEvents[0].includes("migration failures"));

  await reverie.injectReverie(mockThread, [], "noop");
  assert.equal(runCalls.length, 1, "empty reveries should not emit follow-up note");
  assert.equal(backgroundEvents.length, 1, "no background events expected when reveries empty");
});

test("ReverieSystem does not set reranker options when not configured", async () => {
  let lastSearchOptions: ReverieSemanticSearchOptions | null = null;

  const mockSearch = async (
    _home: string,
    _context: string,
    options?: ReverieSemanticSearchOptions,
  ) => {
    lastSearchOptions = options ?? null;
    return [];
  };

  const config: MultiAgentConfig = {
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
    embedder: {
      initOptions: { model: "test-model" },
      embedRequest: { normalize: true, cache: true, batchSize: 16 },
    },
  };

  const reverie = new ReverieSystem(config, {
    searchSemantic: mockSearch,
    indexSemantic: async () => {
      throw new Error("indexSemantic should not be called in this test");
    },
    fastEmbedInit: async () => {
      // no-op for tests
    },
  });

  await reverie.searchReveriesFromText("triage reranker behavior");

  assert.ok(lastSearchOptions, "semantic search should be invoked with options");
  assert.equal(lastSearchOptions?.rerankerModel, undefined);
  assert.equal(lastSearchOptions?.rerankerBatchSize, undefined);
});
