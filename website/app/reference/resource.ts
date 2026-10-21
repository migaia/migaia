/**
 * Reference documentation of `@migaia/resource`. Rules: `app/reference/contract.ts`. Verified
 * against `packages/resource/src` (resource.class.ts, state-constants.ts, error-code.ts, errors.ts)
 * and README on 2026-10-17.
 */
import type { ILibraryReference, IText } from './contract.js'
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
        'The `source` value (`@migaia/resource`) attached to Resource-owned failures; existing foreign error identities are preserved; compare `error.source` with it before branching on `error.code`.',
        '资源自身产生的错误所附加的 `source` 值（`@migaia/resource`）；已有外部错误身份保持不变；先用它比对 `error.source`，再按 `error.code` 分支。'
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
            'Success lifetime in milliseconds; positive finite lifetimes revalidate on an expired read. `0` and `Infinity` disable time expiration, but changed dependencies, including after suspension, still trigger refetching. Must be ≥ 0 or `Infinity`.',
            '成功值的有效毫秒数；正的有限值过期后读取会重新验证。`0` 与 `Infinity` 禁用时间过期，但依赖变化（含休眠期间的变化）仍触发新请求。必须不小于 0 或为 `Infinity`。'
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
            '`systemScheduler` from `@migaia/utils/scheduler`.',
            '使用 `@migaia/utils/scheduler` 的 `systemScheduler` 提供系统时钟和计时器。'
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
        suspenseProbeFailed: t(
          '`SUSPENSE_PROBE_FAILED`: a value thrown by the fetcher has a throwing `then` getter; both errors are kept in `errors`.',
          '`SUSPENSE_PROBE_FAILED`：fetcher 抛出的值的 `then` 读取器本身抛错；两个错误都保存在 `errors` 中。'
        )
      }
    }
  },
  enhancers: {}
}
