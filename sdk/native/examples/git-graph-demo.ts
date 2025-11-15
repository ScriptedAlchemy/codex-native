#!/usr/bin/env node

/**
 * Git-style Graph Renderer Demo
 *
 * Demonstrates various graph patterns using the GitGraphRenderer,
 * similar to what you'd see with `git log --graph`.
 *
 * Run with: npx tsx examples/git-graph-demo.ts
 */

import { GitGraphRenderer, GraphNode } from "../src/gitGraphRenderer.js";

function demo1_linearHistory() {
  console.log("\n📊 Demo 1: Linear History");
  console.log("==========================\n");

  const graph = new GitGraphRenderer({ showLabels: true });

  // Simple linear history
  graph.addNode({ id: "1", label: "Initial commit" });
  graph.addNode({ id: "2", label: "Add feature A", parents: ["1"] });
  graph.addNode({ id: "3", label: "Fix bug in feature A", parents: ["2"] });
  graph.addNode({ id: "4", label: "Add documentation", parents: ["3"] });
  graph.addNode({ id: "5", label: "Update tests", parents: ["4"] });

  console.log(graph.render());
}

function demo2_simpleBranch() {
  console.log("\n📊 Demo 2: Simple Branch and Merge");
  console.log("====================================\n");

  const graph = new GitGraphRenderer({ showLabels: true });

  // Main branch
  graph.addNode({ id: "m1", label: "Initial commit" });
  graph.addNode({ id: "m2", label: "Main: Add core feature", parents: ["m1"] });

  // Feature branch
  graph.addNode({ id: "f1", label: "Feature: Start new feature", parents: ["m1"] });
  graph.addNode({ id: "f2", label: "Feature: Complete feature", parents: ["f1"] });

  // Merge back to main
  graph.addNode({ id: "m3", label: "Merge feature into main", parents: ["m2", "f2"] });
  graph.addNode({ id: "m4", label: "Main: Continue development", parents: ["m3"] });

  console.log(graph.render());
}

function demo3_complexBranching() {
  console.log("\n📊 Demo 3: Complex Branching");
  console.log("==============================\n");

  const graph = new GitGraphRenderer({ showLabels: true, style: "unicode" });

  // Main branch
  graph.addNode({ id: "main1", label: "🚀 Initial release" });
  graph.addNode({ id: "main2", label: "📝 Update README", parents: ["main1"] });

  // Feature branch 1
  graph.addNode({ id: "feat1-1", label: "✨ Feature 1: Start", parents: ["main1"] });
  graph.addNode({ id: "feat1-2", label: "✨ Feature 1: Add tests", parents: ["feat1-1"] });
  graph.addNode({ id: "feat1-3", label: "✨ Feature 1: Complete", parents: ["feat1-2"] });

  // Feature branch 2 (from main2)
  graph.addNode({ id: "feat2-1", label: "🔧 Feature 2: Config", parents: ["main2"] });
  graph.addNode({ id: "feat2-2", label: "🔧 Feature 2: Implementation", parents: ["feat2-1"] });

  // Hotfix branch
  graph.addNode({ id: "hotfix1", label: "🐛 Hotfix: Critical bug", parents: ["main2"] });

  // Merges
  graph.addNode({ id: "main3", label: "🔀 Merge hotfix", parents: ["main2", "hotfix1"] });
  graph.addNode({ id: "main4", label: "🔀 Merge feature 1", parents: ["main3", "feat1-3"] });
  graph.addNode({ id: "main5", label: "🔀 Merge feature 2", parents: ["main4", "feat2-2"] });
  graph.addNode({ id: "main6", label: "🎉 Release v2.0", parents: ["main5"] });

  console.log(graph.render());
}

function demo4_parallelDevelopment() {
  console.log("\n📊 Demo 4: Parallel Development (Multiple Teams)");
  console.log("==================================================\n");

  const graph = new GitGraphRenderer({ showLabels: true });

  // Main trunk
  graph.addNode({ id: "trunk", label: "Production release v1.0" });

  // Team A branch
  graph.addNode({ id: "teamA-1", label: "Team A: Database refactor", parents: ["trunk"] });
  graph.addNode({ id: "teamA-2", label: "Team A: Add migrations", parents: ["teamA-1"] });
  graph.addNode({ id: "teamA-3", label: "Team A: Performance optimizations", parents: ["teamA-2"] });

  // Team B branch
  graph.addNode({ id: "teamB-1", label: "Team B: New API endpoints", parents: ["trunk"] });
  graph.addNode({ id: "teamB-2", label: "Team B: API documentation", parents: ["teamB-1"] });
  graph.addNode({ id: "teamB-3", label: "Team B: Integration tests", parents: ["teamB-2"] });

  // Team C branch (starts from Team A's work)
  graph.addNode({ id: "teamC-1", label: "Team C: UI redesign", parents: ["teamA-1"] });
  graph.addNode({ id: "teamC-2", label: "Team C: Add dark mode", parents: ["teamC-1"] });

  // Integration branch
  graph.addNode({ id: "int-1", label: "Integration: Merge Team A", parents: ["trunk", "teamA-3"] });
  graph.addNode({ id: "int-2", label: "Integration: Merge Team B", parents: ["int-1", "teamB-3"] });
  graph.addNode({ id: "int-3", label: "Integration: Merge Team C", parents: ["int-2", "teamC-2"] });
  graph.addNode({ id: "trunk2", label: "Production release v2.0", parents: ["int-3"] });

  console.log(graph.render());
}

