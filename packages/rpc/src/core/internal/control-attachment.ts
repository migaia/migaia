import {
  RpcContractError,
  RpcError,
  RpcCoreErrorCode,
  RpcLifecycleError,
  RpcProtocolError,
  RpcTransportError
} from '../errors.js'
import { RpcCoreErrorText } from '../error-text.js'
import { authenticationReplyReceiverId } from './authentication-replay.js'
import {
  RpcControl,
  RpcRouteProfile,
  RpcWireLimit,
  type IRpcEnvelope
} from '../../contract/index.js'
import { RpcProtocolEvent } from '../protocol-constants.js'
import type { IRpcAbortSignal, IRpcFanoutResult } from '../typing.js'
import type { IRpcUuidConfig } from '../typing.js'
import type { IEndpointKernelHost } from '../endpoint-kernel.js'
import type { IPreparedEndpoint } from './endpoint-bootstrap.js'
import type {
  IRpcDiscoveryResolverPort,
  IRpcOutboundOperationsPort,
  IRpcTimePort,
  IRpcVariationCoordinatorPort
} from './plugin-shared-keys.js'
import { assertTimeout } from './outbound-attachment.js'
import { allocateRpcId } from './id.js'
import { createSafeRecord, fanoutDeliveryKey } from './safe-value.js'
import type { IEndpointTimer } from './time-port.js'

/** Caller-facing ping options mirroring the legacy per-call timeout/abort contract. */
type IPingOptions = {
  readonly timeoutMs?: number | false
  readonly signal?: IRpcAbortSignal
}

/** Exact shared ports consumed by the native control attachment. */
export type IRpcControlPorts = {
  readonly outboundOperations: IRpcOutboundOperationsPort
  readonly discoveryResolver: IRpcDiscoveryResolverPort
  readonly time: IRpcTimePort
  readonly variationCoordinator: IRpcVariationCoordinatorPort
}

/** Owns ping correlation and variation subhandlers without claiming a second variation route. */
export class RpcControlAttachment {
  /** Canonical endpoint lifecycle and owner registry; it exposes no outbound attachment state. */
  readonly #kernel: IEndpointKernelHost
  /** Four package-owned narrow ports used for all control behavior. */
  readonly #ports: IRpcControlPorts
  /** Immutable endpoint identifier snapshotted from the prepared construction result. */
  readonly #id: string
  /** Immutable fanout targets snapshotted before source configuration can mutate. */
  readonly #targetIds: readonly string[]
  /** Pending ping settlements keyed by task id. */
  readonly #pending = new Map<
    string,
    { resolve: (value: boolean) => void; timer?: IEndpointTimer }
  >()
  /** Release handles for the ping and pong variation subhandlers. */
  readonly #releaseVariations: readonly (() => void)[]
  /** True only when the `ping()` capability middleware selected this endpoint into ping. */
  readonly #pingEnabled: boolean
  /** Upper bound for `targetId`/`receiverId` length, shared with the canonical contract capability. */
  readonly #maxIdentifierLength: number
  /** Prepared UUID capability reused for collision-safe control correlation IDs. */
  readonly #uuid: IRpcUuidConfig
  /** Application contract version carried by canonical variation route metadata. */
  readonly #applicationVersion: string
  /** Resolves a per-call timeout override against the canonical timeout capability default. */
  readonly #resolveTimeout: (override?: number | false) => number | false | undefined

