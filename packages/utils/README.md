# `@migaia/utils`

[English](./README.en.md)

写库代码时，有一层工作反复出现，又最容易写错：超时、取消、重试、限制并发、只执行一次的初始化、给错误加上可识别的身份、不改原对象地更新深层字段、保护传进来的配置。`@migaia/utils` 把这些边界情况处理好，并给每种失败一个稳定的错误代码。它没有运行时依赖，也不依赖浏览器或 Node 的专有 API，浏览器、Node、Bun、Deno 和 Worker 里都能用；每组工具放在自己的子路径里，按需导入。

## 你可能遇到过

- **超时后请求还在后台跑**：用 `Promise.race` 加 `setTimeout` 做超时，调用方按时拿到了错误，请求、连接和计时器却都还活着。根因是超时只结束了“等待”，没有通知操作本身停下。
- **重试把下游打得更狠**：404 这类错误也重试，失败后立刻重试，没有总时限，用户半分钟后才看到失败。根因是重试循环不区分错误种类，也没有退避和整体截止时间。
- **一次发出几百个请求**：`Promise.all(ids.map(download))` 让下游开始限流；用户离开页面后，排队的请求还在跑。根因是没有并发上限，也没有办法取消还在排队的任务。
- **初始化被执行了好几次**：三个模块同时调用懒加载函数，建了三个数据库连接。根因是 `if (!db)` 判断时，第一次调用的 Promise 还没有保存下来。
- **错误包装几层后认不出原因**：只能比对 message 文本判断“是不是断线”，文案一改，判断就失效。根因是错误没有稳定的代码，或者包装时把原错误丢了。

## 为什么选它

