import { fastEmbedEmbed } from "../nativeBinding.js";
import type { ReverieInsight } from "./types.js";

type BoilerplateFilterOptions = {
  projectRoot?: string;
  threshold?: number;
  maxExcerptLength?: number;
};

const DEFAULT_THRESHOLD = 0.8;
const DEFAULT_MAX_EXCERPT_LENGTH = 512;

const BOILERPLATE_SEEDS = [
  "<system>Focus on summarizing repo context and keep instructions short.",
  "<environment_context>Working directory: /repo/codex sandbox_mode: workspace-write network_access: disabled</environment_context>",
  "# AGENTS.md instructions for this task require you to enumerate files before running commands.",
  "Tool output: command completed successfully with exit code 0.",
  "You are coordinating multiple agents. Respond with JSON describing the plan.",
  "Sandbox env vars: CODEX_SANDBOX=seatbelt CODEX_SANDBOX_NETWORK_DISABLED=1",
  "1. Inspect repository status; 2. List directories; 3. Review README/AGENTS instructions before acting.",
  "1. Inventory tooling - run `just --list` for recipes. 2. Verify Rust toolchain. 3. Read AGENTS.md for repo-specific guidance before editing.",
];

let seedVectorsPromise: Promise<number[][] | null> | null = null;
let embeddingDisabled = false;

const dot = (a: number[], b: number[]): number => a.reduce((sum, value, idx) => sum + value * (b[idx] ?? 0), 0);

function truncateExcerpt(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return normalized.slice(0, maxLength);
}

async function embedTexts(inputs: string[], projectRoot?: string): Promise<number[][] | null> {
  if (embeddingDisabled || inputs.length === 0) {
    return null;
  }

  try {
    const embeddings = await fastEmbedEmbed({
      inputs,
      projectRoot,
      normalize: true,
    });
    return embeddings;
  } catch (error) {
    embeddingDisabled = true;
    console.warn(`⚠️  Reverie boilerplate filter disabled (fastEmbedEmbed unavailable: ${(error as Error).message ?? error})`);
    return null;
  }
}

async function getSeedVectors(projectRoot?: string): Promise<number[][] | null> {
  if (seedVectorsPromise) {
    return seedVectorsPromise;
  }
  seedVectorsPromise = embedTexts(BOILERPLATE_SEEDS, projectRoot);
  return seedVectorsPromise;
}

export async function filterBoilerplateInsights(
  insights: ReverieInsight[],
  options?: BoilerplateFilterOptions,
): Promise<{ kept: ReverieInsight[]; removed: number }> {
  if (insights.length === 0) {
    return { kept: [], removed: 0 };
  }

  const projectRoot = options?.projectRoot;
  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;
  const maxExcerpt = options?.maxExcerptLength ?? DEFAULT_MAX_EXCERPT_LENGTH;

  const seeds = await getSeedVectors(projectRoot);
  if (!seeds || seeds.length === 0) {
    return { kept: insights, removed: 0 };
  }

  const excerptBatch = insights.map((insight) => truncateExcerpt(insight.excerpt, maxExcerpt));
  const excerptVectors = await embedTexts(excerptBatch, projectRoot);
  if (!excerptVectors) {
    return { kept: insights, removed: 0 };
  }

  const kept: ReverieInsight[] = [];
  let removed = 0;

  for (let i = 0; i < insights.length; i += 1) {
    const vector = excerptVectors[i];
    if (!vector) {
      kept.push(insights[i]!);
      continue;
    }

    const maxSimilarity = seeds.reduce((currentMax, seedVec) => {
      const similarity = dot(vector, seedVec);
      return similarity > currentMax ? similarity : currentMax;
    }, -Infinity);

    if (Number.isFinite(maxSimilarity) && maxSimilarity >= threshold) {
      removed += 1;
    } else {
      kept.push(insights[i]!);
    }
  }

  if (removed > 0) {
    console.log(`🧹 Reverie boilerplate filter removed ${removed}/${insights.length} excerpts (threshold ${threshold.toFixed(2)})`);
  }

  return { kept, removed };
}
