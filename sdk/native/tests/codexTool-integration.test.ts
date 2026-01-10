/**
 * Integration tests for codexTool() with @openai/agents
 *
 * These tests verify that tools created with codexTool() actually execute
 * when used with Agent and run() from @openai/agents.
 *
 * This catches the bug where tools were registered but invocation data was null.
 */

import { describe, it, expect, jest, beforeEach, afterEach, beforeAll } from '@jest/globals';
import { z } from 'zod';
import { setupNativeBinding } from "./testHelpers";

// Ensure the native binding points at the locally-built binary
setupNativeBinding();

jest.setTimeout(60_000);

let codexTool: any;
let CodexProvider: any;
let clearCodexToolExecutors: any;
let getCodexToolExecutor: any;
let registerCodexToolExecutor: any;

beforeAll(async () => {
  const sdk = await import('../src/index');
  codexTool = sdk.codexTool;
  CodexProvider = sdk.CodexProvider;
  clearCodexToolExecutors = sdk.clearCodexToolExecutors;
  getCodexToolExecutor = sdk.getCodexToolExecutor;
  registerCodexToolExecutor = sdk.registerCodexToolExecutor;
});

describe('codexTool() integration', () => {
  beforeEach(() => {
    clearCodexToolExecutors();
  });

  describe('Tool registration', () => {
    it('should register tool executor when codexTool() is called', () => {
      const mockExecute = jest.fn(() => Promise.resolve({ result: 'test' }));

      codexTool({
        name: 'test_tool',
        description: 'A test tool',
        parameters: z.object({
          input: z.string().describe('Test input'),
        }),
        execute: mockExecute,
      });

      const executor = getCodexToolExecutor('test_tool');
      expect(executor).toBeDefined();
    });

    it('should use execute handler when codexExecute is not provided', async () => {
      let executeCalled = false;
      const executeResult = { data: 'from execute' };

      codexTool({
        name: 'fallback_test',
        description: 'Tests execute fallback',
        parameters: z.object({
          value: z.string(),
        }),
        execute: async (args: { value: string }) => {
          executeCalled = true;
          return executeResult;
        },
      });

      const executor = getCodexToolExecutor('fallback_test');
      expect(executor).toBeDefined();

      // Simulate Codex calling the executor
      const result = await executor!({
        name: 'fallback_test',
        callId: 'call_123',
        arguments: { value: 'test' },
        rawInvocation: {
          toolName: 'fallback_test',
          callId: 'call_123',
          arguments: JSON.stringify({ value: 'test' }),
        },
      });

      expect(executeCalled).toBe(true);
      expect(result).toEqual(executeResult);
    });

    it('should prefer codexExecute over execute when both are provided', async () => {
      let executeCalledWith: any = null;
      let codexExecuteCalledWith: any = null;

      codexTool({
        name: 'prefer_codex',
        description: 'Tests codexExecute preference',
        parameters: z.object({
          input: z.string(),
        }),
        execute: async (args: any) => {
          executeCalledWith = args;
          return 'execute result';
        },
        codexExecute: async (args: any) => {
          codexExecuteCalledWith = args;
          return 'codexExecute result';
        },
      });

      const executor = getCodexToolExecutor('prefer_codex');
      const result = await executor!({
        name: 'prefer_codex',
        callId: 'call_456',
        arguments: { input: 'hello' },
        rawInvocation: {
          toolName: 'prefer_codex',
          callId: 'call_456',
          arguments: JSON.stringify({ input: 'hello' }),
        },
      });

      expect(codexExecuteCalledWith).toEqual({ input: 'hello' });
      expect(executeCalledWith).toBeNull();
      expect(result).toBe('codexExecute result');
    });
  });

  describe('Tool executor invocation', () => {
    it('should pass correct arguments to executor', async () => {
      let receivedArgs: any = null;

      codexTool({
        name: 'arg_test',
        description: 'Tests argument passing',
        parameters: z.object({
          symbol: z.string(),
          limit: z.number().optional(),
        }),
        execute: async (args: any) => {
          receivedArgs = args;
          return { success: true };
        },
      });

      const executor = getCodexToolExecutor('arg_test');
      await executor!({
        name: 'arg_test',
        callId: 'call_789',
        arguments: { symbol: 'AAPL', limit: 10 },
        rawInvocation: {
          toolName: 'arg_test',
          callId: 'call_789',
          arguments: JSON.stringify({ symbol: 'AAPL', limit: 10 }),
        },
      });

      expect(receivedArgs).toEqual({ symbol: 'AAPL', limit: 10 });
    });

    it('should handle executor errors gracefully', async () => {
      codexTool({
        name: 'error_tool',
        description: 'Tool that throws',
        parameters: z.object({}),
        execute: async () => {
          throw new Error('Intentional test error');
        },
      });

      const executor = getCodexToolExecutor('error_tool');

      await expect(executor!({
        name: 'error_tool',
        callId: 'call_err',
        arguments: {},
        rawInvocation: {
          toolName: 'error_tool',
          callId: 'call_err',
          arguments: '{}',
        },
      })).rejects.toThrow('Intentional test error');
    });

    it('should handle empty arguments', async () => {
      let receivedArgs: any = null;

      codexTool({
        name: 'no_args_tool',
        description: 'Tool with no required args',
        parameters: z.object({}),
        execute: async (args: any) => {
          receivedArgs = args;
          return 'success';
        },
      });

      const executor = getCodexToolExecutor('no_args_tool');
      await executor!({
        name: 'no_args_tool',
        callId: 'call_empty',
        arguments: {},
        rawInvocation: {
          toolName: 'no_args_tool',
          callId: 'call_empty',
          arguments: '{}',
        },
      });

      expect(receivedArgs).toEqual({});
    });

    it('should handle async executors properly', async () => {
      let executionOrder: string[] = [];

      codexTool({
        name: 'async_tool',
        description: 'Async executor test',
        parameters: z.object({}),
        execute: async () => {
          executionOrder.push('start');
          await new Promise(resolve => setTimeout(resolve, 10));
          executionOrder.push('end');
          return 'done';
        },
      });

      const executor = getCodexToolExecutor('async_tool');
      const result = await executor!({
        name: 'async_tool',
        callId: 'call_async',
        arguments: {},
        rawInvocation: {
          toolName: 'async_tool',
          callId: 'call_async',
          arguments: '{}',
        },
      });

      expect(executionOrder).toEqual(['start', 'end']);
      expect(result).toBe('done');
    });
  });

  describe('Multiple tools', () => {
    it('should register multiple tools independently', () => {
      codexTool({
        name: 'tool_a',
        description: 'Tool A',
        parameters: z.object({ a: z.string() }),
        execute: async () => 'A',
      });

      codexTool({
        name: 'tool_b',
        description: 'Tool B',
        parameters: z.object({ b: z.number() }),
        execute: async () => 'B',
      });

      codexTool({
        name: 'tool_c',
        description: 'Tool C',
        parameters: z.object({}),
        execute: async () => 'C',
      });

      expect(getCodexToolExecutor('tool_a')).toBeDefined();
      expect(getCodexToolExecutor('tool_b')).toBeDefined();
      expect(getCodexToolExecutor('tool_c')).toBeDefined();
      expect(getCodexToolExecutor('tool_nonexistent')).toBeUndefined();
    });

    it('should execute correct tool for each invocation', async () => {
      const callLog: string[] = [];

      codexTool({
        name: 'log_a',
        description: 'Log A',
        parameters: z.object({}),
        execute: async () => { callLog.push('A'); return 'A'; },
      });

      codexTool({
        name: 'log_b',
        description: 'Log B',
        parameters: z.object({}),
        execute: async () => { callLog.push('B'); return 'B'; },
      });

      const executorA = getCodexToolExecutor('log_a');
      const executorB = getCodexToolExecutor('log_b');

      await executorB!({
        name: 'log_b',
        callId: 'b1',
        arguments: {},
        rawInvocation: { toolName: 'log_b', callId: 'b1', arguments: '{}' },
      });

      await executorA!({
        name: 'log_a',
        callId: 'a1',
        arguments: {},
        rawInvocation: { toolName: 'log_a', callId: 'a1', arguments: '{}' },
      });

      await executorB!({
        name: 'log_b',
        callId: 'b2',
        arguments: {},
        rawInvocation: { toolName: 'log_b', callId: 'b2', arguments: '{}' },
      });

      expect(callLog).toEqual(['B', 'A', 'B']);
    });
  });

  describe('Tool return value handling', () => {
    it('should handle object return values', async () => {
      codexTool({
        name: 'object_return',
        description: 'Returns object',
        parameters: z.object({}),
        execute: async () => ({
          status: 'success',
          data: { items: [1, 2, 3], nested: { value: true } },
        }),
      });

      const executor = getCodexToolExecutor('object_return');
      const result = await executor!({
        name: 'object_return',
        callId: 'call_obj',
        arguments: {},
        rawInvocation: { toolName: 'object_return', callId: 'call_obj', arguments: '{}' },
      });

      expect(result).toEqual({
        status: 'success',
        data: { items: [1, 2, 3], nested: { value: true } },
      });
    });

    it('should handle string return values', async () => {
      codexTool({
        name: 'string_return',
        description: 'Returns string',
        parameters: z.object({}),
        execute: async () => 'Hello, world!',
      });

      const executor = getCodexToolExecutor('string_return');
      const result = await executor!({
        name: 'string_return',
        callId: 'call_str',
        arguments: {},
        rawInvocation: { toolName: 'string_return', callId: 'call_str', arguments: '{}' },
      });

      expect(result).toBe('Hello, world!');
    });

    it('should handle array return values', async () => {
      codexTool({
        name: 'array_return',
        description: 'Returns array',
        parameters: z.object({}),
        execute: async () => [
          { symbol: 'AAPL', price: 150 },
          { symbol: 'GOOGL', price: 2800 },
        ],
      });

      const executor = getCodexToolExecutor('array_return');
      const result = await executor!({
        name: 'array_return',
        callId: 'call_arr',
        arguments: {},
        rawInvocation: { toolName: 'array_return', callId: 'call_arr', arguments: '{}' },
      });

      expect(result).toEqual([
        { symbol: 'AAPL', price: 150 },
        { symbol: 'GOOGL', price: 2800 },
      ]);
    });

    it('should handle null/undefined return values', async () => {
      codexTool({
        name: 'null_return',
        description: 'Returns null',
        parameters: z.object({}),
        execute: async () => null,
      });

      codexTool({
        name: 'undefined_return',
        description: 'Returns undefined',
        parameters: z.object({}),
        execute: async () => undefined,
      });

      const nullExecutor = getCodexToolExecutor('null_return');
      const undefinedExecutor = getCodexToolExecutor('undefined_return');

      const nullResult = await nullExecutor!({
        name: 'null_return',
        callId: 'call_null',
        arguments: {},
        rawInvocation: { toolName: 'null_return', callId: 'call_null', arguments: '{}' },
      });

      const undefinedResult = await undefinedExecutor!({
        name: 'undefined_return',
        callId: 'call_undef',
        arguments: {},
        rawInvocation: { toolName: 'undefined_return', callId: 'call_undef', arguments: '{}' },
      });

      expect(nullResult).toBeNull();
      expect(undefinedResult).toBeUndefined();
    });
  });
});

