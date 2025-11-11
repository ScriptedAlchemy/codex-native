/**
 * Example: Programmatic Plan & Todo Management
 *
 * This example demonstrates how to control the Codex agent's plan/todo list
 * directly from the Native SDK.
 *
 * Key concepts:
 * - `thread.updatePlan` — replace the entire plan
 * - `thread.addTodo`, `updateTodo`, `removeTodo`, `reorderTodos`
 * - How plan changes are applied at the start of the next turn
 * - Inspecting plan updates that come back from `thread.run`
 *
 * Installation:
 * ```bash
 * npm install @codex-native/sdk
 * ```
 *
 * Usage:
 * ```bash
 * npx tsx examples/basic/plan-management.ts
 * ```
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';

import { Codex } from '../../src/index';
import type { Thread } from '../../src/thread';
import type { ThreadItem, TodoItem } from '../../src/items';

async function main() {
  console.log('Programmatic Plan & Todo Management\n');
  console.log('This walkthrough shows how to replace and edit the agent plan from code.');
  console.log('Each modification is applied at the beginning of the next turn.\n');

  // Create a temporary directory so the demo avoids picking up repo-level config
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-plan-demo-'));
  console.log(`Working directory: ${tmpDir}\n`);

  const codex = new Codex();
  const thread = codex.startThread({
    workingDirectory: tmpDir,
    skipGitRepoCheck: true,
  });

  // Helper that runs a prompt and prints the latest plan from the turn.
  const runAndLogPlan = async (prompt: string, label: string): Promise<TodoItem[] | null> => {
    console.log(`\n${label}`);
    console.log('='.repeat(label.length));
    console.log(`Prompt: ${prompt}\n`);

    const turn = await thread.run(prompt);
    const plan = extractPlan(turn.items);
    printPlan(plan);
    return plan;
  };

  // Step 1: Start the thread so it has an id before we update the plan.
  await runAndLogPlan(
    'Let\'s start a plan management demo. Reply with "Ready."',
    'Step 1 - Kick off the session',
  );

  // Step 2: Replace the entire plan with custom steps.
  const initialPlan = [
    { step: 'Review existing documentation', status: 'pending' as const },
    { step: 'Draft the new tutorial', status: 'pending' as const },
    { step: 'Polish examples and publish', status: 'pending' as const },
  ];

  thread.updatePlan({
    explanation: 'SDK demo plan',
    plan: initialPlan,
  });
  const planAfterStep2 = await runAndLogPlan(
    'The plan has been updated programmatically. Confirm you see three steps.',
    'Step 2 - Replace the plan',
  );

  // Step 3: Apply granular edits (add an item, mark one in-progress).
  if (planAfterStep2) {
    queuePlan(thread, planAfterStep2, 'Carry the plan forward before applying incremental edits');
    thread.addTodo('Share release notes with the team');
    if (planAfterStep2.length > 1) {
      thread.updateTodo(1, { status: 'in_progress' });
    }

    const planAfterStep3 = await runAndLogPlan(
      'The plan was modified programmatically (added a task and marked one in progress). Give a quick status.',
      'Step 3 - Edit the plan incrementally',
    );

    // Step 4: Complete and remove tasks through the helpers.
    if (planAfterStep3) {
      queuePlan(thread, planAfterStep3, 'Prepare plan for completion and cleanup');
      thread.updateTodo(0, { status: 'completed' });
      if (planAfterStep3.length > 0) {
        thread.removeTodo(planAfterStep3.length - 1);
      }
    }
  }

  await runAndLogPlan(
    'One item should now be complete and the extra task removed. Summarize the remaining work.',
    'Step 4 - Finish items and clean up',
  );

  console.log('\nDemo complete! The output above shows each plan mutation reflected in the next turn.');
}

function queuePlan(thread: Thread, plan: TodoItem[], explanation: string): void {
  thread.updatePlan({
    explanation,
    plan: plan.map((item) => ({
      step: item.text,
      status: item.completed ? 'completed' : 'pending',
    })),
  });
}

function printPlan(plan: TodoItem[] | null): void {
  if (!plan) {
    console.log('No plan items were returned in this turn.');
    return;
  }

  console.log('Current plan:');
  plan.forEach((item, index) => {
    const status = item.completed ? 'completed' : 'pending';
    console.log(`  ${index + 1}. [${status}] ${item.text}`);
  });
}

function extractPlan(items: ThreadItem[]): TodoItem[] | null {
  const planItem = items.find(
    (item): item is Extract<ThreadItem, { type: 'todo_list'; items: TodoItem[] }> =>
      item.type === 'todo_list',
  );
  return planItem?.items ?? null;
}

main().catch((error) => {
  console.error('\n❌ Plan management demo failed:', error);
  process.exitCode = 1;
});

