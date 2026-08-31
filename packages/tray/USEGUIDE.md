# `@migaia/tray` 使用指南

README 负责快速上手；本文给出公开契约、失败语义与生产边界。Tray 是 `@migaia/capability/graph` 的静态、同 realm 组合层，不复制 Graph 的生命周期或调度实现。

## 1. 公开入口与类型

```ts
import {
  createTray,
  TRAY_SOURCE,
  TrayErrorCode,
  type IGraphReadinessSnapshot,
  type ITray,
  type ITrayEntryContext,
  type ITrayEntryDefinition,
  type ITrayEntryInstance,
  type ITrayEntryKind,
  type ITrayErrorCode,
  type ITrayKey,
  type ITrayState
} from '@migaia/tray'
```

`ITrayKey` 是带品牌的非空字符串。包不猜测或生成业务 key；应用应在自己的契约文件集中声明并复用：

```ts
const trayKey = (value: string): ITrayKey => value as ITrayKey
export const AppTrayKey = {
  config: trayKey('config'),
  api: trayKey('api')
} as const
```

## 2. Entry 定义

```ts
type ITrayEntryKind = 'value' | 'computed' | 'resource' | 'service'

type ITrayEntryDefinition<T> = {
  readonly key: ITrayKey
  readonly kind: ITrayEntryKind
  readonly requires?: readonly ITrayKey[]
  readonly readiness?: IGraphReadinessSnapshot
  readonly start: (
    context: ITrayEntryContext
  ) => ITrayEntryInstance<T> | PromiseLike<ITrayEntryInstance<T>>
}
```

- `key`：必填、trim 后非空、全 Tray 唯一。
- `kind`：必填；用于 Graph 诊断和拓扑语义，不改变 `value` 的 TypeScript 类型。
- `requires`：可选；每个 key 必须存在于同一次 `createTray()` 的 entry 数组，不能引用自身。
- `readiness`：可选的外部门状态快照，只接受 `ready | blocked | failed`。它在首次 `ready()` 时读取一次并缓存结果。
- `start`：必填；Graph 在依赖就绪后调用。返回值必须包含 `value` 与可调用的 `release`。

`ITrayEntryContext` 提供：

- `signal`：Graph 关闭时中止，长任务应主动观察。
- `get(key)`：读取已就绪的声明依赖；不要读取未列入 `requires` 的隐式依赖。
- `own(resource, descriptor)`：把辅助资源交给当前 Graph 节点，节点释放时统一清理。

## 3. `createTray()` 与 admission

```ts
function createTray(entries: readonly ITrayEntryDefinition<unknown>[]): ITray
```

构造阶段只做同步 admission，不启动 entry。数组、entry 字段、kind、key、requires 与 readiness 外形不合法时立即抛 `TRAY_INVALID_ENTRY`；重复 key 抛 `TRAY_DUPLICATE_ENTRY`。任何 admission 失败都发生在第一个 `start()` 之前，不会留下半启动组合根。

构造时会冻结规范化后的 key/requires 快照；之后修改调用方原数组或 entry 对象不会改变已接纳拓扑。

## 4. Readiness gate 与启动

首次调用 `ready()` 按 entry 顺序读取所有 `readiness`：

- 全部缺省或为 `ready`：启动 Capability Graph。
- `blocked`/`failed`：以 snapshot 的原始 `error` reject；没有 error 时使用 `TRAY_UNAVAILABLE`。
- state 非法：以 `TRAY_INVALID_ENTRY` reject，不再读取该 snapshot 的 `error`。
- getter 抛错：保留原错误身份和原生类型，并尽可能附加 `TRAY_GATE_READ_FAILED`。

同一 Tray 的重复 `ready()` 返回同一个稳定 Promise，不会重读 gate 或重复启动。gate 失败时 `state === 'failed'`，`error` 暴露缓存的原始原因。

## 5. `ITray` API

```ts
type ITray = {
  readonly keys: readonly ITrayKey[]
  readonly state: ITrayState
  readonly error: unknown | undefined
  ready(): Promise<void>
  get<T>(key: ITrayKey): T
  entryState(key: ITrayKey): string
  dispose(): Promise<void>
}
```

- `keys`：admission 时保存的冻结 key 列表，保持声明顺序。
- `state`：调用 `ready()` 前为 `open`；之后投影 Graph 状态，gate 失败为 `failed`。
- `error`：gate 或 Graph 的当前错误，不会为了提供 Tray 文案而替换原始启动错误。
- `get(key)`：只在 Graph 与对应 entry 都为 `ready` 时返回值。未知 key 抛 `TRAY_UNKNOWN_ENTRY`；其他不可用状态抛 `TRAY_UNAVAILABLE`。
- `entryState(key)`：返回单个 Graph 节点状态；未知 key 同样抛 `TRAY_UNKNOWN_ENTRY`。
- `dispose()`：关闭 admission、终止 Graph 并按依赖逆序释放。重复或并发调用遵循 Graph 的幂等/Promise 身份语义。

