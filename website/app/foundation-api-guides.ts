/**
 * Task guides of reactive, resource and utils operations added after the original guide inventory.
 * The prose follows the audited reference pages (`app/reference/reactive.ts`, `resource.ts`,
 * `utils.ts`), verified on 2026-10-21.
 */
import type { IApiGuide, IGuideLocale } from './api-guides.js'

/** Bilingual input of one guide; each locale keeps its own prose. */
type IGuideInput = {
  readonly purposeEn: string
  readonly purposeZh: string
  readonly quickStart: string
  readonly scenariosEn: readonly string[]
  readonly scenariosZh: readonly string[]
  readonly avoidEn: readonly string[]
  readonly avoidZh: readonly string[]
}

/** Builds one bilingual guide; the code example is shared because it carries no prose comments. */
function guide(input: IGuideInput): Readonly<Record<IGuideLocale, IApiGuide>> {
  return {
    en: {
      purpose: input.purposeEn,
      quickStart: input.quickStart,
      scenarios: input.scenariosEn,
      avoidWhen: input.avoidEn,
      options: []
    },
    zh: {
      purpose: input.purposeZh,
      quickStart: input.quickStart,
      scenarios: input.scenariosZh,
      avoidWhen: input.avoidZh,
      options: []
    }
  }
}

/** Task guides keyed by `<library>:<module>:<symbol>`. */
export const foundationApiGuides: Readonly<
  Record<string, Readonly<Record<IGuideLocale, IApiGuide>>>
