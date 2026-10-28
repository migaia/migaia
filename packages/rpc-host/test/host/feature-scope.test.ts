/** Public feature placement and fixed native stage positions use the original Memory transport. */
import { expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { createRpcHost } from '@migaia/rpc-host'
import { auth } from '@migaia/rpc-host/plugins/auth'
import { schema } from '@migaia/rpc-host/plugins/schema'
import { chunk } from '@migaia/rpc-host/plugins/chunk'
import { batch } from '@migaia/rpc-host/plugins/batch'
import { limits } from '@migaia/rpc-host/plugins/limits'
import { probe } from '@migaia/rpc-host/plugins/probe'
import {
  defineFlowFeature,
  RpcFlowLayer,
  RpcFlowPoint,
  RpcJsonCarrierCodec
} from '@migaia/rpc-host/sdk'
import type { IRpcCarrierFrame } from '@migaia/rpc-contract/interfaces'
import { StageLanes } from '../../../plugin-host/dist/stage-lanes.js'
import { RpcAuthenticationEnvelope } from '../../dist/features/auth/constants.js'
import { coreMemoryServer } from './core-fixture.ts'

/** These three fixed permutations exercise callers' arrays without defining another planner. */
const permutations = [
  [0, 1, 2, 3, 4],
  [4, 3, 2, 1, 0],
  [2, 0, 4, 1, 3]
] as const

it('owns one host feature setup and one setup for each transport-local placement', async () => {
  /** These counters observe actual native Feature setup and cleanup, without owning their lifetime. */
  const hostSetup = vi.fn()
  /** Host-level cleanup belongs to its one real shared Feature installation. */
  const hostDispose = vi.fn()
  /** Reusing one definition at two local placements still creates two native installations. */
  const localSetup = vi.fn()
  /** The same callback is invoked once by each actual local placement owner. */
  const localDispose = vi.fn()
  /** One shared definition supplies all namespace groups through its original native wrapper. */
  const shared = defineFlowFeature({
    name: 'host-feature-lifetime',
    setup: () => {
      hostSetup()
      return { dispose: hostDispose }
    }
  })
  /** Both real transport definitions install this original opaque Feature independently. */
  const local = defineFlowFeature({
    name: 'local-feature-lifetime',
    setup: () => {
      localSetup()
      return { dispose: localDispose }
    }
  })
  /** Actual public construction receives two fixed namespaces before acquiring either source. */
  const first = coreMemoryServer('feature-lifetime', undefined, 'first', [local])
  /** The second placement has the same definition identity and its own native setup receipt. */
  const second = coreMemoryServer('feature-lifetime', undefined, 'second', [local])
  /** Native Host ownership, rather than a fixture disposer table, controls every callback. */
  const host = await createRpcHost({
    ...first.options,
    plugins: [shared, first.transport, second.transport]
  })
  try {
    expect(hostSetup).toHaveBeenCalledTimes(1)
    expect(localSetup).toHaveBeenCalledTimes(2)
    await host.first.close()
    await host.second.close()
    expect(hostDispose).not.toHaveBeenCalled()
    expect(localDispose).not.toHaveBeenCalled()
    await host.close()
    expect(hostDispose).toHaveBeenCalledTimes(1)
    expect(localDispose).toHaveBeenCalledTimes(2)
  } finally {
    await host.close()
  }
})

/** Actual wire normalization preserves physical geometry and every completed encoded body. */
class FeatureWireRecords {
  /** Only real fragments from the current finite request sequence enter this assembly record. */
  readonly #parts = new Map<string, string[]>()

  /** Remove runtime identities while retaining actual payloads, protocol fields and error chains. */
  #value(value: unknown, key?: string): unknown {
    if (key === 'id' || key === 'nonce' || key === 'deadline' || key === 'sentAt') return `<${key}>`
    if (typeof value === 'string') {
      if (value.startsWith(RpcAuthenticationEnvelope.prefix))
        return this.#value(JSON.parse(value.slice(RpcAuthenticationEnvelope.prefix.length)))
      if (value.startsWith('{') || value.startsWith('[')) return this.#value(JSON.parse(value))
      return value
    }
    if (Array.isArray(value)) return value.map((entry) => this.#value(entry))
    if (value === null || typeof value !== 'object') return value
    /** Each actual object is traversed once; no sorting changes its original wire order. */
    const result: Record<string, unknown> = {}
    for (const [name, entry] of Object.entries(value)) result[name] = this.#value(entry, name)
    return result
  }

  /** Keep each actual batch boundary and chunk index, then compare its complete restored text. */
  readonly frame = (frame: IRpcCarrierFrame): unknown => {
    if (frame.kind === 'extension' && frame.extension === 'batch@1') {
      /** The genuine batch owner emitted these original physical member records. */
      const data = frame.data as { frames: readonly IRpcCarrierFrame[] }
      return { kind: frame.kind, extension: frame.extension, frames: data.frames.map(this.frame) }
    }
    if (frame.kind === 'extension' && frame.extension === 'chunk@1') {
      /** String media keeps original fragment boundaries, rather than synthetic semantic frames. */
      const data = frame.data as {
        messageId: string
        index: number
        count: number
        length: number
        data: string
      }
      /** Each finite chunk group is concatenated once, after its actual final fragment arrives. */
      const parts = this.#parts.get(data.messageId) ?? []
      parts.push(data.data)
      this.#parts.set(data.messageId, parts)
      /** Incomplete fragments retain their original physical size and sequence. */
      const record = {
        kind: frame.kind,
        extension: frame.extension,
        index: data.index,
        count: data.count,
        length: data.length,
        units: data.data.length,
        body: data.index + 1 === data.count ? this.#value(parts.join('')) : undefined
      }
      if (data.index + 1 === data.count) this.#parts.delete(data.messageId)
      return record
    }
    return { kind: frame.kind, data: this.#value(frame.data) }
  }
}

/** The same public factories create independent real feature instances on both actual Hosts. */
function orderedFeatures(order: readonly number[], trace: string[]) {
  /** Application parsing remains an actual schema callback, separate from wire normalization. */
  const parser = { parse: (value: unknown) => value }
  /** The third-party stage sees business plaintext before authentication wraps the prepared data. */
  const thirdParty = defineFlowFeature({
    name: 'feature-order-third-party',
    setup: () => ({
      stages: {
        [RpcFlowPoint.envelopeOutbound]: async (payload, next) => {
          /** The real codec restores this original prepared object, using its existing cache. */
          const message = await payload.context.restore(payload.prepared)
          if (message?.kind === 'call') trace.push(`call:${message.task.method!}`)
          await next(payload)
        },
        [RpcFlowPoint.frameOutbound]: (payload, next) => {
          /** Returning the actual traversal preserves native failure and completion ownership. */
          const traversal = next(payload)
          trace.push('submitted')
          return traversal
        }
      }
    })
  })
  /** Only positions vary; no fake algorithm replaces these five real definitions. */
  const features = [
    auth({ encodedType: 'string', sign: (value) => value, verify: (value) => value }),
    schema({ schemas: { echo: { params: parser, result: parser } } }),
    chunk({ chunkBytes: 1024, maxMessageBytes: 64 * 1024 }),
    batch(),
    thirdParty
  ]
  return order.map((index) => features[index]!)
}

it('keeps three host/local array orders and different endpoint orders equivalent on actual wire records', async () => {
  /** The original failure is shared across permutations, so its business error text cannot drift. */
  const cause = new TypeError('feature scope provider cause')
  /** The original provider keeps this same native cause in every independent placement. */
  const original = new RangeError('feature scope provider failure', { cause })
  /** One normalized baseline includes actual frames in both physical directions. */
  let baseline: unknown
  // The two placements and three permutations are the fixed public acceptance matrix.
  for (const local of [false, true]) {
    for (let index = 0; index < permutations.length; index++) {
      /** Only actual third-party callbacks can populate these plaintext witnesses. */
      const trace: string[] = []
      /** Each endpoint deliberately writes its own distinct array order. */
      const serverFeatures = orderedFeatures(permutations[index]!, trace)
      /** A different endpoint permutation must still negotiate the same actual wire transformations. */
      const clientTrace: string[] = []
      /** The caller's witnesses distinguish true logical submissions from later fragment writes. */
      const clientFeatures = orderedFeatures(
        permutations[(index + 1) % permutations.length]!,
        clientTrace
      )
      /** The existing codec/carrier fixture remains the sole physical message owner. */
      const server = coreMemoryServer(
        'scope-server',
        'scope-server',
        'memory',
        local ? serverFeatures : [],
        [],
        {
          create: () => new RpcJsonCarrierCodec(),
          nativeBinary: false
        }
      )
      /** Server side public construction chooses host-wide or transport-local placement. */
      const host = await createRpcHost({
        ...server.options,
        plugins: local ? [server.transport] : [...serverFeatures, server.transport],
        provide: {
          echo: (value: unknown) => value,
          fail: () => {
            throw original
          }
        }
      })
      /** Client uses its actual public Host; no request or pipeline facade is inserted. */
      const client = await server.connect('scope-client', { plugins: clientFeatures })
      /** Observe post-handshake frames at the original physical write boundary. */
      const clientWrite = vi.spyOn(client.pair[1], 'write')
      /** Replies are checked independently from requests on their original endpoint. */
      const serverWrite = vi.spyOn(client.pair[0], 'write')
      try {
        clientTrace.length = 0
        trace.length = 0
        client.pair[1].holdWrites()
        /** One held real physical write makes the next small submissions form a batch. */
        const busy = client.host.memory.send('scope-server', 'echo', 'busy')
        await vi.waitFor(() => expect(clientWrite).toHaveBeenCalledTimes(1))
        /** A genuine large value forces chunk production after real envelope signing. */
        const value = 'feature-scope-大消息'.repeat(700)
        /** Large-message fragment membership stays with the genuine physical batch owner. */
        const large = client.host.memory.send('scope-server', 'echo', value)
        /** Two small queued members prove real batching independently of chunk fan-out. */
        const survivor = client.host.memory.send('scope-server', 'echo', 'survivor')
        /** Rejection is observed before releasing backpressure so it cannot become unhandled. */
        const failed = client.host.memory
          .send('scope-server', 'fail')
          .catch((failure: unknown) => failure)
        await vi.waitFor(() =>
          expect(clientTrace.filter((event) => event === 'submitted')).toHaveLength(4)
        )
        client.pair[1].releaseWrites()
        await expect(busy).resolves.toBe('busy')
        await expect(large).resolves.toBe(value)
        await expect(survivor).resolves.toBe('survivor')
        /** Every order must restore the same native family and complete public error chain. */
        const error = await failed
        expect(error).toBeInstanceOf(RangeError)
        expect(error).toMatchObject({
          source: 'rpc.endpoint',
          code: 'INTERNAL',
          message: original.message,
          stack: original.stack
        })
        expect((error as Error).cause).toMatchObject({
          name: 'TypeError',
          message: cause.message,
          stack: cause.stack
        })
        /** The original third-party callback runs only once per actual outgoing business envelope. */
        expect(clientTrace.filter((event) => event.startsWith('call:'))).toEqual([
          'call:echo',
          'call:echo',
          'call:echo',
          'call:fail'
        ])
        /** Each direction owns an independent fragment id namespace during normalization. */
        const outbound = new FeatureWireRecords()
        /** Reply fragments cannot borrow a request's normalization state. */
        const inbound = new FeatureWireRecords()
        /** Only actual captured wire writes supply the compared sequence. */
        const records = {
          outbound: clientWrite.mock.calls.map(([frame]) => outbound.frame(frame)),
          inbound: serverWrite.mock.calls.map(([frame]) => inbound.frame(frame)),
          error: {
            name: (error as Error).name,
            message: (error as Error).message,
            cause: (error as Error).cause
          }
        }
        expect(
          clientWrite.mock.calls.some(
            ([frame]) => frame.kind === 'extension' && frame.extension === 'chunk@1'
          )
        ).toBe(true)
        expect(
          clientWrite.mock.calls.some(
            ([frame]) => frame.kind === 'extension' && frame.extension === 'batch@1'
          )
        ).toBe(true)
        if (baseline === undefined) baseline = records
        else expect(records).toEqual(baseline)
      } finally {
        client.pair[1].releaseWrites()
        clientWrite.mockRestore()
        serverWrite.mockRestore()
        await Promise.all([client.host.close(), host.close()])
      }
    }
  }
})

it('uses native dependency order inside plaintext and exposes the explicit outer wire layer', async () => {
  /** Only genuine stage invocations append this sequence after the handshake has completed. */
  const trace: string[] = []
  /** Original operation signals distinguish this business call from directory and close traffic. */
  const businessSignals = new WeakSet<object>()
  /** A dependency remains the original opaque native Feature, rather than a copied name edge. */
  const base = defineFlowFeature({
    name: 'scope-dependency-base',
    setup: () => ({
      stages: {
        [RpcFlowPoint.envelopeOutbound]: async (payload, next) => {
          /** Only the actual business envelope participates in the ordering assertion. */
          const message = await payload.context.restore(payload.prepared)
          if (message?.kind === 'call') {
            businessSignals.add(payload.context.signal)
            trace.push('base')
            expect(message.task.method).toBe('echo')
          }
          await next(payload)
        }
      }
    })
  })
  /** The caller lists this dependent first; native dependency planning still orders base first. */
  const dependent = defineFlowFeature({
    name: 'scope-dependency-dependent',
    dependencies: { base },
    setup: () => ({
      stages: {
        [RpcFlowPoint.envelopeOutbound]: async (payload, next) => {
          if (!businessSignals.has(payload.context.signal)) return next(payload)
          trace.push('dependent')
          await next(payload)
        },
        [RpcFlowPoint.frameOutbound]: (payload, next) => {
          if (!businessSignals.has(payload.context.signal)) return next(payload)
          trace.push(`plaintext:${payload.frame.kind}`)
          return next(payload)
        }
      }
    })
  })
  /** Explicit wire positions see the real authentication wrapper and actual chunk extension. */
  const wire = defineFlowFeature({
    name: 'scope-wire-layer',
    setup: () => ({
      stages: {
        [RpcFlowPoint.envelopeOutbound]: {
          layer: RpcFlowLayer.wire,
          stage: (payload, next) => {
            if (!businessSignals.has(payload.context.signal)) return next(payload)
            trace.push('wire-envelope')
            expect(payload.prepared.message).toMatchObject({
              authentication: 'rpc-authentication-replay'
            })
            return next(payload)
          }
        },
        [RpcFlowPoint.frameOutbound]: {
          layer: RpcFlowLayer.wire,
          stage: (payload, next) => {
            if (!businessSignals.has(payload.context.signal)) return next(payload)
            trace.push(`wire:${payload.frame.kind}`)
            expect(payload.frame).toMatchObject({ kind: 'extension', extension: 'chunk@1' })
            return next(payload)
          }
        }
      }
    })
  })
  /** Both actual endpoints negotiate the same builtin transforms before business begins. */
  const server = coreMemoryServer('layer-server', undefined, 'memory', [], [], {
    create: () => new RpcJsonCarrierCodec(),
    nativeBinary: false
  })
  /** Provider publication and real native transport installation remain public operations. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [
      auth({ sign: (value) => value, verify: (value) => value }),
      chunk({ chunkBytes: 1024 }),
      server.transport
    ],
    provide: { echo: (value: unknown) => value }
  })
  /** The client alone installs witnesses so reply stages cannot satisfy request assertions. */
  const client = await server.connect('layer-client', {
    plugins: [
      dependent,
      wire,
      auth({ sign: (value) => value, verify: (value) => value }),
      chunk({ chunkBytes: 1024 })
    ]
  })
  try {
    trace.length = 0
    /** Multiple actual fragments verify default whole-frame placement and outer fragment placement. */
    const value = 'layer-value'.repeat(900)
    await expect(client.host.memory.send('layer-server', 'echo', value)).resolves.toBe(value)
    expect(trace.slice(0, 4)).toEqual(['base', 'dependent', 'wire-envelope', 'plaintext:message'])
    expect(trace.slice(4).length).toBeGreaterThan(1)
    expect(trace.slice(4).every((entry) => entry === 'wire:extension')).toBe(true)
  } finally {
    await Promise.all([client.host.close(), host.close()])
  }
})

it('rejects an invalid layer and a host-only probe before any local transport acquires IO', async () => {
  /** This original cold feature is genuine; only its explicitly invalid layer is rejected. */
  const invalid = defineFlowFeature({
    name: 'scope-invalid-layer',
    setup: () => ({
      stages: {
        [RpcFlowPoint.frameOutbound]: {
          layer: 'invalid' as never,
          stage: (payload, next) => next(payload)
        }
      }
    })
  })
  /** Real native transport open must remain absent for either invalid cold placement. */
  const server = coreMemoryServer('invalid-layer', undefined, 'memory', [invalid])
  await expect(createRpcHost(server.options)).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
  /** Probe is the real readonly native plugin and cannot impersonate a local flow Feature. */
  expect(() =>
    coreMemoryServer('invalid-probe', undefined, 'memory', [
      probe({ stages: ['message'], emit: () => undefined })
    ])
  ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }))
})

