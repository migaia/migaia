# `@migaia/lifecycle`

运行时中立的**生命周期原语**：作用域、代数、静默追踪、释放事务。

这个包是全仓十九个包共用的底座 —— 在它出现之前，`reactive` / `resource` / `plugin-host` / `capability` /
`web-rpc` / `store-*` 各自手写了一套重叠但都只覆盖一部分的 scope / 代数 / 租约 / 超时机制
（`docs/lifecycle/migration.sdd.md` §2 归纳了这四类根因）。

设计文档：`docs/lifecycle/lifecycle-extraction.sdd.md`（SDD 1/3）。

## 1. 它不是什么

这三条是硬约束，不是风格偏好：

- **零依赖叶子包。** `package.json` 里没有 `dependencies`，不会为了共用一个结构类型去 import 任何工作区包。
- **不认识任何领域名词。** 公开 API 里不出现 store / plugin / capability / service / rpc / storage / sink /
  field / endpoint。它只知道「资源」和「怎么释放资源」。
- **不做图算法。** 拓扑排序、环检测、依赖顺序推导都不在这里 —— 那些属于 `@migaia/capability/graph`。
  本包**从不计算顺序**，只执行调用方给定的顺序。

## 2. 两条正交的状态轴

分开这两件事是整个包的地基（§4.2）：

| 轴 | 取值 | 归谁管 | 回答什么问题 |
| --- | --- | --- | --- |
| 容器存活轴 | `open` → `closing` → `terminal` | `TerminalController` / `LifecycleScope` | 这个容器还接不接新工作？ |
| 单元装载轴 | `idle` / `loading` / `loaded` / `failed` | `LifecycleUnit` | 这份东西装好了没有？ |

`ready` / `blocked` / 可用性判定**刻意不在这里** —— 那需要知道依赖关系，属于 capability/graph。

## 3. 两阶段释放

| 阶段 | 同步性 | 会调用用户代码吗 | 作用 |
| --- | --- | --- | --- |
| `close()` | 同步、幂等、不可失败 | **不会** | `open` → `closing`：立刻停止接受新工作，但还不释放任何东西 |
| `dispose()` | **总是异步**（D-1） | 会 | 真正执行释放，走到 `terminal` |

`dispose()` 只有异步一种形态，**不提供同步版本**。这是 D-1 的明确裁定：双 API 会让每个调用点重新面对
「我该调哪个」的问题，而这正是迁移前那一堆并行实现的来源。纯同步场景用 `createSyncLifecycleScope()`，
它在**注册时**就拒绝任何可能异步的资源，而不是在释放时才发现。

## 4. 主要构件

| 构件 | 用途 |
| --- | --- |
| `createLifecycleScope()` | 通用异步所有权容器：`own(resource, descriptor)` 登记，`dispose()` 逆序释放 |
| `createSyncLifecycleScope()` | 同步容器，可暴露 `[Symbol.dispose]`；拒绝 `syncSafe !== true` 的 descriptor 与异步 scope 实例 |
| `createLifecycleUnit()` | 单元装载轴的状态机：同步返回直接落 `loaded`，thenable 才经过 `loading` |
| `createGenerationController()` | 代数 + 每代一个 `AbortSignal` + 可选超时 + 父 signal 联动中止 |
| `createObjectLeaseRegistry()` / `createStringLeaseRegistry()` | 引用计数租约：`retain` / `count` / `seal` / `whenZero` / `whenZeroOnce` |
| `createPendingTracker()` | 在途工作追踪与排空（`track` / `drain` / `size`） |
| `createProvisionalScope()` | 构造期两阶段所有权事务：`commitTo(parent)` 与 `rollback()` 二选一 |
| `createMutationQueue()` | 严格 FIFO 串行队列，带可配置的入队 SLA 看门狗 |
| `createDisposeTransaction()` | 释放事务：`order`（弱，按 key 稳定排序）或 `plan`（强，按给定序列执行）二选一 |
| `boundedWait()` | 有界等待：超时只是**放弃等待**，从不取消被等待的任务 |

## 5. Descriptor：领域表达释放意图的唯一词汇

本包对「资源是什么」零知识，所有释放策略都由调用方通过 descriptor 声明：

```ts
scope.own(handle, {
  syncSafe: false,
  order: 10,                   // 大的先释放；仅 order 模式有意义
  graceful: (ctx) => flush(),  // 优雅释放；超时则放弃等待并落到 force
  gracefulTimeoutMs: 200,
  force: () => handle.close(), // 必须无条件完成
  gcFallback: true             // 显式释放时自动 unregister
});
```

`custom` 是逃生舱：设了它就完全接管这个资源的释放，本包只负责排序和收集错误。

## 6. 错误策略（D-4）

`throw`（单错原样抛、多错聚合成 `AggregateError`）、`collect`（返回 `ICollectedError[]`）、
`report`（回调，从不抛）、`firstError`（保留首错，其余观测但不改变结果）。

`firstError` 不是通用默认值 —— 它存在只是为了给 `web-rpc` 的 discovery-registry 一个语义等价物。

## 7. 错误码

码表唯一声明处是 `src/error-code.ts`（17 个码，逐条带三段式 JSDoc），`source` 恒为 `'@migaia/lifecycle'`。
契约见 `docs/contracts/error-codes.md`。原始错误始终沿 `cause` 链（含 `AggregateError.errors`）可达，
`stack` 从不被重写。

## 8. 门禁

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```

验收矩阵（L-T1 ~ L-T44）见 `docs/lifecycle/lifecycle-extraction.sdd.md` §5.4；每个 `L-T` 编号都能在
`test/` 下检索到对应用例。
