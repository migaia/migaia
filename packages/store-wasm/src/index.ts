// Aggregates namespace-style usage: `import * as wasm from '@migaia/store-wasm'`, then `wasm.number()` or `wasm.array(...)`.
export { number } from './number.js'
export { boolean } from './boolean.js'
export { string } from './string.js'
export { array } from './array.js'
export { record } from './record.js'
/**
 * Integrates with `StoreProvider` `config.ready`. Pass `ready: [ensureWasm]` when `features.wasm`
 * is enabled.
 */
export { ensureWasm } from './arena.js'

export {
  createStoreWasmError,
  createStoreWasmRangeError,
  createStoreWasmTypeError,
  createStoreWasmAggregateError,
  StoreWasmErrorCode,
  STORE_WASM_SOURCE,
  type IStoreWasmErrorCode
} from './errors.js'
export { WasmReservedKey, type IWasmReservedKey } from './field-constants.js'
