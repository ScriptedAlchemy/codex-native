import type {
  BeforeStartHook,
  EventHook,
  HookContext,
  HookRegistration,
} from "./types";

export function emitWarnings(warnings: string[], fromIndex = 0): void {
  for (let i = fromIndex; i < warnings.length; i += 1) {
    const message = warnings[i];
    process.stderr.write(`[codex-native] Warning: ${message}\n`);
  }
}

export async function runBeforeStartHooks(
  hooks: Array<HookRegistration<BeforeStartHook>>,
  context: HookContext,
  warnings: string[],
): Promise<void> {
  for (const hook of hooks) {
    try {
      await hook.callback(context);
    } catch (error) {
      warnings.push(
        `beforeStart hook "${hook.source}" threw: ${(error as Error).message ?? String(error)}`,
      );
    }
  }
}

export async function runEventHooks(
  hooks: Array<HookRegistration<EventHook>>,
  event: unknown,
  context: HookContext,
  warnings: string[],
): Promise<void> {
  for (const hook of hooks) {
    try {
      await hook.callback(event, context);
    } catch (error) {
      warnings.push(`onEvent hook "${hook.source}" threw: ${(error as Error).message ?? String(error)}`);
    }
  }
}

