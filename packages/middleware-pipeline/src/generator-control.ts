import { type IGeneratorMiddlewareSignals } from './state-constants.ts'

export type IGeneratorReduction<TValue> =
  | { readonly halted: true }
  | { readonly halted: false; readonly value: TValue }

/** Resolves one completed generator stage without exposing intermediate yields downstream. */
export const reduceGeneratorTerminal = <TValue>(
  terminal: unknown,
  last: TValue,
  signals: IGeneratorMiddlewareSignals
): IGeneratorReduction<TValue> => {
  if (terminal === signals.halt || terminal === undefined) return { halted: true }
  if (terminal === signals.undefined) return { halted: false, value: undefined as TValue }
  if (terminal === signals.continue) return { halted: false, value: last }
  return { halted: false, value: terminal as TValue }
}

/**
 * Adapts a sync stage to async middleware while preserving next() violations.
 *
 * Keeps the sync runner's linear-reduce order: `next()` inside the stage only records the value,
 * and downstream starts after the stage returns, so code after `next()` always runs before
 * downstream. A throwing stage never starts downstream and rejects with its own error; a downstream
 * rejection propagates unchanged, and the runner still owns stage+downstream composition.
 */
export type IGeneratorTask<TValue, TIterator> =
  | { readonly index: number; readonly value: TValue }
  | {
      readonly index: number
      readonly iterator: TIterator
      readonly failure?: { readonly error: unknown }
    }

/** The nearest suspended yield alone receives its failed suffix; no new traversal is fenced. */
export function returnGeneratorFailure<TValue, TIterator>(
  pending: IGeneratorTask<TValue, TIterator>[],
  error: unknown
): void {
  /** Below a running suffix the stack contains only its suspended ancestor iterators. */
  const parent = pending.pop()
  if (!parent || !('iterator' in parent)) throw error
  pending.push({ index: parent.index, iterator: parent.iterator, failure: { error } })
}

/** Maps the explicit-undefined control to its payload without copying ordinary values. */
export const yieldedValue = <TValue>(
  value: TValue | symbol,
  signals: IGeneratorMiddlewareSignals
): TValue => (value === signals.undefined ? (undefined as TValue) : (value as TValue))

/** Runs each synchronous yield before resuming its originating iterator, without native recursion. */
