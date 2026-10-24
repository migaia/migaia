import { materializeAdapterJson } from '@migaia/rpc-host/plugin'
import type { IRpcCarrierProbe } from '@migaia/rpc-host/probe'
import { RpcProbeDirection } from '@migaia/rpc-host/probe'
import { RpcCarrierDetailKey } from '@migaia/rpc-host/plugin'
import { RpcAdapterErrorText } from '@migaia/rpc-host/plugin'
import { createRpcTransportError } from '@migaia/rpc-host/plugin'
import { readAdapterAbortReason } from '@migaia/rpc-host/plugin'
import { deferred } from '@migaia/utils/promise'
import { deserializeRpcError, serializeRpcError } from '@migaia/rpc-host/plugin'
import { fromJsonRpcError } from '@migaia/rpc-contract'
import { toJsonRpcError } from '@migaia/rpc-contract/errors'
import { normalizeRpcEnvelope } from '@migaia/rpc-contract'
import type { IRpcRequestEnvelope } from '@migaia/rpc-contract'
import type { IRpcSerializedError } from '@migaia/rpc-contract'
import {
  RpcControl,
  RpcCapability,
  RpcEnvelopeKind,
  RpcRouteField,
  RpcRouteType
} from '@migaia/rpc-contract'
import { RpcRouteProfile } from '@migaia/rpc-contract'
import { RpcJsonRpcWireError } from '@migaia/rpc-contract'
import {
  collectListenerCleanupFailures,
  createListenerFailureState,
  reportListenerFailure,
  drainTerminalListenerFailures
} from '@migaia/rpc-host/plugin'
import type { IRpcTransport, IRpcSendOptions } from '@migaia/rpc-host/plugin'
import type { IRuntimeObjectIO } from '@migaia/rpc-host/plugin'
import { RemoteMethodName } from '@migaia/rpc-host/plugin'
import { RpcRemoteLayerErrorCode } from '@migaia/rpc-host/plugin'
import { JsonRpcProfile, JsonRpcErrorNumber } from '@migaia/rpc-host/plugin'
import { readRpcBatchMembers } from '@migaia/rpc-contract/framing'
import { JsonRpcBridgeErrorCode } from '@migaia/rpc-contract/framing/jsonrpc'
import { createJsonRpcBridgeError } from '@migaia/rpc-host/plugin'
import { createJsonRpcFrameDecoder, encodeJsonRpcFrame } from '@migaia/rpc-contract/framing/jsonrpc'
import {
  validateJsonRpcDescription,
  type IAdapterJsonRpcChannelOptions
} from '@migaia/rpc-host/plugin'

/** The factory holds actual wire I/O and the pre-ready correlation; Core constructs the transport. */
export type IJsonRpcWire = Pick<
  IRuntimeObjectIO,
  | 'writeText'
  | 'writeObject'
  | 'subscribeText'
  | 'subscribeObject'
  | 'onTransportError'
  | 'onClosing'
  | 'observe'
> &
  Readonly<{
    /** Completed hello intersection alone enables JSON-RPC arrays after negotiation. */
    setCapabilities(capabilities: readonly string[]): void
    exchangeHello(hello: string): Promise<unknown>
    close(reason?: unknown): Promise<void>
    assertOpen(): void
    readonly closed: boolean
  }>

/** Inbound records retain the ordinary public transport subscriber contract. */
type IJsonRpcInboundMessage = Parameters<Parameters<IRpcTransport['subscribe']>[0]>[0]

