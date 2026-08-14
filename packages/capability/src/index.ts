/**
 * `@migaia/capability` —— 能力的运行时闸门。
 *
 * 「关闭一个能力」此前只有一个定义：**不 import 它**。于是能力粒度等于打包粒度， 同构建 A/B、按租户开关、线上不重新部署就回退，全都做不到。
 *
 * 需要先说清事实，否则会修错东西：本库每个增强都是**调用才启用** （`persist(store,
 * …)`、`bindStoreMiddleware(…)`、`workerComputed(…)`）， 所以「行为」层面的开关本来就在调用点上。真正缺的是三件：
 *
 * 1. **懒加载**——开关关着时代码不该被下载。这要 `await import()`，而动态 import 的时机、失败、重试、以及「加载完发现开关又关了」的竞态，不该让每个调用方 各写一遍。
 * 2. **启停生命周期**——启用给出 handle，关闭必须真释放（persist 有 I/O 连接、 worker 有端口）；激活失败必须留在关闭态而不是半开。
 * 3. **按租户隔离**——同一进程里两个租户的开关不同，两份闸门不能互相看见。
 *
 * 这一层**不能**给的东西也要写明：它不会让一个静态 import 进来的能力变免费。 体积只在 `activate` 用动态 import 时才真的省下来——闸门把那个写法变成一等公民，
 * 但省下体积的是打包器，不是闸门。
 */

export type ICapabilityHandle = {
  dispose(): void | PromiseLike<void>;
};

/**
 * 能力当前生命周期。
 *
 * `off` 表示闸门允许、但尚未启用；`blocked` 表示被开关明确拒绝。两者分开后， 控制台与调用方不再把「从未尝试」误报成「灰度策略拦截」。
 */
export type ICapabilityState = 'off' | 'blocked' | 'activating' | 'on' | 'failed';

export type ICapabilityEnableResult =
  | { readonly status: 'enabled' }
  | { readonly status: 'blocked' }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly error: unknown };

export type ICapabilityDefinition<Context, Handle extends ICapabilityHandle = ICapabilityHandle> = {
  readonly name: string;
  /**
   * 启用这个能力。
   *
   * 允许异步，正是为了按需加载持久化等增强能力——关着的时候那个 chunk 不进初始包。
   */
  activate(context: Context): Handle | Promise<Handle>;
};

export type ICapabilityHostOptions = {
  /**
   * 开关表。安全默认是拒绝：只有值严格等于 `true` 的自有数据属性才允许启用。
   *
   * Host 会复制这份初始快照；之后请调用 `setFlag()` / `setFlags()`。外部改写传入对象 不会绕过状态机。`setFlag(name, false)`
   * 本身就是原子回退：它会作废在途激活并 释放现有 handle，不需要调用方再补一次 `disable()`。
   */
  readonly flags?: Readonly<Record<string, boolean>>;
  /** 激活或释放失败的上报口。Reporter 自己抛错也不会破坏闸门状态机；原始错误仍可 通过 `error(name)` 查询。 */
  readonly onError?: (name: string, error: unknown) => void;
};

export type ICapabilityHost<Context> = {
  /** 登记一个能力。重复登记同名视为编程错误。 */
  register<Handle extends ICapabilityHandle>(
    definition: ICapabilityDefinition<Context, Handle>
  ): void;
  readonly names: readonly string[];
  state(name: string): ICapabilityState;
  /** 已启用能力的 handle；未启用返回 undefined。 */
  handle<Handle extends ICapabilityHandle>(name: string): Handle | undefined;
  /** 上一次激活或释放失败的原因；成功重启或重新配置会清除。 */
  error(name: string): unknown;
  /** 更新单个灰度开关。关闭会同步作废在途激活并释放现有 handle；打开不会自动启用。 */
  setFlag(name: string, enabled: boolean): void;
  /** 原子替换整份开关快照。新快照未列出的能力按拒绝处理，因此远端配置删键不会让 旧的 `true` 永久残留。 */
  setFlags(flags: Readonly<Record<string, boolean>>): void;
  /**
   * 启用。返回是否处于启用态。
   *
   * 幂等：并发调用共享同一次激活，`activate` 只跑一次。开关为 false 时直接拒绝 （返回 false），不会「偷偷打开」。
   */
  enable(name: string): Promise<ICapabilityEnableResult>;
  /** Structured counterpart of enable(); false is retained for compatibility. */
  enableResult(name: string): Promise<ICapabilityEnableResult>;
  /** 关闭并释放 handle。返回是否确实关掉了一个启用态的能力。 */
  disable(name: string): Promise<boolean>;
  /** Awaitable counterpart for integrations whose handle release is asynchronous. */
  disableAsync(name: string): Promise<boolean>;
  /** 关闭全部（后进先出）并使 host 不可用。 */
  dispose(): Promise<void>;
  disposeAsync(): Promise<void>;
  /** Synchronous compatibility adapter for integrations that require a boolean. */
  enableLegacyBoolean(name: string): Promise<boolean>;
  /** Synchronous release adapter; prefer awaitable `disable()`. */
  disableNow(name: string): boolean;
  /** Synchronous teardown adapter; prefer awaitable `dispose()`. */
  disposeNow(): void;
  readonly disposed: boolean;
};

