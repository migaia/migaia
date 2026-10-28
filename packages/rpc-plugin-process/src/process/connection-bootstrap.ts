/** Native token admission precedes Session without owning RPC negotiation or application auth. */
import { withTimeout, type IAbortSignal } from '@migaia/utils/promise'
import { UtilsTimeoutError } from '@migaia/utils/error'
import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import { encodeRpcStreamFrame, resolveAbortReason } from '@migaia/rpc-host/sdk'
import { createContractError } from '@migaia/rpc-contract/errors'
import { RpcContractErrorCode, RpcProcessErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcWireLimit, type IRpcPeerInfo } from '@migaia/rpc-contract/protocol'
import type { IRpcConnectionContext } from '@migaia/rpc-contract/interfaces'
import { receiveAdapterBootstrap } from './bootstrap.ts'
import { createProcessError } from './error.ts'
import {
  PROCESS_CONNECTION_BOOTSTRAP_KIND,
  PROCESS_CONNECTION_BOOTSTRAP_VERSION,
  PROCESS_HANDSHAKE_MAX_FRAME_BYTES,
  PROCESS_RUNTIME_API_BOOTSTRAP_TIMEOUT_MS,
  ProcessConnectionBootstrapStep as Step
} from './constants.ts'
import type { IProcessByteChannel } from './types.ts'
import type { IProcessServeListenerIngress } from './plugin/types.ts'

/** Original native collaborators lend cancellation and the sole complete admission deadline. */
export type IProcessConnectionBootstrapOptions = Readonly<{
  signal: IAbortSignal
  scheduler?: IScheduler
  report(error: unknown): void
}>

/** Only the original channel and private Session input survive successful native admission. */
export type IProcessConnectionAdmission = Readonly<{
  channel: IProcessByteChannel
  connectionContext: IRpcConnectionContext
  peer?: IRpcPeerInfo
}>

/** A native verifier or expected launch token admits the same one incoming first record. */
export type IProcessConnectionVerifier = Readonly<{
  verify?: IProcessServeListenerIngress['verify']
  token?: string
  expectedPeerId?: string
}>

/** Invalid private input is classified without parser errors or secret-bearing verifier causes. */
function rejected(): Error {
  return createProcessError(RpcProcessErrorCode.authRejected)
}

/** Decode known native admission members without retaining arbitrary input in an error. */
function record(bytes: Uint8Array): Record<string, unknown> {
  try {
    /** Only bounded native bootstrap bytes reach this private parser. */
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).kind === PROCESS_CONNECTION_BOOTSTRAP_KIND &&
      (value as Record<string, unknown>).version === PROCESS_CONNECTION_BOOTSTRAP_VERSION
    )
      return value as Record<string, unknown>
  } catch {
    // Native token/parser diagnostics are intentionally absent from public error graphs.
  }
  throw rejected()
}

/** Preserve the native verifier's existing peer-data input without granting Session identity. */
function peer(value: unknown): IRpcPeerInfo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw rejected()
  /** This is decoded private data, never an object with executable getters supplied by a caller. */
  const input = value as Record<string, unknown>
  if (
    typeof input.id !== 'string' ||
    !input.id ||
    input.id.length > RpcWireLimit.maxIdentifierChars ||
    typeof input.runtime !== 'string' ||
    !input.runtime ||
    input.runtime.length > RpcWireLimit.maxIdentifierChars
  )
    throw rejected()
  return { id: input.id, runtime: input.runtime }
}

/** One temporary native operation delegates all physical reading to the existing bootstrap owner. */
class ProcessConnectionBootstrap {
  /** The same original physical channel supplies write, EOF and idempotent close. */
  readonly #raw: IProcessByteChannel
  /** A completed native read lends only its unconsumed tail to the following Session. */
  #channel: IProcessByteChannel
  /** Original source cancellation, clock and reporter stay with this one admission operation. */
  readonly #options: IProcessConnectionBootstrapOptions

  /** Retain explicit original ports, never a host facade or a second reader/queue. */
  constructor(raw: IProcessByteChannel, options: IProcessConnectionBootstrapOptions) {
    this.#raw = raw
    this.#channel = raw
    this.#options = options
  }

  /** Request native connection admission before any Session codec or application hook executes. */
  connect(token: string, local: IRpcPeerInfo): Promise<IProcessConnectionAdmission> {
    return this.#run((signal) => this.#connect(token, local, signal))
  }

  /** Verify exactly one native proof before native callback side effects or Session attachment. */
  accept(verifier: IProcessConnectionVerifier): Promise<IProcessConnectionAdmission> {
    return this.#run((signal) => this.#accept(verifier, signal))
  }

