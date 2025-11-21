import test from "node:test";
import assert from "node:assert/strict";
import { isValidReverieExcerpt, deduplicateReverieInsights } from "../src/reverie-quality.js";
import type { ReverieResult } from "../src/types.js";

// ============================================================================
// isValidReverieExcerpt tests
// ============================================================================

test("isValidReverieExcerpt: accepts valid technical content", () => {
  const validExcerpts = [
    "Fixed the authentication bug by updating the JWT validation logic",
    "The database migration script needs to run with --force flag to override existing schema",
    "Implemented rate limiting using Redis to prevent API abuse and ensure system stability",
    "Refactored the component hierarchy to improve rendering performance by 40%",
    "Added comprehensive error handling for edge cases in the payment processing flow",
  ];

  for (const excerpt of validExcerpts) {
    assert.equal(
      isValidReverieExcerpt(excerpt),
      true,
      `Expected valid excerpt to pass: "${excerpt.slice(0, 50)}..."`,
    );
  }
});

test("isValidReverieExcerpt: rejects excerpts shorter than 20 characters", () => {
  const shortExcerpts = [
    "",
    "short",
    "too brief",
    "less than twenty",
    "19 character text!",
  ];

  for (const excerpt of shortExcerpts) {
    assert.equal(
      isValidReverieExcerpt(excerpt),
      false,
      `Expected short excerpt to fail: "${excerpt}"`,
    );
  }
});

test("isValidReverieExcerpt: rejects boilerplate system prompts", () => {
  const boilerplateExcerpts = [
    "# AGENTS.md instructions for this workspace",
    "AGENTS.md instructions for the multi-agent orchestrator system",
    "<INSTRUCTIONS>Follow these guidelines carefully</INSTRUCTIONS>",
    "<environment_context>Current working directory is /home/user</environment_context>",
    "<system>You are a helpful assistant</system>",
    "Sandbox env vars: CODEX_SANDBOX=true",
    "Tool output: Command executed successfully",
    "approval_policy: on-request for all shell commands",
    "sandbox_mode: workspace-write access enabled",
    "network_access: disabled in sandbox environment",
    "<cwd>/home/user/projects</cwd>",
    "</cwd> marker indicates end of directory",
    "CODEX_SAN is set to workspace-write mode",
    "# Codex Workspace Agent Guide for new contributors",
    "## Core Expectations for all agents in the system",
    "Crates in `codex-rs` use the `codex-` prefix for naming convention",
    "Install repo helpers to get started with development",
    "CI Fix Orchestrator detected test failures",
    "CI Remediation Orchestrator is analyzing the build",
    "Branch Intent Analyst is reviewing the commit messages",
    "File Diff Inspector found significant changes",
    "You are coordinating an automated workflow process",
    "Respond strictly with JSON format for all responses",
    "Judge whether each change is appropriate for the context",
    "Multi-Agent Codex System architecture overview",
    "orchestrator pattern is used for complex workflows",
    "<claude_background_info>Claude 3 Opus is the most capable model</claude_background_info>",
    "</claude_background_info> closes the background section",
    "function_calls are used to invoke tools",
    "<invoke name='Bash'>Execute command</invoke>",
  ];

  for (const excerpt of boilerplateExcerpts) {
    assert.equal(
      isValidReverieExcerpt(excerpt),
      false,
      `Expected boilerplate to fail: "${excerpt.slice(0, 50)}..."`,
    );
  }
});

test("isValidReverieExcerpt: rejects JSON objects", () => {
  const jsonExcerpts = [
    '{"file": "src/index.ts", "line": 42}',
    '{"file": "package.json", "changes": ["updated version"]}',
    '{ "file": "config.json", "status": "modified" }',
  ];

  for (const excerpt of jsonExcerpts) {
    assert.equal(
      isValidReverieExcerpt(excerpt),
      false,
      `Expected JSON object to fail: "${excerpt}"`,
    );
  }
});

