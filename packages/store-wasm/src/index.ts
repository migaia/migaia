// Aggregates namespace-style usage: `import * as wasm from '@migaia/store-wasm'`, then `wasm.number()` or `wasm.array(...)`.
export { number } from './number.ts'
export { boolean } from './boolean.ts'
export { string } from './string.ts'
export { array } from './array.ts'
export { record } from './record.ts'
/**
 * Integrates with `StoreProvider` `config.ready`. Pass `ready: [ensureWasm]` when `features.wasm`
 * is enabled.
 */
export { ensureWasm } from './arena.ts'

export {
  createStoreWasmError,
  createStoreWasmRangeError,
  createStoreWasmTypeError,
  createStoreWasmAggregateError,
  StoreWasmErrorCode,
  STORE_WASM_SOURCE,
  type IStoreWasmErrorCode
} from './errors.ts'
export { WasmReservedKey, type IWasmReservedKey } from './field-constants.ts'
