/** Implementations compared only in scenarios whose semantics they support. */
export type ILibrary =
  | 'micro-hub'
  | 'nanostores'
  | 'zustand'
  | 'global-state'
  | 'mitt'
  | 'event-target'

/** Fixed numeric parameters identify one reproducible scenario cell. */
export type IParameters = Record<string, number>

/** Evidence collected outside timed code; sequences are bounded observed prefixes. */
export type IObservation = {
  operationCalls: number
  listenerCalls: number
  expectedListenerCalls: number
  sequence: string[]
  perListener?: Record<string, number>
  finalState: unknown
  activeSubscriptions?: number
}

/** One isolated fixture; timing fixtures contain no benchmark execution counters. */
export type IBenchFixture = {
  /** Runs one update, publish, or complete lifecycle cycle with a distinct value. */
  update(value: number): void | Promise<void>
  /** Common notification fence, included in each state-operation timing. */
  settle(): Promise<void>
  /** Clears only instrumentation after warmup; never resets application state. */
  resetEvidence(): void
  /** Asserts semantic completion and returns instrumentation when enabled. */
  inspect(expectedOperations: number, lastValue: number): IObservation
  /** Installs subscriptions separately from fixture creation for retained-heap measurements. */
  addSubscriptions?(count: number): void
  /** Releases subscriptions and borrowed application handles. */
  dispose(): Promise<void>
}
