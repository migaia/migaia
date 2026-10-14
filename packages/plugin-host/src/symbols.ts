/**
 * Disposal symbols for resource contracts (R-7).
 *
 * The declared `unique symbol` supplies the type-level disposal key. Runtime capability detection
 * reads host `Symbol.dispose` and `Symbol.asyncDispose` and recognizes them alongside the declared
 * keys. Plugins can use either package-exported symbols or host-global symbols.
 */
export const disposeKey: unique symbol = Symbol('plugin-host.dispose')
export const asyncDisposeKey: typeof Symbol.asyncDispose =
  (Symbol as { asyncDispose?: typeof Symbol.asyncDispose }).asyncDispose ??
  (Symbol('plugin-host.asyncDispose') as typeof Symbol.asyncDispose)

/** 宿主真实的 dispose/asyncDispose symbol（可能 undefined）。 */
const hostDispose = (Symbol as { dispose?: symbol }).dispose
const hostAsyncDispose = (Symbol as { asyncDispose?: symbol }).asyncDispose

/**
 * Equivalent synchronous disposal keys, including the package declaration and available host
 * symbol, for runtime detection.
 */
export const disposeKeys: readonly symbol[] = [disposeKey, hostDispose].filter(
  (key): key is symbol => key !== undefined
)
/**
 * Equivalent asynchronous disposal keys, including the package declaration and available host
 * symbol, for runtime detection.
 */
export const asyncDisposeKeys: readonly symbol[] = [asyncDisposeKey, hostAsyncDispose].filter(
  (key): key is symbol => key !== undefined
)
