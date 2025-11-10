/**
 * Example: Structured Output with CodexProvider and OpenAI Agents
 *
 * This script shows how to request validated JSON output using a Zod schema
 * and how to continue a conversation by providing the previous response ID.
 *
 * Usage:
 *   npx tsx examples/agents/agents-structured-output.ts
 */

import { Agent, Runner } from '@openai/agents';
import { CodexProvider } from '../../src/index';

const releaseNoteSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Single sentence summary of the release' },
    keyChanges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['title', 'description'],
        additionalProperties: false,
      },
      minItems: 1,
      description: 'List of notable updates',
    },
    riskLevel: {
      type: 'string',
      enum: ['low', 'medium', 'high'],
      description: 'Overall risk assessment',
    },
    followUpActions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Concrete next steps for the team',
    },
  },
  required: ['summary', 'keyChanges', 'riskLevel', 'followUpActions'],
  additionalProperties: false,
} as const;

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
    outputType: { type: 'json_schema', schema: releaseNoteSchema },
  });

  const runner = new Runner({ modelProvider: provider });

  const firstPrompt = `Create release notes for version 2.4 of our mobile app.
- Added offline sync for bookmarks.
- Improved startup time by 30%.
- Fixed crash when switching workspaces.`;

  console.log('Generating structured release notes...\n');
  const firstRun = await runner.run(agent, firstPrompt);

  console.log('Validated JSON response:');
  console.log(JSON.stringify(firstRun.finalOutput, null, 2));

  const followUpPrompt =
    'Add a short call-to-action for customers who rely on offline access.';

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
      console.error('Error:', error);
      process.exit(1);
    });
}


