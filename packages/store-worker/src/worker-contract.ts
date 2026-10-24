import type { IAbortSignal, INativeAbortSignal } from '@migaia/utils/promise'
import { deferred } from '@migaia/utils/promise'
import { normalizePortable, type IRpcPortableValue } from '@migaia/rpc-contract'
import { createRpcHost, type IRpcHost, type IRpcContext } from '@migaia/rpc-host'
import { defineFeaturePlugin } from '@migaia/rpc-host/plugin'
import { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'
import type { IWebWorkerLikePort } from '@migaia/rpc-host/plugin'
import { isArrayBuffer, isUint8Array } from '@migaia/utils/bytes'
import { WorkerRpcBridgeFeatureName, WorkerRpcIdentity } from './worker-constants.js'

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

/** The original setup hook lends the genuine Host, so raw handshake delivery never waits on itself. */
const workerBridgeFeature = defineFeaturePlugin((prepared: (host: IRpcHost<unknown>) => void) => ({
  name: WorkerRpcBridgeFeatureName,
  setup: ({ host }) => prepared(host)
}))

/** One bridge owns application handlers while the actual Host owns connections and providers. */
class WorkerContractEndpoint implements IWorkerContractEndpoint {
  /** Borrowed native port; physical lifetime remains with its caller. */
  #port: IWebWorkerLikePort
  /** Request configuration remains live exactly as in the original bridge. */
  #options: IWorkerContractOptions
  /** Default direct peer is captured once at construction. */
  #targetId: string
  /** Initial catalog is borrowed by the one actual Host compiler. */
  #providers: IWorkerProviders = Object.create(null)
  /** Native feature setup lends the Host before transport installation. */
  #host!: IRpcHost<unknown>
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
  #opening: Promise<unknown>

  /** Capture logical identity, then start the single canonical Host and its borrowed transport. */
  constructor(
    port: IWebWorkerLikePort,
    options: IWorkerContractOptions,
    prepare?: (endpoint: IWorkerContractEndpoint) => unknown
  ) {
    /** Preserve identity option reads before native preparation. */
    const id = options.id ?? WorkerRpcIdentity.main
    this.#targetId = options.targetId ?? WorkerRpcIdentity.worker
    this.#port = port
    this.#options = options
    this.#opening = createRpcHost({
      self: { name: id, instanceId: id },
      provide: this.#providers,
      plugins: [
        workerBridgeFeature((owner) => this.#prepare(owner, prepare)),
        dedicatedWorkerPlugin({
          worker: {
            postMessage: (message, transfer) => this.#port.postMessage(message, transfer),
            addEventListener: (type, listener) => {
              this.#port.addEventListener(type, listener)
              // Native subscription must exist before disposal or raw delivery can begin.
              if (type === 'message') this.#prepared.resolve(this.#preparedResult)
            },
            removeEventListener: (type, listener) => this.#port.removeEventListener(type, listener)
          }
        })
      ]
    })
    // Request callers retain the rejected opening; this observer only releases local setup.
    void this.#opening.catch((error) => this.#prepared.reject(error))
  }

  /** Return the original local preparation receipt without waiting on raw delivery itself. */
  get prepared(): Promise<unknown> {
    return this.#prepared.promise
  }

  /** Perform synchronous managed registration before remote discovery begins. */
  #prepare(
    host: IRpcHost<unknown>,
    prepare?: (endpoint: IWorkerContractEndpoint) => unknown
  ): void {
    this.#host = host
    this.#preparedResult = prepare ? prepare(this) : this
    this.#initializing = false
  }

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
    if (!this.#initializing) this.#host.provide(definition)
  }

  /** Wait for remote readiness before sending the encoded computation to the captured peer. */
  request: IWorkerContractEndpoint['request'] = (payload, options) =>
    this.#opening
      .then(() =>
        this.#host.send(this.#targetId, WorkerRpcIdentity.call, encodeWorkerValue(payload), {
          signal: options?.signal,
          /** Omission historically means no application deadline. */
          timeoutMs: this.#options.timeoutMs ?? false
        })
      )
      .then(decodeWorkerValue)

  /** Notifications share the same Host and complete at its physical write boundary. */
  notify: IWorkerContractEndpoint['notify'] = (payload, method = 'notify', options) => {
    /** Explicit target selection is captured before asynchronous readiness. */
    const targetId = options?.targetId ?? this.#targetId
    return this.#opening.then(
      () => this.#host.notify(method, encodeWorkerValue(payload), { targetId }) as Promise<void>
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
    return () => {
      methodHandlers.delete(handler)
      if (methodHandlers.size === 0) this.#handlers.delete(method)
    }
  }

  /** The actual Host retains cleanup ownership and the original cleanup result. */
  close = (): Promise<void> => this.#host.close()
}

/** Create a Worker bridge without transferring physical port ownership. */
export function createWorkerContractEndpoint(
  port: IWebWorkerLikePort,
  endpointOptions?: IWorkerContractOptions
): Promise<IWorkerContractEndpoint>
/** Managed raw callbacks register providers during local setup before remote handshaking. */
export function createWorkerContractEndpoint<T>(
  port: IWebWorkerLikePort,
  endpointOptions: IWorkerContractOptions,
  prepare: (endpoint: IWorkerContractEndpoint) => T
): Promise<T>
/** The named bridge keeps local preparation separate from the one Host's remote readiness. */
export function createWorkerContractEndpoint(
  port: IWebWorkerLikePort,
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
    return normalizePortable(output)
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

function encodeBytes(value: Uint8Array): { readonly $rpc: 'bytes'; readonly base64url: string } {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  const base64 = btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
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
