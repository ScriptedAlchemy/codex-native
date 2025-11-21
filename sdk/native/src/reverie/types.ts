/**
 * Reverie Type Definitions
 *
 * Core types used throughout the reverie system.
 */

/**
 * Represents a single reverie insight from past conversations.
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

export interface ReverieEpisodeSummary {
  conversationId: string;
  episodeId: string;
  timestamp: string;
  summary: string;
  keyDecisions?: string[];
  importance?: number;
}

/**
 * Options for reverie semantic search.
 */
export interface ReverieSearchOptions {
  /** Maximum number of final results to return (after all filtering) */
  limit?: number;

  /** Maximum number of candidates to fetch initially */
  maxCandidates?: number;

  /** Whether to use reranker for improving precision */
  useReranker?: boolean;

  /** Reranker model identifier */
  rerankerModel?: string;

  /** Number of results to rerank */
  rerankerTopK?: number;

  /** Batch size for reranking operations */
  rerankerBatchSize?: number;

  /** Multiplier for candidate fetching (fetch N × limit candidates) */
  candidateMultiplier?: number;
}

/**
 * Options for LLM-based relevance grading.
 */
export interface GradingOptions {
  /** Minimum relevance score to trigger LLM grading (default: 0.7) */
  minRelevanceForGrading?: number;

  /** Whether to grade insights in parallel (default: true) */
  parallel?: boolean;
}

/**
 * Statistics from reverie filtering pipeline.
 */
export interface ReverieFilterStats {
  /** Total raw results from search */
  total: number;

  /** Results after basic quality filtering */
  afterQuality: number;

  /** Results after embedding-based boilerplate filtering */
  afterBoilerplate?: number;

  /** Results after relevance score threshold */
  afterScore: number;

  /** Results after deduplication */
  afterDedup: number;

  /** Results after LLM grading */
  afterLLMGrade?: number;

  /** Final result count */
  final: number;
}

/**
 * Complete pipeline options combining search, filtering, and grading.
 */
export interface ReveriePipelineOptions extends ReverieSearchOptions, GradingOptions {
  /** Whether to skip LLM grading entirely (default: false) */
  skipLLMGrading?: boolean;
}

/**
 * Reverie search level types for multi-level search hierarchy.
 */
export type ReverieSearchLevel = 'project' | 'branch' | 'file';

/**
 * Project-level search context for repository-wide patterns.
 */
export interface ProjectLevelContext {
  /** Search level identifier */
  level: 'project';
  /** Repository root path */
  repoPath: string;
  /** Search query describing what to find */
  query: string;
  /** Optional file patterns to filter search scope (e.g., ["*.ts", "src/**"]) */
  filePatterns?: string[];
}

/**
 * Branch-level search context for feature/branch-specific work.
 */
export interface BranchLevelContext {
  /** Search level identifier */
  level: 'branch';
  /** Repository root path */
  repoPath: string;
  /** Current branch name */
  branch: string;
  /** Base branch for comparison (e.g., "main") */
  baseBranch?: string;
  /** List of changed file paths in this branch */
  changedFiles: string[];
  /** Recent commit messages or summaries */
  recentCommits?: string;
}

/**
 * File-level search context for individual file changes.
 */
export interface FileLevelContext {
  /** Search level identifier */
  level: 'file';
  /** Repository root path */
  repoPath: string;
  /** Path to the file being analyzed */
  filePath: string;
  /** Git diff or change content */
  diff?: string;
  /** Extracted symbols from the file (functions, classes, etc.) */
  symbols?: string[];
}

/**
 * Union type representing any level of search context.
 */
export type ReverieContext = ProjectLevelContext | BranchLevelContext | FileLevelContext;
