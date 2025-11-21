// Section 4: TUI (Terminal User Interface) Bindings
// ============================================================================
//
// This section provides bindings for the interactive terminal UI, allowing
// seamless transition from programmatic to interactive agent interaction.
//
// The TUI uses the same `codex_tui::run_main()` implementation as the
// standalone Rust CLI, ensuring identical user experience.
//
// Key exports:
//   - run_tui(): Launch full-screen interactive TUI
//   - tui_test_run(): Headless TUI rendering for testing
//
// ============================================================================

#[napi(object)]
pub struct TuiRequest {
  pub prompt: Option<String>,
  #[napi(js_name = "images")]
  pub images: Option<Vec<String>>,
  pub model: Option<String>,
  pub oss: Option<bool>,
  #[napi(js_name = "sandboxMode")]
  pub sandbox_mode: Option<String>,
  #[napi(js_name = "approvalMode")]
  pub approval_mode: Option<String>,
  #[napi(js_name = "resumeSessionId")]
  pub resume_session_id: Option<String>,
  #[napi(js_name = "resumeLast")]
  pub resume_last: Option<bool>,
  #[napi(js_name = "resumePicker")]
  pub resume_picker: Option<bool>,
  #[napi(js_name = "fullAuto")]
  pub full_auto: Option<bool>,
  #[napi(js_name = "dangerouslyBypassApprovalsAndSandbox")]
  pub dangerously_bypass_approvals_and_sandbox: Option<bool>,
  #[napi(js_name = "workingDirectory")]
  pub working_directory: Option<String>,
  #[napi(js_name = "configProfile")]
  pub config_profile: Option<String>,
  #[napi(js_name = "configOverrides")]
  pub config_overrides: Option<Vec<String>>,
  #[napi(js_name = "addDir")]
  pub add_dir: Option<Vec<String>>,
  #[napi(js_name = "webSearch")]
  pub web_search: Option<bool>,
  #[napi(js_name = "linuxSandboxPath")]
  pub linux_sandbox_path: Option<String>,
  #[napi(js_name = "baseUrl")]
  pub base_url: Option<String>,
  #[napi(js_name = "apiKey")]
  pub api_key: Option<String>,
  #[napi(js_name = "reasoningEffort")]
  pub reasoning_effort: Option<String>,
  #[napi(js_name = "reasoningSummary")]
  pub reasoning_summary: Option<String>,
}

#[derive(Debug)]
#[allow(dead_code)]
struct InternalTuiRequest {
  cli: TuiCli,
  base_url: Option<String>,
  api_key: Option<String>,
  linux_sandbox_path: Option<PathBuf>,
  reasoning_effort: Option<ReasoningEffort>,
  reasoning_summary: Option<ReasoningSummary>,
}

impl TuiRequest {
  fn into_internal(self) -> napi::Result<InternalTuiRequest> {
    let sandbox_mode = parse_sandbox_mode(self.sandbox_mode.as_deref())?;
    let approval_mode = parse_approval_mode(self.approval_mode.as_deref())?;
    let reasoning_effort = parse_reasoning_effort(self.reasoning_effort.as_deref())?;
    let reasoning_summary = parse_reasoning_summary(self.reasoning_summary.as_deref())?;

    let images = self
      .images
      .unwrap_or_default()
      .into_iter()
      .map(PathBuf::from)
      .collect();
    let add_dir = self
      .add_dir
      .unwrap_or_default()
      .into_iter()
      .map(PathBuf::from)
      .collect();
    let cli = TuiCli {
      prompt: self.prompt,
      images,
      resume_picker: self.resume_picker.unwrap_or(false),
      resume_last: self.resume_last.unwrap_or(false),
      resume_session_id: self.resume_session_id,
      model: self.model,
      oss: self.oss.unwrap_or(false),
      config_profile: self.config_profile,
      sandbox_mode,
      approval_policy: approval_mode,
      full_auto: self.full_auto.unwrap_or(false),
      dangerously_bypass_approvals_and_sandbox: self
        .dangerously_bypass_approvals_and_sandbox
        .unwrap_or(false),
      cwd: self.working_directory.map(PathBuf::from),
      web_search: self.web_search.unwrap_or(false),
      add_dir,
      config_overrides: CliConfigOverrides {
        raw_overrides: self.config_overrides.unwrap_or_default(),
      },
    };

    Ok(InternalTuiRequest {
      cli,
      base_url: self.base_url,
      api_key: self.api_key,
      linux_sandbox_path: self.linux_sandbox_path.map(PathBuf::from),
      reasoning_effort,
      reasoning_summary,
    })
  }
}

#[napi(object)]
pub struct TuiTestViewport {
  pub x: u16,
  pub y: u16,
  pub width: u16,
  pub height: u16,
}

#[napi(object)]
pub struct TuiTestRequest {
  pub width: u16,
  pub height: u16,
  pub viewport: TuiTestViewport,
  pub lines: Vec<String>,
}

