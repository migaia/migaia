# @migaia/rpc-host

[English](./README.en.md) · [使用指南](./USEGUIDE.md)

把计算挪到 Worker、子进程或另一个页面以后，调用它们的代码常常比计算本身更难写对：超时以后对端还在跑，错误到了这边只剩一句字符串，关闭时还有调用在等。`@migaia/rpc-host` 让你像调用本地函数一样调用另一边的函数，同时把超时、取消、错误和关闭都传过边界：调用方超时，对端立即收到取消信号；对端抛出的错误带着原来的 `source`、`code`、堆栈和 `cause` 回来；关闭 host 时，等待中的调用一起结束。

用哪种通道由传输插件决定：协程（同一事件循环）、Worker 线程、子进程、浏览器窗口和 iframe 各有一个包，调用方式都一样。

## 你可能遇到过

- **超时了，对端还在算**：调用方等了 5 秒放弃，Worker 里的计算继续跑完，白白占着 CPU。根因是超时只发生在调用方这一侧，没有把取消传过去。
- **错误过了边界就认不出来了**：子进程抛出的错误到了主进程只剩 `message`，`code` 和 `cause` 都丢了，只能按字符串判断。根因是错误被序列化成了普通对象。
- **关闭时调用永远挂着**：Worker 被终止了，还在等结果的 Promise 永远不结束。根因是没人负责在关闭时结算待决调用。
- **换一种通道就要重写调用代码**：从 Worker 换成子进程，请求 ID、消息格式和超时逻辑全部重写。根因是调用逻辑和通道绑在了一起。

## 为什么选它

常见的写法是 `postMessage` 加一张“请求 ID → Promise”的映射表，或者一个把方法调用转成消息的代理。它能跑通正常路径，但在下面这些地方会出问题：

