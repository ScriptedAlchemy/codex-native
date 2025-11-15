use codex_core::git_info::{
  RepoDiffConfig as CoreRepoDiffConfig,
  RepoDiffFileChange as CoreRepoDiffFileChange,
  RepoDiffSummary as CoreRepoDiffSummary,
  collect_repo_diff_summary as core_collect_repo_diff_summary,
};

#[napi(object)]
pub struct RepoDiffFileChange {
  pub path: String,
  pub status: String,
  pub diff: String,
  pub truncated: bool,
  #[napi(js_name = "previousPath")]
  pub previous_path: Option<String>,
}

impl From<CoreRepoDiffFileChange> for RepoDiffFileChange {
  fn from(value: CoreRepoDiffFileChange) -> Self {
    Self {
      path: value.path,
      status: value.status,
      diff: value.diff,
      truncated: value.truncated,
      previous_path: value.previous_path,
    }
  }
}

#[napi(object)]
pub struct RepoDiffSummary {
  #[napi(js_name = "repoPath")]
  pub repo_path: String,
  pub branch: String,
  #[napi(js_name = "baseBranch")]
  pub base_branch: String,
  #[napi(js_name = "upstreamRef")]
  pub upstream_ref: Option<String>,
  #[napi(js_name = "mergeBase")]
  pub merge_base: String,
  #[napi(js_name = "statusSummary")]
  pub status_summary: String,
  #[napi(js_name = "diffStat")]
  pub diff_stat: String,
  #[napi(js_name = "recentCommits")]
  pub recent_commits: String,
  #[napi(js_name = "changedFiles")]
  pub changed_files: Vec<RepoDiffFileChange>,
  #[napi(js_name = "totalChangedFiles")]
  pub total_changed_files: i64,
}

impl From<CoreRepoDiffSummary> for RepoDiffSummary {
  fn from(value: CoreRepoDiffSummary) -> Self {
    Self {
      repo_path: value.cwd,
      branch: value.branch,
      base_branch: value.base_branch,
      upstream_ref: value.upstream_ref,
      merge_base: value.merge_base,
      status_summary: value.status_summary,
      diff_stat: value.diff_stat,
      recent_commits: value.recent_commits,
      changed_files: value.changed_files.into_iter().map(RepoDiffFileChange::from).collect(),
      total_changed_files: value.total_changed_files as i64,
    }
  }
}

#[napi(object)]
pub struct RepoDiffOptions {
  #[napi(js_name = "maxFiles")]
  pub max_files: Option<i32>,
  #[napi(js_name = "diffContextLines")]
  pub diff_context_lines: Option<i32>,
  #[napi(js_name = "diffCharLimit")]
  pub diff_char_limit: Option<i32>,
}

impl RepoDiffOptions {
  fn apply(self, base: CoreRepoDiffConfig) -> CoreRepoDiffConfig {
    CoreRepoDiffConfig {
      max_files: self
        .max_files
        .map(|value| value.max(1) as usize)
        .unwrap_or(base.max_files),
      diff_context_lines: self
        .diff_context_lines
        .map(|value| value.max(1) as usize)
        .unwrap_or(base.diff_context_lines),
      diff_char_limit: self
        .diff_char_limit
        .map(|value| value.max(256) as usize)
        .unwrap_or(base.diff_char_limit),
    }
  }
}

#[napi]
pub async fn collect_repo_diff_summary(
  cwd: String,
  base_branch_override: Option<String>,
  options: Option<RepoDiffOptions>,
) -> napi::Result<RepoDiffSummary> {
  let default_config = CoreRepoDiffConfig::default();
  let config = options
    .map(|opts| opts.apply(default_config))
    .unwrap_or(default_config);
  let repo_path = PathBuf::from(&cwd);
  let summary = core_collect_repo_diff_summary(
    repo_path.as_path(),
    base_branch_override.as_deref(),
    config,
  )
  .await
  .map_err(|err| napi::Error::from_reason(format!("Failed to collect repo diff summary: {err}")))?;
  Ok(summary.into())
}
