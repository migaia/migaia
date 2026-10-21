/**
 * `@migaia/wasm` 目前不产生自有语义错误 —— 它只做 WASM 模块加载与原始分配转发，
 * 失败由 `WebAssembly` 原生错误直接冒泡给调用方，这是本包声明的原生透传策略。
 * `store-wasm` 原样重抛并只对后续状态编码。
 * 保留本文件作为本包错误码的单点声明，
 * 防止后来者在抛出点内联字面量码。新增错误时在此登记，不要就地 throw new Error。
 */
export const WasmErrorCode = {} as const;

export type IWasmErrorCode = (typeof WasmErrorCode)[keyof typeof WasmErrorCode];
