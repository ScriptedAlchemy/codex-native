import { fastEmbedInit, reverieIndexSemantic, reverieSearchSemantic } from "@codex-native/sdk";
import os from "node:os";
import path from "node:path";

async function testReverieImprovements() {
  const codexHome = path.join(os.homedir(), ".codex");

  console.log("Testing improved reverie system...\n");

  // Initialize FastEmbed first
  console.log("0. Initializing FastEmbed model...");
  await fastEmbedInit({
    model: "BAAI/bge-large-en-v1.5",
    showDownloadProgress: true,
  });
  console.log("   FastEmbed initialized\n");

  // Test 1: Index conversations with new message-based filtering
  console.log("1. Indexing conversations with improved filtering...");
  const indexStats = await reverieIndexSemantic(codexHome, {
    limit: 20,
    maxCandidates: 50,
  });
  console.log(`   Indexed: ${indexStats.conversationsIndexed} conversations`);
  console.log(`   Embedded: ${indexStats.documentsEmbedded} documents`);
  console.log(`   Batches: ${indexStats.batches}\n`);

  // Test 2: Search with system prompt filtering
  console.log("2. Searching for diff-agent related conversations...");
  const searchResults = await reverieSearchSemantic(
    codexHome,
    "diff-agent logging improvements colorized output",
    {
      limit: 5,
      maxCandidates: 20,
    }
  );

  console.log(`   Found ${searchResults.length} results\n`);

  for (const result of searchResults) {
    console.log(`   Match (${Math.round(result.relevanceScore * 100)}%):`);
    console.log(`     Conversation: ${result.conversation.id}`);
    console.log(`     Insights: ${result.insights.slice(0, 2).join(", ")}`);

    // Check if excerpts contain system prompts (should be filtered out)
    const hasSystemPrompts = result.matchingExcerpts.some(excerpt =>
      excerpt.toLowerCase().includes("agents.md") ||
      excerpt.toLowerCase().includes("<instructions>") ||
      excerpt.toLowerCase().includes("tool output:")
    );

    if (hasSystemPrompts) {
      console.log(`     ⚠️  WARNING: System prompts still present!`);
    } else {
      console.log(`     ✓ Clean excerpts (no system prompts)`);
    }

    if (result.matchingExcerpts.length > 0) {
      console.log(`     Excerpt: ${result.matchingExcerpts[0].slice(0, 100)}...`);
    }
    console.log();
  }

  console.log("Test complete!");
}

testReverieImprovements().catch(console.error);
