import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createRuntime, type IRuntime } from '@migaia/reactive';
import { StoreRegistryContext } from './provider-context.js';
import { createStoreRegistry, type StoreRegistry } from './provider-registry.js';
import { createStoreReactError } from './errors.js';
import { StoreReactErrorCode } from './error-code.js';
import { StoreProviderState } from './provider-state-constants.js';
import {
  decodeStoreExperimental,
  encodeStoreExperimental,
  normalizeStoreConfig,
  StoreConfigContext,
  type IStoreProviderConfig,
  type IStoreReadyBarrier
} from './store-config.js';

const READY_KEYS = new WeakMap<Promise<void>, number>();
let nextReadyKey = 1;
function readyKey(promise: Promise<void>): number {
  let key = READY_KEYS.get(promise);
  if (key === undefined) {
    key = nextReadyKey++;
    READY_KEYS.set(promise, key);
  }
  return key;
}

export type IStoreProviderProps = {
  readonly children: ReactNode;
  readonly registry?: StoreRegistry;
  readonly runtime?: IRuntime;
  /**
   * Internal registries dispose on unmount by default. External registries remain caller-owned
   * unless this flag is explicitly true.
   */
  readonly disposeOnUnmount?: boolean;
  /** 应用级配置：特性开关 + 就绪屏障。 省略时与历史行为一致（无屏障、features 全关）。 */
  readonly config?: IStoreProviderConfig;
};

export function StoreProvider({
  children,
  registry,
  runtime,
  disposeOnUnmount,
  config
}: IStoreProviderProps) {
  if (registry && runtime && registry.runtime !== runtime) {
    throw createStoreReactError(
      StoreReactErrorCode.invalidConfig,
      '[store] StoreProvider registry/runtime ownership mismatch'
    );
  }

  // ready 数组字面量每次 render 都是新引用；按元素浅比较稳住 Promise，避免 use() 反复 suspend
  const readyInput = config?.ready;
  const barrierScope = useRef<object>(undefined);
  if (!barrierScope.current) barrierScope.current = {};
  const readyRef = useRef<{
    value: readonly IStoreReadyBarrier[] | undefined;
    initialized: boolean;
  }>({
    value: undefined,
    initialized: false
  });
  if (!readyRef.current.initialized) {
    readyRef.current = { value: readyInput, initialized: true };
  } else if (!sameBarrierList(readyRef.current.value, readyInput)) {
    const nodeProcess = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process;
    if (nodeProcess?.env?.NODE_ENV !== 'production') {
      console.warn(
        '[store] StoreProvider ready barriers changed identity; memoize config.ready to avoid resetting the provider tree'
      );
    } else {
      console.error(
        '[store] StoreProvider ready barriers changed identity; the initial barrier set is retained. Memoize config.ready to avoid stale initialization.'
      );
    }
  }
  const stableReady = readyRef.current.value;
  const wasmEnabled = config?.features?.wasm === true;
  const warnAsyncActions = config?.defaults?.warnAsyncActions === true;
  const experimentalKey = useMemo(
    () => encodeStoreExperimental(config?.features?.experimental),
    [config?.features?.experimental]
  );
  const experimental = useMemo<Readonly<Record<string, boolean>> | undefined>(
    () => decodeStoreExperimental(experimentalKey),
    [experimentalKey]
  );
  const normalized = useMemo(
    () =>
      normalizeStoreConfig(
        {
          features: {
            wasm: wasmEnabled,
            experimental
          },
          defaults: { warnAsyncActions },
          ready: stableReady
        },
        barrierScope.current
      ),
    [experimental, stableReady, warnAsyncActions, wasmEnabled]
  );
  const fallback = config?.fallback ?? null;

  const tree = registry ? (
    <RegistryBoundary registry={registry} disposeOnUnmount={disposeOnUnmount ?? false}>
      {children}
    </RegistryBoundary>
  ) : (
    <OwnedRegistryBoundary
      runtime={runtime}
      disposeOnUnmount={disposeOnUnmount ?? true}
      armInitial={normalized.ready?.promise}
    >
      {children}
    </OwnedRegistryBoundary>
  );

  return (
    <StoreConfigContext.Provider value={normalized}>
      {normalized.ready ? (
        <ReadyBoundary
          key={readyKey(normalized.ready.promise)}
          ready={normalized.ready}
          fallback={fallback}
        >
          {tree}
        </ReadyBoundary>
      ) : (
        tree
      )}
    </StoreConfigContext.Provider>
  );
}

