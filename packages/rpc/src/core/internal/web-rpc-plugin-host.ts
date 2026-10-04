import {
  defineHost,
  ERROR_TEXT,
  PluginHostError,
  PluginHostErrorCode,
  type IHostHandle,
  type IPluginHandle,
  type IPluginHostOptions,
  type IPluginDependencyMutationOptions
} from '@migaia/plugin-host'
import type { IRpcTransport } from '../transport.js'
import type { IRpcHookEvent } from '../typing.js'
import type { IRpcCleanupError } from '../errors.js'
import type { IRpcConstructionControl } from './construction-install.js'
import type { IRpcPluginConstraint, IRpcPluginCore } from './plugin-contract.js'
import { translateEndpointDisposalError } from './disposal-translation.js'
import { preflightNativeRoleClaims, type IRpcNativeRoleClaimSource } from './feature-policy.js'
import { readWebRpcPortFeature, type IRpcPortFeature } from './port-feature.js'
import { RpcError, RpcCoreErrorCode, RpcLifecycleError } from '../errors.js'
import { RpcCoreErrorText } from '../error-text.js'
import type { IRpcPortValues } from './plugin-shared-keys.js'
import { openComposition } from '@migaia/plugin-host/composition'

/** Pipeline values are intentionally opaque to the WebRPC domain shell. */
export type IRpcPipelineValue = unknown

/**
 * PluginHost-owned WebRPC mutation and lifecycle shell; it is not a public endpoint surface.
 *
 * Built with `defineHost` rather than by extending `PluginHost`: what this shell actually needed
 * from the base class were three hooks and two extra methods, and inheritance also handed it the
 * host's entire surface. The handle carries exactly the five things, and `dispose` memoization is
 * now the host's own guarantee instead of a field this file had to keep.
 */
export type IRpcPluginHost = IHostHandle<IRpcPluginCore, IRpcPipelineValue, readonly []> &
  Readonly<{
    /** Registration-local middleware keys captured before the activation Plugin runs. */
    readNativeMiddlewareKeys(): readonly string[]
    /** Reads one construction-time port Feature for internal orchestration and verification. */
    getPort<TKey extends keyof IRpcPortValues>(key: TKey): IRpcPortValues[TKey]
    getPort(key: PropertyKey): unknown
    /** Reads the current immutable extension publication for internal parity verification. */
    getCurrentExtensions(): Readonly<Record<PropertyKey, unknown>>
    /** Installs the complete construction batch through PluginHost's single transaction. */
    installBatch(
      plugins: readonly IRpcPluginConstraint[]
    ): Promise<readonly IPluginHandle<IRpcPluginConstraint>[]>
  }>

