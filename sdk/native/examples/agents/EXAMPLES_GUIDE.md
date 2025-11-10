# OpenAI Agents SDK Examples Guide

This guide provides an overview of all the agent examples in this directory, demonstrating various features of the OpenAI Agents SDK integrated with the CodexProvider.

## Overview

These examples showcase production-ready patterns for building agentic AI applications using the OpenAI Agents SDK with Codex as the backend. Each example is self-contained and demonstrates specific features and patterns.

## Examples by Complexity

### Beginner

**1. agents-integration.ts** - Basic Agent Setup
- ✅ Single agent execution
- ✅ Basic conversational queries
- ✅ Understanding CodexProvider integration
- ✅ Getting started with the framework

**2. agents-with-tools.ts** - Custom Tools
- ✅ Defining tools with Zod schemas
- ✅ Tool execution patterns
- ✅ Understanding tool limitations with CodexProvider

### Intermediate

**3. structured-output.ts** - Type-Safe Responses
- ✅ JSON schema definitions
- ✅ Zod for schema validation
- ✅ Code analysis with structured results
- ✅ Test planning
- ✅ API documentation generation
- ✅ Performance analysis

**4. streaming-responses.ts** - Real-Time Feedback
- ✅ Streaming text deltas
- ✅ Progress tracking
- ✅ Reasoning output streams
- ✅ Multi-stage workflows
- ✅ Parallel agent streaming

**5. context-sessions.ts** - Conversation Management
- ✅ Multi-turn conversations
- ✅ Session management
- ✅ Context preservation
- ✅ Long-running conversations
- ✅ Multiple concurrent sessions

### Advanced

**6. multi-agent-handoffs.ts** - Agent Orchestration
- ✅ Specialized agents for different tasks
- ✅ Triage agent for routing
- ✅ Agent-to-agent handoffs
- ✅ Collaborative workflows
- ✅ Context sharing between agents

**7. guardrails-validation.ts** - Safety & Validation
- ✅ Input validation
- ✅ Output filtering
- ✅ Rate limiting
- ✅ Content policy enforcement
- ✅ Layered security patterns

### Production-Ready

**8. real-world-code-refactor.ts** - Complete Pipeline
- ✅ Multi-agent refactoring workflow
- ✅ Code quality analysis
- ✅ Automated refactoring
- ✅ Test generation
- ✅ Documentation generation
- ✅ Batch processing
- ✅ Error handling
- ✅ Production patterns

## Features Demonstrated

### Core Agent Features

| Feature | Examples |
|---------|----------|
| Basic agent execution | agents-integration.ts |
| Multi-agent workflows | multi-agent-handoffs.ts, real-world-code-refactor.ts |
| Agent specialization | multi-agent-handoffs.ts, real-world-code-refactor.ts |
| Agent handoffs | multi-agent-handoffs.ts |

### Data & I/O

| Feature | Examples |
|---------|----------|
| Structured output | structured-output.ts, real-world-code-refactor.ts |
| JSON schemas | structured-output.ts, real-world-code-refactor.ts |
| Streaming responses | streaming-responses.ts |
| Progress tracking | streaming-responses.ts |

### Context & Sessions

| Feature | Examples |
|---------|----------|
| Multi-turn conversations | context-sessions.ts |
| Session management | context-sessions.ts |
| Context preservation | context-sessions.ts, multi-agent-handoffs.ts |
| Conversation resumption | context-sessions.ts |

### Safety & Reliability

| Feature | Examples |
|---------|----------|
| Input validation | guardrails-validation.ts |
| Output validation | guardrails-validation.ts |
| Rate limiting | guardrails-validation.ts |
| Content filtering | guardrails-validation.ts |
| Error handling | All examples |

### Real-World Patterns

| Pattern | Example |
|---------|---------|
| Code analysis | structured-output.ts, real-world-code-refactor.ts |
| Code refactoring | real-world-code-refactor.ts |
| Test generation | real-world-code-refactor.ts |
| Documentation generation | real-world-code-refactor.ts |
| Batch processing | real-world-code-refactor.ts |

