# `@migaia/rpc-plugin-process`

为 `createRpcHost` 提供真实子进程、本机服务连接与多会话监听。启动、认证、重连和释放继续由原生进程 owner 负责。

[English](./README.en.md) · [使用指南](./USEGUIDE.md)

## 为什么选它

- 一个会话同时支持父子双向请求、通知、流和方法目录。
- `spawn` 拥有子进程；`connect` 只拥有会话，不会关闭外部服务；`listen` 拥有监听器与接纳的会话。
- 原监督器保留代次、重启、资源预算与退出观测；连接恢复不等于安全重放业务。
- 显式地址可以接入实现相同认证/协议的独立服务；JSON-RPC 使用可靠字节流与 Content-Length 分帧。

## 从这里开始

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-process
```

下面使用 Node/POSIX 的同用户本机命名服务。两个 host 各只有一个传输 plugin；服务端仍可接纳多个独立客户端。

```ts doc-test=run
import { randomUUID } from 'node:crypto'
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'

const name = 'reader-' + randomUUID()
const server = await createRpcHost({
  plugins: [processPlugin({ listen: name })],
  provide: { double: (value: number) => value * 2 }
})
try {
  const client = await createRpcHost<{ double(value: number): number }>({
    plugins: [processPlugin({ connect: { target: name, timeoutMs: 1500 } })]
  })
  try {
    console.log(await client.request('double', 21))
  } finally {
    await client.close()
  }
} finally {
  await server.close()
}
```

输出 `42`。客户端关闭只撤回自己的连接；外部服务由其创建者关闭。

## 选择来源

`processPlugin(options)` 必须且只能选择下表一个来源。单独的 `connect: { timeoutMs }` 也可为其他来源设置握手预算。

| 来源           | 配置                                             | 归属                                   |
| -------------- | ------------------------------------------------ | -------------------------------------- |
| 启动子进程     | `spawn: true`、入口路径/URL 或启动配置           | host 停止自己启动的进程                |
| 连接已有服务   | `connect: { target: nameOrAddress, timeoutMs? }` | 只释放当前会话                         |
| 接纳独立客户端 | `listen: nameOrListener`                         | 关闭监听器与自己的会话                 |
| 子进程接父端   | `connectToParent: true`                          | 读取真实 stdin bootstrap，不猜环境身份 |

同一入口自派生时，先用 `await isProcessChild()` 区分角色：子端创建 `processPlugin({ connectToParent: true })`，父端创建 `processPlugin({ spawn: true })`。业务 `provide`、`self`、默认调用期限与认证放在 `createRpcHost`；普通 plugin-host 安装也可沿 plugin 的本地配置提供这些值。

短启动配置支持入口、command/args、cwd、显式 env、wrap、原生 limits/permissions 和 supervision 设置。`wrap` 每次实际启动只改写原命令一次。显式 command 不经 shell 执行。平台适配器不会赋予宿主没有的隔离或终止能力。

## 调用与恢复

`host.request / notify / stream / group / outcome` 没有目标时作用于当前直连集合；单发用 `host.send(clientName, method, payload)`，通知也可传 `targetId`。双方 `provide` 后可在同一会话交错调用；一个客户端断开不使其他客户端失效。

`connect.timeoutMs` 是握手预算；顶层 `connectTimeoutMs` 是命名本机地址的查找等待，二者独立。命名来源的初次查找可等待服务出现；显式地址的初次拨号不套用这个等待循环。已建会话断开后的恢复仍由原监督器负责，包括显式 socket 服务重启。stdio 模式的 stdout 属于 RPC 字节通道，应用日志使用 stderr。

显式 socket/TCP 地址需要匹配的凭据和协议配置；同用户命名端点的默认凭据依赖本机隔离边界。JSON-RPC 模式需要实际 contract 或自定义 establish，不把任意 JSON 文本服务当成可用 RPC 对端。凭据、bootstrap 和私有句柄不能复制为可信身份。

## 功能与平台入口

| 入口        | 用途                                                                              |
| ----------- | --------------------------------------------------------------------------------- |
| 根入口      | `processPlugin`、`isProcessChild`、选项类型与错误身份                             |
| `/features` | `sendQueueFeature`、`ipcLogFeature` 与原 flow-control 常量/类型，配置原 IPC owner |

原生进程和 socket 实现由包内对应 owner 使用。应用选择既有短配置或完整部署配置；载体作者使用 host `/plugin` 部署 SDK。

公用期限、认证、分片、重试和类型生成从 [rpc-host/features](../rpc-host/README.md#选择传输与功能) 安装。传输独有 feature 的配置覆盖对应 IPC 字段，不另建日志或发送队列。

## 错误与生命周期

原生进程边界错误的 source 为 `rpc.transport.process`；host 准入/调用错误可能为 `rpc.endpoint`，托管结果不确定性可能为 `rpc.remote`。按 source/code 与原 cause 处理，不能用“已发送”推断“已完成”。未确认的非幂等操作先查询结果再重试。

同名客户端在旧会话仍响应时以 `HOST_PEER_NAME_DUPLICATE` 拒绝。已退出或探测失败的旧会话会正常退场，再接纳新会话；不会额外建立后台心跳。

传输定义也可直接安装到普通 `PluginHost`。其 process outlet 保留原 stop、restart、kill、replace、代次、退出事件与关闭 Promise；清理仍归真实安装 owner，不能把外部服务视为自己启动的进程。更多场景见[使用指南](./USEGUIDE.md)。
