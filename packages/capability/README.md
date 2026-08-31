# `@migaia/capability`

能力的运行时闸门：给每个可选功能一个统一的懒加载 + 启停生命周期 + 按租户隔离的开关表，登记一次，之后启用/关闭都走同一套状态机，不用每个调用点各写一遍资源释放的模板代码。

## 本文中的 Host 是什么

本文单独写 **Host** 时，始终指 `createCapabilityHost()` 创建的 **Capability Host**，不是全仓其他同名概念。它是一个进程内的功能开关与生命周期容器，持有能力注册表、共享 `context`、开关快照和启停状态；调用方通过 `register()` 登记功能，通过 `enable()`/`disable()` 启停功能，最后用 `dispose()` 关闭容器并释放已启用能力。

几个容易混淆的概念职责不同：

- **Capability Host（本文的 Host）**：回答“这个功能现在是否允许启用，以及启用后如何关闭”；不计算能力之间的依赖顺序。
- **Capability Graph**：回答“节点依赖谁、按什么顺序启动和反向释放”；它不是功能开关表。
- **PluginHost**：负责插件定义的安装、注册视图、管线阶段与回滚；插件可以在内部使用 Capability Host，但两者不是同一个容器。
- **Storage Host**：组合并按 ID 暴露多个 storage backend；它管理存储后端，不管理通用功能开关。
- **Realm Host**：若未来发布，用于控制 Worker、线程或子进程的启动、健康、关闭与强制终止；它提供隔离边界，不负责业务能力登记。

因此，下文“Host 不承担依赖图编排”的完整含义是：**Capability Host 只管理每项能力自身的准入与启停，不读取 `provider → consumer` 依赖边，也不会替调用方决定跨能力的启动顺序。**

## 适用与不适用场景

**适用**：某个功能需要"开关关着时代码不下载"（配合 `activate()` 内部 `await import()`）、需要启停生命周期（启用给 handle，关闭必须真释放 I/O 连接/订阅/端口等资源）、或者需要按租户/按开关表隔离哪些能力当前允许启用——比如灰度发布、按租户开关实验性面板、线上不重新部署就能回退的功能开关。

这里的“静态 required provider DAG”可以拆开理解：

- **provider** 是提供能力的节点，例如配置服务、数据库连接或日志服务；**consumer** 是使用该能力的节点。
- **required** 表示这是硬依赖：provider 未注册或启动失败时，consumer 不能启动；它不是“有则使用”的 optional 依赖。
- **DAG** 是“有向无环图”（Directed Acyclic Graph）：依赖有明确方向，并且不允许 A 依赖 B、B 又间接依赖 A 的循环。
- **静态** 表示所有节点和依赖边必须在首次 `ready()` 前登记完成；`ready()` 会冻结注册表。运行期间不能增加、删除或替换节点。

例如“配置服务 → 用户服务 → 结算面板”表示用户服务必须等配置服务就绪，结算面板又必须等用户服务就绪。Graph 会按这个方向启动，关闭时反向释放：先释放结算面板，再释放用户服务，最后释放配置服务。若你的需求只是独立功能开关，不存在这种跨能力启动顺序，就不需要 Graph。

**不适用**：Host 不承担上述依赖图编排；需要静态 required provider DAG 时使用下方的 `@migaia/capability/graph`。如果只想检查“一组节点及其 required 依赖是否合法”并计算确定的启动顺序，不需要创建服务、不执行节点的 `start()`、也不管理 `release()`，则直接使用 `@migaia/capability/graph/topology`。

这里提到的其他能力边界分别是：

