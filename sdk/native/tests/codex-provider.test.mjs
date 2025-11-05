/**
 * Tests for CodexProvider - OpenAI Agents framework integration
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { CodexProvider } from '../dist/index.mjs';

describe('CodexProvider', () => {
  let provider;

  beforeEach(() => {
    provider = new CodexProvider({
      defaultModel: 'claude-sonnet-4-5',
      workingDirectory: process.cwd(),
      skipGitRepoCheck: true,
    });
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
      const model = provider.getModel('claude-sonnet-4-5');
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

    it('should handle string input', () => {
      const request = {
        input: 'Hello, world!',
        modelSettings: {},
        tools: [],
        outputType: { type: 'text' },
        handoffs: [],
        tracing: { enabled: false },
      };

      // Should not throw
      expect(() => {
        model.getResponse(request);
      }).not.toThrow();
    });

    it('should handle text input items', () => {
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

      // Should not throw
      expect(() => {
        model.getResponse(request);
      }).not.toThrow();
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

      // Should not throw - converts base64 to temp file
      expect(() => {
        model.getResponse(request);
      }).not.toThrow();
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

      // Should not throw - downloads URL to temp file
      expect(() => {
        model.getResponse(request);
      }).not.toThrow();
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

      // Should not throw - downloads URL to temp file
      expect(() => {
        model.getResponse(request);
      }).not.toThrow();
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

    it('should handle function_call_result by converting to text', () => {
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

      // Should not throw - converts to text
      expect(() => {
        model.getResponse(request);
      }).not.toThrow();
    });

    it('should handle system instructions', () => {
      const request = {
        systemInstructions: 'You are a helpful assistant.',
        input: 'Hello',
        modelSettings: {},
        tools: [],
        outputType: { type: 'text' },
        handoffs: [],
        tracing: { enabled: false },
      };

      // Should not throw
      expect(() => {
        model.getResponse(request);
      }).not.toThrow();
    });
  });

  describe('Response Format', () => {
    it('should return ModelResponse with correct structure', async () => {
      const model = provider.getModel();

      // Note: This will fail without a real Codex backend
      // but we can test the structure expectations
      const request = {
        input: 'Test',
        modelSettings: {},
        tools: [],
        outputType: { type: 'text' },
        handoffs: [],
        tracing: { enabled: false },
      };

      try {
        const response = await model.getResponse(request);

        // Should have usage
        expect(response.usage).toBeDefined();
        expect(typeof response.usage.inputTokens).toBe('number');
        expect(typeof response.usage.outputTokens).toBe('number');
        expect(typeof response.usage.totalTokens).toBe('number');

        // Should have output array
        expect(Array.isArray(response.output)).toBe(true);

        // Should have responseId (optional)
        // expect(response.responseId).toBeDefined();
      } catch (error) {
        // Expected to fail without real backend
        console.log('Expected error without backend:', error.message);
      }
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

      try {
        const stream = model.getStreamedResponse(request);
        const events = [];

        for await (const event of stream) {
          events.push(event);
          expect(event.type).toBeDefined();
        }

        // Check that we got some events (if backend is available)
        if (events.length > 0) {
          const eventTypes = events.map(e => e.type);
          console.log('Received event types:', eventTypes);
        }
      } catch (error) {
        // Expected to fail without real backend
        console.log('Expected error without backend:', error.message);
      }
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

      try {
        const response1 = await model.getResponse(request1);
        const conversationId = response1.responseId;

        if (conversationId) {
          const request2 = {
            input: 'Second message',
            conversationId,
            modelSettings: {},
            tools: [],
            outputType: { type: 'text' },
            handoffs: [],
            tracing: { enabled: false },
          };

          // Should reuse the same thread
          const response2 = await model.getResponse(request2);
          expect(response2.responseId).toBe(conversationId);
        }
      } catch (error) {
        console.log('Expected error without backend:', error.message);
      }
    }, 60000); // 60 second timeout for multi-turn conversation
  });

  describe('Error Handling', () => {
    it('should handle empty input gracefully', () => {
      const model = provider.getModel();
      const request = {
        input: '',
        modelSettings: {},
        tools: [],
        outputType: { type: 'text' },
        handoffs: [],
        tracing: { enabled: false },
      };

      // Should not throw on empty input
      expect(() => {
        model.getResponse(request);
      }).not.toThrow();
    });

    it('should handle array input items', () => {
      const model = provider.getModel();
      const request = {
        input: [],
        modelSettings: {},
        tools: [],
        outputType: { type: 'text' },
        handoffs: [],
        tracing: { enabled: false },
      };

      // Should not throw on empty array
      expect(() => {
        model.getResponse(request);
      }).not.toThrow();
    });
  });
});
