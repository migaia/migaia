import { expect, it } from 'vitest'
import { inspectFeatures } from '@migaia/plugin-host/composition'
import { prettyFeature } from '@migaia/log-plugin-console'
import { PluginHostErrorCode, type IFeatureOutput } from '@migaia/plugin-host'
import { createLogHost } from '../src/index.ts'
import { defineLogFeature, defineLogPlugin, defineOutputPlugin } from '../src/plugin.ts'
import {
  batchFeature,
  filterFeature,
  formatFeature,
  retryFeature,
  thresholdFeature,
  timeoutFeature,
  uuidFeature
} from '../src/features/index.ts'
import type {
  ILogEntry,
  ILogFeature,
  ILogHostOptions,
  ILogOutputRecord,
  ILogPluginConstraint,
  ILogPluginCore
} from '../src/typing.ts'
import { CaptureOutput, messageOf, nextTurn } from './fixtures/output.ts'

/** This predicate gives filter additions a visible, independently removable effect. */
function rejectAdded(entry: ILogEntry): boolean {
  return entry.message !== 'added'
}

/**
 * A8: native inspection admits exact opaque definitions for every log-host factory and public
 * phase.
 */
function nativeDefinitions(): void {
  /** Every cold factory contributes a distinct real native definition without installing state. */
  const features = {
    threshold: thresholdFeature(),
    filter: filterFeature(),
    uuid: uuidFeature(),
    format: formatFeature({ format: 'json' }),
    batch: batchFeature(),
    retry: retryFeature({ attempts: 2 }),
    timeout: timeoutFeature({ ms: 100 }),
    entry: defineLogFeature({ phase: 'entry', stage: keepNativeEntry }),
    gate: defineLogFeature({ phase: 'gate', accept: acceptNativeEntry }),
    customFormat: defineLogFeature({ phase: 'format', format: nativeText }),
    pretty: prettyFeature()
  }
  /** Canonical admission proves these exact objects have plugin-host identity. */
  const inspection = inspectFeatures(features)
  for (const [alias, feature] of Object.entries(features)) {
    expect(inspection.roots[alias as keyof typeof features]).toBe(feature)
    expect(Object.isFrozen(feature)).toBe(true)
    expect(Reflect.ownKeys(feature)).toEqual([])
    expect(Reflect.get(feature, 'phase')).toBeUndefined()
    expect(Reflect.get(feature, 'kind')).toBeUndefined()
    expect(Reflect.get(feature, 'add')).toBeUndefined()
    expect(Reflect.get(feature, 'setLevel')).toBeUndefined()
  }
}

/** The public entry callback remains callable only through an installed native instance. */
function keepNativeEntry(entry: ILogEntry): ILogEntry {
  return entry
}

/** A public custom gate needs no additional installation capability. */
function acceptNativeEntry(): boolean {
  return true
}

/** Distinct text identifies the selected third-party native format. */
function nativeText(): string {
  return 'native-format'
}

