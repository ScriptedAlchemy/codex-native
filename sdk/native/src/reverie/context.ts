/**
 * Reverie Context Builders
 *
 * Utilities for building search contexts at different levels:
 * - Project level: Repository-wide patterns and architecture
 * - Branch level: Feature/branch-specific work and intent
 * - File level: Individual file changes and symbols
 */

import type {
  ProjectLevelContext,
  BranchLevelContext,
  FileLevelContext,
  ReverieContext,
} from "./types.js";
import { extractKeySymbols } from "./symbols.js";

/**
 * Builds project-level search context for repository-wide patterns.
 *
 * Use this for searching architectural decisions, common practices,
 * and project-wide patterns across the entire codebase.
 *
 * @param query - Natural language query describing what to find
 * @param options - Optional configuration
 * @returns Project-level context ready for search
 *
 * @example
 * ```typescript
 * const context = buildProjectContext(
 *   "How we handle database migrations in this repository",
 *   { repoPath: "/Users/me/my-project" }
 * );
 *
 * const results = await searchProjectLevel(codexHome, context, runner);
 * ```
 */
export function buildProjectContext(
  query: string,
  options?: {
    repoPath?: string;
    filePatterns?: string[];
  }
): ProjectLevelContext {
  return {
    level: 'project',
    repoPath: options?.repoPath || process.cwd(),
    query,
    filePatterns: options?.filePatterns,
  };
}

/**
 * Builds branch-level search context for feature/branch-specific work.
 *
 * Use this for understanding branch intent, feature context, and changes
 * made across multiple files in a feature branch.
 *
 * @param branch - Current branch name
 * @param changedFiles - List of files modified in this branch
 * @param options - Optional configuration
 * @returns Branch-level context ready for search
 *
 * @example
 * ```typescript
 * const context = buildBranchContext(
 *   "feat/oauth2",
 *   ["src/auth.ts", "src/login.ts", "test/auth.test.ts"],
 *   {
 *     baseBranch: "main",
 *     recentCommits: "Add OAuth2 support\nImplement token refresh",
 *     repoPath: "/Users/me/my-project"
 *   }
 * );
 *
 * const results = await searchBranchLevel(codexHome, context, runner);
 * ```
 */
export function buildBranchContext(
  branch: string,
  changedFiles: string[],
  options?: {
    baseBranch?: string;
    recentCommits?: string;
    repoPath?: string;
  }
): BranchLevelContext {
  return {
    level: 'branch',
    repoPath: options?.repoPath || process.cwd(),
    branch,
    baseBranch: options?.baseBranch,
    changedFiles,
    recentCommits: options?.recentCommits,
  };
}

/**
 * Builds file-level search context for individual file changes.
 *
 * Use this for focused searches on specific file modifications,
 * with optional symbol extraction for better targeting.
 *
 * @param filePath - Path to the file being analyzed
 * @param options - Optional configuration
 * @returns File-level context ready for search
 *
 * @example
 * ```typescript
 * // Without symbol extraction
 * const context = buildFileContext(
 *   "src/auth/jwt.ts",
 *   {
 *     diff: "... git diff content ...",
 *     repoPath: "/Users/me/my-project"
 *   }
 * );
 *
 * // With automatic symbol extraction
 * const context = buildFileContext(
 *   "src/auth/jwt.ts",
 *   {
 *     diff: "+function validateToken(...)\n+function refreshToken(...)",
 *     extractSymbols: true,
 *     repoPath: "/Users/me/my-project"
 *   }
 * );
 * // context.symbols will be: ["validateToken", "refreshToken"]
 *
 * const results = await searchFileLevel(codexHome, context, runner);
 * ```
 */
export function buildFileContext(
  filePath: string,
  options?: {
    diff?: string;
    extractSymbols?: boolean;
    repoPath?: string;
  }
): FileLevelContext {
  const context: FileLevelContext = {
    level: 'file',
    repoPath: options?.repoPath || process.cwd(),
    filePath,
    diff: options?.diff,
  };

  // Extract symbols if requested and diff is provided
  if (options?.extractSymbols && options?.diff) {
    const symbolsText = extractKeySymbols(options.diff);
    if (symbolsText) {
      context.symbols = symbolsText.split(',').map(s => s.trim()).filter(Boolean);
    }
  }

  return context;
}

/**
 * Converts a ReverieContext to a search query string.
 *
 * Transforms structured context objects into natural language queries
 * suitable for semantic search.
 *
 * @param context - Any level of reverie context
 * @returns Formatted search query string
 *
 * @example
 * ```typescript
 * const projectCtx = buildProjectContext("Authentication patterns");
 * const query = contextToQuery(projectCtx);
 * // Returns: "Project-wide: Authentication patterns"
 *
 * const branchCtx = buildBranchContext("feat/auth", ["auth.ts", "login.ts"]);
 * const query = contextToQuery(branchCtx);
 * // Returns: "Branch: feat/auth\nFiles: auth.ts, login.ts"
 *
 * const fileCtx = buildFileContext("auth.ts", {
 *   symbols: ["validateToken", "refreshToken"]
 * });
 * const query = contextToQuery(fileCtx);
 * // Returns: "File: auth.ts\nSymbols: validateToken, refreshToken"
 * ```
 */
export function contextToQuery(context: ReverieContext): string {
  switch (context.level) {
    case 'project': {
      let query = `Project-wide: ${context.query}`;
      if (context.filePatterns && context.filePatterns.length > 0) {
        query += `\nScope: ${context.filePatterns.join(', ')}`;
      }
      return query;
    }

    case 'branch': {
      let query = `Branch: ${context.branch}`;
      if (context.baseBranch) {
        query += ` (base: ${context.baseBranch})`;
      }
      query += `\nFiles changed: ${context.changedFiles.join(', ')}`;
      if (context.recentCommits) {
        query += `\nRecent commits: ${context.recentCommits}`;
      }
      return query;
    }

    case 'file': {
      let query = `File: ${context.filePath}`;
      if (context.symbols && context.symbols.length > 0) {
        query += `\nSymbols: ${context.symbols.join(', ')}`;
      }
      if (context.diff) {
        // Include a truncated version of the diff for context
        const truncatedDiff = context.diff.length > 500
          ? context.diff.slice(0, 500) + '...'
          : context.diff;
        query += `\nChanges:\n${truncatedDiff}`;
      }
      return query;
    }
  }
}

/**
 * Helper to format file paths for display in contexts.
 *
 * @param files - Array of file paths
 * @param maxFiles - Maximum number of files to show before truncating
 * @returns Formatted file list string
 */
export function formatFileList(files: string[], maxFiles: number = 10): string {
  if (files.length === 0) {
    return '(no files)';
  }

  if (files.length <= maxFiles) {
    return files.join(', ');
  }

  const shown = files.slice(0, maxFiles);
  const remaining = files.length - maxFiles;
  return `${shown.join(', ')} ... and ${remaining} more`;
}
