import { internalsOf } from './internals';
import { DependencyTracker } from './dependency-tracker.class';
import type { IReactiveNodeOptions, IRuntime } from './types';
import type { Signal } from '../reactive/signal.class';
import type { Computed, IComputedConfig } from '../reactive/computed.class';

/**
 * 具体节点类的工厂视图。
 *
 * 公共 `IRuntime.signal()` / `computed()` 刻意只返回窄接口（`ISignal` /
 * `IComputedValue`）：那是给调用方的面，不该把类的全部方法一并交出去。但**自己就是 图的实现者**的那几层需要具体类——collections 要对 cell 调
 * `dispose()`，对象门面要 拿 `Computed` 的配置面。
 *
 * 它单独占一个模块，而不是挂在 `internals.ts` 上：那个模块守的是 tracker / scheduler / clock /
 * notify——能绕过所有权校验、生命周期与调度原子性的**内部面**，豁免名单的 全部意义就在于此。把「只是把返回类型收窄回具体类」也塞进去，等于让两种权限共用一张
 * 名单：名单会因为无害的原因增长，于是下一次真正危险的新增就不再显眼。
 *
 * 这里给出的东西不比公共 `IRuntime` 多——节点还是同一个 Runtime 造的，仍走归属登记与 通知管线；只是类型不再被收窄。校验照旧：不是本库造的 Runtime 直接抛。
 */
export type IInternalRuntime = Omit<IRuntime, 'signal' | 'computed'> & {
  signal<T>(value: T, options?: IReactiveNodeOptions): Signal<T>;
  computed<T>(fn: () => T, config?: IComputedConfig<T>): Computed<T>;
};

/** 先校验是本库创建的 Runtime，再把节点工厂的具体返回类型交给实现层。 */
export function internalRuntimeOf(runtime: IRuntime): IInternalRuntime {
  internalsOf(runtime);
  return runtime as IInternalRuntime;
}

/** Read-only tracking-context query for node-building implementation layers. */
export function isRuntimeTracking(runtime: IRuntime): boolean {
  return internalsOf(runtime).tracker.isTracking();
}

/** True when a dependency frame is active in any Runtime. */
export function isAnyRuntimeTracking(): boolean {
  return DependencyTracker.isAnyTracking();
}
