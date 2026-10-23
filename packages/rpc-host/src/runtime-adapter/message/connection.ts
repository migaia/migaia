import { RpcCapability } from '@migaia/rpc-contract'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import { deferred, hostRethrowReporter } from '@migaia/utils/promise'
import { systemScheduler, type IScheduledTask } from '@migaia/utils/scheduler'
import { tagRpcError, RpcCoreErrorCode } from '../../core/errors.js'
import { resolveAbortReason } from '../../core/internal/async-control.js'
import { registerBatchAgreement } from '../../core/internal/batch-frame.js'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'
import type { IRuntimePeerSourceResult } from '../../remote/index.js'
import { bindRuntimeMessageTransport } from '../byte/carrier.js'
import { runtimeMessagePipeline } from '../byte/pipeline.js'
import { retainRuntimeConnectionIdentity } from '../byte/connection-identity.js'
import type {
  IRuntimeByteDiagnostics,
  IRuntimeConnectionOptions,
  IRuntimeMessageIO
} from '../byte/types.js'
import { createMessageReceiveHandoff } from './handoff.js'

/** These V1 operations belong to the fixed whole-message construction, without a startup exchange. */
const fixedCapabilities: readonly string[] = Object.freeze([
  RpcCapability.abort,
  RpcCapability.ping,
  RpcCapability.close,
  RpcCapability.deadline,
  RpcCapability.idempotency,
  RpcCapability.trace,
  RpcCapability.stream,
  RpcCapability.batch
])

/** A local offer is ordinary policy; only raw ACK reception can enable expanded capabilities. */
export type IRuntimeMessageConnectionOptions = IRuntimeConnectionOptions &
  Readonly<{ offer: readonly string[] }>

/** Plain adapter-owned diagnostics cannot become a completed agreement or control receipt. */
export type IRuntimeMessageDiagnostics = Pick<
  IRuntimeByteDiagnostics,
  'closed' | 'duplicateBinding' | 'optionsInvalid' | 'handshakeTimeoutInvalid'
>

