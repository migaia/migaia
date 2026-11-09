import { describe, expect, it } from 'vitest'
import { defineHost, definePlugin, PluginHost, pipelineSpec, type IPlugin } from '../src/index.ts'
import { defineFeature, featuresModule } from '../src/modules/features/index.ts'
import { enablementModule } from '../src/modules/enablement/index.ts'
import { namedPipelinesModule } from '../src/modules/named-pipelines/index.ts'
import { asyncPipelineModule } from '../src/modules/pipeline-modes/async.ts'
import { HostModuleKey } from '../src/module-constants.ts'
import { PluginDefinitionKey } from '../src/definition-constants.ts'
import { walkErrorCauses } from '@migaia/utils/error'

/** The supported claim fields and their authoritative owners are fixed by native admission. */
const claims = [
  { field: PluginDefinitionKey.features, module: HostModuleKey.features, dependencies: false },
  { field: PluginDefinitionKey.activation, module: HostModuleKey.activation, dependencies: false },
  { field: PluginDefinitionKey.onEnable, module: HostModuleKey.enablement, dependencies: false },
  { field: PluginDefinitionKey.onDisable, module: HostModuleKey.enablement, dependencies: false },
  {
    field: PluginDefinitionKey.pipelines,
    module: HostModuleKey.namedPipelines,
    dependencies: false
  },
  {
    field: PluginDefinitionKey.onDependencyReplaced,
    module: HostModuleKey.featureDependencies,
    dependencies: false
  },
  {
    field: PluginDefinitionKey.features,
    module: HostModuleKey.featureDependencies,
    dependencies: true
  }
] as const
/** Four actual entry/source combinations include setup only on the asynchronous use path. */
const entries = [
  { trusted: true, sync: false },
  { trusted: false, sync: false },
  { trusted: true, sync: true },
  { trusted: false, sync: true }
] as const
/** One fixed claim row chooses a genuine declaration rather than an authority-shaped token. */
type IClaim = (typeof claims)[number]
/** One entry row selects the existing public Host operation and native/raw input. */
type IEntry = (typeof entries)[number]
/** Canonical authoring fields are projected without inventing feature-token shapes. */
type IClaimFields = Partial<
  Pick<
    IPlugin<Record<string, never>, { value: number }>,
    'features' | 'activation' | 'onEnable' | 'onDisable' | 'onDependencyReplaced' | 'pipelines'
  >
