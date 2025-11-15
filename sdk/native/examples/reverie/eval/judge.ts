import { Agent, Runner } from "@openai/agents";
import { CodexProvider } from "@codex-native/sdk";

import type { ReasoningSlice } from "./dataset";
import type { StrategyRun } from "./strategies";
import { clipText } from "./strategies";

const DEFAULT_SYSTEM_PROMPT = `You are GPT-5.1 acting as a semantic retrieval judge.
Compare multiple retrieval strategies that search a reverie transcript corpus.
Rank the strategies based on how well their top matches capture the target reasoning snippet.
Prefer strategies that:
1. Retrieve the original conversation quickly.
2. Surface excerpts that mention identical troubleshooting steps or reasoning tokens.
3. Preserve causal chains or execution plans, not just keywords.
Explain your verdicts succinctly.`;

export type JudgeVerdict = {
  winner: string;
  summary: string;
  scoreboard: Array<{
    strategy: string;
    placement: number;
    justification: string;
    confidence?: string;
  }>;
};

export type JudgeContext = {
  slice: ReasoningSlice;
  runs: StrategyRun[];
};

export type StrategyJudgeOptions = {
  modelName: string;
  instructions?: string;
  strategyIds: string[];
};

export async function createStrategyJudge(options: StrategyJudgeOptions): Promise<StrategyJudge> {
  const provider = new CodexProvider({
    defaultModel: options.modelName,
    skipGitRepoCheck: true,
    workingDirectory: process.cwd(),
  });
  const model = await provider.getModel(options.modelName);
  const runner = new Runner({ modelProvider: provider });

  const schema = makeVerdictSchema(options.strategyIds);
  const agent = new Agent({
    name: "SemanticJudge",
    model,
    instructions: options.instructions ?? DEFAULT_SYSTEM_PROMPT,
    outputType: {
      type: "json_schema",
      name: "StrategyVerdict",
      schema,
      strict: true,
    },
  });

  return new StrategyJudge({ agent, runner, strategyIds: options.strategyIds });
}

type InternalJudgeDeps = {
  agent: Agent;
  runner: Runner;
  strategyIds: string[];
};

export class StrategyJudge {
  private agent: Agent;
  private runner: Runner;
  private strategyIds: string[];

  constructor(deps: InternalJudgeDeps) {
    this.agent = deps.agent;
    this.runner = deps.runner;
    this.strategyIds = deps.strategyIds;
  }

  async evaluate(context: JudgeContext): Promise<JudgeVerdict> {
    const prompt = buildJudgePrompt(context);
    const result = await this.runner.run(this.agent, prompt);
    return normalizeVerdict(result.finalOutput as JudgeVerdict, this.strategyIds);
  }
}

function buildJudgePrompt(context: JudgeContext): string {
  const { slice, runs } = context;
  const parts: string[] = [];
  parts.push("Target reasoning snippet:");
  parts.push(indentBlock(slice.reasoningText.trim()));

  if (slice.userMessage) {
    parts.push("\nUser request:");
    parts.push(indentBlock(slice.userMessage));
  }

  if (slice.assistantResponse) {
    parts.push("\nAssistant response excerpt:");
    parts.push(indentBlock(slice.assistantResponse));
  }

  parts.push("\nStrategy evidence:");
  for (const run of runs) {
    parts.push(`\n[${run.strategy.label} — ${run.strategy.id}]`);
    parts.push(`Query preview: ${clipText(run.query) ?? "<missing>"}`);
    if (run.skipped) {
      parts.push(`Skipped: ${run.skipReason ?? "missing query"}`);
      continue;
    }
    if (run.error) {
      parts.push(`Error: ${run.error}`);
      continue;
    }
    const hit = run.autoScore.matchedSourceConversation;
    parts.push(`Source conversation retrieved: ${hit ? `yes (rank ${run.autoScore.sourceRank})` : "no"}`);
    const topResults = run.results.slice(0, 3);
    if (topResults.length === 0) {
      parts.push("No semantic matches returned.");
      continue;
    }
    parts.push("Top candidates:");
    topResults.forEach((result, idx) => {
      parts.push(formatResultLine(idx, result, slice.conversationId));
    });
  }

  parts.push(`\nDecide which strategy best preserves the reasoning tokens and provide ranked placements for every strategy (${context.runs.length} total).`);
  parts.push("Respond with JSON per the specified schema.");
  return parts.join("\n");
}

function formatResultLine(idx: number, result: StrategyRun["results"][number], sourceConversationId: string): string {
  const excerpt = summarizeExcerpt(result);
  const sourceTag = result.conversation.id === sourceConversationId ? " [source match]" : "";
  const reranker = typeof result.rerankerScore === "number" ? ` | reranker=${result.rerankerScore.toFixed(3)}` : "";
  return `  ${idx + 1}. conv=${result.conversation.id} score=${result.relevanceScore.toFixed(3)}${reranker}${sourceTag}\n     ${excerpt}`;
}

function summarizeExcerpt(result: StrategyRun["results"][number]): string {
  const rawPieces = [
    ...(result.matchingExcerpts ?? []),
    ...(result.insights ?? []),
    ...(result.conversation.headRecordsToon?.slice(0, 1) ?? []),
  ].filter(Boolean);

  if (rawPieces.length === 0) {
    return "(no excerpt available)";
  }

  return clipText(rawPieces.join(" | "), 300) ?? "(excerpt missing)";
}

function normalizeVerdict(verdict: JudgeVerdict | undefined, strategyIds: string[]): JudgeVerdict {
  if (!verdict || typeof verdict !== "object") {
    throw new Error("Judge did not return a structured verdict.");
  }
  if (!strategyIds.includes(verdict.winner)) {
    throw new Error(`Judge winner ${verdict.winner} is not a recognized strategy.`);
  }
  if (!Array.isArray(verdict.scoreboard)) {
    throw new Error("Judge scoreboard missing.");
  }

  const placements = verdict.scoreboard.map((entry) => entry.strategy);
  const missing = strategyIds.filter((id) => !placements.includes(id));
  if (missing.length > 0) {
    throw new Error(`Judge omitted placements for: ${missing.join(", ")}`);
  }

  return verdict;
}

function makeVerdictSchema(strategyIds: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["winner", "summary", "scoreboard"],
    properties: {
      winner: { type: "string", enum: strategyIds },
      summary: { type: "string" },
      scoreboard: {
        type: "array",
        minItems: strategyIds.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["strategy", "placement", "justification"],
          properties: {
            strategy: { type: "string", enum: strategyIds },
            placement: { type: "integer", minimum: 1 },
            justification: { type: "string" },
          },
        },
      },
    },
  } as const;
}

function indentBlock(text: string): string {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

