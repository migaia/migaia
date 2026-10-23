import { PluginHostError, PluginHostErrorCode, ERROR_TEXT } from '@migaia/plugin-host'
import type {
  ICapabilityImpl,
  ICapabilityInstallPort,
  IStorageBase
} from '@migaia/storage-contract'
import { createStorageTypeError, StorageErrorCode } from './errors.js'
import { StorageErrorText } from './error-text.js'
import type { IStorageExecutionPort, IStorageFeatureOutput } from './types.js'
/** A closed output-shape failure stays at the existing backend definition boundary. */
function invalid(): never {
  throw createStorageTypeError(
    StorageErrorCode.backendPluginInvalid,
    StorageErrorText.backendPluginInvalid
  )
}
/** Reuse PluginHost's duplicate-registration semantics for published method collisions. */
function duplicate(name: string, key: PropertyKey): never {
  throw new PluginHostError(
    PluginHostErrorCode.extensionDuplicate,
    ERROR_TEXT.EXTENSION_DUPLICATE(name, key)
  )
}
/** Snapshot own data once; methods are rebound only at their actual execution endpoint. */
function entries(value: unknown): readonly (readonly [string, unknown])[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid()
  return Reflect.ownKeys(value).map((key) => {
    /** Retain one own data snapshot without executing a caller accessor. */
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (
      typeof key !== 'string' ||
      descriptor === undefined ||
      !('value' in descriptor) ||
      !descriptor.enumerable
    )
      return invalid()
    return [key, descriptor.value] as const
  })
}
/**
 * Prepare selected roots only; dependencies remain raw construction outputs until explicitly
 * copied.
 */
export function installStorageFeatures(input: {
  readonly name: string
  readonly store: IStorageBase
  readonly features: Readonly<Record<string, object>>
  readonly installer?: ICapabilityInstallPort
  readonly execution: IStorageExecutionPort
  readonly expose: Readonly<Record<string, Function>>
  readonly onDispose: (release: () => void) => void
}): void {
  /** Publish selected root outputs without implicitly publishing dependencies. */
  const roots = Object.values(input.features)
  if (roots.length === 0) return
  /** One local publication batch belongs to the original store capability provider. */
  const implementations: ICapabilityImpl[] = []
  /** API names are scoped to this one backend instance and this install lifetime. */
  const storeApi = Object.create(null) as Record<string, unknown>
  for (const root of roots) {
    /** Reject unknown Feature output fields before installing capabilities. */
    const outputEntries = entries(root)
    if (
      outputEntries.length !== 3 ||
      outputEntries.some(([key]) => key !== 'capabilities' && key !== 'chain' && key !== 'api')
    )
      invalid()
    /** Consume only this admitted three-field root output. */
    const output = root as IStorageFeatureOutput
    if (!Array.isArray(output.capabilities)) invalid()
    implementations.push(...output.capabilities)
    /** Keep store and transaction API namespaces distinct during admission. */
    const groups = entries(output.api)
    if (groups.length !== 2 || groups.some(([key]) => key !== 'store' && key !== 'transaction'))
      invalid()
    for (const [key, value] of entries(output.api.store)) {
      if (Object.hasOwn(storeApi, key)) duplicate(input.name, key)
      storeApi[key] = bindApi(value, key)
    }
    // Reject groups that cannot be attached to a real scope or fluent owner.
    if (entries(output.api.transaction).length !== 0 || entries(output.chain).length !== 0)
      invalid()
  }
  if (implementations.length !== 0) {
    if (input.installer === undefined) invalid()
    /** The original provider owns capability preparation, visibility and release. */
    const publication = input.installer.prepare(implementations)
    input.onDispose(publication.release)
    publication.publish()
  }
  if ('api' in input.store) duplicate(input.name, 'api')
  Object.defineProperty(input.store, 'api', {
    value: Object.freeze(storeApi),
    enumerable: true,
    configurable: true
  })

  /** Every nested API leaf performs canonical registration admission before touching a client. */
  function bindApi(value: unknown, path: string): unknown {
    if (typeof value === 'function')
      return (...args: unknown[]) =>
        input.execution.run({ operation: path, input: args }, (captured) => {
          /** Use the original admitted backend object instead of creating a replacement. */
          const store = input.expose.getStore!()
          /** Fetch the lazy native client only at its actual execution endpoint. */
          const client = input.expose.getClient?.()
          return Reflect.apply(value, { store, client, scope: undefined }, captured)
        })
    /** Freeze a nested API group while its leaves retain registration guards. */
    const group = Object.create(null) as Record<string, unknown>
    for (const [key, member] of entries(value)) group[key] = bindApi(member, `${path}.${key}`)
    return Object.freeze(group)
  }
}
