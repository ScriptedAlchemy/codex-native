import type { ThreadEvent, ThreadItem } from "@codex-native/sdk";
import { attachApplyPatchReminder } from "../src/reminders/applyPatchReminder.js";

class MockThread {
  private listeners: ((event: ThreadEvent) => void)[] = [];
  public reminders: string[] = [];

  onEvent(listener: (event: ThreadEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  async sendBackgroundEvent(message: string): Promise<void> {
    this.reminders.push(message);
  }

  emit(event: ThreadEvent) {
    this.listeners.forEach((listener) => listener(event));
  }
}

function commandItem(command: string): ThreadItem {
  return {
    id: Math.random().toString(36).slice(2),
    type: "command_execution",
    command,
    aggregated_output: "",
    status: "completed",
  } as ThreadItem;
}

async function run() {
  const thread = new MockThread();
  attachApplyPatchReminder(thread as any, "danger-full-access");

  thread.emit({
    type: "item.completed",
    item: commandItem("cat <<'EOF' > foo.ts\nconst x = 1\nEOF"),
  });
  thread.emit({
    type: "item.completed",
    item: commandItem("ls -lah"),
  });

  if (thread.reminders.length === 1) {
    console.log("Reminder emitted:", thread.reminders[0]);
  } else {
    console.error("Expected 1 reminder, got", thread.reminders.length);
    process.exit(1);
  }
}

void run();
