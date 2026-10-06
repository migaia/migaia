import { normalizePortable } from '../contract/normalize.js'
import type { IRpcContext } from '../core/typing.js'
import { RemoteMethodMode, type IRemoteContract } from './contract.js'
import { RpcRemoteLayerErrorCode } from './error-code.js'
import { createRemoteLayerError } from './error.js'
import type { IRemoteServeEndpoint } from './types.js'
import { RemoteMethodName } from './constants.js'
import {
  normalizeRuntimeDescription,
  type IRuntimePeerDescription,
  type IRuntimePeerIdentity
} from './runtime-api/description.js'
import { RuntimeApiMode } from './runtime-api/constants.js'
import { runtimeModeForDeclaration } from './runtime-api/catalog.js'

/**
 * The advanced declaration still supplies the installed legacy facade providers until C7 removes
 * those APIs. Its wire directory uses the same v2 baseline as every Runtime Peer.
 */
export function describeRemoteMethods(
  contracts: readonly IRemoteContract[],
  self: IRuntimePeerIdentity,
  host = false
): IRuntimePeerDescription {
  /** Only routes actually registered below enter the directory; no v1 description travels. */
  const methods = contracts.flatMap((contract) =>
    Object.entries(contract.features).flatMap(([featureName, feature]) =>
      Object.entries(feature.methods).map(([methodName, declaration]) => ({
        name: `${contract.plugin}.${featureName}.${methodName}`,
        supportedModes: [runtimeModeForDeclaration(declaration.mode)],
        modeSource: 'declared' as const,
        idempotent: declaration.idempotent
      }))
    )
  )
  if (host)
    for (const name of [
      RemoteMethodName.hostUse,
      RemoteMethodName.hostUnUse,
      RemoteMethodName.hostInspect
    ])
      methods.push({
        name,
        supportedModes: [RuntimeApiMode.request],
        modeSource: 'declared',
        idempotent: false
      })
  return normalizeRuntimeDescription({ schemaVersion: 2, self, methods })
}

/** Stream capability is required if any declared method opens a stream. */
export function contractRequiresStream(contract: IRemoteContract): boolean {
  return Object.values(contract.features).some((feature) =>
    Object.values(feature.methods).some(
      (method) =>
        method.mode === RemoteMethodMode.generator ||
        method.mode === RemoteMethodMode.asyncGenerator
    )
  )
}

/** Resolves one installed Feature output without calling disabled or absent targets. */
function selectedMethod(
  feature: Record<string, unknown> | undefined,
  methodName: string,
  disabled: boolean
): (...args: unknown[]) => unknown {
  if (disabled) throw createRemoteLayerError(RpcRemoteLayerErrorCode.closed)
  const method = feature?.[methodName]
  if (typeof method !== 'function') throw createRemoteLayerError(RpcRemoteLayerErrorCode.closed)
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

/** Registers the same business method forwarding for Plugin and Host serving. */
export function registerRemoteMethods(
  contract: IRemoteContract,
  endpoint: IRemoteServeEndpoint,
  getFeature: (featureName: string) => Record<string, unknown> | undefined,
  isDisabled: () => boolean,
  report: (error: unknown) => void,
  invocationContext?: (context: IRpcContext) => unknown
): readonly (() => void)[] {
  /**
   * Stream providers alone expose a release callback; core request providers share endpoint
   * ownership.
   */
  const streamReleases: (() => void)[] = []
  for (const [featureName, feature] of Object.entries(contract.features)) {
    for (const [methodName, method] of Object.entries(feature.methods)) {
      const fullName = `${contract.plugin}.${featureName}.${methodName}`
      if (
        method.mode === RemoteMethodMode.generator ||
        method.mode === RemoteMethodMode.asyncGenerator
      ) {
        streamReleases.push(
          endpoint.stream!.provide(
            `${RemoteMethodName.runtimeStreamPrefix}${fullName}`,
            (params, { context }) => {
              const selected = selectedMethod(getFeature(featureName), methodName, isDisabled())
              const args = requestParams(params)
              const invocation = invocationContext?.(context)
              return selected(...args, ...(invocationContext ? [invocation] : [])) as never
            }
          )
        )
        continue
      }
      endpoint.endpoint.provide(fullName, async (context) => {
        try {
          const selected = selectedMethod(getFeature(featureName), methodName, isDisabled())
          const args = requestParams(context.data)
          const invocation = invocationContext?.(context)
          const result = await selected(...args, ...(invocationContext ? [invocation] : []))
          if (method.mode === RemoteMethodMode.oneWay) return context.success()
          return context.success(normalizePortable(result))
        } catch (error) {
          if (method.mode === RemoteMethodMode.oneWay) {
            report(error)
            return context.success()
          }
          throw error
        }
      })
    }
  }
  return streamReleases
}
