# Build Caching with sccache

This repository uses [sccache](https://github.com/mozilla/sccache) to significantly speed up Rust compilation by caching build artifacts.

## 📊 Performance Impact

With sccache enabled, you can expect:
- **First build**: Similar to normal cargo build (populates cache)
- **Subsequent builds**: 50-80% faster compilation times
- **CI builds**: Consistent performance across runs with persistent cache

## 🚀 Setup

### Prerequisites

Install sccache:

```bash
# macOS (Homebrew)
brew install sccache

# Cargo (any platform)
cargo install sccache

# Check installation
sccache --version
```

### Configuration

sccache is **automatically enabled** via `.cargo/config.toml`:

```toml
[build]
rustc-wrapper = "sccache"
```

No additional setup required! All cargo commands will use sccache automatically.

## 📝 Available Commands

### Cache Statistics

View cache performance:

```bash
pnpm run cache:stats
```

Shows:
- Cache hit/miss rates
- Average compilation times
- Cache size and location
- Non-cacheable compilation reasons

### Cache Management

```bash
# Reset statistics to zero (useful for measuring a specific build)
pnpm run cache:zero

# Start sccache server
pnpm run cache:start

# Stop sccache server
pnpm run cache:stop

# Warm up cache (runs full check to populate cache)
pnpm run cache:warmup
```

## 🔧 CI Integration

All CI commands automatically use sccache:

```bash
# These all benefit from caching:
pnpm run ci:build      # Build all targets
pnpm run ci:clippy     # Linting with clippy
pnpm run ci:test       # Run tests
pnpm run ci:shear      # Check dependencies
```

### GitHub Actions Setup

Add this to your workflow to enable persistent caching:

```yaml
- name: Setup sccache
  uses: mozilla-actions/sccache-action@v0.0.6

- name: Configure sccache
  run: |
    echo "SCCACHE_GHA_ENABLED=true" >> $GITHUB_ENV
    echo "RUSTC_WRAPPER=sccache" >> $GITHUB_ENV

- name: Run CI
  run: pnpm run ci

- name: Show sccache stats
  run: sccache --show-stats
```

## 📈 Understanding Cache Stats

Example output:

```
Cache hits                           250
Cache misses                         100
Cache hits rate                    71.43 %
Average cache write                0.001 s
Average compiler                   3.250 s
Average cache read hit             0.001 s
```

**Interpretation:**
- **Hit rate >50%**: Good caching, builds are significantly faster
- **Hit rate <20%**: Cache is cold or build configuration is changing
- **C/C++ 100% hits**: Great! Ring and other C dependencies are cached
- **Rust 0% hits**: First build, will improve on next build

### Non-cacheable Reasons

Common reasons compilations can't be cached:

- `crate-type`: Build scripts (`build.rs`) and proc macros
- `incremental`: Incremental compilation (disabled in CI for better caching)
- `unknown source language`: Non-Rust code (C/C++ fallback)
- `missing input`: File paths changed

## 🎯 Best Practices

### For Local Development

1. **Keep building in the same mode**: Switching between debug/release invalidates cache
2. **Run warmup after dependency changes**: `pnpm run cache:warmup`
3. **Monitor cache size**: Max is 20 GiB, old entries are evicted automatically

### For CI

1. **Use persistent cache storage**: S3, GCS, or GitHub Actions cache
2. **Disable incremental compilation**: Already done via `CARGO_INCREMENTAL=0`
3. **Share cache across jobs**: Use same cache key for similar builds
4. **Monitor hit rates**: Add `pnpm run cache:stats` to CI output

## 🐛 Troubleshooting

### Cache isn't being used

Check if sccache is running:

```bash
sccache --show-stats
```

If you see "couldn't connect to server", start it:

```bash
pnpm run cache:start
```

### Low cache hit rate

Possible causes:
1. **First build**: Normal, will improve on subsequent builds
2. **Dependency changes**: Cache invalidated, will repopulate
3. **Different build flags**: Check cargo commands are consistent
4. **Full rebuilds**: Try `cargo clean` then rebuild

### Cache fills up quickly

Increase max cache size:

```bash
# Set max to 50 GiB
export SCCACHE_CACHE_SIZE="50G"
```

Or edit `~/.config/sccache/config` (create if doesn't exist):

```toml
[cache.disk]
dir = "/Users/you/Library/Caches/Mozilla.sccache"
size = 21474836480  # 20 GiB in bytes
```

## 📚 Additional Resources

- [sccache documentation](https://github.com/mozilla/sccache)
- [Cargo configuration](https://doc.rust-lang.org/cargo/reference/config.html)
- [GitHub Actions sccache](https://github.com/mozilla-actions/sccache-action)

## 🔍 Monitoring in Production

Add cache stats to your CI logs:

```bash
echo "=== Build Cache Statistics ==="
pnpm run cache:stats
```

This helps identify:
- Build performance regressions
- Cache configuration issues
- Opportunities for optimization

