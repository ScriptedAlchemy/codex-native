# Codex Crate Overview

This section documents all crates in the codex-rs workspace, describing their purpose and functionality.

### ansi-escape (`codex-ansi-escape`)

The `codex-ansi-escape` crate is a small helper library that wraps the `ansi-to-tui` functionality to convert ANSI escape sequences (color codes and formatting) into Ratatui text widgets for TUI rendering. It provides two main functions (`ansi_escape` and `ansi_escape_line`) that handle the conversion while also normalizing tabs to spaces to prevent visual artifacts in transcript views and panicking on parse errors rather than propagating them to callers.

### app-server (`codex-app-server`)

The `codex-app-server` crate is a JSON-RPC protocol server that acts as a backend service for the Codex CLI application. It handles communication with client applications (like VS Code) by processing incoming JSONRPC requests and notifications over stdin/stdout, managing authentication, conversation state, model selection, and executing commands through the codex-core and related subsystems. The server coordinates between clients and Anthropic's backend services, managing features such as login/authentication, conversation lifecycle, AI model interactions, file search, command execution approvals, and rate limit tracking.

### app-server-protocol (`codex-app-server-protocol`)

The `codex-app-server-protocol` crate defines the JSON-RPC protocol specification for communication between Codex clients and its app server, providing strongly-typed request/response definitions, notification types, and schema generation capabilities. It uses macros to declare versioned protocol messages (v1 and v2) with associated parameters and response types, and exports these definitions as both TypeScript and JSON schema files for cross-language compatibility. The crate serves as the contract layer enabling type-safe, serializable communication between the CLI/client and the backend server infrastructure.

### apply-patch (`codex-apply-patch`)

The `codex-apply-patch` crate is a Rust library that parses and applies code patches in a custom unified diff format. It enables file operations (add, delete, update) by parsing patch files structured with markers like `*** Begin Patch` and `*** Add File:`, then applies these changes to the filesystem while generating unified diff outputs and file change summaries. The crate supports both direct CLI invocation and extraction of patches from bash heredoc scripts, with intelligent context matching and fuzzy-matching capabilities to locate code regions even with minor Unicode punctuation differences.

### arg0 (`codex-arg0`)

The `codex-arg0` crate implements the "arg0 trick" pattern to dispatch a single Codex CLI executable to multiple CLI tools (codex-linux-sandbox, apply*patch, and the main codex binary). It provides the `arg0_dispatch_or_else()` function that checks the executable's invocation name and routes to the appropriate handler, while also setting up a Tokio runtime, loading environment variables from ~/.codex/.env with security filtering, and creating symlinks or batch scripts to make apply_patch available on the PATH without requiring separate installation. The crate is essential for Codex's deployment strategy, allowing a single binary to be distributed as multiple CLI tools through hard-links or name aliases on Unix systems and batch script wrappers on Windows, while maintaining security by preventing CODEX*-prefixed environment variables from being overridden by user configuration files.

### async-utils (`codex-async-utils`)

The `codex-async-utils` crate is a lightweight utility library that provides asynchronous helpers for Tokio-based Rust applications, specifically implementing an `OrCancelExt` trait extension for futures. It allows any future to be combined with a `CancellationToken`, enabling graceful cancellation of async operations by race-detecting whether a cancellation token is triggered before the future completes. This crate is used throughout the Codex project to support interruptible async operations where tasks need to be cleanly cancelled in response to user requests or system signals.

### backend-client (`codex-backend-client`)

The `codex-backend-client` crate is an HTTP client library that communicates with the Codex backend API to manage tasks and retrieve usage/rate limit information. It provides methods to list tasks, fetch task details (including turns, diffs, and error states), create new tasks, retrieve rate limits, and list sibling turns, while supporting both Codex API (`/api/codex/`) and ChatGPT API (`/wham/`) path styles with authentication via bearer tokens.

### backend-openapi-models (`codex-backend-openapi-models`)