test("isValidReverieExcerpt: rejects excerpts with excessive XML/HTML tags", () => {
  const tagHeavyExcerpts = [
    "<div><span><p><a href='test'>Link</a></p></span></div>",
    "<invoke name='Read'><parameter name='file'>test.ts</parameter></invoke>",
    "<system><user><assistant><message>Content</message></assistant></user></system>",
    "<environment><context><working_dir>/home/user</working_dir></context></environment>",
  ];

  for (const excerpt of tagHeavyExcerpts) {
    assert.equal(
      isValidReverieExcerpt(excerpt),
      false,
      `Expected tag-heavy excerpt to fail: "${excerpt.slice(0, 50)}..."`,
    );
  }
});

test("isValidReverieExcerpt: accepts excerpts with minimal tags", () => {
  const excerpts = [
    "The <code>validateUser</code> function handles authentication properly",
    "Use <strong>caution</strong> when modifying the database schema directly",
    "The <title> element should be set appropriately in HTML documents",
  ];

  for (const excerpt of excerpts) {
    assert.equal(
      isValidReverieExcerpt(excerpt),
      true,
      `Expected excerpt with few tags to pass: "${excerpt.slice(0, 50)}..."`,
    );
  }
});

test("isValidReverieExcerpt: rejects excerpts with percentage indicators at end", () => {
  const percentageExcerpts = [
    "This is a long enough excerpt that ends with (89%)",
    "Build progress indicator showing completion (100%)",
    "Download status for large file transfer (42%)",
    "Processing batch operation status (130%)",
  ];

  for (const excerpt of percentageExcerpts) {
    assert.equal(
      isValidReverieExcerpt(excerpt),
      false,
      `Expected excerpt with percentage indicator to fail: "${excerpt}"`,
    );
  }
});

test("isValidReverieExcerpt: accepts excerpts with percentages in middle", () => {
  const excerpts = [
    "The test coverage increased by 15% after adding the new test suite",
    "Performance improved (50% faster) due to caching optimization strategy",
  ];

  for (const excerpt of excerpts) {
    assert.equal(
      isValidReverieExcerpt(excerpt),
      true,
      `Expected excerpt with mid-text percentage to pass: "${excerpt}"`,
    );
  }
});

test("isValidReverieExcerpt: handles edge cases with whitespace", () => {
  assert.equal(isValidReverieExcerpt("   "), false, "whitespace-only should fail");
  assert.equal(
    isValidReverieExcerpt("  \n\t  \n  "),
    false,
    "whitespace with newlines should fail",
  );
  assert.equal(
    isValidReverieExcerpt("  Valid content with leading and trailing spaces  "),
    true,
    "valid content with whitespace should pass",
  );
});

test("isValidReverieExcerpt: handles mixed case boilerplate detection", () => {
  const mixedCaseBoilerplate = [
    "# agents.md INSTRUCTIONS for workspace",
    "AGENTS.MD Instructions For Multi-Agent",
    "<ENVIRONMENT_CONTEXT>Working directory</ENVIRONMENT_CONTEXT>",
    "Sandbox ENV Vars: CODEX_SANDBOX=true",
  ];

  for (const excerpt of mixedCaseBoilerplate) {
    assert.equal(
      isValidReverieExcerpt(excerpt),
      false,
      `Expected mixed-case boilerplate to fail: "${excerpt}"`,
    );
  }
});

// ============================================================================
// deduplicateReverieInsights tests
// ============================================================================

test("deduplicateReverieInsights: removes exact duplicates", () => {
  const insights: ReverieResult[] = [
    {
      conversationId: "conv-1",
      timestamp: "2025-01-01T00:00:00Z",
      relevance: 0.9,
      excerpt: "Fix the authentication bug by updating JWT validation",
      insights: ["Update JWT validation"],
    },
    {
      conversationId: "conv-2",
      timestamp: "2025-01-01T01:00:00Z",
      relevance: 0.85,
      excerpt: "Fix the authentication bug by updating JWT validation",
      insights: ["Update JWT validation"],
    },
    {
      conversationId: "conv-3",
      timestamp: "2025-01-01T02:00:00Z",
      relevance: 0.8,
      excerpt: "Implement rate limiting for API endpoints",
      insights: ["Add Redis-based rate limiter"],
    },
  ];

  const result = deduplicateReverieInsights(insights);

  assert.equal(result.length, 2, "should remove exact duplicate");
  assert.equal(result[0].conversationId, "conv-1", "should keep first occurrence");
  assert.equal(result[1].conversationId, "conv-3", "should keep unique insight");
});

