/**
 * Complete Reverie Pipeline
 *
 * Orchestrates the full reverie search and filtering process:
 * 1. Search with 3x candidates for aggressive filtering headroom
 * 2. Basic quality filter (remove boilerplate and system prompts)
 * 3. Split by relevance threshold (high vs low scoring)
 * 4. LLM grade high-scoring candidates only (cost optimization)
 * 5. Deduplicate results (keep highest relevance)
 * 6. Log statistics at every stage (transparent operation)
 *
 * This pipeline matches diff-agent's sophistication while being fully generic
 * and reusable across different contexts.
 */

import { searchReveries } from "./search.js";
import { gradeReveriesInParallel } from "./grader.js";
import type { AgentRunner } from "./grader.js";
import type {
  ReverieInsight,
  ReveriePipelineOptions,
  ReverieFilterStats,
  ReverieSearchLevel,
  ReverieContext,
  ProjectLevelContext,
  BranchLevelContext,
  FileLevelContext,
} from "./types.js";
import { isValidReverieExcerpt, deduplicateReverieInsights } from "./quality.js";
import { filterBoilerplateInsights } from "./boilerplate.js";
import {
  logReverieSearch,
  logReverieFiltering,
  logLLMGrading,
  logApprovedReveries,
  logMultiLevelSearch,
  logLevelResults,
} from "./logger.js";
import {
  DEFAULT_REVERIE_LIMIT,
  DEFAULT_REVERIE_MAX_CANDIDATES,
  REVERIE_LLM_GRADE_THRESHOLD,
} from "./constants.js";
import { contextToQuery } from "./context.js";

/**
 * Result from the complete reverie pipeline.
 */
export interface ReveriePipelineResult {
  /** Final filtered and graded insights */
  insights: ReverieInsight[];
  /** Statistics from each pipeline stage */
  stats: ReverieFilterStats;
}

/**
 * Applies the complete reverie pipeline with all sophisticated features from diff-agent.
 *
 * Pipeline stages:
 * 1. **Search** - Fetch 3x candidates with optional reranking
 * 2. **Quality Filter** - Remove system prompts, boilerplate, JSON objects
 * 3. **Score Split** - Separate high-scoring (≥0.7) from low-scoring candidates
 * 4. **LLM Grading** - Grade only high-scoring candidates (cost optimization)
 * 5. **Deduplication** - Remove similar excerpts, keeping highest relevance
 * 6. **Logging** - Transparent statistics at each stage
 *
 * Key optimizations:
 * - 3x candidate multiplier provides headroom for aggressive filtering
 * - LLM grading only applied to high-scoring candidates (≥0.7)
 * - Parallel grading for performance
 * - Deduplication preserves highest-relevance duplicates
 * - Comprehensive logging for debugging and monitoring
 *
 * @param codexHome - Path to .codex directory containing conversation data
 * @param searchText - Search query describing what to look for
 * @param repo - Repository root path for filtering conversations
 * @param runner - Agent runner for LLM-based relevance grading (required unless skipLLMGrading is true)
 * @param options - Pipeline configuration options
 * @returns Pipeline result with filtered insights and statistics
 *
 * @example
 * ```typescript
 * // Full pipeline with LLM grading
 * const result = await applyReveriePipeline(
 *   "/Users/me/.codex",
 *   "authentication bug with JWT tokens",
 *   "/Users/me/my-project",
 *   runner,
 *   {
 *     limit: 6,
 *     useReranker: true,
 *     minRelevanceForGrading: 0.7
 *   }
 * );
 *
 * console.log(`Found ${result.insights.length} relevant insights`);
 * console.log(`Filtered: ${result.stats.total} → ${result.stats.final}`);
 *
 * // Without LLM grading (faster, lower quality)
 * const fastResult = await applyReveriePipeline(
 *   codexHome,
 *   query,
 *   repo,
 *   null,
 *   { skipLLMGrading: true }
 * );
 * ```
 */
