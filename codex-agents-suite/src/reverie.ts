import * as path from "node:path";
import * as process from "node:process";
import {
  fastEmbedInit,
  reverieSearchSemantic,
  reverieIndexSemantic,
  type ReverieSemanticSearchOptions,
  type Thread,
  CodexProvider,
} from "@codex-native/sdk";
import { Agent, Runner } from "@openai/agents";
import type { MultiAgentConfig, ReverieResult } from "./types.js";

const DEFAULT_REVERIE_LIMIT = 10;
const DEFAULT_REVERIE_CANDIDATES = 80;

type ReverieDeps = {
  searchSemantic: typeof reverieSearchSemantic;
  indexSemantic: typeof reverieIndexSemantic;
  fastEmbedInit: typeof fastEmbedInit;
};

const DEFAULT_DEPS: ReverieDeps = {
  searchSemantic: reverieSearchSemantic,
  indexSemantic: reverieIndexSemantic,
  fastEmbedInit,
};

function resolveCodexHome(): string {
  return process.env.CODEX_HOME || path.join(process.env.HOME || process.cwd(), ".codex");
}

class ReverieSystem {
  private embedderReady = false;

  constructor(private readonly config: MultiAgentConfig, private readonly deps: ReverieDeps = DEFAULT_DEPS) {}

  async searchReveries(query: string): Promise<ReverieResult[]> {
    return this.searchReveriesFromText(query);
  }

  async warmSemanticIndex(): Promise<void> {
    if (!this.config.embedder) {
      console.log("⚠️  Skipping reverie indexing: embedder config missing.");
      return;
    }
    await this.ensureEmbedderReady();
    const codexHome = resolveCodexHome();
    const projectRoot = path.resolve(this.config.workingDirectory);
    const limit = this.config.reverieIndexLimit ?? 200;
    const maxCandidates = this.config.reverieIndexMaxCandidates ?? Math.max(limit * 2, 200);
    console.log(
      `📚 Pre-indexing reveries (limit=${limit}, candidates=${maxCandidates}) for ${projectRoot}…`,
    );
    try {
      const stats = await this.deps.indexSemantic(codexHome, {
        projectRoot,
        limit,
        maxCandidates,
        batchSize: this.config.embedder.embedRequest?.batchSize,
        normalize: this.config.embedder.embedRequest?.normalize,
        cache: this.config.embedder.embedRequest?.cache,
      });
      console.log(
        `✅ Reverie indexing complete (docs=${stats.documentsEmbedded}, batches=${stats.batches}).`,
      );
    } catch (error) {
      console.warn("⚠️  Reverie indexing failed:", error);
    }
  }