test("deduplicateReverieInsights: removes similar excerpts based on first 100 chars", () => {
  const insights: ReverieResult[] = [
    {
      conversationId: "conv-1",
      timestamp: "2025-01-01T00:00:00Z",
      relevance: 0.9,
      excerpt:
        "The database migration script needs to run with the --force flag to override existing constraints - this adds extra context A",
      insights: ["Run migration with --force"],
    },
    {
      conversationId: "conv-2",
      timestamp: "2025-01-01T01:00:00Z",
      relevance: 0.85,
      excerpt:
        "The database migration script needs to run with the --force flag to override existing constraints - this adds extra context B",
      insights: ["Use --force flag"],
    },
    {
      conversationId: "conv-3",
      timestamp: "2025-01-01T02:00:00Z",
      relevance: 0.8,
      excerpt: "Completely different insight about API optimization",
      insights: ["Optimize API calls"],
    },
  ];

  const result = deduplicateReverieInsights(insights);

  assert.equal(result.length, 2, "should remove similar excerpts");
  assert.equal(result[0].conversationId, "conv-1", "should keep first occurrence");
  assert.equal(result[1].conversationId, "conv-3", "should keep unique insight");
});

test("deduplicateReverieInsights: preserves unique insights", () => {
  const insights: ReverieResult[] = [
    {
      conversationId: "conv-1",
      timestamp: "2025-01-01T00:00:00Z",
      relevance: 0.9,
      excerpt: "Fix authentication bug with JWT",
      insights: ["Update JWT validation"],
    },
    {
      conversationId: "conv-2",
      timestamp: "2025-01-01T01:00:00Z",
      relevance: 0.85,
      excerpt: "Implement rate limiting",
      insights: ["Add Redis limiter"],
    },
    {
      conversationId: "conv-3",
      timestamp: "2025-01-01T02:00:00Z",
      relevance: 0.8,
      excerpt: "Optimize database queries",
      insights: ["Add proper indexing"],
    },
  ];

  const result = deduplicateReverieInsights(insights);

  assert.equal(result.length, 3, "should preserve all unique insights");
  assert.deepEqual(result, insights, "should return identical array");
});

test("deduplicateReverieInsights: handles empty array", () => {
  const insights: ReverieResult[] = [];
  const result = deduplicateReverieInsights(insights);

  assert.equal(result.length, 0, "should return empty array");
  assert.deepEqual(result, [], "should return empty array");
});

test("deduplicateReverieInsights: preserves order of first occurrence", () => {
  const insights: ReverieResult[] = [
    {
      conversationId: "conv-1",
      timestamp: "2025-01-01T00:00:00Z",
      relevance: 0.9,
      excerpt: "First unique insight",
      insights: ["Insight 1"],
    },
    {
      conversationId: "conv-2",
      timestamp: "2025-01-01T01:00:00Z",
      relevance: 0.85,
      excerpt: "Second unique insight",
      insights: ["Insight 2"],
    },
    {
      conversationId: "conv-3",
      timestamp: "2025-01-01T02:00:00Z",
      relevance: 0.8,
      excerpt: "First unique insight",
      insights: ["Insight 1"],
    },
    {
      conversationId: "conv-4",
      timestamp: "2025-01-01T03:00:00Z",
      relevance: 0.75,
      excerpt: "Third unique insight",
      insights: ["Insight 3"],
    },
  ];

  const result = deduplicateReverieInsights(insights);

  assert.equal(result.length, 3, "should keep three unique insights");
  assert.equal(result[0].conversationId, "conv-1", "first position preserved");
  assert.equal(result[1].conversationId, "conv-2", "second position preserved");
  assert.equal(result[2].conversationId, "conv-4", "third unique at third position");
});

