#!/usr/bin/env node

/**
 * Debug test to see what the native binding is actually returning
 */

const path = require('path');
const nativePath = path.join(__dirname, 'index.js');

console.log('🔍 Debug test for NAPI bindings\n');

const nativeBinding = require(nativePath);
console.log('✓ Native bindings loaded');

// Test runThread (non-streaming) to see what events we get
console.log('\n📝 Testing runThread with a simple prompt...\n');

const request = {
  prompt: 'Say hello in one word',
  model: 'gpt-4o-mini',
  sandboxMode: 'read-only',
};

nativeBinding
  .runThread(request)
  .then((events) => {
    console.log(`\n✅ Received ${events.length} events\n`);

    events.forEach((event, i) => {
      console.log(`Event ${i + 1}:`, JSON.stringify(event, null, 2));
      console.log('  Type:', typeof event);
      console.log('  Is null?', event === null);
      console.log('  Keys:', event ? Object.keys(event) : 'N/A');
      console.log('');
    });
  })
  .catch((error) => {
    console.error('\n❌ Error:', error.message);

    // Check for API key issues
    if (
      error.message.includes('CODEX_API_KEY') ||
      error.message.includes('OPENAI_API_KEY') ||
      error.message.includes('API key') ||
      error.message.includes('api_key')
    ) {
      console.log('\n⚠️  API key not configured. Set CODEX_API_KEY or OPENAI_API_KEY to test fully.');
      console.log('✓ But the native binding itself loaded and executed correctly!');
      process.exit(0);
    }

    console.error('\nFull error:', error);
    process.exit(1);
  });
