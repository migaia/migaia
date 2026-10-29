import { defineNativeLogFeature, type ILogFeatureRuntime } from '../feature-metadata.ts'
import { FeaturePhase } from '../state-constants.ts'
import type { ILogEntry, ILogFeature } from '../typing.ts'
import { invalidOption } from '../errors.ts'

/** Each added predicate has one independently revocable registration in its plugin instance. */
type IFilterControls = { add(filter: (entry: ILogEntry) => boolean): () => void }

/** Distinct registrations preserve initial predicates when an added reference is later removed. */
class FilterFeature {
  /** Tokens own registrations even when the same predicate is registered more than once. */
  #filters = new Map<object, (entry: ILogEntry) => boolean>()
  /** Capture initial predicates without borrowing a caller-mutable array. */
  constructor(filters: readonly ((entry: ILogEntry) => boolean)[]) {
    for (const filter of filters) this.add(filter)
  }
  /** Native output carries this installation's implementation and separately exposed controls. */
  runtime(): ILogFeatureRuntime<IFilterControls> {
    return {
      implementation: Object.freeze({
        phase: FeaturePhase.gate,
        accept: (entry: ILogEntry) => this.accept(entry)
      }),
      controls: Object.freeze({
        add: (filter: (entry: ILogEntry) => boolean) => this.add(filter)
      })
    }
  }
  /** Every currently registered predicate must accept the entry in insertion order. */
  accept(entry: ILogEntry): boolean {
    for (const filter of this.#filters.values()) if (filter(entry) === false) return false
    return true
  }
  /** Add one independently revocable registration. */
  add(filter: (entry: ILogEntry) => boolean): () => void {
    if (typeof filter !== 'function') throw invalidOption()
    /** One removal capability owns only this occurrence. */
    const token = {}
    this.#filters.set(token, filter)
    return () => {
      this.#filters.delete(token)
    }
  }
}
/** Define a cold native filter with mutable registrations owned by each installed instance. */
export function filterFeature(
  options: { filters?: readonly ((entry: ILogEntry) => boolean)[] } = {}
): ILogFeature<IFilterControls> {
  /** Preserve initial predicates without borrowing the caller's array until later installation. */
  const filters = Object.freeze([...(options.filters ?? [])])
  for (const filter of filters) if (typeof filter !== 'function') throw invalidOption()
  return defineNativeLogFeature({ phase: FeaturePhase.gate }, () =>
    new FilterFeature(filters).runtime()
  )
}
export default filterFeature
