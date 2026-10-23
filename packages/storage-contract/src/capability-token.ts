import type { IAnyStorageCapability, IStorageCapability } from './capability.js'
import { StorageContractError, StorageContractErrorCode } from './errors.js'
import { StorageContractErrorText } from './error-text.js'

/** Standard transaction projections name only their finite original methods and pure query fact. */
export type ICapabilityTransactionFacts = {
  readonly methods: readonly string[]
  readonly query?: true
  readonly sql?: true
  readonly rdf?: true
}
/** Only authentic standard tokens carry validation and projection facts in the identity row. */
export type ICapabilityTokenFacts = {
  readonly validate: (api: unknown) => void
  readonly transaction?: ICapabilityTransactionFacts
  readonly flatKeyValue?: true
}
/** The original identity table also owns standard facts; custom tokens deliberately have none. */
const tokens = new WeakMap<object, ICapabilityTokenFacts | undefined>()

/** Retains the original argument boundary and reflected cause before capability publication. */
export function invalidCapability(cause?: unknown): StorageContractError {
  return new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    { cause },
    StorageContractErrorText.capabilityArgument
  )
}
/** Standard modules share callable-shape admission without importing each other into the provider. */
export function validateCapabilityMethods(value: unknown, methods: readonly string[]): void {
  if (
    typeof value !== 'object' ||
    value === null ||
    methods.some((method) => typeof (value as Record<string, unknown>)[method] !== 'function')
  )
    throw invalidCapability()
}
/** Issues one frozen token; names remain diagnostics and never authorize another same-name token. */
function createCapabilityToken<TApi, TName extends string>(
  name: TName,
  facts?: ICapabilityTokenFacts
): IStorageCapability<TName, TApi> {
  if (typeof name !== 'string' || name.length === 0) throw invalidCapability()
  /** The exact original object is the only identity admitted by every capability lookup. */
  const token = Object.freeze({ name }) as IStorageCapability<TName, TApi>
  tokens.set(token, facts)
  return token
}
/** Defines a custom capability contract without importing or acquiring any standard capability. */
export function defineStorageCapability<TApi>(): <const TName extends string>(
  name: TName
) => IStorageCapability<TName, TApi> {
  return <const TName extends string>(name: TName) => createCapabilityToken<TApi, TName>(name)
}
/** Private standard construction attaches trusted facts to that same original identity row. */
export function defineStandardStorageCapability<TApi, TName extends string>(
  name: TName,
  facts: ICapabilityTokenFacts
): IStorageCapability<TName, TApi> {
  return createCapabilityToken<TApi, TName>(name, Object.freeze(facts))
}
/** Authenticity never reads user names, brands or accessors. */
export function isCapabilityToken(value: unknown): value is IAnyStorageCapability {
  return typeof value === 'object' && value !== null && tokens.has(value)
}
/** Reads only the original token row; custom identities return no standard semantics. */
export function readCapabilityTokenFacts(
  token: IAnyStorageCapability
): ICapabilityTokenFacts | undefined {
  return tokens.get(token)
}
