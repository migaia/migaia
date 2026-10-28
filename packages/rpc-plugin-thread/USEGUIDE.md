# Thread 使用指南

[README](./README.md) · [English](./USEGUIDE.en.md)

Contract 只定义纯协议和接口；Host 拥有会话、目录、provider 与调用生命周期；Thread transport 获取和监管真实 Worker。flow plugin 通过固定消息介入点提供 auth、chunk、batch、probe；feature 提供所属 plugin 的 timeout、retry 或 pool。一个 Host 可以按不同命名空间安装多个 transport；本指南只需要 Thread。

## 显式父子入口

父入口使用真实 `worker.js`，并将完整策略实例装在 transport 的 `features`。声明远端类型时同时保留 `typeof plugins`，以保留 namespace 和成员控制的类型。

```ts doc-test=check
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { timeoutFeature, retryFeature } from '@migaia/rpc-host/features'

type IWorkerApi = {
  values(end: number): AsyncIterable<number>
  wait(value: number): number
  bytes(value: Uint8Array<ArrayBuffer>): number
}

const plugins = [
  threadPlugin({
    name: 'worker',
    spawn: new URL('./worker.js', import.meta.url),
    features: [timeoutFeature({ ms: 1500 }), retryFeature({ attempts: 2 })]
  })
] as const

type IThreadHost = IRpcHost<IWorkerApi, typeof plugins>

export function open() {
  return createRpcHost<IWorkerApi, typeof plugins>({ plugins })
}

export async function firstValue(host: IThreadHost) {
  const stream = host.thread.peers.worker.values(3)
  try {
    return await stream.next()
  } finally {
    await stream.return?.()
  }
}

export function work(host: IThreadHost, signal: AbortSignal) {
  return host.thread.send('worker', 'wait', 21, {
    signal,
    timeout: timeoutFeature({ ms: 500 }),
    retry: false
  })
}

export function sendBytes(host: IThreadHost, bytes: Uint8Array<ArrayBuffer>) {
  return host.thread.send('worker', 'bytes', bytes, { transfer: [bytes.buffer] })
}

export async function inspectAndRestart(host: IThreadHost) {
  const before = await host.thread.members.get('worker')
  await host.thread.members.restart('worker')
  return before
}
```

`worker.js` 对应的子入口如下。用工具链编译 ESM，或为支持原生 TypeScript 的运行环境选实际 `.ts` 入口。相对字符串以实际主入口解析；需要固定基准时使用短配置 `{ entry, base }`。

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'

await createRpcHost({
  plugins: [threadPlugin({ connectToParent: true })],
  provide: {
    values: async function* (end: number) {
      for (let value = 0; value < end; value += 1) yield value
    },
    wait: (value: number) => value,
    bytes: (value: Uint8Array) => value.byteLength
  }
})
```

`spawn` 与 `connectToParent` 必须恰选一个。短配置支持 `entry/name/data/limits` 和调用方提供的原生 launcher、budget、scheduler；完整 `IThreadSpawn` 保留所选原生监管配方。`name` 是注册名，`namespace` 决定 `host.<ns>`。父子身份与 generation 来自真实 bootstrap；显式 `self` 必须与实际来源一致。

## 调用与策略

`host.thread.request` 无目标时按当前直连集合调用；`send(nameOrId, method, payload, options)` 选择一个目标。`notify` 使用 `{ targetId }` 选择目标，只等实际物理写出，不等 provider 完成或 ACK。普通 namespace 有多个直连时，无目标调用返回各目标独立的结果。

`timeoutFeature`、`retryFeature` 只能是完整 feature 实例或 `false`。优先级为单次调用、transport 安装值、链路策略 plugin。上例单次调用使用 500 ms timeout，并关闭该次 retry；没有选中的策略就不自动启用。原生启动、health、stop 与业务调用的期限各有原 owner，不能用业务 timeout 推断它们的时钟。

Thread 的 `spec.limits.callWallTimeMs` 围住整个 originating 调用，包括 retry/backoff；同一原生 registration 保留其初始已准入 spec 的上限，重启或替换不会偷偷换掉该配置。较短的业务 timeout 仍可提前结束调用，`timeout: false` 不能取消该原生上限。未设置原生上限时，`timeout: false` 不自动添加期限。

`signal` 协作取消业务；处理方通过 context.signal 观察。取消不会抢占同步循环，也不等于终止 Worker。原生重启策略来自 supervisor，retry 只在实际支持的代次与业务声明条件下决定调用是否重放。未确认结果可能已执行，不能将恢复连接当成安全重试授权。

## 流、transfer 与观察

示例通过当前 `host.thread.peers.worker` 取得绑定该代的流能力。结束或提前退出时调用 `return()`；持有旧代方法不能在重启后自动变成新代方法，应重新读取当前目录。

`transfer` 传原始 ArrayBuffer，而非另造 backing。成功原生 handoff 可能转移所有权；普通复制则省略 transfer。认证通过独立 auth flow plugin 安装，应用应使用实际载体支持的组合；不要从一个底层 `postMessage` 方法推导额外认证或能力承诺。

自定义载体的真实接入路径是 `@migaia/rpc-host/sdk`；只读原始载体与流程观察使用 `@migaia/rpc-host/plugins/probe`。线程资源查询只报告实际原生采样；线程共享进程 PID，不以进程 RSS 冒充单个线程内存。

原生 `messageerror` 只报告一次该诊断，不关闭仍合法的连接；诊断字符串转换失败先报告带原 cause 的转换错误。只读 probe 回调失败保留 `TRANSPORT` 与原 cause，不阻止原生投递。没有真实原生错误的主动重启/替换不会伪造 TRANSPORT cause；REMOTE_CLOSED 的代次信息仍保留。

重启后重新按 namespace 发起的无目标调用读取当时 accepted 集合；空集合使用正常 fanout 结果。此前持有的函数仍绑定原代，退场后拒绝 `TARGET_UNKNOWN`，不会自动指向新 Worker。

## 成员管理与关闭

`host.thread.members` 提供 `list/get/stop/kill/restart/replace/on/watch`。查询可使用当前实例 ID 或注册名；stop/restart/replace 需要实际受管来源，borrowed 来源不能凭空获得 supervisor。事件与查询的身份来自原注册及实际 accepted session。

调用结束、流结束、namespace.close、Host.close 和 native kill 是不同层的操作。应用先结束自己持有的流与业务，再关闭 Host；原生资源沿实际归属释放。错误 source 可能为 `rpc.transport.thread`、`rpc.endpoint` 或 `rpc.remote`，应保留并检查其 code/cause/error graph，而非通过消息文本分类。
