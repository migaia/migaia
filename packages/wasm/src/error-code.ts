/**
 * `@migaia/wasm` 目前不抛出任何错误 —— 它只做 WASM 模块加载与原始分配转发，
 * 失败由 `WebAssembly` 原生错误直接冒泡给调用方（`store-wasm` 负责归类）。
 * 保留本文件是为了满足 `docs/contracts/error-codes.md` §3.5 的单点声明要求，
 * 防止后来者在抛出点内联字面量码。新增错误时在此登记，不要就地 throw new Error。
 */
export const WasmErrorCode = {} as const;

export type IWasmErrorCode = (typeof WasmErrorCode)[keyof typeof WasmErrorCode];