The `codex-backend-openapi-models` crate contains auto-generated Rust data structures from the OpenAPI specification of the codex-backend service. It provides serializable/deserializable types for domain models including Cloud Tasks (like `TaskResponse`, `CodeTaskDetailsResponse`) and Rate Limiting information (like `RateLimitStatusPayload`, `RateLimitWindowSnapshot`) that are used throughout the workspace for type-safe communication with the backend API. This crate intentionally contains no hand-written types—only generated models from the OpenAPI schema that are curated and exported for use by other workspace crates.

### cli (`codex-cli`)

The `codex-cli` crate is the command-line interface entry point for Codex, serving as a multi-tool CLI that provides both an interactive TUI mode and various subcommands. It handles authentication (login/logout), session management (resume previous conversations), code execution (via the `exec` command), MCP (Model Context Protocol) server operations, and applies AI-generated code changes to local repositories through a `git apply` workflow. The CLI acts as a unified dispatcher that routes users to either the interactive terminal UI or specific operational modes like non-interactive execution, sandbox debugging, or API proxy operations.

### cloud-tasks (`codex-cloud-tasks`)

The `codex-cloud-tasks` crate is a terminal user interface (TUI) and CLI tool for managing Codex Cloud tasks—background job execution on remote cloud environments. It provides an interactive TUI (built with ratatui and crossterm) for browsing, creating, and applying code changes from cloud task results, along with a headless `codex cloud exec` subcommand for non-interactive task submission. The crate integrates with ChatGPT authentication, supports environment filtering, preflight validation, and best-of-N task generation with visual diff viewing and application capabilities.

### cloud-tasks-client (`codex-cloud-tasks-client`)

The `codex-cloud-tasks-client` crate is a Rust client library for managing AI-assisted code generation tasks in Codex's cloud backend. It provides an async `CloudBackend` trait with methods to list tasks, fetch diffs and messages, preflight-validate and apply code patches, manage sibling attempts (best-of-N generation), and create new tasks. The crate supports both HTTP-based communication with a remote backend via `HttpClient` and offline testing via `MockClient`, making it essential for interacting with cloud-based code generation workflows throughout the Codex system.

### common (`codex-common`)

The `codex-common` crate is a shared utility library that provides common functionality and data structures used across multiple Codex components (CLI, TUI, and MCP server). It centralizes reusable code for CLI argument parsing, configuration management, and UI presets—including approval policies, sandbox policies, model definitions, fuzzy matching for UI filtering, and environment variable formatting—to ensure consistency across different Codex interfaces without creating interdependencies between CLI, TUI, and server modules.

### core (`codex-core`)

The `codex-core` crate is the central intelligence engine of Codex that handles conversation management, LLM client interactions, and tool orchestration. It manages the lifecycle of conversations with language models, processes user messages and AI responses through a sophisticated pipeline that includes MCP (Model Context Protocol) tool calling, command execution, safety sandboxing, and diff generation. The crate provides the core business logic that bridges user-facing interfaces with backend services, authentication, configuration management, and various AI model providers.

### exec (`codex-exec`)

The `codex-exec` crate provides a non-interactive CLI binary that invokes the Codex AI agent as a headless subprocess. It accepts a prompt (from arguments or stdin), manages configuration overrides, processes events from the Codex conversation engine, and outputs results either in human-readable format or structured JSONL for automation. The crate also supports advanced features like conversation resumption, sandbox policy configuration, structured output schemas, and integration with local OSS models via Ollama.

### execpolicy (`codex-execpolicy`)

The `codex-execpolicy` crate is a policy-based validation system for `execv(3)` system calls that classifies command execution requests into safety states (safe, match, forbidden, or unverified) by checking them against a Starlark-based policy file. It parses command programs and arguments to identify file access types (readable/writeable files, literals, etc.) and validates them against predefined program specifications that define allowed flags, options, and argument patterns, enabling autonomous agents to safely execute shell commands with controlled file access.

### feedback (`codex-feedback`)

