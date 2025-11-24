# Autonomous v2 (Codex Native) — Design & Implementation Plan

This document describes a ground‑up redesign of the `packages/autonomous` package to use the **Codex Native JS API** (`@codex-native/sdk`) directly, without relying on the MCP server or CLI wrappers.

The goals are:
- Replace the legacy `@openai/codex-sdk` + MCP configuration with a **pure in‑process native SDK**.
- Keep the **three modes** (research, screener, trader) but simplify their plumbing.
- Register **only the minimal tools each mode needs**, backed by the existing `bot` library.
- Improve **error handling, telemetry, and testability**.

---

## 1. Current State (High-Level)

- `@openai/codex-sdk` is imported directly in:
  - `screener.ts` / `screener-pipeline.ts`
  - `portfolio-research.ts`
  - `trader.ts`
- MCP is **implicitly required**:
  - `config.ts` writes `~/.codex/config.toml` and injects a `hoodwink` MCP server pointing to `packages/mcp/dist/index.js`.
  - Prompts (e.g. in `screener-pipeline.ts` and `screener.ts`) explicitly tell the agent to use MCP tools (`hoodwink.*`).
  - Event handling stores `mcp_tool_call` items and `web_search` items on artifacts and screener results.
- `.env` handling (`env.ts`) normalizes `TOKEN` and prints debug info from `portfolio-research.ts`.
- Telemetry is file-based via `telemetry.ts`, controlled by `runtime-config.ts`.
- Thread reuse:
  - `ThreadStore` persists thread ids per role/symbol (e.g. screener, trader).
  - `trader.ts` and `screener.ts` optionally resume previous threads.
- Screener → Research pipeline:
  - `runScreener` produces `ScreenerCandidate[]` with JSON structured output.
  - `enrichCandidatesWithResearch` (in `screener-pipeline.ts`) runs a mini research pipeline per candidate via Codex.

Pain points:
- Requires MCP server configuration and background process even when only Bot data is needed.
- Agents think in terms of MCP tool calls (server/tool names) instead of direct registered tools.
- Event and citation code is tied to `mcp_tool_call` items.

---

## 2. Target Architecture (Autonomous v2)

We introduce clear layering and move all Codex‑specific concerns into thin, well‑typed modules.

### 2.1. Core Modules

- `codex.ts`
  - Exports:
    - `createCodex(options?: CodexOptions): Codex`
    - `createThreadOptions(kind: "screener" | "research" | "trader", overrides?: ThreadOptions): ThreadOptions`
  - Responsibilities:
    - Construct a `Codex` from `@codex-native/sdk` with:
      - `skipGitRepoCheck: true`
      - Optional `baseUrl`/`apiKey` overrides (for custom environments)
    - For each `kind`, define sensible default `ThreadOptions`:
      - Screener: `workingDirectory = <repoRoot>/content`, `sandboxMode = "workspace-write"`, `approvalMode = "on-request"`.
      - Research: same `workingDirectory`, maybe lower sampling temperature.
      - Trader: same as research but with more cautious settings (no full‑auto).

- `tools.ts`
  - Exports:
    - `registerCoreTools(codex: Codex, bot: Bot): Promise<void>`
    - `registerTradingTools(codex: Codex, bot: Bot, opts: { liveTrading: boolean }): Promise<void>`
  - Responsibilities:
    - Register all Bot‑backed tools as **native Codex tools** using `codex.registerTool`.
    - Hide Bot complexity behind small, JSON‑shaped parameters and outputs.

- `agents/`
  - `agents/screener-agent.ts`: encapsulates all screener‑specific Codex calls.
  - `agents/research-agent.ts`: encapsulates research roles and prompts.
  - `agents/trader-agent.ts`: encapsulates trader prompts and result parsing.

- `workflows/`
  - `workflows/screener-workflow.ts` → `runScreener(...)`.
  - `workflows/portfolio-research-workflow.ts` → `runPortfolioResearch(...)`.
  - `workflows/trader-workflow.ts` → `runTraderWorkflow(...)`.
  - Each workflow:
    - Creates `Bot` + `Codex`.
    - Registers tools appropriate to the mode.
    - Constructs threads and agents.
    - Returns structured result objects (no direct printing).

