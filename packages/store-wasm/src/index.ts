// 命名空间式聚合：import * as wasm from '@migaia/store-wasm'; wasm.number() / wasm.array(...)
export { number } from './number.js';
export { boolean } from './boolean.js';
export { string } from './string.js';
export { array } from './array.js';
export { record } from './record.js';
/** 与 StoreProvider config.ready 配合：features.wasm 时传入 ready: [ensureWasm] */
export { ensureWasm } from './arena.js';

export * from './errors.js';
export {
  WasmFieldMode,
  WasmReservedKey,
  type IWasmFieldMode,
  type IWasmReservedKey
} from './field-constants.js';
