import fs from "node:fs/promises";
import path from "node:path";

import { fastEmbedEmbed } from "../nativeBinding.js";
import type { ReverieEpisodeSummary } from "./types.js";

const EPISODES_FILENAME = "reverie_episodes.json";

async function readEpisodesFile(codexHome: string): Promise<ReverieEpisodeSummary[]> {
  try {
    const file = await fs.readFile(path.join(codexHome, EPISODES_FILENAME), "utf8");
    const parsed = JSON.parse(file);
    if (Array.isArray(parsed)) {
      return parsed as ReverieEpisodeSummary[];
    }
    return [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function searchEpisodeSummaries(
  codexHome: string,
  query: string,
  repo: string,
  limit = 20,
): Promise<ReverieEpisodeSummary[]> {
  const summaries = await readEpisodesFile(codexHome);
  if (!summaries.length || !query.trim()) {
    return [];
  }

  const documents = summaries.map((episode) =>
    [episode.summary, ...(episode.keyDecisions ?? [])].join("\n"),
  );
  const inputs = [query, ...documents];

  const embeddings = await fastEmbedEmbed({
    inputs,
    projectRoot: repo,
    normalize: true,
    cache: true,
  });

  if (embeddings.length !== inputs.length) {
    return [];
  }

  const [queryVector, ...docVectors] = embeddings;
  if (!queryVector) {
    return [];
  }
  const scored = summaries.map((episode, idx) => {
    const vector = docVectors[idx] ?? [];
    return {
      episode,
      score: cosineSimilarity(queryVector, vector),
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored
    .slice(0, limit)
    .map(({ episode }) => episode);
}

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) {
    return 0;
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    magA += av * av;
    magB += bv * bv;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
