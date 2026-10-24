/**
 * Reference documentation of `@migaia/resource`. Rules: `app/reference/contract.ts`. Verified
 * against `packages/resource/src` (resource.class.ts, state-constants.ts, error-code.ts, errors.ts)
 * and README on 2026-10-17; `createResource`, `mutate`, `subscribe` and `select` verified against
 * create-resource.ts and resource.class.ts on 2026-10-21.
 */
import type { ILibraryReference, IMemberDoc, IOptionCaseDoc, IText } from './contract.js'
import { resourceCases } from './resource-cases.js'

/** Builds one bilingual text. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** The README quick start, used as the class and instance example. */
const resourceExample = {
  en: `import { Resource, ResourceStatus } from '@migaia/resource'
import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()
const userId = runtime.signal('1')

const user = new Resource(
  ({ signal }) => {
    // read reactive inputs before the first await: they become dependencies
    const id = userId.value
    return fetch(\`/api/users/\${id}\`, { signal }).then((response) => response.json())
  },
  runtime,
  { ttl: 30_000, staleWhileRevalidate: true, retry: 2 }
)

const view = runtime.effect(() => {
  const state = user.state
  if (state.status === ResourceStatus.pending) console.log('loading')
  if (state.status === ResourceStatus.success) console.log(state.data)
  if (state.status === ResourceStatus.error) console.error(state.error)
})

userId.value = '2' // replaces the running request with one for user 2

window.addEventListener('pagehide', () => {
  view.dispose()
  user.dispose()
}, { once: true })`,
  zh: `import { Resource, ResourceStatus } from '@migaia/resource'
import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()
const userId = runtime.signal('1')

const user = new Resource(
  ({ signal }) => {
    // 在第一个 await 之前读取响应式输入，它们会成为依赖
    const id = userId.value
    return fetch(\`/api/users/\${id}\`, { signal }).then((response) => response.json())
  },
  runtime,
  { ttl: 30_000, staleWhileRevalidate: true, retry: 2 }
)

const view = runtime.effect(() => {
  const state = user.state
  if (state.status === ResourceStatus.pending) console.log('加载中')
  if (state.status === ResourceStatus.success) console.log(state.data)
  if (state.status === ResourceStatus.error) console.error(state.error)
})

userId.value = '2' // 正在运行的请求被替换为请求用户 2 的新请求

window.addEventListener('pagehide', () => {
  view.dispose()
  user.dispose()
}, { once: true })`
}

/** Scenarios shared by the class symbol and its instance type. */
const resourceScenarios = [
  t(
    'Load data that depends on reactive inputs (user id, filters): changing an input cancels the old request and starts a new one, and an old answer can never overwrite the new state.',
    '加载依赖响应式输入（用户 id、筛选条件）的数据：输入变化时取消旧请求并发起新请求，旧请求的结果永远不会覆盖新状态。'
  ),
  t(
    'Feed React Suspense and error boundaries through `read()`.',
    '通过 `read()` 对接 React Suspense 与错误边界。'
  ),
  t(
    'Cache with a lifetime (`ttl`), keep showing old data while refreshing (`staleWhileRevalidate`), and restore server-rendered data with `dehydrate()` / `hydrate()`.',
    '按有效期缓存（`ttl`），刷新期间继续显示旧数据（`staleWhileRevalidate`），并用 `dehydrate()` / `hydrate()` 恢复服务端渲染的数据。'
  )
]

/** Text of the `state` / `peekState()` result shared by several members. */
const stateReturns = t(
  'An `IResourceState` snapshot: branch on `status` (`idle`, `pending`, `success` with `data`, `error` / `cancelled` with `error`).',
  '一个 `IResourceState` 快照：按 `status` 分支（`idle`、`pending`、带 `data` 的 `success`、带 `error` 的 `error` / `cancelled`）。'
)

/** `createResource()` example, also used by the setup types. */
const createResourceExample = {
  en: `import { createResource, ResourceStatus } from '@migaia/resource'
import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()
const userId = runtime.signal('1')

const user = createResource(
  ({ onDispose }) => {
    // setup runs once: open long-lived things here and register their cleanup
    const socket = new WebSocket('/live')
    onDispose(() => socket.close())
    return ({ signal }) => fetch(\`/api/users/\${userId.value}\`, { signal }).then((r) => r.json())
  },
  { runtime, ttl: 30_000 }
)

const stop = user.subscribe((state) => {
  if (state.status === ResourceStatus.success) console.log(state.data)
})

user.mutate((previous) => ({ ...previous, name: 'Ada' })) // optimistic update
stop()
user.dispose() // closes the socket`,
  zh: `import { createResource, ResourceStatus } from '@migaia/resource'
import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()
const userId = runtime.signal('1')

const user = createResource(
  ({ onDispose }) => {
    // setup 只执行一次：在这里打开长期资源并登记清理
    const socket = new WebSocket('/live')
    onDispose(() => socket.close())
    return ({ signal }) => fetch(\`/api/users/\${userId.value}\`, { signal }).then((r) => r.json())
  },
  { runtime, ttl: 30_000 }
)

const stop = user.subscribe((state) => {
  if (state.status === ResourceStatus.success) console.log(state.data)
})

user.mutate((previous) => ({ ...previous, name: 'Ada' })) // 乐观更新
stop()
user.dispose() // 同时关闭 socket`
}

