/**
 * Example: Input Guardrails with CodexProvider
 *
 * This example demonstrates how to use guardrails in the OpenAI Agents framework
 * with CodexProvider. Guardrails enable input validation and checks that run
 * in parallel to your agents, breaking early if checks fail.
 *
 * Based on OpenAI Agents SDK documentation:
 * https://openai.github.io/openai-agents-js/guides/guardrails
 *
 * Installation:
 * ```bash
 * npm install @codex-native/sdk @openai/agents zod
 * ```
 *
 * Usage:
 * ```bash
 * npx tsx examples/agents/agents-guardrails.ts
 * ```
 *
 * Key features demonstrated:
 * - Input validation guardrails
 * - Content filtering guardrails
 * - Security checks
 * - Early termination on guardrail failures
 * - Using CodexProvider as the model backend
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { z } from 'zod';
import { Agent, run } from '@openai/agents';
import { CodexProvider } from '../../src/index';

type GuardrailInput = string | unknown[];

function normalizeInput(input: GuardrailInput): string {
  if (typeof input === 'string') {
    return input;
  }

  try {
    return input
      .map(item => {
        if (typeof item === 'string') {
          return item;
        }
        return JSON.stringify(item);
      })
      .join('\n');
  } catch {
    return JSON.stringify(input);
  }
}

function guardrailSuccess(outputInfo?: Record<string, unknown>) {
  return {
    tripwireTriggered: false,
    outputInfo,
  };
}

function guardrailFailure(reason: string) {
  return {
    tripwireTriggered: true,
    outputInfo: { reason },
  };
}
import * as Agents from '@openai/agents';
import { setDefaultModelProvider } from '@openai/agents-core';
import { CodexProvider } from '../../src/index';

const { Agent, run } = Agents;

type GuardrailValidationResult = { valid: boolean; reason?: string };
type GuardrailConfig = {
  name: string;
  validate: (input: string) => Promise<GuardrailValidationResult> | GuardrailValidationResult;
};

function hasGuardrail(
  module: typeof Agents
): module is typeof Agents & { guardrail: (config: GuardrailConfig) => GuardrailConfig } {
  return typeof (module as { guardrail?: unknown }).guardrail === 'function';
}

const guardrail: (config: GuardrailConfig) => GuardrailConfig = hasGuardrail(Agents)
  ? Agents.guardrail
  : (config) => config; // Fallback for SDK versions without guardrail helper

async function main() {
  console.log('🛡️  Input Guardrails with CodexProvider\n');
  console.log('This example demonstrates how to validate inputs before processing.\n');

  // Create a temporary directory to avoid loading workspace AGENTS.md
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-guardrails-example-'));
  console.log(`Using temporary directory: ${tmpDir}\n`);

  // Create Codex provider
  const codexProvider = new CodexProvider({
    defaultModel: 'gpt-5-codex',
    workingDirectory: tmpDir,
    skipGitRepoCheck: true,
  });

  setDefaultModelProvider(codexProvider);

  // ============================================================================
  // Example 1: Input Validation Guardrail
  // ============================================================================
  console.log('Example 1: Input Validation Guardrail');
  console.log('─'.repeat(60));

  // Define a schema for valid input
  const validInputSchema = z.object({
    type: z.enum(['question', 'request', 'command']),
    content: z.string().min(10).max(1000),
    priority: z.enum(['low', 'medium', 'high']).optional(),
  });

  // Create a guardrail that validates input structure
  const inputValidationGuardrail = {
    name: 'input-validation',
    execute: async ({ input }: { input: GuardrailInput }) => {
      const normalized = normalizeInput(input);
      try {
        const parsed = JSON.parse(normalized);
        validInputSchema.parse(parsed);
        return guardrailSuccess({ mode: 'json' });
      } catch (error) {
        if (normalized.length >= 10 && normalized.length <= 1000) {
          return guardrailSuccess({ mode: 'text', length: normalized.length });
        }
        return guardrailFailure(
          'Input must be between 10 and 1000 characters, or a valid JSON object with type, content, and optional priority fields'
        );
      }
    },
  };

  const agentWithValidation = new Agent({
    name: 'ValidatedAgent',
    instructions: 'You are a helpful assistant that only processes validated inputs.',
    guardrails: [inputValidationGuardrail],
  } as any);

  console.log('\nTest 1: Valid input');
  console.log('Input: "This is a valid question that meets the length requirements."\n');

  try {
    const result1 = await run(
      agentWithValidation,
      'This is a valid question that meets the length requirements.'
    );
    console.log('✓ Guardrail passed');
    console.log('Response:', (result1.finalOutput ?? '').substring(0, 100) + '...\n');
  } catch (error) {
    console.log('✗ Guardrail failed:', error instanceof Error ? error.message : String(error));
  }

  console.log('\nTest 2: Invalid input (too short)');
  console.log('Input: "Short"\n');

  try {
    const result2 = await run(agentWithValidation, 'Short');
    console.log('Response:', result2.finalOutput ?? '(no output)');
  } catch (error) {
    console.log('✗ Guardrail blocked:', error instanceof Error ? error.message : String(error));
  }

  // ============================================================================
  // Example 2: Content Filtering Guardrail
  // ============================================================================
  console.log('\n\nExample 2: Content Filtering Guardrail');
  console.log('─'.repeat(60));

  // List of blocked terms (in a real app, this would be more sophisticated)
  const blockedTerms = ['spam', 'phishing', 'malware', 'hack'];

  const contentFilterGuardrail = {
    name: 'content-filter',
    execute: async ({ input }: { input: GuardrailInput }) => {
      const lowerInput = normalizeInput(input).toLowerCase();
      const foundTerms = blockedTerms.filter(term => lowerInput.includes(term));

      if (foundTerms.length > 0) {
        return guardrailFailure(`Input contains blocked terms: ${foundTerms.join(', ')}`);
      }

      return guardrailSuccess();
    },
  };

  const filteredAgent = new Agent({
    name: 'FilteredAgent',
    instructions: 'You are a helpful assistant with content filtering enabled.',
    guardrails: [contentFilterGuardrail],
  } as any);

  console.log('\nTest 1: Clean input');
  console.log('Input: "What is the weather today?"\n');

  try {
    const result1 = await run(filteredAgent, 'What is the weather today?');
    console.log('✓ Guardrail passed');
    console.log('Response:', (result1.finalOutput ?? '').substring(0, 100) + '...\n');
  } catch (error) {
    console.log('✗ Guardrail failed:', error instanceof Error ? error.message : String(error));
  }

  console.log('\nTest 2: Blocked content');
  console.log('Input: "This is spam content"\n');

  try {
    const result2 = await run(filteredAgent, 'This is spam content');
    console.log('Response:', result2.finalOutput ?? '(no output)');
  } catch (error) {
    console.log('✗ Guardrail blocked:', error instanceof Error ? error.message : String(error));
  }

  // ============================================================================
  // Example 3: Security Guardrail
  // ============================================================================
  console.log('\n\nExample 3: Security Guardrail');
  console.log('─'.repeat(60));

  // Check for potentially dangerous commands or patterns
  const dangerousPatterns = [
    /rm\s+-rf/,
    /sudo\s+rm/,
    /format\s+c:/i,
    /delete\s+all/i,
    /drop\s+table/i,
  ];

  const securityGuardrail = {
    name: 'security-check',
    execute: async ({ input }: { input: GuardrailInput }) => {
      const normalized = normalizeInput(input);
      for (const pattern of dangerousPatterns) {
        if (pattern.test(normalized)) {
          return guardrailFailure(
            'Input contains potentially dangerous commands that could cause data loss'
          );
        }
      }
      return guardrailSuccess();
    },
  };

  const secureAgent = new Agent({
    name: 'SecureAgent',
    instructions: 'You are a helpful assistant with security checks enabled.',
    guardrails: [securityGuardrail],
  } as any);

  console.log('\nTest 1: Safe input');
  console.log('Input: "List all files in the current directory"\n');

  try {
    const result1 = await run(secureAgent, 'List all files in the current directory');
    console.log('✓ Guardrail passed');
    console.log('Response:', (result1.finalOutput ?? '').substring(0, 100) + '...\n');
  } catch (error) {
    console.log('✗ Guardrail failed:', error instanceof Error ? error.message : String(error));
  }

  console.log('\nTest 2: Dangerous command');
  console.log('Input: "rm -rf /tmp"\n');

  try {
    const result2 = await run(secureAgent, 'rm -rf /tmp');
    console.log('Response:', result2.finalOutput ?? '(no output)');
  } catch (error) {
    console.log('✗ Guardrail blocked:', error instanceof Error ? error.message : String(error));
  }

  // ============================================================================
  // Example 4: Multiple Guardrails
  // ============================================================================
  console.log('\n\nExample 4: Multiple Guardrails Combined');
  console.log('─'.repeat(60));

  const multiGuardrailAgent = new Agent({
    name: 'MultiGuardrailAgent',
    instructions: 'You are a helpful assistant with multiple guardrails enabled.',
    guardrails: [
      inputValidationGuardrail,
      contentFilterGuardrail,
      securityGuardrail,
    ],
  } as any);

  console.log('\nTest: Input that passes all guardrails');
  console.log('Input: "Can you help me understand how to write better code?"\n');

  try {
    const result = await run(
      multiGuardrailAgent,
      'Can you help me understand how to write better code?'
    );
    console.log('✓ All guardrails passed');
    console.log('Response:', (result.finalOutput ?? '').substring(0, 150) + '...\n');
  } catch (error) {
    console.log('✗ Guardrail blocked:', error instanceof Error ? error.message : String(error));
  }

  // ============================================================================
  // Summary
  // ============================================================================
  console.log('\n\n' + '='.repeat(60));
  console.log('📋 Summary');
  console.log('='.repeat(60));
  console.log('\nKey takeaways:');
  console.log('  • Guardrails validate inputs before agent processing');
  console.log('  • Multiple guardrails can be combined');
  console.log('  • Guardrails run in parallel and break early on failure');
  console.log('  • CodexProvider works seamlessly with guardrails');
  console.log('  • Guardrails enable security and content filtering');
  console.log('\nFor more information, see:');
  console.log('  https://openai.github.io/openai-agents-js/guides/guardrails');

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
