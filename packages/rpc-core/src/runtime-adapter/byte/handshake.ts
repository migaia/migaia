import { hostRethrowReporter } from '@migaia/utils/promise'
import { bindNativeReplayTransport } from '../../core/internal/native-replay.js'
import { registerBatchAgreement } from '../../core/internal/batch-frame.js'
import { systemScheduler, type IScheduledTask, type IScheduler } from '@migaia/utils/scheduler'
import { serializeRpcError } from '@migaia/rpc-contract'
import {
  acceptRpcHandshake,
  completeRpcHandshake,
  createRpcHello,
  normalizeRpcHandshake,
  type IRpcHandshakeAgreement
} from '@migaia/rpc-contract'
import {
  RpcCodecId,
  RpcHandshakeStep,
  RpcProtocol,
  RpcReservedKind,
  RpcCapability
} from '@migaia/rpc-contract'
import { RpcCoreErrorCode } from '../../core/index.js'
import { tagRpcError } from '../../core/errors.js'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'
import type { IRemoteChannel } from '../../remote/index.js'
import { bindRuntimeByteWire, deferRuntimeByteReceive, type IRuntimeByteWire } from './carrier.js'
import { createRuntimeDiagnosticError } from './diagnostics.js'
import { attachIpcConnection } from './ipc-connection.js'
import { createRuntimeBytePipeline } from './pipeline.js'
import { retainRuntimeConnectionIdentity } from './connection-identity.js'
import type {
  IRuntimeByteIO,
  IRuntimeByteOptions,
  IRuntimeByteDiagnostics,
  IRuntimeByteConnection
} from './types.js'

/** Default deadline applies only to establishing a byte connection. */
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000

/** Preserve TypeError identity for invalid caller options while using an existing core code. */
function invalidOption(message: string): TypeError {
  return tagRpcError(new TypeError(message), RpcCoreErrorCode.invalidConfig)
}

/** Validate an offer before any reader, write, or timer is installed. */
function validateByteOptions(
  options: IRuntimeByteOptions,
  diagnostics: IRuntimeByteDiagnostics
): string {
  if (
    !options ||
    typeof options.report !== 'function' ||
    !options.ipc ||
    typeof options.peerId !== 'string' ||
    !options.offer ||
    (options.role !== 'initiator' && options.role !== 'responder')
  )
    throw invalidOption(diagnostics.optionsInvalid)
  if (
    options.role === 'responder' &&
    (!options.auth ||
      (options.auth.mode !== 'none' &&
        (options.auth.mode !== 'required' || typeof options.auth.verify !== 'function')))
  )
    throw invalidOption(diagnostics.optionsInvalid)
  /** Control owns local offer grammar and secret-safe invalid-offer diagnostics. */
  const hello = createRpcHello(options.offer)
  const parsed = normalizeRpcHandshake(hello)
  /**
   * Defense in depth: current hello normalization already requires JSON, but keep the local
   * byte-channel invariant explicit if the generic handshake evolves.
   */
  if (parsed.step !== RpcHandshakeStep.hello || !parsed.codecs.includes(RpcCodecId.json))
    throw invalidOption(diagnostics.jsonCodecRequired)
  if (
    options.handshakeTimeoutMs !== undefined &&
    (!Number.isFinite(options.handshakeTimeoutMs) || options.handshakeTimeoutMs < 0)
  )
    throw invalidOption(diagnostics.handshakeTimeoutInvalid)
  return hello
}

/** Project only negotiated public fields; auth remains private to the verifier. */
function publicAgreement(agreement: IRpcHandshakeAgreement): IRemoteChannel['agreement'] {
  return Object.freeze({
    source: 'negotiated' as const,
    codec: agreement.codec,
    capabilities: Object.freeze([...agreement.capabilities])
  })
}

/** Report without allowing a secondary reporter failure to replace handshake rejection. */
function reportSafely(report: (error: unknown) => void, error: unknown): void {
  try {
    report(error)
  } catch (reporterError) {
    hostRethrowReporter(reporterError, IpcReporterContext)
  }
}

