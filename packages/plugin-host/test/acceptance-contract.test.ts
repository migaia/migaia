import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { definePlugin, PluginHost, setupHost } from '../src/index.js'
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
    const short = definePlugin('short', () => ({ short: true }))
    const full = definePlugin({ name: 'full', install: () => ({ full: true }) })
    const host = new AcceptanceHost(hostOptions)
    const view = await host.use(short, full)
    expect(view.extensions).toMatchObject({ short: true, full: true })
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
    const trusted = definePlugin('trusted', () => ({ trusted: true }))
    const clone = { ...trusted }
    const host = new AcceptanceHost(hostOptions)
    const view = await host.use(clone as never)
    expect((view.extensions as Record<string, unknown>).trusted).toBe(true)
    await host.dispose()
  })

  it('PHV3-T06: preserves mixed admission order and duplicate atomicity', async () => {
    const first = definePlugin('first', () => ({ first: true }))
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
    const warmPlugin = definePlugin('trusted-warm', () => ({}))
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
    expect(medians.slice(1).every((value, index) => value / medians[index] <= 2.5)).toBe(true)
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
    const plugin = definePlugin('single-read', () => ({ ready: true }))
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
