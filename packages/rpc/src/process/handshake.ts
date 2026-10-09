import { hostRethrowReporter } from '@migaia/utils/promise'
import { bindNativeReplayTransport } from '../core/internal/native-replay.js'
import { registerBatchAgreement } from '../core/internal/batch-frame.js'
import { systemScheduler, type IScheduledTask, type IScheduler } from '@migaia/utils/scheduler'
import { serializeRpcError } from '../contract/error.js'
import {
  acceptRpcHandshake,
  completeRpcHandshake,
  createRpcHello,
  normalizeRpcHandshake,
  type IRpcHandshakeAgreement
} from '../contract/handshake.js'
import {
  RpcCodecId,
  RpcHandshakeStep,
  RpcProtocol,
  RpcReservedKind,
  RpcCapability
} from '../contract/wire-constants.js'
import { RpcCoreErrorCode, tagRpcError } from '../core/errors.js'
import { IpcReporterContext } from '../core/plugins/reporter-context.js'
import type { IRemoteChannel } from '../remote/types.js'
import type { IRuntimePeerSourceResult } from '../remote/runtime-api/peer.js'
import {
  bindProcessByteWire,
  deferProcessByteReceive,
  bindProcessMessageTransport,
  type IProcessByteWire
} from './channel.js'
import { RpcProcessErrorCode } from './error-code.js'
import { createProcessError } from './error.js'
import { RpcProcessErrorText } from './error-text.js'
import { attachIpcConnection } from './ipc-connection.js'
import { byteProcessPipeline, messageProcessPipeline } from './pipeline.js'
import type {
  IProcessByteChannel,
  IProcessByteOptions,
  IProcessMessageChannel,
  IProcessMessageOptions
} from './types.js'

/** Default deadline applies only to establishing a byte connection. */
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000

/** Preserve TypeError identity for invalid caller options while using an existing core code. */
function invalidOption(message: string): TypeError {
  return tagRpcError(new TypeError(message), RpcCoreErrorCode.invalidConfig)
}