## 6. 生命周期与所有权

primary `value` 的 `release()` 由 Graph 所有；`context.own()` 注册的辅助资源也归同一节点。调用方不应在 Tray 外再次释放这些资源，否则会制造双重清理。释放错误不会替换更早的 primary 失败，原始错误仍可通过 `cause` 或 `AggregateError.errors` 访问。

Tray core 不增加 timeout、scheduler 或强制终止策略。可能永久 pending 的 `start()`/`release()` 必须由具体 entry 自己实现有界等待，或由外层 realm host 负责强制终止。

## 7. 错误码

所有 Tray 自有错误的 `source` 都是 `TRAY_SOURCE`（`'@migaia/tray'`）：

| `TrayErrorCode`          | 码值                       | 触发条件                                                       | 调用方处理                                                         |
| ------------------------ | -------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `invalidEntry`           | `TRAY_INVALID_ENTRY`       | entry、依赖、kind、readiness 或 start result 不满足契约        | 修正静态定义；同一输入不要盲目重试                                 |
| `duplicateEntry`         | `TRAY_DUPLICATE_ENTRY`     | 同一 Tray 出现重复 key                                         | 在应用契约层保证 key 唯一                                          |
| `unknownEntry`           | `TRAY_UNKNOWN_ENTRY`       | `get()`/`entryState()` 使用未接纳 key                          | 使用 `tray.keys` 或集中定义的 key 常量                             |
| `unavailable`            | `TRAY_UNAVAILABLE`         | entry 尚未 ready、gate 失败或 Tray 已终结                      | 先等待 `ready()`，并检查 `state`/`error`                           |
| `gateReadFailed`         | `TRAY_GATE_READ_FAILED`    | readiness getter 抛错                                          | 检查保留的原始错误并修复 readiness source                          |
| `hostMutationBypass`     | `HOST_MUTATION_BYPASS`     | escaped concrete Host 绕过 managed Graph receipt 发生 mutation | 停止使用 raw Host mutation；只通过 `@migaia/tray/host` facade 写入 |
| `loaderContractInvalid`  | `LOADER_CONTRACT_INVALID`  | loader/result/release descriptor 外形非法                      | 修正 Loader contract，不重试相同输入                               |
| `loaderExecutionFailed`  | `LOADER_EXECUTION_FAILED`  | Loader 执行抛错；原错误仍在 cause/identity 链                  | 检查 source 与 cause 后处理                                        |
| `adapterContractInvalid` | `ADAPTER_CONTRACT_INVALID` | Adapter 或 plugin descriptor 外形非法                          | 修正 Adapter 输出                                                  |
| `adapterExecutionFailed` | `ADAPTER_EXECUTION_FAILED` | Adapter 执行抛错；原错误保持可达                               | 检查 artifact compatibility                                        |
| `runtimeContractInvalid` | `RUNTIME_CONTRACT_INVALID` | foreign Host、name/options/execute 外形非法                    | 修正 Runtime 调用契约                                              |
| `runtimeDisposed`        | `RUNTIME_DISPOSED`         | closing/terminal 后仍 admission                                | 创建新 Runtime 或停止 admission                                    |
| `runtimeExecutionFailed` | `RUNTIME_EXECUTION_FAILED` | callback 抛错；lease 仍在 finally 释放                         | 检查 callback cause                                                |
| `runtimeAborted`         | `RUNTIME_ABORTED`          | caller/runtime/deadline cooperative abort                      | 按 cancellation 处理并等待 settlement                              |
| `artifactCleanupFailed`  | `ARTIFACT_CLEANUP_FAILED`  | artifact secondary cleanup failure                             | 检查 cleanupErrors，不替换 mutation primary                        |

Graph 启动、节点或释放错误仍保留 `@migaia/capability` 的 source/code，不会被 Tray 强行改写。

## 8. 生产使用检查单

- 在单一契约文件声明所有 `ITrayKey`，不要散落 `as ITrayKey`。
- 所有依赖都写进 `requires`，不要靠启动顺序碰巧可用。
- `start()` 只返回完整 `{ value, release }`，部分构造失败时由 entry 自己回滚已获得资源。
- 应用暴露服务前先 `await tray.ready()`；失败时记录 `error.source`、`error.code` 与 cause chain。
- 在进程/请求/测试作用域结束时 `await tray.dispose()`。
- 跨 Worker、动态模块或 UI 通知另建 adapter，不把这些策略塞进 Tray core。

## 9. 构建门禁

仓库根目录：

