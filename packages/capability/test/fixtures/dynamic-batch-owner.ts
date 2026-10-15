import type {
  IDynamicCapabilityGraphOptions,
  IGraphReleaseEntry,
  IGraphStartEntry
} from '../../src/graph/dynamic.js'
import type { IGraphNodeId, IGraphNodeInstance } from '../../src/graph/index.js'

/** Batch callbacks a dynamic graph requires; the fixture supplies both. */
type IBatchOwner<TBinding> = Pick<
  IDynamicCapabilityGraphOptions<TBinding>,
  'startBatch' | 'releaseBatch'
>

/**
 * Minimal composition owner for dynamic-graph tests. It starts each frontier entry in
 * provider-first order, resolves `get()` from values it started earlier, and releases a sealed
 * cascade in reverse order after the lease fence. A release failure goes to `report`, so one
 * failing node does not stop the rest of the cascade.
 */
export function createTestBatchOwner<TBinding = unknown>(
  report: (error: unknown) => void = () => undefined
): IBatchOwner<TBinding> {
  /** Values of started nodes, read by later starts through `context.get`. */
  const values = new Map<string, unknown>()
  return {
    async startBatch(
      entries: readonly IGraphStartEntry<TBinding>[]
    ): Promise<readonly IGraphNodeInstance<unknown>[]> {
      /** Instances in entry order, as the graph expects. */
      const instances: IGraphNodeInstance<unknown>[] = []
      for (const entry of entries) {
        const instance = await entry.definition.start({
          nodeId: entry.id,
          signal: new AbortController().signal,
          get: <T>(provider: IGraphNodeId): T => values.get(provider) as T,
          own: <T>(resource: T): T => resource
        })
        values.set(entry.id, instance.value)
        instances.push(instance)
      }
      return instances
    },
    async releaseBatch(
      entries: readonly IGraphReleaseEntry<TBinding>[],
      fence: Promise<void>
    ): Promise<void> {
      await fence
      for (const entry of [...entries].reverse()) {
        values.delete(entry.id)
        try {
          await entry.instance.release({
            signal: new AbortController().signal,
            nodeId: entry.id as IGraphNodeId,
            report
          })
        } catch (error) {
          report(error)
        }
      }
    }
  }
}
