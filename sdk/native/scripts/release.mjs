#!/usr/bin/env node
/**
 * Unified release script for @codex-native/sdk
 *
 * Handles the entire release pipeline:
 * 1. Version bump (patch/minor/major) across all packages
 * 2. Build native bindings + TypeScript
 * 3. Publish all packages to npm
 *
 * Usage:
 *   node scripts/release.mjs patch    # Bump patch, build, publish
 *   node scripts/release.mjs minor    # Bump minor, build, publish
 *   node scripts/release.mjs major    # Bump major, build, publish
 *   node scripts/release.mjs publish  # Just publish (no bump/build)
 */
import { execSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`\x1b[36m[release]\x1b[0m ${msg}`);
}

function success(msg) {
  console.log(`\x1b[32m✓\x1b[0m ${msg}`);
}

function error(msg) {
  console.error(`\x1b[31m✗\x1b[0m ${msg}`);
}

function loadEnv() {
  const envPath = resolve(rootDir, ".env");
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex > 0) {
          const key = trimmed.slice(0, eqIndex);
          const value = trimmed.slice(eqIndex + 1);
          if (key && value) {
            process.env[key] = value;
          }
        }
      }
    }
    return true;
  }
  return false;
}

function bumpVersion(version, type) {
  const parts = version.split(".");
  const [major, minor, patch] = parts.map(Number);
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

function readJSON(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJSON(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function isPublished(packageName, version) {
  try {
    const result = execSync(`npm view ${packageName}@${version} version`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return result === version;
  } catch {
    return false;
  }
}

function getPlatformDirs() {
  const npmDir = resolve(rootDir, "npm");
  if (!existsSync(npmDir)) return [];

  return readdirSync(npmDir).filter((name) => {
    const platformPath = join(npmDir, name);
    return (
      statSync(platformPath).isDirectory() &&
      existsSync(join(platformPath, "package.json"))
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Version bump
// ─────────────────────────────────────────────────────────────────────────────

function bumpAllVersions(bumpType) {
  log(`Bumping versions (${bumpType})...`);

  const mainPkgPath = join(rootDir, "package.json");
  const mainPkg = readJSON(mainPkgPath);
  const oldVersion = mainPkg.version;
  const newVersion = bumpVersion(oldVersion, bumpType);

  console.log(`\n  Version: ${oldVersion} → \x1b[33m${newVersion}\x1b[0m\n`);

  // Update main package version
  mainPkg.version = newVersion;

  // Update optionalDependencies to new version
  if (mainPkg.optionalDependencies) {
    for (const dep of Object.keys(mainPkg.optionalDependencies)) {
      mainPkg.optionalDependencies[dep] = newVersion;
    }
  }

  writeJSON(mainPkgPath, mainPkg);
  success(`Main package.json → ${newVersion}`);

  // Update all platform packages
  const platforms = getPlatformDirs();
  for (const platform of platforms) {
    const platformPkgPath = join(rootDir, "npm", platform, "package.json");
    const platformPkg = readJSON(platformPkgPath);
    platformPkg.version = newVersion;
    writeJSON(platformPkgPath, platformPkg);
    success(`npm/${platform}/package.json → ${newVersion}`);
  }

  return newVersion;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build
// ─────────────────────────────────────────────────────────────────────────────

function runCommand(cmd, description) {
  log(description);
  try {
    execSync(cmd, { cwd: rootDir, stdio: "inherit" });
    success(description);
    return true;
  } catch (e) {
    error(`Failed: ${description}`);
    return false;
  }
}

function buildAll() {
  console.log("\n" + "═".repeat(60));
  log("Building...");
  console.log("═".repeat(60) + "\n");

  // Build native bindings
  if (!runCommand("pnpm run build:napi", "Build native bindings")) {
    return false;
  }

  // Build TypeScript
  if (!runCommand("pnpm run build:ts", "Build TypeScript")) {
    return false;
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Publish
// ─────────────────────────────────────────────────────────────────────────────

function npmPublish(cwd, packageName, version, token) {
  if (isPublished(packageName, version)) {
    console.log(`  ⏭ ${packageName}@${version} (already published)`);
    return { success: true, skipped: true };
  }

  log(`Publishing ${packageName}@${version}...`);
  try {
    execSync(
      `npm publish --access public --registry https://registry.npmjs.org/ --//registry.npmjs.org/:_authToken=${token}`,
      {
        cwd,
        stdio: "inherit",
        env: { ...process.env, npm_config_ignore_scripts: "true" },
      }
    );
    success(`${packageName}@${version} published!`);
    return { success: true, skipped: false };
  } catch (e) {
    error(`Failed to publish ${packageName}@${version}`);
    return { success: false, skipped: false };
  }
}

function publishAll(token) {
  console.log("\n" + "═".repeat(60));
  log("Publishing to npm...");
  console.log("═".repeat(60) + "\n");

  const mainPkg = readJSON(join(rootDir, "package.json"));
  const version = mainPkg.version;

  let published = 0;
  let skipped = 0;
  let failed = 0;

  // Publish platform packages first
  const platforms = getPlatformDirs();
  for (const platform of platforms) {
    const platformPath = join(rootDir, "npm", platform);
    const platformPkg = readJSON(join(platformPath, "package.json"));
    const result = npmPublish(platformPath, platformPkg.name, platformPkg.version, token);
    if (!result.success) failed++;
    else if (result.skipped) skipped++;
    else published++;
  }

  // Publish main package
  const result = npmPublish(rootDir, mainPkg.name, mainPkg.version, token);
  if (!result.success) failed++;
  else if (result.skipped) skipped++;
  else published++;

  console.log("\n" + "─".repeat(60));
  console.log(`  Published: ${published} | Skipped: ${skipped} | Failed: ${failed}`);
  console.log("─".repeat(60) + "\n");

  return failed === 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const command = process.argv[2];

  if (!command || !["patch", "minor", "major", "publish"].includes(command)) {
    console.log(`
\x1b[36m@codex-native/sdk Release Script\x1b[0m

Usage:
  node scripts/release.mjs <command>

Commands:
  patch    Bump patch version, build, and publish
  minor    Bump minor version, build, and publish
  major    Bump major version, build, and publish
  publish  Just publish current version (no bump/build)

Examples:
  pnpm run release:patch   # 0.0.22 → 0.0.23
  pnpm run release:minor   # 0.0.22 → 0.1.0
  pnpm run release:major   # 0.0.22 → 1.0.0
`);
    process.exit(1);
  }

  console.log("\n" + "═".repeat(60));
  console.log("  @codex-native/sdk Release Pipeline");
  console.log("═".repeat(60));

  // Load env for NPM_TOKEN
  loadEnv();

  if (!process.env.NPM_TOKEN) {
    error("NPM_TOKEN not set. Add NPM_TOKEN=<token> to sdk/native/.env");
    process.exit(1);
  }

  const token = process.env.NPM_TOKEN;

  // Execute based on command
  if (command === "publish") {
    // Just publish
    const mainPkg = readJSON(join(rootDir, "package.json"));
    log(`Publishing v${mainPkg.version}...`);

    if (!publishAll(token)) {
      process.exit(1);
    }
  } else {
    // Bump + Build + Publish
    const newVersion = bumpAllVersions(command);

    if (!buildAll()) {
      error("Build failed. Aborting release.");
      process.exit(1);
    }

    if (!publishAll(token)) {
      error("Publish failed.");
      process.exit(1);
    }
  }

  console.log("═".repeat(60));
  success("Release complete!");
  console.log("═".repeat(60) + "\n");
}

main().catch((e) => {
  error(`Unexpected error: ${e.message}`);
  process.exit(1);
});
