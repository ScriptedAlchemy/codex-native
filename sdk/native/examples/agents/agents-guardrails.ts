/**
 * Example: Guardrails with CodexProvider and OpenAI Agents
 *
 * Demonstrates how to combine CodexProvider with the OpenAI Agents SDK to
 * enforce both input and output guardrails. The example configures a global
 * input guardrail that blocks secrets before Codex is called as well as an
 * output guardrail that verifies the model follows a required response format.
 *
 * The flow intentionally triggers the input guardrail to show how the
 * framework surfaces structured error details.
 *
 * Installation:
 * ```bash
 * pnpm install
 * ```
 *
 * Usage:
 * ```bash
 * npx tsx examples/agents/agents-guardrails.ts
 * ```
 */

import type { AgentInputItem } from '@openai/agents';
import {
  Agent,
  Runner,
  InputGuardrailTripwireTriggered,
  OutputGuardrailTripwireTriggered,
  type InputGuardrail,
  type OutputGuardrail,
} from '@openai/agents';
import { CodexProvider } from '../../src/index';

type GuardrailInfo = Record<string, unknown> | undefined;

function flattenInputText(input: string | AgentInputItem[]): string {
  if (typeof input === 'string') {
    return input;
  }

  return input
    .map((item) => {
      if ('role' in item && item.role === 'user') {
        if (Array.isArray(item.content)) {
          return item.content
            .map((contentPart) => {
              if (typeof contentPart === 'string') {
                return contentPart;
              }

              if ('text' in contentPart) {
                return (contentPart as { text: string }).text;
              }

              return '';
            })
            .filter(Boolean)
            .join(' ');
        }

        if (typeof item.content === 'string') {
          return item.content;
        }
      }

      if ('role' in item && item.role === 'system' && typeof item.content === 'string') {
        return item.content;
      }

      return '';
    })
    .filter(Boolean)
    .join('\n');
}

const sensitiveInputGuardrail: InputGuardrail = {
  name: 'BlockSensitiveSecrets',
  execute: async ({ input }) => {
    const text = flattenInputText(input).toLowerCase();
    const banned = ['password', 'ssn', 'secret', 'api key'];
    const matched = banned.find((word) => text.includes(word));

    const outputInfo: GuardrailInfo = matched ? { matchedWord: matched } : undefined;

    return {
      tripwireTriggered: Boolean(matched),
      outputInfo,
    };
  },
};

const shortSummaryOutputGuardrail: OutputGuardrail = {
  name: 'RequireSummaryPrefix',
  execute: async ({ agentOutput }) => {
    const outputText = typeof agentOutput === 'string' ? agentOutput : JSON.stringify(agentOutput);
    const isFormatted = outputText.trim().toLowerCase().startsWith('summary:');

    return {
      tripwireTriggered: !isFormatted,
      outputInfo: isFormatted
        ? undefined
        : { message: 'Responses must start with "Summary:" to pass review.' },
    };
  },
};

async function runSafePrompt(runner: Runner, agent: Agent) {
  const safePrompt = 'Summarize the benefits of writing unit tests in one sentence.';
  console.log(`Safe prompt: ${safePrompt}\n`);

  const result = await runner.run(agent, safePrompt);

  console.log('[Safe final output]');
  console.log(result.finalOutput);
}

async function runGuardrailViolation(runner: Runner, agent: Agent) {
  const riskyPrompt = 'My password is hunter2. Please rewrite it more securely.';

  console.log('\nRisky prompt (should trigger input guardrail) ...');

  try {
    await runner.run(agent, riskyPrompt);
  } catch (error) {
    if (error instanceof InputGuardrailTripwireTriggered) {
      console.error('Input guardrail blocked the request:');
      console.error(JSON.stringify(error.result.output.outputInfo ?? {}, null, 2));
      return;
    }

    if (error instanceof OutputGuardrailTripwireTriggered) {
      console.error('Output guardrail blocked the response:');
      console.error(JSON.stringify(error.result.output.outputInfo ?? {}, null, 2));
      return;
    }

    console.error('Unexpected error:', error);
  }
}

async function main() {
  console.log('🛡️  Guardrails with CodexProvider and OpenAI Agents\n');

  const provider = new CodexProvider({
    defaultModel: 'gpt-5-codex',
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
  });

  const runner = new Runner({
    modelProvider: provider,
    inputGuardrails: [sensitiveInputGuardrail],
    outputGuardrails: [shortSummaryOutputGuardrail],
  });

  const agent = new Agent({
    name: 'SecureSummarizer',
    model: 'gpt-5-codex',
    instructions:
      'You summarize requests in one concise sentence. Always start your response with "Summary:".',
    inputGuardrails: [
      {
        name: 'LimitPromptLength',
        execute: async ({ input }) => {
          const text = flattenInputText(input);
          const tooLong = text.length > 400;
          return {
            tripwireTriggered: tooLong,
            outputInfo: tooLong ? { message: 'Prompts longer than 400 characters are not allowed.' } : undefined,
          };
        },
      },
    ],
  });

  await runSafePrompt(runner, agent);
  await runGuardrailViolation(runner, agent);

  console.log('\n✓ Guardrail demo complete.');
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

