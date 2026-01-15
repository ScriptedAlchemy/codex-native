/**
 * Tests for CodexProvider - OpenAI Agents framework integration
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { setupNativeBinding } from './testHelpers';
import { CodexProvider } from '../src/index';

import type { AgentOutputItem, ModelRequest } from '../src/agents/types';

setupNativeBinding();

interface MockUsage {
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_input_tokens?: number;
}

interface MockThread {
  id: string;
  run: jest.MockedFunction<() => Promise<{
    items: Array<{ type: string; text: string }>;
    finalResponse: string;
    usage: MockUsage;
  }>>;
  runStreamed: jest.MockedFunction<() => Promise<{
    events: AsyncIterable<{
      type: string;
      thread_id?: string;
      item?: { type: string; text?: string };
    }>;
  }>>;
  onEvent: jest.MockedFunction<(callback: (event: any) => void) => () => void>;
  sendBackgroundEvent: jest.MockedFunction<(message: string) => Promise<void>>;
}

const createMockThread = (): MockThread => {
  const createUsage = (): MockUsage => ({
    input_tokens: 10,
    output_tokens: 5,
    reasoning_tokens: 0,
  });

  return {
    id: 'mock-thread',
    run: jest.fn(async () => ({
      items: [
        {
          type: 'agent_message',
          text: 'Mock response',
        },
      ],
      finalResponse: 'Mock response',
      usage: createUsage(),
    })),
    runStreamed: jest.fn(async () => ({
      events: (async function* () {
        const usage = createUsage();
        yield { type: 'thread.started', thread_id: 'mock-thread' };
        yield { type: 'item.started', item: { type: 'agent_message', text: '' } };
        yield { type: 'item.updated', item: { type: 'agent_message', text: 'Mock response' } };
        yield { type: 'item.completed', item: { type: 'agent_message', text: 'Mock response' } };
        yield { type: 'turn.completed', usage };
      })(),
    })),
    onEvent: jest.fn(() => {
      // Return unsubscribe function
      return () => {};
    }),
    sendBackgroundEvent: jest.fn(async () => {}),
  };
};

type OutputTextPart = { type: 'output_text'; text: string };

const isOutputTextPart = (value: unknown): value is OutputTextPart => {
  if (!value || typeof value !== 'object') return false;
  const record = value as { type?: unknown; text?: unknown };
  return record.type === 'output_text' && typeof record.text === 'string';
};

const extractAssistantOutputText = (output: AgentOutputItem[]): string => {
  for (const item of output) {
    if (!('role' in item) || item.role !== 'assistant') continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (isOutputTextPart(part)) {
        return part.text;
      }
    }
  }
  return '';
};

describe('CodexProvider', () => {
  let provider: CodexProvider;
  let mockCodex: any;
  let mockThread: MockThread;
  let originalFetch: typeof global.fetch;
  let mockFetch: jest.MockedFunction<typeof global.fetch>;

  beforeEach(() => {
    jest.clearAllMocks();

    originalFetch = global.fetch;
    mockFetch = jest.fn(async () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    }));
    global.fetch = mockFetch;

    mockThread = createMockThread();
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

    // Inject mock Codex instance to avoid network/native binding usage
    (provider as any).codex = mockCodex;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('ModelProvider Interface', () => {
    it('should implement getModel method', () => {
      expect(provider.getModel).toBeDefined();
      expect(typeof provider.getModel).toBe('function');
    });

    it('should return a Model instance from getModel()', () => {
      const model = provider.getModel();
      expect(model).toBeDefined();
      expect(model.getResponse).toBeDefined();
      expect(model.getStreamedResponse).toBeDefined();
    });

    it('should return a Model with specific model name', () => {
      const model = provider.getModel('gpt-5-codex');
      expect(model).toBeDefined();
    });

    it('should use default model when no name provided', () => {
      const model = provider.getModel();
      expect(model).toBeDefined();
    });
  });

  describe('Model Interface', () => {
    let model: any;

    beforeEach(() => {
      model = provider.getModel();
    });

    it('should have getResponse method', () => {
      expect(model.getResponse).toBeDefined();
      expect(typeof model.getResponse).toBe('function');
    });

    it('should have getStreamedResponse method', () => {
      expect(model.getStreamedResponse).toBeDefined();
      expect(typeof model.getStreamedResponse).toBe('function');
    });
  });

  describe('Request Conversion', () => {
    let model: any;

    beforeEach(() => {
      model = provider.getModel();
    });

    it('should handle string input', async () => {
      const request = {
        input: 'Hello, world!',
        modelSettings: {},
        tools: [],
        outputType: { type: 'text' } as any,
        handoffs: [],
        tracing: { enabled: false } as any,
      };

      await expect(model.getResponse(request)).resolves.toMatchObject({
        output: expect.any(Array),
      });
    });

    it('should handle text input items', async () => {
      const request = {
        input: [
          { type: 'input_text', text: 'Hello' },
          { type: 'input_text', text: 'World' },
        ],
        modelSettings: {},
        tools: [],
        outputType: { type: 'text' } as any,
        handoffs: [],
        tracing: { enabled: false } as any,
      };

      await expect(model.getResponse(request)).resolves.toMatchObject({
        output: expect.any(Array),
      });
    });

    it('should handle base64 image input', async () => {
      const request = {
        input: [
          {
            type: 'input_image',
            image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
          },
        ],
        modelSettings: {},
        tools: [],
        outputType: { type: 'text' } as any,
        handoffs: [],
        tracing: { enabled: false } as any,
      };

      await expect(model.getResponse(request)).resolves.toMatchObject({
        output: expect.any(Array),
      });
    });

    it('should handle image URL input', async () => {
      const request = {
        input: [
          {
            type: 'input_image',
            image: 'https://example.com/image.png'
          },
        ],
        modelSettings: {},
        tools: [],
        outputType: { type: 'text' } as any,
        handoffs: [],
        tracing: { enabled: false } as any,
      };

      await expect(model.getResponse(request)).resolves.toMatchObject({
        output: expect.any(Array),
      });
    });

    it('should handle image object with URL property', async () => {
      const request = {
        input: [
          {
            type: 'input_image',
            image: { url: 'https://example.com/image.jpg' }
          },
        ],
        modelSettings: {},
        tools: [],
        outputType: { type: 'text' } as any,
        handoffs: [],
        tracing: { enabled: false } as any,
      };

      await expect(model.getResponse(request)).resolves.toMatchObject({
        output: expect.any(Array),
      });
    });

    it('should reject invalid base64 image format', async () => {
      const request = {
        input: [
          {
            type: 'input_image',
            image: 'data:image/png;base64,invalid!!!'
          },
        ],
        modelSettings: {},
        tools: [],
        outputType: { type: 'text' } as any,
        handoffs: [],
        tracing: { enabled: false } as any,
      };

      // Should reject invalid base64 data
      await expect(model.getResponse(request)).rejects.toThrow();
    });

    it('should throw error for image fileId references', async () => {
      const request = {
        input: [
          {
            type: 'input_image',
            image: { fileId: 'file-123' }
          },
        ],
        modelSettings: {},
        tools: [],
        outputType: { type: 'text' } as any,
        handoffs: [],
        tracing: { enabled: false } as any,
      };

      await expect(model.getResponse(request)).rejects.toThrow(
        'Image fileId references are not yet supported'
      );
    });

    it('should throw error for unsupported file input', async () => {
      const request = {
        input: [
          { type: 'input_file', file: { fileId: '123' } },
        ],
        modelSettings: {},
        tools: [],
        outputType: { type: 'text' } as any,
        handoffs: [],
        tracing: { enabled: false } as any,
      };

      await expect(model.getResponse(request)).rejects.toThrow(
        'does not yet support input_file type'
      );
    });

    it('should throw error for unsupported audio input', async () => {
      const request = {
        input: [
          { type: 'input_audio', audio: 'audiodata' },
        ],
        modelSettings: {},
        tools: [],
        outputType: { type: 'text' } as any,
        handoffs: [],
        tracing: { enabled: false } as any,
      };

      await expect(model.getResponse(request)).rejects.toThrow(
        'does not yet support input_audio type'
      );
    });

    it('should handle function_call_result by converting to text', async () => {
      const request = {
        input: [
          {
            type: 'function_call_result',
            callId: 'call_123',
            name: 'get_weather',
            result: 'sunny'
          },
        ],
        modelSettings: {},
        tools: [],
        outputType: { type: 'text' } as any,
        handoffs: [],
        tracing: { enabled: false } as any,
      };

      const response = await model.getResponse(request);
      expect(response.output).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'message',
          }),
        ]),
      );
    });

    it('should handle system instructions', async () => {
      const request = {
        systemInstructions: 'You are a helpful assistant.',
        input: 'Hello',
        modelSettings: {},
        tools: [],
        outputType: { type: 'text' } as any,
        handoffs: [],
        tracing: { enabled: false } as any,
      };

      await expect(model.getResponse(request)).resolves.toMatchObject({
        output: expect.any(Array),
      });
    });
  });

  describe('Response Format', () => {
    it('should return ModelResponse with correct structure', async () => {
      const model = provider.getModel();

      const request = {
        input: 'Test',
        modelSettings: {},
        tools: [],
        outputType: { type: 'text' } as any as any,
        handoffs: [],
        tracing: { enabled: false } as any,
      };

      const response = await model.getResponse(request as any);

      expect(response.usage).toMatchObject({
        inputTokens: expect.any(Number),
        outputTokens: expect.any(Number),
        totalTokens: expect.any(Number),
      });

      expect(response.output).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'message' })]),
      );

      expect(response.responseId).toBe('mock-thread');
    }, 30000); // 30 second timeout for backend connection
  });

  describe('Streaming', () => {
    it('should return async iterable from getStreamedResponse', () => {
      const model = provider.getModel();
      const request = {
        input: 'Test',
        modelSettings: {},
        tools: [],
        outputType: { type: 'text' } as any,
        handoffs: [],
        tracing: { enabled: false } as any,
      };

      const stream = model.getStreamedResponse(request as any);

      // Should be async iterable
      expect(stream[Symbol.asyncIterator]).toBeDefined();
    });

    it('should emit proper stream event types', async () => {
      const model = provider.getModel();
      const request = {
        input: 'Test',
        modelSettings: {},
        tools: [],
        outputType: { type: 'text' } as any,
        handoffs: [],
        tracing: { enabled: false } as any,
      };

      const stream = model.getStreamedResponse(request as any);
      const events: string[] = [];

      for await (const event of stream) {
        events.push(event.type);
      }

      expect(events[0]).toBe('response_started');
      expect(events[events.length - 1]).toBe('response_done');
      expect(events.includes('output_text_delta')).toBe(true);
    }, 30000); // 30 second timeout for backend connection

    it('should emit incremental output_text_delta values for multiple updates', async () => {
      const usage = {
        input_tokens: 8,
        output_tokens: 2,
        reasoning_tokens: 0,
        cached_input_tokens: 0,
      };

      mockThread.runStreamed = jest.fn(async () => ({
        events: (async function* () {
          yield { type: 'thread.started', thread_id: 'mock-thread' };
          yield { type: 'item.started', item: { type: 'agent_message', text: '' } };
          yield { type: 'item.updated', item: { type: 'agent_message', text: 'Hello' } };
          yield { type: 'item.updated', item: { type: 'agent_message', text: 'Hello world' } };
          yield { type: 'item.completed', item: { type: 'agent_message', text: 'Hello world' } };
          yield { type: 'turn.completed', usage };
        })(),
      }));

      const model = provider.getModel();
      const request: ModelRequest = {
        input: 'Test',
        modelSettings: {},
        tools: [],
        outputType: 'text',
        handoffs: [],
        tracing: false,
      };

      const deltas: string[] = [];
      let finalText = '';

      for await (const event of model.getStreamedResponse(request)) {
        if (event.type === 'output_text_delta') {
          deltas.push(event.delta);
        }
        if (event.type === 'response_done') {
          finalText = extractAssistantOutputText(event.response.output);
        }
      }

      expect(deltas).toEqual(['Hello', ' world']);
      expect(finalText).toBe('Hello world');
    });

    it('should not emit duplicate delta events for the same text', async () => {
      // This test verifies the fix for duplicate streaming output.
      // Previously, both output_text_delta AND response.output_text.delta were emitted
      // for each text update, causing consumers to see "HelloHello" instead of "Hello".
      const usage = {
        input_tokens: 8,
        output_tokens: 2,
        reasoning_tokens: 0,
        cached_input_tokens: 0,
      };

      mockThread.runStreamed = jest.fn(async () => ({
        events: (async function* () {
          yield { type: 'thread.started', thread_id: 'mock-thread' };
          yield { type: 'item.started', item: { type: 'agent_message', text: '' } };
          yield { type: 'item.updated', item: { type: 'agent_message', text: 'Hello' } };
          yield { type: 'item.completed', item: { type: 'agent_message', text: 'Hello' } };
          yield { type: 'turn.completed', usage };
        })(),
      }));

      const model = provider.getModel();
      const request: ModelRequest = {
        input: 'Test',
        modelSettings: {},
        tools: [],
        outputType: 'text',
        handoffs: [],
        tracing: false,
      };

      const allDeltas: string[] = [];
      const deltaEventTypes: string[] = [];

      for await (const event of model.getStreamedResponse(request)) {
        // Collect all events that contain text deltas
        if (event.type === 'output_text_delta') {
          allDeltas.push(event.delta);
          deltaEventTypes.push('output_text_delta');
        }
        // Check for the old duplicate event type (should not exist anymore)
        if ((event as { type: string }).type === 'response.output_text.delta') {
          allDeltas.push((event as { delta: string }).delta);
          deltaEventTypes.push('response.output_text.delta');
        }
      }

      // Should only see one delta event per text update (no duplicates)
      expect(allDeltas).toEqual(['Hello']);
      expect(deltaEventTypes).toEqual(['output_text_delta']);
      // Concatenating all deltas should give the correct output (not doubled)
      expect(allDeltas.join('')).toBe('Hello');
    });

    it('should surface background events as model notifications', async () => {
      const usage = {
        input_tokens: 8,
        output_tokens: 2,
        cached_input_tokens: 0,
      };
      const backgroundThread = {
        id: 'bg-thread',
        run: jest.fn(async () => ({
          items: [{ id: 'msg', type: 'agent_message', text: 'Done' }],
          finalResponse: 'Done',
          usage,
        })),
        runStreamed: jest.fn(async () => ({
          events: (async function* () {
            yield { type: 'thread.started', thread_id: 'bg-thread' };
            yield { type: 'turn.started' };
            yield { type: 'background_event', message: 'Investigating issue…' };
            yield { type: 'item.completed', item: { id: 'msg', type: 'agent_message', text: 'Done' } };
            yield { type: 'turn.completed', usage };
          })(),
        })),
        onEvent: jest.fn(() => () => {}),
        sendBackgroundEvent: jest.fn(async () => {}),
      };

      const localProvider = new CodexProvider({ skipGitRepoCheck: true });
      (localProvider as any).codex = {
        startThread: jest.fn(() => backgroundThread),
        resumeThread: jest.fn(() => backgroundThread),
        registerTool: jest.fn(),
      };

      const model = localProvider.getModel();
      const request = {
        input: 'Trigger background notification',
        modelSettings: {},
        tools: [],
        outputType: { type: 'text' } as any,
        handoffs: [],
        tracing: { enabled: false } as any,
      };

      const stream = model.getStreamedResponse(request as any);
      const streamedEvents: any[] = [];
      for await (const event of stream) {
        streamedEvents.push(event);
      }

      const backgroundEvent = streamedEvents.find(
        (event) => event.type === 'model' && event.event?.type === 'background_event',
      );

      expect(backgroundEvent).toBeDefined();
      expect(backgroundEvent?.event?.message).toBe('Investigating issue…');
    });
  });

  describe('Plan and todo surfacing', () => {
    it('emits plan updates in streaming and includes plan metadata in buffered responses', async () => {
      const planItems = [
        { text: 'Implement feature', completed: false },
        { text: 'Write tests', completed: true },
      ];
      const usage = {
        input_tokens: 12,
        output_tokens: 4,
        cached_input_tokens: 0,
      };

      const planThread = {
        id: 'mock-thread',
        run: jest.fn(async () => ({
          items: [
            { id: 'plan_item', type: 'todo_list', items: planItems },
            { id: 'agent_msg', type: 'agent_message', text: 'Plan acknowledged' },
          ],
          finalResponse: 'Plan acknowledged',
          usage,
        })),
        runStreamed: jest.fn(async () => ({
          events: (async function* () {
            yield { type: 'thread.started', thread_id: 'mock-thread' };
            yield { type: 'turn.started' };
            yield {
              type: 'item.completed',
              item: { id: 'plan_item', type: 'todo_list', items: planItems },
            };
            yield {
              type: 'item.completed',
              item: { id: 'agent_msg', type: 'agent_message', text: 'Plan acknowledged' },
            };
            yield { type: 'turn.completed', usage };
          })(),
        })),
        onEvent: jest.fn(() => () => {}),
        sendBackgroundEvent: jest.fn(async () => {}),
      };

      const localProvider = new CodexProvider({
        skipGitRepoCheck: true,
      });
      const localMockCodex = {
        startThread: jest.fn(() => planThread),
        resumeThread: jest.fn(() => planThread),
        registerTool: jest.fn(),
      };
      (localProvider as any).codex = localMockCodex;

      const model = localProvider.getModel();
      const request = {
        input: 'Plan update test',
        modelSettings: {},
        tools: [],
        outputType: { type: 'text' } as any,
        handoffs: [],
        tracing: { enabled: false } as any,
      };

      const stream = model.getStreamedResponse(request as any);
      const streamedEvents: any[] = [];
      for await (const event of stream) {
        streamedEvents.push(event);
      }

      const planStreamEvent = streamedEvents.find(
        (event) => event.type === 'model' && event.event?.type === 'plan_update',
      ) as { event: { items: Array<{ text: string; completed: boolean }> } } | undefined;

      expect(planStreamEvent).toBeDefined();
      expect(planStreamEvent?.event.items).toEqual(planItems);

      const response = await model.getResponse(request as any);
      expect((response as any).plan?.items).toEqual(planItems);

      expect(planThread.runStreamed).toHaveBeenCalledTimes(1);
      expect(planThread.run).toHaveBeenCalledTimes(1);
    });
  });

  describe('Conversation State', () => {
    it('should support conversationId for multi-turn conversations', async () => {
      const model = provider.getModel();

      const request1 = {
        input: 'First message',
        modelSettings: {},
        tools: [],
        outputType: { type: 'text' } as any,
        handoffs: [],
        tracing: { enabled: false } as any,
      };

      const response1 = await model.getResponse(request1);
      expect(response1.responseId).toBe('mock-thread');

      const request2 = {
        input: 'Second message',
        conversationId: response1.responseId,
        modelSettings: {},
        tools: [],
        outputType: { type: 'text' } as any as any,
        handoffs: [],
        tracing: { enabled: false } as any,
      };

      const response2 = await model.getResponse(request2 as any);
      expect(response2.responseId).toBe(response1.responseId);
    }, 60000); // 60 second timeout for multi-turn conversation
  });

  describe('Error Handling', () => {
    it('should handle empty input gracefully', async () => {
      const model = provider.getModel();
      const request = {
        input: '',
        modelSettings: {},
        tools: [],
        outputType: { type: 'text' } as any,
        handoffs: [],
        tracing: { enabled: false } as any,
      };

      await expect(model.getResponse(request)).resolves.toMatchObject({
        output: expect.any(Array),
      });
    });

    it('should handle array input items', async () => {
      const model = provider.getModel();
      const request = {
        input: [],
        modelSettings: {},
        tools: [],
        outputType: { type: 'text' } as any,
        handoffs: [],
        tracing: { enabled: false } as any,
      };

      await expect(model.getResponse(request)).resolves.toMatchObject({
        output: expect.any(Array),
      });
    });
  });

  describe('Streaming Deduplication', () => {
    it('should calculate deltas correctly across multiple item.updated events', async () => {
      const usage = {
        input_tokens: 10,
        output_tokens: 10,
        reasoning_tokens: 0,
        cached_input_tokens: 0,
      };

      mockThread.runStreamed = jest.fn(async () => ({
        events: (async function* () {
          yield { type: 'thread.started', thread_id: 'mock-thread' };
          yield { type: 'item.started', item: { type: 'agent_message', text: '' } };
          yield { type: 'item.updated', item: { type: 'agent_message', text: 'H' } };
          yield { type: 'item.updated', item: { type: 'agent_message', text: 'He' } };
          yield { type: 'item.updated', item: { type: 'agent_message', text: 'Hel' } };
          yield { type: 'item.updated', item: { type: 'agent_message', text: 'Hell' } };
          yield { type: 'item.updated', item: { type: 'agent_message', text: 'Hello' } };
          yield { type: 'item.completed', item: { type: 'agent_message', text: 'Hello' } };
          yield { type: 'turn.completed', usage };
        })(),
      }));

      const model = provider.getModel();
      const request: ModelRequest = {
        input: 'Test',
        modelSettings: {},
        tools: [],
        outputType: 'text',
        handoffs: [],
        tracing: false,
      };

      const deltas: string[] = [];
      for await (const event of model.getStreamedResponse(request)) {
        if (event.type === 'output_text_delta') {
          deltas.push(event.delta);
        }
      }

      // Each delta should be exactly the new character
      expect(deltas).toEqual(['H', 'e', 'l', 'l', 'o']);
      expect(deltas.join('')).toBe('Hello');
    });

    it('should not emit raw_event for item.updated with agent_message', async () => {
      const usage = {
        input_tokens: 5,
        output_tokens: 5,
        reasoning_tokens: 0,
        cached_input_tokens: 0,
      };

      mockThread.runStreamed = jest.fn(async () => ({
        events: (async function* () {
          yield { type: 'thread.started', thread_id: 'mock-thread' };
          yield { type: 'item.started', item: { type: 'agent_message', text: '' } };
          yield { type: 'item.updated', item: { type: 'agent_message', text: 'Test' } };
          yield { type: 'item.completed', item: { type: 'agent_message', text: 'Test' } };
          yield { type: 'turn.completed', usage };
        })(),
      }));

      const model = provider.getModel();
      const request: ModelRequest = {
        input: 'Test',
        modelSettings: {},
        tools: [],
        outputType: 'text',
        handoffs: [],
        tracing: false,
      };

      const allEvents: any[] = [];
      for await (const event of model.getStreamedResponse(request)) {
        allEvents.push(event);
      }

      // Find raw_events that contain item.updated with agent_message
      const rawEventsWithAgentMessage = allEvents.filter(e =>
        e.type === 'raw_event' &&
        e.raw?.type === 'item.updated' &&
        e.raw?.item?.type === 'agent_message'
      );

      expect(rawEventsWithAgentMessage).toHaveLength(0);
    });

    it('should not emit raw_event for item.completed with agent_message', async () => {
      const usage = {
        input_tokens: 5,
        output_tokens: 5,
        reasoning_tokens: 0,
        cached_input_tokens: 0,
      };

      mockThread.runStreamed = jest.fn(async () => ({
        events: (async function* () {
          yield { type: 'thread.started', thread_id: 'mock-thread' };
          yield { type: 'item.started', item: { type: 'agent_message', text: '' } };
          yield { type: 'item.updated', item: { type: 'agent_message', text: 'Done' } };
          yield { type: 'item.completed', item: { type: 'agent_message', text: 'Done' } };
          yield { type: 'turn.completed', usage };
        })(),
      }));

      const model = provider.getModel();
      const request: ModelRequest = {
        input: 'Test',
        modelSettings: {},
        tools: [],
        outputType: 'text',
        handoffs: [],
        tracing: false,
      };

      const allEvents: any[] = [];
      for await (const event of model.getStreamedResponse(request)) {
        allEvents.push(event);
      }

      // Find raw_events that contain item.completed with agent_message
      const rawEventsWithCompleted = allEvents.filter(e =>
        e.type === 'raw_event' &&
        e.raw?.type === 'item.completed' &&
        e.raw?.item?.type === 'agent_message'
      );

      expect(rawEventsWithCompleted).toHaveLength(0);
    });

    it('should not emit raw_event for turn.completed', async () => {
      const usage = {
        input_tokens: 5,
        output_tokens: 5,
        reasoning_tokens: 0,
        cached_input_tokens: 0,
      };

      mockThread.runStreamed = jest.fn(async () => ({
        events: (async function* () {
          yield { type: 'thread.started', thread_id: 'mock-thread' };
          yield { type: 'item.started', item: { type: 'agent_message', text: '' } };
          yield { type: 'item.updated', item: { type: 'agent_message', text: 'Response' } };
          yield { type: 'item.completed', item: { type: 'agent_message', text: 'Response' } };
          yield { type: 'turn.completed', usage };
        })(),
      }));

      const model = provider.getModel();
      const request: ModelRequest = {
        input: 'Test',
        modelSettings: {},
        tools: [],
        outputType: 'text',
        handoffs: [],
        tracing: false,
      };

      const allEvents: any[] = [];
      for await (const event of model.getStreamedResponse(request)) {
        allEvents.push(event);
      }

      // Find raw_events that contain turn.completed
      const rawEventsWithTurnCompleted = allEvents.filter(e =>
        e.type === 'raw_event' &&
        e.raw?.type === 'turn.completed'
      );

      expect(rawEventsWithTurnCompleted).toHaveLength(0);
    });

    it('should handle agent_message and reasoning independently without cross-contamination', async () => {
      const usage = {
        input_tokens: 10,
        output_tokens: 10,
        reasoning_tokens: 5,
        cached_input_tokens: 0,
      };

      mockThread.runStreamed = jest.fn(async () => ({
        events: (async function* () {
          yield { type: 'thread.started', thread_id: 'mock-thread' };
          // Start reasoning
          yield { type: 'item.started', item: { type: 'reasoning', text: '' } };
          yield { type: 'item.updated', item: { type: 'reasoning', text: 'Thinking...' } };
          yield { type: 'item.updated', item: { type: 'reasoning', text: 'Thinking... about this' } };
          yield { type: 'item.completed', item: { type: 'reasoning', text: 'Thinking... about this' } };
          // Start agent message
          yield { type: 'item.started', item: { type: 'agent_message', text: '' } };
          yield { type: 'item.updated', item: { type: 'agent_message', text: 'Here is ' } };
          yield { type: 'item.updated', item: { type: 'agent_message', text: 'Here is my answer' } };
          yield { type: 'item.completed', item: { type: 'agent_message', text: 'Here is my answer' } };
          yield { type: 'turn.completed', usage };
        })(),
      }));

      const model = provider.getModel();
      const request: ModelRequest = {
        input: 'Test',
        modelSettings: {},
        tools: [],
        outputType: 'text',
        handoffs: [],
        tracing: false,
      };

      const textDeltas: string[] = [];
      const reasoningDeltas: string[] = [];

      for await (const event of model.getStreamedResponse(request)) {
        if (event.type === 'output_text_delta') {
          textDeltas.push(event.delta);
        }
        if (event.type === 'model' && (event as any).event?.type === 'reasoning_delta') {
          reasoningDeltas.push((event as any).event.delta);
        }
      }

      // Text deltas should be independent
      expect(textDeltas).toEqual(['Here is ', 'my answer']);
      expect(textDeltas.join('')).toBe('Here is my answer');

      // Reasoning deltas should be independent
      expect(reasoningDeltas).toEqual(['Thinking...', ' about this']);
      expect(reasoningDeltas.join('')).toBe('Thinking... about this');
    });

    it('should handle empty and identical updates correctly', async () => {
      const usage = {
        input_tokens: 5,
        output_tokens: 5,
        reasoning_tokens: 0,
        cached_input_tokens: 0,
      };

      mockThread.runStreamed = jest.fn(async () => ({
        events: (async function* () {
          yield { type: 'thread.started', thread_id: 'mock-thread' };
          yield { type: 'item.started', item: { type: 'agent_message', text: '' } };
          yield { type: 'item.updated', item: { type: 'agent_message', text: '' } }; // Empty
          yield { type: 'item.updated', item: { type: 'agent_message', text: 'Same' } };
          yield { type: 'item.updated', item: { type: 'agent_message', text: 'Same' } }; // Duplicate
          yield { type: 'item.updated', item: { type: 'agent_message', text: 'Same text' } };
          yield { type: 'item.completed', item: { type: 'agent_message', text: 'Same text' } };
          yield { type: 'turn.completed', usage };
        })(),
      }));

      const model = provider.getModel();
      const request: ModelRequest = {
        input: 'Test',
        modelSettings: {},
        tools: [],
        outputType: 'text',
        handoffs: [],
        tracing: false,
      };

      const deltas: string[] = [];
      for await (const event of model.getStreamedResponse(request)) {
        if (event.type === 'output_text_delta') {
          deltas.push(event.delta);
        }
      }

      // Should only emit deltas when there's actual new content
      expect(deltas).toEqual(['Same', ' text']);
      expect(deltas.every(d => d.length > 0)).toBe(true);
    });

    it('should still emit raw_event for non-text item types like command_execution', async () => {
      const usage = {
        input_tokens: 5,
        output_tokens: 5,
        reasoning_tokens: 0,
        cached_input_tokens: 0,
      };

      mockThread.runStreamed = jest.fn(async () => ({
        events: (async function* () {
          yield { type: 'thread.started', thread_id: 'mock-thread' };
          yield { type: 'item.started', item: { type: 'command_execution', command: 'ls' } };
          yield { type: 'item.updated', item: { type: 'command_execution', command: 'ls', aggregated_output: 'file1.txt' } };
          yield { type: 'item.completed', item: { type: 'command_execution', command: 'ls', aggregated_output: 'file1.txt', exit_code: 0 } };
          yield { type: 'item.started', item: { type: 'agent_message', text: '' } };
          yield { type: 'item.updated', item: { type: 'agent_message', text: 'Done' } };
          yield { type: 'item.completed', item: { type: 'agent_message', text: 'Done' } };
          yield { type: 'turn.completed', usage };
        })(),
      }));

      const model = provider.getModel();
      const request: ModelRequest = {
        input: 'Test',
        modelSettings: {},
        tools: [],
        outputType: 'text',
        handoffs: [],
        tracing: false,
      };

      const allEvents: any[] = [];
      for await (const event of model.getStreamedResponse(request)) {
        allEvents.push(event);
      }

      // command_execution updates SHOULD still be wrapped in raw_event
      const commandRawEvents = allEvents.filter(e =>
        e.type === 'raw_event' &&
        e.raw?.item?.type === 'command_execution'
      );

      expect(commandRawEvents.length).toBeGreaterThan(0);
    });
  });
});
