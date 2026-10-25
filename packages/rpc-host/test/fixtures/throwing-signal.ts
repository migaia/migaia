/** A signal double whose reason getter throws while its abort notification stays controllable. */
export function throwingSignal(failure: Error, initiallyAborted: boolean, onRead?: () => void) {
  return new ThrowingSignal(failure, initiallyAborted, onRead)
}

/** One controlled native-signal double owns reason reads and exact abort-listener membership. */
class ThrowingSignal {
  /** Original reason failure remains the exact error instance returned through caller cause chains. */
  readonly #failure: Error
  /** Optional original getter observer runs before throwing the same failure. */
  readonly #onRead: (() => void) | undefined
  /** Only fire changes the original controlled signal's aborted fact. */
  #aborted: boolean
  /** Getter reads remain independently observable without reading reason a second time. */
  #reads = 0
  /** Original external abort callbacks are delivered in the same Set insertion order. */
  readonly #listeners = new Set<() => void>()
  /** The held native-shaped signal keeps the original own getters and exact callback results. */
  readonly signal: AbortSignal

  /** Capture original getter inputs without reading reason or notifying listeners during setup. */
  constructor(failure: Error, initiallyAborted: boolean, onRead?: () => void) {
    this.#failure = failure
    this.#aborted = initiallyAborted
    this.#onRead = onRead
    this.signal = ThrowingSignal.#view(this)
  }
  /** Preserve receiver-independent own getter semantics while state belongs to the named owner. */
  static #view(owner: ThrowingSignal): AbortSignal {
    return {
      get aborted() {
        return owner.#aborted
      },
      get reason(): never {
        owner.#reads += 1
        owner.#onRead?.()
        throw owner.#failure
      },
      addEventListener(_type: string, listener: () => void) {
        owner.#listeners.add(listener)
      },
      removeEventListener(_type: string, listener: () => void) {
        owner.#listeners.delete(listener)
      }
    } as unknown as AbortSignal
  }
  /** Observe the original reason-read count without invoking the throwing getter. */
  readonly reads = (): number => this.#reads
  /** Publish the same synchronous abort fact before visiting the original listener Set. */
  readonly fire = (): void => {
    this.#aborted = true
    for (const listener of this.#listeners) listener()
  }
}
