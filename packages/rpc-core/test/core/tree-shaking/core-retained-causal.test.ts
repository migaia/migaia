import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { IRetainedConsumer } from '../fixtures/tree-shaking/retained-inventory.js'

type IConsumer = IRetainedConsumer
type ICausalEdge = {
  readonly consumer: IConsumer
  readonly from: string
  readonly to: string
  /** Actual resolved modules omitted by emission, when this is an import/re-export path. */
  readonly via?: readonly string[]
}
type IConsumerClosure = {
  readonly roots: readonly string[]
  readonly moduleCount: number
  readonly modules: readonly string[]
  readonly edges: readonly ICausalEdge[]
}
type ICandidateAttribution = {
  readonly module: string
  readonly retainedBy: readonly IConsumer[]
  readonly incomingEdges: readonly ICausalEdge[]
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
type ICausalReport = {
  readonly schema: string
  readonly rootModules: Readonly<Record<IConsumer, readonly string[]>>
  readonly oldRootModules: readonly string[]
  readonly liveRootModules: readonly string[]
  readonly consumers: Readonly<Record<IConsumer, IConsumerClosure>>
  readonly retainedCounts: Readonly<Record<IConsumer, number>>
  readonly addedModules: readonly string[]
  readonly removedModules: readonly string[]
  readonly candidateAttribution: readonly ICandidateAttribution[]
}
type IRetainedProbe = Readonly<
  Record<IConsumer, Readonly<{ moduleCount: number; modules: readonly string[] }>>
>

const consumers: readonly IConsumer[] = ['core', 'client', 'provider', 'full', 'custom']

/** Runs the five-consumer causal evidence probe from the package root. */
function readCausalReport(): ICausalReport {
  const script = resolve(import.meta.dirname, 'core-retained-causal.mjs')
  return JSON.parse(
    execFileSync(process.execPath, [script], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  ) as ICausalReport
}

/** Runs the independent emitted-consumer probe rather than reusing historical inventory. */
function readRetainedProbe(): IRetainedProbe {
  const script = resolve(import.meta.dirname, '..', 'tree-shaking-retained.mjs')
  return JSON.parse(
    execFileSync(process.execPath, [script], { encoding: 'utf8' })
  ) as IRetainedProbe
}

/** Runs canonical root inventory output independently of the causal harness. */
function readLiveRootModules(): readonly string[] {
  const script = resolve(import.meta.dirname, '..', 'tree-shaking-baseline.mjs')
  const workspaceRoot = resolve(import.meta.dirname, '../../../../..')
  const report = JSON.parse(
    execFileSync(process.execPath, [script], { cwd: workspaceRoot, encoding: 'utf8' })
  ) as { readonly modules: readonly string[] }
  return report.modules.map(normalizeRootModule).sort()
}

/** Converts canonical build paths to the frozen root-module identity. */
function normalizeRootModule(module: string): string {
  const relative = module.includes('/packages/')
    ? module.slice(module.indexOf('/packages/') + 1)
    : module
  return relative.startsWith('packages/rpc/') || relative.startsWith('packages/rpc-core/')
    ? relative
    : relative.startsWith('packages/')
      ? `workspace:${relative}`
      : relative
}

/** Reads the independent pre-migration root module characterization. */
function readOldRootModules(): readonly string[] {
  const fixture = resolve(
    import.meta.dirname,
    '../fixtures/tree-shaking/pre-migration-tree-shaking-baseline.json'
  )
  const report = JSON.parse(readFileSync(fixture, 'utf8')) as {
    readonly modules: readonly string[]
  }
  return report.modules.map(normalizeRootModule).sort()
}

/** Computes old/live module differences independently of causal candidate rows. */
function expectedModuleDiff(): {
  readonly added: readonly string[]
  readonly removed: readonly string[]
} {
  const oldModules = new Set(readOldRootModules())
  const liveModules = new Set(readLiveRootModules())
  return {
    added: [...liveModules].filter((module) => !oldModules.has(module)).sort(),
    removed: [...oldModules].filter((module) => !liveModules.has(module)).sort()
  }
}

describe('WRC-C-B11f five-consumer causal graph', () => {
  it('derives exact added/removed sets and non-empty causal attribution', () => {
    const report = readCausalReport()
    const retainedProbe = readRetainedProbe()
    const expected = expectedModuleDiff()
    expect(report.schema).toBe('WRC-C-B11f-five-consumer-causal-v2')
    expect(Object.keys(report.consumers)).toEqual(consumers)
    expect(report.addedModules).toEqual(expected.added)
    expect(report.removedModules).toEqual(expected.removed)
    expect(report.addedModules).toHaveLength(report.candidateAttribution.length)
    expect(report.candidateAttribution.map(({ module }) => module)).toEqual(expected.added)

    for (const consumer of consumers) {
      const closure = report.consumers[consumer]
      expect(closure.modules).toEqual(retainedProbe[consumer].modules)
      expect(new Set(closure.modules).size).toBe(closure.modules.length)
      expect(closure.moduleCount).toBe(retainedProbe[consumer].moduleCount)
      expect(report.retainedCounts[consumer]).toBe(closure.moduleCount)
      expect(closure.roots.every((root) => closure.modules.includes(root))).toBe(true)
      expect(closure.modules).not.toContain('dist/core/internal/chunk.js')
      expect(closure.modules).not.toContain('dist/core/internal/canonical-envelope.js')
    }
    for (const consumer of ['custom', 'full'] as const)
      expect(report.consumers[consumer].edges).not.toContainEqual({
        consumer,
        from: 'dist/core/internal/discovery-attachment.js',
        to: 'dist/core/internal/plugin-shared-keys.js'
      })

    for (const candidate of report.candidateAttribution) {
      const expectedRetainedBy = consumers.filter((consumer) =>
        report.consumers[consumer].modules.includes(
          candidate.module.startsWith('packages/rpc-core/')
            ? candidate.module.slice('packages/rpc-core/'.length)
            : candidate.module
        )
      )
      expect(candidate.retainedBy).toEqual(expectedRetainedBy)
      if (candidate.incomingEdges.length === 0) {
        expect(candidate.provenance?.kind).toBe('generated-artifact')
        expect(candidate.provenance?.locator?.artifact).toBe(candidate.module)
        expect(candidate.provenance?.locator?.artifactSha256).toMatch(/^[0-9a-f]{64}$/)
        expect(candidate.provenance?.locator?.generator.length).toBeGreaterThan(0)
        if (candidate.module.startsWith('packages/rpc-core/dist/')) {
          expect(candidate.provenance?.locator?.source?.length).toBeGreaterThan(0)
          expect(candidate.provenance?.locator?.sourceSha256).toMatch(/^[0-9a-f]{64}$/)
        }
      } else {
        expect(candidate.provenance?.kind).toBe('import-edge')
      }
      expect(new Set(candidate.incomingEdges.map((edge) => JSON.stringify(edge))).size).toBe(
        candidate.incomingEdges.length
      )
      for (const edge of candidate.incomingEdges) {
        expect(edge.to).toBe(
          candidate.module.startsWith('packages/rpc-core/')
            ? candidate.module.slice('packages/rpc-core/'.length)
            : candidate.module
        )
        expect(report.consumers[edge.consumer].edges).toContainEqual(edge)
      }
    }
  })

  it('keeps custom roots structurally aligned and proves transport activation causality', () => {
    const report = readCausalReport()
    expect(report.rootModules.custom).toEqual([
      'dist/core/composed.js',
      'dist/core/features/outbound.js',
      'dist/core/features/provider.js',
      'dist/core/features/discovery.js',
      'dist/core/features/control.js',
      'dist/core/features/canonical-chunk.js'
    ])
    expect(report.consumers.core.modules).not.toContain(
      'dist/core/internal/transport-activation.js'
    )
    expect(report.consumers.core.modules).not.toContain('dist/core/internal/outbound-sender.js')
    for (const consumer of consumers) {
      expect(report.consumers[consumer].modules).not.toContain('dist/core/internal/pipeline.js')
    }
    const senderCandidate = report.candidateAttribution.find(
      ({ module }) => module === 'packages/rpc-core/dist/core/internal/outbound-sender.js'
    )
    expect(senderCandidate?.retainedBy).toEqual(['client', 'provider', 'full', 'custom'])
    for (const consumer of ['client', 'provider', 'full', 'custom'] as const)
      expect(senderCandidate?.incomingEdges).toContainEqual({
        consumer,
        from: 'dist/core/internal/outbound-attachment.js',
        to: 'dist/core/internal/outbound-sender.js'
      })
    const transportCandidate = report.candidateAttribution.find(
      ({ module }) => module === 'packages/rpc-core/dist/core/internal/transport-activation.js'
    )
    expect(transportCandidate?.retainedBy).toEqual(['client', 'provider', 'full', 'custom'])
    for (const consumer of ['client', 'provider', 'full', 'custom'] as const)
      expect(transportCandidate?.incomingEdges).toContainEqual({
        consumer,
        from: 'dist/core/internal/outbound-attachment.js',
        to: 'dist/core/internal/transport-activation.js'
      })
    expect(report.consumers.core.edges).toEqual(
      expect.arrayContaining([
        {
          consumer: 'core',
          from: 'dist/core/composed.js',
          to: 'dist/core/internal/plugin-inventory.js'
        },
        {
          consumer: 'core',
          from: 'dist/core/composed.js',
          to: 'dist/core/internal/web-rpc-plugin-host.js'
        }
      ])
    )
  })
})
