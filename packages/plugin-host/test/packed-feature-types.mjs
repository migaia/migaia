import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { extractPackedPackage } from './executable-acceptance-tooling.mjs'

const archive = process.argv[2]
if (!archive) throw new Error('packed archive path required')
const selectedCase = process.argv[3] === '--case' ? process.argv[4] : (process.argv[3] ?? 'YS28')
if (selectedCase !== 'YS28') throw new Error(`unknown packed feature case: ${selectedCase}`)
const root = resolve(new URL('..', import.meta.url).pathname)
const workspace = resolve(root, '../..')
const temporary = mkdtempSync(join(tmpdir(), 'plugin-host-feature-types-'))
const consumer = join(temporary, 'consumer')
const output = join(consumer, 'compiled')
const tsc = join(workspace, 'node_modules/typescript/bin/tsc')

/** Compile and run one emitted public-package consumer without workspace resolution. */
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: 'inherit' })

const packageDirectory = extractPackedPackage(temporary, resolve(archive))

const fixtures = {
  storage: String.raw`import { PluginHost, defineFeature, definePlugin } from '@migaia/plugin-host'
import { inspectFeatures } from '@migaia/plugin-host/composition'
import type { IFeatureCore } from '@migaia/plugin-host'
type IStore = Readonly<{ id: 'memory'; custom(): 'custom' }>
type IAdapter = Readonly<{ readonly reactive: true; start(): void }>
type IKind<TId extends string, TStore> = Readonly<{ id: TId; store: TStore }>
type IExpose = Readonly<{ getStore(): IStore; getBackendId(): 'memory'; getBackendKind(): IKind<'memory', IStore> }>
let calls = 0
const observedCalls = () => calls
const store = defineFeature((core: IFeatureCore<IExpose>) => { calls += 1; return { getStore: core.featureExpose.getStore, getBackendId: core.featureExpose.getBackendId, getBackendKind: core.featureExpose.getBackendKind } })
const reactive = defineFeature((core: IFeatureCore<IExpose>) => { calls += 1; return { reactive: true as const, attach: (_service: string, _report: (error: unknown) => void): IAdapter => ({ reactive: true, start: () => { core.featureExpose.getStore().custom() } }) } })
const selected = defineFeature((_core, dependencies) => { calls += 1; return { getStore: dependencies.store.getStore, reactive: dependencies.reactive.reactive, attach: dependencies.reactive.attach } }, { store, reactive })
const kind: IKind<'memory', IStore> = { id: 'memory', store: { id: 'memory', custom: () => 'custom' } }
const expose = (): IExpose => {
  const store: IStore = { id: 'memory', custom: () => 'custom' }
  const registrationKind: IKind<'memory', IStore> = { id: 'memory', store }
  return { getStore: () => store, getBackendId: () => 'memory', getBackendKind: () => registrationKind }
}
type IStorageExtension = Readonly<{ getStore(): IStore; reactive: true; attach(service: string, report: (error: unknown) => void): IAdapter; kind: IKind<'memory', IStore> }>
const plugin = definePlugin({ name: 'storage', features: { selected }, featureExpose: expose, install: core => ({ getStore: core.features.selected.getStore, reactive: core.features.selected.reactive, attach: core.features.selected.attach, kind: core.featureExpose.getBackendKind() }) })
// @ts-expect-error selected Feature requires its transitive expose contract.
definePlugin({ name: 'missing-storage-expose', install: () => ({}), features: { selected }, featureExpose: {} })
const widened: string = 'memory'
const requireLiteral = <TId extends string>(value: string extends TId ? never : TId): TId => value
// @ts-expect-error widened IDs cannot satisfy exact backend identity.
requireLiteral(widened)
const wrongKind: IKind<'session', IStore> = { id: 'session', store: kind.store }
// @ts-expect-error selected Feature requires the exact memory backend kind.
definePlugin({ name: 'wrong-kind', install: () => ({}),
  features: { selected },
  featureExpose: {
    getStore: () => kind.store,
    getBackendId: (): 'memory' => 'memory',
    getBackendKind: () => wrongKind
  }
})
const bindKind = <TId extends string>(value: IKind<TId, IStore>, id: TId): void => { void value; void id }
// @ts-expect-error a different literal backend kind cannot bind memory.
bindKind<'memory'>(wrongKind, 'memory')
const inspection = inspectFeatures({ selected })
if (observedCalls() !== 0 || inspection.ordered.length !== 3) throw new Error('storage inspection')
class ConsumerHost extends PluginHost<Record<string, never>> { constructor() { super({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }) } }
const firstHost = new ConsumerHost()
const secondHost = new ConsumerHost()
const first = await firstHost.use(plugin)
const second = await secondHost.use(plugin)
const storeId: 'memory' = first.extensions.getStore().id
const attached: IAdapter = first.extensions.attach('service', () => {})
const selectedKind: IKind<'memory', IStore> = first.extensions.kind
attached.start()
if (observedCalls() !== 6 || first.extensions.getStore() === second.extensions.getStore() || storeId !== 'memory' || !attached.reactive || selectedKind.id !== 'memory' || !first.extensions.reactive) throw new Error('storage runtime')
await firstHost.dispose()
await secondHost.dispose()
`,
  webRpc: String.raw`import { PluginHost, defineFeature, definePlugin } from '@migaia/plugin-host'
import { inspectFeatures } from '@migaia/plugin-host/composition'
import type { IFeatureCore } from '@migaia/plugin-host'
type IOutboundExpose = Readonly<{ send(value: string): Promise<string>; send<T>(value: T): Promise<T> }>
type IOutbound = Readonly<{ send(value: string): Promise<string>; send<T>(value: T): Promise<T> }>
let calls = 0
const observedCalls = () => calls
const outbound = defineFeature((core: IFeatureCore<IOutboundExpose>): IOutbound => { calls += 1; return { send: core.featureExpose.send } })
const discovery = defineFeature((_core, dependencies) => { calls += 1; return { connect: dependencies.outbound.send } }, { outbound })
const combined = defineFeature((_core, dependencies) => { calls += 1; return { connect: dependencies.discovery.connect } }, { discovery })
type IRpcExtension = Readonly<{ connect: IOutbound['send'] }>
const plugin = definePlugin({ name: 'rpc', features: { combined }, featureExpose: { send: async <T,>(value: T) => value }, install: core => { // @ts-expect-error only declared roots are injected.
  if (false) core.features.outbound.send('hidden')
  return { connect: core.features.combined.connect }
} })
const inspection = inspectFeatures({ combined })
if (observedCalls() !== 0 || inspection.ordered.length !== 3) throw new Error('rpc inspection')
class ConsumerHost extends PluginHost<Record<string, never>> { constructor() { super({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }) } }
const host = new ConsumerHost()
const view = await host.use(plugin)
const literal: string = await view.extensions.connect('rpc')
const generic: Readonly<{ id: number }> = await view.extensions.connect({ id: 1 })
// @ts-expect-error hidden outbound output cannot become a root extension.
if (false) view.extensions.send('hidden')
if (observedCalls() !== 3 || literal !== 'rpc' || generic.id !== 1 || 'send' in view.extensions) throw new Error('rpc runtime')
await host.dispose()
`,
  native: String.raw`import { PluginHost, defineFeature, definePlugin, setupHost } from '@migaia/plugin-host'
import type { IFeatureCore } from '@migaia/plugin-host'
type IExpose = Readonly<{ add(value: number): number }>
const feature = defineFeature((core: IFeatureCore<IExpose>) => ({ run: <T,>(value: T) => value, add: core.featureExpose.add }))
const staticFeatureRecord = { feature } as const
const plugin = definePlugin('native', (core) => ({
  featureExpose: () => ({ add: (value: number) => value }),
  install: () => ({ run: core.features.feature.run }),
  expose: () => ({ value: () => 1 as const }),
  shared: () => ({ secret: () => true })
}), staticFeatureRecord)
const empty = definePlugin('empty', () => ({}))
const exposeOnly = definePlugin('expose-only', () => ({ expose: () => ({ exposedValue: () => 2 as const }) }))
const legacyPrefix = definePlugin<{ domain: number }, { read(): number }, never, 'legacy-prefix'>('legacy-prefix', (core) => ({ install: () => ({ read: () => core.domain }) }))
const objectCompatible = definePlugin<{ domain: number }, { read(): number }, never, { enabled: boolean }, { secret(): number }, 'object-compatible'>({
  name: 'object-compatible',
  config: { enabled: true },
  install: (core) => ({ read: () => core.domain }),
  shared: (core) => ({ secret: () => core.domain })
})
void legacyPrefix
void objectCompatible
declare const emptyHost: PluginHost<Record<never, never>>
declare const domainHost: PluginHost<{ domain: number }>
const domainPlugin = definePlugin<{ domain: number }, { read(): number }, never, 'domain-plugin'>('domain-plugin', (core) => ({ install: () => ({ read: () => core.domain }) }))
if (false) {
  // @ts-expect-error required feature expose cannot be omitted.
  definePlugin('missing', () => ({}), { feature })
  // @ts-expect-error install and expose keys cannot overlap.
  definePlugin('collision', () => ({ install: () => ({ value: 1 }), expose: () => ({ value: 2 }) }))
  // @ts-expect-error descriptor factories cannot be async.
  definePlugin('async-factory', async () => ({}))
  // @ts-expect-error expose cannot be async.
  definePlugin('async-expose', () => ({ expose: async () => ({ value: 1 }) }))
  // @ts-expect-error shared cannot be async.
  definePlugin('async-shared', () => ({ shared: async () => ({ value: 1 }) }))
  // @ts-expect-error host core cannot satisfy a domain-required definition.
  await emptyHost.use(domainPlugin)
  const installed = await emptyHost.use(plugin)
  // @ts-expect-error accumulated views retain the required domain core.
  await installed.use(domainPlugin)
  // @ts-expect-error dynamic views retain the required domain core.
  await emptyHost.getCurrentView().use(domainPlugin)
  await domainHost.use(domainPlugin)
  // @ts-expect-error setup requires the domain core for its plugin tuple.
  await setupHost({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }, setupTimeoutMs: false, core: () => ({}), plugins: [domainPlugin] })
  const emptySetup = await setupHost({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }, setupTimeoutMs: false, core: () => ({}) })
  // @ts-expect-error setup publications retain each plugin core requirement.
  await emptySetup.use(domainPlugin)
  // @ts-expect-error setup hosts retain each plugin core requirement.
  await emptySetup.host.use(domainPlugin)
}
class Host extends PluginHost<Record<never, never>> { constructor() { super({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }) } }
const host = new Host()
const view = await host.use(plugin, empty, exposeOnly)
const generic: { id: number } = view.extensions.run({ id: 1 })
const literal: 1 = view.extensions.value()
const exposedLiteral: 2 = view.extensions.exposedValue()
if (generic.id !== 1 || literal !== 1 || exposedLiteral !== 2) throw new Error('native runtime')
await host.dispose()
`
}

