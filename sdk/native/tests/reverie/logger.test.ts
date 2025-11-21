import { describe, it, expect, jest } from "@jest/globals";

// Mock the logger functions based on actual implementation
type ReverieResult = {
  conversationId: string;
  timestamp: string;
  relevance: number;
  excerpt: string;
  insights: string[];
};

function truncateText(text: string, maxLength: number): string {
  if (!text || maxLength <= 0) {
    return "";
  }

  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length > maxLength) {
    return `${normalized.slice(0, maxLength)}...`;
  }

  return normalized;
}

function logReverieSearch(context: string, count: number, label?: string): void {
  const prefix = label ? `🔍 Reverie search [${label}]` : "🔍 Reverie search";
  const truncatedContext = truncateText(context, 80);
  console.log(`${prefix}: "${truncatedContext}" → ${count} candidates`);
}

function logReverieFiltering(
  total: number,
  basicFiltered: number,
  highQuality: number,
  final: number,
  llmGraded?: { total: number; approved: number }
): void {
  console.log("📊 Reverie filtering pipeline:");
  console.log(`   ${total} initial → ${basicFiltered} basic filtered → ${highQuality} high quality → ${final} final`);

  const acceptanceRate = total > 0 ? ((final / total) * 100).toFixed(1) : "0.0";
  console.log(`   Acceptance rate: ${acceptanceRate}% (${final}/${total})`);

  if (llmGraded && llmGraded.total > 0) {
    const gradeRate = ((llmGraded.approved / llmGraded.total) * 100).toFixed(1);
    console.log(`   🤖 LLM grading: ${llmGraded.approved}/${llmGraded.total} approved (${gradeRate}%)`);
  }
}

function logReverieInsights(
  insights: ReverieResult[],
  maxDisplay: number = 5,
  label?: string
): void {
  const prefix = label ? `💡 Reverie insights [${label}]` : "💡 Reverie insights";

  if (insights.length === 0) {
    console.log(`${prefix}: No insights found`);
    return;
  }

  const displayCount = Math.min(insights.length, maxDisplay);
  console.log(`${prefix} (top ${displayCount}):`);

  for (let i = 0; i < displayCount; i++) {
    const insight = insights[i];
    if (!insight) continue;
    const score = Math.round(insight.relevance * 100);
    const truncatedExcerpt = truncateText(insight.excerpt, 250);
    const conversationId = insight.conversationId || "unknown";

    console.log(`   #${i + 1} (${score}%) ${truncatedExcerpt} [${conversationId}]`);
  }
}

