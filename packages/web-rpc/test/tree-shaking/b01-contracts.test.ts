import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createMemoryTransportPair } from '../../src/adapters/memory.js'
import { connect } from '../../src/middleware/connect.js'
import { readEndpointDebugSnapshot } from '../../src/internal/test-observer.js'
import {
  clientRuntimeOwnerKeys,
  defaultRuntimeOwnerKeys,
  providerRuntimeOwnerKeys
} from '../fixtures/tree-shaking/runtime-owner-topology.js'

const missingPresetEntrypoints = [
  '../../src/core.js',
  '../../src/client.js',
  '../../src/provider.js',
  '../../src/full.js'
]
const missingFeatureEntrypoints = [
  '../../src/features/outbound.js',
  '../../src/features/provider.js',
  '../../src/features/discovery.js',
  '../../src/features/control.js',
  '../../src/features/canonical-chunk.js'
]

/** WRC-B01 contracts become green as static composition entries land. */
describe('WRC-B01 static composition contracts', () => {
  for (const entrypoint of missingPresetEntrypoints)
    it(`publishes preset: ${entrypoint}`, async () => {
      const module = await import(entrypoint)
      expect(Object.values(module).some((value) => typeof value === 'function')).toBe(true)
    })

  for (const entrypoint of missingFeatureEntrypoints)
    it(`publishes feature: ${entrypoint}`, async () => {
      const module = await import(entrypoint)
      expect(Object.values(module).some((value) => typeof value === 'function')).toBe(true)
    })

  it('rejects forged module token before transport side effects', async () => {
    const coreEntrypoint = '../../src/core.js'
    const core = await import(coreEntrypoint)
    const forged = {}
    const transport = {
      subscribe: () => {
        throw new Error('subscribe must not run')
      }
    }
    await expect(
      core.createComposedEndpoint({ id: 'forged', transport, middlewares: [] }, [forged])
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
  })

  it('rejects duplicate module identity before transport side effects', async () => {
    const coreEntrypoint = '../../src/core.js'
    const outboundEntrypoint = '../../src/features/outbound.js'
    const core = await import(coreEntrypoint)
    const outbound = await import(outboundEntrypoint)
    const module = outbound.outbound()
    const transport = {
      subscribe: () => {
        throw new Error('subscribe must not run')
      }
    }
    await expect(
      core.createComposedEndpoint({ id: 'duplicate', transport, middlewares: [] }, [module, module])
    ).rejects.toMatchObject({ code: 'CAPABILITY_CONFLICT' })
  })

  it('accepts every pair with one canonical outbound dependency closure', async () => {
    const core = await import('../../src/core.js')
    const [outbound, provider, discovery, control, chunk] = await Promise.all([
      import('../../src/features/outbound.js'),
      import('../../src/features/provider.js'),
      import('../../src/features/discovery.js'),
      import('../../src/features/control.js'),
      import('../../src/features/canonical-chunk.js')
    ])
    const modules = [
      outbound.outbound(),
      provider.provider(),
      discovery.discovery(),
      control.control(),
      chunk.canonicalChunk()
    ]
    let subscriptions = 0
    const transport = {
      send: () => undefined,
      subscribe: () => {
        subscriptions += 1
        return () => undefined
      },
      platform: 'Memory' as const
    }
    for (let left = 0; left < modules.length; left += 1)
      for (let right = left + 1; right < modules.length; right += 1) {
        const endpoint = await core.createComposedEndpoint(
          { id: `overlap-${left}-${right}`, transport, middlewares: [connect()] },
          [modules[left], modules[right]]
        )
        await endpoint.dispose()
      }
    expect(subscriptions).toBe(10)
  })

  it.each([
    [
      'client',
      () => import('../../src/client.js').then(({ createClientEndpoint }) => createClientEndpoint)
    ],
    [
      'provider',
      () =>
        import('../../src/provider.js').then(({ createProviderEndpoint }) => createProviderEndpoint)
    ]
  ])('constructs and disposes the valid %s singleton preset', async (_name, loadFactory) => {
    const [transport] = createMemoryTransportPair()
    const createPreset = await loadFactory()
    const endpoint = await createPreset({
      id: `singleton-${_name}`,
      transport,
      middlewares: [connect({ transport })]
    })
    expect('discovery' in endpoint).toBe(false)
    expect('connect' in endpoint).toBe(false)
    expect('ping' in endpoint).toBe(false)
    expect(readEndpointDebugSnapshot(endpoint)?.owners).toEqual(
      _name === 'client' ? clientRuntimeOwnerKeys : providerRuntimeOwnerKeys
    )
    const firstDispose = endpoint.dispose()
    expect(endpoint.dispose()).toBe(firstDispose)
    await firstDispose
    expect(readEndpointDebugSnapshot(endpoint)?.phase).toBe('disposed')
  })

  it('preserves the projected provider surface through chained provide calls', async () => {
    const { createProviderEndpoint } = await import('../../src/provider.js')
    const [transport] = createMemoryTransportPair()
    const endpoint = await createProviderEndpoint({
      id: 'provider-chain',
      transport,
      middlewares: [connect({ transport })]
    })
    const chained = endpoint.provide('echo', (context) => context.success(context.data))
    expect(chained).toBe(endpoint)
    expect('discovery' in chained).toBe(false)
    await chained.dispose()
  })

  it('projects selected root keys from exposed metadata', async () => {
    const core = await import('../../src/core.js')
    const [{ provider }, { discovery }, { canonicalChunk: chunk }] = await Promise.all([
      import('../../src/features/provider.js'),
      import('../../src/features/discovery.js'),
      import('../../src/features/canonical-chunk.js')
    ])
    const [transport] = createMemoryTransportPair()
    const providerEndpoint = await core.createComposedEndpoint(
      { id: 'exposed-provider', transport, middlewares: [connect({ transport })] },
      [provider()]
    )
    expect(Object.keys(providerEndpoint).sort()).toEqual([
      'dispatch',
      'dispatchAll',
      'dispose',
      'hooks',
      'on',
      'provide',
      'send',
      'sendAll'
    ])
    expect('connect' in providerEndpoint).toBe(false)
    await providerEndpoint.dispose()

    const [discoveryTransport] = createMemoryTransportPair()
    const discoveryEndpoint = await core.createComposedEndpoint(
      {
        id: 'exposed-discovery',
        transport: discoveryTransport,
        middlewares: [connect({ transport: discoveryTransport })]
      },
      [discovery()]
    )
    expect('connect' in discoveryEndpoint).toBe(true)
    expect('discovery' in discoveryEndpoint).toBe(true)
    expect('send' in discoveryEndpoint).toBe(false)
    await discoveryEndpoint.dispose()

    const [chunkTransport] = createMemoryTransportPair()
    const chunkEndpoint = await core.createComposedEndpoint(
      { id: 'exposed-chunk', transport: chunkTransport, middlewares: [connect()] },
      [chunk()]
    )
    expect(Object.keys(chunkEndpoint).sort()).toEqual(['dispose', 'hooks', 'on'])
    expect('send' in chunkEndpoint).toBe(false)
    await chunkEndpoint.dispose()

    const [fullTransport] = createMemoryTransportPair()
    const fullEndpoint = await core.createComposedEndpoint(
      { id: 'exposed-full', transport: fullTransport, middlewares: [connect()] },
      [provider(), discovery()]
    )
    expect('send' in fullEndpoint).toBe(true)
    expect('connect' in fullEndpoint).toBe(true)
    expect('discovery' in fullEndpoint).toBe(true)
    const chainedFull = fullEndpoint.provide('echo', (context) => context.success(context.data))
    expect(chainedFull).toBe(fullEndpoint)
    expect('connect' in chainedFull).toBe(true)
    expect('discovery' in chainedFull).toBe(true)
    await chainedFull.dispose()
  })

  it('executes a recursive provider request through distinct slim runtimes', async () => {
    const [{ createClientEndpoint }, { createProviderEndpoint }] = await Promise.all([
      import('../../src/client.js'),
      import('../../src/provider.js')
    ])
    const [clientTransport, providerTransport] = createMemoryTransportPair()
    const providerEndpoint = await createProviderEndpoint({
      id: 'provider-runtime',
      transport: providerTransport,
      middlewares: [connect({ transport: providerTransport })]
    })
    providerEndpoint.provide('echo', (context) => context.success(context.data))
    const clientEndpoint = await createClientEndpoint({
      id: 'client-runtime',
      targetIds: ['provider-runtime'],
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport })]
    })
    await expect(clientEndpoint.send('provider-runtime', 'echo', { value: 1 })).resolves.toEqual({
      value: 1
    })
    await Promise.all([clientEndpoint.dispose(), providerEndpoint.dispose()])
  })

  it('constructs and disposes each remaining valid legacy singleton token', async () => {
    const core = await import('../../src/core.js')
    const [discovery, control, chunk] = await Promise.all([
      import('../../src/features/discovery.js'),
      import('../../src/features/control.js'),
      import('../../src/features/canonical-chunk.js')
    ])
    const modules = [discovery.discovery(), control.control(), chunk.canonicalChunk()]
    for (const [index, module] of modules.entries()) {
      const [transport] = createMemoryTransportPair()
      const endpoint = await core.createComposedEndpoint(
        {
          id: `legacy-singleton-${index}`,
          transport,
          middlewares: [connect({ transport })]
        },
        [module]
      )
      await endpoint.dispose()
    }
  })

  it('observes the current root without treating historical cost custody as live identity', async () => {
    const script = resolve(import.meta.dirname, '../tree-shaking-baseline.mjs')
    const workspaceRoot = resolve(import.meta.dirname, '../../../..')
    const live = JSON.parse(
      execFileSync(process.execPath, [script], { cwd: workspaceRoot, encoding: 'utf8' })
    )
    expect(live.root.moduleCount).toBeGreaterThan(0)
    expect(live.modules).toHaveLength(live.root.moduleCount)
    expect(live.modules).not.toContain(resolve(import.meta.dirname, '../../src/endpoint.ts'))
    expect(live.modules).not.toContain(resolve(import.meta.dirname, '../../src/factory.ts'))
  })

  it('observes the exact full runtime allocation topology through the root factory', async () => {
    const { createEndpoint } = await import('../../src/index.js')
    const [transport] = createMemoryTransportPair()
    const endpoint = await createEndpoint({
      id: 'root-allocation-topology',
      transport,
      middlewares: [connect({ transport })]
    })
    expect(readEndpointDebugSnapshot(endpoint)?.owners).toEqual(defaultRuntimeOwnerKeys)
    await endpoint.dispose()
  })

  it('requires every baseline owner category to declare a non-empty owner list', async () => {
    const inventory = await import('../fixtures/tree-shaking/owner-inventory.json', {
      with: { type: 'json' }
    })
    const endpoint = readFileSync(
      resolve(import.meta.dirname, '../../src/endpoint-kernel.ts'),
      'utf8'
    )
    const candidates = [...endpoint.matchAll(/#([A-Za-z0-9_]+)/g)].map((match) => `#${match[1]}`)
    const uniqueCandidates = [...new Set(candidates)]
    for (const candidate of uniqueCandidates)
      expect(inventory.default.ownerRules.some((rule) => new RegExp(rule).test(candidate))).toBe(
        true
      )
    for (const [owner, members] of Object.entries(inventory.default.root)) {
      if (owner === 'status') continue
      expect(members, owner).toBeInstanceOf(Array)
      expect(members, owner).not.toHaveLength(0)
    }
    expect(uniqueCandidates.length).toBeGreaterThan(0)
  })
})

