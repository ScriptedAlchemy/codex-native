import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const packageJsonPath = resolve(scriptDir, '..', 'package.json');

const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
if (!pkg.optionalDependencies || typeof pkg.optionalDependencies !== 'object') {
  process.exit(0);
}

const version = pkg.version;
if (typeof version !== 'string' || version.length === 0) {
  throw new Error('package.json is missing a version');
}

const syncedOptionalDependencies = {};
for (const name of Object.keys(pkg.optionalDependencies)) {
  syncedOptionalDependencies[name] = version;
}

pkg.optionalDependencies = syncedOptionalDependencies;
writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