export async function applyReveriePipeline(
  codexHome: string,
  searchText: string,
  repo: string,
  runner: AgentRunner | null,
  options?: ReveriePipelineOptions
): Promise<ReveriePipelineResult> {
  const {
    limit = DEFAULT_REVERIE_LIMIT,
    maxCandidates = DEFAULT_REVERIE_MAX_CANDIDATES,
    minRelevanceForGrading = REVERIE_LLM_GRADE_THRESHOLD,
    skipLLMGrading = false,
    ...searchOptions
  } = options || {};

  // Log search initiation
  logReverieSearch(searchText, `repo: ${repo}`);

  // Stage 1: Search with aggressive candidate fetching
  const rawInsights = await searchReveries(codexHome, searchText, repo, {
    limit,
    maxCandidates,
    ...searchOptions,
  });

  // Initialize statistics
  const stats: ReverieFilterStats = {
    total: rawInsights.length,
    afterQuality: 0,
    afterBoilerplate: 0,
    afterScore: 0,
    afterDedup: 0,
    final: 0,
  };

  // Stage 2: Basic quality filtering
  const validInsights = rawInsights.filter((insight) => isValidReverieExcerpt(insight.excerpt));
  stats.afterQuality = validInsights.length;

  // Stage 3: Embedding-based boilerplate filtering
  const { kept: conversationalInsights } = await filterBoilerplateInsights(validInsights, {
    projectRoot: repo,
  });
  stats.afterBoilerplate = conversationalInsights.length;

  // Stage 4: Split by relevance threshold
  const highScoring = conversationalInsights.filter((insight) => insight.relevance >= minRelevanceForGrading);
  const lowScoring = conversationalInsights.filter((insight) => insight.relevance < minRelevanceForGrading);
  stats.afterScore = highScoring.length;

  // Stage 5: LLM grading (optional, only for high-scoring)
  let gradedInsights: ReverieInsight[];

  if (skipLLMGrading || !runner) {
    // Skip LLM grading - just use high-scoring insights
    gradedInsights = highScoring;
    stats.afterLLMGrade = highScoring.length;
  } else {
    // Apply LLM grading to high-scoring candidates
    gradedInsights = await gradeReveriesInParallel(runner, searchText, highScoring, {
      minRelevanceForGrading,
      parallel: true,
    });
    stats.afterLLMGrade = gradedInsights.length;

    // Log LLM grading results
    logLLMGrading({
      total: highScoring.length,
      approved: gradedInsights.length,
      rejected: highScoring.length - gradedInsights.length,
      minScore: minRelevanceForGrading,
    });

    // Log approved reveries (verbose)
    if (gradedInsights.length > 0) {
      logApprovedReveries(gradedInsights);
    }
  }

  // Stage 6: Deduplication (keeps highest relevance)
  const deduplicated = deduplicateReverieInsights(gradedInsights);
  stats.afterDedup = deduplicated.length;

  // Final results
  const finalInsights = deduplicated.slice(0, limit);
  stats.final = finalInsights.length;

  // Log filtering statistics
  logReverieFiltering({
    total: stats.total,
    afterQuality: stats.afterQuality,
    afterBoilerplate: stats.afterBoilerplate,
    afterScore: stats.afterScore,
    afterDedup: stats.afterDedup,
    minScore: minRelevanceForGrading,
  });

  return {
    insights: finalInsights,
    stats,
  };
}

/**
 * Simplified pipeline for file-specific searches.
 *
 * Similar to main pipeline but optimized for individual file contexts:
 * - Uses fewer candidates (maxCandidates / 2)
 * - Same filtering and grading logic
 * - Transparent logging
 *
 * @param codexHome - Path to .codex directory
 * @param filePath - File path being analyzed
 * @param fileContext - Contextual information about the file (symbols, changes, etc.)
 * @param repo - Repository root path
 * @param runner - Agent runner for LLM grading
 * @param options - Pipeline options
 * @returns Pipeline result with file-specific insights
 *
 * @example
 * ```typescript
 * const fileInsights = await applyFileReveriePipeline(
 *   codexHome,
 *   "src/auth/jwt.ts",
 *   "File: src/auth/jwt.ts\nImplementing: validateToken, generateToken",
 *   repo,
 *   runner,
 *   { limit: 3 }
 * );
 * ```
 */
export async function applyFileReveriePipeline(
  codexHome: string,
  filePath: string,
  fileContext: string,
  repo: string,
  runner: AgentRunner | null,
  options?: ReveriePipelineOptions
): Promise<ReveriePipelineResult> {
  const {
    maxCandidates = DEFAULT_REVERIE_MAX_CANDIDATES,
    limit = DEFAULT_REVERIE_LIMIT,
    ...restOptions
  } = options || {};

  // Use fewer candidates for file-specific searches
  const fileOptions = {
    ...restOptions,
    maxCandidates: Math.floor(maxCandidates / 2),
    limit,
  };

  // Run standard pipeline with file-specific context
  return applyReveriePipeline(codexHome, fileContext, repo, runner, fileOptions);
}

/**
 * Multi-level reverie search pipeline.
 *
 * Executes searches at multiple levels (project, branch, file) and returns
 * results organized by level. This enables comprehensive context gathering
 * from different scopes in a single operation.
 *
 * @param codexHome - Path to .codex directory
 * @param contexts - Array of search contexts at different levels
 * @param runner - Agent runner for LLM grading (optional if skipLLMGrading is true)
 * @param options - Pipeline options
 * @returns Map of search level to pipeline results
 *
 * @example
 * ```typescript
 * import { buildProjectContext, buildBranchContext, buildFileContext } from './context.js';
 *
 * const contexts = [
 *   buildProjectContext("Testing conventions in this codebase"),
 *   buildBranchContext("feat/auth", ["src/auth.ts", "src/login.ts"]),
 *   buildFileContext("src/auth.ts", { extractSymbols: true })
 * ];
 *
 * const results = await searchMultiLevel(codexHome, contexts, runner, {
 *   limit: 5,
 *   useReranker: true
 * });
 *
 * // Access results by level
 * const projectInsights = results.get('project')?.insights || [];
 * const branchInsights = results.get('branch')?.insights || [];
 * const fileInsights = results.get('file')?.insights || [];
 * ```
 */