/** Compile and execute one packed consumer at a named sensitivity phase. */
const compileFixture = (name, source, phase) => {
  const file = join(consumer, `${name}.mts`)
  writeFileSync(file, source)
  try {
    run(
      process.execPath,
      [
        tsc,
        '--strict',
        '--target',
        'esnext',
        '--module',
        'nodenext',
        '--moduleResolution',
        'nodenext',
        '--skipLibCheck',
        '--outDir',
        output,
        file
      ],
      consumer
    )
    run(process.execPath, [join(output, `${name}.mjs`)], consumer)
    console.log(JSON.stringify({ fixture: name, phase, result: 'PASS' }))
  } catch {
    console.log(JSON.stringify({ fixture: name, phase, result: 'FAIL' }))
    throw new Error(`${name} ${phase}`)
  }
}

for (const [name, source] of Object.entries(fixtures)) compileFixture(name, source, 'baseline')

/** Require exactly one known unused negative assertion from an isolated declaration mutant. */
const expectMutantFailure = (name, source, expectedDirectives) => {
  const expectedLines = expectedDirectives.map(
    (directive) => source.slice(0, source.indexOf(directive)).split('\n').length
  )
  const file = join(consumer, `${name}.mts`)
  writeFileSync(file, source)
  try {
    execFileSync(
      process.execPath,
      [
        tsc,
        '--strict',
        '--target',
        'esnext',
        '--module',
        'nodenext',
        '--moduleResolution',
        'nodenext',
        '--skipLibCheck',
        '--outDir',
        output,
        file
      ],
      { cwd: consumer, encoding: 'utf8', stdio: 'pipe' }
    )
  } catch (error) {
    const diagnostic = `${error.stdout ?? ''}${error.stderr ?? ''}`
    const expected = expectedLines.map(
      (line) =>
        new RegExp(
          `${name}\\.mts\\(${line},\\d+\\): error TS2578: Unused '@ts-expect-error' directive\\.`
        )
    )
    const allErrors = diagnostic.match(/error TS\d+:/g) ?? []
    if (expected.every((entry) => entry.test(diagnostic)) && allErrors.length === expected.length) {
      console.log(
        JSON.stringify({
          fixture: name,
          phase: 'mutant',
          result: 'FAIL',
          diagnostic: `TS2578:${expectedLines.join(',')}`
        })
      )
      return
    }
    throw new Error(`${name} mutant diagnostics diverged: ${diagnostic}`)
  }
  throw new Error(`${name} mutant unexpectedly passed`)
}

