/**
 * 结构化取消信号，取代 DOM/Node 的 `AbortSignal`/`AbortController`。
 *
 * 本包是零依赖、runtime-neutral 的 leaf（`docs/lifecycle/lifecycle-extraction.sdd.md` §1.1）， 不能 import DOM 的
 * `lib.dom.d.ts` 或 `@types/node`。这里只声明本包实际用到的最小形状——
 * `aborted`/`reason`/`addEventListener`/`removeEventListener`（外加对应 controller 的
 * `abort(reason?)`），刻意做成鸭子类型：DOM 与 Node 的真实 `AbortSignal` 都能**结构性地满足** 这个接口（它们多出的
 * `onabort`/`dispatchEvent`/`throwIfAborted`/`any` 等字段不影响赋值），所以 调用方既不用 import 任何运行时类型库，也能把真实的
 * `AbortSignal` 传进来当 `parentSignal`。
 *
 * 有意**不含** `onabort`/`dispatchEvent`/`throwIfAborted` 等 DOM 独有字段——一旦声明它们，这个 接口又会被绑回 DOM 形状，破坏中立性。
 */

import { LifecycleErrorCode } from './error-code.js'
import { LifecycleErrorText } from './error-text.js'
import { createLifecycleFailure, tagLifecycleError } from './errors.js'

/** 结构化取消信号。`reason` 可选，对齐 WHATWG/Node 语义：`abort()` 不带参时为 `undefined`。 */
export type IAbortSignal = {
  readonly aborted: boolean
  readonly reason?: unknown
  addEventListener(type: 'abort', listener: () => void, options?: { readonly once?: boolean }): void
  removeEventListener(type: 'abort', listener: () => void): void
}

/** 结构化取消源，对应 DOM/Node 的 `AbortController`。 */
export type IAbortController = {
  readonly signal: IAbortSignal
  abort(reason?: unknown): void
}

/**
 * 本包内部使用的极简 `AbortController` 实现。
 *
 * 不依赖任何全局 `AbortController`/`AbortSignal`，只在需要「一个可由本包主动中止、可被 `once` 监听、且能 `removeEventListener`
 * 原始引用」的信号时使用。对已中止的信号再 `addEventListener` 不会触发监听器（对齐 DOM 语义：abort 事件已经发生过）。
 *
 * 监听器按 callback 去重；本信号只派发一次 abort 事件，因此 `once` 不改变登记结果。 `removeEventListener` 直接接收原始
 * callback，保证重复登记与移除都遵循结构化 signal 契约。
 */
export function createAbortController(): IAbortController {
  let aborted = false
  let reason: unknown
  /** Callback-keyed listener set; one callback can produce at most one abort invocation. */
  const listeners = new Set<() => void>()

  const signal: IAbortSignal = {
    get aborted() {
      return aborted
    },
    get reason() {
      return reason
    },
    addEventListener(_type, listener, _options) {
      if (aborted) return
      listeners.add(listener)
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener)
    }
  }

  return {
    signal,
    abort(value) {
      if (aborted) return
      aborted = true
      reason = value
      const pending = [...listeners]
      listeners.clear()
      const errors: unknown[] = []
      for (const listener of pending) {
        try {
          listener()
        } catch (error) {
          errors.push(error)
        }
      }
      if (errors.length === 1) {
        throw createLifecycleFailure(
          LifecycleErrorCode.abortListenerFailed,
          LifecycleErrorText.abortListenerDispatchFailed,
          errors[0]
        )
      }
      if (errors.length > 1) {
        throw tagLifecycleError(
          new AggregateError(errors, LifecycleErrorText.abortListenerDispatchFailed),
          LifecycleErrorCode.abortListenerFailed
        )
      }
    }
  }
}
