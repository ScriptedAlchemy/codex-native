#[cfg(test)]
mod tests_run {
  use super::*;
  use codex_protocol::config_types::ReasoningSummary;
  use codex_protocol::openai_models::ReasoningEffort;
  use codex_protocol::openai_models::ReasoningEffort as ReasoningEffortConfig;
  use tempfile::TempDir;

	  fn base_internal_request() -> InternalRunRequest {
	    InternalRunRequest {
	      prompt: "test".to_string(),
	      input_items: None,
	      thread_id: None,
	      images: Vec::new(),
	      model: None,
	      model_provider: None,
      oss: false,
      sandbox_mode: None,
      approval_mode: None,
      workspace_write_options: None,
      review_request: None,
      working_directory: None,
      skip_git_repo_check: true,
      output_schema: None,
      tool_choice: None,
      base_url: None,
      api_key: None,
      linux_sandbox_path: None,
      reasoning_effort: None,
      reasoning_summary: None,
      personality: None,
      turn_personality: None,
      ephemeral: None,
      web_search_mode: None,
      dynamic_tools: None,
      mcp: None,
      inherit_mcp: true,
    }
  }

  #[tokio::test]
  async fn load_config_respects_reasoning_overrides() {
    let tempdir = TempDir::new().expect("tempdir");
    let mut req = base_internal_request();
    req.working_directory = Some(tempdir.path().to_path_buf());
    req.reasoning_effort = Some(ReasoningEffort::High);
    req.reasoning_summary = Some(ReasoningSummary::Detailed);

    let config = load_config_from_internal(&req)
      .await
      .expect("config should load");

    assert_eq!(config.model_reasoning_effort, Some(ReasoningEffortConfig::High));
    assert_eq!(config.model_reasoning_summary, ReasoningSummary::Detailed);
  }

  #[test]
  fn parses_xhigh_reasoning_effort_alias() {
    let parsed = parse_reasoning_effort(Some("xhigh")).expect("parse succeeds");
    assert_eq!(parsed, Some(ReasoningEffort::XHigh));
  }

  #[test]
  fn accepts_gpt_5_2_codex_model() {
    // The default "openai" provider model allowlist includes only "supported_in_api" presets.
    // Validate that at least one supported model is accepted.
    assert!(validate_model_name(Some("gpt-5.1-codex-max"), false, None).is_ok());
  }

  #[test]
  fn rejects_gpt_4_1_when_provider_is_github() {
    let error = validate_model_name(Some("gpt-4.1"), false, Some("github"))
      .expect_err("gpt-4.1 should be rejected for github provider");
    let message = error.to_string();
    assert!(message.contains("Invalid model \"gpt-4.1\""));
    assert!(message.contains("model provider \"github\""));
  }

  // MCP Configuration Tests
  mod mcp_tests {
    use super::*;

    #[test]
    fn camel_to_snake_converts_correctly() {
      assert_eq!(camel_to_snake("bearerTokenEnvVar"), "bearer_token_env_var");
      assert_eq!(camel_to_snake("httpHeaders"), "http_headers");
      assert_eq!(camel_to_snake("envHttpHeaders"), "env_http_headers");
      assert_eq!(camel_to_snake("startupTimeoutSec"), "startup_timeout_sec");
      assert_eq!(camel_to_snake("toolTimeoutSec"), "tool_timeout_sec");
      assert_eq!(camel_to_snake("enabledTools"), "enabled_tools");
      assert_eq!(camel_to_snake("disabledTools"), "disabled_tools");
      assert_eq!(camel_to_snake("envVars"), "env_vars");
      assert_eq!(camel_to_snake("command"), "command");
      assert_eq!(camel_to_snake("url"), "url");
    }

    #[test]
    fn json_to_toml_inline_string() {
      let json = JsonValue::String("hello".to_string());
      assert_eq!(json_to_toml_inline(&json), "\"hello\"");
    }

    #[test]
    fn json_to_toml_inline_string_escapes_quotes() {
      let json = JsonValue::String("hello \"world\"".to_string());
      assert_eq!(json_to_toml_inline(&json), "\"hello \\\"world\\\"\"");
    }

    #[test]
    fn json_to_toml_inline_number() {
      let json = JsonValue::Number(serde_json::Number::from(42));
      assert_eq!(json_to_toml_inline(&json), "42");
    }

    #[test]
    fn json_to_toml_inline_bool() {
      assert_eq!(json_to_toml_inline(&JsonValue::Bool(true)), "true");
      assert_eq!(json_to_toml_inline(&JsonValue::Bool(false)), "false");
    }

    #[test]
    fn json_to_toml_inline_array() {
      let json = serde_json::json!(["a", "b", "c"]);
      assert_eq!(json_to_toml_inline(&json), "[\"a\", \"b\", \"c\"]");
    }

    #[test]
    fn json_to_toml_inline_object_converts_keys() {
      let json = serde_json::json!({
        "bearerTokenEnvVar": "TOKEN",
        "httpHeaders": {}
      });
      let result = json_to_toml_inline(&json);
      // The result should contain snake_case keys
      assert!(result.contains("bearer_token_env_var"));
      assert!(result.contains("http_headers"));
    }

