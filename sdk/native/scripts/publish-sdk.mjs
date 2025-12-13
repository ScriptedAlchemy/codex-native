import { execSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

console.log('\n[publish-sdk] Publishing @codex-native/sdk...');

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const packageDir = resolve(scriptDir, '..');
const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

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

function isAlreadyPublishedError(output) {
  return (
    output.includes('previously published version') ||
    output.includes('previously published versions') ||
    output.includes('You cannot publish over the previously published version') ||
    output.includes('You cannot publish over the previously published versions')
  );
}

function isOtpRequiredError(output) {
  return output.includes('npm error code EOTP') || output.includes('one-time password');
}

function runPublish(otp) {
  const args = ['publish', '--access', 'public'];
  if (otp) {
    args.push(`--otp=${otp}`);
  }
  const stdio = isInteractive ? 'inherit' : ['inherit', 'pipe', 'pipe'];
  return spawnSync('npm', args, {
    cwd: packageDir,
    stdio,
    env: {
      ...process.env,
      npm_config_yes: 'true',
    },
    encoding: 'utf8',
  });
}

function writePublishOutput(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

let result = runPublish();
writePublishOutput(result);

if (result.status === 0) {
  process.exit(0);
}

if (isInteractive) {
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
    // Ignore and continue error handling below.
  }
}

let output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
if (isAlreadyPublishedError(output)) {
  console.log(`[publish-sdk] ${pkg.name}@${pkg.version} already published. Skipping.`);
  process.exit(0);
}

if (isOtpRequiredError(output)) {
  if (!process.stdin.isTTY) {
    throw new Error(
      `npm publish requires an OTP. Re-run with \`npm_config_otp=123456 node scripts/publish-sdk.mjs\` (replace 123456).`,
    );
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const otp = (await rl.question('[publish-sdk] Enter npm OTP: ')).trim();
    if (!otp) {
      throw new Error('No OTP provided.');
    }
    result = runPublish(otp);
    writePublishOutput(result);

    if (result.status === 0) {
      process.exit(0);
    }

    output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    if (isAlreadyPublishedError(output)) {
      console.log(`[publish-sdk] ${pkg.name}@${pkg.version} already published. Skipping.`);
      process.exit(0);
    }
  } finally {
    rl.close();
  }
}

throw new Error(`npm publish failed for ${pkg.name}@${pkg.version} (exit ${result.status ?? 'unknown'})`);