## Running the Examples

### Prerequisites

```bash
cd sdk/native
npm install
npm run build
```

### Run Individual Examples

```bash
# Basic examples
npx tsx examples/agents/agents-integration.ts
npx tsx examples/agents/agents-with-tools.ts

# Feature examples
npx tsx examples/agents/structured-output.ts
npx tsx examples/agents/streaming-responses.ts
npx tsx examples/agents/context-sessions.ts

# Advanced examples
npx tsx examples/agents/multi-agent-handoffs.ts
npx tsx examples/agents/guardrails-validation.ts

# Production example
npx tsx examples/agents/real-world-code-refactor.ts
```

## Learning Path

### Path 1: Quick Start (30 minutes)
1. `agents-integration.ts` - Understand basic setup
2. `structured-output.ts` - Learn type-safe responses
3. `streaming-responses.ts` - Add real-time feedback

### Path 2: Multi-Agent Systems (1 hour)
1. `agents-integration.ts` - Basic agents
2. `context-sessions.ts` - Learn conversation management
3. `multi-agent-handoffs.ts` - Agent orchestration
4. `real-world-code-refactor.ts` - Complete pipeline

### Path 3: Production Systems (1 hour)
1. `structured-output.ts` - Type-safe APIs
2. `guardrails-validation.ts` - Safety patterns
3. `real-world-code-refactor.ts` - Production workflow

## Key Concepts

### CodexProvider

All examples use `CodexProvider` which:
- Integrates Codex with OpenAI Agents SDK
- Provides full access to Codex capabilities
- Handles tool execution internally
- Manages conversation state automatically

```typescript
const codexProvider = new CodexProvider({
  defaultModel: 'gpt-5-codex',
  workingDirectory: tmpDir,
  skipGitRepoCheck: true,
});

const codexModel = await codexProvider.getModel();
```

### Agent Definition

Agents are defined with:
- **name**: Agent identifier
- **model**: The model to use (from CodexProvider)
- **instructions**: System prompt/guidelines
- Optionally configure structured output at call time via `outputType`

```typescript
const agent = new Agent({
  name: 'CodeAnalyzer',
  model: codexModel,
  instructions: 'You are an expert code analyzer...',
});
```

### Running Agents

Two main patterns:

**Buffered execution:**
```typescript
const result = await run(agent, userInput, {
  // Use OpenAI-style wrapper or a plain JSON schema object
  outputType: {
    type: 'json_schema',
    json_schema: { name: 'Analysis', strict: true, schema: AnalysisSchema }
  }
});
console.log(result.finalOutput);
```

**Streaming execution:**
```typescript
const streamResult = stream(agent, userInput);
for await (const event of streamResult) {
  // Process events
}
```

### Context Management

Continue conversations with `previousResponseId`:

```typescript
const turn1 = await run(agent, 'First question');
const turn2 = await run(agent, 'Follow-up', {
  previousResponseId: turn1.conversationId
});
```

## Common Patterns

### Pattern 1: Specialized Agents

Create agents for specific tasks:

```typescript
const analyzerAgent = new Agent({
  name: 'Analyzer',
  model: codexModel,
  instructions: 'Analyze code for issues...',
});

const refactorerAgent = new Agent({
  name: 'Refactorer',
  model: codexModel,
  instructions: 'Refactor code for quality...',
});
```

### Pattern 2: Structured Output

Use Zod schemas for type-safe output:

```typescript
const ResultSchema = z.object({
  success: z.boolean(),
  data: z.array(z.string()),
});

const agent = new Agent({ name: 'Processor', model: codexModel, instructions: '...' });

const result = await run(agent, input, {
  outputType: ResultSchema, // or the OpenAI-style wrapper shown above
});
const parsed = JSON.parse(result.finalOutput);
// parsed is now type-safe!
```

### Pattern 3: Agent Pipelines

Chain multiple agents:

```typescript
// Step 1: Analyze
const analysis = await run(analyzerAgent, code);

// Step 2: Refactor based on analysis
const refactored = await run(refactorerAgent, 
  `Refactor based on: ${analysis.finalOutput}`
);

// Step 3: Test
const tested = await run(testerAgent,
  `Test this refactoring: ${refactored.finalOutput}`
);
```

