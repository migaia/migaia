/** Numeric field snapshots shared by all benchmark state scenarios. */
export type IGlobalStateSnapshot = Readonly<Record<string, number>>

/** A global subscriber observes the entire current and previous shallow state objects. */
export type IGlobalStateListener = (
  state: IGlobalStateSnapshot,
  previous: IGlobalStateSnapshot
) => void

/** Minimal qiankun-style semantics, without lifecycle, ownership, derived values or field routing. */
export type IGlobalState = {
  /** Returns the current whole-state object until the next effective shallow patch. */
  getState(): IGlobalStateSnapshot
  /** Shallow-merges only existing fields and synchronously calls every subscriber on change. */
  setGlobalState(patch: IGlobalStateSnapshot): void
  /** Registers one whole-state listener; the returned unsubscribe is idempotent. */
  subscribe(listener: IGlobalStateListener): () => void
  /** Removes all sample-owned listeners after measurement. */
  dispose(): void
}

/**
 * Builds the explicitly limited global-state baseline used in S1, S2 and S5. Unknown top-level keys
 * are ignored; equal patches do not dispatch a notification.
 */
export function createGlobalState(initial: IGlobalStateSnapshot): IGlobalState {
  /** Each sample owns an independent shallow snapshot, never the caller's initial dictionary. */
  let current: IGlobalStateSnapshot = { ...initial }
  /** Registration order is the baseline's synchronous dispatch order. */
  const listeners = new Set<IGlobalStateListener>()
  return {
    getState: () => current,
    setGlobalState: (patch) => {
      /** A patch produces one whole-state replacement, regardless of its changed field count. */
      const next: Record<string, number> = { ...current }
      /** Unknown and equal fields do not constitute an effective state update. */
      let changed = false
      for (const [key, value] of Object.entries(patch)) {
        if (!Object.hasOwn(current, key) || Object.is(current[key], value)) continue
        next[key] = value
        changed = true
      }
      if (!changed) return
      /** Every callback receives the same committed current/previous pair for this update. */
      const previous = current
      current = next
      for (const listener of listeners) listener(current, previous)
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose: () => listeners.clear()
  }
}
