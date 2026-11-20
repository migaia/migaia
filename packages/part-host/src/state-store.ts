import type { IResourceSnapshot, IStandardSchemaInput } from '@migaia/part-contract'
import { isDefaultStateNamespace } from '@migaia/part-contract'
import type { IRuntime } from '@migaia/reactive'
import type { INativeAbortSignal } from '@migaia/utils/promise'
import { attachErrorIdentity } from '@migaia/utils/error'
import { ERROR_SOURCE, PartHostErrorCode } from './error-code.ts'
import { PartHostErrorText } from './error-text.ts'

/**
 * Context a store's `create` receives: `invalidate` reports changes made outside the host, `report`
 * hands errors to the host diagnostics, `runtime` is the host's reactive runtime and `signal`
 * aborts when the plugin generation ends. Calls after release are ignored.
 */
export type IStateStoreContext = {
  invalidate(keys?: readonly string[]): void
  report(error: unknown): void
  readonly runtime: IRuntime
  readonly signal: INativeAbortSignal
}

/** Equality of two values of one key; must be synchronous. */
export type IStateEquals = (prev: unknown, next: unknown, key: string) => boolean

/** A value or a thenable resolving to it. */
export type IMaybePromise<T> = T | PromiseLike<T>

/**
 * Adapter contract of an external store. Keys are paths without the namespace (`cart.items.0` has
 * key `items.0`). `get` returns the value or a thenable; a changed value must be a new reference
 * and an unchanged one the same reference (or provide a structural `equals`).
 */
export type IStateStoreSpec<THandle> = {
  readonly namespace: string
  create(ctx: IStateStoreContext): IMaybePromise<THandle>
  get(handle: THandle, key: string): unknown
  set(handle: THandle, key: string, value: unknown): IMaybePromise<readonly string[] | void>
  has?(handle: THandle, key: string): IMaybePromise<boolean>
  subscribe?(handle: THandle, listener: (keys?: readonly string[]) => void): () => void
  readonly equals?: IStateEquals
  readonly equalsBy?: Readonly<Record<string, IStateEquals>>
  dispose?(handle: THandle): IMaybePromise<void>
  readonly schema?: IStandardSchemaInput
}

/** Kinds of store registrations a plugin can list in `stores`. */
export const StateStoreKind = {
  /** An external store from `defineStateStore` or `composeStore`. */
  store: 'state-store',
  /** Custom equality for the default `page`/`section`/`part` store, from `defaultStateStore`. */
  defaultStore: 'default-state-store'
} as const

/** One store registration kind. */
export type StateStoreKind = (typeof StateStoreKind)[keyof typeof StateStoreKind]

/** Store accepted by plugin `stores`. */
export type IStateStore<THandle> = IStateStoreSpec<THandle> & {
  readonly __kind: typeof StateStoreKind.store
}

/** Functions a middleware layer may override, plus the layer's own release. */
export type IStateStoreLayer<THandle> = Partial<
  Pick<IStateStoreSpec<THandle>, 'create' | 'get' | 'set' | 'has' | 'subscribe'>
> & { dispose?(handle: THandle): IMaybePromise<void> }

/** Middleware: builds a layer over the store it wraps. */
export type IStateStoreMiddleware = <THandle>(
  inner: IStateStore<THandle>
) => IStateStoreLayer<THandle>

/** Options of the default store: equality applied to `page`, `section` and `part` paths. */
export type IDefaultStateStoreOptions = {
  readonly equals?: IStateEquals
  readonly equalsBy?: Readonly<Record<string, IStateEquals>>
}

/** Registration of custom equality for the default store. */
export type IDefaultStateStore = IDefaultStateStoreOptions & {
  readonly __kind: typeof StateStoreKind.defaultStore
}

/** Asynchronous state of one state path, shaped like a resource snapshot. */
export type IStateStatus = Pick<IResourceSnapshot, 'status' | 'refreshing' | 'error'>

/** Namespace grammar of external stores. */
const NAMESPACE = /^[a-z][a-zA-Z0-9]*$/

/** Creates a part-host error of a code without wrapping a native type. */
function tag<T extends Error>(error: T, code: string): T {
  return attachErrorIdentity(error, { source: ERROR_SOURCE, code }) as T
}

/** True when a value has a callable `then`. */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { readonly then?: unknown }).then === 'function'
  )
}

/**
 * Defines an external store for a namespace. Throws STATE_STORE_INVALID (TypeError) when the
 * namespace breaks the grammar or is `page`, `section` or `part`. The functions are kept as given.
 */
export function defineStateStore<THandle>(spec: IStateStoreSpec<THandle>): IStateStore<THandle> {
  if (!NAMESPACE.test(spec.namespace) || isDefaultStateNamespace(spec.namespace))
    throw tag(
      new TypeError(PartHostErrorText.stateStoreInvalid(String(spec.namespace))),
      PartHostErrorCode.stateStoreInvalid
    )
  return Object.freeze({ ...spec, __kind: StateStoreKind.store })
}