### Pattern 4: Guardrails

Layer validation checks:

```typescript
async function processWithGuardrails(input: string) {
  // 1. Validate input
  if (!validateInput(input)) return;
  
  // 2. Check rate limits
  if (!checkRateLimit(userId)) return;
  
  // 3. Run agent
  const result = await run(agent, input);
  
  // 4. Validate output
  if (!validateOutput(result.finalOutput)) return;
  
  return result;
}
```

## Best Practices

### 1. Agent Design
- ✅ Give agents specific, focused instructions
- ✅ Use specialized agents for different tasks
- ✅ Keep instructions concise and actionable
- ✅ Define clear agent responsibilities

### 2. Error Handling
- ✅ Wrap agent calls in try-catch blocks
- ✅ Validate inputs before processing
- ✅ Validate outputs before returning
- ✅ Handle edge cases gracefully

### 3. Performance
- ✅ Use streaming for long responses
- ✅ Run independent agents in parallel
- ✅ Reuse agent instances when possible
- ✅ Clean up resources (temp files, etc.)

### 4. Security
- ✅ Validate all user inputs
- ✅ Filter sensitive data from outputs
- ✅ Implement rate limiting
- ✅ Use content policies
- ✅ Layer multiple guardrails

### 5. Production Readiness
- ✅ Use structured output for reliability
- ✅ Implement comprehensive error handling
- ✅ Add logging and monitoring
- ✅ Test edge cases thoroughly
- ✅ Document agent behaviors

## Troubleshooting

### Common Issues

**Issue: Agent doesn't follow instructions**
- Solution: Make instructions more specific and actionable
- Example: See `multi-agent-handoffs.ts` for good instruction patterns

**Issue: Output format is inconsistent**
- Solution: Use `outputType` (plain JSON schema or json_schema wrapper). Zod schemas should be converted to JSON schema.
- Example: See `structured-output.ts`

**Issue: Context not preserved across turns**
- Solution: Pass `previousResponseId` to maintain conversation
- Example: See `context-sessions.ts`

**Issue: Agent takes too long to respond**
- Solution: Use streaming for real-time feedback
- Example: See `streaming-responses.ts`

**Issue: Unsafe or unexpected outputs**
- Solution: Implement guardrails and validation
- Example: See `guardrails-validation.ts`

## Further Resources

### Documentation
- [OpenAI Agents SDK Docs](https://openai.github.io/openai-agents-js/)
- [Codex Native SDK README](../../README.md)
- [Agents Integration Guide](../../AGENTS.md)

### Related Examples
- `/examples/basic/` - Core SDK features
- `/examples/tools/` - Custom tool patterns
- `/examples/provider/` - Provider integration

### Support
- [GitHub Issues](https://github.com/ScriptedAlchemy/codex-native/issues)
- [Contributing Guide](../../CONTRIBUTING.md)

## Contributing

When adding new examples:

1. **Choose the right complexity level**
   - Beginner: Single concept, minimal setup
   - Intermediate: Multiple features combined
   - Advanced: Complex workflows
   - Production: Complete, battle-tested patterns

2. **Follow the example template**
   - Comprehensive header comment
   - Installation instructions
   - Usage command
   - Clear section headers
   - Descriptive console output
   - Proper cleanup

3. **Document thoroughly**
   - Explain key concepts in comments
   - Show console output at each step
   - Handle errors gracefully
   - Provide working code that runs out-of-the-box

4. **Update this guide**
   - Add to the appropriate complexity section
   - Update feature matrices
   - Add to learning paths if applicable

## Summary

These examples provide a comprehensive introduction to building agentic AI applications with the OpenAI Agents SDK and CodexProvider. They cover everything from basic agent execution to production-ready multi-agent pipelines, with a focus on practical, real-world patterns.

Start with the beginner examples and work your way up to the production-ready patterns. Each example builds on concepts from previous ones, creating a complete learning path for agent development.

Happy building! 🚀

