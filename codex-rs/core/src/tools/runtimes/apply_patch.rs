//! Apply Patch runtime: executes verified patches under the orchestrator.
//!
//! Assumes `apply_patch` verification/approval happened upstream. Reuses that
//! decision to avoid re-prompting, builds the self-invocation command for
//! `codex --codex-run-as-apply-patch`, and runs under the current
//! `SandboxAttempt` with a minimal environment.
use crate::CODEX_APPLY_PATCH_ARG1;
use crate::exec::ExecToolCallOutput;
use crate::sandboxing::CommandSpec;
use crate::sandboxing::execute_env;
use crate::tools::sandboxing::Approvable;
use crate::tools::sandboxing::ApprovalCtx;
use crate::tools::sandboxing::ProvidesSandboxRetryData;
use crate::tools::sandboxing::SandboxAttempt;
use crate::tools::sandboxing::SandboxRetryData;
use crate::tools::sandboxing::Sandboxable;
use crate::tools::sandboxing::SandboxablePreference;
use crate::tools::sandboxing::ToolCtx;
use crate::tools::sandboxing::ToolError;
use crate::tools::sandboxing::ToolRuntime;
use crate::tools::sandboxing::with_cached_approval;
use codex_protocol::protocol::AskForApproval;
use codex_protocol::protocol::ReviewDecision;
use futures::future::BoxFuture;
use std::collections::HashMap;
use std::path::Path;
use std::path::PathBuf;

const NODE_CLI_ENTRYPOINT_ENV: &str = "CODEX_NODE_CLI_ENTRYPOINT";

#[derive(Clone, Debug)]
pub struct ApplyPatchRequest {
    pub patch: String,
    pub cwd: PathBuf,
    pub timeout_ms: Option<u64>,
    pub user_explicitly_approved: bool,
    pub codex_exe: Option<PathBuf>,
}

impl ProvidesSandboxRetryData for ApplyPatchRequest {
    fn sandbox_retry_data(&self) -> Option<SandboxRetryData> {
        None
    }
}

#[derive(Default)]
pub struct ApplyPatchRuntime;

#[derive(serde::Serialize, Clone, Debug, Eq, PartialEq, Hash)]
pub(crate) struct ApprovalKey {
    patch: String,
    cwd: PathBuf,
}

impl ApplyPatchRuntime {
    pub fn new() -> Self {
        Self
    }

    fn build_command_spec(req: &ApplyPatchRequest) -> Result<CommandSpec, ToolError> {
        use std::env;
        let exe = if let Some(path) = &req.codex_exe {
            path.clone()
        } else {
            env::current_exe()
                .map_err(|e| ToolError::Rejected(format!("failed to determine codex exe: {e}")))?
        };
        let program = exe.to_string_lossy().to_string();
        let mut args = Vec::new();
        if should_use_node_entrypoint(&exe)
            && let Ok(entrypoint) = env::var(NODE_CLI_ENTRYPOINT_ENV)
            && !entrypoint.is_empty()
        {
            args.push(entrypoint);
        }
        args.push(CODEX_APPLY_PATCH_ARG1.to_string());
        args.push(req.patch.clone());
        Ok(CommandSpec {
            program,
            args,
            cwd: req.cwd.clone(),
            expiration: req.timeout_ms.into(),
            // Run apply_patch with a minimal environment for determinism and to avoid leaks.
            env: HashMap::new(),
            with_escalated_permissions: None,
            justification: None,
        })
    }

    fn stdout_stream(ctx: &ToolCtx<'_>) -> Option<crate::exec::StdoutStream> {
        Some(crate::exec::StdoutStream {
            sub_id: ctx.turn.sub_id.clone(),
            call_id: ctx.call_id.clone(),
            tx_event: ctx.session.get_tx_event(),
        })
    }
}

fn should_use_node_entrypoint(exe: &Path) -> bool {
    exe.file_stem()
        .and_then(|stem| stem.to_str())
        .map(|name| matches!(name, "node" | "nodejs"))
        .unwrap_or(false)
}

impl Sandboxable for ApplyPatchRuntime {
    fn sandbox_preference(&self) -> SandboxablePreference {
        SandboxablePreference::Auto
    }
    fn escalate_on_failure(&self) -> bool {
        true
    }
}

impl Approvable<ApplyPatchRequest> for ApplyPatchRuntime {
    type ApprovalKey = ApprovalKey;