/** Exchange exactly one control frame before making ordinary RPC frames visible. */
async function exchangeByteHandshake(
  wire: IRuntimeByteWire,
  options: IRuntimeByteOptions,
  hello: string,
  diagnostics: IRuntimeByteDiagnostics,
  retainPrincipal: (principal: string) => void
): Promise<IRpcHandshakeAgreement> {
  if (options.role === 'initiator') {
    await wire.writeText(hello)
    /** The responder's first reply is the only legal pre-ready inbound frame. */
    const reply = await wire.readHandshakeFrame()
    return completeRpcHandshake(options.offer, reply)
  }
  /** Responder reads one peer hello before emitting accept or reject. */
  const peerHello = await wire.readHandshakeFrame()
  const negotiated = acceptRpcHandshake(options.offer, peerHello)
  if (!negotiated.ok) {
    await wire.writeText(negotiated.reply)
    throw negotiated.error
  }
  if (options.auth.mode === 'required') {
    try {
      /** The authentication owner retains the real result without consulting public metadata. */
      const principal = await options.auth.verify(
        negotiated.agreement.auth,
        negotiated.agreement.peer
      )
      if (typeof principal === 'string') retainPrincipal(principal)
    } catch {
      /** Verifier exceptions may contain the offered token and never enter any report or cause. */
      const rejected = createRuntimeDiagnosticError(
        diagnostics.authenticationRejected,
        undefined,
        true
      )
      reportSafely(options.report, rejected)
      const wireError = serializeRpcError(rejected, { report: () => undefined })
      await wire.writeText(
        JSON.stringify({
          kind: RpcReservedKind.handshake,
          step: RpcHandshakeStep.reject,
          protocol: RpcProtocol.id,
          error: wireError
        })
      )
      throw rejected
    }
  }
  /** Opt-in early receive opens only after successful auth, before physical accept drain. */
  wire.beginAccept?.()
  await wire.writeText(negotiated.reply)
  return negotiated.agreement
}

/** Core exchanges byte control frames and signs only the exact resulting final carrier. */
export async function createRuntimeByteConnection(
  channel: IRuntimeByteIO,
  options: IRuntimeByteOptions,
  diagnostics: IRuntimeByteDiagnostics
): Promise<IRuntimeByteConnection> {
  if (!('role' in options)) throw invalidOption(diagnostics.optionsInvalid)
  /** Capture the original serialized proposal before installing any physical resource. */
  const hello = validateByteOptions(options, diagnostics)
  /** The same monotonic scheduler later travels to the remote endpoint factory. */
  const scheduler: IScheduler = options.scheduler ?? systemScheduler
  /** This deadline belongs to connection establishment, not later business operations. */
  const timeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS
  /** V2 route assembly transfers the original bounded receive queue only after provider commit. */
  if (options.offer.capabilities.includes(RpcCapability.runtimeApi))
    deferRuntimeByteReceive(channel)
  /** Core owns this physical reader and control-frame receiver for the whole attempt. */
  const wire = bindRuntimeByteWire(channel, options, diagnostics)
  /** Timer cancellation is owned by this one handshake attempt. */
  let rejectDeadline: (error: Error) => void = () => undefined
  /** Race only this attempt against the existing scheduler-owned handshake timer. */
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject
  })
  /** Timer setup may fail, so physical cleanup remains inside the same try boundary. */
  let timer: IScheduledTask | undefined
  /** Only the actual handshake invocation can retain an authenticated principal. */
  let principalId: string | undefined
  try {
    timer = scheduler.schedule(() => {
      const error = createRuntimeDiagnosticError(diagnostics.timeout)
      void wire
        .close(error)
        .catch((cleanupError: unknown) => reportSafely(options.report, cleanupError))
      rejectDeadline(error)
    }, timeoutMs)
    /** Completed wire control is the sole source of canonical capability facts. */
    const agreement = await Promise.race([
      exchangeByteHandshake(wire, options, hello, diagnostics, (principal) => {
        principalId = principal
      }),
      deadline
    ])
    if (wire.closed) throw createRuntimeDiagnosticError(diagnostics.closed)
    if (agreement.codec !== RpcCodecId.json)
      throw invalidOption(diagnostics.negotiatedCodecUnsupported)
    /** Only the authenticated v2 agreement replaces a pre-hello listener routing placeholder. */
    const peerId = agreement.capabilities.includes(RpcCapability.runtimeApi)
      ? agreement.peer.id
      : options.peerId
    wire.activate(agreement.capabilities, peerId)
    /** Register proof only on this final gate-bearing carrier, rather than its raw input. */
    const ipc = attachIpcConnection(wire.transport, options.ipc, options.report, scheduler)
    bindNativeReplayTransport(channel, ipc.transport)
    /** Four network-order prefix bytes count toward the complete native physical frame. */
    registerBatchAgreement(ipc.transport, agreement.capabilities, 4)
    return retainRuntimeConnectionIdentity(
      Object.freeze({
        transport: ipc.transport,
        peerId,
        scheduler,
        agreement: publicAgreement(agreement),
        pipeline: createRuntimeBytePipeline(options.expectedStringText),
        features: ipc.features,
        ...(wire.activateReceive ? { activateReceive: wire.activateReceive } : {}),
        log: ipc.log,
        ownClose: ipc.ownClose,
        close: ipc.close
      }),
      principalId
    )
  } catch (error) {
    try {
      await wire.close(error)
    } catch (cleanupError) {
      reportSafely(options.report, cleanupError)
    }
    throw error
  } finally {
    timer?.cancel()
  }
}