it('overrides host authentication once in one Memory namespace and keeps the other host selection', async () => {
  /** These actual transform counts distinguish one local override from double signing. */
  const counts = { host: 0, local: 0 }
  /** Matching transforms verify the original value without adding another authentication owner. */
  const hostAuth = auth({
    sign: (value) => {
      counts.host++
      return value
    },
    verify: (value) => value
  })
  /** The local authentic builtin identity overrides only its transport's namespace. */
  const localAuth = auth({
    sign: (value) => {
      counts.local++
      return value
    },
    verify: (value) => value
  })
  /** Both original listener definitions join one public Host's fixed cold inventory. */
  const first = coreMemoryServer('override-server', undefined, 'first', [localAuth])
  /** This second namespace inherits the same host installation instead of creating another one. */
  const second = coreMemoryServer('override-server', undefined, 'second')
  /** Real provider output is the sole source of reply signing. */
  const host = await createRpcHost({
    ...first.options,
    plugins: [hostAuth, first.transport, second.transport],
    provide: { echo: (value: unknown) => value }
  })
  /** Both actual clients install paired verification while owning separate physical Sessions. */
  const a = await first.connect('override-a', {
    plugins: [auth({ sign: (value) => value, verify: (value) => value })]
  })
  /** The second client connects to its original separate listener namespace. */
  const b = await second.connect('override-b', {
    plugins: [auth({ sign: (value) => value, verify: (value) => value })]
  })
  try {
    counts.host = counts.local = 0
    await expect(a.host.first.send('override-server', 'echo', 'local')).resolves.toBe('local')
    expect(counts).toEqual({ host: 0, local: 1 })
    await expect(b.host.second.send('override-server', 'echo', 'host')).resolves.toBe('host')
    expect(counts).toEqual({ host: 1, local: 1 })
  } finally {
    await Promise.all([a.host.close(), b.host.close(), host.close()])
  }
})

