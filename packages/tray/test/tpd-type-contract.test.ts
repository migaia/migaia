import type {
  IHostBaselinePlugins,
  ICanResolveReadyDefinitions,
  IResolveReadyTrayPlugins
} from '../src/host/typing.js'
import { describe, expect, it } from 'vitest'
import {
  defineFeature,
  definePlugin,
  PluginHost,
  type IFeatureReference,
  type IPlugin
} from '@migaia/plugin-host'
import {
  createHost,
  type ITrayHost,
  type ITrayHostDynamic,
  type ITrayResolvedHost,
  type ITrayPluginCore,
  type ITrayPluginMutationResult,
  type ITrayPluginRemovalResult
} from '../src/host/index.js'
import type { IRuntime } from '../src/runtime/typing.js'

type ITestCore = Record<string, never>
type IReadyConfig = Readonly<{ readonly enabled: boolean }>

class TypeHost extends PluginHost<ITestCore, string> {}
/** Hooks of managed Tray plugins receive the declared domain core, not the Host handle. */
type ITypeCore = ITrayPluginCore<TypeHost>

const baselinePlugin = {
  name: 'baseline',
  config: { enabled: true },
  install: () => ({ baselineExtension: true })
} satisfies IPlugin<any, { readonly baselineExtension: boolean }, IReadyConfig>

class BaselineTypeHost extends PluginHost<ITestCore, string, readonly [typeof baselinePlugin]> {}
/** Domain core seen by plugins managed on the baseline Host. */
type IBaselineTypeCore = ITrayPluginCore<BaselineTypeHost>

type IBaselinePlugins = IHostBaselinePlugins<BaselineTypeHost>
const baselineTupleLength: IBaselinePlugins['length'] = 1
type IWidenedManagedDefinitions = readonly (IPlugin<IBaselineTypeCore> & {
  readonly name: string
})[]
type IWidenedResolvedHost = ITrayResolvedHost<BaselineTypeHost, IWidenedManagedDefinitions>
const widenedBaselineExtension: boolean =
  {} as IWidenedResolvedHost['extensions']['baselineExtension']
const widenedUnknownExtension: unknown =
  {} as IWidenedResolvedHost['extensions']['unknownManagedExtension']
void baselineTupleLength
void widenedBaselineExtension
void widenedUnknownExtension

const readyPlugin = {
  name: 'ready',
  config: { enabled: true },
  features: { ready: defineFeature(() => ({ readyValue: 42 })) },
  install: (_core: ITypeCore) => ({ readyExtension: true })
} satisfies IPlugin<ITypeCore, { readonly readyExtension: boolean }, IReadyConfig> & {
  readonly name: 'ready'
}

const exactRuntime = undefined as unknown as IRuntime<readonly [typeof readyPlugin]>
if (exactRuntime)
  exactRuntime.run('ready', { timeoutMs: false }, ({ extensions, self }) => {
    const exact: boolean = extensions.readyExtension
    const ticket = self.unUse()
    const completion: Promise<unknown> = ticket.completion
    // @ts-expect-error Self tickets are intentionally non-thenable.
    const thenProperty = ticket.then
    void completion
    void thenProperty
    return exact
  })
const dynamicRuntimeName: string = 'ready'
if (exactRuntime)
  exactRuntime.run(dynamicRuntimeName, { timeoutMs: false }, ({ extensions }) => {
    const widened: unknown = extensions.unknownManagedExtension
    return widened
  })

/** Captures exact empty Feature dependencies before a plugin descriptor contextualizes its roots. */
const providerCapability = defineFeature(() => ({}))

/** Declares the provider identity without admitting it to the managed Host. */
const missingProvider = definePlugin({
  name: 'missing',
  features: { capability: providerCapability },
  install: () => ({})
})

/** Required Feature references keep this consumer outside the initial ready closure. */
const blockedPlugin = {
  name: 'blocked' as const,
  features: {
    blocked: defineFeature(() => ({}), { missing: missingProvider.getFeature('capability') })
  },
  install: (_core: ITypeCore) => ({ blockedExtension: true })
} satisfies IPlugin<ITypeCore, { readonly blockedExtension: boolean }>

