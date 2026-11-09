import { describe, expect, it } from 'vitest'
import { PluginHost } from '../src/index.ts'
import {
  defineModule,
  type IHostModuleDefinition,
  type IHostModule
} from '../src/module-runtime.ts'
import { featuresModule } from '../src/modules/features/index.ts'
import { featureDependenciesModule } from '../src/modules/feature-dependencies/index.ts'

/** Genuine internal module behavior records construction and disposal without a replacement host. */
class ModuleProbe {
  /** Ordered callbacks belong to the test's actual host construction. */
  readonly trace: string[]
  /** Each probe names one module in the private installation protocol. */
  readonly key: string
  /** A failing installation is supplied explicitly by the scenario. */
  readonly failure?: Error
  /** A cleanup failure must remain secondary to the installation error. */
  readonly cleanupFailure?: Error
  /** Captures the scenario's trace and original failure instances. */
  constructor(trace: string[], key: string, failure?: Error, cleanupFailure?: Error) {
    this.trace = trace
    this.key = key
    this.failure = failure
    this.cleanupFailure = cleanupFailure
  }
  /** Produces the complete definition used for both the genuine and copied identity. */
  definition(): IHostModuleDefinition {
    return { key: this.key, requires: [featuresModule.key], install: () => this.install() }
  }
  /** Records installation and returns a real runtime disposer. */
  install(): Readonly<{ dispose(): void }> {
    this.trace.push(`install:${this.key}`)
    if (this.failure) throw this.failure
    return { dispose: () => this.dispose() }
  }
  /** Records rollback and exposes the exact cleanup error requested by the case. */
  dispose(): void {
    this.trace.push(`dispose:${this.key}`)
    if (this.cleanupFailure) throw this.cleanupFailure
  }
}
/** Invalid identities and absent prerequisites are rejected during construction. */
function invalidModules(): void {
  expect(() => new PluginHost({ modules: null as never })).toThrowError(
    expect.objectContaining({ source: 'plugin.host', code: 'INVALID_HOST_MODULE' })
  )
  expect(() => new PluginHost({ modules: {} as never })).toThrowError(
    expect.objectContaining({ source: 'plugin.host', code: 'INVALID_HOST_MODULE' })
  )
  expect(() => new PluginHost({ modules: [{} as IHostModule] })).toThrowError(
    expect.objectContaining({ source: 'plugin.host', code: 'INVALID_HOST_MODULE' })
  )
  expect(() => new PluginHost({ modules: [featuresModule, featuresModule] })).toThrowError(
    expect.objectContaining({ source: 'plugin.host', code: 'DUPLICATE_HOST_MODULE' })
  )
  expect(() => new PluginHost({ modules: [featureDependenciesModule] })).toThrowError(
    expect.objectContaining({ source: 'plugin.host', code: 'HOST_MODULE_MISSING' })
  )
}
/** A structurally complete copy cannot acquire the private module identity. */
async function copiedIdentity(): Promise<void> {
  /** The timeline observes real module acquisition and cleanup order. */
  const trace: string[] = []
  /** This complete definition has real prerequisite and runtime behavior. */
  const probe = new ModuleProbe(trace, 'authentic')
  /** The same complete fields back both the positive and structural-copy cases. */
  const definition = probe.definition()
  /** Only the internal authority can mint an admitted module identity. */
  const genuine = defineModule(definition)
  /** Freezing all valid fields cannot replace private identity registration. */
  const copy = Object.freeze({ ...definition })
  expect(
    () => new PluginHost({ modules: [featuresModule, copy as unknown as IHostModule] })
  ).toThrowError(expect.objectContaining({ code: 'INVALID_HOST_MODULE' }))
  expect(trace).toEqual([])
  /** The positive counterpart installs and disposes through the actual Host owner. */
  const host = new PluginHost({ modules: [featuresModule, genuine] })
  expect(trace).toEqual(['install:authentic'])
  await host.dispose()
  expect(trace).toEqual(['install:authentic', 'dispose:authentic'])
}
/** Failed construction releases successful modules in reverse order with primary identity intact. */
function rollback(): void {
  /** The timeline observes real module acquisition and cleanup order. */
  const trace: string[] = []
  /** This exact construction failure must remain the first aggregate member. */
  const primary = new Error('module installation fixture')
  /** A secondary release failure must not displace the construction failure. */
  const cleanup = new Error('module cleanup fixture')
  /** The earliest successful module owns the deliberately failing cleanup. */
  const first = new ModuleProbe(trace, 'first', undefined, cleanup)
  /** A second successful module makes reverse cleanup order observable. */
  const second = new ModuleProbe(trace, 'second')
  /** The final module throws after its install callback becomes observable. */
  const third = new ModuleProbe(trace, 'third', primary)
  /** Retain the thrown aggregate for native class, code and identity assertions. */
  let observed: unknown
  try {
    new PluginHost({
      modules: [
        featuresModule,
        defineModule(first.definition()),
        defineModule(second.definition()),
        defineModule(third.definition())
      ]
    })
  } catch (error) {
    observed = error
  }
  expect(trace).toEqual([
    'install:first',
    'install:second',
    'install:third',
    'dispose:second',
    'dispose:first'
  ])
  expect(observed).toBeInstanceOf(AggregateError)
  expect((observed as AggregateError).errors).toEqual([primary, cleanup])
  expect((observed as AggregateError).errors[0]).toBe(primary)
  expect(observed).toMatchObject({ source: 'plugin.host', code: 'CALLBACK_FAILED' })
}
/** Registers native module construction cases without nested callback factories. */
function cases(): void {
  it('rejects invalid, duplicate and prerequisite-free module selections', invalidModules)
  it('rejects a full frozen definition copy before its install callback', copiedIdentity)
  it('rolls back successful modules in reverse order and retains original failures', rollback)
}
describe('native host modules', cases)