/** A11: reusing a definition never shares mutable state across native plugin installations. */
async function isolatedInstalledControls(): Promise<void> {
  /** Both native definitions are reused by two scopes and two hosts. */
  const threshold = thresholdFeature({ level: 'warn' })
  /** Filter mutations must stay in the installation that received the extension call. */
  const filter = filterFeature()
  /** One ordinary carrier is installed independently into both hosts. */
  const policy = defineLogPlugin({ name: 'policy', features: { threshold, filter } })
  /** Two inheriting outputs observe the same installed carrier policy. */
  const inheritedA = new CaptureOutput({ name: 'inherited-a' })
  /** An independent output prevents a setter bug from masquerading as one-output routing. */
  const inheritedB = new CaptureOutput({ name: 'inherited-b' })
  /** The local scope declares the same tokens but owns fresh native runtime instances. */
  const localRecords: ILogOutputRecord[] = []
  /** Output controls are ordinary plugin extensions with names disjoint from the carrier. */
  const local = defineOutputPlugin({
    name: 'local',
    batchable: false,
    defaultFormat: 'json',
    features: { threshold, filter },
    deliver(records) {
      localRecords.push(...records)
    }
  })
  /** Carrier and output-local state belong to separate registrations of the same definitions. */
  const host = createLogHost({ plugins: [policy, local, inheritedA.plugin(), inheritedB.plugin()] })
  /** The second host installs the very same carrier definition without borrowing its live state. */
  const otherOutput = new CaptureOutput({ name: 'other' })
  /** A host boundary is observable through actual delivered entries. */
  const other = createLogHost({ plugins: [policy, otherOutput.plugin()] })
  host.log('debug', 'before')
  other.log('debug', 'before')
  await host.flush()
  await other.flush()
  expect(inheritedA.records).toEqual([])
  expect(inheritedB.records).toEqual([])
  expect(localRecords).toEqual([])
  expect(otherOutput.records).toEqual([])

  host.policy_threshold_setLevel('debug')
  host.log('debug', 'carrier-open')
  other.log('debug', 'other-still-warn')
  await host.flush()
  await other.flush()
  expect(inheritedA.records.map(messageOf)).toEqual(['carrier-open'])
  expect(inheritedB.records.map(messageOf)).toEqual(['carrier-open'])
  expect(localRecords).toEqual([])
  expect(otherOutput.records).toEqual([])

  host.local_threshold_setLevel('debug')
  /** Only the carrier's installed filter rejects this message. */
  const off = host.policy_filter_add(rejectAdded)
  host.log('debug', 'added')
  other.log('warn', 'added')
  await host.flush()
  await other.flush()
  expect(inheritedA.records.map(messageOf)).toEqual(['carrier-open'])
  expect(inheritedB.records.map(messageOf)).toEqual(['carrier-open'])
  expect(localRecords.map(messageOf)).toEqual(['added'])
  expect(otherOutput.records.map(messageOf)).toEqual(['added'])
  off()
  off()
  host.log('debug', 'added')
  await host.flush()
  expect(inheritedA.records.map(messageOf)).toEqual(['carrier-open', 'added'])
  expect(inheritedB.records.map(messageOf)).toEqual(['carrier-open', 'added'])
  expect(localRecords.map(messageOf)).toEqual(['added', 'added'])
  await host.shutdown('manual')
  await other.shutdown('manual')
}

it(
  'A8 admits opaque native definitions for all log-host factories and public phases',
  nativeDefinitions
)
it(
  'A11 isolates installed controls across plugins and hosts while carrier outputs share policy',
  isolatedInstalledControls
)

/** The public install callback observes the runtime supplied by native core.features. */
class NativeInstallationCapture {
  /** Capturing the output proves policy state belongs to an installed instance, not its token. */
  runtime: IFeatureOutput<ReturnType<typeof filterFeature>> | undefined

  /** Read the exact native alias output without invoking a metadata factory. */
  install(
    core: ILogPluginCore & {
      readonly features: { readonly filter: IFeatureOutput<ReturnType<typeof filterFeature>> }
    }
  ): Record<string, never> {
    this.runtime = core.features.filter
    return {}
  }
}

/** A2: the installed native output and exposed plugin controls operate on the same state. */
async function nativeOutputOwnsPolicy(): Promise<void> {
  /** This cold token has no mutable controls before its declaring plugin installs it. */
  const filter = filterFeature()
  /** Installation is observed only through the existing public authoring callback. */
  const capture = new NativeInstallationCapture()
  /** Output delivery proves which runtime instance actually owns gate policy. */
  const output = new CaptureOutput()
  /** An ordinary carrier assembles the declared native feature onto the host. */
  const host = createLogHost({
    plugins: [
      defineLogPlugin({
        name: 'native',
        features: { filter },
        install: (core) => capture.install(core)
      }),
      output.plugin()
    ]
  })
  expect(capture.runtime?.implementation.phase).toBe('gate')
  expect(capture.runtime).not.toBe(filter)
  /** Mutating the exact native output must affect the policy used by actual log delivery. */
  const off = capture.runtime!.controls.add(rejectAdded)
  host.log('info', 'added')
  host.log('info', 'visible')
  await host.flush()
  expect(output.records.map(messageOf)).toEqual(['visible'])
  off()
  /** The extension forwards to that same installed output rather than a second filter owner. */
  const extensionOff = host.native_filter_add(rejectAdded)
  host.log('info', 'added')
  await host.flush()
  expect(output.records.map(messageOf)).toEqual(['visible'])
  extensionOff()
  host.log('info', 'added')
  await host.flush()
  expect(output.records.map(messageOf)).toEqual(['visible', 'added'])
  await host.shutdown('manual')
}

