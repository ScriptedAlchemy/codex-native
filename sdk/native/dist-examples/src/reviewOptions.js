"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildReviewPrompt = buildReviewPrompt;
function buildReviewPrompt(target) {
    var _a, _b;
    switch (target.type) {
        case "current_changes":
            return {
                prompt: "Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.",
                hint: "current changes",
            };
        case "branch": {
            var branch = target.baseBranch;
            var prompt_1 = "Review the code changes against the base branch '".concat(branch, "'. Start by finding the merge diff between the current branch and ").concat(branch, "'s upstream e.g. (`git merge-base HEAD \"$(git rev-parse --abbrev-ref \"").concat(branch, "@{upstream}\")\"`), then run `git diff` against that SHA to see what changes we would merge into the ").concat(branch, " branch. Provide prioritized, actionable findings.");
            return {
                prompt: prompt_1,
                hint: "changes against '".concat(branch, "'"),
            };
        }
        case "commit": {
            var shortSha = target.sha.slice(0, 7);
            var subject = (_a = target.subject) !== null && _a !== void 0 ? _a : target.sha;
            return {
                prompt: "Review the code changes introduced by commit ".concat(target.sha, " (\"").concat(subject, "\"). Provide prioritized, actionable findings."),
                hint: "commit ".concat(shortSha),
            };
        }
        case "custom": {
            var hint = (_b = target.hint) !== null && _b !== void 0 ? _b : "custom review";
            return {
                prompt: target.prompt,
                hint: hint,
            };
        }
        default: {
            var exhaustive = target;
            throw new Error("Unsupported review target: ".concat(String(exhaustive)));
        }
    }
}
