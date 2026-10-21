# @migaia/lifecycle

[English](./README.en.md)

异步代码最难写对的是“收尾”：谁先关、谁后关；关到一半出错怎么办；旧请求晚到了怎么办；还有请求没处理完，要不要等、等多久。`@migaia/lifecycle` 把这些收尾规则做成一组可以组合的小工具，让关闭、取消和替换在并发情况下依然正确。它不依赖 DOM 或 Node，浏览器、Node、Bun、Deno 和 Worker 里都能用。

## 你可能遇到过

- **发布新版本时，进行中的请求被砍断**：容器收到 SIGTERM 后立即退出，正在写数据库的请求返回 502，写了一半的数据丢失。根因是关闭流程没有“先停止接收、再等进行中的工作、最后关连接”这几步。
- **搜索框显示的是旧结果**：用户输入 “a” 又输入 “ab”，“a” 的慢响应比 “ab” 晚到，把新结果覆盖了。根因是没有判断“这个结果还是不是最新的那次请求”。
- **切换页面后消息重复、内存上涨**：离开页面时漏掉了一个订阅或计时器，回到页面后同一条消息被处理两次。根因是清理函数散落在各处，靠人记。
- **初始化到一半失败，留下半个对象**：连上数据库、打开缓存后，第三步失败了，前两个资源没人关。
- **清理代码自己抛错**：`finally` 里关闭数据库失败，后面的缓存再也没有关闭，最初的错误也被盖掉了。

## 从这里开始

下面是一个 Node HTTP 服务的优雅停机。请求处理到一半时开始关闭：服务先停止接收新请求，等进行中的请求完成（最多 5 秒），再关闭数据库连接池。用 Node 24 直接运行。