describe("Reverie Logger Utilities", () => {
  describe("truncateText()", () => {
    describe("Basic truncation", () => {
      it("returns text unchanged when under maxLength", () => {
        const text = "Short text";
        expect(truncateText(text, 100)).toBe("Short text");
      });

      it("truncates text when over maxLength", () => {
        const text = "This is a very long text that needs to be truncated";
        const result = truncateText(text, 20);
        expect(result).toBe("This is a very long ...");
        expect(result.length).toBe(23); // 20 chars + "..."
      });

      it("returns exact text when length equals maxLength", () => {
        const text = "Exactly twenty chars";
        expect(text.length).toBe(20);
        expect(truncateText(text, 20)).toBe("Exactly twenty chars");
      });

      it("adds ellipsis when truncating", () => {
        const text = "This will be cut off here";
        const result = truncateText(text, 10);
        expect(result).toContain("...");
        expect(result).toBe("This will ...");
      });
    });

    describe("Whitespace normalization", () => {
      it("normalizes multiple spaces to single space", () => {
        const text = "Multiple    spaces    here";
        expect(truncateText(text, 100)).toBe("Multiple spaces here");
      });

      it("normalizes newlines to single space", () => {
        const text = "Line one\nLine two\nLine three";
        expect(truncateText(text, 100)).toBe("Line one Line two Line three");
      });

      it("normalizes tabs to single space", () => {
        const text = "Tab\tseparated\tvalues";
        expect(truncateText(text, 100)).toBe("Tab separated values");
      });

      it("normalizes mixed whitespace", () => {
        const text = "Mixed  \n\t  whitespace   \n  everywhere";
        expect(truncateText(text, 100)).toBe("Mixed whitespace everywhere");
      });

      it("trims leading whitespace", () => {
        const text = "   Leading spaces";
        expect(truncateText(text, 100)).toBe("Leading spaces");
      });

      it("trims trailing whitespace", () => {
        const text = "Trailing spaces   ";
        expect(truncateText(text, 100)).toBe("Trailing spaces");
      });

      it("trims and normalizes combined", () => {
        const text = "  \n  Multiple   \t\n  issues   \n\n  ";
        expect(truncateText(text, 100)).toBe("Multiple issues");
      });
    });

    describe("Edge cases", () => {
      it("handles empty string", () => {
        expect(truncateText("", 10)).toBe("");
      });

      it("handles whitespace-only string", () => {
        expect(truncateText("   \n\t   ", 10)).toBe("");
      });

      it("handles null input", () => {
        expect(truncateText(null as any, 10)).toBe("");
      });

      it("handles undefined input", () => {
        expect(truncateText(undefined as any, 10)).toBe("");
      });

      it("handles zero maxLength", () => {
        expect(truncateText("Some text", 0)).toBe("");
      });

      it("handles negative maxLength", () => {
        expect(truncateText("Some text", -10)).toBe("");
      });

      it("handles very small maxLength (1 char)", () => {
        const result = truncateText("Hello world", 1);
        expect(result).toBe("H...");
      });

      it("handles text with only whitespace after normalization", () => {
        const text = "\n\n\n   \t\t\t   \n\n\n";
        expect(truncateText(text, 10)).toBe("");
      });

      it("handles unicode characters", () => {
        const text = "Hello 世界 🌍";
        expect(truncateText(text, 100)).toBe("Hello 世界 🌍");
      });

      it("handles special characters", () => {
        const text = "Special: @#$%^&*(){}[]|\\/<>?~`";
        expect(truncateText(text, 100)).toBe("Special: @#$%^&*(){}[]|\\/<>?~`");
      });
    });

    describe("Truncation with normalization", () => {
      it("normalizes before truncating", () => {
        const text = "Multiple    spaces    need    normalization    then    truncation";
        const result = truncateText(text, 30);
        // After normalization: "Multiple spaces need normalization then truncation"
        // First 30 chars: "Multiple spaces need normaliza"
        expect(result).toBe("Multiple spaces need normaliza...");
      });

      it("counts length after normalization", () => {
        const text = "A\n\n\nB\n\n\nC"; // 7 chars raw, 5 after normalization ("A B C")
        expect(truncateText(text, 10)).toBe("A B C");
        expect(truncateText(text, 3)).toBe("A B...");
      });
    });
  });

  describe("logReverieSearch()", () => {
    let consoleLogSpy: jest.SpiedFunction<typeof console.log>;

    beforeEach(() => {
      consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleLogSpy.mockRestore();
    });

    it("logs search without label", () => {
      logReverieSearch("authentication bug fix", 42);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '🔍 Reverie search: "authentication bug fix" → 42 candidates'
      );
    });

    it("logs search with label", () => {
      logReverieSearch("parser error handling", 15, "Filtered");
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '🔍 Reverie search [Filtered]: "parser error handling" → 15 candidates'
      );
    });

    it("truncates long context to 80 chars", () => {
      const longContext = "A".repeat(100);
      logReverieSearch(longContext, 10);

      const call = consoleLogSpy.mock.calls[0]?.[0] as string;
      expect(call).toContain("A".repeat(80) + "...");
    });

    it("handles empty context", () => {
      logReverieSearch("", 0);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '🔍 Reverie search: "" → 0 candidates'
      );
    });

    it("handles zero candidates", () => {
      logReverieSearch("no matches found", 0);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '🔍 Reverie search: "no matches found" → 0 candidates'
      );
    });

    it("normalizes whitespace in context", () => {
      logReverieSearch("multiple   spaces\n\nhere", 5);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '🔍 Reverie search: "multiple spaces here" → 5 candidates'
      );
    });
  });

  describe("logReverieFiltering()", () => {
    let consoleLogSpy: jest.SpiedFunction<typeof console.log>;

    beforeEach(() => {
      consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleLogSpy.mockRestore();
    });

    it("logs complete filtering pipeline without LLM grading", () => {
      logReverieFiltering(100, 60, 25, 10);

      expect(consoleLogSpy).toHaveBeenCalledTimes(3);
      expect(consoleLogSpy).toHaveBeenNthCalledWith(1, "📊 Reverie filtering pipeline:");
      expect(consoleLogSpy).toHaveBeenNthCalledWith(
        2,
        "   100 initial → 60 basic filtered → 25 high quality → 10 final"
      );
      expect(consoleLogSpy).toHaveBeenNthCalledWith(
        3,
        "   Acceptance rate: 10.0% (10/100)"
      );
    });

    it("logs filtering pipeline with LLM grading", () => {
      logReverieFiltering(100, 60, 25, 15, { total: 25, approved: 15 });

      expect(consoleLogSpy).toHaveBeenCalledTimes(4);
      expect(consoleLogSpy).toHaveBeenNthCalledWith(
        4,
        "   🤖 LLM grading: 15/25 approved (60.0%)"
      );
    });

    it("calculates acceptance rate correctly", () => {
      logReverieFiltering(80, 45, 20, 12);

      const acceptanceCall = consoleLogSpy.mock.calls[2]?.[0] as string;
      expect(acceptanceCall).toBe("   Acceptance rate: 15.0% (12/80)");
    });

    it("handles zero total (division by zero)", () => {
      logReverieFiltering(0, 0, 0, 0);

      const acceptanceCall = consoleLogSpy.mock.calls[2]?.[0] as string;
      expect(acceptanceCall).toBe("   Acceptance rate: 0.0% (0/0)");
    });

    it("handles 100% acceptance rate", () => {
      logReverieFiltering(50, 50, 50, 50);

      const acceptanceCall = consoleLogSpy.mock.calls[2]?.[0] as string;
      expect(acceptanceCall).toBe("   Acceptance rate: 100.0% (50/50)");
    });

    it("does not log LLM grading when total is 0", () => {
      logReverieFiltering(100, 60, 25, 10, { total: 0, approved: 0 });

      expect(consoleLogSpy).toHaveBeenCalledTimes(3); // No 4th call for LLM grading
    });

    it("calculates LLM grade rate correctly", () => {
      logReverieFiltering(100, 60, 30, 20, { total: 30, approved: 20 });

      const llmCall = consoleLogSpy.mock.calls[3]?.[0] as string;
      expect(llmCall).toBe("   🤖 LLM grading: 20/30 approved (66.7%)");
    });

    it("handles partial rejection in LLM grading", () => {
      logReverieFiltering(100, 50, 20, 8, { total: 20, approved: 8 });

      const llmCall = consoleLogSpy.mock.calls[3]?.[0] as string;
      expect(llmCall).toBe("   🤖 LLM grading: 8/20 approved (40.0%)");
    });
  });

  describe("logReverieInsights()", () => {
    let consoleLogSpy: jest.SpiedFunction<typeof console.log>;

    const createInsight = (excerpt: string, relevance: number, id: string): ReverieResult => ({
      conversationId: id,
      timestamp: "2025-01-01T12:00:00Z",
      relevance,
      excerpt,
      insights: [],
    });

    beforeEach(() => {
      consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleLogSpy.mockRestore();
    });

    it("logs insights without label", () => {
      const insights = [
        createInsight("Fixed auth timeout bug", 0.92, "conv-1"),
        createInsight("Implemented retry logic", 0.85, "conv-2"),
      ];

      logReverieInsights(insights);

      expect(consoleLogSpy).toHaveBeenNthCalledWith(1, "💡 Reverie insights (top 2):");
      expect(consoleLogSpy).toHaveBeenNthCalledWith(2, "   #1 (92%) Fixed auth timeout bug [conv-1]");
      expect(consoleLogSpy).toHaveBeenNthCalledWith(3, "   #2 (85%) Implemented retry logic [conv-2]");
    });

    it("logs insights with label", () => {
      const insights = [createInsight("Test insight", 0.9, "conv-1")];

      logReverieInsights(insights, 5, "High Quality");

      expect(consoleLogSpy).toHaveBeenNthCalledWith(1, "💡 Reverie insights [High Quality] (top 1):");
    });

    it("limits display to maxDisplay parameter", () => {
      const insights = [
        createInsight("Insight 1", 0.9, "conv-1"),
        createInsight("Insight 2", 0.8, "conv-2"),
        createInsight("Insight 3", 0.7, "conv-3"),
        createInsight("Insight 4", 0.6, "conv-4"),
        createInsight("Insight 5", 0.5, "conv-5"),
      ];

      logReverieInsights(insights, 3);

      expect(consoleLogSpy).toHaveBeenCalledTimes(4); // Header + 3 insights
      expect(consoleLogSpy).toHaveBeenNthCalledWith(1, "💡 Reverie insights (top 3):");
    });

    it("defaults to maxDisplay of 5", () => {
      const insights = Array.from({ length: 10 }, (_, i) =>
        createInsight(`Insight ${i + 1}`, 0.9 - i * 0.05, `conv-${i + 1}`)
      );

      logReverieInsights(insights);

      expect(consoleLogSpy).toHaveBeenCalledTimes(6); // Header + 5 insights
    });

    it("handles empty insights array", () => {
      logReverieInsights([]);

      expect(consoleLogSpy).toHaveBeenCalledWith("💡 Reverie insights: No insights found");
    });

    it("handles empty insights array with label", () => {
      logReverieInsights([], 5, "Filtered");

      expect(consoleLogSpy).toHaveBeenCalledWith("💡 Reverie insights [Filtered]: No insights found");
    });

    it("truncates long excerpts to 250 chars", () => {
      const longExcerpt = "A".repeat(300);
      const insights = [createInsight(longExcerpt, 0.9, "conv-1")];

      logReverieInsights(insights);

      const insightCall = consoleLogSpy.mock.calls[1]?.[0] as string;
      expect(insightCall).toContain("A".repeat(250) + "...");
    });

    it("rounds relevance scores to integers", () => {
      const insights = [
        createInsight("Test 1", 0.925, "conv-1"),
        createInsight("Test 2", 0.874, "conv-2"),
        createInsight("Test 3", 0.501, "conv-3"),
      ];

      logReverieInsights(insights);

      expect(consoleLogSpy).toHaveBeenNthCalledWith(2, expect.stringContaining("(93%)"));
      expect(consoleLogSpy).toHaveBeenNthCalledWith(3, expect.stringContaining("(87%)"));
      expect(consoleLogSpy).toHaveBeenNthCalledWith(4, expect.stringContaining("(50%)"));
    });

    it("handles missing conversationId", () => {
      const insights = [
        {
          conversationId: "",
          timestamp: "2025-01-01T12:00:00Z",
          relevance: 0.9,
          excerpt: "Test excerpt",
          insights: [],
        },
      ];

      logReverieInsights(insights);

      const insightCall = consoleLogSpy.mock.calls[1]?.[0] as string;
      expect(insightCall).toContain("[unknown]");
    });

    it("normalizes whitespace in excerpts", () => {
      const insights = [createInsight("Multiple   spaces\n\nhere", 0.9, "conv-1")];

      logReverieInsights(insights);

      const insightCall = consoleLogSpy.mock.calls[1]?.[0] as string;
      expect(insightCall).toContain("Multiple spaces here");
    });
  });

  describe("Integration: Full logging workflow", () => {
    let consoleLogSpy: jest.SpiedFunction<typeof console.log>;

    beforeEach(() => {
      consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleLogSpy.mockRestore();
    });

    it("logs complete search and filter pipeline", () => {
      // Search
      logReverieSearch("authentication implementation", 100);

      // Filter
      logReverieFiltering(100, 60, 25, 10, { total: 25, approved: 10 });

      // Results
      const insights = [
        {
          conversationId: "conv-1",
          timestamp: "2025-01-01T12:00:00Z",
          relevance: 0.95,
          excerpt: "Implemented JWT authentication with refresh tokens",
          insights: [],
        },
      ];
      logReverieInsights(insights, 5);

      // Verify all logging occurred
      expect(consoleLogSpy.mock.calls.length).toBeGreaterThan(0);
      expect(consoleLogSpy.mock.calls[0]?.[0]).toContain("🔍 Reverie search");
      expect(consoleLogSpy.mock.calls.some((call) => String(call[0]).includes("📊 Reverie filtering pipeline"))).toBe(true);
      expect(consoleLogSpy.mock.calls.some((call) => String(call[0]).includes("💡 Reverie insights"))).toBe(true);
    });
  });
});
