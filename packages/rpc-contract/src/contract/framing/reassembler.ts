import type { IRpcFrameAcceptResult, IRpcFrameContext } from '../types.js'

/**
 * Binds native framing ingress preparation to the exact `accept` callable. Structural copies retain
 * native behaviour without making descriptor objects identity tokens.
 */
export type IRpcPreparedFrame<TFrame> = Readonly<{
  /** Prepared native snapshot or the unchanged opaque custom frame. */
  frame: TFrame
  /** Native fragment identity or the stable whole-frame fallback for opaque input. */
  messageId: string
}>
/**
 * Describes a package-native framer whose output can be either a legal carrier or a fragment
 * object. Component admission uses this owner-provided fact without invoking framing callables.
 */
export type IRpcNativeFrameOutputDomain = Readonly<{
  /** Native frame output admits a whole encoded carrier as well as a chunk record. */
  readonly kind: 'carrier-or-fragment'
  /** Actual whole-carrier category emitted by the exact registered frame callable. */
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
  /** Present only when the supplied frame callable has its own native output-domain fact. */
  readonly nativeOutputDomain?: IRpcNativeFrameOutputDomain
  /** Construction limits belong to the exact native pair used by this ingress. */
  readonly singleFrameLimits?: Readonly<{
    /** Original paired native constructor's candidate capacity. */
    maxConcurrentMessages: number
    /** Original paired native constructor's complete-message ceiling. */
    maxMessageBytes: number
  }>
}
/** Stable context identifier for opaque custom frames with no native fragment identity. */
const RpcWholeFrameMessageId = 'whole'

/** Actual constructor facts bound candidate retention and complete single-frame admission. */
type IRpcSingleFrameFacts = Readonly<{
  maxConcurrentMessages: number
  maxMessageBytes: number
}>
/**
 * Associates each package-native callable with only the fact it owns: accept owns preparation;
 * frame owns its output domain. Structural copies retain each exact callable independently.
 */
const rpcFrameCallableFacts = new WeakMap<
  Function,
  Readonly<{
    prepare?: (frame: unknown, context: IRpcFrameContext) => IRpcPreparedFrame<unknown>
    nativeOutputDomain?: IRpcNativeFrameOutputDomain
    singleFrame?: Readonly<{ accept: Function; limits: IRpcSingleFrameFacts }>
  }>
>()

/** Record only package-native paired callables, after their constructor snapshots original limits. */
export function registerRpcSingleFrameFacts(
  accept: Function,
  frame: Function,
  limits: IRpcSingleFrameFacts
): void {
  rpcFrameCallableFacts.set(
    frame,
    Object.freeze({
      ...rpcFrameCallableFacts.get(frame),
      singleFrame: Object.freeze({ accept, limits: Object.freeze({ ...limits }) })
    })
  )
}

/** Copies of the actual pair retain facts; a wrapped or opaque callable cannot invent them. */
function readRpcSingleFrameFacts(
  accept: Function,
  frame: Function
): IRpcSingleFrameFacts | undefined {
  /** Identity is checked at this original framing owner, never inferred from public descriptor text. */
  const proof = rpcFrameCallableFacts.get(frame)?.singleFrame
  return proof?.accept === accept ? proof.limits : undefined
}

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
  /** Keep paired-callable membership inside normal ingress construction. */
  const singleFrameLimits = frame ? readRpcSingleFrameFacts(accept, frame) : undefined
  if (singleFrameLimits)
    Object.defineProperty(bound, 'singleFrameLimits', {
      value: singleFrameLimits,
      enumerable: true,
      configurable: false,
      writable: false
    })
  return bound
}
