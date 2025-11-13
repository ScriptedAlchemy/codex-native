# Multi-Agent Codex System V2 - Architecture & Improvements

## Overview

The Multi-Agent Codex System V2 is a comprehensive rewrite leveraging the full capabilities of the `@codex-native/sdk`. This version introduces structured data exchange, advanced thread management, native review integration, and production-ready agent orchestration.

## Key Improvements Over V1

### 1. **Structured Data Exchange**

- **Zod Schemas**: All agent communication uses validated schemas
- **Type Safety**: Full TypeScript types for all data structures
- **Validation**: Runtime validation prevents malformed data propagation
- **Schemas Defined**:
  - `IntentionSchema`: Developer intent analysis
  - `RiskSchema`: Risk assessment with likelihood/impact matrix
  - `RecommendationSchema`: Quality improvements with priorities
  - `CiIssueSchema`: CI/CD issue tracking
  - `ReviewAnalysisSchema`: Complete review output
  - `CiAnalysisSchema`: CI analysis results

### 2. **Native SDK Integration**

#### Thread Management

```typescript
// Thread forking for parallel analysis
const analysisThread = await thread.fork({
  nthUserMessage: 1,
  threadOptions: { model: "gpt-5-codex" },
});

// Background events for progress tracking
await thread.sendBackgroundEvent("📋 Starting comprehensive review...");
```

#### Native Review Capabilities

- Leverages `codex.review()` for git-aware code analysis
- Structured review output with confidence scores
- Automatic issue prioritization (P0-P3)

#### Tool Registration

```typescript
const gitDiffTool: NativeToolDefinition = {
  name: "git_diff_focused",
  description: "Get focused git diff",
  parameters: {
    /* schema */
  },
  handler: async (args) => {
    /* implementation */
  },
};
```

### 3. **Enhanced Agent Prompts**

Each agent now has comprehensive prompts following the pattern:

- **Role Definition**: Clear agent purpose
- **Task Breakdown**: Structured objectives
- **Schema Definition**: Expected output format
- **Guidelines**: Numbered best practices
- **Constraints**: Explicit boundaries

Example structure:

```
# Agent Name

You are [role description].

## Your Task
[Clear objective]

## Schema
[JSON schema definition]

## Guidelines
1. [Specific guideline]
2. [Specific guideline]

## Constraints
- [Boundary condition]
- [Quality requirement]
```

### 4. **Parallel Agent Execution**

```typescript
const runner = new Runner({
  modelProvider: provider,
  maxParallelRuns: 4, // Concurrent agent execution
});

// Parallel analysis
const [intentions, risks, recommendations] = await Promise.all([
  runner.run(intentionAgent, prompt, { outputSchema }),
  runner.run(riskAgent, prompt, { outputSchema }),
  runner.run(qualityAgent, prompt, { outputSchema }),
]);
```

### 5. **Approval & Sandbox Policies**

#### Approval Modes

- `on-request`: Prompt for sensitive operations
- `always`: Auto-approve all operations
- `never`: Deny all sensitive operations

#### Sandbox Modes

- `read-only`: No filesystem writes
- `workspace-write`: Write within working directory
- `danger-full-access`: Unrestricted access

### 6. **Reverie Integration**

Advanced conversation history search with:

- Native `reverieSearchConversations()` API
- Project-scoped filtering
- Insight extraction with `reverieGetConversationInsights()`
- Optional semantic re-ranking with embeddings
- Cosine similarity scoring for relevance

### 7. **CI/CD Analysis**

Specialized CI agents with focused responsibilities:

- **LintChecker**: Static analysis predictions
- **TestChecker**: Test failure prediction
- **BuildChecker**: Build & dependency issues
- **SecurityChecker**: Security vulnerability scanning
- **CIFixer**: Remediation plan generation

Each returns structured `CiIssueSchema` objects with:

- Tool identification
- Severity levels (Blocking/Warning/Info)
- Auto-fix commands
- Time estimates

### 8. **Progress Tracking & Observability**

#### Background Events

```typescript
await thread.sendBackgroundEvent("🔍 Analyzing CI configuration...");
```

#### Execution Tracing

```typescript
withTrace(runWorkflow, { name: "multi-agent-workflow" });
```

#### Structured Logging

- Review confidence scores
- Risk matrices
- Time estimates
- Token usage tracking

## Architecture

```
┌─────────────────────────────────────────┐
│         MultiAgentOrchestratorV2        │
│  - Workflow coordination                │
│  - Config management                    │
│  - Result aggregation                   │
└────────────┬────────────────────────────┘
             │
    ┌────────┴───────────────────────┐
    │                                 │
┌───▼──────────────┐    ┌────────────▼──────────┐
│ PRDeepReviewerV2 │    │  CICheckerSystemV2    │
│                  │    │                       │
│ - Native review  │    │ - Parallel CI checks  │
│ - Thread forking │    │ - Issue aggregation   │
│ - Multi-agent    │    │ - Remediation plans   │
│   analysis       │    │                       │
└───┬──────────────┘    └────────────┬──────────┘
    │                                 │
    │     ┌───────────────────┐      │
    └────►│  ReverieSystemV2  │◄─────┘
          │                   │
          │ - History search  │
          │ - Embedding rank  │
          │ - Insight extract │
          └───────────────────┘
```

## Usage Examples

### Basic Branch Review