const latePlugin = {
  name: 'late' as const,
  install: (_core: ITypeCore) => ({ lateExtension: true })
} satisfies IPlugin<ITypeCore, { readonly lateExtension: boolean }>

/** Public references carry this provider's literal name into exact Tray inference. */
const providerPlugin = definePlugin({
  name: 'provider',
  features: { capability: providerCapability },
  install: (_core: ITypeCore) => ({ providerExtension: true })
})

/** The dependent follows the same Feature edge at runtime and in mutation view types. */
const dependentPlugin = {
  name: 'dependent' as const,
  features: {
    dependent: defineFeature(() => ({}), { provider: providerPlugin.getFeature('capability') })
  },
  install: (_core: ITypeCore) => ({ dependentExtension: true })
} satisfies IPlugin<ITypeCore, { readonly dependentExtension: boolean }>

/** Separate definitions mint the references needed to declare a cross-plugin cycle. */
const cycleAProvider = definePlugin({
  name: 'cycle-a' as const,
  features: { capability: providerCapability },
  install: () => ({})
})
/** Only the cycle consumer definitions below are admitted by the cycle oracle. */
const cycleBProvider = definePlugin({
  name: 'cycle-b' as const,
  features: { capability: providerCapability },
  install: () => ({})
})

/** This admitted definition depends on the other side of the cycle. */
const cycleA = {
  name: 'cycle-a' as const,
  features: {
    capability: defineFeature(() => ({}), { b: cycleBProvider.getFeature('capability') })
  },
  install: (_core: ITypeCore) => ({ cycleAExtension: true })
} satisfies IPlugin<ITypeCore, { readonly cycleAExtension: boolean }>

/** This admitted definition closes the required cycle. */
const cycleB = {
  name: 'cycle-b' as const,
  features: {
    capability: defineFeature(() => ({}), { a: cycleAProvider.getFeature('capability') })
  },
  install: (_core: ITypeCore) => ({ cycleBExtension: true })
} satisfies IPlugin<ITypeCore, { readonly cycleBExtension: boolean }>

/** An optional absent provider contributes ordering without excluding its consumer. */
const optionalPlugin = {
  name: 'optional' as const,
  features: {
    optional: defineFeature(() => ({}), {
      missing: missingProvider.getFeature('capability', { optional: true })
    })
  },
  install: (_core: ITypeCore) => ({ optionalExtension: true })
} satisfies IPlugin<ITypeCore, { readonly optionalExtension: boolean }>

/** Local Feature closures must retain dependencies even when only the outer Feature is a root. */
const nestedDependency = defineFeature(() => ({}), {
  missing: missingProvider.getFeature('capability')
})
/** A nested dependency prevents the independent-definition fast path from inventing readiness. */
const nestedPlugin = {
  name: 'nested' as const,
  features: { outer: defineFeature(() => ({}), { inner: nestedDependency }) },
  install: (_core: ITypeCore) => ({ nestedExtension: true })
} satisfies IPlugin<ITypeCore, { readonly nestedExtension: boolean }>

/** Erasing a required provider literal forces a conservative dynamic view. */
const widenedRequiredReference: IFeatureReference<object> = providerPlugin.getFeature('capability')
/** Optional references with erased provider literals require the same dynamic fallback. */
const widenedOptionalReference: IFeatureReference<object, true> = providerPlugin.getFeature(
  'capability',
  { optional: true }
)
/** This literal plugin name cannot compensate for an unknown required provider. */
const widenedRequiredPlugin = {
  name: 'widened-required' as const,
  features: { capability: defineFeature(() => ({}), { provider: widenedRequiredReference }) },
  install: (_core: ITypeCore) => ({ widenedRequiredExtension: true })
} satisfies IPlugin<ITypeCore, { readonly widenedRequiredExtension: boolean }>
/** Unknown optional providers cannot claim an exact independent-definition view either. */
const widenedOptionalPlugin = {
  name: 'widened-optional' as const,
  features: { capability: defineFeature(() => ({}), { provider: widenedOptionalReference }) },
  install: (_core: ITypeCore) => ({ widenedOptionalExtension: true })
} satisfies IPlugin<ITypeCore, { readonly widenedOptionalExtension: boolean }>

