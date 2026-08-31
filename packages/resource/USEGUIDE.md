# `@migaia/resource` 使用指南

本指南逐项列出 `Resource<T>` 全部公开 API 的签名、边界行为与错误码。包的定位、适用场景与五分钟上手见 [README](./README.md)。包只公开根入口 `@migaia/resource`，没有稳定深层子路径。

## 目录

- [`Resource<T>`](#resource)：构造函数、状态读取、操作方法、快照方法
- [配置项 `IResourceOptions`](#配置项)
- [状态类型](#状态类型)：`IResourceState`、`ResourceStatus`、`IResourceFetchStatus`
- [`IResourceFetcher` 与依赖追踪](#fetcher-与依赖追踪)
- [快照类型 `IResourceCacheSnapshot`](#快照类型)
- [底层依赖：lifecycle 原语的使用方式](#底层依赖)
- [错误码](#错误码)：`ResourceErrorCode`（8 个码）逐条语义
- [高阶组合示例](#高阶组合示例)
- [排查与构建门禁](#排查与构建门禁)

---

<a id="resource"></a>

## `Resource<T>`

```ts
import { Resource, type IResourceOptions } from '@migaia/resource';
import type { IRuntime } from '@migaia/reactive';

class Resource<T> implements IObserver, IDisposable {
  constructor(fetcher: IResourceFetcher<T>, runtime: IRuntime, options?: IResourceOptions<T>);

  readonly runtime: IRuntime;
  debugName?: string;
  readonly deps: ReadonlySet<IObservable>;
  readonly depVersions: ReadonlyMap<IObservable, number>;

  readonly state: IResourceState<T>;
  readonly promise: Promise<T>;
  readonly disposed: boolean;
  readonly refreshing: boolean;
  readonly fetchStatus: IResourceFetchStatus;
  readonly isStale: boolean;
  readonly observed: boolean;

  read(): T;
  peek(): T;
  refetch(): Promise<T>;
  invalidate(): Promise<T>;
  cancel(): void;
  dehydrate(): IResourceCacheSnapshot<T> | undefined;
  hydrate(snapshot: IResourceCacheSnapshot<T>): void;
  dispose(): void;

  // IObserver 接口成员：由 @migaia/reactive 的依赖图在内部调用，一般不需要手动调用
  markDirty(): void;
  onDependencyDisconnected(): void;
}
```

响应式的可取消异步资源：构造时给一个 `fetcher`，它跟踪 `fetcher` 在**首次 `await` 之前**同步读取的响应式值作为依赖；依赖变化时自动发起新请求，只有最新一代请求的结果才会生效。

```ts
import { Resource, ResourceStatus } from '@migaia/resource';
import { createRuntime } from '@migaia/reactive';
import { fetchUser } from './user-api.js';

const runtime = createRuntime();
const userId = runtime.signal('1');

const user = new Resource(
  ({ signal }) => {
    const id = userId.value;
    return fetchUser(id, { signal });
  },
  runtime,
  { ttl: 30_000, staleWhileRevalidate: true, retry: 2 }
);

const stopRendering = runtime.effect(() => {
  const state = user.state;
  if (state.status === ResourceStatus.pending) console.log('loading user');
  if (state.status === ResourceStatus.success) console.log('render', state.data);
});

userId.value = '2';

export function disposeUserPanel(): void {
  stopRendering();
  user.dispose();
  userId.dispose();
}
```

动态关系是 `userId → Resource → rendering effect`：fetcher 在返回 Promise 前同步读取 `userId.value`，Runtime 因而把 Resource 登记为 `userId` 的 observer；Effect 读取 `user.state`，又成为 Resource 内部状态 Signal 的 observer。`userId` 写入经 Reactive 的 idle/microtask 通道使 Resource 标脏，Resource abort 旧 generation、创建新 generation，状态变化再驱动 Effect 重跑。旧请求即使忽略 abort 并延迟返回，也会被 generation 校验拒绝写回。首次 `await` 之后的响应式读取不在同步追踪窗口内，不会形成这条自动刷新链。

### 构造函数

`new Resource(fetcher, runtime, options?)`：

- `fetcher: IResourceFetcher<T>`（必填）—— `({ signal }) => T | PromiseLike<T>`。
- `runtime: IRuntime`（必填）—— 来自 `@migaia/reactive` 的 `createRuntime()`/`defaultRuntime`；决定该 `Resource` 归属哪张依赖图。
- `options?: IResourceOptions<T>`（可选，见[配置项](#配置项)）。
- 全部选项在构造时**一次性快照并校验**（读取每个字段本身失败——hostile getter——都会被转换成贴 `INVALID_OPTION` 码的 `TypeError`，而不是让异常从任意后续调用点冒出）。
- 若提供了 `initialSnapshot`，构造期会先 `hydrate()` 它；随后若 `autoStart`（默认 `true`）为真且（没有初始快照，或初始快照已过期），立即发起首次请求。

### 状态读取（getter）

- `state: IResourceState<T>` —— 响应式状态机快照（读取会建立依赖，并顺带触发 `#ensureFresh()`：过期的 `success` 值或 `idle` 状态会自动发起新请求）。已释放时抛 `RESOURCE_DISPOSED`。
- `promise: Promise<T>` —— 当前请求或最新缓存值对应的共享 Promise；多个读取者拿到同一个 Promise，只在 `idle`/过期时才真正启动工作。没有可返回的 Promise（内部状态机异常）时抛 `NO_ACTIVE_PROMISE`。
- `disposed: boolean` —— 是否已 `dispose()`；这是唯一在已释放后仍可安全读取、不抛错的成员。
- `refreshing: boolean` —— 是否正在后台刷新（`staleWhileRevalidate: true` 且当前展示的仍是旧成功值时为真）；已释放时返回 `false`（不抛错）。
- `fetchStatus: IResourceFetchStatus` —— 传输层状态，独立于可见的 data/error：`'fetching'` 或 `'idle'`。
- `isStale: boolean` —— 当前缓存的成功值是否已超过 TTL；非 `success` 状态恒为 `false`。
- `observed: boolean` —— 是否有响应式消费者正在观察本资源的 `state`。

### `read()` / `peek()`

```ts
read(): T; // Suspense 兼容：success 返回值，pending 抛 Promise，error/cancelled 抛错误
peek(): T; // 与 read() 形状相同，但不建立依赖边，也不触发 ensureFresh()
```

`read()` 按 React Suspense 期望的形状工作：成功返回缓存数据；`pending`/`idle` 抛出当前 `promise`；`error`/`cancelled` 抛出对应的错误对象。`peek()` 是它的非追踪版本，用于 `getSnapshot` 一类"读当前快照但不想加入别人追踪窗口"的场景，且不会顺手启动请求。

### `refetch()` / `invalidate()`

```ts
refetch(): Promise<T>;    // 总是发起新请求，不复用新鲜缓存
invalidate(): Promise<T>; // 立即使缓存过期（expiresAt = 0）并发起新请求
```

被动读取（`state`/`promise`/`read()`）只在过期或 `idle` 时才发起请求；想强制刷新必须显式调用 `refetch()` 或 `invalidate()`。

### `cancel()`

```ts
cancel(): void;
```

只中止**当前活跃的一代**请求，资源本身仍可复用（下次读取/`refetch()` 会正常发起新请求）。`pending` 状态下取消会把状态落到 `cancelled`（携带 `name === 'AbortError'` 的 `DOMException`，贴 `REQUEST_CANCELLED` 码）；`staleWhileRevalidate` 后台刷新被取消时会回退展示原有的 `success` 数据（清除 `refreshing` 标记，不会遗留"正在刷新但没有实际请求"的不一致状态）。取消期间的清理（timer/listener）若失败，会以贴 `CANCELLATION_CLEANUP_FAILED` 码的错误抛出（不影响状态已经收敛这一事实）。

### `dehydrate()` / `hydrate()`

```ts
dehydrate(): IResourceCacheSnapshot<T> | undefined;
hydrate(snapshot: IResourceCacheSnapshot<T>): void;
```

`dehydrate()`：当前状态非 `success` 时返回 `undefined`；否则返回 JSON 安全的快照（`expiresAt` 为 `Infinity` 时序列化为 `null`）。

`hydrate(snapshot)`：把快照原样恢复为一个 `success` 状态，不发起请求；会先作废当前活跃的请求代（`supersede()`）并清空依赖登记。快照结构非法（`version !== 1`，或 `updatedAt`/`expiresAt` 不是有限数字）抛 `INVALID_SNAPSHOT`——读取快照字段本身失败（hostile getter）时错误的 `cause` 挂原始异常。

### `dispose()`

```ts
dispose(): void;
```

彻底终结资源：中止在途请求（`GenerationController.dispose()`）、清理依赖登记、释放内部状态 `Signal`。幂等——二次调用是空操作。清理过程中若某一步失败，第一个失败原样抛出，后续失败的错误挂在其 `.errors` 数组上（不会因为一步失败就跳过其余清理步骤）。释放之后调用任何其它方法（除 `disposed` 本身）一律抛 `RESOURCE_DISPOSED`。

---

<a id="配置项"></a>

## 配置项 `IResourceOptions`

```ts
type IResourceOptions<T = unknown> = {
  debugName?: string;
  ttl?: number; // 默认 Infinity（永不过期，除非依赖变化/手动刷新）
  autoStart?: boolean; // 默认 true
  staleWhileRevalidate?: boolean; // 默认 false
  retry?: IResourceRetryPolicy; // 默认 0（不重试）
  retryDelay?: number | ((failureCount: number, error: unknown) => number); // 默认 0
  keepAlive?: boolean; // 默认 false
  initialSnapshot?: IResourceCacheSnapshot<T>;
  scheduler?: ILifecycleScheduler; // 默认 @migaia/lifecycle 的 systemScheduler
};

type IResourceRetryPolicy = number | ((failureCount: number, error: unknown) => boolean);
```

逐项语义与校验：

- `ttl?: number` —— 成功值的新鲜时长（毫秒）。`Infinity`（默认）表示永不因时间过期，只会因依赖变化/`refetch()`/`invalidate()` 而刷新。非 `Infinity` 时必须是有限非负数，否则抛贴 `INVALID_OPTION` 码的 `RangeError`；`updatedAt + ttl` 运算结果非有限（数值溢出）同样抛 `INVALID_OPTION`。
- `autoStart?: boolean` —— 是否在构造函数内立即发起首次请求。默认 `true`。若同时提供了新鲜的 `initialSnapshot`，即使 `autoStart: true` 也不会立即再发一次请求。
- `staleWhileRevalidate?: boolean` —— 默认 `false`。为 `true` 时，刷新期间继续展示旧的 `success` 数据（附带 `refreshing: true`），而不是回退到 `pending`。
- `retry?: number | (failureCount, error) => boolean` —— 固定次数或自定义判断函数。数字必须是非负整数，否则抛 `INVALID_OPTION`。函数形式在每次失败后被调用一次，用第几次失败（从 1 开始）与错误对象决定是否重试；**Suspense 抛出的 thenable 值不计入失败次数**（`fetcher` 内部同步抛出一个 thenable 是被当作"需要等待后重跑"处理的，不是一次真实失败）。
- `retryDelay?: number | (failureCount, error) => number` —— 固定延迟或按失败次数计算的函数，单位毫秒。数字必须是有限非负数；函数返回值同样必须是有限非负数，否则以贴 `INVALID_OPTION` 码的 `RangeError` reject 当次重试的 Promise。
- `keepAlive?: boolean` —— 默认 `false`：长时间无人观察 `state` 会在下一个 idle 时机自动休眠（断开依赖登记、令缓存过期），下次被观察时重新发起请求。设为 `true` 时禁用自动休眠。
- `initialSnapshot?: IResourceCacheSnapshot<T>` —— SSR/持久化恢复用的初始成功快照；构造期即 `hydrate()`，格式非法抛 `INVALID_SNAPSHOT`（详见[快照类型](#快照类型)）。
- `scheduler?: ILifecycleScheduler` —— 时间域与排程来源：TTL/`updatedAt`/`expiresAt`/重试延迟全部走同一个调度器，默认 `@migaia/lifecycle` 的 `systemScheduler`。传入的值必须满足 `{ now(): number; schedule(cb, delayMs): IScheduledTask }` 契约（内部用 `snapshotScheduler` 校验），否则抛 `INVALID_OPTION`；缺宿主能力时该 scheduler 在被调用时才 fail-fast，不会静默降级成微任务。

---

<a id="状态类型"></a>

## 状态类型

```ts
type IResourceState<T> =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'success'; data: T; refreshing?: boolean }
  | { status: 'error'; error: unknown }
  | { status: 'cancelled'; error: DOMException };

const ResourceStatus: {
  idle: 'idle';
  pending: 'pending';
  success: 'success';
  error: 'error';
  cancelled: 'cancelled';
  fetching: 'fetching';
};

type IResourceFetchStatus = 'idle' | 'fetching';
```

`IResourceState<T>` 是 `state`/`peek()` 底层的判别联合，五态：`idle`（尚未发起过请求）、`pending`（请求在途，无历史数据）、`success`（`data` 为最新成功值，`refreshing` 仅在 `staleWhileRevalidate` 后台刷新时为 `true`）、`error`（`error` 为最近一次失败原因）、`cancelled`（`error` 恒为 `name === 'AbortError'` 的 `DOMException`，`code === ResourceErrorCode.requestCancelled`）。`ResourceStatus` 常量还额外包含一个第六值 `fetching`，只用于 `fetchStatus`（传输层状态），不会出现在 `IResourceState.status` 里。

---

<a id="fetcher-与依赖追踪"></a>

## `IResourceFetcher` 与依赖追踪

```ts
type IResourceFetcher<T> = (ctx: { signal: IAbortSignal }) => T | PromiseLike<T>;
```

`fetcher` 在**首次 `await` 之前**同步读取的响应式值（`Signal`/`Computed`，包括异步函数在首个 `await` 之前的同步代码）会被登记为依赖，依赖变化时合并触发一次新请求（同一批变化只重新拉取一次）。`await` 之后再读响应式值**不会**被自动追踪——JavaScript 的同步依赖收集上下文在 `await` 处已经退出；需要的话应把这部分读取挪进一个 `Computed`，或在 `await` 之前先读入局部变量。

`fetcher` **必须**把 `ctx.signal` 转交给真正可取消的 I/O（如 `fetch(url, { signal })`），否则 `cancel()`/依赖变化引发的取消只是让 `Resource` 忽略这次结果，底层请求仍会在后台跑完（浪费网络资源、可能产生未观察的副作用）。

`fetcher` 同步抛出的值若探测为 thenable（Suspense 常见模式：抛出一个 Promise 让上层挂起），会被当作"等待后重跑"处理，不计入重试次数；探测其 `.then` 时若 getter 本身抛错，无法判定是否为 thenable，会以携带 `SUSPENSE_PROBE_FAILED` 码的 `AggregateError` reject（原始抛出值与 getter 异常都保留在 `.errors` 里）。

---

<a id="快照类型"></a>

## 快照类型 `IResourceCacheSnapshot`

```ts
type IResourceCacheSnapshot<T> = {
  readonly version: 1;
  readonly data: T;
  readonly updatedAt: number;
  readonly expiresAt: number | null; // null 表示无限生命周期的 JSON 安全形式
};
```

`dehydrate()`/`hydrate()`/`initialSnapshot` 共用的 JSON 安全快照结构。`version` 恒为 `1`（预留未来格式演进）；`expiresAt` 为 `null` 对应内部的 `Infinity`（`ttl: Infinity` 场景）。`hydrate()`/构造期 `initialSnapshot` 校验：`version !== 1`，或 `updatedAt`/非 `null` 的 `expiresAt` 不是有限数字，一律抛 `INVALID_SNAPSHOT`。

---

<a id="底层依赖"></a>

## 底层依赖：lifecycle 原语的使用方式

`Resource` 内部直接组合 `@migaia/lifecycle` 与 `@migaia/reactive` 的原语，理解这层有助于诊断边界行为：

- **`createGenerationController()`**（来自 `@migaia/lifecycle`）——每次 `#startRequest()` 调用 `begin()` 开一代新请求；`refetch()`/`invalidate()`/依赖变化都会使旧一代失效（`supersede()`），只有 `isCurrent(token)` 为真的那一代结果才会写回 `#stateSignal`。`dispose()` 时调用其 `dispose()` 终结控制器。
- **`createTerminalController()`**（来自 `@migaia/lifecycle`）——驱动 `Resource` 自身的容器存活轴（`open → closing → terminal`）；`disposed` getter 直接读它的 `lifecycle === 'terminal'`。
- **`probeThenable()` / `assimilateCapturedThen()`**（来自 `@migaia/lifecycle`）——用于安全探测 `fetcher` 同步抛出的值是否是 thenable（Suspense 抛 Promise 模式），只读一次 `.then`，避免 hostile getter 被读取两次或异常被吞掉。
- **`systemScheduler` / `snapshotScheduler()`**（来自 `@migaia/lifecycle`）——`scheduler` 选项的默认值与校验函数；TTL 到期判定、重试延迟计时都通过它，不直接使用宿主 `setTimeout`/`Date.now`。
- **`internalRuntimeOf()` / `internalsOf()` / `claimOwnership()` / `registerDeps()` / `registerDepVersions()`**（来自 `@migaia/reactive` 的 `/node-factories`、`/internals`、`/ownership`、`/node-internals` 子路径）——`Resource` 把自己注册为 `@migaia/reactive` 依赖图里的一个 `IObserver`（实现 `markDirty()`/`onDependencyDisconnected()`），复用其依赖追踪、所有权登记与 `deferIdle` 挂起通道，语义与 `Computed` 的自动挂起完全对称。

---

<a id="错误码"></a>

## 错误码

```ts
import { RESOURCE_SOURCE, ResourceErrorCode, type IResourceErrorCode } from '@migaia/resource';
```

稳定错误码表，**8 个码**，唯一声明处 `src/error-code.ts`，`source` 恒为 `'@migaia/resource'`。
`RESOURCE_SOURCE` 导出这个稳定 source，跨包分类错误时应比较它与 `ResourceErrorCode`，不要复制字符串字面量。

| `ResourceErrorCode` 键      | 码值                          | 触发条件                                                                                                                                        |
| --------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `resourceDisposed`          | `RESOURCE_DISPOSED`           | 在已 `dispose()` 的 `Resource` 上调用任意读取/操作方法                                                                                          |
| `requestAborted`            | `REQUEST_ABORTED`             | 请求被 `fetcher` 收到的 `signal` 中止、或内部转发给调用方的 `DOMException`（保持原生 `DOMException('...', 'AbortError')` 类型，码只是附加字段） |
| `requestCancelled`          | `REQUEST_CANCELLED`           | 调用方显式 `cancel()` 导致当前 pending 请求被取消，`state` 落入 `cancelled` 所携带的 `DOMException`                                             |
| `cancellationCleanupFailed` | `CANCELLATION_CLEANUP_FAILED` | 请求取消已完成状态收敛，但取消期间的 timer/listener cleanup 失败                                                                                |
| `noActivePromise`           | `NO_ACTIVE_PROMISE`           | 读取 `promise`，或 `pending`/`idle` 状态下内部 `#materialize()` 时，没有一个正在进行或已缓存的 Promise 可返回                                   |
| `invalidSnapshot`           | `INVALID_SNAPSHOT`            | `hydrate()`/`initialSnapshot` 收到的快照 `version` 不是 `1`，或 `updatedAt`/`expiresAt` 不是有限数字                                            |
| `invalidOption`             | `INVALID_OPTION`              | 构造/调用时传入的选项（`ttl`、`retry`、`retryDelay`、`scheduler` 等）不满足取值要求                                                             |
| `suspenseProbeFailed`       | `SUSPENSE_PROBE_FAILED`       | `fetcher` 抛出用于 Suspense 的值，但探测其 `.then` 时 getter 本身抛错，无法判定是否为 thenable                                                  |

`requestAborted`/`requestCancelled` 抛出/落入状态的值始终是原生 `DOMException`（`name === 'AbortError'`），调用方通常按 `error.name === 'AbortError'` 判定并静默处理，而不是当作真实失败；`code` 只作为附加字段挂上，不改变类型。调用方应始终以 `error.code === ResourceErrorCode.xxx` 判别，不要硬编码码值字符串。

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. Suspense 兼容读取 + Error Boundary

```tsx
function UserProfile({ resource }: { resource: Resource<User> }) {
  const user = resource.read(); // pending 抛 Promise（被 Suspense 捕获），error 抛错误（被 Error Boundary 捕获）
  return <div>{user.name}</div>;
}
```

### 2. SSR 快照恢复，客户端不重新请求

```ts
// 服务端：
const snapshot = userResource.dehydrate(); // undefined 或 { version: 1, data, updatedAt, expiresAt }
// 序列化 snapshot 注入 HTML

// 客户端：
const userResource = new Resource(fetchUser, runtime, {
  initialSnapshot: snapshot, // 有值且未过期时不会重新发起请求
  ttl: 30_000
});
```

### 3. 后台刷新且展示旧数据

```ts
const list = new Resource(fetchList, runtime, {
  ttl: 10_000,
  staleWhileRevalidate: true
});

// list.state.status === 'success' 时，即使正在后台刷新，
// list.state.data 仍是旧数据，list.refreshing === true 可用来展示"刷新中"角标
```

### 4. 自定义重试退避

```ts
const resource = new Resource(fetchWithFlakyBackend, runtime, {
  retry: (failureCount, error) => failureCount < 5 && !(error instanceof TypeError),
  retryDelay: (failureCount) => Math.min(1000 * 2 ** failureCount, 30_000) // 指数退避，封顶 30s
});
```

### 5. 手动失效 + 取消

```ts
await resource.invalidate(); // 立即视为过期并重新请求
resource.cancel(); // 只中止当前请求，资源仍可复用；下次读取会重新发起
```

---

<a id="排查与构建门禁"></a>

## 排查与构建门禁

- **依赖变了但没有自动重新请求**：检查响应式读取是否发生在 `fetcher` 的**首次 `await` 之前**；`await` 之后的读取不会被追踪，应挪进 `Computed` 或提前读入局部变量。
- **`cancel()`/依赖变化后底层请求似乎仍在跑**：`fetcher` 没有把 `ctx.signal` 转交给真正可取消的 I/O；`cancel()` 只是让 `Resource` 忽略这次结果，不会代为中止未接收 `signal` 的请求。
- **重复读 `state`/`promise` 却拿不到最新数据**：被动读取只在过期或 `idle` 时才发起请求，重复读不会强制刷新；需要强制刷新用 `refetch()` 或 `invalidate()`。
- **读取抛 `RESOURCE_DISPOSED`**：`Resource` 已被 `dispose()`；停止持有该引用，创建新的 `Resource` 实例。
- **读取抛 `NO_ACTIVE_PROMISE`**：状态机进入了不一致的中间态，通常意味着绕过了 `refetch()`/`invalidate()`/正常构造流程直接摆弄内部状态；检查调用路径。
- **`hydrate()`/`initialSnapshot` 抛 `INVALID_SNAPSHOT`**：快照通常来自 SSR 序列化或持久化存储，格式漂移应在装载时就失败；检查快照的产出/序列化路径，确认 `version === 1` 且 `updatedAt`/`expiresAt` 是有限数字。
- **长时间不用后再次读取，依赖似乎"断了"重新算了一遍**：`keepAlive` 默认 `false`，无人观察时会自动休眠（清依赖、令缓存过期）；需要"没人看也保持热数据"时显式传 `keepAlive: true`。
- **`fetcher` 里的 Suspense 抛出没有被正确识别**：若抛出值的 `.then` getter 本身抛错，会得到 `SUSPENSE_PROBE_FAILED` 而不是被当作普通 fetch 失败静默重试；检查该值为什么带有会抛错的 hostile getter。

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```
