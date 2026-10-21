# @migaia/resource

[English](./README.en.md)

按用户 id、筛选条件加载数据时，难的不是发请求，而是请求之外的事：慢的旧请求晚返回，把新结果盖掉；离开页面后请求还在跑；刷新时内容先清空再出现。`@migaia/resource` 把这些交给一个 `Resource`：你只写怎样取数据，它负责只保留最新的结果、取消过时的请求、缓存、重试和服务端渲染快照。它建立在 `@migaia/reactive` 之上，本身不发请求，用 `fetch`、RPC 还是数据库客户端由你决定。

## 你可能遇到过

- **旧结果覆盖新结果**：搜索框里先输入 `re` 再补成 `react`，`re` 的请求更慢，最后页面显示的是 `re` 的结果。根因是每个请求返回后都直接写入，谁最后返回谁就赢。
- **离开页面后请求还在跑**：报表还没加载完用户就走了，请求照样跑完，结果写进已经不存在的界面。根因是没有人在离开时取消请求，或者取消代码散在每个页面里。
- **刷新时内容闪一下**：每次刷新价格表都先清空成“加载中”再出现。根因是数据和加载状态放在同一个变量里，刷新只能先把数据清掉。
- **重试没有分寸**：404 也在重试，重试完抛出一个新的包装错误，调用方再也认不出原来的 `HttpError`。根因是重试循环不区分错误类型，也不保留原始错误。
- **服务端取过的数据浏览器又取一遍**：服务端渲染已经请求过用户资料，页面到了浏览器又请求一次，首屏闪一下加载。根因是数据带到了浏览器，但它还能有效多久没有带过去。

## 为什么选它