  /** Installs control owner through the outbound variation port. */
  constructor(
    kernel: IEndpointKernelHost,
    ports: IRpcControlPorts,
    prepared: IPreparedEndpoint<string>
  ) {
    this.#kernel = kernel
    this.#ports = ports
    this.#id = prepared.id
    this.#targetIds = Object.freeze([...(prepared.options.targetIds ?? [])])
    this.#pingEnabled = prepared.options.features?.ping === true
    this.#maxIdentifierLength = prepared.options.contract?.maxIdentifierLength ?? 128
    this.#uuid = prepared.options.uuid ?? {}
    this.#applicationVersion = prepared.options.contract?.version ?? '1.0.0'
    const timeout = prepared.options.timeout ?? {}
    const timeoutDefault = timeout.timeoutMs ?? 1000
    this.#resolveTimeout =
      'resolveTimeout' in timeout && timeout.resolveTimeout
        ? (timeout.resolveTimeout as (override?: number | false) => number | false | undefined)
        : (override) => (override === undefined ? timeoutDefault : override)
    const releases: Array<() => void> = []
    try {
      for (const [variation, handler] of [
        [
          RpcControl.ping,
          (message: unknown, peerKey: string) => this.#receivePing(message, peerKey)
        ],
        [
          RpcControl.pong,
          (message: unknown, peerKey: string) => this.#receivePong(message, peerKey)
        ],
        [
          RpcControl.close,
          (message: unknown, peerKey: string) => this.#receiveClose(message, peerKey)
        ]
      ] as const) {
        const release = ports.variationCoordinator.admit({
          operation: 'register',
          variation,
          handler
        })
        if (typeof release !== 'function')
          throw new RpcError(
            RpcCoreErrorCode.invalidConfig,
            RpcCoreErrorText.endpointModuleDependencyMissing
          )
        releases.push(release)
      }
      kernel.registerOwner('control-ping', this)
    } catch (error) {
      for (const release of releases.toReversed()) release()
      throw error
    }
    this.#releaseVariations = Object.freeze(releases)
  }

  /** Returns only control-owned operations; root event/hook ownership remains outbound-owned. */
  surface(): {
    ping: (targetId: string, receiverId?: string, options?: IPingOptions) => Promise<boolean>
    pingAll: () => Promise<IRpcFanoutResult<boolean>>
    announceClose: (
      targetId: string,
      options: { readonly drainMs: number; readonly receiverId?: string }
    ) => Promise<void>
    dispose: () => void
  } {
    return {
      ping: (targetId, receiverId, options) => this.ping(targetId, receiverId, options),
      pingAll: () => this.pingAll(),
      announceClose: (targetId, options) => this.announceClose(targetId, options),
      dispose: () => this.dispose()
    }
  }

