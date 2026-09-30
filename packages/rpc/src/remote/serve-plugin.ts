import {
  defineFeature,
  definePlugin,
  type IDefinedPluginConstraint,
  type IFeature,
  type IPluginConstraint
} from '@migaia/plugin-host'
import type { IHostHandle } from '@migaia/plugin-host'
import { normalizePortable } from '../contract/normalize.js'
import { RpcCoreErrorCode, RpcError } from '../core/errors.js'
import type { IRpcContext } from '../core/typing.js'
import { REMOTE_SERVE_PLUGIN_PREFIX, RemoteMethodName } from './constants.js'
import { normalizeRemoteContract, RemoteMethodMode, type IRemoteContract } from './contract.js'
import { RpcRemoteLayerErrorCode } from './error-code.js'
import { createRemoteLayerError } from './error.js'
import { RpcRemoteLayerErrorText } from './error-text.js'
import type { IRemoteServeEndpoint } from './types.js'

/** Service registration names are never reused, including after failed installation. */
let nextServiceSequence = 0

/** A served endpoint is exclusively owned by one returned close handle. */
export type IRemoteServePluginOptions = Readonly<{
  host: Pick<
    IHostHandle<object, unknown, readonly IPluginConstraint<any>[]>,
    'use' | 'unUse' | 'plugin'
  >
  contract: IRemoteContract
  endpoint: IRemoteServeEndpoint
  report(error: unknown): void
  invocationContext?(context: IRpcContext): unknown
}>

/** The service removes only its own Host registration before disposing its endpoint. */
export type IRemoteServePluginHandle = Readonly<{ close(): Promise<void> }>

/** Resolve a method only through the installed cross-plugin Feature output slot. */
function selectedMethod(
  slots: ReadonlyMap<string, Record<string, unknown>>,
  featureName: string,
  methodName: string,
  targetDisabled: () => boolean
): (...args: unknown[]) => unknown {
  if (targetDisabled()) throw createRemoteLayerError(RpcRemoteLayerErrorCode.closed)
  const feature = slots.get(featureName)
  const method = feature?.[methodName]
  if (typeof method !== 'function') throw createRemoteLayerError(RpcRemoteLayerErrorCode.closed)
  /** Preserve Feature output receivers for methods that read their own state. */
  return (...args) => Reflect.apply(method, feature, args)
}

/** Portable request params must be an array before any target method is invoked. */
function requestParams(value: unknown): readonly unknown[] {
  if (!Array.isArray(value))
    throw createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid, undefined, {
      path: '$.params'
    })
  return value
}

/** Serve one normalized Plugin contract through a dedicated core endpoint. */
export async function serveRemotePlugin(
  options: IRemoteServePluginOptions
): Promise<IRemoteServePluginHandle> {
  const contract = normalizeRemoteContract(options.contract)
  const hasStream = Object.values(contract.features).some((feature) =>
    Object.values(feature.methods).some(
      (method) =>
        method.mode === RemoteMethodMode.generator ||
        method.mode === RemoteMethodMode.asyncGenerator
    )
  )
  if (hasStream && !options.endpoint.stream) {
    const error = new RpcError(
      RpcCoreErrorCode.capabilityConflict,
      RpcRemoteLayerErrorText.streamUnavailable
    )
    try {
      await options.endpoint.endpoint.dispose()
    } catch (cleanupError) {
      options.report(cleanupError)
    }
    throw error
  }
  /** Trusted references are minted from a description-only definition, never installed. */
  const referenceFeatures: Record<string, IFeature<object, object>> = Object.create(null) as Record<
    string,
    IFeature<object, object>
  >
  for (const featureName of Object.keys(contract.features))
    referenceFeatures[featureName] = defineFeature(() => ({}))
  const referenceOwner = definePlugin({
    name: contract.plugin,
    features: referenceFeatures,
    install: () => ({})
  })
  /** Host dependency admission fills these slots before any provider can be reached. */
  const slots = new Map<string, Record<string, unknown>>()
  const serviceFeatures: Record<string, IFeature<object, object, any>> = Object.create(
    null
  ) as Record<string, IFeature<object, object, any>>
  for (const featureName of Object.keys(contract.features))
    serviceFeatures[featureName] = defineFeature(
      (_core, dependencies) => {
        slots.set(featureName, dependencies.target as Record<string, unknown>)
        return {}
      },
      { target: referenceOwner.getFeature(featureName) }
    )
  const serviceName = `${REMOTE_SERVE_PLUGIN_PREFIX}${contract.plugin}#${++nextServiceSequence}`
  const service = definePlugin({
    name: serviceName,
    features: serviceFeatures,
    install: (core) => {
      core.onDispose(() => slots.clear())
      return {}
    }
  })
  let installed = false
  const targetDisabled = (): boolean => options.host.plugin.disabled().includes(contract.plugin)
  const streamReleases: (() => void)[] = []
  try {
    await options.host.use(service as IDefinedPluginConstraint)
    installed = true
    options.endpoint.endpoint.provide(RemoteMethodName.describe, (context) =>
      context.success(contract)
    )
    for (const [featureName, feature] of Object.entries(contract.features)) {
      for (const [methodName, method] of Object.entries(feature.methods)) {
        const fullName = `${contract.plugin}.${featureName}.${methodName}`
        if (
          method.mode === RemoteMethodMode.generator ||
          method.mode === RemoteMethodMode.asyncGenerator
        ) {
          streamReleases.push(
            options.endpoint.stream!.provide(fullName, (params, { context }) => {
              const selected = selectedMethod(slots, featureName, methodName, targetDisabled)
              const args = requestParams(params)
              const invocation = options.invocationContext?.(context)
              return selected(...args, ...(options.invocationContext ? [invocation] : [])) as never
            })
          )
          continue
        }
        options.endpoint.endpoint.provide(fullName, async (context) => {
          try {
            const selected = selectedMethod(slots, featureName, methodName, targetDisabled)
            const args = requestParams(context.data)
            const invocation = options.invocationContext?.(context)
            const result = await selected(
              ...args,
              ...(options.invocationContext ? [invocation] : [])
            )
            if (method.mode === RemoteMethodMode.oneWay) return context.success()
            return context.success(normalizePortable(result))
          } catch (error) {
            if (method.mode === RemoteMethodMode.oneWay) {
              options.report(error)
              return context.success()
            }
            throw error
          }
        })
      }
    }
  } catch (error) {
    for (const release of streamReleases) release()
    if (installed) {
      try {
        await options.host.unUse(serviceName)
      } catch (cleanupError) {
        options.report(cleanupError)
      }
    }
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
        try {
          const removal = await options.host.unUse(serviceName)
          if ('ok' in removal && !removal.ok)
            for (const error of removal.errors) options.report(error)
        } finally {
          for (const release of streamReleases) release()
          await options.endpoint.endpoint.dispose()
        }
      })())
  })
}
