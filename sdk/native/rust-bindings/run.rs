
// Section 3: Run Request Handling (Thread Execution)
// ============================================================================
//
// This section handles execution of agent threads, including:
//   - RunRequest: Configuration for agent execution
//   - Thread streaming and event handling
//   - Compaction of conversation history
//
// Key exports:
//   - run_thread(): Execute agent with given configuration
//   - run_thread_stream(): Stream events during execution
//   - compact_thread(): Compact conversation history
//
// ============================================================================

#[napi(object)]
pub struct RunRequest {
  pub prompt: String,
  #[napi(js_name = "threadId")]
  pub thread_id: Option<String>,
  pub images: Option<Vec<String>>,
  pub model: Option<String>,
  #[napi(js_name = "oss")]
  pub oss: Option<bool>,
  #[napi(js_name = "sandboxMode")]
  pub sandbox_mode: Option<String>,
  #[napi(js_name = "approvalMode")]
  pub approval_mode: Option<String>,
  #[napi(js_name = "workspaceWriteOptions")]
  pub workspace_write_options: Option<WorkspaceWriteOptions>,
  #[napi(js_name = "reviewMode")]
  pub review_mode: Option<bool>,
  #[napi(js_name = "reviewHint")]
  pub review_hint: Option<String>,
  #[napi(js_name = "workingDirectory")]
  pub working_directory: Option<String>,
  #[napi(js_name = "skipGitRepoCheck")]
  pub skip_git_repo_check: Option<bool>,
  #[napi(js_name = "outputSchema")]
  pub output_schema: Option<JsonValue>,
  #[napi(js_name = "baseUrl")]
  pub base_url: Option<String>,
  #[napi(js_name = "apiKey")]
  pub api_key: Option<String>,
  #[napi(js_name = "linuxSandboxPath")]
  pub linux_sandbox_path: Option<String>,
  #[napi(js_name = "reasoningEffort")]
  pub reasoning_effort: Option<String>,
  #[napi(js_name = "reasoningSummary")]
  pub reasoning_summary: Option<String>,
  #[napi(js_name = "fullAuto")]
  pub full_auto: Option<bool>,
}

#[napi(object)]
pub struct ForkRequest {
  #[napi(js_name = "threadId")]
  pub thread_id: String,
  #[napi(js_name = "nthUserMessage")]
  pub nth_user_message: Option<u32>,
  #[napi(js_name = "model")]
  pub model: Option<String>,
  #[napi(js_name = "oss")]
  pub oss: Option<bool>,
  #[napi(js_name = "sandboxMode")]
  pub sandbox_mode: Option<String>,
  #[napi(js_name = "approvalMode")]
  pub approval_mode: Option<String>,
  #[napi(js_name = "workspaceWriteOptions")]
  pub workspace_write_options: Option<WorkspaceWriteOptions>,
  #[napi(js_name = "workingDirectory")]
  pub working_directory: Option<String>,
  #[napi(js_name = "skipGitRepoCheck")]
  pub skip_git_repo_check: Option<bool>,
  #[napi(js_name = "baseUrl")]
  pub base_url: Option<String>,
  #[napi(js_name = "apiKey")]
  pub api_key: Option<String>,
  #[napi(js_name = "linuxSandboxPath")]
  pub linux_sandbox_path: Option<String>,
  #[napi(js_name = "reasoningEffort")]
  pub reasoning_effort: Option<String>,
  #[napi(js_name = "reasoningSummary")]
  pub reasoning_summary: Option<String>,
  #[napi(js_name = "fullAuto")]
  pub full_auto: Option<bool>,
}

#[derive(Debug)]
pub struct InternalForkRequest {
  pub thread_id: String,
  pub nth_user_message: usize,
  pub run_options: InternalRunRequest,
}

#[derive(Default)]
#[napi(object)]
pub struct ConversationConfigRequest {
  #[napi(js_name = "model")]
  pub model: Option<String>,
  #[napi(js_name = "oss")]
  pub oss: Option<bool>,
  #[napi(js_name = "sandboxMode")]
  pub sandbox_mode: Option<String>,
  #[napi(js_name = "approvalMode")]
  pub approval_mode: Option<String>,
  #[napi(js_name = "workspaceWriteOptions")]
  pub workspace_write_options: Option<WorkspaceWriteOptions>,
  #[napi(js_name = "workingDirectory")]
  pub working_directory: Option<String>,
  #[napi(js_name = "skipGitRepoCheck")]
  pub skip_git_repo_check: Option<bool>,
  #[napi(js_name = "baseUrl")]
  pub base_url: Option<String>,
  #[napi(js_name = "apiKey")]
  pub api_key: Option<String>,
  #[napi(js_name = "linuxSandboxPath")]
  pub linux_sandbox_path: Option<String>,
  #[napi(js_name = "reasoningEffort")]
  pub reasoning_effort: Option<String>,
  #[napi(js_name = "reasoningSummary")]
  pub reasoning_summary: Option<String>,
  #[napi(js_name = "fullAuto")]
  pub full_auto: Option<bool>,
}

#[napi(object)]
pub struct ListConversationsRequest {
  #[napi(js_name = "config")]
  pub config: Option<ConversationConfigRequest>,
  #[napi(js_name = "pageSize")]
  pub page_size: Option<u32>,
  pub cursor: Option<String>,
  #[napi(js_name = "modelProviders")]
  pub model_providers: Option<Vec<String>>,
}

#[napi(object)]
pub struct ConversationSummary {
  pub id: String,
  pub path: String,
  #[napi(js_name = "createdAt")]
  pub created_at: Option<String>,
  #[napi(js_name = "updatedAt")]
  pub updated_at: Option<String>,
}

