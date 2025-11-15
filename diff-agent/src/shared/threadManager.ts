import { Codex, attachLspDiagnostics, type ForkOptions, type Thread, type ThreadOptions } from "@codex-native/sdk";

/**
 * Centralizes thread creation/forking so every thread automatically
 * receives an LSP diagnostics bridge and we avoid duplicating attach logic
 * across different workflows (merge solver, CI runner, etc.).
 */
export class ThreadManager {
  private readonly lspDetachers = new WeakMap<Thread, () => void>();

  constructor(private readonly codex: Codex, private readonly workingDirectory: string) {}

  start(options: ThreadOptions): Thread {
    const thread = this.codex.startThread(options);
    this.attach(thread);
    return thread;
  }

  async fork(parent: Thread, options: ForkOptions): Promise<Thread> {
    const forked = await parent.fork(options);
    this.attach(forked);
    return forked;
  }

  attach(thread: Thread | null): void {
    if (!thread || this.lspDetachers.has(thread)) {
      return;
    }
    try {
      const detach = attachLspDiagnostics(thread, {
        workingDirectory: this.workingDirectory,
        waitForDiagnostics: true,
      });
      this.lspDetachers.set(thread, detach);
    } catch {
      // Attaching diagnostics is best-effort; ignore failures so the
      // orchestrator can keep running even if local language servers
      // are unavailable.
    }
  }
}