The `codex-feedback` crate provides a ring-buffer-based logging system that captures diagnostic feedback and error logs from Codex CLI sessions, allowing users to snapshot and upload these logs to Sentry for debugging and issue tracking. The crate implements a bounded circular buffer that retains the most recent logs (up to 4 MiB by default) and provides functionality to save snapshots to temporary files or send them to Sentry with optional attachments and custom classifications (bug, bad_result, good_result, etc.). It integrates with the tracing-subscriber framework to capture log output and supports uploading context like rollout configurations alongside logs for comprehensive error diagnostics.

### file-search (`codex-file-search`)

The `codex-file-search` crate is a high-performance fuzzy file search tool that recursively searches a directory using fuzzy pattern matching, respecting `.gitignore` rules and other ignore patterns. It leverages the `ignore` crate (used by ripgrep) for efficient multi-threaded directory traversal and the `nucleo-matcher` crate for fuzzy matching, returning scored results sorted by relevance with optional character indices for highlighting matched portions of file paths. The crate supports excluding patterns, custom thread counts, respecting/ignoring gitignore rules, and is available as both a library and a CLI binary with JSON output support.

### keyring-store (`codex-keyring-store`)

The `codex-keyring-store` crate provides a secure credential storage abstraction that wraps the system keyring/keychain across multiple platforms (macOS, Linux, and Windows). It defines a `KeyringStore` trait with load, save, and delete operations for managing credentials by service and account, along with a default implementation (`DefaultKeyringStore`) that delegates to the platform-specific keyring backends and includes a `MockKeyringStore` for testing purposes.

### linux-sandbox (`codex-linux-sandbox`)

The `codex-linux-sandbox` crate provides Linux-specific sandboxing capabilities for the Codex project by enforcing security policies through kernel-level mechanisms. It uses Landlock for filesystem access control and seccomp filters to restrict network operations and system calls, allowing processes to run with granular constraints on disk write access and network connectivity while maintaining read access where permitted. Policies are applied at the thread level so only child processes inherit the restrictions, not the parent CLI process.

### login (`codex-login`)

The `codex-login` crate implements OAuth2 authentication flows for Codex, providing two primary authentication mechanisms: an OAuth2 authorization code flow with PKCE (Proof Key for Code Exchange) via a local login server, and a device code authentication flow for headless environments. The crate spawns a lightweight HTTP server on port 1455 to handle OAuth2 callbacks, manages the PKCE challenge/verifier process for secure authorization, and persists authentication credentials (tokens and workspace information) to the user's Codex home directory for subsequent CLI sessions.

### mcp-server (`codex-mcp-server`)

The `codex-mcp-server` crate is a Model Context Protocol (MCP) server implementation that acts as a bridge between MCP clients and the Codex core functionality, handling JSON-RPC message processing over stdin/stdout. It implements the MCP specification to expose Codex tools and conversations as MCP resources and tools, allowing external clients to interact with Codex's capabilities through the standardized protocol. The server manages conversation state, processes tool calls, handles authorization and authentication, and supports approval workflows for code execution and patches.

### mcp-types (`mcp-types`)

The `mcp-types` crate provides Rust type definitions and serialization support for the Model Context Protocol (MCP) specification. It generates and maintains serializable Rust structs for all MCP messages, requests, responses, and notifications (version 2025-06-18), enabling seamless JSON-RPC communication between MCP clients and servers by supporting serde serialization, JSON schema generation, and TypeScript type exports. The crate serves as the foundation for both client and server implementations that need to exchange structured data.

### ollama (`codex-ollama`)

The `codex-ollama` crate provides a client library for interacting with local Ollama instances to support open-source model inference. It manages connections to Ollama servers, fetches available models, downloads (pulls) models with progress tracking, and supports both native Ollama and OpenAI-compatible API endpoints. The crate includes a pluggable progress reporting system and is used to ensure that open-source models are available locally before running AI-assisted development tasks.

### otel (`codex-otel`)

