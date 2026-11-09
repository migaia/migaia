import { walkErrorCauses } from '@migaia/utils/error'
import { describe, expect, it } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import { definePlugin, type IPluginHostCore } from '@migaia/plugin-host'
import { defineFeature } from '@migaia/plugin-host/features'
import { createStoreMiddlewareHost } from '../src/index.ts'

/** Real callbacks retain their own counters; no fabricated core or lifecycle is supplied. */
class InstallProbe {
  /** Native callback ordering survives failed-batch rollback. */
  readonly events: string[]
  /** Fixture name distinguishes the actual installed owners. */
  readonly name: string
  /** Only the selected install fails, after registering its genuine cleanup. */
  readonly failure: Error | undefined
  /** Setup must not run before missing-module admission. */
  setups = 0
  /** Install must not run before missing-module admission. */
  installs = 0
  /** Factories must not run before missing-module admission. */
  factories = 0
  /** Guarded callable invocations must stop at logical removal. */
  reads = 0
  /** Cleanup remains exactly once across rollback/removal and final host disposal. */
  disposals = 0
  /** Capture independent fixture counters and an optional original failure. */
  constructor(name: string, events: string[], failure?: Error) {
    this.name = name
    this.events = events
    this.failure = failure
  }
  /** Native setup is counted independently of install and Feature construction. */
  setup(): void {
    this.setups += 1
  }
  /** Register actual native cleanup before returning or failing. */
  install(core: Pick<IPluginHostCore, 'onDispose'>) {
    this.installs += 1
    this.events.push(`install:${this.name}`)
    core.onDispose(() => this.dispose())
    if (this.failure) throw this.failure
    return { read: () => this.read() }
  }
  /** A real native Feature output, never a token-shaped stand-in. */
  factory() {
    this.factories += 1
    return { value: 1 }
  }
  /** Count business effects separately from rejected stale invocations. */
  read(): number {
    this.reads += 1
    return this.reads
  }
  /** The original native owner decides when this cleanup runs. */
  dispose(): void {
    this.disposals += 1
    this.events.push(`dispose:${this.name}`)
  }
}
/** Borrow an actual Runtime and state accessor through the public middleware constructor. */
function createHost() {
  return createStoreMiddlewareHost({
    runtime: createRuntime(),
    getState: readState,
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
}
/** Domain state is independent of callback-count observations. */
function readState() {
  return { value: 0 }
}
/** Concrete business result proves the public middleware host has already executed work. */
function business() {
  return 7
}
/** Assemble original callbacks without wrapping or replacing native Feature identities. */
function plugin(probe: InstallProbe) {
  return definePlugin({
    name: probe.name,
    setup: () => probe.setup(),
    install: (core) => probe.install(core)
  })
}

describe('middleware host modular lifecycle', registerLifecycleCases)

/** Exercise rolls back a partial public batch in reverse acquired order. */
async function verifyPartialRollback() {
  /** Shared timeline observes the two real installation owners. */
  const events: string[] = []
  /** Exact primary failure must remain reachable through the native boundary. */
  const original = new Error('second install failed')
  /** Both registrations acquire cleanup before the second fails. */
  const first = new InstallProbe('first', events),
    second = new InstallProbe('second', events, original)
  /** Public domain constructor selects its fixed synchronous module. */
  const host = createHost()
  try {
    await expect(
      host.use(plugin(first), plugin(second)).catch(recordMatrixRejection)
    ).rejects.toMatchObject({
      source: 'plugin.host',
      code: 'PLUGIN_INSTALL_FAILED',
      cause: original
    })
    expect(events).toEqual(['install:first', 'install:second', 'dispose:second', 'dispose:first'])
    expect([first.setups, second.setups, first.installs, second.installs]).toEqual([1, 1, 1, 1])
  } finally {
    await host.dispose()
  }
  expect([first.disposals, second.disposals]).toEqual([1, 1])
}

/** Exercise admits late use after a real action and preserves its callable. */
async function verifyLateUse() {
  /** Late installation observes a host that already ran its business entry. */
  const host = createHost()
  /** Counter owns the exact callbacks passed to native admission. */
  const probe = new InstallProbe('late', [])
  try {
    expect(host.runAction('before', business)).toBe(7)
    /** Returned handle belongs to the actual domain host's native use call. */
    const [handle] = await host.use(plugin(probe))
    expect(handle.extensions.read()).toBe(1)
    expect([probe.setups, probe.installs, probe.reads]).toEqual([1, 1, 1])
  } finally {
    await host.dispose()
  }
  expect(probe.disposals).toBe(1)
}

/** Exercise rejects stale handle and saved callable before repeating business effects. */
async function verifyStaleReferences() {
  /** Native handle owns generation revocation. */
  const host = createHost()
  /** Business effects distinguish a rejected stale call from a successful extra invocation. */
  const probe = new InstallProbe('removed', [])
  try {
    /** Save both supported references before removal. */
    const [handle] = await host.use(plugin(probe))
    /** Detached public callable retains the exact original registration guard. */
    const saved = handle.extensions.read
    expect(saved()).toBe(1)
    await host.unUse(probe.name)
    expect(() => {
      try {
        return saved()
      } catch (error) {
        recordMatrixFailure(error)
        throw error
      }
    }).toThrowError(
      expect.objectContaining({ source: 'plugin.host', code: 'REGISTRATION_REVOKED' })
    )
    expect(() => {
      try {
        return handle.extensions.read()
      } catch (error) {
        recordMatrixFailure(error)
        throw error
      }
    }).toThrowError(expect.objectContaining({ code: 'PLUGIN_NOT_INSTALLED' }))
    expect([probe.reads, probe.disposals]).toEqual([1, 1])
  } finally {
    await host.dispose()
  }
  expect(probe.disposals).toBe(1)
}

/** Exercise rejects native dependency declarations before setup, install or factory callbacks. */
async function verifyMissingModules() {
  /** The public middleware host intentionally installs only its synchronous pipeline. */
  const host = createHost()
  /** Independent callback counters prove rejection precedes either registration's acquisition. */
  const first = new InstallProbe('provider', []),
    second = new InstallProbe('dependent', [])
  /** Genuine native provider supplies the dependency token. */
  const provider = definePlugin({
    name: first.name,
    features: { value: defineFeature(() => first.factory()) },
    setup: () => first.setup(),
    install: (core) => first.install(core)
  })
  /** The dependent refers to that exact provider's native token. */
  const dependent = definePlugin({
    name: second.name,
    features: {
      value: defineFeature(() => second.factory(), { previous: provider.getFeature('value') })
    },
    setup: () => second.setup(),
    install: (core) => second.install(core)
  })
  try {
    await expect(
      Promise.resolve()
        .then(() => host.use(provider, dependent))
        .catch(recordMatrixRejection)
    ).rejects.toMatchObject({
      code: 'HOST_MODULE_MISSING'
    })
    expect([
      first.setups,
      second.setups,
      first.installs,
      second.installs,
      first.factories,
      second.factories
    ]).toEqual([0, 0, 0, 0, 0, 0])
  } finally {
    await host.dispose()
  }
}

/** Register named cases without nested callback components. */
function registerLifecycleCases(): void {
  it('rolls back a partial public batch in reverse acquired order', verifyPartialRollback)
  it('admits late use after a real action and preserves its callable', verifyLateUse)
  it(
    'rejects stale handle and saved callable before repeating business effects',
    verifyStaleReferences
  )
  it(
    'rejects native dependency declarations before setup, install or factory callbacks',
    verifyMissingModules
  )
}

/** Expected fixture failures retain complete classification; messages contain only fixture data. */
function recordMatrixFailure(error: unknown): void {
  for (const value of walkErrorCauses(error)) {
    if (value === undefined) continue
    /** Classification observes the original error without replacing it or changing its identity. */
    const failure = value as Error & { source?: string; code?: string; reason?: string }
    console.info(
      JSON.stringify({
        source: failure?.source ?? null,
        code: failure?.code ?? null,
        name: failure?.name ?? typeof value,
        reason: failure?.reason ?? null,
        message: failure?.message ?? String(value)
      })
    )
  }
}
/** Promise rejection logging preserves the exact original rejection for the existing assertion. */
function recordMatrixRejection(error: unknown): never {
  recordMatrixFailure(error)
  throw error
}
