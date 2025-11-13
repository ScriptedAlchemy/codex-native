import path from "node:path";

import { fastEmbedInit, fastEmbedEmbed } from "@codex-native/sdk";

const MODEL_ID = "BAAI/bge-large-en-v1.5";

async function main() {
  await fastEmbedInit({
    model: MODEL_ID,
  });

  const snippets = [
    "CLI crashes after switching to the new sandbox",
    "Improve telemetry batching in the Codex provider",
    "Add thread forking to the CI inspector",
  ];

  const embeddings = await fastEmbedEmbed({
    inputs: snippets,
    projectRoot: process.cwd(),
    normalize: true,
  });

  embeddings.forEach((vector, idx) => {
    const preview = vector.slice(0, 5).map((value) => value.toFixed(4));
    console.log(`#${idx + 1} ${snippets[idx]} => [${preview.join(", ")}]`);
  });

  const cacheRoot = process.env.CODEX_HOME
    ? path.join(process.env.CODEX_HOME, "embeddings")
    : path.join(process.env.HOME ?? process.cwd(), ".codex", "embeddings");
  console.log(`\nVectors are cached under ${cacheRoot}`);
  console.log(`Model: ${MODEL_ID}`);
}

main().catch((error) => {
  console.error("Failed to run fast-embed example", error);
  process.exit(1);
});
