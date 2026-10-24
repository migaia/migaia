import { createRpcConfigurationError, createRpcError, RpcCoreErrorCode } from './errors.js'
import {
  definePlugin,
  type IDefinedPluginConstraint,
  type IFeatureRecord,
  type IFeatureRecordRequiredExpose,
  type IFeatureOutputs,
  type IPluginConfig
} from '@migaia/plugin-host'

import { RpcCoreErrorText } from './error-text.js'
import { runConstructionInstall } from './internal/construction-install.js'
import { assertPluginInstallResult, freezePlugin } from './internal/plugin-descriptor.js'
import type { IRpcPlugin, IRpcPluginMetadata } from './typing.js'
import type { IRpcPluginCore, IRpcPluginInstallScope } from './internal/plugin-contract.js'
import { createWebRpcPortFeatureSet } from './internal/port-feature.js'

/**
 * Marker recognizes only definitions created here; PluginHost still owns trusted definition
 * identity.
 */
const nativeMiddlewares = new WeakSet<object>()
/** Retains immutable declared component metadata without making it a runtime authority. */
const nativeMiddlewarePolicies = new WeakMap<object, IRpcPluginMetadata>()
const nativeMiddlewareComponents = new WeakMap<object, IRpcMiddlewareComponentPolicy>()
/**
 * Static object-form components consumed by endpoint bootstrap, never attached to a frozen host
 * token.
 */
export type IRpcMiddlewareComponentPolicy = Readonly<
  Pick<
    IRpcPlugin,
    'transport' | 'protocol' | 'codec' | 'framer' | 'discoveryMode' | 'pingCapability'
  >
>
/** Type-only component contribution; runtime data remains in the immutable policy sidecar. */
declare const routeMiddlewareComponents: unique symbol
export type IRpcMiddlewareComponentContribution<TComponents extends object> = Readonly<{
  readonly [routeMiddlewareComponents]?: TComponents
}>
/** Direct PluginHost definition type for a native Middleware registration. */
export type IRpcNativeMiddleware<
  TExtension extends Record<string, unknown> = Record<never, never>,
  TPublic extends object = Record<never, never>,
  TFeatureExpose extends object = Record<never, never>,
  TFeatures extends IFeatureRecord = Record<never, never>
> = IDefinedPluginConstraint<
  IRpcPluginCore,
  never,
  TExtension & TPublic,
  IPluginConfig,
  Record<never, never>,
  string,
  TFeatures,
  TFeatureExpose
>

/** Native descriptor keeps middleware lifecycle in the canonical PluginHost transaction. */
export type IRpcMiddlewareDescriptor<
  TExtension extends Record<string, unknown> = Record<never, never>,
  TPublic extends object = Record<never, never>,
  TFeatureExpose extends object = Record<never, never>
> = Readonly<{
  /**
   * Optional asynchronous extension setup; resources acquired here belong to the construction
   * scope.
   */
  readonly install?: () => TExtension | PromiseLike<TExtension>
  /** Optional synchronous public projection; a Promise is not an exposed surface. */
  readonly expose?: () => TPublic & (TPublic extends PromiseLike<unknown> ? never : unknown)
  /** Optional synchronous host bridge for the declared Feature dependencies. */
  readonly featureExpose?: () => TFeatureExpose &
    (TFeatureExpose extends PromiseLike<unknown> ? never : unknown)
}>

/**
 * Public middleware core retains ordinary install scope without exposing Host-local projection
 * receivers.
 */
export type IRpcMiddlewareCore<
  TFeatures extends IFeatureRecord = Record<never, never>,
  TFeatureExpose extends object = Record<never, never>
