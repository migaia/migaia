/**
 * Defines structural whole-message IO, encoding and complete carrier capability injection ports.
 * Native packages acquire resources and supply real media facts; SDK implementations own carrier
 * execution without requiring DOM or Node types at this shared boundary.
 */
import type {
  IRpcCarrierCodec,
  IRpcCarrierObservation,
  IRpcCarrierWriteOptions,
  IRpcDispose
} from '@migaia/rpc-contract/interfaces'
import type { IRpcErrorWireMetadata } from '@migaia/rpc-contract/errors'
import type { IRpcBinaryDigest } from '../wire/binary-types.js'

/** Physical message IO forwards the original native payload and exact caller transfer list. */
export type IRpcMessageIO = Readonly<{
  send(
    value: unknown,
    transfer?: readonly ArrayBuffer[],
    options?: IRpcCarrierWriteOptions
  ): void | Promise<void>
  onMessage(listener: (value: unknown) => void): IRpcDispose
  onClose(listener: (reason?: unknown) => void): IRpcDispose
  onError?(listener: (error: unknown) => void): IRpcDispose
  close(reason?: unknown): void | Promise<void>
}>
/** Shared media ownership uses no peer, request, retry, bootstrap or negotiation facade. */
export type IRpcMessageCarrierOptions = Readonly<{
  /** Native acquisition supplies its actual raw observer, independent of the selected codec. */
  observation?: IRpcCarrierObservation
  /** The native owner lends its original synchronous transfer-capability rejection, if distinct. */
  assertTransfer?(signed?: boolean): void
  /** A native owner may lend its original reason for an otherwise reasonless physical close. */
  defaultCloseError?(): Error
  id: string
  io: IRpcMessageIO
  report(error: unknown): void
  nativeBinary?: boolean
  digest?: IRpcBinaryDigest
  codec?: IRpcCarrierCodec
  errorMetadata?: IRpcErrorWireMetadata
}>
/** Structural Encoding API capabilities keep SDK declarations independent of DOM/Node libraries. */
export type IRpcUtf8Options = Readonly<{
  encoder?: Readonly<{
    encode(value: string): Uint8Array
    encodeInto(value: string, target: Uint8Array): Readonly<{ written: number }>
  }>
  /** Injected decoders must use fatal UTF-8 semantics, like the native decoder constructed by SDK. */
  decoder?: Readonly<{ decode(value: Uint8Array): string }>
}>
/**
 * Physical carrier writes pass native cancellation/transfer options without changing their
 * identity.
 */
export type IRpcPhysicalWriteOptions = IRpcCarrierWriteOptions

/** The canonical JSON parser's maintained implementation is synchronous and ignores parser context. */
export type IRpcJsonTextParser = Readonly<{
  encode(value: unknown): readonly ['text', string]
  decode(value: readonly ['text', string]): unknown
}>
