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
  'storage-contract': '定义键值、记录、向量、RDF 与对象存储能力、查询和事务契约。',
  'storage-web': '通过宿主插件读写 Web Storage、Cookie 与 IndexedDB，按需启用响应式查询。',
  'storage-host':
    '把内存、数据库和文件后端装到同一个存储宿主（host），用带类型的 backend(id) 获取对应存储，并统一结束工作与释放资源。适合同时使用多个数据源、需要组织隔离或事务的应用：先安装后端插件，再选择各后端提供的能力；多个后端的写入不会自动合成一个原子事务。',
  'storage-plugin-redis':
    '把 Redis 或 Valkey 接到统一存储接口，集中处理组织键、过期时间、记录查询和显式键锁，减少业务代码逐次拼接物理键和补写期限的负担。选择已连接客户端对应的驱动并安装插件后，可按需增加 Streams、限流或向量检索；可用能力取决于服务模块与驱动，Redis 的事务部分失败限制仍然适用。',
  'storage-plugin-postgres':
    '把 PostgreSQL 接到统一存储接口，避免文本、记录、过期时间和应用 SQL 分别提交时出现一半更新成功的情况。将已有客户端或连接池交给对应驱动，再把插件安装到 host，就能在同一数据库事务中组合这些操作；通知、逻辑复制和向量等能力按需选择，客户端仍由应用负责关闭。',
  'storage-plugin-sqlite':
    '用运行时内置的 SQLite 保存本地设置、离线记录和缓存，让文本、记录、过期时间与应用 SQL 可以在同一个数据库事务内提交。选择运行时对应的驱动和数据库文件或内存库，再把插件安装到 host，无需另装 npm 原生数据库扩展；连接由应用创建和关闭，根入口不自动选择或加载驱动。',
  'storage-plugin-qdrant':
    '在真实 Qdrant 服务中保存向量及属性，并提供近邻搜索、筛选和支持的重排。业务代码不必在每次请求中重新拼接组织筛选条件。先配置服务地址，把插件安装到存储宿主，再选择向量能力与集合；标准查询在排名前筛选组织和期限，过期数据由应用显式删除。',
  'storage-plugin-sparql':
    '为知识图谱应用提供统一的 RDF 查询与修改接口，可连接远程 SPARQL 端点或本地 Oxigraph。查询链处理四元组，也就是包含主语、谓词、对象和图的数据；选择适配器并安装插件后，应用可用 RDF 值构造查询，并通过 expect 声明提交时必须仍存在的四元组。网络写入结果未知时不会自动重试。',
  'storage-plugin-object':
    '用同一套 blob API 将附件、导出文件等二进制内容保存到专用目录或 S3，并按需读取完整字节、流或指定范围。选择文件或 S3 驱动，再把 object 插件安装到 host，即可使用组织隔离与读取资源释放；条件写入须由所选驱动和服务实际支持，本包不提供普通键值存储或事务。',
  'storage-plugin-cache':
    '把已安装的键值后端按快慢顺序组合成多级缓存，让重复查询共享回源结果，并把下层读到的数据补到上层。适合同时使用内存和持久存储、又不想逐次手写回填与失效传播的应用；可设置缓存期限、缺失值缓存和延后写入，各层之间不提供原子提交，延后写入也不是持久队列。',
  'storage-plugin-archive':
    '当历史数据挤占日常读写的存储空间时，把不常访问的旧记录移到 blob 对象存储，同时保留按原键读取和显式恢复的入口。将插件接到已安装的热后端和对象后端后，由应用主动运行归档规则，减少热表需要保留的数据；归档按段提交，不把整个任务当成跨存储事务。',
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
    'Define capabilities, queries and transactions for key-value, record, vector, RDF and object storage.',
  'storage-web':
    'Read and write Web Storage, cookies and IndexedDB through host plugins, with optional reactive queries.',
  'storage-host':
    'Bring memory, database and file backends into one storage host, select each through typed backend(id) calls, and finish storage work with one cleanup entry point. Use it when an application needs several data sources, organization isolation or transactions: install the relevant plugins, then select the capabilities each backend provides. Writes across separate backends do not automatically form one atomic transaction.',
  'storage-plugin-redis':
    'Use Redis or Valkey through one storage API that handles organization keys, expiry, record queries and explicit key locks, reducing repeated key-prefix and expiry code. Choose a driver for your connected client or pool, install the plugin, and add Streams, rate limiting or vector search when needed. Available capabilities depend on the server modules and driver; Redis transaction partial-failure limits still apply.',
  'storage-plugin-postgres':
    'Use PostgreSQL through one storage API when text, records, expiry and application SQL must commit together rather than leave half an update saved. Pass an existing client or pool to its driver and install the plugin in a host, then combine these operations in the same database transaction. Select notifications, logical replication or vectors separately when needed; your application still closes the client.',
  'storage-plugin-sqlite':
    "Store local settings, offline records and caches with the runtime's built-in SQLite, combining text, records, expiry and application SQL in one database transaction. Select the driver for your runtime and a database file or in-memory database, then install the plugin in a host without adding an npm native database extension. Your application creates and closes the connection; the root import does not choose or load a driver automatically.",
  'storage-plugin-qdrant':
    'Store vectors and their payloads in a real Qdrant service, then use query chains for nearest-neighbor search, filtering and supported reranking instead of repeating native requests and organization filters throughout the application. Configure the service URL, install the plugin in a host, and select the vector capability and a collection. Standard queries apply organization and expiry filters before ranking; physically removing expired points is an explicit application operation.',
  'storage-plugin-sparql':
    'Give knowledge-graph applications one RDF query and mutation API for a remote SPARQL endpoint or local Oxigraph store. Query chains handle quads: data made of a subject, predicate, object and graph. Install the plugin with the selected adapter, construct queries from RDF values, and use expect to require specific quads to remain present at commit. A network write with an unknown outcome is not retried automatically.',
  'storage-plugin-object':
    'Save attachments, exports and other binary content in a dedicated directory or S3 through the same blob API, then read complete bytes, a stream or a selected range. Choose a file or S3 driver and install the object plugin in a host to use organization isolation and disposable reads. Conditional writes require support from the selected driver and service; this package does not provide ordinary key-value storage or transactions.',
  'storage-plugin-cache':
    'Arrange installed key-value backends from faster to slower cache tiers, share loads for repeated requests, and fill upper tiers from lower ones. Use it to combine memory and persistent storage without writing refill and invalidation logic at every call. Configure expiry, caching of missing results and optional delayed writes as needed; tiers do not commit atomically, and delayed writes are not a durable queue.',
  'storage-plugin-archive':
    'When historical records crowd the storage used for everyday updates, move rarely read records into blob storage while keeping reads by original key and an explicit restore operation. Connect the plugin to installed hot and object backends, then run archive rules when your application chooses to reduce the data kept in hot tables. Each segment commits separately; the whole archive job is not a transaction across both stores.',
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