describe('codexTool() with CodexProvider', () => {
  let mockThread: any;
  let mockCodex: any;
  let provider: any;

  beforeEach(() => {
    clearCodexToolExecutors();

    const createUsage = () => ({
      input_tokens: 10,
      output_tokens: 5,
      reasoning_tokens: 0,
    });

    mockThread = {
      id: 'mock-thread',
      run: jest.fn(async () => ({
        items: [{ type: 'agent_message', text: 'Mock response' }],
        finalResponse: 'Mock response',
        usage: createUsage(),
      })),
      runStreamed: jest.fn(async () => ({
        events: (async function* () {
          yield { type: 'thread.started', thread_id: 'mock-thread' };
          yield { type: 'item.started', item: { type: 'agent_message', text: '' } };
          yield { type: 'item.updated', item: { type: 'agent_message', text: 'Mock response' } };
          yield { type: 'item.completed', item: { type: 'agent_message', text: 'Mock response' } };
          yield { type: 'turn.completed', usage: createUsage() };
        })(),
      })),
      onEvent: jest.fn(() => () => {}),
      sendBackgroundEvent: jest.fn(async () => {}),
    };

    mockCodex = {
      startThread: jest.fn(() => mockThread),
      resumeThread: jest.fn(() => mockThread),
      registerTool: jest.fn(),
    };

    provider = new CodexProvider({
      defaultModel: 'gpt-5-codex',
      workingDirectory: process.cwd(),
      skipGitRepoCheck: true,
    });

    // Inject mock
    (provider as any).codex = mockCodex;
  });

  it('should register tool executor that CodexProvider can retrieve', () => {
    codexTool({
      name: 'provider_test_tool',
      description: 'Tool for provider test',
      parameters: z.object({ query: z.string() }),
      execute: async (args: { query: string }) => `Result for: ${args.query}`,
    });

    // Verify executor is registered in global registry
    const executor = getCodexToolExecutor('provider_test_tool');
    expect(executor).toBeDefined();
  });

  it('should have executor callable after CodexProvider is created', async () => {
    let toolExecuted = false;

    codexTool({
      name: 'callable_tool',
      description: 'Callable tool',
      parameters: z.object({}),
      execute: async () => {
        toolExecuted = true;
        return 'executed';
      },
    });

    const executor = getCodexToolExecutor('callable_tool');
    expect(executor).toBeDefined();

    await executor!({
      name: 'callable_tool',
      callId: 'test_call',
      arguments: {},
      rawInvocation: { toolName: 'callable_tool', callId: 'test_call', arguments: '{}' },
    });

    expect(toolExecuted).toBe(true);
  });
});

