export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function runExampleStep<T>(
  label: string,
  step: () => Promise<T>,
): Promise<T | null> {
  try {
    return await step();
  } catch (error) {
    console.error(`✗ ${label} failed: ${describeError(error)}`);
    return null;
  }
}

export function ensureResult<T>(result: T | null, context: string): result is T {
  if (!result) {
    console.log(`Skipping ${context} due to a connection issue.`);
    return false;
  }
  return true;
}
