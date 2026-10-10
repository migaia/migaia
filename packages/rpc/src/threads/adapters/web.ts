import type { IThreadHandle, IThreadLauncher } from '@migaia/supervision/threads'
import { awaitThreadPreparation, createWebThreadChannel } from '../channel.js'
import {
  createThreadRuntimeBootstrap,
  readThreadRuntimeAcknowledgement,
  intersectThreadCapabilities
} from '../bootstrap.js'
import { createWebThreadBootstrapHandoff } from '../receive-handoff.js'
import type { IRuntimePeerSourceContext } from '../../remote/index.js'
import { readRuntimeLaunchContext } from '../../remote/runtime-api/launch-context.js'
import { invalidThreadConfig } from '../error.js'
import { THREAD_FINGERPRINT_PREFIX, ThreadBootstrap, ThreadEvent } from '../constants.js'
import { absoluteThreadEntry, portableThreadSpec } from '../error.js'
import { resolveAbortReason } from '../../core/internal/async-control.js'
import { RpcTransportError } from '../../core/index.js'
import { ThreadErrorText } from '../error-text.js'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'
import type { IThreadChannelFactory, IThreadChannelOptions, IThreadWebPort } from '../types.js'

/** Web handles expose preparation but never counterfeit an unsupported actual-exit receipt. */
export type IWebThreadHandle = IThreadHandle &
  Readonly<{
    port: IThreadWebPort
    prepared: Promise<void | readonly string[]>
    runtimeApi?: ReturnType<typeof createWebThreadBootstrapHandoff>
  }>
/** Structural constructors admit actual runtime Workers and controlled adapter fixtures. */
export type IWebThreadWorker = IThreadWebPort & { terminate(): void }
/** Platform runtime injection does not strengthen unsupported lifecycle capabilities. */
export type IWebThreadLauncherOptions = Readonly<{
  Worker?: new (entry: string | URL, options: { type: 'module'; name?: string }) => IWebThreadWorker
  report(error: unknown): void
  runtimeApi?: IRuntimePeerSourceContext
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
      /** The exact original request carries each independent parent's compiled bootstrap offer. */
      const runtimeApi = readRuntimeLaunchContext(context) ?? options.runtimeApi
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
      /** The shared bootstrap owner admits safe metadata before native Worker construction. */
      const bootstrap = runtimeApi
        ? createThreadRuntimeBootstrap(spec.name || fingerprint, fingerprint, runtimeApi)
        : undefined
      /** Worker lifecycle hooks attach synchronously before the host can deliver events. */
      const worker = new Constructor(entry, { type: 'module', name: spec.name })
      /** A terminate request has no effect on the independently unsupported exited Promise. */
      let terminating = false
      /** Only the opt-in protocol transfers a bounded cold receive owner to core. */
      let handoff: IWebThreadHandle['runtimeApi']
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
        handoff?.close()
        rejectPrepared?.(resolveAbortReason(context.signal))
        rejectPrepared = undefined
        worker.terminate()
      }
      worker.addEventListener(
        ThreadEvent.error,
        (event: { preventDefault(): void; error?: unknown }) => {
          event.preventDefault()
          // Preparation owns this failure even when no launch cancellation has occurred.
          handoff?.fail(event.error ?? event)
          rejectPrepared?.(
            new RpcTransportError(ThreadErrorText.bootstrapFailed, event.error ?? event)
          )
          rejectPrepared = undefined
          try {
            options.report(event.error ?? event)
          } catch (reporterError) {
            hostRethrowReporter(reporterError, IpcReporterContext)
          }
          terminate()
        }
      )
      /** Even absent business data requires the private address before channel open. */
      const prepared = new Promise<void | readonly string[]>((resolve, reject) => {
        rejectPrepared = reject
        if (bootstrap) {
          /** Child capability ACK is independent of parent claims and application readiness. */
          let acknowledged = false
          handoff = createWebThreadBootstrapHandoff(worker, {
            consume(message) {
              if (
                !message ||
                typeof message !== 'object' ||
                !('kind' in message) ||
                message.kind !== ThreadBootstrap.runtimeAcknowledged
              )
                return false
              if (acknowledged)
                invalidThreadConfig('runtimeApi.ack', ThreadErrorText.bootstrapFailed)
              /** The private bootstrap reader owns ACK version, field and offer bounds. */
              const peer = readThreadRuntimeAcknowledgement(message)
              acknowledged = true
              rejectPrepared = undefined
              resolve(intersectThreadCapabilities(bootstrap.capabilities, peer))
              return true
            },
            onFailure: (error) => {
              reject(error)
              terminate()
            }
          })
          worker.postMessage(
            {
              kind: ThreadBootstrap.data,
              peerId: fingerprint,
              runtimeApi: bootstrap,
              ...(spec.data === undefined ? {} : { data: spec.data })
            },
            undefined
          )
          return
        }
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
        port: handoff?.port ?? worker,
        ...(handoff ? { runtimeApi: handoff } : {}),
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
      try {
        /** Only an actual child offer can replace the legacy static capability profile. */
        const capabilities = await awaitThreadPreparation(handle.prepared, signal)
        if (handle.runtimeApi)
          return createWebThreadChannel(
            handle.port,
            handle.identity.fingerprint,
            { ...options, capabilities: capabilities as readonly string[] },
            handle.runtimeApi
          )
        return createWebThreadChannel(handle.port, handle.identity.fingerprint, options)
      } catch (error) {
        handle.runtimeApi?.close()
        throw error
      }
    }
  }
}