  async searchReveriesFromText(
    text: string,
    options?: { limit?: number; maxCandidates?: number; enableLLMGrading?: boolean },
  ): Promise<ReverieResult[]> {
    const normalized = text?.trim();
    if (!normalized) {
      return [];
    }
    if (!this.config.embedder) {
      console.warn("Reverie embedder config missing; semantic search disabled.");
      return [];
    }

    await this.ensureEmbedderReady();

    const limit = options?.limit ?? DEFAULT_REVERIE_LIMIT;
    const maxCandidates = options?.maxCandidates ?? DEFAULT_REVERIE_CANDIDATES;
    const enableLLMGrading = options?.enableLLMGrading ?? this.config.reverieEnableLLMGrading ?? false;
    const codexHome = resolveCodexHome();
    const projectRoot = path.resolve(this.config.workingDirectory);
    const semanticOptions = this.buildSemanticOptions(limit, maxCandidates, projectRoot);

    console.log(`🔍 Semantic reverie search (chars=${normalized.length}, limit=${limit})`);
    console.log(`📁 Codex home: ${codexHome}`);

    try {
      const matches = await this.deps.searchSemantic(codexHome, normalized, semanticOptions);
      const results = matches.slice(0, limit).map((match) => ({
        conversationId: match.conversation?.id || "unknown",
        timestamp: match.conversation?.createdAt || new Date().toISOString(),
        relevance: typeof match.relevanceScore === "number" ? match.relevanceScore : 0,
        excerpt: match.matchingExcerpts?.[0] || "",
        insights: Array.isArray(match.insights) ? match.insights : [],
      }));

      // Apply optional LLM grading to high-scoring results
      if (enableLLMGrading && results.length > 0) {
        const highScoring = results.filter((r) => r.relevance >= 0.7);
        const lowScoring = results.filter((r) => r.relevance < 0.7);

        if (highScoring.length > 0) {
          console.log(`🤖 LLM grading ${highScoring.length} high-scoring reveries (≥0.7)...`);

          const gradingPromises = highScoring.map((insight) =>
            this.gradeReverieRelevance(normalized, insight).then((isRelevant) => ({ insight, isRelevant })),
          );

          const gradedResults = await Promise.all(gradingPromises);
          const approved = gradedResults.filter((r) => r.isRelevant).map((r) => r.insight);
          const rejected = gradedResults.filter((r) => !r.isRelevant).length;

          console.log(`✅ LLM approved ${approved.length}/${highScoring.length} high-scoring reveries`);
          if (rejected > 0) {
            console.log(`❌ LLM rejected ${rejected} reveries as non-technical`);
          }

          // Return approved high-scoring + all low-scoring (which weren't graded)
          return [...approved, ...lowScoring];
        }
      }

      return results;
    } catch (error) {
      console.warn("Semantic reverie search failed:", error);
      return [];
    }
  }

  private buildSemanticOptions(
    limit: number,
    maxCandidates: number,
    projectRoot: string,
  ): ReverieSemanticSearchOptions {
    const embedderRequest = this.config.embedder?.embedRequest ?? {};
    const options: ReverieSemanticSearchOptions = {
      limit,
      maxCandidates,
      projectRoot,
      batchSize: embedderRequest.batchSize,
      normalize: embedderRequest.normalize,
      cache: embedderRequest.cache,
    };
    if (this.config.reverieRerankerModel) {
      options.rerankerModel = this.config.reverieRerankerModel;
      if (typeof this.config.reverieRerankerBatchSize === "number") {
        options.rerankerBatchSize = this.config.reverieRerankerBatchSize;
      }
      if (typeof this.config.reverieRerankerTopK === "number") {
        options.rerankerTopK = this.config.reverieRerankerTopK;
      }
    }
    return options;
  }

  private async ensureEmbedderReady(): Promise<void> {
    if (this.embedderReady || !this.config.embedder) {
      return;
    }
    await this.deps.fastEmbedInit(this.config.embedder.initOptions);
    this.embedderReady = true;
  }

