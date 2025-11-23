mod auth_fixtures;
mod mcp_process;
mod mock_model_server;
mod responses;
mod rollout;

pub use auth_fixtures::ChatGptAuthFixture;
pub use auth_fixtures::ChatGptIdTokenClaims;
pub use auth_fixtures::encode_id_token;
pub use auth_fixtures::write_chatgpt_auth;
use codex_app_server_protocol::JSONRPCResponse;
pub use core_test_support::format_with_current_shell;
pub use core_test_support::format_with_current_shell_display;
pub use mcp_process::McpProcess;
pub use mock_model_server::create_mock_chat_completions_server;
pub use mock_model_server::create_mock_chat_completions_server_unchecked;
pub use responses::create_apply_patch_sse_response;
pub use responses::create_final_assistant_message_sse_response;
pub use responses::create_shell_command_sse_response;
pub use rollout::create_fake_rollout;
use serde::de::DeserializeOwned;
use std::env;
use std::path::Path;
use std::path::PathBuf;

pub fn to_response<T: DeserializeOwned>(response: JSONRPCResponse) -> anyhow::Result<T> {
    let value = serde_json::to_value(response.result)?;
    let codex_response = serde_json::from_value(value)?;
    Ok(codex_response)
}

pub fn find_binary(name: &str) -> anyhow::Result<PathBuf> {
    let env_keys = [
        format!("CARGO_BIN_EXE_{name}"),
        format!("CARGO_BIN_EXE_{}", name.replace('-', "_")),
    ];
    for key in env_keys {
        if let Ok(path) = env::var(&key) {
            return Ok(PathBuf::from(path));
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    // Walk up to workspace root (codex-rs).
    let workspace_root = manifest_dir
        .parent()
        .and_then(|p| p.parent())
        .ok_or_else(|| anyhow::anyhow!("failed to locate workspace root from {manifest_dir:?}"))?;
    let exe_name = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    let target_root = workspace_root.join("target");
    let candidate_dirs = [
        target_root.join("test-cache"),
        target_root.join("debug"),
        target_root.join("release"),
    ];
    for dir in candidate_dirs {
        if let Some(path) = find_in_dir(&dir, &exe_name) {
            return Ok(path);
        }
    }

    Err(anyhow::anyhow!(
        "Unable to locate binary {name}; checked env vars and target directories"
    ))
}

fn find_in_dir(dir: &Path, file_stem: &str) -> Option<PathBuf> {
    let mut stack = vec![dir.to_path_buf()];
    while let Some(path) = stack.pop() {
        let entries = std::fs::read_dir(&path).ok()?;
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                stack.push(p);
                continue;
            }
            if let Some(fname) = p.file_name().and_then(|s| s.to_str()) {
                if fname.starts_with(file_stem) {
                    return Some(p);
                }
            }
        }
    }
    None
}