export function createWebRpcPluginHost(
  id: string,
  transport: IRpcTransport,
  construction: IRpcConstructionControl,
  hooks: (event: IRpcHookEvent) => void,
  options: IPluginHostOptions,
  readCleanupErrors: () => readonly IRpcCleanupError[] = () => []
): IRpcPluginHost {
  /** Dynamic native middleware keys, for this Host transaction only. */
  const nativeMiddlewareKeys = new Map<string, readonly string[]>()
  /** Construction catalog entries retain their owning registration for live handle resolution. */
  const portFeatures = new Map<
    string,
    Readonly<{ readonly owner: string; readonly output: IRpcPortFeature }>
  >()
  /** Installed handles replace provisional outputs as soon as the atomic batch commits. */
  const handles = new Map<string, IPluginHandle<IRpcPluginConstraint>>()
  /** Terminal marker keeps internal port reads fail-closed after disposal. */
  let terminal = false
  /** Reads a dynamically named port Feature from the heterogeneous middleware handle set. */
  const readHandleFeature = (handle: IPluginHandle<IRpcPluginConstraint>, name: string): unknown =>
    (handle as unknown as { getFeature(key: string): unknown }).getFeature(name)
  /** Reads provisional outputs during construction and live handle outputs after publication. */
  const getPort = (key: PropertyKey): unknown => {
    if (terminal) throw new RpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    if (typeof key !== 'string') return undefined
    const entry = portFeatures.get(key)
    if (!entry) return undefined
    const handle = handles.get(entry.owner)
    return readWebRpcPortFeature(handle ? readHandleFeature(handle, key) : entry.output)
  }
  /** Removes catalog entries whose exact owner registration is no longer live. */
  const prunePorts = (): void => {
    for (const [name, entry] of portFeatures) {
      const handle = handles.get(entry.owner)
      if (!handle) {
        portFeatures.delete(name)
        continue
      }
      try {
        readHandleFeature(handle, name)
      } catch {
        portFeatures.delete(name)
        handles.delete(entry.owner)
      }
    }
  }
  /** Builds the registration-local domain core so publication records the exact owner name. */
  const createDomainCore = (pluginName: string): IRpcPluginCore =>
    Object.freeze({
      id,
      transport,
      signal: construction.signal,
      hooks,
      construction,
      getPort,
      publishPortFeatures: (outputs: Readonly<Record<string, IRpcPortFeature>>) => {
        for (const [name, output] of Object.entries(outputs)) {
          if (portFeatures.has(name))
            throw new RpcError(
              RpcCoreErrorCode.capabilityConflict,
              RpcCoreErrorText.endpointModuleDuplicated
            )
          portFeatures.set(name, Object.freeze({ owner: pluginName, output }))
        }
      },
      registerNativeMiddlewareKeys: (name: string, keys: readonly string[]) => {
        const previous = nativeMiddlewareKeys.get(name) ?? []
        nativeMiddlewareKeys.set(name, Object.freeze([...previous, ...keys]))
      }
    })
  const host = defineHost<IRpcPluginCore, IRpcPipelineValue>({
    host: options,
    domainCore: ({ pluginName }) => createDomainCore(pluginName),
    translateDisposalError: (error) => translateEndpointDisposalError(error, readCleanupErrors()),
    // 构造竞态在宿主排入终结性 mutation 之前关闭；`next()` 由 handle 保证恰好执行一次。
    dispose: async (next) => {
      construction.close()
      try {
        const result = await next()
        if (result.cleanupErrors.length === 0) return result
        const cleanup =
          result.cleanupErrors.length === 1
            ? result.cleanupErrors[0]
            : new AggregateError(result.cleanupErrors)
        throw translateEndpointDisposalError(cleanup, readCleanupErrors())
      } finally {
        terminal = true
        portFeatures.clear()
        handles.clear()
      }
    }
  })
  return Object.freeze({
    ...host,
    /** Registration-local middleware keys captured before the activation Plugin runs. */
    readNativeMiddlewareKeys: (): readonly string[] =>
      Object.freeze([...nativeMiddlewareKeys.values()].flat()),
    /** Reads the current value behind a published registration-local port Feature. */
    getPort,
    /** Reads extension publication through PluginHost's composition-only inspection surface. */
    getCurrentExtensions: (): Readonly<Record<PropertyKey, unknown>> =>
      openComposition(host).getCurrentSnapshot().extensions,
    /** Installs the complete construction batch through PluginHost's single transaction. */
    installBatch: async (plugins: readonly IRpcPluginConstraint[]) => {
      const admissionFailure = createNativeAdmissionFailure(plugins)
      if (admissionFailure) throw admissionFailure
      try {
        const installed = (await host.use(
          ...(plugins as never)
        )) as unknown as readonly IPluginHandle<IRpcPluginConstraint>[]
        for (const handle of installed) handles.set(handle.name, handle)
        return installed
      } catch (error) {
        portFeatures.clear()
        handles.clear()
        throw error
      }
    },
    unUse: async (name: string, mutationOptions?: IPluginDependencyMutationOptions) => {
      const result = await host.unUse(name, mutationOptions as never)
      if (mutationOptions?.dryRun !== true) prunePorts()
      return result
    }
  }) as IRpcPluginHost
}

/** Creates the PluginHost boundary error for the one asynchronous install entry point. */
function createNativeAdmissionFailure(
  plugins: readonly IRpcPluginConstraint[]
): PluginHostError | undefined {
  const nativeDefinitions = plugins as readonly IRpcNativeRoleClaimSource[]
  const firstFailure = preflightNativeRoleClaims(nativeDefinitions)
  if (!firstFailure) return undefined
  const failureMessage =
    firstFailure.error instanceof Error ? firstFailure.error.message : String(firstFailure.error)
  return new PluginHostError(
    PluginHostErrorCode.pluginInstallFailed,
    RpcCoreErrorText.pluginInstallFailureDetail(
      ERROR_TEXT.PLUGIN_INSTALL_FAILED(firstFailure.failedName),
      failureMessage
    ),
    {
      cause: firstFailure.error,
      detail: Object.freeze({
        failedName: firstFailure.failedName,
        rollbackErrors: Object.freeze([])
      })
    }
  )
}
