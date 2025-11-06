#![deny(clippy::all)]

use std::path::PathBuf;
use std::sync::OnceLock;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use codex_common::CliConfigOverrides;
use codex_common::SandboxModeCliArg;
use codex_core::auth::enforce_login_restrictions;
use codex_core::config::Config;
use codex_core::config::ConfigOverrides;
use codex_core::function_tool::FunctionCallError;
use codex_core::git_info::get_git_repo_root;
use codex_core::protocol::AskForApproval;
use codex_core::protocol::SessionSource;
use codex_core::protocol::{Event, EventMsg, Op, ReviewOutputEvent, ReviewRequest, TokenUsage};
use codex_core::tools::context::ToolInvocation;
use codex_core::tools::context::ToolOutput;
use codex_core::tools::context::ToolPayload;
use codex_core::tools::registry::{
  ExternalToolRegistration, ToolHandler, ToolKind, set_pending_external_tools,
};
use codex_core::tools::spec::create_function_tool_spec_from_schema;
use codex_core::{AuthManager, ConversationManager, NewConversation};
use codex_exec::exec_events::{
  AgentMessageItem, ExitedReviewModeEvent as ExecExitedReviewModeEvent, ItemCompletedEvent,
  ReasoningItem, ReviewCodeLocation, ReviewFinding, ReviewLineRange,
  ReviewOutputEvent as ExecReviewOutputEvent, ThreadErrorEvent as ExecThreadErrorEvent,
  ThreadEvent, ThreadItem, ThreadItemDetails, ThreadStartedEvent, TurnCompletedEvent,
  TurnFailedEvent, TurnStartedEvent, Usage,
};
use codex_exec::run_with_thread_event_callback;
use codex_exec::{Cli, Color, Command, ResumeArgs};
use codex_protocol::config_types::SandboxMode;
use napi::bindgen_prelude::{Function, Status};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use serde_json::Value as JsonValue;
use serde_json::json;
use tempfile::NamedTempFile;

#[cfg(target_os = "linux")]
use std::io::Write;

#[cfg(target_os = "linux")]
fn ensure_embedded_linux_sandbox() -> napi::Result<PathBuf> {
  use std::fs;
  use std::os::unix::fs::PermissionsExt;

  static SANDBOX_PATH: OnceLock<PathBuf> = OnceLock::new();

  // Use get_or_init with a closure that handles errors manually
  SANDBOX_PATH.get_or_init(|| {
    let root = std::env::temp_dir().join("codex-native");
    if fs::create_dir_all(&root).is_err() {
      return PathBuf::new();
    }
    let target_path = root.join("codex-linux-sandbox");

    let mut tmp = match NamedTempFile::new_in(&root) {
      Ok(t) => t,
      Err(_) => return PathBuf::new(),
    };
    if tmp.write_all(EMBEDDED_LINUX_SANDBOX_BYTES).is_err() {
      return PathBuf::new();
    }
    if tmp.flush().is_err() {
      return PathBuf::new();
    }

    let temp_path = tmp.into_temp_path();
    if target_path.exists() {
      let _ = fs::remove_file(&target_path);
    }
    if temp_path.persist(&target_path).is_err() {
      return PathBuf::new();
    }

    let mut perms = match fs::metadata(&target_path) {
      Ok(m) => m.permissions(),
      Err(_) => return PathBuf::new(),
    };
    perms.set_mode(0o755);
    if fs::set_permissions(&target_path, perms).is_err() {
      return PathBuf::new();
    }

    target_path
  });

  let path = SANDBOX_PATH.get().unwrap();
  if path.as_os_str().is_empty() {
    return Err(napi::Error::from_reason(
      "Failed to initialize Linux sandbox binary",
    ));
  }
  Ok(path.clone())
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

fn registered_native_tools() -> &'static Mutex<Vec<ExternalToolRegistration>> {
  static TOOLS: OnceLock<Mutex<Vec<ExternalToolRegistration>>> = OnceLock::new();
  TOOLS.get_or_init(|| Mutex::new(Vec::new()))
}

