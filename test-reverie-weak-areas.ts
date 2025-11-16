import { fastEmbedInit, reverieSearchSemantic } from "@codex-native/sdk";
import os from "node:os";
import path from "node:path";

async function testWeakAreas() {
  const codexHome = path.join(os.homedir(), ".codex");

  console.log("=== Testing Previously Weak Areas ===\n");

  await fastEmbedInit({
    model: "BAAI/bge-large-en-v1.5",
    showDownloadProgress: false,
  });

  // The 5 weakest queries from before
  const weakQueries = [
    {
      name: "Package Management (was 52%)",
      query: "run pnpm install after pulling latest remote main branch",
      expectedTerms: ["pnpm", "install"],
    },
    {
      name: "Optimization (was 55%)",
      query: "optimize performance slow query response cache embeddings for faster search",
      expectedTerms: ["optimize", "performance", "cache"],
    },
    {
      name: "FastEmbed Init (was 56%)",
      query: "FastEmbed not initialized error need to call fastEmbedInit with model configuration",
      expectedTerms: ["fastembed", "init"],
    },
    {
      name: "Build Errors (was 57%)",
      query: "webpack compiled with warnings jsxDEV not found react module has no exports",
      expectedTerms: ["webpack", "warning", "react"],
    },
    {
      name: "Why Questions (was 58%)",
      query: "why make const exposesOption instead of just using options.exposes directly",
      expectedTerms: ["const", "options"],
    },
  ];

  console.log("Testing with technical term detection but NO hardcoded domain patterns\n");

  for (const { name, query, expectedTerms } of weakQueries) {
    console.log("━━━ " + name + " ━━━");
    console.log('Query: "' + query.slice(0, 80) + (query.length > 80 ? "..." : "") + '"');

    const results = await reverieSearchSemantic(codexHome, query, {
      limit: 3,
      maxCandidates: 30,
    });

    if (results.length === 0) {
      console.log("  ❌ No results\n");
      continue;
    }

    const topRelevance = Math.round(results[0].relevanceScore * 100);
    const allText = [...results[0].insights, ...results[0].matchingExcerpts]
      .join(" ")
      .toLowerCase();

    const matchedTerms = expectedTerms.filter(term =>
      allText.includes(term.toLowerCase())
    );

    const isSuccess = matchedTerms.length / expectedTerms.length >= 0.5 || topRelevance >= 60;

    console.log("  Relevance: " + topRelevance + "%");
    console.log("  Terms: " + matchedTerms.length + "/" + expectedTerms.length + " matched");
    console.log("  " + (isSuccess ? "✅ Success" : "⚠️  Weak") + "\n");
  }
}

testWeakAreas().catch(console.error);
