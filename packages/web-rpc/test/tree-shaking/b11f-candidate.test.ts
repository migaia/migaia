import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { IWebRpcEndpointModule } from '../../src/core.js'
import {
  hasNativeProviderClaimAuthority,
  isNativeProviderModule,
  registerNativeProviderClaimAuthority,
  registerNativeProviderModule
} from '../../src/internal/provider-claim-authority.js'
import {
  clientRuntimeOwnerKeys,
  coreRuntimeOwnerKeys,
  customRuntimeOwnerKeys,
  fullRuntimeOwnerKeys,
  providerRuntimeOwnerKeys
} from '../fixtures/tree-shaking/runtime-owner-topology.js'

type IConsumer = 'core' | 'client' | 'provider' | 'full' | 'custom'

type ITuple = {
  readonly moduleCount: number
  readonly rawBytes: number
  readonly gzipBytes: number
  readonly endpointStaticImportCount?: number
}

type IModuleAttribution = {
  readonly module: string
  readonly originalBytes: number
  readonly renderedBytes: number
}

type ILiveReport = {
  readonly root: ITuple
  readonly modules: readonly string[]
  readonly moduleAttribution: readonly IModuleAttribution[]
}

type IRetainedEntry = {
  readonly bundleSha256: string
  readonly entryProvenance: {
    readonly virtualId: string
    readonly sourceSha256: string
  }
  readonly gzipBytes: number
  readonly moduleCount: number
  readonly modules: readonly string[]
  readonly rawBytes: number
}

type IRetainedReport = Readonly<Record<IConsumer, IRetainedEntry>>

type IIncomingEdge = { readonly consumer: IConsumer; readonly from: string; readonly to: string }

type ICandidateModule = {
  readonly module: string
  readonly owner: string
  readonly requirements: readonly string[]
  readonly retainedConsumers: readonly IConsumer[]
  readonly rationale: string
  readonly byteAttribution: {
    readonly originalBytes: number
    readonly renderedBytes: number
  } | null
  readonly incomingEdges: readonly IIncomingEdge[]
}

type IPostMigrationCandidate = {
  readonly schema: string
  readonly status: 'approved'
  readonly provenanceDigest: string
  readonly approval: {
    readonly decisionId: string
    readonly keyId: string
    readonly digest: string
    readonly newTuple: Omit<ITuple, 'endpointStaticImportCount'>
  }
  readonly oldTuple: ITuple
  readonly newTuple: ITuple
  readonly rootModules: readonly string[]
  readonly consumers: Readonly<Record<IConsumer, IRetainedEntry>>
  readonly addedModules: readonly ICandidateModule[]
  readonly removedModules: readonly ICandidateModule[]
  readonly runtimeOwnerAllocation: Readonly<Record<IConsumer, readonly string[]>>
  readonly causalSchema: string
}

type ICausalReport = {
  readonly schema: string
  readonly retainedCounts: Readonly<Record<IConsumer, number>>
  readonly candidateAttribution: readonly {
    readonly module: string
    readonly retainedBy: readonly IConsumer[]
    readonly incomingEdges: readonly IIncomingEdge[]
  }[]
}

type IProvenanceReport = {
  readonly approval: {
    readonly status: string
    readonly approvalRecord: {
      readonly decisionId: string
      readonly keyId: string
      readonly digest: string
      readonly newTuple: Omit<ITuple, 'endpointStaticImportCount'>
    } | null
  }
  readonly subject: { readonly digest: string }
  readonly tuple: Omit<ITuple, 'endpointStaticImportCount'>
}

const workspaceRoot = resolve(import.meta.dirname, '../../../..')
const packageRoot = resolve(workspaceRoot, 'packages/web-rpc')
const consumers: readonly IConsumer[] = ['core', 'client', 'provider', 'full', 'custom']

const expectedRuntimeOwnerAllocation: Readonly<Record<IConsumer, readonly string[]>> = {
  core: coreRuntimeOwnerKeys,
  client: clientRuntimeOwnerKeys,
  provider: providerRuntimeOwnerKeys,
  full: fullRuntimeOwnerKeys,
  custom: customRuntimeOwnerKeys
}

