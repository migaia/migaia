import type { IThreadHandle, IThreadLauncher } from '@migaia/supervision/threads'
import { awaitThreadPreparation, createWebThreadChannel } from '../channel.js'
import { THREAD_FINGERPRINT_PREFIX, ThreadBootstrap, ThreadEvent } from '../constants.js'
import { absoluteThreadEntry, portableThreadSpec } from '../error.js'
import { resolveAbortReason } from '../../core/internal/async-control.js'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'
import type { IThreadChannelFactory, IThreadChannelOptions, IThreadWebPort } from '../types.js'

/** Web handles expose preparation but never counterfeit an unsupported actual-exit receipt. */
export type IWebThreadHandle = IThreadHandle &
  Readonly<{ port: IThreadWebPort; prepared: Promise<void> }>
/** Structural constructors admit actual runtime Workers and controlled adapter fixtures. */
export type IWebThreadWorker = IThreadWebPort & { terminate(): void }
/** Platform runtime injection does not strengthen unsupported lifecycle capabilities. */
export type IWebThreadLauncherOptions = Readonly<{
  Worker?: new (entry: string | URL, options: { type: 'module'; name?: string }) => IWebThreadWorker
  report(error: unknown): void
}>
/** Local fingerprint distinguishes Web workers without a numeric runtime identifier. */
let sequence = 0

/** Web termination cannot prove execution stopped; supervision retains abandoned leases. */
export function createWebThreadLauncher(
  options: IWebThreadLauncherOptions
): IThreadLauncher<IWebThreadHandle> {
  return {
    capabilities: Object.freeze({
      termination: 'unsupported',
      'exit-observation': 'unsupported',
      'heap-limit': 'unsupported'
    }),
    async launch(input, context) {
      if (context.signal.aborted) throw resolveAbortReason(context.signal)
      /** Portable data admission precedes all runtime side effects. */
      const spec = portableThreadSpec(input)
      /** Adapter entry is absolute rather than relative to this module. */
      const entry = absoluteThreadEntry(spec.entry, false)
      /** Runtime constructors are read only when an admitted launch actually starts. */
      const Constructor =
        options.Worker ??
        (globalThis.Worker as unknown as NonNullable<IWebThreadLauncherOptions['Worker']>)
      /** The service receives the exact peerId used by the client channel factory. */
      const fingerprint = `${THREAD_FINGERPRINT_PREFIX}web-${++sequence}`
      /** Worker lifecycle hooks attach synchronously before the host can deliver events. */
      const worker = new Constructor(entry, { type: 'module', name: spec.name })
      /** A terminate request has no effect on the independently unsupported exited Promise. */
      let terminating = false
      /** Bootstrap listener is released on acknowledgement or explicit termination. */
      let receive: ((event: { data: unknown }) => void) | undefined
      /** Pending bootstrap rejects when cancellation reclaims its candidate Worker. */
      let rejectPrepared: ((error: unknown) => void) | undefined
      /** Remove only launcher-owned private listeners; transport listeners belong to core. */
      const removeBootstrap = (): void => {
        if (receive) worker.removeEventListener(ThreadEvent.message, receive)
        receive = undefined
      }
      /** Reclaim the candidate once without inventing actual-exit evidence. */
      const terminate = (): void => {
        if (terminating) return
        terminating = true
        removeBootstrap()
        rejectPrepared?.(resolveAbortReason(context.signal))
        rejectPrepared = undefined
        worker.terminate()
      }
      worker.addEventListener(
        ThreadEvent.error,
        (event: { preventDefault(): void; error?: unknown }) => {
          event.preventDefault()
          try {
            options.report(event.error ?? event)
          } catch (reporterError) {
            hostRethrowReporter(reporterError, IpcReporterContext)
          }
          terminate()
        }
      )
      /** Even absent business data requires the private address before channel open. */
      const prepared = new Promise<void>((resolve, reject) => {
        rejectPrepared = reject
        receive = (event) => {
          if (
            event.data === null ||
            typeof event.data !== 'object' ||
            !('kind' in event.data) ||
            event.data.kind !== ThreadBootstrap.acknowledged
          )
            return
          removeBootstrap()
          rejectPrepared = undefined
          resolve()
        }
        worker.addEventListener(ThreadEvent.message, receive)
        worker.postMessage(
          {
            kind: ThreadBootstrap.data,
            peerId: fingerprint,
            ...(spec.data === undefined ? {} : { data: spec.data })
          },
          undefined
        )
      })
      /** The preparation consumer rethrows; this observer only prevents a late unhandled rejection. */
      void prepared.catch(() => undefined)
      return {
        identity: Object.freeze({ fingerprint }),
        port: worker,
        prepared,
        exited: new Promise(() => undefined),
        terminate
      }
    }
  }
}

/** Install core messaging only after bootstrap acknowledgement and remove abort hooks. */
export function createWebThreadChannelFactory(
  options: IThreadChannelOptions
): IThreadChannelFactory<IWebThreadHandle> {
  return {
    open: async (handle, signal) => {
      await awaitThreadPreparation(handle.prepared, signal)
      return createWebThreadChannel(handle.port, handle.identity.fingerprint, options)
    }
  }
}
