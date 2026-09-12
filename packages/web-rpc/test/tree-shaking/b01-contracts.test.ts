import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createMemoryTransportPair } from '../../src/adapters/memory.js'
import { connect } from '../../src/middleware/connect.js'
import { defineFeature } from '../../src/feature.js'
import { readEndpointDebugSnapshot } from '../../src/internal/test-observer.js'
import {
  createFirstPartyRoots,
  type IWebRpcFirstPartyRootName
} from '../../src/internal/first-party-roots.js'
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
    const [transport] = createMemoryTransportPair()
    await expect(
      core.createComposedEndpoint({ id: 'forged', transport, middlewares: [] }, [forged])
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
  })

  it('rejects duplicate native public identity before transport side effects', async () => {
    const coreEntrypoint = '../../src/core.js'
    const core = await import(coreEntrypoint)
    const first = defineFeature({
      install: () => ({ duplicate: () => 'first' }),
      publicKeys: ['duplicate']
    })
    const second = defineFeature({
      install: () => ({ duplicate: () => 'second' }),
      publicKeys: ['duplicate']
    })
    const [transport] = createMemoryTransportPair()
    await expect(
      core.createComposedEndpoint(
        {
          id: 'duplicate',
          transport,
          middlewares: [connect({ transport })],
          features: [first, second] as const
        },
        Object.create(null)
      )
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
  })

  it('accepts every pair with one canonical outbound dependency closure', async () => {
    const core = await import('../../src/core.js')
    const roots: readonly IWebRpcFirstPartyRootName[] = [
      'first-party-outbound',
      'first-party-provider',
      'first-party-discovery',
      'first-party-control',
      'first-party-chunk'
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
    for (let left = 0; left < roots.length; left += 1)
      for (let right = left + 1; right < roots.length; right += 1) {
        const endpoint = await core.createComposedEndpoint(
          { id: `overlap-${left}-${right}`, transport, middlewares: [connect()] },
          createFirstPartyRoots(new Set([roots[left]!, roots[right]!]))
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
    const [transport] = createMemoryTransportPair()
    const providerEndpoint = await core.createComposedEndpoint(
      { id: 'exposed-provider', transport, middlewares: [connect({ transport })] },
      createFirstPartyRoots(new Set(['first-party-provider']))
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
      createFirstPartyRoots(new Set(['first-party-discovery']))
    )
    expect('connect' in discoveryEndpoint).toBe(true)
    expect('discovery' in discoveryEndpoint).toBe(true)
    expect('send' in discoveryEndpoint).toBe(false)
    await discoveryEndpoint.dispose()

    const [chunkTransport] = createMemoryTransportPair()
    const chunkEndpoint = await core.createComposedEndpoint(
      { id: 'exposed-chunk', transport: chunkTransport, middlewares: [connect()] },
      createFirstPartyRoots(new Set(['first-party-chunk']))
    )
    expect(Object.keys(chunkEndpoint).sort()).toEqual(['dispose'])
    expect('send' in chunkEndpoint).toBe(false)
    await chunkEndpoint.dispose()

    const [fullTransport] = createMemoryTransportPair()
    const fullEndpoint = await core.createComposedEndpoint(
      { id: 'exposed-full', transport: fullTransport, middlewares: [connect()] },
      createFirstPartyRoots(new Set(['first-party-provider', 'first-party-discovery']))
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

  it('constructs and disposes each remaining valid native singleton root', async () => {
    const core = await import('../../src/core.js')
    const roots: readonly IWebRpcFirstPartyRootName[] = [
      'first-party-discovery',
      'first-party-control',
      'first-party-chunk'
    ]
    for (const [index, root] of roots.entries()) {
      const [transport] = createMemoryTransportPair()
      const endpoint = await core.createComposedEndpoint(
        {
          id: `legacy-singleton-${index}`,
          transport,
          middlewares: [connect({ transport })]
        },
        createFirstPartyRoots(new Set([root]))
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

const readerEvidencePath = resolve(
  import.meta.dirname,
  '../../../../docs/plugin-host/native-feature-reader-evidence.mjs'
)
const workspaceRoot = resolve(import.meta.dirname, '../../../..')

/** Runs the current PC03 reader oracle without consulting protected rpc-contract custody. */
const readCurrentReaderEvidence = () =>
  JSON.parse(
    execFileSync(process.execPath, [readerEvidencePath, workspaceRoot], {
      cwd: workspaceRoot,
      encoding: 'utf8'
    })
  ) as {
    readonly schema: string
    readonly roots: readonly string[]
    readonly scannedFiles: number
    readonly activeReaders: readonly unknown[]
    readonly result: 'PASS' | 'FAIL'
  }

/** WRC-B01-T17 proves current reader closure through the task-owned NF evidence producer. */
describe('WRC-B01 current native-feature reader closure', () => {
  it('reads the complete nonwebsite owner universe without using protected historical custody', () => {
    const evidence = readCurrentReaderEvidence()
    expect(evidence.schema).toBe('native-feature-reader-evidence/v1')
    expect(evidence.result).toBe('PASS')
    expect(evidence.activeReaders).toEqual([])
    expect(evidence.scannedFiles).toBeGreaterThan(0)
    expect(evidence.roots).toEqual(
      expect.arrayContaining([
        'packages/plugin-host/src',
        'packages/web-rpc/src',
        'packages/storage-web/src',
        'packages/store-persist/src',
        'fixtures/consumers'
      ])
    )
  })

  it('fails when a disposable same-directory legacy translator alias is introduced', () => {
    const specimenDirectory = mkdtempSync(join(tmpdir(), 'native-feature-reader-'))
    const specimenPath = join(specimenDirectory, 'alias.ts')
    /** Joins the prohibited test fixture without making this test itself a reader finding. */
    const retiredSpecifier = './internal/' + 'plugin-' + 'translator.js'
    try {
      writeFileSync(specimenPath, `import '${retiredSpecifier}'\n`, 'utf8')
      expect(() =>
        execFileSync(
          process.execPath,
          [readerEvidencePath, workspaceRoot, '--specimen', specimenPath],
          {
            cwd: workspaceRoot,
            encoding: 'utf8'
          }
        )
      ).toThrow()
    } finally {
      rmSync(specimenDirectory, { recursive: true, force: true })
    }
  })
})
