import { normalizePortable, type IRpcPortableValue } from '@migaia/rpc-contract'
import { abort, connect, createEndpoint, timeout } from '@migaia/web-rpc'
import { createOneWayFeature } from '@migaia/web-rpc/features/one-way'
import {
  createWebWorkerTransport,
  type IWebWorkerLikePort
} from '@migaia/web-rpc/adapters/web-worker'
import { WorkerRpcIdentity } from './worker-constants.js'

type IWorkerHandler = (
  payload: unknown,
  signal: IWorkerAbortSignal,
  context: IWorkerRequestContext
) => unknown | Promise<unknown>

type IWorkerRequestContext = Readonly<{ method: string }>

type IWorkerAbortSignal = Readonly<{
  aborted: boolean
  reason?: unknown
  addEventListener(type: 'abort', listener: () => void, options?: { readonly once?: boolean }): void
  removeEventListener(type: 'abort', listener: () => void): void
}>

/** Creates one worker bridge over the canonical WebRPC request/provider/control closure. */
export function createWorkerContractEndpoint(
  port: IWebWorkerLikePort,
  endpointOptions: {
    readonly timeoutMs?: number
    readonly id?: string
    readonly targetId?: string
  } = {}
): Promise<IWorkerContractEndpoint> {
  const id = endpointOptions.id ?? WorkerRpcIdentity.main
  const defaultTargetId = endpointOptions.targetId ?? WorkerRpcIdentity.worker
  const transport = createWebWorkerTransport(port, { peerId: defaultTargetId })
  return createEndpoint({
    id,
    targetIds: [defaultTargetId],
    transport,
    middlewares: [connect({ transport }), abort(), timeout()],
    features: [createOneWayFeature()] as const
  }).then((endpoint) => {
    const handlers = new Map<string, Set<IWorkerHandler>>()
    const installed = new Set<string>()
    const invoke = async (
      method: string,
      payload: unknown,
      signal: IWorkerAbortSignal
    ): Promise<unknown> => {
      let result: unknown
      for (const handler of handlers.get(method) ?? [])
        result = await handler(decodeWorkerValue(payload), signal, { method })
      return result
    }
    const install = (method: string): void => {
      if (installed.has(method)) return
      installed.add(method)
      endpoint.provide(method, async (context) =>
        context.success(encodeWorkerValue(await invoke(method, context.data, context.signal)))
      )
      endpoint.on(method, async (context) => {
        await invoke(method, context.data, context.signal)
      })
    }
    return {
      request(payload, options) {
        return endpoint
          .send(defaultTargetId, WorkerRpcIdentity.call, encodeWorkerValue(payload), {
            signal: options?.signal,
            timeoutMs: endpointOptions.timeoutMs,
            transfer: options?.transfer
          })
          .then(decodeWorkerValue)
      },
      notify(payload, method = 'notify', options) {
        const targetId = options?.targetId ?? defaultTargetId
        return endpoint.sendOneWay(targetId, method, encodeWorkerValue(payload), options)
      },
      onRequest(methodOrHandler, maybeHandler) {
        const method =
          typeof methodOrHandler === 'string' ? methodOrHandler : WorkerRpcIdentity.call
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
      close: () => endpoint.dispose()
    }
  })
}

/** Public worker bridge surface shared by the normal and serialization worker consumers. */
export type IWorkerContractEndpoint = Readonly<{
  request(
    payload: unknown,
    options?: { signal?: IWorkerAbortSignal; transfer?: readonly Transferable[] }
  ): Promise<unknown>
  notify(
    payload: unknown,
    method?: string,
    options?: { transfer?: readonly Transferable[]; targetId?: string }
  ): Promise<void>
  onRequest(
    method: string,
    handler?: (
      payload: unknown,
      signal: IWorkerAbortSignal,
      context: Readonly<{ method: string }>
    ) => unknown | Promise<unknown>
  ): () => void
  close(): Promise<void>
}>

/** Converts worker payloads to the canonical portable profile without losing binary value kind. */
function encodeWorkerValue(value: unknown): IRpcPortableValue {
  if (value === undefined) return { $worker: 'undefined' } as unknown as IRpcPortableValue
  if (value instanceof ArrayBuffer)
    return {
      $worker: 'array-buffer',
      value: encodeBytes(new Uint8Array(value))
    } as unknown as IRpcPortableValue
  if (value instanceof Uint8Array)
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