it('runs a transport-local schema only in its own Memory namespace', async () => {
  /** This original parser failure must remain the schema rejection's reachable native cause. */
  const original = new TypeError('only strings are accepted in first')
  /** The actual parser allows the valid baseline and refuses the same invalid second input. */
  const parser = {
    parse(value: unknown) {
      if (typeof value !== 'string') throw original
      return value
    }
  }
  /** One genuine local schema Feature joins only the first transport's seven lanes. */
  const first = coreMemoryServer('schema-server', undefined, 'first', [
    schema({ schemas: { echo: { params: parser, result: parser } } })
  ])
  /** No schema is installed for this independent namespace. */
  const second = coreMemoryServer('schema-server', undefined, 'second')
  /** Only actual provider invocation records whether invalid data crossed schema admission. */
  const echo = vi.fn((value: unknown) => value)
  /** Both real transports expose the same original business provider on one public Host. */
  const host = await createRpcHost({
    ...first.options,
    plugins: [first.transport, second.transport],
    provide: { echo }
  })
  /** Independent public callers send the same value through their real Sessions. */
  const a = await first.connect('schema-a')
  /** The second caller cannot borrow first's installed validation state. */
  const b = await second.connect('schema-b')
  try {
    await expect(a.host.first.send('schema-server', 'echo', 42)).rejects.toMatchObject({
      code: 'SCHEMA_INVALID',
      cause: { name: 'TypeError', message: original.message }
    })
    await expect(b.host.second.send('schema-server', 'echo', 42)).resolves.toBe(42)
    expect(echo).toHaveBeenCalledTimes(1)
  } finally {
    await Promise.all([a.host.close(), b.host.close(), host.close()])
  }
})

