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
  if let Some(tool_choice) = options.tool_choice.clone() {
    let encoded = serde_json::to_string(&tool_choice)
      .map_err(|e| napi::Error::from_reason(format!("Failed to encode toolChoice: {e}")))?;
    env_pairs.push(("CODEX_TOOL_CHOICE", Some(encoded), true));
  } else {
    env_pairs.push(("CODEX_TOOL_CHOICE", None, true));
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