The `codex-otel` crate provides OpenTelemetry (OTEL) instrumentation and observability capabilities for the Codex CLI application. It exports structured telemetry events (such as conversation starts, API requests, tool execution, sandbox assessments) to OTLP (OpenTelemetry Protocol) endpoints via configurable gRPC or HTTP exporters, enabling monitoring and analysis of application behavior. The crate's `OtelEventManager` creates detailed, structured logs with rich contextual metadata (conversation IDs, model info, user details, token counts, latencies) that can be shipped to observability platforms, with an optional compile-time feature flag to disable OTEL support entirely.

### process-hardening (`codex-process-hardening`)

The `codex-process-hardening` crate provides a `pre_main_hardening()` function that hardens the security of the Codex process by disabling core dumps, preventing ptrace debugging attach on Linux and macOS, and removing dangerous environment variables like `LD_PRELOAD` and `DYLD_*` that could be exploited for library injection attacks. The function is platform-specific, implementing security hardening for Linux, Android, macOS, and Windows to protect the process from debugger attachment and sensitive data leakage through core dumps before the main application logic executes.

### protocol (`codex-protocol`)

The `codex-protocol` crate defines the core communication protocol for Codex sessions between clients and agents, using a Submission Queue (SQ) / Event Queue (EQ) asynchronous messaging pattern. It provides serializable data structures for managing conversations, user inputs, message history, approvals, account information, and various protocol-level constructs like tools, resources, and response items. This crate serves as the shared contract for the entire Codex system, enabling interoperability between different components like the CLI, app-server, and MCP server while maintaining type safety through serde serialization and TypeScript type generation.

### protocol-ts (`codex-protocol-ts`)

The `codex-protocol-ts` crate is a TypeScript code generator that automatically generates TypeScript type bindings from Rust protocol definitions. It takes Rust message types (ClientRequest, ServerRequest, ClientNotification, ServerNotification, and their responses) from the codex-app-server-protocol crate and converts them into TypeScript type definitions using the ts-rs library. The crate serves as a build-time tool that produces formatted, well-organized TypeScript files with an index file for easy imports, enabling seamless type safety between the Rust backend and TypeScript/JavaScript clients.

### responses-api-proxy (`codex-responses-api-proxy`)

The `codex-responses-api-proxy` crate implements a minimal OpenAI-compatible HTTP proxy server that forwards POST requests to OpenAI's responses API endpoint while handling authentication securely. It reads the API key from stdin with careful memory protection (using mlock on Unix to prevent key exposure) and forwards only legitimate requests to `/v1/responses`, rejecting all other paths and HTTP methods with a 403 response. The proxy runs as a standalone binary with configurable port and upstream URL, making it useful for applications that need to proxy API calls while keeping credentials isolated from the application logic.

### rmcp-client (`codex-rmcp-client`)

The `codex-rmcp-client` crate is a Rust implementation of an MCP (Model Context Protocol) client built on top of the official `rmcp` SDK that handles connections to MCP servers through multiple transport mechanisms. It supports both child process (stdio) and HTTP-based transports, with built-in OAuth authentication handling, secure credential storage via OS-specific keyrings (macOS Keychain, Windows Credential Manager, Linux Secret Service), and fallback to file-based storage. This crate abstracts the complexity of managing MCP client connections, authentication, and protocol operations for use throughout the Codex CLI tool.

### stdio-to-uds (`codex-stdio-to-uds`)

The `codex-stdio-to-uds` crate is a bidirectional relay that bridges standard input/output with Unix Domain Sockets (UDS). It accepts a socket path as a command-line argument, connects to the UDS, and simultaneously relays data from stdin to the socket and from the socket to stdout using separate threads. This utility is used to enable process communication over UDS while transparently passing data through standard I/O streams, with cross-platform support including Windows via the uds_windows library.

### tui (`codex-tui`)

The `codex-tui` crate is a terminal user interface (TUI) application built with Ratatui and Crossterm that provides an interactive, feature-rich CLI client for the Codex AI assistant. It handles real-time streaming conversations with Claude, rendering markdown and syntax-highlighted code, managing file search/selection, executing commands with approval flows, displaying diffs, and supporting advanced features like session history, resume picker, clipboard integration, and model configuration. The crate manages the complete TUI lifecycle including event handling, terminal mode management, rendering, and integrations with the codex-core conversation engine and MCP (Model Context Protocol) tools.

