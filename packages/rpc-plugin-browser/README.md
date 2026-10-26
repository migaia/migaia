# `@migaia/rpc-plugin-browser`

将真实 Window、Worker、BroadcastChannel、可靠 RTCDataChannel 或 WebTransport 接入 RPC。应用创建原生对象；Browser owner 负责原生来源和 I/O，Host 负责会话、目录与业务调用。

[English](./README.en.md) · [使用指南](./USEGUIDE.md)

## 开始使用

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-browser
```

页面入口借用一个模块 Worker，调用位于默认的 `worker` namespace。下方 Worker 模块由实际 `worker.ts` 入口调用 `startWorker(self)`，再编译为 `worker.js`。

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
try {
  const host = await createRpcHost({
    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]
  })
  try {
    console.log(await host.worker.request('double', 21))
  } finally {
    await host.close()
  }
} finally {
  worker.terminate()
}
```

独立 Worker 模块接收真实原生来源。实际 `worker.ts` 入口使用 Worker 全局类型编译，再调用 `startWorker(self)`：

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { dedicatedWorkerPlugin, type IWorkerPluginOptions } from '@migaia/rpc-plugin-browser'

/** 借用真实 Worker 全局；原生生命周期仍由应用管理。 */
export function startWorker(worker: IWorkerPluginOptions['worker']) {
  return createRpcHost({
    plugins: [dedicatedWorkerPlugin({ worker })],
    provide: { double: (value: number) => value * 2 }
  })
}
```

Worker 提供 `double` 后，兼容的页面调用可取得 `42`。应用仍负责 Worker 地址、创建、部署和最终 terminate；这些示例做公开 dist 类型检查，不代替跨 realm 运行验证。

## 七个工厂与默认 namespace

| 工厂                     | 来源选项                                              | 默认 namespace     |
| ------------------------ | ----------------------------------------------------- | ------------------ |
| `windowPlugin`           | `{ window, origin, receiver? }`                       | `window`           |
| `dedicatedWorkerPlugin`  | `{ worker }`                                          | `worker`           |
| `sharedWorkerPlugin`     | `{ sharedWorker }` 或 `{ listen: self }`              | `sharedWorker`     |
| `broadcastChannelPlugin` | `{ channel }`                                         | `broadcastChannel` |
| `serviceWorkerPlugin`    | `{ serviceWorker, receiver? }` 或 `{ clients: self }` | `serviceWorker`    |
| `rtcDataChannelPlugin`   | `{ rtcDataChannel }`                                  | `rtcDataChannel`   |
| `webTransportPlugin`     | `{ session }`                                         | `webTransport`     |

公共选项包括 `name`、`namespace`、`expose`、`connect: { timeoutMs }` 与完整业务 `features`。SharedWorker/ServiceWorker 两种来源互斥。根入口只导出这些工厂、对应选项类型以及 `RpcBrowserErrorCode`、`RPC_BROWSER_ERROR_SOURCE`。

推荐每个 Host 只安装一种传输，而非混用多种媒介；多端口或多参与者仍可属于同一种传输。确需混装时明确 namespace、路由与权限，不能把异构媒体当作同质成员池。

## 调用与来源

根对象管理 `self/provide/close`；业务在 `host.worker`、`host.window` 等真实 namespace 下使用 `request/notify/stream/group`。`send(nameOrId, method, payload)` 选择一个当前直连，未指定目标时使用该 namespace 的当前直连集合。`outcome` 等扩展只有安装相应 plugin 后才可用。

Window 绑定实际 `event.source` 和显式 origin；`'*'` 还需 `allowUnsafeTargetOrigin: true`。ServiceWorker 通过真实 source 与 Client 查找接纳连接；载荷自报 ID 不能赋予来源权限。BroadcastChannel 的频道名不是对端身份，参与者仍需发现并完成协议握手。

## 归属与协议

关闭 Host 撤回其订阅和会话，不终止借入 Worker、MessagePort、BroadcastChannel、RTCDataChannel 或 WebTransport session。WebTransport 只拥有自己创建的可靠双向流及其 reader/writer/锁；不使用 datagram。应用负责最终释放自己创建的原生对象。

唯一协议是 `migaia.rpc/2`。`@migaia/rpc-contract/protocol` 提供纯协议数据与准入，`/interfaces` 提供能力类型，错误契约在 `/errors` 和 `/error-code`；Contract 不执行业务 schema、I/O 或策略。自定义载体使用 `@migaia/rpc-host/sdk` 的 canonical carrier。业务校验等能力通过实际 `/plugins/*` 安装，不能配置成 transport 的隐藏开关。

原生 structured clone 与显式 ownership transfer 是不同能力。BroadcastChannel、RTC、WebTransport 不提供本插件所需的 native transfer；Window/Worker 的显式 transfer 仍受真实媒体与所装策略约束。

## 当前边界

原生来源过滤不等于认证 principal 或跨重连 session/scope 已建立。自动 auth/source freshness、部分 outcome/幂等流程及 observer 诊断兼容性仍有未闭合项；不承诺通过频道名或 native source 自动取得这些保证。通用 Host close/drain 与重启 downtime 的行为差异也不能编成浏览器保证。

错误可能来自 `rpc.transport.browser` 或通用 RPC owner；保留 `source/code/cause/errors` 和原生 stack，不用消息文本或单一 code 猜执行结果。完整迁移验收仍 pending，详见[使用指南](./USEGUIDE.md)。
