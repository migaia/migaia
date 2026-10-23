import { PluginHostError, PluginHostErrorCode, ERROR_TEXT } from '@migaia/plugin-host'
import {
  assertTransactionOwner,
  runTransactionOperation,
  RecordQueryMethod,
  TransactionBuilderMethod,
  type IChainMethods
} from '@migaia/storage-contract'
import type {
  ICapabilityImpl,
  ICapabilityInstallPort,
  IStorageBase
} from '@migaia/storage-contract'
import { createStorageTypeError, StorageErrorCode } from './errors.js'
import { StorageErrorText } from './error-text.js'
import type {
  IStorageExecutionPort,
  IStorageFeatureOutput,
  IStoragePluginCallContext
} from './types.js'
import { STORAGE_CHAIN_FAMILIES } from './state-constants.js'
/** A closed output-shape failure stays at the existing backend definition boundary. */
function invalid(cause?: unknown): never {
  throw createStorageTypeError(
    StorageErrorCode.backendPluginInvalid,
    StorageErrorText.backendPluginInvalid,
    cause
  )
}
/** Reuse PluginHost's duplicate-registration semantics for published method collisions. */
function duplicate(name: string, key: PropertyKey): never {
  throw new PluginHostError(
    PluginHostErrorCode.extensionDuplicate,
    ERROR_TEXT.EXTENSION_DUPLICATE(name, key)
  )
}
/** Snapshot own data once; methods are rebound only at their actual execution endpoint. */
function entries(value: unknown): readonly (readonly [string, unknown])[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid()
  /** Reflection failure belongs to this same definition boundary and retains its original cause. */
  let properties: readonly (readonly [PropertyKey, PropertyDescriptor | undefined])[]
  try {
    properties = Reflect.ownKeys(value).map(
      (key) => [key, Object.getOwnPropertyDescriptor(value, key)] as const
    )
  } catch (cause) {
    return invalid(cause)
  }
  return properties.map(([key, descriptor]) => {
    /** Retain one own data snapshot without executing a caller accessor. */
    if (
      typeof key !== 'string' ||
      descriptor === undefined ||
      !('value' in descriptor) ||
      !descriptor.enumerable
    )
      return invalid()
    return [key, descriptor.value] as const
  })
}
/** Original registration-local projections contain no transaction or fluent construction owner. */
export type IStorageFeatureProjection = {
  readonly createTransactionApi?: (
    scope: object,
    store?: IStorageBase,
    context?: IStoragePluginCallContext,
    execution?: IStorageExecutionPort
  ) => object
  readonly createStoreApi?: (
    store: IStorageBase,
    context: IStoragePluginCallContext,
    execution: IStorageExecutionPort
  ) => object
  readonly chain?: IChainMethods
}

/**
 * Prepare selected roots only; dependencies remain raw construction outputs until explicitly
 * copied.
 */
