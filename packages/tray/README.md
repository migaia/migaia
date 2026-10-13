# `@migaia/tray`

Tray 提供静态 capability 组合与完整 PluginHost 实例管理。静态组合使用 `createTrayGraph`，Graph 负责启动与释放；实例层使用 `defineTrayHost` / `createTray({ hosts })`，RPC 与 supervision 负责 coroutine、Worker 和子进程的连接及执行。

## 适用边界

**适用**：同一 realm 内、启动前就能确定完整集合的配置、服务、资源与派生值。

静态 Graph 的边界限于同 realm；运行期完整 Host 实例由下面 Hosts 层管理。跨机器发现、browser Worker、UI、持久消息与 failover retry 不在当前范围。

## 安装

```bash
pnpm add @migaia/tray
```

静态 Graph 和 Hosts 实例 API 从 `@migaia/tray` 导入；单个 PluginHost 托管组合从 `@migaia/tray/host` 导入。

## 最小可运行示例

```ts
import { createTrayGraph, type ITrayEntryDefinition, type ITrayKey } from '@migaia/tray'

const key = (value: string): ITrayKey => value as ITrayKey
const configKey = key('config')
const apiKey = key('api')

const entries: readonly ITrayEntryDefinition<unknown>[] = [
  {
    key: configKey,
    kind: 'value',
    start: () => ({ value: { baseUrl: '/api' }, release: () => undefined })
  },
  {
    key: apiKey,
    kind: 'service',
    requires: [configKey],
    start: (context) => {
      const config = context.get<{ baseUrl: string }>(configKey)
      const client = { baseUrl: config.baseUrl }
      return { value: client, release: () => undefined }
    }
  }
]

const tray = createTrayGraph(entries)
await tray.ready()
const api = tray.get<{ baseUrl: string }>(apiKey)

try {
  console.log(api.baseUrl)
} finally {
  await tray.dispose()
}
```

关键规则：

- `createTrayGraph()` 只接收完整数组；key 必须是非空字符串且不能重复，`requires` 只能引用同一数组内的其他 entry。
- `start()` 必须返回或 resolve 为 `{ value, release }`；依赖可通过 `context.get()` 读取。
- 必须先 `await tray.ready()` 再 `get()`。未就绪、失败、未知 key 或已释放时都会显式失败，不返回半初始化值。
- `dispose()` 由 Graph 按依赖逆序释放，幂等并保留清理失败。

## 错误处理

所有 Tray 自有边界错误都带 `source: '@migaia/tray'` 与稳定 `code`。生产代码按 `(source, code)` 分支，不依赖 message：

```ts
import { TRAY_SOURCE, TrayErrorCode } from '@migaia/tray'

try {
  tray.get(apiKey)
} catch (error) {
  const diagnostic = error as { source?: string; code?: string }
  if (diagnostic.source === TRAY_SOURCE && diagnostic.code === TrayErrorCode.unavailable) {
    // 等待 ready()，或处理启动/就绪门失败。
  } else {
    throw error
  }
}
```

完整 entry 契约、readiness gate、状态、错误码与生命周期语义见 [USEGUIDE.md](./USEGUIDE.md)。

## Hosts：实例发现与生命周期

根入口的 `defineTrayHost` / `createTray({ hosts })` 管理完整 PluginHost 实例；
`createTrayGraph(entries)` 继续管理静态 capability 集合。每个实例与父 Host 独立。

```ts
import { defineFeature, definePlugin } from '@migaia/plugin-host'
import { createTray, defineTrayHost } from '@migaia/tray'

const echo = defineFeature(() => ({ echo: (value: string) => value }))
const agent = defineTrayHost({
  name: 'agent',
  plugins: () => [definePlugin({
    name: 'node', features: { svc: echo }, install: () => ({})
  })] as const,
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

`defineTrayHost` 的必填字段是 `name`、`plugins` 与 `exposes`。`exposes` 使用
`plugin.feature` 路径，remote 调用使用 `plugin.feature.method` 路径。
可选 `config(input)` 在每次实例初始化时验证配置；`supervisor` 接收
`restart: { mode, maxRestarts, windowMs, initialDelayMs }` 与 `startupTimeoutMs`。
`entry` 接收 `string | URL`，仅适用于 `thread` / `process`；
`limits: { heapBytes }` 仅适用于 `thread`，`sandbox: { name, wrap }` 仅适用于 `process`。

`createTray({ hosts, routing?, probe?, report? })` 返回 `ITray`；`hosts` 必须是
`defineTrayHost` 返回的定义数组。`probe` 接收一个 `IRpcProbe` 或其只读数组，
`report(error)` 接收运行与清理诊断，默认使用 `console.error`。
子入口 `serveTrayHost(host, { probe?, report? })` 返回 `Promise<void>`，
在子 realm 内等待退出请求与插件清理，然后结束 Worker 或进程。

`plugins(info, trayPlugin)` 在每次 generation init 时调用；`info` 包含 id、host、
generation 和 validator 的 config 输出。插件通过
`defineFeature(factory, { tray: trayPlugin.getFeature('tray') })` 声明依赖，
从 `deps.tray.self()` 读取身份，`await deps.tray.to(otherHost, id)` 得到 admission-bound
remote，`deps.tray.exit(error?)` 结束当前实例。第一次 exit 决定结果：无错误是 clean exit，
有错误是 crash；PluginHost disposer 执行后才结束 task/realm。根入口只导出
`ITrayClientPlugin` 类型，不提供 runtime client 单例。

remote 的统一调用形式是 `request|notify|stream(path, payload, options?)`；
`options` 的类型为 `ITrayCallOptions`，只包含 `signal?: AbortSignal` 与 `timeoutMs?: number`。
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
routing namespace 和 pub/sub 由后续 mesh 实现。`pick(candidates, context)` 同步返回实例 id，
`context` 为 `{ host, sequence }`。名称须符合 `^[a-z][A-Za-z0-9]*$`，
不能使用内置 policy 名称或函数、对象的保留属性名；非法定义抛 `TRAY_ROUTING_INVALID`。


## 高阶组合示例

### 托管 PluginHost：动态加载、依赖阻塞与确定性卸载

`@migaia/tray/host` 是 Tray 的 Host stage/decorator，不创建第二个运行时身份。`createHost()`
异步完成 admission、依赖图启动与 Host 发布后才返回；返回值实现异步显式资源管理：

```ts
import { PluginHost, defineFeature, definePlugin } from '@migaia/plugin-host'
import { createHost } from '@migaia/tray/host'