/** A9: unsupported JavaScript host options fail instead of silently dropping requested features. */
function rejectHostFeatureOption(): void {
  /** Both retired forms must reject even when an empty record would otherwise appear harmless. */
  for (const features of [{}, { uuid: uuidFeature() }, []]) {
    expect(() => createLogHost({ features } as unknown as ILogHostOptions)).toThrowError(
      expect.objectContaining({ source: 'logging', code: 'INVALID_OPTION' })
    )
  }
}

it(
  'A2 uses the exact installed core.features runtime for policy and controls',
  nativeOutputOwnsPolicy
)
it('A9 rejects retired host-level feature options at runtime', rejectHostFeatureOption)

/** The fixed aliases distinguish duplicate execution slots from record-name collisions. */
type ISingularPolicyPair = Readonly<{ first: ILogFeature; second: ILogFeature }>

/** Each pair occupies the same singular execution slot through two distinct record names. */
function singularPolicyPairs(): readonly ISingularPolicyPair[] {
  return [
    { first: formatFeature({ format: 'json' }), second: formatFeature({ format: 'plain' }) },
    { first: batchFeature({ maxSize: 1 }), second: batchFeature({ maxSize: 1 }) },
    { first: retryFeature({ attempts: 1 }), second: retryFeature({ attempts: 2 }) },
    { first: timeoutFeature({ ms: 100 }), second: timeoutFeature({ ms: 200 }) }
  ]
}

/** BC6: cold declarations stay valid until installation resolves an output's effective policies. */
async function singularPoliciesAtInstallation(): Promise<void> {
  for (const features of singularPolicyPairs()) {
    /** Both roots are legal definitions; the effective output owns their singular-slot check. */
    const coldOutput = defineOutputPlugin({
      name: 'collision-output',
      batchable: true,
      defaultFormat: 'json',
      features,
      deliver: ignoreNativeDelivery
    })
    expect(() => createLogHost({ plugins: [coldOutput] })).toThrowError(
      expect.objectContaining({ source: 'logging', code: 'INVALID_OPTION' })
    )
    /** A committed carrier and real output define the state against which a later install checks. */
    const output = new CaptureOutput()
    /** Different aliases prevent key conflicts from masking a duplicate execution slot. */
    const host = createLogHost({
      plugins: [
        defineLogPlugin({ name: 'first-policy', features: { first: features.first } }),
        output.plugin()
      ]
    })
    /** Constructing the incoming plugin cannot know its future output scopes. */
    const incoming = defineLogPlugin({
      name: 'second-policy',
      features: { second: features.second }
    })
    await expect(host.use(incoming)).rejects.toMatchObject({
      source: 'logging',
      code: 'INVALID_OPTION'
    })
    host.log('info', 'survives-rejected-install')
    await host.flush()
    expect(output.records.map(messageOf)).toEqual(['survives-rejected-install'])
    await host.shutdown('manual')
  }
}

/** Failed-install fixtures do not perform transport I/O. */
function ignoreNativeDelivery(): void {}

it(
  'BC6 checks effective format and delivery uniqueness during initial and later installs',
  singularPoliciesAtInstallation
)

/** BC6: actual serialized installation rechecks policies that were admitted before prior commits. */
async function queuedSingularPoliciesAtInstallation(): Promise<void> {
  for (const features of singularPolicyPairs()) {
    /** The output exists before either future carrier enters the native mutation queue. */
    const output = new CaptureOutput()
    /** No plugin callback runs in the empty batch that makes the native queue pending. */
    const host = createLogHost({ plugins: [output.plugin()] })
    /** Both following declarations enter while the canonical queue is pending, outside a hook. */
    const pending = host.use()
    /** The first queued mutation reserves one singular policy on actual installation. */
    const first = host.use(
      defineLogPlugin({ name: 'first-policy', features: { first: features.first } })
    )
    /** A different key cannot override that reservation when its own installation begins. */
    const second = host.use(
      defineLogPlugin({ name: 'second-policy', features: { second: features.second } })
    )
    /** Observe rejection immediately while preserving queue order and avoiding unhandled promises. */
    const results = await Promise.allSettled([pending, first, second])
    expect(results[0].status).toBe('fulfilled')
    expect(results[1].status).toBe('fulfilled')
    expect(results[2].status).toBe('rejected')
    if (results[2].status === 'rejected')
      expect(results[2].reason).toMatchObject({ source: 'logging', code: 'INVALID_OPTION' })
    host.log('info', 'first-policy-still-live')
    await host.flush()
    expect(output.records.map(messageOf)).toEqual(['first-policy-still-live'])
    await host.shutdown('manual')
  }
}

