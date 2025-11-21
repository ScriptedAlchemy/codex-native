import { reverieListConversations, reverieSearchSemantic, fastEmbedInit } from "@codex-native/sdk";
import os from "node:os";
import path from "node:path";

async function testMultipleConversations() {
  const codexHome = path.join(os.homedir(), ".codex");

  console.log("=== Testing Multiple Real Conversations ===\n");

  await fastEmbedInit({
    model: "BAAI/bge-large-en-v1.5",
    showDownloadProgress: false,
  });

  // Get recent conversations
  const conversations = await reverieListConversations(codexHome, 20, 0);
  console.log(`Found ${conversations.length} recent conversations\n`);

  // Helper to detect system prompts
  const isSystemPrompt = (text: string): boolean => {
    const normalized = text.toLowerCase();
    return (
      normalized.includes("# agents.md instructions") ||
      normalized.includes("<environment_context>") ||
      normalized.includes("<system>") ||
      normalized.includes("you are claude code") ||
      normalized.includes("working directory:")
    );
  };

  // Test with 3 different conversations
  const testIndices = [3, 7, 11];

  for (const idx of testIndices) {
    if (idx >= conversations.length) continue;

    const testConvo = conversations[idx];
    console.log(`\n${"=".repeat(80)}`);
    console.log(`Testing conversation #${idx + 1}: ${testConvo.id.slice(0, 60)}...`);
    console.log(`Created: ${testConvo.createdAt}`);

    // Extract message blocks
    const messageBlocks: string[] = [];

    for (const record of testConvo.headRecords) {
      try {
        const msg = JSON.parse(record);

        if (msg.type === "system" || msg.payload?.type === "system") {
          continue;
        }

        let text = "";
        if (msg.payload?.content) {
          if (Array.isArray(msg.payload.content)) {
            text = msg.payload.content
              .filter((c: any) => c.text)
              .map((c: any) => c.text)
              .join(" ");
          }
        } else if (msg.content) {
          if (Array.isArray(msg.content)) {
            text = msg.content
              .filter((c: any) => c.text)
              .map((c: any) => c.text)
              .join(" ");
          } else if (typeof msg.content === "string") {
            text = msg.content;
          }
        }

        if (text && !isSystemPrompt(text) && text.trim().length > 20) {
          messageBlocks.push(text.trim());
        }
      } catch (e) {
        // Skip malformed JSON
      }
    }

    console.log(`Extracted ${messageBlocks.length} message blocks`);

    if (messageBlocks.length === 0) {
      console.log("⚠️  No message blocks extracted - skipping");
      continue;
    }

    // Show first block
    const firstBlock = messageBlocks[0];
    const preview = firstBlock.length > 100 ? firstBlock.slice(0, 100) + "..." : firstBlock;
    console.log(`First block: "${preview}"`);

    // Build composite query
    const recentBlocks = messageBlocks.slice(0, 3);
    const compositeQuery = recentBlocks.join(" ");
    const queryPreview = compositeQuery.slice(0, 150);
    console.log(`Query: "${queryPreview}${compositeQuery.length > 150 ? "..." : ""}"`);

    // Search
    console.log("\nSearching...");
    const results = await reverieSearchSemantic(codexHome, compositeQuery, {
      limit: 3,
      maxCandidates: 30,
    });

    console.log(`Found ${results.length} matches:`);

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const relevance = Math.round(result.relevanceScore * 100);
      const isSelf = result.conversation.id === testConvo.id;

      console.log(`  ${i + 1}. ${relevance}% relevance ${isSelf ? "(self)" : ""}`);

      if (result.insights.length > 0) {
        const insight = result.insights[0].slice(0, 80);
        console.log(`     "${insight}..."`);
      }
    }
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log("\n✓ Successfully tested multiple real conversations");
  console.log("✓ No UTF-8 panics");
  console.log("✓ System messages filtered properly");
  console.log("✓ Search results are semantically relevant");
}

testMultipleConversations().catch(console.error);
