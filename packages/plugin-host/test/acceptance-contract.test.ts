import { openComposition } from '../src/composition-entry.js'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { defineFeature, definePlugin, PluginHost } from '../src/index.js'
import { PluginHostErrorCode } from '../src/error-code.js'

const hostOptions = {
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
} as const

/** Concrete fixture host exposes canonical PluginHost behavior for acceptance probes. */
class AcceptanceHost extends PluginHost<Record<string, never>, unknown> {
  /** Supplies the empty domain core required by the abstract V2 host fixture. */
  protected createPluginDomainCore(): Record<string, never> {
    return {}
  }
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

describe('PHV3 acceptance contract', () => {
  it('PHV3-T01: accepts short and full functional definitions', async () => {
    const short = definePlugin('short', () => ({ install: () => ({ short: true }) }))
    const full = definePlugin({ name: 'full', install: () => ({ full: true }) })
    const host = new AcceptanceHost(hostOptions)
    const handles = await host.use(short, full)
    expect(handles.map((handle) => handle.extensions)).toEqual([{ short: true }, { full: true }])
    await host.dispose()
  })

  it('YS24: rejects a forged Feature batch before any descriptor factory runs', async () => {
    let descriptorCalls = 0
    const valid = definePlugin('ys24-valid', () => {
      descriptorCalls += 1
      return { install: () => ({}) }
    })
    const forged = {
      name: 'ys24-forged',
      features: { forged: {} },
      featureExpose: {},
      install: () => ({})
    }
    const host = new AcceptanceHost(hostOptions)
    expect(() => host.use(valid, forged as never)).toThrowError(
      expect.objectContaining({ code: PluginHostErrorCode.invalidOption })
    )
    expect(descriptorCalls).toBe(0)
    await host.dispose()
  })

  it('YS26: rejects equal install and expose keys without publishing the candidate', async () => {
    const host = new AcceptanceHost(hostOptions)
    // @ts-expect-error YS26 forbids every overlapping Host extension key.
    const collision = definePlugin('ys26-collision', () => ({
      install: () => ({ duplicate: 1 }),
      expose: () => ({ duplicate: 1 })
    }))
    await expect(host.use(collision)).rejects.toMatchObject({
      cause: { code: PluginHostErrorCode.extensionDuplicate }
    })
    expect(openComposition(host).getCurrentSnapshot().extensions).not.toHaveProperty('duplicate')
    await host.dispose()
  })

  it('YS26: rejects an awaitable descriptor factory result before it becomes an empty descriptor', async () => {
    const host = new AcceptanceHost(hostOptions)
    const descriptor = definePlugin(
      'ys26-thenable-descriptor',
      () => Promise.resolve({ install: () => ({ shouldNotMount: true }) }) as never
    )
    await expect(host.use(descriptor)).rejects.toMatchObject({
      code: PluginHostErrorCode.pluginInstallFailed
    })
    expect(openComposition(host).getCurrentSnapshot().extensions).not.toHaveProperty(
      'shouldNotMount'
    )
    await host.dispose()
  })

  it('YS26: contains every late descriptor-hook rejection when diagnostics throw', async () => {
    for (const hook of ['descriptor', 'featureExpose', 'expose'] as const) {
      const original = new Error(`late-${hook}`)
      const rejected = Promise.reject(original)
      let installCalls = 0
      let diagnosticCalls = 0
      const plugin =
        hook === 'descriptor'
          ? definePlugin(`ys26-${hook}`, () => rejected as never)
          : definePlugin(
              `ys26-${hook}`,
              () =>
                ({
                  install: () => {
                    installCalls += 1
                    return { retained: true }
                  },
                  ...(hook === 'featureExpose' ? { featureExpose: () => rejected as never } : {}),
                  ...(hook === 'expose' ? { expose: () => rejected as never } : {})
                }) as never
            )
      const host = new AcceptanceHost({
        ...hostOptions,
        diagnostic: () => {
          diagnosticCalls += 1
          throw new Error(`diagnostic-${hook}`)
        }
      })
      let observed: unknown
      try {
        await host.use(plugin as never)
      } catch (error) {
        observed = error
      }
      await Promise.resolve()
      await Promise.resolve()
      expect(observed).toMatchObject({ code: PluginHostErrorCode.pluginInstallFailed })
      const causes: unknown[] = []
      let current: unknown = observed
      for (let index = 0; index < 4 && current instanceof Error; index += 1) {
        current = current.cause
        causes.push(current)
      }
      expect(causes).toContain(original)
      expect(diagnosticCalls).toBe(1)
      expect(installCalls).toBe(hook === 'expose' ? 1 : 0)
      expect(openComposition(host).getCurrentSnapshot().extensions).not.toHaveProperty('retained')
      await host.dispose()
    }
  })

  it('YS27: injects only featureExpose and declared dependencies into Feature factories', async () => {
    /**
     * Captures the exact Feature core surface without masking assertion failures in Host lifecycle
     * wrapping.
     */
    let observedCoreKeys: readonly PropertyKey[] = []
    /** Records whether forbidden Plugin-only capabilities leaked into the Feature core. */
    let observedForbiddenCapabilities = false
    const feature = defineFeature<
      { readonly read: () => number },
      Record<never, never>,
      { readonly read: () => number }
    >((core) => {
      observedCoreKeys = Reflect.ownKeys(core)
      observedForbiddenCapabilities = 'getShared' in core || 'onDispose' in core || 'own' in core
      return { read: () => core.featureExpose.read() }
    })
    const provider = definePlugin({
      name: 'ys27-provider',
      features: { feature },
      featureExpose: { read: () => 7 },
      install: (core) => ({ read: core.features.feature.read() })
    })
    const dependentFeature = defineFeature(
      (_core, dependencies) => ({
        observed: dependencies.provider.read() === 7
      }),
      { provider: provider.getFeature('feature') }
    )
    const consumer = definePlugin({
      name: 'ys27-consumer',
      features: { dependentFeature },
      install: (core) => ({ observed: core.features.dependentFeature.observed })
    })
    const host = new AcceptanceHost(hostOptions)
    const handles = await host.use(provider, consumer)
    expect(handles[0].extensions.read).toBe(7)
    expect(handles[1].extensions.observed).toBe(true)
    expect(observedCoreKeys).toEqual(['featureExpose'])
    expect(observedForbiddenCapabilities).toBe(false)
    await host.dispose()
  })

  it('PHV3-T03: snapshots hostile definition descriptors', async () => {
    const counts = { name: 0, install: 0 }
    const source = Object.defineProperties(
      {},
      {
        name: { enumerable: true, get: () => (++counts.name, 'hostile') },
        install: { enumerable: true, get: () => (++counts.install, () => ({})) }
      }
    )
    const host = new AcceptanceHost(hostOptions)
    await host.use(source as never)
    expect(counts).toEqual({ name: 1, install: 1 })
    await host.dispose()
  })

  it('PHV3-T04: creates definitions without lifecycle calls', () => {
    const calls: string[] = []
    const plugin = definePlugin({
      name: 'pure',
      install: () => {
        calls.push('install')
        return {}
      },
      dispose: () => {
        calls.push('dispose')
      }
    })
    expect(plugin.name).toBe('pure')
    expect(calls).toEqual([])
  })

  it('PHV3-T05: uses structural fallback for clones', async () => {
    const trusted = definePlugin({ name: 'trusted', install: () => ({ trusted: true }) })
    const clone = { ...trusted }
    const host = new AcceptanceHost(hostOptions)
    const [handle] = await host.use(clone as never)
    expect((handle.extensions as Record<string, unknown>).trusted).toBe(true)
    await host.dispose()
  })

  it('PHV3-T05F: structural fallback initializes native Feature roots', async () => {
    let factoryCalls = 0
    const feature = defineFeature<
      { readonly read: () => number },
      Record<never, never>,
      { readonly read: () => number }
    >((core) => {
      factoryCalls += 1
      return { read: core.featureExpose.read }
    })
    const raw = {
      name: 'structural-feature',
      features: { feature },
      featureExpose: { read: () => 42 },
      install: (core: {
        readonly features: { readonly feature: { readonly read: () => number } }
      }) => {
        return { value: core.features.feature.read() }
      }
    }
    const host = new AcceptanceHost(hostOptions)
    const [handle] = await host.use(raw)
    expect((handle.extensions as { readonly value: number }).value).toBe(42)
    expect(factoryCalls).toBe(1)
    await host.dispose()
  })

  it('PHV3-T06: preserves mixed admission order and duplicate atomicity', async () => {
    const first = definePlugin('first', () => ({ install: () => ({ first: true }) }))
    const host = new AcceptanceHost(hostOptions)
    const handles = await host.use(first, {
      name: 'second',
      install: () => ({ second: true })
    } as never)
    expect(handles.flatMap((handle) => Object.keys(handle.extensions))).toEqual(['first', 'second'])
    await expect(
      host.use({ name: 'first', install: () => ({ replacement: true }) } as never)
    ).rejects.toMatchObject({
      code: PluginHostErrorCode.pluginDuplicate
    })
    expect(openComposition(host).getCurrentSnapshot().extensions.second).toBe(true)
    await host.dispose()
  })

  it('PHV3-T07: keeps trusted and generic lifecycle behavior equivalent', async () => {
    const events: string[] = []
    const trusted = definePlugin({
      name: 'trusted',
      install: () => {
        events.push('install')
        return {}
      },
      dispose: () => {
        events.push('dispose')
      }
    })
    const generic = {
      name: 'generic',
      install: () => {
        events.push('install')
        return {}
      },
      dispose: () => {
        events.push('dispose')
      }
    }
    const host = new AcceptanceHost(hostOptions)
    await host.use(trusted)
    await host.use(generic as never)
    await host.dispose()
    expect(events).toEqual(['install', 'install', 'dispose', 'dispose'])
  })

  it('PHV3-T08: has one canonical Host runtime owner', () => {
    const source = readFileSync(new URL('../src/host-runtime.ts', import.meta.url), 'utf8')
    expect((source.match(/export class PluginHost/g) ?? []).length).toBe(1)
    expect(readFileSync(new URL('../src/define-plugin.ts', import.meta.url), 'utf8')).toContain(
      'const definitions = new WeakMap'
    )
  })

  it('PHV3-T09: records 15-sample trusted admission speed evidence', async () => {
    const genericSamples: number[] = []
    const coldTrustedSamples: number[] = []
    const warmTrustedSamples: number[] = []
    const warmPlugin = definePlugin('trusted-warm', () => ({ install: () => ({}) }))
    for (let index = 0; index < 15; index += 1) {
      const genericHost = new AcceptanceHost(hostOptions)
      let started = process.hrtime.bigint()
      const generic = {
        name: `generic-${index}`,
        config: { index },
        install: () => ({}),
        update: () => {},
        dispose: () => {},
        marker: `generic-${index}`
      }
      openComposition(genericHost).createPluginAdmission(generic)
      genericSamples.push(Number(process.hrtime.bigint() - started))
      await genericHost.dispose()
      const coldTrustedHost = new AcceptanceHost(hostOptions)
      started = process.hrtime.bigint()
      const coldPlugin = definePlugin(`trusted-cold-${index}`, () => ({}))
      openComposition(coldTrustedHost).createPluginAdmission(coldPlugin)
      coldTrustedSamples.push(Number(process.hrtime.bigint() - started))
      await coldTrustedHost.dispose()
      const warmTrustedHost = new AcceptanceHost(hostOptions)
      started = process.hrtime.bigint()
      openComposition(warmTrustedHost).createPluginAdmission(warmPlugin)
      warmTrustedSamples.push(Number(process.hrtime.bigint() - started))
      await warmTrustedHost.dispose()
    }
    const medians = {
      generic: median(genericSamples),
      coldTrusted: median(coldTrustedSamples),
      warmTrusted: median(warmTrustedSamples)
    }
    console.info(
      '[PHV3-T09]',
      JSON.stringify({ medians, genericSamples, coldTrustedSamples, warmTrustedSamples })
    )
    expect(coldTrustedSamples).toHaveLength(15)
  })

  it('PHV3-T10: scales trusted admission over 1k to 8k definitions', async () => {
    const medians: number[] = []
    const rawSamples: number[][] = []
    for (const size of [1000, 2000, 4000, 8000]) {
      const samples: number[] = []
      for (let repeat = 0; repeat < 15; repeat += 1) {
        const plugins = Array.from({ length: size }, (_, index) =>
          definePlugin(`scale-${size}-${repeat}-${index}`, () => ({}))
        )
        const host = new AcceptanceHost(hostOptions)
        for (const plugin of plugins) openComposition(host).createPluginAdmission(plugin)
        await host.dispose()
        const batchSamples: number[] = []
        for (let batch = 0; batch < 5; batch += 1) {
          const measuredHost = new AcceptanceHost(hostOptions)
          const started = process.hrtime.bigint()
          for (const plugin of plugins) openComposition(measuredHost).createPluginAdmission(plugin)
          batchSamples.push(Number(process.hrtime.bigint() - started))
          await measuredHost.dispose()
        }
        samples.push(median(batchSamples))
      }
      medians.push(median(samples))
      rawSamples.push(samples)
    }
    console.info('[PHV3-T10]', JSON.stringify({ medians, rawSamples }))
    // Compare the full 1k -> 8k interval so sub-millisecond timer and scheduler
    // noise at one intermediate size cannot turn a linear implementation red.
    // The 10x ceiling still bounds 8x input growth to 25% overhead.
    expect(medians.at(-1)! / medians[0]).toBeLessThanOrEqual(10)
  })

  it('PHV3-T11: publishes root, declarations and packed dist entries', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ) as {
      exports: Record<string, unknown>
    }
    // 导出拓扑收敛为根入口与组合出口两项：`./defined` 与 `./structural` 已并入根入口。
    expect(Object.keys(packageJson.exports).sort()).toEqual(['.', './composition'])
    expect(readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8')).toContain(
      'definePlugin'
    )
  })