#[napi(object)]
pub struct NativeToolInfo {
  pub name: String,
  pub description: Option<String>,
  pub parameters: Option<JsonValue>,
  pub strict: Option<bool>,
  pub supports_parallel: Option<bool>,
}

#[napi(object)]
pub struct NativeToolResponse {
  pub output: Option<String>,
  pub success: Option<bool>,
  pub error: Option<String>,
}

#[napi]
pub fn clear_registered_tools() -> napi::Result<()> {
  registered_native_tools()
    .lock()
    .map_err(|e| napi::Error::from_reason(format!("tools mutex poisoned: {e}")))?
    .clear();
  Ok(())
}

#[napi]
pub fn register_tool(
  info: NativeToolInfo,
  handler: Function<JsToolInvocation, NativeToolResponse>,
) -> napi::Result<()> {
  let schema = info.parameters.unwrap_or_else(|| {
    json!({
      "type": "object",
      "properties": {}
    })
  });
  let spec = create_function_tool_spec_from_schema(
    info.name.clone(),
    info.description.clone(),
    schema,
    info.strict.unwrap_or(false),
  )
  .map_err(|err| napi::Error::from_reason(format!("invalid tool schema: {err}")))?;

  let tsfn = handler
    .build_threadsafe_function::<JsToolInvocation>()
    .callee_handled::<true>()
    .build()?;

  let registration = ExternalToolRegistration {
    spec,
    handler: Arc::new(JsToolHandler { callback: tsfn }),
    supports_parallel_tool_calls: info.supports_parallel.unwrap_or(true),
  };

  registered_native_tools()
    .lock()
    .map_err(|e| napi::Error::from_reason(format!("tools mutex poisoned: {e}")))?
    .push(registration);

  Ok(())
}

#[derive(Clone)]
#[napi(object)]
pub struct JsToolInvocation {
  #[napi(js_name = "callId")]
  pub call_id: String,
  #[napi(js_name = "toolName")]
  pub tool_name: String,
  #[napi(js_name = "arguments")]
  pub arguments: Option<String>,
  pub input: Option<String>,
}

struct JsToolHandler {
  callback:
    ThreadsafeFunction<JsToolInvocation, NativeToolResponse, JsToolInvocation, napi::Status, true>,
}

#[async_trait]
impl ToolHandler for JsToolHandler {
  fn kind(&self) -> ToolKind {
    ToolKind::Function
  }

  async fn handle(&self, invocation: ToolInvocation) -> Result<ToolOutput, FunctionCallError> {
    let payload = match invocation.payload {
      ToolPayload::Function { arguments } => JsToolInvocation {
        call_id: invocation.call_id.clone(),
        tool_name: invocation.tool_name.clone(),
        arguments: Some(arguments),
        input: None,
      },
      ToolPayload::Custom { input } => JsToolInvocation {
        call_id: invocation.call_id.clone(),
        tool_name: invocation.tool_name.clone(),
        arguments: None,
        input: Some(input),
      },
      _ => {
        return Err(FunctionCallError::Fatal(format!(
          "native tool `{}` received unsupported payload",
          invocation.tool_name
        )));
      }
    };

    let response = self
      .callback
      .call_async(Ok(payload))
      .await
      .map_err(|e| FunctionCallError::Fatal(e.to_string()))?;

    if let Some(error) = response.error {
      return Err(FunctionCallError::RespondToModel(error));
    }

    let output = response.output.unwrap_or_default();
    Ok(ToolOutput::Function {
      content: output,
      content_items: None,
      success: response.success,
    })
  }
}

#[napi(object)]
pub struct RunRequest {
  pub prompt: String,
  #[napi(js_name = "threadId")]
  pub thread_id: Option<String>,
  pub images: Option<Vec<String>>,
  pub model: Option<String>,
  #[napi(js_name = "sandboxMode")]
  pub sandbox_mode: Option<String>,
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
  #[napi(js_name = "fullAuto")]
  pub full_auto: Option<bool>,
  #[napi(js_name = "reviewMode")]
  pub review_mode: Option<bool>,
  #[napi(js_name = "reviewHint")]
  pub review_hint: Option<String>,
}

