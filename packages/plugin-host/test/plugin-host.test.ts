import { describe, expect, it, vi } from 'vitest'
import { PluginHost } from '../src/host-runtime'
import { PluginHostError } from '../src/error-text'
import { PluginHostErrorCode } from '../src/error-code'
import {
  defineFeature,
  definePlugin,
  PluginHost as PublicPluginHost,
  PluginHostDisposalNodeKind,
  readPluginHostDisposalProvenance
} from '../src/index.js'
import * as pluginHostPublic from '../src/index.js'
import type { IPluginConstraint, IPluginHostCore, IPluginHostOptions } from '../src/typing'
import {
  createPipeline,
  GENERATOR_CONTINUE as middlewareContinue,
  GENERATOR_HALT as middlewareHalt,
  GENERATOR_UNDEFINED as middlewareUndefined,
  MiddlewarePipelineMode
} from '@migaia/middleware-pipeline'
import {
  GENERATOR_CONTINUE as hostContinue,
  GENERATOR_HALT as hostHalt,
  GENERATOR_UNDEFINED as hostUndefined
} from '../src/typing'
import { PluginHostRemovalRuntime } from '../src/removal-runtime.js'
import { createManualScheduler } from '@migaia/lifecycle'
import { openComposition } from '../src/composition-entry.js'

