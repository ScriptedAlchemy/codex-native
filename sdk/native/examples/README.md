# Codex Native SDK Examples

This directory contains example scripts demonstrating various features of the `@codex-native/sdk`.

## Directory Structure

### `/basic` - Core Features
Basic SDK functionality and common use cases.

- **`streaming-deltas.ts`** — Real-time streaming response examples
  - Text streaming with incremental updates
  - Multi-modal input (text + images)
  - Understanding all stream event types
  - Token usage tracking

- **`review-example.ts`** — Code review functionality
  - Creating review sessions
  - Custom review prompts
  - Processing review findings
  - Review output handling

### `/tools` - Tool Management
Custom tool registration and override capabilities.

- **`automatic-tool-registration.ts`** — Automatic tool registration with agents
  - Tools registered automatically when passed to Agent
  - Multiple tools with different capabilities
  - Tool chaining and validation
  - Zod schema integration

- **`tool-override-example.ts`** — Built-in tool override
  - Replacing built-in tools with custom implementations
  - Mock implementations for testing
  - Safety wrappers (blocking dangerous commands)
  - Logging and instrumentation
  - Multiple tool overrides

### `/provider` - CodexProvider Integration
OpenAI Agents framework integration examples.

- **`codex-provider-direct.ts`** — Direct provider usage
  - Basic text input
  - Multi-modal input (text + images)
  - Manual provider instantiation

- **`codex-provider-global.ts`** — Global provider configuration
  - Setting provider as default for all agents
  - Shared configuration across agents

- **`codex-provider-run.ts`** — Simple provider execution
  - Minimal example of running with CodexProvider
  - Quick-start pattern

### `/agents` - OpenAI Agents Framework
Advanced multi-agent workflows using the OpenAI Agents SDK.

- **`agents-integration.ts`** — CodexProvider with OpenAI Agents
  - Single and multi-agent workflows
  - Structured output
  - Streaming support
  - Conversation continuity
  - Internal tool execution

- **`agents-with-tools.ts`** — Agents with custom tools
  - Tool definition with Agents framework
  - Custom weather and temperature tools
  - Framework tool execution patterns

- **`multi-agent-handoffs.ts`** — Multi-agent handoffs and specialization
  - Specialized agents for different tasks
  - Triage agent for routing requests
  - Agent-to-agent handoffs
  - Collaborative multi-step workflows
  - Context preservation across handoffs

- **`structured-output.ts`** — JSON schema validation and structured output
  - Defining schemas with Zod
  - Code analysis with structured results
  - Test plan generation
  - API documentation generation
  - Performance analysis with metrics

- **`streaming-responses.ts`** — Real-time streaming with agents
  - Streaming text with incremental updates
  - Progress tracking during generation
  - Reasoning output streams
  - Multi-stage streaming workflows
  - Parallel agent streaming

- **`context-sessions.ts`** — Context management and conversation sessions
  - Multi-turn conversations with memory
  - Managing multiple concurrent sessions
  - Long-running conversation context
  - Context-aware agent collaboration
  - Session resumption and continuity

- **`guardrails-validation.ts`** — Safety guardrails and input validation
  - Input validation and filtering
  - Output validation for sensitive data
  - Rate limiting and abuse prevention
  - Content policy enforcement
  - Layered security guardrails

- **`real-world-code-refactor.ts`** — Production-ready refactoring pipeline
  - Multi-agent refactoring workflow
  - Code analysis and quality assessment
  - Automated refactoring with validation
  - Test generation and execution
  - Documentation generation
  - Batch file processing

## Running Examples

### Prerequisites

Build the SDK first:

```bash
cd sdk/native
npm install
npm run build
```

### Execute an Example

Using `tsx`:

```bash
# Basic examples
npx tsx examples/basic/streaming-deltas.ts
npx tsx examples/basic/review-example.ts

# Tool examples
npx tsx examples/tools/tool-override-example.ts
npx tsx examples/tools/automatic-tool-registration.ts

# Provider examples
npx tsx examples/provider/codex-provider-run.ts
npx tsx examples/provider/codex-provider-direct.ts

# Agent examples
npx tsx examples/agents/agents-integration.ts
npx tsx examples/agents/multi-agent-handoffs.ts
npx tsx examples/agents/structured-output.ts
npx tsx examples/agents/streaming-responses.ts
npx tsx examples/agents/context-sessions.ts
npx tsx examples/agents/guardrails-validation.ts
npx tsx examples/agents/real-world-code-refactor.ts
```

Using `node` (after building):

```bash
npm run build:ts
node dist-examples/examples/basic/streaming-deltas.js
```

## Example Categories by Feature

### Getting Started
1. `provider/codex-provider-run.ts` — Simplest example
2. `basic/streaming-deltas.ts` — Core streaming features
3. `tools/automatic-tool-registration.ts` — Working with tools
4. `agents/agents-integration.ts` — Basic agent usage

### OpenAI Agents SDK Features
- **Multi-Agent Workflows**: `agents/multi-agent-handoffs.ts`
- **Structured Output**: `agents/structured-output.ts`
- **Streaming**: `agents/streaming-responses.ts`
- **Context Management**: `agents/context-sessions.ts`
- **Safety & Validation**: `agents/guardrails-validation.ts`
- **Real-World Application**: `agents/real-world-code-refactor.ts`

### Advanced Features
- **Custom Tools**: `tools/automatic-tool-registration.ts`, `agents/agents-with-tools.ts`
- **Tool Override**: `tools/tool-override-example.ts`
- **Code Review**: `basic/review-example.ts`
- **Multi-Modal**: `basic/streaming-deltas.ts`, `provider/codex-provider-direct.ts`

### Integration Patterns
- **OpenAI Agents Framework**: All files in `/agents` and `/provider`
- **Direct SDK Usage**: Files in `/basic` and `/tools`
- **Production Workflows**: `agents/real-world-code-refactor.ts`

## Additional Resources

- **Main README**: `../README.md` — Full SDK documentation
- **Agents Guide**: `../AGENTS.md` — OpenAI Agents integration details
- **API Docs**: TypeScript definitions in `../dist/index.d.mts`

## Contributing

When adding new examples:

1. Place in the appropriate category directory
2. Include clear comments explaining key concepts
3. Use descriptive console output
4. Handle errors gracefully
5. Update this README with the new example

## Common Patterns

### Initialize Codex

```typescript
import { Codex } from "@codex-native/sdk";

const codex = new Codex({
  model: "gpt-5-codex",
  workingDirectory: process.cwd(),
});
```

### Stream Responses

```typescript
const thread = codex.startThread();
const result = await thread.runStreamed("Your prompt here");

for await (const event of result.events) {
  if (event.type === "item.completed") {
    console.log(event.item.text);
  }
}
```

### Register Custom Tools

```typescript
codex.registerTool({
  name: "my_tool",
  description: "What this tool does",
  parameters: { /* JSON schema */ },
  handler: async (args) => {
    // Tool implementation
    return JSON.stringify(result);
  },
});
```

### Use with OpenAI Agents

```typescript
import { CodexProvider } from "@codex-native/sdk";
import { Agent, Runner } from "@openai/agents";

const provider = new CodexProvider();
const agent = new Agent({
  name: "MyAgent",
  instructions: "Agent instructions",
});

const runner = new Runner({ modelProvider: provider });
const result = await runner.run(agent, "Task description");
```

## Support

For issues or questions:
- GitHub Issues: [codex-native/issues](https://github.com/ScriptedAlchemy/codex-native/issues)
- Documentation: Check the main README and AGENTS.md
