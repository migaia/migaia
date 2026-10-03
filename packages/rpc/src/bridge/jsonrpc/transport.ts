import { materializeJsonSnapshot } from './object-pipeline.js'
import { deferred } from '@migaia/utils/promise'
import { deserializeRpcError, serializeRpcError } from '../../contract/error.js'
import { fromJsonRpcError } from '../../contract/error-jsonrpc.js'
import { normalizeRpcEnvelope } from '../../contract/v1/normalize.js'
import type { IRpcRequestEnvelope } from '../../contract/v1/types.js'
import type { IRpcSerializedError } from '../../contract/types.js'
import {
  RpcControl,
  RpcCapability,
  RpcEnvelopeKind,
  RpcRouteField,
  RpcRouteType
} from '../../contract/wire-constants.js'
import { RpcJsonRpcWireError } from '../../contract/wire-error-constants.js'
import { resolveAbortReason } from '../../core/internal/async-control.js'
import {
  collectListenerCleanupFailures,
  createListenerFailureState,
  reportListenerFailure,
  drainTerminalListenerFailures
} from '../../core/transport-kit.js'
import type { IRpcTransport, IRpcInboundMessage } from '../../core/transport.js'
import {
  RpcPlatform,
  RpcTransportEncoding,
  RpcTransportOwnership,
  RpcTransportTopology
} from '../../core/transport-constants.js'
import { RpcProcessErrorCode } from '../../process/error-code.js'
import { createProcessError } from '../../process/error.js'
import { RemoteMethodName } from '../../remote/constants.js'
import { RpcRemoteLayerErrorCode } from '../../remote/error-code.js'
import { JsonRpcProfile, JsonRpcErrorNumber } from './constants.js'
import { readRpcBatchMembers } from '../../contract/batch-frame.js'
import { JsonRpcBridgeErrorCode } from './error-code.js'
import { createJsonRpcBridgeError } from './error.js'
import { createJsonRpcFrameDecoder, encodeJsonRpcFrame } from './framing.js'
import { validateJsonRpcDescription, type IJsonRpcBridgeOptions } from './handshake.js'

/** The factory owns one pre-ready hello and one exclusive logical transport. */
export type IJsonRpcWire = Readonly<{
  transport: IRpcTransport
  /** Package-private data ports share the public sender, subscribers and terminal owner. */
  readonly sendObject: IRpcTransport['send']
  readonly subscribeObject: IRpcTransport['subscribe']
  readonly registerObjectPortRelease: (release: () => void) => void
  /** Completed hello intersection alone enables JSON-RPC arrays after negotiation. */
  setCapabilities(capabilities: readonly string[]): void
  exchangeHello(hello: string): Promise<unknown>
  close(reason?: unknown): Promise<void>
  assertOpen(): void
  readonly closed: boolean
}>

