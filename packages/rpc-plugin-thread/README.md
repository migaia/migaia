# `@migaia/rpc-plugin-thread`

把 `createRpcHost` 的业务调用交给 Node、Bun 或 Deno 的真实线程，复用原生 Worker 的监督、代次与清理。

[English](./README.en.md) · [使用指南](./USEGUIDE.md)

## 为什么选它

- 父子两端都可提供方法、反向调用和逐项返回结果。
- 期限、协作取消、资源准入和错误原因沿同一调用链处理。
- Worker 崩溃后由原监督器恢复连接；旧代的能力和未确认结果不会冒充新代结果。
- host 关闭时释放自己启动的 Worker，原生退出与 terminate 请求保持分开。

浏览器页面和浏览器 Worker 使用 [rpc-plugin-browser](../rpc-plugin-browser/README.md)。需要操作系统进程隔离时使用 [rpc-plugin-process](../rpc-plugin-process/README.md)。

## 从这里开始

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-thread
```

保存为独立 ESM TypeScript 入口，在支持原生 TypeScript 的 Node 24 中执行；其他工具链先编译为 ESM。该文件会在子线程再次执行，guard 防止继续派生。

```ts doc-test=run
import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'

if (await isThreadChild()) {
  await createRpcHost({
    plugins: [threadPlugin({ connectToParent: true })],
    provide: { double: (value: number) => value * 2 }
  })
} else {
  const host = await createRpcHost<{ double(value: number): number }>({
    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]
  })
  try {
    console.log(await host.request('double', 21))
  } finally {
    await host.close()
  }
}
```

输出 `42`。显式入口也可使用 `spawn: new URL('./worker.js', import.meta.url)`；该入口用 `connectToParent: true` 接受实际父端 bootstrap。

## 来源与调用

| API / 选项                                | 用途                                             |
| ----------------------------------------- | ------------------------------------------------ |
| `threadPlugin({ spawn })`                 | 选择当前入口、路径/URL、短配置或完整原生监督配置 |
| `threadPlugin({ connectToParent: true })` | 仅在实际线程子端接父端                           |
| `isThreadChild()`                         | 异步读取当前原生子线程身份                       |
| `connect: { timeoutMs }`                  | 单次 identity/能力准备的共享预算                 |
| `createRpcHost({ provide, self, ... })`   | 配置业务与本端身份，而非猜测原生 Worker 身份     |
| `host.request / notify / stream / send`   | 使用 host 的统一调用语义                         |

只选 spawn 或 connectToParent 之一，不接收浏览器 Window、SharedWorker 或任意伪造父端。子端身份来自原 launcher 的真实 bootstrap。一个 host 使用一个调用端点；安装 [poolPlugin](../rpc-plugin-pool/README.md) 可由同一 host 管理多个隐藏线程成员。

## 期限、错误与恢复

调用传 `signal` 和 `timeoutMs`；传输的 `connect.timeoutMs` 单独约束握手。取消是协作信号，不会自动终止任意同步循环；需要强制停止时使用原监督控制。断开后的未确认业务可能已执行，不能把自动恢复解释为自动安全重放。

原生线程错误 source 为 `rpc.transport.thread`，调用错误可能为 `rpc.endpoint` 或 `rpc.remote`。序列化保留错误的 source/code/name/message/stack/cause 与聚合成员；按身份处理，不按文本匹配。

结构化克隆与 ownership transfer 是不同能力。RPC transfer 还要求双方实际协商的能力和受支持认证配置，不能仅因底层支持 `postMessage` 就假设允许；失败时检查原错误链。原生资源读取来自当前实际 Worker，不把进程 RSS 冒充线程内存。

## 原生接入与生命周期

根入口提供 `threadPlugin`、`isThreadChild`、公开选项类型和错误身份。原生 launcher/channel 由包内对应 owner 使用；应用通过短 spawn 或完整原生监督配置选择来源。自定义原始载体使用 `@migaia/rpc-host/plugin` 的部署 SDK。

传输定义可交给普通 `PluginHost.use(...)`，其 thread outlet 保留原停止、重启、替换、退出事件和代次语义。关闭先沿原生 drain 处理已接纳任务，再释放自己拥有的 Worker；同一次关闭不重复 terminate。更多示例见[使用指南](./USEGUIDE.md)。