- **optional dependency（可选依赖）与 notification（变化通知）**：consumer 可以在 provider 缺失时继续运行，并在 provider 后来可用、失败、恢复或被替换时收到通知，再按策略选择继续、刷新快照或重启。例如“订单服务可以没有推荐引擎照常下单；推荐引擎上线后再启用推荐”。静态 Graph 当前只接受 `required: true`，不提供这套可选绑定与通知策略。
- **dynamic replacement（运行时替换）**：Graph 已经运行后，仍可增加、删除或替换节点及依赖边，并只暂停、释放和重启受影响的 consumer。例如不重启整个应用就把支付插件 v1 换成 v2。静态 `@migaia/capability/graph` 会在 `ready()` 后冻结拓扑；确实需要这种能力时使用独立的 `@migaia/capability/graph/dynamic`，并由组合层负责被替换资源的物理释放。
- **cross-realm adapter（跨运行域适配器）**：让能力实际运行在另一个 Worker、线程或子进程中，同时把启动、健康检查、关闭、强制终止和错误链映射回当前 Graph。它适合需要隔离同步死循环、重型任务或进程故障的场景，不等同于普通的 RPC。当前包没有发布这种 adapter；浏览器默认仍在同一 realm，不能用 Promise 超时冒充真正终止。

Host 也**不能**让一个静态 import 进来的能力变免费——体积只有 `activate()` 内部真正用 `await import()` 时才省下来，闸门只是把这个写法变成一等公民，省体积的是打包器本身。

## 安装

```bash
pnpm add @migaia/capability
```

## 目录

