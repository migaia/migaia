import type { IObservable, IObserver, IRuntimeTraceEvent } from '@migaia/reactive/runtime/types';
import type { IReactiveStore } from '@migaia/store-light';
import { ClonePolicy } from '@migaia/store-middleware/tolerant-clone';

export type IDependencyTreeNode = {
  kind: 'observable' | 'observer';
  label: string;
  version?: number;
  children: IDependencyTreeNode[];
  circular?: boolean;
};

export type IStoreHistoryEntry = {
  id: number;
  timestamp: number;
  label: string;
  state: Record<string, unknown>;
};

export type IActionTrace = {
  timestamp: number;
  name: string;
  payload?: unknown;
  durationMs?: number;
  error?: unknown;
};

export type IStoreDevToolsOptions = {
  maxHistory?: number;
  maxTrace?: number;
  captureRuntimeTrace?: boolean;
  now?: () => number;
  clone?: (state: Record<string, unknown>) => Record<string, unknown>;
};

export type IStoreDevTools = {
  readonly history: readonly IStoreHistoryEntry[];
  readonly actions: readonly IActionTrace[];
  readonly trace: readonly IRuntimeTraceEvent[];
  record(label?: string): IStoreHistoryEntry;
  recordAction(trace: Omit<IActionTrace, 'timestamp'>): void;
  jumpTo(id: number): void;
  clear(): void;
  dispose(): void;
};

const nodeLabel = (node: object): string =>
  (node as { debugName?: string }).debugName ?? node.constructor?.name ?? 'AnonymousReactiveNode';

// 环判定按「当前这条路径」，不是全局访问集：菱形里的共享节点会被两条路径各展开一次——
// 那是共享，不是环。只有重新踩到仍在当前路径上的节点才是环，因此进入时入栈、返回时出栈。
export function getDependencyTree(observer: IObserver, maxDepth = 20): IDependencyTreeNode {
  const path = new Set<object>();
  const visitObservable = (current: IObservable, depth: number): IDependencyTreeNode => {
    const node: IDependencyTreeNode = {
      kind: 'observable',
      label: nodeLabel(current),
      version: current.version,
      children: []
    };
    // 成环的那个节点自己带上标记——早期版本只取下游的 children，circular 被顺手丢掉了
    if (path.has(current)) {
      node.circular = true;
      return node;
    }
    if (depth >= maxDepth || !('deps' in current)) return node;
    path.add(current);
    try {
      node.children = [...(current as IObservable & IObserver).deps].map((dependency) =>
        visitObservable(dependency, depth + 1)
      );
    } finally {
      path.delete(current);
    }
    return node;
  };
  path.add(observer);
  return {
    kind: 'observer',
    label: nodeLabel(observer),
    children: depth0Exceeds(0, maxDepth)
      ? []
      : [...observer.deps].map((dependency) => visitObservable(dependency, 1))
  };
}

export function getObserverTree(observable: IObservable, maxDepth = 20): IDependencyTreeNode {
  const path = new Set<object>();
  const visitObserver = (current: IObserver, depth: number): IDependencyTreeNode => {
    const node: IDependencyTreeNode = {
      kind: 'observer',
      label: nodeLabel(current),
      children: []
    };
    if (path.has(current)) {
      node.circular = true;
      return node;
    }
    if (depth >= maxDepth || !('subs' in current)) return node;
    path.add(current);
    try {
      node.children = [...(current as IObserver & IObservable).subs].map((subscriber) =>
        visitObserver(subscriber, depth + 1)
      );
    } finally {
      path.delete(current);
    }
    return node;
  };
  path.add(observable);
  return {
    kind: 'observable',
    label: nodeLabel(observable),
    version: observable.version,
    children: depth0Exceeds(0, maxDepth)
      ? []
      : [...observable.subs].map((subscriber) => visitObserver(subscriber, 1))
  };
}

/** MaxDepth 为 0 时连根的直接边都不展开——把这条边界判断和递归里的写法对齐。 */
const depth0Exceeds = (depth: number, maxDepth: number): boolean => depth >= maxDepth;

export function createStoreDevTools<S extends Record<string, unknown>>(
  store: IReactiveStore<S>,
  options: IStoreDevToolsOptions = {}
): IStoreDevTools {
  const maxHistory = Math.max(1, options.maxHistory ?? 100);
  const maxTrace = Math.max(1, options.maxTrace ?? 1_000);
  const now = options.now ?? Date.now;
  const clone = options.clone ?? ClonePolicy.diagnostic;
  const history: IStoreHistoryEntry[] = [];
  const actions: IActionTrace[] = [];
  const trace: IRuntimeTraceEvent[] = [];
  let nextId = 1;
  // 计数而非布尔：回放期间监听器再次 jumpTo 时，内层的 finally 不能提前解除外层的回放屏蔽，
  // 否则外层剩余的通知会被当成用户操作记进历史。
  let replayDepth = 0;
  let disposed = false;

  const assertActive = () => {
    if (disposed) throw new Error('[store] DevTools session is disposed');
  };
  const record = (label = 'state change'): IStoreHistoryEntry => {
    assertActive();
    const entry: IStoreHistoryEntry = {
      id: nextId++,
      timestamp: now(),
      label,
      state: clone(store.$plain())
    };
    history.push(entry);
    if (history.length > maxHistory) history.splice(0, history.length - maxHistory);
    return entry;
  };
  const recordAction = (action: Omit<IActionTrace, 'timestamp'>): void => {
    assertActive();
    actions.push({ ...action, timestamp: now() });
    if (actions.length > maxHistory) {
      actions.splice(0, actions.length - maxHistory);
    }
  };
  record('initial');
  const unsubscribe = store.$subscribe(() => {
    if (replayDepth > 0) return;
    try {
      record();
    } catch (error) {
      // 诊断工具坏掉不能让业务写入跟着失败：快照/克隆异常在这里就地上报，
      // 绝不冒泡进 store 的 flush（那会让一次普通赋值抛错）。
      store.$runtime.reportError(error, { phase: 'trace-listener' });
    }
  });
  const unsubscribeTrace =
    options.captureRuntimeTrace === false
      ? () => {}
      : store.$runtime.subscribeTrace((event) => {
          if (disposed) return;
          trace.push(event);
          if (trace.length > maxTrace) {
            trace.splice(0, trace.length - maxTrace);
          }
          if (event.type === 'action' && event.phase !== 'start') {
            recordAction({
              name: event.name,
              durationMs: event.durationMs,
              error: event.phase === 'error' ? event.error : undefined
            });
          }
        });

  return {
    get history() {
      return history;
    },
    get actions() {
      return actions;
    },
    get trace() {
      return trace;
    },
    record,
    recordAction,
    jumpTo(id) {
      assertActive();
      const entry = history.find((candidate) => candidate.id === id);
      if (!entry) throw new RangeError(`[store] unknown history entry: ${id}`);
      replayDepth++;
      try {
        store.$hydrate(clone(entry.state));
      } finally {
        replayDepth--;
      }
    },
    clear() {
      assertActive();
      history.length = 0;
      actions.length = 0;
      trace.length = 0;
      record('initial');
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      unsubscribeTrace();
    }
  };
}
