/**
 * Reverie logging utilities.
 * Provides transparent logging for reverie search and filtering operations.
 */

import type { ReverieResult } from "./quality.js";
import type { ReverieSearchLevel } from "./types.js";
import type { ReveriePipelineResult } from "./pipeline.js";

/**
 * Logs reverie search operation details.
 *
 * @param query - The search query
 * @param context - Optional context about the search
 */
export function logReverieSearch(query: string, context?: string): void {
  const contextStr = context ? ` (${context})` : "";
  console.log(`🔍 Reverie search${contextStr}: "${query}"`);
}

/**
 * Logs reverie filtering pipeline statistics.
 *
 * @param stats - Filtering statistics
 */
export function logReverieFiltering(stats: {
  total: number;
  afterQuality: number;
  afterBoilerplate?: number;
  afterScore: number;
  afterDedup: number;
  minScore?: number;
}): void {
  const { total, afterQuality, afterBoilerplate, afterScore, afterDedup, minScore = 0.7 } = stats;
  const qualityFiltered = total - afterQuality;
  const boilerplateStage = (afterBoilerplate ?? afterQuality);
  const boilerplateFiltered = afterQuality - boilerplateStage;
  const scoreFiltered = boilerplateStage - afterScore;
  const duplicatesFiltered = afterScore - afterDedup;

  console.log(
    `📊 Reverie filtering: ${total} raw → ${afterQuality} valid → ${boilerplateStage} conversational → ${afterScore} high-scoring (≥${minScore}) → ${afterDedup} unique` +
    ` (filtered: ${qualityFiltered} low-quality, ${boilerplateFiltered} boilerplate, ${scoreFiltered} low-score, ${duplicatesFiltered} duplicates)`
  );
}

/**
 * Logs top reverie insights for debugging.
 *
 * @param insights - Filtered reverie insights
 * @param limit - Maximum number of insights to log (default: 3)
 */
export function logReverieInsights(insights: ReverieResult[], limit: number = 3): void {
  if (insights.length === 0) {
    console.log("📭 No reverie insights found");
    return;
  }

  console.log(`✨ Top ${Math.min(limit, insights.length)} reverie insights:`);
  const topInsights = insights.slice(0, limit);

  for (let i = 0; i < topInsights.length; i++) {
    const insight = topInsights[i];
    if (!insight) continue;
    const score = `${Math.round(insight.relevance * 100)}%`;
    const excerpt = truncate(insight.excerpt, 150);
    const insightText = insight.insights.length > 0 ? truncate(insight.insights[0] ?? "", 100) : "";

    console.log(`  ${i + 1}. [${score}] ${excerpt}`);
    if (insightText) {
      console.log(`     → ${insightText}`);
    }
  }
}

/**
 * Logs quality filtering statistics for hint collection.
 *
 * @param stats - Hint collection statistics
 */
export function logReverieHintQuality(stats: {
  totalRaw: number;
  afterQuality: number;
  afterDedup: number;
}): void {
  const { totalRaw, afterQuality, afterDedup } = stats;
  const qualityFiltered = totalRaw - afterQuality;
  const duplicatesFiltered = afterQuality - afterDedup;

  if (totalRaw > 0) {
    console.log(
      `🪄 Reverie hint quality: ${totalRaw} raw → ${afterQuality} valid → ${afterDedup} unique ` +
      `(filtered ${qualityFiltered} low-quality, ${duplicatesFiltered} duplicates)`
    );
  }
}

/**
 * Logs LLM grading statistics showing approved vs rejected counts.
 *
 * @param stats - LLM grading statistics
 */
export function logLLMGrading(stats: {
  total: number;
  approved: number;
  rejected: number;
  minScore?: number;
}): void {
  const { total, approved, rejected, minScore = 0.7 } = stats;
  const approvalRate = total > 0 ? Math.round((approved / total) * 100) : 0;

  console.log(
    `🤖 LLM grading: ${approved}/${total} approved (${approvalRate}%) ` +
    `[high-scoring ≥${minScore}, rejected ${rejected}]`
  );
}

/**
 * Logs approved reverie excerpts with relevance scores (verbose mode).
 *
 * @param insights - Approved reverie insights to log
 * @param maxToShow - Maximum number of insights to display (default: 5)
 */
