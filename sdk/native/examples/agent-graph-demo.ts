#!/usr/bin/env node

/**
 * Agent Graph Renderer Demo
 *
 * This script demonstrates how to use the AgentGraphRenderer to create
 * live, git-graph style visualizations of multi-agent workflows.
 *
 * Run with: npx tsx examples/agent-graph-demo.ts
 */

import { AgentGraphRenderer } from "../src/index.js";

// Simulate a merge conflict resolution workflow
async function demoAgentGraph() {
  console.log("🤖 Agent Graph Renderer Demo");
  console.log("===========================\n");

  const renderer = new AgentGraphRenderer();

  // Initialize the coordinator (root agent)
  renderer.addAgent({
    id: "coordinator-001",
    name: "Merge Coordinator",
    state: "running",
    currentActivity: "Scanning repository for conflicts",
    progress: "0/5 files",
  });

  renderer.buildGraph();
  console.log("Initial state:");
  console.log(renderer.renderAscii());
  console.log();

  // Simulate finding conflicts and spawning workers
  await delay(500);
  renderer.updateAgentActivity("coordinator-001", "Found 3 merge conflicts, spawning workers");
  renderer.updateAgentProgress("coordinator-001", "3/5 files");

  // Worker 1: Handle src/main.rs
  renderer.addAgent({
    id: "worker-main-002",
    name: "Conflict Resolver: main.rs",
    state: "running",
    parentId: "coordinator-001",
    currentActivity: "Analyzing merge conflict in main.rs",
    progress: "0/4 steps",
  });

  // Worker 2: Handle src/utils.rs
  renderer.addAgent({
    id: "worker-utils-003",
    name: "Conflict Resolver: utils.rs",
    state: "running",
    parentId: "coordinator-001",
    currentActivity: "Starting conflict resolution",
    progress: "0/3 steps",
  });

  renderer.buildGraph();
  console.log("Workers spawned:");
  console.log(renderer.renderAscii());
  console.log();

  // Simulate worker progress
  await delay(300);
  renderer.updateAgentActivity("worker-main-002", "Applying merge strategy");
  renderer.updateAgentProgress("worker-main-002", "2/4 steps");
  renderer.incrementAgentTurns("worker-main-002");

  renderer.updateAgentActivity("worker-utils-003", "Resolving import conflicts");
  renderer.updateAgentProgress("worker-utils-003", "1/3 steps");
  renderer.incrementAgentTurns("worker-utils-003");

  renderer.buildGraph();
  console.log("Workers making progress:");
  console.log(renderer.renderAscii());
  console.log();

  // Worker 1 completes successfully
  await delay(200);
  renderer.updateAgentActivity("worker-main-002", "Conflict resolved successfully");
  renderer.updateAgentState("worker-main-002", "completed");
  renderer.updateAgentProgress("coordinator-001", "4/5 files");

  renderer.buildGraph();
  console.log("First worker completed:");
  console.log(renderer.renderAscii());
  console.log();

  // Worker 2 completes
  await delay(100);
  renderer.updateAgentActivity("worker-utils-003", "All conflicts resolved");
  renderer.updateAgentState("worker-utils-003", "completed");
  renderer.updateAgentProgress("coordinator-001", "5/5 files");

  // Add CI runner
  renderer.addAgent({
    id: "ci-runner-004",
    name: "CI Verification",
    state: "running",
    parentId: "coordinator-001",
    currentActivity: "Running test suite",
    progress: "0/2 stages",
  });

  renderer.buildGraph();
  console.log("CI runner started:");
  console.log(renderer.renderAscii());
  console.log();

  // CI completes successfully
  await delay(300);
  renderer.updateAgentActivity("ci-runner-004", "All tests passed ✅");
  renderer.updateAgentState("ci-runner-004", "completed");
  renderer.updateAgentProgress("ci-runner-004", "2/2 stages");

  renderer.updateAgentActivity("coordinator-001", "Merge conflict resolution complete");
  renderer.updateAgentState("coordinator-001", "completed");

  renderer.buildGraph();
  console.log("Final result - all conflicts resolved:");
  console.log(renderer.renderAscii());
  console.log();

  console.log("🎉 Demo complete! The AgentGraphRenderer provides live, git-graph style");
  console.log("   visualizations of multi-agent workflows with streaming updates.");
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the demo
demoAgentGraph().catch(console.error);
