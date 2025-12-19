/**
 * Example: Programmatic skills (no SKILL.md files)
 *
 * Usage:
 * ```bash
 * npx tsx examples/skills.ts
 * ```
 */

import { Codex } from "../src/index";

async function main() {
  const codex = new Codex({
    skills: {
      "release-notes": "Write concise release notes with short bullets and clear headers.",
    },
  });

  const thread = codex.startThread({ skipGitRepoCheck: true });
  const turn = await thread.run("Use $release-notes to summarize the recent changes in this repo.");

  console.log(turn.finalResponse);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { main };