```ts doc-test=run
import { createServer } from 'node:http'
import { boundedWait } from '@migaia/lifecycle'
import { createPendingTracker } from '@migaia/lifecycle/quiescence'
import { createLifecycleScope } from '@migaia/lifecycle/scope'

const app = createLifecycleScope()
const inFlight = createPendingTracker()

// 先登记的后释放：数据库连接池最后关闭。
app.own('db-pool', { force: () => console.log('3. 关闭数据库连接池') })

const server = createServer((request, response) => {
  // 每个请求都登记为“进行中的工作”，处理需要 200 毫秒。
  void inFlight.track(
    new Promise<void>((resolve) =>
      setTimeout(() => {
        response.end('订单已保存')
        resolve()
      }, 200)
    )
  )
})
app.own(server, {
  force: async () => {
    server.close() // 不再接受新连接
    console.log('1. 停止接收新请求，等待进行中的请求')
    const finished = await boundedWait(inFlight.drain(), performance.now() + 5_000)
    console.log(finished ? '2. 进行中的请求都已完成' : '2. 等待超时，继续关闭')
    server.closeAllConnections() // 断开剩下的空闲长连接
  }
})
server.listen(0)

// 真实服务里写成：process.once('SIGTERM', () => void app.dispose())
const { port } = server.address() as { port: number }
const order = fetch(`http://localhost:${port}/orders`, { method: 'POST' }).then((r) => r.text())
await new Promise((resolve) => setTimeout(resolve, 50)) // 请求处理到一半时开始停机
await app.dispose()
console.log('客户端收到:', await order)
```

输出：

```text
1. 停止接收新请求，等待进行中的请求
2. 进行中的请求都已完成
3. 关闭数据库连接池
客户端收到: 订单已保存
```

`boundedWait` 的截止时间是 `performance.now()` 时间轴上的绝对时刻，不是 `Date.now()`。

下一步：

- 搜索、切换页面时只采用最新结果，看 [USEGUIDE：只采用最新一次请求的结果](./USEGUIDE.md#只采用最新一次请求的结果)。
- 初始化失败时自动回收，看 [USEGUIDE：初始化失败时回收已经创建的资源](./USEGUIDE.md#初始化失败时回收已经创建的资源)。
- 清理失败时会发生什么，看 [USEGUIDE：一项清理失败，其余照常释放](./USEGUIDE.md#一项清理失败其余照常释放)。

## 手写时的隐患

很多服务的停机代码是这样的：

```ts doc-test=skip reason="示意手写的停机代码，引用了未定义的服务对象"
process.on('SIGTERM', async () => {
  server.close()
  // 隐患 1：没有等进行中的请求，正在写数据库的请求被直接砍断。
  await db.end()
  // 隐患 2：db.end() 抛错时，下面的 cache.quit() 永远不会执行，最初的错误也丢了。
  await cache.quit()
  // 隐患 3：任何一步卡住，进程就一直不退出，直到被平台强制结束。
})
```

改用作用域后，释放顺序由登记顺序决定，一项失败不影响其余资源，等待有明确的截止时间。新加一个资源时只需要在创建它的地方 `own()` 一次，不用回到停机代码里补一行。

## 它有什么不一样

- **即使某项清理抛错，其余资源也会照常释放。** 失败的原始错误会被加上 `code` 后交给你（多个失败合并成 `AggregateError`），不会被后面的错误盖掉。也可以选择收集成数组（`collect`）或交给日志函数（`report`）。
- **即使 `dispose()` 被同时调用多次，也只执行一轮释放。** 所有调用拿到同一个 Promise，不会重复关闭同一个连接。
- **释放顺序默认与登记顺序相反。** 先登记的连接池最后关，后登记的、依赖它的服务先关，依赖关系天然正确；需要时也可以按优先级排序，或先尝试优雅关闭、超时再强制关闭。
- **旧请求即使晚到，也不会覆盖新结果。** 新请求开始时，旧请求会收到取消信号；旧请求已经拿到的资源可以交给释放函数回收。
- **等待一定有上限。** `boundedWait` 在截止时间返回，不会因为一个卡住的任务挂住整个关闭流程；它也不会擅自取消那个任务。
- **初始化失败时自动回收，成功后整体移交。** 半路失败的资源按相反顺序释放；全部成功后一次性交给长期作用域。
- **可以和原生 `using` 一起用。** 异步作用域支持 `await using`，同步作用域支持 `using`；相比手写 `try/finally`，多了并发安全的释放、错误策略和截止时间。

## 三分钟心智模型

先判断你要回答的是哪个问题，再选对应的工具。它们可以组合，但同一个状态只交给一个工具管理。

| 你要回答的问题 | 工具 |
| --- | --- |
| 谁负责释放这些资源？按什么顺序？ | 作用域：`createLifecycleScope`（异步）、`createSyncLifecycleScope`（同步） |
| 初始化到一半失败了，已经创建的怎么办？ | 临时作用域：`createProvisionalScope` |
| 这个异步结果还算不算数？ | 请求代次：`createGenerationController` |
| 还有工作没做完吗？最多等多久？ | `createPendingTracker`、`createQuiescenceTracker`、`boundedWait` |
| 多个修改谁先谁后？ | 变更队列：`createMutationQueue` |
| 一组资源怎样先优雅、再强制地关闭？ | 释放事务：`createDisposeTransaction` |
| 怎样通知操作取消？ | `createAbortController`、`abortableDelay` |

| 名词 | 含义 |
| --- | --- |
| scope（作用域） | 负责释放一组资源的对象。用 `own(resource, descriptor)` 登记资源，用 `dispose()` 一起释放。 |
| descriptor（释放说明） | 说明一个资源怎样释放：`force` 必填；可选 `graceful`（先尝试优雅关闭）、`gracefulTimeoutMs`、`order`。 |
| `close()` / `dispose()` | `close()` 立即停止接收新资源，不执行任何清理；`dispose()` 真正释放全部资源，返回 Promise。 |
| generation（代次） | 每次 `begin()` 开始的一次请求。新的一次开始后，旧的那次就“过期”了。 |
| token | 一次请求的凭证。用 `isCurrent(token)` 判断这次请求是否仍是最新的。 |
| `deadlineAt` | 截止时刻，使用调度器的时间轴（默认是 `performance.now()`），不是 `Date.now()`。 |
| 错误策略 | 清理失败时的处理方式：`throw`（默认，全部释放后抛出）、`collect`（作为数组返回）、`report`（交给回调）。 |

## 典型场景

| 场景 | 怎么组合 | 详细说明 |
| --- | --- | --- |
| 服务优雅停机 | `createLifecycleScope` + `createPendingTracker` + `boundedWait` | [服务优雅停机](./USEGUIDE.md#服务优雅停机) |
| 搜索联想、路由切换只显示最新结果 | `createGenerationController` | [只采用最新一次请求的结果](./USEGUIDE.md#只采用最新一次请求的结果) |
| 离开页面时一起清理连接、订阅和计时器 | `createLifecycleScope` | [离开页面时一起清理](./USEGUIDE.md#离开页面时一起清理) |
| 插件安装、模块初始化失败时回收 | `createProvisionalScope` | [初始化失败时回收已经创建的资源](./USEGUIDE.md#初始化失败时回收已经创建的资源) |
| 自动保存不乱序 | `createMutationQueue` | [按提交顺序保存](./USEGUIDE.md#按提交顺序保存) |
| 清理失败时保留原始错误 | 错误策略 | [一项清理失败，其余照常释放](./USEGUIDE.md#一项清理失败其余照常释放) |

## 安装

```bash
pnpm add @migaia/lifecycle
```

唯一依赖是 `@migaia/utils`。

## 常用 API

| API | 作用 |
| --- | --- |
| `createLifecycleScope()` | 登记一组资源，`dispose()` 时按相反顺序一起释放。 |
| `createGenerationController()` | 为每次请求发放凭证，只采用最新一次请求的结果。 |
| `createPendingTracker()` + `boundedWait()` | 登记进行中的工作，并在截止时间前等它们完成。 |
| `createProvisionalScope()` | 初始化成功才把资源交给长期作用域，失败就回收。 |
| `createMutationQueue()` | 让修改按提交顺序一个接一个执行。 |
| `createDisposeTransaction()` | 按顺序关闭一组资源：先优雅关闭，超时再强制关闭。 |

每个 API 的完整签名、选项、边界行为和错误码见 [USEGUIDE.md](./USEGUIDE.md)。
