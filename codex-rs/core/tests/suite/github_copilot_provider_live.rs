#![allow(clippy::expect_used)]

use codex_core::WireApi;
use codex_core::config::ConfigOverrides;
use codex_core::protocol::AskForApproval;
use codex_protocol::config_types::SandboxMode;
use pretty_assertions::assert_eq;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn github_copilot_provider_is_available_and_uses_opencode_auth() {
    let auth_path = codex_github::find_opencode_auth_path();
    assert!(
        auth_path.is_some(),
        "OpenCode auth.json not found; this live test requires Copilot login via OpenCode."
    );

    let auth = codex_github::OpenCodeAuth::load().expect("load opencode auth");
    assert!(
        auth.as_ref()
            .and_then(codex_github::OpenCodeAuth::get_any_copilot)
            .is_some(),
        "OpenCode auth.json missing github-copilot entries; log in to Copilot via OpenCode first."
    );

    // Ensure the provider can be selected via config overrides.
    let overrides = ConfigOverrides {
        model: Some("gpt-4.1".to_string()),
        model_provider: Some("github".to_string()),
        approval_policy: Some(AskForApproval::Never),
        sandbox_mode: Some(SandboxMode::DangerFullAccess),
        ..Default::default()
    };
    let cfg = codex_core::config::Config::load_with_cli_overrides_and_harness_overrides(
        Vec::new(),
        overrides,
    )
    .await
    .expect("load config");

    assert_eq!(cfg.model_provider_id, "github");
    assert_eq!(cfg.model_provider.wire_api, WireApi::Responses);

    // Basic sanity: auth helper can produce a token.
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let client = reqwest::Client::new();
    let token = codex_github::load_or_refresh_copilot_token(
        &client,
        codex_github::copilot_default_headers(),
        now_ms,
    )
    .await
    .expect("load/refresh token");
    assert!(!token.token.trim().is_empty());
}