#[cfg_attr(test, derive(Debug))]
pub struct InternalRunRequest {
  pub prompt: String,
  pub thread_id: Option<String>,
  pub images: Vec<PathBuf>,
  pub model: Option<String>,
  pub sandbox_mode: Option<SandboxModeCliArg>,
  pub working_directory: Option<PathBuf>,
  pub skip_git_repo_check: bool,
  pub output_schema: Option<JsonValue>,
  pub base_url: Option<String>,
  pub api_key: Option<String>,
  pub linux_sandbox_path: Option<PathBuf>,
  pub full_auto: bool,
  pub review_request: Option<ReviewRequest>,
}

impl RunRequest {
  fn into_internal(self) -> napi::Result<InternalRunRequest> {
    let RunRequest {
      prompt,
      thread_id,
      images,
      model,
      sandbox_mode,
      working_directory,
      skip_git_repo_check,
      output_schema,
      base_url,
      api_key,
      linux_sandbox_path,
      full_auto,
      review_mode,
      review_hint,
    } = self;

    let sandbox_mode = match sandbox_mode.as_deref() {
      None => None,
      Some("read-only") => Some(SandboxModeCliArg::ReadOnly),
      Some("workspace-write") => Some(SandboxModeCliArg::WorkspaceWrite),
      Some("danger-full-access") => Some(SandboxModeCliArg::DangerFullAccess),
      Some(other) => {
        return Err(napi::Error::from_reason(format!(
          "Unsupported sandbox mode: {other}",
        )));
      }
    };

    let images = images
      .unwrap_or_default()
      .into_iter()
      .map(PathBuf::from)
      .collect();

    let working_directory = working_directory.map(PathBuf::from);
    let full_auto = full_auto.unwrap_or(false);
    let review_request = if review_mode.unwrap_or(false) {
      if prompt.trim().is_empty() {
        return Err(napi::Error::from_reason(
          "Review mode requires a non-empty prompt".to_string(),
        ));
      }
      let hint = review_hint.unwrap_or_else(|| "code review".to_string());
      Some(ReviewRequest {
        prompt: prompt.clone(),
        user_facing_hint: hint,
      })
    } else {
      None
    };

    Ok(InternalRunRequest {
      prompt,
      thread_id,
      images,
      model,
      sandbox_mode,
      working_directory,
      skip_git_repo_check: skip_git_repo_check.unwrap_or(false),
      output_schema,
      base_url,
      api_key,
      linux_sandbox_path: linux_sandbox_path.map(PathBuf::from),
      full_auto,
      review_request,
    })
  }
}

pub struct TempSchemaFile {
  pub path: PathBuf,
  pub _guard: tempfile::TempPath,
}

