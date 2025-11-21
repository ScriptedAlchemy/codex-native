import { describe, it, expect } from "@jest/globals";
import { deduplicateReverieInsights, isValidReverieExcerpt } from "../../src/reverie/quality";
import type { ReverieInsight } from "../../src/reverie/quality";

describe("isValidReverieExcerpt", () => {
  it("accepts technical implementation details", () => {
    const excerpt = "Fixed authentication timeout by adding exponential backoff with max retry of 3 attempts";
    expect(isValidReverieExcerpt(excerpt)).toBe(true);
  });

  it("accepts code-oriented sentences", () => {
    const excerpt = "Updated parser.ts to short-circuit when token.type === 'IDENTIFIER' to avoid extra recursion";
    expect(isValidReverieExcerpt(excerpt)).toBe(true);
  });

  it("rejects short snippets", () => {
    expect(isValidReverieExcerpt("too short" as any)).toBe(false);
    expect(isValidReverieExcerpt("   ")).toBe(false);
  });

  it("rejects heading-style system prompts", () => {
    const excerpt = "# AGENTS.md instructions for the current task require careful analysis";
    expect(isValidReverieExcerpt(excerpt)).toBe(false);
  });

  it("rejects environment context blocks", () => {
    const excerpt = "<environment_context>Working directory: /home/user/project</environment_context>";
    expect(isValidReverieExcerpt(excerpt)).toBe(false);
  });

  it("rejects tool output summaries", () => {
    const excerpt = "Tool output: Successfully executed command with exit code 0";
    expect(isValidReverieExcerpt(excerpt)).toBe(false);
  });

  it("rejects metadata heavy lines with underscores", () => {
    const excerpt = "sandbox_mode is set to workspace-write while network_access remains disabled";
    expect(isValidReverieExcerpt(excerpt)).toBe(false);
  });

  it("rejects title-case orchestration blurbs", () => {
    const excerpt = "CI Fix Orchestrator coordinates worker agents when pipelines fail";
    expect(isValidReverieExcerpt(excerpt)).toBe(false);
  });

  it("rejects JSON-like blobs", () => {
    const excerpt = '{"file": "src/index.ts", "status": "modified"}';
    expect(isValidReverieExcerpt(excerpt)).toBe(false);
  });

  it("rejects XML/HTML heavy content", () => {
    const excerpt = "<div><span><p>Content</p></span><a>Link</a></div>";
    expect(isValidReverieExcerpt(excerpt)).toBe(false);
  });

  it("rejects progress percentage endings", () => {
    const excerpt = "This is a completion status message that ends with (89%)";
    expect(isValidReverieExcerpt(excerpt)).toBe(false);
  });

  it("accepts excerpts describing architecture tradeoffs", () => {
    const excerpt = "Chose PostgreSQL over MongoDB for this feature because we need strong consistency guarantees";
    expect(isValidReverieExcerpt(excerpt)).toBe(true);
  });

  it("handles boundary values", () => {
    const exactTwenty = "12345678901234567890";
    expect(exactTwenty.length).toBe(20);
    expect(isValidReverieExcerpt(exactTwenty)).toBe(true);
  });
});

describe("deduplicateReverieInsights", () => {
  const createInsight = (
    excerpt: string,
    relevance: number,
    conversationId = "conv-1"
  ): ReverieInsight => ({
    conversationId,
    timestamp: "2025-01-01T12:00:00Z",
    relevance,
    excerpt,
    insights: [],
  });

  it("keeps unique excerpts", () => {
    const insights = [
      createInsight("First unique insight about authentication", 0.9, "conv-1"),
      createInsight("Second unique insight about validation", 0.8, "conv-2"),
    ];

    const result = deduplicateReverieInsights(insights);
    expect(result).toHaveLength(2);
    expect(result[0]?.conversationId).toBe("conv-1");
  });

  it("keeps the highest relevance for duplicates", () => {
    const excerpt = "Duplicate insight with varying relevance scores";
    const insights = [
      createInsight(excerpt, 0.7, "conv-low"),
      createInsight(excerpt, 0.95, "conv-high"),
      createInsight(excerpt, 0.8, "conv-mid"),
    ];

    const result = deduplicateReverieInsights(insights);
    expect(result).toHaveLength(1);
    expect(result[0]?.conversationId).toBe("conv-high");
    expect(result[0]?.relevance).toBeCloseTo(0.95);
  });

  it("treats whitespace variations as duplicates", () => {
    const insights = [
      createInsight("This   has   multiple   spaces", 0.9),
      createInsight("This has multiple spaces", 0.8),
      createInsight("This\nhas\nmultiple\nspaces", 0.7),
    ];

    const result = deduplicateReverieInsights(insights);
    expect(result).toHaveLength(1);
  });

  it("only compares first 100 characters for fingerprints", () => {
    const prefix = "A".repeat(100);
    const insights = [
      createInsight(prefix + " different ending 1", 0.9),
      createInsight(prefix + " different ending 2", 0.8),
      createInsight(prefix + " different ending 3", 0.7),
    ];

    const result = deduplicateReverieInsights(insights);
    expect(result).toHaveLength(1);
  });

  it("handles empty and single-item collections", () => {
    expect(deduplicateReverieInsights([])).toEqual([]);
    const single = [createInsight("Single insight", 0.9)];
    expect(deduplicateReverieInsights(single)).toEqual(single);
  });
});
