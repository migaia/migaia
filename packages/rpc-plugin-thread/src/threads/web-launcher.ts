/**
 * Owns actual Bun/Deno module Worker launch, bootstrap delivery and native termination
 * observations. SDK carriers borrow its real messaging port and source-supplied launch facts.
 */
import { deferred, hostRethrowReporter, type IAbortSignal } from '@migaia/utils/promise'
import { detectServerRuntime, ServerRuntime } from '@migaia/utils'
import { attachSecondaryErrors } from '@migaia/utils/error'
import { identifyRpcBoundaryFailure } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import type { IRpcCarrier } from '@migaia/rpc-contract/interfaces'
import type { ILaunchContext } from '@migaia/supervision'
import { readRpcLaunchFacts, IpcReporterContext } from '@migaia/rpc-host/sdk'
import type { IThreadHandle, IThreadLauncher } from '@migaia/supervision/threads'
import { ThreadEvent, THREAD_FINGERPRINT_PREFIX } from './constants.js'
import { absoluteThreadEntry, portableThreadSpec } from './error.js'
import { ThreadErrorText } from './error-text.js'
import { createThreadBootstrap } from './bootstrap.js'
import { createWebThreadCarrier, threadTransportError } from './channel.js'
import type {
  IThreadWebPort,
  IThreadLaunchOptions,
  IThreadChannelOptions,
  IThreadChannelFactory
} from './types.js'

/** Native module Workers expose messaging and a termination request, not a fabricated exit receipt. */
export type IWebThreadWorker = IThreadWebPort & Readonly<{ terminate(): void }>
/** Real handles retain one cold carrier, native identity and original exit observation. */
export type IWebThreadHandle = IThreadHandle &
  Readonly<{
    port: IThreadWebPort
    open?(signal: IAbortSignal): Promise<IRpcCarrier>
  }>
/** The selected runtime owns construction and reporting; no codec/profile proposal enters launch. */
export type IWebThreadLauncherOptions = IThreadLaunchOptions &
  Readonly<{
    Worker?: new (
      entry: string | URL,
      options: { type: 'module'; name?: string }
    ) => IWebThreadWorker
    report(error: unknown): void
  }>
/** Fingerprints stay distinct when a Web Worker has no native numeric identifier. */
let sequence = 0

/**
 * Keep native termination, actual Bun close and the carrier's independent listener cleanup
 * separate.
 */
class WebThreadGeneration {
  /** The real Worker is the only physical execution authority. */
  readonly #worker: IWebThreadWorker
  /** Reporting belongs to the source rather than the receive codec. */
  readonly #report: (error: unknown) => void
  /** Native close alone settles actual execution exit. */
  readonly #exited = deferred<{ code: number; error?: unknown }>()
  /** One immediate cold carrier retains early protocol traffic until Session attaches. */
  readonly #carrier: IRpcCarrier
  /** Actual failure is retained for the corresponding native exit. */
  #failure: unknown
  /** Concurrent stop, failure and rollback request termination only once. */
  #terminating = false
  /** The same actual resource is published to supervision and carrier acquisition. */
  readonly value: IWebThreadHandle

  /** Install observers before the launcher's initial write and retain native rollback order. */
  constructor(
    worker: IWebThreadWorker,
    fingerprint: string,
    report: (error: unknown) => void,
    exitObservable: boolean
  ) {
    this.#worker = worker
    this.#report = report
    if (exitObservable) worker.addEventListener(ThreadEvent.close, this.#onClose)
    worker.addEventListener(ThreadEvent.error, this.#onError)
    this.#carrier = createWebThreadCarrier(worker, fingerprint, report)
    this.value = {
      identity: Object.freeze({ fingerprint }),
      port: worker,
      exited: this.#exited.promise,
      terminate: this.#terminate,
      open: async (signal) => {
        if (signal.aborted) throw signal.reason
        return this.#carrier
      }
    }
  }
  /** Only Bun's real close event supplies an actual-exit receipt. */
  readonly #onClose = (event: { code?: number }): void => {
    this.#worker.removeEventListener(ThreadEvent.close, this.#onClose)
    this.#worker.removeEventListener(ThreadEvent.error, this.#onError)
    this.#exited.resolve({
      code: event.code ?? 0,
      ...(this.#failure === undefined ? {} : { error: this.#failure })
    })
    this.#failure = undefined
  }
  /** Keep the original failure observable before retiring messaging and requesting termination. */
  readonly #onError = (event: {
    preventDefault(): void
    error?: unknown
    message?: string
  }): void => {
    event.preventDefault()
    this.#failure = threadTransportError(ThreadErrorText.workerFailed(event.message), event.error)
    void this.#carrier.close(this.#failure).catch(this.#report)
    try {
      this.#report(this.#failure)
    } catch (error) {
      hostRethrowReporter(error, IpcReporterContext)
    }
    this.#terminate()
  }
  /** Retire only this carrier's subscriptions; the supervisor still waits for actual native exit. */
  readonly #terminate = (): void => {
    if (this.#terminating) return
    this.#terminating = true
    this.#worker.removeEventListener(ThreadEvent.error, this.#onError)
    void this.#carrier.close().catch(this.#report)
    this.#worker.terminate()
  }
}

