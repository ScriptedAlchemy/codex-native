import { fastEmbedInit, reverieSearchByConversation } from "@codex-native/sdk";
import os from "node:os";
import path from "node:path";

async function testConversationSearch() {
  const codexHome = path.join(os.homedir(), ".codex");

  console.log("=== Testing Conversation-to-Conversation Search ===\n");

  await fastEmbedInit({
    model: "BAAI/bge-large-en-v1.5",
    showDownloadProgress: false,
  });

  // Simulate a current ongoing conversation about reverie improvements
  const currentConversation = [
    JSON.stringify({
      type: "user",
      content: [{ text: "is reverie system working effectively or how can it be smarter" }]
    }),
    JSON.stringify({
      type: "agent",
      content: [{ text: "Let me analyze the reverie search results. I notice that system prompts and AGENTS.md instructions are appearing in the excerpts instead of actual conversation content." }]
    }),
    JSON.stringify({
      type: "user",
      content: [{ text: "embeddings should be chunked by message. with zoom outs to the conversation for further assessment of results" }]
    }),
    JSON.stringify({
      type: "agent",
      content: [{ text: "I'll implement message-based chunking for reverie. This will filter out system prompts and focus on actual user/agent conversation turns." }]
    }),
    JSON.stringify({
      type: "user",
      content: [{ text: "improve search quality add stemming n-grams and better scoring" }]
    })
  ];

  console.log("Current conversation context:");
  console.log("  - Discussing reverie system effectiveness");
  console.log("  - Message-based chunking architecture");
  console.log("  - Search quality improvements\n");

  console.log("Searching for similar past conversations...\n");

  const results = await reverieSearchByConversation(
    codexHome,
    currentConversation,
    {
      limit: 5,
      maxCandidates: 40,
    }
  );

  console.log(`Found ${results.length} similar past conversations:\n`);

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const relevance = Math.round(result.relevanceScore * 100);

    console.log(`━━━ Match ${i + 1} (${relevance}% relevance) ━━━`);
    console.log(`Conversation: ${result.conversation.id.slice(0, 60)}...`);

    if (result.insights.length > 0) {
      console.log(`Insights:`);
      result.insights.slice(0, 2).forEach((insight, idx) => {
        const truncated = insight.length > 150 ? insight.slice(0, 150) + "..." : insight;
        console.log(`  ${idx + 1}. ${truncated}`);
      });
    }

    if (result.matchingExcerpts.length > 0) {
      const excerpt = result.matchingExcerpts[0];
      const truncated = excerpt.length > 200 ? excerpt.slice(0, 200) + "..." : excerpt;
      console.log(`Excerpt: ${truncated}`);
    }

    console.log();
  }

  console.log("═".repeat(80));
  console.log("This demonstrates how the current conversation automatically finds");
  console.log("relevant past work based on semantic similarity, not keyword matching.");
  console.log("═".repeat(80));
}

testConversationSearch().catch(console.error);