#[napi(object)]
pub struct ConversationListPage {
  pub conversations: Vec<ConversationSummary>,
  #[napi(js_name = "nextCursor")]
  pub next_cursor: Option<String>,
  #[napi(js_name = "numScannedFiles")]
  pub num_scanned_files: u32,
  #[napi(js_name = "reachedScanCap")]
  pub reached_scan_cap: bool,
}

#[napi(object)]
pub struct DeleteConversationRequest {
  pub id: String,
  #[napi(js_name = "config")]
  pub config: Option<ConversationConfigRequest>,
}

#[napi(object)]
pub struct DeleteConversationResult {
  pub deleted: bool,
}

#[napi(object)]
pub struct ResumeFromRolloutRequest {
  #[napi(js_name = "rolloutPath")]
  pub rollout_path: String,
  #[napi(js_name = "config")]
  pub config: Option<ConversationConfigRequest>,
}

#[napi(object)]
pub struct ForkResult {
  #[napi(js_name = "threadId")]
  pub thread_id: String,
  #[napi(js_name = "rolloutPath")]
  pub rollout_path: String,
}

#[derive(Debug, Clone)]
pub struct ReviewRequest {
  pub prompt: String,
  pub user_facing_hint: String,
}

#[derive(Debug)]
pub struct InternalRunRequest {
  pub prompt: String,
  pub thread_id: Option<String>,
  pub images: Vec<PathBuf>,
  pub model: Option<String>,
  pub oss: bool,
  pub sandbox_mode: Option<SandboxModeCliArg>,
  pub approval_mode: Option<ApprovalModeCliArg>,
  pub workspace_write_options: Option<WorkspaceWriteOptions>,
  pub review_request: Option<ReviewRequest>,
  pub working_directory: Option<PathBuf>,
  pub skip_git_repo_check: bool,
  pub output_schema: Option<JsonValue>,
  pub base_url: Option<String>,
  pub api_key: Option<String>,
  pub linux_sandbox_path: Option<PathBuf>,
  pub reasoning_effort: Option<ReasoningEffort>,
  pub reasoning_summary: Option<ReasoningSummary>,
  pub full_auto: bool,
}

impl ConversationConfigRequest {
  fn into_internal_request(self) -> napi::Result<InternalRunRequest> {
    let sandbox_mode = parse_sandbox_mode(self.sandbox_mode.as_deref())?;
    let approval_mode = parse_approval_mode(self.approval_mode.as_deref())?;
    let reasoning_effort = parse_reasoning_effort(self.reasoning_effort.as_deref())?;
    let reasoning_summary = parse_reasoning_summary(self.reasoning_summary.as_deref())?;

    Ok(InternalRunRequest {
      prompt: String::new(),
      thread_id: None,
      images: Vec::new(),
      model: self.model,
      oss: self.oss.unwrap_or(false),
      sandbox_mode,
      approval_mode,
      workspace_write_options: self.workspace_write_options,
      review_request: None,
      working_directory: self.working_directory.map(PathBuf::from),
      skip_git_repo_check: self.skip_git_repo_check.unwrap_or(false),
      output_schema: None,
      base_url: self.base_url,
      api_key: self.api_key,
      linux_sandbox_path: self.linux_sandbox_path.map(PathBuf::from),
      reasoning_effort,
      reasoning_summary,
      full_auto: self.full_auto.unwrap_or(true),
    })
  }
}

impl RunRequest {
  pub fn into_internal(self) -> napi::Result<InternalRunRequest> {
    let sandbox_mode = parse_sandbox_mode(self.sandbox_mode.as_deref())?;
    let approval_mode = parse_approval_mode(self.approval_mode.as_deref())?;
    let reasoning_effort = parse_reasoning_effort(self.reasoning_effort.as_deref())?;
    let reasoning_summary = parse_reasoning_summary(self.reasoning_summary.as_deref())?;

    let review_request = if self.review_mode.unwrap_or(false) {
      let prompt_trimmed = self.prompt.trim().to_string();
      if prompt_trimmed.is_empty() {
        return Err(napi::Error::from_reason(
          "Review mode requires a non-empty prompt".to_string(),
        ));
      }
      let hint = self
        .review_hint
        .unwrap_or_else(|| "code review".to_string());
      Some(ReviewRequest {
        prompt: prompt_trimmed,
        user_facing_hint: hint,
      })
    } else {
      None
    };

    let images = self
      .images
      .unwrap_or_default()
      .into_iter()
      .map(PathBuf::from)
      .collect();
    let working_directory = self.working_directory.map(PathBuf::from);

    if let Some(model_name) = self.model.as_deref() {
      let trimmed = model_name.trim();
      if self.oss.unwrap_or(false) {
        if !trimmed.starts_with("gpt-oss:") {
          return Err(napi::Error::from_reason(format!(
            "Invalid model \"{trimmed}\" for OSS mode. Use models prefixed with \"gpt-oss:\", e.g. \"gpt-oss:20b\"."
          )));
        }
      } else if trimmed != "gpt-5" && trimmed != "gpt-5-codex" && trimmed != "gpt-5-codex-mini" && trimmed != "gpt-5.1" && trimmed != "gpt-5.1-codex" && trimmed != "gpt-5.1-codex-mini" {
        return Err(napi::Error::from_reason(format!(
          "Invalid model \"{trimmed}\". Supported models are \"gpt-5\", \"gpt-5-codex\", \"gpt-5-codex-mini\", \"gpt-5.1\", \"gpt-5.1-codex\", or \"gpt-5.1-codex-mini\"."
        )));
      }
    }

    Ok(InternalRunRequest {
      prompt: self.prompt,
      thread_id: self.thread_id,
      images,
      model: self.model,
      oss: self.oss.unwrap_or(false),
      sandbox_mode,
      approval_mode,
      workspace_write_options: self.workspace_write_options,
      review_request,
      working_directory,
      skip_git_repo_check: self.skip_git_repo_check.unwrap_or(false),
      output_schema: self.output_schema,
      base_url: self.base_url,
      api_key: self.api_key,
      linux_sandbox_path: self.linux_sandbox_path.map(PathBuf::from),
      reasoning_effort,
      reasoning_summary,
      full_auto: self.full_auto.unwrap_or(true),
    })
  }
}

