# Codex Native SDK Examples

This directory contains example scripts demonstrating various features of the `@codex-native/sdk`.

## Directory Structure

### Root Level - Direct SDK Examples
Basic examples using the Native SDK directly (without OpenAI Agents framework).

- **`basic_streaming.ts`** — Direct SDK streaming
  - Real-time streaming without Agents framework
  - Handling stream events directly
  - Token usage tracking
  - Simple streaming patterns

- **`structured_output.ts`** — Direct SDK structured output
  - JSON schema validation with direct Thread API
  - Zod schema integration
  - Type-safe structured responses
  - Multiple schema examples (code analysis, task breakdown)

### `/embeddings` - FastEmbed Integration

- **`fast-embed.ts`** — Local embedding pipelines with caching
  - Initialize the FastEmbed runtime from Node.js
  - Defaults to the `BAAI/bge-large-en-v1.5` ONNX model bundle
  - Generates normalized sentence embeddings & stores them under `~/.codex/embeddings`
  - Perfect starting point for reverie re-ranking or custom RAG flows

### `/basic` - Core Features
Basic SDK functionality and common use cases.

- **`plan-management.ts`** — Programmatic plan/todo control
  - Replace the agent plan from code
  - Add, update, reorder, and remove todo items
  - Inspect plan updates returned from `thread.run`

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
 
- **`agents-fork-into-new-agent.ts`** — Fork thread and continue with another Agent
  - Fork underlying Codex thread to keep cache benefits
  - Run a different Agent on the fork with `conversationId`
  - Isolation from original path with shared context

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

- **`multi-agent-handoffs.ts`** — Advanced multi-agent handoffs
  - Complex agent delegation patterns
  - Orchestrating multi-step workflows
  - Context preservation across agents
  - Production-ready handoff patterns

- **`streaming-responses.ts`** — Streaming with real-time updates
  - Real-time streaming deltas
  - Processing incremental updates
  - Building responsive user experiences
  - Custom stream event processing

- **`structured-output.ts`** — Comprehensive structured output
  - Multiple JSON schema examples
  - Code analysis structured responses
  - Complex nested data structures
  - Task breakdown and planning schemas

- **`context-sessions.ts`** — Context management and sessions
  - Creating and resuming conversation sessions
  - Managing conversation history
  - Multi-turn conversations with memory
  - Context preservation across runs

- **`guardrails-validation.ts`** — Guardrails and validation
  - Input validation before execution
  - Output validation after execution
  - Content filtering and safety checks
  - Rate limiting and resource constraints

- **`real-world-code-refactor.ts`** — Production code refactoring pipeline
  - Building production-ready workflows
  - Multiple specialized agents (Analyzer, Refactorer, Tester, Documenter)
  - Structured data between agents
  - Error handling and validation
  - Practical integration patterns

### `/diagnostics` - Troubleshooting Utilities
Quick scripts to validate local environments.

- **`gh-network-check.ts`** — GitHub CLI connectivity probe
  - Ensures `gh` is available inside Codex runs
  - Confirms TLS trust store configuration by hitting `https://api.github.com`
  - Highlights command outputs and exit codes for fast debugging

### `/tui` - Terminal UI
Examples that interact with the Codex TUI, either programmatically through the SDK or by spawning the packaged CLI.

- **`programmatic-launch.ts`** — Launch the TUI directly from Node.js using `runTui`
  - Passes an initial prompt
  - Demonstrates launch options (sandbox/approval policies)
  - Prints exit information (conversation id, token usage)

- **`launch-cli.ts`** — Spawn the `codex-native tui` CLI from a script
  - Runs the CLI entry point with custom prompts
  - Inherits stdio so the TUI renders in the current terminal
  - Shows how to adjust environment variables for automation

- **`thread-transition.ts`** — Transition from programmatic to TUI mode
  - Start thread programmatically with automated work
  - Transition to interactive TUI mode
  - Continue same session in TUI
  - Seamless handoff between modes

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
npx tsx examples/tui/programmatic-launch.ts
```

## Example Categories by Feature

### Getting Started
1. `provider/codex-provider-run.ts` — Simplest example
2. `basic_streaming.ts` — Direct SDK streaming
3. `basic/streaming-deltas.ts` — Core streaming features with Agents
4. `tools/automatic-tool-registration.ts` — Working with tools

### Advanced Features
- **Multi-Agent**: `agents/agents-integration.ts`, `agents/agents-multi-agent-workflow.ts`, `agents/real-world-code-refactor.ts`
- **Agent Handoffs**: `agents/agents-handoffs.ts`, `agents/multi-agent-handoffs.ts`
- **Guardrails**: `agents/agents-guardrails.ts`, `agents/guardrails-validation.ts`
- **Structured Output**: `agents/agents-structured-output.ts`, `agents/structured-output.ts`, `structured_output.ts`
- **Streaming**: `agents/agents-streaming.ts`, `agents/streaming-responses.ts`, `basic_streaming.ts`
- **Context Management**: `agents/context-sessions.ts`
- **Tracing**: `agents/agents-tracing.ts`
- **Tool Override**: `tools/tool-override-example.ts`
- **Code Review**: `basic/review-example.ts`
- **Plan Management**: `basic/plan-management.ts`
- **TUI Integration**: `tui/thread-transition.ts`, `tui/programmatic-launch.ts`

### Integration Patterns
- **OpenAI Agents**: All files in `/agents` and `/provider`
- **Direct SDK Usage**: Root-level files (`basic_streaming.ts`, `structured_output.ts`), plus `/basic`, `/tools`, and `/tui`
- **TUI Mode**: All files in `/tui`, including programmatic-to-TUI transitions

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
