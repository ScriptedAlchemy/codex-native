import path from "node:path";

import type { NativeRunRequest, NativeTuiRequest } from "../nativeBinding";
import type {
  ApprovalMode,
  SandboxMode,
  ThreadOptions,
  WorkspaceWriteOptions,
} from "../threadOptions";

const FULL_ACCESS_SANDBOX: SandboxMode = "workspace-write";
const FULL_ACCESS_APPROVAL: ApprovalMode = "never";

type SandboxTarget = {
  sandboxMode?: SandboxMode;
  approvalMode?: ApprovalMode;
};

export function applyElevatedRunDefaults(request: NativeRunRequest, cwd: string): void {
  const workingDirectory = resolveWorkingDirectory(request.workingDirectory, cwd);
  request.workingDirectory = workingDirectory;
  ensureSandboxModes(request);
  request.workspaceWriteOptions = ensureWorkspaceWriteOptions(
    request.workspaceWriteOptions,
    workingDirectory,
  );
}

export function applyElevatedTuiDefaults(params: {
  request: NativeTuiRequest;
  thread: ThreadOptions;
  cwd: string;
}): void {
  const { request, thread, cwd } = params;
  const workingDirectory = resolveWorkingDirectory(
    request.workingDirectory ?? thread.workingDirectory,
    cwd,
  );

  request.workingDirectory = workingDirectory;
  thread.workingDirectory = workingDirectory;

  ensureSandboxModes(request);
  thread.sandboxMode = request.sandboxMode ?? thread.sandboxMode ?? FULL_ACCESS_SANDBOX;
  thread.approvalMode = request.approvalMode ?? thread.approvalMode ?? FULL_ACCESS_APPROVAL;

  thread.workspaceWriteOptions = ensureWorkspaceWriteOptions(
    thread.workspaceWriteOptions,
    workingDirectory,
  );
}

function ensureSandboxModes(target: SandboxTarget): void {
  if (!target.sandboxMode) {
    target.sandboxMode = FULL_ACCESS_SANDBOX;
  }
  if (!target.approvalMode) {
    target.approvalMode = FULL_ACCESS_APPROVAL;
  }
}

function ensureWorkspaceWriteOptions(
  options: WorkspaceWriteOptions | undefined,
  workingDirectory: string,
): WorkspaceWriteOptions {
  const resolved = path.resolve(workingDirectory);
  const writableRoots = new Set(options?.writableRoots ?? []);
  writableRoots.add(resolved);

  return {
    ...options,
    networkAccess: true,
    writableRoots: Array.from(writableRoots),
  };
}

function resolveWorkingDirectory(candidate: string | undefined, cwd: string): string {
  if (!candidate || candidate.trim().length === 0) {
    return path.resolve(cwd);
  }
  return path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate);
}
