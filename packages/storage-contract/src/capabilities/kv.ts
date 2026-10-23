import type { IKeyValueApi } from '../capability.js'
import {
  STORAGE_KEY_VALUE_METHODS,
  SYNC_KEY_VALUE_METHODS,
  TRANSACTION_KEY_VALUE_METHODS
} from '../capability-constants.js'
import { defineStandardStorageCapability, invalidCapability } from '../capability-token.js'

/** Standard KV validates all native methods before either root or Feature publication. */
function validateKeyValue(value: unknown): void {
  /** Preserve the original property access and short-circuit order, including optional sync. */
  const api = value as Record<string, unknown> | undefined
  if (
    !api ||
    typeof api !== 'object' ||
    STORAGE_KEY_VALUE_METHODS.some((name) => typeof api[name] !== 'function')
  )
    throw invalidCapability()
  if (
    api.sync !== undefined &&
    (typeof api.sync !== 'object' ||
      api.sync === null ||
      SYNC_KEY_VALUE_METHODS.some(
        (name) => typeof (api.sync as Record<string, unknown>)[name] !== 'function'
      ))
  )
    throw invalidCapability()
}

/** Standard text KV uses its original shape, flat projection and finite transaction method list. */
export const kv = /* @__PURE__ */ defineStandardStorageCapability<IKeyValueApi, 'kv'>('kv', {
  validate: validateKeyValue,
  flatKeyValue: true,
  transaction: { methods: TRANSACTION_KEY_VALUE_METHODS }
})
