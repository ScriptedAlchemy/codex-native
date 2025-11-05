import { CodexOptions, NativeToolDefinition } from "./codexOptions";
import { CodexExec } from "./exec";
import { NativeBinding, getNativeBinding } from "./nativeBinding";
import { Thread } from "./thread";
import { ThreadOptions } from "./threadOptions";

/**
 * Codex is the main class for interacting with the Codex agent.
 *
 * This is the native NAPI-based implementation that uses Rust bindings directly.
 *
 * Use the `startThread()` method to start a new thread or `resumeThread()` to resume a previously started thread.
 */
export class Codex {
  private exec: CodexExec;
  private options: CodexOptions;
  private readonly nativeBinding: NativeBinding | null;

  constructor(options: CodexOptions = {}) {
    const predefinedTools = options.tools ? [...options.tools] : [];
    this.nativeBinding = getNativeBinding();
    this.options = { ...options, tools: [] };
    if (this.nativeBinding) {
      // clearRegisteredTools may not be available in all builds
      if (typeof this.nativeBinding.clearRegisteredTools === 'function') {
        this.nativeBinding.clearRegisteredTools();
      }
      for (const tool of predefinedTools) {
        this.registerTool(tool);
      }
    }
    this.exec = new CodexExec();
  }

  registerTool(tool: NativeToolDefinition): void {
    if (!this.nativeBinding) {
      throw new Error("Native tool registration requires the NAPI binding");
    }
    // registerTool may not be available in all builds
    if (typeof this.nativeBinding.registerTool !== 'function') {
      console.warn("registerTool is not available in this build - tools feature may be incomplete");
      return;
    }
    const { handler, ...info } = tool;
    this.nativeBinding.registerTool(info, handler);
    if (!this.options.tools) {
      this.options.tools = [];
    }
    this.options.tools.push(tool);
  }

  /**
   * Starts a new conversation with an agent.
   * @returns A new thread instance.
   */
  startThread(options: ThreadOptions = {}): Thread {
    return new Thread(this.exec, this.options, options);
  }

  /**
   * Resumes a conversation with an agent based on the thread id.
   * Threads are persisted in ~/.codex/sessions.
   *
   * @param id The id of the thread to resume.
   * @returns A new thread instance.
   */
  resumeThread(id: string, options: ThreadOptions = {}): Thread {
    return new Thread(this.exec, this.options, options, id);
  }
}
