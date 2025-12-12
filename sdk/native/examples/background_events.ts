/**
 * Example: Background Event Streaming Demo
 *
 * This example shows how to publish mid-turn background notifications while
 * streaming results from the Codex Native SDK. Background events are useful
 * for surfacing progress updates without enqueueing additional user messages.
 *
 * Usage:
 * ```bash
 * npx tsx examples/background_events.ts
 * ```
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { Codex } from '../src/index';

async function main() {
  console.log('🛰️  Background Event Streaming Demo\n');
  console.log('This example streams a turn, emits progress updates, and logs the');
  console.log('background notifications that arrive from the agent.\n');

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-background-demo-'));
  console.log(`Working directory: ${tmpDir}\n`);

  const codex = new Codex();
  const thread = codex.startThread({
    workingDirectory: tmpDir,
    skipGitRepoCheck: true,
  });

  const prompts = [
    'Gathering repository context…',
    'Reviewing diagnostics…',
    'Finishing up the response…',
  ];

  console.log('Query: "background event demo"\n');
  console.log('[Streaming with background notifications]\n');

  try {
    const streamed = await thread.runStreamed('background event demo');

    let nextPrompt = 0;
    let finalMessage = '';

    for await (const event of streamed.events) {
      switch (event.type) {
        case 'thread.started':
          console.log('📡 Thread started\n');
          break;
        case 'turn.started':
          console.log('🚀 Turn started, sending background updates…\n');
          if (nextPrompt < prompts.length) {
            await thread.sendBackgroundEvent(prompts[nextPrompt]!);
            nextPrompt += 1;
          }
          break;
        case 'background_event':
          console.log(`🛠️  Background: ${event.message}`);
          if (nextPrompt < prompts.length) {
            await thread.sendBackgroundEvent(prompts[nextPrompt]!);
            nextPrompt += 1;
          }
          break;
        case 'item.completed':
          if (event.item.type === 'agent_message') {
            finalMessage = event.item.text;
          }
          break;
        case 'turn.completed':
          console.log('\n✓ Turn completed');
          console.log(`📊 Usage: ${event.usage.input_tokens + event.usage.output_tokens} total tokens`);
          break;
        case 'turn.failed':
          console.error('\n✗ Turn failed:', event.error.message);
          break;
      }
    }

    if (finalMessage) {
      console.log('\nAssistant response:\n');
      console.log(finalMessage);
    }
  } catch (error) {
    console.error('Error while streaming turn:', error instanceof Error ? error.message : String(error));
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup failures
    }
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { main };
