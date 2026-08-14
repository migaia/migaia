import type { IRuntime } from '@migaia/reactive';

/** Isolate React listener failures from reactive dependency commits. */
export function notifyReact(runtime: IRuntime, onChange: () => void): void {
  try {
    runtime.untracked(onChange);
  } catch (error) {
    runtime.reportError(error, { phase: 'subscription-listener' });
  }
}
