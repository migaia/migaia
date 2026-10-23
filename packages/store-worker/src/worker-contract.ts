import type { IAbortSignal, INativeAbortSignal } from '@migaia/utils/promise'
import { deferred } from '@migaia/utils/promise'
import { normalizePortable, type IRpcPortableValue } from '@migaia/rpc-contract'
import { createRpcHost, type IRpcHost, type IRpcContext } from '@migaia/rpc-host'
import { defineFeaturePlugin } from '@migaia/rpc-host/plugin'
import { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'
import type { IWebWorkerLikePort } from '@migaia/rpc-plugin-browser/adapters/web-worker'
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

/** Creates one Worker bridge while canonical Host/plugin owners retain handshake and physical I/O. */
export function createWorkerContractEndpoint(
  port: IWebWorkerLikePort,
  endpointOptions?: IWorkerContractOptions
): Promise<IWorkerContractEndpoint>
/** Managed raw callbacks register known providers during native setup before remote handshaking. */
export function createWorkerContractEndpoint<T>(
  port: IWebWorkerLikePort,
  endpointOptions: IWorkerContractOptions,
  prepare: (endpoint: IWorkerContractEndpoint) => T
): Promise<T>
/** Local managed preparation and remote readiness remain owned by the same actual Host. */
export function createWorkerContractEndpoint(
  port: IWebWorkerLikePort,
  endpointOptions: IWorkerContractOptions = {},
  prepare?: (endpoint: IWorkerContractEndpoint) => unknown
): Promise<unknown> {
  const id = endpointOptions.id ?? WorkerRpcIdentity.main
  const defaultTargetId = endpointOptions.targetId ?? WorkerRpcIdentity.worker
  /** Local preparation is distinct from remote readiness, which consumes the raw managed callback. */
  const prepared = deferred<unknown>()
  /** The original Host borrows this initial provider object when its canonical assembly starts. */
  const providers: IWorkerProviders = Object.create(null)
  /** Native feature setup lends this Host before transport installation begins. */
  let host!: IRpcHost<unknown>
  /** Only synchronous managed preparation may populate the initial canonical provider input. */
  let initializing = true
  /** Native listener capture releases this already prepared projection without waiting on a peer. */
  let preparedResult: unknown
  /** Store-worker owns its ordered application handlers; Host alone owns provider registration. */
  const handlers = new Map<string, Set<IWorkerHandler>>()
  /** One canonical provider handles both result-bearing and physically completed one-way calls. */
  const installed = new Set<string>()
  /** Invocations preserve original handler order, payload decoding and provider cancellation. */
  const invoke = async (
    method: string,
    payload: unknown,
    signal: INativeAbortSignal
  ): Promise<unknown> => {
    let result: unknown
    for (const handler of handlers.get(method) ?? [])
      result = await handler(decodeWorkerValue(payload), signal, { method })
    return result
  }
  /** Incremental registration updates the real Host directory rather than a second endpoint. */
  const install = (method: string): void => {
    if (installed.has(method)) return
    installed.add(method)
    /** The same provider function serves initial setup and later incremental registration. */
    const provider = async (payload: unknown, context: IRpcContext) =>
      encodeWorkerValue(await invoke(method, payload, context.signal))
    /** Dot-separated worker methods use the Host compiler's original nested catalog form. */
    const definition: IWorkerProviders = initializing ? providers : Object.create(null)
    /** Each segment below is a literal method path, never a separate provider/connection owner. */
    const segments = method.split('.')
    /** Existing sibling methods share their canonical own-data group during initial preparation. */
    let group = definition
    for (const segment of segments.slice(0, -1))
      group = (group[segment] ??= Object.create(null)) as IWorkerProviders
    group[segments.at(-1)!] = provider
    if (!initializing) host.provide(definition)
  }
  /** Operations use one Host, while raw delivery can proceed after local managed preparation. */
  const bridge: IWorkerContractEndpoint = {
    request(payload, options) {
      /** Preserve the old worker list unchanged; canonical Host owns capability admission. */
      const transfer = options?.transfer as readonly ArrayBuffer[] | undefined
      return opening
        .then(() =>
          host.send(defaultTargetId, WorkerRpcIdentity.call, encodeWorkerValue(payload), {
            signal: options?.signal,
            /** Omission historically means no application deadline, not the Host default. */
            timeoutMs: endpointOptions.timeoutMs ?? false,
            ...(transfer === undefined || (Array.isArray(transfer) && transfer.length === 0)
              ? {}
              : { transfer })
          })
        )
        .then(decodeWorkerValue)
    },
    notify(payload, method = 'notify', options) {
      const targetId = options?.targetId ?? defaultTargetId
      /** An absent worker transfer policy must remain absent at canonical Host admission. */
      const transfer = options?.transfer as readonly ArrayBuffer[] | undefined
      return opening.then(
        () =>
          host.notify(method, encodeWorkerValue(payload), {
            targetId,
            ...(transfer === undefined || (Array.isArray(transfer) && transfer.length === 0)
              ? {}
              : { transfer })
          }) as Promise<void>
      )
    },
    onRequest(methodOrHandler, maybeHandler) {
      const method = typeof methodOrHandler === 'string' ? methodOrHandler : WorkerRpcIdentity.call
      const handler = typeof methodOrHandler === 'string' ? maybeHandler : methodOrHandler
      if (!handler) return () => undefined
      install(method)
      const methodHandlers = handlers.get(method) ?? new Set<IWorkerHandler>()
      methodHandlers.add(handler)
      handlers.set(method, methodHandlers)
      return () => {
        methodHandlers.delete(handler)
        if (methodHandlers.size === 0) handlers.delete(method)
      }
    },
    close: () => host.close()
  }
  /** The single native Host owns the borrowed Worker and every subsequent request/notification. */
  const opening = createRpcHost({
    self: { name: id, instanceId: id },
    provide: providers,
    plugins: [
      workerBridgeFeature((owner) => {
        host = owner
        /** Managed preparation returns the original disposal projection without awaiting a peer. */
        preparedResult = prepare ? prepare(bridge) : bridge
        initializing = false
      }),
      dedicatedWorkerPlugin({
        worker: {
          postMessage: (message, transfer) => port.postMessage(message, transfer),
          addEventListener: (type, listener) => {
            port.addEventListener(type, listener)
            // The actual native subscription must exist before callers can dispose or deliver raw frames.
            if (type === 'message') prepared.resolve(preparedResult)
          },
          removeEventListener: (type, listener) => port.removeEventListener(type, listener)
        }
      })
    ]
  })
  /** The original opening stays rejected for request callers; this observer only releases setup. */
  void opening.catch((error) => prepared.reject(error))
  return prepared.promise
}

/** Public worker bridge surface shared by the normal and serialization worker consumers. */
export type IWorkerContractEndpoint = Readonly<{
  request(
    payload: unknown,
    options?: { signal?: IAbortSignal; transfer?: readonly unknown[] }
  ): Promise<unknown>
  notify(
    payload: unknown,
    method?: string,
    options?: { transfer?: readonly unknown[]; targetId?: string }
  ): Promise<void>
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
