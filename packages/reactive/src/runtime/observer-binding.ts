import type { ICapture } from './dependency-tracker.class.js'
import { internalsOf } from './internals.js'
import type { IDisposer, IReactiveNodeOptions, IRuntime } from './types.js'
import { Effect } from '../reactive/effect.class.js'
import { createReactiveError } from '../errors.js'
import { ReactiveErrorCode } from '../error-code.js'
import { ReactiveErrorText } from '../error-text.js'

/**
 * 一次捕获提交的完整结果。
 *
 * - `committed`：依赖边已安装；
 * - `stale`：捕获后依赖已变化，token 已消费，必须重新捕获；
 * - `no-observer`：提交目标尚不存在，token 未消费，可在 observer 就绪后重试。
 */
export type IObserverCommitResult = 'committed' | 'stale' | 'no-observer'
export type IObserverRetrackResult = 'changed' | 'unchanged' | 'no-observer'

/**
 * 三段式绑定的公开接口。
 *
 * 并发安全的宿主适配层都要做同一件事：**render 期只读地捕获依赖，commit 期才把这份 依赖装到订阅者上**。中间的渲染可能被 React 丢弃，所以捕获不能建边；而 commit 时
 * 依赖可能已经变了，所以提交必须能失败并让调用方重取。
 *
 * 此前这条路只有本仓库的 React 适配层走得通——它直接 import `runtime/internals` 拿 tracker，而那个模块由 `architecture.test.ts`
 * 的豁免名单守着。也就是说： **并发安全的唯一实现路径是一份特权**，第三方（Vue/Solid/Svelte 适配层，或另一套 React
 * 绑定）做不出等价的东西，只能退回「订阅即建边」，把已经修好的撕裂窗口重新 打开。
 *
 * 所以把它变成公开面。这里交出去的能力恰好是三段式所需，不多一点：
 *
 * - `capture` 不建边、不入队、不改版本，只记下「这次读了谁、当时是什么版本」；
 * - `ICapture` 是带品牌的不透明 token，依赖集合存在 Tracker 的私有 WeakMap 里， 拿到它既读不出依赖也改不了版本；
 * - `commit` 只能把 token 装到**创建这个绑定时指定的那个 observer** 上，装不到 别人身上，也不能凭空制造单边依赖。
 */
export type IObserverBinding = {
  /**
   * 渲染期捕获。
   *
   * 只记录读到了哪些节点及其版本，不建立依赖边——被丢弃的渲染因此不会留下订阅。
   */
  capture<R>(read: () => R): ICapture<R>
  /**
   * Install the binding-owned observer. Keeping the concrete Effect private prevents adapters from
   * mutating deps/versions or calling run/markDirty.
   */
  observe(fn: () => void | IDisposer, options?: IReactiveNodeOptions): IDisposer
  /**
   * 提交期安装依赖。
   *
   * 返回三态结果，明确区分「需要重新捕获」与「订阅者尚不存在」。调用方只应在 `stale` 时作废快照并重新取值，而**不是**在 commit 阶段去 pull 脏节点——
   * 那会把用户的求值错误抛在 commit 里，绕过 Error Boundary。
   */
  commit(capture: ICapture<unknown>): IObserverCommitResult
  /** Force one committed observer run and report whether its dependency set changed. */
  retrack(): IObserverRetrackResult
}

/**
 * 为一个订阅者建立绑定。
 *
 * 捕获发生在 render 期，observer 只在宿主订阅阶段存在。绑定自持 Effect：适配层 能完成 capture/observe/commit/retrack，却拿不到
 * deps、版本或强制调度入口。
 */
export function createObserverBinding(runtime: IRuntime): IObserverBinding {
  const tracker = internalsOf(runtime).tracker
  let observer: Effect | undefined
  const dependenciesChanged = (
    before: ReadonlyMap<object, number>,
    after: ReadonlyMap<object, number>
  ): boolean => {
    if (before.size !== after.size) return true
    for (const [dependency, version] of after) {
      if (before.get(dependency) !== version) return true
    }
    return false
  }
  return {
    capture: (read) => tracker.capture(read),
    observe: (fn, options) => {
      if (observer && !observer.disposed) {
        throw createReactiveError(
          ReactiveErrorCode.bindingDuplicate,
          ReactiveErrorText.observerBindingAlreadyObserved
        )
      }
      const current = new Effect(fn, runtime, options)
      observer = current
      let active = true
      return () => {
        if (!active) return
        active = false
        current.dispose()
        if (observer === current) observer = undefined
      }
    },
    commit: (capture) => {
      const current = observer
      if (!current || current.disposed) return 'no-observer'
      return tracker.commitCapture(current, capture) ? 'committed' : 'stale'
    },
    retrack: () => {
      const current = observer
      if (!current || current.disposed) return 'no-observer'
      const before = new Map(current.depVersions)
      current.run()
      if (current.disposed) return 'no-observer'
      return dependenciesChanged(before, current.depVersions) ? 'changed' : 'unchanged'
    }
  }
}