  /** One existing utils deadline covers physical read and the supported async native verifier. */
  async #run(
    run: (signal: IAbortSignal) => Promise<IProcessConnectionAdmission>
  ): Promise<IProcessConnectionAdmission> {
    try {
      return await withTimeout(({ signal }) => run(signal), {
        signal: this.#options.signal,
        timeoutMs: PROCESS_RUNTIME_API_BOOTSTRAP_TIMEOUT_MS,
        scheduler: this.#options.scheduler ?? systemScheduler,
        report: this.#options.report
      })
    } catch (error) {
      try {
        await this.#raw.close()
      } catch (cleanup) {
        this.#options.report(cleanup)
      }
      if (error instanceof UtilsTimeoutError)
        throw createProcessError(RpcProcessErrorCode.handshakeTimeout, error)
      throw error
    }
  }

  /** Write only this fixed native record through the existing length encoder and original IO. */
  async #write(value: Readonly<Record<string, unknown>>, signal: IAbortSignal): Promise<void> {
    if (signal.aborted) throw resolveAbortReason(signal)
    /** Token bytes are encoded once and never copied into a diagnostic or retained event. */
    const bytes = new TextEncoder().encode(JSON.stringify(value))
    if (bytes.byteLength > PROCESS_HANDSHAKE_MAX_FRAME_BYTES)
      throw createContractError(RpcContractErrorCode.frameLimitExceeded)
    await this.#channel.write(encodeRpcStreamFrame(bytes))
  }

  /** Borrow the same decoder/tail owner without adding its optional timer to the complete deadline. */
  async #read(signal: IAbortSignal): Promise<Record<string, unknown>> {
    /** The original bounded first-frame operation transfers remaining bytes before Session starts. */
    const received = await receiveAdapterBootstrap(this.#channel, 'stdin', {
      signal,
      scheduler: this.#options.scheduler
    })
    this.#channel = received.channel
    return record(received.bootstrap!)
  }

  /** Negative acknowledgement is an actual native gate result, never an arbitrary remote Error. */
  async #connect(
    token: string,
    local: IRpcPeerInfo,
    signal: IAbortSignal
  ): Promise<IProcessConnectionAdmission> {
    await this.#write(
      {
        kind: PROCESS_CONNECTION_BOOTSTRAP_KIND,
        version: PROCESS_CONNECTION_BOOTSTRAP_VERSION,
        step: Step.hello,
        token,
        peer: local
      },
      signal
    )
    /** No untrusted remote message, stack or cause is reflected into this authentication error. */
    const reply = await this.#read(signal)
    if (reply.step !== Step.accept) throw rejected()
    return { channel: this.#channel, connectionContext: { credentials: token } }
  }

  /** Native credentials are checked once; application signing/replay remains exclusively in auth. */
  async #accept(
    verifier: IProcessConnectionVerifier,
    signal: IAbortSignal
  ): Promise<IProcessConnectionAdmission> {
    /** Only this original first frame may supply the secret credential and native verifier input. */
    const input = await this.#read(signal)
    /** Only secret-bearing admission/verification failures use the fixed authentication summary. */
    let verified: Readonly<{ credentials: string; peer: IRpcPeerInfo; principalId?: string }>
    try {
      verified = await this.#verify(input, verifier, signal)
    } catch (error) {
      if (signal.aborted) throw resolveAbortReason(signal)
      try {
        await this.#write(
          {
            kind: PROCESS_CONNECTION_BOOTSTRAP_KIND,
            version: PROCESS_CONNECTION_BOOTSTRAP_VERSION,
            step: Step.reject,
            code: RpcProcessErrorCode.authRejected
          },
          signal
        )
      } catch (cleanup) {
        this.#options.report(cleanup)
      }
      throw error
    }
    await this.#write(
      {
        kind: PROCESS_CONNECTION_BOOTSTRAP_KIND,
        version: PROCESS_CONNECTION_BOOTSTRAP_VERSION,
        step: Step.accept
      },
      signal
    )
    return {
      channel: this.#channel,
      peer: verified.peer,
      connectionContext: {
        credentials: verified.credentials,
        ...(verified.principalId === undefined
          ? {}
          : { authentication: { principalId: verified.principalId } })
      }
    }
  }

  /**
   * Preserve the native verifier's principal while withholding secret-bearing validation
   * exceptions.
   */
  async #verify(
    input: Record<string, unknown>,
    verifier: IProcessConnectionVerifier,
    signal: IAbortSignal
  ): Promise<Readonly<{ credentials: string; peer: IRpcPeerInfo; principalId?: string }>> {
    try {
      if (input.step !== Step.hello || typeof input.token !== 'string' || !input.token)
        throw rejected()
      /** Pure native peer data is checked again by Session after the connection is admitted. */
      const remote = peer(input.peer)
      if (verifier.expectedPeerId !== undefined && remote.id !== verifier.expectedPeerId)
        throw rejected()
      /** Only a real configured verifier may grant a native principal. */
      let principalId: string | undefined
      if (verifier.verify) {
        principalId = await verifier.verify(input.token, remote)
        if (typeof principalId !== 'string' || !principalId) throw rejected()
      } else if (input.token !== verifier.token) throw rejected()
      if (signal.aborted) throw resolveAbortReason(signal)
      return { credentials: input.token, peer: remote, principalId }
    } catch {
      if (signal.aborted) throw resolveAbortReason(signal)
      throw rejected()
    }
  }
}

/** Open one native token gate while leaving subsequent semantic Session ownership untouched. */
export function openProcessConnectionBootstrap(
  raw: IProcessByteChannel,
  token: string,
  local: IRpcPeerInfo,
  options: IProcessConnectionBootstrapOptions
): Promise<IProcessConnectionAdmission> {
  return new ProcessConnectionBootstrap(raw, options).connect(token, local)
}

/** Admit the same one native proof using the actual listener or launch verifier. */
export function acceptProcessConnectionBootstrap(
  raw: IProcessByteChannel,
  verifier: IProcessConnectionVerifier,
  options: IProcessConnectionBootstrapOptions
): Promise<IProcessConnectionAdmission> {
  return new ProcessConnectionBootstrap(raw, options).accept(verifier)
}
