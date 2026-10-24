import type { IStoragePipelineInput } from '../types.js'
import type { IStorageJournalConfigurationSnapshot } from './configuration-options.js'
import { STORAGE_TELEMETRY_TAG } from './constants.js'

/** Resolve the optional logger only when the selected journal runtime is evaluated. */
const { LoggerLevel } = await import('@migaia/logger')

/** One observed endpoint retains only its current policy and timing facts until settlement. */
type IStorageTelemetryContext = {
  readonly initial: IStorageJournalConfigurationSnapshot | undefined
  readonly readOptions: () => IStorageJournalConfigurationSnapshot | undefined
  readonly describe: () => IStoragePipelineInput
  readonly now: () => number
  readonly started: number
  readonly report: (error: unknown) => void
}
/** The existing logger observes the settled endpoint without owning its execution or failure. */
function emitStorageTelemetry(
  state: IStorageTelemetryContext,
  outcome: 'success' | 'error',
  error?: unknown
): void {
  try {
    /** Read the same completed org configuration; never prepare again or create another budget. */
    const options = state.initial ?? state.readOptions()
    if (options?.telemetry !== true) return
    /** Backend authors supply canonical keys; the host never guesses an arbitrary input shape. */
    const request = state.describe()
    if (request.internal || request.scope !== undefined) return
    /** Original failures remain available in the normal logger schema without reconstruction. */
    const failure: Record<string, unknown> = {}
    if (error !== null && (typeof error === 'object' || typeof error === 'function')) {
      for (const name of ['source', 'code'] as const) {
        const field = (error as { source?: unknown; code?: unknown })[name]
        if (typeof field === 'string') failure[name] = field
      }
    }
    const level = outcome === 'success' ? LoggerLevel.debug : LoggerLevel.error
    const result: unknown = options.atLevel!(level, {
      tag: STORAGE_TELEMETRY_TAG,
      message: request.operation,
      args: outcome === 'error' ? [error] : [],
      meta: {
        backendId: request.backendId,
        backend: request.backend,
        orgId: request.orgId,
        operation: request.operation,
        level,
        keys: request.keys?.() ?? [],
        durationMs: Math.max(0, state.now() - state.started),
        outcome,
        ...failure,
        payload: request.input
      }
    })
    void Promise.resolve(result).catch(state.report)
  } catch (error) {
    state.report(error)
  }
}
/** Observe one real invocation while preserving its original rejection and result. */
async function runStorageTelemetry<R>(
  state: IStorageTelemetryContext,
  invoke: (observing: boolean) => Promise<R>
): Promise<R> {
  try {
    const result = await invoke(true)
    emitStorageTelemetry(state, 'success')
    return result
  } catch (error) {
    emitStorageTelemetry(state, 'error', error)
    throw error
  }
}
/** The original execution owner observes a complete public endpoint without retaining history. */
export function observeStorageTelemetry<R>(
  readOptions: () => IStorageJournalConfigurationSnapshot | undefined,
  describe: () => IStoragePipelineInput,
  invoke: (observing: boolean) => Promise<R>,
  now: () => number,
  report: (error: unknown) => void
): Promise<R> {
  const initial = readOptions()
  if (initial !== undefined && initial.telemetry !== true) return invoke(false)
  return runStorageTelemetry(
    { initial, readOptions, describe, now, started: now(), report },
    invoke
  )
}
