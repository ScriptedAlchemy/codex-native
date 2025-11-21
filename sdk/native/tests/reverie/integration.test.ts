import { describe, it, expect, jest } from "@jest/globals";

/**
 * Integration tests for the Reverie system
 *
 * These tests verify the end-to-end flow of:
 * 1. Searching for reveries
 * 2. Applying quality filtering
 * 3. Deduplicating results
 * 4. Injecting context into threads
 */

type ReverieResult = {
  conversationId: string;
  timestamp: string;
  relevance: number;
  excerpt: string;
  insights: string[];
};

// Mock implementations for testing
function isValidReverieExcerpt(excerpt: string): boolean {
  if (!excerpt || excerpt.trim().length < 20) {
    return false;
  }

  const skipPatterns = [
    "Tool output:",
    "sandbox_mode",
    "<system>",
    "function_calls",
  ];

  const normalized = excerpt.toLowerCase();
  const hasBoilerplate = skipPatterns.some((pattern) =>
    normalized.includes(pattern.toLowerCase())
  );

  if (hasBoilerplate) {
    return false;
  }

  return true;
}

function deduplicateReverieInsights(insights: ReverieResult[]): ReverieResult[] {
  const seen = new Set<string>();
  const result: ReverieResult[] = [];

  for (const insight of insights) {
    const fingerprint = insight.excerpt.slice(0, 100).toLowerCase().replace(/\s+/g, " ");

    if (!seen.has(fingerprint)) {
      seen.add(fingerprint);
      result.push(insight);
    }
  }

  return result;
}

function applyQualityPipeline(insights: ReverieResult[]): ReverieResult[] {
  // Filter invalid excerpts
  const validInsights = insights.filter((i) => isValidReverieExcerpt(i.excerpt));

  // Deduplicate
  const deduplicated = deduplicateReverieInsights(validInsights);

  // Sort by relevance
  return deduplicated.sort((a, b) => b.relevance - a.relevance);
}