>
/** A returned operation unexpectedly succeeded, so the test cannot treat it as a rejection. */
const expectedFailureText = 'Expected the native admission operation to reject'
/** Callback counts are independent of the rejected input's metadata and error message. */
class AdmissionProbe {
  /** Only actual lifecycle/factory callbacks may mutate these observations. */
  readonly #counts = { setup: 0, install: 0, factory: 0, hook: 0, dispose: 0 }
  /** Public assertions observe actual callback effects without a production test seam. */
  get counts() {
    return this.#counts
  }
  /** Supported setup is synchronous but belongs only to asynchronous use cases. */
  setup(): void {
    this.#counts.setup += 1
  }
  /** Every admitted installer would produce an ordinary synchronous extension object. */
  install() {
    this.#counts.install += 1
    return { value: 1 }
  }
  /** Genuine Feature outputs make factory execution separately observable. */
  feature() {
    this.#counts.factory += 1
    return { value: 1 }
  }
  /** Enablement or dependency notifications must not run on rejected admission. */
  notify(): void {
    this.#counts.hook += 1
  }
  /** Rejection before acquisition must not need rollback to hide callback effects. */
  dispose(): void {
    this.#counts.dispose += 1
  }
  /** Return valid raw hooks while retaining one explicit counter owner. */
  raw() {
    return { name: 'claim', install: () => this.install(), dispose: () => this.dispose() }
  }
  /** Build only the one claim being tested; local dependencies are real native identities. */
  declarations(claim: IClaim): IClaimFields {
    if (claim.field === PluginDefinitionKey.features) {
      /** The original local provider is shared by identity with the dependent root. */
      const first = defineFeature(() => this.feature())
      if (claim.dependencies)
        return {
          features: { first, second: defineFeature(() => this.feature(), { previous: first }) }
        }
      return { features: { first } }
    }
    if (claim.field === PluginDefinitionKey.activation) return { activation: 'lazy' as const }
    if (claim.field === PluginDefinitionKey.pipelines)
      return { pipelines: { named: pipelineSpec<number>()({ mode: 'async' }) } }
    if (claim.field === PluginDefinitionKey.onEnable) return { onEnable: () => this.notify() }
    if (claim.field === PluginDefinitionKey.onDisable) return { onDisable: () => this.notify() }
    return { onDependencyReplaced: () => this.notify() }
  }
}
/** Emit complete fixture-only classification while preserving the original error objects. */
function recordFailure(error: unknown): void {
  for (const value of walkErrorCauses(error)) {
    if (value === undefined) continue
    /** Native error fields remain authoritative; absent diagnostic properties stay explicit null. */
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
/** Observe either the existing synchronous throw or Promise rejection boundary unchanged. */
async function rejected(action: () => unknown): Promise<unknown> {
  try {
    await action()
  } catch (error) {
    recordFailure(error)
    return error
  }
  throw new Error(expectedFailureText)
}
/** Fresh empty owners make public config lookup/revision prove no attempted registration published. */
async function missingClaim(claim: IClaim, entry: IEntry): Promise<void> {
  /** Each row gets independent counters and a genuine async-only receiving Host. */
  const probe = new AdmissionProbe()
  /** Only selected async mode is available; the target claim's owner is deliberately absent. */
  const host = defineHost({ modules: [asyncPipelineModule], host: { pipeline: { mode: 'async' } } })
  /** The target's name is queried through the public config API before and after admission. */
  const before = host.config.get('claim' as never)
  /** Rejected acquisition must not publish a new committed Host revision. */
  const revision = host.revision
  /** Other declaration fields remain absent so another missing module cannot mask the target. */
  const raw = { ...probe.raw(), ...probe.declarations(claim) }
  /** UseSync receives a valid synchronous definition with no setup field at all. */
  const candidate = entry.sync
    ? entry.trusted
      ? definePlugin(raw)
      : raw
    : entry.trusted
      ? definePlugin({ ...raw, setup: () => probe.setup() })
      : { ...raw, setup: () => probe.setup() }
  try {
    /** Both operations run on the actual public handle rather than a replacement installer. */
    const failure = await rejected(() =>
      entry.sync ? host.useSync(candidate) : host.use(candidate)
    )
    expect(failure).toMatchObject({
      source: 'plugin.host',
      code: 'HOST_MODULE_MISSING',
      detail: { module: claim.module, field: claim.field }
    })
    expect(probe.counts).toEqual({ setup: 0, install: 0, factory: 0, hook: 0, dispose: 0 })
    expect(before).toBeUndefined()
    expect(host.config.get('claim' as never)).toBe(before)
    expect(host.revision).toBe(revision)
  } finally {
    await host.dispose()
  }
  expect(probe.counts).toEqual({ setup: 0, install: 0, factory: 0, hook: 0, dispose: 0 })
}
/**
 * Missing handle members and present async execution distinguish module selection from blanket
 * removal.
 */
async function selectedSurface(): Promise<void> {
  /** The frozen handle publishes only its selected optional operations. */
  const handle = defineHost({
    modules: [asyncPipelineModule],
    host: { pipeline: { mode: 'async' } }
  })
  /** Class methods retain their normal boundary but reject absent collaborators explicitly. */
  const host = new PluginHost<
    Record<string, never>,
    never,
    readonly [],
    Record<never, never>,
    readonly [typeof asyncPipelineModule]
  >({ modules: [asyncPipelineModule], pipeline: { mode: 'async' } })
  try {
    for (const key of [
      'replace',
      'activate',
      'plugin',
      'runPipelineSync',
      'useGeneratorPipeline'
    ] as const)
      expect(key in handle).toBe(false)
    expect('runPipelineAsync' in handle).toBe(true)
    expect(
      await rejected(() =>
        host.replace('missing', definePlugin({ name: 'missing', install: () => ({}) }))
      )
    ).toMatchObject({ code: 'HOST_MODULE_MISSING' })
    expect(await rejected(() => host.activate('missing'))).toMatchObject({
      code: 'HOST_MODULE_MISSING'
    })
    expect(await rejected(() => host.plugin.enable('missing'))).toMatchObject({
      code: 'HOST_MODULE_MISSING'
    })
  } finally {
    await handle.dispose()
    await host.dispose()
  }
}
/** A synchronous stage follows the same public lift path as existing async Host consumers. */
function increment(value: number, next: (value: number) => void): void {
  next(value + 1)
}
/** This valid generator stage is unsupported by an async-only default mode. */
function* generator(value: number): Generator<number, number, unknown> {
  yield value
  return value
}
/** Default mode admission rejects absence, lifts sync stages, and retains native mismatch causes. */
async function defaultModes(): Promise<void> {
  /** The plugin core is genuine, but no default runner was installed on its owner. */
  const absent = defineHost()
  /** Capture the exact core failure before the native install boundary retains it on cause. */
  let coreFailure: unknown
  /** The installation itself is real; only its unsupported pipeline request is expected to fail. */
  const plugin = definePlugin<Record<string, never>, Record<string, never>, number>({
    name: 'mode',
    install(core) {
      try {
        core.usePipeline(increment)
      } catch (error) {
        coreFailure = error
        throw error
      }
      return {}
    }
  })
  try {
    /** Existing install wrapping must not replace the original mode-admission error. */
    const outer = await rejected(() => absent.use(plugin))
    expect(coreFailure).toMatchObject({
      source: 'plugin.host',
      code: 'PIPELINE_MODE_NOT_INSTALLED'
    })
    expect(walkErrorCauses(outer)).toContain(coreFailure)
  } finally {
    await absent.dispose()
  }
  /** Explicit generic axes preserve numeric payload inference on the functional owner. */
  const selected = defineHost<
    Record<string, never>,
    number,
    readonly [typeof asyncPipelineModule],
    'async'
  >({ modules: [asyncPipelineModule], host: { pipeline: { mode: 'async' } } })
  /** Terminal observations come from the actual promoted sync stage. */
  const values: number[] = []
  /** The class retains the supported direct mismatch-rejection operation. */
  const classHost = new PluginHost<
    Record<string, never>,
    number,
    readonly [],
    Record<never, never>,
    readonly [typeof asyncPipelineModule]
  >({ modules: [asyncPipelineModule], pipeline: { mode: 'async' } })
  try {
    selected.usePipeline(increment)
    await selected.runPipeline(1, (value) => {
      values.push(value)
    })
    expect(values).toEqual([2])
    /** The native TypeError cause survives the Host's existing mismatch classification. */
    const mismatch = await rejected(() => classHost.useGeneratorPipeline(generator))
    expect(mismatch).toMatchObject({
      source: 'plugin.host',
      code: 'PIPELINE_MODE_MISMATCH',
      cause: expect.any(TypeError)
    })
  } finally {
    await selected.dispose()
    await classHost.dispose()
  }
}
/** Named declarations reject an unavailable mode before any plugin callback can acquire resources. */
async function namedConstruction(): Promise<void> {
  /** Host declarations use a real specification at the public construction boundary. */
  const construction = await rejected(() =>
    defineHost({
      modules: [namedPipelinesModule, asyncPipelineModule],
      pipelines: { named: pipelineSpec<number>()({ mode: 'sync' }) }
    })
  )
  expect(construction).toMatchObject({
    source: 'plugin.host',
    code: 'PIPELINE_MODE_NOT_INSTALLED',
    detail: { pipeline: 'named', mode: 'sync' }
  })
}
/** A missing named mode must reject before setup, factories or lifecycle effects. */
async function namedPluginAdmission(): Promise<void> {
  /** All non-mode claims are installed so missing sync cannot be masked by another rejection. */
  const host = defineHost({
    modules: [featuresModule, enablementModule, namedPipelinesModule, asyncPipelineModule]
  })
  /** Genuine hooks, setup and Feature factories prove rejection happens before acquisition. */
  const probe = new AdmissionProbe()
  /** One supported native definition selects only the absent named mode. */
  const plugin = definePlugin({
    ...probe.raw(),
    setup: () => probe.setup(),
    features: { value: defineFeature(() => probe.feature()) },
    onEnable: () => probe.notify(),
    pipelines: { named: pipelineSpec<number>()({ mode: 'sync' }) }
  })
  try {
    /** The public use boundary must reject directly rather than install and roll back. */
    const failure = await rejected(() => host.use(plugin))
    expect(failure).toMatchObject({
      source: 'plugin.host',
      code: 'PIPELINE_MODE_NOT_INSTALLED',
      detail: { pipeline: 'named', mode: 'sync' }
    })
    expect(probe.counts).toEqual({ setup: 0, install: 0, factory: 0, hook: 0, dispose: 0 })
    expect(host.config.get('claim' as never)).toBeUndefined()
    expect(host.revision).toBe(0)
  } finally {
    await host.dispose()
  }
}
/** Register the fixed 7-by-4 admission matrix and explicit mode/surface counterparts. */
function cases(): void {
  // Both domains are compile-time constants above: seven claims times four supported entry forms.
  for (const claim of claims)
    for (const entry of entries)
      it(`${entry.trusted ? 'native' : 'raw'} ${entry.sync ? 'useSync' : 'use'} rejects ${claim.field}/${claim.module}`, () =>
        missingClaim(claim, entry))
  it(
    'publishes exactly the async-only surface and rejects missing class operations',
    selectedSurface
  )
  it('admits only installed default modes and preserves supported lifts', defaultModes)
  it('rejects unavailable named modes at Host construction with precise detail', namedConstruction)
  it('rejects unavailable plugin named modes before acquisition', namedPluginAdmission)
}
describe('host module admission', cases)
