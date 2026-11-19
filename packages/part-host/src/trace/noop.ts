import type { ITraceEvent, ITraceStep } from '@migaia/part-contract'
import type { ITraceListener, ITraceSink } from './sink.ts'

/** Shared empty result of every read. */
const EMPTY: readonly never[] = Object.freeze([])

/** Trace sink of production builds: records nothing and reads nothing. */
class NoopTraceSink implements ITraceSink {
  /** Always false: production builds carry no recorder. */
  readonly enabled = false

  /** Ignores a step. */
  step(_step: ITraceStep): void {}

  /** Ignores an event. */
  event(_event: ITraceEvent): void {}

  /** No steps are kept. */
  steps(_address: string): readonly ITraceStep[] {
    return EMPTY
  }

  /** No events are kept. */
  events(_key: string): readonly ITraceEvent[] {
    return EMPTY
  }

  /** Registers nothing; the returned removal does nothing. */
  subscribe(_listener: ITraceListener): () => void {
    return () => undefined
  }

  /** Nothing to clear. */
  clear(): void {}
}

/** Creates the trace sink of a host; this module is chosen without the `development` condition. */
export function createTraceSink(): ITraceSink {
  return new NoopTraceSink()
}
