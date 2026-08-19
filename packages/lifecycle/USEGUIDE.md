# `@migaia/lifecycle` 使用指南

本指南逐个模块列出全部导出 API 的签名、边界行为与错误码。包的定位、适用/不适用场景与安装方式见 [README](./README.md)。

## 目录

- [作用域与释放模块](#作用域与释放模块)：`createLifecycleScope`、`createSyncLifecycleScope`、`executeReleaseDescriptor`、`createDisposeTransaction`、`IReleaseDescriptor`、`IReleaseContext`
- [单元与代数模块](#单元与代数模块)：`createLifecycleUnit`、`createGenerationController`
- [静默追踪与租约模块](#静默追踪与租约模块)：`createQuiescenceTracker`、`createStringQuiescenceTracker`、`createObjectLeaseRegistry`、`createStringLeaseRegistry`、`createPendingTracker`
- [事务性所有权模块](#事务性所有权模块)：`createProvisionalScope`
- [变更队列模块](#变更队列模块)：`createMutationQueue`
- [调度器、中止与有界等待模块](#调度器中止与有界等待模块)：`systemScheduler`、`createManualScheduler`、`snapshotScheduler`、`resolveScheduler`、`resolveSchedulerOption`、`validateSchedulerDelay`、`validateSchedulerTime`、`createAbortController`、`boundedWait`、`createTerminalController`
- [错误基础设施模块](#错误基础设施模块)：`LIFECYCLE_SOURCE`、`createLifecycleError`、`createLifecycleRangeError`、`tagLifecycleError`、`containAsyncRejection`、`probeThenable`、`assimilateCapturedThen`、`createErrorCollector`
- [状态常量模块](#状态常量模块)：`LifecycleState`、`LifecycleUnitState`、`LifecycleErrorPolicy`、`ThenableProbeKind`、`DisposeTransactionKind`
- [错误码](#错误码)：`LifecycleErrorCode`（21 个码）逐条语义
- [诊断消息](#诊断消息)：`LifecycleErrorText`
- [高阶组合示例](#高阶组合示例)
- [排查与构建门禁](#排查与构建门禁)

---

<a id="作用域与释放模块"></a>

## 作用域与释放模块

```ts
import {
  createLifecycleScope,
  createSyncLifecycleScope,
  executeReleaseDescriptor,
  createDisposeTransaction,
  type IReleaseDescriptor,
  type IReleaseContext,
  type ILifecycleScope,
  type ILifecycleScopeOptions,
  type ISyncLifecycleScope,
  type ISyncLifecycleScopeOptions,
  type ISyncReleaseDescriptor,
  type IDisposeItem,
  type IDisposeTransaction,
  type IDisposeTransactionMode,
  type IDisposeTransactionOptions
} from '@migaia/lifecycle';
```

两条正交轴：容器存活轴（`open → closing → terminal`，由 `close()`/`dispose()` 驱动）与资源释放本身。`close()` 永远同步、幂等、不调用用户代码；`dispose()` 永远异步。

### `IReleaseDescriptor` —— 领域表达释放意图的唯一词汇

```ts
type IReleaseDescriptor = {
  readonly syncSafe?: boolean;
  readonly order?: number;
  readonly graceful?: (context: IReleaseContext) => void | PromiseLike<void>;
  readonly gracefulTimeoutMs?: number;
  readonly force: (context: IReleaseContext) => void | PromiseLike<void>;
  readonly gcFallback?: boolean;
  readonly custom?: (context: IReleaseContext) => void | PromiseLike<void>;
};
```

字段语义：

- `syncSafe?: boolean` —— 声明该 descriptor 可被 `SyncLifecycleScope` 接受，不改变 `LifecycleScope` 本身的静态类型（同/异步由构造的具体类型决定，不由 descriptor 推断）。
- `order?: number` —— 释放排序键，缺省按 `0`；只在 `DisposeTransaction` 的 `order` 模式下生效，数值大者先释放（往「释放顺序的下方」沉降，与分配顺序相反）。
- `graceful?` —— 优雅释放；超时**只放弃等待**（不取消它），随即降级到 `force`；`graceful` 本身抛错（非超时）不会阻止 `force` 继续跑。
- `gracefulTimeoutMs?: number` —— 优雅阶段自己的预算，会被事务共享的绝对 `deadlineAt` 进一步封顶（取两者较小值）。
- `force: (context) => void | PromiseLike<void>`（**必填**）—— 必须无条件完成，不得依赖任何前置条件。
- `gcFallback?: boolean` —— 置为 `true` 时向内部 `FinalizationRegistry` 注册一个不强引用 `resource`/闭包 target 的兜底；显式释放（`dispose()`/`release()`）会自动 unregister 它。
- `custom?` —— 逃生舱：一旦提供，完全接管释放，`graceful`/`force` 被忽略。

`IReleaseContext`（回调收到的第一参数）：`signal: IAbortSignal`（容器进入 closing 时中止）、`deadlineAt: number | undefined`、`scheduler?: ILifecycleScheduler`（产出 `deadlineAt` 的时间域，缺省 `systemScheduler`）、`report(error: unknown): void`（诊断通道，自身抛错被吞掉）。

### `createLifecycleScope`

```ts
function createLifecycleScope(options?: ILifecycleScopeOptions): ILifecycleScope;

type ILifecycleScopeOptions = {
  readonly errorPolicy?: 'throw' | 'collect' | 'report' | 'firstError'; // 默认 'throw'
  readonly report?: (error: unknown) => void;
  readonly deadlineAt?: number;
  readonly scheduler?: ILifecycleScheduler; // 默认 systemScheduler
};

type ILifecycleScope = ILifecycleOwner & {
  readonly lifecycle: 'open' | 'closing' | 'terminal';
  own<T>(resource: T, descriptor: IReleaseDescriptor): T;
  release(resource: unknown): boolean;
  close(): void;
  dispose(): Promise<readonly ICollectedError[]>;
};
```

通用异步所有权容器：

```ts
const scope = createLifecycleScope();
const connection = scope.own(
  { close: () => undefined },
  {
    force: (ctx) => connection.close()
  }
);
scope.close(); // 同步、幂等，之后 own() 抛 SCOPE_CLOSED
const failures = await scope.dispose(); // 逆序释放，'throw' 策略下失败即抛
```

边界行为：

- `own(resource, descriptor)`：容器处于 `closing`/`terminal` 时抛 `SCOPE_CLOSED`/`SCOPE_TERMINAL`；在 disposer 内部重入调用抛 `SCOPE_REENTRANT_OWN`。
- `release(resource)`：反注册但不释放（调用方已自行释放），返回是否找到并移除了该条目；若曾设置 `gcFallback`，同时 unregister 对应的 `FinalizationRegistry` 条目。
- `close()`：同步、幂等；`open → closing`。
- `dispose()`：逆序（LIFO）释放全部已注册资源；并发多次调用复用同一个 Promise；在 disposer 内部重入调用抛 `SCOPE_REENTRANT_DISPOSE`；容器已 `terminal` 时立即 resolve 空数组。`errorPolicy: 'collect'` 时返回值为收集到的 `ICollectedError[]`；其余三种策略要么抛出要么内部上报，返回空数组。
- 环境支持时自动挂载 `[Symbol.asyncDispose]`。

### `createSyncLifecycleScope`

```ts
function createSyncLifecycleScope(options?: ISyncLifecycleScopeOptions): ISyncLifecycleScope;

type ISyncLifecycleScopeOptions = {
  readonly errorPolicy?: 'throw' | 'collect' | 'report' | 'firstError'; // 默认 'throw'
  readonly report?: (error: unknown) => void;
};

type ISyncReleaseDescriptor = IReleaseDescriptor & { readonly syncSafe: true };

type ISyncLifecycleScope = {
  readonly lifecycle: 'open' | 'closing' | 'terminal';
  own<T>(resource: T, descriptor: ISyncReleaseDescriptor): T;
  release(resource: unknown): boolean;
  close(): void;
  dispose(): readonly ICollectedError[]; // 永远同步
};
```

纯同步容器：

```ts
const scope = createSyncLifecycleScope();
scope.own(node, { syncSafe: true, force: () => node.detach() });
scope.close();
const failures = scope.dispose(); // 同步返回
```

约束与边界：

- 每个 descriptor 必须显式 `syncSafe: true`，否则 `own()` 在**注册时**（不是释放时）就抛 `SCOPE_SYNC_VIOLATION`。
- 不能 `own()` 一个 `LifecycleScope`/`ProvisionalScope` 实例（内部品牌检测），命中同样抛 `SCOPE_SYNC_VIOLATION`。
- 某个 callback（`custom`/`graceful`/`force`）若返回 thenable，在释放当次同步探测到并抛 `SCOPE_SYNC_VIOLATION`（`graceful` 违规时会继续跑 `force`，`force`/`custom` 违规则该项失败计入当前错误策略）。
- 降级链与异步版本相同（`custom` → 否则 `graceful` → `force`），但没有超时竞速——没有可等待的对象。
- `release()`/`close()` 语义与异步版本一致；`dispose()` 幂等，二次调用返回 `[]`；在 disposer 内部重入抛 `SCOPE_REENTRANT_DISPOSE`。
- 环境支持时挂载 `[Symbol.dispose]`，可配合 `using` 语法。

### `executeReleaseDescriptor`

```ts
function executeReleaseDescriptor(
  descriptor: IReleaseDescriptor,
  context: IReleaseContext
): Promise<readonly unknown[]>;
```

独立运行单个 descriptor 的完整降级链（`custom` → 否则 `graceful`（带超时竞速）→ `force`），不经过完整事务，常用于测试或自定义编排：

```ts
const errors = await executeReleaseDescriptor(descriptor, {
  signal: controller.signal,
  deadlineAt: undefined,
  report: (e) => console.error(e)
});
```

`descriptor`、`context` 均必填，`context` 无可选项——必须直接构造完整对象。返回全部失败错误的数组（成功为空数组），从不抛出；`graceful` 超时时会通过 `context.report` 上报一条诊断（`DEADLINE_EXCEEDED` 或空转到 `force`），`force` 失败时额外通过 `report` 上报一条 `RELEASE_FORCE_FAILED` 标签的错误（原始错误仍原样进入返回数组）。

### `createDisposeTransaction`

```ts
function createDisposeTransaction(
  mode: { readonly kind: 'order' } | { readonly kind: 'plan' },
  options?: IDisposeTransactionOptions
): IDisposeTransaction;

type IDisposeItem = { readonly source: string; readonly descriptor: IReleaseDescriptor };

type IDisposeTransactionOptions = {
  readonly errorPolicy?: 'throw' | 'collect' | 'report' | 'firstError'; // 默认 'throw'
  readonly report?: (error: unknown) => void;
  readonly deadlineAt?: number;
  readonly scheduler?: ILifecycleScheduler; // 默认 systemScheduler
  readonly signal?: IAbortSignal;
  readonly pending?: { drain(): Promise<void> };
};

type IDisposeTransaction = {
  readonly mode: { readonly kind: 'order' } | { readonly kind: 'plan' };
  run(items: readonly IDisposeItem[]): Promise<readonly ICollectedError[]>;
};
```

编排多个资源的释放，`order` 弱排序或 `plan` 强序列二选一，同一实例不能混用：

```ts
const transaction = createDisposeTransaction(
  { kind: 'plan' },
  { errorPolicy: 'collect', signal: controller.signal }
);
const failures = await transaction.run([
  { source: 'db', descriptor: dbDescriptor },
  { source: 'socket', descriptor: socketDescriptor }
]);
```

边界行为：

- `{ kind: 'order' }`：按每个 item 的 `descriptor.order`（缺省 `0`）降序分组释放，稳定排序保留同序调用方给定的相对顺序；只在此模式读取 `order`。
- `{ kind: 'plan' }`：严格按 `items` 给定顺序执行，从不读取 `order` 字段。
- `signal?`：转发进每个 item 的 `context.signal`；`run()` 开始时自动镜像调用方传入信号的中止状态；无 `signal` 时 item 收到一个永不中止的惰性信号。
- `deadlineAt`/`scheduler`：本次 `run()` 内所有 item 共享，不逐 item 重算。
- `pending?`：每个 item 释放完后调用 `pending.drain()` 等待其触发的在途工作排空（典型传 `createPendingTracker()`）。
- descriptor 校验（`order`/`custom`/`graceful`/`gracefulTimeoutMs`/`force` 的类型与访问）逐项独立进行——一个 item 的非法 descriptor（贴 `INVALID_OPTION` 码）不阻断其余 item 的释放，会作为该 item 的失败计入错误策略。
- `errorPolicy` 语义同 `createErrorCollector`；`throw` 策略下单错原样抛出，多错聚合为携带 `SCOPE_DISPOSAL_FAILED` 码的 `AggregateError`。

---

<a id="单元与代数模块"></a>

## 单元与代数模块

```ts
import {
  createLifecycleUnit,
  type ILifecycleUnit,
  type ILifecycleUnitOptions,
  createGenerationController,
  type IGenerationController,
  type IGenerationControllerOptions,
  type IGenerationRequest,
  type IGenerationToken
} from '@migaia/lifecycle';
```

### `createLifecycleUnit`

```ts
function createLifecycleUnit<T>(options?: ILifecycleUnitOptions): ILifecycleUnit<T>;

type ILifecycleUnitOptions = { readonly report?: (error: unknown) => void };

type ILifecycleUnit<T> = {
  readonly state: 'idle' | 'loading' | 'loaded' | 'failed';
  readonly lifecycle: 'open' | 'closing' | 'terminal';
  readonly value: T | undefined;
  readonly error: unknown;
  start(factory: () => T | PromiseLike<T>): void;
  restart(factory: () => T | PromiseLike<T>): void; // start 的别名
  close(): void;
  dispose(): void; // 永远同步
};
```

单元装载轴的状态机，内部用一个 `GenerationController` 丢弃过期结果：

```ts
const unit = createLifecycleUnit<Config>();
unit.start(() => fetchConfig()); // thenable → 先进 'loading'，settle 后进 'loaded'/'failed'
unit.state; // 'loading'
unit.value; // undefined（settle 前）
unit.restart(() => fetchConfig()); // 新 generation，旧一次的迟到结果被静默丢弃
```

边界行为：

- `factory()` 只读一次其返回值的 `.then`（探测语义同 `probeThenable`）：同步非 thenable 返回直接落 `loaded`（跳过 `loading`）；`factory()` 同步抛出或 thenable reject 时进入 `failed`，`unit.error` 存原始错误（不打标签），同时额外把一份打上 `UNIT_START_FAILED` 标签的错误发给 `options.report`（若提供）。
- 每次 `start()`/`restart()` 隐式开启新 generation；旧 generation 的迟到 settle 结果被静默丢弃（不写入 `state`/`value`/`error`）。
- `lifecycle` 是容器存活轴（`close()`/`dispose()` 驱动），与 `state`（装载轴）是两个独立读值。
- `dispose()` 永远同步——单元本身不持有需要等待的资源，只是终结内部 generation controller（超过一次调用幂等）。

### `createGenerationController`

```ts
function createGenerationController(options?: IGenerationControllerOptions): IGenerationController;

type IGenerationControllerOptions = {
  readonly parentSignal?: IAbortSignal;
  readonly onSuperseded?: (info: ILifecycleError) => void;
  readonly scheduler?: ILifecycleScheduler; // 默认 systemScheduler
};

type IGenerationToken = object;

type IGenerationRequest = {
  readonly generation: number;
  readonly token: IGenerationToken;
  readonly signal: IAbortSignal;
};

type IGenerationController = {
  readonly generation: number;
  readonly disposed: boolean;
  begin(options?: { readonly timeoutMs?: number }): IGenerationRequest;
  isCurrent(token: IGenerationToken): boolean;
  supersede(reason?: unknown): void;
  adopt<T>(
    token: IGenerationToken,
    value: T,
    release: (value: T) => void | PromiseLike<void>,
    onReleaseError?: (error: unknown) => void
  ): boolean;
  dispose(reason?: unknown): void;
};
```

代数 + 每代一个 `AbortSignal`，新一代自动使旧一代失效：

```ts
const generations = createGenerationController({ parentSignal: scope.closingSignal });
const request = generations.begin({ timeoutMs: 5000 }); // 超过 5s 自动 abort 当前代
const result = await fetchWithSignal(request.signal);
if (generations.adopt(request.token, result, (v) => v.close())) {
  use(result); // 仍是当前代，安全采用
} // 否则内部已调用 release() 回收 result，返回 false
```

边界行为：

- `begin(options?)`：使当前活跃代（若存在）立即失效（触发其 `signal` 中止），`generation` 自增，返回新的 `{ generation, token, signal }`。`options.timeoutMs?` 非法（非有限/负数）抛 `INVALID_OPTION`；超过该毫秒数后当前代的 `signal` 自动中止。控制器已 `dispose()` 后调用抛 `GENERATION_DISPOSED`。
- `isCurrent(token)`：`token` 是否仍是当前代；`dispose()` 之后恒为 `false`。
- `supersede(reason?)`：作废当前代（其 `signal` 中止）但控制器本身仍可用，之后 `begin()` 仍能开新代；对已 `dispose()` 的控制器调用是空操作。
- `adopt(token, value, release, onReleaseError?)`：`token` 仍是当前代时返回 `true`，`value` 留给调用方；否则调用 `release(value)` 回收并返回 `false`——`release` 本身抛出/reject 只会经 `onReleaseError` 上报，绝不反过来污染"当前是哪一代"这一状态（不会抛出、不会重新计入错误策略）。若提供了 `onSuperseded`，在过期路径上先额外触发一次携带 `GENERATION_SUPERSEDED` 码的诊断信息（非失败信号）。
- `dispose(reason?)`：终态；之后 `begin()` 恒抛 `GENERATION_DISPOSED`，`isCurrent()` 恒 `false`。
- `parentSignal` 中止时，当前活跃代同步中止（清理 timer、移除 parent listener、abort 自身 controller）；清理过程中任一步失败会聚合为 `GENERATION_CANCELLATION_FAILED`。

---

<a id="静默追踪与租约模块"></a>

## 静默追踪与租约模块

```ts
import {
  createQuiescenceTracker,
  createStringQuiescenceTracker,
  createObjectLeaseRegistry,
  createStringLeaseRegistry,
  createPendingTracker,
  type IQuiescenceTracker,
  type ILeaseRegistry,
  type IPendingTracker
} from '@migaia/lifecycle';
```

### `createQuiescenceTracker` / `createStringQuiescenceTracker`

```ts
function createQuiescenceTracker<TKey extends object>(): IQuiescenceTracker<TKey>;
function createStringQuiescenceTracker(): IQuiescenceTracker<string>;

type IQuiescenceTracker<TKey> = {
  retain(key: TKey): IDisposer; // IDisposer = () => void
  count(key: TKey): number;
  whenZero(key: TKey): Promise<void>; // 严格独占等待
  whenZeroOnce(key: TKey): Promise<void>; // 非独占等待
  seal(key: TKey): void;
  isSealed(key: TKey): boolean;
  forget(key: TKey): boolean;
};
```

按 key 计数的租约追踪：对象键用 `WeakMap`（自动 GC），字符串键用 `Map`（归零后自动清理未 seal 的条目）：

```ts
const tracker = createQuiescenceTracker<object>(); // 或 createStringQuiescenceTracker()
const release = tracker.retain(key);
tracker.count(key); // 1
tracker.seal(key); // 之后 retain(key) 抛 QUIESCENCE_SEALED
release();
await tracker.whenZero(key); // 必须先 seal，否则同步抛 QUIESCENCE_UNSEALED_WAIT
```

两者均无构造参数。边界行为：

- `retain(key)`：已 `seal(key)` 的 key 上调用抛 `QUIESCENCE_SEALED`；返回的释放函数重复调用幂等（只在首次调用时递减计数）。
- `whenZero(key)`：**必须先 `seal(key)`**，否则**同步**抛 `QUIESCENCE_UNSEALED_WAIT`（不是返回 rejected Promise）；已归零时立即 resolve。
- `whenZeroOnce(key)`：不要求 seal，随时可等待"下一次归零"，不阻塞新 `retain()`。
- `seal(key)`：幂等，标记该 key 之后拒绝新租约。
- `forget(key)`：仅当计数为 0 且没有任何等待者时才移除该 key 的状态并返回 `true`；否则返回 `false`。
- 一个未 seal 且归零的 key（字符串键）会被自动从底层 `Map` 中删除，避免长期驻留；已 `seal` 的 key 的"已 seal"事实会保留。

### `createObjectLeaseRegistry` / `createStringLeaseRegistry`

```ts
function createObjectLeaseRegistry<TKey extends object>(): ILeaseRegistry<TKey>;
function createStringLeaseRegistry(): ILeaseRegistry<string>;
// type ILeaseRegistry<TKey> = IQuiescenceTracker<TKey>
```

与上面完全同一引擎的别名（内部就是分别调用 `createQuiescenceTracker()`/`createStringQuiescenceTracker()`），供领域友好命名的调用点使用；无构造参数。

### `createPendingTracker`

```ts
function createPendingTracker(): IPendingTracker;

type IPendingTracker = {
  track<T>(promise: Promise<T>): Promise<T>;
  drain(): Promise<void>;
  readonly size: number;
};
```

只暴露 `track`/`drain`/`size` 的窄接口，用于追踪并排空在途 Promise（内部基于一个字符串键 `createStringQuiescenceTracker()`）：

```ts
const pending = createPendingTracker();
pending.track(doWork()); // 原样返回传入的 promise
await pending.drain(); // 等到 size 归零；排空期间新增的 track() 不会被漏计（内部循环 whenZeroOnce）
pending.size; // 当前在途数量
```

无构造参数。`track(promise)` 结算后（无论 resolve 还是 reject）自动释放内部租约；`drain()` 永不抛出（内部忽略释放函数自身的异常，`release` 本身也不会抛）；`drain()` 内部循环调用 `whenZeroOnce()`，因此排空期间新 `track()` 进来的 promise 也会被等到。

---

<a id="事务性所有权模块"></a>

## 事务性所有权模块

```ts
import {
  createProvisionalScope,
  type IProvisionalScope,
  type IProvisionalScopeOptions,
  type ILifecycleOwner
} from '@migaia/lifecycle';
```

### `createProvisionalScope`

```ts
function createProvisionalScope(options?: IProvisionalScopeOptions): IProvisionalScope;

type IProvisionalScopeOptions = { readonly parentSignal?: IAbortSignal };

type IProvisionalScope = {
  readonly signal: IAbortSignal;
  own<T>(resource: T, descriptor: IReleaseDescriptor): T;
  commitTo(parent: ILifecycleOwner): Promise<void>;
  rollback(): Promise<void>;
};

type ILifecycleOwner = { own<T>(resource: T, descriptor: IReleaseDescriptor): T };
```

构造期两阶段所有权：资源先暂存这里，最终要么 `commitTo(parent)` 转移给真正的 owner，要么 `rollback()` 释放，二选一、只能选一次：

```ts
const provisional = createProvisionalScope({ parentSignal: outerScope.closingSignal });
const db = provisional.own(await connect(), { force: (ctx) => db.close() });
try {
  await provisional.commitTo(outerScope); // 按注册顺序逐个 own() 到 parent
} catch (error) {
  // parent 中途拒绝（如已在 closing）：已转移部分留在 parent 名下，剩余部分已被自动释放并 await 完成
}
```

边界行为：

- `own(resource, descriptor)`：已 commit/rollback 后调用抛 `PROVISIONAL_SETTLED`。
- `commitTo(parent)`：按注册顺序逐个调用 `parent.own(resource, descriptor)`；某项失败时，已转移给 parent 的部分保留在 parent 名下，尚未转移的部分由本作用域**逆序释放并 await 完成**后才重新抛出原错误——不会有资源被两边都不持有，也不会有资源留给"none"；若失败原因是 `parent` 已处于 `closing`/`terminal`（错误码为 `SCOPE_CLOSED`/`SCOPE_TERMINAL`），额外包一层 `PROVISIONAL_PARENT_CLOSED`，原错误仍在 `cause`，遗留资源的释放失败列表挂在 `errors`。
- `rollback()`：逆序释放全部已注册资源，聚合失败为携带 `SCOPE_DISPOSAL_FAILED` 码的 `AggregateError`；幂等——并发/重复调用复用同一个 settle Promise。
- `commitTo`/`rollback` 二次调用（或 commit 后 rollback / rollback 后 commit）一律抛 `PROVISIONAL_SETTLED`（`rollback()` 以 rejected Promise 形式返回，不是同步抛出）。
- `parentSignal` 中止时（构造时已中止，或之后中止），`signal` 同步跟随中止，但不会自动触发 rollback/commit——仍需调用方显式二选一。

---

<a id="变更队列模块"></a>

## 变更队列模块

```ts
import {
  createMutationQueue,
  type IMutationQueue,
  type IMutationQueueOptions,
  type IEnqueueOptions
} from '@migaia/lifecycle';
```

### `createMutationQueue`

```ts
function createMutationQueue(options?: IMutationQueueOptions): IMutationQueue;

type IMutationQueueOptions = {
  readonly queueAdmissionTimeoutMs?: number | false; // 默认 undefined（只诊断，从不因排队超时而拒绝）
  readonly admissionDiagnosticMs?: number | false; // 默认 1000
  readonly onAdmissionDiagnostic?: (info: { owner: string | undefined; waitedMs: number }) => void;
  readonly scheduler?: ILifecycleScheduler; // 默认 systemScheduler
};

type IEnqueueOptions = {
  readonly owner?: string;
  readonly queueAdmissionTimeoutMs?: number | false; // 覆盖本次任务的队列默认值
};

type IMutationQueue = {
  enqueue<T>(task: () => T | PromiseLike<T>, options?: IEnqueueOptions): Promise<T>;
  readonly size: number;
};
```

严格 FIFO 串行队列，无并发池，带可选的入队 SLA 看门狗：

```ts
const queue = createMutationQueue({ queueAdmissionTimeoutMs: 5000 });
const result = await queue.enqueue(() => applyMutation(), { owner: 'sync-loop' });
queue.size; // 排队中 + 正在执行的任务数（0 或 1）
```

边界行为：

- `queueAdmissionTimeoutMs`：数字表示任务在队列中等待超过这个时长即被移出队列并以 `QUEUE_ADMISSION_TIMEOUT` reject；`undefined`（默认）只诊断、从不因排队超时而拒绝；`false` 连诊断计时器也不开。
- `admissionDiagnosticMs`：仅在 `queueAdmissionTimeoutMs` 为 `undefined` 且提供了 `onAdmissionDiagnostic` 时生效的诊断阈值；`false` 关闭诊断计时器。
- `owner`：用于自依赖检测——同一 `owner` 在自己**正在运行**时又向同一队列提交新任务，会立即以 `QUEUE_SELF_DEPENDENCY` reject（因为 FIFO 队列不可能在当前任务完成前跑新任务）。这是**部分**防护：正在运行的任务提交一个不同/无 `owner` 的任务并原地 `await` 它同样会死锁，但没有可靠信号能检测这种情况，因此不拦截；安全模式是提交后续任务而不在当前任务内 `await` 它。
- `size`：只读，等于排队数加运行中的 0/1。

---

<a id="调度器中止与有界等待模块"></a>

## 调度器、中止与有界等待模块

```ts
import {
  systemScheduler,
  createManualScheduler,
  snapshotScheduler,
  validateSchedulerDelay,
  validateSchedulerTime,
  createAbortController,
  boundedWait,
  createTerminalController,
  type ILifecycleScheduler,
  type IScheduledTask,
  type ISchedulerSnapshot,
  type IManualScheduler,
  type IAbortSignal,
  type IAbortController,
  type ITerminalController
} from '@migaia/lifecycle';
```

### `systemScheduler`

```ts
const systemScheduler: ILifecycleScheduler; // { now(): number; schedule(cb, delayMs): IScheduledTask }
```

默认调度器，`now()` 用 `performance.now()`、`schedule()` 用 `setTimeout`/`clearTimeout`，一般不用手动传，除非要换成 `createManualScheduler()`：

```ts
systemScheduler.now(); // 单调递增毫秒数
```

无配置，纯常量对象；宿主缺 `performance.now`/`setTimeout`/`clearTimeout` 时，首次调用对应方法才 fail-fast 抛 `ENV_UNSUPPORTED`。

### `createManualScheduler`

```ts
function createManualScheduler(): IManualScheduler;
// type IManualScheduler = ILifecycleScheduler & { advance(ms: number): void };
```

单测里把时间变成确定性的虚拟时钟：

```ts
const scheduler = createManualScheduler();
const task = scheduler.schedule(() => console.log('fired'), 100);
scheduler.advance(100); // 一次性 flush 所有到期回调（含到期回调内部再排的到期任务）
```

无入参。`advance(ms)` 按到期时刻升序（同刻按登记顺序）依次执行所有到期回调，单次循环超过 10000 个 flush 任务会抛 `INVALID_OPTION`（runaway guard）；`ms`/`schedule()` 的 `delayMs` 必须是有限非负数，否则抛 `INVALID_OPTION`（`RangeError`/`TypeError` 原生类型，贴该码）。

### `snapshotScheduler`

```ts
function snapshotScheduler(value: unknown): ISchedulerSnapshot | undefined;
```

把任意 duck-typed 值快照成标准 `ILifecycleScheduler`（校验并锁定 accessor，防止 hostile getter 二次读取）：

```ts
const snap = snapshotScheduler(candidate); // 不是合法 scheduler 时返回 undefined，而不是抛错
```

单参数 `value: unknown`，无选项；`now`/`schedule` 都不是函数时返回 `undefined`；读取 `now`/`schedule` 属性本身抛错时抛 `TypeError`（`INVALID_OPTION`）。

### `resolveScheduler` / `resolveSchedulerOption`

```ts
function resolveScheduler(value: unknown): ISchedulerSnapshot;
function resolveSchedulerOption(
  options: { readonly scheduler?: unknown } | null | undefined,
  fallback: ISchedulerSnapshot
): ISchedulerSnapshot;
function resolveSchedulerOption(
  options: { readonly scheduler?: unknown } | null | undefined
): ISchedulerSnapshot | undefined;
```

内部/自定义 scheduler 实现复用的边界解析函数：`resolveScheduler(value)` 对非法值抛 `SCHEDULER_INVALID` 文案的 `INVALID_OPTION` 错误（而不是像 `snapshotScheduler` 那样返回 `undefined`）；`resolveSchedulerOption(options, fallback?)` 读取 `options.scheduler`，未提供时返回 `fallback`（若调用形态未传 `fallback` 则返回 `undefined`），读取该属性本身抛错时抛 `TypeError`（`INVALID_OPTION`）。

### `validateSchedulerDelay` / `validateSchedulerTime`

```ts
function validateSchedulerTime(value: unknown, label: string): number;
function validateSchedulerDelay(value: unknown, label?: string): number; // label 默认 'delayMs'
```

本包内部用来校验时间值的公开工具，自定义 scheduler 实现也可复用：

```ts
validateSchedulerTime(value, 'deadlineAt'); // 非 number 抛 TypeError，非有限抛 RangeError
validateSchedulerDelay(value); // 在上面基础上还要求 >= 0，否则抛 RangeError
```

`validateSchedulerTime`：`label` 必填，仅用于错误信息里标注字段名；非 `number` 抛贴 `INVALID_OPTION` 码的 `TypeError`，非有限（`NaN`/`Infinity`）抛贴同码的 `RangeError`。`validateSchedulerDelay`：`label` 可选；在上面基础上额外要求 `>= 0`，否则抛 `RangeError`。两者校验通过时返回值本身。

### `createAbortController`

```ts
function createAbortController(): IAbortController;
// type IAbortSignal = { readonly aborted: boolean; readonly reason?: unknown; addEventListener(...); removeEventListener(...) };
// type IAbortController = { readonly signal: IAbortSignal; abort(reason?: unknown): void };
```

本包内部使用的极简 `AbortController`，不依赖全局 `AbortController`（结构上与 DOM/Node 的 `AbortSignal` 兼容，可互相传递）：

```ts
const controller = createAbortController();
controller.signal.addEventListener('abort', () => console.log('aborted'));
controller.abort('reason');
```

无构造参数。`abort(reason?)` 幂等；对已中止的信号再 `addEventListener` 不触发监听器（对齐 DOM 语义）；某个监听器抛错时，其余监听器仍会跑完，单个失败包成 `ABORT_LISTENER_FAILED` 抛出，多个失败聚合成同码的 `AggregateError`。

### `boundedWait`

```ts
function boundedWait(
  task: PromiseLike<unknown>,
  deadlineAt: number,
  options?: { readonly scheduler?: ILifecycleScheduler } // 默认 systemScheduler
): Promise<boolean>;
```

等到绝对截止时间为止，**从不取消**被等待的任务：

```ts
const won = await boundedWait(task, deadlineAt); // true=task 先完成；false=截止时间先到（task 仍在跑）
```

`task`、`deadlineAt` 均必填（`deadlineAt` 是绝对时刻，经 `validateSchedulerTime` 校验）。无论超时与否都会挂一个 `.catch()` 观察 `task`，避免它日后 reject 变成未处理拒绝；`deadlineAt` 已经过去时立即返回 `false`（仍会先观察 `task`）。

### `createTerminalController`

```ts
function createTerminalController(): ITerminalController;

type ITerminalController = {
  readonly lifecycle: 'open' | 'closing' | 'terminal';
  close(): void;
  forceTerminal(): void;
  whenTerminal(): Promise<void>;
};
```

独立复用的容器存活轴状态机，`createLifecycleScope`/`createSyncLifecycleScope`/`createLifecycleUnit` 内部都基于它：

```ts
const terminal = createTerminalController();
terminal.close(); // open → closing，幂等
terminal.forceTerminal(); // 直接进 terminal，resolve whenTerminal()
await terminal.whenTerminal();
```

无构造参数。`close()`：同步幂等，只在 `open` 时生效（`closing`/`terminal` 时空操作）。`forceTerminal()`：同步幂等，直接到 `terminal`（跳过 `closing`）。`whenTerminal()`：返回同一个 Promise，只在到达 `terminal` 时 resolve 一次；`terminal` 之前调用不会立即 resolve。

---

<a id="错误基础设施模块"></a>

## 错误基础设施模块

```ts
import {
  LIFECYCLE_SOURCE,
  createLifecycleError,
  createLifecycleRangeError,
  tagLifecycleError,
  containAsyncRejection,
  probeThenable,
  assimilateCapturedThen,
  createErrorCollector,
  type ILifecycleError,
  type IThenableProbe,
  type IErrorCollector
} from '@migaia/lifecycle';
```

### `LIFECYCLE_SOURCE`

```ts
const LIFECYCLE_SOURCE: '@migaia/lifecycle';
```

本包所有错误的 `source` 字段固定值，字符串常量，无调用。

### `createLifecycleError`

```ts
function createLifecycleError(
  code: string,
  message: string,
  options?: {
    readonly cause?: unknown;
    readonly phase?: string;
    readonly detail?: Readonly<Record<string, unknown>>;
    readonly errors?: readonly unknown[];
  }
): ILifecycleError; // Error & { source, code, phase?, detail?, cause?, errors? }
```

构造一个携带 `(source, code)` 身份的原生 `Error`，从不改写 `stack`：

```ts
throw createLifecycleError(LifecycleErrorCode.scopeClosed, '[lifecycle] scope is closing');
```

`code`、`message` 均必填（建议 `code` 取自 `LifecycleErrorCode`）。`options.errors` 非空时会冻结后挂到 `.errors`。

### `createLifecycleRangeError`

```ts
function createLifecycleRangeError(
  code: string,
  message: string,
  options?: { readonly cause?: unknown; readonly detail?: Readonly<Record<string, unknown>> }
): RangeError;
```

同上但产出原生 `RangeError`（保留原生类型，用于入参越界场景）：

```ts
throw createLifecycleRangeError(LifecycleErrorCode.invalidOption, 'delayMs must be >= 0');
```

`code`、`message` 均必填。

### `tagLifecycleError`

```ts
function tagLifecycleError<E extends Error>(error: E, code: string): E;
```

给一个已存在（非本包构造）的错误对象就地贴上 `(source, code)`，常用于给原生 `AggregateError` 打标：

```ts
tagLifecycleError(new AggregateError(errors, 'msg'), LifecycleErrorCode.scopeDisposalFailed);
```

`error`、`code` 均必填。返回同一个对象（原地修改，保留原生类型如 `AggregateError`）。

### `containAsyncRejection`

```ts
function containAsyncRejection(value: unknown, onRejected: (error: unknown) => void): void;
```

保护性地探测某个返回值是否是 thenable，是则观察其 rejection 而不让其变成未处理拒绝：

```ts
containAsyncRejection(maybeAsyncCallbackResult, (error) => report(error));
```

`value`、`onRejected` 均必填。非 thenable 时直接返回，不调用 `onRejected`；`onRejected` 自身抛错被吞掉（最后一道错误边界）。

### `probeThenable`

```ts
function probeThenable(value: unknown): IThenableProbe;

type IThenableProbe =
  | { readonly kind: 'not-thenable' }
  | { readonly kind: 'thenable'; readonly thenFn: (resolve: unknown, reject: unknown) => void }
  | { readonly kind: 'failed'; readonly error: unknown };
```

只读一次 `value.then`，返回判别结果（不是布尔值，是否 thenable/是否 getter 抛错都会区分）：

```ts
const probe = probeThenable(result);
if (probe.kind === 'thenable') {
  /* probe.thenFn 已捕获，可安全 apply 一次 */
}
```

单参数 `value: unknown`，无选项。三种结果：`'not-thenable'`（`null`/非对象非函数，或 `.then` 不是函数）、`'thenable'`（捕获到 `thenFn`）、`'failed'`（读 `.then` 本身抛错，`error` 是原始抛出物）。

### `assimilateCapturedThen`

```ts
function assimilateCapturedThen<T>(
  thenFn: (resolve: unknown, reject: unknown) => void,
  thenable: unknown
): Promise<T>;
```

把 `probeThenable` 捕获到的 `thenFn` 安全地 apply 成一个真正的 `Promise`，且只调用一次（内部用 `Reflect.apply` 保持 `this === thenable`）：

```ts
const promise = assimilateCapturedThen<T>(probe.thenFn, thenableValue);
```

`thenFn`（必填，须来自 `probeThenable` 的捕获结果）、`thenable`（必填，作为 `this` receiver 传给 `thenFn`）。无可选项。

### `createErrorCollector`

```ts
function createErrorCollector(
  policy: 'throw' | 'collect' | 'report' | 'firstError',
  report: ((error: unknown) => void) | undefined
): IErrorCollector;

type IErrorCollector = {
  readonly policy: IErrorPolicy;
  add(source: string, error: unknown): void;
  finalize(message: string): readonly ICollectedError[];
};
```

按四种错误策略收集/上报错误，`createDisposeTransaction`/`createSyncLifecycleScope` 内部都用它：

```ts
const collector = createErrorCollector('collect', undefined);
collector.add('item-1', error);
const collected = collector.finalize('teardown failed'); // 'collect' 策略下返回 ICollectedError[]
```

`policy`、`report`（必填，显式传 `undefined` 表示无诊断通道）。`add(source, error)` 按策略即时处理（`'report'` 策略立即调用 `report`；`'firstError'` 只记住第一个错误，其余经 `report` 观测）。`finalize(message)`：`'collect'` 返回收集到的数组；`'report'` 返回空数组（已在 `add` 时上报）；`'throw'` 单错原样抛、多错聚合成携带 `SCOPE_DISPOSAL_FAILED` 码的 `AggregateError`；`'firstError'` 有错误时抛首个，否则返回空数组。

---

<a id="状态常量模块"></a>

## 状态常量模块

```ts
import {
  LifecycleState,
  LifecycleUnitState,
  LifecycleErrorPolicy,
  ThenableProbeKind,
  DisposeTransactionKind
} from '@migaia/lifecycle';
```

均为纯常量对象（`as const`），无调用参数，用于替代裸字符串字面量做比较/`switch`。

| 常量                     | 取值                                                                                          | 语义                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `LifecycleState`         | `{ open: 'open', closing: 'closing', terminal: 'terminal' }`                                  | 容器存活轴                                                                                      |
| `LifecycleUnitState`     | `{ idle: 'idle', loading: 'loading', loaded: 'loaded', failed: 'failed' }`                    | 单元装载轴                                                                                      |
| `LifecycleErrorPolicy`   | `{ throw: 'throw', collect: 'collect', report: 'report', firstError: 'firstError' }`          | 释放错误策略；`firstError` 只为兼容 `web-rpc` discovery-registry 的迁移语义存在，不是通用默认值 |
| `ThenableProbeKind`      | `{ notThenable: 'not-thenable', thenable: 'thenable', failed: 'failed', promise: 'promise' }` | `probeThenable`/内部归化逻辑的判别结果                                                          |
| `DisposeTransactionKind` | `{ order: 'order', plan: 'plan' }`                                                            | `createDisposeTransaction` 的模式                                                               |

---

<a id="错误码"></a>

## 错误码

```ts
import { LifecycleErrorCode, type ILifecycleErrorCode } from '@migaia/lifecycle';
```

稳定错误码表，**21 个码**，唯一声明处 `src/error-code.ts`，`source` 恒为 `'@migaia/lifecycle'`：

```ts
if (error.code === LifecycleErrorCode.scopeClosed) {
  /* ... */
}
```

| `LifecycleErrorCode` 键        | 码值                             | 触发条件                                                                                                              |
| ------------------------------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `scopeClosed`                  | `SCOPE_CLOSED`                   | `close()` 之后调用 `own()`（异步/同步 scope）或某个 registry 的 `retain()`                                            |
| `scopeTerminal`                | `SCOPE_TERMINAL`                 | 容器已到达 `terminal` 之后，任何登记/激活操作                                                                         |
| `scopeReentrantDispose`        | `SCOPE_REENTRANT_DISPOSE`        | disposer 内部重入本 scope 的 `dispose()`                                                                              |
| `scopeReentrantOwn`            | `SCOPE_REENTRANT_OWN`            | disposer 内部调用本 scope 的 `own()`                                                                                  |
| `scopeSyncViolation`           | `SCOPE_SYNC_VIOLATION`           | `SyncLifecycleScope` 收到 `syncSafe !== true` 的 descriptor、收到一个异步 scope 实例作为资源、或某回调返回了 thenable |
| `scopeDisposalFailed`          | `SCOPE_DISPOSAL_FAILED`          | `throw` 错误策略在多个资源释放失败时的 `AggregateError` 聚合出口                                                      |
| `abortListenerFailed`          | `ABORT_LISTENER_FAILED`          | 一个或多个 abort listener 在同一取消派发中失败                                                                        |
| `unitStartFailed`              | `UNIT_START_FAILED`              | `LifecycleUnit.start()` 返回的 thenable 被 reject（单元进入 `failed`）                                                |
| `generationSuperseded`         | `GENERATION_SUPERSEDED`          | 一次异步操作的结果在 `adopt()` 提交点已被更晚的 generation 取代（非失败信号，仅诊断）                                 |
| `generationCancellationFailed` | `GENERATION_CANCELLATION_FAILED` | generation 取消期间的 timer、parent listener 或 signal cleanup 失败                                                   |
| `generationDisposed`           | `GENERATION_DISPOSED`            | 在已 `dispose()` 的 `GenerationController` 上调用 `begin()`                                                           |
| `quiescenceSealed`             | `QUIESCENCE_SEALED`              | `seal()` 之后又调用 `retain()`                                                                                        |
| `quiescenceUnsealedWait`       | `QUIESCENCE_UNSEALED_WAIT`       | 未先 `seal(key)` 就调用严格 `whenZero(key)`（同步抛出，非 rejected Promise）                                          |
| `provisionalSettled`           | `PROVISIONAL_SETTLED`            | 同一个 `ProvisionalScope` 二次 `commitTo()`/`rollback()`，或交叉调用                                                  |
| `provisionalParentClosed`      | `PROVISIONAL_PARENT_CLOSED`      | `commitTo()` 的目标 parent 已 `closing`/`terminal`，拒绝接收资源                                                      |
| `queueAdmissionTimeout`        | `QUEUE_ADMISSION_TIMEOUT`        | mutation 在队列中等待超过配置的 `queueAdmissionTimeoutMs`                                                             |
| `queueSelfDependency`          | `QUEUE_SELF_DEPENDENCY`          | 同一 `owner` 在自己尚未完成时又向同一队列提交新任务且被等待，会死锁                                                   |
| `releaseForceFailed`           | `RELEASE_FORCE_FAILED`           | descriptor 的 `force` 抛出/reject（契约要求 `force` 必须无条件成功）                                                  |
| `deadlineExceeded`             | `DEADLINE_EXCEEDED`              | 共享绝对 deadline 已过去，但仍有资源被要求进入新的 graceful 阶段（诊断码，正常降级路径不抛这个码）                    |
| `envUnsupported`               | `ENV_UNSUPPORTED`                | `systemScheduler` 依赖的宿主能力（`performance.now`/`setTimeout`/`clearTimeout`）缺失                                 |
| `invalidOption`                | `INVALID_OPTION`                 | scheduler 收到非法时间/延迟参数，或 descriptor 字段类型非法                                                           |

逐条设计动机见源码 `src/error-code.ts` 的 JSDoc；调用方应始终以 `error.code === LifecycleErrorCode.xxx` 判别，不要硬编码码值字符串。

---

<a id="诊断消息"></a>

## 诊断消息

```ts
import { LifecycleErrorText, type ILifecycleErrorText } from '@migaia/lifecycle';
```

稳定诊断消息表（本包内部错误信息的唯一声明处，公开是为了让调用方按文本断言/比对）：

```ts
error.message === LifecycleErrorText.disposeTransactionFailed;
```

全部键：`abortListenerDispatchFailed`、`provisionalCleanupFailed`、`disposeTransactionFailed`、`disposeDescriptorInvalid`、`mutationAdmissionTimedOut`、`generationCancellationFailed`、`schedulerTaskCancelGetterFailed`、`schedulerTaskInvalid`、`schedulerAccessorFailed`、`schedulerInvalid`、`schedulerNumberType`、`schedulerNumberRange`、`schedulerDelayRange`、`schedulerTimeOverflow`、`generationTimeoutAccessorFailed`。每个键对应的文本值与语义见源码 `src/error-text.ts`。

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. 作用域 + 代数：请求场景下取代过期结果

```ts
import { createLifecycleScope, createGenerationController } from '@migaia/lifecycle';

const scope = createLifecycleScope({ errorPolicy: 'collect' });
const generations = createGenerationController();

async function loadUser(id: string) {
  const request = generations.begin({ timeoutMs: 5000 });
  const user = await fetchUser(id, { signal: request.signal });
  if (!generations.adopt(request.token, user, (u) => u.dispose?.())) return; // 已过期，静默丢弃
  scope.own(user, { force: () => user.dispose?.() });
}
```

### 2. 事务性所有权：构造期失败自动回滚，成功后转移给长期 scope

```ts
import { createLifecycleScope, createProvisionalScope } from '@migaia/lifecycle';

const rootScope = createLifecycleScope();

async function setupModule() {
  const provisional = createProvisionalScope({ parentSignal: rootScope.closingSignal });
  try {
    const db = provisional.own(await connectDb(), { force: (ctx) => closeDb(db) });
    const cache = provisional.own(await connectCache(), { force: (ctx) => closeCache(cache) });
    await provisional.commitTo(rootScope); // 全部转移给 rootScope，之后随 rootScope.dispose() 释放
  } catch (error) {
    await provisional.rollback(); // 任一步失败：已注册的资源逆序释放，冒泡原错误
    throw error;
  }
}
```

### 3. 静默追踪 + 变更队列：确保排空后才提交下一批变更

```ts
import { createPendingTracker, createMutationQueue } from '@migaia/lifecycle';

const pending = createPendingTracker();
const queue = createMutationQueue({ queueAdmissionTimeoutMs: 3000 });

async function applyBatch(mutations: Array<() => Promise<void>>) {
  for (const mutation of mutations) {
    pending.track(queue.enqueue(mutation, { owner: 'batch' }));
  }
  await pending.drain(); // 等到本批（含批内动态追加的）全部落地
}
```

### 4. 释放事务 + 有界等待：手动编排一组资源的优雅关闭

```ts
import {
  createDisposeTransaction,
  createManualScheduler,
  type IDisposeItem
} from '@migaia/lifecycle';

const scheduler = createManualScheduler();
const items: IDisposeItem[] = [
  {
    source: 'socket',
    descriptor: {
      order: 10,
      graceful: (ctx) => flushSocket(),
      gracefulTimeoutMs: 100,
      force: () => forceCloseSocket()
    }
  },
  { source: 'db', descriptor: { order: 5, force: () => closeDb() } }
];
const transaction = createDisposeTransaction(
  { kind: 'order' },
  { errorPolicy: 'collect', scheduler }
);
const runPromise = transaction.run(items);
scheduler.advance(100); // 驱动 socket 的 graceful 超时降级到 force
const failures = await runPromise;
```

### 5. 同步作用域：可暴露 `using` 语法的纯同步资源

```ts
import { createSyncLifecycleScope } from '@migaia/lifecycle';

function withListeners() {
  using scope = createSyncLifecycleScope(); // 环境支持 `[Symbol.dispose]` 时可用 `using`
  const handler = () => console.log('tick');
  window.addEventListener('tick', handler);
  scope.own(handler, { syncSafe: true, force: () => window.removeEventListener('tick', handler) });
  // 作用域结束时自动 dispose()，移除监听器
}
```

---

<a id="排查与构建门禁"></a>

## 排查与构建门禁

- **`own()` 抛 `SCOPE_CLOSED`/`SCOPE_TERMINAL`**：容器已进入 `closing`/`terminal`，不接受新登记；应新建 scope，而不是复用已关闭的实例。
- **`own()`/`dispose()` 抛 `SCOPE_REENTRANT_OWN`/`SCOPE_REENTRANT_DISPOSE`**：disposer 回调内部直接调用了正在释放它的那个 scope 的 `own()`/`dispose()`；把这类逻辑挪到 disposer 之外，或改由外层协调。
- **`SyncLifecycleScope.own()` 抛 `SCOPE_SYNC_VIOLATION`**：descriptor 缺少 `syncSafe: true`，或某回调返回了 thenable，或试图 own 一个异步 `LifecycleScope`/`ProvisionalScope` 实例；同步作用域绝不 await，把异步资源迁到 `createLifecycleScope()`。
- **`whenZero(key)` 同步抛 `QUIESCENCE_UNSEALED_WAIT`**：忘记先 `seal(key)`；严格归零等待要求先切断新租约来源，改用 `whenZeroOnce()` 可跳过这一要求（但语义变为非独占）。
- **`GenerationController.begin()` 抛 `GENERATION_DISPOSED`**：控制器已 `dispose()`，不可复用，需新建一个。
- **`commitTo()` 抛 `PROVISIONAL_PARENT_CLOSED`**：目标 parent 已进入 `closing`/`terminal`；已转移的资源留在 parent 名下，未转移的部分已被自动释放，不需要再手动 `rollback()`。
- **`enqueue()` 抛 `QUEUE_SELF_DEPENDENCY`**：同一 `owner` 在自身运行期间又提交并同步等待了新任务，FIFO 队列必然死锁；拆分成两次独立的顶层调用。
- **`systemScheduler` 抛 `ENV_UNSUPPORTED`**：宿主缺 `performance.now`/`setTimeout`/`clearTimeout`；注入自实现的 `ILifecycleScheduler`，或改在具备这些能力的运行时里运行。
- **需要事件总线/当前值订阅/依赖图拓扑**：`@migaia/lifecycle` 刻意不提供，应分别参考 `@migaia/event-subscriber`、`@migaia/reactive`、`@migaia/capability/graph`。

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```

验收矩阵（L-T1 ~ L-T44）见 `docs/lifecycle/lifecycle-extraction.sdd.md` §5.4；每个 `L-T` 编号都能在 `test/` 下检索到对应用例。
