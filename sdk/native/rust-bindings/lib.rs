#![deny(clippy::all)]

use std::path::PathBuf;
use std::sync::OnceLock;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use codex_common::CliConfigOverrides;
use codex_common::SandboxModeCliArg;
use codex_core::function_tool::FunctionCallError;
use codex_core::tools::context::ToolInvocation;
use codex_core::tools::context::ToolOutput;
use codex_core::tools::context::ToolPayload;
use codex_core::tools::registry::{
  ExternalToolRegistration, ToolHandler, ToolKind, set_pending_external_tools,
};
use codex_core::tools::spec::create_function_tool_spec_from_schema;
use codex_exec::exec_events::ThreadEvent as ExecThreadEvent;
use codex_exec::run_with_thread_event_callback;
use codex_exec::{Cli, Color, Command, ResumeArgs};
use napi::bindgen_prelude::{Function, Status};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use serde_json::Value as JsonValue;
use serde_json::json;
use tempfile::NamedTempFile;

#[cfg(target_os = "linux")]
use std::io::Write;

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
}

struct InternalRunRequest {
  prompt: String,
  thread_id: Option<String>,
  images: Vec<PathBuf>,
  model: Option<String>,
  sandbox_mode: Option<SandboxModeCliArg>,
  working_directory: Option<PathBuf>,
  skip_git_repo_check: bool,
  output_schema: Option<JsonValue>,
  base_url: Option<String>,
  api_key: Option<String>,
  linux_sandbox_path: Option<PathBuf>,
  full_auto: bool,
}

impl RunRequest {
  fn into_internal(self) -> napi::Result<InternalRunRequest> {
    let sandbox_mode = match self.sandbox_mode.as_deref() {
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

    let images = self
      .images
      .unwrap_or_default()
      .into_iter()
      .map(PathBuf::from)
      .collect();

    let working_directory = self.working_directory.map(PathBuf::from);

    Ok(InternalRunRequest {
      prompt: self.prompt,
      thread_id: self.thread_id,
      images,
      model: self.model,
      sandbox_mode,
      working_directory,
      skip_git_repo_check: self.skip_git_repo_check.unwrap_or(false),
      output_schema: self.output_schema,
      base_url: self.base_url,
      api_key: self.api_key,
      linux_sandbox_path: self.linux_sandbox_path.map(PathBuf::from),
      full_auto: self.full_auto.unwrap_or(true),
    })
  }
}

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

fn build_cli(options: &InternalRunRequest, schema_path: Option<PathBuf>) -> Cli {
  let sandbox_mode = options.sandbox_mode;
  let wants_danger = matches!(sandbox_mode, Some(SandboxModeCliArg::DangerFullAccess));
  let cli_full_auto = options.full_auto && !wants_danger;

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
    sandbox_mode,
    config_profile: None,
    full_auto: cli_full_auto,
    dangerously_bypass_approvals_and_sandbox: wants_danger,
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

fn event_to_json(event: &ExecThreadEvent) -> napi::Result<JsonValue> {
  serde_json::to_value(event).map_err(|e| napi::Error::from_reason(e.to_string()))
}

fn run_internal_sync<F>(options: InternalRunRequest, handler: F) -> napi::Result<()>
where
  F: FnMut(ExecThreadEvent) + Send + 'static,
{
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
