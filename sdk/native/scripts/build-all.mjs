import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

const run = (cmd) => {
  console.log(`
[build-all] ${cmd}`);
  execSync(cmd, { cwd: rootDir, stdio: 'inherit' });
};

run('pnpm --filter "@codex-native/sdk" run build:napi');
run('pnpm --filter "@codex-native/sdk" run build:ts');
run('pnpm --filter "@openai/codex-sdk" install');
run('pnpm --filter "@openai/codex-sdk" run build');
