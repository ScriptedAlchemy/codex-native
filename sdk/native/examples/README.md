# Agent Graph Renderer Examples

This directory contains examples of how to use the `AgentGraphRenderer` to create live, git-graph style visualizations of multi-agent workflows.

## Examples

### 1. Basic Demo (`agent-graph-demo.ts`)

Shows a simulated merge conflict resolution workflow with:
- Coordinator spawning worker agents
- Real-time progress updates
- CI verification stage
- Git-graph style visualization

**Run it:**
```bash
npx tsx examples/agent-graph-demo.ts
```

### 2. Workflow Tracker (`agent-workflow-tracker.ts`)

Demonstrates integration into real agent workflows with:
- Sequential agent execution
- Progress tracking across multiple stages
- Error handling patterns
- Live status updates

**Run it:**
```bash
npx tsx examples/agent-workflow-tracker.ts
```

## Usage in Your Code

### Basic Setup

```typescript
import { AgentGraphRenderer } from "@codex-native/sdk";

// Create renderer instance
const graph = new AgentGraphRenderer();

// Add your root agent
graph.addAgent({
  id: "my-workflow-001",
  name: "My Workflow",
  state: "running",
  currentActivity: "Starting workflow",
  progress: "0/5 steps",
});

// Build and display the graph
graph.buildGraph();
console.log(graph.renderAscii());
```

### Streaming Updates

```typescript
// Update agent activity
graph.updateAgentActivity("my-workflow-001", "Processing step 1");

// Update progress
graph.updateAgentProgress("my-workflow-001", "1/5 steps");

// Track conversation turns
graph.incrementAgentTurns("my-workflow-001");

// Mark as completed
graph.updateAgentState("my-workflow-001", "completed");

// Refresh display
graph.buildGraph();
console.log(graph.renderAscii());
```

### Adding Child Agents

```typescript
// Add worker agent
graph.addAgent({
  id: "worker-002",
  name: "Data Processor",
  state: "running",
  parentId: "my-workflow-001",  // Links to parent
  currentActivity: "Processing data",
  progress: "0/100 items",
});

graph.buildGraph();
console.log(graph.renderAscii());
```

## Agent State Values

- `"running"` - Agent is actively working
- `"completed"` - Agent finished successfully
- `"failed"` - Agent encountered an error
- `"waiting"` - Agent is idle/awaiting input

## Integration Tips

1. **Initialize early**: Add agents to the graph when they start
2. **Update frequently**: Call `updateAgentActivity()` when tasks change
3. **Track progress**: Use `updateAgentProgress()` for quantifiable work
4. **Count turns**: Call `incrementAgentTurns()` after each conversation round
5. **Refresh display**: Call `buildGraph()` + `renderAscii()` to update the view
6. **Handle completion**: Update state to "completed" or "failed" when done

## Visual Features

- **Git-graph styling**: Uses Unicode box-drawing characters like `●│─└┌┐┘`
- **Branch connections**: Shows parent-child relationships visually
- **Live streaming**: Displays current activities and progress
- **Status indicators**: Visual state with emojis and colors
- **Turn tracking**: Shows conversation round counts
- **Timing info**: Displays when agents last updated

The visualization updates in real-time, giving you a `git log --graph` view of your agent workflows!