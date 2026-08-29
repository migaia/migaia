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
  readonly provenance?: {
    readonly kind: 'import-edge' | 'entry-root' | 'generated-artifact'
    readonly locator?: {
      readonly artifact: string
      readonly artifactSha256: string
      readonly generator: string
      readonly source?: string
      readonly sourceSha256?: string
    }
  }
}

type ICandidateCausality = {
  readonly cause: string
  readonly owner: string
  readonly module: string
  readonly evidenceSchema: string
  readonly measuredDelta: ITuple
  readonly byteAttribution: Omit<IModuleAttribution, 'module'>
  readonly retainedBy: readonly IConsumer[]
  readonly incomingEdges: readonly IIncomingEdge[]
}

/** Describes the current event-subscriber increment separately from historical cumulative drift. */
type IIncrementalCausality = {
  readonly cause: string
  readonly owner: string
  readonly module: string
  readonly fromTuple: ITuple
  readonly toTuple: ITuple
  readonly measuredDelta: Required<ITuple>
  readonly byteAttribution: {
    readonly before: Omit<IModuleAttribution, 'module'>
    readonly after: Omit<IModuleAttribution, 'module'>
  }
  readonly retainedBy: readonly IConsumer[]
  readonly moduleSetChanged: boolean
  readonly endpointStaticImportCountChanged: boolean
  readonly webRpcProductionSourceDelta: number
}

type IPostMigrationCandidate = {
  readonly schema: string
  readonly status: 'approved'
  readonly approval: {
    readonly status: 'approved'
    readonly decisionId: string
    readonly keyId: string
    readonly digest: string
    readonly oldTuple: Omit<ITuple, 'endpointStaticImportCount'>
    readonly newTuple: Omit<ITuple, 'endpointStaticImportCount'>
  }
  readonly provenanceDigest: string
  readonly oldTuple: ITuple
  readonly newTuple: ITuple
  readonly rootModules: readonly string[]
  readonly consumers: Readonly<Record<IConsumer, IRetainedEntry>>
  readonly addedModules: readonly ICandidateModule[]
  readonly removedModules: readonly ICandidateModule[]
  readonly runtimeOwnerAllocation: Readonly<Record<IConsumer, readonly string[]>>
  readonly causality: ICandidateCausality
  readonly incrementalCausality: IIncrementalCausality
  readonly causalSchema: string
}

