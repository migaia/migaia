/**
 * Connects StoreWorker request handlers to the actual RPC Host and borrowed Worker IO. Preparation,
 * remote readiness and one close Promise remain distinct; failed preparation borrows the Host's
 * original native cleanup receipts rather than collecting listener failures a second time.
 */
import type { IAbortSignal, INativeAbortSignal } from '@migaia/utils/promise'
import { deferred } from '@migaia/utils/promise'
import { attachSecondaryErrors } from '@migaia/utils/error'
import { normalizeRpcPortable, type IRpcPortableValue } from '@migaia/rpc-contract/portable'
import { createRpcHost, type IRpcHost, type IRpcContext } from '@migaia/rpc-host'
import { timeout } from '@migaia/rpc-host/features/timeout'
import { RpcAbortError, RpcConstructionError, RpcLifecycleError } from '@migaia/rpc-contract/errors'
import { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'
import type { IWorkerMessagePort } from './worker-message-event.js'
import { StoreWorkerErrorText } from './error-text.js'
import { isArrayBuffer, isUint8Array } from '@migaia/utils/bytes'
import { WorkerRpcIdentity } from './worker-constants.js'

type IWorkerHandler = (
  payload: unknown,
  signal: INativeAbortSignal,
  context: IWorkerRequestContext
) => unknown | Promise<unknown>

type IWorkerRequestContext = Readonly<{ method: string }>

/** Canonical Host providers express dotted method names as nested own-data groups. */
type IWorkerProvider = (payload: unknown, context: IRpcContext) => Promise<unknown>

/** One initial tree is passed directly to the actual Host's provider compiler. */
type IWorkerProviders = { [segment: string]: IWorkerProvider | IWorkerProviders }

/** Bridge configuration preserves independent request timeout and logical target identity. */
type IWorkerContractOptions = Readonly<{
  timeoutMs?: number
  id?: string
  targetId?: string
}>

/** The actual dedicated Worker plugin determines this Host's sole transport namespace. */
type IWorkerRpcHost = IRpcHost<
  Record<never, never>,
  readonly [ReturnType<typeof dedicatedWorkerPlugin<'worker'>>]
>

/** One bridge owns application handlers while the actual Host owns connections and providers. */
class WorkerContractEndpoint implements IWorkerContractEndpoint {
  /** Borrowed native port; physical lifetime remains with its caller. */
  #port: IWorkerMessagePort
  /** Request configuration remains live exactly as in the original bridge. */
  #options: IWorkerContractOptions
  /** The original local identity is captured before reading the direct target option. */
  readonly #id: string
  /** Default direct peer is captured once at construction. */
  #targetId: string
  /** Initial catalog is borrowed by the one actual Host compiler. */
  #providers: IWorkerProviders = Object.create(null)
  /** Only the actual committed Host may publish later provider registrations. */
  #host: IWorkerRpcHost | undefined
  /** Only synchronous local preparation may extend the initial catalog. */
  #initializing = true
  /** Ordered application callbacks are separate from Host provider registration. */
  #handlers = new Map<string, Set<IWorkerHandler>>()
  /** A method installs its canonical provider exactly once. */
  #installed = new Set<string>()
  /** Raw delivery is released after local preparation, independently of remote readiness. */
  #prepared = deferred<unknown>()
  /** The original preparation result includes any caller-owned disposal projection. */
  #preparedResult: unknown
  /** Remote readiness is awaited by request and notification callers. */
  #opening: Promise<IWorkerRpcHost>
  /** The actual Host's installation signal cancels a close that wins remote readiness. */
  readonly #control = new AbortController()
  /** Original synchronous registration callback runs before the actual Host compiles providers. */
  readonly #prepare: ((endpoint: IWorkerContractEndpoint) => unknown) | undefined
  /** Repeated endpoint cleanup joins its one original close result. */
  #closing: Promise<void> | undefined
  /** A local close reason distinguishes successful cancellation from an independent opening failure. */
  #closeReason: RpcLifecycleError | undefined

  /** Capture logical identity, then start the single canonical Host and its borrowed transport. */
  constructor(
    port: IWorkerMessagePort,
    options: IWorkerContractOptions,
    prepare?: (endpoint: IWorkerContractEndpoint) => unknown
  ) {
    this.#id = options.id ?? WorkerRpcIdentity.main
    this.#targetId = options.targetId ?? WorkerRpcIdentity.worker
    this.#port = port
    this.#options = options
    this.#prepare = prepare
    /** Publish readiness ownership before caller preparation can synchronously call close. */
    this.#opening = Promise.resolve().then(this.#open)
    // Request callers retain the rejected opening; this observer releases local setup only.
    void this.#opening.catch((error) => this.#prepared.reject(error))
  }

  /** Return the original local preparation receipt without waiting on raw delivery itself. */
  get prepared(): Promise<unknown> {
    return this.#prepared.promise
  }

  /** Prepare local providers synchronously before starting the sole actual Host handshake. */
  readonly #open = async (): Promise<IWorkerRpcHost> => {
    this.#preparedResult = this.#prepare ? this.#prepare(this) : this
    this.#initializing = false
    /** Providers and the native listener remain actual Host/Browser responsibilities. */
    const host = await createRpcHost({
      self: {
        name: this.#id,
        instanceId: this.#id
      },
      signal: this.#control.signal,
      provide: this.#providers,
      plugins: [
        dedicatedWorkerPlugin({
          worker: {
            postMessage: this.#post,
            addEventListener: this.#subscribe,
            removeEventListener: this.#unsubscribe
          }
        })
      ]
    })
    this.#host = host
    /** Only methods registered during remote readiness still need actual directory publication. */
    for (const method of this.#handlers.keys()) this.#install(method)
    return host
  }

  /** Keep the actual borrowed native receiver and original transfer ownership. */
  readonly #post: IWorkerMessagePort['postMessage'] = (message, transfer) =>
    this.#port.postMessage(message, transfer)

  /** Local managed delivery can begin as soon as the actual native message listener exists. */
  readonly #subscribe: IWorkerMessagePort['addEventListener'] = (type, listener) => {
    this.#port.addEventListener(type, listener)
    if (type === 'message') this.#prepared.resolve(this.#preparedResult)
  }

  /** Native transport cleanup removes the exact listener from its original port. */
  readonly #unsubscribe: IWorkerMessagePort['removeEventListener'] = (type, listener) =>
    this.#port.removeEventListener(type, listener)

  /** Decode per handler invocation and preserve callback order and the final result. */
  async #invoke(method: string, payload: unknown, signal: INativeAbortSignal): Promise<unknown> {
    /** Each handler may replace the previous handler's result. */
    let result: unknown
    for (const handler of this.#handlers.get(method) ?? [])
      result = await handler(decodeWorkerValue(payload), signal, { method })
    return result
  }

  /** Update the actual Host directory; this bridge never creates a second endpoint. */
  #install(method: string): void {
    if (this.#installed.has(method)) return
    if (!this.#initializing && !this.#host) return
    this.#installed.add(method)
    /** One provider serves both initial and later registration. */
    const provider = async (payload: unknown, context: IRpcContext) =>
      encodeWorkerValue(await this.#invoke(method, payload, context.signal))
    /** Initial siblings share own-data groups in the borrowed canonical catalog. */
    const definition: IWorkerProviders = this.#initializing ? this.#providers : Object.create(null)
    /** Dot-separated segments are literal method paths. */
    const segments = method.split('.')
    /** Cursor into the canonical nested provider shape. */
    let group = definition
    for (let index = 0; index < segments.length - 1; index++)
      group = (group[segments[index]!] ??= Object.create(null)) as IWorkerProviders
    group[segments.at(-1)!] = provider
    if (!this.#initializing) this.#host!.provide(definition)
  }

  /** Wait for remote readiness before sending to the captured peer through its actual namespace. */
  request: IWorkerContractEndpoint['request'] = (payload, options) =>
    this.#opening
      .then((host) => {
        /** Read the live request budget once, retaining omission as no application deadline. */
        const ms = this.#options.timeoutMs
        return host.worker.send(
          this.#targetId,
          WorkerRpcIdentity.call,
          encodeWorkerValue(payload),
          {
            signal: options?.signal,
            timeout: ms === undefined ? false : timeout({ ms })
          }
        )
      })
      .then(decodeWorkerValue)

  /** Notifications share the same Host and complete at its physical write boundary. */
  notify: IWorkerContractEndpoint['notify'] = (payload, method = 'notify', options) => {
    /** Explicit target selection is captured before asynchronous readiness. */
    const targetId = options?.targetId ?? this.#targetId
    return this.#opening.then(
      (host) =>
        host.worker.notify(method, encodeWorkerValue(payload), { targetId }) as Promise<void>
    )
  }

  /** Register ordered application handlers without reinstalling an existing Host provider. */
  onRequest = (
    methodOrHandler: string | IWorkerHandler,
    maybeHandler?: IWorkerHandler
  ): (() => void) => {
    /** Preserve the existing optional call-method shorthand. */
    const method = typeof methodOrHandler === 'string' ? methodOrHandler : WorkerRpcIdentity.call
    /** The returned disposer removes exactly this callback registration. */
    const handler = typeof methodOrHandler === 'string' ? maybeHandler : methodOrHandler
    if (!handler) return () => undefined
    this.#install(method)
    /** Insertion order remains observable when several handlers share a method. */
    const methodHandlers = this.#handlers.get(method) ?? new Set<IWorkerHandler>()
    methodHandlers.add(handler)
    this.#handlers.set(method, methodHandlers)
    /** The original registration owns the exact set, callback and method removed together. */
    const registration = { methodHandlers, handler, method }
    return () => {
      registration.methodHandlers.delete(registration.handler)
      if (registration.methodHandlers.size === 0) this.#handlers.delete(registration.method)
    }
  }

  /** Close the actual Host, or cancel its original construction before remote readiness. */
  close = (): Promise<void> => {
    if (this.#closing) return this.#closing
    if (this.#host) return (this.#closing = this.#host.close())
    /** Publish cleanup before abort invokes arbitrary actual native cleanup callbacks. */
    const completion = deferred<void>()
    this.#closing = completion.promise
    this.#closeReason = new RpcLifecycleError(StoreWorkerErrorText.disposed)
    this.#control.abort(this.#closeReason)
    void this.#closeOpening().then(completion.resolve, completion.reject)
    return this.#closing
  }

  /** Host rollback owns failed preparation; suppress only this endpoint's exact intentional abort. */
  async #closeOpening(): Promise<void> {
    try {
      const host = await this.#opening
      await host.close()
    } catch (error) {
      /** Host construction may retain this endpoint's intentional cancellation in its typed cause. */
      const primary = error instanceof RpcConstructionError ? error.cause : error
      if (
        primary !== this.#closeReason &&
        !(primary instanceof RpcAbortError && primary.cause === this.#closeReason)
      )
        throw error
      /** Both canonical construction and cancellation receipts can own late rollback cleanup. */
      const cleanup =
        error instanceof RpcConstructionError || error instanceof RpcAbortError ? error : undefined
      /** Preserve the original native cleanup values instead of reporting normal cancellation. */
      const failures = cleanup?.cleanupPromise
        ? await cleanup.cleanupPromise
        : (cleanup?.cleanupErrors ?? [])
      if (failures.length === 1) throw failures[0]!.error
      if (failures.length > 1)
        throw attachSecondaryErrors(
          failures[0]!.error,
          failures.slice(1).map((entry) => entry.error)
        )
    }
  }
}

/** Create a Worker bridge without transferring physical port ownership. */
export function createWorkerContractEndpoint(
  port: IWorkerMessagePort,
  endpointOptions?: IWorkerContractOptions
): Promise<IWorkerContractEndpoint>
/** Managed raw callbacks register providers during local setup before remote handshaking. */
export function createWorkerContractEndpoint<T>(
  port: IWorkerMessagePort,
  endpointOptions: IWorkerContractOptions,
  prepare: (endpoint: IWorkerContractEndpoint) => T
): Promise<T>
/** The named bridge keeps local preparation separate from the one Host's remote readiness. */
export function createWorkerContractEndpoint(
  port: IWorkerMessagePort,
  endpointOptions: IWorkerContractOptions = {},
  prepare?: (endpoint: IWorkerContractEndpoint) => unknown
): Promise<unknown> {
  return new WorkerContractEndpoint(port, endpointOptions, prepare).prepared
}

/** Public worker bridge surface shared by the normal and serialization worker consumers. */
export type IWorkerContractEndpoint = Readonly<{
  request(payload: unknown, options?: { signal?: IAbortSignal }): Promise<unknown>
  notify(payload: unknown, method?: string, options?: { targetId?: string }): Promise<void>
  onRequest(
    method: string,
    handler?: (
      payload: unknown,
      signal: INativeAbortSignal,
      context: Readonly<{ method: string }>
    ) => unknown | Promise<unknown>
  ): () => void
  close(): Promise<void>
}>

/** Converts worker payloads to the canonical portable profile without losing binary value kind. */
function encodeWorkerValue(value: unknown): IRpcPortableValue {
  if (value === undefined) return { $worker: 'undefined' } as unknown as IRpcPortableValue
  if (isArrayBuffer(value))
    return {
      $worker: 'array-buffer',
      value: encodeBytes(new Uint8Array(value))
    } as unknown as IRpcPortableValue
  if (isUint8Array(value))
    return { $worker: 'uint8-array', value: encodeBytes(value) } as unknown as IRpcPortableValue
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map((item) => encodeWorkerValue(item))
  if (typeof value === 'object') {
    const output: Record<string, IRpcPortableValue> = {}
    for (const key of Object.keys(value as object))
      output[key] = encodeWorkerValue((value as Record<string, unknown>)[key])
    return normalizeRpcPortable(output)
  }
  return { $worker: 'undefined' } as unknown as IRpcPortableValue
}

/** Restores worker payload values from the canonical portable representation. */
function decodeWorkerValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeWorkerValue)
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (record.$worker === 'undefined') return undefined
  if (record.$worker === 'array-buffer') return decodeBytes(record.value).buffer
  if (record.$worker === 'uint8-array') return decodeBytes(record.value)
  const output: Record<string, unknown> = {}
  for (const key of Object.keys(record)) output[key] = decodeWorkerValue(record[key])
  return output
}

/** Preserve the bridge's native btoa alphabet and iterator semantics with one final linear join. */
function encodeBytes(value: Uint8Array): { readonly $rpc: 'bytes'; readonly base64url: string } {
  /** Each original byte contributes one character, avoiding repeated whole-prefix concatenation. */
  const characters: string[] = []
  for (const byte of value) characters.push(String.fromCharCode(byte))
  const base64 = btoa(characters.join(''))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
  return { $rpc: 'bytes', base64url: base64 }
}

function decodeBytes(value: unknown): Uint8Array {
  const encoded = (value as { base64url?: unknown }).base64url
  if (typeof encoded !== 'string') return new Uint8Array()
  const binary = atob(
    encoded.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((encoded.length + 3) % 4)
  )
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}
