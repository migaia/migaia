/**
 * `@migaia/reactive` 生产 tsconfig `lib:["ES2024"]` 不声明 `console`/`performance`/`queueMicrotask`（它们在
 * DOM lib 与 @types/node 里），这里只声明用到的最小形状，不 import DOM/Node。 测试 tsconfig 单独 `types:["node"]`
 * 并排除本文件，避免与 @types/node 的全局重复声明。
 */
export {}

declare global {
  var console: { error(...data: unknown[]): void }
  var performance: { now(): number } | undefined
  var queueMicrotask: (callback: () => void) => void
}