- `config.ts` (lightweight)
  - No more MCP TOML writing.
  - Provides:
    - `loadAutonomousEnv()` → loads `.env` as today and validates `TOKEN`.
    - `resolveAutonomousConfig()` → merges runtime config + env flags like:
      - `AUTONOMOUS_STOCK_ONLY`
      - `AUTONOMOUS_TRADER_OPTIONS_MODE`
      - `TRADER_LIVE`
      - `SCREENER_MAX_CANDIDATES`

### 2.2. CLI

- `src/cli/hoodwink.ts`:
  - Continues to parse `mode` (research/screen/trade).
  - Calls into the new workflow modules.
  - Responsible only for:
    - Progress printing (prompts, short summaries).
    - Formatting output to stdout; no business logic.

---

## 3. Tool Registry Design (`tools.ts`)

We replace MCP tools with native tools registered via `codex.registerTool`. Each tool:
- Has a **stable name** (no server prefix).
- Declares a **JSON Schema** via `parameters`.
- Returns JSON in `output`, not markdown.

### 3.1. Read-Only Tools

1. `symbol_overview`
   - Parameters:
     ```ts
     {
       type: 'object',
       properties: {
         symbol: { type: 'string' },
         sections: { type: 'array', items: { type: 'string' } },
       },
       required: ['symbol'],
       additionalProperties: false,
     }
     ```
   - Behavior:
     - Calls Bot’s discovery/report pipeline and cached data (equivalent to MCP `symbol-overview`).
     - Returns a JSON object:
       ```json
       {
         "symbol": "AAPL",
         "summaryMarkdown": "...",
         "fundamentals": { ... },
         "technicals": { ... },
         "options": { ... }
       }
       ```

2. `news_list`
   - Parameters:
     ```ts
     { type: 'object', properties: { symbol: { type: 'string' }, limit: { type: 'number' } }, required: ['symbol'] }
     ```
   - Behavior:
     - Uses Bot news services, including AInvest where configured.
     - Returns an array of news items with `headline`, `source`, `publishedAt`, `path`.

3. `options_chain`
   - Parameters: symbol + expiration + optional window.
   - Behavior: proxies Bot options service; returns a summary chain (no need to mirror MCP exactly).

4. `technicals_get`
   - Parameters: symbol + timeframe.

5. `signals_get`
   - Parameters: symbol + interval.

6. `sp500_movers`
   - Parameters: `{ direction: 'up' | 'down' }`.

7. `portfolio_get`
   - No parameters.
   - Returns the same shape as `Bot.getPortfolio({ nonzeroOnly: true })`.

8. `web_search`
   - Optional:
     - If the Codex model has built‑in `web_search`, we can either:
       - Let the model call **its own** web_search tool (no override).
       - Or wrap it with a “policy guard” interceptor.
     - For autonomous v2 we keep it simple:
       - Do **not** register `web_search` here.
       - Let the model use its built‑in tool when `web_search` is available.

### 3.2. Trading Tools (Gated)

Trading tools are only registered when:
- `TRADER_LIVE=1` or a workflow flag `liveTrading: true` is set.
- Otherwise, only preview functionality is available.

1. `orders_preview`
   - Parameters:
     - `symbol`, `side`, `quantity`, `type`, `time_in_force`, `limitPrice`, `stopPrice`, `optionOccSymbol`, `optionLegs`.
   - Behavior:
     - Calls `Bot.previewOrder` with `dryRun: true`.
     - Persists payload hash as Bot already does.
     - Returns:
       ```json
       {
         "ok": true,
         "clientId": "preview-id",
         "payloadHash": "hash",
         "preview": { ... }
       }
       ```

2. `orders_submit`
   - Parameters:
     - `clientId`, `payloadHash`, same order fields as preview (for validation).
   - Behavior:
     - Calls `Bot.placeOrderConfirmed`.
     - Throws error when preview mismatch / expired.
     - Can be **disabled** entirely when `liveTrading` is false; the handler then returns:
       ```json
       { "ok": false, "error": "Live trading disabled in this environment" }
       ```

---

## 4. Threads & Agents

### 4.1. Screener Agent

Current behavior:
- One “unified” screener or multi‑agent variant (technical/fundamental/catalyst/options).
- Uses `runStreamed` with a structured schema:
  ```ts
  const SCREENER_OUTPUT_SCHEMA = {
    type: 'object',
    properties: {
      candidates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            symbol: { type: 'string' },
            instrument: { type: 'string', enum: ['equity','etf','option'] },
            confidence: { type: 'string', enum: ['high','medium','speculative'] },
            thesis: { type: 'string' },
          },
          required: ['symbol','instrument','confidence','thesis'],
          additionalProperties: false,
        },
      },
    },
    required: ['candidates'],
    additionalProperties: false,
  }
  ```