type IFeatureChainHost = ITrayResolvedHost<
  TypeHost,
  readonly [typeof dependentPlugin, typeof providerPlugin]
>
/** A4: readiness resolves a literal two-plugin chain even in consumer-first order. */
const featureChainProviderExtension: boolean =
  {} as IFeatureChainHost['extensions']['providerExtension']
/** A4: the consumer extension appears only after its required provider resolves. */
const featureChainDependentExtension: boolean =
  {} as IFeatureChainHost['extensions']['dependentExtension']
type IMissingRequiredReady = IResolveReadyTrayPlugins<readonly [typeof blockedPlugin]>
/** A4: required missing providers exclude their consumer from the inferred ready tuple. */
const missingRequiredReadyLength: IMissingRequiredReady['length'] = 0
type IAbsentOptionalHost = ITrayResolvedHost<TypeHost, readonly [typeof optionalPlugin]>
/** A4: optional missing providers preserve an exact consumer extension. */
const absentOptionalExtension: boolean =
  {} as IAbsentOptionalHost['extensions']['optionalExtension']
type INestedReady = IResolveReadyTrayPlugins<readonly [typeof nestedPlugin]>
/** A4: traversing a local Feature closure finds the absent required provider. */
const nestedReadyLength: INestedReady['length'] = 0
/** A4: required references without literal providers disable exact inference. */
const widenedRequiredExact: ICanResolveReadyDefinitions<readonly [typeof widenedRequiredPlugin]> =
  false
/** A4: optional references without literal providers also disable exact inference. */
const widenedOptionalExact: ICanResolveReadyDefinitions<readonly [typeof widenedOptionalPlugin]> =
  false
type IWidenedRequiredHost = ITrayResolvedHost<TypeHost, readonly [typeof widenedRequiredPlugin]>
type IWidenedOptionalHost = ITrayResolvedHost<TypeHost, readonly [typeof widenedOptionalPlugin]>
// @ts-expect-error A4: a widened required provider exposes managed extension keys only as unknown.
const widenedRequiredExtension: boolean =
  {} as IWidenedRequiredHost['extensions']['widenedRequiredExtension']
// @ts-expect-error A4: an optional widened provider cannot take the exact independent fast path.
const widenedOptionalExtension: boolean =
  {} as IWidenedOptionalHost['extensions']['widenedOptionalExtension']
void featureChainProviderExtension
void featureChainDependentExtension
void missingRequiredReadyLength
void absentOptionalExtension
void nestedReadyLength
void widenedRequiredExact
void widenedOptionalExact
void widenedRequiredExtension
void widenedOptionalExtension

const replacementPlugin = {
  name: 'ready',
  install: (_core: ITypeCore) => ({ replacementExtension: true })
} satisfies IPlugin<ITypeCore, { readonly replacementExtension: boolean }>

const hostOptions = {
  create: () =>
    new TypeHost({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }),
  plugins: [readyPlugin, blockedPlugin] as const,
  mutationAdmissionMs: 100,
  quiescenceMs: 100,
  shutdown: { mode: 'bounded' as const }
}

type IReadyOnlyHost = ITrayHost<TypeHost, typeof hostOptions.plugins, readonly [typeof readyPlugin]>
type IAfterUseHost = ITrayHost<
  TypeHost,
  readonly [typeof readyPlugin, typeof blockedPlugin, typeof latePlugin],
  readonly [typeof readyPlugin, typeof latePlugin]
>
type IProviderHost = ITrayHost<
  TypeHost,
  readonly [typeof providerPlugin, typeof dependentPlugin],
  readonly [typeof providerPlugin, typeof dependentPlugin]
>
type IProviderRemovedHost = ITrayHost<
  TypeHost,
  readonly [typeof providerPlugin, typeof dependentPlugin],
  readonly []
>
type IReplacementHost = ITrayHost<
  TypeHost,
  typeof hostOptions.plugins,
  readonly [typeof replacementPlugin]
