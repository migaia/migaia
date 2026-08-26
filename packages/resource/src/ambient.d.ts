/**
 * `@migaia/resource` 用 `DOMException`（`name === 'AbortError'`）作为取消/中止错误，让调用方能 `instanceof
 * DOMException` 分支（`docs/contracts/error-codes.md` §2：DOMException/AbortError 保持运行时类型）。
 *
 * 本包生产 tsconfig `lib:["ES2024"]` 不声明 `DOMException`（它在 DOM lib 与 @types/node 里），这里只声明用到的最小形状，不
 * import DOM/Node。 测试 tsconfig 单独 `types:["node"]` 并排除本文件，避免与 @types/node 的 DOMException 全局重复声明。
 */
declare class DOMException extends Error {
  constructor(message?: string, name?: string)
}
