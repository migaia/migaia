import ERROR_TEXT, { PluginHostError, createPluginHostTypeError } from './error-text.js'
import { asyncDisposeKey, disposeKey } from './disposal.js'
import { PluginHostErrorCode } from './error-code.js'
import type { IPluginHostErrorCode } from './typing.js'

/** Object prototype names can never become plugin-host extension surface. */
const objectPrototypeKeys = new Set(Reflect.ownKeys(Object.prototype))
/** Host protocol names cannot be claimed by an extension view. */
const hostReservedKeys = new Set<PropertyKey>([
  'config',
  'pipelineMode',
  'getShared',
  'usePipeline',
  'useAsyncPipeline',
  'useGeneratorPipeline',
  'useAsyncGeneratorPipeline',
  'use',
  'unUse',
  'dispose',
  'plugin',
  'identity',
  'host',
  'extensions'
])

export type IExtensionRegistration = {
  readonly name: string
  readonly extensions: Array<{ readonly key: PropertyKey; readonly descriptor: PropertyDescriptor }>
}

/** Validate extension container before Host-specific descriptor mounting. */
export const assertExtensionResult = (extension: unknown, pluginName: string): object => {
  if (extension === null || typeof extension !== 'object' || Array.isArray(extension))
    throw createPluginHostTypeError('plugin install() must return an object')
  const prototype = Object.getPrototypeOf(extension)
  if (prototype !== Object.prototype && prototype !== null)
    throw createPluginHostTypeError('plugin install() must return a plain object')
  for (const key of Reflect.ownKeys(extension)) {
    if (
      (asyncDisposeKey !== undefined && key === asyncDisposeKey) ||
      (disposeKey !== undefined && key === disposeKey)
    )
      throw new PluginHostError(
        PluginHostErrorCode.extensionReserved,
        ERROR_TEXT.EXTENSION_RESERVED(pluginName, key)
      )
  }
  return extension
}

/** Validates and publishes enumerable extension descriptors into one candidate owner registry. */
export const mountPluginExtensions = <TRegistration extends IExtensionRegistration>(
  registration: TRegistration,
  extension: unknown,
  extensionOwners: Map<PropertyKey, TRegistration>,
  diagnostic: (message: string, code?: IPluginHostErrorCode) => void
): void => {
  const extensionObject = assertExtensionResult(extension, registration.name)
  for (const key of Reflect.ownKeys(extensionObject)) {
    const descriptor = Object.getOwnPropertyDescriptor(extensionObject, key)
    if (!descriptor?.enumerable) {
      try {
        diagnostic(
          ERROR_TEXT.EXTENSION_NON_ENUMERABLE_IGNORED(registration.name, key),
          PluginHostErrorCode.extensionNonEnumerableIgnored
        )
      } catch {
        // Diagnostics must never alter extension publication.
      }
      continue
    }
    if (objectPrototypeKeys.has(key))
      throw new PluginHostError(
        PluginHostErrorCode.extensionObjectPrototype,
        ERROR_TEXT.EXTENSION_OBJECT_PROTOTYPE(registration.name, key)
      )
    if (hostReservedKeys.has(key))
      throw new PluginHostError(
        PluginHostErrorCode.extensionReserved,
        ERROR_TEXT.EXTENSION_RESERVED(registration.name, key)
      )
    if (extensionOwners.has(key))
      throw new PluginHostError(
        PluginHostErrorCode.extensionDuplicate,
        ERROR_TEXT.EXTENSION_DUPLICATE(registration.name, key)
      )
    if ('get' in descriptor || 'set' in descriptor || descriptor.configurable === false)
      throw createPluginHostTypeError('extension property must be a configurable data property')
    registration.extensions.push({ key, descriptor })
    extensionOwners.set(key, registration)
  }
}
