/**
 * Owns activation-completion order independently from resource cleanup. Name-indexed links provide
 * O(1) insertion/deletion and O(n) reverse traversal without copying a growing collection.
 */

/** One live completion link; links are removed when their activation is revoked. */
type IActivationLink<T> = {
  readonly value: T
  previous?: IActivationLink<T>
  next?: IActivationLink<T>
}

/** Canonical completion-order owner; resources and generation cancellation stay with entries. */
export class ActivationOrder<T extends { readonly name: string }> {
  /** Registered names index live completion links; deletion never scans earlier activations. */
  readonly #links = new Map<string, IActivationLink<T>>()
  /** Latest completion anchors LIFO traversal and append. */
  #last: IActivationLink<T> | undefined

  /** Append one successful current activation; an entry is removed before it can activate again. */
  add(value: T): void {
    /** New link retains only this activation and its adjacent live completions. */
    const link: IActivationLink<T> = { value, previous: this.#last }
    if (this.#last) this.#last.next = link
    this.#last = link
    this.#links.set(value.name, link)
  }

  /** Forget one completion by name in O(1), severing both neighbor references. */
  delete(name: string): void {
    /** Lookup resolves the exact live completion without searching resource state. */
    const link = this.#links.get(name)
    if (!link) return
    if (link.previous) link.previous.next = link.next
    if (link.next) link.next.previous = link.previous
    else this.#last = link.previous
    this.#links.delete(name)
    link.previous = undefined
    link.next = undefined
  }

  /** Traverse current completions backwards, retaining the next cursor before callers delete. */
  *reverse(): IterableIterator<T> {
    /** Cursor follows each live completion at most once during synchronous host transitions. */
    let link = this.#last
    while (link) {
      /** Deactivating the yielded entry may unlink its neighbors before iteration resumes. */
      const previous = link.previous
      yield link.value
      link = previous
    }
  }

  /** Drop terminal order ownership after every live handle has been released. */
  clear(): void {
    this.#links.clear()
    this.#last = undefined
  }
}
