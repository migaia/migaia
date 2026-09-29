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
  rtcMessageReadFailed: 'RTCDataChannel message data read failed'
} as const