#[napi]
pub fn tui_test_run(req: TuiTestRequest) -> napi::Result<Vec<String>> {
  use ratatui::layout::Rect;
  use ratatui::text::Line;

  let backend = Vt100Backend::new(req.width, req.height);
  let mut term = codex_tui::custom_terminal::Terminal::with_options(backend)
    .map_err(|e| napi::Error::from_reason(e.to_string()))?;
  let vp = req.viewport;
  term.set_viewport_area(Rect::new(vp.x, vp.y, vp.width, vp.height));

  let lines: Vec<Line<'static>> = req.lines.into_iter().map(|s| s.into()).collect();
  codex_tui::insert_history::insert_history_lines(&mut term, lines)
    .map_err(|e| napi::Error::from_reason(e.to_string()))?;

  // Return the full screen content like the Rust tests do
  let snapshot = term.backend().as_string();
  Ok(vec![snapshot])
}
#[napi(object)]
#[derive(Clone, Debug)]
pub struct TokenUsageSummary {
  #[napi(js_name = "inputTokens")]
  pub input_tokens: i64,
  #[napi(js_name = "cachedInputTokens")]
  pub cached_input_tokens: i64,
  #[napi(js_name = "outputTokens")]
  pub output_tokens: i64,
  #[napi(js_name = "reasoningOutputTokens")]
  pub reasoning_output_tokens: i64,
  #[napi(js_name = "totalTokens")]
  pub total_tokens: i64,
}

impl From<TokenUsage> for TokenUsageSummary {
  fn from(value: TokenUsage) -> Self {
    Self {
      input_tokens: value.input_tokens,
      cached_input_tokens: value.cached_input_tokens,
      output_tokens: value.output_tokens,
      reasoning_output_tokens: value.reasoning_output_tokens,
      total_tokens: value.total_tokens,
    }
  }
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct UpdateActionInfo {
  pub kind: String,
  pub command: String,
}

impl From<UpdateAction> for UpdateActionInfo {
  fn from(action: UpdateAction) -> Self {
    let kind = match action {
      UpdateAction::NpmGlobalLatest => "npmGlobalLatest",
      UpdateAction::BunGlobalLatest => "bunGlobalLatest",
      UpdateAction::BrewUpgrade => "brewUpgrade",
    }
    .to_string();

    Self {
      kind,
      command: action.command_str(),
    }
  }
}

#[napi(object)]
pub struct TuiExitInfo {
  #[napi(js_name = "tokenUsage")]
  pub token_usage: TokenUsageSummary,
  #[napi(js_name = "conversationId")]
  pub conversation_id: Option<String>,
  #[napi(js_name = "updateAction")]
  pub update_action: Option<UpdateActionInfo>,
}

impl From<AppExitInfo> for TuiExitInfo {
  fn from(info: AppExitInfo) -> Self {
    let token_usage = TokenUsageSummary::from(info.token_usage);
    let conversation_id = info.conversation_id.map(|id| id.to_string());
    let update_action = info.update_action.map(UpdateActionInfo::from);
    Self {
      token_usage,
      conversation_id,
      update_action,
    }
  }
}

struct TuiSessionState {
  join: Option<JoinHandle<napi::Result<TuiExitInfo>>>,
  closed: bool,
}

#[napi]
pub struct TuiSession {
  state: Arc<Mutex<TuiSessionState>>,
  cancel_token: CancellationToken,
}

impl TuiSession {
  fn new(join: JoinHandle<napi::Result<TuiExitInfo>>, cancel_token: CancellationToken) -> Self {
    Self {
      state: Arc::new(Mutex::new(TuiSessionState {
        join: Some(join),
        closed: false,
      })),
      cancel_token,
    }
  }

  fn lock_state(&self) -> napi::Result<std::sync::MutexGuard<'_, TuiSessionState>> {
    self
      .state
      .lock()
      .map_err(|err| napi::Error::from_reason(format!("TUI session mutex poisoned: {err}")))
  }

  async fn wait_internal(&self) -> napi::Result<TuiExitInfo> {
    let join_handle = {
      let mut state = self.lock_state()?;
      if state.closed {
        return Err(napi::Error::from_reason("TUI session already closed"));
      }
      state
        .join
        .take()
        .ok_or_else(|| napi::Error::from_reason("TUI session already awaited"))?
    };

    let join_result = tokio::task::spawn_blocking(move || join_handle.join())
      .await
      .map_err(|err| napi::Error::from_reason(format!("Task join error: {err}")))?;

    let result = join_result
      .map_err(|err| napi::Error::from_reason(format!("TUI session panicked: {:?}", err)))?;

    {
      let mut state = self.lock_state()?;
      state.closed = true;
    }

    result
  }
}

#[napi]
impl TuiSession {
  #[napi]
  pub async fn wait(&self) -> napi::Result<TuiExitInfo> {
    self.wait_internal().await
  }

  #[napi]
  pub fn shutdown(&self) {
    self.cancel_token.cancel();
  }

  #[napi(getter)]
  pub fn closed(&self) -> bool {
    match self.state.lock() {
      Ok(state) => state.closed,
      Err(_) => true,
    }
  }
}

impl Drop for TuiSession {
  fn drop(&mut self) {
    self.cancel_token.cancel();
  }
}