/** Registers custom equality for the default store (`page`, `section`, `part`). */
export function defaultStateStore(options: IDefaultStateStoreOptions = {}): IDefaultStateStore {
  return Object.freeze({
    __kind: StateStoreKind.defaultStore,
    ...(options.equals === undefined ? {} : { equals: options.equals }),
    ...(options.equalsBy === undefined ? {} : { equalsBy: options.equalsBy })
  })
}

/** Contract functions a layer may take over, in a fixed order (five names, a compile-time bound). */
const LAYER_FUNCTIONS = ['create', 'get', 'set', 'has', 'subscribe'] as const

/**
 * Store whose contract functions come from `layer` where it overrides them and from `inner`
 * otherwise; identity fields stay those of `base`. It has no `dispose`: layers release themselves
 * and the composed result owns the ordered release.
 */
function layered<THandle>(
  base: IStateStore<THandle>,
  inner: IStateStore<THandle>,
  layer: IStateStoreLayer<THandle>
): IStateStore<THandle> {
  /** Merged contract functions. */
  const functions: Record<string, unknown> = {}
  // Bounded by LAYER_FUNCTIONS (five names).
  for (const name of LAYER_FUNCTIONS) {
    /** Owner of the function: the layer when it overrides it. */
    const owner = (layer[name] === undefined ? inner : layer) as Record<string, unknown>
    if (typeof owner[name] === 'function') functions[name] = forward(owner, name)
  }
  return Object.freeze({
    ...identityOf(base),
    ...functions,
    __kind: StateStoreKind.store
  }) as IStateStore<THandle>
}

/** Forwarding function that calls `owner[name]` with `owner` as receiver. */
function forward(owner: Record<string, unknown>, name: string): (...args: unknown[]) => unknown {
  return (...args) => (owner[name] as (...values: unknown[]) => unknown)(...args)
}

/** Identity fields a composition carries unchanged (same references). */
function identityOf<THandle>(
  store: IStateStore<THandle>
): Pick<IStateStoreSpec<THandle>, 'namespace' | 'schema' | 'equals' | 'equalsBy'> {
  return {
    namespace: store.namespace,
    ...(store.schema === undefined ? {} : { schema: store.schema }),
    ...(store.equals === undefined ? {} : { equals: store.equals }),
    ...(store.equalsBy === undefined ? {} : { equalsBy: store.equalsBy })
  }
}

/**
 * Releases one owner after another, awaiting each asynchronous release; a failure does not stop the
 * rest. One failure rejects with that error, several with a STATE_STORE_DISPOSE_FAILED
 * AggregateError (`errors` in call order, `cause` the first).
 */
async function releaseInOrder<THandle>(
  releases: readonly ((handle: THandle) => IMaybePromise<void>)[],
  handle: THandle
): Promise<void> {
  /** Failures in call order. */
  const errors: unknown[] = []
  for (const release of releases) {
    try {
      await release(handle)
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1)
    throw tag(
      new AggregateError(errors, PartHostErrorText.stateStoreLayersDisposeFailed, {
        cause: errors[0]
      }),
      PartHostErrorCode.stateStoreDisposeFailed
    )
}

/**
 * Wraps a store in middleware layers, called in the order m1 → m2 → store: each middleware wraps
 * the composition of the ones after it, and every contract function comes from the outermost layer
 * that overrides it. The result's `dispose` always returns a Promise and releases m1's layer, m2's
 * layer, then the store (a composed store releases its own layers in turn). `namespace`, `schema`,
 * `equals` and `equalsBy` are the store's own references.
 */
export function composeStore<THandle>(
  store: IStateStore<THandle>,
  ...middlewares: readonly IStateStoreMiddleware[]
): IStateStore<THandle> {
  /** Composition seen by the next outer middleware. */
  let current: IStateStore<THandle> = store
  /** Layers from innermost to outermost (built inside out). */
  const layers: IStateStoreLayer<THandle>[] = []
  for (let index = middlewares.length - 1; index >= 0; index -= 1) {
    /** Layer built over the current composition. */
    const layer = (middlewares[index] as IStateStoreMiddleware)(current)
    layers.push(layer)
    current = layered(store, current, layer)
  }
  /** Ordered releases: every layer's own release, then the store's. */
  const releases: ((handle: THandle) => IMaybePromise<void>)[] = []
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    /** Layer at this position, outermost first. */
    const layer = layers[index] as IStateStoreLayer<THandle>
    if (typeof layer.dispose === 'function')
      releases.push(forward(layer as Record<string, unknown>, 'dispose') as never)
  }
  if (typeof store.dispose === 'function')
    releases.push(forward(store as unknown as Record<string, unknown>, 'dispose') as never)
  return Object.freeze({
    ...current,
    dispose: (handle: THandle) => releaseInOrder(releases, handle)
  })
}
