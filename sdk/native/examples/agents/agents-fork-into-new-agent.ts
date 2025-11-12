/**
 * Example: Fork a Codex conversation and continue with a different Agent
 *
 * Goal:
 * - Run Agent A to establish context (cached on the Codex thread)
 * - Fork the underlying Codex thread at a chosen user message
 * - Run Agent B against the fork via Agents runner using conversationId=fork.id
 *
 * Why:
 * - Preserves server-side conversation/cache state while switching to a specialized agent
 * - Useful when you want isolation from the original path but keep token caching benefits
 *
 * Installation:
 * ```bash
 * npm install @codex-native/sdk @openai/agents
 * ```
 *
 * Usage:
 * ```bash
 * npx tsx sdk/native/examples/agents/agents-fork-into-new-agent.ts
 * ```
 */

import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Agent, Runner } from '@openai/agents';
import { CodexProvider, Codex } from '../../src/index';

async function main() {
  console.log('🔀 Fork Codex thread and continue with a different Agent\n');

  // Use a temporary working directory to avoid picking up workspace AGENTS.md
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-fork-into-agent-'));
  console.log(`Working directory: ${tmpDir}\n`);

  // 1) Provider setup (Codex as model backend for Agents)
  const provider = new CodexProvider({
    defaultModel: 'gpt-5-codex-mini',
    workingDirectory: tmpDir,
    skipGitRepoCheck: true,
  });
  const runner = new Runner({ modelProvider: provider });

  // 2) Define two agents with different instructions
  const planner = new Agent({
    name: 'Planner',
    instructions:
      'Draft a concise refactor plan for the auth module. Focus on high-impact steps.',
  });

  const implementer = new Agent({
    name: 'Implementer',
    instructions:
      'Implement the selected step with production-quality code and tests. Be practical and specific.',
  });

  // 3) Run Agent A (Planner) to build context on the Codex thread
  console.log('Step 1: Run Planner to create baseline plan...');
  const planResult = await runner.run(
    planner,
    'Create a refactor plan for the auth module with 3–5 steps.'
  );

  const baseThreadId = planResult.lastResponseId;
  if (!baseThreadId) {
    throw new Error('Planner run did not return a responseId (thread id).');
  }
  console.log(`Base thread id: ${baseThreadId}\n`);

  // 4) Fork the underlying Codex thread (provider-level)
  //    We resume the thread by id, then fork before the first user message (index 0).
  console.log('Step 2: Fork the Codex thread before the first user message...');
  const codex = new Codex({ skipGitRepoCheck: true });
  const baseThread = codex.resumeThread(baseThreadId, {
    workingDirectory: tmpDir,
    skipGitRepoCheck: true,
  });
  const forked = await baseThread.fork({
    nthUserMessage: 0,
    threadOptions: {
      // Optionally switch model or sandbox for the fork
      model: 'gpt-5-codex',
      skipGitRepoCheck: true,
      workingDirectory: tmpDir,
    },
  });

  if (!forked.id) {
    throw new Error('Fork did not return a new thread id.');
  }
  console.log(`Forked thread id: ${forked.id}\n`);

  // 5) Run Agent B (Implementer) on the fork using conversationId=forked.id
  console.log('Step 3: Run Implementer on the forked thread (cache-aware continuity)...');
  const implResult = await runner.run(
    implementer,
    'Start implementing step 1 of the refactor. Provide the precise edits and tests.',
    {
      conversationId: forked.id,
    }
  );

  console.log('\n[Planner Output]');
  console.log(planResult.finalOutput ?? '(no output)');

  console.log('\n[Implementer Output on Fork]');
  console.log(implResult.finalOutput ?? '(no output)');

  console.log('\n✓ Completed: Forked into a new agent with conversation continuity.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


