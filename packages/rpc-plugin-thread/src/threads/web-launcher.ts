import type { IAbortSignal } from '@migaia/utils/promise'
import { attachSecondaryErrors } from '@migaia/utils/error'
import { createDisposeTransaction, DisposeTransactionKind } from '@migaia/lifecycle'
import { identifyRpcBoundaryFailure } from '@migaia/rpc-host/plugin'
import { RpcCoreErrorCode } from '@migaia/rpc-host'
import { createAdapterTransportError } from '@migaia/rpc-host/plugin'
import { type IRuntimePeerSourceResult } from '@migaia/rpc-host/plugin'
import type { IThreadHandle, IThreadLauncher } from '@migaia/supervision/threads'
import {
  awaitThreadPreparation,
  constructWebThreadChannel,
  openThreadMessageResource
} from './channel.js'
import { createThreadRuntimeBootstrap, intersectThreadCapabilities } from './bootstrap.js'
import {
  createEventTargetMessageResource,
  holdAdapterLaunch,
  type IAdapterMessageResource
} from '@migaia/rpc-host/plugin'
import { type IRuntimePeerSourceContext } from '@migaia/rpc-host/plugin'

import { THREAD_FINGERPRINT_PREFIX, ThreadBootstrap, ThreadEvent } from './constants.js'
import { absoluteThreadEntry, portableThreadSpec } from './error.js'
import { readAdapterAbortReason } from '@migaia/rpc-host/plugin'

import { ThreadErrorText } from './error-text.js'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { IpcReporterContext } from '@migaia/rpc-host/plugin'
import type { IThreadChannelFactory, IThreadChannelOptions, IThreadWebPort } from './types.js'

/** Web handles expose preparation; only Bun's native close event settles an actual-exit receipt. */
export type IWebThreadHandle = IThreadHandle &
  Readonly<{
    /** Actual EventTarget message port; outside Bun it does not supply an actual-exit receipt. */
    port: IThreadWebPort
    /** Original readiness/control Promise; resolves only after the corresponding child ACK. */
    prepared: Promise<void | readonly string[]>
  }>