> = Readonly<{
  /** Local endpoint identity captured for this registration. */
  readonly id: IRpcPluginCore['id']
  /** Selected physical adapter; this view does not transfer resource ownership. */
  readonly transport: IRpcPluginCore['transport']
  /** Original registration cancellation signal. */
  readonly signal: IRpcPluginCore['signal']
  /** Publish local diagnostics through the endpoint hook owner. */
  readonly hooks: IRpcPluginCore['hooks']
  /**
   * Register cleanup during install; using it before the install scope exists rejects
   * configuration.
   */
  readonly own: IRpcPluginInstallScope['own']
  /** Resolved outputs from the explicitly declared Feature dependencies. */
  readonly features: IFeatureOutputs<TFeatures>
  /** Host bridge declared by this middleware for its Feature factories. */
  readonly featureExpose: TFeatureExpose
}>

/** One object-form middleware registration owns its native port cells and original install scope. */
class ObjectMiddlewareRegistration {
  /** The genuine native core owns lifecycle disposal and dynamic-key publication. */
  #core: IRpcPluginCore & import('@migaia/plugin-host').IPluginHostCore<never>
  /** The original frozen descriptor preserves its install receiver and output contract. */
  #legacy: IRpcPlugin
  /** Immutable declared keys are checked only after successful original installation. */
  #policy: IRpcPluginMetadata
  /** Each native registration owns its own deferred shared-port cells. */
  #portRuntime: ReturnType<ReturnType<typeof createWebRpcPortFeatureSet>['createRuntime']>
  /** Native PluginHost hooks reference only this explicit registration owner. */
  readonly value
  /** Initialize this installation's original port cells before publishing native callbacks. */
  constructor(
    core: IRpcPluginCore & import('@migaia/plugin-host').IPluginHostCore<never>,
    legacy: IRpcPlugin,
    policy: IRpcPluginMetadata,
    portRuntime: ReturnType<ReturnType<typeof createWebRpcPortFeatureSet>['createRuntime']>
  ) {
    this.#core = core
    this.#legacy = legacy
    this.#policy = policy
    this.#portRuntime = portRuntime
    this.value = { featureExpose: () => this.#portRuntime.expose, install: this.#install }
  }
  /** Run the existing construction scope, then publish exact checked output and shared ports. */
  #install = async () => {
    /** The existing scope owns the original rollback and cleanup ordering. */ const result =
      await runConstructionInstall(
        {
          id: this.#core.id,
          transport: this.#core.transport,
          control: this.#core.construction,
          hooks: this.#core.hooks,
          getPort: this.#core.getPort,
          report: (error) =>
            this.#core.hooks({
              name: 'failure',
              at: this.#core.construction.time.timestamp(),
              localId: this.#core.id,
              code: RpcCoreErrorCode.internal,
              error
            }),
          registerScope: (_scope, close, awaitClose) => {
            this.#core.onDispose(async () => {
              close()
              await awaitClose()
            })
          }
        },
        (scope) => this.#legacy.install(scope)
      )
    assertPluginInstallResult(result)
    assertDeclaredKeys(this.#policy.claims.publicKeys, result.extension)
    if (this.#policy.sharedProvides !== undefined)
      assertDeclaredKeys(this.#policy.sharedProvides, result.ports)
    this.#portRuntime.publish(result.ports)
    this.#core.publishPortFeatures(this.#portRuntime.outputs)
    this.#core.registerNativeMiddlewareKeys(this.#legacy.name, Object.keys(result.extension))
    return result.extension
  }
}

/** Preserve object-form immutable policy admission separately from descriptor registration. */
function defineObjectMiddleware(definition: IRpcPlugin): IRpcNativeMiddleware {
  const legacy = freezePlugin(definition)
  const policy = snapshotMiddlewarePolicy(legacy.metadata)
  /** Each declared port is a registration-local Feature owned by this middleware. */
  const portFeatures = createWebRpcPortFeatureSet(policy.sharedProvides)
  /** Capture validated legacy hooks once so later caller mutation cannot alter native installation. */
  const middleware = definePlugin<IRpcPluginCore, Record<string, unknown>>(
    legacy.name,
    (core) =>
      new ObjectMiddlewareRegistration(core, legacy, policy, portFeatures.createRuntime()).value,
    portFeatures.features
  )
  nativeMiddlewares.add(middleware)
  nativeMiddlewarePolicies.set(middleware, policy)
  const components: Pick<
    IRpcPlugin,
    'transport' | 'protocol' | 'codec' | 'framer' | 'discoveryMode' | 'pingCapability'
  > = {}
  for (const key of [
    'transport',
    'protocol',
    'codec',
    'framer',
    'discoveryMode',
    'pingCapability'
  ] as const) {
    const property = Object.getOwnPropertyDescriptor(legacy, key)
    if (property && 'value' in property) Object.assign(components, { [key]: property.value })
  }
  nativeMiddlewareComponents.set(middleware, Object.freeze(components))
  return middleware as IRpcNativeMiddleware
}

/** The genuine native descriptor receives lifecycle methods and exact selected Feature outputs. */
type INativeMiddlewareRegistrationCore<
  TFeatures extends IFeatureRecord,
  TExpose extends object
> = IRpcPluginCore &
  import('@migaia/plugin-host').IPluginHostCore<never> &
  Readonly<{ features: IFeatureOutputs<TFeatures>; featureExpose: TExpose }>

/** Each native registration owns the descriptor's original construction-scope lifetime. */
class NativeMiddlewareDescriptorRegistration<
  TExtension extends Record<string, unknown>,
  TPublic extends object,
  TFeatures extends IFeatureRecord,
  TExpose extends object
> {
  /** The original core owns hooks, lifecycle registration and public-key publication. */
  #core: INativeMiddlewareRegistrationCore<TFeatures, TExpose>
  /** The definition name labels only this registration's dynamic middleware keys. */
  #name: string
  /** Scope remains absent during the synchronous descriptor factory, then belongs to install. */
  #installScope: IRpcPluginInstallScope | undefined
  /** The admitted install callback stays receiverless and preserves its original returned value. */
  #install: IRpcMiddlewareDescriptor<TExtension, TPublic, TExpose>['install']
  /** The admitted expose callback stays synchronous and receiverless. */
  #expose: IRpcMiddlewareDescriptor<TExtension, TPublic, TExpose>['expose']
  /** The frozen descriptor retains only the original fields and selected lifecycle wrappers. */
  readonly value: IRpcMiddlewareDescriptor<TExtension, TPublic, TExpose>
  /**
   * Capture descriptor callbacks only after its synchronous factory has observed the uninstalled
   * core.
   */
  constructor(
    name: string,
    core: INativeMiddlewareRegistrationCore<TFeatures, TExpose>,
    factory: (
      core: IRpcMiddlewareCore<TFeatures, TExpose>
    ) => IRpcMiddlewareDescriptor<TExtension, TPublic, TExpose>
  ) {
    this.#core = core
    this.#name = name
    /**
     * A frozen public view borrows native Feature resolution without granting install-scope access
     * early.
     */
    const middlewareCore = {
      id: core.id,
      transport: core.transport,
      signal: core.signal,
      hooks: core.hooks,
      own: <T>(resource: T, release: () => void | Promise<void>) =>
        this.#requireInstallScope().own(resource, release),
      get features(): IFeatureOutputs<TFeatures> {
        return core.features as IFeatureOutputs<TFeatures>
      },
      get featureExpose(): TExpose {
        return core.featureExpose as TExpose
      }
    } satisfies IRpcMiddlewareCore<TFeatures, TExpose>
    /** The original factory is invoked once without lending it a native mutable receiver. */
    const descriptor = factory(Object.freeze(middlewareCore))
    this.#install = descriptor.install
    this.#expose = descriptor.expose
    this.value = Object.freeze({
      ...descriptor,
      ...(this.#install === undefined ? {} : { install: this.#runInstall }),
      ...(this.#expose === undefined ? {} : { expose: this.#runExpose })
    })
  }
  /** Own is unavailable until the canonical construction scope has entered installation. */
  #requireInstallScope = (): IRpcPluginInstallScope => {
    if (!this.#installScope)
      throw createRpcConfigurationError(RpcCoreErrorText.endpointModuleInvalid)
    return this.#installScope
  }
  /** Run installation through the original rollback scope and publish keys only after success. */
  #runInstall = () =>
    runConstructionInstall(
      {
        id: this.#core.id,
        transport: this.#core.transport,
        control: this.#core.construction,
        hooks: this.#core.hooks,
        getPort: () => undefined,
        report: (error) =>
          this.#core.hooks({
            name: 'failure',
            at: this.#core.construction.time.timestamp(),
            localId: this.#core.id,
            code: RpcCoreErrorCode.internal,
            error
          }),
        registerScope: (_scope, close, awaitClose) => {
          this.#core.onDispose(async () => {
            close()
            await awaitClose()
          })
        }
      },
      (scope) => {
        this.#installScope = scope
        /** Keep the original user callback receiverless. */ const install = this.#install!
        return install()
      }
    ).then((output) => {
      this.#core.registerNativeMiddlewareKeys(this.#name, Object.keys(output))
      return output
    })
  /** Project the original synchronous output before publishing this registration's public keys. */
  #runExpose = () => {
    /** Keep the original user callback receiverless. */ const expose = this.#expose!
    const output = expose()
    this.#core.registerNativeMiddlewareKeys(this.#name, Object.keys(output))
    return output
  }
}

