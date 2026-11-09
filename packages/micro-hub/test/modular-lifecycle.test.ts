import { walkErrorCauses } from '@migaia/utils/error'
import { describe, expect, it } from 'vitest'
import { definePlugin, type IPluginHostCore } from '@migaia/plugin-host'
import { defineFeature } from '@migaia/plugin-host/features'
import { createMicroHub, defineContract, MicroCapability, type IMicroPlugin } from '../src/index.ts'
import { state } from '../src/state/index.ts'
import { capabilityExtensionKey } from '../src/text.ts'

/** Genuine capability plugins expose counted native acquisition and cleanup callbacks. */
class CapabilityProbe implements IMicroPlugin {
  /** Public kind participates in the hub's prerequisite admission. */
  readonly kind: MicroCapability
  /** This fixture's independent plugins have no capability prerequisites. */
  readonly requires = []
  /** Ordering observations belong to the concrete acquired plugins. */
  readonly events: string[]
  /** Optional primary failure occurs after actual native cleanup registration. */
  readonly failure: Error | undefined
  /** Binding precedes native installation and is counted separately. */
  bindings = 0
  /** Actual native installations, never inferred from metadata. */
  installs = 0
  /** Cleanup must remain once across rollback and final disposal. */
  disposals = 0
  /** Capture one public capability definition and its observation owner. */
  constructor(kind: MicroCapability, events: string[], failure?: Error) {
    this.kind = kind
    this.events = events
    this.failure = failure
  }
  /** Public capability binding creates a genuine native definition. */
  bind() {
    this.bindings += 1
    return definePlugin({ name: this.kind, install: (core) => this.install(core) })
  }
  /** Acquire cleanup before the selected original failure or driver publication. */
  install(core: Pick<IPluginHostCore, 'onDispose'>) {
    this.installs += 1
    this.events.push(`install:${this.kind}`)
    core.onDispose(() => this.dispose())
    if (this.failure) throw this.failure
    return { [capabilityExtensionKey(this.kind)]: { kind: this.kind, view: emptyView } }
  }
  /** Genuine native rollback calls this exact registered cleanup. */
  dispose(): void {
    this.disposals += 1
    this.events.push(`dispose:${this.kind}`)
  }
}
/** Empty driver output is valid for a capability whose contract is unused in rollback cases. */
function emptyView() {
  return {}
}