> = {
  'reactive:extension:createBatchedOperation': guide({
    purposeEn:
      'Wraps a one-argument operation so every call runs inside runtime.batch() and runtime.untracked(): writes flush once at the end and reads do not subscribe the caller. A store creates it once for a hot write path instead of allocating new closures on every call.',
    purposeZh:
      '把一个单参数操作包装起来，让每次调用都在 runtime.batch() 和 runtime.untracked() 里执行：写入在结束时统一刷新，读取不会让调用方建立订阅。store 在初始化时为高频写入创建一次，之后每次调用不再新建闭包。',
    quickStart: `import { createBatchedOperation } from '@migaia/reactive/extension'

const applyPatch = createBatchedOperation(runtime, (patch: ICartPatch) => {
  items.value = patch.items
  total.value = patch.total
})
applyPatch(nextCart)`,
    scenariosEn: [
      'A store applies several signal writes per call and subscribers should be notified once.',
      'A write path runs very often and the per-call closures of batch(() => untracked(...)) show up in profiles.'
    ],
    scenariosZh: [
      'store 每次调用要写入多个信号，希望订阅者只收到一次通知。',
      '写入路径调用非常频繁，batch(() => untracked(...)) 每次新建的闭包在性能分析中很明显。'
    ],
    avoidEn: [
      'A one-off batch in application code: call runtime.batch() directly.',
      'The operation must track what it reads; untracked execution would drop those dependencies.'
    ],
    avoidZh: [
      '应用代码里偶尔一次的批量写入：直接调用 runtime.batch()。',
      '操作需要追踪它读取的值：不追踪执行会丢掉这些依赖。'
    ]
  }),
  'reactive:extension:createStaticObserver': guide({
    purposeEn:
      "Subscribes a callback to a source whose node is known in advance, such as one atom of a store. After the first tracked read, a change only compares that node's version instead of collecting dependencies again; resolve runs again when the node is invalidated.",
    purposeZh:
      '让回调订阅一个事先知道节点的数据源，例如 store 里的某个原子。第一次按普通方式追踪读取之后，值变化时只比较这一个节点的版本，不再重新收集依赖；节点失效时会再次调用 resolve。',
    quickStart: `import { createStaticObserver } from '@migaia/reactive/extension'

const subscription = createStaticObserver(
  runtime,
  () => cartSource,
  () => renderCartBadge(store.get(cartAtom)),
  { debugName: 'cart-badge' }
)
subscription.dispose()`,
    scenariosEn: [
      'A store subscribes thousands of listeners to single atoms and wants less memory and work per listener than a full effect.',
      'The observed node can be replaced by invalidateObservable() and the subscription should follow it.'
    ],
    scenariosZh: [
      'store 要为成千上万个监听者各订阅一个原子，希望比完整的 effect 更省内存、更少计算。',
      '被观察的节点可能被 invalidateObservable() 替换，订阅需要跟着切换。'
    ],
    avoidEn: [
      'The callback reads different sources on different runs: use an effect, which tracks dynamically.',
      "Application code subscribing to a few values: the store's own subscribe API is simpler."
    ],
    avoidZh: [
      '回调每次读取的数据源不同：使用会动态追踪的 effect。',
      '应用代码只订阅少量值：直接使用 store 自己的订阅接口更简单。'
    ]
  }),
  'resource:index:createResource': guide({
    purposeEn:
      'Builds a Resource from a setup function that runs once with the runtime, scheduler, an abort signal and onDispose, and returns the fetcher. Cleanups registered with onDispose run in reverse order on dispose(), and also when setup fails before the error is rethrown.',
    purposeZh:
      '用一个 setup 函数构建 Resource：它只执行一次，拿到运行时、调度器、中止信号和 onDispose，并返回加载函数。用 onDispose 登记的清理在 dispose() 时逆序执行；setup 失败时也会先执行清理再重新抛出错误。',
    quickStart: `import { createResource } from '@migaia/resource'
import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()
const userId = runtime.signal('1')
const user = createResource(
  ({ onDispose }) => {
    const socket = new WebSocket('/live')
    onDispose(() => socket.close())
    return ({ signal }) => fetch('/api/users/' + userId.value, { signal }).then((r) => r.json())
  },
  { runtime, ttl: 30_000 }
)
user.dispose()`,
    scenariosEn: [
      'A resource needs long-lived helpers such as a socket or a cache that are created once and closed with it.',
      'Application code wants the default runtime without passing it around.'
    ],
    scenariosZh: [
      '资源需要只创建一次的长期辅助对象（例如套接字或缓存），并在资源释放时一起关闭。',
      '应用代码希望直接使用默认运行时，而不必到处传递它。'
    ],
    avoidEn: [
      'Nothing to set up or clean up and a runtime is already at hand: new Resource(fetcher, runtime) is just as short.',
      'The value is derived synchronously from signals: use a computed value instead of a resource.'
    ],
    avoidZh: [
      '既不需要准备也不需要清理、手里已有运行时：直接 new Resource(fetcher, runtime) 同样简短。',
      '值可以由信号同步计算得到：使用计算值，而不是资源。'
    ]
  }),
  'utils:config:ConfigOwner': guide({
    purposeEn:
      'Holds one immutable config snapshot. Every write builds and validates the complete next snapshot before committing it, so a failed write changes nothing; reads return deep readonly views typed from the path, and watchers run once per commit.',
    purposeZh:
      '持有一份不可变的配置快照。每次写入都先构建并校验完整的下一份快照再提交，失败的写入不会改变任何东西；读取返回按路径推导类型的深只读视图，每次提交只触发一次监听。',
    quickStart: `import { ConfigOwner } from '@migaia/utils/config'

type IAppConfig = { server: { host: string; port: number }; debug: boolean }

const config = new ConfigOwner<IAppConfig>(
  { server: { host: 'localhost', port: 80 }, debug: false },
  { validate: (value) => value.server.port > 0 }
)
const stop = config.watch('server.port', (port) => restartServer(port))
config.set('server.port', 8080).patch({ debug: true })
stop()`,
    scenariosEn: [
      'Many modules read one application config, and only modules whose path changed should be notified.',
      'The config is built from JSON text, a remote source or environment variables with from(), fromAsync() or fromEnv().'
    ],
    scenariosZh: [
      '多个模块读取同一份应用配置，只有路径真正变化的模块需要收到通知。',
      '配置需要用 from()、fromAsync() 或 fromEnv() 从 JSON 文本、远程来源或环境变量构建。'
    ],
    avoidEn: [
      'The config is read once at startup and never changes: readonlyConfig(ownConfig(value)) is simpler.',
      'The values are reactive UI state: keep them in a store instead of a config owner.'
    ],
    avoidZh: [
      '配置只在启动时读取一次、之后不再变化：直接用 readonlyConfig(ownConfig(value)) 更简单。',
      '这些值是界面的响应式状态：放进状态库，而不是配置对象。'
    ]
  }),
  'utils:error:IdentifyError': guide({
    purposeEn:
      'Error class with a stable identity (source, code, optional phase and detail). The original failure stays on cause and is returned by native(), the stack is never rewritten, and statics build and inspect errors deep inside cause chains.',
    purposeZh:
      '带稳定身份（source、code，可选 phase 和 detail）的错误类。原始失败保留在 cause 上并由 native() 返回，调用栈不会被改写；静态方法用于创建错误，以及在原因链深处检查错误。',
    quickStart: `import { IdentifyError } from '@migaia/utils/error'

const OrderError = IdentifyError.define('@app/orders', { notFound: 'NOT_FOUND' })

try {
  throw OrderError.notFound({ cause: new Error('no row'), detail: { id: '42' } })
} catch (error) {
  const status = IdentifyError.match(error, { NOT_FOUND: () => 404, _: () => 500 })
  console.log(status)
}`,
    scenariosEn: [
      'Every failure that leaves a module needs a stable source and code so callers branch on codes, not on message text.',
      'A known failure must be found deep inside a cause chain or an AggregateError with find() or match().'
    ],
    scenariosZh: [
      '每个离开模块的失败都需要稳定的 source 和 code，让调用方按错误码分支，而不是匹配消息文字。',
      '需要用 find() 或 match() 在原因链或 AggregateError 深处找到已知的失败。'
    ],
    avoidEn: [
      'The error never leaves the function that throws it: a plain Error is enough.',
      'A package already declares its own error factories; reuse them so codes stay in one registry.'
    ],
    avoidZh: [
      '错误不会离开抛出它的函数：普通 Error 就够了。',
      '某个包已经声明了自己的错误工厂：复用它们，让错误码保持在同一个登记表中。'
    ]
  }),
  'utils:scheduler:asyncTask': guide({
    purposeEn:
      'Runs a callback later on the chosen queue and resolves with its result. A list of strategies declares the fallback order; an unknown strategy or invalid delay throws INVALID_ARGUMENT, and a strategy the host lacks throws ENV_UNSUPPORTED.',
    purposeZh:
      '在所选队列上稍后执行回调，并以回调结果完成。传入策略列表即可声明回退顺序；未知策略或非法延迟抛出 INVALID_ARGUMENT，宿主不支持的策略抛出 ENV_UNSUPPORTED。',
    quickStart: `import { asyncTask } from '@migaia/utils/scheduler'

await asyncTask('idleCallback', ({ timeRemaining }) => prefetch(timeRemaining()), { idleTimeout: 2000 })
await asyncTask(['postTaskBackground', 'timeout'], flushLogs, 100)`,
    scenariosEn: [
      'Low-priority work such as logging or prefetch should run at background priority or idle time, with a fallback for other hosts.',
      'Code must run right before the next paint with animationFrame.'
    ],
    scenariosZh: [
      '日志、预取这类低优先级工作应放到后台优先级或空闲期执行，并为其它宿主准备回退。',
      '代码需要用 animationFrame 在下一次绘制之前执行。'
    ],
    avoidEn: [
      'Waiting for a plain duration: sleep() is clearer.',
      'Work that must run in the current tick: call it directly instead of scheduling it.'
    ],
    avoidZh: [
      '只是等待一段时间：用 sleep() 更清楚。',
      '必须在当前这一轮执行的工作：直接调用，不要安排到之后。'
    ]
  }),
  'utils:scheduler:coalesce': guide({
    purposeEn:
      'Collects every call made before the chosen queue runs and delivers them to the function in one invocation, in call order, so analytics events, writes or DOM reads of one tick are handled together.',
    purposeZh:
      '收集所选队列执行前的所有调用，按调用顺序一次性交给函数，让同一轮里的统计事件、写入或 DOM 读取合并处理。',
    quickStart: `import { coalesce } from '@migaia/utils/scheduler'

const track = coalesce((calls: [event: string][]) => send(calls.map(([event]) => event)))
track('open')
track('click')`,
    scenariosEn: [
      'Several analytics events fired in one tick should go out in a single request.',
      'Many components request the same DOM measurement and it should be read once.'
    ],
    scenariosZh: [
      '同一轮里触发的多个统计事件，应合并成一次请求发出。',
      '多个组件请求同一项 DOM 测量，希望只读取一次。'
    ],
    avoidEn: [
      'Only the latest call matters: debounce() drops the earlier ones for you.',
      'Each call must run immediately and return its own result.'
    ],
    avoidZh: [
      '只关心最后一次调用：debounce() 会替你丢弃之前的调用。',
      '每次调用都必须立即执行并返回自己的结果。'
    ]
  }),
  'utils:scheduler:debounce': guide({
    purposeEn:
      'Delays a function until calls stop for the given number of milliseconds, then runs it once with the latest arguments. leading also runs the first call of a burst, and maxWait caps how long a continuous burst may postpone it.',
    purposeZh:
      '把函数推迟到调用停止指定毫秒之后，再用最新参数执行一次。leading 让一串调用的第一次也执行，maxWait 限制连续调用最多推迟多久。',
    quickStart: `import { debounce } from '@migaia/utils/scheduler'

const save = debounce((draft: string) => api.save(draft), 500, { maxWait: 5000 })
input.addEventListener('input', () => save(input.value))`,
    scenariosEn: [
      'An editor saves a draft only after the user pauses typing, but at least every few seconds.',
      'A search box queries the server after input settles instead of on every keystroke.'
    ],
    scenariosZh: [
      '编辑器只在用户停止输入后保存草稿，但至少每隔几秒保存一次。',
      '搜索框在输入稳定后才请求服务器，而不是每次按键都请求。'
    ],
    avoidEn: [
      'Updates must keep flowing at a steady rate during a burst: use throttle().',
      'Every call carries data that must not be lost: use coalesce() to receive all of them.'
    ],
    avoidZh: [
      '连续调用期间也要按固定频率持续更新：使用 throttle()。',
      '每次调用都带有不能丢的数据：使用 coalesce() 收到全部调用。'
    ]
  }),
  'utils:scheduler:isAsyncTaskSupported': guide({
    purposeEn:
      'Tells whether the current host provides the API behind one asyncTask strategy, without scheduling anything. auto counts as supported whenever one of its fallbacks is available.',
    purposeZh:
      '判断当前宿主是否提供某个 asyncTask 策略所需的接口，不安排任何任务。只要 auto 的任一回退可用，它就算支持。',
    quickStart: `import { isAsyncTaskSupported } from '@migaia/utils/scheduler'

const strategy = isAsyncTaskSupported('idleCallback') ? 'idleCallback' : 'timeout'`,
    scenariosEn: [
      'Feature detection decides between two code paths before any work is scheduled.',
      'A diagnostics page lists which scheduling queues the current browser or runtime offers.'
    ],
    scenariosZh: [
      '在安排任何工作之前，通过特性检测在两条代码路径之间做选择。',
      '诊断页面列出当前浏览器或运行时提供了哪些调度队列。'
    ],
    avoidEn: [
      'You only need the first supported strategy of a list: resolveAsyncTaskStrategy() returns it directly.',
      'You will schedule the work anyway: pass a strategy list to asyncTask() and let it fall back.'
    ],
    avoidZh: [
      '只需要列表中第一个受支持的策略：resolveAsyncTaskStrategy() 会直接返回它。',
      '无论如何都要安排这项工作：把策略列表传给 asyncTask()，由它自动回退。'
    ]
  }),
  'utils:scheduler:repeat': guide({
    purposeEn:
      'Runs a task every interval without overlap: the next run is scheduled only after the previous one settles. The schedule is corrected against the start time, and after an overrun it realigns instead of firing a burst of catch-up runs.',
    purposeZh:
      '按固定间隔执行任务，且不会重叠：上一轮结束后才安排下一轮。时间表按起点校正漂移；某一轮超时后重新对齐，而不是连发补跑。',
    quickStart: `import { repeat } from '@migaia/utils/scheduler'

const poll = repeat(({ signal }) => refresh({ signal }), 30_000, { immediate: true, onError: 'continue' })
window.addEventListener('pagehide', () => poll.stop())`,
    scenariosEn: [
      'Poll an API without stacking requests when the server is slow.',
      'Refresh a dashboard periodically and stop cleanly when the page is hidden.'
    ],
    scenariosZh: [
      '轮询接口时，即使服务端很慢也不会叠加请求。',
      '定期刷新看板，并在页面隐藏时干净地停止。'
    ],
    avoidEn: [
      'The server can push updates: subscribe to them instead of polling.',
      'The task should run once after a delay: asyncTask() with a timeout is enough.'
    ],
    avoidZh: [
      '服务端能主动推送时：改用订阅，不要轮询。',
      '任务只需在延迟后执行一次：使用带超时的 asyncTask() 就够了。'
    ]
  }),
  'utils:scheduler:resolveAsyncTaskStrategy': guide({
    purposeEn:
      'Picks the first strategy the host supports from an ordered preference list, expanding auto in place. It is the same choice asyncTask() makes, so you can log or reuse it without scheduling anything.',
    purposeZh:
      '从有序的偏好列表中选出宿主支持的第一个策略，auto 会原地展开。它与 asyncTask() 的选择方式相同，可以在不安排任务的情况下记录或复用这个结果。',
    quickStart: `import { resolveAsyncTaskStrategy } from '@migaia/utils/scheduler'

console.log(resolveAsyncTaskStrategy(['postTaskBackground', 'idleCallback', 'timeout']))`,
    scenariosEn: [
      'Log which queue a background job will actually use on this host.',
      'Reuse the chosen strategy for many scheduled tasks without resolving it every time.'
    ],
    scenariosZh: [
      '记录后台任务在当前宿主上实际会使用哪个队列。',
      '多次安排任务时复用已选出的策略，不必每次都重新判断。'
    ],
    avoidEn: [
      'You need a yes or no for one strategy: isAsyncTaskSupported() answers that.',
      'You are about to schedule the task: asyncTask() accepts the list and resolves it itself.'
    ],
    avoidZh: [
      '只需要知道某个策略是否可用：使用 isAsyncTaskSupported()。',
      '马上就要安排任务：asyncTask() 可以直接接收列表并自行选择。'
    ]
  }),
  'utils:scheduler:throttle': guide({
    purposeEn:
      'Runs a function at most once per wait window, on the leading and trailing edge by default. With animationFrame it runs at most once per rendered frame with the latest arguments, on browser hosts only.',
    purposeZh:
      '让函数在每个等待窗口内最多执行一次，默认在窗口开头和结尾各执行。传入 animationFrame 时每帧最多执行一次并使用最新参数，仅适用于浏览器宿主。',
    quickStart: `import { throttle } from '@migaia/utils/scheduler'

const onScroll = throttle(() => updateHeader(window.scrollY), 'animationFrame')
window.addEventListener('scroll', onScroll)`,
    scenariosEn: [
      'Scroll or resize handlers should update the layout at most once per frame.',
      'Progress reports from a fast loop should reach the UI at a steady rate.'
    ],
    scenariosZh: [
      '滚动或缩放事件处理函数每帧最多更新一次布局。',
      '快速循环产生的进度信息应以稳定的频率送到界面。'
    ],
    avoidEn: [
      'Only the final call after a burst matters: use debounce().',
      'Every call must be handled: use coalesce() to receive them in one batch.'
    ],
    avoidZh: [
      '只关心一串调用结束后的最后一次：使用 debounce()。',
      '每次调用都必须处理：使用 coalesce() 一次性收到全部调用。'
    ]
  }),
  'utils:scheduler:timeSlice': guide({
    purposeEn:
      'Processes every item of a large or endless sequence in time slices: work runs until the slice budget is spent, then the host gets a turn. At least one item runs per slice; a handler throw closes the iterator and rejects with the original error.',
    purposeZh:
      '按时间片处理大量甚至无穷的数据：工作持续到本片预算用完，然后把执行权交还宿主。每片至少处理一项；处理函数抛错时关闭迭代器，并以原始错误拒绝。',
    quickStart: `import { timeSlice } from '@migaia/utils/scheduler'

await timeSlice(rows, (row) => searchIndex.add(row), { budget: 5 })`,
    scenariosEn: [
      'Index, parse or render tens of thousands of rows in the browser without freezing input.',
      'Keep a Node server responsive while a large batch job runs on the main thread.'
    ],
    scenariosZh: [
      '在浏览器里索引、解析或渲染成千上万行数据，同时不让输入卡住。',
      '在主线程跑大批量任务时，让 Node 服务仍能及时响应请求。'
    ],
    avoidEn: [
      'CPU work that must finish as fast as possible regardless of responsiveness: run it in a worker thread.',
      'You need the results of each item: timeSliceMap() collects them for you.'
    ],
    avoidZh: [
      '不在乎响应性、只求尽快算完的计算：放到工作线程里执行。',
      '需要每一项的结果：timeSliceMap() 会替你收集。'
    ]
  }),
  'utils:scheduler:timeSliceMap': guide({
    purposeEn:
      'Time-sliced map: collects every mapper result in source order, with the same slicing, abort and error behaviour as timeSlice(). Use it when a long mapping would otherwise block rendering or input.',
    purposeZh:
      '按时间片执行的 map：按原顺序收集每个映射结果，分片、中止和错误行为与 timeSlice() 相同。适合那些一次性执行会阻塞渲染或输入的长时间映射。',
    quickStart: `import { timeSliceMap } from '@migaia/utils/scheduler'

const parsed = await timeSliceMap(csvLines, parseLine)`,
    scenariosEn: [
      'Parse a large CSV file in the browser and keep the page responsive.',
      'Convert many records for display while the user keeps scrolling.'
    ],
    scenariosZh: [
      '在浏览器里解析大型 CSV 文件，同时保持页面可响应。',
      '在用户持续滚动的同时，转换大量记录用于展示。'
    ],
    avoidEn: [
      'You only need one combined value: timeSliceReduce() avoids keeping every result.',
      'The list is small enough to map in one go: use Array.prototype.map.'
    ],
    avoidZh: [
      '只需要一个汇总值：timeSliceReduce() 不必保留每一项结果。',
      '列表很小，一次映射完也不会卡：直接使用数组的 map。'
    ]
  }),
  'utils:scheduler:timeSliceReduce': guide({
    purposeEn:
      'Time-sliced reduce with an explicit initial accumulator, with the same slicing, abort and error behaviour as timeSlice(). It folds a long sequence into one value without blocking the host.',
    purposeZh:
      '按时间片执行、带显式初始累加值的 reduce，分片、中止和错误行为与 timeSlice() 相同。它把很长的序列折叠成一个值，同时不阻塞宿主。',
    quickStart: `import { timeSliceReduce } from '@migaia/utils/scheduler'

const total = await timeSliceReduce(orders, (sum, order) => sum + order.amount, 0)`,
    scenariosEn: [
      'Sum or aggregate a very large list in the browser without freezing the UI.',
      'Build one index object from an endless stream until it is aborted.'
    ],
    scenariosZh: [
      '在浏览器里汇总一个很大的列表，同时不让界面卡住。',
      '从持续到达的数据流中构建一个索引对象，直到被中止。'
    ],
    avoidEn: [
      'You need every mapped result, not one value: use timeSliceMap().',
      'The list is small: Array.prototype.reduce is simpler.'
    ],
    avoidZh: [
      '需要每一项的映射结果，而不是一个值：使用 timeSliceMap()。',
      '列表很小：直接使用数组的 reduce 更简单。'
    ]
  }),
  'utils:scheduler:yieldToHost': guide({
    purposeEn:
      'Resolves after yielding to the host once, so rendering, input, timers and I/O can run. Await it inside a long loop that you control yourself when timeSlice() does not fit the loop shape.',
    purposeZh:
      '让出宿主一次后完成，使渲染、输入、定时器和 I/O 有机会运行。在自己控制的长循环里 await 它，适合 timeSlice() 不方便套用的循环结构。',
    quickStart: `import { yieldToHost } from '@migaia/utils/scheduler'

for (const [position, row] of rows.entries()) {
  index(row)
  if (position % 500 === 0) await yieldToHost()
}`,
    scenariosEn: [
      'A hand-written loop with early exits should still let the page repaint now and then.',
      'A long synchronous migration step should let pending I/O callbacks run between chunks.'
    ],
    scenariosZh: [
      '带有提前退出的手写循环，仍希望页面时不时能重绘。',
      '耗时的同步迁移步骤，希望在分块之间让待处理的 I/O 回调运行。'
    ],
    avoidEn: [
      'The loop simply processes every item: timeSlice() measures the budget for you.',
      'You need to wait for a duration: use sleep().'
    ],
    avoidZh: [
      '循环只是逐项处理：timeSlice() 会替你计算时间预算。',
      '需要等待一段时间：使用 sleep()。'
    ]
  })
}
