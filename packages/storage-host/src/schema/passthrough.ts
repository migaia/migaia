import { EntityAdapterName } from '../adapter-constants.js'
import type { ISchemaAdapter } from './types.js'

/** Returns values without validation or dependencies. Used by default when no schema is supplied. */
export const passthrough = <T = unknown>(): ISchemaAdapter<T, T> => ({
  name: EntityAdapterName.passthrough,
  validate: async (value) => value as T
})
