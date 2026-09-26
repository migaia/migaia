import type { IRpcPlugin, IRpcPluginInstallResult } from '../typing.js'
import { RpcError, RpcCoreErrorCode } from '../errors.js'
import type { IRpcPluginInstallScope } from './plugin-contract.js'
import { safeRead } from './safe-value.js'

/** Current domain install input consumed by the native PluginHost batch. */
export type IRpcPluginDescriptor<TInstallation = unknown> = {
  readonly name: string
  readonly claims: IRpcPlugin['metadata']['claims']
  readonly sharedProvides?: readonly PropertyKey[]
  readonly sharedConsumes?: readonly PropertyKey[]
  readonly sharedOptionalConsumes?: readonly PropertyKey[]
  readonly install: (scope: IRpcPluginInstallScope) => TInstallation | Promise<TInstallation>
  readonly ports?: (installation: TInstallation) => Record<PropertyKey, unknown>
}

/** Freezes a fresh descriptor snapshot so each factory call has independent identity. */
export function freezePlugin<TPlugin extends IRpcPlugin>(plugin: TPlugin): TPlugin {
  return Object.freeze({ ...plugin }) as TPlugin
}

/** Validates the stable result shape returned by a native plugin body. */
export function assertPluginInstallResult(
  value: unknown
): asserts value is IRpcPluginInstallResult {
  if (!value || typeof value !== 'object')
    throw new RpcError(RpcCoreErrorCode.invalidConfig, 'plugin install result is invalid')
  const extension = safeRead<unknown>(value, 'extension')
  const ports = safeRead<unknown>(value, 'ports')
  if (!extension || typeof extension !== 'object' || !ports || typeof ports !== 'object')
    throw new RpcError(RpcCoreErrorCode.invalidConfig, 'plugin install result is invalid')
}