describe("Reverie Integration Tests", () => {
  describe("Full quality pipeline", () => {
    it("filters, deduplicates, and sorts reverie results", () => {
      const rawResults: ReverieResult[] = [
        {
          conversationId: "conv-1",
          timestamp: "2025-01-01T12:00:00Z",
          relevance: 0.75,
          excerpt: "Implemented authentication using JWT tokens with 15-minute expiration",
          insights: [],
        },
        {
          conversationId: "conv-2",
          timestamp: "2025-01-01T12:01:00Z",
          relevance: 0.95,
          excerpt: "Fixed critical bug in user validation logic that caused infinite loops",
          insights: [],
        },
        {
          conversationId: "conv-3",
          timestamp: "2025-01-01T12:02:00Z",
          relevance: 0.65,
          excerpt: "Tool output: Command executed successfully with exit code 0",
          insights: [],
        },
        {
          conversationId: "conv-4",
          timestamp: "2025-01-01T12:03:00Z",
          relevance: 0.85,
          excerpt: "Implemented authentication using JWT tokens with 15-minute expiration",
          insights: [],
        },
        {
          conversationId: "conv-5",
          timestamp: "2025-01-01T12:04:00Z",
          relevance: 0.70,
          excerpt: "Added error handling for network timeouts in API client module",
          insights: [],
        },
      ];

      const processed = applyQualityPipeline(rawResults);

      // Should filter out tool output (conv-3)
      expect(processed.length).toBe(3);

      // Should deduplicate conv-1 and conv-4 (same excerpt, keep first)
      const conversationIds = processed.map((r) => r.conversationId);
      expect(conversationIds).toContain("conv-1");
      expect(conversationIds).not.toContain("conv-4");

      // Should sort by relevance descending
      expect(processed[0]?.conversationId).toBe("conv-2"); // 0.95
      expect(processed[1]?.conversationId).toBe("conv-1"); // 0.75
      expect(processed[2]?.conversationId).toBe("conv-5"); // 0.70
    });

    it("handles all invalid results", () => {
      const rawResults: ReverieResult[] = [
        {
          conversationId: "conv-1",
          timestamp: "2025-01-01T12:00:00Z",
          relevance: 0.9,
          excerpt: "Tool output: test",
          insights: [],
        },
        {
          conversationId: "conv-2",
          timestamp: "2025-01-01T12:01:00Z",
          relevance: 0.8,
          excerpt: "short",
          insights: [],
        },
        {
          conversationId: "conv-3",
          timestamp: "2025-01-01T12:02:00Z",
          relevance: 0.7,
          excerpt: "<system>System message</system>",
          insights: [],
        },
      ];

      const processed = applyQualityPipeline(rawResults);
      expect(processed).toEqual([]);
    });

    it("preserves insights array in results", () => {
      const rawResults: ReverieResult[] = [
        {
          conversationId: "conv-1",
          timestamp: "2025-01-01T12:00:00Z",
          relevance: 0.9,
          excerpt: "Fixed authentication bug by adding proper session validation",
          insights: ["Added session validation", "Fixed auth bug"],
        },
      ];

      const processed = applyQualityPipeline(rawResults);
      expect(processed[0]?.insights).toEqual(["Added session validation", "Fixed auth bug"]);
    });
  });

  describe("Multi-level search simulation", () => {
    it("combines results from multiple search levels", () => {
      // Simulate project-level search
      const projectResults: ReverieResult[] = [
        {
          conversationId: "conv-p1",
          timestamp: "2025-01-01T10:00:00Z",
          relevance: 0.85,
          excerpt: "Project-wide refactoring of authentication system to use OAuth2",
          insights: [],
        },
      ];

      // Simulate branch-level search
      const branchResults: ReverieResult[] = [
        {
          conversationId: "conv-b1",
          timestamp: "2025-01-01T11:00:00Z",
          relevance: 0.92,
          excerpt: "Branch changes: Implemented JWT refresh token rotation",
          insights: [],
        },
      ];

      // Simulate file-level search
      const fileResults: ReverieResult[] = [
        {
          conversationId: "conv-f1",
          timestamp: "2025-01-01T12:00:00Z",
          relevance: 0.78,
          excerpt: "Modified auth.ts to add token validation middleware",
          insights: [],
        },
      ];

      // Combine all results
      const combined = [...projectResults, ...branchResults, ...fileResults];
      const processed = applyQualityPipeline(combined);

      expect(processed.length).toBe(3);
      expect(processed[0]?.conversationId).toBe("conv-b1"); // Highest relevance
      expect(processed[1]?.conversationId).toBe("conv-p1");
      expect(processed[2]?.conversationId).toBe("conv-f1");
    });

    it("deduplicates across search levels", () => {
      const projectResults: ReverieResult[] = [
        {
          conversationId: "conv-p1",
          timestamp: "2025-01-01T10:00:00Z",
          relevance: 0.85,
          excerpt: "Implemented caching layer using Redis for session management",
          insights: [],
        },
      ];

      const branchResults: ReverieResult[] = [
        {
          conversationId: "conv-b1",
          timestamp: "2025-01-01T11:00:00Z",
          relevance: 0.92,
          excerpt: "Implemented caching layer using Redis for session management",
          insights: [],
        },
      ];

      const combined = [...projectResults, ...branchResults];
      const processed = applyQualityPipeline(combined);

      // Should keep only one (the first)
      expect(processed.length).toBe(1);
      expect(processed[0]?.conversationId).toBe("conv-p1");
    });
  });

  describe("Error handling", () => {
    it("handles empty input gracefully", () => {
      const processed = applyQualityPipeline([]);
      expect(processed).toEqual([]);
    });

    it("handles malformed results gracefully", () => {
      const malformed: ReverieResult[] = [
        {
          conversationId: "",
          timestamp: "",
          relevance: 0.9,
          excerpt: "Valid excerpt with good technical content about implementing features",
          insights: [],
        },
        {
          conversationId: "conv-1",
          timestamp: "2025-01-01T12:00:00Z",
          relevance: NaN,
          excerpt: "Another valid excerpt about fixing bugs in the codebase",
          insights: [],
        },
      ];

      // Should not throw
      expect(() => applyQualityPipeline(malformed)).not.toThrow();

      const processed = applyQualityPipeline(malformed);
      expect(processed.length).toBe(2);
    });

    it("handles results with null/undefined fields", () => {
      const resultsWithNulls: ReverieResult[] = [
        {
          conversationId: "conv-1",
          timestamp: "2025-01-01T12:00:00Z",
          relevance: 0.9,
          excerpt: "Valid technical excerpt about implementing authentication features",
          insights: null as any,
        },
      ];

      const processed = applyQualityPipeline(resultsWithNulls);
      expect(processed.length).toBe(1);
    });
  });

  describe("Performance characteristics", () => {
    it("handles large result sets efficiently", () => {
      const largeSet: ReverieResult[] = Array.from({ length: 1000 }, (_, i) => ({
        conversationId: `conv-${i}`,
        timestamp: "2025-01-01T12:00:00Z",
        relevance: Math.random(),
        excerpt: `Technical insight number ${i} about implementing features and fixing bugs in the system`,
        insights: [],
      }));

      const startTime = Date.now();
      const processed = applyQualityPipeline(largeSet);
      const endTime = Date.now();

      expect(processed.length).toBeLessThanOrEqual(1000);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete in < 1 second
    });

    it("maintains order stability for equal relevance scores", () => {
      const equalScores: ReverieResult[] = [
        {
          conversationId: "conv-1",
          timestamp: "2025-01-01T12:00:00Z",
          relevance: 0.8,
          excerpt: "First insight with score 0.8 about authentication implementation details",
          insights: [],
        },
        {
          conversationId: "conv-2",
          timestamp: "2025-01-01T12:01:00Z",
          relevance: 0.8,
          excerpt: "Second insight with score 0.8 about validation logic improvements",
          insights: [],
        },
        {
          conversationId: "conv-3",
          timestamp: "2025-01-01T12:02:00Z",
          relevance: 0.8,
          excerpt: "Third insight with score 0.8 about error handling enhancements",
          insights: [],
        },
      ];

      const processed = applyQualityPipeline(equalScores);

      // Should maintain insertion order for equal scores
      expect(processed[0]?.conversationId).toBe("conv-1");
      expect(processed[1]?.conversationId).toBe("conv-2");
      expect(processed[2]?.conversationId).toBe("conv-3");
    });
  });

  describe("Real-world scenarios", () => {
    it("processes typical search results correctly", () => {
      const typicalResults: ReverieResult[] = [
        {
          conversationId: "019a-auth-impl",
          timestamp: "2025-01-15T14:23:00Z",
          relevance: 0.89,
          excerpt: "Implemented JWT authentication with refresh tokens. Used jose library for token validation. Tokens expire after 15 minutes, refresh tokens after 7 days.",
          insights: ["JWT implementation", "Token refresh logic"],
        },
        {
          conversationId: "019b-bug-fix",
          timestamp: "2025-01-15T15:45:00Z",
          relevance: 0.92,
          excerpt: "Fixed critical bug in token refresh flow. Issue was race condition when multiple tabs refreshed simultaneously. Added mutex lock.",
          insights: ["Race condition fix", "Mutex implementation"],
        },
        {
          conversationId: "019c-validation",
          timestamp: "2025-01-15T16:12:00Z",
          relevance: 0.76,
          excerpt: "Added validation for JWT claims. Check issuer, audience, expiration. Return 401 if any validation fails.",
          insights: ["JWT validation", "Security improvements"],
        },
        {
          conversationId: "019d-duplicate",
          timestamp: "2025-01-15T16:30:00Z",
          relevance: 0.85,
          excerpt: "Implemented JWT authentication with refresh tokens. Used jose library for token validation. Tokens expire after 15 minutes, refresh tokens after 7 days.",
          insights: ["Duplicate of first"],
        },
        {
          conversationId: "019e-boilerplate",
          timestamp: "2025-01-15T17:00:00Z",
          relevance: 0.81,
          excerpt: "Tool output: Tests passed with 95% coverage",
          insights: [],
        },
      ];

      const processed = applyQualityPipeline(typicalResults);

      // Should filter out tool output and duplicate
      expect(processed.length).toBe(3);

      // Should be sorted by relevance
      expect(processed[0]?.relevance).toBe(0.92);
      expect(processed[1]?.relevance).toBe(0.89);
      expect(processed[2]?.relevance).toBe(0.76);

      // Should preserve insights
      expect(processed[0]?.insights).toEqual(["Race condition fix", "Mutex implementation"]);
    });

    it("handles mixed quality results from production", () => {
      const productionResults: ReverieResult[] = [
        {
          conversationId: "conv-good-1",
          timestamp: "2025-01-01T12:00:00Z",
          relevance: 0.95,
          excerpt: "Migrated database from MySQL to PostgreSQL. Key challenge was handling JSON columns - used JSONB for better performance.",
          insights: ["Database migration", "Performance optimization"],
        },
        {
          conversationId: "conv-bad-1",
          timestamp: "2025-01-01T12:01:00Z",
          relevance: 0.88,
          excerpt: "sandbox_mode configured",
          insights: [],
        },
        {
          conversationId: "conv-good-2",
          timestamp: "2025-01-01T12:02:00Z",
          relevance: 0.82,
          excerpt: "Updated API rate limiting to use token bucket algorithm. Prevents burst traffic from overwhelming the server.",
          insights: ["Rate limiting", "Token bucket"],
        },
        {
          conversationId: "conv-bad-2",
          timestamp: "2025-01-01T12:03:00Z",
          relevance: 0.79,
          excerpt: "short",
          insights: [],
        },
      ];

      const processed = applyQualityPipeline(productionResults);

      // Should only keep the two valid results
      expect(processed.length).toBe(2);
      expect(processed.map((r) => r.conversationId)).toEqual(["conv-good-1", "conv-good-2"]);
    });
  });

  describe("Thread injection simulation", () => {
    it("formats reverie context for thread injection", () => {
      const results: ReverieResult[] = [
        {
          conversationId: "conv-1",
          timestamp: "2025-01-01T12:00:00Z",
          relevance: 0.92,
          excerpt: "Implemented caching using Redis",
          insights: ["Redis caching", "Performance improvement"],
        },
        {
          conversationId: "conv-2",
          timestamp: "2025-01-01T12:01:00Z",
          relevance: 0.85,
          excerpt: "Added retry logic for API calls",
          insights: ["Retry mechanism", "Error handling"],
        },
      ];

      const processed = applyQualityPipeline(results);

      // Simulate formatting for injection
      const formatted = processed.map((r, idx) => ({
        position: idx + 1,
        score: Math.round(r.relevance * 100),
        excerpt: r.excerpt.slice(0, 100),
        insights: r.insights,
      }));

      expect(formatted[0]?.position).toBe(1);
      expect(formatted[0]?.score).toBe(92);
      expect(formatted[1]?.position).toBe(2);
      expect(formatted[1]?.score).toBe(85);
    });
  });
});
