/**
 * 自声明 `Symbol.dispose`/`Symbol.asyncDispose` 的结构类型（R-7：不依赖 `ESNext.Disposable` lib）。
 *
 * 类型层用自声明 `unique symbol` 表达 disposable 形状；运行时读宿主真实的 `Symbol.dispose`/`Symbol.asyncDispose` （结构化
 * capability detection），并把自声明 symbol 也作为等价键一并识别——兼容只用 plugin-host 导出 symbol 的插件， 也兼容用宿主全局 symbol
 * 的既有插件。
 */
export const disposeKey: unique symbol = Symbol('plugin-host.dispose')
export const asyncDisposeKey: unique symbol = Symbol('plugin-host.asyncDispose')

/** 宿主真实的 dispose/asyncDispose symbol（可能 undefined）。 */
const hostDispose = (Symbol as { dispose?: symbol }).dispose
const hostAsyncDispose = (Symbol as { asyncDispose?: symbol }).asyncDispose

/** 所有等价的 dispose 键（自声明 + 宿主真实），运行时检测用。 */
export const disposeKeys: readonly symbol[] = [disposeKey, hostDispose].filter(
  (key): key is symbol => key !== undefined
)
/** 所有等价的 asyncDispose 键（自声明 + 宿主真实），运行时检测用。 */
export const asyncDisposeKeys: readonly symbol[] = [asyncDisposeKey, hostAsyncDispose].filter(
  (key): key is symbol => key !== undefined
)
