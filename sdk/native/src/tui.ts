import { getNativeBinding } from "./nativeBinding";
import type {
  NativeTuiRequest,
  NativeTuiExitInfo,
  NativeTokenUsage,
  NativeUpdateActionInfo,
  NativeUpdateActionKind,
} from "./nativeBinding";

export async function runTui(request: NativeTuiRequest): Promise<NativeTuiExitInfo> {
  const binding = getNativeBinding();
  if (!binding || typeof binding.runTui !== "function") {
    throw new Error("Native binding does not expose runTui");
  }
  return binding.runTui(request);
}

export type {
  NativeTuiRequest,
  NativeTuiExitInfo,
  NativeTokenUsage,
  NativeUpdateActionInfo,
  NativeUpdateActionKind,
};

