#!/usr/bin/env bash
set -euo pipefail

# Check if arguments were provided
if [[ $# -eq 0 ]]; then
  echo "Error: No command provided to run-cargo-ci.sh" >&2
  echo "Usage: $0 <command> [args...]" >&2
  exit 1
fi

# Enable sccache if available (provides distributed/shared caching)
if command -v sccache >/dev/null 2>&1; then
  if [[ -z "${RUSTC_WRAPPER:-}" ]]; then
    export RUSTC_WRAPPER="$(command -v sccache)"
  fi
  export SCCACHE_CACHE_SIZE="${SCCACHE_CACHE_SIZE:-20G}"
  export SCCACHE_IDLE_TIMEOUT="${SCCACHE_IDLE_TIMEOUT:-0}"
  export SCCACHE_ERROR_LOG="/tmp/sccache-errors.log"
  export SCCACHE_LOG="${SCCACHE_LOG:-warn}"
  
  # Disable incremental compilation to maximize sccache effectiveness
  export CARGO_INCREMENTAL=0
  
  # Optimize for better cache hit rates
  export CARGO_PROFILE_DEV_SPLIT_DEBUGINFO="${CARGO_PROFILE_DEV_SPLIT_DEBUGINFO:-off}"
  export CARGO_PROFILE_TEST_SPLIT_DEBUGINFO="${CARGO_PROFILE_TEST_SPLIT_DEBUGINFO:-off}"
  export CARGO_PROFILE_TEST_CACHE_SPLIT_DEBUGINFO="${CARGO_PROFILE_TEST_CACHE_SPLIT_DEBUGINFO:-off}"
  
  # Balance codegen units for better caching (fewer units = better cache reuse)
  # Don't override if already set
  if [[ -z "${CARGO_PROFILE_DEV_CODEGEN_UNITS:-}" ]]; then
    export CARGO_PROFILE_DEV_CODEGEN_UNITS=16
  fi
  if [[ -z "${CARGO_PROFILE_TEST_CACHE_CODEGEN_UNITS:-}" ]]; then
    export CARGO_PROFILE_TEST_CACHE_CODEGEN_UNITS=16
  fi

  # Show sccache stats at the start (helps with debugging)
  echo "📊 sccache stats before build:"
  sccache --show-stats | head -n 15
  echo ""

  # Ensure sccache is working by testing it
  if ! sccache --version >/dev/null 2>&1; then
    echo "Warning: sccache detected but not working properly" >&2
    exit 1
  fi
  
  # Start sccache server if not already running
  sccache --start-server 2>/dev/null || true
fi

# Run the command
"$@"
EXIT_CODE=$?

# Show sccache stats at the end
if command -v sccache >/dev/null 2>&1; then
  echo ""
  echo "📊 sccache stats after build:"
  sccache --show-stats | head -n 15
fi

exit $EXIT_CODE

