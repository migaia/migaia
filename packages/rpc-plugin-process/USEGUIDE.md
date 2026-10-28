# Process plugin 使用指南

[README](./README.md) · [English](./USEGUIDE.en.md)

一个 Host 通常选择一种传输。根对象管理 `self/provide/close`，业务调用在 namespace 下；Process 的默认 namespace 为 `process`。下面所有 TypeScript 模块按当前公开 dist 做类型检查，不代表真实环境和认证验收已完成。

## 双向本机连接

同一个连接两端都可提供业务。下面是 Node/POSIX 本机命名服务的调用形态；它不证明该服务已配置认证。

```ts doc-test=check
import { randomUUID } from 'node:crypto'
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'

const address = 'service-' + randomUUID()
const server = await createRpcHost({
  plugins: [processPlugin({ listen: address })],
  provide: { double: (value: number) => value * 2 }
})
try {
  const client = await createRpcHost({
    self: { name: 'client-a', instanceId: randomUUID() },
    plugins: [processPlugin({ connect: { target: address, timeoutMs: 1500 } })],
    provide: { clientValue: (value: string) => 'client:' + value }
  })
  try {
    console.log(await client.process.request('double', 21))
    console.log(await server.process.send('client-a', 'clientValue', 'ready'))
  } finally {
    await client.close()
  }
} finally {
  await server.close()
}
```

`request` 没有目标时使用当前 namespace 的直连集合，多个目标保留各自结果；`send(nameOrId, method, payload)` 只选择一个当前直连。业务流保留自己的迭代器与取消，不代表拥有整个原生进程。重启期间的零会话请求与旧 downtime 错误之间仍有未闭合差异，应用不能把空集合当作重启完成。

## 完整 feature 实例与 probe

原生容量、FIFO 与日志属于 Process。下例只安装一个 flow，再让 queue 和 log 借用它；timeout 是该传输选择的业务 feature，probe 是启动前的 host 介入插件。

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'
import {
  flowControlFeature,
  sendQueueFeature,
  ipcLogFeature
} from '@migaia/rpc-plugin-process/features'
import { timeoutFeature } from '@migaia/rpc-host/features/timeout'
import { probe } from '@migaia/rpc-host/plugins/probe'

export async function openWorker(entry: URL) {
  const flow = flowControlFeature({ maxPendingData: 32, maxPendingControl: 8 })
  const observer = probe({
    stages: ['peer'],
    emit(view) {
      console.error(view.lifecycle)
    }
  })
  return createRpcHost({
    plugins: [
      observer,
      processPlugin({
        spawn: entry,
        features: [
          flow,
          sendQueueFeature({ flow }),
          ipcLogFeature({
            report(record) {
              console.error(record)
            }
          }),
          timeoutFeature({ ms: 1500 })
        ]
      })
    ]
  })
}
```

调用者负责最终 `await host.close()`。也可单装 `flowControlFeature`，或让 `sendQueueFeature` 自建默认 flow；显式 `flow` 和重复的容量字段会在冷配置拒绝。不要把这些实例当作 host 根配置开关，也不要再提供已删除的 `ipc.log` fallback 字段。仅装 `ipcLogFeature` 不会自动启用限流。

`/features/send-queue`、`/features/flow-control`、`/features/log` 也提供对应工厂。排队取消和容量计数使用真实安装；与 batch 合用时的每逻辑调用计费仍未完成验收。容量拒绝保留 `OVERLOADED`，真实物理 I/O 失败使用 `TRANSPORT` 并保留原 cause。

## 选项与期限

`connect: { target, timeoutMs? }` 选择已有服务；timeout-only 的 `connect` 可修饰 spawn/listen/parent。协商阶段默认 10,000 ms；随后名字准入用 `connect.timeoutMs`，默认也为 10,000 ms，`pending` 传递尚未用完的协商时间与本次名字探测预算之和；只在首次通知延长期限，重复通知不会刷新。`connectTimeoutMs` 则是命名本机来源的查找等待。单次业务调用使用完整 `timeoutFeature(...)` feature 或 `timeout: false`，并可传 `signal`；这些期限相互独立。

`spawn` 可选主入口、路径/URL、短启动配置或完整原生 recipe。主入口自派生写法见 README。原生 `supervision` 保留重启、健康检查和停止策略；恢复连接不重放未确认业务。stdio 的 stdout 属于 RPC，应用日志使用 stderr。

自动 verifier/principal、跨重连 session/scope 与部分 native auth 接线尚有缺口。不要用 token、环境值、自报身份或客户端 ID 代替实际准入。需要业务认证、schema、分片、合批或类型生成时，选择实际的 `/plugins/auth`、`/plugins/schema`、`/plugins/chunk`、`/plugins/batch`、`/plugins/typegen`；它们不是 Contract 内部或传输配置字段。flow 插件必须在传输开始前安装，启动后追加会拒绝。

## 原生成员与普通 PluginHost

查询和控制使用 `host.process.members`；`list/get` 返回原生来源的安全描述，`on/watch` 观察真实事件。`stop/kill/restart/replace` 取决于实际成员归属；接入外部服务不会获得远程进程控制权。

```ts doc-test=check
import { PluginHost } from '@migaia/plugin-host'
import { processPlugin } from '@migaia/rpc-plugin-process'

export async function installAndRelease(entry: URL) {
  const owner = new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 }
  })
  try {
    await owner.use(processPlugin({ name: 'worker', spawn: entry }))
  } finally {
    await owner.dispose()
  }
}
```

同一冷定义可安装在原生 PluginHost 上，不另开第二个 Host。普通安装的 `expose` 必须指向真实已安装 Feature，并显式列白名单；业务仍通过 process namespace 调用。自定义载体使用 `@migaia/rpc-host/sdk`，不使用已删除的部署 assembler 或返回端点的 source。

## 关闭与错误

拥有的子进程由真实监督器停止；借用服务仅释放本端连接。关闭监听器不授予终止客户端进程的权限。`close()` 是清理请求，不应推断所有已接纳业务都能 drain 完成；Host 关闭顺序与原 drain 业务仍有真实未闭合项。

通道启动失败按真实阶段保留 `PROCESS_CHANNEL_CLOSED`、连接失败或原生 `EPIPE`，不保证固定两层同码错误壳。应沿 `cause/errors` 读取原生错误，不按固定深度取值。`timeout: false` 不添加 Process 业务调用期限；原生启动、health 与 stop 预算仍各归自己的 owner。

当前同名准入的公开错误呈现也有保留的失败用例；不能把通用启动包装错误当作已完成原错误契约。为应用使用唯一身份，不用注册名推断远端 identity。按 `source/code/cause/errors` 保留错误链和原生类型；不要把未知结果当作从未执行，也不要从连接恢复推出幂等重放或持久 outcome 已建立。

`@migaia/rpc-contract` 只负责纯数据、类型、错误与协议准入；业务 schema 和策略归实际 plugin/feature，原生资源归 Process，调用生命周期归 Host。完整迁移验收尚未闭合。
