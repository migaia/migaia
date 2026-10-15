# `@migaia/tray` 使用指南

README 负责快速上手；本文给出静态 Graph 和 Hosts 层的公开契约、失败语义与生产边界。Graph、PluginHost、RPC 与 supervision 分别保留原有生命周期与执行所有权。

## Hosts：实例发现与生命周期

根入口的 `defineTrayHost` / `createTray({ hosts })` 管理完整 PluginHost 实例；
`createTrayGraph(entries)` 继续管理静态 capability 集合。每个实例与父 Host 独立。

```ts doc-test=check
import { defineFeature, definePlugin } from '@migaia/plugin-host'
import { createTray, defineTrayHost } from '@migaia/tray'

const echo = defineFeature(() => ({ echo: (value: string) => value }))
const agent = defineTrayHost({
  name: 'agent',
  plugins: () =>
    [
      definePlugin({
        name: 'node',
        features: { svc: echo },
        install: () => ({})
      })
    ] as const,
  exposes: ['node.svc']
})
const tray = createTray({ hosts: [agent] })
try {
  const alice = await tray.spawn('agent', { id: 'alice' })
  console.log(await alice.request('node.svc.echo', 'hello'))
  await tray.restart('alice')
} finally {
  await tray.dispose()
}
```

- 省略 runtime 使用 `coroutine`：共享事件循环，适合轻量 I/O host，停止是合作式的。
- `thread` 使用独立 Worker isolate，必须提供 entry，可设置 `limits.heapBytes`。
- `process` 使用子进程，必须提供 entry，可设置 `sandbox: { name, wrap }` 接入外部沙箱。
- Node Worker/process entry 导入共享 host 定义后执行 `await serveTrayHost(host)`；
  entry 只连接父 registry，不再 spawn。Bun/Deno 与 browser Worker 尚未验证。

### Host 定义与构造选项

`defineTrayHost(definition)` 返回冻结且带身份标记的
`ITrayHost<TName, TConfig, TPlugins, TExposes, TRouting>`。必填字段为 `name`、
`plugins(instance, trayPlugin)` 与 `exposes`；定义阶段不调用插件工厂或配置验证器。
`exposes` 是只读的 `plugin.feature` 路径数组；方法调用使用 `plugin.feature.method`。
结构复制品不具备原定义的身份，不能传给 registry 或 `instance()`。

| 字段         | 类型与默认值                                               | 使用条件                                                                                                 |
| ------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `runtime`    | `'coroutine' \| 'thread' \| 'process'`；默认 `'coroutine'` | 选择实例运行方式                                                                                         |
| `entry`      | `string \| URL`                                            | thread / process 必填；coroutine 禁止                                                                    |
| `config`     | `(input: unknown) => TConfig`；默认无验证器                | 每次初始化时验证并转换配置，输出交给 `plugins`                                                           |
| `supervisor` | `ITraySupervisorPolicy`；默认使用运行时策略                | `restart` 支持 `mode`、`maxRestarts`、`windowMs`、`initialDelayMs`；另支持 `startupTimeoutMs`            |
| `limits`     | `Readonly<{ heapBytes?: number }>`；默认未指定             | 仅 thread 可用                                                                                           |
| `sandbox`    | `ITraySandbox`；默认未指定                                 | 仅 process 可用；包含 `name` 与同步 `wrap(command)`                                                      |
| `routing`    | `TRouting`，即只读 `ITrayRoutingPolicy[]`；默认未指定      | 声明子实例插件可用的 policy；父端把它并入 registry 注册集，子端经 `deps.tray.routing` 调用（见 Routing） |

`supervisor.restart.mode` 接收 `'never' | 'on-failure' | 'always'`。
`sandbox.wrap` 的输入与输出均为 RPC Process 的 `IProcessLaunchCommand`：
`{ command, args, cwd?, env }`；返回完整的新命令，保留所需环境与工作目录。