/** 就绪屏障。Promise 身份由上层稳住；已 settle 时尽量首帧直接放行（track 状态）。 */
function ReadyBoundary({
  ready,
  fallback,
  children
}: {
  ready: import('./store-config.js').ITrackedReady;
  fallback: ReactNode;
  children: ReactNode;
}) {
  const initial = ready.status();
  const normalizeReadyError = (reason: unknown): Error =>
    reason instanceof Error
      ? reason
      : new Error(`[store] ready barrier rejected: ${String(reason)}`);
  const [status, setStatus] = useState(initial);
  const [error, setError] = useState<Error | null>(() => {
    const reason = ready.error();
    return initial === StoreProviderState.error ? normalizeReadyError(reason) : null;
  });

  useEffect(() => {
    let live = true;
    const snap = ready.status();
    if (snap === StoreProviderState.ready) {
      setStatus(StoreProviderState.ready);
      setError(null);
      return;
    }
    if (snap === StoreProviderState.error) {
      setStatus(StoreProviderState.error);
      setError(normalizeReadyError(ready.error()));
      return;
    }
    setStatus(StoreProviderState.pending);
    setError(null);
    ready.promise.then(
      () => {
        if (live) setStatus(StoreProviderState.ready);
      },
      (reason: unknown) => {
        if (live) {
          setError(normalizeReadyError(reason));
          setStatus(StoreProviderState.error);
        }
      }
    );
    return () => {
      live = false;
    };
  }, [ready]);

  if (status === StoreProviderState.error) throw error;
  if (status === StoreProviderState.pending) return <>{fallback}</>;
  return <>{children}</>;
}

type IRegistryBoundaryProps = {
  readonly children: ReactNode;
  readonly registry: StoreRegistry;
  readonly disposeOnUnmount: boolean;
  readonly deferRelease?: boolean;
  readonly onCommit?: () => void;
};

function RegistryBoundary({
  children,
  registry,
  disposeOnUnmount,
  deferRelease,
  onCommit
}: IRegistryBoundaryProps) {
  useEffect(() => {
    const release = registry.retain(disposeOnUnmount, deferRelease);
    onCommit?.();
    return release;
  }, [disposeOnUnmount, deferRelease, onCommit, registry]);
  return <StoreRegistryContext.Provider value={registry}>{children}</StoreRegistryContext.Provider>;
}

type IOwnedRegistryState = {
  readonly runtime: IRuntime | undefined;
  readonly registry: StoreRegistry;
};

type IOwnedRegistryBoundaryProps = {
  readonly children: ReactNode;
  readonly runtime: IRuntime | undefined;
  readonly disposeOnUnmount: boolean;
  readonly armInitial: Promise<void> | undefined;
};

function sameBarrierList(
  left: readonly IStoreReadyBarrier[] | undefined,
  right: readonly IStoreReadyBarrier[] | undefined
): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((item, index) => item === right[index]);
}

function OwnedRegistryBoundary({
  children,
  runtime,
  disposeOnUnmount,
  armInitial
}: IOwnedRegistryBoundaryProps) {
  const initial = useRef<IOwnedRegistryState>(undefined);
  if (!initial.current) {
    const ownedRuntime = runtime ?? createRuntime();
    const ownedRegistry = createStoreRegistry(ownedRuntime);
    if (armInitial) ownedRegistry.prepareForRender(armInitial);
    initial.current = {
      runtime,
      registry: ownedRegistry
    };
  }
  const committed = useRef<IOwnedRegistryState>(initial.current);
  const candidate = useRef<IOwnedRegistryState>(undefined);
  let active = committed.current;
  if (active.runtime !== runtime) {
    if (candidate.current?.runtime === runtime) {
      active = candidate.current!;
    } else {
      const nextRuntime = runtime ?? createRuntime();
      const nextRegistry = createStoreRegistry(nextRuntime);
      // A runtime switch can happen while the readiness barrier is still
      // pending. Keep the candidate armed by that same barrier; otherwise
      // prepareForRender() would dispose it on the next timer before the
      // ReadyBoundary has a chance to commit the subtree.
      if (armInitial) nextRegistry.prepareForRender(armInitial);
      active = {
        runtime,
        registry: nextRegistry
      };
      candidate.current = active;
    }
  }
  const activeRef = useRef(active);
  activeRef.current = active;
  const commitActive = useCallback(() => {
    committed.current = activeRef.current;
    if (candidate.current === activeRef.current) candidate.current = undefined;
  }, []);
  return (
    <RegistryBoundary
      registry={active.registry}
      disposeOnUnmount={disposeOnUnmount}
      deferRelease={armInitial !== undefined}
      onCommit={commitActive}
    >
      {children}
    </RegistryBoundary>
  );
}
