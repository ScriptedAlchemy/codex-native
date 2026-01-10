#!/usr/bin/env node
/**
 * Version bump script for @codex-native/sdk
 *
 * Bumps version in:
 * - Main package.json
 * - All platform package.jsons in npm/
 * - Updates optionalDependencies to match
 *
 * Usage: node scripts/bump.mjs [patch|minor|major]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

function bumpVersion(version, type) {
  const [major, minor, patch] = version.split(".").map(Number);
  switch (type) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
    default:
      return `${major}.${minor}.${patch + 1}`;
  }
}

function main() {
  const bumpType = process.argv[2] || "patch";
  if (!["patch", "minor", "major"].includes(bumpType)) {
    console.error("Usage: node scripts/bump.mjs [patch|minor|major]");
    process.exit(1);
  }

  console.log(`\n=== Version Bump: ${bumpType} ===\n`);

  // Read main package.json
  const mainPkgPath = join(rootDir, "package.json");
  const mainPkg = JSON.parse(readFileSync(mainPkgPath, "utf-8"));
  const oldVersion = mainPkg.version;
  const newVersion = bumpVersion(oldVersion, bumpType);

  console.log(`Version: ${oldVersion} → ${newVersion}\n`);

  // Update main package.json version
  mainPkg.version = newVersion;

  // Update optionalDependencies versions
  if (mainPkg.optionalDependencies) {
    for (const dep of Object.keys(mainPkg.optionalDependencies)) {
      mainPkg.optionalDependencies[dep] = newVersion;
    }
  }

  writeFileSync(mainPkgPath, JSON.stringify(mainPkg, null, 2) + "\n");
  console.log(`✓ Updated main package.json to ${newVersion}`);

  // Update platform packages in npm/
  const npmDir = resolve(rootDir, "npm");
  if (existsSync(npmDir)) {
    const platforms = readdirSync(npmDir).filter((name) => {
      const platformPath = join(npmDir, name);
      return (
        statSync(platformPath).isDirectory() &&
        existsSync(join(platformPath, "package.json"))
      );
    });

    for (const platform of platforms) {
      const platformPkgPath = join(npmDir, platform, "package.json");
      const platformPkg = JSON.parse(readFileSync(platformPkgPath, "utf-8"));
      platformPkg.version = newVersion;
      writeFileSync(platformPkgPath, JSON.stringify(platformPkg, null, 2) + "\n");
      console.log(`✓ Updated npm/${platform}/package.json to ${newVersion}`);
    }
  }

  console.log(`\n=== Done! All packages bumped to ${newVersion} ===\n`);
  console.log("Next steps:");
  console.log("  1. Build native bindings: pnpm run build:napi");
  console.log("  2. Build TypeScript:      pnpm run build:ts");
  console.log("  3. Publish:               pnpm run release");
}

main();