  /**
   * Use LLM to evaluate if a reverie is actually relevant and useful.
   * Implements strict filtering for specific technical details.
   * @param searchContext - The original search query/context
   * @param insight - The reverie result to grade
   * @returns true if the insight contains specific technical details, false otherwise
   */
  async gradeReverieRelevance(searchContext: string, insight: ReverieResult): Promise<boolean> {
    try {
      const provider = new CodexProvider({
        workingDirectory: this.config.workingDirectory,
        skipGitRepoCheck: this.config.skipGitRepoCheck,
        defaultModel: this.config.model || "claude-sonnet-4-5-20250929",
        baseUrl: this.config.baseUrl,
        apiKey: this.config.apiKey,
      });
      const runner = new Runner({ modelProvider: provider });

      const gradingSchema = {
        type: "object" as const,
        properties: {
          is_relevant: {
            type: "boolean" as const,
            description: "True if excerpt contains specific technical details relevant to the work context",
          },
          reasoning: {
            type: "string" as const,
            description: "Brief explanation (1-2 sentences) of why the excerpt was approved or rejected",
          },
        },
        required: ["is_relevant", "reasoning"],
        additionalProperties: false,
      };

      const graderAgent = new Agent({
        name: "ReverieGrader",
        instructions: `You are a STRICT filter for conversation excerpts. Only approve excerpts with SPECIFIC technical details.

REJECT excerpts containing:
- Greetings and pleasantries
- Thinking markers (**, ##, <thinking>)
- JSON objects or structured data dumps
- Generic phrases ("Context from past work", "working on this", etc.)
- Metadata and system information
- Boilerplate text

APPROVE ONLY excerpts with:
- Specific code/file references (file paths, function names, variable names)
- Technical decisions and rationale
- Error messages and debugging details
- Implementation specifics and algorithms
- Architecture patterns and design choices

Return a JSON object with:
- is_relevant: boolean indicating if this excerpt should be kept
- reasoning: brief 1-2 sentence explanation of your decision`,
        outputType: {
          type: "json_schema" as const,
          schema: gradingSchema,
          name: "ReverieGrading",
          strict: true,
        },
      });

      const prompt = `Context: ${searchContext}

Excerpt to grade:
"""
${insight.excerpt.slice(0, 400)}
"""

Evaluate whether this excerpt contains specific technical details relevant to the work context.`;

      const result = await runner.run(graderAgent, prompt);

      // Parse structured output
      if (result.finalOutput && typeof result.finalOutput === "object") {
        const grading = result.finalOutput as { is_relevant: boolean; reasoning: string };
        return grading.is_relevant;
      }

      // Fallback: if structured output fails, default to rejecting (conservative)
      console.warn("Reverie grading failed to return structured output, defaulting to reject");
      return false;
    } catch (error) {
      console.warn("Failed to grade reverie relevance:", error);
      // On error, default to rejecting (conservative approach)
      return false;
    }
  }

  async injectReverie(thread: Thread, reveries: ReverieResult[], query: string): Promise<void> {
    if (reveries.length === 0) {
      return;
    }

    await this.emitBackgroundHint(thread, reveries, query);

    const systemNote = this.buildSystemReverieNote(reveries, query);
    await thread.run(systemNote);
  }

  private async emitBackgroundHint(thread: Thread, reveries: ReverieResult[], query: string): Promise<void> {
    if (typeof thread.sendBackgroundEvent !== "function") {
      return;
    }

    const hint = this.buildBackgroundHint(reveries, query);
    if (!hint) {
      return;
    }

    try {
      await thread.sendBackgroundEvent(hint);
    } catch (error) {
      console.warn("Failed to emit reverie background hint:", error);
    }
  }

  private buildBackgroundHint(reveries: ReverieResult[], query: string): string | null {
    const limited = reveries.slice(0, 2);
    if (limited.length === 0) {
      return null;
    }
    const lines = limited.map((r, idx) => {
      const score = `${Math.round(r.relevance * 100)}%`;
      const summary = r.insights[0] ?? r.excerpt ?? "(no excerpt)";
      return `#${idx + 1} (${score}) ${truncate(summary, 200)}`;
    });
    return `Reverie scan for "${query}":\n${lines.join("\n")}`;
  }

  private buildSystemReverieNote(reveries: ReverieResult[], query: string): string {
    const entries = reveries
      .map((r, idx) => {
        const header = `## Match ${idx + 1} — ${Math.round(r.relevance * 100)}% similar`;
        const excerpt = r.excerpt ? `Excerpt: ${truncate(r.excerpt, 320)}` : null;
        const insightText = r.insights.length
          ? `Insights: ${r.insights.map((text) => truncate(text, 320)).join(" | ")}`
          : null;
        return [header, excerpt, insightText].filter(Boolean).join("\n");
      })
      .join("\n\n");

    return `<system>\n# Reverie Context — ${query}\n${entries}\n</system>`;
  }
}

export { ReverieSystem };

function truncate(value: string, limit: number): string {
  if (!value) {
    return "";
  }
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}