- **旧请求的结果写不进来，即使底层接口不能取消。** 手写时谁最后返回谁赢；`Resource` 给每次请求一个世代编号，只有最新一代的结果会写入 `state`。[示例](./USEGUIDE.md#只显示最新输入的结果)
- **依赖自动登记，同一轮改几个条件只发一次请求。** 手写时每个条件的变化回调各发一次请求；请求函数在第一个 `await` 之前读到的响应式值都会成为依赖，同一轮里的多次修改默认在下一个微任务合并成一次请求。[示例](./USEGUIDE.md#同时改几个条件只发一次请求)
- **多处读取共享一个 Promise。** 手写去重要自己处理失败后清除、过期后重取；同一个 `Resource` 的 `promise` 在请求进行中和缓存有效时都返回同一个 Promise。[示例](./USEGUIDE.md#多处同时读取只请求一次)
- **取消有自己的状态，不会被当成失败。** `cancel()` 后状态是 `cancelled`，资源还能 `refetch()`；`dispose()` 会把中止信号传给底层请求，等待方收到原生 `AbortError`。[示例](./USEGUIDE.md#取消后显示已取消而不是错误)
- **服务端快照带的是剩余有效期，不是时间点。** 浏览器用本地时钟接着计时，两端时钟不一致也不影响，快照仍有效时不发请求。[示例](./USEGUIDE.md#服务端已取到的数据浏览器不再请求)

当异步结果依赖 `Signal` 或 `Computed`，又需要界面观察状态、共享请求或刷新缓存时，用 `Resource` 管理这套可观察、可复用的状态。只加载一次、没有这些需求的请求，直接 `await` 一个 Promise 更简单。

## 从这里开始

下面模拟搜索框：先搜 `re`，又改成 `react`，而 `re` 的接口更慢。用 Node 24 直接运行。

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { Resource, ResourceStatus } from '@migaia/resource'

const runtime = createRuntime()
const keyword = runtime.signal('re')

// 模拟搜索接口：关键词越短，返回越慢；它也不支持取消
function search(text: string): Promise<string> {
  const delay = text.length < 3 ? 50 : 10
  return new Promise((resolve) =>
    setTimeout(() => {
      console.log(`接口返回：“${text}”`)
      resolve(`“${text}”的 3 条结果`)
    }, delay)
  )
}

const results = new Resource(() => search(keyword.value), runtime)

const view = runtime.effect(() => {
  const state = results.state
  if (state.status === ResourceStatus.success) console.log(`页面显示：${state.data}`)
})

keyword.value = 'react' // 用户继续输入
await new Promise((resolve) => setTimeout(resolve, 100)) // 等两次请求都返回
view.dispose()
results.dispose()
keyword.dispose()
```

输出：

```text
接口返回：“react”
页面显示：“react”的 3 条结果
接口返回：“re”
```

`re` 比 `react` 晚返回，日志里能看到它返回了，但页面停在 `react` 的结果上。请求函数在返回 Promise 前同步读取了 `keyword.value`，关键词一变 `Resource` 就发起新请求，并作废旧的那一次；旧请求即使跑完，也写不进 `state`。

`view` 是一个 Effect（响应式副作用），执行时读取 `results.state`，所以请求状态变化会让它再次执行并更新页面。把 `state` 保存到普通变量只得到当时的状态快照；要持续更新界面，应在 Effect 或 UI 框架的状态订阅中读取它。结束时先释放 `view`，再释放 `results`，最后释放输入 `keyword`，避免清理过程再次触发渲染或请求。

下一步：更多用法看 [USEGUIDE 的“按场景查找”](./USEGUIDE.md#按场景查找)；要在离开页面时停掉网络请求，看 [离开页面时停掉还在进行的请求](./USEGUIDE.md#离开页面时停掉还在进行的请求)。

## 手写时的隐患

下面是常见的手写加载函数。它能跑，但有三个隐患（只用于说明，不必运行）：

```ts doc-test=check
let profile: unknown
let loading = false

async function loadProfile(id: string) {
  loading = true
  // 隐患 1：不区分新旧请求；切换用户后，慢的旧请求晚返回，会把新用户的数据覆盖掉
  const response = await fetch(`/api/users/${id}`)
  profile = await response.json()
  // 隐患 2：请求失败时这一行不会执行，loading 永远是 true；每个加载函数都要记得写 try/finally
  loading = false
}

// 隐患 3：离开页面时没有取消；请求跑完仍会写入 profile，页面却已经不在了
void loadProfile('1')
```

用 `Resource` 时，请求函数只负责取数据：新旧请求由世代编号区分，失败会落到 `error` 状态而不是卡在加载中，`dispose()` 会中止还在进行的请求。

## 三分钟心智模型

可以把一个 `Resource` 想成“一个会自己重新请求的异步变量”：请求函数是它的公式，请求函数读到的响应式值是公式的输入，`state` 是它当前的值。

| 概念 | 一句话 |
| --- | --- |
| 请求函数（fetcher） | `({ signal }) => 值或 Promise`；第一个 `await` 之前读到的响应式值成为依赖 |
| `state` | 五种状态之一：`idle`、`pending`、`success`（带 `data`）、`error`、`cancelled` |
| 世代（generation） | 每次请求一个编号；只有最新一代的结果能写入 `state` |
| 有效期（`ttl`） | 成功的数据多久后过期；默认 `Infinity`，只在依赖变化或手动刷新时重新请求 |
| `cancel()` / `dispose()` | 停掉这一次请求、资源还能用 / 停掉请求并释放整个资源 |
| 快照 | 调用方可传输或保存 `dehydrate()` 导出的数据和剩余有效期，再用 `initialSnapshot` 恢复 |

几个说法：

- **被动读取**：读 `state`、`promise` 或 `read()`。只有在还没请求过或数据已过期时才会发起请求，重复读取不会强制刷新。
- **主动刷新**：`refetch()` 总是发起新请求；`invalidate()` 先让缓存过期再请求。
- **休眠**：没人读取 `state` 时，`Resource` 会和输入断开但保留缓存，下次读取时先检查输入，没变且未过期就直接复用。

## 典型场景

| 场景 | 怎么组合 | 详细说明 |
| --- | --- | --- |
| 根据输入加载，只显示最新结果 | 请求函数读响应式值 + `effect` 读 `state` | [USEGUIDE](./USEGUIDE.md#只显示最新输入的结果) |
| 几个筛选条件一起变 | 请求函数同时读多个 signal | [USEGUIDE](./USEGUIDE.md#同时改几个条件只发一次请求) |
| 多个组件读同一份数据 | 共享同一个 `Resource` 的 `promise` 或 `state` | [USEGUIDE](./USEGUIDE.md#多处同时读取只请求一次) |
| 离开页面、取消操作 | `dispose()` / `cancel()` + 把 `signal` 交给底层请求 | [USEGUIDE](./USEGUIDE.md#离开页面时停掉还在进行的请求) |
| 刷新时不清空内容 | `staleWhileRevalidate: true` | [USEGUIDE](./USEGUIDE.md#刷新时继续显示旧数据) |
| 只重试临时故障 | `retry` 判断函数 + `retryDelay` | [USEGUIDE](./USEGUIDE.md#只重试临时故障) |
| 服务端渲染 | `dehydrate()` + `initialSnapshot` | [USEGUIDE](./USEGUIDE.md#服务端已取到的数据浏览器不再请求) |

## 安装

```bash
pnpm add @migaia/resource @migaia/reactive
```

包只有根入口 `@migaia/resource`：`Resource`、`ResourceStatus`、`ResourceFetchStatus`、`ResourceErrorCode`、`RESOURCE_SOURCE` 和全部公开类型都从这里导入，没有稳定的深层子路径。`runtime` 参数来自 `@migaia/reactive` 的 `createRuntime()`，两个包要用配套的版本。

## 常用 API

| API | 做什么 |
| --- | --- |
| `new Resource(fetcher, runtime, options?)` | 创建异步数据源；默认在构造时发起第一次请求 |
| `resource.state` / `resource.read()` | 读当前状态 / 按 Suspense 的方式读取（成功返回值、加载中抛 Promise、失败抛错误） |
| `resource.promise` | 当前请求或有效缓存对应的 Promise，多个读取方共享同一个 |
| `refetch()` / `invalidate()` | 强制发起新请求 / 先让缓存过期再请求 |
| `cancel()` / `dispose()` | 停掉当前请求、资源还能用 / 停掉请求并释放资源 |
| `dehydrate()` / `hydrate()` | 导出、恢复成功数据和剩余有效期 |

## 契约细节

全部签名、边界行为与错误码见 [USEGUIDE.md](./USEGUIDE.md)。下面是使用时最需要记住的约束。

### 生命周期、错误与边界

构造选项 `autoStart` 默认为 `true`：没有仍有效的 `initialSnapshot` 时，构造函数立即发起第一代请求。传 `autoStart: false` 时不在构造期请求，首次被动读取仍可启动；有效的初始快照会直接复用。

1. **依赖追踪只认第一个 `await` 之前的同步读取。** `await` 之后再读响应式值不会被追踪；需要时先把值读进局部变量，或者把读取挪进一个 `Computed`。依赖变化何时刷新由传入的 `runtime` 调度决定，默认在微任务中处理。
2. **请求函数要把 `signal` 交给真正可取消的 I/O**（例如 `fetch(url, { signal })`）。否则取消只是让 `Resource` 忽略这次结果，底层请求仍会跑完。
3. **`refetch()` 总是发起新请求；被动读取（`state`、`promise`、`read()`）只在 `idle` 或数据过期时才发起。** 每次刷新会创建新的一代，并中止仍在途的上一代的 `signal`；只有当前一代能把结果写入状态。想强制刷新就调用 `refetch()` 或 `invalidate()`。
4. **不再使用时要调用 `dispose()`**，否则依赖登记和进行中的请求会一直留着。释放后读取数据和发起请求都抛 `RESOURCE_DISPOSED`；`disposed`、`refreshing`、`observed` 仍可读，`markDirty()`、`onDependencyDisconnected()` 和再次 `dispose()` 是安全的空操作。`dispose()` 不会释放传入的 `runtime`。
5. **默认 `keepAlive: false`。** 没人读取 `state` 时，`Resource` 会和上游断开但保留依赖版本与缓存；下次读取时依赖没变且缓存有效就复用原值和 Promise，依赖变了就重新请求。需要“没人看也保持连接”时传 `keepAlive: true`。
6. **`cancel()` 之后被动读取不会自动重启。** 需要暂时停止当前请求、稍后继续使用同一个资源时调用 `cancel()`。正在加载的请求被取消后状态是 `cancelled`；后台刷新被取消时保留旧数据并清除 `refreshing`。只有显式 `refetch()` 会重新开始。

### 错误身份

`Resource` 自己产生的错误带 `source === RESOURCE_SOURCE`（`@migaia/resource`）和 `ResourceErrorCode` 里的 `code`。已经有完整 `source`/`code` 的外部错误保持原样；没有分类的加载失败在重试结束后附加 `FETCH_FAILED`，原生错误保持原类型，不可修改的错误保留在 `cause` 链上。重试策略本身出错时附加 `INVALID_OPTION`，触发它的加载错误仍可从错误链找到。取消和释放产生的错误是原生 `DOMException`（`name === 'AbortError'`），按 `error.name` 判断即可。

### Suspense

同一次请求在所有 Suspense 等待阶段复用同一个 pending Promise。请求函数抛出的 thenable 完成后，经注入的 scheduler 以 0ms 任务继续执行；Suspense 等待不计入重试次数，也没有次数上限。即使请求函数连续抛出立即完成的 thenable，取消任务仍能插进来执行，`cancel()`/`dispose()` 会停止后续调用。

### 适配层用到的能力

`peekState()` 读取状态联合，不登记依赖、不发起请求、不检查有效期；和 `peek()` 不同，它返回状态对象而不是取值或抛出。`reset()` 取消当前请求、清除依赖和缓存，让同一个实例回到可复用的 `idle`；之前共享的 Promise 立即以原生 `AbortError`（`REQUEST_ABORTED`）失败。请求函数收到的 `IResourceFetchContext` 带只读的 `signal`、单调递增的 `generation` 和不透明的 `token`：同一次请求的多次重试共享它们，替换或重置后的新请求拿到新的一组。加载值的所有权和渲染版本租约由适配层负责，不属于 `Resource` 的依赖图。完整示例见 USEGUIDE。

### 状态类型迁移

`ResourceStatus.fetching` 已改为 `ResourceFetchStatus.fetching`；旧的 `IResourceStatus` / `IResourceFetchStatus` 类型改用与常量同名的 `ResourceStatus` / `ResourceFetchStatus` 键联合。运行时的状态字符串和后台刷新的数据、传输语义没有变化。

### 不适合的场景

只在启动时加载一次、没有输入、不需要取消、重试或过期的数据（例如静态配置），直接 `await` 一个 Promise 更简单。