pub fn prepare_schema(schema: Option<JsonValue>) -> napi::Result<Option<TempSchemaFile>> {
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

pub struct EnvOverride {
  pub key: &'static str,
  pub previous: Option<String>,
}

pub struct EnvOverrides {
  pub entries: Vec<EnvOverride>,
}

impl EnvOverrides {
  pub fn apply(pairs: Vec<(&'static str, Option<String>, bool)>) -> Self {
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

fn prepare_environment(
  options: &InternalRunRequest,
) -> napi::Result<(EnvOverrides, Option<PathBuf>)> {
  let mut env_pairs: Vec<(&'static str, Option<String>, bool)> = Vec::new();
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

  let guard = EnvOverrides::apply(env_pairs);
  Ok((guard, linux_sandbox_path))
}

pub fn build_config_overrides(
  options: &InternalRunRequest,
  sandbox_path: Option<PathBuf>,
) -> ConfigOverrides {
  let sandbox_mode = if options.full_auto {
    Some(SandboxMode::WorkspaceWrite)
  } else {
    options.sandbox_mode.map(Into::<SandboxMode>::into)
  };
  let cwd = options
    .working_directory
    .as_ref()
    .map(|path| path.canonicalize().unwrap_or(path.clone()));

  ConfigOverrides {
    model: options.model.clone(),
    review_model: None,
    cwd,
    approval_policy: Some(AskForApproval::Never),
    sandbox_mode,
    model_provider: None,
    config_profile: None,
    codex_linux_sandbox_exe: sandbox_path,
    base_instructions: None,
    developer_instructions: None,
    compact_prompt: None,
    include_apply_patch_tool: None,
    show_raw_agent_reasoning: Some(false),
    tools_web_search_request: None,
    experimental_sandbox_command_assessment: None,
    additional_writable_roots: Vec::new(),
  }
}

pub fn build_cli(options: &InternalRunRequest, schema_path: Option<PathBuf>) -> Cli {
  let command = options.thread_id.as_ref().map(|id| {
    Command::Resume(ResumeArgs {
      session_id: Some(id.clone()),
      last: false,
      prompt: Some(options.prompt.clone()),
    })
  });

  Cli {
    command,
    images: options.images.clone(),
    model: options.model.clone(),
    oss: false,
    sandbox_mode: options.sandbox_mode,
    config_profile: None,
    full_auto: options.full_auto,
    dangerously_bypass_approvals_and_sandbox: false,
    cwd: options.working_directory.clone(),
    skip_git_repo_check: options.skip_git_repo_check,
    output_schema: schema_path,
    config_overrides: CliConfigOverrides {
      raw_overrides: Vec::new(),
    },
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

pub struct ReviewEventCollector {
  pub next_item_id: u64,
  pub last_usage: Option<TokenUsage>,
  pub last_error: Option<ExecThreadErrorEvent>,
  pub emitted_review_exit: bool,
}

impl Default for ReviewEventCollector {
  fn default() -> Self {
    Self::new()
  }
}

impl ReviewEventCollector {
  pub fn new() -> Self {
    Self {
      next_item_id: 0,
      last_usage: None,
      last_error: None,
      emitted_review_exit: false,
    }
  }

  pub fn next_item_id(&mut self) -> String {
    let id = self.next_item_id;
    self.next_item_id += 1;
    format!("item_{id}")
  }

  pub fn handle(&mut self, event: &Event) -> Vec<ThreadEvent> {
    match &event.msg {
      EventMsg::SessionConfigured(ev) => {
        vec![ThreadEvent::ThreadStarted(ThreadStartedEvent {
          thread_id: ev.session_id.to_string(),
        })]
      }
      EventMsg::TaskStarted(_) => {
        self.last_error = None;
        vec![ThreadEvent::TurnStarted(TurnStartedEvent {})]
      }
      EventMsg::AgentReasoning(ev) => {
        let item = ThreadItem {
          id: self.next_item_id(),
          details: ThreadItemDetails::Reasoning(ReasoningItem {
            text: ev.text.clone(),
          }),
        };
        vec![ThreadEvent::ItemCompleted(ItemCompletedEvent { item })]
      }
      EventMsg::AgentMessage(ev) => {
        let item = ThreadItem {
          id: self.next_item_id(),
          details: ThreadItemDetails::AgentMessage(AgentMessageItem {
            text: ev.message.clone(),
          }),
        };
        vec![ThreadEvent::ItemCompleted(ItemCompletedEvent { item })]
      }
      EventMsg::TokenCount(ev) => {
        if let Some(info) = &ev.info {
          self.last_usage = Some(info.total_token_usage.clone());
        }
        Vec::new()
      }
      EventMsg::Warning(ev) => {
        let item = ThreadItem {
          id: self.next_item_id(),
          details: ThreadItemDetails::Error(codex_exec::exec_events::ErrorItem {
            message: ev.message.clone(),
          }),
        };
        vec![ThreadEvent::ItemCompleted(ItemCompletedEvent { item })]
      }
      EventMsg::Error(ev) => {
        let error = ExecThreadErrorEvent {
          message: ev.message.clone(),
        };
        self.last_error = Some(error.clone());
        vec![ThreadEvent::Error(error)]
      }
      EventMsg::ExitedReviewMode(ev) => {
        let converted = self.convert_review_output(&ev.review_output);
        self.emitted_review_exit = true;
        vec![ThreadEvent::ExitedReviewMode(ExecExitedReviewModeEvent {
          review_output: converted,
        })]
      }
      EventMsg::TaskComplete(task_complete) => {
        let mut events = Vec::new();
        if let Some(text) = task_complete.last_agent_message.as_deref() {
          if !self.emitted_review_exit {
            let review_output = self.parse_review_output(text);
            let converted = self.convert_review_output(&Some(review_output));
            events.push(ThreadEvent::ExitedReviewMode(ExecExitedReviewModeEvent {
              review_output: converted,
            }));
            self.emitted_review_exit = true;
          }
          let item = ThreadItem {
            id: self.next_item_id(),
            details: ThreadItemDetails::AgentMessage(AgentMessageItem {
              text: text.to_string(),
            }),
          };
          events.push(ThreadEvent::ItemCompleted(ItemCompletedEvent { item }));
        }

        let usage = self.last_usage.clone().unwrap_or_default();

        if let Some(error) = self.last_error.take() {
          events.push(ThreadEvent::TurnFailed(TurnFailedEvent { error }));
        } else {
          events.push(ThreadEvent::TurnCompleted(TurnCompletedEvent {
            usage: Usage {
              input_tokens: usage.input_tokens,
              cached_input_tokens: usage.cached_input_tokens,
              output_tokens: usage.output_tokens,
            },
          }));
        }
        events
      }
      _ => Vec::new(),
    }
  }

  pub fn convert_review_output(
    &self,
    review_output: &Option<ReviewOutputEvent>,
  ) -> Option<ExecReviewOutputEvent> {
    review_output.as_ref().map(|output| ExecReviewOutputEvent {
      findings: output
        .findings
        .iter()
        .map(|finding| ReviewFinding {
          title: finding.title.clone(),
          body: finding.body.clone(),
          confidence_score: finding.confidence_score,
          priority: finding.priority,
          code_location: ReviewCodeLocation {
            absolute_file_path: finding
              .code_location
              .absolute_file_path
              .to_string_lossy()
              .to_string(),
            line_range: ReviewLineRange {
              start: finding.code_location.line_range.start as i32,
              end: finding.code_location.line_range.end as i32,
            },
          },
        })
        .collect(),
      overall_correctness: output.overall_correctness.clone(),
      overall_explanation: output.overall_explanation.clone(),
      overall_confidence_score: output.overall_confidence_score,
    })
  }

  pub fn parse_review_output(&self, text: &str) -> ReviewOutputEvent {
    if let Ok(ev) = serde_json::from_str::<ReviewOutputEvent>(text) {
      return ev;
    }
    if let (Some(start), Some(end)) = (text.find('{'), text.rfind('}'))
      && start < end
      && let Some(slice) = text.get(start..=end)
      && let Ok(ev) = serde_json::from_str::<ReviewOutputEvent>(slice)
    {
      return ev;
    }
    ReviewOutputEvent {
      overall_explanation: text.to_string(),
      ..Default::default()
    }
  }
}

pub fn event_to_json(event: &ThreadEvent) -> napi::Result<JsonValue> {
  serde_json::to_value(event).map_err(|e| napi::Error::from_reason(e.to_string()))
}

fn run_review_sync<F>(
  options: InternalRunRequest,
  review_request: ReviewRequest,
  handler: F,
) -> napi::Result<()>
where
  F: FnMut(ThreadEvent) + Send + 'static,
{
  let pending_tools = {
    let guard = registered_native_tools()
      .lock()
      .map_err(|e| napi::Error::from_reason(format!("tools mutex poisoned: {e}")))?;
    guard.clone()
  };
  set_pending_external_tools(pending_tools);

  let (_env_guard, linux_sandbox_path) = prepare_environment(&options)?;

  let handler_arc = Arc::new(Mutex::new(handler));
  let handler_for_callback = Arc::clone(&handler_arc);

  let runtime = tokio::runtime::Runtime::new()
    .map_err(|e| napi::Error::from_reason(format!("Failed to create runtime: {}", e)))?;

  runtime.block_on(async {
    let config_overrides = build_config_overrides(&options, linux_sandbox_path.clone());
    let config = Config::load_with_cli_overrides(Vec::new(), config_overrides)
      .await
      .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    if let Err(err) = enforce_login_restrictions(&config).await {
      return Err(napi::Error::from_reason(err.to_string()));
    }

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
    let conversation_manager = ConversationManager::new(auth_manager.clone(), SessionSource::Exec);
    let NewConversation {
      conversation,
      session_configured,
      ..
    } = conversation_manager
      .new_conversation(config.clone())
      .await
      .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let mut collector = ReviewEventCollector::new();

    let session_event = Event {
      id: String::new(),
      msg: EventMsg::SessionConfigured(session_configured.clone()),
    };
    for exec_event in collector.handle(&session_event) {
      if let Ok(mut handler) = handler_for_callback.lock() {
        (*handler)(exec_event);
      }
    }

    conversation
      .submit(Op::Review { review_request })
      .await
      .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let mut shutdown_initiated = false;
    loop {
      let event = conversation
        .next_event()
        .await
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

      let events = collector.handle(&event);
      for exec_event in events {
        if let Ok(mut handler) = handler_for_callback.lock() {
          (*handler)(exec_event);
        }
      }

      // Initiate shutdown after TaskComplete (review flow doesn't auto-shutdown)
      if !shutdown_initiated && matches!(event.msg, EventMsg::TaskComplete(_)) {
        conversation
          .submit(Op::Shutdown)
          .await
          .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        shutdown_initiated = true;
      }

      if matches!(event.msg, EventMsg::ShutdownComplete) {
        break;
      }
    }

    Ok(())
  })
}

fn run_internal_sync<F>(options: InternalRunRequest, handler: F) -> napi::Result<()>
where
  F: FnMut(ThreadEvent) + Send + 'static,
{
  if let Some(review_request) = options.review_request.clone() {
    return run_review_sync(options, review_request, handler);
  }

  let schema_file = prepare_schema(options.output_schema.clone())?;
  let schema_path = schema_file.as_ref().map(|file| file.path.clone());
  let cli = build_cli(&options, schema_path);

  let pending_tools = {
    let guard = registered_native_tools()
      .lock()
      .map_err(|e| napi::Error::from_reason(format!("tools mutex poisoned: {e}")))?;
    guard.clone()
  };
  set_pending_external_tools(pending_tools);

  let (_env_guard, linux_sandbox_path) = prepare_environment(&options)?;

  let handler_arc = Arc::new(Mutex::new(handler));
  let handler_for_callback = Arc::clone(&handler_arc);

  // Create a new Tokio runtime for this execution to avoid Send issues
  let runtime = tokio::runtime::Runtime::new()
    .map_err(|e| napi::Error::from_reason(format!("Failed to create runtime: {}", e)))?;

  runtime.block_on(async {
    run_with_thread_event_callback(cli, linux_sandbox_path, move |event| {
      if let Ok(mut guard) = handler_for_callback.lock() {
        (*guard)(event);
      }
    })
    .await
    .map_err(|e| napi::Error::from_reason(e.to_string()))
  })
}

#[napi]
pub async fn run_thread(req: RunRequest) -> napi::Result<Vec<String>> {
  let options = req.into_internal()?;
  let events: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
  let error_holder: Arc<Mutex<Option<napi::Error>>> = Arc::new(Mutex::new(None));

  let events_clone = Arc::clone(&events);
  let error_clone = Arc::clone(&error_holder);

  // Run in a blocking task to avoid Send issues with codex-exec internals
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
  .map_err(|e| napi::Error::from_reason(format!("Task join error: {}", e)))??;

  if let Some(err) = error_holder.lock().unwrap().take() {
    return Err(err);
  }

  let mut guard = events.lock().unwrap();
  Ok(std::mem::take(&mut *guard))
}

#[napi]
pub async fn run_thread_stream(
  req: RunRequest,
  on_event: ThreadsafeFunction<JsonValue>,
) -> napi::Result<()> {
  let options = req.into_internal()?;
  let error_holder: Arc<Mutex<Option<napi::Error>>> = Arc::new(Mutex::new(None));
  let error_clone = Arc::clone(&error_holder);

  // Run in a blocking task to avoid Send issues with codex-exec internals
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
  .map_err(|e| napi::Error::from_reason(format!("Task join error: {}", e)))??;

  if let Some(err) = error_holder.lock().unwrap().take() {
    return Err(err);
  }

  Ok(())
}