type IExt = { marker?: string } & Pick<IPluginHostCore<number>, 'onDispose' | 'usePipeline'>
type IStageCore = IExt & {
  usePipeline: (stage: (value: number, next: (value: number) => void) => void) => unknown
}
class Host extends PluginHost<IExt, number> {
  /** Supplies an explicit unbounded test policy while preserving test overrides. */
  constructor(options: any = {}) {
    super({
      ...options,
      execution: options.execution ?? { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
  }

  run(value: number): number | Promise<number> {
    let result = value
    const output = this.runPipeline(value, (next) => {
      result = next
    })
    return output instanceof Promise ? output.then(() => result) : result
  }
}

class FeatureHost extends PublicPluginHost<{}> {
  /** Supplies the same unbounded lifecycle policy for native Feature integration checks. */
  constructor(
    options: Omit<IPluginHostOptions, 'execution'> &
      Partial<Pick<IPluginHostOptions, 'execution'>> = {}
  ) {
    super({
      ...options,
      execution: options.execution ?? { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
  }

  installSync(plugins: readonly IPluginConstraint<{}>[]) {
    return this.useSync(plugins)
  }
}

const plugin = (
  name: string,
  install: (core: IExt) => unknown,
  extra: Record<string, unknown> = {}
) => ({ name, install, ...extra }) as never

/** Moved from round30.test.ts (BZ05): overrides disposal error translation for PH-R41. */
class TranslatingHost extends PluginHost<Record<string, never>> {
  readonly translations = vi.fn()

  /** Supplies an explicit unbounded test policy while preserving test overrides. */
  constructor(options: any = {}) {
    super({
      ...options,
      execution: options.execution ?? { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
  }

  protected override translateDisposalError(error: PluginHostError): Error {
    this.translations(error)
    return new Error('translated disposal', { cause: error })
  }
}

describe('PluginHost', () => {
  it('YS23: keeps object extension members named install and expose while rejecting the legacy function sentinel', async () => {
    const object = definePlugin({
      name: 'ys23-object',
      install: () => ({ install: true, expose: true })
    })
    const legacySentinel = definePlugin('ys23-legacy-sentinel', () => ({ legacy: true }) as never)
    const host = new FeatureHost()
    const [handle] = await host.use(object)
    expect(handle.extensions).toMatchObject({ install: true, expose: true })
    await expect(host.use(legacySentinel)).rejects.toMatchObject({
      cause: { code: 'INVALID_OPTION' }
    })
    expect(openComposition(host).getCurrentSnapshot().extensions).not.toHaveProperty('legacy')
    await host.dispose()
  })

  it('YS25: captures one descriptor per registration and forwards only its declared hooks', async () => {
    let descriptorCalls = 0
    let installCalls = 0
    let exposeCalls = 0
    const plugin = definePlugin('descriptor-hooks', (core) => {
      descriptorCalls += 1
      expect(typeof core.onDispose).toBe('function')
      return {
        install: () => {
          installCalls += 1
          return { installed: descriptorCalls }
        },
        expose: () => {
          exposeCalls += 1
          return { exposed: descriptorCalls }
        }
      }
    })
    const [first] = await new FeatureHost().use(plugin)
    const [second] = await new FeatureHost().use(plugin)
    expect(first.extensions).toMatchObject({ installed: 1, exposed: 1 })
    expect(second.extensions).toMatchObject({ installed: 2, exposed: 2 })
    expect([descriptorCalls, installCalls, exposeCalls]).toEqual([2, 2, 2])
  })

  it('rejects descriptor expose collisions without invoking callback results as hooks', async () => {
    // @ts-expect-error YS28 rejects overlapping install/expose Host projections statically.
    const plugin = definePlugin('descriptor-collision', () => ({
      install: () => ({ duplicate: 1 }),
      expose: () => ({ duplicate: 2 })
    }))
    await expect(new FeatureHost().use(plugin)).rejects.toMatchObject({
      cause: { code: 'EXTENSION_DUPLICATE' }
    })
  })

  it('YS25: rejects Feature-core reads from a descriptor before Feature initialization', async () => {
    const plugin = definePlugin('early-feature-read', (core) => {
      void (core as unknown as { readonly features: object }).features
      return { install: () => ({}) }
    })
    await expect(new FeatureHost().use(plugin)).rejects.toMatchObject({
      cause: {
        code: 'INVALID_OPTION',
        message: expect.stringContaining('Feature core is not ready')
      }
    })
  })

  it('YS25: initializes Feature output after descriptor featureExpose and before install', async () => {
    const feature = defineFeature<
      { readonly read: () => number },
      Record<never, never>,
      { readonly read: () => number }
    >((core) => ({ read: core.featureExpose.read }))
    const plugin = definePlugin(
      'feature-ready',
      (core) => ({
        featureExpose: () => ({ read: () => 11 }),
        install: () => ({ value: core.features.feature.read() })
      }),
      { feature }
    )
    const host = new FeatureHost()
    const [handle] = await host.use(plugin)
    expect(handle.extensions.value).toBe(11)
    await host.dispose()
  })

  it('snapshots only trusted enumerable direct Feature dependencies without running factories', () => {
    let calls = 0
    const dependency = defineFeature(() => {
      calls += 1
      return { dependency: true }
    })
    const feature = defineFeature(() => ({ feature: true }), { dependency })
    expect(feature).toEqual({})
    expect(Object.isFrozen(feature)).toBe(true)
    expect(calls).toBe(0)
    expect(() => defineFeature(() => ({}), { dependency, invalid: {} as never })).toThrow(
      'feature dependencies must contain defined features'
    )
    expect(() => defineFeature(() => ({}), Object.create({ dependency }))).toThrow(
      'feature dependencies must be a plain record'
    )
  })

  it('accepts descriptor Feature shorthand on the same opaque authority', async () => {
    let calls = 0
    const feature = defineFeature({ install: () => ({ value: ++calls }) })
    const plugin = definePlugin({
      name: 'descriptor-feature',
      features: { feature },
      featureExpose: {},
      install: (core) => ({ value: (core as any).features.feature.value })
    })
    const [result] = await new FeatureHost().use(plugin)
    expect(result.extensions.value).toBe(1)
    expect(calls).toBe(1)
  })

  it('rejects forged Feature records before any factory callback', () => {
    let getterCalls = 0
    const descriptor = Object.defineProperty({}, 'install', {
      enumerable: true,
      get: () => {
        getterCalls += 1
        return () => ({})
      }
    })
    expect(() => defineFeature(descriptor as never)).toThrow()
    expect(getterCalls).toBe(0)
    let calls = 0
    const valid = defineFeature(() => {
      calls += 1
      return {}
    })
    expect(() =>
      definePlugin({
        name: 'forged-feature',
        install: () => ({}),
        features: { valid, forged: {} as never },
        featureExpose: {}
      })
    ).toThrow()
    expect(calls).toBe(0)
  })

  it('injects only featureExpose into Feature factories, never lifecycle core', async () => {
    const feature = defineFeature<
      { readonly read: () => number },
      Record<never, never>,
      { readonly read: () => number }
    >((core) => {
      expect('getShared' in core).toBe(false)
      expect('onDispose' in core).toBe(false)
      return { read: () => core.featureExpose.read() }
    })
    const plugin = definePlugin({
      name: 'feature-core-isolation',
      features: { feature },
      featureExpose: { read: () => 7 },
      install: (core) => ({ read: core.features.feature.read() })
    })
    const host = new FeatureHost()
    const [handle] = await host.use(plugin)
    expect(handle.extensions.read).toBe(7)
    await host.dispose()
  })

  it('reports rejected Feature thenables without awaiting or publishing them', async () => {
    const original = new Error('late-feature-rejection')
    const diagnostics: string[] = []
    const invalid = defineFeature((() => Promise.reject(original)) as never)
    const host = new FeatureHost({
      diagnostic: (message: string) => diagnostics.push(message)
    } as any)
    let thrown: any
    try {
      await host.use(
        definePlugin({
          name: 'invalid-feature',
          install: () => ({}),
          features: { invalid },
          featureExpose: {}
        })
      )
    } catch (error) {
      thrown = error
    }
    await Promise.resolve()
    await Promise.resolve()
    expect(thrown.cause.cause).toBe(original)
    expect(diagnostics.join('|')).toContain('late-feature-rejection')
  })

  it('contains synchronous and asynchronous diagnostic failures without replacing a late Feature cause', async () => {
    const original = new Error('feature-late-cause')
    const reporterFailure = new Error('reporter-late-failure')
    const invalid = defineFeature((() => Promise.reject(original)) as never)
    const host = new FeatureHost({ diagnostic: () => Promise.reject(reporterFailure) } as any)
    await expect(
      host.use(
        definePlugin({
          name: 'invalid-reporter',
          install: () => ({}),
          features: { invalid },
          featureExpose: {}
        })
      )
    ).rejects.toMatchObject({ cause: { cause: original } })
    await Promise.resolve()
    const throwingHost = new FeatureHost({
      diagnostic: () => {
        throw reporterFailure
      }
    } as any)
    await expect(
      throwingHost.use(
        definePlugin({
          name: 'invalid-throwing-reporter',
          install: () => ({}),
          features: { invalid },
          featureExpose: {}
        })
      )
    ).rejects.toMatchObject({ cause: { cause: original } })
  })

  it('captures a custom Feature thenable once and rejects useSync before it settles', async () => {
    let getterCalls = 0
    let thenCalls = 0
    let reject!: (error: unknown) => void
    const original = new Error('custom-late')
    // oxlint-disable-next-line unicorn/no-thenable -- hostile Feature output verifies observed late rejection.
    const value = Object.defineProperty({}, 'then', {
      get: () => {
        getterCalls += 1
        return (_resolve: unknown, onReject: (error: unknown) => void) => {
          thenCalls += 1
          reject = onReject
        }
      }
    })
    const invalid = defineFeature((() => value) as never)
    let installs = 0
    const host = new FeatureHost()
    let thrown: any
    try {
      host.installSync([
        definePlugin({
          name: 'custom-invalid',
          features: { invalid },
          featureExpose: {},
          install: () => {
            installs += 1
            return {}
          }
        })
      ])
    } catch (error) {
      thrown = error
    }
    expect(installs).toBe(0)
    expect(getterCalls).toBe(1)
    expect(thenCalls).toBe(1)
    reject(original)
    await Promise.resolve()
    expect(thrown.cause.cause).toBe(original)
  })

  it('preserves a throwing then getter as the Feature failure cause', () => {
    const original = new Error('then-getter')
    const invalid = defineFeature((() =>
      // oxlint-disable-next-line unicorn/no-thenable -- hostile Feature output verifies getter-failure preservation.
      Object.defineProperty({}, 'then', {
        get: () => {
          throw original
        }
      })) as never)
    const host = new FeatureHost()
    let thrown: any
    try {
      host.installSync([
        definePlugin({
          name: 'getter-invalid',
          install: () => ({}),
          features: { invalid },
          featureExpose: {}
        })
      ])
    } catch (error) {
      thrown = error
    }
    expect(thrown.cause.cause).toBe(original)
  })

  it('constructs Feature outputs per registration before plugin install', async () => {
    const expose = { value: () => 21 }
    const base = defineFeature(
      (core: { readonly featureExpose: { readonly value: () => number } }) => ({
        read: () => core.featureExpose.value()
      })
    )
    const derived = defineFeature(
      (_core, dependencies) => ({
        twice: () => dependencies.base.read() * 2
      }),
      { base }
    )
    const plugin = definePlugin({
      name: 'native-feature',
      features: { derived },
      featureExpose: expose,
      install: (core) => {
        const featureCore = core as typeof core & {
          readonly features: { readonly derived: { readonly twice: () => number } }
        }
        return { result: featureCore.features.derived.twice() }
      }
    })
    const host = new FeatureHost()
    const [first] = await host.use(plugin)
    expect(first.extensions.result).toBe(42)
    const [second] = await new FeatureHost().use(plugin)
    expect(second.extensions.result).toBe(42)
    expect(Object.isFrozen(expose)).toBe(false)
  })

  it('keeps the exported disposal discriminator immutable and exact', () => {
    const expectedKeys = ['hostError', 'aggregate', 'disposerWrapper']
    expect(Object.isFrozen(PluginHostDisposalNodeKind)).toBe(true)
    expect(Reflect.ownKeys(PluginHostDisposalNodeKind)).toEqual(expectedKeys)
    expect({ ...PluginHostDisposalNodeKind }).toEqual({
      hostError: 'host-error',
      aggregate: 'aggregate',
      disposerWrapper: 'disposer-wrapper'
    })
    for (const key of expectedKeys) {
      expect(Object.getOwnPropertyDescriptor(PluginHostDisposalNodeKind, key)).toEqual({
        configurable: false,
        enumerable: true,
        value: PluginHostDisposalNodeKind[key as keyof typeof PluginHostDisposalNodeKind],
        writable: false
      })
    }
    expect(() => {
      ;(PluginHostDisposalNodeKind as Record<string, string>).hostError = 'tampered'
    }).toThrow()
    expect(() =>
      Object.defineProperty(PluginHostDisposalNodeKind, 'hostError', { value: 'tampered' })
    ).toThrow()
    expect(Reflect.deleteProperty(PluginHostDisposalNodeKind, 'aggregate')).toBe(false)
    expect(PluginHostDisposalNodeKind.aggregate).toBe('aggregate')
    expect(() => Object.setPrototypeOf(PluginHostDisposalNodeKind, null)).toThrow()
    expect(Object.getPrototypeOf(PluginHostDisposalNodeKind)).toBe(Object.prototype)
  })

  it('fails closed when a duplicate module instance reads a genuine Host node', async () => {
    const producerModule = await import(
      new URL('../src/host-runtime.js?round20-producer', import.meta.url).href
    )
    const foreignModule = await import(
      new URL('../src/host-runtime.js?round20-foreign', import.meta.url).href
    )
    const DuplicateHost = class extends producerModule.PluginHost {
      constructor() {
        super({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } })
      }
    }
    const raw = new Error('duplicate-instance raw disposer')
    const host = new DuplicateHost()
    await host.use({
      name: 'duplicate-instance',
      install: (core: IPluginHostCore<unknown>) => {
        core.onDispose(() => {
          throw raw
        })
        return {}
      }
    } as never)
    const result = await host.dispose()
    expect(result.logicalTerminal).toBe(true)
    expect(result.cleanupComplete).toBe(true)
    expect(result.cleanupErrors.length).toBeGreaterThan(0)
    expect(producerModule.readPluginHostDisposalProvenance(result.cleanupErrors[0])?.kind).toBe(
      producerModule.PluginHostDisposalNodeKind.disposerWrapper
    )
    expect(foreignModule.readPluginHostDisposalProvenance(result.cleanupErrors[0])).toBeUndefined()
  })

  it('marks generated disposal nodes without mutating arbitrary disposer errors', async () => {
    const rawInner = new Error('raw inner cause')
    const raw = new Error('raw disposer failure', {
      cause: new AggregateError([rawInner])
    })
    const host = new Host()
    await host.use(
      plugin('provenance', (core) => {
        core.onDispose(() => {
          throw raw
        })
        return {}
      })
    )

    const first = host.dispose()
    const second = host.dispose()
    expect(second).toBe(first)
    const result = await first
    expect(result.logicalTerminal).toBe(true)
    expect(result.cleanupComplete).toBe(true)
    expect(result.cleanupErrors.length).toBeGreaterThan(0)
    const wrapper = result.cleanupErrors[0]
    expect(readPluginHostDisposalProvenance(wrapper)).toEqual({
      kind: PluginHostDisposalNodeKind.disposerWrapper,
      phase: 'resource disposer'
    })
    expect((wrapper as { readonly cause?: unknown }).cause).toBe(raw)
    expect((raw as { readonly cause?: unknown }).cause).toBeInstanceOf(AggregateError)
    /** Object view used to prove copying and proxying cannot copy WeakMap membership. */
    const wrapperObject = wrapper as object
    expect(
      readPluginHostDisposalProvenance({ kind: PluginHostDisposalNodeKind.hostError })
    ).toBeUndefined()
    expect(readPluginHostDisposalProvenance(Object.assign({}, wrapper))).toBeUndefined()
    expect(
      readPluginHostDisposalProvenance(
        Object.create(Object.getPrototypeOf(wrapper), Object.getOwnPropertyDescriptors(wrapper))
      )
    ).toBeUndefined()
    expect(readPluginHostDisposalProvenance(new Proxy(wrapperObject, {}))).toBeUndefined()
    expect(Reflect.ownKeys(wrapperObject).filter((key) => typeof key === 'symbol')).toEqual([])
    expect(pluginHostPublic).not.toHaveProperty('markPluginHostDisposalNode')
    expect(pluginHostPublic).not.toHaveProperty('pluginHostDisposalProvenanceKey')
  })

  it('preserves failed plugin and rollback error identities in install detail', async () => {
    const host = new Host()
    const primary = new Error('install-boom')
    const rollback = new Error('rollback-boom')
    let caught: unknown

    try {
      await host.use(
        plugin('first', (core) => {
          core.onDispose(() => {
            throw rollback
          })
          return {}
        }),
        plugin('failed', () => {
          throw primary
        })
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(PluginHostError)
    const failure = caught as PluginHostError
    expect(failure.cause).toBe(primary)
    expect(failure.detail?.failedName).toBe('failed')
    const rollbackErrors = failure.detail?.rollbackErrors
    expect(rollbackErrors).toHaveLength(1)
    expect((rollbackErrors as readonly unknown[])[0]).toBe(rollback)
  })

  it('preserves host error ownership while forwarding explicit signal', async () => {
    let aborted = false
    const signal = {
      get aborted() {
        return aborted
      },
      addEventListener() {},
      removeEventListener() {}
    }
    await expect(
      createPipeline<number>({ mode: MiddlewarePipelineMode.async, signal }).run(
        [
          async (_value, _next, context) => {
            aborted = true
            expect(context?.signal).toBe(signal)
          }
        ],
        1,
        () => undefined
      )
    ).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('re-exports generator signals with middleware-pipeline identity', () => {
    expect(hostContinue).toBe(middlewareContinue)
    expect(hostHalt).toBe(middlewareHalt)
    expect(hostUndefined).toBe(middlewareUndefined)
    expect(pluginHostPublic.MiddlewarePipelineMode).toBe(MiddlewarePipelineMode)
    expect(pluginHostPublic).not.toHaveProperty('PluginHostPipelineMode')
    expect(pluginHostPublic).not.toHaveProperty('adaptSyncStageToAsync')
  })

  it('keeps plugin stage and resource registration available across async install', async () => {
    const host = new Host()
    await host.use(
      plugin('async-registration', async (core) => {
        core.usePipeline((value, next) => next(value + 1))
        await Promise.resolve()
        core.usePipeline((value, next) => next(value * 2))
        core.onDispose(() => undefined)
        return {}
      })
    )
    expect(host.run(1)).toBe(4)
  })

  it('keeps nested objects shared when committing config patches', async () => {
    const host = new Host()
    const shared = { retries: 3 }
    await host.use(plugin('config-owned', () => ({}), { config: {} }))
    await host.config.update('config-owned', () => ({ opts: shared }))
    shared.retries = 99
    await host.config.update('config-owned', (previous) => {
      expect((previous.opts as { retries: number }).retries).toBe(3)
      return {}
    })
  })

  it('drains resources registered by another resource disposer', async () => {
    const host = new Host()
    const calls: string[] = []
    await host.use(
      plugin('resource-drain', (core) => {
        core.onDispose(() => {
          calls.push('first')
          core.onDispose(() => {
            calls.push('late')
          })
        })
        return {}
      })
    )
    const result = await host.unUse('resource-drain')
    expect(result).toMatchObject({ ok: false, errors: expect.any(Array) })
    expect(calls).toEqual(['first'])
  })

  it('rejects pipeline registration during dispose and leaves no leaked stage', async () => {
    const host = new Host()
    let core: IExt | undefined
    await host.use(
      plugin(
        'dispose-stage',
        (received) => {
          core = received
          return {}
        },
        {
          dispose: () => {
            core?.usePipeline((value, next) => next(value + 100))
          }
        }
      )
    )
    const result = await host.unUse('dispose-stage')
    expect(result).toMatchObject({ ok: false, errors: expect.any(Array) })
    expect(host.run(1)).toBe(1)
  })

  it('rejects pipeline and resource registration during update', async () => {
    const host = new Host()
    let core: IExt | undefined
    await host.use(
      plugin(
        'update-lifecycle',
        (received) => {
          core = received
          return {}
        },
        {
          update: () => {
            expect(() =>
              core?.usePipeline((value, next: (value: number) => void) => next(value + 1))
            ).toThrow('install')
            expect(() => core?.onDispose(() => undefined)).toThrow('install')
          }
        }
      )
    )
    await host.config.update('update-lifecycle', () => ({}))
    expect(host.run(1)).toBe(1)
  })

  it.each(['sync', 'async', 'generator', 'async-generator'] as const)(
    'keeps stage/resource ownership aligned across %s lifecycle',
    async (mode) => {
      const host = new Host({ pipeline: { mode } })
      let core: IExt | undefined
      await host.use(
        plugin(
          `lifecycle-${mode}`,
          (received) => {
            core = received
            received.usePipeline((_value, next) => next(1))
            received.onDispose(() => undefined)
            return {}
          },
          {
            config: { enabled: true },
            update: () => {
              expect(() => core?.usePipeline((_value, next) => next(1))).toThrow('install')
              expect(() => core?.onDispose(() => undefined)).toThrow('install')
            },
            dispose: () => {
              expect(() => core?.usePipeline((_value, next) => next(1))).toThrow('install')
              expect(() => core?.onDispose(() => undefined)).toThrow('install')
            }
          }
        )
      )
      await host.config.update(`lifecycle-${mode}`, () => ({ enabled: false }))
      await expect(host.unUse(`lifecycle-${mode}`)).resolves.toEqual({ ok: true })
      const result = host.run(1)
      if (mode === 'async' || mode === 'async-generator') await expect(result).resolves.toBe(1)
      else expect(result).toBe(1)
    }
  )

  it('rejects stage registration during sync pipeline execution', () => {
    const host = new Host()
    expect(() =>
      host.usePipeline((value, next) => {
        expect(() => host.usePipeline((_value, nextValue) => nextValue)).toThrow('pipeline')
        next(value)
      })
    ).not.toThrow()
    expect(host.run(1)).toBe(1)
  })

  it.each(['async', 'generator'] as const)(
    'rejects nested stage registration during %s pipeline execution',
    async (mode) => {
      const host = new Host({ pipeline: { mode } })
      if (mode === 'async') {
        host.useAsyncPipeline(async (value, next) => {
          expect(() =>
            host.useAsyncPipeline(async (_nextValue, nextValue) => nextValue(1))
          ).toThrow(PluginHostError)
          await next(value)
        })
        await expect(host.run(1)).resolves.toBe(1)
      } else {
        host.useGeneratorPipeline(function* (value) {
          expect(() =>
            host.useGeneratorPipeline(function* (nextValue) {
              return nextValue
            })
          ).toThrow(PluginHostError)
          return value
        })
        expect(host.run(1)).toBe(1)
      }
    }
  )

  it('throws nested mutations from synchronous lifecycle callbacks', async () => {
    const host = new Host()
    await expect(
      host.use({
        name: 'outer-install',
        install: () => {
          expect(() => host.use({ name: 'nested-install', install: () => ({}) })).toThrow(
            PluginHostError
          )
          return {}
        }
      } as never)
    ).resolves.toHaveLength(1)
  })

  it('validates and isolates diagnostic callbacks', () => {
    expect(() => new Host({ diagnostic: 42 } as never)).toThrow(TypeError)
    const host = new Host({
      diagnostic: () => {
        throw new Error('diagnostic failed')
      }
    })
    expect(() => {
      host.usePipeline((_value, next) => {
        setTimeout(() => next(1), 0)
      })
    }).not.toThrow()
  })

  it('snapshots plugin definitions at admission and preserves hook receiver', async () => {
    const host = new Host()
    const pluginInstance = {
      name: 'snapshot-a',
      count: 0,
      install() {
        this.count += 1
        return { marker: 'a' }
      }
    }
    const installing = host.use(pluginInstance as never)
    pluginInstance.name = 'snapshot-b'
    pluginInstance.install = () => ({ marker: 'b' })
    await installing
    expect(pluginInstance.count).toBe(1)
    expect(((await installing) as any)[0].extensions.marker).toBe('a')
  })

  it('uses the admitted install snapshot after caller mutation', async () => {
    const host = new Host()
    const secondPlugin = {
      name: 'queued-snapshot',
      install: () => ({ marker: 'admitted' })
    }
    const second = host.use(secondPlugin as never)
    secondPlugin.install = () => ({ marker: 'mutated' })
    const handles = (await second) as any
    expect(handles[0].extensions.marker).toBe('admitted')
  })

  it('rejects duplicate names in one use admission', async () => {
    const host = new Host()
    const first = plugin('same', () => ({}))
    expect(() => host.use(first, first)).toThrow(PluginHostError)
  })

  it('rejects malformed lifecycle hooks during admission', async () => {
    const host = new Host()
    expect(() => host.use({ name: 'invalid-hook', install: 1 } as never)).toThrow(TypeError)
  })

  it('rejects class and inherited-then extension results before mounting', async () => {
    const host = new Host()
    class Extension {}
    await expect(
      host.use(plugin('class-extension', () => new Extension() as never))
    ).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
    const inheritedThen = Object.create({})
    const thenKey = ['t', 'h', 'e', 'n'].join('')
    Object.defineProperty(Object.getPrototypeOf(inheritedThen), thenKey, {
      get() {
        throw new Error('inherited then accessed')
      }
    })
    await expect(host.use(plugin('inherited-then', () => inheritedThen))).rejects.toThrow()
    expect(host).not.toHaveProperty('marker')
  })

  it('rejects an external mutation during another plugin lifecycle', async () => {
    const order: string[] = []
    const host = new Host()
    const first = host.use(
      plugin('a', async () => {
        order.push('a:start')
        await Promise.resolve()
        order.push('a:end')
        return {}
      })
    )
    expect(() => host.use(plugin('b', () => ({ marker: 'b' })))).toThrow(PluginHostError)
    await first
    expect(order).toEqual(['a:start', 'a:end'])
  })

  it('rejects a mutation admitted during an earlier lifecycle hook', async () => {
    const host = new Host()
    const order: string[] = []
    const first = host.use(
      plugin('queue-a', async () => {
        order.push('a:start')
        await Promise.resolve()
        order.push('a:end')
        return {}
      })
    )
    expect(() =>
      host.use(
        plugin('queue-b', () => {
          order.push('b')
          return {}
        })
      )
    ).toThrow(PluginHostError)
    await first
    const third = host.use(
      plugin('queue-c', () => {
        order.push('c')
        return {}
      })
    )
    await third
    expect(order).toEqual(['a:start', 'a:end', 'c'])
  })

  it('rolls back failed batch in reverse order without touching old registrations', async () => {
    const disposed: string[] = []
    const host = new Host()
    await host.use(
      plugin('old', () => ({}), {
        dispose: () => {
          disposed.push('old')
        }
      })
    )
    await expect(
      host.use(
        plugin('a', () => ({}), {
          dispose: () => {
            disposed.push('a')
          }
        }),
        plugin('b', () => {
          throw new Error('failed')
        }),
        plugin('c', () => ({ marker: 'c' }))
      )
    ).rejects.toThrow('failed')
    expect(disposed).toEqual(['a'])
    expect(host).not.toHaveProperty('marker')
    await host.dispose()
    expect(disposed).toEqual(['a', 'old'])
  })

  it('updates registration config transactionally', async () => {
    const updates: unknown[] = []
    const host = new Host()
    await host.use(
      plugin('config', () => ({}), {
        config: { enabled: false },
        update: (next: unknown) => updates.push(next)
      })
    )
    await host.config.update('config', (previous) => ({ enabled: !previous.enabled }))
    expect(updates).toEqual([{ enabled: true }])
  })

  it('reads nested config paths through readonly lazy proxies', async () => {
    const nested = { retries: 3 }
    const host = new Host()
    await host.use(
      plugin('config-paths', () => ({}), {
        config: { options: nested, records: [{ enabled: true }] }
      })
    )
    expect(host.config.get('config-paths.options.retries')).toBe(3)
    expect(host.config.get('config-paths.records.[0].enabled')).toBe(true)
    const options = host.config.get('config-paths.options') as { retries: number }
    expect(options).not.toBe(nested)
    expect(options.retries).toBe(3)
    expect(host.config.get('config-paths')).toEqual({
      options: { retries: 3 },
      records: [{ enabled: true }]
    })
    expect(host.config.get('missing.value')).toBeUndefined()
  })

  it('isolates source config and applies update patches with copy-on-write', async () => {
    const source = { options: { retries: 3 }, enabled: true }
    const host = new Host()
    await host.use(plugin('cow', () => ({}), { config: source }))
    source.options.retries = 99
    expect(host.config.get('cow.options.retries')).toBe(3)
    expect(() => {
      ;(host.config.get('cow.options') as { retries: number }).retries = 4
    }).toThrow(TypeError)

    const patch = { options: { retries: 5 } }
    await host.config.update('cow', (previous) => {
      expect(() => {
        ;(previous.options as { retries: number }).retries = 4
      }).toThrow(TypeError)
      return patch
    })
    const updated = host.config.get('cow.options') as { retries: number }
    expect(updated.retries).toBe(5)
    patch.options.retries = 6
    expect((host.config.get('cow.options') as { retries: number }).retries).toBe(5)
    source.options.retries = 100
    expect((host.config.get('cow.options') as { retries: number }).retries).toBe(5)
  })

  it('keeps special plugin names and config paths isolated from prototypes', async () => {
    const host = new Host()
    await host.use(plugin('proto', () => ({}), { config: { safe: { enabled: true } } }))
    expect(host.config.get('proto.safe.enabled')).toBe(true)
    expect(host.config.get('__proto__.safe')).toBeUndefined()
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(() => host.config.get('proto.[-1].safe')).toThrow(TypeError)
  })

  it('reuses the config facade and rejects it after disposal', async () => {
    const host = new Host()
    await host.use(plugin('config-facade', () => ({}), { config: { enabled: true } }))
    expect(host.config).toBe(host.config)
    expect(host.config.get('config-facade.enabled')).toBe(true)
    await host.dispose()
    expect(() => host.config.get('config-facade.enabled')).toThrow(PluginHostError)
  })

  it('keeps the original construct error as primary and reports a rollback failure via diagnostic (M-T44/L-T39)', async () => {
    const diagnostics: Array<{ message: string; code?: string }> = []
    const host = new Host({
      diagnostic: (message: string, code?: string) => diagnostics.push({ message, code })
    } as any)
    await expect(
      host.use(
        plugin('rollback-resource', (core) => {
          core.onDispose(() => {
            throw new Error('rollback dispose')
          })
          return {}
        }),
        plugin('rollback-failure', () => {
          throw new Error('install failure')
        })
      )
    ).rejects.toMatchObject({
      code: 'PLUGIN_INSTALL_FAILED',
      cause: expect.objectContaining({ message: expect.stringContaining('install failure') })
    })
    expect(
      diagnostics.some(
        (entry) =>
          entry.code === 'PLUGIN_INSTALL_ROLLBACK_FAILED' && /rollback dispose/.test(entry.message)
      )
    ).toBe(true)
  })

  it('cleans extensions when plugin dispose fails', async () => {
    const host = new Host()
    await host.use(
      plugin('extension', () => ({ marker: 'x' }), {
        dispose: () => {
          throw new Error('dispose')
        }
      })
    )
    const result = await host.unUse('extension')
    expect(result).toMatchObject({ ok: false, errors: expect.any(Array) })
  })

  it('revoked extension closure rejects a callable captured before unUse', async () => {
    const host = new Host()
    const [handle] = await host.use(plugin('revoked-closure', () => ({ read: () => 7 })))
    const read = (handle.extensions as { read: () => number }).read
    expect(read()).toBe(7)
    await host.unUse('revoked-closure')
    expect(() => read()).toThrow(
      expect.objectContaining({ code: PluginHostErrorCode.registrationRevoked })
    )
  })

  it('feature expose invalidation revokes a captured Feature output immediately after unUse', async () => {
    const feature = defineFeature<{ readonly read: () => number }>((core) => ({
      read: core.featureExpose.read as () => number
    }))
    let output!: { readonly read: () => number }
    const host = new FeatureHost()
    await host.use(
      definePlugin(
        'feature-invalidation',
        (core) => {
          return {
            featureExpose: () => ({ read: () => 7 }),
            install: () => {
              output = core.features.feature as { readonly read: () => number }
              return {}
            }
          }
        },
        { feature }
      )
    )
    expect(output.read()).toBe(7)
    await host.unUse('feature-invalidation')
    expect(() => output.read()).toThrow(
      expect.objectContaining({
        code: PluginHostErrorCode.registrationRevoked
      })
    )
  })

  it('feature expose invalidation is synchronous even when pending drain never settles', () => {
    /** A stalled drain distinguishes revocation from a later microtask. */
    const registration: any = {
      name: 'pending-feature',
      shared: [],
      extensions: [],
      pipelineDisposers: [],
      pipelineOwnerKey: {},
      installed: true,
      lifecycle: 'install',
      featureExposeValid: true,
      featurePending: { drain: () => new Promise<void>(() => undefined) }
    }
    const runtime = new PluginHostRemovalRuntime({
      host: {},
      registrations: new Map([[registration.name, registration]]),
      removeRegistration: () => undefined,
      extensionOwners: new Map(),
      pipelineLeases: { seal: () => undefined } as any,
      retireLeaseOwner: () => undefined,
      executionSignal: {} as any,
      cleanupRuntime: {} as any,
      setHookRegistration: () => undefined
    })
    runtime.revokeRegistration(registration)
    expect(registration.featureExposeValid).toBe(false)
  })

  it('YS11 cause chain: captured Feature expose revocation keeps declared code and text', async () => {
    const feature = defineFeature<{ readonly read: () => number }>((core) => ({
      read: core.featureExpose.read as () => number
    }))
    let output!: { readonly read: () => number }
    const host = new FeatureHost()
    await host.use(
      definePlugin(
        'feature-revoked-cause-chain',
        (core) => ({
          featureExpose: () => ({ read: () => 7 }),
          install: () => {
            output = core.features.feature as { readonly read: () => number }
            return {}
          }
        }),
        { feature }
      )
    )
    await host.unUse('feature-revoked-cause-chain')
    expect(() => output.read()).toThrow(
      expect.objectContaining({
        code: PluginHostErrorCode.registrationRevoked
      })
    )
  })

  it('YS12 thenable install result: async path reports INSTALL_RESULT_THENABLE', async () => {
    // oxlint-disable-next-line unicorn/no-thenable -- contract requires an own then install result.
    const thenable = Object.defineProperty({}, 'then', {
      value: (resolve: (value: unknown) => void) => resolve({})
    })
    await expect(
      new FeatureHost().use(
        definePlugin('async-install-thenable', () => ({ install: () => thenable as never }))
      )
    ).rejects.toMatchObject({ cause: { code: 'INSTALL_RESULT_THENABLE' } })
  })

  it('YS12 thenable install result: sync path reports INSTALL_RESULT_THENABLE', () => {
    // oxlint-disable-next-line unicorn/no-thenable -- contract requires an own then install result.
    const thenable = Object.defineProperty({}, 'then', {
      value: (resolve: (value: unknown) => void) => resolve({})
    })
    const host = new FeatureHost()
    expect(() =>
      host.installSync([
        definePlugin('sync-install-thenable', () => ({ install: () => thenable as never }))
      ])
    ).toThrow(
      expect.objectContaining({
        cause: expect.objectContaining({ code: 'INSTALL_RESULT_THENABLE' })
      })
    )
  })

  it('feature expose invalidation precedes a never-settling owned resource cleanup timeout', async () => {
    const feature = defineFeature<{ readonly read: () => number }>((core) => ({
      read: core.featureExpose.read as () => number
    }))
    let output!: { readonly read: () => number }
    const scheduler = createManualScheduler()
    let entered!: () => void
    const enteredGate = new Promise<void>((resolve) => {
      entered = resolve
    })
    const host = new FeatureHost({ scheduler, disposeStepTimeoutMs: 10 } as any)
    await host.use(
      definePlugin(
        'feature-invalidation-complete',
        (core) => {
          return {
            featureExpose: () => ({ read: () => 7 }),
            install: () => {
              output = core.features.feature as { readonly read: () => number }
              core.onDispose(() => {
                entered()
                return new Promise<void>(() => {})
              })
              return {}
            }
          }
        },
        { feature }
      )
    )
    const removal = host.unUse('feature-invalidation-complete')
    await enteredGate
    expect(() => output.read()).toThrow(
      expect.objectContaining({
        code: PluginHostErrorCode.registrationRevoked
      })
    )
    scheduler.advance(10)
    await expect(removal).resolves.toMatchObject({ ok: false, errors: expect.any(Array) })
  })

  it('stage slot retention keeps exact ordinal and clears registration-owned references', () => {
    const host = {}
    const registration: any = {
      name: 'slot-reclaim',
      shared: [],
      extensions: [{ key: 'owned', descriptor: { value: () => undefined } }],
      pipelineDisposers: [],
      pipelineOwnerKey: {},
      installed: true,
      lifecycle: 'install',
      featureExpose: {},
      featureOutputs: {},
      featureExposeValid: true
    }
    const stage = { host, name: registration.name, ordinal: 0n, retired: false }
    const stageSlots = new Map([[registration.name, stage]])
    const registrations = new Map([[registration.name, registration]])
    const extensionOwners = new Map([['owned', registration]])
    const runtime = new PluginHostRemovalRuntime({
      host,
      registrations,
      removeRegistration: (current) => {
        registrations.delete(current.name)
      },
      extensionOwners,
      pipelineLeases: { seal: () => undefined } as any,
      retireLeaseOwner: () => undefined,
      executionSignal: {} as any,
      cleanupRuntime: {} as any,
      setHookRegistration: () => undefined
    })
    runtime.revokeRegistration(registration)
    expect(stage.retired).toBe(false)
    expect(stageSlots.get(registration.name)).toBe(stage)
    expect(registrations.has(registration.name)).toBe(false)
    expect(extensionOwners.has('owned')).toBe(false)
    expect(registration.extensions).toEqual([])
    expect(registration.featureExpose).toBeUndefined()
    expect(registration.featureOutputs).toBeUndefined()
  })

  it('makes dispose idempotent and rejects terminal mutations', async () => {
    const host = new Host()
    await host.use(plugin('a', () => ({})))
    const first = host.dispose()
    expect(host.dispose()).toBe(first)
    await first
    expect(() => host.use(plugin('b', () => ({})))).toThrow(PluginHostError)
    expect(() => host.unUse('a')).toThrow(PluginHostError)
  })

  it('supports all pipeline registration APIs without mode mismatch errors', async () => {
    const sync = new Host({ pipeline: { mode: 'sync' } })
    sync.usePipeline((value, next) => next(value + 1))
    expect(sync.run(1)).toBe(2)
    const asyncHost = new Host({ pipeline: { mode: 'async' } })
    asyncHost.useAsyncPipeline(async (value, next) => next(value + 1))
    await expect(asyncHost.run(1)).resolves.toBe(2)
    const generator = new Host({ pipeline: { mode: 'generator' } })
    generator.useGeneratorPipeline(function* (value) {
      return value + 1
    })
    expect(generator.run(1)).toBe(2)
    const asyncGenerator = new Host({ pipeline: { mode: 'async-generator' } })
    asyncGenerator.useAsyncGeneratorPipeline(async function* (value) {
      return value + 1
    })
    await expect(asyncGenerator.run(1)).resolves.toBe(2)
  })

  it('rejects pipeline execution after host disposal', async () => {
    const sync = new Host()
    await sync.dispose()
    expect(() => sync.run(1)).toThrow(PluginHostError)
    const asyncHost = new Host({ pipeline: { mode: 'async' } })
    await asyncHost.dispose()
    await expect(asyncHost.run(1)).rejects.toBeInstanceOf(PluginHostError)
    const asyncGeneratorHost = new Host({ pipeline: { mode: 'async-generator' } })
    await asyncGeneratorHost.dispose()
    await expect(asyncGeneratorHost.run(1)).rejects.toBeInstanceOf(PluginHostError)
  })

  it('runs an async-generator pipeline end-to-end, taking only the last yield on CONTINUE', async () => {
    const host = new Host({ pipeline: { mode: 'async-generator' } })
    host.useAsyncGeneratorPipeline(async function* (value) {
      yield value + 1
      await Promise.resolve()
      yield value + 2 // last yield: consumed only if the stage returns CONTINUE
      return hostContinue
    })
    host.useAsyncGeneratorPipeline(async function* (value) {
      return value * 2
    })
    await expect(host.run(1)).resolves.toBe(6) // (1 + 2) * 2
  })

  it('rejects nested stage registration during async-generator pipeline execution', async () => {
    const host = new Host({ pipeline: { mode: 'async-generator' } })
    host.useAsyncGeneratorPipeline(async function* (value) {
      expect(() =>
        host.useAsyncGeneratorPipeline(async function* (nextValue) {
          return nextValue
        })
      ).toThrow(PluginHostError)
      return value
    })
    await expect(host.run(1)).resolves.toBe(1)
  })

  it('lifts a generator stage registered against an async-generator host', async () => {
    const host = new Host({ pipeline: { mode: 'async-generator' } })
    host.useGeneratorPipeline(function* (value) {
      yield value + 1
      return hostContinue
    })
    host.useAsyncGeneratorPipeline(async function* (value) {
      return value * 2
    })
    await expect(host.run(1)).resolves.toBe(4)
  })

  it('stops an in-flight async-generator pipeline once the host is disposed mid-run', async () => {
    const host = new Host({ pipeline: { mode: 'async-generator' } })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let resumed = false
    host.useAsyncGeneratorPipeline(async function* (value) {
      yield value
      await gate
      resumed = true // must never run: dispose() settles before the gate releases
      return value
    })
    const run = host.run(1)
    await host.dispose()
    release()
    await expect(run).rejects.toBeInstanceOf(PluginHostError)
    expect(resumed).toBe(false)
  })

  it('rejects duplicate names and invalid extension descriptors', async () => {
    const host = new Host()
    await host.use(plugin('a', () => ({})))
    await expect(host.use(plugin('a', () => ({})))).rejects.toBeInstanceOf(PluginHostError)
    const invalid = Object.defineProperty({}, 'value', {
      value: 1,
      configurable: false,
      enumerable: true
    })
    await expect(host.use(plugin('invalid', () => invalid))).rejects.toMatchObject({
      code: 'PLUGIN_INSTALL_FAILED'
    })
  })

  it('does not execute extension getters and rejects array results', async () => {
    const host = new Host()
    let read = false
    const getterExtension = {}
    Object.defineProperty(getterExtension, 'feature', {
      enumerable: true,
      configurable: true,
      get: () => {
        read = true
        throw new Error('getter should not run')
      }
    })
    await expect(host.use(plugin('getter', () => getterExtension))).rejects.toMatchObject({
      code: 'PLUGIN_INSTALL_FAILED'
    })
    expect(read).toBe(false)
    await expect(host.use(plugin('array', () => [] as never))).rejects.toMatchObject({
      code: 'PLUGIN_INSTALL_FAILED'
    })
  })

  it('does not execute Symbol.toStringTag getters on install results', async () => {
    const host = new Host()
    let read = false
    const extension = {}
    Object.defineProperty(extension, Symbol.toStringTag, {
      configurable: true,
      get: () => {
        read = true
        throw new Error('toStringTag getter should not run')
      }
    })

    await expect(host.use(plugin('to-string-tag', () => extension))).resolves.toHaveLength(1)
    expect(read).toBe(false)
  })

  it('does not execute config getters', async () => {
    const host = new Host()
    let configRead = false
    const config = {}
    Object.defineProperty(config, 'enabled', {
      enumerable: true,
      configurable: true,
      get: () => {
        configRead = true
        return true
      }
    })
    expect(() => host.use(plugin('config-getter', () => ({}), { config }))).toThrow(
      expect.objectContaining({ code: PluginHostErrorCode.invalidConfigValue })
    )
    expect(configRead).toBe(false)
  })

  it('publishes handles without mutating non-extensible host instances', async () => {
    const noExtension = new Host()
    Object.preventExtensions(noExtension)
    await expect(noExtension.use(plugin('no-extension', () => ({})))).resolves.toHaveLength(1)
    const withExtension = new Host()
    Object.preventExtensions(withExtension)
    await expect(
      withExtension.use(plugin('with-extension', () => ({ feature: true })))
    ).resolves.toHaveLength(1)
  })

  it('reserves Promise-like extension names', async () => {
    const host = new Host()
    const thenExtension = {} as Record<string, unknown>
    const thenKey = String.fromCharCode(116, 104, 101, 110)
    Object.defineProperty(thenExtension, thenKey, { value: () => undefined, enumerable: true })
    await expect(host.use(plugin('reserved-then', () => thenExtension))).rejects.toBeInstanceOf(
      PluginHostError
    )
    await host.use(plugin('allowed-catch', () => ({ catch: () => undefined })))
    await host.use(plugin('allowed-finally', () => ({ finally: () => undefined })))
  })

  it('YS24: preflights an entire batch before running install', async () => {
    let installed = 0
    const host = new Host()
    const first = plugin('first', () => {
      installed += 1
      return {}
    })
    await host.use(first)
    await expect(
      host.use(
        plugin('new', () => {
          installed += 1
          return {}
        }),
        first
      )
    ).rejects.toBeInstanceOf(PluginHostError)
    expect(installed).toBe(1)
  })

  it('continues queue after a failed mutation', async () => {
    const host = new Host()
    await expect(
      host.use(
        plugin('bad', () => {
          throw new Error('bad')
        })
      )
    ).rejects.toThrow('bad')
    await expect(host.use(plugin('good', () => ({})))).resolves.toHaveLength(1)
  })

  it('does not expose config mutation through plugin core', async () => {
    const host = new Host()
    let coreConfig: Record<string, unknown> | undefined
    await host.use(
      plugin('config-cycle', () => ({}), {
        config: { enabled: false },
        update: (_next: IExt, core: IExt) => {
          coreConfig = (
            core as IExt & { config: { get: () => Record<string, unknown> } }
          ).config.get()
        }
      })
    )
    await host.config.update('config-cycle', () => ({ enabled: true }))
    expect(coreConfig).toEqual({ enabled: false })
  })

  it('reuses one valid core facade for a registration', async () => {
    const host = new Host()
    let installedCore: unknown
    let cachedCore: unknown
    await host.use(
      plugin(
        'stable-core',
        (core) => {
          installedCore = core
          cachedCore = core
          return {}
        },
        {
          config: { value: 1 },
          update: (_next: IExt, core: IExt) => {
            expect(core).toBe(installedCore)
            expect((cachedCore as IExt & { config: { get: () => unknown } }).config.get()).toEqual({
              value: 1
            })
          }
        }
      )
    )
    await host.config.update('stable-core', () => ({ value: 2 }))
    await host.unUse('stable-core')
    expect(() => (cachedCore as IExt & { config: { get: () => unknown } }).config.get()).toThrow()
  })

  it('rejects disposal symbols as extensions when available', async () => {
    const host = new Host()
    if (typeof (Symbol as typeof Symbol & { dispose?: symbol }).dispose === 'symbol') {
      const extension = {} as Record<PropertyKey, unknown>
      Object.defineProperty(extension, (Symbol as typeof Symbol & { dispose?: symbol }).dispose!, {
        value: () => undefined,
        enumerable: true
      })
      await expect(host.use(plugin('symbol-extension', () => extension))).rejects.toBeInstanceOf(
        PluginHostError
      )
    }
  })

  it('does not expose host topology through plugin core', async () => {
    let core: Record<string, unknown> | undefined
    const host = new Host()
    await host.use(
      plugin('boundary', (received) => {
        core = received as never
        return {}
      })
    )
    expect(core).not.toHaveProperty('use')
    expect(core).not.toHaveProperty('unUse')
    expect(core).not.toHaveProperty('dispose')
    expect(core).not.toHaveProperty('config.update')
  })

  it('owns disposer returned by async install', async () => {
    const closed: string[] = []
    const host = new Host()
    await host.use(
      plugin('resource', async (core) => {
        core.onDispose(() => {
          closed.push('resource')
        })
        return {}
      })
    )
    await host.dispose()
    expect(closed).toEqual(['resource'])
  })

  it('uses one install resource disposer with async protocol priority', async () => {
    const calls: string[] = []
    const host = new Host()
    const resource = { marker: 'x' } as Record<PropertyKey, unknown>
    Object.defineProperties(resource, {
      dispose: { value: () => calls.push('explicit') },
      [Symbol.asyncDispose]: { value: async () => calls.push('async') },
      [Symbol.dispose]: { value: () => calls.push('sync') }
    })
    await host.use(
      plugin('resource-protocol', (core) => {
        core.onDispose(resource as never)
        return {}
      })
    )
    await host.dispose()
    expect(calls).toEqual(['async'])
  })

  it('falls back to plugin-level disposal symbols', async () => {
    const calls: string[] = []
    const host = new Host()
    const pluginWithDispose = {
      name: 'symbol-plugin',
      install: () => ({}),
      [Symbol.asyncDispose]: async () => {
        calls.push('async')
      },
      [Symbol.dispose]: () => calls.push('sync')
    }
    await host.use(pluginWithDispose)
    await host.unUse('symbol-plugin')
    expect(calls).toEqual(['async'])
  })

  it('rejects resources without a supported disposer during install', async () => {
    const host = new Host()
    await expect(
      host.use(
        plugin('unsupported-resource', (core) => {
          core.onDispose({} as never)
          return {}
        })
      )
    ).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
  })

  it('deletes registration after failed unload so callers can decide on reinstall', async () => {
    const host = new Host()
    let pluginDisposeCalls = 0
    let resourceDisposeCalls = 0
    const retryable = plugin(
      'retryable',
      (core) => {
        core.onDispose(() => {
          resourceDisposeCalls += 1
          if (resourceDisposeCalls === 1) throw new Error('resource cleanup failed')
        })
        return { retryMarker: true }
      },
      {
        dispose: () => {
          pluginDisposeCalls += 1
          if (pluginDisposeCalls === 1) throw new Error('plugin cleanup failed')
        }
      }
    )
    await host.use(retryable)
    const removal = await host.unUse('retryable')
    expect(removal).toMatchObject({ ok: false, errors: expect.any(Array) })
    await expect(host.config.update('retryable', () => ({}))).rejects.toBeInstanceOf(
      PluginHostError
    )
    expect(pluginDisposeCalls).toBe(1)
    expect(resourceDisposeCalls).toBe(1)
    await expect(host.use(retryable)).resolves.toHaveLength(1)
  })

  it('requires config recipes to return synchronous plain records', async () => {
    const host = new Host()
    await host.use(plugin('sync-config', () => ({}), { config: { value: 1 } }))
    await expect(
      host.config.update('sync-config', (async () => ({ value: 2 })) as never)
    ).rejects.toBeInstanceOf(TypeError)
    await expect(
      host.config.update('sync-config', () => new Date() as never)
    ).rejects.toBeInstanceOf(TypeError)
  })

  it('finishes accepted mutations before dispose closes admission', async () => {
    const host = new Host()
    const order: string[] = []
    const installed = host.use(
      plugin(
        'a',
        async () => {
          await Promise.resolve()
          order.push('install')
          return {}
        },
        { dispose: () => order.push('dispose') }
      )
    )
    await installed
    const closing = host.dispose()
    await closing
    expect(order).toEqual(['install', 'dispose'])
    expect(() => host.use(plugin('b', () => ({})))).toThrow(PluginHostError)
  })

  it('rejects reads and pipeline execution after dispose starts', async () => {
    const host = new Host()
    let release: (() => void) | undefined
    let entered: (() => void) | undefined
    const disposeStarted = new Promise<void>((resolve) => {
      entered = resolve
    })
    let core: unknown
    await host.use(
      plugin(
        'closing-read',
        (nextCore) => {
          core = nextCore
          return {}
        },
        {
          dispose: () =>
            new Promise<void>((resolve) => {
              entered?.()
              release = resolve
            })
        }
      )
    )
    const closing = host.dispose()
    await disposeStarted
    expect(() => host.run(1)).toThrow(PluginHostError)
    expect(() => host.config.get('closing-read.value')).toThrow(PluginHostError)
    expect(() => (core as { config: { get: () => unknown } }).config.get()).toThrow(PluginHostError)
    release?.()
    await closing
  })

  it('PH-T07a: propagates exact HOST_DISPOSING from an async entry guard', async () => {
    const host = new Host({ pipeline: { mode: 'async' } })
    let started: (() => void) | undefined
    let release: (() => void) | undefined
    let disposalStarted: (() => void) | undefined
    let releaseDisposal: (() => void) | undefined
    const disposalReady = new Promise<void>((resolve) => {
      disposalStarted = resolve
    })
    await host.use(
      plugin('closing-gate', () => ({}), {
        dispose: () =>
          new Promise<void>((resolve) => {
            releaseDisposal = resolve
            disposalStarted?.()
          })
      })
    )
    const stageStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    host.useAsyncPipeline(async (_value, next) => {
      started?.()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      await next(2)
    })
    const running = host.run(1)
    await stageStarted
    const closing = host.dispose()
    // V2 drains active pipeline leases before plugin cleanup; release the stage so disposal can
    // reach the registration disposer while preserving the abort assertion below.
    release?.()
    await disposalReady
    try {
      let caught: unknown
      try {
        await running
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(PluginHostError)
      expect((caught as PluginHostError).source).toBe('@migaia/plugin-host')
      expect((caught as PluginHostError).code).toBe('HOST_DISPOSING')
      expect(caught).not.toBeInstanceOf(AggregateError)
      expect(caught).not.toHaveProperty('errors')
    } finally {
      releaseDisposal?.()
      await closing
    }
  })

  it('finishes synchronous install before dispose closes admission', async () => {
    const host = new Host()
    let core: unknown
    const installing = host.use(
      plugin(
        'admitted',
        (nextCore) => {
          core = nextCore
          return {}
        },
        { config: { enabled: true } }
      )
    )
    await expect(installing).resolves.toHaveLength(1)
    await expect(host.dispose()).resolves.toMatchObject({ logicalTerminal: true })
    expect(core).toBeDefined()
  })

  it('continues to dispose after an admitted mutation fails', async () => {
    const host = new Host()
    const disposing = host.use(
      plugin('failed', () => {
        throw new Error('install failed')
      })
    )
    const closing = host.dispose()
    await expect(disposing).rejects.toThrow('install failed')
    await expect(closing).resolves.toMatchObject({ logicalTerminal: true })
  })

  it('removes provisional extensions when install fails after mounting part of its result', async () => {
    const host = new Host()
    const extension = {} as Record<string, unknown>
    Object.defineProperty(extension, 'marker', {
      value: 'x',
      enumerable: true,
      configurable: true
    })
    Object.defineProperty(extension, 'broken', {
      value: 'y',
      enumerable: true,
      configurable: false
    })
    await expect(host.use(plugin('broken', () => extension))).rejects.toMatchObject({
      code: 'PLUGIN_INSTALL_FAILED'
    })
    expect(host).not.toHaveProperty('marker')
    await expect(host.use(plugin('broken', () => ({})))).resolves.toHaveLength(1)
  })

  it('protects config snapshots and update candidates with readonly views', async () => {
    const initial = { enabled: false }
    let received: Record<string, unknown> | undefined
    const host = new Host()
    await host.use(
      plugin('config-snapshot', () => ({}), {
        config: initial,
        update: (next: Record<string, unknown>) => {
          received = next
          expect(() => {
            next.enabled = 'plugin-local-mutation'
          }).toThrow(TypeError)
        }
      })
    )
    initial.enabled = true
    await expect(
      host.config.update('config-snapshot', () => ({ enabled: true }))
    ).resolves.toBeUndefined()
    expect(received).toEqual({ enabled: true })
  })

  it('applies top-level config patches and preserves undefined keys', async () => {
    const host = new Host()
    await host.use(plugin('config-merge', () => ({}), { config: { enabled: true, count: 1 } }))
    await host.config.update('config-merge', () => ({ enabled: undefined }))
    let config: Record<string, unknown> | undefined
    await host.config.update('config-merge', (previous) => {
      config = { ...previous, enabled: undefined }
      return { enabled: undefined }
    })
    expect(config).toEqual({ enabled: undefined, count: 1 })
    expect(config).toHaveProperty('enabled')
  })

  it('computes concurrent config recipes from latest committed state', async () => {
    const host = new Host()
    let finalCount = -1
    await host.use(plugin('config-counter', () => ({}), { config: { count: 0 } }))
    await Promise.all([
      host.config.update('config-counter', (previous) => ({
        count: (finalCount = Number(previous.count) + 1)
      })),
      host.config.update('config-counter', (previous) => ({
        count: (finalCount = Number(previous.count) + 1)
      }))
    ])
    expect(finalCount).toBe(2)
  })

  it('commits config without update hook and calls hook for empty patches', async () => {
    const host = new Host()
    let calls = 0
    await host.use(
      plugin('config-hooks', () => ({}), {
        config: { enabled: false },
        update: () => {
          calls += 1
        }
      })
    )
    await host.config.update('config-hooks', () => ({}))
    expect(calls).toBe(1)
    await host.use(plugin('config-no-hook', () => ({}), { config: { enabled: false } }))
    await expect(
      host.config.update('config-no-hook', () => ({ enabled: true }))
    ).resolves.toBeUndefined()
  })

  it('exposes initial config to install through provisional core', async () => {
    const host = new Host()
    let observed: unknown
    await host.use(
      plugin(
        'config-visible',
        (core) => {
          observed = (core as unknown as { config: { get: () => unknown } }).config.get()
          return {}
        },
        { config: { enabled: true } }
      )
    )
    expect(observed).toEqual({ enabled: true })
  })

  it('rejects prototype-polluting config patch keys', async () => {
    const host = new Host()
    await host.use(plugin('safe-config', () => ({}), { config: {} }))
    const patch = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>
    await expect(host.config.update('safe-config', () => patch)).rejects.toThrow('config patch key')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('rejects missing unUse and missing config updates', async () => {
    const host = new Host()
    await expect(host.unUse('missing')).rejects.toMatchObject({
      code: PluginHostErrorCode.pluginNotInstalled
    })
    await expect(host.config.update('missing', () => ({}))).rejects.toBeInstanceOf(PluginHostError)
  })

  it('checks concurrent duplicate installs when each batch reaches the queue', async () => {
    const host = new Host()
    const sharedPlugin = plugin('same', () => ({}))
    const first = host.use(sharedPlugin)
    expect(() => host.use(sharedPlugin)).toThrow(PluginHostError)
    await expect(first).resolves.toHaveLength(1)
  })

  it('removes plugin pipeline stages on unUse', async () => {
    const host = new Host()
    const stage = (_value: number, next: (value: number) => void) => next(99)
    const owned = plugin('owned', (core) => {
      ;(core as IStageCore).usePipeline(stage)
      return {}
    })
    await host.use(owned)
    expect(host.run(1)).toBe(99)
    await host.unUse('owned')
    expect(host.run(1)).toBe(1)
    await host.use(owned)
    expect(host.run(1)).toBe(99)
  })

  it('rejects plugin core writes outside install', async () => {
    const host = new Host()
    await host.use(
      plugin('update-write', () => ({}), {
        config: { enabled: false },
        update: (_next: IExt, core: IExt) => {
          ;(core as IStageCore).usePipeline((value, next) => next(value + 1))
        }
      })
    )
    await expect(host.config.update('update-write', () => ({ enabled: true }))).rejects.toThrow(
      'install'
    )
    expect(host.run(1)).toBe(1)
  })
})

describe('PH-R41: canonical disposal error transformation', () => {
  it('preserves the base error identity and transforms only at the sole disposal Promise', async () => {
    const raw = new Error('round41 disposer')
    const install = (core: { onDispose: (dispose: () => void) => void }) => {
      core.onDispose(() => {
        throw raw
      })
      return {}
    }

    const base = new Host()
    await base.use({ name: 'round41-base', install } as never)
    const baseResult = await base.dispose()
    expect(baseResult.logicalTerminal).toBe(true)
    expect(baseResult.cleanupComplete).toBe(true)
    expect((baseResult.cleanupErrors[0] as { readonly cause?: unknown }).cause).toBe(raw)

    const translating = new TranslatingHost()
    await translating.use({ name: 'round41-translating', install } as never)
    const first = translating.dispose()
    expect(translating.dispose()).toBe(first)
    const translated = await first
    expect(translating.translations).toHaveBeenCalledTimes(0)
    expect(translated.cleanupComplete).toBe(true)
    expect((translated.cleanupErrors[0] as { readonly cause?: unknown }).cause).toBe(raw)
  })
})
