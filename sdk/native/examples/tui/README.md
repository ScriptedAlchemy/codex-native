# Codex TUI Examples

This directory contains examples demonstrating how to use the Codex Terminal User Interface (TUI) with the Native SDK.

## Overview

The Codex TUI provides a full-screen interactive terminal chat experience, similar to the Rust `codex` CLI. The Native SDK exposes this functionality in three ways:

1. **Standalone CLI**: `codex-native tui "your prompt"`
2. **Programmatic Launch**: `await runTui({ prompt: "..." })`
3. **Thread Transition**: `await thread.tui()` - **NEW!**

## Examples

### 1. launch-cli.ts

Demonstrates launching the TUI via the CLI command.

```bash
pnpm tsx examples/tui/launch-cli.ts
```

This spawns the `codex-native tui` command as a child process, showing how to integrate the CLI into other Node.js applications.

### 2. programmatic-launch.ts

Demonstrates launching the TUI programmatically using the `runTui()` function.

```bash
pnpm tsx examples/tui/programmatic-launch.ts "Analyze this codebase"
```

This is useful when you want to launch a standalone TUI session from your code.

### 3. thread-transition.ts ⭐ **NEW**

Demonstrates the most powerful pattern: **transitioning from programmatic to interactive mode** within the same agent session.

```bash
pnpm tsx examples/tui/thread-transition.ts
```

**Workflow:**
1. Create a `Codex` instance and start a thread
2. Do automated work programmatically (e.g., `await thread.run("analyze code")`)
3. Call `await thread.tui()` to hand over to the interactive TUI
4. Continue chatting with the same agent interactively
5. The TUI resumes the existing session automatically

**Use Case:** Start with automation, then switch to interactive debugging or exploration when needed.

## Key Features

### Thread.tui() Method

```typescript
const codex = new Codex();
const thread = codex.startThread({
  sandboxMode: "workspace-write",
  approvalMode: "on-request",
});

// Do programmatic work
await thread.run("Initial automated task");

// Switch to interactive TUI - same session!
await thread.tui();
```

**Features:**
- Automatically resumes the existing thread session
- Inherits thread options (model, sandbox mode, approval mode, etc.)
- Supports overrides: `await thread.tui({ prompt: "Continue with...", sandboxMode: "read-only" })`
- Returns exit info with token usage and conversation ID

### Session Continuity

The `.tui()` method ensures seamless continuity:
- Same conversation history
- Same agent context
- Same working directory
- Same security settings

This allows you to build **hybrid workflows** that combine:
- Automated batch processing
- Interactive debugging
- Manual intervention when needed
- Exploratory analysis

## Requirements

- Interactive terminal (TTY)
- Node.js 18+
- Built native bindings (`pnpm run build`)

## Testing

Run the unit tests for the `.tui()` method:

```bash
pnpm test tests/thread-tui.test.ts
```

## Architecture Notes

The implementation:
1. **Thread class** (src/thread.ts) - Added `.tui()` method
2. **Native binding** - `runTui()` exposes Rust TUI functionality
3. **Session management** - Automatically passes `resumeSessionId` to native layer
4. **Option inheritance** - Thread options flow through to TUI configuration

The native Rust implementation handles:
- Full-screen terminal rendering (ratatui + crossterm)
- Interactive input/output
- Real-time streaming
- Tool execution visualization
- Approval prompts
