import {
  createLifecycleScope,
  createSyncLifecycleScope,
  type ILifecycleScope,
  type ISyncLifecycleScope
} from '@migaia/lifecycle'

export type IResourceReleaseError = { readonly resource: string; readonly error: unknown }
export type IResourceReleasePhase = 'critical' | 'application'

/** Higher `order` runs first (§3.1: critical transport resources release before application ones). */
const ORDER_BY_PHASE: Record<IResourceReleasePhase, number> = { critical: 1, application: 0 }

/**
 * Owns heterogeneous resources and releases them in reverse registration order.
 *
 * Synchronous resources (transport listener unsubscribes, which are plain `() => void`) live in a
 * `SyncLifecycleScope` so that construction rollback can release them in the same tick — the
 * endpoint constructor registers `subscribe`/`onTransportError`/`onListenerError` and, when a later
 * registration throws, must have already detached every earlier listener synchronously (D-6: the
 * general `LifecycleScope.dispose()` is always asynchronous and cannot provide that). Asynchronous
 * resources (transport close, middleware disposers) live in a `LifecycleScope` and drain after the
 * synchronous ones, preserving the existing "unsubscribe listeners, then close the transport, then
 * dispose middleware" order.
 */
export class ResourceScope {
  /** Owns synchronous release records; released first, synchronously, in LIFO order. */
  readonly #sync: ISyncLifecycleScope = createSyncLifecycleScope({ errorPolicy: 'collect' })
  /** Owns asynchronous release records; released after the synchronous ones. */
  readonly #async: ILifecycleScope = createLifecycleScope({ errorPolicy: 'collect' })
  #count = 0
  #syncCount = 0
  #releasePromise: Promise<readonly IResourceReleaseError[]> | undefined

  /** Returns the number of release records retained by this scope. */
  get size(): number {
    return this.#count
  }

  /** Registers a synchronously-released resource and returns an idempotent unregister function. */
  addSync(name: string, release: () => void): () => void {
    const token = {}
    this.#sync.own(token, {
      syncSafe: true,
      force: () => {
        try {
          release()
        } catch (error) {
          throw { resource: name, error } satisfies IResourceReleaseError
        }
      }
    })
    this.#count++
    this.#syncCount++
    let registered = true
    return () => {
      if (!registered) return
      registered = false
      if (this.#sync.release(token)) {
        this.#count--
        this.#syncCount--
      }
    }
  }

  /** Registers a potentially-asynchronous resource and returns an idempotent unregister function. */
  add(
    name: string,
    release: () => void | Promise<void>,
    phase: IResourceReleasePhase = 'application'
  ): () => void {
    const token = {}
    this.#async.own(token, {
      order: ORDER_BY_PHASE[phase],
      // `LifecycleScope`'s own error collection labels failures with an internal numeric id, not
      // this resource's human-readable `name` — and callers match on that name (e.g.
      // `entry.resource === 'middleware'` in endpoint.ts). Re-tag the failure with the name here so
      // `releaseAll()` can hand back the original `{resource, error}` shape unchanged.
      force: async () => {
        try {
          await release()
        } catch (error) {
          throw { resource: name, error } satisfies IResourceReleaseError
        }
      }
    })
    this.#count++
    let registered = true
    return () => {
      if (!registered) return
      registered = false
      if (this.#async.release(token)) this.#count--
    }
  }

  /** Releases only synchronous resources so activation can detach listeners before plugin rollback. */
  releaseSync(): readonly IResourceReleaseError[] {
    const count = this.#syncCount
    this.#syncCount = 0
    this.#count -= count
    return this.#sync.dispose().map((entry) => entry.error as IResourceReleaseError)
  }

  /** Releases every resource, continuing after failures and preserving order. */
  releaseAll(): Promise<readonly IResourceReleaseError[]> {
    if (this.#releasePromise) return this.#releasePromise
    let resolveRelease!: (errors: readonly IResourceReleaseError[]) => void
    let rejectRelease!: (error: unknown) => void
    this.#releasePromise = new Promise((resolve, reject) => {
      resolveRelease = resolve
      rejectRelease = reject
    })
    ;(async () => {
      // Synchronous resources detach in the same tick this method is called; async resources drain
      // afterwards. The endpoint constructor's failure path depends on the synchronous part having
      // already run by the time `releaseAll()` returns its promise.
      const syncErrors = this.releaseSync()
      const asyncErrors = await this.#async.dispose()
      this.#count = 0
      resolveRelease([
        ...syncErrors,
        ...asyncErrors.map((entry) => entry.error as IResourceReleaseError)
      ])
    })().catch(rejectRelease)
    return this.#releasePromise
  }
}
