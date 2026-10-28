/**
 * Owns direct host clocks and microtask scheduling; graph algorithms consume admitted adapter
 * ports.
 */
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
  /** Defers one admitted task through the host microtask queue without introducing another turn. */
  scheduleMicrotask(task) {
    queueMicrotask(task)
  },
  /** Supplies monotonic duration measurements while retaining host capability failure behavior. */
  now() {
    // ambient.d.ts 把 performance 声明为可选；默认 adapter 假设具备单调时钟宿主，缺失时 fail-fast。
    return performance!.now()
  },
  /** Supplies epoch event time independently of monotonic trace duration measurements. */
  timestamp() {
    return Date.now()
  },
  /** Default reporting deliberately performs no host I/O; callers may inject an observable channel. */
  reportError() {
    // 默认 no-op：调用方不注入 onError 时不产生任何宿主副作用。
  }
}
