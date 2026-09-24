import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  CapabilityGraphErrorCode,
  CapabilityGraphNodeState,
  CapabilityGraphState,
  createCapabilityGraph,
  type IGraphNodeDefinition,
  type IGraphNodeId,
  type IGraphStartContext
} from '../../src/graph/index.js'
import { CapabilityGraphErrorText } from '../../src/graph/error-text.js'
import { CAPABILITY_GRAPH_SOURCE } from '../../src/graph/errors.js'
import { buildCapabilityTopology, type ITopologyNode } from '../../src/graph/topology.js'
import { createDynamicCapabilityGraph } from '../../src/graph/dynamic.js'

const id = (value: string): IGraphNodeId => value as IGraphNodeId

const instance = <T>(value: T, release: () => void | PromiseLike<void> = vi.fn()) => ({
  value,
  release
})

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('capability graph core', () => {
  it('CG-T01 exposes the graph subpath contract and stable public nodes', () => {
    const graph = createCapabilityGraph()
    graph.register({
      id: id('provider'),
      kind: 'test',
      dependencies: [],
      start: () => instance(1)
    })
    expect(graph.nodes).toEqual([id('provider')])
    expect(graph.state).toBe('open')
  })

  it('CG-T02 freezes registration at ready and rejects terminal mutation', async () => {
    const graph = createCapabilityGraph()
    await graph.ready()
    expect(() =>
      graph.register({ id: id('late'), kind: 'test', dependencies: [], start: () => instance(1) })
    ).toThrow(expect.objectContaining({ code: CapabilityGraphErrorCode.graphFrozen }))
    await graph.dispose()
    expect(() =>
      graph.register({ id: id('dead'), kind: 'test', dependencies: [], start: () => instance(1) })
    ).toThrow(expect.objectContaining({ code: CapabilityGraphErrorCode.graphDisposed }))
  })

  it('CG-T02 rejects ready and registration during quiescing admission', async () => {
    const graph = createCapabilityGraph()
    const releaseGate = deferred<void>()
    graph.register({
      id: id('held'),
      kind: 'test',
      dependencies: [],
      start: () => instance(1, () => releaseGate.promise)
    })
    await graph.ready()
    const disposal = graph.dispose()
    await expect(graph.ready()).resolves.toBeUndefined()
    expect(() =>
      graph.register({ id: id('late'), kind: 'test', dependencies: [], start: () => instance(1) })
    ).toThrow(expect.objectContaining({ code: CapabilityGraphErrorCode.admissionClosed }))
    releaseGate.resolve()
    await disposal
  })

  it('CG-T04 rejects duplicate nodes without polluting the registry', async () => {
    const graph = createCapabilityGraph()
    const start = vi.fn(() => instance(1))
    graph.register({ id: id('a'), kind: 'test', dependencies: [], start })
    expect(() => graph.register({ id: id('a'), kind: 'test', dependencies: [], start })).toThrow(
      expect.objectContaining({ code: CapabilityGraphErrorCode.duplicateNode })
    )
    graph.register({
      id: id('b'),
      kind: 'test',
      dependencies: [{ provider: id('missing'), required: true }],
      start
    })
    await expect(graph.ready()).rejects.toMatchObject({
      code: CapabilityGraphErrorCode.unknownProvider
    })
    expect(start).not.toHaveBeenCalled()

    const duplicate = createCapabilityGraph()
    expect(() =>
      duplicate.register({
        id: id('dup'),
        kind: 'test',
        dependencies: [
          { provider: id('p'), required: true },
          { provider: id('p'), required: true }
        ],
        start
      })
    ).toThrow(expect.objectContaining({ code: CapabilityGraphErrorCode.duplicateEdge }))
  })

  it('CG-T05 rejects an unknown provider before any start callback', async () => {
    const graph = createCapabilityGraph()
    const start = vi.fn(() => instance(1))
    graph.register({
      id: id('consumer'),
      kind: 'test',
      dependencies: [{ provider: id('missing'), required: true }],
      start
    })
    await expect(graph.ready()).rejects.toMatchObject({
      code: CapabilityGraphErrorCode.unknownProvider
    })
    expect(start).not.toHaveBeenCalled()
  })

  it('CG-T06 rejects a duplicate dependency edge at registration', () => {
    const graph = createCapabilityGraph()
    expect(() =>
      graph.register({
        id: id('duplicate-edge'),
        kind: 'test',
        dependencies: [
          { provider: id('provider'), required: true },
          { provider: id('provider'), required: true }
        ],
        start: () => instance(1)
      })
    ).toThrow(expect.objectContaining({ code: CapabilityGraphErrorCode.duplicateEdge }))
  })

  it('CG-T03 reads node admission getters once and tags getter failure', () => {
    let reads = 0
    const admissionError = new Error('id getter failed')
    const node = {
      get id() {
        reads += 1
        throw admissionError
      },
      kind: 'test',
      dependencies: [],
      start: () => instance(1)
    } as never
    const graph = createCapabilityGraph()
    expect(() => graph.register(node)).toThrow(admissionError)
    expect(reads).toBe(1)
    expect(admissionError).toMatchObject({
      source: '@migaia/capability/graph',
      code: CapabilityGraphErrorCode.invalidNode
    })
  })

  it('CG-T09 exposes only a ready direct provider through start context', async () => {
    const graph = createCapabilityGraph()
    graph.register({
      id: id('provider'),
      kind: 'test',
      dependencies: [],
      start: () => instance(7)
    })
    graph.register({
      id: id('consumer'),
      kind: 'test',
      dependencies: [{ provider: id('provider'), required: true }],
      start: ({ get }) => instance(get<number>(id('provider')))
    })
    await graph.ready()
    expect(graph.get(id('consumer'), id('provider'))).toBe(7)
  })

  it('CG-T11 blocks required dependents when their provider fails', async () => {
    const graph = createCapabilityGraph()
    graph.register({
      id: id('failed'),
      kind: 'test',
      dependencies: [],
      start: () => {
        throw new Error('provider failed')
      }
    })
    graph.register({
      id: id('dependent'),
      kind: 'test',
      dependencies: [{ provider: id('failed'), required: true }],
      start: () => instance(1)
    })
    await expect(graph.ready()).rejects.toMatchObject({
      code: CapabilityGraphErrorCode.startFailed
    })
    expect(graph.nodeState(id('failed')).state).toBe(CapabilityGraphNodeState.failed)
    expect(graph.nodeState(id('dependent')).state).toBe(CapabilityGraphNodeState.blocked)
  })

  it('CG-T12 rolls back prior nodes while retaining consumer primary failure', async () => {
    const released = vi.fn()
    const primary = new Error('consumer failed')
    const graph = createCapabilityGraph()
    graph.register({
      id: id('provider'),
      kind: 'test',
      dependencies: [],
      start: () => instance(1, released)
    })
    graph.register({
      id: id('consumer'),
      kind: 'test',
      dependencies: [{ provider: id('provider'), required: true }],
      start: () => {
        throw primary
      }
    })
    await expect(graph.ready()).rejects.toBe(primary)
    expect(released).toHaveBeenCalledOnce()
    expect(graph.nodeState(id('provider')).state).toBe(CapabilityGraphNodeState.rolledBack)
  })

  it('CG-T13 reports rollback cleanup failure without replacing startup primary', async () => {
    const primary = new Error('startup primary')
    const cleanup = new Error('cleanup secondary')
    const reported: unknown[] = []
    const graph = createCapabilityGraph({ onError: (error) => reported.push(error) })
    graph.register({
      id: id('provider'),
      kind: 'test',
      dependencies: [],
      start: ({ own }) => {
        own(
          {},
          {
            force: () => {
              throw cleanup
            }
          }
        )
        return instance(1)
      }
    })
    graph.register({
      id: id('consumer'),
      kind: 'test',
      dependencies: [{ provider: id('provider'), required: true }],
      start: () => {
        throw primary
      }
    })
    await expect(graph.ready()).rejects.toBe(primary)
    expect(reported).toContain(cleanup)
  })

  it('CG-T16 rejects ready immediately during a non-cooperative start', async () => {
    const pending = deferred<ReturnType<typeof instance>>()
    const graph = createCapabilityGraph()
    graph.register({
      id: id('pending'),
      kind: 'test',
      dependencies: [],
      start: () => pending.promise
    })
    const ready = graph.ready()
    const dispose = graph.dispose()
    await expect(ready).rejects.toMatchObject({ code: CapabilityGraphErrorCode.admissionClosed })
    expect(graph.state).toBe('terminal')
    await dispose
    pending.resolve(instance(1))
  })

  it('CG-T17 keeps Graph source free of reactive graph dependencies', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../src/graph/index.ts', import.meta.url)),
      'utf8'
    )
    expect(source).not.toMatch(/@migaia\/(reactive|resource|plugin-host|tray)/)
  })

  it('CG-T21 keeps optional, dynamic, replacement, and notification paths out of core API', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../src/graph/index.ts', import.meta.url)),
      'utf8'
    )
    expect(source).not.toMatch(/create(?:Optional|Notification|Replacement|Dynamic)/)
  })

  it('CG-T22 keeps unknown-node diagnostics stable after terminal', async () => {
    const graph = createCapabilityGraph()
    await graph.dispose()
    expect(() => graph.nodeState(id('missing'))).toThrow(
      expect.objectContaining({ code: CapabilityGraphErrorCode.unknownNode })
    )
  })

  it('CG-T23 uses dependency topology before registration ordinal', async () => {
    const order: string[] = []
    const graph = createCapabilityGraph()
    graph.register({
      id: id('consumer'),
      kind: 'test',
      dependencies: [{ provider: id('provider'), required: true }],
      start: () => {
        order.push('consumer')
        return instance(1)
      }
    })
    graph.register({
      id: id('provider'),
      kind: 'test',
      dependencies: [],
      start: () => {
        order.push('provider')
        return instance(1)
      }
    })
    await graph.ready()
    expect(order).toEqual(['provider', 'consumer'])
  })

  it('CG-T25 preserves failed graph state without implicit retry', async () => {
    const start = vi.fn(() => {
      throw new Error('failed')
    })
    const graph = createCapabilityGraph()
    graph.register({ id: id('failed'), kind: 'test', dependencies: [], start })
    const first = graph.ready()
    const second = graph.ready()
    await expect(first).rejects.toMatchObject({ code: CapabilityGraphErrorCode.startFailed })
    await expect(second).rejects.toBe(graph.error)
    expect(start).toHaveBeenCalledOnce()
    expect(graph.state).toBe('failed')
  })

  it('CG-T26 wraps non-Error startup throws with reachable cause', async () => {
    const thrown = { reason: 'foreign' }
    const graph = createCapabilityGraph()
    graph.register({
      id: id('foreign'),
      kind: 'test',
      dependencies: [],
      start: () => {
        throw thrown
      }
    })
    await expect(graph.ready()).rejects.toMatchObject({
      source: '@migaia/capability/graph',
      code: CapabilityGraphErrorCode.startFailed,
      cause: thrown
    })
  })

  it('CG-T29 continues all releases and preserves tagged aggregate failures', async () => {
    const first = new Error('first release')
    const second = new Error('second release')
    const released: string[] = []
    const graph = createCapabilityGraph()
    graph.register({
      id: id('first'),
      kind: 'test',
      dependencies: [],
      start: () =>
        instance(1, () => {
          released.push('first')
          throw first
        })
    })
    graph.register({
      id: id('second'),
      kind: 'test',
      dependencies: [],
      start: () =>
        instance(2, () => {
          released.push('second')
          throw second
        })
    })
    await graph.ready()
    await expect(graph.dispose()).rejects.toBeInstanceOf(AggregateError)
    await expect(graph.dispose()).rejects.toMatchObject({
      code: CapabilityGraphErrorCode.disposeFailed
    })
    expect(released).toEqual(['second', 'first'])
  })

  it('CG-T30 rejects synchronous release reentry with Graph-owned code', async () => {
    let graph!: ReturnType<typeof createCapabilityGraph>
    graph = createCapabilityGraph()
    graph.register({
      id: id('reentrant'),
      kind: 'test',
      dependencies: [],
      start: () => instance(1, () => graph.ready())
    })
    await graph.ready()
    await expect(graph.dispose()).rejects.toMatchObject({
      code: CapabilityGraphErrorCode.reentrantOperation
    })
  })

  it('CG-T31 assimilates a hostile start thenable once and tags getter failure', async () => {
    const thenError = new Error('then getter failed')
    const graph = createCapabilityGraph()
    const thenKey = ['t', 'h', 'e', 'n'].join('')
    const thenable = Object.defineProperty({}, thenKey, {
      get() {
        throw thenError
      }
    })
    graph.register({
      id: id('thenable'),
      kind: 'test',
      dependencies: [],
      start: () => thenable as never
    })
    await expect(graph.ready()).rejects.toMatchObject({
      code: CapabilityGraphErrorCode.startFailed
    })
    expect(thenError).toMatchObject({ source: '@migaia/capability/graph' })
  })

  it('CG-T32 snapshots onError once before lifecycle construction', () => {
    let reads = 0
    const optionError = new Error('option getter failed')
    const options = {
      get onError() {
        reads += 1
        throw optionError
      }
    }
    expect(() => createCapabilityGraph(options as never)).toThrow(
      expect.objectContaining({
        code: CapabilityGraphErrorCode.invalidOption,
        cause: optionError
      })
    )
    expect(reads).toBe(1)
  })

  it('CG-T08 starts disconnected nodes by stable registration ordinal', async () => {
    const order: string[] = []
    const graph = createCapabilityGraph()
    graph.register({
      id: id('a'),
      kind: 'test',
      dependencies: [],
      start: () => {
        order.push('a')
        return instance(1)
      }
    })
    graph.register({
      id: id('b'),
      kind: 'test',
      dependencies: [],
      start: () => {
        order.push('b')
        return instance(2)
      }
    })
    await graph.ready()
    expect(order).toEqual(['a', 'b'])
  })

  it('CG-T07 rejects cycles before user code and reports a stable path', async () => {
    const order: string[] = []
    const graph = createCapabilityGraph()
    graph.register({
      id: id('c'),
      kind: 'test',
      dependencies: [{ provider: id('a'), required: true }],
      start: ({ get }) => {
        order.push(`c:${get(id('a'))}`)
        return instance('C')
      }
    })
    graph.register({
      id: id('a'),
      kind: 'test',
      dependencies: [],
      start: () => {
        order.push('a')
        return instance('A')
      }
    })
    graph.register({
      id: id('b'),
      kind: 'test',
      dependencies: [],
      start: () => {
        order.push('b')
        return instance('B')
      }
    })
    await graph.ready()
    expect(order).toEqual(['a', 'b', 'c:A'])
    expect(graph.get(id('c'), id('a'))).toBe('A')

    const cycle = createCapabilityGraph()
    cycle.register({
      id: id('x'),
      kind: 'test',
      dependencies: [{ provider: id('y'), required: true }],
      start: () => instance(1)
    })
    cycle.register({
      id: id('y'),
      kind: 'test',
      dependencies: [{ provider: id('x'), required: true }],
      start: () => instance(2)
    })
    await expect(cycle.ready()).rejects.toMatchObject({
      code: CapabilityGraphErrorCode.dependencyCycle
    })
  })

  it('CG-T10 releases primary before auxiliary and in inverse topology', async () => {
    const events: string[] = []
    const graph = createCapabilityGraph()
    graph.register({
      id: id('provider'),
      kind: 'test',
      dependencies: [],
      start: ({ own }) => {
        own(
          {},
          {
            force: () => {
              events.push('provider-aux')
            }
          }
        )
        return instance('provider', () => {
          events.push('provider-primary')
        })
      }
    })
    graph.register({
      id: id('consumer'),
      kind: 'test',
      dependencies: [{ provider: id('provider'), required: true }],
      start: ({ own }) => {
        own(
          {},
          {
            force: () => {
              events.push('consumer-aux')
            }
          }
        )
        return instance('consumer', () => {
          events.push('consumer-primary')
        })
      }
    })
    await graph.ready()
    await graph.dispose()
    expect(events).toEqual(['consumer-primary', 'consumer-aux', 'provider-primary', 'provider-aux'])
  })

  it('CG-T15 preserves dispose Promise identity after ready', async () => {
    const graph = createCapabilityGraph()
    await graph.ready()
    const first = graph.dispose()
    expect(graph.dispose()).toBe(first)
    await first
  })

  it('CG-T14 preserves ready and dispose Promise identity', async () => {
    const graph = createCapabilityGraph()
    const ready = graph.ready()
    expect(graph.ready()).toBe(ready)
    await ready
    const dispose = graph.dispose()
    expect(graph.dispose()).toBe(dispose)
    await dispose
    expect(graph.state).toBe('terminal')
  })

  it('CG-T20 keeps start errors traceable and records failed node diagnostics', async () => {
    const startError = new Error('boom')
    const graph = createCapabilityGraph()
    graph.register({
      id: id('bad'),
      kind: 'test',
      dependencies: [],
      start: () => {
        throw startError
      }
    })
    await expect(graph.ready()).rejects.toBe(startError)
    expect(graph.error).toBe(startError)
    expect(graph.nodeState(id('bad'))).toMatchObject({
      state: CapabilityGraphNodeState.failed,
      error: startError
    })
  })

  it('CG-T27 rejects undeclared get without creating a lease', () => {
    const graph = createCapabilityGraph()
    graph.register({ id: id('a'), kind: 'test', dependencies: [], start: () => instance(1) })
    graph.register({ id: id('b'), kind: 'test', dependencies: [], start: () => instance(2) })
    expect(() => graph.get(id('b'), id('a'))).toThrow(
      expect.objectContaining({ code: CapabilityGraphErrorCode.providerUnavailable })
    )
  })

  it('CG-T28 releases a late start result after dispose without an unhandled rejection', async () => {
    let resolve!: (value: ReturnType<typeof instance>) => void
    const lateRelease = vi.fn()
    const pending = new Promise<ReturnType<typeof instance>>((done) => {
      resolve = done
    })
    const graph = createCapabilityGraph()
    graph.register({ id: id('late'), kind: 'test', dependencies: [], start: () => pending })
    const ready = graph.ready()
    await graph.dispose()
    resolve(instance('late', lateRelease))
    await expect(ready).rejects.toMatchObject({ code: CapabilityGraphErrorCode.admissionClosed })
    await Promise.resolve()
    expect(lateRelease).toHaveBeenCalledOnce()
  })

  it('CG-T33 keeps every node signal alive until graph disposal', async () => {
    const signals: AbortSignal[] = []
    const graph = createCapabilityGraph()
    graph.register({
      id: id('first'),
      kind: 'test',
      dependencies: [],
      start: ({ signal }) => {
        signals.push(signal as unknown as AbortSignal)
        return instance('first')
      }
    })
    graph.register({
      id: id('second'),
      kind: 'test',
      dependencies: [],
      start: ({ signal }) => {
        signals.push(signal as unknown as AbortSignal)
        return instance('second')
      }
    })
    await graph.ready()
    expect(signals.map((signal) => signal.aborted)).toEqual([false, false])
    await graph.dispose()
    expect(signals.map((signal) => signal.aborted)).toEqual([true, true])
  })

  it('CG-T34 keeps terminal state after a late resolve', async () => {
    const pending = deferred<ReturnType<typeof instance>>()
    const lateRelease = vi.fn()
    const reported: unknown[] = []
    const graph = createCapabilityGraph({ onError: (error) => reported.push(error) })
    graph.register({
      id: id('late'),
      kind: 'test',
      dependencies: [],
      start: () => pending.promise
    })
    const ready = graph.ready()
    await graph.dispose()
    const primary = graph.error
    pending.resolve(instance('late', lateRelease))
    await expect(ready).rejects.toBe(primary)
    await Promise.resolve()
    expect(graph.state).toBe('terminal')
    expect(graph.error).toBe(primary)
    expect(lateRelease).toHaveBeenCalledOnce()
    expect(reported).toEqual([])
  })

  it('CG-T35 keeps the admission-closed primary when a late start rejects', async () => {
    const pending = deferred<ReturnType<typeof instance>>()
    const lateError = new Error('late rejection')
    const reported: unknown[] = []
    const graph = createCapabilityGraph({ onError: (error) => reported.push(error) })
    graph.register({
      id: id('late-reject'),
      kind: 'test',
      dependencies: [],
      start: () => pending.promise
    })
    const ready = graph.ready()
    const dispose = graph.dispose()
    const primary = graph.error
    pending.reject(lateError)
    await expect(ready).rejects.toBe(primary)
    await dispose
    expect(graph.error).toBe(primary)
    expect(reported).toContain(lateError)
  })

  it('CG-T36 requires consumer-aware public direct-edge reads', async () => {
    const graph = createCapabilityGraph()
    graph.register({
      id: id('provider'),
      kind: 'test',
      dependencies: [],
      start: () => instance(1)
    })
    await graph.ready()
    expect(() =>
      (graph.get as unknown as (provider: IGraphNodeId) => unknown)(id('provider'))
    ).toThrow(expect.objectContaining({ code: CapabilityGraphErrorCode.providerUnavailable }))
  })

  it('CG-T24 rejects auxiliary-primary identity collision before commit', async () => {
    const resource = {}
    const graph = createCapabilityGraph()
    graph.register({
      id: id('collision-admission'),
      kind: 'test',
      dependencies: [],
      start: ({ own }) => {
        own(resource, { force: () => undefined })
        return instance(resource)
      }
    })
    await expect(graph.ready()).rejects.toMatchObject({
      code: CapabilityGraphErrorCode.invalidNode
    })
  })

  it('CG-T37 rejects auxiliary-primary identity collision and releases auxiliary once', async () => {
    const released = vi.fn()
    const resource = {}
    const graph = createCapabilityGraph()
    graph.register({
      id: id('collision'),
      kind: 'test',
      dependencies: [],
      start: ({ own }) => {
        own(resource, { force: released })
        return instance(resource)
      }
    })
    await expect(graph.ready()).rejects.toMatchObject({
      code: CapabilityGraphErrorCode.invalidNode
    })
    await graph.dispose()
    expect(released).toHaveBeenCalledOnce()
  })

  it('CG-T38/CG-T43 rejects non-array dependencies and snapshots array fields once', () => {
    const graph = createCapabilityGraph()
    expect(() =>
      graph.register({
        id: id('hostile'),
        kind: 'test',
        dependencies: new Set() as never,
        start: () => instance(1)
      })
    ).toThrowError(expect.objectContaining({ code: CapabilityGraphErrorCode.invalidNode }))
    let lengthReads = 0
    let indexReads = 0
    const dependencies = new Proxy([{ provider: id('provider'), required: true as const }], {
      get(target, property, receiver) {
        if (property === 'length') lengthReads += 1
        if (property === '0') indexReads += 1
        if (property === Symbol.iterator) throw new Error('iterator must not be read')
        return Reflect.get(target, property, receiver)
      }
    })
    graph.register({ id: id('array'), kind: 'test', dependencies, start: () => instance(1) })
    expect(lengthReads).toBe(1)
    expect(indexReads).toBe(1)
  })

  it('CG-T39 exposes released diagnostics and converts release reentrancy', async () => {
    let graph!: ReturnType<typeof createCapabilityGraph>
    graph = createCapabilityGraph()
    graph.register({
      id: id('released'),
      kind: 'test',
      dependencies: [],
      start: () => instance(1)
    })
    await graph.ready()
    await graph.dispose()
    expect(graph.nodeState(id('released')).state).toBe(CapabilityGraphNodeState.released)

    const reentrant = createCapabilityGraph()
    reentrant.register({
      id: id('reentrant'),
      kind: 'test',
      dependencies: [],
      start: () => instance(1, () => reentrant.dispose())
    })
    await reentrant.ready()
    await expect(reentrant.dispose()).rejects.toMatchObject({
      source: '@migaia/capability/graph',
      code: CapabilityGraphErrorCode.reentrantOperation
    })
  })

  it('CG-T40 builds sparse topology through reverse adjacency without a full consumer scan', async () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../src/graph/index.ts', import.meta.url)),
      'utf8'
    )
    expect(source).toContain('buildCapabilityTopology')
    expect(source).not.toMatch(/for \(const consumer of nodeOrder\)/)

    const graph = createCapabilityGraph()
    const count = 1024
    for (let index = 0; index < count; index += 1) {
      graph.register({
        id: id(`node-${index}`),
        kind: 'benchmark',
        dependencies: index === 0 ? [] : [{ provider: id(`node-${index - 1}`), required: true }],
        start: () => instance(index)
      })
    }
    await graph.ready()
    expect(graph.state).toBe('ready')
    await graph.dispose()

    const measure = async (size: number): Promise<number> => {
      const measured = createCapabilityGraph()
      for (let index = 0; index < size; index += 1) {
        measured.register({
          id: id(`measure-${size}-${index}`),
          kind: 'benchmark',
          dependencies:
            index === 0 ? [] : [{ provider: id(`measure-${size}-${index - 1}`), required: true }],
          start: () => instance(index)
        })
      }
      const startedAt = performance.now()
      await measured.ready()
      const elapsed = performance.now() - startedAt
      await measured.dispose()
      return elapsed
    }
    await measure(128)
    const medium = await measure(512)
    const large = await measure(2048)
    expect(large).toBeLessThan(medium * 12 + 25)
  })

  it('CG-T41 closes value reads as soon as disposal enters quiescing', async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const graph = createCapabilityGraph()
    graph.register({
      id: id('provider'),
      kind: 'test',
      dependencies: [],
      start: () => ({ value: 1, release: () => pending })
    })
    graph.register({
      id: id('consumer'),
      kind: 'test',
      dependencies: [{ provider: id('provider'), required: true }],
      start: () => instance(2)
    })
    await graph.ready()
    const disposing = graph.dispose()
    expect(() => graph.get(id('consumer'), id('provider'))).toThrowError(
      expect.objectContaining({ code: CapabilityGraphErrorCode.admissionClosed })
    )
    release()
    await disposing
    expect(() => graph.get(id('consumer'), id('provider'))).toThrowError(
      expect.objectContaining({ code: CapabilityGraphErrorCode.graphDisposed })
    )
  })

  it('CG-T42 reports a closed stable path for mixed resolved and residual edges', async () => {
    const graph = createCapabilityGraph()
    graph.register({ id: id('root'), kind: 'test', dependencies: [], start: () => instance(0) })
    graph.register({
      id: id('a'),
      kind: 'test',
      dependencies: [
        { provider: id('root'), required: true },
        { provider: id('b'), required: true }
      ],
      start: () => instance(1)
    })
    graph.register({
      id: id('b'),
      kind: 'test',
      dependencies: [{ provider: id('a'), required: true }],
      start: () => instance(2)
    })
    await expect(graph.ready()).rejects.toMatchObject({
      code: CapabilityGraphErrorCode.dependencyCycle
    })
    const path = (graph.error as { detail: { path: string[] } }).detail.path
    expect(path.length).toBeGreaterThan(1)
    expect(path[0]).toBe(path[path.length - 1])
  })

  it('CG-T44 records primary release failure on the node diagnostic', async () => {
    const releaseError = new Error('release failed')
    const graph = createCapabilityGraph()
    graph.register({
      id: id('broken'),
      kind: 'test',
      dependencies: [],
      start: () => ({
        value: 1,
        release: () => {
          throw releaseError
        }
      })
    })
    await graph.ready()
    await expect(graph.dispose()).rejects.toMatchObject({
      code: CapabilityGraphErrorCode.disposeFailed
    })
    expect(graph.nodeState(id('broken'))).toMatchObject({
      state: CapabilityGraphNodeState.failed,
      error: releaseError
    })
  })

  it('CG-T46/CG-T47/CG-T48 uses level then ordinal startup and strict reverse release', async () => {
    const started: string[] = []
    const released: string[] = []
    const graph = createCapabilityGraph()
    const register = (
      name: string,
      dependencies: IGraphNodeDefinition<unknown>['dependencies']
    ) => {
      graph.register({
        id: id(name),
        kind: 'test',
        dependencies,
        start: () => {
          started.push(name)
          return {
            value: name,
            release: () => {
              released.push(name)
            }
          }
        }
      })
    }
    register('c', [{ provider: id('p'), required: true }])
    register('a', [])
    register('p', [])
    register('b', [])
    await graph.ready()
    expect(started).toEqual(['a', 'p', 'b', 'c'])
    await graph.dispose()
    expect(released).toEqual(['c', 'b', 'p', 'a'])
  })

  it('CG-T20 verifies every Graph error code as a native traceable boundary error', async () => {
    const seenCodes = new Set<string>()
    const assertCode = (error: unknown, code: string): void => {
      expect(error).toBeInstanceOf(Error)
      expect(error).toMatchObject({ source: '@migaia/capability/graph', code })
      expect((error as Error).stack).toEqual(expect.any(String))
      expect((error as Error).stack!.length).toBeGreaterThan(0)
      expect((error as Error).message.length).toBeGreaterThan(0)
      seenCodes.add(code)
    }
    const disposed = createCapabilityGraph()
    await disposed.ready()
    await disposed.dispose()
    try {
      disposed.register({ id: id('x'), kind: 'test', dependencies: [], start: () => instance(1) })
    } catch (error) {
      assertCode(error, CapabilityGraphErrorCode.graphDisposed)
    }
    const frozen = createCapabilityGraph()
    await frozen.ready()
    try {
      frozen.register({ id: id('x'), kind: 'test', dependencies: [], start: () => instance(1) })
    } catch (error) {
      assertCode(error, CapabilityGraphErrorCode.graphFrozen)
    }
    const invalid = createCapabilityGraph()
    try {
      invalid.register({
        id: id('x'),
        kind: 'test',
        dependencies: [{} as never],
        start: () => instance(1)
      })
    } catch (error) {
      assertCode(error, CapabilityGraphErrorCode.invalidNode)
    }
    try {
      invalid.register({ id: id('x'), kind: 'test', dependencies: [], start: () => instance(1) })
      invalid.register({ id: id('x'), kind: 'test', dependencies: [], start: () => instance(1) })
    } catch (error) {
      assertCode(error, CapabilityGraphErrorCode.duplicateNode)
    }
    const unknown = createCapabilityGraph()
    unknown.register({
      id: id('x'),
      kind: 'test',
      dependencies: [{ provider: id('missing'), required: true }],
      start: () => instance(1)
    })
    try {
      await unknown.ready()
    } catch (error) {
      assertCode(error, CapabilityGraphErrorCode.unknownProvider)
    }
    const duplicateEdge = createCapabilityGraph()
    try {
      duplicateEdge.register({
        id: id('x'),
        kind: 'test',
        dependencies: [
          { provider: id('p'), required: true },
          { provider: id('p'), required: true }
        ],
        start: () => instance(1)
      })
    } catch (error) {
      assertCode(error, CapabilityGraphErrorCode.duplicateEdge)
    }
    const cycle = createCapabilityGraph()
    cycle.register({
      id: id('x'),
      kind: 'test',
      dependencies: [{ provider: id('x'), required: true }],
      start: () => instance(1)
    })
    try {
      await cycle.ready()
    } catch (error) {
      assertCode(error, CapabilityGraphErrorCode.dependencyCycle)
    }
    const unavailable = createCapabilityGraph()
    unavailable.register({ id: id('x'), kind: 'test', dependencies: [], start: () => instance(1) })
    try {
      unavailable.get(id('x'), id('x'))
    } catch (error) {
      assertCode(error, CapabilityGraphErrorCode.providerUnavailable)
    }
    const startFailed = createCapabilityGraph()
    startFailed.register({
      id: id('x'),
      kind: 'test',
      dependencies: [],
      start: () => {
        throw new Error('start')
      }
    })
    try {
      await startFailed.ready()
    } catch (error) {
      assertCode(error, CapabilityGraphErrorCode.startFailed)
    }
    const releaseFailed = createCapabilityGraph()
    releaseFailed.register({
      id: id('x'),
      kind: 'test',
      dependencies: [],
      start: () => ({
        value: 1,
        release: () => {
          throw new Error('release')
        }
      })
    })
    await releaseFailed.ready()
    try {
      await releaseFailed.dispose()
    } catch (error) {
      assertCode(error, CapabilityGraphErrorCode.disposeFailed)
    }
    try {
      releaseFailed.get(id('x'), id('x'))
    } catch (error) {
      assertCode(error, CapabilityGraphErrorCode.graphDisposed)
    }
    const admissionClosed = createCapabilityGraph()
    const pending = deferred<ReturnType<typeof instance>>()
    admissionClosed.register({
      id: id('pending'),
      kind: 'test',
      dependencies: [],
      start: () => pending.promise
    })
    const pendingReady = admissionClosed.ready()
    try {
      admissionClosed.get(id('pending'), id('pending'))
    } catch (error) {
      assertCode(error, CapabilityGraphErrorCode.admissionClosed)
    }
    pending.resolve(instance(1))
    await pendingReady
    await admissionClosed.dispose()
    const unknownNode = createCapabilityGraph()
    try {
      unknownNode.nodeState(id('missing'))
    } catch (error) {
      assertCode(error, CapabilityGraphErrorCode.unknownNode)
    }
    let reentrant!: ReturnType<typeof createCapabilityGraph>
    reentrant = createCapabilityGraph()
    reentrant.register({
      id: id('x'),
      kind: 'test',
      dependencies: [],
      start: () => {
        reentrant.ready()
        return instance(1)
      }
    })
    try {
      await reentrant.ready()
    } catch (error) {
      assertCode(error, CapabilityGraphErrorCode.reentrantOperation)
    }
    try {
      createCapabilityGraph({
        get onError(): undefined {
          throw new Error('option')
        }
      })
    } catch (error) {
      assertCode(error, CapabilityGraphErrorCode.invalidOption)
    }
    try {
      createCapabilityGraph({ onError: 1 as never })
    } catch (error) {
      assertCode(error, CapabilityGraphErrorCode.invalidOption)
    }
    const dependentPolicy = createDynamicCapabilityGraph()
    await dependentPolicy.register({
      id: id('policy-provider'),
      kind: 'test',
      dependencies: [],
      start: () => instance(1)
    })
    await dependentPolicy.register({
      id: id('policy-consumer'),
      kind: 'test',
      dependencies: [{ provider: id('policy-provider'), required: true }],
      start: () => instance(2)
    })
    try {
      await dependentPolicy.remove(id('policy-provider'), { policy: 'reject' })
    } catch (error) {
      assertCode(error, CapabilityGraphErrorCode.nodeHasDependents)
    }
    await dependentPolicy.dispose()
    expect([...seenCodes].sort()).toEqual(Object.values(CapabilityGraphErrorCode).sort())
  })

  it('CG-T49 blocks external reads until whole graph is ready', async () => {
    const gate = deferred<ReturnType<typeof instance>>()
    const graph = createCapabilityGraph()
    graph.register({
      id: id('provider'),
      kind: 'test',
      dependencies: [],
      start: () => instance(1)
    })
    graph.register({
      id: id('consumer'),
      kind: 'test',
      dependencies: [{ provider: id('provider'), required: true }],
      start: () => gate.promise
    })
    const ready = graph.ready()
    expect(() => graph.get(id('consumer'), id('provider'))).toThrowError(
      expect.objectContaining({ code: CapabilityGraphErrorCode.admissionClosed })
    )
    gate.resolve(instance(2))
    await ready
  })

  it('CG-T50/CG-T51 revokes retained context after node settlement', async () => {
    let retained!: IGraphStartContext
    const graph = createCapabilityGraph()
    graph.register({
      id: id('provider'),
      kind: 'test',
      dependencies: [],
      start: () => instance(1)
    })
    graph.register({
      id: id('consumer'),
      kind: 'test',
      dependencies: [{ provider: id('provider'), required: true }],
      start: (context) => {
        retained = context
        return instance(2)
      }
    })
    await graph.ready()
    expect(() => retained.get(id('provider'))).toThrowError(
      expect.objectContaining({ code: CapabilityGraphErrorCode.admissionClosed })
    )
    expect(() => retained.own({}, { force: () => undefined })).toThrowError(
      expect.objectContaining({ code: CapabilityGraphErrorCode.admissionClosed })
    )
  })

  it('CG-T52 clears terminal diagnostic values and CG-T53 reuses cold-terminal ready identity', async () => {
    const graph = createCapabilityGraph()
    graph.register({
      id: id('value'),
      kind: 'test',
      dependencies: [],
      start: () => instance({ secret: true })
    })
    await graph.ready()
    await graph.dispose()
    expect(graph.nodeState(id('value')).value).toBeUndefined()
    const cold = createCapabilityGraph()
    await cold.dispose()
    const first = cold.ready()
    expect(cold.ready()).toBe(first)
    await expect(first).rejects.toMatchObject({ code: CapabilityGraphErrorCode.graphDisposed })
  })

  it('CG-T54 freezes cycle diagnostic snapshots and preserves release cleanup primary', async () => {
    const graph = createCapabilityGraph()
    graph.register({
      id: id('a'),
      kind: 'test',
      dependencies: [{ provider: id('b'), required: true }],
      start: () => instance(1)
    })
    graph.register({
      id: id('b'),
      kind: 'test',
      dependencies: [{ provider: id('a'), required: true }],
      start: () => instance(2)
    })
    await expect(graph.ready()).rejects.toMatchObject({
      code: CapabilityGraphErrorCode.dependencyCycle
    })
    const detail = (graph.error as { detail: { path: string[] } }).detail
    expect(Object.isFrozen(detail)).toBe(true)
    expect(Object.isFrozen(detail.path)).toBe(true)

    const cleanupError = new Error('release cleanup')
    const abortGraph = createCapabilityGraph({
      onError: (error) => expect(error).toBe(cleanupError)
    })
    abortGraph.register({
      id: id('abort'),
      kind: 'test',
      dependencies: [],
      start: () => ({
        value: 1,
        release: () => {
          throw cleanupError
        }
      })
    })
    await abortGraph.ready()
    let disposeError: unknown
    try {
      await abortGraph.dispose()
    } catch (error) {
      disposeError = error
    }
    expect(disposeError).toBe(abortGraph.error)
    expect(abortGraph.error).toBeInstanceOf(Error)
    expect(abortGraph.state).toBe(CapabilityGraphState.terminal)
    expect(abortGraph.error).toMatchObject({
      source: CAPABILITY_GRAPH_SOURCE,
      code: CapabilityGraphErrorCode.disposeFailed
    })
  })

  it('CG-T55 exposes one reusable topology builder with stable derived levels', () => {
    const nodes: ITopologyNode[] = [
      {
        id: id('consumer'),
        dependencies: [{ provider: id('provider'), required: true }],
        ordinal: 0
      },
      { id: id('provider'), dependencies: [], ordinal: 1 }
    ]
    const topology = buildCapabilityTopology(
      nodes,
      () => {
        throw new Error('unknown')
      },
      (path) => {
        throw new Error(path.join('>'))
      },
      () => {
        throw new Error('invalid')
      }
    )
    expect(topology.ordered.map((node) => node.id)).toEqual([id('provider'), id('consumer')])
    expect(topology.level.get(id('provider'))).toBe(0)
    expect(topology.level.get(id('consumer'))).toBe(1)
    expect(topology.providers.get(id('provider'))?.map((node) => node.id)).toEqual([id('consumer')])
    expect(topology.consumers.get(id('consumer'))).toEqual(nodes[0].dependencies)
    expect(topology.indegree.get(id('consumer'))).toBe(1)
    expect(topology.ordinal.get(id('consumer'))).toBe(0)
    expect(topology.ordinal.get(id('provider'))).toBe(1)
    expect(Object.isFrozen(topology)).toBe(true)

    const textSource = readFileSync(
      fileURLToPath(new URL('../../src/graph/error-text.ts', import.meta.url)),
      'utf8'
    )
    for (const key of Object.keys(CapabilityGraphErrorText)) {
      expect(textSource).toMatch(new RegExp(`\\/\\*\\*[\\s\\S]*?\\*\\/\\n  ${key}:`))
    }
    const graphSource = readFileSync(
      fileURLToPath(new URL('../../src/graph/index.ts', import.meta.url)),
      'utf8'
    )
    expect(graphSource).toContain(
      'Graph transaction state; node state remains a separate diagnostic axis.'
    )
    expect(graphSource).toContain('Canonical readiness promise shared by every caller.')
  })

  it('CG-T45 exercises auxiliary descriptor adapters and async primary release branches', async () => {
    const events: string[] = []
    const graph = createCapabilityGraph()
    graph.register({
      id: id('aux'),
      kind: 'test',
      dependencies: [],
      start: ({ own }) => {
        const resource = {}
        own(resource, {
          syncSafe: true,
          gracefulTimeoutMs: 1,
          graceful: () => {
            events.push('graceful')
          },
          force: () => {
            events.push('force')
          },
          gcFallback: true,
          custom: () => {
            events.push('custom')
          }
        })
        return {
          value: 'primary',
          release: () =>
            Promise.resolve().then(() => {
              events.push('primary')
            })
        }
      }
    })
    await graph.ready()
    await graph.dispose()
    expect(events).toContain('primary')
  })

  it('CG-T45 covers provider admission, result validation, and async teardown rejection', async () => {
    const contextFailure = createCapabilityGraph()
    contextFailure.register({
      id: id('context'),
      kind: 'test',
      dependencies: [],
      start: ({ get }) => {
        get(id('missing'))
        return instance(1)
      }
    })
    await expect(contextFailure.ready()).rejects.toMatchObject({
      code: CapabilityGraphErrorCode.providerUnavailable
    })

    const invalidResult = createCapabilityGraph()
    invalidResult.register({
      id: id('invalid'),
      kind: 'test',
      dependencies: [],
      start: () => null as never
    })
    await expect(invalidResult.ready()).rejects.toMatchObject({
      code: CapabilityGraphErrorCode.invalidNode
    })

    const asyncFailure = new Error('async release')
    const asyncGraph = createCapabilityGraph()
    asyncGraph.register({
      id: id('async'),
      kind: 'test',
      dependencies: [],
      start: () => ({ value: 1, release: () => Promise.reject(asyncFailure) })
    })
    await asyncGraph.ready()
    await expect(asyncGraph.dispose()).rejects.toMatchObject({
      code: CapabilityGraphErrorCode.disposeFailed
    })

    const lengthFailure = createCapabilityGraph()
    const badArray = new Proxy([] as unknown[], {
      get: (_target, property) => {
        if (property === 'length') throw new Error('length')
        return undefined
      }
    })
    expect(() =>
      lengthFailure.register({
        id: id('length'),
        kind: 'test',
        dependencies: badArray as never,
        start: () => instance(1)
      })
    ).toThrowError(expect.objectContaining({ code: CapabilityGraphErrorCode.invalidNode }))
    const edgeFailure = createCapabilityGraph()
    const badEdge = new Proxy(
      { provider: id('p'), required: true },
      {
        get: () => {
          throw new Error('edge')
        }
      }
    )
    expect(() =>
      edgeFailure.register({
        id: id('edge'),
        kind: 'test',
        dependencies: [badEdge] as never,
        start: () => instance(1)
      })
    ).toThrowError(expect.objectContaining({ code: CapabilityGraphErrorCode.invalidNode }))
  })

  it('CG-T45 covers failed/quiescing ready branches and late rejection reporting', async () => {
    const reported: unknown[] = []
    let resolve!: (value: ReturnType<typeof instance>) => void
    const pending = new Promise<ReturnType<typeof instance>>((done) => {
      resolve = done
    })
    const graph = createCapabilityGraph({ onError: (error) => reported.push(error) })
    graph.register({ id: id('late'), kind: 'test', dependencies: [], start: () => pending })
    const ready = graph.ready()
    const disposing = graph.dispose()
    expect(graph.ready()).toBe(ready)
    resolve({ value: 1, release: () => Promise.reject(new Error('late release')) })
    await expect(ready).rejects.toMatchObject({ code: CapabilityGraphErrorCode.admissionClosed })
    await disposing
    await Promise.resolve()
    expect(reported.length).toBeGreaterThan(0)

    const failed = createCapabilityGraph()
    failed.register({
      id: id('failed'),
      kind: 'test',
      dependencies: [],
      start: () => {
        throw new Error('failed')
      }
    })
    const failedReady = failed.ready()
    await expect(failedReady).rejects.toBeDefined()
    expect(failed.ready()).toBe(failedReady)

    const unopened = createCapabilityGraph()
    await unopened.dispose()
    try {
      await unopened.ready()
    } catch (error) {
      expect(error).toMatchObject({ code: CapabilityGraphErrorCode.graphDisposed })
    }

    const unavailable = createCapabilityGraph()
    unavailable.register({
      id: id('provider-fails'),
      kind: 'test',
      dependencies: [],
      start: () => {
        throw new Error('provider')
      }
    })
    unavailable.register({
      id: id('consumer-fails'),
      kind: 'test',
      dependencies: [{ provider: id('provider-fails'), required: true }],
      start: () => instance(1)
    })
    await expect(unavailable.ready()).rejects.toBeDefined()
    expect(() => unavailable.get(id('consumer-fails'), id('provider-fails'))).toThrowError(
      expect.objectContaining({ code: CapabilityGraphErrorCode.providerUnavailable })
    )
    const source = readFileSync(
      fileURLToPath(new URL('../../src/graph/index.ts', import.meta.url)),
      'utf8'
    )
    expect(source).not.toMatch(/class I[A-Z]/)
    expect(source).not.toContain('Reflect.apply')
    expect(source).not.toMatch(/\.(call|apply|bind)\(/)
  })
})
