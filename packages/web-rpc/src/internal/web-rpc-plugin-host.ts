import {
  ERROR_TEXT,
  PluginHost,
  PluginHostError,
  PluginHostErrorCode,
  type IPluginHostOptions,
  type IPluginHostPublic
} from '@migaia/plugin-host'
import type { IWebRpcTransport } from '../transport.js'
import type { IWebRpcHookEvent } from '../typing.js'
import type { IWebRpcCleanupError } from '../errors.js'
import type { IWebRpcConstructionControl } from './construction-install.js'
import type { IWebRpcPluginConstraint, IWebRpcPluginCore } from './plugin-contract.js'
import { translateEndpointDisposalError } from './disposal-translation.js'
import {
  preflightNativeControlClaims,
  preflightNativeProviderClaims,
  type IWebRpcNativeProviderClaimSource
} from './plugin-translator.js'

/** Pipeline values are intentionally opaque to the WebRPC domain shell. */
export type IWebRpcPipelineValue = unknown

/** PluginHost-owned WebRPC mutation and lifecycle shell; it is not a public endpoint surface. */
export class WebRpcPluginHost extends PluginHost<IWebRpcPluginCore, IWebRpcPipelineValue> {
  readonly #domainCore: IWebRpcPluginCore
  readonly #readCleanupErrors: () => readonly IWebRpcCleanupError[]

  constructor(
    id: string,
    transport: IWebRpcTransport,
    construction: IWebRpcConstructionControl,
    hooks: (event: IWebRpcHookEvent) => void,
    options: IPluginHostOptions = {},
    readCleanupErrors: () => readonly IWebRpcCleanupError[] = () => []
  ) {
    super(options)
    this.#readCleanupErrors = readCleanupErrors
    this.#domainCore = Object.freeze({
      id,
      transport,
      signal: construction.signal,
      hooks,
      construction
    })
  }

  /** Installs the complete construction batch through PluginHost's single transaction. */
  installBatch(
    plugins: readonly IWebRpcPluginConstraint[]
  ): Promise<IPluginHostPublic<IWebRpcPluginCore>> {
    const admissionFailure = createNativeAdmissionFailure(plugins)
    if (admissionFailure) return Promise.reject(admissionFailure)
    return this.use(...plugins) as unknown as Promise<IPluginHostPublic<IWebRpcPluginCore>>
  }

  /** Installs constructor-time plugins for the synchronous shell path. */
  installBatchSync(plugins: readonly IWebRpcPluginConstraint[]): this {
    const admissionFailure = createNativeAdmissionFailure(plugins)
    if (admissionFailure) throw admissionFailure
    this.useSync(plugins)
    return this
  }

  protected override createPluginDomainCore(): IWebRpcPluginCore {
    return this.#domainCore
  }

  /** Translates PluginHost disposal failures at the canonical Host Promise boundary. */
  protected override translateDisposalError(error: PluginHostError): Error {
    return translateEndpointDisposalError(error, this.#readCleanupErrors())
  }

  /** Closes active construction races before PluginHost's terminal mutation is queued. */
  override dispose(): Promise<void> {
    this.#domainCore.construction.close()
    return super.dispose()
  }
}

/** Creates the identical PluginHost boundary error for async and synchronous install entry points. */
function createNativeAdmissionFailure(
  plugins: readonly IWebRpcPluginConstraint[]
): PluginHostError | undefined {
  const nativeDefinitions = plugins as readonly IWebRpcNativeProviderClaimSource[]
  const admissionFailure = preflightNativeProviderClaims(nativeDefinitions)
  const controlAdmissionFailure = preflightNativeControlClaims(nativeDefinitions)
  const firstFailure = admissionFailure ?? controlAdmissionFailure
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
