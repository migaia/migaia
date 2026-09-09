import type { IWebRpcAbortSignal, IWebRpcHookEvent } from './typing.js'
import type { IWebRpcTransport } from './transport.js'
import { WebRpcError, WebRpcErrorCode } from './errors.js'
import { WebRpcErrorText } from './error-text.js'
import {
  defineEndpointModule,
  type IEndpointModuleClaims,
  type IEndpointModuleInstallContext
} from './internal/endpoint-modules.js'
import type { IWebRpcEndpointModule } from './core.js'

/** Public lifecycle scope for a user-defined feature installation. */
export type IWebRpcFeatureInstallScope = Readonly<{
  readonly id: string
  readonly transport: IWebRpcTransport
  readonly signal: IWebRpcAbortSignal
  readonly hooks: (event: IWebRpcHookEvent) => void
  own<TResource>(resource: TResource, release: () => void | Promise<void>): TResource
}>

/** Declarative claims and installer captured by {@link defineFeature}. */
export type IWebRpcFeatureDefinition<TSurface extends object = object> = Readonly<{
  readonly key: string
  readonly claims?: Partial<IEndpointModuleClaims> & {
    readonly publicKeys?: readonly (keyof TSurface & string)[]
    readonly exposedKeys?: readonly (keyof TSurface & string)[]
  }
  readonly publicKeys?: readonly (keyof TSurface & string)[]
  readonly requires?: readonly IWebRpcFeature[]
  readonly conflicts?: readonly string[]
  readonly install: (scope: IWebRpcFeatureInstallScope) => TSurface | Promise<TSurface>
}>

/** Opaque immutable token selecting one user-defined feature in an endpoint tuple. */
export type IWebRpcFeature<TSurface extends object = object> = IWebRpcEndpointModule<TSurface> & {
  readonly __webRpcFeatureBrand?: TSurface
}

/** Exact surface intersection projected from a finite feature tuple. */
export type IWebRpcFeatureSurface<TFeatures extends readonly IWebRpcFeature[]> =
  IUnionToIntersection<TFeatures[number] extends IWebRpcFeature<infer TSurface> ? TSurface : never>

/** Rejects widened feature arrays at typed endpoint composition boundaries. */
export type IWebRpcFiniteFeatureTuple<TFeatures extends readonly IWebRpcFeature[]> =
  number extends TFeatures['length'] ? never : TFeatures

/**
 * Creates one hostile-safe immutable feature token for the canonical PluginHost inventory.
 *
 * @remarks
 *   Installation owns resources through the supplied lifecycle scope; callers never import
 *   PluginHost.
 * @typeParam TSurface - Public surface contributed by the feature after activation.
 * @param definition - Immutable declaration whose own data descriptors are snapshotted once.
 * @returns A branded feature token accepted by finite endpoint feature tuples.
 * @throws {WebRpcError} When the definition violates the public feature contract.
 */
export function defineFeature<TSurface extends object>(
  definition: IWebRpcFeatureDefinition<TSurface>
): IWebRpcFeature<TSurface>
/**
 * Creates one hostile-safe immutable feature token using a separate stable key argument.
 *
 * @remarks
 *   Installation owns resources through the supplied lifecycle scope; callers never import
 *   PluginHost.
 * @typeParam TSurface - Public surface contributed by the feature after activation.
 * @param key - Stable public inventory key for the feature.
 * @param definition - Immutable declaration whose own data descriptors are snapshotted once.
 * @returns A branded feature token accepted by finite endpoint feature tuples.
 * @throws {WebRpcError} When the definition violates the public feature contract.
 */
export function defineFeature<TSurface extends object>(
  key: string,
  definition: Omit<IWebRpcFeatureDefinition<TSurface>, 'key'>
): IWebRpcFeature<TSurface>
export function defineFeature<TSurface extends object>(
  input: string | IWebRpcFeatureDefinition<TSurface>,
  supplied?: Omit<IWebRpcFeatureDefinition<TSurface>, 'key'>
): IWebRpcFeature<TSurface> {
  const source: IWebRpcFeatureDefinition<TSurface> =
    typeof input === 'string'
      ? ({ ...supplied, key: input } as IWebRpcFeatureDefinition<TSurface>)
      : input
  const snapshot = snapshotDefinition(source)
  const claims = snapshotClaims(snapshot.claims, snapshot.publicKeys)
  const requirements = snapshot.requires.map((feature) => feature as IWebRpcEndpointModule)
  const module = defineEndpointModule<unknown, TSurface>(
    `custom:${snapshot.key}`,
    async (context) => installFeature(snapshot.install, context),
    requirements,
    snapshot.conflicts,
    claims
  )
  return module as IWebRpcFeature<TSurface>
}

