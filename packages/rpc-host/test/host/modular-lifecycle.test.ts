import { describe, expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { defineTransportPlugin, rpcHostPipelines } from '@migaia/rpc-host/sdk'
import { linkPolicy } from '@migaia/rpc-host/plugins/link-policy'
import { timeoutFeature } from '@migaia/rpc-host/features/timeout'
import { defineHost, definePlugin, type IPluginHostCore } from '@migaia/plugin-host'
import { defineFeature, featuresModule } from '@migaia/plugin-host/features'
import { featureDependenciesModule } from '@migaia/plugin-host/feature-dependencies'
import { namedPipelinesModule } from '@migaia/plugin-host/named-pipelines'
import { asyncPipelineModule } from '@migaia/plugin-host/pipeline-modes/async'
import { walkErrorCauses } from '@migaia/utils/error'
import { createManualScheduler } from '@migaia/utils/testing'
import { coreMemoryServer } from './core-fixture.ts'

/** Actual SDK transport acquisition/cleanup callbacks, with no fabricated Session or dispatcher. */
class TransportProbe {
  /** Namespace distinguishes independent real native registrations. */
  readonly name: string
  /** Original callback order is independent of public rejection classification. */
  readonly events: string[]
  /** Optional original failure occurs at actual transport acquisition. */
  readonly failure: Error | undefined
  /** Public transport open calls. */
  opens = 0
  /** Exact returned transport cleanup calls. */
  disposals = 0
  /** Capture one supported empty transport definition. */
  constructor(name: string, events: string[], failure?: Error) {
    this.name = name
    this.events = events
    this.failure = failure
  }
  /** A supported empty transport acquires no wire resource; its cleanup is still native-owned. */
  open() {
    this.opens += 1
    this.events.push(`open:${this.name}`)
    if (this.failure) throw this.failure
    return { dispose: () => this.dispose() }
  }
  /** Native rollback closes each successful acquisition once. */
  dispose(): void {
    this.disposals += 1
    this.events.push(`dispose:${this.name}`)
  }
}
/** One genuine SDK definition retains this probe's original public acquisition callback. */
function transport(probe: TransportProbe) {
  return defineTransportPlugin({
    name: probe.name,
    namespace: probe.name,
    open: () => probe.open()
  })
}
/** Emit full observed expected-failure classification without replacing native error identities. */
function record(error: unknown): void {
  for (const value of walkErrorCauses(error)) {
    if (value === undefined) continue
    /** Fixture messages contain no external data or credentials. */
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
/** Public cold creation rolls back two successful siblings before returning the original failure. */
async function partialRollback(): Promise<void> {
  /** Independent callbacks share only an ordering observation. */
  const events: string[] = []
  /** Exact primary failure must survive every native/RPC cleanup boundary. */
  const original = new Error('third transport failed')
  /** Two successes distinguish reverse rollback from merely calling one disposer. */
  const first = new TransportProbe('first', events),
    second = new TransportProbe('second', events),
    rejected = new TransportProbe('rejected', events, original)
  /** Original public rejection is retained rather than reconstructed. */
  let failure: unknown
  try {
    await createRpcHost({
      self: { name: 'rollback', instanceId: 'rollback' },
      plugins: [transport(first), transport(second), transport(rejected)]
    })
  } catch (error) {
    failure = error
    record(error)
  }
  expect(walkErrorCauses(failure)).toContain(original)
  expect(events).toEqual([
    'open:first',
    'open:second',
    'open:rejected',
    'dispose:second',
    'dispose:first'
  ])
  expect([
    first.opens,
    second.opens,
    rejected.opens,
    first.disposals,
    second.disposals,
    rejected.disposals
  ]).toEqual([1, 1, 1, 1, 1, 0])
}
/** Late policy rejection precedes any sibling transport acquisition and preserves startup output. */
async function latePolicy(): Promise<void> {
  /** Real startup reaches the original SDK transport open callback. */
  const started = new TransportProbe('started', []),
    late = new TransportProbe('late', [])
  /** A real scheduler observes any leaked timeout execution. */
  const scheduler = createManualScheduler()
  /** Timer callbacks are distinct from transport acquisition. */
  const scheduled = vi.spyOn(scheduler, 'schedule')
  /** Public host has already committed a transport before late use is attempted. */
  const host = await createRpcHost({
    self: { name: 'late-policy', instanceId: 'late-policy' },
    plugins: [transport(started)]
  })
  try {
    /** The supported policy factory remains opaque; no internal hook is monkey-patched. */
    const policy = linkPolicy({ features: { timeout: timeoutFeature({ ms: 1000, scheduler }) } })
    /** Preserve the exact public startup diagnostic. */
    let failure: unknown
    try {
      await host.use(policy, transport(late))
    } catch (error) {
      failure = error
      record(error)
    }
    expect(failure).toBeInstanceOf(TypeError)
    expect(failure).toMatchObject({
      source: 'rpc.endpoint',
      code: 'INVALID_CONFIG',
      message: 'RPC flow hooks cannot be installed after transport startup'
    })
    expect([started.opens, late.opens, started.disposals, late.disposals]).toEqual([1, 0, 0, 0])
    expect(scheduled).toHaveBeenCalledTimes(0)
  } finally {
    vi.restoreAllMocks()
    await host.close()
  }
  expect(started.disposals).toBe(1)
}
/** Actual namespace handles and saved send callables retain the removed native generation. */
async function staleNamespace(): Promise<void> {
  /** Every provider invocation is counted through the real accepted carrier pair. */
  const echo = vi.fn((value: unknown) => value)
  /** Original fixture creates the supported real MemoryCarrier transport, not a wire stand-in. */
  const server = coreMemoryServer('modular-stale-server')
  /** Real public provider host owns the actual business callback. */
  const host = await createRpcHost({ ...server.options, provide: { echo } })
  /** A real originating host completes the bilateral handshake. */
  const client = await server.connect('modular-stale-client')
  try {
    /** Save both public references before logical native removal. */
    const view = client.host.memory
    /** Detached send must retain the same native generation guard. */
    const saved = view.send
    expect(await saved('modular-stale-server', 'echo', 7)).toBe(7)
    expect(await client.host.unUse('memory')).toMatchObject({ ok: true })
    /**
     * Promise assimilation observes synchronous or asynchronous rejection without changing
     * identity.
     */
    let failure: unknown
    try {
      await saved('modular-stale-server', 'echo', 8)
    } catch (error) {
      failure = error
      record(error)
    }
    expect(failure).toMatchObject({ source: 'rpc.endpoint', code: 'ENDPOINT_DISPOSED' })
    failure = undefined
    try {
      await view.send('modular-stale-server', 'echo', 9)
    } catch (error) {
      failure = error
      record(error)
    }
    expect(failure).toMatchObject({ source: 'rpc.endpoint', code: 'ENDPOINT_DISPOSED' })
    expect(echo).toHaveBeenCalledTimes(1)
  } finally {
    await Promise.all([client.host.close(), host.close()])
  }
}
/** Native callbacks are observable through RPC's existing ordinary-native-Host SDK integration. */
class DependencyProbe {
  /** Setup, install and Feature construction are counted independently. */
  setups = 0
  /** Installed native definitions are not inferred from SDK metadata. */
  installs = 0
  /** Genuine Feature output constructors. */
  factories = 0
  /** Exact native cleanup callbacks. */
  disposals = 0
  /** Native setup is counted only when admission succeeds. */
  setup(): void {
    this.setups += 1
  }
  /** The native install owns its original cleanup receipt. */
  install(core: IPluginHostCore) {
    this.installs += 1
    core.onDispose(() => this.dispose())
    return {}
  }
  /** Native dependency construction supplies a genuine object output. */
  factory() {
    this.factories += 1
    return { value: 1 }
  }
  /** Removal and final disposal must not double-release original registrations. */
  dispose(): void {
    this.disposals += 1
  }
}
/** The supported native SDK path selects modules at its documented concrete Host constructor. */
async function dependencyCase(present: boolean): Promise<void> {
  /** Original dependency callback ownership remains outside the planner. */
  const probe = new DependencyProbe()
  /** Exact provider Feature is shared with its one genuine dependent. */
  const first = defineFeature(() => probe.factory())
  /** A local native dependency edge claims the actual planning module. */
  const second = defineFeature(() => probe.factory(), { previous: first })
  /** The original native definition retains all observable acquisition callbacks. */
  const definition = definePlugin({
    name: 'counted',
    features: { first, second },
    setup: () => probe.setup(),
    install: (core) => probe.install(core)
  })
  /** Existing SDK helper lends real named-pipeline ownership to an ordinary native Host. */
  const rpc = rpcHostPipelines(
    () => native,
    (name, request) => native.pipeline(name, request)
  )
  /** Both counterpart hosts use genuine native module identities. */
  const modules = present
    ? ([
        featuresModule,
        featureDependenciesModule,
        namedPipelinesModule,
        asyncPipelineModule
      ] as const)
    : ([featuresModule, namedPipelinesModule, asyncPipelineModule] as const)
  /** The public native constructor is the documented SDK integration seam, not a fake RPC Host. */
  const native = defineHost({
    modules,
    ...rpc,
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** Actual SDK acquisition proves this path includes the real receiving RPC runtime. */
  const opened = new TransportProbe('native', [])
  try {
    if (!present) {
      /** Preserve actual missing-module admission without installing a sibling transport. */
      let failure: unknown
      try {
        await native.use(definition, transport(opened))
      } catch (error) {
        failure = error
        record(error)
      }
      expect(failure).toMatchObject({ code: 'HOST_MODULE_MISSING' })
      expect([probe.setups, probe.installs, probe.factories, opened.opens]).toEqual([0, 0, 0, 0])
    } else {
      await native.use(definition, transport(opened))
      expect([probe.setups, probe.installs, probe.factories, opened.opens]).toEqual([1, 1, 2, 1])
      await native.unUse('counted')
      await native.use(definition)
      expect([probe.setups, probe.installs, probe.factories, probe.disposals]).toEqual([2, 2, 4, 1])
    }
  } finally {
    await native.dispose()
  }
  expect(probe.disposals).toBe(present ? 2 : 0)
}
/** Exercise both supported native SDK module selections in the same assertion case. */
async function dependencyTransitions(): Promise<void> {
  await dependencyCase(false)
  await dependencyCase(true)
}
/** Register actual public-consumer cases without a closure-owned fixture component. */
function registerLifecycleCases(): void {
  it('rolls back a partial public transport batch in reverse order', partialRollback)
  it('rejects late policy before sibling acquisition or timeout execution', latePolicy)
  it('rejects stale namespace handles and saved calls before provider effects', staleNamespace)
  it('counts real native SDK dependencies with and without their module', dependencyTransitions)
}
describe('RPC modular lifecycle', registerLifecycleCases)
