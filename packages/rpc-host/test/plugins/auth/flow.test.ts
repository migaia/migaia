import { expect, it, vi } from 'vitest'
import { defineHost, definePlugin } from '@migaia/plugin-host'
import { deferred, type IAbortSignal } from '@migaia/utils/promise'
import type { IRpcEnvelopeContext, IRpcCarrierFrame } from '@migaia/rpc-contract/interfaces'
import type { IRpcEnvelope, IRpcHello } from '@migaia/rpc-contract/protocol'
import { RpcWireProfile } from '@migaia/rpc-contract/protocol'
import { auth, type IRpcAuthenticationOptions } from '../../../dist/features/auth/index.js'
import { setAuthenticationReplayCounter } from '../../../dist/features/auth/counter.js'
import { readAuthenticationEnvelope } from '../../../dist/features/auth/envelope.js'
import { AuthenticationRepresentation } from '../../../dist/features/auth/representation.js'
import { readRpcDefinition, RpcDefinitionKind } from '../../../dist/sdk/metadata.js'
import { RpcJsonCarrierCodec } from '../../../dist/sdk/carrier/json-codec.js'
import { FlowRegistry } from '../../../dist/flow/registry.js'
import {
  rpcHostPipelines,
  rpcPipelineOwner,
  RpcFlowPoint
} from '../../../dist/sdk/flow-pipelines.js'
import { RpcFlowSetup } from '../../../dist/sdk/flow-setup.js'
import type { IRpcFlowInstallation } from '../../../dist/sdk/types.js'

/** Original correlations and own-key order are ordinary semantic fixtures, not another codec. */
function message(id: string, payload: unknown = id): IRpcEnvelope {
  return {
    profile: RpcWireProfile,
    kind: 'call',
    id,
    route: {
      applicationVersion: '1',
      senderId: 'caller',
      receiverId: 'target',
      targetId: 'target',
      sentAt: 0
    },
    task: {
      mode: 'request',
      callerId: 'caller',
      callerGeneration: { kind: 'session', value: 1, providerId: 'caller' },
      targetGeneration: { kind: 'session', value: 1, providerId: 'target' },
      method: 'echo'
    },
    options: {},
    payload: payload as never
  }
}

