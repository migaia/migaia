/**
 * Captures native workerData or the first parent bootstrap once and reuses that exact child
 * resource. Runtime discovery excludes browser Workers and does not manufacture a parent
 * connection.
 */
import { detectServerRuntime, detectGlobalScope, ServerRuntime } from '@migaia/utils'
import { IpcReporterContext } from '@migaia/rpc-host/sdk'
import { deferred, hostRethrowReporter, type IAbortSignal } from '@migaia/utils/promise'
import type { IRpcCarrier } from '@migaia/rpc-contract/interfaces'
import { RpcTransportError } from '@migaia/rpc-contract/errors'
import { readNodeThreadRuntime } from './runtime-resource.ts'
import { readThreadInitial, type IThreadBootstrap } from './bootstrap.ts'
import { createWebThreadCarrier } from './channel.ts'
import { ThreadEvent, THREAD_BOOTSTRAP_TIMEOUT_MS } from './constants.ts'
import { ThreadErrorText } from './error-text.ts'
import type { IThreadWebPort } from './types.ts'

/** A guard and automatic parent attachment share this exact native initial capture. */
const webChildren = new WeakMap<IThreadWebPort, ThreadChildCapture>()
/** Native workerData is admitted once; later guard/install calls reuse the actual snapshot. */
let nodeInitial: IThreadBootstrap | undefined
/** Invalid native workerData does not become a child merely because a later caller asks again. */
let nodeRead = false

/** Discover real native dedicated Worker globals, excluding browser Workers. */
export function threadWebParent(): IThreadWebPort | undefined {
  /** Canonical selection gives Bun precedence over its Node compatibility markers. */
  const runtime = detectServerRuntime()
  /** Browser scope never selects this native transport package. */
  const scope = detectGlobalScope()
  if (runtime === undefined && scope !== undefined) return undefined
  if (
    runtime === ServerRuntime.deno &&
    typeof Reflect.get(globalThis, 'WorkerGlobalScope') === 'function' &&
    globalThis instanceof Reflect.get(globalThis, 'WorkerGlobalScope')
  )
    return globalThis as unknown as IThreadWebPort
  if (runtime === ServerRuntime.bun) {
    /** Bun's native child fact permits capture; it grants no decoded-message authority. */
    const bun = Reflect.get(globalThis, 'Bun') as { isMainThread?: boolean } | undefined
    if (bun?.isMainThread === false && typeof Reflect.get(globalThis, 'postMessage') === 'function')
      return globalThis as unknown as IThreadWebPort
  }
  return undefined
}