/** Mutate one packed declaration at a time, then restore its exact original bytes. */
const runDeclarationMutation = (
  name,
  source,
  declaration,
  guard,
  replacement,
  expectedDirectives
) => {
  const original = readFileSync(declaration, 'utf8')
  if (!original.includes(guard)) throw new Error(`${name} declaration guard missing`)
  writeFileSync(declaration, original.replace(guard, replacement))
  try {
    expectMutantFailure(name, source, expectedDirectives)
  } finally {
    writeFileSync(declaration, original)
  }
  if (readFileSync(declaration, 'utf8') !== original)
    throw new Error(`${name} declaration restore drifted`)
  compileFixture(name, source, 'restored')
}

runDeclarationMutation(
  'storage',
  fixtures.storage,
  join(packageDirectory, 'dist/define-plugin.d.ts'),
  ' & (TExpose extends IFeatureRecordRequiredExpose<TFeatures> ? unknown : never)',
  '',
  [
    '// @ts-expect-error selected Feature requires its transitive expose contract.',
    '// @ts-expect-error selected Feature requires the exact memory backend kind.'
  ]
)
runDeclarationMutation(
  'webRpc',
  fixtures.webRpc,
  join(packageDirectory, 'dist/feature-types.d.ts'),
  'Readonly<{\n    readonly [K in keyof TDependencies]: IFeatureOutput<TDependencies[K]>;\n}>',
  'Readonly<Record<string, any>>',
  ['// @ts-expect-error only declared roots are injected.']
)
runDeclarationMutation(
  'native',
  fixtures.native,
  join(packageDirectory, 'dist/define-plugin.d.ts'),
  ' & (keyof IFeatureRecordRequiredExpose<TFeatures> extends never ? unknown : {\n    readonly featureExpose: () => TExpose;\n})',
  '',
  ['// @ts-expect-error required feature expose cannot be omitted.']
)
runDeclarationMutation(
  'native',
  fixtures.native,
  join(packageDirectory, 'dist/define-plugin.d.ts'),
  ' & (keyof TExtension & keyof TPublic extends never ? unknown : {\n    readonly duplicateHostProjectionKeys: never;\n})',
  '',
  ['// @ts-expect-error install and expose keys cannot overlap.']
)
runDeclarationMutation(
  'native',
  fixtures.native,
  join(packageDirectory, 'dist/registry.d.ts'),
  'TPublic & (TPublic extends PromiseLike<unknown> ? never : unknown)',
  'TPublic',
  ['// @ts-expect-error expose cannot be async.']
)
runDeclarationMutation(
  'native',
  fixtures.native,
  join(packageDirectory, 'dist/registry.d.ts'),
  'TShared & (TShared extends PromiseLike<unknown> ? never : unknown)',
  'TShared',
  ['// @ts-expect-error shared cannot be async.']
)
runDeclarationMutation(
  'native',
  fixtures.native,
  join(packageDirectory, 'dist/typing.d.ts'),
  'TRequired extends Record<string, never> ? unknown : TCore extends TRequired ? unknown : never',
  'unknown',
  [
    '// @ts-expect-error host core cannot satisfy a domain-required definition.',
    '// @ts-expect-error accumulated views retain the required domain core.',
    '// @ts-expect-error dynamic views retain the required domain core.',
    '// @ts-expect-error setup requires the domain core for its plugin tuple.',
    '// @ts-expect-error setup publications retain each plugin core requirement.',
    '// @ts-expect-error setup hosts retain each plugin core requirement.'
  ]
)