impl ForkRequest {
  fn into_internal(self) -> napi::Result<InternalForkRequest> {
    let thread_id = self.thread_id.trim().to_string();
    if thread_id.is_empty() {
      return Err(napi::Error::from_reason(
        "threadId must be provided for forkThread requests",
      ));
    }

    let nth_user_message = self
      .nth_user_message
      .ok_or_else(|| napi::Error::from_reason("nthUserMessage must be provided for forkThread"))?
      as usize;

    let run_request = RunRequest {
      prompt: String::new(),
      thread_id: Some(thread_id.clone()),
      images: None,
      model: self.model,
      oss: self.oss,
      sandbox_mode: self.sandbox_mode,
      approval_mode: self.approval_mode,
      workspace_write_options: self.workspace_write_options,
      working_directory: self.working_directory,
      skip_git_repo_check: self.skip_git_repo_check,
      output_schema: None,
      base_url: self.base_url,
      api_key: self.api_key,
      linux_sandbox_path: self.linux_sandbox_path,
      reasoning_effort: self.reasoning_effort,
      reasoning_summary: self.reasoning_summary,
      full_auto: self.full_auto,
      review_mode: None,
      review_hint: None,
    };

    let run_options = run_request.into_internal()?;

    Ok(InternalForkRequest {
      thread_id,
      nth_user_message,
      run_options,
    })
  }
}

// ============================================================================
struct TempSchemaFile {
  path: PathBuf,
  _guard: tempfile::TempPath,
}

fn prepare_schema(schema: Option<JsonValue>) -> napi::Result<Option<TempSchemaFile>> {
  if let Some(schema_value) = schema {
    let mut file = NamedTempFile::new().map_err(|e| napi::Error::from_reason(e.to_string()))?;
    serde_json::to_writer(&mut file, &schema_value)
      .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let path = file.path().to_path_buf();
    let temp_path = file.into_temp_path();
    Ok(Some(TempSchemaFile {
      path,
      _guard: temp_path,
    }))
  } else {
    Ok(None)
  }
}

struct EnvOverride {
  key: &'static str,
  previous: Option<String>,
}

struct EnvOverrides {
  entries: Vec<EnvOverride>,
}

impl EnvOverrides {
  fn apply(pairs: Vec<(&'static str, Option<String>, bool)>) -> Self {
    let mut entries = Vec::new();
    for (key, value, force) in pairs {
      if !force && value.is_none() {
        continue;
      }
      let previous = std::env::var(key).ok();
      match value {
        Some(val) => unsafe { std::env::set_var(key, val) },
        None if force => unsafe { std::env::remove_var(key) },
        None => {}
      }
      entries.push(EnvOverride { key, previous });
    }
    Self { entries }
  }
}

impl Drop for EnvOverrides {
  fn drop(&mut self) {
    for entry in self.entries.iter().rev() {
      if let Some(prev) = &entry.previous {
        unsafe { std::env::set_var(entry.key, prev) };
      } else {
        unsafe { std::env::remove_var(entry.key) };
      }
    }
  }
}

// --- Headless memory backend for TUI snapshots (no vt100 dependency) ---
struct MemoryBackend {
  width: u16,
  height: u16,
  // Row-major grid of chars
  grid: Vec<Vec<char>>,
  cursor: Position,
}

impl MemoryBackend {
  #[allow(dead_code)]
  fn new(width: u16, height: u16) -> Self {
    let w = width as usize;
    let h = height as usize;
    let grid = vec![vec![' '; w]; h];
    Self {
      width,
      height,
      grid,
      cursor: Position { x: 0, y: 0 },
    }
  }
}

impl Write for MemoryBackend {
  fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
    // Ignore raw writes; our draw() receives structured cells.
    Ok(buf.len())
  }
  fn flush(&mut self) -> io::Result<()> {
    Ok(())
  }
}

impl Backend for MemoryBackend {
  fn draw<'a, I>(&mut self, content: I) -> io::Result<()>
  where
    I: Iterator<Item = (u16, u16, &'a Cell)>,
  {
    for (x, y, cell) in content {
      if (x as usize) < self.grid[0].len() && (y as usize) < self.grid.len() {
        let ch = cell.symbol().chars().next().unwrap_or(' ');
        self.grid[y as usize][x as usize] = ch;
        self.cursor = Position { x, y };
      }
    }
    Ok(())
  }

  fn hide_cursor(&mut self) -> io::Result<()> {
    Ok(())
  }

  fn show_cursor(&mut self) -> io::Result<()> {
    Ok(())
  }

  fn get_cursor_position(&mut self) -> io::Result<Position> {
    Ok(self.cursor)
  }

  fn set_cursor_position<P: Into<Position>>(&mut self, position: P) -> io::Result<()> {
    self.cursor = position.into();
    Ok(())
  }

  fn clear(&mut self) -> io::Result<()> {
    for row in &mut self.grid {
      for ch in row.iter_mut() {
        *ch = ' ';
      }
    }
    Ok(())
  }

  fn clear_region(&mut self, _clear_type: ClearType) -> io::Result<()> {
    self.clear()
  }

  fn append_lines(&mut self, _line_count: u16) -> io::Result<()> {
    Ok(())
  }

  fn size(&self) -> io::Result<Size> {
    Ok(Size::new(self.width, self.height))
  }

  fn window_size(&mut self) -> io::Result<WindowSize> {
    Ok(WindowSize {
      columns_rows: Size::new(self.width, self.height),
      pixels: Size {
        width: 640,
        height: 480,
      },
    })
  }

  fn flush(&mut self) -> io::Result<()> {
    Ok(())
  }

  fn scroll_region_up(&mut self, _region: std::ops::Range<u16>, _scroll_by: u16) -> io::Result<()> {
    Ok(())
  }

  fn scroll_region_down(
    &mut self,
    _region: std::ops::Range<u16>,
    _scroll_by: u16,
  ) -> io::Result<()> {
    Ok(())
  }
}

// --- VT100-based backend for TUI snapshots ---
struct Vt100Backend {
  inner: CrosstermBackend<vt100::Parser>,
}

impl Vt100Backend {
  fn new(width: u16, height: u16) -> Self {
    Self {
      inner: CrosstermBackend::new(vt100::Parser::new(height, width, 0)),
    }
  }

