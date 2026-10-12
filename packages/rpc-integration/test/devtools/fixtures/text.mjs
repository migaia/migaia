/** Shared fixture routes keep native providers and their callers on one concrete contract. */
export const FixtureMethod = {
  /** Worker and direct-Core providers increment the actual business payload. */
  increment: 'increment',
  /** Child provider executes the real child-to-Worker hop before answering its parent. */
  cascade: 'cascade',
  /** Parent joins actual Worker startup before starting its business acceptance. */
  ready: 'ready',
  /** Worker closes its actual collector without closing its business Peer. */
  closeCollector: 'closeCollector',
  /** Child closes both remote-host collectors before parent repeats its business call. */
  closeCollectors: 'closeCollectors'
}

/** Standalone argv and its oracle use this explicit mode to construct real collectors. */
export const FixtureMode = { observed: 'observed' }

/** This result scope explicitly separates native business evidence from direct-Core observations. */
export const FixtureScope = 'managed-business-and-direct-Core'