/** Defines a named native middleware Plugin; descriptor code runs per Host registration. */
export function defineMiddleware<const TComponents extends object>(
  definition: IRpcPlugin<TComponents>
): IRpcNativeMiddleware &
  IRpcMiddlewareComponentContribution<
    Pick<
      TComponents,
      Extract<
        keyof TComponents,
        'transport' | 'protocol' | 'codec' | 'framer' | 'discoveryMode' | 'pingCapability'
      >
    >
  >
/**
 * Define a registration-local descriptor factory with optional direct Feature dependencies.
 * Installation failure rolls back the original Host batch; descriptor/expose factories stay
 * synchronous.
 */
export function defineMiddleware<
  TExtension extends Record<string, unknown> = Record<never, never>,
  TPublic extends object = Record<never, never>,
  TFeatures extends IFeatureRecord = Record<never, never>,
  TFeatureExpose extends object & IFeatureRecordRequiredExpose<TFeatures> = object &
    IFeatureRecordRequiredExpose<TFeatures>
>(
  name: string,
  descriptorFactory: (
    core: IRpcMiddlewareCore<TFeatures, TFeatureExpose>
  ) => IRpcMiddlewareDescriptor<TExtension, TPublic, TFeatureExpose> &
    (keyof IFeatureRecordRequiredExpose<TFeatures> extends never
      ? unknown
      : { readonly featureExpose: () => TFeatureExpose }),
  featureRecord?: TFeatures
): IRpcNativeMiddleware<TExtension, TPublic, TFeatureExpose, TFeatures>
export function defineMiddleware<
  TExtension extends Record<string, unknown> = Record<never, never>,
  TPublic extends object = Record<never, never>,
  TFeatures extends IFeatureRecord = Record<never, never>,
  TFeatureExpose extends object & IFeatureRecordRequiredExpose<TFeatures> = object &
    IFeatureRecordRequiredExpose<TFeatures>
