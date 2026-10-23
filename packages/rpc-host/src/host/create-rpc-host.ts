import { translateEndpointDisposalError } from '../core/internal/disposal-translation.js'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { defaultRpcReporter } from '../core/default-reporter.js'
import { IpcReporterContext } from '../core/plugins/reporter-context.js'
import { defineHost, type IPluginHostCore } from '@migaia/plugin-host'
import { tagRpcError, createRpcAbortError } from '../core/errors.js'
import { RpcCoreErrorCode, type IRpcCoreErrorCode } from '../core/error-code.js'
import { resolveAbortReason } from '../core/internal/async-control.js'
import { readRpcPluginMetadata } from '../plugin/metadata.js'
import type { IRpcFeaturePluginDefinition, IRpcTransportPluginDefinition } from '../plugin/types.js'
import { prepareRuntimePeerSourceContext } from '../remote/runtime-api/peer.js'
import { compileRuntimeMethods } from '../remote/runtime-api/catalog.js'
import { readRuntimeDefaultTimeout } from '../remote/runtime-api/timeout.js'
import { HostErrorText } from './error-text.js'
import { rpcInstallationPort, type IRpcInstallationPort } from './install-port.js'
import { createRuntimeHost, type IRpcHostRuntime } from './runtime.js'
import type { IRpcHost, IRpcHostOptions } from './types.js'

/** Entry rejection preserves the native TypeError family and runs before any installation effect. */
function reject(code: IRpcCoreErrorCode, message: string): never {
  throw tagRpcError(new TypeError(message), code)
}

/** Validate synchronous admission, then let the real native Host install the exact SDK definitions. */
export function createRpcHost<TRemote = Record<never, never>>(
  options: IRpcHostOptions
): Promise<IRpcHost<TRemote>> {
  /** Metadata identity comes from the final native objects, never declared discriminator fields. */
  const metadata = options.plugins.map((plugin) => readRpcPluginMetadata(plugin))
  if (metadata.some((entry) => entry === undefined))
    reject(RpcCoreErrorCode.hostPluginInvalid, HostErrorText.pluginInvalid)
  /** Physical transport cardinality is admitted without touching the deployment recipe. */
  const transports = metadata.filter((entry) => entry?.kind === 'transport')
  if (transports.length === 0)
    reject(RpcCoreErrorCode.hostTransportMissing, HostErrorText.transportMissing)
  if (transports.length > 1)
    reject(RpcCoreErrorCode.hostTransportDuplicate, HostErrorText.transportDuplicate)
  /** One feature definition token may appear at most once, regardless of configured instance. */
  const identities = new Set<object>()
  /** Contributions are read only after every exact plugin identity has passed admission. */
  const features: IRpcFeaturePluginDefinition[] = []
  for (const entry of metadata)
    if (entry?.kind === 'feature') {
      if (identities.has(entry.identity))
        reject(RpcCoreErrorCode.hostFeatureDuplicate, HostErrorText.featureDuplicate)
      identities.add(entry.identity)
      features.push(entry.definition)
    }
  if (features.filter((feature) => feature.assemble).length > 1)
    reject(RpcCoreErrorCode.hostAssemblerDuplicate, HostErrorText.assemblerDuplicate)
  if (options.signal?.aborted)
    throw createRpcAbortError(undefined, undefined, resolveAbortReason(options.signal))
  /** Safe identity/default/catalog validation cannot consume a source or invoke a feature sink. */
  const preparedSelf = prepareRuntimePeerSourceContext(options.self).self
  /** Independently created hosts have distinct default names using their already generated identity. */
  const self =
    options.self === undefined
      ? { name: preparedSelf.instanceId, instanceId: preparedSelf.instanceId }
      : preparedSelf
  readRuntimeDefaultTimeout(options)
  compileRuntimeMethods(options.provide, options.contract)
  /** Only the exact one transport definition reaches the genuine native install hook. */
  const definition = transports[0]!.definition as IRpcTransportPluginDefinition
  return openHost(
    { ...options, self },
    definition,
    features,
    options.self === undefined
  ) as unknown as Promise<IRpcHost<TRemote>>
}