/** Bind raw bytes once, translate logical envelopes, and keep all correlation connection-local. */
/** Allocate connection-local wire state before physical callbacks can reenter construction. */
function jsonRpcWireState(
  options: IAdapterJsonRpcChannelOptions,
  closedError: (cause?: unknown) => Error
) {
  /** Whole-envelope requests are retained only until response, cancel or connection release. */
  const pending = new Map<string, IRpcRequestEnvelope>()
  /** Authenticated inbound ids belong only to this physical connection and canonical provider. */
  const incoming = new Map<string, { wireId: string | number; method: string }>()
  /** Reverse correlation makes batch admission and cancellation linear in member count. */
  const incomingIds = new Map<string | number, string>()
  /** Local monotonic ids prevent foreign ids from aliasing locally initiated correlations. */
  let incomingSequence = 0
  /** Incoming requests become admissible only after the actual completed hello intersection. */
  let incomingReady = false
  /** The one handshake promise exists before a synchronous peer can deliver its response. */
  const helloResult = deferred<unknown>()
  /** An observed rejection prevents connection failure before exchange from becoming unhandled. */
  void helloResult.promise.catch(() => undefined)
  /** Listener and reporter cleanup uses the shared adapter failure collector. */
  const failures = createListenerFailureState()
  /** Only this logical connection owns inbound response subscribers. */
  const listeners = new Set<(message: IJsonRpcInboundMessage) => void>()
  /** Distinguishes private subscribers without changing Set identity or traversal semantics. */
  const objectListeners = new WeakSet<(message: IJsonRpcInboundMessage) => void>()
  /** Final wrapper's capability disposer is set only after successful IPC adoption. */
  const closingObserver = undefined as (() => void) | undefined
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
  /** Physical JSON-RPC observation uses already translated or parsed values, never another encoding. */
  const probe = undefined as IRpcCarrierProbe | undefined
  /** Replacement keeps each observer release scoped to its exact installation. */
  let probeGeneration = 0
  /** Both directions borrow fixed detail storage; parser-owned values are never copied or scanned. */
  const outboundDetail: Record<string, string | number | boolean> = {
    [RpcCarrierDetailKey.batchSize]: 0
  }
  /** Receiving cannot overwrite an outbound observation while its synchronous callback is active. */
  const inboundDetail: Record<string, string | number | boolean> = {
    [RpcCarrierDetailKey.batchSize]: 0
  }
  /** Preserve the first terminal reason, especially the caller abort instance. */
  const terminal = undefined as unknown
  /** Concurrent close callers join the same resource cleanup Promise. */
  const closing = undefined as Promise<void> | undefined
  /** Before hello settlement, any response must belong to its fixed correlation id. */
  let helloPending = true
  /** False before hello and when the peer did not explicitly negotiate physical batch support. */
  let batch = false

  return {
    pending,
    incoming,
    incomingIds,
    incomingSequence,
    incomingReady,
    helloResult,
    failures,
    listeners,
    objectListeners,
    closingObserver: closingObserver as (() => void) | undefined,
    errorListeners,
    writes,
    removals,
    decoder,
    closed,
    probe: probe as IRpcCarrierProbe | undefined,
    probeGeneration,
    outboundDetail,
    inboundDetail,
    terminal,
    closing: closing as Promise<void> | undefined,
    helloPending,
    batch,
    options,
    closedError
  }
}

