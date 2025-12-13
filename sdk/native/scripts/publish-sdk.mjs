import { execSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

console.log('\n[publish-sdk] Publishing @codex-native/sdk...');

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const packageDir = resolve(scriptDir, '..');

try {
  const publishedVersion = execSync(
    `npm view ${pkg.name}@${pkg.version} version --registry https://registry.npmjs.org/`,
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        npm_config_yes: 'true',
      },
      encoding: 'utf8',
    },
  ).trim();
  if (publishedVersion === pkg.version) {
    console.log(`[publish-sdk] ${pkg.name}@${pkg.version} already published. Skipping.`);
    process.exit(0);
  }
} catch {
  // Not published yet (or view failed). Continue with publish attempt.
}

try {
  const result = spawnSync('npm', ['publish', '--access', 'public'], {
    cwd: packageDir,
    stdio: ['inherit', 'pipe', 'pipe'],
    env: {
      ...process.env,
      npm_config_yes: 'true',
    },
    encoding: 'utf8',
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status === 0) {
    process.exit(0);
  }

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (
    output.includes('previously published version') ||
    output.includes('previously published versions') ||
    output.includes('You cannot publish over the previously published version') ||
    output.includes('You cannot publish over the previously published versions')
  ) {
    console.log(`[publish-sdk] ${pkg.name}@${pkg.version} already published. Skipping.`);
    process.exit(0);
  }

  throw new Error(`npm publish failed for ${pkg.name}@${pkg.version} (exit ${result.status ?? 'unknown'})`);
} catch (error) {
  throw error;
}
