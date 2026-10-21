import { MicroHubErrorCode } from './error-code.js'
import { MicroHubErrorText } from './error-text.js'
import { createMicroHubTypeError } from './errors.js'
import { ContractMarker, ContractSection, NameKind } from './text.js'

/** Marks a contract event; `T` is the payload type and exists only at the type level. */
export type IEventMarker<T> = {
  readonly marker: typeof ContractMarker.event
  readonly __payload?: T
}

/** Marks a contract request with input `TIn` and output `TOut`, both type-level only. */
export type IRequestMarker<TIn, TOut> = {
  readonly marker: typeof ContractMarker.request
  readonly __input?: TIn
  readonly __output?: TOut
}

/** Marks a state field as an entity table keyed by string id with values of type `T`. */
export type IKeyedMarker<T> = { readonly marker: typeof ContractMarker.keyed; readonly __value?: T }

/** Marks a shared async value of type `T` that the owner provides with a fetcher. */
export type IResourceMarker<T> = {
  readonly marker: typeof ContractMarker.resource
  readonly __value?: T
}

/** Declares a contract event whose payload is `T`. */
export const event = <T = void>(): IEventMarker<T> =>
  Object.freeze({ marker: ContractMarker.event })

/** Declares a contract request answered by the owner's single handler. */
export const request = <TIn = void, TOut = void>(): IRequestMarker<TIn, TOut> =>
  Object.freeze({ marker: ContractMarker.request })

/** Declares an entity-table state field; each id is subscribed independently. */
export const keyed = <T>(): IKeyedMarker<T> => Object.freeze({ marker: ContractMarker.keyed })

/** Declares a shared async value; the owner supplies the fetcher with `provide()`. */
export const resource = <T>(): IResourceMarker<T> =>
  Object.freeze({ marker: ContractMarker.resource })

/** Read-only view of a keyed field inside commands and selectors. */
export type IKeyedSnapshot<T> = {
  /** Value for `id`, or `undefined` when absent. */
  get(id: string): T | undefined
  /** Present ids in insertion order. */
  readonly ids: readonly string[]
}

/** The state section of a contract spec: plain initial values or `keyed()` markers. */
export type IStateSpec = Record<string, unknown>

/** Value of one state field as commands, selectors and computed values read it. */
export type IStateValue<V> = V extends IKeyedMarker<infer T> ? IKeyedSnapshot<T> : V

/** All state fields as commands, selectors and computed values read them. */
export type IStateValues<S> = { readonly [K in keyof S]: IStateValue<S[K]> }

/**
 * What a command returns: only the fields it changes. A keyed field takes an id map where
 * `undefined` deletes the id; omitted fields and ids keep their value.
 */
export type IStatePatch<S> = {
  readonly [K in keyof S]?: S[K] extends IKeyedMarker<infer T>
    ? Readonly<Record<string, T | undefined>>
    : S[K]
}

/** A computed value: a pure function of state, recomputed only when a field it read changes. */
export type IComputedFn<S> = (state: IStateValues<S>) => unknown

/** A command: synchronous, pure, receives current state plus the caller's arguments. */
export type ICommandFn<S> = (state: IStateValues<S>, ...args: any[]) => IStatePatch<S>

/** Contract spec accepted by {@link defineContract}. */
export type IContractSpec<
  TState extends IStateSpec,
  TComputed extends Record<string, IComputedFn<TState>>,
  TCommands extends Record<string, ICommandFn<TState>>,
  TEvents extends Record<string, IEventMarker<any>>,
  TRequests extends Record<string, IRequestMarker<any, any>>,
  TResources extends Record<string, IResourceMarker<any>>
> = {
  /** Major version; apps using the same contract name must agree on it. */
  readonly version: number
  readonly state?: TState
  readonly computed?: TComputed & Record<string, IComputedFn<NoInfer<TState>>>
  readonly commands?: TCommands & Record<string, ICommandFn<NoInfer<TState>>>
  /** App names besides the owner allowed to run commands. Default: owner only. */
  readonly writers?: readonly string[]
  readonly events?: TEvents
  readonly requests?: TRequests
  readonly resources?: TResources
}

/** Type-level record of every section of one contract, carried by {@link IContract}. */
export type IContractTypes = {
  readonly state: IStateSpec
  /** Erased callback shapes accept each contract's own, narrower state input. */
  readonly computed: Record<string, (...args: any[]) => unknown>
  readonly commands: Record<string, (...args: any[]) => unknown>
  readonly events: Record<string, IEventMarker<any>>
  readonly requests: Record<string, IRequestMarker<any, any>>
  readonly resources: Record<string, IResourceMarker<any>>
}

/** A frozen contract definition. Share it between apps through a Module Federation expose. */
export type IContract<TName extends string = string, T extends IContractTypes = IContractTypes> = {
  readonly name: TName
  readonly version: number
  readonly state: Readonly<T['state']>
  readonly computed: Readonly<T['computed']>
  readonly commands: Readonly<T['commands']>
  readonly writers: readonly string[]
  readonly events: Readonly<T['events']>
  readonly requests: Readonly<T['requests']>
  readonly resources: Readonly<T['resources']>
  /** Type carrier only; always `undefined` at runtime. */
  readonly __types?: T
}