Autonomous v2:
- Reuse this schema verbatim with `@codex-native/sdk`.
- **Multi-agent**:
  - Create four agents via the `@openai/agents` API over `CodexProvider` (already supported by native SDK).
  - Each agent receives:
    - Same tool registry.
    - Its own sub‑prompt (technical/fundamental/catalyst/options).
  - Launch in parallel (Promise.all) with **per‑agent error isolation**:
    - Catch per‑agent failures; log and continue with remaining agents.
    - Aggregate `usage` and candidates with defensive numeric checks.
- **Single-agent**:
  - Keep the existing flow but remove `mcp_tool_call` accumulation:
    - Event loop only tracks `agent_message`, `web_search`, `error`, `todo_list`.
  - Forking:
    - Support optional `forkAtUserMessageIndex` to explore alternative screens:
      - After a successful run, caller can call:
        ```ts
        const branch = await thread.fork({ nthUserMessage: 1, threadOptions: { model: 'gpt-5-codex-mini' } })
        ```
      - Expose this via advanced API only (not CLI flag initially).

### 4.2. Research Agent

- Reuse the existing `ResearchAggregator`, `ResearchRoles`, and `Strategy` logic.
- Changes:
  - No MCP dependency in prompts:
    - Replace “use MCP tools” prose with “use the configured tools like `symbol_overview`, `news_list`, `options_chain`”.
  - Event handling:
    - Stop storing `mcp_tool_call`; instead:
      - Track generic `tool` events via a simple adapter:
        - Count per tool name.
        - Optionally store “last few” calls for debugging.

### 4.3. Trader Agent

- Keep the structured output schema for `actions[]` + `reasoning`.
- Changes:
  - Ensure **pre‑stream errors** (e.g., `runStreamed` reject) are caught and logged, not unhandled.
  - When `TRADER_LIVE` is not set:
    - Trader agent may still **recommend** trades.
    - Execution step is gated at the workflow level; no live orders are sent.

---

## 5. Configuration & Env

### 5.1. Env Handling

`env.ts` already:
- Searches for `.env` upward from `process.cwd()` and module path.
- Normalizes `TOKEN` by stripping `Bearer `.

Autonomous v2:
- Keep `env.ts` mostly unchanged.
- Add a small helper:
  ```ts
  export function requireToken() {
    if (!process.env.TOKEN) throw new Error('TOKEN not set; see README for setup.');
  }
  ```

### 5.2. Autonomous Runtime Config

`runtime-config.ts` continues to:
- Load JSON config (from `AUTONOMOUS_CONFIG_JSON` or a JSON file) for telemetry and thresholds.
- Provide a `TelemetryConfig` type.

Autonomous v2 additions:
- Flags:
  - `AUTONOMOUS_STOCK_ONLY`: forwarded to Bot + prompts.
  - `AUTONOMOUS_TRADER_OPTIONS_MODE`: `stocks-only | options-only | both`.
  - `TRADER_LIVE`: `"1"` enables live orders; otherwise preview only.
  - `SCREENER_MAX_CANDIDATES`: override default.
- Ensure these values are surfaced in:
  - Screener prompt “Capital & Constraints”.
  - Trader prompt “Risk constraints”.

---

## 6. Error Handling & Validation

We explicitly address the issues documented in `ANALYSIS_DASHBOARD.txt` / quick references.

### 6.1. Stream Initialization

- Wrap all `thread.runStreamed(...)` calls in try/catch:
  - On failure, return `{ candidates: [], notes: 'stream init failed: ...' }` for screener.
  - For trader/research, surface a clear error in the returned object and log via telemetry.

### 6.2. JSON Validation

- After `JSON.parse` of structured outputs:
  - Validate against the expected shape.
  - Either:
    - Use a lightweight custom validator (field existence/type checks), or
    - Use Zod schemas where we already depend on zod elsewhere.
- On validation failure:
  - Log a concise message plus limited excerpt of the raw response.
  - For screener:
    - Treat invalid output as “no candidates” and include the issue in `notes`.

### 6.3. Usage Aggregation

- When aggregating `Usage`:
  - Only sum if `Number.isFinite(value)` and value ≥ 0.
  - If any value is invalid, log telemetry and skip that field for that agent.

