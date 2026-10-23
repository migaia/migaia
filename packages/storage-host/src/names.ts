import { STORAGE_PLUGIN_NAME_PREFIX } from './state-constants.js'
/** Encode one already validated ASCII id without changing the public backend lookup identity. */
export function pluginNameFromBackendId(id: string): string {
  return (
    STORAGE_PLUGIN_NAME_PREFIX +
    Array.from(id, (character) =>
      character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')
    ).join('')
  )
}
