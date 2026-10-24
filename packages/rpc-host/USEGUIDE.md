# rpc-host 使用指南

[README](./README.md) · [English](./USEGUIDE.en.md)

一个 `createRpcHost` 配置一个传输 plugin，再按需安装 feature。以下场景使用真实公开入口；传输准备、调用目录和原生清理由现有 owner 分别负责。

## 建立可完整关闭的双向连接

下面的完整示例只需要 host、contract 与 coroutines 三个包。父端安装 timeout feature；子端从本代 task 的 connect 句柄建立自己的 host。该节断言业务结果并输出 42，finally 关闭双方。

完整可运行示例放在后文“从旧包迁移”，同时演示父子 host、timeout feature 与 finally 清理。

协程用于同一事件循环，不是 Worker 隔离。换成 processPlugin 或 threadPlugin 时，业务 provide 与调用接口保持一致。每个 host 只有一个实际调用端点，多会话也不额外创建端点。

## 提供普通方法、生成器和协作取消

provide 是嵌套函数对象；函数返回值成为结果，抛出的原错误走既有错误传输。相同方法名再次登记会拒绝，原登记不会被替换。

```ts doc-test=check
import type { IRpcHost, IRpcContext } from '@migaia/rpc-host'

export function exposeWork(host: IRpcHost) {
  host.provide({
    double: (value: number) => value * 2,
    values: async function* (end: number) {
      for (let value = 0; value < end; value++) yield value
    },
    wait: (_value: unknown, context: IRpcContext) => {
      if (context.signal.aborted) throw context.signal.reason
      return new Promise<void>((_resolve, reject) => {
        context.signal.addEventListener('abort', () => reject(context.signal.reason), {
          once: true
        })
      })
    }
  })
}
```

调用方通过 options.signal 取消；处理方读取自己的 context.signal。取消只终止对应调用，不是自动杀进程或回滚已执行副作用。示例 wait 专门等取消，真实工作应在自己的 finally 中释放资源。

## 明确选择目标与消费流

声明可以是单个能力，或以直连名称映射的能力集合。下面的 helper 接受已连接的 host，保留目标与方法之间的类型关系：

```ts doc-test=check
import type { IRpcHost } from '@migaia/rpc-host'

type IWorkers = {
  worker: {
    double(value: number): number
    values(end: number): AsyncIterable<number>
  }
}

export async function useWorker(host: IRpcHost<IWorkers>) {
  const answer: number = await host.send('worker', 'double', 21)
  const values: number[] = []
  for await (const value of host.peers.worker.values(3)) values.push(value)
  return { answer, values }
}
```

无目标 request/notify/group/outcome 的普通 host 规则：0 个目标得到空 fulfilled/rejected；1 个目标返回标量、失败直接拒绝；多个目标按目标身份保留 fulfilled/rejected。stream 对多目标返回独立迭代器集合，单个 return/取消不影响其他迭代器。pool 是一个逻辑目标，因此总是只选一个成员执行。

## 通知、分组与结果不确定性

```ts doc-test=check
import type { IRpcHost } from '@migaia/rpc-host'

type IApi = { update(value: number): number }
export async function sendUpdates(host: IRpcHost<IApi>) {
  await host.notify('update', 1, { targetId: 'worker' })
  const outcomes = await host.group([
    { method: 'update', payload: 2 },
    { method: 'update', payload: 3 }
  ])
  return outcomes
}
```

notify 的 Promise 表示物理发送完成，不表示业务处理完成。dispatch 同步返回 void，失败交给原报告通道。group 的步骤由每个选中目标处理，没有跨目标事务。outcome(key) 查询原幂等结果存储；连接恢复不能证明未确认业务没有执行。

调用 timeoutMs 优先于 host.defaultTimeoutMs，再优先于 timeoutFeature 默认；传输 connect.timeoutMs 独立约束握手。两种 feature 导入同一模块级定义，选一种安装，不在同一 host 重复安装：

```ts doc-test=check
import timeoutFeature from '@migaia/rpc-host/features/timeout'

export const deadline = timeoutFeature({ ms: 1500 })
```

## 发布转发能力与自动名称空间

b 先连接 c，再发布下面的能力，之后让调用方取得对应目录：

```ts doc-test=check
import type { IRpcHost } from '@migaia/rpc-host'

type INext = { c: { render(value: string): string } }
export function publishHeldRender(b: IRpcHost<INext>) {
  b.provide({ render: b.peers.c.render })
}
```

持有的函数绑定 c 原来的连接代次，退出后拒绝，不自动指向新实例。另一种是 a 调用 send('b', 'c.render', value)：b 先查 c 是当前存活直连，再查 c 当前目录。断开/重连期间以 TARGET_UNKNOWN 拒绝；未知方法保持原未知方法码。环路与第四次转发在进入业务前拒绝。名称无法表达为方法段时仍可直连调用或显式 provide 别名，不扩大方法语法。

## 从已接受目录生成类型

```ts doc-test=check
import { typegenFeature } from '@migaia/rpc-host/features'

export const declarations = typegenFeature({
  out: {
    write: (fileName, text) => {
      console.log(fileName, text)
    }
  }
})
```

