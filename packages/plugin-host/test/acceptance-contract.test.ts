import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { defineFeature, definePlugin, PluginHost, setupHost } from '../src/index.js'
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
    const view = await host.use(short, full)
    expect(view.extensions).toMatchObject({ short: true, full: true })
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
    /** Detects whether collision validation runs before the Plugin-only shared hook. */
    let sharedCalls = 0
    // @ts-expect-error YS26 forbids every overlapping Host extension key.
    const collision = definePlugin('ys26-collision', () => ({
      install: () => ({ duplicate: 1 }),
      expose: () => ({ duplicate: 1 }),
      shared: () => {
        sharedCalls += 1
        return { shouldNotPublish: true }
      }
    }))
    await expect(host.use(collision)).rejects.toMatchObject({
      cause: { code: PluginHostErrorCode.extensionDuplicate }
    })
    expect(host.getCurrentView().extensions).not.toHaveProperty('duplicate')
    expect(sharedCalls).toBe(0)
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
    expect(host.getCurrentView().extensions).not.toHaveProperty('shouldNotMount')
    await host.dispose()
  })

  it('YS26: contains every late descriptor-hook rejection when diagnostics throw', async () => {
    for (const hook of ['descriptor', 'featureExpose', 'expose', 'shared'] as const) {
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
                  ...(hook === 'expose' ? { expose: () => rejected as never } : {}),
                  ...(hook === 'shared' ? { shared: () => rejected as never } : {})
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
      expect(installCalls).toBe(hook === 'expose' || hook === 'shared' ? 1 : 0)
      expect(host.getCurrentView().extensions).not.toHaveProperty('retained')
      await host.dispose()
    }
  })

  it('YS27: injects only featureExpose into Feature factories and preserves Plugin shared for a later Plugin', async () => {
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
      shared: () => ({ pluginOnly: true }),
      install: (core) => ({ read: core.features.feature.read() })
    })
    const consumer = definePlugin({
      name: 'ys27-consumer',
      install: (core) => ({ observed: core.getShared('pluginOnly') === true })
    })
    const host = new AcceptanceHost(hostOptions)
    await expect(host.use(provider, consumer)).resolves.toMatchObject({
      extensions: { read: 7, observed: true }
    })
    expect(observedCoreKeys).toEqual(['featureExpose'])
    expect(observedForbiddenCapabilities).toBe(false)
    await host.dispose()
  })

  it('PHV3-T02: preserves the setup type-contract fixture', () => {
    const source = readFileSync(new URL('./type-contract.test-d.ts', import.meta.url), 'utf8')
    expect(source).toContain('setupHost')
    expect(source).toContain('useAsyncGeneratorPipeline')
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
      shared: () => {
        calls.push('shared')
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
    const view = await host.use(clone as never)
    expect((view.extensions as Record<string, unknown>).trusted).toBe(true)
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
    const view = await host.use(raw)
    expect((view.extensions as { readonly value: number }).value).toBe(42)
    expect(factoryCalls).toBe(1)
    await host.dispose()
  })

  it('PHV3-T06: preserves mixed admission order and duplicate atomicity', async () => {
    const first = definePlugin('first', () => ({ install: () => ({ first: true }) }))
    const host = new AcceptanceHost(hostOptions)
    const view = await host.use(first, {
      name: 'second',
      install: () => ({ second: true })
    } as never)
    expect(Object.keys(view.extensions)).toEqual(['first', 'second'])
    await expect(
      host.use({ name: 'first', install: () => ({ replacement: true }) } as never)
    ).rejects.toMatchObject({
      code: PluginHostErrorCode.pluginDuplicate
    })
    expect(host.getCurrentView().extensions.second).toBe(true)
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
    expect((source.match(/export abstract class PluginHost/g) ?? []).length).toBe(1)
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
        shared: () => ({}),
        dispose: () => {},
        marker: `generic-${index}`
      }
      genericHost.createPluginAdmission(generic)
      genericSamples.push(Number(process.hrtime.bigint() - started))
      await genericHost.dispose()
      const coldTrustedHost = new AcceptanceHost(hostOptions)
      started = process.hrtime.bigint()
      const coldPlugin = definePlugin(`trusted-cold-${index}`, () => ({}))
      coldTrustedHost.createPluginAdmission(coldPlugin)
      coldTrustedSamples.push(Number(process.hrtime.bigint() - started))
      await coldTrustedHost.dispose()
      const warmTrustedHost = new AcceptanceHost(hostOptions)
      started = process.hrtime.bigint()
      warmTrustedHost.createPluginAdmission(warmPlugin)
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
    expect(medians.coldTrusted).toBeLessThanOrEqual(medians.generic * 1.1)
    expect(medians.warmTrusted).toBeLessThanOrEqual(medians.generic * 0.8)
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
        for (const plugin of plugins) host.createPluginAdmission(plugin)
        await host.dispose()
        const batchSamples: number[] = []
        for (let batch = 0; batch < 5; batch += 1) {
          const measuredHost = new AcceptanceHost(hostOptions)
          const started = process.hrtime.bigint()
          for (const plugin of plugins) measuredHost.createPluginAdmission(plugin)
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
    expect(packageJson.exports).toHaveProperty('.')
    expect(packageJson.exports).toHaveProperty('./defined')
    expect(packageJson.exports).toHaveProperty('./structural')
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

  it('PHV3-T14: emits sourcemaps for the functional entry', () => {
    expect(readdirSync(new URL('../dist/', import.meta.url))).toContain('setup-host.js.map')
    expect(readFileSync(new URL('../dist/defined.js', import.meta.url), 'utf8')).not.toContain(
      "from './structural.js'"
    )
  })

  it('PHV3-T15: converges entry imports on the V2 runtime', () => {
    const defined = readFileSync(new URL('../src/defined.ts', import.meta.url), 'utf8')
    const structural = readFileSync(new URL('../src/structural.ts', import.meta.url), 'utf8')
    expect(defined).toContain("'./setup-host.js'")
    expect(structural).toContain("'./host-runtime.js'")
  })

  it('PHV3-T16: exposes one ordered setup plugins tuple', () => {
    const source = readFileSync(new URL('../src/typing.ts', import.meta.url), 'utf8')
    expect(source).toContain('readonly plugins?: TPlugins')
    expect(source).not.toContain('asyncPlugins')
  })

  it('PHV3-T17: publishes only a frozen active setup view', async () => {
    const app = await setupHost({ host: hostOptions, setupTimeoutMs: false, core: () => ({}) })
    expect(Object.isFrozen(app)).toBe(true)
    expect(app.host).toBeDefined()
    await app.dispose()
  })

  it('PHV3-T18: snapshots setup getters before Core invocation', async () => {
    const counts = { host: 0, timeout: 0, core: 0, plugins: 0, signal: 0 }
    const plugin = definePlugin('single-read', () => ({ install: () => ({ ready: true }) }))
    const options = Object.defineProperties(
      {},
      {
        host: {
          enumerable: true,
          get: () => {
            counts.host += 1
            return hostOptions
          }
        },
        setupTimeoutMs: {
          enumerable: true,
          get: () => {
            counts.timeout += 1
            return false
          }
        },
        core: {
          enumerable: true,
          get: () => {
            counts.core += 1
            return () => ({})
          }
        },
        plugins: {
          enumerable: true,
          get: () => {
            counts.plugins += 1
            return [plugin]
          }
        },
        signal: {
          enumerable: true,
          get: () => {
            counts.signal += 1
            return undefined
          }
        }
      }
    ) as never
    const app = await setupHost(options)
    expect(counts).toEqual({ host: 1, timeout: 1, core: 1, plugins: 1, signal: 1 })
    await app.dispose()
  })

  it('PHV3-T19: bounds setup timeout and rejects with its code', async () => {
    await expect(
      setupHost({ host: hostOptions, setupTimeoutMs: 0, core: () => new Promise(() => {}) })
    ).rejects.toMatchObject({
      code: PluginHostErrorCode.hostSetupTimeout
    })
  })

  it('PHV3-T20: disposes plugins before Core', async () => {
    const events: string[] = []
    const plugin = definePlugin({
      name: 'ordered',
      install: () => ({}),
      dispose: () => {
        events.push('plugin')
      }
    })
    const app = await setupHost({
      host: hostOptions,
      setupTimeoutMs: false,
      core: (context) => {
        context.onDispose(() => {
          events.push('core')
        })
        return {}
      },
      plugins: [plugin]
    })
    await app.dispose()
    expect(events).toEqual(['plugin', 'core'])
  })

  it('PHV3-T21: preserves native setup errors and codes', async () => {
    const failure = new TypeError('invalid core')
    await expect(
      setupHost({
        host: hostOptions,
        setupTimeoutMs: false,
        core: () => {
          throw failure
        }
      })
    ).rejects.toMatchObject({
      code: PluginHostErrorCode.hostCoreSetupFailed,
      cause: failure
    })
  })

  it('PHV3-T22: supports native async disposal', async () => {
    const app = await setupHost({ host: hostOptions, setupTimeoutMs: false, core: () => ({}) })
    expect(typeof app[Symbol.asyncDispose]).toBe('function')
    await app[Symbol.asyncDispose]()
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

  it('PHV3-T26: structural entry excludes functional factory', async () => {
    const structural = await import('../src/structural.js')
    expect(structural).not.toHaveProperty('definePlugin')
    expect(structural).not.toHaveProperty('setupHost')
  })

  it('PHV3-T27: carries TValue through setup pipeline declarations', () => {
    const source = readFileSync(new URL('../src/typing.ts', import.meta.url), 'utf8')
    expect(source).toContain('ISetupPluginHost<TCore, TValue>')
    expect(source).toContain('IAsyncGeneratorPipelineStage<TValue>')
  })

  it('PHV3-T28: keeps functional setup structurally typed', async () => {
    const app = await setupHost({ host: hostOptions, setupTimeoutMs: false, core: () => ({}) })
    expect(app).not.toBeInstanceOf(PluginHost)
    expect(typeof app.host.use).toBe('function')
    expect(typeof app.host.dispose).toBe('function')
    await app.dispose()
  })
})
