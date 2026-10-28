/** Owns stable coroutine identity and diagnostic field strings, without supervision policy. */
/** Shared kind appears in profile admission and health failure detail. */
export const COROUTINE_KIND = 'coroutine'
/** Diagnostic field paths stay identical at constructor and task-publication boundaries. */
export const CoroutineField = {
  task: 'spec.task',
  heartbeat: 'heartbeat',
  heartbeatTimeout: 'heartbeat.timeoutMs',
  expose: 'expose'
} as const
/** Launcher fingerprints remain stable and advance only after synchronous task invocation. */
export function coroutineFingerprint(identity: number): string {
  return `coroutine:${identity}`
}
