# OpenAI Agents Integration

This package provides a `CodexProvider` that enables using Codex as a model provider for the [OpenAI Agents JS framework](https://github.com/openai/openai-agents-js).

## Installation

```bash
npm install @openai/codex-native @openai/agents
```

## Quick Start

```typescript
import { CodexProvider } from '@openai/codex-native';
import { Agent, Runner } from '@openai/agents';

// Create the provider
const provider = new CodexProvider({
  defaultModel: 'gpt-5-codex'
});

// Create an agent
const agent = new Agent({
  name: 'CodeAssistant',
  instructions: 'You are a helpful coding assistant'
});

// Run with Codex backend
const runner = new Runner({ modelProvider: provider });
const result = await runner.run(agent, 'Fix the failing tests');

console.log(result.finalOutput);
```

## Features

### ✅ Full Provider Compatibility

The `CodexProvider` implements the complete `ModelProvider` interface:
- `getModel(modelName?)` - Get a Codex-backed model instance
- `getResponse(request)` - Get buffered responses
- `getStreamedResponse(request)` - Get real-time streaming responses

### ✅ Conversation Continuity

The provider automatically manages thread state:
- Uses `conversationId` or `previousResponseId` from requests
- Maintains context across multiple turns
- Supports thread resumption

### ✅ Structured Output

Codex's JSON schema support integrates seamlessly:
- Provider passes `outputType.schema` to Codex
- Enforces schema during generation
- Returns validated structured data

### ✅ Internal Tool Execution

Codex handles tools internally (no framework configuration needed):
- Bash commands and scripts
- File system operations
- Git operations
- MCP (Model Context Protocol) tools

### ✅ Streaming Support

Real-time updates during generation:
- `response_started` - Generation begins
- `reasoning_done` - Reasoning output
- `response_done` - Full response with usage

## Architecture

### How It Works

```
┌─────────────────┐
│  OpenAI Agents  │
│   Framework     │
└────────┬────────┘
         │
         │ ModelRequest
         ▼
┌─────────────────┐
│  CodexProvider  │  ◄─ You are here
└────────┬────────┘
         │
         │ Codex SDK API
         ▼
┌─────────────────┐
│   Codex NAPI    │
│    Bindings     │
└────────┬────────┘
         │
         │ Native calls
         ▼
┌─────────────────┐
│   codex-rs      │
│   (Rust core)   │
└─────────────────┘
```

### Key Differences from OpenAI

| Feature | OpenAI Provider | Codex Provider |
|---------|----------------|----------------|
| **Tool Execution** | Framework manages tools | Codex manages tools internally |
| **File Access** | Limited to API | Full file system access |
| **Commands** | Not supported | Bash, git, etc. supported |
| **MCP Servers** | Not supported | Full MCP integration |
| **Model Backend** | OpenAI API | Codex runtime (local or cloud) |

## Configuration

### Provider Options

```typescript
interface CodexProviderOptions {
  /** API key for Codex authentication */
  apiKey?: string;

  /** Base URL for Codex API (optional) */
  baseUrl?: string;

  /** Default model when none specified */
  defaultModel?: string;

  /** Working directory for file operations */
  workingDirectory?: string;

  /** Skip git repository validation */
  skipGitRepoCheck?: boolean;
}
```

### Example Configurations

**Local Development:**
```typescript
const provider = new CodexProvider({
  workingDirectory: process.cwd(),
  skipGitRepoCheck: true,
  defaultModel: 'gpt-5-codex'
});
```

**Production:**
```typescript
const provider = new CodexProvider({
  baseUrl: 'https://api.codex.example.com',
  defaultModel: 'gpt-5-codex',
  workingDirectory: '/app',
  skipGitRepoCheck: false,
  // apiKey: '...' // Optional: only needed if your deployment enforces explicit credentials
});
```

## Usage Examples

### Single Agent

```typescript
import { CodexProvider } from '@openai/codex-native';
import { Agent, Runner } from '@openai/agents';

const provider = new CodexProvider();

const bugFixer = new Agent({
  name: 'BugFixer',
  instructions: `Analyze code, find bugs, and fix them.
  Always run tests after making changes to verify fixes.`
});

const runner = new Runner({ modelProvider: provider });
const result = await runner.run(bugFixer, 'Fix the TypeScript errors in src/');

console.log(result.finalOutput);
```

### Multi-Agent Workflow

```typescript
const coder = new Agent({
  name: 'Coder',
  instructions: 'Write clean, tested code'
});

const reviewer = new Agent({
  name: 'Reviewer',
  instructions: 'Review code for quality and suggest improvements'
});

const runner = new Runner({ modelProvider: provider });

// Coder implements feature
const implementation = await runner.run(coder, 'Add user authentication');

// Reviewer checks the work
const review = await runner.run(reviewer, `Review this implementation:
${implementation.finalOutput}`);

console.log(review.finalOutput);
```

### Streaming Progress

```typescript
const model = provider.getModel('gpt-5-codex');

const stream = model.getStreamedResponse({
  systemInstructions: 'You are a coding assistant',
  input: 'Refactor the auth module',
  modelSettings: { temperature: 0.7 },
  tools: [],
  outputType: { type: 'json_schema', schema: {} },
  handoffs: [],
  tracing: { enabled: true }
});

for await (const event of stream) {
  switch (event.type) {
    case 'output_text_delta':
      process.stdout.write(event.delta);
      break;
    case 'response_done':
      console.log('\nUsage:', event.response.usage);
      break;
  }
}
```

## API Reference

### `CodexProvider`

#### Constructor

```typescript
new CodexProvider(options?: CodexProviderOptions)
```

#### Methods

##### `getModel(modelName?: string): Model`

Get a Codex-backed model instance.

**Parameters:**
- `modelName` - Model to use (defaults to `defaultModel` from options)

**Returns:** `Model` instance

### `Model` Interface

#### `getResponse(request: ModelRequest): Promise<ModelResponse>`

Get a buffered response from Codex.

**Parameters:**
- `request.systemInstructions` - System prompt
- `request.input` - User input (string or multimodal)
- `request.modelSettings` - Temperature, max tokens, etc.
- `request.outputType` - Structured output schema
- `request.conversationId` - Thread identifier for continuity

**Returns:** Complete `ModelResponse` with usage and output items

#### `getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent>`

Get a streamed response from Codex.

**Parameters:** Same as `getResponse`

**Returns:** Async iterable of `StreamEvent` objects

## Type Definitions

The provider includes full TypeScript definitions for:
- `ModelProvider` - Provider interface
- `Model` - Model interface
- `ModelRequest` - Request format
- `ModelResponse` - Response format
- `StreamEvent` - Streaming event types
- `AgentInputItem` - Input types (text, image, audio, files)
- `AgentOutputItem` - Output types (messages, reasoning, etc.)
- `Usage` - Token usage metrics

All types are exported from the package:

```typescript
import type {
  ModelProvider,
  Model,
  ModelRequest,
  ModelResponse
} from '@openai/codex-native';
```

## Limitations

### Not Supported (Yet)

- **Framework Tool Execution**: Tools are handled by Codex internally, not by the Agents framework
- **Agent Handoffs**: Not yet mapped (could use separate Codex threads)
- **Image Input**: Requires temp file handling (coming soon)
- **Audio Input/Output**: Not yet supported

### Workarounds

**Tool Execution**: Let Codex handle tools internally via its built-in capabilities (bash, file edits, MCP servers)

**Handoffs**: Use separate provider instances with different threads

**Images**: Pre-process images to local files that Codex can access

## Examples

See the `examples/` directory for complete examples:
- `agents-integration.ts` - Basic usage demonstration
- More examples coming soon!

## Contributing

Issues and pull requests welcome! Please see the main [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines.

## License

MIT - See [LICENSE](../../LICENSE) for details.
