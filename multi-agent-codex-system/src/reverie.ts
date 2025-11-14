import * as path from "node:path";
import * as process from "node:process";
import {
  fastEmbedInit,
  reverieSearchSemantic,
  type ReverieSemanticSearchOptions,
  type Thread,
} from "@codex-native/sdk";
import type { MultiAgentConfig, ReverieResult } from "./types.js";

const DEFAULT_REVERIE_LIMIT = 10;
const DEFAULT_REVERIE_CANDIDATES = 80;

function resolveCodexHome(): string {
  return process.env.CODEX_HOME || path.join(process.env.HOME || process.cwd(), ".codex");
}

class ReverieSystem {
  private embedderReady = false;

  constructor(private readonly config: MultiAgentConfig) {}

  async searchReveries(query: string): Promise<ReverieResult[]> {
    return this.searchReveriesFromText(query);
  }

  async searchReveriesFromText(
    text: string,
    options?: { limit?: number; maxCandidates?: number },
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
    const codexHome = resolveCodexHome();
    const projectRoot = path.resolve(this.config.workingDirectory);
    const semanticOptions = this.buildSemanticOptions(limit, maxCandidates, projectRoot);

    console.log(`🔍 Semantic reverie search (chars=${normalized.length}, limit=${limit})`);
    console.log(`📁 Codex home: ${codexHome}`);

    try {
      const matches = await reverieSearchSemantic(codexHome, normalized, semanticOptions);
      return matches.slice(0, limit).map((match) => ({
        conversationId: match.conversation?.id || "unknown",
        timestamp: match.conversation?.createdAt || new Date().toISOString(),
        relevance: typeof match.relevanceScore === "number" ? match.relevanceScore : 0,
        excerpt: match.matchingExcerpts?.[0] || "",
        insights: Array.isArray(match.insights) ? match.insights : [],
      }));
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
    return {
      limit,
      maxCandidates,
      projectRoot,
      batchSize: embedderRequest.batchSize,
      normalize: embedderRequest.normalize,
      cache: embedderRequest.cache,
    };
  }

  private async ensureEmbedderReady(): Promise<void> {
    if (this.embedderReady || !this.config.embedder) {
      return;
    }
    await fastEmbedInit(this.config.embedder.initOptions);
    this.embedderReady = true;
  }

  async injectReverie(thread: Thread, reveries: ReverieResult[], query: string): Promise<void> {
    if (reveries.length === 0) return;
    const note = `Injecting reverie learnings for '${query}':\n${reveries
      .map((r, idx) => `#${idx + 1} (${Math.round(r.relevance * 100)}%): ${r.insights.join("; ")}`)
      .join("\n")}`;
    await thread.run(note);
  }
}

export { ReverieSystem };
