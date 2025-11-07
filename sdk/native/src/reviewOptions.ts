import { ThreadOptions } from "./threadOptions";
import { TurnOptions } from "./turnOptions";

export type CurrentChangesReview = {
  type: "current_changes";
};

export type BranchReview = {
  type: "branch";
  baseBranch: string;
};

export type CommitReview = {
  type: "commit";
  sha: string;
  subject?: string;
};

export type CustomReview = {
  type: "custom";
  prompt: string;
  hint?: string;
};

export type ReviewTarget =
  | CurrentChangesReview
  | BranchReview
  | CommitReview
  | CustomReview;

export type ReviewInvocationOptions = {
  target: ReviewTarget;
  threadOptions?: ThreadOptions;
  turnOptions?: TurnOptions;
};

export type ReviewPrompt = {
  prompt: string;
  hint: string;
};

export function buildReviewPrompt(target: ReviewTarget): ReviewPrompt {
  switch (target.type) {
    case "current_changes":
      return {
        prompt:
          "Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.",
        hint: "current changes",
      };
    case "branch": {
      const branch = target.baseBranch;
      const prompt = `Review the code changes against the base branch '${branch}'. Start by finding the merge diff between the current branch and ${branch}'s upstream e.g. (\`git merge-base HEAD "$(git rev-parse --abbrev-ref "${branch}@{upstream}")"\`), then run \`git diff\` against that SHA to see what changes we would merge into the ${branch} branch. Provide prioritized, actionable findings.`;
      return {
        prompt,
        hint: `changes against '${branch}'`,
      };
    }
    case "commit": {
      const shortSha = target.sha.slice(0, 7);
      const subject = target.subject ?? target.sha;
      return {
        prompt: `Review the code changes introduced by commit ${target.sha} ("${subject}"). Provide prioritized, actionable findings.`,
        hint: `commit ${shortSha}`,
      };
    }
    case "custom": {
      const hint = target.hint ?? "custom review";
      return {
        prompt: target.prompt,
        hint,
      };
    }
    default: {
      const exhaustive: never = target;
      throw new Error(`Unsupported review target: ${String(exhaustive)}`);
    }
  }
}
