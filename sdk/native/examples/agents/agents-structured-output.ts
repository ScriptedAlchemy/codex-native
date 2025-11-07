/**
 * Example: Structured Output with CodexProvider and OpenAI Agents
 *
 * This script shows how to request validated JSON output using a Zod schema
 * and how to continue a conversation by providing the previous response ID.
 *
 * Installation:
 * ```bash
 * pnpm install
 * ```
 *
 * Usage:
 * ```bash
 * npx tsx examples/agents/agents-structured-output.ts
 * ```
 */

import { Agent, Runner } from '@openai/agents';
import { z } from 'zod';
import { CodexProvider } from '../../src/index';

const releaseNoteSchema = z.object({
  summary: z.string().describe('Single sentence summary of the release'),
  keyChanges: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
      }),
    )
    .min(1)
    .describe('List of notable updates'),
  riskLevel: z.enum(['low', 'medium', 'high']).describe('Overall risk assessment'),
  followUpActions: z
    .array(z.string())
    .describe('Concrete next steps for the team'),
});

async function main() {
  console.log('🧾 Structured output with CodexProvider and OpenAI Agents\n');

  const provider = new CodexProvider({
    defaultModel: 'gpt-5-codex',
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
  });

  const agent = new Agent({
    name: 'ReleaseNoteWriter',
    model: 'gpt-5-codex',
    instructions: `You are a release notes assistant.
Return answers that satisfy the provided JSON schema.
Keep sentences short and actionable.`,
    outputType: releaseNoteSchema,
  });

  const runner = new Runner({
    modelProvider: provider,
  });

  const firstPrompt = `Create release notes for version 2.4 of our mobile app.
- Added offline sync for bookmarks.
- Improved startup time by 30%.
- Fixed crash when switching workspaces.`;

  console.log('Generating structured release notes...\n');
  const firstRun = await runner.run(agent, firstPrompt);

  console.log('Validated JSON response:');
  console.log(JSON.stringify(firstRun.finalOutput, null, 2));

  const followUpPrompt = 'Add a short call-to-action for customers who rely on offline access.';

  console.log('\nContinuing conversation with additional context...\n');
  const followUpRun = await runner.run(agent, followUpPrompt, {
    previousResponseId: firstRun.lastResponseId,
  });

  console.log('Updated structured response:');
  console.log(JSON.stringify(followUpRun.finalOutput, null, 2));

  console.log('\n✓ Structured output demo complete.');
}

if (require.main === module) {
  main()
    .then(() => {
      setTimeout(() => process.exit(0), 100);
    })
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { main };

