/** Stable browser adapter failure text owned by the browser layer. */
export const BrowserRpcErrorText = {
  /** The RTC adapter reports setup and rollback failure with this stable aggregate text. */
  rtcSubscriptionCleanupFailed: 'subscription setup failed',
  /** The WebTransport adapter reports terminal cleanup failure with this stable aggregate text. */
  webTransportCleanupFailed: 'WebTransport close failed'
} as const