type IEntry<Context> = {
  /** Registration-time snapshot. Caller mutation must not rewrite gate identity. */
  readonly name: string;
  readonly activate: (context: Context) => ICapabilityHandle | Promise<ICapabilityHandle>;
  state: ICapabilityState;
  handle?: ICapabilityHandle;
  error?: unknown;
  /** 在途激活。用于幂等：并发 enable 共享它。 */
  pending?: Promise<boolean>;
  /**
   * 激活代数。
   *
   * 异步激活期间可能被 `disable()` 或 `dispose()`，此时 activate 的结果**不能** 被采纳——否则关掉的能力会在几毫秒后自己回来（而调用方以为已经回退了）。
   * 代数不匹配就把刚拿到的 handle 直接释放。
   */
  generation: number;
};

/**
 * `() => void` 在 TypeScript 中仍接受 async 函数。对诊断/释放回调的返回值做 thenable 兜底，避免一次回退在下个微任务变成宿主的 unhandled
 * rejection。
 */
function containAsyncRejection(value: unknown, onRejected: (error: unknown) => void): void {
  if ((value === null || typeof value !== 'object') && typeof value !== 'function') {
    return;
  }
  let then: unknown;
  try {
    then = (value as { then?: unknown }).then;
  } catch (error) {
    onRejected(error);
    return;
  }
  if (typeof then !== 'function') return;
  // 复用第一次取得的 then，不能再交给 Promise.resolve 读取一次：状态型 getter
  // 可以让两次读取返回不同函数，甚至让第二次读取抛错。
  const settled = new Promise<unknown>((resolve, reject) => {
    try {
      Reflect.apply(then, value, [resolve, reject]);
    } catch (error) {
      reject(error);
    }
  });
  void settled.catch((error: unknown) => {
    try {
      onRejected(error);
    } catch {
      // 拒绝处理本身也是最后一道边界，不能再制造一条未处理拒绝。
    }
  });
}

