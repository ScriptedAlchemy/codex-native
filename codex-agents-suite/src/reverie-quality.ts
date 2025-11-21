/**
 * Reverie Quality Utilities
 *
 * Re-exports quality utilities from @codex-native/sdk for consistency.
 */

import {
  isValidReverieExcerpt as sdkIsValidReverieExcerpt,
  deduplicateReverieInsights as sdkDeduplicateReverieInsights,
  type ReverieInsight,
} from "@codex-native/sdk";
import type { ReverieResult } from "./types.js";

/**
 * Validates whether a reverie excerpt contains meaningful content worth indexing.
 *
 * @param excerpt - The text excerpt to validate
 * @returns true if the excerpt contains meaningful content, false otherwise
 */
export function isValidReverieExcerpt(excerpt: string): boolean {
  // Guard against boilerplate instructions that look like system prompts.
  if (/AGENTS\.md instructions/i.test(excerpt)) {
    return false;
  }
  const trimmed = excerpt.trim();
  if (/^<instructions>/i.test(trimmed)) {
    return false;
  }
  const boilerplateTags = [
    /<claude_background_info/i,
    /<\/claude_background_info>/i,
    /<invoke\s/i,
    /<cwd>/i,
    /<\/cwd>/i,
    /CODEX_SAN/i,
    /workspace-write mode/i,
    /codex-rs/i,
    /install repo helpers/i,
    /coordinating an automated workflow process/i,
    /respond strictly with json/i,
    /judge whether each change/i,
    /multi-agent codex system/i,
    /orchestrator pattern/i,
    /function_calls are used/i,
  ];
  if (boilerplateTags.some((pattern) => pattern.test(trimmed))) {
    return false;
  }
  return sdkIsValidReverieExcerpt(excerpt);
}

/**
 * Removes duplicate or highly similar reverie insights based on content fingerprinting.
 *
 * @param insights - Array of reverie results to deduplicate
 * @returns Deduplicated array of reverie results, preserving highest relevance
 */
export function deduplicateReverieInsights(insights: ReverieResult[]): ReverieResult[] {
  // Convert ReverieResult to ReverieInsight (they have the same shape)
  const asInsights = insights as unknown as ReverieInsight[];
  const deduplicated = sdkDeduplicateReverieInsights(asInsights);
  // Convert back to ReverieResult
  return deduplicated as unknown as ReverieResult[];
}