`createTray({ hosts, routing?, probe?, report? })` 返回 `ITray<THosts, TRouting>`。
`hosts` 是必填的定义只读数组；`routing` 是可选的共享 policy 只读数组，与各 host DSL 的 `routing` 合并注册，构成 `tray.routing` 命名空间（见 Routing）。
`probe` 的类型为 `IRpcProbe | readonly IRpcProbe[]`；`report(error: unknown): void`
接收运行与清理诊断，默认使用 `console.error`。

`serveTrayHost(host, { probe?, report? })` 返回 `Promise<void>`。它只接受本 realm
导入的可信 thread / process 定义；coroutine 由 registry 的任务运行器服务。
`probe` 与 `report` 使用上述相同类型，默认 reporter 也是 `console.error`。
Worker 或子进程入口与父 registry 应导入同一个定义模块。下面的 `hosts.ts` 定义 Worker Host：

```ts doc-test=check group=worker-entry file=hosts.ts
import { defineTrayHost } from '@migaia/tray'

/** 父 registry 与 Worker 入口共用的 Host 定义。 */
export const worker = defineTrayHost({
  name: 'worker',
  runtime: 'thread',
  entry: new URL('./worker.js', import.meta.url),
  plugins: () => [] as const,
  exposes: []
})
```

`worker.ts` 编译后连接父 registry：

```ts doc-test=check group=worker-entry file=worker.ts
import { serveTrayHost } from '@migaia/tray'
import { worker } from './hosts.js'

await serveTrayHost(worker)
```

### Registry 与 remote 的返回类型

- `spawn(name, { id, config? })` 返回 `Promise<ITrayRemote<H>>`；当 host 的配置类型不允许
  `undefined` 时，`config` 必填。`instance(host, id)` 同步返回同类型的 remote。
- `list(filter?)` 返回 `readonly ITrayInstance[]`；`get(id)` 返回 `Promise<ITrayInstanceDetail>`，
  其中 `generation` 保留为 Tray 的数值 generation，其他连接详情由 RPC 提供。
- `restart(id)`、`replace(id, { config? })` 返回 `Promise<ITrayInstance>`。
  `stop(id, { graceMs? })`、`remove(id, { graceMs? })`、`dispose({ graceMs? })` 返回 `Promise<void>`。
- `on(event, listener)` 返回取消订阅函数；`watch({ signal? })` 返回
  `AsyncIterableIterator<ITrayInstanceEventRecord>`。
- remote 的 `request` 返回方法结果的 `Promise`，`notify` 返回 `Promise<void>`，
  `stream` 返回方法元素类型的 `AsyncIterableIterator`。

`plugins(info, trayPlugin)` 在每次 generation init 时调用；`info` 包含 id、host、
generation 和 validator 的 config 输出。插件通过
`defineFeature(factory, { tray: trayPlugin.getFeature('tray') })` 声明依赖，
从 `deps.tray.self()` 读取身份，`await deps.tray.to(otherHost, id)` 得到 admission-bound
remote，`deps.tray.exit(error?)` 结束当前实例。第一次 exit 决定结果：无错误是 clean exit，
有错误是 crash；PluginHost disposer 执行后才结束 task/realm。根入口只导出
`ITrayClientPlugin` 类型，不提供 runtime client 单例。

remote 的统一调用形式是 `request|notify|stream(path, payload, options?)`；
`ITrayCallOptions` 只包含 `signal?: AbortSignal` 与 `timeoutMs?: number`。
零 payload 可省略，带 options 时写 `request(path, undefined, { timeoutMs })`；
业务对象中的 `undefined` 字段会被拒绝，只有 wire envelope 的 absent payload/config 被省略。
Uint8Array 可跨所有三个 runtime；非 portable config 在创建连接前拒绝。

`list({ host?, runtime?, state? })` 返回冻结 snapshot，`get(id)` 合并 RPC unit detail。
`on(event, listener)` / `watch({ signal? })` 仅观察生命周期；记录冻结，没有 emit。
watch 保留最近 100 条未读记录，不是持久日志。每个实例的 stop/restart/replace/remove
按调用顺序进入队列；replace 的 config 只在新 generation init 成功后提交。
停止前先运行 child PluginHost cleanup（graceMs 默认 5000）；失败或超时会 report 并继续停止。