class AppHost extends PluginHost<Record<string, never>, string> {}

const provider = definePlugin({
  name: 'provider',
  features: { value: defineFeature(() => ({ value: 1 })) },
  install: () => ({ providerValue: 1 })
})

await using host = await createHost({
  create: () =>
    new AppHost({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: 100 } }),
  plugins: [provider] as const,
  mutationAdmissionMs: 100,
  quiescenceMs: 100,
  shutdown: { mode: 'bounded' }
})

await host.use(definePlugin({
  name: 'late',
  features: {
    value: defineFeature(() => ({}), { provider: provider.getFeature('value') })
  },
  install: () => ({ late: true })
}))
await host.unUse('provider') // `late` 保留为 blocked definition，不再留在 Host 可见面。
```

同名 `replace()` 与 provider 恢复会复用该 definition 的 Host ordering slot；真正
`unUse()` 删除 definition 后 slot 永久退休，之后同名 `use()` 获得新的单调 slot。逻辑 bounded
结果可能先返回 `cleanupComplete: false`，但 `physicalCompletion` 严格等待 Graph binding lease、
pipeline lease、插件 disposer 与资源 disposer，未完成前不会启动后项。不能使用
`await using` 的编译目标可用 `try/finally { await host.dispose() }`。

### Loader、Adapter 与 Runtime 子路径

三个能力只从显式子路径导入，不由 Tray 根入口聚合：

```ts
import { defineLoader, loadIntoHost } from '@migaia/tray/loader'
import { defineAdapter } from '@migaia/tray/adapter'
import { createRuntime } from '@migaia/tray/runtime'
```

Loader 只负责 `source → { value, release }`，Adapter 只负责 artifact 到插件描述子的转换；
`loadIntoHost()` 才拥有 `load → adapt → use/replace` 事务。提交前失败回滚临时 scope，提交后
artifact 由对应 definition generation 清理。Runtime 从托管 Host 取得 exact generation lease，
只向 callback 发布目标插件的 extensions；callback settle 前不会释放 lease。`dispose()` 停止
新 run、abort active signal，并按 `bounded` 或 `strict-drain` 策略观察真实完成，不宣称终止
不合作的 same-realm callback。

Runtime callback 同时收到只绑定当前 run、插件名称与 generation 的 `context.self`。调用
`self.unUse()` 或 `self.replace(plugin)` 会同步返回不具 thenable 行为的 ticket；ticket 的
`completion` 只在 callback settle、lease release 后由 managed Host queue 执行。callback 内
等待同一 ticket 的 completion 会立即得到 `RUNTIME_CONTRACT_INVALID`，而 callback 返回 ticket
后可在外层等待 `ticket.completion`。外部 `host.unUse/replace` 继续遵循原有 queue 与 lease
语义；callback 不应捕获 concrete Host 做 self mutation。


## Routing and publish/subscribe

`tray.routing.roundRobin(host)` and `tray.routing('roundRobin', host)` share one
sequence and select a ready instance for each request, notify or stream.
`leastInFlight` selects the fewest pending business calls, with spawn order breaking
ties. Custom policies use `defineRoutingPolicy(name, pick)` and are registered by
`createTray({ routing })` or a host DSL's `routing` tuple. Child plugins declare
custom names in their own host DSL and call both forms through `deps.tray.routing`.
The picker runs synchronously on the parent. Calls never retry or fail over.

`tray.publish(topic, payload)` and `deps.tray.publish(topic, payload)` fan out to
current subscribers at most once. `subscribe(topic, (payload, meta) => ...)` keeps
business topics separate from lifecycle events. Frozen `meta.from` is authenticated
by the parent: `{ id, host, generation }` for an instance, `{ parent: true }` for a
parent publication. Payload fields cannot impersonate the sender. Subscriptions
end with their admission and generation; messages sent while an instance is not
ready are missed. There is no replay, persistence or delivery acknowledgement.