/** Whole opening retains the original public prepared Promise without exposing receive handoff. */
export type IAdapterWebThreadHandle = IWebThreadHandle &
  Readonly<{
    /** Await this handle's preparation and open its channel under the current cancellation signal. */
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
export type IWebThreadWorker = IThreadWebPort & {
  /** Request termination; only Bun follows it with a `close` event carrying the exit code. */
  terminate(): void
}
/** Platform runtime injection does not strengthen unsupported lifecycle capabilities. */
export type IWebThreadLauncherOptions = Readonly<{
  /** Optional actual Worker constructor; omission reads the host's global Worker when launch starts. */
  Worker?: new (entry: string | URL, options: { type: 'module'; name?: string }) => IWebThreadWorker
  /** Required native error sink; reporter failures remain observable through the host route. */
  report(error: unknown): void
  /** Optional explicit runtime bootstrap, overridden by an actual held supervisor launch proposal. */
  runtimeApi?: IRuntimePeerSourceContext
}>
/** Local fingerprint distinguishes Web workers without a numeric runtime identifier. */
let sequence = 0

/** The original supervisor launch context remains the cancellation authority for one Worker. */
type IWebThreadLaunchContext = Parameters<IThreadLauncher<IAdapterWebThreadHandle>['launch']>[1]

/** Own one Web Worker generation without strengthening its native lifecycle capabilities. */
class WebThreadGeneration {
  /** Native messaging and termination address only this exact Worker. */
  #worker: IWebThreadWorker
  /** Original reporting remains caller-owned and is read at the original callback boundary. */
  #options: IWebThreadLauncherOptions
  /** Native preparation and termination use the supervisor's actual cancellation context. */
  #context: IWebThreadLaunchContext
  /** The admitted bootstrap is the only source of runtime preparation capability metadata. */
  #bootstrap: ReturnType<typeof createThreadRuntimeBootstrap> | undefined
  /** Stable adapter identity is independent of host-native numeric thread identifiers. */
  #fingerprint: string
  /** Termination is requested once; it is never treated as proof of native exit. */
  #terminating = false
  /** Core retains the actual cold message resource for this generation. */
  #resource: IAdapterMessageResource | undefined
  /** Only this generation's bootstrap listener may be removed on ACK or teardown. */
  #receive: ((event: { data: unknown }) => void) | undefined
  /** The original readiness Promise rejects when candidate reclamation interrupts bootstrap. */
  #rejectPrepared: ((error: unknown) => void) | undefined
  /** Last native failure remains reachable from a subsequent actual exit status. */
  #failure: unknown
  /** Bun alone settles this native close receipt; other hosts retain the pending original Promise. */
  #exited: Promise<{ code: number; error?: unknown }>
  /** The exact launch message is shared by native I/O and the canonical Core preparation resource. */
  #initialMessage: unknown
  /** Attach actual-exit observation before opening the same original bootstrap path. */
  constructor(
    worker: IWebThreadWorker,
    options: IWebThreadLauncherOptions,
    context: IWebThreadLaunchContext,
    bootstrap: ReturnType<typeof createThreadRuntimeBootstrap> | undefined,
    fingerprint: string,
    data: unknown,
    exitObservable: boolean
  ) {
    this.#worker = worker
    this.#options = options
    this.#context = context
    this.#bootstrap = bootstrap
    this.#fingerprint = fingerprint
    this.#exited = exitObservable
      ? new Promise<{ code: number; error?: unknown }>((resolve) => {
          /** Bun emits close exactly once per Worker, after the thread has stopped. */
          this.#worker.addEventListener(ThreadEvent.close, (event: { code?: number }) =>
            resolve({
              code: event.code ?? 0,
              ...(this.#failure === undefined ? {} : { error: this.#failure })
            })
          )
        })
      : new Promise<never>(() => undefined)
    this.#initialMessage = {
      kind: ThreadBootstrap.data,
      peerId: fingerprint,
      ...(bootstrap ? { runtimeApi: bootstrap } : {}),
      ...(data === undefined ? {} : { data })
    }
  }
  /** Open the original readiness/control path and roll back every acquired resource on failure. */
  async open(): Promise<IAdapterWebThreadHandle> {
    try {
      /** Runtime capture attaches before the original native failure reporter and initial write. */
      if (this.#bootstrap)
        this.#resource = createEventTargetMessageResource(this.#worker, {
          exited: this.#exited,
          terminate: this.#terminate,
          initialMessage: this.#initialMessage
        })
      this.#worker.addEventListener(ThreadEvent.error, this.#onError)
      /** Public runtime readiness is Core's exact original Promise, with no adapter agreement input. */
      const prepared: Promise<void | readonly string[]> = this.#bootstrap
        ? this.#resource!.prepareControl(this.#bootstrap.capabilities)
        : new Promise<void>((resolve, reject) => {
            this.#rejectPrepared = reject
            this.#receive = (event) => {
              if (
                event.data === null ||
                typeof event.data !== 'object' ||
                !('kind' in event.data) ||
                event.data.kind !== ThreadBootstrap.acknowledged
              )
                return
              this.#removeBootstrap()
              this.#rejectPrepared = undefined
              resolve()
            }
            this.#worker.addEventListener(ThreadEvent.message, this.#receive)
          })
      /** The preparation consumer rethrows; this observer only prevents a late unhandled rejection. */
      void prepared.catch(() => undefined)
      this.#worker.postMessage(this.#initialMessage, undefined)
      /** Retain startup internally and expose only complete resource operations. */
      const handle: IAdapterWebThreadHandle = {
        identity: Object.freeze({ fingerprint: this.#fingerprint }),
        port: this.#worker,
        prepared,
        exited: this.#exited,
        terminate: this.#terminate,
        open: (signal, channelOptions) => openWebThreadHandle(handle, signal, channelOptions)
      }
      if (this.#resource && this.#bootstrap)
        webPreparations.set(handle, {
          resource: this.#resource,
          offer: this.#bootstrap.capabilities
        })
      return handle
    } catch (error) {
      /** The launcher's rollback keeps the original native primary and every cleanup failure. */
      const primary = identifyRpcBoundaryFailure(
        error,
        RpcCoreErrorCode.transport,
        ThreadErrorText.bootstrapFailed
      )
      this.#terminating = true
      this.#rejectPrepared?.(primary)
      this.#rejectPrepared = undefined
      /** Lifecycle attempts all acquired-resource releases; no second cleanup state machine exists. */
      const failures = await createDisposeTransaction(
        { kind: DisposeTransactionKind.plan },
        { errorPolicy: 'collect' }
      ).run(
        [
          this.#removeBootstrap,
          () => this.#worker.removeEventListener(ThreadEvent.error, this.#onError),
          () => this.#resource?.close(),
          () => this.#worker.terminate()
        ].map((force, index) => ({
          source: String(index),
          descriptor: { force }
        }))
      )
      throw identifyRpcBoundaryFailure(
        attachSecondaryErrors(
          primary,
          failures.map(({ error }) => error)
        ),
        RpcCoreErrorCode.transport,
        ThreadErrorText.bootstrapFailed
      )
    }
  }
  /** Remove only the private launcher callback, preserving Core's independent subscriptions. */
  #removeBootstrap = (): void => {
    if (this.#receive) this.#worker.removeEventListener(ThreadEvent.message, this.#receive)
    this.#receive = undefined
  }
  /** Reclaim one candidate without inventing actual-exit evidence. */
  #terminate = (): void => {
    if (this.#terminating) return
    this.#terminating = true
    this.#removeBootstrap()
    this.#worker.removeEventListener(ThreadEvent.error, this.#onError)
    void this.#resource?.close()
    this.#rejectPrepared?.(readAdapterAbortReason(this.#context.signal))
    this.#rejectPrepared = undefined
    this.#worker.terminate()
  }
  /** Keep the exact native cause observable through preparation, exit and the caller's reporter. */
  #onError = (event: { preventDefault(): void; error?: unknown }): void => {
    event.preventDefault()
    this.#failure = event.error ?? event
    /** Core already settled runtime control with this same observed native cause. */
    if (!this.#bootstrap)
      this.#rejectPrepared?.(
        createAdapterTransportError(ThreadErrorText.bootstrapFailed, event.error ?? event)
      )
    this.#rejectPrepared = undefined
    try {
      this.#options.report(event.error ?? event)
    } catch (reporterError) {
      hostRethrowReporter(reporterError, IpcReporterContext)
    }
    this.#terminate()
  }
}

