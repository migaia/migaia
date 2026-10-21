import type { ICaseDoc, IText } from './contract.js'

/** Builds one bilingual text. */
const t = (en: string, zh: string): IText => ({ en, zh })

/**
 * Problems Resource solves, each told as the symptom, why the usual approach fails and how the API
 * fixes it, then a runnable example and its observed output. Every example was run with Node 24
 * against the built package and its printed output is described in `result`.
 */
export const resourceCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  Resource: [
    {
      title: t('Show only the result for the latest input', '只显示最新输入的结果'),
      problem: t(
        "A search box receives `re`, then the user completes it to `react`. The `re` request is slower and answers after `react`, so the page ends up showing the results for `re`.\n\nThe usual code sends a request whenever the input changes and writes the result inside `then`. Every request writes, so whichever answers last wins; when the API cannot be cancelled, an `AbortController` cannot stop that write either.\n\n`Resource` gives every request a generation number and writes only the newest generation's result to `state`. The fetcher reads `keyword.value` before its first `await`, so a keyword change starts a new request without any extra listener.",
        '搜索框里先输入 `re`，接着补全成 `react`。`re` 的请求更慢，比 `react` 晚返回，页面最后显示的却是 `re` 的结果。\n\n常见写法是输入一变就发请求，在 `then` 里直接写入结果。每个请求都会写入，谁最后返回谁就赢；接口不支持取消时，`AbortController` 也拦不住这次写入。\n\n`Resource` 给每次请求一个世代编号，只有最新世代的结果会写入 `state`。fetcher 在第一个 `await` 之前读取了 `keyword.value`，所以关键词一变就会自动发起新请求，不需要另写监听。'
      ),
      example: {
        en: `import { createRuntime } from '@migaia/reactive'
import { Resource, ResourceStatus } from '@migaia/resource'

const runtime = createRuntime()
const keyword = runtime.signal('re')

// Fake search API: shorter keywords answer more slowly, and it cannot be cancelled
function search(text: string): Promise<string> {
  const delay = text.length < 3 ? 50 : 10
  return new Promise((resolve) =>
    setTimeout(() => {
      console.log(\`API answered: "\${text}"\`)
      resolve(\`3 results for "\${text}"\`)
    }, delay)
  )
}

const results = new Resource(() => search(keyword.value), runtime)

const view = runtime.effect(() => {
  const state = results.state
  if (state.status === ResourceStatus.success) console.log(\`page shows: \${state.data}\`)
})

keyword.value = 'react' // the user keeps typing
await new Promise((resolve) => setTimeout(resolve, 100)) // wait for both requests to answer
view.dispose()
results.dispose()`,
        zh: `import { createRuntime } from '@migaia/reactive'
import { Resource, ResourceStatus } from '@migaia/resource'

const runtime = createRuntime()
const keyword = runtime.signal('re')

// 模拟搜索接口：关键词越短，返回越慢；它也不支持取消
function search(text: string): Promise<string> {
  const delay = text.length < 3 ? 50 : 10
  return new Promise((resolve) =>
    setTimeout(() => {
      console.log(\`接口返回：“\${text}”\`)
      resolve(\`“\${text}”的 3 条结果\`)
    }, delay)
  )
}

const results = new Resource(() => search(keyword.value), runtime)

const view = runtime.effect(() => {
  const state = results.state
  if (state.status === ResourceStatus.success) console.log(\`页面显示：\${state.data}\`)
})

keyword.value = 'react' // 用户继续输入
await new Promise((resolve) => setTimeout(resolve, 100)) // 等两次请求都返回
view.dispose()
results.dispose()`
      },
      result: t(
        '`react` answers first and is shown. `re` answers 50 ms later; the log shows the API answering, but the page does not change again.\n\nEven when the underlying request cannot be cancelled, a replaced request cannot write into `state`. When the API accepts a `signal`, pass it on to stop the network work as well.',
        '`react` 先返回并显示出来；50ms 后 `re` 才返回，日志里能看到接口返回了，但页面没有再变。\n\n即使底层请求不能取消，被替换的旧请求也写不进 `state`。接口支持 `signal` 时把它传下去，还能顺带停掉网络请求。'
      )
    },
    {
      title: t('Change several filters, send one request', '同时改几个条件，只发一次请求'),
      problem: t(
        "Switching the sort order on a list page also moves the page number. If each change triggers its own request, one request is wasted and discarded, the API takes twice the load, and the loading state flashes twice.\n\nHand-written code usually sends a request from each filter's change handler. Merging them means adding a debounce, and the right debounce delay is hard to pick.\n\n`Resource` records both `page` and `sort` as dependencies because the fetcher reads them. Several writes in the same turn only mark it stale, and the next microtask turns them into one request.",
        '列表页切换排序时，页码也跟着变。两个条件各触发一次请求，就会多发一个注定被丢弃的请求，接口压力翻倍，加载状态也闪两次。\n\n手写时通常在每个条件的变化回调里各发一次请求，要合并只能自己加防抖，而防抖时长很难定。\n\nfetcher 读取了 `page` 和 `sort`，`Resource` 就把它们都登记为依赖。同一轮里的多次写入只把它标记为过期，在下一个微任务里合并成一次请求。'
      ),
      example: {
        en: `import { createRuntime } from '@migaia/reactive'
import { Resource, ResourceStatus } from '@migaia/resource'

const runtime = createRuntime()
const page = runtime.signal(1)
const sort = runtime.signal('newest')

const orders = new Resource(() => {
  const query = \`page \${page.value}, sorted by \${sort.value}\` // read before the first await
  console.log(\`request: \${query}\`)
  return Promise.resolve(\`orders for \${query}\`)
}, runtime)

const view = runtime.effect(() => {
  const state = orders.state
  if (state.status === ResourceStatus.success) console.log(\`shows: \${state.data}\`)
})
await orders.promise

// The user picks "popular" and moves to page 2 at the same time
sort.value = 'popular'
page.value = 2
await new Promise((resolve) => setTimeout(resolve, 10))
view.dispose()
orders.dispose()`,
        zh: `import { createRuntime } from '@migaia/reactive'
import { Resource, ResourceStatus } from '@migaia/resource'

const runtime = createRuntime()
const page = runtime.signal(1)
const sort = runtime.signal('最新')

const orders = new Resource(() => {
  const query = \`第 \${page.value} 页，按\${sort.value}排序\` // 在第一个 await 之前读取
  console.log(\`请求：\${query}\`)
  return Promise.resolve(\`\${query}的订单\`)
}, runtime)

const view = runtime.effect(() => {
  const state = orders.state
  if (state.status === ResourceStatus.success) console.log(\`显示：\${state.data}\`)
})
await orders.promise

// 用户点“热门”，页码同时回到第 2 页
sort.value = '热门'
page.value = 2
await new Promise((resolve) => setTimeout(resolve, 10))
view.dispose()
orders.dispose()`
      },
      result: t(
        'After the first request, changing the sort order and the page together adds exactly one line: `request: page 2, sorted by popular`.\n\nThe two writes became one request that reads the final value of both filters; no request for "page 1, popular" is ever sent.',
        '第一次请求之后，同时修改排序和页码只多出一行“请求：第 2 页，按热门排序”。\n\n两次写入合并成了一次请求，新请求读到的是两个条件的最终值，不会先按“第 1 页、热门”请求一次。'
      )
    },
    {
      title: t('Several readers, one request', '多处同时读取，只请求一次'),
      problem: t(
        "The header, the sidebar and the settings page all need the current user's profile at once. If each asks on its own, the same data is requested three times in parallel.\n\nThe common fix is to keep the Promise in a module variable, but then someone has to clear it after a failure, fetch again after it expires and cancel it when the page goes away, and that code ends up spread over every caller.\n\nThe `promise` of one `Resource` returns the same Promise while a request is running and while the cached value is fresh. Readers just `await` it; the `Resource` decides when a request is really needed.",
        '页头、侧栏和设置页同时需要当前用户的资料。各自请求的话，同一份数据会同时发出三次。\n\n常见的去重做法是把 Promise 存在模块变量里，可失败后由谁清除、过期后谁重新获取、页面离开时谁来取消，这些代码会散落在各个调用方。\n\n同一个 `Resource` 的 `promise` 在请求进行中和缓存有效时都返回同一个 Promise。读取方只管 `await`，什么时候需要真正发请求由 `Resource` 决定。'
      ),
      example: {
        en: `import { createRuntime } from '@migaia/reactive'
import { Resource } from '@migaia/resource'

const runtime = createRuntime()
let requests = 0

const profile = new Resource(async () => {
  requests++
  await new Promise((resolve) => setTimeout(resolve, 10))
  return { name: 'Ada' }
}, runtime)

// The header, the sidebar and the settings page all need the profile at once
const [header, sidebar, settings] = await Promise.all([
  profile.promise,
  profile.promise,
  profile.promise
])
console.log(\`requests: \${requests}\`)
console.log(\`all three got the same object: \${header === sidebar && sidebar === settings}\`)

await profile.promise // a later read still uses the cache
console.log(\`requests after another read: \${requests}\`)
profile.dispose()`,
        zh: `import { createRuntime } from '@migaia/reactive'
import { Resource } from '@migaia/resource'

const runtime = createRuntime()
let requests = 0

const profile = new Resource(async () => {
  requests++
  await new Promise((resolve) => setTimeout(resolve, 10))
  return { name: 'Ada' }
}, runtime)

// 页头、侧栏、设置页同时需要用户资料
const [header, sidebar, settings] = await Promise.all([
  profile.promise,
  profile.promise,
  profile.promise
])
console.log(\`请求次数：\${requests}\`)
console.log(\`三处拿到同一个对象：\${header === sidebar && sidebar === settings}\`)

await profile.promise // 之后再读，缓存仍然有效
console.log(\`再读一次后的请求次数：\${requests}\`)
profile.dispose()`
      },
      result: t(
        'All three readers receive the same object and one request is sent; reading `promise` again later still finds a fresh cache, so the count stays at 1.\n\n`ttl` defaults to `Infinity`: a success stays fresh until a dependency changes or `refetch()` runs. Sharing happens within one `Resource` instance; requests with different parameters need their own instances.',
        '三处拿到的是同一个对象，请求只发了一次；之后再读 `promise`，缓存仍然有效，请求次数还是 1。\n\n`ttl` 默认是 `Infinity`：成功的数据会一直有效，直到依赖变化或调用 `refetch()`。共享只发生在同一个 `Resource` 实例内，参数不同的请求需要各自的实例。'
      )
    },
    {
      title: t('Stop the running request when the user leaves', '离开页面时停掉还在进行的请求'),
      problem: t(
        'A report takes a second to load and the user leaves halfway. The request keeps running, and its result is written into a view that no longer exists or keeps holding a connection and memory.\n\nBy hand you create an `AbortController`, call `abort()` when leaving, and tell "cancelled" apart from "really failed" in `catch`. Every page repeats this, and one missed place leaves a request that only stops when it finishes.\n\n`dispose()` aborts the current request\'s `signal`, clears the dependencies and makes a pending `promise` fail with `AbortError`. The fetcher only has to hand `signal` to the underlying request.',
        '报表要 1 秒才加载完，用户中途离开了页面。请求还在跑，结果写进已经不存在的界面，或者一直占着连接和内存。\n\n手写时要自己创建 `AbortController`，离开时调用 `abort()`，再在 `catch` 里区分“被取消”和“真失败”。每个页面都写一遍，漏掉一处就留下一个跑完才停的请求。\n\n`dispose()` 会中止当前请求的 `signal`、清除依赖，并让还在等待的 `promise` 以 `AbortError` 失败。fetcher 只需要把 `signal` 交给底层请求。'
      ),
      example: {
        en: `import { createRuntime } from '@migaia/reactive'
import { Resource } from '@migaia/resource'

const runtime = createRuntime()

// Fake API that answers after 1 second and stops when aborted
function loadReport(signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve('report data'), 1000)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      console.log('underlying request stopped')
      reject(signal.reason)
    })
  })
}

const report = new Resource(({ signal }) => loadReport(signal), runtime)
const waiting = report.promise.catch((error: Error & { code?: string }) => {
  console.log(\`waiter received: \${error.name} (\${error.code})\`)
})

report.dispose() // the user leaves the page
await waiting
console.log(\`resource disposed: \${report.disposed}\`)`,
        zh: `import { createRuntime } from '@migaia/reactive'
import { Resource } from '@migaia/resource'

const runtime = createRuntime()

// 模拟一个 1 秒后才返回的接口；收到中止信号就停下
function loadReport(signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve('报表数据'), 1000)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      console.log('底层请求已停止')
      reject(signal.reason)
    })
  })
}

const report = new Resource(({ signal }) => loadReport(signal), runtime)
const waiting = report.promise.catch((error: Error & { code?: string }) => {
  console.log(\`等待方收到：\${error.name}（\${error.code}）\`)
})

report.dispose() // 用户离开页面
await waiting
console.log(\`资源已释放：\${report.disposed}\`)`
      },
      result: t(
        "Right after `dispose()` the log shows the underlying request stopping, and the waiter receives `AbortError` with code `REQUEST_ABORTED`.\n\n`AbortError` is a native `DOMException`, so `error.name === 'AbortError'` is enough to treat it as a normal exit rather than a fault. To stop only this request and reuse the resource later, call `cancel()` instead.",
        "调用 `dispose()` 后立即输出“底层请求已停止”，等待方收到 `AbortError`，错误码是 `REQUEST_ABORTED`。\n\n`AbortError` 是原生的 `DOMException`，用 `error.name === 'AbortError'` 判断就能把它当作正常离开而不是故障。只想停掉这一次请求、之后还要复用资源时，改用 `cancel()`。"
      )
    },
    {
      title: t(
        'Data loaded on the server is not requested again in the browser',
        '服务端已取到的数据，浏览器不再请求'
      ),
      problem: t(
        'Server rendering already loaded the user profile, and the browser loads it again as soon as the page arrives. The first screen flashes a loading state and the API takes twice the requests.\n\nHand-written code often embeds the data in the page and skips the request when data is present, but nobody records how long that data stays valid, so it either never refreshes or refetches at once.\n\n`dehydrate()` exports the data plus two durations: how old it is (`ageMs`) and how long it stays fresh (`remainingTtlMs`). The browser passes it as `initialSnapshot`; the `Resource` keeps counting on its own clock and sends no request while the snapshot is fresh.',
        '服务端渲染时已经请求过一次用户资料，页面到了浏览器又请求一遍。首屏先闪一下加载状态，接口也多承受了一倍请求。\n\n手写时常把数据塞进页面，在客户端判断“有数据就不请求”，但数据还能有效多久通常没人记，结果要么永不刷新，要么马上重取。\n\n`dehydrate()` 导出数据和两个时长：已经存在了多久（`ageMs`）、还能有效多久（`remainingTtlMs`）。浏览器把它作为 `initialSnapshot` 传入，`Resource` 用本地时钟接着计时，快照仍有效时不发请求。'
      ),
      example: {
        en: `import { createRuntime } from '@migaia/reactive'
import { Resource, ResourceStatus } from '@migaia/resource'

// Server: load once and put the result and its remaining lifetime into the page
const onServer = new Resource(async () => ({ name: 'Ada' }), createRuntime(), { ttl: 60_000 })
await onServer.promise
const html = JSON.stringify(onServer.dehydrate())
onServer.dispose()

// Browser: create the resource from the snapshot in the page
let browserRequests = 0
const onClient = new Resource(
  async () => {
    browserRequests++
    return { name: 'Ada' }
  },
  createRuntime(),
  { ttl: 60_000, initialSnapshot: JSON.parse(html) }
)

const state = onClient.state
if (state.status === ResourceStatus.success) console.log(\`first paint shows: \${state.data.name}\`)
console.log(\`requests in the browser: \${browserRequests}\`)
onClient.dispose()`,
        zh: `import { createRuntime } from '@migaia/reactive'
import { Resource, ResourceStatus } from '@migaia/resource'

// 服务端：请求一次，把结果和剩余有效期一起放进页面
const onServer = new Resource(async () => ({ name: 'Ada' }), createRuntime(), { ttl: 60_000 })
await onServer.promise
const html = JSON.stringify(onServer.dehydrate())
onServer.dispose()

// 浏览器：用页面里的快照创建资源
let browserRequests = 0
const onClient = new Resource(
  async () => {
    browserRequests++
    return { name: 'Ada' }
  },
  createRuntime(),
  { ttl: 60_000, initialSnapshot: JSON.parse(html) }
)

const state = onClient.state
if (state.status === ResourceStatus.success) console.log(\`首屏直接显示：\${state.data.name}\`)
console.log(\`浏览器端请求次数：\${browserRequests}\`)
onClient.dispose()`
      },
      result: t(
        "The first read of `state` in the browser is already `success`, and the fetcher was never called.\n\nThe snapshot carries durations, not the server's absolute time, so the two clocks need not agree. Time spent in transport or storage is the caller's to subtract from `remainingTtlMs`, and `data` must be JSON-serializable.",
        '浏览器端第一次读取 `state` 就是 `success`，fetcher 一次也没有被调用。\n\n快照只记录时长，不记录服务端的绝对时间，所以两边时钟不一致也没关系。传输或存储花掉的时间由调用方自己从 `remainingTtlMs` 里扣除；`data` 必须能被 JSON 序列化。'
      )
    }
  ],
  ResourceStatus: [
    {
      title: t('Show "cancelled" instead of an error', '取消后显示“已取消”，不当成错误'),
      problem: t(
        'The user clicks "Cancel export" and the page shows "Export failed", because cancellation and failure end up in the same `catch`.\n\nHand-written state usually has only loading, success and failure. Cancellation is squeezed into failure and told apart by comparing message strings.\n\n`cancel()` turns the pending request into the `cancelled` state, with a native `AbortError` in `state.error`. The resource is not disposed; `refetch()` starts it again.',
        '用户点了“取消导出”，界面却弹出“导出失败”，因为取消和失败走进了同一个 `catch`。\n\n手写的状态通常只有“加载中、成功、失败”三种，取消只能塞进“失败”，再靠比较错误信息字符串来区分。\n\n`cancel()` 把还在等待的请求变成 `cancelled` 状态，`state.error` 是原生 `AbortError`。资源本身没有被释放，之后调用 `refetch()` 可以重新开始。'
      ),
      example: {
        en: `import { createRuntime } from '@migaia/reactive'
import { Resource } from '@migaia/resource'

const runtime = createRuntime()
let attempt = 0

const exportJob = new Resource(({ signal }) => {
  attempt++
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => resolve(\`export \${attempt} finished\`), 20)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    })
  })
}, runtime)

exportJob.cancel() // the user clicks "Cancel export"
const cancelled = exportJob.state
console.log(\`status: \${cancelled.status}\`)
if (cancelled.status === 'cancelled') console.log(\`reason: \${cancelled.error.name}\`)

console.log(await exportJob.refetch()) // the same resource can start again
exportJob.dispose()`,
        zh: `import { createRuntime } from '@migaia/reactive'
import { Resource } from '@migaia/resource'

const runtime = createRuntime()
let attempt = 0

const exportJob = new Resource(({ signal }) => {
  attempt++
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => resolve(\`第 \${attempt} 次导出完成\`), 20)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    })
  })
}, runtime)

exportJob.cancel() // 用户点“取消导出”
const cancelled = exportJob.state
console.log(\`状态：\${cancelled.status}\`)
if (cancelled.status === 'cancelled') console.log(\`原因：\${cancelled.error.name}\`)

console.log(await exportJob.refetch()) // 同一个资源还能重新开始
exportJob.dispose()`
      },
      result: t(
        'After cancelling, the status is `cancelled` with reason `AbortError`; the following `refetch()` completes and prints `export 2 finished`.\n\n`cancelled` is a state of its own, so the page can branch on `ResourceStatus.cancelled` to show "cancelled". Reading `state` after a cancel does not restart the request; only an explicit `refetch()` does.',
        '取消后状态是 `cancelled`，原因是 `AbortError`；随后 `refetch()` 正常完成，输出“第 2 次导出完成”。\n\n`cancelled` 是单独的状态，界面可以按 `ResourceStatus.cancelled` 显示“已取消”。取消后再读取 `state` 不会自动重启请求，只有显式调用 `refetch()` 才会。'
      )
    },
    {
      title: t('Keep showing the old data while refreshing', '刷新时继续显示旧数据'),
      problem: t(
        'Every refresh of the price list first blanks it to "loading". The content disappears and comes back, and the reader loses their place.\n\nHand-written code usually keeps data and loading state in one variable, so refreshing means clearing the data first. Keeping the old data needs another "is refreshing" flag that every exit path must remember to reset.\n\nWith `staleWhileRevalidate`, `state` stays `success` during a refresh, `data` keeps the old value and only `refreshing: true` is added. The new data replaces it when it arrives.',
        '价格表每次刷新都先清空成“加载中”，内容消失再出现，用户正在看的位置也跳走了。\n\n手写时数据和加载状态通常放在同一个变量里，刷新就得先把数据清掉；要保留旧数据，就得再加一个“正在刷新”的标志，还要在每个出口记得复位。\n\n开启 `staleWhileRevalidate` 后，刷新期间 `state` 保持 `success`，`data` 还是旧值，只多了 `refreshing: true`。新数据到了才替换。'
      ),
      example: {
        en: `import { createRuntime } from '@migaia/reactive'
import { Resource, ResourceStatus } from '@migaia/resource'

const runtime = createRuntime()
let version = 0

const prices = new Resource(
  async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
    version++
    return \`price list v\${version}\`
  },
  runtime,
  { staleWhileRevalidate: true } // keep showing the old data while refreshing
)

const view = runtime.effect(() => {
  const state = prices.state
  if (state.status === ResourceStatus.pending) console.log('loading…')
  if (state.status === ResourceStatus.success) {
    console.log(state.refreshing ? \`\${state.data} (refreshing in the background)\` : state.data)
  }
})

await prices.promise
runtime.flush()
await prices.refetch() // the user clicks "Refresh"
runtime.flush() // let the effect see the new result right away
view.dispose()
prices.dispose()`,
        zh: `import { createRuntime } from '@migaia/reactive'
import { Resource, ResourceStatus } from '@migaia/resource'

const runtime = createRuntime()
let version = 0

const prices = new Resource(
  async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
    version++
    return \`价格表 v\${version}\`
  },
  runtime,
  { staleWhileRevalidate: true } // 刷新期间继续显示旧数据
)

const view = runtime.effect(() => {
  const state = prices.state
  if (state.status === ResourceStatus.pending) console.log('加载中…')
  if (state.status === ResourceStatus.success) {
    console.log(state.refreshing ? \`\${state.data}（后台刷新中）\` : state.data)
  }
})

await prices.promise
runtime.flush()
await prices.refetch() // 用户点“刷新”
runtime.flush() // 让副作用立即看到新结果
view.dispose()
prices.dispose()`
      },
      result: t(
        'The output is loading, v1, v1 refreshing in the background, then v2. The page always has content during the refresh.\n\n`state.status` describes the data on screen; whether a request is running is reported separately by `fetchStatus` (`ResourceFetchStatus`). If the refresh is cancelled, `refreshing` is cleared and the old data stays.',
        '依次输出加载中、v1、v1（后台刷新中）、v2，刷新期间界面一直有内容。\n\n`state.status` 描述屏幕上的数据；是否有请求在跑另看 `fetchStatus`（`ResourceFetchStatus`）。刷新被取消时，`refreshing` 会被清除，旧数据保留。'
      )
    }
  ],
  ResourceErrorCode: [
    {
      title: t(
        'Retry only temporary failures and still recognize the original error',
        '只重试临时故障，失败后仍能认出原始错误'
      ),
      problem: t(
        'A gateway sometimes answers 503 and a retry fixes it, but retrying a 404 never helps and only delays the error.\n\nHand-written retry loops easily retry every error, or throw a new wrapper error once retries run out, so the caller can no longer recognize its own `HttpError`.\n\n`retry` can be a function that decides from the failure count and the error whether to try again, and `retryDelay` decides how long to wait. When retrying stops, the last original error is rejected; `Resource` only attaches a `code` to it.',
        '网关偶尔返回 503，重试一次就好；但 404 再怎么重试也没用，只会拖慢报错。\n\n手写重试循环时，很容易对所有错误一律重试，或者在重试耗尽后抛出一个新的包装错误，调用方再也认不出原来的 `HttpError`。\n\n`retry` 可以是一个函数，按第几次失败和错误对象决定要不要再试；`retryDelay` 决定每次等多久。停止重试后，拒绝的仍是最后一次的原始错误，`Resource` 只在它上面附加 `code`。'
      ),
      example: {
        en: `import { createRuntime } from '@migaia/reactive'
import { Resource } from '@migaia/resource'

class HttpError extends Error {
  readonly status: number
  constructor(status: number) {
    super(\`HTTP \${status}\`)
    this.status = status
  }
}

const runtime = createRuntime()
const replies = [503, 404] // first a temporary gateway failure, then "not found"
let attempt = 0

const order = new Resource(
  async () => {
    const status = replies[attempt++]
    console.log(\`request \${attempt}: \${status}\`)
    throw new HttpError(status)
  },
  runtime,
  {
    // Retry only 503, at most 3 times; retrying a 404 would not help
    retry: (failureCount, error) =>
      failureCount <= 3 && error instanceof HttpError && error.status === 503,
    retryDelay: (failureCount) => failureCount * 20 // 20 ms, 40 ms, ... growing each time
  }
)

try {
  await order.promise
} catch (error) {
  const failure = error as HttpError & { code?: string }
  console.log(\`final failure: \${failure.message}, still an HttpError: \${failure instanceof HttpError}\`)
  console.log(\`code: \${failure.code}\`)
}
order.dispose()`,
        zh: `import { createRuntime } from '@migaia/reactive'
import { Resource } from '@migaia/resource'

class HttpError extends Error {
  readonly status: number
  constructor(status: number) {
    super(\`HTTP \${status}\`)
    this.status = status
  }
}

const runtime = createRuntime()
const replies = [503, 404] // 先是网关临时故障，接着是资源不存在
let attempt = 0

const order = new Resource(
  async () => {
    const status = replies[attempt++]
    console.log(\`第 \${attempt} 次请求：\${status}\`)
    throw new HttpError(status)
  },
  runtime,
  {
    // 只重试 503，最多 3 次；404 重试也没用
    retry: (failureCount, error) =>
      failureCount <= 3 && error instanceof HttpError && error.status === 503,
    retryDelay: (failureCount) => failureCount * 20 // 20ms、40ms……逐次加长
  }
)

try {
  await order.promise
} catch (error) {
  const failure = error as HttpError & { code?: string }
  console.log(\`最终失败：\${failure.message}，仍是 HttpError：\${failure instanceof HttpError}\`)
  console.log(\`错误码：\${failure.code}\`)
}
order.dispose()`
      },
      result: t(
        'After the 503 the resource waits 20 ms and tries again; the 404 is not retried and the request fails.\n\nThe final error is still the same `HttpError` (`instanceof` is true) and now carries the code `FETCH_FAILED`. An error that already has its own `source` and `code` keeps them.',
        '第 1 次 503 后等 20ms 重试，第 2 次 404 不再重试，直接失败。\n\n最终错误仍是那个 `HttpError`（`instanceof` 为真），只是多了错误码 `FETCH_FAILED`。已经带有自己 `source` 和 `code` 的错误保持原样。'
      )
    }
  ]
}
