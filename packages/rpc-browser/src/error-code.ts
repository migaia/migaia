/**
 * Browser Peer admission and RTC decoding are owned by this package; wire errors retain Core
 * identity.
 */
export const ERROR_SOURCE = '@migaia/rpc/browser'

/**
 * Browser Peer configuration failures have stable semantic identities independent from Core
 * control.
 */
export const RpcBrowserErrorCode = {
  /**
   * BP-R2 requires a nonempty explicit Window origin; provide the destination origin before
   * connecting.
   */
  windowOriginRequired: 'WINDOW_ORIGIN_REQUIRED',
  /** BP-R5 requires ordered reliable RTC delivery; use a reliable channel or the Endpoint API. */
  rtcChannelUnreliable: 'RTC_CHANNEL_UNRELIABLE',
  /** BP-R3 allows one active listener per SharedWorker scope; close or reuse that listener first. */
  listenerAlreadyBound: 'LISTENER_ALREADY_BOUND',
  /**
   * BP-R1 rejects conflicting or unsupported sources; supply one concrete connect source or listen
   * scope.
   */
  invalidPeerSource: 'INVALID_PEER_SOURCE',
  /** BP-R5 rejects malformed RTC JSON and retains the decoder cause; correct the remote wire input. */
  messageDecodeFailed: 'MESSAGE_DECODE_FAILED'
} as const
export type IRpcBrowserErrorCode = (typeof RpcBrowserErrorCode)[keyof typeof RpcBrowserErrorCode]
