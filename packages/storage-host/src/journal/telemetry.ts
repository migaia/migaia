import { LoggerLevel } from '@migaia/logger'
import { tryReadProperty } from '@migaia/utils/error'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import type { IStoragePipelineInput } from '../types.js'
import type { IStorageJournalConfigurationSnapshot } from './configuration-options.js'
import { STORAGE_TELEMETRY_TAG } from './constants.js'

/** The original execution owner observes a complete public endpoint without retaining history. */
export function observeStorageTelemetry<R>(
  readOptions: () => IStorageJournalConfigurationSnapshot | undefined,
  describe: () => IStoragePipelineInput,
  invoke: (observing: boolean) => Promise<R>,
  now: () => number,
  report: (error: unknown) => void
): Promise<R> {
  /** A first org's original prepare runs inside invoke, so its configuration may not exist yet. */
  const initial = readOptions()
  if (initial !== undefined && initial.telemetry !== true) return invoke(false)
  /** Only selected observation allocates timing or ordinary logger payload data. */
  const started = now()
  const emit = (outcome: 'success' | 'error', error?: unknown): void => {
    try {
      /** Read the same completed org configuration; never prepare again or create another budget. */
      const options = initial ?? readOptions()
      if (options?.telemetry !== true) return
      /** Backend authors supply canonical keys; the host never guesses an arbitrary input shape. */
      const request = describe()
      if (request.internal || request.scope !== undefined) return
      /** Original failures remain available in the normal logger schema without reconstruction. */
      const failure: Record<string, unknown> = {}
      if (error !== null && (typeof error === 'object' || typeof error === 'function')) {
        for (const name of ['source', 'code'] as const) {
          const field = tryReadProperty(error as { source?: unknown; code?: unknown }, name)
          if (field.threw) report(field.error)
          else if (typeof field.value === 'string') failure[name] = field.value
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
          durationMs: Math.max(0, now() - started),
          outcome,
          ...failure,
          payload: request.input
        }
      })
      observeThenableRejection(result, inspectThenable(result), report)
    } catch (error) {
      report(error)
    }
  }
  return (async () => {
    try {
      const result = await invoke(true)
      emit('success')
      return result
    } catch (error) {
      emit('error', error)
      throw error
    }
  })()
}