/** One explicit launcher preserves real native capability strengths and rollback failures. */
class WebThreadLauncher {
  /** Runtime constructor and source policy are immutable installation inputs. */
  readonly #options: IWebThreadLauncherOptions
  /** Bun alone supplies a real native close receipt. */
  readonly #exitObservable = detectServerRuntime() === ServerRuntime.bun
  /** Unsupported runtime guarantees remain unsupported rather than inferred from terminate(). */
  readonly capabilities
  /** Capture configuration without native Worker acquisition. */
  constructor(options: IWebThreadLauncherOptions) {
    this.#options = options
    /** Native capability strength is selected once from the real runtime. */
    const exitLevel = this.#exitObservable ? 'enforced' : 'unsupported'
    this.capabilities = Object.freeze({
      termination: exitLevel,
      'exit-observation': exitLevel,
      'heap-limit': 'unsupported'
    })
  }
  /** Capture portable data and absolute entry before acquiring and initializing a real Worker. */
  async launch(
    input: Parameters<IThreadLauncher['launch']>[0],
    context: ILaunchContext
  ): Promise<IWebThreadHandle> {
    if (context.signal.aborted) throw context.signal.reason
    /** The same data snapshot is delivered through the original native bootstrap. */
    const spec = portableThreadSpec(input)
    /** Relative entries cannot accidentally resolve against this library module. */
    const entry = absoluteThreadEntry(spec.entry, false)
    /** Runtime construction remains lazy and injectable at its actual native boundary. */
    const Constructor =
      this.#options.Worker ??
      (Reflect.get(globalThis, 'Worker') as NonNullable<IWebThreadLauncherOptions['Worker']>)
    /** Each launched unit has one permanent logical address. */
    const fingerprint = THREAD_FINGERPRINT_PREFIX + 'web-' + ++sequence
    /** Actual source facts are provided by the installed native transport. */
    const facts = readRpcLaunchFacts(context)
    /** The acquired Worker is reclaimed if installing listeners or native initialization fails. */
    const worker = new Constructor(entry, { type: 'module', name: spec.name })
    /** Keep the acquired generation available for rollback after its carrier has been installed. */
    let generation: WebThreadGeneration | undefined
    try {
      generation = new WebThreadGeneration(
        worker,
        fingerprint,
        this.#options.report,
        this.#exitObservable
      )
      worker.postMessage(
        createThreadBootstrap(spec.name || fingerprint, fingerprint, spec.data, facts)
      )
      return generation.value
    } catch (error) {
      /** A cleanup failure follows the original primary and never replaces it. */
      let primary: unknown = identifyRpcBoundaryFailure(
        error,
        RpcCoreErrorCode.transport,
        ThreadErrorText.bootstrapFailed
      )
      try {
        if (generation) generation.value.terminate()
        else worker.terminate()
      } catch (cleanup) {
        primary = attachSecondaryErrors(primary, [cleanup])
      }
      throw primary
    }
  }
}

/** Create a module Worker owner; Bun observes close, Deno retains its unsupported exit guarantee. */
export function createWebThreadLauncher(
  options: IWebThreadLauncherOptions
): IThreadLauncher<IWebThreadHandle> {
  return new WebThreadLauncher(options)
}

/** Transfer a genuine launcher's cold carrier, or borrow a caller-owned raw EventTarget port. */
export function createWebThreadChannelFactory(
  options: IThreadChannelOptions &
    Readonly<{
      report(error: unknown): void
    }>
): IThreadChannelFactory<IWebThreadHandle> {
  return {
    async open(handle, signal) {
      if (signal.aborted) throw signal.reason
      return handle.open
        ? handle.open(signal)
        : createWebThreadCarrier(handle.port, handle.identity.fingerprint, options.report)
    }
  }
}