- **超时和取消会传到对端。** 调用方超时或调用 `signal.abort()` 后，对端 provider 的 `context.signal` 随之中止，可以停下手里的工作。[示例](./USEGUIDE.md#安装完整策略)
- **错误回来时还是原来的错误。** 远端错误还原成原生 Error，保留 `source`、`code`、`stack`、`cause` 和 `AggregateError.errors`，按 `source/code` 判断即可。[示例](./USEGUIDE.md#关闭与错误)
- **一套调用 API，换通道只换插件。** `request`、`notify`、`stream`、`group` 在协程、线程、子进程和浏览器通道上用法相同；切换通道只需换传输插件。[示例](./USEGUIDE.md#选择目标并消费流)
- **关闭是有序的。** `host.close()` 先以 `ENDPOINT_DISPOSED` 结算所有等待中的调用，再关闭底层连接；重复调用共享同一个 Promise。[示例](./USEGUIDE.md#关闭与错误)
- **认证、限流、去重等能力按需安装。** `authFeature`、`limitsFeature`、`idempotencyFeature` 等都是独立的 Feature，不装就不打包。[示例](./USEGUIDE.md#认证签名与重复请求)

只是在同一个模块里调用几个函数，或者一次性把数据发给 Worker、不需要结果和取消时，直接 `postMessage` 更简单。

## 从这里开始

下面用协程通道在同一个进程里演示：对端提供两个方法，其中 `slowReport` 要 1 秒才完成，而调用方的超时是 100 毫秒。用 Node 24 直接运行。

```ts doc-test=run
import { createRpcHost } from '@migaia/rpc-host'
import { timeoutFeature } from '@migaia/rpc-host/features'
import { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'

type IReportService = {
  double(value: number): number
  slowReport(): Promise<string>
}

const host = await createRpcHost<IReportService>({
  plugins: [
    coroutinePlugin({
      features: { timeout: timeoutFeature({ ms: 100 }) }, // 每次调用最多等 100 毫秒
      // 对端：真实项目里它在 Worker 或子进程里，这里放在同一个进程里便于运行
      spawn: async ({ connect, signal }) => {
        const worker = await createRpcHost({
          plugins: [coroutinePlugin({ connectToParent: connect })],
          provide: {
            double: (value: number) => value * 2,
            slowReport: (_input: undefined, context: { signal: AbortSignal }) =>
              new Promise<string>((resolve, reject) => {
                const timer = setTimeout(() => resolve('report'), 1000)
                context.signal.addEventListener('abort', () => {
                  clearTimeout(timer)
                  console.log('对端收到取消，停止生成报表')
                  reject(context.signal.reason)
                })
              })
          }
        })
        try {
          if (!signal.aborted)
            await new Promise<void>((resolve) =>
              signal.addEventListener('abort', () => resolve(), { once: true })
            )
        } finally {
          await worker.close()
        }
      }
    })
  ]
})
try {
  console.log(await host.coroutine.request('double', 21))
  await host.coroutine.request('slowReport')
} catch (error) {
  const { source, code } = error as { source: string; code: string }
  console.log(`调用失败：${source} / ${code}`)
} finally {
  await host.close()
}
```

输出：

```text
42
调用失败：rpc.endpoint / DEADLINE_EXCEEDED
对端收到取消，停止生成报表
```

`double` 正常返回 `42`。`slowReport` 超过 100 毫秒后，调用方以 `DEADLINE_EXCEEDED` 失败，同时对端的 `context.signal` 被中止，报表生成随之停下，而不是在后台继续跑满 1 秒。调用写成 `host.coroutine.request(...)`：`coroutine` 是这个传输插件的命名空间，换成 Worker 线程时就是 `host.thread.request(...)`。

下一步：要把计算放进 Worker，看 [`@migaia/rpc-plugin-thread`](../rpc-plugin-thread/README.md)；放进子进程，看 [`@migaia/rpc-plugin-process`](../rpc-plugin-process/README.md)；给所有调用加默认超时和重试，看[安装完整策略](./USEGUIDE.md#安装完整策略)。

## 手写时的隐患

下面是常见的手写 Worker 调用。它能跑，但有三个隐患（只用于说明，不必运行）：

```ts doc-test=check
declare const worker: {
  postMessage(message: unknown): void
  onmessage: ((event: { data: { id: number; result: unknown } }) => void) | null
}

const pending = new Map<number, (value: unknown) => void>()
let nextId = 0

worker.onmessage = (event) => {
  pending.get(event.data.id)?.(event.data.result)
  pending.delete(event.data.id)
}

function call(method: string, payload: unknown): Promise<unknown> {
  const id = nextId++
  worker.postMessage({ id, method, payload })
  // 隐患 1：超时只是不再等待；Worker 里的计算照样跑完，白占 CPU
  return Promise.race([
    new Promise((resolve) => pending.set(id, resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
  ])
}

// 隐患 2：Worker 里抛出的错误要自己序列化，code、cause 和堆栈通常在这里丢掉
// 隐患 3：worker.terminate() 之后，pending 里的 Promise 永远不会结束
void call('render', { page: 1 })
```

用 rpc-host 时，超时会作为取消信号传到对端，错误按原样还原，`close()` 会结算所有等待中的调用。

## 三分钟心智模型

| 概念     | 一句话                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------- |
| host     | `createRpcHost` 返回的对象；拥有连接、待决调用和关闭过程                                                 |
| 传输插件 | 决定通道，例如 `coroutinePlugin`、`threadPlugin`、`processPlugin`；每个传输占一个命名空间                |
| 命名空间 | 调用入口，`host.<命名空间>.request(...)`；一个 host 通常只装一种传输                                     |
| provider | 用 `provide` 选项或 `host.provide()` 注册给对端调用的方法；第二个参数是带 `signal` 的上下文              |
| Feature  | 一项可选能力，例如 `timeoutFeature`、`retryFeature`、`authFeature`；写在传输插件或流插件的 `features` 里 |
| 流插件   | `defineFlowPlugin({ name, features })`，给所有命名空间装默认能力；只能在构造时安装                       |

调用种类：

| 调用                                              | 完成的含义                               |
| ------------------------------------------------- | ---------------------------------------- |
| `request(method, payload?, options?)`             | 等到业务结果                             |
| `notify(method, payload?, options?)`              | 消息发出即完成，不等对端处理             |
| `stream(method, payload?, options?)`              | 返回异步迭代器，逐个读取对端交出的值     |
| `group(steps, options?)`                          | 对每个目标按顺序执行几步；不是跨目标事务 |
| `send(targetId, ...)` / `streamTo(targetId, ...)` | 指定一个目标调用                         |
| `dispatch(targetId, ...)`                         | 同步返回，失败交给 reporter              |

## 典型场景

| 场景                                      | 怎么组合                                               | 详细说明                                                 |
| ----------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| 把重计算放进 Worker                       | `threadPlugin`                                         | [rpc-plugin-thread](../rpc-plugin-thread/README.md)      |
| 在子进程里跑隔离任务，崩溃后重启          | `processPlugin`                                        | [rpc-plugin-process](../rpc-plugin-process/README.md)    |
| 浏览器窗口、iframe、SharedWorker 之间调用 | `rpc-plugin-browser` 的工厂                            | [rpc-plugin-browser](../rpc-plugin-browser/README.md)    |
| 把调用分给一组 Worker 或子进程            | 传输的 `features: { workers: pool({ size }) }`         | [rpc-plugin-pool](../rpc-plugin-pool/README.md)          |
| 所有调用的默认超时和重试                  | `defineFlowPlugin` + `timeoutFeature` / `retryFeature` | [安装完整策略](./USEGUIDE.md#安装完整策略)               |
| 签名认证、拒绝重复请求                    | `authFeature` + `idempotencyFeature`                   | [认证、签名与重复请求](./USEGUIDE.md#认证签名与重复请求) |
| 控制发给对端的错误细节                    | `errorMapFeature`                                      | [映射发往对端的错误](./USEGUIDE.md#映射发往对端的错误)   |
| 观察调用和生成类型                        | `probe` / `typegen`（`@migaia/rpc-host/plugins`）      | [观察与类型生成](./USEGUIDE.md#观察与类型生成)           |
| 查看多个 host 的时间线                    | `@migaia/rpc-plugin-devtools`                          | [rpc-plugin-devtools](../rpc-plugin-devtools/README.md)  |

## 安装

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-coroutines
```

`@migaia/rpc-contract` 是必须同版本安装的 peer 依赖，host 和各传输插件共用应用提供的这一份；自己再装一份重复副本不在支持范围内。传输插件按场景选择。

## 常用 API

| API                                                          | 用途                                                     |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| `createRpcHost({ plugins, provide?, forward?, onWarning? })` | 创建 host                                                |
| `host.<ns>.request` / `notify` / `stream` / `group`          | 调用对端                                                 |
| `host.provide(definition)`                                   | 注册本地方法，名字重复时拒绝                             |
| `host.use(...plugins)` / `host.unUse(name)`                  | 构造后安装或卸载传输                                     |
| `host.close()`                                               | 关闭整个 host，重复调用共享一个 Promise                  |
| `defineFlowPlugin({ name, features })`                       | 声明所有命名空间共用的默认能力（`@migaia/rpc-host/sdk`） |

内置 Feature 从 `@migaia/rpc-host/features` 导入，也可以从 `@migaia/rpc-host/features/<名称>` 单独导入；错误类和判断函数从 `@migaia/rpc-host/contract` 导入。完整入口见[入口一览](./USEGUIDE.md#入口一览)。

## 契约细节

### 初始化与后装

`createRpcHost` 在同一个原生 plugin-host 上先提交流插件及其 Feature，再安装传输插件及其 Feature，所以传输开始握手时，认证等能力已经就位；后续安装失败时，已取得的资源由同一个生命周期回滚并释放。

构造后可以 `const extended = await host.use(transport)` 后装传输，返回同一个 host，类型上多出新的命名空间。每次 `use` 独立提交或回滚；构造时那一批一起成功或失败。改变消息流的流插件只能在构造的 `plugins` 里配置，后装会以 `INVALID_CONFIG` 拒绝（消息为 `RPC flow hooks cannot be installed after transport startup`）；后装的传输自动使用它们，传输自己的 `features` 只作用于本命名空间。只读的观察插件可以后装。

已有 `defineHost` 或 class 宿主通过 `@migaia/rpc-host/sdk` 的 `rpcHostPipelines(getHost, pipeline)` 取得 `domainCore`，具体接法见[在已有宿主中安装 RPC](./USEGUIDE.md#在已有宿主中安装-rpc)。

### 目标选择与转发

不指定目标的调用只在所属命名空间内选择目标：没有目标返回空的 `fulfilled/rejected`，一个目标返回标量，多个目标返回按实例身份索引的 `fulfilled/rejected`。流集合里的每个迭代器独立取消。`host.<ns>.peers` 列出已接受的直连对端；从 `peers` 保存下来的函数绑定当时的连接，对端重连后不会自动改指新连接。

`host.<ns>.send('b', 'c.render', value)` 先到直连的 b，再由 b 按当前目录转发给 c。转发可以跨命名空间，但不能延长上游的截止时间。`forward: { maxHops }` 默认 3，只接受 1–16 的整数；每个 host 先检查环路，再检查跳数。

### 可选能力

`authFeature`、`chunkFeature`、`batchFeature`、`idempotencyFeature`、`limitsFeature`、`errorMapFeature`、`schemaFeature`、`timeoutFeature`、`retryFeature` 都从 `@migaia/rpc-host/features` 导入，放进 `defineFlowPlugin({ name, features })`（作用于所有命名空间）或传输的 `features`（只覆盖本命名空间的同种能力）。每个命名空间每种能力只启用一份。host 级的 `limitsFeature` 跨命名空间共用额度，传输级的各自独立。`probe`、`typegen` 和 Devtools 只装在 host 级。

```ts doc-test=check
import { timeoutFeature, retryFeature, limitsFeature } from '@migaia/rpc-host/features'
import { probe } from '@migaia/rpc-host/plugins'
import { defineFlowPlugin } from '@migaia/rpc-host/sdk'
import timeoutFromSubpath from '@migaia/rpc-host/features/timeout'

export const defaults = defineFlowPlugin({
  name: 'call-defaults',
  features: { timeout: timeoutFeature({ ms: 1500 }), retry: retryFeature({ attempts: 2 }) }
})
export const capacity = limitsFeature({ maxGlobal: 256, maxPerPeer: 64 })
export const observation = probe({
  stages: ['message', 'peer'],
  emit: (view) => console.log({ ...view })
})
export const deadlineFeature = timeoutFromSubpath({ ms: 100 })
export const perCallDeadline = { ms: 100 }
```

汇总入口和单项子路径都可以 tree-shake。不装 `limitsFeature` 就没有配额；装了 `idempotencyFeature` 才有 `host.<ns>.outcome(key)`。auth 默认把签名绑定对象交给 `sign/verify`，完成的请求 ID 默认立即释放，也可以按签名窗口或毫秒数 `retain`；配置和 HMAC 示例见[认证说明](./USEGUIDE.md#认证签名与重复请求)。

`errorMapFeature` 同步决定对端能看到哪些错误信息，不改变本地的原错误、报告和观察。回调抛错、返回 Promise 或结果无法序列化时，报告映射失败，并按未映射的规则发送。未配置映射时，未认证对端的握手失败默认隐藏细节。

出站执行顺序固定为：plaintext → schema → idempotency → limits → errorMap → auth → chunk → batch → wire；入站相反。`features` 里的键名和顺序不决定执行顺序。第三方 Feature 用 `defineFlowFeature` 定义，必须声明 0–65535 的整数 `phase`；`dependencies` 决定安装顺序，`phase` 决定执行顺序。auth 保护完整消息，再由 chunk 拆成物理帧；接收端先重组，再验证。

会话正在使用的流能力不能热卸载，移除相应注册以 `LIFECYCLE_MUTATION` 拒绝；先关闭受影响的命名空间。auth、chunk、batch 等改变线上格式的能力，只有两端都安装才能保证通信。

### 期限、取消与错误

timeout 和 retry 按以下顺序取值：单次调用的 `options.timeout` / `options.retry`，所在传输的 Feature，流插件里的默认值。单次调用接受 `{ ms }`、retry 配置对象或 `false`。`timeout: false` 不启用超时，但继承来的上游剩余期限仍然递减；`retry: false` 关闭重试。只有发起方的标量调用和 group 会重试，stream 从不重放；转发不重新计算预算。

进入 provider 前剩余期限已经用完的调用，以 `DEADLINE_EXCEEDED` 拒绝，provider 不会执行。所有调用种类都支持 `signal`，单向调用发出后也能把取消传到下游；provider 读取自己的 `context.signal`。取消不等于杀进程，也不回滚已经发生的业务副作用。

按 `source/code` 识别错误。未分类的 provider 异常为 `INTERNAL`，原错误保留在错误图里；标量调用直接以还原后的远端 Error 拒绝。超时或断开不能证明业务没有执行，非幂等操作重试前要先对账。返回 Promise 的调用通过拒绝传播非法 `idempotencyKey`（`CONTRACT_INVALID`）、transfer 被拒或命名空间已关闭；`dispatch` 同步返回、失败交给 reporter。provider 注册失败以 `INVALID_CONFIG` 拒绝，原错误在 `cause`。关闭后，等待中的调用以 `ENDPOINT_DISPOSED` 结算。

### 子节点名字与警告

被父端拉起的子节点优先使用父端指定的名字和 instanceId；父端未命名时保留子节点自己的 `self.name`。显式的子节点名字或 instanceId 被父端覆盖时，发出一次 `RpcWarningCode.selfIgnored`（`SELF_IGNORED`）警告，`data` 只含实际被忽略的项。警告先交给 `onWarning`，再交给 host 级订阅插件，没人接收时才 `console.warn`；警告不进 report。见[警告订阅](./USEGUIDE.md#警告与子节点名称)。

### 重复调用策略

timeout、retry 是单例角色，与名称无关。传输或流插件里重复声明同一角色，以 `plugin.host / FEATURE_ROLE_CONFLICT` 拒绝；流插件与传输自带能力冲突时，以 `rpc.endpoint / FEATURE_COMBINATION_CONFLICT` 拒绝。
