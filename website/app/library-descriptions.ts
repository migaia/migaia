import libraryIndexManifest from '../src/generated/manifests/library-index.json'
import type { ILocale } from './route-contract.js'

/**
 * Lightweight library facts (slug, npm description, version) shared by the shell and the docs
 * route.
 */
export const LIBRARY_INDEX = libraryIndexManifest.libraries as readonly {
  readonly slug: string
  readonly description: string | null
  readonly version: string | null
  readonly exports: readonly string[]
}[]

/** README-backed Chinese summaries explain what each library helps readers accomplish. */
export const LIBRARY_REFERENCE_DESCRIPTIONS_ZH = {
  capability: '按开关启停可选功能，为不同租户隔离功能开关，并按依赖启动和释放功能。',
  'event-subscriber': '在本地模块间订阅和广播事件，并协调同步或异步监听器的执行。',
  lifecycle:
    '让关闭、取消和替换在并发下也不出错：按顺序释放资源、只采用最新请求的结果、限时等待进行中的工作。',
  logger: '将日志输出到控制台或服务，按需要过滤和格式化，并等待异步输出完成。',
  'micro-hub':
    '为同一页面里的多个微前端应用提供共享状态、事件和请求。主应用创建唯一的 hub，各应用通过带类型和版本的契约协作；每份状态有明确的所有者，只有所有者和指定应用能写，应用卸载时统一释放它登记的订阅和请求处理函数。',
  'middleware-pipeline':
    '把处理步骤组合为同步、异步或生成器中间件管线，并在需要时提前结束或取消处理。',
  'plugin-host': '为库或应用安装和卸载插件，配置共享能力与处理步骤，并在安装失败时回滚。',
  reactive: '让状态变化自动更新派生值和副作用，并为不同使用场景隔离状态。',
  resource: '随输入变化加载异步数据，取消过期请求、重试失败请求并刷新缓存。',
  'rpc-browser': '在浏览器窗口、iframe、SharedWorker 与可靠有序的 WebRTC 通道之间调用函数。',
  'rpc-contract': '为自定义 RPC 实现校验和编解码消息，让不同对端按同一协议通信。',
  'rpc-core': '跨运行时调用远程函数，并为调用设置超时、取消和流式结果处理。',
  'rpc-devtools': '采集、查询和录制 RPC 元数据，并查看多个宿主的时间线与调用统计。',
  'rpc-pool': '将 RPC 调用分配到线程池或进程池，并用有限队列承接繁忙时的请求。',
  'rpc-process': '在子进程或本机服务中运行隔离任务，并通过 RPC 调用和管理它们。',
  'rpc-threads': '把重计算移到 Worker，并通过 RPC 调用、管理和重启线程。',
  serialize: '把应用数据编码为可存储或传输的格式，并在读取时解码。',
  'storage-contract': '为键值和记录存储定义统一接口，让应用可以接入不同存储后端。',
  'storage-web': '通过统一接口读写 Web Storage、cookie、IndexedDB 和内存中的数据。',
  'store-devtools': '查看 Store 的状态与 action 历史，通过时间旅行和依赖树定位状态变化。',
  'store-indexed': '在对象、数组、Map 和 Set 中按键或索引订阅变化，让相关计算随集合更新。',
  'store-keyed': '在独立作用域中按业务 key 管理状态，并只订阅需要的部分。',
  'store-light': '管理对象状态、异步数据和更新操作，让相关计算随字段变化自动更新。',
  'store-middleware': '跟踪 Store 的状态与 action、约束写入规则，并接入 Redux DevTools。',
  'store-persist': '自动保存和恢复对象、按键管理的状态与集合，并在版本变化时迁移已保存数据。',
  'store-react': '在 React 组件中使用 Store、Atom 与异步资源，并管理订阅和退出时的清理。',
  'store-shared': '让主线程与 Worker 共同读写同一组响应式 32 位整数状态。',
  'store-ssr': '隔离每个 SSR 请求的 Store 与 Resource，并将服务端初始状态恢复到浏览器。',
  'store-wasm': '在 WASM 中管理可订阅的数值、字符串、数组和记录状态。',
  'store-worker': '把耗时计算和数据编解码移到 Worker，并为请求使用取消、去重和缓存功能。',
  supervision:
    '看管后台任务、子进程和线程：崩溃后间隔递增地重启，失败太多就停下，停止有时限，真正退出后才释放名额。',
  tray: '启动、查找、调用和重启一组插件宿主，包括 Node Worker 与子进程，并在退出时释放它们。',
  utils: '为代码添加超时、取消与错误追踪，并处理常见的数据转换和对象更新。',
  wasm: '分配可复用的字节缓冲区，并在 JSON 与 MessagePack 之间转码。'
} as const satisfies Readonly<Record<string, string>>