/** Captures definition own data descriptors exactly once, rejecting accessors and symbols. */
function snapshotDefinition<TSurface extends object>(
  source: IWebRpcFeatureDefinition<TSurface>
): Readonly<{
  readonly key: string
  readonly claims: IWebRpcFeatureDefinition<TSurface>['claims']
  readonly publicKeys: readonly string[]
  readonly requires: readonly IWebRpcFeature[]
  readonly conflicts: readonly string[]
  readonly install: IWebRpcFeatureDefinition<TSurface>['install']
}> {
  if ((typeof source !== 'object' && typeof source !== 'function') || source === null)
    throw invalidFeature()
  let descriptors: PropertyDescriptorMap
  let keys: readonly PropertyKey[]
  try {
    descriptors = Object.getOwnPropertyDescriptors(source)
    keys = Reflect.ownKeys(source)
  } catch (error) {
    throw new WebRpcError(
      WebRpcErrorCode.invalidConfig,
      WebRpcErrorText.endpointModuleInvalid,
      error
    )
  }
  if (keys.some((key) => typeof key !== 'string')) throw invalidFeature()
  for (const key of keys) {
    const descriptor = descriptors[key as string]
    if (!descriptor || !('value' in descriptor)) throw invalidFeature()
  }
  const read = <T>(key: string): T | undefined => descriptors[key]?.value as T | undefined
  const key = read<string>('key')
  const install = read<IWebRpcFeatureDefinition<TSurface>['install']>('install')
  if (typeof key !== 'string' || key.length === 0 || typeof install !== 'function')
    throw invalidFeature()
  return Object.freeze({
    key,
    claims: read<IWebRpcFeatureDefinition<TSurface>['claims']>('claims'),
    publicKeys: freezeStrings(
      read<readonly string[]>('publicKeys') ??
        read<IWebRpcFeatureDefinition<TSurface>['claims']>('claims')?.publicKeys ??
        []
    ),
    requires: freezeFeatures(read<readonly IWebRpcFeature[]>('requires')),
    conflicts: freezeStrings(read<readonly string[]>('conflicts') ?? []),
    install
  })
}

/** Snapshots claim tuples into a null-prototype immutable object before Host construction. */
function snapshotClaims<TSurface extends object>(
  source: IWebRpcFeatureDefinition<TSurface>['claims'],
  publicKeys: readonly string[]
): Partial<IEndpointModuleClaims> {
  const claims = source ?? {}
  const descriptors = Object.getOwnPropertyDescriptors(claims)
  if (Reflect.ownKeys(claims).some((key) => typeof key !== 'string')) throw invalidFeature()
  for (const key of Reflect.ownKeys(claims)) {
    const descriptor = descriptors[key as string]
    if (!descriptor || !('value' in descriptor)) throw invalidFeature()
  }
  const read = <T>(key: string): T | undefined => descriptors[key]?.value as T | undefined
  return Object.freeze({
    routes: freezeStrings(read<readonly string[]>('routes') ?? []),
    provides: freezeStrings(read<readonly string[]>('provides') ?? []),
    consumes: freezeStrings(read<readonly string[]>('consumes') ?? []),
    publicKeys: freezeStrings(publicKeys),
    exposedKeys: freezeStrings(read<readonly string[]>('exposedKeys') ?? publicKeys),
    activator: read<boolean>('activator') ?? false,
    sharedProvides: Object.freeze([...(read<readonly PropertyKey[]>('sharedProvides') ?? [])]),
    sharedConsumes: Object.freeze([...(read<readonly PropertyKey[]>('sharedConsumes') ?? [])]),
    sharedOptionalConsumes: Object.freeze([
      ...(read<readonly PropertyKey[]>('sharedOptionalConsumes') ?? [])
    ])
  })
}

/** Runs a user installer through the existing construction scope and rejects thenable impostors. */
async function installFeature<TSurface extends object>(
  install: IWebRpcFeatureDefinition<TSurface>['install'],
  context: IEndpointModuleInstallContext<unknown>
): Promise<TSurface> {
  const result = install({
    id: context.id,
    transport: context.transport,
    signal: context.signal,
    hooks: context.hooks,
    own: context.own
  })
  if (isThenable(result) && !isNativePromise(result)) throw invalidFeature()
  const resolved = await result
  if (resolved === null || typeof resolved !== 'object') throw invalidFeature()
  return Object.freeze(resolved)
}

/** Distinguishes native Promise results from hostile PromiseLike objects. */
function isThenable(value: unknown): value is { readonly then: unknown } {
  return (
    ((typeof value === 'object' && value !== null) || typeof value === 'function') &&
    'then' in value
  )
}

/** Accepts promises produced by this realm while keeping arbitrary thenables outside the contract. */
function isNativePromise(value: unknown): value is Promise<unknown> {
  return value instanceof Promise
}

/** Copies and freezes string tuples used in the feature snapshot. */
function freezeStrings(values: readonly string[]): readonly string[] {
  if (
    !Array.isArray(values) ||
    values.some((value) => typeof value !== 'string' || value.length === 0) ||
    new Set(values).size !== values.length
  )
    throw invalidFeature()
  return Object.freeze([...values])
}

/** Copies and freezes feature dependency tuples without accepting forged tokens. */
function freezeFeatures(values: readonly IWebRpcFeature[] | undefined): readonly IWebRpcFeature[] {
  if (values === undefined) return Object.freeze([])
  if (!Array.isArray(values) || values.some((value) => value === null || typeof value !== 'object'))
    throw invalidFeature()
  return Object.freeze([...values])
}

/** Creates the package-owned invalid-feature error while preserving native error identity. */
function invalidFeature(): WebRpcError {
  return new WebRpcError(WebRpcErrorCode.invalidConfig, WebRpcErrorText.endpointModuleInvalid)
}

type IUnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (
  value: infer I
) => void
  ? I
  : never