/** BC6: key admission must also be rechecked after a queued predecessor publishes its features. */
async function queuedHostKeyConflict(): Promise<void> {
  /** Different plugin names keep native plugin-name uniqueness independent from feature names. */
  const host = createLogHost()
  /** Empty native work queues both carriers without invoking a registration callback. */
  const pending = host.use()
  /** The first carrier owns the ordinary gate record key after installation. */
  const first = host.use(
    defineLogPlugin({
      name: 'first-policy',
      features: { gate: defineLogFeature({ phase: 'gate', accept: acceptNativeEntry }) }
    })
  )
  /** The second carrier has a distinct token but collides on the only supported naming authority. */
  const second = host.use(
    defineLogPlugin({
      name: 'second-policy',
      features: { gate: defineLogFeature({ phase: 'gate', accept: acceptNativeEntry }) }
    })
  )
  /** All receipts are observed before the queue advances into either install callback. */
  const results = await Promise.allSettled([pending, first, second])
  expect(results[0].status).toBe('fulfilled')
  expect(results[1].status).toBe('fulfilled')
  expect(results[2].status).toBe('rejected')
  if (results[2].status === 'rejected')
    expect(results[2].reason).toMatchObject({ source: 'logging', code: 'INVALID_OPTION' })
  await host.shutdown('manual')
}

it(
  'BC6 rechecks effective singular slots in concurrent queued use calls',
  queuedSingularPoliciesAtInstallation
)
it('BC6 rejects a host-wide key conflict in concurrent queued use calls', queuedHostKeyConflict)

/** A later compound batch must validate its new output against earlier and same-batch carriers. */
async function queuedCompoundOutputCollision(): Promise<void> {
  /** No output exists while the first carrier's format becomes an installed host-wide default. */
  const host = createLogHost()
  /** This output belongs to the failing compound batch and must never retain a sink. */
  const rejectedOutput = new CaptureOutput({ name: 'compound-output' })
  /** Empty native work permits both later operations to queue outside any install hook. */
  const pending = host.use()
  /** Format a remains valid because there is still no output with a singular format slot. */
  const first = host.use(
    defineLogPlugin({
      name: 'first-policy',
      features: { a: defineLogFeature({ phase: 'format', format: nativeText }) }
    })
  )
  /** Preparing the new output must see both a and the carrier prepared earlier in this batch. */
  const compound = host.use(
    defineLogPlugin({ name: 'second-policy', features: { b: formatFeature({ format: 'plain' }) } }),
    rejectedOutput.plugin()
  )
  /** Observe every receipt immediately so the expected rollback rejection stays handled. */
  const results = await Promise.allSettled([pending, first, compound])
  expect(results[0].status).toBe('fulfilled')
  expect(results[1].status).toBe('fulfilled')
  expect(results[2].status).toBe('rejected')
  if (results[2].status === 'rejected')
    expect(results[2].reason).toMatchObject({ source: 'logging', code: 'INVALID_OPTION' })
  /** Reusing both rejected names proves native registration rollback alongside scope retraction. */
  const recovered = new CaptureOutput({ name: 'compound-output' })
  await host.use(defineLogPlugin({ name: 'second-policy' }), recovered.plugin())
  host.log('info', 'after-compound-rollback')
  await host.flush()
  expect(recovered.records).toHaveLength(1)
  expect(recovered.records[0].text).toBe('native-format')
  expect(rejectedOutput.records).toEqual([])
  await host.shutdown('manual')
}

it(
  'validates a queued carrier-plus-output batch against prepared scopes and rolls back only that batch',
  queuedCompoundOutputCollision
)

/** Both SDK helpers must preserve native result admission while composing feature controls. */
function installResultPlugins(result: Record<string, unknown>): readonly ILogPluginConstraint[] {
  return [
    defineLogPlugin({
      name: 'admission-carrier',
      features: { threshold: thresholdFeature() },
      install: () => result
    }),
    defineOutputPlugin({
      name: 'admission-output',
      batchable: false,
      defaultFormat: 'json',
      features: { threshold: thresholdFeature() },
      install: () => result,
      deliver: ignoreNativeDelivery
    })
  ]
}

/** Observe descriptor evaluation and process rejection without consuming the rejected result. */
class InstallResultObservation {
  /** Native descriptor rejection must happen without invoking caller accessors. */
  getterReads = 0
  /** Native install admission owns rejection consumption; this observer only records escapes. */
  readonly unhandled: unknown[] = []