export async function searchMultiLevel(
  codexHome: string,
  contexts: ReverieContext[],
  runner: AgentRunner | null,
  options?: ReveriePipelineOptions
): Promise<Map<ReverieSearchLevel, ReveriePipelineResult>> {
  const levels = contexts.map(ctx => ctx.level);
  logMultiLevelSearch(levels);

  const results = new Map<ReverieSearchLevel, ReveriePipelineResult>();

  // Execute searches sequentially to maintain order and avoid overwhelming the system
  for (const context of contexts) {
    let result: ReveriePipelineResult;

    switch (context.level) {
      case 'project':
        result = await searchProjectLevel(codexHome, context, runner, options);
        break;
      case 'branch':
        result = await searchBranchLevel(codexHome, context, runner, options);
        break;
      case 'file':
        result = await searchFileLevel(codexHome, context, runner, options);
        break;
    }

    results.set(context.level, result);
    logLevelResults(context.level, result);
  }

  return results;
}

/**
 * Search at project level for repository-wide patterns.
 *
 * Optimized for broad searches across the entire codebase to find
 * architectural decisions, common practices, and project conventions.
 *
 * @param codexHome - Path to .codex directory
 * @param context - Project-level search context
 * @param runner - Agent runner for LLM grading
 * @param options - Pipeline options
 * @returns Pipeline result with project-wide insights
 *
 * @example
 * ```typescript
 * const context = buildProjectContext(
 *   "How we handle database migrations",
 *   { repoPath: "/Users/me/my-project" }
 * );
 *
 * const result = await searchProjectLevel(codexHome, context, runner, {
 *   limit: 8,
 *   useReranker: true
 * });
 *
 * console.log(`Found ${result.insights.length} project-wide insights`);
 * ```
 */
export async function searchProjectLevel(
  codexHome: string,
  context: ProjectLevelContext,
  runner: AgentRunner | null,
  options?: ReveriePipelineOptions
): Promise<ReveriePipelineResult> {
  const searchQuery = contextToQuery(context);

  // Use larger candidate pool for project-wide searches
  const projectOptions = {
    ...options,
    maxCandidates: (options?.maxCandidates || DEFAULT_REVERIE_MAX_CANDIDATES) * 1.5,
  };

  return applyReveriePipeline(
    codexHome,
    searchQuery,
    context.repoPath,
    runner,
    projectOptions
  );
}

/**
 * Search at branch level for feature-specific context.
 *
 * Optimized for understanding work done in a specific branch,
 * including intent, changed files, and commit history.
 *
 * @param codexHome - Path to .codex directory
 * @param context - Branch-level search context
 * @param runner - Agent runner for LLM grading
 * @param options - Pipeline options
 * @returns Pipeline result with branch-specific insights
 *
 * @example
 * ```typescript
 * const context = buildBranchContext(
 *   "feat/oauth2",
 *   ["src/auth.ts", "src/login.ts"],
 *   {
 *     baseBranch: "main",
 *     recentCommits: "Add OAuth2 support\nImplement token refresh"
 *   }
 * );
 *
 * const result = await searchBranchLevel(codexHome, context, runner, {
 *   limit: 6
 * });
 *
 * console.log(`Found ${result.insights.length} branch insights`);
 * ```
 */
export async function searchBranchLevel(
  codexHome: string,
  context: BranchLevelContext,
  runner: AgentRunner | null,
  options?: ReveriePipelineOptions
): Promise<ReveriePipelineResult> {
  const searchQuery = contextToQuery(context);

  // Standard pipeline for branch-level searches
  return applyReveriePipeline(
    codexHome,
    searchQuery,
    context.repoPath,
    runner,
    options
  );
}

/**
 * Search at file level for specific file changes.
 *
 * Optimized for focused searches on individual file modifications,
 * using extracted symbols for better targeting.
 *
 * @param codexHome - Path to .codex directory
 * @param context - File-level search context
 * @param runner - Agent runner for LLM grading
 * @param options - Pipeline options
 * @returns Pipeline result with file-specific insights
 *
 * @example
 * ```typescript
 * const context = buildFileContext(
 *   "src/auth/jwt.ts",
 *   {
 *     diff: "+function validateToken(...)\n+function refreshToken(...)",
 *     extractSymbols: true
 *   }
 * );
 *
 * const result = await searchFileLevel(codexHome, context, runner, {
 *   limit: 3
 * });
 *
 * console.log(`Found ${result.insights.length} file-specific insights`);
 * ```
 */
export async function searchFileLevel(
  codexHome: string,
  context: FileLevelContext,
  runner: AgentRunner | null,
  options?: ReveriePipelineOptions
): Promise<ReveriePipelineResult> {
  const searchQuery = contextToQuery(context);

  // Use existing file pipeline which reduces candidate count
  return applyFileReveriePipeline(
    codexHome,
    context.filePath,
    searchQuery,
    context.repoPath,
    runner,
    options
  );
}