>
type ICycleHost = ITrayHost<TypeHost, readonly [typeof cycleA, typeof cycleB], readonly []>
const cycleExtensions: ICycleHost['extensions'] = {}
// @ts-expect-error Cyclic definitions are never typed as ready capabilities.
const cycleExtensionNegative: ICycleHost['extensions']['cycleAExtension'] = true
void cycleExtensions
void cycleExtensionNegative
type IReadyExtensionPresent = IReadyOnlyHost['extensions'] extends {
  readonly readyExtension: boolean
}
  ? true
  : false
type IBlockedExtensionAbsent = IReadyOnlyHost['extensions'] extends {
  readonly blockedExtension: unknown
}
  ? false
  : true
const readyExtensionAssertion: IReadyExtensionPresent = true
const blockedExtensionAssertion: IBlockedExtensionAbsent = true
void readyExtensionAssertion
void blockedExtensionAssertion

type IReadyExtensions = IReadyOnlyHost['extensions']
const readyExtensions: IReadyExtensions = { readyExtension: true }
// @ts-expect-error Blocked definitions must not contribute ready extension typing.
const blockedExtensions: IReadyExtensions = { blockedExtension: true }
void readyExtensions
void blockedExtensions

type IDynamicExtensions = ITrayHostDynamic<TypeHost>['extensions']
const dynamicExtensions: IDynamicExtensions = { baseline: true }
const dynamicBaseline: IDynamicExtensions = {} as IDynamicExtensions
type IDynamicUnknownExtension = IDynamicExtensions['baseline']
const dynamicUnknownExtension: unknown = undefined as IDynamicUnknownExtension
// @ts-expect-error Widened managed keys are unknown, not booleans.
const dynamicUnknownBoolean: boolean = undefined as IDynamicUnknownExtension
type IDynamicBaselineHost = ITrayHostDynamic<TypeHost, IReadyExtensions>
const dynamicReadyExtension: boolean =
  undefined as unknown as IDynamicBaselineHost['extensions']['readyExtension']
const dynamicUnknownKey: unknown =
  undefined as unknown as IDynamicBaselineHost['extensions']['unknownManagedKey']
// @ts-expect-error Dynamic managed keys stay unknown even when baseline keys are retained.
const dynamicUnknownKeyBoolean: boolean =
  undefined as unknown as IDynamicBaselineHost['extensions']['unknownManagedKey']
void dynamicExtensions
void dynamicBaseline
void dynamicUnknownExtension
void dynamicUnknownBoolean
void dynamicReadyExtension
void dynamicUnknownKey
void dynamicUnknownKeyBoolean

type IUseResult = ITrayPluginMutationResult<
  IReadyOnlyHost,
  IAfterUseHost,
  ITrayHostDynamic<TypeHost, IReadyOnlyHost['extensions']>
>
type IUseSuccess = Extract<IUseResult, { readonly ok: true; readonly committed: true }>
type IUseUncommittedFailure = Extract<IUseResult, { readonly ok: false; readonly committed: false }>
type IUseCommittedFailure = Extract<IUseResult, { readonly ok: false; readonly committed: true }>
const useSuccessView: IUseSuccess['view'] = {} as IUseSuccess['view']
const useUncommittedView: IUseUncommittedFailure['view'] = {} as IUseUncommittedFailure['view']
const useCommittedView: IUseCommittedFailure['view'] = {} as IUseCommittedFailure['view']
type IUseSuccessHasNoBlockedExtension = IUseSuccess['view']['extensions'] extends {
  readonly blockedExtension: unknown
}
  ? false
  : true
const useSuccessSurfaceAssertion: IUseSuccessHasNoBlockedExtension = true
const useSuccessLateExtensionAssertion: boolean =
  {} as IUseSuccess['view']['extensions']['lateExtension']
// @ts-expect-error Precommit failure must retain the exact previous view and not expose late.
const useFailureLateExtensionNegative: IUseUncommittedFailure['view']['extensions']['lateExtension'] = true
const useCommittedBaselineExtensionAssertion: boolean =
  {} as IUseCommittedFailure['view']['extensions']['readyExtension']
// @ts-expect-error Dynamic committed-failure keys remain unknown.
const useCommittedUnknownBoolean: boolean = ({} as IUseCommittedFailure['view']['extensions'])
  .unknownManagedKey
