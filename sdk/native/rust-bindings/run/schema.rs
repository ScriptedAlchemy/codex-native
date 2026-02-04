async fn load_config_from_internal(options: &InternalRunRequest) -> napi::Result<Config> {
  let (overrides, cli_kv_overrides) =
    build_config_inputs(options, options.linux_sandbox_path.clone())?;
  Config::load_with_cli_overrides_and_harness_overrides(cli_kv_overrides, overrides)
    .await
    .map_err(|e| napi::Error::from_reason(e.to_string()))
}

fn ensure_trusted_directory_from_options(
  options: &InternalRunRequest,
  config: &Config,
) -> napi::Result<()> {
  if !options.skip_git_repo_check && get_git_repo_root(&config.cwd).is_none() {
    return Err(napi::Error::from_reason(
      "Not inside a trusted directory and --skip-git-repo-check was not specified.".to_string(),
    ));
  }
  Ok(())
}


fn build_config_inputs(
  options: &InternalRunRequest,
  linux_sandbox_path: Option<PathBuf>,
) -> napi::Result<(ConfigOverrides, Vec<(String, TomlValue)>)> {
  let cli = build_cli(options, None, false);
  let mut cli_kv_overrides = cli
    .config_overrides
    .parse_overrides()
    .map_err(|e| napi::Error::from_reason(format!("Failed to parse config overrides: {e}")))?;

  if let Some(effort) = options.reasoning_effort.as_ref() {
    cli_kv_overrides.push((
      "model_reasoning_effort".to_string(),
      TomlValue::String(effort.to_string().to_lowercase()),
    ));
  }
  if let Some(summary) = options.reasoning_summary.as_ref() {
    cli_kv_overrides.push((
      "model_reasoning_summary".to_string(),
      TomlValue::String(summary.to_string().to_lowercase()),
    ));
  }

  let cwd = options
    .working_directory
    .as_ref()
    .map(|path| path.canonicalize().unwrap_or_else(|_| path.clone()));

  let overrides = ConfigOverrides {
    model: options.model.clone(),
    review_model: None,
    cwd,
    approval_policy: approval_mode_cli_to_policy(options.approval_mode),
    sandbox_mode: sandbox_mode_cli_to_config(options.sandbox_mode),
    model_provider: options
      .model_provider
      .clone()
      .or_else(|| options.oss.then_some(codex_core::OLLAMA_OSS_PROVIDER_ID.to_string())),
    config_profile: None,
    codex_linux_sandbox_exe: linux_sandbox_path,
    base_instructions: None,
    developer_instructions: None,
    personality: None,
    compact_prompt: None,
    include_apply_patch_tool: None,
    show_raw_agent_reasoning: options.oss.then_some(true),
    tools_web_search_request: None,
    ephemeral: None,
    additional_writable_roots: Vec::new(),
  };

  Ok((overrides, cli_kv_overrides))
}