  fn as_string(&self) -> String {
    self.inner.writer().screen().contents()
  }

  fn parser(&self) -> &vt100::Parser {
    self.inner.writer()
  }
}

impl Write for Vt100Backend {
  fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
    self.inner.writer_mut().write(buf)
  }

  fn flush(&mut self) -> io::Result<()> {
    self.inner.writer_mut().flush()
  }
}

impl fmt::Display for Vt100Backend {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    write!(f, "{}", self.parser().screen().contents())
  }
}

impl Backend for Vt100Backend {
  fn draw<'a, I>(&mut self, content: I) -> io::Result<()>
  where
    I: Iterator<Item = (u16, u16, &'a Cell)>,
  {
    self.inner.draw(content)?;
    Ok(())
  }

  fn hide_cursor(&mut self) -> io::Result<()> {
    self.inner.hide_cursor()?;
    Ok(())
  }

  fn show_cursor(&mut self) -> io::Result<()> {
    self.inner.show_cursor()?;
    Ok(())
  }

  fn get_cursor_position(&mut self) -> io::Result<Position> {
    Ok(self.parser().screen().cursor_position().into())
  }

  fn set_cursor_position<P: Into<Position>>(&mut self, position: P) -> io::Result<()> {
    self.inner.set_cursor_position(position)
  }

  fn clear(&mut self) -> io::Result<()> {
    self.inner.clear()
  }

  fn clear_region(&mut self, clear_type: ClearType) -> io::Result<()> {
    self.inner.clear_region(clear_type)
  }

  fn append_lines(&mut self, line_count: u16) -> io::Result<()> {
    self.inner.append_lines(line_count)
  }

  fn size(&self) -> io::Result<Size> {
    let (rows, cols) = self.parser().screen().size();
    Ok(Size::new(cols, rows))
  }

  fn window_size(&mut self) -> io::Result<WindowSize> {
    Ok(WindowSize {
      columns_rows: self.parser().screen().size().into(),
      pixels: Size {
        width: 640,
        height: 480,
      },
    })
  }

  fn flush(&mut self) -> io::Result<()> {
    self.inner.writer_mut().flush()
  }

  fn scroll_region_up(&mut self, region: std::ops::Range<u16>, scroll_by: u16) -> io::Result<()> {
    self.inner.scroll_region_up(region, scroll_by)
  }

  fn scroll_region_down(&mut self, region: std::ops::Range<u16>, scroll_by: u16) -> io::Result<()> {
    self.inner.scroll_region_down(region, scroll_by)
  }
}

/// Generic enum parser macro to reduce duplication in CLI argument parsing.
///
/// # Example
/// ```ignore
/// parse_enum_arg!(input, "sandbox mode",
///   "read-only" => SandboxModeCliArg::ReadOnly,
///   "workspace-write" => SandboxModeCliArg::WorkspaceWrite
/// )
/// ```
macro_rules! parse_enum_arg {
  ($input:expr, $name:expr, $( $str:expr => $variant:expr ),+ $(,)?) => {
    match $input {
      None => Ok(None),
      $(
        Some($str) => Ok(Some($variant)),
      )+
      Some(other) => Err(napi::Error::from_reason(format!(
        "Unsupported {}: {}", $name, other
      ))),
    }
  };
}

fn parse_sandbox_mode(input: Option<&str>) -> napi::Result<Option<SandboxModeCliArg>> {
  parse_enum_arg!(input, "sandbox mode",
    "read-only" => SandboxModeCliArg::ReadOnly,
    "workspace-write" => SandboxModeCliArg::WorkspaceWrite,
    "danger-full-access" => SandboxModeCliArg::DangerFullAccess,
  )
}

fn parse_approval_mode(input: Option<&str>) -> napi::Result<Option<ApprovalModeCliArg>> {
  parse_enum_arg!(input, "approval mode",
    "never" => ApprovalModeCliArg::Never,
    "on-request" => ApprovalModeCliArg::OnRequest,
    "on-failure" => ApprovalModeCliArg::OnFailure,
    "untrusted" => ApprovalModeCliArg::Untrusted,
  )
}

fn parse_reasoning_effort(input: Option<&str>) -> napi::Result<Option<ReasoningEffort>> {
  parse_enum_arg!(input, "reasoning effort",
    "minimal" => ReasoningEffort::Minimal,
    "low" => ReasoningEffort::Low,
    "medium" => ReasoningEffort::Medium,
    "high" => ReasoningEffort::High,
  )
}

fn parse_reasoning_summary(input: Option<&str>) -> napi::Result<Option<ReasoningSummary>> {
  parse_enum_arg!(input, "reasoning summary",
    "auto" => ReasoningSummary::Auto,
    "concise" => ReasoningSummary::Concise,
    "detailed" => ReasoningSummary::Detailed,
    "none" => ReasoningSummary::None,
  )
}

fn approval_mode_cli_to_policy(mode: Option<ApprovalModeCliArg>) -> Option<AskForApproval> {
  mode.map(|m| match m {
    ApprovalModeCliArg::Never => AskForApproval::Never,
    ApprovalModeCliArg::OnRequest => AskForApproval::OnRequest,
    ApprovalModeCliArg::OnFailure => AskForApproval::OnFailure,
    ApprovalModeCliArg::Untrusted => AskForApproval::UnlessTrusted,
  })
}

fn sandbox_mode_cli_to_config(mode: Option<SandboxModeCliArg>) -> Option<SandboxMode> {
  mode.map(|m| match m {
    SandboxModeCliArg::ReadOnly => SandboxMode::ReadOnly,
    SandboxModeCliArg::WorkspaceWrite => SandboxMode::WorkspaceWrite,
    SandboxModeCliArg::DangerFullAccess => SandboxMode::DangerFullAccess,
  })
}

pub fn build_cli(
  options: &InternalRunRequest,
  schema_path: Option<PathBuf>,
  force_compact: bool,
) -> Cli {
  let sandbox_mode = options.sandbox_mode;
  let wants_danger = matches!(sandbox_mode, Some(SandboxModeCliArg::DangerFullAccess));
  let cli_full_auto = options.full_auto && !wants_danger;
  let add_dir: Vec<PathBuf> = options
    .workspace_write_options
    .as_ref()
    .and_then(|opts| opts.writable_roots.clone())
    .unwrap_or_default()
    .into_iter()
    .map(PathBuf::from)
    .collect();

  let command = options.thread_id.as_ref().map(|id| {
    Command::Resume(ResumeArgs {
      session_id: Some(id.clone()),
      last: false,
      prompt: Some(options.prompt.clone()),
    })
  });

  let mut raw_overrides = Vec::new();
  if force_compact {
    raw_overrides.push("native.force_compact=true".to_string());
  }

  if let Some(approval_mode) = options.approval_mode {
    let approval_str = match approval_mode {
      ApprovalModeCliArg::Never => "never",
      ApprovalModeCliArg::OnRequest => "on-request",
      ApprovalModeCliArg::OnFailure => "on-failure",
      ApprovalModeCliArg::Untrusted => "untrusted",
    };
    raw_overrides.push(format!("approval_policy={approval_str}"));
  }

  if let Some(ws_opts) = &options.workspace_write_options {
    if let Some(network_access) = ws_opts.network_access {
      raw_overrides.push(format!(
        "sandbox_workspace_write.network_access={network_access}"
      ));
    }
    if let Some(writable_roots) = &ws_opts.writable_roots
      && !writable_roots.is_empty()
      && let Ok(roots_json) = serde_json::to_string(writable_roots)
    {
      raw_overrides.push(format!(
        "sandbox_workspace_write.writable_roots={roots_json}"
      ));
    }
    if let Some(exclude_tmpdir) = ws_opts.exclude_tmpdir_env_var {
      raw_overrides.push(format!(
        "sandbox_workspace_write.exclude_tmpdir_env_var={exclude_tmpdir}"
      ));
    }
    if let Some(exclude_slash_tmp) = ws_opts.exclude_slash_tmp {
      raw_overrides.push(format!(
        "sandbox_workspace_write.exclude_slash_tmp={exclude_slash_tmp}"
      ));
    }
  }

  Cli {
    command,
    images: options.images.clone(),
    model: options.model.clone(),
    oss: options.oss,
    sandbox_mode,
    config_profile: None,
    full_auto: cli_full_auto,
    dangerously_bypass_approvals_and_sandbox: wants_danger,
    cwd: options.working_directory.clone(),
    skip_git_repo_check: options.skip_git_repo_check,
    add_dir,
    output_schema: schema_path,
    config_overrides: CliConfigOverrides { raw_overrides },
    color: Color::Never,
    json: false,
    last_message_file: None,
    prompt: if options.thread_id.is_some() {
      None
    } else {
      Some(options.prompt.clone())
    },
  }
}

fn build_config_inputs(
  options: &InternalRunRequest,
  linux_sandbox_path: Option<PathBuf>,
) -> napi::Result<(ConfigOverrides, Vec<(String, TomlValue)>)> {
  let cli = build_cli(options, None, false);
  let cli_kv_overrides = cli
    .config_overrides
    .parse_overrides()
    .map_err(|e| napi::Error::from_reason(format!("Failed to parse config overrides: {e}")))?;

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
      .oss
      .then_some(BUILT_IN_OSS_MODEL_PROVIDER_ID.to_string()),
    config_profile: None,
    codex_linux_sandbox_exe: linux_sandbox_path,
    base_instructions: None,
    developer_instructions: None,
    compact_prompt: None,
    include_apply_patch_tool: None,
    show_raw_agent_reasoning: options.oss.then_some(true),
    tools_web_search_request: None,
    experimental_sandbox_command_assessment: None,
    additional_writable_roots: Vec::new(),
  };

