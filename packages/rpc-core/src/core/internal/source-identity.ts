/**
 * Assigns stable per-runtime tokens to inbound source objects without stringifying them or keeping
 * them alive. Primitive adapter sources use tagged values so domains cannot collide.
 */
export class SourceIdentityRegistry {
  /** Weak identity table preserves object distinction without retaining caller-owned sources. */
  readonly #tokens = new WeakMap<object, string>()
  /** Monotonic local sequence makes every object token unique within one endpoint runtime. */
  #nextToken = 0

  /** Returns one stable token for an inbound adapter source. */
  token(source: unknown): string {
    if (source && (typeof source === 'object' || typeof source === 'function')) {
      const objectSource = source as object
      const existing = this.#tokens.get(objectSource)
      if (existing) return existing
      const token = `source-${++this.#nextToken}`
      this.#tokens.set(objectSource, token)
      return token
    }
    if (source === undefined) return 'source-undefined'
    if (source === null) return 'source-null'
    return `source-${typeof source}:${String(source)}`
  }
}