- [宿主创建与生命周期方法](#宿主创建与生命周期方法)
- [状态与枚举常量](#状态与枚举常量)
- [静态 Capability Graph](#静态-capability-graph)
- [Dynamic Graph generation leases](#dynamic-graph-generation-leases)
- [错误码与错误结构](#错误码与错误结构)
- [高阶组合示例](#高阶组合示例)
- [构建门禁](#构建门禁)

完整签名、边界行为与错误码，见 [USEGUIDE.md](./USEGUIDE.md)。

<a id="静态-capability-graph"></a>

## 静态 Capability Graph

Graph 位于独立 public subpath：

```ts
import {
  createCapabilityGraph,
  type IGraphNodeId,
  type IGraphNodeDefinition
} from '@migaia/capability/graph'
```

它只管理静态 required provider-consumer DAG：首次 `ready()` 冻结注册表，检测 unknown provider/重复 edge/cycle，按稳定拓扑顺序启动；启动失败会回滚已启动节点，`dispose()` 按逆拓扑释放。节点的 `start()` 可以通过 `context.get(provider)` 读取 direct ready provider，并用 `context.own(resource, descriptor)` 登记 auxiliary resource；primary `value + release` 只由 Graph 所有一次。

无状态拓扑入口 `@migaia/capability/graph/topology` 的公开节点 `ordinal` 是一次性注册位置：对于 `nodeCount` 个节点，必须唯一且连续覆盖 `[0, nodeCount)`。不满足时通过调用方提供的 `onInvalid` 报告 `invalid-node` 或 `duplicate-ordinal`，不会静默排序或重写输入。

```ts
const graph = createCapabilityGraph({ onError: (error) => console.error(error) })
const provider = 'provider' as IGraphNodeId
graph.register({
  id: provider,
  kind: 'service',
  dependencies: [],
  start: () => ({ value: { ready: true }, release: () => undefined })
})
const consumer = 'consumer' as IGraphNodeId
graph.register({
  id: consumer,
  kind: 'consumer',
  dependencies: [{ provider, required: true }],
  start: ({ get }) => ({ value: get(provider), release: () => undefined })
})
await graph.ready()
const service = graph.get<{ readonly ready: boolean }>(consumer, provider)
await graph.dispose()
```

静态 Graph core 只拥有 required 拓扑、启动顺序与生命周期协调，不反向依赖上层组合框架或平台适配器。optional/notification 与 cross-realm 仍是独立的未发布边界，dynamic replacement 则由 `@migaia/capability/graph/dynamic` 单独提供，避免把运行时 mutation 混入静态 Graph。

---

<a id="宿主创建与生命周期方法"></a>

## 宿主创建与生命周期方法

```ts
import {
  createCapabilityHost,
  type ICapabilityHandle,
  type ICapabilityState,
  type ICapabilityEnableResult,
  type ICapabilityDefinition,
  type ICapabilityHostOptions,
  type ICapabilityHost
} from '@migaia/capability'
```

**`createCapabilityHost`｜10 秒上手** —— 创建一个能力容器：

```ts
import { createCapabilityHost, type ICapabilityHandle } from '@migaia/capability'

type INotificationCenter = ICapabilityHandle & {
  show(message: string): void
}

const mount = document.querySelector<HTMLElement>('#notification-center')!
const capabilities = createCapabilityHost(
  { mount },
  { flags: { notificationCenter: true } }
)

capabilities.register<INotificationCenter>({
  name: 'notificationCenter',
  activate({ mount }) {
    const panel = document.createElement('output')
    mount.append(panel)
    return {
      show(message) {
        panel.textContent = message
      },
      dispose() {
        panel.remove()
      }
    }
  }
})

async function openNotificationCenter(message: string) {
  const result = await capabilities.enable('notificationCenter')
  if (result.status !== 'enabled') return

  const notifications = capabilities.handle<INotificationCenter>('notificationCenter')
  notifications?.show(message)
}

async function closeNotificationCenter() {
  await capabilities.disable('notificationCenter')
}

async function shutdownApplication() {
  await capabilities.dispose()
}
```

这里把“通知中心”当作一个按需能力：用户打开通知抽屉时调用 `openNotificationCenter()`，此时才创建 DOM 资源；启用成功后，`enable()` 返回的是状态而不是业务对象，再通过 `handle<INotificationCenter>()` 取得能力并调用 `show()`。用户关闭抽屉时调用 `disable()`，它会等待 handle 的 `dispose()` 删除面板；整个应用退出时调用 Host 的 `dispose()`，兜底关闭所有仍启用的能力。

`flags.notificationCenter` 是远端配置或权限开关：为 `false` 时 `enable()` 返回 `gated`，不会创建面板。临时离开页面但以后还允许再次打开，用 `disable()`；配置或权限被撤回时用 `setFlag('notificationCenter', false)`，它会立即作废在途启用并释放现有 handle。

签名：`createCapabilityHost<Context>(context: Context, options?: ICapabilityHostOptions): ICapabilityHost<Context>`。

第二参数 `ICapabilityHostOptions` 全部字段：

- `flags?: Readonly<Record<string, boolean>>` —— 开关表快照，只在**创建时**复制一份；只有自有、可枚举、值严格等于 `true` 的数据属性才算允许，之后必须调用 `setFlag()`/`setFlags()` 才能改变
- `onError?: (name: string, error: unknown) => void` —— 激活/释放失败的上报口；reporter 自己抛错也不会破坏闸门状态机

`options` 本身必须是对象或函数（`null`/原始值会抛 `INVALID_OPTION` 的 `TypeError`）；`onError` 若提供必须是函数。

**`ICapabilityHandle`｜3 秒上手** —— `activate()` 必须返回的对象形状，唯一公共约束是有 `dispose()`；业务方法由具体能力自行扩展：

```ts
type ICapabilityHandle = { dispose(): void | PromiseLike<void> }
```

例如上面的 `INotificationCenter` 在此基础上增加了 `show(message)`。Host 只负责保存和释放 handle，不会包装或代理业务方法；调用方在 `enable()` 返回 `enabled` 后，通过 `handle<INotificationCenter>('notificationCenter')` 取回同一个对象并调用它。

**`register`｜5 秒上手** —— 登记一个能力定义：

```ts
capabilities.register({
  name: 'greeting',
  activate(ctx) {
    const timer = setInterval(() => console.log(`hi, ${ctx.userId}`), 1000)
    return { dispose: () => clearInterval(timer) }
  }
})
```

参数 `ICapabilityDefinition<Context, Handle>` 全部字段：

- `name: string`（必填）—— 非空字符串；同名重复登记抛 `ALREADY_REGISTERED`
- `activate(context: Context): Handle | Promise<Handle>`（必填）—— 允许异步，正是为了在里面 `await import()` 按需加载

`name` 非字符串/空字符串抛 `INVALID_NAME`（`TypeError`）；`activate` 非函数抛 `INVALID_ACTIVATE`（`TypeError`）。

**`names`｜3 秒上手** —— 只读属性，当前已登记的全部名字：

```ts
capabilities.names // ['greeting']
```

无参数，无选项。

**`state`｜3 秒上手** —— 查询某个能力当前状态：

```ts
capabilities.state('greeting') // 'off' | 'gated' | 'activating' | 'on' | 'failed'
```

参数：`name: string`（必填）。未注册的名字抛 `NOT_REGISTERED`。返回值类型见下方 [`CapabilityState`](#状态与枚举常量)。

**`handle`｜3 秒上手** —— 取已启用能力的 handle：

```ts
const h = capabilities.handle<{ dispose(): void }>('greeting') // 未启用返回 undefined
```

参数：`name: string`（必填），泛型 `Handle` 可选指定返回类型。未注册的名字抛 `NOT_REGISTERED`。

**`error`｜3 秒上手** —— 查上一次激活或释放失败的原因：

```ts
capabilities.error('greeting') // unknown，成功重启或重新配置后会被清空
```

参数：`name: string`（必填）。未注册的名字抛 `NOT_REGISTERED`。

**`setFlag`｜5 秒上手** —— 更新单个开关：

```ts
capabilities.setFlag('greeting', false) // 关闭：同步作废在途激活并释放已有 handle
capabilities.setFlag('greeting', true) // 打开：不会自动启用，仍需调用 enable()
```

参数：`name: string`（必填）、`enabled: boolean`（必填，只有严格等于 `true` 才算允许，非 `true` 一律视为拒绝）。无其他选项。

**`setFlags`｜5 秒上手** —— 原子替换整份开关快照：

```ts
capabilities.setFlags({ greeting: true, persistence: false })
```

参数：`flags: Readonly<Record<string, boolean>>`（必填）——新快照里没列出的能力一律按拒绝处理，不会保留旧快照里残留的 `true`。无其他选项。

**`enable`｜10 秒上手** —— 幂等启用，推荐入口：

```ts
const result = await capabilities.enable('greeting')
// { status: 'enabled' } | { status: 'gated' } | { status: 'cancelled' } | { status: 'failed'; error: unknown }
```

参数：`name: string`（必填）。无其他选项。并发调用共享同一次 `activate()`；开关为假时直接返回 `{ status: 'gated' }`，不会"偷偷打开"。返回值全部字段见下方 [`ICapabilityEnableResult`](#状态与枚举常量) 说明。

**`enableResult`｜3 秒上手** —— `enable()` 的别名，语义完全一致：

```ts
await capabilities.enableResult('greeting')
```

参数与返回值同 `enable`，无其他选项。

**`disable`｜5 秒上手** —— 关闭并等待 `dispose()`（含异步）真正完成：

```ts
const changed = await capabilities.disable('greeting') // boolean：是否确实关掉了一个启用态能力
```

参数：`name: string`（必填）。无其他选项。未注册抛 `NOT_REGISTERED`；host 已 disposed 抛 `HOST_DISPOSED`。

**`dispose`｜10 秒上手** —— 整体关闭 host，按真实激活顺序反向（LIFO）：

```ts
await capabilities.dispose() // 之后 host 永久不可用
```

无参数，无选项。首次调用返回唯一的 completion Promise；该 Promise 完成前的后续调用立即以 `HOST_TRANSITIONING` 拒绝，完成后才恢复为返回同一个 canonical Promise。

**`enableLegacyBoolean`｜5 秒上手** —— 同步/布尔风格兼容适配器：

```ts
const ok: boolean = await capabilities.enableLegacyBoolean('greeting')
```

参数：`name: string`（必填），无其他选项。语义与 `enable()` 共享同一次激活，只是把结果压缩成布尔值。

**`disableNow`｜5 秒上手** —— 同步触发关闭，不等待异步清理完成：

```ts
const changed: boolean = capabilities.disableNow('greeting')
```

参数：`name: string`（必填），无其他选项。确定要等清理完成用 `disable()`。

**`disposed`｜3 秒上手** —— 只读属性，host 是否已整体关闭：

```ts
capabilities.disposed // boolean
```

无参数。`disposed === true` 之后，`register`/`setFlag`/`setFlags`/`enable` 类方法都会抛错或被拒绝；`names`/`state`/`handle`/`error` 等只读诊断方法仍然可用。

---

<a id="状态与枚举常量"></a>

## 状态与枚举常量

```ts
import { CapabilityState, CapabilityEnableStatus } from '@migaia/capability'
```

**`CapabilityState`｜5 秒上手** —— 能力生命周期的五个状态，用于 `switch`/比较：

```ts
if (capabilities.state('greeting') === CapabilityState.on) {
  /* ... */
}
```

全部取值：

- `off` —— 开关允许，但尚未启用
- `gated` —— 开关明确拒绝（与"从未尝试启用"的 `off` 区分开）
- `activating` —— `activate()` 正在执行，尚未 settle
- `on` —— 已启用，持有一个有效 handle
- `failed` —— 上一次激活失败，或代数匹配下的释放清理失败

`ICapabilityState` 是这五个字符串字面量的联合类型。

**`CapabilityEnableStatus`｜5 秒上手** —— `enable()`/`enableResult()` 返回结果的 `status` 取值：

```ts
if (result.status === CapabilityEnableStatus.failed) console.error(result.error)
```

全部取值：`enabled`、`gated`、`cancelled`、`failed`。对应的完整返回值类型 `ICapabilityEnableResult` 全部分支：

- `{ status: 'enabled' }`
- `{ status: 'gated' }` —— 开关拒绝，未尝试激活
- `{ status: 'cancelled' }` —— 激活在完成前被开关关闭或 host 释放作废
- `{ status: 'failed'; error: unknown }` —— `activate()` 抛错或返回值不是合法 handle

---

<a id="错误码与错误结构"></a>

## 错误码与错误结构

```ts
import {
  CapabilityErrorCode,
  type ICapabilityErrorCode,
  CAPABILITY_SOURCE
} from '@migaia/capability'
```

**`CapabilityErrorCode`｜5 秒上手** —— 本包全部错误的稳定 `code`，配合 `error.source === CAPABILITY_SOURCE` 按 `(source, code)` 二元组识别：

```ts
if (error.code === CapabilityErrorCode.hostDisposed) {
  /* ... */
}
```

全部取值：

- `hostDisposed`（`HOST_DISPOSED`）—— 在已 `dispose()` 的 host 上调用变更方法（`register`/`setFlag`/`setFlags`/`enable`/`disable` 等）
- `hostTransitioning`（`HOST_TRANSITIONING`）—— 在某个 disposer/reporter 的重入窗口内尝试调用变更方法，或在首次 `dispose()` 完成前再次调用 `dispose()`
- `notRegistered`（`NOT_REGISTERED`）—— 按名字查询/操作一个从未 `register()` 过的能力
- `alreadyRegistered`（`ALREADY_REGISTERED`）—— `register()` 传入的 `name` 已经登记过
- `invalidName`（`INVALID_NAME`）—— `register()` 传入的 `name` 不是非空字符串（`TypeError`）
- `invalidActivate`（`INVALID_ACTIVATE`）—— `register()` 传入的 `activate` 不是函数（`TypeError`）
- `invalidHandle`（`INVALID_HANDLE`）—— `activate()` 的返回值缺少可调用的 `dispose`（`TypeError`）
- `gated`（`GATED`）—— 保留给未来诊断/事件通道；当前 `enable()`/`enableResult()` 用结构化返回 `{ status: 'gated' }` 表达拒绝，从不抛出这个码
- `invalidOption`（`INVALID_OPTION`）—— `options`/`flags`/`definition` 快照失败（例如恶意 Proxy 的 getter 抛错），或 `options` 本身不是对象/函数

`ICapabilityErrorCode` 是这些取值的联合类型。

**`CAPABILITY_SOURCE`｜3 秒上手** —— 本包抛出的每个错误上 `source` 字段的固定值：

```ts
CAPABILITY_SOURCE // '@migaia/capability'
```

常量字符串，无调用参数。

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. 按开关懒加载一个持久化能力，附错误上报与优雅收尾

```ts
import { createCapabilityHost } from '@migaia/capability'

const capabilities = createCapabilityHost(
  { store },
  {
    flags: { persistence: true },
    onError: (name, error) => reportError(name, error)
  }
)

capabilities.register({
  name: 'persistence',
  async activate({ store }) {
    // 只有开关打开、真正 enable() 时才会下载这个 chunk
    const { persist, memoryStorage } = await import('@migaia/store-persist')
    const handle = persist(store, { key: 'settings', storage: memoryStorage() })
    return { dispose: () => handle.dispose() }
  }
})

const result = await capabilities.enable('persistence')
if (result.status === 'enabled') console.log('持久化已启用')

await capabilities.disable('persistence')
await capabilities.dispose()
```

### 2. 多租户隔离：每个租户一份独立开关表

```ts
import { createCapabilityHost } from '@migaia/capability'

function createTenantCapabilities(tenant: string, flags: Record<string, boolean>) {
  const host = createCapabilityHost({ tenant }, { flags })
  host.register({
    name: 'experimental-ai',
    activate: async ({ tenant }) => {
      const controller = await connectAiSidecar(tenant)
      return { dispose: () => controller.close() }
    }
  })
  return host
}

const acme = createTenantCapabilities('acme', { 'experimental-ai': true })
const globex = createTenantCapabilities('globex', { 'experimental-ai': false })

await acme.enable('experimental-ai') // { status: 'enabled' }
await globex.enable('experimental-ai') // { status: 'gated' }
```

### 3. `setFlag(false)` 触发的原子回退：无需再手动调用 `disable()`

```ts
import { createCapabilityHost, CapabilityState } from '@migaia/capability'

const host = createCapabilityHost({}, { flags: { worker: true } })
host.register({
  name: 'worker',
  async activate() {
    const port = await connectWorkerPort()
    return { dispose: () => port.close() }
  }
})

await host.enable('worker')
host.state('worker') // CapabilityState.on

host.setFlag('worker', false) // 同步作废在途激活/释放已有 handle，不需要再调用 disable()
host.state('worker') // CapabilityState.gated
```

### 4. 并发 `enable()` 幂等共享同一次激活

```ts
import { createCapabilityHost } from '@migaia/capability'

const host = createCapabilityHost({}, { flags: { search: true } })
let activateCalls = 0
host.register({
  name: 'search',
  async activate() {
    activateCalls++
    const index = await buildSearchIndex()
    return { dispose: () => index.close() }
  }
})

const [a, b, c] = await Promise.all([
  host.enable('search'),
  host.enable('search'),
  host.enableLegacyBoolean('search')
])
activateCalls // 1 —— 三个并发调用共享同一次 activate()
```

### 5. 能力启用失败后查询原因，再重新配置恢复

```ts
import { createCapabilityHost, CapabilityState } from '@migaia/capability'

const host = createCapabilityHost({}, { flags: { flaky: true } })
host.register({
  name: 'flaky',
  activate: async () => {
    throw new Error('chunk 404')
  }
})

const result = await host.enable('flaky')
result // { status: 'failed', error: Error('chunk 404') }
host.state('flaky') // CapabilityState.failed
String(host.error('flaky')) // 包含 'chunk 404'

host.setFlag('flaky', false) // 重新配置会清空 error(name)
host.error('flaky') // undefined
```

---

<a id="构建门禁"></a>

## 构建门禁

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```

## Dynamic Graph generation leases

`@migaia/capability/graph/dynamic` 为运行期 definition 增删提供唯一 Graph authority。composition owner
通过 `startBatch(entries)` 收到 exact binding；消费者用 `acquireBinding(id)` 取得 generation lease，并在停止
使用后调用幂等 `release()`。remove/replace/dispose 会先 seal 旧 generation，再把同一个 non-rejecting fence
交给 `releaseBatch(entries, fence)`；物理 provider 清理不得越过该 fence。

mutation metrics 同时报告 affected-frontier 的 `visitedNodes`、`visitedEdges`、`queueOperations`、
`queueTimeMs`、`wallTimeMs` 与 `fullScan`。拓扑使用按 admission ordinal 的确定性优先队列，复杂度上界为
`O((VΔ + EΔ) log VΔ)`，不会在每个输出节点重新 filter/sort 整个 frontier。
