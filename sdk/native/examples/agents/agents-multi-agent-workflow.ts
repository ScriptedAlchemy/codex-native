/**
 * Example: Complex Multi-Agent Workflow with CodexProvider
 *
 * This example demonstrates a complex multi-agent workflow using the OpenAI Agents
 * framework with CodexProvider. It shows how multiple specialized agents can
 * collaborate on a complex task.
 *
 * Based on OpenAI Agents SDK documentation:
 * https://openai.github.io/openai-agents-js/guides/orchestrating-multiple-agents
 *
 * Installation:
 * ```bash
 * npm install @codex-native/sdk @openai/agents
 * ```
 *
 * Usage:
 * ```bash
 * npx tsx examples/agents/agents-multi-agent-workflow.ts
 * ```
 *
 * Key features demonstrated:
 * - Multiple specialized agents working together
 * - Agent handoffs and delegation
 * - Context sharing between agents
 * - Complex workflow orchestration
 * - Using CodexProvider as the model backend
 */

import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Agent, run, handoff } from '@openai/agents';
import { CodexProvider } from '../../src/index';
import { runExampleStep, ensureResult } from '../utils';

async function main() {
  console.log('🔄 Complex Multi-Agent Workflow with CodexProvider\n');
  console.log('This example demonstrates multiple agents collaborating on a complex task.\n');

  // Create a temporary directory to avoid loading workspace AGENTS.md
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-multi-agent-example-'));
  console.log(`Using temporary directory: ${tmpDir}\n`);

  // Create Codex provider
  const codexProvider = new CodexProvider({
    defaultModel: 'gpt-5-codex',
    workingDirectory: tmpDir,
    skipGitRepoCheck: true,
  });

  const codexModel = await codexProvider.getModel();

  // ============================================================================
  // Define Specialized Agents
  // ============================================================================

  // Product Manager Agent - Defines requirements
  const productManager = new Agent({
    name: 'ProductManager',
    model: codexModel,
    instructions: `You are a product manager. Your job is to:
- Understand user requirements
- Define clear product specifications
- Break down features into actionable tasks
- Hand off to Architect when technical design is needed
- Be thorough and clear in your specifications`,
  });

  // Architect Agent - Designs the system
  const architect = new Agent({
    name: 'Architect',
    model: codexModel,
    instructions: `You are a software architect. Your job is to:
- Design system architecture based on requirements
- Define technical specifications
- Choose appropriate technologies and patterns
- Hand off to Developer when implementation is needed
- Focus on scalability, maintainability, and best practices`,
  });

  // Developer Agent - Implements the code
  const developer = new Agent({
    name: 'Developer',
    model: codexModel,
    instructions: `You are a software developer. Your job is to:
- Implement code based on architectural designs
- Write clean, maintainable, well-documented code
- Follow best practices and coding standards
- Hand off to Tester when code is ready for testing
- Ensure code quality and correctness`,
  });

  // Tester Agent - Tests the implementation
  const tester = new Agent({
    name: 'Tester',
    model: codexModel,
    instructions: `You are a QA tester. Your job is to:
- Write comprehensive test cases
- Test the implementation thoroughly
- Identify bugs and issues
- Hand off back to Developer if fixes are needed
- Provide final quality assessment`,
  });

  // Documentation Agent - Writes documentation
  const documenter = new Agent({
    name: 'Documenter',
    model: codexModel,
    instructions: `You are a technical writer. Your job is to:
- Write clear, comprehensive documentation
- Document APIs, usage, and examples
- Create user guides and tutorials
- Ensure documentation is accurate and up-to-date`,
  });

  // ============================================================================
  // Configure Handoffs
  // ============================================================================

  productManager.handoffs = [handoff(architect)];

  architect.handoffs = [handoff(developer), handoff(documenter)];

  developer.handoffs = [handoff(tester), handoff(documenter)];

  tester.handoffs = [handoff(developer), handoff(documenter)];

  // ============================================================================
  // Example: Full Development Workflow
  // ============================================================================
  console.log('Example: Full Development Workflow');
  console.log('─'.repeat(60));
  console.log('\nWorkflow: ProductManager → Architect → Developer → Tester → Documenter\n');

  const task = 'Create a user authentication system with email/password login';

  console.log(`Task: "${task}"\n`);
  console.log('Starting workflow...\n');

  // Step 1: Product Manager defines requirements
  console.log('📋 Step 1: Product Manager defining requirements...');
  console.log('─'.repeat(60));
  const pmResult = await runExampleStep('Product Manager requirements', () =>
    run(productManager, task)
  );

  if (ensureResult(pmResult, 'the remaining workflow steps')) {
    console.log('\n[Product Manager Output]');
    console.log((pmResult.finalOutput ?? '').substring(0, 300) + '...\n');

    // Step 2: Architect designs the system
    console.log('\n🏗️  Step 2: Architect designing system...');
    console.log('─'.repeat(60));
    const archResult = await runExampleStep('Architect design', () =>
      run(
        architect,
        `Based on these requirements, design the architecture:\n\n${pmResult.finalOutput ?? ''}`
      )
    );

    if (ensureResult(archResult, 'the remaining workflow steps')) {
      console.log('\n[Architect Output]');
      console.log((archResult.finalOutput ?? '').substring(0, 300) + '...\n');

      // Step 3: Developer implements
      console.log('\n💻 Step 3: Developer implementing...');
      console.log('─'.repeat(60));
      const devResult = await runExampleStep('Developer implementation', () =>
        run(
          developer,
          `Based on this architecture, implement the code:\n\n${archResult.finalOutput ?? ''}`
        )
      );

      if (ensureResult(devResult, 'the remaining workflow steps')) {
        console.log('\n[Developer Output]');
        console.log((devResult.finalOutput ?? '').substring(0, 300) + '...\n');

        // Step 4: Tester tests
        console.log('\n🧪 Step 4: Tester testing...');
        console.log('─'.repeat(60));
        const testResult = await runExampleStep('Tester review', () =>
          run(
            tester,
            `Review and test this implementation:\n\n${devResult.finalOutput ?? ''}`
          )
        );

        if (ensureResult(testResult, 'the remaining workflow steps')) {
          console.log('\n[Tester Output]');
          console.log((testResult.finalOutput ?? '').substring(0, 300) + '...\n');

          // Step 5: Documenter writes docs
          console.log('\n📚 Step 5: Documenter writing documentation...');
          console.log('─'.repeat(60));
          const docResult = await runExampleStep('Documenter write-up', () =>
            run(
              documenter,
              `Write documentation for this feature:\n\nRequirements: ${(pmResult.finalOutput ?? '').substring(0, 200)}\n\nImplementation: ${(devResult.finalOutput ?? '').substring(0, 200)}`
            )
          );

          if (ensureResult(docResult, 'the remaining workflow steps')) {
            console.log('\n[Documenter Output]');
            console.log((docResult.finalOutput ?? '').substring(0, 300) + '...\n');
          }
        }
      }
    }
  }

  // ============================================================================
  // Example: Parallel Agent Workflow
  // ============================================================================
  console.log('\n\nExample: Parallel Agent Workflow');
  console.log('─'.repeat(60));
  console.log('\nMultiple agents working on different aspects simultaneously\n');

  const parallelTask = 'Design a REST API for a blog system';

  console.log(`Task: "${parallelTask}"\n`);

  // Run multiple agents in parallel (simulated)
  console.log('Running agents in parallel...\n');

  const [apiDesign, dbDesign, securityDesign] = await Promise.all([
    runExampleStep('API design exploration', () =>
      run(
        architect,
        `${parallelTask} - Focus on API endpoints and request/response formats`
      )
    ),
    runExampleStep('Database design exploration', () =>
      run(
        architect,
        `${parallelTask} - Focus on database schema and data modeling`
      )
    ),
    runExampleStep('Security design exploration', () =>
      run(
        architect,
        `${parallelTask} - Focus on security and authentication`
      )
    ),
  ]);

  if (
    ensureResult(apiDesign, 'parallel workflow results') &&
    ensureResult(dbDesign, 'parallel workflow results') &&
    ensureResult(securityDesign, 'parallel workflow results')
  ) {
    console.log('✓ API Design completed');
    console.log('✓ Database Design completed');
    console.log('✓ Security Design completed');

    console.log('\n[Combined Results]');
    console.log('\nAPI Design:');
    console.log((apiDesign.finalOutput ?? '').substring(0, 200) + '...');
    console.log('\nDatabase Design:');
    console.log((dbDesign.finalOutput ?? '').substring(0, 200) + '...');
    console.log('\nSecurity Design:');
    console.log((securityDesign.finalOutput ?? '').substring(0, 200) + '...');
  }

  console.log('\n\nExample: Iterative Refinement Workflow');
  console.log('─'.repeat(60));
  console.log('\nAgents iteratively refining a solution\n');

  const iterativeTask = 'Create a function to sort an array';

  console.log(`Task: "${iterativeTask}"\n`);

  // Initial implementation
  console.log('🔄 Iteration 1: Initial implementation');
  let currentCode = await runExampleStep('Initial implementation', () =>
    run(developer, iterativeTask)
  );

  if (ensureResult(currentCode, 'iterative workflow steps')) {
    console.log('Code:', (currentCode.finalOutput ?? '').substring(0, 200) + '...\n');

    // Test and get feedback
    console.log('🔄 Iteration 2: Testing and feedback');
    const testFeedback = await runExampleStep('Testing feedback', () =>
      run(
        tester,
        `Test this code and provide feedback:\n\n${currentCode.finalOutput ?? ''}`
      )
    );
    if (ensureResult(testFeedback, 'iterative workflow steps')) {
      console.log('Feedback:', testFeedback.finalOutput?.substring(0, 200) + '...\n');

      // Refine based on feedback
      console.log('🔄 Iteration 3: Refining based on feedback');
      const refinedCode = await runExampleStep('Refined implementation', () =>
        run(
          developer,
          `Improve this code based on feedback:\n\nOriginal: ${currentCode.finalOutput ?? ''}\n\nFeedback: ${testFeedback.finalOutput ?? ''}`
        )
      );
      if (ensureResult(refinedCode, 'iterative workflow steps')) {
        console.log('Refined Code:', refinedCode.finalOutput?.substring(0, 200) + '...\n');
      }
    }
  }

  console.log('✓ Iterative refinement completed');

  // ============================================================================
  // Summary
  // ============================================================================
  console.log('\n\n' + '='.repeat(60));
  console.log('📋 Summary');
  console.log('='.repeat(60));
  console.log('\nKey takeaways:');
  console.log('  • Multiple agents can collaborate on complex tasks');
  console.log('  • Handoffs enable seamless task delegation');
  console.log('  • Context is maintained across agent interactions');
  console.log('  • Agents can work in parallel for efficiency');
  console.log('  • Iterative workflows enable refinement');
  console.log('  • CodexProvider supports all multi-agent patterns');
  console.log('\nWorkflow patterns demonstrated:');
  console.log('  • Sequential workflow: ProductManager → Architect → Developer → Tester');
  console.log('  • Parallel workflow: Multiple agents working simultaneously');
  console.log('  • Iterative workflow: Developer ↔ Tester refinement loop');
  console.log('\nFor more information, see:');
  console.log('  https://openai.github.io/openai-agents-js/guides/orchestrating-multiple-agents');

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