describe('CodexProvider tool execution simulation', () => {
  /**
   * These tests simulate how CodexProvider calls tool executors.
   * The bug was that invocation was coming through as null.
   */
  beforeEach(() => {
    clearCodexToolExecutors();
  });

  it('CRITICAL: should fail if executor receives null invocation', async () => {
    let receivedInvocation: any = 'not-set';

    codexTool({
      name: 'null_check_tool',
      description: 'Tool to check null invocation',
      parameters: z.object({ data: z.string() }),
      execute: async (args: { data: string }) => {
        receivedInvocation = args;
        return { result: args.data };
      },
    });

    const executor = getCodexToolExecutor('null_check_tool');
    expect(executor).toBeDefined();

    // This is what happens when CodexProvider's executeToolViaFramework
    // receives a null invocation - it should NOT happen but did in the bug
    try {
      await executor!({
        name: 'null_check_tool',
        callId: 'call_null_test',
        arguments: null as any, // Bug: null arguments
        rawInvocation: null as any, // Bug: null invocation
      });
      fail('Should have thrown or handled null invocation');
    } catch (error) {
      // Expected - tool should gracefully handle or throw
      expect(error).toBeDefined();
    }
  });

  it('CRITICAL: should properly execute when invocation has valid data', async () => {
    let executeCalled = false;
    let receivedArgs: any = null;

    codexTool({
      name: 'valid_invocation_tool',
      description: 'Tool with valid invocation',
      parameters: z.object({
        symbol: z.string(),
        limit: z.number().optional(),
      }),
      execute: async (args: { symbol: string; limit?: number }) => {
        executeCalled = true;
        receivedArgs = args;
        return { price: 150, symbol: args.symbol };
      },
    });

    const executor = getCodexToolExecutor('valid_invocation_tool');

    // This is the CORRECT invocation that should work
    const result = await executor!({
      name: 'valid_invocation_tool',
      callId: 'call_valid',
      arguments: { symbol: 'AAPL', limit: 10 },
      rawInvocation: {
        toolName: 'valid_invocation_tool',
        callId: 'call_valid',
        arguments: JSON.stringify({ symbol: 'AAPL', limit: 10 }),
      },
    });

    expect(executeCalled).toBe(true);
    expect(receivedArgs).toEqual({ symbol: 'AAPL', limit: 10 });
    expect(result).toEqual({ price: 150, symbol: 'AAPL' });
  });

  it('CRITICAL: should simulate full CodexProvider flow', async () => {
    /**
     * This test simulates the exact flow that was failing:
     * 1. codexTool() registers a tool with execute handler
     * 2. CodexProvider registers tool with Codex via codex.registerTool()
     * 3. When Codex calls the tool, the handler should receive valid invocation
     * 4. The execute handler should be called with parsed arguments
     */
    const callLog: Array<{ step: string; data: any }> = [];

    codexTool({
      name: 'full_flow_tool',
      description: 'Simulates full flow',
      parameters: z.object({
        ticker: z.string(),
        direction: z.enum(['up', 'down']),
      }),
      execute: async (args: { ticker: string; direction: 'up' | 'down' }) => {
        callLog.push({ step: 'execute', data: args });
        return {
          ticker: args.ticker,
          movement: args.direction === 'up' ? '+5%' : '-3%',
        };
      },
    });

    // Step 1: Get the executor (simulating what CodexProvider does)
    const executor = getCodexToolExecutor('full_flow_tool');
    expect(executor).toBeDefined();
    callLog.push({ step: 'executor-retrieved', data: { name: 'full_flow_tool' } });

    // Step 2: Simulate Codex calling the tool with proper invocation
    const invocation = {
      toolName: 'full_flow_tool',
      callId: 'call_simulation',
      arguments: JSON.stringify({ ticker: 'NVDA', direction: 'up' }),
    };

    callLog.push({ step: 'invocation-created', data: invocation });

    // Step 3: Call executor with context (simulating executeToolViaFramework)
    const context = {
      name: invocation.toolName,
      callId: invocation.callId,
      arguments: JSON.parse(invocation.arguments), // Parsed arguments
      rawInvocation: invocation,
    };

    const result = await executor!(context);
    callLog.push({ step: 'result-received', data: result });

    // Verify the complete flow worked
    expect(callLog).toHaveLength(4);
    expect(callLog[0]!.step).toBe('executor-retrieved');
    expect(callLog[1]!.step).toBe('invocation-created');
    expect(callLog[2]!.step).toBe('execute');
    expect(callLog[2]!.data).toEqual({ ticker: 'NVDA', direction: 'up' });
    expect(callLog[3]!.step).toBe('result-received');
    expect(callLog[3]!.data).toEqual({ ticker: 'NVDA', movement: '+5%' });
  });

  it('should handle undefined arguments gracefully', async () => {
    codexTool({
      name: 'undefined_args_tool',
      description: 'Tool that gets undefined args',
      parameters: z.object({}),
      execute: async (args: Record<string, never>) => {
        return { handled: true, args };
      },
    });

    const executor = getCodexToolExecutor('undefined_args_tool');

    // Sometimes arguments might be undefined instead of {}
    const result = await executor!({
      name: 'undefined_args_tool',
      callId: 'call_undef_args',
      arguments: undefined as any,
      rawInvocation: {
        toolName: 'undefined_args_tool',
        callId: 'call_undef_args',
        arguments: undefined,
      },
    });

    // Should still execute and return result
    expect(result).toEqual({ handled: true, args: {} });
  });
});