/** Exercise genuine native setup, named pipelines and the actual executing codec. */
async function fixture(options: IRpcAuthenticationOptions, nativeBinary = false) {
  /** The genuine native Feature retains original callbacks and paired-transform validation. */
  const feature = auth(options)
  /** Private builtin identity belongs to this actual factory, never a copied display name. */
  const metadata = readRpcDefinition(feature)
  if (metadata?.kind !== RpcDefinitionKind.feature)
    throw new TypeError('expected actual auth feature')
  /** Physical source retirement remains distinct from installation rollback. */
  const source = new AbortController()
  /** Setup cleanup owns only this actual native installation. */
  const setup = new AbortController()
  /** Credential verifier failures must never enter this original report channel. */
  const reports: unknown[] = []
  /** Hash calls expose repeated restore without replacing the original SDK integrity algorithm. */
  const hashes = { count: 0 }
  /**
   * This controlled digest fixture covers its complete four-byte backing and canonical digest
   * shape.
   */
  const codec = new RpcJsonCarrierCodec({
    digest: async (backing) => {
      hashes.count += 1
      return Array.from(new Uint8Array(backing), (byte) => byte.toString(16).padStart(2, '0'))
        .join('')
        .padEnd(64, '0')
    }
  })
  /** Actual executing codec policy is shared by prepare/decode and the one cached restore operation. */
  const codecContext = { codec: 'json', nativeBinary, maxFrameBytes: 16 * 1024 * 1024 }
  /** Native use() publishes the exact algorithm installation retained by the original counter seam. */
  let installation!: IRpcFlowInstallation<object>
  /** This namespace uses the same genuine group declaration and lazy owner as public SDK hosts. */
  const rpc = rpcHostPipelines(
    () => flow,
    (name) => flow.pipeline(name),
    ['test']
  )
  /** Native plugin-host alone owns actual stage execution and immutable snapshots. */
  const flow = defineHost({
    ...rpc,
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** Production registration attaches the authentic setup's stages to this native install core. */
  const registry = new FlowRegistry((error) => {
    reports.push(error)
  })
  await flow.use(
    definePlugin({
      name: metadata.definition.name,
      features: { flow: feature },
      async install(core) {
        /** Native Feature resolution supplies this original cold definition on the genuine core. */
        const definition = core.features.flow
        /** Canonical setup admits the exact algorithm instance into native cleanup ownership. */
        installation = await new RpcFlowSetup(definition).prepare(core, setup.signal, {
          signal: setup.signal,
          report: (error) => {
            reports.push(error)
          },
          retire: async () => undefined,
          call: async () => undefined
        })
        registry.registerFeatures(
          core,
          new Map([['test', [{ definition, installed: installation, builtin: metadata.builtin }]]])
        )
        return {}
      }
    })
  )
  registry.start()
  /** The namespace-qualified execution port is borrowed unchanged from the genuine native host. */
  const pipelines = rpc.domainCore()[rpcPipelineOwner]
  /** Physical facts and the exact codec operation are explicit inputs to tiny fixture callbacks. */
  const ports = { source, reports, codec, codecContext }
  /** The required restore port is the actual codec, never a successful admission stub. */
  const context = (
    direction: 'outbound' | 'inbound',
    signal: IAbortSignal = ports.source.signal,
    carrierId = 'source'
  ): IRpcEnvelopeContext => ({
    namespace: 'test',
    carrierId,
    direction,
    signal,
    connectionSignal: signal,
    report: (error) => {
      ports.reports.push(error)
    },
    restore: (prepared) => ports.codec.restore(prepared, ports.codecContext)
  })
  /** The fixture owns its actual executing path rather than several shared callback captures. */
  const path = { codec, pipelines, codecContext, context }
  /** One ordinary outbound path runs prepare, hooks and encode with original identities. */
  const send = async (value: IRpcEnvelope): Promise<IRpcCarrierFrame> => {
    /** Native terminal returns the actual transformed prepared identity to the codec owner. */
    const prepared = await path.pipelines.pipeline(RpcFlowPoint.envelopeOutbound, 'test').run(
      {
        prepared: await path.codec.prepare(value, path.codecContext),
        context: path.context('outbound')
      },
      async (payload) => payload.prepared
    )
    return path.codec.encode(prepared!, path.codecContext)
  }
  /** One ordinary receive path runs decode, hooks and the same cached final restore. */
  const receive = async (
    value: IRpcCarrierFrame,
    signal = path.context('inbound').signal,
    id = 'source'
  ) => {
    /** Restoration receives the same forwarded prepared object used by authentication. */
    const prepared = await path.pipelines.pipeline(RpcFlowPoint.envelopeInbound, 'test').run(
      {
        prepared: path.codec.decode(value, path.codecContext),
        context: path.context('inbound', signal, id)
      },
      async (payload) => payload.prepared
    )
    return path.codec.restore(prepared!, path.codecContext)
  }

  return {
    source,
    setup,
    reports,
    hashes,
    installation,
    flow,
    pipelines,
    context,
    codec,
    codecContext,
    send,
    receive
  }
}

it('preserves default JSON text, encrypt-before-sign, verify-before-decrypt and original payload', async () => {
  /**
   * Existing transform-order oracle now runs through actual prepared hooks and the selected JSON
   * codec.
   */
  const calls: string[] = []
  /** Default any receives the same original JSON string category rather than an owner object. */
  const categories: string[] = []
  /** Explicit transforms retain their original text roundtrip and callback order. */
  const f = await fixture({
    encrypt: (value) => {
      calls.push('encrypt')
      categories.push(typeof value)
      return `encrypted:${String(value)}`
    },
    sign: (value) => {
      calls.push('sign')
      return `signed:${String(value)}`
    },
    verify: (value) => {
      calls.push('verify')
      return String(value).slice('signed:'.length)
    },
    decrypt: (value) => {
      calls.push('decrypt')
      return String(value).slice('encrypted:'.length)
    }
  })
  /** Own-key order and exact correlation survive the actual JSON text protection path. */
  const original = message('ordered', { z: 1, a: 2 })
  expect(await f.receive(await f.send(original))).toEqual(original)
  expect(calls).toEqual(['encrypt', 'sign', 'verify', 'decrypt'])
  expect(categories).toEqual(['string'])
  await f.installation.dispose?.()
  await f.flow.dispose()
})

it.each(['string', 'uint8array'] as const)(
  'preserves explicit %s transform category through the actual JSON carrier',
  async (encodedType) => {
    /** The byte path cannot silently become a JSON numeric-key object before verification. */
    const categories: string[] = []
    /** Original identity transforms expose the actual representation delivered in both directions. */
    const f = await fixture({
      encodedType,
      sign: (value) => {
        categories.push(value instanceof Uint8Array ? 'uint8array' : typeof value)
        return value
      },
      verify: (value) => {
        categories.push(value instanceof Uint8Array ? 'uint8array' : typeof value)
        return value
      }
    })
    /** Actual codec encoding/decoding preserves the sole auth owner's category projection. */
    const original = message('category')
    expect(await f.receive(await f.send(original))).toEqual(original)
    expect(categories).toEqual([encodedType, encodedType])
    await f.installation.dispose?.()
    await f.flow.dispose()
  }
)

it('keeps native sign-only any bindings as objects with the original backing integrity', async () => {
  /** The original native sign-only path hands its complete manifest to the actual signer. */
  const categories: string[] = []
  /** Native sidecars stay owned by the codec, rather than entering an extra JSON text envelope. */
  const f = await fixture(
    {
      sign: (value) => {
        categories.push(typeof value)
        return value
      },
      verify: (value) => value
    },
    true
  )
  try {
    /** The genuine codec's manifest must hash this exact native backing in both directions. */
    const bytes = new Uint8Array([1, 2, 3, 4])
    /** This is the normal prepare/stage/encode/decode/stage/restore path on a native carrier. */
    const frame = await f.send(message('native-signing', bytes))
    expect(categories).toEqual(['object'])
    expect(frame.sidecars).toEqual([bytes.buffer])
    expect(await f.receive(frame)).toMatchObject({ payload: bytes })
    expect(f.hashes.count).toBe(2)
    expect(f.reports).toEqual([])
  } finally {
    await f.installation.dispose?.()
    await f.flow.dispose()
  }
})

it('retains the original 64-slot window, concurrent single commit and physical-source isolation', async () => {
  /** Actual signed frames allocate counters synchronously before any receive order is selected. */
  const f = await fixture({ sign: (value) => value, verify: (value) => value })
  /** Only real encoded protected frames are replayed, not invented nonce/counter values. */
  const frames: IRpcCarrierFrame[] = []
  for (let index = 1; index <= 66; index++) frames.push(await f.send(message(String(index))))
  expect(await f.receive(frames[65]!)).toMatchObject({ id: '66' })
  expect(await f.receive(frames[2]!)).toMatchObject({ id: '3' })
  await expect(f.receive(frames[1]!)).rejects.toMatchObject({
    code: 'AUTHENTICATION_FAILED',
    message: 'Authentication frame was replayed'
  })
  await expect(f.receive(frames[2]!)).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
  /** A different original physical source owns an independent pinned nonce/window. */
  const sibling = new AbortController()
  expect(await f.receive(frames[2]!, sibling.signal, 'sibling')).toMatchObject({ id: '3' })
  /** Concurrent actual restore completion may commit this same counter only once. */
  const concurrent = await Promise.allSettled([f.receive(frames[3]!), f.receive(frames[3]!)])
  expect(concurrent.map((entry) => entry.status).sort()).toEqual(['fulfilled', 'rejected'])
  sibling.abort()
  await f.installation.dispose?.()
  await f.flow.dispose()
})

// RPC-TEST-D12BE7E44139-C003/C004: retain the original counter inputs on the genuine native owner.
it('receives the original 64-slot boundaries and isolated concurrent verification', async () => {
  /** The same installed Auth owner allocates every original sequence before receive order changes. */
  const f = await fixture({ sign: (value) => value, verify: (value) => value })
  /** Actual physical source retirement is independent from this native installation's cleanup. */
  const sibling = new AbortController()
  /** A second actual installation owns a different secure nonce, never a forged context binding. */
  const other = await fixture({ sign: (value) => value, verify: (value) => value })
  try {
    /** Preserve all original sixty-six allocations and exact boundary indexes. */
    const frames: IRpcCarrierFrame[] = []
    for (let index = 1; index <= 66; index++)
      frames.push(await f.send(message(String(index), index)))
    expect(await f.receive(frames[64]!)).toMatchObject({ payload: 65 })
    expect(await f.receive(frames[1]!)).toMatchObject({ payload: 2 })
    await expect(f.receive(frames[0]!)).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    await expect(f.receive(frames[1]!)).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    await expect(f.receive(frames[64]!)).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    expect(await f.receive(frames[65]!)).toMatchObject({ payload: 66 })
    expect(setAuthenticationReplayCounter(f.installation, 130n)).toBe(true)
    expect(await f.receive(await f.send(message('131', 131)))).toMatchObject({ payload: 131 })
    await expect(f.receive(frames[65]!)).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    /** The same fresh signed frame enters two real native verification traversals concurrently. */
    const concurrentFrame = await f.send(message('concurrent', 'value'))
    /** Both entries share one actual physical source and must commit its counter only once. */
    const concurrent = await Promise.allSettled([
      f.receive(concurrentFrame),
      f.receive(concurrentFrame)
    ])
    expect(concurrent.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1)
    expect(
      concurrent.filter(
        (entry) =>
          entry.status === 'rejected' &&
          (entry.reason as { code?: string }).code === 'AUTHENTICATION_FAILED'
      )
    ).toHaveLength(1)
    expect(await f.receive(concurrentFrame, sibling.signal, 'independent-source')).toMatchObject({
      payload: 'value'
    })
    await expect(f.receive(await other.send(message('different-nonce')))).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED'
    })
  } finally {
    sibling.abort()
    await f.flow.dispose()
    await other.flow.dispose()
  }
})

