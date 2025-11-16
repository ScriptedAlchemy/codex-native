#!/usr/bin/env tsx
import { reverieSearchSemantic, fastEmbedInit } from "@codex-native/sdk";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

/**
 * Test hypothesis: Reasoning-to-reasoning matching finds better conceptual similarity
 * because LLM-generated reasoning uses more consistent vocabulary and patterns.
 */

async function testReasoningSimilarity() {
  const codexHome = path.join(os.homedir(), ".codex");

  console.log("=== Testing Reasoning-Only Semantic Search ===\n");

  await fastEmbedInit({
    model: "BAAI/bge-large-en-v1.5",
    showDownloadProgress: false,
  });

  // Test queries that should match based on problem-solving approach
  const conceptualTests = [
    {
      query: "analyze codebase structure to understand how feature works before implementing",
      description: "Should find: conversations where LLM reasoned about exploring code first",
    },
    {
      query: "break down complex task into smaller sequential steps",
      description: "Should find: conversations with step-by-step planning reasoning",
    },
    {
      query: "need to read file first before editing to understand context",
      description: "Should find: conversations where LLM reasoned about reading before modifying",
    },
    {
      query: "should use specialized tool instead of bash command for better results",
      description: "Should find: conversations about choosing appropriate tools",
    },
  ];

  for (const test of conceptualTests) {
    console.log("─".repeat(80));
    console.log(`Query: "${test.query}"`);
    console.log(`Expected: ${test.description}\n`);

    // Standard search (all content)
    const standardResults = await reverieSearchSemantic(codexHome, test.query, {
      limit: 3,
      maxCandidates: 40,
    });

    console.log("📊 Standard Search (All Content):");
    if (standardResults.length === 0) {
      console.log("  ❌ No results\n");
    } else {
      for (let i = 0; i < standardResults.length; i++) {
        const result = standardResults[i];
        const relevance = Math.round(result.relevanceScore * 100);
        console.log(`  ${i + 1}. ${relevance}% - ${result.conversationId.slice(0, 50)}`);
        
        if (result.matchingExcerpts.length > 0) {
          const excerpt = result.matchingExcerpts[0];
          const truncated = excerpt.length > 100 ? excerpt.slice(0, 100) + "..." : excerpt;
          console.log(`     "${truncated}"`);
        }
      }
      console.log();
    }

    // Now let's manually analyze reasoning content
    console.log("🧠 Reasoning-Only Analysis:");
    const reasoningAnalysis = await analyzeReasoningContent(codexHome, test.query);
    
    console.log(`  Found ${reasoningAnalysis.conversationsWithReasoning} conversations with reasoning tokens`);
    console.log(`  Top reasoning matches:`);
    
    for (let i = 0; i < Math.min(3, reasoningAnalysis.topMatches.length); i++) {
      const match = reasoningAnalysis.topMatches[i];
      console.log(`  ${i + 1}. ${Math.round(match.score * 100)}% - ${match.conversationId.slice(0, 50)}`);
      console.log(`     Reasoning excerpt: "${match.reasoningExcerpt}"`);
    }
    console.log();
  }

  console.log("═".repeat(80));
  console.log("\n✨ Reasoning-Only Search Benefits:");
  console.log("  • LLM reasoning uses consistent vocabulary");
  console.log("  • Captures problem-solving approach, not just topic");
  console.log("  • Filters out noise from user messages and tool output");
  console.log("  • Shows how LLM thought about similar problems");
  console.log("═".repeat(80));
}

async function analyzeReasoningContent(
  codexHome: string,
  query: string
): Promise<{
  conversationsWithReasoning: number;
  topMatches: Array<{
    conversationId: string;
    score: number;
    reasoningExcerpt: string;
  }>;
}> {
  // Load recent conversations and extract reasoning
  const conversationsDir = path.join(codexHome, "sessions");
  const conversations = await findRecentConversations(conversationsDir, 50);

  const reasoningMatches: Array<{
    conversationId: string;
    reasoningText: string;
  }> = [];

  for (const convPath of conversations) {
    const reasoning = await extractReasoningTokens(convPath);
    if (reasoning.length > 100) {
      // Only include conversations with substantial reasoning
      reasoningMatches.push({
        conversationId: path.basename(convPath, ".jsonl"),
        reasoningText: reasoning,
      });
    }
  }

  if (reasoningMatches.length === 0) {
    return {
      conversationsWithReasoning: 0,
      topMatches: [],
    };
  }

  // Embed query and reasoning texts
  const { fastEmbedEmbed } = await import("@codex-native/sdk");
  
  const allTexts = [query, ...reasoningMatches.map(m => m.reasoningText)];
  const embeddings = await fastEmbedEmbed({
    inputs: allTexts,
    normalize: true,
    cache: true,
    batchSize: 32,
  });

  const queryEmbed = embeddings[0];
  const docEmbeds = embeddings.slice(1);

  // Compute similarities
  const scored = reasoningMatches.map((match, idx) => {
    const similarity = cosineSimilarity(queryEmbed, docEmbeds[idx]);
    return {
      conversationId: match.conversationId,
      score: similarity,
      reasoningExcerpt: match.reasoningText.slice(0, 150).replace(/\s+/g, " ") + "...",
    };
  });

  scored.sort((a, b) => b.score - a.score);

  return {
    conversationsWithReasoning: reasoningMatches.length,
    topMatches: scored,
  };
}

async function findRecentConversations(
  sessionsDir: string,
  limit: number
): Promise<string[]> {
  const conversations: Array<{ path: string; mtime: number }> = [];

  try {
    const years = await fs.readdir(sessionsDir);
    
    for (const year of years) {
      if (!/^\d{4}$/.test(year)) continue;
      
      const yearPath = path.join(sessionsDir, year);
      const months = await fs.readdir(yearPath);
      
      for (const month of months) {
        if (!/^\d{2}$/.test(month)) continue;
        
        const monthPath = path.join(yearPath, month);
        const days = await fs.readdir(monthPath);
        
        for (const day of days) {
          if (!/^\d{2}$/.test(day)) continue;
          
          const dayPath = path.join(monthPath, day);
          const files = await fs.readdir(dayPath);
          
          for (const file of files) {
            if (!file.endsWith(".jsonl")) continue;
            
            const filePath = path.join(dayPath, file);
            const stats = await fs.stat(filePath);
            conversations.push({
              path: filePath,
              mtime: stats.mtimeMs,
            });
          }
        }
      }
    }
  } catch (error) {
    console.warn("Error reading conversations:", error);
  }

  // Sort by modification time, most recent first
  conversations.sort((a, b) => b.mtime - a.mtime);
  
  return conversations.slice(0, limit).map(c => c.path);
}

async function extractReasoningTokens(conversationPath: string): Promise<string> {
  try {
    const content = await fs.readFile(conversationPath, "utf-8");
    const lines = content.split("\n").filter(line => line.trim());
    
    const reasoningBlocks: string[] = [];
    
    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        
        // Look for reasoning in message content
        if (record.type === "message") {
          const content = record.message?.content;
          if (typeof content === "string") {
            // Extract 