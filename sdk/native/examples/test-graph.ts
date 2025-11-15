#!/usr/bin/env node

/**
 * Quick test of GitGraphRenderer functionality
 */

import { GitGraphRenderer } from "../src/gitGraphRenderer.js";

console.log("Testing GitGraphRenderer\n");

// Test 1: Basic linear graph
console.log("Test 1: Linear commits");
console.log("======================");
const linear = new GitGraphRenderer({ showLabels: true });
linear.addNode({ id: "a", label: "Commit A" });
linear.addNode({ id: "b", label: "Commit B", parents: ["a"] });
linear.addNode({ id: "c", label: "Commit C", parents: ["b"] });
linear.addNode({ id: "d", label: "Commit D", parents: ["c"] });
console.log(linear.render());
console.log();

// Test 2: Simple branch and merge
console.log("Test 2: Branch and merge");
console.log("========================");
const branch = new GitGraphRenderer({ showLabels: true, style: 'unicode' });
branch.addNode({ id: "1", label: "Main: Initial" });
branch.addNode({ id: "2", label: "Main: Add feature", parents: ["1"] });
branch.addNode({ id: "3", label: "Branch: Fix bug", parents: ["1"] });
branch.addNode({ id: "4", label: "Branch: Add test", parents: ["3"] });
branch.addNode({ id: "5", label: "Main: Merge branch", parents: ["2", "4"] });
console.log(branch.render());
console.log();

// Test 3: Multiple branches
console.log("Test 3: Multiple parallel branches");
console.log("===================================");
const multi = new GitGraphRenderer({ showLabels: true });

// Main line
multi.addNode({ id: "m1", label: "Main 1" });
multi.addNode({ id: "m2", label: "Main 2", parents: ["m1"] });

// Branch A (from m1)
multi.addNode({ id: "a1", label: "Branch A: Start", parents: ["m1"] });
multi.addNode({ id: "a2", label: "Branch A: Work", parents: ["a1"] });
multi.addNode({ id: "a3", label: "Branch A: Done", parents: ["a2"] });

// Branch B (from m1)
multi.addNode({ id: "b1", label: "Branch B: Start", parents: ["m1"] });
multi.addNode({ id: "b2", label: "Branch B: Done", parents: ["b1"] });

// Merge everything
multi.addNode({ id: "m3", label: "Main: Merge A", parents: ["m2", "a3"] });
multi.addNode({ id: "m4", label: "Main: Merge B", parents: ["m3", "b2"] });
multi.addNode({ id: "m5", label: "Main: Final", parents: ["m4"] });

console.log(multi.render());
const stats = multi.getStats();
console.log(`\nGraph stats: ${stats.nodes} nodes, ${stats.edges} edges, ${stats.maxColumn + 1} columns`);
console.log();

// Test 4: Programmatic usage
console.log("Test 4: Programmatic API");
console.log("========================");
const api = new GitGraphRenderer({ showLabels: false });

// Add nodes dynamically
const commits = ["init", "feat-1", "feat-2", "fix-1", "merge"];
let previousId: string | undefined;

for (let i = 0; i < commits.length; i++) {
  const nodeId = `commit-${i}`;
  api.addNode({
    id: nodeId,
    label: commits[i],
    parents: previousId ? [previousId] : undefined
  });
  previousId = nodeId;
}

console.log("Graph without labels:");
console.log(api.render());
console.log();

// Test clearing and rebuilding
api.clear();
console.log("After clear():", api.getStats());

api.addNode({ id: "new1", label: "New commit 1" });
api.addNode({ id: "new2", label: "New commit 2", parents: ["new1"] });
console.log("After rebuild:", api.getStats());

console.log("\n✅ All tests complete!");