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
| 识别启动程序的服务端运行时 | `detectServerRuntime` | `@migaia/utils` |
| 分散缓存到期时间，且不延长原期限 | `jitter` | `@migaia/utils/number` |

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

### `/promise`：什么时候执行，什么时候共用 Promise

需要从外部完成一个 Promise 时，优先使用原生 API `Promise.withResolvers()`；`deferred()` 用于兼容旧运行时，或项目已经约定使用 `IDeferred` 的边界。

```ts doc-test=check
const { promise, resolve } = Promise.withResolvers<number>()
resolve(42)
console.log(await promise) // 42
```

`toPromise(run)` 在当前调用栈立即执行 `run`，把同步返回值或异常统一变成 Promise 的结果。若返回的是原生 Promise，就保留同一个 Promise。`Promise.resolve().then(run)` 则等到下一次 microtask（微任务）才执行，并创建新的链式 Promise。前者适合要求同步副作用立即生效的调用，后者适合主动延后工作；两者都能用 rejection 表达失败。

```ts doc-test=check
import { toPromise } from '@migaia/utils/promise'

/** 用现成 Promise 比较两种调用方式是否保留身份。 */
const pending = Promise.resolve(42)
/** 同步副作用必须在本次调用返回前生效。 */
const immediate = toPromise(() => {
  console.log('now')
  return pending
})
/** 主动延后工作，调用方得到另一条 Promise 链。 */
const later = Promise.resolve().then(() => {
  console.log('later')
  return pending
})
console.log(immediate === pending, later === pending) // true false
await later
// 依次输出 now、true false、later。
```

### `/scheduler`：间隔和日期使用不同的时钟

`systemScheduler` 用 `performance.now()` 计时；`now()` 的毫秒数单调不递减，也就是后一次读数不小于前一次，但不是 Unix 时间戳。注入调度器时，用同一个 `scheduler.now()` 计算期限、用 `scheduler.schedule()` 安排到期任务，避免两者使用不同的时间基准。

`systemWallClock.timestamp()` 返回 `Date.now()`，用于日志里的日期时间。不要把它与 `now()` 混用或参与截止时间比较。

`@migaia/utils/testing` 的 `createManualScheduler()` 是本仓测试专用的虚拟时钟，不面向外部业务代码。外部项目应优先使用测试框架提供的 fake timers；生产代码使用 `systemScheduler` 或注入满足同一契约的调度器。

### `/error`：按代码决定怎样处理失败

错误上的 `source` 表示来源，`code` 表示这个来源内的失败种类。`UtilsErrorCode` 的键与值如下；原生 `TypeError`、`RangeError` 等加码后仍保留原类型，不能只看消息文本。

- `invalidArgument` / `INVALID_ARGUMENT`：参数类型或范围不合法，修正参数后再调用。
- `nonErrorValue` / `NON_ERROR_VALUE`：`toError()` 包装了非错误的抛出值，原值在 `cause`。
- `envUnsupported` / `ENV_UNSUPPORTED`：宿主缺少必要能力，换用支持它的环境或注入实现。
- `aborted` / `ABORTED`：操作收到协作式取消，原取消原因在错误链上。
- `deadlineExceeded` / `DEADLINE_EXCEEDED`：操作、单次尝试或总流程超时；检查 `scope` 与 `timeoutMs` 再决定是否重试。
- `schedulerRunaway` / `SCHEDULER_RUNAWAY`：虚拟时钟一次推进执行超过 10000 个回调，检查同一时刻不断排入任务的循环。
- `errorIdentityConflict` / `ERROR_IDENTITY_CONFLICT`：已有身份与新字段冲突，保留原错误身份，由调用方选择冲突策略。
- `errorChainInvalid` / `ERROR_CHAIN_INVALID`：序列化错误树不符合字段、深度、数量或字节约束，修正边界输入。
- `cloneUnsupported` / `CLONE_UNSUPPORTED`：结构化克隆拒绝该值，先转换为可克隆数据。
- `invalidEncoding` / `INVALID_ENCODING`：字节或文本编码输入不合法，根据错误中的位置修正输入。
- `limiterClosed` / `LIMITER_CLOSED`：关闭后的并发限制器拒绝新任务，需要创建新限制器。
- `reentrantCall` / `REENTRANT_CALL`：不允许重入的操作在自身执行期间再次被调用，把嵌套调用移出当前执行过程。
- `configUnsupported` / `CONFIG_UNSUPPORTED`：配置的根、字段或值不在支持范围内，按所选配置档位提供数据。
- `configReadonly` / `CONFIG_READONLY`：尝试修改只读配置，改用补丁或合并生成下一份配置。
- `configConflict` / `CONFIG_CONFLICT`：配置来源、档位或所有权不一致，先统一来源约束。
- `configLimitExceeded` / `CONFIG_LIMIT_EXCEEDED`：配置图超过上限，或上限选项不合法，缩小输入并检查限制设置。
- `configPathInvalid` / `CONFIG_PATH_INVALID`：配置路径格式或键名不安全，修正路径。
- `configParseFailed` / `CONFIG_PARSE_FAILED`：`ConfigOwner.from()` 收到非字符串或非法 JSON，原解析错误保留在 `cause`。
- `configSourceFailed` / `CONFIG_SOURCE_FAILED`：`ConfigOwner.fromAsync()` 的来源失败，原拒绝保留在 `cause`，由调用方选择重试或默认配置。
- `configValueMissing` / `CONFIG_VALUE_MISSING`：`ConfigOwner.require()` 没找到路径值，补充配置或用 `getOr()` 明确提供默认值。
- `configValidationFailed` / `CONFIG_VALIDATION_FAILED`：校验器拒绝下一份配置，上一份保持不变，校验错误保留在 `cause`。
- `objectPathInvalid` / `OBJECT_PATH_INVALID`：对象路径或其中一段不合法，修正路径输入。
- `formatInvalid` / `FORMAT_INVALID`：模板语法或插值不合法，检查模板与值。
- `formatValueMissing` / `FORMAT_VALUE_MISSING`：严格模板模式缺少占位符的值，补充对应数据。
- `numberFormatInvalid` / `NUMBER_FORMAT_INVALID`：`Intl.NumberFormat` 拒绝地区、货币、选项或数值，修正格式化参数。

