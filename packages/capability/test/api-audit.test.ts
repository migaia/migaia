import { describe, expect, it } from 'vitest'
import {
  createCapabilityGraph,
  type IGraphNodeId,
  type IGraphNodeInstance
} from '../src/graph/index.js'
import { createDynamicCapabilityGraph } from '../src/graph/dynamic.js'

describe('audited capability cleanup ownership', () => {
  it('releases a valid late primary even when auxiliary rollback fails', async () => {
    /** Startup completes after the graph already lost commit authority. */
    let finish!: () => void
    /** Controlled local start promise avoids a real external resource. */
    const gate = new Promise<void>((resolve) => {
      finish = resolve
    })
    /** Each resource must release exactly once despite the auxiliary failure. */
    const releases: string[] = []
    /** Existing reporter retains cleanup errors without changing resource ownership. */
    const reports: unknown[] = []
    /** Static graph remains the startup transaction owner. */
    const graph = createCapabilityGraph({
      onError: (error) => {
        reports.push(error)
      }
    })
    /** Graph identity is stable throughout the cancelled start. */
    const id = 'late' as IGraphNodeId
    graph.register({
      id,
      kind: 'service',
      dependencies: [],
      start: async (context) => {
        context.own(
          {},
          {
            force: () => {
              releases.push('auxiliary')
              throw new Error('auxiliary cleanup')
            }
          }
        )
        await gate
        return {
          value: {},
          release: () => {
            releases.push('primary')
          }
        }
      }
    })
    /** Observe rejection immediately because dispose cancels readiness before startup settles. */
    const ready = graph.ready().catch(() => undefined)
    await graph.dispose()
    finish()
    await ready
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(releases).toEqual(['auxiliary', 'primary'])
    expect(graph.state).toBe('terminal')
    expect(reports.length).toBeGreaterThan(0)
  })

  it('waits for admitted predecessor and completes final disposal beyond the mutation budget', async () => {
    /** Registration holds the FIFO owner while final disposal is queued. */
    let finish!: (instances: IGraphNodeInstance<unknown>[]) => void
    /** A finite admission budget applies to ordinary mutations. */
    const pending = new Promise<IGraphNodeInstance<unknown>[]>((resolve) => {
      finish = resolve
    })
    /** The composition owner performs physical release after its fence. */
    let releases = 0
    /** Final cleanup must reuse the existing queue's per-task timeout override. */
    const graph = createDynamicCapabilityGraph({
      mutationAdmissionMs: 10,
      startBatch: () => pending,
      releaseBatch: async (entries, fence) => {
        await fence
        for (const entry of entries)
          await entry.instance.release({
            nodeId: entry.id,
            signal: new AbortController().signal,
            report() {}
          })
      }
    })
    /** The registered definition stays owned until startup yields its instance. */
    const registered = graph.register({
      id: 'waiting' as IGraphNodeId,
      kind: 'service',
      dependencies: [],
      start: () => ({ value: 1, release() {} })
    })
    await Promise.resolve()
    await Promise.resolve()
    /** Preserve canonical dispose promise identity, including while it is queued. */
    const disposed = graph.dispose()
    /** Observe rejection without allowing the old implementation's timeout to become unhandled. */
    let rejected = false
    void disposed.catch(() => {
      rejected = true
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    finish([
      {
        value: 1,
        release: () => {
          releases++
        }
      }
    ])
    await registered
    await disposed.catch(() => undefined)
    expect(rejected).toBe(false)
    expect(releases).toBe(1)
    expect(graph.state).toBe('terminal')
    expect(graph.nodes).toEqual([])
    expect(graph.dispose()).toBe(disposed)
  })
})
