# Smart Forking Research & Strategy

## Executive Summary

After researching codex-rs backend, SDK examples, and real CI workflows, **our current approach of forking from the last message (`nthUserMessage = 1`) after shared context is CORRECT**, but we need to be strategic about WHEN we fork.

## How Forking Works (Backend Analysis)

### Core Implementation (`codex-rs/core/src/conversation_manager.rs`)

```rust
fn truncate_before_nth_user_message(history: InitialHistory, n: usize) -> InitialHistory {
    // Keeps ALL rollout items BEFORE the nth user message
    // If n=0: Empty history (fork before first message)
    // If n=1: Keep first user message + assistant response
    // If n=2: Keep first 2 exchanges
}
```

**Key Insight**: `nthUserMessage` is 0-indexed and counts from the START, not the end.

- Cannot use negative indices
- `nthUserMessage: 0` = start fresh (no history)
- `nthUserMessage: 1` = keep first exchange
- `nthUserMessage: N` = keep first N exchanges

## What CI Fix Agents Actually Need

### Analyzed Real Tasks

From CI reports and examples:

1. **Codespell fixes** - Need: file paths, error pattern
2. **Type errors** - Need: affected files, type definitions context
3. **Lint failures** - Need: lint rules, file context
4. **Test failures** - Need: test file, related implementation
5. **Build errors** - Need: compilation errors, dependencies

### Essential Context for ALL Agents

✅ **Shared baseline** (established by coordinator):

- Repository structure (branch, status, diffstat)
- Recent commits (what changed recently)
- General codebase orientation
- List of current failures

✅ **Failure-specific** (added during specialization):

- Specific error message
- Path hints to affected files
- Reverie insights about that failure type
- Focus instruction

❌ **NOT needed** (bloat to avoid):

- Full 1MB CI report (only need summary)
- Entire conversation history
- Other agents' work-in-progress
- Detailed CI logs for other failures

## Fork Point Strategy Analysis

### Option 1: Fork from Beginning (nthUserMessage = 0)

```
❌ NO SHARED CONTEXT
├─ Each agent rebuilds understanding from scratch
├─ Redundant repo exploration
└─ Token waste: N agents × full discovery
```

### Option 2: Fork from Last Message (nthUserMessage = 1 after shared context)

```
✅ OPTIMAL BALANCE
├─ Coordinator: Establish shared context (15-20K tokens)
├─ Add failures summary (+2K tokens)
├─ Fork at this point (nthUserMessage = 1)
├─ Each fork inherits: 17-22K token baseline
└─ Add specialization per fork (+5-10K tokens each)

Total per agent: 22-32K starting point
Remaining budget: 240-250K tokens (plenty of room)
```

### Option 3: Fork from First 3 Messages (nthUserMessage = 3)

```
⚠️  POTENTIALLY TOO MUCH
├─ If coordinator has 3+ exchanges, might include:
│   ├─ Initial shared context ✅
│   ├─ Failures summary ✅
│   └─ Other coordination messages (may not be relevant) ⚠️
└─ Risk: Inheriting context meant for coordinator, not agents
```

## Recommended Strategy: Dynamic Fork Point

### Phase-Based Forking

```typescript
class CoordinatorPhases {
  INITIALIZATION = 0; // System setup, no content yet
  SHARED_CONTEXT = 1; // ← FORK POINT for fix agents
  FAILURES_IDENTIFIED = 2; // After CI run, before delegation
  ITERATION_REVIEW = 3; // After agents report back
}
```

### Implementation

```typescript
async initializeCoordinator(snapshot: RepoSnapshot) {
  // Phase 0: Initialize
  this.coordinatorThread = codex.startThread({...});

  // Phase 1: SHARED CONTEXT (this is our fork point)
  await this.coordinatorThread.run(`
    # Shared Context
    - Branch: ${snapshot.branch}
    - Status: ${snapshot.statusShort}
    - Recent commits: ${snapshot.recentCommits}
    - Diff stat: ${snapshot.diffStat}

    This context will be shared by all fix agents.
  `);

  // Mark: This is message 1 - our fork point!
  this.sharedContextMessageIndex = 1;
}

async dispatchFixAgents(failures: CiFailure[]) {
  // Phase 2: Add failures summary (message 2)
  await this.coordinatorThread.run(`
    Found ${failures.length} failures:
    ${failures.map(f => f.label).join('\n')}
  `);

  // Fork from message 1 (after shared context, before failures)
  for (const failure of failures) {
    const thread = await this.coordinatorThread.fork({
      nthUserMessage: this.sharedContextMessageIndex, // = 1
      threadOptions: {...}
    });

    // Add specialization
    await thread.run(`Your mission: fix ${failure.label}`);
  }
}
```

