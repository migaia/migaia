/**
 * Disposal symbols for resource contracts (R-7).
 *
 * Synchronous resources use the native Symbol.dispose or a callback. Async callers may use the
 * exported asyncDisposeKey when the host lacks a native symbol. Admission and extension validation
 * share these captured key lists instead of introducing another synchronous symbol.
 */
export const asyncDisposeKey: typeof Symbol.asyncDispose =
  (Symbol as { asyncDispose?: typeof Symbol.asyncDispose }).asyncDispose ??
  (Symbol('plugin-host.asyncDispose') as typeof Symbol.asyncDispose)

/** 宿主真实的 dispose/asyncDispose symbol（可能 undefined）。 */
const hostDispose = (Symbol as { dispose?: symbol }).dispose
const hostAsyncDispose = (Symbol as { asyncDispose?: symbol }).asyncDispose

/** Supported synchronous disposal key, empty when the host requires a cleanup callback instead. */
export const disposeKeys: readonly symbol[] = hostDispose === undefined ? [] : [hostDispose]
/**
 * Equivalent asynchronous disposal keys, including the package declaration and available host
 * symbol, for runtime detection.
 */
export const asyncDisposeKeys: readonly symbol[] = [asyncDisposeKey, hostAsyncDispose].filter(
  (key): key is symbol => key !== undefined
)