/** Rejects any allocation that differs from the package-owned ordered topology. */
function assertExactRuntimeOwnerAllocation(
  allocation: Readonly<Record<IConsumer, readonly string[]>>
): void {
  for (const consumer of consumers)
    expect(new Set(allocation[consumer]).size).toBe(allocation[consumer].length)
  expect(allocation).toEqual(expectedRuntimeOwnerAllocation)
}

/** Runs a canonical JSON-producing evidence script from the admitted workspace root. */
function readJson<T>(script: string): T {
  return JSON.parse(
    execFileSync(process.execPath, [resolve(packageRoot, script)], {
      cwd: workspaceRoot,
      encoding: 'utf8'
    })
  ) as T
}

/** Runs the provenance script while preserving its JSON output on any validation exit. */
function readProvenance(): IProvenanceReport {
  const result = spawnSync(
    process.execPath,
    [resolve(packageRoot, 'test/tree-shaking-provenance.mjs')],
    { cwd: workspaceRoot, encoding: 'utf8', env: readCanonicalEnvironment() }
  )
  return JSON.parse(result.stdout) as IProvenanceReport
}

/** Removes Vitest worker markers so provenance sees the same environment as the CLI gate. */
function readCanonicalEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => key !== 'VITEST' && !key.startsWith('VITEST_') && key !== 'NODE_ENV'
    )
  )
}

/** Converts absolute canonical-build paths to the retained-inventory identity. */
function normalizeRootModule(module: string): string {
  const relative = module.replace(`${workspaceRoot}/`, '')
  return relative.startsWith('packages/web-rpc/')
    ? relative
    : relative.startsWith('packages/')
      ? `workspace:${relative}`
      : relative
}

/** Hashes an authority input so candidate tests fail if Luna mutates frozen approval state. */
function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