/** Construct a native domain Host whose public RPC methods borrow its one runtime endpoint. */
async function openHost(
  options: IRpcHostOptions,
  definition: IRpcTransportPluginDefinition,
  features: readonly IRpcFeaturePluginDefinition[],
  selfDefaulted: boolean
): Promise<IRpcHost<unknown>> {
  /** The transport hook alone fills this actual runtime once native installation is underway. */
  const runtime: IRpcHostRuntime = createRuntimeHost(
    options,
    definition,
    features,
    undefined,
    undefined,
    selfDefaulted,
    () => owner as unknown as IRpcHost<unknown>
  )
  /** Preserve the original transport/assembler failure above native install's diagnostic wrapper. */
  let primary: unknown
  /** A thrown undefined is still a failure and must not become successful construction. */
  let failed = false
  /**
   * Pre-transport feature setup waits only for the runtime object, with native cleanup already
   * owned.
   */
  /** Public close preserves one Promise identity while delegating native Host disposal. */
  let closing: Promise<void> | undefined
  /** Both disposal spellings borrow the exact same original close function and Promise. */
  const close = () =>
    (closing ??= owner.dispose().then(
      (result) => {
        if (result.cleanupErrors.length)
          throw translateEndpointDisposalError(
            new AggregateError(result.cleanupErrors, HostErrorText.cleanupFailed)
          )
        /** Pending installation rollback may already have removed the same runtime receipt. */
        return runtime.close().catch((error: unknown) => {
          throw translateEndpointDisposalError(error)
        })
      },
      (error) => {
        throw translateEndpointDisposalError(error)
      }
    ))
  /** One domain-owned surface is installed on the same frozen native Host handle. */
  const surface = {
    get self() {
      return runtime.host.self
    },
    peers: runtime.host.peers,
    provide: (...args: Parameters<IRpcHost['provide']>) => runtime.host.provide(...args),
    request: (...args: Parameters<IRpcHost['request']>) => runtime.host.request(...args),
    notify: (...args: Parameters<IRpcHost['notify']>) => runtime.host.notify(...args),
    stream: (...args: Parameters<IRpcHost['stream']>) => runtime.host.stream(...args),
    group: (...args: Parameters<IRpcHost['group']>) => runtime.host.group(...args),
    outcome: (...args: Parameters<IRpcHost['outcome']>) => runtime.host.outcome(...args),
    send: (...args: Parameters<IRpcHost['send']>) => runtime.host.send(...args),
    dispatch: (...args: Parameters<IRpcHost['dispatch']>) => runtime.host.dispatch(...args),
    describe: ((...args: Parameters<IRpcHost['describe']>) =>
      runtime.host.describe(...args)) as IRpcHost['describe'],
    on: (...args: Parameters<IRpcHost['on']>) => runtime.host.on(...args),
    close,
    [Symbol.asyncDispose]: close
  }
  /** Genuine cores receive a private lightweight port, so SDK hooks remain native hooks. */
  const port: IRpcInstallationPort = {
    async transport(core, transport) {
      if (transport !== definition)
        reject(RpcCoreErrorCode.hostPluginInvalid, HostErrorText.pluginInvalid)
      core.onDispose(() => runtime.close())
      try {
        await runtime.start(core.operation.signal)
      } catch (error) {
        primary = error
        failed = true
        throw error
      }
      return {}
    },
    feature(core: IPluginHostCore, feature) {
      const setup = async (): Promise<void> => {
        if (feature.setup)
          await feature.setup({
            ...runtime.featureContext((cleanup) => core.onDispose(cleanup)),
            host: owner as unknown as IRpcHost<unknown>
          })
      }
      return setup()
    }
  }
  /** Canonical plugin-host execution owns installation, reverse rollback and one terminal lifetime. */
  const owner = defineHost({
    host: {
      identity: { name: options.self!.name },
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    },
    surface,
    domainCore: () => ({ [rpcInstallationPort]: port })
  })
  try {
    await owner.use(...options.plugins)
    return owner as unknown as IRpcHost<unknown>
  } catch (error) {
    try {
      const result = await owner.dispose()
      if (result.cleanupErrors.length)
        throw translateEndpointDisposalError(
          new AggregateError(result.cleanupErrors, HostErrorText.cleanupFailed)
        )
    } catch (cleanup) {
      try {
        ;(options.report ?? defaultRpcReporter)(cleanup)
      } catch (failure) {
        hostRethrowReporter(failure, IpcReporterContext)
      }
    }
    throw failed ? primary : error
  }
}
