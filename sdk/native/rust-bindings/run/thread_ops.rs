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

fn conversation_item_to_summary(item: codex_core::ThreadItem) -> ConversationSummary {
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


#[napi]
pub fn run_thread(req: RunRequest) -> napi::Result<napi::bindgen_prelude::AsyncTask<RunThreadTask>> {
  let options = req.into_internal()?;
  Ok(napi::bindgen_prelude::AsyncTask::new(RunThreadTask { options }))
}

pub struct RunThreadTask {
  options: InternalRunRequest,
}

impl napi::bindgen_prelude::Task for RunThreadTask {
  type Output = Vec<String>;
  type JsValue = Vec<String>;

  fn compute(&mut self) -> napi::Result<Self::Output> {
    let events: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let error_holder: Arc<Mutex<Option<napi::Error>>> = Arc::new(Mutex::new(None));

    let events_clone = Arc::clone(&events);
    let error_clone: Arc<Mutex<Option<napi::Error>>> = Arc::clone(&error_holder);

    run_internal_sync(self.options.clone(), move |event| match event_to_json(&event) {
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
    })?;

    if let Some(err) = error_holder.lock().unwrap().take() {
      return Err(err);
    }

    let mut guard = events.lock().unwrap();
    Ok(std::mem::take(&mut *guard))
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
    Ok(output)
  }
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

  let page = RolloutRecorder::list_threads(
    &config.codex_home,
    page_size,
    cursor.as_ref(),
    codex_core::ThreadSortKey::UpdatedAt,
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

  let path = find_thread_path_by_id_str(&config.codex_home, &req.id)
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
  let manager =
    ThreadManager::new(config.codex_home.clone(), auth_manager.clone(), SessionSource::Exec);
  let rollout_path = PathBuf::from(req.rollout_path);

  let new_conv = manager
    .resume_thread_from_rollout(config, rollout_path, auth_manager)
    .await
    .map_err(|e| napi::Error::from_reason(format!("Failed to resume conversation: {e}")))?;

  let thread_id = new_conv.thread_id.to_string();
  let rollout_path = new_conv
    .session_configured
    .rollout_path
    .as_ref()
    .ok_or_else(|| {
      napi::Error::from_reason("Resume did not return a rollout path".to_string())
    })?
    .to_string_lossy()
    .to_string();

  manager.remove_thread(&new_conv.thread_id).await;

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
    let config = Config::load_with_cli_overrides_and_harness_overrides(cli_kv_overrides, overrides)
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

    let path_opt = find_thread_path_by_id_str(&config.codex_home, &thread_id)
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

    let manager = ThreadManager::new(config.codex_home.clone(), auth_manager, SessionSource::Exec);

    let new_conv = manager
      .fork_thread(nth_user_message, config.clone(), path.clone())
      .await
      .map_err(|e| napi::Error::from_reason(format!("Failed to fork conversation: {e}")))?;

    let new_id = new_conv.thread_id.to_string();
    let rollout_path = new_conv
      .session_configured
      .rollout_path
      .as_ref()
      .ok_or_else(|| {
        napi::Error::from_reason("Fork did not return a rollout path".to_string())
      })?
      .to_string_lossy()
      .to_string();

    manager.remove_thread(&new_conv.thread_id).await;

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

pub struct RunThreadStreamTask {
  options: InternalRunRequest,
  on_event: Option<ThreadsafeFunction<JsonValue>>,
}

impl napi::bindgen_prelude::Task for RunThreadStreamTask {
  type Output = ();
  type JsValue = ();

  fn compute(&mut self) -> napi::Result<Self::Output> {
    let on_event = self
      .on_event
      .take()
      .ok_or_else(|| napi::Error::from_reason("run_thread_stream task already consumed"))?;
    let error_holder: Arc<Mutex<Option<napi::Error>>> = Arc::new(Mutex::new(None));
    let error_clone: Arc<Mutex<Option<napi::Error>>> = Arc::clone(&error_holder);

    run_internal_sync(self.options.clone(), move |event| match event_to_json(&event) {
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
    })?;

    if let Some(err) = error_holder.lock().unwrap().take() {
      return Err(err);
    }

    Ok(())
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
    Ok(output)
  }
}

#[napi]
pub fn run_thread_stream(
  req: RunRequest,
  #[napi(ts_arg_type = "(err: unknown, eventJson?: string) => void")] on_event: ThreadsafeFunction<
    JsonValue,
  >,
) -> napi::Result<napi::bindgen_prelude::AsyncTask<RunThreadStreamTask>> {
  let options = req.into_internal()?;
  Ok(napi::bindgen_prelude::AsyncTask::new(RunThreadStreamTask {
    options,
    on_event: Some(on_event),
  }))
}
