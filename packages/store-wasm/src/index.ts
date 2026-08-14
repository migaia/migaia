// 命名空间式聚合：import * as wasm from '@migaia/store-wasm'; wasm.number() / wasm.array(...)
export { number } from './number';
export { boolean } from './boolean';
export { string } from './string';
export { array } from './array';
export { record } from './record';
/** 与 StoreProvider config.ready 配合：features.wasm 时传入 ready: [ensureWasm] */
export { ensureWasm } from './arena';
