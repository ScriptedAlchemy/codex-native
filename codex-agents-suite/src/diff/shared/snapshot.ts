/**
 * Shared snapshot collection utilities
 */

import type { GitRepo } from "../merge/git.js";
import type { ConflictContext, RemoteComparison, RepoSnapshot } from "../merge/types.js";

/**
 * Collect complete repository snapshot for merge analysis
 */
export async function collectRepoSnapshot(
  git: GitRepo,
  conflicts: ConflictContext[],
  remoteComparison: RemoteComparison | null
): Promise<RepoSnapshot> {
  const [branch, statusShort, diffStat, recentCommits] = await Promise.all([
    git.getBranchName(),
    git.getStatusShort(),
    git.getDiffStat(),
    git.getRecentCommits(10),
  ]);

  return {
    branch,
    statusShort,
    diffStat,
    recentCommits,
    conflicts,
    remoteComparison,
  };
}
