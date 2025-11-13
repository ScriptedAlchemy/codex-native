import * as path from "node:path";
import * as process from "node:process";
import { fastEmbedEmbed, fastEmbedInit, type FastEmbedEmbedRequest, type Thread, reverieSearchConversations } from "@codex-native/sdk";
import type { MultiAgentConfig, ProcessedReverie, ReverieResult } from "./types.js";

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aMag += a[i] * a[i];
    bMag += b[i] * b[i];
  }

  if (aMag === 0 || bMag === 0) return 0;
  return dot / (Math.sqrt(aMag) * Math.sqrt(bMag));
}

function extractCompactTextFromRecords(headRecords: string[], tailRecords: string[], insights: string[]): string {
  const texts: string[] = [];

  for (const line of headRecords) {
    try {
      const obj = JSON.parse(line);
      const content = obj?.content || obj?.text;
      if (typeof content === "string" && content.trim()) {
        texts.push(content);
      }
    } catch {
      // ignore parse errors
    }
  }

  for (const line of tailRecords) {
    try {
      const obj = JSON.parse(line);
      const content = obj?.content || obj?.text;
      if (typeof content === "string" && content.trim()) {
        texts.push(content);
      }
    } catch {
      // ignore parse errors
    }
  }

  texts.push(...insights);

  const combined = texts.join(" ").slice(0, 4000);
  return combined;
}

function resolveCodexHome(): string {
  return process.env.CODEX_HOME || path.join(process.env.HOME || process.cwd(), ".codex");
}

class ReverieSystem {
  private embedderReady = false;

  constructor(private readonly config: MultiAgentConfig) {}

  async searchReveries(query: string): Promise<ReverieResult[]> {
    console.log(`🔍 Searching reveries for: "${query}"`);
    const codexHome = resolveCodexHome();
    console.log(`📁 Codex home: ${codexHome}`);

    try {
      const results = await reverieSearchConversations(codexHome, query, 25);
      const projectRoot = path.resolve(this.config.workingDirectory);
      const scoped = (results as any[]).filter((r) => {
        const head: string[] | undefined = r?.conversation?.headRecords;
        if (!Array.isArray(head) || head.length === 0) return false;
        for (const line of head) {
          try {
            const obj = JSON.parse(line);
            const cwd = obj?.meta?.cwd || obj?.cwd;
            if (typeof cwd === "string") {
              const normalized = path.resolve(cwd);
              if (normalized === projectRoot || normalized.startsWith(projectRoot + path.sep)) {
                return true;
              }
            }
          } catch {
            // ignore parse errors
          }
        }
        return false;
      });

      let processed: ProcessedReverie[] = scoped.map((r) => ({
        conversationId: r.conversation?.id || "unknown",
        timestamp: r.conversation?.createdAt || new Date().toISOString(),
        relevance: typeof r.relevanceScore === "number" ? r.relevanceScore : 0.7,
        excerpt: (r.matchingExcerpts && r.matchingExcerpts[0]) || "",
        insights: Array.isArray(r.insights) ? r.insights : [],
        headRecords: Array.isArray(r.conversation?.headRecords) ? r.conversation.headRecords : [],
        tailRecords: Array.isArray(r.conversation?.tailRecords) ? r.conversation.tailRecords : [],
        rawRelevance: typeof r.relevanceScore === "number" ? r.relevanceScore : 0.7,
      }));

      if (this.config.embedder) {
        processed = await this.rerankWithEmbeddings(query, processed);
      }

      return processed.slice(0, 10).map(({ headRecords, tailRecords, rawRelevance, ...result }) => result);
    } catch (error) {
      console.warn("Reverie search failed:", error);
      return [];
    }
  }

  private async ensureEmbedderReady(): Promise<void> {
    if (this.embedderReady || !this.config.embedder) {
      return;
    }
    await fastEmbedInit(this.config.embedder.initOptions);
    this.embedderReady = true;
  }

  private async rerankWithEmbeddings(query: string, items: ProcessedReverie[]): Promise<ProcessedReverie[]> {
    if (!this.config.embedder || items.length === 0) {
      return items;
    }
    try {
      await this.ensureEmbedderReady();

      const docTexts = items.map((item) =>
        extractCompactTextFromRecords(item.headRecords, item.tailRecords, item.insights),
      );
      const projectRoot = path.resolve(this.config.workingDirectory);
      const baseRequest = this.config.embedder.embedRequest ?? {};
      const embedRequest: FastEmbedEmbedRequest = {
        ...baseRequest,
        projectRoot,
        cache: baseRequest.cache ?? true,
        inputs: [query, ...docTexts],
      };

      const embeddings = await fastEmbedEmbed(embedRequest);
      if (embeddings.length !== docTexts.length + 1) {
        throw new Error("Embedding API returned unexpected length");
      }

      const [queryVector, ...docVectors] = embeddings;
      if (!queryVector) {
        return items;
      }

      const reranked = items.map((item, idx) => {
        const docEmbedding = docVectors[idx];
        if (!docEmbedding) {
          return item;
        }
        const semanticScore = cosineSimilarity(queryVector, docEmbedding);
        const blendedScore = 0.7 * semanticScore + 0.3 * item.rawRelevance;
        return { ...item, relevance: blendedScore };
      });
      reranked.sort((a, b) => b.relevance - a.relevance);
      return reranked;
    } catch (error) {
      console.warn("Embedding re-ranking failed:", error);
      return items;
    }
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