// RPC-TEST-D12BE7E44139-C002: exercise original nonce failure inside the authentic Auth stage.
it.each(['missing', 'throwing'] as const)(
  'receives original %s nonce entropy failure without replacing its cause',
  async (mode) => {
    /** Construct native declarations before changing only the entropy used by the first Auth send. */
    const f = await fixture({ sign: (value) => value, verify: (value) => value })
    /** The original throwing native operation remains reachable by exact identity. */
    const original = new RangeError('Authentication replay nonce generation failed')
    /** Restore the real method before native owner cleanup even when an assertion fails. */
    let restore: (() => void) | undefined
    try {
      if (mode === 'missing') vi.stubGlobal('crypto', undefined)
      else {
        /** Only the original native entropy operation fails; no Auth callback replaces its owner. */
        const entropy = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(() => {
          throw original
        })
        restore = () => entropy.mockRestore()
      }
      /** This actual outbound stage has not yet allocated its first installation nonce. */
      const failure = await f.send(message('entropy')).catch((error: unknown) => error)
      expect(failure).toMatchObject({
        code: 'INVALID_CONFIG',
        message:
          mode === 'missing'
            ? 'Authentication replay nonce is unavailable'
            : 'Authentication replay nonce generation failed'
      })
      if (mode === 'throwing') {
        expect((failure as Error).cause).toBe(original)
        expect(original.stack).toBeTruthy()
      }
    } finally {
      restore?.()
      vi.unstubAllGlobals()
      await f.flow.dispose()
    }
  }
)

