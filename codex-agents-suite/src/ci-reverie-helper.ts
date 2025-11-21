import type { ReverieResult } from "./types.js";
import type { CiIssue } from "./schemas.js";
import type { ReverieSystem } from "./reverie.js";
import { isValidReverieExcerpt, deduplicateReverieInsights } from "./reverie-quality.js";

/**
 * CI-specific reverie operations for searching past experiences with similar CI failures.
 */

/**
 * Truncates text to a maximum length, adding ellipsis if needed.
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + "...";
}

/**
 * Logs reverie search operation.
 */
function logReverieSearch(query: string, limit: number, maxCandidates: number): void {
  console.log(`\n🔍 Searching reveries for CI failure:`);
  console.log(`   Query: ${truncateText(query, 120)}`);
  console.log(`   Limit: ${limit}, MaxCandidates: ${maxCandidates}`);
}

/**
 * Logs reverie filtering statistics.
 */
function logReverieFiltering(totalFound: number, afterQuality: number, afterRelevance: number, afterDedup: number): void {
  console.log(`\n📊 Reverie filtering:`);
  console.log(`   ${totalFound} found → ${afterQuality} valid → ${afterRelevance} relevant → ${afterDedup} unique`);
  if (totalFound > 0) {
    const qualityFiltered = totalFound - afterQuality;
    const relevanceFiltered = afterQuality - afterRelevance;
    const dupFiltered = afterRelevance - afterDedup;
    if (qualityFiltered > 0) console.log(`   Filtered ${qualityFiltered} low-quality excerpts`);
    if (relevanceFiltered > 0) console.log(`   Filtered ${relevanceFiltered} low-relevance results`);
    if (dupFiltered > 0) console.log(`   Filtered ${dupFiltered} duplicates`);
  }
}

/**
 * Logs discovered reverie insights.
 */
function logReverieInsights(reveries: ReverieResult[]): void {
  if (reveries.length === 0) {
    console.log(`\n💡 No relevant past experiences found`);
    return;
  }
  console.log(`\n💡 Found ${reveries.length} relevant past experience(s):`);
  reveries.forEach((rev, idx) => {
    const relevancePct = Math.round(rev.relevance * 100);
    const preview = truncateText(rev.excerpt, 80);
    console.log(`   #${idx + 1} (${relevancePct}%) ${preview}`);
  });
}

/**
 * Builds a context-rich query from CI failure details.
 *
 * @param failure - The CI failure/issue to build a query for
 * @returns A query string combining all relevant failure information
 */
export function buildFailureQuery(failure: CiIssue): string {
  const parts: string[] = [];

  // Add source and severity context
  if (failure.source) {
    parts.push(`${failure.source} failure`);
  }

  // Add title (most important)
  if (failure.title) {
    parts.push(failure.title);
  }

  // Add summary for more context
  if (failure.summary) {
    parts.push(failure.summary);
  }

  // Add affected files context
  if (failure.files && failure.files.length > 0) {
    const filesStr = failure.files.slice(0, 3).join(", ");
    parts.push(`Files: ${filesStr}`);
  }

  // Add suggested commands if available
  if (failure.suggestedCommands && failure.suggestedCommands.length > 0) {
    const commandsStr = failure.suggestedCommands.slice(0, 2).join(", ");
    parts.push(`Commands: ${commandsStr}`);
  }

  // Filter out empty parts and join
  return parts.filter(p => p.trim().length > 0).join(" | ");
}

/**
 * Searches for relevant reveries (past experiences) related to a CI failure.
 *
 * @param reverie - The reverie system instance
 * @param failure - The CI failure/issue to search for
 * @param repoPath - Repository path for context
 * @returns Filtered and deduplicated reverie results
 */
export async function searchReveriesForFailure(
  reverie: ReverieSystem,
  failure: CiIssue,
  repoPath: string,
): Promise<ReverieResult[]> {
  // Build context-rich query
  const query = buildFailureQuery(failure);

  // Log search operation
  logReverieSearch(query, 10, 100);

  // Search reveries
  const rawResults = await reverie.searchReveriesFromText(query, {
    limit: 10,
    maxCandidates: 100,
  });

  const totalFound = rawResults.length;

  // Apply quality filtering (filter out boilerplate, system prompts, etc.)
  const qualityFiltered = rawResults.filter(result =>
    isValidReverieExcerpt(result.excerpt)
  );
  const afterQuality = qualityFiltered.length;

  // Filter by relevance (slightly lower threshold for CI: 0.65 instead of 0.70)
  const relevanceFiltered = qualityFiltered.filter(result =>
    result.relevance >= 0.65
  );
  const afterRelevance = relevanceFiltered.length;

  // Deduplicate similar insights
  const deduplicated = deduplicateReverieInsights(relevanceFiltered);
  const afterDedup = deduplicated.length;

  // Log filtering statistics
  logReverieFiltering(totalFound, afterQuality, afterRelevance, afterDedup);

  // Log discovered insights
  logReverieInsights(deduplicated);

  return deduplicated;
}

/**
 * Formats reveries for injection into agent prompt.
 *
 * @param reveries - The reverie results to format
 * @returns Formatted string ready for agent consumption
 */
export function formatReveriesForAgent(reveries: ReverieResult[]): string {
  if (reveries.length === 0) {
    return "";
  }

  const header = "📚 Past experience with similar failures:";
  const lines = reveries.map((rev, idx) => {
    const relevancePct = Math.round(rev.relevance * 100);
    const excerpt = truncateText(rev.excerpt, 300);
    const timestamp = new Date(rev.timestamp).toLocaleString();

    let result = `\n${idx + 1}. (${relevancePct}% relevant) ${excerpt}`;

    // Add insights if available
    if (rev.insights && rev.insights.length > 0) {
      const insightsStr = rev.insights
        .map(insight => `   - ${truncateText(insight, 200)}`)
        .join("\n");
      result += `\n${insightsStr}`;
    }

    result += `\n   (From: ${timestamp})`;

    return result;
  });

  return `${header}\n${lines.join("\n\n")}`;
}