  /** Send a close intention after a synchronous duration gate; channel drain remains host-owned. */
  announceClose(
    targetId: string,
    options: { readonly drainMs: number; readonly receiverId?: string }
  ): Promise<void> {
    this.#kernel.assertActive()
    this.#validateIdentifier(targetId, 'targetId')
    if (options.receiverId !== undefined) this.#validateIdentifier(options.receiverId, 'receiverId')
    if (
      !Number.isInteger(options.drainMs) ||
      options.drainMs < 0 ||
      options.drainMs > RpcWireLimit.maxDurationMs
    )
      throw new RpcContractError(RpcCoreErrorText.drainInvalid)
    const taskId = allocateRpcId(this.#uuid, 'variation', this.#id, targetId, () => false)
    const selectedReceiver =
      options.receiverId === undefined
        ? this.#ports.discoveryResolver.resolve(targetId)
        : Promise.resolve({ receiverId: options.receiverId })
    return selectedReceiver.then((selected) =>
      this.#ports.outboundOperations.send({
        kind: 'frame',
        message: this.#variationEnvelope(RpcControl.close, taskId, targetId, selected.receiverId, {
          drainMs: options.drainMs
        })
      })
    )
  }

  /** Validates a caller-facing identifier against the shared contract-capability domain. */
  #validateIdentifier(value: string, label: string): void {
    if (typeof value !== 'string' || value.length === 0 || value.length > this.#maxIdentifierLength)
      throw new RpcContractError(RpcCoreErrorText.identifierInvalid(label))
  }

  /**
   * Sends one ping variation and settles false on bounded timeout, matching the legacy synchronous
   * `MIDDLEWARE_MISSING`/`CONTRACT_INVALID` gates and per-call `timeoutMs`/`signal`.
   */
  ping(targetId: string, receiverId?: string, options?: IPingOptions): Promise<boolean> {
    this.#kernel.assertActive()
    this.#validateIdentifier(targetId, 'targetId')
    if (receiverId !== undefined) this.#validateIdentifier(receiverId, 'receiverId')
    if (!this.#pingEnabled)
      throw new RpcError(RpcCoreErrorCode.middlewareMissing, RpcCoreErrorText.pingMiddlewareMissing)
    const timeoutMs = this.#resolveTimeout(options?.timeoutMs)
    assertTimeout(timeoutMs)
    if (options?.signal?.aborted) return Promise.resolve(false)
    const taskId = allocateRpcId(this.#uuid, 'variation', this.#id, targetId, (candidate) =>
      this.#pending.has(candidate)
    )
    return new Promise<boolean>((resolve) => {
      let settled = false
      const onAbort = (): void => settle(false)
      const settle = (value: boolean): void => {
        if (settled) return
        settled = true
        if (timer) this.#ports.time.clearTimeout(timer)
        if (options?.signal) options.signal.removeEventListener('abort', onAbort)
        this.#pending.delete(taskId)
        resolve(value)
      }
      const timer =
        timeoutMs === false
          ? undefined
          : this.#ports.time.setTimeout(
              () => settle(false),
              timeoutMs === undefined ? 1000 : timeoutMs
            )
      if (options?.signal) options.signal.addEventListener('abort', onAbort, { once: true })
      this.#pending.set(taskId, { resolve: settle, timer })
      const selectedReceiver =
        receiverId === undefined
          ? this.#ports.discoveryResolver.resolve(targetId)
          : Promise.resolve({ receiverId })
      void selectedReceiver
        .then((selected) =>
          this.#ports.outboundOperations.send({
            kind: 'frame',
            message: this.#variationEnvelope(RpcControl.ping, taskId, targetId, selected.receiverId)
          })
        )
        .catch((error) => {
          settle(false)
          try {
            const reportError =
              error instanceof RpcTransportError && error.cause !== undefined ? error.cause : error
            this.#ports.outboundOperations.send({ kind: 'report', error: reportError })
          } catch {
            // The canonical report owner isolates diagnostics; a report failure must not create
            // an unhandled rejection or replace the original send failure.
          }
        })
    })
  }

  /**
   * Pings each configured target and returns keyed fulfillment/rejection results. Matches the
   * legacy fanout contract: results are keyed by the canonical `fanoutDeliveryKey` tagged shape and
   * accumulated into a `createSafeRecord` dictionary (a plain `{}` here would let an
   * attacker-controlled `__proto__`-shaped target silently mutate the accumulator's prototype
   * instead of appearing as a delivery result), and a `RpcLifecycleError` raised by any individual
   * `ping()` (construction/dispose racing the fanout) is rethrown rather than folded into the
   * per-target result, exactly like legacy `sendAll`/`pingAll`. Per-receiver keys are not produced
   * here: this composed `pingAll` fans out over the statically configured target list, not a
   * discovery-resolved receiver set — the same disclosed gap as `sendAll` above.
   */
  async pingAll(): Promise<IRpcFanoutResult<boolean>> {
    const results = await Promise.allSettled(
      this.#targetIds.map(async (targetId) => [targetId, await this.ping(targetId)] as const)
    )
    const lifecycleFailure = results.find(
      (result): result is PromiseRejectedResult =>
        result.status === 'rejected' && result.reason instanceof RpcLifecycleError
    )
    if (lifecycleFailure) throw lifecycleFailure.reason
    const fulfilled = createSafeRecord<boolean>()
    const rejected = createSafeRecord<unknown>()
    results.forEach((result, index) => {
      const key = fanoutDeliveryKey(this.#targetIds[index])
      if (result.status === 'fulfilled') fulfilled[key] = result.value[1]
      else rejected[key] = result.reason
    })
    return { fulfilled, rejected }
  }

  /** Releases handler, timers, and pending settlements on reverse disposal. */
  dispose(): void {
    for (const release of this.#releaseVariations) release()
    for (const pending of this.#pending.values()) pending.resolve(false)
    this.#pending.clear()
  }

  /**
   * Answers one ping admitted by the shared variation coordinator. Gated on `#pingEnabled` exactly
   * like legacy `src/endpoint.ts`'s `#features.ping === true` check before replying: a receiver
   * that never selected the `ping()` middleware must not send a pong, even though the variation
   * route stays registered (matching the legacy single always-listening receiver).
   */
  #receivePing(message: unknown, peerKey: string): void {
    this.#warnIgnoredPayload(message, peerKey)
    if (!this.#pingEnabled) return
    const record = message as {
      envelope?: IRpcEnvelope
      route?: { readonly route?: { readonly senderId?: string; readonly receiverId?: string } }
    }
    const taskId = record.envelope?.kind === 'variation' ? record.envelope.id : undefined
    const senderId = record.route?.route?.senderId
    if (!taskId || !senderId) return
    void this.#ports.outboundOperations
      .send({
        kind: 'frame',
        message: this.#variationEnvelope(
          RpcControl.pong,
          taskId,
          senderId,
          authenticationReplyReceiverId(record.envelope!) ?? senderId
        )
      })
      .catch((error) => this.#ports.outboundOperations.send({ kind: 'report', error }))
  }

  /** Resolves only a pong admitted by the shared variation coordinator. */
  #receivePong(message: unknown, peerKey: string): void {
    this.#warnIgnoredPayload(message, peerKey)
    const envelope = (message as { envelope?: IRpcEnvelope }).envelope
    const taskId = envelope?.kind === 'variation' ? envelope.id : undefined
    if (!taskId) return
    const pending = this.#pending.get(taskId)
    if (!pending) return
    if (pending.timer) this.#ports.time.clearTimeout(pending.timer)
    this.#pending.delete(taskId)
    pending.resolve(true)
  }

  /** A control payload extension has no effect on ping/pong but is reported once per peer. */
  #warnIgnoredPayload(message: unknown, peerKey: string): void {
    const route = (message as { readonly route?: { readonly payload?: unknown } }).route
    if (route && Object.hasOwn(route, 'payload'))
      this.#ports.outboundOperations.noteUnknownField(peerKey, 'variation', '/data', 'payload')
  }

  /** Decode one close intention, reporting malformed data without emitting a peer-close event. */
  #receiveClose(message: unknown, peerKey: string): void {
    const record = message as {
      readonly envelope?: IRpcEnvelope
      readonly route?: {
        readonly route?: { readonly senderId?: string }
        readonly payload?: unknown
      }
    }
    const payload = record.route?.payload
    let fields: readonly string[]
    let drainMs: unknown
    try {
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload))
        throw new RpcProtocolError(RpcCoreErrorText.drainInvalid)
      const prototype = Object.getPrototypeOf(payload)
      if (prototype !== Object.prototype && prototype !== null)
        throw new RpcProtocolError(RpcCoreErrorText.drainInvalid)
      fields = Object.keys(payload)
      drainMs = (payload as { readonly drainMs?: unknown }).drainMs
    } catch (cause) {
      this.#ports.outboundOperations.send({
        kind: 'report',
        error:
          cause instanceof RpcProtocolError
            ? cause
            : new RpcProtocolError(RpcCoreErrorText.drainInvalid, cause),
        code: RpcCoreErrorCode.protocolInvalid
      })
      return
    }
    if (
      !Number.isInteger(drainMs) ||
      (drainMs as number) < 0 ||
      (drainMs as number) > RpcWireLimit.maxDurationMs
    ) {
      this.#ports.outboundOperations.send({
        kind: 'report',
        error: new RpcProtocolError(RpcCoreErrorText.drainInvalid),
        code: RpcCoreErrorCode.protocolInvalid
      })
      return
    }
    for (const field of fields.filter((value) => value !== 'drainMs').sort())
      this.#ports.outboundOperations.noteUnknownField(peerKey, 'variation', '/data/payload', field)
    this.#ports.outboundOperations.send({
      kind: 'diagnostic',
      event: {
        name: RpcProtocolEvent.peerClosing,
        requesterId: record.route?.route?.senderId,
        durationMs: drainMs as number
      }
    })
  }

  /** Builds the one canonical variation envelope used by ping and pong traffic. */
  #variationEnvelope(
    variation: (typeof RpcControl)[keyof typeof RpcControl],
    taskId: string,
    targetId: string,
    receiverId: string,
    payload?: unknown
  ): IRpcEnvelope {
    return {
      kind: 'variation',
      id: taskId,
      data: {
        route: {
          profile: RpcRouteProfile,
          type: 'variation',
          applicationVersion: this.#applicationVersion,
          senderId: this.#id,
          targetId,
          receiverId,
          sentAt: this.#ports.time.timestamp(),
          variation
        },
        ...(payload === undefined ? {} : { payload })
      }
    }
  }
}
