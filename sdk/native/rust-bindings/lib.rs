// ============================================================================
// NAPI Bindings for Codex Native SDK
// ============================================================================
//
// This module provides Node.js bindings for the Codex SDK via NAPI-RS.
//
// The implementation has been split across multiple files for readability.
// Each section lives in its own sibling file which is `include!`-ed below.
// This keeps the crate structure flat (matching napi expectations) while
// avoiding a 3k-line single file.
// ============================================================================

#![deny(clippy::all)]

use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::OnceLock;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{SystemTime, UNIX_EPOCH};

use codex_arg0::prepend_path_entry_for_codex_aliases;
use fastembed::{
  EmbeddingModel, RerankInitOptions, RerankResult, RerankerModel, TextEmbedding, TextInitOptions,
  TextRerank,
};
use sha1::{Digest, Sha1};

use async_trait::async_trait;
use codex_cloud_tasks_client as cloud;
use codex_common::{ApprovalModeCliArg, CliConfigOverrides, SandboxModeCliArg};
use codex_core::BUILT_IN_OSS_MODEL_PROVIDER_ID;
use codex_core::config::{Config, ConfigOverrides, find_codex_home};
use codex_core::default_client;
use codex_core::find_conversation_path_by_id_str;
use codex_core::git_info::get_git_repo_root;
use codex_core::protocol::{AskForApproval, SessionSource, TokenUsage};
use codex_core::{AuthManager, ConversationItem, ConversationManager, RolloutRecorder};
use codex_core::{
  ExternalInterceptorRegistration, ExternalToolRegistration, FunctionCallError, ToolHandler,
  ToolInterceptor, ToolInvocation, ToolKind, ToolOutput, ToolPayload,
  create_function_tool_spec_from_schema, set_pending_external_interceptors,
  set_pending_external_tools,
};
use codex_exec::exec_events::{BackgroundEventEvent, ThreadEvent as ExecThreadEvent};
use codex_exec::run_with_thread_event_callback;
use codex_exec::{Cli, Color, Command, ResumeArgs};
use codex_protocol::config_types::{ReasoningEffort, ReasoningSummary, SandboxMode};
use codex_tui::AppExitInfo;
use codex_tui::Cli as TuiCli;
use codex_tui::update_action::UpdateAction;
use codex_utils_tokenizer::{EncodingKind, Tokenizer, TokenizerError};
use napi::bindgen_prelude::{Env, Function, Status};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use ratatui::backend::{Backend, ClearType, WindowSize};
use ratatui::buffer::Cell;
use ratatui::layout::{Position, Size};
use ratatui::prelude::CrosstermBackend;
use serde_json::Map as JsonMap;
use serde_json::Value as JsonValue;
use serde_json::json;
use serde_json::json as serde_json_json;
use std::fmt;
use std::io::{self, Write};
use tempfile::{NamedTempFile, TempDir};
use tokio_util::sync::CancellationToken;
use toml::Value as TomlValue;
use uuid::Uuid;

// ============================================================================
// Section 1: Platform-Specific Utilities
// ============================================================================

#[cfg(target_os = "linux")]
fn io_to_napi(err: std::io::Error) -> napi::Error {
  napi::Error::from_reason(err.to_string())
}

#[cfg(target_os = "linux")]
fn ensure_embedded_linux_sandbox() -> napi::Result<PathBuf> {
  use std::fs;
  use std::os::unix::fs::PermissionsExt;

  // Simplified: just create the sandbox each time if it doesn't exist
  // The filesystem acts as our "cache" - if the file exists, we don't recreate it
  let root = std::env::temp_dir().join("codex-native");
  fs::create_dir_all(&root).map_err(io_to_napi)?;
  let target_path = root.join("codex-linux-sandbox");

  // Only create if it doesn't exist
  if !target_path.exists() {
    let mut tmp = NamedTempFile::new_in(&root).map_err(io_to_napi)?;
    tmp
      .write_all(EMBEDDED_LINUX_SANDBOX_BYTES)
      .map_err(io_to_napi)?;
    tmp.flush().map_err(io_to_napi)?;

    let temp_path = tmp.into_temp_path();
    temp_path
      .persist(&target_path)
      .map_err(|err| io_to_napi(err.error))?;

    let mut perms = fs::metadata(&target_path)
      .map_err(io_to_napi)?
      .permissions();
    perms.set_mode(0o755);
    fs::set_permissions(&target_path, perms).map_err(io_to_napi)?;
  }

  Ok(target_path)
}

#[cfg(target_os = "linux")]
fn default_linux_sandbox_path() -> napi::Result<Option<PathBuf>> {
  ensure_embedded_linux_sandbox().map(Some)
}

#[cfg(not(target_os = "linux"))]
fn default_linux_sandbox_path() -> napi::Result<Option<PathBuf>> {
  Ok(None)
}

#[cfg(target_os = "linux")]
const EMBEDDED_LINUX_SANDBOX_BYTES: &[u8] = include_bytes!(env!("CODEX_LINUX_SANDBOX_BIN"));

const ORIGINATOR_ENV: &str = "CODEX_INTERNAL_ORIGINATOR_OVERRIDE";
const NATIVE_ORIGINATOR: &str = "codex_sdk_native";

static APPLY_PATCH_TEMP_DIR: OnceLock<Mutex<TempDir>> = OnceLock::new();

fn ensure_apply_patch_aliases() -> napi::Result<()> {
  if APPLY_PATCH_TEMP_DIR.get().is_some() {
    return Ok(());
  }

  let temp_dir = prepend_path_entry_for_codex_aliases().map_err(|err| {
    napi::Error::from_reason(format!("Failed to prepare apply_patch helper: {err}"))
  })?;

  if APPLY_PATCH_TEMP_DIR.set(Mutex::new(temp_dir)).is_err() {
    // Another thread initialized it first; that's fine.
  }

  Ok(())
}

// ============================================================================
// Additional Sections (included from sibling files)
// ============================================================================

// ============================================================================
// Additional Sections (included from sibling files)
// ============================================================================

include!("tools.rs");
include!("run.rs");
include!("tui.rs");
include!("git.rs");
include!("cloud_tasks.rs");
include!("events.rs");
include!("reverie.rs");
include!("fast_embed.rs");
include!("tokenizer.rs");
include!("toon.rs");
include!("graph/mod.rs");
