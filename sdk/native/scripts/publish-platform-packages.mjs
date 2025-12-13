import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const packagesDir = resolve(scriptDir, '../npm');
const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

const entries = readdirSync(packagesDir, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name);

if (entries.length === 0) {
  console.log('[publish-platform-packages] No platform packages found under npm/.');
  process.exit(0);
}

function requiredBinaryFiles(pkgDir, pkgJson) {
  const requiredFiles = new Set();
  if (typeof pkgJson.main === 'string') {
    requiredFiles.add(pkgJson.main);
  }
  if (Array.isArray(pkgJson.files)) {
    for (const file of pkgJson.files) {
      if (typeof file === 'string' && (file.endsWith('.node') || file.endsWith('.wasm'))) {
        requiredFiles.add(file);
      }
    }
  }
  return [...requiredFiles].filter(file => !existsSync(join(pkgDir, file)));
}

function isAlreadyPublished(name, version) {
  try {
    const out = execSync(`npm view ${name}@${version} version --registry https://registry.npmjs.org/`, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        npm_config_yes: 'true',
      },
      encoding: 'utf8',
    }).trim();
    return out === version;
  } catch {
    return false;
  }
}

function isAlreadyPublishedError(output) {
  return (
    output.includes('previously published version') ||
    output.includes('previously published versions') ||
    output.includes('You cannot publish over the previously published version') ||
    output.includes('You cannot publish over the previously published versions')
  );
}

for (const name of entries) {
  const pkgDir = join(packagesDir, name);
  const pkgJsonPath = join(pkgDir, 'package.json');
  try {
    statSync(pkgJsonPath);
  } catch (error) {
    console.warn(`[publish-platform-packages] Skipping ${name}: missing package.json`);
    continue;
  }

  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  const missingFiles = requiredBinaryFiles(pkgDir, pkgJson);
  if (missingFiles.length > 0) {
    console.warn(`[publish-platform-packages] Skipping ${name}: missing ${missingFiles.join(', ')}`);
    continue;
  }

  if (isAlreadyPublished(pkgJson.name, pkgJson.version)) {
    console.log(`[publish-platform-packages] ${pkgJson.name}@${pkgJson.version} already published. Skipping.`);
    continue;
  }

  console.log(`\n[publish-platform-packages] Publishing ${name}...`);
  const result = spawnSync('npm', ['publish', '--access', 'public'], {
    cwd: pkgDir,
    stdio: isInteractive ? 'inherit' : ['inherit', 'pipe', 'pipe'],
    env: {
      ...process.env,
      npm_config_yes: 'true',
    },
    encoding: 'utf8',
  });

  if (!isInteractive) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }

  if (result.status === 0) {
    continue;
  }

  if (isAlreadyPublished(pkgJson.name, pkgJson.version)) {
    console.log(`[publish-platform-packages] ${name} is already published. Skipping.`);
    continue;
  }

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (isAlreadyPublishedError(output)) {
    console.log(`[publish-platform-packages] ${name} is already published. Skipping.`);
    continue;
  }
  throw new Error(`npm publish failed for ${name} (exit ${result.status ?? 'unknown'})`);
}

console.log('\n[publish-platform-packages] Completed publishing platform packages.');