test("deduplicateReverieInsights: case insensitive fingerprinting", () => {
  const insights: ReverieResult[] = [
    {
      conversationId: "conv-1",
      timestamp: "2025-01-01T00:00:00Z",
      relevance: 0.9,
      excerpt: "Fix The Authentication Bug By Updating JWT Validation Logic",
      insights: ["Update JWT"],
    },
    {
      conversationId: "conv-2",
      timestamp: "2025-01-01T01:00:00Z",
      relevance: 0.85,
      excerpt: "fix the authentication bug by updating jwt validation logic",
      insights: ["Update JWT"],
    },
    {
      conversationId: "conv-3",
      timestamp: "2025-01-01T02:00:00Z",
      relevance: 0.8,
      excerpt: "FIX THE AUTHENTICATION BUG BY UPDATING JWT VALIDATION LOGIC",
      insights: ["Update JWT"],
    },
  ];

  const result = deduplicateReverieInsights(insights);

  assert.equal(result.length, 1, "should treat different cases as same excerpt");
  assert.equal(result[0].conversationId, "conv-1", "should keep first occurrence");
});

test("deduplicateReverieInsights: normalizes whitespace in fingerprinting", () => {
  const insights: ReverieResult[] = [
    {
      conversationId: "conv-1",
      timestamp: "2025-01-01T00:00:00Z",
      relevance: 0.9,
      excerpt: "Fix    the   authentication    bug",
      insights: ["Update JWT"],
    },
    {
      conversationId: "conv-2",
      timestamp: "2025-01-01T01:00:00Z",
      relevance: 0.85,
      excerpt: "Fix the authentication bug",
      insights: ["Update JWT"],
    },
    {
      conversationId: "conv-3",
      timestamp: "2025-01-01T02:00:00Z",
      relevance: 0.8,
      excerpt: "Fix\tthe\nauthentication\r\nbug",
      insights: ["Update JWT"],
    },
  ];

  const result = deduplicateReverieInsights(insights);

  assert.equal(result.length, 1, "should normalize whitespace differences");
  assert.equal(result[0].conversationId, "conv-1", "should keep first occurrence");
});

test("deduplicateReverieInsights: handles excerpts shorter than 100 chars", () => {
  const insights: ReverieResult[] = [
    {
      conversationId: "conv-1",
      timestamp: "2025-01-01T00:00:00Z",
      relevance: 0.9,
      excerpt: "Short insight about authentication",
      insights: ["Update JWT"],
    },
    {
      conversationId: "conv-2",
      timestamp: "2025-01-01T01:00:00Z",
      relevance: 0.85,
      excerpt: "Short insight about authentication",
      insights: ["Update JWT"],
    },
  ];

  const result = deduplicateReverieInsights(insights);

  assert.equal(result.length, 1, "should handle short excerpts correctly");
  assert.equal(result[0].conversationId, "conv-1", "should keep first occurrence");
});

test("deduplicateReverieInsights: differentiates after 100 char boundary", () => {
  const baseExcerpt =
    "This is a very long excerpt that will be used to test the 100 character fingerprint boundary feature";
  const insights: ReverieResult[] = [
    {
      conversationId: "conv-1",
      timestamp: "2025-01-01T00:00:00Z",
      relevance: 0.9,
      excerpt: baseExcerpt + " - with additional context A",
      insights: ["Insight A"],
    },
    {
      conversationId: "conv-2",
      timestamp: "2025-01-01T01:00:00Z",
      relevance: 0.85,
      excerpt: baseExcerpt + " - with additional context B",
      insights: ["Insight B"],
    },
  ];

  const result = deduplicateReverieInsights(insights);

  // Since first 100 chars are identical, should be treated as duplicate
  assert.equal(result.length, 1, "should treat as duplicate based on first 100 chars");
  assert.equal(result[0].conversationId, "conv-1", "should keep first occurrence");
});

test("deduplicateReverieInsights: handles single item array", () => {
  const insights: ReverieResult[] = [
    {
      conversationId: "conv-1",
      timestamp: "2025-01-01T00:00:00Z",
      relevance: 0.9,
      excerpt: "Single insight",
      insights: ["Only one"],
    },
  ];

  const result = deduplicateReverieInsights(insights);

  assert.equal(result.length, 1, "should preserve single item");
  assert.deepEqual(result, insights, "should return identical array");
});
