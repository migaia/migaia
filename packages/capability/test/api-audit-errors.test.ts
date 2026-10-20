import { describe, expect, it, vi } from 'vitest'
import { walkErrorCauses } from '@migaia/utils/error'
import { createCapabilityHost, snapshotGraphReadiness } from '../src/index.js'
import { createCapabilityGraph, type IGraphNodeId } from '../src/graph/index.js'
import { createDynamicCapabilityGraph } from '../src/graph/dynamic.js'
import { createTopologyIndex, buildCapabilityTopology } from '../src/graph/topology.js'
import { resolveInstallSet } from '../src/graph/dependency.js'

describe('audited capability boundary contracts', () => {
  it('preserves the standard readonly Map and Set forEach receiver', () => {
    /** Pure topology retains collection semantics while denying mutation. */
    const index = createTopologyIndex({
      onCycle() {
        throw new Error('cycle')
      },
      onInvalid() {
        throw new Error('invalid')
      }
    })
    index.add({ id: 'a', dependencies: [] })
    /** Explicit thisArg is part of both native collection protocols. */
    const receiver = {}
    /** Both callbacks must observe the same supplied receiver. */
    const seen: unknown[] = []
    index.snapshot().level.forEach(function (this: unknown) {
      seen.push(this)
    }, receiver)
    resolveInstallSet(index, ['a'], () => false).forEach(function (this: unknown) {
      seen.push(this)
    }, receiver)
    expect(seen).toEqual([receiver, receiver])
  })

  it.each(['static', 'incremental'] as const)(
    'retains %s topology getter failure when the adapter chooses its own error',
    (kind) => {
      /** Captured input failure must remain reachable even when the adapter throws another error. */
      const original = new Error('node getter')
      /** A mutable native adapter error should retain its type and identity. */
      const adapterFailure = new TypeError('invalid topology')
      /** Optional failure metadata lets existing domain adapters choose their own cause policy. */
      let supplied: unknown
      /** Legacy adapter behavior still receives traceability through secondary errors. */
      const invalid = (
        _reason: unknown,
        _id?: string,
        failure?: { readonly cause: unknown }
      ): never => {
        supplied = failure?.cause
        throw adapterFailure
      }
      /** Both public topology admission paths read the same hostile node shape. */
      const node = {
        get id(): string {
          throw original
        },
        ordinal: 0,
        dependencies: []
      }
      expect(() =>
        kind === 'static'
          ? buildCapabilityTopology(
              [node],
              () => {
                throw new Error('unknown')
              },
              () => {
                throw new Error('cycle')
              },
              invalid
            )
          : createTopologyIndex({
              onCycle() {
                throw new Error('cycle')
              },
              onInvalid: invalid
            }).add(node)
      ).toThrow(adapterFailure)
      expect(supplied).toBe(original)
      expect(walkErrorCauses(adapterFailure).includes(original)).toBe(true)
    }
  )

  it('annotates a native readiness getter error without replacing it', () => {
    /** Readiness admission owns failures while taking its fixed one-time snapshot. */
    const original = new RangeError('readiness getter')
    expect(() =>
      snapshotGraphReadiness({
        get state(): never {
          throw original
        },
        error: undefined
      })
    ).toThrow(original)
    expect(original).toMatchObject({ source: '@migaia/capability', code: 'INVALID_OPTION' })
  })

  it.each(['host', 'static', 'dynamic'] as const)(
    'reports a %s reporter failure without changing cleanup',
    async (kind) => {
      /** Terminal reports remain observable outside the owning business Promise. */
      const callbacks: (() => void)[] = []
      /** Capture utils' shared terminal channel rather than throwing into the test host. */
      const queue = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
        callbacks.push(callback)
      })
      /** A separate diagnostic failure proves the reporter's own error survives. */
      const failure = new Error('reporter failed')
      /** Existing user reporter may be implemented asynchronously. */
      const report = () => Promise.reject(failure)
      try {
        if (kind === 'host') {
          /** Activation failure remains queryable after its diagnostic sink rejects. */
          const host = createCapabilityHost({}, { flags: { a: true }, onError: report })
          host.register({
            name: 'a',
            activate() {
              throw new Error('activation failed')
            }
          })
          expect((await host.enable('a')).status).toBe('failed')
          await host.dispose()
        } else if (kind === 'static') {
          /** A normal release can emit a diagnostic through its provided context. */
          const graph = createCapabilityGraph({ onError: report })
          graph.register({
            id: 'a' as IGraphNodeId,
            kind: 'service',
            dependencies: [],
            start: () => ({
              value: 1,
              release: (context) => {
                context.report(new Error('release diagnostic'))
              }
            })
          })
          await graph.ready()
          await graph.dispose()
          expect(graph.state).toBe('terminal')
        } else {
          /** Physical release failure leaves a binding notification failure as a secondary report. */
          const graph = createDynamicCapabilityGraph({
            startBatch: (entries) => entries.map(() => ({ value: 1, release() {} })),
            releaseBatch: () => undefined,
            releaseBinding: () => {
              throw new Error('binding release failed')
            },
            report
          })
          await graph.register(
            {
              id: 'a' as IGraphNodeId,
              kind: 'service',
              dependencies: [],
              start: () => ({ value: 1, release() {} })
            },
            {}
          )
          await graph.dispose()
          expect(graph.state).toBe('terminal')
        }
        for (let turn = 0; turn < 12; turn++) await Promise.resolve()
        expect(callbacks).toHaveLength(1)
        expect(callbacks[0]).toThrow(failure)
      } finally {
        queue.mockRestore()
      }
    }
  )

  it('reads registration ordinals from the canonical topology owner after removal', async () => {
    /** Batch composition is unrelated to the diagnostic ordering fact. */
    const graph = createDynamicCapabilityGraph({
      startBatch: (entries) => entries.map(() => ({ value: 1, release() {} })),
      releaseBatch() {}
    })
    for (const id of ['a', 'b', 'c'])
      await graph.register({
        id: id as IGraphNodeId,
        kind: 'service',
        dependencies: [],
        start: () => ({ value: 1, release() {} })
      })
    await graph.remove('a' as IGraphNodeId)
    await graph.register({
      id: 'd' as IGraphNodeId,
      kind: 'service',
      dependencies: [],
      start: () => ({ value: 1, release() {} })
    })
    expect(['b', 'c', 'd'].map((id) => graph.nodeState(id as IGraphNodeId).ordinal)).toEqual([
      1, 2, 3
    ])
    await graph.dispose()
  })
})
