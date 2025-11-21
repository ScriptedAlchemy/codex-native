import { fastEmbedInit, reverieSearchSemantic } from "@codex-native/sdk";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

async function testConversationContextSearch() {
  const codexHome = path.join(os.homedir(), ".codex");

  console.log("=== Testing Conversation-Context Search ===\n");

  await fastEmbedInit({
    model: "BAAI/bge-large-en-v1.5",
    showDownloadProgress: false,
  });

  // Simulate extracting blocks from current conversation
  // (This would normally come from the active conversation)
  const currentConversationBlocks = [
    "is reverie system working effectively or how can it be smarter",
    "embeddings should be chunked by message with zoom outs to conversation",
    "improve search quality add stemming n-grams and better scoring",
    "no hardcoded filters should be fully dynamic and open ended filtering"
  ];

  // Build composite query from conversation blocks
  // Weight recent messages higher
  const weightedBlocks = currentConversationBlocks.map((block, idx) => {
    const recencyWeight = (idx + 1) / currentConversationBlocks.length;
    return { text: block, weight: recencyWeight };
  });

  // Sort by weight and take top blocks
  weightedBlocks.sort((a, b) => b.weight - a.weight);
  const topBlocks = weightedBlocks.slice(0, 3).map(b => b.text);

  // Join into composite query
  const compositeQuery = topBlocks.join(" ");

  console.log("Current conversation context:");
  currentConversationBlocks.forEach((block, i) => {
    console.log(`  ${i + 1}. ${block.slice(0, 80)}...`);
  });

  console.log(`\nComposite query (from recent blocks):`);
  console.log(`  "${compositeQuery.slice(0, 150)}..."\n`);

  console.log("Searching for similar past conversations using semantic search...\n");

  const results = await reverieSearchSemantic(
    codexHome,
    compositeQuery,
    {
      limit: 5,
      maxCandidates: 40,
    }
  );

  console.log(`Found ${results.length} similar conversations:\n`);

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const relevance = Math.round(result.relevanceScore * 100);

    console.log(`━━━ Match ${i + 1} (${relevance}% relevance) ━━━`);
    console.log(`Conversation: ${result.conversation.id.slice(0, 50)}...`);

    // Show TOON-formatted insights
    if (result.insights.length > 0) {
      console.log(`Insights (TOON-formatted):`);
      result.insights.slice(0, 2).forEach((insight, idx) => {
        const truncated = insight.length > 120 ? insight.slice(0, 120) + "..." : insight;
        console.log(`  ${idx + 1}. ${truncated}`);
      });
    }

    // Show matching excerpts
    if (result.matchingExcerpts.length > 0) {
      const excerpt = result.matchingExcerpts[0];
      const truncated = excerpt.length > 150 ? excerpt.slice(0, 150) + "..." : excerpt;
      console.log(`Excerpt: ${truncated}`);
    }

    console.log();
  }

  console.log("═".repeat(80));
  console.log("This demonstrates conversation-to-conversation search:");
  console.log("- Extracts meaningful blocks from current conversation");
  console.log("- Builds weighted composite query");
  console.log("- Uses semantic search with TOON insights");
  console.log("- Finds similar past work automatically");
  console.log("═".repeat(80));
}

testConversationContextSearch().catch(console.error);
