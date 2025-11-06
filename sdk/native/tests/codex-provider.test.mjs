/**
 * Tests for CodexProvider - OpenAI Agents framework integration
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { CodexProvider } from '../dist/index.mjs';

const createMockThread = () => {
  const createUsage = () => ({
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
  };
};

describe('CodexProvider', () => {
  let provider;
  let mockCodex;
  let mockThread;
  let originalFetch;
  let mockFetch;

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
    provider.codex = mockCodex;
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
    let model;

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
    let model;

    beforeEach(() => {
      model = provider.getModel();
    });

    it('should handle string input', async () => {
      const request = {
        input: 'Hello, world!',
        modelSettings: {},
        tools: [],
        outputType: { type: 'text' },
        handoffs: [],
        tracing: { enabled: false },
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
        outputType: { type: 'text' },
        handoffs: [],
        tracing: { enabled: false },
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
        outputType: { type: 'text' },
        handoffs: [],
        tracing: { enabled: false },
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
        outputType: { type: 'text' },
        handoffs: [],
        tracing: { enabled: false },
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
        outputType: { type: 'text' },
        handoffs: [],
        tracing: { enabled: false },
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
        outputType: { type: 'text' },
        handoffs: [],
        tracing: { enabled: false },
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
        outputType: { type: 'text' },
        handoffs: [],
        tracing: { enabled: false },
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
        outputType: { type: 'text' },
        handoffs: [],
        tracing: { enabled: false },
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
        outputType: { type: 'text' },
        handoffs: [],
        tracing: { enabled: false },
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
        outputType: { type: 'text' },
        handoffs: [],
        tracing: { enabled: false },
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
        outputType: { type: 'text' },
        handoffs: [],
        tracing: { enabled: false },
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
        outputType: { type: 'text' },
        handoffs: [],
        tracing: { enabled: false },
      };

      const response = await model.getResponse(request);

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
        outputType: { type: 'text' },
        handoffs: [],
        tracing: { enabled: false },
      };

      const stream = model.getStreamedResponse(request);

      // Should be async iterable
      expect(stream[Symbol.asyncIterator]).toBeDefined();
    });

    it('should emit proper stream event types', async () => {
      const model = provider.getModel();
      const request = {
        input: 'Test',
        modelSettings: {},
        tools: [],
        outputType: { type: 'text' },
        handoffs: [],
        tracing: { enabled: false },
      };

      const expectedEventTypes = [
        'response_started',
        'output_text_delta',
        'output_text_done',
        'response_done',
      ];

      const stream = model.getStreamedResponse(request);
      const events = [];

      for await (const event of stream) {
        events.push(event.type);
      }

      expect(events).toEqual(expectedEventTypes);
    }, 30000); // 30 second timeout for backend connection
  });

  describe('Conversation State', () => {
    it('should support conversationId for multi-turn conversations', async () => {
      const model = provider.getModel();

      const request1 = {
        input: 'First message',
        modelSettings: {},
        tools: [],
        outputType: { type: 'text' },
        handoffs: [],
        tracing: { enabled: false },
      };

      const response1 = await model.getResponse(request1);
      expect(response1.responseId).toBe('mock-thread');

      const request2 = {
        input: 'Second message',
        conversationId: response1.responseId,
        modelSettings: {},
        tools: [],
        outputType: { type: 'text' },
        handoffs: [],
        tracing: { enabled: false },
      };

      const response2 = await model.getResponse(request2);
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
        outputType: { type: 'text' },
        handoffs: [],
        tracing: { enabled: false },
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
        outputType: { type: 'text' },
        handoffs: [],
        tracing: { enabled: false },
      };

      await expect(model.getResponse(request)).resolves.toMatchObject({
        output: expect.any(Array),
      });
    });
  });
});
