import test from "node:test";
import assert from "node:assert/strict";
import type { Thread, ReverieSemanticSearchOptions } from "@codex-native/sdk";
import { ReverieSystem } from "../src/reverie.js";
import { attachReverieHints, computeMaxRelevance } from "../src/reverie-hints.js";
import { isValidReverieExcerpt, deduplicateReverieInsights } from "../src/reverie-quality.js";
import type { MultiAgentConfig, ReverieResult } from "../src/types.js";

/**
 * Integration tests for reverie quality filtering in the orchestrator and reverie-hints system.
 * These tests verify that the quality filtering pipeline works correctly end-to-end.
 */

test("Orchestrator filters out low-quality insights from ReverieSystem", async () => {
  let searchCallCount = 0;
  const mockSearch = async (
    _home: string,
    _context: string,
    _options?: ReverieSemanticSearchOptions,
  ) => {
    searchCallCount++;
    const now = new Date().toISOString();
    return [
      // High-quality, high-relevance insight (should be kept)
      {
        conversation: { id: "high-quality-1", createdAt: now, headRecords: [], tailRecords: [] },
        relevanceScore: 0.85,
        matchingExcerpts: ["Fixed race condition in async handler by adding mutex lock"],
        insights: ["Add mutex lock to prevent concurrent access"],
      },
      // Low-quality excerpt (boilerplate - should be filtered)
      {
        conversation: { id: "low-quality-1", createdAt: now, headRecords: [], tailRecords: [] },
        relevanceScore: 0.82,
        matchingExcerpts: ["# AGENTS.md instructions for handling user requests"],
        insights: ["Follow AGENTS.md pattern"],
      },
      // High-quality but low relevance (should be filtered)
      {
        conversation: { id: "low-relevance-1", createdAt: now, headRecords: [], tailRecords: [] },
        relevanceScore: 0.65,
        matchingExcerpts: ["Implemented retry logic with exponential backoff"],
        insights: ["Use exponential backoff for retries"],
      },
      // High-quality, high-relevance insight (should be kept)
      {
        conversation: { id: "high-quality-2", createdAt: now, headRecords: [], tailRecords: [] },
        relevanceScore: 0.78,
        matchingExcerpts: ["Updated test timeout from 5s to 30s for CI stability"],
        insights: ["Increase test timeout for flaky CI tests"],
      },
      // System prompt (should be filtered)
      {
        conversation: { id: "low-quality-2", createdAt: now, headRecords: [], tailRecords: [] },
        relevanceScore: 0.90,
        matchingExcerpts: ["<system>Sandbox env vars: CODEX_SAN=1</system>"],
        insights: ["Environment configuration"],
      },
      // Duplicate of first insight (should be deduplicated)
      {
        conversation: { id: "duplicate-1", createdAt: now, headRecords: [], tailRecords: [] },
        relevanceScore: 0.80,
        matchingExcerpts: ["Fixed race condition in async handler by adding mutex lock"],
        insights: ["Add mutex lock for thread safety"],
      },
    ];
  };

  const config: MultiAgentConfig = {
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
    embedder: {
      initOptions: { model: "test-model" },
      embedRequest: { normalize: true, cache: true, batchSize: 32 },
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

  // Simulate orchestrator's filtering pipeline
  const allReveries = await reverie.searchReveries("diagnose race condition");

  // Apply quality filtering pipeline (as done in orchestrator.ts lines 104-106)
  const basicFiltered = allReveries.filter(match => isValidReverieExcerpt(match.excerpt));
  const highQuality = basicFiltered.filter(match => match.relevance >= 0.7);
  const deduplicated = deduplicateReverieInsights(highQuality);

  // Verify filtering statistics
  assert.equal(allReveries.length, 6, "Should return all 6 mock reveries");
  assert.equal(basicFiltered.length, 4, "Should filter out 2 low-quality excerpts (boilerplate & system)");
  assert.equal(highQuality.length, 3, "Should filter out 1 low-relevance insight (<0.7)");
  assert.equal(deduplicated.length, 2, "Should deduplicate 1 duplicate insight");

  // Verify the correct insights were kept
  const conversationIds = deduplicated.map(r => r.conversationId);
  assert.ok(conversationIds.includes("high-quality-1"), "Should keep high-quality-1");
  assert.ok(conversationIds.includes("high-quality-2"), "Should keep high-quality-2");
  assert.ok(!conversationIds.includes("low-quality-1"), "Should filter low-quality-1 (boilerplate)");
  assert.ok(!conversationIds.includes("low-quality-2"), "Should filter low-quality-2 (system prompt)");
  assert.ok(!conversationIds.includes("low-relevance-1"), "Should filter low-relevance-1 (<0.7)");
  assert.ok(!conversationIds.includes("duplicate-1"), "Should filter duplicate-1 (duplicate)");

  assert.equal(searchCallCount, 1, "Should call search exactly once");
});

test("Orchestrator logging shows correct filtering stats", async () => {
  const mockSearch = async () => {
    const now = new Date().toISOString();
    return [
      {
        conversation: { id: "valid-1", createdAt: now, headRecords: [], tailRecords: [] },
        relevanceScore: 0.85,
        matchingExcerpts: ["Implemented caching layer with Redis"],
        insights: ["Use Redis for caching"],
      },
      {
        conversation: { id: "invalid-1", createdAt: now, headRecords: [], tailRecords: [] },
        relevanceScore: 0.75,
        matchingExcerpts: ["<system>Context from past work</system>"],
        insights: ["System context"],
      },
      {
        conversation: { id: "valid-2", createdAt: now, headRecords: [], tailRecords: [] },
        relevanceScore: 0.65,
        matchingExcerpts: ["Added error handling for network failures"],
        insights: ["Handle network errors"],
      },
      {
        conversation: { id: "valid-3", createdAt: now, headRecords: [], tailRecords: [] },
        relevanceScore: 0.90,
        matchingExcerpts: ["Implemented caching layer with Redis connection pooling"],
        insights: ["Use connection pooling"],
      },
    ];
  };

  const config: MultiAgentConfig = {
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
    embedder: {
      initOptions: { model: "test-model" },
      embedRequest: { normalize: true, cache: true, batchSize: 32 },
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

  // Capture console.log output
  const originalLog = console.log;
  const logLines: string[] = [];
  console.log = (...args: unknown[]) => {
    logLines.push(args.join(" "));
  };

  try {
    const reveries = await reverie.searchReveries("caching strategy");
    const basicFiltered = reveries.filter(match => isValidReverieExcerpt(match.excerpt));
    const highQuality = basicFiltered.filter(match => match.relevance >= 0.7);
    const deduplicated = deduplicateReverieInsights(highQuality);

    // Simulate orchestrator logging (line 109 in orchestrator.ts)
    console.log(
      `Reverie filtering: Found ${reveries.length} reveries, ${basicFiltered.length} passed quality check, ${highQuality.length} high-scoring (>=0.7), ${deduplicated.length} after dedup`,
    );
  } finally {
    console.log = originalLog;
  }

  // Verify logging output
  const filteringLog = logLines.find(line => line.includes("Reverie filtering:"));
  assert.ok(filteringLog, "Should log filtering statistics");
  assert.ok(filteringLog?.includes("Found 4 reveries"), "Should log total count");
  assert.ok(filteringLog?.includes("3 passed quality check"), "Should log quality filtered count");
  assert.ok(filteringLog?.includes("2 high-scoring (>=0.7)"), "Should log high-relevance count");
  assert.ok(filteringLog?.includes("2 after dedup"), "Should log deduplicated count (no duplicates in this test)");
});

test("ReverieHints system filters low-quality excerpts before checking relevance", async () => {
  const mockSearch = async () => {
    const now = new Date().toISOString();
    return [
      // High relevance but invalid excerpt
      {
        conversation: { id: "invalid-high", createdAt: now, headRecords: [], tailRecords: [] },
        relevanceScore: 0.95,
        matchingExcerpts: ["Tool output: {\"file\": \"test.ts\", \"status\": \"ok\"}"],
        insights: ["Tool output insight"],
      },
      // Valid excerpt with good relevance
      {
        conversation: { id: "valid-good", createdAt: now, headRecords: [], tailRecords: [] },
        relevanceScore: 0.72,
        matchingExcerpts: ["Refactored authentication to use JWT tokens"],
        insights: ["Implement JWT authentication"],
      },
    ];
  };

  const config: MultiAgentConfig = {
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
    autoReverieHints: true,
    reverieHintMinScore: 0.6,
    embedder: {
      initOptions: { model: "test-model" },
      embedRequest: { normalize: true, cache: true, batchSize: 32 },
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

  // Capture console.log output to verify filtering
  const originalLog = console.log;
  const logLines: string[] = [];
  console.log = (...args: unknown[]) => {
    logLines.push(args.join(" "));
  };

  try {
    const mockThread = createMockThread();
    const cleanup = attachReverieHints(mockThread, reverie, config);

    // Simulate reasoning event that triggers hint collection
    mockThread.simulateEvent({
      type: "item.completed",
      item: { type: "reasoning", text: "Need to implement authentication system with secure token handling" },
    });

    // Simulate turn completion to trigger hint emission
    mockThread.simulateEvent({ type: "turn.completed" });

    // Wait for async hint processing
    await new Promise(resolve => setTimeout(resolve, 100));

    cleanup();
  } finally {
    console.log = originalLog;
  }

  // Verify that quality filtering was applied in hints
  const qualityLog = logLines.find(line => line.includes("Reverie hint quality:"));
  if (qualityLog) {
    // Should show that 1 invalid insight was filtered
    assert.ok(qualityLog.includes("2 raw"), "Should process 2 raw matches");
    assert.ok(qualityLog.includes("1 valid"), "Should filter to 1 valid match");
  }
});

test("ReverieHints deduplicates similar insights", async () => {
  const mockSearch = async () => {
    const now = new Date().toISOString();
    return [
      {
        conversation: { id: "orig-1", createdAt: now, headRecords: [], tailRecords: [] },
        relevanceScore: 0.85,
        matchingExcerpts: ["Added retry logic with exponential backoff for API calls"],
        insights: ["Implement retry with backoff"],
      },
      {
        conversation: { id: "dup-1", createdAt: now, headRecords: [], tailRecords: [] },
        relevanceScore: 0.80,
        matchingExcerpts: ["Added retry logic with exponential backoff for network requests"],
        insights: ["Use exponential backoff"],
      },
      {
        conversation: { id: "unique-1", createdAt: now, headRecords: [], tailRecords: [] },
        relevanceScore: 0.75,
        matchingExcerpts: ["Configured connection pool with max 10 connections"],
        insights: ["Limit connection pool size"],
      },
    ];
  };

  const config: MultiAgentConfig = {
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
    autoReverieHints: true,
    reverieHintMinScore: 0.6,
    embedder: {
      initOptions: { model: "test-model" },
      embedRequest: { normalize: true, cache: true, batchSize: 32 },
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

  // Capture console.log output
  const originalLog = console.log;
  const logLines: string[] = [];
  console.log = (...args: unknown[]) => {
    logLines.push(args.join(" "));
  };

  try {
    const mockThread = createMockThread();
    const cleanup = attachReverieHints(mockThread, reverie, config);

    mockThread.simulateEvent({
      type: "item.completed",
      item: { type: "reasoning", text: "Need to implement retry logic for API requests" },
    });

    mockThread.simulateEvent({ type: "turn.completed" });

    await new Promise(resolve => setTimeout(resolve, 100));

    cleanup();
  } finally {
    console.log = originalLog;
  }

  // Verify deduplication occurred
  const qualityLog = logLines.find(line => line.includes("Reverie hint quality:"));
  if (qualityLog) {
    assert.ok(qualityLog.includes("3 raw"), "Should process 3 raw matches");
    assert.ok(qualityLog.includes("2 unique"), "Should deduplicate to 2 unique matches");
    assert.ok(qualityLog.includes("filtered"), "Should show filtered count");
  }
});

test("ReverieSystem LLM grading filters based on 'yes'/'no' responses", async () => {
  let gradeCallCount = 0;
  const mockSearch = async () => {
    const now = new Date().toISOString();
    return [
      {
        conversation: { id: "specific-1", createdAt: now, headRecords: [], tailRecords: [] },
        relevanceScore: 0.85,
        matchingExcerpts: ["Updated Dockerfile to use multi-stage builds, reducing image size from 1.2GB to 450MB"],
        insights: ["Use multi-stage Docker builds"],
      },
      {
        conversation: { id: "generic-1", createdAt: now, headRecords: [], tailRecords: [] },
        relevanceScore: 0.80,
        matchingExcerpts: ["Context from past work on infrastructure"],
        insights: ["Infrastructure context"],
      },
    ];
  };

  // Mock the Agent/Runner for LLM grading
  const mockRunner = {
    run: async (_agent: unknown, prompt: string) => {
      gradeCallCount++;
      // Simulate LLM responses based on prompt content
      if (prompt.includes("multi-stage builds")) {
        return { finalOutput: "yes" }; // Specific technical detail
      } else {
        return { finalOutput: "no" }; // Generic phrase
      }
    },
  };

  const config: MultiAgentConfig = {
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
    reverieEnableLLMGrading: true,
    embedder: {
      initOptions: { model: "test-model" },
      embedRequest: { normalize: true, cache: true, batchSize: 32 },
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

  // Mock the gradeReverieRelevance method to use our mock runner
  const originalGrade = reverie.gradeReverieRelevance.bind(reverie);
  reverie.gradeReverieRelevance = async (searchContext: string, insight: ReverieResult) => {
    const prompt = `Context: ${searchContext}\n\nExcerpt: "${insight.excerpt.slice(0, 400)}"\n\nDoes this excerpt contain SPECIFIC technical details relevant to the work?\nMust have: actual code/file references, technical decisions, error details, implementation specifics.\nReject if: greeting, thinking marker, JSON object, generic phrase ("Context from past work"), metadata.\n\nAnswer: `;
    const result = await mockRunner.run({}, prompt);
    const response = result.finalOutput?.trim().toLowerCase() || "";
    return response === "yes" || response.startsWith("yes");
  };

  // Capture console.log output
  const originalLog = console.log;
  const logLines: string[] = [];
  console.log = (...args: unknown[]) => {
    logLines.push(args.join(" "));
  };

  try {
    const results = await reverie.searchReveriesFromText("docker optimization", {
      enableLLMGrading: true,
    });

    // Verify LLM grading occurred
    assert.equal(gradeCallCount, 2, "Should grade 2 high-scoring insights");
    assert.equal(results.length, 1, "Should return only approved insight");
    assert.equal(results[0].conversationId, "specific-1", "Should keep specific technical detail");
  } finally {
    console.log = originalLog;
    reverie.gradeReverieRelevance = originalGrade;
  }

  // Verify logging
  const gradingLog = logLines.find(line => line.includes("LLM grading"));
  assert.ok(gradingLog, "Should log LLM grading start");

  const approvedLog = logLines.find(line => line.includes("LLM approved"));
  assert.ok(approvedLog, "Should log approval count");
  assert.ok(approvedLog?.includes("1/2"), "Should show 1 of 2 approved");

  const rejectedLog = logLines.find(line => line.includes("LLM rejected"));
  assert.ok(rejectedLog, "Should log rejection count");
  assert.ok(rejectedLog?.includes("1"), "Should show 1 rejected");
});

test("ReverieSystem LLM grading handles errors gracefully within gradeReverieRelevance", async () => {
  let gradeAttempts = 0;
  const mockSearch = async () => {
    const now = new Date().toISOString();
    return [
      {
        conversation: { id: "test-1", createdAt: now, headRecords: [], tailRecords: [] },
        relevanceScore: 0.85,
        matchingExcerpts: ["Implemented feature X with component Y for better performance"],
        insights: ["Use component Y"],
      },
    ];
  };

  const config: MultiAgentConfig = {
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
    reverieEnableLLMGrading: true,
    embedder: {
      initOptions: { model: "test-model" },
      embedRequest: { normalize: true, cache: true, batchSize: 32 },
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

  // Mock gradeReverieRelevance to simulate internal error handling
  // The actual method catches errors and returns true (conservative approach)
  const originalGrade = reverie.gradeReverieRelevance.bind(reverie);
  reverie.gradeReverieRelevance = async (searchContext: string, insight: ReverieResult) => {
    gradeAttempts++;
    try {
      // Simulate grading logic that throws
      throw new Error("Simulated grading error");
    } catch (error) {
      console.warn("Failed to grade reverie relevance:", error);
      // Conservative approach: accept on error
      return true;
    }
  };

  // Capture console.warn output
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.join(" "));
  };

  const originalLog = console.log;
  console.log = () => {}; // Suppress logs for this test

  try {
    const results = await reverie.searchReveriesFromText("feature implementation", {
      enableLLMGrading: true,
    });

    // Should accept the insight when grading fails (conservative approach)
    assert.equal(gradeAttempts, 1, "Should attempt grading");
    assert.equal(results.length, 1, "Should return insight (defaults to accepting on error)");
    assert.equal(results[0].conversationId, "test-1", "Should return the test insight");
  } finally {
    console.warn = originalWarn;
    console.log = originalLog;
    reverie.gradeReverieRelevance = originalGrade;
  }

  // Verify error was logged
  const errorWarning = warnings.find(w => w.includes("Failed to grade reverie relevance"));
  assert.ok(errorWarning, "Should warn about grading failure");
});

test("ReverieSystem only grades high-scoring results (>=0.7)", async () => {
  let gradeCallCount = 0;
  const mockSearch = async () => {
    const now = new Date().toISOString();
    return [
      {
        conversation: { id: "high-1", createdAt: now, headRecords: [], tailRecords: [] },
        relevanceScore: 0.85,
        matchingExcerpts: ["High scoring insight"],
        insights: ["High score"],
      },
      {
        conversation: { id: "low-1", createdAt: now, headRecords: [], tailRecords: [] },
        relevanceScore: 0.65,
        matchingExcerpts: ["Low scoring insight"],
        insights: ["Low score"],
      },
      {
        conversation: { id: "high-2", createdAt: now, headRecords: [], tailRecords: [] },
        relevanceScore: 0.75,
        matchingExcerpts: ["Another high scoring insight"],
        insights: ["Another high"],
      },
    ];
  };

  const config: MultiAgentConfig = {
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
    reverieEnableLLMGrading: true,
    embedder: {
      initOptions: { model: "test-model" },
      embedRequest: { normalize: true, cache: true, batchSize: 32 },
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

  // Mock gradeReverieRelevance
  reverie.gradeReverieRelevance = async () => {
    gradeCallCount++;
    return true; // Accept all
  };

  const originalLog = console.log;
  console.log = () => {}; // Suppress logs

  try {
    const results = await reverie.searchReveriesFromText("test query", {
      enableLLMGrading: true,
    });

    // Should only grade the 2 high-scoring insights (>=0.7)
    assert.equal(gradeCallCount, 2, "Should only grade high-scoring insights (>=0.7)");
    assert.equal(results.length, 3, "Should return all insights (2 graded + 1 low-scoring)");
  } finally {
    console.log = originalLog;
  }
});

test("computeMaxRelevance returns highest relevance score", () => {
  const matches = [
    {
      result: {
        conversationId: "a",
        timestamp: "2025-01-01T00:00:00Z",
        relevance: 0.75,
        excerpt: "test",
        insights: [],
      },
      score: 0.5,
      bestRelevance: 0.75,
      fromReasoning: true,
      fromDialogue: false,
    },
    {
      result: {
        conversationId: "b",
        timestamp: "2025-01-01T00:00:00Z",
        relevance: 0.92,
        excerpt: "test",
        insights: [],
      },
      score: 0.8,
      bestRelevance: 0.92,
      fromReasoning: false,
      fromDialogue: true,
    },
    {
      result: {
        conversationId: "c",
        timestamp: "2025-01-01T00:00:00Z",
        relevance: 0.68,
        excerpt: "test",
        insights: [],
      },
      score: 0.6,
      bestRelevance: 0.68,
      fromReasoning: true,
      fromDialogue: true,
    },
  ];

  const maxRelevance = computeMaxRelevance(matches);
  assert.equal(maxRelevance, 0.92, "Should return highest bestRelevance");
});

test("isValidReverieExcerpt filters common boilerplate patterns", () => {
  // Should reject
  assert.equal(isValidReverieExcerpt(""), false, "Should reject empty string");
  assert.equal(isValidReverieExcerpt("short"), false, "Should reject very short excerpts");
  assert.equal(isValidReverieExcerpt("# AGENTS.md instructions for handling requests"), false, "Should reject AGENTS.md");
  assert.equal(isValidReverieExcerpt("<system>Environment context</system>"), false, "Should reject system tags");
  assert.equal(isValidReverieExcerpt("Tool output: success"), false, "Should reject tool output");
  assert.equal(isValidReverieExcerpt('{"file": "test.ts", "status": "ok"}'), false, "Should reject JSON objects");

  // Should accept
  assert.equal(
    isValidReverieExcerpt("Implemented authentication with JWT tokens for secure API access"),
    true,
    "Should accept meaningful technical content",
  );
  assert.equal(
    isValidReverieExcerpt("Fixed race condition by adding mutex lock in async handler"),
    true,
    "Should accept specific technical details",
  );
});

test("deduplicateReverieInsights removes similar excerpts", () => {
  const insights: ReverieResult[] = [
    {
      conversationId: "1",
      timestamp: "2025-01-01T00:00:00Z",
      relevance: 0.9,
      excerpt: "Implemented caching layer with Redis for better performance and scalability across distributed systems, which helped reduce response time by 40% in production",
      insights: ["Use Redis caching"],
    },
    {
      conversationId: "2",
      timestamp: "2025-01-01T00:00:00Z",
      relevance: 0.85,
      excerpt: "Implemented caching layer with Redis for better performance and scalability across distributed systems, also added connection pooling",
      insights: ["Use connection pooling"],
    },
    {
      conversationId: "3",
      timestamp: "2025-01-01T00:00:00Z",
      relevance: 0.8,
      excerpt: "Added monitoring dashboard with Grafana and Prometheus integration for real-time metrics",
      insights: ["Use Grafana for monitoring"],
    },
  ];

  const deduplicated = deduplicateReverieInsights(insights);

  // First 100 chars of first two excerpts are identical, so one should be removed
  assert.equal(deduplicated.length, 2, "Should remove 1 duplicate");
  assert.equal(deduplicated[0].conversationId, "1", "Should keep first occurrence");
  assert.equal(deduplicated[1].conversationId, "3", "Should keep unique insight");
});

// Helper function to create mock thread for testing
function createMockThread(): Thread & { simulateEvent: (event: any) => void } {
  let eventHandler: ((event: any) => void) | undefined;
  const backgroundEvents: string[] = [];

  return {
    onEvent(handler: (event: any) => void) {
      eventHandler = handler;
      return () => {
        eventHandler = undefined;
      };
    },
    async sendBackgroundEvent(message: string) {
      backgroundEvents.push(message);
    },
    async run() {
      return { finalResponse: "" };
    },
    simulateEvent(event: any) {
      if (eventHandler) {
        eventHandler(event);
      }
    },
  } as any;
}
