/** Recovers durable process identities sequentially, retaining per-record failure traceability. */
import { PROCESS_KIND, ProcessField, RecoveryStep } from './text.js'
import { createErrorCollector, LifecycleErrorPolicy, type ICollectedError } from '@migaia/lifecycle'
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

/**
 * Cleans up processes recorded by an earlier run of the parent, typically right after startup and
 * before creating supervisors.
 *
 * For each record in `namespace`, the launcher probes the process: a live process with a matching
 * fingerprint is terminated, while a gone or reused pid only has its record removed, so an
 * unrelated program is never killed. Each failed record stays in the registry for a later attempt
 * and is reported as `ORPHAN_RECLAIM_FAILED`; the result lists terminated ids, removed ids and
 * collected failures. A failed listing touches no record.
 */
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
    invalidProcessOption(ProcessField.registry)
  /** Successful termination ids preserve source record order. */
  const terminated: string[] = []
  /** Only confirmed removal operations appear in this result. */
  const removed: string[] = []
  /** All failures share the existing collect/report policy. */
  const collector = createErrorCollector(LifecycleErrorPolicy.collect, options.report)
  /** Listing has no per-record identity yet; a failed scan must not touch any record. */
  let records: Awaited<ReturnType<IProcessRegistry['list']>>
  try {
    records = await options.registry.list(options.namespace)
  } catch (cause) {
    recordFailure(collector, options.report, cause, { step: RecoveryStep.list })
    return {
      terminated,
      removed,
      failures: collector.finalize(SupervisionErrorText.orphanReclaimFailed)
    }
  }
  for (const record of records) {
    /** Step identifies the storage/adapter operation that rejected. */
    let step: string = RecoveryStep.probe
    try {
      /** Fingerprint-aware probes distinguish live originals from reused identities. */
      const result = await options.launcher.probe!(record)
      if (result === OrphanProbeResult.alive) {
        step = RecoveryStep.terminate
        await options.launcher.terminateRecord!(record)
        terminated.push(record.id)
      }
      step = RecoveryStep.remove
      await options.registry.remove(record.id)
      removed.push(record.id)
    } catch (cause) {
      recordFailure(collector, options.report, cause, { recordId: record.id, step })
    }
  }
  return {
    terminated,
    removed,
    failures: collector.finalize(SupervisionErrorText.orphanReclaimFailed)
  }
}

/** Reports recovery failures with explicit collector/report ownership and original cause identity. */
function recordFailure(
  collector: ReturnType<typeof createErrorCollector>,
  report: (error: unknown) => void,
  cause: unknown,
  detail: Readonly<Record<string, unknown>>
): void {
  /** The recovery error owns its semantic identity while retaining the original storage failure. */
  const error = createSupervisionError(
    Error,
    SupervisionErrorCode.orphanReclaimFailed,
    SupervisionErrorText.orphanReclaimFailed,
    { cause, detail: { kind: PROCESS_KIND, ...detail } }
  )
  collector.add(SUPERVISION_SOURCE, error)
  report(error)
}