/** Field docs of `IResourceOptions`, shared with `ICreateResourceOptions`. */
const resourceOptionMembers: Readonly<Record<string, IMemberDoc>> = {
  debugName: {
    summary: t(
      'Label shown in reactive diagnostics and in request error context.',
      '显示在响应式诊断信息与请求错误上下文中的标签。'
    ),
    default: t('Not set: diagnostics show no label.', '不设置：诊断信息中不显示标签。')
  },
  ttl: {
    summary: t(
      'Success lifetime in milliseconds; positive finite lifetimes revalidate on an expired read. `0` and `Infinity` disable time expiration, but changed dependencies, including after suspension, still trigger refetching. Must be ≥ 0 or `Infinity`.',
      '成功值的有效毫秒数；正的有限值过期后读取会重新验证。`0` 与 `Infinity` 禁用时间过期，但依赖变化（含休眠期间的变化）仍触发新请求。必须不小于 0 或为 `Infinity`。'
    ),
    default: t(
      '`Infinity`: fresh until a dependency changes or `refetch()` is called.',
      '`Infinity`：一直新鲜，直到依赖变化或调用 `refetch()`。'
    )
  },
  autoStart: {
    summary: t('Start the first request in the constructor.', '是否在构造时就发起第一次请求。'),
    default: t(
      '`true`: starts immediately unless the initial snapshot is fresh.',
      '`true`：立即启动；若初始快照仍新鲜，则直接保持成功状态，不调用加载函数。'
    )
  },
  staleWhileRevalidate: {
    summary: t(
      'Keep showing expired success data while the refresh runs (`refreshing` is `true`) instead of switching to `pending`.',
      '刷新期间继续显示已过期的成功数据（`refreshing` 为 `true`），而不是切换为 `pending`。'
    ),
    default: t(
      '`false`: an expired value is replaced by `pending`.',
      '`false`：过期后切换为 `pending`。'
    )
  },
  retry: {
    summary: t(
      'Retry policy after a failure: a non-negative integer of extra attempts, or `(failureCount, error) => boolean` deciding each retry. A Promise thrown for Suspense does not count as a failure. A throwing policy or invalid result yields `INVALID_OPTION`; the triggering fetch failure stays reachable through `cause` or `errors`, and existing external identity is preserved.',
      '失败后的重试策略：额外尝试次数（非负整数），或逐次决定是否重试的 `(failureCount, error) => boolean`。为 Suspense 抛出的 Promise 不算失败。策略抛错或返回非法值时产生 `INVALID_OPTION`，触发它的加载失败仍可沿 `cause` 或 `errors` 找到；已有外部身份保留。'
    ),
    default: t('`0`: no retry.', '`0`：首次请求失败后不再重试。')
  },
  retryDelay: {
    summary: t(
      'Wait before each retry in milliseconds, or `(failureCount, error) => ms` for backoff. Throwing callbacks or invalid results retain the fetch failure in `cause` or `errors`; policy errors receive `INVALID_OPTION` unless already classified externally.',
      '每次重试前等待的毫秒数，或用于退避的 `(failureCount, error) => 毫秒`。回调抛错或返回非法值时，通过 `cause` 或 `errors` 保留加载失败；策略错误附 `INVALID_OPTION`，已有外部身份除外。'
    ),
    default: t('`0`: retry immediately.', '`0`：立即重试。'),
    whenToUse: t(
      'Pass a function when the server is overloaded or rate limited: immediate retries add load at the worst moment. `failureCount` starts at 1, so `1000 * 2 ** (failureCount - 1)` waits 1 s, 2 s, 4 s. You can also read `error` and wait longer for a 429 than for a network error. A plain number is enough when failures are short network blips.',
      '服务端过载或限流时传函数：立即重试会在最糟的时候继续加压。`failureCount` 从 1 开始，所以 `1000 * 2 ** (failureCount - 1)` 依次等待 1 秒、2 秒、4 秒。也可以读取 `error`，对 429 等得比网络错误更久。如果失败只是短暂的网络抖动，传一个固定毫秒数就够了。'
    ),
    example: {
      en: `import { Resource } from '@migaia/resource'

const report = new Resource(({ signal }) => fetchReport(signal), runtime, {
  retry: 3,
  // 1st retry after 1 s, 2nd after 2 s, 3rd after 4 s; 429 waits at least 10 s
  retryDelay: (failureCount, error) =>
    isRateLimited(error) ? 10_000 : 1000 * 2 ** (failureCount - 1)
})`,
      zh: `import { Resource } from '@migaia/resource'

const report = new Resource(({ signal }) => fetchReport(signal), runtime, {
  retry: 3,
  // 第 1 次重试等 1 秒，第 2 次 2 秒，第 3 次 4 秒；遇到 429 至少等 10 秒
  retryDelay: (failureCount, error) =>
    isRateLimited(error) ? 10_000 : 1000 * 2 ** (failureCount - 1)
})`
    }
  },
  keepAlive: {
    summary: t(
      'Keep upstream dependencies connected while nothing reads `state`, so changes are still tracked.',
      '没有任何读取 `state` 的观察者时也保持上游依赖连接，继续跟踪变化。'
    ),
    default: t(
      '`false`: unobserved resources disconnect upstream.',
      '`false`：无观察者时断开上游依赖。'
    )
  },
  initialSnapshot: {
    summary: t(
      'Success snapshot from `dehydrate()` (server rendering or persistence) used as the initial state; it is revalidated when expired.',
      '来自 `dehydrate()`（服务端渲染或持久化）的成功快照，作为初始状态；过期时会重新验证。'
    ),
    default: t('Not set: start from `idle`.', '不设置：从 `idle` 开始。')
  },
  scheduler: {
    summary: t(
      'Clock and timers for `ttl`, `updatedAt`, `expiresAt` and retry delays; inject a manual scheduler in tests.',
      '用于 `ttl`、`updatedAt`、`expiresAt` 与重试等待的时钟和计时器；测试时可注入手动调度器。'
    ),
    default: t(
      '`systemScheduler` from `@migaia/utils/scheduler`.',
      '使用 `@migaia/utils/scheduler` 的 `systemScheduler` 提供系统时钟和计时器。'
    )
  }
}

/**
 * Configuration cases of `IResourceOptions`, shared by `new Resource()` and `createResource()`.
 * Verified by running each example against the built package on 2026-10-21.
 */
