/**
 * Owns RPC orderKey FIFO membership for the root Dispatcher across all namespaces. Grants one
 * original task permission and removes exact queued/running nodes in O(1); provider lifetime,
 * cancellation, optional admission policies and physical replies stay outside.
 */
import { deferred, type IDeferred } from '@migaia/utils/promise'

/** One validated arrival occupies one linked position until its invocation releases ownership. */
type IProviderOrderEntry = {
  /** The original admitted key selects the shared root queue without a catalog scan. */
  readonly key: string
  /** Permission wakes once at the head or when a cancelled queued task withdraws. */
  readonly permission: IDeferred<void>
  /** Reentrant terminal paths cannot unlink the same position twice. */
  released?: boolean
  /** Original neighbors allow withdrawal without scanning other ordered work. */
  previous?: IProviderOrderEntry
  /** Only a completed head makes its next original arrival eligible. */
  next?: IProviderOrderEntry
}

/** The invocation owns release timing; this receipt does not own a second business completion. */
export type IProviderOrderReceipt = Readonly<{
  permission: Promise<void>
  release(): void
}>

/** Migrate the original ProviderAdmissionRegistry's linked RPC FIFO, without its optional quotas. */
export class ProviderOrdering {
  /** A shared key has only head/tail references, never a copied array of pending tasks. */
  readonly #ordered = new Map<string, { head: IProviderOrderEntry; tail: IProviderOrderEntry }>()

  /** Reserve actual arrival synchronously, before asynchronous dispatch preparation can overtake it. */
  enqueue(orderKey: string): IProviderOrderReceipt {
    /** The same node owns queue identity and its one permission wait. */
    const entry: IProviderOrderEntry = { key: orderKey, permission: deferred<void>() }
    /** Existing keyed work takes no path through any other key's membership. */
    const queue = this.#ordered.get(orderKey)
    if (queue) {
      entry.previous = queue.tail
      queue.tail.next = entry
      queue.tail = entry
    } else this.#ordered.set(orderKey, { head: entry, tail: entry })
    if (!queue) entry.permission.resolve()
    return { permission: entry.permission.promise, release: () => this.#release(entry) }
  }

  /** Withdraw one exact node once, clear its links and wake only its original successor. */
  #release(entry: IProviderOrderEntry): void {
    if (entry.released) return
    entry.released = true
    /** A withdrawn waiter must resume its invocation's original cancellation check. */
    entry.permission.resolve()
    /** Node identity determines its original queue even during reentrant cancellation. */
    const current = this.#ordered.get(entry.key)
    if (!current) return
    /** Removing a queued suffix cannot grant permission to a later task prematurely. */
    const wasHead = current.head === entry
    if (entry.previous) entry.previous.next = entry.next
    if (entry.next) entry.next.previous = entry.previous
    if (wasHead) {
      if (entry.next) current.head = entry.next
      else this.#ordered.delete(entry.key)
    }
    if (current.tail === entry && entry.previous) current.tail = entry.previous
    entry.previous = undefined
    entry.next = undefined
    if (wasHead && this.#ordered.get(entry.key) === current) current.head.permission.resolve()
  }
}