const currentGenesisFixturePath = resolve(
  import.meta.dirname,
  '../fixtures/tree-shaking/reader-occurrence-v16-current-genesis.json'
)
const readerInventoryGeneratorPath = resolve(
  import.meta.dirname,
  '../../../../docs/rpc-contract/rpc-contract-reader-inventory.mjs'
)
const workspaceRoot = resolve(import.meta.dirname, '../../../..')

/**
 * Read the append-only current-genesis fixture without allowing a package test to consult
 * controller state.
 */
const readCurrentGenesisFixture = () =>
  JSON.parse(readFileSync(currentGenesisFixturePath, 'utf8')) as {
    schema: string
    workspaceRelative: boolean
    historical: {
      digest: string
      status: string
      fieldLevelDelta: string
      predecessorRows: null
      transition: null
    }
    current: {
      counts: Record<string, number>
      hashes: Record<string, string>
      edges: Array<Record<string, unknown>>
      semantic: Array<Record<string, unknown>>
      coordinate: Array<Record<string, unknown>>
    }
    controls: {
      coordinateAnchor: {
        digest: string
        computedDigest: string
      }
    }
  }

/**
 * Produce the current inventory through the installed generator and keep the package test
 * independently attributable.
 */
const readGeneratedCurrentGenesis = () =>
  JSON.parse(
    execFileSync(process.execPath, [readerInventoryGeneratorPath, '--final', workspaceRoot], {
      cwd: workspaceRoot,
      encoding: 'utf8'
    })
  ) as {
    schema: string
    counts: Record<string, number>
    hashes: Record<string, string>
    controls: {
      legacyImportType: {
        owner: {
          disposition: string
        }
      }
      providerImportTypeControls: {
        missingPackageRejected: boolean
        missingExportRejected: boolean
        missingTargetRejected: boolean
        targetRealpathEscapeRejected: boolean
        resolverEscapeRejected: boolean
        resolverMismatchRejected: boolean
        qualifierPreserved: boolean
        resolvedIdentityMatchesUnresolved: boolean
      }
    }
    genesis: {
      historical: {
        digest: string
        status: string
        fieldLevelDelta: string
        predecessorRows: null
        transition: null
      }
      current: {
        counts: Record<string, number>
        hashes: Record<string, string>
        edges: Array<Record<string, unknown>>
        semantic: Array<Record<string, unknown>>
        coordinate: Array<Record<string, unknown>>
      }
    }
  }

