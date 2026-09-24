import {
  definePlugin,
  type IDefinedPluginConstraint,
  type IFeatureRecord,
  type IFeatureRecordRequiredExpose,
  type IFeatureOutputs,
  type IPluginConfig
} from '@migaia/plugin-host'
import { WebRpcConfigurationError, WebRpcError, WebRpcErrorCode } from './errors.js'
import { WebRpcErrorText } from './error-text.js'
import { runConstructionInstall } from './internal/construction-install.js'
import { assertPluginInstallResult, freezePlugin } from './internal/plugin-descriptor.js'
import type { IWebRpcPlugin, IWebRpcPluginMetadata } from './typing.js'
import type { IWebRpcPluginCore, IWebRpcPluginInstallScope } from './internal/plugin-contract.js'
import { createWebRpcPortFeatureSet } from './internal/port-feature.js'

/**
 * Marker recognizes only definitions created here; PluginHost still owns trusted definition
 * identity.
 */
const nativeMiddlewares = new WeakSet<object>()
/** Retains immutable declared component metadata without making it a runtime authority. */
const nativeMiddlewarePolicies = new WeakMap<object, IWebRpcPluginMetadata>()
const nativeMiddlewareComponents = new WeakMap<object, IWebRpcMiddlewareComponentPolicy>()
/**
 * Static object-form components consumed by endpoint bootstrap, never attached to a frozen host
 * token.
 */
export type IWebRpcMiddlewareComponentPolicy = Readonly<
  Pick<
    IWebRpcPlugin,
    'transport' | 'protocol' | 'codec' | 'framer' | 'discoveryMode' | 'pingCapability'
  >
>
/** Type-only component contribution; runtime data remains in the immutable policy sidecar. */
declare const webRpcMiddlewareComponents: unique symbol
export type IWebRpcMiddlewareComponentContribution<TComponents extends object> = Readonly<{
  readonly [webRpcMiddlewareComponents]?: TComponents
}>
/** Direct PluginHost definition type for a native Middleware registration. */
export type IWebRpcNativeMiddleware<
  TExtension extends Record<string, unknown> = Record<never, never>,
  TPublic extends object = Record<never, never>,
  TFeatureExpose extends object = Record<never, never>,
  TFeatures extends IFeatureRecord = Record<never, never>
> = IDefinedPluginConstraint<
  IWebRpcPluginCore,
  never,
  TExtension & TPublic,
  IPluginConfig,
  Record<never, never>,
  string,
  TFeatures,
  TFeatureExpose
>

/** Native descriptor keeps middleware lifecycle in the canonical PluginHost transaction. */
export type IWebRpcMiddlewareDescriptor<
  TExtension extends Record<string, unknown> = Record<never, never>,
  TPublic extends object = Record<never, never>,
  TFeatureExpose extends object = Record<never, never>
> = Readonly<{
  readonly install?: () => TExtension | PromiseLike<TExtension>
  readonly expose?: () => TPublic & (TPublic extends PromiseLike<unknown> ? never : unknown)
  readonly featureExpose?: () => TFeatureExpose &
    (TFeatureExpose extends PromiseLike<unknown> ? never : unknown)
}>

/**
 * Public middleware core retains ordinary install scope without exposing Host-local projection
 * receivers.
 */
export type IWebRpcMiddlewareCore<
  TFeatures extends IFeatureRecord = Record<never, never>,
  TFeatureExpose extends object = Record<never, never>
> = Readonly<{
  readonly id: IWebRpcPluginCore['id']
  readonly transport: IWebRpcPluginCore['transport']
  readonly signal: IWebRpcPluginCore['signal']
  readonly hooks: IWebRpcPluginCore['hooks']
  readonly own: IWebRpcPluginInstallScope['own']
  readonly features: IFeatureOutputs<TFeatures>
  readonly featureExpose: TFeatureExpose
}>

