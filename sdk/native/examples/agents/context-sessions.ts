/**
 * Example: Context Management and Sessions
 *
 * This example demonstrates how to manage conversation context across
 * multiple turns, maintain sessions, and handle long-running conversations
 * with agents.
 *
 * Key concepts:
 * - Creating and resuming conversation sessions
 * - Managing conversation history and context
 * - Multi-turn conversations with memory
 * - Context preservation across agent runs
 *
 * Installation:
 * ```bash
 * npm install @codex-native/sdk @openai/agents
 * ```
 *
 * Usage:
 * ```bash
 * npx tsx examples/agents/context-sessions.ts
 * ```
 */

import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Agent, run, withTrace } from '@openai/agents';
import { CodexProvider } from '../../src/index';

async function main() {
  console.log('💬 Context Management and Sessions Example\n');
  console.log('This example demonstrates conversation continuity and context');
  console.log('management across multiple agent interactions.\n');

  // Create a temporary directory
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-sessions-'));
  console.log(`Working directory: ${tmpDir}\n`);

  // Create Codex provider
  const codexProvider = new CodexProvider({
    defaultModel: 'gpt-5-codex',
    workingDirectory: tmpDir,
    skipGitRepoCheck: true,
  });

  const codexModel = await codexProvider.getModel();

  // ============================================================================
  // Example 1: Multi-Turn Conversation with Context
  // ============================================================================

  console.log('Example 1: Multi-Turn Conversation');
  console.log('─'.repeat(60));

  const tutorAgent = new Agent({
    name: 'ProgrammingTutor',
    model: codexModel,
    instructions: `You are a patient programming tutor. Help students learn by:
- Answering their questions clearly
- Remembering what you've taught them
- Building on previous concepts
- Providing examples when helpful`,
  });

  await withTrace('Programming Tutorial Session', async () => {
    console.log('\n[Student] Starting a learning session about functions...\n');

    // Turn 1: Initial question
    console.log('Turn 1: What are functions?');
    const turn1 = await run(tutorAgent, 'What are functions in programming?');
    console.log(`[Tutor] ${turn1.finalOutput.substring(0, 150)}...\n`);

    // Turn 2: Follow-up question (should reference previous context)
    console.log('Turn 2: Follow-up about parameters');
    const turn2 = await run(
      tutorAgent,
      'Can you explain more about the parameters you mentioned?',
      { previousResponseId: turn1.conversationId }
    );
    console.log(`[Tutor] ${turn2.finalOutput.substring(0, 150)}...\n`);

    // Turn 3: Request an example (building on context)
    console.log('Turn 3: Request example');
    const turn3 = await run(
      tutorAgent,
      'Can you show me a simple example?',
      { previousResponseId: turn2.conversationId }
    );
    console.log(`[Tutor] ${turn3.finalOutput.substring(0, 150)}...\n`);

    // Turn 4: Test understanding
    console.log('Turn 4: Student asks about return values');
    const turn4 = await run(
      tutorAgent,
      'What does it mean when a function returns a value?',
      { previousResponseId: turn3.conversationId }
    );
    console.log(`[Tutor] ${turn4.finalOutput.substring(0, 150)}...\n`);

    console.log('✓ Multi-turn conversation complete!');
    console.log('  Context was maintained across all 4 turns');
  });

  // ============================================================================
  // Example 2: Session Management with Conversation IDs
  // ============================================================================

  console.log('\n' + '='.repeat(60));
  console.log('Example 2: Managing Multiple Conversation Sessions');
  console.log('─'.repeat(60));

  const assistantAgent = new Agent({
    name: 'DevAssistant',
    model: codexModel,
    instructions: 'You are a development assistant helping with coding tasks.',
  });

  // Simulate multiple concurrent "users" or "projects"
  const sessions: Map<string, string> = new Map();

  await withTrace('Multiple Sessions', async () => {
    console.log('\nSimulating multiple concurrent conversation sessions...\n');

    // Session A: Working on authentication
    console.log('[Session A - Auth] Starting discussion...');
    const sessionA1 = await run(
      assistantAgent,
      'I need to implement JWT authentication. Where should I start?'
    );
    sessions.set('auth', sessionA1.conversationId || '');
    console.log(`[Assistant] ${sessionA1.finalOutput.substring(0, 100)}...\n`);

    // Session B: Working on database
    console.log('[Session B - Database] Starting discussion...');
    const sessionB1 = await run(
      assistantAgent,
      'I need to design a user database schema. What tables should I create?'
    );
    sessions.set('database', sessionB1.conversationId || '');
    console.log(`[Assistant] ${sessionB1.finalOutput.substring(0, 100)}...\n`);

    // Continue Session A
    console.log('[Session A - Auth] Continuing with follow-up...');
    const sessionA2 = await run(
      assistantAgent,
      'What library should I use for JWT in Node.js?',
      { previousResponseId: sessions.get('auth') }
    );
    sessions.set('auth', sessionA2.conversationId || '');
    console.log(`[Assistant] ${sessionA2.finalOutput.substring(0, 100)}...\n`);

    // Continue Session B
    console.log('[Session B - Database] Adding constraints...');
    const sessionB2 = await run(
      assistantAgent,
      'Should I add any constraints to the users table?',
      { previousResponseId: sessions.get('database') }
    );
    sessions.set('database', sessionB2.conversationId || '');
    console.log(`[Assistant] ${sessionB2.finalOutput.substring(0, 100)}...\n`);

    console.log('✓ Multiple sessions managed successfully!');
    console.log(`  Session A (auth): ${sessions.get('auth')?.substring(0, 20)}...`);
    console.log(`  Session B (database): ${sessions.get('database')?.substring(0, 20)}...`);
  });

  // ============================================================================
  // Example 3: Context Window Management
  // ============================================================================

  console.log('\n' + '='.repeat(60));
  console.log('Example 3: Managing Long Conversations');
  console.log('─'.repeat(60));

  const reviewerAgent = new Agent({
    name: 'CodeReviewer',
    model: codexModel,
    instructions: `You are a code reviewer. Review code files one at a time and 
maintain context about the overall project structure and patterns.`,
  });

  await withTrace('Long Review Session', async () => {
    console.log('\nReviewing multiple files in sequence...\n');

    const files = [
      { name: 'auth.ts', content: 'export function login(username: string) { /* ... */ }' },
      { name: 'user.ts', content: 'export class User { constructor(public name: string) {} }' },
      { name: 'db.ts', content: 'export function connect() { /* ... */ }' },
    ];

    let conversationId: string | undefined;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      console.log(`[${i + 1}/${files.length}] Reviewing ${file!.name}...`);

      const prompt =
        i === 0
          ? `Start a code review. First file to review:\n\nFile: ${file!.name}\n${file!.content}`
          : `Continue the review. Next file:\n\nFile: ${file!.name}\n${file!.content}\n\nConsider how this relates to previously reviewed files.`;

      const result = await run(reviewerAgent, prompt, {
        previousResponseId: conversationId,
      });

      conversationId = result.conversationId;
      console.log(`   Review: ${result.finalOutput.substring(0, 120)}...\n`);
    }

    // Final summary that references all previous context
    console.log('Requesting overall summary...');
    const summary = await run(
      reviewerAgent,
      'Based on all the files reviewed, provide an overall assessment of the code quality and architecture.',
      { previousResponseId: conversationId }
    );
    console.log(`\nFinal Summary: ${summary.finalOutput.substring(0, 200)}...\n`);

    console.log('✓ Long conversation completed!');
    console.log('  Reviewed 3 files + 1 summary = 4 turns');
    console.log('  Context maintained throughout the session');
  });

  // ============================================================================
  // Example 4: Context-Aware Collaboration
  // ============================================================================

  console.log('\n' + '='.repeat(60));
  console.log('Example 4: Context-Aware Multi-Agent Collaboration');
  console.log('─'.repeat(60));

  const architectAgent = new Agent({
    name: 'Architect',
    model: codexModel,
    instructions: 'You are a software architect focused on system design.',
  });

  const implementerAgent = new Agent({
    name: 'Implementer',
    model: codexModel,
    instructions: 'You implement designs provided by architects.',
  });

  await withTrace('Collaborative Design', async () => {
    console.log('\nCollaborative design session...\n');

    // Architect designs the system
    console.log('[Architect] Designing payment system...');
    const design = await run(
      architectAgent,
      'Design a simple payment processing system with the following requirements: accept payments, handle refunds, store transaction history.'
    );
    console.log(`Design: ${design.finalOutput.substring(0, 150)}...\n`);

    // Implementer asks for clarification (new conversation, but references design)
    console.log('[Implementer] Reviewing design and asking questions...');
    const clarification = await run(
      implementerAgent,
      `I'm implementing this payment system design:\n\n${design.finalOutput}\n\nWhat payment providers should I support initially?`
    );
    console.log(`Response: ${clarification.finalOutput.substring(0, 150)}...\n`);

    // Architect responds (continues their conversation)
    console.log('[Architect] Responding to implementation questions...');
    const response = await run(
      architectAgent,
      `The implementer asked: What payment providers should we support? Based on the design I provided, what would you recommend?`,
      { previousResponseId: design.conversationId }
    );
    console.log(`Recommendation: ${response.finalOutput.substring(0, 150)}...\n`);

    console.log('✓ Collaborative session complete!');
    console.log('  Multiple agents maintained their own conversation contexts');
    console.log('  Context shared through explicit message passing');
  });

  // ============================================================================
  // Summary
  // ============================================================================

  console.log('\n' + '='.repeat(60));
  console.log('✓ Context and Session Management Examples Complete!');
  console.log('='.repeat(60));
  console.log('\nKey Takeaways:');
  console.log('  • Conversation context enables natural multi-turn interactions');
  console.log('  • Session IDs allow managing multiple concurrent conversations');
  console.log('  • Long conversations can reference previous context');
  console.log('  • Multiple agents can collaborate with context awareness');
  console.log('  • CodexProvider handles context management automatically');

  // Cleanup
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch (e) {
    // Ignore cleanup errors
  }
}

// Run if executed directly
if (require.main === module) {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { main };