实例 remove 后旧 remote 永久拒绝 `TRAY_INSTANCE_UNKNOWN`，同 id 的重新 spawn 不会复活
旧 admission。非 ready 调用立即拒绝 `TRAY_INSTANCE_NOT_READY`；已发送调用通过原 RPC receipt
完成，不被移到新 generation。target 业务错误的 source/code/cause chain 原样通过；
Tray 验证和 start 错误使用自己的稳定 code，并保留原错误于 cause。

`defineRoutingPolicy(name, pick)` 提供纯 policy 契约，host DSL 可声明 `routing: [policy]`；
注册后通过 `tray.routing.<name>(host)` 或 `tray.routing('<name>', host)` 使用（见 Routing、Publish/subscribe）。返回值为冻结的
`ITrayRoutingPolicy<TName>`；`pick(candidates: readonly ITrayInstance[], context: ITrayRoutingContext)`
同步返回一个实例 id，`context` 包含 `host: string` 与 `sequence: number`。
定义时不调用 `pick`。名称必须符合 `^[a-z][A-Za-z0-9]*$`，不能是 `roundRobin`、
`leastInFlight` 或函数、对象的保留属性名；名称或回调非法时抛 `TRAY_ROUTING_INVALID`。

## 1. 公开入口与类型

```ts doc-test=check
import {
  createTrayGraph,
  TRAY_SOURCE,
  TrayErrorCode,
  type IGraphReadinessSnapshot,
  type ITrayGraph,
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

```ts doc-test=check
import type { ITrayKey } from '@migaia/tray'

const trayKey = (value: string): ITrayKey => value as ITrayKey
export const AppTrayKey = {
  config: trayKey('config'),
  api: trayKey('api')
} as const
```

## 2. Entry 定义

```ts doc-test=check
import type {
  IGraphReadinessSnapshot,
  ITrayEntryContext,
  ITrayEntryInstance,
  ITrayKey
} from '@migaia/tray'

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
- `requires`：可选；每个 key 必须存在于同一次 `createTrayGraph()` 的 entry 数组，不能引用自身。
- `readiness`：可选的外部门状态快照，只接受 `ready | blocked | failed`。首次使用 admission 捕获的快照；只有 blocked 后的显式 ready() 才重新读取 entry.readiness。要取得新事实时提供 getter。
- `start`：必填；Graph 在依赖就绪后调用。返回值必须包含 `value` 与可调用的 `release`。

`ITrayEntryContext` 提供：

- `signal`：Graph 关闭时中止，长任务应主动观察。
- `get(key)`：读取已就绪的声明依赖；不要读取未列入 `requires` 的隐式依赖。
- `own(resource, descriptor)`：把辅助资源交给当前 Graph 节点，节点释放时统一清理。

## 3. `createTrayGraph()` 与 admission

```ts doc-test=check
import type { ITrayEntryDefinition, ITrayGraph } from '@migaia/tray'

declare function createTrayGraph(entries: readonly ITrayEntryDefinition<unknown>[]): ITrayGraph
```

构造阶段只做同步 admission，不启动 entry。数组、entry 字段、kind、key、requires 与 readiness 外形不合法时立即抛 `TRAY_INVALID_ENTRY`；重复 key 抛 `TRAY_DUPLICATE_ENTRY`。任何 admission 失败都发生在第一个 `start()` 之前，不会留下半启动组合根。

构造时会冻结规范化后的 key/requires 快照；之后修改调用方原数组或 entry 对象不会改变已接纳拓扑。

## 4. Readiness gate 与启动

首次调用 `ready()` 按 entry 顺序读取所有 `readiness`：

- 全部缺省或为 `ready`：启动 Capability Graph。
- `blocked`/`failed`：以 snapshot 的原始 `error` reject；没有 error 时使用 `TRAY_UNAVAILABLE`。
- state 非法：以 `TRAY_INVALID_ENTRY` reject，不再读取该 snapshot 的 `error`。
- getter 抛错：保留原错误身份和原生类型，并尽可能附加 `TRAY_GATE_READ_FAILED`。

