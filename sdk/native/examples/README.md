# Codex Native SDK - Examples

This directory contains examples demonstrating how to use the Codex Native SDK with the OpenAI Agents framework.

## Prerequisites

```bash
npm install @codex-native/sdk @openai/agents zod
```

## Examples Overview

### Basic CodexProvider Usage

#### 1. **codex-provider-direct.ts**
The simplest way to use CodexProvider - create a provider, get a model, and pass it directly to an Agent.

```bash
npx tsx examples/codex-provider-direct.ts
```

**Demonstrates:**
- Direct model instantiation
- Basic agent creation
- Multi-modal input support (text + images)

#### 2. **codex-provider-global.ts**
Register CodexProvider globally for use across multiple agents and runs.

```bash
npx tsx examples/codex-provider-global.ts
```

**Demonstrates:**
- Global provider registration
- Reusing provider across multiple agents
- Thread continuity

#### 3. **codex-provider-run.ts**
Use CodexProvider for specific runs without global registration.

```bash
npx tsx examples/codex-provider-run.ts
```

**Demonstrates:**
- Per-run provider configuration
- Task-specific agent usage

### Advanced Features

#### 4. **agents-with-tools.ts** ⭐
Comprehensive example showing custom tools and multi-modal inputs.

```bash
npx tsx examples/agents-with-tools.ts
```

**Demonstrates:**
- Type-safe tool definitions with Zod schemas
- Automatic tool registration
- Text-only queries
- Multi-modal queries (text + images)
- Image input formats (URLs, base64, file paths)
- Weather and temperature conversion tools

#### 5. **automatic-tool-registration.ts** 🔧
Deep dive into how tools are automatically registered and used.

```bash
npx tsx examples/automatic-tool-registration.ts
```

**Demonstrates:**
- Single tool registration
- Multiple tools in one agent
- Tool chaining (using multiple tools sequentially)
- Automatic parameter validation with Zod
- Calculator, unit converter, and text analysis tools

#### 6. **streaming-deltas.ts** 🌊
Real-time streaming responses with incremental updates.

```bash
npx tsx examples/streaming-deltas.ts
```

**Demonstrates:**
- Streaming text deltas (character-by-character)
- Streaming reasoning deltas (extended thinking)
- Different stream event types
- Streaming with image inputs
- Building responses from deltas
- Usage statistics tracking

#### 7. **agents-integration.ts**
Comprehensive overview of CodexProvider capabilities and architecture.

```bash
npx tsx examples/agents-integration.ts
```

**Demonstrates:**
- Full system architecture
- Multi-agent workflows
- Structured output support
- Direct provider usage for testing

## Key Features Demonstrated

### Multi-Modal Input Support

CodexProvider supports three image input formats:

```typescript
// 1. URL
{ type: 'input_image', image: 'https://example.com/image.png' }

// 2. Base64 data URL
{ type: 'input_image', image: 'data:image/png;base64,iVBOR...' }

// 3. Local file path
{ type: 'input_image', image: '/path/to/image.png' }
```

Images are automatically converted to the format Codex expects.

### Automatic Tool Registration

Tools are automatically registered when passed to an Agent:

```typescript
const agent = new Agent({
  name: 'MyAgent',
  model: codexModel,
  tools: [tool1, tool2, tool3], // Automatically registered!
});
```

No manual `tool.register()` or `provider.addTool()` calls needed.

### Streaming Deltas

Stream responses in real-time:

```typescript
for await (const event of model.getStreamedResponse(request)) {
  if (event.type === 'output_text_delta') {
    process.stdout.write(event.delta);
  }
}
```

Event types:
- `response_started` - Stream begins
- `output_text_delta` - Incremental text
- `output_text_done` - Text complete
- `reasoning_delta` - Extended thinking updates
- `reasoning_done` - Reasoning complete
- `response_done` - Full response with usage stats
- `error` - Error occurred

### Type-Safe Tools with Zod

Define tools with automatic validation:

```typescript
const myTool = tool({
  name: 'my_tool',
  description: 'Does something useful',
  parameters: z.object({
    param1: z.string().describe('First parameter'),
    param2: z.number().describe('Second parameter'),
  }),
  execute: async (input) => {
    // input is type-safe!
    return `Result: ${input.param1} - ${input.param2}`;
  },
});
```

## Running Examples

All examples can be run with:

```bash
npx tsx examples/<example-name>.ts
```

Or use tsx in watch mode for development:

```bash
npx tsx --watch examples/<example-name>.ts
```

## Architecture

The Codex Native SDK provides:

1. **Native NAPI Bindings**: Direct connection to GPT-5 via native code (no HTTP overhead)
2. **OpenAI Agents Integration**: Full compatibility with the Agents framework
3. **Automatic Authentication**: No API key configuration needed in your code
4. **Multi-Modal Support**: Text and image inputs
5. **Streaming**: Real-time response updates
6. **Tool Integration**: Automatic registration and execution

## Learn More

- See the main SDK documentation for API details
- Check out the source code in `src/agents/` for implementation details
- Visit the OpenAI Agents documentation for framework concepts

## Contributing

Found a bug or want to add an example? Please open an issue or PR!
