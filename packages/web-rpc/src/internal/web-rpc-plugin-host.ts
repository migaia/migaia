import {
  defineHost,
  ERROR_TEXT,
  PluginHostError,
  PluginHostErrorCode,
  type IHostHandle,
  type IPluginHostOptions,
  type IPluginHostView
} from '@migaia/plugin-host'
import type { IWebRpcTransport } from '../transport.js'
import type { IWebRpcHookEvent } from '../typing.js'
import type { IWebRpcCleanupError } from '../errors.js'
import type { IWebRpcConstructionControl } from './construction-install.js'
import type { IWebRpcPluginConstraint, IWebRpcPluginCore } from './plugin-contract.js'
import { translateEndpointDisposalError } from './disposal-translation.js'
import { preflightNativeRoleClaims, type IWebRpcNativeRoleClaimSource } from './feature-policy.js'

/** Pipeline values are intentionally opaque to the WebRPC domain shell. */
export type IWebRpcPipelineValue = unknown

/**
 * PluginHost-owned WebRPC mutation and lifecycle shell; it is not a public endpoint surface.
 *
 * Built with `defineHost` rather than by extending `PluginHost`: what this shell actually needed
 * from the base class were three hooks and two extra methods, and inheritance also handed it the
 * host's entire surface. The handle carries exactly the five things, and `dispose` memoization is
 * now the host's own guarantee instead of a field this file had to keep.
 */
export type IWebRpcPluginHost = IHostHandle<IWebRpcPluginCore, IWebRpcPipelineValue, readonly []> &
  Readonly<{
    /** Registration-local middleware keys captured before the activation Plugin runs. */
    readNativeMiddlewareKeys(): readonly string[]
    /** Installs the complete construction batch through PluginHost's single transaction. */
    installBatch(
      plugins: readonly IWebRpcPluginConstraint[]
    ): Promise<IPluginHostView<IWebRpcPluginHost>>
  }>

export function createWebRpcPluginHost(
  id: string,
  transport: IWebRpcTransport,
  construction: IWebRpcConstructionControl,
  hooks: (event: IWebRpcHookEvent) => void,
  options: IPluginHostOptions,
  readCleanupErrors: () => readonly IWebRpcCleanupError[] = () => []
): IWebRpcPluginHost {
  /** Dynamic native middleware keys, for this Host transaction only. */
  const nativeMiddlewareKeys = new Map<string, readonly string[]>()
  const domainCore: IWebRpcPluginCore = Object.freeze({
    id,
    transport,
    signal: construction.signal,
    hooks,
    construction,
    registerNativeMiddlewareKeys: (name: string, keys: readonly string[]) => {
      const previous = nativeMiddlewareKeys.get(name) ?? []
      nativeMiddlewareKeys.set(name, Object.freeze([...previous, ...keys]))
    }
  })
  const host = defineHost<IWebRpcPluginCore, IWebRpcPipelineValue>({
    host: options,
    domainCore: () => domainCore,
    translateDisposalError: (error) => translateEndpointDisposalError(error, readCleanupErrors()),
    // 构造竞态在宿主排入终结性 mutation 之前关闭；`next()` 由 handle 保证恰好执行一次。
    dispose: async (next) => {
      domainCore.construction.close()
      const result = await next()
      if (result.cleanupErrors.length === 0) return result
      const cleanup =
        result.cleanupErrors.length === 1
          ? result.cleanupErrors[0]
          : new AggregateError(result.cleanupErrors)
      throw translateEndpointDisposalError(cleanup, readCleanupErrors())
    }
  })
  return Object.freeze({
    ...host,
    /** Registration-local middleware keys captured before the activation Plugin runs. */
    readNativeMiddlewareKeys: (): readonly string[] =>
      Object.freeze([...nativeMiddlewareKeys.values()].flat()),
    /** Installs the complete construction batch through PluginHost's single transaction. */
    installBatch: (plugins: readonly IWebRpcPluginConstraint[]) => {
      const admissionFailure = createNativeAdmissionFailure(plugins)
      if (admissionFailure) return Promise.reject(admissionFailure)
      return host.use(...(plugins as never)) as unknown as Promise<
        IPluginHostView<IWebRpcPluginHost>
      >
    }
  }) as IWebRpcPluginHost
}

/** Creates the PluginHost boundary error for the one asynchronous install entry point. */
function createNativeAdmissionFailure(
  plugins: readonly IWebRpcPluginConstraint[]
): PluginHostError | undefined {
  const nativeDefinitions = plugins as readonly IWebRpcNativeRoleClaimSource[]
  const firstFailure = preflightNativeRoleClaims(nativeDefinitions)
  if (!firstFailure) return undefined
  const failureMessage =
    firstFailure.error instanceof Error ? firstFailure.error.message : String(firstFailure.error)
  return new PluginHostError(
    PluginHostErrorCode.pluginInstallFailed,
    `${ERROR_TEXT.PLUGIN_INSTALL_FAILED(firstFailure.failedName)}: ${failureMessage}`,
    {
      cause: firstFailure.error,
      detail: Object.freeze({
        failedName: firstFailure.failedName,
        rollbackErrors: Object.freeze([])
      })
    }
  )
}