### 6.4. Timeouts

- Use Codex options and/or prompt instructions to keep turns bounded.
- Optionally, introduce a soft timeout wrapper:
  - `Promise.race([runStreamed, timeoutPromise])` for workflows that should not hang.

---

## 7. Telemetry Enhancements

`telemetry.ts` already supports appending JSON lines to a file.

Autonomous v2:
- Define a small set of canonical telemetry events:
  - `screener.run.completed`
  - `research.run.completed`
  - `trader.run.completed`
  - `codex.error`
  - `tool.invocation`
- Each workflow:
  - Emits a summary event at the end with:
    - `mode`, `duration_ms`, `symbols`, `candidateCount`, `errors`.
  - Optionally logs per‑tool invocation counts (including failures).

---

## 8. Testing Strategy

### 8.1. Unit Tests

- `tools.test.ts`:
  - Use a fake Bot (in‑memory stub) to verify that:
    - Each tool parses arguments correctly.
    - Errors are surfaced as `{ error, success: false }`.
- `codex-factory.test.ts`:
  - Assert that `createThreadOptions("screener")` sets `workingDirectory` to `<repoRoot>/content`.

### 8.2. Integration Tests

- Screener:
  - Run `runScreener` with:
    - Stub Bot (pre‑seeded portfolio + news).
    - Codex mocked to return a fixed JSON string for the screener output.
  - Assert:
    - Candidates parsed correctly.
    - `ScreenerRun` includes `availableCapital`, `holdings`, `optionsMode`.

- Research:
  - Use sample `ResearchItem`s and stubbed Codex responses.
  - Verify `ResearchAggregator` gets artifacts and summary markdown.

- Trader:
  - Stub Codex to output a valid `actions[]`/`reasoning`.
  - Assert `runTraderWorkflow` returns `TraderResult` with proper actions.

### 8.3. Manual E2E

- With real `TOKEN` configured:
  - `pnpm --filter autonomous screen`
  - `pnpm --filter autonomous research`
  - `pnpm --filter autonomous trade` (with `TRADER_LIVE=0` for safety).

---

## 9. Migration Steps (Concrete)

1. **SDK Swap**
   - Replace `@openai/codex-sdk` imports with `@codex-native/sdk` everywhere in `packages/autonomous/src`.
   - Update types (`Codex`, `Thread`, `ThreadEvent`, `ThreadItem`, `Usage`, `WebSearchItem`, etc.) to use the native SDK definitions.

2. **Remove MCP Wiring**
   - Delete MCP‑specific API from `config.ts`:
     - `ensureHoodwinkMcpServer`
     - TOML read/write logic for `mcp_servers`.
   - Replace with a simple `createCodex` + `createThreadOptions` factory.
   - Clean up prompts referring to MCP servers/tools.

3. **Introduce `tools.ts`**
   - Implement `registerCoreTools` + `registerTradingTools` as described.
   - Wire into screener/research/trader workflows before any `run`/`runStreamed` call.

4. **Refactor Workflows**
   - Move Codex creation and Bot/tool wiring into dedicated workflow modules.
   - Update CLI entrypoints to call workflows instead of low‑level modules.

5. **Harden Error Handling**
   - Wrap all `runStreamed` calls.
   - Add JSON validation helpers.
   - Improve logging and telemetry for failures.

6. **Extend Tests**
   - Add unit/integration tests for tools + workflows.
   - Ensure `pnpm --filter autonomous test` passes on CI.

7. **Docs & Readme**
   - Update root README and any `autonomous` docs to:
     - Mention `@codex-native/sdk` dependency.
     - Remove MCP server as a prerequisite.
     - Document new env flags and modes.

Once these steps are complete, the `autonomous` package will rely solely on the Codex Native JS API, using the Bot library as its data plane and registering only the tools it needs for fully in‑process autonomous workflows.

---

## 10. Advanced Enhancements & Refinements

The sections above describe the core migration. This section captures additional improvements discovered during a deeper read of the current implementation (`screener.ts`, `screener-pipeline.ts`, `researcher.ts`, `research-roles.ts`, `research-strategy.ts`, `trader.ts`, `trader-workflow.ts`, `trader-memory.ts`, `role-schedule.ts`, `citation-utils.ts`, `cli/hoodwink.ts`).

These can be implemented incrementally after the native SDK migration.

### 10.1. Shared Codex Runtime Helpers

