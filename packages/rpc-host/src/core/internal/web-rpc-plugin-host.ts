import {
  createRpcError,
  createRpcLifecycleError,
  type IRpcCleanupError,
  RpcCoreErrorCode
} from '../errors.js'
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

import type { IRpcConstructionControl } from './construction-install.js'
import type { IRpcPluginConstraint, IRpcPluginCore } from './plugin-contract.js'
import { translateEndpointDisposalError } from './disposal-translation.js'
import { preflightNativeRoleClaims, type IRpcNativeRoleClaimSource } from './feature-policy.js'
import { readWebRpcPortFeature, type IRpcPortFeature } from './port-feature.js'

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

/** Own the single native WebRPC mutation shell and its registration-local port catalog. */
class WebRpcPluginHost {
  /** Native endpoint identity remains unchanged for every registered domain core. */
  #id: string
  /** The exact admitted transport belongs to the endpoint, never to individual catalog entries. */
  #transport: IRpcTransport
  /** Original construction cancellation and native disposal share this control. */
  #construction: IRpcConstructionControl
  /** The original hooks callback remains an unbound observer, not a wrapper instance method. */
  #hooks: (event: IRpcHookEvent) => void
  /** Cleanup translation reads the original endpoint error collection at its original boundary. */
  #readCleanupErrors: () => readonly IRpcCleanupError[]
  /** Registration-local middleware keys are independent of shared port publication. */
  #nativeMiddlewareKeys = new Map<string, readonly string[]>()
  /** Each port entry retains its actual native registration owner and provisional output. */
  #portFeatures = new Map<
    string,
    Readonly<{ readonly owner: string; readonly output: IRpcPortFeature }>
  >()
  /** Committed handles replace provisional outputs without a second installation registry. */
  #handles = new Map<string, IPluginHandle<IRpcPluginConstraint>>()
  /** Terminal disposal rejects later catalog reads and is never reversed. */
  #terminal = false
  /** The original defineHost owner remains authoritative for transactions and Promise memoization. */
  #host: ReturnType<typeof defineHost<IRpcPluginCore, IRpcPipelineValue>>
  /** The frozen original facade preserves own fields, callbacks and detached operations. */
  readonly value: IRpcPluginHost
  /** Capture endpoint inputs before creating the one native mutation owner. */
  constructor(
    id: string,
    transport: IRpcTransport,
    construction: IRpcConstructionControl,
    hooks: (event: IRpcHookEvent) => void,
    options: IPluginHostOptions,
    readCleanupErrors: () => readonly IRpcCleanupError[] = () => []
  ) {
    this.#id = id
    this.#transport = transport
    this.#construction = construction
    this.#hooks = hooks
    this.#readCleanupErrors = readCleanupErrors
    this.#host = defineHost<IRpcPluginCore, IRpcPipelineValue>({
      host: options,
      domainCore: ({ pluginName }) => this.#createDomainCore(pluginName),
      translateDisposalError: (error) =>
        translateEndpointDisposalError(
          error,
          Reflect.apply(this.#readCleanupErrors, undefined, [])
        ),
      // 构造竞态在宿主排入终结性 mutation 之前关闭；`next()` 由 handle 保证恰好执行一次。
      dispose: async (next) => {
        this.#construction.close()
        try {
          /** The original native disposal outcome determines whether cleanup translation is needed. */
          const result = await next()
          if (result.cleanupErrors.length === 0) return result
          /** Preserve the first native cleanup failure and original aggregate member identities. */
          const cleanup =
            result.cleanupErrors.length === 1
              ? result.cleanupErrors[0]
              : new AggregateError(result.cleanupErrors)
          throw translateEndpointDisposalError(
            cleanup,
            Reflect.apply(this.#readCleanupErrors, undefined, [])
          )
        } finally {
          this.#terminal = true
          this.#portFeatures.clear()
          this.#handles.clear()
        }
      }
    })
    this.value = Object.freeze({
      ...this.#host,
      /** Registration-local middleware keys captured before the activation Plugin runs. */
      readNativeMiddlewareKeys: (): readonly string[] =>
        Object.freeze([...this.#nativeMiddlewareKeys.values()].flat()),
      /** Reads the current value behind a published registration-local port Feature. */
      getPort: this.#getPort,
      /** Reads extension publication through PluginHost's composition-only inspection surface. */
      getCurrentExtensions: (): Readonly<Record<PropertyKey, unknown>> =>
        openComposition(this.#host).getCurrentSnapshot().extensions,
      /** Installs the complete construction batch through PluginHost's single transaction. */
      installBatch: async (plugins: readonly IRpcPluginConstraint[]) => {
        /** Reject the existing native role conflict before acquiring any plugin resources. */
        const admissionFailure = createNativeAdmissionFailure(plugins)
        if (admissionFailure) throw admissionFailure
        try {
          /** Actual committed handles become the authoritative live port readers. */
          const installed = (await this.#host.use(
            ...(plugins as never)
          )) as unknown as readonly IPluginHandle<IRpcPluginConstraint>[]
          for (const handle of installed) this.#handles.set(handle.name, handle)
          return installed
        } catch (error) {
          this.#portFeatures.clear()
          this.#handles.clear()
          throw error
        }
      },
      unUse: async (name: string, mutationOptions?: IPluginDependencyMutationOptions) => {
        /** Prune ports only after the original native removal completes outside a dry run. */
        const result = await this.#host.unUse(name, mutationOptions as never)
        if (mutationOptions?.dryRun !== true) this.#prunePorts()
        return result
      }
    }) as IRpcPluginHost
  }
  /** Read the original heterogeneous native Feature handle without another projection. */
  #readHandleFeature = (handle: IPluginHandle<IRpcPluginConstraint>, name: string): unknown =>
    (handle as unknown as { getFeature(key: string): unknown }).getFeature(name)
  /** Read a live native handle output or its original provisional port. */
  #getPort = (key: PropertyKey): unknown => {
    if (this.#terminal) throw createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    if (typeof key !== 'string') return undefined
    /** The catalog maps each port to its original registration and provisional output. */
    const entry = this.#portFeatures.get(key)
    if (!entry) return undefined
    /** A committed native handle supersedes the provisional registration output. */
    const handle = this.#handles.get(entry.owner)
    return readWebRpcPortFeature(handle ? this.#readHandleFeature(handle, key) : entry.output)
  }
  /** Withdraw only catalog entries whose original native owner is no longer live. */
  #prunePorts = (): void => {
    for (const [name, entry] of this.#portFeatures) {
      /** A committed native handle supersedes the provisional registration output. */
      const handle = this.#handles.get(entry.owner)
      if (!handle) {
        this.#portFeatures.delete(name)
        continue
      }
      try {
        this.#readHandleFeature(handle, name)
      } catch {
        this.#portFeatures.delete(name)
        this.#handles.delete(entry.owner)
      }
    }
  }
  /** Build one registration-local domain core that publishes ports under its actual native owner. */
  #createDomainCore = (pluginName: string): IRpcPluginCore =>
    Object.freeze({
      id: this.#id,
      transport: this.#transport,
      signal: this.#construction.signal,
      hooks: this.#hooks,
      construction: this.#construction,
      getPort: this.#getPort,
      publishPortFeatures: (outputs: Readonly<Record<string, IRpcPortFeature>>) => {
        for (const [name, output] of Object.entries(outputs)) {
          if (this.#portFeatures.has(name))
            throw createRpcError(
              RpcCoreErrorCode.capabilityConflict,
              RpcCoreErrorText.endpointModuleDuplicated
            )
          this.#portFeatures.set(name, Object.freeze({ owner: pluginName, output }))
        }
      },
      registerNativeMiddlewareKeys: (name: string, keys: readonly string[]) => {
        /**
         * Registration-local keys preserve original publication order when another batch
         * contributes.
         */
        const previous = this.#nativeMiddlewareKeys.get(name) ?? []
        this.#nativeMiddlewareKeys.set(name, Object.freeze([...previous, ...keys]))
      }
    })
}

/** Create one endpoint-local native mutation owner with the existing frozen shell boundary. */
export function createWebRpcPluginHost(
  id: string,
  transport: IRpcTransport,
  construction: IRpcConstructionControl,
  hooks: (event: IRpcHookEvent) => void,
  options: IPluginHostOptions,
  readCleanupErrors: () => readonly IRpcCleanupError[] = () => []
): IRpcPluginHost {
  return new WebRpcPluginHost(id, transport, construction, hooks, options, readCleanupErrors).value
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