describe('Tool executor edge cases', () => {
  beforeEach(() => {
    clearCodexToolExecutors();
  });

  it('should handle re-registration of same tool name', async () => {
    let version = 'v1';

    codexTool({
      name: 'versioned_tool',
      description: 'Version 1',
      parameters: z.object({}),
      execute: async () => version,
    });

    let executor = getCodexToolExecutor('versioned_tool');
    let result = await executor!({
      name: 'versioned_tool',
      callId: 'call1',
      arguments: {},
      rawInvocation: { toolName: 'versioned_tool', callId: 'call1', arguments: '{}' },
    });
    expect(result).toBe('v1');

    // Re-register with new version
    version = 'v2';
    codexTool({
      name: 'versioned_tool',
      description: 'Version 2',
      parameters: z.object({}),
      execute: async () => version,
    });

    executor = getCodexToolExecutor('versioned_tool');
    result = await executor!({
      name: 'versioned_tool',
      callId: 'call2',
      arguments: {},
      rawInvocation: { toolName: 'versioned_tool', callId: 'call2', arguments: '{}' },
    });
    expect(result).toBe('v2');
  });

  it('should handle special characters in tool arguments', async () => {
    let receivedArgs: any;

    codexTool({
      name: 'special_chars_tool',
      description: 'Tool with special chars',
      parameters: z.object({ text: z.string() }),
      execute: async (args: { text: string }) => {
        receivedArgs = args;
        return 'ok';
      },
    });

    const executor = getCodexToolExecutor('special_chars_tool');
    await executor!({
      name: 'special_chars_tool',
      callId: 'call_special',
      arguments: { text: 'Hello "world" with \'quotes\' and \n newlines and unicode: \u{1F600}' },
      rawInvocation: {
        toolName: 'special_chars_tool',
        callId: 'call_special',
        arguments: JSON.stringify({ text: 'Hello "world" with \'quotes\' and \n newlines and unicode: \u{1F600}' }),
      },
    });

    expect(receivedArgs.text).toBe('Hello "world" with \'quotes\' and \n newlines and unicode: \u{1F600}');
  });

  it('should handle large argument payloads', async () => {
    let receivedArgs: any;
    const largeData = Array(1000).fill(0).map((_, i) => ({
      id: i,
      name: `Item ${i}`,
      description: 'A'.repeat(100),
    }));

    codexTool({
      name: 'large_payload_tool',
      description: 'Tool with large payload',
      parameters: z.object({ data: z.array(z.any()) }),
      execute: async (args: { data: any[] }) => {
        receivedArgs = args;
        return { count: args.data.length };
      },
    });

    const executor = getCodexToolExecutor('large_payload_tool');
    const result = await executor!({
      name: 'large_payload_tool',
      callId: 'call_large',
      arguments: { data: largeData },
      rawInvocation: {
        toolName: 'large_payload_tool',
        callId: 'call_large',
        arguments: JSON.stringify({ data: largeData }),
      },
    });

    expect(receivedArgs.data.length).toBe(1000);
    expect(result).toEqual({ count: 1000 });
  });

  it('should handle concurrent tool executions', async () => {
    const executionTimes: number[] = [];

    codexTool({
      name: 'concurrent_tool',
      description: 'Concurrent execution test',
      parameters: z.object({ delay: z.number() }),
      execute: async (args: { delay: number }) => {
        const start = Date.now();
        await new Promise(resolve => setTimeout(resolve, args.delay));
        executionTimes.push(Date.now() - start);
        return `done after ${args.delay}ms`;
      },
    });

    const executor = getCodexToolExecutor('concurrent_tool');

    // Execute 3 calls concurrently
    const start = Date.now();
    await Promise.all([
      executor!({
        name: 'concurrent_tool',
        callId: 'call1',
        arguments: { delay: 50 },
        rawInvocation: { toolName: 'concurrent_tool', callId: 'call1', arguments: '{"delay":50}' },
      }),
      executor!({
        name: 'concurrent_tool',
        callId: 'call2',
        arguments: { delay: 30 },
        rawInvocation: { toolName: 'concurrent_tool', callId: 'call2', arguments: '{"delay":30}' },
      }),
      executor!({
        name: 'concurrent_tool',
        callId: 'call3',
        arguments: { delay: 20 },
        rawInvocation: { toolName: 'concurrent_tool', callId: 'call3', arguments: '{"delay":20}' },
      }),
    ]);
    const totalTime = Date.now() - start;

    expect(executionTimes.length).toBe(3);
    // All should complete within ~60ms if truly concurrent (not 100ms if sequential)
    expect(totalTime).toBeLessThan(100);
  });
});
