/** Per-combine array construction; graph admission and publication stay owned by config.ts. */

/** Descriptor flags are restored only when an array never enters an array merge strategy. */
type IConfigArrayFlags = Pick<PropertyDescriptor, 'writable' | 'enumerable' | 'configurable'>

/** One array identity survives all source merges within its enclosing combineConfig call. */
type IConfigArrayState = {
  /** Private clone; no source array is ever used as the mutable accumulator. */
  readonly target: unknown[]
  /** Original flags preserve descriptor semantics for arrays that are only replaced or copied. */
  readonly flags: Map<PropertyKey, IConfigArrayFlags>
  /** Missing indices are tracked incrementally so a later concat never scans a growing prefix. */
  readonly holes: Set<number>
  /** A merged array has the ordinary data descriptors produced by the former spread/slice. */
  merged: boolean
}

/** Owns mutable array clones for one synchronous combine operation, then releases with that call. */
export class ConfigArrayMerge {
  /** Identity lookup prevents copying a prefix when a later source extends an existing array. */
  #states = new WeakMap<unknown[], IConfigArrayState>()
  /** Finalization restores untouched arrays without traversing the configuration graph again. */
  #pending: IConfigArrayState[] = []

  /** Register an empty clone before graph traversal can encounter a cycle back to it. */
  track(target: unknown[]): void {
    /** Flags and holes belong to this exact builder, including all aliases to that builder. */
    const state: IConfigArrayState = {
      target,
      flags: new Map(),
      holes: new Set(),
      merged: false
    }
    this.#states.set(target, state)
    this.#pending.push(state)
  }

  /** Already-private builders must not be cloned again when a resolver returns its left value. */
  has(target: unknown[]): boolean {
    return this.#states.has(target)
  }

  /** Copy data with temporarily writable flags, permitting frozen inputs to be extended later. */
  define(target: unknown[], key: PropertyKey, descriptor: PropertyDescriptor): void {
    /** Graph cloning registered this target before copying any descriptors. */
    const state = this.#states.get(target)!
    state.flags.set(key, {
      writable: descriptor.writable,
      enumerable: descriptor.enumerable,
      configurable: descriptor.configurable
    })
    Object.defineProperty(target, key, {
      ...descriptor,
      writable: true,
      configurable: key === 'length' ? false : true
    })
  }

  /** Normalize initial descriptors once, matching spread/slice without replacing array identity. */
  begin(target: unknown[]): void {
    /** Later sources reuse both descriptor normalization and the sparse-index ledger. */
    const state = this.#states.get(target)!
    if (state.merged) return
    state.merged = true
    state.flags.clear()
    for (const key of Reflect.ownKeys(target)) {
      if (key === 'length') continue
      /** Only canonical array indices survive the former spread/slice result. */
      const index = typeof key === 'string' ? Number(key) : Number.NaN
      if (!Number.isInteger(index) || index < 0 || index >= target.length || String(index) !== key)
        Reflect.deleteProperty(target, key)
    }
    for (let index = 0; index < target.length; index++) {
      if (!(index in target)) state.holes.add(index)
      else
        Object.defineProperty(target, index, {
          value: target[index],
          writable: true,
          enumerable: true,
          configurable: true
        })
    }
    /** Default Array species drops a custom inherited prototype just as the former slice did. */
    if (target.constructor === Array) Object.setPrototypeOf(target, Array.prototype)
  }

  /** Spread makes missing left indices explicit undefined, once per hole rather than per prefix. */
  concat(target: unknown[]): void {
    /** This ledger contains only initial holes or gaps/deletions introduced by index merging. */
    const state = this.#states.get(target)!
    /** A custom iterator is consumed once before spread would discard its own/prototype methods. */
    const values =
      !state.merged && target[Symbol.iterator] !== Array.prototype[Symbol.iterator]
        ? new Map<number, unknown>()
        : undefined
    if (values) {
      /** Snapshot yields before changing the same retained builder's properties or length. */
      let index = 0
      for (const entry of target) values.set(index++, entry)
    }
    this.begin(target)
    if (values) {
      target.length = 0
      for (const entry of values.values()) target.push(entry)
      state.holes.clear()
    }
    for (const index of state.holes) target[index] = undefined
    state.holes.clear()
    Object.setPrototypeOf(target, Array.prototype)
  }

  /** Record a single index replacement or deletion while preserving sparse array length rules. */
  set(target: unknown[], index: number, value: unknown, deleted: boolean): void {
    /** The caller began this builder before visiting source indices in their original order. */
    const state = this.#states.get(target)!
    if (deleted) {
      if (index < target.length) {
        delete target[index]
        state.holes.add(index)
      }
      return
    }
    for (let gap = target.length; gap < index; gap++) state.holes.add(gap)
    target[index] = value
    state.holes.delete(index)
  }

  /** Restore original flags on arrays that never merged before the existing owned publication. */
  finish(): void {
    for (const state of this.#pending) {
      if (state.merged) continue
      for (const [key, flags] of state.flags) {
        /** Resolver edits to values remain visible; finalization owns descriptor flags only. */
        const descriptor = Object.getOwnPropertyDescriptor(state.target, key)
        if (descriptor) Object.defineProperty(state.target, key, { ...descriptor, ...flags })
      }
    }
  }
}
