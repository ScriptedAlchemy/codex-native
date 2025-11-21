import { fastEmbedInit, reverieSearchSemantic } from "@codex-native/sdk";
import os from "node:os";
import path from "path";

async function testComprehensiveRealWorld() {
  const codexHome = path.join(os.homedir(), ".codex");

  console.log("=== Comprehensive Real-World Reverie Test ===\n");

  await fastEmbedInit({
    model: "BAAI/bge-large-en-v1.5",
    showDownloadProgress: false,
  });

  // Real user queries extracted from conversation history
  const realWorldQueries = [
    // Error/Bug Fixing (common pattern)
    {
      category: "Error Messages",
      query: "fix lint errors in package not in flight plugin ignore errors",
      expectedTerms: ["lint", "error", "fix"],
    },
    {
      category: "Build Errors",
      query: "webpack compiled with warnings jsxDEV not found react module has no exports",
      expectedTerms: ["webpack", "warning", "react"],
    },
    {
      category: "CI/Test Failures",
      query: "check ci issues fix whatever CI is complaining about failing tests",
      expectedTerms: ["ci", "test", "fail"],
    },

    // Command Usage
    {
      category: "Build Commands",
      query: "run pnpm build pnpm test fix any test errors dont edit typescript submodule",
      expectedTerms: ["pnpm", "build", "test"],
    },
    {
      category: "Git Commands",
      query: "git reset hard checkout main branch pull latest remote",
      expectedTerms: ["git", "checkout", "branch"],
    },
    {
      category: "Package Management",
      query: "run pnpm install after pulling latest remote main branch",
      expectedTerms: ["pnpm", "install"],
    },

    // Questions/Understanding
    {
      category: "How Questions",
      query: "how does message classification work in codex protocol TurnItem structure",
      expectedTerms: ["message", "protocol"],
    },
    {
      category: "Why Questions",
      query: "why make const exposesOption instead of just using options.exposes directly",
      expectedTerms: ["const", "options"],
    },
    {
      category: "What Questions",
      query: "what are the lint warnings in nextjs-mf package report all errors",
      expectedTerms: ["lint", "warning"],
    },

    // Implementation/Feature Requests
    {
      category: "Feature Implementation",
      query: "implement centralized logger with colorized output and scoped messages for diff-agent",
      expectedTerms: ["implement", "logger", "diff-agent"],
    },
    {
      category: "Architecture Design",
      query: "design message-based chunking architecture for reverie semantic search embeddings",
      expectedTerms: ["design", "architecture", "reverie"],
    },
    {
      category: "Optimization",
      query: "optimize performance slow query response cache embeddings for faster search",
      expectedTerms: ["optimize", "performance", "cache"],
    },

    // Configuration/Setup
    {
      category: "Configuration",
      query: "update eslint config to allow underscore unused params exclude flight files",
      expectedTerms: ["eslint", "config"],
    },
    {
      category: "Dependencies",
      query: "add stop-words rust-stemmers to Cargo.toml for text processing",
      expectedTerms: ["cargo", "toml"],
    },

    // Debugging/Investigation
    {
      category: "Debugging",
      query: "debug trace log why FastEmbed not initialized need to call fastEmbedInit",
      expectedTerms: ["debug", "fastembed"],
    },
    {
      category: "Investigation",
      query: "research how other rust crates handle stop words text normalization",
      expectedTerms: ["research", "rust"],
    },
  ];

  let successfulQueries = 0;
  let totalQueries = realWorldQueries.length;

  for (const { category, query, expectedTerms } of realWorldQueries) {
    console.log(`\n${"━".repeat(90)}`);
    console.log(`Category: ${category}`);
    console.log(`Query: "${query.slice(0, 80)}${query.length > 80 ? "..." : ""}"`);
    console.log("━".repeat(90));

    try {
      const results = await reverieSearchSemantic(codexHome, query, {
        limit: 3,
        maxCandidates: 30,
      });

      if (results.length === 0) {
        console.log("  ❌ No results found");
        continue;
      }

      const topResult = results[0];
      const topRelevance = Math.round(topResult.relevanceScore * 100);

      console.log(`  Found ${results.length} results (top: ${topRelevance}% relevance)`);

      // Check if top result contains expected terms
      const resultText = [...topResult.insights, ...topResult.matchingExcerpts]
        .join(" ")
        .toLowerCase();

      const matchedTerms = expectedTerms.filter(term =>
        resultText.includes(term.toLowerCase())
      );

      const matchRatio = matchedTerms.length / expectedTerms.length;
      const isSuccessful = matchRatio >= 0.5 || topRelevance >= 60;

      if (isSuccessful) {
        successfulQueries++;
        console.log(`  ✅ Success (${matchedTerms.length}/${expectedTerms.length} terms matched)`);
      } else {
        console.log(`  ⚠️  Weak match (${matchedTerms.length}/${expectedTerms.length} terms matched)`);
      }

      // Show snippet
      const snippet = topResult.matchingExcerpts[0] || topResult.insights[0] || "";
      if (snippet) {
        console.log(`  Snippet: ${snippet.slice(0, 100)}...`);
      }
    } catch (error) {
      console.log(`  ❌ Error: ${error}`);
    }
  }

  console.log("\n" + "=".repeat(90));
  console.log(`RESULTS: ${successfulQueries}/${totalQueries} queries successful`);
  console.log(`Success Rate: ${Math.round((successfulQueries / totalQueries) * 100)}%`);
  console.log("=".repeat(90));

  // Performance rating
  const successRate = (successfulQueries / totalQueries) * 100;
  let rating;
  if (successRate >= 80) rating = "🏆 Excellent";
  else if (successRate >= 65) rating = "✅ Good";
  else if (successRate >= 50) rating = "⚠️  Fair";
  else rating = "❌ Needs Improvement";

  console.log(`\nOverall Performance: ${rating}`);
}

testComprehensiveRealWorld().catch(console.error);