const useSuccessCommitAssertion: IUseSuccess['committed'] = true
// @ts-expect-error A successful use branch cannot be marked uncommitted.
const useSuccessCommitNegative: IUseSuccess['committed'] = false
const useSuccessOkAssertion: IUseSuccess['ok'] = true
// @ts-expect-error A successful use branch cannot be marked failed.
const useSuccessOkNegative: IUseSuccess['ok'] = false
void useSuccessView
void useUncommittedView
void useCommittedView
void useSuccessSurfaceAssertion
void useSuccessLateExtensionAssertion
void useFailureLateExtensionNegative
void useCommittedBaselineExtensionAssertion
void useCommittedUnknownBoolean
void useSuccessCommitAssertion
void useSuccessCommitNegative
void useSuccessOkAssertion
void useSuccessOkNegative

type IRemovalResult = ITrayPluginRemovalResult<IProviderHost, IProviderRemovedHost>
type IRemovalCommitted = Extract<IRemovalResult, { readonly committed: true }>
type IRemovalUncommitted = Extract<IRemovalResult, { readonly committed: false }>
const removalCommittedView: IRemovalCommitted['view'] = {} as IRemovalCommitted['view']
const removalUncommittedView: IRemovalUncommitted['view'] = {} as IRemovalUncommitted['view']
void removalCommittedView
void removalUncommittedView
const removalCommittedAssertion: IRemovalCommitted['removed'] = true
// @ts-expect-error A committed removal always reports removed=true.
const removalCommittedNegative: IRemovalCommitted['removed'] = false
const removalUncommittedAssertion: IRemovalUncommitted['removed'] = false
// @ts-expect-error An uncommitted removal cannot report removed=true.
const removalUncommittedNegative: IRemovalUncommitted['removed'] = true
void removalCommittedAssertion
void removalCommittedNegative
void removalUncommittedAssertion
void removalUncommittedNegative
const removalPreviousProviderExtension: boolean =
  {} as IRemovalUncommitted['view']['extensions']['providerExtension']
// @ts-expect-error Committed provider removal must not retain provider extensions.
const removalCommittedProviderNegative: IRemovalCommitted['view']['extensions']['providerExtension'] = true
void removalPreviousProviderExtension
void removalCommittedProviderNegative

type IReplaceResult = ITrayPluginMutationResult<
  IReadyOnlyHost,
  IReplacementHost,
  ITrayHostDynamic<TypeHost, IReadyOnlyHost['extensions']>
>
type IReplaceSuccess = Extract<IReplaceResult, { readonly ok: true; readonly committed: true }>
type IReplaceCommittedFailure = Extract<
  IReplaceResult,
  { readonly ok: false; readonly committed: true }
>
const replaceSuccessView: IReplaceSuccess['view'] = {} as IReplaceSuccess['view']
const replaceCommittedFailureView: IReplaceCommittedFailure['view'] =
  {} as IReplaceCommittedFailure['view']
void replaceSuccessView
void replaceCommittedFailureView
const replaceSuccessCommitAssertion: IReplaceSuccess['committed'] = true
const replaceFailureCommitAssertion: IReplaceCommittedFailure['committed'] = true
// @ts-expect-error The replace committed-failure branch is not a successful mutation.
const replaceFailureOkNegative: IReplaceCommittedFailure['ok'] = true
const replaceSuccessExtensionAssertion: boolean =
  {} as IReplaceSuccess['view']['extensions']['replacementExtension']
// @ts-expect-error The previous replace view cannot expose the replacement extension.
const replacePreviousExtensionNegative: IReadyOnlyHost['extensions']['replacementExtension'] = true
// @ts-expect-error Committed replace failure retains baseline, not replacement keys.
const replaceFailureExtensionNegative: boolean = (
  {} as IReplaceCommittedFailure['view']['extensions']
).replacementExtension
void replaceSuccessCommitAssertion
void replaceFailureCommitAssertion
void replaceFailureOkNegative
void replaceSuccessExtensionAssertion
void replacePreviousExtensionNegative
void replaceFailureExtensionNegative