/** Construct over held whole-message I/O, preserving the fixed path and bounded actual ACK capture. */
export async function createRuntimeMessageConnection(
  io: IRuntimeMessageIO,
  options: IRuntimeMessageConnectionOptions,
  diagnostics: IRuntimeMessageDiagnostics
): Promise<IRuntimePeerSourceResult> {
  /** Preserve the adapter's proposal order and keep public presentation immutable. */
  const local = Object.freeze([...options.offer])
  /** The physical message owner retains the same monotonic clock as its eventual endpoint. */
  const scheduler = options.scheduler ?? systemScheduler
  /** Core's inherent V1 construction can disable capabilities but cannot accept an expansion claim. */
  const baseline = rpcMessageCapabilityControl.intersect(local, fixedCapabilities)
  /** Final transport construction is the only point that signs this newly constructed identity. */
  const build = (
    capabilities: readonly string[],
    receive?: ReturnType<typeof createMessageReceiveHandoff<unknown>>
  ): IRuntimePeerSourceResult => {
    /** No clone or native lifetime proof is inferred from arbitrary whole-message I/O. */
    const transport = bindRuntimeMessageTransport(io, options, diagnostics, receive)
    registerBatchAgreement(transport, capabilities)
    return retainRuntimeConnectionIdentity(
      Object.freeze({
        transport,
        peerId: options.peerId,
        scheduler,
        agreement: Object.freeze({ source: 'static' as const, codec: 'identity', capabilities }),
        pipeline: runtimeMessagePipeline,
        features: Object.freeze([]),
        ...(receive ? { activateReceive: () => receive.activateReceive() } : {}),
        async close() {
          receive?.close()
          await transport.close?.()
        }
      })
    )
  }
  if (local.every((capability) => fixedCapabilities.includes(capability))) return build(local)
  /** Expanded proposals use the same bounded grammar as every other message adapter. */
  const proposal = rpcMessageCapabilityControl.readOffer(local)
  if (!proposal.valid)
    throw tagRpcError(new TypeError(diagnostics.optionsInvalid), RpcCoreErrorCode.invalidConfig)
  if (
    options.handshakeTimeoutMs !== undefined &&
    (!Number.isFinite(options.handshakeTimeoutMs) || options.handshakeTimeoutMs < 0)
  )
    throw tagRpcError(
      new TypeError(diagnostics.handshakeTimeoutInvalid),
      RpcCoreErrorCode.invalidConfig
    )
  if (options.signal?.aborted) throw resolveAbortReason(options.signal)
  /** Only this actual raw receive operation can settle the independent peer offer. */
  const acknowledged = deferred<readonly string[]>()
  /** The opening race owns this failure, including a rollback that rejects before writer setup. */
  void acknowledged.promise.catch(() => undefined)
  /** The handoff owns one installed physical message subscription at a time. */
  let removeMessage: () => void = () => undefined
  /** The existing cold owner handles failure and transfers its original receive callback. */
  const receive = createMessageReceiveHandoff<unknown>(
    {
      add(listener) {
        removeMessage = io.onMessage(listener)
      },
      remove() {
        removeMessage()
      },
      observeFailure: (listener) => io.onClose(listener)
    },
    {
      consume(message) {
        if (!rpcMessageCapabilityControl.isAcknowledgement(message)) return false
        /** Descriptive extra fields and malformed records never become capability authority. */
        const parsed = rpcMessageCapabilityControl.readAcknowledgement(message)
        if (!parsed.valid)
          throw tagRpcError(
            new TypeError(diagnostics.optionsInvalid),
            RpcCoreErrorCode.invalidConfig
          )
        acknowledged.resolve(parsed.value)
        return true
      },
      onFailure: (error) => acknowledged.reject(error)
    }
  )
  /** This attempt alone owns its bounded absence deadline and cancellation listener. */
  let timer: IScheduledTask | undefined
  /** Detach only the abort observer installed by this control operation. */
  let abort: (() => void) | undefined
  /** Late physical rejection belongs to the live constructed channel after a bounded fallback. */
  let opened = false
  /** Secondary reporter failures never replace this attempt's primary connection failure. */
  const report = (error: unknown): void => {
    try {
      options.report(error)
    } catch (failure) {
      hostRethrowReporter(failure, IpcReporterContext)
    }
  }
  try {
    /** ACK absence degrades to the existing fixed profile rather than granting the proposal. */
    const absence = new Promise<undefined>((resolve) => {
      timer = scheduler.schedule(
        () => resolve(undefined),
        options.handshakeTimeoutMs ?? rpcMessageCapabilityControl.timeoutMs
      )
    })
    /** Start the bounded wait before invoking the held writer, which may never drain. */
    const sending = Promise.resolve(
      io.send(rpcMessageCapabilityControl.acknowledgement(proposal.value))
    )
    /** A fallback cannot silently discard a later physical write failure. */
    void sending.catch((error: unknown) => {
      if (opened) report(error)
    })
    /** Both physical drain and actual ACK are observed immediately, including early malformed ACK. */
    const negotiation = Promise.all([sending, acknowledged.promise]).then(([, peer]) => peer)
    /** Physical/control failure remains distinct from an absent peer reply. */
    const peer = await Promise.race([
      negotiation,
      absence,
      new Promise<never>((_resolve, reject) => {
        if (!options.signal) return
        abort = () => reject(resolveAbortReason(options.signal!))
        options.signal.addEventListener('abort', abort, { once: true })
        if (options.signal.aborted) abort()
      })
    ])
    /** ACK admission controls expansions only; inherent fixed capabilities remain available. */
    const accepted = new Set([
      ...baseline,
      ...(peer === undefined ? [] : rpcMessageCapabilityControl.intersect(proposal.value, peer))
    ])
    /** Preserve the original local proposal order in the exact public agreement. */
    const capabilities = Object.freeze(local.filter((capability) => accepted.has(capability)))
    /** The original cold capture reaches business callbacks only when the endpoint commits. */
    const channel = build(capabilities, receive)
    opened = true
    return channel
  } catch (primary) {
    receive.close()
    try {
      await io.close()
    } catch (cleanup) {
      report(cleanup)
    }
    throw primary
  } finally {
    timer?.cancel()
    if (abort) options.signal?.removeEventListener('abort', abort)
  }
}