  it('PHV3-T12: leaves Tray as a structural consumer', () => {
    const source = readFileSync(
      new URL('../../tray/src/host/create-host.ts', import.meta.url),
      'utf8'
    )
    expect(source).toContain('createPluginAdmission')
    expect(source).not.toContain('definePlugin(')
  })

  it('PHV3-T13: preserves source receiver identity', async () => {
    let receiver: unknown
    const source = {
      name: 'receiver',
      install() {
        // oxlint-disable-next-line typescript/no-this-alias -- contract asserts source receiver identity.
        receiver = this
        return {}
      }
    }
    const host = new AcceptanceHost(hostOptions)
    await host.use(definePlugin(source))
    expect(receiver).toBe(source)
    await host.dispose()
  })

  it('PHV3-T15: converges entry imports on the V2 runtime', () => {
    // 两个子路径删除后，根入口是唯一的会合点：函数式与结构式两种形态都从这里导出。
    const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    expect(index).toContain("'./host-runtime.js'")
    expect(index).toContain("'./define-host.js'")
    expect(index).toContain("'./define-plugin.js'")
  })

  it('PHV3-T23: documents explicit cancellation ownership', () => {
    const docs = readFileSync(new URL('../USEGUIDE.md', import.meta.url), 'utf8')
    expect(docs).toContain('signal')
    expect(docs).toContain('dispose')
  })

  it('PHV3-T24: retains immutable enumerable metadata', () => {
    const plugin = definePlugin({
      name: 'metadata',
      install: () => ({}),
      marker: 'literal' as const
    })
    expect(plugin.marker).toBe('literal')
    expect(Object.isFrozen(plugin)).toBe(true)
  })

  it('PHV3-T25: trusted storage stores definitions, not Host state', () => {
    const source = readFileSync(new URL('../src/define-plugin.ts', import.meta.url), 'utf8')
    expect(source).toContain('WeakMap<object, IStoredDefinition>')
    expect(source).not.toContain("from './host-runtime.js'")
    expect(source).not.toContain('HostRuntime')
  })

  it('PHV3-T27: carries TValue through pipeline declarations', () => {
    // 函数式 Host 的 TValue 由句柄类型承载。
    const source = readFileSync(new URL('../src/typing.ts', import.meta.url), 'utf8')
    expect(source).toContain('IAsyncGeneratorPipelineStage<TValue>')
    const handle = readFileSync(new URL('../src/define-host.ts', import.meta.url), 'utf8')
    expect(handle).toContain('IHostHandle<TDomainCore, TValue')
  })
})
