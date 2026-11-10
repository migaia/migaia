import { describe, expect, it } from 'vitest'
import { definePlugin, pipelineSpec, type IPluginHostCore } from '@migaia/plugin-host'
import { enablementModule } from '@migaia/plugin-host/enablement'
import { activationModule } from '@migaia/plugin-host/activation'
import { featureDependenciesModule } from '@migaia/plugin-host/feature-dependencies'
import { namedPipelinesModule } from '@migaia/plugin-host/named-pipelines'
import { createLogHost } from '../src/index.ts'

/**
 * Plugin fields that need a module the public log host does not install. The log host installs only
 * the features and async pipeline modules, so each field below must be rejected before any
 * callback.
 */
const claims = [
  { field: 'onEnable', module: enablementModule.key },
  { field: 'onDisable', module: enablementModule.key },
  { field: 'activation', module: activationModule.key },
  { field: 'onDependencyReplaced', module: featureDependenciesModule.key },
  { field: 'pipelines', module: namedPipelinesModule.key }
] as const

/** One fixed claim row; the table above is a compile-time constant of five rows. */
type IClaim = (typeof claims)[number]

/** Counts every callback a rejected plugin could reach; all must stay zero after rejection. */
class CallbackProbe {
  /** Install calls; a missing-module rejection must precede install. */
  installs = 0
  /** Declared lifecycle hook calls (onEnable, onDisable, onDependencyReplaced). */
  hooks = 0
  /** Business effects of the installed callable. */
  reads = 0
  /** Host-unique extension name; log hosts reject a second owner of one extension key. */
  readonly extension: string
  /** Fixes the extension key this probe publishes. */
  constructor(extension = 'read') {
    this.extension = extension
  }
  /** Counts install and returns the real callable extension. */
  install(core: Pick<IPluginHostCore, 'onDispose'>) {
    this.installs += 1
    core.onDispose(() => undefined)
    return { [this.extension]: () => this.read() }
  }
  /** Counts a declared hook invocation. */
  hook(): void {
    this.hooks += 1
  }
  /** Counts one business effect and returns the running total. */
  read(): number {
    this.reads += 1
    return this.reads
  }
}

/** Returns only the single target field for one claim; every other field stays valid. */
function claimFields(claim: IClaim, probe: CallbackProbe): Record<string, unknown> {
  if (claim.field === 'activation') return { activation: 'lazy' }
  if (claim.field === 'pipelines')
    return { pipelines: { named: pipelineSpec<number>()({ mode: 'async' }) } }
  return { [claim.field]: () => probe.hook() }
}

/** Builds the trusted definition or the raw plugin object carrying exactly one target claim. */
function claimPlugin(claim: IClaim, trusted: boolean, probe: CallbackProbe) {
  /** Shared valid fields: a name and a synchronous install. */
  const fields = {
    name: 'claimed',
    install: (core: Pick<IPluginHostCore, 'onDispose'>) => probe.install(core),
    ...claimFields(claim, probe)
  }
  return trusted ? definePlugin(fields as never) : fields
}

/** Plain plugin with no claimed field; the positive witness for each entry and input kind. */
function plainPlugin(name: string, trusted: boolean, probe: CallbackProbe) {
  /** Same valid shape as the claimed plugin, minus the target field. */
  const fields = {
    name,
    install: (core: Pick<IPluginHostCore, 'onDispose'>) => probe.install(core)
  }
  return trusted ? definePlugin(fields) : fields
}

/** Expected error shape: plugin-host identity plus the module key and field in detail. */
function missing(claim: IClaim) {
  return expect.objectContaining({
    source: 'plugin.host',
    code: 'HOST_MODULE_MISSING',
    detail: expect.objectContaining({ module: claim.module, field: claim.field })
  })
}

/** Construction entry: the claimed plugin in `options.plugins` throws at the sync admission edge. */
async function rejectAtConstruction(claim: IClaim, trusted: boolean): Promise<void> {
  /** Counters for the rejected plugin. */
  const probe = new CallbackProbe()
  expect(() =>
    createLogHost({ plugins: [claimPlugin(claim, trusted, probe)] as never })
  ).toThrowError(missing(claim))
  expect([probe.installs, probe.hooks]).toEqual([0, 0])
  /** Positive witness: the same input kind without the claimed field constructs and works. */
  const plain = new CallbackProbe()
  const host = createLogHost({ plugins: [plainPlugin('plain', trusted, plain)] as never })
  try {
    expect(plain.installs).toBe(1)
  } finally {
    await host.shutdown('manual')
  }
}

/** Later entry: `host.use` throws at admission, leaves no partial install, and the name stays free. */
async function rejectAtUse(claim: IClaim, trusted: boolean): Promise<void> {
  /** Existing plain plugin installed before the rejected call. */
  const existing = new CallbackProbe('existingRead')
  const host = createLogHost()
  try {
    const [existingHandle] = await host.use(plainPlugin('existing', trusted, existing) as never)
    /** Counters for the rejected plugin. */
    const probe = new CallbackProbe()
    // Definition admission runs before queuing, so plugin-host's baseline boundary is a sync throw.
    expect(() => host.use(claimPlugin(claim, trusted, probe) as never)).toThrowError(missing(claim))
    expect([probe.installs, probe.hooks]).toEqual([0, 0])
    expect(
      (existingHandle as { extensions: { existingRead(): number } }).extensions.existingRead()
    ).toBe(1)
    /** Same name, no claimed field: succeeds because the rejected call registered nothing. */
    const retry = new CallbackProbe('retryRead')
    const [retryHandle] = await host.use(plainPlugin('claimed', trusted, retry) as never)
    expect((retryHandle as { extensions: { retryRead(): number } }).extensions.retryRead()).toBe(1)
    expect(retry.installs).toBe(1)
  } finally {
    await host.shutdown('manual')
  }
}

/** Registers every claim × input kind × entry case from the fixed tables. */
function registerCases(): void {
  // 5 claims × 2 input kinds × 2 entries: all bounded by the constant tables above.
  for (const claim of claims)
    for (const trusted of [true, false]) {
      const kind = trusted ? 'definePlugin' : 'raw object'
      it(`createLogHost rejects ${kind} ${claim.field} needing ${claim.module}`, () =>
        rejectAtConstruction(claim, trusted))
      it(`host.use throws for ${kind} ${claim.field} needing ${claim.module}`, () =>
        rejectAtUse(claim, trusted))
    }
}

describe('log host rejects plugin fields whose module is not installed', registerCases)