/** Bind raw bytes once, translate logical envelopes, and keep all correlation connection-local. */
export function bindJsonRpcWire(options: IJsonRpcBridgeOptions): IJsonRpcWire {
  /** Whole-envelope requests are retained only until response, cancel or connection release. */
  const pending = new Map<string, IRpcRequestEnvelope>()
  /** The one handshake promise exists before a synchronous peer can deliver its response. */
  const helloResult = deferred<unknown>()
  /** An observed rejection prevents connection failure before exchange from becoming unhandled. */
  void helloResult.promise.catch(() => undefined)
  /** Listener and reporter cleanup uses the shared adapter failure collector. */
  const failures = createListenerFailureState()
  /** Only this logical connection owns inbound response subscribers. */
  const listeners = new Set<(message: IRpcInboundMessage) => void>()
  /** Distinguishes private subscribers without changing Set identity or traversal semantics. */
  const objectListeners = new WeakSet<(message: IRpcInboundMessage) => void>()
  /** Final wrapper's capability disposer is set only after successful IPC adoption. */
  let releaseObjectPort: (() => void) | undefined
  /** Transport failure subscribers settle core pending requests on termination. */
  const errorListeners = new Set<(error: unknown) => void>()
  /** All physical writes can settle promptly on close even if drain never arrives. */
  const writes = new Set<(error: unknown) => void>()
  /** Acquire physical subscription disposers in registration order. */
  const removals: Array<() => void> = []
  /** One bounded decoder is shared across all OS reads for this connection. */
  const decoder = createJsonRpcFrameDecoder()
  /** The monotonic terminal state is shared by all subscriptions and write settlements. */
  let closed = false
  /** Preserve the first terminal reason, especially the caller abort instance. */
  let terminal: unknown
  /** Concurrent close callers join the same resource cleanup Promise. */
  let closing: Promise<void> | undefined
  /** Before hello settlement, any response must belong to its fixed correlation id. */
  let helloPending = true
  /** False before hello and when the peer did not explicitly negotiate physical batch support. */
  let batch = false

  /** Observe report failures without replacing the primary protocol failure. */
  const report = (error: unknown): void => reportListenerFailure(error, [options.report], failures)

  /** Commit terminal state before callbacks, then release every physical resource exactly once. */
  const close = (reason?: unknown): Promise<void> => {
    if (closing) return closing
    closed = true
    releaseObjectPort?.()
    releaseObjectPort = undefined
    terminal = reason ?? createProcessError(RpcProcessErrorCode.channelClosed)
    decoder.close()
    pending.clear()
    helloResult.reject(terminal)
    for (const reject of writes) reject(terminal)
    writes.clear()
    /** Schedule cleanup after registration has returned its removers, including synchronous EOF. */
    closing = Promise.resolve().then(async () => {
      /** Collect every physical disposer failure without interrupting later cleanup. */
      const cleanup = collectListenerCleanupFailures(removals)
      removals.length = 0
      try {
        await options.byte.close()
      } catch (error) {
        cleanup.push(error)
      }
      for (const error of cleanup) report(error)
      listeners.clear()
      errorListeners.clear()
      if (cleanup.length > 0 || failures.failures.length > 0 || failures.pending.size > 0)
        await drainTerminalListenerFailures([terminal, ...cleanup], {
          secondaryFailures: failures,
          aggregateSingle: true
        })
    })
    for (const listener of errorListeners) reportListenerFailure(terminal, [listener], failures)
    return closing
  }

  /** Async event failures are reported once while all pending work follows transport termination. */
  const fail = (error: unknown): void => {
    if (closed) return
    report(error)
    void close(error).catch(report)
  }

  /** One complete JSON-RPC object corresponds to one drain-aware physical byte write. */
  const write = (value: unknown): Promise<void> => {
    if (closed) return Promise.reject(terminal)
    /** Frame encoding happens once before handing the whole object to the writer. */
    const frame = encodeJsonRpcFrame(value)
    return new Promise<void>((resolve, reject) => {
      /** The terminal callback stays registered until the physical Promise has settled. */
      const abortWrite = (error: unknown): void => reject(error)
      writes.add(abortWrite)
      /** Only negotiated whole-frame writes remove the legacy deferred physical handoff. */
      const invoke = () => {
        if (closed) throw terminal
        return options.byte.write(frame)
      }
      let result: void | Promise<void>
      if (batch) {
        try {
          result = invoke()
        } catch (error) {
          result = Promise.reject(error)
        }
      } else result = Promise.resolve().then(invoke)
      void Promise.resolve(result).then(
        () => {
          writes.delete(abortWrite)
          resolve()
        },
        (cause: unknown) => {
          /** Late physical rejection is secondary once another event committed closure. */
          const alreadyClosed = closed
          writes.delete(abortWrite)
          /** IO failure keeps its original instance reachable through the process error cause. */
          const error = createProcessError(RpcProcessErrorCode.channelClosed, cause)
          reject(error)
          if (alreadyClosed) report(error)
          else fail(error)
        }
      )
    })
  }

  /** Translate the wire error graph; absent business extension fails only the correlated call. */
  const wireError = (value: unknown, describe: boolean): IRpcSerializedError => {
    /** Only a validated JSON-RPC integer participates in extension classification. */
    const error = value as { code: number; data?: unknown }
    /** The canonical error owner validates and preserves the entire foreign graph. */
    const wire = fromJsonRpcError(value)
    /** Presence, not truthiness, selects the mandatory business error extension. */
    const embedded =
      typeof error.data === 'object' &&
      error.data !== null &&
      Object.hasOwn(error.data, RpcJsonRpcWireError.dataKey)
    if (embedded) return wire
    /** Library protocol failures remain foreign errors instead of bridge violations. */
    const standard =
      error.code === JsonRpcErrorNumber.parse ||
      (error.code <= JsonRpcErrorNumber.invalidRequest && error.code >= JsonRpcErrorNumber.internal)
    if ((describe && error.code === JsonRpcErrorNumber.methodNotFound) || !standard)
      throw createJsonRpcBridgeError(
        JsonRpcBridgeErrorCode.extensionMissing,
        deserializeRpcError(wire)
      )
    return wire
  }

  /** Build the sole internal response shape from a saved request and validate it through contract. */
  const response = (
    request: IRpcRequestEnvelope,
    result: unknown,
    error?: IRpcSerializedError
  ): void => {
    /** The saved request is the only authority for inverse response routing. */
    const route = request.data.route
    /** Build response routing without forwarding peer-controlled local metadata. */
    const data = {
      route: {
        profile: route.profile,
        type: RpcRouteType.response,
        applicationVersion: route.applicationVersion,
        senderId: route.targetId,
        targetId: route.senderId,
        sentAt: options.wallClock.timestamp(),
        method: request.method,
        receiverId: route.senderId
      },
      ...(error ? {} : { payload: result })
    }
    /** Contract validation remains the sole internal envelope grammar owner. */
    const envelope = normalizeRpcEnvelope(
      error
        ? {
            kind: RpcEnvelopeKind.response,
            ok: false,
            id: request.id,
            code: error.code,
            message: error.message,
            error,
            data
          }
        : { kind: RpcEnvelopeKind.response, ok: true, id: request.id, data }
    )
    for (const listener of listeners)
      reportListenerFailure(
        {
          data: objectListeners.has(listener)
            ? materializeJsonSnapshot(envelope)
            : JSON.stringify(envelope),
          peerId: options.peerId
        },
        [(value) => listener(value as IRpcInboundMessage)],
        failures
      )
  }

  /** Apply IB1–IB7 in order before allowing any response to settle one pending request. */
  const receiveOne = (value: unknown): void => {
    if (closed) return
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid)
    /** Profile checks below operate on this single parsed response object. */
    const message = value as Record<string, unknown>
    if (
      message.jsonrpc !== JsonRpcProfile.version ||
      Object.hasOwn(message, 'method') ||
      !Object.hasOwn(message, 'id') ||
      (message.id !== null && typeof message.id !== 'string' && typeof message.id !== 'number')
    )
      throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid)
    /** Exactly one result/error slot can settle a correlated response. */
    const hasError = Object.hasOwn(message, 'error')
    if (
      hasError === Object.hasOwn(message, 'result') ||
      (hasError &&
        (!message.error ||
          typeof message.error !== 'object' ||
          Array.isArray(message.error) ||
          !Number.isSafeInteger((message.error as { code?: unknown }).code) ||
          typeof (message.error as { message?: unknown }).message !== 'string'))
    )
      throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid)
    if (message.id === null)
      throw createJsonRpcBridgeError(
        JsonRpcBridgeErrorCode.profileInvalid,
        hasError ? deserializeRpcError(fromJsonRpcError(message.error)) : undefined
      )
    if (helloPending && message.id === JsonRpcProfile.hello) {
      helloPending = false
      if (hasError) {
        /** Hello errors bypass core while retaining the canonical foreign graph. */
        const foreign = deserializeRpcError(fromJsonRpcError(message.error))
        helloResult.reject(
          createJsonRpcBridgeError(
            (message.error as { code: number }).code === JsonRpcErrorNumber.methodNotFound
              ? JsonRpcBridgeErrorCode.extensionMissing
              : JsonRpcBridgeErrorCode.profileInvalid,
            foreign
          )
        )
      } else helloResult.resolve(message.result)
      return
    }
    /** Only a locally retained string id can select a pending invocation. */
    const request = typeof message.id === 'string' ? pending.get(message.id) : undefined
    if (!request) {
      report(createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid))
      return
    }
    pending.delete(request.id)
    try {
      if (hasError)
        response(
          request,
          undefined,
          wireError(message.error, request.method === RemoteMethodName.describe)
        )
      else {
        if (request.method === RemoteMethodName.describe)
          validateJsonRpcDescription(options.target, message.result)
        response(request, message.result)
      }
    } catch (cause) {
      /** Describe contract/mode errors retain their canonical remote/bridge identity for rollback. */
      const preserve =
        cause instanceof Error &&
        'code' in cause &&
        (cause.code === JsonRpcBridgeErrorCode.extensionMissing ||
          cause.code === JsonRpcBridgeErrorCode.unsupportedMode ||
          cause.code === RpcRemoteLayerErrorCode.contractInvalid)
      /** Protocol wrapping keeps description rollback identities intact. */
      const error = preserve
        ? cause
        : createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid, cause)
      report(error)
      response(
        request,
        undefined,
        serializeRpcError(error, { report: ({ error: failure }) => report(failure) })
      )
    }
  }

  /** Negotiated arrays preserve each original IB1–IB7 admission and isolate malformed siblings. */
  const receive = (value: unknown): void => {
    if (!Array.isArray(value)) return receiveOne(value)
    if (!batch || helloPending || value.length === 0)
      throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid)
    for (const member of value) {
      try {
        receiveOne(member)
      } catch (error) {
        report(error)
      }
    }
  }

  try {
    removals.push(
      options.byte.onData((chunk) => {
        if (closed) return
        try {
          for (const value of decoder.push(chunk)) {
            if (closed) break
            receive(value)
          }
        } catch (error) {
          fail(error)
        }
      })
    )
    removals.push(
      options.byte.onClose((reason) => {
        if (closed) return
        try {
          decoder.finish()
        } catch (error) {
          fail(error)
          return
        }
        void close(
          reason === undefined
            ? undefined
            : createProcessError(RpcProcessErrorCode.channelClosed, reason)
        ).catch(report)
      })
    )
    /** Caller cancellation keeps its original reason, particularly before channel publication. */
    const onAbort = (): void => {
      void close(
        options.signal === undefined ? undefined : resolveAbortReason(options.signal)
      ).catch(report)
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    removals.push(() => options.signal?.removeEventListener('abort', onAbort))
    if (options.signal?.aborted) onAbort()
  } catch (error) {
    void close(error).catch(report)
    throw error
  }

  /** One translation owner retains correlation and metadata semantics for single or batch requests. */
  const translate = (value: unknown): Record<string, unknown> | undefined => {
    /** Each semantic member receives the original portable contract admission. */
    const envelope = normalizeRpcEnvelope(value)
    if (
      envelope.kind === RpcEnvelopeKind.variation &&
      envelope.data.route.variation === RpcControl.abort
    ) {
      if (!pending.has(envelope.id)) return
      pending.delete(envelope.id)
      return {
        jsonrpc: JsonRpcProfile.version,
        method: JsonRpcProfile.cancel,
        params: {
          id: envelope.id,
          ...(envelope.data.payload === undefined ? {} : { reason: envelope.data.payload })
        }
      }
    }
    if (envelope.kind !== RpcEnvelopeKind.request || !Array.isArray(envelope.data.payload ?? []))
      throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid, undefined, true)
    /** Metadata projection reads only the normalized request routing contract. */
    const route = envelope.data.route
    /** Remote describe is the only reserved method translated to a distinct extension. */
    const describe = envelope.method === RemoteMethodName.describe
    /** Dispatch ownership, rather than contract lookup, decides whether an id is emitted. */
    const oneWay = route.dispatchOnly === true
    if (!oneWay && pending.has(envelope.id))
      throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid, undefined, true)
    /** Preserve exactly the three contract metadata keys that are present at gate dispatch. */
    const meta = Object.fromEntries(
      [RpcRouteField.timeoutMs, RpcRouteField.idempotencyKey, RpcRouteField.trace]
        .filter((key) => Object.hasOwn(route, key))
        .map((key) => [key, route[key as keyof typeof route]])
    )
    /** Describe and invoke preserve positional payloads without a second method resolver. */
    const params = describe
      ? { args: envelope.data.payload ?? [] }
      : {
          method: envelope.method,
          args: envelope.data.payload ?? [],
          ...(!oneWay && Object.keys(meta).length > 0 ? { meta } : {})
        }
    if (!oneWay) pending.set(envelope.id, envelope)
    return {
      jsonrpc: JsonRpcProfile.version,
      ...(!oneWay ? { id: envelope.id } : {}),
      method: describe ? JsonRpcProfile.describe : JsonRpcProfile.invoke,
      params
    }
  }

  /** Both public and private inputs share one whole physical write and one correlation owner. */
  const send = async (
    value: unknown,
    sendOptions?: import('../../core/transport.js').IRpcSendOptions,
    objectInput = false
  ): Promise<void> => {
    if (closed) throw terminal
    if (sendOptions?.transfer?.length || (!objectInput && typeof value !== 'string'))
      throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid, undefined, true)
    /** Public strings are parsed once; only negotiated internal wrappers become JSON-RPC arrays. */
    const decoded = objectInput ? value : (JSON.parse(value as string) as unknown)
    const members = batch ? readRpcBatchMembers(decoded) : undefined
    if (!members) {
      const message = translate(decoded)
      if (message) await write(message)
      return
    }
    /** Outbound semantic members have already been admitted by core; translate in FIFO order. */
    const messages = members.map(translate).filter((message) => message !== undefined)
    if (messages.length) await write(messages)
  }

  /** Metadata and ownership describe the logical single-peer connection rather than its process. */
  const transport: IRpcTransport = {
    platform: RpcPlatform.process,
    topology: RpcTransportTopology.exclusive,
    ownership: RpcTransportOwnership.owned,
    encodedType: RpcTransportEncoding.string,
    peerId: options.peerId,
    send(value, sendOptions) {
      return send(value, sendOptions)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    onTransportError(listener) {
      errorListeners.add(listener)
      if (closed) listener(terminal)
      return () => {
        errorListeners.delete(listener)
      }
    },
    close: () => close(),
    get closed() {
      return closed
    }
  }
  return {
    transport,
    sendObject: (value, sendOptions) => send(value, sendOptions, true),
    subscribeObject: (listener) => {
      objectListeners.add(listener)
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        objectListeners.delete(listener)
      }
    },
    registerObjectPortRelease: (release) => {
      if (closed) release()
      else releaseObjectPort = release
    },
    setCapabilities(capabilities) {
      batch = capabilities.includes(RpcCapability.batch)
    },
    async exchangeHello(hello) {
      await write({
        jsonrpc: JsonRpcProfile.version,
        id: JsonRpcProfile.hello,
        method: JsonRpcProfile.hello,
        params: { hello }
      })
      return helloResult.promise
    },
    close,
    assertOpen() {
      if (closed) throw terminal
    },
    get closed() {
      return closed
    }
  }
}