/** Defines a named native middleware Plugin; descriptor code runs per Host registration. */
export function defineMiddleware<const TComponents extends object>(
  definition: IWebRpcPlugin<TComponents>
): IWebRpcNativeMiddleware &
  IWebRpcMiddlewareComponentContribution<
    Pick<
      TComponents,
      Extract<
        keyof TComponents,
        'transport' | 'protocol' | 'codec' | 'framer' | 'discoveryMode' | 'pingCapability'
      >
    >
  >
export function defineMiddleware<
  TExtension extends Record<string, unknown> = Record<never, never>,
  TPublic extends object = Record<never, never>,
  TFeatures extends IFeatureRecord = Record<never, never>,
  TFeatureExpose extends object & IFeatureRecordRequiredExpose<TFeatures> = object &
    IFeatureRecordRequiredExpose<TFeatures>
>(
  name: string,
  descriptorFactory: (
    core: IWebRpcMiddlewareCore<TFeatures, TFeatureExpose>
  ) => IWebRpcMiddlewareDescriptor<TExtension, TPublic, TFeatureExpose> &
    (keyof IFeatureRecordRequiredExpose<TFeatures> extends never
      ? unknown
      : { readonly featureExpose: () => TFeatureExpose }),
  featureRecord?: TFeatures
): IWebRpcNativeMiddleware<TExtension, TPublic, TFeatureExpose, TFeatures>
export function defineMiddleware<
  TExtension extends Record<string, unknown> = Record<never, never>,
  TPublic extends object = Record<never, never>,
  TFeatures extends IFeatureRecord = Record<never, never>,
  TFeatureExpose extends object & IFeatureRecordRequiredExpose<TFeatures> = object &
    IFeatureRecordRequiredExpose<TFeatures>