- **超时会让操作真的停下，而不只是让调用方先返回。** 用 `Promise.race` 加 `setTimeout` 时，超时后请求还在后台跑；`withTimeout` 到点先取消交给操作的 `signal`，再以 `DEADLINE_EXCEEDED` 拒绝，`fetch` 收到后立即中断。[示例](./USEGUIDE.md#给慢请求加超时并让请求真的停下)
- **超时之后才到的失败不会消失。** 手写的 `Promise.race` 会悄悄吞掉它；这里它交给 `report` 回调，调用方拿到的结果不受影响，而操作用 `signal.reason` 拒绝只算确认取消，不会被误报。[示例](./USEGUIDE.md#超时之后才到的失败去了哪里)
- **重试按错误种类决定，并有总时限。** 常见的重试循环连 404 也重试、没有总时间上限；`retry` 用 `shouldRetry` 挑出值得重试的错误，用 `delay` 退避，用 `totalTimeoutMs` 限制包括等待在内的总时间，不该重试的错误原样立刻抛出。[示例](./USEGUIDE.md#只重试值得重试的错误)
- **并发初始化只执行一次。** `if (!db)` 式懒加载在多个调用同时到达时会建多个连接；`onceAsync` 在第一次调用时就保存 Promise，之后的调用都拿到同一个。[示例](./USEGUIDE.md#并发初始化只执行一次)
- **错误包装多层后仍能按代码识别，原错误类型不变。** 靠比较 message 文本判断原因，文案一改就失效；`attachErrorIdentity` 只在原错误上加 `source` 和 `code`，`walkErrorCauses` 沿 `cause` 找回它，`instanceof` 和堆栈都保留。[示例](./USEGUIDE.md#错误被包装后仍能认出底层原因)

## 从这里开始

下面给一个不稳定的接口加上“每次限时 + 失败重试”：第 1 次请求卡住，300 毫秒后被取消；第 2 次返回 503，也会重试；第 3 次成功。用 Node 24 直接运行。

```ts doc-test=run
import { createServer } from 'node:http'
import { isUtilsTimeoutError } from '@migaia/utils/error'
import { retry } from '@migaia/utils/promise'

// 一个不稳定的接口：第 1 次请求卡住 2 秒，第 2 次返回 503，第 3 次正常。
let requests = 0
const server = createServer((_request, response) => {
  requests += 1
  if (requests === 1) setTimeout(() => response.end('太慢了'), 2_000)
  else if (requests === 2) response.writeHead(503).end()
  else response.end('订单列表')
}).listen(0)
const { port } = server.address() as { port: number }

const body = await retry(
  async ({ attempt, signal }) => {
    console.log(`第 ${attempt} 次请求`)
    const response = await fetch(`http://localhost:${port}/orders`, { signal })
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status })
    return response.text()
  },
  {
    maxAttempts: 4,
    attemptTimeoutMs: 300, // 每次最多等 300 毫秒，到点取消这次 fetch
    shouldRetry: (error) => isUtilsTimeoutError(error) || (error as { status?: number }).status! >= 500,
    delay: 100 // 两次请求之间等 100 毫秒
  }
)
console.log('结果:', body)
server.closeAllConnections()
server.close()
```

输出：

```text
第 1 次请求
第 2 次请求
第 3 次请求
结果: 订单列表
```

`retry` 交给每次请求的 `signal` 会在 300 毫秒到点时被取消，`fetch` 收到后立即中断这次请求，不会在后台继续等。超时错误是 `UtilsTimeoutError`，用 `isUtilsTimeoutError` 判断；`status` 是示例自己加在错误上的字段。

下一步：只想给单个操作限时，看 `withTimeout`；要限制同时运行的任务数，看 `createConcurrencyLimiter`。更多可以直接运行的场景见 [USEGUIDE 的“按场景查找”](./USEGUIDE.md#按场景查找)。

## 手写时的隐患

下面是常见的手写超时。它能跑，但有三个隐患（只用于说明，不必运行）：

```ts doc-test=check
async function fetchWithTimeout(url: string, ms: number) {
  return Promise.race([
    // 隐患 1：没有传 signal，超时后请求仍在后台跑，连接和内存都不释放
    fetch(url),
    // 隐患 2：请求先完成时，这个计时器不会被清除；在 Node 里还会让进程等到它触发
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ])
  // 隐患 3：请求在超时之后才失败时，这个失败被 Promise.race 悄悄吞掉，没人知道
}
```

`withTimeout` 把 `signal` 交给操作，到点先取消、再拒绝；操作先完成时清除计时器；超时之后才到的失败交给 `report` 回调，不会悄悄消失。操作用收到的 `signal.reason` 拒绝（`fetch(url, { signal })` 就是这样）只是在确认取消，不会被当成新的失败。

## 三分钟心智模型

| 你要解决的问题 | 工具 | 子路径 |
| --- | --- | --- |
| 给操作限时，到点让它停下 | `withTimeout` | `@migaia/utils/promise` |
| 失败后按条件重试 | `retry` | `@migaia/utils/promise` |
| 只响应外部取消；可以取消的等待 | `raceWithAbort`、`sleep` | `@migaia/utils/promise` |
| 限制同时运行的任务数 | `createConcurrencyLimiter` | `@migaia/utils/promise` |
| 初始化只执行一次 | `once`、`onceAsync` | `@migaia/utils/function` |
| 给错误加稳定代码，沿原因链查找 | `attachErrorIdentity`、`walkErrorCauses` | `@migaia/utils/error` |
| 按路径读写嵌套对象，不改原对象 | `get`、`set` | `@migaia/utils/object` |
| 接收、保护、更新配置 | `ownConfig`、`readonlyConfig`、`patchConfig` | `@migaia/utils/config` |
| Base64 与 UTF-8 | `bytesToBase64`、`base64ToBytes`、`encodeUtf8` | `@migaia/utils/bytes` |
| 模板插值、数字和金额格式化 | `format`、`formatCurrency` | `@migaia/utils/string`、`/number` |

几个贯穿全包的说法：

- **协作式取消**：取消只是一个通知。操作读到 `signal.aborted`，或在 `signal` 上监听 `abort` 事件后，自己停下来；不检查 `signal` 的代码不会被强行打断。
- **迟到的失败**：结果已经确定（例如已经超时）之后，操作才失败。它交给 `report`，不会改变已经交给调用方的结果。
- **单调时钟**：`scheduler.now()` 来自 `performance.now()`，只用来计算间隔和截止时间，不是日期时间戳；需要时间戳时用 `systemWallClock.timestamp()`。
- **配置所有权**：`ownConfig` 返回的配置归库所有，调用方再改自己的对象也影响不到它。

## 典型场景

| 场景 | 怎么组合 | 详细说明 |
| --- | --- | --- |
| 给慢请求加超时，并让请求真的停下 | `withTimeout`，把 `signal` 传给 `fetch` | [USEGUIDE](./USEGUIDE.md#给慢请求加超时并让请求真的停下) |
| 不看 `signal` 的操作在超时后才失败 | `withTimeout` 的 `report` | [USEGUIDE](./USEGUIDE.md#超时之后才到的失败去了哪里) |
| 只重试 5xx，带退避和总时限 | `retry` 的 `shouldRetry`、`delay`、`totalTimeoutMs` | [USEGUIDE](./USEGUIDE.md#只重试值得重试的错误) |
| 批量下载限制并发，离开页面时取消排队任务 | `createConcurrencyLimiter` 加 `run(task, { signal })` | [USEGUIDE](./USEGUIDE.md#批量任务限制并发离开时取消排队任务) |
| 多个模块同时初始化，只建一个连接 | `onceAsync` | [USEGUIDE](./USEGUIDE.md#并发初始化只执行一次) |
| 不可变地修改深层字段 | `set`、`get` | [USEGUIDE](./USEGUIDE.md#不可变地修改深层字段) |
| 防止配置在传入之后被改掉 | `ownConfig`、`readonlyConfig`、`patchConfig` | [USEGUIDE](./USEGUIDE.md#防止配置在传入之后被改掉) |
| 错误包装后仍按代码识别 | `attachErrorIdentity`、`walkErrorCauses` | [USEGUIDE](./USEGUIDE.md#错误被包装后仍能认出底层原因) |

## 安装

```bash
pnpm add @migaia/utils
```

## 常用 API

| API | 子路径 | 做什么 |
| --- | --- | --- |
| `withTimeout` | `/promise` | 给一个操作加截止时间；到点先取消操作收到的 `signal`，再以 `DEADLINE_EXCEEDED` 拒绝。 |
| `retry` | `/promise` | 按 `shouldRetry` 串行重试，支持退避、单次限时和总时限。 |
| `createConcurrencyLimiter` | `/promise` | 限制同时运行的任务数，其余按提交顺序排队，排队中的任务可以取消。 |
| `onceAsync` | `/function` | 第一次调用时保存 Promise，之后的调用（包括同时发生的）都拿到它。 |
| `attachErrorIdentity` / `walkErrorCauses` | `/error` | 给原错误加上 `source` 和 `code`；沿 `cause` 和 `AggregateError.errors` 找回它。 |
| `ownConfig` / `patchConfig` | `/config` | 接收时复制配置；生成新配置并复用没改动的部分。 |

## 契约细节

全部 API 的签名、选项、默认值、边界行为和错误码都在 [USEGUIDE.md](./USEGUIDE.md)，按模块分节：

- [`/promise`](./USEGUIDE.md#promise-模块)：调度器、`sleep`、`withTimeout`、`raceWithAbort`、`retry`、`createConcurrencyLimiter`、迟到失败的上报规则
- [`/error`](./USEGUIDE.md#error-模块)：错误身份、原因链遍历和全部错误码的含义
- [`/bytes`](./USEGUIDE.md#bytes-模块)：Base64 与 UTF-8，`ArrayBuffer` 与 `Uint8Array` 的关系
- [`/object`](./USEGUIDE.md#object-模块)：快照、属性探测、对象路径读写
- [`/config`](./USEGUIDE.md#config-模块)：配置所有权、只读视图、补丁和合并策略
- [`/function`](./USEGUIDE.md#function-模块)：`once`、`onceAsync` 的适用范围
- [Collector](./USEGUIDE.md#collector)、[排查清单](./USEGUIDE.md#排查与构建门禁)、[公开入口索引](./USEGUIDE.md#公开入口索引)
