import type { IPartFacets } from '../types.ts'

/** Enhancement stages a trace step records, in pipeline order. */
export const TraceStage = {
  authored: 'authored',
  enhancer: 'enhancer',
  resolved: 'resolved'
} as const

/** One enhancement stage. */
export type TraceStage = keyof typeof TraceStage

/**
 * One step of an address's enhancement pipeline: the facets before and after the stage. `enhancer`
 * names the enhancer id for `enhancer` steps. Shape only; hosts record steps in development
 * builds.
 */
export type ITraceStep = {
  readonly address: string
  readonly stage: TraceStage
  readonly enhancer?: string
  readonly input: IPartFacets
  readonly output: IPartFacets
  readonly at: number
}

/** Runtime event kinds a host traces. */
export const TraceEventKind = {
  dispatch: 'dispatch',
  effect: 'effect',
  stateWrite: 'state-write',
  derive: 'derive'
} as const

/** One traced event kind value. */
export type TraceEventKind = (typeof TraceEventKind)[keyof typeof TraceEventKind]

/**
 * One runtime event. `address` is the node that caused it, or `$derive:<id>` for a derive
 * recomputation, whose `detail` is `{ reads }`.
 */
export type ITraceEvent = {
  readonly address: string
  readonly kind: TraceEventKind
  readonly name: string
  readonly detail?: unknown
  readonly at: number
}
