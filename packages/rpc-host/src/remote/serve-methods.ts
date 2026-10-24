import { RemoteMethodMode, type IRemoteContract } from './contract.js'
import { RemoteMethodName } from './constants.js'
import {
  normalizeRuntimeDescription,
  type IRuntimePeerDescription,
  type IRuntimePeerIdentity
} from './runtime-api/description.js'
import { RuntimeApiMode } from './runtime-api/constants.js'
import { runtimeModeForDeclaration } from './runtime-api/catalog.js'

/**
 * Independent foreign peers retain their declared three-segment wire names. Their directory uses
 * the same v2 baseline and mode mapping as the actual runtime provider compiler.
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