Introduce a small runtime module (e.g. `codex-runtime.ts`) to consolidate common patterns:

- `resumeOrStartThread(store: ThreadStore, symbolKey: string, roleId: string, codex: Codex, threadOptions: ThreadOptions): Promise<{ thread: Thread; resumed: boolean }>`
  - Used by screener, research roles, and trader.
  - Wraps `ThreadStore.load` + `codex.resumeThread` + fallback to `startThread`.

- `runThreadStreamedWithSchema(opts: { thread: Thread; prompt: string; outputSchema?: unknown; onEvent?(e: ThreadEvent): void }): Promise<{ items: ThreadItem[]; finalResponse: string; usage: Usage | null; error?: string }>`
  - Wraps `thread.runStreamed`, collects `ThreadItem[]`, handles:
    - `turn.failed` events by setting `error` instead of throwing.
    - Optional `outputSchema` for structured output.
  - All callers (screener, research, trader) use this instead of re‑implementing event loops.

Benefits:
- Centralized error handling and usage collection.
- Easier to instrument telemetry and debugging (single place to tap events).

### 10.2. Structured Output for Research Validators

Current behavior:
- `screener-pipeline.ts` uses keyword heuristics on free text to derive:
  - `combinedRating`: `BUY | HOLD | PASS | CAUTION`
  - `combinedConfidence`: `high | medium | low`

Improvement:
- Define explicit schemas for validator roles:
  - Quick validator:
    ```ts
    const VALIDATOR_SCHEMA = {
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: ['CONFIRMED', 'CAUTION', 'REJECT'] },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        summary: { type: 'string' },
        keyRisks: { type: 'array', items: { type: 'string' } },
      },
      required: ['verdict', 'confidence', 'summary'],
      additionalProperties: false,
    } as const
    ```
  - Full roles (`fundamental`, `risk`, `catalyst`) can extend this with additional fields.
- Extend `ResearchArtifact` to optionally hold `structured?: unknown`.
- `enrichCandidatesWithResearch`:
  - Calls `runThreadStreamedWithSchema` with validator schemas.
  - Derives `combinedRating` & `combinedConfidence` from the structured fields instead of free‑text parsing.

### 10.3. Explicit Tool Name Mapping (Legacy MCP → Native Tools)

Prompts in `prompts.ts` and `screener-pipeline.ts` reference:
- `symbol-overview`
- `news-list`
- `news-index`
- `options-chain`
- `options-unusual`
- `signals-get`
- `report://{SYMBOL}/latest`
- `ainvest-analyze`
- `web_search`

Action items:
- In `tools.ts`, define a canonical set of native tool names and ensure prompts match them exactly:
  - `symbol_overview`
  - `news_list`
  - `news_index` (if we expose the prebuilt index)
  - `options_chain`
  - `options_unusual`
  - `signals_get`
  - `report_latest`
  - `ainvest_analyze`
- Update prompts to:
  - Use correct names and JSON parameter shapes (e.g. `news_list { "symbol": "AAPL", "limit": 10 }`).
  - Remove direct `report://` and similar URI usage.
  - Talk about “configured tools” rather than “MCP tools”.

### 10.4. Role-Aware Tool Guidance

Currently:
- Prompts often list a broad menu of tools for each role.

Improvement:
- Extend `ResearchRole` with an optional `toolsHint?: string[]`:
  - Example: `['symbol_overview', 'news_list', 'options_chain']`.
- Use this in `prompts.ts` to generate concise, role‑specific “Tools to use” sections:
  - Reduces cognitive load on the model.
  - Makes role responsibilities clearer in the code.
- Optional future enhancement:
  - Track tool usage per role via telemetry to see if guidance is followed.

### 10.5. Decision Logging & Memory Integration

Trader:
- `trader-memory.ts` already tracks `lastActionType` and cooldowns.
- `trader-workflow.ts` filters actions with `filterActionsWithCooldown` and records suppressed reasons.

Improvements:
- Extend `TraderResult` with an optional `decisionLog?: string[]`:
  - Entries like: `"skip: cooldown 24h remaining"`, `"execute: within risk budget"`.
- When recording trader actions:
  - Append a short summary string into trader memory (per symbol).
  - Provide an optional hook in `ResearchAggregator` to ingest trader decision summaries for future runs (so research prompts can reference “recent trades”).

