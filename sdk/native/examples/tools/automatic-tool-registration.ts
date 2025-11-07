/**
 * Example: Automatic Tool Registration with CodexProvider
 *
 * This example demonstrates how tools are automatically registered when
 * passed to an Agent using CodexProvider. No manual tool registration
 * or configuration is required - the provider handles everything seamlessly.
 *
 * Key concepts:
 * - Tools defined with zod schemas are automatically validated
 * - Multiple tools can be provided to a single agent
 * - Tools are available immediately when the agent runs
 * - Tool execution results are automatically passed back to the model
 *
 * Installation:
 * ```bash
 * npm install @codex-native/sdk @openai/agents zod
 * ```
 *
 * Usage:
 * ```bash
 * npx tsx examples/automatic-tool-registration.ts
 * ```
 */

import { z } from 'zod';
import { Agent, run, tool } from '@openai/agents';
import { CodexProvider } from '../../src/index';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Define a calculator tool
const calculatorTool = tool({
  name: 'calculator',
  description: 'Perform basic arithmetic operations',
  parameters: z.object({
    operation: z.enum(['add', 'subtract', 'multiply', 'divide']).describe('The operation to perform'),
    a: z.number().describe('First number'),
    b: z.number().describe('Second number'),
  }),
  execute: async (input) => {
    console.log(`[Tool called: calculator(${input.operation}, ${input.a}, ${input.b})]`);

    let result: number;
    switch (input.operation) {
      case 'add':
        result = input.a + input.b;
        break;
      case 'subtract':
        result = input.a - input.b;
        break;
      case 'multiply':
        result = input.a * input.b;
        break;
      case 'divide':
        if (input.b === 0) {
          return 'Error: Division by zero';
        }
        result = input.a / input.b;
        break;
    }

    return `${input.a} ${input.operation} ${input.b} = ${result}`;
  },
});

// Define a unit conversion tool
const unitConverterTool = tool({
  name: 'convert_units',
  description: 'Convert between different units of measurement',
  parameters: z.object({
    value: z.number().describe('The value to convert'),
    fromUnit: z.enum(['meters', 'feet', 'kilograms', 'pounds', 'celsius', 'fahrenheit'])
      .describe('The unit to convert from'),
    toUnit: z.enum(['meters', 'feet', 'kilograms', 'pounds', 'celsius', 'fahrenheit'])
      .describe('The unit to convert to'),
  }),
  execute: async (input) => {
    console.log(`[Tool called: convert_units(${input.value} ${input.fromUnit} → ${input.toUnit})]`);

    // Conversion logic
    let result: number;

    // Length conversions
    if (input.fromUnit === 'meters' && input.toUnit === 'feet') {
      result = input.value * 3.28084;
    } else if (input.fromUnit === 'feet' && input.toUnit === 'meters') {
      result = input.value / 3.28084;
    }
    // Weight conversions
    else if (input.fromUnit === 'kilograms' && input.toUnit === 'pounds') {
      result = input.value * 2.20462;
    } else if (input.fromUnit === 'pounds' && input.toUnit === 'kilograms') {
      result = input.value / 2.20462;
    }
    // Temperature conversions
    else if (input.fromUnit === 'celsius' && input.toUnit === 'fahrenheit') {
      result = (input.value * 9/5) + 32;
    } else if (input.fromUnit === 'fahrenheit' && input.toUnit === 'celsius') {
      result = (input.value - 32) * 5/9;
    }
    // Same unit
    else if (input.fromUnit === input.toUnit) {
      result = input.value;
    } else {
      return `Error: Cannot convert from ${input.fromUnit} to ${input.toUnit}`;
    }

    return `${input.value} ${input.fromUnit} = ${result.toFixed(2)} ${input.toUnit}`;
  },
});

// Define a text analysis tool
const textAnalysisTool = tool({
  name: 'analyze_text',
  description: 'Analyze text and return statistics',
  parameters: z.object({
    text: z.string().describe('The text to analyze'),
  }),
  execute: async (input) => {
    console.log(`[Tool called: analyze_text(text length: ${input.text.length})]`);

    const words = input.text.split(/\s+/).filter(w => w.length > 0);
    const sentences = input.text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const characters = input.text.length;
    const charactersNoSpaces = input.text.replace(/\s/g, '').length;

    return JSON.stringify({
      characters,
      charactersNoSpaces,
      words: words.length,
      sentences: sentences.length,
      averageWordLength: (charactersNoSpaces / words.length).toFixed(2),
    }, null, 2);
  },
});

