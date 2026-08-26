/**
 * `@migaia/lifecycle` 是零依赖、runtime-neutral 的 leaf（`docs/lifecycle/lifecycle-extraction.sdd.md`
 * §1.1），既不 import DOM 的 `lib.dom.d.ts` 也不 import `@types/node`。
 *
 * `setTimeout`/`clearTimeout` 是宿主（browser/Node/Deno/Bun/worker）都提供、但不在裸 ES lib 里的
 * 全局，这里只声明本包用到的最小结构形状（返回 `unknown`，用 `unref` 时按鸭子类型 cast），不是 DOM/Node `lib.d.ts` 的完整重实现。
 */
declare global {
  function setTimeout(callback: () => void, delayMs?: number): unknown
  function clearTimeout(handle: unknown): void
}

export {}
