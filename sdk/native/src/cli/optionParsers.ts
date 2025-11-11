import type { ApprovalMode, SandboxMode } from "../threadOptions";

const SANDBOX_MODE_VALUES = ["read-only", "workspace-write", "danger-full-access"] as const;
const APPROVAL_MODE_VALUES = ["never", "on-request", "on-failure", "untrusted"] as const;

function isSandboxMode(value: string): value is SandboxMode {
  return (SANDBOX_MODE_VALUES as readonly string[]).includes(value);
}

function isApprovalMode(value: string): value is ApprovalMode {
  return (APPROVAL_MODE_VALUES as readonly string[]).includes(value);
}

export function parseSandboxModeFlag(
  value: string | undefined,
  origin: string,
): SandboxMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (isSandboxMode(value)) {
    return value;
  }
  throw new Error(
    `Invalid sandbox mode "${value}" from ${origin}. Valid values: ${SANDBOX_MODE_VALUES.join(
      ", ",
    )}.`,
  );
}

export function parseApprovalModeFlag(
  value: string | undefined,
  origin: string,
): ApprovalMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (isApprovalMode(value)) {
    return value;
  }
  throw new Error(
    `Invalid approval mode "${value}" from ${origin}. Valid values: ${APPROVAL_MODE_VALUES.join(
      ", ",
    )}.`,
  );
}

