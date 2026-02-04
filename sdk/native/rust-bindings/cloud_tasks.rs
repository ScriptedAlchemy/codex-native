#[napi(js_name = "cloudTasksList")]
pub async fn cloud_tasks_list(
  env_filter: Option<String>,
  base_url: Option<String>,
  api_key: Option<String>,
) -> napi::Result<String> {
  let client =
    build_cloud_client(base_url, api_key).map_err(|e| napi::Error::from_reason(e.to_string()))?;
  let tasks = cloud::CloudBackend::list_tasks(&client, env_filter.as_deref(), None, None)
    .await
    .map_err(|e| napi::Error::from_reason(e.to_string()))?;
  let payload = serde_json_json!({
    "tasks": tasks.tasks,
    "cursor": tasks.cursor,
  });
  serde_json::to_string(&payload).map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi(js_name = "cloudTasksGetDiff")]
pub async fn cloud_tasks_get_diff(
  task_id: String,
  base_url: Option<String>,
  api_key: Option<String>,
) -> napi::Result<String> {
  let client =
    build_cloud_client(base_url, api_key).map_err(|e| napi::Error::from_reason(e.to_string()))?;
  let diff_opt = cloud::CloudBackend::get_task_diff(&client, cloud::TaskId(task_id))
    .await
    .map_err(|e| napi::Error::from_reason(e.to_string()))?;
  let payload = serde_json_json!({ "diff": diff_opt });
  serde_json::to_string(&payload).map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi(js_name = "cloudTasksApplyPreflight")]
pub async fn cloud_tasks_apply_preflight(
  task_id: String,
  diff_override: Option<String>,
  base_url: Option<String>,
  api_key: Option<String>,
) -> napi::Result<String> {
  let client =
    build_cloud_client(base_url, api_key).map_err(|e| napi::Error::from_reason(e.to_string()))?;
  let outcome =
    cloud::CloudBackend::apply_task_preflight(&client, cloud::TaskId(task_id), diff_override)
      .await
      .map_err(|e| napi::Error::from_reason(e.to_string()))?;
  serde_json::to_string(&outcome).map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi(js_name = "cloudTasksApply")]
pub async fn cloud_tasks_apply(
  task_id: String,
  diff_override: Option<String>,
  base_url: Option<String>,
  api_key: Option<String>,
) -> napi::Result<String> {
  let client =
    build_cloud_client(base_url, api_key).map_err(|e| napi::Error::from_reason(e.to_string()))?;
  let outcome = cloud::CloudBackend::apply_task(&client, cloud::TaskId(task_id), diff_override)
    .await
    .map_err(|e| napi::Error::from_reason(e.to_string()))?;
  serde_json::to_string(&outcome).map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi(js_name = "cloudTasksCreate")]
pub async fn cloud_tasks_create(
  env_id: String,
  prompt: String,
  git_ref: Option<String>,
  qa_mode: Option<bool>,
  best_of_n: Option<i32>,
  base_url: Option<String>,
  api_key: Option<String>,
) -> napi::Result<String> {
  let client =
    build_cloud_client(base_url, api_key).map_err(|e| napi::Error::from_reason(e.to_string()))?;
  let resolved_git_ref = if let Some(g) = git_ref {
    g
  } else if let Ok(cwd) = std::env::current_dir() {
    if let Some(branch) = codex_core::git_info::default_branch_name(&cwd).await {
      branch
    } else if let Some(branch) = codex_core::git_info::current_branch_name(&cwd).await {
      branch
    } else {
      "main".to_string()
    }
  } else {
    "main".to_string()
  };
  let created = cloud::CloudBackend::create_task(
    &client,
    &env_id,
    &prompt,
    &resolved_git_ref,
    qa_mode.unwrap_or(false),
    best_of_n.unwrap_or(1).max(1) as usize,
  )
  .await
  .map_err(|e| napi::Error::from_reason(e.to_string()))?;
  let payload = serde_json_json!({ "id": created.id.0 });
  serde_json::to_string(&payload).map_err(|e| napi::Error::from_reason(e.to_string()))
}

// ============================================================================
