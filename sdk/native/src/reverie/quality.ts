/**
 * Reverie Quality Utilities
 *
 * Provides filtering, deduplication, and quality assessment for reverie search results.
 * Ensures that only meaningful conversation excerpts are surfaced to agents and users.
 */

/**
 * Represents a single reverie insight from past conversations.
 * This is a generic interface that can be extended with additional metadata.
 */
export interface ReverieInsight {
  /** Unique identifier for the conversation */
  conversationId: string;
  /** ISO timestamp of when the conversation occurred */
  timestamp: string;
  /** Relevance score from semantic search (0-1) */
  relevance: number;
  /** Text excerpt from the conversation */
  excerpt: string;
  /** Extracted insights or key points from the excerpt */
  insights: string[];
}

/**
 * Type alias for reverie results (used for logging compatibility).
 */
export type ReverieResult = ReverieInsight;

/**
 * Statistics from the quality filtering pipeline.
 */
export interface QualityFilterStats {
  /** Number of insights before filtering */
  initial: number;
  /** Number after validity filtering */
  afterValidityFilter: number;
  /** Number after deduplication */
  afterDeduplication: number;
  /** Final number of insights */
  final: number;
}

/**
 * Validates whether a reverie excerpt contains meaningful content worth indexing.
 *
 * Filters out:
 * - Very short excerpts (< 20 chars)
 * - System prompts and boilerplate text
 * - Tool outputs and structured data
 * - Excerpts with excessive XML/HTML tags
 * - JSON objects and configuration snippets
 *
 * @param excerpt - The text excerpt to validate
 * @returns true if the excerpt contains meaningful content, false otherwise
 *
 * @example
 * ```typescript
 * const excerpt = "Let's refactor the auth module to use async/await";
 * isValidReverieExcerpt(excerpt); // true
 *
 * const systemPrompt = "<INSTRUCTIONS>You are a coding assistant</INSTRUCTIONS>";
 * isValidReverieExcerpt(systemPrompt); // false
 * ```
 */
export function isValidReverieExcerpt(excerpt: string): boolean {
  if (!excerpt || excerpt.trim().length < 20) {
    return false;
  }

  const trimmed = excerpt.trim();
  const normalized = trimmed.toLowerCase();
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const rawTokens = trimmed.split(/\s+/).filter(Boolean);
  const tokens = rawTokens.map((token) => token.toLowerCase());

  if (rawTokens.length === 0) {
    return false;
  }

  const uppercaseTokens = rawTokens.filter((token) => {
    const alphabetic = token.replace(/[^a-z]/gi, "");
    return alphabetic.length >= 3 && alphabetic === alphabetic.toUpperCase();
  });
  const uppercaseRatio = uppercaseTokens.length / rawTokens.length;

  const snakeTokens = rawTokens.filter((token) => token.includes("_"));
  const underscoreRatio = snakeTokens.length / rawTokens.length;

  const headingLines = lines.filter((line) => /^#{1,6}\s/.test(line));
  const bulletLines = lines.filter((line) => /^\s*[\-\*]\s/.test(line));
  const numericBulletLines = lines.filter((line) => /^\s*\d+[\).]/.test(line));
  const colonLabelLines = lines.filter((line) => /^[A-Za-z0-9 _-]{1,24}:/.test(line));

  const headingRatio = headingLines.length / Math.max(lines.length, 1);
  const bulletRatio = bulletLines.length / Math.max(lines.length, 1);
  const colonLabelRatio = colonLabelLines.length / Math.max(lines.length, 1);
  const numericRatio = numericBulletLines.length / Math.max(lines.length, 1);
  const enumeratedRatio = (bulletLines.length + numericBulletLines.length) / Math.max(lines.length, 1);

  const initialTitleCaseRun = (() => {
    let run = 0;
    for (const token of rawTokens) {
      const cleaned = token.replace(/[^a-z]/gi, "");
      if (cleaned.length === 0) {
        break;
      }
      const rest = cleaned.slice(1);
      const isTitleCase = cleaned[0]?.toUpperCase() === cleaned[0] && rest === rest.toLowerCase();
      const isAllCaps = cleaned.length >= 2 && cleaned === cleaned.toUpperCase();
      if (isTitleCase || isAllCaps) {
        run += 1;
      } else {
        break;
      }
    }
    return run;
  })();

  const tokenFrequencies = tokens.reduce((map, token) => map.set(token, (map.get(token) ?? 0) + 1), new Map<string, number>());
  const frequencyValues = Array.from(tokenFrequencies.values());
  const mostCommonTokenCount = Math.max(...frequencyValues);
  const repeatedWordRatio = mostCommonTokenCount / tokens.length;

  if (snakeTokens.length >= 2 && underscoreRatio > 0.15) {
    return false;
  }

  if (headingRatio > 0.6 && lines.length <= 4) {
    return false;
  }

  if (initialTitleCaseRun >= 3 && rawTokens.length <= 20) {
    return false;
  }

  if (enumeratedRatio > 0.6 && lines.length >= 3) {
    return false;
  }

  const metadataScore = [
    uppercaseRatio > 0.45,
    underscoreRatio > 0.2,
    bulletRatio > 0.7,
    colonLabelRatio > 0.6 || (lines.length <= 2 && colonLabelRatio > 0),
    initialTitleCaseRun >= 3,
    repeatedWordRatio > 0.45 && tokens.length > 15,
    rawTokens.length < 12 && colonLabelRatio > 0,
    numericRatio > 0.5,
  ].filter(Boolean).length;

  if (metadataScore >= 2) {
    return false;
  }

  const tagMatches = trimmed.match(/<[^>]+>/g) || [];
  if (tagMatches.length > 3) {
    return false;
  }

  const blockTagMatch = trimmed.match(/^<([a-z0-9_\-]+)>[\s\S]*<\/\1>$/i);
  if (blockTagMatch) {
    const tagName = blockTagMatch[1]?.toLowerCase() ?? "";
    const looksLikeSystem = tagName.includes("system") || tagName.includes("context") || tagName.includes("env");
    if (tagName.includes("_") || looksLikeSystem) {
      return false;
    }
  }

  if (/\(\d{2,3}%\)\s*$/.test(trimmed)) {
    return false;
  }

  const looksJsonLike = (/^\{[\s\S]*\}$/.test(trimmed) || /^\[[\s\S]*\]$/.test(trimmed)) && /"\w+"\s*:/.test(trimmed);
  if (looksJsonLike) {
    return false;
  }

  return true;
}

