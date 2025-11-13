#!/bin/bash
set -e

echo "Running CI checks..."
echo ""

echo "==> Checking formatting..."
cargo fmt --check
echo "✓ Formatting check passed"
echo ""

echo "==> Running clippy..."
cargo clippy -- -D warnings
echo "✓ Clippy check passed"
echo ""

echo "==> Running tests..."
cargo test
echo "✓ Tests passed"
echo ""

echo "All CI checks passed successfully!"