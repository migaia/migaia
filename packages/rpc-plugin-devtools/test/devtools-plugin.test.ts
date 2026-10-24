import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { readProbeStages, RpcProbeStage } from '@migaia/rpc-host/probe'
import * as entry from '../src/index.js'
import * as collectorOwner from '../src/collector/devtools.js'
import type { IRpcDevtoolsOptions } from '../src/collector-types.js'
import type { IDevtoolsPlugin } from '../src/index.js'
import type { IRpcDevtoolsWatchBatch } from '../src/contract/service.js'
import { collectorView } from './collector/fixture.js'
import { memoryServer } from '../../rpc-host/test/host/fixture.js'

/** Dynamic namespace access lets the absent public entry produce a real runtime red assertion. */
function plugin(options?: IRpcDevtoolsOptions): IDevtoolsPlugin {
  /** Read the actual package namespace so the missing entry produces a runtime assertion. */
  const factory = Reflect.get(entry, 'devtoolsPlugin') as
    | ((input?: IRpcDevtoolsOptions) => IDevtoolsPlugin)
    | undefined
  expect(typeof factory).toBe('function')
  return factory!(options)
}

/** Count the actual collector's settled message rows for one observed business method. */
function calls(value: IDevtoolsPlugin, method = 'echo'): number {
  return value
    .stats()
    .methods.filter((row) => row.method === method)
    .reduce((total, row) => total + row.calls, 0)
}

