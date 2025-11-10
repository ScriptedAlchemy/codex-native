/**
 * Example: Structured Output with Native SDK
 *
 * This example demonstrates how to use JSON schemas to get structured,
 * validated output directly from the Codex Native SDK (similar to the
 * TypeScript SDK API).
 *
 * Key concepts:
 * - Defining JSON schemas for structured output
 * - Using zod for type-safe schema definition
 * - Validating agent responses against schemas
 * - Direct Thread.run() method usage
 *
 * Installation:
 * ```bash
 * npm install @codex-native/sdk zod zod-to-json-schema
 * ```
 *
 * Usage:
 * ```bash
 * npx tsx examples/structured_output.ts
 * ```
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { z } from 'zod';
import { Codex } from '../src/index';

async function main() {
  console.log('📊 Structured Output with Native SDK\n');
  console.log('This example shows how to get validated, structured data from Codex');
  console.log('using JSON schemas directly.\n');

  // Create a temporary directory to avoid loading workspace AGENTS.md
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-structured-'));
  console.log(`Working directory: ${tmpDir}\n`);

  // Create Codex instance
  const codex = new Codex();

  // Start a thread with working directory options
  const thread = codex.startThread({
    workingDirectory: tmpDir,
    skipGitRepoCheck: true,
  });

  // ============================================================================
  // Example 1: Basic JSON Schema
  // ============================================================================

  console.log('Example 1: Basic JSON Schema');
  console.log('─'.repeat(40));

  const basicSchema = {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'A brief summary of the response' },
      status: { type: 'string', enum: ['ok', 'action_required', 'error'] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['summary', 'status', 'confidence'],
    additionalProperties: false,
  } as const;

  console.log('Query: "Analyze the current repository status"\n');

  try {
    const turn1 = await thread.run('Analyze the current repository status', {
      outputSchema: basicSchema,
    });

    console.log('Response:');
    console.log(turn1.finalResponse);
    console.log('\n✓ Structured output received');
  } catch (error) {
    console.error('Error:', error);
  }

  // ============================================================================
  // Example 2: Zod Schema Integration
  // ============================================================================

  console.log('\n\nExample 2: Zod Schema Integration');
  console.log('─'.repeat(40));

  // Define a Zod schema
  const zodSchema = z.object({
    name: z.string().describe('The name of the item'),
    category: z.enum(['feature', 'bug', 'improvement']).describe('The category'),
    impact: z.enum(['low', 'medium', 'high']).describe('The impact level'),
    description: z.string().min(10).max(500).describe('A detailed description'),
    tags: z.array(z.string()).optional().describe('Optional tags'),
  });

  // Convert Zod schema to JSON schema (in a real app, you'd use zod-to-json-schema)
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

  console.log('Query: "Create a feature request for adding dark mode"\n');

  try {
    const turn2 = await thread.run(
      'Create a feature request for adding dark mode',
      {
        outputSchema: jsonSchemaFromZod,
      }
    );

    console.log('Response:');
    console.log(turn2.finalResponse);

    // Try to parse and validate with Zod
    const parsed = JSON.parse(turn2.finalResponse);
    const validated = zodSchema.parse(parsed);
    console.log('\n✓ Response validates against Zod schema');
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
  }

  // ============================================================================
  // Example 3: Complex Nested Schema
  // ============================================================================

  console.log('\n\nExample 3: Complex Nested Schema');
  console.log('─'.repeat(40));

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
        required: ['id', 'title', 'description', 'priority', 'status'],
        additionalProperties: false,
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
          additionalProperties: false,
        },
      },
      metadata: {
        type: 'object',
        properties: {
          createdAt: { type: 'string' },
          estimatedTime: { type: 'number' },
        },
        required: ['createdAt', 'estimatedTime'],
        additionalProperties: false,
      },
    },
    required: ['task', 'steps', 'metadata'],
    additionalProperties: false,
  } as const;

  console.log('Query: "Create a task plan for implementing user authentication"\n');

  try {
    const turn3 = await thread.run(
      'Create a task plan for implementing user authentication',
      {
        outputSchema: complexSchema,
      }
    );

    console.log('Response:');
    console.log(turn3.finalResponse);
    console.log('\n✓ Complex structured output received');
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
  }

  // ============================================================================
  // Summary
  // ============================================================================

  console.log('\n\n' + '='.repeat(60));
  console.log('📋 Summary');
  console.log('='.repeat(60));
  console.log('\nKey takeaways:');
  console.log('  • Structured output works directly with Thread.run()');
  console.log('  • Schemas can be simple objects or complex nested structures');
  console.log('  • Zod schemas can be converted to JSON schemas');
  console.log('  • Codex validates responses against schemas during generation');
  console.log('  • Structured output enables type-safe API responses');
  console.log('\nAPI parity:');
  console.log('  • Native SDK supports same structured output as TypeScript SDK');
  console.log('  • Use thread.run(input, { outputSchema }) for structured output');
  console.log('  • Same TurnOptions interface as TypeScript SDK');

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