async function basicToolExample() {
  console.log('\n' + '='.repeat(70));
  console.log('Example 1: Basic Automatic Tool Registration');
  console.log('='.repeat(70) + '\n');

  // Create temporary working directory to avoid loading workspace config
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-tool-example-'));

  try {
    // Create provider and model
    const provider = new CodexProvider({
      defaultModel: 'gpt-5-codex',
      workingDirectory: tmpDir,
      skipGitRepoCheck: true,
    });

    const model = await provider.getModel();

    // Create agent with a single tool
    // The tool is automatically registered - no manual configuration needed!
    const calculatorAgent = new Agent({
      name: 'CalculatorAgent',
      model: model,
      instructions: 'You are a helpful calculator assistant. Use the calculator tool to perform operations. Answer directly with just the calculation result.',
      tools: [calculatorTool],
    });

    console.log('✓ Created CalculatorAgent');
    console.log('✓ Tool "calculator" automatically registered\n');

    console.log('─'.repeat(70));
    console.log('Query: "What is 123 multiplied by 456?"\n');

    const result = await run(calculatorAgent, 'What is 123 multiplied by 456?');

    console.log('\n[Final response]');
    console.log(result.finalOutput);
  } finally {
    // Cleanup temp directory
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function multipleToolsExample() {
  console.log('\n\n' + '='.repeat(70));
  console.log('Example 2: Multiple Tools Automatically Registered');
  console.log('='.repeat(70) + '\n');

  // Create temporary working directory to avoid loading workspace config
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-tool-example-'));

  try {
    const provider = new CodexProvider({
      defaultModel: 'gpt-5-codex',
      workingDirectory: tmpDir,
      skipGitRepoCheck: true,
    });

    const model = await provider.getModel();

    // Create agent with multiple tools
    // ALL tools are automatically registered when passed to the Agent
    const multiToolAgent = new Agent({
      name: 'MultiToolAgent',
      model: model,
      instructions: 'You are a helpful assistant with access to calculator, unit converter, and text analysis tools. Use the tools to answer questions directly.',
      tools: [calculatorTool, unitConverterTool, textAnalysisTool],
    });

    console.log('✓ Created MultiToolAgent');
    console.log('✓ Tools automatically registered:');
    console.log('  - calculator');
    console.log('  - convert_units');
    console.log('  - analyze_text\n');

    console.log('─'.repeat(70));
    console.log('Query: "Convert 100 pounds to kilograms, then multiply by 2"\n');

    const result = await run(multiToolAgent, 'Convert 100 pounds to kilograms, then multiply by 2');

    console.log('\n[Final response]');
    console.log(result.finalOutput);
  } finally {
    // Cleanup temp directory
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function toolChainExample() {
  console.log('\n\n' + '='.repeat(70));
  console.log('Example 3: Chaining Multiple Tool Calls');
  console.log('='.repeat(70) + '\n');

  // Create temporary working directory to avoid loading workspace config
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-tool-example-'));

  try {
    const provider = new CodexProvider({
      defaultModel: 'gpt-5-codex',
      workingDirectory: tmpDir,
      skipGitRepoCheck: true,
    });

    const model = await provider.getModel();

    const agent = new Agent({
      name: 'ToolChainAgent',
      model: model,
      instructions: 'You are a helpful assistant. Use multiple tools in sequence when needed to answer complex questions. Answer directly with the results.',
      tools: [calculatorTool, unitConverterTool, textAnalysisTool],
    });

    console.log('✓ Created ToolChainAgent with 3 tools\n');

    console.log('─'.repeat(70));
    console.log('Complex query requiring multiple tool calls:\n');
    console.log('Query: "I weigh 150 pounds. Convert that to kilograms, then calculate');
    console.log('        what 20% of my weight would be. Also analyze this sentence:');
    console.log('        \'The quick brown fox jumps over the lazy dog.\'"\n');

    const result = await run(
      agent,
      'I weigh 150 pounds. Convert that to kilograms, then calculate what 20% of my weight would be. Also analyze this sentence: "The quick brown fox jumps over the lazy dog."'
    );

    console.log('\n[Final response]');
    console.log(result.finalOutput);
  } finally {
    // Cleanup temp directory
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function toolValidationExample() {
  console.log('\n\n' + '='.repeat(70));
  console.log('Example 4: Automatic Tool Parameter Validation');
  console.log('='.repeat(70) + '\n');

  console.log('Tools defined with Zod schemas have automatic validation:');
  console.log('  • Type checking (string, number, enum, etc.)');
  console.log('  • Required vs optional parameters');
  console.log('  • Value constraints and descriptions');
  console.log('  • Automatic error messages for invalid inputs\n');

  console.log('Example tool schema:');
  console.log(`
  const calculatorTool = tool({
    name: 'calculator',
    parameters: z.object({
      operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
      a: z.number().describe('First number'),
      b: z.number().describe('Second number'),
    }),
    execute: async (input) => { /* implementation */ }
  });
  `);

  console.log('\n✓ When this tool is registered with CodexProvider:');
  console.log('  • The model receives the schema definition');
  console.log('  • Invalid calls are caught and handled gracefully');
  console.log('  • The agent can understand parameter requirements');
  console.log('  • No manual validation code needed!');
}

async function main() {
  console.log('🔧 Automatic Tool Registration Examples\n');
  console.log('This demonstrates how CodexProvider automatically registers');
  console.log('tools when they are passed to an Agent - no manual configuration!\n');

  try {
    // Run all examples
    await basicToolExample();
    await multipleToolsExample();
    await toolChainExample();
    await toolValidationExample();

    console.log('\n\n' + '='.repeat(70));
    console.log('✓ All automatic tool registration examples complete!');
    console.log('='.repeat(70));
    console.log('\nKey takeaways:');
    console.log('  • Tools are automatically registered when passed to Agent()');
    console.log('  • No manual tool.register() or provider.addTool() calls needed');
    console.log('  • Multiple tools can be registered at once');
    console.log('  • Tools defined with Zod have automatic validation');
    console.log('  • Tool execution results flow back to the model automatically');
    console.log('  • The agent can chain multiple tool calls to complete tasks');
  } catch (error) {
    console.error('\n✗ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main()
  .then(() => {
    // Force exit after completion to avoid hanging
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { main };
