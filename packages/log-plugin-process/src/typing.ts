/** Process injection requires no Node global or concrete event-emitter type. */
export type IProcessCapability = {
  readonly env: Record<string, string | undefined>
  on(event: string, listener: (...args: unknown[]) => void): unknown
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown
  exit(code?: number): void
}

/** Options borrow one process while policy is shared only with its compatible host group. */
export type IProcessPluginConfig = {
  /** Defaults to the recognized server runtime's process; absent processes install no listeners. */
  process?: IProcessCapability
  /** Defaults true; crash events are logged as fatal before shutdown. */
  captureCrashes?: boolean
  /** Defaults 3000ms; expiration exits after the available graceful wait. */
  shutdownTimeoutMs?: number
  /** Defaults false; explicit interception changes exit to wait for a bounded flush. */
  interceptProcessExit?: boolean
}

/** Only three fixed policy fields participate in a same-process compatibility decision. */
export type IProcessPolicy = {
  captureCrashes: boolean
  shutdownTimeoutMs: number
  interceptProcessExit: boolean
}
