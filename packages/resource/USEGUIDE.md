# 使用手册

本文是 `@migaia/resource` 的完整参考手册。先看 [README.md](./README.md#4-五分钟上手) 的五分钟上手示例，跑起来之后再回来查这里的细节——README 讲"是什么、适合什么场景、5 分钟怎么跑起来"，本文讲"每一个配置项、每一个 API 的精确语义、每一种边界与异常行为"。

## 目录

1. [核心概念详解](#1-核心概念详解)
2. [构造参考](#2-构造参考)
3. [Resource API 完整参考](#3-resource-api-完整参考)
4. [依赖追踪与自动刷新](#4-依赖追踪与自动刷新)
5. [取消、暂停与自动休眠](#5-取消暂停与自动休眠)
6. [staleWhileRevalidate 与后台刷新](#6-stalewhilerevalidate-与后台刷新)
7. [重试策略](#7-重试策略)
8. [SSR / 持久化快照](#8-ssr-持久化快照)
9. [错误与异常完整参考](#9-错误与异常完整参考)
10. [生命周期与 dispose](#10-生命周期与-dispose)
11. [完整场景示例](#11-完整场景示例)
12. [常见问题排查](#12-常见问题排查)

---

## 1. 核心概念详解

### 1.1 State：状态机

`resource.state` 返回下面五种形状之一（`IResourceState<T>`）：

```ts
type IResourceState<T> =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'success'; data: T; refreshing?: boolean }
  | { status: 'error'; error: unknown }
  | { status: 'cancelled'; error: DOMException };
```

- `idle`：从未发起过请求（例如 `autoStart: false` 且尚未 `refetch()`）。
- `pending`：请求进行中且当前没有可展示的旧数据。
- `success`：`data` 是本次成功的值；`refreshing: true` 表示背后正在跑一次 `staleWhileRevalidate` 后台刷新，`data` 仍是刷新前的旧值。
- `error`：`fetcher` 最终失败（重试预算耗尽或不重试）；`error` 是原始抛出值，不做任何包装。
- `cancelled`：显式调用 `cancel()` 中止了一个处于 `pending` 的请求；`error` 是一个 `name: 'AbortError'` 的 `DOMException`。

`error`/`cancelled` 是**稳定、可检查的终态**——被动读取（`state`/`promise`/`read()`）不会自动重试它们，只有显式调用 `refetch()`/`invalidate()` 才会重新尝试，避免读取路径出现无限重试循环。

### 1.2 Fetcher 与依赖追踪

```ts
type IResourceFetcher<T> = (ctx: { signal: AbortSignal }) => T | PromiseLike<T>;
```

`fetcher` 在**首次 `await` 之前同步执行的这一段代码**，其中对 Signal/Computed `.value`（或 `.read()`/追踪读取）的访问会被登记为这个 `Resource` 的依赖（`resource.deps`）。这是 JavaScript 单线程同步执行的天然边界：`await` 之后代码是在微任务里恢复执行的，此时已经脱离了框架能建立追踪的同步窗口。**`await` 之后读取的响应式值不会自动成为依赖**，如果确实需要依赖它，要么把这部分读取提到 `await` 之前存进局部变量，要么把它包进一个 `Computed` 并在 `await` 之前读一次那个 `Computed`。

`ctx.signal` 是一个 `AbortSignal`，`fetcher` **必须**把它转交给真正可取消的 I/O（`fetch(url, { signal })`、支持 `AbortSignal` 的数据库/RPC 客户端等）——`Resource` 自己的取消逻辑只决定"这次结果还算不算数"，不会替你物理中断一个没有接上 `signal` 的请求。

### 1.3 世代（generation）与竞态防护

每次发起请求都会生成一个新的世代 token。依赖变化、`refetch()`、`invalidate()` 都会立即让之前的世代失效（`supersede`）；只有当前世代的结果落地时才会写回 `state`，被取代世代的结果无论成功还是失败都会被静默丢弃。这就是"旧请求晚返回也不会覆盖新状态"的实现基础，调用方不需要自己比对时间戳或序号。

### 1.4 Suspense 读取：`read()` / `peek()`

`read()` 是专门给 React Suspense 风格设计的读取原语：`success` 返回 `data`；`pending`/`idle` 抛出当前的 `promise`；`error`/`cancelled` 抛出 `error`。`peek()` 形状完全一致，但**不建立依赖边、也不会顺手触发 `ensureFresh()`**——用于"只想看一眼当前快照，不想加入别人的追踪窗口、也不想意外触发一次新请求"的场景（比如 `getSnapshot`、诊断代码）。日常业务读取一般用 `state`（会追踪、会在过期时自动续请求）。

---

## 2. 构造参考

```ts
new Resource<T>(fetcher: IResourceFetcher<T>, runtime: IRuntime, options?: IResourceOptions<T>)
```

`runtime` 来自 `@migaia/reactive` 的 `createRuntime()`（或复用 `defaultRuntime`）。`Resource` 实现了 `IObserver`/`IDisposable`，构造时会把自己登记到 `runtime`（`claimOwnership`），必须和它读取的 Signal/Computed 在**同一个 `runtime`** 下才能建立依赖边。

`IResourceOptions<T>` 完整字段：

| 选项 | 类型 | 必填性 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `debugName` | `string` | 可选 | 无 | 调试标识，会作为内部 `state` Signal 的 `debugName` 后缀（`${debugName}.state`）。 |
| `ttl` | `number` | 可选 | `Infinity` | 成功值的新鲜时长（毫秒）。`Infinity` 表示只要没有依赖变化/显式刷新就永远新鲜；`0` 表示成功后几乎立刻视为过期，每次读取都会触发新请求。必须是非负数，否则构造时抛 `RangeError`。 |
| `autoStart` | `boolean` | 可选 | `true` | 构造函数返回前是否立即发起第一次请求。设为 `false` 时初始状态为 `idle`（除非提供了 `initialSnapshot`），需要显式 `refetch()` 才会开始。 |
| `staleWhileRevalidate` | `boolean` | 可选 | `false` | 刷新时是否保留旧成功值可见（`state.status` 仍为 `success`，附带 `refreshing: true`），而不是先切回 `pending`。 |
| `retry` | `IResourceRetryPolicy` | 可选 | `0` | 失败重试次数或判断函数，见 [§7](#7-重试策略)。必须是非负整数，否则构造时抛 `RangeError`。 |
| `retryDelay` | `number \| (failureCount, error) => number` | 可选 | `0` | 重试前的等待毫秒数或计算函数，见 [§7](#7-重试策略)。 |
| `keepAlive` | `boolean` | 可选 | `false` | 长期无人观察时是否仍保留依赖登记和缓存新鲜度，见 [§5](#5-取消暂停与自动休眠)。 |
| `initialSnapshot` | `IResourceCacheSnapshot<T>` | 可选 | 无 | 用 SSR/持久化的成功快照直接初始化，见 [§8](#8-ssr-持久化快照)。 |

`ttl`/`retry` 的非法值会在**构造函数同步执行期间**直接抛出，不会产生一个"参数不合法但仍然半可用"的实例。

---

## 3. Resource API 完整参考

| 成员 | 类型/签名 | 同步/异步 | 说明 |
| --- | --- | --- | --- |
| `deps` | `ReadonlySet<IObservable>` | 同步 | 当前登记的响应式依赖集合（来自最近一次 `fetcher` 执行）。 |
| `depVersions` | `ReadonlyMap<IObservable, number>` | 同步 | 依赖当时的版本号快照，供追踪器判断是否已过期。 |
| `runtime` | `IRuntime` | 同步 | 构造时传入的 runtime。 |
| `debugName` | `string \| undefined` | 同步 | 构造时传入的调试名。 |
| `state` | `get state(): IResourceState<T>` | 同步 | 读取状态机快照；会建立依赖边并在过期/idle 时触发 `ensureFresh()`。 |
| `promise` | `get promise(): Promise<T>` | 异步 | 当前请求或最近一次缓存值对应的共享 Promise；多个读取者拿到同一个 Promise。空闲/过期时会先触发一次新请求；`disposed` 前从未发起过任何请求会抛 `Error`。 |
| `disposed` | `get disposed(): boolean` | 同步 | 是否已 `dispose()`。 |
| `refreshing` | `get refreshing(): boolean` | 同步 | 是否处于 `staleWhileRevalidate` 后台刷新中（`disposed` 后恒为 `false`）。 |
| `fetchStatus` | `get fetchStatus(): 'idle' \| 'fetching'` | 同步 | 传输层状态，独立于 `state`——`staleWhileRevalidate` 刷新时 `state.status` 仍是 `success`，但 `fetchStatus` 是 `fetching`。 |
| `isStale` | `get isStale(): boolean` | 同步 | 当前缓存的成功值是否已越过 `ttl`。 |
| `observed` | `get observed(): boolean` | 同步 | 是否有响应式订阅者正在观察这个 `Resource` 的状态。 |
| `read()` | `(): T` | 同步 | Suspense 读取，见 [§1.4](#14-suspense-读取read--peek)。 |
| `peek()` | `(): T` | 同步 | `read()` 的非追踪版本，不触发 `ensureFresh()`。 |
| `refetch()` | `(): Promise<T>` | 异步 | 无条件发起一次新请求（即使当前值仍新鲜），返回这次请求的 Promise。 |
| `invalidate()` | `(): Promise<T>` | 异步 | 把当前值标记为立即过期并同步发起一次新请求。 |
| `cancel()` | `(): void` | 同步 | 只中止当前世代的请求；`Resource` 本身保持可用，之后仍可 `refetch()`/被动重新触发。 |
| `dehydrate()` | `(): IResourceCacheSnapshot<T> \| undefined` | 同步 | 当前若是 `success` 态，导出可 JSON 序列化的快照；否则返回 `undefined`。 |
| `hydrate(snapshot)` | `(snapshot: IResourceCacheSnapshot<T>): void` | 同步 | 用一份快照直接设置为 `success` 状态，中止任何在途请求，清空旧依赖登记；`snapshot` 形状不合法会抛 `Error`。 |
| `markDirty()` | `(): void` | 同步 | `IObserver` 接口方法，由依赖的 Signal/Computed 在值变化时调用，业务代码通常不需要手动调用。 |
| `onDependencyDisconnected()` | `(): void` | 同步 | `IObserver` 接口方法，依赖被 dispose 时触发，会强制下一次重新求值（即使版本号看起来没变）。 |
| `dispose()` | `(): void` | 同步 | 终结资源：中止在途请求、清理依赖登记与订阅、释放内部 Signal。幂等，重复调用是 no-op。 |

`state`/`promise`/`read()`/`peek()`/`refetch()`/`invalidate()`/`cancel()`/`dehydrate()`/`hydrate()` 在 `dispose()` 之后调用一律抛出 `Error('cannot use a disposed resource')`，见 [§9](#9-错误与异常完整参考)。

---

## 4. 依赖追踪与自动刷新

`fetcher` 每次真正执行时都会在一个"追踪上下文"里跑（`internalsOf(runtime).tracker.runTracked`），期间同步发生的响应式读取会被记录为这次执行的依赖集合——每次请求都会重新记录一遍，不是构造时固定一次。

依赖变化（`markDirty()`）不会同步立即触发新请求，而是通过 runtime 的 idle 调度通道（和 `Computed` 重算走的是同一条通道）延后合并：同一批同步变化里，哪怕多个依赖先后变脏、`markDirty()` 被调用多次，也只会产生一次实际的新请求。调度回调触发时会再检查一遍"依赖是不是真的过期了"（`hasStaleDependencies`）——如果在等待调度的这段时间里依赖恰好又变回了追踪时的版本（理论上少见），且这次不是由 `onDependencyDisconnected()` 触发的强制刷新，就会跳过这次刷新，不产生多余请求。

`onDependencyDisconnected()`（某个依赖被 `dispose()` 掉）永远会强制触发一次刷新，不做"是否真的过期"的判断——依赖没了本身就是需要重新求值的信号。

如果这次调度刷新在真正发起请求前抛出了同步异常（比如策略函数本身写错了），`Resource` 会把自己标记为 `error` 状态并让缓存立即过期，而不是让异常无声消失。

---

## 5. 取消、暂停与自动休眠

### 5.1 `cancel()` vs `dispose()`

`cancel()` 只中止**当前世代**的请求：如果此时 `state.status === 'pending'`，会切换为 `{ status: 'cancelled', error: DOMException(name: 'AbortError') }`；`Resource` 本身依然可用，后续的被动读取或 `refetch()` 会重新发起请求。`dispose()` 是彻底终结——之后任何方法调用都会抛错，必须创建新实例才能继续使用。

> **已知边界行为**：在 `staleWhileRevalidate` 的后台刷新过程中调用 `cancel()`，由于此时 `state.status` 是 `success`（附带 `refreshing: true`）而不是 `pending`，`cancel()` 不会改写 `state`——`refreshing` 会一直停留在 `true`，直到下一次请求（无论成功失败）结算才会被重置。`fetchStatus` 会正确地变回 `idle`，但 `refreshing` 和 `fetchStatus` 因此可能短暂不一致。需要精确感知"后台刷新已被取消"的场景，应该在调用 `cancel()` 后自行触发一次 `refetch()`/`invalidate()` 来重置这个标记。

### 5.2 自动休眠：没人观察时会发生什么

`observed`（即 `state`/`promise`/`read()` 建立的订阅数量归零）之后，`Resource` 不会立即做任何事，而是通过 idle 调度延后检查一次（避免 React 渲染过程中"临时取消订阅又立刻重新订阅"这类瞬时抖动被误判为真正的空闲）。如果延后检查时确实还是无人观察、`keepAlive` 也不是 `true`，且这个 `Resource` 当时确实有依赖（`deps.size > 0`）：

- 当前是 `success` 状态：把 `ttl` 立即清零，让下一次被重新观察时视为过期，从而触发一次新请求。
- 当前请求仍在进行中：把这次即将到来的结果标记为"结算后立即视为过期"，效果和上一条等价，只是时机延后到请求真正完成之后。

**这个过程不会中止正在进行的请求**——即便这个请求是给一个即将挂起（Suspense）的渲染准备的 Promise，取消它会让还在等待这个 Promise 的调用方直接收到一个 reject，这不是预期行为。也就是说：无观察者只会让"下一次被观察"时更倾向于重新拉取，不会打断已经在跑的网络请求。

`keepAlive: true` 会完全跳过上述行为——没人观察也保持依赖登记和缓存新鲜度，适合"预取后台数据，稍后某处才会读"的场景；代价是这类 `Resource` 不会自动休眠，需要调用方自己在合适时机 `dispose()`。

---

## 6. staleWhileRevalidate 与后台刷新

默认（`staleWhileRevalidate: false`）情况下，任何新请求发起时都会先把 `state` 切回 `{ status: 'pending' }`，哪怕之前有可展示的旧数据——UI 通常会因此闪一下 loading。

`staleWhileRevalidate: true` 时，如果当前已经是 `success`，新请求发起时 `state` 保持 `{ status: 'success', data: 旧值, refreshing: true }`，旧数据继续可见，`refreshing` 作为额外信号驱动一个不遮挡内容的加载指示（比如顶部进度条）。刷新成功后 `data` 被替换为新值、`refreshing` 消失；刷新失败则整体切换为 `{ status: 'error' }`（**旧数据不会被保留**，失败态会覆盖掉刚才展示的旧值，如果需要"失败时继续展示旧数据"，需要在读取 `state` 的一侧自行加一层"记住最后一次成功值"的逻辑）。

---

## 7. 重试策略

```ts
type IResourceRetryPolicy = number | ((failureCount: number, error: unknown) => boolean);
```

- **数字形式**：表示"失败后最多重试的次数"，不含首次尝试。`retry: 2` 意味着最多总共尝试 3 次（1 次首发 + 2 次重试）。第 `n` 次失败后，`nextFailureCount = n`，`n <= retry` 才会继续重试。
- **函数形式**：`(failureCount, error) => boolean`，`failureCount` 从 1 开始计数（第几次失败），返回 `true` 继续重试。函数内部抛出的异常会直接作为这次请求的失败原因 reject，不会被当成"不重试"处理。

`retryDelay` 决定每次重试前等待多久：数字表示固定毫秒数，函数 `(failureCount, error) => number` 按失败次数/错误动态计算。等待期间如果 `signal` 被中止，等待会立即以取消错误结束，不会等到计时器结束才响应取消。计算出的延迟必须是非负有限数，否则这次请求以 `RangeError('resource retry delay must be a non-negative finite number')` 失败；Resource 不会把 retry delay 与 scheduler 当前时间相加，实际排程仍由 scheduler 负责。

**Suspense 兼容读取不计入重试预算**：如果 `fetcher` 内部读取了一个自身会 `throw` 一个 Promise 的 Suspense 兼容值（例如读取另一个尚未就绪的 `Computed`/`Resource`），`Resource` 会识别出这是一个"挂起"而不是"失败"——自动 `await` 这个 Promise，然后**用同样的 `failureCount` 重新执行一次 `fetcher`**，既不计入 `retry` 次数，也不会产生 `error` 状态。这让 `fetcher` 之间可以互相组合而不用担心互相污染对方的重试预算。

---

## 8. SSR / 持久化快照

```ts
type IResourceCacheSnapshot<T> = {
  readonly version: 1;
  readonly data: T;
  readonly updatedAt: number;
  /** `null` 表示无限新鲜期的 JSON 安全形式 */
  readonly expiresAt: number | null;
};
```

`dehydrate()` 只在当前是 `success` 态时返回快照（其余状态返回 `undefined`），`expiresAt` 用 `null` 代表 `Infinity`（JSON 不支持 `Infinity`）。`hydrate(snapshot)` 是它的逆操作，会：

1. 校验 `snapshot` 形状（`version === 1`、`updatedAt`/`expiresAt` 是有限数字或 `null`），不合法直接抛 `Error`。
2. 中止任何在途请求（不触发 `cancelled` 状态，直接静默 supersede）。
3. 清空旧的依赖登记。
4. 把 `state` 设为 `{ status: 'success', data: snapshot.data }`（**不带 `refreshing` 字段**，即便原来在刷新）。

构造时传入 `initialSnapshot` 等价于"构造后立即 `hydrate()`一次"，但多一层与 `autoStart` 的联动：

- 快照仍新鲜（未过期）且 `autoStart`（默认 `true`）：**不会**额外发起请求，直接使用快照数据。
- 快照已过期：即使提供了快照也会照常发起一次请求（用来验证/刷新数据）——**如果这时 `staleWhileRevalidate` 是默认的 `false`，这次自动请求会把刚刚 `hydrate` 进来的数据立刻切换成 `pending`**，SSR 首屏可能因此"先显示服务端渲染的数据、瞬间又变成 loading"。为避免这种闪烁，**过期的 `initialSnapshot` 通常应该搭配 `staleWhileRevalidate: true`**，让刷新期间继续展示 hydrate 进来的旧值。
- `autoStart: false`：无论快照是否过期都不会自动发起请求，需要显式调用 `refetch()`/`invalidate()`。

有限 `ttl` 的成功结算还要求 `updatedAt + ttl` 保持有限。若 scheduler 返回 `Number.MAX_VALUE` 等边界时间并导致加法溢出，当前请求以 `RangeError('resource ttl expiration must remain finite')`、`INVALID_OPTION` 失败，状态进入 `error`，不会发布 `success`、写入缓存或让 `dehydrate()` 产生 `expiresAt: null`。刚好仍等于最大有限数的边界加法允许通过；`hydrate()` 同样拒绝非有限数值快照。

---

## 9. 错误与异常完整参考

`Resource` **自己抛出**的每一个错误都携带 `(source, code)` 二元组：`source` 恒为 `'@migaia/resource'`，`code` 取自 `src/error-code.ts` 的 `ResourceErrorCode`（6 个码）。全仓契约见 `docs/contracts/error-codes.md`，本包码表的权威定义见 `docs/lifecycle/migration.sdd.md` §3.7.2。

**码是附加字段，绝不替换错误类型**——选项校验仍是 `RangeError`，中止/取消仍是 `name === 'AbortError'` 的 `DOMException`，依赖 `instanceof` 或 `error.name` 判断的调用方（包括 `store-react` 的 suspension 路径）完全不受影响。`error.message` 也一律保留 `` 前缀。

```ts
import { ResourceErrorCode } from '@migaia/resource';

try {
  resource.state;
} catch (error) {
  if ((error as { code?: string }).code === ResourceErrorCode.resourceDisposed) {
    // 这个 Resource 已经终结，必须新建
  }
}
```

| 触发场景 | 异常类型 | `code` | `message` / `name` |
| --- | --- | --- | --- |
| 构造时 `ttl` 为负数或 `NaN` | `RangeError` | `INVALID_OPTION` | `resource ttl must be non-negative` |
| 成功结算时 `updatedAt + finite ttl` 溢出有限数范围 | `RangeError` | `INVALID_OPTION` | `resource ttl expiration must remain finite` |
| 构造时 `retry` 为负数或非整数（数字形式） | `RangeError` | `INVALID_OPTION` | `resource retry count must be a non-negative integer` |
| 计算出的重试延迟不是非负有限数 | `RangeError` | `INVALID_OPTION` | `resource retry delay must be a non-negative finite number` |
| `hydrate()` 传入形状不合法的快照 | `Error` | `INVALID_SNAPSHOT` | `invalid resource cache snapshot` |
| 已 `dispose()` 后调用任意方法 | `Error` | `RESOURCE_DISPOSED` | `cannot use a disposed resource` |
| 读 `promise` 但从未发起过任何请求（理论边界情况） | `Error` | `NO_ACTIVE_PROMISE` | `resource has no active or cached promise` |
| `fetcher` 的请求被依赖变化/`refetch()`/`invalidate()` 取代 | `DOMException` | `REQUEST_ABORTED` | `name: 'AbortError'`，`message: 'resource request aborted'` |
| 显式调用 `cancel()` 中止一个 `pending` 请求 | `DOMException` | `REQUEST_CANCELLED` | `name: 'AbortError'`，`message: 'resource request cancelled'`（出现在 `state.error`，`state.status` 为 `cancelled`） |
| `fetcher` 自身抛出的业务错误 | 原样透传 | **无**（不是本包的错误） | 不做任何包装，按引用原样出现在 `state.error` |
| `retry`/`retryDelay` 策略函数自身抛出的异常 | 原样透传 | **无**（同上） | 直接作为这次请求的失败原因，不会被误判成"不重试" |
| 状态结算（`then`/`catch` 回调）内部再次抛出的框架级异常（极端情况） | 通过 `runtime.reportError(error, { phase: 'async-flush' })` 上报 | — | 不会作为 `Promise` rejection 抛给调用方，需要通过 runtime 的 `onError` 观察 |

> **传给 `fetcher` 的 `signal.reason`**：当一次在途请求被**新请求取代**时，底座 `@migaia/lifecycle` 的 `GenerationController` 以字符串 `'superseded by a new generation'` 作为 abort reason（迁移前是不带 reason 的默认 `AbortError`）。`Resource` 对外的 rejection 仍然被归一化成上表的 `REQUEST_ABORTED` `DOMException`，所以调用方契约不变；但如果你的 `fetcher` 直接把 `signal` 透传给 `fetch()` 并读取 `signal.reason`，看到的会是那个字符串。

区分两类失败很重要：**业务失败**（`fetcher` reject 或抛错）落在 `state.error`，是正常的、预期内的状态；**框架自身在结算回调里意外出错**（几乎不会在正常使用下发生）才会走 `runtime.reportError`，需要在创建 `runtime` 时传入 `onError` 才能观察到。

---

## 10. 生命周期与 dispose

`dispose()` 做的事情：中止在途请求（不做任何"是否 pending"的状态改写，因为整个 `Resource` 都要终结了）、清空 `refreshScheduled`/`forceRefresh` 内部标记、清理响应式依赖登记、`dispose()` 内部的 `state` Signal、最终把生命周期标记为终态。之后任何方法调用（包括 `state`/`peek()` 这类只读访问）都会抛 `cannot use a disposed resource`。

`dispose()` 是幂等的——已经处于终态时再次调用直接返回，不会重复执行清理或抛错。

`Resource` 没有自带的"父子级联 dispose"机制；如果一个模块内创建了多个 `Resource`，需要调用方自己在合适的生命周期节点（组件卸载、请求结束、模块热更新前）逐个 `dispose()`。

---

## 11. 完整场景示例

### 11.1 React Suspense（配合 `@migaia/store-react`）

```ts
// 定义资源
import { Resource } from '@migaia/resource';
import { defaultRuntime } from '@migaia/reactive';

const userResource = new Resource(
  ({ signal }) => fetch(`/api/users/${currentUserId.value}`, { signal }).then((r) => r.json()),
  defaultRuntime,
  { ttl: 30_000, staleWhileRevalidate: true, retry: 2 }
);
```

```tsx
// 组件内消费（useResourceValue 内部就是 resource.state 分支 + read() 抛 Promise 的组合）
import { useResourceValue } from '@migaia/store-react';

function UserCard() {
  const user = useResourceValue(userResource); // pending 时挂起，success 直接拿到 T，error 交给 ErrorBoundary
  return <div>{user.name}</div>;
}
```

### 11.2 Worker RPC 场景（`@migaia/store-worker` 的封装方式）

`@migaia/store-worker` 的 `workerComputed()` 就是在 `Resource` 上包了一层"把输入通过 web-rpc 转发给 Worker 计算"：

```ts
import { Resource } from '@migaia/resource';

function workerComputed<Input, Output>(adapter, selectInput: () => Input, options = {}) {
  return new Resource<Output>(
    ({ signal }) => {
      const input = selectInput(); // 同步读取，成为依赖
      return adapter.request<Input, Output>(input, { signal });
    },
    runtime,
    options
  );
}
```

`selectInput()` 里对响应式输入的同步读取会被正确追踪；`signal` 被转交给 RPC adapter 用于取消进行中的 Worker 调用。

### 11.3 SSR 快照恢复

```ts
import { Resource } from '@migaia/resource';

// 服务端：请求完成后导出快照，随页面一起序列化下发
const snapshot = userResource.dehydrate();

// 客户端：用快照直接初始化，避免重复请求；快照可能已过期，配 staleWhileRevalidate 防止闪烁
const userResource = new Resource(fetchUser, runtime, {
  initialSnapshot: snapshot,
  staleWhileRevalidate: true,
  ttl: 30_000
});
```

### 11.4 手动控制 + 错误处理

```ts
const search = new Resource(
  ({ signal }) => searchApi(query.value, { signal }),
  runtime,
  { autoStart: false, retry: 1, retryDelay: 300 }
);

async function onSubmit() {
  try {
    const results = await search.refetch();
    renderResults(results);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return; // 被新搜索取代，忽略
    renderError(error);
  }
}

// 页面卸载
search.dispose();
```

---

## 12. 常见问题排查

**Q：依赖变了，但 Resource 没有自动重新请求。**
检查这次响应式读取是不是发生在 `fetcher` 的第一个 `await` **之后**——那部分读取不会被追踪。把它挪到 `await` 之前，或者包进一个 `Computed` 并在 `await` 之前读一次。

**Q：`staleWhileRevalidate` 开着，但 `cancel()` 之后 `refreshing` 一直是 `true`。**
这是已知的边界行为，见 [§5.1](#51-cancel-vs-dispose)——`cancel()` 只在 `state.status === 'pending'` 时改写状态，后台刷新的 `success.refreshing` 不会被它重置。调用 `cancel()` 后如果需要精确重置，再调用一次 `refetch()`/`invalidate()`。

**Q：SSR 下发的数据一显示就闪成 loading。**
大概率是 `initialSnapshot` 已经过期、又没开 `staleWhileRevalidate`，见 [§8](#8-ssr-持久化快照)——构造时会自动发起一次刷新请求，默认行为会先把状态切回 `pending`。加上 `staleWhileRevalidate: true` 即可让旧值在刷新期间继续展示。

**Q：`retry` 设了却感觉请求次数对不上。**
`retry` 是重试次数、不含首次尝试，`retry: 2` 总共最多 3 次请求。同时确认 `fetcher` 内部有没有读取一个会 `throw` Promise 的 Suspense 值——这类"挂起"不计入重试预算，见 [§7](#7-重试策略)。

**Q：Resource 一直没人用，但内存里好像还占着东西。**
检查是不是设了 `keepAlive: true`——这会让 `Resource` 永远不自动休眠。默认 `false` 时，无人观察一段时间后会自动清理依赖登记并让缓存过期（但不会主动 `dispose()`，`Resource` 实例本身依然存在）；真正不再使用时仍然需要显式 `dispose()`。

**Q：想在业务代码里 `catch` 到 `runtime` 报的错误。**
只有极少数框架内部结算异常才会走 `runtime.reportError`，正常的 `fetcher` 失败都在 `state.error` 里。需要观察前者的话，在 `createRuntime({ onError })` 里传入回调。