/** Own physical subscriptions and the sole bidirectional JSON-RPC correlation for one connection. */
class JsonRpcWire {
  /** No request, listener or write receipt is shared with another connection. */
  #state: ReturnType<typeof jsonRpcWireState>
  /** The original wire surface remains stable until this connection closes. */
  readonly value: IJsonRpcWire
  /** Bind physical callbacks after state and all translation methods are initialized. */
  constructor(options: IAdapterJsonRpcChannelOptions, closedError: (cause?: unknown) => Error) {
    this.#state = jsonRpcWireState(options, closedError)
    try {
      this.#state.removals.push(
        this.#state.options.byte.onData((chunk) => {
          if (this.#state.closed) return
          try {
            for (const value of this.#state.decoder.push(chunk)) {
              if (this.#state.closed) break
              this.#receive(value)
            }
          } catch (error) {
            this.#fail(error)
          }
        })
      )
      this.#state.removals.push(
        this.#state.options.byte.onClose((reason) => {
          if (this.#state.closed) return
          try {
            this.#state.decoder.finish()
          } catch (error) {
            this.#fail(error)
            return
          }
          void this.#close(
            reason === undefined ? undefined : (0, this.#state.closedError)(reason)
          ).catch(this.#report)
        })
      )
      /** Caller cancellation keeps its original reason, particularly before channel publication. */
      const onAbort = (): void => {
        void this.#close(
          this.#state.options.signal === undefined
            ? undefined
            : readAdapterAbortReason(this.#state.options.signal)
        ).catch(this.#report)
      }
      this.#state.options.signal?.addEventListener('abort', onAbort, { once: true })
      this.#state.removals.push(() =>
        this.#state.options.signal?.removeEventListener('abort', onAbort)
      )
      if (this.#state.options.signal?.aborted) onAbort()
    } catch (error) {
      void this.#close(error).catch(this.#report)
      throw error
    }
    this.value = {
      observe: (next) => {
        /** The same probe can be reinstalled without transferring ownership to old disposers. */
        const generation = ++this.#state.probeGeneration
        if (!this.#state.closed) this.#state.probe = next
        return () => {
          if (generation === this.#state.probeGeneration) this.#state.probe = undefined
        }
      },
      writeText: (value, sendOptions) => this.#send(value, sendOptions),
      writeObject: (value, sendOptions) => this.#send(value, sendOptions, true),
      subscribeText: (listener) => {
        this.#state.listeners.add(listener)
        return () => {
          this.#state.listeners.delete(listener)
        }
      },
      subscribeObject: (listener) => {
        this.#state.objectListeners.add(listener)
        this.#state.listeners.add(listener)
        return () => {
          this.#state.listeners.delete(listener)
          this.#state.objectListeners.delete(listener)
        }
      },
      onTransportError: (listener) => {
        this.#state.errorListeners.add(listener)
        if (this.#state.closed) listener(this.#state.terminal)
        return () => {
          this.#state.errorListeners.delete(listener)
        }
      },
      onClosing: (listener) => {
        if (this.#state.closed) listener()
        else this.#state.closingObserver = listener
        return () => {
          if (this.#state.closingObserver === listener) this.#state.closingObserver = undefined
        }
      },
      setCapabilities: (capabilities) => {
        this.#state.incomingReady = true
        this.#state.batch = capabilities.includes(RpcCapability.batch)
      },
      exchangeHello: async (hello) => {
        await this.#write({
          jsonrpc: JsonRpcProfile.version,
          id: JsonRpcProfile.hello,
          method: JsonRpcProfile.hello,
          params: { hello }
        })
        return this.#state.helloResult.promise
      },
      close: this.#close,
      assertOpen: () => {
        if (this.#state.closed) throw this.#state.terminal
      },
      closed: false
    }
    Object.defineProperties(this.value, { closed: { get: () => this.#state.closed } })
  }
  /** Observe report failures without replacing the primary protocol failure. */
  #report = (error: unknown): void =>
    reportListenerFailure(error, [this.#state.options.report], this.#state.failures)

  /** One physical batch emits one event; individual ids are available only for ordinary objects. */
  #observe = (direction: number, value: unknown, size: number): void => {
    if (this.#state.probe === undefined || this.#state.closed) return
    /** Existing parser/translation values supply these public wire fields at the real boundary. */
    const message = value as { id?: unknown; method?: unknown }
    try {
      /** Fixed public detail fields are assembled without spreads or per-member traversal. */
      const detail =
        direction === RpcProbeDirection.outbound
          ? this.#state.outboundDetail
          : this.#state.inboundDetail
      detail[RpcCarrierDetailKey.batchSize] = Array.isArray(value) ? value.length : 1
      if (typeof message.id === 'string' || typeof message.id === 'number')
        detail[RpcCarrierDetailKey.jsonrpcId] = message.id
      else delete detail[RpcCarrierDetailKey.jsonrpcId]
      if (typeof message.method === 'string')
        detail[RpcCarrierDetailKey.jsonrpcMethod] = message.method
      else delete detail[RpcCarrierDetailKey.jsonrpcMethod]
      this.#state.probe.emit(
        direction,
        size,
        JsonRpcProfile.carrier,
        detail,
        this.#state.probe.capturing ? value : undefined
      )
    } catch (cause) {
      this.#report(createRpcTransportError(RpcAdapterErrorText.probeFailed, cause))
    }
  }

  /** Commit terminal state before callbacks, then release every physical resource exactly once. */
  #close = (reason?: unknown): Promise<void> => {
    if (this.#state.closing) return this.#state.closing
    this.#state.closed = true
    this.#state.probe = undefined
    ;(0, this.#state.closingObserver)?.()
    this.#state.closingObserver = undefined
    this.#state.terminal = reason ?? (0, this.#state.closedError)()
    this.#state.decoder.close()
    this.#state.pending.clear()
    this.#state.incoming.clear()
    this.#state.incomingIds.clear()
    this.#state.helloResult.reject(this.#state.terminal)
    for (const reject of this.#state.writes) reject(this.#state.terminal)
    this.#state.writes.clear()
    /** Schedule cleanup after registration has returned its removers, including synchronous EOF. */
    this.#state.closing = Promise.resolve().then(async () => {
      /** Collect every physical disposer failure without interrupting later cleanup. */
      const cleanup = collectListenerCleanupFailures(this.#state.removals)
      this.#state.removals.length = 0
      try {
        await this.#state.options.byte.close()
      } catch (error) {
        cleanup.push(error)
      }
      for (const error of cleanup) this.#report(error)
      this.#state.listeners.clear()
      this.#state.errorListeners.clear()
      if (
        cleanup.length > 0 ||
        this.#state.failures.failures.length > 0 ||
        this.#state.failures.pending.size > 0
      )
        await drainTerminalListenerFailures([this.#state.terminal, ...cleanup], {
          secondaryFailures: this.#state.failures,
          aggregateSingle: true
        })
    })
    for (const listener of this.#state.errorListeners)
      reportListenerFailure(this.#state.terminal, [listener], this.#state.failures)
    return this.#state.closing
  }

  /** Async event failures are reported once while all pending work follows transport termination. */
  #fail = (error: unknown): void => {
    if (this.#state.closed) return
    this.#report(error)
    void this.#close(error).catch(this.#report)
  }

  /** One complete JSON-RPC object corresponds to one drain-aware physical byte write. */
  #write = (value: unknown): Promise<void> => {
    if (this.#state.closed) return Promise.reject(this.#state.terminal)
    /** Frame encoding happens once before handing the whole object to the writer. */
    const frame = encodeJsonRpcFrame(value)
    if (this.#state.probe !== undefined)
      this.#observe(RpcProbeDirection.outbound, value, frame.byteLength)
    return new Promise<void>((resolve, reject) => {
      /** The terminal callback stays registered until the physical Promise has settled. */
      const abortWrite = (error: unknown): void => reject(error)
      this.#state.writes.add(abortWrite)
      /** Only negotiated whole-frame writes remove the legacy deferred physical handoff. */
      const invoke = () => {
        if (this.#state.closed) throw this.#state.terminal
        return this.#state.options.byte.write(frame)
      }
      let result: void | Promise<void>
      if (this.#state.batch) {
        try {
          result = invoke()
        } catch (error) {
          result = Promise.reject(error)
        }
      } else result = Promise.resolve().then(invoke)
      void Promise.resolve(result).then(
        () => {
          this.#state.writes.delete(abortWrite)
          resolve()
        },
        (cause: unknown) => {
          /** Late physical rejection is secondary once another event committed closure. */
          const alreadyClosed = this.#state.closed
          this.#state.writes.delete(abortWrite)
          /**
           * IO failure keeps its original instance reachable through the physical owner's existing
           * closed-error cause.
           */
          const error = (0, this.#state.closedError)(cause)
          reject(error)
          if (alreadyClosed) this.#report(error)
          else this.#fail(error)
        }
      )
    })
  }

  /** Translate the wire error graph; absent business extension fails only the correlated call. */
  #wireError = (value: unknown, describe: boolean): IRpcSerializedError => {
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
  #response = (
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
        sentAt: this.#state.options.wallClock.timestamp(),
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
    for (const listener of this.#state.listeners)
      reportListenerFailure(
        {
          data: this.#state.objectListeners.has(listener)
            ? materializeAdapterJson(envelope)
            : JSON.stringify(envelope),
          peerId: this.#state.options.peerId
        },
        [(value) => listener(value as IJsonRpcInboundMessage)],
        this.#state.failures
      )
  }

  /**
   * Apply every inbound admission check in order before allowing any response to settle one pending
   * request.
   */
  #receiveOne = (value: unknown): void => {
    if (this.#state.closed) return
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid)
    /** Profile checks below operate on this single parsed response object. */
    const message = value as Record<string, unknown>
    if (Object.hasOwn(message, 'method')) return this.#receiveIncoming(message)
    this.#receiveResponse(message)
  }

  /** Translate one authenticated inbound cancellation using its original connection correlation. */
  #receiveCancel = (message: Record<string, unknown>): void => {
    /** Describe and invoke preserve positional payloads without a second method resolver. */
    const params = message.params as Record<string, unknown>
    if (
      !this.#state.incomingReady ||
      message.jsonrpc !== JsonRpcProfile.version ||
      Object.hasOwn(message, 'id') ||
      Object.hasOwn(message, 'result') ||
      Object.hasOwn(message, 'error') ||
      Object.keys(message).some((key) => !['jsonrpc', 'method', 'params'].includes(key)) ||
      !params ||
      typeof params !== 'object' ||
      Array.isArray(params) ||
      Object.keys(params).some((key) => !['id', 'reason'].includes(key)) ||
      (typeof params.id !== 'string' && typeof params.id !== 'number')
    )
      throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid)
    /** Cancellation selects only this authenticated connection's original correlation. */
    const originalId = this.#state.incomingIds.get(params.id as string | number)
    /** Cancellation selects only this authenticated connection's original correlation. */
    const original =
      originalId === undefined
        ? undefined
        : ([originalId, this.#state.incoming.get(originalId)!] as const)
    if (!original) return
    const envelope = normalizeRpcEnvelope({
      kind: RpcEnvelopeKind.variation,
      id: original[0],
      data: {
        route: {
          profile: RpcRouteProfile,
          type: RpcRouteType.variation,
          applicationVersion: JsonRpcProfile.applicationVersion,
          senderId: this.#state.options.peerId,
          targetId: this.#state.options.offer.peer.id,
          receiverId: this.#state.options.offer.peer.id,
          sentAt: this.#state.options.wallClock.timestamp(),
          variation: RpcControl.abort
        },
        ...(Object.hasOwn(params, 'reason') ? { payload: params.reason } : {})
      }
    })
    for (const listener of this.#state.listeners)
      reportListenerFailure(
        {
          data: this.#state.objectListeners.has(listener)
            ? materializeAdapterJson(envelope)
            : JSON.stringify(envelope),
          peerId: this.#state.options.peerId
        },
        [(value) => listener(value as IJsonRpcInboundMessage)],
        this.#state.failures
      )
    /** The cancelling caller settles locally; Core discards the expired provider outcome. */
    this.#state.incoming.delete(original[0])
    this.#state.incomingIds.delete(original[1].wireId)
    return
  }

  /** Validate and mint one inbound request, retaining its one canonical wire-id correlation. */
  #receiveIncoming = (message: Record<string, unknown>): void => {
    if (message.method === JsonRpcProfile.cancel) return this.#receiveCancel(message)

    if (
      !this.#state.incomingReady ||
      message.jsonrpc !== JsonRpcProfile.version ||
      (message.method !== JsonRpcProfile.invoke && message.method !== JsonRpcProfile.describe) ||
      Object.hasOwn(message, 'result') ||
      Object.hasOwn(message, 'error') ||
      (Object.hasOwn(message, 'id') &&
        typeof message.id !== 'string' &&
        typeof message.id !== 'number') ||
      Object.keys(message).some((key) => !['jsonrpc', 'id', 'method', 'params'].includes(key))
    )
      throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid)
    /** Describe and invoke preserve positional payloads without a second method resolver. */
    const params = message.params as Record<string, unknown>
    if (
      !params ||
      typeof params !== 'object' ||
      Array.isArray(params) ||
      !Array.isArray(params.args) ||
      Object.keys(params).some((key) => !['method', 'args', 'meta'].includes(key))
    )
      throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid)
    const method =
      message.method === JsonRpcProfile.describe ? RemoteMethodName.runtimeDescribe : params.method
    if (
      typeof method !== 'string' ||
      !method.length ||
      (message.method === JsonRpcProfile.invoke && method.startsWith('migaia.remote.'))
    )
      throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid)
    /** Preserve exactly the three contract metadata keys that are present at gate dispatch. */
    const meta = (params.meta ?? {}) as Record<string, unknown>
    if (
      !meta ||
      typeof meta !== 'object' ||
      Array.isArray(meta) ||
      Object.keys(meta).some(
        (key) =>
          key !== RpcRouteField.timeoutMs &&
          key !== RpcRouteField.idempotencyKey &&
          key !== RpcRouteField.trace
      )
    )
      throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid)
    if (Object.hasOwn(message, 'id') && this.#state.incomingIds.has(message.id as string | number))
      throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid)
    const id = JsonRpcProfile.incomingIdPrefix + ++this.#state.incomingSequence
    /** Dispatch ownership, rather than contract lookup, decides whether an id is emitted. */
    const oneWay = !Object.hasOwn(message, 'id')
    /** The original strict contract remains foreign-input admission and portable normalization. */
    const envelope = normalizeRpcEnvelope({
      kind: RpcEnvelopeKind.request,
      id,
      method,
      data: {
        route: {
          profile: RpcRouteProfile,
          type: RpcRouteType.request,
          applicationVersion: JsonRpcProfile.applicationVersion,
          senderId: this.#state.options.peerId,
          targetId: this.#state.options.offer.peer.id,
          receiverId: this.#state.options.offer.peer.id,
          sentAt: this.#state.options.wallClock.timestamp(),
          ...meta,
          ...(oneWay ? { dispatchOnly: true } : {})
        },
        payload: params.args
      }
    })
    if (!oneWay) {
      this.#state.incoming.set(id, { wireId: message.id as string | number, method })
      this.#state.incomingIds.set(message.id as string | number, id)
    }
    for (const listener of this.#state.listeners)
      reportListenerFailure(
        {
          data: this.#state.objectListeners.has(listener)
            ? materializeAdapterJson(envelope)
            : JSON.stringify(envelope),
          peerId: this.#state.options.peerId
        },
        [(value) => listener(value as IJsonRpcInboundMessage)],
        this.#state.failures
      )
    return
  }

  /** Admit one response and settle only its saved local request or hello receipt. */
  #receiveResponse = (message: Record<string, unknown>): void => {
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
    if (this.#state.helloPending && message.id === JsonRpcProfile.hello) {
      this.#state.helloPending = false
      if (hasError) {
        /** Hello errors bypass core while retaining the canonical foreign graph. */
        const foreign = deserializeRpcError(fromJsonRpcError(message.error))
        this.#state.helloResult.reject(
          createJsonRpcBridgeError(
            (message.error as { code: number }).code === JsonRpcErrorNumber.methodNotFound
              ? JsonRpcBridgeErrorCode.extensionMissing
              : JsonRpcBridgeErrorCode.profileInvalid,
            foreign
          )
        )
      } else this.#state.helloResult.resolve(message.result)
      return
    }
    /** Only a locally retained string id can select a pending invocation. */
    const request = typeof message.id === 'string' ? this.#state.pending.get(message.id) : undefined
    if (!request) {
      this.#report(createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid))
      return
    }
    this.#state.pending.delete(request.id)
    try {
      if (hasError)
        this.#response(
          request,
          undefined,
          this.#wireError(message.error, request.method === RemoteMethodName.runtimeDescribe)
        )
      else {
        if (request.method === RemoteMethodName.runtimeDescribe)
          validateJsonRpcDescription(message.result)
        this.#response(request, message.result)
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
      this.#report(error)
      this.#response(
        request,
        undefined,
        serializeRpcError(error, { report: ({ error: failure }) => this.#report(failure) })
      )
    }
  }

  /** Negotiated arrays preserve each original inbound admission and isolate malformed siblings. */
  #receive = (value: unknown): void => {
    if (this.#state.probe !== undefined) this.#observe(RpcProbeDirection.inbound, value, -1)
    if (!Array.isArray(value)) return this.#receiveOne(value)
    if (!this.#state.batch || this.#state.helloPending || value.length === 0)
      throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid)
    for (const member of value) {
      try {
        this.#receiveOne(member)
      } catch (error) {
        this.#report(error)
      }
    }
  }

  /** One translation owner retains correlation and metadata semantics for single or batch requests. */
  #translate = (value: unknown): Record<string, unknown> | undefined => {
    /** Each semantic member receives the original portable contract admission. */
    const envelope = normalizeRpcEnvelope(value)
    if (envelope.kind === RpcEnvelopeKind.response) {
      /** Cancellation selects only this authenticated connection's original correlation. */
      const original = this.#state.incoming.get(envelope.id)
      if (
        !original ||
        envelope.data.route.method !== original.method ||
        envelope.data.route.senderId !== this.#state.options.offer.peer.id ||
        envelope.data.route.targetId !== this.#state.options.peerId
      )
        throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid, undefined, true)
      if (!envelope.ok && envelope.error === undefined)
        throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid, undefined, true)
      this.#state.incoming.delete(envelope.id)
      this.#state.incomingIds.delete(original.wireId)
      return {
        jsonrpc: JsonRpcProfile.version,
        id: original.wireId,
        ...(envelope.ok
          ? { result: envelope.data.payload ?? null }
          : { error: toJsonRpcError(envelope.error!, JsonRpcErrorNumber.business) })
      }
    }

    if (
      envelope.kind === RpcEnvelopeKind.variation &&
      envelope.data.route.variation === RpcControl.abort
    ) {
      if (!this.#state.pending.has(envelope.id)) return
      this.#state.pending.delete(envelope.id)
      return {
        jsonrpc: JsonRpcProfile.version,
        method: JsonRpcProfile.cancel,
        params: {
          id: envelope.id,
          ...(envelope.data.payload === undefined ? {} : { reason: envelope.data.payload })
        }
      }
    }
    if (envelope.kind !== RpcEnvelopeKind.request) {
      throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid, undefined, true)
    }
    /** Metadata projection reads only the normalized request routing contract. */
    const route = envelope.data.route
    /** Remote describe is the only reserved method translated to a distinct extension. */
    const describe = envelope.method === RemoteMethodName.runtimeDescribe
    /**
     * Native startup metadata belongs to Core; foreign describe remains the empty positional
     * extension.
     */
    if (!describe && !Array.isArray(envelope.data.payload ?? []))
      throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid, undefined, true)
    /** Dispatch ownership, rather than contract lookup, decides whether an id is emitted. */
    const oneWay = route.dispatchOnly === true
    if (!oneWay && this.#state.pending.has(envelope.id))
      throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid, undefined, true)
    /** Preserve exactly the three contract metadata keys that are present at gate dispatch. */
    const meta = Object.fromEntries(
      [RpcRouteField.timeoutMs, RpcRouteField.idempotencyKey, RpcRouteField.trace]
        .filter((key) => Object.hasOwn(route, key))
        .map((key) => [key, route[key as keyof typeof route]])
    )
    /** Describe and invoke preserve positional payloads without a second method resolver. */
    const params = describe
      ? { args: [] }
      : {
          method: envelope.method,
          args: envelope.data.payload ?? [],
          ...(!oneWay && Object.keys(meta).length > 0 ? { meta } : {})
        }
    if (!oneWay) this.#state.pending.set(envelope.id, envelope)
    return {
      jsonrpc: JsonRpcProfile.version,
      ...(!oneWay ? { id: envelope.id } : {}),
      method: describe ? JsonRpcProfile.describe : JsonRpcProfile.invoke,
      params
    }
  }

  /** Both public and private inputs share one whole physical write and one correlation owner. */
  #send = async (
    value: unknown,
    sendOptions?: IRpcSendOptions,
    objectInput = false
  ): Promise<void> => {
    if (this.#state.closed) throw this.#state.terminal
    if (sendOptions?.transfer?.length || (!objectInput && typeof value !== 'string'))
      throw createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid, undefined, true)
    /** Public strings are parsed once; only negotiated internal wrappers become JSON-RPC arrays. */
    const decoded = objectInput ? value : (JSON.parse(value as string) as unknown)
    const members = this.#state.batch ? readRpcBatchMembers(decoded) : undefined
    if (!members) {
      const message = this.#translate(decoded)
      if (message) await this.#write(message)
      return
    }
    /** Outbound semantic members have already been admitted by core; translate in FIFO order. */
    const messages = members.map(this.#translate).filter((message) => message !== undefined)
    if (messages.length) await this.#write(messages)
  }
}

/** Bind raw bytes once and return the connection owner's stable wire surface. */
export function bindJsonRpcWire(
  options: IAdapterJsonRpcChannelOptions,
  closedError: (cause?: unknown) => Error
): IJsonRpcWire {
  return new JsonRpcWire(options, closedError).value
}
