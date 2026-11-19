import type { ITraceEvent, ITraceStep } from '@migaia/part-contract'

/** Listener told that a step or event was recorded under a key. */
export type ITraceListener = (key: string) => void

/**
 * Trace recorder of one host. `enabled` is false in production builds, where every method is a
 * no-op and reads return empty results. Keys are part addresses, or `$derive:<id>` for derive
 * recomputations.
 */
export type ITraceSink = {
  readonly enabled: boolean
  step(step: ITraceStep): void
  event(event: ITraceEvent): void
  steps(address: string): readonly ITraceStep[]
  events(key: string): readonly ITraceEvent[]
  subscribe(listener: ITraceListener): () => void
  clear(): void
}
