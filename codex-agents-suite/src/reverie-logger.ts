import type { ReverieResult } from "./types.js";

/**
 * Truncates text to a maximum length, normalizing whitespace and adding ellipsis if needed.
 *
 * This utility is essential for keeping log output readable when dealing with
 * potentially long excerpts from conversation history. It:
 * - Collapses multiple whitespace characters into single spaces
 * - Trims leading/trailing whitespace
 * - Adds "..." suffix when text exceeds maxLength
 * - Handles edge cases (empty strings, null/undefined)
 *
 * @param text - The text to truncate
 * @param maxLength - Maximum length before truncation (must be positive)
 * @returns Truncated and normalized text
 *
 * @example
 * truncateText("Hello    world\n\nfoo", 10) // "Hello wor..."
 * truncateText("short", 100) // "short"
 * truncateText("", 10) // ""
 */
export function truncateText(text: string, maxLength: number): string {
  // Handle edge cases
  if (!text || maxLength <= 0) {
    return "";
  }

  // Normalize whitespace: replace multiple spaces/newlines with single space
  const normalized = text.replace(/\s+/g, " ").trim();

  // Truncate with ellipsis if needed
  if (normalized.length > maxLength) {
    return `${normalized.slice(0, maxLength)}...`;
  }

  return normalized;
}

/**
 * Logs a reverie search operation with clear, emoji-enhanced output.
 *
 * Provides transparency into what's being searched for and how many
 * candidates were found. This helps developers understand the reverie
 * system's behavior and debug semantic search issues.
 *
 * @param context - The search query or context being searched
 * @param count - Number of candidate results found
 * @param label - Optional label for the search operation (e.g., "Initial", "Filtered")
 *
 * @example
 * logReverieSearch("implement authentication", 42)
 * // Output: 🔍 Reverie search: "implement authentication" → 42 candidates
 *
 * logReverieSearch("fix bug in parser.ts", 5, "Final")
 * // Output: 🔍 Reverie search [Final]: "fix bug in parser.ts" → 5 candidates
 */
export function logReverieSearch(context: string, count: number, label?: string): void {
  const prefix = label ? `🔍 Reverie search [${label}]` : "🔍 Reverie search";
  const truncatedContext = truncateText(context, 80);
  console.log(`${prefix}: "${truncatedContext}" → ${count} candidates`);
}

/**
 * Logs the complete filtering pipeline for reverie results with detailed statistics.
 *
 * This function provides full transparency into how reverie results are filtered
 * through multiple stages:
 * 1. Initial semantic search results
 * 2. Basic quality filtering (duplicates, boilerplate)
 * 3. High-quality subset (score thresholds)
 * 4. Final results after optional LLM grading
 *
 * The acceptance rate helps identify if filtering is too aggressive or too lenient.
 * LLM grading statistics (when provided) show how many high-scoring results were
 * validated as truly relevant.
 *
 * @param total - Initial number of semantic search results
 * @param basicFiltered - Count after basic quality filtering
 * @param highQuality - Count of high-quality results (score >= threshold)
 * @param final - Final count after all filtering
 * @param llmGraded - Optional LLM grading stats { total: number, approved: number }
 *
 * @example
 * // Without LLM grading
 * logReverieFiltering(80, 45, 12, 10)
 * // Output:
 * // 📊 Reverie filtering pipeline:
 * //    80 initial → 45 basic filtered → 12 high quality → 10 final
 * //    Acceptance rate: 12.5% (10/80)
 *
 * @example
 * // With LLM grading
 * logReverieFiltering(80, 45, 12, 8, { total: 12, approved: 8 })
 * // Output:
 * // 📊 Reverie filtering pipeline:
 * //    80 initial → 45 basic filtered → 12 high quality → 8 final
 * //    Acceptance rate: 10.0% (8/80)
 * //    🤖 LLM grading: 8/12 approved (66.7%)
 */
export function logReverieFiltering(
  total: number,
  basicFiltered: number,
  highQuality: number,
  final: number,
  llmGraded?: { total: number; approved: number },
): void {
  console.log("📊 Reverie filtering pipeline:");
  console.log(`   ${total} initial → ${basicFiltered} basic filtered → ${highQuality} high quality → ${final} final`);

  // Calculate acceptance rate
  const acceptanceRate = total > 0 ? ((final / total) * 100).toFixed(1) : "0.0";
  console.log(`   Acceptance rate: ${acceptanceRate}% (${final}/${total})`);

  // Show LLM grading stats if provided
  if (llmGraded && llmGraded.total > 0) {
    const gradeRate = ((llmGraded.approved / llmGraded.total) * 100).toFixed(1);
    console.log(`   🤖 LLM grading: ${llmGraded.approved}/${llmGraded.total} approved (${gradeRate}%)`);
  }
}

/**
 * Logs reverie insights with relevance scores, excerpts, and conversation IDs.
 *
 * This function displays the top N most relevant insights in a readable format,
 * helping developers understand what context is being injected into the conversation.
 * Each insight shows:
 * - Relevance score (as percentage)
 * - Truncated excerpt (250 chars by default)
 * - Conversation ID (for traceability)
 *
 * Handles empty results gracefully with a clear "no insights found" message.
 *
 * @param insights - Array of reverie results to display
 * @param maxDisplay - Maximum number of insights to display (default: 5)
 * @param label - Optional label for the insights (e.g., "Top Matches", "Filtered Results")
 *
 * @example
 * // With results
 * logReverieInsights([
 *   { relevance: 0.92, excerpt: "Added JWT auth...", conversationId: "abc123", ... },
 *   { relevance: 0.85, excerpt: "Fixed parser bug...", conversationId: "def456", ... }
 * ])
 * // Output:
 * // 💡 Reverie insights (top 2):
 * //    #1 (92%) Added JWT auth... [abc123]
 * //    #2 (85%) Fixed parser bug... [def456]
 *
 * @example
 * // Empty results
 * logReverieInsights([])
 * // Output:
 * // 💡 Reverie insights: No insights found
 *
 * @example
 * // With label and custom limit
 * logReverieInsights(insights, 3, "High Quality")
 * // Output:
 * // 💡 Reverie insights [High Quality] (top 3):
 * //    #1 (95%) ...
 * //    #2 (88%) ...
 * //    #3 (82%) ...
 */
export function logReverieInsights(
  insights: ReverieResult[],
  maxDisplay: number = 5,
  label?: string,
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
    const score = Math.round(insight.relevance * 100);
    const truncatedExcerpt = truncateText(insight.excerpt, 250);
    const conversationId = insight.conversationId || "unknown";

    console.log(`   #${i + 1} (${score}%) ${truncatedExcerpt} [${conversationId}]`);
  }
}
