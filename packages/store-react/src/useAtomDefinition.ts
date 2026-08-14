import { useCallback, useSyncExternalStore } from 'react';
import type { IAtomDefinition, IWritableAtomDefinition } from '@migaia/store-keyed/atom/definition';
import type { IAtomStore } from '@migaia/store-keyed/atom/store';
import { useStoreRegistry } from './provider';

/**
 * 从 Provider 直接取它自己的 atom store。
 *
 * 订阅走 `store.sub` 而不是拿节点自己订——实例化策略因此可以自由演进， 适配层只依赖「读、写、订阅」这三件事。同一个 Runtime 可以承载多个 Registry， 但每个
 * Provider Registry 的 atom 状态与 override 必须独立。
 */
function useAtomStore(): IAtomStore {
  return useStoreRegistry().atomStore;
}

export function useAtomDefinition<T>(definition: IAtomDefinition<T>): T {
  const store = useAtomStore();
  const subscribe = useCallback(
    (onChange: () => void) => store.sub(definition, onChange),
    [definition, store]
  );
  // preview 是 React 可重复调用的 speculative snapshot：派生值不会发布依赖边，
  // 但同一 Runtime version 内保持引用稳定，避免 getSnapshot 触发重复渲染。
  const getSnapshot = useCallback(() => store.preview(definition), [definition, store]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useSetAtomDefinition<T, Args extends readonly unknown[], Result>(
  definition: IWritableAtomDefinition<T, Args, Result>
): (...args: Args) => Result {
  const store = useAtomStore();
  return useCallback((...args: Args) => store.set(definition, ...args), [definition, store]);
}