    fn approval_key(&self, req: &ApplyPatchRequest) -> Self::ApprovalKey {
        ApprovalKey {
            patch: req.patch.clone(),
            cwd: req.cwd.clone(),
        }
    }

    fn start_approval_async<'a>(
        &'a mut self,
        req: &'a ApplyPatchRequest,
        ctx: ApprovalCtx<'a>,
    ) -> BoxFuture<'a, ReviewDecision> {
        let key = self.approval_key(req);
        let session = ctx.session;
        let turn = ctx.turn;
        let call_id = ctx.call_id.to_string();
        let cwd = req.cwd.clone();
        let retry_reason = ctx.retry_reason.clone();
        let risk = ctx.risk.clone();
        let user_explicitly_approved = req.user_explicitly_approved;
        Box::pin(async move {
            with_cached_approval(&session.services, key, move || async move {
                if let Some(reason) = retry_reason {
                    session
                        .request_command_approval(
                            turn,
                            call_id,
                            vec!["apply_patch".to_string()],
                            cwd,
                            Some(reason),
                            risk,
                        )
                        .await
                } else if user_explicitly_approved {
                    ReviewDecision::ApprovedForSession
                } else {
                    ReviewDecision::Approved
                }
            })
            .await
        })
    }

    fn wants_no_sandbox_approval(&self, policy: AskForApproval) -> bool {
        !matches!(policy, AskForApproval::Never)
    }
}

impl ToolRuntime<ApplyPatchRequest, ExecToolCallOutput> for ApplyPatchRuntime {
    async fn run(
        &mut self,
        req: &ApplyPatchRequest,
        attempt: &SandboxAttempt<'_>,
        ctx: &ToolCtx<'_>,
    ) -> Result<ExecToolCallOutput, ToolError> {
        let spec = Self::build_command_spec(req)?;
        let env = attempt
            .env_for(spec)
            .map_err(|err| ToolError::Codex(err.into()))?;
        let out = execute_env(env, attempt.policy, Self::stdout_stream(ctx))
            .await
            .map_err(ToolError::Codex)?;
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::CODEX_APPLY_PATCH_ARG1;
    use serial_test::serial;
    use std::env;

    fn make_request_with_exe(exe: &str) -> ApplyPatchRequest {
        ApplyPatchRequest {
            patch: "*** Begin Patch\n*** End Patch".to_string(),
            cwd: PathBuf::from("/tmp"),
            timeout_ms: None,
            user_explicitly_approved: true,
            codex_exe: Some(PathBuf::from(exe)),
        }
    }

    fn with_entrypoint_env<T>(value: Option<&str>, f: impl FnOnce() -> T) -> T {
        let original = env::var(NODE_CLI_ENTRYPOINT_ENV).ok();
        match value {
            Some(val) => unsafe { env::set_var(NODE_CLI_ENTRYPOINT_ENV, val) },
            None => unsafe { env::remove_var(NODE_CLI_ENTRYPOINT_ENV) },
        }
        let result = f();
        match original {
            Some(val) => unsafe { env::set_var(NODE_CLI_ENTRYPOINT_ENV, val) },
            None => unsafe { env::remove_var(NODE_CLI_ENTRYPOINT_ENV) },
        }
        result
    }

    #[test]
    #[serial]
    fn build_command_spec_skips_entrypoint_for_codex_binary() {
        with_entrypoint_env(Some("cli.cjs"), || {
            let req = make_request_with_exe("/usr/local/bin/codex");
            let spec = ApplyPatchRuntime::build_command_spec(&req).expect("spec");
            assert_eq!(spec.args.len(), 2);
            assert_eq!(spec.args[0], CODEX_APPLY_PATCH_ARG1);
            assert_eq!(spec.args[1], req.patch);
        });
    }

    #[test]
    #[serial]
    fn build_command_spec_includes_entrypoint_for_node_binary() {
        with_entrypoint_env(Some("/app/cli.cjs"), || {
            let req = make_request_with_exe("/usr/local/bin/node");
            let spec = ApplyPatchRuntime::build_command_spec(&req).expect("spec");
            assert_eq!(spec.args.len(), 3);
            assert_eq!(spec.args[0], "/app/cli.cjs");
            assert_eq!(spec.args[1], CODEX_APPLY_PATCH_ARG1);
            assert_eq!(spec.args[2], req.patch);
        });
    }
}
