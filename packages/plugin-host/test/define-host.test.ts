import { describe, expect, it } from 'vitest'
import { defineHost, definePlugin, type IHostDomainCoreRequest } from '../src/index.js'
import { isManagedHost, openComposition } from '../src/composition-entry.js'
import { readHostIdentity } from '../src/host-identity.js'

const hostOptions = {
  execution: { mutationTimeoutMs: false as const, pipelineDrainTimeoutMs: false as const }
}

/** A plugin that installs nothing, so a test observes admission rather than plugin behaviour. */
const plugin = (name: string) => definePlugin({ name, install: () => ({}) })

describe('defineHost', () => {
  it('rejects an empty identity label and admits only identities issued for an exact Host', async () => {
    expect(() => defineHost({ host: { ...hostOptions, identity: { name: '' } } })).toThrow(
      expect.objectContaining({ source: '@migaia/plugin-host', code: 'INVALID_OPTION' })
    )
    const host = defineHost({ host: hostOptions })
    try {
      expect(readHostIdentity(host)).toBe(host.identity)
      for (const value of [null, undefined, 'DEFAULT', 0, () => undefined, {}])
        expect(readHostIdentity(value)).toBeUndefined()
      expect(readHostIdentity({ ...host })).toBeUndefined()
    } finally {
      await host.dispose()
    }
  })

  it('keeps dry-run removal observational and preserves cleanup causes', async () => {
    /** A dry-run reaches the same dependency owner without releasing the live registration. */
    const host = defineHost({ host: hostOptions })
    const [registered] = await host.use(plugin('planned'))
    const revision = host.revision
    const plan = await host.unUse('planned', { dryRun: true })
    expect(plan.order).toEqual(['planned'])
    expect(host.revision).toBe(revision)
    expect(registered.name).toBe('planned')
    expect(await host.unUse('planned')).toMatchObject({ ok: true })
    await host.dispose()

    /** Functional disposal reports the same original resource failure without rerunning cleanup. */
    const original = new RangeError('functional-host cleanup failure')
    const failing = defineHost({ host: hostOptions })
    await failing.use(
      definePlugin({
        name: 'cleanup',
        install: (core) => {
          core.onDispose(() => {
            throw original
          })
          return {}
        }
      })
    )
    const closing = failing.dispose()
    expect(failing.dispose()).toBe(closing)
    const result = await closing
    expect(result.logicalTerminal).toBe(true)
    expect(result.cleanupErrors).toHaveLength(1)
    expect((result.cleanupErrors[0] as Error).cause).toBe(original)
  })

  it('keeps owner pipeline dispatch, synchronous registration and snapshots on the original runtime', async () => {
    /** The functional owner uses the same registration transaction and revision as the class. */
    const sync = defineHost<Record<string, never>, number>({
      host: { ...hostOptions, pipeline: { mode: 'sync' } }
    })
    try {
      expect(sync.revision).toBe(0)
      expect(sync.pipelineMode).toBe('sync')
      expect(sync.config).toBeDefined()
      const [registered] = sync.useSync(plugin('sync'))
      expect(registered.name).toBe('sync')
      expect(sync.revision).toBeGreaterThan(0)
      expect(sync.usePipeline((value, next) => next(value + 1))).toBe(sync)
      let delivered = 0
      await sync.runPipeline(41, (value) => {
        delivered = value
      })
      expect(delivered).toBe(42)
    } finally {
      await sync.dispose()
    }
    /** All supported modes retain their original completion and same handle chaining. */
    for (const mode of ['async', 'generator', 'async-generator'] as const) {
      const host = defineHost<Record<string, never>, number>({
        host: { ...hostOptions, pipeline: { mode } }
      })
      try {
        if (mode === 'async')
          expect(host.useAsyncPipeline(async (value, next) => next(value + 1))).toBe(host)
        else if (mode === 'generator')
          expect(
            host.useGeneratorPipeline(function* (value) {
              return value + 1
            })
          ).toBe(host)
        else
          expect(
            host.useAsyncGeneratorPipeline(async function* (value) {
              return value + 1
            })
          ).toBe(host)
        let delivered = 0
        await host.runPipeline(41, (value) => {
          delivered = value
        })
        expect(delivered).toBe(42)
      } finally {
        await host.dispose()
      }
    }
  })

  it('domain core contract: one request per registration, indexed within its batch', async () => {
    const requests: IHostDomainCoreRequest[] = []
    const host = defineHost({
      host: hostOptions,
      domainCore: (request) => {
        requests.push(request)
        return {}
      }
    })
    await host.use(plugin('a'), plugin('b'), plugin('c'))
    expect(requests.map((request) => request.pluginName)).toEqual(['a', 'b', 'c'])
    expect(requests.map((request) => request.batchIndex)).toEqual([0, 1, 2])
    // One batch, one token: the index is only meaningful relative to the batch it counts within.
    expect(new Set(requests.map((request) => request.batch)).size).toBe(1)
    const firstBatch = requests[0]!.batch
    await host.use(plugin('d'))
    expect(requests).toHaveLength(4)
    expect(requests[3]!.pluginName).toBe('d')
    // A second call is a second batch, so its index restarts and its token differs.
    expect(requests[3]!.batchIndex).toBe(0)
    expect(requests[3]!.batch).not.toBe(firstBatch)
    await host.dispose()
  })

  it('dispose memoized: the chain runs exactly once however often it is called', async () => {
    let entered = 0
    const host = defineHost({
      host: hostOptions,
      dispose: async (next) => {
        entered += 1
        return next()
      }
    })
    const first = host.dispose()
    const second = host.dispose()
    // Same reference, not merely an equal result: a second chain would dispose an already-disposed
    // runtime and the middleware would observe a host it does not own any more.
    expect(second).toBe(first)
    await first
    await host.dispose()
    expect(entered).toBe(1)
  })

  it('is a managed host on the same terms as a class instance', async () => {
    const host = defineHost({ host: hostOptions })
    expect(isManagedHost(host)).toBe(true)
    const composition = openComposition(host)
    expect(typeof composition.createDataOrderSlot).toBe('function')
    expect(typeof composition.revision).toBe('number')
    await host.dispose()
  })

  it('registers an explicit receiver as the same managed host', async () => {
    const receiver = {}
    const host = defineHost({ host: hostOptions, receiver })
    expect(isManagedHost(receiver)).toBe(true)
    expect(openComposition(receiver).revision).toBe(openComposition(host).revision)
    await host.dispose()
  })
})
