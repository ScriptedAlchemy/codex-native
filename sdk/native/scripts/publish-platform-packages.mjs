import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const packagesDir = resolve(scriptDir, '../npm');

const entries = readdirSync(packagesDir, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name);

if (entries.length === 0) {
  console.log('[publish-platform-packages] No platform packages found under npm/.');
  process.exit(0);
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

  console.log(`\n[publish-platform-packages] Publishing ${name}...`);
  try {
    execSync('npm publish --access public', {
      cwd: pkgDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        npm_config_yes: 'true',
      },
    });
  } catch (error) {
    const output = String(error?.stderr ?? error?.stdout ?? error?.message ?? '');
    if (output.includes('previously published version')) {
      console.log(`[publish-platform-packages] ${name} is already published. Skipping.`);
      continue;
    }
    throw error;
  }
}

console.log('\n[publish-platform-packages] Completed publishing platform packages.');

