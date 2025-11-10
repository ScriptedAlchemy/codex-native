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
Advanced multi-agent workflows.

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

- **`agents-handoffs.ts`** — Agent handoffs and delegation
  - Delegating tasks between specialized agents
  - Maintaining conversation context across handoffs
  - Conditional handoffs based on task type
  - Multi-agent chains and workflows
  - Router pattern for task routing

- **`agents-guardrails.ts`** — Input validation and guardrails
  - Input validation guardrails
  - Content filtering guardrails
  - Security checks and dangerous command detection
  - Multiple guardrails combined
  - Early termination on guardrail failures

- **`agents-structured-output.ts`** — Structured output with JSON schemas
  - JSON schema validation
  - Simple and complex nested schemas
  - Zod schema integration
  - Type-safe structured responses
  - Array response schemas

- **`agents-streaming.ts`** — Real-time streaming responses
  - Real-time streaming deltas
  - Handling different stream event types
  - Token usage tracking
  - Progress indicators
  - Custom processing of stream events
  - Error handling in streaming

- **`agents-multi-agent-workflow.ts`** — Complex multi-agent workflows
  - Multiple specialized agents working together
  - Sequential workflows (ProductManager → Architect → Developer → Tester)
  - Parallel agent execution
  - Iterative refinement workflows
  - Context sharing between agents

- **`agents-tracing.ts`** — Tracing and debugging
  - Enabling tracing for agent workflows
  - Nested tracing for hierarchical workflows
  - Performance monitoring and token usage
  - Multi-agent workflow tracing
  - Error tracing and debugging

### `/diagnostics` - Troubleshooting Utilities
Quick scripts to validate local environments.

- **`gh-network-check.ts`** — GitHub CLI connectivity probe
  - Ensures `gh` is available inside Codex runs
  - Confirms TLS trust store configuration by hitting `https://api.github.com`
  - Highlights command outputs and exit codes for fast debugging

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
npx tsx examples/basic/streaming-deltas.ts
npx tsx examples/tools/tool-override-example.ts
npx tsx examples/agents/agents-integration.ts
```

## Example Categories by Feature

### Getting Started
1. `provider/codex-provider-run.ts` — Simplest example
2. `basic/streaming-deltas.ts` — Core streaming features
3. `tools/automatic-tool-registration.ts` — Working with tools

### Advanced Features
- **Multi-Agent**: `agents/agents-integration.ts`, `agents/agents-multi-agent-workflow.ts`
- **Agent Handoffs**: `agents/agents-handoffs.ts`
- **Guardrails**: `agents/agents-guardrails.ts`
- **Structured Output**: `agents/agents-structured-output.ts`
- **Streaming**: `agents/agents-streaming.ts`
- **Tracing**: `agents/agents-tracing.ts`
- **Tool Override**: `tools/tool-override-example.ts`
- **Code Review**: `basic/review-example.ts`

### Integration Patterns
- **OpenAI Agents**: All files in `/agents` and `/provider`
- **Direct SDK Usage**: Files in `/basic` and `/tools`

## Additional Resources

- **Main README**: `../README.md` — Full SDK documentation
- **Agents Guide**: `../AGENTS.md` — OpenAI Agents integration details
- **API Docs**: TypeScript definitions in `../dist/index.d.ts`

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