  /** Any evaluation would expose the earlier spread-based composition regression. */
  read(): string {
    this.getterReads++
    return 'accessor-result'
  }

  /** Keep process observation independent of native Promise rejection handling. */
  readonly receive = (reason: unknown): void => {
    this.unhandled.push(reason)
  }
}

/** SDK composition must pass accessor descriptors to the native extension validator unchanged. */
function rejectAccessorInstallResult(): void {
  /** A read counter distinguishes native descriptor inspection from object spread evaluation. */
  const observation = new InstallResultObservation()
  /** This enumerable accessor is deliberately unsupported by the native extension boundary. */
  const result = Object.defineProperty({}, 'value', {
    enumerable: true,
    configurable: true,
    get: () => observation.read()
  })
  for (const plugin of installResultPlugins(result))
    expect(() => createLogHost({ plugins: [plugin] })).toThrowError(
      expect.objectContaining({
        code: PluginHostErrorCode.pluginInstallFailed,
        cause: expect.objectContaining({ code: PluginHostErrorCode.invalidOption })
      })
    )
  expect(observation.getterReads).toBe(0)
}

/** Copying controls must not turn a forbidden non-configurable descriptor into valid data. */
function rejectNonconfigurableInstallResult(): void {
  /** Native admission rejects this public extension descriptor before mounting any controls. */
  const result = Object.defineProperty({}, 'value', {
    enumerable: true,
    configurable: false,
    value: 'locked-result'
  })
  for (const plugin of installResultPlugins(result))
    expect(() => createLogHost({ plugins: [plugin] })).toThrowError(
      expect.objectContaining({
        code: PluginHostErrorCode.pluginInstallFailed,
        cause: expect.objectContaining({ code: PluginHostErrorCode.invalidOption })
      })
    )
}

/** A rejected install Promise must reach native synchronous admission and remain consumed. */
async function rejectPromiseInstallResult(): Promise<void> {
  /** This listener observes escapes without attaching a rejection handler to the result itself. */
  const observation = new InstallResultObservation()
  process.on('unhandledRejection', observation.receive)
  try {
    /** The exact Promise must reach plugin-host instead of becoming an empty extension object. */
    const result = Promise.reject(new Error('rejected-install-result'))
    for (const plugin of installResultPlugins(result as unknown as Record<string, unknown>))
      expect(() => createLogHost({ plugins: [plugin] })).toThrowError(
        expect.objectContaining({
          code: PluginHostErrorCode.pluginInstallFailed,
          cause: expect.objectContaining({ code: PluginHostErrorCode.installResultThenable })
        })
      )
    await nextTurn()
    expect(observation.unhandled).toEqual([])
  } finally {
    process.off('unhandledRejection', observation.receive)
  }
}

it(
  'preserves native rejection of accessor install results without evaluating getters',
  rejectAccessorInstallResult
)
it(
  'preserves native rejection of non-configurable install-result descriptors',
  rejectNonconfigurableInstallResult
)
it(
  'preserves native synchronous rejection and consumption of rejected install Promises',
  rejectPromiseInstallResult
)

/** Generated controls must reject caller-name collisions before evaluating caller descriptors. */
function rejectControlExtensionCollision(): void {
  /** A collision must retain native duplicate identity without evaluating either accessor. */
  const observation = new InstallResultObservation()
  /** Each SDK helper has its own generated control name in this shared install-result fixture. */
  const result: Record<string, unknown> = {}
  for (const name of [
    'admission-carrier_threshold_setLevel',
    'admission-output_threshold_setLevel'
  ]) {
    // Exactly two helper names are fixed by installResultPlugins, independent of runtime input.
    Object.defineProperty(result, name, {
      enumerable: true,
      configurable: true,
      get: () => observation.read()
    })
  }
  for (const plugin of installResultPlugins(result))
    expect(() => createLogHost({ plugins: [plugin] })).toThrowError(
      expect.objectContaining({
        code: PluginHostErrorCode.pluginInstallFailed,
        cause: expect.objectContaining({ code: PluginHostErrorCode.extensionDuplicate })
      })
    )
  expect(observation.getterReads).toBe(0)
}

it(
  'rejects generated-control extension collisions through native duplicate identity without getter evaluation',
  rejectControlExtensionCollision
)