// RPC-TEST-D12BE7E44139-C007: mutate only the original seven signed binding fields.
it('rejects the original malformed versions counters and nonces after actual native verification', async () => {
  /** Native sign-only any exposes the authentic complete binding as an object to this callback. */
  const state = { change: {} as Record<string, unknown> }
  /** The genuine selected codec owns the native backing and all semantic metadata preparation. */
  const f = await fixture(
    {
      sign: (value) => {
        expect(typeof value).toBe('object')
        return { ...(value as object), ...state.change }
      },
      verify: (value) => value
    },
    true
  )
  try {
    /** Preserve the exact original malformed domains; each still fails before replay admission. */
    const invalid = [
      { version: 2 },
      { nonce: '' },
      { nonce: 'A'.repeat(32) },
      { counter: '0' },
      { counter: '-1' },
      { counter: '01' },
      { counter: '18446744073709551616' }
    ]
    for (const change of invalid) {
      state.change = change
      /** Four native bytes select the supported opaque binding without parsing signed text. */
      const frame = await f.send(message('malformed-binding', new Uint8Array([1, 2, 3, 4])))
      await expect(f.receive(frame)).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    }
  } finally {
    await f.flow.dispose()
  }
})

// RPC-TEST-D12BE7E44139-C008: payload categories remain business data beneath prepared metadata.
it.each(['text', new Uint8Array([0, 255, 42]), { nested: 'value' }])(
  'retains the original authenticated payload category %# through the actual codec',
  async (value) => {
    /** The codec owns the prepared envelope; Auth never adds an arbitrary raw protect API. */
    const f = await fixture({ sign: (input) => input, verify: (input) => input }, true)
    try {
      /** Preserve each original text, byte or record value after genuine verified restoration. */
      const received = await f.receive(await f.send(message('payload-category', value)))
      expect(received).toMatchObject({ payload: value })
      if (received.kind === 'call') {
        expect(typeof received.payload).toBe(typeof value)
        expect(received.payload instanceof Uint8Array).toBe(value instanceof Uint8Array)
        expect(received.payload).toEqual(value)
      } else expect.fail('expected original authenticated call')
    } finally {
      await f.flow.dispose()
    }
  }
)

