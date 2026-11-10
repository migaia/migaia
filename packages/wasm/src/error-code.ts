/**
 * Error codes owned by `@migaia/wasm`. WebAssembly's own `CompileError`, `LinkError` and
 * `RuntimeError` are the declared native pass-through and carry no code. Any other failure that
 * crosses this package boundary is declared here first.
 */
/** Registered error domain for `@migaia/wasm`. */
export const ERROR_SOURCE = 'foundation.wasm'

/** Semantic codes emitted by the generated initialization glue. */
export const WasmErrorCode = {
  /**
   * Asynchronous initialization could not fetch the module from a URL or Request (network failure,
   * blocked or unsupported scheme). The rejection is a `TypeError` whose `cause` is the original
   * fetch failure. Supply module bytes or a compiled `WebAssembly.Module` instead, or fix the URL.
   */
  moduleLoadFailed: 'MODULE_LOAD_FAILED'
} as const

/** Union of the declared wasm error codes. */
export type IWasmErrorCode = (typeof WasmErrorCode)[keyof typeof WasmErrorCode]

/** Stable message for a failed module fetch; its consumer is the generated initialization glue. */
export const WasmErrorText = {
  moduleLoadFailed: 'wasm module fetch failed'
} as const