describe('devtools feature plugin', () => {
  it('publishes only the native feature root', async () => {
    expect(Object.keys(entry).sort()).toEqual([
      'RPC_DEVTOOLS_SOURCE',
      'RpcDevtoolsErrorCode',
      'devtoolsPlugin'
    ])
    expect(Reflect.has(entry, 'createRpcDevtools')).toBe(false)
    expect(Object.keys(await import('@migaia/rpc-plugin-devtools')).sort()).toEqual(
      Object.keys(entry).sort()
    )
    /** The published export map must keep the three independent consumer boundaries. */
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8')
    ) as { name: string; exports: Record<string, unknown> }
    expect(manifest.name).toBe('@migaia/rpc-plugin-devtools')
    expect(Object.keys(manifest.exports)).toEqual(['.'])
  })

  it('constructs exactly one canonical collector and passes the full options object unchanged', () => {
    /** Observe the canonical private constructor without replacing its implementation. */
    const create = vi.spyOn(collectorOwner, 'createRpcDevtools')
    /** The original callback identity must pass through the feature factory unchanged. */
    const redact = vi.fn((_stage, content) => content)
    /** The collector retains the original diagnostic sink rather than an adapter wrapper. */
    const onError = vi.fn()
    const options: IRpcDevtoolsOptions = {
      maxEvents: 2,
      maxContentBytes: 5,
      maxInterned: 7,
      stages: ['message', 'encoded'],
      capture: ['encoded'],
      methods: ['echo'],
      sample: 1,
      redact,
      exposeContent: true,
      onError
    }
    /** One genuine feature instance owns exactly one caller-controlled collector. */
    const value = plugin(options)
    try {
      expect(create).toHaveBeenCalledTimes(1)
      expect(create.mock.calls[0]![0]).toBe(options)
      expect(value.collector).toBe(create.mock.results[0]!.value)
      expect(readProbeStages(value.collector)).toBe(
        (1 << RpcProbeStage.message) | (1 << RpcProbeStage.encoded)
      )
      expect(Object.isFrozen(value)).toBe(true)
      expect(value.describe().limits).toEqual({ maxEvents: 2, maxContentBytes: 5 })
    } finally {
      value.close()
      vi.restoreAllMocks()
    }
  })

  it('forwards query and statistics to its collector and exposes the original full control surface', () => {
    /** One genuine feature instance owns exactly one caller-controlled collector. */
    const value = plugin()
    try {
      value.collector.emit(collectorView())
      expect(value.query()).toEqual(value.collector.query())
      expect(value.stats()).toEqual(value.collector.stats())
      expect(value.query).not.toBe(value.collector.query)
      expect(value.stats).not.toBe(value.collector.stats)
      /** Detached metadata arrows retain their original collector without receiver binding. */
      const query = value.query
      expect(query().events).toHaveLength(1)
      /** The original recording owner retains observations independently of the main ring. */
      const recording = value.collector.record()
      value.collector.emit(collectorView(2))
      /** The original codec must preserve this completed collector recording. */
      const record = recording.stop()
      expect(value.collector.importRecord(value.collector.exportRecord(record))).toEqual(record)
      expect(value.collector.service).toHaveProperty('query')
      value.collector.clear()
      expect(value.query().events).toHaveLength(0)
    } finally {
      value.close()
    }
  })

  it('uses its actual registered collector for host request observations and pending watch reads', async () => {
    /** One genuine feature instance owns exactly one caller-controlled collector. */
    const value = plugin({ methods: ['echo'] })
    /** The real listener admits raw memory channels through the canonical handshake. */
    const server = memoryServer('watched-host')
    /** The new host entry installs the feature through its actual native plugin hook. */
    const host = await createRpcHost({ ...server.options, plugins: [server.transport, value] })
    /** An independently constructed provider host executes the observed business request. */
    const remote = await server.connect('provider', {
      provide: { echo: (payload: unknown) => payload }
    })
    /** The original iterator subscribes before the next actual business emission. */
    const watch = value.watch({ methods: ['echo'] })
    try {
      value.collector.clear()
      /** The pending reader must wake from a real observed call rather than retained history. */
      const next = watch.next()
      expect(await host.request('echo', 42)).toBe(42)
      expect(
        value.query({ methods: ['echo'] }).events.some((event) => event.method === 'echo')
      ).toBe(true)
      expect(
        ((await next).value as IRpcDevtoolsWatchBatch).events.some(
          (event) => event.method === 'echo'
        )
      ).toBe(true)
      expect(calls(value)).toBe(1)
      expect(value.describe().descriptors.map((descriptor) => descriptor.endpointId)).toContain(
        'watched-host'
      )
    } finally {
      await watch.return(undefined)
      await remote.host.close()
      await host.close()
      value.close()
    }
  })

  it('updates real host stages and pause/resume through the same collector', async () => {
    /** One genuine feature instance owns exactly one caller-controlled collector. */
    const value = plugin({ methods: ['echo'] })
    /** The real listener admits raw memory channels through the canonical handshake. */
    const server = memoryServer('dynamic-host')
    /** The new host entry installs the feature through its actual native plugin hook. */
    const host = await createRpcHost({ ...server.options, plugins: [server.transport, value] })
    /** An independently constructed provider host executes the observed business request. */
    const remote = await server.connect('provider', {
      provide: { echo: (payload: unknown) => payload }
    })
    try {
      value.collector.clear()
      expect(await host.request('echo', 1)).toBe(1)
      expect(value.query({ stages: ['carrier', 'encoded'] }).events).toHaveLength(0)
      value.collector.setStages(['message', 'carrier', 'encoded'])
      /** The original iterator subscribes before the next actual business emission. */
      const watch = value.watch({ stages: ['carrier', 'encoded'] })
      try {
        /** The pending reader must wake from a real observed call rather than retained history. */
        const next = watch.next()
        expect(await host.request('echo', 2)).toBe(2)
        expect(value.query({ stages: ['carrier', 'encoded'] }).events.length).toBeGreaterThan(0)
        expect(value.query().events.map((event) => event.stage)).toEqual(
          expect.arrayContaining(['carrier', 'encoded'])
        )
        expect((await next).value?.events.length).toBeGreaterThan(0)
      } finally {
        await watch.return(undefined)
      }
      value.collector.pause()
      /** A paused collector preserves its sequence while the host continues business. */
      const paused = value.query().nextSeq
      expect(await host.request('echo', 3)).toBe(3)
      expect(value.query().nextSeq).toBe(paused)
      expect(value.describe().paused).toBe(true)
      value.collector.resume()
      expect(await host.request('echo', 4)).toBe(4)
      expect(value.query().nextSeq).toBeGreaterThan(paused)
      expect(calls(value)).toBe(3)
    } finally {
      await remote.host.close()
      await host.close()
      value.close()
    }
  })

  it('aggregates two real hosts and keeps collecting after one host closes', async () => {
    /** One genuine feature instance owns exactly one caller-controlled collector. */
    const value = plugin({ methods: ['echo'] })
    /** The first independent endpoint shares the exact same feature object. */
    const first = memoryServer('first-host')
    /** The second endpoint has its own emitter and the same original collector. */
    const second = memoryServer('second-host')
    /** The first real host owns only its transport and emitter lifetime. */
    const hostA = await createRpcHost({ ...first.options, plugins: [first.transport, value] })
    /** The second real host must remain observable after the first host closes. */
    const hostB = await createRpcHost({ ...second.options, plugins: [second.transport, value] })
    /** The first real provider gives the two host calls distinguishable results. */
    const remoteA = await first.connect('first-provider', { provide: { echo: () => 'a' } })
    /** The second real provider remains usable after collector and first-host close. */
    const remoteB = await second.connect('second-provider', { provide: { echo: () => 'b' } })
    try {
      value.collector.clear()
      expect(await hostA.request('echo')).toBe('a')
      expect(await hostB.request('echo')).toBe('b')
      expect(calls(value)).toBe(2)
      await hostA.close()
      /** The original iterator subscribes before the next actual business emission. */
      const watch = value.watch({ methods: ['echo'] })
      try {
        /** The pending reader must wake from a real observed call rather than retained history. */
        const next = watch.next()
        expect(await hostB.request('echo')).toBe('b')
        expect(
          ((await next).value as IRpcDevtoolsWatchBatch).events.some(
            (event) => event.endpointId === 'second-host'
          )
        ).toBe(true)
      } finally {
        await watch.return(undefined)
      }
      expect(calls(value)).toBe(3)
      value.close()
      expect(await hostB.request('echo')).toBe('b')
    } finally {
      await remoteA.host.close()
      await remoteB.host.close()
      await hostA.close()
      await hostB.close()
      value.close()
    }
  })

  it('forwards watch/describe/close without taking any host lifetime and preserves CLOSED wakeup', async () => {
    /** One genuine feature instance owns exactly one caller-controlled collector. */
    const value = plugin()
    /** The original iterator subscribes before the next actual business emission. */
    const watch = value.watch()
    /** The original pending watch must be rejected by explicit collector close. */
    const pending = watch.next()
    /** Attach rejection observation before synchronously closing the collector. */
    const rejected = expect(pending).rejects.toMatchObject({
      source: entry.RPC_DEVTOOLS_SOURCE,
      code: entry.RpcDevtoolsErrorCode.closed
    })
    value.close()
    value.close()
    await rejected
    expect(() => value.describe()).toThrowError(
      expect.objectContaining({
        source: entry.RPC_DEVTOOLS_SOURCE,
        code: entry.RpcDevtoolsErrorCode.closed
      })
    )
    expect(() => value.query()).toThrowError(
      expect.objectContaining({ code: entry.RpcDevtoolsErrorCode.closed })
    )
  })
})
