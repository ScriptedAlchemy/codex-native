import { fastEmbedInit, reverieIndexSemantic, reverieSearchSemantic } from "@codex-native/sdk";
import os from "node:os";
import path from "node:path";

async function testReverieComprehensive() {
  const codexHome = path.join(os.homedir(), ".codex");

  console.log("=== Comprehensive Reverie Test ===\n");

  // Initialize FastEmbed
  console.log("1. Initializing FastEmbed...");
  await fastEmbedInit({
    model: "BAAI/bge-large-en-v1.5",
    showDownloadProgress: true,
  });
  console.log("   ✓ FastEmbed initialized\n");

  // Index ALL conversations (no limit)
  console.log("2. Indexing ALL conversations...");
  const indexStats = await reverieIndexSemantic(codexHome, {
    limit: undefined,  // No limit - index everything
    maxCandidates: 200,  // High candidate count for comprehensive indexing
  });
  console.log(`   Indexed: ${indexStats.conversationsIndexed} conversations`);
  console.log(`   Embedded: ${indexStats.documentsEmbedded} documents`);
  console.log(`   Batches: ${indexStats.batches}\n`);

  // Test multiple search queries
  const searchQueries = [
    "diff-agent logging improvements colorized output",
    "reverie semantic search filtering system prompts",
    "message-based chunking embeddings",
    "thread logging scoped logger",
  ];

  for (const query of searchQueries) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`3. Searching: "${query}"`);
    console.log("=".repeat(80));

    const searchResults = await reverieSearchSemantic(
      codexHome,
      query,
      {
        limit: 3,
        maxCandidates: 50,
      }
    );

    console.log(`   Found ${searchResults.length} results\n`);

    for (let i = 0; i < searchResults.length; i++) {
      const result = searchResults[i];
      console.log(`   Result ${i + 1} (${Math.round(result.relevanceScore * 100)}% relevance):`);
      console.log(`     Conversation ID: ${result.conversation.id}`);

      // Validate content quality
      const validation = validateResult(result);
      console.log(`     Quality Check:`);
      console.log(`       System prompts: ${validation.hasSystemPrompts ? "❌ FOUND" : "✅ NONE"}`);
      console.log(`       Tool outputs: ${validation.hasToolOutputs ? "❌ FOUND" : "✅ NONE"}`);
      console.log(`       AGENTS.md refs: ${validation.hasAgentsMd ? "❌ FOUND" : "✅ NONE"}`);
      console.log(`       Instruction tags: ${validation.hasInstructionTags ? "❌ FOUND" : "✅ NONE"}`);

      // Show first insight (truncated)
      if (result.insights.length > 0) {
        const firstInsight = result.insights[0];
        const truncated = firstInsight.length > 150
          ? firstInsight.slice(0, 150) + "..."
          : firstInsight;
        console.log(`     First insight: ${truncated}`);
      }

      // Show first excerpt (truncated)
      if (result.matchingExcerpts.length > 0) {
        const firstExcerpt = result.matchingExcerpts[0];
        const truncated = firstExcerpt.length > 200
          ? firstExcerpt.slice(0, 200) + "..."
          : firstExcerpt;
        console.log(`     First excerpt: ${truncated}`);
      }

      console.log();
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("Test Complete!");
  console.log("=".repeat(80));
}

interface ValidationResult {
  hasSystemPrompts: boolean;
  hasToolOutputs: boolean;
  hasAgentsMd: boolean;
  hasInstructionTags: boolean;
}

function validateResult(result: any): ValidationResult {
  const allText = [
    ...result.insights,
    ...result.matchingExcerpts,
  ].join(" ").toLowerCase();

  return {
    hasSystemPrompts:
      allText.includes("# agents.md instructions") ||
      allText.includes("agents.md instructions for") ||
      allText.includes("sandbox env vars") ||
      allText.includes("approval_policy") ||
      allText.includes("sandbox_mode"),
    hasToolOutputs:
      allText.includes("tool output:") ||
      allText.includes("command execution") ||
      allText.includes("exit_code"),
    hasAgentsMd:
      allText.includes("agents.md") ||
      allText.includes("agent instructions"),
    hasInstructionTags:
      allText.includes("<instructions>") ||
      allText.includes("<environment_context>") ||
      allText.includes("<system>"),
  };
}

testReverieComprehensive().catch(console.error);
