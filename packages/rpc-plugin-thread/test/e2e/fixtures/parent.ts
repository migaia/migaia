import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import {
  createAdapterWebThreadChannelFactory as createWebThreadChannelFactory,
  createAdapterWebThreadLauncher as createWebThreadLauncher
} from '../../../dist/threads/web-launcher.js'

/** Preserve the full classification of every admission or shutdown diagnostic. */
type IDiagnostic = Readonly<{
  source?: string
  code?: string
  name?: string
  detail?: unknown
  message: string
}>

/** Browser-visible receipt separates known admission limits from force/reap diagnostics. */
type IExitBoundaryReceipt = Readonly<{
  value: number
  exitObservation: string
  reapTimeoutMs: number
  closeElapsedMs: number
  sameClose: boolean
  admission: readonly IDiagnostic[]
  closing: readonly IDiagnostic[]
}>

/** Retain the original owned browser lifecycle through the private native protocol owners. */
globalThis.runOwnedThreadExitBoundary = async (): Promise<IExitBoundaryReceipt> => {
  /** Admission and close share one required reporter without discarding diagnostic fields. */
  const diagnostics: IDiagnostic[] = []
  /** Record stable public error fields rather than serializing native Error objects as empty JSON. */
  const report = (error: unknown): void => {
    /** Supervision publishes native Errors augmented with package identity and structured detail. */
    const diagnostic = error as Error & Omit<IDiagnostic, 'message'>
    diagnostics.push({
      source: diagnostic.source,
      code: diagnostic.code,
      name: diagnostic.name,
      detail: diagnostic.detail,
      message: String(diagnostic.message ?? error)
    })
  }
  /** Native browser Worker lifecycle declares that actual exit cannot be observed. */
  const launcher = createWebThreadLauncher({ report })
  /** One leased Worker uses the same production clock as RPC and supervision. */
  const budget = createUnitBudget({ kind: 'thread', maxUnits: 1, scheduler: systemScheduler })
  /** A long recovery window makes prompt abandonment distinct from an elapsed recovery timeout. */
  const reapTimeoutMs = 2_000
  /** Full spawn selects actual owned supervision rather than borrowing a manually created Worker. */
  const peer = await createRpcHost<{ twice(value: number): number }>({
    plugins: [
      threadPlugin({
        spawn: {
          spec: { entry: new URL('./worker.ts', import.meta.url).href },
          launcher,
          budget,
          scheduler: systemScheduler,
          channelFactory: createWebThreadChannelFactory({ scheduler: systemScheduler }),
          report,
          supervisor: {
            isolation: 'best-effort',
            stop: { drainTimeoutMs: 25, exitTimeoutMs: 25, reapTimeoutMs }
          }
        }
      })
    ],
    report
  })
  try {
    /** Business success must precede disposal; startup-only evidence cannot prove owned execution. */
    const value = await Object.values(peer.peers)[0]!.twice(21)
    /** Keep the pre-existing best-effort admission warning separate from teardown reporting. */
    const admission = diagnostics.slice()
    /** Closing owns one original Promise and one force/reap operation across repeated calls. */
    const startedAt = performance.now()
    /** Capture identity before awaiting, then repeat after completion to detect duplicate reports. */
    const closing = peer.close()
    /** Public close retains the original disposal Promise. */
    const sameClose = peer.close() === closing
    await closing
    /** Elapsed time covers the complete owned Peer shutdown. */
    const closeElapsedMs = performance.now() - startedAt
    await peer.close()
    return {
      value,
      exitObservation: launcher.capabilities['exit-observation'],
      reapTimeoutMs,
      closeElapsedMs,
      sameClose,
      admission,
      closing: diagnostics.slice(admission.length)
    }
  } finally {
    await peer.close()
    budget.close()
  }
}

declare global {
  var runOwnedThreadExitBoundary: () => Promise<IExitBoundaryReceipt>
}
