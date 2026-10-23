# @migaia/tray 使用指南

先选下面的完整任务，再查后面的静态资源图、托管插件、加载与实例注册表契约。本页六例运行真实的 Tray、PluginHost 与 Runtime，全部在同一运行环境中；它们不充当 Worker、进程、沙箱或跨机器执行证据。

## 按场景查找

| 场景                               | 主要 API          | 详细说明                                        |
| ---------------------------------- | ----------------- | ----------------------------------------------- |
| 先启动依赖，再按反序释放服务       | `createTrayGraph` | [完整示例](#先启动依赖再按反序释放服务)         |
| 仅重试暂时阻塞的就绪门             | `createTrayGraph` | [完整示例](#仅重试暂时阻塞的就绪门)             |
| 等待提供者安装后再启用依赖插件     | `createHost`      | [完整示例](#等待提供者安装后再启用依赖插件)     |
| 提交成功后才交接加载制品的清理责任 | `loadIntoHost`    | [完整示例](#提交成功后才交接加载制品的清理责任) |
| 取消后仍等待回调实际结束           | `createRuntime`   | [完整示例](#取消后仍等待回调实际结束)           |
| 回调结束后再卸载当前插件           | `createRuntime`   | [完整示例](#回调结束后再卸载当前插件)           |

## 运行准备

安装本包；托管 Host 与运行场景直接导入 plugin-host，因此也要直接安装它。

```bash
pnpm add @migaia/tray @migaia/plugin-host
```

每个示例可独立保存为 ESM TypeScript 文件，用 Node 24 执行。示例用显式 Promise 门与生命周期结果控制顺序；不需要伪端口、浏览器全局对象或后台 Worker。生产中应沿同一 owner 的 dispose / physicalCompletion 收尾，保留 cause 和清理结果。

## 先启动依赖，再按反序释放服务

应用启动服务时配置还没准备好，退出时又可能先释放服务仍在使用的配置。

只靠数组顺序与分散的 finally 无法表达依赖；调整登记顺序，就可能改变启动和释放的先后。

在服务的 requires 中声明配置键。createTrayGraph 构造时不启动，ready 先启动依赖，dispose 先释放使用者，再释放提供者。

### 示例参数

数组是 `createTrayGraph` 的唯一必填参数；`key` 是本例集中声明的 `ITrayKey`，`kind` 必填，本例分别为 `'service'` / `'value'`。`requires: [config]` 声明服务的直接依赖，省略时为空数组；`start(context)` 返回主值与可调用 `release`。`context.get<number>(config)` 的泛型只描述读取类型。未提供 `readiness`，默认无外部门；`ready()` / `dispose()` 均无参数。

```ts doc-test=run
import { createTrayGraph, type ITrayKey } from '@migaia/tray'

const config = 'config' as ITrayKey
const service = 'service' as ITrayKey
const events: string[] = []
const tray = createTrayGraph([
  {
    key: service,
    kind: 'service',
    requires: [config],
    start: (context) => {
      events.push('start:service')
      return {
        value: context.get<number>(config) * 2,
        release: () => {
          events.push('release:service')
        }
      }
    }
  },
  {
    key: config,
    kind: 'value',
    start: () => {
      events.push('start:config')
      return {
        value: 21,
        release: () => {
          events.push('release:config')
        }
      }
    }
  }
])
console.log('启动前：', tray.state, events.length)
await tray.ready()
console.log('值：', tray.get<number>(service))
await tray.dispose()
console.log(events.join(','))
console.log('之后：', tray.state)
```

输出：

```text
启动前： open 0
值： 42
start:config,start:service,release:service,release:config
之后： terminal
```

依次输出：启动前： open 0；值： 42；start:config,start:service,release:service,release:config；之后： terminal。

配置虽然排在数组第二项，仍先启动、后释放。本例是同一运行环境内、带显式 release 回调的资源组合，不证明 Worker 或进程隔离。

## 仅重试暂时阻塞的就绪门

外部提供者尚未就绪时服务不能启动，但暂时阻塞不应被当成永远无法恢复的启动失败。

一直读取同一份 blocked 快照会看到旧事实；无差别重试所有拒绝，又可能反复执行提供者已经判定失败的操作。

用 readiness getter 返回当前快照，blocked 后显式再次调用 ready；failed 是最终结果，会保留原来的拒绝 Promise。

### 示例参数

`readiness` 省略时没有外部门；本例 getter 返回 `{ state, error }` 快照，state 只能为 `'ready'`、`'blocked'`、`'failed'`。`blocked` 的 `error` 是等待原因，不启动服务；替换为 ready 快照后显式调用 `ready()` 才重采样。另一张图用 failed 快照证明原拒绝 Promise 缓存；`error: undefined` 表示该 ready 快照无错误，不是省略必需的启动结果。

```ts doc-test=run
import { createTrayGraph, type ITrayKey, type IGraphReadinessSnapshot } from '@migaia/tray'

const key = 'search' as ITrayKey
const waiting = new Error('提供者尚未就绪')
let snapshot: IGraphReadinessSnapshot = { state: 'blocked', error: waiting }
let starts = 0
const tray = createTrayGraph([
  {
    key,
    kind: 'service',
    get readiness() {
      return snapshot
    },
    start: () => {
      starts += 1
      return { value: 42, release: () => undefined }
    }
  }
])
try {
  await tray.ready()
} catch (error) {
  console.log('阻塞：', error === waiting, starts)
}
snapshot = { state: 'ready', error: undefined }
await tray.ready()
console.log('重试：', tray.state, starts, tray.get<number>(key))
await tray.dispose()

const failure = new Error('提供者失败')
const failed = createTrayGraph([
  {
    key,
    kind: 'service',
    readiness: { state: 'failed', error: failure },
    start: () => ({ value: 0, release: () => undefined })
  }
])
const first = failed.ready()
console.log('缓存：', first === failed.ready())
try {
  await first
} catch (error) {
  console.log('原因：', error === failure)
}
await failed.dispose()
```

输出：

```text
阻塞： true 0
重试： ready 1 42
缓存： true
原因： true
```

依次输出：阻塞： true 0；重试： ready 1 42；缓存： true；原因： true。

blocked 时没有启动服务，显式重试才重新采样；failed 保留同一个 Promise 与原错误。这里没有后台轮询，释放后也不能再次启动。

## 等待提供者安装后再启用依赖插件

插件先于必需的提供者到达，立即安装会暴露未就绪能力；直接丢弃，又迫使调用方稍后重新拼装依赖链。

只保存插件名称列表，无法区分已登记定义与已安装的就绪插件，也无法决定提供者移除时哪些使用者必须停下。

通过 Feature 引用声明依赖。createHost 保留 blocked 使用者，use 安装提供者后恢复依赖链，unUse 移除提供者时再次阻塞使用者。

### 示例参数

`create` 返回唯一 AppHost；原 PluginHost 的 `execution.mutationTimeoutMs` / `pipelineDrainTimeoutMs` 本例都显式设 `false`，不设相应期限。createHost 的 `create`、`plugins`、`mutationAdmissionMs`、`quiescenceMs`、`shutdown` 均必填无默认；两个预算本例为 `1000` 毫秒，`shutdown.mode: 'strict-drain'` 等实际清理，另一个可选值为 `'bounded'`。`provider.getFeature('value')` 默认必需引用，Feature 依赖映射的 `config` 键为回调依赖名；它不等于任意按插件名查找。`report` 未传，默认无自定义诊断回调。

```ts doc-test=run
import { PluginHost, defineFeature, definePlugin } from '@migaia/plugin-host'
import { createHost } from '@migaia/tray/host'

class AppHost extends PluginHost<Record<string, never>, string> {}
const create = () =>
  new AppHost({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
const events: string[] = []
const provider = definePlugin({
  name: 'config',
  features: { value: defineFeature(() => ({ base: '/api' })) },
  install: () => {
    events.push('config')
    return {}
  }
})
const consumer = definePlugin({
  name: 'screen',
  features: {
    value: defineFeature(() => ({}), { config: provider.getFeature('value') })
  },
  install: () => {
    events.push('screen')
    return {}
  }
})
const host = await createHost({
  create,
  plugins: [consumer] as const,
  mutationAdmissionMs: 1000,
  quiescenceMs: 1000,
  shutdown: { mode: 'strict-drain' }
})
try {
  console.log('启动前：', host.pluginState('screen'), events.length)
  const installed = await host.use(provider)
  console.log('之后：', installed.ok, host.pluginState('screen'))
  console.log(events.join(','))
  const removed = await host.unUse('config')
  console.log('移除后：', removed.ok, host.pluginState('screen'))
} finally {
  await host.dispose()
}
```

输出：

```text
启动前： blocked 0
之后： true ready
config,screen
移除后： true blocked
```

依次输出：启动前： blocked 0；之后： true ready；config,screen；移除后： true blocked。

阻塞中的使用者没有提前安装，提供者到达后先安装再恢复使用者。必需依赖来自 Feature 引用；本例管理一个本地 PluginHost，不证明原生宿主启动。

## 提交成功后才交接加载制品的清理责任

加载插件时还取得了资源：转换失败时必须释放，安装成功后又必须保留到对应插件移除。

把加载、转换和安装分散到独立的 try/finally，容易提前释放已提交资源，或遗漏尚未提交的资源。

通过 defineLoader、defineAdapter 与 loadIntoHost 串起事务。提交前的制品由事务暂管，转换失败会回滚，mutation 提交后才交给对应插件代次。

### 示例参数

`host`、`source`、`loader`、`adapter`、`mutation`、`timeoutMs` 均必填；`mutation: 'use'` 安装定义，另一个值为 `'replace'`，`timeoutMs: false` 不设截止点，数值须有限非负。loader 接收数字并返回 `{ value, release: { force } }`，release 是 lifecycle descriptor；adapter 返回插件描述子。省略 `signal` 只表示没有 caller bridge，期限或 scope 仍可中止，且仅合作通知。`committed` 决定制品归属，`ok` 决定成功 view 的静态能力；创建 Host 的配置与上一场景一致。

```ts doc-test=run
import { PluginHost } from '@migaia/plugin-host'
import { createHost } from '@migaia/tray/host'
import { defineLoader, loadIntoHost } from '@migaia/tray/loader'
import { defineAdapter } from '@migaia/tray/adapter'

class AppHost extends PluginHost<Record<string, never>, string> {}
const create = () =>
  new AppHost({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
const host = await createHost({
  create,
  plugins: [],
  mutationAdmissionMs: 1000,
  quiescenceMs: 1000,
  shutdown: { mode: 'strict-drain' }
})
let releases = 0
const loader = defineLoader({
  load: (source: number) => ({
    value: source,
    release: {
      force: () => {
        releases += 1
      }
    }
  })
})
const adapter = defineAdapter({
  adapt: (value: number) => ({
    name: 'answer' as const,
    install: () => ({ answer: () => value })
  })
})
try {
  const result = await loadIntoHost({
    host,
    source: 42,
    loader,
    adapter,
    mutation: 'use',
    timeoutMs: false
  })
  console.log('已提交：', result.ok, result.committed, releases)
  if (result.ok) console.log('值：', result.view.extensions.answer())
  await host.unUse('answer')
  console.log('已释放：', releases)
  const primary = new TypeError('制品转换失败')
  try {
    await loadIntoHost({
      host,
      source: 7,
      loader,
      adapter: defineAdapter({
        adapt: () => {
          throw primary
        }
      }),
      mutation: 'use',
      timeoutMs: false
    })
  } catch (error) {
    console.log('已回滚：', error === primary, (error as Error & { code?: string }).code, releases)
  }
} finally {
  await host.dispose()
}
```

输出：

```text
已提交： true true 0
值： 42
已释放： 1
已回滚： true ADAPTER_EXECUTION_FAILED 2
```

依次输出：已提交： true true 0；值： 42；已释放： 1；已回滚： true ADAPTER_EXECUTION_FAILED 2。

成功后资源保留到 unUse，转换失败则释放本次资源并保留原 TypeError。清理责任取决于 committed，不能只看 ok；实际工作未结束或清理自身失败时，还需观察后续清理结果。

## 取消后仍等待回调实际结束

调用方取消任务时，回调可能仍在使用插件能力；若立即宣告完成，清理就会碰到回调仍持有的资源。

Promise 竞速只能停止等待，不能终止同一运行环境里的用户代码，也无法证明它已经释放资源。

通过 createRuntime 运行并传入调用者 signal。回调收到合作式取消信号，但所属插件代次仍保留到回调完成；本例显式打开 Promise 门，让工作正常结束。

### 示例参数

`createRuntime(host)` 默认 `shutdown.mode: 'strict-drain'`，`report` 默认未传；它借用 Host。`run('billing', { signal, timeoutMs: false }, callback)` 的三项必填，`signal` 可省略，`timeoutMs` 必须为 false 或有限非负数。`extensions` 只含 billing 当前安装的能力，`signal` 是原生合作信号；本例通过显式 Promise 门确定工作何时结束，不使用计时猜测。原 Host 配置同前，`Runtime.dispose()` 不替代 `Host.dispose()`。

```ts doc-test=run
import { PluginHost } from '@migaia/plugin-host'
import { createHost } from '@migaia/tray/host'
import { createRuntime } from '@migaia/tray/runtime'

class AppHost extends PluginHost<Record<string, never>, string> {}
const create = () =>
  new AppHost({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
const host = await createHost({
  create,
  plugins: [
    { name: 'billing', install: () => ({ double: (value: number) => value * 2 }) }
  ] as const,
  mutationAdmissionMs: 1000,
  quiescenceMs: 1000,
  shutdown: { mode: 'strict-drain' }
})
const runtime = createRuntime(host)
const caller = new AbortController()
const reason = new Error('调用方取消')
let finish!: () => void
const gate = new Promise<void>((resolve) => {
  finish = resolve
})
let observed: { readonly aborted: boolean; readonly reason: unknown } | undefined
try {
  const run = runtime.run(
    'billing',
    { signal: caller.signal, timeoutMs: false },
    async ({ signal, extensions }) => {
      observed = signal
      console.log('值：', extensions.double(21))
      await gate
      return '已完成'
    }
  )
  caller.abort(reason)
  console.log('已取消：', observed?.aborted, observed?.reason === reason, runtime.activeRuns)
  finish()
  console.log('结果：', await run, runtime.activeRuns)
  await runtime.dispose()
  console.log('宿主：', host.state)
} finally {
  finish()
  await runtime.dispose()
  await host.dispose()
}
```

输出：

```text
值： 42
已取消： true true 1
结果： 已完成 0
宿主： active
```

依次输出：值： 42；已取消： true true 1；结果： 已完成 0；宿主： active。

取消保留原始原因，在回调实际完成前仍有一个活动运行；回调仍可成功返回。Runtime 释放不负责关闭借用的 Host，截止时间同样只发出取消信号，不会抢占用户代码。

## 回调结束后再卸载当前插件

一次性插件返回结果后想卸载自己；若在回调内部等待普通卸载，卸载可能又在等待该回调释放自身代次。

捕获原始 Host 会绕开当前代次能力；把变更回执当成普通 Promise，也会模糊何时才能安全开始清理。

在回调中返回 self.unUse() 的 ticket，等 run 完成后再读取 ticket.completion。Runtime 先释放回调占用的代次，再提交对应代次的变更。

### 示例参数

原 Host 的 `plugins` tuple 安装 oneShot；`install(core)` 的 core 提供 `onDispose`，不是 Host handle。`runtime.run` 的 `timeoutMs: false` 必填，默认没有 caller signal；`self.unUse()` 无参数，绑定本次运行的名字和安装代次，`self.replace(plugin)` 是另一个选择。回调返回 ticket 后，外层才读其 `completion`；ticket 没有 then，不是等待变更完成的 Promise。`createRuntime` 仍默认 strict-drain，Host 各必填预算配置同前。

```ts doc-test=run
import { PluginHost, type IPluginHostCore } from '@migaia/plugin-host'
import { createHost } from '@migaia/tray/host'
import { createRuntime } from '@migaia/tray/runtime'

class AppHost extends PluginHost<Record<string, never>, string> {}
const create = () =>
  new AppHost({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
let releases = 0
const host = await createHost({
  create,
  plugins: [
    {
      name: 'oneShot',
      install: (core: IPluginHostCore<string>) => {
        core.onDispose(() => {
          releases += 1
        })
        return { answer: () => 42 }
      }
    }
  ] as const,
  mutationAdmissionMs: 1000,
  quiescenceMs: 1000,
  shutdown: { mode: 'strict-drain' }
})
const runtime = createRuntime(host)
try {
  const ticket = await runtime.run('oneShot', { timeoutMs: false }, ({ self, extensions }) => {
    console.log('值：', extensions.answer())
    return self.unUse()
  })
  console.log('凭据：', 'then' in ticket, runtime.activeRuns)
  await ticket.completion
  console.log('移除后：', host.plugins.includes('oneShot'), releases)
} finally {
  await runtime.dispose()
  await host.dispose()
}
```

输出：

```text
值： 42
凭据： false 0
移除后： false 1
```

依次输出：值： 42；凭据： false 0；移除后： false 1。

回执不是类 Promise 对象，外层 completion 在回调结束后观察到一次插件清理。在该回调内部读取 completion 会以 RUNTIME_CONTRACT_INVALID 拒绝；Runtime 和 Host 仍需分别释放。

## 契约细节

### 职责与五个入口

Tray 组合已有的能力与生命周期，不另建一套协议。静态 Graph 管理同一运行环境内、构造前已知的完整资源集合；托管 Host 组合 PluginHost 定义；根入口的 Hosts 注册表管理独立实例。能力依赖由 capability 负责，插件安装由 plugin-host 负责，连接和原生执行由 RPC / supervision 负责；这些依赖图不等于响应式数据依赖。

| 入口                   | 用途                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `@migaia/tray`         | createTrayGraph；defineTrayHost、createTray、serveTrayHost；路由策略与实例状态、公开错误。 |
| `@migaia/tray/host`    | createHost 与托管 Host 的公开类型。                                                        |
| `@migaia/tray/loader`  | defineLoader、loadIntoHost 与加载合同。                                                    |
| `@migaia/tray/adapter` | defineAdapter 与转换合同。                                                                 |
| `@migaia/tray/runtime` | createRuntime 与回调运行、协作取消、自变更回执类型。                                       |

Loader、Adapter、Runtime 不从根入口聚合，直接导入的依赖应显式安装。本包运行时依赖 capability、event-subscriber、lifecycle、plugin-host、rpc-contract、rpc-host、rpc-plugin-process、rpc-plugin-thread、rpc-plugin-coroutines、supervision 与 utils。跨机器发现、浏览器 Worker 接入、UI、持久消息与自动故障转移重试不属于这里的组合保证。

### 原普通 Host 上的 RPC plugins

Tray 在既有 plugin-host Host 上安装 `processPlugin`、`threadPlugin` 或 `coroutinePlugin`。plugin 保留真实 definition 的 name 与 expose 列表；Host 的 process/thread/coroutine outlet 继续按实例名定向调用，并沿原 stop/restart/replace 控制释放或替换。

| 载体      | 父端来源                                                               | 子端来源                                                                                              |
| --------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| process   | `processPlugin({ spawn: { entry, supervision, wrap }, name, expose })` | `processPlugin({ connectToParent: true, name, expose })`                                              |
| thread    | `threadPlugin({ spawn: { entry, limits, supervisor }, name, expose })` | `threadPlugin({ connectToParent: true, name, expose })`                                               |
| coroutine | `coroutinePlugin({ spawn: task, supervisor, name, expose })`           | `coroutinePlugin({ connectToParent: connect, name, expose })`，connect 是 task 给出的真实 opaque 连接 |

表中只说明选项层级，可选字段可省略；Tray 从既有 Host 定义与 task 上下文选择它们。协程 connectToParent 是实际 callback token，不是 true。按实例的 request/notify/stream 保持定向，supervisor 生命周期继续由原 owner 管理。

### 静态 Graph：定义与启动

`createTrayGraph(entries)` 必填一个完整只读数组，构造时同步检查但不启动。ITrayKey 是带品牌的字符串，运行时要求 trim 后非空；业务应集中定义并复用键，不依赖库猜测或生成。

| Entry 字段 | 要求                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| key        | 必填且全数组唯一；重复键为 TRAY_DUPLICATE_ENTRY。                                                        |
| kind       | 必填，value / computed / resource / service；只是类别标签，不改变 value 的静态类型或自动创建响应式能力。 |
| requires   | 默认空数组；只能引用本次集合的其他键，不允许自身或未知键。                                               |
| readiness  | 默认 undefined；外部就绪快照，state 为 ready / blocked / failed。                                        |
| start      | 必填函数；依赖就绪后收到 context，返回或 resolve 为完整的 `{ value, release }`。                         |

key、kind、requires、readiness、start 的入场读取与依赖检查都在第一个 start 之前；异常或外形非法为 TRAY_INVALID_ENTRY。规范化后的 keys / requires 数组冻结，调用方后续修改原数组不会改变拓扑。readiness 属性值在入场捕获，首次 gate 使用该对象；这不是对任意业务值或快照对象做深克隆。

context.signal 在 Graph 关闭时中止；context.get(key) 只读取已声明、已就绪的直接依赖；context.own(resource, descriptor) 把辅助资源交给当前节点，完整 release descriptor 沿 lifecycle 处理。start 的主值 release(context) 接收 Graph 释放上下文，可同步返回或返回类 Promise 对象。部分构造失败时，entry 自己回滚尚未交出的资源。

第一次 ready() 按 entry 顺序检查入场捕获快照的 state / error；全缺省或 ready 才启动 Graph。blocked / failed 拒绝其 error，null / undefined 时使用 TRAY_UNAVAILABLE，其他假值仍是原失败。非法 state 为 TRAY_INVALID_ENTRY，之后不读取该快照的 error；getter 失败尽可能保留原生类型 / identity 并附 TRAY_GATE_READ_FAILED。

只有 blocked 允许下一次显式 ready() 重新读取各 entry.readiness 及新快照；提供 getter 才能取得提供者后来发布的新对象。failed、非法快照、getter 失败及 Graph 启动结果缓存同一个 Promise；启动成功后不再采样外部门，dispose 后不再重试。没有自动轮询或重试计时。

| ITrayGraph 成员 | 行为                                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| keys            | 冻结的入场键列表，保持声明顺序。                                                                         |
| state / error   | ready 前为 open；gate 失败投影 failed，之后沿 Graph 状态与原错误。                                       |
| ready()         | 无参数，显式门控并启动依赖；保留最终 Promise 身份。                                                      |
| `get<T>(key)`   | 只在 Graph 与节点可见时读 Graph 自己的 value；未知键 TRAY_UNKNOWN_ENTRY，其余不可用为 TRAY_UNAVAILABLE。 |
| entryState(key) | 读取单个节点状态，未知键同样拒绝。                                                                       |
| dispose()       | 无参数，关闭可见性并按依赖逆序释放，遵循原 Graph 的幂等与同 Promise 语义。                               |

没有第二份 Tray value 表；启动中、后续节点失败或关闭后都不会露出部分已启动值。主值与 context.own 资源均归节点，调用方不要重复释放。Graph 保留 primary 与清理错误的 cause / errors；Tray 不增加 timeout、scheduler 或强制终止，不结算的同运行环境 start / release 仍可能一直等待。

### 托管 Host：建立、变更与类型

`await createHost(options)` 只从 /host 导入；create() 构造唯一 concrete PluginHost class 实例或 defineHost() handle，facade 继续使用原 Host 身份、domain core、pipeline 和 constructor baseline。插件 install(core) 接收 domain core 与 lifecycle core，不接收 Host handle。

| ICreateHostOptions 字段 | 默认与要求                                                  |
| ----------------------- | ----------------------------------------------------------- |
| create                  | 必填函数，无默认，返回尚未被其他 Tray 会话认领的原 Host。   |
| plugins                 | 必填初始定义 tuple，无默认；一起入场并按 Feature 依赖启动。 |
| mutationAdmissionMs     | 必填，无默认；有限非负毫秒预算，控制串行图变更等待接纳。    |
| quiescenceMs            | 必填，无默认；有限非负预算，用于 bounded 的物理清理等待。   |
| shutdown.mode           | 必填，无默认；bounded 或 strict-drain。                     |
| report                  | undefined；接收被容纳的生命周期与清理诊断。                 |

Tray 使用同一份 PluginHost admission 快照的 Feature、config 与 disposer，通过公开依赖读取器建立动态图，再发布已就绪定义。必需 provider 缺失时 definition 保留 blocked；可选 provider 缺失不阻塞，存在时也先于使用者安装。依赖来自 Feature references，不接受旧插件依赖字段。无效描述子在图变更前拒绝，PluginHost 原错保留 cause；进入图变更后的失败按 mutation result 观察。

| 成员                   | 契约                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| plugins / readyPlugins | 前者包含全部已登记 definition 名称，后者仅包含 ready 名称。                              |
| pluginState(name)      | 查询状态；未知名称返回 blocked，不因此提供可用扩展。                                     |
| extensions / config    | 保留原 Host baseline 与已就绪插件的面。                                                  |
| use(plugin)            | 增加 definition，缺 provider 时可 committed 且 blocked。                                 |
| replace(plugin)        | 替换同名 exact generation，保留原排序位置。                                              |
| unUse(name)            | 删除 definition 并阻塞使用者闭包；未知名返回 ok true / committed false / removed false。 |
| dispose()              | 终止图、移除内部锚点并清理 concrete Host；重复与同步重入复用同一 Promise。               |

失败结果的 committed 表示候选是否已经成为当前 binding，不能用 ok 或“同名还存在”猜测。未提交 duplicate / cycle / replacement 候选回滚，不成为后来重启的隐式来源。真正 unUse 后原排序位置永久退休，同名后续 use 获得新的单调位置；provider 恢复与同名 replace 保留已有 definition 的位置。

成功结果携带 result.view；检查 ok 后把该 view 交给 createRuntime，才能延续新插件精确扩展类型。原 Host 变量的静态类型不会自动改变。ITrayResolvedHost 对有限、literal、最多 128 个定义且 provider/name 未泛化的 tuple 求 ready 闭包；超出预算或名称泛化使用 ITrayHostDynamic，保留 constructor baseline，未知动态键为 unknown。

Host.state 可为 active / closing / terminal / failed；失败时 facade.state 可为 failed，而返回清理结果仍标记 state terminal。工厂失败的 creation detail 带阶段与清理信息；phase 类型包含 factory / admission / graph / setup / commit，当前实际观察路径使用 factory / setup，不承诺逐项发出所有阶段。重复认领已在使用的 Host 只回滚本次 claim，不销毁已有会话；冻结 factory 异常通过 cause 保留，避免 detail 附加覆盖原错。绕过 facade 使用逃逸的 concrete Host 变更，会以 HOST_MUTATION_BYPASS 关闭后续可信访问。

### 逻辑完成与物理清理

Host mutation / disposal 的 ICleanupResult 来自 lifecycle：cleanupErrors 是当前快照，cleanupComplete false 表示仍需观察同一个 physicalCompletion，其结果只包含后来新增的错误。用 `mergeCleanupResults([result])` 合并当前及所有后续增量，包括跨运行环境的 Promise。

Graph 在释放 exact generation 前封闭该 binding 的新使用权，再等已取得使用权的工作结束；PluginHost 先等待这道屏障，再按使用者 / 提供者、插件 / 资源顺序清理。Host 的 bounded 可按 quiescenceMs 返回逻辑结果，strict-drain 等实际完成。原 PluginHost 必填 execution.pipelineDrainTimeoutMs 为数值时，共享本批预算到期后继续后续清理；false 才逐项等真实完成。预算不会取消仍在运行的 Promise，迟到工作与错误继续由 physicalCompletion 观察。

托管 Host 支持异步显式资源管理；环境不支持 await using 时，在 finally 中 await host.dispose()。不要把 cleanupComplete false 当成全部资源已释放，也不要丢弃物理结果。

### Loader、Adapter 与制品归属

defineLoader({ load }) 捕获一次 load 方法，返回冻结合同；每次 load(source, context) 调用该函数一次，接受同步、Promise 与外来类 Promise 对象。defineAdapter({ adapt }) 同样捕获转换方法并在每次 adapt 时调用；它们不创建 Host / Graph，也不独自接管制品清理。独立包装器保留执行结果，事务中的失败分类由 loadIntoHost 负责。

load 的结果须含 value 与 lifecycle release descriptor，至少有可调用 force；与静态 entry 的 release 函数不是同一外形。adapter 将 value 转成与原 Host core 兼容的插件描述子。非法合同 / 返回形状分别为 LOADER_CONTRACT_INVALID / ADAPTER_CONTRACT_INVALID。

| loadIntoHost(options) 字段       | 要求                                                     |
| -------------------------------- | -------------------------------------------------------- |
| host / source / loader / adapter | 必填，分别为托管 Host、输入、加载器与转换器。            |
| mutation                         | 必填 use 或 replace，无默认。                            |
| timeoutMs                        | 必填 false 或有限非负数，允许 0 / 小数；false 不设期限。 |
| signal                           | undefined，仅桥接本次事务接纳期间的取消。                |
| report                           | undefined；诊断不能取代事务原结果。                      |

loader context 提供原生 signal、deadlineAt（false 时 undefined）与 report；adapter context 提供 signal / deadlineAt。事务以 provisional scope 暂管制品，执行 load → adapt → use / replace；未 committed 则回滚，committed 后交给 exact definition generation。即使结果 ok false 或插件 blocked / failed，只要 committed true，制品仍由该代持有，后续 unUse / replace / dispose 才沿原路径释放。

取消和期限只通知协作信号，不独立阻止不合作的 loader / adapter 继续执行甚至提交；timeoutMs 必填，只有 false 才不设 deadlineAt。

成功 loadIntoHost 返回即取消本次 timer 并解除 caller signal 桥接，之后 caller abort 不影响已提交 generation 的 loader context；其 scope 仍归代际，scope 结束时 context.signal 中止。失败回滚的次要清理会报告，不替换 mutation primary；已有生命周期身份保持，不把所有清理改成本包码。

### Runtime：回调使用权、取消与自变更

createRuntime(host, options?) 只接受托管 Host 的真实能力，借用而不销毁 Host / Graph。options.shutdown.mode 默认 strict-drain，另一个值 bounded；options.report 默认 undefined。Runtime 无 quiescenceMs；物理清理等待预算配置在托管 Host。

run(name, options, execute) 取得目标 ready 插件的 exact generation 使用权，只发布该 registration 的 extensions 快照。字面量 ready 名称可精确推导，泛化名称使用只读 unknown 记录；不是把整个 Host 扩展交给回调。

| Run 参数或 context          | 要求与含义                                                                       |
| --------------------------- | -------------------------------------------------------------------------------- |
| name / execute              | 必填目标名和函数。                                                               |
| options.timeoutMs           | 必填 false 或有限非负数，允许 0 / 小数；deadlineAt 采用 systemScheduler 的时钟。 |
| options.signal              | undefined，调用方取消源。                                                        |
| context.runId / plugin      | 本次递增标识与目标插件名。                                                       |
| context.extensions          | 当前插件代次的扩展快照。                                                         |
| context.signal / deadlineAt | 合作式中止与单调截止点，false 时 deadlineAt 为 undefined。                       |
| context.self                | 只绑定当前 run、名字与 generation 的自变更能力。                                 |

同步值、Promise、外来 thenable、throw / reject 都在真实 callback settlement 后释放使用权；callback 原失败保留类型、stack、identity 或 cause。signal、期限、Runtime.dispose 只中止协作信号，不抢占代码，不提前释放；回调可以忽略取消并成功返回。目标租用失败仍释放本次 deadline 任务和 caller bridge，完整的 capability / graph 等外包身份保留，不能宣称每次失败都会变成 RUNTIME_ABORTED。

dispose() 停止新 run，abort 活跃信号，复用同一个 Promise。strict-drain 等回调真实结算并报告失败；bounded 立即给出 state terminal 与 cleanupComplete 当前值，未结束回调继续受原工作持有。Runtime activeRuns 统计尚未结算的回调；Runtime.dispose 不释放借用 Host，Host 发出 disposing 时 Runtime 同样停止接纳并中止活跃信号。Symbol.asyncDispose 等待 Runtime.dispose，丢弃其返回快照。

self.unUse() / self.replace(plugin) 同步返回非 thenable ticket；操作先等 callback settle、释放使用权，再进入 canonical Host queue。ticket.completion 只在回调外读取；回调内读取会得到 RUNTIME_CONTRACT_INVALID 的 rejected Promise，直接 await ticket 本身也不代表变更完成。替换继续按原 Host 的 core 能力准入，旧代的回执不授权变更新代。不要在 callback 捕获 concrete Host 进行自身卸载。

### Hosts：定义与运行方式

根入口的 defineTrayHost(definition) 创建冻结、有身份的 Host 定义；name、plugins、exposes 必填，定义阶段不调用插件工厂或 config 验证器。结构复制品没有该身份。exposes 用 plugin.feature 路径，调用用 plugin.feature.method；内部保留插件名不可作为业务暴露。

| 定义字段                  | 默认与约束                                                                  |
| ------------------------- | --------------------------------------------------------------------------- |
| runtime                   | coroutine；可选 thread / process。                                          |
| entry                     | 默认无；thread / process 必填 string / URL，coroutine 禁止。                |
| config(input)             | 默认无验证器；每次初始化校验转换输入。                                      |
| plugins(info, trayPlugin) | 每个 generation init 调用，info 含 id、host、generation 与验证后的 config。 |
| exposes                   | 必填只读 Feature 路径数组。                                                 |
| supervisor                | 默认沿原运行时策略；可覆写 restart 与 startupTimeoutMs。                    |
| limits.heapBytes          | 默认未指定，仅 thread。                                                     |
| sandbox                   | 默认未指定，仅 process，包含 name 与同步 wrap(command)。                    |
| routing                   | 默认未指定，只读可信 policy tuple，声明子插件可用的自定义路由。             |

supervisor.restart 的 mode 可为 never / on-failure / always；还可配置 maxRestarts、windowMs、initialDelayMs。sandbox.wrap 的输入输出为完整启动命令 `{ command, args, cwd?, env }`，env 包含 inherit / set；应用自行接入外部沙箱，本包不提供沙箱实现。

coroutine 共享事件循环，停止合作式；thread 是独立 Worker isolate，process 是子进程。Node 原生入口应导入共享 Host 定义并执行 serveTrayHost(host, { probe?, report? })；它只连接父 registry，等退出请求和插件清理后结束对应运行体，不再 spawn。Bun / Deno / browser Worker 的权限和原生退出能力不能由本地 Node 或运行时无关案例推断。

plugins 通过 Feature 引用依赖 trayPlugin.getFeature('tray')；deps.tray.self() 取身份，await deps.tray.to(host, id) 取得绑定当前接纳记录的 remote，deps.tray.exit(error?) 结束本实例。第一次 exit 决定 clean / crash，插件清理之后才结束 task / realm。根入口仅提供 ITrayClientPlugin 类型，不提供运行时 client 单例。

### 实例注册表与远端调用

createTray({ hosts, routing?, probe?, report? }) 返回 ITray；hosts 必填为可信定义数组，routing 与每个定义的 policy 合并。probe 默认未指定，可为单个 IRpcProbe 或只读数组；createTray.report 默认 Core 的 defaultRpcReporter。serveTrayHost 使用相同 probe / report 类型，默认 report 为 console.error。

| Registry API                              | 行为                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| spawn(name, { id, config? })              | 初始化并返回对应 remote；配置类型不允许 undefined 时 config 必填。              |
| instance(host, id)                        | 同步取得固定接纳记录的 remote。                                                 |
| list({ host?, runtime?, state? }?)        | 返回冻结快照，筛选字段未传不限制。                                              |
| get(id)                                   | 异步合并 RPC unit detail，generation 保持 Tray 数值类型。                       |
| stop / remove(id, { graceMs? }?)          | 默认 graceMs 5000，先尝试 child PluginHost cleanup，失败 / 超时报告后继续停止。 |
| restart(id) / replace(id, { config? }?)   | 每实例串行管理；替换 config 仅在新 generation init 成功后提交。                 |
| on(event, listener) / watch({ signal? }?) | 只观察生命周期；watch 最近 100 条未读记录，非持久日志。                         |
| dispose({ graceMs? }?)                    | 关闭注册表与所属实例，支持异步显式资源管理。                                    |

TrayInstanceState 为 starting / ready / restarting / failed / stopped；TrayInstanceEvent 为 spawned / ready / restarting / failed / stopped / removed。生命周期记录冻结且没有 emit；错误投影只保安全 source / code，不保证通过事件取得原 crash 对象。

remote.request / notify / stream 统一用 path、payload、第三个 options；无参数方法可省略 payload，有 options 时用 undefined 占第二位。ITrayCallOptions 仅 signal 与 timeoutMs，缺省未指定；不是把 options 塞进业务对象。业务对象里的 undefined 字段拒绝，只有 wire envelope 的 absent payload / config 会省略；Uint8Array 可跨三种运行方式，非 portable config 在创建连接前拒绝。

父端 list / get 的 config 保留 portable 的 spawn / replace 输入；配置验证在 child init 执行，plugins(info) 与 deps.tray.self() 才读取验证器输出，该输出保持子端本地数据，不再自动转成 wire 载荷。

非 ready 目标立即 TRAY_INSTANCE_NOT_READY；remove 后旧 remote 永久 TRAY_INSTANCE_UNKNOWN，同 id 重新 spawn 不会复活旧记录。已发送调用按原 RPC receipt 完成，不迁往新 generation。业务目标错误保留原 source / code / cause，Tray 校验与启动包装保留原 cause；inFlight 只计本接纳记录尚未结束的业务 request / notify / stream，不含 init 和主题投递。

### 路由与业务主题

tray.routing.roundRobin(host) 与 tray.routing('roundRobin', host) 共享同一选择序号，每次操作选择当前 ready 实例。leastInFlight 选最少待完成业务调用，平局保留 spawn 顺序；routed remote 有 host 而没有固定 id。剩余期限与取消信号交给所选目标，不自动改投其他实例或重试。

defineRoutingPolicy(name, pick) 创建有身份的冻结定义，定义时不执行 pick。name 符合 `^[a-z][A-Za-z0-9]*$`，不能占用内置名、函数 / 对象保留属性。pick(candidates, { host, sequence }) 在父端同步执行，收到当次独立冻结、按 spawn 顺序且反映当前 inFlight 的 ready 快照，返回其中一个 id；回调应短小。父端注册 createTray.routing 与 host DSL.routing 的合集，子插件须在自己的 host tuple 声明自定义名；只把名字跨 RPC，内置名无需声明。

未注册或未声明为 TRAY_ROUTING_UNKNOWN；非法定义、不同 policy 身份重名、非候选返回和 pick 抛错为 TRAY_ROUTING_INVALID，原 throw 留 cause。没有 ready 候选为 TRAY_HOST_UNAVAILABLE。

tray.publish(topic, payload?) 同步向当前订阅者分发；子端 deps.tray.publish 返回 Promise。父端 subscribe 返回同步退订函数，子端 await subscribe 返回异步幂等退订；第一位本地监听器登记父端 membership，最后一位释放时移除。重启后重新安装插件建立新代订阅，旧代操作不影响新 membership。

主题必须非空字符串，载荷必须 portable；名称 spawned 也只是业务主题，不触发生命周期事件。listener(payload, meta) 的 meta.from 由父端认证且冻结：实例为 `{ id, host, generation }`，父发布为 `{ parent: true }`；与载荷分离，载荷字段不能冒充发送者。

每个当前订阅最多投递一次；目标未 ready 会错过消息，没有 replay、持久性或业务完成确认。同步 listener throw 与异步 reject 在其侧报告，后续监听器继续；投递发送拒绝由父端报告，处理失败由子端报告，不以这些投递错误拒绝发布者。

### 错误与迁移

所有 Tray 自有边界码的 source 为 TRAY_SOURCE，即 `tray`；按 source / code 分支，不匹配 message。可注记的原生错误保持类型、stack 与 identity；冻结或不可安全注记的值经带码 wrapper.cause 保留，完整外包身份不改写。Graph 启动 / 节点 / 释放错误继续属于 capability。

| TrayErrorCode 属性 / 值                           | 触发                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| hostUnavailable / TRAY_HOST_UNAVAILABLE           | 没有 ready 路由候选。                                                 |
| routingUnknown / TRAY_ROUTING_UNKNOWN             | policy 未注册或子端未声明。                                           |
| topicInvalid / TRAY_TOPIC_INVALID                 | 主题不是非空字符串。                                                  |
| routingInvalid / TRAY_ROUTING_INVALID             | policy 名称 / 回调 / 返回候选无效或执行抛错。                         |
| hostInvalid / TRAY_HOST_INVALID                   | Host DSL 或 registry 构造输入无效。                                   |
| hostUnknown / TRAY_HOST_UNKNOWN                   | spawn 使用未登记 Host。                                               |
| hostMismatch / TRAY_HOST_MISMATCH                 | remote 指向与当前接纳记录不同的 Host。                                |
| reservedName / TRAY_RESERVED_NAME                 | 暴露路径使用保留内部插件名。                                          |
| valueNotPortable / TRAY_VALUE_NOT_PORTABLE        | config 或 payload 不是支持的 portable 数据。                          |
| instanceDuplicate / TRAY_INSTANCE_DUPLICATE       | spawn 重用仍被接纳的 id。                                             |
| instanceUnknown / TRAY_INSTANCE_UNKNOWN           | lookup 或 remote 使用已结束接纳记录。                                 |
| instanceNotReady / TRAY_INSTANCE_NOT_READY        | 调用目标尚未 ready。                                                  |
| instanceStartFailed / TRAY_INSTANCE_START_FAILED  | 插件安装或 generation init 失败，原因留 cause。                       |
| pathNotExposed / TRAY_PATH_NOT_EXPOSED            | 调用路径不在声明暴露面。                                              |
| childStateInvalid / TRAY_CHILD_STATE_INVALID      | child init 重复或引用其他 Host。                                      |
| disposed / TRAY_DISPOSED                          | 已关闭 registry 继续接纳操作。                                        |
| loaderContractInvalid / LOADER_CONTRACT_INVALID   | Loader / result / release 外形非法。                                  |
| loaderExecutionFailed / LOADER_EXECUTION_FAILED   | 加载事务内未归属的 loader 执行失败。                                  |
| adapterContractInvalid / ADAPTER_CONTRACT_INVALID | Adapter 或插件返回外形非法。                                          |
| adapterExecutionFailed / ADAPTER_EXECUTION_FAILED | 加载事务内未归属的 adapter 执行失败。                                 |
| runtimeContractInvalid / RUNTIME_CONTRACT_INVALID | Runtime Host / 参数 / callback 或 self ticket 使用违约。              |
| runtimeDisposed / RUNTIME_DISPOSED                | Runtime 关闭后继续接纳 run。                                          |
| runtimeExecutionFailed / RUNTIME_EXECUTION_FAILED | 未归属的 callback throw / reject，使用权仍在结算后释放。              |
| runtimeAborted / RUNTIME_ABORTED                  | 运行租用接纳失败的回退分类；完整外包身份保留，信号取消不强制 reject。 |
| artifactCleanupFailed / ARTIFACT_CLEANUP_FAILED   | 未归属的制品次要清理失败；不替换 mutation primary。                   |
| invalidEntry / TRAY_INVALID_ENTRY                 | 静态 entry、托管 factory 返回或 Host claim 非法。                     |
| duplicateEntry / TRAY_DUPLICATE_ENTRY             | 静态 Graph 重复 key。                                                 |
| unknownEntry / TRAY_UNKNOWN_ENTRY                 | get / entryState 使用未接纳 key。                                     |
| unavailable / TRAY_UNAVAILABLE                    | Graph 或 entry 未 ready、gate 失败或已终结。                          |
| gateReadFailed / TRAY_GATE_READ_FAILED            | readiness 属性或 state/error getter 失败。                            |
| hostMutationBypass / HOST_MUTATION_BYPASS         | 绕开托管 facade 的 concrete Host 变更。                               |

旧四个托管类型辅助导出 IHostBaselinePlugins、IPluginWithSynchronousShared、ICanResolveReadyDefinitions、IResolveReadyTrayPlugins 已取消公开导出；外部标注使用 ITrayResolvedHost / ITrayHostDynamic 或 Runtime 推导。Runtime shutdown 只接收 mode，不再接收未使用的 quiescenceMs；对应预算在 managed Host 配置。Loader / Adapter 方法只读取一次，校验与执行复用同一函数。

包提供 fmt、lint、typecheck、typecheck:test、test、build；清理失败需沿 cause / errors 与 physicalCompletion 记录。此命令清单不声明本页已运行门禁，也不把本地案例当成其他运行时、原生隔离或性能证据。