Research scheduling:
- `RoleScheduleStore` + `research-strategy.ts` decide which roles to run but do not record *why*.
- Extend schedule entries with `reason?: string`:
  - `"initial_run"`, `"age_timeout"`, `"price_move_trigger"`, `"unrealized_change_trigger"`, `"manual"`.
- Add this reason to `PortfolioResearchResult` (e.g., `executedRolesWithReasons`).
- CLI can then print: `fundamentals (forced: unrealized +7%)`.

### 10.6. Thread Lifecycle Policy

Concern:
- Persistent threads can accumulate large histories and stale context.

Policy:
- Define thresholds in config (e.g. `AUTONOMOUS_MAX_THREAD_AGE_HOURS`, `AUTONOMOUS_MAX_THREAD_TURNS`).
- In `resumeOrStartThread`:
  - Read metadata from a small sidecar file alongside the thread record (e.g. lastUpdatedAt, turnsCount).
  - If thresholds exceeded:
    - Do not reuse the old thread id.
    - Instead:
      - Start a new thread.
      - Pass a short “memory summary” compiled from recent artifacts into the first prompt.

### 10.7. Telemetry Enhancements

Extend telemetry beyond the current trader workflow:
- Add summary events:
  - `screener.run.completed` with `{ candidates, screenerType, duration_ms, error? }`.
  - `research.run.completed` with `{ symbols, rolesRun, skippedRoles, duration_ms }`.
- Instrument the shared Codex runtime:
  - Emit `codex.turn.failed` with `{ mode, symbol?, error }`.
  - Emit `tool.invocation` with `{ name, success, duration_ms }` (even just approximate).
- Keep the file‑based backend (`telemetry.jsonl`), but document the event types in `PLAN.md` so future tooling can parse them.

### 10.8. CLI Output Enhancements

Suggested UX improvements:
- Screener:
  - After enriched candidates, print a compact table:
    - `Symbol | Screener Conf. | Validation Rating | Conf. | Tools Used`
  - For multi‑agent mode, show per‑agent candidate counts and note any agent errors.
- Trader:
  - When actions are suppressed by cooldown, immediately show the suppression reason under the symbol.
  - Group actions into “entry/exit/monitor” sections to make the output scannable.

These enhancements are optional for the initial migration but provide a roadmap for making the autonomous system’s decisions more transparent and auditable over time.

---

## 11. Per-Agent Tool Sets & Thread/Memory Model

This section captures two strict requirements:
- MCP is no longer used; tools must be **directly registered** in the Codex native SDK.
- Each agent must have access **only** to the tools it needs.
- All threads must be **persisted** and resumable with a clear memory model.

### 11.1. Per-Agent Tool Sets

Instead of a single global “hoodwink” MCP toolbox, we define explicit tool sets per agent or role.

#### 11.1.1. Tool Set Definitions

These are **logical** sets; the underlying tools are implemented once in `tools.ts`.

- `ScreenerTools`
  - `sp500_movers` – find large S&P moves.
  - `symbol_overview` – fundamentals, earnings, ratings, options summary.
  - `news_list` – recent headlines (Robinhood + AInvest).
  - `signals_get` – technical signals (momentum, crossovers).
  - `technicals_get` – more detailed indicators if needed.

- `FundamentalsTools`
  - `symbol_overview` – with `sections` emphasizing fundamentals/earnings/ratings.
  - `news_list` – to cross-check recent events.
  - `report_latest` – cached analyst/discovery report (Bot-backed, replacing `report://...`).
  - `ainvest_analyze` – AInvest HTML + screenshot + news cleanup.

- `RiskTools`
  - `signals_get` – risk signals, volatility.
  - `options_chain` – near-dated chain for hedging and payoff analysis.
  - `options_unusual` – unusual options activity.
  - `symbol_overview` – sections `["insiders","hedgeFunds","signals"]` for institutional context.

- `CatalystTools`
  - `news_list` / `news_index` – near-term catalyst headlines.
  - `symbol_overview` – earnings calendar and event metadata.
  - `sp500_movers` – to detect broad catalyst-driven moves.
  - (Optional) `web_search` – built-in Codex tool when available, for extra context only.

- `TraderTools` (read-oriented)
  - `portfolio_get` – full portfolio snapshot.
  - `symbol_overview` – to confirm fundamentals before acting.
  - `news_list` – last events before acting.
  - `signals_get` / `technicals_get` – confirm timing.