/**
 * Create a module-Worker launcher with required report and optional constructor/runtime context. It
 * validates portable data/absolute URL before acquisition and waits for child preparation when
 * opening a channel. On Bun, the Worker emits a nonstandard `close` event with the exit code once
 * the thread has stopped; Bun's own worker_threads `exit` is derived from the same event, so
 * termination and exit-observation are enforced there and exited settles from it. Elsewhere both
 * remain unsupported: terminate() is not an exit receipt, exited stays pending, and supervision may
 * retain an abandoned lease. heap-limit is unsupported on every host. Failure after acquisition
 * attempts every owned listener/resource/Worker cleanup and retains the original primary together
 * with secondary cleanup errors.
 */
export function createAdapterWebThreadLauncher(
  options: IWebThreadLauncherOptions
): IThreadLauncher<IAdapterWebThreadHandle> {
  /** Bun is the only Web Worker host whose close event reports an actual thread exit. */
  const exitObservable = detectServerRuntime() === ServerRuntime.bun
  /** Capability level shared by termination and exit-observation for this host. */
  const exitLevel = exitObservable ? 'enforced' : 'unsupported'
  return {
    capabilities: Object.freeze({
      termination: exitLevel,
      'exit-observation': exitLevel,
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
        (Reflect.get(globalThis, 'Worker') as NonNullable<IWebThreadLauncherOptions['Worker']>)
      /** The service receives the exact peerId used by the client channel factory. */
      const fingerprint = `${THREAD_FINGERPRINT_PREFIX}web-${++sequence}`
      /** The shared bootstrap owner admits safe metadata before native Worker construction. */
      const bootstrap = runtimeApi
        ? createThreadRuntimeBootstrap(spec.name || fingerprint, fingerprint, runtimeApi)
        : undefined
      /** Worker lifecycle hooks attach synchronously before the host can deliver events. */
      const worker = new Constructor(entry, { type: 'module', name: spec.name })
      /** All native receipts and cleanup callbacks belong to this one generation owner. */
      return new WebThreadGeneration(
        worker,
        options,
        context,
        bootstrap,
        fingerprint,
        spec.data,
        exitObservable
      ).open()
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
    if (signal.aborted) throw readAdapterAbortReason(signal)
    await awaitThreadPreparation(handle.prepared, signal)
    if (preparation) {
      /** Caller policy only narrows the launcher's real offer; Core retains the peer's actual ACK. */
      const offer =
        options.capabilities === undefined
          ? preparation.offer
          : intersectThreadCapabilities(preparation.offer, options.capabilities)
      return await openThreadMessageResource(
        preparation.resource,
        handle.identity.fingerprint,
        { ...options, capabilities: offer },
        signal
      )
    }
    return await constructWebThreadChannel(handle.port, handle.identity.fingerprint, options)
  } catch (error) {
    void preparation?.resource.close()
    throw error
  }
}

/**
 * Build the matching Web factory using a required shared scheduler and optional capability policy.
 * open waits for the handle's original preparation, rejects cancellation with its original reason,
 * and opens the actual launcher resource when present; a copied/raw handle gains no private trust.
 * Worker termination remains owned by its supervisor rather than borrowed transport close.
 */
export function createAdapterWebThreadChannelFactory(
  options: IThreadChannelOptions
): IThreadChannelFactory<IWebThreadHandle> {
  return {
    open: (handle, signal, timeoutMs) =>
      openWebThreadHandle(
        handle,
        signal,
        timeoutMs === undefined ? options : { ...options, timeoutMs }
      )
  }
}
import { detectServerRuntime, ServerRuntime } from '@migaia/utils'