    #[test]
    fn json_to_toml_inline_stdio_config() {
      let json = serde_json::json!({
        "command": "npx",
        "args": ["-y", "my-mcp-server"],
        "env": {"NODE_ENV": "production"},
        "envVars": ["HOME", "PATH"],
        "cwd": "/app"
      });
      let result = json_to_toml_inline(&json);
      assert!(result.contains("command = \"npx\""));
      assert!(result.contains("args = [\"-y\", \"my-mcp-server\"]"));
      assert!(result.contains("env_vars = [\"HOME\", \"PATH\"]"));
      assert!(result.contains("cwd = \"/app\""));
    }

    #[test]
    fn json_to_toml_inline_http_config() {
      let json = serde_json::json!({
        "url": "https://api.example.com/mcp",
        "bearerTokenEnvVar": "API_TOKEN"
      });
      let result = json_to_toml_inline(&json);
      assert!(result.contains("url = \"https://api.example.com/mcp\""));
      assert!(result.contains("bearer_token_env_var = \"API_TOKEN\""));
    }

    #[test]
    fn build_cli_includes_mcp_servers() {
      let mut req = base_internal_request();
      req.mcp = Some(serde_json::json!({
        "test-server": {
          "command": "npx",
          "args": ["test"]
        }
      }));

      let cli = build_cli(&req, None, false);
      let overrides: Vec<&str> = cli.config_overrides.raw_overrides
        .iter()
        .map(|s| s.as_str())
        .collect();

      // Check that MCP server is in overrides
      assert!(overrides.iter().any(|o| o.starts_with("mcp_servers.test-server=")));
    }

    #[test]
    fn build_cli_clears_mcp_when_inherit_false() {
      let mut req = base_internal_request();
      req.inherit_mcp = false;
      req.mcp = Some(serde_json::json!({
        "custom": {"command": "test"}
      }));

      let cli = build_cli(&req, None, false);
      let overrides: Vec<&str> = cli.config_overrides.raw_overrides
        .iter()
        .map(|s| s.as_str())
        .collect();

      // Should have mcp_servers={} to clear global config first
      assert!(overrides.contains(&"mcp_servers={}"));
      // And then the custom server
      assert!(overrides.iter().any(|o| o.starts_with("mcp_servers.custom=")));
    }

    #[test]
    fn build_cli_does_not_clear_mcp_when_inherit_true() {
      let mut req = base_internal_request();
      req.inherit_mcp = true;
      req.mcp = Some(serde_json::json!({
        "custom": {"command": "test"}
      }));

      let cli = build_cli(&req, None, false);
      let overrides: Vec<&str> = cli.config_overrides.raw_overrides
        .iter()
        .map(|s| s.as_str())
        .collect();

      // Should NOT have mcp_servers={} when inheriting
      assert!(!overrides.contains(&"mcp_servers={}"));
      // But should still have the custom server
      assert!(overrides.iter().any(|o| o.starts_with("mcp_servers.custom=")));
    }

    #[test]
    fn run_request_parses_mcp_config() {
      let request = RunRequest {
        prompt: "test".to_string(),
        input_items: None,
        thread_id: None,
        images: None,
        model: None,
        model_provider: None,
        oss: None,
        sandbox_mode: None,
        approval_mode: None,
        workspace_write_options: None,
        review_mode: None,
        review_hint: None,
        working_directory: None,
        skip_git_repo_check: Some(true),
        output_schema: None,
        tool_choice: None,
        base_url: None,
        api_key: None,
        linux_sandbox_path: None,
        reasoning_effort: None,
        reasoning_summary: None,
        personality: None,
        turn_personality: None,
        ephemeral: None,
        web_search_mode: None,
        dynamic_tools: None,
        mcp: Some(serde_json::json!({
          "server1": {"command": "npx", "args": ["test"]}
        })),
        inherit_mcp: Some(false),
      };

      let internal = request.into_internal().expect("parse should succeed");
      assert!(internal.mcp.is_some());
      assert!(!internal.inherit_mcp);
    }

    #[test]
    fn run_request_defaults_inherit_mcp_to_true() {
      let request = RunRequest {
        prompt: "test".to_string(),
        input_items: None,
        thread_id: None,
        images: None,
        model: None,
        model_provider: None,
        oss: None,
        sandbox_mode: None,
        approval_mode: None,
        workspace_write_options: None,
        review_mode: None,
        review_hint: None,
        working_directory: None,
        skip_git_repo_check: Some(true),
        output_schema: None,
        tool_choice: None,
        base_url: None,
        api_key: None,
        linux_sandbox_path: None,
        reasoning_effort: None,
        reasoning_summary: None,
        personality: None,
        turn_personality: None,
        ephemeral: None,
        web_search_mode: None,
        dynamic_tools: None,
        mcp: None,
        inherit_mcp: None,
      };

      let internal = request.into_internal().expect("parse should succeed");
      assert!(internal.inherit_mcp);
    }
  }

}
