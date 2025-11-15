import type { SandboxMode, Thread } from "@codex-native/sdk";

const APPLY_PATCH_REMINDER =
  "Heads up: this shell command looks like it edits files directly. Prefer using apply_patch so the rest of the tooling can track diffs and diagnostics.";

const EDIT_PREFIXES = new Set([
  "cat",
  "tee",
  "printf",
  "echo",
  "python",
  "node",
  "perl",
  "ruby",
  "bash",
  "sh",
]);

export function attachApplyPatchReminder(thread: Thread, sandboxMode?: SandboxMode): () => void {
  if (!sandboxAllowsWrites(sandboxMode)) {
    return () => {};
  }

  const reminded = new Set<string>();
  const unsubscribe = thread.onEvent((event) => {
    if (event.type !== "item.completed") {
      return;
    }
    if (event.item.type !== "command_execution") {
      return;
    }
    const command = event.item.command?.trim();
    if (!command || !commandLooksLikeManualEdit(command)) {
      return;
    }
    const key = `${event.item.id}:${command}`;
    if (reminded.has(key)) {
      return;
    }
    reminded.add(key);
    void thread
      .sendBackgroundEvent(APPLY_PATCH_REMINDER)
      .catch((error) => console.warn("Failed to send apply_patch reminder:", error));
  });

  return unsubscribe;
}

export function commandLooksLikeManualEdit(command: string): boolean {
  const normalized = command.toLowerCase();
  if (normalized.includes("apply_patch")) {
    return false;
  }

  if (normalized.includes("cat <<") && normalized.includes(">")) {
    return true;
  }

  if (normalized.includes(" tee ") || normalized.startsWith("tee ") || normalized.includes("| tee")) {
    return true;
  }

  if (normalized.includes("sed -i")) {
    return true;
  }

  if (normalized.includes("perl -pi") || normalized.includes("perl -0pi")) {
    return true;
  }

  if (normalized.includes("python") && normalized.includes("open(") && normalized.includes("write")) {
    return true;
  }

  if (normalized.includes("ruby") && normalized.includes("file.open")) {
    return true;
  }

  if (normalized.includes("node") && (normalized.includes("fs.writefile") || normalized.includes("fs.createwritestream"))) {
    return true;
  }

  if (normalized.includes(">>")) {
    return true;
  }

  const firstToken = normalized.split(/\s+/)[0];
  if (EDIT_PREFIXES.has(firstToken) && normalized.includes(">")) {
    return true;
  }

  return false;
}

function sandboxAllowsWrites(mode?: SandboxMode): boolean {
  if (!mode) {
    return true;
  }
  return mode === "danger-full-access" || mode === "workspace-write";
}
