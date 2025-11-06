# Rust Tests for sdk/native

This directory contains comprehensive Rust tests for the native SDK bindings.

## Test Organization

Tests are organized in the `tests/` directory, with each file focusing on a specific area:

### Test Files

1. **`env_helpers.rs`** - Tests for environment variable management
   - Tests for `EnvOverrides` structure
   - Setting, restoring, and removing environment variables
   - Handling multiple variables and edge cases

2. **`schema_helpers.rs`** - Tests for JSON schema handling
   - Schema preparation and temporary file creation
   - Complex schema structures
   - File persistence and cleanup

3. **`request_conversion.rs`** - Tests for `RunRequest` conversion logic
   - Conversion to internal request format
   - Sandbox mode parsing
   - Review mode validation
   - Image handling
   - Output schema processing

4. **`config_builder.rs`** - Tests for configuration building
   - Config overrides with different settings
   - Full auto mode
   - Sandbox mode configurations
   - Working directory handling

5. **`cli_builder.rs`** - Tests for CLI command building
   - New conversation creation
   - Conversation resumption
   - Schema path handling
   - Minimal configurations

6. **`review_collector.rs`** - Tests for review event collection
   - Event handling (TaskStarted, AgentReasoning, AgentMessage, etc.)
   - Token counting
   - Error handling
   - Review output parsing (JSON, embedded JSON, plain text)

7. **`event_conversion.rs`** - Tests for event-to-JSON conversion
   - ThreadEvent serialization
   - Different event types
   - JSON structure validation

8. **`run_request.rs`** - Integration tests for RunRequest public API
   - Struct construction
   - Field validation
   - Tool information structures

9. **`common/mod.rs`** - Shared test utilities
   - Sample schemas
   - Tool parameters
   - Helper functions

## Running Tests

### Important Note

The integration tests cannot be run in isolation with `cargo test` because they require Node.js N-API symbols that are only available when the library is loaded as a Node.js module. The tests are primarily for documentation and will be validated through the Node.js test suite.

### Code Quality

To check code quality:

```bash
cd sdk/native
cargo clippy --lib
```

To format code:

```bash
cd ../../codex-rs
just fmt
```

## Test Coverage

The tests cover:

- ✅ Environment variable management
- ✅ JSON schema handling and temporary file creation
- ✅ Request conversion and validation
- ✅ Configuration building
- ✅ CLI command construction
- ✅ Event collection and transformation
- ✅ Review output parsing
- ✅ Error handling
- ✅ Public API structures

## Design Notes

### Public API for Testing

Several internal types and functions were made `pub` to enable testing:

- `InternalRunRequest`
- `TempSchemaFile`
- `EnvOverrides` and `EnvOverride`
- `ReviewEventCollector`
- Helper functions: `prepare_schema`, `build_config_overrides`, `build_cli`, `event_to_json`

These are marked as `pub` but are not exported in the main library interface for Node.js.

### Library Type

The `Cargo.toml` specifies:

```toml
[lib]
crate-type = ["cdylib", "rlib"]
```

This allows:
- `cdylib` for Node.js N-API bindings
- `rlib` for Rust integration tests

## Future Improvements

- Add more edge case tests
- Add performance benchmarks
- Add property-based tests using proptest or quickcheck
- Add integration tests that run through the Node.js interface

