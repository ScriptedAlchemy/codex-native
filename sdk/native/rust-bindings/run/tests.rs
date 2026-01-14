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
      full_auto: true,
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
  fn accepts_gpt_4_1_when_provider_is_non_default() {
    assert!(validate_model_name(Some("gpt-4.1"), false, Some("github")).is_ok());
  }

}