### `/bytes`：字节存在哪里，视图看到哪一段

`ArrayBuffer` 是原始连续内存，本身不能按下标读写；`Uint8Array` 是这块内存上的 8 位无符号整数视图，每个元素为 0～255。`new Uint8Array(buffer, byteOffset, length)` 中的 `byteOffset` 指起始字节，这种构造不会复制数据，多个视图可以读写同一底层 `ArrayBuffer`。

需要独立副本时用 `slice()`；需要共享窗口时用 `subarray()`。窗口里的写入会影响原数组，复制后的写入不会。`SharedArrayBuffer` 允许多个执行环境共享内存，并发语义不同，不能把它当作普通缓冲区的隔离副本。

```ts doc-test=check
const buffer = new ArrayBuffer(4)
const bytes = new Uint8Array(buffer)
bytes[1] = 42
/** 借用第二、第三个字节，让窗口写入影响原存储。 */
const shared = bytes.subarray(1, 3)
/** 保留修改窗口之前的数值，用来对照复制与共享。 */
const copied = shared.slice()
shared[0] = 7
console.log(bytes[1], copied[0], shared.byteOffset) // 7 42 1
```

### `/object`：把缺失、读取失败和复制策略分开

`probeProperty(value, key)` 的第一个参数 `value` 是要读取的对象，可以是普通对象、class 实例或其他可读属性的对象。它把字段不存在与读取字段失败分开：`missing` 可以采用业务默认值，`failed` 必须检查并处理原始错误；成功的 `value` 分支消费实际读到的值。判断结果不需要再访问一次字段，getter 只执行一次。

```ts doc-test=check
import { probeProperty } from '@migaia/utils/object'

/** failed 分支应报告这个原始错误，不能重新构造一个。 */
const profileUnavailable = new Error('profile unavailable')
/** 记录 getter 的访问次数，使读取副作用可见。 */
let profileReads = 0
/** 同时提供正常字段、缺失字段与抛错 getter 三类输入。 */
const user = {
  name: 'Ada',
  get profile(): never {
    profileReads += 1
    throw profileUnavailable
  }
}

/** 失败时报告原错误，缺失时才使用默认标签。 */
function readLabel(value: object, key: PropertyKey): string {
  /** 保存判别结果，后续分支不再读取输入字段。 */
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

console.log(readLabel(user, 'name')) // Ada：读取成功，消费 value
console.log(readLabel(user, 'email')) // Anonymous：字段不存在，走业务默认值
console.log(readLabel(user, 'profile')) // Unavailable：getter 异常被显式上报
console.log(profileReads) // 1：没有为了判断结果而重复触发 getter
```

`immutableSnapshot(value)` 调用宿主的 `globalThis.structuredClone()`，不经过 JSON 字符串。它保留循环引用与图内共享关系，支持 `Date`、`Map`、`Set`、`ArrayBuffer`、TypedArray 等原生可克隆类型；不会保留自定义 class 的原型方法、getter/setter 与属性描述符。这里没有传 transfer list，所以 `ArrayBuffer` 的内容会被复制，源缓冲区不会变成 detached（所有权被转移后不可用）的状态。

这个函数不调用 `Object.freeze()`，返回对象本身仍可修改。原生 `structuredClone(value)` 是整图全有或全无：任一成员不可克隆就失败。`immutableSnapshot(value)` 在宿主缺少该能力时抛 `ENV_UNSUPPORTED`，值不能克隆时抛 `CLONE_UNSUPPORTED`。

