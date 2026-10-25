/** Stable browser adapter failure text owned by the browser layer. */
export const BrowserRpcErrorText = {
  /** Dedicated Worker acquisition retains the original host-native diagnostic spelling. */
  workerMessageReadFailed: (detail: string): string =>
    `[rpc] worker message could not be read: ${detail}`,
  /** Native script/structured-clone failure keeps its original presentation and cause. */
  workerFailure: (reason: string, detail: string): string => `[rpc] worker ${reason}: ${detail}`,
  /** Native script error fallback is used only when the platform supplies no readable message. */
  workerFailedReason: 'failed',
  /** Native messageerror fallback describes the original structured-clone failure. */
  workerMessageErrorReason: 'could not deserialize a message',
  /** Borrowed Worker listener cleanup retains the original aggregate diagnostic. */
  workerCleanupFailed: '[rpc] worker transport cleanup failed',
  /** Fallback text for non-native or immutable platform I/O failures classified by Core. */
  carrierOperationFailed: 'Browser carrier I/O failed',
  /** A synchronous carrier probe failure reports through existing adapter listener channels. */
  carrierObservationFailed: 'Browser carrier observation failed',
  /** The RTC adapter reports setup and rollback failure with this stable aggregate text. */
  rtcSubscriptionCleanupFailed: 'subscription setup failed',
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
