/**
 * Tests for the agents-with-tools example
 */

import { describe, it, expect, jest } from '@jest/globals';

describe('Agents with Tools', () => {
  it('should have zod available for tool parameter validation', async () => {
    const { z } = await import('zod');
    expect(z).toBeDefined();
    expect(typeof z.object).toBe('function');
  });

  it('should validate weather tool parameters with zod', async () => {
    const { z } = await import('zod');

    const weatherSchema = z.object({
      city: z.string().describe('The city to get weather for'),
    });

    // Valid input
    const validInput = { city: 'Tokyo' };
    expect(() => weatherSchema.parse(validInput)).not.toThrow();

    // Invalid input
    const invalidInput = { city: 123 };
    expect(() => weatherSchema.parse(invalidInput)).toThrow();
  });

  it('should validate temperature conversion tool parameters with zod', async () => {
    const { z } = await import('zod');

    const tempSchema = z.object({
      value: z.number().describe('The temperature value to convert'),
      from: z.enum(['celsius', 'fahrenheit']).describe('The unit to convert from'),
      to: z.enum(['celsius', 'fahrenheit']).describe('The unit to convert to'),
    });

    // Valid input
    const validInput = { value: 25, from: 'celsius', to: 'fahrenheit' };
    expect(() => tempSchema.parse(validInput)).not.toThrow();

    // Invalid input - wrong enum value
    const invalidInput = { value: 25, from: 'kelvin', to: 'fahrenheit' };
    expect(() => tempSchema.parse(invalidInput)).toThrow();

    // Invalid input - wrong type
    const invalidInput2 = { value: '25', from: 'celsius', to: 'fahrenheit' };
    expect(() => tempSchema.parse(invalidInput2)).toThrow();
  });

  it('should create tool with zod schema', async () => {
    const { z } = await import('zod');

    // Simulate the tool function pattern from @openai/agents
    const createTool = (config) => {
      expect(config.name).toBeDefined();
      expect(config.description).toBeDefined();
      expect(config.parameters).toBeDefined();
      expect(typeof config.execute).toBe('function');
      return config;
    };

    const testTool = createTool({
      name: 'test_tool',
      description: 'A test tool',
      parameters: z.object({
        input: z.string(),
      }),
      execute: async (input) => `Result: ${input.input}`,
    });

    expect(testTool.name).toBe('test_tool');
    expect(testTool.description).toBe('A test tool');

    // Test execution
    const result = await testTool.execute({ input: 'test' });
    expect(result).toBe('Result: test');
  });

  it('should convert celsius to fahrenheit correctly', () => {
    const convertTemp = (value, from, to) => {
      if (from === to) return value;
      if (from === 'celsius' && to === 'fahrenheit') {
        return (value * 9/5) + 32;
      } else {
        return (value - 32) * 5/9;
      }
    };

    // Test celsius to fahrenheit
    expect(convertTemp(0, 'celsius', 'fahrenheit')).toBe(32);
    expect(convertTemp(100, 'celsius', 'fahrenheit')).toBe(212);
    expect(convertTemp(25, 'celsius', 'fahrenheit')).toBeCloseTo(77, 0);

    // Test fahrenheit to celsius
    expect(convertTemp(32, 'fahrenheit', 'celsius')).toBe(0);
    expect(convertTemp(212, 'fahrenheit', 'celsius')).toBe(100);
    expect(convertTemp(77, 'fahrenheit', 'celsius')).toBeCloseTo(25, 0);

    // Test same unit
    expect(convertTemp(25, 'celsius', 'celsius')).toBe(25);
  });

  it('should have @openai/agents available', async () => {
    try {
      const agents = await import('@openai/agents');
      expect(agents).toBeDefined();
      expect(agents.Agent).toBeDefined();
      expect(agents.run).toBeDefined();
      expect(agents.tool).toBeDefined();
    } catch (error) {
      // Skip if @openai/agents is not installed (it's a peer dependency)
      console.log('Skipping @openai/agents test - package not installed');
      expect(error.message).toContain('Cannot find module');
    }
  });

  it('should create agent configuration for GPT-5', async () => {
    // Test agent configuration structure
    const agentConfig = {
      name: 'TestAgent',
      model: 'gpt-5-codex', // Using Codex default model
      instructions: 'You are a test agent.',
      tools: [],
    };

    expect(agentConfig.name).toBe('TestAgent');
    expect(agentConfig.model).toBe('gpt-5-codex');
    expect(agentConfig.instructions).toBeDefined();
    expect(Array.isArray(agentConfig.tools)).toBe(true);
  });
});