export function logApprovedReveries(insights: ReverieResult[], maxToShow: number = 5): void {
  if (insights.length === 0) {
    console.log("  No reveries passed LLM grading");
    return;
  }

  console.log(`  ${insights.length} reveries approved by LLM:`);
  const toShow = insights.slice(0, maxToShow);

  for (let i = 0; i < toShow.length; i++) {
    const insight = toShow[i];
    if (!insight) continue;
    const score = insight.relevance.toFixed(2);
    const preview = truncate(insight.excerpt.replace(/\s+/g, " ").trim(), 200);
    const insightText = insight.insights[0] || "Context from past work";

    console.log(`    ${i + 1}. [${score}] ${insightText}`);
    console.log(`       "${preview}"`);
  }

  if (insights.length > maxToShow) {
    console.log(`  ... and ${insights.length - maxToShow} more`);
  }
}

/**
 * Truncates a string to a maximum length, adding ellipsis if needed.
 */
function truncate(text: string, maxLength: number): string {
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/**
 * Exports truncateText for external use.
 */
export { truncate as truncateText };

/**
 * Logs multi-level search initiation.
 *
 * @param levels - Array of search levels being executed
 *
 * @example
 * ```typescript
 * logMultiLevelSearch(['project', 'branch', 'file']);
 * // Output: "🔍 Multi-level reverie search: project → branch → file"
 * ```
 */
export function logMultiLevelSearch(levels: ReverieSearchLevel[]): void {
  if (levels.length === 0) {
    console.log("🔍 Multi-level reverie search: (no levels specified)");
    return;
  }

  const levelIcons: Record<ReverieSearchLevel, string> = {
    project: '🌐',
    branch: '🌿',
    file: '📄',
  };

  const levelLabels = levels.map(level => `${levelIcons[level]} ${level}`).join(' → ');
  console.log(`🔍 Multi-level reverie search: ${levelLabels}`);
}

/**
 * Logs results for a specific search level.
 *
 * @param level - The search level
 * @param result - Pipeline result for this level
 *
 * @example
 * ```typescript
 * logLevelResults('project', {
 *   insights: [...],
 *   stats: { total: 50, final: 8, ... }
 * });
 * // Output: "  🌐 Project level: 8 insights (50 → 8, 84% filtered)"
 * ```
 */
export function logLevelResults(level: ReverieSearchLevel, result: ReveriePipelineResult): void {
  const levelIcons: Record<ReverieSearchLevel, string> = {
    project: '🌐',
    branch: '🌿',
    file: '📄',
  };

  const icon = levelIcons[level];
  const { stats, insights } = result;
  const filterRate = stats.total > 0
    ? Math.round(((stats.total - stats.final) / stats.total) * 100)
    : 0;

  const levelName = level.charAt(0).toUpperCase() + level.slice(1);
  console.log(
    `  ${icon} ${levelName} level: ${insights.length} insights ` +
    `(${stats.total} → ${stats.final}, ${filterRate}% filtered)`
  );

  // Log quality breakdown if verbose
  if (stats.total > 0) {
    const qualityFiltered = stats.total - stats.afterQuality;
    const scoreFiltered = stats.afterQuality - stats.afterScore;
    const dedupFiltered = stats.afterScore - (stats.afterDedup || stats.afterScore);

    if (qualityFiltered > 0 || scoreFiltered > 0 || dedupFiltered > 0) {
      console.log(
        `    ↳ Quality: -${qualityFiltered}, Score: -${scoreFiltered}, Dedup: -${dedupFiltered}`
      );
    }
  }
}

/**
 * Logs a summary of multi-level search results.
 *
 * @param results - Map of level to pipeline results
 *
 * @example
 * ```typescript
 * const results = new Map([
 *   ['project', { insights: [...], stats: {...} }],
 *   ['branch', { insights: [...], stats: {...} }],
 *   ['file', { insights: [...], stats: {...} }]
 * ]);
 *
 * logMultiLevelSummary(results);
 * // Output summary of all levels with total counts
 * ```
 */
export function logMultiLevelSummary(
  results: Map<ReverieSearchLevel, ReveriePipelineResult>
): void {
  const totalInsights = Array.from(results.values())
    .reduce((sum, result) => sum + result.insights.length, 0);

  const totalProcessed = Array.from(results.values())
    .reduce((sum, result) => sum + result.stats.total, 0);

  console.log(
    `\n✨ Multi-level search complete: ${totalInsights} total insights ` +
    `(processed ${totalProcessed} candidates across ${results.size} levels)`
  );

  // Show breakdown by level
  const levelCounts: string[] = [];
  for (const [level, result] of results) {
    levelCounts.push(`${level}: ${result.insights.length}`);
  }
  console.log(`   Breakdown: ${levelCounts.join(', ')}`);
}
