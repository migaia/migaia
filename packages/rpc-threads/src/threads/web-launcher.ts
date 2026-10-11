import { createAdapterTransportError } from '@migaia/rpc-core/adapter'
import type { IAbortSignal } from '@migaia/lifecycle'
import { type IRuntimePeerSourceResult } from '@migaia/rpc-core/remote'
import type { IThreadHandle, IThreadLauncher } from '@migaia/supervision/threads'
import {
  awaitThreadPreparation,
  constructWebThreadChannel,
  openThreadMessageResource
} from './channel.js'
import { createThreadRuntimeBootstrap } from './bootstrap.js'
import {
  createEventTargetMessageResource,
  holdAdapterLaunch,
  type IAdapterMessageResource
} from '@migaia/rpc-core/adapter'
import { type IRuntimePeerSourceContext } from '@migaia/rpc-core/remote'

import { THREAD_FINGERPRINT_PREFIX, ThreadBootstrap, ThreadEvent } from './constants.js'
import { absoluteThreadEntry, portableThreadSpec } from './error.js'
import { readAdapterAbortReason } from '@migaia/rpc-core/adapter'

import { ThreadErrorText } from './error-text.js'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { IpcReporterContext } from '@migaia/rpc-core/adapter'
import type { IThreadChannelFactory, IThreadChannelOptions, IThreadWebPort } from './types.js'

/** Web handles expose preparation but never counterfeit an unsupported actual-exit receipt. */
export type IWebThreadHandle = IThreadHandle &
  Readonly<{
    port: IThreadWebPort
    prepared: Promise<void | readonly string[]>
  }>
/** Whole opening retains the original public prepared Promise without exposing receive handoff. */
export type IAdapterWebThreadHandle = IWebThreadHandle &
  Readonly<{
    open(signal: IAbortSignal, options: IThreadChannelOptions): Promise<IRuntimePeerSourceResult>
  }>

/** Cold receive owners belong only to exact handles constructed here, never copied shape fields. */
const webPreparations = new WeakMap<
  IWebThreadHandle,
  Readonly<{
    resource: IAdapterMessageResource
    offer: readonly string[]
  }>
>()

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
export function createAdapterWebThreadLauncher(
  options: IWebThreadLauncherOptions
): IThreadLauncher<IAdapterWebThreadHandle> {
  return {
    capabilities: Object.freeze({
      termination: 'unsupported',
      'exit-observation': 'unsupported',
      'heap-limit': 'unsupported'
    }),
    async launch(input, context) {
      /** The exact original request carries each independent parent's compiled bootstrap offer. */
      const runtimeApi = holdAdapterLaunch(context).proposal ?? options.runtimeApi
      if (context.signal.aborted) throw readAdapterAbortReason(context.signal)
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
      let resource: IAdapterMessageResource | undefined
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
        void resource?.close()
        rejectPrepared?.(readAdapterAbortReason(context.signal))
        rejectPrepared = undefined
        worker.terminate()
      }
      /** Unsupported actual-exit observation stays the original never-settled native handle Promise. */
      const exited = new Promise<never>(() => undefined)
      /** The same raw launch message enters Worker I/O and Core's held-resource control operation. */
      const initialMessage = {
        kind: ThreadBootstrap.data,
        peerId: fingerprint,
        ...(bootstrap ? { runtimeApi: bootstrap } : {}),
        ...(spec.data === undefined ? {} : { data: spec.data })
      }
      /**
       * Runtime capture attaches before the original native failure reporter and before initial
       * write.
       */
      if (bootstrap)
        resource = createEventTargetMessageResource(worker, { exited, terminate, initialMessage })
      worker.addEventListener(
        ThreadEvent.error,
        (event: { preventDefault(): void; error?: unknown }) => {
          event.preventDefault()
          /** Core already settled runtime control with this same observed native cause. */
          if (!bootstrap)
            rejectPrepared?.(
              createAdapterTransportError(ThreadErrorText.bootstrapFailed, event.error ?? event)
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
      /** Public runtime readiness is Core's exact original Promise, with no adapter agreement input. */
      const prepared: Promise<void | readonly string[]> = bootstrap
        ? resource!.prepareControl(bootstrap.capabilities)
        : new Promise<void>((resolve, reject) => {
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
          })
      worker.postMessage(initialMessage, undefined)
      /** The preparation consumer rethrows; this observer only prevents a late unhandled rejection. */
      void prepared.catch(() => undefined)
      /** Retain startup internally and expose only complete resource operations. */
      const handle: IAdapterWebThreadHandle = {
        identity: Object.freeze({ fingerprint }),
        port: worker,
        prepared,
        exited,
        terminate,
        open: (signal, channelOptions) => openWebThreadHandle(handle, signal, channelOptions)
      }
      if (resource && bootstrap)
        webPreparations.set(handle, { resource, offer: bootstrap.capabilities })
      return handle
    }
  }
}

/** Await the original preparation and transfer only this exact constructed handle's receiver. */
async function openWebThreadHandle(
  handle: IWebThreadHandle,
  signal: IAbortSignal,
  options: IThreadChannelOptions
): Promise<IRuntimePeerSourceResult> {
  /** Only this actual launcher retains Core's original raw control resource. */
  const preparation = webPreparations.get(handle)
  try {
    await awaitThreadPreparation(handle.prepared, signal)
    if (preparation) {
      /** Open uses our original local offer; received capabilities remain private inside Core. */
      return await openThreadMessageResource(
        preparation.resource,
        handle.identity.fingerprint,
        { ...options, capabilities: preparation.offer },
        signal
      )
    }
    return await constructWebThreadChannel(handle.port, handle.identity.fingerprint, options)
  } catch (error) {
    void preparation?.resource.close()
    throw error
  }
}

/** Build the complete EventTarget channel factory without publishing bootstrap callbacks. */
export function createAdapterWebThreadChannelFactory(
  options: IThreadChannelOptions
): IThreadChannelFactory<IWebThreadHandle> {
  return { open: (handle, signal) => openWebThreadHandle(handle, signal, options) }
}
