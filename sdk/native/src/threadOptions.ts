export type ApprovalMode = "never" | "on-request" | "on-failure" | "untrusted";

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export type WorkspaceWriteOptions = {
  /** Enable network access in workspace-write mode. Default: false */
  networkAccess?: boolean;
  /** Additional directories that should be writable */
  writableRoots?: string[];
  /** Exclude the TMPDIR environment variable from writable roots. Default: false */
  excludeTmpdirEnvVar?: boolean;
  /** Exclude /tmp from writable roots on Unix. Default: false */
  excludeSlashTmp?: boolean;
};

export type ThreadOptions = {
  model?: string;
  /** Use local OSS provider via Ollama (pulls models as needed) */
  oss?: boolean;
  sandboxMode?: SandboxMode;
  /** Approval policy for command execution */
  approvalMode?: ApprovalMode;
  /** Options for workspace-write sandbox mode */
  workspaceWriteOptions?: WorkspaceWriteOptions;
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  /** @deprecated Use sandboxMode and approvalMode instead */
  fullAuto?: boolean;
};
