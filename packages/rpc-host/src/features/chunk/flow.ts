/**
 * Owns the installed chunk extension's outbound fragment ids and source-qualified assembler
 * lifetimes. Negotiated frame hooks reuse the string/byte assemblers and retire them on the real
 * source signal; Session negotiation and native transfer writes remain with the existing media
 * boundary.
 */
import { isUint8Array } from '@migaia/utils/bytes'
import type { IAbortSignal } from '@migaia/utils/promise'
import { RpcCarrierFrameKind as K } from '@migaia/rpc-contract/protocol'
import { createContractError } from '@migaia/rpc-contract/errors'
import { RpcContractErrorCode } from '@migaia/rpc-contract/error-code'
import type { IRpcFlowContext } from '@migaia/rpc-contract/interfaces'
import type { IRpcFlowInstallation } from '../../sdk/types.ts'
import { RpcFlowPoint, type IRpcFlowStage } from '../../sdk/flow-pipelines.ts'
import { createStringChunkAssembler, createBinaryChunkAssembler } from './assembly.ts'
import {
  RpcChunkExtension,
  RpcChunkEncoding as Encoding,
  RpcChunkMessagePrefix
} from './constants.ts'
import type { IRpcChunkOptions, IRpcStringChunk, IRpcBinaryChunk } from './types.ts'
import { hostErrorWireMetadata } from '../../host/error-wire-metadata.ts'

/** The exact inbound Session signal owns one physical-source retirement listener. */
type IChunkSource = Readonly<{ signal: IAbortSignal; abort: () => void }>

/** One installed frame plugin alone owns actual fragmentation and source-qualified assembly. */
export class RpcChunkFlow {
  /** Original string splitting retains UTF-16 units and joined surrogate behavior. */
  readonly #strings
  /** Original byte assembly copies each completed byte exactly once. */
  readonly #bytes
  /** One physical source has one abort remover until retirement or this plugin's final close. */
  readonly #sources = new Map<string, IChunkSource>()
  /** Monotonic local fragment ids do not allocate another host task or call identity. */
  #ordinal = 0
  /** Native setup cancellation bounds this exact installation's actual resources. */
  readonly #signal: IAbortSignal
  /** Repeated rollback/dispose cannot revive assembly or reclose retained timers. */
  #closed = false
  /** Actual hooks and extension declarations enter the existing native FlowPipeline unchanged. */
  readonly value: IRpcFlowInstallation

  /** Reuse the same canonical assembly algorithms and the host's sole error provenance owner. */
  constructor(options: IRpcChunkOptions, signal: IAbortSignal, required: boolean) {
    /** Only actual locally created errors acquire the supplied host's presentation metadata. */
    const captured = { ...options, errorMetadata: hostErrorWireMetadata }
    this.#strings = createStringChunkAssembler(captured)
    this.#bytes = createBinaryChunkAssembler(captured)
    this.#signal = signal
    this.value = {
      extensions: [RpcChunkExtension],
      requiredExtensions: required ? [RpcChunkExtension] : [],
      stages: {
        [RpcFlowPoint.frameOutbound]: this.#outbound,
        [RpcFlowPoint.frameInbound]: this.#inbound
      },
      dispose: this.close
    }
    signal.addEventListener('abort', this.close, { once: true })
    if (signal.aborted) this.close()
  }