/** Own the original first native message and hand subsequent frames to the single SDK carrier. */
class ThreadChildCapture {
  /** Only this real native global can supply the initial source relationship. */
  readonly #port: IThreadWebPort
  /** The original bootstrap deadline is cleared on capture, native failure or timeout. */
  readonly #timer: ReturnType<typeof setTimeout>
  /** Guard and transport share one Promise and one actual carrier. */
  readonly #ready = deferred<Readonly<{ initial: IThreadBootstrap; carrier: IRpcCarrier }>>()
  /** An already captured carrier is closed if installation aborts before Session takes ownership. */
  #carrier: IRpcCarrier | undefined
  /** Installed diagnostics replace only the pre-install background failure sink. */
  #report: (error: unknown) => void = (error) => hostRethrowReporter(error, IpcReporterContext)
  /** Install private capture before a native bootstrap can arrive. */
  constructor(port: IThreadWebPort) {
    this.#port = port
    port.addEventListener(ThreadEvent.message, this.#receive)
    port.addEventListener(ThreadEvent.messageerror, this.#failed)
    this.#timer = setTimeout(
      () => this.#failed(new RpcTransportError(ThreadErrorText.bootstrapFailed)),
      THREAD_BOOTSTRAP_TIMEOUT_MS
    )
    /**
     * The guard/open caller receives the same original failure; this observer avoids a late
     * unhandled rejection.
     */
    void this.#ready.promise.catch(() => undefined)
  }
  /** Remove bootstrap listeners before the SDK carrier installs its sole application reader. */
  readonly #release = (): void => {
    clearTimeout(this.#timer)
    this.#port.removeEventListener(ThreadEvent.message, this.#receive)
    this.#port.removeEventListener(ThreadEvent.messageerror, this.#failed)
  }
  /** Read trusted native initialization once, then synchronously retain any early protocol frame. */
  readonly #receive = (event: { data: unknown }): void => {
    this.#release()
    try {
      /** The actual launch source must supply both child and parent identities. */
      const initial = readThreadInitial(event.data)
      if (!initial.source) throw new RpcTransportError(ThreadErrorText.bootstrapFailed)
      /** This same carrier survives the guard/install boundary; no second cold queue is introduced. */
      const carrier = createWebThreadCarrier(
        this.#port,
        initial.source.expectedPeerId!,
        this.#forwardReport
      )
      this.#carrier = carrier
      this.#ready.resolve({ initial, carrier })
    } catch (error) {
      this.#ready.reject(error)
    }
  }
  /** Native failure and deadline reject the original pending bootstrap and detach exact listeners. */
  readonly #failed = (reason: unknown): void => {
    this.#release()
    this.#ready.reject(new RpcTransportError(ThreadErrorText.bootstrapFailed, reason))
  }
  /** Carrier diagnostics follow the installed Host once the transport takes ownership. */
  readonly #forwardReport = (error: unknown): void => this.#report(error)
  /** Reuse the guard's exact captured carrier and install its actual reporting destination. */
  async open(report?: (error: unknown) => void, signal?: IAbortSignal) {
    if (report) this.#report = report
    /** Only the actual installation aborts its pending native acquisition. */
    const abort = (): void => {
      this.#release()
      this.#ready.reject(signal?.reason)
      if (this.#carrier) void this.#carrier.close(signal?.reason).catch(this.#forwardReport)
    }
    if (signal?.aborted) {
      abort()
      throw signal.reason
    }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      return await this.#ready.promise
    } finally {
      signal?.removeEventListener('abort', abort)
    }
  }
}

/** Capture once per actual native Worker global without accepting copyable source tokens. */
export function threadChildResource(port: IThreadWebPort): ThreadChildCapture {
  /** Weak membership belongs to native bootstrap capture, not a second member registry. */
  let capture = webChildren.get(port)
  if (!capture) {
    capture = new ThreadChildCapture(port)
    webChildren.set(port, capture)
  }
  return capture
}

/** Node workerData and parentPort are borrowed from the real selected native module. */
export function nativeThreadInitial(): IThreadBootstrap | undefined {
  if (nodeRead) return nodeInitial
  nodeRead = true
  /** Main-thread workerData never grants parent transport acquisition. */
  const native = readNodeThreadRuntime()
  if (!native?.parentPort) return undefined
  if (
    !native.workerData ||
    typeof native.workerData !== 'object' ||
    !('source' in native.workerData)
  )
    return undefined
  /** The actual runtime input is captured once rather than re-normalized by guard and install. */
  const initial = readThreadInitial(native.workerData)
  if (initial.source) nodeInitial = initial
  return nodeInitial
}

/** Await the real Web initial message; Node reads its genuine native parentPort/workerData. */
export async function isThreadChild(): Promise<boolean> {
  /** A Web guard retains the same carrier that a subsequent plugin installation will attach. */
  const parent = threadWebParent()
  if (parent) {
    await threadChildResource(parent).open()
    return true
  }
  return nativeThreadInitial() !== undefined
}

/** Factory admission remains synchronous and does not accept a user-supplied child marker. */
export function isNativeThreadChild(): boolean {
  return threadWebParent() !== undefined || nativeThreadInitial() !== undefined
}
