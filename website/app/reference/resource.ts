/**
 * Reference documentation of `@migaia/resource`. Rules: `app/reference/contract.ts`. Verified
 * against `packages/resource/src` (resource.class.ts, state-constants.ts, error-code.ts, errors.ts)
 * and README on 2026-10-17.
 */
import type { ILibraryReference, IText } from './contract.js'

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

view.dispose()
user.dispose()`,
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

view.dispose()
user.dispose()`
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
    Resource: {
      role: 'factory',
      purpose: t(
        'Creates one async data source bound to a reactive runtime. Every request gets a generation; only the result of the newest generation is written to `state`, and replaced requests receive an aborted `signal`. With `autoStart` (default) the first request starts in the constructor.',
        '创建一个绑定到响应式运行时的异步数据源。每次请求都有一个世代编号；只有最新世代的结果会写入 `state`，被替换的请求会收到已中止的 `signal`。默认开启 `autoStart`，构造时就发起第一次请求。'
      ),
      params: {
        fetcher: t(
          'Function `(context) => value | Promise` that loads the data. `context` comes from the resource for each request: `signal` aborts when the request is replaced, reset, cancelled or disposed; `generation` is the request number; `token` stays the same across retries of one request. Reactive values read synchronously (before the first `await`) become dependencies.',
          '加载数据的函数 `(context) => value | Promise`。`context` 由资源在每次请求时传入：`signal` 在请求被替换、重置、取消或资源释放时中止；`generation` 是请求编号；`token` 在同一次请求的多次重试之间保持不变。同步读取（第一个 `await` 之前）的响应式值会成为依赖。'
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
        'The `source` value (`@migaia/resource`) attached to every error this package throws; compare `error.source` with it before branching on `error.code`.',
        '本包抛出的每个错误上附加的 `source` 值（`@migaia/resource`）；先用它比对 `error.source`，再按 `error.code` 分支。'
      ),
      example: `if (error.source === RESOURCE_SOURCE && error.code === ResourceErrorCode.resourceDisposed) return`
    },
    ResourceErrorCode: {
      role: 'constant',
      purpose: t(
        'Table of the stable error codes of this package. Each key names one failure; the values are the strings found on `error.code`.',
        '本包稳定错误码的对照表。每个键对应一种失败，值就是错误对象 `error.code` 上的字符串。'
      ),
      example: `if (error.code === ResourceErrorCode.requestCancelled) return // 主动取消，不提示`
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
      example: `if (user.state.status === ResourceStatus.success) render(user.state.data)`
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
            'Promise of the current request, or a resolved Promise of a fresh cached value. All readers get the same Promise; reading it starts a request only when the resource is idle or stale.',
            '当前请求的 Promise，或新鲜缓存值对应的已兑现 Promise。所有读取方拿到同一个 Promise；只有资源空闲或已过期时，读取它才会发起请求。'
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
            'Same results as `read()` but without tracking, so the caller does not rerun when the state changes.',
            '结果与 `read()` 相同，但不会被追踪，状态变化时调用方不会重新执行。'
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
            'Aborts the running request and publishes the `cancelled` state (error code `REQUEST_CANCELLED`); the resource stays usable.',
            '中止正在运行的请求并发布 `cancelled` 状态（错误码 `REQUEST_CANCELLED`）；资源仍可继续使用。'
          ),
          returns: t('Nothing; the request is aborted.', '无返回值；当前请求已中止。'),
          example: `cancelButton.onclick = () => user.cancel()`
        },
        dehydrate: {
          summary: t(
            'Exports the current success value as a JSON-safe snapshot for server rendering or persistence.',
            '把当前成功值导出为可 JSON 化的快照，用于服务端渲染或持久化。'
          ),
          returns: t(
            'An `IResourceCacheSnapshot`, or `undefined` when the state is not `success`.',
            '一个 `IResourceCacheSnapshot`；状态不是 `success` 时为 `undefined`。'
          ),
          example: `const snapshot = user.dehydrate()
html += \`<script>window.__USER__ = \${JSON.stringify(snapshot)}</script>\``
        },
        hydrate: {
          summary: t(
            'Replaces the state with a success snapshot produced by `dehydrate()`, cancelling any running request. An expired snapshot is revalidated on the next read.',
            '用 `dehydrate()` 生成的成功快照替换当前状态，并取消正在运行的请求。快照已过期时，下一次读取会重新验证。'
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
            'Called by the reactive runtime when a dependency changed; schedules one refresh for a batch of changes. Application code does not call it.',
            '依赖变化时由响应式运行时调用；同一批变化只安排一次刷新。应用代码不需要调用。'
          ),
          returns: t('Nothing; a refresh is scheduled.', '无返回值；已安排一次刷新。'),
          example: `// 由运行时调用，例如 userId.value = '2' 之后`
        },
        onDependencyDisconnected: {
          summary: t(
            'Called by the reactive runtime when a dependency was disposed; forces a re-run so the failure becomes visible. Application code does not call it.',
            '某个依赖被释放时由响应式运行时调用；强制重新执行，让失败能够被观察到。应用代码不需要调用。'
          ),
          returns: t('Nothing; a forced refresh is scheduled.', '无返回值；已安排一次强制刷新。'),
          example: `// 由运行时调用，例如 userId.dispose() 之后`
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
    IResourceCacheSnapshot: {
      summary: t(
        'JSON-safe success snapshot returned by `dehydrate()` and accepted by `hydrate()` and the `initialSnapshot` option.',
        '`dehydrate()` 返回、`hydrate()` 与 `initialSnapshot` 选项接受的可 JSON 化成功快照。'
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
          summary: t('Snapshot format version; always `1`.', '快照格式的版本号，目前固定为 `1`。')
        },
        data: { summary: t('The success data that was cached.', '请求成功后被缓存下来的数据。') },
        updatedAt: {
          summary: t(
            'Scheduler time (milliseconds) when the data was received.',
            '收到数据时的调度器时间（毫秒）。'
          )
        },
        expiresAt: {
          summary: t(
            'Scheduler time when the data expires; `null` means it never expires (`ttl: Infinity`).',
            '数据过期时的调度器时间；`null` 表示永不过期（`ttl: Infinity`）。'
          )
        }
      }
    },
    IResourceError: {
      summary: t(
        'Shape of every error thrown by this package: the native error object with `source` and `code` added.',
        '本包抛出的每个错误的形状：在原生错误对象上附加了 `source` 与 `code`。'
      ),
      members: {
        source: {
          summary: t(
            'Always `@migaia/resource` (`RESOURCE_SOURCE`).',
            '固定为 `@migaia/resource`（即 `RESOURCE_SOURCE`），用于确认错误来自本包。'
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
      members: {
        debugName: {
          summary: t(
            'Label shown in reactive diagnostics and in request error context.',
            '显示在响应式诊断信息与请求错误上下文中的标签。'
          ),
          default: t('Not set: diagnostics show no label.', '不设置：诊断信息中不显示标签。')
        },
        ttl: {
          summary: t(
            'How long a success value stays fresh, in milliseconds; reading after that starts a revalidation. Must be ≥ 0 or `Infinity`.',
            '成功值保持新鲜的毫秒数；超过后再读取会触发重新验证。必须不小于 0 或为 `Infinity`。'
          ),
          default: t(
            '`Infinity`: fresh until a dependency changes or `refetch()` is called.',
            '`Infinity`：一直新鲜，直到依赖变化或调用 `refetch()`。'
          )
        },
        autoStart: {
          summary: t(
            'Start the first request in the constructor.',
            '是否在构造时就发起第一次请求。'
          ),
          default: t('`true`.', '`true`：构造后状态立即变为 `pending`。')
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
            'Retry policy after a failure: a non-negative integer of extra attempts, or `(failureCount, error) => boolean` deciding each retry. A Promise thrown for Suspense does not count as a failure.',
            '失败后的重试策略：额外尝试次数（非负整数），或逐次决定是否重试的 `(failureCount, error) => boolean`。为 Suspense 抛出的 Promise 不算失败。'
          ),
          default: t('`0`: no retry.', '`0`：首次请求失败后不再重试。')
        },
        retryDelay: {
          summary: t(
            'Wait before each retry in milliseconds, or `(failureCount, error) => ms` for backoff.',
            '每次重试前等待的毫秒数，或用于退避的 `(failureCount, error) => 毫秒`。'
          ),
          default: t('`0`: retry immediately.', '`0`：立即重试。')
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
            '`systemScheduler` from `@migaia/lifecycle`.',
            '使用 `@migaia/lifecycle` 的 `systemScheduler` 提供系统时钟和计时器。'
          )
        }
      }
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
            'In `error`: the value the fetcher threw; in `cancelled`: an `AbortError` with code `REQUEST_CANCELLED`.',
            '在 `error` 状态中是 fetcher 抛出的值；在 `cancelled` 状态中是错误码为 `REQUEST_CANCELLED` 的 `AbortError`。'
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
          '`REQUEST_ABORTED`: the `AbortError` used as the reason of a replaced request signal; usually ignored.',
          '`REQUEST_ABORTED`：被替换请求的信号所携带的 `AbortError`；通常可以忽略。'
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
          '`NO_ACTIVE_PROMISE`: no request Promise existed where one was required; indicates inconsistent internal state.',
          '`NO_ACTIVE_PROMISE`：需要请求 Promise 时却不存在；表示内部状态不一致。'
        ),
        invalidSnapshot: t(
          '`INVALID_SNAPSHOT`: a snapshot has a wrong `version`, `updatedAt` or `expiresAt`; check how it was produced.',
          '`INVALID_SNAPSHOT`：快照的 `version`、`updatedAt` 或 `expiresAt` 不合法；检查快照的生成过程。'
        ),
        invalidOption: t(
          '`INVALID_OPTION`: an option such as `ttl`, `retry` or `retryDelay` is invalid; fix the options.',
          '`INVALID_OPTION`：`ttl`、`retry`、`retryDelay` 等选项不合法；需要修正选项。'
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