/** Count user business callbacks behind the canonical state adapter's revocation checks. */
class CommandProbe {
  /** Only successfully admitted business mutations increment this count. */
  calls = 0
  /** One command returns a real state patch through the original state driver. */
  increment(current: { count: number }) {
    this.calls += 1
    return { count: current.count + 1 }
  }
}
/** Partial initialization rolls back both actual capability registrations in reverse order. */
async function partialInstallRollback(): Promise<void> {
  /** Trace observes acquisition and release independently from the expected thrown error. */
  const events: string[] = []
  /** Primary identity must survive the native install boundary. */
  const original = new Error('second capability failed')
  /** Two different real capability kinds pass public prerequisite admission. */
  const first = new CapabilityProbe(MicroCapability.state, events),
    second = new CapabilityProbe(MicroCapability.events, events, original)
  let failure: unknown
  try {
    createMicroHub({ plugins: [first, second] })
  } catch (error) {
    failure = error
    recordMatrixFailure(error)
  }
  expect(failure).toMatchObject({
    source: 'plugin.host',
    code: 'PLUGIN_INSTALL_FAILED',
    cause: original
  })
  await (failure as { detail: { completion: Promise<unknown> } }).detail.completion
  expect(events).toEqual(['install:state', 'install:events', 'dispose:events', 'dispose:state'])
  expect([
    first.bindings,
    second.bindings,
    first.installs,
    second.installs,
    first.disposals,
    second.disposals
  ]).toEqual([1, 1, 1, 1, 1, 1])
  /** Failed creation must not retain singleton authority. */
  const retry = createMicroHub({ plugins: [] })
  await retry.dispose()
}
/** The existing late app-use seam exercises the real hub after an earlier app already ran. */
async function lateContractUse(): Promise<void> {
  /** Business callback effects are independent of connection and view construction. */
  const probe = new CommandProbe()
  /** Native state driver owns all mutation and view semantics. */
  const hub = createMicroHub({ plugins: [state()] })
  /** One canonical contract is reused by both actual connected apps. */
  const contract = defineContract('late-counter', {
    version: 1,
    writers: ['late'],
    state: { count: 0 },
    commands: { increment: (current) => probe.increment(current) }
  })
  try {
    /** Initial owner executes before the late consumer connects. */
    const owner = hub.connect('first').own(contract)
    owner.commands.increment()
    /** A late app uses the existing public seam; no native plugin-use API is fabricated. */
    const late = hub.connect('late').use(contract)
    late.commands.increment()
    expect(probe.calls).toBe(2)
    expect(late.state.count.get()).toBe(2)
  } finally {
    await hub.dispose()
  }
}
/** Canonical state callables retain the app lifetime after a view is saved. */
async function staleContractCalls(): Promise<void> {
  /** This callback must not execute after native app removal. */
  const probe = new CommandProbe()
  /** The public driver supplies genuine guarded views. */
  const hub = createMicroHub({ plugins: [state()] })
  /** App ownership and command semantics come from the original public contract. */
  const contract = defineContract('stale-counter', {
    version: 1,
    state: { count: 0 },
    commands: { increment: (current) => probe.increment(current) }
  })
  try {
    /** Saved app is the actual public lifetime handle. */
    const app = hub.connect('removed')
    /** Saved view and detached callable must retain that same lifetime guard. */
    const view = app.own(contract)
    /** Detached public command is captured before removal. */
    const saved = view.commands.increment
    saved()
    await app.disconnect()
    expect(() => {
      try {
        return saved()
      } catch (error) {
        recordMatrixFailure(error)
        throw error
      }
    }).toThrowError(expect.objectContaining({ code: 'APP_DISCONNECTED' }))
    expect(() => {
      try {
        return app.use(contract)
      } catch (error) {
        recordMatrixFailure(error)
        throw error
      }
    }).toThrowError(expect.objectContaining({ code: 'APP_DISCONNECTED' }))
    expect(probe.calls).toBe(1)
  } finally {
    await hub.dispose()
  }
}
/** Missing native modules reject genuine dependency declarations before any acquisition callback. */
function missingDependencyModule(): void {
  /** Counters distinguish public binding from native setup/install/factory callbacks. */
  const counts = { setup: 0, install: 0, factory: 0, binding: 0 }
  /** Exact native provider identity supplies the dependency token. */
  const provider = definePlugin({
    name: 'provider',
    features: {
      value: defineFeature(() => {
        counts.factory += 1
        return { value: 1 }
      })
    },
    install: () => {
      counts.install += 1
      return {}
    }
  })
  /** The public capability binding returns genuine native definitions, not a token-shaped object. */
  const capability: IMicroPlugin = {
    kind: MicroCapability.state,
    requires: [],
    bind() {
      counts.binding += 1
      return definePlugin({
        name: 'dependent',
        features: {
          value: defineFeature(
            () => {
              counts.factory += 1
              return { value: 2 }
            },
            { previous: provider.getFeature('value') }
          )
        },
        install: () => {
          counts.install += 1
          return {}
        }
      })
    }
  }
  expect(() => {
    try {
      return createMicroHub({ plugins: [capability] })
    } catch (error) {
      recordMatrixFailure(error)
      throw error
    }
  }).toThrowError(expect.objectContaining({ code: 'HOST_MODULE_MISSING' }))
  expect(counts).toEqual({ setup: 0, install: 0, factory: 0, binding: 1 })
}
/** Register named cases without a closure-based test component. */
function registerLifecycleCases(): void {
  it('rolls back partial capability installation in reverse order', partialInstallRollback)
  it('supports late contract use after earlier business work', lateContractUse)
  it('rejects stale app handles and detached commands without business effects', staleContractCalls)
  it(
    'rejects native dependency declarations before setup, install and factories',
    missingDependencyModule
  )
}
describe('micro hub modular lifecycle', registerLifecycleCases)

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
