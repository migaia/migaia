import { createErrorCollector, type ICollectedError } from '@migaia/lifecycle'
import { SUPERVISION_SOURCE, SupervisionErrorCode } from '../error-code.js'
import { SupervisionErrorText } from '../error-text.js'
import { createSupervisionError } from '../errors.js'
import { invalidProcessOption } from './spec.js'
import { OrphanProbeResult } from './constants.js'
import type { IProcessLauncher, IProcessRegistry } from './types.js'

/** Recoverable result of scanning records left by an earlier parent run. */
export type IOrphanReclaimResult = {
  readonly terminated: readonly string[]
  readonly removed: readonly string[]
  readonly failures: readonly ICollectedError[]
}

/** Reclaims only matching fingerprints and retains failed records for another attempt. */
export async function reclaimOrphanProcesses(options: {
  readonly registry: IProcessRegistry
  readonly namespace: string
  readonly launcher: IProcessLauncher
  readonly report: (error: unknown) => void
}): Promise<IOrphanReclaimResult> {
  if (
    !options ||
    !options.registry ||
    typeof options.registry.list !== 'function' ||
    typeof options.registry.remove !== 'function' ||
    typeof options.launcher?.probe !== 'function' ||
    typeof options.launcher?.terminateRecord !== 'function' ||
    typeof options.report !== 'function'
  )
    invalidProcessOption('registry')
  const terminated: string[] = []
  const removed: string[] = []
  const collector = createErrorCollector('collect', options.report)
  /** Recovery failures at every storage step share the existing collection and report policy. */
  const recordFailure = (cause: unknown, detail: Readonly<Record<string, unknown>>): void => {
    /** The recovery error owns its semantic identity while retaining the original storage failure. */
    const error = createSupervisionError(
      Error,
      SupervisionErrorCode.orphanReclaimFailed,
      SupervisionErrorText.orphanReclaimFailed,
      { cause, detail: { kind: 'process', ...detail } }
    )
    collector.add(SUPERVISION_SOURCE, error)
    options.report(error)
  }
  /** Listing has no per-record identity yet; a failed scan must not touch any record. */
  let records: Awaited<ReturnType<IProcessRegistry['list']>>
  try {
    records = await options.registry.list(options.namespace)
  } catch (cause) {
    recordFailure(cause, { step: 'list' })
    return {
      terminated,
      removed,
      failures: collector.finalize(SupervisionErrorText.orphanReclaimFailed)
    }
  }
  for (const record of records) {
    let step = 'probe'
    try {
      const result = await options.launcher.probe!(record)
      if (result === OrphanProbeResult.alive) {
        step = 'terminate'
        await options.launcher.terminateRecord!(record)
        terminated.push(record.id)
      }
      step = 'remove'
      await options.registry.remove(record.id)
      removed.push(record.id)
    } catch (cause) {
      recordFailure(cause, { recordId: record.id, step })
    }
  }
  return {
    terminated,
    removed,
    failures: collector.finalize(SupervisionErrorText.orphanReclaimFailed)
  }
}
