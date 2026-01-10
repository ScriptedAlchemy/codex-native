#!/usr/bin/env node
/**
 * Publish script for @codex-native/sdk
 *
 * Publishes all platform packages and the main package to npm.
 * - Loads NPM_TOKEN from .env file
 * - Skips packages already published at current version
 * - Passes token directly to avoid subprocess env issues
 *
 * Usage: pnpm run release (from sdk/native)
 *        pnpm run release:sdk (from monorepo root)
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

// Load .env file
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
    console.log("Loaded .env file");
    return true;
  }
  return false;
}

// Check if a package version is already published
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

// Publish a single package
function npmPublish(cwd, packageName, version, token) {
  // Check if already published
  if (isPublished(packageName, version)) {
    console.log(`⏭ ${packageName}@${version} already published, skipping`);
    return true;
  }

  console.log(`Publishing ${packageName}@${version}...`);
  try {
    execSync(
      `npm publish --access public --registry https://registry.npmjs.org/ --//registry.npmjs.org/:_authToken=${token}`,
      {
        cwd,
        stdio: "inherit",
        env: { ...process.env, npm_config_ignore_scripts: "true" },
      }
    );
    console.log(`✓ ${packageName}@${version} published successfully!`);
    return true;
  } catch (error) {
    console.error(`✗ Failed to publish ${packageName}@${version}`);
    return false;
  }
}

// Main
async function main() {
  console.log("\n=== @codex-native/sdk Publish Script ===\n");

  // Load env
  loadEnv();

  // Check NPM_TOKEN
  if (!process.env.NPM_TOKEN) {
    console.error("Error: NPM_TOKEN not set.");
    console.error("Add NPM_TOKEN=<your-automation-token> to sdk/native/.env");
    process.exit(1);
  }

  const token = process.env.NPM_TOKEN;

  // Get main package version
  const mainPkgJson = JSON.parse(
    readFileSync(join(rootDir, "package.json"), "utf-8")
  );
  const version = mainPkgJson.version;
  console.log(`Version: ${version}\n`);

  // Collect all packages to publish
  const packages = [];

  // Platform packages from npm/ directory
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
      const platformPath = join(npmDir, platform);
      const pkgJson = JSON.parse(
        readFileSync(join(platformPath, "package.json"), "utf-8")
      );
      packages.push({
        name: pkgJson.name,
        version: pkgJson.version,
        path: platformPath,
      });
    }
  }

  // Main package
  packages.push({
    name: mainPkgJson.name,
    version: mainPkgJson.version,
    path: rootDir,
  });

  console.log(`Found ${packages.length} packages to publish:\n`);
  for (const pkg of packages) {
    console.log(`  - ${pkg.name}@${pkg.version}`);
  }
  console.log("");

  // Publish all packages
  let allSuccess = true;
  let published = 0;
  let skipped = 0;

  for (const pkg of packages) {
    const wasPublished = isPublished(pkg.name, pkg.version);
    const success = npmPublish(pkg.path, pkg.name, pkg.version, token);
    if (!success) {
      allSuccess = false;
    } else if (wasPublished) {
      skipped++;
    } else {
      published++;
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Published: ${published}`);
  console.log(`Skipped (already published): ${skipped}`);

  if (allSuccess) {
    console.log("\n✓ All packages handled successfully!\n");
  } else {
    console.error("\n✗ Some packages failed to publish\n");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unexpected error:", error);
  process.exit(1);
});
