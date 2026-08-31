import { PluginHost, type IPlugin } from '@migaia/plugin-host'
import type {
  IResolveReadyTrayPlugins,
  ITrayHostDynamic,
  ITrayResolvedHost
} from '../src/host/typing.js'

const budgetBaseline = {
  name: 'budget-baseline',
  install: () => ({ baselineExtension: true })
}

class BudgetHost extends PluginHost<
  Record<string, never>,
  string,
  readonly [typeof budgetBaseline]
> {}

type IBuildDefinitions<
  TCount extends number,
  TIndex extends readonly unknown[] = readonly [],
  TResult extends readonly unknown[] = readonly [],
  TFirstExtension extends Record<string, unknown> = Record<string, never>
> = TIndex['length'] extends TCount
  ? TResult
  : IBuildDefinitions<
      TCount,
      readonly [...TIndex, unknown],
      readonly [
        ...TResult,
        IPlugin<
          BudgetHost,
          TIndex['length'] extends 0 ? TFirstExtension : Record<string, never>
        > & {
          readonly name: `budget-${TIndex['length']}`
          readonly requires: readonly []
        }
      ],
      TFirstExtension
    >

type IExact64Definitions = IBuildDefinitions<
  64,
  readonly [],
  readonly [],
  { readonly exact64Extension: true }
>
type IReady64 = IResolveReadyTrayPlugins<IExact64Definitions>
type IReady128 = IResolveReadyTrayPlugins<IBuildDefinitions<128>>
type IReady129 = IResolveReadyTrayPlugins<IBuildDefinitions<129>>
type IReadyWidened = IResolveReadyTrayPlugins<readonly [{ readonly name: string }]>
type IWidenedName = readonly [
  {
    readonly name: string
    readonly install: () => { readonly widenedNameExtension: true }
  }
]
type IResolvedWidenedName = ITrayResolvedHost<BudgetHost, IWidenedName>
type IWidenedRequires = readonly [
  {
    readonly name: 'widened-requires'
    readonly requires: readonly string[]
    readonly install: () => Record<string, never>
  }
]
type IReadyWidenedRequires = IResolveReadyTrayPlugins<IWidenedRequires>
type IResolved64 = ITrayResolvedHost<BudgetHost, IExact64Definitions>
type IResolved128 = ITrayResolvedHost<BudgetHost, IBuildDefinitions<128>>
type IResolved129 = ITrayResolvedHost<BudgetHost, IBuildDefinitions<129>>
type IResolvedWidenedRequires = ITrayResolvedHost<BudgetHost, IWidenedRequires>

const bounded64: IReady64 extends readonly unknown[] ? true : false = true
const exact64Length: IReady64['length'] extends 64 ? true : false = true
const exact64Extension: IResolved64['extensions']['exact64Extension'] extends true ? true : false =
  true
const exact64UnknownNever: [IResolved64['extensions']['unknownManagedKey']] extends [never]
  ? true
  : false = true
const exact128: IReady128['length'] extends 128 ? true : false = true
const fallback129: IReady129 extends readonly [] ? true : false = true
const fallbackWidened: IReadyWidened extends readonly [] ? true : false = true
const fallbackWidenedRequires: IReadyWidenedRequires extends readonly [] ? true : false = true
const baseline64: boolean = {} as IResolved64['extensions']['baselineExtension']
const baseline128: boolean = {} as IResolved128['extensions']['baselineExtension']
const baseline129: boolean = {} as IResolved129['extensions']['baselineExtension']
const widenedNameDynamic: IResolvedWidenedName extends ITrayHostDynamic<BudgetHost> ? true : false =
  true
const widenedNameBaseline: boolean = {} as IResolvedWidenedName['extensions']['baselineExtension']
const widenedNameExtension: unknown =
  {} as IResolvedWidenedName['extensions']['widenedNameExtension']
const widenedNameUnknown: unknown = {} as IResolvedWidenedName['extensions']['unknownManagedKey']
// @ts-expect-error Widened-name fallback keeps unknown managed keys conservative.
const widenedNameUnknownBoolean: boolean =
  {} as IResolvedWidenedName['extensions']['unknownManagedKey']
const dynamicWidenedRequires: IResolvedWidenedRequires extends ITrayHostDynamic<BudgetHost>
  ? true
  : false = true
const dynamicBaseline129: boolean = {} as IResolved129['extensions']['baselineExtension']
const dynamicUnknown129: unknown = {} as IResolved129['extensions']['unknownManagedKey']
// @ts-expect-error Dynamic fallback keys remain unknown, even with the constructor baseline.
const dynamicUnknown129Boolean: boolean = {} as IResolved129['extensions']['unknownManagedKey']
const resolved129Dynamic: IResolved129 extends ITrayHostDynamic<BudgetHost> ? true : false = true

void bounded64
void exact64Length
void exact64Extension
void exact64UnknownNever
void exact128
void fallback129
void fallbackWidened
void fallbackWidenedRequires
void baseline64
void baseline128
void baseline129
void widenedNameDynamic
void widenedNameBaseline
void widenedNameExtension
void widenedNameUnknown
void widenedNameUnknownBoolean
void dynamicWidenedRequires
void dynamicBaseline129
void dynamicUnknown129
void dynamicUnknown129Boolean
void resolved129Dynamic