describe('TPD-T45 through TPD-T49 managed Host declaration contract', () => {
  it('TPD-T45 exposes only the initial ready fixed point', async () => {
    const host = await createHost(hostOptions)
    expect(host.extensions).toBeDefined()
    expect(host.config.get('ready.enabled')).toBe(true)
    expect(host.extensions.readyExtension).toBe(true)
    await host.dispose()
    await expect(
      createHost({ ...hostOptions, plugins: [cycleA, cycleB] as const })
    ).rejects.toMatchObject({ detail: { phase: 'factory' } })
  })

  it('TPD-T46 preserves a safe dynamic baseline surface', async () => {
    const host = await createHost(hostOptions)
    expect(host.config.get('ready.enabled')).toBe(true)
    expect(host.extensions.readyExtension).toBe(true)
    const added = await host.use(latePlugin)
    if (added.ok) {
      expect(added.view.extensions.readyExtension).toBe(true)
      expect(added.view.extensions.lateExtension).toBe(true)
    }
    await host.dispose()
  })

  it('TPD-T47 narrows use branches by commit discriminants', async () => {
    const host = await createHost(hostOptions)
    const result = await host.use({
      name: 'branch',
      install: (_core: ITypeCore) => ({ branchExtension: true })
    })
    if (result.ok) {
      expect(result.committed).toBe(true)
      expect(result.view.extensions.branchExtension).toBe(true)
    } else if (result.committed) {
      expect(result.view.pluginState('branch')).toBeDefined()
    } else {
      expect(result.error).toBeInstanceOf(Error)
    }
    await host.dispose()
  })

  it('TPD-T48 returns a conservative dynamic view for widened removal', async () => {
    const host = await createHost({
      ...hostOptions,
      plugins: [providerPlugin, dependentPlugin] as const
    })
    const literalRemoval = await host.unUse('provider')
    expect(literalRemoval.removed).toBe(true)
    expect(literalRemoval.affected).toEqual(['provider', 'dependent'])
    expect(host.pluginState('provider')).toBe('blocked')
    expect(host.pluginState('dependent')).toBe('blocked')
    expect(Reflect.get(literalRemoval.view.extensions, 'providerExtension')).toBeUndefined()
    expect(Reflect.get(literalRemoval.view.extensions, 'dependentExtension')).toBeUndefined()
    const widenedName: string = 'missing'
    const noCommit = await host.unUse(widenedName)
    expect(noCommit.committed).toBe(false)
    expect(Reflect.get(noCommit.view.extensions, 'unknown')).toBeUndefined()
    await host.dispose()
  })

  it('TPD-T49 keeps replace results honest across commit branches', async () => {
    const host = await createHost(hostOptions)
    const result = await host.replace(replacementPlugin)
    expect(result.ok).toBe(true)
    const replacementView = result.view as unknown as {
      readonly extensions: Readonly<{
        readonly replacementExtension?: boolean
        readonly readyExtension?: boolean
      }>
    }
    expect(replacementView.extensions.replacementExtension).toBe(true)
    expect(replacementView.extensions.readyExtension).toBeUndefined()
    const failure = await host.replace({
      name: 'ready',
      install: () => {
        throw new Error('replace setup failure')
      }
    } as never)
    expect(failure.ok).toBe(false)
    expect(failure.committed).toBe(true)
    const failureView = failure.view as unknown as typeof replacementView
    expect(failureView.extensions.readyExtension).toBeUndefined()
    expect(failureView.extensions.replacementExtension).toBeUndefined()
    await host.dispose()
  })
})

type IBuildDefinitions<
  TCount extends number,
  TIndex extends readonly unknown[] = readonly [],
  TResult extends readonly unknown[] = readonly []
> = TIndex['length'] extends TCount
  ? TResult
  : IBuildDefinitions<
      TCount,
      readonly [...TIndex, unknown],
      readonly [...TResult, { readonly name: `budget-${TIndex['length']}` }]
    >

type IReady64 = IResolveReadyTrayPlugins<IBuildDefinitions<64>>
type IReady128 = IResolveReadyTrayPlugins<IBuildDefinitions<128>>
type IReady64IsBounded = IReady64 extends readonly unknown[] ? true : false
type IAssert128 = IReady128['length'] extends 128 ? true : false

const typeBudget64: IReady64IsBounded = true
const typeBudget128: IAssert128 = true
void typeBudget64
void typeBudget128
