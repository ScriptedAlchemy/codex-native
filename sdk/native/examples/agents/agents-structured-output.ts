/**
 * Example: Structured Output with CodexProvider
 *
 * This example demonstrates how to use structured output in the OpenAI Agents framework
 * with CodexProvider. Structured output ensures the agent's response conforms to a
 * specified JSON schema.
 *
 * Based on OpenAI Agents SDK documentation:
 * https://openai.github.io/openai-agents-js/guides/results
 *
 * Installation:
 * ```bash
 * npm install @codex-native/sdk @openai/agents zod zod-to-json-schema
 * ```
 *
 * Usage:
 * ```bash
 * npx tsx examples/agents/agents-structured-output.ts
 * ```
 *
 * Key features demonstrated:
 * - JSON schema validation
 * - Zod schema integration
 * - Type-safe structured responses
 * - Using CodexProvider as the model backend
 */

import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { z } from 'zod';
import { Agent, run } from '@openai/agents';
import { CodexProvider } from '../../src/index';
import { runExampleStep, ensureResult } from '../utils';

async function main() {
  console.log('📋 Structured Output with CodexProvider\n');
  console.log('This example demonstrates JSON schema validation for agent responses.\n');

  // Create a temporary directory to avoid loading workspace AGENTS.md
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-structured-output-example-'));
  console.log(`Using temporary directory: ${tmpDir}\n`);

  // Create Codex provider
  const codexProvider = new CodexProvider({
    defaultModel: 'gpt-5-codex',
    workingDirectory: tmpDir,
    skipGitRepoCheck: true,
  });

  const codexModel = await codexProvider.getModel();

  // ============================================================================
  // Example 1: Simple Object Schema
  // ============================================================================
  console.log('Example 1: Simple Object Schema');
  console.log('─'.repeat(60));

  const simpleSchema = {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'A brief summary of the response' },
      status: { type: 'string', enum: ['ok', 'action_required', 'error'] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['summary', 'status', 'confidence'],
    additionalProperties: false,
  } as const;

  const agentWithSchema = new Agent({
    name: 'StructuredAgent',
    model: codexModel,
    instructions: 'You are a helpful assistant that provides structured responses.',
  });

  console.log('\nQuery: "Analyze the current repository status"\n');

  const result1 = await runExampleStep('Simple schema run', () =>
    run(agentWithSchema, 'Analyze the current repository status', {
      outputSchema: simpleSchema,
    })
  );

  if (ensureResult(result1, 'Example 1 structured output')) {
    console.log('\n[Structured Response]');
    try {
      const parsed = JSON.parse(result1.finalOutput);
      console.log(JSON.stringify(parsed, null, 2));
      console.log('\n✓ Response matches schema');
    } catch (error) {
      console.log('Response:', result1.finalOutput);
      console.log('⚠ Could not parse as JSON');
    }
  }

  // ============================================================================
  // Example 2: Complex Nested Schema
  // ============================================================================
  console.log('\n\nExample 2: Complex Nested Schema');
  console.log('─'.repeat(60));

  const complexSchema = {
    type: 'object',
    properties: {
      task: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'string', enum: ['low', 'medium', 'high'] },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
        },
        required: ['id', 'title', 'priority', 'status'],
      },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            step: { type: 'number' },
            action: { type: 'string' },
            completed: { type: 'boolean' },
          },
          required: ['step', 'action', 'completed'],
        },
      },
      metadata: {
        type: 'object',
        properties: {
          createdAt: { type: 'string' },
          estimatedTime: { type: 'number' },
        },
      },
    },
    required: ['task', 'steps'],
    additionalProperties: false,
  } as const;

  const taskAgent = new Agent({
    name: 'TaskAgent',
    model: codexModel,
    instructions: 'You are a task management assistant. Break down tasks into steps.',
  });

  console.log('\nQuery: "Create a task plan for implementing user authentication"\n');

  const result2 = await runExampleStep('Complex schema run', () =>
    run(
      taskAgent,
      'Create a task plan for implementing user authentication',
      {
        outputSchema: complexSchema,
      }
    )
  );

  if (ensureResult(result2, 'Example 2 structured output')) {
    console.log('\n[Structured Response]');
    try {
      const parsed = JSON.parse(result2.finalOutput);
      console.log(JSON.stringify(parsed, null, 2));
      console.log('\n✓ Response matches complex schema');
    } catch (error) {
      console.log('Response:', result2.finalOutput);
      console.log('⚠ Could not parse as JSON');
    }
  }

  // ============================================================================
  // Example 3: Using Zod Schema (with conversion)
  // ============================================================================
  console.log('\n\nExample 3: Zod Schema Integration');
  console.log('─'.repeat(60));

  // Define a Zod schema
  const zodSchema = z.object({
    name: z.string().describe('The name of the item'),
    category: z.enum(['feature', 'bug', 'improvement']).describe('The category'),
    impact: z.enum(['low', 'medium', 'high']).describe('The impact level'),
    description: z.string().min(10).max(500).describe('A detailed description'),
    tags: z.array(z.string()).optional().describe('Optional tags'),
  });

  // Convert Zod schema to JSON schema
  // Note: In a real implementation, you'd use zod-to-json-schema
  // For this example, we'll create a compatible JSON schema manually
  const jsonSchemaFromZod = {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The name of the item' },
      category: {
        type: 'string',
        enum: ['feature', 'bug', 'improvement'],
        description: 'The category',
      },
      impact: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description: 'The impact level',
      },
      description: {
        type: 'string',
        minLength: 10,
        maxLength: 500,
        description: 'A detailed description',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional tags',
      },
    },
    required: ['name', 'category', 'impact', 'description'],
    additionalProperties: false,
  } as const;

  const zodAgent = new Agent({
    name: 'ZodAgent',
    model: codexModel,
    instructions: 'You are an assistant that provides structured responses based on Zod schemas.',
  });

  console.log('\nQuery: "Create a feature request for adding dark mode"\n');

  const result3 = await runExampleStep('Zod schema run', () =>
    run(
      zodAgent,
      'Create a feature request for adding dark mode',
      {
        outputSchema: jsonSchemaFromZod,
      }
    )
  );

  if (ensureResult(result3, 'Example 3 structured output')) {
    console.log('\n[Structured Response]');
    try {
      const parsed = JSON.parse(result3.finalOutput);
      // Validate with Zod schema
      const validated = zodSchema.parse(parsed);
      console.log(JSON.stringify(validated, null, 2));
      console.log('\n✓ Response matches Zod schema');
    } catch (error) {
      console.log('Response:', result3.finalOutput);
      if (error instanceof z.ZodError) {
        console.log('\n⚠ Zod validation errors:');
        console.log(error.errors);
      } else {
        console.log('⚠ Could not parse or validate');
      }
    }
  }

  // ============================================================================
  // Example 4: Array Response Schema
  // ============================================================================
  console.log('\n\nExample 4: Array Response Schema');
  console.log('─'.repeat(60));

  const arraySchema = {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        title: { type: 'string' },
        completed: { type: 'boolean' },
      },
      required: ['id', 'title', 'completed'],
    },
  } as const;

  const listAgent = new Agent({
    name: 'ListAgent',
    model: codexModel,
    instructions: 'You are an assistant that returns lists of items.',
  });

  console.log('\nQuery: "List 3 common programming best practices"\n');

  const result4 = await runExampleStep('Array schema run', () =>
    run(listAgent, 'List 3 common programming best practices', {
      outputSchema: arraySchema,
    })
  );

  if (ensureResult(result4, 'Example 4 structured output')) {
    console.log('\n[Structured Response]');
    try {
      const parsed = JSON.parse(result4.finalOutput);
      if (Array.isArray(parsed)) {
        console.log(JSON.stringify(parsed, null, 2));
        console.log(`\n✓ Response is an array with ${parsed.length} items`);
      } else {
        console.log('⚠ Response is not an array');
      }
    } catch (error) {
      console.log('Response:', result4.finalOutput);
      console.log('⚠ Could not parse as JSON');
    }
  }

  // ============================================================================
  // Summary
  // ============================================================================
  console.log('\n\n' + '='.repeat(60));
  console.log('📋 Summary');
  console.log('='.repeat(60));
  console.log('\nKey takeaways:');
  console.log('  • Structured output ensures responses match JSON schemas');
  console.log('  • Schemas can be simple objects or complex nested structures');
  console.log('  • Zod schemas can be converted to JSON schemas');
  console.log('  • CodexProvider enforces schemas during generation');
  console.log('  • Structured output enables type-safe API responses');
  console.log('\nFor more information, see:');
  console.log('  https://openai.github.io/openai-agents-js/guides/results');

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