  Ok((overrides, cli_kv_overrides))
}

async fn load_config_from_internal(options: &InternalRunRequest) -> napi::Result<Config> {
  let (overrides, cli_kv_overrides) =
    build_config_inputs(options, options.linux_sandbox_path.clone())?;
  Config::load_with_cli_overrides(cli_kv_overrides, overrides)
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

fn parse_cursor_string(input: Option<&str>) -> napi::Result<Option<codex_core::Cursor>> {
  match input {
    None => Ok(None),
    Some(raw) => {
      let wrapped = format!("\"{raw}\"");
      serde_json::from_str::<codex_core::Cursor>(&wrapped)
        .map(Some)
        .map_err(|e| napi::Error::from_reason(format!("Invalid cursor: {e}")))
    }
  }
}

fn cursor_to_string(cursor: &codex_core::Cursor) -> napi::Result<String> {
  serde_json::to_string(cursor)
    .map(|s| s.trim_matches('\"').to_string())
    .map_err(|e| napi::Error::from_reason(format!("Failed to serialize cursor: {e}")))
}

fn conversation_item_to_summary(item: ConversationItem) -> ConversationSummary {
  let id = item
    .path
    .file_stem()
    .and_then(|s| s.to_str())
    .unwrap_or("unknown")
    .to_string();

  ConversationSummary {
    id,
    path: item.path.to_string_lossy().into_owned(),
    created_at: item.created_at,
    updated_at: item.updated_at,
  }
}

fn event_to_json(event: &ExecThreadEvent) -> napi::Result<JsonValue> {
  match event {
    ExecThreadEvent::ExitedReviewMode(inner) => {
      let review_output = match &inner.review_output {
        Some(output) => {
          serde_json::to_value(output).map_err(|e| napi::Error::from_reason(e.to_string()))?
        }
        None => JsonValue::Null,
      };
      let mut map = JsonMap::new();
      map.insert(
        "type".to_string(),
        JsonValue::String("exited_review_mode".to_string()),
      );
      map.insert("review_output".to_string(), review_output);
      Ok(JsonValue::Object(map))
    }
    ExecThreadEvent::Raw(_) => Ok(JsonValue::Null),
    _ => serde_json::to_value(event).map_err(|e| napi::Error::from_reason(e.to_string())),
  }
}

fn run_internal_sync<F>(options: InternalRunRequest, handler: F) -> napi::Result<()>
where
  F: FnMut(ExecThreadEvent) + Send + 'static,
{
  ensure_apply_patch_aliases()?;
  // Check for pending plan updates and inject them as early events
  let pending_plan = if let Some(thread_id) = &options.thread_id {
    let mut updates = pending_plan_updates()
      .lock()
      .map_err(|e| napi::Error::from_reason(format!("plan updates mutex poisoned: {e}")))?;
    updates.remove(thread_id)
  } else {
    None
  };

  let handler_arc: ThreadEventHandler = Arc::new(Mutex::new(Box::new(handler)));
  let handler_error: Arc<Mutex<Option<napi::Error>>> = Arc::new(Mutex::new(None));

  let initial_thread_id = options.thread_id.clone();
  let thread_id_slot = Arc::new(Mutex::new(initial_thread_id.clone()));

  if let Some(id) = initial_thread_id {
    register_thread_handler(&id, &handler_arc);
  }

  if let Some(plan_args) = pending_plan {
    let todo_items: Vec<codex_exec::exec_events::TodoItem> = plan_args
      .plan
      .into_iter()
      .map(|item| codex_exec::exec_events::TodoItem {
        text: item.step,
        completed: matches!(
          item.status,
          codex_protocol::plan_tool::StepStatus::Completed
        ),
      })
      .collect();

    let timestamp = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .unwrap_or_default()
      .as_millis();
    let thread_item = codex_exec::exec_events::ThreadItem {
      id: format!("plan_update_{timestamp}"),
      details: codex_exec::exec_events::ThreadItemDetails::TodoList(
        codex_exec::exec_events::TodoListItem { items: todo_items },
      ),
    };

    let plan_event = ExecThreadEvent::ItemCompleted(codex_exec::exec_events::ItemCompletedEvent {
      item: thread_item,
    });
    if let Err(err) = dispatch_thread_event(&handler_arc, plan_event) {
      cleanup_thread_handler(&thread_id_slot);
      return Err(err);
    }
  }

  let schema_file = prepare_schema(options.output_schema.clone())?;
  let schema_path = schema_file.as_ref().map(|file| file.path.clone());
  let cli = build_cli(&options, schema_path, false);

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
  if let Some(base_url) = options.base_url.clone() {
    env_pairs.push(("OPENAI_BASE_URL", Some(base_url), true));
  }
  if let Some(api_key) = options.api_key.clone() {
    env_pairs.push(("CODEX_API_KEY", Some(api_key), true));
  }

  let linux_sandbox_path = if let Some(path) = options.linux_sandbox_path.clone() {
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

  let handler_for_callback = Arc::clone(&handler_arc);
  let handler_error_for_callback = Arc::clone(&handler_error);
  let thread_id_for_callback = Arc::clone(&thread_id_slot);

  let runtime = tokio::runtime::Runtime::new()
    .map_err(|e| napi::Error::from_reason(format!("Failed to create runtime: {e}")))?;

  runtime.block_on(async {
    run_with_thread_event_callback(cli, linux_sandbox_path, move |event| {
      if let ExecThreadEvent::ThreadStarted(ev) = &event {
        if let Ok(mut slot) = thread_id_for_callback.lock() {
          *slot = Some(ev.thread_id.clone());
        }
        register_thread_handler(&ev.thread_id, &handler_for_callback);
      }

      if let Err(err) = dispatch_thread_event(&handler_for_callback, event)
        && let Ok(mut guard) = handler_error_for_callback.lock() {
          *guard = Some(err);
      }
    })
    .await
    .map_err(|e| napi::Error::from_reason(e.to_string()))
  })?;

  if let Some(err) = handler_error.lock().unwrap().take() {
    cleanup_thread_handler(&thread_id_slot);
    return Err(err);
  }

  cleanup_thread_handler(&thread_id_slot);
  Ok(())
}

#[napi]
pub async fn run_thread(req: RunRequest) -> napi::Result<Vec<String>> {
  let options = req.into_internal()?;
  let events: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
  let error_holder: Arc<Mutex<Option<napi::Error>>> = Arc::new(Mutex::new(None));

  let events_clone = Arc::clone(&events);
  let error_clone: Arc<Mutex<Option<napi::Error>>> = Arc::clone(&error_holder);

  tokio::task::spawn_blocking(move || {
    run_internal_sync(options, move |event| match event_to_json(&event) {
      Ok(value) => {
        if let Ok(mut guard) = events_clone.lock() {
          match serde_json::to_string(&value) {
            Ok(text) => guard.push(text),
            Err(err) => {
              if let Ok(mut error_guard) = error_clone.lock() {
                *error_guard = Some(napi::Error::from_reason(err.to_string()));
              }
            }
          }
        }
      }
      Err(err) => {
        if let Ok(mut guard) = error_clone.lock() {
          *guard = Some(err);
        }
      }
    })
  })
  .await
  .map_err(|e| napi::Error::from_reason(format!("Task join error: {e}")))??;

  if let Some(err) = error_holder.lock().unwrap().take() {
    return Err(err);
  }

  let mut guard = events.lock().unwrap();
  Ok(std::mem::take(&mut *guard))
}

#[napi]
pub async fn compact_thread(req: RunRequest) -> napi::Result<Vec<String>> {
  ensure_apply_patch_aliases()?;
  let options = req.into_internal()?;
  let events: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
  let error_holder: Arc<Mutex<Option<napi::Error>>> = Arc::new(Mutex::new(None));

  let events_clone = Arc::clone(&events);
  let error_clone: Arc<Mutex<Option<napi::Error>>> = Arc::clone(&error_holder);

  tokio::task::spawn_blocking(move || {
    let schema_file = prepare_schema(options.output_schema.clone())?;
    let schema_path = schema_file.as_ref().map(|file| file.path.clone());
    let cli = build_cli(&options, schema_path, true);
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
    let linux_sandbox_path = if let Some(path) = options.linux_sandbox_path.clone() {
      Some(path)
    } else if let Ok(path) = std::env::var("CODEX_LINUX_SANDBOX_EXE") {
      Some(PathBuf::from(path))
    } else {
      default_linux_sandbox_path()?
    };
    let rt = tokio::runtime::Runtime::new().map_err(|e| napi::Error::from_reason(e.to_string()))?;
    rt.block_on(async move {
      let fut = run_with_thread_event_callback(cli, linux_sandbox_path, move |event| {
        match event_to_json(&event) {
          Ok(value) => {
            if let Ok(mut guard) = events_clone.lock() {
              match serde_json::to_string(&value) {
                Ok(text) => guard.push(text),
                Err(err) => {
                  if let Ok(mut error_guard) = error_clone.lock() {
                    *error_guard = Some(napi::Error::from_reason(err.to_string()));
                  }
                }
              }
            }
          }
          Err(err) => {
            if let Ok(mut guard) = error_clone.lock() {
              *guard = Some(err);
            }
          }
        }
      });
      fut
        .await
        .map_err(|e| napi::Error::from_reason(e.to_string()))
    })
  })
  .await
  .map_err(|e| napi::Error::from_reason(format!("Task join error: {e}")))??;

  if let Some(err) = error_holder.lock().unwrap().take() {
    return Err(err);
  }

  let mut guard = events.lock().unwrap();
  Ok(std::mem::take(&mut *guard))
}

#[napi]
pub async fn fork_thread(req: ForkRequest) -> napi::Result<ForkResult> {
  let internal = req.into_internal()?;
  tokio::task::spawn_blocking(move || fork_thread_sync(internal))
    .await
    .map_err(|e| napi::Error::from_reason(format!("Task join error: {e}")))?
}

#[napi]
pub async fn list_conversations(req: ListConversationsRequest) -> napi::Result<ConversationListPage> {
  let config_request = req.config.unwrap_or_default();
  let options = config_request.into_internal_request()?;
  let config = load_config_from_internal(&options).await?;
  ensure_trusted_directory_from_options(&options, &config)?;

  let cursor = parse_cursor_string(req.cursor.as_deref())?;
  let provider_filters = req.model_providers.unwrap_or_default();
  let provider_slice = if provider_filters.is_empty() {
    None
  } else {
    Some(provider_filters.as_slice())
  };

  let page_size = req.page_size.unwrap_or(20).max(1) as usize;

  let page = RolloutRecorder::list_conversations(
    &config.codex_home,
    page_size,
    cursor.as_ref(),
    &[],
    provider_slice,
    &config.model_provider_id,
  )
  .await
  .map_err(|e| napi::Error::from_reason(format!("Failed to list conversations: {e}")))?;

  let conversations = page
    .items
    .into_iter()
    .map(conversation_item_to_summary)
    .collect();
  let next_cursor = match page.next_cursor.as_ref() {
    Some(c) => Some(cursor_to_string(c)?),
    None => None,
  };
  let num_scanned = page
    .num_scanned_files
    .min(u32::MAX as usize) as u32;

  Ok(ConversationListPage {
    conversations,
    next_cursor,
    num_scanned_files: num_scanned,
    reached_scan_cap: page.reached_scan_cap,
  })
}

#[napi]
pub async fn delete_conversation(
  req: DeleteConversationRequest,
) -> napi::Result<DeleteConversationResult> {
  let config_request = req.config.unwrap_or_default();
  let options = config_request.into_internal_request()?;
  let config = load_config_from_internal(&options).await?;
  ensure_trusted_directory_from_options(&options, &config)?;

  let path = find_conversation_path_by_id_str(&config.codex_home, &req.id)
    .await
    .map_err(|e| napi::Error::from_reason(format!("Failed to resolve conversation: {e}")))?;

  if let Some(path) = path {
    match tokio::fs::remove_file(&path).await {
      Ok(_) => {
        return Ok(DeleteConversationResult { deleted: true });
      }
      Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
      Err(err) => {
        return Err(napi::Error::from_reason(format!("Failed to delete conversation: {err}")));
      }
    }
  }

  Ok(DeleteConversationResult { deleted: false })
}

#[napi]
pub async fn resume_conversation_from_rollout(
  req: ResumeFromRolloutRequest,
) -> napi::Result<ForkResult> {
  let config_request = req.config.unwrap_or_default();
  let options = config_request.into_internal_request()?;
  let config = load_config_from_internal(&options).await?;
  ensure_trusted_directory_from_options(&options, &config)?;

  let auth_manager = AuthManager::shared(
    config.codex_home.clone(),
    true,
    config.cli_auth_credentials_store_mode,
  );
  let manager = ConversationManager::new(auth_manager.clone(), SessionSource::Exec);
  let rollout_path = PathBuf::from(req.rollout_path);

  let new_conv = manager
    .resume_conversation_from_rollout(config, rollout_path, auth_manager)
    .await
    .map_err(|e| napi::Error::from_reason(format!("Failed to resume conversation: {e}")))?;

  let thread_id = new_conv.conversation_id.to_string();
  let rollout_path = new_conv
    .session_configured
    .rollout_path
    .to_string_lossy()
    .to_string();

  manager.remove_conversation(&new_conv.conversation_id).await;

  Ok(ForkResult {
    thread_id,
    rollout_path,
  })
}

fn fork_thread_sync(req: InternalForkRequest) -> napi::Result<ForkResult> {
  let thread_id = req.thread_id;
  let nth_user_message = req.nth_user_message;
  let options = req.run_options;

  let mut env_pairs: Vec<(&'static str, Option<String>, bool)> = Vec::new();
  if std::env::var(ORIGINATOR_ENV).is_err() {
    env_pairs.push((ORIGINATOR_ENV, Some(NATIVE_ORIGINATOR.to_string()), true));
  }
  if let Some(base_url) = options.base_url.clone() {
    env_pairs.push(("OPENAI_BASE_URL", Some(base_url), true));
  }
  if let Some(api_key) = options.api_key.clone() {
    env_pairs.push(("CODEX_API_KEY", Some(api_key), true));
  }

  let linux_sandbox_path = if let Some(path) = options.linux_sandbox_path.clone() {
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

  runtime.block_on(async move {
    let (overrides, cli_kv_overrides) = build_config_inputs(&options, linux_sandbox_path.clone())?;
    let config = Config::load_with_cli_overrides(cli_kv_overrides, overrides)
      .await
      .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    if !options.skip_git_repo_check && get_git_repo_root(&config.cwd).is_none() {
      return Err(napi::Error::from_reason(
        "Not inside a trusted directory and --skip-git-repo-check was not specified.".to_string(),
      ));
    }

    let auth_manager = AuthManager::shared(
      config.codex_home.clone(),
      true,
      config.cli_auth_credentials_store_mode,
    );

    let path_opt = find_conversation_path_by_id_str(&config.codex_home, &thread_id)
      .await
      .map_err(|e| {
        napi::Error::from_reason(format!(
          "Failed to resolve conversation path for thread {thread_id}: {e}"
        ))
      })?;

    let path = path_opt.ok_or_else(|| {
      napi::Error::from_reason(format!(
        "No saved conversation found for thread {thread_id}"
      ))
    })?;

    let manager = ConversationManager::new(auth_manager, SessionSource::Exec);

    let new_conv = manager
      .fork_conversation(nth_user_message, config.clone(), path.clone())
      .await
      .map_err(|e| napi::Error::from_reason(format!("Failed to fork conversation: {e}")))?;

    let new_id = new_conv.conversation_id.to_string();
    let rollout_path = new_conv
      .session_configured
      .rollout_path
      .to_string_lossy()
      .to_string();

    manager.remove_conversation(&new_conv.conversation_id).await;

    Ok(ForkResult {
      thread_id: new_id,
      rollout_path,
    })
  })
}

#[napi]
pub fn run_apply_patch(patch: String) -> napi::Result<()> {
  let mut stdout = std::io::stdout();
  let mut stderr = std::io::stderr();
  codex_apply_patch::apply_patch(&patch, &mut stdout, &mut stderr)
    .map_err(|err| napi::Error::from_reason(err.to_string()))
}

#[napi]
pub async fn run_thread_stream(
  req: RunRequest,
  #[napi(ts_arg_type = "(err: unknown, eventJson?: string) => void")] on_event: ThreadsafeFunction<
    JsonValue,
  >,
) -> napi::Result<()> {
  let options = req.into_internal()?;
  let error_holder: Arc<Mutex<Option<napi::Error>>> = Arc::new(Mutex::new(None));
  let error_clone: Arc<Mutex<Option<napi::Error>>> = Arc::clone(&error_holder);

  tokio::task::spawn_blocking(move || {
    run_internal_sync(options, move |event| match event_to_json(&event) {
      Ok(value) => match serde_json::to_string(&value) {
        Ok(text) => {
          let status = on_event.call(
            Ok(JsonValue::String(text)),
            ThreadsafeFunctionCallMode::NonBlocking,
          );
          if status != Status::Ok
            && let Ok(mut guard) = error_clone.lock()
          {
            *guard = Some(napi::Error::from_status(status));
          }
        }
        Err(err) => {
          if let Ok(mut guard) = error_clone.lock() {
            *guard = Some(napi::Error::from_reason(err.to_string()));
          }
        }
      },
      Err(err) => {
        if let Ok(mut guard) = error_clone.lock() {
          *guard = Some(err);
        }
      }
    })
  })
  .await
  .map_err(|e| napi::Error::from_reason(format!("Task join error: {e}")))??;

  if let Some(err) = error_holder.lock().unwrap().take() {
    return Err(err);
  }

  Ok(())
}

fn build_cloud_client(
  base_url: Option<String>,
  api_key: Option<String>,
) -> anyhow::Result<cloud::HttpClient> {
  let base = base_url.unwrap_or_else(|| "https://chatgpt.com/backend-api".to_string());
  let ua = default_client::get_codex_user_agent();
  let mut client = cloud::HttpClient::new(base.clone())?.with_user_agent(ua);
  if let Some(token) = api_key.or_else(|| std::env::var("CODEX_API_KEY").ok()) {
    client = client.with_bearer_token(token);
  }
  Ok(client)
}
