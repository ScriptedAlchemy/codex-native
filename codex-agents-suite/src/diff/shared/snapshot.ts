import type { ConflictContext, RemoteComparison, RepoSnapshot } from "../merge/types.js";
import { GitRepo } from "../merge/git.js";

export async function collectRepoSnapshot(
  git: GitRepo,
  conflicts: ConflictContext[] = [],
  remoteComparison: RemoteComparison | null = null,
): Promise<RepoSnapshot> {
  const [branch, statusShort, diffStat, recentCommits] = await Promise.all([
    git.getBranchName(),
    git.getStatusShort(),
    git.getDiffStat(),
    git.getRecentCommits(),
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