describe('WRC-C-B11f pending post-migration candidate', () => {
  it('attributes provider claim authority to R50 package-native identity admission', async () => {
    const { default: rawCandidate } = await import(
      '../fixtures/tree-shaking/post-migration-candidate.json',
      { with: { type: 'json' } }
    )
    const candidate = rawCandidate as unknown as IPostMigrationCandidate
    const authority = candidate.addedModules.find(
      ({ module }) => module === 'packages/web-rpc/src/internal/provider-claim-authority.ts'
    )

    expect(authority).toMatchObject({
      owner: '@migaia/web-rpc',
      requirements: ['WRC-C-R50'],
      rationale:
        'Provider inventory and admission retain the WeakSet-backed package-native identity authority that mints and checks first-party provider modules and claims without owning duplicate detection.'
    })

    const nativeModule = Object.freeze({}) as IWebRpcEndpointModule
    const forgedModule = Object.freeze({}) as IWebRpcEndpointModule
    const nativeClaims = Object.freeze({})
    const forgedClaims = Object.freeze({})

    expect(isNativeProviderModule(nativeModule)).toBe(false)
    registerNativeProviderModule(nativeModule)
    expect(isNativeProviderModule(nativeModule)).toBe(true)
    expect(isNativeProviderModule(forgedModule)).toBe(false)

    expect(hasNativeProviderClaimAuthority(nativeClaims)).toBe(false)
    registerNativeProviderClaimAuthority(nativeClaims)
    expect(hasNativeProviderClaimAuthority(nativeClaims)).toBe(true)
    expect(hasNativeProviderClaimAuthority(forgedClaims)).toBe(false)
  })

  it('matches canonical root, five-consumer closure, provenance, and causal attribution', async () => {
    const { default: rawCandidate } = await import(
      '../fixtures/tree-shaking/post-migration-candidate.json',
      { with: { type: 'json' } }
    )
    const candidate = rawCandidate as unknown as IPostMigrationCandidate
    const baseline = readJson<ILiveReport>('test/tree-shaking-baseline.mjs')
    const retained = readJson<IRetainedReport>('test/tree-shaking-retained.mjs')
    const causal = readJson<ICausalReport>('test/tree-shaking/core-retained-causal.mjs')
    const provenance = readProvenance()

    expect(candidate.schema).toBe('WRC-C-B11f-post-migration-candidate-v2')
    expect(candidate.causalSchema).toBe('WRC-C-B11f-five-consumer-causal-v2')
    expect(candidate.status).toBe('approved')
    expect(candidate.approval).toEqual({
      decisionId: 'WRC-C-B11-decision-20260827-04',
      keyId: 'coordinator-ed25519-7556143481d08058',
      digest: candidate.provenanceDigest,
      newTuple: {
        moduleCount: candidate.newTuple.moduleCount,
        rawBytes: candidate.newTuple.rawBytes,
        gzipBytes: candidate.newTuple.gzipBytes
      }
    })
    expect(candidate.oldTuple).toEqual({
      moduleCount: 53,
      rawBytes: 250129,
      gzipBytes: 61171,
      endpointStaticImportCount: 28
    })
    expect(candidate.newTuple).toEqual(baseline.root)
    expect(candidate.rootModules).toEqual(baseline.modules.map(normalizeRootModule).sort())
    expect(provenance.approval.status).toBe('approved')
    expect(provenance.subject.digest).toBe(candidate.provenanceDigest)
    expect(provenance.tuple).toEqual({
      moduleCount: candidate.newTuple.moduleCount,
      rawBytes: candidate.newTuple.rawBytes,
      gzipBytes: candidate.newTuple.gzipBytes
    })
    expect(provenance.approval.approvalRecord).toMatchObject(candidate.approval)
    assertExactRuntimeOwnerAllocation(candidate.runtimeOwnerAllocation)

    for (const consumer of consumers) {
      expect(candidate.consumers[consumer]).toEqual(retained[consumer])
      expect(candidate.consumers[consumer].moduleCount).toBe(causal.retainedCounts[consumer])
      expect(candidate.consumers[consumer].rawBytes).toBeGreaterThan(0)
      expect(candidate.consumers[consumer].gzipBytes).toBeGreaterThan(0)
      expect(candidate.consumers[consumer].bundleSha256).toMatch(/^[0-9a-f]{64}$/)
      expect(candidate.consumers[consumer].entryProvenance).toEqual({
        virtualId: `virtual:web-rpc-${consumer}`,
        sourceSha256: expect.stringMatching(/^[0-9a-f]{64}$/)
      })
    }

    const oldBaseline = JSON.parse(
      readFileSync(
        resolve(packageRoot, 'test/fixtures/tree-shaking/pre-migration-tree-shaking-baseline.json'),
        'utf8'
      )
    ) as ILiveReport
    const oldModules = new Set(oldBaseline.modules.map(normalizeRootModule))
    const liveModules = new Set(candidate.rootModules)
    expect(candidate.addedModules.map(({ module }) => module)).toEqual(
      [...liveModules].filter((module) => !oldModules.has(module)).sort()
    )
    expect(candidate.removedModules.map(({ module }) => module)).toEqual(
      [...oldModules].filter((module) => !liveModules.has(module)).sort()
    )

    const byteAttribution = new Map(
      baseline.moduleAttribution.map((entry) => [normalizeRootModule(entry.module), entry])
    )
    const causalAttribution = new Map(
      causal.candidateAttribution.map((entry) => [
        entry.module.startsWith('src/') ? `packages/web-rpc/${entry.module}` : entry.module,
        entry
      ])
    )
    for (const entry of candidate.addedModules) {
      expect(entry.owner.length).toBeGreaterThan(0)
      expect(entry.requirements.length).toBeGreaterThan(0)
      expect(entry.retainedConsumers.length).toBeGreaterThan(0)
      expect(entry.rationale.length).toBeGreaterThan(0)
      const attribution = byteAttribution.get(entry.module)
      expect(entry.byteAttribution).toEqual({
        originalBytes: attribution?.originalBytes,
        renderedBytes: attribution?.renderedBytes
      })
      const causalEntry = causalAttribution.get(entry.module)
      expect(causalEntry).toBeDefined()
      expect(entry.retainedConsumers).toEqual(causalEntry?.retainedBy)
      expect(causalEntry?.incomingEdges.length).toBeGreaterThan(0)
      expect(entry.incomingEdges).toEqual(causalEntry?.incomingEdges)
    }
  })

  it('preserves frozen authority inputs and unique runtime owner allocation', async () => {
    const { default: rawCandidate } = await import(
      '../fixtures/tree-shaking/post-migration-candidate.json',
      { with: { type: 'json' } }
    )
    const candidate = rawCandidate as unknown as IPostMigrationCandidate
    const authorityFiles = [
      [
        'pre-migration-tree-shaking-baseline.json',
        'ab9b3fec5cf40c693d1ed394ab8ec5ad5165d53f4d2cd0986475213b3833aec7'
      ],
      [
        'tree-shaking-baseline.json',
        'fd9e6f8b64fab40cb51230c6d9a806ed352e6af0962f5924d861fedae633b73c'
      ],
      [
        'baseline-authority.json',
        'dc875c8bff6dacde017ca0aa272657197e619ee68c33c76ab4a7ccd7ba6f7f86'
      ],
      [
        'baseline-authorization.json',
        '1f65d1b2144cf9fa2b626a342aab4c2245b8f57eb591502441ec925c7b760822'
      ]
    ] as const

    for (const [name, digest] of authorityFiles) {
      expect(hashFile(resolve(packageRoot, 'test/fixtures/tree-shaking', name))).toBe(digest)
    }
    assertExactRuntimeOwnerAllocation(candidate.runtimeOwnerAllocation)
    /** Four hostile transformations required for every retained consumer allocation. */
    const mutations = [
      (owners: readonly string[]) => owners.slice(0, -1),
      (owners: readonly string[]) => [...owners, 'forged-owner'],
      (owners: readonly string[]) => [owners[1]!, owners[0]!, ...owners.slice(2)],
      (owners: readonly string[]) => [owners[0]!, owners[0]!, ...owners.slice(1)]
    ] as const
    /** Counts the complete five-consumer by four-mutation rejection matrix. */
    let rejectedMutations = 0
    for (const consumer of consumers) {
      const owners = candidate.runtimeOwnerAllocation[consumer]
      for (const mutation of mutations) {
        const allocation = {
          ...candidate.runtimeOwnerAllocation,
          [consumer]: mutation(owners)
        } as Readonly<Record<IConsumer, readonly string[]>>
        expect(() => assertExactRuntimeOwnerAllocation(allocation)).toThrow()
        rejectedMutations += 1
      }
    }
    expect(rejectedMutations).toBe(20)
    const authority = JSON.parse(
      readFileSync(
        resolve(packageRoot, 'test/fixtures/tree-shaking/baseline-authority.json'),
        'utf8'
      )
    ) as {
      readonly decisionId: string
      readonly keyId: string
      readonly payloadDigest: string
      readonly status: string
    }
    const authorization = JSON.parse(
      readFileSync(
        resolve(packageRoot, 'test/fixtures/tree-shaking/baseline-authorization.json'),
        'utf8'
      )
    ) as {
      readonly status: string
      readonly approvalRecord: {
        readonly decisionId: string
        readonly keyId: string
        readonly digest: string
        readonly signature: string
      }
    }
    expect(authority.status).toBe('approved')
    expect(authorization.status).toBe('approved')
    expect(authorization.approvalRecord).toMatchObject({
      decisionId: authority.decisionId,
      keyId: authority.keyId,
      digest: authority.payloadDigest
    })
    expect(authorization.approvalRecord.signature).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(candidate.removedModules.map(({ module }) => module)).toEqual([
      'packages/web-rpc/src/internal/capability-registry.ts',
      'packages/web-rpc/src/internal/pipeline.ts'
    ])
  })

  it('keeps legacy and unselected concrete owners outside every selected closure', async () => {
    const { default: rawCandidate } = await import(
      '../fixtures/tree-shaking/post-migration-candidate.json',
      { with: { type: 'json' } }
    )
    const candidate = rawCandidate as unknown as IPostMigrationCandidate
    const forbidden =
      /(?:^|\/)(?:factory|endpoint)\.ts$|endpoint-resource-manager|capability-registry|internal\/(?:runtime|pipeline)\.ts$/

    for (const module of candidate.rootModules) expect(module).not.toMatch(forbidden)
    for (const module of candidate.rootModules)
      expect(module).not.toMatch(/^workspace:packages\/web-rpc\//)
    for (const consumer of consumers) {
      for (const module of candidate.consumers[consumer].modules) {
        expect(module).not.toMatch(forbidden)
        expect(module).not.toMatch(/^workspace:packages\/web-rpc\//)
      }
    }
    expect(candidate.addedModules.some(({ module }) => forbidden.test(module))).toBe(false)
  })
})