it('finishes original native integrity before replay commit and reuses the exact cached restore Promise', async () => {
  /** Signing covers the original complete manifest including full backing digest/length. */
  const f = await fixture({ sign: (value) => value, verify: (value) => value }, true)
  /** The original complete backing is retained, including bytes outside a selected view. */
  const bytes = new Uint8Array([1, 2, 3, 4])
  /** This genuine protected physical packet retains the actual original sidecar identity. */
  const packet = await f.send(message('binary', bytes.subarray(1, 3)))
  expect(packet.sidecars?.[0]).toBe(bytes.buffer)
  expect(f.hashes.count).toBe(1)
  bytes[0] = 9
  /** Failed native integrity must retain its grammar classification rather than auth wrapping. */
  const failure = await f.receive(packet).catch((error: unknown) => error)
  expect(failure).toBeInstanceOf(Error)
  expect((failure as { code: string }).code).not.toBe('AUTHENTICATION_FAILED')
  bytes[0] = 1
  /** The same authentic counter remains admissible because its failed backing did not commit. */
  expect(await f.receive(packet)).toMatchObject({ id: 'binary', payload: new Uint8Array([2, 3]) })
  expect(f.hashes.count).toBe(3)
  await f.installation.dispose?.()
  await f.flow.dispose()
})

it('rejects verification after physical retirement and preserves custom verification failure cause', async () => {
  /** The original delayed-verifier lifecycle oracle reaches the actual fixed hook. */
  const wait = deferred<void>()
  /** Arrival is separate from real connection retirement and verifier completion. */
  const arrived = deferred<void>()
  /** This explicit state object keeps the verifier callback's owned ports together. */
  const state = { wait, arrived }
  /** User verification can suspend while the exact physical source closes. */
  const f = await fixture({
    sign: (value) => value,
    verify: async (value) => {
      state.arrived.resolve()
      await state.wait.promise
      return value
    }
  })
  /** Only the original actual packet is delivered to the waiting verifier. */
  const packet = await f.send(message('late'))
  /** Rejection remains observed during asynchronous physical shutdown. */
  const pending = f.receive(packet).catch((error: unknown) => error)
  await arrived.promise
  f.source.abort()
  wait.resolve()
  expect(await pending).toMatchObject({ code: 'AUTHENTICATION_FAILED' })
  await f.installation.dispose?.()
  await f.flow.dispose()
  /**
   * A native user callback error is preserved unless the separate credential-redaction rule
   * applies.
   */
  const cause = new RangeError('fixture bad signature')
  /** Actual verify failure keeps the original cause/type/stack reachable. */
  const bad = await fixture({
    sign: (value) => value,
    verify: () => {
      throw cause
    }
  })
  await expect(bad.receive(await bad.send(message('bad')))).rejects.toMatchObject({
    code: 'AUTHENTICATION_FAILED',
    cause
  })
  await bad.installation.dispose?.()
  await bad.flow.dispose()
})