>(
  name: string | IRpcPlugin,
  descriptorFactory?: (
    core: IRpcMiddlewareCore<TFeatures, TFeatureExpose>
  ) => IRpcMiddlewareDescriptor<TExtension, TPublic, TFeatureExpose> &
    (keyof IFeatureRecordRequiredExpose<TFeatures> extends never
      ? unknown
      : { readonly featureExpose: () => TFeatureExpose }),
  featureRecord?: TFeatures
): IRpcNativeMiddleware<TExtension, TPublic, TFeatureExpose, TFeatures> {
  if (typeof name === 'object' && name !== null)
    return defineObjectMiddleware(name) as unknown as IRpcNativeMiddleware<
      TExtension,
      TPublic,
      TFeatureExpose,
      TFeatures
    >
  if (!descriptorFactory)
    throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.endpointModuleInvalid)
  if (name.length === 0 || typeof descriptorFactory !== 'function')
    throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.endpointModuleInvalid)
  const middleware = definePlugin<
    IRpcPluginCore,
    TExtension,
    never,
    string,
    TFeatures,
    TFeatureExpose,
    TPublic,
    Record<never, never>
  >(
    name,
    (core) => {
      /** Each native registration owns its own install scope and captured descriptor callbacks. */
      const nativeDescriptor = new NativeMiddlewareDescriptorRegistration<
        TExtension,
        TPublic,
        TFeatures,
        TFeatureExpose
      >(name, core, descriptorFactory).value
      return nativeDescriptor as typeof nativeDescriptor &
        (keyof IFeatureRecordRequiredExpose<TFeatures> extends never
          ? unknown
          : { readonly featureExpose: () => TFeatureExpose }) &
        (keyof TExtension & keyof TPublic extends never
          ? unknown
          : { readonly duplicateHostProjectionKeys: never })
    },
    featureRecord
  )
  nativeMiddlewares.add(middleware)
  return middleware as unknown as IRpcNativeMiddleware<
    TExtension,
    TPublic,
    TFeatureExpose,
    TFeatures
  >
}