const resourceOptionCases: readonly IOptionCaseDoc[] = [
  {
    title: t(
      'Cache a price list for a minute and refresh it in the background',
      '价格列表缓存一分钟，过期后在后台刷新'
    ),
    problem: t(
      'Prices change rarely, so requesting them on every read wastes requests; but after a minute they must be refreshed. With only `ttl`, an expired list switches to `pending` and the table flashes a spinner. `staleWhileRevalidate` keeps the old list on screen while the refresh runs and sets `refreshing`, so the page can show a small indicator instead. `debugName` names the resource in trace output and request errors.',
      '价格很少变化，每次读取都请求是浪费；但一分钟后必须刷新。只设置 `ttl` 时，过期的列表会切换为 `pending`，表格闪一下加载状态。`staleWhileRevalidate` 让旧列表在刷新期间继续显示，并把 `refreshing` 设为 `true`，页面只需显示一个小提示。`debugName` 让 trace 输出和请求错误里能看出是哪个资源。'
    ),
    example: {
      en: `import { Resource, ResourceStatus } from '@migaia/resource'

const prices = new Resource(({ signal }) => fetchPrices(signal), runtime, {
  debugName: 'prices',
  ttl: 60_000,
  staleWhileRevalidate: true
})

runtime.effect(() => {
  const state = prices.state
  if (state.status === ResourceStatus.success)
    renderTable(state.data, { updating: state.refreshing })
})
// after 60 s the next read returns { status: 'success', data: oldPrices, refreshing: true },
// then { status: 'success', data: newPrices }`,
      zh: `import { Resource, ResourceStatus } from '@migaia/resource'

const prices = new Resource(({ signal }) => fetchPrices(signal), runtime, {
  debugName: 'prices',
  ttl: 60_000,
  staleWhileRevalidate: true
})

runtime.effect(() => {
  const state = prices.state
  if (state.status === ResourceStatus.success)
    renderTable(state.data, { updating: state.refreshing })
})
// 60 秒后，下一次读取得到 { status: 'success', data: 旧价格, refreshing: true }，
// 刷新完成后变为 { status: 'success', data: 新价格 }`
    },
    result: t(
      'Within a minute reads cost no request; after it, the table keeps the old prices with an "updating" hint until the new ones arrive.',
      '一分钟内读取不发请求；过期后表格保留旧价格并显示“更新中”，直到新价格返回。'
    ),
    covers: ['debugName', 'ttl', 'staleWhileRevalidate']
  },
  {
    title: t('Retry a flaky endpoint', '自动重试不稳定的接口'),
    problem: t(
      'A gateway sometimes answers 503 for a moment. Without `retry`, the first failure goes straight to the `error` state and the user has to reload. `retry: 2` makes up to two more attempts before the state becomes `error`; while they run the state stays `pending`, so the page keeps its loading view.',
      '网关偶尔会短暂返回 503。不设置 `retry` 时，第一次失败就进入 `error` 状态，用户只能刷新页面。`retry: 2` 会在进入 `error` 之前最多再尝试两次；重试期间状态保持 `pending`，页面继续显示加载中。'
    ),
    example: `import { Resource } from '@migaia/resource'

const orders = new Resource(({ signal }) => fetchOrders(signal), runtime, {
  retry: 2,
  retryDelay: 500
})`,
    result: t(
      'Attempt 1 fails, attempt 2 starts after 500 ms; the reader sees `pending` until one attempt succeeds or all three fail.',
      '第 1 次失败后，500 毫秒再发第 2 次；读者一直看到 `pending`，直到某次成功或三次全部失败。'
    ),
    covers: ['retry']
  },
  {
    title: t(
      'Show server-rendered data without a second request',
      '直接显示服务端渲染的数据，不再请求一次'
    ),
    problem: t(
      'The server already loaded the user and rendered the page. If the browser starts from `idle`, it requests the same user again and the page shows a loading state over correct content. `dehydrate()` on the server produces a snapshot with the data and its remaining lifetime; passing it as `initialSnapshot` starts the browser resource in `success` and only revalidates once that lifetime runs out.',
      '服务端已经加载过用户并渲染了页面。如果浏览器从 `idle` 开始，就会再请求一次同一个用户，页面在正确内容上又显示加载状态。服务端调用 `dehydrate()` 得到包含数据和剩余有效期的快照；把它作为 `initialSnapshot` 传入，浏览器端资源直接从 `success` 开始，直到有效期用完才重新验证。'
    ),
    example: {
      en: `import { Resource } from '@migaia/resource'

// server
const serverUser = new Resource(() => loadUser(id), runtime, { ttl: 30_000 })
await serverUser.promise
const html = renderPage({ snapshot: serverUser.dehydrate() })
// { version: 2, data: { name: 'Ada' }, ageMs: 1, remainingTtlMs: 29999 }

// browser
const user = new Resource(({ signal }) => fetchUser(id, signal), runtime, {
  ttl: 30_000,
  initialSnapshot: window.__SNAPSHOT__
})
user.state // { status: 'success', data: { name: 'Ada' } }, no request sent`,
      zh: `import { Resource } from '@migaia/resource'

// 服务端
const serverUser = new Resource(() => loadUser(id), runtime, { ttl: 30_000 })
await serverUser.promise
const html = renderPage({ snapshot: serverUser.dehydrate() })
// { version: 2, data: { name: 'Ada' }, ageMs: 1, remainingTtlMs: 29999 }

// 浏览器
const user = new Resource(({ signal }) => fetchUser(id, signal), runtime, {
  ttl: 30_000,
  initialSnapshot: window.__SNAPSHOT__
})
user.state // { status: 'success', data: { name: 'Ada' } }，没有发出请求`
    },
    result: t(
      'The browser renders the server data immediately and sends its first request only after the 30-second lifetime ends.',
      '浏览器立即显示服务端的数据，30 秒有效期结束后才发出第一次请求。'
    ),
    covers: ['initialSnapshot']
  },
  {
    title: t('Load a panel only when it opens', '面板展开时才加载'),
    problem: t(
      'A settings page has a collapsed "audit log" panel that most users never open. With the default `autoStart: true`, every page view requests the log. `autoStart: false` keeps the resource in `idle` until something first reads `state` (or calls `read()` / `refetch()`), so the request happens only for users who open the panel.',
      '设置页有一个默认折叠的“审计日志”面板，大多数用户从不展开。默认 `autoStart: true` 时，每次打开页面都会请求日志。`autoStart: false` 让资源停在 `idle`，直到第一次读取 `state`（或调用 `read()` / `refetch()`）才发请求，所以只有展开面板的用户才会触发。'
    ),
    example: {
      en: `import { Resource } from '@migaia/resource'

const auditLog = new Resource(({ signal }) => fetchAuditLog(signal), runtime, {
  autoStart: false
})
auditLog.peekState() // { status: 'idle' }: nothing requested

panel.addEventListener('toggle', () => {
  // the first read of state starts the request
  if (panel.open) runtime.effect(() => renderLog(auditLog.state))
}, { once: true })`,
      zh: `import { Resource } from '@migaia/resource'

const auditLog = new Resource(({ signal }) => fetchAuditLog(signal), runtime, {
  autoStart: false
})
auditLog.peekState() // { status: 'idle' }：没有发出请求

panel.addEventListener('toggle', () => {
  // 第一次读取 state 时才发出请求
  if (panel.open) runtime.effect(() => renderLog(auditLog.state))
}, { once: true })`
    },
    result: t(
      'Page views that never open the panel send no request; opening it shows `pending` and then the log.',
      '没有展开面板的访问不发请求；展开后先显示 `pending`，再显示日志。'
    ),
    covers: ['autoStart']
  },
  {
    title: t('Prefetch the next page while nobody shows it', '没人显示时也预取下一页'),
    problem: t(
      'A pager prefetches the next page so that clicking "next" is instant. Nothing renders that resource yet, so by default it disconnects from `page` and only refetches when it is read, which is exactly when the user clicks. `keepAlive: true` keeps the dependency on `page` connected while unobserved, so every page change starts the prefetch right away.',
      '分页器预取下一页，让点击“下一页”时立即显示。这个资源此时还没有被任何地方显示，默认情况下它会断开与 `page` 的依赖，只在被读取时才重新请求，而那正是用户点击的时刻。`keepAlive: true` 让它在无人观察时也保持对 `page` 的依赖，每次翻页都会立刻开始预取。'
    ),
    example: {
      en: `import { Resource } from '@migaia/resource'

const page = runtime.signal(1)
const nextPage = new Resource(
  ({ signal }) => fetchPage(page.value + 1, signal),
  runtime,
  { keepAlive: true }
)

page.value = 2 // requests page 3 now, although nothing reads nextPage yet`,
      zh: `import { Resource } from '@migaia/resource'

const page = runtime.signal(1)
const nextPage = new Resource(
  ({ signal }) => fetchPage(page.value + 1, signal),
  runtime,
  { keepAlive: true }
)

page.value = 2 // 现在就请求第 3 页，尽管还没有地方读取 nextPage`
    },
    result: t(
      'When the user clicks "next", the data is usually already in `success`; without `keepAlive` the click would start the request and show `pending`.',
      '用户点击“下一页”时，数据通常已经是 `success`；没有 `keepAlive` 时，点击才开始请求，先显示 `pending`。'
    ),
    covers: ['keepAlive']
  },
  {
    title: t(
      'Fast-forward cache expiry and retry waits in tests',
      '在测试里快进缓存过期与重试等待'
    ),
    problem: t(
      'A test for "refresh after one minute" should not wait a minute, and fake timers that patch globals also affect unrelated code. `scheduler` gives the resource its own clock and timers; `createManualScheduler()` from `@migaia/utils/testing` moves time only when the test calls `advance()`.',
      '测试“一分钟后刷新”不应该真的等一分钟，而替换全局计时器的假时钟会影响无关代码。`scheduler` 为资源提供独立的时钟和计时器；`@migaia/utils/testing` 的 `createManualScheduler()` 只在测试调用 `advance()` 时推进时间。'
    ),
    example: {
      en: `import { Resource } from '@migaia/resource'
import { createManualScheduler } from '@migaia/utils/testing'

const scheduler = createManualScheduler()
let version = 0
const prices = new Resource(async () => \`v\${++version}\`, runtime, { ttl: 60_000, scheduler })

await prices.promise // 'v1'
scheduler.advance(60_001)
prices.isStale // true
await prices.refetch() // 'v2'`,
      zh: `import { Resource } from '@migaia/resource'
import { createManualScheduler } from '@migaia/utils/testing'

const scheduler = createManualScheduler()
let version = 0
const prices = new Resource(async () => \`v\${++version}\`, runtime, { ttl: 60_000, scheduler })

await prices.promise // 'v1'
scheduler.advance(60_001)
prices.isStale // true
await prices.refetch() // 'v2'`
    },
    result: t(
      'The test runs in milliseconds and only this resource sees the advanced time.',
      '测试几毫秒就跑完，而且只有这个资源看到时间被推进。'
    ),
    covers: ['scheduler']
  }
]

