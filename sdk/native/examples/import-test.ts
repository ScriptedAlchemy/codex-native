#!/usr/bin/env node

/**
 * Test importing GitGraphRenderer from the main SDK
 */

// Import from the built SDK package
import { GitGraphRenderer } from "../dist/index.mjs";

console.log("Testing import from SDK...\n");

// Verify the class is available
console.log("✅ GitGraphRenderer imported:", typeof GitGraphRenderer === "function");

// Create an instance
const graph = new GitGraphRenderer();

// Add some nodes to create a simple tree structure
graph.addNode({
  id: "coordinator",
  label: "Coordinator Agent"
});

graph.addNode({
  id: "worker-1",
  label: "Worker Agent 1",
  parents: ["coordinator"]
});

graph.addNode({
  id: "worker-2",
  label: "Worker Agent 2",
  parents: ["coordinator"]
});

// Render and display
console.log("\nRendered graph:");
console.log(graph.render());

console.log("\n✅ GitGraphRenderer working correctly!");