>(
  name: string | IWebRpcPlugin,
  descriptorFactory?: (
    core: IWebRpcMiddlewareCore<TFeatures, TFeatureExpose>
  ) => IWebRpcMiddlewareDescriptor<TExtension, TPublic, TFeatureExpose> &
    (keyof IFeatureRecordRequiredExpose<TFeatures> extends never
      ? unknown
      : { readonly featureExpose: () => TFeatureExpose }),
  featureRecord?: TFeatures
): IWebRpcNativeMiddleware<TExtension, TPublic, TFeatureExpose, TFeatures> {
  if (typeof name === 'object' && name !== null) {
    const legacy = freezePlugin(name)
    const policy = snapshotMiddlewarePolicy(legacy.metadata)
    /** Each declared port is a registration-local Feature owned by this middleware. */
    const portFeatures = createWebRpcPortFeatureSet(policy.sharedProvides)
    /**
     * Capture validated legacy hooks once so later caller mutation cannot alter native
     * installation.
     */
    const middleware = definePlugin<IWebRpcPluginCore, Record<string, unknown>>(
      legacy.name,
      (core) => {
        const portRuntime = portFeatures.createRuntime()
        return {
          featureExpose: () => portRuntime.expose,
          install: async () => {
            const result = await runConstructionInstall(
              {
                id: core.id,
                transport: core.transport,
                control: core.construction,
                hooks: core.hooks,
                getPort: core.getPort,
                report: (error) => {
                  core.hooks({
                    name: 'failure',
                    at: core.construction.time.now(),
                    localId: core.id,
                    code: WebRpcErrorCode.internal,
                    error
                  })
                },
                registerScope: (_scope, close, awaitClose) => {
                  core.onDispose(async () => {
                    close()
                    await awaitClose()
                  })
                }
              },
              (scope) => legacy.install(scope)
            )
            assertPluginInstallResult(result)
            assertDeclaredKeys(policy.claims.publicKeys, result.extension)
            if (policy.sharedProvides !== undefined)
              assertDeclaredKeys(policy.sharedProvides, result.ports)
            portRuntime.publish(result.ports)
            core.publishPortFeatures(portRuntime.outputs)
            core.registerNativeMiddlewareKeys(legacy.name, Object.keys(result.extension))
            return result.extension
          }
        }
      },
      portFeatures.features
    )
    nativeMiddlewares.add(middleware)
    nativeMiddlewarePolicies.set(middleware, policy)
    const components: Pick<
      IWebRpcPlugin,
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
    return middleware as IWebRpcNativeMiddleware<TExtension, TPublic, TFeatureExpose, TFeatures>
  }
  if (!descriptorFactory)
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, WebRpcErrorText.endpointModuleInvalid)
  if (name.length === 0 || typeof descriptorFactory !== 'function')
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, WebRpcErrorText.endpointModuleInvalid)
  const middleware = definePlugin<
    IWebRpcPluginCore,
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
      /** Scope is absent while the synchronous descriptor factory executes. */
      let installScope: IWebRpcPluginInstallScope | undefined
      const requireInstallScope = (): IWebRpcPluginInstallScope => {
        if (!installScope) throw new WebRpcConfigurationError(WebRpcErrorText.endpointModuleInvalid)
        return installScope
      }
      const middlewareCore = {
        id: core.id,
        transport: core.transport,
        signal: core.signal,
        hooks: core.hooks,
        own: <T>(resource: T, release: () => void | Promise<void>) =>
          requireInstallScope().own(resource, release),
        get features(): IFeatureOutputs<TFeatures> {
          return core.features as IFeatureOutputs<TFeatures>
        },
        get featureExpose(): TFeatureExpose {
          return core.featureExpose as TFeatureExpose
        }
      } satisfies IWebRpcMiddlewareCore<TFeatures, TFeatureExpose>
      const descriptor = descriptorFactory(Object.freeze(middlewareCore))
      const install = descriptor.install
      const expose = descriptor.expose
      const nativeDescriptor = Object.freeze({
        ...descriptor,
        ...(install === undefined
          ? {}
          : {
              install: () =>
                runConstructionInstall(
                  {
                    id: core.id,
                    transport: core.transport,
                    control: core.construction,
                    hooks: core.hooks,
                    getPort: () => undefined,
                    report: (error) => {
                      core.hooks({
                        name: 'failure',
                        at: core.construction.time.now(),
                        localId: core.id,
                        code: WebRpcErrorCode.internal,
                        error
                      })
                    },
                    registerScope: (_scope, close, awaitClose) => {
                      core.onDispose(async () => {
                        close()
                        await awaitClose()
                      })
                    }
                  },
                  (scope) => {
                    installScope = scope
                    return install()
                  }
                ).then((output) => {
                  core.registerNativeMiddlewareKeys(name, Object.keys(output))
                  return output
                })
            }),
        ...(expose === undefined
          ? {}
          : {
              expose: () => {
                const output = expose()
                core.registerNativeMiddlewareKeys(name, Object.keys(output))
                return output
              }
            })
      })
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
  return middleware as unknown as IWebRpcNativeMiddleware<
    TExtension,
    TPublic,
    TFeatureExpose,
    TFeatures
  >
}

/** Snapshots static object-form claims before endpoint composition observes caller-owned metadata. */
function snapshotMiddlewarePolicy(metadata: IWebRpcPluginMetadata): IWebRpcPluginMetadata {
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
  const actual = Reflect.ownKeys(value)
  if (actual.length !== expected.length || actual.some((key) => !expected.includes(key)))
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, WebRpcErrorText.endpointModuleInvalid)
}

/**
 * Distinguishes a public native definition from legacy middleware snapshots without minting
 * identity.
 */
export const isDefinedMiddleware = (value: unknown): value is ReturnType<typeof defineMiddleware> =>
  typeof value === 'object' && value !== null && nativeMiddlewares.has(value)

/** Returns static middleware policy captured at definition time for composition admission. */
export const readDefinedMiddlewarePolicy = (value: unknown): IWebRpcPluginMetadata | undefined =>
  typeof value === 'object' && value !== null ? nativeMiddlewarePolicies.get(value) : undefined

/** Returns immutable object-form component policy without mutating PluginHost's frozen token. */
export const readDefinedMiddlewareComponents = (value: unknown) =>
  typeof value === 'object' && value !== null ? nativeMiddlewareComponents.get(value) : undefined

/** Reads the registration-local dynamic key snapshot captured before endpoint activation. */