fn run_tui_sync(
  options: InternalTuiRequest,
  shutdown_token: Option<CancellationToken>,
) -> napi::Result<TuiExitInfo> {
  ensure_apply_patch_aliases()?;
  let InternalTuiRequest {
    mut cli,
    base_url,
    api_key,
    linux_sandbox_path,
    reasoning_effort,
    reasoning_summary,
  } = options;

  apply_reasoning_overrides(&mut cli, reasoning_effort, reasoning_summary);

  let pending_tools = {
    let guard = registered_native_tools()
      .lock()
      .map_err(|e| napi::Error::from_reason(format!("tools mutex poisoned: {e}")))?;
    guard.clone()
  };
  set_pending_external_tools(pending_tools);

  let pending_interceptors = {
    let guard = registered_native_interceptors()
      .lock()
      .map_err(|e| napi::Error::from_reason(format!("interceptors mutex poisoned: {e}")))?;
    guard
      .iter()
      .map(|n| ExternalInterceptorRegistration {
        name: n.tool_name.clone(),
        handler: Arc::clone(&n.handler),
      })
      .collect::<Vec<_>>()
  };
  set_pending_external_interceptors(pending_interceptors);

  let mut env_pairs: Vec<(&'static str, Option<String>, bool)> = Vec::new();
  if std::env::var(ORIGINATOR_ENV).is_err() {
    env_pairs.push((ORIGINATOR_ENV, Some(NATIVE_ORIGINATOR.to_string()), true));
  }
  if let Some(base_url) = base_url {
    env_pairs.push(("OPENAI_BASE_URL", Some(base_url), true));
  }
  if let Some(api_key) = api_key {
    env_pairs.push(("CODEX_API_KEY", Some(api_key), true));
  }

  let linux_sandbox_path = if let Some(path) = linux_sandbox_path {
    Some(path)
  } else if let Ok(path) = std::env::var("CODEX_LINUX_SANDBOX_EXE") {
    Some(PathBuf::from(path))
  } else {
    default_linux_sandbox_path()?
  };

  if let Some(path) = linux_sandbox_path.as_ref() {
    env_pairs.push((
      "CODEX_LINUX_SANDBOX_EXE",
      Some(path.to_string_lossy().to_string()),
      false,
    ));
  }

  let _env_guard = EnvOverrides::apply(env_pairs);

  let runtime = tokio::runtime::Runtime::new()
    .map_err(|e| napi::Error::from_reason(format!("Failed to create runtime: {e}")))?;
  let result = runtime.block_on(async move {
    codex_tui::run_main(cli, linux_sandbox_path.clone(), shutdown_token)
      .await
      .map_err(|err| napi::Error::from_reason(err.to_string()))
  });
  drop(runtime);

  match result {
    Ok(exit_info) => Ok(TuiExitInfo::from(exit_info)),
    Err(err) => Err(err),
  }
}

fn apply_reasoning_overrides(
  cli: &mut TuiCli,
  effort: Option<ReasoningEffort>,
  summary: Option<ReasoningSummary>,
) {
  if let Some(effort) = effort {
    cli
      .config_overrides
      .raw_overrides
      .push(format!("model_reasoning_effort={}", effort.to_string().to_lowercase()));
  }
  if let Some(summary) = summary {
    cli
      .config_overrides
      .raw_overrides
      .push(format!("model_reasoning_summary={}", summary.to_string().to_lowercase()));
  }
}

#[napi]
pub fn start_tui(req: TuiRequest) -> napi::Result<TuiSession> {
  let options = req.into_internal()?;
  let cancel_token = CancellationToken::new();
  let blocking_token = cancel_token.clone();
  let join_handle = std::thread::spawn(move || run_tui_sync(options, Some(blocking_token)));
  Ok(TuiSession::new(join_handle, cancel_token))
}

#[napi]
pub async fn run_tui(req: TuiRequest) -> napi::Result<TuiExitInfo> {
  let session = start_tui(req)?;
  session.wait().await
}

#[cfg(test)]
mod tests_tui_reasoning_overrides {
  use super::*;

  #[test]
  fn apply_reasoning_overrides_sets_raw_overrides() {
    let mut cli = TuiCli {
      prompt: None,
      images: Vec::new(),
      resume_picker: false,
      resume_last: false,
      resume_session_id: None,
      model: None,
      oss: false,
      config_profile: None,
      sandbox_mode: None,
      approval_policy: None,
      full_auto: false,
      dangerously_bypass_approvals_and_sandbox: false,
      cwd: None,
      web_search: false,
      add_dir: Vec::new(),
      config_overrides: CliConfigOverrides { raw_overrides: Vec::new() },
    };

    apply_reasoning_overrides(&mut cli, Some(ReasoningEffort::High), Some(ReasoningSummary::Concise));

    assert!(cli
      .config_overrides
      .raw_overrides
      .contains(&"model_reasoning_effort=high".to_string()));
    assert!(cli
      .config_overrides
      .raw_overrides
      .contains(&"model_reasoning_summary=concise".to_string()));
  }
}