/** Reference of `@migaia/resource`. */
export const resourceReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Reactive, cancellable async data. Start from `new Resource(fetcher, runtime, options)`: it runs `fetcher`, tracks the reactive values it reads before its first `await`, refetches when they change, and exposes the result as a state machine (`state`, `read()`) with TTL caching, retries and snapshots. It sends no requests itself: `fetcher` decides how (fetch, RPC, database).',
        '响应式、可取消的异步数据。从 `new Resource(fetcher, runtime, options)` 开始：它执行 `fetcher`，跟踪其在第一个 `await` 之前读取的响应式值，这些值变化时自动重新请求，并以状态机（`state`、`read()`）的形式提供结果，支持有效期缓存、失败重试与快照。它本身不发请求，由 `fetcher` 决定如何获取数据（fetch、RPC、数据库）。'
      ),
      example: resourceExample
    }
  },
  symbols: {
    createResource: {
      role: 'factory',
      purpose: t(
        'Functional way to build a `Resource`. `setup` runs once, synchronously, with the runtime, scheduler, an abort signal and `onDispose`; it returns the fetcher, and the data type is inferred from it. Cleanups registered with `onDispose` run in reverse order on `dispose()`. If setup throws, returns a non-function (`RESOURCE_SETUP_INVALID`) or the options are invalid, the signal aborts and the registered cleanups run before the original error is rethrown, with cleanup failures attached through `errors`.',
        '函数式构建 `Resource`。`setup` 只同步执行一次，拿到运行时、调度器、中止信号和 `onDispose`，返回加载函数，数据类型由加载函数推导。用 `onDispose` 登记的清理在 `dispose()` 时按逆序执行。若 `setup` 抛错、返回的不是函数（`RESOURCE_SETUP_INVALID`）或选项不合法，会先中止信号并执行已登记的清理，再重新抛出原始错误，清理失败通过 `errors` 附加。'
      ),
      params: {
        setup: t(
          'Function `(context) => fetcher` called once; see `IResourceSetupContext` for what it receives. Register cleanups synchronously inside it.',
          '只调用一次的函数 `(context) => fetcher`；它收到的内容见 `IResourceSetupContext`。清理需要在其中同步登记。'
        )
      },
      returns: t(
        'A `Resource` with the inferred data type; it owns the setup cleanups.',
        '按推导出的数据类型创建的 `Resource`，并负责执行 `setup` 登记的清理。'
      ),
      options: 'ICreateResourceOptions',
      example: createResourceExample,
      scenarios: [
        t(
          'A resource that needs long-lived helpers (a socket, a subscription, a cache) created once and closed together with it.',
          '资源需要一次性创建的长期辅助对象（套接字、订阅、缓存），并在资源释放时一起关闭。'
        ),
        t(
          'Application code that wants the default runtime without passing it around.',
          '应用代码希望直接使用默认运行时，而不用到处传递它。'
        )
      ],
      avoid: [
        t(
          'Nothing to set up or clean up and a runtime already at hand: `new Resource(fetcher, runtime)` is just as short.',
          '既不需要准备也不需要清理、手里已有运行时：直接 `new Resource(fetcher, runtime)` 同样简短。'
        )
      ]
    },
    Resource: {
      role: 'factory',
      purpose: t(
        'Creates one async data source bound to a reactive runtime. Every request gets a generation; only the result of the newest generation is written to `state`, and replaced requests receive an aborted `signal`. With `autoStart` (default) the first request starts in the constructor unless `initialSnapshot` is fresh.',
        '创建一个绑定到响应式运行时的异步数据源。每次请求都有一个世代编号；只有最新世代的结果会写入 `state`，被替换的请求会收到已中止的 `signal`。默认开启 `autoStart`；除非 `initialSnapshot` 仍新鲜，否则构造时就发起第一次请求。'
      ),
      params: {
        fetcher: t(
          'Function `(context) => value | Promise` that loads the data. `context` comes from the resource for each request: `signal` aborts when the request is replaced, reset, cancelled or disposed; `generation` is the request number; `token` stays the same across retries of one request. Reactive values read synchronously (before the first `await`) become dependencies. Final unclassified fetch failures receive `FETCH_FAILED`; existing external error identity stays intact, and immutable errors or primitive failures remain reachable through `cause`.',
          '加载数据的函数 `(context) => value | Promise`。`context` 由资源在每次请求时传入：`signal` 在请求被替换、重置、取消或资源释放时中止；`generation` 是请求编号；`token` 在同一次请求的多次重试之间保持不变。同步读取（第一个 `await` 之前）的响应式值会成为依赖。最终未分类的加载失败附加 `FETCH_FAILED`；已有外部错误身份不变，不可修改的错误或原始值失败保留在 `cause` 链。'
        ),
        runtime: t(
          'Reactive runtime returned by `createRuntime()` from `@migaia/reactive`; the same runtime must own the signals the fetcher reads and the effects that read `state`. `dispose()` does not dispose it.',
          '由 `@migaia/reactive` 的 `createRuntime()` 返回的响应式运行时；`fetcher` 读取的信号以及读取 `state` 的 effect 必须属于同一个运行时。资源的 `dispose()` 不会释放它。'
        )
      },
      returns: t(
        'A `Resource` instance; invalid options throw `INVALID_OPTION`, an invalid `initialSnapshot` throws `INVALID_SNAPSHOT`.',
        '一个 `Resource` 实例；选项不合法时抛 `INVALID_OPTION`，`initialSnapshot` 不合法时抛 `INVALID_SNAPSHOT`。'
      ),
      options: 'IResourceOptions',
      example: resourceExample,
      cases: resourceCases.Resource,
      scenarios: resourceScenarios,
      avoid: [
        t(
          'One-off loads without inputs, cancellation, retry or expiry (for example static config at startup): a plain `await` is simpler.',
          '没有输入、不需要取消、重试或过期的一次性加载（例如启动时读取静态配置）：直接 `await` 一个 Promise 更简单。'
        )
      ]
    },
    RESOURCE_SOURCE: {
      role: 'constant',
      purpose: t(
        'The `source` value (`resource`) attached to Resource-owned failures; existing foreign error identities are preserved; compare `error.source` with it before branching on `error.code`.',
        '资源自身产生的错误所附加的 `source` 值（`resource`）；已有外部错误身份保持不变；先用它比对 `error.source`，再按 `error.code` 分支。'
      ),
      example: `if (error.source === RESOURCE_SOURCE && error.code === ResourceErrorCode.resourceDisposed) return`
    },
    ResourceErrorCode: {
      role: 'constant',
      purpose: t(
        'Table of the stable error codes of this package. Each key names one failure; the values are the strings found on `error.code`.',
        '本包稳定错误码的对照表。每个键对应一种失败，值就是错误对象 `error.code` 上的字符串。'
      ),
      example: `if (error.code === ResourceErrorCode.requestCancelled) return // 主动取消，不提示`,
      cases: resourceCases.ResourceErrorCode
    },
    ResourceFetchStatus: {
      role: 'constant',
      purpose: t(
        'Values of `resource.fetchStatus`: whether a request is running right now, independent of the data shown (a success state can be refreshing in the background).',
        '`resource.fetchStatus` 的取值：表示此刻是否有请求在运行，与显示的数据无关（成功状态也可能正在后台刷新）。'
      ),
      example: `if (user.fetchStatus === ResourceFetchStatus.fetching) showSpinner()`
    },
    ResourceStatus: {
      role: 'constant',
      purpose: t(
        'Values of `state.status`: the five states of the data state machine (`idle`, `pending`, `success`, `error`, `cancelled`).',
        '`state.status` 的全部取值，即数据状态机的五种状态，界面据此决定显示加载、数据还是错误（`idle`、`pending`、`success`、`error`、`cancelled`）。'
      ),
      example: `if (user.state.status === ResourceStatus.success) render(user.state.data)`,
      cases: resourceCases.ResourceStatus
    }
  },
  types: {
    Resource: {
      summary: t(
        'A running async data source. Read `state` in effects or render functions, `read()` with Suspense, and control requests with `refetch()`, `invalidate()`, `cancel()`, `reset()` and `dispose()`.',
        '一个运行中的异步数据源。在 effect 或渲染函数中读取 `state`，在 Suspense 中使用 `read()`，并用 `refetch()`、`invalidate()`、`cancel()`、`reset()`、`dispose()` 控制请求。'
      ),
      scenarios: resourceScenarios,
      example: resourceExample,
      members: {
        deps: {
          summary: t(
            'Reactive values the last request read synchronously; a change in any of them schedules a new request. Read-only, for diagnostics.',
            '上一次请求同步读取过的响应式值；其中任何一个变化都会安排新的请求。只读，用于诊断。'
          )
        },
        depVersions: {
          summary: t(
            'Version of each dependency seen by the last request, used by the reactive runtime to skip refreshes when nothing really changed.',
            '上一次请求看到的每个依赖的版本号，响应式运行时据此在没有实际变化时跳过刷新。'
          )
        },
        runtime: {
          summary: t(
            'The runtime passed to the constructor; the resource registers itself there as an observer.',
            '构造时传入的响应式运行时；资源把自己作为观察者注册在其中。'
          )
        },
        debugName: {
          summary: t(
            'Label given by the `debugName` option, shown in reactive diagnostics and request error context.',
            '由 `debugName` 选项给出的标签，显示在响应式诊断信息与请求错误上下文中。'
          )
        },
        state: {
          summary: t(
            'Current state as a reactive read: an effect that reads it reruns when the state changes. Reading an expired success value starts a revalidation. Throws `RESOURCE_DISPOSED` after `dispose()`.',
            '以响应式读取方式返回当前状态：读取它的 effect 会在状态变化时重新执行。读取已过期的成功值会触发重新验证。`dispose()` 之后读取抛 `RESOURCE_DISPOSED`。'
          )
        },
        promise: {
          summary: t(
            'Promise of the current request, or a resolved Promise of a fresh cached value. Readers share the latest published request Promise; a reentrant fetcher cannot overwrite a Promise of a newer request. Reading it starts work only when idle or stale.',
            '当前请求的 Promise，或新鲜缓存值对应的已兑现 Promise。读取方共享最新发布请求的 Promise；加载函数重入不会让旧请求覆盖新请求的公开 Promise。只有资源空闲或已过期时读取才发起请求。'
          )
        },
        disposed: {
          summary: t(
            '`true` after `dispose()`; still readable afterwards, unlike most members.',
            '调用 `dispose()` 之后为 `true`；与多数成员不同，释放后仍可读取。'
          )
        },
        refreshing: {
          summary: t(
            '`true` while a background refresh runs and the previous success data stays visible (`staleWhileRevalidate`).',
            '后台刷新进行中且上一次成功的数据仍在显示时为 `true`（`staleWhileRevalidate`）。'
          )
        },
        fetchStatus: {
          summary: t(
            '`fetching` while any request runs, otherwise `idle`; separate from `state.status`.',
            '有请求运行时为 `fetching`，否则为 `idle`；与 `state.status` 相互独立。'
          ),
          values: { enum: 'ResourceFetchStatus' }
        },
        isStale: {
          summary: t(
            '`true` when the cached success value is older than `ttl`; `false` for any other state.',
            '缓存的成功值已超过 `ttl` 时为 `true`；其它状态一律为 `false`。'
          )
        },
        observed: {
          summary: t(
            '`true` while some effect or computed currently reads `state`; without observers and without `keepAlive` the resource drops its upstream dependencies.',
            '当前有 effect 或 computed 正在读取 `state` 时为 `true`；没有观察者且未开启 `keepAlive` 时，资源会断开上游依赖。'
          )
        },
        read: {
          summary: t(
            'Suspense-style read with tracking: returns the data on success, throws the pending Promise while loading, and throws the error after failure or cancellation.',
            'Suspense 风格且会被追踪的读取：成功时返回数据，加载中抛出等待中的 Promise，失败或取消后抛出对应错误。'
          ),
          returns: t('The data of the current success state.', '当前成功状态中的数据。'),
          example: `function UserName() {
  return <span>{user.read().name}</span>
}`
        },
        peek: {
          summary: t(
            'Materializes the current state without tracking, starting work or revalidating TTL. Pending throws its Promise; normal `autoStart: false` idle with no Promise throws `NO_ACTIVE_PROMISE`. Inspect `peekState()` or explicitly start work first.',
            '读取当前状态但不追踪、不启动请求、不重验证有效期。等待中抛当前 Promise；合法的 `autoStart: false` 初始空闲状态没有 Promise，直接读取会抛 `NO_ACTIVE_PROMISE`。可先用 `peekState()` 检查或显式启动请求。'
          ),
          returns: t('The data of the current success state.', '当前成功状态中的数据。'),
          example: `const cached = user.peek()`
        },
        peekState: {
          summary: t(
            'Returns the state without tracking, without starting work and without checking `ttl`.',
            '返回当前状态，不追踪、不发起请求，也不检查 `ttl`。'
          ),
          returns: stateReturns,
          example: `console.log(user.peekState().status)`
        },
        reset: {
          summary: t(
            'Cancels the running request, drops cached data and returns to `idle`; the next read starts again.',
            '取消正在运行的请求，丢弃缓存数据并回到 `idle`；下一次读取会重新开始请求。'
          ),
          returns: t('Nothing; the state is now `idle`.', '无返回值；状态已变为 `idle`。'),
          example: `onLogout(() => user.reset())`
        },
        refetch: {
          summary: t(
            'Starts a new request even if the cache is fresh, aborting the running one.',
            '即使缓存仍新鲜也发起新请求，并中止正在运行的请求。'
          ),
          returns: t('Promise of the new request result.', '新请求结果的 Promise。'),
          example: `await user.refetch()`
        },
        invalidate: {
          summary: t(
            'Marks the cached data as expired and starts a replacement request at once.',
            '把缓存数据标记为已过期，并立即发起替换请求。'
          ),
          returns: t('Promise of the replacement request result.', '替换请求结果的 Promise。'),
          example: `await saveUser(input)
await user.invalidate()`
        },
        cancel: {
          summary: t(
            'With an active request, aborts it and pauses passive restarts. Pending becomes `cancelled` (`REQUEST_CANCELLED`); a stale-while-revalidate refresh keeps its success data. Without active work this is a no-op; explicit `refetch()` resumes work.',
            '有活跃请求时中止它并暂停被动重启。等待状态变为 `cancelled`（`REQUEST_CANCELLED`）；保留旧数据的后台刷新取消后仍保留成功数据。没有活跃请求时无操作；显式调用 `refetch()` 可恢复请求。'
          ),
          returns: t(
            'Nothing; active work is cancelled while cached success data may remain.',
            '无返回值；活跃请求已取消，已有成功数据可能继续保留。'
          ),
          example: `cancelButton.onclick = () => user.cancel()`
        },
        dehydrate: {
          summary: t(
            'Captures a v2 success snapshot with portable durations and unchanged caller-owned data. Only time metadata is directly JSON-encodable: BigInt or cyclic data needs caller serialization. Use safe transport or HTML-context encoding; never insert raw JSON into a script element.',
            '导出带可移植时长的第二版成功快照，业务数据原样保留。只有时间元数据可直接编码；大整数或循环数据由调用方序列化。应使用安全传输或适合 HTML 上下文的编码，禁止把原始 JSON 直接拼入脚本元素。'
          ),
          returns: t(
            'An `IResourceCacheSnapshot`, or `undefined` when the state is not `success`.',
            '一个 `IResourceCacheSnapshot`；状态不是 `success` 时为 `undefined`。'
          ),
          example: `const snapshot = user.dehydrate()
const clientUser = new Resource(fetchUser, clientRuntime, { initialSnapshot: snapshot })`
        },
        hydrate: {
          summary: t(
            'Replaces the state with a success snapshot produced by `dehydrate()`, cancelling any running request. An expired snapshot is revalidated on the next read. Durations are rebased to the receiving scheduler; callers add known transport/storage time to `ageMs` and subtract it from finite `remainingTtlMs` (minimum zero). Old v1 snapshots are rejected.',
            '用 `dehydrate()` 生成的成功快照替换当前状态，并取消正在运行的请求。快照已过期时，下一次读取会重新验证。时长按接收端调度器重建；调用方把已知传输或存储耗时加到 `ageMs`，并从有限的 `remainingTtlMs` 扣除，最低为零。旧第一版快照被拒绝。'
          ),
          params: {
            snapshot: t(
              'Snapshot returned by `dehydrate()` (often on the server); malformed snapshots throw `INVALID_SNAPSHOT`.',
              '由 `dehydrate()` 返回的快照（通常来自服务端）；格式不对时抛 `INVALID_SNAPSHOT`。'
            )
          },
          returns: t('Nothing; the state is now `success`.', '无返回值；状态已变为 `success`。'),
          example: `user.hydrate(window.__USER__)`
        },
        markDirty: {
          summary: t(
            'The reactive runtime calls this when a value read by the Resource request changes. It schedules a refresh and groups repeated notifications into that scheduled refresh. Application code changes the input, such as userId.value, and lets the runtime send this notification; it does not need to call markDirty().',
            'Resource 请求读取过的输入发生变化时，响应式运行时会调用此方法。它安排一次刷新，并把刷新执行前收到的多次通知合并到这次刷新中。应用修改 userId.value 等输入即可，由运行时发出通知，无需直接调用 markDirty()。'
          ),
          returns: t('Nothing; a refresh is scheduled.', '无返回值；已安排一次刷新。'),
          example: `// 由运行时调用，例如 userId.value = '2' 之后`
        },
        onDependencyDisconnected: {
          summary: t(
            'The reactive runtime calls this when an input used by the Resource has been disposed and can no longer supply a value. It schedules another request even without an ordinary input change. If that request fails while reading the disposed input, the failure becomes visible in the Resource error state. Application code disposes the input and lets the runtime call this method.',
            'Resource 使用的输入被释放、无法继续提供值时，响应式运行时会调用此方法。即使没有普通输入变化，它也会安排重新请求。如果请求因读取已释放的输入而失败，Resource 的错误状态就会显示该失败。应用释放输入即可，由运行时调用此方法。'
          ),
          returns: t('Nothing; a forced refresh is scheduled.', '无返回值；已安排一次强制刷新。'),
          example: `// 由运行时调用，例如 userId.dispose() 之后`
        },
        mutate: {
          summary: t(
            'Replaces the visible data locally (optimistic update, server push, cache write). Any in-flight request is superseded so its late result cannot overwrite this value, and a new TTL window starts. An updater receives the current success data or `undefined`; function-typed data must be passed through an updater.',
            '在本地替换可见数据（乐观更新、服务端推送、写缓存）。进行中的请求被取代，晚到的结果不会覆盖这个值，并开始新的有效期。更新函数会收到当前成功数据或 `undefined`；数据本身是函数时必须通过更新函数传入。'
          ),
          params: {
            next: t(
              'New data, or an `IResourceUpdater` `(previous) => next`; an updater throw leaves the state unchanged.',
              '新数据，或更新函数 `IResourceUpdater`（`(previous) => next`）；更新函数抛错时状态保持不变。'
            )
          },
          returns: t(
            'This resource, for chaining; after `dispose()` it throws `RESOURCE_DISPOSED`.',
            '本资源本身，便于链式调用；在 `dispose()` 之后调用会抛出 `RESOURCE_DISPOSED`。'
          ),
          example: `todos.mutate((list = []) => [...list, draft])`
        },
        subscribe: {
          summary: t(
            'Delivers the current state now and after every change to code that does not run inside the reactive graph (plain scripts, devtools, Node). Subscribing counts as observation, so it can start and keep requests alive. Listener throws are reported through `runtime.reportError` and do not stop delivery.',
            '把当前状态立即交给监听函数，之后每次变化再交一次，适合不在响应式图里运行的代码（普通脚本、调试工具、Node）。订阅算作观察，因此可能启动并保持请求。监听函数抛错时通过 `runtime.reportError` 报告，不会中断后续通知。'
          ),
          params: {
            listener: t(
              'Function `(state) => void` receiving each `IResourceState`; a non-function throws `INVALID_OPTION`.',
              '函数 `(state) => void`，接收每个 `IResourceState`；不是函数时抛出 `INVALID_OPTION`。'
            )
          },
          returns: t(
            'An idempotent unsubscribe function; `dispose()` unsubscribes automatically.',
            '可重复调用的取消订阅函数；`dispose()` 时会自动取消。'
          ),
          example: `const stop = user.subscribe((state) => render(state))`
        },
        select: {
          summary: t(
            'Creates a reactive value derived from the success data; it is `undefined` while the resource is not in `success`, and it is disposed together with the resource.',
            '创建一个由成功数据派生的响应式值；资源不在 `success` 状态时为 `undefined`，并随资源一起释放。'
          ),
          params: {
            selector: t(
              'Function `(data) => result`; a non-function throws `INVALID_OPTION`.',
              '函数 `(data) => result`；不是函数时抛出 `INVALID_OPTION`。'
            )
          },
          returns: t(
            'An `IReactiveComputed` from `@migaia/reactive`; read it through `value` inside effects.',
            '`@migaia/reactive` 的 `IReactiveComputed`；在副作用中通过 `value` 读取。'
          ),
          example: `const count = todos.select((list) => list.length)
runtime.effect(() => console.log(count.value))`
        },
        '[Symbol.dispose]': {
          summary: t(
            'Same as `dispose()`, so a `using` declaration ends the resource when its block exits.',
            '与 `dispose()` 相同，使 `using` 声明在代码块结束时终止资源。'
          ),
          returns: t('Nothing; the resource is terminal.', '无返回值；资源已终止。'),
          example: `using user = createResource(() => loadUser)`
        },
        dispose: {
          summary: t(
            'Ends the resource: cancels the request, removes dependencies and subscriptions. Calling it again does nothing; afterwards data reads and operations throw `RESOURCE_DISPOSED`, while `disposed`, `refreshing` and `observed` stay readable. The runtime is not disposed.',
            '终止资源：取消请求、移除依赖与订阅。重复调用没有效果；之后读取数据或调用操作会抛 `RESOURCE_DISPOSED`，而 `disposed`、`refreshing`、`observed` 仍可读取。运行时本身不会被释放。'
          ),
          returns: t('Nothing; the resource is terminal.', '无返回值；资源已终止。'),
          example: `onUnmount(() => user.dispose())`
        }
      }
    },
    ICreateResourceOptions: {
      summary: t(
        'Options of `createResource()`: every `IResourceOptions` field plus the runtime.',
        '`createResource()` 的选项：包含 `IResourceOptions` 的全部字段，另加运行时。'
      ),
      members: {
        ...resourceOptionMembers,
        runtime: {
          summary: t(
            'Reactive runtime from `createRuntime()` that owns the resource graph; the signals the fetcher reads must belong to it.',
            '由 `createRuntime()` 创建、拥有该资源依赖图的响应式运行时；加载函数读取的信号必须属于它。'
          ),
          default: t(
            '`defaultRuntime` from `@migaia/reactive`.',
            '使用 `@migaia/reactive` 导出的默认运行时 `defaultRuntime`。'
          )
        }
      },
      optionCases: [
        ...resourceOptionCases,
        {
          title: t('Give each test its own runtime', '每个测试使用独立的 runtime'),
          problem: t(
            'Without `runtime`, every resource joins the shared `defaultRuntime`, so effects and pending flushes from one test can still run during the next. Passing a runtime created per test keeps the graph, its effects and its error reporting inside that test; the signals the fetcher reads must come from the same runtime.',
            '不传 `runtime` 时，所有资源都加入共享的 `defaultRuntime`，上一个测试留下的 effect 和待执行的冲刷可能在下一个测试里继续运行。为每个测试创建一个 runtime 传进去，依赖图、effect 和错误上报都只属于这个测试；加载函数读取的信号也必须来自同一个 runtime。'
          ),
          example: {
            en: `import { createResource } from '@migaia/resource'
import { createRuntime } from '@migaia/reactive'

test('loads the selected user', async () => {
  const runtime = createRuntime()
  const userId = runtime.signal('1')
  const user = createResource(() => async () => loadUser(userId.value), { runtime })

  expect(await user.promise).toEqual({ id: '1' })
  user.dispose() // nothing from this test reaches the next one
})`,
            zh: `import { createResource } from '@migaia/resource'
import { createRuntime } from '@migaia/reactive'

test('加载选中的用户', async () => {
  const runtime = createRuntime()
  const userId = runtime.signal('1')
  const user = createResource(() => async () => loadUser(userId.value), { runtime })

  expect(await user.promise).toEqual({ id: '1' })
  user.dispose() // 这个测试的任何东西都不会留到下一个测试
})`
          },
          result: t(
            'Each test starts from an empty graph, and a failing effect is reported to that test only.',
            '每个测试都从空的依赖图开始，失败的 effect 只上报给当前测试。'
          ),
          covers: ['runtime']
        }
      ]
    },
    IResourceSetup: {
      summary: t(
        'Setup callback of `createResource()`: called once with an `IResourceSetupContext`, returns the fetcher.',
        '`createResource()` 的准备函数：以 `IResourceSetupContext` 调用一次，返回加载函数。'
      ),
      members: {}
    },
    IResourceSetupContext: {
      summary: t(
        'What `createResource()` hands to its setup callback; the context is frozen and closes when setup returns.',
        '`createResource()` 交给准备函数的上下文；该对象已冻结，并在准备函数返回后关闭。'
      ),
      example: createResourceExample,
      members: {
        runtime: {
          summary: t(
            'Runtime that owns the resource graph: `options.runtime` or `defaultRuntime`.',
            '拥有资源依赖图的运行时：即 `options.runtime`，未提供时为 `defaultRuntime`。'
          )
        },
        scheduler: {
          summary: t(
            'Scheduler the resource uses for TTL and retry timing: `options.scheduler` or `systemScheduler`.',
            '资源用于有效期和重试计时的调度器：即 `options.scheduler`，未提供时为 `systemScheduler`。'
          )
        },
        signal: {
          summary: t(
            'Aborts when the resource is disposed or setup fails; pass it to listeners and long-lived work started in setup.',
            '资源释放或准备失败时中止；把它传给准备阶段启动的监听和长期任务。'
          )
        },
        debugName: {
          summary: t(
            'Diagnostic name from `options.debugName`, or `undefined`.',
            '来自 `options.debugName` 的诊断名称；未设置时为 `undefined`。'
          )
        },
        onDispose: {
          summary: t(
            'Registers a synchronous cleanup that runs in reverse order on `dispose()`, or right away when setup fails. Calling it after setup returned throws `RESOURCE_SETUP_CLOSED`.',
            '登记一个同步清理函数，在 `dispose()` 时按逆序执行，准备失败时立即执行。准备函数返回后再调用会抛出 `RESOURCE_SETUP_CLOSED`。'
          ),
          params: {
            cleanup: t(
              'Synchronous function, for example `() => socket.close()`; a non-function throws `RESOURCE_SETUP_INVALID`.',
              '同步函数，例如 `() => socket.close()`；不是函数时抛出 `RESOURCE_SETUP_INVALID`。'
            )
          },
          returns: t('The same context, for chaining.', '同一个上下文对象，便于链式调用。'),
          example: `ctx.onDispose(() => socket.close()).onDispose(() => timer.cancel())`
        }
      }
    },
    IResourceUpdater: {
      summary: t(
        'Updater `(previous) => next` accepted by `mutate()`; `previous` is the current success data or `undefined`.',
        '`mutate()` 接受的更新函数 `(previous) => next`；`previous` 是当前成功数据或 `undefined`。'
      ),
      members: {}
    },
    IResourceCacheSnapshot: {
      summary: t(
        'Portable v2 success snapshot from `dehydrate()`, accepted by `hydrate()` and `initialSnapshot`. Durations use the receiving clock; data is neither copied, serialized nor HTML-escaped. The caller owns data encoding and transport elapsed time.',
        '由 `dehydrate()` 返回、`hydrate()` 与 `initialSnapshot` 接受的第二版可移植成功快照。时长使用接收端时钟重建；数据不复制、不序列化、不做 HTML 转义，数据编码与传输耗时由调用方负责。'
      ),
      scenarios: [
        t(
          'Pass server-rendered data to the browser without a second request.',
          '把服务端渲染得到的数据传给浏览器，无需再请求一次。'
        )
      ],
      example: `const snapshot = serverUser.dehydrate()
const clientUser = new Resource(fetchUser, runtime, { initialSnapshot: snapshot })`,
      members: {
        version: {
          summary: t(
            'Snapshot format version; always `2`. The old absolute-time v1 format is rejected.',
            '快照格式版本固定为 `2`；旧的绝对时间第一版格式被拒绝。'
          )
        },
        data: { summary: t('The success data that was cached.', '请求成功后被缓存下来的数据。') },
        ageMs: {
          summary: t(
            'Finite non-negative cache age in milliseconds at capture. Add known transport/storage elapsed time before hydration.',
            '捕获时有限且非负的缓存年龄（毫秒）；恢复前需加上已知传输或存储耗时。'
          )
        },
        remainingTtlMs: {
          summary: t(
            'Finite non-negative remaining lifetime in milliseconds, or `null` for no time expiration (`ttl: 0` or `Infinity`). Subtract known transport/storage time, clamping to zero.',
            '有限且非负的剩余寿命（毫秒）；`null` 表示无时间过期（`ttl: 0` 或 `Infinity`）。应扣除已知传输或存储耗时，最低为零。'
          )
        }
      }
    },
    IResourceError: {
      summary: t(
        'Shape of Resource-owned failures: native errors retain their type with `source` and `code` attached where possible; immutable or primitive failures remain on `cause`. Already classified foreign failures keep their original identity.',
        '资源自身产生的错误形状：尽可能在原生错误上附加 `source` 与 `code` 并保留类型；不可修改或原始值失败保留在 `cause`。已分类的外部错误保持原身份。'
      ),
      members: {
        source: {
          summary: t(
            'Always `resource` (`RESOURCE_SOURCE`).',
            '固定为 `resource`（即 `RESOURCE_SOURCE`），用于确认错误来自本包。'
          )
        },
        code: {
          summary: t(
            'One of the `ResourceErrorCode` values.',
            '`ResourceErrorCode` 中的一个稳定错误码，用于分支处理。'
          )
        }
      }
    },
    IResourceErrorCode: {
      summary: t(
        'Union of the `ResourceErrorCode` values.',
        '`ResourceErrorCode` 全部取值组成的联合类型。'
      ),
      members: {}
    },
    IResourceFetchContext: {
      summary: t(
        'Argument the resource passes to `fetcher` on each request: `{ signal, generation, token }`.',
        '资源每次请求时传给 `fetcher` 的参数：`{ signal, generation, token }`。'
      ),
      members: {
        signal: {
          summary: t(
            'Aborts when this request is replaced, reset, cancelled or the resource is disposed; pass it to `fetch` or other cancellable I/O.',
            '本次请求被替换、重置、取消或资源被释放时中止；把它传给 `fetch` 等可取消的 I/O。'
          )
        },
        generation: {
          summary: t(
            'Request number, increasing with every new request.',
            '请求编号，每次新请求都会递增。'
          )
        },
        token: {
          summary: t(
            'Opaque identity of this request, unchanged across its retries; compare tokens to tell requests apart.',
            '本次请求的不透明身份，在重试之间保持不变；可比较 token 区分不同请求。'
          )
        }
      }
    },
    IResourceFetcher: {
      summary: t(
        'Type of the `fetcher` passed to `new Resource()`: `(context: IResourceFetchContext) => value | PromiseLike`.',
        '传给 `new Resource()` 的数据加载函数 `fetcher` 的类型：`(context: IResourceFetchContext) => value | PromiseLike`。'
      ),
      members: {}
    },
    IResourceOptions: {
      summary: t(
        'Options of `new Resource()`: caching, retries, start-up and snapshots.',
        '`new Resource()` 的选项：缓存、重试、启动方式与快照。'
      ),
      members: resourceOptionMembers,
      optionCases: resourceOptionCases
    },
    IResourceRetryPolicy: {
      summary: t(
        'Type of the `retry` option: a number of extra attempts or `(failureCount, error) => boolean`.',
        '`retry` 选项的类型：额外尝试次数，或 `(failureCount, error) => boolean` 判断函数。'
      ),
      members: {}
    },
    IResourceState: {
      summary: t(
        'State of the data state machine read from `state` and `peekState()`; branch on `status`.',
        '从 `state` 与 `peekState()` 读取的数据状态机状态；按 `status` 分支处理。'
      ),
      members: {
        status: {
          summary: t(
            'Current state name; see `ResourceStatus`.',
            '当前数据状态机的状态名称，具体取值见 `ResourceStatus`。'
          ),
          values: { enum: 'ResourceStatus' }
        },
        data: {
          summary: t(
            'The loaded value; present only in `success`.',
            '加载得到的值；只在 `success` 状态中存在。'
          )
        },
        refreshing: {
          summary: t(
            'In `success`: `true` while a background refresh runs.',
            '在 `success` 状态中：后台刷新进行时为 `true`。'
          )
        },
        error: {
          summary: t(
            'In `error`: the classified fetch or policy failure; original failures stay reachable through cause/errors. In `cancelled`: an AbortError with `REQUEST_CANCELLED`.',
            '在 `error` 状态中是分类后的加载或策略错误，原始失败沿原因或错误列表可达；在 `cancelled` 状态中是带 `REQUEST_CANCELLED` 的原生中止错误。'
          )
        }
      }
    }
  },
  enums: {
    ResourceStatus: {
      summary: t('The five states of a resource.', '资源数据状态机的五种状态，决定界面如何渲染。'),
      values: {
        idle: t(
          '`idle`: nothing requested yet, or after `reset()`.',
          '`idle`：尚未发起请求，或刚执行过 `reset()`。'
        ),
        pending: t(
          '`pending`: the first data is loading; show a loading view.',
          '`pending`：首份数据正在加载，应显示加载状态。'
        ),
        success: t(
          '`success`: `data` is available, maybe refreshing in the background.',
          '`success`：`data` 可用，可能正在后台刷新。'
        ),
        error: t(
          '`error`: the last request failed; the reason is in `error`.',
          '`error`：最近一次请求失败，原因在 `error` 中。'
        ),
        cancelled: t(
          '`cancelled`: `cancel()` stopped the request; `error` is an `AbortError`.',
          '`cancelled`：请求被主动取消并停止，`error` 携带 `AbortError` 原生错误。'
        )
      }
    },
    ResourceFetchStatus: {
      summary: t(
        'Whether a request is running right now.',
        '表示此刻是否有请求正在运行，与数据状态无关。'
      ),
      values: {
        idle: t('`idle`: no request is running.', '`idle`：当前没有任何请求在运行。'),
        fetching: t(
          '`fetching`: a request runs, with or without cached data.',
          '`fetching`：有请求在运行，无论是否已有缓存数据。'
        )
      }
    },
    ResourceErrorCode: {
      summary: t(
        'Stable error codes of `@migaia/resource`.',
        '`@migaia/resource` 的稳定错误码及其触发场景。'
      ),
      values: {
        resourceDisposed: t(
          '`RESOURCE_DISPOSED`: a member was used after `dispose()`; create a new resource.',
          '`RESOURCE_DISPOSED`：在 `dispose()` 之后使用了成员；需要创建新的资源。'
        ),
        requestAborted: t(
          '`REQUEST_ABORTED`: Resource-initiated cancellation uses the same native AbortError as its signal reason and rejection. Lifecycle replacement can supply a different signal reason, retained on the `cause` of the Resource AbortError.',
          '`REQUEST_ABORTED`：资源主动取消时，原生中止错误同时作为信号原因与拒绝值。生命周期替换可能提供不同的信号原因，此时保存在资源中止错误的 `cause`。'
        ),
        requestCancelled: t(
          '`REQUEST_CANCELLED`: the `AbortError` stored in the `cancelled` state after `cancel()`.',
          '`REQUEST_CANCELLED`：调用 `cancel()` 后保存在 `cancelled` 状态中的 `AbortError`。'
        ),
        cancellationCleanupFailed: t(
          '`CANCELLATION_CLEANUP_FAILED`: a timer or listener could not be cleaned after cancellation; the resource still counts as cancelled.',
          '`CANCELLATION_CLEANUP_FAILED`：取消后计时器或监听清理失败；资源仍视为已取消。'
        ),
        noActivePromise: t(
          '`NO_ACTIVE_PROMISE`: no request Promise is available, including a valid `autoStart: false` idle `peek()`; inspect `peekState()` or explicitly start a request.',
          '`NO_ACTIVE_PROMISE`：没有可用的请求 Promise，包括合法的 `autoStart: false` 空闲状态直接调用 `peek()`；可检查 `peekState()` 或显式启动请求。'
        ),
        invalidSnapshot: t(
          '`INVALID_SNAPSHOT`: snapshot version is not `2`, durations are negative/non-finite (only remaining lifetime permits `null`), or rebased local timestamps overflow. Getter failures retain their cause.',
          '`INVALID_SNAPSHOT`：版本不是 `2`、时长为负或非有限值（仅剩余寿命允许 `null`），或重建本地时间戳溢出；读取器失败保留原因。'
        ),
        invalidOption: t(
          '`INVALID_OPTION`: an option such as `ttl`, `retry` or `retryDelay` is invalid; fix the options.',
          '`INVALID_OPTION`：`ttl`、`retry`、`retryDelay` 等选项不合法；需要修正选项。'
        ),
        fetchFailed: t(
          '`FETCH_FAILED`: final unclassified fetch failure after retries. Native errors keep identity when writable; immutable errors and primitive values stay reachable through `cause`. Existing foreign source/code is preserved.',
          '`FETCH_FAILED`：重试结束后的未分类加载失败。可修改的原生错误保留身份；不可修改错误及原始值保留在 `cause`。已有外部来源与错误码保持不变。'
        ),
        setupInvalid: t(
          '`RESOURCE_SETUP_INVALID`: `createResource()` got a non-function setup, or setup returned a non-function; registered cleanups already ran. Return a fetcher from setup.',
          '`RESOURCE_SETUP_INVALID`：`createResource()` 收到的准备函数不是函数，或准备函数返回的不是函数；已登记的清理已经执行。需要让准备函数返回加载函数。'
        ),
        setupClosed: t(
          '`RESOURCE_SETUP_CLOSED`: `onDispose()` was called after setup returned, for example from an async callback; register cleanups synchronously during setup.',
          '`RESOURCE_SETUP_CLOSED`：准备函数返回后才调用 `onDispose()`，例如在异步回调中调用；需要在准备阶段同步登记清理。'
        ),
        suspenseProbeFailed: t(
          '`SUSPENSE_PROBE_FAILED`: a value thrown by the fetcher has a throwing `then` getter; both errors are kept in `errors`.',
          '`SUSPENSE_PROBE_FAILED`：fetcher 抛出的值的 `then` 读取器本身抛错；两个错误都保存在 `errors` 中。'
        )
      }
    }
  },
  enhancers: {}
}