把 declarations 安装进 plugins。write 是应用拥有的输出能力，上例显示文件名与文本；实际文件系统 I/O 由应用决定。生成器订阅已接受目录，不依赖对端语言；方法 input/output/yield schema 来自真实 contract 描述，新代只在接受后写入。feature 卸载后停止写入，写入失败走 host.report。

## 在同一个 host 上观察

观察定义通过真实 feature 安装，借用 host 已有端点。只保留需要的字段；事件视图只在 emit 调用期间有效，延后读取时由应用复制。

```ts doc-test=check
import { defineProbe } from '@migaia/rpc-host/probe'
import { defineFeaturePlugin } from '@migaia/rpc-host/plugin'

export const observation = defineFeaturePlugin({
  name: 'application-observer',
  probe: defineProbe({
    stages: ['message', 'peer'],
    emit: (view) => console.log({ ...view })
  })
})
```

把 observation 与传输一起放入 host 的 plugins。host 关闭时释放对应观察订阅；观察器失败仍走原 report 通道，不接管业务资源。

## 从旧包迁移

先换包名：rpc-core→rpc-host，rpc-process→rpc-plugin-process，rpc-threads→rpc-plugin-thread，rpc-browser→rpc-plugin-browser，rpc-pool→rpc-plugin-pool，rpc-devtools→rpc-plugin-devtools。协程独立为 rpc-plugin-coroutines。下表中的旧名称只用于迁移识别，不是兼容入口。

| 旧 API 家族                                                                         | 新路径                                                              |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `createEndpoint` / `createFullEndpoint`                                             | `createRpcHost` + 一个传输；本地 provide、直连 send、无目标 request |
| `createClientEndpoint` / `createProviderEndpoint`                                   | 同一个 host 入口；按需省略或提供本地 provide                        |
| `createComposedEndpoint` / 旧 outbound/provider/discovery/control 预设              | 在 host 安装受支持的公开 features，不组装预设图                     |
| `createFullOneWayEndpoint` / `sendOneWay`                                           | notify 等待物理发送；dispatch 发送后报告失败                        |
| `createRuntimeApiEndpoint`                                                          | host 拥有唯一调用端点；作者只从 /plugin 提交 raw deployment         |
| `createRuntimePeer` / `createManagedRuntimePeer` / `createRuntimePlugin`            | host + 传输；原生监督器仍拥有代次与恢复                             |
| `createRemoteHost` / `createRemotePlugin` / `serveRemoteHost` / `serveRemotePlugin` | host + 传输 + provide，或真实 plugin-host 安装                      |
| `createProcessPeer`                                                                 | createRpcHost + processPlugin，子端来源显式指定                     |
| `createThreadPeer`                                                                  | createRpcHost + threadPlugin；浏览器 Worker 使用 browser plugin     |
| `createBrowserPeer` / 旧 web adapter 用户组装                                       | host + 七种浏览器载体之一                                           |
| `createProcessPlugin` / `createThreadPlugin`                                        | processPlugin / threadPlugin 安装到 host 或普通 PluginHost          |
| 旧 coroutine host/plugin 工厂                                                       | 独立包 coroutinePlugin；子端接收 opaque connect 句柄                |
| `createPool` / `createThreadPool` / `createProcessPool`                             | 传输 + poolPlugin；逻辑目标 pool，每次一个标量执行                  |
| `createRpcDevtools`                                                                 | devtoolsPlugin().collector；安装同一实例采集观察                    |

下面是使用新入口的完整替代示例。父端、子端和 timeout feature 都实际运行，并在 finally 关闭。

```ts doc-test=run
import assert from 'node:assert/strict'
import { createRpcHost } from '@migaia/rpc-host'
import { timeoutFeature } from '@migaia/rpc-host/features'
import { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'

const host = await createRpcHost<{ double(value: number): number }>({
  plugins: [
    coroutinePlugin({
      spawn: async ({ connect, signal }) => {
        const child = await createRpcHost({
          plugins: [coroutinePlugin({ connectToParent: connect })],
          provide: { double: (value: number) => value * 2 }
        })
        try {
          if (!signal.aborted)
            await new Promise<void>((resolve) => {
              signal.addEventListener('abort', () => resolve(), { once: true })
            })
        } finally {
          await child.close()
        }
      }
    }),
    timeoutFeature({ ms: 1500 })
  ]
})
try {
  const value = await host.request('double', 21)
  assert.equal(value, 42)
  console.log(value)
} finally {
  await host.close()
}
```

同一 host 只能安装一个传输、一个成员 assembler，同一 feature 定义至多一次。不能 spread/copy 定义后当成已注册 plugin；必须保留工厂实际返回对象。connect 参数描述安装时的连接准备，不是重复安装或热替换指令。

## 错误与关闭边界

按 source/code 判断：rpc.endpoint 为 host/调用，rpc.remote 为托管远端结果，rpc.transport.* 为实际载体。保留原生类型、stack、cause 和 errors；不要匹配消息或把未知结果统一当成可重试。close/asyncDispose 沿相同原关闭 Promise；只关闭所拥有资源，借用原生载体仍由应用关闭。

普通 PluginHost 直接 use 这些真实定义，保留原替换与反向清理顺序。自定义来源作者使用 @migaia/rpc-host/plugin 的冷 raw deployment 与作用域能力，不能把完整旧调用对象冒充 source。进程、线程、浏览器、协程、池和观察器的各自指南说明原生归属。