- `TraderExecutionTools` (write-oriented; gated)
  - `orders_preview` – always allowed, but dry-run only.
  - `orders_submit` – only registered when live trading is explicitly enabled (e.g. `TRADER_LIVE=1` and/or workflow flag).

#### 11.1.2. Implementation Strategy

- `tools.ts` will:
  - Implement the underlying tool handlers (Bot-backed).
  - Export **named tool sets** as arrays of tool names:
    - `SCREENER_TOOL_NAMES`, `FUNDAMENTALS_TOOL_NAMES`, `RISK_TOOL_NAMES`, `CATALYST_TOOL_NAMES`, `TRADER_TOOL_NAMES`, `TRADER_EXEC_TOOL_NAMES`.

- Usage:
  - For flows using `@openai/agents` + `CodexProvider`:
    - Each `Agent` is instantiated with the appropriate tool list; the Agent layer enforces the per-agent tool visibility.
  - For direct `thread.runStreamed` flows:
    - We will still register all tools on the `Codex` instance but:
      - Prompts will explicitly list only the tools allowed for that agent.
      - Optionally, we can add a **tool interceptor** or approval callback that denies calls to tools not in the agent’s allowed set.

### 11.2. Thread Storage & Memory Model

All agents and roles must persist and reuse threads so that:
- Longitudinal context is available across runs.
- We can reset or fork threads intentionally when they get too long or stale.

#### 11.2.1. Thread Store Keys and Records

We already have `ThreadStore` with:
- `ThreadRecord`:
  - `threadId`
  - `roleId`
  - `symbol`
  - `updatedAt`

We will:
- Treat the key as `(agentOrRoleId, symbolKey)`:
  - For research roles: `roleId` is the research role (`overview`, `fundamentals`, `risk`, etc.).
  - For screener: `roleId = "screener"`, `symbol = "SCREENER"`.
  - For trader: `roleId = "trader"`, `symbol = ticker`.
- Extend `ThreadRecord` (in a backward-compatible way) with optional metadata:
  - `mode?: "screener" | "research" | "trader" | "other"`
  - `turnsCount?: number`
  - `lastReason?: string` (optional reason why this thread was last used or reset).

The shared helper `resumeOrStartThread` will:
- Read the record.
- If present and not expired (see lifecycle policy below), attempt `codex.resumeThread(threadId)`.
- On failure, log a warning and start a new thread.
- Increment `turnsCount` and update `updatedAt` on every successful run.

#### 11.2.2. Thread Lifecycle Policy

To avoid unbounded threads:
- Configurable thresholds (via env or `AutonomousConfig`):
  - `maxThreadAgeHours` (per mode or global).
  - `maxThreadTurns` (per mode or global).
- When attempting to resume:
  - If `updatedAt` is too old or `turnsCount` exceeds the threshold:
    - Do **not** reuse the old thread id.
    - Start a new thread and:
      - Feed a **short memory summary** (see below) into the first prompt.
    - Write a new `ThreadRecord` with `turnsCount = 0` and `lastReason = "rollover"` or similar.

#### 11.2.3. Memory Summaries

We have separate memory concepts today:
- Research memory:
  - `ResearchAggregator` writes JSON + markdown with prior artifacts and an optional `memory` string.
- Trader memory:
  - `trader-memory.ts` stores last actions and notes per symbol.

Autonomous v2 will:
- For **research**:
  - Let `ResearchAggregator` generate a **compact summary** per symbol:
    - e.g. last 1–3 key thesis points, last major risk, last trade note if any.
  - When starting a new thread for that symbol (instead of resuming), include this summary in the first prompt as a “prior research / decisions” section.

- For **trader**:
  - After each trader decision, append a short line to:
    - Trader state notes (per symbol).
    - The next research aggregator memory block, so research prompts see “Recently, we did X on this position.”

This creates a consistent, text-based “memory” channel that survives thread resets while keeping Codex thread histories manageable.

### 11.3. Enforcement Summary

With these additions:
- **Per-agent tools** are enforced by:
  - Limited tool lists in `@openai/agents` configs, and/or
  - An approval/interceptor layer in Codex Native that rejects calls to disallowed tools.
- **Thread persistence and memory** are enforced by:
  - A single `ThreadStore` used by all workflows and agents.
  - A lifecycle policy that decides when to resume vs start new threads.
  - Memory summaries injected into prompts when starting new threads.

All of this will be implemented within `packages/autonomous`, leaving `bot` and other packages as the data and execution layer behind the Codex Native SDK.