  /** Actual negotiated membership permits chunks; native sidecars keep one original transfer write. */
  readonly #outbound: IRpcFlowStage<'frameOutbound'> = async (payload, next) => {
    const { frame, context } = payload
    if (context.signal.aborted) throw context.signal.reason
    if (this.#closed)
      throw createContractError(RpcContractErrorCode.invalidFrame, undefined, hostErrorWireMetadata)
    if (
      frame.kind !== K.message ||
      !context.session?.extensions.has(RpcChunkExtension) ||
      frame.sidecars?.length ||
      (typeof frame.data !== 'string' && !isUint8Array(frame.data))
    )
      return next(payload)
    /** Existing source-qualified lookup keeps equal ordinals on unrelated physical peers isolated. */
    const address = {
      source: context.carrierId,
      messageId: RpcChunkMessagePrefix + (++this.#ordinal).toString(36)
    }
    /** The actual encoded representation selects one original algorithm at the fixed frame stage. */
    const encoding = typeof frame.data === 'string' ? Encoding.string : Encoding.binary
    /** Whole short values stay whole; only actual fragment records become extension frames. */
    const parts =
      encoding === Encoding.string
        ? this.#strings.frame(frame.data as string, address)
        : this.#bytes.frame(frame.data as Uint8Array, address)
    if (parts.length === 1 && (typeof parts[0] === 'string' || isUint8Array(parts[0])))
      return next(payload)
    for (const fragment of parts) {
      if (context.signal.aborted) throw context.signal.reason
      await next({
        ...payload,
        frame: {
          kind: K.extension,
          extension: RpcChunkExtension,
          data: { encoding, ...(fragment as IRpcStringChunk | IRpcBinaryChunk) }
        }
      })
    }
  }

  /** Only this installed negotiated extension may retain fragments and emit a completed message. */
  readonly #inbound: IRpcFlowStage<'frameInbound'> = async (payload, next) => {
    const { frame, context } = payload
    if (context.signal.aborted) throw context.signal.reason
    if (frame.kind !== K.extension || frame.extension !== RpcChunkExtension) return next(payload)
    if (
      this.#closed ||
      !context.session?.extensions.has(RpcChunkExtension) ||
      !frame.data ||
      typeof frame.data !== 'object' ||
      frame.sidecars?.length
    )
      throw createContractError(RpcContractErrorCode.invalidFrame, undefined, hostErrorWireMetadata)
    /** These scalar header reads never inspect or visit the encoded business message. */
    const encoding = Object.getOwnPropertyDescriptor(frame.data, 'encoding')?.value
    /**
     * The actual Session supplies source; private fragment data cannot select another physical
     * peer.
     */
    const messageId = Object.getOwnPropertyDescriptor(frame.data, 'messageId')?.value
    if (
      (encoding !== Encoding.string && encoding !== Encoding.binary) ||
      typeof messageId !== 'string'
    )
      throw createContractError(RpcContractErrorCode.invalidFrame, undefined, hostErrorWireMetadata)
    this.#source(context)
    /** All ordering, expiry, quota and declared-length rules remain in the sole original assembler. */
    const result = (encoding === Encoding.string ? this.#strings : this.#bytes).accept(frame.data, {
      source: context.carrierId,
      messageId
    })
    if (context.signal.aborted) {
      this.#retire(context.carrierId)
      throw context.signal.reason
    }
    if (result.status === 'rejected') throw result.error
    if (result.status === 'complete')
      await next({ ...payload, frame: { kind: K.message, data: result.value } })
  }

  /** One inbound Session signal owns cleanup for this actual physical source's retained assemblies. */
  #source(context: IRpcFlowContext): void {
    if (this.#sources.has(context.carrierId)) return
    /** Only the compact source id is retained, never a whole per-call context. */
    const id = context.carrierId
    /** Physical retirement removes its existing indexes before timer cancellation can reenter. */
    const abort = (): void => {
      this.#retire(id)
    }
    this.#sources.set(id, { signal: context.signal, abort })
    context.signal.addEventListener('abort', abort, { once: true })
    if (context.signal.aborted) abort()
  }
  /** Retire one source through only its owned maps, without scanning another peer's frames. */
  #retire(id: string): void {
    /** Listener ownership is revoked before existing timer cancellation can execute user callbacks. */
    const source = this.#sources.get(id)
    this.#sources.delete(id)
    source?.signal.removeEventListener('abort', source.abort)
    this.#strings.closeSource(id)
    this.#bytes.closeSource(id)
  }
  /** Native rollback or final host close releases every original listener, timer and assembly once. */
  readonly close = (): void => {
    if (this.#closed) return
    this.#closed = true
    this.#signal.removeEventListener('abort', this.close)
    for (const id of this.#sources.keys()) this.#retire(id)
    this.#strings.close()
    this.#bytes.close()
  }
}
