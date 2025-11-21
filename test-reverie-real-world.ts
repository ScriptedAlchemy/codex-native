import { fastEmbedInit, reverieSearchSemantic } from "@codex-native/sdk";
import os from "node:os";
import path from "node:path";

async function testRealWorldReverie() {
  const codexHome = path.join(os.homedir(), ".codex");

  console.log("=== Real-World Reverie Validation ===\n");

  await fastEmbedInit({
    model: "BAAI/bge-large-en-v1.5",
    showDownloadProgress: false,
  });

  // Real queries from our conversation history
  const realWorldQueries = [
    // Topic: FastEmbed initialization issues
    {
      query: "FastEmbed not initialized error when running semantic search",
      context: "We encountered this when testing reverie before adding fastEmbedInit",
    },
    // Topic: Message chunking architecture
    {
      query: "TurnItem enum UserMessage AgentMessage protocol structures",
      context: "We explored codex-rs protocol to understand message types",
    },
    // Topic: Clippy warnings and Rust patterns
    {
      query: "nested if-let clippy warning collapsed pattern matching",
      context: "We fixed clippy warnings about nested if-let statements",
    },
    // Topic: Build and compilation
    {
      query: "pnpm build recursive packages SDK compilation",
      context: "We ran builds across all packages to test changes",
    },
    // Topic: Reverie filtering improvements
    {
      query: "system prompts AGENTS.md filtering message classification",
      context: "The main improvement we implemented",
    },
  ];

  for (let i = 0; i < realWorldQueries.length; i++) {
    const { query, context } = realWorldQueries[i];

    console.log(`\n${"━".repeat(80)}`);
    console.log(`Query ${i + 1}: "${query}"`);
    console.log(`Context: ${context}`);
    console.log("━".repeat(80));

    const results = await reverieSearchSemantic(codexHome, query, {
      limit: 3,
      maxCandidates: 30,
    });

    if (results.length === 0) {
      console.log("   ⚠️  No results found");
      continue;
    }

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      const relevance = Math.round(result.relevanceScore * 100);

      console.log(`\n   Result ${j + 1} (${relevance}% relevance):`);
      console.log(`     ID: ${result.conversation.id.slice(0, 60)}...`);

      // Validate quality
      const hasSystemJunk = validateCleanContent(result);
      if (hasSystemJunk) {
        console.log(`     ❌ Contains system prompts/boilerplate`);
      } else {
        console.log(`     ✅ Clean conversational content`);
      }

      // Show best excerpt
      if (result.matchingExcerpts.length > 0) {
        const excerpt = result.matchingExcerpts[0];
        const preview = excerpt.length > 250 ? excerpt.slice(0, 250) + "..." : excerpt;
        console.log(`     Excerpt: ${preview.replace(/\n/g, " ")}`);
      }

      // Check relevance - is this actually about what we searched for?
      const isRelevant = assessRelevance(query, result);
      console.log(`     Relevance check: ${isRelevant ? "✅ Matches query" : "⚠️  May not match"}`);
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("Real-World Validation Complete!");
  console.log("=".repeat(80));
}

function validateCleanContent(result: any): boolean {
  const allText = [...result.insights, ...result.matchingExcerpts].join(" ").toLowerCase();

  return (
    allText.includes("# agents.md instructions") ||
    allText.includes("sandbox env vars") ||
    allText.includes("approval_policy") ||
    allText.includes("<instructions>") ||
    allText.includes("<environment_context>")
  );
}

function assessRelevance(query: string, result: any): boolean {
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 3);
  const resultText = [...result.insights, ...result.matchingExcerpts].join(" ").toLowerCase();

  // Check if at least 2 query terms appear in results
  const matches = queryTerms.filter(term => resultText.includes(term));
  return matches.length >= 2;
}

testRealWorldReverie().catch(console.error);
