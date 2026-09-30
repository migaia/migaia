/** Stable browser adapter failure text owned by the browser layer. */
export const BrowserRpcErrorText = {
  /** The RTC adapter reports setup and rollback failure with this stable aggregate text. */
  rtcSubscriptionCleanupFailed: 'subscription setup failed',
  /** The WebTransport adapter reports terminal cleanup failure with this stable aggregate text. */
  webTransportCleanupFailed: 'WebTransport close failed',
  /**
   * The ServiceWorker adapter reports a failed source identity read through its transport error
   * observer.
   */
  serviceWorkerSourceReadFailed: 'ServiceWorker source identity read failed',
  /** The RTC adapter reports a failed inbound event data read before dispatch. */
  rtcMessageReadFailed: 'RTCDataChannel message data read failed',
  /**
   * Stable browser error text consumed by browser/adapters/rtc-data-channel.ts; preserves its
   * existing caller-facing wording.
   */
  rtcDataChannelMustExposeReadyStateAndTerminalEventListeners:
    'RTCDataChannel must expose readyState and terminal event listeners',
  /**
   * Stable browser error text consumed by browser/adapters/rtc-data-channel.ts; preserves its
   * existing caller-facing wording.
   */
  rtcDataChannelMustBeOpenBeforeTransportConstruction:
    'RTCDataChannel must be open before transport construction',
  /**
   * Stable browser error text consumed by browser/adapters/rtc-data-channel.ts; preserves its
   * existing caller-facing wording.
   */
  rtcClosed: 'RTCDataChannel closed',
  /**
   * Stable browser error text consumed by browser/adapters/rtc-data-channel.ts; preserves its
   * existing caller-facing wording.
   */
  rtcDataChannelIsClosed: 'RTCDataChannel is closed',
  /**
   * Stable browser error text consumed by browser/adapters/shared-worker.ts; preserves its existing
   * caller-facing wording.
   */
  rpcSharedWorkerMessageError: '[rpc] shared worker message error',
  /**
   * Stable browser error text consumed by browser/adapters/web-transport.ts; preserves its existing
   * caller-facing wording.
   */
  webTransportDatagramStreamEnded: 'WebTransport datagram stream ended',
  /**
   * Stable browser error text consumed by browser/adapters/web-transport.ts; preserves its existing
   * caller-facing wording.
   */
  webTransportIsClosed: 'WebTransport is closed',
  /**
   * Stable browser error text consumed by browser/adapters/web-transport.ts; preserves its existing
   * caller-facing wording.
   */
  webTransportRequiresUint8ArrayEncodedMessages:
    'WebTransport requires Uint8Array encoded messages',
  /**
   * Stable browser error text consumed by browser/adapters/web-worker.ts; preserves its existing
   * caller-facing wording.
   */
  workerMessageReadFailed: (detail: string): string =>
    `[rpc] worker message could not be read: ${detail}`,
  /**
   * Stable browser error text consumed by browser/adapters/web-worker.ts; preserves its existing
   * caller-facing wording.
   */
  workerFailure: (reason: string, detail: string): string => `[rpc] worker ${reason}: ${detail}`,
  /**
   * Stable browser error text consumed by browser/adapters/window.ts; preserves its existing
   * caller-facing wording.
   */
  receiverIsRequiredOutsideAWindowLikeRealm: 'receiver is required outside a window-like realm',
  /**
   * Stable browser error text consumed by browser/adapters/window.ts; preserves its existing
   * caller-facing wording.
   */
  targetOriginMustBeExplicitUseOnlyIntentionally:
    'targetOrigin must be explicit; use "*" only intentionally',
  /**
   * Stable browser error text consumed by browser/adapters/window.ts; preserves its existing
   * caller-facing wording.
   */
  wildcardTargetOriginRequiresAllowUnsafeTargetOrigin:
    'wildcard targetOrigin requires allowUnsafeTargetOrigin'
} as const
