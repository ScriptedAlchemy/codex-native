import { fastEmbedInit, reverieSearchSemantic } from "@codex-native/sdk";
import os from "node:os";
import path from "node:path";

async function testSpecificTopics() {
  const codexHome = path.join(os.homedir(), ".codex");

  console.log("=== Testing Specific Conversation Topics ===\n");

  await fastEmbedInit({
    model: "BAAI/bge-large-en-v1.5",
    showDownloadProgress: false,
  });

  // Very specific topics we actually discussed
  const specificQueries = [
    {
      topic: "Reverie System Improvements",
      query: "build_compact_document message filtering extract_text_content classify_message_type",
      expectedTerms: ["message", "filter", "system", "prompt"],
    },
    {
      topic: "Rust Compilation Fixes",
      query: "if let && let collapsed clippy dead_code allow attribute",
      expectedTerms: ["clippy", "warning", "rust"],
    },
    {
      topic: "Thread Logging Integration",
      query: "createThreadLogger asThreadSink ScopedLogger ThreadLoggingSink",
      expectedTerms: ["logger", "thread", "scope"],
    },
    {
      topic: "Diff-Agent Reverie Usage",
      query: "isValidReverieExcerpt deduplicateInsights extractKeySymbols reverie filtering",
      expectedTerms: ["reverie", "excerpt", "filter"],
    },
  ];

  for (const { topic, query, expectedTerms } of specificQueries) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`Topic: ${topic}`);
    console.log(`Query: "${query}"`);
    console.log("=".repeat(80));

    const results = await reverieSearchSemantic(codexHome, query, {
      limit: 5,
      maxCandidates: 40,
    });

    console.log(`Found ${results.length} results\n`);

    for (let i = 0; i < results.length && i < 3; i++) {
      const result = results[i];
      const relevance = Math.round(result.relevanceScore * 100);

      console.log(`Result ${i + 1} (${relevance}% relevance):`);

      // Check for expected terms
      const allText = [...result.insights, ...result.matchingExcerpts].join(" ").toLowerCase();
      const foundTerms = expectedTerms.filter(term => allText.includes(term.toLowerCase()));

      console.log(`  Expected terms found: ${foundTerms.length}/${expectedTerms.length} (${foundTerms.join(", ")})`);

      // Show quality
      const hasJunk = allText.includes("agents.md instructions") || allText.includes("<instructions>");
      console.log(`  Quality: ${hasJunk ? "❌ Has junk" : "✅ Clean"}`);

      // Show snippet
      const snippet = result.matchingExcerpts[0]?.slice(0, 150) || result.insights[0]?.slice(0, 150) || "";
      console.log(`  Snippet: ${snippet.replace(/\n/g, " ")}...`);
      console.log();
    }
  }

  console.log("=".repeat(80));
  console.log("Validation Summary:");
  console.log("- Testing if reverie can find specific technical discussions");
  console.log("- Checking if message-based filtering preserves searchability");
  console.log("- Verifying no system prompts leak into results");
  console.log("=".repeat(80));
}

testSpecificTopics().catch(console.error);
