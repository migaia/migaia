import type { IReactiveRuntimeAdapter } from './types.ts'

/**
 * Default runtime adapter and the sole host API boundary .
 *
 * Core algorithms do not access `queueMicrotask`, `performance`, `Date`, or `console` directly.
 * This adapter owns those host accesses. Pass `createRuntime({ adapter })` to replace its
 * capabilities. The default diagnostic `reportError` is a no-op and never calls `console.error`
 * directly.
 */
export const defaultRuntimeAdapter: IReactiveRuntimeAdapter = {
  scheduleMicrotask(task) {
    queueMicrotask(task)
  },
  now() {
    // ambient.d.ts 把 performance 声明为可选；默认 adapter 假设具备单调时钟宿主，缺失时 fail-fast。
    return performance!.now()
  },
  timestamp() {
    return Date.now()
  },
  reportError() {
    // 默认 no-op：调用方不注入 onError 时不产生任何宿主副作用。
  }
}