/** README-backed English summaries mirror the same user-facing responsibilities. */
export const LIBRARY_REFERENCE_DESCRIPTIONS_EN = {
  capability:
    'Enable or disable optional features, keep tenant feature settings separate, and start and release features in dependency order.',
  'event-subscriber':
    'Subscribe to and broadcast events between local modules and coordinate synchronous or asynchronous listeners.',
  lifecycle:
    'Keep shutdown, cancellation and replacement correct under concurrency: release resources in order, accept only the latest result, and wait for work in flight with a deadline.',
  logger:
    'Send logs to a console or service, filter and format them as needed, and wait for asynchronous output to finish.',
  'micro-hub':
    'Share state, events, and requests between micro-frontend apps on one page. The shell creates one hub, and apps work through typed, versioned contracts. Each piece of state has one owner; only that owner and designated apps can write it. Unmounting an app releases its subscriptions and request handlers together.',
  'middleware-pipeline':
    'Combine processing steps into synchronous, asynchronous, or generator middleware pipelines and stop or cancel processing when needed.',
  'plugin-host':
    'Install and remove plugins for libraries or applications, configure shared features and processing steps, and roll back failed installations.',
  reactive:
    'Update derived values and effects when state changes and keep state separate across contexts.',
  resource:
    'Load asynchronous data as inputs change, cancel stale requests, retry failures, and refresh cached results.',
  'rpc-browser':
    'Call functions across browser windows, iframes, SharedWorkers, and reliable ordered WebRTC channels.',
  'rpc-contract':
    'Validate, encode, and decode messages for custom RPC implementations so peers can communicate through the same protocol.',
  'rpc-core':
    'Call remote functions across runtimes with timeouts, cancellation, and streaming results.',
  'rpc-devtools':
    'Collect, query, and record RPC metadata and inspect timelines and call statistics across hosts.',
  'rpc-pool':
    'Distribute RPC calls across thread or process pools and queue requests within bounded limits when busy.',
  'rpc-process':
    'Run isolated work in child processes or local services and call and manage them through RPC.',
  'rpc-threads':
    'Move heavy computation into Workers and call, manage, and restart threads through RPC.',
  serialize: 'Encode application data for storage or transmission and decode it when reading.',
  'storage-contract':
    'Define common interfaces for key-value and record storage so applications can use different backends.',
  'storage-web':
    'Read and write data in Web Storage, cookies, IndexedDB, and memory through a common interface.',
  'store-devtools':
    'Inspect Store state and action history and use time travel and dependency trees to investigate changes.',
  'store-indexed':
    'Subscribe to keys or indices in objects, arrays, Maps, and Sets so related computations respond to collection updates.',
  'store-keyed':
    'Manage state by business key in separate scopes and subscribe only to the parts you need.',
  'store-light':
    'Manage object state, asynchronous data, and updates so related computations respond to field changes.',
  'store-middleware':
    'Trace Store state and actions, enforce write rules, and connect to Redux DevTools.',
  'store-persist':
    'Automatically save and restore object, keyed, and collection state and migrate saved data when versions change.',
  'store-react':
    'Use Stores, Atoms, and asynchronous resources in React components and manage subscriptions and cleanup.',
  'store-shared':
    'Read and write the same reactive 32-bit integer state from the main thread and Workers.',
  'store-ssr':
    "Keep Stores and Resources separate for each SSR request and restore the server's initial state in the browser.",
  'store-wasm': 'Manage observable numbers, strings, arrays, and records in WASM.',
  'store-worker':
    'Move expensive computation and data encoding and decoding into Workers and use cancellation, deduplication, and caching for requests.',
  supervision:
    'Watch background tasks, child processes and threads: restart crashes with a growing delay, give up when failures pile up, stop on time, and free a slot only after a real exit.',
  tray: 'Start, find, call, and restart plugin hosts, including Node Workers and child processes, and release them on shutdown.',
  utils:
    'Add deadlines, cancellation, and error tracing to code and handle common data conversions and object updates.',
  wasm: 'Allocate reusable byte buffers and transcode between JSON and MessagePack.'
} as const satisfies Readonly<Record<string, string>>

/** Returns reader-facing ownership context for a linked library reference. */
export function libraryReferenceDescription(locale: ILocale, slug: string): string {
  if (locale === 'zh')
    return LIBRARY_REFERENCE_DESCRIPTIONS_ZH[slug as keyof typeof LIBRARY_REFERENCE_DESCRIPTIONS_ZH]
  return (
    LIBRARY_REFERENCE_DESCRIPTIONS_EN[slug as keyof typeof LIBRARY_REFERENCE_DESCRIPTIONS_EN] ??
    LIBRARY_INDEX.find((entry) => entry.slug === slug)?.description ??
    slug
  )
}
