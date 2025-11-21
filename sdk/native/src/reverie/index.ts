/**
 * Reverie System - Comprehensive Utilities
 *
 * This module provides a complete reverie system for searching and filtering
 * conversation history, preserving all sophisticated features from diff-agent:
 *
 * **Core Features:**
 * - Quality filtering with comprehensive boilerplate detection
 * - Deduplication that preserves highest-relevance duplicates
 * - LLM-based relevance grading with cost optimization
 * - Symbol extraction for focused searches
 * - Advanced semantic search with reranking
 * - Complete pipeline orchestration
 * - Transparent logging at every stage
 *
 * **Key Optimizations:**
 * - 3x candidate multiplier for aggressive filtering headroom
 * - LLM grading only for high-scoring candidates (≥0.7)
 * - Parallel grading for performance
 * - Comprehensive boilerplate pattern matching
 * - Multi-stage filtering with statistics
 *
 * @module reverie
 */

// ============================================================================
// Constants
// ============================================================================

export {
  DEFAULT_REVERIE_LIMIT,
  DEFAULT_REVERIE_MAX_CANDIDATES,
  REVERIE_EMBED_MODEL,
  REVERIE_RERANKER_MODEL,
  REVERIE_CANDIDATE_MULTIPLIER,
  REVERIE_LLM_GRADE_THRESHOLD,
  DEFAULT_RERANKER_TOP_K,
  DEFAULT_RERANKER_BATCH_SIZE,
} from "./constants.js";

// ============================================================================
// Types
// ============================================================================

export type {
  ReverieInsight,
  ReverieSearchOptions,
  GradingOptions,
  ReverieFilterStats,
  ReveriePipelineOptions,
  ReverieSearchLevel,
  ReverieContext,
  ProjectLevelContext,
  BranchLevelContext,
  FileLevelContext,
} from "./types.js";

// ============================================================================
// Quality Filtering and Deduplication
// ============================================================================

export {
  isValidReverieExcerpt,
  deduplicateReverieInsights,
  applyQualityPipeline,
} from "./quality.js";

export { filterBoilerplateInsights } from "./boilerplate.js";

export type { ReverieResult, QualityFilterStats } from "./quality.js";
export type { ReverieEpisodeSummary } from "./types.js";

// ============================================================================
// Logging
// ============================================================================

export {
  logReverieSearch,
  logReverieFiltering,
  logReverieInsights,
  logReverieHintQuality,
  logLLMGrading,
  logApprovedReveries,
  truncateText,
  logMultiLevelSearch,
  logLevelResults,
  logMultiLevelSummary,
} from "./logger.js";

// ============================================================================
// Symbol Extraction
// ============================================================================

export { extractKeySymbols } from "./symbols.js";

// ============================================================================
// Semantic Search
// ============================================================================

export { searchReveries } from "./search.js";
export { searchEpisodeSummaries } from "./episodes.js";

// ============================================================================
// LLM-Based Relevance Grading
// ============================================================================

export { gradeReverieRelevance, gradeReveriesInParallel } from "./grader.js";

export type { AgentRunner } from "./grader.js";

// ============================================================================
// Complete Pipeline
// ============================================================================

export {
  applyReveriePipeline,
  applyFileReveriePipeline,
  searchMultiLevel,
  searchProjectLevel,
  searchBranchLevel,
  searchFileLevel,
} from "./pipeline.js";

export type { ReveriePipelineResult } from "./pipeline.js";

// ============================================================================
// Context Builders
// ============================================================================

export {
  buildProjectContext,
  buildBranchContext,
  buildFileContext,
  contextToQuery,
  formatFileList,
} from "./context.js";

// ============================================================================
// Usage Examples
// ============================================================================

/**
 * @example Basic quality filtering
 * ```typescript
 * import { isValidReverieExcerpt, deduplicateReverieInsights } from '@codex-native/sdk/reverie';
 *
 * const insights = [
 *   { excerpt: "Let's refactor the auth module...", relevance: 0.9, ... },
 *   { excerpt: "<INSTRUCTIONS>You are a coding assistant", relevance: 0.8, ... },
 *   { excerpt: "Let's refactor the auth module to use async/await", relevance: 0.85, ... }
 * ];
 *
 * // Filter out system prompts
 * const valid = insights.filter(i => isValidReverieExcerpt(i.excerpt));
 * // Returns: 2 insights (second one filtered out)
 *
 * // Deduplicate, keeping highest relevance
 * const unique = deduplicateReverieInsights(valid);
 * // Returns: 1 insight (keeps the 0.9 relevance one)
 * ```
 *
 * @example Advanced search with reranking
 * ```typescript
 * import { searchReveries } from '@codex-native/sdk/reverie';
 *
 * const insights = await searchReveries(
 *   "/Users/me/.codex",
 *   "authentication bug with JWT tokens",
 *   "/Users/me/my-project",
 *   {
 *     limit: 6,
 *     useReranker: true,
 *     candidateMultiplier: 3
 *   }
 * );
 *
 * console.log(`Found ${insights.length} relevant insights`);
 * ```
 *
 * @example Complete pipeline with LLM grading
 * ```typescript
 * import { applyReveriePipeline } from '@codex-native/sdk/reverie';
 *
 * const result = await applyReveriePipeline(
 *   codexHome,
 *   "Fix authentication token validation",
 *   repo,
 *   runner,
 *   {
 *     limit: 6,
 *     useReranker: true,
 *     minRelevanceForGrading: 0.7,
 *     parallel: true
 *   }
 * );
 *
 * console.log(`Pipeline: ${result.stats.total} → ${result.stats.final}`);
 * console.log(`LLM approved: ${result.stats.afterLLMGrade}/${result.stats.afterScore}`);
 *
 * result.insights.forEach(insight => {
 *   console.log(`[${insight.relevance.toFixed(2)}] ${insight.excerpt.slice(0, 100)}`);
 * });
 * ```
 *
 * @example Symbol extraction for focused searches
 * ```typescript
 * import { extractKeySymbols } from '@codex-native/sdk/reverie';
 *
 * const diff = `
 * +function validateToken(token: string) {
 * +  const decoded = jwt.verify(token, SECRET);
 * +  return decoded;
 * +}
 * `;
 *
 * const symbols = extractKeySymbols(diff);
 * // Returns: "validateToken, decoded"
 *
 * // Use in search query
 * const query = `File: src/auth/jwt.ts\nImplementing: ${symbols}`;
 * const insights = await searchReveries(codexHome, query, repo);
 * ```
 *
 * @example File-specific pipeline
 * ```typescript
 * import { applyFileReveriePipeline, extractKeySymbols } from '@codex-native/sdk/reverie';
 *
 * const filePath = "src/auth/jwt.ts";
 * const diff = "... git diff content ...";
 * const symbols = extractKeySymbols(diff);
 * const context = `File: ${filePath}\nImplementing: ${symbols}`;
 *
 * const result = await applyFileReveriePipeline(
 *   codexHome,
 *   filePath,
 *   context,
 *   repo,
 *   runner,
 *   { limit: 3 }
 * );
 *
 * console.log(`Found ${result.insights.length} file-specific insights`);
 * ```
 */
