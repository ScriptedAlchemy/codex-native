/**
 * Example: GitHub provider with gpt-5-mini (Responses API)
 *
 * This example mirrors the current Codex integration pattern:
 * - gpt-5-mini via Codex Thread API + structured output
 * - gpt-5-mini via CodexProvider + OpenAI Agents + tool calls
 *
 * Usage:
 *   pnpm -C sdk/native exec tsx examples/github-provider-models.ts
 */

import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Codex, CodexProvider, codexTool } from '../src/index';
import { Agent, run } from '@openai/agents';
import { z } from 'zod';

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['summary', 'notes'],
  additionalProperties: false,
} as const;

async function runGpt5MiniThread(tmpDir: string) {
  console.log('\n' + '='.repeat(70));
  console.log('Example 1: gpt-5-mini via Codex Thread (GitHub provider)');
  console.log('='.repeat(70));

  const codex = new Codex({
    defaultModel: 'gpt-5-mini',
    modelProvider: 'github',
  });

  const thread = codex.startThread({
    model: 'gpt-5-mini',
    modelProvider: 'github',
    workingDirectory: tmpDir,
    skipGitRepoCheck: true,
    sandboxMode: 'workspace-write',
    approvalMode: 'on-request',
  });

  const prompt = [
    'Return a JSON object with keys: summary, notes.',
    'Keep values short. No markdown.',
  ].join(' ');

  const stream = await thread.runStreamed(prompt, { outputSchema: OUTPUT_SCHEMA });

  let finalText = '';

  for await (const event of stream.events) {
    switch (event.type) {
      case 'thread.started':
        console.log('[gpt-5-mini] thread started');
        break;
      case 'turn.started':
        console.log('[gpt-5-mini] turn started');
        break;
      case 'item.updated':
        if (event.item.type === 'agent_message') {
          const text = event.item.text;
          // Print incremental text (delta) if streaming is enabled
          process.stdout.write(text.slice(finalText.length));
          finalText = text;
        }
        break;
      case 'item.completed':
        if (event.item.type === 'agent_message') {
          finalText = event.item.text;
        }
        break;
      case 'turn.completed':
        console.log('\n[gpt-5-mini] turn completed');
        console.log(`[gpt-5-mini] usage: in=${event.usage.input_tokens} out=${event.usage.output_tokens}`);
        break;
      case 'turn.failed':
        console.error(`[gpt-5-mini] turn failed: ${event.error.message}`);
        break;
      case 'error':
        console.error(`[gpt-5-mini] stream error: ${event.message}`);
        break;
    }
  }

  console.log('\n[gpt-5-mini] final response:');
  console.log(finalText || '(empty)');
}

async function runGpt5MiniAgents(tmpDir: string) {
  console.log('\n' + '='.repeat(70));
  console.log('Example 2: gpt-5-mini via CodexProvider + Agents (GitHub provider)');
  console.log('='.repeat(70));

  const provider = new CodexProvider({
    defaultModel: 'gpt-5-mini',
    modelProvider: 'github',
    workingDirectory: tmpDir,
    skipGitRepoCheck: true,
    sandboxMode: 'workspace-write',
    approvalMode: 'on-request',
  });

  const addTool = codexTool({
    name: 'add',
    description: 'Add two numbers',
    parameters: z.object({
      a: z.number(),
      b: z.number(),
    }),
    execute: async ({ a, b }) => {
      return `${a} + ${b} = ${a + b}`;
    },
  });

  const agent = new Agent({
    name: 'AdderAgentMini',
    model: provider.getModel('gpt-5-mini'),
    instructions: [
      'Use the add tool twice.',
      'Call add(7, 8) and add(9, 10).',
      'Then respond with a short sentence that includes both results.',
    ].join(' '),
    tools: [addTool],
    modelSettings: {
      toolChoice: 'add',
    },
  });

  const stream = await run(agent, 'Perform the two additions now.', { stream: true });

  let text = '';
  let rawLogged = false;

  if (!stream || !(Symbol.asyncIterator in Object(stream))) {
    throw new Error('Expected an async iterable stream from agents runner.');
  }

  for await (const ev of stream as AsyncIterable<{ type?: string; [key: string]: unknown }>) {
    switch (ev.type) {
      case 'response_started':
        console.log('[gpt-5-mini] response started');
        break;
      case 'run_item_stream_event':
        if (ev.name === 'tool_called') {
          const name = ev.item?.name ?? ev.item?.rawItem?.name ?? 'unknown_tool';
          console.log(`[gpt-5-mini] tool_called ${name}`);
        }
        if (ev.name === 'tool_output') {
          const name = ev.item?.name ?? ev.item?.rawItem?.name ?? 'unknown_tool';
          console.log(`[gpt-5-mini] tool_output ${name}`);
        }
        break;
      case 'output_text_delta':
        if (typeof ev.delta === 'string') {
          process.stdout.write(ev.delta);
          text += ev.delta;
        }
        break;
      case 'response.completed':
      case 'response_done':
        if (!text) {
          const outputText = (ev as { response?: { output_text?: string } }).response?.output_text;
          if (outputText) {
            text = outputText;
          }
        }
        console.log('\n[gpt-5-mini] response completed');
        break;
      case 'error':
        console.error(`[gpt-5-mini] error: ${ev.error?.message ?? ev.message ?? 'unknown error'}`);
        break;
      default:
        if (ev.type === 'raw_model_stream_event') {
          const data = (ev as { data?: unknown }).data as
            | {
                type?: string;
                delta?: string;
              }
            | undefined;
          if (data?.type === 'output_text_delta' && typeof data.delta === 'string') {
            process.stdout.write(data.delta);
            text += data.delta;
          }
          const debugEnabled =
            process.env.DEBUG === '1' || process.env.DEBUG === 'true';
          if (debugEnabled && !rawLogged) {
            rawLogged = true;
            try {
              console.log('[gpt-5-mini] raw_model_stream_event keys:', Object.keys(ev));
              const snippet = JSON.stringify(ev).slice(0, 400);
              console.log(`[gpt-5-mini] raw_model_stream_event sample: ${snippet}`);
            } catch {
              // ignore
            }
          }
        }
        if (
          (process.env.DEBUG === '1' || process.env.DEBUG === 'true') &&
          ev.type !== 'raw_model_stream_event'
        ) {
          console.log(`[gpt-5-mini] event ${ev.type ?? 'unknown'}`);
        }
    }
  }

  console.log('\n[gpt-5-mini] final response:');
  console.log(text || '(empty)');
}

async function main() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-github-models-'));
  console.log(`Temp directory: ${tmpDir}`);

  try {
    try {
      await runGpt5MiniThread(tmpDir);
    } catch (error) {
      console.error(`[gpt-5-mini] example failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      await runGpt5MiniAgents(tmpDir);
    } catch (error) {
      console.error(`[gpt-5-mini] example failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

export { main };