```ts doc-test=check
import { immutableSnapshot } from '@migaia/utils/object'

/** 让两个字段指向同一节点，展示图内别名的复制语义。 */
const shared = { count: 1 }
const source = { primary: shared, alias: shared, createdAt: new Date('2026-01-01T00:00:00Z') }
/** 后续只修改源对象，观察独立副本与内部共享关系。 */
const copy = immutableSnapshot(source)
source.primary.count = 2
console.log(copy.primary.count) // 1：源对象的修改没有写进副本
console.log(copy.primary === copy.alias) // true：共享引用关系被保留
console.log(copy.createdAt instanceof Date, Object.isFrozen(copy)) // true false
```

`diagnosticSnapshot(value)` 不先克隆整张对象图，而是逐个投影普通对象、数组和可克隆内置子树；遇到不支持的函数或实例会保留原引用，并在 `diagnostics` 记录位置与原因。`structuredDiagnosticSnapshot(value)` 先尝试原生 `structuredClone`，失败或宿主不支持时退回这种尽力复制，并保留降级诊断。两者用于日志等允许部分复制的场景；`diagnostics` 非空时，要检查哪些部分降级，不能把返回值宣称为完全隔离快照。

```ts doc-test=check
import { diagnosticSnapshot } from '@migaia/utils/object'

/** 不可克隆的叶值，用来展示诊断复制保留引用的分支。 */
const callback = () => 'ready'
const { value, diagnostics } = diagnosticSnapshot({ label: 'job', callback })
console.log(value.callback === callback) // true：不支持的函数保留原引用
console.log(diagnostics.length > 0) // true：调用方能发现这部分没有隔离
```

`identitySnapshot` 原样返回对象，单独调用它没有运行时收益。它用于可配置 snapshot policy（保存值时选择怎样复制的函数）的零拷贝分支，明确接受共享引用。只有可信进程内、身份敏感或不可克隆对象且允许共享所有权时才适用；外部输入隔离、保存历史状态或跨边界传输应选择 `immutableSnapshot`，并处理不可克隆的失败。

```ts doc-test=check
import { identitySnapshot } from '@migaia/utils/object'

/** 应用仍会修改的进程内设置，用来观察共享所有权。 */
const liveConfig = { retry: 2 }
/** 这个保存策略明确接受原引用及其后续变更。 */
const snapshotPolicy = identitySnapshot
/** 保存策略的结果，供后续读取以观察共享引用的影响。 */
const retained = snapshotPolicy(liveConfig)
liveConfig.retry = 3
console.log(retained.retry, retained === liveConfig) // 3 true：仍是同一对象
```

路径更新中的 immutable 指更新方式：`set()` 不会深拷贝整棵树，也不会调用 `Object.freeze()`。值真正变化时才返回新根；若新旧值用 `Object.is()` 比较相等，就直接返回原根对象。

```ts doc-test=check
import { set } from '@migaia/utils/object'

/** 把更新路径与未修改的兄弟分支放在同一棵树上。 */
const data = { user: { name: 'Ada' }, settings: { theme: 'dark' } }
/** 只改 user.name，以两个分支的身份显示复制范围。 */
const next = set(data, 'user.name', 'Grace')
console.log(next.user !== data.user) // true：路径上的对象被浅拷贝
console.log(next.settings === data.settings) // true：未修改分支继续共享引用
console.log(data.user.name, next.user.name) // Ada Grace
console.log(set(data, 'user.name', 'Ada') === data) // true：同值更新复用原根
```

### `/config`：先接纳配置，再公开读取和派生新配置

`ownConfig` 是接收外部配置的边界：复制输入并登记独立、可验证所有权。`WeakMap` 是不往配置上添加字段的元数据表，库用它保留 `profile` 与 `limits`；普通对象不能通过伪造字段变成已接纳的配置。默认 `data` 档位接纳数据，`richRuntime` 还允许回调或工厂。

```ts doc-test=check
import { ownConfig, patchConfig, readConfigPath, readonlyConfig } from '@migaia/utils/config'

/** 传入后仍由调用方继续修改的原配置。 */
const callerOptions = { retry: { attempts: 2 }, labels: new Set(['stable']) }
/** 接纳时隔离对象与集合，后续配置操作都以它为基准。 */
const config = ownConfig(callerOptions)
callerOptions.retry.attempts = 99
callerOptions.labels.add('changed')
console.log(config.retry.attempts, config.labels.has('changed')) // 2 false：Set 也已复制
/** 给读取方保留旧配置的只读访问。 */
const view = readonlyConfig(config)
/** 生成新的重试设置，旧配置的读取方继续使用原值。 */
const next = patchConfig(config, { retry: { attempts: 3 } })
/** 显式区分路径缺失与该路径存在但值为空的情况。 */
const result = readConfigPath(next, 'retry.attempts')
if (result.kind === 'value') console.log(result.value) // 3
console.log(view.retry.attempts) // 2：旧配置没有被改动
```