## Token Budgets (for gpt-5.1-codex with 272K limit)

### Scenario: 5 CI Failures

```
Coordinator Thread:
├─ Shared context:        15K tokens
├─ Failures summary:       2K tokens
├─ Iteration reviews:     10K tokens (across multiple iterations)
└─ Total:                 27K tokens ✅

Fix Agent (each):
├─ Inherited (fork at 1): 17K tokens
├─ Specialization:         5K tokens
├─ Investigation:         20K tokens (grep, read files)
├─ Fix execution:         15K tokens (edits, validations)
├─ Handoff:                3K tokens
└─ Total per agent:       60K tokens ✅

Total System Usage:
├─ Coordinator:           27K
├─ 5 × Fix agents:       300K (but parallel, separate contexts)
└─ Well within limits! ✅
```

## When to Fork Coordinator (Prevent Coordinator Bloat)

```typescript
// Monitor coordinator context
if (this.coordinatorTokenTracker.shouldHandoff()) {  // 85% full
  logWarn("Coordinator approaching limit - forking!");

  // Fork coordinator from recent meaningful exchange
  const newCoordinator = await this.coordinatorThread.fork({
    nthUserMessage: this.getLastMeaningfulExchangeIndex(),
    threadOptions: {...}
  });

  this.coordinatorThread = newCoordinator;
  this.coordinatorTokenTracker = new TokenTracker(model);
}
```

## Comparison: Our Approach vs Alternatives

| Approach                   | Shared Context | Token Efficiency       | Agent Effectiveness            |
| -------------------------- | -------------- | ---------------------- | ------------------------------ |
| **Fresh threads**          | ❌ None        | ⚠️ Redundant discovery | ⚠️ Each rebuilds understanding |
| **Fork from start (n=0)**  | ❌ None        | ❌ Same as fresh       | ❌ Same as fresh               |
| **Fork from shared (n=1)** | ✅ Yes         | ✅ Optimal             | ✅ Agents start informed       |
| **Fork from all history**  | ⚠️ Too much    | ❌ Context bloat       | ⚠️ Inherits irrelevant info    |

## Real-World Example: Fix Codespell Failure

### Without Smart Forking (Fresh Thread)

```
Agent starts: 0K tokens
1. Run `git status` to understand repo → 2K
2. Run `git log` to see recent changes → 3K
3. Run `git diff` to see what changed → 5K
4. Understand the failure → 1K
5. Fix the issue → 2K
Total: 13K tokens (8K wasted on discovery)
```

### With Smart Forking (Fork at Shared Context)

```
Agent inherits: 17K tokens (branch, commits, diffstat, failures overview)
1. Already knows repo state → 0K (cached!)
2. Already knows recent changes → 0K (cached!)
3. Specialize: codespell failure details → 1K
4. Fix the issue → 2K
Total: 20K tokens (but 17K is shared/cached baseline)
Net new: 3K tokens per agent
```

**Efficiency Gain**: 5 agents × 8K saved = 40K tokens saved!

## Recommendations

### ✅ DO

1. **Fork from shared context** (`nthUserMessage = 1`) after coordinator establishes baseline
2. **Track message indices** to know exactly where shared context ends
3. **Add specialization** after forking (failure-specific details + reveries)
4. **Monitor coordinator context** and fork coordinator itself when approaching limits
5. **Use handoffs** for validation and aggregation

### ❌ DON'T

1. **Don't fork from beginning** (n=0) - wastes context opportunity
2. **Don't fork from full history** - inherits irrelevant coordination messages
3. **Don't include full CI reports** - use summaries only
4. **Don't fork coordinator too early** - wait until 85% full
5. **Don't hard-code fork points** - track dynamically based on conversation state

## Conclusion

**Our current implementation is CORRECT**:

- Fork fix agents from `nthUserMessage = 1` after shared context
- This gives agents essential baseline WITHOUT bloat
- Leaves plenty of room for investigation and fixes
- Efficient use of token budget across parallel agents

**Key Insight**: The question isn't "how many messages to keep" but "WHERE in the conversation to fork from." We fork from the point AFTER shared context is established but BEFORE agent-specific work begins.

This is exactly what we implemented in commit `2d8284c40`.