只有外部门状态为 `blocked` 时，下一次显式 `ready()` 才重新读取每个 entry 的 readiness 属性及其 state/error。`failed`、非法快照、getter 失败和 Graph 启动结果继续缓存同一个 Promise；成功后也不再重读。gate 拒绝时 `state === 'failed'`，`error` 保留本次原因；重试通过后交给 Graph。固定的 blocked 快照仍会 blocked；例如使用 `get readiness() { return provider.readiness }` 获取 provider 新发布的不可变事实。dispose 后不会重试或访问外部门。

## 5. `ITrayGraph` API

```ts doc-test=check
import type { ICapabilityGraphNodeState as IGraphNodeState } from '@migaia/capability/graph'
import type { ITrayKey, ITrayState } from '@migaia/tray'

type ITrayGraph = {
  readonly keys: readonly ITrayKey[]
  readonly state: ITrayState
  readonly error: unknown | undefined
  ready(): Promise<void>
  get<T>(key: ITrayKey): T
  entryState(key: ITrayKey): IGraphNodeState
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

```ts doc-test=check
import { createHost, type ICreateHostOptions, type ITrayResolvedHost } from '@migaia/tray/host'
```

`await createHost(options)` 的唯一 concrete Host 由 `options.create()` 构造。Tray 随后一次性快照
plugin 的 Feature、config 与 disposer，使用 PluginHost 的公开 `readPluginDependencies(admission)`
读取同一个 admission 快照的 provider 与 required/optional 强度，建立 Dynamic Capability Graph，再通过 PluginHost prepared
admission 发布 ready definition。任何 factory/admission/setup/commit 失败都会回滚未发布候选；失败的
duplicate/cycle/replacement candidate 不会成为以后 restart 的隐式来源。

必需的 Feature provider 缺失时 consumer 保持 `blocked`；可选 provider 缺失不阻塞 consumer，
存在时先于 consumer 安装。插件依赖只由 Feature references 声明，不接受旧插件依赖字段。
`createHost`、`use` 和 `replace` 在图变更之前完成 admission；非法描述子以
`TRAY_INVALID_ENTRY` 拒绝，PluginHost 的原始错误直接保留在 `cause`。进入图变更后的失败继续返回 mutation result。

公开 mutation：

- `use(plugin)`：增加 definition；缺 provider 时 definition 为 `blocked`，不会安装进 Host。
- `replace(plugin)`：替换 exact 同名 generation；失败分支的 `committed` 表示 candidate 是否已成为
  Graph 当前 binding，不以“这个名字仍存在”猜测。
- `unUse(name)`：删除 definition 并阻塞其 consumer closure；未知名称返回
  `{ ok: true, committed: false, removed: false }`。
- `dispose()`：终止 Graph、移除内部 anchor、关闭 concrete Host；并发调用复用同一 Promise。

`cleanupComplete: false` 表示逻辑 mutation 已提交、物理清理仍在进行。此时必须保留并观察同一个
`physicalCompletion`。Graph 在释放 exact generation 前 seal binding lease；PluginHost 先等待该 fence，
然后按 consumer/provider、plugin/resource 顺序清理。必填 `execution.pipelineDrainTimeoutMs` 为数值时，
本批共享预算到期后推进后续清理；显式 `false` 才逐项等待真实完成。预算不取消仍在运行的 Promise。
共同结果 `ICleanupResult` 的 `cleanupErrors` 是当前快照，`physicalCompletion` 仅包含后续增量；
使用 `@migaia/lifecycle` 的 `mergeCleanupResults([result])` 可保留所有当前及迟到错误，包括跨 realm Promise。

类型策略以稳定性优先：有限、literal、最多 128 个 definition 时，`ITrayResolvedHost` 推导 exact ready
closure；widened name、任意 widened Feature provider 或超过预算时返回 `ITrayHostDynamic`。dynamic view 仍保留 concrete
Host 的 constructor baseline extension/config 类型，运行期管理的未知 key 为 `unknown`。

不要绕过 facade 调用 escaped concrete Host mutation。Tray 会以
`(source: '@migaia/tray', code: 'HOST_MUTATION_BYPASS')` fail closed，因为 Graph 与 Host 已不再拥有同一
publication receipt。

## 11. Loader、Adapter 与 Runtime

能力边界通过显式子路径保持隔离：

```ts doc-test=check
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

