import { createRuntime, type Runtime } from './runtime.class';

/**
 * 默认共享运行时——全局 `signal()` / `createStore()` 这类不显式传 runtime 的写法 都落在它上面，保持「开箱即用」的心智；需要隔离时显式
 * `createRuntime()`。
 *
 * 它单独占一个模块，是因为**构造它是模块加载时就发生的副作用**。此前它住在 `runtime.class.ts` 里，于是 `@migaia/reactive` 只要 import 一次
 * Runtime 类，就顺手 建了一个谁也没要的 Runtime：与「每请求一个 Runtime」的所有权模型冲突，也树摇 不掉（`createRuntime()`
 * 是调用，打包器不能证明它无副作用）。
 *
 * 分出来之后边界是可执行的：`architecture.test.ts` 断言内核入口的传递闭包里没有 这个模块。想要便利写法就显式 import 它（或
 * `defaultRuntime`），代价随之显式。
 */
export const defaultRuntime: Runtime = createRuntime();
