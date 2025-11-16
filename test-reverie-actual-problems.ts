import { fastEmbedInit, reverieSearchSemantic } from "@codex-native/sdk";
import os from "node:os";
import path from "node:path";

async function testActualProblems() {
  const codexHome = path.join(os.homedir(), ".codex");

  console.log("=== Testing Reverie with Real Problems We've Faced ===\n");

  await fastEmbedInit({
    model: "BAAI/bge-large-en-v1.5",
    showDownloadProgress: false,
  });

  // Real problems from our conversation - would reverie have helped?
  const problems = [
    {
      problem: "How to fix system prompts appearing in reverie search results",
      query: "reverie search results showing AGENTS.md instructions and environment context instead of conversation",
      expectedHelp: "Should find conversations about filtering and message classification",
    },
    {
      problem: "How to integrate logging with diff-agent",
      query: "diff-agent needs centralized logger with colorized output and scoped messages",
      expectedHelp: "Should find discussions about SDK logger integration",
    },
    {
      problem: "Understanding how conversations are structured in codex-rs",
      query: "conversation storage format TurnItem message types history structure",
      expectedHelp: "Should find protocol documentation or related code reviews",
    },
    {
      problem: "How to initialize FastEmbed before using semantic search",
      query: "FastEmbed not initialized error need to call fastEmbedInit with model configuration",
      expectedHelp: "Should find examples of proper FastEmbed initialization",
    },
  ];

  for (let i = 0; i < problems.length; i++) {
    const { problem, query, expectedHelp } = problems[i];

    console.log(`\n${"━".repeat(100)}`);
    console.log(`Problem ${i + 1}: ${problem}`);
    console.log(`Query: "${query}"`);
    console.log(`Expected Help: ${expectedHelp}`);
    console.log("━".repeat(100));

    const results = await reverieSearchSemantic(codexHome, query, {
      limit: 3,
      maxCandidates: 50,
    });

    if (results.length === 0) {
      console.log("\n❌ NO RESULTS - Reverie would not have helped with this problem\n");
      continue;
    }

    console.log(`\nFound ${results.length} results - let's evaluate if they're helpful:\n`);

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      const relevance = Math.round(result.relevanceScore * 100);

      console.log(`━━━ Result ${j + 1} (${relevance}% relevance) ━━━`);
      console.log(`Conversation: ${result.conversation.id.slice(0, 70)}`);

      // Show full first excerpt to evaluate usefulness
      const excerpt = result.matchingExcerpts[0] || "";
      console.log(`\nExcerpt:\n${excerpt.slice(0, 400)}`);

      // Show insights
      if (result.insights.length > 0) {
        console.log(`\nKey Insights:`);
        result.insights.slice(0, 2).forEach((insight, idx) => {
          const truncated = insight.length > 200 ? insight.slice(0, 200) + "..." : insight;
          console.log(`  ${idx + 1}. ${truncated}`);
        });
      }

      // Manually assess: would this have helped?
      console.log(`\n📊 Manual Assessment:`);
      const allContent = [...result.insights, ...result.matchingExcerpts].join(" ").toLowerCase();

      // Check for problem-specific indicators
      let helpfulness = "⚠️  Unclear";
      let reason = "";

      if (i === 0) { // System prompts problem
        if (allContent.includes("filter") || allContent.includes("reverie") || allContent.includes("excerpt")) {
          helpfulness = "✅ Helpful";
          reason = "Mentions reverie filtering/excerpts";
        }
      } else if (i === 1) { // Logging integration
        if (allContent.includes("logger") || allContent.includes("scoped") || allContent.includes("diff-agent")) {
          helpfulness = "✅ Helpful";
          reason = "Discusses logger integration";
        }
      } else if (i === 2) { // Conversation structure
        if (allContent.includes("message") || allContent.includes("protocol") || allContent.includes("structure")) {
          helpfulness = "✅ Helpful";
          reason = "Covers message/protocol structure";
        }
      } else if (i === 3) { // FastEmbed init
        if (allContent.includes("fastembed") || allContent.includes("init") || allContent.includes("embed")) {
          helpfulness = "✅ Helpful";
          reason = "Mentions FastEmbed initialization";
        }
      }

      console.log(`  ${helpfulness} - ${reason}`);
      console.log();
    }
  }

  console.log("\n" + "=".repeat(100));
  console.log("VERDICT: Would reverie have helped us solve these problems faster?");
  console.log("=".repeat(100));
}

testActualProblems().catch(console.error);