/**
 * Removes duplicate or highly similar reverie insights based on content fingerprinting.
 *
 * CRITICAL FIX: Groups by fingerprint and keeps the insight with the HIGHEST relevance score.
 * Previous implementations incorrectly kept the first occurrence, which could discard
 * higher-quality duplicates found later in the list.
 *
 * Uses the first 100 characters of each excerpt (normalized) as a fingerprint
 * to identify duplicates. This prevents redundant insights from being shown
 * to the user while preserving the most relevant unique insights.
 *
 * @param insights - Array of reverie insights to deduplicate
 * @returns Deduplicated array of reverie insights, sorted by relevance (highest first)
 *
 * @example
 * ```typescript
 * const insights = [
 *   { excerpt: "We refactored the auth module...", relevance: 0.7, ... },
 *   { excerpt: "We refactored the auth module to use async/await", relevance: 0.9, ... },
 *   { excerpt: "Updated the database schema", relevance: 0.8, ... }
 * ];
 *
 * const deduplicated = deduplicateReverieInsights(insights);
 * // Returns 2 insights: the higher-scoring auth one (0.9) and the database one (0.8)
 * ```
 */
export function deduplicateReverieInsights<T extends ReverieInsight>(insights: T[]): T[] {
  // Group insights by fingerprint, keeping the one with highest relevance
  const fingerprintMap = new Map<string, T>();

  for (const insight of insights) {
    // Create a fingerprint based on first 100 chars
    const fingerprint = insight.excerpt.slice(0, 100).toLowerCase().replace(/\s+/g, " ");

    const existing = fingerprintMap.get(fingerprint);
    if (!existing || insight.relevance > existing.relevance) {
      // Keep the insight with higher relevance
      fingerprintMap.set(fingerprint, insight);
    }
  }

  // Convert back to array and sort by relevance (highest first)
  return Array.from(fingerprintMap.values()).sort((a, b) => b.relevance - a.relevance);
}

/**
 * Applies the complete quality pipeline to reverie insights.
 *
 * Pipeline steps:
 * 1. Filter out invalid excerpts (system prompts, boilerplate, etc.)
 * 2. Deduplicate similar insights, keeping highest relevance
 * 3. Sort by relevance score (highest first)
 * 4. Limit to top N results
 *
 * @param insights - Raw reverie insights from search
 * @param limit - Maximum number of insights to return (default: 10)
 * @returns Filtered, deduplicated, and sorted insights with statistics
 *
 * @example
 * ```typescript
 * const rawInsights = await reverieSearchSemantic(codexHome, query, options);
 * const { insights, stats } = applyQualityPipeline(rawInsights, 5);
 *
 * console.log(`Filtered ${stats.initial} → ${stats.final} insights`);
 * insights.forEach(insight => {
 *   console.log(`[${insight.relevance.toFixed(2)}] ${insight.excerpt.slice(0, 100)}`);
 * });
 * ```
 */
export function applyQualityPipeline<T extends ReverieInsight>(
  insights: T[],
  limit: number = 10
): { insights: T[]; stats: QualityFilterStats } {
  const stats: QualityFilterStats = {
    initial: insights.length,
    afterValidityFilter: 0,
    afterDeduplication: 0,
    final: 0,
  };

  // Step 1: Filter out invalid excerpts
  const validInsights = insights.filter((insight) => isValidReverieExcerpt(insight.excerpt));
  stats.afterValidityFilter = validInsights.length;

  // Step 2: Deduplicate similar insights (keeps highest relevance)
  const deduplicated = deduplicateReverieInsights(validInsights);
  stats.afterDeduplication = deduplicated.length;

  // Step 3: Already sorted by relevance in deduplicateReverieInsights
  // Step 4: Limit to top N
  const final = deduplicated.slice(0, limit);
  stats.final = final.length;

  return { insights: final, stats };
}
