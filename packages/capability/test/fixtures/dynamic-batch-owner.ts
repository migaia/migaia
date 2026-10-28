import type {
  IDynamicCapabilityGraphOptions,
  IGraphReleaseEntry,
  IGraphStartEntry
} from '../../src/graph/dynamic.ts'
import type { IGraphNodeId, IGraphNodeInstance } from '../../src/graph/index.ts'

/** Batch callbacks a dynamic graph requires; the fixture supplies both. */
type IBatchOwner<TBinding> = Pick<
  IDynamicCapabilityGraphOptions<TBinding>,
  'startBatch' | 'releaseBatch'
>

/** Owns per-test dynamic startup values and physical cleanup callbacks. */
class TestBatchOwner<TBinding> implements IBatchOwner<TBinding> {
  /** Started values remain available only until their matching release removes them. */
  readonly #values = new Map<string, unknown>()
  /** Caller-owned diagnostic sink observes cleanup failure without replacing the batch outcome. */
  readonly #report: (error: unknown) => void

  /** Captures the existing report function without changing its receiver or error behavior. */
  constructor(report: (error: unknown) => void) {
    this.#report = report
  }

  /** Starts the provider-first frontier and publishes each value before the next entry. */
  readonly startBatch = async (
    entries: readonly IGraphStartEntry<TBinding>[]
  ): Promise<readonly IGraphNodeInstance<unknown>[]> => {
    /** Returned resources retain the exact graph-supplied entry order. */
    const instances: IGraphNodeInstance<unknown>[] = []
    for (const entry of entries) {
      /** The caller's definition keeps responsibility for its original primary resource. */
      const instance = await entry.definition.start({
        nodeId: entry.id,
        signal: new AbortController().signal,
        get: <T>(provider: IGraphNodeId): T => this.#values.get(provider) as T,
        own: <T>(resource: T): T => resource
      })
      this.#values.set(entry.id, instance.value)
      instances.push(instance)
    }
    return instances
  }

  /** Awaits the lease fence, then releases the entire cascade in dependent-first order. */
  readonly releaseBatch = async (
    entries: readonly IGraphReleaseEntry<TBinding>[],
    fence: Promise<void>
  ): Promise<void> => {
    await fence
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      /** Cleanup removes the same generation's published value before invoking its disposer. */
      const entry = entries[index]!
      this.#values.delete(entry.id)
      try {
        await entry.instance.release({
          signal: new AbortController().signal,
          nodeId: entry.id as IGraphNodeId,
          report: this.#report
        })
      } catch (error) {
        Reflect.apply(this.#report, undefined, [error])
      }
    }
  }
}

/**
 * Minimal composition owner for dynamic-graph tests. It starts each frontier entry in
 * provider-first order, resolves `get()` from values it started earlier, and releases a sealed
 * cascade in reverse order after the lease fence. A release failure goes to `report`, so one
 * failing node does not stop the rest of the cascade.
 */
export function createTestBatchOwner<TBinding = unknown>(
  report: (error: unknown) => void = () => undefined
): IBatchOwner<TBinding> {
  return new TestBatchOwner(report)
}
