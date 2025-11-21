import { reverieSearchSemantic, fastEmbedInit } from "@codex-native/sdk";
import os from "node:os";
import path from "node:path";

async function testMultiVectorConceptual() {
  const codexHome = path.join(os.homedir(), ".codex");

  console.log("=== Testing Multi-Vector Conceptual Similarity ===\n");

  await fastEmbedInit({
    model: "BAAI/bge-large-en-v1.5",
    showDownloadProgress: false,
  });

  // Test queries that should match conceptually similar conversations
  const conceptualTests = [
    {
      query: "slow performance latency issues",
      description: "Should find: optimization, bottleneck, speed improvements",
    },
    {
      query: "build compilation errors webpack",
      description: "Should find: bundler issues, build pipeline, transpile errors",
    },
    {
      query: "fix authentication bugs login problems",
      description: "Should find: auth flow, credential issues, session problems",
    },
    {
      query: "improve reverie search quality semantic matching",
      description: "Should find: embedding improvements, search refinement, query expansion",
    },
  ];

  for (const test of conceptualTests) {
    console.log("─".repeat(80));
    console.log(`Query: "${test.query}"`);
    console.log(`Expected: ${test.description}\n`);

    const results = await reverieSearchSemantic(codexHome, test.query, {
      limit: 5,
      maxCandidates: 40,
    });

    if (results.length === 0) {
      console.log("  ❌ No results found\n");
      continue;
    }

    console.log(`Found ${results.length} results:\n`);

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const relevance = Math.round(result.relevanceScore * 100);

      console.log(`${i + 1}. ${relevance}% relevance`);

      // Show top excerpts
      if (result.matchingExcerpts.length > 0) {
        const excerpt = result.matchingExcerpts[0];
        const truncated = excerpt.length > 120 ? excerpt.slice(0, 120) + "..." : excerpt;
        console.log(`   "${truncated}"`);
      }

      // Show insights
      if (result.insights.length > 0 && i === 0) {
        console.log(`   Insights:`);
        result.insights.slice(0, 2).forEach((insight, idx) => {
          const truncated = insight.length > 100 ? insight.slice(0, 100) + "..." : insight;
          console.log(`     ${idx + 1}. ${truncated}`);
        });
      }

      console.log();
    }
  }

  console.log("═".repeat(80));
  console.log("\n✨ Multi-Vector Embedding Benefits:");
  console.log("  • Each conversation split into message chunks");
  console.log("  • Best matching chunk determines conversation score");
  console.log("  • Top 3 matching excerpts shown per conversation");
  console.log("  • Multi-topic conversations no longer diluted by averaging");
  console.log("═".repeat(80));
}

testMultiVectorConceptual().catch(console.error);