it('retains the last uint64 allocation and sanitizes actual handshake verifier credentials', async () => {
  /** The configured signer reads only the actual input with Auth's existing representation owner. */
  const representation = new AuthenticationRepresentation('any')
  /** Original decimal spelling is observable without adding an allocator inspection port. */
  const signedCounters: string[] = []
  /** Reuse the original private exact-owner injection seam, without adding a public counter option. */
  const f = await fixture({
    sign: (value) => {
      signedCounters.push(readAuthenticationEnvelope(representation.plaintext(value)).counter)
      return value
    },
    verify: (value) => value
  })
  expect(setAuthenticationReplayCounter({ ...f.installation }, 0n)).toBe(false)
  expect(setAuthenticationReplayCounter(f.installation, 0xfffffffffffffffen)).toBe(true)
  expect(await f.receive(await f.send(message('last', { value: 'last' })))).toMatchObject({
    id: 'last',
    payload: { value: 'last' }
  })
  expect(signedCounters).toEqual(['18446744073709551615'])
  await expect(f.send(message('overflow'))).rejects.toMatchObject({
    code: 'INVALID_CONFIG',
    message: 'Authentication replay counter is exhausted'
  })
  await f.installation.dispose?.()
  await f.flow.dispose()
  /** A real native credential callback is independent from the optional frame protection policy. */
  const secret = 'fixture-private-token'
  /** User verifier errors may contain credentials and must not enter cause/report paths. */
  const credentials = await fixture({
    credentials: secret,
    verifyCredentials: () => {
      throw new Error(secret)
    }
  })
  /** Fixed handshake hook adds only the admitted portable auth field to the actual hello shape. */
  const hello = {
    profile: RpcWireProfile,
    kind: 'handshake',
    step: 'hello',
    versions: [{ major: 2, minor: 0 }],
    codecs: ['json'],
    extensions: [],
    peer: { id: 'caller', runtime: 'custom' },
    directory: {
      schemaVersion: 3,
      self: {
        name: 'caller',
        instanceId: 'caller',
        generation: { kind: 'session', value: 1, providerId: 'caller' }
      },
      methods: []
    }
  } as IRpcHello
  /** Outbound and inbound run the corresponding native handshake declarations. */
  const offered = await credentials.pipelines
    .pipeline(RpcFlowPoint.handshakeOutbound, 'test')
    .run(
      { handshake: hello, context: credentials.context('outbound') },
      async (payload) => payload.handshake
    )
  expect(offered).toMatchObject({ auth: secret })
  /** The sanitized rejection deliberately withholds the original secret-bearing native exception. */
  const rejected = await credentials.pipelines
    .pipeline(RpcFlowPoint.handshakeInbound, 'test')
    .run(
      { handshake: offered!, context: credentials.context('inbound') },
      async (payload) => payload.handshake
    )
    .catch((error: unknown) => error)
  expect(rejected).toMatchObject({ code: 'AUTHENTICATION_FAILED' })
  expect((rejected as Error).cause).toBeUndefined()
  expect(String(rejected)).not.toContain(secret)
  expect(credentials.reports).toEqual([])
  await credentials.installation.dispose?.()
  await credentials.flow.dispose()
  /** Native credential resolution keeps independent carrier tokens without inspecting wire identity. */
  const verify = vi.fn()
  /** The same actual optional flow resolves both native sources through its fixed handshake hook. */
  const perSource = await fixture({
    credentials: (context) => {
      if (context.carrierId === 'failed-source') throw new Error(secret)
      return context.carrierId
    },
    verifyCredentials: verify
  })
  /** Exact original context identity is also lent to the inbound native verifier. */
  const sourceOne = perSource.context('inbound', undefined, 'source-one')
  expect(
    await perSource.pipelines
      .pipeline(RpcFlowPoint.handshakeOutbound, 'test')
      .run(
        { handshake: hello, context: perSource.context('outbound', undefined, 'source-one') },
        async (payload) => payload.handshake
      )
  ).toMatchObject({ auth: 'source-one' })
  expect(
    await perSource.pipelines
      .pipeline(RpcFlowPoint.handshakeOutbound, 'test')
      .run(
        { handshake: hello, context: perSource.context('outbound', undefined, 'source-two') },
        async (payload) => payload.handshake
      )
  ).toMatchObject({ auth: 'source-two' })
  await perSource.pipelines
    .pipeline(RpcFlowPoint.handshakeInbound, 'test')
    .run({ handshake: hello, context: sourceOne }, async (payload) => payload.handshake)
  expect(verify.mock.calls[0]?.[2]).toBe(sourceOne)
  /** Resolver failures follow the same privacy boundary as native credential verification. */
  const resolverFailure = await perSource.pipelines
    .pipeline(RpcFlowPoint.handshakeOutbound, 'test')
    .run(
      { handshake: hello, context: perSource.context('outbound', undefined, 'failed-source') },
      async (payload) => payload.handshake
    )
    .catch((error: unknown) => error)
  expect(resolverFailure).toMatchObject({ code: 'AUTHENTICATION_FAILED' })
  expect((resolverFailure as Error).cause).toBeUndefined()
  expect(String(resolverFailure)).not.toContain(secret)
  expect(perSource.reports).toEqual([])
  await perSource.installation.dispose?.()
  await perSource.flow.dispose()
})