export function installStorageFeatures(input: {
  readonly name: string
  readonly store: IStorageBase
  readonly features: Readonly<Record<string, object>>
  readonly installer?: ICapabilityInstallPort
  readonly execution: IStorageExecutionPort
  readonly expose: Readonly<Record<string, Function>>
  readonly onDispose: (release: () => void) => void
  readonly callContext: IStoragePluginCallContext
}): IStorageFeatureProjection | undefined {
  /** Publish selected root outputs without implicitly publishing dependencies. */
  const roots = Object.values(input.features)
  if (roots.length === 0) return
  /** One local publication batch belongs to the original store capability provider. */
  const implementations: ICapabilityImpl[] = []
  /** API names are scoped to this one backend instance and this install lifetime. */
  const storeApi = Object.create(null) as Record<string, unknown>
  /** Original raw definitions are shared by immutable organization projections. */
  const storeApiDefinitions = Object.create(null) as Record<string, unknown>
  /** Absent groups retain no method table or scope projection callback. */
  let transactionApi: Record<string, unknown> | undefined
  /** Only selected root families contribute methods to the original fluent creators. */
  let chain: Partial<Record<keyof IChainMethods, Record<string, Function>>> | undefined
  for (const root of roots) {
    /** Reject unknown Feature output fields before installing capabilities. */
    const outputEntries = entries(root)
    if (
      outputEntries.length !== 3 ||
      outputEntries.some(([key]) => key !== 'capabilities' && key !== 'chain' && key !== 'api')
    )
      invalid()
    /** Consume only this admitted three-field root output. */
    const output = Object.fromEntries(outputEntries) as IStorageFeatureOutput
    if (!Array.isArray(output.capabilities)) invalid()
    implementations.push(...output.capabilities)
    /** Keep store and transaction API namespaces distinct during admission. */
    const groups = entries(output.api)
    if (groups.length !== 2 || groups.some(([key]) => key !== 'store' && key !== 'transaction'))
      invalid()
    /** Later admission consumes captured data rather than rereading a Feature-owned proxy. */
    const api = Object.fromEntries(groups)
    for (const [key, value] of entries(api.store)) {
      if (Object.hasOwn(storeApi, key)) duplicate(input.name, key)
      storeApiDefinitions[key] = snapshotApi(value)
      storeApi[key] = bindApi(value, key)
    }
    for (const [key, value] of entries(api.transaction)) {
      if (typeof input.expose.getTransactionClient !== 'function') invalid()
      transactionApi ??= Object.create(null) as Record<string, unknown>
      if (Object.hasOwn(transactionApi, key)) duplicate(input.name, key)
      transactionApi[key] = snapshotApi(value)
    }
    for (const [family, methods] of entries(output.chain)) {
      if (!Object.hasOwn(STORAGE_CHAIN_FAMILIES, family)) invalid()
      /** The family is one finite original fluent surface, not an extension registry. */
      const key = family as keyof IChainMethods
      chain ??= Object.create(null) as NonNullable<typeof chain>
      /** Each selected family is created once and subsequently mixed into actual original nodes. */
      const target = chain[key] ?? (chain[key] = Object.create(null) as Record<string, Function>)
      for (const [name, method] of entries(methods)) {
        if (typeof method !== 'function') invalid()
        if (
          (key === 'query' && Object.hasOwn(RecordQueryMethod, name)) ||
          (key === 'tx' && Object.hasOwn(TransactionBuilderMethod, name))
        )
          duplicate(input.name, name)
        if (Object.hasOwn(target, name)) duplicate(input.name, name)
        target[name] = function (this: object, ...args: unknown[]) {
          /** Fluent methods configure original nodes; actual I/O terminals own pipeline entry. */
          input.expose.getStore!()
          return Reflect.apply(method, this, args)
        }
      }
    }
  }
  if (chain !== undefined) {
    for (const methods of Object.values(chain)) Object.freeze(methods)
    Object.freeze(chain)
  }
  if (implementations.length !== 0) {
    if (input.installer === undefined) invalid()
    /** The original provider owns capability preparation, visibility and release. */
    const publication = input.installer.prepare(implementations)
    input.onDispose(publication.release)
    publication.publish()
  }
  if ('api' in input.store) duplicate(input.name, 'api')
  Object.defineProperty(input.store, 'api', {
    value: Object.freeze(storeApi),
    enumerable: true,
    configurable: true
  })

  return {
    createStoreApi: (store, context, execution) => {
      /** Organization methods reuse the captured selected roots without rerunning Feature factories. */
      const api = Object.create(null) as Record<string, unknown>
      for (const [key, value] of Object.entries(storeApiDefinitions))
        api[key] = bindApi(value, key, undefined, store, context, execution)
      return Object.freeze(api)
    },
    ...(transactionApi === undefined
      ? {}
      : {
          createTransactionApi: (
            scope: object,
            store = input.store,
            context = input.callContext,
            execution = input.execution
          ): object => {
            /** Each actual original view receives its own bound API before the backend freezes it. */
            const api = Object.create(null) as Record<string, unknown>
            for (const [key, value] of Object.entries(transactionApi))
              api[key] = bindApi(value, key, scope, store, context, execution)
            return Object.freeze(api)
          }
        }),
    ...(chain === undefined ? {} : { chain })
  }

  /** Definition data is captured once; no later scope construction rereads Feature-owned objects. */
  function snapshotApi(value: unknown): unknown {
    if (typeof value === 'function') return value
    /** Capture nested groups now so mutation/getters cannot alter a later registered native view. */
    const group = Object.create(null) as Record<string, unknown>
    for (const [key, member] of entries(value)) group[key] = snapshotApi(member)
    return Object.freeze(group)
  }

  /** Every nested API leaf performs canonical registration admission before touching a client. */
  function bindApi(
    value: unknown,
    path: string,
    scope?: object,
    store = input.store,
    context = input.callContext,
    execution = input.execution
  ): unknown {
    if (typeof value === 'function')
      return (...args: unknown[]) => {
        if (scope === undefined)
          return execution.run({ operation: path, input: args }, (captured) => {
            /** Use the original admitted backend object instead of creating a replacement. */
            input.expose.getStore!()
            /** Fetch the lazy native client only at its actual execution endpoint. */
            const client = input.expose.getClient?.()
            return Reflect.apply(value, { ...context, store, client, scope: undefined }, captured)
          })
        /** Original scope admission owns expiry/first-failure semantics before any host/client work. */
        return runTransactionOperation(scope, (current) => {
          assertTransactionOwner(store, current)
          return execution.run({ operation: path, input: args, scope: current }, (captured) => {
            /** Client projection is lazy and uses this operation's exact current registered view. */
            const client = input.expose.getTransactionClient!(current)
            return Reflect.apply(
              value,
              { ...context, store: current, client, scope: current },
              captured
            )
          })
        })
      }
    /** Freeze a nested API group while its leaves retain registration guards. */
    const group = Object.create(null) as Record<string, unknown>
    for (const [key, member] of entries(value))
      group[key] = bindApi(member, `${path}.${key}`, scope, store, context, execution)
    return Object.freeze(group)
  }
}