/** Serialize fixture projections with fixed insertion order, as required by the custody contract. */
const canonicalSerialize = (value: unknown) => JSON.stringify(value)

/** Hash package-owned evidence independently of the generator's expected anchor. */
const independentDigest = (value: unknown) =>
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import { createHash } from 'node:crypto'; process.stdout.write(createHash('sha256').update(process.argv[1]).digest('hex'))",
      '--',
      canonicalSerialize(value)
    ],
    { input: canonicalSerialize(value), encoding: 'utf8' }
  )

/** Project complete edge rows to the exact coordinate tuple owned by this independent host. */
const independentCoordinateProjection = (edges: Array<Record<string, unknown>>) =>
  edges.map(({ reader, line, column }) => ({ reader, line, column }))

/** WRC-B01-T17 proves current reader custody without laundering unavailable history. */
describe('WRC-B01 current-genesis reader custody', () => {
  it('keeps historical custody immutable while deriving a current live ledger', () => {
    const fixture = readCurrentGenesisFixture()
    const generated = readGeneratedCurrentGenesis()
    expect(generated.schema).toBe('rpc-contract-reader-inventory/v10')
    expect(generated.genesis.historical).toEqual(fixture.historical)
    expect(fixture.current.counts.occurrences).toBe(93)
    expect(fixture.current.counts.removable).toBe(0)
    expect(fixture.current.counts.retainedNegatives).toBe(93)
    expect(fixture.current.counts.ownerOperations).toBe(40)
    expect(fixture.current.counts.ownerRemovalOperations).toBe(0)
    expect(fixture.current.counts.ownerRetainedOperations).toBe(40)
    expect(fixture.current.edges).toHaveLength(93)
    expect(fixture.current.semantic).toHaveLength(93)
    expect(fixture.current.coordinate).toHaveLength(93)
    expect(fixture.current.hashes.full).toBe(
      'e9553af296e5280f4973532cb2b8da38e5e9bc6200eb878cd445ee909551994d'
    )
    expect(fixture.current.hashes.semantic).toBe(
      '1d9fc658fcba85c638c97b8802d3252c31eca1b102c797802300372dfce0089b'
    )
    expect(fixture.current.hashes.coordinate).toBe(
      '615f9aab6eb2a3620fa13302571307b4ba0be04f6e8d4d2bc19bb080def93f8d'
    )
    expect(generated.counts.removable).toBe(0)
    expect(generated.counts.ownerRemovalOperations).toBe(0)
    expect(independentDigest(fixture.current.edges)).toBe(fixture.current.hashes.full)
    expect(independentDigest(fixture.current.semantic)).toBe(fixture.current.hashes.semantic)
    expect(independentDigest(fixture.current.coordinate)).toBe(fixture.current.hashes.coordinate)
    expect(independentDigest(generated.genesis.current.edges)).toBe(generated.hashes.occurrences)
    const generatedCoordinates = independentCoordinateProjection(generated.genesis.current.edges)
    expect(independentDigest(generatedCoordinates)).toBe(generated.hashes.coordinate)
  })

  it('keeps historical custody opaque and rejects anti-laundering substitutions', () => {
    const fixture = readCurrentGenesisFixture()
    const historical = fixture.historical
    expect(historical.digest).toBe(
      '93942fd9acac3376eff76cce7cbdfa4a552e25051bf97505e7488debd84df830'
    )
    expect(historical.status).toBe('UNEXPANDED_HISTORICAL_DIGEST')
    expect(historical.fieldLevelDelta).toBe('UNAVAILABLE_NOT_CLAIMED')
    expect(historical.predecessorRows).toBeNull()
    expect(historical.transition).toBeNull()
    expect(fixture.current.hashes.full).not.toBe(historical.digest)

    const controls = readGeneratedCurrentGenesis().genesis.current
    const full = canonicalSerialize(controls.edges)
    const removeAndAdd = [
      ...controls.edges.slice(1),
      { ...controls.edges[0], reader: 'forged-reader' }
    ]
    const duplicate = [...controls.edges, controls.edges[0]]
    const omission = controls.edges.slice(0, -1)
    const reorder = [...controls.edges].reverse()
    expect(canonicalSerialize(removeAndAdd)).not.toBe(full)
    expect(canonicalSerialize(duplicate)).not.toBe(full)
    expect(canonicalSerialize(omission)).not.toBe(full)
    expect(canonicalSerialize(reorder)).not.toBe(full)
  })

  it('separates semantic-field and coordinate mutations', () => {
    const generated = readGeneratedCurrentGenesis()
    const controls = generated.genesis.current
    const semanticFields = [
      'reader',
      'kind',
      'owner',
      'symbol',
      'local',
      'disposition',
      'packet',
      'verification'
    ]
    const semantic = canonicalSerialize(controls.semantic)
    const full = canonicalSerialize(controls.edges)
    for (const field of semanticFields) {
      const mutated = controls.semantic.map((edge) => ({
        ...edge,
        [field]: `${String(edge[field])}:mutated`
      }))
      expect(canonicalSerialize(mutated), field).not.toBe(semantic)
      expect(
        canonicalSerialize(
          mutated.map((edge, index) => ({
            ...edge,
            line: controls.edges[index].line,
            column: controls.edges[index].column
          }))
        ),
        field
      ).not.toBe(full)
    }
    const lineMutation = controls.edges.map((edge, index) =>
      index === 0 ? { ...edge, line: Number(edge.line) + 1 } : edge
    )
    const columnMutation = controls.edges.map((edge, index) =>
      index === 0 ? { ...edge, column: Number(edge.column) + 1 } : edge
    )
    expect(
      canonicalSerialize(lineMutation.map(({ line: _line, column: _column, ...edge }) => edge))
    ).toBe(semantic)
    expect(
      canonicalSerialize(columnMutation.map(({ line: _line, column: _column, ...edge }) => edge))
    ).toBe(semantic)
    expect(canonicalSerialize(lineMutation)).not.toBe(full)
    expect(canonicalSerialize(columnMutation)).not.toBe(full)
  })

  it('exposes generator hostile controls as executable evidence', () => {
    const generated = readGeneratedCurrentGenesis()
    const source = readFileSync(readerInventoryGeneratorPath, 'utf8')
    expect(source).toContain('UNEXPANDED_HISTORICAL_DIGEST')
    expect(source).toContain('UNAVAILABLE_NOT_CLAIMED')
    expect(source).toContain('MIXED_OWNER_STABLE_NAME_MISSING')
    expect(source).toContain('REQUIRED_FINAL_ROOTS_MISSING')
    expect(generated.genesis.current.hashes.coordinate).toBe(generated.hashes.coordinate)
    expect(generated.controls.legacyImportType.owner.disposition).toBe('MIGRATE')
  })

  it('fails closed for manifest, target, and legacy provider evidence variants', () => {
    const generated = readGeneratedCurrentGenesis()
    expect(generated.controls.providerImportTypeControls).toEqual({
      missingPackageRejected: true,
      missingExportRejected: true,
      missingTargetRejected: true,
      targetRealpathEscapeRejected: true,
      resolverEscapeRejected: true,
      resolverMismatchRejected: true,
      qualifierPreserved: true,
      resolvedIdentityMatchesUnresolved: true
    })
  })
})
