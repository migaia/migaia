import { describe, expect, it } from 'vitest'
import { defineFeature, PluginHost, type IPlugin } from '@migaia/plugin-host'
import {
  createHost,
  type IHostBaselinePlugins,
  type IResolveReadyTrayPlugins,
  type ITrayHost,
  type ITrayHostDynamic,
  type ITrayResolvedHost,
  type ITrayPluginMutationResult,
  type ITrayPluginRemovalResult
} from '../src/host/index.js'
import type { IRuntime } from '../src/runtime/typing.js'

type ITestCore = Record<string, never>
type IReadyConfig = Readonly<{ readonly enabled: boolean }>

class TypeHost extends PluginHost<ITestCore, string> {}

const baselinePlugin = {
  name: 'baseline',
  config: { enabled: true },
  install: () => ({ baselineExtension: true })
} satisfies IPlugin<any, { readonly baselineExtension: boolean }, IReadyConfig>

class BaselineTypeHost extends PluginHost<ITestCore, string, readonly [typeof baselinePlugin]> {}

type IBaselinePlugins = IHostBaselinePlugins<BaselineTypeHost>
const baselineTupleLength: IBaselinePlugins['length'] = 1
type IWidenedManagedDefinitions = readonly (IPlugin<BaselineTypeHost> & {
  readonly name: string
  readonly requires?: readonly string[]
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
  install: (_core: TypeHost) => ({ readyExtension: true })
} satisfies IPlugin<TypeHost, { readonly readyExtension: boolean }, IReadyConfig> & {
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

const blockedPlugin = {
  name: 'blocked',
  requires: ['missing'] as const,
  install: (_core: TypeHost) => ({ blockedExtension: true })
} satisfies IPlugin<TypeHost, { readonly blockedExtension: boolean }> & {
  readonly requires: readonly ['missing']
}

const latePlugin = {
  name: 'late',
  install: (_core: TypeHost) => ({ lateExtension: true })
} satisfies IPlugin<TypeHost, { readonly lateExtension: boolean }>

const providerPlugin = {
  name: 'provider',
  install: (_core: TypeHost) => ({ providerExtension: true })
} satisfies IPlugin<TypeHost, { readonly providerExtension: boolean }>

const dependentPlugin = {
  name: 'dependent',
  requires: ['provider'] as const,
  install: (_core: TypeHost) => ({ dependentExtension: true })
} satisfies IPlugin<TypeHost, { readonly dependentExtension: boolean }> & {
  readonly requires: readonly ['provider']
}

const cycleA = {
  name: 'cycle-a',
  requires: ['cycle-b'] as const,
  install: (_core: TypeHost) => ({ cycleAExtension: true })
} satisfies IPlugin<TypeHost, { readonly cycleAExtension: boolean }> & {
  readonly requires: readonly ['cycle-b']
}

const cycleB = {
  name: 'cycle-b',
  requires: ['cycle-a'] as const,
  install: (_core: TypeHost) => ({ cycleBExtension: true })
} satisfies IPlugin<TypeHost, { readonly cycleBExtension: boolean }> & {
  readonly requires: readonly ['cycle-a']
}

const replacementPlugin = {
  name: 'ready',
  install: (_core: TypeHost) => ({ replacementExtension: true })
} satisfies IPlugin<TypeHost, { readonly replacementExtension: boolean }>

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
    const added = await host.use({
      ...latePlugin
    } as never)
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
      install: (_core: TypeHost) => ({ branchExtension: true })
    } as never)
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
    expect(literalRemoval.view.extensions.providerExtension).toBeUndefined()
    expect(literalRemoval.view.extensions.dependentExtension).toBeUndefined()
    const widenedName: string = 'missing'
    const noCommit = await host.unUse(widenedName)
    expect(noCommit.committed).toBe(false)
    expect(noCommit.view.extensions.unknown).toBeUndefined()
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
      readonly [
        ...TResult,
        { readonly name: `budget-${TIndex['length']}`; readonly requires: readonly [] }
      ]
    >

type IReady64 = IResolveReadyTrayPlugins<IBuildDefinitions<64>>
type IReady128 = IResolveReadyTrayPlugins<IBuildDefinitions<128>>
type IReady64IsBounded = IReady64 extends readonly unknown[] ? true : false
type IAssert128 = IReady128['length'] extends 128 ? true : false

const typeBudget64: IReady64IsBounded = true
const typeBudget128: IAssert128 = true
void typeBudget64
void typeBudget128
