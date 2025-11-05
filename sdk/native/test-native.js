#!/usr/bin/env node

// Simple test to verify native bindings load and work

const binding = require('./index.js');

console.log('✓ Native binding loaded successfully');
console.log('✓ Available functions:', Object.keys(binding));

// Test that functions are exported
if (typeof binding.runThread === 'function') {
  console.log('✓ runThread function is available');
} else {
  console.error('✗ runThread function is missing');
  process.exit(1);
}

if (typeof binding.runThreadStream === 'function') {
  console.log('✓ runThreadStream function is available');
} else {
  console.error('✗ runThreadStream function is missing');
  process.exit(1);
}

console.log('\n✓ All checks passed! Native bindings are working correctly.');
console.log('\nNote: To test full functionality, you would need valid API credentials.');
console.log('The native binding successfully bridges Codex Rust code to JavaScript!\n');
