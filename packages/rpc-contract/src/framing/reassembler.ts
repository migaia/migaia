import type { IRpcFrameAcceptResult, IRpcFrameContext, IRpcFramer } from '../types.js'

/** Thin named facade for callers that need to document a reassembly boundary explicitly. */
export type IRpcReassembler<TFrame, TEncoded> = Readonly<{
  accept: (frame: TFrame, context: IRpcFrameContext) => IRpcFrameAcceptResult<TEncoded>
  close: (reason?: unknown) => void
}>

/**
 * Binds native framing ingress preparation to the exact `accept` callable. Structural copies retain
 * native behaviour without making descriptor objects identity tokens.
 */
export type IRpcPreparedFrame<TFrame> = Readonly<{ frame: TFrame; messageId: string }>
/**
 * Describes a package-native framer whose output can be either a legal carrier or a fragment
 * object. Component admission uses this owner-provided fact without invoking framing callables.
 */
export type IRpcNativeFrameOutputDomain = Readonly<{
  readonly kind: 'carrier-or-fragment'
  readonly carrierEncodedType: 'string' | 'uint8array'
}>
/**
 * Preserves ingress preparation while exposing an optional immutable native output fact for the
 * exact registered frame callable. The callable itself remains extensible for existing clients.
 */
export type IRpcBoundFrameIngress<TFrame> = ((
  frame: TFrame,
  context: IRpcFrameContext
) => IRpcPreparedFrame<TFrame>) & {
  readonly nativeOutputDomain?: IRpcNativeFrameOutputDomain
}
/** Stable context identifier for opaque custom frames with no native fragment identity. */
const RpcWholeFrameMessageId = 'whole'
/**
 * Associates each package-native callable with only the fact it owns: accept owns preparation;
 * frame owns its output domain. Structural copies retain each exact callable independently.
 */
const rpcFrameCallableFacts = new WeakMap<
  Function,
  Readonly<{
    prepare?: (frame: unknown, context: IRpcFrameContext) => IRpcPreparedFrame<unknown>
    nativeOutputDomain?: IRpcNativeFrameOutputDomain
  }>
>()

/** Internal native-constructor hook; deliberately absent from the public framing barrel. */
export function registerNativeRpcFrameIngress(
  accept: Function,
  frame: Function,
  prepare: (frame: unknown, context: IRpcFrameContext) => IRpcPreparedFrame<unknown>,
  nativeOutputDomain: IRpcNativeFrameOutputDomain
): void {
  rpcFrameCallableFacts.set(accept, Object.freeze({ prepare }))
  rpcFrameCallableFacts.set(frame, Object.freeze({ nativeOutputDomain }))
}

/**
 * Returns preparation only for a package-native accept callable. Custom callables deliberately
 * remain opaque and receive their original frame unchanged.
 */
export function bindRpcFrameIngress<TFrame, TEncoded>(
  accept: (frame: TFrame, context: IRpcFrameContext) => IRpcFrameAcceptResult<TEncoded>,
  frame?: (value: TEncoded, context: IRpcFrameContext) => readonly TFrame[]
): IRpcBoundFrameIngress<TFrame> {
  const prepare = rpcFrameCallableFacts.get(accept)?.prepare
  const nativeOutputDomain = frame
    ? rpcFrameCallableFacts.get(frame)?.nativeOutputDomain
    : undefined
  const bound = ((value, context) =>
    (prepare?.(value, context) ??
      Object.freeze({
        frame: value,
        messageId: RpcWholeFrameMessageId
      })) as IRpcPreparedFrame<TFrame>) as IRpcBoundFrameIngress<TFrame>
  if (nativeOutputDomain)
    Object.defineProperty(bound, 'nativeOutputDomain', {
      value: nativeOutputDomain,
      enumerable: true,
      configurable: false,
      writable: false
    })
  return bound
}

/** Projects the reassembly methods of a framer without introducing a second state owner. */
export function createReassembler<TEncoded, TFrame, TId extends string, TVersion extends number>(
  framer: IRpcFramer<TEncoded, TFrame, TId, TVersion>
): IRpcReassembler<TFrame, TEncoded> {
  return Object.freeze({ accept: framer.accept, close: framer.close })
}
