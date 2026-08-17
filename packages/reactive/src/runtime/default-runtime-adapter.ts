import type { IReactiveRuntimeAdapter } from './types.js';

/**
 * 默认 runtime adapter：唯一的宿主 API 边界（`docs/contracts/runtime-neutrality.sdd.md` R-9）。
 *
 * 核心算法模块不得直接引用 `queueMicrotask`/`performance`/`Date`/`console`；这些访问全部收敛到这里。 构造 `createRuntime({
 * adapter })` 可完整替换；默认诊断 `reportError` 是 no-op，不直接 `console.error`。
 */
export const defaultRuntimeAdapter: IReactiveRuntimeAdapter = {
  scheduleMicrotask(task) {
    queueMicrotask(task);
  },
  now() {
    // ambient.d.ts 把 performance 声明为可选；默认 adapter 假设具备单调时钟宿主，缺失时 fail-fast。
    return performance!.now();
  },
  timestamp() {
    return Date.now();
  },
  reportError() {
    // 默认 no-op：调用方不注入 onError 时不产生任何宿主副作用。
  }
};
