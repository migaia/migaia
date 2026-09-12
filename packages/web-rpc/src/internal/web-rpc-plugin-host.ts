import {
  ERROR_TEXT,
  PluginHost,
  PluginHostError,
  PluginHostErrorCode,
  type IPluginHostDisposalResult,
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

/** PluginHost-owned WebRPC mutation and lifecycle shell; it is not a public endpoint surface. */
export class WebRpcPluginHost extends PluginHost<IWebRpcPluginCore, IWebRpcPipelineValue> {
  /** Caches the one endpoint-facing disposal Promise so repeated calls preserve identity. */
  #disposePromise: Promise<IPluginHostDisposalResult> | undefined
  /** Stores dynamic native middleware keys for this Host transaction only. */
  readonly #nativeMiddlewareKeys = new Map<string, readonly string[]>()
  readonly #domainCore: IWebRpcPluginCore
  readonly #readCleanupErrors: () => readonly IWebRpcCleanupError[]

  constructor(
    id: string,
    transport: IWebRpcTransport,
    construction: IWebRpcConstructionControl,
    hooks: (event: IWebRpcHookEvent) => void,
    options: IPluginHostOptions,
    readCleanupErrors: () => readonly IWebRpcCleanupError[] = () => []
  ) {
    super(options)
    this.#readCleanupErrors = readCleanupErrors
    this.#domainCore = Object.freeze({
      id,
      transport,
      signal: construction.signal,
      hooks,
      construction,
      registerNativeMiddlewareKeys: (name, keys) => {
        const previous = this.#nativeMiddlewareKeys.get(name) ?? []
        this.#nativeMiddlewareKeys.set(name, Object.freeze([...previous, ...keys]))
      }
    })
  }

  /** Returns registration-local middleware keys captured before the activation Plugin runs. */
  readNativeMiddlewareKeys(): readonly string[] {
    return Object.freeze([...this.#nativeMiddlewareKeys.values()].flat())
  }

  /** Installs the complete construction batch through PluginHost's single transaction. */
  installBatch(
    plugins: readonly IWebRpcPluginConstraint[]
  ): Promise<IPluginHostView<WebRpcPluginHost>> {
    const admissionFailure = createNativeAdmissionFailure(plugins)
    if (admissionFailure) return Promise.reject(admissionFailure)
    return this.use(...plugins) as unknown as Promise<IPluginHostView<WebRpcPluginHost>>
  }

  protected override createPluginDomainCore(): IWebRpcPluginCore {
    return this.#domainCore
  }

  /** Translates PluginHost disposal failures at the canonical Host Promise boundary. */
  protected override translateDisposalError(error: PluginHostError): Error {
    return translateEndpointDisposalError(error, this.#readCleanupErrors())
  }

  /** Closes active construction races before PluginHost's terminal mutation is queued. */
  override dispose(): Promise<IPluginHostDisposalResult> {
    if (this.#disposePromise) return this.#disposePromise
    this.#domainCore.construction.close()
    this.#disposePromise = super.dispose().then((result) => {
      if (result.cleanupErrors.length === 0) return result
      const cleanup =
        result.cleanupErrors.length === 1
          ? result.cleanupErrors[0]
          : new AggregateError(result.cleanupErrors)
      throw translateEndpointDisposalError(cleanup, this.#readCleanupErrors())
    })
    return this.#disposePromise
  }
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
