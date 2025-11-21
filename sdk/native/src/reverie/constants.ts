/**
 * Reverie System Constants
 *
 * Configuration constants for reverie search, filtering, and grading.
 * These values are tuned for optimal balance between result quality and performance.
 */

/**
 * Default number of final reverie insights to return.
 * After all filtering and grading, this is the target result count.
 */
export const DEFAULT_REVERIE_LIMIT = 6;

/**
 * Maximum number of candidate insights to fetch initially.
 * We fetch many candidates upfront and then filter aggressively.
 */
export const DEFAULT_REVERIE_MAX_CANDIDATES = 80;

/**
 * Embedding model for semantic search.
 * Large model provides better semantic understanding at cost of memory/speed.
 */
export const REVERIE_EMBED_MODEL = "BAAI/bge-large-en-v1.5";

/**
 * Reranker model for improving search precision.
 * Applied after initial embedding search to rerank top candidates.
 */
export const REVERIE_RERANKER_MODEL = "rozgo/bge-reranker-v2-m3";

/**
 * Candidate multiplier for aggressive filtering.
 * Fetch 3x candidates since we'll filter heavily for quality.
 */
export const REVERIE_CANDIDATE_MULTIPLIER = 3;

/**
 * Minimum relevance score threshold for LLM grading.
 * Only insights scoring >= 0.7 are sent for expensive LLM evaluation.
 * This optimizes API costs by skipping obvious low-quality candidates.
 */
export const REVERIE_LLM_GRADE_THRESHOLD = 0.7;

/**
 * Default reranker top-k value.
 * Number of results to rerank after initial retrieval.
 */
export const DEFAULT_RERANKER_TOP_K = 20;

/**
 * Default reranker batch size.
 * Number of candidates to process per reranker batch.
 */
export const DEFAULT_RERANKER_BATCH_SIZE = 8;