### utils/cache (`codex-utils-cache`)

The `codex-utils-cache` crate provides a thread-safe, async-compatible LRU (Least Recently Used) cache wrapper designed for Tokio-based applications. It wraps the standard `lru` crate with Tokio's Mutex for safe concurrent access and offers convenient methods for cache operations like `get_or_insert_with` and `get_or_try_insert_with`. The crate also includes a SHA-1 digest utility function for generating content-based cache keys to prevent staleness issues with path-only keys.

### utils/git (`codex-git`)

The `codex-git` crate is a Git utility library that provides helpers for managing repository snapshots and applying patches. It enables creating "ghost commits" (temporary snapshots of repository state with metadata about untracked files), applying unified diffs via the `git apply` command with preflight/dry-run capabilities, and low-level Git operations like resolving repository roots and checking repository status. This utility is primarily used by Codex for capturing and restoring project state during AI-assisted code editing workflows.

### utils/image (`codex-utils-image`)

The `codex-utils-image` crate is a utility library for processing and preparing images for upload, providing functionality to load, resize, and encode images to fit within maximum dimensions (2048x768 pixels) while maintaining their format and quality. It includes an LRU cache layer to optimize repeated processing of the same image file, and can convert images to base64 data URLs for embedding in web requests or API payloads. The crate supports PNG and JPEG formats with proper error handling for file I/O, decoding, and encoding operations.

### utils/json-to-toml (`codex-utils-json-to-toml`)

The `codex-utils-json-to-toml` crate is a lightweight utility that converts `serde_json::Value` into semantically equivalent `toml::Value` representations. It handles all JSON data types including objects, arrays, numbers, booleans, strings, and null values, with null being converted to an empty string, and supports recursive conversion of nested structures. This crate serves as a data format bridge utility used internally within the Codex project for converting configuration or data that arrives in JSON format into TOML representation.

### utils/pty (`codex-utils-pty`)

The `codex-utils-pty` crate provides a Rust abstraction for spawning and managing interactive terminal (PTY) processes with bidirectional communication. It uses the `portable-pty` library to create pseudo-terminal sessions, allowing programs to be executed with configurable environment variables, working directories, and arguments, while enabling asynchronous input/output handling through Tokio channels. The crate is used to spawn shell commands or interactive programs that need full terminal capabilities, with features for monitoring process exit status, sending input via channels, and receiving output streams in real-time.

### utils/readiness (`codex-utils-readiness`)

The `codex-utils-readiness` crate provides a token-based synchronization primitive for asynchronous Rust applications using Tokio. It implements a `ReadinessFlag` that coordinates startup completion through a subscription-based authorization system where callers must obtain a token before they can mark the flag as ready, and provides async-friendly waiting mechanisms for other tasks to detect when the flag becomes ready. This is useful for ensuring that multiple asynchronous components complete their initialization before allowing the system to proceed.

### utils/string (`codex-utils-string`)

The `codex-utils-string` crate provides UTF-8-safe string truncation utilities for working with byte budgets. It exposes two key functions: `take_bytes_at_char_boundary()` to truncate a string prefix while respecting UTF-8 character boundaries, and `take_last_bytes_at_char_boundary()` to extract a suffix within a byte limit. This is essential for scenarios where strings need to fit within fixed byte limits without corrupting multibyte UTF-8 characters.

### utils/tokenizer (`codex-utils-tokenizer`)

The `codex-utils-tokenizer` crate is a thin wrapper around the `tiktoken-rs` library that provides text tokenization capabilities for Codex. It supports two OpenAI token encodings (o200k_base and cl100k_base), enabling conversion of text to token IDs for use in language model operations like counting tokens and encoding/decoding text. The crate offers convenient APIs for creating tokenizers by encoding kind or model name, with automatic fallback to o200k_base for unknown models.
