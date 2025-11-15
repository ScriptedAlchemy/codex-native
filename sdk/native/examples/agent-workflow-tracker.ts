#!/usr/bin/env node

/**
 * Agent Workflow Tracker Example
 *
 * This example shows how to integrate AgentGraphRenderer into real agent workflows
 * to provide live visualization of multi-agent execution.
 *
 * Run with: npx tsx examples/agent-workflow-tracker.ts
 */

import { AgentGraphRenderer } from "../src/index.js";

// Example of tracking a real agent workflow
async function trackAgentWorkflow() {
  console.log("🔍 Agent Workflow Tracker");
  console.log("========================\n");

  const graph = new AgentGraphRenderer();

  // Initialize workflow coordinator
  const workflowId = "workflow-" + Date.now();
  graph.addAgent({
    id: workflowId,
    name: "Code Review Workflow",
    state: "running",
    currentActivity: "Initializing code review process",
    progress: "0/4 stages",
  });

  console.log("Workflow started:");
  console.log(graph.renderAscii());
  console.log();

  // Stage 1: Code Analysis Agent
  await simulateAgentExecution(graph, {
    id: "analyzer-001",
    name: "Code Analyzer",
    parentId: workflowId,
    activities: [
      "Scanning source files",
      "Analyzing code quality metrics",
      "Identifying potential issues",
      "Generating analysis report"
    ],
    duration: 800,
  });

  // Stage 2: Security Review Agent
  await simulateAgentExecution(graph, {
    id: "security-002",
    name: "Security Reviewer",
    parentId: workflowId,
    activities: [
      "Checking for security vulnerabilities",
      "Reviewing authentication patterns",
      "Analyzing data handling",
      "Security audit complete"
    ],
    duration: 600,
  });

  // Stage 3: Performance Review Agent
  await simulateAgentExecution(graph, {
    id: "perf-003",
    name: "Performance Analyzer",
    parentId: workflowId,
    activities: [
      "Analyzing performance bottlenecks",
      "Checking memory usage patterns",
      "Reviewing algorithmic complexity",
      "Performance optimization suggestions"
    ],
    duration: 500,
  });

  // Stage 4: Documentation Agent
  await simulateAgentExecution(graph, {
    id: "docs-004",
    name: "Documentation Reviewer",
    parentId: workflowId,
    activities: [
      "Checking documentation completeness",
      "Validating code comments",
      "Reviewing API documentation",
      "Documentation review complete"
    ],
    duration: 300,
  });

  // Workflow completion
  graph.updateAgentActivity(workflowId, "All reviews completed successfully");
  graph.updateAgentState(workflowId, "completed");
  graph.updateAgentProgress(workflowId, "4/4 stages");

  console.log("🎉 Final workflow status:");
  console.log(graph.renderAscii());
  console.log();

  console.log("💡 Integration Tips:");
  console.log("• Call updateAgentActivity() when agents change tasks");
  console.log("• Use updateAgentProgress() for quantifiable progress");
  console.log("• Call incrementAgentTurns() after each conversation round");
  console.log("• Update state to 'completed'/'failed' when agents finish");
  console.log("• Call buildGraph() + renderAscii() to refresh the display");
}

interface AgentExecutionConfig {
  id: string;
  name: string;
  parentId: string;
  activities: string[];
  duration: number;
}

async function simulateAgentExecution(
  graph: AgentGraphRenderer,
  config: AgentExecutionConfig
): Promise<void> {
  // Add agent to graph
  graph.addAgent({
    id: config.id,
    name: config.name,
    state: "running",
    parentId: config.parentId,
    currentActivity: config.activities[0],
    progress: `0/${config.activities.length} tasks`,
  });

  console.log(`${config.name} started:`);
  console.log(graph.renderAscii());
  console.log();

  // Simulate activity progression
  const stepDuration = config.duration / config.activities.length;

  for (let i = 0; i < config.activities.length; i++) {
    await delay(stepDuration);

    graph.updateAgentActivity(config.id, config.activities[i]);
    graph.updateAgentProgress(config.id, `${i + 1}/${config.activities.length} tasks`);
    graph.incrementAgentTurns(config.id);

    if (i < config.activities.length - 1) {
      console.log(`${config.name} progress:`);
      console.log(graph.renderAscii());
      console.log();
    }
  }

  // Complete agent
  await delay(100);
  graph.updateAgentActivity(config.id, "Task completed successfully");
  graph.updateAgentState(config.id, "completed");

  console.log(`${config.name} completed:`);
  console.log(graph.renderAscii());
  console.log();
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the workflow tracker
trackAgentWorkflow().catch(console.error);