it.each([
  [{ encrypt: (value: unknown) => value }, 'encrypt/decrypt'],
  [{ sign: (value: unknown) => value }, 'sign/verify'],
  [{}, 'requires encryption or signing'],
  [
    { encrypt: (value: unknown) => value, decrypt: (value: unknown) => value },
    'encryption requires sign/verify replay binding'
  ]
] as const)(
  'retains original incomplete-pair and encrypt-only configuration rejection %#',
  (options, text) => {
    /** One factory call preserves the original code and precise existing rejection branch. */
    let failure: unknown
    try {
      auth(options)
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({ code: 'INVALID_CONFIG' })
    expect((failure as Error).message).toContain(text)
  }
)

it('fails closed for absent/throwing secure entropy while preserving the original native cause', async () => {
  /** The old native entropy boundary now reaches the actual optional installed hook. */
  const missing = await fixture({ sign: (value) => value, verify: (value) => value })
  vi.stubGlobal('crypto', undefined)
  try {
    await expect(missing.send(message('missing-entropy'))).rejects.toMatchObject({
      code: 'INVALID_CONFIG',
      message: 'Authentication replay nonce is unavailable'
    })
  } finally {
    vi.unstubAllGlobals()
    await missing.installation.dispose?.()
    await missing.flow.dispose()
  }
  /**
   * This exact native failure must remain reachable, with its original stack, rather than weak
   * fallback.
   */
  const cause = new RangeError('fixture native entropy failure')
  /** A fresh installation owns an independent not-yet-allocated nonce. */
  const throwing = await fixture({ sign: (value) => value, verify: (value) => value })
  vi.stubGlobal('crypto', {
    getRandomValues: () => {
      throw cause
    }
  })
  try {
    await expect(throwing.send(message('throwing-entropy'))).rejects.toMatchObject({
      code: 'INVALID_CONFIG',
      message: 'Authentication replay nonce generation failed',
      cause
    })
    expect(cause.stack).toBeTruthy()
  } finally {
    vi.unstubAllGlobals()
    await throwing.installation.dispose?.()
    await throwing.flow.dispose()
  }
})