type ICausalReport = {
  readonly schema: string
  readonly retainedCounts: Readonly<Record<IConsumer, number>>
  readonly candidateAttribution: readonly {
    readonly module: string
    readonly retainedBy: readonly IConsumer[]
    readonly incomingEdges: readonly IIncomingEdge[]
    readonly provenance?: ICandidateModule['provenance']
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

describe('WRC-C-B11f approved post-migration candidate', () => {
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
    const { default: authority } = await import(
      '../fixtures/tree-shaking/baseline-authority.json',
      { with: { type: 'json' } }
    )
    expect(candidate.approval).toEqual({
      status: 'approved',
      decisionId: authority.decisionId,
      keyId: authority.keyId,
      digest: candidate.provenanceDigest,
      oldTuple: {
        moduleCount: candidate.oldTuple.moduleCount,
        rawBytes: candidate.oldTuple.rawBytes,
        gzipBytes: candidate.oldTuple.gzipBytes
      },
      newTuple: {
        moduleCount: candidate.newTuple.moduleCount,
        rawBytes: candidate.newTuple.rawBytes,
        gzipBytes: candidate.newTuple.gzipBytes
      }
    })
    const oldBaseline = JSON.parse(
      readFileSync(
        resolve(packageRoot, 'test/fixtures/tree-shaking/pre-migration-tree-shaking-baseline.json'),
        'utf8'
      )
    ) as ILiveReport
    expect(candidate.oldTuple).toEqual(oldBaseline.root)
    expect(candidate.newTuple).toEqual(baseline.root)
    expect(candidate.rootModules).toEqual(baseline.modules.map(normalizeRootModule).sort())
    expect(provenance.approval.status).toBe('approved')
    expect(provenance.subject.digest).toBe(candidate.provenanceDigest)
    expect(provenance.tuple).toEqual({
      moduleCount: candidate.newTuple.moduleCount,
      rawBytes: candidate.newTuple.rawBytes,
      gzipBytes: candidate.newTuple.gzipBytes
    })
    expect(provenance.approval.approvalRecord).toMatchObject({
      digest: candidate.provenanceDigest,
      newTuple: {
        moduleCount: candidate.newTuple.moduleCount,
        rawBytes: candidate.newTuple.rawBytes,
        gzipBytes: candidate.newTuple.gzipBytes
      }
    })
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
    const pluginHostModules = baseline.moduleAttribution
      .map((entry) => normalizeRootModule(entry.module))
      .filter((module) => module.startsWith('workspace:packages/plugin-host/dist/'))
    expect(pluginHostModules.length).toBeGreaterThan(1)
    const pluginHostModule = candidate.causality.module
    expect(pluginHostModule).toMatch(/^workspace:packages\/plugin-host\/dist\//)
    expect(pluginHostModules).toContain(pluginHostModule)
    const pluginHostAttribution = baseline.moduleAttribution.find(
      (entry) => normalizeRootModule(entry.module) === pluginHostModule
    )
    const pluginHostCausal = causal.candidateAttribution.find(
      (entry) => entry.module === pluginHostModule
    )
    expect(candidate.causality).toEqual({
      cause: 'PluginHost V2 migration',
      owner: '@migaia/plugin-host',
      module: pluginHostModule,
      evidenceSchema: candidate.causalSchema,
      measuredDelta: {
        moduleCount: candidate.newTuple.moduleCount - candidate.oldTuple.moduleCount,
        rawBytes: candidate.newTuple.rawBytes - candidate.oldTuple.rawBytes,
        gzipBytes: candidate.newTuple.gzipBytes - candidate.oldTuple.gzipBytes,
        endpointStaticImportCount:
          (candidate.newTuple.endpointStaticImportCount ?? 0) -
          (candidate.oldTuple.endpointStaticImportCount ?? 0)
      },
      byteAttribution: {
        originalBytes: pluginHostAttribution?.originalBytes,
        renderedBytes: pluginHostAttribution?.renderedBytes
      },
      retainedBy: pluginHostCausal?.retainedBy,
      incomingEdges: pluginHostCausal?.incomingEdges
    })
    const incremental = candidate.incrementalCausality
    expect(incremental.cause).toBe('event-subscriber styled handle and invoke migration')
    expect(incremental.owner).toBe('@migaia/event-subscriber')
    expect(incremental.module).toMatch(/^workspace:packages\/event-subscriber\/dist\//)
    expect(incremental.measuredDelta).toEqual({
      moduleCount: incremental.toTuple.moduleCount - incremental.fromTuple.moduleCount,
      rawBytes: incremental.toTuple.rawBytes - incremental.fromTuple.rawBytes,
      gzipBytes: incremental.toTuple.gzipBytes - incremental.fromTuple.gzipBytes,
      endpointStaticImportCount:
        (incremental.toTuple.endpointStaticImportCount ?? 0) -
        (incremental.fromTuple.endpointStaticImportCount ?? 0)
    })
    expect(incremental.byteAttribution.after.originalBytes).toBeGreaterThan(0)
    expect(incremental.byteAttribution.after.renderedBytes).toBeGreaterThan(0)
    expect(incremental.retainedBy).toEqual(consumers)
    expect(incremental.moduleSetChanged).toBe(false)
    expect(incremental.endpointStaticImportCountChanged).toBe(false)
    expect(incremental.webRpcProductionSourceDelta).toBe(0)
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
      if (causalEntry?.incomingEdges.length === 0) {
        expect(causalEntry.provenance?.kind).toBe('generated-artifact')
        expect(causalEntry.provenance?.locator?.artifact).toBe(entry.module)
      } else {
        expect(causalEntry?.provenance?.kind).toBe('import-edge')
      }
      expect(entry.incomingEdges).toEqual(causalEntry?.incomingEdges)
    }
  })

  it('preserves installed approval custody and unique runtime owner allocation', async () => {
    const { default: rawCandidate } = await import(
      '../fixtures/tree-shaking/post-migration-candidate.json',
      { with: { type: 'json' } }
    )
    const candidate = rawCandidate as unknown as IPostMigrationCandidate
    const oldBaseline = JSON.parse(
      readFileSync(
        resolve(packageRoot, 'test/fixtures/tree-shaking/pre-migration-tree-shaking-baseline.json'),
        'utf8'
      )
    ) as ILiveReport
    const oldModules = new Set(oldBaseline.modules.map(normalizeRootModule))
    const liveModules = new Set(candidate.rootModules)
    const authorityFiles = [
      'pre-migration-tree-shaking-baseline.json',
      'tree-shaking-baseline.json',
      'baseline-authority.json',
      'baseline-authorization.json'
    ] as const

    for (const name of authorityFiles)
      expect(hashFile(resolve(packageRoot, 'test/fixtures/tree-shaking', name))).toMatch(
        /^[0-9a-f]{64}$/
      )
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
        readonly oldTuple: Omit<ITuple, 'endpointStaticImportCount'>
        readonly newTuple: Omit<ITuple, 'endpointStaticImportCount'>
      }
    }
    expect(authority.status).toBe('approved')
    expect(authorization.status).toBe('approved')
    expect(candidate.status).toBe('approved')
    expect(candidate.approval).toMatchObject({
      status: authorization.status,
      decisionId: authorization.approvalRecord.decisionId,
      keyId: authorization.approvalRecord.keyId,
      digest: authorization.approvalRecord.digest,
      oldTuple: authorization.approvalRecord.oldTuple,
      newTuple: authorization.approvalRecord.newTuple
    })
    expect(authorization.approvalRecord).toMatchObject({
      decisionId: authority.decisionId,
      keyId: authority.keyId,
      digest: authority.payloadDigest
    })
    expect(authorization.approvalRecord.signature).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(candidate.removedModules.map(({ module }) => module)).toEqual(
      [...oldModules].filter((module) => !liveModules.has(module)).sort()
    )
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