/** Extracts the type record from a contract. */
export type IContractTypesOf<C> = C extends IContract<string, infer T> ? T : never

/** Empty section used when a spec omits it. */
const EMPTY: Readonly<Record<string, never>> = Object.freeze({})

/**
 * Rejects names the hub cannot use as plugin names or message keys.
 *
 * @throws TypeError `INVALID_OPTION` for non-strings, empty strings and names containing `.`.
 */
export function assertName(kind: NameKind, name: unknown): asserts name is string {
  if (typeof name !== 'string' || name.length === 0 || name.includes('.')) {
    throw createMicroHubTypeError(
      MicroHubErrorCode.invalidOption,
      MicroHubErrorText.invalidName(kind, name)
    )
  }
}

/** Returns true when `value` is a frozen marker of the given kind created by this module. */
export const isMarker = (value: unknown, marker: ContractMarker): boolean =>
  typeof value === 'object' && value !== null && (value as { marker?: unknown }).marker === marker

/**
 * Validates one section and returns a frozen own-property copy.
 *
 * `accept` decides whether one member value has the right shape; any other value throws so a typo
 * fails at definition time instead of at first use.
 */
function readSection(
  contract: string,
  section: ContractSection,
  value: unknown,
  accept: (member: unknown) => boolean
): Readonly<Record<string, unknown>> {
  if (value === undefined) return EMPTY
  if (typeof value !== 'object' || value === null) {
    throw createMicroHubTypeError(
      MicroHubErrorCode.invalidOption,
      MicroHubErrorText.invalidSection(contract, section, '*')
    )
  }
  /** Own enumerable members copied once, so later mutation of the spec has no effect. */
  const copy: Record<string, unknown> = {}
  for (const [member, entry] of Object.entries(value)) {
    if (!accept(entry)) {
      throw createMicroHubTypeError(
        MicroHubErrorCode.invalidOption,
        MicroHubErrorText.invalidSection(contract, section, member)
      )
    }
    copy[member] = entry
  }
  return Object.freeze(copy)
}

/**
 * Defines a contract: the typed, versioned agreement between the app that owns some state, events
 * and requests and the apps that use them. Definition has no side effect; the hub registers the
 * contract on first `use()` or `own()`.
 *
 * @throws TypeError `INVALID_OPTION` for an invalid name, version or section member.
 */
export function defineContract<
  const TName extends string,
  TState extends IStateSpec = Record<never, never>,
  TComputed extends Record<string, IComputedFn<TState>> = Record<never, never>,
  TCommands extends Record<string, ICommandFn<TState>> = Record<never, never>,
  TEvents extends Record<string, IEventMarker<any>> = Record<never, never>,
  TRequests extends Record<string, IRequestMarker<any, any>> = Record<never, never>,
  TResources extends Record<string, IResourceMarker<any>> = Record<never, never>
>(
  name: TName,
  spec: IContractSpec<TState, TComputed, TCommands, TEvents, TRequests, TResources>
): IContract<
  TName,
  {
    state: TState
    computed: TComputed
    commands: TCommands
    events: TEvents
    requests: TRequests
    resources: TResources
  }
> {
  assertName(NameKind.contract, name)
  if (!Number.isSafeInteger(spec.version) || spec.version < 1) {
    throw createMicroHubTypeError(
      MicroHubErrorCode.invalidOption,
      MicroHubErrorText.invalidVersion(name)
    )
  }
  /** Any value is a valid state initial value; markers other than `keyed` are rejected. */
  const acceptState = (member: unknown): boolean =>
    !(
      isMarker(member, ContractMarker.event) ||
      isMarker(member, ContractMarker.request) ||
      isMarker(member, ContractMarker.resource)
    )
  /** Functions are the only valid computed and command members. */
  const acceptFunction = (member: unknown): boolean => typeof member === 'function'
  /** Writers are copied into a frozen array; each entry must be a valid app name. */
  const writers = Object.freeze([...(spec.writers ?? [])])
  for (const writer of writers) assertName(NameKind.app, writer)
  return Object.freeze({
    name,
    version: spec.version,
    state: readSection(name, ContractSection.state, spec.state, acceptState),
    computed: readSection(name, ContractSection.computed, spec.computed, acceptFunction),
    commands: readSection(name, ContractSection.commands, spec.commands, acceptFunction),
    writers,
    events: readSection(name, ContractSection.events, spec.events, (member) =>
      isMarker(member, ContractMarker.event)
    ),
    requests: readSection(name, ContractSection.requests, spec.requests, (member) =>
      isMarker(member, ContractMarker.request)
    ),
    resources: readSection(name, ContractSection.resources, spec.resources, (member) =>
      isMarker(member, ContractMarker.resource)
    )
  }) as unknown as IContract<
    TName,
    {
      state: TState
      computed: TComputed
      commands: TCommands
      events: TEvents
      requests: TRequests
      resources: TResources
    }
  >
}
