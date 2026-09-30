import {
  isDefinedPlugin,
  type IDefinedPluginConstraint,
  type IHostHandle,
  type IPluginRemoval
} from '@migaia/plugin-host'
import { probeThenable, ThenableProbeKind } from '@migaia/utils/function'
import { serializeRpcError } from '../contract/error.js'
import { normalizePortable } from '../contract/normalize.js'
import type { IRpcPortableValue } from '../contract/types.js'
import { RpcCoreErrorCode, RpcError } from '../core/errors.js'
import { RemoteMethodName } from './constants.js'
import {
  normalizeRemoteControlShape,
  normalizeRemoteHostCatalog,
  type IRemoteHostCatalog
} from './contract.js'
import { RpcRemoteLayerErrorCode } from './error-code.js'
import { createRemoteLayerError } from './error.js'
import { RpcRemoteLayerErrorText } from './error-text.js'
import { contractRequiresStream, registerRemoteMethods } from './serve-methods.js'
import type { IRemoteServeEndpoint } from './types.js'

/** Only successful remote catalog operations enter this Host-scoped view. */
const installedByHost = new WeakMap<object, Set<string>>()

/** The resolver remains local and synchronous; plugin definitions never cross the wire. */
export type IRemoteHostPluginResolver = (name: string, config?: IRpcPortableValue) => unknown

/** Host ownership is limited to the public operations needed for catalog control. */
export type IRemoteServeHostOptions = Readonly<{
  host: Pick<IHostHandle<object, unknown, readonly []>, 'use' | 'unUse' | 'plugin' | 'revision'>
  catalog: IRemoteHostCatalog
  resolvePlugin: IRemoteHostPluginResolver
  endpoint: IRemoteServeEndpoint
  report(error: unknown): void
}>

/** Closing this service releases only its dedicated endpoint. */
export type IRemoteServeHostHandle = Readonly<{ close(): Promise<void> }>

/** Rejects a name outside the normalized catalog before touching resolver or Host. */
function declared(catalog: IRemoteHostCatalog, name: string): void {
  if (!Object.hasOwn(catalog, name))
    throw createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid)
}

/** Projects one registered name through the current Host revision and enablement. */
function inspectItem(
  host: IRemoteServeHostOptions['host'],
  catalog: IRemoteHostCatalog,
  name: string
): IRpcPortableValue {
  return {
    name,
    state: host.plugin.disabled().includes(name) ? 'disabled' : 'enabled',
    revision: host.revision,
    features: Object.keys(catalog[name]!.features)
  }
}

/** Exposes one Host through the reserved core control methods. */
export async function serveRemoteHost(
  options: IRemoteServeHostOptions
): Promise<IRemoteServeHostHandle> {
  const catalog = normalizeRemoteHostCatalog(options.catalog)
  if (Object.values(catalog).some(contractRequiresStream) && !options.endpoint.stream) {
    try {
      await options.endpoint.endpoint.dispose()
    } catch (cleanupError) {
      options.report(cleanupError)
    }
    throw new RpcError(
      RpcCoreErrorCode.capabilityConflict,
      RpcRemoteLayerErrorText.streamUnavailable
    )
  }
  const installed = installedByHost.get(options.host) ?? new Set<string>()
  installedByHost.set(options.host, installed)
  /** Installed Host handles expose Feature outputs after a successful use. */
  const handles = new Map<string, { getFeature(name: string): Record<string, unknown> }>()
  /** Stream providers release their registrations before endpoint disposal. */
  const streamReleases: (() => void)[] = []
  try {
    for (const contract of Object.values(catalog))
      streamReleases.push(
        ...registerRemoteMethods(
          contract,
          options.endpoint,
          (featureName) => handles.get(contract.plugin)?.getFeature(featureName),
          () => options.host.plugin.disabled().includes(contract.plugin),
          options.report
        )
      )
    options.endpoint.endpoint.provide(RemoteMethodName.describe, (context) =>
      context.success({ schemaVersion: 1, catalog })
    )
    options.endpoint.endpoint.provide(RemoteMethodName.hostUse, async (context) => {
      const params = normalizeRemoteControlShape(
        'hostUseParams',
        context.data
      ) as readonly IRpcPortableValue[]
      const name = params[0] as string
      declared(catalog, name)
      const candidate = options.resolvePlugin(name, params[1])
      const thenable = probeThenable(candidate)
      if (thenable.kind !== ThenableProbeKind.notThenable)
        throw createRemoteLayerError(
          RpcRemoteLayerErrorCode.contractInvalid,
          thenable.kind === ThenableProbeKind.failed ? thenable.error : undefined
        )
      if (!isDefinedPlugin(candidate) || candidate.name !== name)
        throw createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid)
      const [handle] = await options.host.use(candidate as IDefinedPluginConstraint)
      handles.set(name, handle as unknown as { getFeature(name: string): Record<string, unknown> })
      installed.add(name)
      return context.success(inspectItem(options.host, catalog, name))
    })
    options.endpoint.endpoint.provide(RemoteMethodName.hostUnUse, async (context) => {
      const params = normalizeRemoteControlShape(
        'hostUnUseParams',
        context.data
      ) as readonly IRpcPortableValue[]
      const name = params[0] as string
      declared(catalog, name)
      const input = (params[1] ?? {}) as {
        readonly policy?: 'reject' | 'suspend'
        readonly dryRun?: boolean
      }
      const policy = input.policy ?? 'reject'
      if (input.dryRun === true) {
        const plan = await options.host.unUse(name, { policy, dryRun: true })
        return context.success(normalizePortable({ dryRun: true, ...plan }))
      }
      const removal = (await options.host.unUse(name, { policy })) as IPluginRemoval
      handles.delete(name)
      installed.delete(name)
      if (removal.ok) return context.success({ ok: true })
      return context.success({
        ok: false,
        errors: removal.errors.map((error) =>
          serializeRpcError(error, { report: ({ error: failure }) => options.report(failure) })
        )
      })
    })
    options.endpoint.endpoint.provide(RemoteMethodName.hostInspect, (context) => {
      normalizeRemoteControlShape('hostInspectParams', context.data)
      return context.success({
        revision: options.host.revision,
        plugins: [...installed]
          .filter((name) => Object.hasOwn(catalog, name))
          .sort()
          .map((name) => inspectItem(options.host, catalog, name))
      })
    })
  } catch (error) {
    for (const release of streamReleases) release()
    try {
      await options.endpoint.endpoint.dispose()
    } catch (cleanupError) {
      options.report(cleanupError)
    }
    throw error
  }
  let closePromise: Promise<void> | undefined
  return Object.freeze({
    close: (): Promise<void> =>
      (closePromise ??= (async () => {
        for (const release of streamReleases) release()
        await options.endpoint.endpoint.dispose()
      })())
  })
}