`ownConfig` 返回对象没有被冻结；获得所有权和公开只读访问是两件事。`readonlyConfig` 给已有配置套上只读保护，正常读取仍访问原数据，没有复制第二份配置，不允许调用方修改任何层级。`Map.set()`、`Set.add()`、`Date.setFullYear()` 等修改方法都会报错。公开读取用它，更新用 `patchConfig()` 生成下一份受管理配置，不是写 `view`；需要区分路径缺失与值为 `undefined` 时用 `readConfigPath`。补丁只作用于根字段，嵌套修改先算出新子树，再整体放入补丁。携带函数的 `richRuntime` 是运行时配置，不应当作可序列化数据。

`combineConfig` 按输入顺序合并，后面的来源覆盖前面；对象默认递归合并，数组默认替换。下面明确改用数组拼接，展示两个输入、结果与调用方自己整理的变化记录。

```ts doc-test=check
import { combineConfig, ownConfig } from '@migaia/utils/config'

/** 提供基础重试次数、标签及连接设置。 */
const defaults = ownConfig({
  retries: 1,
  tags: ['default'],
  transport: { timeoutMs: 1_000, keepAlive: true }
})
/** 只指定覆盖项，省略的连接设置仍从基础配置继承。 */
const override = ownConfig({
  retries: 3,
  tags: ['custom'],
  transport: { timeoutMs: 2_500 }
})
/** 用明确的对象合并与数组拼接规则生成新的配置根。 */
const merged = combineConfig([defaults, override], {
  strategies: { record: 'merge', array: 'concat' }
})
console.log(merged)
// { retries: 3, tags: ['default', 'custom'], transport: { timeoutMs: 2500, keepAlive: true } }
/** 调用方自己整理变化，不把合并结果误作变化报告。 */
const diff = { retries: { before: defaults.retries, after: merged.retries } }
console.log(diff) // { retries: { before: 1, after: 3 } }
```

`defaults` 与 `override` 没有被修改。这里的 `diff` 只是把结果变化写明，不是 `combineConfig` 的额外返回值。

### `/function`：一次初始化属于哪个实例

`once(fn)` 记住同步初始化的首次结果，首次抛出的错误也会一直保留。每调用一次 `once(fn)` 都会创建一份独立缓存；在模块顶层只创建并导出一个包装函数，才能让这个模块实例里的调用方共享它。

```ts doc-test=check
import { once } from '@migaia/utils/function'

/** 模块只导出这个包装函数，让所有导入方使用同一份缓存。 */
export const getRuntime = once(() => ({ registry: new Map([['help', 'Show help']]) }))
/** 首次读取创建当前模块的运行实例。 */
const first = getRuntime()
/** 后来的调用者复用实例，不再构造 registry。 */
const second = getRuntime()
console.log(first === second) // true：只创建了一份 registry
```

重复加载的模块以及 iframe、Worker、Node `vm` 等不同 realm（各自独立的全局执行环境）不共享这份缓存。它不会自动保证全局唯一；需要同一环境共享时，由应用入口或依赖注入容器持有实例。如果应用选择 `globalThis[Symbol.for('your-app/runtime')]` 这样的全局位置，还要自己管理版本、释放与测试清理。`Proxy` 可以把首次属性访问转成惰性初始化，但实例是否唯一仍由存放位置和创建它的所有者决定。`once` 不适合需要重试、重置、热更新或按请求隔离的初始化。

`onceAsync` 适合加载不会刷新的启动配置、初始化一个共享 SDK 客户端，或动态导入并编译同一份 WASM 模块。首次调用就保留 Promise，其他调用无论发生在执行中还是完成后都复用它。

```ts doc-test=check
import { onceAsync } from '@migaia/utils/function'

/** 共享不刷新的启动配置；直接返回数据使例子可以独立运行。 */
export const loadAppConfig = onceAsync(async () => ({ apiBaseUrl: '/api' }))
const [routerConfig, telemetryConfig] = await Promise.all([loadAppConfig(), loadAppConfig()])
console.log(routerConfig === telemetryConfig) // true：两处获得同一次初始化的结果
```

首次失败会一直缓存，没有 reset。需要失败重试时，把重试放进被包装的初始化函数；需要刷新、登出后重建或按租户或请求隔离时，应选有对应生命周期的容器。如果把某一个调用者的取消信号交给共享任务，该调用者取消后，其他等待者也会受影响。每个包装函数的缓存独立，模块重复实例化或跨 iframe、Worker、Node `vm` 时不会共享。

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
