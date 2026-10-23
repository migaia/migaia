/** Stable Browser Peer admission and cleanup text belongs to the public Peer owner. */
export const BrowserPeerErrorText = {
  /** An explicit origin keeps the Window Peer from inheriting a different realm's default. */
  windowOriginRequired: 'Browser Peer window connection requires an explicit origin',
  /** Core's one-to-one Peer contract excludes partial reliability and unordered RTC delivery. */
  rtcChannelUnreliable: 'Browser Peer requires an ordered reliable RTCDataChannel',
  /** A native SharedWorker connect owner cannot dispatch each port into competing Peer listeners. */
  listenerAlreadyBound: 'SharedWorker scope already has a Browser Peer listener',
  /** Source admission precedes loading carriers or registering native callbacks. */
  invalidPeerSource: 'Browser Peer requires exactly one supported connect or listen source',
  /** RTC uses JSON physical messages before the existing Core message control owner receives them. */
  messageDecodeFailed: 'Browser Peer RTC message JSON decoding failed',
  /** All listener-owned subscriptions and sessions attempt cleanup before reporting this aggregate. */
  listenerCleanupFailed: 'Browser Peer listener cleanup failed'
} as const
