# thread plugin 使用指南

[README](./README.md) · [English](./USEGUIDE.en.md)

本包为 Node、Bun、Deno 的实际线程提供 transport plugin。浏览器 Worker、SharedWorker 与页面端口使用 [browser 指南](../rpc-plugin-browser/USEGUIDE.md)，不要依赖服务器 guard 猜浏览器来源。

## 从实际 Worker 开始

保存为独立 ESM 入口，Node 24 可直接运行 TypeScript；其他工具链先编译。父端显式 spawn，子端用真实 bootstrap 接父端：

```ts doc-test=check
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

父端输出 42。显式入口可用 spawn:new URL('./worker.js',import.meta.url)。provide 可含生成器，父子都可反向调用同一会话。self 是应用握手身份，不应从原生端口或环境字符串伪造；省略时使用原 launcher/bootstrap 的独立身份。

## 逐项结果、提前结束与调用取消

```ts doc-test=check
import type { IRpcHost } from '@migaia/rpc-host'

type IWorkerApi = {
  worker: { values(end: number): AsyncIterable<number>; wait(value: number): number }
}
export async function consume(host: IRpcHost<IWorkerApi>) {
  const stream = host.peers.worker.values(3)
  try {
    return await stream.next()
  } finally {
    await stream.return?.()
  }
}
export async function cancel(host: IRpcHost<IWorkerApi>) {
  const controller = new AbortController()
  const pending = host.send('worker', 'wait', 1, { signal: controller.signal, timeoutMs: 1500 })
  controller.abort()
  return await pending
}
```

helper 的 host 声明包含当前直连 worker。流 next/return/throw 仍是原迭代器；提前 return 结束对应业务流，不终止整个 Worker。调用 signal 与 task/Worker 寿命不是同一层。处理方必须读取其 context.signal，取消不能抢占同步死循环。

notify 只等物理发送，request 等业务结果。多个当前直连的无目标调用按 host 广播规则返回；需要一个标量用 send(nameOrId,method,payload)。持有的 peers.worker 方法绑定原代，重启后旧函数拒绝；重新读取当前目录取得新能力。

## 崩溃、重启与结果对账

```ts doc-test=check
import { retryFeature, timeoutFeature } from '@migaia/rpc-host/features'

export const recoveryFeatures = [retryFeature(), timeoutFeature({ ms: 1500 })]
```

安装到同一 host.plugins。原 supervisor 决定是否及何时自动重启；retryFeature 使用原代次、声明、幂等性与期限判断请求可否重试，不另建重启器。未确认执行可能得到 REMOTE_RESULT_UNKNOWN；没有此策略的原传输失败仍保持原错误。不能看到连接恢复就盲目重发非幂等调用。

connect.timeoutMs 是 identity/能力握手的共享预算，调用 timeoutMs 只控制对应业务等待。启动超时、停止、资源预算、heap/权限限制仍由所选原生来源及 supervisor 配置负责。一个关闭的 host 不可复活；使用新 host 才建立新的所有权。

## 克隆与 ownership transfer

```ts doc-test=check
import type { IRpcHost } from '@migaia/rpc-host'

type IWorkerApi = { worker: { bytes(value: Uint8Array): number } }
export async function sendOwnedBytes(host: IRpcHost<IWorkerApi>, bytes: Uint8Array<ArrayBuffer>) {
  return await host.send('worker', 'bytes', bytes, { transfer: [bytes.buffer] })
}
```

这段 helper 只有在实际会话具备 native carrier、双方协商能力及受支持认证配置时才能成功。未认证 RPC transfer 会在原准入边界拒绝，不因为底层有 postMessage 就授权。需要普通复制时不传 transfer list。失败后检查原 buffer 是否仍由本端拥有；不要自行假定 detach 或业务完成。

## 原生错误与资源观测

rpc.transport.thread 标记线程边界；rpc.endpoint 与 rpc.remote 保留调用及托管错误。跨 Worker 的标准错误表示保留 source/code/name/message/stack/cause 与 aggregate members，但不保留任意自定义类原型。按这些身份处理，不匹配消息。

原生采样针对实际选中的 Worker isolate。heap/CPU 字段只有原生 API 支持时才存在，线程共享进程 PID，不能把父进程 RSS 当成线程内存。替换期间正在等待的采样保持原代，不能悄悄重选新 handle。

## 交给宿主与关闭

普通 PluginHost 安装 threadPlugin 后，原 thread outlet 管理 stop/restart/replace、ready/exit 和 generation。name 是安装名；实际远端 self.name 是另一项身份。应用使用宿主既有控制，不重建监督或把完整旧调用对象当 source。

host.close 先沿原 drain 处理已接纳工作，再释放所拥有 Worker。terminate 请求至多一次，exited 只在真正 native exit 后结算；旧代晚到结果不重开已经关闭的连接。取消一个调用、关闭一个流、关闭 host 与杀 Worker 是不同责任。

根入口是 threadPlugin/isThreadChild、选项与错误；/adapters/node、/adapters/electron-main 供确需原生 launcher/channel 的作者使用。短配置覆盖常见应用，浏览器必须使用 browser plugin。
