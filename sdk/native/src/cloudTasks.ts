import { getNativeBinding } from "./nativeBinding";

// Types reflect the Rust JSON (snake_case) to avoid extra transforms.
export type CloudTaskStatus = "pending" | "ready" | "applied" | "error";

export type DiffSummary = {
  files_changed: number;
  lines_added: number;
  lines_removed: number;
};

export type CloudTaskSummary = {
  id: string; // serde transparent TaskId
  title: string;
  status: CloudTaskStatus;
  updated_at: string; // ISO timestamp
  environment_id?: string | null;
  environment_label?: string | null;
  summary: DiffSummary;
  is_review?: boolean;
  attempt_total?: number | null;
};

export type CloudApplyStatus = "success" | "partial" | "error";

export type CloudApplyOutcome = {
  applied: boolean;
  status: CloudApplyStatus;
  message: string;
  skipped_paths: string[];
  conflict_paths: string[];
};

export type CloudTaskCreateResult = {
  id: string;
};

export type CloudTasksOptions = {
  baseUrl?: string;
  apiKey?: string;
};

export class CloudTasks {
  constructor(private readonly options: CloudTasksOptions = {}) {}

  private binding() {
    const b = getNativeBinding();
    if (!b) throw new Error("Native binding not available");
    return b;
  }

  async list(env?: string): Promise<CloudTaskSummary[]> {
    const b = this.binding();
    if (!b.cloudTasksList) throw new Error("cloudTasksList is not available in this build");
    const json = await b.cloudTasksList(env, this.options.baseUrl, this.options.apiKey);
    return JSON.parse(json) as CloudTaskSummary[];
  }

  async getDiff(taskId: string): Promise<string | null> {
    const b = this.binding();
    if (!b.cloudTasksGetDiff) throw new Error("cloudTasksGetDiff is not available in this build");
    const json = await b.cloudTasksGetDiff(taskId, this.options.baseUrl, this.options.apiKey);
    const parsed = JSON.parse(json) as { diff: string | null };
    return parsed.diff ?? null;
  }

  async applyPreflight(taskId: string, diffOverride?: string): Promise<CloudApplyOutcome> {
    const b = this.binding();
    if (!b.cloudTasksApplyPreflight) {
      throw new Error("cloudTasksApplyPreflight is not available in this build");
    }
    const json = await b.cloudTasksApplyPreflight(
      taskId,
      diffOverride,
      this.options.baseUrl,
      this.options.apiKey,
    );
    return JSON.parse(json) as CloudApplyOutcome;
  }

  async apply(taskId: string, diffOverride?: string): Promise<CloudApplyOutcome> {
    const b = this.binding();
    if (!b.cloudTasksApply) throw new Error("cloudTasksApply is not available in this build");
    const json = await b.cloudTasksApply(
      taskId,
      diffOverride,
      this.options.baseUrl,
      this.options.apiKey,
    );
    return JSON.parse(json) as CloudApplyOutcome;
  }

  async create(
    envId: string,
    prompt: string,
    opts?: { gitRef?: string; qaMode?: boolean; bestOfN?: number },
  ): Promise<CloudTaskCreateResult> {
    const b = this.binding();
    if (!b.cloudTasksCreate) throw new Error("cloudTasksCreate is not available in this build");
    const json = await b.cloudTasksCreate(
      envId,
      prompt,
      opts?.gitRef,
      opts?.qaMode,
      opts?.bestOfN,
      this.options.baseUrl,
      this.options.apiKey,
    );
    return JSON.parse(json) as CloudTaskCreateResult;
  }
}


