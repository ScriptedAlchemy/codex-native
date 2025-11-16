# Agent Approval Patterns for Claude Code

This document explains how to control permissions when one agent delegates work to Claude Code in headless mode.

## The Problem

When Claude Code runs in headless mode and needs to:
- Execute shell commands
- Write/modify files
- Access network resources

...you need to configure permission policies to avoid interactive prompts that would hang in agent-to-agent scenarios.

## Solutions

### 1. **Permission Modes** (Recommended)

Use CLI flags to configure permission policies:

```bash
claude -p "task" \
  --permission-mode acceptEdits \
  --allowedTools "Bash,Read,Write"
```

**Permission Modes:**
- `default` - Interactive approval (hangs in headless!)
- `acceptEdits` - Auto-approve file edits, ask for commands
- `bypassPermissions` - Auto-approve everything (dangerous!)
- `plan` - Planning mode with structured output

**Tool Control:**
- `--allowedTools "Bash,Read"` - Whitelist specific tools
- `--allowedTools "Bash(git:*,npm:*)"` - Allow specific commands
- `--disallowedTools "WebSearch"` - Blacklist tools
- `--tools ""` - Disable all tools
- `--dangerously-skip-permissions` - Bypass all checks

**Use when:**
- Worker agent is trusted
- Task scope is well-defined
- Security policy is static (no dynamic decisions)

**Example:** See `agent-claude-worker.ts`

**Pros:**
✅ Simple to configure
✅ No custom code needed
✅ Works with all Claude CLI modes

**Cons:**
❌ No dynamic approval decisions
❌ Can't approve/deny based on runtime context
❌ All-or-nothing per tool type

---

### 2. **Streaming JSON I/O** (Monitoring Only)

Use bidirectional streaming to monitor Claude's actions in real-time:

```bash
claude -p \
  --output-format stream-json \
  --input-format stream-json \
  --permission-mode acceptEdits
```

**How it works:**
1. Manager sends task via stdin (JSONL format)
2. Claude streams events via stdout (JSONL format)
3. Manager monitors tool use events to see what actions Claude is taking
4. Permissions are still controlled via `--permission-mode` and `--allowedTools`

**Note:** Interactive approval callbacks (approval_request/approval_response) are not currently supported in streaming mode. Use permission modes instead.

**Message format:**

```typescript
// Manager sends task
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [{ "type": "text", "text": "Run npm install" }]
  }
}

// Claude requests approval
{
  "type": "approval_request",
  "request": {
    "type": "command_execution",
    "details": { "command": "npm install" }
  }
}

// Manager responds
{
  "type": "approval_response",
  "approved": true
}
```

**Use when:**
- Need fine-grained approval control
- Manager has complex approval logic
- Want to track all actions Claude takes

**Example:** See `agent-approval-handler.ts`

---

### 3. **MCP Approval Tool** (Dynamic Approval)

Provide an MCP server with an "approve" tool that Claude calls:

```bash
# Start MCP approval server
tsx examples/mcp-approval-tool.ts

# Run Claude with the approval tool
claude -p "task" \
  --permission-prompt-tool mcp__manager__approve \
  --mcp-config approval-server.json
```

**How it works:**
1. Manager runs an MCP server with an `approve` tool
2. Claude is configured to call this tool when it needs permission
3. Manager's tool reviews the request and returns approval/denial
4. Claude proceeds based on the response

**MCP config (approval-server.json):**
```json
{
  "mcpServers": {
    "manager": {
      "command": "tsx",
      "args": ["examples/mcp-approval-tool.ts"]
    }
  }
}
```

**Use when:**
- Want clean separation of concerns
- Manager is already using MCP
- Need reusable approval logic across multiple workers

**Example:** See `mcp-approval-tool.ts`

---

## Comparison Matrix

| Feature | Auto-Approval | Streaming I/O | MCP Tool |
|---------|--------------|---------------|----------|
| **Setup Complexity** | ⭐ Simple | ⭐⭐⭐ Complex | ⭐⭐ Moderate |
| **Fine-Grained Control** | ❌ No | ✅ Yes | ✅ Yes |
| **Bidirectional Comm** | ❌ No | ✅ Yes | ✅ Yes |
| **Reusable** | ❌ No | ⚠️ Partial | ✅ Yes |
| **Best For** | Simple tasks | Custom logic | Production use |

---

## Implementation Examples

### Example 1: Manager Approves Safe Commands Only

```typescript
import { ManagerAgent } from './agent-approval-handler';

const manager = new ManagerAgent();

// Manager policy: approve npm/git, deny rm/sudo
await manager.delegateWithApproval("Install dependencies and run tests");
// ✅ npm install - APPROVED
// ✅ npm test - APPROVED
// ❌ rm -rf node_modules - DENIED
```

### Example 2: Manager with Risk Scoring

```typescript
class RiskAwareManager extends ManagerAgent {
  async reviewApprovalRequest(request: ApprovalRequest): Promise<boolean> {
    const riskScore = this.calculateRisk(request);

    if (riskScore < 0.3) return true;  // Auto-approve low risk
    if (riskScore > 0.7) return false; // Auto-deny high risk

    // Medium risk: ask human
    return await this.askHumanApproval(request);
  }
}
```

### Example 3: Audit Trail

```typescript
class AuditingManager extends ManagerAgent {
  private approvals: ApprovalLog[] = [];

  async reviewApprovalRequest(request: ApprovalRequest): Promise<boolean> {
    const decision = await super.reviewApprovalRequest(request);

    // Log all approval decisions
    this.approvals.push({
      timestamp: new Date(),
      request,
      decision,
      reason: this.lastReason
    });

    return decision;
  }
}
```

---

## Security Considerations

1. **Default Deny**: Always deny unknown actions by default
2. **Whitelist Over Blacklist**: Explicitly list allowed actions, don't just block dangerous ones
3. **Audit Logging**: Log all approval requests and decisions
4. **Resource Limits**: Set timeouts and rate limits for worker agents
5. **Sandboxing**: Use `--sandbox` flags to limit worker's capabilities

---

## Testing

See `tests/claude-cli-integration.test.ts` for examples of testing headless mode with different approval configurations.

---

## Further Reading

- [Claude Code Headless Mode Docs](https://code.claude.com/docs/en/headless-mode)
- [MCP Tool Specification](https://modelcontextprotocol.io/docs)
- [Agent Handoff Patterns](./agent-claude-worker.ts)
