# Codex Native SDK

Embed the Codex agent in your Node.js workflows and apps with native performance.

The Native SDK provides Rust-powered bindings via [napi-rs](https://napi.rs/), giving you direct access to Codex functionality without spawning child processes. This enables custom tool registration, agent orchestration, and native performance optimizations.

## Installation

```bash
npm install @codex-native/sdk
```

Requires Node.js 18+.

## API Compatibility

The Native SDK provides **full API compatibility** with the [TypeScript SDK](../typescript/). All core functionality—threads, streaming, structured output, and basic operations—works identically across both SDKs. The Native SDK adds Rust-powered performance and custom tool registration while maintaining the same interface.

### Migration from TypeScript SDK

Simply replace the import:

```typescript
// Before (TypeScript SDK)
import { Codex } from "@openai/codex-sdk";

// After (Native SDK - same API!)
import { Codex } from "@codex-native/sdk";
```

All your existing code continues to work without changes.

## Quickstart

```typescript
import { Codex } from "@codex-native/sdk";

const codex = new Codex();
const thread = codex.startThread();
const turn = await thread.run("Diagnose the test failure and propose a fix");

console.log(turn.finalResponse);
console.log(turn.items);
```

Call `run()` repeatedly on the same `Thread` instance to continue that conversation.

```typescript
const nextTurn = await thread.run("Implement the fix");
```

### Streaming responses

`run()` buffers events until the turn finishes. To react to intermediate progress—tool calls, streaming responses, and file diffs—use `runStreamed()` instead, which returns an async generator of structured events.

```typescript
const { events } = await thread.runStreamed("Diagnose the test failure and propose a fix");

for await (const event of events) {
  switch (event.type) {
    case "item.completed":
      console.log("item", event.item);
      break;
    case "turn.completed":
      console.log("usage", event.usage);
      break;
  }
}
```

### Structured output

The Codex agent can produce a JSON response that conforms to a specified schema. The schema can be provided for each turn as a plain JSON object.

```typescript
const schema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    status: { type: "string", enum: ["ok", "action_required"] },
  },
  required: ["summary", "status"],
  additionalProperties: false,
} as const;

const turn = await thread.run("Summarize repository status", { outputSchema: schema });
console.log(turn.finalResponse);
```

You can also create a JSON schema from a [Zod schema](https://github.com/colinhacks/zod) using the [`zod-to-json-schema`](https://www.npmjs.com/package/zod-to-json-schema) package and setting the `target` to `"openAi"`.

```typescript
const schema = z.object({
  summary: z.string(),
  status: z.enum(["ok", "action_required"]),
});

const turn = await thread.run("Summarize repository status", {
  outputSchema: zodToJsonSchema(schema, { target: "openAi" }),
});
console.log(turn.finalResponse);
```

### Attaching images

Provide structured input entries when you need to include images alongside text. Text entries are concatenated into the final prompt while image entries are passed to Codex via the native bridge.

```typescript
const turn = await thread.run([
  { type: "text", text: "Describe these screenshots" },
  { type: "local_image", path: "./ui.png" },
  { type: "local_image", path: "./diagram.jpg" },
]);
```

### Resuming an existing thread

Threads are persisted in `~/.codex/sessions`. If you lose the in-memory `Thread` object, reconstruct it with `resumeThread()` and keep going.

```typescript
const savedThreadId = process.env.CODEX_THREAD_ID!;
const thread = codex.resumeThread(savedThreadId);
await thread.run("Implement the fix");
```

### Running code reviews

Invoke the native review workflow without crafting prompts manually. The SDK provides presets that mirror the `/review` slash command:

```typescript
const codex = new Codex();

// Review everything that is staged, unstaged, or untracked
const review = await codex.review({
  target: { type: "current_changes" },
});

for (const finding of review.items) {
  if (finding.type === "agent_message") {
    console.log(finding.text);
  }
}
```

Additional presets let you review against another branch or a specific commit:

```typescript
await codex.review({
  target: { type: "branch", baseBranch: "main" },
});

await codex.review({
  target: {
    type: "commit",
    sha: "abc1234def5678",
    subject: "Tighten input validation",
  },
});
```

For bespoke instructions, pass a custom prompt and optional hint:

```typescript
await codex.review({
  target: {
    type: "custom",
    prompt: "Review only the data-access layer for regression risks.",
    hint: "data-access layer",
  },
});
```

### Working directory controls

Codex runs in the current working directory by default. To avoid unrecoverable errors, Codex requires the working directory to be a Git repository. You can skip the Git repository check by passing the `skipGitRepoCheck` option when creating a thread.

```typescript
const thread = codex.startThread({
  workingDirectory: "/path/to/project",
  skipGitRepoCheck: true,
});
```

## Native-Specific Features

The Native SDK provides additional capabilities beyond the TypeScript SDK:

### Custom Tool Registration

Register JavaScript functions as tools that Codex can discover and invoke during execution. Tools are registered globally on the `Codex` instance and become available to all threads and agents.

> **Override built-ins:** If you register a tool whose `name` matches one of Codex's built-in tools (for example `read_file`, `local_shell`, or `apply_patch`), the native implementation is replaced for the lifetime of that `Codex` instance. This lets you customize or disable default behaviors while keeping the same tool interface.

#### Built-in tool override cheat sheet

All snippets assume you already created an instance with `const codex = new Codex();`. Registering any of these names swaps out Codex's default implementation.

- `shell` – sandboxed shell command runner (models without unified exec)
  ```typescript
  codex.registerTool({
    name: "shell",
    handler: () => ({ error: "Shell disabled by policy", success: false }),
  });
  ```

- `exec_command` – streaming command execution (available when unified exec is enabled)
  ```typescript
  codex.registerTool({
    name: "exec_command",
    handler: (_, invocation) => ({
      output: `Pretend ran: ${invocation.arguments}`,
      success: true,
    }),
  });
  ```

- `write_stdin` – feeds additional input into an in-flight `exec_command`
  ```typescript
  codex.registerTool({
    name: "write_stdin",
    handler: () => ({ output: "stdin blocked", success: false }),
  });
  ```

- `local_shell` – simplified shell command helper (models that prefer local shell over unified exec)
  ```typescript
  codex.registerTool({
    name: "local_shell",
    handler: () => ({ output: "local shell override", success: true }),
  });
  ```

- `list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource` – MCP discovery helpers
  ```typescript
  for (const name of [
    "list_mcp_resources",
    "list_mcp_resource_templates",
    "read_mcp_resource",
  ]) {
    codex.registerTool({
      name,
      handler: () => ({ output: JSON.stringify({ notice: `${name} overridden` }) }),
    });
  }
  ```

- `update_plan` – emits high-level plan updates back to the host UI
  ```typescript
  codex.registerTool({
    name: "update_plan",
    handler: () => ({ output: "Plan updates disabled" }),
  });
  ```

- `apply_patch` – applies patches authored by the agent
  ```typescript
  codex.registerTool({
    name: "apply_patch",
    handler: (_, { arguments }) => ({
      output: `Custom patch handler received: ${arguments}`,
      success: true,
    }),
  });
  ```

- `web_search` – performs outbound web searches (only on models with the feature enabled)
  ```typescript
  codex.registerTool({
    name: "web_search",
    handler: (_, { arguments }) => ({
      output: `Search stub: ${arguments}`,
      success: true,
    }),
  });
  ```

- `view_image` – attaches a local image for the model to inspect
  ```typescript
  codex.registerTool({
    name: "view_image",
    handler: (_, { arguments }) => ({
      output: `Ignoring image path ${arguments}`,
      success: true,
    }),
  });
  ```

- `grep_files`, `read_file`, `list_dir` – workspace inspection helpers (enabled via experimental flags)
  ```typescript
  for (const name of ["grep_files", "read_file", "list_dir"]) {
    codex.registerTool({
      name,
      handler: (_, { arguments }) => ({
        output: JSON.stringify({ name, arguments, overridden: true }),
        success: true,
      }),
    });
  }
  ```

- `test_sync_tool` – synchronization helper used in concurrency tests
  ```typescript
  codex.registerTool({
    name: "test_sync_tool",
    handler: () => ({ output: "Barrier skipped" }),
  });
  ```

- MCP server tools – any name of the form `server::tool`
  ```typescript
  codex.registerTool({
    name: "jira::create_issue",
    handler: (_, { arguments }) => ({
      output: `Custom Jira integration received ${arguments}`,
      success: true,
    }),
  });
  ```

```typescript
const codex = new Codex();

codex.registerTool({
  name: "calculator",
  description: "Performs arithmetic operations",
  parameters: {
    type: "object",
    properties: {
      operation: { type: "string", enum: ["add", "subtract", "multiply", "divide"] },
      a: { type: "number" },
      b: { type: "number" },
    },
    required: ["operation", "a", "b"],
  },
  handler: (err, invocation) => {
    if (err) {
      return { error: err.message };
    }

    const { operation, a, b } = JSON.parse(invocation.arguments);
    let result: number;

    switch (operation) {
      case "add": result = a + b; break;
      case "subtract": result = a - b; break;
      case "multiply": result = a * b; break;
      case "divide": result = a / b; break;
    }

    return {
      output: `Result: ${result}`,
      success: true
    };
  },
});

const thread = codex.startThread();
await thread.run("Calculate 42 times 17");
```

**Tool Handler Signature:**

Handlers use Node.js error-first callback convention:
- `err`: Error object if invocation failed, `null` otherwise
- `invocation`: Object containing:
  - `callId`: Unique identifier for this tool call
  - `toolName`: Name of the tool being invoked
  - `arguments`: JSON string of the tool arguments (if `parameters` provided)
  - `input`: JSON string of the tool input (for custom tools)

**Return Value:**

Return an object with:
- `output`: String output to send back to the model
- `success` (optional): Boolean indicating success/failure
- `error` (optional): Error message if the tool execution failed

### Tool Interceptors

For more advanced use cases, register **tool interceptors** that can wrap built-in Codex tools with pre/post-processing logic while still executing the original implementation.

```typescript
const codex = new Codex();

// Intercept exec_command calls to add custom timeout and logging
codex.registerToolInterceptor("exec_command", async (invocation) => {
  // Pre-processing: modify the arguments
  const args = JSON.parse(invocation.arguments ?? "{}");
  const enhancedArgs = {
    ...args,
    timeout_ms: args.timeout_ms ?? 10000, // Default 10s timeout
    justification: args.justification ?? "intercepted",
  };

  // For now, interceptors return a placeholder response
  // Future versions will support calling the builtin implementation
  return {
    output: `[INTERCEPTED] Would execute: ${JSON.stringify(enhancedArgs)}`,
    success: true,
  };
});

// Intercept apply_patch to add validation
codex.registerToolInterceptor("apply_patch", async (invocation) => {
  const args = JSON.parse(invocation.arguments ?? "{}");

  // Add custom validation or preprocessing
  if (!args.patch_content?.includes("diff")) {
    return {
      output: "Invalid patch format - must contain diff data",
      success: false,
    };
  }

  // Return modified result
  return {
    output: `[VALIDATED] ${args.patch_content}`,
    success: true,
  };
});
```

**Key Differences from Tool Overrides:**

- **Interceptors wrap** built-in tools instead of replacing them entirely
- **Preserve sandboxing** - interceptors cannot bypass Codex's security policies
- **Chainable** - multiple interceptors can be registered for the same tool
- **Future enhancement** - interceptors will be able to call the underlying builtin implementation

**Current Notes:**

- Tool interceptors support decorating responses by calling `context.callBuiltin()`
- Multiple interceptors per tool will be composed in registration order in a future release

### Agent Orchestration

Create specialized agents with custom system prompts and tools for multi-agent workflows.

```typescript
const codex = new Codex();

// Register tools available to agents
codex.registerTool({
  name: "search_codebase",
  description: "Search the codebase for specific patterns",
  parameters: { /* ... */ },
  handler: (err, inv) => {
    // Search implementation
    return { output: "Found 5 matches", success: true };
  },
});

// Create a specialized agent
const reviewAgent = codex.createAgent({
  name: "code_reviewer",
  instructions: "You are a senior code reviewer. Focus on security, performance, and maintainability.",
});

const result = await reviewAgent.run("Review the authentication module");
console.log(result.finalResponse);
```

### Agent Handoffs

Agents can hand off tasks to other agents for specialized processing.

```typescript
const codex = new Codex();

const testAgent = codex.createAgent({
  name: "test_writer",
  instructions: "You write comprehensive unit tests with high coverage.",
});

const securityAgent = codex.createAgent({
  name: "security_auditor",
  instructions: "You perform security audits and identify vulnerabilities.",
});

// Start with test agent
const testResult = await testAgent.run("Write tests for the auth module");

// Hand off to security agent
const securityResult = await securityAgent.run(
  "Review the tests from the previous agent and add security-focused test cases"
);
```

Agents automatically have access to the conversation history, enabling seamless handoffs between specialized agents.

## API Options

### Codex Constructor Options

```typescript
interface CodexOptions {
  apiKey?: string;              // Responses API key (defaults to OPENAI_API_KEY env var)
  baseUrl?: string;             // API base URL override
  skipGitRepoCheck?: boolean;   // Skip Git repository validation
}
```

### Thread Options

```typescript
interface ThreadOptions {
  model?: string;               // Model to use (e.g., "gpt-5-codex")
  sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
  approvalMode?: "never" | "on-request" | "on-failure" | "untrusted";
  workspaceWriteOptions?: {
    networkAccess?: boolean;    // Enable network in workspace-write mode (default: false)
    writableRoots?: string[];   // Additional writable directories
    excludeTmpdirEnvVar?: boolean; // Exclude TMPDIR from writable roots
    excludeSlashTmp?: boolean;  // Exclude /tmp from writable roots (Unix only)
  };
  workingDirectory?: string;    // Directory to run Codex in
  skipGitRepoCheck?: boolean;   // Skip Git repository validation
  fullAuto?: boolean;           // @deprecated Use sandboxMode and approvalMode
}
```

#### Sandbox Modes

- **`read-only`**: AI can only read files, must approve all edits
- **`workspace-write`**: AI can edit workspace files freely (with optional network)
- **`danger-full-access`**: No sandbox (dangerous!)

#### Approval Policies

- **`never`**: Never ask for approval (commands execute automatically)
- **`on-request`**: Model decides when to ask (default)
- **`on-failure`**: Auto-approve but escalate on failure
- **`untrusted`**: Only trusted commands auto-approved

#### Network Access Configuration

Enable network access in `workspace-write` mode:

```typescript
const thread = codex.startThread({
  sandboxMode: "workspace-write",
  workspaceWriteOptions: {
    networkAccess: true
  }
});
```

#### Advanced Sandbox Configuration

Configure additional writable directories:

```typescript
const thread = codex.startThread({
  sandboxMode: "workspace-write",
  workspaceWriteOptions: {
    writableRoots: ["/path/to/additional/dir"],
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false
  }
});
```

### Turn Options

```typescript
interface TurnOptions {
  outputSchema?: JsonValue;     // JSON schema for structured output
}
```

### Tool Registration Options

```typescript
interface ToolRegistration {
  name: string;                 // Tool name (used by model to invoke)
  description?: string;         // Description of what the tool does
  parameters?: JsonValue;       // JSON Schema for tool parameters
  strict?: boolean;             // Enable strict schema validation
  supportsParallel?: boolean;   // Whether tool supports parallel execution
  handler: (err: Error | null, invocation: ToolInvocation) => ToolResponse;
}
```

## Architecture

The Native SDK uses [napi-rs](https://napi.rs/) to bridge JavaScript and Rust:

- **Native Bindings**: Direct Rust FFI via NAPI for zero-copy performance
- **Tool Registration**: JavaScript functions are stored as ThreadsafeFunction callbacks
- **Event Streaming**: Async generators powered by Tokio runtime
- **Session Management**: Native threads and agents run in the Rust codex-core

Platform-specific binaries are automatically selected at runtime:
- macOS: `codex_native.darwin-{arm64,x64}.node`
- Windows: `codex_native.win32-{x64,arm64,ia32}-msvc.node`
- Linux: `codex_native.linux-{x64,arm64}-{gnu,musl}.node`

## Development

Build from source:

```bash
pnpm install
pnpm --filter @codex-native/sdk run build
```

Run tests:

```bash
pnpm --filter @codex-native/sdk test
```

The build emits:
- Platform-specific `.node` binaries (native addons)
- TypeScript declarations in `index.d.ts`
- ESM wrapper in `dist/index.mjs`

## Publishing

The Native SDK uses napi-rs's multi-platform publishing strategy with automated release scripts.

### Release Scripts

```bash
# Patch release (0.0.x)
pnpm run release:patch

# Minor release (0.x.0)
pnpm run release:minor

# Major release (x.0.0)
pnpm run release:major

# Dry run (test without publishing)
pnpm run release:dry
```

### What Happens During Release

1. **Version bump**: Updates version in package.json and all platform packages
2. **Build**: Compiles native binary + TypeScript wrapper
3. **Test**: Runs full test suite (34 tests)
4. **Prepublish**: Copies binaries to platform packages via `prepublishOnly` hook
5. **Publish**: Publishes 9 packages to npm:
   - Main: `@codex-native/sdk`
   - Platforms: `@codex-native/{darwin-arm64,darwin-x64,linux-x64-gnu,linux-arm64-gnu,linux-x64-musl,linux-arm64-musl,win32-x64-msvc,win32-arm64-msvc}`

### Multi-Platform CI/CD

For full cross-platform support, build on CI for all 8 targets:

```yaml
# .github/workflows/release.yml
strategy:
  matrix:
    settings:
      - host: macos-latest
        target: aarch64-apple-darwin
      - host: macos-latest
        target: x86_64-apple-darwin
      - host: ubuntu-latest
        target: x86_64-unknown-linux-gnu
      - host: ubuntu-latest
        target: aarch64-unknown-linux-gnu
      # ... other platforms
```

After building all platforms:
```bash
pnpm run artifacts  # Download and organize binaries
pnpm run release    # Publish all packages
```

npm automatically installs the correct platform package as an optional dependency.

## License

See [LICENSE](../../LICENSE)
