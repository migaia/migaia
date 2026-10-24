# `@migaia/utils` 使用指南

[English](./USEGUIDE.en.md)

包的定位、亮点和心智模型见 [README](./README.md)。本指南先按场景给出可以直接运行的示例（Node 24），再逐个模块列出公开运行时 API 的签名、选项、边界行为与错误码；所有公开名称的用途与入口列在文末的[公开入口索引](#公开入口索引)，精确类型以发布的 `.d.ts` 为准。

## 按场景查找

| 你遇到的问题                                 | 看这一节                                                                    |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| 超时后请求还在后台跑                         | [给慢请求加超时，并让请求真的停下](#给慢请求加超时并让请求真的停下)         |
| 不看 `signal` 的操作在超时之后才失败         | [超时之后才到的失败去了哪里](#超时之后才到的失败去了哪里)                   |
| 404 也在重试，重试没有总时限                 | [只重试值得重试的错误](#只重试值得重试的错误)                               |
| 一次发出太多请求；离开页面后排队的请求还在跑 | [批量任务限制并发，离开时取消排队任务](#批量任务限制并发离开时取消排队任务) |
| 同时初始化，建了多个连接                     | [并发初始化只执行一次](#并发初始化只执行一次)                               |
| 手写展开更新改到了原对象                     | [不可变地修改深层字段](#不可变地修改深层字段)                               |
| 调用方事后改了传进来的配置                   | [防止配置在传入之后被改掉](#防止配置在传入之后被改掉)                       |
| 错误包装后只能比对 message 文本              | [错误被包装后，仍能认出底层原因](#错误被包装后仍能认出底层原因)             |

## 给慢请求加超时，并让请求真的停下

给慢请求加了超时，调用方按时拿到了错误，但请求本身还在后台跑，下游还在为一个没人要的结果干活。

只用 `setTimeout` 加 `Promise.race` 做超时，只是让调用方先返回；连接、计时器和内存都没有释放，因为没有人通知操作停下。

`withTimeout` 会把一个 `signal` 交给你的操作；到点时先取消这个 `signal`，再以 `DEADLINE_EXCEEDED` 拒绝。把 `signal` 原样传给 `fetch`，或在自己的代码里检查它，工作就会真正停下。

```ts doc-test=run
import { withTimeout } from '@migaia/utils/promise'
import { isUtilsTimeoutError } from '@migaia/utils/error'

// 模拟一个 2 秒才返回的查询；真实代码里通常是 fetch(url, { signal })。
function slowQuery(signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve('查询结果'), 2_000)
    signal.addEventListener('abort', () => {
      clearTimeout(timer) // 收到取消，立即停下
      console.log('查询已停止，原因:', signal.reason.code)
      reject(signal.reason)
    })
  })
}

try {
  await withTimeout(({ signal }) => slowQuery(signal), { timeoutMs: 100 })
} catch (error) {
  if (isUtilsTimeoutError(error)) console.log('超时:', error.code, error.timeoutMs)
}
```

输出：

```text
查询已停止，原因: DEADLINE_EXCEEDED
超时: DEADLINE_EXCEEDED 100
```

先输出 `查询已停止，原因: DEADLINE_EXCEEDED`，再输出 `超时: DEADLINE_EXCEEDED 100`。

操作先收到取消并清掉了自己的计时器，调用方随后收到超时错误；`signal.reason` 就是这个超时错误。操作用 `signal.reason` 拒绝只是在确认取消，不会再被当成超时之后的新失败上报。

## 超时之后才到的失败去了哪里

有些操作不看 `signal`，超时后仍会继续执行，过一会儿才失败。这个失败去了哪里？

手写的 `Promise.race` 要么让这个迟到的失败悄悄消失，要么让它变成“未处理的 Promise 拒绝”，两种情况都没人知道写入其实失败了。

`withTimeout` 已经以超时结束，不会再改变调用方拿到的结果；迟到的失败交给 `report` 回调。不传 `report` 时，它会作为未捕获异常交给宿主，Node 默认会因此退出进程。所以操作不看 `signal` 时，一定要传 `report`。

```ts doc-test=run
import { withTimeout } from '@migaia/utils/promise'

const saving = withTimeout(
  // 这个写入不看 signal，超时之后才失败
  () => new Promise((_, reject) => setTimeout(() => reject(new Error('写入失败')), 50)),
  {
    timeoutMs: 10,
    report: (error, context) =>
      console.log('超时后才到的失败:', (error as Error).message, context.phase)
  }
)
await saving.catch((error) => console.log('调用方收到:', error.code))
await new Promise((resolve) => setTimeout(resolve, 100))
```

输出：

```text
调用方收到: DEADLINE_EXCEEDED
超时后才到的失败: 写入失败 late-rejection
```

先输出 `调用方收到: DEADLINE_EXCEEDED`，大约 40 毫秒后输出 `超时后才到的失败: 写入失败 late-rejection`。

调用方只看到超时；写入失败没有丢，带着 `phase: 'late-rejection'` 进入了 `report`。

## 只重试值得重试的错误

下游偶尔返回 503，重试一次就好；但重试代码把本来就过载的服务打得更狠，用户还要等半分钟才看到失败。

手写的重试循环常有三个坑：404 这类重试也不会成功的错误照样重试；失败后立刻重试；没有总时限。

`retry` 用 `shouldRetry` 判断哪些错误值得重试，用 `delay` 控制两次尝试之间的等待（传函数可以按次数递增），用 `totalTimeoutMs` 限制包括等待在内的总时间。

```ts doc-test=run
import { retry } from '@migaia/utils/promise'

// 模拟一个不稳定的库存接口：前两次返回 503，第三次成功。
let calls = 0
async function readStock(signal: AbortSignal): Promise<number> {
  calls += 1
  if (signal.aborted) throw signal.reason
  if (calls < 3) throw Object.assign(new Error('服务暂时不可用'), { status: 503 })
  return 42
}

const stock = await retry(
  ({ attempt, signal }) => {
    console.log(`第 ${attempt} 次尝试`)
    return readStock(signal)
  },
  {
    maxAttempts: 5,
    // 只重试 5xx；参数错误（4xx）重试也没用，直接抛出。
    shouldRetry: (error) => (error as { status?: number }).status! >= 500,
    delay: (_error, { attempt }) => 100 * 2 ** (attempt - 1), // 100ms、200ms……
    totalTimeoutMs: 2_000 // 包括等待在内，整体最多 2 秒
  }
)
console.log('库存:', stock)
```

输出：

```text
第 1 次尝试
第 2 次尝试
第 3 次尝试
库存: 42
```

依次输出 `第 1 次尝试`、`第 2 次尝试`、`第 3 次尝试` 和 `库存: 42`。

两次 503 之后分别等待 100 毫秒和 200 毫秒，第三次成功。总时限到达时，正在进行的那次尝试的 `signal` 会被取消。

订单号不存在，接口返回 404；重试五次也不会成功，只会让用户多等。

常见的重试循环对所有错误一视同仁，耗尽次数后再抛一个新的包装错误，调用方读不到原来的 `status`。

`shouldRetry` 返回 `false` 时，`retry` 不再等待，直接把这个原始错误抛给调用方。错误不会被包装，message 也不变，调用方仍能读到自己的 `status` 字段。

```ts doc-test=run
import { retry } from '@migaia/utils/promise'

let calls = 0
try {
  await retry(
    () => {
      calls += 1
      throw Object.assign(new Error('订单号不存在'), { status: 404 })
    },
    {
      maxAttempts: 5,
      shouldRetry: (error) => (error as { status?: number }).status! >= 500
    }
  )
} catch (error) {
  console.log('调用次数:', calls, '错误:', (error as Error).message)
}
```

输出：

```text
调用次数: 1 错误: 订单号不存在
```

输出 `调用次数: 1 错误: 订单号不存在`。

404 没有被重试，`maxAttempts: 5` 只是上限；调用方拿到的仍是自己抛出的那个错误。

## 批量任务限制并发，离开时取消排队任务

一次下载几百个文件，下游开始限流甚至报错，连接也排起长队。

`Promise.all(ids.map(download))` 会同时发出全部请求，没有任何东西限制同一时刻在跑的数量。

`createConcurrencyLimiter` 让同时运行的任务不超过 `concurrency` 个，其余任务按提交顺序排队，前面的完成一个，后面的才开始一个。

```ts doc-test=run
import { createConcurrencyLimiter } from '@migaia/utils/promise'

const limiter = createConcurrencyLimiter({ concurrency: 2 })
const download = (id: number) =>
  limiter.run(async () => {
    console.log(
      `开始下载 ${id}，同时进行 ${limiter.activeCount} 个，排队 ${limiter.pendingCount} 个`
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    return `文件 ${id}`
  })

// 一次提交 5 个任务，但同时最多只有 2 个在跑
const files = await Promise.all([1, 2, 3, 4, 5].map(download))
console.log(files.join('、'))
```

输出：

```text
开始下载 1，同时进行 2 个，排队 3 个
开始下载 2，同时进行 2 个，排队 3 个
开始下载 3，同时进行 2 个，排队 2 个
开始下载 4，同时进行 2 个，排队 1 个
开始下载 5，同时进行 2 个，排队 0 个
文件 1、文件 2、文件 3、文件 4、文件 5
```

`activeCount` 一直是 2，`pendingCount` 从 3 降到 0；最后一行按提交顺序列出 `文件 1` 到 `文件 5`。

`Promise.all` 的结果顺序与提交顺序一致，和任务完成的先后无关。

用户关掉页面后，排队中的下载任务照样执行，是在为没人看的页面下载数据。

手写的队列通常只管“排队”，不管“撤销”：任务一旦进了队列，就只能等它跑完。

给 `run` 传一个 `signal`：任务还在排队时被取消，会直接以取消原因拒绝，不会再开始；已经开始的任务会在 `context.signal` 上收到取消，由任务自己决定是否停下。

```ts doc-test=run
import { createConcurrencyLimiter } from '@migaia/utils/promise'

const limiter = createConcurrencyLimiter({ concurrency: 1 })
const page = new AbortController() // 用户离开页面时取消

const thumbnails = [1, 2, 3].map((id) =>
  limiter
    .run(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return `缩略图 ${id} 完成`
      },
      { signal: page.signal }
    )
    .catch((reason) => `缩略图 ${id} 已取消：${reason}`)
)

page.abort('用户离开了页面') // 1 号已经在跑，2、3 号还在排队
for (const line of await Promise.all(thumbnails)) console.log(line)
```

输出：

```text
缩略图 1 完成
缩略图 2 已取消：用户离开了页面
缩略图 3 已取消：用户离开了页面
```

输出 `缩略图 1 完成`，2、3 号输出 `已取消：用户离开了页面`。

1 号在取消前已经开始，所以照常完成；2、3 号还在排队，被直接取消，从没开始执行。

## 并发初始化只执行一次

三个模块同时初始化，结果建了三个数据库连接。

用 `let db` 加 `if (!db)` 做懒加载，在异步代码里会出错：三个调用同时发生时，`db` 对它们来说都还是空的。

`onceAsync` 在第一次调用时就保存这个 Promise，之后的调用（包括同时发生的调用）拿到的都是同一个 Promise。

```ts doc-test=run
import { onceAsync } from '@migaia/utils/function'

let connects = 0
// 三个模块启动时都会调用 getDb()，但连接只应建立一次。
const getDb = onceAsync(async () => {
  connects += 1
  console.log('正在连接数据库……')
  await new Promise((resolve) => setTimeout(resolve, 50))
  return { query: (sql: string) => `执行 ${sql}` }
})

const [users, orders, reports] = await Promise.all([getDb(), getDb(), getDb()])
console.log('连接次数:', connects, '是同一个连接:', users === orders && orders === reports)
console.log(users.query('select 1'))
```

输出：

```text
正在连接数据库……
连接次数: 1 是同一个连接: true
执行 select 1
```

`正在连接数据库……` 只输出一次，随后输出 `连接次数: 1 是同一个连接: true`。

三个调用方拿到的是同一个对象：初始化只发生了一次。

配置服务第一次初始化失败了，之后的调用会怎样？

如果以为 `onceAsync` 失败后会自动再试，就会在服务恢复后仍然一直拿到旧的失败而感到奇怪。

`onceAsync` 记住的是第一次调用的 Promise，不管它成功还是失败；之后每次调用都拿到同一个失败，函数不会再执行。需要失败重试时，把 `retry` 写进传给 `onceAsync` 的函数里，让初始化本身重试；或者失败后换一个新的 `onceAsync`。

```ts doc-test=run
import { onceAsync } from '@migaia/utils/function'

let attempts = 0
const loadConfig = onceAsync(async () => {
  attempts += 1
  throw new Error('配置服务不可达')
})

for (let index = 0; index < 3; index += 1)
  await loadConfig().catch((error) => console.log(`第 ${index + 1} 次调用:`, error.message))
console.log('实际执行次数:', attempts)
```

输出：

```text
第 1 次调用: 配置服务不可达
第 2 次调用: 配置服务不可达
第 3 次调用: 配置服务不可达
实际执行次数: 1
```

三次调用都输出 `配置服务不可达`，最后一行是 `实际执行次数: 1`。

失败也只发生一次并被记住；要不要重试，由传进去的函数自己决定。

## 不可变地修改深层字段

修改用户地址里的城市，依赖引用比较的界面却没有刷新，原来的状态对象也被改掉了。

手写不可变更新要逐层展开：`{ ...state, user: { ...state.user, address: { ...state.user.address, city } } }`。层数一多就容易漏掉一层，结果改到了原对象。

`set` 按路径复制经过的每一层，其余分支原样复用，原对象保持不变。`get` 按路径读取，中间缺了一层时返回 `undefined`，不会抛错。

```ts doc-test=run
import { get, set } from '@migaia/utils/object'

type IState = {
  user: { name: string; address: { city: string }; phone?: { mobile: string } }
  cart: { items: string[] }
}

const state: IState = {
  user: { name: 'Ada', address: { city: '上海' } },
  cart: { items: ['键盘'] }
}

const next = set(state, 'user.address.city', '杭州')

console.log(get(next, 'user.address.city')) // 新值
console.log(state.user.address.city) // 原对象没有被改
console.log('cart 仍是同一个对象:', next.cart === state.cart) // 没改的分支直接复用
console.log('user 是新对象:', next.user !== state.user)
console.log(get(next, 'user.phone.mobile')) // 可选的 phone 不存在，返回 undefined，不抛错
```

输出：

```text
杭州
上海
cart 仍是同一个对象: true
user 是新对象: true
undefined
```

输出 `杭州` 和 `上海`：新对象改了，原对象没变。

`cart 仍是同一个对象: true` 和 `user 是新对象: true` 说明只有路径上的对象被复制；最后的 `undefined` 来自不存在的路径。

## 防止配置在传入之后被改掉

库的重试次数莫名其妙变了，查到最后发现是调用方在传入配置之后又改了自己的对象。

库直接保存调用方传来的配置对象时，调用方事后的修改会影响库的行为；插件拿到配置后随手改一个字段，也会影响其他所有人。

`ownConfig` 在接收时复制一份归库所有；`readonlyConfig` 生成只读视图交给插件；`patchConfig` 生成新配置而不改旧配置，`CONFIG_DELETE` 用来删除字段。

```ts doc-test=run
import { CONFIG_DELETE, ownConfig, patchConfig, readonlyConfig } from '@migaia/utils/config'

const userOptions = { endpoint: 'https://api.example.com', retry: { attempts: 3 }, debug: true }
const config = ownConfig(userOptions) // 复制一份，从此与调用方的对象无关
userOptions.retry.attempts = 100 // 调用方事后改了自己的对象
console.log('库内看到的重试次数:', config.retry.attempts)

const view = readonlyConfig(config) // 交给插件的只读视图
try {
  view.retry.attempts = 0
} catch (error) {
  console.log('只读视图拒绝修改:', (error as Error).name, (error as { code?: string }).code)
}

// 生成新配置：改 endpoint，删掉 debug；没改的 retry 直接复用
const next = patchConfig(config, { endpoint: 'https://staging.example.com', debug: CONFIG_DELETE })
console.log(
  next.endpoint,
  '| debug 还在吗:',
  'debug' in next,
  '| retry 复用:',
  next.retry === config.retry
)
```

输出：

```text
库内看到的重试次数: 3
只读视图拒绝修改: TypeError CONFIG_READONLY
https://staging.example.com | debug 还在吗: false | retry 复用: true
```

`库内看到的重试次数: 3`：调用方的修改没有影响到库。

往只读视图里写会抛出 `TypeError`，代码是 `CONFIG_READONLY`。新配置的 `endpoint` 已更新、`debug` 已删除，没改动的 `retry` 与旧配置共用同一个对象。

## 错误被包装后，仍能认出底层原因

底层的断线错误被一层层包装成“加载订单失败”，上层想知道是不是断线，只能比较 message 文本。

比较 message 很脆弱：文案一改，判断就失效；替换错误对象又会丢掉原来的类型和堆栈。

`attachErrorIdentity` 把稳定的 `source` 和 `code` 直接写到原错误上，不替换错误对象，`instanceof` 和堆栈都不变；`walkErrorCauses` 沿着 `cause` 和 `AggregateError.errors` 把它找出来。

```ts doc-test=run
import { attachErrorIdentity, walkErrorCauses } from '@migaia/utils/error'

// 底层驱动抛出的原生错误，带上稳定的 source 和 code
function readRow(): never {
  throw attachErrorIdentity(new Error('connection reset'), {
    source: 'order-db',
    code: 'CONNECTION_LOST'
  })
}

try {
  try {
    readRow()
  } catch (cause) {
    // 上层包装成业务错误，但把原始错误放在 cause 上
    throw new Error('加载订单失败', { cause })
  }
} catch (error) {
  const lost = walkErrorCauses(error).some(
    (item) => (item as { code?: string } | undefined)?.code === 'CONNECTION_LOST'
  )
  console.log((error as Error).message, '| 底层是断线吗:', lost)
  console.log('原始错误仍是 Error 实例:', walkErrorCauses(error)[1] instanceof Error)
}
```

输出：

```text
加载订单失败 | 底层是断线吗: true
原始错误仍是 Error 实例: true
```

输出 `加载订单失败 | 底层是断线吗: true`：外层 message 是业务文案，判断依据的是 code。

`原始错误仍是 Error 实例: true`：附加身份没有改变原错误的类型。

---

## 目录

- [根入口运行时识别](#runtime-detection)
- [`/promise` 模块](#promise-模块)
- [`/error` 模块](#error-模块)
- [`/bytes` 模块](#bytes-模块)
- [`/object` 模块（含对象路径）](#object-模块)
- [`/typing` 模块](#typing-模块)
- [`/config` 模块](#config-模块)
- [`/function` 模块](#function-模块)
- [Collector](#collector)
- [组合工作流示例](#组合工作流示例)
- [排查与构建门禁](#排查与构建门禁)

---

<a id="runtime-detection"></a>

## 根入口：运行时与全局作用域识别

从 `@migaia/utils` 导入这三个函数与对应常量/类型域。它们无参数，返回当前分类或 `undefined`：

```ts
declare function detectServerRuntime(): ServerRuntime | undefined
declare function detectElectronProcessType(): ElectronProcessType | undefined
declare function detectGlobalScope(): GlobalScopeKind | undefined
```

| 域                    | 值                                                              |
| --------------------- | --------------------------------------------------------------- |
| `ServerRuntime`       | `deno`、`bun`、`node`                                           |
| `ElectronProcessType` | `main`、`renderer`、`utility`                                   |
| `GlobalScopeKind`     | `window`、`dedicated-worker`、`shared-worker`、`service-worker` |

`detectServerRuntime()` 按 Deno、Bun、Node 的顺序判断。Deno 要求非空的 `Deno.version.deno`，即使同时存在 Node 兼容 process 全局也优先；Bun 接受其全局对象或非空 `process.versions.bun`，最后才使用非空 `process.versions.node`。

`detectElectronProcessType()` 先要求 `process.versions.electron`。Electron 历史上的 `process.type === 'browser'` 映射为 main，renderer 与 utility 保留同名值；普通 Node 进程或未知 Electron 类型返回 `undefined`。

`detectGlobalScope()` 先排除任何已识别的服务端运行时，再依次检查当前全局是否为 Window、DedicatedWorkerGlobalScope、SharedWorkerGlobalScope、ServiceWorkerGlobalScope 的实例。仅存在构造器不能识别作用域；未识别时返回 `undefined`。

每次调用都重新读取当前全局。导入模块不缓存宿主分类，不启动运行体、不建立连接，也不安排计时器；函数不加载原生宿主模块，公开类型不要求 Node/DOM 声明。识别结果不授予载体或权限，使用具体原生 API 的 adapter 继续负责能力准入。

```ts
import {
  detectServerRuntime,
  detectElectronProcessType,
  detectGlobalScope,
  ServerRuntime,
  ElectronProcessType,
  GlobalScopeKind
} from '@migaia/utils'

console.log(detectServerRuntime(), detectElectronProcessType(), detectGlobalScope())
console.log(ServerRuntime.node, ElectronProcessType.main, GlobalScopeKind.window)
```

第一行依赖实际宿主，不会因为 Node 暴露兼容构造器就报告浏览器作用域；第二行输出稳定域值 `node main window`。

<a id="promise-模块"></a>

## `/promise` 模块

处理截止时间、协作式中止、重试与并发限流。所有中止都是**协作式**的：被中止的操作只有在读取传入的 `signal` 并主动提前返回/抛错时才会真正停止；忽略 `signal` 的 I/O 不会被强制打断。

### 调度器（`@migaia/utils/scheduler`）

调度器契约与实现只由 `@migaia/utils/scheduler`（及根入口 `@migaia/utils`）导出；本模块的 `sleep`、`withTimeout`、`retry`、`createAbortTimeoutSignal` 以它为 `scheduler` 选项类型与默认值。

```ts
import { systemScheduler, systemWallClock } from '@migaia/utils/scheduler'
import { createManualScheduler } from '@migaia/utils/testing'
// /scheduler 导出 IScheduledTask、IScheduler、IWallClock；/testing 导出 IManualScheduler。

type IScheduledTask = { cancel(): void; unref?(): void }
type IScheduler = {
  now(): number
  schedule(callback: () => void, delayMs: number): IScheduledTask
  defer?(callback: () => void): void
}
type IManualScheduler = IScheduler & {
  advance(ms: number): void
  readonly pendingCount: number
}
type IWallClock = { timestamp(): number }
```

- `IScheduler`：唯一调度器契约。`now()` 是单调不递减的毫秒数（连续两次可相等），只用于差值与本地截止时间，不解释为 epoch；`schedule()` 的 `delayMs` 必须有限非负，回调至多执行一次，且不会在 `schedule()` 调用内同步执行。
- `IManualScheduler`：额外提供 `advance(ms)`（手动推进虚拟时间，触发到期回调）与 `pendingCount`（未触发且未取消的任务数），用于确定性单测。
- `IWallClock`：只产生诊断时间戳（epoch 毫秒安全整数），不得参与截止时间、过期或重放窗口比较。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
export const systemScheduler: IScheduler
export const systemWallClock: IWallClock
```

`systemScheduler` 以 `performance.now()` 为单调时钟、以宿主 `setTimeout`/`clearTimeout` 排程，每次调用都经 `globalThis` 读取宿主能力。宿主缺少 `performance.now`、返回非有限值，或缺少定时器函数时抛带 `ENV_UNSUPPORTED` 的原生错误；`performance.now` 自身抛出的错误原样传播。`delayMs` 非 number 抛 `TypeError`、非有限或为负抛 `RangeError`，二者都带 `INVALID_ARGUMENT`，且不创建定时器。超过 `2_147_483_647` 的延迟分段等待；`unref()` 以原生 timer 为接收者，并对后续分段持续生效；`cancel()` 幂等。

`systemWallClock.timestamp()` 返回 `Date.now()`。需要 epoch 时间戳时使用它；实现接受 `IScheduler` 的超时、重试或调度逻辑时，必须配对使用 `scheduler.now()` 和 `scheduler.schedule()`，不要把墙钟值与 `now()` 相减或比较。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function createManualScheduler(): IManualScheduler
```

> 本仓测试专用：用于本仓单元测试与适配器验证，不建议外部业务代码使用。外部项目应优先选择测试框架自带的 fake timers，生产代码使用 `systemScheduler` 或默认调度器。

创建一个 FIFO 虚拟时钟调度器：`schedule()` 按 `到期时间 → 注册顺序` 排队；调用 `advance(ms)` 会一次性执行所有到期回调（回调内部再 `schedule` 的新任务，只要到期时间 `<= 目标时刻` 也会在同一次 `advance` 内继续触发）。`advance` 单次循环超过 10000 次会抛 `RangeError`/`SCHEDULER_RUNAWAY`（防止回调间互相递归调度导致死循环）。`delayMs`/`ms` 必须是有限的非负数（非 number 抛 `TypeError`，否则抛 `RangeError`），到期时刻或目标时刻溢出为非有限值时同样抛 `RangeError`，均带 `INVALID_ARGUMENT` 且不改变时钟与队列；回调内再次调用 `advance()` 抛 `TypeError`/`REENTRANT_CALL`，外层 `advance` 照常完成。

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
const scheduler = createManualScheduler()
const task = scheduler.schedule(() => console.log('fired'), 100)
scheduler.advance(50) // 未触发
scheduler.advance(50) // 触发，打印 'fired'
```

### 异步任务、时间切片与调用频率（`@migaia/utils/scheduler`）

`asyncTask(strategy, callback, delay | options)` 用一个入口覆盖各运行时的微任务/宏任务队列。`strategy` 取 `AsyncTaskStrategy` 的键：

| 键                                                                    | 宿主 API                                                                               | 适用                                                     |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `promise` / `microtask`                                               | `Promise.then` / `queueMicrotask`                                                      | 当前同步代码之后、任何 I/O 之前                          |
| `nextTick`                                                            | `process.nextTick`                                                                     | Node/Bun，宏任务中调度时先于 promise 微任务              |
| `timeout`                                                             | `setTimeout`                                                                           | 处处可用，原生支持 `delay`                               |
| `immediate`                                                           | `setImmediate`                                                                         | Node/Bun 的 check 阶段                                   |
| `messageChannel`                                                      | `MessageChannel`                                                                       | 没有 4ms 钳制的快速宏任务                                |
| `animationFrame`                                                      | `requestAnimationFrame`                                                                | 下一次绘制前，回调拿到 `frameTime`                       |
| `idleCallback`                                                        | `requestIdleCallback`                                                                  | 空闲期，回调拿到 `timeRemaining()`；`idleTimeout` 设兜底 |
| `postTaskUserBlocking` / `postTaskUserVisible` / `postTaskBackground` | `scheduler.postTask`                                                                   | 按优先级排队，原生支持 `delay`                           |
| `schedulerYield`                                                      | `scheduler.yield()`                                                                    | 拆分长任务后优先续跑                                     |
| `auto`                                                                | 依次尝试 `schedulerYield → postTaskUserVisible → messageChannel → immediate → timeout` | 默认让出                                                 |

宿主不支持所选策略时同步抛出 `ENV_UNSUPPORTED`，不会静默降级；传数组即声明自己的回退顺序。没有原生延迟的策略会先用定时器等待 `delay` 再进入对应队列。`signal` 在回调开始前中止会撤销宿主注册并以 `ABORTED` 拒绝。

```ts
import { asyncTask, isAsyncTaskSupported, yieldToHost } from '@migaia/utils/scheduler'

await asyncTask(['postTaskBackground', 'idleCallback', 'timeout'], flushLogs, 100)
await asyncTask('idleCallback', ({ timeRemaining }) => prefetch(timeRemaining()), {
  idleTimeout: 2000
})
for (const row of rows) {
  process(row)
  if (++count % 500 === 0) await yieldToHost()
}
```

`timeSlice(source, handler, { budget, strategy, signal, onProgress, clock })` 处理大数据时按时间片切分：每片最多工作 `budget` 毫秒（默认 8），然后让出宿主；每片至少处理一项，保证前进。支持同步/异步可迭代对象和生成器。处理函数抛错时会调用迭代器 `return()` 并以原始错误拒绝，`return()` 自身的失败挂在 `errors` 上。`timeSliceMap` / `timeSliceReduce` 是对应的 map/reduce 形式。

```ts
const parsed = await timeSliceMap(lines, parseLine, {
  budget: 5,
  onProgress: ({ processed }) => bar(processed)
})
```

调用频率控制，都接受可注入的 `scheduler`（测试用 `createManualScheduler()`）：

- `debounce(fn, wait, { leading, trailing, maxWait, signal })`：一串调用结束后执行一次；返回的函数带 `cancel()` / `flush()` / `pending()`，支持 `using`。
- `throttle(fn, wait | 'animationFrame', options)`：每个窗口最多执行一次；传 `'animationFrame'` 时每帧最多一次并使用最新参数。
- `coalesce(fn, strategy = 'microtask')`：把同一轮里的所有调用合并成一次 `fn(calls)`。
- `repeat(task, interval, { immediate, maxIterations, onError, signal })`：不重叠的轮询；上一轮结束后才排下一轮，按起点校正漂移，落后时重新对齐而不是补发。`onError: 'stop'`（默认）以原始错误拒绝 `done`，`'continue'` 报告给宿主后继续。

定时器触发的调用没有调用方可以接住异常，这些异常会进入宿主的未捕获错误队列，不会被吞掉。

### `deferred`

```ts doc-test=skip reason="签名摘要，不是可运行模块"
type IDeferred<T> = {
  readonly promise: Promise<T>
  readonly resolve: (value: T | PromiseLike<T>) => void
  readonly reject: (reason?: unknown) => void
}
function deferred<T>(): IDeferred<T>
```

创建一个可从外部结算的原生 Promise。适合把回调式 API 转成 Promise，或在测试中手动控制某个异步操作何时完成/失败。

新代码应先选择平台原生的 `Promise.withResolvers()`。`deferred()` 主要服务于尚未支持该 API 的旧运行时，或必须统一依赖 `IDeferred<T>` 的项目边界：

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
const { promise, resolve, reject } = Promise.withResolvers<number>()
resolve(42)
```

兼容旧运行时：

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
const { promise, resolve } = deferred<number>()
setTimeout(() => resolve(42), 0)
await promise // 42
```

### `toPromise`

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function toPromise<T>(run: () => T): Promise<Awaited<T>>
```

同步且恰好调用 `run` 一次，并用原生 Promise 规则同化返回值。若 `run` 同步抛出，调用点不会同步抛错，而是返回以 exact reason reject 的 Promise。它只负责同步计算到 Promise 的规范化，不创建 timer、scheduler、retry 或 cancellation 状态。

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
const found = await toPromise(() => cache.get('key'))
const pending = toPromise(() => {
  throw new Error('read failed')
})
await pending // 异步观察 rejection
```

与 `Promise.resolve().then(() => run())` 对比：

- `toPromise(run)` 立即调用 `run`；返回前已经发生读取、写入或其他同步副作用。`run` 返回原生 Promise 时，返回值保持同一个 Promise identity。
- `Promise.resolve().then(run)` 把调用推迟到下一次 microtask，并返回新的链式 Promise。它适合主动让出当前调用栈、避免同步重入，不适合依赖“调用后立即生效”的逻辑。
- 两者都会把异常变成 rejection，但产生 rejection 的时点不同：前者在当前调用过程中捕获同步异常，后者等 microtask 真正执行 `run` 时才捕获。

因此，需要同步启动工作并统一返回 Promise 时使用 `toPromise`；需要延迟启动工作时使用 `Promise.resolve().then(run)`。

### `sleep`

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function sleep(delayMs: number, options?: IAsyncControls): Promise<void>
```

在调度器延迟后 resolve；若传入的 `signal`/`signals` 在等待期间中止，则以 `UtilsAbortError` reject。`delayMs` 必须是有限非负数。会正确清理已注册的定时器与 abort 监听器，即使清理过程本身抛错也会通过 `hostRethrowReporter`（sleep 不接受自定义 reporter）上报，而不是吞掉。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
type IAsyncControls = {
  readonly signal?: IAbortSignal
  readonly signals?: readonly IAbortSignal[]
  readonly scheduler?: IScheduler
  readonly unref?: boolean
}
```

`signal` 与 `signals` **互斥**——同时提供两者会 reject 一个 `TypeError`。`unref: true` 会尝试调用底层定时器句柄的 `unref()`（Node 环境下避免阻塞进程退出）。

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
const controller = new AbortController()
const p = sleep(1000, { signal: controller.signal as any })
controller.abort('cancelled')
await p // 抛 UtilsAbortError，cause 为 'cancelled'
```

### `createAbortTimeoutSignal`

```ts doc-test=skip reason="签名摘要，不是可运行模块"
type IAbortTimeoutSignalOptions = {
  readonly signal?: IAbortSignal
  readonly timeoutMs?: number
  readonly scheduler?: IScheduler
  readonly timeoutReason?: () => unknown
  readonly report?: IUtilsReporter
}
type IAbortTimeoutSignal = {
  readonly signal: IAbortSignal | undefined
  readonly dispose: () => void
}
function createAbortTimeoutSignal(options?: IAbortTimeoutSignalOptions): IAbortTimeoutSignal
```

创建一个可交给多个底层请求共享的 operation signal，但不创建、race 或结算业务 Promise。外部 signal 先中止时保留原始 reason；deadline 先到时使用 `timeoutReason()` 的返回值。reason factory 抛出的原始错误会成为 signal reason，不会从 timer callback 逃逸。无 `timeoutMs` 时透传外部 signal identity；`dispose()` 幂等并负责取消 timer、移除 listener，cleanup 失败通过 `report` 的 `operation: 'abort-timeout-signal'` 上报。

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
const merged = createAbortTimeoutSignal({
  signal: controller.signal as any,
  timeoutMs: 500,
  timeoutReason: () => new Error('deadline')
})
try {
  await Promise.all([requestA(merged.signal), requestB(merged.signal)])
} finally {
  merged.dispose()
}
```

`withTimeout` / `raceWithAbort` 的 callback 也能把同一 cooperative signal 交给多个请求，但它们同时拥有最终 Promise 的超时/中止 reject、late rejection 与 cleanup-error 政策。若事务 commit 才是唯一结算事实，应使用本 signal-only primitive，并由适配器自己决定 Promise 何时完成。

### `withTimeout`

```ts doc-test=skip reason="签名摘要，不是可运行模块"
type ITimeoutOperation<T> = (context: { readonly signal: INativeAbortSignal }) => T | PromiseLike<T>
type IDeadlineOnlyOperation<T> = (context: { readonly signal: IAbortSignal }) => T | PromiseLike<T>

type IWithTimeoutOptions = IAsyncControls & {
  readonly timeoutMs: number
  readonly report?: IUtilsReporter
  readonly zeroTimeoutBehavior?: 'skip' | 'start'
  readonly cooperativeCancellation?: boolean
}

function withTimeout<T>(
  operation: ITimeoutOperation<T>,
  options: IWithTimeoutOptions & { readonly cooperativeCancellation?: true }
): Promise<T>
function withTimeout<T>(
  operation: IDeadlineOnlyOperation<T>,
  options: IWithTimeoutOptions
): Promise<T>
```

`INativeAbortSignal` 是本包内部用原生 `AbortController` 生成、再交给操作的 signal 类型。它按消费方自己的全局类型解析：项目带 `lib.dom`、`@types/node`、Deno 或 Bun 类型时，它就是宿主 `AbortSignal`，可以直接写 `fetch(url, { signal })`；没有宿主类型时退回结构化的 `IAbortSignal`，所以发布的声明不依赖任何宿主库。所有入参仍接受结构化的 `IAbortSignal`。

用截止时间包裹一个惰性操作。`operation` 收到的 `signal` 是**内部生成的合并信号**：外部 `signal(s)` 中止、或截止时间到达，都会让这个 `signal` 变为 `aborted`；操作函数必须自行检查它才能提前退出。

- `timeoutMs`：必须是有限非负数；`timeoutMs === 0` 时默认立即以 `UtilsTimeoutError('operation', 0)` reject（除非 `zeroTimeoutBehavior: 'start'`，此时立刻启动操作，并保留零延时 deadline；操作若未在 deadline 回调前结算，仍会超时）。
- `cooperativeCancellation`（默认 `true`）：为 `false` 时不分配内部 `AbortController`，操作函数只会拿到一个惰性的、恒不中止的结构化信号（类型是 `IAbortSignal`，不能传给 `fetch`）——用于纯粹的"限时等待结果，但不需要通知操作提前退出"的场景。
- `report`：操作结算后，迟到成功值直接丢弃；只有迟到 rejection 交给 `report`（默认 `hostRethrowReporter`）。操作用它收到的 `signal.reason` 本身拒绝时（例如 `fetch(url, { signal })` 被取消后），只是在确认取消，不交给 `report`。清理失败通过返回 Promise 的 rejection/aggregate 暴露，不交给这个 reporter。
- 清理阶段（取消定时器、移除监听器）失败时，会把清理错误与原始错误一起包装成 `AggregateError` 一并 reject。

```ts
import { sleep, withTimeout } from '@migaia/utils/promise'

await withTimeout(
  async ({ signal }) => {
    while (!signal.aborted) {
      // 完成一小批同步工作后，必须让出事件循环，让 deadline 能执行。
      await sleep(10)
    }
    throw signal.reason
  },
  { timeoutMs: 500 }
) // 500ms 后以 UtilsTimeoutError('operation', 500) reject
```

### `raceWithAbort`

```ts doc-test=skip reason="签名摘要，不是可运行模块"
type IAbortOperation<T> = ITimeoutOperation<T>

function raceWithAbort<T>(
  operation: IAbortOperation<T>,
  options?: Pick<IAsyncControls, 'signal' | 'signals'> & {
    readonly report?: IUtilsReporter
    readonly cleanupPolicy?: 'reject' | 'report'
  }
): Promise<T>
```

与 `withTimeout` 语义相同，但**不设置截止时间定时器**，只在外部 `signal(s)` 中止时让操作提前失败。`cleanupPolicy: 'report'`（默认 `'reject'`）让监听器清理失败时改为上报诊断而不是让最终 Promise reject。

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
const controller = new AbortController()
const result = raceWithAbort(({ signal }) => fetchSomething({ signal }), {
  signal: controller.signal as any
})
```

### `retry`

```ts doc-test=skip reason="签名摘要，不是可运行模块"
type IRetryContext = {
  readonly attempt: number
  readonly signal: INativeAbortSignal
  readonly remainingMs?: number
}
type IRetryFailureContext = IRetryContext & { readonly maxAttempts: number }

function retry<T>(
  operation: (context: IRetryContext) => T | PromiseLike<T>,
  options: {
    readonly maxAttempts: number
    readonly shouldRetry: (
      error: unknown,
      context: IRetryFailureContext
    ) => boolean | PromiseLike<boolean>
    readonly delay?: number | ((error: unknown, context: IRetryFailureContext) => number)
    readonly totalTimeoutMs?: number
    readonly attemptTimeoutMs?: number
    readonly signal?: IAbortSignal
    readonly signals?: readonly IAbortSignal[]
    readonly zeroTimeoutBehavior?: 'skip' | 'start'
    readonly report?: IUtilsReporter
    readonly unref?: boolean
    readonly scheduler?: IScheduler
  }
): Promise<T>
```

串行重试，带三层限制：

- `maxAttempts`：必须是正安全整数，第 `maxAttempts` 次仍失败则直接抛出最后一次的错误。
- `attemptTimeoutMs`：每次尝试单独的超时（内部用 `withTimeout` 包裹）。
- `totalTimeoutMs`：整个重试过程（包含所有尝试与退避等待）的总截止时间；超出会抛 `UtilsTimeoutError('total', totalTimeoutMs)`。
- `shouldRetry(error, context)`：决定某次失败是否值得重试；返回 `false` 或 `maxAttempts` 已用尽都会终止重试并抛出该错误。
- `delay`：固定毫秒数或 `(error, context) => 毫秒数` 的退避函数，作用于两次尝试之间的等待（通过内部 `sleep`，同样遵守 `signal`/`signals`）。
- 外部信号在重试过程中的任意时刻中止，都会以 `UtilsAbortError` 结束整个重试，不再进入下一次尝试。

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
await retry(
  async ({ attempt }) => {
    if (attempt < 3) throw new Error('boom')
    return 'ok'
  },
  { maxAttempts: 5, shouldRetry: () => true, delay: (_, { attempt }) => attempt * 100 }
) // 'ok'，共尝试 3 次，两次退避分别约 100ms/200ms
```

### `hostRethrowReporter` 与 `IUtilsReporter`

```ts doc-test=skip reason="签名摘要，不是可运行模块"
type IUtilsReporter = (
  error: unknown,
  context: {
    readonly operation:
      'abort-timeout-signal' | 'withTimeout' | 'raceWithAbort' | 'retry' | 'sleep' | 'limiter'
    readonly phase: 'late-rejection' | 'cleanup' | 'reporter'
    readonly attempt?: number
  }
) => void
const hostRethrowReporter: IUtilsReporter
```

`hostRethrowReporter` 是默认诊断上报器：把错误通过 `queueMicrotask` 重新抛出（在不支持 `queueMicrotask` 的环境下同步抛出），使其成为未捕获异常，交由宿主（进程/浏览器）的全局错误处理机制记录，而不是被静默吞掉。自定义 `report` 选项可以替换为日志上报、埋点等。在 Node 中，未捕获异常默认会让进程退出；所以操作不看 `signal`、可能在超时之后才失败时，请传入自己的 `report`。操作用收到的 `signal.reason` 拒绝属于确认取消，`withTimeout`、`raceWithAbort` 和 `retry` 都不会上报它。

### `createConcurrencyLimiter`

```ts doc-test=skip reason="签名摘要，不是可运行模块"
type IConcurrencyLimiter = {
  run<T>(
    task: (context: { readonly signal?: IAbortSignal }) => T | PromiseLike<T>,
    options?: { readonly signal?: IAbortSignal }
  ): Promise<T>
  readonly activeCount: number
  readonly pendingCount: number
  whenIdle(): Promise<void>
  close(reason?: unknown): void
  dispose(reason?: unknown): Promise<void>
}
function createConcurrencyLimiter(options: {
  readonly concurrency: number
  readonly report?: IUtilsReporter
}): IConcurrencyLimiter
```

本包中**唯一具有跨调用生命周期**的原语——一个带并发上限的 FIFO 任务队列：

- `run(task, { signal })`：把任务加入队列，达到 `concurrency` 上限前的任务立即执行，之后排队等待空位；传入的 `signal` 中止会让**排队中**的任务立即以其中止原因 reject（已开始执行的任务不受影响，需任务自身读取 `context.signal`）。
- `activeCount` / `pendingCount`：当前正在执行 / 排队等待（未取消）的任务数。
- `whenIdle()`：返回一个在"当前没有活跃任务且队列已清空"时 resolve 的 Promise；多次调用共享同一个等待，不会重复注册。
- `close(reason?)`：停止接纳新任务与排队任务——已排队但未执行的任务立即以 `reason`（默认一个 `LIMITER_CLOSED` 错误）reject；正在执行的任务不受影响。
- `dispose(reason?)`：调用 `close()` 并返回一个在所有活跃任务结束后才 resolve 的 Promise，用于优雅关闭。

`concurrency` 必须是正安全整数，否则构造时抛 `RangeError`。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
const limiter = createConcurrencyLimiter({ concurrency: 2 })
const results = await Promise.all([1, 2, 3, 4].map((n) => limiter.run(() => fetchPage(n))))
await limiter.dispose() // 等待剩余任务完成后关闭
```

---

<a id="error-模块"></a>

## `/error` 模块

统一的错误身份、包装与因果链遍历工具。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
type IPropertyRead<T> =
  { readonly threw: false; readonly value: T } | { readonly threw: true; readonly error: unknown }
function tryReadProperty<T extends object, K extends keyof T>(
  target: T,
  key: K
): IPropertyRead<T[K]>
```

对一个属性执行恰好一次读取，保留 getter 的接收者；读取抛出时将原始值放在 `error`，不包装、不上报。调用方负责目标对象检查与失败策略。新代码中独立的单属性受保护读取应复用此原语。

外部 abort signal 的 reason 也通过同一入口读取：

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
const read = tryReadProperty(signal, 'reason')
if (read.threw) report(read.error)
else handleAbort(read.value)
```

失败后是重抛、包装、上报还是把原错误当作 reason，取决于调用方原有契约；此原语只返回读取结果。

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
abstract class UtilsError extends Error {
  readonly source = 'foundation.utils'
  readonly code: IUtilsErrorCode
}
class UtilsAbortError extends UtilsError {
  readonly name = 'AbortError'
  constructor(reason?: unknown)
}
class UtilsTimeoutError extends UtilsError {
  readonly name = 'TimeoutError'
  readonly scope: 'operation' | 'attempt' | 'total'
  readonly timeoutMs: number
  constructor(scope: 'operation' | 'attempt' | 'total', timeoutMs: number)
}
```

`UtilsError` 是抽象基类，所有本包抛出的语义化错误都携带 `source: 'foundation.utils'` 与稳定的 `code`。`UtilsAbortError` 通过 `cause` 保留原始中止原因；`UtilsTimeoutError` 额外携带 `scope`（超时发生在单次操作 / 单次尝试 / 总截止时间的哪一层）与 `timeoutMs`。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function attachErrorIdentity<T extends object>(
  error: T,
  identity: {
    readonly source: string
    readonly code: string
    readonly phase?: string
    readonly detail?: Readonly<Record<string, unknown>>
  },
  hooks?: {
    // 字段冲突时由调用方选择替代对象；不提供时冲突抛 TypeError
    readonly onConflict?: (context: {
      target: T
      key: string
      existing: unknown
      incoming: unknown
    }) => T
    // 定义字段失败（如对象被冻结）时由调用方选择替代对象；不提供时原样抛出
    readonly onFailure?: (context: {
      target: T
      key: string
      incoming: unknown
      cause: unknown
    }) => T
  }
): T
```

就地给一个已存在的错误对象追加不可写的身份字段（`source`/`code`/`phase`/`detail`），**不会**替换或包装该错误。如果同一字段已存在且值不同，会抛出 `TypeError`（避免悄悄覆盖其他代码写入的身份信息）；值相同则视为幂等，直接返回。

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
const error = new Error('boom')
attachErrorIdentity(error, { source: 'my-package', code: 'FETCH_FAILED' })
;(error as Error & { readonly code?: string }).code // 'FETCH_FAILED'（返回类型仍是 T，不扩展 code 字段）
```

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function toError(value: unknown, options?: { readonly message?: string }): Error
```

把任意抛出值规整为可诊断错误：原生 `Error` 或具有字符串 name/message/stack 的跨 realm/结构化错误形状原样返回；后者不保证 instanceof 本地 Error。其余值包装成携带 `cause: value` 的内部错误类型，消息优先取 `options.message`，其次（当抛出值本身是字符串时）取该字符串，否则用固定的兜底文案。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function walkErrorCauses(
  error: unknown,
  options?: { readonly maxDepth?: number }
): readonly unknown[]
```

按 `cause` 链与 `AggregateError.errors` 展开遍历，返回访问到的全部节点（含起始 `error` 自身），用 `Set` 做同一值去重防止环路。`maxDepth`（默认 32）限制最大深度，超出后停止继续下探那一支。用 `cause: undefined` 创建的错误会在结果里留下一个 `undefined` 项，读取字段时请用可选链（`item?.code`）。

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
try {
  throw new Error('outer', { cause: new Error('inner') })
} catch (error) {
  walkErrorCauses(error) // [outerError, innerError]
}
```

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function combineErrors(errors: Iterable<unknown>, message: string): Error | undefined
```

把 0 个、1 个或多个错误合并：0 个返回 `undefined`；1 个原样返回（经 `toError` 规整）；多个包装成 `AggregateError(errors, message)`。如果遍历 `errors` 这个 `Iterable` 本身抛错，会把已收集的错误连同该次遍历失败一起打包进 `AggregateError` 再抛出。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function isUtilsError(value: unknown): value is UtilsError
function isUtilsAbortError(value: unknown): value is UtilsAbortError
function isUtilsTimeoutError(value: unknown): value is UtilsTimeoutError
```

诊断形状守卫：检查 error-like 的 name/message/stack、source 为 foundation.utils，且 code 属于 UtilsErrorCode；abort/timeout 再核对对应 code。无需 instanceof 本地构造器，不用作来源认证。

### `UtilsErrorCode`

```ts
const UtilsErrorCode = {
  invalidArgument: 'INVALID_ARGUMENT',
  nonErrorValue: 'NON_ERROR_VALUE',
  envUnsupported: 'ENV_UNSUPPORTED',
  aborted: 'ABORTED',
  deadlineExceeded: 'DEADLINE_EXCEEDED',
  schedulerRunaway: 'SCHEDULER_RUNAWAY',
  errorIdentityConflict: 'ERROR_IDENTITY_CONFLICT',
  errorChainInvalid: 'ERROR_CHAIN_INVALID',
  cloneUnsupported: 'CLONE_UNSUPPORTED',
  invalidEncoding: 'INVALID_ENCODING',
  limiterClosed: 'LIMITER_CLOSED',
  reentrantCall: 'REENTRANT_CALL',
  configUnsupported: 'CONFIG_UNSUPPORTED',
  configReadonly: 'CONFIG_READONLY',
  configConflict: 'CONFIG_CONFLICT',
  configLimitExceeded: 'CONFIG_LIMIT_EXCEEDED',
  configPathInvalid: 'CONFIG_PATH_INVALID',
  objectPathInvalid: 'OBJECT_PATH_INVALID',
  formatInvalid: 'FORMAT_INVALID',
  formatValueMissing: 'FORMAT_VALUE_MISSING',
  numberFormatInvalid: 'NUMBER_FORMAT_INVALID'
} as const
```

全包统一使用的稳定语义码，`IUtilsErrorCode` 是其取值的联合类型。除 `UtilsError` 子类外，`base64ToBytes`/`object-path`/`config` 等模块抛出的原生 `TypeError`/`RangeError` 也会通过 `Object.defineProperty` 挂上对应的 `code`（与 `source: 'foundation.utils'`），可用同一套判断逻辑识别。

按用途理解全部错误码：

- `INVALID_ARGUMENT`：参数类型、范围或互斥组合错误；修正调用参数。
- `NON_ERROR_VALUE`：非 `Error` 异常值已被 `toError()` 转换；从 `cause` 读取原始值。
- `ENV_UNSUPPORTED`：宿主缺少 `structuredClone` 等必要能力；更换环境或实现。
- `ABORTED`：外部信号请求取消；停止协作式工作并传播取消原因。
- `DEADLINE_EXCEEDED`：操作、尝试或总流程超时；结合 `scope`、`timeoutMs` 选择重试或降级。
- `SCHEDULER_RUNAWAY`：虚拟时钟一次推进超过 10000 个任务；排查同刻递归调度。
- `ERROR_IDENTITY_CONFLICT`：已有错误身份与新 `source`/`code` 冲突；保留原身份。
- `ERROR_CHAIN_INVALID`：收到的序列化错误树或其 plain data 违反字段、标量、深度、数量或文本字节约束；修正输入或使用边界自己的处理策略。
- `CLONE_UNSUPPORTED`：值不能被 `structuredClone` 复制；先转换为可克隆数据。
- `INVALID_ENCODING`：编码输入不是规范形式；按错误偏移修正输入。
- `LIMITER_CLOSED`：并发限制器已关闭；停止提交或创建新实例。
- `REENTRANT_CALL`：同一实例发生禁止的重入；等待当前回调结束。
- `CONFIG_UNSUPPORTED`：配置含不支持的数据形状或属性；改用普通数据。
- `CONFIG_READONLY`：尝试修改只读配置；从所有者侧创建新配置。
- `CONFIG_CONFLICT`：配置来源的所有权、profile 或描述符冲突；统一契约再合并。
- `CONFIG_LIMIT_EXCEEDED`：配置键数、深度等超过安全上限；缩小输入或调整明确限制。
- `CONFIG_PATH_INVALID`：配置路径为空、危险或分段无效；改用安全路径。
- `OBJECT_PATH_INVALID`：对象路径无法安全解析；修正字符串或分段元组。
- `FORMAT_INVALID`：模板、占位符或值不能安全格式化；修正模板或输入。
- `FORMAT_VALUE_MISSING`：严格格式化缺少占位符值；补齐字段或调整策略。
- `NUMBER_FORMAT_INVALID`：`Intl.NumberFormat` 拒绝 locale、选项、货币或数值；修正格式配置。

---

<a id="bytes-模块"></a>

### `IdentifyError`

`IdentifyError` 是带稳定身份（`source`、`code`，可选 `phase`、`detail`）的 `Error` 子类，把本模块的错误工具集中成一个类。身份字段通过 `attachErrorIdentity` 写成只读、不可配置的自有属性，原始失败保留在 `cause` 上，`native()` 返回原生根错误，`stack` 不会被改写。原型已冻结，方法不能被赋值覆盖。

```ts
import { IdentifyError } from '@migaia/utils/error'

const OrderError = IdentifyError.define('@app/orders', {
  notFound: 'NOT_FOUND',
  conflict: 'CONFLICT'
})
throw OrderError.notFound({ cause, detail: { id } }) // IdentifyError<'@app/orders', 'NOT_FOUND'>

if (OrderError.is(error, 'notFound')) showEmpty()
const status = IdentifyError.match(error, {
  NOT_FOUND: () => 404,
  CONFLICT: () => 409,
  _: () => 500
})
const timeout = IdentifyError.find(error, { source: 'foundation.utils', code: 'DEADLINE_EXCEEDED' })
```

- 静态方法：`from(error, identity)`（同身份的实例原样返回）、`define`、`assert`、`wrap`（同步异常与异步拒绝都转换）、`is`、`find`、`match`、`identityOf`（从不抛出），以及委托给现有函数的 `combine` / `walk` / `reason` / `serialize` / `deserialize`。
- 实例方法：`identity()`、`native()`、`causes()`、`has(match)`、`equal(other)`、`compare(other)`、`clone()`、`mutable()`（可编辑的身份草稿）、`withPhase()`、`withDetail()`、`combine(...others)`（`errors` 首项为自身）、`attachSecondary(...errors)`、`toJSON()`、`toString()`。
- 非法身份抛出 `INVALID_ARGUMENT` 的 `TypeError`。`match` 没有命中且没有 `_` 时原样重抛。

## `/bytes` 模块

不依赖 Node `Buffer` 或 DOM 的字节/文本编解码，纯 ECMAScript 实现。

### `ArrayBuffer` 与 `Uint8Array` 的关系

- `ArrayBuffer` 是固定长度的原始连续内存，只负责保存字节；不能直接用下标读写。它常见于 `fetch(...).arrayBuffer()`、文件、Web Crypto、WebAssembly 和 Worker 传输边界。
- `Uint8Array` 是该内存上的 8 位无符号整数视图，每个元素对应一个 0～255 的字节。Base64、UTF-8、网络协议与二进制序列化需要逐字节操作，因此本模块以它作为主要输入输出。
- `new Uint8Array(buffer, byteOffset, length)` 创建共享底层内存的窗口，不复制数据；视图写入会反映到原 buffer。`subarray()` 继续共享内存，`slice()` 才创建独立副本。
- 普通 `ArrayBuffer` 跨 Worker 转移后可能 detached；`SharedArrayBuffer` 是并发共享内存，具有不同的所有权和同步要求，所以 `isArrayBuffer()` 明确拒绝它。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function isUint8Array(value: unknown): value is Uint8Array
function isArrayBuffer(value: unknown): value is ArrayBuffer
```

两个 guard 通过引擎的 `%TypedArray%.prototype[Symbol.toStringTag]` 与 `ArrayBuffer.prototype.byteLength` 内部槽 getter 判定真实品牌，因此能识别跨 iframe/Worker realm 的合法实例与子类，同时拒绝 `constructor.name` / 原型 / `Symbol.toStringTag` 伪造、其他 TypedArray、`DataView`、`SharedArrayBuffer` 和 Proxy。检测不读取候选值的用户属性。

detached `Uint8Array` / `ArrayBuffer` 仍返回 `true`：detachment 不改变对象品牌，但会影响读取能力；需要消费字节的调用方仍须独立处理 detached 状态。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function bytesToBase64(value: Uint8Array): string
```

按 RFC 4648 规范字母表编码为标准（非 URL-safe）、带 `=` 补齐的 Base64 字符串。

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
function base64ToBytes(value: string, target?: Uint8Array): Uint8Array // target 长度须等于解码字节数，复用而不分配
```

**只接受规范形式**：标准字母表、必须 4 的倍数长度、正确的 `=` 补齐。非规范输入（URL-safe 变体、无补齐、多余空白等）一律拒绝，抛出携带 `code: 'INVALID_ENCODING'` 的 `TypeError`。解码时直接检查 padding 未使用位必须为零，不进行反向编码，拒绝数值不对齐的输入。

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
bytesToBase64(new Uint8Array([1, 2, 3])) // 'AQID'
base64ToBytes('AQID') // Uint8Array [1, 2, 3]
base64ToBytes('AQID-_') // 抛 TypeError（URL-safe 字符不被接受）
```

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function* streamBase64Chunks(value: Uint8Array, maxChunkBytes?: number): Iterable<string>;
```

把大字节数组切分成多个**各自独立合法**的 Base64 片段（每片段都在 3 字节边界上切分，因此每片段自身都能正确解码，不需要拼接后才合法）。`maxChunkBytes` 默认 `32763`，必须是 `>= 3` 的安全整数；实际切分宽度会向下取整到 3 的倍数。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function utf8ByteLength(value: string): number
```

计算字符串编码为 UTF-8 后的字节数，不分配缓冲区（正确处理代理对/非法代理，用 U+FFFD 的宽度 3 计入非法代理）。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function encodeUtf8(value: string): Uint8Array
function decodeUtf8(value: Uint8Array, options?: { readonly fatal?: boolean }): string
```

`encodeUtf8` 编码为新分配的 UTF-8 字节数组。`decodeUtf8` 解码：`fatal: false`（默认）遇到非法字节序列时用 U+FFFD 替换并跳过 1 字节继续；`fatal: true` 时直接抛出携带偏移量的编码错误。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function splitUtf8(value: string, maxBytes: number): readonly string[]
```

把字符串按码点边界切分成若干子串，保证每个子串编码后的字节数不超过 `maxBytes`（绝不会在一个码点中间切断）。`maxBytes` 必须是 `>= 4` 的安全整数（4 是单个码点的最大 UTF-8 宽度）。空字符串返回 `['']`。

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
splitUtf8('你好世界', 6) // 每个汉字 3 字节 → ['你好', '世界']
```

---

<a id="object-模块"></a>

## `/object` 模块（含对象路径）

`createSafeRecord<T>()` 每次创建新的 null-prototype 字典，返回 `Partial<Record<string, T>>`。未可信键名（包括 `__proto__` 和 `constructor`）作为普通数据键，不会调用 Object.prototype 上的 setter；赋值后字段仍为可写、可枚举、可配置的数据属性。它不读取或复制输入，也不拥有 RPC 的任务或投递 key 格式。

### 快照与探测

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function isPlainObject(value: unknown): value is Record<PropertyKey, unknown>
```

非数组对象的原型为 null，或其原型的父原型为 null 时返回 true。因此也接受 Object.create(Object.create(null))，并非只检查当前 realm 的 Object.prototype 等值；通常的 class 实例与 Date/Map 等内置对象返回 false。读取原型链失败（代理陷阱抛错）时同样返回 `false`，不会向上抛错。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
type IProbePropertyResult<T> =
  | { readonly kind: 'missing' }
  | { readonly kind: 'value'; readonly value: T }
  | { readonly kind: 'failed'; readonly error: unknown }
function probeProperty<T>(value: object, key: PropertyKey): IProbePropertyResult<T>
```

读取单个属性且只读取一次（避免 getter 被调用两次产生副作用）：属性不存在返回 `missing`；读取（包括触发 getter）抛错返回 `failed` 并携带原始错误；否则返回 `value`。

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
const profileUnavailable = new Error('profile unavailable')
let profileReads = 0
const user = {
  name: 'Ada',
  get profile(): never {
    profileReads += 1
    throw profileUnavailable
  }
}

function readLabel(value: object, key: PropertyKey): string {
  const result = probeProperty<string>(value, key)
  switch (result.kind) {
    case 'value':
      return result.value
    case 'missing':
      return 'Anonymous'
    case 'failed':
      console.error('property read failed', result.error)
      return 'Unavailable'
  }
}

readLabel(user, 'name') // 'Ada'
readLabel(user, 'email') // 'Anonymous'
readLabel(user, 'profile') // 'Unavailable'
profileReads // 1：getter 只被读取一次
```

第一个参数可以是普通对象、class 实例或其他可读取属性的对象；第二参数接受字符串、数字或 Symbol key。它把缺失字段与读取失败拆成不同分支，避免 `try/catch` 后错误地使用默认值；返回 `failed` 时不会重建错误，`error` 就是 getter 原样抛出的实例。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function immutableSnapshot<T>(value: T): T
```

实现直接调用宿主原生 `globalThis.structuredClone(value)`，不是 JSON 序列化或手写递归：它一次复制完整对象图，保留循环引用、共享引用关系以及 `Date`、`Map`、`Set`、`ArrayBuffer`、TypedArray 等结构化克隆支持的数据类型。本 API 不接受 transfer list，因此 `ArrayBuffer` 会复制而不会转移所有权。

结构化克隆不会保留自定义 class 的原型方法、getter/setter 与属性描述符；函数、WeakMap 等不支持的成员会让整个克隆失败。“immutable”表示快照不再共享源对象引用，不表示返回值经过 `Object.freeze()`；需要运行时冻结或递归只读时由调用方另行处理。宿主不提供 `structuredClone` 时抛出 `code: 'ENV_UNSUPPORTED'` 的 `TypeError`；值本身不可结构化克隆时抛出 `code: 'CLONE_UNSUPPORTED'` 的 `TypeError`。

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
const shared = { count: 1 }
const source = {
  primary: shared,
  alias: shared,
  createdAt: new Date('2026-01-01T00:00:00Z')
}
const copy = immutableSnapshot(source)

source.primary.count = 2
copy.primary.count // 1
copy.primary === copy.alias // true
copy.createdAt instanceof Date // true
Object.isFrozen(copy) // false
```

```ts doc-test=skip reason="签名摘要，不是可运行模块"
type ISnapshotDiagnostic = {
  readonly path: readonly PropertyKey[]
  readonly reason: 'accessor' | 'read-failed' | 'unsupported'
  readonly cause: unknown
}
type IDiagnosticSnapshot<T> = {
  readonly value: T
  readonly diagnostics: readonly ISnapshotDiagnostic[]
}
function diagnosticSnapshot<T>(value: T): IDiagnosticSnapshot<T>
function structuredDiagnosticSnapshot<T>(value: T): IDiagnosticSnapshot<T>
```

与原生 `structuredClone` / `immutableSnapshot` 的关键区别是失败粒度：前两者是整图“全有或全无”，任何不支持成员都会让调用抛错；`diagnosticSnapshot` 始终尝试返回 `{ value, diagnostics }`。它递归复制普通对象与数组，可克隆的内建子树独立调用 `structuredClone`；函数、class 实例等不支持类型则**保留原引用**并记录 `unsupported`。访问器会被读取一次、投影为普通值并记录 `accessor`；读取或反射失败记录 `read-failed`。循环引用通过 `WeakMap` 保持安全。

因此，`diagnosticSnapshot` 的返回值可能只有部分隔离：`diagnostics` 非空时，调用方必须检查对应 `path`，不能把结果当作完整深拷贝。它适合日志、遥测、调试面板等“数据不能整份丢失，但降级必须可见”的场景；安全边界或配置隔离仍应优先用 `immutableSnapshot` 并让失败显式中止。

`structuredDiagnosticSnapshot` 是两种策略的组合：优先尝试原生 `structuredClone`，成功时 diagnostics 为空；宿主不支持或克隆失败时自动退回上述尽力快照，并在根路径追加 `unsupported` 或携带原始 cause 的 `read-failed` 诊断。需要“能完整克隆就完整克隆，否则仍返回可观测降级结果”的遥测边界优先使用它。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function identitySnapshot<T>(value: T): T
```

原样返回入参。单独调用没有运行时收益；它用于 `snapshot` / `clone` 这类可配置策略槽的零拷贝分支，明确表示调用方接受共享引用、后续修改双方可见。本仓的 clone policy 正是用它实现 `opaque` 分支，服务于身份敏感或不可克隆、且允许共享所有权的可信进程内数据。需要外部输入隔离、历史快照或跨边界传输时不要使用它，应选择 `immutableSnapshot`。

### 对象路径（`parseObjectPath` / `probeObjectPath` / `get` / `set` / `createPathAccessor`）

对象路径支持两种输入形式：

- **字符串路径**：`a.b.c`、数组用方括号下标 `list.[0].name`。
- **元组路径**：`readonly ['a', 'b', 'c']` 或 `readonly ['list', 0, 'name']`，可包含 `symbol` 键（字符串路径不能表达 symbol）。

两种形式共享同一套安全限制：单段最长 512 字符、路径最多 256 段、字符串路径总长不超过 4096 字符；`__proto__`/`prototype`/`constructor` 一律被拒绝（防止原型污染）。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function parseObjectPath(path: string | IObjectPathTuple): IObjectPathTuple
```

把字符串路径解析成规范化的 `readonly` 段元组（数字下标解析成 `number`），或校验并冻结一个已给定的元组路径。任何越界/危险段都会抛出携带 `code: 'OBJECT_PATH_INVALID'` 的 `TypeError`。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
type IPathValueProbe<T, P extends IObjectPathInput<T>> = {
  readonly kind: 'value'
  readonly originKey: P
  readonly segments: IObjectPathTuple
  readonly value: IObjectPathValue<T, P>
}
type IPathMissingProbe<P extends string | IObjectPathTuple = string | IObjectPathTuple> = {
  readonly kind: 'missing'
  readonly originKey: P
  readonly segments: IObjectPathTuple
  readonly failedAt: number
  readonly failedKey: IObjectPathSegment
  readonly resolvedPath: IObjectPathTuple
  readonly parent: unknown
}
type IPathBlockedProbe<P extends string | IObjectPathTuple = string | IObjectPathTuple> = {
  readonly kind: 'blocked'
  readonly originKey: P
  readonly segments: IObjectPathTuple
  readonly failedAt: number
  readonly failedKey: IObjectPathSegment
  readonly resolvedPath: IObjectPathTuple
  readonly parent: unknown
}
type IPathFailedProbe<P extends string | IObjectPathTuple = string | IObjectPathTuple> = {
  readonly kind: 'failed'
  readonly originKey: P
  readonly segments: IObjectPathTuple
  readonly failedAt: number
  readonly failedKey: IObjectPathSegment
  readonly resolvedPath: IObjectPathTuple
  readonly parent: unknown
  readonly error: unknown
}
type IPathProbe<T, P extends IObjectPathInput<T>> =
  IPathValueProbe<T, P> | IPathMissingProbe<P> | IPathBlockedProbe<P> | IPathFailedProbe<P>

function probeObjectPath<T, P extends IObjectPathInput<T>>(object: T, path: P): IPathProbe<T, P>
function probeObjectPathSegments<T, P extends IObjectPathInput<T>>(
  object: T,
  segments: P
): IPathProbe<T, P>
```

沿路径逐段探测，每段只读取一次。四种结果分别对应：**成功取到值**（`value`，携带 `value`）、**某一段属性不存在**（`missing`）、**某一段的父值不是对象/函数因而无法继续深入**（`blocked`，例如路径指向 `a.b.c` 但 `a.b` 是 `null` 或字符串）、**某一段读取本身抛出异常**（`failed`，例如触发了会抛错的 getter，携带 `error`）。

四种结果共有字段 `originKey`（原始传入的 `path`，未加工）与 `segments`（`parseObjectPath` 解析后的完整段元组）；`missing`/`blocked`/`failed` 额外共有 `failedAt`（第几段失败，0-based）、`failedKey`（失败的那一段键）、`resolvedPath`（成功解析到的前缀路径，即 `segments` 中 `failedAt` 之前的部分）、`parent`（失败发生时的父级值——`missing`/`failed` 时是该属性所属的对象，`blocked` 时是那个非对象的原始值本身）。`failed` 唯一多出 `error` 字段，携带原始抛出值。

`probeObjectPathSegments` 接受已经由调用方校验/缓存的段元组，跳过再次解析；结果语义与 `probeObjectPath` 完全相同。只有能保证 segments 已通过同一安全约束的高频内部路径才应使用它，外部字符串输入继续交给 `probeObjectPath`。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function get<T, P extends IObjectPathInput<T>>(
  object: T,
  path: P
): IObjectPathValue<T, P> | undefined
```

基于 `probeObjectPath` 的简化读取：`missing`/`blocked` 统一返回 `undefined`；`failed`（读取本身抛错）会**原样重新抛出**该错误，不会被静默吞掉——这一点区别于"路径不存在"，调用方需要分别处理。

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
const data = { user: { name: 'Ada' } }
get(data, 'user.name') // 'Ada'
get(data, 'user.missing') // undefined（missing）
get(data, 'user.name.x') // undefined（blocked：'Ada' 是字符串，无法继续深入 .x）
```

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function set<T, P extends IObjectPathInput<T>>(
  object: T,
  path: P,
  nextValue: IObjectPathWriteValue<T, P>
): T
```

不可变路径写入：每次值真正变化的 `set()` 都返回一个新根对象，传入对象保持不变。只有路径上的节点被浅拷贝（结构共享，未涉及的兄弟节点保持同一引用）。这里的 immutable 描述更新方式，不表示返回对象经过深拷贝或 `Object.freeze()`；返回值本身仍可修改。路径中间缺失的容器会按下一段键的类型自动创建（数字键 → `[]`，其他 → `{}`）。若路径中途遇到非空的原始值（字符串、数字等，无法继续深入）会抛出 `code: 'OBJECT_PATH_INVALID'` 的 `TypeError`。若新值与旧值经 `Object.is` 相等，则没有发生更新，直接复用原对象，不做任何拷贝。

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
const before = { user: { name: 'Ada', tags: ['a'] } }
const after = set(before, 'user.name', 'Grace')
after.user.name // 'Grace'
after !== before // true（发生更新时返回新根对象）
after.user !== before.user // true（更新路径上的节点被复制）
after.user.tags === before.user.tags // true（未涉及的分支保持引用不变）
before.user.name // 'Ada'（原对象未被修改）
Object.isFrozen(after) // false（immutable update 不等于冻结）
```

```ts doc-test=skip reason="签名摘要，不是可运行模块"
type IPathGetEvent<T, P extends IObjectPathInput<T> = IObjectPathInput<T>> = {
  readonly originKey: P
  readonly segments: IObjectPathTuple
  readonly probe: IPathValueProbe<T, P>
  readonly value: IObjectPathValue<T, P>
  replace(value: IObjectPathValue<T, P>): void
}
type IPathSetEvent<T, P extends IObjectPathInput<T> = IObjectPathInput<T>> = {
  readonly originKey: P
  readonly segments: IObjectPathTuple
  readonly probe: IPathValueProbe<T, P>
  readonly value: IObjectPathWriteValue<T, P>
  replace(value: IObjectPathWriteValue<T, P>): void
}
type IPathAccessorOptions<T> = {
  readonly ifMissing?: (probe: IPathMissingProbe) => void
  readonly ifBlocked?: (probe: IPathBlockedProbe) => void
  readonly ifFailed?: (probe: IPathFailedProbe) => void
  readonly onGet?: (event: IPathGetEvent<T>) => void
  readonly onSet?: (event: IPathSetEvent<T>) => void
}
type IPathAccessor<T> = {
  readonly value: T
  get<P extends IObjectPathInput<T>>(path: P): IObjectPathValue<T, P> | undefined
  set<P extends IObjectPathInput<T>>(path: P, value: IObjectPathWriteValue<T, P>): T
  probeValue<P extends IObjectPathInput<T>>(path: P): IPathProbe<T, P>
  parsePath(path: string | IObjectPathTuple): IObjectPathTuple
}
function createPathAccessor<T>(object: T, options?: IPathAccessorOptions<T>): IPathAccessor<T>
```

封装一个**内部持有当前根对象**的有状态访问器：每次 `set()` 成功后，`accessor.value` 自动前进到写入后的新根（后续 `get`/`set` 都基于最新根）。`ifMissing`/`ifBlocked`/`ifFailed` 在对应探测结果出现时被调用，用作集中式诊断钩子。

`onGet`/`onSet` 在每次成功读/写时被调用，事件对象字段：`originKey`（原始传入路径）、`segments`（解析后的段元组）、`probe`（本次读/写命中的 `IPathValueProbe`，即成功探测结果）、`value`（本次实际读到/将要写入的值）、`replace(value)`（调用后就地改写本次读取/写入的实际返回值/写入值，例如做统一的默认值填充或写入前校验/转换）。`IPathGetEvent`/`IPathSetEvent` 唯一的区别是 `value`/`replace` 的类型：读事件用 `IObjectPathValue`（读到的原值类型），写事件用 `IObjectPathWriteValue`（字面量放宽后的可写类型）。

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
const accessor = createPathAccessor(
  { count: 0 },
  { onSet: (event) => console.log('write', event.originKey, event.value) }
)
accessor.set('count', 5) // 打印 write count 5
accessor.value // { count: 5 }
```

对应的类型工具（用于给调用方提供编译期路径补全与值类型推断）：`IObjectPathSegment`、`IObjectPathTuple`、`IObjectPath<T>`（字符串路径，最深 8 层）、`IObjectPathTupleFor<T>`（元组路径）、`IObjectPathInput<T>`（两者联合）、`IObjectPathValue<T, P>`（路径指向的值类型）、`IObjectPathWriteValue<T, P>`（写入时接受的类型，字面量类型会被适度放宽为其基础类型，例如字面量联合放宽为 `string`/`number`/`boolean`/`bigint`）。

---

<a id="typing-模块"></a>

## `/typing` 模块

`@migaia/utils/typing`（`src/typing.ts`）是**纯 type-only** 的子入口：文件里全部是 `export type`，没有任何运行时值，构建产物 `dist/typing.js` 不含可执行代码。它**不经由根入口 `@migaia/utils` 重新导出**——只能写 `import type { ... } from '@migaia/utils/typing'`，这是刻意的：把类型出口和运行时出口分开，消费方按类型引用它时不会因为模块解析牵连进任何运行时代码。

它做两件事：

1. **重导出**已在别处定义的类型，给跨包类型复用一个稳定、单一的入口，避免消费方为了拿一个类型而要记住它散落在 `/object` 还是 `/promise`：
   - 来自 `/object`（即 `object-path.ts`）：`IObjectPath`、`IObjectPathInput`、`IObjectPathSegment`、`IObjectPathTuple`、`IObjectPathTupleFor`、`IObjectPathValue`、`IObjectPathWriteValue`
   - 来自 `/object`（即 `object.ts`）：`IProbePropertyResult`
   - 来自 `/promise`：`IAbortSignal`、`IDeferred`

   这些类型的语义、字段、约束与它们各自源模块中的定义完全一致（同一个类型的两个入口，不是两份独立定义），完整说明见 [`/object` 模块](#object-模块)与 [`/promise` 模块](#promise-模块)对应章节。

2. **新增**两个 `/object` 模块本身不提供的类型工具，用于把带判别字段的联合类型（discriminated union）转成"判别值 → 对应联合分支"的映射类型：

```ts
/** 按一个顶层、值为 PropertyKey 的判别字段对联合类型分组。 */
type IDiscriminatedByField<F extends PropertyKey, T extends Record<F, PropertyKey>> = {
  [K in T[F]]: Extract<T, Record<F, K>>
}
```

- 类型参数 `F extends PropertyKey`：判别字段名（`string`/`number`/`symbol`）。
- 类型参数 `T extends Record<F, PropertyKey>`：目标联合类型本身；约束要求 `T` 每个成员上 `F` 对应的字段值都必须是 `PropertyKey`——如果某个分支的该字段是对象等非 `PropertyKey` 类型，`T` 就不满足 `Record<F, PropertyKey>` 约束，直接编译报错（不是运行时报错，是这个类型工具压根用不起来）。
- 结果：一个以 `T[F]` 的每个字面量值为 key、value 是 `Extract<T, Record<F, K>>`（该判别值对应的联合分支，若多个分支共享同一判别值则保留为它们的联合）的映射类型。

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
/** 按一个 string 或 tuple 对象路径对联合类型分组，路径解析规则与 /object 模块的 IObjectPath 完全一致。 */
type IDiscriminatedByPath<T, P extends IObjectPathInput<T>> = {
  [K in Extract<IObjectPathValue<T, P>, PropertyKey>]: IExtractDiscriminatedByPath<T, P, K>
}
```

- 类型参数 `T`：目标联合类型本身。
- 类型参数 `P extends IObjectPathInput<T>`：字符串路径（如 `'meta.category'`）或元组路径（如 `readonly ['meta', 'category']`），和 `get`/`set`（`/object` 模块）接受的路径写法完全相同。
- 路径必须在联合的**每一个分支**上都能解析出值，且该值必须收窄到 `PropertyKey`；哪个分支上路径不存在/类型不对，该分支在实现细节上通过条件类型被排除出结果（不是抛运行时错误——这纯粹是类型层行为，部分分支缺路径或判别值非 PropertyKey 时，结果可能是缺少对应分支的映射，甚至空对象类型，不保证 alias 声明本身编译报错）。
- 结果：以路径解析出的每个字面量判别值为 key，value 是对应的联合分支（同判别值的多个分支合并为联合）。

**用法示例**（摘自包自带测试 `test/typing.test.ts`，行为已用 `expectTypeOf` 验证）：

```ts doc-test=skip reason="签名摘要，不是可运行模块"
type IEvent =
  | {
      readonly type: 'created'
      readonly meta: { readonly category: 'write' }
      readonly payload: { readonly userId: string }
    }
  | {
      readonly type: 'deleted'
      readonly meta: { readonly category: 'write' }
      readonly payload: { readonly reason: string }
    }
  | {
      readonly type: 'read'
      readonly meta: { readonly category: 'read' }
      readonly payload: { readonly cache: boolean }
    }

type IByType = IDiscriminatedByField<'type', IEvent>
// { created: Extract<IEvent, { type: 'created' }>; deleted: ...; read: ... }

type IByCategory = IDiscriminatedByPath<IEvent, 'meta.category'>
// { write: 'created' | 'deleted' 两个分支的联合; read: 'read' 分支 }

type IByTupleCategory = IDiscriminatedByPath<IEvent, readonly ['meta', 'category']>
// 与 IByCategory 完全等价——字符串路径和元组路径是同一套解析逻辑的两种写法
```

**类型边界示例**：全部路径不存在时会违反路径约束；部分分支缺路径或非 PropertyKey 的路径值可能只产生空映射。

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
// @ts-expect-error 所有分支均不存在此路径，违反 IObjectPathInput 约束
type IInvalid1 = IDiscriminatedByPath<IEvent, 'meta.unknown'>

type INotPropertyKey = { readonly discriminator: { readonly nested: true } }
// @ts-expect-error 判别字段的值是对象，不满足 PropertyKey 约束，无法作为映射类型的 key
type IInvalid2 = IDiscriminatedByField<'discriminator', INotPropertyKey>
```

---

<a id="config-模块"></a>

## `/config` 模块

带**所有权语义**的配置对象：只有经 `ownConfig` 接纳的对象才能被 `readonlyConfig`/`patchConfig`/`readConfigPath`/`combineConfig` 处理，用运行时 `WeakMap` 元数据（而非可伪造的字段）标记"这是一个受本包管理的配置根"。

```ts
const ConfigProfile = { data: 'data', richRuntime: 'richRuntime' } as const
type IConfigProfile = 'data' | 'richRuntime'
```

`data`（默认）：只接受可移植的纯数据——普通对象、数组、`Date`/`RegExp`/`Map`/`Set` 等内置类型；**拒绝函数**。`richRuntime`：额外接受函数/可构造类（连同其自身属性与 `prototype` 一起深拷贝），用于确实需要在配置里携带回调或工厂的场景。

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
const CONFIG_DELETE: unique symbol
```

在 `patchConfig`/`combineConfig` 的补丁对象中，把某个键的值设为这个符号，表示"删除该键"（而不是设为 `undefined`）。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function ownConfig<T extends IConfigRecord>(
  value: T,
  options?: { readonly profile?: IConfigProfile; readonly limits?: Partial<IConfigLimits> }
): IOwnedConfig<T>
```

深拷贝 `value` 得到一个独立的、被本包元数据标记为"已拥有"的图。要求根必须是普通对象（不能是数组）且不含 `symbol` 键。深拷贝过程中：

- `Date`/`RegExp`/`Map`/`Set` 会被识别并对应构造新实例（而不是被当成普通对象递归展开字段）；
- 循环引用通过内部 `WeakMap` 保留同一图结构（不会无限递归，也不会拆散共享节点）；
- `__proto__`/`prototype`/`constructor` 键一律拒绝；
- 超过 `limits`（见下）中的深度/节点数/键数会抛出 `code: 'CONFIG_LIMIT_EXCEEDED'` 的 `RangeError`。

若 `value` **已经**是某次 `ownConfig` 的返回值（元数据匹配同一 `profile`/`limits`），直接原样返回（幂等）；若元数据不匹配（例如同一对象先后用不同 `profile` 调用），抛出 `code: 'CONFIG_CONFLICT'` 的 `TypeError`。

调用方拿到结果后有三种明确路径：内部继续把它作为稳定配置根；通过 `readonlyConfig()` 暴露可读但不可写的递归 Proxy；通过 `patchConfig()` 或 `combineConfig()` 派生下一份已拥有配置。不要直接把原始外部对象交给这些 API，也不要把“已拥有”误解为冻结——所有权保证来自独立图与内部登记，运行时写保护由 `readonlyConfig()` 单独提供。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
type IConfigLimits = {
  readonly maxDepth: number // 默认 256
  readonly maxNodes: number // 默认 100_000
  readonly maxKeys: number // 默认 1_000_000
  readonly maxPathLength: number // 默认 4096
  readonly maxSegmentLength: number // 默认 512
}
```

`limits` 不得超过包级默认上限。`patchConfig` 相对输入基准只能收紧，放宽会抛 CONFIG_CONFLICT；`combineConfig` 取所有输入与请求上限的逐项最小值，放宽请求被自动收紧，不因此抛 CONFIG_CONFLICT。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function readonlyConfig<T extends IConfigRecord>(value: IOwnedConfig<T>): T
```

返回一个**带缓存的只读对象**，内部通过 `Proxy` 拦截修改；同一输入对象重复调用会返回同一个只读对象。读取时仍然访问原配置，没有再复制一份数据。任何写操作（`set`/`defineProperty`/`deleteProperty`/`setPrototypeOf`/`preventExtensions`，以及 `Map`/`Set`/`Date` 上的变更方法如 `.set()`/`.add()`/`.setFullYear()`）都会抛出 `code: 'CONFIG_READONLY'` 的 `TypeError`。嵌套对象、`Map`、`Set` 和函数字段也会受到同样的写入保护。`value` 必须是 `ownConfig` 的产物，否则抛 `code: 'CONFIG_UNSUPPORTED'`。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function patchConfig<T extends IConfigRecord>(
  base: IOwnedConfig<T>,
  patch: IConfigPatch<T>,
  options?: {
    readonly profile?: IConfigProfile
    readonly limits?: Partial<IConfigLimits>
    readonly reuseUnchangedRoot?: boolean
  }
): IOwnedConfig<T>
```

对**根**做写时复制式覆盖：`patch` 中每个键要么设为新值（会被递归深拷贝并纳入所有权），要么设为 `CONFIG_DELETE` 表示删除。只有被改动路径上的节点被复制，未涉及的子树按引用共享。`patch` 为空对象且 `reuseUnchangedRoot`（默认 `true`）时直接返回 `base` 本身，不做任何拷贝。`patch` 必须是普通对象、键不能是 `symbol`、不能是访问器属性，否则抛 `code: 'CONFIG_UNSUPPORTED'`；键名撞上 `__proto__`/`prototype`/`constructor` 抛 `code: 'CONFIG_PATH_INVALID'`。**注意**：`patchConfig` 只在根一层应用补丁——要修改嵌套字段，先用 `get`/`set`（`/object` 模块）在应用层算出新的嵌套子树，再作为整体值放进 `patch`。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
const base = ownConfig({ endpoint: '/v1', retries: 2, debug: true })
const next = patchConfig(base, { retries: 3, debug: CONFIG_DELETE })
next.retries // 3
'debug' in next // false
```

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function parseConfigPath(
  path: string,
  limits?: Pick<IConfigLimits, 'maxPathLength' | 'maxSegmentLength'>
): readonly string[]
```

在 `/object` 模块的 `parseObjectPath` 基础上叠加 config 专属限制（长度上限可自定义，默认取包级默认值）并强制所有段都是字符串（不支持数字下标简写形式在 config 路径里独立出现，统一按字符串段处理）。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
type IConfigReadResult =
  { readonly kind: 'missing' } | { readonly kind: 'value'; readonly value: unknown }
function readConfigPath(
  config: IOwnedConfig<IConfigRecord>,
  path: string | readonly string[]
): IConfigReadResult
```

读取配置内某条路径，区分"键不存在"（`missing`）与"值就是 `undefined`"（`value: undefined`）。返回的对象/函数类型的值会自动包一层只读 Proxy（与 `readonlyConfig` 相同的包装逻辑），保证读到的嵌套值也不可被外部修改。`config` 必须是 `ownConfig` 的产物。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function combineConfig(
  sources: readonly IOwnedConfig<IConfigRecord>[],
  options?: {
    readonly profile?: IConfigProfile
    readonly limits?: Partial<IConfigLimits>
    readonly strategies?: Partial<IConfigMergeStrategies>
    readonly pathRules?: readonly IConfigPathRule[]
    readonly onConflict?: (context: IConfigConflictContext) => IConfigConflictDecision
  }
): IOwnedConfig<IConfigRecord>
```

按 `sources` 数组的顺序（后者覆盖前者）合并多个已拥有的配置根。只有一个来源且未提供任何合并选项时，直接返回该来源，保留根 identity；其他情形产出新的 owned 配置。全部来源必须共享同一个 `profile`，否则抛 `code: 'CONFIG_CONFLICT'`。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
type IConfigMergeStrategies = {
  readonly record: 'merge' | 'replace' // 默认 'merge'：普通对象递归合并；'replace'：整体覆盖
  readonly array: 'replace' | 'concat' | 'mergeByIndex' // 默认 'replace'
  readonly map: 'replace' | 'merge' // 默认 'replace'
  readonly set: 'replace' | 'union' // 默认 'replace'
  readonly undefined: 'ignore' | 'assign' // 默认 'ignore'：右侧显式 undefined 不覆盖左侧
}

type IConfigPathRule = {
  readonly prefix: readonly PropertyKey[]
  readonly strategies: Partial<IConfigMergeStrategies>
}

type IConfigConflictContext = {
  readonly path: readonly PropertyKey[]
  readonly left: unknown
  readonly right: unknown
}
type IConfigConflictDecision =
  | { readonly kind: 'left' }
  | { readonly kind: 'right' }
  | { readonly kind: 'delete' }
  | { readonly kind: 'value'; readonly value: unknown }
```

`strategies` 是全局默认策略；`pathRules` 是一组 `{ prefix, strategies }`，按 `prefix`（从根开始的键路径）匹配当前正在合并的键路径，`prefix` 更长（更具体）的规则优先生效，命中的规则会与全局 `strategies` 合并（规则内声明的字段覆盖全局同名字段，规则未声明的字段沿用全局值）。

每次 `combineConfig` 调用会在合并来源前读取每条规则的 `prefix` 和 `strategies` 一次并建立索引；相同前缀以输入中最先声明的规则为准。规则描述必须稳定：不支持依赖 getter 每次返回不同描述，或在合并过程中修改规则来影响后续属性。

当某个键在双方都存在、且不属于以上任何自动合并分支（例如两侧都是不可合并的原始值）时，若提供了 `onConflict`，会调用它并传入 `IConfigConflictContext`（`path`：当前键的完整路径；`left`：左侧/已有值；`right`：右侧/新值），其返回值 `IConfigConflictDecision` 决定最终结果：`{ kind: 'left' }` 保留左值、`{ kind: 'right' }` 采用右值、`{ kind: 'delete' }` 删除该键、`{ kind: 'value', value }` 采用自定义值。`onConflict` 必须**同步**返回（返回 Promise 会抛 `code: 'CONFIG_CONFLICT'`；返回值不是上述四种 `kind` 之一同样抛 `CONFIG_CONFLICT`）。未提供 `onConflict` 时右侧直接覆盖左侧（标准合并语义）。`right === CONFIG_DELETE` 会删除目标键（可用于合并阶段裁剪掉某个来源写入的默认值）。

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
const defaults = ownConfig({
  retries: 1,
  tags: ['default'],
  transport: { timeoutMs: 1_000, keepAlive: true }
})
const override = ownConfig({
  retries: 3,
  tags: ['custom'],
  transport: { timeoutMs: 2_500 }
})

const merged = combineConfig([defaults, override], {
  strategies: { record: 'merge', array: 'concat' }
})

// merged 是新配置；defaults 和 override 都不会被修改。
merged
// {
//   retries: 3,
//   tags: ['default', 'custom'],
//   transport: { timeoutMs: 2500, keepAlive: true },
// }

// 这里的 diff 只是把结果变化写明，不是 combineConfig 的额外返回值。
const diff = {
  retries: { before: defaults.retries, after: merged.retries },
  tags: { before: defaults.tags, after: merged.tags },
  timeoutMs: { before: defaults.transport.timeoutMs, after: merged.transport.timeoutMs }
}
```

---

<a id="function-模块"></a>

### `ConfigOwner`

`ConfigOwner` 持有一份不可变的配置快照，把 `ownConfig` / `readConfigPath` / `patchConfig` / `combineConfig` / `readonlyConfig` 集中到一个可链式调用的类上。每次写入都会先完整构建并校验下一份快照，再提交；失败时旧快照不变。路径类型由 `IObjectPath` 推导，`get('server.port')` 的类型就是 `number | undefined`。

```ts
import { ConfigOwner } from '@migaia/utils/config'

const config = new ConfigOwner(defaults, { validate: (value) => value.server.port > 0 })
config
  .set('server.port', 8080)
  .patch({ debug: true })
  .combine({ cache: { ttl: 60 } })
config.require('server.port') // 缺失时抛 CONFIG_VALUE_MISSING
const stop = config.watch('server.port', (next, prev) => restart(next))

const fromText = ConfigOwner.from<IAppConfig>(text) // 非法 JSON：CONFIG_PARSE_FAILED
const remote = await ConfigOwner.fromAsync(
  ({ signal }) => fetch(url, { signal }).then((r) => r.text()),
  {
    timeoutMs: 5000
  }
) // 源失败：CONFIG_SOURCE_FAILED
const env = ConfigOwner.fromEnv(process.env, { prefix: 'APP__', key: (s) => s.toLowerCase() })
```

- 读取：`get` / `getOr` / `require` / `read` / `has` / `view()`（深只读视图）/ `select(path)`（子树的新 owner）/ `diff` / `equals`。
- 写入（返回 `this`）：`set` / `delete` / `patch` / `combine` / `batch(fn)`（一次校验、一次通知，失败整体回滚）/ `reset()` / `lock()`。
- 监听：`watch(listener)` 或 `watch(path, listener)`；监听器异常交给 `report`（默认进入宿主未捕获错误队列），监听器内再写入会抛 `REENTRANT_CALL`。
- 序列化：`toJSON()` / `toString(space)`；Map、Set、函数等非 JSON 值抛 `CONFIG_UNSUPPORTED`。
- 静态：`from`、`fromAsync`（Promise、值或接收 `signal` 的工厂；支持 `signal` / `timeoutMs`）、`fromEnv`、`merge`、`is`。与 `@migaia/resource` 的 `createResource` 组合即可得到一份响应式的配置资源。

## `/function` 模块

```ts doc-test=skip reason="签名摘要，不是可运行模块"
const noop: () => undefined
```

恒返回 `undefined` 的空函数，用作默认回调占位符。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function once<T extends (...args: never[]) => unknown>(functionValue: T): T
```

记忆化一个**同步**函数：只在首次调用时真正执行，之后的调用直接返回首次的结果（或重新抛出首次的异常——包括异常也被缓存，不会在第二次调用时重新执行函数体）。若在首次调用**尚未完成**时发生重入（函数体内部再次调用了被包装后的自身），会抛出 `code: 'REENTRANT_CALL'` 的 `TypeError`，防止意外的递归自调用绕过缓存语义。

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
// runtime.ts：整个模块只创建并导出这一份包装函数。
export const getRuntime = once(() => {
  const registry = buildCommandRegistry()
  return { registry, startedAt: Date.now() }
})

const first = getRuntime() // 创建 registry
const second = getRuntime() // 直接返回 first
first === second // true
```

适合模块内昂贵且确定的同步初始化，例如构建只读 registry、编译 schema 或探测一次运行时能力。首次异常也会永久缓存，所以需要 retry、reset、热更新或按请求隔离时不要使用。

边界必须明确：每次调用 `once(fn)` 都产生新的包装函数和独立缓存。模块顶层只创建、只导出一个包装函数，可以实现“每个模块实例一份”；但重复 bundle、iframe、Worker 与 Node `vm` 会拥有不同模块实例，因此它不是跨 realm 的全局单例工具。真正需要同一 realm / 进程共享时，让应用入口或依赖注入容器持有实例；必须使用全局表时，可选 `globalThis[Symbol.for('your-app/runtime')]`，同时处理版本冲突、生命周期与测试清理。

`Proxy` 适合把首次属性访问变成惰性初始化，或限制访问方式；它本身不提供唯一性。是否是单例仍由 Proxy 后面的实例存储位置和 owner 数量决定，因此无需为了“真实单例”给 `once` 结果额外套 Proxy。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function onceAsync<T>(functionValue: () => PromiseLike<T>): () => Promise<T>
```

记忆化一次**异步**调用：首次调用时启动 `functionValue()`，包装函数会保留并返回同一个 Promise；后续调用无论发生在 pending、fulfilled 还是 rejected 阶段，都直接拿到这个 Promise。`functionValue()` 可以返回原生 `Promise` 或合法 PromiseLike；其他值会让共享 Promise 以 `code: 'INVALID_ARGUMENT'` 的 `TypeError` reject。

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
// app-config.ts：路由和埋点会同时读取启动配置，但网络请求只能发起一次。
export const loadAppConfig = onceAsync(async () => {
  const response = await fetch('/config')
  if (!response.ok) throw new Error(`config request failed: ${response.status}`)
  return response.json() as Promise<{ apiBaseUrl: string }>
})

const [routerConfig, telemetryConfig] = await Promise.all([loadAppConfig(), loadAppConfig()]) // 两处共享同一次请求
```

适合页面或进程生命周期内只应执行一次的异步初始化，例如加载不会刷新的启动配置、初始化共享 SDK 客户端、动态导入并编译同一份 WASM 模块。它同时解决“并发时别重复启动”和“完成后继续复用结果”两个问题。

不适合按 key 去重、定时刷新、失败重试、登出后重建、按租户或请求隔离。首次 rejection 会一直缓存，API 没有 reset；若底层任务使用某个调用者的 `AbortSignal`，该调用者取消任务也会影响所有共享 Promise 的等待者。此类需求应交给带失效策略的缓存或生命周期容器。

每次调用 `onceAsync(fn)` 都会创建独立缓存；模块被重复实例化，或代码分布在 iframe、Worker、Node `vm` 时不会共享，因此它也不是跨 realm 的全局任务协调器。

---

<a id="collector"></a>

## Collector

Collector 是包根入口提供的、数组专用的惰性查询流水线：

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
// 内部组合类型，不是公开导出；使用者导入 ICollector 或 IFieldCollector。
type ICollectorActions<T, Self> = {
  readonly result: readonly T[]
  fieldBy<const P extends readonly [IObjectPathInput<T>, ...IObjectPathInput<T>[]]>(
    ...paths: P
  ): IFieldCollector<T, P[number]>
  where(predicate: (source: T) => boolean): Self
  distinctBy<P extends IObjectPathInput<T>>(path: P): Self
  skip(count: number): Self
  take(count: number): Self
}

interface ICollector<T> extends ICollectorActions<T, ICollector<T>> {}

interface IFieldCollector<T, P extends IObjectPathInput<T>> extends ICollectorActions<
  T,
  IFieldCollector<T, P>
> {
  like(query: string): IFieldCollector<T, P>
  equals(value: IObjectPathValue<T, P>): IFieldCollector<T, P>
  oneOf(value: IObjectPathValue<T, P>, ...values: IObjectPathValue<T, P>[]): IFieldCollector<T, P>
}

function collect<T>(dataSource: readonly T[]): ICollector<T>
```

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
const collector = collect(users)
  .fieldBy('profile.name-zh', 'profile.name-en')
  .like(' World ')
  .distinctBy('id')
  .skip(10)
  .take(20)

const result = collector.result
```

执行与缓存：

- `collect` 借用原 `readonly` 数组且不复制；无动作或全部 source 通过时，`result` 直接复用原数组。
- 每个动作立即写入有序语义流水线，但不会扫描 source；首次读取 `result` 时单次遍历并缓存。同 revision 重复读取返回同一引用，新增有效动作后缓存失效。
- 动作顺序可观察：`take(2).where(predicate)` 与 `where(predicate).take(2)` 不等价。连续链式调用不会生成每步中间数组。
- 求值失败不缓存；getter、Proxy 与 `where` 抛出的错误保持原始身份。求值回调中重读或修改同一 collector 会抛 `REENTRANT_CALL`。

字段动作：

- `fieldBy` 立即解析路径，并加入“任一字段值非 `undefined`”过滤；missing、blocked 和显式 `undefined` 统一视为无有效值。重复调用会保留前一个过滤动作，同时替换后续字段谓词的活动字段域。
- `like` 对 query 执行 `trim().toLowerCase()`；trim 后为空是 no-op。只对字符串字段进行忽略大小写的连续子串匹配，多个字段使用 OR。
- `equals` 与 `oneOf` 使用 `Object.is`；多个字段使用 OR，多个动作按顺序组成 AND。`oneOf` 固定线性扫描候选值，不按数据量升级为索引。
- `distinctBy` 只去重已定义 key，保留第一次出现；missing、blocked、显式 `undefined` 均不参与去重。
- `where` 只接收 source，不注入 index。`skip`/`take` 只接受非负安全整数，否则抛出带 `INVALID_ARGUMENT` 的原生 `RangeError`。

输入数组和嵌套 source 由调用方维持只读。Collector 不监听外部 mutation；外部绕过类型修改数据后，已缓存 revision 不会自动失效。

---

<a id="组合工作流示例"></a>

## 组合工作流示例：截止时间 + 配置

> 该组合用于本仓测试验证，不是外部生产代码示例。外部测试应优先使用测试框架的 fake timers。

```ts
import { retry, withTimeout } from '@migaia/utils/promise'
import { createManualScheduler } from '@migaia/utils/testing'
import { CONFIG_DELETE, ownConfig, patchConfig, readonlyConfig } from '@migaia/utils/config'

const scheduler = createManualScheduler()
const initial = ownConfig({ endpoint: '/v1', retries: 2, debug: true })
const next = patchConfig(initial, { debug: CONFIG_DELETE })
const publicConfig = readonlyConfig(next)

const request = withTimeout(
  ({ signal }) =>
    retry(
      async () => {
        if (signal.aborted) throw signal.reason
        return publicConfig.endpoint
      },
      { maxAttempts: publicConfig.retries, shouldRetry: () => true, scheduler }
    ),
  { timeoutMs: 100, scheduler }
)

scheduler.advance(100)
await request.catch(() => undefined)
```

`createManualScheduler()` 让时间变为确定性，便于在单测中精确断言超时/重试行为。超时中止是协作式的：`retry`/业务代码必须读取传入的 `signal` 才能提前退出。`ownConfig` 拷贝并登记入参；`readonlyConfig` 返回带缓存、只能读取不能修改的对象；`patchConfig` 返回一份新的受管理配置，`CONFIG_DELETE` 只在根一层的补丁里生效。

### 并发限流 + 重试 + 错误合并：批量拉取，容忍部分失败

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
import { createConcurrencyLimiter, retry } from '@migaia/utils/promise'
import { combineErrors } from '@migaia/utils/error'

const limiter = createConcurrencyLimiter({ concurrency: 4 })
const outcomes = await Promise.allSettled(
  urls.map((url) =>
    limiter.run(() =>
      retry(({ signal }) => fetch(url, { signal }).then((r) => r.json()), {
        maxAttempts: 3,
        shouldRetry: () => true
      })
    )
  )
)
await limiter.dispose()

const failed = combineErrors(
  outcomes.filter((o) => o.status === 'rejected').map((o) => (o as PromiseRejectedResult).reason),
  'some URLs failed'
)
if (failed) throw failed
```

`combineErrors` 在没有失败时返回 `undefined`，只有一个失败时返回它本身，多个失败时合并成 `AggregateError`。

### 对象路径 + 配置：把修改后的嵌套结构整体写回配置根

```ts
import { get, set } from '@migaia/utils/object'
import { ownConfig, patchConfig } from '@migaia/utils/config'

const config = ownConfig({ server: { host: 'localhost', port: 8080 } })
// patchConfig 只在根一层生效：嵌套修改先用 set() 算出新的子树，再整体放进补丁
const nextServer = set(get(config, 'server')!, 'port', 9090)
const next = patchConfig(config, { server: nextServer })
```

### 一次性初始化 + 错误身份：让初始化失败带上可识别的 code

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
import { once } from '@migaia/utils/function'
import { attachErrorIdentity } from '@migaia/utils/error'

const initOnce = once(() => {
  try {
    return dangerousInit()
  } catch (error) {
    throw attachErrorIdentity(error as Error, { source: 'my-package', code: 'INIT_FAILED' })
  }
})
```

`once` 会记住第一次抛出的错误，之后的调用都会抛出同一个错误对象，不会重新初始化。

---

## 识别服务端运行时

```ts doc-test=run
import { detectServerRuntime } from '@migaia/utils'

console.log(detectServerRuntime()) // Node 中为 'node'
```

`detectServerRuntime(): 'deno' | 'bun' | 'node' | undefined` 先检查 `globalThis.Deno`，再检查 `process.versions.bun`，最后检查 `process.versions.node`。Deno 和 Bun 提供的 Node 兼容全局不会抢先匹配。浏览器返回 `undefined`。函数不导入文件系统或其它宿主 API；原生适配器根据结果只加载自己的运行时模块。

## `/value`、`/string`、`/number` 高频工具

`jitter(value, ratio, random = Math.random)` 从 `@migaia/utils/number` 或根入口导出，返回 `[value * (1 - ratio), value]` 内的值，只缩短期限。`value` 必须有限且非负，`ratio` 与随机结果必须在闭区间 `[0, 1]`。无效输入抛出带 `@migaia/utils` / `INVALID_ARGUMENT` 的 `RangeError`；随机回调抛错时同样以该错误拒绝，原错保留在 `cause`。参数有效后每次只调用一次随机源，包括 `value` 或 `ratio` 为零时。

```ts doc-test=run
import { jitter } from '@migaia/utils/number'

console.log(jitter(60_000, 0.2, () => 0.5)) // 54000，永不超过原来的 60000
```

`isSafeIntegerValue(value)` 从 `/value` 导出，仅接受有限的安全整数 number，不转换字符串、bigint 或 boxed number。

`tryString(value)` 从 `/string` 导出，string 原样通过，其他值只执行一次原生 `String(value)`。它返回 `{ threw: false, value: string }` 或 `{ threw: true, error: unknown }`；失败保留精确原抛出值，不提供 fallback、不调用 reporter、不生成新错误。调用方根据自己的边界选择报告、fallback 或重抛：

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
import { tryString } from '@migaia/utils/string'

const converted = tryString(value)
if (converted.threw) throw converted.error
const text = converted.value
```

`isNullish` 只识别 `null | undefined`；`isBlankString` 只识别 trim 后为空的字符串。`isEmptyValue` 组合两者并额外把 `NaN` 判为空；`0`、`0n`、`false`、数组和对象保持有效。`isPrimitive` 覆盖 JavaScript 七类 primitive，不生成额外类型标签。

`format(source, values, options?)` 使用线性扫描替换 `{path}`，嵌套路径只读取 own property；缺失值默认保留占位符。`options.placeholder` 可配置 `{ open, close }`，`missing` 可选 `preserve | empty | throw`，`nullish` 可选 `empty | stringify`。双写边界字符用于输出字面量边界。

`formatNumber`、`formatCurrency`、`formatPercent`、`formatInteger`、`formatCompactNumber` 共享一个 64 项有界 `Intl.NumberFormat` 缓存。高频表格、行情或库存循环使用 `createNumberFormatter(options)`，避免每项重复解析配置。所有 locale、币种、精度和舍入规则由调用方显式拥有。

```ts
import { format, formatCurrency, isEmptyValue, isPrimitive } from '@migaia/utils'

isEmptyValue('  ') // true；0、false、0n 均为 false
isPrimitive(Symbol('id')) // true
format('库存 {stock}，金额 {money}', { stock: 0, money: '¥12.00' })
formatCurrency(1234.5, 'CNY', {
  locales: 'zh-CN',
  format: { minimumFractionDigits: 2, maximumFractionDigits: 2 }
})
```

---

<a id="排查与构建门禁"></a>

## 排查与构建门禁

- **超时没能真正打断 I/O**：符合预期——协作式取消要求操作函数自己读取并响应传入的 `signal`；把 `signal` 透传给底层 I/O（例如 `fetch(url, { signal })`）并让其遵守中止。
- **`base64ToBytes` 拒绝了输入**：把产出方规范化为标准补齐的 RFC 4648 文本；URL-safe（`-`/`_`）或无补齐的变体不被接受，需要先转换成标准形式。
- **写只读配置抛错**：这是刻意的行为——`readonlyConfig` 就是用来防止意外修改的；需要变更时对原来的 owned config 调用 `patchConfig`，而不是修改只读对象。
- **`once` 报重入错误**：说明首次调用尚未返回时，函数体内部又调用了同一个被包装的函数；把递归逻辑挪到包装函数之外，或改用普通函数自身递归。
- **需要"当前值订阅/重放"或资源释放生命周期**：`@migaia/utils` 不提供响应式状态或资源所有权模型，应使用专门的响应式/生命周期管理包，而不是在这里找替代品。
- **`ownConfig`/`patchConfig` 抛 `CONFIG_LIMIT_EXCEEDED`**：说明配置图的深度/节点数/键数超过了限制；确认是否存在非预期的深层嵌套或循环膨胀，必要时收紧 `limits` 或缩小数据；包级默认上限不能放宽。

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```

### 跨 realm Error 识别

`isNativeErrorValue(value)` 从 `@migaia/utils/error`（或 root）导入。它识别 Error-family 的 prototype chain，帮助边界保留原 Error identity；不会调用输入的方法，无法检查的 proxy 返回 false。它只是诊断形状检查，不能用于认证不可信输入。

```ts
import { isNativeErrorValue } from '@migaia/utils/error'

const failure: unknown = new TypeError('invalid input')
if (isNativeErrorValue(failure)) console.log(failure.stack)
```

### `deferTask` 与调度器可选的 `defer`

`IScheduler` 可以额外提供 `defer(callback): void`，用来安排“当前调用结束后再执行”的任务，它和可取消的定时任务是两回事。`deferTask(clock, callback)` 优先使用调度器的 `defer`；调度器没有提供时，退回 `schedule(callback, 0)`。根入口和 `/scheduler` 子路径导出的是同一个函数。`systemScheduler` 的 `defer` 使用原生微任务，保持微任务的先后顺序；自定义调度器自己决定何时执行。回调返回的 Promise 由调用方负责；登记失败时抛出的错误保持原样。这个 API 不创建新的队列，也不返回取消句柄。

回调或方法不是函数时，抛出带 `@migaia/utils` / `INVALID_ARGUMENT` 的原生 `TypeError`；读取 `defer` 方法本身失败时，原错误放在 `cause` 上。使用默认的 `systemScheduler` 而宿主缺少 `queueMicrotask` 时抛 `ENV_UNSUPPORTED`；显式传入的手动时钟或宿主时钟不依赖这个全局函数。用展开语法复制 `systemScheduler` 时也会复制它的 `defer`：如果要改变延后任务的执行方式，记得同时覆盖 `defer`。

```ts
import { deferTask } from '@migaia/utils/scheduler'
import { createManualScheduler } from '@migaia/utils/testing'

const clock = createManualScheduler()
let delivered = false
deferTask(clock, () => {
  delivered = true
})
console.log(delivered) // false
clock.advance(0)
console.log(delivered) // true
```

UTF-8 的 fatal 解码失败使用 INVALID_ENCODING，并在 message 中标明 UTF-8 与字节偏移；Base64 失败仍标明 Base64。

## 公开入口索引

下表逐个列出公开名称。具体参数、错误与生命周期约束见前面各模块的说明；类型工具也列出了用途。URL 工具只读取结构，不校验 URL 是否合法或安全。

| 名称 | 规范入口 | 用途与约束 |
| --- | --- | --- |
| `CONFIG_DELETE` | `@migaia/utils/config` | 根级补丁或合并冲突决策里的删除标记；不会递归作用到嵌套补丁。 |
| `ConfigProfile` | `@migaia/utils/config` | `data` 与 `richRuntime` 两种配置输入范围的常量。 |
| `IAbortOperation` | `@migaia/utils/promise` | 接收本包生成的 signal、返回值或 PromiseLike 的惰性操作。 |
| `IAbortSignal` | `@migaia/utils/promise` | 不依赖 DOM 或 Node 的结构化 signal：`aborted`、`reason` 和 abort 监听方法。 |
| `IAbortSignalAdmission` | `@migaia/utils/promise` | `admitAbortSignal` 读取一次 signal 形状的结果；错误和中止的处理策略由调用方决定。 |
| `IAbortSignalRejection` | `@migaia/utils/promise` | 拒绝一个不可信的、形似 abort signal 的值时给出的稳定原因，不抛错。 |
| `IAbortTimeoutSignal` | `@migaia/utils/promise` | 合并后的 signal 与幂等的 `dispose`；既没有外部 signal 也没有时限时，`signal` 可能是 `undefined`。 |
| `IAbortTimeoutSignalOptions` | `@migaia/utils/promise` | 外部 `signal`、`timeoutMs`、`scheduler`、`timeoutReason`、`report` 的输入选项。 |
| `IAsyncControls` | `@migaia/utils/promise` | 异步等待共用的 `signal` / `signals`、`scheduler` 与 `unref` 选项；`signal` 和 `signals` 互斥。 |
| `ICollector` | `@migaia/utils` | 还没调用 `fieldBy` 的 Collector；按字段筛选的方法要在 `fieldBy` 之后才可用。 |
| `IConcurrencyLimiter` | `@migaia/utils/promise` | 先进先出的并发限制器：`run`、`close`、`whenIdle`、`dispose` 以及运行中和排队中的数量。 |
| `IConfigCombineOptions` | `@migaia/utils/config` | 按 profile、limits、合并策略、路径规则和冲突回调组合已拥有的配置。 |
| `IConfigConflictContext` | `@migaia/utils/config` | 冲突发生的路径以及左右两侧的值。 |
| `IConfigConflictDecision` | `@migaia/utils/config` | 选择 `left`、`right`、`delete` 或一个替换值；回调必须同步返回，不能返回 thenable。 |
| `IConfigLimits` | `@migaia/utils/config` | 配置图的深度、节点数、键数以及路径和分段长度上限；只能比包级上限更严。 |
| `IConfigMergeStrategies` | `@migaia/utils/config` | `record`、`array`、`map`、`set` 与 `undefined` 的合并策略。 |
| `IConfigPatch` | `@migaia/utils/config` | 根字段的部分补丁；`CONFIG_DELETE` 表示删除该根字段。 |
| `IConfigPatchOptions` | `@migaia/utils/config` | `ownConfig` 的 profile / limits，加上控制空补丁是否复用原根对象的 `reuseUnchangedRoot`。 |
| `IConfigPathRule` | `@migaia/utils/config` | 按路径前缀选择局部合并策略。 |
| `IConfigProfile` | `@migaia/utils/config` | `data` 或 `richRuntime` 输入范围；后者允许配置里带函数。 |
| `IConfigReadResult` | `@migaia/utils/config` | 区分 `missing`（键不存在）与 `value`（值可以是 `undefined`）的路径读取结果。 |
| `IConfigRecord` | `@migaia/utils/config` | 以字符串为键的配置根对象类型。 |
| `IDeadlineOnlyOperation` | `@migaia/utils/promise` | `cooperativeCancellation` 可能为 `false` 时 `withTimeout` 接受的操作；它收到的是永不中止的结构化 signal，而不是宿主 `AbortSignal`。 |
| `IDeferred` | `@migaia/utils/promise` | 原生 Promise 加上对应的 `resolve` / `reject`；由调用方决定何时结算。 |
| `IDiagnosticSnapshot` | `@migaia/utils/object` | 隔离后的 `value` 加逐路径的 `diagnostics`；不能假设所有不支持的叶子都已复制。 |
| `IDiscriminatedByField` | `@migaia/utils/typing` | 按一个顶层、值为属性键的判别字段，把联合类型分组。 |
| `IDiscriminatedByPath` | `@migaia/utils/typing` | 按一条有类型的字符串或元组对象路径，把联合类型分组。 |
| `IErrorChainData` | `@migaia/utils/error` | 错误链边界和结构化克隆都接受的、有限的普通 JSON 数据。 |
| `IErrorChainStrategy` | `@migaia/utils/error` | 错误链序列化的策略：字段、隐私、预算、可移植数据和原生错误还原。 |
| `IErrorIdentity` | `@migaia/utils/error` | `source` / `code` 两个字段，可附带 `phase` 和 `detail`；含义由各包自己定义。 |
| `IErrorIdentityHooks` | `@migaia/utils/error` | 身份字段冲突或写入失败时的可选恢复策略，必须让原错误仍然可以找到。 |
| `IFieldCollector` | `@migaia/utils` | 调用 `fieldBy` 之后的 Collector；值的类型由最近一次 `fieldBy` 推导。 |
| `IFormatOptions` | `@migaia/utils/string` | 模板格式化策略；默认保留缺失的占位符，把 `null` / `undefined` 输出为空。 |
| `IFormatPlaceholder` | `@migaia/utils/string` | 线性模板扫描使用的占位符边界字符。 |
| `IManualScheduler` | `@migaia/utils/testing` | 测试用的虚拟时钟，提供 `advance` 和 `pendingCount`；只能从 `/testing` 导入。 |
| `INativeAbortSignal` | `@migaia/utils/promise` | 本包用真实 `AbortController` 创建并交给操作的 signal 类型；有宿主类型时就是 `AbortSignal`，可以直接传给 `fetch`。 |
| `INumberFormatOptions` | `@migaia/utils/number` | 所有数字格式化工具共用的 locale 与 `Intl` 选项。 |
| `INumberFormatter` | `@migaia/utils/number` | 可复用的格式化函数，适合库存表、行情等高频循环。 |
| `INumericValue` | `@migaia/utils/number` | 格式化函数接受的数值：`number` 或 `bigint`，不接受字符串。 |
| `IObjectPath` | `@migaia/utils/object` | 有类型的点号 / 方括号字符串路径，最深 8 层，以限制编译器的工作量。 |
| `IObjectPathInput` | `@migaia/utils/object` | 某个根类型所有静态合法的字符串路径和元组路径。 |
| `IObjectPathSegment` | `@migaia/utils/object` | 路径元组里的字符串、数字或 symbol 键。 |
| `IObjectPathTuple` | `@migaia/utils/object` | 由字符串、数字或 symbol 组成的只读路径分段数组。 |
| `IObjectPathTupleFor` | `@migaia/utils/object` | 有类型的只读元组路径，支持数字下标和 symbol 键。 |
| `IObjectPathValue` | `@migaia/utils/object` | 字符串或元组路径指向的值类型。 |
| `IObjectPathWriteValue` | `@migaia/utils/object` | 向该路径写入时接受的类型；字面量类型会放宽为基础类型。 |
| `IOwnConfigOptions` | `@migaia/utils/config` | 选择 `data` / `richRuntime` profile，并收紧配置资源上限。 |
| `IOwnDescriptorsSnapshot` | `@migaia/utils/object` | 在对象边界上一次性、不抛错地捕获自有属性描述符的结果。 |
| `IOwnedConfig` | `@migaia/utils/config` | 经 `ownConfig` 接收并登记所有权的配置类型；仅有这个类型标记的伪造对象不会被接受。 |
| `IPathAccessor` | `@migaia/utils/object` | 持有当前不可变根对象，提供 `get` / `set`、`probeValue` 与 `parsePath`。 |
| `IPathAccessorOptions` | `@migaia/utils/object` | 路径缺失、被阻塞、读取失败时的回调，以及读写时的转换回调。 |
| `IPathBlockedProbe` | `@migaia/utils/object` | 路径被非对象的中间值挡住；记录失败的分段和 `parent`。 |
| `IPathFailedProbe` | `@migaia/utils/object` | 读取成员时抛错；保留原始 `error` 和失败位置。 |
| `IPathGetEvent` | `@migaia/utils/object` | 读取转换事件：原路径、解析后的分段、读取结果和 `replace`。 |
| `IPathMissingProbe` | `@migaia/utils/object` | 路径上的成员不存在；记录失败的分段和已解析的前缀。 |
| `IPathProbe` | `@migaia/utils/object` | 路径探测结果：`value` / `missing` / `blocked` / `failed`。 |
| `IPathSetEvent` | `@migaia/utils/object` | 写入转换事件：待写入的新值、探测结果和 `replace`。 |
| `IPathValueProbe` | `@migaia/utils/object` | 读取成功：路径、分段和按路径推导出的值。 |
| `IPrimitive` | `@migaia/utils/value` | `string`、`number`、`boolean`、`bigint`、`symbol`、`null` 或 `undefined`。 |
| `IProbePropertyResult` | `@migaia/utils/object` | 属性 `missing` / `value` / `failed` 的结果；`has` / `get` 陷阱抛错也作为数据返回。 |
| `IPropertyRead` | `@migaia/utils/error` | 一次属性读取的结果；读取抛错时保留 getter 抛出的原值。 |
| `IRetryContext` | `@migaia/utils/promise` | 当前尝试次数 `attempt`、这次尝试的原生 `signal`，以及可选的剩余时间 `remainingMs`。 |
| `IRetryFailureContext` | `@migaia/utils/promise` | `shouldRetry` / `delay` 收到的上下文，多了 `maxAttempts`；不保证有 `remainingMs`。 |
| `IScheduledTask` | `@migaia/utils/scheduler` | 一个已安排回调的句柄：`cancel()`，以及可选的 `unref()`。 |
| `IScheduler` | `@migaia/utils/scheduler` | 唯一的调度器契约：单调时钟 `now()`、`schedule()` 和可选的 `defer()`。 |
| `ISerializedErrorChain` | `@migaia/utils/error` | 冻结的错误树；扩展字段只有在调用方策略的白名单里才会保留。 |
| `ISnapshotDiagnostic` | `@migaia/utils/object` | 快照中访问器、读取失败或不支持成员的路径、原因与原始 `cause`。 |
| `IStringConversion` | `@migaia/utils/string` | 一次字符串转换的结果；失败时保留用户转换函数抛出的原值。 |
| `IThenableInspection` | `@migaia/utils/function` | 读取一次 `then` 的捕获结果；普通值返回空对象，读取失败保留 `error`。 |
| `IThenableProbe` | `@migaia/utils/function` | 一次 thenable 检查的结果，读取失败不会抛出。 |
| `ITimeoutOperation` | `@migaia/utils/promise` | 接收本包生成的原生 signal、返回值或 PromiseLike 的限时操作。 |
| `IUrlLike` | `@migaia/utils/typing` | 字符串形式的 URL，或带 `href` 的对象（例如 WHATWG `URL`）。 |
| `IUtilsErrorCode` | `@migaia/utils/error` | `UtilsErrorCode` 常量对象的取值联合，不是任意字符串。 |
| `IUtilsReporter` | `@migaia/utils/promise` | 迟到失败、清理失败和 reporter 自身失败的诊断回调；`operation` 说明来源。 |
| `IWallClock` | `@migaia/utils/scheduler` | 只用于诊断时间戳的墙钟。 |
| `MAX_NATIVE_RECURSION_DEPTH` | `@migaia/utils/function` | 同步重入的最大深度；超过后调用方应把工作移出原生调用栈。 |
| `ThenableProbeKind` | `@migaia/utils/function` | 一次 `.then` 读取的稳定结果种类。 |
| `UtilsAbortError` | `@migaia/utils/promise` | 表示协作式取消的错误，代码 `ABORTED`，原始取消原因在 `cause` 上。 |
| `UtilsError` | `@migaia/utils/error` | 本包语义错误的基类，带 `source: 'foundation.utils'` 和稳定的 `code`。 |
| `UtilsErrorCode` | `@migaia/utils/error` | 本包对外抛出的稳定错误码。 |
| `UtilsTimeoutError` | `@migaia/utils/error` | 表示操作、单次尝试或总时限超时的错误，代码 `DEADLINE_EXCEEDED`。 |
| `admitAbortSignal` | `@migaia/utils/promise` | 只读取一次 `aborted` 来接纳 signal 形状，不读取 `reason`，也不订阅。 |
| `assimilateCapturedThen` | `@migaia/utils/function` | 用原 thenable 作为接收者，调用一次已经读取到的 `then` 方法。 |
| `attachErrorIdentity` | `@migaia/utils/error` | 给原错误附加稳定身份字段，不替换错误对象。 |
| `attachSecondaryErrors` | `@migaia/utils/error` | 把次要失败追加到主错误上，不改变主错误的身份。 |
| `base64ToBytes` | `@migaia/utils/bytes` | 解码规范的 RFC 4648 Base64；非规范输入抛 `INVALID_ENCODING`。 |
| `bytesToBase64` | `@migaia/utils/bytes` | 用标准 RFC 4648 字母表把字节编码为带补齐的 Base64。 |
| `collect` | `@migaia/utils` | 在借用的只读数组上创建惰性 Collector。 |
| `combineConfig` | `@migaia/utils/config` | 按来源顺序合并已拥有的配置，冲突按显式策略处理。 |
| `combineErrors` | `@migaia/utils/error` | 合并 0 个、1 个或多个错误；遍历本身失败时也一并保留。 |
| `createAbortTimeoutSignal` | `@migaia/utils/promise` | 把外部取消与时限合并成一个 signal，不接管任何 Promise 的结算。 |
| `createConcurrencyLimiter` | `@migaia/utils/promise` | 限制同时运行的任务数，先进先出排队，排队中的任务可以取消。 |
| `createManualScheduler` | `@migaia/utils/testing` | 创建从 `0` 开始的虚拟时钟调度器，用于确定性测试。 |
| `createNumberFormatter` | `@migaia/utils/number` | 创建可复用的格式化函数，高频循环只解析一次选项。 |
| `createPathAccessor` | `@migaia/utils/object` | 创建路径访问器；每次成功 `set` 后，当前根对象前进到新根。 |
| `createSafeRecord` | `@migaia/utils/object` | 创建原型为 `null` 的新字典，不可信的键名不会触发原型上的 setter。 |
| `decodeUtf8` | `@migaia/utils/bytes` | 解码 UTF-8；默认用 U+FFFD 替换非法字节，`fatal: true` 时抛错。 |
| `deferTask` | `@migaia/utils/scheduler` | 通过调度器安排一个在当前调用结束后执行的任务。 |
| `deferred` | `@migaia/utils/promise` | 创建可以从外部结算的原生 Promise；新代码优先用 `Promise.withResolvers()`。 |
| `deserializeErrorChain` | `@migaia/utils/error` | 先完整校验不可信的错误树，再重建原生错误图。 |
| `detectServerRuntime` | `@migaia/utils` | 依次识别 Deno、Bun、Node；没有服务端全局的浏览器返回 `undefined`。 |
| `diagnosticSnapshot` | `@migaia/utils/object` | 尽力复制一个值，并给出明确的诊断列表。 |
| `encodeUtf8` | `@migaia/utils/bytes` | 把字符串编码为新的 UTF-8 字节数组。 |
| `format` | `@migaia/utils/string` | 一次线性扫描替换模板中的占位符路径。 |
| `formatCompactNumber` | `@migaia/utils/number` | 用紧凑记法格式化大数值，精度由调用方决定。 |
| `formatCurrency` | `@migaia/utils/number` | 格式化金额；币种和舍入规则由调用方指定。 |
| `formatInteger` | `@migaia/utils/number` | 格式化整数（例如库存数量）；可以显式覆盖小数策略。 |
| `formatNumber` | `@migaia/utils/number` | 用显式的 `Intl` 选项格式化 `number` 或 `bigint`，复用缓存的格式化器。 |
| `formatPercent` | `@migaia/utils/number` | 把比例格式化为百分比，精度可配置。 |
| `get` | `@migaia/utils/object` | 按路径读取；路径缺失或被阻塞时返回 `undefined`，getter 抛错时照常抛出。 |
| `hostRethrowReporter` | `@migaia/utils/promise` | 默认 reporter：在微任务里把错误重新抛给宿主，不制造未处理的 Promise 拒绝。 |
| `identitySnapshot` | `@migaia/utils/object` | 原样返回输入，用来明确表示接受共享引用。 |
| `immutableSnapshot` | `@migaia/utils/object` | 用 `structuredClone` 生成与源对象不共享引用的数据快照。 |
| `inspectThenable` | `@migaia/utils/function` | 读取一次回调结果的 `then`，用于检查同步契约。 |
| `isArrayBuffer` | `@migaia/utils/bytes` | 跨 realm 识别真正的 `ArrayBuffer`（包括已 detached 的），拒绝 `SharedArrayBuffer`、Proxy 和伪造对象。 |
| `isBlankString` | `@migaia/utils/value` | 判断空字符串或只有空白的字符串，不转换其他类型。 |
| `isEmptyValue` | `@migaia/utils/value` | 判断表单意义上的“空”：`null`、`undefined`、空白字符串和 `NaN`；`0`、`0n`、`false` 不算空。 |
| `isNativeErrorValue` | `@migaia/utils/error` | 跨 realm 识别原生 Error 家族的原型链，用于保留原错误；只做诊断，不做认证。 |
| `isNullish` | `@migaia/utils/value` | 只识别 `null` 和 `undefined`，不把其他假值当作缺失。 |
| `isPlainObject` | `@migaia/utils/object` | 只接受普通对象或原型为 `null` 的对象，不接受数组。 |
| `isPrimitive` | `@migaia/utils/value` | 识别 JavaScript 的全部原始类型。 |
| `isSafeIntegerValue` | `@migaia/utils/value` | 只接受有限的安全整数 `number`，不转换字符串或包装对象。 |
| `isUint8Array` | `@migaia/utils/bytes` | 跨 realm 识别真正的 `Uint8Array` 及其子类，不信任可篡改的原型、构造函数名或 `Symbol.toStringTag`。 |
| `isUrlObject` | `@migaia/utils` | 判断 `IUrlLike` 的对象形式：非空对象且 `href` 是字符串。 |
| `isUtilsAbortError` | `@migaia/utils/error` | 先确认是本包的错误形状和身份，再检查代码是否为 `ABORTED`。 |
| `isUtilsError` | `@migaia/utils/error` | 只有两个身份字段都有效时，才认定为本包的错误形状。 |
| `isUtilsTimeoutError` | `@migaia/utils/error` | 先确认是本包的错误形状和身份，再检查代码是否为 `DEADLINE_EXCEEDED`。 |
| `jitter` | `@migaia/utils/number` | 将有限非负值随机缩短至 `[value * (1 - ratio), value]`；非法输入使用 `INVALID_ARGUMENT`。 |
| `noop` | `@migaia/utils/function` | 恒返回 `undefined` 的空函数，用作默认回调。 |
| `normalizeSerializedErrorChain` | `@migaia/utils/error` | 接收方使用之前，先校验并冻结一份新的线上错误树。 |
| `observeThenableRejection` | `@migaia/utils/function` | 观察已捕获 thenable 的拒绝，并在边界上隔离 reporter 自身的失败。 |
| `once` | `@migaia/utils/function` | 记住同步函数的第一次结果，包括第一次抛出的错误。 |
| `onceAsync` | `@migaia/utils/function` | 记住第一次异步调用的 Promise，之后的调用拿到同一个 Promise。 |
| `ownConfig` | `@migaia/utils/config` | 校验并复制配置，得到一份登记了所有权的独立配置。 |
| `parseConfigPath` | `@migaia/utils/config` | 在对象路径解析之上加配置的长度限制，并要求所有分段都是字符串。 |
| `parseObjectPath` | `@migaia/utils/object` | 解析严格的 `a.b.[0].c` 写法，或复制并冻结一个元组路径。 |
| `patchConfig` | `@migaia/utils/config` | 对根层做写时复制的覆盖，生成新配置。 |
| `probeObjectPath` | `@migaia/utils/object` | 解析并探测一条路径，一步完成。 |
| `probeObjectPathSegments` | `@migaia/utils/object` | 探测已经解析好的元组路径，不再重新解析。 |
| `probeProperty` | `@migaia/utils/object` | 只读取一次属性，并把 getter 失败作为明确的结果返回。 |
| `probeThenable` | `@migaia/utils/function` | 只读取一次 `value.then`，并返回明确的结果种类。 |
| `raceWithAbort` | `@migaia/utils/promise` | 让惰性操作与一个或多个外部取消信号赛跑，不创建计时器。 |
| `reachErrorChain` | `@migaia/utils/error` | 按身份去重，遍历 `cause` 与 `AggregateError` 的子错误，受策略的对象预算限制。 |
| `readConfigPath` | `@migaia/utils/config` | 读取配置路径，区分键不存在和值为 `undefined`。 |
| `readUrlHref` | `@migaia/utils` | 返回 URL 值的文本形式：字符串本身，或对象的 `href`。 |
| `readonlyConfig` | `@migaia/utils/config` | 返回带缓存的只读视图，任何写入都会抛 `CONFIG_READONLY`。 |
| `retry` | `@migaia/utils/promise` | 按 `shouldRetry` 串行重试，支持退避、单次限时和总时限。 |
| `safeErrorReason` | `@migaia/utils/error` | 读取一次任意失败的诊断原因；读取失败时返回调用方给的安全默认文本。 |
| `sanitizeErrorText` | `@migaia/utils/error` | 替换孤立代理项，并截取不超过字节上限的最长 UTF-8 前缀。 |
| `serializeErrorChain` | `@migaia/utils/error` | 把任意抛出值转换成有界、冻结、与语言无关的错误树。 |
| `set` | `@migaia/utils/object` | 不可变地写入路径：只复制路径上的对象，其余分支复用，缺失的容器自动创建。 |
| `sleep` | `@migaia/utils/promise` | 等待一段时间后完成；signal 中止时以 `UtilsAbortError` 拒绝。 |
| `snapshotOwnDescriptors` | `@migaia/utils/object` | 最多读取一次自有属性描述符，隔离已撤销 Proxy 或描述符陷阱的失败。 |
| `splitUtf8` | `@migaia/utils/bytes` | 按字节上限切分 UTF-8 文本，不切断任何码点。 |
| `streamBase64Chunks` | `@migaia/utils/bytes` | 按 `maxChunkBytes` 产生各自独立合法的 Base64 片段；片段宽度是不超过上限的 3 的倍数。 |
| `structuredDiagnosticSnapshot` | `@migaia/utils/object` | 先尝试 `structuredClone`，失败时退回尽力快照并给出诊断。 |
| `systemScheduler` | `@migaia/utils/scheduler` | 默认调度器：`performance.now()` 作为单调时钟，宿主 `setTimeout` / `clearTimeout` 作为计时器。 |
| `systemWallClock` | `@migaia/utils/scheduler` | 默认墙钟：`Date.now()` 的毫秒时间戳，只用于诊断。 |
| `toError` | `@migaia/utils/error` | 把任意抛出值转换为 `Error`，原值放在 `cause` 上。 |
| `toPromise` | `@migaia/utils/promise` | 立即执行一次同步计算，把返回值或同步异常统一成 Promise。 |
| `tryReadProperty` | `@migaia/utils/error` | 用原接收者读取一次属性；getter 抛错时把抛出值作为数据返回。 |
| `tryString` | `@migaia/utils/string` | 按原生 `String` 规则转换一次，字符串原样返回。 |
| `utf8ByteLength` | `@migaia/utils/bytes` | 计算 UTF-8 字节数，不分配缓冲区或迭代器。 |
| `walkErrorCauses` | `@migaia/utils/error` | 沿 `cause` 和 `AggregateError.errors` 展开错误链，按身份去重并限制深度。 |
| `withTimeout` | `@migaia/utils/promise` | 给惰性操作加截止时间；到点先取消操作收到的 signal，再以超时错误拒绝。 |

## 可选值

`IMaybe<T>` 区分 `{ some: true, value: T }` 与 `{ some: false }`，包括“存在但值为 undefined”。root 导出 `isSome`/`isNone` 用于类型收窄，`unwrapOr(m, fallback)` 接受同值域的缺省值，`mapMaybe(m, mapper)` 仅对存在值同步映射一次，`toUndefined(m)` 用于有意合并缺失与 undefined。None 原样复用且不调用 mapper；mapper 结果保留身份、不等待 Promise。typed 可选值不附加运行时验证。

mapper 失败保留原有带码错误；未编码且可写的原生 Error 在原实例附 utils INVALID_ARGUMENT，保留原生类型与 stack。身份冲突时原错位于包装 cause；附加身份失败时聚合原错首位、附加失败次位。非 Error 沿原 toError/NON_ERROR_VALUE 语义。

```ts
import { isSome, isNone, unwrapOr, mapMaybe, toUndefined, type IMaybe } from '@migaia/utils'
const present: IMaybe<number | undefined> = { some: true, value: undefined }
const missing: IMaybe<number> = { some: false }
const mapped = mapMaybe({ some: true, value: 3 }, (value) => value * 2)
console.log(isSome(present), isNone(missing))
console.log(unwrapOr(mapped, 0), toUndefined(missing))
// true true
// 6 undefined
```
| `detectServerRuntime` / `ServerRuntime`             | `@migaia/utils`           | 当前 Deno/Bun/Node 分类及对应常量/类型域。                                                                                          |
| `detectElectronProcessType` / `ElectronProcessType` | `@migaia/utils`           | 当前 Electron main/renderer/utility 角色及对应域。                                                                                  |
| `detectGlobalScope` / `GlobalScopeKind`             | `@migaia/utils`           | 服务端之外的真实浏览器全局作用域及对应域。                                                                                          |
