# process plugin 使用指南

[README](./README.md) · [English](./USEGUIDE.en.md)

先选择进程来源，再把实际 processPlugin 安装到 createRpcHost。host 拥有业务目录、调用和统一关闭，原进程 owner 保留启动、socket、认证、监督与 drain。

## 在真实子进程执行并完整关闭

把下面内容保存为独立 ESM 入口；Node 24 可直接执行 TypeScript，其他工具链先编译。自派生入口必须先检查 isProcessChild，子端显式 connectToParent，避免再次启动子进程。

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'

if (await isProcessChild()) {
  await createRpcHost({
    plugins: [processPlugin({ connectToParent: true })],
    provide: { double: (value: number) => value * 2 }
  })
} else {
  const host = await createRpcHost<{ double(value: number): number }>({
    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]
  })
  try {
    console.log(await host.request('double', 21))
  } finally {
    await host.close()
  }
}
```

父端输出 42。spawn:true 选择真实主入口；路径/URL 选择另一入口。短配置也支持 command/args、cwd、env、wrap、limits、permissions、supervision。显式 command 不经 shell；wrap 每次实际启动只改写原命令一次。stdio 的 stdout 是 RPC 通道，日志用 stderr。

## 同一会话双向调用并接纳多个客户端

以下 Node/POSIX 同用户命名服务例子在同一连接上交错调用父/子两端方法：

```ts doc-test=check
import { randomUUID } from 'node:crypto'
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'

const address = 'service-' + randomUUID()
const server = await createRpcHost<{ clientValue(value: string): string }>({
  plugins: [processPlugin({ listen: address })],
  provide: { double: (value: number) => value * 2 }
})
try {
  const client = await createRpcHost<{ double(value: number): number }>({
    self: { name: 'client-a', instanceId: randomUUID() },
    plugins: [processPlugin({ connect: { target: address, timeoutMs: 1500 } })],
    provide: { clientValue: (value: string) => 'client:' + value }
  })
  try {
    const values = await Promise.all([
      client.request('double', 21),
      server.send('client-a', 'clientValue', 'ready')
    ])
    console.log(values)
  } finally {
    await client.close()
  }
} finally {
  await server.close()
}
```

再安装独立 client-b 后，server.request('clientValue', value) 会广播，结果按目标身份保留 fulfilled/rejected；send('client-a',...) 只到指定当前直连。stream 同样按目标提供独立迭代器。客户端关闭只撤自己的会话，不关闭服务或其他客户端；server.close 关闭自己的监听与会话。

## 凭据、地址与握手预算

connect 来源写为 connect:{target:nameOrAddress,timeoutMs?}，不把 target 放在顶层。spawn/listen/connectToParent 来源也可用 timeout-only connect 配置握手。connect.timeoutMs 是本次真实握手预算；顶层 connectTimeoutMs 是命名本机地址查找等待。显式地址初次拨号不套用该等待循环，已建连接断开后的恢复仍由原监督器管理，包括显式 socket 服务重启。

同用户命名端点使用原 OS 隔离与凭据边界。显式 socket/TCP 连接需匹配 token、协议和服务策略；不可把任意环境变量或伪造 bootstrap 对象当成可信来源。connectToParent 只在实际子端读取真实 stdin bootstrap，并在唯一调用端点创建前确定身份。

wire:'jsonrpc' 使用 Content-Length 字节分帧，需要真实 contract 或 establish。跨语言服务必须实现匹配协议、认证、能力与方法描述；不是任意打印 JSON 的程序都能直接接入。

## 原 IPC 功能与业务期限

```ts doc-test=check
import { sendQueueFeature, ipcLogFeature } from '@migaia/rpc-plugin-process/features'
import timeoutFeature from '@migaia/rpc-host/features/timeout'

export const features = [
  sendQueueFeature({ maxPendingData: 32, maxPendingControl: 8 }),
  ipcLogFeature({
    report: (record) => {
      console.log(record)
    }
  }),
  timeoutFeature({ ms: 1500 })
]
```

将 features 展开到同一 host.plugins，并加入恰好一个 processPlugin。sendQueueFeature 覆盖原 maxPendingData/maxPendingControl；ipcLogFeature 提交原日志 sink；未提供字段保留原配置。flow-control 子路径导出原 lane/event 常量与类型，没有另一个 flow-control 工厂。每种定义每个 host 至多安装一次。

业务调用可传 signal、timeoutMs、idempotencyKey。调用期限不同于握手与本机查找等待。取消是协作通知，断开不证明业务从未执行；使用重试功能前声明实际幂等性并确认所选存储/身份范围。相同认证 principal 的重连可以复用原 scope/store，不同 principal 隔离。

## 交给已有 PluginHost

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

这是真实定义安装，不返回另一个完整调用对象充当 source。宿主 process outlet 保留 stop/restart/kill/replace、native exit、notice 与 generation；注册名 name 是本地安装名，不等于远端 self.name。服务和 tray 沿自己的原 outlet 使用这些能力，不绕过原替换事务或租约。

## 关闭、失败与平台

先让原 drain 处理已接纳的 request/provider/stream，再释放监听或自有子进程。未接纳候选在关闭时不能晚到发布，cleanup 失败不能替换 primary；原 native/cause/errors 继续可追踪。借用服务只关闭本端会话，不杀服务进程。重复关闭共享原 Promise，不能把 terminate 请求当成已经 native exit。

同名客户端在旧会话仍响应时以 HOST_PEER_NAME_DUPLICATE 拒绝；旧会话已死或一次原 ping 失败/到期时正常退场再接纳。不会附加后台 heartbeat。业务缺少目标是 TARGET_UNKNOWN，未知结果先对账再重试。

原生错误 source 为 rpc.transport.process，host/调用和托管错误仍可能来自 rpc.endpoint/rpc.remote。按 source/code 判断，不按文本匹配；保留原生 TypeError/AbortError 等类型和完整原因链。Node/Bun/Deno、Electron utility process、Windows Job 的能力取决于实际适配器；权限或资源参数不创造原生不存在的隔离。
