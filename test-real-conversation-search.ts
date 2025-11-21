import { reverieListConversations, reverieSearchSemantic, fastEmbedInit } from "@codex-native/sdk";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

async function testWithRealConversations() {
  const codexHome = path.join(os.homedir(), ".codex");

  console.log("=== Testing with REAL Past Conversation Blocks ===\n");

  await fastEmbedInit({
    model: "BAAI/bge-large-en-v1.5",
    showDownloadProgress: false,
  });

  // Get real recent conversations
  const conversations = await reverieListConversations(codexHome, 20, 0);
  console.log(`Found ${conversations.length} recent conversations\n`);

  if (conversations.length === 0) {
    console.log("No conversations found!");
    return;
  }

  // Pick a conversation from a few hours ago (not the most recent)
  const testConvo = conversations[Math.min(5, conversations.length - 1)];
  console.log(`Using conversation: ${testConvo.id}`);
  console.log(`Created: ${testConvo.createdAt}`);
  console.log(`Updated: ${testConvo.updatedAt}\n`);

  // Extract real message blocks from this conversation
  const messageBlocks: string[] = [];

  // Helper to detect system prompts
  const isSystemPrompt = (text: string): boolean => {
    const normalized = text.toLowerCase();
    return (
      normalized.includes("# agents.md instructions") ||
      normalized.includes("agents.md instructions for") ||
      normalized.includes("<environment_context>") ||
      normalized.includes("<system>") ||
      normalized.includes("sandbox env vars") ||
      normalized.includes("working directory:") ||
      normalized.includes("today's date:") ||
      normalized.includes("is directory a git repo:") ||
      normalized.includes("you are claude code") ||
      normalized.includes("you are an interactive cli tool") ||
      normalized.includes("available agent types")
    );
  };

  // Parse head records for user/agent messages
  for (const record of testConvo.headRecords) {
    try {
      const msg = JSON.parse(record);

      // Skip system messages by type
      if (msg.type === "system" || msg.payload?.type === "system") {
        continue;
      }

      // Extract text from different message formats
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

      // Skip system prompts based on content
      if (text && isSystemPrompt(text)) {
        continue;
      }

      if (text && text.trim().length > 20) {
        messageBlocks.push(text.trim());
      }
    } catch (e) {
      // Skip malformed JSON
    }
  }

  console.log(`Extracted ${messageBlocks.length} message blocks from conversation:\n`);

  // Show first few blocks
  messageBlocks.slice(0, 5).forEach((block, i) => {
    const preview = block.length > 100 ? block.slice(0, 100) + "..." : block;
    console.log(`  ${i + 1}. ${preview}`);
  });

  if (messageBlocks.length === 0) {
    console.log("No message blocks extracted!");
    return;
  }

  // Build composite query from most recent blocks
  const recentBlocks = messageBlocks.slice(-3); // Last 3 messages
  const compositeQuery = recentBlocks.join(" ");

  console.log(`\nComposite query (last 3 message blocks):`);
  console.log(`  "${compositeQuery.slice(0, 200)}..."\n`);

  console.log("Searching for similar conversations...\n");

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
    console.log(`Conversation: ${result.conversation.id}`);

    if (result.conversation.id === testConvo.id) {
      console.log(`  ⚠️  (This is the source conversation - expected to match)`);
    }

    if (result.insights.length > 0) {
      console.log(`Insights:`);
      result.insights.slice(0, 2).forEach((insight, idx) => {
        const truncated = insight.length > 120 ? insight.slice(0, 120) + "..." : insight;
        console.log(`  ${idx + 1}. ${truncated}`);
      });
    }

    console.log();
  }

  console.log("═".repeat(80));
  console.log("VERIFICATION:");
  console.log(`- Used REAL messages from: ${testConvo.id}`);
  console.log(`- Extracted ${messageBlocks.length} actual message blocks`);
  console.log(`- Built composite query from last 3 blocks`);
  console.log(`- Found ${results.length} semantically similar conversations`);
  console.log("═".repeat(80));
}

testWithRealConversations().catch(console.error);
