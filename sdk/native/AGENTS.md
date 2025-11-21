# Codex Native SDK Agent Guide

## Scope
- `sdk/native` exposes `CodexProvider`, letting the OpenAI Agents JS framework talk to the Rust runtime through N-API bindings.
- The workspace-built `.node` artifact is always preferred; optional platform packages (e.g., `@codex-native/sdk-darwin-arm64`) are only fallbacks when the local build is unavailable.

## Build & Test Loop
- Install toolchain deps first: `pnpm -C sdk/native install`.
- Build everything (Rust + TS) with `pnpm -C sdk/native run build`; this produces the platform-specific `.node` binary and TypeScript dist artifacts.
- Tests:
  - JavaScript: `pnpm -C sdk/native test`
  - Rust: `cargo test` from `sdk/native`
- Keep these commands in lockstep with changes because provider consumers rely on the generated bundle.

## Quick Start
```ts
import { CodexProvider } from '@openai/codex-native';
import { Agent, Runner } from '@openai/agents';

const provider = new CodexProvider({ defaultModel: 'gpt-5.1-codex' });
const agent = new Agent({ name: 'CodeAssistant', instructions: 'Fix the failing tests' });
const runner = new Runner({ modelProvider: provider });
const result = await runner.run(agent, 'Investigate the CI failure');
console.log(result.finalOutput);
```

## Provider Capabilities
- Full `ModelProvider` implementation: buffered (`getResponse`) and streamed (`getStreamedResponse`) calls, plus `getModel` lookups.
- Thread continuity: honors `conversationId` / `previousResponseId`, so repeated turns keep context automatically.
- Structured output: passes `outputType.schema` through to Codex, validates responses, and returns typed payloads.
- Tool execution happens inside Codex—bash, git, FS, and MCP tools don’t need extra framework wiring.
- Streaming mirrors Codex event names (`response_started`, `reasoning_done`, `response_done`) for real-time UX.

## Configuration Cheatsheet
`CodexProviderOptions` supports:
- `apiKey` – optional; only needed when your deployment requires explicit auth.
- `baseUrl` – override the Codex endpoint (default is the CLI-configured URL).
- `defaultModel` – fallback model name when none is provided per request.
- `workingDirectory` – where filesystem and git commands run.
- `skipGitRepoCheck` – bypass repo validation when using temp dirs or sandboxes.

Examples:
```ts
// Local iteration
new CodexProvider({
  workingDirectory: process.cwd(),
  skipGitRepoCheck: true,
  defaultModel: 'gpt-5.1-codex'
});

// Production deployment
new CodexProvider({
  baseUrl: 'https://api.codex.example.com',
  workingDirectory: '/app',
  defaultModel: 'gpt-5.1-codex'
  // apiKey: 'optional'
});
```

## CLI Pairing & Approvals
- The packaged CLI (`codex-native run …`, `codex-native tui`) reuses the same config files. Use it for quick smoke tests before embedding in Agents.
- For sensitive actions wire in approvals:
  - JS: `codex.setApprovalCallback((ctx) => boolean | Promise<boolean>)`
  - Tool interceptor: `registerToolInterceptor("__approval__", handler)`
  - Both feed a Rust-side interceptor that gates shell/file/Git activity.

## Architecture Snapshot
OpenAI Agents ➜ `CodexProvider` ➜ Codex SDK API ➜ N-API bindings ➜ `codex-rs`. Keep the provider thin—let the Rust core handle orchestration, tools, and persistence.