it.each([false, true])(
  'shares host limits and isolates transport-local limits: local=%s',
  async (local) => {
    /** One actual provider invocation remains occupied while the other namespace is admitted. */
    const entered = deferred<void>()
    /** The original business receipt, rather than a client count, owns this concurrency interval. */
    const release = deferred<void>()
    /** Separate factory results distinguish independent local owners from one shared host owner. */
    const first = coreMemoryServer(
      'limits-server',
      undefined,
      'first',
      local ? [limits({ maxGlobal: 1 })] : []
    )
    /** Only local placement gives this namespace its own genuine capacity owner. */
    const second = coreMemoryServer(
      'limits-server',
      undefined,
      'second',
      local ? [limits({ maxGlobal: 1 })] : []
    )
    /** Both namespaces target the same actual original provider set. */
    const host = await createRpcHost({
      ...first.options,
      plugins: [...(local ? [] : [limits({ maxGlobal: 1 })]), first.transport, second.transport],
      provide: {
        held: () => {
          entered.resolve()
          return release.promise
        },
        echo: (value: unknown) => value
      }
    })
    /** The first real caller starts the held provider before a second request can race admission. */
    const a = await first.connect('limits-a')
    /** Independent namespace ownership is exercised through its actual public method. */
    const b = await second.connect('limits-b')
    /** Observe rejection immediately; final cleanup always releases the original provider. */
    const pending = a.host.first.send('limits-server', 'held')
    try {
      await entered.promise
      if (local)
        await expect(b.host.second.send('limits-server', 'echo', 'independent')).resolves.toBe(
          'independent'
        )
      else
        await expect(b.host.second.send('limits-server', 'echo', 'shared')).rejects.toMatchObject({
          code: 'OVERLOADED'
        })
      release.resolve()
      await pending
      await expect(b.host.second.send('limits-server', 'echo', 'released')).resolves.toBe(
        'released'
      )
    } finally {
      release.resolve()
      await pending.catch(() => undefined)
      await Promise.all([a.host.close(), b.host.close(), host.close()])
    }
  }
)

it('takes no native pipeline lease for a request in an empty namespace group', async () => {
  /** This is the original plugin-host counter seam, using the same built class as the public Host. */
  const retained = vi.spyOn(StageLanes.prototype, 'retainLeases')
  /** Empty actual lanes still perform the original public handshake and provider request. */
  const server = coreMemoryServer('empty-group-server')
  /** No flow definition, schema, auth or observer is present in either actual public Host. */
  const host = await createRpcHost({
    ...server.options,
    provide: { echo: (value: unknown) => value }
  })
  /** Only actual physical endpoints connect the two original Session owners. */
  const client = await server.connect('empty-group-client')
  try {
    retained.mockClear()
    await expect(client.host.memory.send('empty-group-server', 'echo', 42)).resolves.toBe(42)
    expect(retained).not.toHaveBeenCalled()
  } finally {
    await Promise.all([client.host.close(), host.close()])
    retained.mockRestore()
  }
})
