import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

console.log('\n[publish-sdk] Publishing @codex-native/sdk...');
try {
  execSync('npm publish --access public', {
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_yes: 'true',
    },
  });
} catch (error) {
  const output = String(error?.stderr ?? error?.stdout ?? error?.message ?? '');
  if (output.includes('previously published version') || output.includes('You cannot publish over the previously published version')) {
    console.log(`[publish-sdk] @codex-native/sdk@${pkg.version} already published. Skipping.`);
    process.exit(0);
  }
  throw error;
}