```bash
npx tsx multi-agent-codex-system-v2.ts --review-branch --base-branch main
```

### CI Check with Auto-fix

```bash
npx tsx multi-agent-codex-system-v2.ts --ci-check --sandbox-mode workspace-write
```

### Full Pipeline with Interactive TUI

```bash
npx tsx multi-agent-codex-system-v2.ts \
  --review-branch \
  --ci-check \
  --interactive \
  --model gpt-5-codex \
  --approval-mode on-request
```

### With Reverie Search & Embeddings

```bash
npx tsx multi-agent-codex-system-v2.ts \
  --review-branch \
  --reverie "authentication refactor" \
  --embedder-backend hf \
  --embedder-model BAAI/bge-large-en-v1.5 \
  --embedder-arch bert \
  --interactive
```

### Production Configuration

```bash
npx tsx multi-agent-codex-system-v2.ts \
  --review-branch \
  --ci-check \
  --base-branch production \
  --approval-mode never \
  --sandbox-mode read-only \
  --enable-tracing \
  --max-parallel-agents 8
```

## Configuration Options

| Option                  | Description                 | Default         |
| ----------------------- | --------------------------- | --------------- |
| `--review-branch`       | Run automated branch review | false           |
| `--ci-check`            | Run CI prediction & fixes   | false           |
| `--reverie <query>`     | Search conversation history | none            |
| `--interactive`         | Launch interactive TUI      | false           |
| `--model <name>`        | Model to use                | gpt-5-codex     |
| `--base-branch <name>`  | Base branch for comparison  | main            |
| `--approval-mode`       | Approval policy             | on-request      |
| `--sandbox-mode`        | Filesystem access           | workspace-write |
| `--embedder-backend`    | Embedding backend           | none            |
| `--embedder-model`      | Embedding model ID          | none            |
| `--embedder-arch`       | Model architecture          | bert            |
| `--enable-tracing`      | Enable execution tracing    | false           |
| `--max-parallel-agents` | Max concurrent agents       | 3               |

## Output Formats

### Review Analysis Output

```json
{
  "intentions": [...],
  "risks": [...],
  "recommendations": [...],
  "summary": "Detailed review text",
  "overallConfidence": 0.85,
  "requiresCiCheck": true,
  "suggestedFollowUps": ["Task 1", "Task 2"]
}
```

### CI Analysis Output

```json
{
  "issues": [...],
  "autoFixableCount": 12,
  "estimatedTime": 45,
  "blockers": ["Critical issue 1"],
  "remediationPlan": "Detailed fix plan"
}
```

## Best Practices

### 1. Start with Read-Only

Begin with `--sandbox-mode read-only` for analysis before enabling writes.

### 2. Use Structured Output

Always request structured output from agents for reliable parsing.

### 3. Enable Tracing for Debug

Use `--enable-tracing` to understand agent decision flow.

### 4. Cache Embeddings

Embeddings are automatically cached in `~/.codex/embeddings/` for performance.

### 5. Parallel Execution

Increase `--max-parallel-agents` for faster analysis on powerful machines.

## Advanced Features

### Custom Tool Registration

```typescript
codex.registerTool({
  name: "custom_analyzer",
  description: "Analyze custom metrics",
  parameters: {
    /* JSON schema */
  },
  handler: async (args) => {
    // Custom implementation
    return JSON.stringify(result);
  },
});
```

### Tool Interception

```typescript
codex.registerToolInterceptor("bash", async ({ invocation, callBuiltin }) => {
  // Pre-process or validate
  if (invocation.args.command.includes("rm -rf")) {
    throw new Error("Dangerous command blocked");
  }
  // Call original implementation
  return callBuiltin(invocation);
});
```

### Thread Event Handling

```typescript
thread.onEvent((event) => {
  if (event.type === "item.completed") {
    console.log("Item completed:", event.item);
  }
});
```

## Performance Considerations

### Memory Usage

- Each agent maintains its own context
- Thread forking shares conversation cache
- Embeddings are memory-mapped when possible

### Token Optimization

- Use `DEFAULT_MINI_MODEL` for CI checks
- Structured output reduces token usage
- Parallel execution doesn't increase tokens

### Caching

- Reverie results cached for session
- Embeddings cached permanently
- Git operations cached per run

## Troubleshooting

### Issue: "Not inside trusted directory"

**Solution**: Use `--skip-git-repo-check` or ensure you're in a git repository.

### Issue: Embedding model fails to load

**Solution**: Check model compatibility or use a different backend:

```bash
--embedder-backend onnx --embedder-model <onnx-model>
```

### Issue: CI checks timeout

**Solution**: Increase timeout or reduce parallel agents:

```bash
--max-parallel-agents 2
```

### Issue: Approval prompts not appearing

**Solution**: Ensure TTY is available and `--approval-mode on-request` is set.

## Future Enhancements

1. **Incremental Review**: Only analyze changed files since last review
2. **CI History Learning**: Learn from past CI failures
3. **Custom Agent Plugins**: Dynamic agent loading system
4. **Review Templates**: Customizable review rubrics
5. **Metrics Dashboard**: Real-time analysis metrics
6. **Distributed Execution**: Multi-machine agent distribution

## Contributing

Contributions welcome! Key areas:

- Additional agent types
- More tool implementations
- Enhanced schemas
- Performance optimizations
- Documentation improvements

## License

MIT - See LICENSE file for details.
