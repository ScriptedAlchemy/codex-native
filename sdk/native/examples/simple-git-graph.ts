#!/usr/bin/env node

/**
 * Simple Git Graph Example
 *
 * A simpler demonstration focusing on clean git-style graphs
 *
 * Run with: npx tsx examples/simple-git-graph.ts
 */

import { GitGraphRenderer } from "../src/gitGraphRenderer.js";

function simpleExample() {
  const graph = new GitGraphRenderer({ showLabels: true });

  // Build a simple linear + branch structure
  // This creates the actual parent-child relationships
  graph.addNode({ id: "1", label: "Initial commit" });
  graph.addNode({ id: "2", label: "Add README", parents: ["1"] });
  graph.addNode({ id: "3", label: "Add main feature", parents: ["2"] });

  // Branch off from commit 2
  graph.addNode({ id: "b1", label: "Feature: Start", parents: ["2"] });
  graph.addNode({ id: "b2", label: "Feature: Complete", parents: ["b1"] });

  // Merge back
  graph.addNode({ id: "4", label: "Merge feature", parents: ["3", "b2"] });
  graph.addNode({ id: "5", label: "Final commit", parents: ["4"] });

  console.log("\n📊 Simple Git Graph:");
  console.log("====================\n");
  console.log(graph.render());
}

// More realistic git flow
function gitFlowExample() {
  const graph = new GitGraphRenderer({ showLabels: true, style: 'ascii' });

  // Master/main branch
  graph.addNode({ id: "m1", label: "v1.0.0" });

  // Create develop branch
  graph.addNode({ id: "d1", label: "develop: start", parents: ["m1"] });
  graph.addNode({ id: "d2", label: "develop: base work", parents: ["d1"] });

  // Feature branch 1
  graph.addNode({ id: "f1", label: "feat/auth: init", parents: ["d2"] });
  graph.addNode({ id: "f2", label: "feat/auth: impl", parents: ["f1"] });
  graph.addNode({ id: "f3", label: "feat/auth: tests", parents: ["f2"] });

  // Feature branch 2 (parallel)
  graph.addNode({ id: "g1", label: "feat/api: init", parents: ["d2"] });
  graph.addNode({ id: "g2", label: "feat/api: endpoints", parents: ["g1"] });

  // Merge features back to develop
  graph.addNode({ id: "d3", label: "develop: merge auth", parents: ["d2", "f3"] });
  graph.addNode({ id: "d4", label: "develop: merge api", parents: ["d3", "g2"] });

  // Release branch
  graph.addNode({ id: "r1", label: "release/1.1: prep", parents: ["d4"] });
  graph.addNode({ id: "r2", label: "release/1.1: fix", parents: ["r1"] });

  // Merge to master
  graph.addNode({ id: "m2", label: "v1.1.0", parents: ["m1", "r2"] });

  // Hotfix from master
  graph.addNode({ id: "h1", label: "hotfix: critical", parents: ["m2"] });
  graph.addNode({ id: "m3", label: "v1.1.1", parents: ["m2", "h1"] });

  console.log("\n📊 Git Flow Example:");
  console.log("=====================\n");
  console.log(graph.render());
}

// Agent workflow as a graph
function agentWorkflow() {
  const graph = new GitGraphRenderer({
    showLabels: true,
    style: 'unicode',
    maxLabelWidth: 35
  });

  // Coordinator starts
  graph.addNode({ id: "c1", label: "🎯 Coordinator: Init" });
  graph.addNode({ id: "c2", label: "🎯 Coordinator: Plan", parents: ["c1"] });

  // Spawn three agents
  graph.addNode({ id: "a1", label: "🤖 Agent-1: Start", parents: ["c2"] });
  graph.addNode({ id: "a2", label: "🔍 Agent-2: Start", parents: ["c2"] });
  graph.addNode({ id: "a3", label: "📊 Agent-3: Start", parents: ["c2"] });

  // Agents work in parallel
  graph.addNode({ id: "a1-2", label: "🤖 Agent-1: Process", parents: ["a1"] });
  graph.addNode({ id: "a1-3", label: "🤖 Agent-1: Complete", parents: ["a1-2"] });

  graph.addNode({ id: "a2-2", label: "🔍 Agent-2: Analyze", parents: ["a2"] });
  graph.addNode({ id: "a2-3", label: "🔍 Agent-2: Report", parents: ["a2-2"] });

  graph.addNode({ id: "a3-2", label: "📊 Agent-3: Compute", parents: ["a3"] });
  graph.addNode({ id: "a3-3", label: "📊 Agent-3: Optimize", parents: ["a3-2"] });

  // Merge results back
  graph.addNode({ id: "c3", label: "🎯 Coord: Merge A1", parents: ["c2", "a1-3"] });
  graph.addNode({ id: "c4", label: "🎯 Coord: Merge A2", parents: ["c3", "a2-3"] });
  graph.addNode({ id: "c5", label: "🎯 Coord: Merge A3", parents: ["c4", "a3-3"] });
  graph.addNode({ id: "c6", label: "✅ Complete", parents: ["c5"] });

  console.log("\n📊 Agent Workflow Graph:");
  console.log("=========================\n");
  console.log(graph.render());

  const stats = graph.getStats();
  console.log(`\nStats: ${stats.nodes} nodes, ${stats.edges} edges`);
}

// Run examples
console.log("🎨 Git-style Graph Renderer");
console.log("===========================");

simpleExample();
gitFlowExample();
agentWorkflow();

console.log("\n✨ Examples complete!");