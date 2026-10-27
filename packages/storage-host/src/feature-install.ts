import { PluginHostError, PluginHostErrorCode, ERROR_TEXT } from '@migaia/plugin-host'
import { assertTransactionOwner, runTransactionOperation } from './authoring/transaction.js'
import {
  RecordQueryMethod,
  TransactionBuilderMethod,
  type IChainMethods
} from '@migaia/storage-contract'
import type {
  ICapabilityImpl,
  ICapabilityInstallPort,
  IStorageBase
} from '@migaia/storage-contract'
import { createStorageTypeError } from './errors.js'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from './error-text.js'
import type {
  IStorageExecutionPort,
  IStorageFeatureOutput,
  IStoragePluginCallContext,
  IStorageFeatureClientResolver
} from './types.js'
import { STORAGE_CHAIN_FAMILIES } from './state-constants.js'
/** A closed output-shape failure stays at the existing backend definition boundary. */
function invalid(cause?: unknown): never {
  throw createStorageTypeError(
    StorageHostErrorCode.backendPluginInvalid,
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
  /** Own data shape is part of the closed Feature output contract, including symbols. */
  const properties = Reflect.ownKeys(value).map(
    (key) => [key, Object.getOwnPropertyDescriptor(value, key)] as const
  )
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

/** Registration inputs borrow the original provider, execution, and client owners. */
type IStorageFeatureInstallInput = {
  readonly name: string
  readonly store: IStorageBase
  readonly features: Readonly<Record<string, object>>
  readonly installer?: ICapabilityInstallPort
  readonly execution: IStorageExecutionPort
  readonly expose: Readonly<Record<string, Function>>
  readonly onDispose: (release: () => void) => void
  readonly callContext: IStoragePluginCallContext
  readonly clientResolver?: IStorageFeatureClientResolver
}

/** One selected-root publication owns only method definitions and capability admission data. */
type IStorageFeatureInstallContext = {
  readonly input: IStorageFeatureInstallInput
  readonly implementations: ICapabilityImpl[]
  readonly storeApi: Record<string, unknown>
  readonly storeApiDefinitions: Record<string, unknown>
  transactionApi?: Record<string, unknown>
  chain?: Partial<Record<keyof IChainMethods, Record<string, Function>>>
}

/** An API view borrows one real organization and optional canonical transaction scope. */
type IStorageFeatureApiContext = {
  readonly input: IStorageFeatureInstallInput
  readonly store: IStorageBase
  readonly callContext: IStoragePluginCallContext
  readonly execution: IStorageExecutionPort
  readonly scope?: object
}

/** Prepare selected roots without publishing their dependency-only outputs. */
export function installStorageFeatures(
  input: IStorageFeatureInstallInput
): IStorageFeatureProjection | undefined {
  /** No selected roots means no new method tables, projection, or cleanup. */
  const roots = Object.values(input.features)
  if (roots.length === 0) return
  /** Mutable publication data belongs to this explicit installation context. */
  const context: IStorageFeatureInstallContext = {
    input,
    implementations: [],
    storeApi: Object.create(null),
    storeApiDefinitions: Object.create(null)
  }
  for (const root of roots) admitStorageFeatureRoot(context, root)
  publishStorageFeatureCapabilities(context)
  if ('api' in input.store) duplicate(input.name, 'api')
  Object.defineProperty(input.store, 'api', {
    value: context.storeApi,
    enumerable: true,
    configurable: true
  })
  return createStorageFeatureProjection(context)
}

/** Admit one closed root before any capabilities become visible. */
function admitStorageFeatureRoot(context: IStorageFeatureInstallContext, root: object): void {
  /** Consume the exact three-field root output once. */
  const outputEntries = entries(root)
  if (
    outputEntries.length !== 3 ||
    outputEntries.some(([key]) => key !== 'capabilities' && key !== 'chain' && key !== 'api')
  )
    invalid()
  /** Closed shape admission precedes provider publication. */
  const output = Object.fromEntries(outputEntries) as IStorageFeatureOutput
  if (!Array.isArray(output.capabilities)) invalid()
  context.implementations.push(...output.capabilities)
  /** Store and transaction APIs retain separate namespaces. */
  const groups = entries(output.api)
  if (groups.length !== 2 || groups.some(([key]) => key !== 'store' && key !== 'transaction'))
    invalid()
  /** Only admitted own data reaches the API definition snapshot. */
  const api = Object.fromEntries(groups)
  admitStorageFeatureApis(context, api)
  admitStorageFeatureChains(context, output.chain)
}

/** Snapshot definitions before later organization and transaction views can be requested. */
function admitStorageFeatureApis(
  context: IStorageFeatureInstallContext,
  api: Record<string, unknown>
): void {
  for (const [key, value] of entries(api.store)) {
    if (Object.hasOwn(context.storeApi, key)) duplicate(context.input.name, key)
    /** Feature authors own their API groups; they are used as declared, without a defensive copy. */
    context.storeApiDefinitions[key] = value
    context.storeApi[key] = bindFeatureApi(value, key, featureApiContext(context.input))
  }
  for (const [key, value] of entries(api.transaction)) {
    if (typeof context.input.expose.getTransactionClient !== 'function') invalid()
    context.transactionApi ??= Object.create(null) as Record<string, unknown>
    if (Object.hasOwn(context.transactionApi, key)) duplicate(context.input.name, key)
    context.transactionApi[key] = value
  }
}

/** Mix finite selected families into their original fluent creators. */
function admitStorageFeatureChains(context: IStorageFeatureInstallContext, chain: unknown): void {
  for (const [family, methods] of entries(chain)) {
    if (!Object.hasOwn(STORAGE_CHAIN_FAMILIES, family)) invalid()
    /** This finite family remains owned by the original fluent construction layer. */
    const key = family as keyof IChainMethods
    context.chain ??= Object.create(null) as NonNullable<IStorageFeatureInstallContext['chain']>
    /** One table combines selected roots without a second fluent registry. */
    const target =
      context.chain[key] ?? (context.chain[key] = Object.create(null) as Record<string, Function>)
    for (const [name, method] of entries(methods)) {
      if (typeof method !== 'function') invalid()
      if (
        (key === 'query' && Object.hasOwn(RecordQueryMethod, name)) ||
        (key === 'tx' && Object.hasOwn(TransactionBuilderMethod, name))
      )
        duplicate(context.input.name, name)
      if (Object.hasOwn(target, name)) duplicate(context.input.name, name)
      target[name] = function (this: object, ...args: unknown[]) {
        /** Configuration borrows the actual fluent node; terminals retain pipeline ownership. */
        context.input.expose.getStore!()
        return Reflect.apply(method, this, args)
      }
    }
  }
}

/** The original provider owns prepare, visibility, and release order. */
function publishStorageFeatureCapabilities(context: IStorageFeatureInstallContext): void {
  if (context.implementations.length === 0) return
  if (context.input.installer === undefined) invalid()
  /** Register release before making the prepared capabilities visible. */
  const publication = context.input.installer.prepare(context.implementations)
  context.input.onDispose(publication.release)
  publication.publish()
}

/** Reuse captured roots without rerunning Feature factories for organizations or transactions. */
function createStorageFeatureProjection(
  context: IStorageFeatureInstallContext
): IStorageFeatureProjection {
  return {
    createStoreApi: (store, callContext, execution) =>
      createFeatureApi(context.storeApiDefinitions, {
        input: context.input,
        store,
        callContext,
        execution
      }),
    ...(context.transactionApi === undefined
      ? {}
      : {
          createTransactionApi: (
            scope: object,
            store = context.input.store,
            callContext = context.input.callContext,
            execution = context.input.execution
          ): object =>
            createFeatureApi(context.transactionApi!, {
              input: context.input,
              store,
              callContext,
              execution,
              scope
            })
        }),
    ...(context.chain === undefined ? {} : { chain: context.chain })
  }
}

/** Borrow the root's existing call context and execution admission port. */
function featureApiContext(input: IStorageFeatureInstallInput): IStorageFeatureApiContext {
  return { input, store: input.store, callContext: input.callContext, execution: input.execution }
}

/** Materialize one native view from already admitted, detached definitions. */
function createFeatureApi(
  definitions: Record<string, unknown>,
  context: IStorageFeatureApiContext
): object {
  /** Each real view receives its own method table while preserving definition identity. */
  const api = Object.create(null) as Record<string, unknown>
  for (const [key, value] of Object.entries(definitions))
    api[key] = bindFeatureApi(value, key, context)
  return api
}

/** Bind accepted definitions to one explicit organization or transaction context. */
function bindFeatureApi(value: unknown, path: string, context: IStorageFeatureApiContext): unknown {
  if (typeof value === 'function')
    return (...args: unknown[]) => runFeatureApi(context, value, path, args)
  /** This internal group was admitted once before publication; do not validate or copy it again. */
  const group = Object.create(null) as Record<string, unknown>
  for (const [key, member] of Object.entries(value as Record<string, unknown>))
    group[key] = bindFeatureApi(member, `${path}.${key}`, context)
  return group
}

/** Admit the entire Feature operation through the existing canonical scope and pipeline owners. */
function runFeatureApi(
  context: IStorageFeatureApiContext,
  method: Function,
  path: string,
  args: unknown[]
): unknown {
  if (context.scope === undefined)
    return context.execution.run({ operation: path, input: args }, (captured) =>
      runStoreFeatureApi(context, method, captured)
    )
  return runTransactionOperation(context.scope, (current) => {
    assertTransactionOwner(context.store, current)
    return context.execution.run({ operation: path, input: args, scope: current }, (captured) => {
      /** Use the exact current registered view; client selection remains synchronous here. */
      const client =
        context.input.clientResolver?.getTransactionClient === undefined
          ? context.input.expose.getTransactionClient!(current)
          : context.input.clientResolver.getTransactionClient(current, context.callContext.orgId)
      return Reflect.apply(
        method,
        {
          ...context.callContext,
          store: current,
          client,
          scope: current
        },
        captured
      )
    })
  })
}

/** Resolve only opt-in native preparation; synchronous clients retain synchronous method results. */
function runStoreFeatureApi(
  context: IStorageFeatureApiContext,
  method: Function,
  captured: unknown[]
): Promise<unknown> {
  context.input.expose.getStore!()
  if (context.input.clientResolver !== undefined) {
    /** Ordinary PromiseLike preparation is part of the public resolver contract. */
    const client = context.input.clientResolver.getClient(context.callContext.orgId)
    if (
      client !== null &&
      (typeof client === 'object' || typeof client === 'function') &&
      typeof (client as PromiseLike<unknown>).then === 'function'
    )
      /** Retain the original fresh-Promise settlement step before checking late registration use. */
      return new Promise<unknown>((resolve, reject) => {
        ;(client as PromiseLike<unknown>).then(resolve, reject)
      }).then((ready) => {
        /** Preparation can settle after disposal; re-enter the original registration admission. */
        context.input.expose.getStore!()
        return invokeStoreFeatureApi(context, method, captured, ready)
      })
    return invokeStoreFeatureApi(context, method, captured, client)
  }
  return invokeStoreFeatureApi(context, method, captured, context.input.expose.getClient?.())
}

/** Preserve the public dynamic Feature call-context receiver without changing its API. */
function invokeStoreFeatureApi(
  context: IStorageFeatureApiContext,
  method: Function,
  captured: unknown[],
  client: unknown
): Promise<unknown> {
  return Reflect.apply(
    method,
    {
      ...context.callContext,
      store: context.store,
      client,
      scope: undefined
    },
    captured
  )
}