callback context 的 `self` 是当前 run/name/generation 专属 mutation capability。
下面的函数接收已有的 Runtime；其中 `search` 必须已 ready：

```ts doc-test=check
import type { IRuntime } from '@migaia/tray/runtime'

/** 等待 callback 结束，再观察当前 search generation 的卸载结果。 */
async function unloadSearch(runtime: IRuntime): Promise<void> {
  /** completion 只在 callback 结束后读取。 */
  const ticket = await runtime.run('search', { timeoutMs: false }, ({ self }) => self.unUse())
  await ticket.completion
}
```

ticket 不可 thenable，且只在 callback 已 settle 并释放 generation lease 后才调度 canonical
managed Host mutation。callback 内等待 `ticket.completion` 会 fail fast 并返回
`RUNTIME_CONTRACT_INVALID`；外部 `host.unUse/replace` 仍按既有 queue 等待 exact lease。不要
从 callback 捕获 concrete Host 执行 self mutation。

Loader/Adapter/Runtime 契约错误分别使用 `LOADER_*`、`ADAPTER_*`、`RUNTIME_*` 码；原始 native
error 保留 identity、type、stack 与 cause。artifact secondary cleanup 使用
`ARTIFACT_CLEANUP_FAILED` 作为观察码，不能替换更早 mutation primary。

## Routing

Both namespace forms select a ready instance for every operation:
`tray.routing.roundRobin(host)` and `tray.routing('roundRobin', host)` use one
shared cursor. `leastInFlight` picks the fewest pending request, notify and stream
operations; spawn order breaks ties. A routed remote has `host` and no fixed `id`.
Call `request|notify|stream(path, payload, options?)`; signal and timeoutMs occupy
only the third slot, with `undefined` payload for a zero-argument method.
Cancellation and the remaining deadline reach the selected target.

Define custom policies with `defineRoutingPolicy('first', candidates =>
candidates[0]!.id)`. The parent registers the union of `createTray({ routing })`
and every host DSL's `routing` tuple. Child plugins declare the policies they use
in that host tuple and call `deps.tray.routing.first(host)` or
`deps.tray.routing('first', host)`. Built-ins require no declaration. Only the
name crosses RPC; the synchronous picker runs on the parent and must be short.

Unregistered or undeclared names fail with `TRAY_ROUTING_UNKNOWN`. Invalid names,
duplicate names from different policy identities, non-candidate results and thrown
pickers fail with `TRAY_ROUTING_INVALID`; a thrown picker stays on `cause`.
An empty ready set fails with `TRAY_HOST_UNAVAILABLE`. Calls never move to another
instance or retry. `inFlight` on `list()` and `get()` counts pending business sends
for one admission; init and topic delivery are excluded.

## Publish/subscribe

Parent `tray.subscribe(topic, listener)` returns a synchronous unsubscribe receipt.
Child `await deps.tray.subscribe(topic, listener)` returns an asynchronous,
idempotent receipt; the first local listener registers one parent membership and
the last release removes it. Reinstalling plugins after restart re-subscribes in
the new generation. Old sender operations cannot affect that membership.

The listener receives `(payload, meta)`. Frozen `meta.from` is authenticated by
the parent and equals `{ id, host, generation }` for an instance publisher or
`{ parent: true }` for `tray.publish`. Metadata is separate from payload, so
payload fields cannot forge the sender. A topic named `spawned` remains a business
topic and does not trigger lifecycle listeners.

Delivery is at most once to each current subscription. A non-ready subscriber
misses a publication. There is no persistence, replay or delivery acknowledgement.
Topics are non-empty strings and payloads must be portable. Synchronous listener
throws and async rejections are reported on their side; later listeners still run.
A rejected delivery send is reported on the parent, and a failed delivery handler
is reported on the child. Neither failure rejects the publisher.

路由选择仍按同一记录表的 spawn 顺序扫描，传给自定义 policy 的快照每次独立冻结，反映当次 inFlight，不缓存旧计数。
