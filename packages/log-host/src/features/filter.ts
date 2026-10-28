import { issueFeature } from '../feature-registry.ts'
import { FeatureKind, FeaturePhase } from '../state-constants.ts'
import type { ILogEntry, ILogFeature } from '../typing.ts'
import { invalidOption } from '../errors.ts'

/** Distinct registrations preserve initial predicates when an added reference is later removed. */
class FilterFeature {
  /** Tokens own registrations even when the same predicate is registered more than once. */
  #filters = new Map<object, (entry: ILogEntry) => boolean>()
  /** Capture initial predicates without borrowing a caller-mutable array. */
  constructor(filters: readonly ((entry: ILogEntry) => boolean)[]) {
    for (const filter of filters) this.add(filter)
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
/** Create an ordered filtering policy with independently removable added predicates. */
export function filterFeature(
  options: { filters?: readonly ((entry: ILogEntry) => boolean)[] } = {}
): ILogFeature & { add(filter: (entry: ILogEntry) => boolean): () => void } {
  /** All installations of this descriptor share its explicitly mutable filter registrations. */
  const owner = new FilterFeature(options.filters ?? [])
  return issueFeature(
    {
      kind: FeatureKind.filter,
      phase: FeaturePhase.gate,
      accept: (entry: ILogEntry) => owner.accept(entry),
      add: (filter: (entry: ILogEntry) => boolean) => owner.add(filter)
    },
    { kind: FeatureKind.filter, phase: FeaturePhase.gate, accept: (entry) => owner.accept(entry) }
  )
}
export default filterFeature
