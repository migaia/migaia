import type { ICaseDoc, IText } from './contract.js'

/** Builds one bilingual text. */
const t = (en: string, zh: string): IText => ({ en, zh })

/**
 * Problems the most-used utils APIs solve, each told as a situation, a runnable fix and the
 * observed output. Every example was run with Node 24 against the built package and its printed
 * output is quoted in `result`.
 */
export const utilsCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  mapMaybe: [
    {
      title: t('Distinguish absence from a present undefined', '区分缺失与存在的 undefined'),
      problem: t(
        'A query result can legitimately contain undefined. A discriminant preserves presence, and mapping must not run on missing values.',
        '查询结果可能合法地为 undefined；判别字段保留存在性，缺失时不能运行映射。'
      ),
      example: t(
        "import { isSome, isNone, unwrapOr, mapMaybe, toUndefined, type IMaybe } from '@migaia/utils'\nconst present: IMaybe<number | undefined> = { some: true, value: undefined }\nconst missing: IMaybe<number> = { some: false }\nconst mapped = mapMaybe({ some: true, value: 3 }, value => value * 2)\nconsole.log(isSome(present), isNone(missing))\nconsole.log(unwrapOr(mapped, 0), toUndefined(missing))\n// true true\n// 6 undefined",
        "import { isSome, isNone, unwrapOr, mapMaybe, toUndefined, type IMaybe } from '@migaia/utils'\nconst present: IMaybe<number | undefined> = { some: true, value: undefined }\nconst missing: IMaybe<number> = { some: false }\nconst mapped = mapMaybe({ some: true, value: 3 }, value => value * 2)\nconsole.log(isSome(present), isNone(missing))\nconsole.log(unwrapOr(mapped, 0), toUndefined(missing))\n// true true\n// 6 undefined"
      ),
      result: t(
        'Prints true true, then 6 undefined. mapMaybe maps one present value and preserves missing values without calling its mapper.',
        '先输出 true true，再输出 6 undefined；mapMaybe 仅映射存在值，缺失时保留 None 且不运行 mapper。'
      )
    }
  ],
  jitter: [
    {
      title: t('Spread cache expiration times', '分散缓存到期时间'),
      problem: t(
        'Entries written together should expire at different times while respecting the original freshness limit.',
        '一起写入的缓存需要分散到期时间，同时遵守原来的新鲜度上限。'
      ),
      example: {
        en: `import { jitter } from '@migaia/utils/number'

console.log(jitter(60_000, 0.2, () => 0.5))`,
        zh: `import { jitter } from '@migaia/utils/number'

console.log(jitter(60_000, 0.2, () => 0.5))`
      },
      result: t(
        'Prints 54000. Every accepted sample produces a TTL between 48000 and 60000 milliseconds.',
        '输出 54000。每个有效随机结果都使 TTL 位于 48000 至 60000 毫秒之间。'
      )
    }
  ],
  detectServerRuntime: [
    {
      title: t('Select a native server adapter', '选择原生服务端适配器'),
      problem: t(
        'A native adapter needs the runtime that started the program. Deno and Bun can also expose Node compatibility globals.',
        '原生适配器需要识别启动程序的运行时。Deno 与 Bun 也可能暴露 Node 兼容全局。'
      ),
      example: {
        en: `import { detectServerRuntime } from '@migaia/utils'

console.log(detectServerRuntime())`,
        zh: `import { detectServerRuntime } from '@migaia/utils'

console.log(detectServerRuntime())`
      },
      result: t(
        'Prints node on Node. Deno returns deno, Bun returns bun, and browsers return undefined.',
        'Node 输出 node。Deno 返回 deno，Bun 返回 bun，浏览器返回 undefined。'
      )
    }
  ],
  withTimeout: [
    {
      title: t('Time out a slow request and actually stop it', '给慢请求加超时，并让请求真的停下'),
      problem: t(
        'A slow request gets a timeout and the caller receives the error on time, but the request keeps running in the background and the server keeps working on a result nobody wants.\n\nA timeout built from `Promise.race` and `setTimeout` only lets the caller return early; connections, timers and memory stay alive, because nothing tells the operation to stop.\n\n`withTimeout` hands your operation a `signal`. At the deadline it aborts that signal first and then rejects with `DEADLINE_EXCEEDED`. Pass the signal to `fetch`, or check it in your own code, and the work really stops.',
        '给慢请求加了超时，调用方按时拿到了错误，但请求本身还在后台跑，下游还在为一个没人要的结果干活。\n\n只用 `setTimeout` 加 `Promise.race` 做超时，只是让调用方先返回；连接、计时器和内存都没有释放，因为没有人通知操作停下。\n\n`withTimeout` 会把一个 `signal` 交给你的操作；到点时先取消这个 `signal`，再以 `DEADLINE_EXCEEDED` 拒绝。把 `signal` 原样传给 `fetch`，或在自己的代码里检查它，工作就会真正停下。'
      ),
      example: {
        en: `import { withTimeout } from '@migaia/utils/promise'
import { isUtilsTimeoutError } from '@migaia/utils/error'

// A query that takes 2 seconds; real code is usually fetch(url, { signal }).
function slowQuery(signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve('rows'), 2_000)
    signal.addEventListener('abort', () => {
      clearTimeout(timer) // stop as soon as it is cancelled
      console.log('query stopped, reason:', signal.reason.code)
      reject(signal.reason)
    })
  })
}

try {
  await withTimeout(({ signal }) => slowQuery(signal), { timeoutMs: 100 })
} catch (error) {
  if (isUtilsTimeoutError(error)) console.log('timed out:', error.code, error.timeoutMs)
}`,
        zh: `import { withTimeout } from '@migaia/utils/promise'
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
}`
      },
      result: t(
        'Prints `query stopped, reason: DEADLINE_EXCEEDED` and then `timed out: DEADLINE_EXCEEDED 100`.\n\nThe operation is cancelled first and clears its own timer, then the caller receives the timeout error; `signal.reason` is that same error. Rejecting with `signal.reason` only acknowledges the cancellation, so it is not reported again as a failure after the deadline.',
        '先输出 `查询已停止，原因: DEADLINE_EXCEEDED`，再输出 `超时: DEADLINE_EXCEEDED 100`。\n\n操作先收到取消并清掉了自己的计时器，调用方随后收到超时错误；`signal.reason` 就是这个超时错误。操作用 `signal.reason` 拒绝只是在确认取消，不会再被当成超时之后的新失败上报。'
      )
    },
    {
      title: t('Where a failure after the deadline goes', '超时之后才到的失败去了哪里'),
      problem: t(
        "Some operations ignore the `signal`, keep running after the deadline and fail later. Where does that failure go?\n\nA hand-written `Promise.race` either loses that late rejection or turns it into an unhandled rejection; either way nobody learns that the write actually failed.\n\n`withTimeout` has already settled with the timeout and never changes the caller's result; the late failure goes to the `report` callback. Without `report` it is rethrown to the host as an uncaught exception, and Node exits the process by default, so always pass `report` for operations that ignore the signal.",
        '有些操作不看 `signal`，超时后仍会继续执行，过一会儿才失败。这个失败去了哪里？\n\n手写的 `Promise.race` 要么让这个迟到的失败悄悄消失，要么让它变成“未处理的 Promise 拒绝”，两种情况都没人知道写入其实失败了。\n\n`withTimeout` 已经以超时结束，不会再改变调用方拿到的结果；迟到的失败交给 `report` 回调。不传 `report` 时，它会作为未捕获异常交给宿主，Node 默认会因此退出进程。所以操作不看 `signal` 时，一定要传 `report`。'
      ),
      example: {
        en: `import { withTimeout } from '@migaia/utils/promise'

const saving = withTimeout(
  // this write ignores the signal and fails after the deadline
  () => new Promise((_, reject) => setTimeout(() => reject(new Error('write failed')), 50)),
  {
    timeoutMs: 10,
    report: (error, context) =>
      console.log('failure after the deadline:', (error as Error).message, context.phase)
  }
)
await saving.catch((error) => console.log('caller got:', error.code))
await new Promise((resolve) => setTimeout(resolve, 100))`,
        zh: `import { withTimeout } from '@migaia/utils/promise'

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
await new Promise((resolve) => setTimeout(resolve, 100))`
      },
      result: t(
        "Prints `caller got: DEADLINE_EXCEEDED`, then about 40 ms later `failure after the deadline: write failed late-rejection`.\n\nThe caller only sees the timeout; the write failure is not lost and reaches `report` with `phase: 'late-rejection'`.",
        "先输出 `调用方收到: DEADLINE_EXCEEDED`，大约 40 毫秒后输出 `超时后才到的失败: 写入失败 late-rejection`。\n\n调用方只看到超时；写入失败没有丢，带着 `phase: 'late-rejection'` 进入了 `report`。"
      )
    }
  ],
  retry: [
    {
      title: t(
        'Retry only what is worth retrying, within a total deadline',
        '只重试值得重试的错误，并给重试整体限时'
      ),
      problem: t(
        'A server sometimes answers 503 and one retry fixes it, but the retry code hammers an already overloaded service and the user waits half a minute before seeing the failure.\n\nHand-written retry loops have three traps: they retry errors such as 404 that will never succeed, they retry immediately, and they have no total limit.\n\n`retry` asks `shouldRetry` which errors to retry, waits `delay` between attempts (a function can grow it with each attempt), and `totalTimeoutMs` caps the whole run, waits included.',
        '下游偶尔返回 503，重试一次就好；但重试代码把本来就过载的服务打得更狠，用户还要等半分钟才看到失败。\n\n手写的重试循环常有三个坑：404 这类重试也不会成功的错误照样重试；失败后立刻重试；没有总时限。\n\n`retry` 用 `shouldRetry` 判断哪些错误值得重试，用 `delay` 控制两次尝试之间的等待（传函数可以按次数递增），用 `totalTimeoutMs` 限制包括等待在内的总时间。'
      ),
      example: {
        en: `import { retry } from '@migaia/utils/promise'

// A flaky stock API: the first two calls return 503, the third succeeds.
let calls = 0
async function readStock(signal: AbortSignal): Promise<number> {
  calls += 1
  if (signal.aborted) throw signal.reason
  if (calls < 3) throw Object.assign(new Error('service unavailable'), { status: 503 })
  return 42
}

const stock = await retry(({ attempt, signal }) => {
  console.log(\`attempt \${attempt}\`)
  return readStock(signal)
}, {
  maxAttempts: 5,
  // Retry only 5xx; a bad request (4xx) will not succeed on retry, so it is thrown.
  shouldRetry: (error) => (error as { status?: number }).status! >= 500,
  delay: (_error, { attempt }) => 100 * 2 ** (attempt - 1), // 100ms, 200ms, ...
  totalTimeoutMs: 2_000 // at most 2 seconds in total, waits included
})
console.log('stock:', stock)`,
        zh: `import { retry } from '@migaia/utils/promise'

// 模拟一个不稳定的库存接口：前两次返回 503，第三次成功。
let calls = 0
async function readStock(signal: AbortSignal): Promise<number> {
  calls += 1
  if (signal.aborted) throw signal.reason
  if (calls < 3) throw Object.assign(new Error('服务暂时不可用'), { status: 503 })
  return 42
}

const stock = await retry(({ attempt, signal }) => {
  console.log(\`第 \${attempt} 次尝试\`)
  return readStock(signal)
}, {
  maxAttempts: 5,
  // 只重试 5xx；参数错误（4xx）重试也没用，直接抛出。
  shouldRetry: (error) => (error as { status?: number }).status! >= 500,
  delay: (_error, { attempt }) => 100 * 2 ** (attempt - 1), // 100ms、200ms……
  totalTimeoutMs: 2_000 // 包括等待在内，整体最多 2 秒
})
console.log('库存:', stock)`
      },
      result: t(
        "Prints `attempt 1`, `attempt 2`, `attempt 3` and `stock: 42`.\n\nAfter the two 503 responses it waits 100 ms and then 200 ms, and the third attempt succeeds. Each attempt's `signal` is aborted when the total deadline passes.",
        '依次输出 `第 1 次尝试`、`第 2 次尝试`、`第 3 次尝试` 和 `库存: 42`。\n\n两次 503 之后分别等待 100 毫秒和 200 毫秒，第三次成功。总时限到达时，正在进行的那次尝试的 `signal` 会被取消。'
      )
    },
    {
      title: t('Errors that should not be retried fail at once', '不该重试的错误立刻抛出'),
      problem: t(
        'An order number does not exist and the API answers 404; retrying five times will never succeed and only makes the user wait.\n\nCommon retry loops treat every error alike and throw a new wrapper error once attempts run out, so the caller can no longer read the original `status`.\n\nWhen `shouldRetry` returns `false`, `retry` stops without waiting and throws that original error to the caller. It is not wrapped and its message is unchanged, so the caller can still read its own `status` field.',
        '订单号不存在，接口返回 404；重试五次也不会成功，只会让用户多等。\n\n常见的重试循环对所有错误一视同仁，耗尽次数后再抛一个新的包装错误，调用方读不到原来的 `status`。\n\n`shouldRetry` 返回 `false` 时，`retry` 不再等待，直接把这个原始错误抛给调用方。错误不会被包装，message 也不变，调用方仍能读到自己的 `status` 字段。'
      ),
      example: {
        en: `import { retry } from '@migaia/utils/promise'

let calls = 0
try {
  await retry(() => {
    calls += 1
    throw Object.assign(new Error('order not found'), { status: 404 })
  }, {
    maxAttempts: 5,
    shouldRetry: (error) => (error as { status?: number }).status! >= 500
  })
} catch (error) {
  console.log('calls:', calls, 'error:', (error as Error).message)
}`,
        zh: `import { retry } from '@migaia/utils/promise'

let calls = 0
try {
  await retry(() => {
    calls += 1
    throw Object.assign(new Error('订单号不存在'), { status: 404 })
  }, {
    maxAttempts: 5,
    shouldRetry: (error) => (error as { status?: number }).status! >= 500
  })
} catch (error) {
  console.log('调用次数:', calls, '错误:', (error as Error).message)
}`
      },
      result: t(
        'Prints `calls: 1 error: order not found`.\n\nThe 404 is not retried, `maxAttempts: 5` is only an upper bound, and the caller receives the very error it threw.',
        '输出 `调用次数: 1 错误: 订单号不存在`。\n\n404 没有被重试，`maxAttempts: 5` 只是上限；调用方拿到的仍是自己抛出的那个错误。'
      )
    }
  ],
  createConcurrencyLimiter: [
    {
      title: t('Do not fire a whole batch at once', '批量请求不要一次全部发出'),
      problem: t(
        'Downloading hundreds of files at once makes the server throttle or fail, and connections queue up.\n\n`Promise.all(ids.map(download))` starts every request at once; nothing limits how many run at the same moment.\n\n`createConcurrencyLimiter` keeps at most `concurrency` tasks running; the rest wait in submission order and start as earlier ones finish.',
        '一次下载几百个文件，下游开始限流甚至报错，连接也排起长队。\n\n`Promise.all(ids.map(download))` 会同时发出全部请求，没有任何东西限制同一时刻在跑的数量。\n\n`createConcurrencyLimiter` 让同时运行的任务不超过 `concurrency` 个，其余任务按提交顺序排队，前面的完成一个，后面的才开始一个。'
      ),
      example: {
        en: `import { createConcurrencyLimiter } from '@migaia/utils/promise'

const limiter = createConcurrencyLimiter({ concurrency: 2 })
const download = (id: number) =>
  limiter.run(async () => {
    console.log(\`start \${id}: \${limiter.activeCount} running, \${limiter.pendingCount} queued\`)
    await new Promise((resolve) => setTimeout(resolve, 50))
    return \`file \${id}\`
  })

// Submit 5 tasks at once; at most 2 run at the same time
const files = await Promise.all([1, 2, 3, 4, 5].map(download))
console.log(files.join(', '))`,
        zh: `import { createConcurrencyLimiter } from '@migaia/utils/promise'

const limiter = createConcurrencyLimiter({ concurrency: 2 })
const download = (id: number) =>
  limiter.run(async () => {
    console.log(\`开始下载 \${id}，同时进行 \${limiter.activeCount} 个，排队 \${limiter.pendingCount} 个\`)
    await new Promise((resolve) => setTimeout(resolve, 50))
    return \`文件 \${id}\`
  })

// 一次提交 5 个任务，但同时最多只有 2 个在跑
const files = await Promise.all([1, 2, 3, 4, 5].map(download))
console.log(files.join('、'))`
      },
      result: t(
        '`activeCount` stays at 2 while `pendingCount` drops from 3 to 0, and the last line lists `file 1` to `file 5` in submission order.\n\nThe `Promise.all` result keeps submission order, whatever order the tasks finish in.',
        '`activeCount` 一直是 2，`pendingCount` 从 3 降到 0；最后一行按提交顺序列出 `文件 1` 到 `文件 5`。\n\n`Promise.all` 的结果顺序与提交顺序一致，和任务完成的先后无关。'
      )
    },
    {
      title: t('Cancel queued tasks when the user leaves', '用户离开时取消还在排队的任务'),
      problem: t(
        'After the user closes the page, queued downloads still run, fetching data for a page nobody will see.\n\nHand-written queues usually handle queuing but not withdrawal: once a task is queued, all you can do is wait for it to run.\n\nPass a `signal` to `run`: a task still waiting in the queue rejects with the abort reason and never starts; a task that already started receives the cancellation on `context.signal` and decides itself whether to stop.',
        '用户关掉页面后，排队中的下载任务照样执行，是在为没人看的页面下载数据。\n\n手写的队列通常只管“排队”，不管“撤销”：任务一旦进了队列，就只能等它跑完。\n\n给 `run` 传一个 `signal`：任务还在排队时被取消，会直接以取消原因拒绝，不会再开始；已经开始的任务会在 `context.signal` 上收到取消，由任务自己决定是否停下。'
      ),
      example: {
        en: `import { createConcurrencyLimiter } from '@migaia/utils/promise'

const limiter = createConcurrencyLimiter({ concurrency: 1 })
const page = new AbortController() // cancelled when the user leaves the page

const thumbnails = [1, 2, 3].map((id) =>
  limiter
    .run(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      return \`thumbnail \${id} done\`
    }, { signal: page.signal })
    .catch((reason) => \`thumbnail \${id} cancelled: \${reason}\`)
)

page.abort('user left the page') // task 1 is already running; 2 and 3 are still queued
for (const line of await Promise.all(thumbnails)) console.log(line)`,
        zh: `import { createConcurrencyLimiter } from '@migaia/utils/promise'

const limiter = createConcurrencyLimiter({ concurrency: 1 })
const page = new AbortController() // 用户离开页面时取消

const thumbnails = [1, 2, 3].map((id) =>
  limiter
    .run(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      return \`缩略图 \${id} 完成\`
    }, { signal: page.signal })
    .catch((reason) => \`缩略图 \${id} 已取消：\${reason}\`)
)

page.abort('用户离开了页面') // 1 号已经在跑，2、3 号还在排队
for (const line of await Promise.all(thumbnails)) console.log(line)`
      },
      result: t(
        'Prints `thumbnail 1 done`, then `cancelled: user left the page` for 2 and 3.\n\nTask 1 had already started before the abort, so it finishes; 2 and 3 were still queued, are cancelled and never start.',
        '输出 `缩略图 1 完成`，2、3 号输出 `已取消：用户离开了页面`。\n\n1 号在取消前已经开始，所以照常完成；2、3 号还在排队，被直接取消，从没开始执行。'
      )
    }
  ],
  onceAsync: [
    {
      title: t('Run a concurrent initialization only once', '并发初始化只执行一次'),
      problem: t(
        'Three modules initialize at the same time and three database connections open.\n\nLazy loading with `let db` and `if (!db)` breaks in async code: when three calls happen at the same moment, `db` is still empty for all of them.\n\n`onceAsync` stores the Promise on the first call, so every later call, including concurrent ones, gets that same Promise.',
        '三个模块同时初始化，结果建了三个数据库连接。\n\n用 `let db` 加 `if (!db)` 做懒加载，在异步代码里会出错：三个调用同时发生时，`db` 对它们来说都还是空的。\n\n`onceAsync` 在第一次调用时就保存这个 Promise，之后的调用（包括同时发生的调用）拿到的都是同一个 Promise。'
      ),
      example: {
        en: `import { onceAsync } from '@migaia/utils/function'

let connects = 0
// Three modules call getDb() at startup, but the connection must open only once.
const getDb = onceAsync(async () => {
  connects += 1
  console.log('connecting to the database...')
  await new Promise((resolve) => setTimeout(resolve, 50))
  return { query: (sql: string) => \`ran \${sql}\` }
})

const [users, orders, reports] = await Promise.all([getDb(), getDb(), getDb()])
console.log('connections:', connects, 'same connection:', users === orders && orders === reports)
console.log(users.query('select 1'))`,
        zh: `import { onceAsync } from '@migaia/utils/function'

let connects = 0
// 三个模块启动时都会调用 getDb()，但连接只应建立一次。
const getDb = onceAsync(async () => {
  connects += 1
  console.log('正在连接数据库……')
  await new Promise((resolve) => setTimeout(resolve, 50))
  return { query: (sql: string) => \`执行 \${sql}\` }
})

const [users, orders, reports] = await Promise.all([getDb(), getDb(), getDb()])
console.log('连接次数:', connects, '是同一个连接:', users === orders && orders === reports)
console.log(users.query('select 1'))`
      },
      result: t(
        'Prints `connecting to the database...` once, then `connections: 1 same connection: true`.\n\nAll three callers hold the same object: the initialization ran once.',
        '`正在连接数据库……` 只输出一次，随后输出 `连接次数: 1 是同一个连接: true`。\n\n三个调用方拿到的是同一个对象：初始化只发生了一次。'
      )
    },
    {
      title: t('A failed initialization is remembered too', '初始化失败也会被记住'),
      problem: t(
        'The config service fails on the first initialization. What happens on later calls?\n\nExpecting `onceAsync` to retry by itself after a failure leads to confusion when the service is back and calls still receive the old failure.\n\n`onceAsync` remembers the Promise of the first call, whether it succeeds or fails; every later call receives that same failure and the function does not run again. When the initialization should retry, put `retry` inside the function you pass to `onceAsync`, or create a fresh `onceAsync` after a failure.',
        '配置服务第一次初始化失败了，之后的调用会怎样？\n\n如果以为 `onceAsync` 失败后会自动再试，就会在服务恢复后仍然一直拿到旧的失败而感到奇怪。\n\n`onceAsync` 记住的是第一次调用的 Promise，不管它成功还是失败；之后每次调用都拿到同一个失败，函数不会再执行。需要失败重试时，把 `retry` 写进传给 `onceAsync` 的函数里，让初始化本身重试；或者失败后换一个新的 `onceAsync`。'
      ),
      example: {
        en: `import { onceAsync } from '@migaia/utils/function'

let attempts = 0
const loadConfig = onceAsync(async () => {
  attempts += 1
  throw new Error('config service unreachable')
})

for (let index = 0; index < 3; index += 1)
  await loadConfig().catch((error) => console.log(\`call \${index + 1}:\`, error.message))
console.log('actual runs:', attempts)`,
        zh: `import { onceAsync } from '@migaia/utils/function'

let attempts = 0
const loadConfig = onceAsync(async () => {
  attempts += 1
  throw new Error('配置服务不可达')
})

for (let index = 0; index < 3; index += 1)
  await loadConfig().catch((error) => console.log(\`第 \${index + 1} 次调用:\`, error.message))
console.log('实际执行次数:', attempts)`
      },
      result: t(
        'All three calls print `config service unreachable`, and the last line is `actual runs: 1`.\n\nThe failure also happens once and is remembered; whether to retry is up to the function you pass in.',
        '三次调用都输出 `配置服务不可达`，最后一行是 `实际执行次数: 1`。\n\n失败也只发生一次并被记住；要不要重试，由传进去的函数自己决定。'
      )
    }
  ],
  set: [
    {
      title: t('Update a deep field without mutating', '不可变地修改深层字段'),
      problem: t(
        "Changing the city in a user's address does not refresh UI that relies on reference checks, and the original state object was modified too.\n\nHand-written immutable updates spread every level: `{ ...state, user: { ...state.user, address: { ...state.user.address, city } } }`. With enough levels one gets missed and the original object is mutated.\n\n`set` copies each level along the path and reuses every other branch, leaving the original untouched. `get` reads a path and returns `undefined` when a level is missing instead of throwing.",
        '修改用户地址里的城市，依赖引用比较的界面却没有刷新，原来的状态对象也被改掉了。\n\n手写不可变更新要逐层展开：`{ ...state, user: { ...state.user, address: { ...state.user.address, city } } }`。层数一多就容易漏掉一层，结果改到了原对象。\n\n`set` 按路径复制经过的每一层，其余分支原样复用，原对象保持不变。`get` 按路径读取，中间缺了一层时返回 `undefined`，不会抛错。'
      ),
      example: {
        en: `import { get, set } from '@migaia/utils/object'

type IState = {
  user: { name: string; address: { city: string }; phone?: { mobile: string } }
  cart: { items: string[] }
}

const state: IState = {
  user: { name: 'Ada', address: { city: 'Shanghai' } },
  cart: { items: ['keyboard'] }
}

const next = set(state, 'user.address.city', 'Hangzhou')

console.log(get(next, 'user.address.city')) // new value
console.log(state.user.address.city) // the original is unchanged
console.log('cart is the same object:', next.cart === state.cart) // untouched branches are reused
console.log('user is a new object:', next.user !== state.user)
console.log(get(next, 'user.phone.mobile')) // the optional phone is missing: undefined, no throw`,
        zh: `import { get, set } from '@migaia/utils/object'

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
console.log(get(next, 'user.phone.mobile')) // 可选的 phone 不存在，返回 undefined，不抛错`
      },
      result: t(
        'Prints `Hangzhou` and `Shanghai`: the new object changed and the original did not.\n\n`cart is the same object: true` and `user is a new object: true` show that only objects on the path are copied; the last `undefined` comes from a missing path.',
        '输出 `杭州` 和 `上海`：新对象改了，原对象没变。\n\n`cart 仍是同一个对象: true` 和 `user 是新对象: true` 说明只有路径上的对象被复制；最后的 `undefined` 来自不存在的路径。'
      )
    }
  ],
  ownConfig: [
    {
      title: t(
        'Stop callers from changing config after handing it over',
        '防止配置在传入之后被调用方改掉'
      ),
      problem: t(
        "A library's retry count changes mysteriously, and the cause turns out to be a caller editing its own object after handing it over as config.\n\nA library that keeps the caller's config object changes behavior when the caller later edits it, and a plugin that tweaks a field affects everyone else as well.\n\n`ownConfig` copies the config once into an object the library owns; `readonlyConfig` gives plugins a read-only view; `patchConfig` creates a new config instead of changing the old one, and `CONFIG_DELETE` removes a field.",
        '库的重试次数莫名其妙变了，查到最后发现是调用方在传入配置之后又改了自己的对象。\n\n库直接保存调用方传来的配置对象时，调用方事后的修改会影响库的行为；插件拿到配置后随手改一个字段，也会影响其他所有人。\n\n`ownConfig` 在接收时复制一份归库所有；`readonlyConfig` 生成只读视图交给插件；`patchConfig` 生成新配置而不改旧配置，`CONFIG_DELETE` 用来删除字段。'
      ),
      example: {
        en: `import { CONFIG_DELETE, ownConfig, patchConfig, readonlyConfig } from '@migaia/utils/config'

const userOptions = { endpoint: 'https://api.example.com', retry: { attempts: 3 }, debug: true }
const config = ownConfig(userOptions) // copy once; later edits by the caller no longer reach it
userOptions.retry.attempts = 100 // the caller edits its own object afterwards
console.log('attempts seen by the library:', config.retry.attempts)

const view = readonlyConfig(config) // read-only view handed to plugins
try {
  view.retry.attempts = 0
} catch (error) {
  console.log('read-only view refused the write:', (error as Error).name, (error as { code?: string }).code)
}

// New config: change endpoint, delete debug; the untouched retry is reused
const next = patchConfig(config, { endpoint: 'https://staging.example.com', debug: CONFIG_DELETE })
console.log(next.endpoint, '| debug present:', 'debug' in next, '| retry reused:', next.retry === config.retry)`,
        zh: `import { CONFIG_DELETE, ownConfig, patchConfig, readonlyConfig } from '@migaia/utils/config'

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
console.log(next.endpoint, '| debug 还在吗:', 'debug' in next, '| retry 复用:', next.retry === config.retry)`
      },
      result: t(
        "`attempts seen by the library: 3`: the caller's edit did not reach the library.\n\nWriting to the read-only view throws a `TypeError` with code `CONFIG_READONLY`. The new config has the new `endpoint`, no `debug`, and shares the unchanged `retry` object with the old config.",
        '`库内看到的重试次数: 3`：调用方的修改没有影响到库。\n\n往只读视图里写会抛出 `TypeError`，代码是 `CONFIG_READONLY`。新配置的 `endpoint` 已更新、`debug` 已删除，没改动的 `retry` 与旧配置共用同一个对象。'
      )
    }
  ],
  attachErrorIdentity: [
    {
      title: t('Recognize the underlying cause after wrapping', '错误被包装后，仍能认出底层原因'),
      problem: t(
        'A lost-connection error is wrapped layer by layer into "failed to load the order", and the upper layer can only compare message text to tell whether the connection was lost.\n\nComparing messages is fragile: the check breaks as soon as the wording changes, and replacing the error object loses its type and stack.\n\n`attachErrorIdentity` writes a stable `source` and `code` onto the original error without replacing it, so `instanceof` and the stack stay intact; `walkErrorCauses` finds it again along `cause` and `AggregateError.errors`.',
        '底层的断线错误被一层层包装成“加载订单失败”，上层想知道是不是断线，只能比较 message 文本。\n\n比较 message 很脆弱：文案一改，判断就失效；替换错误对象又会丢掉原来的类型和堆栈。\n\n`attachErrorIdentity` 把稳定的 `source` 和 `code` 直接写到原错误上，不替换错误对象，`instanceof` 和堆栈都不变；`walkErrorCauses` 沿着 `cause` 和 `AggregateError.errors` 把它找出来。'
      ),
      example: {
        en: `import { attachErrorIdentity, walkErrorCauses } from '@migaia/utils/error'

// A native error from the driver, tagged with a stable source and code
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
    // The caller wraps it in a domain error and keeps the original on cause
    throw new Error('failed to load the order', { cause })
  }
} catch (error) {
  const lost = walkErrorCauses(error).some(
    (item) => (item as { code?: string } | undefined)?.code === 'CONNECTION_LOST'
  )
  console.log((error as Error).message, '| lost connection underneath:', lost)
  console.log('original is still an Error:', walkErrorCauses(error)[1] instanceof Error)
}`,
        zh: `import { attachErrorIdentity, walkErrorCauses } from '@migaia/utils/error'

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
}`
      },
      result: t(
        "Prints `failed to load the order | lost connection underneath: true`: the outer message is domain text, and the check relies on the code.\n\n`original is still an Error: true`: attaching identity did not change the original error's type.",
        '输出 `加载订单失败 | 底层是断线吗: true`：外层 message 是业务文案，判断依据的是 code。\n\n`原始错误仍是 Error 实例: true`：附加身份没有改变原错误的类型。'
      )
    }
  ]
}
