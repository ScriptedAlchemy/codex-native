import type { Thread } from "../thread";
import type { LspManagerOptions } from "./types";
import { LspDiagnosticsBridge } from "./bridge";

/**
 * Attaches the LSP diagnostics bridge to a thread.
 * Returns a cleanup function that detaches the bridge and disposes shared resources.
 */
export function attachLspDiagnostics(thread: Thread, options: LspManagerOptions): () => void {
  const bridge = new LspDiagnosticsBridge(options);
  const detach = bridge.attach(thread);
  return () => {
    detach();
    void bridge.dispose().catch((error) => {
      console.warn("Failed to dispose LSP bridge", error);
    });
  };
}