export function createCapabilityHost<Context>(
  context: Context,
  options: ICapabilityHostOptions = {}
): ICapabilityHost<Context> {
  const { onError } = options;
  const entries = new Map<string, IEntry<Context>>();
  const pendingReleases = new Set<Promise<void>>();
  const entryReleases = new Map<IEntry<Context>, Set<Promise<void>>>();
  // A still-running `activate()` has not produced a handle yet, so it has
  // nothing in `pendingReleases` to await — but it may still create one
  // after `disposeSync()`/`disableSync()` already ran (the generation check
  // inside `enableBoolean`'s async body catches this and releases the
  // handle then). Awaiting `pendingReleases` alone therefore misses exactly
  // the case this exists to close: dispose/disable returning while a
  // same-tick activation is still in flight.
  const pendingActivations = new Set<Promise<boolean>>();
  const entryActivations = new Map<IEntry<Context>, Set<Promise<boolean>>>();
  const trackActivation = (entry: IEntry<Context>, promise: Promise<boolean>) => {
    pendingActivations.add(promise);
    let set = entryActivations.get(entry);
    if (!set) entryActivations.set(entry, (set = new Set()));
    set.add(promise);
    void promise.finally(() => {
      pendingActivations.delete(promise);
      set!.delete(promise);
      if (!set!.size) entryActivations.delete(entry);
    });
  };
  const asPromiseLike = (value: unknown): Promise<void> | undefined => {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function'))
      return undefined;
    const then = (value as { then?: unknown }).then;
    if (typeof then !== 'function') return undefined;
    return new Promise<void>((resolve, reject) => Reflect.apply(then, value, [resolve, reject]));
  };
  const trackRelease = (entry: IEntry<Context>, promise: Promise<void>) => {
    pendingReleases.add(promise);
    let set = entryReleases.get(entry);
    if (!set) entryReleases.set(entry, (set = new Set()));
    set.add(promise);
    void promise.finally(() => {
      pendingReleases.delete(promise);
      set!.delete(promise);
      if (!set!.size) entryReleases.delete(entry);
    });
  };
  /**
   * 记录真正进入 on 的顺序，回退按这个顺序 LIFO。
   *
   * 老实说这是**完成顺序**，不是依赖顺序，也不是调用顺序——三者在并发激活下 会分叉。`enable(A)` 之后马上 `enable(B)`，如果 B 的 `activate()` 先
   * resolve（网络快、无 I/O 等等），它先进 activationOrder，回退时 B 反而 先释放。这本身没问题：真正互相依赖的两个能力，调用方必须自己 `await
   * enable('A')` 完再 `enable('B')`——这样 A 保证先进 activationOrder，"后进先出"就等价于"先释放依赖 A 的 B，再释放 A"。
   *
   * 本模块**不提供** dependsOn 声明或强制串行 activate；早先试过在这里把 全部 activate() 调用串行化，直接和现有的"作废的在途激活不得卡住后来者"
   * 语义打架——一个被 setFlag(false) 废弃、永不 settle 的 activate() 会连带 卡死排在它后面的每一个 enable()。调用方若要严格顺序，必须显式
   * await，而不是指望这里替它保证。
   */
  const activationOrder: IEntry<Context>[] = [];
  let disposed = false;
  let transitionDepth = 0;

  /**
   * 只复制自有、可枚举的数据属性。
   *
   * Map 让 `__proto__` / `constructor` 没有原型链特权；读取 descriptor 而非属性值， 也避免配置对象的 getter 在建 Host
   * 或热回退时执行用户代码。
   */
  const copyFlags = (
    source: Readonly<Record<string, boolean>> | undefined
  ): Map<string, boolean> => {
    const copied = new Map<string, boolean>();
    if (!source) return copied;
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(source))) {
      if (descriptor.enumerable && 'value' in descriptor && descriptor.value === true) {
        copied.set(name, true);
      }
    }
    return copied;
  };

  let flagValues = copyFlags(options.flags);

  const assertUsable = (): void => {
    if (disposed) throw new Error('[store] capability host is disposed');
  };

  const assertNotTransitioning = (): void => {
    if (transitionDepth > 0) {
      throw new Error('[store] capability host cannot mutate during a lifecycle transition');
    }
  };

  const runTransition = <T>(operation: () => T): T => {
    transitionDepth++;
    try {
      return operation();
    } finally {
      transitionDepth--;
    }
  };

  /**
   * Keep immediate API failures observable to awaiters without host-level unhandled rejection
   * noise.
   */
  const rejectedOperation = (error: unknown): Promise<boolean> => {
    const rejected = Promise.reject<boolean>(error);
    void rejected.catch(() => {
      // The original promise remains rejected for callers; this marks it handled
      // when a reentrant disposer necessarily cannot await it.
    });
    return rejected;
  };

  const entryOf = (name: string): IEntry<Context> => {
    const entry = entries.get(name);
    if (!entry) {
      throw new Error(`[store] capability "${name}" is not registered`);
    }
    return entry;
  };

  const allowed = (name: string): boolean => flagValues.get(name) === true;

  /** 错误上报属于诊断路径，绝不能反向改变能力生命周期。 */
  const reportError = (name: string, error: unknown): void => {
    try {
      const result: unknown = onError?.(name, error);
      containAsyncRejection(result, () => {
        // Reporter 的异步失败没有更低一层可上报，只能在边界终止。
      });
    } catch {
      // Reporter 已经是最后一道错误边界；这里不能再把它抛回业务 Promise。
    }
  };

  const release = (
    entry: IEntry<Context>,
    handle: ICapabilityHandle,
    ownerGeneration = entry.generation
  ): void => {
    const recordCleanupError = (error: unknown): void => {
      const inactiveWithoutReplacement =
        (entry.state === 'blocked' || entry.state === 'off') &&
        entry.pending === undefined &&
        entry.handle === undefined;
      if (
        ownerGeneration === entry.generation ||
        (entry.generation === ownerGeneration + 1 && inactiveWithoutReplacement)
      ) {
        entry.error = error;
      }
    };
    runTransition(() => {
      try {
        const result: unknown = handle.dispose();
        const thenable = asPromiseLike(result);
        if (thenable) {
          const pending = thenable.then(
            () => undefined,
            (error) => {
              // A previous generation may finish cleanup after a replacement is
              // already healthy. Report it, but never poison the replacement state.
              recordCleanupError(error);
              reportError(entry.name, error);
            }
          );
          trackRelease(entry, pending);
        }
        if (!thenable)
          containAsyncRejection(result, (error) => {
            recordCleanupError(error);
            reportError(entry.name, error);
          });
      } catch (error) {
        recordCleanupError(error);
        reportError(entry.name, error);
      }
    });
  };

  const releaseHandle = (entry: IEntry<Context>): void => {
    const handle = entry.handle;
    entry.handle = undefined;
    if (!handle) return;
    // 释放失败不得阻断其余能力的关闭：回退路径必须能走完
    release(entry, handle);
  };

  const forgetActivation = (entry: IEntry<Context>): void => {
    const index = activationOrder.lastIndexOf(entry);
    if (index >= 0) activationOrder.splice(index, 1);
  };

  /** 关闭一个 entry；flag 已更新后调用，因此最终状态可准确表示 blocked/off。 */
  const deactivate = (entry: IEntry<Context>): boolean => {
    entry.generation++;
    entry.pending = undefined;
    const wasOn = entry.state === 'on';
    entry.state = allowed(entry.name) ? 'off' : 'blocked';
    entry.error = undefined;
    forgetActivation(entry);
    releaseHandle(entry);
    return wasOn;
  };

  /** 应用新快照，并让全部已登记能力与闸门同步。 */
  const replaceFlags = (next: Map<string, boolean>): void => {
    flagValues = next;
    // 先按真实激活顺序 LIFO 关闭已有 handle，再处理尚在激活/失败/未启用的条目。
    for (const entry of [...activationOrder].reverse()) {
      if (!allowed(entry.name)) deactivate(entry);
    }
    for (const entry of entries.values()) {
      if (!allowed(entry.name)) {
        if (entry.state !== 'blocked') deactivate(entry);
      } else if (entry.state === 'blocked') {
        entry.state = 'off';
        entry.error = undefined;
      }
    }
  };

  // Compatibility implementations live outside the public host object so the
  // structured APIs do not depend on deprecated method names.
  const enableBoolean = (name: string): Promise<boolean> => {
    let entry: IEntry<Context>;
    try {
      assertUsable();
      assertNotTransitioning();
      entry = entryOf(name);
    } catch (error) {
      return rejectedOperation(error);
    }
    if (!allowed(name)) {
      entry.state = 'blocked';
      entry.error = undefined;
      return Promise.resolve(false);
    }
    if (entry.state === 'on') return Promise.resolve(true);
    if (entry.pending) return entry.pending;

    const generation = ++entry.generation;
    entry.state = 'activating';
    entry.error = undefined;
    const pending = (async () => {
      try {
        const handle = await entry.activate(context);
        if (!handle || typeof handle.dispose !== 'function') {
          throw new TypeError(`[store] capability "${name}" returned an invalid handle`);
        }
        if (disposed || generation !== entry.generation) {
          release(entry, handle, generation);
          return false;
        }
        entry.handle = handle;
        entry.state = 'on';
        activationOrder.push(entry);
        return true;
      } catch (error) {
        if (generation === entry.generation) {
          entry.state = 'failed';
          entry.error = error;
        }
        reportError(name, error);
        return false;
      } finally {
        if (generation === entry.generation) entry.pending = undefined;
      }
    })();
    entry.pending = pending;
    trackActivation(entry, pending);
    return pending;
  };

  const disableSync = (name: string): boolean => {
    assertUsable();
    assertNotTransitioning();
    const entry = entryOf(name);
    return runTransition(() => deactivate(entry));
  };

  const disposeSync = (): void => {
    assertNotTransitioning();
    if (disposed) return;
    disposed = true;
    for (const entry of entries.values()) {
      entry.generation++;
      entry.pending = undefined;
    }
    for (const entry of [...activationOrder].reverse()) {
      releaseHandle(entry);
      entry.state = 'off';
    }
    activationOrder.length = 0;
    for (const entry of entries.values()) entry.state = 'off';
  };

  const disposeAsync = async (): Promise<void> => {
    disposeSync();
    // Loop, not a single await: draining a still-in-flight activation can
    // itself enqueue a new release promise that did not exist in any
    // earlier snapshot (see `pendingActivations` above). `disposeAsync()`
    // must not resolve until both sets have settled to empty together.
    while (pendingActivations.size || pendingReleases.size) {
      await Promise.all([...pendingActivations, ...pendingReleases]);
    }
  };

  const host: ICapabilityHost<Context> = {
    register(definition) {
      assertUsable();
      assertNotTransitioning();
      const snapshot = runTransition(() => {
        const name: unknown = definition?.name;
        const activate: unknown = definition?.activate;
        if (typeof name !== 'string' || name.trim().length === 0) {
          throw new TypeError('[store] capability name must be a non-empty string');
        }
        if (typeof activate !== 'function') {
          throw new TypeError(`[store] capability "${name}" activate must be a function`);
        }
        const activation = activate as (
          context: Context
        ) => ICapabilityHandle | Promise<ICapabilityHandle>;
        // Preserve method-style `this.name` without retaining the caller's
        // mutable definition object or exposing the private entry.
        const receiver = Object.freeze({ name, activate: activation });
        return {
          name,
          activate: (context: Context) => Reflect.apply(activation, receiver, [context])
        };
      });
      if (entries.has(snapshot.name)) {
        throw new Error(`[store] capability "${snapshot.name}" is already registered`);
      }
      entries.set(snapshot.name, {
        name: snapshot.name,
        activate: snapshot.activate,
        state: allowed(snapshot.name) ? 'off' : 'blocked',
        generation: 0
      });
    },

    get names() {
      return [...entries.keys()];
    },

    state: (name) => entryOf(name).state,

    handle: <Handle extends ICapabilityHandle>(name: string) =>
      entryOf(name).handle as Handle | undefined,

    error: (name) => entryOf(name).error,

    setFlag(name, enabled) {
      assertUsable();
      assertNotTransitioning();
      runTransition(() => {
        const next = new Map(flagValues);
        if (enabled === true) next.set(name, true);
        else next.delete(name);
        replaceFlags(next);
      });
    },

    setFlags(flags) {
      assertUsable();
      assertNotTransitioning();
      runTransition(() => {
        try {
          replaceFlags(copyFlags(flags));
        } catch (error) {
          // 配置快照本身不可读（如恶意 Proxy）时必须 fail closed，而不是继续沿用
          // 上一份 allowlist。先完成回退，再把配置错误交还调用方。
          replaceFlags(new Map());
          throw error;
        }
      });
    },

    enableLegacyBoolean(name) {
      return enableBoolean(name);
    },

    enable(name) {
      return enableBoolean(name).then((enabled) => {
        const entry = entries.get(name);
        if (enabled) return { status: 'enabled' as const };
        if (entry?.state === 'blocked') return { status: 'blocked' as const };
        if (entry?.state === 'failed') return { status: 'failed' as const, error: entry.error };
        return { status: 'cancelled' as const };
      });
    },

    enableResult(name) {
      return this.enable(name);
    },

    disableNow(name) {
      return disableSync(name);
    },

    async disable(name) {
      const entry = entryOf(name);
      const changed = disableSync(name);
      // Same loop-until-stable reasoning as disposeAsync(), scoped to this entry.
      while (true) {
        const activations = entryActivations.get(entry);
        const releases = entryReleases.get(entry);
        if (!activations?.size && !releases?.size) break;
        await Promise.all([...(activations ?? []), ...(releases ?? [])]);
      }
      return changed;
    },

    disableAsync(name) {
      return this.disable(name);
    },

    disposeNow() {
      disposeSync();
    },

    async disposeAsync() {
      await disposeAsync();
    },

    dispose() {
      return this.disposeAsync();
    },

    get disposed() {
      return disposed;
    }
  };

  return host;
}