/** Validate an offer before any reader, write, or timer is installed. */
function validateByteOptions(options: IProcessByteOptions): string {
  if (
    !options ||
    typeof options.report !== 'function' ||
    !options.ipc ||
    typeof options.peerId !== 'string' ||
    !options.offer ||
    (options.role !== 'initiator' && options.role !== 'responder')
  )
    throw invalidOption(RpcProcessErrorText.optionsInvalid)
  if (
    options.role === 'responder' &&
    (!options.auth ||
      (options.auth.mode !== 'none' &&
        (options.auth.mode !== 'required' || typeof options.auth.verify !== 'function')))
  )
    throw invalidOption(RpcProcessErrorText.optionsInvalid)
  /** Control owns local offer grammar and secret-safe invalid-offer diagnostics. */
  const hello = createRpcHello(options.offer)
  const parsed = normalizeRpcHandshake(hello)
  /**
   * Defense in depth: current hello normalization already requires JSON, but keep the local
   * byte-channel invariant explicit if the generic handshake evolves.
   */
  if (parsed.step !== RpcHandshakeStep.hello || !parsed.codecs.includes(RpcCodecId.json))
    throw invalidOption(RpcProcessErrorText.jsonCodecRequired)
  if (
    options.handshakeTimeoutMs !== undefined &&
    (!Number.isFinite(options.handshakeTimeoutMs) || options.handshakeTimeoutMs < 0)
  )
    throw invalidOption(RpcProcessErrorText.handshakeTimeoutInvalid)
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
  wire: IProcessByteWire,
  options: IProcessByteOptions,
  hello: string
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
      await options.auth.verify(negotiated.agreement.auth, negotiated.agreement.peer)
    } catch {
      /** Verifier exceptions may contain the offered token and never enter any report or cause. */
      const rejected = createProcessError(RpcProcessErrorCode.authRejected)
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

/** Byte overload negotiates JSON over framed UTF-8 before exposing remote. */
export function createProcessTransport(
  channel: IProcessByteChannel,
  options: IProcessByteOptions
): Promise<IRuntimePeerSourceResult>
/** Message overload projects an explicit shared static agreement without a wire handshake. */
export function createProcessTransport(
  channel: IProcessMessageChannel,
  options: IProcessMessageOptions
): Promise<IRemoteChannel>
/** Choose one channel kind without changing the caller's physical process ownership. */
export async function createProcessTransport(
  channel: IProcessByteChannel | IProcessMessageChannel,
  options: IProcessByteOptions | IProcessMessageOptions
): Promise<IRuntimePeerSourceResult> {
  if (channel.kind === 'message') {
    if (!('staticAgreement' in options)) throw invalidOption(RpcProcessErrorText.optionsInvalid)
    const messageOptions = options
    /** Both sides' codec and capability order must be identical before side effects. */
    const local = messageOptions.staticAgreement?.local
    const peer = messageOptions.staticAgreement?.peer
    if (
      !local ||
      !peer ||
      local.codec !== 'identity' ||
      peer.codec !== 'identity' ||
      local.capabilities.length !== peer.capabilities.length ||
      local.capabilities.some((capability, index) => capability !== peer.capabilities[index])
    )
      throw invalidOption(RpcProcessErrorText.staticAgreementMismatch)
    const transport = bindProcessMessageTransport(channel, messageOptions)
    registerBatchAgreement(transport, local.capabilities)
    return Object.freeze({
      transport,
      peerId: messageOptions.peerId,
      scheduler: messageOptions.scheduler ?? systemScheduler,
      agreement: Object.freeze({
        source: 'static' as const,
        codec: local.codec,
        capabilities: Object.freeze([...local.capabilities])
      }),
      pipeline: messageProcessPipeline,
      features: Object.freeze([]),
      async close() {
        await transport.close?.()
      }
    })
  }
  if (!('role' in options)) throw invalidOption(RpcProcessErrorText.optionsInvalid)
  const byteOptions = options
  const hello = validateByteOptions(byteOptions)
  /** The same monotonic scheduler later travels to the remote endpoint factory. */
  const scheduler: IScheduler = byteOptions.scheduler ?? systemScheduler
  const timeoutMs = byteOptions.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS
  /** V2 route assembly transfers the original bounded receive queue only after provider commit. */
  if (byteOptions.offer.capabilities.includes(RpcCapability.runtimeApi))
    deferProcessByteReceive(channel)
  const wire = bindProcessByteWire(channel, byteOptions)
  /** Timer cancellation is owned by this one handshake attempt. */
  let rejectDeadline: (error: Error) => void = () => undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject
  })
  /** Timer setup may fail, so physical cleanup remains inside the same try boundary. */
  let timer: IScheduledTask | undefined
  try {
    timer = scheduler.schedule(() => {
      const error = createProcessError(RpcProcessErrorCode.handshakeTimeout)
      void wire
        .close(error)
        .catch((cleanupError: unknown) => reportSafely(byteOptions.report, cleanupError))
      rejectDeadline(error)
    }, timeoutMs)
    const agreement = await Promise.race([
      exchangeByteHandshake(wire, byteOptions, hello),
      deadline
    ])
    if (wire.closed) throw createProcessError(RpcProcessErrorCode.channelClosed)
    if (agreement.codec !== RpcCodecId.json)
      throw invalidOption(RpcProcessErrorText.negotiatedCodecUnsupported)
    /** Only the authenticated v2 agreement replaces a pre-hello listener routing placeholder. */
    const peerId = agreement.capabilities.includes(RpcCapability.runtimeApi)
      ? agreement.peer.id
      : byteOptions.peerId
    wire.activate(agreement.capabilities, peerId)
    const ipc = attachIpcConnection(wire.transport, byteOptions.ipc, byteOptions.report, scheduler)
    bindNativeReplayTransport(channel, ipc.transport)
    /** Four network-order prefix bytes count toward the complete native physical frame. */
    registerBatchAgreement(ipc.transport, agreement.capabilities, 4)
    return Object.freeze({
      transport: ipc.transport,
      peerId,
      scheduler,
      agreement: publicAgreement(agreement),
      pipeline: byteProcessPipeline,
      features: ipc.features,
      ...(wire.activateReceive ? { activateReceive: wire.activateReceive } : {}),
      close: ipc.close
    })
  } catch (error) {
    try {
      await wire.close(error)
    } catch (cleanupError) {
      reportSafely(byteOptions.report, cleanupError)
    }
    throw error
  } finally {
    timer?.cancel()
  }
}