function demo5_agentWorkflow() {
  console.log("\n📊 Demo 5: Multi-Agent Workflow");
  console.log("=================================\n");

  const graph = new GitGraphRenderer({
    showLabels: true,
    style: "unicode",
    maxLabelWidth: 50
  });

  // Coordinator
  graph.addNode({ id: "coord-1", label: "🎯 Coordinator: Initialize workflow" });
  graph.addNode({ id: "coord-2", label: "🎯 Coordinator: Analyze requirements", parents: ["coord-1"] });

  // Spawn multiple agents
  graph.addNode({ id: "agent1-1", label: "🤖 Agent 1: Code analysis", parents: ["coord-2"] });
  graph.addNode({ id: "agent2-1", label: "🔍 Agent 2: Security scan", parents: ["coord-2"] });
  graph.addNode({ id: "agent3-1", label: "📊 Agent 3: Performance check", parents: ["coord-2"] });

  // Agents continue work
  graph.addNode({ id: "agent1-2", label: "🤖 Agent 1: Generate fixes", parents: ["agent1-1"] });
  graph.addNode({ id: "agent1-3", label: "🤖 Agent 1: Apply patches", parents: ["agent1-2"] });

  graph.addNode({ id: "agent2-2", label: "🔍 Agent 2: Vulnerability found", parents: ["agent2-1"] });
  graph.addNode({ id: "agent2-3", label: "🔍 Agent 2: Apply security patch", parents: ["agent2-2"] });

  graph.addNode({ id: "agent3-2", label: "📊 Agent 3: Bottleneck detected", parents: ["agent3-1"] });
  graph.addNode({ id: "agent3-3", label: "📊 Agent 3: Optimize algorithm", parents: ["agent3-2"] });

  // Merge results back to coordinator
  graph.addNode({ id: "coord-3", label: "🎯 Coordinator: Collect Agent 1 results", parents: ["coord-2", "agent1-3"] });
  graph.addNode({ id: "coord-4", label: "🎯 Coordinator: Collect Agent 2 results", parents: ["coord-3", "agent2-3"] });
  graph.addNode({ id: "coord-5", label: "🎯 Coordinator: Collect Agent 3 results", parents: ["coord-4", "agent3-3"] });
  graph.addNode({ id: "coord-6", label: "✅ Coordinator: Workflow complete", parents: ["coord-5"] });

  console.log(graph.render());

  const stats = graph.getStats();
  console.log(`\n📈 Stats: ${stats.nodes} nodes, ${stats.edges} edges, ${stats.maxColumn + 1} columns used`);
}

function demo6_gitFlowPattern() {
  console.log("\n📊 Demo 6: Git Flow Pattern");
  console.log("=============================\n");

  const graph = new GitGraphRenderer({
    showLabels: true,
    compact: true  // Compact mode for cleaner output
  });

  // Master branch
  graph.addNode({ id: "master-1", label: "master: v1.0.0" });

  // Develop branch
  graph.addNode({ id: "develop-1", label: "develop: Start v1.1", parents: ["master-1"] });

  // Feature branches
  graph.addNode({ id: "feature1-1", label: "feature/auth: Start", parents: ["develop-1"] });
  graph.addNode({ id: "feature1-2", label: "feature/auth: Add OAuth", parents: ["feature1-1"] });
  graph.addNode({ id: "feature1-3", label: "feature/auth: Complete", parents: ["feature1-2"] });

  graph.addNode({ id: "feature2-1", label: "feature/api: Start", parents: ["develop-1"] });
  graph.addNode({ id: "feature2-2", label: "feature/api: REST endpoints", parents: ["feature2-1"] });

  // Merge features back to develop
  graph.addNode({ id: "develop-2", label: "develop: Merge auth", parents: ["develop-1", "feature1-3"] });
  graph.addNode({ id: "develop-3", label: "develop: Merge api", parents: ["develop-2", "feature2-2"] });

  // Release branch
  graph.addNode({ id: "release-1", label: "release/1.1: Start", parents: ["develop-3"] });
  graph.addNode({ id: "release-2", label: "release/1.1: Fix bug", parents: ["release-1"] });
  graph.addNode({ id: "release-3", label: "release/1.1: Ready", parents: ["release-2"] });

  // Merge to master and back to develop
  graph.addNode({ id: "master-2", label: "master: v1.1.0", parents: ["master-1", "release-3"] });
  graph.addNode({ id: "develop-4", label: "develop: Sync from release", parents: ["develop-3", "release-3"] });

  // Hotfix
  graph.addNode({ id: "hotfix-1", label: "hotfix/1.1.1: Critical fix", parents: ["master-2"] });
  graph.addNode({ id: "master-3", label: "master: v1.1.1", parents: ["master-2", "hotfix-1"] });
  graph.addNode({ id: "develop-5", label: "develop: Merge hotfix", parents: ["develop-4", "hotfix-1"] });

  console.log(graph.render());
}

// Run all demos
function main() {
  console.log("🎨 Git-style Graph Renderer Demonstrations");
  console.log("==========================================");

  demo1_linearHistory();
  demo2_simpleBranch();
  demo3_complexBranching();
  demo4_parallelDevelopment();
  demo5_agentWorkflow();
  demo6_gitFlowPattern();

  console.log("\n✨ Demos complete!");
  console.log("\nThese visualizations can be used for:");
  console.log("• Git commit history");
  console.log("• Agent execution workflows");
  console.log("• Dependency graphs");
  console.log("• Process flow diagrams");
  console.log("• Any directed acyclic graph (DAG) visualization");
}

main();