/** Snapshots static object-form claims before endpoint composition observes caller-owned metadata. */
function snapshotMiddlewarePolicy(metadata: IRpcPluginMetadata): IRpcPluginMetadata {
  return Object.freeze({
    claims: Object.freeze({
      routes: Object.freeze([...metadata.claims.routes]),
      provides: Object.freeze([...metadata.claims.provides]),
      consumes: Object.freeze([...metadata.claims.consumes]),
      publicKeys: Object.freeze([...metadata.claims.publicKeys]),
      exposedKeys: Object.freeze([...metadata.claims.exposedKeys]),
      activator: metadata.claims.activator
    }),
    ...(metadata.sharedProvides === undefined
      ? {}
      : { sharedProvides: Object.freeze([...metadata.sharedProvides]) }),
    ...(metadata.sharedConsumes === undefined
      ? {}
      : { sharedConsumes: Object.freeze([...metadata.sharedConsumes]) }),
    ...(metadata.sharedOptionalConsumes === undefined
      ? {}
      : { sharedOptionalConsumes: Object.freeze([...metadata.sharedOptionalConsumes]) })
  })
}

/** Rejects object-form output drift before endpoint publication or ingress activation. */
function assertDeclaredKeys(expected: readonly PropertyKey[], value: object): void {
  /** Read actual keys first so an unreadable output retains the original admission failure order. */
  const actual = Reflect.ownKeys(value)
  /** Snapshot declared membership once; total actual/expected key admission is O(n). */
  const declared = new Set(expected)
  if (actual.length !== expected.length || actual.some((key) => !declared.has(key)))
    throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.endpointModuleInvalid)
}

/**
 * Distinguishes a public native definition from legacy middleware snapshots without minting
 * identity.
 */
export const isDefinedMiddleware = (value: unknown): value is ReturnType<typeof defineMiddleware> =>
  typeof value === 'object' && value !== null && nativeMiddlewares.has(value)

/** Returns static middleware policy captured at definition time for composition admission. */
export const readDefinedMiddlewarePolicy = (value: unknown): IRpcPluginMetadata | undefined =>
  typeof value === 'object' && value !== null ? nativeMiddlewarePolicies.get(value) : undefined

/** Returns immutable object-form component policy without mutating PluginHost's frozen token. */
export const readDefinedMiddlewareComponents = (value: unknown) =>
  typeof value === 'object' && value !== null ? nativeMiddlewareComponents.get(value) : undefined

/** Reads the registration-local dynamic key snapshot captured before endpoint activation. */