```bash
pnpm --filter @migaia/tray fmt
pnpm --filter @migaia/tray lint
pnpm --filter @migaia/tray typecheck
pnpm --filter @migaia/tray typecheck:test
pnpm --filter @migaia/tray test
pnpm --filter @migaia/tray build
```

## 10. `@migaia/tray/host` 托管组合

```ts
import { createHost, type ICreateHostOptions, type ITrayResolvedHost } from '@migaia/tray/host'
```

`await createHost(options)` 的唯一 concrete Host 由 `options.create()` 构造。Tray 随后一次性快照
plugin、`requires`、config 与 disposer，建立 Dynamic Capability Graph，再通过 PluginHost prepared
admission 发布 ready definition。任何 factory/admission/setup/commit 失败都会回滚未发布候选；失败的
duplicate/cycle/replacement candidate 不会成为以后 restart 的隐式来源。

公开 mutation：

- `use(plugin)`：增加 definition；缺 provider 时 definition 为 `blocked`，不会安装进 Host。
- `replace(plugin)`：替换 exact 同名 generation；失败分支的 `committed` 表示 candidate 是否已成为
  Graph 当前 binding，不以“这个名字仍存在”猜测。
- `unUse(name)`：删除 definition 并阻塞其 consumer closure；未知名称返回
  `{ ok: true, committed: false, removed: false }`。
- `dispose()`：终止 Graph、移除内部 anchor、关闭 concrete Host；并发调用复用同一 Promise。

`cleanupComplete: false` 表示逻辑 mutation 已提交、物理清理仍在进行。此时必须保留并观察同一个
`physicalCompletion`。Graph 在释放 exact generation 前 seal binding lease；PluginHost 严格等待该 fence
与正在执行的 pipeline snapshot，然后按 consumer/provider、plugin/resource 的既定顺序清理。bounded
只缩短调用方等待，不授权提前启动 disposer，也不取消仍在运行的 Promise。

类型策略以稳定性优先：有限、literal、最多 128 个 definition 时，`ITrayResolvedHost` 推导 exact ready
closure；widened name、widened `requires` 或超过预算时返回 `ITrayHostDynamic`。dynamic view 仍保留 concrete
Host 的 constructor baseline extension/config 类型，运行期管理的未知 key 为 `unknown`。

不要绕过 facade 调用 escaped concrete Host mutation。Tray 会以
`(source: '@migaia/tray', code: 'HOST_MUTATION_BYPASS')` fail closed，因为 Graph 与 Host 已不再拥有同一
publication receipt。

## 11. Loader、Adapter 与 Runtime

能力边界通过显式子路径保持隔离：

```ts
import { defineLoader, loadIntoHost } from '@migaia/tray/loader'
import { defineAdapter } from '@migaia/tray/adapter'
import { createRuntime } from '@migaia/tray/runtime'
```

`defineLoader()` 快照一次 `load` contract，并兼容同步值、原生 Promise 与 foreign thenable；
结果必须提供 `value` 与可调用的 lifecycle `release` descriptor。`defineAdapter()` 同样只
快照并执行一次转换，不拥有 Host、Graph、scope 或 artifact 清理。`loadIntoHost()` 是唯一事务
owner：提交前的 loader/adapt/mutation failure 回滚 provisional artifact；只有 committed
definition generation 接管 cleanup。

Runtime 不创建第二个 Host 或 Graph。`runtime.run(name, options, callback)` 取得目标 ready
plugin 的 exact generation lease，并只发布该 registration 的 extension snapshot。同步返回、
Promise 与 foreign thenable 都在 callback settle 后释放 lease；caller signal、Runtime dispose
和 timeout 只 abort cooperative signal，不伪造任务已终止。`strict-drain` 等待真实 settlement，
`bounded` 可返回未完成的物理观察结果。

callback context 的 `self` 是当前 run/name/generation 专属 mutation capability：

```ts
const ticket = await runtime.run('search', { timeoutMs: false }, ({ self }) => self.unUse())
await ticket.completion
```

ticket 不可 thenable，且只在 callback 已 settle 并释放 generation lease 后才调度 canonical
managed Host mutation。callback 内等待 `ticket.completion` 会 fail fast 并返回
`RUNTIME_CONTRACT_INVALID`；外部 `host.unUse/replace` 仍按既有 queue 等待 exact lease。不要
从 callback 捕获 concrete Host 执行 self mutation。

Loader/Adapter/Runtime 契约错误分别使用 `LOADER_*`、`ADAPTER_*`、`RUNTIME_*` 码；原始 native
error 保留 identity、type、stack 与 cause。artifact secondary cleanup 使用
`ARTIFACT_CLEANUP_FAILED` 作为观察码，不能替换更早 mutation primary。
