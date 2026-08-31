import { webRpcApiGuides } from './web-rpc-api-guides.js'
import { utilsApiGuides } from './utils-api-guides.js'
import { completionApiGuides } from './completion-api-guides.js'
import { isCallableApiSymbol, type IApiSymbol } from './content-contract.js'

export type IGuideLocale = 'en' | 'zh'

export type IApiOptionGuide = {
  readonly description: string
  readonly defaultValue?: string
  readonly example?: string
  readonly name: string
  readonly optional?: boolean
  readonly type?: string
  readonly whenToUse: string
}

export type IApiGuide = {
  readonly avoidWhen: readonly string[]
  readonly options: readonly IApiOptionGuide[]
  readonly purpose: string
  readonly quickStart?: string
  readonly scenarios: readonly string[]
}

/** Shared field translations whose semantics are identical across several public endpoints. */
const optionTranslations: Readonly<
  Record<string, Readonly<Partial<Record<IGuideLocale, string>>>>
> = {
  'plugin-host:defined:setupHost:host': {
    en: 'Host execution, pipeline, and diagnostic policies used by the new host. These values govern every plugin installed during and after setup.',
    zh: '新 Host 的执行超时、pipeline 与诊断策略；这里的设置同时约束初始化阶段和之后安装的所有插件。'
  },
  'plugin-host:defined:setupHost:setupTimeoutMs': {
    en: 'Maximum duration for core creation and the initial plugin batch. Use false only when the caller deliberately accepts an unbounded setup wait.',
    zh: '创建 core 并安装首批插件允许使用的总时长；只有调用方明确接受无限等待时才设为 false。'
  },
  'plugin-host:defined:setupHost:signal': {
    en: 'Optional caller-owned cancellation signal. Aborting it stops setup, preserves the abort reason, and rolls back resources already registered by the core or plugins.',
    zh: '由调用方持有的可选取消信号；触发后会停止初始化、保留取消原因，并回滚 core 或插件已经登记的资源。'
  },
  'plugin-host:defined:setupHost:core': {
    en: 'Creates the domain object shared with plugins. Register every resource created during this callback through context.onDispose so failed setup can clean it up.',
    zh: '创建提供给插件使用的领域对象；回调中创建的连接、监听器等资源必须交给 context.onDispose，初始化失败时才能自动清理。'
  },
  'plugin-host:defined:setupHost:plugins': {
    en: 'Initial plugins installed as one batch after the core succeeds. If any plugin fails, the batch and core resources are rolled back instead of publishing a partial host.',
    zh: 'core 创建成功后一次性安装的首批插件；任一插件失败都会回滚整批插件和 core 资源，不会返回只完成一部分的 Host。'
  },
  'plugin-host:*:*:execution': {
    en: 'Required time limits for plugin changes and removal. Set each child field explicitly so a stalled hook cannot silently block the host forever.',
    zh: '插件安装、更新与移除使用的必填时间限制；必须明确填写子项，避免卡住的 hook 无限阻塞 Host。'
  },
  'plugin-host:*:*:execution.mutationTimeoutMs': {
    en: 'Maximum time for one admitted plugin install, update, or removal hook. false waits without a deadline and should be reserved for controlled hosts.',
    zh: '单次插件安装、更新或移除 hook 的最长执行时间；false 表示永久等待，只适合能够自行保证 hook 结束的受控宿主。'
  },
  'plugin-host:*:*:execution.pipelineDrainTimeoutMs': {
    en: 'Maximum wait for currently running pipeline calls to finish before logical plugin removal continues. false waits until every active call exits.',
    zh: '移除插件前等待正在运行的 pipeline 调用结束的最长时间；false 会一直等到所有活动调用退出。'
  },
  'plugin-host:*:*:pipeline': {
    en: 'Pipeline behavior used when plugin stages run, including execution mode and violation handling. Omit it to use the Host defaults.',
    zh: '插件 stage 运行时采用的 pipeline 行为，包括执行模式和违规处理；省略时使用 Host 默认策略。'
  },
  'plugin-host:*:*:diagnostic': {
    en: 'Receives non-fatal Host diagnostics with an optional stable error code. Use it to forward warnings to application logging or monitoring.',
    zh: '接收不会直接终止操作的 Host 诊断及可选稳定错误码；可把这些信息转发到应用日志或监控系统。'
  },
  'plugin-host:*:*:pipeline.mode': {
    en: 'Chooses how pipeline stages are invoked. Select the mode required by the registered stage functions rather than converting values at each call site.',
    zh: '选择 pipeline stage 的调用方式；应按已注册 stage 的函数形态选择，而不是在每个调用点临时转换。'
  },
  'plugin-host:*:*:scheduler': {
    en: 'Clock and timer implementation used by queue admission, disposal deadlines, and other Host time budgets. Omit it to use the lifecycle system scheduler; inject one for deterministic tests or a host-specific clock.',
    zh: 'queue admission、dispose deadline 等 Host 时间预算共用的时钟与 timer 实现；省略时使用 lifecycle system scheduler，确定性测试或特殊宿主可注入自己的 scheduler。'
  },
  'plugin-host:*:*:queueAdmissionTimeoutMs': {
    en: 'Maximum time a mutation may wait in the Host queue before it is rejected. undefined reports slow admission without rejecting, false disables both the timer and rejection, and a number enforces the deadline.',
    zh: 'mutation 在 Host 队列中等待准入的最长时间；undefined 只报告等待过久但不拒绝，false 关闭 timer 与拒绝，number 会强制执行 deadline。'
  },
  'plugin-host:*:*:queueAdmissionDiagnosticMs': {
    en: 'Warning threshold used only when queueAdmissionTimeoutMs is undefined. false disables the diagnostic timer; a number reports slow queue admission without cancelling the mutation.',
    zh: '仅在 queueAdmissionTimeoutMs 为 undefined 时使用的警告阈值；false 关闭诊断 timer，number 会报告排队过久但不会取消 mutation。'
  },
  'plugin-host:*:*:disposeStepTimeoutMs': {
    en: 'Maximum wait for one resource disposer before the Host invokes its force-cleanup path. false permits an unbounded wait and should be reserved for disposers guaranteed to settle.',
    zh: '等待单个资源 disposer 完成的最长时间，超时后 Host 会进入 force-cleanup 路径；false 表示永久等待，只适合保证一定结束的 disposer。'
  },
  'logger:*:*:maxSize': {
    en: 'Maximum entries collected before the current batch is sent immediately; use a smaller value for lower latency and a larger value for fewer requests.',
    zh: '当前批次达到该条目数后立即发送；较小值降低延迟，较大值减少请求次数。'
  },
  'logger:*:*:maxWaitMs': {
    en: 'Maximum time from the first entry until a partial batch is sent, preventing low-volume logs from waiting indefinitely.',
    zh: '从首条 entry 进入到发送未满批次的最长时间，避免低流量日志无限等待。'
  },
  'logger:*:*:maxConcurrentBatches': {
    en: 'Maximum batch callbacks running at once. It must be a positive safe integer and bounds transport concurrency.',
    zh: '同时运行的 batch 回调上限；必须是正安全整数，用于约束 transport 并发。'
  },
  'logger:*:*:maxPendingBatches': {
    en: 'Maximum queued plus running batches. Reaching it fails with BATCH_OVERFLOW instead of silently dropping entries.',
    zh: '排队中与运行中 batch 的总上限；达到上限以 BATCH_OVERFLOW 失败，不会静默丢日志。'
  },
  'logger:*:*:asyncOutput': {
    en: 'Schedules output through the Logger deferred-work tracker so the caller returns synchronously while flush and shutdown still await completion.',
    zh: '通过 Logger 的 deferred-work tracker 调度输出，让调用方同步返回，同时仍由 flush 与 shutdown 等待完成。'
  },
  'logger:*:*:color': {
    en: 'ANSI color policy: auto follows runtime TTY support, always forces color, and never emits ANSI sequences.',
    zh: 'ANSI 颜色策略：auto 跟随运行时 TTY，always 强制着色，never 不输出 ANSI 序列。'
  },
  'logger:*:*:format': {
    en: 'Console serialization format. auto chooses for the runtime, pretty favors human reading, and json favors machine ingestion.',
    zh: '控制台序列化格式：auto 按运行时选择，pretty 面向人类阅读，json 面向机器采集。'
  },
  'logger:*:*:timestamp': {
    en: 'Includes the ISO timestamp in pretty console output. Disable it only when another collector already owns timestamps.',
    zh: '在 pretty 控制台输出中包含 ISO 时间；仅在外层采集器已经统一加时间时关闭。'
  },
  'logger:*:*:colorMessage': {
    en: 'Chooses which portion of the rendered message receives the tag color: head, tail, both ends, all text, or none.',
    zh: '选择消息中由 tag 颜色覆盖的范围：开头、结尾、两端、全文或不着色。'
  },
  'logger:*:*:colorMap': {
    en: 'Overrides tag-to-color functions while retaining the built-in map for unspecified tags.',
    zh: '覆盖指定 tag 的着色函数；未提供的 tag 继续使用内置映射。'
  },
  'logger:*:*:url': {
    en: 'Required HTTP endpoint that receives POST requests containing an entries array.',
    zh: '必填 HTTP endpoint，接收包含 entries 数组的 POST 请求。'
  },
  'logger:*:*:authToken': {
    en: 'Optional bearer token written to Authorization. Keep credential ownership outside Logger and rotate it through plugin replacement.',
    zh: '可选 bearer token，会写入 Authorization；凭据所有权应留在 Logger 外，并通过插件替换轮换。'
  },
  'logger:*:*:headers': {
    en: 'Additional request headers copied into each HTTP delivery without replacing the plugin-owned content type.',
    zh: '复制到每次 HTTP 发送的附加请求头，不替换插件拥有的 content type。'
  },
  'logger:*:*:retries': {
    en: 'Additional attempts for network failures, HTTP 429, and 5xx responses. Other 4xx responses fail without retry.',
    zh: '网络失败、HTTP 429 与 5xx 的额外重试次数；其他 4xx 不重试。'
  },
  'logger:*:*:requestTimeoutMs': {
    en: 'Maximum duration of one HTTP attempt before its request is aborted and handled as a retryable network failure.',
    zh: '单次 HTTP 尝试的最长时间；超时会 abort 请求，并按可重试网络失败处理。'
  },
  'logger:*:*:batch': {
    en: 'Optional per-HTTP override for the batch capability supplied by an earlier batch plugin. Install batch() before http().',
    zh: '对先安装的 batch 插件所提供能力进行 HTTP 局部覆盖；必须先安装 batch()，再安装 http()。'
  },
  'logger:*:*:batch.maxSize': {
    en: 'Overrides the shared batch maximum for HTTP delivery; reaching it sends the current entries immediately.',
    zh: '覆盖 HTTP 发送使用的 batch 条目上限；达到该值后立即发送当前 entries。'
  },
  'logger:*:*:batch.maxWaitMs': {
    en: 'Overrides how long an incomplete HTTP batch may wait after its first entry.',
    zh: '覆盖未满 HTTP batch 从首条 entry 开始允许等待的最长时间。'
  },
  'logger:*:*:batch.maxConcurrentBatches': {
    en: 'Overrides the number of HTTP batches allowed to send concurrently.',
    zh: '覆盖允许并发发送的 HTTP batch 数量。'
  },
  'logger:*:*:batch.maxPendingBatches': {
    en: 'Overrides the total queued and active HTTP batch bound; overflow remains explicit rather than lossy.',
    zh: '覆盖排队与运行中 HTTP batch 的总上限；溢出仍显式失败，不会丢弃。'
  },
  'logger:*:*:batch.asyncOutput': {
    en: 'Overrides whether full HTTP batches are scheduled through deferred Logger output tracking.',
    zh: '覆盖满批 HTTP 发送是否经 Logger deferred output tracker 调度。'
  },
  'logger:*:*:maxRetryAfterMs': {
    en: 'Caps a server-provided Retry-After delay so one response cannot postpone shutdown or delivery beyond the accepted retry budget.',
    zh: '限制服务端 Retry-After 的最大等待，避免单个响应把 shutdown 或发送推迟到重试预算之外。'
  },
  'logger:*:*:level': {
    en: 'Minimum accepted severity. Entries below it are stopped in the pipeline before reaching hooks and sinks downstream.',
    zh: '最低接收级别；低于该级别的 entry 会在 pipeline 中被拦截，不再进入下游 hook 与 sink。'
  },
  'logger:*:*:filters': {
    en: 'Additional predicates combined with logical AND. Every filter must accept an entry for it to continue.',
    zh: '以逻辑 AND 组合的附加过滤器；所有 filter 都接受时 entry 才继续。'
  },
  'logger:*:*:captureCrashes': {
    en: 'Registers uncaughtException and unhandledRejection handling where a process runtime exists; browser-like hosts remain a no-op.',
    zh: '在存在 process runtime 时处理 uncaughtException 与 unhandledRejection；浏览器类宿主中为 no-op。'
  },
  'logger:*:*:shutdownTimeoutMs': {
    en: 'Maximum process-adapter drain time after a signal, crash, or exit boundary before control returns to the runtime.',
    zh: '收到 signal、崩溃或 exit 边界后，process adapter 等待 drain 的最长时间。'
  },
  'logger:*:*:interceptProcessExit': {
    en: 'Intercepts process.exit to flush first. It changes immediate-exit semantics and should be enabled only when that ownership is intentional.',
    zh: '拦截 process.exit 并先 flush；这会改变立即退出语义，仅在明确接管该边界时开启。'
  },
  'logger:*:*:labels': {
    en: 'Groups the human-readable labels used when reasoning and response streams begin.',
    zh: '归组 reasoning 与 response 流开始时使用的人类可读标签。'
  },
  'logger:*:*:labels.thinking': {
    en: 'Label written when a thinking stream starts; it does not change the structured reasoning entry tag.',
    zh: 'thinking 流开始时写出的标签，不改变结构化 reasoning entry 的 tag。'
  },
  'logger:*:*:labels.response': {
    en: 'Optional label written when a response stream starts; omit it when the surrounding UI already owns the heading.',
    zh: 'response 流开始时的可选标签；外层 UI 已经拥有标题时可省略。'
  },
  'logger:*:*:display': {
    en: 'Shows the generated UUID in color-plugin output while retaining UUID data on every entry regardless of display.',
    zh: '在 color 插件输出中显示生成的 UUID；无论是否显示，每条 entry 都保留 UUID 数据。'
  },
  'plugin-host:index:PluginHost:execution': {
    zh: '必填执行预算组，分别约束已经开始的 lifecycle mutation 与逻辑撤销后的 pipeline drain。'
  },
  'plugin-host:index:PluginHost:execution.mutationTimeoutMs': {
    zh: '一次 install、update 或 removal hook 的最长执行时间；超时后该 operation 失去提交资格。'
  },
  'plugin-host:index:PluginHost:execution.pipelineDrainTimeoutMs': {
    zh: '插件 stage 被逻辑撤销后，等待已经开始的 pipeline lease 归零的最长时间。'
  },
  'plugin-host:index:PluginHost:pipeline': {
    zh: '选择 Host 唯一且构造后不可切换的 pipeline 执行模型。'
  },
  'plugin-host:index:PluginHost:pipeline.mode': {
    zh: '根据同步、异步洋葱、generator 或 async-generator 控制流选择 pipeline 模式。'
  },
  'plugin-host:index:PluginHost:diagnostic': {
    zh: '接收迟到调用、排队等待及回滚二次失败等非终止性诊断；回调失败会被隔离。'
  },
  'plugin-host:index:PluginHost:scheduler': {
    zh: '为 mutation、排队、drain 和 disposer timeout 提供统一时间域与排程。'
  },
  'plugin-host:index:PluginHost:queueAdmissionTimeoutMs': {
    zh: '限制尚未开始的 mutation 在 FIFO 队列中等待的时间；数字会拒绝超时任务，false 关闭 timer。'
  },
  'plugin-host:index:PluginHost:queueAdmissionDiagnosticMs': {
    zh: '未启用 admission timeout 时，仅在排队越过阈值后报告诊断而不拒绝 mutation。'
  },
  'plugin-host:index:PluginHost:disposeStepTimeoutMs': {
    zh: '限制单个 disposer 或插件清理 hook；超时记录 cleanupErrors，但 Host 继续进入逻辑终态。'
  },
  'storage-web:*:*:report': {
    en: 'Receives contained late rejections and cleanup failures from host installation or disposal; it never replaces the primary operation result or primary error.'
  },
  'capability:graph-dynamic:createDynamicCapabilityGraph:report': {
    zh: '接收已隔离的启动、释放与迟到失败，不替换图操作的主要结果或主要错误。'
  },
  'capability:graph-dynamic:createDynamicCapabilityGraph:mutationAdmissionMs': {
    zh: '限制已接受 mutation 在更早的串行 mutation 后等待进入执行的最长时间。'
  },
  'capability:graph-dynamic:createDynamicCapabilityGraph:startBatch': {
    zh: '由组合层启动一个已按拓扑排序的受影响 frontier。'
  },
  'capability:graph-dynamic:createDynamicCapabilityGraph:releaseBatch': {
    zh: '由组合层释放一个已封闭的级联批次。'
  },
  'capability:index:createCapabilityHost:flags': {
    en: 'Initial capability gate snapshot. Later mutation or replacement of the options object does not change host behavior.'
  },
  'capability:index:createCapabilityHost:onError': {
    en: 'Contained capability failure reporter captured with its original receiver during host construction.'
  },
  'capability:graph:createCapabilityGraph:onError': {
    en: 'Failure reporter read before the root lifecycle scope is created. A throwing getter or non-callable value rejects as GRAPH_INVALID_OPTION.'
  },
  'lifecycle:index:createMutationQueue:onAdmissionDiagnostic': {
    en: 'Diagnostic callback invoked when queue admission crosses admissionDiagnosticMs without an admission timeout taking ownership.'
  },
  'lifecycle:index:createMutationQueue:owner': {
    en: 'Task owner identity used to reject same-owner self-dependency in the FIFO queue as QUEUE_SELF_DEPENDENCY.'
  },
  'lifecycle:*:*:scheduler': {
    en: 'Scheduler that owns lifecycle time, deadlines, snapshots, and deterministic waiting. Defaults to systemScheduler where applicable.'
  },
  'lifecycle:*:*:errorPolicy': {
    en: "Cleanup failure policy: 'throw', 'collect', 'report', or 'firstError'. Throw is the default where supported."
  },
  'middleware-pipeline:*:*:signal': {
    en: 'Optional cooperative cancellation signal exposed to stage context. Pre-aborted admission rejects before the stage starts and preserves Error reason identity.'
  },
  'middleware-pipeline:index:runAsyncMiddleware:onViolation': {
    en: "Receives 'duplicate' when next is called twice and 'late' when a saved next is called after its stage returns; violations resolve empty rather than throwing."
  },
  'middleware-pipeline:index:runAsyncMiddleware:assertActive': {
    en: 'Admission guard called before each async middleware frame. A thrown control error propagates immediately and prevents that stage from running.'
  },
  'lifecycle:index:createMutationQueue:waitedMs': {
    zh: '进入队列的 mutation 等待超过该毫秒数时触发 admission 诊断；诊断包含当前 owner 与实际等待时间。'
  },
  'serialize:core:collectStream:empty': {
    en: 'Controls whether an empty stream resolves to empty text or rejects. Defaults to returning text.',
    zh: '决定空 stream 返回空文本还是拒绝；默认返回文本结果。'
  },
  'serialize:*:*:signal': {
    en: 'Cooperative cancellation signal. An already-aborted signal rejects with ABORTED while preserving any progress produced before cancellation.'
  },
  'serialize:*:*:context': {
    en: 'Caller-owned operation context forwarded through codec execution and stream work without changing payload semantics.'
  },
  'serialize:*:*:scheduler': {
    en: 'Lifecycle scheduler used for cooperative yields, deadlines, and deterministic timing. Defaults to the system scheduler where applicable.'
  },
  'serialize:core:encodeStream:type': {
    en: 'Registered codec type used for each encoded slice. Unknown or duplicate registry types are rejected with INVALID_OPTION.'
  },
  'serialize:core:encodeStream:maxInFlight': {
    en: 'Maximum number of encoded slices allowed in flight. Defaults to 1 for bounded backpressure; higher values overlap encoding and consumption at proportional memory cost.'
  },
  'serialize:core:encodeStream:targetMs': {
    en: 'Target processing time per adaptive slice. Defaults to 8 ms so a 60 fps frame retains time for rendering and other work.'
  },
  'serialize:core:encodeStream:minItems': {
    en: 'Lower bound for adaptive slice size, preventing scheduling overhead from dominating useful work.'
  },
  'serialize:core:encodeStream:maxItems': {
    en: 'Upper bound for adaptive slice size. Large values may keep the main thread busy before the adaptive controller converges.'
  },
  'serialize:core:encodeStream:initialItems': {
    en: 'Initial slice size. Keep it conservative because adaptation can only correct the size after the first measured slice.'
  },
  'serialize:core:encodeStream:yieldTo': {
    en: 'Custom cooperative-yield function between slices. The default schedules through the selected scheduler and observes cancellation.'
  },
  'serialize:core:sliceByFrameBudget:targetMs': {
    en: 'Target consumer time per slice. The next slice size is damped toward targetMs divided by the measured elapsed time.'
  },
  'serialize:core:sliceByFrameBudget:minItems': {
    en: 'Minimum adaptive slice size after timing-based adjustment.'
  },
  'serialize:core:sliceByFrameBudget:maxItems': {
    en: 'Maximum adaptive slice size after timing-based adjustment.'
  },
  'serialize:core:sliceByFrameBudget:initialItems': {
    en: 'Item count used for the first slice before consumer timing is available.'
  },
  'serialize:core:sliceByFrameBudget:yieldTo': {
    en: 'Cooperative-yield function used between slices. By default it schedules a zero-delay task and rejects promptly when cancellation occurs.'
  },
  'serialize:plugins:jsonParser:replacer': {
    en: 'Optional JSON.stringify replacer used to omit or normalize values before encoding.'
  },
  'serialize:plugins:jsonPlugin:replacer': {
    en: 'Optional JSON.stringify replacer used to omit or normalize values before encoding.'
  },
  'serialize:plugins:jsonParser:reviver': {
    en: 'Optional JSON.parse reviver used to reconstruct richer values such as Date instances.'
  },
  'serialize:plugins:jsonPlugin:reviver': {
    en: 'Optional JSON.parse reviver used to reconstruct richer values such as Date instances.'
  },
  'serialize:plugins:jsonParser:space': {
    en: 'JSON indentation width for debugging output. Omit in production to avoid increasing payload size.'
  },
  'serialize:plugins:jsonPlugin:space': {
    en: 'JSON indentation width for debugging output. Omit in production to avoid increasing payload size.'
  },
  'serialize:plugins:jsonParser:decoder': {
    en: 'TextDecoder used for byte segments. Defaults to the host decoder and rejects with ENV_UNSUPPORTED when no decoder exists.'
  },
  'serialize:plugins:jsonPlugin:decoder': {
    en: 'TextDecoder used for byte segments. Defaults to the host decoder and rejects with ENV_UNSUPPORTED when no decoder exists.'
  },
  'serialize:registry:createSerializeRegistry:encoder': {
    en: 'TextEncoder used to convert text segments to bytes. Defaults to the host encoder and is validated during construction.'
  },
  'serialize:registry:createSerializeRegistry:decoder': {
    en: 'TextDecoder capability retained by the registry for derived decoding APIs. Defaults to the host decoder.'
  },
  'serialize:registry:createSerializeRegistry:cleanup': {
    en: 'Groups cleanup.policy and cleanup.report for registry disposal and late-failure containment.'
  },
  'serialize:registry:createSerializeRegistry:cleanup.policy': {
    en: 'Selects whether cleanup failures are thrown or sent to the cleanup reporter.'
  },
  'serialize:registry:createSerializeRegistry:cleanup.report': {
    en: 'Receives secondary iterator-return failures and late detached-task rejections without replacing the primary failure or reopening lifecycle state.'
  },
  'serialize:registry:createSerializeRegistry:onDrainTimeout': {
    en: 'Diagnostic callback invoked once when disposal reaches its deadline with operations still in flight. Callback failure is contained.'
  },
  'serialize:registry:createSerializeRegistry:report': {
    en: 'Fallback cleanup reporter used by report policy for contained secondary failures.'
  },
  'storage-web:*:*:dbName': {
    en: "IndexedDB database name. Defaults to 'storage-web'."
  },
  'storage-web:*:*:kvStoreName': {
    en: "Object-store name for key/value entries. Defaults to 'kv'."
  },
  'storage-web:*:*:bytesStoreName': {
    en: "Object-store name for byte entries. Defaults to 'bytes'."
  },
  'storage-web:*:*:recordsStoreName': {
    en: "Object-store name for structured records. Defaults to 'records'; store names must be non-empty, distinct, and must not use an internal reserved name."
  },
  'storage-web:*:*:factory': {
    en: 'IDBFactory injection point for tests and non-browser hosts. Defaults to globalThis.indexedDB and rejects with BACKEND_UNAVAILABLE when absent.'
  },
  'storage-web:*:*:keyRange': {
    en: 'IDBKeyRange constructor injection point. Tests without native IndexedDB must provide it together with factory; browsers default to globalThis.IDBKeyRange.'
  },
  'storage-web:*:*:namespace': {
    en: "Physical-key namespace that isolates applications and instances. Defaults to 'default'."
  },
  'storage-web:*:*:namespaceCodec': {
    en: 'Physical-key codec extension point. Changing it changes the persisted key format and therefore requires compatibility planning.'
  },
  'storage-web:*:*:document': {
    en: 'Document injection point for tests. Browser hosts default to globalThis.document.'
  },
  'storage-web:cookies:cookies:scope': {
    en: 'Cookie scope used to filter invalidation. Changes that cannot be proven unrelated conservatively trigger a refresh.'
  },
  'storage-web:plugins-reactive-cookies:cookiesReactive:scope': {
    en: 'Cookie scope used to filter invalidation. Changes that cannot be proven unrelated conservatively trigger a refresh.'
  },
  'storage-web:plugins-cookies:cookieBackendPlugin:scope': {
    en: 'Fixed cookie scope reused for both writes and removals so cleanup targets the same physical cookie.'
  },
  'storage-web:entity:defineEntity:name': {
    en: "Schema name. The default passthrough schema uses 'passthrough' and returns values unchanged."
  },
  'storage-web:entity:defineEntity:key': {
    en: 'Stable entity key used to isolate this record family when one backend stores several entity definitions.'
  },
  'storage-web:entity:defineEntity:schema': {
    en: 'Schema that validates the entity value at its public storage boundary.'
  },
  'storage-web:entity:defineEntity:codec': {
    en: 'Optional explicit codec. When omitted, connect selects structuredCodec for record stores and jsonCodec for key/value-only stores.'
  },
  'storage-web:entity:defineEntity:version': {
    en: 'Current entity schema version used to determine which ordered migrations must run.'
  },
  'storage-web:entity:defineEntity:migrations': {
    en: 'Version-indexed migration functions. When provided, this must be a plain object rather than an array.'
  },
  'storage-web:entity:defineEntity:validateOnRead': {
    en: 'Controls whether stored values are validated when read. Defaults to true.'
  },
  'storage-web:entity:defineEntity:onDiagnostic': {
    en: 'Diagnostic callback for non-fatal entity messages. Defaults to console.warn; callback failure does not alter storage behavior.'
  },
  'storage-web:entity:defineEntity:defaultOrderBy': {
    en: 'Default comparator used for ordered entity results when a call does not provide a more specific ordering.'
  },
  'store-indexed:*:*:mutationGuard': {
    en: 'Mutation guard invoked before each write through assertMutationAllowed(operation). Pass options before runtime when using the factory overload.'
  },
  'store-indexed:*:*:debugName': {
    en: 'Prefix used for internal Signal names in diagnostics and tracing. Pass options before runtime when using the factory overload.'
  },
  'store-keyed:*:*:maxSize': {
    en: 'Maximum number of cached family definitions. It must be a positive safe integer or construction rejects with INVALID_OPTION.'
  },
  'store-keyed:*:*:debugLabel': {
    en: 'Human-readable family label used in diagnostics. It must be a string when provided.'
  },
  'store-middleware:index:bindStoreMiddleware:execution': {
    en: 'Required middleware execution owner used to run the bound store pipeline.'
  },
  'store-middleware:*:*:mutationPolicy': {
    en: 'Shared mutation policy that guards direct writes and wraps action execution. Store and middleware must use the same policy instance.'
  },
  'store-middleware:index:bindStoreMiddleware:actionPrefix': {
    en: 'Optional prefix filter for Runtime action traces forwarded to middleware events.'
  },
  'store-middleware:index:bindStoreMiddleware:clone': {
    en: 'Snapshot clone function used to prevent middleware, previous state, and the live Store from sharing mutable references. Defaults to structuredClone.'
  },
  'store-middleware:*:*:runtime': {
    en: 'Reactive Runtime that owns batching, action traces, and error reporting for the middleware host.'
  },
  'store-middleware:*:*:getState': {
    en: 'Reads the current Store snapshot used by middleware and state-recording operations.'
  },
  'store-middleware:*:*:applyState': {
    en: 'Applies a snapshot back to the Store. Without it, DevTools jump and reset commands reject with DEVTOOLS_CAPABILITY.'
  },
  'store-react:index:normalizeStoreConfig:features': {
    en: 'Feature flags normalized for direct wasm and experimental.<key> lookups.'
  },
  'store-react:index:normalizeStoreConfig:ready': {
    en: 'Promises or zero-argument factories that form the provider readiness barrier. Factory results are evaluated lazily and cached per barrier scope.'
  },
  'store-react:index:normalizeStoreConfig:fallback': {
    en: 'UI rendered while the readiness barrier is pending. Choose content that is safe to display but cannot be mistaken for loaded Store data.',
    zh: 'readiness barrier 等待期间显示的界面；应选择可安全展示、但不会被误认为已经加载的 Store 数据的内容。'
  },
  'store-react:index:normalizeStoreConfig:defaults': {
    en: 'Read-only application defaults snapshot. StoreProvider does not write these values into individual stores.'
  },
  'store-react:index:StoreRegistry:owned': {
    en: 'Transfers instance lifecycle to the registry. Owned values are disposed when the registry is released.'
  },
  'store-ssr:*:*:runtime': {
    en: 'Request-owned Runtime used to enforce Store and Resource isolation. Registered values must belong to this exact Runtime.'
  },
  'store-ssr:*:*:runtimeOptions': {
    en: 'Options used when creating an internal request Runtime. Mutually exclusive with an explicitly supplied runtime.'
  },
  'store-ssr:*:*:codecs': {
    en: 'Serialize registry used for SSR state encoding or decoding. Its primaryType determines the emitted format.'
  },
  'store-ssr:*:*:elementId': {
    en: "DOM element id used for the serialized state payload. Defaults to '__STORE_STATE__' and follows the shared id validation rule."
  },
  'store-ssr:*:*:signal': {
    en: 'Abort signal forwarded to codec encode or decode work.'
  },
  'store-ssr:index:readSSRStateFromDocumentWith:document': {
    en: 'Explicit document-like object used to locate SSR state. The reader never accesses globalThis.document implicitly.'
  },
  'store-ssr:index:SSRRequestScope:timeoutMs': {
    en: 'Maximum wait for request resources. It must be finite and non-negative.'
  },
  'store-ssr:index:SSRRequestScope:onResourceError': {
    en: 'Resource-failure callback replacing the default forwarding to runtime.reportError with phase ssr-resource.'
  },
  'store-worker:index:workerComputed:runtime': {
    en: 'Reactive Runtime captured once before Resource ownership and automatic startup begin.'
  },
  'store-worker:index:workerComputed:transfer': {
    en: 'Optional transfer-list selector validated before the worker-backed Resource starts.'
  },
  'store-worker:serialize:workerParser:worker': {
    en: 'Worker endpoint that executes parser encode and decode calls on the worker side.'
  },
  'store-worker:serialize:workerParser:type': {
    en: 'Diagnostic codec type attached to worker Serialize errors. Defaults to the stable worker type.'
  },
  'store-worker:serialize:workerParser:terminateOnDispose': {
    en: 'Also terminates the underlying Worker after disposing the RPC endpoint. Both cleanup steps run even if one fails.'
  },
  'store-worker:serialize:workerParser:ownership': {
    en: 'Byte-buffer custody used by worker serialization to decide whether buffers may be transferred or must remain borrowed.'
  },
  'store-worker:serialize:workerPlugin:worker': {
    en: 'Worker endpoint wrapped as a standard Serialize registry plugin.'
  },
  'store-worker:serialize:workerPlugin:type': {
    en: 'Registry plugin type for worker-backed serialization.'
  },
  'store-worker:serialize:workerPlugin:terminateOnDispose': {
    en: 'Terminates the supplied Worker after endpoint disposal. Defaults to preserving externally owned workers.'
  },
  'store-worker:serialize:workerPlugin:ownership': {
    en: 'Byte-buffer custody used by the worker plugin for transfer versus borrowing.'
  },
  'tray:host:createHost:create': {
    zh: '构造结果 Tray host 唯一拥有的 PluginHost 实例。'
  },
  'tray:host:createHost:plugins': {
    zh: '按 tuple 顺序接纳并安装的初始 plugin definitions。'
  },
  'tray:host:createHost:mutationAdmissionMs': {
    zh: '限制 graph mutation 等待进入串行执行的最长毫秒数。'
  },
  'tray:host:createHost:quiescenceMs': {
    zh: '限制有界关闭等待 plugin 物理静默完成的最长毫秒数。'
  },
  'tray:host:createHost:shutdown': {
    zh: '选择有界关闭，或严格等待全部物理释放完成的 drain。'
  },
  'tray:host:createHost:shutdown.mode': {
    zh: '选择在预算耗尽时返回，或严格等待每个 plugin 的物理释放完成。'
  },
  'tray:host:createHost:report': {
    zh: '接收已隔离的生命周期与清理诊断，不替换主要失败。'
  },
  'utils:*:*:locales': {
    zh: '传给 Intl.NumberFormat 的 locale 优先级；输入会先经过 Intl.getCanonicalLocales 规范化。'
  },
  'utils:config:combineConfig:strategies': {
    en: 'Global merge strategies applied unless a more specific path rule overrides one of them.'
  },
  'utils:config:combineConfig:pathRules': {
    en: 'Path-prefix strategy overrides. Longer, more specific prefixes win and inherit unspecified global strategies.'
  },
  'utils:config:combineConfig:onConflict': {
    en: 'Synchronous conflict resolver for values that no automatic strategy can merge. It may keep left, use right, delete, or provide a replacement value.'
  },
  'utils:config:combineConfig:profile': {
    en: 'Ownership profile recorded with the resulting config. Reusing an owned value with a different profile rejects as CONFIG_CONFLICT.'
  },
  'utils:config:ownConfig:profile': {
    en: 'Ownership profile recorded with the resulting config. Reusing an owned value with a different profile rejects as CONFIG_CONFLICT.'
  },
  'utils:config:patchConfig:profile': {
    en: 'Ownership profile recorded with the resulting config. Reusing an owned value with a different profile rejects as CONFIG_CONFLICT.'
  },
  'utils:config:combineConfig:limits': {
    en: 'Maximum traversal depth, visited nodes, and keys. Exceeding a limit rejects as CONFIG_LIMIT_EXCEEDED.'
  },
  'utils:config:ownConfig:limits': {
    en: 'Maximum traversal depth, visited nodes, and keys. Exceeding a limit rejects as CONFIG_LIMIT_EXCEEDED.'
  },
  'utils:config:patchConfig:limits': {
    en: 'Maximum traversal depth, visited nodes, and keys. Exceeding a limit rejects as CONFIG_LIMIT_EXCEEDED.'
  },
  'utils:config:patchConfig:reuseUnchangedRoot': {
    en: 'Returns base by identity when the root patch is empty. Defaults to true; changed paths still use copy-on-write ownership.'
  },
  'utils:object-path:createPathAccessor:ifMissing': {
    en: 'Diagnostic callback invoked when traversal cannot find a requested path segment.'
  },
  'utils:object-path:createPathAccessor:ifBlocked': {
    en: 'Diagnostic callback invoked when traversal is blocked by an unsafe or non-traversable segment.'
  },
  'utils:object-path:createPathAccessor:ifFailed': {
    en: 'Diagnostic callback invoked when traversal fails while reading a property.'
  },
  'utils:object-path:createPathAccessor:onGet': {
    en: 'Successful-read hook. It receives the original path, parsed segments, probe, value, and a replace function for the returned value.'
  },
  'utils:object-path:createPathAccessor:onSet': {
    en: 'Successful-write hook. It receives the original path, parsed segments, probe, value, and a replace function for the stored value.'
  },
  'utils:promise:createAbortTimeoutSignal:signal': {
    en: 'Optional external abort signal. If it aborts first, the composed signal preserves its exact reason.'
  },
  'utils:promise:createAbortTimeoutSignal:timeoutMs': {
    en: 'Deadline in milliseconds for the shared operation signal. Omit to preserve the external signal identity without creating a timer.'
  },
  'utils:promise:createAbortTimeoutSignal:scheduler': {
    en: 'Scheduler that owns deadline timing and timer cleanup. Defaults to systemScheduler.'
  },
  'utils:promise:createAbortTimeoutSignal:timeoutReason': {
    en: 'Factory for the abort reason when the deadline wins. A factory failure itself becomes the signal reason.'
  },
  'utils:promise:createAbortTimeoutSignal:report': {
    en: 'Receives timer or listener cleanup failures from dispose without changing the operation signal result.'
  },
  'utils:string:format:placeholder': {
    en: 'Custom opening and closing delimiters for path placeholders. Doubling a delimiter emits it literally.'
  },
  'utils:string:format:missing': {
    en: 'Behavior for missing paths: preserve the placeholder, replace it with empty text, or throw.'
  },
  'utils:string:format:nullish': {
    en: 'Behavior for null and undefined values: emit empty text or stringify the value.'
  },
  'web-rpc:*:*:id': {
    zh: '本地 endpoint 的稳定标识；每个需要路由的协议 envelope 都会携带它。'
  },
  'web-rpc:*:*:targetIds': {
    zh: '可选的已知 peer 初始集合；自动发现仍可在需要时解析其他 target id。'
  },
  'web-rpc:*:*:replay': {
    zh: '限制该 endpoint 为出站 request identifier 保留的重放窗口。'
  },
  'web-rpc:*:*:replay.ttlMs': {
    zh: '出站 request identifier 的保留时长，默认 310 秒。'
  },
  'web-rpc:*:*:middlewares': {
    zh: 'endpoint 构造期间按 tuple 顺序原子安装的 middleware。'
  },
  'web-rpc:*:*:construction': {
    en: 'Groups construction.signal and construction.timeoutMs so asynchronous endpoint construction can be cancelled or bounded while installed middleware is still rolled back safely.',
    zh: '组合 construction.signal 与 construction.timeoutMs；在下方分别配置中止信号和构造超时。'
  },
  'web-rpc:index:authentication:encrypt': {
    en: 'Outbound encryption transform. It must be configured together with decrypt and runs before signing.'
  },
  'web-rpc:index:authentication:decrypt': {
    en: 'Inbound decryption transform. It must be configured together with encrypt and runs after signature verification.'
  },
  'web-rpc:index:authentication:sign': {
    en: 'Outbound signing transform. It must be configured together with verify and runs after encryption.'
  },
  'web-rpc:index:authentication:verify': {
    en: 'Inbound signature-verification transform. It must be configured together with sign and runs before decryption.'
  },
  'web-rpc:index:authentication:encodedType': {
    en: 'Encoded representation required by the authentication transforms. It must agree with protocol output and transport requirements.'
  },
  'web-rpc:index:chunk:chunkSize': {
    en: 'String payload size above which outbound messages are split. Omit for no splitting; Uint8Array payloads are never split.'
  },
  'web-rpc:index:chunk:maxMessageBytes': {
    en: 'Maximum accepted logical message size. Omit for no message-size limit; other capacity limits remain active.'
  },
  'web-rpc:index:chunk:maxConcurrentMessages': {
    en: 'Maximum number of message assemblies retained across all peers.'
  },
  'web-rpc:index:chunk:maxConcurrentMessagesPerPeer': {
    en: 'Maximum number of message assemblies retained for one peer.'
  },
  'web-rpc:index:chunk:maxBufferedBytes': {
    en: 'Maximum total bytes retained by incomplete message assemblies.'
  },
  'web-rpc:index:chunk:maxChunksPerMessage': {
    en: 'Maximum number of chunks accepted for one logical message.'
  },
  'web-rpc:index:chunk:maxChunkBytes': {
    en: 'Maximum encoded byte size accepted for one chunk.'
  },
  'web-rpc:index:chunk:assemblyTimeoutMs': {
    en: 'Maximum time an incomplete message assembly may remain buffered before it is discarded.'
  },
  'web-rpc:index:chunk:byteLength': {
    en: 'Custom byte-length calculator used to enforce chunk and message limits. Invalid results reject the chunk as CHUNK_INVALID.'
  },
  'web-rpc:index:chunk:split': {
    en: 'Custom string-splitting strategy. It must emit valid bounded chunk frames or the message is rejected as CHUNK_INVALID.'
  },
  'web-rpc:index:contract:version': {
    en: 'Local protocol contract version advertised to peers.'
  },
  'web-rpc:index:contract:acceptVersions': {
    en: 'Peer protocol versions accepted by this endpoint. Defaults to the locally declared version.'
  },
  'web-rpc:index:contract:maxIdentifierLength': {
    en: 'Maximum length for sender, target, task, method, and receiver identifiers. Defaults to 128 even without contract middleware.'
  },
  'web-rpc:index:contract:schemas': {
    en: 'Method-indexed parameter and result schemas. Methods without an exact entry are not schema-validated.'
  },
  'web-rpc:index:hooks:listeners': {
    en: 'Initial ordered hook listeners installed with the middleware. Runtime subscriptions can be added through hooks.on().'
  },
  'web-rpc:index:hooks:onHookError': {
    en: 'Contains hook-listener failures so a broken diagnostic listener cannot alter the RPC operation.'
  },
  'web-rpc:index:protocol:encode': {
    en: 'Encodes an outbound wire envelope. Failures are reported as PROTOCOL_INVALID.'
  },
  'web-rpc:index:protocol:decode': {
    en: 'Decodes an inbound wire envelope. Failures are reported as PROTOCOL_INVALID.'
  },
  'web-rpc:index:protocol:encodedType': {
    en: 'Declares the representation produced by encode and consumed by decode so transport compatibility is checked during construction.'
  },
  'web-rpc:index:uuid:generate': {
    en: 'Custom identifier generator for task, message, and variation IDs. Defaults to the built-in secure random generator.'
  },
  'web-rpc:adapters-message-port:createBrowserMessagePortTransport:ownership': {
    en: "Controls MessagePort custody. 'owned' closes the port on dispose; 'borrowed' removes framework listeners without closing it."
  },
  'web-rpc:adapters-service-worker:createServiceWorkerTransport:target': {
    en: 'ServiceWorker postMessage target used for outbound messages.'
  },
  'web-rpc:adapters-service-worker:createServiceWorkerTransport:receiver': {
    en: 'ServiceWorker event source used to receive inbound message and error events.'
  },
  'web-rpc:*:*:peerId': {
    en: 'Optional statically known remote peer identity attached to transport metadata.'
  },
  'web-rpc:adapters-web-worker:createWebWorkerTransport:origin': {
    en: 'Optional expected origin metadata for the connected worker peer.'
  },
  'web-rpc:adapters-window:createWindowMessageTransport:target': {
    en: 'Required postMessage target, such as iframe.contentWindow or window.opener.'
  },
  'web-rpc:adapters-window:createWindowMessageTransport:receiver': {
    en: 'Inbound message-event source. Same-origin usage may omit it and use the host default receiver.'
  }
}

/** Human-owned API guides keyed by stable public route identity and locale. */
/** Human-maintained Runtime configuration guidance shared by the factory and class reference. */
const reactiveRuntimeOptions: Readonly<Record<IGuideLocale, readonly IApiOptionGuide[]>> = {
  zh: [
    {
      name: 'adapter',
      description:
        '注入宿主的微任务调度、单调时钟、事件时间戳与默认错误出口。缺少的成员逐项回落到 defaultRuntimeAdapter；Runtime 会在构造时只读取一次并保留原 receiver。',
      defaultValue: 'defaultRuntimeAdapter 的对应成员',
      whenToUse: '测试需要虚拟时间，或 Worker、嵌入式宿主拥有不同的调度与时钟能力时设置。',
      example:
        'createRuntime({ adapter: { scheduleMicrotask: queueMicrotask, now: () => clock.now() } })'
    },
    {
      name: 'onError',
      description:
        '接收被 Runtime 隔离的异步冲刷、cleanup 与诊断失败；回调获得错误及经过快照的上下文，不替换同步主错误。',
      defaultValue: 'adapter.reportError',
      whenToUse: '应用有统一错误监控，且需要按 reactive phase 或节点归属分类时设置。',
      example: 'createRuntime({ onError: (error, context) => report(error, context) })'
    },
    {
      name: 'onTrace',
      description:
        '订阅 Runtime 产生的只读依赖、节点变化、observer 执行与 action 事件；监听器不能向图中注入事件。',
      defaultValue: 'undefined（不产生 trace 开销）',
      whenToUse: '开发工具、性能分析或生产诊断需要观察真实图行为时设置。',
      example: 'createRuntime({ onTrace: (event) => traceBuffer.push(event) })'
    },
    {
      name: 'maxFlushPasses',
      description:
        '限制一次 flush 中单个 observer 可执行的最大次数。超过上限表示自触发循环，Runtime 会抛错并清空队列。',
      defaultValue: '100',
      whenToUse:
        '经过测量的超长派生链在一次 flush 中合法需要更多轮次时提高；不要用它掩盖循环依赖。',
      example: 'createRuntime({ maxFlushPasses: 200 })'
    },
    {
      name: 'scheduleIdle',
      description:
        '安排未观察 Computed 的挂起与回收。它只控制 idle cleanup，不控制 effect 的 flush 策略。',
      defaultValue: 'adapter.scheduleMicrotask',
      whenToUse:
        '宿主希望在 requestIdleCallback、测试队列或自己的回收时段断开未观察派生节点时设置。',
      example: 'createRuntime({ scheduleIdle: (task) => requestIdleCallback(task) })'
    }
  ],
  en: [
    {
      name: 'adapter',
      description:
        'Injects host microtask scheduling, monotonic time, event timestamps, and the default error sink. Missing members fall back individually to defaultRuntimeAdapter; construction snapshots each member once and preserves its receiver.',
      defaultValue: 'the corresponding defaultRuntimeAdapter member',
      whenToUse:
        'Set it for virtual time in tests or when a Worker or embedded host provides different scheduling and clock capabilities.',
      example:
        'createRuntime({ adapter: { scheduleMicrotask: queueMicrotask, now: () => clock.now() } })'
    },
    {
      name: 'onError',
      description:
        'Receives contained async-flush, cleanup, and diagnostic failures with a snapshotted context; it does not replace the primary synchronous error.',
      defaultValue: 'adapter.reportError',
      whenToUse:
        'Set it when the application has centralized error monitoring and needs classification by reactive phase or node ownership.',
      example: 'createRuntime({ onError: (error, context) => report(error, context) })'
    },
    {
      name: 'onTrace',
      description:
        'Observes read-only dependency, node-change, observer-run, and action events produced by the Runtime. Listeners cannot inject events into the graph.',
      defaultValue: 'undefined (no trace overhead)',
      whenToUse:
        'Set it when developer tooling, profiling, or production diagnostics must observe actual graph behavior.',
      example: 'createRuntime({ onTrace: (event) => traceBuffer.push(event) })'
    },
    {
      name: 'maxFlushPasses',
      description:
        'Limits how many times one observer may execute during a flush. Exceeding the limit identifies a self-triggering loop, throws, and clears the queue.',
      defaultValue: '100',
      whenToUse:
        'Raise it only when a measured long derivation chain legitimately requires more passes; do not use it to hide a cycle.',
      example: 'createRuntime({ maxFlushPasses: 200 })'
    },
    {
      name: 'scheduleIdle',
      description:
        'Schedules suspension and cleanup of unobserved Computed nodes. It controls idle reclamation, not the Effect flush strategy.',
      defaultValue: 'adapter.scheduleMicrotask',
      whenToUse:
        'Set it when a host wants reclamation in requestIdleCallback, a deterministic test queue, or another owned idle window.',
      example: 'createRuntime({ scheduleIdle: (task) => requestIdleCallback(task) })'
    }
  ]
}

/** Constructor fields shared by the SharedInt32Signal class and its factory. */
const sharedSignalOptions: Readonly<Record<IGuideLocale, readonly IApiOptionGuide[]>> = {
  en: [
    {
      name: 'runtime',
      description:
        'Reactive Runtime that owns dependency tracking and local observer notification for this view of the shared value.',
      defaultValue: 'required',
      optional: false,
      type: 'IRuntime',
      whenToUse: 'Pass the Runtime that owns consumers in the current realm.',
      example: 'sharedInt32(runtime, 0)'
    },
    {
      name: 'initialValue',
      description:
        'Initial signed int32 written only when a new SharedArrayBuffer is created. It is ignored when attaching to an existing buffer.',
      defaultValue: '0',
      type: 'number',
      whenToUse: 'Seed a newly owned shared signal before another realm receives its buffer.',
      example: 'sharedInt32(runtime, 42)'
    },
    {
      name: 'buffer',
      description:
        'Existing ABI-compatible SharedArrayBuffer to attach. The constructor validates the header, kind, version, readiness, and minimum size before use.',
      defaultValue: 'creates a new 8-byte-aligned ABI buffer',
      type: 'SharedArrayBuffer',
      whenToUse: 'Create another realm-local reactive view over the same shared signal.',
      example: 'sharedInt32(workerRuntime, 0, message.buffer)'
    }
  ],
  zh: [
    {
      name: 'runtime',
      description: '拥有当前 realm 中依赖追踪与本地 observer 通知的 Reactive Runtime。',
      defaultValue: '必填',
      optional: false,
      type: 'IRuntime',
      whenToUse: '传入拥有当前 realm consumers 的 Runtime。',
      example: 'sharedInt32(runtime, 0)'
    },
    {
      name: 'initialValue',
      description:
        '仅在创建新 SharedArrayBuffer 时写入的初始 int32；附着已有 buffer 时会忽略。',
      defaultValue: '0',
      type: 'number',
      whenToUse: '把新建共享 signal 的初值写好，再把 buffer 交给其他 realm。',
      example: 'sharedInt32(runtime, 42)'
    },
    {
      name: 'buffer',
      description:
        '要附着的已有 ABI-compatible SharedArrayBuffer；构造器会先校验 header、kind、version、readiness 与最小尺寸。',
      defaultValue: '新建一块 8 字节对齐 ABI buffer',
      type: 'SharedArrayBuffer',
      whenToUse: '在另一个 realm 为同一共享 signal 创建本地响应式 view。',
      example: 'sharedInt32(workerRuntime, 0, message.buffer)'
    }
  ]
}

/** Constructor fields shared by the SharedInt32Array class and its factory. */
const sharedArrayOptions: Readonly<Record<IGuideLocale, readonly IApiOptionGuide[]>> = {
  en: [
    {
      name: 'runtime',
      description: 'Reactive Runtime that owns lazily materialized per-index cells in this realm.',
      defaultValue: 'required',
      optional: false,
      type: 'IRuntime',
      whenToUse: 'Pass the Runtime used by Effects and Computed values reading this array.',
      example: 'sharedInt32Array(runtime, 1_000)'
    },
    {
      name: 'length',
      description:
        'Fixed non-negative element count encoded into the shared ABI. It cannot change after construction and must match when attaching.',
      defaultValue: 'required',
      optional: false,
      type: 'number',
      whenToUse: 'Size the stable shared index domain before publishing the buffer.',
      example: 'sharedInt32Array(runtime, 1_000)'
    },
    {
      name: 'buffer',
      description:
        'Existing ABI-compatible SharedArrayBuffer. Supplying it attaches to shared state and ignores initialValues.',
      defaultValue: 'creates a new buffer sized for length',
      type: 'SharedArrayBuffer',
      whenToUse: 'Attach another realm-local array view to the same shared layout.',
      example: 'sharedInt32Array(workerRuntime, length, { buffer })'
    },
    {
      name: 'initialValues',
      description:
        'Iterable materialized only for a newly created buffer. Values are validated as int32 and entries beyond length are ignored.',
      defaultValue: 'undefined (all cells start at zero)',
      type: 'Iterable<number>',
      whenToUse: 'Seed a new array atomically before its buffer becomes shared.',
      example: 'sharedInt32Array(runtime, 3, { initialValues: [10, 20, 30] })'
    }
  ],
  zh: [
    {
      name: 'runtime',
      description: '拥有当前 realm 中按需物化逐下标 cell 的 Reactive Runtime。',
      defaultValue: '必填',
      optional: false,
      type: 'IRuntime',
      whenToUse: '传入读取此数组的 Effect 与 Computed 所属 Runtime。',
      example: 'sharedInt32Array(runtime, 1_000)'
    },
    {
      name: 'length',
      description:
        '编码进共享 ABI 的固定非负元素数量；构造后不能改变，附着已有 buffer 时也必须匹配。',
      defaultValue: '必填',
      optional: false,
      type: 'number',
      whenToUse: '发布 buffer 前确定稳定的共享下标域。',
      example: 'sharedInt32Array(runtime, 1_000)'
    },
    {
      name: 'buffer',
      description: '已有 ABI-compatible SharedArrayBuffer；提供后会附着共享状态并忽略 initialValues。',
      defaultValue: '按 length 新建 buffer',
      type: 'SharedArrayBuffer',
      whenToUse: '让另一个 realm-local array view 附着同一共享布局。',
      example: 'sharedInt32Array(workerRuntime, length, { buffer })'
    },
    {
      name: 'initialValues',
      description:
        '只为新建 buffer 物化的 iterable；每项校验为 int32，超过 length 的部分忽略。',
      defaultValue: 'undefined（全部 cell 从 0 开始）',
      type: 'Iterable<number>',
      whenToUse: 'buffer 对外共享前一次性建立新数组初值。',
      example: 'sharedInt32Array(runtime, 3, { initialValues: [10, 20, 30] })'
    }
  ]
}

/** Construction fields for one Store DevTools diagnostic session. */
const storeDevToolsOptions: Readonly<Record<IGuideLocale, readonly IApiOptionGuide[]>> = {
  en: [
    {
      name: 'store',
      description:
        'Reactive Store being observed. The session reads its public plain snapshot, hydration, subscription, Runtime trace, and error-reporting boundaries without proxying writes.',
      defaultValue: 'required',
      optional: false,
      type: 'IReactiveStore<S>',
      whenToUse: 'Pass the exact Store whose state changes and actions need one diagnostic timeline.',
      example: 'createStoreDevTools(counterStore)'
    },
    {
      name: 'options.maxHistory',
      description:
        'Maximum retained state snapshots. A ring queue evicts the oldest entry in O(1) after reaching this positive safe-integer bound.',
      defaultValue: '100',
      type: 'number',
      whenToUse:
        'Lower it when snapshots are large; raise it only after measuring the memory cost of maxHistory multiplied by cloned state size.',
      example: '{ maxHistory: 200 }'
    },
    {
      name: 'options.maxTrace',
      description:
        'Independent bound used by both the completed-action queue and raw Runtime trace queue. Each queue retains at most this many entries.',
      defaultValue: '1000',
      type: 'number',
      whenToUse: 'Tune the diagnostic event window separately from state snapshot history.',
      example: '{ maxTrace: 5_000 }'
    },
    {
      name: 'options.captureRuntimeTrace',
      description:
        'Controls the Runtime trace subscription. False keeps trace empty and disables automatic action capture; manual recordAction remains available.',
      defaultValue: 'true',
      type: 'boolean',
      whenToUse: 'Disable it when only state history is needed or Runtime event volume is too expensive.',
      example: '{ captureRuntimeTrace: false }'
    },
    {
      name: 'options.now',
      description:
        'Clock used for manual history and action timestamps. Construction snapshots the callback after validating it.',
      defaultValue: 'Date.now',
      type: '() => number',
      whenToUse: 'Inject deterministic time in tests or align diagnostics with an application-owned clock.',
      example: '{ now: () => testClock.now() }'
    },
    {
      name: 'options.clone',
      description:
        'Clones every recorded plain state and every replayed snapshot. The diagnostic default tolerates uncloneable leaves but does not redact secrets.',
      defaultValue: 'ClonePolicy.diagnostic',
      type: '(state: Record<string, unknown>) => Record<string, unknown>',
      whenToUse:
        'Provide it to redact sensitive fields, enforce a stricter snapshot policy, or support host-specific values.',
      example: "{ clone: (state) => ({ ...structuredClone(state), token: '[redacted]' }) }"
    }
  ],
  zh: [
    {
      name: 'store',
      description:
        '被观察的 Reactive Store。会话只读取其公开 plain snapshot、hydrate、subscription、Runtime trace 与错误上报边界，不代理写入。',
      defaultValue: '必填',
      optional: false,
      type: 'IReactiveStore<S>',
      whenToUse: '传入需要把状态变化与 action 放进同一条诊断时间线的准确 Store 实例。',
      example: 'createStoreDevTools(counterStore)'
    },
    {
      name: 'options.maxHistory',
      description:
        '保留状态快照的上限；达到这个正安全整数后，ring queue 以 O(1) 淘汰最旧条目。',
      defaultValue: '100',
      type: 'number',
      whenToUse: '快照较大时降低；只有测量过 maxHistory × 克隆状态大小的内存成本后才提高。',
      example: '{ maxHistory: 200 }'
    },
    {
      name: 'options.maxTrace',
      description:
        'completed action 队列与原始 Runtime trace 队列共同使用的独立上限；两条队列各自最多保留该数量。',
      defaultValue: '1000',
      type: 'number',
      whenToUse: '独立于状态快照历史，调整诊断事件的可回看窗口。',
      example: '{ maxTrace: 5_000 }'
    },
    {
      name: 'options.captureRuntimeTrace',
      description:
        '控制 Runtime trace 订阅。false 会让 trace 保持为空，并关闭 action 自动采集；手动 recordAction 仍可用。',
      defaultValue: 'true',
      type: 'boolean',
      whenToUse: '只需要状态历史，或 Runtime 事件量成本过高时关闭。',
      example: '{ captureRuntimeTrace: false }'
    },
    {
      name: 'options.now',
      description: '供手动 history 与 action 时间戳使用的时钟；构造期校验后快照 callback。',
      defaultValue: 'Date.now',
      type: '() => number',
      whenToUse: '测试需要确定性时间，或诊断必须与应用自有时钟对齐时注入。',
      example: '{ now: () => testClock.now() }'
    },
    {
      name: 'options.clone',
      description:
        '克隆每个记录的 plain state 与每个回放快照。默认 diagnostic 策略容忍不可克隆叶子，但不会脱敏。',
      defaultValue: 'ClonePolicy.diagnostic',
      type: '(state: Record<string, unknown>) => Record<string, unknown>',
      whenToUse: '需要移除敏感字段、强制更严格快照策略或支持宿主特有值时提供。',
      example: "{ clone: (state) => ({ ...structuredClone(state), token: '[redacted]' }) }"
    }
  ]
}

/** Construction fields for the main-thread Worker RPC adapter. */
const workerAdapterOptions: Readonly<Record<IGuideLocale, readonly IApiOptionGuide[]>> = {
  en: [
    {
      name: 'port',
      description:
        'Worker, MessagePort, or SharedWorker port implementing postMessage plus message subscription. The adapter creates one exclusive WebRPC client over it.',
      defaultValue: 'required',
      optional: false,
      type: 'IWorkerPort',
      whenToUse: 'Pass the already-created communication port owned by the application.',
      example: 'new WorkerAdapter(worker)'
    },
    {
      name: 'options.clientId',
      description: 'Stable local WebRPC endpoint identity used on this exclusive worker topology.',
      defaultValue: "'main'",
      type: 'string',
      whenToUse: 'Override it only when several explicit endpoint identities share diagnostic infrastructure.',
      example: "new WorkerAdapter(worker, { clientId: 'image-main' })"
    },
    {
      name: 'options.timeoutMs',
      description:
        'Default timeout applied by the WebRPC middleware to every request. Omission means no adapter-level default timeout.',
      defaultValue: 'undefined',
      type: 'number',
      whenToUse: 'Bound worker operations whose caller cannot wait indefinitely.',
      example: 'new WorkerAdapter(worker, { timeoutMs: 5_000 })'
    },
    {
      name: 'request.options.signal',
      description: 'Per-request cooperative abort signal forwarded to the worker compute context.',
      defaultValue: 'undefined',
      type: 'IWebRpcAbortSignal',
      whenToUse: 'Tie one request to UI, Resource, deadline, or caller cancellation.',
      example: 'adapter.request(payload, { signal: controller.signal })'
    },
    {
      name: 'request.options.transfer',
      description:
        'Explicit transfer list for this request. Transferred ArrayBuffers detach in the sender immediately and cannot be retried from the original bytes.',
      defaultValue: '[]',
      type: 'readonly Transferable[]',
      whenToUse: 'Use only for exclusively owned buffers that the main thread will never read again.',
      example: 'adapter.request(bytes, { transfer: [bytes.buffer] })'
    }
  ],
  zh: [
    {
      name: 'port',
      description:
        '实现 postMessage 与 message subscription 的 Worker、MessagePort 或 SharedWorker port；adapter 在其上创建一条 exclusive WebRPC client。',
      defaultValue: '必填',
      optional: false,
      type: 'IWorkerPort',
      whenToUse: '传入由应用创建并拥有的准确通信 port。',
      example: 'new WorkerAdapter(worker)'
    },
    {
      name: 'options.clientId',
      description: '这条 exclusive worker topology 上稳定的本地 WebRPC endpoint identity。',
      defaultValue: "'main'",
      type: 'string',
      whenToUse: '只有多个显式 endpoint identity 共用诊断设施时才覆盖。',
      example: "new WorkerAdapter(worker, { clientId: 'image-main' })"
    },
    {
      name: 'options.timeoutMs',
      description: 'WebRPC middleware 为每次 request 应用的默认超时；省略表示没有 adapter 级默认超时。',
      defaultValue: 'undefined',
      type: 'number',
      whenToUse: 'worker operation 不能无限等待时设置明确预算。',
      example: 'new WorkerAdapter(worker, { timeoutMs: 5_000 })'
    },
    {
      name: 'request.options.signal',
      description: '逐 request 的协作式 abort signal，会转发给 worker compute context。',
      defaultValue: 'undefined',
      type: 'IWebRpcAbortSignal',
      whenToUse: '把单次请求绑定到 UI、Resource、deadline 或调用方取消。',
      example: 'adapter.request(payload, { signal: controller.signal })'
    },
    {
      name: 'request.options.transfer',
      description:
        '单次请求的显式 transfer list；转移的 ArrayBuffer 会立即从发送方 detach，不能再用原始 bytes 重试。',
      defaultValue: '[]',
      type: 'readonly Transferable[]',
      whenToUse: '仅用于主线程之后绝不再读取的独占 buffer。',
      example: 'adapter.request(bytes, { transfer: [bytes.buffer] })'
    }
  ]
}

/** Options shared by workerComputed and its Resource ownership. */
const workerComputedOptions: Readonly<Record<IGuideLocale, readonly IApiOptionGuide[]>> = {
  en: [
    {
      name: 'adapter',
      description: 'WorkerAdapter that executes each Resource generation on the worker endpoint.',
      defaultValue: 'required',
      optional: false,
      type: 'WorkerAdapter',
      whenToUse: 'Reuse one live adapter for computations sharing the same worker protocol.',
      example: 'workerComputed(adapter, () => query.value)'
    },
    {
      name: 'selectInput',
      description:
        'Synchronous selector evaluated inside Resource dependency tracking. Reactive reads determine when a new worker request generation starts.',
      defaultValue: 'required',
      optional: false,
      type: '() => Input',
      whenToUse: 'Return the smallest cloneable or transferable input needed by the worker computation.',
      example: 'workerComputed(adapter, () => ({ query: query.value }))'
    },
    {
      name: 'options.runtime',
      description: 'Reactive Runtime owning the returned Resource and its tracked selector dependencies.',
      defaultValue: 'defaultRuntime',
      type: 'IRuntime',
      whenToUse: 'Provide the application, SSR request, test, or isolated graph Runtime.',
      example: 'workerComputed(adapter, selectInput, { runtime })'
    },
    {
      name: 'options.transfer',
      description:
        'Builds the transfer list from the selected input for each generation. Every returned buffer must be exclusively owned because selection is destructive after transfer.',
      defaultValue: 'undefined',
      type: '(input: Input) => readonly Transferable[]',
      whenToUse: 'Enable zero-copy only when input ownership moves permanently to the worker.',
      example: 'workerComputed(adapter, () => bytes, { transfer: (input) => [input.buffer] })'
    },
    {
      name: 'options.resource',
      description:
        'All Resource options are forwarded: debugName, ttl, autoStart, staleWhileRevalidate, retry, retryDelay, keepAlive, initialSnapshot, and scheduler.',
      defaultValue: 'Resource defaults',
      type: 'IResourceOptions<Output>',
      whenToUse: 'Configure generation freshness, retry, cache, scheduling, and observation lifecycle.',
      example: "workerComputed(adapter, selectInput, { ttl: 10_000, retry: 2, debugName: 'search' })"
    }
  ],
  zh: [
    {
      name: 'adapter',
      description: '在 worker endpoint 执行每一代 Resource 请求的 WorkerAdapter。',
      defaultValue: '必填',
      optional: false,
      type: 'WorkerAdapter',
      whenToUse: '共享同一 worker protocol 的计算复用一个存活 adapter。',
      example: 'workerComputed(adapter, () => query.value)'
    },
    {
      name: 'selectInput',
      description:
        '在 Resource dependency tracking 中同步求值的 selector；其中的 reactive 读取决定何时启动新一代 worker request。',
      defaultValue: '必填',
      optional: false,
      type: '() => Input',
      whenToUse: '只返回 worker computation 所需的最小可 clone 或可 transfer 输入。',
      example: 'workerComputed(adapter, () => ({ query: query.value }))'
    },
    {
      name: 'options.runtime',
      description: '拥有返回 Resource 及其 selector 依赖的 Reactive Runtime。',
      defaultValue: 'defaultRuntime',
      type: 'IRuntime',
      whenToUse: '传入应用、SSR request、测试或隔离 graph 的 Runtime。',
      example: 'workerComputed(adapter, selectInput, { runtime })'
    },
    {
      name: 'options.transfer',
      description:
        '为每一代 selected input 构建 transfer list；所有返回 buffer 必须独占，因为 transfer 后选择结果会被破坏性 detach。',
      defaultValue: 'undefined',
      type: '(input: Input) => readonly Transferable[]',
      whenToUse: '只有输入 ownership 永久移交 worker 时才启用零拷贝。',
      example: 'workerComputed(adapter, () => bytes, { transfer: (input) => [input.buffer] })'
    },
    {
      name: 'options.resource',
      description:
        '透传全部 Resource 选项：debugName、ttl、autoStart、staleWhileRevalidate、retry、retryDelay、keepAlive、initialSnapshot 与 scheduler。',
      defaultValue: 'Resource 默认值',
      type: 'IResourceOptions<Output>',
      whenToUse: '配置 generation freshness、retry、cache、scheduling 与 observation lifecycle。',
      example: "workerComputed(adapter, selectInput, { ttl: 10_000, retry: 2, debugName: 'search' })"
    }
  ]
}

/** Construction fields shared by workerParser and workerPlugin. */
const workerParserOptions: Readonly<Record<IGuideLocale, readonly IApiOptionGuide[]>> = {
  en: [
    {
      name: 'worker',
      description:
        'Worker-like port used for the exclusive serialization RPC endpoint. It may expose terminate, but remains caller-owned unless terminateOnDispose is enabled.',
      defaultValue: 'required',
      optional: false,
      type: 'IWorkerLike',
      whenToUse: 'Pass the worker running createSerializeWorkerHandler with the matching parser.',
      example: 'workerParser({ worker })'
    },
    {
      name: 'type',
      description: 'Serializer format label exposed as parser.name and plugin.type.',
      defaultValue: "'worker'",
      type: 'string',
      whenToUse: 'Set the registry format name that matches the worker-side codec.',
      example: "workerParser({ worker, type: 'msgpack-worker' })"
    },
    {
      name: 'terminateOnDispose',
      description:
        'Transfers Worker termination ownership to parser disposal. Endpoint and termination failures are both retained when they fail together.',
      defaultValue: 'false',
      type: 'boolean',
      whenToUse: 'Enable only when this parser exclusively created and owns the Worker.',
      example: 'workerParser({ worker, terminateOnDispose: true })'
    },
    {
      name: 'ownership',
      description:
        "Byte input policy. 'copy' preserves sender bytes; 'transfer' detaches only an exclusive full-buffer Uint8Array and falls back to copy for slices or shared memory.",
      defaultValue: "'copy'",
      type: "'copy' | 'transfer'",
      whenToUse:
        'Choose transfer only when the input buffer is exclusively owned and losing it after abort or worker failure is acceptable.',
      example: "workerParser({ worker, ownership: 'transfer' })"
    },
    {
      name: 'clientId',
      description: 'Stable main-side WebRPC endpoint id and prefix for generated stream ids.',
      defaultValue: "'main'",
      type: 'string',
      whenToUse: 'Override when several explicit serializer clients share diagnostic transport infrastructure.',
      example: "workerParser({ worker, clientId: 'persist-main' })"
    }
  ],
  zh: [
    {
      name: 'worker',
      description:
        '用于 exclusive serialization RPC endpoint 的 Worker-like port；它可以暴露 terminate，但除非启用 terminateOnDispose，否则仍由调用方拥有。',
      defaultValue: '必填',
      optional: false,
      type: 'IWorkerLike',
      whenToUse: '传入运行 createSerializeWorkerHandler 且安装匹配 parser 的 Worker。',
      example: 'workerParser({ worker })'
    },
    {
      name: 'type',
      description: '作为 parser.name 与 plugin.type 暴露的 serializer format label。',
      defaultValue: "'worker'",
      type: 'string',
      whenToUse: '设置与 worker 侧 codec 匹配的 registry format name。',
      example: "workerParser({ worker, type: 'msgpack-worker' })"
    },
    {
      name: 'terminateOnDispose',
      description:
        '把 Worker termination ownership 转交给 parser disposal；endpoint 与 termination 同时失败时会保留两者。',
      defaultValue: 'false',
      type: 'boolean',
      whenToUse: '只有该 parser 独占创建并拥有 Worker 时才启用。',
      example: 'workerParser({ worker, terminateOnDispose: true })'
    },
    {
      name: 'ownership',
      description:
        "byte input policy。'copy' 保留发送方 bytes；'transfer' 只 detach 独占且覆盖完整 buffer 的 Uint8Array，slice 或 shared memory 会退回复制。",
      defaultValue: "'copy'",
      type: "'copy' | 'transfer'",
      whenToUse: '只有输入 buffer 独占，且 abort 或 worker failure 后丢失它也可接受时选择 transfer。',
      example: "workerParser({ worker, ownership: 'transfer' })"
    },
    {
      name: 'clientId',
      description: '稳定的主线程 WebRPC endpoint id，也是生成 stream id 的前缀。',
      defaultValue: "'main'",
      type: 'string',
      whenToUse: '多个显式 serializer client 共用诊断 transport infrastructure 时覆盖。',
      example: "workerParser({ worker, clientId: 'persist-main' })"
    }
  ]
}

/** Constructor fields for the bucketed WASM numeric array builder. */
const wasmArrayOptions: Readonly<Record<IGuideLocale, readonly IApiOptionGuide[]>> = {
  en: [
    {
      name: 'item',
      description: 'Element field builder. The current ABI accepts number() only and stores each value as f64.',
      defaultValue: 'required',
      optional: false,
      type: 'ReturnType<typeof number>',
      whenToUse: 'Pass number() to declare the element ABI explicitly.',
      example: 'array(number(), 10_000, 64)'
    },
    {
      name: 'length',
      description: 'Fixed non-negative safe-integer element count allocated as length multiplied by eight bytes.',
      defaultValue: 'required',
      optional: false,
      type: 'number',
      whenToUse: 'Choose the maximum stable index domain before Store construction.',
      example: 'array(number(), 10_000)'
    },
    {
      name: 'granularity',
      description:
        'Number of adjacent indexes sharing one lazily created Reactive source. Smaller buckets invalidate more precisely but allocate and track more sources.',
      defaultValue: '64',
      type: 'number',
      whenToUse: 'Set 1 for per-cell tracking; raise it when readers consume dense ranges and source overhead matters.',
      example: 'array(number(), 10_000, 16)'
    }
  ],
  zh: [
    {
      name: 'item',
      description: '元素 field builder；当前 ABI 只接受 number()，每项以 f64 存储。',
      defaultValue: '必填',
      optional: false,
      type: 'ReturnType<typeof number>',
      whenToUse: '传入 number()，显式声明 element ABI。',
      example: 'array(number(), 10_000, 64)'
    },
    {
      name: 'length',
      description: '固定非负安全整数元素数，按 length × 8 bytes 分配。',
      defaultValue: '必填',
      optional: false,
      type: 'number',
      whenToUse: 'Store 构造前确定稳定的最大 index domain。',
      example: 'array(number(), 10_000)'
    },
    {
      name: 'granularity',
      description:
        '相邻多少 index 共享一个惰性创建的 Reactive source；bucket 越小 invalidation 越精确，但 source allocation 与 tracking 越多。',
      defaultValue: '64',
      type: 'number',
      whenToUse: '逐 cell tracking 设为 1；reader 密集读取 range 且 source overhead 更重要时提高。',
      example: 'array(number(), 10_000, 16)'
    }
  ]
}

/** Store Light construction options shared by its synchronous and asynchronous entry points. */
const storeLightCreationOptions: Readonly<Record<IGuideLocale, readonly IApiOptionGuide[]>> = {
  en: [
    { name: 'shape', description: 'Object definition whose values become Signals, getters become Computed values, methods become Actions, raw values stay ordinary fields, and FieldBuilders create custom owned fields.', defaultValue: 'required', optional: false, type: 'IStoreDefinition<S>', whenToUse: 'Declare the complete object facade and its method/getter relationships.', example: "{ count: 0, get doubled() { return this.count * 2 }, increment() { this.count++ } }" },
    { name: 'runtime', description: 'Reactive Runtime that owns every node and custom field in the Store.', defaultValue: 'defaultRuntime', type: 'IRuntime', whenToUse: 'Provide a request-, test-, or root-local Runtime when state must be isolated.', example: '{ runtime }' },
    { name: 'debugName', description: 'Human-readable prefix for internal node diagnostics; it does not affect state identity.', defaultValue: "'Store'", type: 'string', whenToUse: 'Distinguish several Store graphs in traces and development tools.', example: "{ debugName: 'settings' }" },
    { name: 'warnAsyncActions', description: 'Warns once when a Store Action returns a thenable because only writes before its first await are automatically batched.', defaultValue: 'false', type: 'boolean', whenToUse: 'Enable during development while migrating asynchronous methods to explicit action boundaries.', example: '{ warnAsyncActions: true }' },
    { name: 'mutationPolicy', description: 'Optional strict-write policy shared with Store Middleware. Methods, $batch, $set, and $hydrate run inside its action boundary.', defaultValue: 'undefined', type: 'IMutationPolicy', whenToUse: 'Require direct Store writes to occur inside admitted actions.', example: "{ mutationPolicy: createMutationPolicy('actions-only') }" }
  ],
  zh: [
    { name: 'shape', description: '对象定义：普通值变 Signal、getter 变 Computed、method 变 Action、raw value 保持普通字段、FieldBuilder 创建自定义 owned field。', defaultValue: '必填', optional: false, type: 'IStoreDefinition<S>', whenToUse: '声明完整对象 facade 及其 method/getter 关系。', example: "{ count: 0, get doubled() { return this.count * 2 }, increment() { this.count++ } }" },
    { name: 'runtime', description: '拥有 Store 全部 node 与自定义 field 的 Reactive Runtime。', defaultValue: 'defaultRuntime', type: 'IRuntime', whenToUse: '请求、测试或 root 之间必须隔离状态时传入局部 Runtime。', example: '{ runtime }' },
    { name: 'debugName', description: '内部 node 诊断使用的人类可读前缀；不参与 state identity。', defaultValue: "'Store'", type: 'string', whenToUse: '在 trace 与开发工具中区分多个 Store graph。', example: "{ debugName: 'settings' }" },
    { name: 'warnAsyncActions', description: 'Store Action 返回 thenable 时仅警告一次，因为只有首次 await 之前的写入会自动 batch。', defaultValue: 'false', type: 'boolean', whenToUse: '开发期把异步 method 迁移到显式 action boundary 时开启。', example: '{ warnAsyncActions: true }' },
    { name: 'mutationPolicy', description: '与 Store Middleware 共享的可选严格写入 policy；method、$batch、$set 与 $hydrate 都在其 action boundary 内运行。', defaultValue: 'undefined', type: 'IMutationPolicy', whenToUse: '要求直接 Store 写入只能发生在获准 action 内。', example: "{ mutationPolicy: createMutationPolicy('actions-only') }" }
  ]
}

/** Store Resource loader and lifecycle options shared by function and object-form factories. */
const storeLightResourceOptions: Readonly<Record<IGuideLocale, readonly IApiOptionGuide[]>> = {
  en: [
    { name: 'factory', description: 'Loader function or object-form config. The load context carries an abort signal, generation, and identity token.', defaultValue: 'required', optional: false, type: 'IStoreResourceFactory<T> | IStoreResourceConfig<T>', whenToUse: 'Create a Suspense-readable async value with explicit ownership.', example: 'createStoreResource(({ signal }) => fetchUser(signal))' },
    { name: 'keepAliveMs', description: 'Finite non-negative cache lifetime after resource leases, version leases, and pending captures all reach zero.', defaultValue: '1000', type: 'number', whenToUse: 'Retain a ready value briefly across unmount and remount without making it process-global.', example: '{ keepAliveMs: 5_000 }' },
    { name: 'dispose', description: 'Cleanup for a loaded reference value. Without it, a value-owned $dispose method is used when present.', defaultValue: 'automatic $dispose or none', type: '(value: T) => void | PromiseLike<void>', whenToUse: 'Release handles, subscriptions, or other resources owned by the loaded value.', example: '{ dispose: (socket) => socket.close() }' },
    { name: 'onError', description: 'Observes contained failures from load, value disposal, or subscriber notification without replacing the Resource state transition.', defaultValue: 'undefined', type: '(error: unknown, phase: IStoreResourceErrorPhase) => void', whenToUse: 'Attach diagnostics for load, dispose, and listener phases.', example: '{ onError: (error, phase) => report(error, phase) }' },
    { name: 'onTerminal', description: 'Runs once after the Resource reaches its disposed terminal state.', defaultValue: 'undefined', type: '() => void', whenToUse: 'Remove the Resource from an external registry after cleanup finishes.', example: '{ onTerminal: () => registry.delete(key) }' }
  ],
  zh: [
    { name: 'factory', description: 'loader function 或 object-form config；load context 提供 abort signal、generation 与 identity token。', defaultValue: '必填', optional: false, type: 'IStoreResourceFactory<T> | IStoreResourceConfig<T>', whenToUse: '创建带显式 ownership 的 Suspense-readable async value。', example: 'createStoreResource(({ signal }) => fetchUser(signal))' },
    { name: 'keepAliveMs', description: 'resource lease、version lease 与 pending capture 全部归零后继续缓存的有限非负毫秒数。', defaultValue: '1000', type: 'number', whenToUse: '在卸载与重挂之间短暂保留 ready value，而不是变成进程全局缓存。', example: '{ keepAliveMs: 5_000 }' },
    { name: 'dispose', description: '清理已加载 reference value；未提供时若 value 拥有 $dispose，则自动使用。', defaultValue: '自动 $dispose 或无', type: '(value: T) => void | PromiseLike<void>', whenToUse: '释放 loaded value 拥有的 handle、subscription 或其他资源。', example: '{ dispose: (socket) => socket.close() }' },
    { name: 'onError', description: '观察 load、value dispose 或 subscriber notification 中被隔离的 failure，不替换 Resource state transition。', defaultValue: 'undefined', type: '(error: unknown, phase: IStoreResourceErrorPhase) => void', whenToUse: '为 load、dispose 与 listener phase 接入诊断。', example: '{ onError: (error, phase) => report(error, phase) }' },
    { name: 'onTerminal', description: 'Resource 到达 disposed 终态后执行一次。', defaultValue: 'undefined', type: '() => void', whenToUse: 'cleanup 完成后从外部 registry 移除 Resource。', example: '{ onTerminal: () => registry.delete(key) }' }
  ]
}

/** Store Indexed construction fields shared by its factory and class entry points. */
const storeIndexedCollectionOptions: Readonly<
  Record<'array' | 'map' | 'object' | 'set', Readonly<Record<IGuideLocale, readonly IApiOptionGuide[]>>>
> = {
  object: {
    en: [
      { name: 'initial', description: 'Plain object materialized before Runtime ownership is admitted; own enumerable string keys become independently tracked values.', defaultValue: 'required', optional: false, type: 'T extends Record<string, unknown>', whenToUse: 'Seed a fixed or evolving string-keyed record.', example: "{ name: 'Ada', online: true }" },
      { name: 'options.mutationGuard', description: 'Optional Store Light-compatible guard consulted before every write, delete, replace, or clear operation.', defaultValue: 'undefined', type: 'IMutationGuard', whenToUse: 'Enforce an actions-only write policy across several state containers.', example: '{ mutationGuard }' },
      { name: 'options.debugName', description: 'Diagnostic prefix used for collection and per-key reactive nodes.', defaultValue: "'ObservableObject'", type: 'string', whenToUse: 'Distinguish several collections in traces and development tools.', example: "{ debugName: 'session' }" },
      { name: 'runtime', description: 'Reactive Runtime that owns structure, revision, and lazily created key cells.', defaultValue: 'defaultRuntime', type: 'IRuntime', whenToUse: 'Isolate state by request, test, component root, or application root.', example: 'runtime' }
    ],
    zh: [
      { name: 'initial', description: '在接纳 Runtime ownership 前完成 materialize 的 plain object；每个 own enumerable string key 成为独立 tracked value。', defaultValue: '必填', optional: false, type: 'T extends Record<string, unknown>', whenToUse: '初始化固定或动态变化的 string-keyed record。', example: "{ name: 'Ada', online: true }" },
      { name: 'options.mutationGuard', description: '每次 write、delete、replace 或 clear 前调用的可选 Store Light-compatible guard。', defaultValue: 'undefined', type: 'IMutationGuard', whenToUse: '在多个 state container 间统一执行 actions-only write policy。', example: '{ mutationGuard }' },
      { name: 'options.debugName', description: 'collection 与 per-key reactive node 使用的诊断前缀。', defaultValue: "'ObservableObject'", type: 'string', whenToUse: '在 trace 与开发工具中区分多个 collection。', example: "{ debugName: 'session' }" },
      { name: 'runtime', description: '拥有 structure、revision 与惰性 key cell 的 Reactive Runtime。', defaultValue: 'defaultRuntime', type: 'IRuntime', whenToUse: '按 request、test、component root 或 application root 隔离状态。', example: 'runtime' }
    ]
  },
  array: {
    en: [
      { name: 'initial', description: 'Iterable fully materialized before ownership; strings are accepted as character iterables.', defaultValue: '[]', type: 'Iterable<T>', whenToUse: 'Seed the initial ordered values without exposing the source iterable afterward.', example: '[first, second]' },
      { name: 'options.mutationGuard', description: 'Optional guard checked before set, push, pop, splice, replace, and clear.', defaultValue: 'undefined', type: 'IMutationGuard', whenToUse: 'Require mutations to occur inside an admitted action.', example: '{ mutationGuard }' },
      { name: 'options.debugName', description: 'Diagnostic prefix for structure, revision, and lazy index cells.', defaultValue: "'ObservableArray'", type: 'string', whenToUse: 'Identify the list in traces and development tools.', example: "{ debugName: 'visibleTodos' }" },
      { name: 'runtime', description: 'Reactive Runtime owning all structural and index dependencies.', defaultValue: 'defaultRuntime', type: 'IRuntime', whenToUse: 'Keep list state inside an explicit lifecycle scope.', example: 'runtime' }
    ],
    zh: [
      { name: 'initial', description: 'ownership 前完整 materialize 的 iterable；string 可作为 character iterable。', defaultValue: '[]', type: 'Iterable<T>', whenToUse: '初始化有序 value，之后不再暴露 source iterable。', example: '[first, second]' },
      { name: 'options.mutationGuard', description: 'set、push、pop、splice、replace 与 clear 前检查的可选 guard。', defaultValue: 'undefined', type: 'IMutationGuard', whenToUse: '要求 mutation 只能发生在获准 action 内。', example: '{ mutationGuard }' },
      { name: 'options.debugName', description: 'structure、revision 与惰性 index cell 的诊断前缀。', defaultValue: "'ObservableArray'", type: 'string', whenToUse: '在 trace 与开发工具中标识该 list。', example: "{ debugName: 'visibleTodos' }" },
      { name: 'runtime', description: '拥有全部 structural 与 index dependency 的 Reactive Runtime。', defaultValue: 'defaultRuntime', type: 'IRuntime', whenToUse: '把 list state 留在显式 lifecycle scope 内。', example: 'runtime' }
    ]
  },
  map: {
    en: [
      { name: 'initial', description: 'ReadonlyMap or entry iterable materialized atomically before collection ownership.', defaultValue: '[]', type: 'ReadonlyMap<K, V> | Iterable<readonly [K, V]>', whenToUse: 'Seed arbitrary key identities and values.', example: "new Map([['user-1', user]])" },
      { name: 'options.mutationGuard', description: 'Optional guard checked before set, delete, clear, and replace.', defaultValue: 'undefined', type: 'IMutationGuard', whenToUse: 'Share strict mutation admission with Store Light.', example: '{ mutationGuard }' },
      { name: 'options.debugName', description: 'Diagnostic prefix for structure, iteration, and lazy per-key cells.', defaultValue: "'ObservableMap'", type: 'string', whenToUse: 'Make keyed collection traces recognizable.', example: "{ debugName: 'usersById' }" },
      { name: 'runtime', description: 'Reactive Runtime that owns membership, value, and iteration dependencies.', defaultValue: 'defaultRuntime', type: 'IRuntime', whenToUse: 'Select the state ownership boundary explicitly.', example: 'runtime' }
    ],
    zh: [
      { name: 'initial', description: 'collection ownership 前原子 materialize 的 ReadonlyMap 或 entry iterable。', defaultValue: '[]', type: 'ReadonlyMap<K, V> | Iterable<readonly [K, V]>', whenToUse: '初始化任意 key identity 与 value。', example: "new Map([['user-1', user]])" },
      { name: 'options.mutationGuard', description: 'set、delete、clear 与 replace 前检查的可选 guard。', defaultValue: 'undefined', type: 'IMutationGuard', whenToUse: '与 Store Light 共享 strict mutation admission。', example: '{ mutationGuard }' },
      { name: 'options.debugName', description: 'structure、iteration 与惰性 per-key cell 的诊断前缀。', defaultValue: "'ObservableMap'", type: 'string', whenToUse: '让 keyed collection trace 容易识别。', example: "{ debugName: 'usersById' }" },
      { name: 'runtime', description: '拥有 membership、value 与 iteration dependency 的 Reactive Runtime。', defaultValue: 'defaultRuntime', type: 'IRuntime', whenToUse: '显式选择 state ownership boundary。', example: 'runtime' }
    ]
  },
  set: {
    en: [
      { name: 'initial', description: 'Iterable of initial members materialized before ownership; duplicate values collapse under native Set equality.', defaultValue: '[]', type: 'Iterable<T>', whenToUse: 'Seed a reactive membership domain.', example: "['read', 'write']" },
      { name: 'options.mutationGuard', description: 'Optional guard checked before add, delete, clear, and replace.', defaultValue: 'undefined', type: 'IMutationGuard', whenToUse: 'Apply the same write policy as other Store state.', example: '{ mutationGuard }' },
      { name: 'options.debugName', description: 'Diagnostic prefix for structure and lazy membership cells.', defaultValue: "'ObservableSet'", type: 'string', whenToUse: 'Identify the membership set in traces.', example: "{ debugName: 'permissions' }" },
      { name: 'runtime', description: 'Reactive Runtime owning structural and per-value membership dependencies.', defaultValue: 'defaultRuntime', type: 'IRuntime', whenToUse: 'Bind membership state to an explicit scope.', example: 'runtime' }
    ],
    zh: [
      { name: 'initial', description: 'ownership 前 materialize 的初始 member iterable；duplicate value 按 native Set equality 合并。', defaultValue: '[]', type: 'Iterable<T>', whenToUse: '初始化 reactive membership domain。', example: "['read', 'write']" },
      { name: 'options.mutationGuard', description: 'add、delete、clear 与 replace 前检查的可选 guard。', defaultValue: 'undefined', type: 'IMutationGuard', whenToUse: '与其他 Store state 使用同一 write policy。', example: '{ mutationGuard }' },
      { name: 'options.debugName', description: 'structure 与惰性 membership cell 的诊断前缀。', defaultValue: "'ObservableSet'", type: 'string', whenToUse: '在 trace 中标识该 membership set。', example: "{ debugName: 'permissions' }" },
      { name: 'runtime', description: '拥有 structural 与 per-value membership dependency 的 Reactive Runtime。', defaultValue: 'defaultRuntime', type: 'IRuntime', whenToUse: '把 membership state 绑定到显式 scope。', example: 'runtime' }
    ]
  }
}

/** Store Middleware Host fields, including inherited execution and cleanup controls. */
const storeMiddlewareHostOptions: Readonly<Record<IGuideLocale, readonly IApiOptionGuide[]>> = {
  en: [
    { name: 'execution.mutationTimeoutMs', description: 'Maximum duration of an admitted plugin install, update, or removal hook; false waits without a deadline.', defaultValue: 'required', optional: false, type: 'number | false', whenToUse: 'Bound plugin mutation work or explicitly accept unbounded waiting.', example: '5_000' },
    { name: 'execution.pipelineDrainTimeoutMs', description: 'Maximum wait for active pipeline leases to drain before logical removal continues; false waits until zero.', defaultValue: 'required', optional: false, type: 'number | false', whenToUse: 'Bound shutdown and plugin replacement latency.', example: '5_000' },
    { name: 'runtime', description: 'Reactive Runtime used for batching actions and reporting isolated middleware failures.', defaultValue: 'required', optional: false, type: 'IRuntime', whenToUse: 'Use the same Runtime that owns the observed state.', example: 'store.$runtime' },
    { name: 'getState', description: 'Returns the current state snapshot supplied to middleware and DevTools.', defaultValue: 'required', optional: false, type: '() => S', whenToUse: 'Expose a current, preferably isolated snapshot.', example: '() => ClonePolicy.diagnostic(state)' },
    { name: 'applyState', description: 'Optional state replacement capability used by DevTools jump and reset commands.', defaultValue: 'undefined', type: '(state: S) => void', whenToUse: 'Enable time travel only when restoring this state shape is safe.', example: '(next) => store.$hydrate(next)' },
    { name: 'mutationPolicy', description: 'Shared write guard used by runAction; omission creates a private off-mode policy.', defaultValue: "createMutationPolicy('off')", type: 'MutationPolicy', whenToUse: 'Pass the exact same actions-only instance used by the Store.', example: 'mutationPolicy' },
    { name: 'pipeline.mode', description: 'Requested pipeline mode. Store Middleware always overrides it to sync to keep event order within the originating write.', defaultValue: "'sync' (forced)", type: 'IPipelineMode', whenToUse: 'Do not configure another mode; use only synchronous pipeline stages.', example: "{ mode: 'sync' }" },
    { name: 'diagnostic', description: 'Optional Plugin Host diagnostic sink for queue, lifecycle, and pipeline violations.', defaultValue: 'undefined', type: '(message: string, code?: IPluginHostErrorCode) => void', whenToUse: 'Route operational diagnostics to application observability.', example: '(message, code) => report(message, code)' },
    { name: 'scheduler', description: 'Lifecycle clock and scheduling authority shared by queue watchdogs and disposal deadlines.', defaultValue: 'systemScheduler', type: 'ILifecycleScheduler', whenToUse: 'Inject deterministic time in tests or a host-owned scheduler.', example: 'testScheduler' },
    { name: 'queueAdmissionTimeoutMs', description: 'Queue admission deadline; undefined diagnoses without rejection, false disables its timer, and a number rejects after the bound.', defaultValue: 'undefined', type: 'number | false', whenToUse: 'Reject plugin operations that wait too long for admission.', example: '2_000' },
    { name: 'queueAdmissionDiagnosticMs', description: 'Diagnostic-only queue wait threshold used when no admission timeout is configured; false disables it.', defaultValue: 'implementation default', type: 'number | false', whenToUse: 'Detect slow admission without changing behavior.', example: '500' },
    { name: 'disposeStepTimeoutMs', description: 'Maximum duration of one disposer step before cleanup is forced forward; false waits forever.', defaultValue: 'implementation default', type: 'number | false', whenToUse: 'Bound shutdown when plugins own external cleanup.', example: '5_000' }
  ],
  zh: [
    { name: 'execution.mutationTimeoutMs', description: '获准 plugin install、update 或 removal hook 的最长执行时间；false 表示无 deadline。', defaultValue: '必填', optional: false, type: 'number | false', whenToUse: '约束 plugin mutation work，或显式接受无限等待。', example: '5_000' },
    { name: 'execution.pipelineDrainTimeoutMs', description: 'logical removal 继续前等待 active pipeline lease 归零的最长时间；false 会一直等待。', defaultValue: '必填', optional: false, type: 'number | false', whenToUse: '约束 shutdown 与 plugin replacement latency。', example: '5_000' },
    { name: 'runtime', description: '用于 batch action 与 report 隔离 middleware failure 的 Reactive Runtime。', defaultValue: '必填', optional: false, type: 'IRuntime', whenToUse: '使用拥有被观察 state 的同一个 Runtime。', example: 'store.$runtime' },
    { name: 'getState', description: '返回提供给 middleware 与 DevTools 的当前 state snapshot。', defaultValue: '必填', optional: false, type: '() => S', whenToUse: '暴露当前且最好已经隔离的 snapshot。', example: '() => ClonePolicy.diagnostic(state)' },
    { name: 'applyState', description: 'DevTools jump/reset command 使用的可选 state replacement capability。', defaultValue: 'undefined', type: '(state: S) => void', whenToUse: '只有安全恢复该 state shape 时才启用 time travel。', example: '(next) => store.$hydrate(next)' },
    { name: 'mutationPolicy', description: 'runAction 使用的共享 write guard；省略时创建私有 off-mode policy。', defaultValue: "createMutationPolicy('off')", type: 'MutationPolicy', whenToUse: '传入 Store 使用的完全同一个 actions-only instance。', example: 'mutationPolicy' },
    { name: 'pipeline.mode', description: '请求的 pipeline mode。Store Middleware 始终覆盖为 sync，确保 event order 留在原始 write 内。', defaultValue: "'sync'（强制）", type: 'IPipelineMode', whenToUse: '不要配置其他 mode；只使用 synchronous pipeline stage。', example: "{ mode: 'sync' }" },
    { name: 'diagnostic', description: 'queue、lifecycle 与 pipeline violation 的可选 Plugin Host diagnostic sink。', defaultValue: 'undefined', type: '(message: string, code?: IPluginHostErrorCode) => void', whenToUse: '把 operational diagnostic 接入 application observability。', example: '(message, code) => report(message, code)' },
    { name: 'scheduler', description: 'queue watchdog 与 disposal deadline 共享的 lifecycle clock/scheduling authority。', defaultValue: 'systemScheduler', type: 'ILifecycleScheduler', whenToUse: '测试注入 deterministic time，或使用 host-owned scheduler。', example: 'testScheduler' },
    { name: 'queueAdmissionTimeoutMs', description: 'queue admission deadline；undefined 只诊断不拒绝，false 禁用 timer，number 在到期后拒绝。', defaultValue: 'undefined', type: 'number | false', whenToUse: '拒绝等待 admission 过久的 plugin operation。', example: '2_000' },
    { name: 'queueAdmissionDiagnosticMs', description: '未配置 admission timeout 时使用的仅诊断 queue wait threshold；false 禁用。', defaultValue: '实现默认值', type: 'number | false', whenToUse: '不改变行为地检测 slow admission。', example: '500' },
    { name: 'disposeStepTimeoutMs', description: '单个 disposer step 被 force forward 前允许的最长时间；false 永久等待。', defaultValue: '实现默认值', type: 'number | false', whenToUse: 'plugin 拥有外部 cleanup 时约束 shutdown。', example: '5_000' }
  ]
}

/** Core persistence controls shared by Light, Indexed, Keyed, and custom persistence units. */
const storePersistUnitOptions: Readonly<Record<IGuideLocale, readonly IApiOptionGuide[]>> = {
  en: [
    { name: 'unit', description: 'Minimal synchronous state adapter providing snapshot, restore, and subscribe.', defaultValue: 'required', optional: false, type: 'IPersistUnit<TState>', whenToUse: 'Adapt a custom state owner into the shared persistence engine.', example: '{ snapshot, restore, subscribe }' },
    { name: 'options.key', description: 'Non-empty storage key owning one versioned envelope.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Choose a stable namespace unique to this persisted unit.', example: "'settings:v1'" },
    { name: 'options.runtime', description: 'Reactive Runtime owning handle status, error, and hydration signals.', defaultValue: 'required', optional: false, type: 'IRuntime', whenToUse: 'Use the same Runtime as the adapted Store or collection.', example: 'store.$runtime' },
    { name: 'options.storage', description: 'Text key-value storage with optional byte methods and declared capabilities.', defaultValue: 'required', optional: false, type: 'IPersistStorage', whenToUse: 'Provide the storage boundary that owns read, write, remove, and keys.', example: 'storage' },
    { name: 'options.codec', description: 'Encodes and decodes the complete { version, state } envelope.', defaultValue: 'defaultJsonCodec', type: 'ICodec', whenToUse: 'Override for binary data or a domain-specific serialization contract.', example: 'binaryCodec' },
    { name: 'options.version', description: 'Non-negative safe-integer schema version written into each envelope.', defaultValue: '0', type: 'number', whenToUse: 'Increment when persisted state requires migration.', example: '2' },
    { name: 'options.migrate', description: 'Synchronous transformation from persisted state and its previous version to the current state shape.', defaultValue: 'undefined', type: '(persisted: TState, fromVersion: number) => TState', whenToUse: 'Read older envelopes after increasing version.', example: '(old, from) => migrateSettings(old, from)' },
    { name: 'options.partialize', description: 'Synchronous projection selecting the subset written to storage.', defaultValue: '(state) => state', type: '(state: TState) => Partial<TState>', whenToUse: 'Exclude transient, derived, secret, or externally owned fields.', example: '({ token: _token, ...safe }) => safe' },
    { name: 'options.merge', description: 'Synchronous reconciliation of persisted partial state with the current live state during hydration.', defaultValue: 'shallow current-first plain-object merge; replacement otherwise', type: '(persisted: Partial<TState>, current: TState) => TState', whenToUse: 'Preserve startup writes or implement collection-specific replacement.', example: '(persisted, current) => ({ ...current, ...persisted })' },
    { name: 'options.debounceMs', description: 'Finite delay before a change is written; zero schedules immediate queued persistence.', defaultValue: '0', type: 'number', whenToUse: 'Coalesce high-frequency writes within an accepted durability window.', example: '250' }
  ],
  zh: [
    { name: 'unit', description: '提供 snapshot、restore 与 subscribe 的最小同步 state adapter。', defaultValue: '必填', optional: false, type: 'IPersistUnit<TState>', whenToUse: '把 custom state owner 接入共享 persistence engine。', example: '{ snapshot, restore, subscribe }' },
    { name: 'options.key', description: '拥有一份 versioned envelope 的非空 storage key。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '选择该 persisted unit 独占的稳定 namespace。', example: "'settings:v1'" },
    { name: 'options.runtime', description: '拥有 handle status、error 与 hydration signal 的 Reactive Runtime。', defaultValue: '必填', optional: false, type: 'IRuntime', whenToUse: '使用 adapted Store 或 collection 的同一个 Runtime。', example: 'store.$runtime' },
    { name: 'options.storage', description: '声明 capabilities、可选 byte method 的 text key-value storage。', defaultValue: '必填', optional: false, type: 'IPersistStorage', whenToUse: '提供拥有 read、write、remove 与 keys 的 storage boundary。', example: 'storage' },
    { name: 'options.codec', description: '编码和解码完整 { version, state } envelope。', defaultValue: 'defaultJsonCodec', type: 'ICodec', whenToUse: 'binary data 或 domain-specific serialization contract 时覆盖。', example: 'binaryCodec' },
    { name: 'options.version', description: '写入每个 envelope 的非负安全整数 schema version。', defaultValue: '0', type: 'number', whenToUse: 'persisted state 需要 migration 时递增。', example: '2' },
    { name: 'options.migrate', description: '把 persisted state 与旧 version 同步转换为当前 state shape。', defaultValue: 'undefined', type: '(persisted: TState, fromVersion: number) => TState', whenToUse: 'version 增加后继续读取旧 envelope。', example: '(old, from) => migrateSettings(old, from)' },
    { name: 'options.partialize', description: '选择写入 storage subset 的同步 projection。', defaultValue: '(state) => state', type: '(state: TState) => Partial<TState>', whenToUse: '排除 transient、derived、secret 或 externally owned field。', example: '({ token: _token, ...safe }) => safe' },
    { name: 'options.merge', description: 'hydration 时协调 persisted partial state 与当前 live state 的同步函数。', defaultValue: 'plain object 浅层 current-first merge；其他 shape replacement', type: '(persisted: Partial<TState>, current: TState) => TState', whenToUse: '保留 startup write 或实现 collection-specific replacement。', example: '(persisted, current) => ({ ...current, ...persisted })' },
    { name: 'options.debounceMs', description: 'state change 写入前的有限延迟；0 表示立即排队持久化。', defaultValue: '0', type: 'number', whenToUse: '在可接受 durability window 内合并高频 write。', example: '250' }
  ]
}

/** Builds the bilingual guide for one Store Persist error constructor. */
function createStorePersistErrorGuide(
  nativeType: string,
  behaviorEn: string,
  behaviorZh: string,
  options: readonly IApiOptionGuide[]
): Readonly<Record<IGuideLocale, IApiGuide>> {
  return {
    en: {
      purpose: `Creates a ${nativeType} carrying the stable Store Persist source/code identity. ${behaviorEn}`,
      quickStart: `const error = createStorePersist${nativeType}(
  StorePersistErrorCode.invalidOption,
  'Invalid persistence configuration'
)`,
      scenarios: ['A public boundary must expose a machine-readable failure code.', 'The native error class must survive tagging.', 'The original failure must remain reachable for diagnostics.'],
      avoidWhen: ['Representing a normal persistence state.', 'Rewriting an error that already carries the correct identity.', 'Hiding the original failure or replacing its stack.'],
      options
    },
    zh: {
      purpose: `创建带稳定 Store Persist source/code identity 的 ${nativeType}。${behaviorZh}`,
      quickStart: `const error = createStorePersist${nativeType}(
  StorePersistErrorCode.invalidOption,
  '持久化配置无效'
)`,
      scenarios: ['公开边界需要暴露机器可读 failure code。', 'tagging 后必须保留 native error class。', '诊断时必须仍可到达原始 failure。'],
      avoidWhen: ['表示正常 persistence state。', 'error 已经带有正确 identity。', '会隐藏原始 failure 或替换其 stack。'],
      options: options.map((option) => ({
        ...option,
        defaultValue: option.optional === false ? '必填' : option.defaultValue,
        description:
          option.name === 'code'
            ? '来自 StorePersistErrorCode 的稳定语义码。'
            : option.name === 'message'
              ? '面向人类的错误说明；机器分支应读取 source 与 code。'
              : option.name === 'errors'
                ? '按原顺序保留在 AggregateError.errors 中的全部 failure。'
                : '保留原始 failure identity 的可选 cause。',
        whenToUse:
          option.name === 'code'
            ? '选择与实际 failure 条件完全对应的已注册 code。'
            : option.name === 'message'
              ? '提供包含上下文但不承担 machine contract 的说明。'
              : option.name === 'errors'
                ? '聚合多个并行或 cleanup failure，且不能丢失任一原因。'
                : '包装 lower-level failure 时传入。'
      }))
    }
  }
}

/** Common parameters for Store Persist Error and TypeError factories. */
const storePersistCauseErrorOptions: readonly IApiOptionGuide[] = [
  { name: 'code', description: 'Stable semantic code from StorePersistErrorCode.', defaultValue: 'required', optional: false, type: 'IStorePersistErrorCode', whenToUse: 'Select the registered condition that actually occurred.', example: 'StorePersistErrorCode.invalidOption' },
  { name: 'message', description: 'Human-readable context; callers branch on source and code instead.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Explain the concrete failed operation.', example: "'version must be non-negative'" },
  { name: 'options.cause', description: 'Optional original failure retained by identity on the cause chain.', defaultValue: 'undefined', type: 'unknown', whenToUse: 'Wrap a lower-level failure without severing traceability.', example: 'cause' }
]

/** Parameters for the Store Persist AbortError factory. */
const storePersistAbortErrorOptions: readonly IApiOptionGuide[] = [
  ...storePersistCauseErrorOptions.slice(0, 2),
  { name: 'cause', description: 'Optional cancellation reason retained on the DOMException.', defaultValue: 'undefined', type: 'unknown', whenToUse: 'Preserve the disposal or upstream abort reason.', example: 'signal.reason' }
]

/** Parameters for the Store Persist AggregateError factory. */
const storePersistAggregateErrorOptions: readonly IApiOptionGuide[] = [
  storePersistCauseErrorOptions[0]!,
  { name: 'errors', description: 'Ordered failures retained in AggregateError.errors.', defaultValue: 'required', optional: false, type: 'readonly unknown[]', whenToUse: 'Expose every hydrate/write or cleanup failure.', example: '[hydrateError, writeError]' },
  storePersistCauseErrorOptions[1]!
]

/** Creates one explicitly maintained bilingual Store React hook guide. */
function createStoreReactHookGuide(input: {
  readonly purposeEn: string
  readonly purposeZh: string
  readonly quickStart: string
  readonly scenariosEn: readonly string[]
  readonly scenariosZh: readonly string[]
  readonly avoidEn: readonly string[]
  readonly avoidZh: readonly string[]
  readonly optionsEn: readonly IApiOptionGuide[]
  readonly optionsZh: readonly IApiOptionGuide[]
}): Readonly<Record<IGuideLocale, IApiGuide>> {
  return {
    en: {
      purpose: input.purposeEn,
      quickStart: input.quickStart,
      scenarios: input.scenariosEn,
      avoidWhen: input.avoidEn,
      options: input.optionsEn
    },
    zh: {
      purpose: input.purposeZh,
      quickStart: input.quickStart,
      scenarios: input.scenariosZh,
      avoidWhen: input.avoidZh,
      options: input.optionsZh
    }
  }
}

/** Creates an explicitly maintained bilingual Storage Contract boundary guide. */
function createStorageContractGuide(input: {
  readonly purposeEn: string
  readonly purposeZh: string
  readonly quickStart: string
  readonly scenariosEn: readonly string[]
  readonly scenariosZh: readonly string[]
  readonly avoidEn: readonly string[]
  readonly avoidZh: readonly string[]
  readonly optionsEn?: readonly IApiOptionGuide[]
  readonly optionsZh?: readonly IApiOptionGuide[]
}): Readonly<Record<IGuideLocale, IApiGuide>> {
  return {
    en: {
      purpose: input.purposeEn,
      quickStart: input.quickStart,
      scenarios: input.scenariosEn,
      avoidWhen: input.avoidEn,
      options: input.optionsEn ?? []
    },
    zh: {
      purpose: input.purposeZh,
      quickStart: input.quickStart,
      scenarios: input.scenariosZh,
      avoidWhen: input.avoidZh,
      options: input.optionsZh ?? []
    }
  }
}

/** Creates an explicitly maintained bilingual Serialize guide. */
const createSerializeGuide = createStorageContractGuide

/** Creates an explicitly maintained bilingual Storage Web guide. */
const createStorageWebGuide = createStorageContractGuide

const apiGuides: Readonly<Record<string, Readonly<Partial<Record<IGuideLocale, IApiGuide>>>>> = {
  ...completionApiGuides,
  ...webRpcApiGuides,
  ...utilsApiGuides,
  'storage-web:memory:memoryStorage': createStorageWebGuide({
    purposeEn: 'Creates an isolated synchronous in-memory record store with text, byte, structured-record, transaction, iteration, metadata, and post-commit change-feed channels. It is process-local and loses all data when the instance is discarded.',
    purposeZh: '创建隔离的 synchronous in-memory record store，提供 text、byte、structured-record、transaction、iteration、metadata 与 post-commit change-feed channel。它仅存在于当前 process，instance 丢弃后全部数据消失。',
    quickStart: 'const storage = memoryStorage<User>()\nawait storage.putRecord({ id: 1, name: \'Ada\' }, 1)\nconst user = await storage.getRecord(1)',
    scenariosEn: ['Tests need a real contract implementation without browser globals.', 'Ephemeral application state needs record and transaction semantics.', 'A fallback store must remain synchronous and observable.'],
    scenariosZh: ['测试需要不依赖 browser global 的真实 contract implementation。', 'ephemeral application state 需要 record 与 transaction semantics。', 'fallback store 必须保持 synchronous 且 observable。'],
    avoidEn: ['Data must survive reload or process restart.', 'Several tabs need a shared durable source.', 'Memory growth is not bounded by the owner lifecycle.'],
    avoidZh: ['data 必须跨 reload 或 process restart 保留。', '多个 tab 需要 shared durable source。', 'owner lifecycle 无法约束 memory growth。']
  }),
  'storage-web:local-storage:localStorage': createStorageWebGuide({
    purposeEn: 'Creates a namespaced synchronous key-value store over Web Storage localStorage. It persists text values across reloads, exposes sync and async views, and never claims record, binary, transaction, or change-feed capabilities.',
    purposeZh: '在 Web Storage localStorage 上创建 namespaced synchronous key-value store。它跨 reload 持久化 text value，提供 sync/async view，并且不会声称支持 record、binary、transaction 或 change-feed。',
    quickStart: "const settings = localStorage({ namespace: 'settings' })\nsettings.sync.set('theme', 'dark')\nconsole.log(await settings.get('theme'))",
    scenariosEn: ['Small durable browser settings.', 'Immediate synchronous reads are required at startup.', 'A namespace must isolate several application roots.'],
    scenariosZh: ['小型 durable browser settings。', 'startup 需要 immediate synchronous read。', 'namespace 必须隔离多个 application root。'],
    avoidEn: ['Large or structured records are required.', 'Writes need transactions or cross-tab change feeds.', 'The host may not provide Web Storage and no injection is available.'],
    avoidZh: ['需要 large 或 structured record。', 'write 需要 transaction 或 cross-tab change feed。', 'host 可能没有 Web Storage 且无法 injection。'],
    optionsEn: [
      { name: 'namespace', description: 'Logical prefix isolating physical keys from other store instances.', defaultValue: "'default'", type: 'string', whenToUse: 'Give each application or feature a stable key domain.', example: "'settings'" },
      { name: 'namespaceCodec', description: 'Advanced physical-key codec; changing it changes the persisted key format.', defaultValue: 'lengthPrefixedNamespaceCodec', type: 'INamespaceCodec', whenToUse: 'Only for an explicitly migrated custom key layout.', example: 'customNamespaceCodec' },
      { name: 'storage', description: 'Injected Web Storage-compatible surface.', defaultValue: 'globalThis.localStorage', type: 'IWebStorageLike', whenToUse: 'Use tests, non-browser hosts, or an explicit storage owner.', example: 'fakeStorage' }
    ],
    optionsZh: [
      { name: 'namespace', description: '把 physical key 与其他 store instance 隔离的 logical prefix。', defaultValue: "'default'", type: 'string', whenToUse: '为每个 application 或 feature 提供稳定 key domain。', example: "'settings'" },
      { name: 'namespaceCodec', description: 'advanced physical-key codec；改变它就会改变 persisted key format。', defaultValue: 'lengthPrefixedNamespaceCodec', type: 'INamespaceCodec', whenToUse: '仅用于已经显式迁移的 custom key layout。', example: 'customNamespaceCodec' },
      { name: 'storage', description: 'injected Web Storage-compatible surface。', defaultValue: 'globalThis.localStorage', type: 'IWebStorageLike', whenToUse: '用于测试、non-browser host 或 explicit storage owner。', example: 'fakeStorage' }
    ]
  }),
  'storage-web:session-storage:sessionStorage': createStorageWebGuide({
    purposeEn: 'Creates a namespaced synchronous key-value store over sessionStorage. Values survive reload within one browsing context but are discarded when that tab or window session ends.',
    purposeZh: '在 sessionStorage 上创建 namespaced synchronous key-value store。value 在同一 browsing context 的 reload 后仍存在，但 tab/window session 结束时会被丢弃。',
    quickStart: "const draft = sessionStorage({ namespace: 'checkout' })\ndraft.sync.set('step', 'shipping')",
    scenariosEn: ['Per-tab drafts survive reload.', 'Sensitive workflow state should not persist indefinitely.', 'Synchronous startup reads are required within one session.'],
    scenariosZh: ['per-tab draft 需要跨 reload。', 'sensitive workflow state 不应无限期持久化。', '单个 session 内需要 synchronous startup read。'],
    avoidEn: ['Data must be shared across tabs.', 'Data must survive browser restart.', 'Structured records or transactions are required.'],
    avoidZh: ['data 必须跨 tab 共享。', 'data 必须跨 browser restart 保留。', '需要 structured record 或 transaction。'],
    optionsEn: [
      { name: 'namespace', description: 'Logical prefix isolating physical keys.', defaultValue: "'default'", type: 'string', whenToUse: 'Separate independent session workflows.', example: "'checkout'" },
      { name: 'namespaceCodec', description: 'Advanced physical-key codec with persisted-format consequences.', defaultValue: 'lengthPrefixedNamespaceCodec', type: 'INamespaceCodec', whenToUse: 'Use only with an explicit format migration.', example: 'customNamespaceCodec' },
      { name: 'storage', description: 'Injected Web Storage-compatible surface.', defaultValue: 'globalThis.sessionStorage', type: 'IWebStorageLike', whenToUse: 'Use tests or non-browser hosts.', example: 'fakeStorage' }
    ],
    optionsZh: [
      { name: 'namespace', description: '隔离 physical key 的 logical prefix。', defaultValue: "'default'", type: 'string', whenToUse: '分离 independent session workflow。', example: "'checkout'" },
      { name: 'namespaceCodec', description: '会影响 persisted format 的 advanced physical-key codec。', defaultValue: 'lengthPrefixedNamespaceCodec', type: 'INamespaceCodec', whenToUse: '仅配合显式 format migration 使用。', example: 'customNamespaceCodec' },
      { name: 'storage', description: 'injected Web Storage-compatible surface。', defaultValue: 'globalThis.sessionStorage', type: 'IWebStorageLike', whenToUse: '用于测试或 non-browser host。', example: 'fakeStorage' }
    ]
  }),
  'storage-web:cookies:cookies': createStorageWebGuide({
    purposeEn: 'Creates a namespaced synchronous cookie-backed text store with one fixed scope for every write and removal. Cookie limits and visibility apply: a missing JavaScript-visible key does not prove an HttpOnly cookie is absent.',
    purposeZh: '创建 namespaced synchronous cookie-backed text store，并为每次 write/removal 使用同一个 fixed scope。cookie limit 与 visibility 仍然成立：JavaScript 看不到 key，并不能证明 HttpOnly cookie 不存在。',
    quickStart: "const preferences = cookies({ namespace: 'prefs', scope: { path: '/', sameSite: 'lax', secure: true } })\nawait preferences.set('theme', 'dark', { maxAge: 86_400 })",
    scenariosEn: ['A small value must accompany HTTP requests.', 'Cookie write and delete scope must remain identical.', 'Tests need an injected document.cookie surface.'],
    scenariosZh: ['small value 必须随 HTTP request 发送。', 'cookie write 与 delete scope 必须完全一致。', '测试需要 injected document.cookie surface。'],
    avoidEn: ['Values may exceed about 4 KiB.', 'Absence must be authoritative despite HttpOnly entries.', 'Structured records, transactions, or iteration are required.'],
    avoidZh: ['value 可能超过约 4 KiB。', '存在 HttpOnly entry 时仍要求 absence authoritative。', '需要 structured record、transaction 或 iteration。'],
    optionsEn: [
      { name: 'namespace', description: 'Logical prefix isolating cookie names.', defaultValue: "'default'", type: 'string', whenToUse: 'Separate independent cookie domains.', example: "'prefs'" },
      { name: 'namespaceCodec', description: 'Advanced physical-name codec; changing it changes the persisted cookie format.', defaultValue: 'lengthPrefixedNamespaceCodec', type: 'INamespaceCodec', whenToUse: 'Only with an explicit cookie-name migration.', example: 'customNamespaceCodec' },
      { name: 'scope.path', description: 'Path applied identically to writes and removals.', defaultValue: 'undefined', type: 'string', whenToUse: 'Limit request visibility to one URL subtree.', example: "'/'" },
      { name: 'scope.domain', description: 'Domain applied identically to writes and removals.', defaultValue: 'undefined', type: 'string', whenToUse: 'Share a cookie across intended subdomains.', example: "'.example.com'" },
      { name: 'scope.sameSite', description: 'Cross-site delivery policy.', defaultValue: 'undefined', type: "'strict' | 'lax' | 'none'", whenToUse: 'Choose the CSRF and navigation behavior deliberately.', example: "'lax'" },
      { name: 'scope.secure', description: 'Restricts delivery to secure transports.', defaultValue: 'false', type: 'boolean', whenToUse: 'Enable for production HTTPS cookies.', example: 'true' },
      { name: 'scope.partitioned', description: 'Requests partitioned cookie storage where supported.', defaultValue: 'false', type: 'boolean', whenToUse: 'Use in an embedded cross-site context with explicit policy.', example: 'true' },
      { name: 'document', description: 'Injected document.cookie-compatible owner.', defaultValue: 'globalThis.document', type: 'ICookieDocument', whenToUse: 'Use tests or an explicit host adapter.', example: 'fakeCookieDocument' }
    ],
    optionsZh: [
      { name: 'namespace', description: '隔离 cookie name 的 logical prefix。', defaultValue: "'default'", type: 'string', whenToUse: '分离 independent cookie domain。', example: "'prefs'" },
      { name: 'namespaceCodec', description: 'advanced physical-name codec；改变它会改变 persisted cookie format。', defaultValue: 'lengthPrefixedNamespaceCodec', type: 'INamespaceCodec', whenToUse: '仅配合显式 cookie-name migration 使用。', example: 'customNamespaceCodec' },
      { name: 'scope.path', description: 'write 与 removal 使用完全相同的 path。', defaultValue: 'undefined', type: 'string', whenToUse: '把 request visibility 限制在 URL subtree。', example: "'/'" },
      { name: 'scope.domain', description: 'write 与 removal 使用完全相同的 domain。', defaultValue: 'undefined', type: 'string', whenToUse: '在预期 subdomain 之间共享 cookie。', example: "'.example.com'" },
      { name: 'scope.sameSite', description: 'cross-site delivery policy。', defaultValue: 'undefined', type: "'strict' | 'lax' | 'none'", whenToUse: '明确选择 CSRF 与 navigation behavior。', example: "'lax'" },
      { name: 'scope.secure', description: '把 delivery 限制到 secure transport。', defaultValue: 'false', type: 'boolean', whenToUse: 'production HTTPS cookie 应开启。', example: 'true' },
      { name: 'scope.partitioned', description: '在支持的 host 请求 partitioned cookie storage。', defaultValue: 'false', type: 'boolean', whenToUse: '在 embedded cross-site context 按明确 policy 使用。', example: 'true' },
      { name: 'document', description: 'injected document.cookie-compatible owner。', defaultValue: 'globalThis.document', type: 'ICookieDocument', whenToUse: '用于测试或 explicit host adapter。', example: 'fakeCookieDocument' }
    ]
  }),
  'storage-web:indexed-db:indexedDb': createStorageWebGuide({
    purposeEn: 'Creates the durable structured browser store: text, bytes, records, transactions, iteration, metadata, secondary indexes, and post-commit change feed. Opening and schema work remain lazy until the first operation.',
    purposeZh: '创建 durable structured browser store，提供 text、bytes、records、transactions、iteration、metadata、secondary indexes 与 post-commit change feed。open 与 schema work 会延迟到首次 operation。',
    quickStart: "const db = indexedDb<User>({ dbName: 'app-data', recordsStoreName: 'users' })\nawait db.putRecord({ id: 1, email: 'ada@example.com' }, 1)\nfor await (const [key, user] of db.iterateRecords()) consume(key, user)",
    scenariosEn: ['Durable structured records exceed Web Storage limits.', 'Transactions, iteration, indexes, or change feeds are required.', 'Binary payloads need a native byte channel.'],
    scenariosZh: ['durable structured record 超过 Web Storage limit。', '需要 transaction、iteration、index 或 change feed。', 'binary payload 需要 native byte channel。'],
    avoidEn: ['Only a tiny synchronous setting is needed.', 'The host lacks IndexedDB and no factory injection is available.', 'The caller cannot dispose the store lifecycle.'],
    avoidZh: ['只需要 tiny synchronous setting。', 'host 缺少 IndexedDB 且无法 injection factory。', 'caller 无法 dispose store lifecycle。'],
    optionsEn: [
      { name: 'dbName', description: 'Physical IndexedDB database name.', defaultValue: "'storage-web'", type: 'string', whenToUse: 'Isolate an application or explicit database lifecycle.', example: "'app-data'" },
      { name: 'kvStoreName', description: 'Object store for the string key-value channel.', defaultValue: "'kv'", type: 'string', whenToUse: 'Preserve an existing physical layout or choose an explicit one.', example: "'settings'" },
      { name: 'bytesStoreName', description: 'Object store for binary values.', defaultValue: "'bytes'", type: 'string', whenToUse: 'Preserve an existing byte-channel layout.', example: "'assets'" },
      { name: 'recordsStoreName', description: 'Object store for structured records.', defaultValue: "'records'", type: 'string', whenToUse: 'Name the primary record collection.', example: "'users'" },
      { name: 'cleanupLegacyRecords', description: 'Explicit release-time opt-in to delete the migrated legacy documents store.', defaultValue: 'false', type: 'boolean', whenToUse: 'Enable only after migration evidence proves rollback is no longer needed.', example: 'true' },
      { name: 'factory', description: 'Injected IndexedDB factory.', defaultValue: 'globalThis.indexedDB', type: 'IDBFactory', whenToUse: 'Use fake-indexeddb in tests or an explicit host adapter.', example: 'indexedDB' },
      { name: 'keyRange', description: 'Injected IDBKeyRange constructor paired with factory.', defaultValue: 'globalThis.IDBKeyRange', type: 'typeof IDBKeyRange', whenToUse: 'Inject alongside a non-host factory.', example: 'IDBKeyRange' }
    ],
    optionsZh: [
      { name: 'dbName', description: 'physical IndexedDB database name。', defaultValue: "'storage-web'", type: 'string', whenToUse: '隔离 application 或 explicit database lifecycle。', example: "'app-data'" },
      { name: 'kvStoreName', description: 'string key-value channel 使用的 object store。', defaultValue: "'kv'", type: 'string', whenToUse: '保留 existing physical layout 或显式选择。', example: "'settings'" },
      { name: 'bytesStoreName', description: 'binary value 使用的 object store。', defaultValue: "'bytes'", type: 'string', whenToUse: '保留 existing byte-channel layout。', example: "'assets'" },
      { name: 'recordsStoreName', description: 'structured record 使用的 object store。', defaultValue: "'records'", type: 'string', whenToUse: '命名 primary record collection。', example: "'users'" },
      { name: 'cleanupLegacyRecords', description: 'release 时删除 migrated legacy documents store 的显式 opt-in。', defaultValue: 'false', type: 'boolean', whenToUse: '只有 migration evidence 证明不再需要 rollback 后才开启。', example: 'true' },
      { name: 'factory', description: 'injected IndexedDB factory。', defaultValue: 'globalThis.indexedDB', type: 'IDBFactory', whenToUse: '测试使用 fake-indexeddb，或接入 explicit host adapter。', example: 'indexedDB' },
      { name: 'keyRange', description: '与 factory 配对的 injected IDBKeyRange constructor。', defaultValue: 'globalThis.IDBKeyRange', type: 'typeof IDBKeyRange', whenToUse: '使用 non-host factory 时一起注入。', example: 'IDBKeyRange' }
    ]
  }),
  'storage-web:serialize:jsonCodec': createStorageWebGuide({
    purposeEn: 'The default zero-dependency codec for JSON-compatible values. It writes text on every backend, converts undefined top-level results to null, and reports serialization and parsing failures as StorageError values.',
    purposeZh: '面向 JSON-compatible value 的默认零依赖 codec。它在所有 backend 写入 text，把 top-level undefined 结果归一为 null，并将 stringify/parse failure 报告为 StorageError。',
    quickStart: "const raw = await jsonCodec.encode({ id: 1, name: 'Ada' })\nconst user = await jsonCodec.decode(raw)",
    scenariosEn: ['Portable text storage across every backend.', 'Plain objects and arrays need the smallest built-in choice.', 'Persisted payloads must remain inspectable as JSON.'],
    scenariosZh: ['需要跨所有 backend 的 portable text storage。', 'plain object 与 array 需要最小 built-in choice。', 'persisted payload 必须保持可检查的 JSON text。'],
    avoidEn: ['Values contain cycles, Map, Set, Blob, or other structured-clone data.', 'Exact Uint8Array identity and byte transport are required.', 'Domain values require an explicit replacer, reviver, or versioned schema.'],
    avoidZh: ['value 包含 cycle、Map、Set、Blob 或其他 structured-clone data。', '需要精确 Uint8Array 与 byte transport。', 'domain value 需要显式 replacer、reviver 或 versioned schema。']
  }),
  'storage-web:serialize:binaryCodec': createStorageWebGuide({
    purposeEn: 'Passes Uint8Array payloads through the binary channel without JSON conversion. selectCodec keeps bytes native on binary backends and explicitly wraps them as Base64 on text-only backends.',
    purposeZh: '通过 binary channel 直接传递 Uint8Array，不经过 JSON conversion。selectCodec 在 binary backend 保持原生 bytes，在 text-only backend 则显式包装为 Base64。',
    quickStart: 'const bytes = new Uint8Array([1, 2, 3])\nconst encoded = await binaryCodec.encode(bytes)\nconst restored = await binaryCodec.decode(encoded)',
    scenariosEn: ['Images, hashes, or protocol frames are already bytes.', 'A binary-capable backend should avoid text conversion.', 'One entity must remain portable to a text-only backend through explicit selection.'],
    scenariosZh: ['image、hash 或 protocol frame 已经是 bytes。', 'binary-capable backend 应避免 text conversion。', '同一 entity 需要通过显式 selection 兼容 text-only backend。'],
    avoidEn: ['The input is not a Uint8Array.', 'Base64 expansion is unacceptable on a text-only backend.', 'Structured records should remain queryable by IndexedDB.'],
    avoidZh: ['input 不是 Uint8Array。', 'text-only backend 无法接受 Base64 体积膨胀。', 'structured record 需要在 IndexedDB 中保持可查询。']
  }),
  'storage-web:serialize:structuredCodec': createStorageWebGuide({
    purposeEn: 'Preserves structured-clone values without serialization so an IndexedDB-style record backend can store Blob, File, ArrayBuffer, Map, Set, Date, and cyclic graphs. Selection rejects backends without record capability instead of losing data.',
    purposeZh: '不做 serialization，保留 structured-clone value，让 IndexedDB 类 record backend 存储 Blob、File、ArrayBuffer、Map、Set、Date 与 cyclic graph。selection 遇到不支持 record 的 backend 会拒绝，而不是丢失数据。',
    quickStart: "const payload = { createdAt: new Date(), tags: new Set(['stable']) }\nconst stored = await structuredCodec.encode(payload)",
    scenariosEn: ['IndexedDB records contain native structured-clone values.', 'Cycles or non-JSON containers must retain semantics.', 'Serialization cost should be delegated to the backend clone algorithm.'],
    scenariosZh: ['IndexedDB record 包含 native structured-clone value。', 'cycle 或 non-JSON container 必须保留 semantics。', 'serialization cost 应交给 backend clone algorithm。'],
    avoidEn: ['The selected backend only stores text or bytes.', 'Data must be portable outside structured-clone environments.', 'A stable wire format is required for interchange or debugging.'],
    avoidZh: ['selected backend 只支持 text 或 bytes。', 'data 必须跨 structured-clone environment portable。', 'interchange 或 debugging 需要稳定 wire format。']
  }),
  'storage-web:serialize:selectCodec': createStorageWebGuide({
    purposeEn: 'Binds a codec to one backend capability snapshot. Matching output stays direct, binary-to-text uses a reported Base64 fallback, and structured-to-text fails explicitly because no lossless fallback exists.',
    purposeZh: '把 codec 绑定到一次 backend capability snapshot。匹配的 output 直接使用；binary-to-text 使用会被报告的 Base64 fallback；structured-to-text 因不存在无损 fallback 而显式失败。',
    quickStart: "const selected = selectCodec(binaryCodec, storage.capabilities, console.warn)\nawait storage.set('avatar', await selected.encode(bytes))",
    scenariosEn: ['An entity codec must be reconciled with its concrete backend.', 'Binary data may accept an observable Base64 fallback.', 'Unsupported structured output must fail before the first write.'],
    scenariosZh: ['entity codec 必须与 concrete backend 对齐。', 'binary data 可以接受 observable Base64 fallback。', 'unsupported structured output 必须在首次 write 前失败。'],
    avoidEn: ['The codec and backend have not been validated as public descriptors.', 'A silent or lossy structured fallback is expected.', 'Diagnostics are being used as control flow.'],
    avoidZh: ['codec 与 backend 尚未作为 public descriptor 验证。', '期望 silent 或 lossy structured fallback。', '把 diagnostic 当作 control flow。'],
    optionsEn: [
      { name: 'codec', description: 'Codec descriptor whose name, output, encode, and decode members are snapshotted before selection.', defaultValue: 'required', optional: false, type: 'ICodec', whenToUse: 'Provide the entity or operation codec being bound.', example: 'binaryCodec' },
      { name: 'capabilities', description: 'Complete backend capability descriptor used to select direct, fallback, or rejected output.', defaultValue: 'required', optional: false, type: 'IStorageCapabilities', whenToUse: 'Pass the capabilities from the exact target store.', example: 'storage.capabilities' },
      { name: 'onDiagnostic', description: 'Observes the binary-to-Base64 size fallback; sink failures are contained.', defaultValue: 'undefined', type: '(message: string) => void', whenToUse: 'Surface the +33% storage tradeoff in diagnostics.', example: 'console.warn' }
    ],
    optionsZh: [
      { name: 'codec', description: 'selection 前会 snapshot name、output、encode 与 decode 的 codec descriptor。', defaultValue: 'required', optional: false, type: 'ICodec', whenToUse: '传入需要绑定的 entity 或 operation codec。', example: 'binaryCodec' },
      { name: 'capabilities', description: '用于选择 direct、fallback 或 reject 路径的完整 backend capability descriptor。', defaultValue: 'required', optional: false, type: 'IStorageCapabilities', whenToUse: '传入准确 target store 的 capabilities。', example: 'storage.capabilities' },
      { name: 'onDiagnostic', description: '观察 binary-to-Base64 size fallback；sink failure 会被隔离。', defaultValue: 'undefined', type: '(message: string) => void', whenToUse: '在 diagnostic 中暴露 +33% storage tradeoff。', example: 'console.warn' }
    ]
  }),
  'storage-web:schema:fromStandardSchema': createStorageWebGuide({
    purposeEn: 'Adapts a Standard Schema v1 validator to the storage entity schema contract without importing Zod, Valibot, or ArkType. Both synchronous and asynchronous validators are supported, and issue messages remain the validation failure cause.',
    purposeZh: '把 Standard Schema v1 validator 适配为 storage entity schema contract，无需 import Zod、Valibot 或 ArkType。支持 sync/async validator，并把 issue message 保留为 validation failure cause。',
    quickStart: 'const userSchema = fromStandardSchema(z.object({ id: z.number(), name: z.string() }))\nconst user = await userSchema.validate(input)',
    scenariosEn: ['An existing Standard Schema library owns runtime validation.', 'Storage entities need validated and inferred output.', 'The storage layer must remain independent of validator vendors.'],
    scenariosZh: ['已有 Standard Schema library 负责 runtime validation。', 'storage entity 需要 validated 且 inferred 的 output。', 'storage layer 必须保持 validator-vendor independent。'],
    avoidEn: ['The validator does not implement Standard Schema v1.', 'No runtime validation is required; use passthrough.', 'Validation issues must be transformed into a domain-specific result instead of an exception.'],
    avoidZh: ['validator 未实现 Standard Schema v1。', '不需要 runtime validation；使用 passthrough。', 'validation issue 必须转成 domain-specific result 而不是 exception。'],
    optionsEn: [{ name: 'schema', description: 'Standard Schema v1 object providing a non-empty vendor and validate function.', defaultValue: 'required', optional: false, type: 'IStandardSchemaV1<unknown, T>', whenToUse: 'Adapt the application validator at the storage boundary.', example: 'z.object({ id: z.number() })' }],
    optionsZh: [{ name: 'schema', description: '提供 non-empty vendor 与 validate function 的 Standard Schema v1 object。', defaultValue: 'required', optional: false, type: 'IStandardSchemaV1<unknown, T>', whenToUse: '在 storage boundary 适配 application validator。', example: 'z.object({ id: z.number() })' }]
  }),
  'storage-web:schema:passthrough': createStorageWebGuide({
    purposeEn: 'Creates the zero-validation schema adapter used when the storage boundary intentionally trusts its input. It returns the same value asynchronously and adds no validation dependency.',
    purposeZh: '创建 zero-validation schema adapter，用于 storage boundary 明确信任 input 的场景。它异步返回同一个 value，不增加 validation dependency。',
    quickStart: 'const schema = passthrough<User>()\nconst user = await schema.validate(input)',
    scenariosEn: ['Data was already validated at a stronger upstream boundary.', 'A prototype needs the schema contract without runtime validation.', 'Opaque values must pass through unchanged.'],
    scenariosZh: ['data 已在更强的 upstream boundary 验证。', 'prototype 需要 schema contract，但暂不做 runtime validation。', 'opaque value 必须原样通过。'],
    avoidEn: ['Persisted or remote data is untrusted.', 'Schema evolution requires runtime guarantees.', 'A cast would hide malformed data from downstream code.'],
    avoidZh: ['persisted 或 remote data 不可信。', 'schema evolution 需要 runtime guarantee。', 'cast 会向 downstream code 隐藏 malformed data。']
  }),
  'storage-web:schema:runMigrations': createStorageWebGuide({
    purposeEn: 'Runs declared asynchronous migrations in ascending version order for one value. Missing version steps are explicit no-ops, cancellation preserves the abort reason, and failures retain their original cause.',
    purposeZh: '对单个 value 按 version 升序执行已声明的 async migration。缺失 version step 是显式 no-op；cancellation 保留 abort reason；failure 保留原始 cause。',
    quickStart: "const current = await runMigrations(saved, 1, 3, {\n  2: async (value) => ({ ...value, enabled: true }),\n  3: async (value) => ({ ...value, version: 3 })\n}, signal)",
    scenariosEn: ['A persisted entity is older than the current schema version.', 'Migration steps need asynchronous dependencies.', 'A long migration must cooperate with operation cancellation.'],
    scenariosZh: ['persisted entity 早于 current schema version。', 'migration step 需要 async dependency。', 'long migration 必须配合 operation cancellation。'],
    avoidEn: ['The target version is not newer than the stored version.', 'A database-wide atomic migration is required.', 'Missing steps should be treated as errors rather than no-ops.'],
    avoidZh: ['target version 不高于 stored version。', '需要 database-wide atomic migration。', 'missing step 应被视为 error，而不是 no-op。'],
    optionsEn: [
      { name: 'value', description: 'Stored value supplied to the first applicable migration.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Pass the decoded historical entity.', example: 'saved' },
      { name: 'fromVersion', description: 'Non-negative safe integer describing the stored value version.', defaultValue: 'required', optional: false, type: 'number', whenToUse: 'Read from persisted entity metadata.', example: '1' },
      { name: 'toVersion', description: 'Non-negative safe integer target version; versions from fromVersion + 1 are visited in order.', defaultValue: 'required', optional: false, type: 'number', whenToUse: 'Use the current entity definition version.', example: '3' },
      { name: 'migrations', description: 'Version-keyed asynchronous steps; an absent version is a no-op.', defaultValue: 'undefined', type: 'Record<number, IMigration>', whenToUse: 'Declare only versions whose data shape changes.', example: '{ 2: migrateToV2, 3: migrateToV3 }' },
      { name: 'signal', description: 'Optional cooperative cancellation signal whose reason is preserved.', defaultValue: 'undefined', type: 'IWebAbortSignal', whenToUse: 'Bind work to request, host, or disposal lifetime.', example: 'controller.signal' }
    ],
    optionsZh: [
      { name: 'value', description: '传给第一个 applicable migration 的 stored value。', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: '传入 decoded historical entity。', example: 'saved' },
      { name: 'fromVersion', description: '描述 stored value version 的 non-negative safe integer。', defaultValue: 'required', optional: false, type: 'number', whenToUse: '从 persisted entity metadata 读取。', example: '1' },
      { name: 'toVersion', description: 'non-negative safe integer target version；从 fromVersion + 1 开始按序访问。', defaultValue: 'required', optional: false, type: 'number', whenToUse: '使用 current entity definition version。', example: '3' },
      { name: 'migrations', description: '按 version 编号的 async step；缺失 version 是 no-op。', defaultValue: 'undefined', type: 'Record<number, IMigration>', whenToUse: '仅声明 data shape 发生变化的 version。', example: '{ 2: migrateToV2, 3: migrateToV3 }' },
      { name: 'signal', description: '可选 cooperative cancellation signal，并保留其 reason。', defaultValue: 'undefined', type: 'IWebAbortSignal', whenToUse: '把 work 绑定到 request、host 或 disposal lifetime。', example: 'controller.signal' }
    ]
  }),
  'storage-web:entity:defineEntity': createStorageWebGuide({
    purposeEn: 'Declares one versioned domain record and later connects that immutable definition to a concrete store. The resulting repository owns validation, codec selection, migrations, entity-key isolation, indexes, listing, streaming, and transactional batch behavior.',
    purposeZh: '声明一个 versioned domain record，之后再把 immutable definition 连接到 concrete store。生成的 repository 统一负责 validation、codec selection、migration、entity-key isolation、index、list、stream 与 transactional batch behavior。',
    quickStart: "const users = defineEntity<User>()({\n  name: 'users',\n  key: 'id',\n  schema: fromStandardSchema(userSchema),\n  version: 2,\n  migrations: { 2: migrateUserV2 },\n  indexes: { email: { path: 'email', unique: true } }\n})\nconst repository = users.connect(indexedDb({ dbName: 'app' }))\nawait repository.put({ id: 1, email: 'ada@example.com' })",
    scenariosEn: ['Domain records need one backend-neutral repository contract.', 'Persisted data requires validation and ordered version migration.', 'Typed secondary indexes must remain owned by the entity definition.', 'The same entity contract must connect to memory in tests and IndexedDB in production.'],
    scenariosZh: ['domain record 需要统一的 backend-neutral repository contract。', 'persisted data 需要 validation 与 ordered version migration。', 'typed secondary index 必须由 entity definition 拥有。', '同一个 entity contract 需要在测试连接 memory、在生产连接 IndexedDB。'],
    avoidEn: ['Only an unstructured key-value pair is needed.', 'The caller cannot define a stable entity name and primary key.', 'A KV-only backend is expected to provide transactions or native secondary indexes.', 'Schema changes cannot be represented as an explicit version chain.'],
    avoidZh: ['只需要 unstructured key-value pair。', 'caller 无法定义稳定 entity name 与 primary key。', '期望 KV-only backend 提供 transaction 或 native secondary index。', 'schema change 无法表达为显式 version chain。'],
    optionsEn: [
      { name: 'name', description: 'Stable logical entity namespace used to isolate physical records; names beginning with the reserved double-underscore prefix are rejected.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Choose a durable domain name before data is persisted.', example: "'users'" },
      { name: 'key', description: 'Domain property read as the primary storage key for put, get, remove, and migration.', defaultValue: 'required', optional: false, type: 'Extract<keyof TDomain, string>', whenToUse: 'Point to a stable string, number, date, or key-compatible identity field.', example: "'id'" },
      { name: 'schema', description: 'Validation and optional domain/stored encode-decode adapter snapshotted when the definition is created.', defaultValue: 'passthrough()', type: 'ISchemaAdapter<TDomain, TStored>', whenToUse: 'Validate untrusted persisted data or map domain and stored shapes.', example: 'fromStandardSchema(userSchema)' },
      { name: 'codec', description: 'Explicit value codec selected against backend capabilities during connect; when omitted, structured stores use structuredCodec and KV-only stores use jsonCodec.', defaultValue: 'backend-dependent', type: 'ICodec', whenToUse: 'Override the safe backend default for a deliberate wire format.', example: 'jsonCodec' },
      { name: 'version', description: 'Positive safe integer representing the current persisted entity shape.', defaultValue: '1', type: 'number', whenToUse: 'Increment whenever old stored values need migration.', example: '2' },
      { name: 'migrations', description: 'Complete version-keyed async chain from version 2 through the current version; every step is required.', defaultValue: 'undefined', type: 'Record<number, IMigration>', whenToUse: 'Transform older persisted shapes before validation and use.', example: '{ 2: migrateUserV2 }' },
      { name: 'validateOnRead', description: 'Validates decoded persisted values before returning them, protecting against historical or externally modified data.', defaultValue: 'true', type: 'boolean', whenToUse: 'Keep enabled for durable or externally writable storage.', example: 'true' },
      { name: 'onDiagnostic', description: 'Observes non-fatal codec fallback information; the default writes warnings through the host console when available.', defaultValue: 'console.warn', type: '(message: string) => void', whenToUse: 'Route storage tradeoffs into application diagnostics.', example: 'diagnostics.warn' },
      { name: 'defaultOrderBy', description: 'Entity-wide comparator used by list and stream when a call does not provide its own orderBy.', defaultValue: 'undefined', type: 'IRecordComparator<TDomain>', whenToUse: 'Establish one deterministic default presentation order.', example: '(left, right) => left.name.localeCompare(right.name)' },
      { name: 'indexes', description: 'Named path, compound-path, or custom projection definitions. Use the curried defineEntity<T>()({...}) form so literal names and query key types are preserved.', defaultValue: 'undefined', type: 'Readonly<Record<string, IEntityIndex<TDomain>>>', whenToUse: 'Support typed findBy, findManyBy, streamBy, and indexed list queries.', example: "{ email: { path: 'email', unique: true } }" }
    ],
    optionsZh: [
      { name: 'name', description: '用于隔离 physical record 的稳定 logical entity namespace；以 reserved double-underscore prefix 开头会被拒绝。', defaultValue: 'required', optional: false, type: 'string', whenToUse: '在持久化 data 前确定 durable domain name。', example: "'users'" },
      { name: 'key', description: 'put、get、remove 与 migration 读取的 domain primary storage key property。', defaultValue: 'required', optional: false, type: 'Extract<keyof TDomain, string>', whenToUse: '指向稳定的 string、number、date 或 key-compatible identity field。', example: "'id'" },
      { name: 'schema', description: '创建 definition 时 snapshot 的 validation 以及可选 domain/stored encode-decode adapter。', defaultValue: 'passthrough()', type: 'ISchemaAdapter<TDomain, TStored>', whenToUse: '验证 untrusted persisted data，或映射 domain 与 stored shape。', example: 'fromStandardSchema(userSchema)' },
      { name: 'codec', description: 'connect 时按 backend capability 选择的显式 value codec；省略时 structured store 使用 structuredCodec，KV-only store 使用 jsonCodec。', defaultValue: 'backend-dependent', type: 'ICodec', whenToUse: '需要明确 wire format 时覆盖安全 backend default。', example: 'jsonCodec' },
      { name: 'version', description: '表示当前 persisted entity shape 的 positive safe integer。', defaultValue: '1', type: 'number', whenToUse: '旧 stored value 需要 migration 时递增。', example: '2' },
      { name: 'migrations', description: '从 version 2 到 current version 的完整 async step chain；每一步都必须存在。', defaultValue: 'undefined', type: 'Record<number, IMigration>', whenToUse: '在 validation 与使用前转换 historical persisted shape。', example: '{ 2: migrateUserV2 }' },
      { name: 'validateOnRead', description: 'return 前验证 decoded persisted value，防御 historical 或 externally modified data。', defaultValue: 'true', type: 'boolean', whenToUse: 'durable 或 externally writable storage 应保持开启。', example: 'true' },
      { name: 'onDiagnostic', description: '观察 non-fatal codec fallback；默认在 host console 可用时输出 warning。', defaultValue: 'console.warn', type: '(message: string) => void', whenToUse: '把 storage tradeoff 接入 application diagnostics。', example: 'diagnostics.warn' },
      { name: 'defaultOrderBy', description: '调用未提供 orderBy 时，list 与 stream 使用的 entity-wide comparator。', defaultValue: 'undefined', type: 'IRecordComparator<TDomain>', whenToUse: '建立统一且 deterministic 的默认展示顺序。', example: '(left, right) => left.name.localeCompare(right.name)' },
      { name: 'indexes', description: 'named path、compound-path 或 custom projection definition。必须使用 curried defineEntity<T>()({...}) 形式，保留 literal name 与 query key type。', defaultValue: 'undefined', type: 'Readonly<Record<string, IEntityIndex<TDomain>>>', whenToUse: '支持 typed findBy、findManyBy、streamBy 与 indexed list query。', example: "{ email: { path: 'email', unique: true } }" }
    ]
  }),
  'storage-web:host:assertStorageBackendId': createStorageWebGuide({
    purposeEn: 'Validates the public backend identifier grammar before it can enter plugin, registry, or topology state. IDs are case-sensitive ASCII strings, 1–64 characters, beginning with a letter and continuing with letters, digits, dot, underscore, or hyphen.',
    purposeZh: '在 backend identifier 进入 plugin、registry 或 topology state 前验证 public grammar。ID 是 case-sensitive ASCII string，长度 1–64，首字符必须是 letter，后续只允许 letter、digit、dot、underscore 或 hyphen。',
    quickStart: "assertStorageBackendId(candidate)\nconst id: string = candidate",
    scenariosEn: ['A configuration value is about to become a backend ID.', 'A custom backend factory needs the same grammar as built-ins.', 'A boundary needs TypeScript assertion narrowing after runtime validation.'],
    scenariosZh: ['configuration value 即将成为 backend ID。', 'custom backend factory 需要与 built-in 相同的 grammar。', 'boundary 需要 runtime validation 后的 TypeScript assertion narrowing。'],
    avoidEn: ['The value is an end-user label rather than an identity.', 'Unicode or whitespace must be preserved.', 'A plugin handle has already been created and validated.'],
    avoidZh: ['value 是 end-user label 而不是 identity。', '必须保留 Unicode 或 whitespace。', 'plugin handle 已创建并完成 validation。'],
    optionsEn: [{ name: 'id', description: 'Unknown candidate checked against the bounded backend identifier grammar.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Validate external or dynamically constructed IDs before registration.', example: "'primary-cache'" }],
    optionsZh: [{ name: 'id', description: '按 bounded backend identifier grammar 检查的 unknown candidate。', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'external 或 dynamically constructed ID 注册前进行验证。', example: "'primary-cache'" }]
  }),
  'storage-web:host:defineStorageBackendKind': createStorageWebGuide({
    purposeEn: 'Creates an opaque backend-kind factory that binds one store type to validated kind names. The private identity prevents a look-alike object from claiming compatibility with plugin and feature definitions.',
    purposeZh: '创建 opaque backend-kind factory，把一种 store type 绑定到 validated kind name。private identity 防止 look-alike object 冒充与 plugin、feature definition 兼容。',
    quickStart: "const defineCacheKind = defineStorageBackendKind<ICacheStore>()\nconst cacheKind = defineCacheKind('cache')",
    scenariosEn: ['A custom backend family needs exact compile-time store typing.', 'Several plugins share one backend implementation kind.', 'Feature descriptors must reject kinds created by another authority.'],
    scenariosZh: ['custom backend family 需要精确 compile-time store typing。', '多个 plugin 共享同一种 backend implementation kind。', 'feature descriptor 必须拒绝由另一 authority 创建的 kind。'],
    avoidEn: ['Only a plugin instance ID is needed.', 'The built-in backend kind already matches the store.', 'A plain label with no runtime authority is sufficient.'],
    avoidZh: ['只需要 plugin instance ID。', 'built-in backend kind 已匹配 store。', '只需没有 runtime authority 的 plain label。'],
    optionsEn: [{ name: 'name', description: 'Validated stable name captured in the opaque backend-kind token.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Name one implementation family, not one installed instance.', example: "'cache'" }],
    optionsZh: [{ name: 'name', description: 'captured 到 opaque backend-kind token 的 validated stable name。', defaultValue: 'required', optional: false, type: 'string', whenToUse: '命名一种 implementation family，而不是 installed instance。', example: "'cache'" }]
  }),
  'storage-web:host:defineStorageBackendFeature': createStorageWebGuide({
    purposeEn: 'Creates an opaque capability descriptor tied to exactly one backend kind. Reactive metadata declares how invalidation becomes visible and optionally supplies the change source that the Host will lifecycle-own.',
    purposeZh: '创建只绑定到一个 backend kind 的 opaque capability descriptor。reactive metadata 声明 invalidation 的可见范围，并可提供由 Host 接管 lifecycle 的 change source。',
    quickStart: "const reactive = defineStorageBackendFeature(cacheKind, 'reactive', {\n  mode: 'push',\n  visibility: 'instance',\n  subscribe: ({ store, onChange }) => store.subscribe(onChange)\n})",
    scenariosEn: ['A backend plugin provides an optional materialized capability.', 'Reactive availability must be reflected in Host types.', 'A custom change source needs explicit visibility and cleanup ownership.'],
    scenariosZh: ['backend plugin 提供 optional materialized capability。', 'reactive availability 必须反映到 Host type。', 'custom change source 需要显式 visibility 与 cleanup ownership。'],
    avoidEn: ['The behavior belongs to the base store contract.', 'The feature belongs to a different backend kind.', 'Reactive consistency or source disposal cannot be stated honestly.'],
    avoidZh: ['behavior 属于 base store contract。', 'feature 属于不同 backend kind。', '无法诚实声明 reactive consistency 或 source disposal。'],
    optionsEn: [
      { name: 'backendKind', description: 'Exact opaque kind token whose stores may provide this capability.', defaultValue: 'required', optional: false, type: 'IStorageBackendKind', whenToUse: 'Bind the feature to its implementation owner.', example: 'cacheKind' },
      { name: 'capability', description: 'Non-empty stable capability name used by topology compilation.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Name the materialized feature; reactive is the Host-recognized live-query capability.', example: "'reactive'" },
      { name: 'reactive', description: 'Optional consistency, polling, and source-subscription metadata for the reactive capability.', defaultValue: 'undefined', type: 'IStorageReactiveFeatureMetadata', whenToUse: 'Declare how backend changes invalidate Resource-owned live queries.', example: "{ mode: 'push', visibility: 'instance', subscribe }" }
    ],
    optionsZh: [
      { name: 'backendKind', description: '允许其 store 提供该 capability 的 exact opaque kind token。', defaultValue: 'required', optional: false, type: 'IStorageBackendKind', whenToUse: '把 feature 绑定到 implementation owner。', example: 'cacheKind' },
      { name: 'capability', description: 'topology compilation 使用的 non-empty stable capability name。', defaultValue: 'required', optional: false, type: 'string', whenToUse: '命名 materialized feature；reactive 是 Host 识别的 live-query capability。', example: "'reactive'" },
      { name: 'reactive', description: 'reactive capability 可选的 consistency、polling 与 source-subscription metadata。', defaultValue: 'undefined', type: 'IStorageReactiveFeatureMetadata', whenToUse: '声明 backend change 如何 invalidate Resource-owned live query。', example: "{ mode: 'push', visibility: 'instance', subscribe }" }
    ]
  }),
  'storage-web:host:defineStorageBackendPlugin': createStorageWebGuide({
    purposeEn: 'Snapshots one backend factory, optional preparation step, feature tuple, and deadline into an opaque installable plugin handle. Creation remains unpublished until the Host commits the complete installation batch.',
    purposeZh: '把 backend factory、可选 prepare step、feature tuple 与 deadline snapshot 为 opaque installable plugin handle。Host 提交整个 installation batch 前，创建出的 store 不会被 publish。',
    quickStart: "const cachePlugin = defineStorageBackendPlugin({\n  backendKind: cacheKind,\n  id: 'cache',\n  features: [reactive],\n  create: () => memoryStorage(),\n  prepare: async (store, { signal }) => warmCache(store, signal)\n})",
    scenariosEn: ['A store must be installed atomically with Host lifecycle ownership.', 'Factory and preparation failures need rollback and deadline handling.', 'Literal plugin IDs and feature capabilities must flow into Host types.'],
    scenariosZh: ['store 必须由 Host lifecycle owner 原子安装。', 'factory 与 prepare failure 需要 rollback 和 deadline handling。', 'literal plugin ID 与 feature capability 必须流入 Host type。'],
    avoidEn: ['A caller only needs a directly owned standalone store.', 'The backend kind and feature tuple do not share exact authority.', 'Factory cleanup cannot be represented by the returned store dispose contract.'],
    avoidZh: ['caller 只需要直接拥有的 standalone store。', 'backend kind 与 feature tuple 不属于 exact authority。', 'factory cleanup 无法由 returned store dispose contract 表达。'],
    optionsEn: [
      { name: 'backendKind', description: 'Opaque kind token that fixes the exact store type and accepted features.', defaultValue: 'required', optional: false, type: 'IStorageBackendKind', whenToUse: 'Associate the plugin with its backend implementation family.', example: 'cacheKind' },
      { name: 'id', description: 'Validated literal ID used for typed lookup and duplicate admission checks.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Name one installed backend instance.', example: "'cache'" },
      { name: 'timeoutMs', description: 'Optional non-negative per-plugin creation and preparation deadline within the Host batch budget.', defaultValue: 'host remaining budget', type: 'number', whenToUse: 'Give a slow backend a stricter bounded startup deadline.', example: '5_000' },
      { name: 'features', description: 'Immutable feature tuple owned by the same exact backend kind.', defaultValue: '[]', type: 'readonly IStorageBackendFeature[]', whenToUse: 'Advertise reactive or another topology-compiled capability.', example: '[reactive]' },
      { name: 'create', description: 'Factory receiving Host cancellation and reporting context; it returns the disposable store.', defaultValue: 'required', optional: false, type: '(context) => TStore | PromiseLike<TStore>', whenToUse: 'Construct the store without publishing it elsewhere.', example: '() => memoryStorage()' },
      { name: 'prepare', description: 'Optional post-registration preparation hook executed before batch publication.', defaultValue: 'undefined', type: '(store, context) => void | PromiseLike<void>', whenToUse: 'Warm, migrate, or validate a store while rollback is still possible.', example: 'warmCache' }
    ],
    optionsZh: [
      { name: 'backendKind', description: '固定 exact store type 与 accepted feature 的 opaque kind token。', defaultValue: 'required', optional: false, type: 'IStorageBackendKind', whenToUse: '把 plugin 关联到 backend implementation family。', example: 'cacheKind' },
      { name: 'id', description: '用于 typed lookup 与 duplicate admission check 的 validated literal ID。', defaultValue: 'required', optional: false, type: 'string', whenToUse: '命名一个 installed backend instance。', example: "'cache'" },
      { name: 'timeoutMs', description: 'Host batch budget 内可选的 non-negative per-plugin create/prepare deadline。', defaultValue: 'host remaining budget', type: 'number', whenToUse: '为 slow backend 设置更严格且 bounded 的 startup deadline。', example: '5_000' },
      { name: 'features', description: '由同一个 exact backend kind 拥有的 immutable feature tuple。', defaultValue: '[]', type: 'readonly IStorageBackendFeature[]', whenToUse: '声明 reactive 或其他 topology-compiled capability。', example: '[reactive]' },
      { name: 'create', description: '接收 Host cancellation 与 reporting context，并返回 disposable store 的 factory。', defaultValue: 'required', optional: false, type: '(context) => TStore | PromiseLike<TStore>', whenToUse: '构建 store，但不要在外部提前 publish。', example: '() => memoryStorage()' },
      { name: 'prepare', description: 'batch publication 前运行的可选 post-registration preparation hook。', defaultValue: 'undefined', type: '(store, context) => void | PromiseLike<void>', whenToUse: '在仍可 rollback 时 warm、migrate 或 validate store。', example: 'warmCache' }
    ]
  }),
  'storage-web:host:compileStorageFeatureTopology': createStorageWebGuide({
    purposeEn: 'Purely compiles already-installed providers and one candidate plugin batch into deterministic dependency order. Synthetic providers participate in validation but are excluded from the materialized output.',
    purposeZh: '把 already-installed provider 与一批 candidate plugin 纯编译为 deterministic dependency order。synthetic provider 参与 validation，但不会进入 materialized output。',
    quickStart: 'const topology = compileStorageFeatureTopology({\n  installedProviderIds: [],\n  plugins: [cachePlugin]\n})\nfor (const node of topology.materialized) inspect(node.id)',
    scenariosEn: ['A Host batch needs validation before any mutation.', 'Feature dependencies need stable ordering.', 'Reactive service injection must remain an internal synthetic provider.'],
    scenariosZh: ['Host batch 需要在任何 mutation 前完成 validation。', 'feature dependency 需要 stable ordering。', 'reactive service injection 必须保持 internal synthetic provider。'],
    avoidEn: ['Stores should be constructed or installed; use createStorageHost or host.use.', 'Plugin handles are not produced by the backend definition authority.', 'The caller intends to mutate the returned frozen topology.'],
    avoidZh: ['需要构建或安装 store；使用 createStorageHost 或 host.use。', 'plugin handle 不是 backend definition authority 生成的。', 'caller 打算 mutation returned frozen topology。'],
    optionsEn: [
      { name: 'input.installedProviderIds', description: 'Snapshot of provider IDs already owned outside the candidate batch.', defaultValue: 'required', optional: false, type: 'readonly string[]', whenToUse: 'Prevent duplicate providers and satisfy feature dependencies.', example: '[]' },
      { name: 'input.plugins', description: 'Candidate immutable plugin handles whose base and feature nodes are compiled.', defaultValue: 'required', optional: false, type: 'readonly IStorageBackendPluginHandle[]', whenToUse: 'Preflight one exact installation batch.', example: '[cachePlugin]' }
    ],
    optionsZh: [
      { name: 'input.installedProviderIds', description: 'candidate batch 外已经拥有的 provider ID snapshot。', defaultValue: 'required', optional: false, type: 'readonly string[]', whenToUse: '阻止 duplicate provider 并满足 feature dependency。', example: '[]' },
      { name: 'input.plugins', description: '需要编译 base/feature node 的 candidate immutable plugin handle。', defaultValue: 'required', optional: false, type: 'readonly IStorageBackendPluginHandle[]', whenToUse: 'preflight 一个 exact installation batch。', example: '[cachePlugin]' }
    ]
  }),
  'storage-web:host:createStorageHost': createStorageWebGuide({
    purposeEn: 'Creates the lifecycle owner for a typed backend registry and optionally installs one initial plugin tuple atomically. Failed initial installation disposes the facade before the primary error is rethrown.',
    purposeZh: '创建 typed backend registry 的 lifecycle owner，并可原子安装一组 initial plugin tuple。initial installation 失败时会先 dispose facade，再重新抛出 primary error。',
    quickStart: "const host = await createStorageHost({ plugins: [cachePlugin], report })\nconst cache = host.backend('cache')\ntry { await useCache(cache) } finally { await host.dispose() }",
    scenariosEn: ['Several backends need one install, lookup, rollback, and disposal owner.', 'Literal plugin IDs should produce typed backend access.', 'Reactive capability should appear only for plugins that declare it.'],
    scenariosZh: ['多个 backend 需要统一 install、lookup、rollback 与 disposal owner。', 'literal plugin ID 应产生 typed backend access。', 'reactive capability 只应出现在声明它的 plugin 上。'],
    avoidEn: ['A single standalone store already has a clear owner.', 'The caller cannot guarantee eventual Host disposal.', 'Plugins must be published independently rather than as an atomic initial batch.'],
    avoidZh: ['single standalone store 已有明确 owner。', 'caller 无法保证最终 dispose Host。', 'plugin 必须独立 publish，而不是 initial atomic batch。'],
    optionsEn: [
      { name: 'plugins', description: 'Initial literal plugin tuple installed atomically before the Host is returned.', defaultValue: '[]', type: 'readonly IStorageBackendPluginHandle[]', whenToUse: 'Create a ready typed Host in one step.', example: '[cachePlugin]' },
      { name: 'installTimeoutMs', description: 'Finite budget for one complete installation batch.', defaultValue: '30_000', type: 'number', whenToUse: 'Bound create, prepare, registration, and rollback latency.', example: '10_000' },
      { name: 'scheduler', description: 'Lifecycle scheduler used for deterministic time, deadlines, and cleanup.', defaultValue: 'systemScheduler', type: 'ILifecycleScheduler', whenToUse: 'Inject virtual time in tests or an application-owned scheduler.', example: 'scheduler' },
      { name: 'report', description: 'Containment-only sink for late rejection and cleanup diagnostics; sink failures never replace the primary failure.', defaultValue: 'no-op', type: '(error: unknown) => void | PromiseLike<void>', whenToUse: 'Observe non-primary lifecycle failures.', example: 'report' }
    ],
    optionsZh: [
      { name: 'plugins', description: 'Host return 前原子安装的 initial literal plugin tuple。', defaultValue: '[]', type: 'readonly IStorageBackendPluginHandle[]', whenToUse: '一步创建 ready typed Host。', example: '[cachePlugin]' },
      { name: 'installTimeoutMs', description: '一次完整 installation batch 的 finite budget。', defaultValue: '30_000', type: 'number', whenToUse: '约束 create、prepare、registration 与 rollback latency。', example: '10_000' },
      { name: 'scheduler', description: '用于 deterministic time、deadline 与 cleanup 的 lifecycle scheduler。', defaultValue: 'systemScheduler', type: 'ILifecycleScheduler', whenToUse: '测试注入 virtual time，或使用 application-owned scheduler。', example: 'scheduler' },
      { name: 'report', description: '观察 late rejection 与 cleanup diagnostic 的 containment-only sink；sink failure 不会替换 primary failure。', defaultValue: 'no-op', type: '(error: unknown) => void | PromiseLike<void>', whenToUse: '观察 non-primary lifecycle failure。', example: 'report' }
    ]
  }),
  'storage-web:host:StorageHostFacade': createStorageWebGuide({
    purposeEn: 'The imperative Host implementation for incremental plugin installation. It serializes installation batches, publishes registry changes only after complete commit, provides typed backend lookup, and exposes one idempotent disposal promise.',
    purposeZh: '用于 incremental plugin installation 的 imperative Host implementation。它串行化 installation batch，只在完整 commit 后 publish registry change，提供 typed backend lookup，并暴露一个 idempotent disposal promise。',
    quickStart: "const host = new StorageHostFacade({ installTimeoutMs: 10_000, report })\nconst ready = await host.use(cachePlugin)\nconst cache = ready.backend('cache')\nawait ready.dispose()",
    scenariosEn: ['Plugins are admitted after Host construction.', 'Callers need hasBackend, backend, backends, or reactiveBackend inspection.', 'Concurrent installation must fail rather than interleave registry publication.'],
    scenariosZh: ['plugin 在 Host construction 后动态 admission。', 'caller 需要 hasBackend、backend、backends 或 reactiveBackend inspection。', 'concurrent installation 必须失败，不能交错 registry publication。'],
    avoidEn: ['All initial plugins are known; createStorageHost is simpler.', 'Multiple owners may dispose individual stores behind the Host.', 'Concurrent use calls are expected to queue automatically.'],
    avoidZh: ['所有 initial plugin 已知；createStorageHost 更简单。', '多个 owner 会绕过 Host 单独 dispose store。', '期望 concurrent use call 自动排队。'],
    optionsEn: [
      { name: 'installTimeoutMs', description: 'Finite budget for each complete use batch.', defaultValue: '30_000', type: 'number', whenToUse: 'Bound dynamic backend startup and rollback.', example: '10_000' },
      { name: 'scheduler', description: 'Shared lifecycle scheduler for Host and plugin deadlines.', defaultValue: 'systemScheduler', type: 'ILifecycleScheduler', whenToUse: 'Control time deterministically or share application lifecycle time.', example: 'scheduler' },
      { name: 'report', description: 'Contained diagnostic sink for late and cleanup failures.', defaultValue: 'no-op', type: '(error: unknown) => void | PromiseLike<void>', whenToUse: 'Connect lifecycle diagnostics without altering primary errors.', example: 'report' }
    ],
    optionsZh: [
      { name: 'installTimeoutMs', description: '每次完整 use batch 的 finite budget。', defaultValue: '30_000', type: 'number', whenToUse: '约束 dynamic backend startup 与 rollback。', example: '10_000' },
      { name: 'scheduler', description: 'Host 与 plugin deadline 共享的 lifecycle scheduler。', defaultValue: 'systemScheduler', type: 'ILifecycleScheduler', whenToUse: 'deterministic control time，或共享 application lifecycle time。', example: 'scheduler' },
      { name: 'report', description: '观察 late 与 cleanup failure 的 contained diagnostic sink。', defaultValue: 'no-op', type: '(error: unknown) => void | PromiseLike<void>', whenToUse: '接入 lifecycle diagnostic，同时不改变 primary error。', example: 'report' }
    ]
  }),
  'storage-web:host:readStorageBackendPluginMetadata': createStorageWebGuide({
    purposeEn: 'Reads the private immutable definition snapshot for a genuine backend plugin handle. This is infrastructure for the Host and topology compiler, not an application configuration or reflection API.',
    purposeZh: '读取 genuine backend plugin handle 对应的 private immutable definition snapshot。它是 Host 与 topology compiler 的 infrastructure，不是 application configuration 或 reflection API。',
    quickStart: 'const metadata = readStorageBackendPluginMetadata(plugin)\nif (!metadata) rejectUnownedPlugin()',
    scenariosEn: ['Host infrastructure must verify definition authority.', 'A topology compiler needs the exact captured feature tuple.', 'An advanced adapter must distinguish genuine handles from look-alike objects.'],
    scenariosZh: ['Host infrastructure 必须验证 definition authority。', 'topology compiler 需要 exact captured feature tuple。', 'advanced adapter 必须区分 genuine handle 与 look-alike object。'],
    avoidEn: ['Application code only needs plugin.id.', 'The caller intends to modify plugin configuration.', 'A stable serialized metadata format is required.'],
    avoidZh: ['application code 只需要 plugin.id。', 'caller 打算修改 plugin configuration。', '需要 stable serialized metadata format。'],
    optionsEn: [{ name: 'plugin', description: 'Candidate backend plugin handle used as the private WeakMap identity.', defaultValue: 'required', optional: false, type: 'IStorageBackendPluginHandle', whenToUse: 'Verify or compile a handle inside Host infrastructure.', example: 'cachePlugin' }],
    optionsZh: [{ name: 'plugin', description: '作为 private WeakMap identity 使用的 candidate backend plugin handle。', defaultValue: 'required', optional: false, type: 'IStorageBackendPluginHandle', whenToUse: '在 Host infrastructure 内验证或编译 handle。', example: 'cachePlugin' }]
  }),
  'storage-web:host:readStorageBackendFeatureMetadata': createStorageWebGuide({
    purposeEn: 'Reads the private backend-kind, capability, and optional reactive metadata of a genuine feature descriptor. Unknown objects return undefined instead of gaining feature authority.',
    purposeZh: '读取 genuine feature descriptor 的 private backend-kind、capability 与可选 reactive metadata。unknown object 返回 undefined，不会因此获得 feature authority。',
    quickStart: 'const metadata = readStorageBackendFeatureMetadata(feature)\nif (metadata?.capability === \'reactive\') materializeAdapter(metadata)',
    scenariosEn: ['Topology compilation needs exact feature ownership.', 'Host materialization needs reactive source metadata.', 'Infrastructure must reject forged feature descriptors.'],
    scenariosZh: ['topology compilation 需要 exact feature ownership。', 'Host materialization 需要 reactive source metadata。', 'infrastructure 必须拒绝 forged feature descriptor。'],
    avoidEn: ['Application code only needs the installed Host capability.', 'The feature has not been created by defineStorageBackendFeature.', 'Metadata must be persisted or sent across realms.'],
    avoidZh: ['application code 只需要 installed Host capability。', 'feature 不是由 defineStorageBackendFeature 创建。', 'metadata 需要持久化或跨 realm 发送。'],
    optionsEn: [{ name: 'feature', description: 'Candidate object used as the private feature-metadata identity.', defaultValue: 'required', optional: false, type: 'object', whenToUse: 'Inspect a descriptor during topology admission.', example: 'reactiveFeature' }],
    optionsZh: [{ name: 'feature', description: '作为 private feature-metadata identity 使用的 candidate object。', defaultValue: 'required', optional: false, type: 'object', whenToUse: '在 topology admission 时检查 descriptor。', example: 'reactiveFeature' }]
  }),
  'storage-web:host:pluginNameFromBackendId': createStorageWebGuide({
    purposeEn: 'Encodes a validated backend ID as a collision-free PluginHost registration name using its ASCII bytes. It keeps user-visible backend identity separate from the internal plugin namespace.',
    purposeZh: '把 validated backend ID 按 ASCII byte 编码成 collision-free PluginHost registration name，使 user-visible backend identity 与 internal plugin namespace 分离。',
    quickStart: "const registrationName = pluginNameFromBackendId('cache')\n// storage-backend:6361636865",
    scenariosEn: ['Host infrastructure needs a deterministic plugin registration key.', 'Punctuation in valid IDs must not collide.', 'Backend and reactive adapter registrations need separate namespaces.'],
    scenariosZh: ['Host infrastructure 需要 deterministic plugin registration key。', 'valid ID 中的 punctuation 不能 collision。', 'backend 与 reactive adapter registration 需要不同 namespace。'],
    avoidEn: ['A human-facing label or URL slug is needed.', 'The ID has not passed the public grammar.', 'Application persistence depends on the internal registration name.'],
    avoidZh: ['需要 human-facing label 或 URL slug。', 'ID 尚未通过 public grammar。', 'application persistence 依赖 internal registration name。'],
    optionsEn: [{ name: 'id', description: 'Validated backend ID encoded into the internal PluginHost namespace.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Derive the canonical backend registration name.', example: "'cache'" }],
    optionsZh: [{ name: 'id', description: '编码进 internal PluginHost namespace 的 validated backend ID。', defaultValue: 'required', optional: false, type: 'string', whenToUse: '派生 canonical backend registration name。', example: "'cache'" }]
  }),
  'storage-web:host:reactiveAdapterNameFromBackendId': createStorageWebGuide({
    purposeEn: 'Derives the canonical internal registration name for one backend reactive adapter while preserving the same validated ID bytes as its backend registration.',
    purposeZh: '为一个 backend reactive adapter 派生 canonical internal registration name，同时保留与 backend registration 相同的 validated ID bytes。',
    quickStart: "const adapterName = reactiveAdapterNameFromBackendId('cache')\n// storage-reactive-adapter:6361636865",
    scenariosEn: ['Host materialization installs a reactive adapter beside its backend.', 'Cleanup must address the exact adapter registration.', 'Diagnostics need a deterministic internal adapter identity.'],
    scenariosZh: ['Host materialization 在 backend 旁安装 reactive adapter。', 'cleanup 必须定位 exact adapter registration。', 'diagnostic 需要 deterministic internal adapter identity。'],
    avoidEn: ['The backend has no reactive feature.', 'A public backend ID or display label is needed.', 'The ID has not been validated.'],
    avoidZh: ['backend 没有 reactive feature。', '需要 public backend ID 或 display label。', 'ID 尚未验证。'],
    optionsEn: [{ name: 'id', description: 'Validated backend ID encoded into the reactive-adapter registration namespace.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Address the adapter paired with one installed backend.', example: "'cache'" }],
    optionsZh: [{ name: 'id', description: '编码进 reactive-adapter registration namespace 的 validated backend ID。', defaultValue: 'required', optional: false, type: 'string', whenToUse: '定位与一个 installed backend 配对的 adapter。', example: "'cache'" }]
  }),
  'storage-web:host:STORAGE_LIVE_QUERY_SERVICE_NAME': createStorageWebGuide({
    purposeEn: 'The stable internal provider name for the single Host-wide live-query service. Topology compilation injects this synthetic dependency when a candidate plugin declares reactive capability.',
    purposeZh: 'Host-wide singleton live-query service 的稳定 internal provider name。candidate plugin 声明 reactive capability 时，topology compilation 会注入这个 synthetic dependency。',
    quickStart: 'const ownsService = providerIds.includes(STORAGE_LIVE_QUERY_SERVICE_NAME)',
    scenariosEn: ['Host topology infrastructure identifies the shared service provider.', 'Tests assert singleton service admission.', 'Diagnostics distinguish service registration from backend adapters.'],
    scenariosZh: ['Host topology infrastructure 标识 shared service provider。', '测试断言 singleton service admission。', 'diagnostic 区分 service registration 与 backend adapter。'],
    avoidEn: ['Application code is creating a live query; use Host APIs.', 'A backend or adapter instance ID is needed.', 'The value should be changed or namespaced by the caller.'],
    avoidZh: ['application code 正在创建 live query；使用 Host API。', '需要 backend 或 adapter instance ID。', 'caller 打算改变该值或额外 namespace。']
  }),
  'storage-web:index:lengthPrefixedNamespaceCodec': createStorageWebGuide({
    purposeEn: 'The default collision-free physical-key codec. It prefixes the encoded namespace with its UTF-8 byte length, allowing keys and Unicode namespaces containing punctuation to round-trip without ambiguous delimiter parsing.',
    purposeZh: '默认 collision-free physical-key codec。它在 encoded namespace 前写入 UTF-8 byte length，使包含 punctuation 的 key 与 Unicode namespace 也能无歧义 round-trip。',
    quickStart: "const physical = lengthPrefixedNamespaceCodec.encode('用户', 'theme:mode')\nconst logical = lengthPrefixedNamespaceCodec.decode('用户', physical)",
    scenariosEn: ['Web Storage or cookies need isolated logical key spaces.', 'Namespaces contain Unicode or delimiter characters.', 'The persisted key format should use the built-in stable v1 prefix.'],
    scenariosZh: ['Web Storage 或 cookie 需要隔离 logical key space。', 'namespace 包含 Unicode 或 delimiter character。', 'persisted key format 应使用 built-in stable v1 prefix。'],
    avoidEn: ['An existing deployment uses another physical-key format without migration.', 'The backend already provides structured entity isolation.', 'The caller wants to parse keys from another namespace as local.'],
    avoidZh: ['existing deployment 使用另一 physical-key format 且未 migration。', 'backend 已提供 structured entity isolation。', 'caller 想把另一 namespace 的 key 当成本地 key 解析。']
  }),
  'storage-web:index:STORAGE_WEB_SOURCE': createStorageWebGuide({
    purposeEn: 'The stable library source stamped onto every storage-web boundary error. Branch on source together with code; do not parse message text.',
    purposeZh: '写入每个 storage-web boundary error 的稳定 library source。应组合 source 与 code 分支，不要解析 message text。',
    quickStart: "if (error && typeof error === 'object' && error.source === STORAGE_WEB_SOURCE) handleStorageError(error)",
    scenariosEn: ['A shared error boundary routes failures by library owner.', 'Serialized diagnostics preserve source and code.', 'Tests assert cross-library error identity.'],
    scenariosZh: ['shared error boundary 按 library owner 路由 failure。', 'serialized diagnostic 保留 source 与 code。', '测试断言 cross-library error identity。'],
    avoidEn: ['A user-facing label is needed.', 'Message parsing is being used instead of semantic codes.', 'The error did not cross the storage-web boundary.'],
    avoidZh: ['需要 user-facing label。', '使用 message parsing 而不是 semantic code。', 'error 未跨过 storage-web boundary。']
  }),
  'storage-web:index:StorageErrorText': createStorageWebGuide({
    purposeEn: 'The frozen registry of stable public diagnostic text owned by storage-web. Runtime code pairs these messages with semantic source/code identity while preserving native error types and causes.',
    purposeZh: 'storage-web 拥有的 frozen stable public diagnostic text registry。runtime code 把这些 message 与 semantic source/code identity 配对，同时保留 native error type 与 cause。',
    quickStart: 'const message = StorageErrorText.backendNotInstalled',
    scenariosEn: ['Infrastructure constructs a library-owned public error.', 'Tests lock intentional contract text.', 'Documentation explains a known diagnostic without duplicating literals.'],
    scenariosZh: ['infrastructure 构建 library-owned public error。', '测试锁定 intentional contract text。', '文档解释 known diagnostic，同时不复制 literal。'],
    avoidEn: ['Application logic branches on text.', 'A new error code has not been registered first.', 'Dynamic context belongs in structured error details.'],
    avoidZh: ['application logic 按 text 分支。', 'new error code 尚未先注册。', 'dynamic context 应放进 structured error details。']
  }),
  'storage-web:index:StorageError': createStorageWebGuide({
    purposeEn: 'The library boundary error that preserves stable source/code identity, structured operation details, native cause reachability, and an optional repository stage. Prefer the canonical operation that throws it; construct it directly only in storage-web-owned extension infrastructure.',
    purposeZh: 'library boundary error，保留稳定 source/code identity、structured operation detail、native cause reachability 与可选 repository stage。优先使用会抛出它的 canonical operation；只有 storage-web-owned extension infrastructure 才直接构造。',
    quickStart: "throw new StorageError(StorageErrorCode.extensionFailed, {\n  backend: 'indexeddb',\n  operation: 'schema.validate',\n  cause\n}, StorageErrorText.liveQueryFailed)",
    scenariosEn: ['Storage-owned infrastructure normalizes an extension failure.', 'A boundary needs structured backend, key, channel, or operation context.', 'The original failure must remain reachable through cause.'],
    scenariosZh: ['storage-owned infrastructure 归一化 extension failure。', 'boundary 需要 structured backend、key、channel 或 operation context。', 'original failure 必须通过 cause 保持 reachable。'],
    avoidEn: ['Application code can let the canonical storage operation create the error.', 'A native TypeError or AggregateError contract is required.', 'The desired semantic code is not in the storage-web registry.'],
    avoidZh: ['application code 可以让 canonical storage operation 创建 error。', '需要 native TypeError 或 AggregateError contract。', '目标 semantic code 不在 storage-web registry。'],
    optionsEn: [
      { name: 'code', description: 'Registered storage-web semantic error code used together with source.', defaultValue: 'required', optional: false, type: 'IStorageErrorCode', whenToUse: 'Select the exact boundary failure contract.', example: 'StorageErrorCode.extensionFailed' },
      { name: 'details', description: 'Structured backend, key, channel, stage, operation, and original cause context.', defaultValue: '{}', type: 'IStorageErrorDetails', whenToUse: 'Retain machine-readable failure context and cause identity.', example: "{ backend: 'indexeddb', operation: 'schema.validate', cause }" },
      { name: 'message', description: 'Optional stable library-owned public message; otherwise a source/code fallback is generated.', defaultValue: '`[storage-web] ${code}`', type: 'string', whenToUse: 'Use a canonical StorageErrorText entry for a public contract.', example: 'StorageErrorText.liveQueryFailed' },
      { name: 'stage', description: 'Optional internal repository stage used by invalid-record policy.', defaultValue: 'undefined', type: "'decode' | 'migrate' | 'validate'", whenToUse: 'Classify a repository read failure for skip-or-throw handling.', example: "'validate'" }
    ],
    optionsZh: [
      { name: 'code', description: '与 source 组合使用的 registered storage-web semantic error code。', defaultValue: 'required', optional: false, type: 'IStorageErrorCode', whenToUse: '选择 exact boundary failure contract。', example: 'StorageErrorCode.extensionFailed' },
      { name: 'details', description: '包含 backend、key、channel、stage、operation 与 original cause 的 structured context。', defaultValue: '{}', type: 'IStorageErrorDetails', whenToUse: '保留 machine-readable failure context 与 cause identity。', example: "{ backend: 'indexeddb', operation: 'schema.validate', cause }" },
      { name: 'message', description: '可选 stable library-owned public message；省略时生成 source/code fallback。', defaultValue: '`[storage-web] ${code}`', type: 'string', whenToUse: 'public contract 使用 canonical StorageErrorText entry。', example: 'StorageErrorText.liveQueryFailed' },
      { name: 'stage', description: 'invalid-record policy 使用的可选 internal repository stage。', defaultValue: 'undefined', type: "'decode' | 'migrate' | 'validate'", whenToUse: '为 skip-or-throw handling 分类 repository read failure。', example: "'validate'" }
    ]
  }),
  'storage-web:plugins-memory:memoryBackendPlugin': createStorageWebGuide({
    purposeEn: 'Wraps the canonical in-memory store as a Host-installable backend plugin. The Host creates exactly one isolated store during installation and owns its publication and disposal; this non-reactive variant does not expose liveQuery capability.',
    purposeZh: '把 canonical in-memory store 包装为 Host-installable backend plugin。Host 在 installation 时只创建一个 isolated store，并拥有其 publication 与 disposal；这个 non-reactive variant 不暴露 liveQuery capability。',
    quickStart: "const host = await createStorageHost({ plugins: [memoryBackendPlugin({ id: 'cache' })] })\nconst cache = host.backend('cache')",
    scenariosEn: ['Tests need a lifecycle-owned in-memory backend.', 'Ephemeral state participates in typed Host lookup.', 'Reactive queries are intentionally not required.'],
    scenariosZh: ['测试需要 lifecycle-owned in-memory backend。', 'ephemeral state 需要参与 typed Host lookup。', '明确不需要 reactive query。'],
    avoidEn: ['Data must survive process or page lifetime.', 'Live queries are required; use memoryReactive.', 'A directly owned memoryStorage instance is simpler.'],
    avoidZh: ['data 必须跨 process 或 page lifetime。', '需要 live query；使用 memoryReactive。', '直接拥有 memoryStorage instance 更简单。'],
    optionsEn: [{ name: 'id', description: 'Literal Host registry ID for this memory instance.', defaultValue: "'memory'", type: 'string', whenToUse: 'Install more than one backend or choose a domain-specific lookup name.', example: "'cache'" }],
    optionsZh: [{ name: 'id', description: '该 memory instance 的 literal Host registry ID。', defaultValue: "'memory'", type: 'string', whenToUse: '安装多个 backend，或选择 domain-specific lookup name。', example: "'cache'" }]
  }),
  'storage-web:plugins-local-storage:localStorageBackendPlugin': createStorageWebGuide({
    purposeEn: 'Wraps the namespaced localStorage factory as a non-reactive Host plugin. It preserves the factory options while adding typed registry identity, atomic installation, and Host-owned cleanup.',
    purposeZh: '把 namespaced localStorage factory 包装为 non-reactive Host plugin。它保留 factory options，同时增加 typed registry identity、atomic installation 与 Host-owned cleanup。',
    quickStart: "const host = await createStorageHost({ plugins: [localStorageBackendPlugin({ id: 'settings', namespace: 'app' })] })\nawait host.backend('settings').set('theme', 'dark')",
    scenariosEn: ['Durable text settings need Host ownership.', 'Synchronous localStorage access is required behind typed lookup.', 'No live-query invalidation is needed.'],
    scenariosZh: ['durable text setting 需要 Host ownership。', '需要在 typed lookup 后使用 synchronous localStorage access。', '不需要 live-query invalidation。'],
    avoidEn: ['Reactive reads are required; use localStorageReactive.', 'Structured records or transactions are needed.', 'The host has no Web Storage and no injected surface.'],
    avoidZh: ['需要 reactive read；使用 localStorageReactive。', '需要 structured record 或 transaction。', 'host 没有 Web Storage 且未注入 surface。'],
    optionsEn: [
      { name: 'id', description: 'Literal Host registry ID for this backend instance.', defaultValue: "'local'", type: 'string', whenToUse: 'Choose the typed lookup name.', example: "'settings'" },
      { name: 'namespace', description: 'Logical prefix isolating persisted physical keys.', defaultValue: "'default'", type: 'string', whenToUse: 'Separate application or feature data.', example: "'app'" },
      { name: 'namespaceCodec', description: 'Advanced persisted physical-key codec.', defaultValue: 'lengthPrefixedNamespaceCodec', type: 'INamespaceCodec', whenToUse: 'Only with an explicit key-format migration.', example: 'customNamespaceCodec' },
      { name: 'storage', description: 'Injected Web Storage-compatible surface captured by the factory.', defaultValue: 'globalThis.localStorage', type: 'IWebStorageLike', whenToUse: 'Use tests, non-browser hosts, or an explicit owner.', example: 'fakeStorage' }
    ],
    optionsZh: [
      { name: 'id', description: '该 backend instance 的 literal Host registry ID。', defaultValue: "'local'", type: 'string', whenToUse: '选择 typed lookup name。', example: "'settings'" },
      { name: 'namespace', description: '隔离 persisted physical key 的 logical prefix。', defaultValue: "'default'", type: 'string', whenToUse: '分离 application 或 feature data。', example: "'app'" },
      { name: 'namespaceCodec', description: 'advanced persisted physical-key codec。', defaultValue: 'lengthPrefixedNamespaceCodec', type: 'INamespaceCodec', whenToUse: '仅配合显式 key-format migration。', example: 'customNamespaceCodec' },
      { name: 'storage', description: 'factory captured 的 injected Web Storage-compatible surface。', defaultValue: 'globalThis.localStorage', type: 'IWebStorageLike', whenToUse: '用于测试、non-browser host 或 explicit owner。', example: 'fakeStorage' }
    ]
  }),
  'storage-web:plugins-session-storage:sessionStorageBackendPlugin': createStorageWebGuide({
    purposeEn: 'Wraps sessionStorage as a non-reactive Host plugin for per-browsing-context text state. Host ownership adds atomic installation and typed lookup without changing session lifetime semantics.',
    purposeZh: '把 sessionStorage 包装为 non-reactive Host plugin，用于 per-browsing-context text state。Host ownership 增加 atomic installation 与 typed lookup，但不改变 session lifetime semantics。',
    quickStart: "const host = await createStorageHost({ plugins: [sessionStorageBackendPlugin({ id: 'draft', namespace: 'checkout' })] })\nawait host.backend('draft').set('step', 'shipping')",
    scenariosEn: ['Per-tab drafts need typed Host ownership.', 'State may survive reload but not the session.', 'Reactive invalidation is not required.'],
    scenariosZh: ['per-tab draft 需要 typed Host ownership。', 'state 可以跨 reload，但不跨 session。', '不需要 reactive invalidation。'],
    avoidEn: ['State must be shared across tabs.', 'Live queries are required; use sessionStorageReactive.', 'Structured records or transactions are needed.'],
    avoidZh: ['state 必须跨 tab 共享。', '需要 live query；使用 sessionStorageReactive。', '需要 structured record 或 transaction。'],
    optionsEn: [
      { name: 'id', description: 'Literal Host registry ID.', defaultValue: "'session'", type: 'string', whenToUse: 'Choose the typed lookup name.', example: "'draft'" },
      { name: 'namespace', description: 'Logical prefix isolating session keys.', defaultValue: "'default'", type: 'string', whenToUse: 'Separate independent session workflows.', example: "'checkout'" },
      { name: 'namespaceCodec', description: 'Advanced persisted physical-key codec.', defaultValue: 'lengthPrefixedNamespaceCodec', type: 'INamespaceCodec', whenToUse: 'Only with an explicit format migration.', example: 'customNamespaceCodec' },
      { name: 'storage', description: 'Injected Web Storage-compatible session surface.', defaultValue: 'globalThis.sessionStorage', type: 'IWebStorageLike', whenToUse: 'Use tests or a non-browser host.', example: 'fakeStorage' }
    ],
    optionsZh: [
      { name: 'id', description: 'literal Host registry ID。', defaultValue: "'session'", type: 'string', whenToUse: '选择 typed lookup name。', example: "'draft'" },
      { name: 'namespace', description: '隔离 session key 的 logical prefix。', defaultValue: "'default'", type: 'string', whenToUse: '分离 independent session workflow。', example: "'checkout'" },
      { name: 'namespaceCodec', description: 'advanced persisted physical-key codec。', defaultValue: 'lengthPrefixedNamespaceCodec', type: 'INamespaceCodec', whenToUse: '仅配合显式 format migration。', example: 'customNamespaceCodec' },
      { name: 'storage', description: 'injected Web Storage-compatible session surface。', defaultValue: 'globalThis.sessionStorage', type: 'IWebStorageLike', whenToUse: '用于测试或 non-browser host。', example: 'fakeStorage' }
    ]
  }),
  'storage-web:plugins-cookies:cookieBackendPlugin': createStorageWebGuide({
    purposeEn: 'Wraps the cookie text store as a non-reactive Host plugin while preserving one fixed write/removal scope. Host ownership does not bypass cookie size, visibility, security, or HttpOnly limits.',
    purposeZh: '把 cookie text store 包装为 non-reactive Host plugin，并保留统一的 write/removal scope。Host ownership 不会绕过 cookie size、visibility、security 或 HttpOnly limit。',
    quickStart: "const host = await createStorageHost({ plugins: [cookieBackendPlugin({ id: 'prefs', namespace: 'app', scope: { path: '/', sameSite: 'lax', secure: true } })] })",
    scenariosEn: ['Small request-carried values need Host ownership.', 'Write and removal scope must remain identical.', 'Reactive polling is intentionally unnecessary.'],
    scenariosZh: ['small request-carried value 需要 Host ownership。', 'write 与 removal scope 必须一致。', '明确不需要 reactive polling。'],
    avoidEn: ['Values may exceed cookie limits.', 'Reactive reads are required; use cookiesReactive.', 'Absence must account for HttpOnly cookies.'],
    avoidZh: ['value 可能超过 cookie limit。', '需要 reactive read；使用 cookiesReactive。', 'absence 必须覆盖 HttpOnly cookie。'],
    optionsEn: [
      { name: 'id', description: 'Literal Host registry ID.', defaultValue: "'cookies'", type: 'string', whenToUse: 'Choose the typed lookup name.', example: "'prefs'" },
      { name: 'namespace', description: 'Logical prefix isolating cookie names.', defaultValue: "'default'", type: 'string', whenToUse: 'Separate independent cookie domains.', example: "'app'" },
      { name: 'namespaceCodec', description: 'Advanced persisted cookie-name codec.', defaultValue: 'lengthPrefixedNamespaceCodec', type: 'INamespaceCodec', whenToUse: 'Only with an explicit name migration.', example: 'customNamespaceCodec' },
      { name: 'scope.path', description: 'Path applied to both writes and removals.', defaultValue: 'undefined', type: 'string', whenToUse: 'Limit delivery to a URL subtree.', example: "'/'" },
      { name: 'scope.domain', description: 'Domain applied to both writes and removals.', defaultValue: 'undefined', type: 'string', whenToUse: 'Share across intended subdomains.', example: "'.example.com'" },
      { name: 'scope.sameSite', description: 'Cross-site delivery policy.', defaultValue: 'undefined', type: "'strict' | 'lax' | 'none'", whenToUse: 'Choose navigation and CSRF behavior deliberately.', example: "'lax'" },
      { name: 'scope.secure', description: 'Restricts delivery to secure transport.', defaultValue: 'false', type: 'boolean', whenToUse: 'Enable for production HTTPS.', example: 'true' },
      { name: 'scope.partitioned', description: 'Requests partitioned cookie storage where supported.', defaultValue: 'false', type: 'boolean', whenToUse: 'Use for an explicitly designed embedded context.', example: 'true' },
      { name: 'document', description: 'Injected document.cookie-compatible owner.', defaultValue: 'globalThis.document', type: 'ICookieDocument', whenToUse: 'Use tests or an explicit host adapter.', example: 'fakeDocument' }
    ],
    optionsZh: [
      { name: 'id', description: 'literal Host registry ID。', defaultValue: "'cookies'", type: 'string', whenToUse: '选择 typed lookup name。', example: "'prefs'" },
      { name: 'namespace', description: '隔离 cookie name 的 logical prefix。', defaultValue: "'default'", type: 'string', whenToUse: '分离 independent cookie domain。', example: "'app'" },
      { name: 'namespaceCodec', description: 'advanced persisted cookie-name codec。', defaultValue: 'lengthPrefixedNamespaceCodec', type: 'INamespaceCodec', whenToUse: '仅配合显式 name migration。', example: 'customNamespaceCodec' },
      { name: 'scope.path', description: '同时应用到 write 与 removal 的 path。', defaultValue: 'undefined', type: 'string', whenToUse: '限制到 URL subtree。', example: "'/'" },
      { name: 'scope.domain', description: '同时应用到 write 与 removal 的 domain。', defaultValue: 'undefined', type: 'string', whenToUse: '在预期 subdomain 间共享。', example: "'.example.com'" },
      { name: 'scope.sameSite', description: 'cross-site delivery policy。', defaultValue: 'undefined', type: "'strict' | 'lax' | 'none'", whenToUse: '明确选择 navigation 与 CSRF behavior。', example: "'lax'" },
      { name: 'scope.secure', description: '把 delivery 限制到 secure transport。', defaultValue: 'false', type: 'boolean', whenToUse: 'production HTTPS 应开启。', example: 'true' },
      { name: 'scope.partitioned', description: '在支持的 host 请求 partitioned cookie storage。', defaultValue: 'false', type: 'boolean', whenToUse: '用于明确设计的 embedded context。', example: 'true' },
      { name: 'document', description: 'injected document.cookie-compatible owner。', defaultValue: 'globalThis.document', type: 'ICookieDocument', whenToUse: '用于测试或 explicit host adapter。', example: 'fakeDocument' }
    ]
  }),
  'storage-web:plugins-indexed-db:indexedDbBackendPlugin': createStorageWebGuide({
    purposeEn: 'Wraps IndexedDB as a non-reactive Host plugin. The store is lifecycle-registered before private preparation opens and backfills it, so preparation failure can roll back without leaking the database owner.',
    purposeZh: '把 IndexedDB 包装为 non-reactive Host plugin。store 会先完成 lifecycle registration，再由 private preparation 打开并 backfill，因此 preparation failure 可以 rollback，且不泄漏 database owner。',
    quickStart: "const host = await createStorageHost({ plugins: [indexedDbBackendPlugin({ id: 'records', dbName: 'app', recordsStoreName: 'users' })] })\nconst records = host.backend('records')",
    scenariosEn: ['Durable records, bytes, indexes, and transactions need Host ownership.', 'Database preparation must finish before publication.', 'Live queries are not required.'],
    scenariosZh: ['durable record、byte、index 与 transaction 需要 Host ownership。', 'database preparation 必须在 publication 前完成。', '不需要 live query。'],
    avoidEn: ['Only a tiny synchronous setting is needed.', 'Reactive reads are required; use indexedDbReactive.', 'The Host lacks IndexedDB and no factory is injected.'],
    avoidZh: ['只需要 tiny synchronous setting。', '需要 reactive read；使用 indexedDbReactive。', 'Host 缺少 IndexedDB 且未注入 factory。'],
    optionsEn: [
      { name: 'id', description: 'Literal Host registry ID.', defaultValue: "'indexed-db'", type: 'string', whenToUse: 'Choose the typed lookup name.', example: "'records'" },
      { name: 'dbName', description: 'Physical IndexedDB database name.', defaultValue: "'storage-web'", type: 'string', whenToUse: 'Isolate one application database lifecycle.', example: "'app'" },
      { name: 'kvStoreName', description: 'Object store for text key-value data.', defaultValue: "'kv'", type: 'string', whenToUse: 'Preserve an existing physical layout.', example: "'settings'" },
      { name: 'bytesStoreName', description: 'Object store for byte values.', defaultValue: "'bytes'", type: 'string', whenToUse: 'Preserve an existing byte-channel layout.', example: "'assets'" },
      { name: 'recordsStoreName', description: 'Object store for structured records.', defaultValue: "'records'", type: 'string', whenToUse: 'Name the primary record collection.', example: "'users'" },
      { name: 'cleanupLegacyRecords', description: 'Release-time opt-in to delete the migrated legacy store.', defaultValue: 'false', type: 'boolean', whenToUse: 'Enable only after rollback is no longer required.', example: 'true' },
      { name: 'factory', description: 'Injected IndexedDB factory.', defaultValue: 'globalThis.indexedDB', type: 'IDBFactory', whenToUse: 'Use tests or an explicit host adapter.', example: 'indexedDB' },
      { name: 'keyRange', description: 'Injected IDBKeyRange constructor paired with factory.', defaultValue: 'globalThis.IDBKeyRange', type: 'typeof IDBKeyRange', whenToUse: 'Inject alongside a non-host factory.', example: 'IDBKeyRange' }
    ],
    optionsZh: [
      { name: 'id', description: 'literal Host registry ID。', defaultValue: "'indexed-db'", type: 'string', whenToUse: '选择 typed lookup name。', example: "'records'" },
      { name: 'dbName', description: 'physical IndexedDB database name。', defaultValue: "'storage-web'", type: 'string', whenToUse: '隔离 application database lifecycle。', example: "'app'" },
      { name: 'kvStoreName', description: 'text key-value data 使用的 object store。', defaultValue: "'kv'", type: 'string', whenToUse: '保留 existing physical layout。', example: "'settings'" },
      { name: 'bytesStoreName', description: 'byte value 使用的 object store。', defaultValue: "'bytes'", type: 'string', whenToUse: '保留 existing byte-channel layout。', example: "'assets'" },
      { name: 'recordsStoreName', description: 'structured record 使用的 object store。', defaultValue: "'records'", type: 'string', whenToUse: '命名 primary record collection。', example: "'users'" },
      { name: 'cleanupLegacyRecords', description: 'release 时删除 migrated legacy store 的 opt-in。', defaultValue: 'false', type: 'boolean', whenToUse: '仅在不再需要 rollback 后开启。', example: 'true' },
      { name: 'factory', description: 'injected IndexedDB factory。', defaultValue: 'globalThis.indexedDB', type: 'IDBFactory', whenToUse: '用于测试或 explicit host adapter。', example: 'indexedDB' },
      { name: 'keyRange', description: '与 factory 配对的 injected IDBKeyRange constructor。', defaultValue: 'globalThis.IDBKeyRange', type: 'typeof IDBKeyRange', whenToUse: '使用 non-host factory 时一起注入。', example: 'IDBKeyRange' }
    ]
  }),
  'storage-web:reactive-adapter:defineReactiveAdapterFeature': createStorageWebGuide({
    purposeEn: 'Defines an advanced custom reactive capability for one opaque backend kind. The adapter declares consistency visibility and supplies a lifecycle-owned source that invalidates Host live queries; built-in backends should use their dedicated reactive plugin factories instead.',
    purposeZh: '为一个 opaque backend kind 定义 advanced custom reactive capability。adapter 声明 consistency visibility，并提供 lifecycle-owned source 来 invalidate Host live query；built-in backend 应使用专用 reactive plugin factory。',
    quickStart: "const reactive = defineReactiveAdapterFeature({\n  backendKind: cacheKind,\n  mode: 'push',\n  visibility: 'instance',\n  subscribe: ({ store, signal, invalidate, report }) => store.subscribe({ signal, invalidate, report })\n})",
    scenariosEn: ['A custom backend has a real push or polling invalidation source.', 'Visibility guarantees must be explicit in live-query consistency.', 'Source cleanup must belong to Host lifecycle.'],
    scenariosZh: ['custom backend 有真实 push 或 polling invalidation source。', 'visibility guarantee 必须在 live-query consistency 中显式声明。', 'source cleanup 必须属于 Host lifecycle。'],
    avoidEn: ['A built-in reactive plugin already exists.', 'The source cannot return or expose bounded cleanup.', 'The declared visibility is stronger than the backend can guarantee.'],
    avoidZh: ['已有 built-in reactive plugin。', 'source 无法返回或暴露 bounded cleanup。', 'declared visibility 强于 backend 实际 guarantee。'],
    optionsEn: [
      { name: 'backendKind', description: 'Exact opaque kind whose stores this adapter accepts.', defaultValue: 'required', optional: false, type: 'IStorageBackendKind', whenToUse: 'Bind the adapter to its custom backend authority.', example: 'cacheKind' },
      { name: 'mode', description: 'Invalidation strategy: push, polling, or both.', defaultValue: 'required', optional: false, type: "'push' | 'hybrid' | 'polling'", whenToUse: 'State how freshness is obtained.', example: "'push'" },
      { name: 'pollIntervalMs', description: 'Polling cadence used by polling or hybrid adapters.', defaultValue: 'undefined', type: 'number', whenToUse: 'Bound eventual refresh when no complete push source exists.', example: '1_000' },
      { name: 'visibility', description: 'Honest scope across which mutations eventually become observable.', defaultValue: 'required', optional: false, type: 'IStorageReactiveVisibility', whenToUse: 'Expose the consistency guarantee to query consumers.', example: "'instance'" },
      { name: 'subscribe', description: 'Lifecycle-owned source receiving store, cancellation, invalidation, and reporting controls.', defaultValue: 'required', optional: false, type: '(context: IReactiveAdapterContext) => IStorageReactiveSourceDisposer | PromiseLike<unknown>', whenToUse: 'Bridge backend changes into Host invalidation.', example: 'subscribeToCache' }
    ],
    optionsZh: [
      { name: 'backendKind', description: '该 adapter 接受其 store 的 exact opaque kind。', defaultValue: 'required', optional: false, type: 'IStorageBackendKind', whenToUse: '把 adapter 绑定到 custom backend authority。', example: 'cacheKind' },
      { name: 'mode', description: 'invalidation strategy：push、polling 或两者结合。', defaultValue: 'required', optional: false, type: "'push' | 'hybrid' | 'polling'", whenToUse: '声明 freshness 如何获得。', example: "'push'" },
      { name: 'pollIntervalMs', description: 'polling 或 hybrid adapter 使用的 polling cadence。', defaultValue: 'undefined', type: 'number', whenToUse: '没有完整 push source 时约束 eventual refresh。', example: '1_000' },
      { name: 'visibility', description: 'mutation 最终可被观察到的真实 scope。', defaultValue: 'required', optional: false, type: 'IStorageReactiveVisibility', whenToUse: '向 query consumer 暴露 consistency guarantee。', example: "'instance'" },
      { name: 'subscribe', description: '接收 store、cancellation、invalidation 与 reporting control 的 lifecycle-owned source。', defaultValue: 'required', optional: false, type: '(context: IReactiveAdapterContext) => IStorageReactiveSourceDisposer | PromiseLike<unknown>', whenToUse: '把 backend change 桥接到 Host invalidation。', example: 'subscribeToCache' }
    ]
  }),
  'storage-web:plugins-reactive-memory:memoryReactive': createStorageWebGuide({
    purposeEn: 'Creates the Host plugin for the in-memory reactive fast path. Changes are pushed within the exact store instance, so live queries receive immediate instance-local invalidation without polling or cross-instance visibility claims.',
    purposeZh: '创建 in-memory reactive fast path 的 Host plugin。change 在 exact store instance 内 push，因此 live query 获得即时 instance-local invalidation，不使用 polling，也不声称 cross-instance visibility。',
    quickStart: "const host = await createStorageHost({ plugins: [memoryReactive({ id: 'cache' })] })\nconst query = host.liveQuery({ backendId: 'cache', runtime, query: ({ store }) => store.get('user') })\nawait query.ready",
    scenariosEn: ['Tests need deterministic push invalidation.', 'Ephemeral state needs live queries in one Host instance.', 'Polling overhead and cross-context guarantees are unnecessary.'],
    scenariosZh: ['测试需要 deterministic push invalidation。', 'ephemeral state 需要在单个 Host instance 内使用 live query。', '不需要 polling overhead 与 cross-context guarantee。'],
    avoidEn: ['Data must persist.', 'Another store instance must observe changes.', 'Only direct reads are needed; use memoryBackendPlugin.'],
    avoidZh: ['data 必须持久化。', '另一个 store instance 必须观察 change。', '只需要 direct read；使用 memoryBackendPlugin。'],
    optionsEn: [{ name: 'id', description: 'Literal reactive backend ID used by Host lookup and liveQuery.backendId.', defaultValue: "'memory'", type: 'string', whenToUse: 'Choose a domain-specific query source name.', example: "'cache'" }],
    optionsZh: [{ name: 'id', description: 'Host lookup 与 liveQuery.backendId 使用的 literal reactive backend ID。', defaultValue: "'memory'", type: 'string', whenToUse: '选择 domain-specific query source name。', example: "'cache'" }]
  }),
  'storage-web:plugins-reactive-local-storage:localStorageReactive': createStorageWebGuide({
    purposeEn: 'Creates the localStorage reactive Host plugin with hybrid invalidation. Same-document writes are observed through the store source, while a one-second polling fallback provides document-eventual visibility; it does not claim synchronous cross-tab coherence.',
    purposeZh: '创建使用 hybrid invalidation 的 localStorage reactive Host plugin。同 document write 通过 store source 观察，同时以 1 秒 polling fallback 提供 document-eventual visibility；它不声称 synchronous cross-tab coherence。',
    quickStart: "const host = await createStorageHost({ plugins: [localStorageReactive({ id: 'settings', namespace: 'app' })] })\nconst theme = host.liveQuery({ backendId: 'settings', runtime, query: ({ store }) => store.get('theme') })",
    scenariosEn: ['Durable browser settings drive reactive UI.', 'Same-document writes need prompt invalidation with polling recovery.', 'Document-eventual consistency is sufficient.'],
    scenariosZh: ['durable browser setting 驱动 reactive UI。', 'same-document write 需要及时 invalidation 与 polling recovery。', 'document-eventual consistency 已足够。'],
    avoidEn: ['Synchronous cross-tab consistency is required.', 'Structured records or transactions are needed.', 'No live query is used; choose localStorageBackendPlugin.'],
    avoidZh: ['需要 synchronous cross-tab consistency。', '需要 structured record 或 transaction。', '没有使用 live query；选择 localStorageBackendPlugin。'],
    optionsEn: [
      { name: 'id', description: 'Literal reactive backend ID.', defaultValue: "'local'", type: 'string', whenToUse: 'Name the live-query source.', example: "'settings'" },
      { name: 'namespace', description: 'Logical prefix isolating persisted keys.', defaultValue: "'default'", type: 'string', whenToUse: 'Separate application data.', example: "'app'" },
      { name: 'namespaceCodec', description: 'Advanced persisted key codec.', defaultValue: 'lengthPrefixedNamespaceCodec', type: 'INamespaceCodec', whenToUse: 'Only with an explicit format migration.', example: 'customNamespaceCodec' },
      { name: 'storage', description: 'Injected Web Storage-compatible surface.', defaultValue: 'globalThis.localStorage', type: 'IWebStorageLike', whenToUse: 'Use tests or an explicit host owner.', example: 'fakeStorage' }
    ],
    optionsZh: [
      { name: 'id', description: 'literal reactive backend ID。', defaultValue: "'local'", type: 'string', whenToUse: '命名 live-query source。', example: "'settings'" },
      { name: 'namespace', description: '隔离 persisted key 的 logical prefix。', defaultValue: "'default'", type: 'string', whenToUse: '分离 application data。', example: "'app'" },
      { name: 'namespaceCodec', description: 'advanced persisted key codec。', defaultValue: 'lengthPrefixedNamespaceCodec', type: 'INamespaceCodec', whenToUse: '仅配合显式 format migration。', example: 'customNamespaceCodec' },
      { name: 'storage', description: 'injected Web Storage-compatible surface。', defaultValue: 'globalThis.localStorage', type: 'IWebStorageLike', whenToUse: '用于测试或 explicit host owner。', example: 'fakeStorage' }
    ]
  }),
  'storage-web:plugins-reactive-session-storage:sessionStorageReactive': createStorageWebGuide({
    purposeEn: 'Creates the sessionStorage reactive Host plugin with hybrid invalidation and one-second polling. Its guarantee is top-level-context-eventual: it follows the current tab or window session, not durable or origin-wide state.',
    purposeZh: '创建使用 hybrid invalidation 与 1 秒 polling 的 sessionStorage reactive Host plugin。它保证 top-level-context-eventual：跟随当前 tab/window session，而不是 durable 或 origin-wide state。',
    quickStart: "const host = await createStorageHost({ plugins: [sessionStorageReactive({ id: 'draft', namespace: 'checkout' })] })\nconst step = host.liveQuery({ backendId: 'draft', runtime, query: ({ store }) => store.get('step') })",
    scenariosEn: ['A per-tab draft drives reactive UI.', 'Reload survival is needed within one session.', 'Eventual visibility inside the top-level context is sufficient.'],
    scenariosZh: ['per-tab draft 驱动 reactive UI。', '需要在单个 session 内跨 reload。', 'top-level context 内 eventual visibility 已足够。'],
    avoidEn: ['State must be shared across tabs or browser restarts.', 'Only direct reads are needed.', 'Structured records or transactions are required.'],
    avoidZh: ['state 必须跨 tab 或 browser restart。', '只需要 direct read。', '需要 structured record 或 transaction。'],
    optionsEn: [
      { name: 'id', description: 'Literal reactive backend ID.', defaultValue: "'session'", type: 'string', whenToUse: 'Name the live-query source.', example: "'draft'" },
      { name: 'namespace', description: 'Logical prefix isolating session keys.', defaultValue: "'default'", type: 'string', whenToUse: 'Separate independent workflows.', example: "'checkout'" },
      { name: 'namespaceCodec', description: 'Advanced persisted key codec.', defaultValue: 'lengthPrefixedNamespaceCodec', type: 'INamespaceCodec', whenToUse: 'Only with an explicit format migration.', example: 'customNamespaceCodec' },
      { name: 'storage', description: 'Injected sessionStorage-compatible surface.', defaultValue: 'globalThis.sessionStorage', type: 'IWebStorageLike', whenToUse: 'Use tests or a non-browser host.', example: 'fakeStorage' }
    ],
    optionsZh: [
      { name: 'id', description: 'literal reactive backend ID。', defaultValue: "'session'", type: 'string', whenToUse: '命名 live-query source。', example: "'draft'" },
      { name: 'namespace', description: '隔离 session key 的 logical prefix。', defaultValue: "'default'", type: 'string', whenToUse: '分离 independent workflow。', example: "'checkout'" },
      { name: 'namespaceCodec', description: 'advanced persisted key codec。', defaultValue: 'lengthPrefixedNamespaceCodec', type: 'INamespaceCodec', whenToUse: '仅配合显式 format migration。', example: 'customNamespaceCodec' },
      { name: 'storage', description: 'injected sessionStorage-compatible surface。', defaultValue: 'globalThis.sessionStorage', type: 'IWebStorageLike', whenToUse: '用于测试或 non-browser host。', example: 'fakeStorage' }
    ]
  }),
  'storage-web:plugins-reactive-cookies:cookiesReactive': createStorageWebGuide({
    purposeEn: 'Creates the cookie reactive Host plugin with hybrid one-second polling and origin-js-visible-eventual consistency. It can observe only cookies visible to JavaScript and cannot prove the absence or state of HttpOnly cookies.',
    purposeZh: '创建使用 hybrid 1 秒 polling 与 origin-js-visible-eventual consistency 的 cookie reactive Host plugin。它只能观察 JavaScript 可见 cookie，无法证明 HttpOnly cookie 的 absence 或 state。',
    quickStart: "const host = await createStorageHost({ plugins: [cookiesReactive({ id: 'prefs', namespace: 'app', scope: { path: '/', sameSite: 'lax', secure: true } })] })\nconst locale = host.liveQuery({ backendId: 'prefs', runtime, query: ({ store }) => store.get('locale') })",
    scenariosEn: ['A small JS-visible cookie drives reactive presentation.', 'Origin-visible eventual polling is acceptable.', 'Cookie write and removal scope must stay identical.'],
    scenariosZh: ['small JS-visible cookie 驱动 reactive presentation。', '可以接受 origin-visible eventual polling。', 'cookie write 与 removal scope 必须一致。'],
    avoidEn: ['HttpOnly state must be observed.', 'Payloads may exceed cookie limits.', 'Reactive polling is unnecessary; use cookieBackendPlugin.'],
    avoidZh: ['必须观察 HttpOnly state。', 'payload 可能超过 cookie limit。', '不需要 reactive polling；使用 cookieBackendPlugin。'],
    optionsEn: [
      { name: 'id', description: 'Literal reactive backend ID.', defaultValue: "'cookies'", type: 'string', whenToUse: 'Name the live-query source.', example: "'prefs'" },
      { name: 'namespace', description: 'Logical prefix isolating cookie names.', defaultValue: "'default'", type: 'string', whenToUse: 'Separate independent cookie domains.', example: "'app'" },
      { name: 'namespaceCodec', description: 'Advanced persisted cookie-name codec.', defaultValue: 'lengthPrefixedNamespaceCodec', type: 'INamespaceCodec', whenToUse: 'Only with an explicit name migration.', example: 'customNamespaceCodec' },
      { name: 'scope.path', description: 'Path shared by writes and removals.', defaultValue: 'undefined', type: 'string', whenToUse: 'Limit delivery to a URL subtree.', example: "'/'" },
      { name: 'scope.domain', description: 'Domain shared by writes and removals.', defaultValue: 'undefined', type: 'string', whenToUse: 'Share across intended subdomains.', example: "'.example.com'" },
      { name: 'scope.sameSite', description: 'Cross-site delivery policy.', defaultValue: 'undefined', type: "'strict' | 'lax' | 'none'", whenToUse: 'Choose navigation and CSRF behavior.', example: "'lax'" },
      { name: 'scope.secure', description: 'Restricts delivery to secure transport.', defaultValue: 'false', type: 'boolean', whenToUse: 'Enable for production HTTPS.', example: 'true' },
      { name: 'scope.partitioned', description: 'Requests partitioned storage where supported.', defaultValue: 'false', type: 'boolean', whenToUse: 'Use in an explicitly designed embedded context.', example: 'true' },
      { name: 'document', description: 'Injected document.cookie-compatible owner.', defaultValue: 'globalThis.document', type: 'ICookieDocument', whenToUse: 'Use tests or an explicit host adapter.', example: 'fakeDocument' }
    ],
    optionsZh: [
      { name: 'id', description: 'literal reactive backend ID。', defaultValue: "'cookies'", type: 'string', whenToUse: '命名 live-query source。', example: "'prefs'" },
      { name: 'namespace', description: '隔离 cookie name 的 logical prefix。', defaultValue: "'default'", type: 'string', whenToUse: '分离 independent cookie domain。', example: "'app'" },
      { name: 'namespaceCodec', description: 'advanced persisted cookie-name codec。', defaultValue: 'lengthPrefixedNamespaceCodec', type: 'INamespaceCodec', whenToUse: '仅配合显式 name migration。', example: 'customNamespaceCodec' },
      { name: 'scope.path', description: 'write 与 removal 共享的 path。', defaultValue: 'undefined', type: 'string', whenToUse: '限制到 URL subtree。', example: "'/'" },
      { name: 'scope.domain', description: 'write 与 removal 共享的 domain。', defaultValue: 'undefined', type: 'string', whenToUse: '在预期 subdomain 间共享。', example: "'.example.com'" },
      { name: 'scope.sameSite', description: 'cross-site delivery policy。', defaultValue: 'undefined', type: "'strict' | 'lax' | 'none'", whenToUse: '选择 navigation 与 CSRF behavior。', example: "'lax'" },
      { name: 'scope.secure', description: '把 delivery 限制到 secure transport。', defaultValue: 'false', type: 'boolean', whenToUse: 'production HTTPS 应开启。', example: 'true' },
      { name: 'scope.partitioned', description: '在支持的 host 请求 partitioned storage。', defaultValue: 'false', type: 'boolean', whenToUse: '用于明确设计的 embedded context。', example: 'true' },
      { name: 'document', description: 'injected document.cookie-compatible owner。', defaultValue: 'globalThis.document', type: 'ICookieDocument', whenToUse: '用于测试或 explicit host adapter。', example: 'fakeDocument' }
    ]
  }),
  'storage-web:plugins-reactive-indexed-db:indexedDbReactive': createStorageWebGuide({
    purposeEn: 'Creates the IndexedDB reactive Host plugin with origin-eventual hybrid invalidation and one-second polling. Host preparation opens and backfills the durable store before publication; live queries may preserve previous data while later generations refresh.',
    purposeZh: '创建使用 origin-eventual hybrid invalidation 与 1 秒 polling 的 IndexedDB reactive Host plugin。Host preparation 会在 publication 前打开并 backfill durable store；后续 generation refresh 时 live query 可以保留 previous data。',
    quickStart: "const host = await createStorageHost({ plugins: [indexedDbReactive({ id: 'records', dbName: 'app', recordsStoreName: 'users' })] })\nconst users = host.liveQuery({ backendId: 'records', runtime, keepPreviousData: true, query: ({ store, signal }) => loadUsers(store, signal) })",
    scenariosEn: ['Durable structured records drive reactive UI.', 'Origin-eventual visibility with polling recovery is acceptable.', 'Preparation, indexes, transactions, and lifecycle cleanup need one Host owner.'],
    scenariosZh: ['durable structured record 驱动 reactive UI。', '可以接受 origin-eventual visibility 与 polling recovery。', 'preparation、index、transaction 与 lifecycle cleanup 需要统一 Host owner。'],
    avoidEn: ['Synchronous cross-context coherence is required.', 'Only direct IndexedDB access is needed.', 'A tiny synchronous setting would be simpler in Web Storage.'],
    avoidZh: ['需要 synchronous cross-context coherence。', '只需要 direct IndexedDB access。', 'tiny synchronous setting 使用 Web Storage 更简单。'],
    optionsEn: [
      { name: 'id', description: 'Literal reactive backend ID.', defaultValue: "'indexed-db'", type: 'string', whenToUse: 'Name the live-query source.', example: "'records'" },
      { name: 'dbName', description: 'Physical IndexedDB database name.', defaultValue: "'storage-web'", type: 'string', whenToUse: 'Isolate one application database lifecycle.', example: "'app'" },
      { name: 'kvStoreName', description: 'Object store for text values.', defaultValue: "'kv'", type: 'string', whenToUse: 'Preserve an existing physical layout.', example: "'settings'" },
      { name: 'bytesStoreName', description: 'Object store for byte values.', defaultValue: "'bytes'", type: 'string', whenToUse: 'Preserve an existing byte layout.', example: "'assets'" },
      { name: 'recordsStoreName', description: 'Object store for structured records.', defaultValue: "'records'", type: 'string', whenToUse: 'Name the primary record collection.', example: "'users'" },
      { name: 'cleanupLegacyRecords', description: 'Release-time opt-in to delete migrated legacy records.', defaultValue: 'false', type: 'boolean', whenToUse: 'Enable only after rollback is no longer required.', example: 'true' },
      { name: 'factory', description: 'Injected IndexedDB factory.', defaultValue: 'globalThis.indexedDB', type: 'IDBFactory', whenToUse: 'Use tests or an explicit host adapter.', example: 'indexedDB' },
      { name: 'keyRange', description: 'Injected IDBKeyRange constructor paired with factory.', defaultValue: 'globalThis.IDBKeyRange', type: 'typeof IDBKeyRange', whenToUse: 'Inject alongside a non-host factory.', example: 'IDBKeyRange' }
    ],
    optionsZh: [
      { name: 'id', description: 'literal reactive backend ID。', defaultValue: "'indexed-db'", type: 'string', whenToUse: '命名 live-query source。', example: "'records'" },
      { name: 'dbName', description: 'physical IndexedDB database name。', defaultValue: "'storage-web'", type: 'string', whenToUse: '隔离 application database lifecycle。', example: "'app'" },
      { name: 'kvStoreName', description: 'text value 使用的 object store。', defaultValue: "'kv'", type: 'string', whenToUse: '保留 existing physical layout。', example: "'settings'" },
      { name: 'bytesStoreName', description: 'byte value 使用的 object store。', defaultValue: "'bytes'", type: 'string', whenToUse: '保留 existing byte layout。', example: "'assets'" },
      { name: 'recordsStoreName', description: 'structured record 使用的 object store。', defaultValue: "'records'", type: 'string', whenToUse: '命名 primary record collection。', example: "'users'" },
      { name: 'cleanupLegacyRecords', description: 'release 时删除 migrated legacy record 的 opt-in。', defaultValue: 'false', type: 'boolean', whenToUse: '仅在不再需要 rollback 后开启。', example: 'true' },
      { name: 'factory', description: 'injected IndexedDB factory。', defaultValue: 'globalThis.indexedDB', type: 'IDBFactory', whenToUse: '用于测试或 explicit host adapter。', example: 'indexedDB' },
      { name: 'keyRange', description: '与 factory 配对的 injected IDBKeyRange constructor。', defaultValue: 'globalThis.IDBKeyRange', type: 'typeof IDBKeyRange', whenToUse: '使用 non-host factory 时一起注入。', example: 'IDBKeyRange' }
    ]
  }),
  'serialize:plugins:jsonParser': createSerializeGuide({
    purposeEn: 'Creates the built-in parser that encodes values as JSON text chunks and decodes value, text, or byte chunks. Byte decoding uses the injected decoder or host TextDecoder; missing host capability fails explicitly.',
    purposeZh: '创建 built-in parser：把 value 编码为 JSON text chunk，并解码 value、text 或 byte chunk。byte decoding 使用 injected decoder 或 host TextDecoder；host capability 缺失时显式失败。',
    quickStart: "const parser = jsonParser({\n  replacer: (key, value) => key === 'secret' ? undefined : value,\n  reviver: (key, value) => key === 'createdAt' ? new Date(value) : value\n})\nconst chunk = await parser.encode(record)",
    scenariosEn: ['Direct parser composition without registry lifecycle.', 'JSON needs a replacer or reviver.', 'A host-specific decoder must be injected.'],
    scenariosZh: ['不使用 registry lifecycle，直接组合 parser。', 'JSON 需要 replacer 或 reviver。', '必须注入 host-specific decoder。'],
    avoidEn: ['Registry type selection or disposal is required; use jsonPlugin.', 'Values contain cycles or unsupported host objects.', 'Binary or structured output is more appropriate.'],
    avoidZh: ['需要 registry type selection 或 disposal；使用 jsonPlugin。', 'value 包含 cycle 或 unsupported host object。', 'binary 或 structured output 更合适。'],
    optionsEn: [
      { name: 'replacer', description: 'Forwarded to JSON.stringify to project or transform fields.', defaultValue: 'undefined', type: '(key: string, value: unknown) => unknown', whenToUse: 'Remove transient fields or encode domain values.', example: "(key, value) => key === 'secret' ? undefined : value" },
      { name: 'reviver', description: 'Forwarded to JSON.parse to restore domain values.', defaultValue: 'undefined', type: '(key: string, value: unknown) => unknown', whenToUse: 'Restore dates or tagged values after parsing.', example: "(key, value) => key === 'createdAt' ? new Date(value) : value" },
      { name: 'space', description: 'JSON indentation width for human inspection.', defaultValue: 'undefined', type: 'number', whenToUse: 'Use for diagnostics only; omit in production payloads.', example: '2' },
      { name: 'decoder', description: 'Byte-to-text capability used for byte chunks.', defaultValue: 'host TextDecoder', type: 'ITextDecoder', whenToUse: 'Inject in runtimes without Encoding API or with custom decoding.', example: 'new TextDecoder()' }
    ],
    optionsZh: [
      { name: 'replacer', description: '传给 JSON.stringify，用于 projection 或 transform field。', defaultValue: 'undefined', type: '(key: string, value: unknown) => unknown', whenToUse: '移除 transient field 或编码 domain value。', example: "(key, value) => key === 'secret' ? undefined : value" },
      { name: 'reviver', description: '传给 JSON.parse，用于恢复 domain value。', defaultValue: 'undefined', type: '(key: string, value: unknown) => unknown', whenToUse: 'parse 后恢复 Date 或 tagged value。', example: "(key, value) => key === 'createdAt' ? new Date(value) : value" },
      { name: 'space', description: '用于 human inspection 的 JSON indentation width。', defaultValue: 'undefined', type: 'number', whenToUse: '仅用于 diagnostic；production payload 应省略。', example: '2' },
      { name: 'decoder', description: 'byte chunk 使用的 byte-to-text capability。', defaultValue: 'host TextDecoder', type: 'ITextDecoder', whenToUse: 'runtime 缺少 Encoding API 或需要 custom decoding 时注入。', example: 'new TextDecoder()' }
    ]
  }),
  'serialize:plugins:jsonPlugin': createSerializeGuide({
    purposeEn: 'Wraps jsonParser as the canonical json registry plugin. Use it when JSON should participate in registry type selection, cancellation, pending tracking, and parser lifecycle.',
    purposeZh: '把 jsonParser 包装为 canonical json registry plugin。JSON 需要参与 registry type selection、cancellation、pending tracking 与 parser lifecycle 时使用。',
    quickStart: 'const registry = createSerializeRegistry([jsonPlugin({ space: 0 })], { scheduler })',
    scenariosEn: ['JSON is the registry primary serializer.', 'Several plugins share one lifecycle owner.', 'Encode and decode need registry cancellation semantics.'],
    scenariosZh: ['JSON 是 registry primary serializer。', '多个 plugin 共享一个 lifecycle owner。', 'encode/decode 需要 registry cancellation semantics。'],
    avoidEn: ['A direct parser call is enough.', 'A custom plugin already owns the parser.', 'Pretty-printing is enabled for high-volume production data.'],
    avoidZh: ['direct parser call 已足够。', 'custom plugin 已经拥有 parser。', '对 high-volume production data 开启 pretty-printing。'],
    optionsEn: [
      { name: 'replacer', description: 'JSON.stringify projection callback.', defaultValue: 'undefined', type: '(key: string, value: unknown) => unknown', whenToUse: 'Exclude or transform fields.', example: "(key, value) => key === 'secret' ? undefined : value" },
      { name: 'reviver', description: 'JSON.parse restoration callback.', defaultValue: 'undefined', type: '(key: string, value: unknown) => unknown', whenToUse: 'Restore tagged domain values.', example: 'restoreDomainValue' },
      { name: 'space', description: 'Optional JSON indentation.', defaultValue: 'undefined', type: 'number', whenToUse: 'Enable only for human-facing diagnostics.', example: '2' },
      { name: 'decoder', description: 'Optional byte-chunk decoder.', defaultValue: 'host TextDecoder', type: 'ITextDecoder', whenToUse: 'Inject explicit host capability.', example: 'new TextDecoder()' }
    ],
    optionsZh: [
      { name: 'replacer', description: 'JSON.stringify projection callback。', defaultValue: 'undefined', type: '(key: string, value: unknown) => unknown', whenToUse: '排除或 transform field。', example: "(key, value) => key === 'secret' ? undefined : value" },
      { name: 'reviver', description: 'JSON.parse restoration callback。', defaultValue: 'undefined', type: '(key: string, value: unknown) => unknown', whenToUse: '恢复 tagged domain value。', example: 'restoreDomainValue' },
      { name: 'space', description: 'optional JSON indentation。', defaultValue: 'undefined', type: 'number', whenToUse: '仅为 human-facing diagnostic 开启。', example: '2' },
      { name: 'decoder', description: 'optional byte-chunk decoder。', defaultValue: 'host TextDecoder', type: 'ITextDecoder', whenToUse: '注入 explicit host capability。', example: 'new TextDecoder()' }
    ]
  }),
  'serialize:core:SERIALIZE_SOURCE': createSerializeGuide({
    purposeEn: 'Canonical library source attached to every tagged Serialize failure. Combine it with code for machine routing and preserve native error identity for same-realm handling.',
    purposeZh: '附加到每个 tagged Serialize failure 的 canonical library source。machine routing 时与 code 组合，并为 same-realm handling 保留 native error identity。',
    quickStart: 'if (error.source === SERIALIZE_SOURCE && error.code === SerializeErrorCode.aborted) handleAbort()',
    scenariosEn: ['Routing shared diagnostics.', 'Serializing source and code across a boundary.', 'Asserting stable failure ownership.'],
    scenariosZh: ['路由 shared diagnostic。', '跨 boundary serialize source 与 code。', '断言稳定 failure ownership。'],
    avoidEn: ['Selecting a failure without checking code.', 'Copying the source literal.', 'Replacing native instanceof checks in one realm.'],
    avoidZh: ['不检查 code 就选择 failure。', '复制 source literal。', '替代 same-realm native instanceof check。']
  }),
  'serialize:core:tagSerializeError': createSerializeGuide({
    purposeEn: 'Attaches immutable source, code, and optional context to an existing native Error without replacing it or touching its stack. Repeating the same identity is idempotent; attempting to retag a different identity throws.',
    purposeZh: '把 immutable source、code 与 optional context 附加到 existing native Error，不替换对象也不触碰 stack。重复相同 identity 是 idempotent；尝试改写为不同 identity 会 throw。',
    quickStart: "const tagged = tagSerializeError(nativeError, SerializeErrorCode.invalidOption, 'registry')\nconsole.log(tagged === nativeError)",
    scenariosEn: ['A native error type must survive public tagging.', 'An existing failure gains machine-readable ownership.', 'Repeated same-code tagging must preserve identity.'],
    scenariosZh: ['public tagging 后必须保留 native error type。', 'existing failure 需要 machine-readable ownership。', '重复 same-code tagging 必须保留 identity。'],
    avoidEn: ['Changing an already tagged source or code.', 'Wrapping a cause with a new error.', 'Representing a normal lifecycle state.'],
    avoidZh: ['改变 already tagged source 或 code。', '用新 error 包装 cause。', '表示正常 lifecycle state。'],
    optionsEn: [
      { name: 'error', description: 'Existing native Error tagged in place.', defaultValue: 'required', optional: false, type: 'E extends Error', whenToUse: 'Preserve exact native instance and stack.', example: 'nativeError' },
      { name: 'code', description: 'Registered Serialize semantic code.', defaultValue: 'required', optional: false, type: 'ISerializeErrorCode', whenToUse: 'Identify the exact contract failure.', example: 'SerializeErrorCode.invalidOption' },
      { name: 'context', description: 'Optional operation label written only when absent.', defaultValue: 'undefined', type: 'string', whenToUse: 'Add stable diagnostic location.', example: "'registry'" }
    ],
    optionsZh: [
      { name: 'error', description: '原地 tagged 的 existing native Error。', defaultValue: '必填', optional: false, type: 'E extends Error', whenToUse: '保留准确 native instance 与 stack。', example: 'nativeError' },
      { name: 'code', description: 'registered Serialize semantic code。', defaultValue: '必填', optional: false, type: 'ISerializeErrorCode', whenToUse: '标识准确 contract failure。', example: 'SerializeErrorCode.invalidOption' },
      { name: 'context', description: '仅在缺失时写入的 optional operation label。', defaultValue: 'undefined', type: 'string', whenToUse: '增加稳定 diagnostic location。', example: "'registry'" }
    ]
  }),
  'serialize:core:createSerializeError': createSerializeGuide({
    purposeEn: 'Creates a tagged native Error for registry lifecycle, environment, abort, and rollback failures. Optional cause remains reachable, and a non-empty errors list is copied into an immutable secondary-failure snapshot.',
    purposeZh: '为 registry lifecycle、environment、abort 与 rollback failure 创建 tagged native Error。optional cause 保持 reachable，非空 errors list 会复制为 immutable secondary-failure snapshot。',
    quickStart: "throw createSerializeError(SerializeErrorCode.registryDisposed, 'Registry is closed', { context: 'export', cause })",
    scenariosEn: ['Registry lifecycle rejects new work.', 'An environment capability is unavailable.', 'Rollback needs to expose secondary failures without replacing the primary.'],
    scenariosZh: ['registry lifecycle 拒绝新 work。', 'environment capability unavailable。', 'rollback 需要暴露 secondary failure，但不能替换 primary。'],
    avoidEn: ['The contract specifically requires TypeError or RangeError.', 'An existing native error should be tagged in place.', 'Errors can be silently discarded.'],
    avoidZh: ['contract 明确要求 TypeError 或 RangeError。', '应原地 tag existing native error。', '静默丢弃 errors。'],
    optionsEn: [
      { name: 'code', description: 'Registered lifecycle or environment failure code.', defaultValue: 'required', optional: false, type: 'ISerializeErrorCode', whenToUse: 'Select the observed semantic condition.', example: 'SerializeErrorCode.registryDisposed' },
      { name: 'message', description: 'Human-readable operation context.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Explain the concrete failure.', example: "'Registry is closed'" },
      { name: 'options.cause', description: 'Optional original primary failure.', defaultValue: 'undefined', type: 'unknown', whenToUse: 'Retain a lower-level reason by identity.', example: 'cause' },
      { name: 'options.context', description: 'Optional stable operation label.', defaultValue: 'undefined', type: 'string', whenToUse: 'Identify the failed workflow.', example: "'export'" },
      { name: 'options.errors', description: 'Optional ordered secondary failures copied and frozen.', defaultValue: 'undefined', type: 'readonly unknown[]', whenToUse: 'Expose rollback or cleanup failures alongside the primary.', example: 'cleanupErrors' }
    ],
    optionsZh: [
      { name: 'code', description: 'registered lifecycle 或 environment failure code。', defaultValue: '必填', optional: false, type: 'ISerializeErrorCode', whenToUse: '选择 observed semantic condition。', example: 'SerializeErrorCode.registryDisposed' },
      { name: 'message', description: 'human-readable operation context。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '说明具体 failure。', example: "'Registry is closed'" },
      { name: 'options.cause', description: 'optional original primary failure。', defaultValue: 'undefined', type: 'unknown', whenToUse: '按 identity 保留 lower-level reason。', example: 'cause' },
      { name: 'options.context', description: 'optional stable operation label。', defaultValue: 'undefined', type: 'string', whenToUse: '标识 failed workflow。', example: "'export'" },
      { name: 'options.errors', description: '复制并冻结的 optional ordered secondary failures。', defaultValue: 'undefined', type: 'readonly unknown[]', whenToUse: '在 primary 之外暴露 rollback 或 cleanup failure。', example: 'cleanupErrors' }
    ]
  }),
  'serialize:core:createSerializeTypeError': createSerializeGuide({
    purposeEn: 'Creates a native TypeError tagged with Serialize source and code while retaining optional cause and context. Use it for wrong runtime shapes, missing callables, and incompatible values.',
    purposeZh: '创建带 Serialize source/code 的 native TypeError，并保留 optional cause/context。用于错误 runtime shape、缺失 callable 与 incompatible value。',
    quickStart: "throw createSerializeTypeError(SerializeErrorCode.invalidOption, 'decoder must be callable', { cause })",
    scenariosEn: ['An option has the wrong runtime type.', 'A required protocol method is missing.', 'Native TypeError branching must remain valid.'],
    scenariosZh: ['option runtime type 错误。', 'required protocol method 缺失。', 'native TypeError branching 必须保持有效。'],
    avoidEn: ['A numeric bound is violated.', 'A lifecycle state rejected work.', 'Replacing an already tagged TypeError.'],
    avoidZh: ['违反 numeric bound。', 'lifecycle state 拒绝 work。', '替换 already tagged TypeError。'],
    optionsEn: [
      { name: 'code', description: 'Registered Serialize code.', defaultValue: 'required', optional: false, type: 'ISerializeErrorCode', whenToUse: 'Usually select invalidOption or invalidChunk for a type contract.', example: 'SerializeErrorCode.invalidOption' },
      { name: 'message', description: 'Human-readable type failure.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'State the required shape.', example: "'decoder must be callable'" },
      { name: 'options.cause', description: 'Optional original accessor or validation failure.', defaultValue: 'undefined', type: 'unknown', whenToUse: 'Retain the lower-level failure.', example: 'cause' },
      { name: 'options.context', description: 'Optional operation label.', defaultValue: 'undefined', type: 'string', whenToUse: 'Identify the failing boundary.', example: "'registry'" }
    ],
    optionsZh: [
      { name: 'code', description: 'registered Serialize code。', defaultValue: '必填', optional: false, type: 'ISerializeErrorCode', whenToUse: 'type contract 通常选择 invalidOption 或 invalidChunk。', example: 'SerializeErrorCode.invalidOption' },
      { name: 'message', description: 'human-readable type failure。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '说明 required shape。', example: "'decoder must be callable'" },
      { name: 'options.cause', description: 'optional original accessor 或 validation failure。', defaultValue: 'undefined', type: 'unknown', whenToUse: '保留 lower-level failure。', example: 'cause' },
      { name: 'options.context', description: 'optional operation label。', defaultValue: 'undefined', type: 'string', whenToUse: '标识 failing boundary。', example: "'registry'" }
    ]
  }),
  'serialize:core:createSerializeRangeError': createSerializeGuide({
    purposeEn: 'Creates a native RangeError tagged with Serialize source and code. Use it for invalid numeric budgets, empty plugin sets, duplicate plugin types, and values outside an admitted finite domain.',
    purposeZh: '创建带 Serialize source/code 的 native RangeError。用于 invalid numeric budget、empty plugin set、duplicate plugin type，以及超出 admitted finite domain 的 value。',
    quickStart: "throw createSerializeRangeError(SerializeErrorCode.invalidOption, 'maxInFlight must be positive')",
    scenariosEn: ['A count or deadline bound is invalid.', 'A plugin list violates cardinality or uniqueness.', 'Native RangeError handling must survive tagging.'],
    scenariosZh: ['count 或 deadline bound 无效。', 'plugin list 违反 cardinality 或 uniqueness。', 'tagging 后必须保留 native RangeError handling。'],
    avoidEn: ['The value has the wrong runtime type.', 'Registry lifecycle rejected work.', 'Silently clamping public invalid input.'],
    avoidZh: ['value runtime type 错误。', 'registry lifecycle 拒绝 work。', '静默 clamp public invalid input。'],
    optionsEn: [
      { name: 'code', description: 'Registered Serialize code.', defaultValue: 'required', optional: false, type: 'ISerializeErrorCode', whenToUse: 'Select the exact range contract failure.', example: 'SerializeErrorCode.invalidOption' },
      { name: 'message', description: 'Human-readable bound or cardinality failure.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'State the violated range.', example: "'maxInFlight must be positive'" },
      { name: 'options.cause', description: 'Optional original failure.', defaultValue: 'undefined', type: 'unknown', whenToUse: 'Retain a lower-level cause.', example: 'cause' },
      { name: 'options.context', description: 'Optional operation label.', defaultValue: 'undefined', type: 'string', whenToUse: 'Identify the failing configuration.', example: "'stream'" }
    ],
    optionsZh: [
      { name: 'code', description: 'registered Serialize code。', defaultValue: '必填', optional: false, type: 'ISerializeErrorCode', whenToUse: '选择准确 range contract failure。', example: 'SerializeErrorCode.invalidOption' },
      { name: 'message', description: 'human-readable bound 或 cardinality failure。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '说明 violated range。', example: "'maxInFlight must be positive'" },
      { name: 'options.cause', description: 'optional original failure。', defaultValue: 'undefined', type: 'unknown', whenToUse: '保留 lower-level cause。', example: 'cause' },
      { name: 'options.context', description: 'optional operation label。', defaultValue: 'undefined', type: 'string', whenToUse: '标识 failing configuration。', example: "'stream'" }
    ]
  }),
  'serialize:core:SerializeCodecError': createSerializeGuide({
    purposeEn: 'Detailed codec boundary Error carrying semantic code, serializer type, encode/decode phase, stream position, consumed-byte progress, context, and original cause. It is frozen after construction so diagnostics cannot drift.',
    purposeZh: '详细 codec boundary Error，携带 semantic code、serializer type、encode/decode phase、stream position、consumed-byte progress、context 与 original cause。construction 后冻结，避免 diagnostic drift。',
    quickStart: "throw new SerializeCodecError('Decode failed', {\n  code: SerializeErrorCode.decodeFailed, type: 'json', phase: SerializePhase.decode,\n  chunkIndex: index, bytesConsumed, context: 'import', cause\n})",
    scenariosEn: ['A parser or stream failure needs precise progress.', 'An outer stream wraps an inner codec failure by cause.', 'Diagnostics route by phase and plugin type.'],
    scenariosZh: ['parser 或 stream failure 需要精确 progress。', 'outer stream 通过 cause 包装 inner codec failure。', 'diagnostic 按 phase 与 plugin type 路由。'],
    avoidEn: ['A construction option has a simple type/range failure.', 'Normal cancellation state is returned rather than thrown.', 'Progress fields are unknown and would be fabricated.'],
    avoidZh: ['construction option 只是简单 type/range failure。', 'normal cancellation state 通过 return 表示。', 'progress field 未知且只能伪造。'],
    optionsEn: [
      { name: 'message', description: 'Human summary of the codec failure.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Describe the failed step.', example: "'Decode failed'" },
      { name: 'details.code', description: 'Registered semantic codec code.', defaultValue: 'required', optional: false, type: 'TCode', whenToUse: 'Identify encode, decode, chunk, abort, or lookup failure.', example: 'SerializeErrorCode.decodeFailed' },
      { name: 'details.type', description: 'Selected serializer plugin type.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Attribute the failure to a codec.', example: "'json'" },
      { name: 'details.phase', description: 'Encode or decode direction.', defaultValue: 'required', optional: false, type: 'ISerializePhase', whenToUse: 'Route direction-specific diagnostics.', example: 'SerializePhase.decode' },
      { name: 'details.chunkIndex', description: 'Zero-based stream position owning the failure.', defaultValue: 'required', optional: false, type: 'number', whenToUse: 'Expose exact progress.', example: 'index' },
      { name: 'details.bytesConsumed', description: 'Validated byte progress before failure.', defaultValue: 'required', optional: false, type: 'number', whenToUse: 'Report resumable or diagnostic progress.', example: 'bytesConsumed' },
      { name: 'details.context', description: 'Optional operation label.', defaultValue: 'undefined', type: 'string', whenToUse: 'Name the workflow.', example: "'import'" },
      { name: 'details.source', description: 'Optional source override for a higher-level library reusing this error shape.', defaultValue: 'SERIALIZE_SOURCE', type: 'string', whenToUse: 'Only when another boundary explicitly owns the error.', example: "'@migaia/storage-web'" },
      { name: 'details.cause', description: 'Original parser, iterator, or transport failure.', defaultValue: 'undefined', type: 'unknown', whenToUse: 'Preserve the primary lower-level reason.', example: 'cause' }
    ],
    optionsZh: [
      { name: 'message', description: 'codec failure 的 human summary。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '描述 failed step。', example: "'Decode failed'" },
      { name: 'details.code', description: 'registered semantic codec code。', defaultValue: '必填', optional: false, type: 'TCode', whenToUse: '标识 encode、decode、chunk、abort 或 lookup failure。', example: 'SerializeErrorCode.decodeFailed' },
      { name: 'details.type', description: 'selected serializer plugin type。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '把 failure 归因到 codec。', example: "'json'" },
      { name: 'details.phase', description: 'encode 或 decode direction。', defaultValue: '必填', optional: false, type: 'ISerializePhase', whenToUse: '路由 direction-specific diagnostic。', example: 'SerializePhase.decode' },
      { name: 'details.chunkIndex', description: '拥有 failure 的 zero-based stream position。', defaultValue: '必填', optional: false, type: 'number', whenToUse: '暴露准确 progress。', example: 'index' },
      { name: 'details.bytesConsumed', description: 'failure 前的 validated byte progress。', defaultValue: '必填', optional: false, type: 'number', whenToUse: '报告 resumable 或 diagnostic progress。', example: 'bytesConsumed' },
      { name: 'details.context', description: 'optional operation label。', defaultValue: 'undefined', type: 'string', whenToUse: '命名 workflow。', example: "'import'" },
      { name: 'details.source', description: 'higher-level library 复用此 error shape 时的 optional source override。', defaultValue: 'SERIALIZE_SOURCE', type: 'string', whenToUse: '仅在另一个 boundary 明确拥有 error 时使用。', example: "'@migaia/storage-web'" },
      { name: 'details.cause', description: 'original parser、iterator 或 transport failure。', defaultValue: 'undefined', type: 'unknown', whenToUse: '保留 primary lower-level reason。', example: 'cause' }
    ]
  }),
  'serialize:core:sliceByFrameBudget': createSerializeGuide({
    purposeEn: 'Adaptively slices a large in-memory array and yields between slices. Consumer processing time is measured through the injected scheduler, then the next slice size is damped toward targetMs while staying inside explicit bounds.',
    purposeZh: '自适应切分 large in-memory array，并在 slice 之间 yield。通过 injected scheduler 测量 consumer processing time，再以阻尼方式把下一片大小调整到 targetMs，同时保持在显式边界内。',
    quickStart: 'for await (const batch of sliceByFrameBudget(rows, { scheduler, targetMs: 8 })) {\n  await worker.process(batch)\n}',
    scenariosEn: ['Large CPU work must preserve browser responsiveness.', 'Slice size should adapt to real consumer cost.', 'A deterministic scheduler is required in tests.'],
    scenariosZh: ['large CPU work 必须保持 browser responsiveness。', 'slice size 应适应真实 consumer cost。', '测试需要 deterministic scheduler。'],
    avoidEn: ['Input already arrives incrementally.', 'Every item must execute atomically in one turn.', 'No scheduler ownership is available.'],
    avoidZh: ['input 已经 incremental 到达。', '全部 item 必须在一个 turn 内 atomic execution。', '没有 scheduler ownership。'],
    optionsEn: [
      { name: 'items', description: 'Read-only array sliced by index; individual values are not cloned.', defaultValue: 'required', optional: false, type: 'readonly T[]', whenToUse: 'Pass one already materialized workload.', example: 'rows' },
      { name: 'scheduler', description: 'Required clock and task scheduler defining the time domain and default yield.', defaultValue: 'required', optional: false, type: 'ISerializeScheduler', whenToUse: 'Use the owner scheduler shared by the operation.', example: 'systemScheduler' },
      { name: 'targetMs', description: 'Desired measured consumer time per slice.', defaultValue: '8', type: 'number', whenToUse: 'Lower for tighter responsiveness or raise for throughput.', example: '8' },
      { name: 'minItems', description: 'Smallest adaptive slice, preventing scheduling overhead from dominating.', defaultValue: '64', type: 'number', whenToUse: 'Bound the lower end for tiny or noisy workloads.', example: '128' },
      { name: 'maxItems', description: 'Largest adaptive slice, limiting one uninterrupted processing turn.', defaultValue: '250000', type: 'number', whenToUse: 'Cap worst-case main-thread occupancy.', example: '50_000' },
      { name: 'initialItems', description: 'Conservative first slice measured before adaptation has evidence.', defaultValue: '2048', type: 'number', whenToUse: 'Tune when item cost is already known.', example: '1_024' },
      { name: 'yieldTo', description: 'Optional custom asynchronous yield between slices.', defaultValue: 'scheduler.schedule(..., 0)', type: '() => Promise<void>', whenToUse: 'Use scheduler.yield or an idle boundary owned by the host.', example: '() => scheduler.yield()' },
      { name: 'signal', description: 'Optional cooperative cancellation observed before each slice and during default yields.', defaultValue: 'undefined', type: 'ISerializeAbortSignal', whenToUse: 'Stop work when its owner closes.', example: 'controller.signal' }
    ],
    optionsZh: [
      { name: 'items', description: '按 index 切分的 read-only array；不会 clone 单个 value。', defaultValue: '必填', optional: false, type: 'readonly T[]', whenToUse: '传入一个已经 materialized 的 workload。', example: 'rows' },
      { name: 'scheduler', description: '定义 time domain 与 default yield 的 required clock/task scheduler。', defaultValue: '必填', optional: false, type: 'ISerializeScheduler', whenToUse: '使用 operation owner 共享的 scheduler。', example: 'systemScheduler' },
      { name: 'targetMs', description: '每个 slice 期望的 measured consumer time。', defaultValue: '8', type: 'number', whenToUse: '降低以提升 responsiveness，或提高以偏向 throughput。', example: '8' },
      { name: 'minItems', description: '最小 adaptive slice，防止 scheduling overhead 占主导。', defaultValue: '64', type: 'number', whenToUse: '约束 tiny 或 noisy workload 的下界。', example: '128' },
      { name: 'maxItems', description: '最大 adaptive slice，限制单次 uninterrupted processing turn。', defaultValue: '250000', type: 'number', whenToUse: '约束最坏 main-thread occupancy。', example: '50_000' },
      { name: 'initialItems', description: 'adaptation 尚无 evidence 前的保守首片。', defaultValue: '2048', type: 'number', whenToUse: '已知 item cost 时调节。', example: '1_024' },
      { name: 'yieldTo', description: 'slice 之间的 optional custom asynchronous yield。', defaultValue: 'scheduler.schedule(..., 0)', type: '() => Promise<void>', whenToUse: '使用 host 拥有的 scheduler.yield 或 idle boundary。', example: '() => scheduler.yield()' },
      { name: 'signal', description: '每片前及 default yield 期间观察的 optional cooperative cancellation。', defaultValue: 'undefined', type: 'ISerializeAbortSignal', whenToUse: 'owner close 时停止 work。', example: 'controller.signal' }
    ]
  }),
  'serialize:core:encodeStream': createSerializeGuide({
    purposeEn: 'Encodes a materialized array as an ordered async chunk stream without assembling one final blob. Adaptive slicing bounds main-thread work, maxInFlight supplies backpressure, and early consumer exit aborts queued operation-owned work.',
    purposeZh: '把 materialized array 编码为 ordered async chunk stream，不组装最终 blob。adaptive slicing 约束 main-thread work，maxInFlight 提供 backpressure，consumer 提前退出会 abort queued operation-owned work。',
    quickStart: 'for await (const chunk of encodeStream(registry, rows, { scheduler, type: \'json\', maxInFlight: 2 })) {\n  await sink.write(chunk)\n}',
    scenariosEn: ['A sink accepts chunks incrementally.', 'Encoding should overlap bounded downstream work.', 'Peak memory must stay near the in-flight slice budget.'],
    scenariosZh: ['sink 可 incremental 接受 chunk。', 'encoding 应与 bounded downstream work overlap。', 'peak memory 必须接近 in-flight slice budget。'],
    avoidEn: ['The consumer requires one complete blob; collect the stream.', 'Input is already an async source rather than an array.', 'Unbounded concurrency is expected.'],
    avoidZh: ['consumer 需要完整 blob；应 collect stream。', 'input 已是 async source 而不是 array。', '期望 unbounded concurrency。'],
    optionsEn: [
      { name: 'registry', description: 'Registry owning parser selection, cancellation, and lifecycle.', defaultValue: 'required', optional: false, type: 'ISerializeRegistry', whenToUse: 'Use the same registry that owns the selected plugin.', example: 'registry' },
      { name: 'items', description: 'Complete read-only input array adaptively sliced before encoding.', defaultValue: 'required', optional: false, type: 'readonly T[]', whenToUse: 'Stream one materialized collection.', example: 'rows' },
      { name: 'type', description: 'Optional registered plugin type; omission selects registry.primaryType.', defaultValue: 'registry.primaryType', type: 'string', whenToUse: 'Override the registry default explicitly.', example: "'json'" },
      { name: 'context', description: 'Human operation label carried by failures.', defaultValue: "'stream'", type: 'string', whenToUse: 'Identify the feature or transfer.', example: "'export-users'" },
      { name: 'maxInFlight', description: 'Positive bound on queued encoding requests.', defaultValue: '1', type: 'number', whenToUse: 'Raise carefully to overlap encoding and sink latency.', example: '2' },
      { name: 'scheduler', description: 'Required scheduler for timing and cooperative yields.', defaultValue: 'required', optional: false, type: 'ISerializeScheduler', whenToUse: 'Share the operation time domain.', example: 'systemScheduler' },
      { name: 'targetMs', description: 'Target measured work per adaptive slice.', defaultValue: '8', type: 'number', whenToUse: 'Tune responsiveness.', example: '8' },
      { name: 'minItems', description: 'Minimum adaptive slice size.', defaultValue: '64', type: 'number', whenToUse: 'Avoid excessive message overhead.', example: '128' },
      { name: 'maxItems', description: 'Maximum adaptive slice size.', defaultValue: '250000', type: 'number', whenToUse: 'Bound one processing turn.', example: '50_000' },
      { name: 'initialItems', description: 'First slice size before timing feedback.', defaultValue: '2048', type: 'number', whenToUse: 'Start conservatively for costly items.', example: '1_024' },
      { name: 'yieldTo', description: 'Optional host-owned yield implementation.', defaultValue: 'scheduler.schedule(..., 0)', type: '() => Promise<void>', whenToUse: 'Integrate a custom cooperative scheduling boundary.', example: '() => scheduler.yield()' },
      { name: 'signal', description: 'Caller cancellation composed with stream ownership.', defaultValue: 'undefined', type: 'ISerializeAbortSignal', whenToUse: 'Cancel on navigation or disposal.', example: 'controller.signal' }
    ],
    optionsZh: [
      { name: 'registry', description: '拥有 parser selection、cancellation 与 lifecycle 的 Registry。', defaultValue: '必填', optional: false, type: 'ISerializeRegistry', whenToUse: '使用拥有 selected plugin 的同一个 registry。', example: 'registry' },
      { name: 'items', description: 'encoding 前会 adaptive slicing 的完整 read-only input array。', defaultValue: '必填', optional: false, type: 'readonly T[]', whenToUse: 'stream 一个 materialized collection。', example: 'rows' },
      { name: 'type', description: 'optional registered plugin type；省略时选择 registry.primaryType。', defaultValue: 'registry.primaryType', type: 'string', whenToUse: '显式覆盖 registry default。', example: "'json'" },
      { name: 'context', description: 'failure 携带的 human operation label。', defaultValue: "'stream'", type: 'string', whenToUse: '标识 feature 或 transfer。', example: "'export-users'" },
      { name: 'maxInFlight', description: 'queued encoding request 的正数上限。', defaultValue: '1', type: 'number', whenToUse: '谨慎提高以 overlap encoding 与 sink latency。', example: '2' },
      { name: 'scheduler', description: 'timing 与 cooperative yield 使用的 required scheduler。', defaultValue: '必填', optional: false, type: 'ISerializeScheduler', whenToUse: '共享 operation time domain。', example: 'systemScheduler' },
      { name: 'targetMs', description: 'adaptive slice 的 target measured work。', defaultValue: '8', type: 'number', whenToUse: '调节 responsiveness。', example: '8' },
      { name: 'minItems', description: '最小 adaptive slice size。', defaultValue: '64', type: 'number', whenToUse: '避免 excessive message overhead。', example: '128' },
      { name: 'maxItems', description: '最大 adaptive slice size。', defaultValue: '250000', type: 'number', whenToUse: '约束一次 processing turn。', example: '50_000' },
      { name: 'initialItems', description: 'timing feedback 前的 first slice size。', defaultValue: '2048', type: 'number', whenToUse: 'costly item 使用保守起点。', example: '1_024' },
      { name: 'yieldTo', description: 'optional host-owned yield implementation。', defaultValue: 'scheduler.schedule(..., 0)', type: '() => Promise<void>', whenToUse: '接入 custom cooperative scheduling boundary。', example: '() => scheduler.yield()' },
      { name: 'signal', description: '与 stream ownership 组合的 caller cancellation。', defaultValue: 'undefined', type: 'ISerializeAbortSignal', whenToUse: 'navigation 或 disposal 时取消。', example: 'controller.signal' }
    ]
  }),
  'serialize:core:decodeStream': createSerializeGuide({
    purposeEn: 'Decodes each chunk from a sync or async iterable and yields values in order. Failures are reprojected with the stream chunk index while retaining the inner registry error as cause.',
    purposeZh: '逐个解码 sync/async iterable 中的 chunk，并按序 yield value。failure 会带 stream chunk index 重新投影，同时把 inner registry error 保留为 cause。',
    quickStart: 'for await (const record of decodeStream(registry, chunks, { type: \'json\', signal })) consume(record)',
    scenariosEn: ['A transport supplies serialized chunks incrementally.', 'Failure location must identify the stream position.', 'Cancellation must stop iteration cooperatively.'],
    scenariosZh: ['transport incremental 提供 serialized chunk。', 'failure location 必须标识 stream position。', 'cancellation 必须协作停止 iteration。'],
    avoidEn: ['Chunks must first be merged into one payload.', 'One value is already available directly.', 'The source iterator cannot be safely abandoned.'],
    avoidZh: ['chunk 必须先合并为一个 payload。', '已经直接 available 一个 value。', 'source iterator 无法安全 abandon。'],
    optionsEn: [
      { name: 'registry', description: 'Registry used to resolve and invoke the decoder.', defaultValue: 'required', optional: false, type: 'ISerializeRegistry', whenToUse: 'Use the owner of the selected plugin.', example: 'registry' },
      { name: 'chunks', description: 'Synchronous or asynchronous source of serialized chunks.', defaultValue: 'required', optional: false, type: 'Iterable<ISerializeChunk> | AsyncIterable<ISerializeChunk>', whenToUse: 'Pass the transport or storage stream.', example: 'responseChunks' },
      { name: 'type', description: 'Optional plugin type; omission selects registry.primaryType.', defaultValue: 'registry.primaryType', type: 'string', whenToUse: 'Decode with a non-primary registered plugin.', example: "'json'" },
      { name: 'context', description: 'Operation label attached to stream failures.', defaultValue: "'stream'", type: 'string', whenToUse: 'Name the import or transport.', example: "'import-users'" },
      { name: 'signal', description: 'Cooperative cancellation observed between chunks.', defaultValue: 'undefined', type: 'ISerializeAbortSignal', whenToUse: 'Stop consuming when the owner closes.', example: 'controller.signal' }
    ],
    optionsZh: [
      { name: 'registry', description: '用于 resolve 并调用 decoder 的 Registry。', defaultValue: '必填', optional: false, type: 'ISerializeRegistry', whenToUse: '使用 selected plugin 的 owner。', example: 'registry' },
      { name: 'chunks', description: 'serialized chunk 的 synchronous 或 asynchronous source。', defaultValue: '必填', optional: false, type: 'Iterable<ISerializeChunk> | AsyncIterable<ISerializeChunk>', whenToUse: '传入 transport 或 storage stream。', example: 'responseChunks' },
      { name: 'type', description: 'optional plugin type；省略时选择 registry.primaryType。', defaultValue: 'registry.primaryType', type: 'string', whenToUse: '使用 non-primary registered plugin 解码。', example: "'json'" },
      { name: 'context', description: '附加到 stream failure 的 operation label。', defaultValue: "'stream'", type: 'string', whenToUse: '命名 import 或 transport。', example: "'import-users'" },
      { name: 'signal', description: 'chunk 之间观察的 cooperative cancellation。', defaultValue: 'undefined', type: 'ISerializeAbortSignal', whenToUse: 'owner close 时停止消费。', example: 'controller.signal' }
    ]
  }),
  'serialize:core:collectStream': createSerializeGuide({
    purposeEn: 'Consumes a complete chunk iterable and merges it into one text or byte chunk. Text remains text until any byte chunk appears; value chunks are rejected because they cannot be concatenated. Use only when the consumer truly needs one complete payload.',
    purposeZh: '消费完整 chunk iterable，并合并为一个 text 或 byte chunk。没有 byte 时保持 text；出现任一 byte 后统一为 bytes；value chunk 因不可拼接而拒绝。仅在 consumer 确实需要完整 payload 时使用。',
    quickStart: 'const complete = await collectStream(encodedChunks, textEncoder, { signal, empty: \'reject\' })',
    scenariosEn: ['A Blob, request body, or storage write needs one payload.', 'Mixed text and byte chunks must normalize to bytes.', 'Iterator cleanup must run on cancellation or failure.'],
    scenariosZh: ['Blob、request body 或 storage write 需要单个 payload。', 'mixed text/byte chunk 必须规范化为 bytes。', 'cancellation 或 failure 时必须执行 iterator cleanup。'],
    avoidEn: ['The sink accepts chunks incrementally.', 'Peak memory must stay bounded by one chunk.', 'The stream contains structured value chunks.'],
    avoidZh: ['sink 可 incremental 接受 chunk。', 'peak memory 必须约束为一个 chunk。', 'stream 包含 structured value chunk。'],
    optionsEn: [
      { name: 'chunks', description: 'Complete sync or async chunk source consumed exactly once.', defaultValue: 'required', optional: false, type: 'Iterable<ISerializeChunk> | AsyncIterable<ISerializeChunk>', whenToUse: 'Merge a finite serialized stream.', example: 'encodedChunks' },
      { name: 'encoder', description: 'Text encoder required when text must join byte chunks; host TextEncoder is not assumed here.', defaultValue: 'undefined', type: 'ITextEncoder', whenToUse: 'Provide whenever mixed output may contain bytes.', example: 'new TextEncoder()' },
      { name: 'signal', description: 'Cancellation checked before and during iterator consumption.', defaultValue: 'undefined', type: 'ISerializeAbortSignal', whenToUse: 'Abort an expensive collection.', example: 'controller.signal' },
      { name: 'empty', description: 'Whether an empty source returns an empty text chunk or rejects.', defaultValue: "'text'", type: "'text' | 'reject'", whenToUse: 'Choose reject when empty input is a protocol error.', example: "'reject'" },
      { name: 'context', description: 'Diagnostic label attached to collection failures.', defaultValue: "'stream'", type: 'string', whenToUse: 'Identify the owning operation.', example: "'upload-body'" }
    ],
    optionsZh: [
      { name: 'chunks', description: '只消费一次的完整 sync/async chunk source。', defaultValue: '必填', optional: false, type: 'Iterable<ISerializeChunk> | AsyncIterable<ISerializeChunk>', whenToUse: '合并 finite serialized stream。', example: 'encodedChunks' },
      { name: 'encoder', description: 'text 与 byte chunk 合并时所需的 text encoder；此处不假设 host TextEncoder。', defaultValue: 'undefined', type: 'ITextEncoder', whenToUse: 'mixed output 可能包含 bytes 时提供。', example: 'new TextEncoder()' },
      { name: 'signal', description: 'iterator consumption 前及期间检查的 cancellation。', defaultValue: 'undefined', type: 'ISerializeAbortSignal', whenToUse: 'abort expensive collection。', example: 'controller.signal' },
      { name: 'empty', description: 'empty source 返回 empty text chunk 或 reject。', defaultValue: "'text'", type: "'text' | 'reject'", whenToUse: 'empty input 是 protocol error 时选择 reject。', example: "'reject'" },
      { name: 'context', description: '附加到 collection failure 的 diagnostic label。', defaultValue: "'stream'", type: 'string', whenToUse: '标识 owning operation。', example: "'upload-body'" }
    ]
  }),
  'serialize:registry:chunkToText': createSerializeGuide({
    purposeEn: 'Normalizes one text or byte chunk to string using an injected decoder. Byte chunks are decoded, text is returned unchanged, and structured value chunks fail with a tagged native TypeError.',
    purposeZh: '使用 injected decoder 把一个 text/byte chunk 规范化为 string。byte chunk 会 decode，text 原样返回，structured value chunk 以 tagged native TypeError 失败。',
    quickStart: 'const text = chunkToText(chunk, new TextDecoder())',
    scenariosEn: ['A text-only sink receives either text or bytes.', 'Host Encoding capability is explicitly injected.', 'Value chunks must fail before accidental coercion.'],
    scenariosZh: ['text-only sink 接收 text 或 bytes。', '显式注入 host Encoding capability。', 'value chunk 必须在 accidental coercion 前失败。'],
    avoidEn: ['The caller can preserve bytes.', 'The chunk contains a structured value.', 'Implicit String coercion is acceptable.'],
    avoidZh: ['caller 可以保留 bytes。', 'chunk 包含 structured value。', '接受隐式 String coercion。'],
    optionsEn: [
      { name: 'chunk', description: 'Single admitted Serialize chunk.', defaultValue: 'required', optional: false, type: 'ISerializeChunk', whenToUse: 'Normalize at a text boundary.', example: 'chunk' },
      { name: 'decoder', description: 'Injected byte-to-text capability.', defaultValue: 'required', optional: false, type: 'ITextDecoder', whenToUse: 'Decode a possible byte chunk.', example: 'new TextDecoder()' }
    ],
    optionsZh: [
      { name: 'chunk', description: '单个 admitted Serialize chunk。', defaultValue: '必填', optional: false, type: 'ISerializeChunk', whenToUse: '在 text boundary 规范化。', example: 'chunk' },
      { name: 'decoder', description: 'injected byte-to-text capability。', defaultValue: '必填', optional: false, type: 'ITextDecoder', whenToUse: '解码 possible byte chunk。', example: 'new TextDecoder()' }
    ]
  }),
  'serialize:registry:chunkToBytes': createSerializeGuide({
    purposeEn: 'Normalizes one byte or text chunk to a new Uint8Array. Existing bytes are copied to transfer ownership safely; text uses the injected encoder; structured value chunks are rejected.',
    purposeZh: '把一个 byte/text chunk 规范化为新的 Uint8Array。existing bytes 会复制以安全转移 ownership，text 使用 injected encoder，structured value chunk 被拒绝。',
    quickStart: 'const ownedBytes = chunkToBytes(chunk, new TextEncoder())\nport.postMessage(ownedBytes, [ownedBytes.buffer])',
    scenariosEn: ['Preparing transferable bytes.', 'Writing to binary persistence.', 'Detaching output ownership from a source chunk.'],
    scenariosZh: ['准备 transferable bytes。', '写入 binary persistence。', '让 output ownership 脱离 source chunk。'],
    avoidEn: ['The sink accepts text directly.', 'The chunk is a structured value.', 'Returning the original byte view by identity is required.'],
    avoidZh: ['sink 可直接接受 text。', 'chunk 是 structured value。', '要求按 identity 返回 original byte view。'],
    optionsEn: [
      { name: 'chunk', description: 'Single admitted text or byte chunk.', defaultValue: 'required', optional: false, type: 'ISerializeChunk', whenToUse: 'Normalize at a binary boundary.', example: 'chunk' },
      { name: 'encoder', description: 'Injected text-to-byte capability.', defaultValue: 'required', optional: false, type: 'ITextEncoder', whenToUse: 'Encode a possible text chunk.', example: 'new TextEncoder()' }
    ],
    optionsZh: [
      { name: 'chunk', description: '单个 admitted text 或 byte chunk。', defaultValue: '必填', optional: false, type: 'ISerializeChunk', whenToUse: '在 binary boundary 规范化。', example: 'chunk' },
      { name: 'encoder', description: 'injected text-to-byte capability。', defaultValue: '必填', optional: false, type: 'ITextEncoder', whenToUse: '编码 possible text chunk。', example: 'new TextEncoder()' }
    ]
  }),
  'serialize:registry:createSerializeRegistry': createSerializeGuide({
    purposeEn: 'Creates the lifecycle owner for an ordered plugin set. The first plugin is primary; construction snapshots every option and parser method before ownership, encode/decode compose caller cancellation with registry close, and dispose is single-flight with a frozen first deadline.',
    purposeZh: '为 ordered plugin set 创建 lifecycle owner。首个 plugin 是 primary；construction 在 ownership 前 snapshot 全部 option 与 parser method；encode/decode 组合 caller cancellation 与 registry close；dispose single-flight，并冻结首次 deadline。',
    quickStart: 'const registry = createSerializeRegistry([jsonPlugin()], { scheduler, report })\ntry {\n  const chunk = await registry.encode(value)\n  return await registry.decode(chunk)\n} finally {\n  await registry.dispose({ deadlineAt: scheduler.now() + 1_000 })\n}',
    scenariosEn: ['Several serializers need one selected default and lifecycle.', 'In-flight work must abort when the owner closes.', 'Parser disposal, drain deadlines, and late failures need explicit observation.'],
    scenariosZh: ['多个 serializer 需要一个 selected default 与 lifecycle。', 'owner close 时必须 abort in-flight work。', 'parser disposal、drain deadline 与 late failure 需要显式 observation。'],
    avoidEn: ['One direct parser call is enough.', 'An empty plugin list or duplicate type is intentional.', 'The caller cannot dispose the registry owner.'],
    avoidZh: ['一次 direct parser call 已足够。', '有意使用 empty plugin list 或 duplicate type。', 'caller 无法 dispose registry owner。'],
    optionsEn: [
      { name: 'plugins', description: 'Non-empty ordered plugins; the first type becomes primary and duplicate types are rejected.', defaultValue: 'required', optional: false, type: 'readonly ISerializePlugin[]', whenToUse: 'Install every parser owned by one registry.', example: '[jsonPlugin(), binaryPlugin]' },
      { name: 'scheduler', description: 'Lifecycle time domain for deadlines and default scheduling.', defaultValue: 'systemScheduler', type: 'ISerializeScheduler', whenToUse: 'Inject deterministic time or share host lifecycle time.', example: 'systemScheduler' },
      { name: 'encoder', description: 'Text-to-byte capability captured at construction.', defaultValue: 'host TextEncoder', type: 'ITextEncoder', whenToUse: 'Required in hosts without Encoding API or for a custom implementation.', example: 'new TextEncoder()' },
      { name: 'decoder', description: 'Byte-to-text capability captured at construction.', defaultValue: 'host TextDecoder', type: 'ITextDecoder', whenToUse: 'Required in hosts without Encoding API or for custom decoding.', example: 'new TextDecoder()' },
      { name: 'cleanup.policy', description: 'Whether parser cleanup failures reject dispose or go to cleanup.report.', defaultValue: "'throw'", type: "'throw' | 'report'", whenToUse: 'Choose explicit host teardown policy.', example: 'SerializeCleanupPolicy.report' },
      { name: 'cleanup.report', description: 'Required diagnostic sink when cleanup.policy is report.', defaultValue: 'required for report policy', type: '(diagnostic: ISerializeCleanupError) => void', whenToUse: 'Contain cleanup failure without losing observation.', example: 'reportCleanup' },
      { name: 'onDrainTimeout', description: 'Observes a dispose deadline reached with pending work.', defaultValue: 'undefined', type: '(diagnostic: ISerializeTimeoutDiagnostic) => void', whenToUse: 'Measure graceful-shutdown degradation separately from cleanup failure.', example: 'recordDrainTimeout' },
      { name: 'report', description: 'Contains iterator-return failures and rejections that arrive after terminal cleanup.', defaultValue: 'no-op', type: '(error: unknown) => void', whenToUse: 'Keep secondary and late failures observable.', example: 'reportError' }
    ],
    optionsZh: [
      { name: 'plugins', description: '非空 ordered plugins；首个 type 成为 primary，duplicate type 被拒绝。', defaultValue: '必填', optional: false, type: 'readonly ISerializePlugin[]', whenToUse: '安装由一个 registry 拥有的全部 parser。', example: '[jsonPlugin(), binaryPlugin]' },
      { name: 'scheduler', description: 'deadline 与 default scheduling 使用的 lifecycle time domain。', defaultValue: 'systemScheduler', type: 'ISerializeScheduler', whenToUse: '注入 deterministic time 或共享 host lifecycle time。', example: 'systemScheduler' },
      { name: 'encoder', description: 'construction 时捕获的 text-to-byte capability。', defaultValue: 'host TextEncoder', type: 'ITextEncoder', whenToUse: 'host 缺少 Encoding API 或需要 custom implementation 时提供。', example: 'new TextEncoder()' },
      { name: 'decoder', description: 'construction 时捕获的 byte-to-text capability。', defaultValue: 'host TextDecoder', type: 'ITextDecoder', whenToUse: 'host 缺少 Encoding API 或需要 custom decoding 时提供。', example: 'new TextDecoder()' },
      { name: 'cleanup.policy', description: 'parser cleanup failure reject dispose，或进入 cleanup.report。', defaultValue: "'throw'", type: "'throw' | 'report'", whenToUse: '显式选择 host teardown policy。', example: 'SerializeCleanupPolicy.report' },
      { name: 'cleanup.report', description: 'cleanup.policy 为 report 时 required diagnostic sink。', defaultValue: 'report policy 下必填', type: '(diagnostic: ISerializeCleanupError) => void', whenToUse: '隔离 cleanup failure，同时保持 observation。', example: 'reportCleanup' },
      { name: 'onDrainTimeout', description: '观察 dispose deadline 到达时仍有 pending work。', defaultValue: 'undefined', type: '(diagnostic: ISerializeTimeoutDiagnostic) => void', whenToUse: '把 graceful-shutdown degradation 与 cleanup failure 分开测量。', example: 'recordDrainTimeout' },
      { name: 'report', description: '隔离 iterator-return failure 与 terminal cleanup 后到达的 rejection。', defaultValue: 'no-op', type: '(error: unknown) => void', whenToUse: '保持 secondary 与 late failure observable。', example: 'reportError' }
    ]
  }),
  'serialize:index:SerializeChunkKind': createSerializeGuide({
    purposeEn: 'Canonical chunk discriminators for structured values, text, and bytes. Parsers and stream consumers branch on these values; use the constant instead of copying wire strings.',
    purposeZh: 'structured value、text 与 bytes 的 canonical chunk discriminator。parser 与 stream consumer 按这些 value 分支；应使用 constant，不要复制 wire string。',
    quickStart: 'if (chunk[0] === SerializeChunkKind.bytes) send(chunk[1])',
    scenariosEn: ['Building a custom parser.', 'Inspecting streamed output.', 'Writing exhaustive chunk handling.'],
    scenariosZh: ['构建 custom parser。', '检查 streamed output。', '编写 exhaustive chunk handling。'],
    avoidEn: ['Describing codec output capability.', 'Inventing another chunk kind.', 'Treating value chunks as wire bytes.'],
    avoidZh: ['描述 codec output capability。', '发明其他 chunk kind。', '把 value chunk 当作 wire bytes。']
  }),
  'serialize:index:SerializeCleanupKind': createSerializeGuide({
    purposeEn: 'Stable diagnostic kinds emitted when registry cleanup fails or cannot drain before its deadline. They classify teardown observation, not thrown error codes.',
    purposeZh: 'registry cleanup 失败或无法在 deadline 前 drain 时发出的稳定 diagnostic kind。它们分类 teardown observation，不是 thrown error code。',
    quickStart: 'if (event.kind === SerializeCleanupKind.drainTimeout) recordSlowShutdown(event)',
    scenariosEn: ['Routing cleanup diagnostics.', 'Separating cleanup failure from drain timeout.', 'Aggregating shutdown telemetry.'],
    scenariosZh: ['路由 cleanup diagnostic。', '区分 cleanup failure 与 drain timeout。', '聚合 shutdown telemetry。'],
    avoidEn: ['Throwing these values as semantic codes.', 'Representing registry lifecycle state.', 'Suppressing the attached original failure.'],
    avoidZh: ['把这些 value 作为 semantic code 抛出。', '表示 registry lifecycle state。', '隐藏附带的 original failure。']
  }),
  'serialize:index:SerializeCleanupPolicy': createSerializeGuide({
    purposeEn: 'Selects registry teardown behavior: throw exposes cleanup failure to the disposer, while report contains it through the configured cleanup reporter. The policy does not change primary operation errors.',
    purposeZh: '选择 registry teardown behavior：throw 将 cleanup failure 暴露给 disposer，report 通过 configured cleanup reporter 隔离。该 policy 不改变 primary operation error。',
    quickStart: 'createSerializeRegistry(plugins, { cleanup: { policy: SerializeCleanupPolicy.report, report } })',
    scenariosEn: ['A host chooses fail-fast shutdown.', 'A long-lived service reports contained cleanup errors.', 'Tests make teardown policy explicit.'],
    scenariosZh: ['host 选择 fail-fast shutdown。', 'long-lived service 报告 contained cleanup error。', '测试显式声明 teardown policy。'],
    avoidEn: ['Choosing how encode errors propagate.', 'Using report without a cleanup reporter.', 'Silently swallowing cleanup failure.'],
    avoidZh: ['选择 encode error 如何传播。', '选择 report 却不提供 cleanup reporter。', '静默吞掉 cleanup failure。']
  }),
  'serialize:index:SerializeOutput': createSerializeGuide({
    purposeEn: 'Canonical codec output representations: text, structured, and binary. Use them to route an admitted codec to a compatible transport or persistence channel.',
    purposeZh: 'canonical codec output representation：text、structured 与 binary。用于把 admitted codec 路由到兼容 transport 或 persistence channel。',
    quickStart: 'const channel = codec.output === SerializeOutput.binary ? byteStore : textStore',
    scenariosEn: ['Selecting a storage channel.', 'Declaring custom codec output.', 'Rejecting an incompatible transport before encoding.'],
    scenariosZh: ['选择 storage channel。', '声明 custom codec output。', 'encoding 前拒绝 incompatible transport。'],
    avoidEn: ['Classifying an individual stream chunk.', 'Inferring output by sampling data.', 'Treating structured output as JSON text.'],
    avoidZh: ['分类单个 stream chunk。', '通过 sample data 推断 output。', '把 structured output 当作 JSON text。']
  }),
  'serialize:index:SerializePhase': createSerializeGuide({
    purposeEn: 'Stable encode and decode phase values carried by SerializeCodecError and instrumentation. They identify which direction failed without parsing a message.',
    purposeZh: 'SerializeCodecError 与 instrumentation 携带的稳定 encode/decode phase value。无需解析 message 即可识别失败方向。',
    quickStart: 'if (error.phase === SerializePhase.decode) quarantinePayload()',
    scenariosEn: ['Routing codec diagnostics.', 'Measuring encode and decode separately.', 'Asserting error details in tests.'],
    scenariosZh: ['路由 codec diagnostic。', '分别测量 encode 与 decode。', '在测试中断言 error detail。'],
    avoidEn: ['Representing registry lifecycle.', 'Replacing semantic error code.', 'Inferring whether data is text or bytes.'],
    avoidZh: ['表示 registry lifecycle。', '替代 semantic error code。', '推断 data 是 text 还是 bytes。']
  }),
  'serialize:index:SerializePluginType': createSerializeGuide({
    purposeEn: 'Canonical identifier for the built-in JSON plugin. Registry type lookup and metadata use this exact value; custom plugins must choose their own valid stable type.',
    purposeZh: 'built-in JSON plugin 的 canonical identifier。registry type lookup 与 metadata 使用该精确 value；custom plugin 必须选择自己的有效稳定 type。',
    quickStart: 'const value = await registry.decode(chunk, { type: SerializePluginType.json })',
    scenariosEn: ['Selecting the built-in JSON parser.', 'Checking registry metadata.', 'Avoiding duplicated json literals.'],
    scenariosZh: ['选择 built-in JSON parser。', '检查 registry metadata。', '避免重复 json literal。'],
    avoidEn: ['Naming a custom codec json.', 'Selecting a chunk representation.', 'Using the identifier as a payload field.'],
    avoidZh: ['把 custom codec 命名为 json。', '选择 chunk representation。', '把 identifier 当作 payload field。']
  }),
  'serialize:core:assertSerializeType': createSerializeGuide({
    purposeEn: 'Validates a serializer type before registry lookup or installation. Accepted names follow SERIALIZE_TYPE_PATTERN; malformed values fail early instead of becoming ambiguous missing-plugin errors.',
    purposeZh: '在 registry lookup 或 installation 前验证 serializer type。accepted name 必须符合 SERIALIZE_TYPE_PATTERN；malformed value 会 early fail，不会变成含糊的 missing-plugin error。',
    quickStart: 'assertSerializeType(type)\nconst parser = registry.get(type)',
    scenariosEn: ['Admitting a custom plugin type.', 'Validating a caller-selected codec.', 'Rejecting malformed registry keys before mutation.'],
    scenariosZh: ['接纳 custom plugin type。', '验证 caller-selected codec。', 'mutation registry 前拒绝 malformed key。'],
    avoidEn: ['Checking whether a valid type is installed.', 'Normalizing uppercase or whitespace.', 'Generating random type names.'],
    avoidZh: ['检查 valid type 是否 installed。', '规范化 uppercase 或 whitespace。', '生成 random type name。'],
    optionsEn: [{ name: 'type', description: 'Stable serializer identifier checked against SERIALIZE_TYPE_PATTERN.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Validate before registry lookup or registration.', example: "'json'" }],
    optionsZh: [{ name: 'type', description: '按 SERIALIZE_TYPE_PATTERN 检查的稳定 serializer identifier。', defaultValue: '必填', optional: false, type: 'string', whenToUse: 'registry lookup 或 registration 前验证。', example: "'json'" }]
  }),
  'serialize:core:SERIALIZE_TYPE_PATTERN': createSerializeGuide({
    purposeEn: 'Published lexical contract for serializer type names. It is useful for preflight UI and tests, while assertSerializeType remains the authoritative runtime guard.',
    purposeZh: 'serializer type name 的公开 lexical contract。可用于 preflight UI 与测试；assertSerializeType 仍是 authoritative runtime guard。',
    quickStart: 'const looksValid = SERIALIZE_TYPE_PATTERN.test(input)',
    scenariosEn: ['Providing immediate form feedback.', 'Generating boundary fixtures.', 'Documenting the accepted identifier grammar.'],
    scenariosZh: ['提供即时 form feedback。', '生成 boundary fixture。', '说明 accepted identifier grammar。'],
    avoidEn: ['Replacing assertSerializeType at a public boundary.', 'Checking plugin installation.', 'Mutating or recompiling the expression.'],
    avoidZh: ['在 public boundary 替代 assertSerializeType。', '检查 plugin installation。', 'mutation 或重新编译该 expression。']
  }),
  'serialize:core:isChunkShape': createSerializeGuide({
    purposeEn: 'Side-effect-free structural guard for one Serialize chunk tuple. It distinguishes a direct chunk from iterable or promised parser output before collection.',
    purposeZh: '单个 Serialize chunk tuple 的 side-effect-free structural guard。在 collection 前区分 direct chunk、iterable output 与 promised output。',
    quickStart: 'if (isChunkShape(output)) consume(output)\nelse for await (const chunk of output) consume(chunk)',
    scenariosEn: ['Normalizing parser output.', 'Narrowing an unknown transport value.', 'Testing custom parser fixtures.'],
    scenariosZh: ['规范化 parser output。', '收窄 unknown transport value。', '测试 custom parser fixture。'],
    avoidEn: ['Fully validating chunk payload semantics.', 'Treating arbitrary two-item arrays as trusted wire data.', 'Detecting a list of chunks.'],
    avoidZh: ['完整验证 chunk payload semantics。', '把 arbitrary two-item array 当作 trusted wire data。', '检测 chunk list。'],
    optionsEn: [{ name: 'value', description: 'Unknown candidate checked for the tuple discriminator and payload shape.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Branch before stream normalization.', example: 'parserOutput' }],
    optionsZh: [{ name: 'value', description: '按 tuple discriminator 与 payload shape 检查的未知候选值。', defaultValue: '必填', optional: false, type: 'unknown', whenToUse: 'stream normalization 前分支。', example: 'parserOutput' }]
  }),
  'serialize:core:bytesToBase64': createSerializeGuide({
    purposeEn: 'Encodes one Uint8Array into canonical Base64 without relying on host btoa. Use it when the final consumer requires one complete text value.',
    purposeZh: '不依赖 host btoa，将一个 Uint8Array 编码为 canonical Base64。最终 consumer 需要完整 text value 时使用。',
    quickStart: 'const payload = bytesToBase64(bytes)\nawait textStore.set(key, payload)',
    scenariosEn: ['Writing binary data to a text-only channel.', 'Producing one JSON-compatible string.', 'Sharing identical output across runtimes.'],
    scenariosZh: ['把 binary data 写入 text-only channel。', '生成一个 JSON-compatible string。', '跨 runtime 保持相同 output。'],
    avoidEn: ['The sink accepts incremental chunks.', 'The transport already accepts bytes.', 'Encoding very large input into one additional string allocation.'],
    avoidZh: ['sink 接受 incremental chunk。', 'transport 已接受 bytes。', '把超大 input 编码为额外的完整 string allocation。'],
    optionsEn: [{ name: 'bytes', description: 'Complete byte view to encode.', defaultValue: 'required', optional: false, type: 'Uint8Array', whenToUse: 'Pass the exact bytes owned by this operation.', example: 'payloadBytes' }],
    optionsZh: [{ name: 'bytes', description: '待编码的完整 byte view。', defaultValue: '必填', optional: false, type: 'Uint8Array', whenToUse: '传入该 operation 拥有的准确 bytes。', example: 'payloadBytes' }]
  }),
  'serialize:core:base64ToBytes': createSerializeGuide({
    purposeEn: 'Strictly decodes canonical Base64 text into bytes. Invalid alphabet, padding, or length becomes a tagged native TypeError with INVALID_OPTION.',
    purposeZh: '严格把 canonical Base64 text 解码为 bytes。无效 alphabet、padding 或 length 会成为带 INVALID_OPTION 的 tagged native TypeError。',
    quickStart: 'const bytes = base64ToBytes(record.payload)\nawait byteSink.write(bytes)',
    scenariosEn: ['Reading binary data from a text channel.', 'Decoding SSR or persistence payloads.', 'Rejecting malformed external Base64 deterministically.'],
    scenariosZh: ['从 text channel 读取 binary data。', '解码 SSR 或 persistence payload。', '确定性拒绝 malformed external Base64。'],
    avoidEn: ['Accepting permissive URL-safe aliases.', 'The input is already bytes.', 'Silently ignoring invalid trailing data.'],
    avoidZh: ['接受 permissive URL-safe alias。', 'input 已经是 bytes。', '静默忽略 invalid trailing data。'],
    optionsEn: [{ name: 'text', description: 'Complete canonical Base64 string.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Decode at the text-to-binary boundary.', example: 'record.payload' }],
    optionsZh: [{ name: 'text', description: '完整 canonical Base64 string。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '在 text-to-binary boundary 解码。', example: 'record.payload' }]
  }),
  'serialize:core:streamBase64Chunks': createSerializeGuide({
    purposeEn: 'Synchronously yields Base64 text segments aligned to three-byte input groups, so a streaming sink never requires one complete Base64 string. Concatenating the chunks exactly matches bytesToBase64.',
    purposeZh: '同步产出按三字节 input group 对齐的 Base64 text segment，使 streaming sink 无需完整 Base64 string。拼接全部 chunk 与 bytesToBase64 完全一致。',
    quickStart: 'for (const chunk of streamBase64Chunks(bytes)) await upload.write(chunk)',
    scenariosEn: ['Chunked upload to a text sink.', 'Writing through a WritableStream.', 'Bounding temporary Base64 string allocation.'],
    scenariosZh: ['向 text sink 分块上传。', '通过 WritableStream 写入。', '约束临时 Base64 string allocation。'],
    avoidEn: ['The final result must be one string.', 'Backpressure requires asynchronous production from the byte source.', 'The sink accepts Uint8Array directly.'],
    avoidZh: ['最终结果必须是单个 string。', 'backpressure 要求 byte source asynchronous production。', 'sink 可直接接受 Uint8Array。'],
    optionsEn: [{ name: 'bytes', description: 'Complete byte view segmented without changing Base64 semantics.', defaultValue: 'required', optional: false, type: 'Uint8Array', whenToUse: 'Stream one already-available byte payload.', example: 'payloadBytes' }],
    optionsZh: [{ name: 'bytes', description: '在不改变 Base64 semantics 下分段的完整 byte view。', defaultValue: '必填', optional: false, type: 'Uint8Array', whenToUse: '流式写出一个已经 available 的 byte payload。', example: 'payloadBytes' }]
  }),
  'storage-contract:index:snapshotCodec': createStorageContractGuide({
    purposeEn: 'Reads a codec descriptor once, validates its non-empty name, output channel, encode, and decode functions, then returns the captured surface. Throwing accessors and malformed descriptors become INVALID_ARGUMENT with their cause retained.',
    purposeZh: '一次读取 codec descriptor，验证非空 name、output channel、encode 与 decode function，再返回 captured surface。throwing accessor 与 malformed descriptor 会成为 INVALID_ARGUMENT，并保留 cause。',
    quickStart: 'const stableCodec = snapshotCodec(candidateCodec)\nconst encoded = await stableCodec.encode(value)',
    scenariosEn: ['A codec crosses a plugin or configuration boundary.', 'Routing by output must not reread mutable getters.', 'Encoding and decoding must use one admitted descriptor.'],
    scenariosZh: ['codec 穿过 plugin 或 configuration boundary。', '按 output routing 时不得重复读取 mutable getter。', 'encode 与 decode 必须使用同一个 admitted descriptor。'],
    avoidEn: ['Only assertion narrowing is required.', 'The codec output type must be inferred from an encode result.', 'Accepting an unnamed or partially implemented codec.'],
    avoidZh: ['只需要 assertion narrowing。', '需要从 encode result 推断 codec output type。', '接受 unnamed 或 partially implemented codec。'],
    optionsEn: [{ name: 'codec', description: 'Unknown descriptor required to declare name, output, encode, and decode.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Admit a custom codec before routing data.', example: 'options.codec' }],
    optionsZh: [{ name: 'codec', description: '必须声明 name、output、encode 与 decode 的未知 descriptor。', defaultValue: '必填', optional: false, type: 'unknown', whenToUse: 'routing data 前接纳 custom codec。', example: 'options.codec' }]
  }),
  'storage-contract:index:assertCodec': createStorageContractGuide({
    purposeEn: 'Assertion form of the shared codec contract. It narrows an unknown value to ICodec while preserving the same one-read validation and INVALID_ARGUMENT semantics as snapshotCodec.',
    purposeZh: 'shared codec contract 的 assertion 形式。它把 unknown value 收窄为 ICodec，并保持与 snapshotCodec 相同的 one-read validation 与 INVALID_ARGUMENT semantics。',
    quickStart: 'assertCodec(options.codec)\nreturn installCodec(options.codec)',
    scenariosEn: ['A public API only needs entry validation.', 'TypeScript narrowing is useful after the guard.', 'Custom codecs must fail before registration.'],
    scenariosZh: ['public API 只需要 entry validation。', 'guard 后需要 TypeScript narrowing。', 'custom codec 必须在 registration 前失败。'],
    avoidEn: ['Later work needs a stable captured descriptor.', 'Validating encoded payloads.', 'Silently selecting a fallback codec.'],
    avoidZh: ['后续 work 需要稳定 captured descriptor。', '验证 encoded payload。', '静默选择 fallback codec。'],
    optionsEn: [{ name: 'codec', description: 'Unknown codec candidate.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Guard a public codec option.', example: 'options.codec' }],
    optionsZh: [{ name: 'codec', description: '未知 codec candidate。', defaultValue: '必填', optional: false, type: 'unknown', whenToUse: 'guard public codec option。', example: 'options.codec' }]
  }),
  'storage-contract:index:collectionsJsonCodec': createStorageContractGuide({
    purposeEn: 'Versioned text codec that preserves genuine Map and Set instances through JSON while leaving ordinary JSON values unchanged. It emits exact tagged tuples and only revives those exact tuples; malformed roots and payloads retain parser failures under INVALID_ARGUMENT.',
    purposeZh: 'versioned text codec：通过 JSON 保留 genuine Map/Set instance，同时不改变普通 JSON value。它只生成并恢复精确 tagged tuple；malformed root 与 payload 会在 INVALID_ARGUMENT 下保留 parser failure。',
    quickStart: "const text = await collectionsJsonCodec.encode({ roles: new Set(['admin']) })\nconst restored = await collectionsJsonCodec.decode(text)\nconsole.log(restored.roles instanceof Set)",
    scenariosEn: ['Persisting JSON-compatible state containing Map or Set.', 'A stable text wire format is required.', 'Legacy plain JSON must remain readable.'],
    scenariosZh: ['持久化包含 Map 或 Set 的 JSON-compatible state。', '需要稳定 text wire format。', 'legacy plain JSON 必须保持 readable。'],
    avoidEn: ['Values contain cycles, functions, or host objects.', 'Binary size or throughput is the primary requirement.', 'Domain schema validation or encryption is required.'],
    avoidZh: ['value 包含 cycle、function 或 host object。', 'binary size 或 throughput 是首要需求。', '需要 domain schema validation 或 encryption。']
  }),
  'storage-contract:index:COLLECTIONS_JSON_CODEC_NAME': createStorageContractGuide({
    purposeEn: 'Stable wire identifier migaia-collections-json-v1 used by collectionsJsonCodec and its exact Map/Set tuples. Consumers may compare it for diagnostics or registry selection but must not synthesize tagged payloads manually.',
    purposeZh: 'collectionsJsonCodec 及其精确 Map/Set tuple 使用的稳定 wire identifier：migaia-collections-json-v1。consumer 可用于 diagnostic 或 registry selection，但不应手工合成 tagged payload。',
    quickStart: 'codecRegistry.set(COLLECTIONS_JSON_CODEC_NAME, collectionsJsonCodec)',
    scenariosEn: ['Registering the canonical codec.', 'Displaying persisted-format diagnostics.', 'Asserting wire compatibility in tests.'],
    scenariosZh: ['注册 canonical codec。', '展示 persisted-format diagnostic。', '在测试中断言 wire compatibility。'],
    avoidEn: ['Creating a second codec with the same name.', 'Using the identifier as a storage key.', 'Hand-authoring collection wire tuples.'],
    avoidZh: ['创建同名的第二个 codec。', '把 identifier 当作 storage key。', '手工编写 collection wire tuple。']
  }),
  'storage-contract:index:ConflictPolicy': createStorageContractGuide({
    purposeEn: 'Canonical runtime values for write conflict behavior. conflict rejects an incompatible existing revision; replace explicitly permits overwrite. Use the constant instead of copying protocol strings.',
    purposeZh: 'write conflict behavior 的 canonical runtime values。conflict 拒绝不兼容 existing revision；replace 显式允许 overwrite。应使用 constant，不要复制 protocol string。',
    quickStart: 'await records.putRecord(value, key, { conflictPolicy: ConflictPolicy.conflict })',
    scenariosEn: ['Configuring normal write options.', 'Sharing policy values across adapters.', 'Branching transaction commit behavior.'],
    scenariosZh: ['配置 normal write options。', '跨 adapter 共享 policy value。', '分支 transaction commit behavior。'],
    avoidEn: ['Representing a transaction lifecycle state.', 'Inventing backend-specific aliases.', 'Choosing replace as an implicit default.'],
    avoidZh: ['表示 transaction lifecycle state。', '发明 backend-specific alias。', '把 replace 作为隐式 default。']
  }),
  'storage-contract:index:StorageContractConflictPolicy': createStorageContractGuide({
    purposeEn: 'Compatibility-facing conflict-policy constant with the same conflict and replace values as ConflictPolicy. Prefer ConflictPolicy in new operation code; retain this export where a public boundary explicitly names the Storage Contract domain.',
    purposeZh: '面向 compatibility 的 conflict-policy constant，与 ConflictPolicy 具有相同 conflict/replace value。新 operation code 优先使用 ConflictPolicy；仅在 public boundary 明确命名 Storage Contract domain 时保留此 export。',
    quickStart: 'const policy = StorageContractConflictPolicy.conflict\nregisterStoragePolicy(policy)',
    scenariosEn: ['A public integration contract already references this named export.', 'Generated metadata needs the domain-qualified constant.', 'Compatibility tests verify the shared values.'],
    scenariosZh: ['public integration contract 已引用该 named export。', 'generated metadata 需要 domain-qualified constant。', 'compatibility test 验证 shared value。'],
    avoidEn: ['New internal operation code can use ConflictPolicy.', 'Treating the two constants as different policy domains.', 'Adding another alias.'],
    avoidZh: ['新 internal operation code 可以使用 ConflictPolicy。', '把两个 constant 当成不同 policy domain。', '继续增加 alias。']
  }),
  'storage-contract:index:intrinsicConstructorName': createStorageContractGuide({
    purposeEn: 'Best-effort diagnostic helper that reads an object prototype constructor name and returns undefined when access fails. Because prototype, constructor, and name are mutable, the result must never drive security, protocol, or capability decisions.',
    purposeZh: 'best-effort diagnostic helper：读取 object prototype constructor name，访问失败时返回 undefined。由于 prototype、constructor 与 name 都可 mutation，该结果绝不能驱动 security、protocol 或 capability decision。',
    quickStart: 'report({ receivedType: intrinsicConstructorName(value) ?? typeof value })',
    scenariosEn: ['Improving an invalid-value diagnostic.', 'Logging an unexpected cross-realm object.', 'Adding non-authoritative debug metadata.'],
    scenariosZh: ['改善 invalid-value diagnostic。', '记录 unexpected cross-realm object。', '增加 non-authoritative debug metadata。'],
    avoidEn: ['Detecting ArrayBuffer or Uint8Array.', 'Authorizing a value by class name.', 'Selecting serialization or storage behavior.'],
    avoidZh: ['检测 ArrayBuffer 或 Uint8Array。', '按 class name 授权 value。', '选择 serialization 或 storage behavior。'],
    optionsEn: [{ name: 'value', description: 'Unknown value inspected only for diagnostic metadata.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Enrich a contained error report.', example: 'unexpectedValue' }],
    optionsZh: [{ name: 'value', description: '仅为 diagnostic metadata 检查的未知值。', defaultValue: '必填', optional: false, type: 'unknown', whenToUse: '增强 contained error report。', example: 'unexpectedValue' }]
  }),
  'storage-contract:index:STORAGE_CONTRACT_SOURCE': createStorageContractGuide({
    purposeEn: 'Canonical library source stamped on every StorageContractError. Combine it with code for machine routing; never copy the literal or use source alone to identify a specific failure.',
    purposeZh: '每个 StorageContractError 上的 canonical library source。应与 code 组合进行 machine routing；不要复制 literal，也不要只用 source 识别具体 failure。',
    quickStart: 'if (error.source === STORAGE_CONTRACT_SOURCE && error.code === StorageContractErrorCode.unsupported) useFallback()',
    scenariosEn: ['A shared reporter routes library failures.', 'An RPC boundary serializes source and code.', 'Tests assert stable public error identity.'],
    scenariosZh: ['shared reporter 路由 library failure。', 'RPC boundary serialize source 与 code。', '测试断言稳定 public error identity。'],
    avoidEn: ['Selecting an individual failure without code.', 'Replacing instanceof checks inside one realm.', 'Embedding the string literal in consumers.'],
    avoidZh: ['不结合 code 就选择具体 failure。', '替代 same-realm instanceof check。', '在 consumer 中嵌入 string literal。']
  }),
  'storage-contract:index:StorageContractError': createStorageContractGuide({
    purposeEn: 'Native Error subclass for storage-boundary contract failures. It freezes stable source, semantic code, optional backend/key context, and the original cause without rewriting either stack.',
    purposeZh: 'storage-boundary contract failure 使用的 native Error subclass。它冻结稳定 source、semantic code、optional backend/key context 与 original cause，同时不重写任一 stack。',
    quickStart: 'throw new StorageContractError(StorageContractErrorCode.unsupported, { backend: storage.backend })',
    scenariosEn: ['A public storage boundary rejects unsupported capability.', 'Invalid input needs stable machine identity.', 'A lower-level accessor or parser failure must remain reachable.'],
    scenariosZh: ['public storage boundary 拒绝 unsupported capability。', 'invalid input 需要稳定 machine identity。', 'lower-level accessor 或 parser failure 必须保持 reachable。'],
    avoidEn: ['Representing normal availability or readiness state.', 'Wrapping an error that already has correct ownership.', 'Dropping the original cause or replacing its stack.'],
    avoidZh: ['表示正常 availability 或 readiness state。', '包装已经具有正确 ownership 的 error。', '丢弃 original cause 或替换其 stack。'],
    optionsEn: [
      { name: 'code', description: 'Registered semantic condition from StorageContractErrorCode.', defaultValue: 'required', optional: false, type: 'IStorageContractErrorCode', whenToUse: 'Select the exact observed contract failure.', example: 'StorageContractErrorCode.invalidKey' },
      { name: 'details.backend', description: 'Optional backend involved in the failed operation.', defaultValue: 'undefined', type: 'IBackendKind', whenToUse: 'Attribute adapter-specific input or capability failure.', example: 'storage.backend' },
      { name: 'details.key', description: 'Optional offending string or structured key.', defaultValue: 'undefined', type: 'string | IStorageKey', whenToUse: 'Expose which key failed validation or access.', example: 'key' },
      { name: 'details.cause', description: 'Original lower-level failure retained by identity.', defaultValue: 'undefined', type: 'unknown', whenToUse: 'Wrap an accessor, parser, or native validation failure.', example: 'cause' },
      { name: 'message', description: 'Optional human-readable context; source and code remain the machine contract.', defaultValue: '`[storage-contract] ${code}`', type: 'string', whenToUse: 'Add operation-specific context without changing identity.', example: "'Record keys are unsupported by this backend'" }
    ],
    optionsZh: [
      { name: 'code', description: '来自 StorageContractErrorCode 的 registered semantic condition。', defaultValue: '必填', optional: false, type: 'IStorageContractErrorCode', whenToUse: '选择与实际 contract failure 对应的 code。', example: 'StorageContractErrorCode.invalidKey' },
      { name: 'details.backend', description: '参与 failed operation 的 optional backend。', defaultValue: 'undefined', type: 'IBackendKind', whenToUse: '归因 adapter-specific input 或 capability failure。', example: 'storage.backend' },
      { name: 'details.key', description: 'optional offending string 或 structured key。', defaultValue: 'undefined', type: 'string | IStorageKey', whenToUse: '暴露 validation 或 access 失败的 key。', example: 'key' },
      { name: 'details.cause', description: '按 identity 保留的 original lower-level failure。', defaultValue: 'undefined', type: 'unknown', whenToUse: '包装 accessor、parser 或 native validation failure。', example: 'cause' },
      { name: 'message', description: 'optional human-readable context；source 与 code 仍是 machine contract。', defaultValue: '`[storage-contract] ${code}`', type: 'string', whenToUse: '增加 operation-specific context 而不改变 identity。', example: "'Record keys are unsupported by this backend'" }
    ]
  }),
  'storage-contract:index:isStorageContractError': createStorageContractGuide({
    purposeEn: 'Same-realm instanceof guard for StorageContractError. It narrows access to source, code, backend, and key; serialized or cross-realm failures must instead be validated by their transferred error contract.',
    purposeZh: 'StorageContractError 的 same-realm instanceof guard。它收窄 source、code、backend 与 key；serialized 或 cross-realm failure 应改为验证 transferred error contract。',
    quickStart: 'catch (error) {\n  if (isStorageContractError(error) && error.code === StorageContractErrorCode.unsupported) return fallback\n  throw error\n}',
    scenariosEn: ['Handling a known contract failure in the same realm.', 'Reading backend or key diagnostics safely.', 'Rethrowing all unrelated failures unchanged.'],
    scenariosZh: ['在 same realm 处理 known contract failure。', '安全读取 backend 或 key diagnostic。', '原样 rethrow 全部 unrelated failure。'],
    avoidEn: ['Checking an error received over RPC or persistence.', 'Matching only by message text.', 'Swallowing every StorageContractError regardless of code.'],
    avoidZh: ['检查通过 RPC 或 persistence 收到的 error。', '只按 message text 匹配。', '不看 code 就吞掉所有 StorageContractError。'],
    optionsEn: [{ name: 'value', description: 'Unknown caught value tested by native class identity.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Narrow a same-realm catch value.', example: 'error' }],
    optionsZh: [{ name: 'value', description: '按 native class identity 测试的未知 caught value。', defaultValue: '必填', optional: false, type: 'unknown', whenToUse: '收窄 same-realm catch value。', example: 'error' }]
  }),
  'storage-contract:index:snapshotOperationContext': createStorageContractGuide({
    purposeEn: 'Reads cancellation, timeout, page size, and conflict policy once, validates their bounds, and freezes a reusable operation snapshot. Reusing a snapshot does not touch caller getters again.',
    purposeZh: '一次读取 cancellation、timeout、page size 与 conflict policy，验证边界并冻结可复用 operation snapshot。再次传入该 snapshot 时不会重复访问 caller getter。',
    quickStart: 'const ctx = snapshotOperationContext({ signal, timeoutMs: 2_000, pageSize: 128 })\nawait storage.keys(ctx)',
    scenariosEn: ['An asynchronous operation crosses several internal layers.', 'Hostile or mutable option getters must be observed once.', 'Pagination and cancellation need one validated context.'],
    scenariosZh: ['asynchronous operation 会穿过多个内部 layer。', 'hostile 或 mutable option getter 必须只观察一次。', 'pagination 与 cancellation 需要同一个 validated context。'],
    avoidEn: ['A synchronous write is being configured; use snapshotSyncWriteOptions.', 'The backend-specific layer wants to reinterpret these bounds.', 'You need to mutate options during an in-flight operation.'],
    avoidZh: ['正在配置 synchronous write；使用 snapshotSyncWriteOptions。', 'backend-specific layer 试图重新解释这些边界。', '需要在 in-flight operation 中 mutation options。'],
    optionsEn: [
      { name: 'ctx.signal', description: 'Structural abort signal observed cooperatively by asynchronous storage work.', defaultValue: 'undefined', type: 'IAbortSignal', whenToUse: 'Cancel an operation when its caller or owner is disposed.', example: 'controller.signal' },
      { name: 'ctx.timeoutMs', description: 'Non-negative safe-integer deadline convenience value.', defaultValue: 'undefined', type: 'number', whenToUse: 'Bound one operation independently of external cancellation.', example: '2_000' },
      { name: 'ctx.pageSize', description: 'Iterator page size between 1 and 4096.', defaultValue: 'undefined', type: 'number', whenToUse: 'Balance cursor round trips against bounded memory.', example: '128' },
      { name: 'ctx.conflictPolicy', description: 'Write conflict behavior accepted by operations that support it.', defaultValue: 'undefined', type: "'conflict' | 'replace'", whenToUse: 'Choose explicit optimistic failure or replacement.', example: 'ConflictPolicy.conflict' }
    ],
    optionsZh: [
      { name: 'ctx.signal', description: 'asynchronous storage work 协作观察的结构化 abort signal。', defaultValue: 'undefined', type: 'IAbortSignal', whenToUse: 'caller 或 owner dispose 时取消 operation。', example: 'controller.signal' },
      { name: 'ctx.timeoutMs', description: '非负 safe integer 的便捷 deadline。', defaultValue: 'undefined', type: 'number', whenToUse: '独立于 external cancellation 约束一次 operation。', example: '2_000' },
      { name: 'ctx.pageSize', description: '1 到 4096 的 iterator page size。', defaultValue: 'undefined', type: 'number', whenToUse: '在 cursor round trip 与 bounded memory 之间平衡。', example: '128' },
      { name: 'ctx.conflictPolicy', description: '支持该字段的 write operation 所使用的 conflict behavior。', defaultValue: 'undefined', type: "'conflict' | 'replace'", whenToUse: '显式选择 optimistic failure 或 replacement。', example: 'ConflictPolicy.conflict' }
    ]
  }),
  'storage-contract:index:assertOperationContext': createStorageContractGuide({
    purposeEn: 'Validates the asynchronous operation context without returning its snapshot. Invalid signals, timeouts, page sizes, policies, or throwing accessors become INVALID_ARGUMENT with the original cause retained.',
    purposeZh: '验证 asynchronous operation context，但不返回 snapshot。无效 signal、timeout、page size、policy 或 throwing accessor 会成为 INVALID_ARGUMENT，并保留 original cause。',
    quickStart: 'assertOperationContext(options)\nreturn runBackendOperation(options)',
    scenariosEn: ['A public method validates before allocating backend resources.', 'A wrapper already owns subsequent snapshotting.', 'Tests assert rejection at the library boundary.'],
    scenariosZh: ['public method 在分配 backend resource 前验证。', 'wrapper 已拥有后续 snapshot。', '测试断言 library boundary 的 rejection。'],
    avoidEn: ['Later layers need the stable snapshot.', 'The operation is synchronous.', 'Silently coercing invalid numbers or policies.'],
    avoidZh: ['后续 layer 需要稳定 snapshot。', 'operation 是 synchronous。', '试图静默 coercion 无效 number 或 policy。'],
    optionsEn: [{ name: 'ctx', description: 'Optional asynchronous operation context to validate.', defaultValue: 'undefined', type: 'IOperationContext', whenToUse: 'Guard a public async storage method at entry.', example: '{ signal, timeoutMs: 1_000 }' }],
    optionsZh: [{ name: 'ctx', description: '待验证的 optional asynchronous operation context。', defaultValue: 'undefined', type: 'IOperationContext', whenToUse: '在 public async storage method 入口 guard。', example: '{ signal, timeoutMs: 1_000 }' }]
  }),
  'storage-contract:index:snapshotSyncWriteOptions': createStorageContractGuide({
    purposeEn: 'Validates the reduced synchronous-write contract and returns only conflictPolicy. signal and timeoutMs are rejected because a synchronous channel cannot honor cancellation after execution begins.',
    purposeZh: '验证精简的 synchronous-write contract，并只返回 conflictPolicy。signal 与 timeoutMs 会被拒绝，因为同步通道在执行开始后无法兑现 cancellation。',
    quickStart: 'const options = snapshotSyncWriteOptions({ conflictPolicy: ConflictPolicy.replace })\nstorage.sync.set(\'theme\', \'dark\', options)',
    scenariosEn: ['A synchronous adapter snapshots write policy.', 'One validation path is shared by local, session, cookie, and memory stores.', 'Async-only controls must be rejected rather than ignored.'],
    scenariosZh: ['synchronous adapter snapshot write policy。', 'local、session、cookie 与 memory store 共享同一 validation path。', 'async-only control 必须拒绝而不是忽略。'],
    avoidEn: ['The operation is asynchronous.', 'Cancellation or deadlines are required.', 'The caller wants backend-specific policy strings.'],
    avoidZh: ['operation 是 asynchronous。', '需要 cancellation 或 deadline。', 'caller 想传 backend-specific policy string。'],
    optionsEn: [{ name: 'options.conflictPolicy', description: 'Conflict behavior for a synchronous write.', defaultValue: 'undefined', type: "'conflict' | 'replace'", whenToUse: 'Choose whether an existing value rejects or is replaced.', example: 'ConflictPolicy.replace' }],
    optionsZh: [{ name: 'options.conflictPolicy', description: 'synchronous write 的 conflict behavior。', defaultValue: 'undefined', type: "'conflict' | 'replace'", whenToUse: '选择 existing value 导致 rejection 或被 replacement。', example: 'ConflictPolicy.replace' }]
  }),
  'storage-contract:index:assertSyncWriteOptions': createStorageContractGuide({
    purposeEn: 'Assertion-only form of synchronous write validation. It rejects cancellation fields and unknown conflict policies before the backend mutates storage.',
    purposeZh: 'synchronous write validation 的 assertion-only 形式。在 backend mutation storage 前拒绝 cancellation field 与未知 conflict policy。',
    quickStart: 'assertSyncWriteOptions(options)\nwriteSynchronously(key, value, options)',
    scenariosEn: ['A sync method only needs entry validation.', 'Mutation must not start after an invalid option.', 'Adapters share identical rejection semantics.'],
    scenariosZh: ['sync method 只需要入口 validation。', 'invalid option 后 mutation 不得开始。', '多个 adapter 共享相同 rejection semantics。'],
    avoidEn: ['The validated policy value is needed later.', 'The method can honor a signal.', 'Invalid fields should be silently dropped.'],
    avoidZh: ['后续需要 validated policy value。', 'method 能兑现 signal。', '希望静默丢弃 invalid field。'],
    optionsEn: [{ name: 'options', description: 'Optional reduced write options object.', defaultValue: 'undefined', type: 'ISyncWriteOptions', whenToUse: 'Validate immediately before a synchronous mutation.', example: '{ conflictPolicy: ConflictPolicy.conflict }' }],
    optionsZh: [{ name: 'options', description: 'optional reduced write options object。', defaultValue: 'undefined', type: 'ISyncWriteOptions', whenToUse: 'synchronous mutation 前立即验证。', example: '{ conflictPolicy: ConflictPolicy.conflict }' }]
  }),
  'storage-contract:index:assertStringStorageKey': createStorageContractGuide({
    purposeEn: 'Requires a string key for the L0 text, byte, and metadata channels. Failure is tagged INVALID_KEY with backend, offending key, and a TypeError cause.',
    purposeZh: '要求 L0 text、byte 与 metadata channel 使用 string key。失败会标记 INVALID_KEY，并携带 backend、offending key 与 TypeError cause。',
    quickStart: "assertStringStorageKey(key, storage.backend, 'cache key')\nawait storage.get(key)",
    scenariosEn: ['Guarding text-store keys.', 'Validating metadata names.', 'Giving a domain label to an invalid-key diagnostic.'],
    scenariosZh: ['guard text-store key。', '验证 metadata name。', '给 invalid-key diagnostic 提供 domain label。'],
    avoidEn: ['The record channel accepts structured keys.', 'Empty strings are forbidden by a higher-level domain.', 'Coercing numbers to strings implicitly.'],
    avoidZh: ['record channel 接受 structured key。', 'higher-level domain 禁止 empty string。', '试图隐式把 number coercion 为 string。'],
    optionsEn: [
      { name: 'value', description: 'Unknown candidate that must be a string.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Guard an L0 or metadata key.', example: 'input.key' },
      { name: 'backend', description: 'Backend identity attached to contract failures.', defaultValue: 'required', optional: false, type: 'IBackendKind', whenToUse: 'Use the backend receiving the key.', example: 'storage.backend' },
      { name: 'label', description: 'Human diagnostic label for the key domain.', defaultValue: "'key'", type: 'string', whenToUse: 'Differentiate metadata, cache, or namespace keys.', example: "'metadata key'" }
    ],
    optionsZh: [
      { name: 'value', description: '必须为 string 的未知候选值。', defaultValue: '必填', optional: false, type: 'unknown', whenToUse: 'guard L0 或 metadata key。', example: 'input.key' },
      { name: 'backend', description: '附加到 contract failure 的 backend identity。', defaultValue: '必填', optional: false, type: 'IBackendKind', whenToUse: '传入接收该 key 的 backend。', example: 'storage.backend' },
      { name: 'label', description: 'key domain 的 human diagnostic label。', defaultValue: "'key'", type: 'string', whenToUse: '区分 metadata、cache 或 namespace key。', example: "'metadata key'" }
    ]
  }),
  'storage-contract:index:assertStorageKey': createStorageContractGuide({
    purposeEn: 'Validates the structured record-key domain: finite numbers, strings, valid Dates, bounded ArrayBuffers, or non-empty acyclic arrays of those values. Depth, node count, and binary size are bounded by KEY_DOMAIN_LIMITS.',
    purposeZh: '验证 structured record-key domain：finite number、string、有效 Date、bounded ArrayBuffer，或由这些值构成的非空无环 array。depth、node count 与 binary size 受 KEY_DOMAIN_LIMITS 约束。',
    quickStart: 'assertStorageKey([tenantId, new Date(day)], storage.backend)\nawait records.getRecord([tenantId, new Date(day)])',
    scenariosEn: ['Validating an IndexedDB-compatible record key.', 'Rejecting cyclic or sparse compound keys.', 'Bounding attacker-controlled persisted key structures.'],
    scenariosZh: ['验证 IndexedDB-compatible record key。', '拒绝 cyclic 或 sparse compound key。', '约束 attacker-controlled persisted key structure。'],
    avoidEn: ['The channel only accepts strings.', 'A domain needs stricter semantic rules such as non-empty strings.', 'Using arbitrary objects as keys.'],
    avoidZh: ['channel 只接受 string。', 'domain 需要 non-empty string 等更严格 semantic rule。', '使用 arbitrary object 作为 key。'],
    optionsEn: [
      { name: 'value', description: 'Unknown structured-key candidate.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Guard before record access.', example: '[tenantId, createdAt]' },
      { name: 'backend', description: 'Backend identity retained on INVALID_KEY.', defaultValue: 'required', optional: false, type: 'IBackendKind', whenToUse: 'Attribute the boundary failure.', example: 'storage.backend' },
      { name: 'label', description: 'Human label included in the TypeError cause.', defaultValue: "'key'", type: 'string', whenToUse: 'Name a primary, lower, or upper range key.', example: "'lower key'" }
    ],
    optionsZh: [
      { name: 'value', description: '未知 structured-key candidate。', defaultValue: '必填', optional: false, type: 'unknown', whenToUse: 'record access 前 guard。', example: '[tenantId, createdAt]' },
      { name: 'backend', description: '保留在 INVALID_KEY 上的 backend identity。', defaultValue: '必填', optional: false, type: 'IBackendKind', whenToUse: '归因 boundary failure。', example: 'storage.backend' },
      { name: 'label', description: '包含在 TypeError cause 中的 human label。', defaultValue: "'key'", type: 'string', whenToUse: '命名 primary、lower 或 upper range key。', example: "'lower key'" }
    ]
  }),
  'storage-contract:index:snapshotStorageKey': createStorageContractGuide({
    purposeEn: 'Validates and detaches a structured key so later asynchronous work cannot observe caller mutation. Compound arrays and Dates are copied; ArrayBuffers are normalized through the cross-realm key classifier.',
    purposeZh: '验证并 detach structured key，使后续 asynchronous work 无法观察 caller mutation。compound array 与 Date 会复制；ArrayBuffer 通过 cross-realm key classifier 规范化。',
    quickStart: 'const stableKey = snapshotStorageKey([tenantId, cursor], storage.backend)\nqueueMicrotask(() => records.getRecord(stableKey))',
    scenariosEn: ['A key crosses an async scheduling boundary.', 'Caller-owned compound arrays may mutate.', 'Queued work needs validation and ownership transfer together.'],
    scenariosZh: ['key 会跨越 async scheduling boundary。', 'caller-owned compound array 可能 mutation。', 'queued work 同时需要 validation 与 ownership transfer。'],
    avoidEn: ['The key is consumed synchronously and cannot change.', 'The value is not in the storage-key domain.', 'Cloning arbitrary record values.'],
    avoidZh: ['key 同步消费且不会变化。', 'value 不属于 storage-key domain。', 'clone arbitrary record value。'],
    optionsEn: [
      { name: 'value', description: 'Unknown key to validate and detach.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Capture before queuing async work.', example: '[tenantId, cursor]' },
      { name: 'backend', description: 'Backend identity used for failures.', defaultValue: 'required', optional: false, type: 'IBackendKind', whenToUse: 'Attribute invalid input to its target backend.', example: 'storage.backend' },
      { name: 'label', description: 'Human diagnostic label.', defaultValue: "'key'", type: 'string', whenToUse: 'Clarify which key field failed.', example: "'record key'" }
    ],
    optionsZh: [
      { name: 'value', description: '待验证并 detach 的未知 key。', defaultValue: '必填', optional: false, type: 'unknown', whenToUse: 'queue async work 前捕获。', example: '[tenantId, cursor]' },
      { name: 'backend', description: 'failure 使用的 backend identity。', defaultValue: '必填', optional: false, type: 'IBackendKind', whenToUse: '把 invalid input 归因到目标 backend。', example: 'storage.backend' },
      { name: 'label', description: 'human diagnostic label。', defaultValue: "'key'", type: 'string', whenToUse: '说明哪个 key field 失败。', example: "'record key'" }
    ]
  }),
  'storage-contract:index:compareStorageKeys': createStorageContractGuide({
    purposeEn: 'Provides the canonical total ordering for valid storage keys: number, Date, string, ArrayBuffer, then compound array, with lexicographic comparison inside each domain. It matches validation and cross-realm classification.',
    purposeZh: '提供 valid storage key 的 canonical total ordering：number、Date、string、ArrayBuffer、compound array；每个 domain 内按 lexicographic rule 比较，并与 validation/cross-realm classification 一致。',
    quickStart: 'const ordered = keys.toSorted(compareStorageKeys)\nconst first = ordered.at(0)',
    scenariosEn: ['Producing deterministic snapshots.', 'Sorting mixed valid key domains.', 'Implementing range behavior consistently across in-memory and persistent backends.'],
    scenariosZh: ['生成 deterministic snapshot。', '排序 mixed valid key domain。', '让 in-memory 与 persistent backend 的 range behavior 一致。'],
    avoidEn: ['Inputs have not passed key validation.', 'Locale-aware string ordering is required.', 'Business ordering differs from storage ordering.'],
    avoidZh: ['input 尚未通过 key validation。', '需要 locale-aware string ordering。', 'business ordering 与 storage ordering 不同。'],
    optionsEn: [
      { name: 'a', description: 'First already-valid storage key.', defaultValue: 'required', optional: false, type: 'IStorageKey', whenToUse: 'Pass directly from a sort comparator.', example: 'leftKey' },
      { name: 'b', description: 'Second already-valid storage key.', defaultValue: 'required', optional: false, type: 'IStorageKey', whenToUse: 'Pass directly from a sort comparator.', example: 'rightKey' }
    ],
    optionsZh: [
      { name: 'a', description: '第一个已经 valid 的 storage key。', defaultValue: '必填', optional: false, type: 'IStorageKey', whenToUse: '从 sort comparator 直接传入。', example: 'leftKey' },
      { name: 'b', description: '第二个已经 valid 的 storage key。', defaultValue: '必填', optional: false, type: 'IStorageKey', whenToUse: '从 sort comparator 直接传入。', example: 'rightKey' }
    ]
  }),
  'storage-contract:index:KEY_DOMAIN_LIMITS': createStorageContractGuide({
    purposeEn: 'Publishes the hard safety bounds used while validating compound storage keys: 32 levels, 4096 visited nodes, and 1 MiB per binary key component. These are contract limits, not tuning controls.',
    purposeZh: '公开 compound storage key validation 使用的 hard safety bound：32 层、4096 个 visited node、每个 binary key component 1 MiB。这些是 contract limit，不是 tuning control。',
    quickStart: 'if (bytes.byteLength > KEY_DOMAIN_LIMITS.maxBinaryBytes) showKeyTooLarge()',
    scenariosEn: ['Preflight UI mirrors the runtime bound.', 'Diagnostics explain why a key was rejected.', 'Tests construct exact boundary cases.'],
    scenariosZh: ['preflight UI 镜像 runtime bound。', 'diagnostic 解释 key 被拒原因。', '测试构造准确 boundary case。'],
    avoidEn: ['Changing limits per backend.', 'Treating limits as mutable configuration.', 'Using them as general payload-size limits.'],
    avoidZh: ['按 backend 修改 limit。', '把 limit 当作 mutable configuration。', '把它作为通用 payload-size limit。']
  }),
  'storage-contract:index:assertTransactionCallback': createStorageContractGuide({
    purposeEn: 'Checks that a transaction entry callback is callable before a backend allocates snapshot, connection, or lock state. Invalid input becomes INVALID_ARGUMENT attributed to the selected backend.',
    purposeZh: '在 backend 分配 snapshot、connection 或 lock state 前，检查 transaction entry callback 是否 callable。无效 input 会成为归因于 selected backend 的 INVALID_ARGUMENT。',
    quickStart: 'assertTransactionCallback(run, storage.backend)\nreturn storage.transaction(run)',
    scenariosEn: ['A transaction method guards before resource allocation.', 'Memory and IndexedDB engines share the same failure contract.', 'A dynamic callback crosses a public boundary.'],
    scenariosZh: ['transaction method 在 resource allocation 前 guard。', 'memory 与 IndexedDB engine 共享相同 failure contract。', 'dynamic callback 穿过 public boundary。'],
    avoidEn: ['Invoking the callback to test its behavior.', 'Validating the transaction result.', 'Wrapping a backend failure after execution starts.'],
    avoidZh: ['调用 callback 来测试 behavior。', '验证 transaction result。', 'execution 开始后包装 backend failure。'],
    optionsEn: [
      { name: 'run', description: 'Unknown value required to be a function.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Guard the public transaction entry.', example: 'input.run' },
      { name: 'backend', description: 'Backend identity recorded on validation failure.', defaultValue: 'required', optional: false, type: 'IBackendKind', whenToUse: 'Attribute the rejected transaction.', example: 'storage.backend' }
    ],
    optionsZh: [
      { name: 'run', description: '必须是 function 的未知值。', defaultValue: '必填', optional: false, type: 'unknown', whenToUse: 'guard public transaction entry。', example: 'input.run' },
      { name: 'backend', description: '记录在 validation failure 上的 backend identity。', defaultValue: '必填', optional: false, type: 'IBackendKind', whenToUse: '归因 rejected transaction。', example: 'storage.backend' }
    ]
  }),
  'storage-contract:index:readTransactionConflictPolicy': createStorageContractGuide({
    purposeEn: 'Reads transaction write options once and returns the normalized conflict policy. Omitted options and policy default to conflict; only explicit replace changes overwrite behavior.',
    purposeZh: '一次读取 transaction write options 并返回 normalized conflict policy。省略 options 或 policy 时默认 conflict；只有显式 replace 才改变 overwrite behavior。',
    quickStart: 'const policy = readTransactionConflictPolicy(options, storage.backend)\nif (policy === ConflictPolicy.conflict) assertRevision(current)',
    scenariosEn: ['A transaction engine selects conflict handling once.', 'A hostile policy getter must preserve its cause.', 'Memory and IndexedDB commits need identical defaults.'],
    scenariosZh: ['transaction engine 一次选择 conflict handling。', 'hostile policy getter 必须保留 cause。', 'memory 与 IndexedDB commit 需要相同 default。'],
    avoidEn: ['Reading general operation context fields.', 'Accepting backend-specific policy aliases.', 'Changing the default from conflict implicitly.'],
    avoidZh: ['读取 general operation context field。', '接受 backend-specific policy alias。', '隐式改变 conflict default。'],
    optionsEn: [
      { name: 'options.conflictPolicy', description: 'Optional transaction write policy; conflict preserves optimistic exclusion and replace permits overwrite.', defaultValue: "'conflict'", type: "'conflict' | 'replace'", whenToUse: 'Set replace only when overwrite is an intentional domain decision.', example: 'ConflictPolicy.replace' },
      { name: 'backend', description: 'Backend identity attached to invalid-option errors.', defaultValue: 'required', optional: false, type: 'IBackendKind', whenToUse: 'Attribute the rejected transaction option.', example: 'storage.backend' }
    ],
    optionsZh: [
      { name: 'options.conflictPolicy', description: 'optional transaction write policy；conflict 保留 optimistic exclusion，replace 允许 overwrite。', defaultValue: "'conflict'", type: "'conflict' | 'replace'", whenToUse: '只有 overwrite 是明确 domain decision 时才设为 replace。', example: 'ConflictPolicy.replace' },
      { name: 'backend', description: '附加到 invalid-option error 的 backend identity。', defaultValue: '必填', optional: false, type: 'IBackendKind', whenToUse: '归因 rejected transaction option。', example: 'storage.backend' }
    ]
  }),
  'storage-contract:index:snapshotStorageCapabilities': createStorageContractGuide({
    purposeEn: 'Reads a backend capability descriptor exactly once and returns a detached fact object. Invalid shapes and hostile getters produce undefined instead of escaping an exception, so feature routing can fail closed.',
    purposeZh: '只读取一次 backend capability descriptor，并返回独立的事实对象。无效 shape 或 hostile getter 返回 undefined，不让异常逃逸，使 feature routing 可以 fail closed。',
    quickStart: "const capabilities = snapshotStorageCapabilities(candidate.capabilities)\nif (!capabilities?.transactions) useNonTransactionalPath()",
    scenariosEn: ['Routing work before touching an optional backend channel.', 'Admitting a plugin-supplied capability object.', 'Normalizing legacy descriptors whose secondaryIndexes or changeFeed fields are absent.'],
    scenariosZh: ['接触 optional backend channel 前决定执行路径。', '接纳 plugin 提供的 capability object。', '规范化缺少 secondaryIndexes 或 changeFeed 字段的 legacy descriptor。'],
    avoidEn: ['You need the getter failure as a cause; use the internal detailed inspection at the owning boundary.', 'You already hold a trusted immutable snapshot.', 'You want to infer support from method presence alone.'],
    avoidZh: ['需要保留 getter failure 作为 cause；应在 owning boundary 使用内部 detailed inspection。', '已经持有可信 immutable snapshot。', '试图只按 method presence 推断 capability。'],
    optionsEn: [{ name: 'value', description: 'Unknown descriptor whose boolean flags and optional byte limit are read once.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Pass the untrusted value at the capability boundary.', example: 'candidate.capabilities' }],
    optionsZh: [{ name: 'value', description: '会被一次性读取 boolean flag 与 optional byte limit 的未知 descriptor。', defaultValue: '必填', optional: false, type: 'unknown', whenToUse: '在 capability boundary 传入 untrusted value。', example: 'candidate.capabilities' }]
  }),
  'storage-contract:index:isStorageCapabilities': createStorageContractGuide({
    purposeEn: 'Boolean type guard for the complete storage capability contract. It validates every required flag, bounds maxValueBytes, and treats missing legacy secondaryIndexes and changeFeed fields as false.',
    purposeZh: '完整 storage capability contract 的 boolean type guard。它验证全部 required flag、约束 maxValueBytes，并把 legacy descriptor 缺失的 secondaryIndexes 与 changeFeed 视为 false。',
    quickStart: 'if (!isStorageCapabilities(value)) throw new TypeError(\'Invalid capabilities\')\nif (value.binary) enableByteCodec()',
    scenariosEn: ['A branch only needs valid/invalid narrowing.', 'A public adapter validates capabilities before exposing itself.', 'A test fixture must satisfy the same runtime shape as production.'],
    scenariosZh: ['分支只需要 valid/invalid narrowing。', 'public adapter 在暴露自身前验证 capabilities。', 'test fixture 必须满足与 production 相同的 runtime shape。'],
    avoidEn: ['The caller must distinguish malformed data from a throwing getter.', 'Validation failure needs a public StorageContractError.', 'Checking whether a store implements its required methods.'],
    avoidZh: ['caller 必须区分 malformed data 与 throwing getter。', 'validation failure 需要公开 StorageContractError。', '检查 store 是否实现 required method。'],
    optionsEn: [{ name: 'value', description: 'Candidate capability descriptor.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Narrow an external or dynamically supplied value.', example: 'backend.capabilities' }],
    optionsZh: [{ name: 'value', description: '候选 capability descriptor。', defaultValue: '必填', optional: false, type: 'unknown', whenToUse: '收窄 external 或 dynamically supplied value。', example: 'backend.capabilities' }]
  }),
  'storage-contract:index:snapshotKeyValueStoreDetailed': createStorageContractGuide({
    purposeEn: 'Performs one-read admission for the complete base key-value store surface. Success returns the store, normalized backend and capabilities, plus the original dispose function and receiver; failure retains an accessor cause when one exists.',
    purposeZh: '对完整 base key-value store surface 执行 one-read admission。成功时返回 store、normalized backend/capabilities，以及原始 dispose function 与 receiver；失败时保留可用的 accessor cause。',
    quickStart: 'const admission = snapshotKeyValueStoreDetailed(candidate)\nif (!admission.valid) throw new Error(\'Store admission failed\', { cause: admission.cause })\nawait admission.dispose.call(admission.receiver)',
    scenariosEn: ['A lifecycle owner must capture callable identity once.', 'A failed hostile getter must remain diagnosable.', 'Installation must validate before registering cleanup.'],
    scenariosZh: ['lifecycle owner 必须一次捕获 callable identity。', 'hostile getter failure 必须保持可诊断。', 'installation 必须在注册 cleanup 前完成验证。'],
    avoidEn: ['A simple boolean guard is sufficient.', 'Record, secondary-index, or change-feed capability is required.', 'Calling the captured method with a different receiver.'],
    avoidZh: ['简单 boolean guard 已足够。', '需要 record、secondary-index 或 change-feed capability。', '用不同 receiver 调用 captured method。'],
    optionsEn: [{ name: 'store', description: 'Unknown value inspected as a complete L0 store without invoking backend operations.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Admit an externally constructed store.', example: 'pluginStore' }],
    optionsZh: [{ name: 'store', description: '按完整 L0 store 检查但不会调用 backend operation 的未知值。', defaultValue: '必填', optional: false, type: 'unknown', whenToUse: '接纳 externally constructed store。', example: 'pluginStore' }]
  }),
  'storage-contract:index:snapshotKeyValueStore': createStorageContractGuide({
    purposeEn: 'Returns a stable base-store snapshot containing the admitted store, backend kind, and capability facts. It avoids re-reading public accessors while composing higher-level capability checks.',
    purposeZh: '返回包含 admitted store、backend kind 与 capability facts 的稳定 base-store snapshot。在组合高阶 capability check 时避免重复读取 public accessor。',
    quickStart: 'const snapshot = snapshotKeyValueStore(candidate)\nif (!snapshot) return unsupported\nrouteByBackend(snapshot.backend, snapshot.store)',
    scenariosEn: ['Composing a change-feed or adapter guard.', 'Selecting a backend path after a single admission.', 'Avoiding time-of-check/time-of-use drift from mutable getters.'],
    scenariosZh: ['组合 change-feed 或 adapter guard。', 'single admission 后选择 backend path。', '避免 mutable getter 带来的 TOCTOU drift。'],
    avoidEn: ['The accessor cause must be reported.', 'You require record operations.', 'You intend to mutate the returned capability snapshot.'],
    avoidZh: ['必须报告 accessor cause。', '需要 record operation。', '准备 mutation 返回的 capability snapshot。'],
    optionsEn: [{ name: 'store', description: 'Unknown candidate for the complete base-store contract.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Capture facts before capability composition.', example: 'candidate' }],
    optionsZh: [{ name: 'store', description: '完整 base-store contract 的未知候选值。', defaultValue: '必填', optional: false, type: 'unknown', whenToUse: 'capability composition 前捕获事实。', example: 'candidate' }]
  }),
  'storage-contract:index:snapshotRecordStore': createStorageContractGuide({
    purposeEn: 'Admits the complete structured-record surface and requires records, binary, transactions, and iteration capabilities together. The snapshot is the safe starting point for record and secondary-index composition.',
    purposeZh: '接纳完整 structured-record surface，并同时要求 records、binary、transactions 与 iteration capability。该 snapshot 是组合 record 与 secondary-index 能力的安全起点。',
    quickStart: 'const snapshot = snapshotRecordStore<User>(candidate)\nif (!snapshot) return fallback\nconst user = await snapshot.store.getRecord(userId)',
    scenariosEn: ['An adapter requires all L1 record operations.', 'A secondary-index guard needs an admitted record base.', 'Capability flags and callable surface must agree.'],
    scenariosZh: ['adapter 需要全部 L1 record operation。', 'secondary-index guard 需要 admitted record base。', 'capability flag 与 callable surface 必须一致。'],
    avoidEn: ['Only string key-value operations are needed.', 'Missing record support should throw immediately; use asRecordStore.', 'The backend merely declares records without the full methods.'],
    avoidZh: ['只需要 string key-value operation。', '缺少 record support 时应立即 throw；使用 asRecordStore。', 'backend 只声明 records，却没有完整 methods。'],
    optionsEn: [{ name: 'store', description: 'Unknown candidate checked for L0 plus every record operation.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Narrow before record access.', example: 'storage' }],
    optionsZh: [{ name: 'store', description: '检查 L0 与全部 record operation 的未知候选值。', defaultValue: '必填', optional: false, type: 'unknown', whenToUse: 'record access 前收窄。', example: 'storage' }]
  }),
  'storage-contract:index:isKeyValueStore': createStorageContractGuide({
    purposeEn: 'Checks the complete L0 key-value store contract: known backend, valid capabilities, every string-channel method, and dispose. It never invokes a storage operation.',
    purposeZh: '检查完整 L0 key-value store contract：已知 backend、有效 capabilities、全部 string-channel method 与 dispose；不会调用任何 storage operation。',
    quickStart: 'if (!isKeyValueStore(candidate)) return rejectPlugin(candidate)\nawait candidate.set(\'theme\', \'dark\')',
    scenariosEn: ['A dynamic value must be narrowed before use.', 'Plugin installation rejects incomplete stores.', 'A capability probe must remain side-effect free.'],
    scenariosZh: ['dynamic value 使用前必须收窄。', 'plugin installation 拒绝 incomplete store。', 'capability probe 必须保持 side-effect free。'],
    avoidEn: ['You need the cause of a throwing getter.', 'You need record or index operations.', 'A nominal brand rather than structural admission is required.'],
    avoidZh: ['需要 throwing getter 的 cause。', '需要 record 或 index operation。', '需要 nominal brand 而不是 structural admission。'],
    optionsEn: [{ name: 'store', description: 'Unknown candidate for the base store surface.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Guard before the first store call.', example: 'candidate' }],
    optionsZh: [{ name: 'store', description: 'base store surface 的未知候选值。', defaultValue: '必填', optional: false, type: 'unknown', whenToUse: '首次调用 store 前 guard。', example: 'candidate' }]
  }),
  'storage-contract:index:asRecordStore': createStorageContractGuide({
    purposeEn: 'Requires a base store to expose the complete structured-record contract and returns it narrowed as IRecordStore. Incomplete capability flags or methods throw UNSUPPORTED before record work begins.',
    purposeZh: '要求 base store 暴露完整 structured-record contract，并将其收窄为 IRecordStore。capability flag 或 method 不完整时，在 record work 开始前抛出 UNSUPPORTED。',
    quickStart: 'const records = asRecordStore<User>(storage)\nawait records.putRecord({ id: userId, name: \'Ada\' }, userId)',
    scenariosEn: ['Record support is mandatory for the requested feature.', 'A public API should fail early instead of branching repeatedly.', 'The narrowed store is passed through a record-only workflow.'],
    scenariosZh: ['请求的 feature 强制需要 record support。', 'public API 应 early fail，而不是重复 branch。', 'narrowed store 会经过 record-only workflow。'],
    avoidEn: ['A fallback base-store path exists; use isRecordStore or snapshotRecordStore.', 'Only bytes are needed.', 'Treating UNSUPPORTED as a backend outage.'],
    avoidZh: ['存在 fallback base-store path；使用 isRecordStore 或 snapshotRecordStore。', '只需要 bytes。', '把 UNSUPPORTED 当成 backend outage。'],
    optionsEn: [{ name: 'store', description: 'Already admitted base store that must also satisfy all record operations.', defaultValue: 'required', optional: false, type: 'IKeyValueStore', whenToUse: 'Enter a record-only operation.', example: 'storage' }],
    optionsZh: [{ name: 'store', description: '已经 admitted、且必须满足全部 record operation 的 base store。', defaultValue: '必填', optional: false, type: 'IKeyValueStore', whenToUse: '进入 record-only operation。', example: 'storage' }]
  }),
  'storage-contract:index:isRecordStore': createStorageContractGuide({
    purposeEn: 'Boolean guard for the complete record-store surface and its required capability combination. Use it when the caller owns a fallback instead of an exception path.',
    purposeZh: '完整 record-store surface 及其 required capability 组合的 boolean guard。caller 拥有 fallback 而非 exception path 时使用。',
    quickStart: 'if (isRecordStore(storage)) await storage.putRecord(profile, profile.id)\nelse await storage.set(profile.id, JSON.stringify(profile))',
    scenariosEn: ['Selecting structured records or text fallback.', 'Conditionally enabling record UI.', 'Testing adapter capability declarations against methods.'],
    scenariosZh: ['选择 structured record 或 text fallback。', '有条件启用 record UI。', '测试 adapter capability declaration 是否与 methods 一致。'],
    avoidEn: ['Record support is mandatory.', 'The candidate is not yet a base store.', 'Only the records flag is of interest.'],
    avoidZh: ['record support 是 mandatory。', 'candidate 尚未成为 base store。', '只关心 records flag。'],
    optionsEn: [{ name: 'store', description: 'Admitted base store tested for the L1 record surface.', defaultValue: 'required', optional: false, type: 'IKeyValueStore', whenToUse: 'Choose between record and fallback paths.', example: 'storage' }],
    optionsZh: [{ name: 'store', description: '用于测试 L1 record surface 的 admitted base store。', defaultValue: '必填', optional: false, type: 'IKeyValueStore', whenToUse: '在 record 与 fallback path 之间选择。', example: 'storage' }]
  }),
  'storage-contract:index:asSecondaryIndexRecordStore': createStorageContractGuide({
    purposeEn: 'Requires an admitted record store to declare secondaryIndexes and implement every index lifecycle, readiness, write, iteration, and transaction method. It throws UNSUPPORTED before index work when the surface is incomplete.',
    purposeZh: '要求 admitted record store 声明 secondaryIndexes，并实现全部 index lifecycle、readiness、write、iteration 与 transaction method。surface 不完整时，在 index work 前抛出 UNSUPPORTED。',
    quickStart: "const indexed = asSecondaryIndexRecordStore<User>(records)\nconst handle = await indexed.ensureRecordIndexes('users', definitions)\nfor await (const [, user] of indexed.iterateRecordIndex({ handle, index: 'email' })) consume(user)",
    scenariosEn: ['A query feature cannot operate without indexes.', 'Index readiness and indexed writes belong to one required workflow.', 'A record adapter is promoted after explicit capability admission.'],
    scenariosZh: ['query feature 没有 index 就无法运行。', 'index readiness 与 indexed write 属于同一 required workflow。', 'record adapter 经显式 capability admission 后升级。'],
    avoidEn: ['Linear record iteration is an acceptable fallback.', 'Only the secondaryIndexes flag was checked.', 'Index definitions are not yet owned by the caller.'],
    avoidZh: ['linear record iteration 是可接受 fallback。', '只检查了 secondaryIndexes flag。', 'caller 尚未拥有 index definition。'],
    optionsEn: [{ name: 'store', description: 'Record store required to expose the complete secondary-index extension.', defaultValue: 'required', optional: false, type: 'IRecordStore<T>', whenToUse: 'Enter index-only code.', example: 'records' }],
    optionsZh: [{ name: 'store', description: '必须暴露完整 secondary-index extension 的 record store。', defaultValue: '必填', optional: false, type: 'IRecordStore<T>', whenToUse: '进入 index-only code。', example: 'records' }]
  }),
  'storage-contract:index:isSecondaryIndexRecordStore': createStorageContractGuide({
    purposeEn: 'Side-effect-free guard requiring an admitted record store, secondaryIndexes capability, and all five index operations. It does not create indexes or query backend state.',
    purposeZh: 'side-effect-free guard：要求 admitted record store、secondaryIndexes capability 与五个 index operation；不会创建 index 或查询 backend state。',
    quickStart: 'if (isSecondaryIndexRecordStore(storage)) showIndexedSearch()\nelse showScanWarning()',
    scenariosEn: ['UI conditionally exposes indexed search.', 'An adapter chooses indexed or scan execution.', 'Tests verify the advertised extension is callable.'],
    scenariosZh: ['UI 有条件展示 indexed search。', 'adapter 选择 indexed 或 scan execution。', '测试 advertised extension 是否 callable。'],
    avoidEn: ['The feature requires indexes and must reject fallback.', 'Index readiness must be checked.', 'The candidate has not passed record-store admission.'],
    avoidZh: ['feature 强制需要 index 且必须拒绝 fallback。', '需要检查 index readiness。', 'candidate 尚未通过 record-store admission。'],
    optionsEn: [{ name: 'store', description: 'Unknown value checked through base, record, and secondary-index layers.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Choose an optional indexed path.', example: 'storage' }],
    optionsZh: [{ name: 'store', description: '依次经过 base、record 与 secondary-index layer 检查的未知值。', defaultValue: '必填', optional: false, type: 'unknown', whenToUse: '选择 optional indexed path。', example: 'storage' }]
  }),
  'storage-contract:index:asChangeFeedStore': createStorageContractGuide({
    purposeEn: 'Requires a base store to declare changeFeed and expose subscribeChanges, then narrows it to the post-commit invalidation channel. Missing support throws UNSUPPORTED before listener registration.',
    purposeZh: '要求 base store 声明 changeFeed 并暴露 subscribeChanges，再收窄为 post-commit invalidation channel。缺少支持时会在注册 listener 前抛出 UNSUPPORTED。',
    quickStart: 'const changes = asChangeFeedStore(storage)\nconst unsubscribe = changes.subscribeChanges((change) => invalidate(change.keys))\ntry { await runApplication() } finally { unsubscribe() }',
    scenariosEn: ['A cache must observe committed external writes.', 'Cross-context invalidation is mandatory.', 'Subscription cleanup is owned by the caller lifecycle.'],
    scenariosZh: ['cache 必须观察 committed external write。', 'cross-context invalidation 是 mandatory。', 'subscription cleanup 由 caller lifecycle 拥有。'],
    avoidEn: ['Polling or explicit invalidation is acceptable.', 'You cannot retain and invoke the returned unsubscribe function.', 'You expect pre-commit events or value payload replication.'],
    avoidZh: ['polling 或 explicit invalidation 已足够。', '无法持有并调用返回的 unsubscribe function。', '期望 pre-commit event 或 value payload replication。'],
    optionsEn: [{ name: 'store', description: 'Base store required to expose the complete change-feed extension.', defaultValue: 'required', optional: false, type: 'IKeyValueStore', whenToUse: 'Enter a workflow that requires invalidation events.', example: 'storage' }],
    optionsZh: [{ name: 'store', description: '必须暴露完整 change-feed extension 的 base store。', defaultValue: '必填', optional: false, type: 'IKeyValueStore', whenToUse: '进入需要 invalidation event 的 workflow。', example: 'storage' }]
  }),
  'storage-contract:index:isChangeFeedStore': createStorageContractGuide({
    purposeEn: 'Boolean guard for post-commit change notifications. It first admits the full base store, then requires changeFeed === true and a callable subscribeChanges method.',
    purposeZh: 'post-commit change notification 的 boolean guard。先接纳完整 base store，再要求 changeFeed === true 且 subscribeChanges callable。',
    quickStart: 'const unsubscribe = isChangeFeedStore(storage)\n  ? storage.subscribeChanges(refreshCache)\n  : startPolling(refreshCache)',
    scenariosEn: ['Selecting subscription or polling.', 'Displaying whether live invalidation is available.', 'Verifying a backend extension without invoking it.'],
    scenariosZh: ['选择 subscription 或 polling。', '展示 live invalidation 是否可用。', '不调用 extension 即验证 backend extension。'],
    avoidEn: ['Change events are mandatory.', 'Only a property-presence check is intended.', 'The candidate is not a complete base store.'],
    avoidZh: ['change event 是 mandatory。', '只想检查 property presence。', 'candidate 不是完整 base store。'],
    optionsEn: [{ name: 'store', description: 'Unknown candidate checked for base-store and change-feed contracts.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Choose an optional subscription path.', example: 'storage' }],
    optionsZh: [{ name: 'store', description: '同时检查 base-store 与 change-feed contract 的未知候选值。', defaultValue: '必填', optional: false, type: 'unknown', whenToUse: '选择 optional subscription path。', example: 'storage' }]
  }),
  'store-persist:index:persistUnit': {
    en: {
      purpose: 'Attaches one persistence state machine to any synchronous unit adapter. It owns hydration, version migration, startup-write reconciliation, debounced serialized writes, retry/flush/clear, and abort-on-dispose in one shared implementation.',
      quickStart: "const handle = persistUnit(unit, {\n  key: 'settings:v2', runtime, storage, version: 2,\n  migrate: migrateSettings, partialize: selectPersistedSettings,\n  debounceMs: 250\n})\ntry {\n  await handle.ready\n  await handle.flush()\n} finally {\n  handle.dispose()\n}",
      scenarios: ['A custom state owner can synchronously snapshot, restore, and subscribe.', 'Hydration and writes need one observable lifecycle handle.', 'Startup mutations must not be silently overwritten while storage is loading.'],
      avoidWhen: ['Using Store Light, Indexed, or Keyed adapters already provided by this library.', 'Migration, projection, or merge must be asynchronous.', 'The owner cannot dispose the persistence subscription.'],
      options: storePersistUnitOptions.en
    },
    zh: {
      purpose: '给任意同步 unit adapter 接入一套 persistence state machine。统一拥有 hydration、version migration、startup-write reconciliation、debounced serialized write、retry/flush/clear 与 dispose abort。',
      quickStart: "const handle = persistUnit(unit, {\n  key: 'settings:v2', runtime, storage, version: 2,\n  migrate: migrateSettings, partialize: selectPersistedSettings,\n  debounceMs: 250\n})\ntry {\n  await handle.ready\n  await handle.flush()\n} finally {\n  handle.dispose()\n}",
      scenarios: ['custom state owner 能同步 snapshot、restore 与 subscribe。', 'hydration/write 需要一个可观察 lifecycle handle。', 'storage loading 期间的 startup mutation 不得被静默覆盖。'],
      avoidWhen: ['正在使用已有 Store Light、Indexed 或 Keyed adapter。', 'migration、projection 或 merge 必须 asynchronous。', 'owner 无法 dispose persistence subscription。'],
      options: storePersistUnitOptions.zh
    }
  },
  'store-persist:index:defaultJsonCodec': {
    en: {
      purpose: 'Provides the default text codec for persistence envelopes. It round-trips Map and Set through the canonical collections JSON codec and reads only the two exact legacy collection tags.',
      quickStart: "const encoded = await defaultJsonCodec.encode({ version: 1, state })\nconst envelope = await defaultJsonCodec.decode(encoded)",
      scenarios: ['Persisted state is JSON-compatible plus Map or Set.', 'Text storage is the desired backend channel.', 'Legacy tagged Map/Set archives must remain readable.'],
      avoidWhen: ['Binary output is materially smaller or faster.', 'State contains cyclic references or live host objects.', 'A domain schema requires validation or encryption.'],
      options: []
    },
    zh: {
      purpose: '提供 persistence envelope 的默认 text codec。通过 canonical collections JSON codec 往返 Map/Set，并且只读取两个精确 legacy collection tag。',
      quickStart: "const encoded = await defaultJsonCodec.encode({ version: 1, state })\nconst envelope = await defaultJsonCodec.decode(encoded)",
      scenarios: ['persisted state 是 JSON-compatible，并包含 Map 或 Set。', '目标 backend channel 是 text storage。', '必须继续读取 legacy tagged Map/Set archive。'],
      avoidWhen: ['binary output 明显更小或更快。', 'state 包含 cyclic reference 或 live host object。', 'domain schema 需要 validation 或 encryption。'],
      options: []
    }
  },
  'store-persist:index:writeEnvelope': {
    en: {
      purpose: 'Encodes one envelope and routes it to text or byte storage according to codec.output and backend capabilities. Structured output is rejected because the minimal persistence storage contract has no record channel.',
      quickStart: "await writeEnvelope(storage, 'settings', codec, { version: 2, state }, { signal })",
      scenarios: ['A custom persistence adapter needs the canonical output-channel routing.', 'Binary codecs should use setBytes only on a capable backend.', 'Codec output mismatches must fail before corrupting storage.'],
      avoidWhen: ['Using persistUnit, which already owns envelope writes.', 'Structured record storage is required.', 'The encoded output type is not guaranteed by the codec.'],
      options: [
        { name: 'storage', description: 'Persistence storage whose declared capabilities select the physical channel.', defaultValue: 'required', optional: false, type: 'IPersistStorage', whenToUse: 'Pass the same backend used for subsequent reads.', example: 'storage' },
        { name: 'key', description: 'Physical storage key written once.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Use the unit-owned envelope key.', example: "'settings'" },
        { name: 'codec', description: 'Codec declaring text, binary, or unsupported structured output.', defaultValue: 'required', optional: false, type: 'ICodec', whenToUse: 'Choose a codec compatible with backend capabilities.', example: 'defaultJsonCodec' },
        { name: 'value', description: 'Complete envelope or other value passed to codec.encode.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Write the already assembled versioned envelope.', example: '{ version: 2, state }' },
        { name: 'ctx.signal', description: 'Optional cancellation signal forwarded to codec and storage.', defaultValue: 'undefined', type: 'AbortSignal', whenToUse: 'Cancel in-flight encoding or backend work during disposal.', example: '{ signal }' }
      ]
    },
    zh: {
      purpose: '编码一份 envelope，并按 codec.output 与 backend capabilities 路由到 text 或 byte storage。minimal persistence storage contract 没有 record channel，因此拒绝 structured output。',
      quickStart: "await writeEnvelope(storage, 'settings', codec, { version: 2, state }, { signal })",
      scenarios: ['custom persistence adapter 需要 canonical output-channel routing。', 'binary codec 只应在 capable backend 上使用 setBytes。', 'codec output mismatch 必须在污染 storage 前失败。'],
      avoidWhen: ['正在使用已拥有 envelope write 的 persistUnit。', '需要 structured record storage。', 'codec 无法保证 encoded output type。'],
      options: [
        { name: 'storage', description: '由 declared capabilities 选择 physical channel 的 persistence storage。', defaultValue: '必填', optional: false, type: 'IPersistStorage', whenToUse: '传入后续 read 使用的同一个 backend。', example: 'storage' },
        { name: 'key', description: '写入一次的 physical storage key。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '使用 unit-owned envelope key。', example: "'settings'" },
        { name: 'codec', description: '声明 text、binary 或不受支持 structured output 的 codec。', defaultValue: '必填', optional: false, type: 'ICodec', whenToUse: '选择与 backend capabilities 兼容的 codec。', example: 'defaultJsonCodec' },
        { name: 'value', description: '交给 codec.encode 的完整 envelope 或其他 value。', defaultValue: '必填', optional: false, type: 'unknown', whenToUse: '写入已经组装好的 versioned envelope。', example: '{ version: 2, state }' },
        { name: 'ctx.signal', description: '转发给 codec 与 storage 的可选 cancellation signal。', defaultValue: 'undefined', type: 'AbortSignal', whenToUse: 'dispose 时取消 in-flight encoding 或 backend work。', example: '{ signal }' }
      ]
    }
  },
  'store-persist:index:readEnvelope': {
    en: {
      purpose: 'Reads and decodes one persisted value from the codec-selected text or binary channel. Missing storage values become undefined; binary codecs never silently fall back to text.',
      quickStart: "const rawEnvelope = await readEnvelope(storage, 'settings', codec, { signal })\nif (rawEnvelope !== undefined) assertEnvelope(rawEnvelope, 'settings')",
      scenarios: ['A custom adapter needs the canonical read-channel decision.', 'Missing archives are normal first-run state.', 'Binary capability mismatches must remain explicit.'],
      avoidWhen: ['Using persistUnit hydration.', 'A structured record channel is required.', 'Missing data should be treated as an error by this low-level helper.'],
      options: [
        { name: 'storage', description: 'Backend read through get or getBytes according to codec output.', defaultValue: 'required', optional: false, type: 'IPersistStorage', whenToUse: 'Use the backend that owns this key.', example: 'storage' },
        { name: 'key', description: 'Physical envelope key to read.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Match the corresponding write key.', example: "'settings'" },
        { name: 'codec', description: 'Decoder and output-channel declaration.', defaultValue: 'required', optional: false, type: 'ICodec', whenToUse: 'Use the same codec contract as the writer.', example: 'defaultJsonCodec' },
        { name: 'ctx.signal', description: 'Optional cancellation signal forwarded to storage and decode.', defaultValue: 'undefined', type: 'AbortSignal', whenToUse: 'Abort hydration or manual reads during teardown.', example: '{ signal }' }
      ]
    },
    zh: {
      purpose: '从 codec 选择的 text 或 binary channel 读取并解码一个 persisted value。missing storage value 返回 undefined；binary codec 绝不静默 fallback 到 text。',
      quickStart: "const rawEnvelope = await readEnvelope(storage, 'settings', codec, { signal })\nif (rawEnvelope !== undefined) assertEnvelope(rawEnvelope, 'settings')",
      scenarios: ['custom adapter 需要 canonical read-channel decision。', 'missing archive 是正常 first-run state。', 'binary capability mismatch 必须保持显式。'],
      avoidWhen: ['正在使用 persistUnit hydration。', '需要 structured record channel。', '期望 low-level helper 把 missing data 当作 error。'],
      options: [
        { name: 'storage', description: '按 codec output 通过 get 或 getBytes 读取的 backend。', defaultValue: '必填', optional: false, type: 'IPersistStorage', whenToUse: '使用拥有该 key 的 backend。', example: 'storage' },
        { name: 'key', description: '待读取的 physical envelope key。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '匹配对应 write key。', example: "'settings'" },
        { name: 'codec', description: 'decoder 与 output-channel declaration。', defaultValue: '必填', optional: false, type: 'ICodec', whenToUse: '使用与 writer 相同的 codec contract。', example: 'defaultJsonCodec' },
        { name: 'ctx.signal', description: '转发给 storage 与 decode 的可选 cancellation signal。', defaultValue: 'undefined', type: 'AbortSignal', whenToUse: 'teardown 时 abort hydration 或 manual read。', example: '{ signal }' }
      ]
    }
  },
  'store-persist:index:removeEnvelope': {
    en: {
      purpose: 'Removes one persisted envelope through the storage boundary while forwarding cancellation. It does not mutate the live state or dispose the persistence handle.',
      quickStart: "await removeEnvelope(storage, 'settings', { signal })",
      scenarios: ['A custom adapter implements clear.', 'A migration intentionally invalidates one archive key.', 'Cancellation must reach backend removal.'],
      avoidWhen: ['The live unit should also reset.', 'Every key in a namespace should be removed.', 'Using handle.clear, which already serializes removal with writes.'],
      options: [
        { name: 'storage', description: 'Backend whose remove method owns deletion.', defaultValue: 'required', optional: false, type: 'IPersistStorage', whenToUse: 'Pass the storage that owns the envelope.', example: 'storage' },
        { name: 'key', description: 'Exact physical key to remove.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Delete one known envelope without scanning keys.', example: "'settings'" },
        { name: 'ctx.signal', description: 'Optional cancellation signal forwarded to remove.', defaultValue: 'undefined', type: 'AbortSignal', whenToUse: 'Abort deletion during disposal or request cancellation.', example: '{ signal }' }
      ]
    },
    zh: {
      purpose: '通过 storage boundary 移除一份 persisted envelope，并转发 cancellation；不会 mutation live state，也不会 dispose persistence handle。',
      quickStart: "await removeEnvelope(storage, 'settings', { signal })",
      scenarios: ['custom adapter 实现 clear。', 'migration 有意使一个 archive key 失效。', 'cancellation 必须到达 backend removal。'],
      avoidWhen: ['live unit 也应 reset。', '应移除 namespace 中全部 key。', '正在使用会把 removal 与 write 串行化的 handle.clear。'],
      options: [
        { name: 'storage', description: '其 remove method 拥有 deletion 的 backend。', defaultValue: '必填', optional: false, type: 'IPersistStorage', whenToUse: '传入拥有 envelope 的 storage。', example: 'storage' },
        { name: 'key', description: '待移除的准确 physical key。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '不扫描 keys，只删除一份已知 envelope。', example: "'settings'" },
        { name: 'ctx.signal', description: '转发给 remove 的可选 cancellation signal。', defaultValue: 'undefined', type: 'AbortSignal', whenToUse: 'disposal 或 request cancellation 时 abort deletion。', example: '{ signal }' }
      ]
    }
  },
  'store-persist:index:assertEnvelope': {
    en: {
      purpose: 'Validates decoded data as a versioned persistence envelope before hydration. It rejects arrays, unsafe or negative versions, and missing state with PersistEnvelopeError.',
      quickStart: "const envelope = assertEnvelope<Settings>(decoded, 'settings')\nrestore(envelope.state)",
      scenarios: ['A custom codec has decoded untrusted storage data.', 'Migration needs a trustworthy previous version.', 'Corrupt archives must fail before mutating live state.'],
      avoidWhen: ['The value has not been decoded yet.', 'Validating an arbitrary domain object.', 'Silently repairing malformed persisted data.'],
      options: [
        { name: 'value', description: 'Unknown decoded value to validate without trusting its shape.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Pass the direct result of codec.decode.', example: 'decoded' },
        { name: 'key', description: 'Stable storage key included in diagnostics.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Identify the archive that failed validation.', example: "'settings'" }
      ]
    },
    zh: {
      purpose: 'hydration 前把 decoded data 验证为 versioned persistence envelope。array、不安全或负 version、缺少 state 都会以 PersistEnvelopeError 失败。',
      quickStart: "const envelope = assertEnvelope<Settings>(decoded, 'settings')\nrestore(envelope.state)",
      scenarios: ['custom codec 刚解码不可信 storage data。', 'migration 需要可信 previous version。', 'corrupt archive 必须在 mutation live state 前失败。'],
      avoidWhen: ['value 尚未 decode。', '验证任意 domain object。', '静默修补 malformed persisted data。'],
      options: [
        { name: 'value', description: '不预先信任 shape 的 decoded value。', defaultValue: '必填', optional: false, type: 'unknown', whenToUse: '直接传入 codec.decode 的结果。', example: 'decoded' },
        { name: 'key', description: '写入 diagnostic 的稳定 storage key。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '标识 validation 失败的 archive。', example: "'settings'" }
      ]
    }
  },
  'store-persist:index:PersistEnvelopeError': {
    en: {
      purpose: 'Native TypeError raised when persisted input is not a usable { version, state } envelope. It always carries STORE_PERSIST_SOURCE and ENVELOPE_INVALID.',
      quickStart: "try {\n  assertEnvelope(value, 'settings')\n} catch (error) {\n  if (error instanceof PersistEnvelopeError) quarantine('settings')\n}",
      scenarios: ['A boundary distinguishes corrupt archives from backend failures.', 'Diagnostics group invalid envelope reports.', 'Recovery quarantines only malformed records.'],
      avoidWhen: ['Throwing codec output mismatch.', 'Representing a version mismatch that migrate can handle.', 'Constructing it instead of calling assertEnvelope.'],
      options: [{ name: 'message', description: 'Human-readable envelope validation failure.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Normally supplied internally by assertEnvelope.', example: "'archive has no usable version'" }]
    },
    zh: {
      purpose: 'persisted input 不是可用 { version, state } envelope 时抛出的 native TypeError；始终携带 STORE_PERSIST_SOURCE 与 ENVELOPE_INVALID。',
      quickStart: "try {\n  assertEnvelope(value, 'settings')\n} catch (error) {\n  if (error instanceof PersistEnvelopeError) quarantine('settings')\n}",
      scenarios: ['boundary 区分 corrupt archive 与 backend failure。', 'diagnostic 聚合 invalid envelope report。', 'recovery 只 quarantine malformed record。'],
      avoidWhen: ['抛 codec output mismatch。', '表示 migrate 可以处理的 version mismatch。', '绕过 assertEnvelope 直接构造。'],
      options: [{ name: 'message', description: '面向人类的 envelope validation failure。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '通常由 assertEnvelope 内部提供。', example: "'archive has no usable version'" }]
    }
  },
  'store-persist:index:PersistState': {
    en: {
      purpose: 'Stable lifecycle values for a persistence handle: idle, active, loading, writing, ready, success, error, and disposed. Observe them for UI and diagnostics; do not drive the engine by assigning them.',
      quickStart: "if (handle.status.value === PersistState.error) showRetry(handle.error.value)",
      scenarios: ['A UI shows hydration progress.', 'Diagnostics distinguish loading from writing.', 'Cleanup confirms a terminal disposed handle.'],
      avoidWhen: ['Encoding business workflow state.', 'Inferring durability without awaiting flush.', 'Mutating lifecycle state externally.'],
      options: []
    },
    zh: {
      purpose: 'persistence handle 的稳定 lifecycle value：idle、active、loading、writing、ready、success、error、disposed。用于 UI 与 diagnostic 观察，不要通过赋值驱动 engine。',
      quickStart: "if (handle.status.value === PersistState.error) showRetry(handle.error.value)",
      scenarios: ['UI 展示 hydration progress。', 'diagnostic 区分 loading 与 writing。', 'cleanup 确认 handle 已进入 terminal disposed。'],
      avoidWhen: ['编码 business workflow state。', '未 await flush 就推断 durability。', '从外部 mutation lifecycle state。'],
      options: []
    }
  },
  'store-persist:index:PersistCodecOutput': {
    en: {
      purpose: 'Declares the physical representation produced by a codec. Text uses get/set, binary requires getBytes/setBytes, and structured is rejected by the minimal persistence storage boundary.',
      quickStart: "const codec = { name: 'bytes', output: PersistCodecOutput.binary, encode, decode }",
      scenarios: ['A codec selects the byte storage channel.', 'Capability checks reject an incompatible backend.', 'A custom adapter documents its representation explicitly.'],
      avoidWhen: ['Describing MIME types.', 'Selecting storage keys.', 'Assuming structured output is supported by persistUnit.'],
      options: []
    },
    zh: {
      purpose: '声明 codec 产生的 physical representation。text 使用 get/set，binary 要求 getBytes/setBytes，minimal persistence storage boundary 会拒绝 structured。',
      quickStart: "const codec = { name: 'bytes', output: PersistCodecOutput.binary, encode, decode }",
      scenarios: ['codec 选择 byte storage channel。', 'capability check 拒绝不兼容 backend。', 'custom adapter 显式记录 representation。'],
      avoidWhen: ['描述 MIME type。', '选择 storage key。', '假定 persistUnit 支持 structured output。'],
      options: []
    }
  },
  'store-persist:index:STORE_PERSIST_SOURCE': {
    en: {
      purpose: 'Canonical source discriminator attached to every public Store Persist error. Combine it with code for stable machine handling across native error classes.',
      quickStart: "if (error.source === STORE_PERSIST_SOURCE && error.code === StorePersistErrorCode.abortedByDispose) return",
      scenarios: ['A shared reporter routes failures by library.', 'An RPC boundary serializes source and code.', 'Tests assert public error ownership.'],
      avoidWhen: ['Choosing an individual failure condition.', 'Replacing instanceof checks when the native class matters.', 'Using a copied string literal.'],
      options: []
    },
    zh: {
      purpose: '附加到每个公开 Store Persist error 的 canonical source discriminator。与 code 组合后可跨 native error class 稳定处理。',
      quickStart: "if (error.source === STORE_PERSIST_SOURCE && error.code === StorePersistErrorCode.abortedByDispose) return",
      scenarios: ['shared reporter 按 library 路由 failure。', 'RPC boundary 序列化 source 与 code。', '测试断言公开 error ownership。'],
      avoidWhen: ['选择具体 failure 条件。', 'native class 重要时替代 instanceof。', '复制 string literal。'],
      options: []
    }
  },
  'store-persist:index:createStorePersistError': createStorePersistErrorGuide(
    'Error',
    'An optional cause remains reachable without replacing its stack.',
    '可选 cause 保持可达，且不会替换其 stack。',
    storePersistCauseErrorOptions
  ),
  'store-persist:index:createStorePersistAbortError': createStorePersistErrorGuide(
    'AbortError',
    'The result is a DOMException named AbortError and may retain the cancellation reason as cause.',
    '结果是名为 AbortError 的 DOMException，并可把 cancellation reason 保留为 cause。',
    storePersistAbortErrorOptions
  ),
  'store-persist:index:createStorePersistTypeError': createStorePersistErrorGuide(
    'TypeError',
    'Use it for invalid configuration or value shape while preserving native instanceof behavior.',
    '用于 invalid configuration 或 value shape，同时保留 native instanceof 行为。',
    storePersistCauseErrorOptions
  ),
  'store-persist:index:createStorePersistAggregateError': createStorePersistErrorGuide(
    'AggregateError',
    'Every input failure remains ordered and reachable through errors[].',
    '每个输入 failure 都按顺序保留并可通过 errors[] 到达。',
    storePersistAggregateErrorOptions
  ),
  'store-persist:light:persist': {
    en: {
      purpose: 'Connects one Store Light instance to versioned persistence. It hydrates through $hydrate, observes later changes without an initial false write, and returns the shared flush, clear, retry, and dispose lifecycle handle.',
      quickStart: "const handle = persist(settings, { key: 'settings', storage, version: 2 })\nawait handle.ready\nawait handle.flush()",
      scenarios: ['Application settings should survive reloads.', 'Only a safe subset of flat Store state should be stored.', 'An older state shape needs synchronous migration.'],
      avoidWhen: ['Persisting an indexed collection.', 'Persisting one keyed atom.', 'The source cannot expose synchronous snapshot, hydration, and subscription.'],
      options: [
        { name: 'store', description: 'Store Light-compatible owner exposing $runtime, $plain, $subscribe, and $hydrate.', defaultValue: 'required', optional: false, type: 'IPersistableStore', whenToUse: 'Persist one flat reactive state owner.', example: 'settings' },
        { name: 'options.key', description: 'Stable key for the versioned Store envelope.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Give this state owner an exclusive storage identity.', example: "'settings'" },
        { name: 'options.storage', description: 'Storage boundary owning reads, writes, removal, and capabilities.', defaultValue: 'required', optional: false, type: 'IPersistStorage', whenToUse: 'Choose the durability scope for this Store.', example: 'storage' },
        { name: 'options.codec', description: 'Envelope codec; defaults to text JSON with Map and Set support.', defaultValue: 'defaultJsonCodec', type: 'ICodec', whenToUse: 'Use binary or domain-specific serialization.', example: 'binaryCodec' },
        { name: 'options.version', description: 'Non-negative schema version stored with state.', defaultValue: '0', type: 'number', whenToUse: 'Increment when stored state requires migration.', example: '2' },
        { name: 'options.migrate', description: 'Synchronous conversion from an older stored version.', defaultValue: 'undefined', type: '(persisted, fromVersion) => state', whenToUse: 'Keep existing archives readable after a schema change.', example: '(old, from) => migrateSettings(old, from)' },
        { name: 'options.partialize', description: 'Synchronous projection selecting fields written to storage.', defaultValue: '(state) => state', type: '(state) => Record<string, unknown>', whenToUse: 'Exclude transient, derived, credential, or externally owned fields.', example: '({ token: _token, ...safe }) => safe' },
        { name: 'options.debounceMs', description: 'Finite non-negative delay used to coalesce writes.', defaultValue: '0', type: 'number', whenToUse: 'Trade accepted durability latency for fewer writes.', example: '250' }
      ]
    },
    zh: {
      purpose: '把一份 Store Light state 接入 versioned persistence。通过 $hydrate 恢复，跳过 initial false write 后观察变化，并返回共享 flush、clear、retry、dispose lifecycle handle。',
      quickStart: "const handle = persist(settings, { key: 'settings', storage, version: 2 })\nawait handle.ready\nawait handle.flush()",
      scenarios: ['application settings 需要跨 reload 保留。', '只存 flat Store state 的安全 subset。', '旧 state shape 需要同步 migration。'],
      avoidWhen: ['持久化 indexed collection。', '持久化单个 keyed atom。', 'source 无法同步 snapshot、hydrate 与 subscribe。'],
      options: [
        { name: 'store', description: '暴露 $runtime、$plain、$subscribe、$hydrate 的 Store Light-compatible owner。', defaultValue: '必填', optional: false, type: 'IPersistableStore', whenToUse: '持久化一份 flat reactive state。', example: 'settings' },
        { name: 'options.key', description: 'versioned Store envelope 的稳定 key。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '为该 state owner 分配独占 storage identity。', example: "'settings'" },
        { name: 'options.storage', description: '拥有 read、write、remove 与 capabilities 的 storage boundary。', defaultValue: '必填', optional: false, type: 'IPersistStorage', whenToUse: '选择该 Store 的 durability scope。', example: 'storage' },
        { name: 'options.codec', description: 'envelope codec；默认 text JSON，并支持 Map/Set。', defaultValue: 'defaultJsonCodec', type: 'ICodec', whenToUse: '使用 binary 或 domain-specific serialization。', example: 'binaryCodec' },
        { name: 'options.version', description: '随 state 保存的非负 schema version。', defaultValue: '0', type: 'number', whenToUse: 'stored state 需要 migration 时递增。', example: '2' },
        { name: 'options.migrate', description: '从旧 stored version 同步转换到当前 shape。', defaultValue: 'undefined', type: '(persisted, fromVersion) => state', whenToUse: 'schema 变化后继续读取现有 archive。', example: '(old, from) => migrateSettings(old, from)' },
        { name: 'options.partialize', description: '选择写入 storage field 的同步 projection。', defaultValue: '(state) => state', type: '(state) => Record<string, unknown>', whenToUse: '排除 transient、derived、credential 或 externally owned field。', example: '({ token: _token, ...safe }) => safe' },
        { name: 'options.debounceMs', description: '合并 write 的有限非负 delay。', defaultValue: '0', type: 'number', whenToUse: '用可接受 durability latency 换取更少 write。', example: '250' }
      ]
    }
  },
  'store-persist:indexed:persistCollection': {
    en: {
      purpose: 'Persists one observable object, array, map, or set through its tracked snapshot and atomic replace operations. A Runtime effect observes structural changes and skips its synchronous first run.',
      quickStart: "const handle = persistCollection(cart, { key: 'cart', storage, merge: (saved) => saved })\nawait handle.ready",
      scenarios: ['A reactive map or set must survive reloads.', 'Hydration must atomically replace collection contents.', 'Collection state needs custom partialize and merge semantics.'],
      avoidWhen: ['Persisting Store Light state.', 'Persisting a single keyed atom.', 'The collection snapshot is not tracked by its Runtime.'],
      options: [
        { name: 'collection', description: 'Collection exposing Runtime-owned tracked snapshot and atomic replace.', defaultValue: 'required', optional: false, type: 'IPersistableCollection<TState>', whenToUse: 'Adapt an observable object, array, map, or set.', example: 'cart' },
        ...storePersistUnitOptions.en.filter((option) => option.name !== 'unit' && option.name !== 'options.runtime')
      ]
    },
    zh: {
      purpose: '通过 tracked snapshot 与 atomic replace 持久化 observable object、array、map 或 set。Runtime effect 观察 structural change，并跳过同步首次执行。',
      quickStart: "const handle = persistCollection(cart, { key: 'cart', storage, merge: (saved) => saved })\nawait handle.ready",
      scenarios: ['reactive map 或 set 需要跨 reload 保留。', 'hydration 必须原子替换 collection content。', 'collection state 需要 custom partialize 与 merge semantics。'],
      avoidWhen: ['持久化 Store Light state。', '持久化单个 keyed atom。', 'collection snapshot 不受其 Runtime tracking。'],
      options: [
        { name: 'collection', description: '暴露 Runtime-owned tracked snapshot 与 atomic replace 的 collection。', defaultValue: '必填', optional: false, type: 'IPersistableCollection<TState>', whenToUse: '适配 observable object、array、map 或 set。', example: 'cart' },
        ...storePersistUnitOptions.zh.filter((option) => option.name !== 'unit' && option.name !== 'options.runtime')
      ]
    }
  },
  'store-persist:keyed:persistKeyed': {
    en: {
      purpose: 'Persists exactly one writable atom under namespace:id. Each call owns an independent persistence lifecycle; the returned value is the atom value captured when the handle is created.',
      quickStart: "const sessionHandle = persistKeyed(atomStore, session(userId), userId, { namespace: 'sessions', storage })\nawait sessionHandle.ready",
      scenarios: ['One family member needs independent persistence.', 'Per-user state requires stable namespace isolation.', 'A keyed value needs selective fields and custom merge.'],
      avoidWhen: ['Persisting an entire family automatically.', 'The atom definition is read-only.', 'IDs or namespace values are empty or unstable.'],
      options: [
        { name: 'atomStore', description: 'Atom Store owning the writable definition and Runtime.', defaultValue: 'required', optional: false, type: 'IAtomStore', whenToUse: 'Use the exact owner of the atom definition.', example: 'atomStore' },
        { name: 'def', description: 'Writable atom definition whose current value is stored and restored.', defaultValue: 'required', optional: false, type: 'IWritableAtomDefinition<T>', whenToUse: 'Persist one concrete family member or atom.', example: 'session(userId)' },
        { name: 'id', description: 'Non-empty semantic identifier appended to namespace.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Give this member a stable identity.', example: 'userId' },
        { name: 'options.namespace', description: 'Non-empty prefix shared by related persisted atoms.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Group records for clearFamily without coupling memory ownership.', example: "'sessions'" },
        { name: 'options.storage', description: 'Storage boundary owning namespace:id records.', defaultValue: 'required', optional: false, type: 'IPersistStorage', whenToUse: 'Use one backend for members cleared as a family.', example: 'storage' },
        { name: 'options.codec', description: 'Codec for the versioned atom envelope.', defaultValue: 'defaultJsonCodec', type: 'ICodec', whenToUse: 'Override serialization or use a byte-capable backend.', example: 'binaryCodec' },
        { name: 'options.version', description: 'Non-negative schema version written with the atom value.', defaultValue: '0', type: 'number', whenToUse: 'Version new keyed records consistently.', example: '2' },
        { name: 'options.debounceMs', description: 'Finite non-negative delay coalescing changes to this atom.', defaultValue: '0', type: 'number', whenToUse: 'Limit write frequency per member.', example: '100' },
        { name: 'options.partialize', description: 'Synchronous projection selecting the persisted portion of the atom value.', defaultValue: '(value) => value', type: '(value: T) => Partial<T>', whenToUse: 'Exclude volatile or secret fields.', example: '({ refreshToken }) => ({ refreshToken })' },
        { name: 'options.merge', description: 'Synchronous reconciliation of persisted partial value with the current atom value.', defaultValue: 'shared default merge', type: '(persisted: Partial<T>, current: T) => T', whenToUse: 'Restore a subset without erasing current fields.', example: '(saved, current) => ({ ...current, ...saved })' }
      ]
    },
    zh: {
      purpose: '把恰好一个 writable atom 持久化到 namespace:id。每次调用拥有独立 persistence lifecycle；返回 value 是创建 handle 时取得的 atom value。',
      quickStart: "const sessionHandle = persistKeyed(atomStore, session(userId), userId, { namespace: 'sessions', storage })\nawait sessionHandle.ready",
      scenarios: ['一个 family member 需要独立 persistence。', 'per-user state 需要稳定 namespace isolation。', 'keyed value 需要 selective field 与 custom merge。'],
      avoidWhen: ['自动持久化整个 family。', 'atom definition 是 read-only。', 'id 或 namespace 为空或不稳定。'],
      options: [
        { name: 'atomStore', description: '拥有 writable definition 与 Runtime 的 Atom Store。', defaultValue: '必填', optional: false, type: 'IAtomStore', whenToUse: '使用 atom definition 的准确 owner。', example: 'atomStore' },
        { name: 'def', description: '其当前 value 会被存储和恢复的 writable atom definition。', defaultValue: '必填', optional: false, type: 'IWritableAtomDefinition<T>', whenToUse: '持久化一个具体 family member 或 atom。', example: 'session(userId)' },
        { name: 'id', description: '附加到 namespace 的非空 semantic identifier。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '为该 member 提供稳定 identity。', example: 'userId' },
        { name: 'options.namespace', description: 'related persisted atom 共享的非空 prefix。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '为 clearFamily 归组 record，但不耦合 memory ownership。', example: "'sessions'" },
        { name: 'options.storage', description: '拥有 namespace:id record 的 storage boundary。', defaultValue: '必填', optional: false, type: 'IPersistStorage', whenToUse: '同一 family 使用同一个 backend。', example: 'storage' },
        { name: 'options.codec', description: 'versioned atom envelope 的 codec。', defaultValue: 'defaultJsonCodec', type: 'ICodec', whenToUse: '覆盖 serialization 或使用 byte-capable backend。', example: 'binaryCodec' },
        { name: 'options.version', description: '随 atom value 写入的非负 schema version。', defaultValue: '0', type: 'number', whenToUse: '一致地 version 新 keyed record。', example: '2' },
        { name: 'options.debounceMs', description: '合并该 atom change 的有限非负 delay。', defaultValue: '0', type: 'number', whenToUse: '限制每个 member 的 write frequency。', example: '100' },
        { name: 'options.partialize', description: '选择 atom value persisted portion 的同步 projection。', defaultValue: '(value) => value', type: '(value: T) => Partial<T>', whenToUse: '排除 volatile 或 secret field。', example: '({ refreshToken }) => ({ refreshToken })' },
        { name: 'options.merge', description: 'persisted partial value 与当前 atom value 的同步 reconciliation。', defaultValue: 'shared default merge', type: '(persisted: Partial<T>, current: T) => T', whenToUse: '恢复 subset 而不清除 current field。', example: '(saved, current) => ({ ...current, ...saved })' }
      ]
    }
  },
  'store-persist:keyed:clearFamily': {
    en: {
      purpose: 'Removes every persisted record whose key begins with namespace:. It only changes storage; live atoms and active persistence handles remain untouched and may write again after their next change.',
      quickStart: "const removed = await clearFamily(storage, 'sessions')",
      scenarios: ['Logout removes every stored session member.', 'A tenant namespace is invalidated.', 'A family migration intentionally starts from empty storage.'],
      avoidWhen: ['Only one member should be removed.', 'Live atom values must also reset.', 'Active handles should be prevented from writing again.'],
      options: [
        { name: 'storage', description: 'Storage exposing keys and remove for namespace scanning.', defaultValue: 'required', optional: false, type: 'IPersistStorage', whenToUse: 'Pass the backend that owns all family records.', example: 'storage' },
        { name: 'namespace', description: 'Non-empty namespace whose namespace: prefix is matched.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Delete one semantic family without touching adjacent keys.', example: "'sessions'" }
      ]
    },
    zh: {
      purpose: '移除 key 以 namespace: 开头的全部 persisted record。它只改变 storage；live atom 与 active persistence handle 不受影响，并可能在下次 change 后重新写入。',
      quickStart: "const removed = await clearFamily(storage, 'sessions')",
      scenarios: ['logout 移除全部 stored session member。', 'tenant namespace 被整体 invalidated。', 'family migration 有意从 empty storage 开始。'],
      avoidWhen: ['只应移除一个 member。', 'live atom value 也必须 reset。', '需要阻止 active handle 再次写入。'],
      options: [
        { name: 'storage', description: '暴露 keys 与 remove、用于 namespace scan 的 storage。', defaultValue: '必填', optional: false, type: 'IPersistStorage', whenToUse: '传入拥有全部 family record 的 backend。', example: 'storage' },
        { name: 'namespace', description: '用 namespace: prefix 匹配的非空 namespace。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '删除一个 semantic family，且不触及相邻 key。', example: "'sessions'" }
      ]
    }
  },
  'store-react:index:useTracked': createStoreReactHookGuide({
    purposeEn: 'Subscribes React to every Reactive dependency read by a selector. Render-time capture, commit validation, stable subscription identity, custom equality, and Runtime replacement are handled without tearing.',
    purposeZh: '让 React 订阅 selector 读取到的全部 Reactive dependency。它处理 render capture、commit validation、稳定 subscription identity、custom equality 与 Runtime replacement，避免 tearing。',
    quickStart: 'const total = useTracked(() => price.value * quantity.value)',
    scenariosEn: ['A selector reads several Signals or Computeds.', 'Dependencies change according to a branch.', 'Equal derived results should reuse the committed snapshot.'],
    scenariosZh: ['selector 读取多个 Signal 或 Computed。', 'dependency 随 branch 动态变化。', '相等 derived result 应复用 committed snapshot。'],
    avoidEn: ['Reading one stable Signal; use useSignal.', 'Reading a Store shape; use useStore.', 'Running effects or writes during render.'],
    avoidZh: ['只读一个 stable Signal；使用 useSignal。', '读取 Store shape；使用 useStore。', '在 render 中运行 effect 或 write。'],
    optionsEn: [
      { name: 'read', description: 'Pure render-safe selector whose Reactive reads become the subscription set.', defaultValue: 'required', optional: false, type: '() => T', whenToUse: 'Return the exact value the component renders.', example: '() => price.value * quantity.value' },
      { name: 'isEqual', description: 'Compares previous and next selector results to suppress equivalent React snapshots.', defaultValue: 'Object.is', type: '(a: T, b: T) => boolean', whenToUse: 'Use structural equality only when its cost is lower than rerendering.', example: 'shallowEqual' },
      { name: 'runtime', description: 'Runtime that owns every Reactive node read by the selector.', defaultValue: 'defaultRuntime', type: 'IRuntime', whenToUse: 'Pass an explicit request, Provider, or application Runtime.', example: 'runtime' }
    ],
    optionsZh: [
      { name: 'read', description: '纯且 render-safe 的 selector；其中 Reactive read 构成 subscription set。', defaultValue: '必填', optional: false, type: '() => T', whenToUse: '返回 component 实际渲染的准确 value。', example: '() => price.value * quantity.value' },
      { name: 'isEqual', description: '比较前后 selector result，抑制等价 React snapshot。', defaultValue: 'Object.is', type: '(a: T, b: T) => boolean', whenToUse: '仅在 structural equality 成本低于 rerender 时使用。', example: 'shallowEqual' },
      { name: 'runtime', description: '拥有 selector 所读全部 Reactive node 的 Runtime。', defaultValue: 'defaultRuntime', type: 'IRuntime', whenToUse: '传入明确的 request、Provider 或 application Runtime。', example: 'runtime' }
    ]
  }),
  'store-react:index:useSignal': createStoreReactHookGuide({
    purposeEn: 'Reads one stable Signal through the fixed-node subscription fast path and returns a stable setter. The setter writes Signal.value and therefore preserves Runtime batching and validation.',
    purposeZh: '通过 fixed-node subscription fast path 读取一个 stable Signal，并返回稳定 setter。setter 写入 Signal.value，因此保留 Runtime batching 与 validation。',
    quickStart: 'const [count, setCount] = useSignal(countSignal)\n<button onClick={() => setCount(count + 1)}>{count}</button>',
    scenariosEn: ['A component renders one writable Signal.', 'A form control writes directly to a Signal.', 'A stable node does not need dynamic dependency capture.'],
    scenariosZh: ['component 渲染一个 writable Signal。', 'form control 直接写 Signal。', 'stable node 不需要 dynamic dependency capture。'],
    avoidEn: ['Combining several Reactive reads.', 'The Signal belongs to another Runtime.', 'A read-only value should not expose a setter.'],
    avoidZh: ['组合多个 Reactive read。', 'Signal 属于另一个 Runtime。', 'read-only value 不应暴露 setter。'],
    optionsEn: [{ name: 's', description: 'Stable writable Signal; its own Runtime supplies ownership and subscription.', defaultValue: 'required', optional: false, type: 'ISignal<T>', whenToUse: 'Bind one Signal value to React.', example: 'countSignal' }],
    optionsZh: [{ name: 's', description: '稳定 writable Signal；其 Runtime 提供 ownership 与 subscription。', defaultValue: '必填', optional: false, type: 'ISignal<T>', whenToUse: '把一个 Signal value 绑定到 React。', example: 'countSignal' }]
  }),
  'store-react:index:useStore': createStoreReactHookGuide({
    purposeEn: 'Selects a render value from Store Light with dependency-level tracking. Async stores suspend on storeReady before the selector runs, and only the Reactive fields actually read are observed.',
    purposeZh: '从 Store Light 选择 render value，并进行 dependency-level tracking。async store 会在 selector 执行前通过 storeReady suspend，且只观察实际读取的 Reactive field。',
    quickStart: 'const completed = useStore(todoStore, (state) => state.items.filter((item) => item.done).length)',
    scenariosEn: ['A component needs a derived Store slice.', 'Only selected fields should trigger rerenders.', 'An async Store must suspend until hydration is ready.'],
    scenariosZh: ['component 需要 derived Store slice。', '只有 selected field 应触发 rerender。', 'async Store 必须等待 hydration ready。'],
    avoidEn: ['Reading the whole Store without selection.', 'The value is a standalone Signal or Atom.', 'The selector performs writes or side effects.'],
    avoidZh: ['不经 selection 读取整个 Store。', 'value 是独立 Signal 或 Atom。', 'selector 执行 write 或 side effect。'],
    optionsEn: [
      { name: 'store', description: 'Reactive Store whose Runtime owns selector tracking and optional readiness.', defaultValue: 'required', optional: false, type: 'IReactiveStore<S>', whenToUse: 'Select from one Store Light owner.', example: 'todoStore' },
      { name: 'selector', description: 'Pure function reading the Store shape and returning the rendered result.', defaultValue: 'required', optional: false, type: '(state: IStoreShape<S>) => R', whenToUse: 'Read only fields relevant to this component.', example: '(state) => state.items.length' },
      { name: 'isEqual', description: 'Optional result equality used to suppress equivalent snapshots.', defaultValue: 'Object.is', type: '(a: R, b: R) => boolean', whenToUse: 'Stabilize newly allocated but equivalent selector results.', example: 'shallowEqual' }
    ],
    optionsZh: [
      { name: 'store', description: '其 Runtime 拥有 selector tracking 与 optional readiness 的 Reactive Store。', defaultValue: '必填', optional: false, type: 'IReactiveStore<S>', whenToUse: '从一个 Store Light owner 选择数据。', example: 'todoStore' },
      { name: 'selector', description: '读取 Store shape 并返回 render result 的纯函数。', defaultValue: '必填', optional: false, type: '(state: IStoreShape<S>) => R', whenToUse: '只读当前 component 需要的 field。', example: '(state) => state.items.length' },
      { name: 'isEqual', description: '抑制等价 snapshot 的可选 result equality。', defaultValue: 'Object.is', type: '(a: R, b: R) => boolean', whenToUse: '稳定每次新建但内容等价的 selector result。', example: 'shallowEqual' }
    ]
  }),
  'store-react:index:useResource': createStoreReactHookGuide({
    purposeEn: 'Subscribes to a Resource state machine and returns its full idle, pending, success, error, or cancelled state without throwing. Use it when the component renders each state explicitly.',
    purposeZh: '订阅 Resource state machine，并返回完整 idle、pending、success、error 或 cancelled state，不会 throw。适合 component 显式渲染每个 state。',
    quickStart: "const state = useResource(userResource)\nif (state.status === 'success') return <Profile user={state.data} />",
    scenariosEn: ['A component renders custom loading and retry UI.', 'Cancelled and error states need different treatment.', 'Resource metadata is needed alongside data.'],
    scenariosZh: ['component 渲染 custom loading 与 retry UI。', 'cancelled 与 error state 需要不同处理。', '除了 data 还需要 Resource metadata。'],
    avoidEn: ['Suspense should own pending and error flow.', 'Only the resolved value is needed.', 'The input is a Store Resource capture contract.'],
    avoidZh: ['应由 Suspense 接管 pending 与 error flow。', '只需要 resolved value。', '输入是 Store Resource capture contract。'],
    optionsEn: [{ name: 'res', description: 'Resource whose state transitions are tracked by its Runtime.', defaultValue: 'required', optional: false, type: 'Resource<T>', whenToUse: 'Render the complete asynchronous state machine.', example: 'userResource' }],
    optionsZh: [{ name: 'res', description: '其 state transition 由自身 Runtime tracking 的 Resource。', defaultValue: '必填', optional: false, type: 'Resource<T>', whenToUse: '渲染完整 asynchronous state machine。', example: 'userResource' }]
  }),
  'store-react:index:useResourceValue': createStoreReactHookGuide({
    purposeEn: 'Reads a Resource through React Suspense: success returns data, pending or idle throws the Resource promise, and error or cancelled throws the stored error from render.',
    purposeZh: '通过 React Suspense 读取 Resource：success 返回 data，pending/idle 从 render throw Resource promise，error/cancelled 从 render throw stored error。',
    quickStart: 'const user = useResourceValue(userResource)\nreturn <Profile user={user} />',
    scenariosEn: ['A Suspense boundary owns loading UI.', 'An Error Boundary owns Resource failures.', 'The component only renders resolved data.'],
    scenariosZh: ['Suspense boundary 拥有 loading UI。', 'Error Boundary 拥有 Resource failure。', 'component 只渲染 resolved data。'],
    avoidEn: ['The component needs status-specific controls.', 'No Suspense/Error Boundary surrounds the subtree.', 'Cancellation should be rendered as ordinary state.'],
    avoidZh: ['component 需要 status-specific control。', 'subtree 外没有 Suspense/Error Boundary。', 'cancellation 应作为普通 state 渲染。'],
    optionsEn: [{ name: 'resource', description: 'Resource whose promise, data, and error drive Suspense render flow.', defaultValue: 'required', optional: false, type: 'Resource<T>', whenToUse: 'Read one asynchronous value declaratively.', example: 'userResource' }],
    optionsZh: [{ name: 'resource', description: '其 promise、data、error 驱动 Suspense render flow 的 Resource。', defaultValue: '必填', optional: false, type: 'Resource<T>', whenToUse: '声明式读取一个 asynchronous value。', example: 'userResource' }]
  }),
  'store-react:index:useStoreResource': createStoreReactHookGuide({
    purposeEn: 'Reads a Store Resource capture contract and commits its render capture in layout. Replaced resources release their previous committed lease, and StrictMode cleanup is guarded against replay.',
    purposeZh: '读取 Store Resource capture contract，并在 layout commit render capture。resource replacement 会释放前一个 committed lease，StrictMode cleanup 也防止 replay 误释放。',
    quickStart: 'const profile = useStoreResource(store.profileResource(userId))',
    scenariosEn: ['A Store field exposes an owned Resource lease.', 'Render capture must become ownership only after commit.', 'Resource replacement must release the previous lease.'],
    scenariosZh: ['Store field 暴露 owned Resource lease。', 'render capture 只能在 commit 后成为 ownership。', 'resource replacement 必须释放 previous lease。'],
    avoidEn: ['Reading a generic Resource state.', 'Manually managing capture/commit outside React.', 'The resource identity changes on every render.'],
    avoidZh: ['读取 generic Resource state。', '在 React 外手动管理 capture/commit。', 'resource identity 每次 render 都变化。'],
    optionsEn: [{ name: 'resource', description: 'Store Resource exposing subscribe, snapshot capture, commit, and release.', defaultValue: 'required', optional: false, type: 'IStoreResource<T>', whenToUse: 'Bind Store-owned resource lifecycle to a component commit.', example: 'store.profileResource(userId)' }],
    optionsZh: [{ name: 'resource', description: '暴露 subscribe、snapshot capture、commit 与 release 的 Store Resource。', defaultValue: '必填', optional: false, type: 'IStoreResource<T>', whenToUse: '把 Store-owned resource lifecycle 绑定到 component commit。', example: 'store.profileResource(userId)' }]
  }),
  'store-react:index:useNodeValue': createStoreReactHookGuide({
    purposeEn: 'Reads one stable Reactive node with ownership validation and a fixed dependency subscription. Disabling observation preserves hook order while returning the current non-tracking peek value.',
    purposeZh: '通过 ownership validation 与 fixed dependency subscription 读取一个 stable Reactive node。禁用 observation 时仍保持 hook order，并返回当前 non-tracking peek value。',
    quickStart: 'const count = useNodeValue(countSignal, runtime)',
    scenariosEn: ['An adapter binds a stable node to React.', 'Hook order must remain fixed while a Provider source replaces direct observation.', 'Node ownership should fail during render for Error Boundary handling.'],
    scenariosZh: ['adapter 把 stable node 绑定到 React。', 'Provider source 替代 direct observation 时仍需固定 hook order。', 'node ownership error 应在 render 阶段交给 Error Boundary。'],
    avoidEn: ['The dependency set is dynamic.', 'Node and Runtime ownership differ.', 'Application code can use the higher-level Signal or Atom hook.'],
    avoidZh: ['dependency set 是动态的。', 'node 与 Runtime ownership 不一致。', 'application code 可以使用更高层 Signal 或 Atom hook。'],
    optionsEn: [
      { name: 'node', description: 'Stable Reactive node exposing current value and non-tracking peek.', defaultValue: 'required', optional: false, type: 'IStableNode<T>', whenToUse: 'Build a fixed-node React adapter.', example: 'countSignal' },
      { name: 'runtime', description: 'Exact Runtime that owns the node and schedules notifications.', defaultValue: 'required', optional: false, type: 'IRuntime', whenToUse: 'Preserve ownership and untracked notification context.', example: 'countSignal.runtime' },
      { name: 'enabled', description: 'Controls subscription without conditionally calling the hook.', defaultValue: 'true', type: 'boolean', whenToUse: 'Disable a direct source while retaining stable hook order.', example: 'providerStore === undefined' }
    ],
    optionsZh: [
      { name: 'node', description: '暴露 current value 与 non-tracking peek 的 stable Reactive node。', defaultValue: '必填', optional: false, type: 'IStableNode<T>', whenToUse: '构建 fixed-node React adapter。', example: 'countSignal' },
      { name: 'runtime', description: '拥有 node 并调度 notification 的准确 Runtime。', defaultValue: '必填', optional: false, type: 'IRuntime', whenToUse: '保留 ownership 与 untracked notification context。', example: 'countSignal.runtime' },
      { name: 'enabled', description: '不条件调用 hook，仅控制 subscription。', defaultValue: 'true', type: 'boolean', whenToUse: '保持 hook order，同时禁用 direct source。', example: 'providerStore === undefined' }
    ]
  }),
  'store-react:index:useAtomValue': createStoreReactHookGuide({
    purposeEn: 'Reads a synchronous Atom. Inside StoreProvider it prefers the Provider-local Atom Store for definitions; otherwise it observes the direct Atom node, while keeping hook order stable across both paths.',
    purposeZh: '读取 synchronous Atom。StoreProvider 内若存在 definition，则优先使用 Provider-local Atom Store；否则观察 direct Atom node，并在两条路径间保持稳定 hook order。',
    quickStart: 'const count = useAtomValue(countAtom)',
    scenariosEn: ['A component renders a readable Atom.', 'The same definition needs Provider-local isolation.', 'Direct Atom use must also work outside Provider.'],
    scenariosZh: ['component 渲染 readable Atom。', '同一 definition 需要 Provider-local isolation。', 'Provider 外也需要 direct Atom 使用。'],
    avoidEn: ['The Atom is asynchronous.', 'A setter is also required; use useAtom.', 'Reading an Atom definition directly from a Provider registry.'],
    avoidZh: ['Atom 是 asynchronous。', '还需要 setter；使用 useAtom。', '直接从 Provider registry 读取 Atom definition。'],
    optionsEn: [{ name: 'atom', description: 'Readable synchronous Atom, optionally carrying a Provider-resolvable definition.', defaultValue: 'required', optional: false, type: 'IReadableAtom<T>', whenToUse: 'Subscribe a component to one Atom value.', example: 'countAtom' }],
    optionsZh: [{ name: 'atom', description: '可选携带 Provider-resolvable definition 的 readable synchronous Atom。', defaultValue: '必填', optional: false, type: 'IReadableAtom<T>', whenToUse: '让 component 订阅一个 Atom value。', example: 'countAtom' }]
  }),
  'store-react:index:useSetAtom': createStoreReactHookGuide({
    purposeEn: 'Returns a stable writer for a writable Atom. When a matching Provider Atom Store exists it writes the definition there; otherwise it calls the Atom writer and preserves its argument and result contract.',
    purposeZh: '返回 writable Atom 的稳定 writer。存在 matching Provider Atom Store 时写对应 definition，否则调用 Atom writer，并保留其 argument 与 result contract。',
    quickStart: 'const increment = useSetAtom(countAtom)\n<button onClick={() => increment(1)}>Add</button>',
    scenariosEn: ['A control writes without reading the Atom.', 'Provider-local atom state must receive writes.', 'A derived writable Atom exposes a typed command.'],
    scenariosZh: ['control 只写不读 Atom。', 'write 必须进入 Provider-local atom state。', 'derived writable Atom 暴露 typed command。'],
    avoidEn: ['The Atom is read-only.', 'The component also renders the current value; use useAtom.', 'Calling the writer during render.'],
    avoidZh: ['Atom 是 read-only。', 'component 还渲染 current value；使用 useAtom。', '在 render 中调用 writer。'],
    optionsEn: [{ name: 'atom', description: 'Writable Atom whose typed write method or Provider definition receives calls.', defaultValue: 'required', optional: false, type: 'IWritableAtom<T, Args, Result>', whenToUse: 'Bind an event handler to Atom mutation.', example: 'countAtom' }],
    optionsZh: [{ name: 'atom', description: '其 typed write method 或 Provider definition 接收调用的 writable Atom。', defaultValue: '必填', optional: false, type: 'IWritableAtom<T, Args, Result>', whenToUse: '把 event handler 绑定到 Atom mutation。', example: 'countAtom' }]
  }),
  'store-react:index:useAtom': createStoreReactHookGuide({
    purposeEn: 'Combines useAtomValue and useSetAtom into a readonly [value, writer] pair while preserving the same Provider-local or direct Atom source selection.',
    purposeZh: '把 useAtomValue 与 useSetAtom 组合为 readonly [value, writer] pair，并保留相同 Provider-local 或 direct Atom source selection。',
    quickStart: 'const [count, increment] = useAtom(countAtom)',
    scenariosEn: ['A component both renders and updates one Atom.', 'A form field needs a value/writer pair.', 'Provider isolation should apply to both reads and writes.'],
    scenariosZh: ['component 同时 render 与 update 一个 Atom。', 'form field 需要 value/writer pair。', 'Provider isolation 必须同时作用于 read 与 write。'],
    avoidEn: ['Only reading; use useAtomValue.', 'Only writing; use useSetAtom.', 'The Atom is asynchronous.'],
    avoidZh: ['只读；使用 useAtomValue。', '只写；使用 useSetAtom。', 'Atom 是 asynchronous。'],
    optionsEn: [{ name: 'atom', description: 'Writable synchronous Atom used for both subscription and mutation.', defaultValue: 'required', optional: false, type: 'IWritableAtom<T, Args, Result>', whenToUse: 'Bind one complete controlled Atom interaction.', example: 'countAtom' }],
    optionsZh: [{ name: 'atom', description: '同时用于 subscription 与 mutation 的 writable synchronous Atom。', defaultValue: '必填', optional: false, type: 'IWritableAtom<T, Args, Result>', whenToUse: '绑定一份完整 controlled Atom interaction。', example: 'countAtom' }]
  }),
  'store-react:index:useAsyncAtomValue': createStoreReactHookGuide({
    purposeEn: 'Reads an asynchronous Atom by delegating its Resource to useResourceValue. Pending work suspends, resolved data returns, and cancellation or failure reaches the nearest Error Boundary.',
    purposeZh: '把 asynchronous Atom 的 Resource 交给 useResourceValue 读取。pending work 会 suspend，resolved data 返回，cancellation 或 failure 到达最近 Error Boundary。',
    quickStart: 'const user = useAsyncAtomValue(userAtom)',
    scenariosEn: ['An async Atom is rendered under Suspense.', 'Atom loading follows shared Resource semantics.', 'An Error Boundary owns async Atom failures.'],
    scenariosZh: ['async Atom 在 Suspense 下渲染。', 'Atom loading 遵循共享 Resource semantics。', 'Error Boundary 拥有 async Atom failure。'],
    avoidEn: ['Status-specific UI is required.', 'The Atom is synchronous.', 'No Suspense/Error Boundary surrounds the component.'],
    avoidZh: ['需要 status-specific UI。', 'Atom 是 synchronous。', 'component 外没有 Suspense/Error Boundary。'],
    optionsEn: [{ name: 'atom', description: 'Asynchronous Atom exposing the Resource that owns its state and promise.', defaultValue: 'required', optional: false, type: 'IAsyncAtom<T>', whenToUse: 'Read one async Atom through Suspense.', example: 'userAtom' }],
    optionsZh: [{ name: 'atom', description: '暴露拥有 state 与 promise 的 Resource 的 asynchronous Atom。', defaultValue: '必填', optional: false, type: 'IAsyncAtom<T>', whenToUse: '通过 Suspense 读取一个 async Atom。', example: 'userAtom' }]
  }),
  'store-react:index:useAtomDefinition': createStoreReactHookGuide({
    purposeEn: 'Reads an Atom definition from the nearest StoreProvider Atom Store. It subscribes through the store and uses preview for repeatable speculative snapshots without publishing dependency edges.',
    purposeZh: '从最近 StoreProvider Atom Store 读取 Atom definition。通过 store subscribe，并用 preview 生成可重复 speculative snapshot，不发布 dependency edge。',
    quickStart: 'const count = useAtomDefinition(countDefinition)',
    scenariosEn: ['Provider-local atom state is required.', 'One definition has isolated values in sibling Providers.', 'React snapshots must not publish speculative dependency edges.'],
    scenariosZh: ['需要 Provider-local atom state。', '同一 definition 在 sibling Provider 中拥有隔离 value。', 'React snapshot 不得发布 speculative dependency edge。'],
    avoidEn: ['There is no StoreProvider.', 'A direct instantiated Atom is already available.', 'A writer is required without reading.'],
    avoidZh: ['没有 StoreProvider。', '已经有 direct instantiated Atom。', '只需要 writer 而不读取。'],
    optionsEn: [{ name: 'definition', description: 'Atom definition resolved and previewed by the Provider-local Atom Store.', defaultValue: 'required', optional: false, type: 'IAtomDefinition<T>', whenToUse: 'Read isolated atom state by definition.', example: 'countDefinition' }],
    optionsZh: [{ name: 'definition', description: '由 Provider-local Atom Store resolve 与 preview 的 Atom definition。', defaultValue: '必填', optional: false, type: 'IAtomDefinition<T>', whenToUse: '按 definition 读取隔离 atom state。', example: 'countDefinition' }]
  }),
  'store-react:index:useSetAtomDefinition': createStoreReactHookGuide({
    purposeEn: 'Returns a stable typed writer for a writable Atom definition in the nearest StoreProvider Atom Store. It never instantiates or writes a direct Atom outside that registry.',
    purposeZh: '返回最近 StoreProvider Atom Store 中 writable Atom definition 的稳定 typed writer。它不会在 registry 外 instantiate 或 write direct Atom。',
    quickStart: 'const increment = useSetAtomDefinition(countDefinition)',
    scenariosEn: ['An event handler updates Provider-local atom state.', 'A writable family member is addressed by definition.', 'A component only needs the command path.'],
    scenariosZh: ['event handler 更新 Provider-local atom state。', '按 definition 定位 writable family member。', 'component 只需要 command path。'],
    avoidEn: ['There is no StoreProvider.', 'The definition is read-only.', 'The component also needs its current value.'],
    avoidZh: ['没有 StoreProvider。', 'definition 是 read-only。', 'component 还需要 current value。'],
    optionsEn: [{ name: 'definition', description: 'Writable definition whose command is executed by the Provider-local Atom Store.', defaultValue: 'required', optional: false, type: 'IWritableAtomDefinition<T, Args, Result>', whenToUse: 'Write isolated atom state by definition.', example: 'countDefinition' }],
    optionsZh: [{ name: 'definition', description: '其 command 由 Provider-local Atom Store 执行的 writable definition。', defaultValue: '必填', optional: false, type: 'IWritableAtomDefinition<T, Args, Result>', whenToUse: '按 definition 写隔离 atom state。', example: 'countDefinition' }]
  }),
  'store-react:index:StoreProvider': createStoreReactHookGuide({
    purposeEn: 'Establishes one React subtree ownership boundary for a Store Registry, Runtime, Atom Store, feature configuration, and readiness barriers. Internal registries are owned by default; external registries remain caller-owned unless explicitly opted in.',
    purposeZh: '为 React subtree 建立 Store Registry、Runtime、Atom Store、feature config 与 readiness barrier 的统一 ownership boundary。internal registry 默认由 Provider 拥有；external registry 除非显式选择，否则仍由 caller 拥有。',
    quickStart: '<StoreProvider runtime={runtime} config={{ ready: [loadSettings], fallback: <Spinner /> }}>\n  <Application />\n</StoreProvider>',
    scenariosEn: ['A subtree needs Provider-local Atom definitions.', 'Rendering must wait for hydration or WASM readiness.', 'Sibling trees require isolated registries on one Runtime.'],
    scenariosZh: ['subtree 需要 Provider-local Atom definition。', 'render 必须等待 hydration 或 WASM readiness。', 'sibling tree 在同一 Runtime 上需要隔离 registry。'],
    avoidEn: ['Only direct Signal or Atom hooks are used.', 'A registry from another Runtime would be injected.', 'Readiness can safely occur after children render.'],
    avoidZh: ['只使用 direct Signal 或 Atom hook。', '将注入属于另一个 Runtime 的 registry。', 'readiness 可以安全地在 children render 后完成。'],
    optionsEn: [
      { name: 'children', description: 'React subtree receiving registry and normalized configuration contexts.', defaultValue: 'required', optional: false, type: 'ReactNode', whenToUse: 'Wrap every consumer requiring this ownership boundary.', example: '<Application />' },
      { name: 'registry', description: 'Optional externally created Registry; its Runtime must match runtime when both are supplied.', defaultValue: 'internally created Registry', type: 'StoreRegistry', whenToUse: 'Share an SSR/request registry or pre-register stores before render.', example: 'requestRegistry' },
      { name: 'runtime', description: 'Runtime for an internally created Registry.', defaultValue: 'new Runtime', type: 'IRuntime', whenToUse: 'Bind the subtree to an existing application or request Runtime.', example: 'runtime' },
      { name: 'disposeOnUnmount', description: 'Controls Registry disposal after the last retained Provider unmounts; StrictMode replay is task-delayed.', defaultValue: 'true for internal; false for external', type: 'boolean', whenToUse: 'Opt external ownership into Provider cleanup only deliberately.', example: 'false' },
      { name: 'config.features.wasm', description: 'Enables the wasm feature path and requires at least one readiness barrier.', defaultValue: 'false', type: 'boolean', whenToUse: 'Gate children that call WASM-backed Store APIs.', example: 'true' },
      { name: 'config.features.experimental', description: 'Strict-true allowlist for experimental feature paths.', defaultValue: '{}', type: 'Readonly<Record<string, boolean>>', whenToUse: 'Enable named experimental APIs for this subtree only.', example: "{ optimisticBatch: true }" },
      { name: 'config.ready', description: 'Promises or zero-argument factories that must all resolve before children render.', defaultValue: '[]', type: 'readonly IStoreReadyBarrier[]', whenToUse: 'Block the subtree on hydration, initialization, or capability readiness.', example: '[loadSettings, ensureWasm]' },
      { name: 'config.fallback', description: 'Content rendered while readiness remains pending.', defaultValue: 'null', type: 'ReactNode', whenToUse: 'Provide a stable loading surface for the gated subtree.', example: '<Spinner />' },
      { name: 'config.defaults.warnAsyncActions', description: 'Readonly business-default snapshot; it does not configure Store instances automatically.', defaultValue: 'false', type: 'boolean', whenToUse: 'Let descendants read a shared preferred default and pass it explicitly when creating Stores.', example: 'true' }
    ],
    optionsZh: [
      { name: 'children', description: '接收 registry 与 normalized config context 的 React subtree。', defaultValue: '必填', optional: false, type: 'ReactNode', whenToUse: '包住所有需要该 ownership boundary 的 consumer。', example: '<Application />' },
      { name: 'registry', description: '可选 external Registry；若同时提供 runtime，两者必须相同。', defaultValue: '内部创建 Registry', type: 'StoreRegistry', whenToUse: '共享 SSR/request registry，或在 render 前预注册 store。', example: 'requestRegistry' },
      { name: 'runtime', description: '内部创建 Registry 使用的 Runtime。', defaultValue: 'new Runtime', type: 'IRuntime', whenToUse: '把 subtree 绑定到已有 application/request Runtime。', example: 'runtime' },
      { name: 'disposeOnUnmount', description: '最后一个 retained Provider unmount 后是否 dispose Registry；StrictMode replay 会延迟到 task。', defaultValue: 'internal 为 true；external 为 false', type: 'boolean', whenToUse: '只有明确转移 external ownership 时才让 Provider cleanup。', example: 'false' },
      { name: 'config.features.wasm', description: '启用 wasm feature path，并要求至少一个 readiness barrier。', defaultValue: 'false', type: 'boolean', whenToUse: 'children 会调用 WASM-backed Store API 时 gate。', example: 'true' },
      { name: 'config.features.experimental', description: 'experimental feature path 的 strict-true allowlist。', defaultValue: '{}', type: 'Readonly<Record<string, boolean>>', whenToUse: '只为当前 subtree 启用具名 experimental API。', example: "{ optimisticBatch: true }" },
      { name: 'config.ready', description: 'children render 前必须全部 resolve 的 Promise 或零参 factory。', defaultValue: '[]', type: 'readonly IStoreReadyBarrier[]', whenToUse: '用 hydration、initialization 或 capability readiness 阻挡 subtree。', example: '[loadSettings, ensureWasm]' },
      { name: 'config.fallback', description: 'readiness pending 期间渲染的 content。', defaultValue: 'null', type: 'ReactNode', whenToUse: '为 gated subtree 提供稳定 loading surface。', example: '<Spinner />' },
      { name: 'config.defaults.warnAsyncActions', description: '只读 business-default snapshot；不会自动配置 Store instance。', defaultValue: 'false', type: 'boolean', whenToUse: '让 descendant 读取 shared preference，再在 create Store 时显式传入。', example: 'true' }
    ]
  }),
  'store-react:index:createStoreToken': createStoreReactHookGuide({
    purposeEn: 'Creates a frozen, type-carrying Registry token with a unique Symbol identity and human debug name. Tokens are capabilities: sharing the same value object is the only way to address the same registration.',
    purposeZh: '创建带 unique Symbol identity、human debug name 与 value type 的 frozen Registry token。token 是 capability；只有共享同一个 value object 才能访问同一 registration。',
    quickStart: "const settingsToken = createStoreToken<SettingsStore>('settings')",
    scenariosEn: ['A Store is injected through StoreProvider.', 'Two Stores share a value type but need distinct identities.', 'Diagnostics need a stable human label.'],
    scenariosZh: ['Store 通过 StoreProvider 注入。', '两个 Store value type 相同但需要不同 identity。', 'diagnostic 需要稳定 human label。'],
    avoidEn: ['Using string keys as interchangeable identifiers.', 'Creating the token inside render.', 'The store never crosses a Provider boundary.'],
    avoidZh: ['把 string key 当成可互换 identifier。', '在 render 内创建 token。', 'store 从不跨 Provider boundary。'],
    optionsEn: [{ name: 'debugName', description: 'Non-empty diagnostic label used in missing and duplicate errors.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Name the semantic store role, not an instance id.', example: "'settings'" }],
    optionsZh: [{ name: 'debugName', description: 'missing 与 duplicate error 使用的非空 diagnostic label。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '命名 semantic store role，而不是 instance id。', example: "'settings'" }]
  }),
  'store-react:index:createStoreRegistry': createStoreReactHookGuide({
    purposeEn: 'Creates a Runtime-bound Store Registry and its Provider-local Atom Store. Omitting runtime creates an isolated Runtime; injected values owned by another Runtime are rejected.',
    purposeZh: '创建 Runtime-bound Store Registry 及其 Provider-local Atom Store。省略 runtime 会创建隔离 Runtime；属于其他 Runtime 的 injected value 会被拒绝。',
    quickStart: 'const registry = createStoreRegistry(requestRuntime)\nregistry.register(settingsToken, settingsStore)',
    scenariosEn: ['An SSR request needs an isolated registry.', 'Stores must be registered before React render.', 'Registry disposal ownership is managed outside StoreProvider.'],
    scenariosZh: ['SSR request 需要隔离 registry。', 'Store 必须在 React render 前注册。', 'Registry disposal ownership 在 StoreProvider 外管理。'],
    avoidEn: ['A default internal StoreProvider registry is sufficient.', 'Values come from different Runtimes.', 'The registry cannot be disposed at the owner boundary.'],
    avoidZh: ['默认 internal StoreProvider registry 已足够。', 'value 来自不同 Runtime。', '无法在 owner boundary dispose registry。'],
    optionsEn: [{ name: 'runtime', description: 'Runtime owning the Registry, Atom Store, and all accepted Reactive values.', defaultValue: 'createRuntime()', type: 'IRuntime', whenToUse: 'Reuse a request or application Runtime explicitly.', example: 'requestRuntime' }],
    optionsZh: [{ name: 'runtime', description: '拥有 Registry、Atom Store 与全部 accepted Reactive value 的 Runtime。', defaultValue: 'createRuntime()', type: 'IRuntime', whenToUse: '显式复用 request 或 application Runtime。', example: 'requestRuntime' }]
  }),
  'store-react:index:StoreRegistry': createStoreReactHookGuide({
    purposeEn: 'Owns token registrations and one isolated Atom Store on a single Runtime. Registration can be borrowed or owned; replacement and removal dispose only owned values, while whole-registry disposal runs in reverse registration order and tracks async completion.',
    purposeZh: '在单一 Runtime 上拥有 token registration 与隔离 Atom Store。registration 可 borrowed 或 owned；replace/remove 只 dispose owned value，whole-registry disposal 按 reverse registration order 执行并追踪 async completion。',
    quickStart: 'const registry = new StoreRegistry(runtime)\nconst unregister = registry.register(settingsToken, settingsStore, { owned: true })\nawait registry.disposeAsync()',
    scenariosEn: ['A request scope owns several Stores.', 'Replacement must clean the previous owned value.', 'Async disposers require awaitable terminal completion.'],
    scenariosZh: ['request scope 拥有多个 Store。', 'replacement 必须 cleanup previous owned value。', 'async disposer 需要可 await terminal completion。'],
    avoidEn: ['Mixing values from different Runtimes.', 'Reusing a disposed Registry.', 'Treating register return cleanup as whole-registry completion.'],
    avoidZh: ['混用不同 Runtime 的 value。', '复用 disposed Registry。', '把 register 返回 cleanup 当作 whole-registry completion。'],
    optionsEn: [
      { name: 'runtime', description: 'Single ownership Runtime for Registry and Atom Store.', defaultValue: 'createRuntime()', type: 'IRuntime', whenToUse: 'Construct an explicit Registry boundary.', example: 'runtime' },
      { name: 'register(token, value, options.owned)', description: 'Adds one unique token; owned values are disposed when registration ownership ends.', defaultValue: 'owned: false', type: 'boolean', whenToUse: 'Choose true only when Registry owns final cleanup.', example: "registry.register(token, store, { owned: true })" },
      { name: 'replace(token, value, options.owned)', description: 'Atomically installs a value and disposes the distinct previous owned value.', defaultValue: 'owned: false', type: 'boolean', whenToUse: 'Hot-replace a registration without a missing interval.', example: "registry.replace(token, nextStore, { owned: true })" },
      { name: 'remove(token, disposeOwned)', description: 'Removes one registration and optionally disposes its owned value.', defaultValue: 'true', type: 'boolean', whenToUse: 'Detach one token before Registry shutdown.', example: 'registry.remove(token, false)' },
      { name: 'retain(disposeOnRelease)', description: 'Retains Provider ownership and returns an idempotent release; zero-owner disposal is task-delayed for StrictMode.', defaultValue: 'required', optional: false, type: 'boolean', whenToUse: 'Integrate Registry lifetime with a mounted Provider.', example: 'registry.retain(true)' },
      { name: 'dispose / disposeAsync', description: 'Starts idempotent reverse cleanup; async form waits for all tracked thenables and aggregates multiple failures.', defaultValue: 'explicit owner action', type: '() => void | Promise<void>', whenToUse: 'Use disposeAsync when completion or async failures matter.', example: 'await registry.disposeAsync()' }
    ],
    optionsZh: [
      { name: 'runtime', description: 'Registry 与 Atom Store 的单一 ownership Runtime。', defaultValue: 'createRuntime()', type: 'IRuntime', whenToUse: '构造显式 Registry boundary。', example: 'runtime' },
      { name: 'register(token, value, options.owned)', description: '添加 unique token；owned value 在 registration ownership 结束时 dispose。', defaultValue: 'owned: false', type: 'boolean', whenToUse: '只有 Registry 拥有最终 cleanup 时才设 true。', example: "registry.register(token, store, { owned: true })" },
      { name: 'replace(token, value, options.owned)', description: '原子安装新 value，并 dispose 不同的 previous owned value。', defaultValue: 'owned: false', type: 'boolean', whenToUse: '无 missing interval 地 hot-replace registration。', example: "registry.replace(token, nextStore, { owned: true })" },
      { name: 'remove(token, disposeOwned)', description: '移除一个 registration，并可选择 dispose 其 owned value。', defaultValue: 'true', type: 'boolean', whenToUse: 'Registry shutdown 前 detach 一个 token。', example: 'registry.remove(token, false)' },
      { name: 'retain(disposeOnRelease)', description: 'retain Provider ownership 并返回 idempotent release；StrictMode 下 zero-owner disposal 延迟到 task。', defaultValue: '必填', optional: false, type: 'boolean', whenToUse: '把 Registry lifetime 接入 mounted Provider。', example: 'registry.retain(true)' },
      { name: 'dispose / disposeAsync', description: '启动 idempotent reverse cleanup；async 形式等待全部 tracked thenable，并聚合多 failure。', defaultValue: 'owner 显式调用', type: '() => void | Promise<void>', whenToUse: '需要 completion 或 async failure 时使用 disposeAsync。', example: 'await registry.disposeAsync()' }
    ]
  }),
  'store-react:index:useStoreRegistry': createStoreReactHookGuide({
    purposeEn: 'Returns the nearest StoreProvider Registry and fails in render with PROVIDER_REQUIRED when no Provider exists.',
    purposeZh: '返回最近 StoreProvider Registry；没有 Provider 时在 render 阶段以 PROVIDER_REQUIRED 失败。',
    quickStart: 'const registry = useStoreRegistry()',
    scenariosEn: ['A component needs advanced Registry operations.', 'A custom Provider-aware hook needs the Atom Store.', 'A subtree verifies its ownership boundary.'],
    scenariosZh: ['component 需要高级 Registry operation。', 'custom Provider-aware hook 需要 Atom Store。', 'subtree 验证自身 ownership boundary。'],
    avoidEn: ['Only a registered Store value is needed.', 'The hook should work outside Provider.', 'Mutation can be expressed through a narrower hook.'],
    avoidZh: ['只需要 registered Store value。', 'hook 必须能在 Provider 外工作。', 'mutation 可通过更窄 hook 表达。'],
    optionsEn: [], optionsZh: []
  }),
  'store-react:index:useStoreRuntime': createStoreReactHookGuide({
    purposeEn: 'Returns the Runtime owned by the nearest StoreProvider Registry. Missing Provider uses the same explicit PROVIDER_REQUIRED failure as useStoreRegistry.',
    purposeZh: '返回最近 StoreProvider Registry 拥有的 Runtime。缺少 Provider 时与 useStoreRegistry 一样显式抛 PROVIDER_REQUIRED。',
    quickStart: 'const runtime = useStoreRuntime()',
    scenariosEn: ['A descendant creates Runtime-owned nodes.', 'A custom adapter must preserve Provider ownership.', 'Sibling Provider scopes need different Runtimes.'],
    scenariosZh: ['descendant 创建 Runtime-owned node。', 'custom adapter 必须保留 Provider ownership。', 'sibling Provider scope 需要不同 Runtime。'],
    avoidEn: ['Using the global default Runtime intentionally.', 'No Provider exists.', 'Only a Store selector is needed.'],
    avoidZh: ['有意使用 global default Runtime。', '不存在 Provider。', '只需要 Store selector。'],
    optionsEn: [], optionsZh: []
  }),
  'store-react:index:useStoreFromProvider': createStoreReactHookGuide({
    purposeEn: 'Requires and returns one token-registered value from the nearest Registry. Missing Provider and missing token are distinct failures.',
    purposeZh: '从最近 Registry require 并返回一个 token-registered value。缺少 Provider 与缺少 token 是两种不同 failure。',
    quickStart: 'const settings = useStoreFromProvider(settingsToken)',
    scenariosEn: ['A component needs the complete injected service or Store.', 'Token identity is shared from a composition root.', 'Missing registration must fail rather than return undefined.'],
    scenariosZh: ['component 需要完整 injected service 或 Store。', 'token identity 从 composition root 共享。', '缺少 registration 必须失败而不是返回 undefined。'],
    avoidEn: ['Only a reactive Store slice is needed.', 'Optional absence is normal.', 'The token is recreated inside render.'],
    avoidZh: ['只需要 reactive Store slice。', 'optional absence 是正常情况。', 'token 在 render 内重新创建。'],
    optionsEn: [{ name: 'token', description: 'Exact capability token used when registering the value.', defaultValue: 'required', optional: false, type: 'IStoreToken<T>', whenToUse: 'Resolve one required registration by identity.', example: 'settingsToken' }],
    optionsZh: [{ name: 'token', description: 'register value 时使用的同一个 capability token。', defaultValue: '必填', optional: false, type: 'IStoreToken<T>', whenToUse: '按 identity resolve 一个 required registration。', example: 'settingsToken' }]
  }),
  'store-react:index:useProvidedStore': createStoreReactHookGuide({
    purposeEn: 'Resolves a token-registered Store and selects a dependency-tracked result through useStore. It combines Provider requirement, token requirement, async readiness, and selector equality.',
    purposeZh: 'resolve token-registered Store，并通过 useStore 选择 dependency-tracked result。组合 Provider requirement、token requirement、async readiness 与 selector equality。',
    quickStart: 'const theme = useProvidedStore(settingsToken, (state) => state.theme)',
    scenariosEn: ['A component selects from an injected Store.', 'Provider composition owns Store identity.', 'Only selected fields should rerender the component.'],
    scenariosZh: ['component 从 injected Store 选择数据。', 'Provider composition 拥有 Store identity。', '只有 selected field 应 rerender component。'],
    avoidEn: ['The complete Store object is required.', 'The Store is not registered.', 'The selector performs side effects.'],
    avoidZh: ['需要完整 Store object。', 'Store 尚未 register。', 'selector 执行 side effect。'],
    optionsEn: [
      { name: 'token', description: 'Token registered with one Reactive Store.', defaultValue: 'required', optional: false, type: 'IStoreToken<IReactiveStore<S>>', whenToUse: 'Resolve the Store from Provider composition.', example: 'settingsToken' },
      { name: 'selector', description: 'Pure Store selector whose Reactive reads define rerender dependencies.', defaultValue: 'required', optional: false, type: '(state: IStoreShape<S>) => Result', whenToUse: 'Return the smallest value needed by this component.', example: '(state) => state.theme' },
      { name: 'isEqual', description: 'Optional equality for selector results.', defaultValue: 'Object.is', type: '(left: Result, right: Result) => boolean', whenToUse: 'Suppress equivalent allocated results.', example: 'shallowEqual' }
    ],
    optionsZh: [
      { name: 'token', description: '与一个 Reactive Store registration 对应的 token。', defaultValue: '必填', optional: false, type: 'IStoreToken<IReactiveStore<S>>', whenToUse: '从 Provider composition resolve Store。', example: 'settingsToken' },
      { name: 'selector', description: '其 Reactive read 定义 rerender dependency 的纯 Store selector。', defaultValue: '必填', optional: false, type: '(state: IStoreShape<S>) => Result', whenToUse: '返回当前 component 所需最小 value。', example: '(state) => state.theme' },
      { name: 'isEqual', description: 'selector result 的可选 equality。', defaultValue: 'Object.is', type: '(left: Result, right: Result) => boolean', whenToUse: '抑制等价 allocated result。', example: 'shallowEqual' }
    ]
  }),
  'store-react:index:normalizeStoreConfig': createStoreReactHookGuide({
    purposeEn: 'Normalizes feature flags, readonly defaults, and readiness barriers into the same immutable configuration consumed by StoreProvider. Barrier results are cached within barrierScope, and invalid entries fail before rendering.',
    purposeZh: '把 feature flag、readonly default 与 readiness barrier 归一化为 StoreProvider 使用的同一 immutable config。barrier result 在 barrierScope 内缓存，invalid entry 会在 render 前失败。',
    quickStart: 'const normalized = normalizeStoreConfig({ features: { wasm: true }, ready: [ensureWasm] }, requestScope)',
    scenariosEn: ['SSR needs Provider-equivalent config normalization.', 'Readiness factories need request-local caching.', 'A custom host inspects normalized feature gates.'],
    scenariosZh: ['SSR 需要与 Provider 等价的 config normalization。', 'readiness factory 需要 request-local caching。', 'custom host 检查 normalized feature gate。'],
    avoidEn: ['Mutating the returned configuration.', 'Sharing one scope across isolated requests.', 'Enabling wasm without an actual readiness barrier.'],
    avoidZh: ['mutation returned config。', '在隔离 request 间共享同一 scope。', '没有真实 readiness barrier 却启用 wasm。'],
    optionsEn: [
      { name: 'config.features', description: 'WASM flag and strict-true experimental allowlist.', defaultValue: 'all disabled', type: 'IStoreFeatures', whenToUse: 'Declare capabilities available to one tree.', example: "{ wasm: true, experimental: { optimisticBatch: true } }" },
      { name: 'config.ready', description: 'Promise or zero-argument factory list normalized into one tracked readiness promise.', defaultValue: '[]', type: 'readonly IStoreReadyBarrier[]', whenToUse: 'Gate use until initialization completes.', example: '[ensureWasm, hydrateSettings]' },
      { name: 'config.fallback', description: 'UI rendered while the readiness barrier is pending. It is deliberately excluded from the normalized business configuration so a placeholder cannot be mistaken for loaded Store data.', defaultValue: 'undefined', type: 'ReactNode', whenToUse: 'Pass through StoreProvider when a pending UI is needed.', example: '<Spinner />' },
      { name: 'config.defaults', description: 'Readonly business defaults snapshot; no Store is configured automatically.', defaultValue: '{ warnAsyncActions: false }', type: 'IStoreProviderDefaults', whenToUse: 'Expose shared preferences to descendants.', example: '{ warnAsyncActions: true }' },
      { name: 'barrierScope', description: 'Identity boundary for readiness Promise and factory-result caches.', defaultValue: 'new object', type: 'object', whenToUse: 'Reuse within one Provider/request and isolate across owners.', example: 'requestScope' }
    ],
    optionsZh: [
      { name: 'config.features', description: 'WASM flag 与 strict-true experimental allowlist。', defaultValue: '全部关闭', type: 'IStoreFeatures', whenToUse: '声明一个 tree 可用的 capability。', example: "{ wasm: true, experimental: { optimisticBatch: true } }" },
      { name: 'config.ready', description: '归一化为一个 tracked readiness promise 的 Promise 或零参 factory list。', defaultValue: '[]', type: 'readonly IStoreReadyBarrier[]', whenToUse: '初始化完成前 gate 使用。', example: '[ensureWasm, hydrateSettings]' },
      { name: 'config.fallback', description: 'readiness barrier 等待期间显示的界面；它不会进入归一化业务配置，避免占位内容被误认为已经加载的 Store 数据。', defaultValue: 'undefined', type: 'ReactNode', whenToUse: '需要 pending UI 时通过 StoreProvider 传入。', example: '<Spinner />' },
      { name: 'config.defaults', description: '只读 business default snapshot；不会自动配置任何 Store。', defaultValue: '{ warnAsyncActions: false }', type: 'IStoreProviderDefaults', whenToUse: '向 descendant 暴露 shared preference。', example: '{ warnAsyncActions: true }' },
      { name: 'barrierScope', description: 'readiness Promise 与 factory-result cache 的 identity boundary。', defaultValue: '新 object', type: 'object', whenToUse: '在一个 Provider/request 内复用，并在 owner 之间隔离。', example: 'requestScope' }
    ]
  }),
  'store-react:index:readStoreFeature': createStoreReactHookGuide({
    purposeEn: 'Purely reads the normalized wasm or experimental.name feature path. Unknown and empty experimental paths return false rather than widening the enabled domain.',
    purposeZh: '纯读取 normalized wasm 或 experimental.name feature path。unknown 与 empty experimental path 返回 false，不会扩大 enabled domain。',
    quickStart: "if (readStoreFeature(config, 'experimental.optimisticBatch')) enableBatching()",
    scenariosEn: ['Non-React code checks a normalized feature.', 'A custom hook shares the canonical path semantics.', 'Unknown feature paths must fail closed.'],
    scenariosZh: ['非 React code 检查 normalized feature。', 'custom hook 共享 canonical path semantics。', 'unknown feature path 必须 fail closed。'],
    avoidEn: ['Throwing when disabled is required.', 'Reading unnormalized input.', 'Treating arbitrary strings as supported paths.'],
    avoidZh: ['disabled 时需要 throw。', '读取 unnormalized input。', '把任意 string 当作 supported path。'],
    optionsEn: [
      { name: 'config', description: 'Normalized Store configuration value.', defaultValue: 'required', optional: false, type: 'IStoreConfigValue', whenToUse: 'Read from normalizeStoreConfig or StoreProvider context.', example: 'config' },
      { name: 'path', description: "Canonical 'wasm' or experimental.name feature path.", defaultValue: 'required', optional: false, type: 'IStoreFeaturePath', whenToUse: 'Address one exact capability.', example: "'experimental.optimisticBatch'" }
    ],
    optionsZh: [
      { name: 'config', description: 'normalized Store config value。', defaultValue: '必填', optional: false, type: 'IStoreConfigValue', whenToUse: '从 normalizeStoreConfig 或 StoreProvider context 读取。', example: 'config' },
      { name: 'path', description: "canonical 'wasm' 或 experimental.name feature path。", defaultValue: '必填', optional: false, type: 'IStoreFeaturePath', whenToUse: '定位一个准确 capability。', example: "'experimental.optimisticBatch'" }
    ]
  }),
  'store-react:index:assertStoreFeature': createStoreReactHookGuide({
    purposeEn: 'Enforces one feature at an API boundary. Missing configuration throws PROVIDER_REQUIRED; a present but disabled path throws FEATURE_DISABLED, preserving separate remediation.',
    purposeZh: '在 API boundary 强制一个 feature。缺少 config 抛 PROVIDER_REQUIRED；config 存在但 path disabled 抛 FEATURE_DISABLED，保留不同 remediation。',
    quickStart: "assertStoreFeature(config, 'wasm', 'useWasmField')",
    scenariosEn: ['An enhanced API must fail closed.', 'Non-React integration enforces Provider-equivalent gates.', 'Diagnostics should name the guarded API.'],
    scenariosZh: ['enhanced API 必须 fail closed。', '非 React integration 强制 Provider-equivalent gate。', 'diagnostic 应命名 guarded API。'],
    avoidEn: ['Optional enhancement should silently remain off.', 'Only a boolean query is needed.', 'The path is not part of the feature contract.'],
    avoidZh: ['optional enhancement 应静默保持关闭。', '只需要 boolean query。', 'path 不属于 feature contract。'],
    optionsEn: [
      { name: 'config', description: 'Normalized configuration or null when no Provider/config exists.', defaultValue: 'required', optional: false, type: 'IStoreConfigValue | null', whenToUse: 'Pass the exact current tree configuration.', example: 'config' },
      { name: 'path', description: 'Required canonical feature path.', defaultValue: 'required', optional: false, type: 'IStoreFeaturePath', whenToUse: 'Name the capability the API depends on.', example: "'wasm'" },
      { name: 'apiName', description: 'Human API label included in the failure diagnostic.', defaultValue: "'this API'", type: 'string', whenToUse: 'Make remediation identify the calling surface.', example: "'useWasmField'" }
    ],
    optionsZh: [
      { name: 'config', description: 'normalized config；没有 Provider/config 时为 null。', defaultValue: '必填', optional: false, type: 'IStoreConfigValue | null', whenToUse: '传入当前 tree 的准确 config。', example: 'config' },
      { name: 'path', description: 'required canonical feature path。', defaultValue: '必填', optional: false, type: 'IStoreFeaturePath', whenToUse: '命名 API 依赖的 capability。', example: "'wasm'" },
      { name: 'apiName', description: '写入 failure diagnostic 的 human API label。', defaultValue: "'this API'", type: 'string', whenToUse: '让 remediation 指明 calling surface。', example: "'useWasmField'" }
    ]
  }),
  'store-react:index:useStoreConfig': createStoreReactHookGuide({
    purposeEn: 'Returns the normalized optional configuration from StoreProvider. Unlike Registry hooks, absence is valid and returns null.',
    purposeZh: '返回 StoreProvider 的 normalized optional config。与 Registry hook 不同，缺少 Provider 是合法情况并返回 null。',
    quickStart: 'const config = useStoreConfig()\nconst warn = config?.defaults.warnAsyncActions ?? false',
    scenariosEn: ['A descendant reads business defaults.', 'A custom optional enhancement inspects readiness.', 'The hook must also work outside Provider.'],
    scenariosZh: ['descendant 读取 business default。', 'custom optional enhancement 检查 readiness。', 'hook 也必须能在 Provider 外工作。'],
    avoidEn: ['Registry ownership is required.', 'Disabled features should throw.', 'Mutating normalized configuration.'],
    avoidZh: ['需要 Registry ownership。', 'disabled feature 应 throw。', 'mutation normalized config。'],
    optionsEn: [], optionsZh: []
  }),
  'store-react:index:useStoreFeature': createStoreReactHookGuide({
    purposeEn: 'Reads one feature from StoreProvider and returns false when no Provider exists. It is the optional-enhancement path and never throws for an absent tree configuration.',
    purposeZh: '从 StoreProvider 读取一个 feature；没有 Provider 时返回 false。它是 optional-enhancement 路径，不会因 tree config 缺失而 throw。',
    quickStart: "const wasmEnabled = useStoreFeature('wasm')",
    scenariosEn: ['UI optionally reveals an enhanced path.', 'A component chooses a fallback implementation.', 'Provider absence should mean disabled.'],
    scenariosZh: ['UI 可选展示 enhanced path。', 'component 选择 fallback implementation。', 'Provider absence 应表示 disabled。'],
    avoidEn: ['The API must reject disabled use.', 'A non-React caller already has config.', 'Path absence indicates a setup error.'],
    avoidZh: ['API 必须拒绝 disabled use。', '非 React caller 已经持有 config。', 'path absence 表示 setup error。'],
    optionsEn: [{ name: 'path', description: 'Canonical feature path read from current context.', defaultValue: 'required', optional: false, type: 'IStoreFeaturePath', whenToUse: 'Select one optional capability.', example: "'wasm'" }],
    optionsZh: [{ name: 'path', description: '从 current context 读取的 canonical feature path。', defaultValue: '必填', optional: false, type: 'IStoreFeaturePath', whenToUse: '选择一个 optional capability。', example: "'wasm'" }]
  }),
  'store-react:index:useAssertStoreFeature': createStoreReactHookGuide({
    purposeEn: 'React hook form of assertStoreFeature. It reads current configuration and fails in render when Provider is absent or the named feature is disabled.',
    purposeZh: 'assertStoreFeature 的 React hook 形式。读取 current config，并在 Provider 缺失或 named feature disabled 时于 render 阶段失败。',
    quickStart: "useAssertStoreFeature('experimental.optimisticBatch', 'useOptimisticBatch')",
    scenariosEn: ['An experimental hook enforces admission.', 'Failure must reach an Error Boundary from render.', 'Diagnostics should name the enhanced hook.'],
    scenariosZh: ['experimental hook 强制 admission。', 'failure 必须从 render 到达 Error Boundary。', 'diagnostic 应命名 enhanced hook。'],
    avoidEn: ['The enhancement is optional.', 'Called outside a React component or hook.', 'Only a boolean branch is needed.'],
    avoidZh: ['enhancement 是 optional。', '在 React component/hook 外调用。', '只需要 boolean branch。'],
    optionsEn: [
      { name: 'path', description: 'Feature required by the calling hook.', defaultValue: 'required', optional: false, type: 'IStoreFeaturePath', whenToUse: 'Guard the hook before enhanced work.', example: "'experimental.optimisticBatch'" },
      { name: 'apiName', description: 'Optional API label for the thrown diagnostic.', defaultValue: "'this API'", type: 'string', whenToUse: 'Identify the exact hook requiring enablement.', example: "'useOptimisticBatch'" }
    ],
    optionsZh: [
      { name: 'path', description: 'calling hook 所需 feature。', defaultValue: '必填', optional: false, type: 'IStoreFeaturePath', whenToUse: 'enhanced work 前 guard hook。', example: "'experimental.optimisticBatch'" },
      { name: 'apiName', description: 'thrown diagnostic 使用的 optional API label。', defaultValue: "'this API'", type: 'string', whenToUse: '标识需要 enablement 的准确 hook。', example: "'useOptimisticBatch'" }
    ]
  }),
  'store-react:index:StoreProviderState': createStoreReactHookGuide({
    purposeEn: 'Stable readiness state values pending, ready, and error used by tracked Provider barriers. They describe barrier observation, not Registry lifecycle or Resource state.',
    purposeZh: 'tracked Provider barrier 使用的稳定 readiness state：pending、ready、error。它描述 barrier observation，不是 Registry lifecycle 或 Resource state。',
    quickStart: 'if (config.ready?.status() === StoreProviderState.error) report(config.ready.error())',
    scenariosEn: ['Custom Provider UI inspects readiness.', 'SSR diagnostics report a rejected barrier.', 'Tests assert normalized config state.'],
    scenariosZh: ['custom Provider UI 检查 readiness。', 'SSR diagnostic 报告 rejected barrier。', '测试断言 normalized config state。'],
    avoidEn: ['Representing Resource loading.', 'Representing Registry closing.', 'Assigning state externally.'],
    avoidZh: ['表示 Resource loading。', '表示 Registry closing。', '从外部 assign state。'],
    optionsEn: [], optionsZh: []
  }),
  'store-react:index:STORE_REACT_SOURCE': createStoreReactHookGuide({
    purposeEn: 'Canonical source discriminator attached to every public Store React error. Combine it with StoreReactErrorCode while retaining native Error or AggregateError identity.',
    purposeZh: '附加到每个公开 Store React error 的 canonical source discriminator。与 StoreReactErrorCode 组合，同时保留 native Error 或 AggregateError identity。',
    quickStart: "if (error.source === STORE_REACT_SOURCE && error.code === StoreReactErrorCode.providerRequired) showSetupHelp()",
    scenariosEn: ['A shared reporter routes errors by owner.', 'A serialized boundary preserves source and code.', 'Tests assert public failure identity.'],
    scenariosZh: ['shared reporter 按 owner 路由 error。', 'serialized boundary 保留 source 与 code。', '测试断言 public failure identity。'],
    avoidEn: ['Selecting an individual error condition.', 'Replacing instanceof checks.', 'Copying the source string literal.'],
    avoidZh: ['选择具体 error condition。', '替代 instanceof check。', '复制 source string literal。'],
    optionsEn: [], optionsZh: []
  }),
  'store-react:index:createStoreReactError': createStoreReactHookGuide({
    purposeEn: 'Creates a native Error tagged with stable Store React source and code while preserving an optional original failure by cause and leaving both stacks untouched.',
    purposeZh: '创建带稳定 Store React source/code 的 native Error，通过 cause 保留 optional original failure，且不改写两者 stack。',
    quickStart: "throw createStoreReactError(StoreReactErrorCode.invalidConfig, 'Invalid config', { cause })",
    scenariosEn: ['A public boundary reports a semantic failure.', 'A lower-level failure needs Store React ownership.', 'Callers branch on source and code.'],
    scenariosZh: ['公开 boundary 报告 semantic failure。', 'lower-level failure 需要 Store React ownership。', 'caller 按 source 与 code 分支。'],
    avoidEn: ['Representing multiple failures.', 'Replacing an already tagged Error.', 'Dropping the original cause.'],
    avoidZh: ['表示多个 failure。', '替换已经 tagged 的 Error。', '丢失 original cause。'],
    optionsEn: [
      { name: 'code', description: 'Registered Store React semantic code.', defaultValue: 'required', optional: false, type: 'IStoreReactErrorCode', whenToUse: 'Choose the exact observed contract failure.', example: 'StoreReactErrorCode.invalidConfig' },
      { name: 'message', description: 'Human context; machine handling uses source and code.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Explain the failed operation.', example: "'Invalid Store Provider config'" },
      { name: 'options.cause', description: 'Optional original failure retained by identity.', defaultValue: 'undefined', type: 'unknown', whenToUse: 'Wrap a lower-level or hostile-access failure.', example: 'cause' }
    ],
    optionsZh: [
      { name: 'code', description: '已注册 Store React semantic code。', defaultValue: '必填', optional: false, type: 'IStoreReactErrorCode', whenToUse: '选择与实际 contract failure 对应的 code。', example: 'StoreReactErrorCode.invalidConfig' },
      { name: 'message', description: 'human context；machine handling 使用 source 与 code。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '说明 failed operation。', example: "'Invalid Store Provider config'" },
      { name: 'options.cause', description: '按 identity 保留的 optional original failure。', defaultValue: 'undefined', type: 'unknown', whenToUse: '包装 lower-level 或 hostile-access failure。', example: 'cause' }
    ]
  }),
  'store-react:index:createStoreReactAggregateError': createStoreReactHookGuide({
    purposeEn: 'Creates a native AggregateError tagged with Store React source and code. Every ordered input failure remains reachable through errors[].',
    purposeZh: '创建带 Store React source/code 的 native AggregateError。每个 ordered input failure 仍可通过 errors[] 到达。',
    quickStart: "throw createStoreReactAggregateError(StoreReactErrorCode.registryDisposalFailed, failures, 'Registry disposal failed')",
    scenariosEn: ['Several owned values fail during Registry disposal.', 'All cleanup failures must remain observable.', 'A caller needs native AggregateError handling.'],
    scenariosZh: ['多个 owned value 在 Registry disposal 中失败。', '全部 cleanup failure 必须保持 observable。', 'caller 需要 native AggregateError handling。'],
    avoidEn: ['Only one raw failure occurred.', 'Errors can be silently reduced to one.', 'The condition has no registered aggregate code.'],
    avoidZh: ['只有一个 raw failure。', '把多个 error 静默缩减为一个。', 'condition 没有 registered aggregate code。'],
    optionsEn: [
      { name: 'code', description: 'Registered aggregate failure code.', defaultValue: 'required', optional: false, type: 'IStoreReactErrorCode', whenToUse: 'Use registryDisposalFailed for Registry teardown aggregation.', example: 'StoreReactErrorCode.registryDisposalFailed' },
      { name: 'errors', description: 'Ordered original failures retained in AggregateError.errors.', defaultValue: 'required', optional: false, type: 'readonly unknown[]', whenToUse: 'Preserve every cleanup reason.', example: 'failures' },
      { name: 'message', description: 'Human summary for the aggregate operation.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Describe the shared failing operation.', example: "'Registry disposal failed'" }
    ],
    optionsZh: [
      { name: 'code', description: '已注册 aggregate failure code。', defaultValue: '必填', optional: false, type: 'IStoreReactErrorCode', whenToUse: 'Registry teardown aggregation 使用 registryDisposalFailed。', example: 'StoreReactErrorCode.registryDisposalFailed' },
      { name: 'errors', description: '按顺序保留在 AggregateError.errors 的 original failure。', defaultValue: '必填', optional: false, type: 'readonly unknown[]', whenToUse: '保留每一个 cleanup reason。', example: 'failures' },
      { name: 'message', description: 'aggregate operation 的 human summary。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '描述共同 failing operation。', example: "'Registry disposal failed'" }
    ]
  }),
  'store-middleware:index:MiddlewareEventType': {
    en: {
      purpose: 'Defines the action, state, and error discriminators for every Store Middleware event. Branch on this value before reading phase, previous/next, or error-specific fields.',
      quickStart: "if (event.type === MiddlewareEventType.state) {\n  persistDiff(event.previous, event.next)\n}",
      scenarios: ['A plugin narrows the event union safely.', 'Telemetry groups action, state, and error records.', 'An adapter maps Store events into another protocol.'],
      avoidWhen: ['Selecting an action phase.', 'Selecting a DevTools command.', 'Using arbitrary strings outside the event contract.'],
      options: []
    },
    zh: {
      purpose: '定义每个 Store Middleware event 的 action、state、error discriminator。读取 phase、previous/next 或 error-specific field 前应先按它缩小类型。',
      quickStart: "if (event.type === MiddlewareEventType.state) {\n  persistDiff(event.previous, event.next)\n}",
      scenarios: ['plugin 安全缩小 event union。', 'telemetry 聚合 action、state 与 error record。', 'adapter 把 Store event 映射到其他 protocol。'],
      avoidWhen: ['选择 action phase。', '选择 DevTools command。', '在 event contract 外使用任意 string。'],
      options: []
    }
  },
  'store-middleware:index:MiddlewareEventPhase': {
    en: {
      purpose: 'Defines start, end, and error phases for action events. A successful action emits start then end; a failing action emits start then error and rethrows the original business failure.',
      quickStart: "if (event.type === MiddlewareEventType.action && event.phase === MiddlewareEventPhase.end) {\n  recordDuration(event.durationMs)\n}",
      scenarios: ['A plugin measures completed action duration.', 'Diagnostics distinguish successful and failed action completion.', 'An adapter creates stable action labels.'],
      avoidWhen: ['Classifying state or error event types.', 'Representing arbitrary business workflow phases.', 'Assuming an end event exists after a thrown action.'],
      options: []
    },
    zh: {
      purpose: '定义 action event 的 start、end、error phase。成功 action 发出 start 后 end；失败 action 发出 start 后 error，并重新抛原始 business failure。',
      quickStart: "if (event.type === MiddlewareEventType.action && event.phase === MiddlewareEventPhase.end) {\n  recordDuration(event.durationMs)\n}",
      scenarios: ['plugin 测量 completed action duration。', 'diagnostic 区分 action 成功或失败完成。', 'adapter 创建稳定 action label。'],
      avoidWhen: ['分类 state 或 error event type。', '表示任意 business workflow phase。', '假定 throw 的 action 之后仍有 end event。'],
      options: []
    }
  },
  'store-middleware:index:MiddlewareCommandType': {
    en: {
      purpose: 'Defines normalized DevTools commands: commit reinitializes the displayed baseline, while jump and reset apply a supplied state through Host applyState inside a visible action.',
      quickStart: "if (command.type === MiddlewareCommandType.commit) {\n  adapter.init(hostState)\n}",
      scenarios: ['A DevTools adapter normalizes extension dispatch messages.', 'Host logic distinguishes baseline commit from state application.', 'Tests assert typed time-travel commands.'],
      avoidWhen: ['Representing middleware event types.', 'Assuming jump/reset can restore external side effects.', 'Sending state commands without Host applyState capability.'],
      options: []
    },
    zh: {
      purpose: '定义 normalized DevTools command：commit 重新初始化显示 baseline；jump/reset 通过 Host applyState 在可见 action 内应用 supplied state。',
      quickStart: "if (command.type === MiddlewareCommandType.commit) {\n  adapter.init(hostState)\n}",
      scenarios: ['DevTools adapter 规范化 extension dispatch message。', 'Host logic 区分 baseline commit 与 state application。', '测试断言 typed time-travel command。'],
      avoidWhen: ['表示 middleware event type。', '假定 jump/reset 能恢复 external side effect。', 'Host 没有 applyState capability 却发送 state command。'],
      options: []
    }
  },
  'store-middleware:index:STORE_MIDDLEWARE_SOURCE': {
    en: {
      purpose: 'Exposes the canonical source discriminator attached to Store Middleware boundary errors. Compare it with code for routing and telemetry; never infer semantics by parsing messages.',
      quickStart: "if (error.source === STORE_MIDDLEWARE_SOURCE) {\n  handleMiddlewareCode(error.code)\n}",
      scenarios: ['A shared reporter routes errors by library ownership.', 'Telemetry groups middleware failures by source/code.', 'A catch boundary distinguishes middleware errors from Store state errors.'],
      avoidWhen: ['Displaying a user-facing message.', 'Determining native error class.', 'Using source without also inspecting code.'],
      options: []
    },
    zh: {
      purpose: '暴露附加到 Store Middleware boundary error 的 canonical source discriminator。路由与 telemetry 应同时比较 code，绝不解析 message 推断语义。',
      quickStart: "if (error.source === STORE_MIDDLEWARE_SOURCE) {\n  handleMiddlewareCode(error.code)\n}",
      scenarios: ['shared reporter 按 library ownership 路由 error。', 'telemetry 按 source/code 聚合 middleware failure。', 'catch boundary 区分 middleware error 与 Store state error。'],
      avoidWhen: ['展示 user-facing message。', '判断 native error class。', '只看 source 而不检查 code。'],
      options: []
    }
  },
  'store-middleware:index:createStoreMiddlewareError': {
    en: {
      purpose: 'Creates the standard tagged Error for Store Middleware contract failures while preserving the native instance, stack, and optional original cause.',
      quickStart: "throw createStoreMiddlewareError(\n  StoreMiddlewareErrorCode.devtoolsCapability,\n  StoreMiddlewareErrorText.applyState,\n  { cause: adapterError }\n)",
      scenarios: ['Host options or a DevTools adapter fail runtime validation.', 'An actions-only write occurs outside an action.', 'Clone or capability failure must retain its original cause.'],
      avoidWhen: ['Several cleanup failures must remain separately reachable.', 'The error belongs to another library boundary.', 'A diagnostic-only missing next condition should be thrown to business code.'],
      options: [
        { name: 'code', description: 'Registered Store Middleware semantic code attached to the same Error.', defaultValue: 'required', optional: false, type: 'IStoreMiddlewareErrorCode', whenToUse: 'Select the exact failed middleware contract.', example: 'StoreMiddlewareErrorCode.devtoolsCapability' },
        { name: 'message', description: 'Library-owned diagnostic text for the failure.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Explain the boundary failure without inventing a new code.', example: 'StoreMiddlewareErrorText.applyState' },
        { name: 'options.cause', description: 'Optional original failure kept reachable by native Error cause.', defaultValue: 'undefined', type: 'unknown', whenToUse: 'Wrap validation, clone, or adapter failures without losing identity.', example: '{ cause: adapterError }' }
      ]
    },
    zh: {
      purpose: '为 Store Middleware contract failure 创建标准 tagged Error，并保留 native instance、stack 与可选 original cause。',
      quickStart: "throw createStoreMiddlewareError(\n  StoreMiddlewareErrorCode.devtoolsCapability,\n  StoreMiddlewareErrorText.applyState,\n  { cause: adapterError }\n)",
      scenarios: ['Host options 或 DevTools adapter runtime validation 失败。', 'actions-only write 发生在 action 外。', 'clone 或 capability failure 必须保留 original cause。'],
      avoidWhen: ['多个 cleanup failure 必须分别保持可达。', 'error 属于其他 library boundary。', 'diagnostic-only missing next condition 应向 business code 抛出。'],
      options: [
        { name: 'code', description: '附加到同一个 Error 的已登记 Store Middleware semantic code。', defaultValue: '必填', optional: false, type: 'IStoreMiddlewareErrorCode', whenToUse: '选择准确失败的 middleware contract。', example: 'StoreMiddlewareErrorCode.devtoolsCapability' },
        { name: 'message', description: 'failure 对应的 library-owned diagnostic text。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '解释 boundary failure，不另造 code。', example: 'StoreMiddlewareErrorText.applyState' },
        { name: 'options.cause', description: '通过 native Error cause 保持可达的可选 original failure。', defaultValue: 'undefined', type: 'unknown', whenToUse: '包装 validation、clone 或 adapter failure，同时不丢 identity。', example: '{ cause: adapterError }' }
      ]
    }
  },
  'store-middleware:index:createStoreMiddlewareAggregateError': {
    en: {
      purpose: 'Creates a tagged native AggregateError after every binding or Host cleanup action has been attempted. Original failures remain ordered and reachable through errors[].',
      quickStart: "throw createStoreMiddlewareAggregateError(\n  StoreMiddlewareErrorCode.cleanupFailed,\n  cleanupErrors,\n  StoreMiddlewareErrorText.cleanupFailed\n)",
      scenarios: ['Binding construction fails and one or more rollback disposers also fail.', 'Host disposal must report several settled cleanup failures.', 'Callers need one terminal error plus every original failure identity.'],
      avoidWhen: ['There is only one failure with one causal chain.', 'Cleanup is still running or unresolved.', 'The errors array would omit the primary failure.'],
      options: [
        { name: 'code', description: 'Registered multi-failure semantic code attached to AggregateError.', defaultValue: 'required', optional: false, type: 'IStoreMiddlewareErrorCode', whenToUse: 'Use cleanupFailed after all cleanup attempts settle.', example: 'StoreMiddlewareErrorCode.cleanupFailed' },
        { name: 'errors', description: 'Ordered original failures retained by AggregateError.errors.', defaultValue: 'required', optional: false, type: 'readonly unknown[]', whenToUse: 'Include the primary error first, followed by rollback or disposal failures.', example: '[primaryError, ...cleanupErrors]' },
        { name: 'message', description: 'Library-owned summary of terminal cleanup failure.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Summarize the operation while errors[] carries details.', example: 'StoreMiddlewareErrorText.cleanupFailed' }
      ]
    },
    zh: {
      purpose: '在全部 binding/Host cleanup action 都尝试完成后创建 tagged native AggregateError；原始 failure 按顺序通过 errors[] 保持可达。',
      quickStart: "throw createStoreMiddlewareAggregateError(\n  StoreMiddlewareErrorCode.cleanupFailed,\n  cleanupErrors,\n  StoreMiddlewareErrorText.cleanupFailed\n)",
      scenarios: ['binding construction 失败，且一个或多个 rollback disposer 也失败。', 'Host disposal 必须报告多个已 settled cleanup failure。', 'caller 需要一个 terminal error 与全部原始 failure identity。'],
      avoidWhen: ['只有一个 failure 与一条 cause chain。', 'cleanup 仍在运行或 unresolved。', 'errors array 会漏掉 primary failure。'],
      options: [
        { name: 'code', description: '附加到 AggregateError 的已登记 multi-failure semantic code。', defaultValue: '必填', optional: false, type: 'IStoreMiddlewareErrorCode', whenToUse: '全部 cleanup attempt settle 后使用 cleanupFailed。', example: 'StoreMiddlewareErrorCode.cleanupFailed' },
        { name: 'errors', description: '由 AggregateError.errors 按顺序保留的原始 failure。', defaultValue: '必填', optional: false, type: 'readonly unknown[]', whenToUse: 'primary error 放第一位，后接 rollback/disposal failure。', example: '[primaryError, ...cleanupErrors]' },
        { name: 'message', description: 'terminal cleanup failure 的 library-owned summary。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '概括 operation，细节留在 errors[]。', example: 'StoreMiddlewareErrorText.cleanupFailed' }
      ]
    }
  },
  'store-middleware:index:createStoreMiddlewareHost': {
    en: {
      purpose: 'Creates an unbound synchronous Store event Host on top of Plugin Host. It batches named actions, isolates middleware failures into Runtime diagnostics, supports optional state application for DevTools, and owns plugin/binding cleanup.',
      quickStart: "const host = createStoreMiddlewareHost({\n  execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 },\n  runtime,\n  getState: () => ClonePolicy.diagnostic(state),\n  applyState: (next) => { state = next },\n  mutationPolicy\n})\nawait host.use(loggerMiddleware())\nhost.runAction('counter:increment', increment)\nawait host.dispose()",
      scenarios: ['State is not a Store Light instance but still needs the middleware event domain.', 'Plugins need synchronous ordered action, state, and error events.', 'DevTools should read and optionally apply an explicitly owned state shape.'],
      avoidWhen: ['Binding an existing Store Light Store; use bindStoreMiddleware.', 'Async or generator pipeline stages are required.', 'The owner cannot await structured Host disposal.'],
      options: storeMiddlewareHostOptions.en
    },
    zh: {
      purpose: '在 Plugin Host 上创建未绑定 Store 的 synchronous Store event Host。它 batch named action，把 middleware failure 隔离到 Runtime diagnostic，支持 DevTools 可选 apply state，并拥有 plugin/binding cleanup。',
      quickStart: "const host = createStoreMiddlewareHost({\n  execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 },\n  runtime,\n  getState: () => ClonePolicy.diagnostic(state),\n  applyState: (next) => { state = next },\n  mutationPolicy\n})\nawait host.use(loggerMiddleware())\nhost.runAction('counter:increment', increment)\nawait host.dispose()",
      scenarios: ['state 不是 Store Light instance，但仍需要 middleware event domain。', 'plugin 需要同步有序的 action、state 与 error event。', 'DevTools 应读取并可选择 apply 显式 owned state shape。'],
      avoidWhen: ['绑定已有 Store Light Store；使用 bindStoreMiddleware。', '需要 async 或 generator pipeline stage。', 'owner 无法 await structured Host disposal。'],
      options: storeMiddlewareHostOptions.zh
    }
  },
  'store-middleware:index:StoreMiddlewareHost': {
    en: {
      purpose: 'Class-form Store Middleware Host with explicit construction and instanceof identity. runAction emits start/end/error around one synchronous Runtime batch, recordError contains reentrancy, and repeated dispose calls share one Promise.',
      quickStart: "const host = new StoreMiddlewareHost({\n  execution, runtime, getState, applyState, mutationPolicy\n})\ntry {\n  return host.runAction('checkout:submit', submit)\n} finally {\n  await host.dispose()\n}",
      scenarios: ['A framework adapter constructs and retains the Host class directly.', 'Action failures must emit diagnostics and then rethrow the original business error.', 'Binding disposers must run LIFO before plugin cleanup.'],
      avoidWhen: ['The factory is clearer.', 'Middleware processing may cross an await boundary.', 'Disposal completion can be ignored.'],
      options: storeMiddlewareHostOptions.en
    },
    zh: {
      purpose: '具有显式 construction 与 instanceof identity 的 class-form Store Middleware Host。runAction 在一次同步 Runtime batch 周围发出 start/end/error，recordError 隔离 reentrancy，重复 dispose 共享同一 Promise。',
      quickStart: "const host = new StoreMiddlewareHost({\n  execution, runtime, getState, applyState, mutationPolicy\n})\ntry {\n  return host.runAction('checkout:submit', submit)\n} finally {\n  await host.dispose()\n}",
      scenarios: ['framework adapter 直接构造并保留 Host class。', 'action failure 必须发出 diagnostic，再重新抛原始 business error。', 'binding disposer 必须先于 plugin cleanup 按 LIFO 执行。'],
      avoidWhen: ['factory 更清晰。', 'middleware processing 可能跨 await boundary。', '准备忽略 disposal completion。'],
      options: storeMiddlewareHostOptions.zh
    }
  },
  'store-middleware:index:bindStoreMiddleware': {
    en: {
      purpose: 'Binds one existing Store Light Store to a Store Middleware Host. It snapshots the binding-time state, emits store:update previous/next events, forwards filtered Runtime action traces without replaying the action, and removes both subscriptions before plugin disposal.',
      quickStart: "const mutationPolicy = createMutationPolicy('actions-only')\nconst store = createStore(shape, { mutationPolicy })\nconst host = bindStoreMiddleware(store, {\n  execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 },\n  mutationPolicy,\n  actionPrefix: 'checkout:',\n  clone: ClonePolicy.diagnostic\n})\ntry {\n  await host.use(loggerMiddleware())\n  store.submit()\n} finally {\n  await host.dispose() // Store remains alive\n}",
      scenarios: ['An existing Store Light instance needs state and action observability.', 'DevTools time travel should hydrate the Store plain-state surface.', 'Binding cleanup must not dispose the Store or Runtime.'],
      avoidWhen: ['The state is not a Store Light Store; create a Host directly.', 'Computed fields, methods, resources, or external side effects must be time-travelled.', 'The clone policy cannot safely represent the public state.'],
      options: [
        { name: 'store', description: 'Existing Store Light instance observed but not owned by the binding.', defaultValue: 'required', optional: false, type: 'IReactiveStore<S>', whenToUse: 'Pass the Store whose $plain state and Runtime actions should be bridged.', example: 'store' },
        { name: 'options.execution', description: 'Required Plugin Host mutation and pipeline-drain deadlines.', defaultValue: 'required', optional: false, type: "{ mutationTimeoutMs: number | false; pipelineDrainTimeoutMs: number | false }", whenToUse: 'Bound installation, replacement, removal, and drain latency.', example: '{ mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 }' },
        { name: 'options.mutationPolicy', description: 'Policy used by the Host; it must be the exact same instance passed to Store creation for actions-only enforcement.', defaultValue: "createMutationPolicy('off') inside Host", type: 'MutationPolicy', whenToUse: 'Share one actions-only guard across Store writes and Host actions.', example: 'mutationPolicy' },
        { name: 'options.actionPrefix', description: 'Optional prefix filter for Runtime action trace names; state events are unaffected.', defaultValue: 'undefined', type: 'string', whenToUse: 'Expose only one domain namespace to this Host.', example: "'checkout:'" },
        { name: 'options.clone', description: 'Snapshot function used at binding time, on each state notification, and every getState call.', defaultValue: 'ClonePolicy.diagnostic', type: '(state: Record<string, unknown>) => Record<string, unknown>', whenToUse: 'Choose immutable for strict history, diagnostic for resilient tooling, or a domain clone.', example: 'ClonePolicy.immutable' }
      ]
    },
    zh: {
      purpose: '把一个既有 Store Light Store 绑定到 Store Middleware Host。它 snapshot binding-time state，发出 store:update previous/next event，按 filter 转发 Runtime action trace 但不重复执行 action，并在 plugin disposal 前移除两个 subscription。',
      quickStart: "const mutationPolicy = createMutationPolicy('actions-only')\nconst store = createStore(shape, { mutationPolicy })\nconst host = bindStoreMiddleware(store, {\n  execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 },\n  mutationPolicy,\n  actionPrefix: 'checkout:',\n  clone: ClonePolicy.diagnostic\n})\ntry {\n  await host.use(loggerMiddleware())\n  store.submit()\n} finally {\n  await host.dispose() // Store 仍然存活\n}",
      scenarios: ['既有 Store Light instance 需要 state/action observability。', 'DevTools time travel 应 hydrate Store plain-state surface。', 'binding cleanup 不得 dispose Store 或 Runtime。'],
      avoidWhen: ['state 不是 Store Light Store；直接创建 Host。', 'computed field、method、resource 或 external side effect 必须 time-travel。', 'clone policy 无法安全表示 public state。'],
      options: [
        { name: 'store', description: 'binding 观察但不拥有的既有 Store Light instance。', defaultValue: '必填', optional: false, type: 'IReactiveStore<S>', whenToUse: '传入需要 bridge $plain state 与 Runtime action 的 Store。', example: 'store' },
        { name: 'options.execution', description: '必填 Plugin Host mutation 与 pipeline-drain deadline。', defaultValue: '必填', optional: false, type: "{ mutationTimeoutMs: number | false; pipelineDrainTimeoutMs: number | false }", whenToUse: '约束 installation、replacement、removal 与 drain latency。', example: '{ mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 }' },
        { name: 'options.mutationPolicy', description: 'Host 使用的 policy；actions-only 要生效，必须是传给 Store creation 的完全同一个 instance。', defaultValue: "Host 内 createMutationPolicy('off')", type: 'MutationPolicy', whenToUse: '让 Store write 与 Host action 共享同一 actions-only guard。', example: 'mutationPolicy' },
        { name: 'options.actionPrefix', description: 'Runtime action trace name 的可选 prefix filter；不影响 state event。', defaultValue: 'undefined', type: 'string', whenToUse: '只把一个 domain namespace 暴露给该 Host。', example: "'checkout:'" },
        { name: 'options.clone', description: 'binding 时、每次 state notification 与每次 getState 调用使用的 snapshot function。', defaultValue: 'ClonePolicy.diagnostic', type: '(state: Record<string, unknown>) => Record<string, unknown>', whenToUse: '严格历史使用 immutable，韧性 tooling 使用 diagnostic，或传入 domain clone。', example: 'ClonePolicy.immutable' }
      ]
    }
  },
  'store-middleware:index:middlewarePlugin': {
    en: {
      purpose: 'Adapts the legacy three-argument middleware function into one synchronous Store Middleware plugin. Calling next advances the event exactly once; omitting it stops downstream observation but never rolls back the Store write.',
      quickStart: "const audit = middlewarePlugin('audit', (event, context, next) => {\n  next()\n  auditSink(event, context.getState())\n})\nawait host.use(audit)",
      scenarios: ['A small middleware needs only Runtime, getState, and next.', 'Legacy function middleware is being migrated into Plugin Host.', 'A stage intentionally filters which events reach later plugins.'],
      avoidWhen: ['The plugin needs config, shared values, or owned external cleanup.', 'The stage is asynchronous.', 'Not calling next is expected to undo a business mutation.'],
      options: [
        { name: 'name', description: 'Stable plugin identity used for installation, diagnostics, and removal.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Choose a unique domain-readable plugin name.', example: "'audit'" },
        { name: 'middleware', description: 'Synchronous event function receiving event, narrow context, and one-shot next callback.', defaultValue: 'required', optional: false, type: 'IStoreMiddleware<S>', whenToUse: 'Use for simple event observation or filtering.', example: '(event, context, next) => { next(); audit(event, context.getState()) }' }
      ]
    },
    zh: {
      purpose: '把 legacy 三参数 middleware function 适配为一个 synchronous Store Middleware plugin。调用 next 精确推进一次 event；省略会停止 downstream observation，但绝不会 rollback Store write。',
      quickStart: "const audit = middlewarePlugin('audit', (event, context, next) => {\n  next()\n  auditSink(event, context.getState())\n})\nawait host.use(audit)",
      scenarios: ['小型 middleware 只需要 Runtime、getState 与 next。', '正在把 legacy function middleware 迁移到 Plugin Host。', 'stage 有意过滤哪些 event 能到达后续 plugin。'],
      avoidWhen: ['plugin 需要 config、shared value 或 owned external cleanup。', 'stage 是 asynchronous。', '期望不调用 next 会撤销 business mutation。'],
      options: [
        { name: 'name', description: '用于 installation、diagnostic 与 removal 的稳定 plugin identity。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '选择唯一且 domain-readable 的 plugin name。', example: "'audit'" },
        { name: 'middleware', description: '接收 event、narrow context 与 one-shot next callback 的同步函数。', defaultValue: '必填', optional: false, type: 'IStoreMiddleware<S>', whenToUse: '用于简单 event observation 或 filtering。', example: '(event, context, next) => { next(); audit(event, context.getState()) }' }
      ]
    }
  },
  'store-middleware:index:loggerMiddleware': {
    en: {
      purpose: 'Creates the built-in store-logger plugin. Each event advances downstream first, then the sink receives the event and the latest state snapshot; sink failures remain middleware diagnostics.',
      quickStart: "await host.use(loggerMiddleware((event, state) => {\n  logger.debug(event.type, { event, state })\n}))",
      scenarios: ['Development needs immediate event and state visibility.', 'An existing logger should receive Store middleware events.', 'Logging must observe the state after downstream synchronous stages.'],
      avoidWhen: ['Secrets or large state must not be copied into logs.', 'A durable audit trail needs redaction, retry, or backpressure.', 'The sink is asynchronous or may block the event path.'],
      options: [{ name: 'sink', description: 'Synchronous receiver called after next with the event and current getState result.', defaultValue: "console.log('[store]', event, state)", type: '(event: IMiddlewareEvent<unknown>, state: unknown) => void', whenToUse: 'Provide a redacted application logger for non-trivial use.', example: '(event, state) => logger.debug(event.type, { state })' }]
    },
    zh: {
      purpose: '创建内置 store-logger plugin。每个 event 先推进 downstream，再把 event 与最新 state snapshot 交给 sink；sink failure 保持为 middleware diagnostic。',
      quickStart: "await host.use(loggerMiddleware((event, state) => {\n  logger.debug(event.type, { event, state })\n}))",
      scenarios: ['开发期需要即时查看 event 与 state。', '既有 logger 应接收 Store middleware event。', 'logging 必须观察 downstream 同步 stage 之后的 state。'],
      avoidWhen: ['secret 或大型 state 不得复制到 log。', 'durable audit trail 需要 redaction、retry 或 backpressure。', 'sink 是 asynchronous 或可能阻塞 event path。'],
      options: [{ name: 'sink', description: 'next 之后同步调用的 receiver，接收 event 与当前 getState 结果。', defaultValue: "console.log('[store]', event, state)", type: '(event: IMiddlewareEvent<unknown>, state: unknown) => void', whenToUse: '非平凡场景应提供带 redaction 的 application logger。', example: '(event, state) => logger.debug(event.type, { state })' }]
    }
  },
  'store-middleware:index:createReduxDevToolsAdapter': {
    en: {
      purpose: 'Translates a Redux DevTools connection into the Store Middleware adapter contract. It labels outgoing events, maps COMMIT/jump/reset dispatches, ignores malformed JSON, and leaves state application to Host capability.',
      quickStart: "const adapter = createReduxDevToolsAdapter(connection)\nawait host.connectDevTools(adapter)\n// Later: await host.unUse('store-devtools')",
      scenarios: ['Redux DevTools should display Store action/state/error events.', 'Time-travel dispatch messages must map into typed Store commands.', 'The connection lifecycle should be owned by plugin installation.'],
      avoidWhen: ['The Host has no safe applyState capability but jump/reset is expected.', 'External side effects must be rolled back by time travel.', 'The connection is not compatible with Redux DevTools init/send/subscribe.'],
      options: [{ name: 'connection', description: 'Redux DevTools-compatible connection providing init, send, and subscribe.', defaultValue: 'required', optional: false, type: 'IReduxDevToolsConnection<S>', whenToUse: 'Pass the connection returned by the DevTools extension bridge.', example: 'createReduxDevToolsAdapter(connection)' }]
    },
    zh: {
      purpose: '把 Redux DevTools connection 转换为 Store Middleware adapter contract。它标记 outgoing event，映射 COMMIT/jump/reset dispatch，忽略 malformed JSON，并把 state application 留给 Host capability。',
      quickStart: "const adapter = createReduxDevToolsAdapter(connection)\nawait host.connectDevTools(adapter)\n// 之后：await host.unUse('store-devtools')",
      scenarios: ['Redux DevTools 应展示 Store action/state/error event。', 'time-travel dispatch message 必须映射为 typed Store command。', 'connection lifecycle 应由 plugin installation 拥有。'],
      avoidWhen: ['Host 没有安全 applyState capability，但期望 jump/reset。', 'external side effect 必须随 time travel rollback。', 'connection 不兼容 Redux DevTools init/send/subscribe。'],
      options: [{ name: 'connection', description: '提供 init、send、subscribe 的 Redux DevTools-compatible connection。', defaultValue: '必填', optional: false, type: 'IReduxDevToolsConnection<S>', whenToUse: '传入 DevTools extension bridge 返回的 connection。', example: 'createReduxDevToolsAdapter(connection)' }]
    }
  },
  'store-middleware:index:createMutationPolicy': {
    en: {
      purpose: 'Creates the write-admission guard shared by Store Light, Store Indexed, and Store Middleware. off preserves ordinary writes; actions-only rejects guarded writes unless they run inside runInAction.',
      quickStart: "const policy = createMutationPolicy('actions-only')\nconst host = createStoreMiddlewareHost({ execution, runtime, getState, mutationPolicy: policy })\nhost.runAction('counter:increment', () => store.increment())",
      scenarios: ['Several Store surfaces need one consistent actions-only rule.', 'Middleware action boundaries should admit guarded mutations.', 'Strict writes must be opt-in so existing behavior remains unchanged.'],
      avoidWhen: ['Writes should remain unrestricted; omit the policy or use off.', 'Authorization depends on async context after an await.', 'The guarded state implementation does not accept IMutationGuard.'],
      options: [{ name: 'mode', description: 'Write policy: off permits every mutation; actions-only requires a synchronous runInAction scope.', defaultValue: "'off'", type: "'off' | 'actions-only'", whenToUse: 'Enable actions-only after every legitimate write path has an explicit action boundary.', example: "createMutationPolicy('actions-only')" }]
    },
    zh: {
      purpose: '创建 Store Light、Store Indexed 与 Store Middleware 共享的 write-admission guard。off 保留普通 write；actions-only 拒绝不在 runInAction 内执行的 guarded write。',
      quickStart: "const policy = createMutationPolicy('actions-only')\nconst host = createStoreMiddlewareHost({ execution, runtime, getState, mutationPolicy: policy })\nhost.runAction('counter:increment', () => store.increment())",
      scenarios: ['多个 Store surface 需要同一 actions-only rule。', 'middleware action boundary 应接纳 guarded mutation。', 'strict write 必须 opt-in，避免改变既有行为。'],
      avoidWhen: ['write 应保持无限制；省略 policy 或使用 off。', 'authorization 需要跨 await 的 async context。', 'guarded state implementation 不接受 IMutationGuard。'],
      options: [{ name: 'mode', description: 'write policy：off 允许所有 mutation；actions-only 要求同步 runInAction scope。', defaultValue: "'off'", type: "'off' | 'actions-only'", whenToUse: '所有合法 write path 都已有显式 action boundary 后再启用 actions-only。', example: "createMutationPolicy('actions-only')" }]
    }
  },
  'store-middleware:index:MutationPolicy': {
    en: {
      purpose: 'Class-form mutation guard with reentrant synchronous action depth. assertMutationAllowed enforces the selected mode, runInAction always restores depth in finally, and insideAction exposes the current synchronous scope.',
      quickStart: "const policy = new MutationPolicy('actions-only')\npolicy.runInAction(() => {\n  policy.assertMutationAllowed('profile.update')\n  updateProfile()\n})",
      scenarios: ['An adapter needs direct construction or instanceof checks.', 'Nested synchronous actions must remain admitted until the outer action exits.', 'A guarded collection needs a stable IMutationGuard object.'],
      avoidWhen: ['An action must remain active after an await.', 'The factory entry point is clearer.', 'Mutation admission is contextual authorization rather than a local write invariant.'],
      options: [{ name: 'mode', description: 'Initial admission mode retained by this policy instance.', defaultValue: "'off'", type: "'off' | 'actions-only'", whenToUse: 'Select actions-only for strict synchronous mutation boundaries.', example: "new MutationPolicy('actions-only')" }]
    },
    zh: {
      purpose: '具有可重入同步 action depth 的 class-form mutation guard。assertMutationAllowed 执行所选 mode，runInAction 在 finally 中恢复 depth，insideAction 暴露当前同步 scope。',
      quickStart: "const policy = new MutationPolicy('actions-only')\npolicy.runInAction(() => {\n  policy.assertMutationAllowed('profile.update')\n  updateProfile()\n})",
      scenarios: ['adapter 需要直接 construction 或 instanceof 检查。', 'nested synchronous action 在 outer action 退出前必须保持 admitted。', 'guarded collection 需要稳定 IMutationGuard object。'],
      avoidWhen: ['action 必须跨 await 保持 active。', 'factory entry point 更清晰。', 'mutation admission 属于 contextual authorization，而不是局部 write invariant。'],
      options: [{ name: 'mode', description: '该 policy instance 保留的初始 admission mode。', defaultValue: "'off'", type: "'off' | 'actions-only'", whenToUse: '严格同步 mutation boundary 使用 actions-only。', example: "new MutationPolicy('actions-only')" }]
    }
  },
  'store-middleware:tolerant-clone:immutableSnapshotClone': {
    en: {
      purpose: 'Creates a truly independent deep snapshot or throws a coded Store Middleware error. It never silently aliases a subtree when structured cloning is unavailable or a value is unsupported.',
      quickStart: 'const previous = immutableSnapshotClone(store.$plain())\n// Later mutations cannot change previous.',
      scenarios: ['A previous-state snapshot must remain immutable in meaning.', 'Time travel or rollback requires full reference independence.', 'Unsupported values must fail explicitly before data is published.'],
      avoidWhen: ['Diagnostics must never fail; use diagnosticClone.', 'Reference aliasing is an accepted performance tradeoff; use opaqueReferenceClone.', 'The value owns live handles that should not be cloned.'],
      options: [{ name: 'value', description: 'Value that must be fully structured-cloneable into an independent graph.', defaultValue: 'required', optional: false, type: 'T', whenToUse: 'Pass state only when clone failure should abort the operation.', example: 'immutableSnapshotClone(state)' }]
    },
    zh: {
      purpose: '创建真正独立的 deep snapshot，否则抛带 code 的 Store Middleware error。structured cloning 不可用或 value 不受支持时，绝不静默 alias subtree。',
      quickStart: 'const previous = immutableSnapshotClone(store.$plain())\n// 后续 mutation 无法改变 previous。',
      scenarios: ['previous-state snapshot 的语义必须保持 immutable。', 'time travel 或 rollback 要求完整 reference independence。', 'unsupported value 必须在发布数据前显式失败。'],
      avoidWhen: ['diagnostic 绝不能失败；使用 diagnosticClone。', '接受 reference aliasing 换取性能；使用 opaqueReferenceClone。', 'value 拥有不应 clone 的 live handle。'],
      options: [{ name: 'value', description: '必须完整 structured-clone 为独立 graph 的 value。', defaultValue: '必填', optional: false, type: 'T', whenToUse: '只有 clone failure 应中止 operation 时才传入 state。', example: 'immutableSnapshotClone(state)' }]
    }
  },
  'store-middleware:tolerant-clone:opaqueReferenceClone': {
    en: {
      purpose: 'Returns the exact same reference without cloning. The explicit name records that the caller accepts aliasing, live mutation visibility, and zero snapshot independence.',
      quickStart: 'const liveReference = opaqueReferenceClone(hostHandle)\nObject.is(liveReference, hostHandle) // true',
      scenarios: ['A live host object cannot or must not be cloned.', 'The caller explicitly accepts observing later mutations.', 'The cheapest possible pass-through is required.'],
      avoidWhen: ['The value is labelled previous, snapshot, or immutable.', 'Time travel or replay needs historical independence.', 'Consumers may mutate the returned value unexpectedly.'],
      options: [{ name: 'value', description: 'Value returned unchanged with identical reference identity.', defaultValue: 'required', optional: false, type: 'T', whenToUse: 'Pass only when aliasing is the intended contract.', example: 'opaqueReferenceClone(socket)' }]
    },
    zh: {
      purpose: '不执行 clone，直接返回完全相同的 reference。显式名称记录 caller 接受 aliasing、后续 live mutation 可见与零 snapshot independence。',
      quickStart: 'const liveReference = opaqueReferenceClone(hostHandle)\nObject.is(liveReference, hostHandle) // true',
      scenarios: ['live host object 无法或不应 clone。', 'caller 显式接受观察后续 mutation。', '需要成本最低的 pass-through。'],
      avoidWhen: ['value 被称为 previous、snapshot 或 immutable。', 'time travel 或 replay 需要历史独立性。', 'consumer 可能意外 mutation 返回值。'],
      options: [{ name: 'value', description: '保持同一 reference identity、原样返回的 value。', defaultValue: '必填', optional: false, type: 'T', whenToUse: '仅在 aliasing 就是目标 contract 时传入。', example: 'opaqueReferenceClone(socket)' }]
    }
  },
  'store-middleware:tolerant-clone:diagnosticClone': {
    en: {
      purpose: 'Builds a best-effort diagnostic snapshot that never throws: cloneable arrays and plain objects become independent, while only the unsupported subtree remains an opaque reference.',
      quickStart: 'const eventState = diagnosticClone(store.$plain())\nhost.recordState(\'store:update\', previous, eventState)',
      scenarios: ['Middleware and DevTools availability is more important than strict clone completeness.', 'Most of a state tree should remain historically independent.', 'Functions or host handles may occur inside otherwise cloneable state.'],
      avoidWhen: ['Every subtree must be independent; use immutableSnapshotClone.', 'Aliasing the entire value is intentional; use opaqueReferenceClone.', 'The snapshot is a security or trust boundary.'],
      options: [{ name: 'value', description: 'Diagnostic value recursively copied where safe, with unsupported leaves retained by reference.', defaultValue: 'required', optional: false, type: 'T', whenToUse: 'Capture observability data without allowing unusual state to break the binding.', example: 'diagnosticClone(state)' }]
    },
    zh: {
      purpose: '构建永不 throw 的 best-effort diagnostic snapshot：可 clone 的 array/plain object 保持独立，只有 unsupported subtree 保留 opaque reference。',
      quickStart: 'const eventState = diagnosticClone(store.$plain())\nhost.recordState(\'store:update\', previous, eventState)',
      scenarios: ['middleware 与 DevTools availability 比严格 clone completeness 更重要。', 'state tree 的大部分内容应保持历史独立。', 'otherwise cloneable state 内可能包含 function 或 host handle。'],
      avoidWhen: ['每个 subtree 都必须独立；使用 immutableSnapshotClone。', '有意 alias 整个 value；使用 opaqueReferenceClone。', 'snapshot 是 security 或 trust boundary。'],
      options: [{ name: 'value', description: '安全部分递归复制、unsupported leaf 按 reference 保留的 diagnostic value。', defaultValue: '必填', optional: false, type: 'T', whenToUse: '捕获 observability data，避免异常 state 破坏 binding。', example: 'diagnosticClone(state)' }]
    }
  },
  'store-middleware:tolerant-clone:ClonePolicy': {
    en: {
      purpose: 'Groups the three explicit clone contracts—immutable, opaque, and diagnostic—so configuration chooses guarantees by name instead of relying on a fuzzy generic clone.',
      quickStart: "const clone = strictHistory ? ClonePolicy.immutable : ClonePolicy.diagnostic\nconst snapshot = clone(state)",
      scenarios: ['A binding option needs a named clone strategy.', 'Reviewers must see whether independence or availability wins.', 'Several call sites share one explicit snapshot policy.'],
      avoidWhen: ['One direct clone function is clearer.', 'A custom domain serializer is required.', 'The mode is selected implicitly from the value type.'],
      options: []
    },
    zh: {
      purpose: '组合三种显式 clone contract：immutable、opaque、diagnostic，让配置按名称选择 guarantee，而不是依赖含糊的通用 clone。',
      quickStart: "const clone = strictHistory ? ClonePolicy.immutable : ClonePolicy.diagnostic\nconst snapshot = clone(state)",
      scenarios: ['binding option 需要命名 clone strategy。', 'reviewer 必须看清 independence 与 availability 谁优先。', '多个 call site 共享同一显式 snapshot policy。'],
      avoidWhen: ['直接 clone function 更清晰。', '需要 custom domain serializer。', '准备按 value type 隐式选择 mode。'],
      options: []
    }
  },
  'store-middleware:tolerant-clone:tolerantClone': {
    en: {
      purpose: 'Deprecated alias of diagnosticClone retained for source compatibility. It has identical best-effort behavior and no separate implementation path; migrate to ClonePolicy.diagnostic or diagnosticClone.',
      quickStart: 'const snapshot = diagnosticClone(state) // preferred replacement',
      scenarios: ['Reading legacy code that still imports tolerantClone.', 'Performing a bounded source migration to diagnosticClone.', 'Confirming the alias does not change clone behavior.'],
      avoidWhen: ['Writing new code.', 'Strict independence is required.', 'The deprecated name would hide the selected guarantee.'],
      options: [{ name: 'value', description: 'Legacy input forwarded unchanged to diagnosticClone behavior.', defaultValue: 'required', optional: false, type: 'T', whenToUse: 'Only while migrating an existing tolerantClone caller.', example: 'diagnosticClone(state)' }]
    },
    zh: {
      purpose: '为 source compatibility 保留的 diagnosticClone deprecated alias。它具有完全相同的 best-effort behavior，没有第二条实现路径；应迁移到 ClonePolicy.diagnostic 或 diagnosticClone。',
      quickStart: 'const snapshot = diagnosticClone(state) // 推荐替代写法',
      scenarios: ['阅读仍 import tolerantClone 的 legacy code。', '执行有边界的 diagnosticClone source migration。', '确认 alias 不改变 clone behavior。'],
      avoidWhen: ['编写新代码。', '要求 strict independence。', 'deprecated name 会掩盖所选 guarantee。'],
      options: [{ name: 'value', description: '按 diagnosticClone behavior 原样转发的 legacy input。', defaultValue: '必填', optional: false, type: 'T', whenToUse: '仅在迁移既有 tolerantClone caller 时使用。', example: 'diagnosticClone(state)' }]
    }
  },
  'store-indexed:index:IndexedOperation': {
    en: {
      purpose: 'Provides the stable read, write, and delete operation labels used by Store Indexed diagnostics and registries. It describes operation categories; it does not execute or authorize a mutation.',
      quickStart: "const operation = changed ? IndexedOperation.write : IndexedOperation.read\nrecordIndexedOperation(operation)",
      scenarios: ['Diagnostics need a stable operation category.', 'A registry groups collection work without parsing method names.', 'Instrumentation shares the same read/write/delete vocabulary.'],
      avoidWhen: ['Selecting a collection method to call.', 'Representing lifecycle or error states.', 'Serializing a versioned remote protocol without an explicit compatibility contract.'],
      options: []
    },
    zh: {
      purpose: '提供 Store Indexed diagnostic 与 registry 使用的稳定 read、write、delete operation label。它描述 operation category，不执行也不授权 mutation。',
      quickStart: "const operation = changed ? IndexedOperation.write : IndexedOperation.read\nrecordIndexedOperation(operation)",
      scenarios: ['diagnostic 需要稳定 operation category。', 'registry 不解析 method name，直接归类 collection work。', 'instrumentation 共享同一 read/write/delete vocabulary。'],
      avoidWhen: ['选择要调用的 collection method。', '表示 lifecycle 或 error state。', '没有显式 compatibility contract，却要序列化为 versioned remote protocol。'],
      options: []
    }
  },
  'store-indexed:index:STORE_INDEXED_SOURCE': {
    en: {
      purpose: 'Exposes the canonical source discriminator attached to Store Indexed boundary errors. Narrow by source before branching on code; do not parse diagnostic messages.',
      quickStart: "if (error.source === STORE_INDEXED_SOURCE) {\n  handleIndexedCode(error.code)\n}",
      scenarios: ['A shared reporter routes failures by library ownership.', 'Telemetry groups Store Indexed errors by source and code.', 'A catch boundary distinguishes Store Indexed failures from other Store errors.'],
      avoidWhen: ['Displaying a user-facing message.', 'Determining the native error class; use instanceof.', 'Using source alone as the failure reason.'],
      options: []
    },
    zh: {
      purpose: '暴露附加到 Store Indexed boundary error 的 canonical source discriminator。先按 source 缩小范围，再按 code 分支；不要解析 diagnostic message。',
      quickStart: "if (error.source === STORE_INDEXED_SOURCE) {\n  handleIndexedCode(error.code)\n}",
      scenarios: ['shared reporter 按 library ownership 路由 failure。', 'telemetry 按 source 与 code 聚合 Store Indexed error。', 'catch boundary 区分 Store Indexed failure 与其他 Store error。'],
      avoidWhen: ['展示 user-facing message。', '判断 native error class；使用 instanceof。', '只用 source 作为 failure reason。'],
      options: []
    }
  },
  'store-indexed:index:createStoreIndexedError': {
    en: {
      purpose: 'Creates the standard tagged Error for Store Indexed operational failures while preserving native identity, stack, and an optional cause. Prefer the more specific TypeError or RangeError factory when input semantics require it.',
      quickStart: "throw createStoreIndexedError(\n  StoreIndexedErrorCode.collectionDisposed,\n  StoreIndexedErrorText.disposed('session')\n)",
      scenarios: ['A disposed collection is used again.', 'A tracked read crosses Runtime ownership.', 'A lower-level failure must remain reachable through cause.'],
      avoidWhen: ['The input has the wrong type; use createStoreIndexedTypeError.', 'An array index is outside its allowed range.', 'The error belongs to application logic rather than Store Indexed.'],
      options: [
        { name: 'code', description: 'Registered Store Indexed semantic code attached to the same Error.', defaultValue: 'required', optional: false, type: 'IStoreIndexedErrorCode', whenToUse: 'Identify the exact operational contract failure.', example: 'StoreIndexedErrorCode.collectionDisposed' },
        { name: 'message', description: 'Library-owned diagnostic text for the selected failure.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Explain the failure without parsing or inventing codes.', example: "StoreIndexedErrorText.disposed('session')" },
        { name: 'options.cause', description: 'Optional original failure retained through native Error cause.', defaultValue: 'undefined', type: 'unknown', whenToUse: 'Wrap a lower-level failure without losing identity or stack.', example: '{ cause: originalError }' }
      ]
    },
    zh: {
      purpose: '为 Store Indexed operational failure 创建标准 tagged Error，并保留 native identity、stack 与可选 cause。input semantics 更具体时应使用 TypeError 或 RangeError factory。',
      quickStart: "throw createStoreIndexedError(\n  StoreIndexedErrorCode.collectionDisposed,\n  StoreIndexedErrorText.disposed('session')\n)",
      scenarios: ['disposed collection 被再次使用。', 'tracked read 跨越 Runtime ownership。', 'lower-level failure 必须通过 cause 保持可达。'],
      avoidWhen: ['input 类型错误；使用 createStoreIndexedTypeError。', 'array index 超出允许范围。', '错误属于 application logic，而非 Store Indexed。'],
      options: [
        { name: 'code', description: '附加到同一个 Error 的已登记 Store Indexed semantic code。', defaultValue: '必填', optional: false, type: 'IStoreIndexedErrorCode', whenToUse: '标识准确 operational contract failure。', example: 'StoreIndexedErrorCode.collectionDisposed' },
        { name: 'message', description: '所选 failure 对应的 library-owned diagnostic text。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '解释 failure，不解析或另造 code。', example: "StoreIndexedErrorText.disposed('session')" },
        { name: 'options.cause', description: '通过 native Error cause 保留的可选原始 failure。', defaultValue: 'undefined', type: 'unknown', whenToUse: '包装 lower-level failure，同时不丢 identity 或 stack。', example: '{ cause: originalError }' }
      ]
    }
  },
  'store-indexed:index:createStoreIndexedRangeError': {
    en: {
      purpose: 'Creates a tagged native RangeError for a valid integer index outside the current ObservableArray bounds. It preserves instanceof RangeError and the original stack.',
      quickStart: "throw createStoreIndexedRangeError(\n  StoreIndexedErrorCode.indexOutOfRange,\n  StoreIndexedErrorText.arrayIndex\n)",
      scenarios: ['ObservableArray.set receives an index below zero.', 'The write index is at or beyond the current length.', 'Consumers distinguish bounds failures through instanceof RangeError.'],
      avoidWhen: ['The index is non-integer; use createStoreIndexedTypeError with invalidIndex.', 'A read uses at(), which returns undefined for missing positions.', 'An original cause must be attached; this factory has no cause option.'],
      options: [
        { name: 'code', description: 'Registered range-related Store Indexed code.', defaultValue: 'required', optional: false, type: 'IStoreIndexedErrorCode', whenToUse: 'Use indexOutOfRange for valid integer indices outside set bounds.', example: 'StoreIndexedErrorCode.indexOutOfRange' },
        { name: 'message', description: 'Library-owned explanation of the rejected bound.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Use the stable array-index diagnostic.', example: 'StoreIndexedErrorText.arrayIndex' }
      ]
    },
    zh: {
      purpose: '为超出当前 ObservableArray bounds 的有效整数 index 创建 tagged native RangeError；保留 instanceof RangeError 与原始 stack。',
      quickStart: "throw createStoreIndexedRangeError(\n  StoreIndexedErrorCode.indexOutOfRange,\n  StoreIndexedErrorText.arrayIndex\n)",
      scenarios: ['ObservableArray.set 收到小于零的 index。', 'write index 等于或大于当前 length。', 'consumer 通过 instanceof RangeError 区分 bounds failure。'],
      avoidWhen: ['index 不是整数；使用 invalidIndex 的 createStoreIndexedTypeError。', 'read 使用 at()，missing position 会返回 undefined。', '需要附加 original cause；该 factory 没有 cause option。'],
      options: [
        { name: 'code', description: '已登记的 range-related Store Indexed code。', defaultValue: '必填', optional: false, type: 'IStoreIndexedErrorCode', whenToUse: '有效整数 index 超出 set bounds 时使用 indexOutOfRange。', example: 'StoreIndexedErrorCode.indexOutOfRange' },
        { name: 'message', description: '解释 rejected bound 的 library-owned 文案。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '使用稳定 array-index diagnostic。', example: 'StoreIndexedErrorText.arrayIndex' }
      ]
    }
  },
  'store-indexed:index:createStoreIndexedTypeError': {
    en: {
      purpose: 'Creates a tagged native TypeError for malformed collection inputs, options, object keys, or non-integer indices. Native type, stack, source/code, and optional cause remain intact.',
      quickStart: "throw createStoreIndexedTypeError(\n  StoreIndexedErrorCode.invalidIndex,\n  StoreIndexedErrorText.arrayInteger,\n  { cause: inputError }\n)",
      scenarios: ['A constructor receives a null or non-iterable input.', 'Options, debugName, object key, or updater has the wrong runtime type.', 'An array index is not an integer.'],
      avoidWhen: ['An integer index is merely out of bounds.', 'The collection is disposed.', 'The error does not belong to a Store Indexed boundary.'],
      options: [
        { name: 'code', description: 'Registered malformed-input semantic code.', defaultValue: 'required', optional: false, type: 'IStoreIndexedErrorCode', whenToUse: 'Select invalidOption or invalidIndex according to the failed contract.', example: 'StoreIndexedErrorCode.invalidIndex' },
        { name: 'message', description: 'Canonical explanation for the invalid runtime shape.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Describe the exact input boundary that rejected the value.', example: 'StoreIndexedErrorText.arrayInteger' },
        { name: 'options.cause', description: 'Optional getter, iterator, or decoding failure retained as cause.', defaultValue: 'undefined', type: 'unknown', whenToUse: 'Keep hostile-input evaluation failures traceable.', example: '{ cause: inputError }' }
      ]
    },
    zh: {
      purpose: '为 malformed collection input、option、object key 或 non-integer index 创建 tagged native TypeError；保留 native type、stack、source/code 与可选 cause。',
      quickStart: "throw createStoreIndexedTypeError(\n  StoreIndexedErrorCode.invalidIndex,\n  StoreIndexedErrorText.arrayInteger,\n  { cause: inputError }\n)",
      scenarios: ['constructor 收到 null 或 non-iterable input。', 'options、debugName、object key 或 updater 的 runtime type 错误。', 'array index 不是整数。'],
      avoidWhen: ['整数 index 只是超出 bounds。', 'collection 已 disposed。', '错误不属于 Store Indexed boundary。'],
      options: [
        { name: 'code', description: '已登记的 malformed-input semantic code。', defaultValue: '必填', optional: false, type: 'IStoreIndexedErrorCode', whenToUse: '根据失败 contract 选择 invalidOption 或 invalidIndex。', example: 'StoreIndexedErrorCode.invalidIndex' },
        { name: 'message', description: 'invalid runtime shape 对应的 canonical explanation。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '描述拒绝 value 的准确 input boundary。', example: 'StoreIndexedErrorText.arrayInteger' },
        { name: 'options.cause', description: '作为 cause 保留的可选 getter、iterator 或 decoding failure。', defaultValue: 'undefined', type: 'unknown', whenToUse: '保持 hostile-input evaluation failure 可追踪。', example: '{ cause: inputError }' }
      ]
    }
  },
  'store-indexed:index:observableObject': {
    en: {
      purpose: 'Creates an explicit string-keyed reactive object without Proxying user data. get tracks one key, has and keys track structure, snapshot tracks the full revision, and peek stays allocation-free and untracked.',
      quickStart: "const profile = observableObject({ name: 'Ada', online: false }, { debugName: 'profile' }, runtime)\nconst stop = runtime.effect(() => renderName(profile.get('name')))\nprofile.set('name', 'Grace')\nprofile.replace({ name: 'Lin', online: true })\nstop.dispose()\nprofile.dispose()",
      scenarios: ['Independent object properties need fine-grained invalidation.', 'Consumers need explicit tracked and untracked read APIs.', 'Whole-object snapshots must be frozen, cached by revision, and safe for __proto__ keys.'],
      avoidWhen: ['Natural property syntax through a Proxy is required.', 'Keys are not strings; use ObservableMap.', 'A single atomic object value is simpler and sufficient.'],
      options: storeIndexedCollectionOptions.object.en
    },
    zh: {
      purpose: '创建不 Proxy user data 的显式 string-keyed reactive object。get 追踪单 key，has/keys 追踪 structure，snapshot 追踪完整 revision，peek 保持无分配且不追踪。',
      quickStart: "const profile = observableObject({ name: 'Ada', online: false }, { debugName: 'profile' }, runtime)\nconst stop = runtime.effect(() => renderName(profile.get('name')))\nprofile.set('name', 'Grace')\nprofile.replace({ name: 'Lin', online: true })\nstop.dispose()\nprofile.dispose()",
      scenarios: ['独立 object property 需要细粒度 invalidation。', 'consumer 需要显式 tracked 与 untracked read API。', 'whole-object snapshot 必须 frozen、按 revision cache，并安全处理 __proto__ key。'],
      avoidWhen: ['要求通过 Proxy 使用自然 property syntax。', 'key 不是 string；使用 ObservableMap。', '单一 atomic object value 已经足够简单。'],
      options: storeIndexedCollectionOptions.object.zh
    }
  },
  'store-indexed:index:ObservableObject': {
    en: {
      purpose: 'Class-form Observable Object for callers that need explicit constructor order or instanceof checks. It owns lazy key cells and must be disposed by the same lifecycle that owns its Runtime usage.',
      quickStart: "const state = new ObservableObject({ count: 0 }, runtime, { debugName: 'counter' })\nstate.update('count', (count) => count + 1)\nconst view = state.snapshot()\nstate.dispose()",
      scenarios: ['A framework adapter constructs collection classes directly.', 'Runtime is clearer as the second constructor argument.', 'The owner needs instanceof ObservableObject.'],
      avoidWhen: ['The factory argument order is more readable.', 'Implicit property interception is expected.', 'The lifecycle cannot guarantee dispose.'],
      options: storeIndexedCollectionOptions.object.en
    },
    zh: {
      purpose: '面向需要显式 constructor 顺序或 instanceof 检查的 class-form Observable Object。它拥有惰性 key cell，必须由拥有其 Runtime usage 的同一 lifecycle dispose。',
      quickStart: "const state = new ObservableObject({ count: 0 }, runtime, { debugName: 'counter' })\nstate.update('count', (count) => count + 1)\nconst view = state.snapshot()\nstate.dispose()",
      scenarios: ['framework adapter 直接构造 collection class。', '把 Runtime 作为第二个 constructor 参数更清晰。', 'owner 需要 instanceof ObservableObject。'],
      avoidWhen: ['factory 参数顺序更易读。', '期望 implicit property interception。', 'lifecycle 无法保证 dispose。'],
      options: storeIndexedCollectionOptions.object.zh
    }
  },
  'store-indexed:index:observableArray': {
    en: {
      purpose: 'Creates an ordered reactive collection with lazy per-index dependencies plus separate length, structure, and snapshot revision tracking. Bulk replace and splice notify only materialized index cells.',
      quickStart: "const rows = observableArray(initialRows, { debugName: 'rows' }, runtime)\nconst first = rows.at(0)\nrows.splice(1, 0, newRow)\nconst frozen = rows.snapshot()\nrows.prune()\nrows.dispose()",
      scenarios: ['A large list has only a small number of observed indices.', 'Length and whole-list iteration must react independently from unrelated indexed reads.', 'Immutable snapshots are needed at adapter boundaries.'],
      avoidWhen: ['Stable business-key identity must survive reordering; use a keyed definition or map.', 'Native Array mutation syntax is required.', 'Every consumer always reads the entire small list.'],
      options: storeIndexedCollectionOptions.array.en
    },
    zh: {
      purpose: '创建有序 reactive collection：惰性 per-index dependency，并分离 length、structure 与 snapshot revision tracking。bulk replace/splice 只通知已 materialize 的 index cell。',
      quickStart: "const rows = observableArray(initialRows, { debugName: 'rows' }, runtime)\nconst first = rows.at(0)\nrows.splice(1, 0, newRow)\nconst frozen = rows.snapshot()\nrows.prune()\nrows.dispose()",
      scenarios: ['大型 list 只有少量 observed index。', 'length 与 whole-list iteration 必须和无关 indexed read 独立响应。', 'adapter boundary 需要 immutable snapshot。'],
      avoidWhen: ['稳定 business-key identity 必须跨 reorder 保留；使用 keyed definition 或 map。', '要求 native Array mutation syntax。', '所有 consumer 总是读取完整小型 list。'],
      options: storeIndexedCollectionOptions.array.zh
    }
  },
  'store-indexed:index:ObservableArray': {
    en: {
      purpose: 'Class-form indexed list with explicit Runtime ownership. Negative at() reads track structure, set requires an existing non-negative integer index, and splice preserves native omitted-argument semantics.',
      quickStart: "const queue = new ObservableArray(tasks, runtime, { debugName: 'queue' })\nqueue.push(task)\nconst last = queue.at(-1)\nqueue.set(0, nextTask)\nqueue.dispose()",
      scenarios: ['An adapter requires direct class construction.', 'Index-level tracking is materially smaller than whole-array invalidation.', 'The owner needs explicit disposal and instanceof checks.'],
      avoidWhen: ['Items need stable identity after insertion or removal.', 'Out-of-range set should extend the list.', 'The owner cannot dispose the collection.'],
      options: storeIndexedCollectionOptions.array.en
    },
    zh: {
      purpose: '具有显式 Runtime ownership 的 class-form indexed list。负数 at() read 追踪 structure，set 要求已有的非负整数 index，splice 保留 native omitted-argument semantics。',
      quickStart: "const queue = new ObservableArray(tasks, runtime, { debugName: 'queue' })\nqueue.push(task)\nconst last = queue.at(-1)\nqueue.set(0, nextTask)\nqueue.dispose()",
      scenarios: ['adapter 需要直接 class construction。', 'index-level tracking 比 whole-array invalidation 显著更小。', 'owner 需要显式 disposal 与 instanceof 检查。'],
      avoidWhen: ['item 插入或移除后仍需 stable identity。', '越界 set 应扩展 list。', 'owner 无法 dispose collection。'],
      options: storeIndexedCollectionOptions.array.zh
    }
  },
  'store-indexed:index:observableMap': {
    en: {
      purpose: 'Creates a reactive Map with per-key value and membership dependencies, a structural key dependency, and an iteration dependency. Untracked peek never materializes a cell.',
      quickStart: "const users = observableMap(initialUsers, { debugName: 'users' }, runtime)\nusers.set(user.id, user)\nconst selected = users.get(selectedId)\nconst entries = users.entries()\nusers.prune()\nusers.dispose()",
      scenarios: ['Arbitrary key identity needs fine-grained get and has tracking.', 'Key-set readers should ignore value-only changes.', 'Iteration readers need one immutable entry snapshot per read.'],
      avoidWhen: ['Only string keys and object snapshots are required.', 'Insertion order is the primary indexed contract.', 'Weak key retention is required.'],
      options: storeIndexedCollectionOptions.map.en
    },
    zh: {
      purpose: '创建 reactive Map：per-key value/membership dependency、structural key dependency 与 iteration dependency 相互分离；untracked peek 不 materialize cell。',
      quickStart: "const users = observableMap(initialUsers, { debugName: 'users' }, runtime)\nusers.set(user.id, user)\nconst selected = users.get(selectedId)\nconst entries = users.entries()\nusers.prune()\nusers.dispose()",
      scenarios: ['任意 key identity 需要细粒度 get 与 has tracking。', 'key-set reader 应忽略只改变 value 的 mutation。', 'iteration reader 每次需要 immutable entry snapshot。'],
      avoidWhen: ['只需要 string key 与 object snapshot。', 'insertion order 是首要 indexed contract。', '需要 weak key retention。'],
      options: storeIndexedCollectionOptions.map.zh
    }
  },
  'store-indexed:index:ObservableMap': {
    en: {
      purpose: 'Class-form Observable Map for explicit construction and ownership. replace swaps the entire content atomically, clear publishes one structural and one iteration revision, and dispose is idempotent.',
      quickStart: "const cache = new ObservableMap(entries, runtime, { debugName: 'cache' })\ncache.replace(nextEntries)\nconst keys = cache.keys()\ncache.dispose()",
      scenarios: ['A framework owns the class instance directly.', 'Bulk replacement must be one bounded reactive transaction.', 'Per-key and iteration observers must remain separated.'],
      avoidWhen: ['Factory syntax is sufficient.', 'Native mutable Map escape is required.', 'Keys should be weakly retained.'],
      options: storeIndexedCollectionOptions.map.en
    },
    zh: {
      purpose: '用于显式 construction 与 ownership 的 class-form Observable Map。replace 原子交换全部内容，clear 只发布一次 structure 与一次 iteration revision，dispose 幂等。',
      quickStart: "const cache = new ObservableMap(entries, runtime, { debugName: 'cache' })\ncache.replace(nextEntries)\nconst keys = cache.keys()\ncache.dispose()",
      scenarios: ['framework 直接拥有 class instance。', 'bulk replacement 必须是一次 bounded reactive transaction。', 'per-key 与 iteration observer 必须保持分离。'],
      avoidWhen: ['factory syntax 已足够。', '要求暴露 native mutable Map。', 'key 应被 weakly retain。'],
      options: storeIndexedCollectionOptions.map.zh
    }
  },
  'store-indexed:index:observableSet': {
    en: {
      purpose: 'Creates a reactive membership set with lazy per-value has dependencies and one structural dependency for size, iteration, and snapshots. Duplicate add and missing delete are no-op writes.',
      quickStart: "const permissions = observableSet(['read'], { debugName: 'permissions' }, runtime)\npermissions.add('write')\nif (permissions.has('write')) enableEditor()\npermissions.delete('read')\npermissions.dispose()",
      scenarios: ['Membership checks should react only when their queried value changes.', 'Size and enumeration need structural tracking.', 'Bulk clear or replace should publish one structural revision.'],
      avoidWhen: ['Each member has an associated value; use ObservableMap.', 'Duplicate members must be retained.', 'Weak membership is required.'],
      options: storeIndexedCollectionOptions.set.en
    },
    zh: {
      purpose: '创建 reactive membership set：惰性 per-value has dependency，并由一个 structural dependency 服务 size、iteration 与 snapshot。duplicate add 和 missing delete 都是 no-op write。',
      quickStart: "const permissions = observableSet(['read'], { debugName: 'permissions' }, runtime)\npermissions.add('write')\nif (permissions.has('write')) enableEditor()\npermissions.delete('read')\npermissions.dispose()",
      scenarios: ['membership check 只在其查询 value 改变时响应。', 'size 与 enumeration 需要 structural tracking。', 'bulk clear 或 replace 只应发布一次 structural revision。'],
      avoidWhen: ['每个 member 还有 associated value；使用 ObservableMap。', '必须保留 duplicate member。', '需要 weak membership。'],
      options: storeIndexedCollectionOptions.set.zh
    }
  },
  'store-indexed:index:ObservableSet': {
    en: {
      purpose: 'Class-form Observable Set with explicit Runtime ownership and idempotent disposal. replace updates only materialized membership cells before publishing at most one structural revision.',
      quickStart: "const active = new ObservableSet(ids, runtime, { debugName: 'activeIds' })\nactive.replace(nextIds)\nconst snapshot = active.snapshot()\nactive.prune()\nactive.dispose()",
      scenarios: ['Direct class construction fits an adapter boundary.', 'A large membership domain has few observed values.', 'Bulk replacement must avoid per-value structural notifications.'],
      avoidWhen: ['The factory is clearer.', 'Member order or duplicates are meaningful.', 'Lifecycle disposal cannot be guaranteed.'],
      options: storeIndexedCollectionOptions.set.en
    },
    zh: {
      purpose: '具有显式 Runtime ownership 与幂等 disposal 的 class-form Observable Set。replace 先更新已 materialize membership cell，再至多发布一次 structural revision。',
      quickStart: "const active = new ObservableSet(ids, runtime, { debugName: 'activeIds' })\nactive.replace(nextIds)\nconst snapshot = active.snapshot()\nactive.prune()\nactive.dispose()",
      scenarios: ['直接 class construction 适合 adapter boundary。', '大型 membership domain 只有少量 observed value。', 'bulk replacement 必须避免 per-value structural notification。'],
      avoidWhen: ['factory 更清晰。', 'member order 或 duplicate 有意义。', '无法保证 lifecycle disposal。'],
      options: storeIndexedCollectionOptions.set.zh
    }
  },
  'store-keyed:atom-definition:atomDef': {
    en: {
      purpose: 'Creates an immutable primitive definition token. Each AtomStore clones mutable initial containers when it first instantiates the definition, so Provider, SSR, and test scopes do not share object identity.',
      quickStart: "const countDef = atomDef(0, 'count')\nconst sessionDef = atomDef({ userId: null }, 'session')\n\nconst store = createAtomStore(runtime)\nstore.set(countDef, (value) => value + 1)",
      scenarios: ['A keyed state value needs one reusable definition token.', 'The same definition must instantiate independently in several AtomStores.', 'A primitive or structured-cloneable synchronous initial value is available.'],
      avoidWhen: ['Initialization needs a function per store; use atomDefFactory.', 'The initial value is a Promise or thenable.', 'Mutable input cannot be structured-cloned independently.'],
      options: [
        { name: 'init', description: 'Synchronous initial value cloned per AtomStore when it is a mutable container.', defaultValue: 'required', optional: false, type: 'T', whenToUse: 'Declare a stable primitive or structured-cloneable template.', example: "atomDef({ userId: null }, 'session')" },
        { name: 'debugLabel', description: 'Diagnostic label for the instantiated Signal; it is not a key or identity.', defaultValue: 'undefined', type: 'string', whenToUse: 'Make traces and development tooling readable.', example: "atomDef(0, 'count')" }
      ]
    },
    zh: {
      purpose: '创建不可变 primitive definition token。每个 AtomStore 首次实例化时会 clone 可变初值容器，因此 Provider、SSR 与测试 scope 不共享 object identity。',
      quickStart: "const countDef = atomDef(0, 'count')\nconst sessionDef = atomDef({ userId: null }, 'session')\n\nconst store = createAtomStore(runtime)\nstore.set(countDef, (value) => value + 1)",
      scenarios: ['keyed state value 需要可复用 definition token。', '同一 definition 必须在多个 AtomStore 中独立实例化。', '已有 primitive 或 structured-cloneable 同步初值。'],
      avoidWhen: ['每个 store 需要调用 factory 初始化；使用 atomDefFactory。', '初值是 Promise 或 thenable。', '可变输入无法独立 structured-clone。'],
      options: [
        { name: 'init', description: '同步初值；若为可变容器，会在每个 AtomStore 中独立 clone。', defaultValue: '必填', optional: false, type: 'T', whenToUse: '声明稳定 primitive 或 structured-cloneable template。', example: "atomDef({ userId: null }, 'session')" },
        { name: 'debugLabel', description: '实例 Signal 的诊断 label；不是 key，也不参与 identity。', defaultValue: 'undefined', type: 'string', whenToUse: '提高 trace 与开发工具可读性。', example: "atomDef(0, 'count')" }
      ]
    }
  },
  'store-keyed:atom-definition:atomDefFactory': {
    en: {
      purpose: 'Creates a primitive definition whose synchronous factory runs once per AtomStore on first real instantiation. The factory is preview-unsafe by default so speculative rendering cannot silently perform effects.',
      quickStart: "const requestIdDef = atomDefFactory(() => crypto.randomUUID(), 'request-id')\nconst requestId = store.get(requestIdDef)",
      scenarios: ['Each AtomStore needs a fresh non-shared initial value.', 'Initialization is synchronous but cannot be represented as a cloneable template.', 'Speculative preview must reject factory execution.'],
      avoidWhen: ['The factory is asynchronous.', 'React preview must execute it; only a proven pure factory may use previewSafeAtomDefFactory.', 'The initial value is already a simple cloneable constant.'],
      options: [
        { name: 'create', description: 'Synchronous factory invoked once by each AtomStore during first real instantiation.', defaultValue: 'required', optional: false, type: '() => T', whenToUse: 'Produce per-store identity without sharing a template reference.', example: 'atomDefFactory(() => new Map())' },
        { name: 'debugLabel', description: 'Diagnostic label for the instantiated Signal.', defaultValue: 'undefined', type: 'string', whenToUse: 'Identify the factory definition in traces.', example: "atomDefFactory(() => new Map(), 'cache')" }
      ]
    },
    zh: {
      purpose: '创建 primitive definition，其同步 factory 在每个 AtomStore 首次真实实例化时执行一次。默认禁止 preview，避免 speculative rendering 静默执行副作用。',
      quickStart: "const requestIdDef = atomDefFactory(() => crypto.randomUUID(), 'request-id')\nconst requestId = store.get(requestIdDef)",
      scenarios: ['每个 AtomStore 需要全新、不共享的初值。', '初始化同步，但无法表示为可 clone template。', 'speculative preview 必须拒绝执行 factory。'],
      avoidWhen: ['factory 是异步的。', 'React preview 必须执行它；只有已证明纯函数才使用 previewSafeAtomDefFactory。', '初值已经是简单 cloneable constant。'],
      options: [
        { name: 'create', description: '每个 AtomStore 首次真实实例化时调用一次的同步 factory。', defaultValue: '必填', optional: false, type: '() => T', whenToUse: '产生 per-store identity，不共享 template reference。', example: 'atomDefFactory(() => new Map())' },
        { name: 'debugLabel', description: '实例 Signal 使用的诊断 label。', defaultValue: 'undefined', type: 'string', whenToUse: '在 trace 中标识 factory definition。', example: "atomDefFactory(() => new Map(), 'cache')" }
      ]
    }
  },
  'store-keyed:atom-definition:previewSafeAtomDefFactory': {
    en: {
      purpose: 'Creates a primitive factory definition explicitly allowed in speculative preview. This is a caller promise that create is pure, deterministic, synchronous, and free of externally visible effects.',
      quickStart: "const modelDef = previewSafeAtomDefFactory(() => ({ selected: null }), 'model')\nconst candidate = store.preview(modelDef)",
      scenarios: ['Concurrent rendering needs a temporary value before commit.', 'The factory creates only isolated in-memory data.', 'Abandoned preview execution has no observable consequence.'],
      avoidWhen: ['The factory opens connections, registers callbacks, allocates owned resources, reads time/randomness, or mutates globals.', 'The factory returns a thenable.', 'Preview is not required; atomDefFactory is the safer default.'],
      options: [
        { name: 'create', description: 'Pure synchronous factory that may execute in an abandoned preview.', defaultValue: 'required', optional: false, type: '() => T', whenToUse: 'Only after proving speculative execution is harmless.', example: 'previewSafeAtomDefFactory(() => ({ selected: null }))' },
        { name: 'debugLabel', description: 'Diagnostic label for the previewed and committed instance.', defaultValue: 'undefined', type: 'string', whenToUse: 'Correlate preview and committed reads in diagnostics.', example: "previewSafeAtomDefFactory(() => ({}), 'model')" }
      ]
    },
    zh: {
      purpose: '创建显式允许 speculative preview 的 primitive factory definition。这是调用方承诺：create 纯、确定、同步且没有外部可观察副作用。',
      quickStart: "const modelDef = previewSafeAtomDefFactory(() => ({ selected: null }), 'model')\nconst candidate = store.preview(modelDef)",
      scenarios: ['并发渲染在 commit 前需要临时 value。', 'factory 只创建隔离的内存数据。', '被放弃的 preview execution 没有可观察后果。'],
      avoidWhen: ['factory 打开连接、注册 callback、分配 owned resource、读取时间/随机数或 mutation global。', 'factory 返回 thenable。', '不需要 preview；atomDefFactory 是更安全默认值。'],
      options: [
        { name: 'create', description: '可能在被放弃 preview 中执行的纯同步 factory。', defaultValue: '必填', optional: false, type: '() => T', whenToUse: '只有证明 speculative execution 无害后使用。', example: 'previewSafeAtomDefFactory(() => ({ selected: null }))' },
        { name: 'debugLabel', description: 'preview 与 committed instance 共用的诊断 label。', defaultValue: 'undefined', type: 'string', whenToUse: '在诊断中关联 preview 与 committed read。', example: "previewSafeAtomDefFactory(() => ({}), 'model')" }
      ]
    }
  },
  'store-keyed:atom-definition:derivedDef': {
    en: {
      purpose: 'Creates a read-only derived definition. read receives the current AtomStore getter, builds dependencies within that store, and uses Object.is unless a custom equality function is supplied.',
      quickStart: "const totalDef = derivedDef(\n  (get) => get(priceDef) * get(quantityDef),\n  'total'\n)\nconst total = store.get(totalDef)",
      scenarios: ['A value derives from other definitions in the same AtomStore.', 'The same derivation blueprint must work across several stores.', 'Custom value equality can suppress redundant downstream notifications.'],
      avoidWhen: ['Callers need to write through the projection; use writableDef or an optic.', 'The read returns a Promise.', 'Dependencies belong to another AtomStore or Runtime.'],
      options: [
        { name: 'read', description: 'Synchronous derivation using get to read definitions from the same AtomStore.', defaultValue: 'required', optional: false, type: 'IAtomRead<T>', whenToUse: 'Express a pure dependency projection.', example: '(get) => get(priceDef) * get(quantityDef)' },
        { name: 'debugLabel', description: 'Diagnostic name for the instantiated Computed.', defaultValue: 'undefined', type: 'string', whenToUse: 'Make dependency traces readable.', example: "'total'" },
        { name: 'equals', description: 'Equality function controlling downstream publication when the derivation recomputes.', defaultValue: 'Object.is', type: '(left: T, right: T) => boolean', whenToUse: 'Use value equality when equivalent projections allocate new references.', example: 'shallowEqual' }
      ]
    },
    zh: {
      purpose: '创建只读 derived definition。read 接收当前 AtomStore getter，在同一 store 内建立依赖；未传 equals 时使用 Object.is。',
      quickStart: "const totalDef = derivedDef(\n  (get) => get(priceDef) * get(quantityDef),\n  'total'\n)\nconst total = store.get(totalDef)",
      scenarios: ['一个值从同一 AtomStore 的其他 definition 派生。', '同一 derivation blueprint 必须跨多个 store 工作。', '自定义 value equality 可抑制冗余下游通知。'],
      avoidWhen: ['caller 需要通过 projection 写入；使用 writableDef 或 optic。', 'read 返回 Promise。', '依赖属于其他 AtomStore 或 Runtime。'],
      options: [
        { name: 'read', description: '使用 get 读取同一 AtomStore definition 的同步 derivation。', defaultValue: '必填', optional: false, type: 'IAtomRead<T>', whenToUse: '表达纯 dependency projection。', example: '(get) => get(priceDef) * get(quantityDef)' },
        { name: 'debugLabel', description: '实例 Computed 的诊断名称。', defaultValue: 'undefined', type: 'string', whenToUse: '提高 dependency trace 可读性。', example: "'total'" },
        { name: 'equals', description: 'derivation 重算时控制下游 publish 的相等函数。', defaultValue: 'Object.is', type: '(left: T, right: T) => boolean', whenToUse: '等价 projection 会分配新 reference 时使用 value equality。', example: 'shallowEqual' }
      ]
    }
  },
  'store-keyed:atom-definition:writableDef': {
    en: {
      purpose: 'Creates a derived definition with an explicit write contract. write receives same-store get/set functions and custom arguments, allowing one admitted write to update several related definitions in one batch.',
      quickStart: "const fullNameDef = writableDef(\n  (get) => `${get(firstDef)} ${get(lastDef)}`,\n  (_get, set, first, last) => {\n    set(firstDef, first)\n    set(lastDef, last)\n  },\n  'full-name'\n)\nstore.set(fullNameDef, 'Ada', 'Lovelace')",
      scenarios: ['A projection needs domain-specific write arguments.', 'One logical write updates several source definitions.', 'Read equality should remain configurable independently from write behavior.'],
      avoidWhen: ['The derivation is read-only.', 'The write contract is standard focus replacement; focusDef or opticDef is clearer.', 'Write logic crosses AtomStore or Runtime boundaries.'],
      options: [
        { name: 'read', description: 'Synchronous same-store derivation for the public value.', defaultValue: 'required', optional: false, type: 'IAtomRead<T>', whenToUse: 'Define how callers read the derived state.', example: '(get) => get(firstDef) + get(lastDef)' },
        { name: 'write', description: 'Same-store writer receiving get, set, and the custom argument tuple.', defaultValue: 'required', optional: false, type: 'IAtomWriter<Args, Result>', whenToUse: 'Encode a domain write contract or coordinated update.', example: '(_get, set, value) => set(sourceDef, value)' },
        { name: 'debugLabel', description: 'Diagnostic label for the derived instance.', defaultValue: 'undefined', type: 'string', whenToUse: 'Identify the writable derivation in traces.', example: "'full-name'" },
        { name: 'equals', description: 'Read-side equality used by the instantiated Computed.', defaultValue: 'Object.is', type: '(left: T, right: T) => boolean', whenToUse: 'Suppress notifications for semantically equal derived values.', example: 'shallowEqual' }
      ]
    },
    zh: {
      purpose: '创建带显式 write contract 的 derived definition。write 接收同 store get/set 与自定义参数，使一次获准写入可在一个 batch 中更新多个关联 definition。',
      quickStart: "const fullNameDef = writableDef(\n  (get) => `${get(firstDef)} ${get(lastDef)}`,\n  (_get, set, first, last) => {\n    set(firstDef, first)\n    set(lastDef, last)\n  },\n  'full-name'\n)\nstore.set(fullNameDef, 'Ada', 'Lovelace')",
      scenarios: ['projection 需要领域自定义 write 参数。', '一次逻辑写入更新多个 source definition。', 'read equality 应与 write behavior 独立配置。'],
      avoidWhen: ['derivation 只读。', 'write contract 只是标准 focus replacement；focusDef 或 opticDef 更清楚。', 'write logic 跨 AtomStore 或 Runtime。'],
      options: [
        { name: 'read', description: '公开 value 的同步同 store derivation。', defaultValue: '必填', optional: false, type: 'IAtomRead<T>', whenToUse: '定义 caller 如何读取 derived state。', example: '(get) => get(firstDef) + get(lastDef)' },
        { name: 'write', description: '接收 get、set 与自定义参数 tuple 的同 store writer。', defaultValue: '必填', optional: false, type: 'IAtomWriter<Args, Result>', whenToUse: '编码 domain write contract 或 coordinated update。', example: '(_get, set, value) => set(sourceDef, value)' },
        { name: 'debugLabel', description: 'derived instance 的诊断 label。', defaultValue: 'undefined', type: 'string', whenToUse: '在 trace 中标识 writable derivation。', example: "'full-name'" },
        { name: 'equals', description: '实例 Computed 使用的读侧 equality。', defaultValue: 'Object.is', type: '(left: T, right: T) => boolean', whenToUse: '对语义相等 derived value 抑制通知。', example: 'shallowEqual' }
      ]
    }
  },
  'store-keyed:atom-store:createAtomStore': {
    en: {
      purpose: 'Creates one isolated AtomStore over an explicit Runtime. Definitions are reusable blueprints; this store owns their concrete Signal/Computed instances, subscriptions, overrides, previews, release, and disposal.',
      quickStart: "const runtime = createRuntime()\nconst store = createAtomStore(runtime)\nconst countDef = atomDef(0, 'count')\n\ntry {\n  store.set(countDef, 1)\n  console.log(store.get(countDef))\n} finally {\n  store.dispose()\n}",
      scenarios: ['A Provider, SSR request, or test needs an independent keyed state scope.', 'Definition tokens are shared while state instances remain isolated.', 'Explicit release and whole-store disposal are required.'],
      avoidWhen: ['Legacy instance APIs intentionally share one default store per Runtime.', 'The Runtime belongs to another lifecycle owner that cannot outlive the AtomStore.', 'The caller expects definitions themselves to contain mutable state.'],
      options: [{ name: 'runtime', description: 'Reactive Runtime owning all instantiated nodes and subscriptions in this AtomStore.', defaultValue: 'required', optional: false, type: 'IRuntime', whenToUse: 'Pass the scope-local Runtime used by the surrounding Provider, request, or test.', example: 'createAtomStore(runtime)' }]
    },
    zh: {
      purpose: '在显式 Runtime 上创建隔离 AtomStore。definition 是可复用 blueprint；store 拥有其具体 Signal/Computed instance、subscription、override、preview、release 与 disposal。',
      quickStart: "const runtime = createRuntime()\nconst store = createAtomStore(runtime)\nconst countDef = atomDef(0, 'count')\n\ntry {\n  store.set(countDef, 1)\n  console.log(store.get(countDef))\n} finally {\n  store.dispose()\n}",
      scenarios: ['Provider、SSR request 或 test 需要独立 keyed state scope。', '共享 definition token，同时保持 state instance 隔离。', '需要显式 release 与 whole-store disposal。'],
      avoidWhen: ['legacy instance API 刻意共享每 Runtime 一个 default store。', 'Runtime 属于无法覆盖 AtomStore 生命周期的其他 owner。', '调用方期望 definition 自身包含可变状态。'],
      options: [{ name: 'runtime', description: '拥有当前 AtomStore 全部实例 node 与 subscription 的 Reactive Runtime。', defaultValue: '必填', optional: false, type: 'IRuntime', whenToUse: '传入周围 Provider、request 或 test 使用的 scope-local Runtime。', example: 'createAtomStore(runtime)' }]
    }
  },
  'store-keyed:atom-store:defaultAtomStore': {
    en: {
      purpose: 'Returns the cached default AtomStore for one Runtime, recreating it after disposal. It exists for legacy instance-style APIs; Provider and request scopes should create explicit stores.',
      quickStart: "const shared = defaultAtomStore(runtime)\nshared.set(countDef, 1)",
      scenarios: ['Legacy instance-style adapters on one Runtime must share keyed state.', 'The caller needs stable default identity without a Provider.', 'A disposed default should be recreated lazily.'],
      avoidWhen: ['Provider, SSR, or tests require isolation.', 'Several independent state roots use the same Runtime.', 'Default-store caching would hide lifecycle ownership.'],
      options: [{ name: 'runtime', description: 'Runtime used as the WeakMap key and owner of the cached default AtomStore.', defaultValue: 'required', optional: false, type: 'IRuntime', whenToUse: 'Bridge legacy instance APIs that already share this Runtime.', example: 'defaultAtomStore(runtime)' }]
    },
    zh: {
      purpose: '返回某个 Runtime 缓存的 default AtomStore，disposed 后会重新创建。它服务于 legacy instance-style API；Provider 与 request scope 应显式创建 store。',
      quickStart: "const shared = defaultAtomStore(runtime)\nshared.set(countDef, 1)",
      scenarios: ['同一 Runtime 上的 legacy instance-style adapter 必须共享 keyed state。', '没有 Provider 时需要稳定 default identity。', 'disposed default 需要惰性重建。'],
      avoidWhen: ['Provider、SSR 或 test 需要隔离。', '同一 Runtime 上存在多个独立 state root。', 'default-store cache 会掩盖 lifecycle ownership。'],
      options: [{ name: 'runtime', description: '作为 WeakMap key 并拥有 cached default AtomStore 的 Runtime。', defaultValue: '必填', optional: false, type: 'IRuntime', whenToUse: '桥接已经共享该 Runtime 的 legacy instance API。', example: 'defaultAtomStore(runtime)' }]
    }
  },
  'store-keyed:index:familyDef': {
    en: {
      purpose: 'Creates a key-to-primitive-definition family with stable token identity, a bounded strong LRU window, weak canonical reuse, explicit forget/clear operations, and per-AtomStore initial values.',
      quickStart: "const todoDef = familyDef(\n  (id: string) => ({ id, done: false }),\n  { maxSize: 1_000, debugLabel: 'todo' }\n)\n\nconst item = todoDef('todo-42')\nstore.set(item, (value) => ({ ...value, done: true }))",
      scenarios: ['A large keyed domain needs lazily created writable definition tokens.', 'The same key must resolve to a stable token while it remains canonical.', 'Strong cache growth needs an explicit bound and cleanup controls.'],
      avoidWhen: ['The host lacks WeakRef or FinalizationRegistry.', 'Keys are arbitrary objects; family keys are primitive PropertyKey values.', 'forget or clear is expected to release already-instantiated AtomStore nodes.'],
      options: [
        { name: 'initial', description: 'Synchronous per-key initializer used by the generated primitive factory definition.', defaultValue: 'required', optional: false, type: '(key: K) => T', whenToUse: 'Create an independent initial value for each key and AtomStore.', example: '(id) => ({ id, done: false })' },
        { name: 'maxSize', description: 'Positive safe-integer bound for strongly retained definition tokens before LRU eviction to weak canonical references.', defaultValue: '4096', type: 'number', whenToUse: 'Set from the measured active-key working set.', example: '{ maxSize: 1_000 }' },
        { name: 'debugLabel', description: 'Prefix used to label generated definitions as label[key].', defaultValue: "'family'", type: 'string', whenToUse: 'Make keyed instances identifiable in traces.', example: "{ debugLabel: 'todo' }" }
      ]
    },
    zh: {
      purpose: '创建 key 到 primitive definition 的 family，提供稳定 token identity、有界 strong LRU window、weak canonical reuse、显式 forget/clear 与 per-AtomStore 初值。',
      quickStart: "const todoDef = familyDef(\n  (id: string) => ({ id, done: false }),\n  { maxSize: 1_000, debugLabel: 'todo' }\n)\n\nconst item = todoDef('todo-42')\nstore.set(item, (value) => ({ ...value, done: true }))",
      scenarios: ['大型 keyed domain 需要惰性创建 writable definition token。', '同一 key 在 canonical 期间必须解析为稳定 token。', 'strong cache 增长需要显式 bound 与 cleanup control。'],
      avoidWhen: ['host 缺少 WeakRef 或 FinalizationRegistry。', 'key 是任意 object；family key 只接受 primitive PropertyKey。', '期望 forget/clear 释放已经实例化的 AtomStore node。'],
      options: [
        { name: 'initial', description: 'generated primitive factory definition 使用的同步 per-key initializer。', defaultValue: '必填', optional: false, type: '(key: K) => T', whenToUse: '为每个 key 与 AtomStore 创建独立初值。', example: '(id) => ({ id, done: false })' },
        { name: 'maxSize', description: 'strong retained definition token 的正安全整数上限；超出后按 LRU 淘汰到 weak canonical reference。', defaultValue: '4096', type: 'number', whenToUse: '根据测量得到的 active-key working set 设置。', example: '{ maxSize: 1_000 }' },
        { name: 'debugLabel', description: '把生成 definition 标为 label[key] 的前缀。', defaultValue: "'family'", type: 'string', whenToUse: '在 trace 中识别 keyed instance。', example: "{ debugLabel: 'todo' }" }
      ]
    }
  },
  'store-keyed:index:derivedFamilyDef': {
    en: {
      purpose: 'Creates a bounded key-to-read-only-derived-definition family. Each key returns a stable derivation blueprint whose read function resolves definitions in whichever AtomStore instantiates it.',
      quickStart: "const todoDoneDef = derivedFamilyDef(\n  (id: string) => (get) => get(todoDef(id)).done,\n  { maxSize: 1_000, debugLabel: 'todo-done' }\n)\nconst done = store.get(todoDoneDef('todo-42'))",
      scenarios: ['Each business key needs a reusable read-only projection.', 'Projection tokens must be shared while concrete state remains per AtomStore.', 'The active-key definition cache needs a finite strong bound.'],
      avoidWhen: ['Callers need to write through the family member.', 'The host lacks WeakRef or FinalizationRegistry.', 'Clearing the family is expected to dispose AtomStore instances.'],
      options: [
        { name: 'read', description: 'Per-key factory returning the synchronous same-store derivation function.', defaultValue: 'required', optional: false, type: '(key: K) => IAtomRead<T>', whenToUse: 'Build one read-only definition blueprint per business key.', example: '(id) => (get) => get(todoDef(id)).done' },
        { name: 'maxSize', description: 'Positive safe-integer bound for the strong LRU definition window.', defaultValue: '4096', type: 'number', whenToUse: 'Bound retained tokens for large or unbounded key domains.', example: '{ maxSize: 1_000 }' },
        { name: 'debugLabel', description: 'Prefix used for generated derived labels.', defaultValue: "'derived-family'", type: 'string', whenToUse: 'Identify per-key projections in diagnostics.', example: "{ debugLabel: 'todo-done' }" }
      ]
    },
    zh: {
      purpose: '创建有界 key 到只读 derived definition 的 family。每个 key 返回稳定 derivation blueprint，其 read 在实例化它的 AtomStore 内解析 definition。',
      quickStart: "const todoDoneDef = derivedFamilyDef(\n  (id: string) => (get) => get(todoDef(id)).done,\n  { maxSize: 1_000, debugLabel: 'todo-done' }\n)\nconst done = store.get(todoDoneDef('todo-42'))",
      scenarios: ['每个业务 key 需要可复用只读 projection。', '共享 projection token，同时保持 concrete state 属于各自 AtomStore。', 'active-key definition cache 需要有限 strong bound。'],
      avoidWhen: ['caller 需要通过 family member 写入。', 'host 缺少 WeakRef 或 FinalizationRegistry。', '期望 clear family 会 dispose AtomStore instance。'],
      options: [
        { name: 'read', description: '返回同步同 store derivation function 的 per-key factory。', defaultValue: '必填', optional: false, type: '(key: K) => IAtomRead<T>', whenToUse: '为每个业务 key 构建只读 definition blueprint。', example: '(id) => (get) => get(todoDef(id)).done' },
        { name: 'maxSize', description: 'strong LRU definition window 的正安全整数上限。', defaultValue: '4096', type: 'number', whenToUse: '为大型或无界 key domain 限制 retained token。', example: '{ maxSize: 1_000 }' },
        { name: 'debugLabel', description: 'generated derived label 的前缀。', defaultValue: "'derived-family'", type: 'string', whenToUse: '在诊断中识别 per-key projection。', example: "{ debugLabel: 'todo-done' }" }
      ]
    }
  },
  'store-keyed:index:selectDef': {
    en: {
      purpose: 'Creates a read-only projection definition over another definition. Equality applies to the selected value, so unrelated source changes need not notify downstream observers.',
      quickStart: "const selectedIdDef = selectDef(\n  viewDef,\n  (view) => view.selectedId\n)\nconst selectedId = store.get(selectedIdDef)",
      scenarios: ['Consumers need one read-only field from a larger source value.', 'Source objects change while selected values often remain equal.', 'Projection logic should stay reusable across AtomStores.'],
      avoidWhen: ['Callers must write the selected value.', 'Selection performs effects or asynchronous work.', 'The source is not an Atom definition.'],
      options: [
        { name: 'source', description: 'Readable source definition instantiated in the same AtomStore as the projection.', defaultValue: 'required', optional: false, type: 'IAtomDefinition<Source>', whenToUse: 'Choose the state blueprint being projected.', example: 'selectDef(viewDef, select)' },
        { name: 'select', description: 'Pure synchronous selector from source value to projected value.', defaultValue: 'required', optional: false, type: '(value: Source) => Selected', whenToUse: 'Extract or compute the read-only view.', example: '(view) => view.selectedId' },
        { name: 'equals', description: 'Equality applied to successive selected values.', defaultValue: 'Object.is', type: '(left: Selected, right: Selected) => boolean', whenToUse: 'Use structural equality for small projections that allocate new references.', example: 'shallowEqual' }
      ]
    },
    zh: {
      purpose: '在另一个 definition 上创建只读 projection definition。equality 作用于 selected value，因此 source 的无关变化不必通知下游。',
      quickStart: "const selectedIdDef = selectDef(\n  viewDef,\n  (view) => view.selectedId\n)\nconst selectedId = store.get(selectedIdDef)",
      scenarios: ['consumer 只需要大型 source value 的一个只读字段。', 'source object 会变化，但 selected value 经常相等。', 'projection logic 需要跨 AtomStore 复用。'],
      avoidWhen: ['caller 必须写 selected value。', 'selection 执行副作用或异步工作。', 'source 不是 Atom definition。'],
      options: [
        { name: 'source', description: '与 projection 在同一 AtomStore 实例化的 readable source definition。', defaultValue: '必填', optional: false, type: 'IAtomDefinition<Source>', whenToUse: '选择被投影的 state blueprint。', example: 'selectDef(viewDef, select)' },
        { name: 'select', description: '从 source value 到 projected value 的纯同步 selector。', defaultValue: '必填', optional: false, type: '(value: Source) => Selected', whenToUse: '提取或计算只读 view。', example: '(view) => view.selectedId' },
        { name: 'equals', description: '应用于连续 selected value 的 equality。', defaultValue: 'Object.is', type: '(left: Selected, right: Selected) => boolean', whenToUse: '小型 projection 会分配新 reference 时使用 structural equality。', example: 'shallowEqual' }
      ]
    }
  },
  'store-keyed:index:opticDef': {
    en: {
      purpose: 'Creates a standard writable focus using a caller-supplied immutable lens. Equal focus writes are skipped; changed writes rebuild the source through optic.set.',
      quickStart: "const nameDef = opticDef(profileDef, {\n  get: (profile) => profile.name,\n  set: (profile, name) => ({ ...profile, name })\n})\nstore.set(nameDef, 'Ada')",
      scenarios: ['A reusable custom lens already defines immutable get/set behavior.', 'A focused value needs standard value-or-updater writes.', 'No-op writes should avoid touching the source definition.'],
      avoidWhen: ['The source has a custom writableDef argument contract instead of standard set(update).', 'The focus is a simple one-to-three-segment object path; focusDef is clearer.', 'optic.set mutates the original source in place.'],
      options: [
        { name: 'source', description: 'Standard writable source definition accepting a value or updater.', defaultValue: 'required', optional: false, type: 'IStandardWritableDef<Source>', whenToUse: 'Choose the immutable source state.', example: 'opticDef(profileDef, optic)' },
        { name: 'optic', description: 'Immutable get/set lens for the focused value.', defaultValue: 'required', optional: false, type: 'IDefOptic<Source, Focus>', whenToUse: 'Provide reusable focus logic beyond a simple property path.', example: '{ get: p => p.name, set: (p, name) => ({ ...p, name }) }' }
      ]
    },
    zh: {
      purpose: '使用调用方提供的 immutable lens 创建标准 writable focus。focus 相等时跳过写入；变化时通过 optic.set 重建 source。',
      quickStart: "const nameDef = opticDef(profileDef, {\n  get: (profile) => profile.name,\n  set: (profile, name) => ({ ...profile, name })\n})\nstore.set(nameDef, 'Ada')",
      scenarios: ['已有可复用自定义 lens 定义 immutable get/set。', 'focused value 需要标准 value-or-updater 写语义。', 'no-op write 不应触碰 source definition。'],
      avoidWhen: ['source 是自定义 writableDef 参数契约，而不是标准 set(update)。', 'focus 是一到三段简单 object path；focusDef 更清楚。', 'optic.set 原地 mutation 原始 source。'],
      options: [
        { name: 'source', description: '接受 value 或 updater 的标准 writable source definition。', defaultValue: '必填', optional: false, type: 'IStandardWritableDef<Source>', whenToUse: '选择 immutable source state。', example: 'opticDef(profileDef, optic)' },
        { name: 'optic', description: 'focused value 的 immutable get/set lens。', defaultValue: '必填', optional: false, type: 'IDefOptic<Source, Focus>', whenToUse: '提供超出简单 property path 的复用 focus logic。', example: '{ get: p => p.name, set: (p, name) => ({ ...p, name }) }' }
      ]
    }
  },
  'store-keyed:index:focusDef': {
    en: {
      purpose: 'Creates a writable definition focused on a one-to-three-segment object path. Reads validate every intermediate object; writes immutably clone each traversed container.',
      quickStart: "const cityDef = focusDef(profileDef, 'address', 'city')\nstore.set(cityDef, 'London')",
      scenarios: ['A nested object field needs independent subscription and standard writes.', 'The path is known statically and no custom lens is needed.', 'Immutable structural sharing must preserve untouched branches.'],
      avoidWhen: ['The path is empty.', 'An intermediate path value may be null or non-object and should be tolerated.', 'Arrays or custom collection updates need domain-specific semantics.'],
      options: [
        { name: 'source', description: 'Standard writable root definition containing the focused path.', defaultValue: 'required', optional: false, type: 'IStandardWritableDef<Source>', whenToUse: 'Choose the immutable object state.', example: "focusDef(profileDef, 'address', 'city')" },
        { name: 'path', description: 'One to three property-key segments traversed and cloned during writes.', defaultValue: 'required', optional: false, type: 'readonly PropertyKey[]', whenToUse: 'Name the statically known nested field.', example: "['address', 'city']" }
      ]
    },
    zh: {
      purpose: '创建聚焦一到三段 object path 的 writable definition。读取会校验每个中间 object；写入会 immutable clone 每个经过的 container。',
      quickStart: "const cityDef = focusDef(profileDef, 'address', 'city')\nstore.set(cityDef, 'London')",
      scenarios: ['嵌套 object field 需要独立 subscription 与标准写入。', 'path 静态已知，不需要自定义 lens。', 'immutable structural sharing 必须保留未触碰分支。'],
      avoidWhen: ['path 为空。', '中间 path value 可能为 null/非 object 且希望容忍。', 'array 或自定义 collection update 需要领域语义。'],
      options: [
        { name: 'source', description: '包含 focused path 的标准 writable root definition。', defaultValue: '必填', optional: false, type: 'IStandardWritableDef<Source>', whenToUse: '选择 immutable object state。', example: "focusDef(profileDef, 'address', 'city')" },
        { name: 'path', description: '写入期间依次 traverse 与 clone 的一到三段 property key。', defaultValue: '必填', optional: false, type: 'readonly PropertyKey[]', whenToUse: '标识静态已知 nested field。', example: "['address', 'city']" }
      ]
    }
  },
  'store-keyed:index:splitDef': {
    en: {
      purpose: 'Splits one writable array definition into stable per-key writable item definitions plus a derived ordered items list. insert/remove update the source; prune only trims the split token cache.',
      quickStart: "const todosDef = atomDef<readonly Todo[]>([])\nconst todos = splitDef(todosDef, (todo) => todo.id)\n\nconst itemDef = todos.of('todo-42')\nstore.set(itemDef, (todo) => ({ ...todo, done: true }))\ntodos.prune(store)",
      scenarios: ['List items need stable definition identity across reorder.', 'Each keyed item needs independent read/write subscriptions.', 'A long-running key domain needs explicit token-cache pruning.'],
      avoidWhen: ['Keys are not unique.', 'Array index is used as the default key while items reorder.', 'prune is expected to release AtomStore instances; call store.release for instantiated item definitions.'],
      options: [
        { name: 'source', description: 'Standard writable definition holding the immutable source array.', defaultValue: 'required', optional: false, type: 'IStandardWritableDef<readonly T[]>', whenToUse: 'Choose the list blueprint being split.', example: 'splitDef(todosDef, keyOf)' },
        { name: 'keyOf', description: 'Stable unique key selector; defaults to array index.', defaultValue: '(_item, index) => index', type: '(item: T, index: number) => Key', whenToUse: 'Always provide a business key when items can insert, remove, or reorder.', example: '(todo) => todo.id' }
      ]
    },
    zh: {
      purpose: '把一个 writable array definition 拆成稳定 per-key writable item definition 与 derived ordered items list。insert/remove 更新 source；prune 只裁剪 split token cache。',
      quickStart: "const todosDef = atomDef<readonly Todo[]>([])\nconst todos = splitDef(todosDef, (todo) => todo.id)\n\nconst itemDef = todos.of('todo-42')\nstore.set(itemDef, (todo) => ({ ...todo, done: true }))\ntodos.prune(store)",
      scenarios: ['list item 在 reorder 后仍需要稳定 definition identity。', '每个 keyed item 需要独立 read/write subscription。', '长期增长 key domain 需要显式 token-cache pruning。'],
      avoidWhen: ['key 不唯一。', 'item 会 reorder，却使用默认 array index key。', '期望 prune 释放 AtomStore instance；已实例 item definition 应调用 store.release。'],
      options: [
        { name: 'source', description: '持有 immutable source array 的标准 writable definition。', defaultValue: '必填', optional: false, type: 'IStandardWritableDef<readonly T[]>', whenToUse: '选择被 split 的 list blueprint。', example: 'splitDef(todosDef, keyOf)' },
        { name: 'keyOf', description: '稳定唯一 key selector；默认使用 array index。', defaultValue: '(_item, index) => index', type: '(item: T, index: number) => Key', whenToUse: 'item 可能 insert、remove 或 reorder 时必须提供业务 key。', example: '(todo) => todo.id' }
      ]
    }
  },
  'store-keyed:atom-definition:isAtomDefinition': {
    en: {
      purpose: 'Checks the canonical global definition brand and narrows an unknown value to an Atom definition. It does not instantiate state or inspect a definition by duck typing.',
      quickStart: "if (!isAtomDefinition(candidate)) {\n  throw new TypeError('expected an Atom definition')\n}\nconst value = store.get(candidate)",
      scenarios: ['An adapter accepts unknown definition input.', 'Two bundled copies of Store Keyed must recognize the same Symbol.for brand.', 'Tooling needs to distinguish blueprints from live atom instances.'],
      avoidWhen: ['The value is already statically typed as a definition.', 'The caller wants to create a definition.', 'A live IReadableAtom protocol object is being checked.'],
      options: [{ name: 'value', description: 'Unknown candidate tested for the canonical Atom definition brand.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Guard public adapter input before calling AtomStore methods.', example: 'isAtomDefinition(candidate)' }]
    },
    zh: {
      purpose: '检查 canonical global definition brand，并把 unknown value 收窄为 Atom definition；不会实例化 state，也不会用 duck typing 检查 definition。',
      quickStart: "if (!isAtomDefinition(candidate)) {\n  throw new TypeError('expected an Atom definition')\n}\nconst value = store.get(candidate)",
      scenarios: ['adapter 接受 unknown definition input。', 'Store Keyed 的两个 bundled copy 必须识别同一个 Symbol.for brand。', 'tooling 需要区分 blueprint 与 live atom instance。'],
      avoidWhen: ['value 已静态标注为 definition。', '调用方准备创建 definition。', '正在检查 live IReadableAtom protocol object。'],
      options: [{ name: 'value', description: '用于 canonical Atom definition brand 检查的 unknown candidate。', defaultValue: '必填', optional: false, type: 'unknown', whenToUse: '调用 AtomStore method 前保护 public adapter input。', example: 'isAtomDefinition(candidate)' }]
    }
  },
  'store-keyed:atom-definition:assertNotThenable': {
    en: {
      purpose: 'Rejects object and function thenables at synchronous Atom-definition boundaries. The then property is probed once; a hostile getter failure remains reachable as cause.',
      quickStart: "const initial = createInitialValue()\nassertNotThenable(initial, 'customDef(initial)')",
      scenarios: ['A custom definition constructor must remain synchronous.', 'A generic value may hide a Promise-like then property.', 'Diagnostics need the exact call-site context.'],
      avoidWhen: ['Asynchronous state is intentional; compose with Resource.', 'The value is already produced by atomDef, which calls the guard.', 'The caller wants to await or assimilate the thenable.'],
      options: [
        { name: 'value', description: 'Unknown value probed once for thenable behavior.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Protect a custom synchronous definition constructor.', example: 'assertNotThenable(initial, context)' },
        { name: 'context', description: 'Stable call-site label embedded in the invalid-option diagnostic.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Tell callers which synchronous boundary rejected the thenable.', example: "'customDef(initial)'" }
      ]
    },
    zh: {
      purpose: '在同步 Atom-definition boundary 拒绝 object/function thenable。then property 只 probe 一次；hostile getter failure 通过 cause 保持可达。',
      quickStart: "const initial = createInitialValue()\nassertNotThenable(initial, 'customDef(initial)')",
      scenarios: ['自定义 definition constructor 必须保持同步。', 'generic value 可能隐藏 Promise-like then property。', '诊断需要准确 call-site context。'],
      avoidWhen: ['刻意使用 async state；应与 Resource 组合。', 'value 已由 atomDef 产生，它已调用该 guard。', '调用方准备 await 或 assimilate thenable。'],
      options: [
        { name: 'value', description: '只 probe 一次 thenable behavior 的 unknown value。', defaultValue: '必填', optional: false, type: 'unknown', whenToUse: '保护自定义同步 definition constructor。', example: 'assertNotThenable(initial, context)' },
        { name: 'context', description: '嵌入 invalid-option 诊断的稳定 call-site label。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '告诉调用方哪个同步 boundary 拒绝 thenable。', example: "'customDef(initial)'" }
      ]
    }
  },
  'store-keyed:reactive-atom:atomGetter': {
    en: {
      purpose: 'Creates an instance-atom getter bound to one Runtime. Every read verifies atom.runtime identity before using the tracked value property.',
      quickStart: "const get = atomGetter(runtime)\nconst total = readTotal(get)\n\nfunction readTotal(get: IAtomGetter) {\n  return get(priceAtom) * get(quantityAtom)\n}",
      scenarios: ['An async or family extension implements instance-style atom reads.', 'A reusable read callback must enforce one Runtime domain.', 'Cross-runtime access must fail before dependency tracking.'],
      avoidWhen: ['Definition tokens and AtomStore are being used.', 'A non-tracking snapshot is needed; use the atom peek protocol.', 'Cross-runtime bridging is intentional; values must be transferred explicitly.'],
      options: [{ name: 'runtime', description: 'Runtime identity required of every atom passed to the returned getter.', defaultValue: 'required', optional: false, type: 'IRuntime', whenToUse: 'Bind extension-layer reads to their owning graph.', example: 'atomGetter(runtime)' }]
    },
    zh: {
      purpose: '创建绑定一个 Runtime 的 instance-atom getter。每次读取会先校验 atom.runtime identity，再使用 tracked value property。',
      quickStart: "const get = atomGetter(runtime)\nconst total = readTotal(get)\n\nfunction readTotal(get: IAtomGetter) {\n  return get(priceAtom) * get(quantityAtom)\n}",
      scenarios: ['async 或 family extension 实现 instance-style atom read。', '可复用 read callback 必须约束在一个 Runtime domain。', 'cross-runtime access 必须在 dependency tracking 前失败。'],
      avoidWhen: ['使用 definition token 与 AtomStore。', '需要 non-tracking snapshot；使用 atom peek protocol。', '刻意跨 Runtime bridge；应显式传输 value。'],
      options: [{ name: 'runtime', description: '返回 getter 要求每个 atom 匹配的 Runtime identity。', defaultValue: '必填', optional: false, type: 'IRuntime', whenToUse: '把 extension-layer read 绑定到 owning graph。', example: 'atomGetter(runtime)' }]
    }
  },
  'store-keyed:reactive-atom:atomSetter': {
    en: {
      purpose: 'Creates an instance-atom setter bound to one Runtime. It rejects cross-runtime atoms before forwarding the exact custom argument tuple to atom.write.',
      quickStart: "const set = atomSetter(runtime)\nset(countAtom, (value) => value + 1)",
      scenarios: ['An extension implements writable instance atoms.', 'Custom write arguments must pass through without reinterpretation.', 'Runtime ownership must be checked at the protocol boundary.'],
      avoidWhen: ['Definition tokens are written through AtomStore.set.', 'The target is read-only.', 'The caller is attempting implicit cross-runtime coordination.'],
      options: [{ name: 'runtime', description: 'Runtime identity required of every writable atom passed to the returned setter.', defaultValue: 'required', optional: false, type: 'IRuntime', whenToUse: 'Bind extension-layer writes to their owning graph.', example: 'atomSetter(runtime)' }]
    },
    zh: {
      purpose: '创建绑定一个 Runtime 的 instance-atom setter。在把准确 custom argument tuple 转发给 atom.write 前，会拒绝 cross-runtime atom。',
      quickStart: "const set = atomSetter(runtime)\nset(countAtom, (value) => value + 1)",
      scenarios: ['extension 实现 writable instance atom。', 'custom write argument 必须原样传递，不重新解释。', 'Runtime ownership 必须在 protocol boundary 校验。'],
      avoidWhen: ['definition token 通过 AtomStore.set 写入。', 'target 只读。', '调用方试图隐式跨 Runtime coordination。'],
      options: [{ name: 'runtime', description: '返回 setter 要求每个 writable atom 匹配的 Runtime identity。', defaultValue: '必填', optional: false, type: 'IRuntime', whenToUse: '把 extension-layer write 绑定到 owning graph。', example: 'atomSetter(runtime)' }]
    }
  },
  'store-keyed:index:readOpticPath': {
    en: {
      purpose: 'Reads a property-key path from an object graph using Reflect.get. Every intermediate value must be an object; invalid traversal fails with a labelled Store Keyed TypeError.',
      quickStart: "const city = readOpticPath(profile, ['address', 'city'], 'profile lens')",
      scenarios: ['A custom optic needs the same path-read semantics as focusDef.', 'Symbol or string property keys must be supported.', 'Failure diagnostics need a caller-owned label.'],
      avoidWhen: ['Missing or primitive intermediate values should be tolerated.', 'Dependency tracking is expected; this is a pure object helper.', 'The path comes from untrusted input without an allowlist.'],
      options: [
        { name: 'value', description: 'Root object graph to traverse.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Pass the current immutable source value.', example: 'readOpticPath(profile, path, label)' },
        { name: 'path', description: 'Ordered property keys traversed with Reflect.get.', defaultValue: 'required', optional: false, type: 'readonly PropertyKey[]', whenToUse: 'Describe the custom optic focus path.', example: "['address', 'city']" },
        { name: 'label', description: 'Stable diagnostic owner named when traversal fails.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Identify the custom lens or operation.', example: "'profile lens'" }
      ]
    },
    zh: {
      purpose: '使用 Reflect.get 从 object graph 读取 property-key path。每个中间值必须是 object；非法 traversal 会以带 label 的 Store Keyed TypeError 失败。',
      quickStart: "const city = readOpticPath(profile, ['address', 'city'], 'profile lens')",
      scenarios: ['自定义 optic 需要与 focusDef 相同的 path-read 语义。', '必须支持 Symbol 或 string property key。', 'failure 诊断需要 caller-owned label。'],
      avoidWhen: ['希望容忍缺失或 primitive 中间值。', '期望 dependency tracking；这是纯 object helper。', 'path 来自未做 allowlist 的不可信输入。'],
      options: [
        { name: 'value', description: '要 traverse 的 root object graph。', defaultValue: '必填', optional: false, type: 'unknown', whenToUse: '传入当前 immutable source value。', example: 'readOpticPath(profile, path, label)' },
        { name: 'path', description: '按顺序用 Reflect.get traverse 的 property key。', defaultValue: '必填', optional: false, type: 'readonly PropertyKey[]', whenToUse: '描述自定义 optic focus path。', example: "['address', 'city']" },
        { name: 'label', description: 'traversal 失败时命名 owner 的稳定诊断文本。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '标识 custom lens 或 operation。', example: "'profile lens'" }
      ]
    }
  },
  'store-keyed:index:writeOpticPath': {
    en: {
      purpose: 'Immutably writes a property-key path by shallow-cloning every traversed object or array. The __proto__ key is defined as data rather than changing the clone prototype.',
      quickStart: "const next = writeOpticPath(profile, ['address', 'city'], 'London', 'profile lens')",
      scenarios: ['A custom optic needs immutable path updates with structural sharing.', 'Arrays and objects occur along the same path.', 'Prototype-sensitive keys must remain ordinary data.'],
      avoidWhen: ['In-place mutation is required.', 'An intermediate path value may be primitive or null.', 'Deep clone of untouched branches is expected.'],
      options: [
        { name: 'value', description: 'Root object or array cloned along the write path.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Pass the current immutable source value.', example: 'writeOpticPath(profile, path, next, label)' },
        { name: 'path', description: 'Ordered property keys whose containing nodes are shallow-cloned.', defaultValue: 'required', optional: false, type: 'readonly PropertyKey[]', whenToUse: 'Describe the custom optic focus path.', example: "['address', 'city']" },
        { name: 'next', description: 'Replacement focus value written at the final segment.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Provide the already-computed next focus.', example: "'London'" },
        { name: 'label', description: 'Stable operation label used in invalid-path diagnostics.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Identify the owning custom lens.', example: "'profile lens'" }
      ]
    },
    zh: {
      purpose: '通过 shallow clone 每个经过的 object/array 来 immutable 写入 property-key path。__proto__ key 会被定义为普通 data，不会改变 clone prototype。',
      quickStart: "const next = writeOpticPath(profile, ['address', 'city'], 'London', 'profile lens')",
      scenarios: ['自定义 optic 需要带 structural sharing 的 immutable path update。', '同一路径中同时存在 array 与 object。', 'prototype-sensitive key 必须保持普通 data。'],
      avoidWhen: ['要求 in-place mutation。', '中间 path value 可能是 primitive 或 null。', '期望 deep clone 未触碰分支。'],
      options: [
        { name: 'value', description: '沿 write path clone 的 root object 或 array。', defaultValue: '必填', optional: false, type: 'unknown', whenToUse: '传入当前 immutable source value。', example: 'writeOpticPath(profile, path, next, label)' },
        { name: 'path', description: '其 container node 会被 shallow clone 的有序 property key。', defaultValue: '必填', optional: false, type: 'readonly PropertyKey[]', whenToUse: '描述自定义 optic focus path。', example: "['address', 'city']" },
        { name: 'next', description: '写到最终 segment 的 replacement focus value。', defaultValue: '必填', optional: false, type: 'unknown', whenToUse: '传入已经计算好的 next focus。', example: "'London'" },
        { name: 'label', description: '非法 path 诊断使用的稳定 operation label。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '标识 owning custom lens。', example: "'profile lens'" }
      ]
    }
  },
  'store-keyed:index:findKeyIndex': {
    en: {
      purpose: 'Returns the first array index whose derived key is Object.is-equal to the requested key, or -1 when absent. It is a pure linear scan and does not validate uniqueness.',
      quickStart: "const index = findKeyIndex(todos, (todo) => todo.id, 'todo-42')\nif (index >= 0) console.log(todos[index])",
      scenarios: ['Custom keyed collection logic needs the same lookup semantics as splitDef.', 'NaN and signed-zero keys must follow Object.is.', 'Absence is normal control flow represented by -1.'],
      avoidWhen: ['Duplicate-key validation is required.', 'Repeated lookup on a large list needs a maintained index.', 'A missing key must throw; use requireKeyIndex.'],
      options: [
        { name: 'items', description: 'Readonly array scanned from index zero.', defaultValue: 'required', optional: false, type: 'readonly T[]', whenToUse: 'Pass the current immutable list snapshot.', example: 'findKeyIndex(todos, keyOf, key)' },
        { name: 'keyOf', description: 'Key selector receiving each item and current index.', defaultValue: 'required', optional: false, type: '(item: T, index: number) => Key', whenToUse: 'Derive the same key domain used by surrounding split logic.', example: '(todo) => todo.id' },
        { name: 'key', description: 'Requested key compared with Object.is.', defaultValue: 'required', optional: false, type: 'Key', whenToUse: 'Locate one current list member.', example: "'todo-42'" }
      ]
    },
    zh: {
      purpose: '返回第一个 derived key 与请求 key 满足 Object.is 的 array index；不存在时返回 -1。它是纯线性 scan，不校验唯一性。',
      quickStart: "const index = findKeyIndex(todos, (todo) => todo.id, 'todo-42')\nif (index >= 0) console.log(todos[index])",
      scenarios: ['自定义 keyed collection logic 需要与 splitDef 相同 lookup 语义。', 'NaN 与 signed-zero key 必须遵循 Object.is。', '缺失是由 -1 表示的正常 control flow。'],
      avoidWhen: ['需要 duplicate-key validation。', '大型 list 上反复 lookup，应维护 index。', 'missing key 必须 throw；使用 requireKeyIndex。'],
      options: [
        { name: 'items', description: '从 index 0 开始 scan 的 readonly array。', defaultValue: '必填', optional: false, type: 'readonly T[]', whenToUse: '传入当前 immutable list snapshot。', example: 'findKeyIndex(todos, keyOf, key)' },
        { name: 'keyOf', description: '接收 item 与当前 index 的 key selector。', defaultValue: '必填', optional: false, type: '(item: T, index: number) => Key', whenToUse: '派生与周围 split logic 相同的 key domain。', example: '(todo) => todo.id' },
        { name: 'key', description: '使用 Object.is 比较的请求 key。', defaultValue: '必填', optional: false, type: 'Key', whenToUse: '定位一个当前 list member。', example: "'todo-42'" }
      ]
    }
  },
  'store-keyed:index:computeUniqueKeys': {
    en: {
      purpose: 'Computes and freezes the ordered key list for an array while rejecting the first duplicate under Set key equality.',
      quickStart: "const keys = computeUniqueKeys(todos, (todo) => todo.id, 'todos')",
      scenarios: ['A custom split kernel needs one ordered unique key snapshot.', 'Duplicate business keys must fail before item tokens are built.', 'The returned key list should be immutable.'],
      avoidWhen: ['Duplicate keys are intentionally allowed.', 'A maintained keyed index already owns validation.', 'The selector has side effects or depends on unstable external state.'],
      options: [
        { name: 'items', description: 'Readonly source list whose order defines key order.', defaultValue: 'required', optional: false, type: 'readonly T[]', whenToUse: 'Validate one immutable list snapshot.', example: 'computeUniqueKeys(todos, keyOf, label)' },
        { name: 'keyOf', description: 'Selector called once per item to derive its unique key.', defaultValue: 'required', optional: false, type: '(item: T, index: number) => Key', whenToUse: 'Provide the canonical business-key function.', example: '(todo) => todo.id' },
        { name: 'label', description: 'Stable operation label used in the duplicate-key error.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Identify the custom split owner.', example: "'todos'" }
      ]
    },
    zh: {
      purpose: '计算并 freeze array 的有序 key list，同时按 Set key equality 拒绝首个 duplicate。',
      quickStart: "const keys = computeUniqueKeys(todos, (todo) => todo.id, 'todos')",
      scenarios: ['自定义 split kernel 需要一份有序唯一 key snapshot。', 'duplicate business key 必须在构建 item token 前失败。', '返回 key list 应不可变。'],
      avoidWhen: ['刻意允许 duplicate key。', '已有 maintained keyed index 拥有 validation。', 'selector 有副作用或依赖不稳定外部状态。'],
      options: [
        { name: 'items', description: '其顺序定义 key 顺序的 readonly source list。', defaultValue: '必填', optional: false, type: 'readonly T[]', whenToUse: '校验一份 immutable list snapshot。', example: 'computeUniqueKeys(todos, keyOf, label)' },
        { name: 'keyOf', description: '每个 item 调用一次以派生唯一 key 的 selector。', defaultValue: '必填', optional: false, type: '(item: T, index: number) => Key', whenToUse: '提供 canonical business-key function。', example: '(todo) => todo.id' },
        { name: 'label', description: 'duplicate-key error 使用的稳定 operation label。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '标识 custom split owner。', example: "'todos'" }
      ]
    }
  },
  'store-keyed:index:requireKeyIndex': {
    en: {
      purpose: 'Performs findKeyIndex and throws a labelled Store Keyed error when the key no longer exists. It is the read/write guard used by stable split-item definitions.',
      quickStart: "const index = requireKeyIndex(todos, (todo) => todo.id, id, 'todo was removed')",
      scenarios: ['A stable item token must detect that its source item was removed.', 'Missing keys are contract failures rather than optional state.', 'Custom split reads and writes need consistent diagnostics.'],
      avoidWhen: ['Absence is expected; use findKeyIndex.', 'Duplicate keys need validation.', 'Repeated large-list lookup needs an index.'],
      options: [
        { name: 'items', description: 'Readonly list searched for the required key.', defaultValue: 'required', optional: false, type: 'readonly T[]', whenToUse: 'Pass the current source snapshot.', example: 'requireKeyIndex(items, keyOf, key, label)' },
        { name: 'keyOf', description: 'Canonical selector used for lookup.', defaultValue: 'required', optional: false, type: '(item: T, index: number) => Key', whenToUse: 'Match the surrounding split key domain.', example: '(todo) => todo.id' },
        { name: 'key', description: 'Required key that must still exist.', defaultValue: 'required', optional: false, type: 'Key', whenToUse: 'Resolve a stable item token against the latest list.', example: 'id' },
        { name: 'label', description: 'Stable missing-item diagnostic.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Explain whether a read or write target was removed.', example: "'todo was removed'" }
      ]
    },
    zh: {
      purpose: '执行 findKeyIndex，并在 key 已不存在时抛带 label 的 Store Keyed error；这是稳定 split-item definition 的 read/write guard。',
      quickStart: "const index = requireKeyIndex(todos, (todo) => todo.id, id, 'todo was removed')",
      scenarios: ['稳定 item token 必须检测 source item 已被 remove。', 'missing key 是 contract failure，而非 optional state。', '自定义 split read/write 需要一致诊断。'],
      avoidWhen: ['缺失是预期状态；使用 findKeyIndex。', '需要校验 duplicate key。', '大型 list 上反复 lookup，应维护 index。'],
      options: [
        { name: 'items', description: '搜索 required key 的 readonly list。', defaultValue: '必填', optional: false, type: 'readonly T[]', whenToUse: '传入当前 source snapshot。', example: 'requireKeyIndex(items, keyOf, key, label)' },
        { name: 'keyOf', description: 'lookup 使用的 canonical selector。', defaultValue: '必填', optional: false, type: '(item: T, index: number) => Key', whenToUse: '匹配周围 split key domain。', example: '(todo) => todo.id' },
        { name: 'key', description: '必须仍存在的 required key。', defaultValue: '必填', optional: false, type: 'Key', whenToUse: '把稳定 item token 解析到最新 list。', example: 'id' },
        { name: 'label', description: '稳定 missing-item 诊断。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '解释 read/write target 是否已 remove。', example: "'todo was removed'" }
      ]
    }
  },
  'store-keyed:index:shallowArrayEquals': {
    en: {
      purpose: 'Compares two readonly arrays by length and Object.is at each index. It is the identity-preserving equality used for ordered split-definition token lists.',
      quickStart: 'const unchanged = shallowArrayEquals(previousDefs, nextDefs)',
      scenarios: ['Ordered token arrays should notify only when membership or order changes.', 'Element identity is the complete equality contract.', 'A small allocation-free shallow comparison is sufficient.'],
      avoidWhen: ['Elements require structural equality.', 'Array order should be ignored.', 'Sparse-array hole semantics must be distinguished from undefined.'],
      options: [
        { name: 'left', description: 'First readonly array.', defaultValue: 'required', optional: false, type: 'readonly T[]', whenToUse: 'Pass the previous ordered identity list.', example: 'shallowArrayEquals(previous, next)' },
        { name: 'right', description: 'Second readonly array compared index by index.', defaultValue: 'required', optional: false, type: 'readonly T[]', whenToUse: 'Pass the newly computed ordered identity list.', example: 'shallowArrayEquals(previous, next)' }
      ]
    },
    zh: {
      purpose: '按 length 与每个 index 的 Object.is 比较两个 readonly array；用于 ordered split-definition token list 的 identity-preserving equality。',
      quickStart: 'const unchanged = shallowArrayEquals(previousDefs, nextDefs)',
      scenarios: ['ordered token array 只在 membership 或 order 变化时通知。', 'element identity 就是完整 equality contract。', '小型 allocation-free shallow comparison 已足够。'],
      avoidWhen: ['element 需要 structural equality。', '应忽略 array order。', '必须区分 sparse hole 与 undefined。'],
      options: [
        { name: 'left', description: '第一份 readonly array。', defaultValue: '必填', optional: false, type: 'readonly T[]', whenToUse: '传入 previous ordered identity list。', example: 'shallowArrayEquals(previous, next)' },
        { name: 'right', description: '逐 index 比较的第二份 readonly array。', defaultValue: '必填', optional: false, type: 'readonly T[]', whenToUse: '传入新计算的 ordered identity list。', example: 'shallowArrayEquals(previous, next)' }
      ]
    }
  },
  'store-keyed:index:spliceInsert': {
    en: {
      purpose: 'Returns a frozen array with one item inserted at a clamped index. The source array is never mutated.',
      quickStart: 'const next = spliceInsert(todos, newTodo, requestedIndex)',
      scenarios: ['Custom split logic needs the same immutable insert transform.', 'Out-of-range indices should clamp to the nearest boundary.', 'The returned list should be frozen.'],
      avoidWhen: ['In-place mutation is required.', 'Invalid indices must be rejected rather than clamped.', 'A sorted insertion policy owns the position.'],
      options: [
        { name: 'list', description: 'Readonly source array copied before insertion.', defaultValue: 'required', optional: false, type: 'readonly T[]', whenToUse: 'Pass the current immutable list.', example: 'spliceInsert(list, item, index)' },
        { name: 'item', description: 'Value inserted into the copied array.', defaultValue: 'required', optional: false, type: 'T', whenToUse: 'Provide the new list member.', example: 'newTodo' },
        { name: 'index', description: 'Requested insertion index clamped to zero through list.length.', defaultValue: 'required', optional: false, type: 'number', whenToUse: 'Choose the desired visible position.', example: '2' }
      ]
    },
    zh: {
      purpose: '返回在 clamped index 插入一项的 frozen array；绝不 mutation source array。',
      quickStart: 'const next = spliceInsert(todos, newTodo, requestedIndex)',
      scenarios: ['自定义 split logic 需要同一 immutable insert transform。', '越界 index 应 clamp 到最近 boundary。', '返回 list 应 freeze。'],
      avoidWhen: ['要求 in-place mutation。', '非法 index 必须拒绝，而不是 clamp。', '位置由 sorted insertion policy 决定。'],
      options: [
        { name: 'list', description: '插入前复制的 readonly source array。', defaultValue: '必填', optional: false, type: 'readonly T[]', whenToUse: '传入当前 immutable list。', example: 'spliceInsert(list, item, index)' },
        { name: 'item', description: '插入 copied array 的 value。', defaultValue: '必填', optional: false, type: 'T', whenToUse: '提供新 list member。', example: 'newTodo' },
        { name: 'index', description: '会 clamp 到 0 至 list.length 的请求 insertion index。', defaultValue: '必填', optional: false, type: 'number', whenToUse: '选择期望 visible position。', example: '2' }
      ]
    }
  },
  'store-keyed:index:filterOutKey': {
    en: {
      purpose: 'Removes every item whose derived key is Object.is-equal to the target. When nothing matches it preserves the original array identity; otherwise it returns a frozen replacement.',
      quickStart: "const { removed, next } = filterOutKey(todos, (todo) => todo.id, 'todo-42')",
      scenarios: ['Custom split logic needs immutable removal plus an explicit changed flag.', 'No-op removal should retain source identity.', 'All duplicate matches must be removed defensively.'],
      avoidWhen: ['Only the first duplicate should be removed.', 'Missing keys must throw.', 'Repeated lookup and removal needs a keyed collection.'],
      options: [
        { name: 'list', description: 'Readonly source array filtered without mutation.', defaultValue: 'required', optional: false, type: 'readonly T[]', whenToUse: 'Pass the current immutable list.', example: 'filterOutKey(list, keyOf, key)' },
        { name: 'keyOf', description: 'Selector used to derive each item key.', defaultValue: 'required', optional: false, type: '(item: T, index: number) => Key', whenToUse: 'Match the surrounding keyed domain.', example: '(todo) => todo.id' },
        { name: 'key', description: 'Target key removed under Object.is equality.', defaultValue: 'required', optional: false, type: 'Key', whenToUse: 'Choose the member identity to remove.', example: "'todo-42'" }
      ]
    },
    zh: {
      purpose: '移除所有 derived key 与 target 满足 Object.is 的 item。无匹配时保留原 array identity；否则返回 frozen replacement。',
      quickStart: "const { removed, next } = filterOutKey(todos, (todo) => todo.id, 'todo-42')",
      scenarios: ['自定义 split logic 需要 immutable removal 与显式 changed flag。', 'no-op removal 应保留 source identity。', '防御性移除全部 duplicate match。'],
      avoidWhen: ['只应移除第一个 duplicate。', 'missing key 必须 throw。', '反复 lookup/removal 应使用 keyed collection。'],
      options: [
        { name: 'list', description: '不 mutation 地 filter 的 readonly source array。', defaultValue: '必填', optional: false, type: 'readonly T[]', whenToUse: '传入当前 immutable list。', example: 'filterOutKey(list, keyOf, key)' },
        { name: 'keyOf', description: '派生每个 item key 的 selector。', defaultValue: '必填', optional: false, type: '(item: T, index: number) => Key', whenToUse: '匹配周围 keyed domain。', example: '(todo) => todo.id' },
        { name: 'key', description: '按 Object.is equality 移除的 target key。', defaultValue: '必填', optional: false, type: 'Key', whenToUse: '选择要移除的 member identity。', example: "'todo-42'" }
      ]
    }
  },
  'store-keyed:index:replaceAtIndex': {
    en: {
      purpose: 'Returns a frozen shallow copy with one array slot replaced. It deliberately performs no bounds validation or equality shortcut.',
      quickStart: 'const next = replaceAtIndex(todos, index, updatedTodo)',
      scenarios: ['A caller already validated the index.', 'Custom split logic needs one immutable slot replacement.', 'The caller owns the no-op equality check.'],
      avoidWhen: ['The index is untrusted or may be out of range.', 'Sparse-array creation is unacceptable.', 'A deep clone or keyed lookup is expected.'],
      options: [
        { name: 'list', description: 'Readonly array shallow-copied before replacement.', defaultValue: 'required', optional: false, type: 'readonly T[]', whenToUse: 'Pass the validated source snapshot.', example: 'replaceAtIndex(list, index, value)' },
        { name: 'index', description: 'Already validated array slot to replace.', defaultValue: 'required', optional: false, type: 'number', whenToUse: 'Use the result of requireKeyIndex or equivalent validation.', example: 'index' },
        { name: 'value', description: 'Replacement item written into the copied array.', defaultValue: 'required', optional: false, type: 'T', whenToUse: 'Provide the computed next item.', example: 'updatedTodo' }
      ]
    },
    zh: {
      purpose: '返回替换一个 array slot 的 frozen shallow copy；刻意不做 bounds validation 或 equality shortcut。',
      quickStart: 'const next = replaceAtIndex(todos, index, updatedTodo)',
      scenarios: ['caller 已校验 index。', '自定义 split logic 需要单 slot immutable replacement。', 'caller 自己拥有 no-op equality check。'],
      avoidWhen: ['index 不可信或可能越界。', '不能接受 sparse-array creation。', '期望 deep clone 或 keyed lookup。'],
      options: [
        { name: 'list', description: 'replacement 前 shallow copy 的 readonly array。', defaultValue: '必填', optional: false, type: 'readonly T[]', whenToUse: '传入已校验 source snapshot。', example: 'replaceAtIndex(list, index, value)' },
        { name: 'index', description: '已经校验的待替换 array slot。', defaultValue: '必填', optional: false, type: 'number', whenToUse: '使用 requireKeyIndex 或等价 validation 结果。', example: 'index' },
        { name: 'value', description: '写入 copied array 的 replacement item。', defaultValue: '必填', optional: false, type: 'T', whenToUse: '提供计算好的 next item。', example: 'updatedTodo' }
      ]
    }
  },
  'store-keyed:index:KeyedSplitCache': {
    en: {
      purpose: 'Owns a stable key-to-item token cache shared by split kernels. of performs get-or-create; prune separates liveness, eviction eligibility, and per-item cleanup; clear only drops cache references.',
      quickStart: "const cache = new KeyedSplitCache<string, ItemDef>()\nconst item = cache.of(id, () => createItemDef(id))\ncache.prune(isLive, isUnobserved, (entry) => entry.dispose())",
      scenarios: ['A custom keyed split needs stable item identity.', 'Eviction must skip observed items and optionally dispose evicted instances.', 'Cache keys and values need explicit inspection and clearing.'],
      avoidWhen: ['Weak canonical identity or an automatic capacity bound is required.', 'clear is expected to dispose items.', 'The key domain is tiny and no stable token cache is needed.'],
      options: [
        { name: 'of key/create', description: 'Key and lazy creator used for stable get-or-create identity.', defaultValue: 'required', optional: false, type: 'Key, () => Item', whenToUse: 'Resolve one split member token.', example: 'cache.of(id, () => createItemDef(id))' },
        { name: 'prune isLive', description: 'Predicate deciding whether a cached key still belongs to the source domain.', defaultValue: 'required', optional: false, type: '(key: Key) => boolean', whenToUse: 'Identify stale cache entries from the latest source snapshot.', example: '(key) => liveKeys.has(key)' },
        { name: 'prune shouldEvict', description: 'Optional per-item gate that can preserve observed or leased entries.', defaultValue: '() => true', type: '(item: Item) => boolean', whenToUse: 'Prevent eviction while an item remains externally active.', example: '(item) => !item.observed' },
        { name: 'prune onEvict', description: 'Optional cleanup invoked immediately before deletion.', defaultValue: 'undefined', type: '(item: Item) => void', whenToUse: 'Dispose instance-style atoms while definition tokens need no cleanup.', example: '(item) => item.dispose()' }
      ]
    },
    zh: {
      purpose: '拥有 split kernel 共用的稳定 key-to-item token cache。of 执行 get-or-create；prune 分离 liveness、eviction eligibility 与 per-item cleanup；clear 只丢 cache reference。',
      quickStart: "const cache = new KeyedSplitCache<string, ItemDef>()\nconst item = cache.of(id, () => createItemDef(id))\ncache.prune(isLive, isUnobserved, (entry) => entry.dispose())",
      scenarios: ['自定义 keyed split 需要稳定 item identity。', 'eviction 必须跳过 observed item，并可选择 dispose 被淘汰 instance。', '需要显式检查与清理 cache key/value。'],
      avoidWhen: ['需要 weak canonical identity 或自动 capacity bound。', '期望 clear 会 dispose item。', 'key domain 很小，不需要稳定 token cache。'],
      options: [
        { name: 'of key/create', description: '用于稳定 get-or-create identity 的 key 与 lazy creator。', defaultValue: '必填', optional: false, type: 'Key, () => Item', whenToUse: '解析一个 split member token。', example: 'cache.of(id, () => createItemDef(id))' },
        { name: 'prune isLive', description: '判断 cached key 是否仍属于 source domain 的 predicate。', defaultValue: '必填', optional: false, type: '(key: Key) => boolean', whenToUse: '从最新 source snapshot 标识 stale cache entry。', example: '(key) => liveKeys.has(key)' },
        { name: 'prune shouldEvict', description: '可保留 observed 或 leased entry 的可选 per-item gate。', defaultValue: '() => true', type: '(item: Item) => boolean', whenToUse: 'item 仍在外部 active 时阻止 eviction。', example: '(item) => !item.observed' },
        { name: 'prune onEvict', description: '删除前立即调用的可选 cleanup。', defaultValue: 'undefined', type: '(item: Item) => void', whenToUse: 'instance-style atom 需要 dispose，而 definition token 无需 cleanup。', example: '(item) => item.dispose()' }
      ]
    }
  },
  'store-keyed:index:AtomKind': {
    en: {
      purpose: 'Names the four atom-definition categories used by Store Keyed to decide initialization, dependency tracking, and whether writes are legal. Most applications inspect it only in tooling or definition transforms; constructors assign it for you.',
      quickStart: "if (definition.kind === AtomKind.writableDerived) {\n  // This definition accepts writes through its declared setter.\n}",
      scenarios: ['Developer tooling needs to classify an atom definition.', 'A definition transform must preserve primitive versus derived write semantics.', 'A diagnostic needs a stable runtime discriminator rather than constructor identity.'],
      avoidWhen: ['Creating a definition; call atomDef, atomDefFactory, derivedDef, or writableDef instead.', 'Checking whether an unknown value is a definition; use isAtomDefinition.', 'Persisting the value as a versioned wire protocol without an explicit compatibility contract.'],
      options: []
    },
    zh: {
      purpose: '命名 Store Keyed 用于决定 initialization、dependency tracking 与是否允许 write 的四种 atom-definition category。多数 application 只会在 tooling 或 definition transform 中检查它；constructor 会自动赋值。',
      quickStart: "if (definition.kind === AtomKind.writableDerived) {\n  // 该 definition 可通过声明的 setter 接受 write。\n}",
      scenarios: ['developer tooling 需要分类 atom definition。', 'definition transform 必须保留 primitive 与 derived write semantics。', 'diagnostic 需要稳定 runtime discriminator，而不是 constructor identity。'],
      avoidWhen: ['正在创建 definition；改用 atomDef、atomDefFactory、derivedDef 或 writableDef。', '检查 unknown value 是否为 definition；使用 isAtomDefinition。', '没有显式 compatibility contract，却要把该值持久化为 versioned wire protocol。'],
      options: []
    }
  },
  'store-keyed:index:STORE_KEYED_SOURCE': {
    en: {
      purpose: 'Exposes the canonical source discriminator attached to every Store Keyed boundary error. Compare it together with error.code when routing diagnostics; it is not an error message or a general library identifier.',
      quickStart: "if (error.source === STORE_KEYED_SOURCE) {\n  reportStoreKeyedFailure(error.code, error)\n}",
      scenarios: ['A shared error reporter routes failures by library ownership.', 'Telemetry groups Store Keyed failures without parsing messages.', 'A boundary guard first narrows source, then branches on the semantic code.'],
      avoidWhen: ['Displaying a user-facing error message.', 'Inferring the concrete native error class; use instanceof.', 'Using source alone as the semantic failure reason; inspect code as well.'],
      options: []
    },
    zh: {
      purpose: '暴露附加在每个 Store Keyed boundary error 上的 canonical source discriminator。路由 diagnostic 时应与 error.code 一起比较；它不是 error message，也不是通用 library identifier。',
      quickStart: "if (error.source === STORE_KEYED_SOURCE) {\n  reportStoreKeyedFailure(error.code, error)\n}",
      scenarios: ['shared error reporter 按 library ownership 路由 failure。', 'telemetry 不解析 message，直接聚合 Store Keyed failure。', 'boundary guard 先缩小 source，再按 semantic code 分支。'],
      avoidWhen: ['展示 user-facing error message。', '推断具体 native error class；使用 instanceof。', '只用 source 作为 semantic failure reason；还应检查 code。'],
      options: []
    }
  },
  'store-keyed:index:createStoreKeyedError': {
    en: {
      purpose: 'Creates the Store Keyed standard Error while preserving the native error instance and stack, then attaches the stable @migaia/store-keyed source and semantic code. Use it at a Store Keyed boundary, not as a general application error factory.',
      quickStart: "throw createStoreKeyedError(\n  StoreKeyedErrorCode.invalidOption,\n  StoreKeyedErrorText.invalidOption('cacheSize'),\n  { cause: inputError }\n)",
      scenarios: ['A Store Keyed invariant fails without requiring a more specific native error class.', 'Callers need to branch on the stable source/code pair.', 'An underlying failure must remain reachable through cause.'],
      avoidWhen: ['Invalid input specifically requires TypeError or RangeError.', 'Several cleanup failures must remain individually reachable; use createStoreKeyedAggregateError.', 'The error belongs to an application or another library boundary.'],
      options: [
        { name: 'code', description: 'Registered Store Keyed semantic code attached to the same Error instance.', defaultValue: 'required', optional: false, type: 'IStoreKeyedErrorCode', whenToUse: 'Choose the code matching the exact Store Keyed contract failure.', example: 'StoreKeyedErrorCode.invalidOption' },
        { name: 'message', description: 'Human-readable text produced by the library-owned error text factory.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Explain the failure without inventing a new code or inline contract string.', example: "StoreKeyedErrorText.invalidOption('cacheSize')" },
        { name: 'options.cause', description: 'Optional original failure retained by native Error cause identity.', defaultValue: 'undefined', type: 'unknown', whenToUse: 'Wrap a lower-level error while keeping it inspectable and traceable.', example: '{ cause: inputError }' }
      ]
    },
    zh: {
      purpose: '创建 Store Keyed 标准 Error，保留 native error instance 与 stack，再附加稳定的 @migaia/store-keyed source 和 semantic code。它属于 Store Keyed boundary，不是通用 application error factory。',
      quickStart: "throw createStoreKeyedError(\n  StoreKeyedErrorCode.invalidOption,\n  StoreKeyedErrorText.invalidOption('cacheSize'),\n  { cause: inputError }\n)",
      scenarios: ['Store Keyed invariant 失败，但不需要更具体的 native error class。', 'caller 需要按稳定 source/code pair 分支。', '底层 failure 必须通过 cause 保持可达。'],
      avoidWhen: ['非法输入明确要求 TypeError 或 RangeError。', '多个 cleanup failure 必须分别可达；使用 createStoreKeyedAggregateError。', '错误属于 application 或其他 library boundary。'],
      options: [
        { name: 'code', description: '附加到同一个 Error instance 的已登记 Store Keyed semantic code。', defaultValue: '必填', optional: false, type: 'IStoreKeyedErrorCode', whenToUse: '选择与准确 Store Keyed contract failure 对应的 code。', example: 'StoreKeyedErrorCode.invalidOption' },
        { name: 'message', description: '由 library-owned error text factory 生成的人类可读文本。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '解释 failure，不另造 code 或 inline contract string。', example: "StoreKeyedErrorText.invalidOption('cacheSize')" },
        { name: 'options.cause', description: '通过 native Error cause 保留 identity 的可选原始 failure。', defaultValue: 'undefined', type: 'unknown', whenToUse: '包装 lower-level error，同时保持可检查与可追踪。', example: '{ cause: inputError }' }
      ]
    }
  },
  'store-keyed:index:createStoreKeyedRangeError': {
    en: {
      purpose: 'Creates a tagged native RangeError for numeric values that fall outside a Store Keyed contract. It preserves instanceof RangeError, stack, source/code identity, and an optional cause.',
      quickStart: "throw createStoreKeyedRangeError(\n  StoreKeyedErrorCode.invalidOption,\n  StoreKeyedErrorText.invalidCapacity(capacity)\n)",
      scenarios: ['A cache capacity or numeric bound is outside its accepted range.', 'Consumers distinguish range failures with instanceof RangeError.', 'The failure still needs the library source and semantic code.'],
      avoidWhen: ['The value has the wrong kind rather than the wrong range.', 'A generic Store Keyed invariant failed.', 'Several errors need aggregation.'],
      options: [
        { name: 'code', description: 'Registered semantic code attached without replacing the RangeError.', defaultValue: 'required', optional: false, type: 'IStoreKeyedErrorCode', whenToUse: 'Identify the violated numeric contract.', example: 'StoreKeyedErrorCode.invalidOption' },
        { name: 'message', description: 'Library-owned explanation of the rejected range.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Include the relevant option or bound through the canonical text factory.', example: 'StoreKeyedErrorText.invalidCapacity(capacity)' },
        { name: 'options.cause', description: 'Optional original failure retained through native cause.', defaultValue: 'undefined', type: 'unknown', whenToUse: 'Expose the lower-level reason for a derived range failure.', example: '{ cause: validationError }' }
      ]
    },
    zh: {
      purpose: '为超出 Store Keyed contract 的 numeric value 创建带标识的 native RangeError；保留 instanceof RangeError、stack、source/code identity 与可选 cause。',
      quickStart: "throw createStoreKeyedRangeError(\n  StoreKeyedErrorCode.invalidOption,\n  StoreKeyedErrorText.invalidCapacity(capacity)\n)",
      scenarios: ['cache capacity 或 numeric bound 超出允许范围。', 'consumer 通过 instanceof RangeError 区分 range failure。', 'failure 仍需要 library source 与 semantic code。'],
      avoidWhen: ['value 是类型错误而不是范围错误。', '失败的是 generic Store Keyed invariant。', '需要聚合多个 error。'],
      options: [
        { name: 'code', description: '不替换 RangeError、直接附加的已登记 semantic code。', defaultValue: '必填', optional: false, type: 'IStoreKeyedErrorCode', whenToUse: '标识被违反的 numeric contract。', example: 'StoreKeyedErrorCode.invalidOption' },
        { name: 'message', description: '由 library-owned text 描述被拒绝的 range。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '通过 canonical text factory 带上相关 option 或 bound。', example: 'StoreKeyedErrorText.invalidCapacity(capacity)' },
        { name: 'options.cause', description: '通过 native cause 保留的可选原始 failure。', defaultValue: 'undefined', type: 'unknown', whenToUse: '暴露 derived range failure 的 lower-level reason。', example: '{ cause: validationError }' }
      ]
    }
  },
  'store-keyed:index:createStoreKeyedTypeError': {
    en: {
      purpose: 'Creates a tagged native TypeError for malformed definitions, paths, options, or cross-runtime inputs. Native type, stack, semantic identity, and optional cause are preserved.',
      quickStart: "throw createStoreKeyedTypeError(\n  StoreKeyedErrorCode.invalidDefinition,\n  StoreKeyedErrorText.invalidDefinition('todo')\n)",
      scenarios: ['A value does not satisfy the required atom-definition protocol.', 'An optic path or option has an invalid shape.', 'Consumers need both instanceof TypeError and stable library diagnostics.'],
      avoidWhen: ['The type is valid but a numeric bound is invalid.', 'The failure is an operational invariant rather than malformed input.', 'Multiple independent failures must be reported together.'],
      options: [
        { name: 'code', description: 'Registered semantic code attached to the native TypeError.', defaultValue: 'required', optional: false, type: 'IStoreKeyedErrorCode', whenToUse: 'Select the malformed-input contract that failed.', example: 'StoreKeyedErrorCode.invalidDefinition' },
        { name: 'message', description: 'Canonical Store Keyed text describing the invalid value or shape.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Give the caller actionable context while preserving message ownership.', example: "StoreKeyedErrorText.invalidDefinition('todo')" },
        { name: 'options.cause', description: 'Optional prior failure kept reachable through cause.', defaultValue: 'undefined', type: 'unknown', whenToUse: 'Retain validation or decoding failure identity.', example: '{ cause: decodeError }' }
      ]
    },
    zh: {
      purpose: '为 malformed definition、path、option 或 cross-runtime input 创建带标识的 native TypeError；保留 native type、stack、semantic identity 与可选 cause。',
      quickStart: "throw createStoreKeyedTypeError(\n  StoreKeyedErrorCode.invalidDefinition,\n  StoreKeyedErrorText.invalidDefinition('todo')\n)",
      scenarios: ['value 不满足要求的 atom-definition protocol。', 'optic path 或 option shape 非法。', 'consumer 同时需要 instanceof TypeError 与稳定 library diagnostics。'],
      avoidWhen: ['类型正确但 numeric bound 非法。', '失败属于 operational invariant，而非 malformed input。', '多个独立 failure 必须一起 report。'],
      options: [
        { name: 'code', description: '附加到 native TypeError 的已登记 semantic code。', defaultValue: '必填', optional: false, type: 'IStoreKeyedErrorCode', whenToUse: '选择失败的 malformed-input contract。', example: 'StoreKeyedErrorCode.invalidDefinition' },
        { name: 'message', description: '描述 invalid value 或 shape 的 canonical Store Keyed text。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '在保持 message ownership 的同时给 caller 可行动上下文。', example: "StoreKeyedErrorText.invalidDefinition('todo')" },
        { name: 'options.cause', description: '通过 cause 保持可达的可选先前 failure。', defaultValue: 'undefined', type: 'unknown', whenToUse: '保留 validation 或 decoding failure identity。', example: '{ cause: decodeError }' }
      ]
    }
  },
  'store-keyed:index:createStoreKeyedAggregateError': {
    en: {
      purpose: 'Creates a tagged native AggregateError without flattening or replacing its errors array. Use it when one Store Keyed operation completes containment work but must report several failures together.',
      quickStart: "throw createStoreKeyedAggregateError(\n  StoreKeyedErrorCode.cleanupFailed,\n  cleanupErrors,\n  StoreKeyedErrorText.cleanupFailed(cleanupErrors.length)\n)",
      scenarios: ['Several subscriber or cleanup failures occur in one bounded operation.', 'Every original error must remain reachable through AggregateError.errors.', 'Consumers need one library-coded failure plus the complete failure set.'],
      avoidWhen: ['There is only one primary failure with one causal chain.', 'Failures should be reported independently and execution can continue.', 'The error list is being used as ordinary validation data.'],
      options: [
        { name: 'code', description: 'Registered semantic code attached to the AggregateError instance.', defaultValue: 'required', optional: false, type: 'IStoreKeyedErrorCode', whenToUse: 'Identify the multi-failure operation contract.', example: 'StoreKeyedErrorCode.cleanupFailed' },
        { name: 'errors', description: 'Original failures retained in order by AggregateError.errors.', defaultValue: 'required', optional: false, type: 'unknown[]', whenToUse: 'Pass every independently captured failure without replacing or stringifying it.', example: 'cleanupErrors' },
        { name: 'message', description: 'Library-owned summary for the aggregate operation failure.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Summarize the operation while details remain in errors.', example: 'StoreKeyedErrorText.cleanupFailed(cleanupErrors.length)' }
      ]
    },
    zh: {
      purpose: '创建带标识的 native AggregateError，不 flatten 或替换 errors array。用于一次 Store Keyed operation 完成 containment 后，需要统一报告多个 failure。',
      quickStart: "throw createStoreKeyedAggregateError(\n  StoreKeyedErrorCode.cleanupFailed,\n  cleanupErrors,\n  StoreKeyedErrorText.cleanupFailed(cleanupErrors.length)\n)",
      scenarios: ['一次 bounded operation 中出现多个 subscriber 或 cleanup failure。', '每个原始 error 都必须通过 AggregateError.errors 保持可达。', 'consumer 需要一个 library-coded failure 与完整 failure set。'],
      avoidWhen: ['只有一个 primary failure 与一条 cause chain。', 'failure 应分别 report 且 execution 可以继续。', 'error list 只是 ordinary validation data。'],
      options: [
        { name: 'code', description: '附加到 AggregateError instance 的已登记 semantic code。', defaultValue: '必填', optional: false, type: 'IStoreKeyedErrorCode', whenToUse: '标识 multi-failure operation contract。', example: 'StoreKeyedErrorCode.cleanupFailed' },
        { name: 'errors', description: '由 AggregateError.errors 按顺序保留的原始 failure。', defaultValue: '必填', optional: false, type: 'unknown[]', whenToUse: '传入每个独立捕获的 failure，不替换或 stringify。', example: 'cleanupErrors' },
        { name: 'message', description: 'aggregate operation failure 的 library-owned summary。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '概括 operation，具体细节仍留在 errors 中。', example: 'StoreKeyedErrorText.cleanupFailed(cleanupErrors.length)' }
      ]
    }
  },
  'store-light:index:createStore': {
    en: {
      purpose: 'Synchronously creates an object-state facade: ordinary values become Signals, getters become lazy Computed values, methods become traced batched Actions, and only synchronous FieldBuilders are admitted.',
      quickStart: "const counter = createStore({\n  count: 0,\n  get doubled() { return this.count * 2 },\n  increment() { this.count += 1 }\n}, { debugName: 'counter' })\n\ntry {\n  counter.increment()\n} finally {\n  await counter.$dispose()\n}",
      scenarios: ['A small object domain needs automatic reactive fields and derived getters.', 'Construction must complete synchronously without hidden I/O.', 'Methods should share Runtime tracing, batching, and optional strict mutation policy.'],
      avoidWhen: ['The shape contains an asynchronous or legacy FieldBuilder; use createAsyncStore.', 'The domain is a hot mutable collection requiring indexed or keyed storage.', 'The owner cannot await $dispose at its lifecycle boundary.'],
      options: storeLightCreationOptions.en
    },
    zh: {
      purpose: '同步创建 object-state facade：普通值变 Signal、getter 变惰性 Computed、method 变带 trace 的 batch Action，并且只接纳同步 FieldBuilder。',
      quickStart: "const counter = createStore({\n  count: 0,\n  get doubled() { return this.count * 2 },\n  increment() { this.count += 1 }\n}, { debugName: 'counter' })\n\ntry {\n  counter.increment()\n} finally {\n  await counter.$dispose()\n}",
      scenarios: ['小型对象领域需要自动 reactive field 与派生 getter。', '构造必须同步完成，不能隐藏 I/O。', 'method 需要共享 Runtime trace、batch 与可选严格 mutation policy。'],
      avoidWhen: ['shape 包含 async 或 legacy FieldBuilder；应使用 createAsyncStore。', '领域是需要 indexed/keyed storage 的高频可变集合。', 'owner 无法在 lifecycle boundary await $dispose。'],
      options: storeLightCreationOptions.zh
    }
  },
  'store-light:index:createStoreSync': {
    en: {
      purpose: 'Explicit naming alias for createStore. It has the same synchronous-field admission, Store facade, ownership, errors, and disposal contract; it does not create a second implementation path.',
      quickStart: "const settings = createStoreSync({ theme: 'system' })\ntry {\n  settings.theme = 'dark'\n} finally {\n  await settings.$dispose()\n}",
      scenarios: ['An API surface benefits from spelling the synchronous creation mode.', 'Code is paired visually with createAsyncStore.', 'The shape contains only ordinary fields and synchronous FieldBuilders.'],
      avoidWhen: ['Different behavior from createStore is expected.', 'An asynchronous FieldBuilder exists.', 'The alias would be wrapped again as a compatibility facade.'],
      options: storeLightCreationOptions.en
    },
    zh: {
      purpose: 'createStore 的显式命名 alias；同步 field admission、Store facade、ownership、error 与 disposal 契约完全相同，不存在第二条实现路径。',
      quickStart: "const settings = createStoreSync({ theme: 'system' })\ntry {\n  settings.theme = 'dark'\n} finally {\n  await settings.$dispose()\n}",
      scenarios: ['API surface 需要显式写出同步创建模式。', '代码需要与 createAsyncStore 形成视觉配对。', 'shape 只包含普通 field 与同步 FieldBuilder。'],
      avoidWhen: ['期望与 createStore 不同的行为。', '存在 async FieldBuilder。', '准备把 alias 再包装成 compatibility facade。'],
      options: storeLightCreationOptions.zh
    }
  },
  'store-light:index:createAsyncStore': {
    en: {
      purpose: 'Creates a Store that may contain asynchronous FieldBuilders and resolves only after every field is ready. Initialization failure disposes already-created fields instead of exposing a half-ready Store.',
      quickStart: "const profile = await createAsyncStore({\n  cache: asyncFieldBuilder(),\n  selectedId: null\n}, { runtime, debugName: 'profile' })\n\ntry {\n  profile.cache.read()\n} finally {\n  await profile.$dispose()\n}",
      scenarios: ['One or more custom fields require asynchronous initialization.', 'Consumers must receive either a fully ready Store or a rejection.', 'Initialization rollback must release fields created before a later failure.'],
      avoidWhen: ['All fields are synchronous; createStore keeps the boundary synchronous.', 'A half-ready compatibility object is required during migration.', 'Async application data loading is being confused with FieldBuilder construction; use StoreResource for data.'],
      options: storeLightCreationOptions.en
    },
    zh: {
      purpose: '创建允许 async FieldBuilder 的 Store，并在全部 field ready 后才 resolve。初始化失败会 dispose 已创建 field，不会暴露 half-ready Store。',
      quickStart: "const profile = await createAsyncStore({\n  cache: asyncFieldBuilder(),\n  selectedId: null\n}, { runtime, debugName: 'profile' })\n\ntry {\n  profile.cache.read()\n} finally {\n  await profile.$dispose()\n}",
      scenarios: ['一个或多个自定义 field 需要异步初始化。', 'consumer 必须只收到 fully ready Store 或 rejection。', '初始化 rollback 必须释放后续失败前已创建的 field。'],
      avoidWhen: ['全部 field 都同步；createStore 可保持同步 boundary。', '迁移期间确实需要 half-ready compatibility object。', '把应用数据异步加载误当 FieldBuilder 构造；数据应使用 StoreResource。'],
      options: storeLightCreationOptions.zh
    }
  },
  'store-light:index:createLegacyStore': {
    en: {
      purpose: 'Migration-only facade that may return before legacy or asynchronous FieldBuilders are ready. New code should select createStore or createAsyncStore so readiness is explicit at construction.',
      quickStart: "const legacy = createLegacyStore(oldShape)\ntry {\n  if (legacy.$async) await storeReady(legacy)\n  useReadyStore(legacy)\n} finally {\n  await legacy.$dispose()\n}",
      scenarios: ['Existing code relies on synchronous object identity before async fields settle.', 'A bounded migration cannot switch every consumer to await construction at once.', 'storeReady is already the established readiness bridge.'],
      avoidWhen: ['Writing new code.', 'A consumer might access asynchronous fields before storeReady resolves.', 'The compatibility path has no documented removal condition.'],
      options: storeLightCreationOptions.en
    },
    zh: {
      purpose: '仅用于迁移的 facade，可能在 legacy/async FieldBuilder ready 前返回。新代码应选择 createStore 或 createAsyncStore，在构造边界显式处理 readiness。',
      quickStart: "const legacy = createLegacyStore(oldShape)\ntry {\n  if (legacy.$async) await storeReady(legacy)\n  useReadyStore(legacy)\n} finally {\n  await legacy.$dispose()\n}",
      scenarios: ['既有代码依赖 async field settle 前就得到同步 object identity。', '有界迁移无法一次把全部 consumer 改为 await construction。', 'storeReady 已是既有 readiness bridge。'],
      avoidWhen: ['编写新代码。', 'consumer 可能在 storeReady resolve 前访问 async field。', 'compatibility path 没有明确 removal condition。'],
      options: storeLightCreationOptions.zh
    }
  },
  'store-light:index:storeReady': {
    en: {
      purpose: 'Returns the initialization Promise registered for a Store created by Store Light. It exists for React integration and legacy migration, not as the preferred construction model.',
      quickStart: "const store = createLegacyStore(shape)\nif (store.$async) await storeReady(store)",
      scenarios: ['A legacy Store was returned before async fields settled.', 'An adapter must suspend on the exact Store initialization generation.', 'Migration tests need the internal readiness bridge.'],
      avoidWhen: ['createAsyncStore can make readiness explicit.', 'The object was not created by Store Light.', 'The Store is synchronous; there is no async initialization Promise to await.'],
      options: [{ name: 'store', description: 'Store Light object whose registered initialization Promise is requested.', defaultValue: 'required', optional: false, type: 'object', whenToUse: 'Pass the exact Store returned by a legacy creation path.', example: 'await storeReady(store)' }]
    },
    zh: {
      purpose: '返回 Store Light 为某个 Store 登记的 initialization Promise。它服务于 React adapter 与 legacy migration，不是推荐的构造模型。',
      quickStart: "const store = createLegacyStore(shape)\nif (store.$async) await storeReady(store)",
      scenarios: ['legacy Store 在 async field settle 前已返回。', 'adapter 必须 suspend 在准确 Store initialization generation 上。', '迁移测试需要内部 readiness bridge。'],
      avoidWhen: ['可以用 createAsyncStore 显式处理 readiness。', '对象不是由 Store Light 创建。', 'Store 为同步定义，没有 async initialization Promise。'],
      options: [{ name: 'store', description: '需要读取已登记 initialization Promise 的 Store Light object。', defaultValue: '必填', optional: false, type: 'object', whenToUse: '传入 legacy creation path 返回的准确 Store。', example: 'await storeReady(store)' }]
    }
  },
  'store-light:index:raw': {
    en: {
      purpose: 'Brands one value as an ordinary writable Store field so a function value is not interpreted as an Action method.',
      quickStart: "const form = createStore({\n  onSubmit: raw((value: FormData) => save(value))\n})\nform.onSubmit = nextHandler",
      scenarios: ['A callback must be stored and replaced as state.', 'A function value must not receive Action wrapping or Store this binding.', 'A framework prop-like function belongs in the object facade.'],
      avoidWhen: ['The function is a Store method that mutates fields.', 'The value should be a getter or custom FieldBuilder.', 'Brand inspection alone is needed; use isRaw.'],
      options: [{ name: 'value', description: 'Value preserved as one ordinary writable field, including function values.', defaultValue: 'required', optional: false, type: 'T', whenToUse: 'Wrap function-valued state that is not a Store Action.', example: 'raw(onSubmit)' }]
    },
    zh: {
      purpose: '把一个值标记为普通可写 Store field，使 function value 不会被解释为 Action method。',
      quickStart: "const form = createStore({\n  onSubmit: raw((value: FormData) => save(value))\n})\nform.onSubmit = nextHandler",
      scenarios: ['callback 必须作为 state 存储并替换。', 'function value 不能被 Action wrapping 或绑定 Store this。', '类似 framework prop 的 function 属于 object facade。'],
      avoidWhen: ['function 是会 mutation field 的 Store method。', '值应是 getter 或自定义 FieldBuilder。', '只需要检查 brand；使用 isRaw。'],
      options: [{ name: 'value', description: '保持为一个普通可写 field 的值，包括 function value。', defaultValue: '必填', optional: false, type: 'T', whenToUse: '包装不属于 Store Action 的 function-valued state。', example: 'raw(onSubmit)' }]
    }
  },
  'store-light:index:isRaw': {
    en: {
      purpose: 'Type guard for the private raw-value brand used by Store definition processing.',
      quickStart: "if (isRaw(candidate)) {\n  console.log(candidate.value)\n}",
      scenarios: ['A Store adapter inspects definition entries before construction.', 'A tooling layer distinguishes raw callbacks from Action methods.', 'Unknown input needs the canonical brand check.'],
      avoidWhen: ['A Store is already constructed and exposes the unwrapped value.', 'Structural function detection is sufficient.', 'The caller intends to create the brand; use raw.'],
      options: [{ name: 'value', description: 'Unknown candidate tested for the canonical raw brand.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Inspect untrusted or generic Store definition entries.', example: 'isRaw(candidate)' }]
    },
    zh: {
      purpose: '检查 Store definition processing 所用私有 raw-value brand 的类型守卫。',
      quickStart: "if (isRaw(candidate)) {\n  console.log(candidate.value)\n}",
      scenarios: ['Store adapter 在构造前检查 definition entry。', 'tooling layer 区分 raw callback 与 Action method。', 'unknown input 需要 canonical brand check。'],
      avoidWhen: ['Store 已构造并暴露 unwrapped value。', '结构化 function detection 已足够。', '调用方准备创建 brand；使用 raw。'],
      options: [{ name: 'value', description: '用于 canonical raw brand 检查的 unknown candidate。', defaultValue: '必填', optional: false, type: 'unknown', whenToUse: '检查不可信或 generic Store definition entry。', example: 'isRaw(candidate)' }]
    }
  },
  'store-light:index:isFieldBuilder': {
    en: {
      purpose: 'Type guard for the canonical FIELD_BUILDER brand. It distinguishes custom owned fields from ordinary objects before Store construction.',
      quickStart: "if (isFieldBuilder(candidate)) {\n  console.log(candidate.mode)\n}",
      scenarios: ['A custom Store adapter validates field definitions.', 'Tooling reports synchronous versus asynchronous builder modes.', 'Unknown definition input must use the canonical identity check.'],
      avoidWhen: ['The field has already been constructed.', 'Duck typing on a create method is being attempted; that accepts false positives.', 'The caller needs to implement a builder rather than inspect one.'],
      options: [{ name: 'value', description: 'Unknown candidate tested for the FIELD_BUILDER identity brand.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Inspect generic Store definitions without invoking builder accessors.', example: 'isFieldBuilder(candidate)' }]
    },
    zh: {
      purpose: '检查 canonical FIELD_BUILDER brand 的类型守卫，在 Store 构造前区分自定义 owned field 与普通 object。',
      quickStart: "if (isFieldBuilder(candidate)) {\n  console.log(candidate.mode)\n}",
      scenarios: ['自定义 Store adapter 校验 field definition。', 'tooling 报告 sync/async builder mode。', 'unknown definition input 必须使用 canonical identity check。'],
      avoidWhen: ['field 已经完成构造。', '准备对 create method 做 duck typing；这会接受 false positive。', '调用方需要实现 builder，而不是检查 builder。'],
      options: [{ name: 'value', description: '用于 FIELD_BUILDER identity brand 检查的 unknown candidate。', defaultValue: '必填', optional: false, type: 'unknown', whenToUse: '不执行 builder accessor 地检查 generic Store definition。', example: 'isFieldBuilder(candidate)' }]
    }
  },
  'store-light:index:createStoreResource': {
    en: {
      purpose: 'Creates a Suspense-safe asynchronous value with abortable generations, stale-value retry, explicit resource and version leases, bounded cache retention, and deterministic terminal cleanup.',
      quickStart: "const user = createStoreResource(({ signal }) => fetchUser(signal), {\n  keepAliveMs: 5_000,\n  onError: report\n})\nuser.preload()\n\ntry {\n  const value = user.read() // throws the pending Promise for Suspense\n} finally {\n  user.dispose()\n  await user.whenTerminal()\n}",
      scenarios: ['UI or SSR code needs a readable async value with Suspense semantics.', 'A retry must keep the previous ready value until a new generation succeeds.', 'Rendered versions need leases so cleanup cannot race a committed view.'],
      avoidWhen: ['A one-shot Promise with no caching or ownership is sufficient.', 'The loaded primitive needs a custom disposer; disposable values must have reference identity.', 'The owner will neither dispose the Resource nor place it in a Resource scope.'],
      options: storeLightResourceOptions.en
    },
    zh: {
      purpose: '创建 Suspense-safe async value，提供可 abort generation、stale-value retry、显式 resource/version lease、有界 cache retention 与确定性终态 cleanup。',
      quickStart: "const user = createStoreResource(({ signal }) => fetchUser(signal), {\n  keepAliveMs: 5_000,\n  onError: report\n})\nuser.preload()\n\ntry {\n  const value = user.read() // 为 Suspense throw pending Promise\n} finally {\n  user.dispose()\n  await user.whenTerminal()\n}",
      scenarios: ['UI 或 SSR 代码需要带 Suspense 语义的 readable async value。', 'retry 必须保留 previous ready value，直到新 generation 成功。', 'rendered version 需要 lease，避免 cleanup 与 committed view 竞态。'],
      avoidWhen: ['一次性 Promise 已足够，不需要 cache 或 ownership。', '加载 primitive 却需要 custom disposer；disposable value 必须有 reference identity。', 'owner 既不 dispose Resource，也不把它放入 Resource scope。'],
      options: storeLightResourceOptions.zh
    }
  },
  'store-light:index:createStoreResourceScope': {
    en: {
      purpose: 'Creates a group owner for Store Resources. resource delegates to createStoreResource, while scope disposal force-disposes every still-live member and removes naturally terminal members.',
      quickStart: "const scope = createStoreResourceScope()\nconst user = scope.resource(({ signal }) => fetchUser(signal))\nconst settings = scope.resource(({ signal }) => fetchSettings(signal))\n\ntry {\n  user.preload()\n  settings.preload()\n} finally {\n  scope.dispose()\n}",
      scenarios: ['A component, route, or request owns several Resources together.', 'Group shutdown must ignore lingering leases because the whole owner is ending.', 'Naturally terminal Resources should leave the private ownership set.'],
      avoidWhen: ['Each Resource has a different lifetime owner.', 'Graceful per-Resource closing must wait for leases; scope disposal intentionally force-disposes.', 'The scope itself cannot be disposed.'],
      options: []
    },
    zh: {
      purpose: '为一组 Store Resource 创建统一 owner。resource 原样委托 createStoreResource；scope dispose 会 force-dispose 全部仍存活成员，并自动摘除自然终态成员。',
      quickStart: "const scope = createStoreResourceScope()\nconst user = scope.resource(({ signal }) => fetchUser(signal))\nconst settings = scope.resource(({ signal }) => fetchSettings(signal))\n\ntry {\n  user.preload()\n  settings.preload()\n} finally {\n  scope.dispose()\n}",
      scenarios: ['component、route 或 request 共同拥有多个 Resource。', 'group shutdown 必须忽略残留 lease，因为整体 owner 正在结束。', '自然到达 terminal 的 Resource 应退出私有 ownership set。'],
      avoidWhen: ['每个 Resource 有不同 lifetime owner。', '单 Resource 优雅关闭必须等待 lease；scope dispose 刻意 force-dispose。', 'scope 本身无法 dispose。'],
      options: []
    }
  },
  'store-light:index:createStoreLightError': {
    en: {
      purpose: 'Creates a native Error carrying the canonical Store Light source and a registered semantic code, optionally retaining a lower-level failure as cause.',
      quickStart: "throw createStoreLightError(StoreLightErrorCode.invalidOption, 'custom field configuration is invalid', { cause })",
      scenarios: ['A custom FieldBuilder extends the Store Light error boundary.', 'A Store adapter must preserve a lower-level failure through Error.cause.', 'Consumers branch on stable source and code without losing native Error identity.'],
      avoidWhen: ['A built-in Store API already emits the canonical failure.', 'The condition requires RangeError or TypeError identity.', 'No registered StoreLightErrorCode matches the failure.'],
      options: [
        { name: 'code', description: 'Registered semantic Store Light error code.', defaultValue: 'required', optional: false, type: 'IStoreLightErrorCode', whenToUse: 'Classify the exact adapter or extension failure.', example: 'StoreLightErrorCode.invalidOption' },
        { name: 'message', description: 'Stable diagnostic summary without request secrets.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Describe the failed public invariant.', example: "'custom field configuration is invalid'" },
        { name: 'options.cause', description: 'Original failure retained through Error.cause.', defaultValue: 'undefined', type: 'unknown', whenToUse: 'Wrap a lower-level getter, initialization, or ownership failure.', example: '{ cause }' }
      ]
    },
    zh: {
      purpose: '创建带 canonical Store Light source 与已注册语义 code 的原生 Error，并可通过 cause 保留底层 failure。',
      quickStart: "throw createStoreLightError(StoreLightErrorCode.invalidOption, 'custom field configuration is invalid', { cause })",
      scenarios: ['自定义 FieldBuilder 扩展 Store Light error boundary。', 'Store adapter 必须通过 Error.cause 保留底层 failure。', 'consumer 按稳定 source/code 分支，同时不丢失原生 Error identity。'],
      avoidWhen: ['内建 Store API 已产生 canonical failure。', '条件需要 RangeError 或 TypeError identity。', '没有已注册 StoreLightErrorCode 匹配 failure。'],
      options: [
        { name: 'code', description: '已注册语义 Store Light error code。', defaultValue: '必填', optional: false, type: 'IStoreLightErrorCode', whenToUse: '精确分类 adapter 或 extension failure。', example: 'StoreLightErrorCode.invalidOption' },
        { name: 'message', description: '不包含 request secret 的稳定诊断 summary。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '描述失败的公开 invariant。', example: "'custom field configuration is invalid'" },
        { name: 'options.cause', description: '通过 Error.cause 保留的原始 failure。', defaultValue: 'undefined', type: 'unknown', whenToUse: '包装底层 getter、initialization 或 ownership failure。', example: '{ cause }' }
      ]
    }
  },
  'store-light:index:createStoreLightRangeError': {
    en: {
      purpose: 'Creates a native RangeError tagged with Store Light source/code identity for invalid numeric limits such as cache lifetime or version bounds.',
      quickStart: "throw createStoreLightRangeError(StoreLightErrorCode.invalidOption, 'keepAliveMs must be finite and non-negative')",
      scenarios: ['A custom Resource adapter validates a numeric option.', 'Consumers must retain native RangeError branching.', 'The semantic code still belongs to Store Light.'],
      avoidWhen: ['The failure is a wrong runtime type.', 'A cause must be attached; this factory does not accept one.', 'The numeric condition represents ordinary Resource state.'],
      options: [
        { name: 'code', description: 'Registered code describing the rejected numeric contract.', defaultValue: 'required', optional: false, type: 'IStoreLightErrorCode', whenToUse: 'Select the Store Light code matching the range boundary.', example: 'StoreLightErrorCode.invalidOption' },
        { name: 'message', description: 'Stable text naming the invalid bound.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Tell callers which numeric invariant failed.', example: "'keepAliveMs must be finite and non-negative'" }
      ]
    },
    zh: {
      purpose: '为 cache lifetime 或 version bound 等非法数值限制创建带 Store Light source/code identity 的原生 RangeError。',
      quickStart: "throw createStoreLightRangeError(StoreLightErrorCode.invalidOption, 'keepAliveMs must be finite and non-negative')",
      scenarios: ['自定义 Resource adapter 校验数值 option。', 'consumer 必须保留原生 RangeError 分支。', '语义 code 仍属于 Store Light。'],
      avoidWhen: ['失败是错误 runtime type。', '必须附加 cause；该 factory 不接受 cause。', '数值条件表示普通 Resource state。'],
      options: [
        { name: 'code', description: '描述被拒数值契约的已注册 code。', defaultValue: '必填', optional: false, type: 'IStoreLightErrorCode', whenToUse: '选择与 range boundary 匹配的 Store Light code。', example: 'StoreLightErrorCode.invalidOption' },
        { name: 'message', description: '标识非法 bound 的稳定文本。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '告诉调用方哪个数值 invariant 失败。', example: "'keepAliveMs must be finite and non-negative'" }
      ]
    }
  },
  'store-light:index:createStoreLightTypeError': {
    en: {
      purpose: 'Creates a native TypeError with Store Light identity and optional cause for invalid Store shapes, Resource factories, callback contracts, or custom field values.',
      quickStart: "throw createStoreLightTypeError(StoreLightErrorCode.invalidOption, 'resource factory must be callable', { cause })",
      scenarios: ['An extension rejects a runtime value by type or shape.', 'A hostile property access failure must remain reachable as cause.', 'Consumers depend on native TypeError plus source/code.'],
      avoidWhen: ['The failure is a numeric range violation.', 'A built-in validator already owns the boundary.', 'No registered code describes the type failure.'],
      options: [
        { name: 'code', description: 'Registered semantic code for the type or shape failure.', defaultValue: 'required', optional: false, type: 'IStoreLightErrorCode', whenToUse: 'Classify the rejected Store or Resource contract.', example: 'StoreLightErrorCode.invalidOption' },
        { name: 'message', description: 'Stable description of the expected runtime type or shape.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Explain the rejected value without embedding secrets.', example: "'resource factory must be callable'" },
        { name: 'options.cause', description: 'Original accessor or validation failure retained as cause.', defaultValue: 'undefined', type: 'unknown', whenToUse: 'Preserve a Proxy, getter, or nested validation failure.', example: '{ cause }' }
      ]
    },
    zh: {
      purpose: '为非法 Store shape、Resource factory、callback contract 或自定义 field value 创建带 Store Light identity 与可选 cause 的原生 TypeError。',
      quickStart: "throw createStoreLightTypeError(StoreLightErrorCode.invalidOption, 'resource factory must be callable', { cause })",
      scenarios: ['extension 按 runtime type 或 shape 拒绝 value。', 'hostile property access failure 必须通过 cause 保持可达。', 'consumer 依赖原生 TypeError 与 source/code。'],
      avoidWhen: ['失败是数值 range violation。', '内建 validator 已拥有该 boundary。', '没有已注册 code 描述 type failure。'],
      options: [
        { name: 'code', description: 'type 或 shape failure 的已注册语义 code。', defaultValue: '必填', optional: false, type: 'IStoreLightErrorCode', whenToUse: '分类被拒的 Store 或 Resource contract。', example: 'StoreLightErrorCode.invalidOption' },
        { name: 'message', description: '描述期望 runtime type 或 shape 的稳定文本。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '解释被拒 value，不嵌入 secret。', example: "'resource factory must be callable'" },
        { name: 'options.cause', description: '保留为 cause 的原始 accessor 或 validation failure。', defaultValue: 'undefined', type: 'unknown', whenToUse: '保留 Proxy、getter 或 nested validation failure。', example: '{ cause }' }
      ]
    }
  },
  'store-light:index:createStoreLightAggregateError': {
    en: {
      purpose: 'Creates a native AggregateError tagged with Store Light identity while retaining every independent initialization, rollback, or disposal failure in errors[].',
      quickStart: "throw createStoreLightAggregateError(StoreLightErrorCode.scopeDisposalFailed, failures, 'Store cleanup failed')",
      scenarios: ['Several owned fields fail during Store disposal.', 'Rollback must preserve each independent cleanup failure.', 'Consumers inspect ordered AggregateError.errors plus one semantic code.'],
      avoidWhen: ['Only one failure exists and can be rethrown directly.', 'Member failures would be flattened into text.', 'The chosen code is not registered for an aggregate boundary.'],
      options: [
        { name: 'code', description: 'Registered semantic code for the aggregate boundary.', defaultValue: 'required', optional: false, type: 'IStoreLightErrorCode', whenToUse: 'Classify the owning initialization or cleanup operation.', example: 'StoreLightErrorCode.scopeDisposalFailed' },
        { name: 'errors', description: 'Ordered original failures retained by AggregateError.errors.', defaultValue: 'required', optional: false, type: 'unknown[]', whenToUse: 'Pass every independent failure without filtering identity.', example: 'failures' },
        { name: 'message', description: 'Stable aggregate summary that does not replace member diagnostics.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Name the failed boundary for logs and callers.', example: "'Store cleanup failed'" }
      ]
    },
    zh: {
      purpose: '创建带 Store Light identity 的原生 AggregateError，并在 errors[] 中保留每个独立 initialization、rollback 或 disposal failure。',
      quickStart: "throw createStoreLightAggregateError(StoreLightErrorCode.scopeDisposalFailed, failures, 'Store cleanup failed')",
      scenarios: ['多个 owned field 在 Store disposal 期间失败。', 'rollback 必须保留每个独立 cleanup failure。', 'consumer 检查有序 AggregateError.errors 与一个语义 code。'],
      avoidWhen: ['只有一个 failure，可直接重抛。', '准备把成员 failure 压平成文本。', '所选 code 未注册为 aggregate boundary。'],
      options: [
        { name: 'code', description: 'aggregate boundary 的已注册语义 code。', defaultValue: '必填', optional: false, type: 'IStoreLightErrorCode', whenToUse: '分类 owning initialization 或 cleanup operation。', example: 'StoreLightErrorCode.scopeDisposalFailed' },
        { name: 'errors', description: '由 AggregateError.errors 按顺序保留的原始 failure。', defaultValue: '必填', optional: false, type: 'unknown[]', whenToUse: '不筛除 identity 地传入每个独立 failure。', example: 'failures' },
        { name: 'message', description: '不替换成员诊断的稳定 aggregate summary。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '为日志与 caller 标识失败 boundary。', example: "'Store cleanup failed'" }
      ]
    }
  },
  'store-ssr:index:SSRRequestScope': {
    en: {
      purpose: 'Owns one request-local Reactive Runtime, registered Stores and Resources, hydration backlog, resource waiting, dehydration, and deterministic cleanup. The scope is the isolation boundary: values from another Runtime are rejected.',
      quickStart: "const scope = new SSRRequestScope()\nconst session = await createStore({ runtime: scope.runtime, user: atom(null) })\nscope.register('session', session)\n\ntry {\n  await scope.awaitResources({ timeoutMs: 2_000 })\n  const state = scope.dehydrate()\n  return createSSRStateScript(state)\n} finally {\n  await scope.disposeAsync()\n}",
      scenarios: ['One server request needs isolated Store and Resource state.', 'A request must await a bounded resource waterfall before rendering.', 'Hydration and owned cleanup need one explicit lifecycle owner.'],
      avoidWhen: ['State is process-global or intentionally shared between requests.', 'Stores were created with a different Runtime.', 'The caller cannot guarantee disposeAsync in its request-finally path.'],
      options: [
        { name: 'runtime', description: 'Existing request-owned Reactive Runtime. Every registered Store and Resource must use this exact instance.', defaultValue: 'internally created', type: 'IRuntime', whenToUse: 'Reuse a Runtime already created for this same request.', example: 'new SSRRequestScope({ runtime })' },
        { name: 'runtimeOptions', description: 'Options forwarded when the scope creates its own Runtime; mutually exclusive with runtime.', defaultValue: '{}', type: 'IRuntimeOptions', whenToUse: 'Configure error reporting or scheduling without constructing the Runtime yourself.', example: 'new SSRRequestScope({ runtimeOptions: { onError } })' },
        { name: 'register options.owned', description: 'Whether the scope disposes a registered Store or Resource during unregister or scope shutdown.', defaultValue: 'true', type: 'boolean', whenToUse: 'Set false only when lifecycle ownership remains with an outer request component.', example: "scope.register('session', store, { owned: false })" },
        { name: 'awaitResources timeoutMs', description: 'Total finite wait budget for all resource waterfall rounds; zero expires immediately.', defaultValue: 'unbounded', type: 'number', whenToUse: 'Bound server response latency when resources may stall.', example: 'await scope.awaitResources({ timeoutMs: 2_000 })' },
        { name: 'dehydrateAsync onResourceError', description: 'Receives each contained Resource failure instead of the default runtime.reportError path.', defaultValue: 'runtime.reportError', type: '(failure: ISSRResourceFailure) => void', whenToUse: 'Attach request-specific diagnostics while still returning the successful payload.', example: 'await scope.dehydrateAsync({ onResourceError: report })' }
      ]
    },
    zh: {
      purpose: '统一拥有一个请求局部的 Reactive Runtime、已注册 Store/Resource、待应用 hydration、资源等待、dehydrate 与确定性清理。scope 就是隔离边界：来自其他 Runtime 的值会被拒绝。',
      quickStart: "const scope = new SSRRequestScope()\nconst session = await createStore({ runtime: scope.runtime, user: atom(null) })\nscope.register('session', session)\n\ntry {\n  await scope.awaitResources({ timeoutMs: 2_000 })\n  const state = scope.dehydrate()\n  return createSSRStateScript(state)\n} finally {\n  await scope.disposeAsync()\n}",
      scenarios: ['一条服务端请求需要隔离 Store 与 Resource 状态。', '渲染前需要在有界预算内等待瀑布式 Resource。', 'hydration 与 owned cleanup 需要一个显式生命周期 owner。'],
      avoidWhen: ['状态是进程全局或刻意跨请求共享。', 'Store 使用了不同的 Runtime。', '调用方无法在请求 finally 路径保证 disposeAsync。'],
      options: [
        { name: 'runtime', description: '已有的请求专属 Reactive Runtime；所有注册 Store 与 Resource 必须使用同一实例。', defaultValue: '内部创建', type: 'IRuntime', whenToUse: '复用已经为同一请求创建的 Runtime。', example: 'new SSRRequestScope({ runtime })' },
        { name: 'runtimeOptions', description: 'scope 自建 Runtime 时转发的选项；不能与 runtime 同时传入。', defaultValue: '{}', type: 'IRuntimeOptions', whenToUse: '不自行构造 Runtime，但需要配置错误报告或调度。', example: 'new SSRRequestScope({ runtimeOptions: { onError } })' },
        { name: 'register options.owned', description: 'unregister 或 scope shutdown 时是否由 scope dispose 已注册 Store/Resource。', defaultValue: 'true', type: 'boolean', whenToUse: '只有外层请求组件保留 lifecycle ownership 时才设为 false。', example: "scope.register('session', store, { owned: false })" },
        { name: 'awaitResources timeoutMs', description: '全部 Resource 瀑布轮次共享的有限总等待预算；0 表示立即过期。', defaultValue: '无限制', type: 'number', whenToUse: 'Resource 可能卡住时约束服务端响应延迟。', example: 'await scope.awaitResources({ timeoutMs: 2_000 })' },
        { name: 'dehydrateAsync onResourceError', description: '逐项接收被隔离的 Resource failure，替代默认 runtime.reportError 路径。', defaultValue: 'runtime.reportError', type: '(failure: ISSRResourceFailure) => void', whenToUse: '保留成功 payload，同时记录请求级诊断。', example: 'await scope.dehydrateAsync({ onResourceError: report })' }
      ]
    }
  },
  'store-ssr:index:createSSRRequestScope': {
    en: {
      purpose: 'Creates an SSRRequestScope; this is the preferred request-entry factory when subclass construction is not needed.',
      quickStart: "const scope = createSSRRequestScope({ runtimeOptions: { onError } })\ntry {\n  // create and register request-local state\n} finally {\n  await scope.disposeAsync()\n}",
      scenarios: ['A server handler starts one isolated SSR lifecycle.', 'A framework adapter needs a small scope factory.', 'Runtime options must be fixed at request admission.'],
      avoidWhen: ['An existing scope already owns the request.', 'A process-global singleton is being created.', 'Cleanup cannot be tied to the request finally block.'],
      options: [
        { name: 'runtime', description: 'Existing reactive Runtime owned by this server request. Reusing it keeps request-local stores in one isolated graph instead of sharing state with another request.', defaultValue: 'internally created', type: 'IRuntime', whenToUse: 'Share one request Runtime with other request-local facilities.', example: 'createSSRRequestScope({ runtime })' },
        { name: 'runtimeOptions', description: 'Options for the internally created Runtime; mutually exclusive with runtime.', defaultValue: '{}', type: 'IRuntimeOptions', whenToUse: 'Configure the internal Runtime without constructing it.', example: 'createSSRRequestScope({ runtimeOptions: { onError } })' }
      ]
    },
    zh: {
      purpose: '创建 SSRRequestScope；不需要子类构造时，这是推荐的请求入口 factory。',
      quickStart: "const scope = createSSRRequestScope({ runtimeOptions: { onError } })\ntry {\n  // 创建并注册请求局部状态\n} finally {\n  await scope.disposeAsync()\n}",
      scenarios: ['服务端 handler 启动一条隔离 SSR lifecycle。', 'framework adapter 需要轻量 scope factory。', 'Runtime option 必须在请求 admission 时固定。'],
      avoidWhen: ['请求已经有 scope owner。', '准备创建进程全局 singleton。', 'cleanup 无法绑定请求 finally。'],
      options: [
        { name: 'runtime', description: '当前服务端请求持有的现有响应式 Runtime；复用它可让本请求的 store 位于同一张隔离图中，避免状态泄漏到其他请求。', defaultValue: '内部创建', type: 'IRuntime', whenToUse: '让其他请求局部设施共享同一个 Runtime。', example: 'createSSRRequestScope({ runtime })' },
        { name: 'runtimeOptions', description: '内部 Runtime 的构造选项；不能与 runtime 同时传入。', defaultValue: '{}', type: 'IRuntimeOptions', whenToUse: '无需自行构造 Runtime，但要配置其行为。', example: 'createSSRRequestScope({ runtimeOptions: { onError } })' }
      ]
    }
  },
  'store-ssr:index:serializeSSRState': {
    en: {
      purpose: 'Validates an SSR snapshot, serializes it as JSON, and escapes HTML-significant characters so the text is safe inside an application/json script element.',
      quickStart: "const text = serializeSSRState(scope.dehydrate())\n// Insert text only into a non-executable application/json script element.",
      scenarios: ['A template already owns the script element markup.', 'A validated snapshot must cross the HTML boundary.', 'The default JSON wire format is sufficient.'],
      avoidWhen: ['A custom codec is required; use createSSRStateScriptWith.', 'The input came from dehydrateTrusted; use its paired serializer immediately.', 'The text will be treated as executable JavaScript.'],
      options: [{ name: 'state', description: 'Versioned Store and Resource snapshot validated before serialization.', defaultValue: 'required', optional: false, type: 'ISSRState', whenToUse: 'Pass the direct result of dehydrate or dehydrateAsync.', example: 'serializeSSRState(scope.dehydrate())' }]
    },
    zh: {
      purpose: '先校验 SSR snapshot，再序列化 JSON，并转义 HTML 敏感字符，使文本可安全放入 application/json script element。',
      quickStart: "const text = serializeSSRState(scope.dehydrate())\n// 只把 text 放入不可执行的 application/json script element。",
      scenarios: ['template 已经拥有 script element markup。', '已校验 snapshot 必须穿过 HTML 边界。', '默认 JSON wire format 已足够。'],
      avoidWhen: ['需要自定义 codec；使用 createSSRStateScriptWith。', '输入来自 dehydrateTrusted；必须立即使用其配套 serializer。', '准备把文本当作可执行 JavaScript。'],
      options: [{ name: 'state', description: '序列化前完整校验的版本化 Store 与 Resource snapshot。', defaultValue: '必填', optional: false, type: 'ISSRState', whenToUse: '传入 dehydrate 或 dehydrateAsync 的直接结果。', example: 'serializeSSRState(scope.dehydrate())' }]
    }
  },
  'store-ssr:index:serializeTrustedSSRState': {
    en: {
      purpose: 'Immediately serializes the live-reference fast path returned by dehydrateTrusted. It skips snapshot validation and copying, so the caller must prove data is immutable, JSON-safe, and not request-controlled.',
      quickStart: "const trusted = scope.dehydrateTrusted()\nconst text = serializeTrustedSSRState(trusted) // no await between these lines",
      scenarios: ['Measured internal rendering proves snapshot validation is the bottleneck.', 'Every value is already immutable and JSON-safe.', 'Serialization occurs synchronously before any mutation can run.'],
      avoidWhen: ['Any value came from request input.', 'An await, timer, stream queue, or concurrent mutation separates dehydration from serialization.', 'Safety matters more than a measured validation cost; use dehydrate.'],
      options: [{ name: 'state', description: 'Trusted live-reference state produced only by dehydrateTrusted.', defaultValue: 'required', optional: false, type: 'ITrustedSSRState', whenToUse: 'Use only on a proven internal fast path and serialize immediately.', example: 'serializeTrustedSSRState(scope.dehydrateTrusted())' }]
    },
    zh: {
      purpose: '立即序列化 dehydrateTrusted 返回的 live-reference fast path。它跳过 snapshot 校验与复制，因此调用方必须证明数据不可变、JSON-safe 且不受请求输入控制。',
      quickStart: "const trusted = scope.dehydrateTrusted()\nconst text = serializeTrustedSSRState(trusted) // 两行之间不能 await",
      scenarios: ['测量证明 snapshot validation 是内部渲染瓶颈。', '每个值都已不可变且 JSON-safe。', '在任何 mutation 运行前同步完成序列化。'],
      avoidWhen: ['任何值来自请求输入。', 'dehydrate 与 serialize 之间存在 await、timer、stream queue 或并发 mutation。', '没有测量收益；应使用安全的 dehydrate。'],
      options: [{ name: 'state', description: '只能由 dehydrateTrusted 产生的 trusted live-reference state。', defaultValue: '必填', optional: false, type: 'ITrustedSSRState', whenToUse: '仅用于已经证明安全的内部 fast path，并立即序列化。', example: 'serializeTrustedSSRState(scope.dehydrateTrusted())' }]
    }
  },
  'store-ssr:index:deserializeSSRState': {
    en: {
      purpose: 'Parses JSON text and validates the complete versioned Store and Resource snapshot before returning it.',
      quickStart: "const state = deserializeSSRState(serialized)\nscope.hydrate(state)",
      scenarios: ['A server or non-DOM client receives default JSON SSR state.', 'Malformed snapshots must fail before hydration.', 'The caller already owns the serialized text.'],
      avoidWhen: ['The payload uses a custom codec.', 'The payload is being read from a document element; use the document reader.', 'Unvalidated JSON is expected to pass through unchanged.'],
      options: [{ name: 'serialized', description: 'JSON text produced by serializeSSRState or createSSRStateScript content.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Decode a default-format SSR payload before scope.hydrate.', example: 'deserializeSSRState(serialized)' }]
    },
    zh: {
      purpose: '解析 JSON 文本，并在返回前完整校验版本化 Store 与 Resource snapshot。',
      quickStart: "const state = deserializeSSRState(serialized)\nscope.hydrate(state)",
      scenarios: ['服务端或非 DOM client 接收默认 JSON SSR state。', '非法 snapshot 必须在 hydrate 前失败。', '调用方已经持有 serialized text。'],
      avoidWhen: ['payload 使用自定义 codec。', 'payload 来自 document element；应使用 document reader。', '期望未校验 JSON 原样通过。'],
      options: [{ name: 'serialized', description: '由 serializeSSRState 或 createSSRStateScript 内容产生的 JSON text。', defaultValue: '必填', optional: false, type: 'string', whenToUse: 'scope.hydrate 前解码默认格式 SSR payload。', example: 'deserializeSSRState(serialized)' }]
    }
  },
  'store-ssr:index:createSSRStateScript': {
    en: {
      purpose: 'Builds a complete non-executable application/json script element with a validated semantic id and HTML-safe serialized state.',
      quickStart: "const stateTag = createSSRStateScript(scope.dehydrate(), '__STORE_STATE__')\nhtml.write(stateTag)",
      scenarios: ['Server HTML needs one default JSON hydration payload.', 'The template can safely insert a complete trusted markup string.', 'A stable custom element id separates multiple roots.'],
      avoidWhen: ['The template engine escapes markup strings instead of inserting trusted server output.', 'A non-JSON codec is required.', 'The id is derived from untrusted input.'],
      options: [
        { name: 'state', description: 'Validated Store and Resource snapshot to embed.', defaultValue: 'required', optional: false, type: 'ISSRState', whenToUse: 'Pass the final request snapshot after resource waiting.', example: 'createSSRStateScript(scope.dehydrate())' },
        { name: 'elementId', description: 'Stable DOM id restricted to safe identifier characters.', defaultValue: "'__STORE_STATE__'", type: 'string', whenToUse: 'Choose a semantic id when a page has multiple hydration roots.', example: "createSSRStateScript(state, 'account-state')" }
      ]
    },
    zh: {
      purpose: '生成完整、不可执行的 application/json script element，包含校验过的语义 id 与 HTML-safe serialized state。',
      quickStart: "const stateTag = createSSRStateScript(scope.dehydrate(), '__STORE_STATE__')\nhtml.write(stateTag)",
      scenarios: ['服务端 HTML 需要一份默认 JSON hydration payload。', 'template 可以安全插入完整的受信任服务端 markup。', '稳定自定义 element id 用于区分多个 root。'],
      avoidWhen: ['template engine 会转义 markup string，而非插入可信服务端输出。', '需要非 JSON codec。', 'id 来自不可信输入。'],
      options: [
        { name: 'state', description: '要嵌入的已校验 Store 与 Resource snapshot。', defaultValue: '必填', optional: false, type: 'ISSRState', whenToUse: 'Resource 等待完成后传入最终请求 snapshot。', example: 'createSSRStateScript(scope.dehydrate())' },
        { name: 'elementId', description: '限制为安全 identifier 字符的稳定 DOM id。', defaultValue: "'__STORE_STATE__'", type: 'string', whenToUse: '页面有多个 hydration root 时选择语义 id。', example: "createSSRStateScript(state, 'account-state')" }
      ]
    }
  },
  'store-ssr:index:readSSRStateFromDocument': {
    en: {
      purpose: 'Reads and validates default JSON SSR state from an explicitly injected document-like host; it never reaches for globalThis.document.',
      quickStart: "const state = readSSRStateFromDocument('__STORE_STATE__', document)\nif (state) scope.hydrate(state)",
      scenarios: ['Browser hydration reads the default script payload.', 'Tests inject a minimal document double.', 'Runtime-neutral code must avoid an implicit DOM dependency.'],
      avoidWhen: ['The payload is codec-tagged.', 'Missing state should be treated as an error rather than undefined.', 'The document owner cannot guarantee the element is non-executable state markup.'],
      options: [
        { name: 'elementId', description: 'DOM id containing the default JSON payload.', defaultValue: "'__STORE_STATE__'", type: 'string', whenToUse: 'Match the id passed to createSSRStateScript.', example: "readSSRStateFromDocument('account-state', document)" },
        { name: 'documentValue', description: 'Explicit minimal document-like host used for lookup.', defaultValue: 'undefined', type: 'ISSRDocument', whenToUse: 'Inject the browser document or a test double.', example: "readSSRStateFromDocument('__STORE_STATE__', document)" }
      ]
    },
    zh: {
      purpose: '从显式注入的 document-like host 读取并校验默认 JSON SSR state；不会隐式访问 globalThis.document。',
      quickStart: "const state = readSSRStateFromDocument('__STORE_STATE__', document)\nif (state) scope.hydrate(state)",
      scenarios: ['browser hydration 读取默认 script payload。', '测试注入最小 document double。', 'runtime-neutral 代码必须避免隐式 DOM 依赖。'],
      avoidWhen: ['payload 带自定义 codec 标签。', '缺少 state 应视为 error，而不是 undefined。', 'document owner 无法保证 element 是不可执行 state markup。'],
      options: [
        { name: 'elementId', description: '包含默认 JSON payload 的 DOM id。', defaultValue: "'__STORE_STATE__'", type: 'string', whenToUse: '与 createSSRStateScript 使用的 id 保持一致。', example: "readSSRStateFromDocument('account-state', document)" },
        { name: 'documentValue', description: '用于 lookup 的显式最小 document-like host。', defaultValue: 'undefined', type: 'ISSRDocument', whenToUse: '注入 browser document 或 test double。', example: "readSSRStateFromDocument('__STORE_STATE__', document)" }
      ]
    }
  },
  'store-ssr:index:createSSRStateScriptWith': {
    en: {
      purpose: 'Encodes SSR state through a Serialize registry and emits safe script markup. JSON text is escaped directly; every other text or byte format is base64-wrapped in text/plain.',
      quickStart: "const html = await createSSRStateScriptWith(scope.dehydrate(), {\n  codecs,\n  elementId: 'account-state',\n  signal: request.signal\n})",
      scenarios: ['A project standardizes SSR payloads on a custom Serialize registry.', 'Binary or non-JSON text must cross HTML safely.', 'Request cancellation should abort codec work.'],
      avoidWhen: ['Default JSON already satisfies the payload contract.', 'The client does not install the matching codec type.', 'The generated markup would be parsed as executable script.'],
      options: [
        { name: 'codecs', description: 'Serialize registry whose primaryType selects the emitted codec.', defaultValue: 'required', optional: false, type: 'ISerializeRegistry', whenToUse: 'Install matching server and client codec registries.', example: '{ codecs }' },
        { name: 'elementId', description: 'Safe semantic DOM id for this payload.', defaultValue: "'__STORE_STATE__'", type: 'string', whenToUse: 'Separate multiple hydration payloads.', example: "{ codecs, elementId: 'account-state' }" },
        { name: 'signal', description: 'Abort signal forwarded to codec encode.', defaultValue: 'undefined', type: 'AbortSignal', whenToUse: 'Cancel encoding when the request disconnects.', example: '{ codecs, signal: request.signal }' }
      ]
    },
    zh: {
      purpose: '通过 Serialize registry 编码 SSR state 并生成安全 script markup。JSON text 直接转义；其他 text 或 byte format 一律 base64 后放入 text/plain。',
      quickStart: "const html = await createSSRStateScriptWith(scope.dehydrate(), {\n  codecs,\n  elementId: 'account-state',\n  signal: request.signal\n})",
      scenarios: ['项目用自定义 Serialize registry 统一 SSR payload。', 'binary 或非 JSON text 必须安全穿过 HTML。', '请求取消时应 abort codec work。'],
      avoidWhen: ['默认 JSON 已满足 payload contract。', 'client 没有安装匹配 codec type。', '生成 markup 会被当作 executable script 解析。'],
      options: [
        { name: 'codecs', description: '以 primaryType 选择输出 codec 的 Serialize registry。', defaultValue: '必填', optional: false, type: 'ISerializeRegistry', whenToUse: '服务端与 client 安装匹配 codec registry。', example: '{ codecs }' },
        { name: 'elementId', description: '当前 payload 的安全语义 DOM id。', defaultValue: "'__STORE_STATE__'", type: 'string', whenToUse: '区分多个 hydration payload。', example: "{ codecs, elementId: 'account-state' }" },
        { name: 'signal', description: '转发给 codec encode 的 AbortSignal。', defaultValue: 'undefined', type: 'AbortSignal', whenToUse: '请求断开时取消编码。', example: '{ codecs, signal: request.signal }' }
      ]
    }
  },
  'store-ssr:index:readSSRStateFromDocumentWith': {
    en: {
      purpose: 'Reads codec metadata and payload from an explicitly injected document, restores base64 bytes when needed, decodes through the registry, and validates the resulting SSR state.',
      quickStart: "const state = await readSSRStateFromDocumentWith({\n  codecs,\n  document,\n  elementId: 'account-state',\n  signal\n})\nif (state) scope.hydrate(state)",
      scenarios: ['Client hydration consumes a custom-codec payload.', 'Binary payloads were base64-wrapped for HTML transport.', 'Abort must propagate through client decoding.'],
      avoidWhen: ['The server emitted the default untagged JSON helper.', 'The registry lacks the emitted data-codec type.', 'Code expects an implicit global document lookup.'],
      options: [
        { name: 'codecs', description: 'Serialize registry containing the codec named by data-codec.', defaultValue: 'required', optional: false, type: 'ISerializeRegistry', whenToUse: 'Mirror the server registry on the hydration client.', example: '{ codecs, document }' },
        { name: 'elementId', description: 'DOM id containing the codec-tagged payload.', defaultValue: "'__STORE_STATE__'", type: 'string', whenToUse: 'Match createSSRStateScriptWith.', example: "{ codecs, document, elementId: 'account-state' }" },
        { name: 'document', description: 'Explicit document-like host; no global fallback is used.', defaultValue: 'undefined', type: 'ISSRDocument', whenToUse: 'Inject browser document or an isolated test host.', example: '{ codecs, document }' },
        { name: 'signal', description: 'Abort signal forwarded to codec decode.', defaultValue: 'undefined', type: 'AbortSignal', whenToUse: 'Cancel hydration when navigation or ownership ends.', example: '{ codecs, document, signal }' }
      ]
    },
    zh: {
      purpose: '从显式 document 读取 codec metadata 与 payload，必要时还原 base64 bytes，经 registry decode，最后校验得到的 SSR state。',
      quickStart: "const state = await readSSRStateFromDocumentWith({\n  codecs,\n  document,\n  elementId: 'account-state',\n  signal\n})\nif (state) scope.hydrate(state)",
      scenarios: ['client hydration 消费自定义 codec payload。', 'binary payload 为 HTML transport 做过 base64 包装。', 'abort 必须传播到 client decode。'],
      avoidWhen: ['服务端使用默认无标签 JSON helper。', 'registry 缺少 data-codec 指定类型。', '代码期望隐式 global document lookup。'],
      options: [
        { name: 'codecs', description: '包含 data-codec 所指定 codec 的 Serialize registry。', defaultValue: '必填', optional: false, type: 'ISerializeRegistry', whenToUse: 'hydration client 镜像服务端 registry。', example: '{ codecs, document }' },
        { name: 'elementId', description: '包含 codec-tagged payload 的 DOM id。', defaultValue: "'__STORE_STATE__'", type: 'string', whenToUse: '与 createSSRStateScriptWith 保持一致。', example: "{ codecs, document, elementId: 'account-state' }" },
        { name: 'document', description: '显式 document-like host；不存在 global fallback。', defaultValue: 'undefined', type: 'ISSRDocument', whenToUse: '注入 browser document 或隔离 test host。', example: '{ codecs, document }' },
        { name: 'signal', description: '转发给 codec decode 的 AbortSignal。', defaultValue: 'undefined', type: 'AbortSignal', whenToUse: 'navigation 或 ownership 结束时取消 hydration。', example: '{ codecs, document, signal }' }
      ]
    }
  },
  'store-ssr:index:assertSSRState': {
    en: {
      purpose: 'Validates the complete version, Store keys, JSON graph, Resource snapshots, finite timestamps, depth, node budget, and cycle boundaries of an unknown SSR value.',
      quickStart: "const candidate: unknown = JSON.parse(text)\nassertSSRState(candidate)\nscope.hydrate(candidate)",
      scenarios: ['Unknown data enters before hydration.', 'A custom transport decoded an arbitrary value.', 'A framework adapter needs a TypeScript assertion boundary.'],
      avoidWhen: ['The value was already returned by deserializeSSRState.', 'Partial validation is desired; this contract validates the entire snapshot.', 'Invalid state should be silently ignored.'],
      options: [{ name: 'value', description: 'Unknown candidate validated recursively as ISSRState.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Place at every custom SSR state ingress before hydrate.', example: 'assertSSRState(candidate)' }]
    },
    zh: {
      purpose: '完整校验未知 SSR value 的 version、Store key、JSON graph、Resource snapshot、有限 timestamp、depth、node budget 与 cycle 边界。',
      quickStart: "const candidate: unknown = JSON.parse(text)\nassertSSRState(candidate)\nscope.hydrate(candidate)",
      scenarios: ['未知数据进入 hydrate 之前。', '自定义 transport decode 出任意 value。', 'framework adapter 需要 TypeScript assertion boundary。'],
      avoidWhen: ['值已经由 deserializeSSRState 返回。', '只想做部分校验；该契约会校验整个 snapshot。', '非法 state 应被静默忽略。'],
      options: [{ name: 'value', description: '递归校验为 ISSRState 的 unknown candidate。', defaultValue: '必填', optional: false, type: 'unknown', whenToUse: '每条自定义 SSR state ingress 在 hydrate 前调用。', example: 'assertSSRState(candidate)' }]
    }
  },
  'store-wasm:index:ensureWasm': {
    en: {
      purpose:
        'Initializes the WASM allocator exactly once and returns the stable readiness Promise identity. Store construction using synchronous field builders must occur only after this barrier resolves.',
      quickStart:
        "await ensureWasm()\n\nconst metrics = await createStore({\n  total: number(),\n  ready: boolean(),\n  title: string(128)\n})\n\ntry {\n  metrics.total = 1\n} finally {\n  metrics.$dispose()\n}",
      scenarios: ['Application bootstrap prepares WASM before constructing a Store with WASM fields.', 'React or SSR suspension needs one stable Promise generation.', 'A failed initialization should be retryable on a later call.'],
      avoidWhen: ['No WASM-backed field is used.', 'A field builder is expected to start asynchronous initialization during Store construction.', 'Callers ignore rejection and continue into synchronous allocation.'],
      options: []
    },
    zh: {
      purpose:
        '只初始化一次 WASM allocator，并返回 identity 稳定的 readiness Promise。使用同步 field builder 构造 Store 必须发生在该 barrier resolve 之后。',
      quickStart:
        "await ensureWasm()\n\nconst metrics = await createStore({\n  total: number(),\n  ready: boolean(),\n  title: string(128)\n})\n\ntry {\n  metrics.total = 1\n} finally {\n  metrics.$dispose()\n}",
      scenarios: ['应用 bootstrap 在构造含 WASM field 的 Store 前准备 WASM。', 'React 或 SSR suspension 需要 identity 稳定的一代 Promise。', '初始化失败后，后续调用应可以重试。'],
      avoidWhen: ['未使用 WASM-backed field。', '期望 field builder 在 Store 构造期间启动异步初始化。', '调用方忽略 rejection 并继续同步 allocation。'],
      options: []
    }
  },
  'store-wasm:index:number': {
    en: {
      purpose: 'Declares a synchronous Store field backed by one owned eight-byte WASM f64 allocation. Reads track one Reactive source; Object.is-equal writes do not notify.',
      quickStart: "const store = await createStore({ score: number() })\ntry {\n  store.score = 42.5\n  console.log(store.score)\n} finally {\n  store.$dispose()\n}",
      scenarios: ['A numeric Store field should live in WASM linear memory.', 'One scalar needs independent Reactive invalidation and deterministic cleanup.', 'NaN and signed-zero equality should follow Object.is.'],
      avoidWhen: ['A normal JS Signal is sufficient and WASM interop provides no measured benefit.', 'Integer overflow or exact decimal semantics are required; storage is f64.', 'The Store owner cannot dispose its field allocations.'],
      options: []
    },
    zh: {
      purpose: '声明一个由独占 8-byte WASM f64 allocation 支撑的同步 Store field。读取追踪一个 Reactive source；Object.is 相等的写入不通知。',
      quickStart: "const store = await createStore({ score: number() })\ntry {\n  store.score = 42.5\n  console.log(store.score)\n} finally {\n  store.$dispose()\n}",
      scenarios: ['数值 Store field 应位于 WASM linear memory。', '一个 scalar 需要独立 Reactive invalidation 与确定性 cleanup。', 'NaN 与 signed-zero equality 应遵循 Object.is。'],
      avoidWhen: ['普通 JS Signal 已足够，WASM interop 没有测量收益。', '需要整数溢出或精确 decimal 语义；存储格式是 f64。', 'Store owner 无法 dispose field allocation。'],
      options: []
    }
  },
  'store-wasm:index:boolean': {
    en: {
      purpose: 'Declares a synchronous boolean Store field stored as one WASM byte. The public value remains strictly boolean and unchanged writes do not notify observers.',
      quickStart: "const store = await createStore({ enabled: boolean() })\ntry {\n  store.enabled = true\n} finally {\n  store.$dispose()\n}",
      scenarios: ['A boolean flag must share the WASM-backed Store lifecycle.', 'The field needs its own tracked Reactive source.', 'A compact one-byte representation is sufficient.'],
      avoidWhen: ['Tri-state or bit-packed flags are required.', 'The field must be mutated directly from foreign WASM without going through Store notification.', 'WASM allocation overhead exceeds the value of one scalar flag.'],
      options: []
    },
    zh: {
      purpose: '声明一个以单个 WASM byte 存储的同步 boolean Store field。公开值严格保持 boolean，未变化写入不会通知 observer。',
      quickStart: "const store = await createStore({ enabled: boolean() })\ntry {\n  store.enabled = true\n} finally {\n  store.$dispose()\n}",
      scenarios: ['boolean flag 必须共享 WASM-backed Store lifecycle。', 'field 需要自己的 tracked Reactive source。', '紧凑单 byte 表示已足够。'],
      avoidWhen: ['需要 tri-state 或 bit-packed flag。', 'foreign WASM 必须绕过 Store notification 直接写 field。', '单 scalar flag 的 WASM allocation overhead 超过收益。'],
      options: []
    }
  },
  'store-wasm:index:string': {
    en: {
      purpose: 'Declares a fixed-capacity UTF-8 Store field using a four-byte length header plus maxBytes payload. Capacity never reallocates, and oversized encoded values fail before mutation.',
      quickStart: "const store = await createStore({ title: string(128) })\ntry {\n  store.title = 'Migaia'\n} finally {\n  store.$dispose()\n}",
      scenarios: ['A short UTF-8 value needs a stable WASM address and bounded storage.', 'Writes must be atomic with respect to capacity validation.', 'One scalar string needs independent Reactive invalidation.'],
      avoidWhen: ['The string can grow without a known byte bound.', 'Character count is being used as byte capacity; UTF-8 characters may occupy several bytes.', 'Large text would be repeatedly encoded and copied through the field.'],
      options: [{ name: 'maxBytes', description: 'Maximum encoded UTF-8 payload bytes, excluding the four-byte length header.', defaultValue: '256', type: 'number', whenToUse: 'Choose a measured upper bound that avoids waste while accepting the largest valid encoded value.', example: 'string(128)' }]
    },
    zh: {
      purpose: '声明固定容量 UTF-8 Store field：4-byte length header 加 maxBytes payload。容量不会重分配，encoded value 超限会在 mutation 前失败。',
      quickStart: "const store = await createStore({ title: string(128) })\ntry {\n  store.title = 'Migaia'\n} finally {\n  store.$dispose()\n}",
      scenarios: ['短 UTF-8 值需要稳定 WASM address 与有界存储。', '写入必须在 capacity validation 之后原子发生。', '单个 scalar string 需要独立 Reactive invalidation。'],
      avoidWhen: ['字符串没有已知 byte 上限且可无限增长。', '把字符数当作 byte capacity；UTF-8 字符可能占多个 bytes。', '大型文本会反复经 field encode 与 copy。'],
      options: [{ name: 'maxBytes', description: 'encoded UTF-8 payload 最大 bytes，不包含 4-byte length header。', defaultValue: '256', type: 'number', whenToUse: '按测量选择既不浪费、又能容纳最大合法编码值的上限。', example: 'string(128)' }]
    }
  },
  'store-wasm:index:array': {
    en: {
      purpose:
        'Declares a fixed-length f64 array with lazy bucket-level Reactive sources. at and setAt track or notify one bucket; setRange validates all values before a batched multi-bucket commit and rolls back written cells if commit fails.',
      quickStart:
        "const store = await createStore({ samples: array(number(), 1_024, 32) })\ntry {\n  store.samples.setAt(0, 1)\n  store.samples.setRange(1, 4, [2, 3, 4])\n  const snapshot = store.samples.view()\n  console.log(snapshot)\n} finally {\n  store.$dispose()\n}",
      scenarios: ['A fixed numeric index domain belongs in WASM memory.', 'Readers consume predictable buckets or ranges.', 'Bulk writes need one Runtime batch and rollback on commit failure.'],
      avoidWhen: ['Length must grow or shrink.', 'Every cell needs precise independent tracking but source overhead is unacceptable.', 'view is expected to expose live WASM memory; it intentionally returns an isolated writable snapshot.'],
      options: wasmArrayOptions.en
    },
    zh: {
      purpose:
        '声明带惰性 bucket-level Reactive source 的定长 f64 array。at/setAt 追踪或通知一个 bucket；setRange 先校验全部值，再以一次 batch 跨 bucket commit，commit 失败会回滚已写 cell。',
      quickStart:
        "const store = await createStore({ samples: array(number(), 1_024, 32) })\ntry {\n  store.samples.setAt(0, 1)\n  store.samples.setRange(1, 4, [2, 3, 4])\n  const snapshot = store.samples.view()\n  console.log(snapshot)\n} finally {\n  store.$dispose()\n}",
      scenarios: ['固定数值 index domain 应位于 WASM memory。', 'reader 按可预测 bucket 或 range 消费。', 'bulk write 需要一次 Runtime batch，并在 commit failure 时 rollback。'],
      avoidWhen: ['length 必须增长或缩短。', '每个 cell 都需要精确独立 tracking，但无法接受 source overhead。', '期望 view 暴露 live WASM memory；它刻意返回隔离的 writable snapshot。'],
      options: wasmArrayOptions.zh
    }
  },
  'store-wasm:index:record': {
    en: {
      purpose:
        'Declares a fixed named f64 structure in one WASM allocation, with one Reactive source per property. Shape keys are snapshotted during builder creation and dispose/disposed are reserved lifecycle names.',
      quickStart:
        "const store = await createStore({\n  point: record({ x: number(), y: number() })\n})\n\ntry {\n  store.point.x = 10\n  store.point.y = 20\n} finally {\n  store.$dispose()\n}",
      scenarios: ['A small fixed numeric structure should occupy one contiguous WASM block.', 'Each named property needs independent Reactive tracking.', 'The schema is known before Store construction and never changes.'],
      avoidWhen: ['Fields are dynamic, optional, nested, or non-numeric.', 'A plain TypeScript Record with arbitrary keys is expected; this is a fixed structural record.', 'Shape keys include dispose or disposed, which belong to lifecycle.'],
      options: [{ name: 'shape', description: 'Plain non-array object mapping fixed property names to number() field builders.', defaultValue: 'required', optional: false, type: 'Record<string, ReturnType<typeof number>>', whenToUse: 'Declare the complete stable numeric layout before Store construction.', example: 'record({ x: number(), y: number() })' }]
    },
    zh: {
      purpose: '在一个 WASM allocation 中声明固定具名 f64 structure，每个 property 拥有一个 Reactive source。builder 创建时快照 shape keys，dispose/disposed 是保留 lifecycle 名。',
      quickStart:
        "const store = await createStore({\n  point: record({ x: number(), y: number() })\n})\n\ntry {\n  store.point.x = 10\n  store.point.y = 20\n} finally {\n  store.$dispose()\n}",
      scenarios: ['小型固定数值 structure 应占用一块连续 WASM block。', '每个具名 property 需要独立 Reactive tracking。', 'schema 在 Store 构造前已知且永不改变。'],
      avoidWhen: ['field 是动态、可选、嵌套或非数值。', '期望带任意 key 的普通 TypeScript Record；这里是固定 structural record。', 'shape key 包含属于 lifecycle 的 dispose 或 disposed。'],
      options: [{ name: 'shape', description: '把固定 property name 映射到 number() field builder 的 plain non-array object。', defaultValue: '必填', optional: false, type: 'Record<string, ReturnType<typeof number>>', whenToUse: 'Store 构造前声明完整稳定数值 layout。', example: 'record({ x: number(), y: number() })' }]
    }
  },
  'store-wasm:index:createStoreWasmError': {
    en: {
      purpose: 'Creates a native Error with canonical store-wasm source/code identity and an optional original cause for WASM field adapters.',
      quickStart: "throw createStoreWasmError(StoreWasmErrorCode.allocationFailed, 'WASM allocation failed', { cause })",
      scenarios: ['A custom WASM field adapter extends the same error boundary.', 'A lower-level allocator failure must remain reachable as cause.'],
      avoidWhen: ['An existing field API already emits the canonical error.', 'The failure is specifically a range or type violation.', 'No registered StoreWasmErrorCode matches.'],
      options: [
        { name: 'code', description: 'Registered semantic store-wasm code.', defaultValue: 'required', optional: false, type: 'IStoreWasmErrorCode', whenToUse: 'Classify the exact adapter failure.', example: 'StoreWasmErrorCode.allocationFailed' },
        { name: 'message', description: 'Stable diagnostic text without secrets.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Explain the failed WASM invariant.', example: "'WASM allocation failed'" },
        { name: 'options.cause', description: 'Original failure retained through Error.cause.', defaultValue: 'undefined', type: 'unknown', whenToUse: 'Wrap allocator or host failure without erasing identity.', example: '{ cause }' }
      ]
    },
    zh: {
      purpose: '为 WASM field adapter 创建带 canonical store-wasm source/code identity 与可选原始 cause 的原生 Error。',
      quickStart: "throw createStoreWasmError(StoreWasmErrorCode.allocationFailed, 'WASM allocation failed', { cause })",
      scenarios: ['自定义 WASM field adapter 扩展同一错误边界。', '底层 allocator failure 必须通过 cause 保持可达。'],
      avoidWhen: ['既有 field API 已产生 canonical error。', '失败明确属于 range 或 type violation。', '没有已注册 StoreWasmErrorCode 匹配。'],
      options: [
        { name: 'code', description: '已注册语义 store-wasm code。', defaultValue: '必填', optional: false, type: 'IStoreWasmErrorCode', whenToUse: '精确分类 adapter failure。', example: 'StoreWasmErrorCode.allocationFailed' },
        { name: 'message', description: '不含 secret 的稳定诊断文本。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '解释失败的 WASM invariant。', example: "'WASM allocation failed'" },
        { name: 'options.cause', description: '通过 Error.cause 保留的原始 failure。', defaultValue: 'undefined', type: 'unknown', whenToUse: '包装 allocator 或 host failure 且不抹除 identity。', example: '{ cause }' }
      ]
    }
  },
  'store-wasm:index:createStoreWasmRangeError': {
    en: {
      purpose: 'Creates a native RangeError tagged with canonical store-wasm identity for capacity, index, length, and allocation bounds.',
      quickStart: "throw createStoreWasmRangeError(StoreWasmErrorCode.invalidOption, 'index is outside the field')",
      scenarios: ['A custom field validates numeric bounds.', 'Consumers branch on native RangeError plus source/code.'],
      avoidWhen: ['The failure is a wrong runtime value type.', 'A lower-level cause must be attached; this factory has no cause option.', 'The numeric condition is normal state.'],
      options: [
        { name: 'code', description: 'Registered semantic code for the rejected range.', defaultValue: 'required', optional: false, type: 'IStoreWasmErrorCode', whenToUse: 'Select the code matching the capacity or index boundary.', example: 'StoreWasmErrorCode.invalidOption' },
        { name: 'message', description: 'Stable text identifying the failed range.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Tell callers which numeric invariant was rejected.', example: "'index is outside the field'" }
      ]
    },
    zh: {
      purpose: '为 capacity、index、length 与 allocation bound 创建带 canonical store-wasm identity 的原生 RangeError。',
      quickStart: "throw createStoreWasmRangeError(StoreWasmErrorCode.invalidOption, 'index is outside the field')",
      scenarios: ['自定义 field 校验数值 bound。', 'consumer 同时按 native RangeError 与 source/code 分支。'],
      avoidWhen: ['失败是错误 runtime value type。', '必须附加底层 cause；该 factory 没有 cause option。', '数值条件属于正常 state。'],
      options: [
        { name: 'code', description: '被拒绝 range 的已注册语义 code。', defaultValue: '必填', optional: false, type: 'IStoreWasmErrorCode', whenToUse: '选择与 capacity 或 index boundary 匹配的 code。', example: 'StoreWasmErrorCode.invalidOption' },
        { name: 'message', description: '标识失败 range 的稳定文本。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '告诉调用方哪个数值 invariant 被拒绝。', example: "'index is outside the field'" }
      ]
    }
  },
  'store-wasm:index:createStoreWasmTypeError': {
    en: {
      purpose: 'Creates a native TypeError with canonical store-wasm identity and optional cause for invalid field shapes or runtime value types.',
      quickStart: "throw createStoreWasmTypeError(StoreWasmErrorCode.invalidOption, 'field value must be a number', { cause })",
      scenarios: ['A custom field rejects a value or shape by runtime type.', 'A hostile property access failure must remain reachable as cause.'],
      avoidWhen: ['The failure is a numeric range violation.', 'An existing field setter already validates the value.', 'The code is unregistered.'],
      options: [
        { name: 'code', description: 'Registered semantic code for the type failure.', defaultValue: 'required', optional: false, type: 'IStoreWasmErrorCode', whenToUse: 'Classify the exact invalid shape or value.', example: 'StoreWasmErrorCode.invalidOption' },
        { name: 'message', description: 'Stable type-contract diagnostic.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'State the expected runtime type or shape.', example: "'field value must be a number'" },
        { name: 'options.cause', description: 'Original access or validation failure retained as cause.', defaultValue: 'undefined', type: 'unknown', whenToUse: 'Preserve a hostile getter or proxy failure.', example: '{ cause }' }
      ]
    },
    zh: {
      purpose: '为非法 field shape 或 runtime value type 创建带 canonical store-wasm identity 与可选 cause 的原生 TypeError。',
      quickStart: "throw createStoreWasmTypeError(StoreWasmErrorCode.invalidOption, 'field value must be a number', { cause })",
      scenarios: ['自定义 field 按 runtime type 拒绝 value 或 shape。', 'hostile property access failure 必须通过 cause 保持可达。'],
      avoidWhen: ['失败是数值 range violation。', '既有 field setter 已校验 value。', 'code 未注册。'],
      options: [
        { name: 'code', description: 'type failure 的已注册语义 code。', defaultValue: '必填', optional: false, type: 'IStoreWasmErrorCode', whenToUse: '精确分类非法 shape 或 value。', example: 'StoreWasmErrorCode.invalidOption' },
        { name: 'message', description: '稳定 type-contract 诊断文本。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '说明期望 runtime type 或 shape。', example: "'field value must be a number'" },
        { name: 'options.cause', description: '保留为 cause 的原始 access 或 validation failure。', defaultValue: 'undefined', type: 'unknown', whenToUse: '保留 hostile getter 或 proxy failure。', example: '{ cause }' }
      ]
    }
  },
  'store-wasm:index:createStoreWasmAggregateError': {
    en: {
      purpose: 'Creates a native AggregateError with canonical store-wasm identity while preserving every cleanup or rollback failure in order.',
      quickStart: "throw createStoreWasmAggregateError(StoreWasmErrorCode.cleanupFailed, failures, 'WASM cleanup failed')",
      scenarios: ['Several source or allocation cleanups fail.', 'Construction rollback must retain primary and cleanup failures.'],
      avoidWhen: ['Only one failure can be rethrown directly.', 'Original failure identity would be filtered or replaced.', 'The code is not registered for aggregate cleanup.'],
      options: [
        { name: 'code', description: 'Registered aggregate cleanup code.', defaultValue: 'required', optional: false, type: 'IStoreWasmErrorCode', whenToUse: 'Use cleanupFailed for multi-error ownership cleanup.', example: 'StoreWasmErrorCode.cleanupFailed' },
        { name: 'errors', description: 'Ordered original failures retained in AggregateError.errors.', defaultValue: 'required', optional: false, type: 'readonly unknown[]', whenToUse: 'Pass every primary and secondary cleanup failure.', example: 'failures' },
        { name: 'message', description: 'Stable aggregate summary.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Describe the boundary without flattening member errors.', example: "'WASM cleanup failed'" }
      ]
    },
    zh: {
      purpose: '创建带 canonical store-wasm identity 的原生 AggregateError，按顺序保留每个 cleanup 或 rollback failure。',
      quickStart: "throw createStoreWasmAggregateError(StoreWasmErrorCode.cleanupFailed, failures, 'WASM cleanup failed')",
      scenarios: ['多个 source 或 allocation cleanup 失败。', 'construction rollback 必须保留 primary 与 cleanup failure。'],
      avoidWhen: ['只有一个 failure，可以直接重抛。', '准备过滤或替换原始 failure identity。', 'code 未为 aggregate cleanup 注册。'],
      options: [
        { name: 'code', description: '已注册 aggregate cleanup code。', defaultValue: '必填', optional: false, type: 'IStoreWasmErrorCode', whenToUse: 'multi-error ownership cleanup 使用 cleanupFailed。', example: 'StoreWasmErrorCode.cleanupFailed' },
        { name: 'errors', description: '在 AggregateError.errors 中按顺序保留的原始 failure。', defaultValue: '必填', optional: false, type: 'readonly unknown[]', whenToUse: '传入每个 primary 与 secondary cleanup failure。', example: 'failures' },
        { name: 'message', description: '稳定 aggregate summary。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '描述边界，不把成员 error 压平成文本。', example: "'WASM cleanup failed'" }
      ]
    }
  },
  'store-worker:index:WorkerAdapter': {
    en: {
      purpose:
        'Owns the main-thread side of one exclusive Worker RPC channel. request sends typed payloads with per-call cancellation and transfer ownership; close rejects new work synchronously, while dispose is the sole asynchronous endpoint cleanup path.',
      quickStart:
        "const worker = new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' })\nconst adapter = new WorkerAdapter(worker, { timeoutMs: 5_000 })\n\ntry {\n  const result = await adapter.request<number[], number>([1, 2, 3])\n  console.log(result)\n} finally {\n  await adapter.dispose()\n  worker.terminate()\n}",
      scenarios: [
        'A CPU-heavy operation already has a dedicated Worker and needs typed request/response calls.',
        'Each request must support abort, timeout, or explicit transferable ownership.',
        'Several workerComputed Resources share one communication endpoint.'
      ],
      avoidWhen: [
        'The computation is smaller than structured-clone and message round-trip overhead.',
        'The topology has several providers or broadcast peers; this adapter deliberately owns one exclusive worker.',
        'Calling close is expected to release the endpoint or terminate the Worker; only awaited dispose releases the endpoint, and Worker termination remains caller-owned.'
      ],
      options: workerAdapterOptions.en
    },
    zh: {
      purpose:
        '拥有一条 exclusive Worker RPC channel 的主线程侧。request 发送带逐调用取消与 transfer ownership 的类型化 payload；close 同步拒绝新工作，dispose 才是唯一异步 endpoint cleanup 路径。',
      quickStart:
        "const worker = new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' })\nconst adapter = new WorkerAdapter(worker, { timeoutMs: 5_000 })\n\ntry {\n  const result = await adapter.request<number[], number>([1, 2, 3])\n  console.log(result)\n} finally {\n  await adapter.dispose()\n  worker.terminate()\n}",
      scenarios: [
        'CPU-heavy operation 已有专用 Worker，需要类型化 request/response 调用。',
        '每次 request 都要支持 abort、timeout 或显式 transferable ownership。',
        '多个 workerComputed Resource 共享同一通信 endpoint。'
      ],
      avoidWhen: [
        '计算成本低于 structured-clone 与消息往返开销。',
        'topology 包含多个 provider 或 broadcast peer；该 adapter 刻意只拥有一个 exclusive worker。',
        '期望 close 释放 endpoint 或 terminate Worker；只有 await dispose 会释放 endpoint，Worker termination 仍由调用方拥有。'
      ],
      options: workerAdapterOptions.zh
    }
  },
  'store-worker:index:createWorkerHandler': {
    en: {
      purpose:
        'Creates the worker-side managed RPC handler for ordinary computations. It converts incoming messages to one compute call, forwards cooperative cancellation, and returns a callable lifecycle object with close, dispose, pendingCount, and disposed.',
      quickStart:
        "const handler = createWorkerHandler(\n  async (numbers: number[], { signal }) => {\n    signal.throwIfAborted?.()\n    return numbers.reduce((sum, value) => sum + value, 0)\n  },\n  (message) => self.postMessage(message)\n)\n\nself.onmessage = (event) => void handler(event.data)\nself.addEventListener('close', () => void handler.dispose())",
      scenarios: [
        'A dedicated Worker exposes one ordinary compute(payload, { signal }) operation.',
        'Worker-side pending work and endpoint disposal need an observable managed lifecycle.',
        'Failures must return through WebRPC instead of becoming unhandled Worker errors.'
      ],
      avoidWhen: [
        'The operation is a serialize parser; use createSerializeWorkerHandler for streaming and byte ownership.',
        'The worker needs several unrelated RPC methods rather than the single call contract.',
        'The compute function ignores cancellation while holding expensive resources.'
      ],
      options: [
        { name: 'compute', description: 'Worker-owned computation invoked for each call with the decoded payload and cooperative signal.', defaultValue: 'required', optional: false, type: '(payload: Input, context: { signal: IWebRpcAbortSignal }) => Output | Promise<Output>', whenToUse: 'Implement the isolated operation and check signal at meaningful cancellation points.', example: 'createWorkerHandler((input, { signal }) => calculate(input, signal), post)' },
        { name: 'postMessage', description: 'Outbound message sink connected to the worker global scope or port.', defaultValue: 'required', optional: false, type: '(message: unknown) => void', whenToUse: 'Forward every protocol response to the paired main-thread port.', example: '(message) => self.postMessage(message)' },
        { name: 'options.timeoutMs', description: 'Provider-side timeout budget for accepted calls.', defaultValue: 'undefined', type: 'number', whenToUse: 'Bound computations even if the main-thread caller omitted its own timeout.', example: '{ timeoutMs: 10_000 }' }
      ]
    },
    zh: {
      purpose:
        '为普通计算创建 worker 侧 managed RPC handler。它把入站消息转换为一次 compute 调用，转发协作式取消，并返回带 close、dispose、pendingCount 与 disposed 的 callable lifecycle object。',
      quickStart:
        "const handler = createWorkerHandler(\n  async (numbers: number[], { signal }) => {\n    signal.throwIfAborted?.()\n    return numbers.reduce((sum, value) => sum + value, 0)\n  },\n  (message) => self.postMessage(message)\n)\n\nself.onmessage = (event) => void handler(event.data)\nself.addEventListener('close', () => void handler.dispose())",
      scenarios: [
        'dedicated Worker 暴露一个普通 compute(payload, { signal }) operation。',
        'worker 侧 pending work 与 endpoint disposal 需要可观察 managed lifecycle。',
        '失败必须经 WebRPC 返回，不能成为 unhandled Worker error。'
      ],
      avoidWhen: [
        'operation 是 serialize parser；streaming 与 byte ownership 应使用 createSerializeWorkerHandler。',
        'worker 需要多个互不相关的 RPC method，而不是单一 call contract。',
        'compute 忽略 cancellation，同时持有昂贵资源。'
      ],
      options: [
        { name: 'compute', description: '每次 call 使用 decoded payload 与 cooperative signal 调用的 worker-owned computation。', defaultValue: '必填', optional: false, type: '(payload: Input, context: { signal: IWebRpcAbortSignal }) => Output | Promise<Output>', whenToUse: '实现隔离 operation，并在有意义的取消点检查 signal。', example: 'createWorkerHandler((input, { signal }) => calculate(input, signal), post)' },
        { name: 'postMessage', description: '连接 worker global scope 或 port 的出站消息 sink。', defaultValue: '必填', optional: false, type: '(message: unknown) => void', whenToUse: '把每个 protocol response 转发到配对主线程 port。', example: '(message) => self.postMessage(message)' },
        { name: 'options.timeoutMs', description: 'accepted call 的 provider 侧 timeout budget。', defaultValue: 'undefined', type: 'number', whenToUse: '即使主线程调用方省略 timeout，也要限制 computation 时设置。', example: '{ timeoutMs: 10_000 }' }
      ]
    }
  },
  'store-worker:index:workerComputed': {
    en: {
      purpose:
        'Creates a Resource whose tracked input selection runs locally and whose asynchronous computation runs through WorkerAdapter. New reactive inputs supersede older generations; Resource owns cancellation, retry, freshness, cache, and observation lifecycle.',
      quickStart:
        "const filteredRows = workerComputed(\n  adapter,\n  () => ({ rows: rows.value, query: query.value }),\n  { runtime, staleWhileRevalidate: true, debugName: 'filtered-rows' }\n)\n\ntry {\n  const rows = await filteredRows.promise\n  render(rows)\n} finally {\n  filteredRows.dispose()\n  await adapter.dispose()\n}",
      scenarios: [
        'A heavy asynchronous derivation depends on Signal or Computed inputs.',
        'Superseded worker results must never overwrite a newer reactive generation.',
        'Worker calls need Resource retry, TTL, stale-while-revalidate, SSR snapshot, or scheduler semantics.'
      ],
      avoidWhen: [
        'The result is a small synchronous derivation; use Computed.',
        'selectInput returns a large object graph whose structured clone blocks the main thread.',
        'Transferred input must be reused after the request, retry, or cancellation.'
      ],
      options: workerComputedOptions.en
    },
    zh: {
      purpose:
        '创建一个 Resource：tracked input selection 在本地运行，异步 computation 经 WorkerAdapter 执行。新 reactive input 会 supersede 旧 generation；Resource 拥有 cancellation、retry、freshness、cache 与 observation lifecycle。',
      quickStart:
        "const filteredRows = workerComputed(\n  adapter,\n  () => ({ rows: rows.value, query: query.value }),\n  { runtime, staleWhileRevalidate: true, debugName: 'filtered-rows' }\n)\n\ntry {\n  const rows = await filteredRows.promise\n  render(rows)\n} finally {\n  filteredRows.dispose()\n  await adapter.dispose()\n}",
      scenarios: [
        'heavy asynchronous derivation 依赖 Signal 或 Computed 输入。',
        '被 supersede 的 worker result 绝不能覆盖更新的 reactive generation。',
        'Worker call 需要 Resource retry、TTL、stale-while-revalidate、SSR snapshot 或 scheduler 语义。'
      ],
      avoidWhen: [
        '结果是小型同步派生；应使用 Computed。',
        'selectInput 返回大型 object graph，其 structured clone 会阻塞主线程。',
        'transfer 后仍需在 request、retry 或 cancellation 之后复用输入。'
      ],
      options: workerComputedOptions.zh
    }
  },
  'store-worker:serialize:workerParser': {
    en: {
      purpose:
        'Creates the main-thread Serialize parser that offloads encode and decode to one Worker. Encode streams use explicit credits for bounded backpressure; byte transfer is opt-in and destructive, while copy remains the safe default.',
      quickStart:
        "const worker = new Worker(new URL('./serialize.worker.ts', import.meta.url), { type: 'module' })\nconst parser = workerParser({ worker, type: 'msgpack-worker', ownership: 'copy' })\n\ntry {\n  const chunks = await parser.encode(value, context)\n  for await (const chunk of chunks) await sink.write(chunk)\n} finally {\n  await parser.dispose?.()\n  worker.terminate()\n}",
      scenarios: [
        'Encoding produces bytes consumed by persistence or transport without rebuilding a large object graph on the main thread.',
        'Streaming encode output needs bounded producer credits and consumer-driven cancellation.',
        'An exclusively owned full Uint8Array can move zero-copy to the Worker.'
      ],
      avoidWhen: [
        'A large object graph must first be structured-cloned into the Worker; that clone still blocks the caller thread.',
        'Decoded objects must immediately return to the main thread and erase most offload benefit.',
        'Transferred bytes must survive abort, worker crash, retry, or later caller reads.'
      ],
      options: workerParserOptions.en
    },
    zh: {
      purpose:
        '创建把 encode 与 decode 卸载到一个 Worker 的主线程 Serialize parser。encode stream 使用显式 credit 实现有界 backpressure；byte transfer 是破坏性 opt-in，copy 仍是安全默认值。',
      quickStart:
        "const worker = new Worker(new URL('./serialize.worker.ts', import.meta.url), { type: 'module' })\nconst parser = workerParser({ worker, type: 'msgpack-worker', ownership: 'copy' })\n\ntry {\n  const chunks = await parser.encode(value, context)\n  for await (const chunk of chunks) await sink.write(chunk)\n} finally {\n  await parser.dispose?.()\n  worker.terminate()\n}",
      scenarios: [
        'encode 生成的 bytes 直接进入 persistence 或 transport，不需要在主线程重建大型 object graph。',
        'streaming encode output 需要有界 producer credit 与 consumer-driven cancellation。',
        '独占且覆盖完整 buffer 的 Uint8Array 可以零拷贝移交 Worker。'
      ],
      avoidWhen: [
        '大型 object graph 必须先 structured-clone 进 Worker；该 clone 仍会阻塞调用线程。',
        'decoded object 必须立即返回主线程，抵消大部分 offload 收益。',
        'transfer 的 bytes 在 abort、worker crash、retry 或后续读取后仍必须存在。'
      ],
      options: workerParserOptions.zh
    }
  },
  'store-worker:serialize:workerPlugin': {
    en: {
      purpose:
        'Wraps workerParser as a Serialize plugin whose type equals the resolved parser name. It adds registry shape only; transport, ownership, streaming, and disposal semantics remain exactly those of workerParser.',
      quickStart:
        "const plugin = workerPlugin({ worker, type: 'msgpack-worker', ownership: 'copy' })\nserializer.use(plugin)\n\ntry {\n  await serializer.encode('msgpack-worker', value)\n} finally {\n  await plugin.parser.dispose?.()\n}",
      scenarios: ['A Serialize registry needs a named Worker-backed parser plugin.', 'Existing composition accepts ISerializePlugin rather than a bare parser.', 'The same workerParser options must remain visible at installation.'],
      avoidWhen: ['A bare parser is sufficient.', 'The wrapper is expected to add retry, fallback, or Worker ownership.', 'A plugin type different from parser.name is required.'],
      options: workerParserOptions.en
    },
    zh: {
      purpose:
        '把 workerParser 包成 Serialize plugin，plugin type 等于解析后的 parser name。它只增加 registry shape；transport、ownership、streaming 与 disposal 语义完全沿用 workerParser。',
      quickStart:
        "const plugin = workerPlugin({ worker, type: 'msgpack-worker', ownership: 'copy' })\nserializer.use(plugin)\n\ntry {\n  await serializer.encode('msgpack-worker', value)\n} finally {\n  await plugin.parser.dispose?.()\n}",
      scenarios: ['Serialize registry 需要具名 Worker-backed parser plugin。', '现有组合只接受 ISerializePlugin，而不是 bare parser。', '安装时仍需显式展示全部 workerParser options。'],
      avoidWhen: ['bare parser 已足够。', '期望 wrapper 新增 retry、fallback 或 Worker ownership。', '要求 plugin type 与 parser.name 不同。'],
      options: workerParserOptions.zh
    }
  },
  'store-worker:serialize:createSerializeWorkerHandler': {
    en: {
      purpose:
        'Creates the Worker-side managed endpoint for a Serialize parser. Decode returns one response; encode may stream ordered frames under a two-credit producer window, with acknowledgements, cancellation, iterator.return cleanup, and transfer-aware byte replies.',
      quickStart:
        "const handler = createSerializeWorkerHandler(\n  msgpackParser,\n  (message, transfer) => self.postMessage(message, transfer as Transferable[])\n)\n\nself.onmessage = (event) => void handler(event.data)\nself.addEventListener('close', () => void handler.dispose())",
      scenarios: ['A Worker hosts one concrete Serialize parser for a paired workerParser client.', 'Encoder output may be sync iterable, async iterable, or one chunk.', 'Backpressure and cancellation must bound producer memory and close the iterator.'],
      avoidWhen: ['The Worker performs ordinary compute requests; use createWorkerHandler.', 'post cannot preserve the supplied transfer list.', 'The parser ignores cancellation and iterator.return cleanup.'],
      options: [
        { name: 'parser', description: 'Worker-owned Serialize parser with callable encode and decode methods.', defaultValue: 'required', optional: false, type: 'ISerializeParser', whenToUse: 'Install the codec matching the main-side plugin type.', example: 'createSerializeWorkerHandler(msgpackParser, post)' },
        { name: 'post', description: 'Outbound message sink that must forward the optional transfer list.', defaultValue: 'required', optional: false, type: '(message: unknown, transfer?: readonly Transferable[]) => void', whenToUse: 'Connect protocol frames and zero-copy byte responses to the Worker port.', example: '(message, transfer) => self.postMessage(message, transfer as Transferable[])' }
      ]
    },
    zh: {
      purpose:
        '为 Serialize parser 创建 Worker 侧 managed endpoint。decode 返回单一 response；encode 可在双 credit producer window 下发送有序 frame，并处理 acknowledgement、cancellation、iterator.return cleanup 与 transfer-aware byte reply。',
      quickStart:
        "const handler = createSerializeWorkerHandler(\n  msgpackParser,\n  (message, transfer) => self.postMessage(message, transfer as Transferable[])\n)\n\nself.onmessage = (event) => void handler(event.data)\nself.addEventListener('close', () => void handler.dispose())",
      scenarios: ['Worker 为配对 workerParser client 托管一个具体 Serialize parser。', 'encoder output 可以是 sync iterable、async iterable 或单一 chunk。', 'backpressure 与 cancellation 必须限制 producer memory 并关闭 iterator。'],
      avoidWhen: ['Worker 执行普通 compute request；应使用 createWorkerHandler。', 'post 不能保留传入的 transfer list。', 'parser 忽略 cancellation 与 iterator.return cleanup。'],
      options: [
        { name: 'parser', description: '拥有 callable encode 与 decode method 的 worker-owned Serialize parser。', defaultValue: '必填', optional: false, type: 'ISerializeParser', whenToUse: '安装与主线程 plugin type 匹配的 codec。', example: 'createSerializeWorkerHandler(msgpackParser, post)' },
        { name: 'post', description: '必须转发可选 transfer list 的出站消息 sink。', defaultValue: '必填', optional: false, type: '(message: unknown, transfer?: readonly Transferable[]) => void', whenToUse: '把 protocol frame 与零拷贝 byte response 连接到 Worker port。', example: '(message, transfer) => self.postMessage(message, transfer as Transferable[])' }
      ]
    }
  },
  'store-worker:serialize:encodeWorkerValue': {
    en: {
      purpose: 'Brands a worker input as a Serialize value or byte chunk without copying its payload. Uint8Array keeps byte identity so transfer policy can inspect its backing buffer.',
      quickStart: "const chunk = encodeWorkerValue(bytes)\n// ['bytes', bytes] for Uint8Array; otherwise ['value', input]",
      scenarios: ['A custom Worker serializer must use the canonical Serialize chunk shape.', 'Uint8Array identity must remain available for transfer-list construction.'],
      avoidWhen: ['The value is already a valid ISerializeChunk.', 'Deep validation, cloning, or encoding is expected; this helper only applies the chunk brand.'],
      options: [{ name: 'value', description: 'Input payload wrapped as bytes for Uint8Array and value otherwise.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Normalize a custom worker request into the canonical chunk union.', example: 'encodeWorkerValue(bytes)' }]
    },
    zh: {
      purpose: '把 worker input 标记为 Serialize value 或 byte chunk，不复制 payload。Uint8Array 保持 byte identity，供 transfer policy 检查 backing buffer。',
      quickStart: "const chunk = encodeWorkerValue(bytes)\n// Uint8Array 得到 ['bytes', bytes]；其他输入得到 ['value', input]",
      scenarios: ['自定义 Worker serializer 必须使用 canonical Serialize chunk shape。', '必须保留 Uint8Array identity 以构建 transfer list。'],
      avoidWhen: ['值已经是合法 ISerializeChunk。', '期望 deep validation、clone 或真正编码；该 helper 只施加 chunk brand。'],
      options: [{ name: 'value', description: 'Uint8Array 包为 bytes，其余输入包为 value 的 payload。', defaultValue: '必填', optional: false, type: 'unknown', whenToUse: '把自定义 worker request 规整成 canonical chunk union。', example: 'encodeWorkerValue(bytes)' }]
    }
  },
  'store-worker:serialize:decodeWorkerValue': {
    en: {
      purpose: 'Brands one Worker decode result as a canonical Serialize byte or value chunk while preserving byte payload identity for zero-copy replies.',
      quickStart: "const result = await parser.decode(chunk, context)\nconst responseChunk = decodeWorkerValue(result)",
      scenarios: ['A custom worker-side handler returns parser.decode output through Serialize transport.', 'Byte output should remain eligible for transfer back to the caller.'],
      avoidWhen: ['The result is already a canonical chunk.', 'The caller expects validation or conversion beyond Uint8Array discrimination.'],
      options: [{ name: 'value', description: 'Decoded payload classified as bytes for Uint8Array and value otherwise.', defaultValue: 'required', optional: false, type: 'unknown', whenToUse: 'Normalize a worker decode result before protocol delivery.', example: 'decodeWorkerValue(decoded)' }]
    },
    zh: {
      purpose: '把一项 Worker decode result 标记为 canonical Serialize byte 或 value chunk，同时保留 byte payload identity 供零拷贝回包。',
      quickStart: "const result = await parser.decode(chunk, context)\nconst responseChunk = decodeWorkerValue(result)",
      scenarios: ['自定义 worker 侧 handler 通过 Serialize transport 返回 parser.decode output。', 'byte output 应保持可 transfer 回调用方。'],
      avoidWhen: ['结果已经是 canonical chunk。', '调用方期望 Uint8Array 判别之外的 validation 或 conversion。'],
      options: [{ name: 'value', description: 'Uint8Array 分类为 bytes，其余 decoded payload 分类为 value。', defaultValue: '必填', optional: false, type: 'unknown', whenToUse: 'protocol delivery 前规整 worker decode result。', example: 'decodeWorkerValue(decoded)' }]
    }
  },
  'store-worker:serialize:transferablesOf': {
    en: {
      purpose: 'Returns a transfer list only for transfer ownership plus a byte chunk backed by an exclusive full ArrayBuffer. Slices, SharedArrayBuffer, value chunks, and copy mode return an empty list.',
      quickStart: "const transfer = transferablesOf(chunk, WorkerByteOwnership.transfer)\npostMessage(message, transfer)",
      scenarios: ['A custom worker protocol needs the same conservative byte-transfer rule.', 'A full-buffer Uint8Array is exclusively owned and may detach.'],
      avoidWhen: ['The view is a subarray or shares aliases over the same buffer.', 'SharedArrayBuffer is involved; it is shared, not transferable.', 'The sender must retain readable bytes.'],
      options: [
        { name: 'chunk', description: 'Canonical Serialize chunk inspected for byte kind, Uint8Array payload, and full-buffer coverage.', defaultValue: 'required', optional: false, type: 'ISerializeChunk', whenToUse: 'Pass the exact outbound chunk whose ownership is changing.', example: 'transferablesOf(chunk, ownership)' },
        { name: 'ownership', description: 'Explicit copy or transfer policy; only transfer can produce a non-empty list.', defaultValue: 'required', optional: false, type: 'IByteOwnership', whenToUse: 'Keep copy as the default and opt into destructive ownership movement explicitly.', example: 'WorkerByteOwnership.transfer' }
      ]
    },
    zh: {
      purpose: '只有 transfer ownership 与独占完整 ArrayBuffer 支撑的 byte chunk 同时成立时才返回 transfer list。slice、SharedArrayBuffer、value chunk 与 copy mode 都返回空数组。',
      quickStart: "const transfer = transferablesOf(chunk, WorkerByteOwnership.transfer)\npostMessage(message, transfer)",
      scenarios: ['自定义 worker protocol 需要复用同一保守 byte-transfer 规则。', 'full-buffer Uint8Array 独占且允许 detach。'],
      avoidWhen: ['view 是 subarray，或同一 buffer 存在其他 alias。', '使用 SharedArrayBuffer；它是 shared，不可 transfer。', '发送方必须继续读取 bytes。'],
      options: [
        { name: 'chunk', description: '检查 byte kind、Uint8Array payload 与完整 buffer coverage 的 canonical Serialize chunk。', defaultValue: '必填', optional: false, type: 'ISerializeChunk', whenToUse: '传入 ownership 即将变化的准确 outbound chunk。', example: 'transferablesOf(chunk, ownership)' },
        { name: 'ownership', description: '显式 copy 或 transfer policy；只有 transfer 可能产生非空列表。', defaultValue: '必填', optional: false, type: 'IByteOwnership', whenToUse: '默认保留 copy，只显式 opt in 破坏性 ownership movement。', example: 'WorkerByteOwnership.transfer' }
      ]
    }
  },
  'store-worker:index:createStoreWorkerError': {
    en: {
      purpose: 'Creates a native Error carrying canonical store-worker source/code identity and an optional original cause for adapter extensions.',
      quickStart: "throw createStoreWorkerError(StoreWorkerErrorCode.invalidOption, 'invalid worker option', { cause })",
      scenarios: ['A custom adapter extends the same public error boundary.', 'A lower-level transport failure must remain reachable as cause.'],
      avoidWhen: ['A built-in API already emits the canonical error.', 'The condition is normal state rather than an exception.', 'No registered code matches the scenario.'],
      options: [
        { name: 'code', description: 'Registered semantic store-worker error code.', defaultValue: 'required', optional: false, type: 'IStoreWorkerErrorCode', whenToUse: 'Classify the exact adapter-owned failure.', example: 'StoreWorkerErrorCode.invalidOption' },
        { name: 'message', description: 'Stable caller-owned diagnostic text without secrets.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Explain the failed invariant.', example: "'invalid worker option'" },
        { name: 'options.cause', description: 'Original failure retained through Error.cause.', defaultValue: 'undefined', type: 'unknown', whenToUse: 'Wrap transport or option-access failure without erasing identity.', example: '{ cause }' }
      ]
    },
    zh: {
      purpose: '为 adapter extension 创建带 canonical store-worker source/code identity 与可选原始 cause 的原生 Error。',
      quickStart: "throw createStoreWorkerError(StoreWorkerErrorCode.invalidOption, 'invalid worker option', { cause })",
      scenarios: ['自定义 adapter 扩展同一公开错误边界。', '底层 transport failure 必须通过 cause 保持可达。'],
      avoidWhen: ['内建 API 已经产生 canonical error。', '该条件是正常 state 而非异常。', '没有已注册 code 匹配场景。'],
      options: [
        { name: 'code', description: '已注册的语义 store-worker error code。', defaultValue: '必填', optional: false, type: 'IStoreWorkerErrorCode', whenToUse: '精确分类 adapter-owned failure。', example: 'StoreWorkerErrorCode.invalidOption' },
        { name: 'message', description: '不含 secret 的稳定 caller-owned 诊断文本。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '解释失败 invariant。', example: "'invalid worker option'" },
        { name: 'options.cause', description: '通过 Error.cause 保留的原始失败。', defaultValue: 'undefined', type: 'unknown', whenToUse: '包装 transport 或 option-access failure 且不抹除 identity。', example: '{ cause }' }
      ]
    }
  },
  'store-worker:index:createStoreWorkerAggregateError': {
    en: {
      purpose: 'Creates a native AggregateError with canonical store-worker identity while retaining every cleanup failure in order.',
      quickStart: "throw createStoreWorkerAggregateError(StoreWorkerErrorCode.cleanupFailed, failures, 'worker cleanup failed')",
      scenarios: ['Endpoint disposal and owned Worker termination both fail.', 'Rollback must preserve all independent cleanup failures.'],
      avoidWhen: ['Only one failure exists and can be rethrown directly.', 'Original failures would be filtered or replaced.', 'The code is not registered for aggregate cleanup failure.'],
      options: [
        { name: 'code', description: 'Registered aggregate cleanup code.', defaultValue: 'required', optional: false, type: 'IStoreWorkerErrorCode', whenToUse: 'Use cleanupFailed for concurrent disposal failures.', example: 'StoreWorkerErrorCode.cleanupFailed' },
        { name: 'errors', description: 'Ordered original failures retained in AggregateError.errors.', defaultValue: 'required', optional: false, type: 'readonly unknown[]', whenToUse: 'Pass every endpoint and ownership cleanup failure.', example: 'failures' },
        { name: 'message', description: 'Stable aggregate summary.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Describe the boundary without flattening member errors.', example: "'worker cleanup failed'" }
      ]
    },
    zh: {
      purpose: '创建带 canonical store-worker identity 的原生 AggregateError，按顺序保留每个 cleanup failure。',
      quickStart: "throw createStoreWorkerAggregateError(StoreWorkerErrorCode.cleanupFailed, failures, 'worker cleanup failed')",
      scenarios: ['endpoint disposal 与 owned Worker termination 同时失败。', 'rollback 必须保留全部独立 cleanup failure。'],
      avoidWhen: ['只有一个 failure，可直接重抛。', '准备过滤或替换原始 failure。', 'code 未为 aggregate cleanup failure 注册。'],
      options: [
        { name: 'code', description: '已注册 aggregate cleanup code。', defaultValue: '必填', optional: false, type: 'IStoreWorkerErrorCode', whenToUse: '并发 disposal failure 使用 cleanupFailed。', example: 'StoreWorkerErrorCode.cleanupFailed' },
        { name: 'errors', description: '在 AggregateError.errors 中按顺序保留的原始 failure。', defaultValue: '必填', optional: false, type: 'readonly unknown[]', whenToUse: '传入每个 endpoint 与 ownership cleanup failure。', example: 'failures' },
        { name: 'message', description: '稳定 aggregate summary。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '描述边界，不把成员错误压平成文本。', example: "'worker cleanup failed'" }
      ]
    }
  },
  'store-devtools:index:createStoreDevTools': {
    en: {
      purpose:
        'Creates one bounded diagnostic session for a Reactive Store: immutable state snapshots, completed actions, raw Runtime trace, and explicit time travel. The caller owns disposal and should normally construct it only in a development or opt-in diagnostics path.',
      quickStart:
        "const tools = import.meta.env.DEV\n  ? createStoreDevTools(counterStore, { maxHistory: 100, maxTrace: 1_000 })\n  : undefined\n\ntry {\n  counterStore.increment()\n  const beforeReset = tools?.record('before-reset')\n  if (beforeReset) tools?.jumpTo(beforeReset.id)\n} finally {\n  tools?.dispose()\n}",
      scenarios: [
        'Explain which Store snapshot followed a user action and inspect the corresponding Runtime trace.',
        'Replay a still-retained plain-state snapshot while debugging deterministic Store behavior.',
        'Capture a bounded diagnostic window without exposing mutable internal queues.'
      ],
      avoidWhen: [
        'The session would run unconditionally in a hot production path without a measured snapshot and trace budget.',
        'Time travel is expected to restore computed values, WASM state, network effects, timers, or other external resources; jumpTo only hydrates plain Store fields.',
        'The owner cannot call dispose; subscriptions would otherwise remain attached for the Store lifetime.'
      ],
      options: storeDevToolsOptions.en
    },
    zh: {
      purpose:
        '为 Reactive Store 创建一段有界诊断会话：不可变状态快照、已完成 action、原始 Runtime trace 与显式时间旅行。调用方拥有 dispose，通常只应在开发环境或主动开启的诊断路径创建。',
      quickStart:
        "const tools = import.meta.env.DEV\n  ? createStoreDevTools(counterStore, { maxHistory: 100, maxTrace: 1_000 })\n  : undefined\n\ntry {\n  counterStore.increment()\n  const beforeReset = tools?.record('before-reset')\n  if (beforeReset) tools?.jumpTo(beforeReset.id)\n} finally {\n  tools?.dispose()\n}",
      scenarios: [
        '解释某次用户 action 之后出现了哪份 Store snapshot，并查看对应 Runtime trace。',
        '调试确定性 Store 行为时，回放仍在保留窗口内的 plain-state snapshot。',
        '在不泄露内部可变队列的前提下保留有界诊断窗口。'
      ],
      avoidWhen: [
        '未测量 snapshot 与 trace 预算，就在生产 hot path 无条件长期运行。',
        '期望时间旅行恢复 computed、WASM 状态、网络副作用、timer 或外部资源；jumpTo 只 hydrate plain Store 字段。',
        'owner 无法调用 dispose；否则订阅会一直附着到 Store 生命周期结束。'
      ],
      options: storeDevToolsOptions.zh
    }
  },
  'store-devtools:index:getDependencyTree': {
    en: {
      purpose:
        'Builds a bounded upstream tree from an Effect or Computed observer to the observables it reads. Circular marks only a node revisited on the current path, so a shared diamond is expanded on each legitimate branch.',
      quickStart:
        "const upstream = getDependencyTree(totalEffect, 5)\nconsole.table(upstream.children.map(({ label, version }) => ({ label, version })))",
      scenarios: [
        'Explain why an Effect or Computed reran by inspecting its current upstream dependencies.',
        'Render a diagnostic tree with explicit depth and circular boundaries.'
      ],
      avoidWhen: [
        'A durable graph snapshot is required; the returned tree reflects current node relationships only.',
        'A high-fanout graph would be traversed repeatedly on a hot path; this allocates a projected tree per call.'
      ],
      options: [
        { name: 'observer', description: 'Effect or Computed graph node whose upstream reads form the root.', defaultValue: 'required', optional: false, type: 'IObserver', whenToUse: 'Start from the computation whose recomputation needs explanation.', example: 'getDependencyTree(totalEffect)' },
        { name: 'maxDepth', description: 'Non-negative safe-integer edge depth. Zero returns only the root; the default caps accidental unbounded traversal.', defaultValue: '20', type: 'number', whenToUse: 'Use the smallest depth that answers the diagnostic question.', example: 'getDependencyTree(totalEffect, 5)' }
      ]
    },
    zh: {
      purpose:
        '从 Effect 或 Computed observer 向上构建有界依赖树，展示它读取的 observable。circular 只标记当前路径上的重复节点，因此合法菱形共享会在每条分支各自展开。',
      quickStart:
        "const upstream = getDependencyTree(totalEffect, 5)\nconsole.table(upstream.children.map(({ label, version }) => ({ label, version })))",
      scenarios: ['解释 Effect 或 Computed 为何重跑，检查其当前上游依赖。', '以明确 depth 与 circular 边界渲染诊断树。'],
      avoidWhen: ['需要持久图快照；返回树只反映调用时的节点关系。', '准备在高 fan-out 图的 hot path 反复遍历；每次调用都会分配一棵投影树。'],
      options: [
        { name: 'observer', description: '作为根节点的 Effect 或 Computed 图节点，其上游读取组成结果树。', defaultValue: '必填', optional: false, type: 'IObserver', whenToUse: '从需要解释重算原因的 computation 开始。', example: 'getDependencyTree(totalEffect)' },
        { name: 'maxDepth', description: '非负安全整数 edge depth；0 只返回根，默认值限制意外无界遍历。', defaultValue: '20', type: 'number', whenToUse: '使用足以回答诊断问题的最小深度。', example: 'getDependencyTree(totalEffect, 5)' }
      ]
    }
  },
  'store-devtools:index:getObserverTree': {
    en: {
      purpose:
        'Builds the opposite bounded projection: from a Signal or Computed observable to downstream observers that currently subscribe to it.',
      quickStart:
        "const downstream = getObserverTree(accountSignal, 4)\nconsole.table(downstream.children.map(({ label, kind }) => ({ label, kind })))",
      scenarios: ['Find which Effects or Computed values a Signal change can invalidate.', 'Inspect downstream fan-out before optimizing a frequently updated value.'],
      avoidWhen: ['The caller needs historical subscriptions; disconnected observers are intentionally absent.', 'The projection would be rebuilt for every write instead of on demand for diagnostics.'],
      options: [
        { name: 'observable', description: 'Signal or Computed graph node whose current subscribers form the root.', defaultValue: 'required', optional: false, type: 'IObservable', whenToUse: 'Start from the value whose downstream impact needs explanation.', example: 'getObserverTree(accountSignal)' },
        { name: 'maxDepth', description: 'Non-negative safe-integer edge depth; zero keeps only the observable root.', defaultValue: '20', type: 'number', whenToUse: 'Bound allocation and traversal for wide or cyclic graphs.', example: 'getObserverTree(accountSignal, 4)' }
      ]
    },
    zh: {
      purpose: '构建相反方向的有界投影：从 Signal 或 Computed observable 出发，查看当前订阅它的下游 observer。',
      quickStart:
        "const downstream = getObserverTree(accountSignal, 4)\nconsole.table(downstream.children.map(({ label, kind }) => ({ label, kind })))",
      scenarios: ['查明 Signal 变化可能让哪些 Effect 或 Computed 失效。', '优化高频更新值之前检查下游 fan-out。'],
      avoidWhen: ['需要历史订阅；已经断开的 observer 刻意不会出现。', '准备在每次写入时重建投影，而不是按需诊断。'],
      options: [
        { name: 'observable', description: '作为根节点的 Signal 或 Computed 图节点，其当前 subscriber 组成结果树。', defaultValue: '必填', optional: false, type: 'IObservable', whenToUse: '从需要解释下游影响的值开始。', example: 'getObserverTree(accountSignal)' },
        { name: 'maxDepth', description: '非负安全整数 edge depth；0 只保留 observable 根节点。', defaultValue: '20', type: 'number', whenToUse: '为宽图或环图限制 allocation 与 traversal。', example: 'getObserverTree(accountSignal, 4)' }
      ]
    }
  },
  'store-devtools:index:createStoreDevtoolsError': {
    en: {
      purpose:
        'Creates a native Error tagged with the canonical store-devtools source and a registered semantic code, optionally retaining the original failure as cause. It is an adapter boundary tool, not the normal way to report diagnostic state.',
      quickStart:
        "try {\n  connectDiagnosticSink()\n} catch (cause) {\n  throw createStoreDevtoolsError(\n    StoreDevtoolsErrorCode.invalidOption,\n    'diagnostic sink configuration is invalid',\n    { cause }\n  )\n}",
      scenarios: ['A custom diagnostic adapter must preserve the same source/code boundary.', 'A lower-level failure must remain reachable through Error.cause.'],
      avoidWhen: ['A built-in operation already throws the canonical error.', 'The condition is a normal diagnostic state rather than an exception.', 'No registered StoreDevtoolsErrorCode describes the failure.'],
      options: [
        { name: 'code', description: 'Registered semantic code attached without replacing native Error identity or stack.', defaultValue: 'required', optional: false, type: 'IStoreDevtoolsErrorCode', whenToUse: 'Classify the exact adapter-owned failure.', example: 'StoreDevtoolsErrorCode.invalidOption' },
        { name: 'message', description: 'Stable caller-owned diagnostic text.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Explain the failed invariant without embedding secrets.', example: "'diagnostic sink configuration is invalid'" },
        { name: 'options.cause', description: 'Original thrown value retained as Error.cause.', defaultValue: 'undefined', type: 'unknown', whenToUse: 'Wrap a lower-level failure without losing its identity.', example: '{ cause }' }
      ]
    },
    zh: {
      purpose: '创建带 canonical store-devtools source 与已注册语义 code 的原生 Error，并可通过 cause 保留原始失败。它用于 adapter 错误边界，不用于表示普通诊断状态。',
      quickStart:
        "try {\n  connectDiagnosticSink()\n} catch (cause) {\n  throw createStoreDevtoolsError(\n    StoreDevtoolsErrorCode.invalidOption,\n    'diagnostic sink configuration is invalid',\n    { cause }\n  )\n}",
      scenarios: ['自定义诊断 adapter 必须维持同一 source/code 边界。', '底层失败必须通过 Error.cause 保持可达。'],
      avoidWhen: ['内建操作已经抛出 canonical error。', '该条件是普通诊断状态而不是异常。', '没有已注册 StoreDevtoolsErrorCode 描述该失败。'],
      options: [
        { name: 'code', description: '不替换 native Error identity 或 stack 而附加的已注册语义 code。', defaultValue: '必填', optional: false, type: 'IStoreDevtoolsErrorCode', whenToUse: '精确分类 adapter 拥有的失败。', example: 'StoreDevtoolsErrorCode.invalidOption' },
        { name: 'message', description: '稳定的 caller-owned 诊断文本。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '解释失败 invariant，且不得嵌入 secret。', example: "'diagnostic sink configuration is invalid'" },
        { name: 'options.cause', description: '保留为 Error.cause 的原始抛出值。', defaultValue: 'undefined', type: 'unknown', whenToUse: '包装底层失败且不丢失其 identity。', example: '{ cause }' }
      ]
    }
  },
  'store-devtools:index:createStoreDevtoolsRangeError': {
    en: {
      purpose: 'Creates a native RangeError with canonical store-devtools source/code identity for caller-owned numeric diagnostic validation.',
      quickStart:
        "if (!Number.isSafeInteger(depth) || depth < 0) {\n  throw createStoreDevtoolsRangeError(\n    StoreDevtoolsErrorCode.invalidOption,\n    'depth must be a non-negative safe integer'\n  )\n}",
      scenarios: ['An adapter validates a depth, retained id, or numeric diagnostic bound.', 'Consumers branch on both native RangeError and semantic code.'],
      avoidWhen: ['The failure is not a numeric range violation.', 'An existing store-devtools operation already performs the validation.', 'A new inline code would be required.'],
      options: [
        { name: 'code', description: 'Registered semantic code for the range failure.', defaultValue: 'required', optional: false, type: 'IStoreDevtoolsErrorCode', whenToUse: 'Select the existing code matching the validation boundary.', example: 'StoreDevtoolsErrorCode.invalidOption' },
        { name: 'message', description: 'Stable text stating the rejected numeric invariant.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Tell the caller which bound failed.', example: "'depth must be a non-negative safe integer'" }
      ]
    },
    zh: {
      purpose: '为调用方拥有的数值诊断校验创建带 canonical store-devtools source/code identity 的原生 RangeError。',
      quickStart:
        "if (!Number.isSafeInteger(depth) || depth < 0) {\n  throw createStoreDevtoolsRangeError(\n    StoreDevtoolsErrorCode.invalidOption,\n    'depth must be a non-negative safe integer'\n  )\n}",
      scenarios: ['adapter 校验 depth、保留 id 或数值诊断上限。', 'consumer 同时按 native RangeError 与语义 code 分支。'],
      avoidWhen: ['失败不是数值范围违规。', '既有 store-devtools 操作已经执行该校验。', '需要内联发明新 code。'],
      options: [
        { name: 'code', description: '该 range failure 的已注册语义 code。', defaultValue: '必填', optional: false, type: 'IStoreDevtoolsErrorCode', whenToUse: '选择与校验边界匹配的既有 code。', example: 'StoreDevtoolsErrorCode.invalidOption' },
        { name: 'message', description: '说明被拒绝数值 invariant 的稳定文本。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '告诉调用方哪个 bound 失败。', example: "'depth must be a non-negative safe integer'" }
      ]
    }
  },
  'store-devtools:index:createStoreDevtoolsAggregateError': {
    en: {
      purpose: 'Creates a native AggregateError tagged with canonical store-devtools identity while preserving every supplied cleanup failure in order.',
      quickStart:
        "if (cleanupErrors.length > 1) {\n  throw createStoreDevtoolsAggregateError(\n    StoreDevtoolsErrorCode.cleanupFailed,\n    cleanupErrors,\n    'diagnostic cleanup failed'\n  )\n}",
      scenarios: ['Several independently owned diagnostic cleanups fail during one rollback or disposal.', 'Every original failure must remain reachable through AggregateError.errors.'],
      avoidWhen: ['There is only one failure and its native identity can be rethrown directly.', 'The caller wants to discard, deduplicate, or replace original failures.', 'The code is not registered for an aggregate scenario.'],
      options: [
        { name: 'code', description: 'Registered aggregate-failure code.', defaultValue: 'required', optional: false, type: 'IStoreDevtoolsErrorCode', whenToUse: 'Use cleanupFailed for multi-cleanup failure.', example: 'StoreDevtoolsErrorCode.cleanupFailed' },
        { name: 'errors', description: 'Ordered original failures retained unchanged by AggregateError.', defaultValue: 'required', optional: false, type: 'readonly unknown[]', whenToUse: 'Pass every independent failure, including the primary one when constructing rollback evidence.', example: 'cleanupErrors' },
        { name: 'message', description: 'Stable summary for the aggregate boundary.', defaultValue: 'required', optional: false, type: 'string', whenToUse: 'Describe the aggregate without flattening its members into text.', example: "'diagnostic cleanup failed'" }
      ]
    },
    zh: {
      purpose: '创建带 canonical store-devtools identity 的原生 AggregateError，并按顺序保留传入的每个 cleanup failure。',
      quickStart:
        "if (cleanupErrors.length > 1) {\n  throw createStoreDevtoolsAggregateError(\n    StoreDevtoolsErrorCode.cleanupFailed,\n    cleanupErrors,\n    'diagnostic cleanup failed'\n  )\n}",
      scenarios: ['一次 rollback 或 dispose 中多个独立诊断 cleanup 同时失败。', '每个原始失败都必须通过 AggregateError.errors 保持可达。'],
      avoidWhen: ['只有一个失败且可以直接重抛其 native identity。', '调用方准备丢弃、去重或替换原始失败。', 'code 未为 aggregate 场景注册。'],
      options: [
        { name: 'code', description: '已注册 aggregate-failure code。', defaultValue: '必填', optional: false, type: 'IStoreDevtoolsErrorCode', whenToUse: '多个 cleanup 失败时使用 cleanupFailed。', example: 'StoreDevtoolsErrorCode.cleanupFailed' },
        { name: 'errors', description: '由 AggregateError 原样按顺序保留的原始失败。', defaultValue: '必填', optional: false, type: 'readonly unknown[]', whenToUse: '传入每个独立失败；构造 rollback 证据时也应包含 primary failure。', example: 'cleanupErrors' },
        { name: 'message', description: 'aggregate 边界的稳定摘要。', defaultValue: '必填', optional: false, type: 'string', whenToUse: '描述整体失败，不要把成员压平成文本。', example: "'diagnostic cleanup failed'" }
      ]
    }
  },
  'store-shared:index:sharedInt32': {
    en: {
      purpose:
        'Creates the recommended realm-local reactive view over one shared signed int32. Local reads participate in Reactive tracking while explicit sync or watch imports remote writes from the same ABI buffer.',
      quickStart:
        "const runtime = createRuntime()\nconst counter = sharedInt32(runtime, 0)\nconst stop = counter.watch()\n\nconst effect = new Effect(runtime, () => {\n  console.log(counter.value)\n})\neffect.start()\n\ntry {\n  counter.value += 1\n  worker.postMessage({ buffer: counter.buffer })\n} finally {\n  stop()\n  effect.dispose()\n  counter.dispose()\n}",
      scenarios: [
        'A counter, flag, cursor, or state code must be shared across workers or realms.',
        'Realm-local Effects should track reads and rerun when remote writes are synchronized.',
        'The same SharedArrayBuffer needs a separate Runtime-owned view in each realm.'
      ],
      avoidWhen: [
        'The value is not a signed int32 or requires object identity.',
        'The browser is not cross-origin isolated and SharedArrayBuffer is unavailable.',
        'The owner cannot stop watch and dispose the realm-local reactive view.'
      ],
      options: sharedSignalOptions.en
    },
    zh: {
      purpose:
        '创建单个共享有符号 int32 的推荐 realm-local 响应式 view。本地读取参与 Reactive 追踪，显式 sync 或 watch 把同一 ABI buffer 的远端写入拉入当前 Runtime。',
      quickStart:
        "const runtime = createRuntime()\nconst counter = sharedInt32(runtime, 0)\nconst stop = counter.watch()\n\nconst effect = new Effect(runtime, () => {\n  console.log(counter.value)\n})\neffect.start()\n\ntry {\n  counter.value += 1\n  worker.postMessage({ buffer: counter.buffer })\n} finally {\n  stop()\n  effect.dispose()\n  counter.dispose()\n}",
      scenarios: [
        'counter、flag、cursor 或状态码需要跨 worker/realm 共享。',
        'realm-local Effect 应追踪读取，并在远端写入同步后重跑。',
        '同一 SharedArrayBuffer 在每个 realm 都需要独立 Runtime-owned view。'
      ],
      avoidWhen: [
        '值不是有符号 int32，或业务需要对象 identity。',
        '浏览器未启用 cross-origin isolation，SharedArrayBuffer 不可用。',
        'owner 无法停止 watch 并 dispose realm-local 响应式 view。'
      ],
      options: sharedSignalOptions.zh
    }
  },
  'store-shared:index:SharedInt32Signal': {
    en: {
      purpose:
        'Constructs the class form of a shared int32 reactive view. Prefer sharedInt32 for ordinary creation; use the class when subclass-free constructor identity or explicit new is required by a composition boundary.',
      quickStart:
        "const owner = new SharedInt32Signal(runtime, 7)\nworker.postMessage({ buffer: owner.buffer })\n\nconst peer = new SharedInt32Signal(workerRuntime, 0, owner.buffer)\ntry {\n  peer.sync()\n  console.log(peer.value)\n} finally {\n  peer.dispose()\n  owner.dispose()\n}",
      scenarios: [
        'A framework requires an explicit constructable class rather than a factory.',
        'Two realms need independent Reactive ownership over one ABI-compatible buffer.',
        'Code must access sync, watch, peek, stale, version, and disposal as one lifecycle object.'
      ],
      avoidWhen: [
        'The factory sharedInt32 already expresses the required creation path.',
        'Disposing one view is expected to free or invalidate the shared buffer for every peer; it only disconnects local ownership.',
        'The caller expects remote writes to notify local Effects without sync or watch.'
      ],
      options: sharedSignalOptions.en
    },
    zh: {
      purpose:
        '构造共享 int32 响应式 view 的 class 形式。普通创建优先 sharedInt32；只有组合边界要求显式 new 或 constructable class identity 时直接使用类。',
      quickStart:
        "const owner = new SharedInt32Signal(runtime, 7)\nworker.postMessage({ buffer: owner.buffer })\n\nconst peer = new SharedInt32Signal(workerRuntime, 0, owner.buffer)\ntry {\n  peer.sync()\n  console.log(peer.value)\n} finally {\n  peer.dispose()\n  owner.dispose()\n}",
      scenarios: [
        '框架要求显式 constructable class，而不是 factory。',
        '两个 realm 需要在同一 ABI-compatible buffer 上拥有独立 Reactive ownership。',
        '代码需要把 sync、watch、peek、stale、version 与 disposal 作为一个生命周期对象。'
      ],
      avoidWhen: [
        'factory sharedInt32 已能表达所需创建路径。',
        '期望 dispose 一个 view 会释放或失效所有 peer 的共享 buffer；它只断开本地 ownership。',
        '期望远端写入无需 sync 或 watch 就自动通知本地 Effect。'
      ],
      options: sharedSignalOptions.zh
    }
  },
  'store-shared:index:sharedInt32Array': {
    en: {
      purpose:
        'Creates the recommended fixed-length shared int32 array. Untracked reads stay O(1), tracked reads lazily materialize one Reactive cell per observed index, and array sync batches remote changes into one Runtime update.',
      quickStart:
        "const positions = sharedInt32Array(runtime, 1_000, { initialValues: [0, 0] })\nconst stop = positions.watch()\n\ntry {\n  positions.set(0, 10)\n  positions.update(1, (current) => current + 1)\n  worker.postMessage({ buffer: positions.buffer, length: positions.length })\n  console.log(positions.snapshot())\n} finally {\n  stop()\n  positions.dispose()\n}",
      scenarios: [
        'A fixed index domain of counters, positions, or status slots is shared across workers.',
        'Only indexes actually read by Effects should allocate reactive cells.',
        'Remote writes should synchronize in one Runtime batch instead of invalidating the whole array per cell.'
      ],
      avoidWhen: [
        'Length must grow or shrink after construction.',
        'Values exceed signed int32 or require non-numeric structures.',
        'An update callback has side effects; contention may invoke it repeatedly before CAS succeeds.'
      ],
      options: sharedArrayOptions.en
    },
    zh: {
      purpose:
        '创建推荐的定长共享 int32 数组。非追踪读取保持 O(1)，追踪读取只为实际观察下标惰性物化 Reactive cell，整体 sync 把远端变化合并为一次 Runtime batch。',
      quickStart:
        "const positions = sharedInt32Array(runtime, 1_000, { initialValues: [0, 0] })\nconst stop = positions.watch()\n\ntry {\n  positions.set(0, 10)\n  positions.update(1, (current) => current + 1)\n  worker.postMessage({ buffer: positions.buffer, length: positions.length })\n  console.log(positions.snapshot())\n} finally {\n  stop()\n  positions.dispose()\n}",
      scenarios: [
        '固定下标域的 counter、position 或 status slot 需要跨 worker 共享。',
        '只有 Effect 实际读取的下标才应分配响应式 cell。',
        '远端写入应在一次 Runtime batch 中同步，不能逐 cell 让整个数组失效。'
      ],
      avoidWhen: [
        '构造后仍需增长或缩短 length。',
        '值超出有符号 int32，或需要非数值结构。',
        'update callback 有副作用；CAS 冲突会在成功前重复调用它。'
      ],
      options: sharedArrayOptions.zh
    }
  },
  'store-shared:index:SharedInt32Array': {
    en: {
      purpose:
        'Constructs the class form of the fixed shared int32 array. It exposes high-level get, set, update, sync, watch, snapshot, prune, and disposal plus low-level cell primitives for an explicit composition owner.',
      quickStart:
        "const array = new SharedInt32Array(runtime, 2, { initialValues: [1, 2] })\ntry {\n  const next = array.update(0, (current) => current + 1)\n  const changed = array.sync()\n  console.log(next, changed, array.snapshot())\n  array.prune()\n} finally {\n  array.dispose()\n}",
      scenarios: [
        'A framework requires direct class construction and lifecycle identity.',
        'High-frequency rotating index access needs explicit prune of unobserved cells.',
        'A trusted composition owner needs readCell, writeCell, version bookkeeping, and waiter notification.'
      ],
      avoidWhen: [
        'Ordinary application code only needs get, set, and update; prefer sharedInt32Array.',
        'Low-level readCell or writeCell callers cannot prove bounds, active state, and notification bookkeeping.',
        'snapshot allocation across the full length is too expensive for the requested hot path.'
      ],
      options: sharedArrayOptions.en
    },
    zh: {
      purpose:
        '构造定长共享 int32 数组的 class 形式。它同时暴露高层 get、set、update、sync、watch、snapshot、prune、dispose，以及供明确组合 owner 使用的底层 cell 原语。',
      quickStart:
        "const array = new SharedInt32Array(runtime, 2, { initialValues: [1, 2] })\ntry {\n  const next = array.update(0, (current) => current + 1)\n  const changed = array.sync()\n  console.log(next, changed, array.snapshot())\n  array.prune()\n} finally {\n  array.dispose()\n}",
      scenarios: [
        '框架要求直接 class 构造与生命周期 identity。',
        '高频轮换访问下标，需要显式 prune 无 observer cell。',
        '可信组合 owner 需要 readCell、writeCell、版本记账与 waiter notification。'
      ],
      avoidWhen: [
        '普通应用只需要 get、set 与 update；应优先 sharedInt32Array。',
        '底层 readCell/writeCell 调用方无法证明 bounds、active state 与 notification bookkeeping。',
        '全 length 的 snapshot allocation 对目标 hot path 太昂贵。'
      ],
      options: sharedArrayOptions.zh
    }
  },
  'store-shared:index:createStoreSharedError': {
    en: {
      purpose:
        'Creates a native Error carrying the canonical store-shared source and semantic code while preserving message, stack, and an optional original cause. It is for adapters extending this error boundary, not ordinary state changes.',
      quickStart:
        "try {\n  await synchronizeSharedState()\n} catch (cause) {\n  throw createStoreSharedError(\n    StoreSharedErrorCode.watchFailed,\n    'shared-state synchronization failed',\n    { cause }\n  )\n}",
      scenarios: [
        'A store-shared adapter must emit a library-boundary Error with canonical identity.',
        'The original failure must remain reachable through cause.',
        'The error is not a RangeError-class validation failure.'
      ],
      avoidWhen: [
        'A built-in store-shared operation already returns the correct tagged error.',
        'The condition is a normal state or boolean result rather than an exception.',
        'The error code is not already declared in the canonical StoreSharedErrorCode table.'
      ],
      options: [
        {
          name: 'code',
          description: 'Canonical semantic code already registered for the store-shared error boundary.',
          defaultValue: 'required',
          optional: false,
          type: 'IStoreSharedErrorCode',
          whenToUse: 'Classify the exact failure scenario without inventing an inline code.',
          example: 'StoreSharedErrorCode.watchFailed'
        },
        {
          name: 'message',
          description: 'Stable library-owned diagnostic text for this failure scenario.',
          defaultValue: 'required',
          optional: false,
          type: 'string',
          whenToUse: 'Use the canonical message or a caller-owned adapter message.',
          example: "'shared-state synchronization failed'"
        },
        {
          name: 'options.cause',
          description: 'Original thrown value retained on Error.cause without replacing its identity or stack.',
          defaultValue: 'undefined',
          type: 'unknown',
          whenToUse: 'Wrap a lower-level failure while keeping it reachable.',
          example: '{ cause }'
        }
      ]
    },
    zh: {
      purpose:
        '创建带 canonical store-shared source 与语义 code 的原生 Error，同时保留 message、stack 与可选原始 cause。它供扩展错误边界的 adapter 使用，不表示普通状态变化。',
      quickStart:
        "try {\n  await synchronizeSharedState()\n} catch (cause) {\n  throw createStoreSharedError(\n    StoreSharedErrorCode.watchFailed,\n    'shared-state synchronization failed',\n    { cause }\n  )\n}",
      scenarios: [
        'store-shared adapter 必须在边界抛出带 canonical identity 的 Error。',
        '原始失败必须通过 cause 保持可达。',
        '该失败不是 RangeError 类输入校验错误。'
      ],
      avoidWhen: [
        '内建 store-shared 操作已经返回正确 tagged error。',
        '该条件是正常 state 或 boolean result，而不是异常。',
        'error code 尚未在 canonical StoreSharedErrorCode 表声明。'
      ],
      options: [
        {
          name: 'code',
          description: '已为 store-shared 错误边界注册的 canonical 语义 code。',
          defaultValue: '必填',
          optional: false,
          type: 'IStoreSharedErrorCode',
          whenToUse: '精确分类失败场景，不得内联发明 code。',
          example: 'StoreSharedErrorCode.watchFailed'
        },
        {
          name: 'message',
          description: '该失败场景的稳定 library-owned 诊断文本。',
          defaultValue: '必填',
          optional: false,
          type: 'string',
          whenToUse: '使用 canonical message 或调用方 adapter 自有文本。',
          example: "'shared-state synchronization failed'"
        },
        {
          name: 'options.cause',
          description: '保留在 Error.cause 上的原始抛出值，不替换其 identity 或 stack。',
          defaultValue: 'undefined',
          type: 'unknown',
          whenToUse: '包装底层失败，同时保持其可达。',
          example: '{ cause }'
        }
      ]
    }
  },
  'store-shared:index:createStoreSharedRangeError': {
    en: {
      purpose:
        'Creates a native RangeError with canonical store-shared identity. Use it only for numeric, capacity, index, or range validation owned by a store-shared adapter; native error type remains observable.',
      quickStart:
        "if (!Number.isSafeInteger(length) || length < 0) {\n  throw createStoreSharedRangeError(\n    StoreSharedErrorCode.invalidOption,\n    'length must be a non-negative safe integer'\n  )\n}",
      scenarios: [
        'An adapter validates length, index, capacity, or signed-int32 range.',
        'Callers branch on native RangeError as well as source and code.',
        'A lower-level range failure must remain reachable through cause.'
      ],
      avoidWhen: [
        'The failure is not range-related; use the ordinary error factory.',
        'An existing StoreSharedErrorCode does not describe the scenario.',
        'The caller wants to replace a native TypeError or another runtime error class.'
      ],
      options: [
        {
          name: 'code',
          description: 'Canonical semantic code for the range failure.',
          defaultValue: 'required',
          optional: false,
          type: 'IStoreSharedErrorCode',
          whenToUse: 'Select the registered code matching the validation boundary.',
          example: 'StoreSharedErrorCode.indexOutOfRange'
        },
        {
          name: 'message',
          description: 'Stable diagnostic text explaining the rejected range.',
          defaultValue: 'required',
          optional: false,
          type: 'string',
          whenToUse: 'Tell the caller which numeric or capacity invariant failed.',
          example: "'index is outside the shared array'"
        },
        {
          name: 'options.cause',
          description: 'Optional original failure retained as cause.',
          defaultValue: 'undefined',
          type: 'unknown',
          whenToUse: 'A getter, iterable, or adapter failed while validating the range.',
          example: '{ cause }'
        }
      ]
    },
    zh: {
      purpose:
        '创建带 canonical store-shared identity 的原生 RangeError。仅用于 store-shared adapter 拥有的数值、容量、下标或范围校验；native error type 保持可观察。',
      quickStart:
        "if (!Number.isSafeInteger(length) || length < 0) {\n  throw createStoreSharedRangeError(\n    StoreSharedErrorCode.invalidOption,\n    'length must be a non-negative safe integer'\n  )\n}",
      scenarios: [
        'adapter 校验 length、index、capacity 或 signed-int32 range。',
        '调用方同时按 native RangeError 与 source/code 分支。',
        '底层 range failure 必须通过 cause 保持可达。'
      ],
      avoidWhen: [
        '失败与 range 无关；应使用普通 error factory。',
        '没有既有 StoreSharedErrorCode 描述该场景。',
        '调用方准备替换 native TypeError 或其他 runtime error class。'
      ],
      options: [
        {
          name: 'code',
          description: 'range failure 的 canonical 语义 code。',
          defaultValue: '必填',
          optional: false,
          type: 'IStoreSharedErrorCode',
          whenToUse: '选择与校验边界匹配的已注册 code。',
          example: 'StoreSharedErrorCode.indexOutOfRange'
        },
        {
          name: 'message',
          description: '解释被拒绝 range 的稳定诊断文本。',
          defaultValue: '必填',
          optional: false,
          type: 'string',
          whenToUse: '告诉调用方哪个数值或 capacity invariant 失败。',
          example: "'index is outside the shared array'"
        },
        {
          name: 'options.cause',
          description: '作为 cause 保留的可选原始失败。',
          defaultValue: 'undefined',
          type: 'unknown',
          whenToUse: 'getter、iterable 或 adapter 在校验 range 时失败。',
          example: '{ cause }'
        }
      ]
    }
  },
  'wasm:index:initSync': {
    en: {
      purpose:
        'Initializes the WASM module synchronously from bytes or an already compiled WebAssembly.Module. It performs no fetch, so the caller owns loading, caching, CSP, and compile timing.',
      quickStart:
        "const module = await WebAssembly.compile(wasmBytes)\nconst wasm = initSync({ module })\n\nconst id = wasm.alloc_bytes(16)\ntry {\n  const view = new Uint8Array(wasm.memory.buffer, wasm.ptr_of(id), 16)\n  view.set(source)\n} finally {\n  wasm.dealloc_bytes(id)\n}",
      scenarios: [
        'The host already owns WASM bytes or a compiled Module.',
        'Initialization must occur synchronously after an explicit preload phase.',
        'A Node, worker, or CSP-constrained host must avoid implicit relative fetch.'
      ],
      avoidWhen: [
        'The browser should load the distributed .wasm resource; use the asynchronous default init.',
        'Compilation cost cannot block the current task and no compiled Module is available.',
        'Several callers might initialize independently instead of sharing one host-owned initialization result.'
      ],
      options: []
    },
    zh: {
      purpose:
        '从 bytes 或已编译 WebAssembly.Module 同步初始化 WASM；它不会发起 fetch，因此加载、缓存、CSP 与编译时机都由调用方拥有。',
      quickStart:
        "const module = await WebAssembly.compile(wasmBytes)\nconst wasm = initSync({ module })\n\nconst id = wasm.alloc_bytes(16)\ntry {\n  const view = new Uint8Array(wasm.memory.buffer, wasm.ptr_of(id), 16)\n  view.set(source)\n} finally {\n  wasm.dealloc_bytes(id)\n}",
      scenarios: [
        '宿主已经拥有 WASM bytes 或已编译 Module。',
        '显式 preload 阶段之后必须同步完成初始化。',
        'Node、worker 或受 CSP 约束的宿主必须避免隐式相对 fetch。'
      ],
      avoidWhen: [
        '浏览器应加载随库发布的 .wasm 资源；应使用异步默认 init。',
        '当前任务不能承担编译阻塞，且没有已编译 Module。',
        '多个调用方准备各自初始化，而不是复用宿主拥有的单一结果。'
      ],
      options: []
    }
  },
  'wasm:index:alloc_bytes': {
    en: {
      purpose:
        'Allocates one zero-filled, eight-byte-aligned arena block and returns a stable nonzero allocation id. Zero means allocation failure and must never be passed off as a live block.',
      quickStart:
        "const id = alloc_bytes(source.byteLength)\nif (id === 0) throw new Error('arena exhausted')\n\ntry {\n  new Uint8Array(memory.buffer, ptr_of(id), source.byteLength).set(source)\n  consume(id, source.byteLength)\n} finally {\n  dealloc_bytes(id)\n}",
      scenarios: [
        'JavaScript bytes must cross into the library-owned WASM arena.',
        'A stable lifecycle identity is needed while memory offsets may move after growth.',
        'Numeric views require an eight-byte-aligned backing allocation.'
      ],
      avoidWhen: [
        'The value never crosses the WASM boundary.',
        'The caller cannot guarantee exactly one eventual dealloc_bytes call for a live id.',
        'The requested byte length is not validated or can exceed the host memory budget.'
      ],
      options: []
    },
    zh: {
      purpose:
        '分配一个清零且 8 字节对齐的 arena block，并返回稳定非零 allocation id；0 表示分配失败，绝不能冒充 live block。',
      quickStart:
        "const id = alloc_bytes(source.byteLength)\nif (id === 0) throw new Error('arena exhausted')\n\ntry {\n  new Uint8Array(memory.buffer, ptr_of(id), source.byteLength).set(source)\n  consume(id, source.byteLength)\n} finally {\n  dealloc_bytes(id)\n}",
      scenarios: [
        'JavaScript bytes 必须进入库拥有的 WASM arena。',
        'memory growth 后 offset 可能变化，但生命周期需要稳定身份。',
        '数值 view 需要 8 字节对齐的 backing allocation。'
      ],
      avoidWhen: [
        '值从不跨越 WASM 边界。',
        '调用方无法保证每个 live id 最终恰好 dealloc_bytes 一次。',
        '请求长度未经验证，或可能超过宿主内存预算。'
      ],
      options: []
    }
  },
  'wasm:index:ptr_of': {
    en: {
      purpose:
        'Returns the current linear-memory byte offset for a live allocation id, or zero for an unknown or released id. The id is stable; a typed-array view over memory.buffer is not.',
      quickStart:
        "const id = alloc_bytes(byteLength)\nif (id === 0) throw new Error('arena exhausted')\n\nconst writeView = new Uint8Array(memory.buffer, ptr_of(id), byteLength)\nwriteView.set(source)\n\nallocateMoreMemory()\nconst freshView = new Uint8Array(memory.buffer, ptr_of(id), byteLength)",
      scenarios: [
        'A fresh TypedArray or DataView must be created for a live arena block.',
        'Code must re-read the offset after another allocation may have grown memory.',
        'Unknown or released ids should fail closed as offset zero.'
      ],
      avoidWhen: [
        'The caller plans to cache the returned pointer or memory.buffer view across allocations.',
        'The id has not been checked as a live nonzero allocation.',
        'The requested view length is larger than byte_len_of(id).'
      ],
      options: []
    },
    zh: {
      purpose:
        '返回 live allocation id 当前对应的 linear-memory byte offset；未知或已释放 id 返回 0。稳定的是 id，不是基于 memory.buffer 创建的 typed-array view。',
      quickStart:
        "const id = alloc_bytes(byteLength)\nif (id === 0) throw new Error('arena exhausted')\n\nconst writeView = new Uint8Array(memory.buffer, ptr_of(id), byteLength)\nwriteView.set(source)\n\nallocateMoreMemory()\nconst freshView = new Uint8Array(memory.buffer, ptr_of(id), byteLength)",
      scenarios: [
        '需要为 live arena block 创建新的 TypedArray 或 DataView。',
        '其他分配可能触发 memory growth，因此必须重新读取 offset。',
        '未知或已释放 id 应以 offset 0 fail-closed。'
      ],
      avoidWhen: [
        '调用方准备跨分配缓存 pointer 或 memory.buffer view。',
        'id 尚未确认是 live 非零 allocation。',
        '请求 view 长度超过 byte_len_of(id)。'
      ],
      options: []
    }
  },
  'wasm:index:byte_len_of': {
    en: {
      purpose:
        'Returns the actual eight-byte-rounded capacity of a live arena allocation, or zero for an unknown id. Capacity is not the logical payload length and must not be sent as a conversion length accidentally.',
      quickStart:
        "const id = alloc_bytes(payload.byteLength)\nconst capacity = byte_len_of(id)\nif (id === 0 || capacity < payload.byteLength) throw new Error('allocation failed')\n\nnew Uint8Array(memory.buffer, ptr_of(id), capacity).set(payload)\nconst result = json_to_msgpack(id, payload.byteLength)",
      scenarios: [
        'A caller must bound a view by the real aligned arena capacity.',
        'Allocation success must be checked without trusting the requested length.',
        'Diagnostics need to distinguish block capacity from exact payload bytes.'
      ],
      avoidWhen: [
        'The returned capacity would be substituted for the exact document length.',
        'The id is already released and zero is being treated as a valid empty block.',
        'A logical schema length should be tracked in the arena rather than by its caller.'
      ],
      options: []
    },
    zh: {
      purpose:
        '返回 live arena allocation 按 8 字节取整后的实际容量；未知 id 返回 0。capacity 不是逻辑 payload 长度，不能误传为转码长度。',
      quickStart:
        "const id = alloc_bytes(payload.byteLength)\nconst capacity = byte_len_of(id)\nif (id === 0 || capacity < payload.byteLength) throw new Error('allocation failed')\n\nnew Uint8Array(memory.buffer, ptr_of(id), capacity).set(payload)\nconst result = json_to_msgpack(id, payload.byteLength)",
      scenarios: [
        '调用方必须用真实对齐容量限制 view。',
        '分配成功需要独立检查，不能只信任请求长度。',
        '诊断需要区分 block capacity 与精确 payload bytes。'
      ],
      avoidWhen: [
        '准备把返回 capacity 当成精确文档长度。',
        'id 已释放，却把 0 当成合法空 block。',
        '逻辑 schema 长度本应由调用方记录，却试图从 arena 推断。'
      ],
      options: []
    }
  },
  'wasm:index:dealloc_bytes': {
    en: {
      purpose:
        'Releases one live arena allocation id and returns whether ownership actually existed. A second release or an unknown id returns false, making cleanup observable without trapping.',
      quickStart:
        "const id = alloc_bytes(byteLength)\nif (id === 0) throw new Error('arena exhausted')\n\ntry {\n  useArenaBlock(id)\n} finally {\n  if (!dealloc_bytes(id)) diagnostics.report('arena block was not live')\n}",
      scenarios: [
        'A caller-owned input or conversion output reaches its final cleanup boundary.',
        'Cleanup must be idempotence-observable instead of trapping on an unknown id.',
        'Partial construction needs a safe finally path for every admitted block.'
      ],
      avoidWhen: [
        'Any view, conversion, or asynchronous task can still read the block.',
        'The id is borrowed and another owner is responsible for release.',
        'The caller intends to reuse the released id as stable storage identity.'
      ],
      options: []
    },
    zh: {
      purpose:
        '释放一个 live arena allocation id，并返回调用方是否实际拥有该 allocation；二次释放或未知 id 返回 false，不会 trap。',
      quickStart:
        "const id = alloc_bytes(byteLength)\nif (id === 0) throw new Error('arena exhausted')\n\ntry {\n  useArenaBlock(id)\n} finally {\n  if (!dealloc_bytes(id)) diagnostics.report('arena block was not live')\n}",
      scenarios: [
        '调用方拥有的输入或转码输出到达最终 cleanup 边界。',
        'cleanup 需要可观察幂等性，未知 id 不能 trap。',
        '部分构造失败时，每个已接纳 block 都需要安全 finally。'
      ],
      avoidWhen: [
        '仍有 view、转码或异步任务读取 block。',
        'id 是 borrowed，由另一个 owner 负责释放。',
        '调用方准备把已释放 id 继续当作稳定存储身份。'
      ],
      options: []
    }
  },
  'wasm:index:ConversionResult': {
    en: {
      purpose:
        'Represents one self-contained conversion outcome with output allocation id, exact byte length, and error text. The wasm-bindgen wrapper itself and any successful output block have separate cleanup obligations.',
      quickStart:
        "using result = json_to_msgpack(inputId, inputLength)\nif (result.id === 0) throw new Error(result.error)\n\ntry {\n  return new Uint8Array(memory.buffer, ptr_of(result.id), result.len).slice()\n} finally {\n  dealloc_bytes(result.id)\n}",
      scenarios: [
        'Interleaved conversions need operation-local results rather than a shared last-result register.',
        'Success must bind a nonzero output id to its exact byte length.',
        'Failure must carry its reason without allocating an output block.'
      ],
      avoidWhen: [
        'The wrapper will outlive its WASM instance or be serialized across realms.',
        'The caller assumes disposing the wrapper also frees result.id.',
        'The caller reads memory through an old view after conversion may have grown memory.'
      ],
      options: []
    },
    zh: {
      purpose:
        '表示一次自包含转码结果，把 output allocation id、精确 byte length 与 error text 绑定在一起；wasm-bindgen wrapper 与成功输出 block 各有独立 cleanup 义务。',
      quickStart:
        "using result = json_to_msgpack(inputId, inputLength)\nif (result.id === 0) throw new Error(result.error)\n\ntry {\n  return new Uint8Array(memory.buffer, ptr_of(result.id), result.len).slice()\n} finally {\n  dealloc_bytes(result.id)\n}",
      scenarios: [
        '交错转码需要 operation-local result，不能依赖共享 last-result register。',
        '成功必须把非零 output id 与精确 byte length 绑定。',
        '失败必须携带原因，同时不分配 output block。'
      ],
      avoidWhen: [
        'wrapper 将长于其 WASM instance，或要跨 realm 序列化。',
        '调用方误以为 dispose wrapper 会同时释放 result.id。',
        '转码可能触发 memory growth 后仍通过旧 view 读取。'
      ],
      options: []
    }
  },
  'wasm:index:json_to_msgpack': {
    en: {
      purpose:
        'Converts one complete UTF-8 JSON document in an arena block to MessagePack. It reads exactly len bytes, preserves map keys as strings, returns an independent ConversionResult, and never releases the input.',
      quickStart:
        "const bytes = new TextEncoder().encode(JSON.stringify(value))\nconst inputId = alloc_bytes(bytes.length)\nif (inputId === 0) throw new Error('arena exhausted')\n\ntry {\n  new Uint8Array(memory.buffer, ptr_of(inputId), bytes.length).set(bytes)\n  using result = json_to_msgpack(inputId, bytes.length)\n  if (result.id === 0) throw new Error(result.error)\n  try {\n    return new Uint8Array(memory.buffer, ptr_of(result.id), result.len).slice()\n  } finally { dealloc_bytes(result.id) }\n} finally { dealloc_bytes(inputId) }",
      scenarios: [
        'A complete JSON document must cross a compact binary boundary.',
        'Concurrent or re-entrant conversions require independent result state.',
        'Output must be copied into JavaScript ownership before releasing the arena block.'
      ],
      avoidWhen: [
        'The input is a stream, several concatenated documents, or an incomplete JSON prefix.',
        'len exceeds byte_len_of(inputId) or is being replaced by aligned capacity.',
        'The caller cannot release both the input id and successful output id.'
      ],
      options: []
    },
    zh: {
      purpose:
        '把 arena block 中一个完整 UTF-8 JSON 文档转成 MessagePack。它精确读取 len bytes，保持 map key 为字符串，返回独立 ConversionResult，并且绝不释放输入。',
      quickStart:
        "const bytes = new TextEncoder().encode(JSON.stringify(value))\nconst inputId = alloc_bytes(bytes.length)\nif (inputId === 0) throw new Error('arena exhausted')\n\ntry {\n  new Uint8Array(memory.buffer, ptr_of(inputId), bytes.length).set(bytes)\n  using result = json_to_msgpack(inputId, bytes.length)\n  if (result.id === 0) throw new Error(result.error)\n  try {\n    return new Uint8Array(memory.buffer, ptr_of(result.id), result.len).slice()\n  } finally { dealloc_bytes(result.id) }\n} finally { dealloc_bytes(inputId) }",
      scenarios: [
        '完整 JSON 文档需要跨越紧凑二进制边界。',
        '并发或重入转码需要彼此独立的 result state。',
        '释放 arena output 前必须复制到 JavaScript ownership。'
      ],
      avoidWhen: [
        '输入是 stream、多个连续文档或不完整 JSON prefix。',
        'len 超过 byte_len_of(inputId)，或误用对齐 capacity 代替。',
        '调用方无法同时释放 input id 与成功 output id。'
      ],
      options: []
    }
  },
  'wasm:index:msgpack_to_json': {
    en: {
      purpose:
        'Converts one complete MessagePack document in an arena block to UTF-8 JSON. The decoder must consume exactly len bytes, so trailing bytes or a second document fail instead of being ignored.',
      quickStart:
        "const inputId = alloc_bytes(packed.length)\nif (inputId === 0) throw new Error('arena exhausted')\n\ntry {\n  new Uint8Array(memory.buffer, ptr_of(inputId), packed.length).set(packed)\n  using result = msgpack_to_json(inputId, packed.length)\n  if (result.id === 0) throw new Error(result.error)\n  try {\n    const bytes = new Uint8Array(memory.buffer, ptr_of(result.id), result.len).slice()\n    return JSON.parse(new TextDecoder().decode(bytes))\n  } finally { dealloc_bytes(result.id) }\n} finally { dealloc_bytes(inputId) }",
      scenarios: [
        'One MessagePack document must become inspectable JSON at a host boundary.',
        'Trailing bytes must fail closed rather than hide a second payload.',
        'The output must be copied before releasing the WASM allocation.'
      ],
      avoidWhen: [
        'The input contains a MessagePack stream or concatenated documents.',
        'Map keys are not strings and the application expects lossless non-string key preservation.',
        'The caller cannot bound len to the exact document bytes inside a live allocation.'
      ],
      options: []
    },
    zh: {
      purpose:
        '把 arena block 中一个完整 MessagePack 文档转成 UTF-8 JSON。decoder 必须精确消费 len bytes，因此尾随字节或第二个文档会失败，不会被忽略。',
      quickStart:
        "const inputId = alloc_bytes(packed.length)\nif (inputId === 0) throw new Error('arena exhausted')\n\ntry {\n  new Uint8Array(memory.buffer, ptr_of(inputId), packed.length).set(packed)\n  using result = msgpack_to_json(inputId, packed.length)\n  if (result.id === 0) throw new Error(result.error)\n  try {\n    const bytes = new Uint8Array(memory.buffer, ptr_of(result.id), result.len).slice()\n    return JSON.parse(new TextDecoder().decode(bytes))\n  } finally { dealloc_bytes(result.id) }\n} finally { dealloc_bytes(inputId) }",
      scenarios: [
        '一个 MessagePack 文档需要在宿主边界变为可检查 JSON。',
        '尾随字节必须 fail-closed，不能隐藏第二个 payload。',
        '释放 WASM allocation 前必须复制 output。'
      ],
      avoidWhen: [
        '输入包含 MessagePack stream 或连续文档。',
        'map key 不是字符串，并且业务要求无损保留非字符串 key。',
        '调用方无法把 len 限定为 live allocation 中的精确文档 bytes。'
      ],
      options: []
    }
  },
  'middleware-pipeline:index:runSyncMiddleware': {
    en: {
      purpose:
        'Runs a flat synchronous middleware chain over one value. A stage continues exactly once by calling next; returning without next short-circuits and duplicate or late calls are reported without changing the accepted value.',
      quickStart:
        "runSyncMiddleware(\n  [\n    (value: string, next) => next(value.trim()),\n    (value: string, next) => next(value.toUpperCase())\n  ],\n  ' migaia ',\n  (value) => console.log(value),\n  (violation) => diagnostics.report(violation)\n)",
      scenarios: [
        'Every stage is synchronous and transforms or rejects one in-memory value.',
        'Returning without next should deliberately stop the chain without calling done.',
        'The host must observe duplicate or late next calls while preserving the first accepted continuation.'
      ],
      avoidWhen: [
        'Any stage or done callback is asynchronous; use runAsyncMiddleware.',
        'A stage needs to emit several candidates; use a generator runner.',
        'Cancellation requires forcefully interrupting non-cooperative synchronous work.'
      ],
      options: [
        {
          name: 'signal',
          description:
            'Optional cooperative abort signal checked before each stage and done admission. A started synchronous callback cannot be rolled back or interrupted mid-call.',
          defaultValue: 'undefined (no abort context)',
          type: 'IMiddlewarePipelineAbortSignal',
          whenToUse: 'Stop admission between synchronous stages when the caller owns cancellation.',
          example: 'runSyncMiddleware(stages, value, done, onViolation, { signal })'
        }
      ]
    },
    zh: {
      purpose:
        '以一个值运行扁平同步 middleware chain。stage 只能调用一次 next 继续；不调用即短路，重复或迟到调用只上报，不会改写已接纳的值。',
      quickStart:
        "runSyncMiddleware(\n  [\n    (value: string, next) => next(value.trim()),\n    (value: string, next) => next(value.toUpperCase())\n  ],\n  ' migaia ',\n  (value) => console.log(value),\n  (violation) => diagnostics.report(violation)\n)",
      scenarios: [
        '所有 stage 都同步变换或拒绝一个内存值。',
        'stage 不调用 next 返回时应明确短路，并且不调用 done。',
        '宿主必须观察 duplicate 或 late next，同时保留第一次接纳的 continuation。'
      ],
      avoidWhen: [
        '任一 stage 或 done 是异步的；应使用 runAsyncMiddleware。',
        'stage 需要发出多个候选值；应使用 generator runner。',
        '取消要求强制中断不合作的同步工作。'
      ],
      options: [
        {
          name: 'signal',
          description:
            '可选协作式 abort signal，在每个 stage 与 done 准入前检查；已经开始的同步 callback 无法中途回滚或打断。',
          defaultValue: 'undefined（不传 abort context）',
          type: 'IMiddlewarePipelineAbortSignal',
          whenToUse: '调用方拥有取消，并需要在同步 stage 之间停止准入时设置。',
          example: 'runSyncMiddleware(stages, value, done, onViolation, { signal })'
        }
      ]
    }
  },
  'middleware-pipeline:index:runAsyncMiddleware': {
    en: {
      purpose:
        'Runs asynchronous middleware as an onion. next starts the downstream frame immediately and returns its completion Promise, so awaiting it creates before/after nesting while returning without next short-circuits.',
      quickStart:
        "await runAsyncMiddleware(\n  [\n    async (value: Request, next) => {\n      const startedAt = performance.now()\n      await next(await authenticate(value))\n      metrics.observe(performance.now() - startedAt)\n    }\n  ],\n  request,\n  (value) => dispatch(value),\n  {\n    onViolation: (violation) => diagnostics.report(violation),\n    signal: controller.signal\n  }\n)",
      scenarios: [
        'A stage performs asynchronous work before and after downstream completion.',
        'The chain needs explicit short-circuiting, for example authentication rejection or cache hits.',
        'Stage and downstream failures must preserve both causes through a host-owned combiner.'
      ],
      avoidWhen: [
        'All work is synchronous and onion unwinding is unnecessary.',
        'The workload is streaming or fan-out; next represents one downstream continuation only.',
        'A non-cooperative Promise must be forcibly terminated; signal checks are cooperative admission boundaries.'
      ],
      options: [
        {
          name: 'onViolation',
          description:
            'Required observer for duplicate and late next calls. Violating calls resolve harmlessly and never replace the first accepted downstream path.',
          defaultValue: 'required',
          optional: false,
          type: 'IMiddlewarePipelineViolationHandler',
          whenToUse: 'Always connect the runner contract to diagnostics or an explicit no-op policy.',
          example: '{ onViolation: (kind) => diagnostics.report(kind) }'
        },
        {
          name: 'assertActive',
          description:
            'Optional host-owned liveness assertion checked at frame admission and after settled downstream work. Its exact thrown value remains control flow rather than a second business failure.',
          defaultValue: 'undefined',
          type: '() => void',
          whenToUse: 'Enforce a lease, generation, or host-active invariant between async frames.',
          example: '{ onViolation, assertActive: () => lease.assertActive() }'
        },
        {
          name: 'combineStageAndDownstreamError',
          description:
            'Constructs the thrown value when the current stage and its already-started downstream frame both fail. Without it, the runner creates an AggregateError in stage-then-downstream order.',
          defaultValue: 'AggregateError([stageError, downstreamError])',
          type: '(stage: unknown, downstream: unknown) => unknown',
          whenToUse: 'Use the host canonical error type while preserving both failures.',
          example: '{ onViolation, combineStageAndDownstreamError: (stage, downstream) => new AggregateError([stage, downstream]) }'
        },
        {
          name: 'signal',
          description:
            'Cooperative abort signal exposed through stage context and checked before frame and done admission. It does not undo work that already completed.',
          defaultValue: 'undefined (no abort context)',
          type: 'IMiddlewarePipelineAbortSignal',
          whenToUse: 'Tie pipeline admission to request or lifecycle cancellation.',
          example: '{ onViolation, signal: controller.signal }'
        }
      ]
    },
    zh: {
      purpose:
        '以洋葱模型运行异步 middleware。next 会立即启动下游 frame 并返回其 completion Promise；await next 形成前后嵌套，不调用 next 返回则短路。',
      quickStart:
        "await runAsyncMiddleware(\n  [\n    async (value: Request, next) => {\n      const startedAt = performance.now()\n      await next(await authenticate(value))\n      metrics.observe(performance.now() - startedAt)\n    }\n  ],\n  request,\n  (value) => dispatch(value),\n  {\n    onViolation: (violation) => diagnostics.report(violation),\n    signal: controller.signal\n  }\n)",
      scenarios: [
        'stage 在下游完成前后都需要执行异步工作。',
        'chain 需要明确短路，例如认证拒绝或缓存命中。',
        'stage 与 downstream 同时失败时必须通过宿主组合器保留两个原因。'
      ],
      avoidWhen: [
        '全部工作同步且不需要洋葱回卷。',
        '工作负载是 streaming 或 fan-out；next 只代表一条 downstream continuation。',
        '必须强制终止不合作的 Promise；signal 只提供协作式准入边界。'
      ],
      options: [
        {
          name: 'onViolation',
          description:
            '必填的 duplicate 与 late next 观察器。违规调用会无害 resolve，永远不会替换第一次接纳的 downstream path。',
          defaultValue: '必填',
          optional: false,
          type: 'IMiddlewarePipelineViolationHandler',
          whenToUse: '始终把 runner 契约接到诊断系统，或显式采用 no-op 策略。',
          example: '{ onViolation: (kind) => diagnostics.report(kind) }'
        },
        {
          name: 'assertActive',
          description:
            '可选宿主 liveness assertion，在 frame 准入与下游 settle 后检查；它抛出的 exact value 保持为 control flow，不会成为第二个业务失败。',
          defaultValue: 'undefined',
          type: '() => void',
          whenToUse: '在异步 frame 之间强制检查 lease、generation 或 host-active invariant。',
          example: '{ onViolation, assertActive: () => lease.assertActive() }'
        },
        {
          name: 'combineStageAndDownstreamError',
          description:
            '当前 stage 与已启动 downstream frame 同时失败时构造最终抛出值；省略时按 stage、downstream 顺序创建 AggregateError。',
          defaultValue: 'AggregateError([stageError, downstreamError])',
          type: '(stage: unknown, downstream: unknown) => unknown',
          whenToUse: '需要使用宿主 canonical error type，同时保留两个失败时设置。',
          example: '{ onViolation, combineStageAndDownstreamError: (stage, downstream) => new AggregateError([stage, downstream]) }'
        },
        {
          name: 'signal',
          description:
            '通过 stage context 暴露的协作式 abort signal，在 frame 与 done 准入前检查；不会撤销已经完成的工作。',
          defaultValue: 'undefined（不传 abort context）',
          type: 'IMiddlewarePipelineAbortSignal',
          whenToUse: '把 pipeline 准入绑定到请求或 lifecycle 取消。',
          example: '{ onViolation, signal: controller.signal }'
        }
      ]
    }
  },
  'middleware-pipeline:index:runGeneratorMiddleware': {
    en: {
      purpose:
        'Runs synchronous generator stages serially. Yields remain local to the current stage; its terminal return decides whether the last yield, explicit undefined, another value, or a halt reaches the next stage.',
      quickStart:
        "runGeneratorMiddleware(\n  [\n    function* (value: number) {\n      yield value + 1\n      yield value + 2\n      return GENERATOR_CONTINUE\n    },\n    function* (value: number) {\n      return value > 10 ? GENERATOR_HALT : value * 2\n    }\n  ],\n  3,\n  (value) => console.log(value)\n)",
      scenarios: [
        'A synchronous stage naturally computes through several local yielded candidates.',
        'Terminal control must distinguish halt, continue with last yield, and explicit undefined.',
        'A host needs strict iterator cleanup when cooperative abort occurs between transitions.'
      ],
      avoidWhen: [
        'Yields must stream to consumers or fan out; only the last local yield can continue.',
        'Any iterator step is asynchronous; use runAsyncGeneratorMiddleware.',
        'Implicit generator return should propagate undefined; implicit undefined intentionally means halt.'
      ],
      options: [
        {
          name: 'signal',
          description:
            'Cooperative abort signal checked at iterator transitions. Abort calls return once on an unfinished iterator and strictly drains cleanup yields without sending them downstream.',
          defaultValue: 'undefined (no abort context)',
          type: 'IMiddlewarePipelineAbortSignal',
          whenToUse: 'Allow lifecycle cancellation between synchronous generator transitions.',
          example: 'runGeneratorMiddleware(stages, value, done, undefined, { signal })'
        }
      ]
    },
    zh: {
      purpose:
        '串行运行同步 generator stage。yield 只属于当前 stage；terminal return 决定把最后一次 yield、显式 undefined、普通值或 halt 传给下一 stage。',
      quickStart:
        "runGeneratorMiddleware(\n  [\n    function* (value: number) {\n      yield value + 1\n      yield value + 2\n      return GENERATOR_CONTINUE\n    },\n    function* (value: number) {\n      return value > 10 ? GENERATOR_HALT : value * 2\n    }\n  ],\n  3,\n  (value) => console.log(value)\n)",
      scenarios: [
        '同步 stage 会自然地产生多个局部候选值。',
        'terminal control 必须区分 halt、采用最后 yield 与传播显式 undefined。',
        '协作式 abort 发生在 iterator transition 之间时，宿主需要严格 cleanup。'
      ],
      avoidWhen: [
        'yield 必须流式交给消费者或 fan-out；这里只能继续最后一个局部 yield。',
        '任一 iterator step 是异步的；应使用 runAsyncGeneratorMiddleware。',
        '期望隐式 return 传播 undefined；这里隐式 undefined 有意表示 halt。'
      ],
      options: [
        {
          name: 'signal',
          description:
            '在 iterator transition 检查的协作式 abort signal；取消时对未完成 iterator 调用一次 return，并严格 drain cleanup yield，绝不传给下游。',
          defaultValue: 'undefined（不传 abort context）',
          type: 'IMiddlewarePipelineAbortSignal',
          whenToUse: '允许 lifecycle 在同步 generator transition 之间取消。',
          example: 'runGeneratorMiddleware(stages, value, done, undefined, { signal })'
        }
      ]
    }
  },
  'middleware-pipeline:index:runAsyncGeneratorMiddleware': {
    en: {
      purpose:
        'Runs asynchronous generator stages strictly in sequence. It awaits every iterator transition, interprets the same terminal sentinels as the synchronous runner, and calls done only after all stages complete.',
      quickStart:
        "await runAsyncGeneratorMiddleware(\n  [\n    async function* (value: string) {\n      const normalized = await normalize(value)\n      yield normalized\n      return GENERATOR_CONTINUE\n    },\n    async function* (value: string) {\n      yield await enrich(value)\n      return GENERATOR_CONTINUE\n    }\n  ],\n  input,\n  (value) => persist(value),\n  undefined,\n  { signal: controller.signal }\n)",
      scenarios: [
        'Generator-shaped stages need asynchronous iterator work but deterministic serial order.',
        'Terminal sentinels must match an existing synchronous generator pipeline.',
        'Abort must run async iterator cleanup before the runner settles.'
      ],
      avoidWhen: [
        'The pipeline is a stream: intermediate yields are not emitted downstream.',
        'A yielded PromiseLike must retain object identity; async generators assimilate yielded thenables.',
        'A stage can remain pending forever without its own deadline or cancellation cooperation.'
      ],
      options: [
        {
          name: 'signal',
          description:
            'Cooperative abort signal checked before iterator transitions and done admission. Error reasons retain identity; primitive reasons become a traceable ABORTED error.',
          defaultValue: 'undefined (no abort context)',
          type: 'IMiddlewarePipelineAbortSignal',
          whenToUse: 'Bind serial async generator execution and cleanup to a lifecycle owner.',
          example: 'runAsyncGeneratorMiddleware(stages, value, done, undefined, { signal })'
        }
      ]
    },
    zh: {
      purpose:
        '严格串行运行 async generator stage。它 await 每次 iterator transition，解释与同步 runner 相同的 terminal sentinel，并仅在全部 stage 完成后调用 done。',
      quickStart:
        "await runAsyncGeneratorMiddleware(\n  [\n    async function* (value: string) {\n      const normalized = await normalize(value)\n      yield normalized\n      return GENERATOR_CONTINUE\n    },\n    async function* (value: string) {\n      yield await enrich(value)\n      return GENERATOR_CONTINUE\n    }\n  ],\n  input,\n  (value) => persist(value),\n  undefined,\n  { signal: controller.signal }\n)",
      scenarios: [
        'generator 形态 stage 需要异步 iterator 工作，同时保持确定性串行顺序。',
        'terminal sentinel 必须与既有同步 generator pipeline 一致。',
        'abort 后必须先执行 async iterator cleanup，再结算 runner。'
      ],
      avoidWhen: [
        '目标是 streaming；中间 yield 不会发给下游。',
        'yielded PromiseLike 必须保持对象 identity；async generator 会 assimilation thenable。',
        'stage 可能永久 pending，却没有自身 deadline 或取消协作。'
      ],
      options: [
        {
          name: 'signal',
          description:
            '在 iterator transition 与 done 准入前检查的协作式 abort signal。Error reason 保持 identity；primitive reason 转成可追踪 ABORTED error。',
          defaultValue: 'undefined（不传 abort context）',
          type: 'IMiddlewarePipelineAbortSignal',
          whenToUse: '把串行 async generator 执行与 cleanup 绑定到 lifecycle owner。',
          example: 'runAsyncGeneratorMiddleware(stages, value, done, undefined, { signal })'
        }
      ]
    }
  },
  'middleware-pipeline:index:adaptSyncStageToAsync': {
    en: {
      purpose:
        'Lifts one synchronous next-style stage into an async onion chain while preserving short-circuiting and the first accepted next value. Its violation reporter belongs to the adapter, separately from the outer runner reporter.',
      quickStart:
        "const trim = adaptSyncStageToAsync(\n  (value: string, next) => next(value.trim()),\n  (violation) => diagnostics.report('trim', violation)\n)\n\nawait runAsyncMiddleware([trim, asyncStage], input, done, { onViolation })",
      scenarios: [
        'A trusted synchronous stage must be reused inside an async middleware chain.',
        'The synchronous stage short-circuit contract must remain intact.',
        'Adapter-local duplicate and late next calls need their own diagnostics.'
      ],
      avoidWhen: [
        'The stage already returns asynchronous work after calling next.',
        'Both stage and downstream failures need lossless custom aggregation inside the adapter.',
        'A direct rewrite to the native async stage contract is simpler and owned by the same module.'
      ],
      options: []
    },
    zh: {
      purpose:
        '把一个同步 next-style stage 提升到异步洋葱 chain，同时保持短路与第一次接纳的 next 值。adapter 的 violation reporter 独立于外层 runner reporter。',
      quickStart:
        "const trim = adaptSyncStageToAsync(\n  (value: string, next) => next(value.trim()),\n  (violation) => diagnostics.report('trim', violation)\n)\n\nawait runAsyncMiddleware([trim, asyncStage], input, done, { onViolation })",
      scenarios: [
        '可信同步 stage 必须复用到 async middleware chain。',
        '同步 stage 的短路契约必须原样保留。',
        'adapter 内 duplicate 与 late next 需要独立诊断。'
      ],
      avoidWhen: [
        'stage 调用 next 后还返回异步工作。',
        'adapter 内 stage 与 downstream 双失败需要无损自定义聚合。',
        '同一模块拥有代码，直接改写成原生 async stage 更简单。'
      ],
      options: []
    }
  },
  'middleware-pipeline:index:adaptSyncStageToGenerator': {
    en: {
      purpose:
        'Lifts one synchronous next-style stage into a synchronous generator stage. Calling next yields once then returns CONTINUE; omitting next returns HALT, and the violation reporter is required.',
      quickStart:
        "const trim = adaptSyncStageToGenerator(\n  (value: string, next) => next(value.trim()),\n  (violation) => diagnostics.report('trim', violation)\n)\n\nrunGeneratorMiddleware([trim, generatorStage], input, done)",
      scenarios: [
        'A synchronous next-style stage must join a generator pipeline without semantic drift.',
        'No-next short-circuiting must map explicitly to GENERATOR_HALT.',
        'Duplicate or late next calls must remain observable during migration.'
      ],
      avoidWhen: [
        'The source stage is asynchronous.',
        'The source stage needs to yield more than one value.',
        'There is no explicit owner for the required violation reporter.'
      ],
      options: []
    },
    zh: {
      purpose:
        '把同步 next-style stage 提升为同步 generator stage。调用 next 会 yield 一次并 return CONTINUE；不调用则 return HALT，且 violation reporter 必填。',
      quickStart:
        "const trim = adaptSyncStageToGenerator(\n  (value: string, next) => next(value.trim()),\n  (violation) => diagnostics.report('trim', violation)\n)\n\nrunGeneratorMiddleware([trim, generatorStage], input, done)",
      scenarios: [
        '同步 next-style stage 必须无语义漂移地接入 generator pipeline。',
        '未调用 next 的短路必须明确映射到 GENERATOR_HALT。',
        '迁移期间 duplicate 或 late next 仍需可观察。'
      ],
      avoidWhen: ['源 stage 是异步的。', '源 stage 需要 yield 多个值。', '没有 owner 接管必填 violation reporter。'],
      options: []
    }
  },
  'middleware-pipeline:index:adaptGeneratorStageToAsyncGenerator': {
    en: {
      purpose:
        'Lifts a synchronous generator stage into an async generator without changing yielded values, terminal sentinels, or thrown-error identity.',
      quickStart:
        "const asyncTrim = adaptGeneratorStageToAsyncGenerator(function* (value: string) {\n  yield value.trim()\n  return GENERATOR_CONTINUE\n})\n\nawait runAsyncGeneratorMiddleware([asyncTrim, asyncStage], input, done)",
      scenarios: [
        'A synchronous generator stage must be reused in an otherwise async-generator chain.',
        'Yield and terminal sentinel identity must remain unchanged.',
        'Migration should add asynchronous compatibility without rewriting the source stage.'
      ],
      avoidWhen: [
        'The source is a recursive async next-style stage; that control algebra cannot be lifted losslessly.',
        'The source generator itself must perform asynchronous iterator work.',
        'A direct native async-generator implementation is already available.'
      ],
      options: []
    },
    zh: {
      purpose:
        '把同步 generator stage 提升为 async generator，不改变 yielded value、terminal sentinel 或 thrown error identity。',
      quickStart:
        "const asyncTrim = adaptGeneratorStageToAsyncGenerator(function* (value: string) {\n  yield value.trim()\n  return GENERATOR_CONTINUE\n})\n\nawait runAsyncGeneratorMiddleware([asyncTrim, asyncStage], input, done)",
      scenarios: [
        '同步 generator stage 必须复用到其余均为 async-generator 的 chain。',
        'yield 与 terminal sentinel identity 必须保持不变。',
        '迁移只增加异步兼容，不应重写源 stage。'
      ],
      avoidWhen: [
        '源是递归 async next-style stage；该控制代数无法无损提升。',
        '源 generator 自身必须执行异步 iterator 工作。',
        '已经存在直接的原生 async-generator 实现。'
      ],
      options: []
    }
  },
  'middleware-pipeline:index:adaptSyncStageToAsyncGenerator': {
    en: {
      purpose:
        'Lifts a synchronous next-style stage through the generator contract into an async-generator chain, preserving halt/continue mapping and required violation reporting.',
      quickStart:
        "const asyncTrim = adaptSyncStageToAsyncGenerator(\n  (value: string, next) => next(value.trim()),\n  (violation) => diagnostics.report('trim', violation)\n)\n\nawait runAsyncGeneratorMiddleware([asyncTrim, asyncGeneratorStage], input, done)",
      scenarios: [
        'A legacy synchronous next-style stage must join an async-generator chain.',
        'No-next must halt while one accepted next becomes one yield plus CONTINUE.',
        'The migration boundary must retain duplicate and late-call diagnostics.'
      ],
      avoidWhen: [
        'The source stage performs asynchronous work.',
        'The source must produce multiple yielded values.',
        'The desired target is async next-style middleware rather than async-generator middleware.'
      ],
      options: []
    },
    zh: {
      purpose:
        '经 generator 契约把同步 next-style stage 提升到 async-generator chain，保持 halt/continue 映射与必填 violation reporting。',
      quickStart:
        "const asyncTrim = adaptSyncStageToAsyncGenerator(\n  (value: string, next) => next(value.trim()),\n  (violation) => diagnostics.report('trim', violation)\n)\n\nawait runAsyncGeneratorMiddleware([asyncTrim, asyncGeneratorStage], input, done)",
      scenarios: [
        '旧同步 next-style stage 必须接入 async-generator chain。',
        '未调用 next 必须 halt；一次接纳的 next 必须变成一次 yield 加 CONTINUE。',
        '迁移边界必须保留 duplicate 与 late-call 诊断。'
      ],
      avoidWhen: [
        '源 stage 执行异步工作。',
        '源 stage 必须产生多个 yielded value。',
        '目标其实是 async next-style middleware，而不是 async-generator middleware。'
      ],
      options: []
    }
  },
  'capability:index:createCapabilityHost': {
    en: {
      purpose:
        'Creates a tenant-local runtime gate that owns lazy capability activation, structured enablement results, revocation, and physical handle cleanup. Code stays out of the initial bundle only when activate performs a dynamic import.',
      quickStart:
        "const host = createCapabilityHost({ tenantId }, {\n  flags: { persistence: true },\n  onError: (name, error) => diagnostics.report(name, error)\n})\n\nhost.register({\n  name: 'persistence',\n  async activate(context) {\n    const { openPersistence } = await import('./persistence.js')\n    return openPersistence(context.tenantId)\n  }\n})\n\ntry {\n  const result = await host.enable('persistence')\n  if (result.status === CapabilityEnableStatus.enabled) {\n    await host.handle('persistence')?.sync()\n  }\n} finally {\n  await host.dispose()\n}",
      scenarios: [
        'A feature must be enabled per tenant, rollout, or runtime configuration without sharing state across hosts.',
        'A disabled feature should avoid downloading its implementation until activate executes a dynamic import.',
        'Closing a gate must invalidate in-flight activation and release any late or currently owned handle.'
      ],
      avoidWhen: [
        'Capabilities have required dependency edges; use a static or dynamic Capability Graph instead.',
        'The implementation is statically imported and bundle removal is the only goal; the Host cannot tree-shake that import.',
        'The caller cannot provide a real dispose method for every successfully activated handle.'
      ],
      options: [
        {
          name: 'flags',
          description:
            'Initial deny-by-default gate snapshot. Only own enumerable data properties whose value is exactly true are admitted; later mutation of the input object has no effect.',
          defaultValue: '{} (every capability is gated)',
          type: 'Readonly<Record<string, boolean>>',
          whenToUse:
            'Provide the complete initial rollout decision, then use setFlag or setFlags for later changes.',
          example: "createCapabilityHost(context, { flags: { persistence: true } })"
        },
        {
          name: 'onError',
          description:
            'Observes activation, release, and late-result failures by capability name. Reporter failure is contained and never rewrites the Host state machine.',
          defaultValue: 'undefined (no diagnostic sink)',
          type: '(name: string, error: unknown) => void',
          whenToUse: 'Connect lifecycle failures to the application diagnostic owner.',
          example: 'createCapabilityHost(context, { onError: (name, error) => report(name, error) })'
        }
      ]
    },
    zh: {
      purpose:
        '创建租户隔离的运行时闸门，统一拥有惰性能力激活、结构化启用结果、撤销与 handle 物理清理。只有 activate 内执行动态 import，关闭的实现才不会进入初始包。',
      quickStart:
        "const host = createCapabilityHost({ tenantId }, {\n  flags: { persistence: true },\n  onError: (name, error) => diagnostics.report(name, error)\n})\n\nhost.register({\n  name: 'persistence',\n  async activate(context) {\n    const { openPersistence } = await import('./persistence.js')\n    return openPersistence(context.tenantId)\n  }\n})\n\ntry {\n  const result = await host.enable('persistence')\n  if (result.status === CapabilityEnableStatus.enabled) {\n    await host.handle('persistence')?.sync()\n  }\n} finally {\n  await host.dispose()\n}",
      scenarios: [
        '按租户、灰度或运行时配置启停能力，并让不同 Host 的状态互不影响。',
        '关闭的能力要等 activate 动态 import 时才下载实现。',
        '关闭闸门时必须作废在途激活，并释放迟到或当前持有的 handle。'
      ],
      avoidWhen: [
        '能力之间存在 required dependency edge；应改用静态或动态 Capability Graph。',
        '实现已经静态 import，唯一目标只是减小 bundle；Host 无法替静态 import 做 tree-shaking。',
        '调用方无法为每个成功激活的 handle 提供真实 dispose。'
      ],
      options: [
        {
          name: 'flags',
          description:
            '默认拒绝的初始闸门快照。只接纳值严格等于 true 的自有可枚举数据属性；之后修改输入对象不会改变 Host。',
          defaultValue: '{}（所有能力均 gated）',
          type: 'Readonly<Record<string, boolean>>',
          whenToUse: '提供完整初始灰度决策；后续变化必须调用 setFlag 或 setFlags。',
          example: "createCapabilityHost(context, { flags: { persistence: true } })"
        },
        {
          name: 'onError',
          description:
            '按能力名观察激活、释放与迟到结果失败。reporter 自身失败会被隔离，不会改写 Host 状态机。',
          defaultValue: 'undefined（不接诊断 sink）',
          type: '(name: string, error: unknown) => void',
          whenToUse: '把生命周期失败接入应用拥有的诊断系统。',
          example: 'createCapabilityHost(context, { onError: (name, error) => report(name, error) })'
        }
      ]
    }
  },
  'capability:index:snapshotGraphReadiness': {
    en: {
      purpose:
        'Takes one immutable admission snapshot from an external readiness source, reading state before error exactly once. It is a low-level Host-to-Graph bridge, not a live subscription.',
      quickStart:
        "const readiness = snapshotGraphReadiness({\n  state: remoteHealth.ok ? 'ready' : 'blocked',\n  error: remoteHealth.error\n})\n\nconst tray = createTray([{ ...serviceEntry, readiness }])",
      scenarios: [
        'A composition root must admit an external readiness fact before starting its graph.',
        'Getter order and one-time reads matter because the source can be stateful or cross a proxy boundary.',
        'The admitted result must be frozen so later source changes cannot rewrite the decision.'
      ],
      avoidWhen: [
        'The caller needs ongoing health updates; use an owned subscription and create a new admission decision.',
        'The Graph already owns readiness through ready(), state, and error.',
        'The source uses a custom state outside ready, blocked, or failed.'
      ],
      options: []
    },
    zh: {
      purpose:
        '从外部 readiness source 取得一次不可变准入快照，严格先读 state、再读 error，且各读一次。它是 Host 到 Graph 的低层桥接，不是实时订阅。',
      quickStart:
        "const readiness = snapshotGraphReadiness({\n  state: remoteHealth.ok ? 'ready' : 'blocked',\n  error: remoteHealth.error\n})\n\nconst tray = createTray([{ ...serviceEntry, readiness }])",
      scenarios: [
        '组合根启动 Graph 前必须接纳一份外部 readiness 事实。',
        'source 可能有状态或跨 Proxy 边界，因此 getter 顺序和只读一次必须固定。',
        '准入结果必须冻结，避免 source 后续变化改写已作出的决定。'
      ],
      avoidWhen: [
        '需要持续健康状态更新；应使用自有订阅并重新建立准入决策。',
        'Graph 已经通过 ready()、state 与 error 拥有 readiness。',
        'source 使用 ready、blocked、failed 之外的自定义状态。'
      ],
      options: []
    }
  },
  'capability:graph:createCapabilityGraph': {
    en: {
      purpose:
        'Creates a closed static required-edge graph. Register the complete node inventory before the first ready(), then let the Graph own deterministic startup, rollback, direct-provider reads, and reverse-topology release.',
      quickStart:
        "const config = 'config' as IGraphNodeId\nconst service = 'service' as IGraphNodeId\nconst graph = createCapabilityGraph({ onError: reportCleanupFailure })\n\ngraph.register({\n  id: config, kind: 'value', dependencies: [],\n  start: () => ({ value: loadConfig(), release: () => undefined })\n})\ngraph.register({\n  id: service, kind: 'service',\n  dependencies: [{ provider: config, required: true }],\n  start: ({ get }) => {\n    const value = createService(get(config))\n    return { value, release: () => value.close() }\n  }\n})\n\ntry {\n  await graph.ready()\n  await graph.get(service, config)\n} finally {\n  await graph.dispose()\n}",
      scenarios: [
        'The full service and resource dependency graph is known before startup.',
        'Startup must be stable by registration order within each topology level.',
        'A failed node must roll back already-started nodes and all provisional resources.'
      ],
      avoidWhen: [
        'Nodes must be registered, replaced, or removed after ready; use createDynamicCapabilityGraph.',
        'Only feature flags are needed and there are no dependency edges; use createCapabilityHost.',
        'A node needs to read an undeclared or transitive provider directly.'
      ],
      options: [
        {
          name: 'onError',
          description:
            'Observes cleanup and late-result failures without replacing the primary ready or dispose failure. Reporter failure is contained.',
          defaultValue: 'undefined (no diagnostic sink)',
          type: '(error: unknown) => void',
          whenToUse: 'Connect secondary lifecycle failures to diagnostics while preserving transaction identity.',
          example: 'createCapabilityGraph({ onError: reportCleanupFailure })'
        }
      ]
    },
    zh: {
      purpose:
        '创建封闭的静态 required-edge Graph。首次 ready() 前登记完整节点清单，由 Graph 拥有确定性启动、失败回滚、direct provider 读取与逆拓扑释放。',
      quickStart:
        "const config = 'config' as IGraphNodeId\nconst service = 'service' as IGraphNodeId\nconst graph = createCapabilityGraph({ onError: reportCleanupFailure })\n\ngraph.register({\n  id: config, kind: 'value', dependencies: [],\n  start: () => ({ value: loadConfig(), release: () => undefined })\n})\ngraph.register({\n  id: service, kind: 'service',\n  dependencies: [{ provider: config, required: true }],\n  start: ({ get }) => {\n    const value = createService(get(config))\n    return { value, release: () => value.close() }\n  }\n})\n\ntry {\n  await graph.ready()\n  await graph.get(service, config)\n} finally {\n  await graph.dispose()\n}",
      scenarios: [
        '完整服务与资源依赖图在启动前已知。',
        '同一 topology level 内必须按注册顺序稳定启动。',
        '某节点启动失败时必须回滚已启动节点与全部 provisional resource。'
      ],
      avoidWhen: [
        'ready 后仍要注册、替换或移除节点；应使用 createDynamicCapabilityGraph。',
        '只有 feature flag，没有依赖边；应使用 createCapabilityHost。',
        '节点需要直接读取未声明或传递 provider。'
      ],
      options: [
        {
          name: 'onError',
          description:
            '观察清理与迟到结果失败，不替换 ready 或 dispose 的主失败；reporter 自身失败会被隔离。',
          defaultValue: 'undefined（不接诊断 sink）',
          type: '(error: unknown) => void',
          whenToUse: '在保留事务错误 identity 的同时，把次级生命周期失败接入诊断系统。',
          example: 'createCapabilityGraph({ onError: reportCleanupFailure })'
        }
      ]
    }
  },
  'capability:graph-dynamic:createDynamicCapabilityGraph': {
    en: {
      purpose:
        'Creates a serialized mutable required-edge graph. Each register, replace, or remove reconciles only the affected consumer closure and preserves exact binding-generation leases until physical release is safe.',
      quickStart:
        "const cache = 'cache' as IGraphNodeId\nconst graph = createDynamicCapabilityGraph({\n  mutationAdmissionMs: 1_000,\n  report: reportCleanupFailure\n})\n\nawait graph.register({\n  id: cache, kind: 'cache', dependencies: [],\n  start: () => {\n    const value = openMemoryCache()\n    return { value, release: () => value.close() }\n  }\n})\nawait graph.ready()\n\nconst mutation = await graph.replace({\n  id: cache, kind: 'cache', dependencies: [],\n  start: () => {\n    const value = openDistributedCache()\n    return { value, release: () => value.close() }\n  }\n})\nconsole.log(mutation.affected, mutation.metrics)",
      scenarios: [
        'Services must be registered, replaced, or removed while the composition root remains alive.',
        'Only the changed node and its transitive consumers should restart.',
        'Escaped bindings need exact generation leases so old physical cleanup cannot invalidate a replacement.'
      ],
      avoidWhen: [
        'The complete graph is known before startup and never mutates; prefer createCapabilityGraph.',
        'The caller expects parallel mutations; the graph intentionally serializes mutation authority.',
        'A custom batch hook cannot own startup, rollback, release fencing, and diagnostics as one lifecycle.'
      ],
      options: [
        {
          name: 'report',
          description:
            'Receives contained startup, release, and late failures without replacing the mutation primary result.',
          defaultValue: 'undefined (no diagnostic sink)',
          type: '(error: unknown) => void',
          whenToUse: 'Route secondary lifecycle failures to the composition diagnostic owner.',
          example: 'createDynamicCapabilityGraph({ report: reportCleanupFailure })'
        },
        {
          name: 'mutationAdmissionMs',
          description:
            'Maximum queue wait for an accepted mutation behind older serialized work. It does not time out node startup or release.',
          defaultValue: 'undefined (unbounded queue wait)',
          type: 'number',
          whenToUse: 'Reject stale control-plane mutations that cannot wait indefinitely behind prior work.',
          example: 'createDynamicCapabilityGraph({ mutationAdmissionMs: 1_000 })'
        },
        {
          name: 'startBatch',
          description:
            'Transfers physical startup of one topologically ordered affected frontier to a composition owner.',
          defaultValue: 'calls each definition.start',
          type: '(entries: readonly IGraphStartEntry<TBinding>[]) => readonly IGraphNodeInstance<unknown>[] | PromiseLike<readonly IGraphNodeInstance<unknown>[]>',
          whenToUse:
            'Set only when the same composition layer owns batch startup, rollback, and the matching release path.',
          example: 'createDynamicCapabilityGraph({ startBatch: (entries) => owner.start(entries) })'
        },
        {
          name: 'releaseBatch',
          description:
            'Transfers physical release of one sealed cascade. The supplied fence resolves only after all exact old-generation leases reach zero.',
          defaultValue: 'calls each instance.release after its lease fence',
          type: '(entries: readonly IGraphReleaseEntry<TBinding>[], fence: Promise<void>) => void | PromiseLike<void>',
          whenToUse:
            'Set together with startBatch when one composition layer can await the fence before disposing old bindings.',
          example: 'createDynamicCapabilityGraph({ releaseBatch: async (entries, fence) => { await fence; await owner.release(entries) } })'
        }
      ]
    },
    zh: {
      purpose:
        '创建串行化的可变 required-edge Graph。每次 register、replace 或 remove 只协调受影响 consumer 闭包，并用精确 binding-generation lease 等到物理释放真正安全。',
      quickStart:
        "const cache = 'cache' as IGraphNodeId\nconst graph = createDynamicCapabilityGraph({\n  mutationAdmissionMs: 1_000,\n  report: reportCleanupFailure\n})\n\nawait graph.register({\n  id: cache, kind: 'cache', dependencies: [],\n  start: () => {\n    const value = openMemoryCache()\n    return { value, release: () => value.close() }\n  }\n})\nawait graph.ready()\n\nconst mutation = await graph.replace({\n  id: cache, kind: 'cache', dependencies: [],\n  start: () => {\n    const value = openDistributedCache()\n    return { value, release: () => value.close() }\n  }\n})\nconsole.log(mutation.affected, mutation.metrics)",
      scenarios: [
        '组合根存活期间仍需注册、替换或移除服务。',
        '只应重启变化节点及其传递 consumers。',
        'escaped binding 需要精确 generation lease，避免旧物理清理破坏替代项。'
      ],
      avoidWhen: [
        '完整图在启动前已知且永不变更；优先使用 createCapabilityGraph。',
        '调用方期望 mutation 并行执行；Graph 有意集中并串行化 mutation authority。',
        '自定义 batch hook 无法同时拥有启动、回滚、release fence 与诊断。'
      ],
      options: [
        {
          name: 'report',
          description: '接收被隔离的启动、释放与迟到失败，不替换 mutation 主结果。',
          defaultValue: 'undefined（不接诊断 sink）',
          type: '(error: unknown) => void',
          whenToUse: '把次级生命周期失败交给组合层诊断 owner。',
          example: 'createDynamicCapabilityGraph({ report: reportCleanupFailure })'
        },
        {
          name: 'mutationAdmissionMs',
          description:
            '已接纳 mutation 在更早串行任务后的最大排队时间；不限制节点启动或释放的执行时间。',
          defaultValue: 'undefined（不限制排队等待）',
          type: 'number',
          whenToUse: '控制面 mutation 过时后不应继续无限等待前序工作时设置。',
          example: 'createDynamicCapabilityGraph({ mutationAdmissionMs: 1_000 })'
        },
        {
          name: 'startBatch',
          description: '把一个已按拓扑排序的 affected frontier 的物理启动交给组合 owner。',
          defaultValue: '逐项调用 definition.start',
          type: '(entries: readonly IGraphStartEntry<TBinding>[]) => readonly IGraphNodeInstance<unknown>[] | PromiseLike<readonly IGraphNodeInstance<unknown>[]>',
          whenToUse: '仅当同一组合层同时拥有 batch 启动、回滚与对应释放路径时设置。',
          example: 'createDynamicCapabilityGraph({ startBatch: (entries) => owner.start(entries) })'
        },
        {
          name: 'releaseBatch',
          description:
            '把一个 sealed cascade 的物理释放交给组合 owner；传入 fence 只在旧 generation 的精确 lease 全部归零后 resolve。',
          defaultValue: 'lease fence 后逐项调用 instance.release',
          type: '(entries: readonly IGraphReleaseEntry<TBinding>[], fence: Promise<void>) => void | PromiseLike<void>',
          whenToUse: '与 startBatch 一起设置，并保证旧 binding 在 fence 前不会 dispose。',
          example: 'createDynamicCapabilityGraph({ releaseBatch: async (entries, fence) => { await fence; await owner.release(entries) } })'
        }
      ]
    }
  },
  'capability:graph-topology:buildCapabilityTopology': {
    en: {
      purpose:
        'Builds a pure immutable required-edge topology snapshot with deterministic order, levels, and both adjacency directions. It owns no node startup, state, rollback, or release.',
      quickStart:
        "const topology = buildCapabilityTopology(\n  [\n    { id: 'config', ordinal: 0, dependencies: [] },\n    { id: 'service', ordinal: 1, dependencies: [{ provider: 'config', required: true }] }\n  ],\n  (node, provider) => { throw new Error(`${node} requires unknown ${provider}`) },\n  (path) => { throw new Error(`cycle: ${path.join(' -> ')}`) },\n  (reason, node) => { throw new Error(`${reason}: ${node ?? 'graph'}`) }\n)\n\nconsole.log(topology.ordered.map((node) => node.id))",
      scenarios: [
        'A framework or composition owner already owns lifecycle but needs one canonical topology oracle.',
        'Scheduling must be stable by contiguous public registration ordinal.',
        'Both provider-to-consumer and consumer-to-provider snapshots are needed without mutable Map exposure.'
      ],
      avoidWhen: [
        'Application code needs nodes to start and release; choose a static or dynamic Capability Graph.',
        'Ordinals are sparse, duplicated, or not owned by the caller.',
        'Optional, notification, or runtime-discovered edges are required; this primitive accepts required edges only.'
      ],
      options: []
    },
    zh: {
      purpose:
        '构建纯粹且不可变的 required-edge 拓扑快照，包含确定性顺序、level 与双向邻接；它不拥有节点启动、状态、回滚或释放。',
      quickStart:
        "const topology = buildCapabilityTopology(\n  [\n    { id: 'config', ordinal: 0, dependencies: [] },\n    { id: 'service', ordinal: 1, dependencies: [{ provider: 'config', required: true }] }\n  ],\n  (node, provider) => { throw new Error(`${node} requires unknown ${provider}`) },\n  (path) => { throw new Error(`cycle: ${path.join(' -> ')}`) },\n  (reason, node) => { throw new Error(`${reason}: ${node ?? 'graph'}`) }\n)\n\nconsole.log(topology.ordered.map((node) => node.id))",
      scenarios: [
        '框架或组合 owner 已拥有 lifecycle，只缺一个 canonical topology oracle。',
        '调度必须依据连续的公开注册 ordinal 保持稳定。',
        '需要 provider-to-consumer 与 consumer-to-provider 快照，又不能暴露可变 Map。'
      ],
      avoidWhen: [
        '应用代码需要真实启动与释放节点；应选择静态或动态 Capability Graph。',
        'ordinal 稀疏、重复，或不由调用方拥有。',
        '需要 optional、notification 或运行时发现的 edge；此原语只接纳 required edge。'
      ],
      options: []
    }
  },
  'tray:index:createTray': {
    en: {
      purpose:
        'Creates one immutable static composition root. It admits the complete entry graph synchronously, starts entries only after the first ready() call, and releases owned values and auxiliary resources in reverse dependency order.',
      quickStart:
        "const configKey = 'config' as ITrayKey\nconst serviceKey = 'service' as ITrayKey\n\nconst tray = createTray([\n  { key: configKey, kind: 'value', start: () => ({ value: { baseUrl: '/api' }, release: () => undefined }) },\n  {\n    key: serviceKey,\n    kind: 'service',\n    requires: [configKey],\n    start: ({ get }) => ({ value: createClient(get(configKey)), release: () => undefined })\n  }\n])\n\ntry {\n  await tray.ready()\n  const service = tray.get(serviceKey)\n  await service.run()\n} finally {\n  await tray.dispose()\n}",
      scenarios: [
        'The complete set of configuration, services, resources, and derived values is known before startup.',
        'Entries must start after their declared dependencies and release in reverse dependency order.',
        'A readiness gate must fail before any entry starts and repeated ready() calls must share one Promise.'
      ],
      avoidWhen: [
        'Definitions must be added, replaced, or removed after startup; use the managed Host path instead.',
        'The requirement is UI notification, cross-realm transport, or forced host termination.',
        'An entry can remain pending forever without owning its own deadline or cancellation policy.'
      ],
      options: [
        {
          name: 'entries',
          description:
            'Complete ordered entry inventory snapshotted during synchronous admission. Later mutations to the caller array or entry objects do not change the accepted topology.',
          defaultValue: 'required',
          optional: false,
          type: 'readonly ITrayEntryDefinition<unknown>[]',
          whenToUse: 'Declare the entire static composition root before calling createTray().',
          example: 'createTray([configEntry, serviceEntry])'
        },
        {
          name: 'entries[].key',
          description: 'Non-empty unique identity used by requires, get(), entryState(), and diagnostics.',
          defaultValue: 'required',
          optional: false,
          type: 'ITrayKey',
          whenToUse: 'Use one centrally maintained semantic key for each owned capability.',
          example: "{ key: 'database' as ITrayKey, kind: 'service', start }"
        },
        {
          name: 'entries[].kind',
          description:
            'Diagnostic and topology category. It does not change the TypeScript type of the produced value.',
          defaultValue: 'required',
          optional: false,
          type: "'value' | 'computed' | 'resource' | 'service'",
          whenToUse: 'Choose the category that communicates the owned value lifecycle.',
          example: "{ key, kind: 'resource', start }"
        },
        {
          name: 'entries[].requires',
          description:
            'Declared provider keys that must be ready before start runs. Every key must exist in the same inventory and cannot refer to itself.',
          defaultValue: '[]',
          type: 'readonly ITrayKey[]',
          whenToUse: 'List every capability read through context.get(); do not rely on declaration order.',
          example: '{ key: apiKey, kind: \'service\', requires: [configKey], start }'
        },
        {
          name: 'entries[].readiness',
          description:
            'Optional external gate read once during the first ready() call. blocked or failed rejects before the graph starts.',
          defaultValue: 'undefined',
          type: 'IGraphReadinessSnapshot',
          whenToUse: 'Provide it when startup depends on an externally owned readiness decision.',
          example: "{ key, kind: 'service', readiness: { state: 'ready' }, start }"
        },
        {
          name: 'entries[].start',
          description:
            'Required factory called after dependencies are ready. It returns value plus release and may own auxiliary resources through context.own().',
          defaultValue: 'required',
          optional: false,
          type: '(context: ITrayEntryContext) => ITrayEntryInstance<T> | PromiseLike<ITrayEntryInstance<T>>',
          whenToUse: 'Acquire the complete entry value and register every owned cleanup before returning.',
          example: '({ signal, get, own }) => ({ value: createService({ signal, get, own }), release })'
        }
      ]
    },
    zh: {
      purpose:
        '创建一个不可变静态组合根。它同步接纳完整 entry graph，只在首次 ready() 后启动，并按依赖逆序释放主 value 与辅助资源。',
      quickStart:
        "const configKey = 'config' as ITrayKey\nconst serviceKey = 'service' as ITrayKey\n\nconst tray = createTray([\n  { key: configKey, kind: 'value', start: () => ({ value: { baseUrl: '/api' }, release: () => undefined }) },\n  {\n    key: serviceKey,\n    kind: 'service',\n    requires: [configKey],\n    start: ({ get }) => ({ value: createClient(get(configKey)), release: () => undefined })\n  }\n])\n\ntry {\n  await tray.ready()\n  const service = tray.get(serviceKey)\n  await service.run()\n} finally {\n  await tray.dispose()\n}",
      scenarios: [
        '配置、服务、资源与派生值的完整集合在启动前已经确定。',
        'entry 必须在声明依赖后启动，并按依赖逆序释放。',
        'readiness gate 必须在任何 entry 启动前失败，重复 ready() 必须共享同一 Promise。'
      ],
      avoidWhen: [
        'definition 需要在启动后增加、替换或删除；应使用托管 Host 路径。',
        '需求是 UI 通知、跨 realm 传输或宿主强制终止。',
        'entry 可能永久 pending，却没有自己拥有 deadline 或取消策略。'
      ],
      options: [
        {
          name: 'entries',
          description:
            '同步 admission 时快照的完整有序 entry 清单；之后修改调用方数组或 entry 对象不会改变已接纳拓扑。',
          defaultValue: '必填',
          optional: false,
          type: 'readonly ITrayEntryDefinition<unknown>[]',
          whenToUse: '调用 createTray() 前声明完整静态组合根。',
          example: 'createTray([configEntry, serviceEntry])'
        },
        {
          name: 'entries[].key',
          description: '非空且唯一的身份，供 requires、get()、entryState() 与诊断使用。',
          defaultValue: '必填',
          optional: false,
          type: 'ITrayKey',
          whenToUse: '为每个受托管能力使用集中维护的语义 key。',
          example: "{ key: 'database' as ITrayKey, kind: 'service', start }"
        },
        {
          name: 'entries[].kind',
          description: '诊断与拓扑分类；不会改变产出 value 的 TypeScript 类型。',
          defaultValue: '必填',
          optional: false,
          type: "'value' | 'computed' | 'resource' | 'service'",
          whenToUse: '选择能表达被托管 value 生命周期的分类。',
          example: "{ key, kind: 'resource', start }"
        },
        {
          name: 'entries[].requires',
          description: 'start 前必须 ready 的 provider key；必须存在于同一清单且不能引用自身。',
          defaultValue: '[]',
          type: 'readonly ITrayKey[]',
          whenToUse: '列出 context.get() 读取的全部能力，不能依赖声明顺序碰巧可用。',
          example: '{ key: apiKey, kind: \'service\', requires: [configKey], start }'
        },
        {
          name: 'entries[].readiness',
          description: '首次 ready() 时读取一次的可选外部 gate；blocked 或 failed 会在 Graph 启动前拒绝。',
          defaultValue: 'undefined',
          type: 'IGraphReadinessSnapshot',
          whenToUse: '启动依赖外部所有者的 readiness 决策时提供。',
          example: "{ key, kind: 'service', readiness: { state: 'ready' }, start }"
        },
        {
          name: 'entries[].start',
          description: '依赖 ready 后调用的必填 factory；返回 value 与 release，并可通过 context.own() 托管辅助资源。',
          defaultValue: '必填',
          optional: false,
          type: '(context: ITrayEntryContext) => ITrayEntryInstance<T> | PromiseLike<ITrayEntryInstance<T>>',
          whenToUse: '返回前取得完整 value，并登记所有已获得资源的清理。',
          example: '({ signal, get, own }) => ({ value: createService({ signal, get, own }), release })'
        }
      ]
    }
  },
  'tray:host:createHost': {
    en: {
      purpose:
        'Creates the single Tray-managed PluginHost identity, admits the initial plugin graph, and resolves only after ready definitions are committed. All later mutations must use the returned facade so Graph bindings and Host receipts remain identical.',
      quickStart:
        "await using host = await createHost({\n  create: () => new AppHost({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: 5_000 } }),\n  plugins: [provider] as const,\n  mutationAdmissionMs: 1_000,\n  quiescenceMs: 5_000,\n  shutdown: { mode: 'bounded' },\n  report: (error) => reportDiagnostic(error)\n})\n\nawait host.use(consumer)\nawait host.unUse('provider')",
      scenarios: [
        'Plugins must be added, replaced, blocked, restarted, and removed while preserving dependency order.',
        'Logical removal may finish before physical Graph leases, pipeline work, plugin cleanup, and resource cleanup.',
        'The application needs exact inferred extensions for a bounded literal plugin tuple and a dynamic facade beyond that budget.'
      ],
      avoidWhen: [
        'The complete capability set is static before startup; createTray() is smaller and has no mutation layer.',
        'Callers intend to mutate the escaped concrete Host directly; that breaks Graph and Host receipt identity and fails closed.',
        'The host requires process isolation or forced termination rather than cooperative cancellation and cleanup.'
      ],
      options: [
        {
          name: 'create',
          description: 'Constructs the one concrete PluginHost identity owned by the managed result.',
          defaultValue: 'required',
          optional: false,
          type: '() => THost',
          whenToUse: 'Return a fresh unclaimed PluginHost; never reuse an instance already managed elsewhere.',
          example: 'create: () => new AppHost(hostOptions)'
        },
        {
          name: 'plugins',
          description: 'Initial plugin definitions snapshotted, dependency-ordered, prepared, and committed before resolution.',
          defaultValue: 'required',
          optional: false,
          type: 'TPlugins',
          whenToUse: 'Provide the initial literal tuple when exact resolved extension types are valuable.',
          example: 'plugins: [provider, consumer] as const'
        },
        {
          name: 'mutationAdmissionMs',
          description: 'Maximum non-negative wait for a serialized Graph mutation to enter execution.',
          defaultValue: 'required',
          optional: false,
          type: 'number',
          whenToUse: 'Bound queue admission separately from mutation execution owned by PluginHost.',
          example: 'mutationAdmissionMs: 1_000'
        },
        {
          name: 'quiescenceMs',
          description: 'Maximum non-negative caller wait for physical cleanup when shutdown mode is bounded.',
          defaultValue: 'required',
          optional: false,
          type: 'number',
          whenToUse: 'Choose how long a bounded operation waits before returning physicalCompletion.',
          example: 'quiescenceMs: 5_000'
        },
        {
          name: 'shutdown',
          description: 'Required shutdown policy group; select one physical cleanup waiting contract.',
          defaultValue: 'required',
          optional: false,
          type: "Readonly<{ mode: 'bounded' | 'strict-drain' }>",
          whenToUse: 'Use bounded for responsive callers or strict-drain when disposal cannot return early.',
          example: "shutdown: { mode: 'bounded' }"
        },
        {
          name: 'shutdown.mode',
          description: 'bounded may expose physicalCompletion; strict-drain waits until all physical releases finish.',
          defaultValue: 'required',
          optional: false,
          type: "'bounded' | 'strict-drain'",
          whenToUse: 'Select according to whether the caller may proceed while observing one shared completion Promise.',
          example: "shutdown: { mode: 'strict-drain' }"
        },
        {
          name: 'report',
          description: 'Receives contained lifecycle, late rejection, and cleanup diagnostics without replacing the primary result.',
          defaultValue: 'undefined',
          type: '(error: unknown) => void',
          whenToUse: 'Provide a non-throwing diagnostics sink in production.',
          example: 'report: (error) => diagnostics.capture(error)'
        }
      ]
    },
    zh: {
      purpose:
        '创建唯一由 Tray 托管的 PluginHost 身份，接纳初始插件 Graph，并且只在 ready definition 已提交后返回。后续 mutation 必须经过返回 facade，确保 Graph binding 与 Host receipt 身份一致。',
      quickStart:
        "await using host = await createHost({\n  create: () => new AppHost({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: 5_000 } }),\n  plugins: [provider] as const,\n  mutationAdmissionMs: 1_000,\n  quiescenceMs: 5_000,\n  shutdown: { mode: 'bounded' },\n  report: (error) => reportDiagnostic(error)\n})\n\nawait host.use(consumer)\nawait host.unUse('provider')",
      scenarios: [
        '插件需要在运行期增加、替换、阻塞、重启与删除，同时保持依赖顺序。',
        '逻辑删除可以先于 Graph lease、pipeline 工作、插件清理与资源清理的物理完成。',
        '有限 literal 插件 tuple 需要 exact extension 推导，超出预算后需要 dynamic facade。'
      ],
      avoidWhen: [
        '完整能力集合在启动前固定；createTray() 更小且没有 mutation 层。',
        '调用方准备直接 mutation escaped concrete Host；这会破坏 Graph 与 Host receipt 身份并 fail closed。',
        '宿主需要进程隔离或强制终止，而不是协作取消与清理。'
      ],
      options: [
        {
          name: 'create',
          description: '构造结果唯一拥有的 concrete PluginHost 身份。',
          defaultValue: '必填',
          optional: false,
          type: '() => THost',
          whenToUse: '返回全新且未被其他会话 claim 的 PluginHost，禁止复用受托管实例。',
          example: 'create: () => new AppHost(hostOptions)'
        },
        {
          name: 'plugins',
          description: '返回前完成快照、依赖排序、prepare 与 commit 的初始插件 definition。',
          defaultValue: '必填',
          optional: false,
          type: 'TPlugins',
          whenToUse: '需要精确 resolved extension 类型时提供初始 literal tuple。',
          example: 'plugins: [provider, consumer] as const'
        },
        {
          name: 'mutationAdmissionMs',
          description: '串行 Graph mutation 进入执行阶段前允许等待的最大非负毫秒数。',
          defaultValue: '必填',
          optional: false,
          type: 'number',
          whenToUse: '将队列 admission 与 PluginHost 拥有的 mutation 执行预算分别约束。',
          example: 'mutationAdmissionMs: 1_000'
        },
        {
          name: 'quiescenceMs',
          description: 'bounded shutdown 下调用方等待物理清理的最大非负毫秒数。',
          defaultValue: '必填',
          optional: false,
          type: 'number',
          whenToUse: '决定 bounded 操作何时先返回 physicalCompletion。',
          example: 'quiescenceMs: 5_000'
        },
        {
          name: 'shutdown',
          description: '必填 shutdown 策略组，只选择一套物理清理等待契约。',
          defaultValue: '必填',
          optional: false,
          type: "Readonly<{ mode: 'bounded' | 'strict-drain' }>",
          whenToUse: '响应式调用方使用 bounded；dispose 不能提前返回时使用 strict-drain。',
          example: "shutdown: { mode: 'bounded' }"
        },
        {
          name: 'shutdown.mode',
          description: 'bounded 可暴露 physicalCompletion；strict-drain 等到全部物理 release 完成。',
          defaultValue: '必填',
          optional: false,
          type: "'bounded' | 'strict-drain'",
          whenToUse: '按调用方能否先继续、同时观察同一个 completion Promise 选择。',
          example: "shutdown: { mode: 'strict-drain' }"
        },
        {
          name: 'report',
          description: '接收已隔离 lifecycle、迟到 rejection 与清理诊断，不替换主结果。',
          defaultValue: 'undefined',
          type: '(error: unknown) => void',
          whenToUse: '生产环境提供不抛异常的诊断 sink。',
          example: 'report: (error) => diagnostics.capture(error)'
        }
      ]
    }
  },
  'resource:index:Resource': {
    en: {
      purpose:
        'Owns one cancellable asynchronous value as a reactive state machine. It tracks reactive reads made before the fetcher first awaits, supersedes stale generations, and keeps loading, retry, cache, hydration, and disposal semantics in one place.',
      quickStart:
        "const runtime = createRuntime()\nconst userId = new Signal('42', runtime)\n\nconst user = new Resource(\n  ({ signal }) => fetch(`/api/users/${userId.value}`, { signal }).then((response) => response.json()),\n  runtime,\n  { ttl: 30_000, staleWhileRevalidate: true, retry: 2 }\n)\n\nconst data = await user.promise\nuser.dispose()",
      scenarios: [
        'An asynchronous value depends on Signal or Computed input and must refetch when that input changes.',
        'Old requests must never overwrite a newer generation after input changes or an explicit refetch.',
        'A Suspense reader, SSR cache, retry policy, or stale-while-revalidate view needs one shared lifecycle owner.'
      ],
      avoidWhen: [
        'The work is a single await with no reactive dependency, cancellation, retry, cache, or hydration requirement.',
        'The value is synchronous derived state; use Computed instead of introducing an asynchronous state machine.',
        'The transport does not accept the supplied abort signal and the underlying operation has non-idempotent side effects.'
      ],
      options: [
        {
          name: 'debugName',
          description:
            'Human-readable owner label exposed through reactive diagnostics; it does not affect cache identity or scheduling.',
          defaultValue: 'undefined',
          type: 'string',
          whenToUse: 'Set it when several resources appear in traces or error reports.',
          example: "new Resource(fetchUser, runtime, { debugName: 'current-user' })"
        },
        {
          name: 'ttl',
          description:
            'Milliseconds that a successful value remains fresh. Expired success values revalidate on the next tracked read.',
          defaultValue: 'Infinity',
          type: 'number',
          whenToUse:
            'Set a finite non-negative duration when remote data may become stale without a reactive dependency changing.',
          example: 'new Resource(fetchUser, runtime, { ttl: 30_000 })'
        },
        {
          name: 'autoStart',
          description:
            'Starts the first generation during construction unless a supplied initial snapshot is still fresh.',
          defaultValue: 'true',
          type: 'boolean',
          whenToUse:
            'Disable it when a route, visibility boundary, or explicit refetch must own the first request.',
          example: 'new Resource(fetchUser, runtime, { autoStart: false })'
        },
        {
          name: 'staleWhileRevalidate',
          description:
            'Keeps the previous successful data visible while a replacement request runs and exposes that transport state through refreshing.',
          defaultValue: 'false',
          type: 'boolean',
          whenToUse:
            'Enable it for refreshable screens where showing slightly stale data is preferable to returning to a pending state.',
          example: 'new Resource(fetchUser, runtime, { staleWhileRevalidate: true })'
        },
        {
          name: 'retry',
          description:
            'Number of retries or a predicate receiving the one-based failure count and original error. Suspense thenables do not consume this budget.',
          defaultValue: '0',
          type: 'number | ((failureCount: number, error: unknown) => boolean)',
          whenToUse:
            'Use a bounded count for transient idempotent reads or a predicate when error classification owns retry eligibility.',
          example:
            'new Resource(fetchUser, runtime, { retry: (count, error) => count < 3 && isTransient(error) })'
        },
        {
          name: 'retryDelay',
          description:
            'Fixed non-negative delay or a function that computes delay from the failure count and original error.',
          defaultValue: '0',
          type: 'number | ((failureCount: number, error: unknown) => number)',
          whenToUse:
            'Set it when immediate retries would amplify load; keep the delay inside the request deadline owned by the caller.',
          example: 'new Resource(fetchUser, runtime, { retryDelay: (count) => count * 250 })'
        },
        {
          name: 'keepAlive',
          description:
            'Keeps upstream reactive edges attached while no consumer observes this resource. It does not prevent explicit disposal.',
          defaultValue: 'false',
          type: 'boolean',
          whenToUse:
            'Enable it only for intentionally hot shared resources that must keep reacting without an active view.',
          example: 'new Resource(fetchUser, runtime, { keepAlive: true })'
        },
        {
          name: 'initialSnapshot',
          description:
            'Restores a version-1 successful cache snapshot before optional revalidation; invalid timestamps or versions fail construction.',
          defaultValue: 'undefined',
          type: 'IResourceCacheSnapshot<T>',
          whenToUse: 'Provide it when hydrating trusted SSR or persisted data produced by dehydrate().',
          example: 'new Resource(fetchUser, runtime, { initialSnapshot: serverSnapshot })'
        },
        {
          name: 'scheduler',
          description:
            'Owns the clock and delayed tasks used for TTL timestamps, expiry checks, and retry delays.',
          defaultValue: 'systemScheduler',
          type: 'ILifecycleScheduler',
          whenToUse:
            'Supply a manual or host scheduler for deterministic tests or a runtime that owns its own time domain.',
          example: 'new Resource(fetchUser, runtime, { scheduler: manualScheduler })'
        }
      ]
    },
    zh: {
      purpose:
        '把一个可取消的异步值作为响应式状态机统一托管。它追踪 fetcher 首次 await 前的响应式读取、淘汰过期请求代，并统一 loading、重试、缓存、hydrate 与释放语义。',
      quickStart:
        "const runtime = createRuntime()\nconst userId = new Signal('42', runtime)\n\nconst user = new Resource(\n  ({ signal }) => fetch(`/api/users/${userId.value}`, { signal }).then((response) => response.json()),\n  runtime,\n  { ttl: 30_000, staleWhileRevalidate: true, retry: 2 }\n)\n\nconst data = await user.promise\nuser.dispose()",
      scenarios: [
        '异步值依赖 Signal 或 Computed，并且输入变化后必须自动重新请求。',
        '输入变化或显式刷新后，旧请求即使更晚完成也不能覆盖新一代结果。',
        'Suspense 读取、SSR 缓存、重试策略或 stale-while-revalidate 视图需要共享同一生命周期。'
      ],
      avoidWhen: [
        '工作只是一次 await，不需要响应式依赖、取消、重试、缓存或 hydrate。',
        '数据是同步派生值；此时应使用 Computed，而不是引入异步状态机。',
        '底层传输不接收提供的 abort signal，且操作包含不可重复执行的副作用。'
      ],
      options: [
        {
          name: 'debugName',
          description: '供响应式诊断使用的人类可读所有者名称；不影响缓存身份或调度。',
          defaultValue: 'undefined',
          type: 'string',
          whenToUse: '多个资源会同时出现在 trace 或错误报告中时设置。',
          example: "new Resource(fetchUser, runtime, { debugName: 'current-user' })"
        },
        {
          name: 'ttl',
          description: '成功值保持新鲜的毫秒数；过期后，下一次追踪读取会触发重新验证。',
          defaultValue: 'Infinity',
          type: 'number',
          whenToUse: '远端数据可能在响应式依赖不变化时失效，设置有限且非负的时长。',
          example: 'new Resource(fetchUser, runtime, { ttl: 30_000 })'
        },
        {
          name: 'autoStart',
          description: '构造期间启动第一代请求；若 initialSnapshot 仍然新鲜则不重复请求。',
          defaultValue: 'true',
          type: 'boolean',
          whenToUse: '路由、可见性边界或显式 refetch 必须拥有首次请求时关闭。',
          example: 'new Resource(fetchUser, runtime, { autoStart: false })'
        },
        {
          name: 'staleWhileRevalidate',
          description: '替换请求进行时继续显示上一次成功数据，并通过 refreshing 暴露传输状态。',
          defaultValue: 'false',
          type: 'boolean',
          whenToUse: '可刷新页面更适合暂时展示旧数据，而不是重新进入 pending 时开启。',
          example: 'new Resource(fetchUser, runtime, { staleWhileRevalidate: true })'
        },
        {
          name: 'retry',
          description:
            '重试次数，或接收从 1 开始的失败次数与原始错误的判断函数；Suspense thenable 不消耗重试预算。',
          defaultValue: '0',
          type: 'number | ((failureCount: number, error: unknown) => boolean)',
          whenToUse: '幂等临时失败使用有限次数；需要按错误分类时使用判断函数。',
          example:
            'new Resource(fetchUser, runtime, { retry: (count, error) => count < 3 && isTransient(error) })'
        },
        {
          name: 'retryDelay',
          description: '固定非负延迟，或根据失败次数与原始错误计算延迟的函数。',
          defaultValue: '0',
          type: 'number | ((failureCount: number, error: unknown) => number)',
          whenToUse: '立即重试会放大负载时设置，并保证延迟不突破调用方拥有的请求 deadline。',
          example: 'new Resource(fetchUser, runtime, { retryDelay: (count) => count * 250 })'
        },
        {
          name: 'keepAlive',
          description: '无人观察时仍保留上游响应式依赖边；不会阻止显式 dispose。',
          defaultValue: 'false',
          type: 'boolean',
          whenToUse: '仅用于明确需要在没有活跃视图时继续响应变化的共享热资源。',
          example: 'new Resource(fetchUser, runtime, { keepAlive: true })'
        },
        {
          name: 'initialSnapshot',
          description:
            '在可选重新验证前恢复 version 1 成功缓存；版本或时间戳非法会令构造失败。',
          defaultValue: 'undefined',
          type: 'IResourceCacheSnapshot<T>',
          whenToUse: 'hydrate 由 dehydrate() 生成且已经信任的 SSR 或持久化数据时提供。',
          example: 'new Resource(fetchUser, runtime, { initialSnapshot: serverSnapshot })'
        },
        {
          name: 'scheduler',
          description: '统一拥有 TTL 时间戳、过期判断与重试延迟使用的时钟和延迟任务。',
          defaultValue: 'systemScheduler',
          type: 'ILifecycleScheduler',
          whenToUse: '确定性测试或宿主拥有独立时间域时传入 manual 或宿主 scheduler。',
          example: 'new Resource(fetchUser, runtime, { scheduler: manualScheduler })'
        }
      ]
    }
  },
  'logger:index:getLoggerRuntimeManager': createStorageContractGuide({
    purposeEn: 'Returns the currently authoritative process-wide Logger host capability layer by identity, including UUID, scheduling, output, HTTP, and optional process adapters.',
    purposeZh: '按 identity 返回当前 authoritative process-wide Logger host capability layer，包括 UUID、scheduling、output、HTTP 与 optional process adapter。',
    quickStart: 'const manager = getLoggerRuntimeManager()\nconst restore = setLoggerRuntimeManager({ ...manager, write: capture })\ntry { await runScenario() } finally { restore() }',
    scenariosEn: ['A scoped replacement must inherit every capability it does not intentionally override.', 'Diagnostics or tests need to confirm which runtime layer is active.'],
    scenariosZh: ['scoped replacement 需要继承所有未刻意覆盖的 capability。', 'diagnostics 或 test 需要确认当前 active runtime layer。'],
    avoidEn: ['Mutating the returned manager object.', 'Reading it repeatedly inside each log entry instead of capturing host authority at the intended boundary.'],
    avoidZh: ['修改返回的 manager object。', '在每条 log entry 中重复读取，而不是在预期 boundary 捕获 host authority。']
  }),
  'logger:index:Logger': createStorageContractGuide({
    purposeEn: 'Creates the central structured logging pipeline, owns ordered plugins and deferred output, and exposes level methods plus flush and shutdown lifecycle boundaries.',
    purposeZh: '创建 central structured logging pipeline，拥有 ordered plugin 与 deferred output，并公开 level method、flush 与 shutdown lifecycle boundary。',
    quickStart: "const logger = new Logger({ plugins: [level({ level: 'info' }), color()] })\nlogger.info('server ready', { port: 3000 })\nawait logger.flush()\nawait logger.shutdown()",
    scenariosEn: ['Structured entries need one ordered filtering, enrichment, formatting, and delivery pipeline.', 'Deferred sinks must be observable through flush and deterministically released by shutdown.'],
    scenariosZh: ['structured entry 需要统一有序 filtering、enrichment、formatting 与 delivery pipeline。', 'deferred sink 必须可由 flush 观察，并由 shutdown deterministic release。'],
    avoidEn: ['A one-off host console call is sufficient.', 'Several Logger instances would accidentally duplicate the same process or HTTP sink ownership.'],
    avoidZh: ['一次 host console call 已足够。', '多个 Logger instance 会意外重复拥有相同 process 或 HTTP sink。']
  }),
  'logger:plugins:batch': createStorageContractGuide({
    purposeEn: 'Buffers output entries into bounded batches, flushing by size or elapsed time while constraining active and queued batch callbacks.',
    purposeZh: '把 output entry 缓冲为 bounded batch，按 size 或 elapsed time flush，同时限制 active 与 queued batch callback。',
    quickStart: 'const logger = new Logger({ plugins: [batch({ maxSize: 100, maxWaitMs: 1_000, maxConcurrentBatches: 2, maxPendingBatches: 8 })] })',
    scenariosEn: ['A sink is more efficient when several entries share one delivery.', 'Low-volume traffic still needs a maximum delivery delay and explicit overflow.'],
    scenariosZh: ['多个 entry 合并 delivery 时 sink 更高效。', '低流量仍需要 maximum delivery delay 与显式 overflow。'],
    avoidEn: ['Every entry must be delivered synchronously.', 'The owner cannot accept buffered durability or bounded queue semantics.'],
    avoidZh: ['每个 entry 都必须同步 delivery。', 'owner 无法接受 buffered durability 或 bounded queue semantics。']
  }),
  'logger:plugins:color': createStorageContractGuide({
    purposeEn: 'Renders human-oriented console output with runtime-aware ANSI policy, stable tag colors, and selectable message color coverage.',
    purposeZh: '使用 runtime-aware ANSI policy、稳定 tag color 与可选 message color coverage 渲染 human-oriented console output。',
    quickStart: "const logger = new Logger({ plugins: [color({ color: 'auto', format: 'pretty', timestamp: true })] })",
    scenariosEn: ['Interactive terminal output needs readable severity and tag hierarchy.', 'One renderer must adapt between TTY color and non-color capture.'],
    scenariosZh: ['interactive terminal output 需要易读 severity 与 tag hierarchy。', '同一 renderer 需要适应 TTY color 与 non-color capture。'],
    avoidEn: ['The sink consumes machine JSON.', 'ANSI sequences would corrupt a file, protocol, or snapshot.'],
    avoidZh: ['sink 消费 machine JSON。', 'ANSI sequence 会污染 file、protocol 或 snapshot。']
  }),
  'logger:plugins:http': createStorageContractGuide({
    purposeEn: 'Delivers structured entry arrays to an HTTP endpoint with bounded attempts, per-attempt timeout, Retry-After capping, headers, and optional batch overrides.',
    purposeZh: '把 structured entry array 发送到 HTTP endpoint，并提供 bounded attempt、per-attempt timeout、Retry-After cap、header 与 optional batch override。',
    quickStart: "const logger = new Logger({ plugins: [batch(), http({ url: '/logs', retries: 2, requestTimeoutMs: 5_000 })] })",
    scenariosEn: ['Logs must reach a remote collector through a host-owned fetch boundary.', 'Transient network, 429, and server failures need bounded retry without hiding permanent client errors.'],
    scenariosZh: ['log 需要通过 host-owned fetch boundary 到达 remote collector。', 'transient network、429 与 server failure 需要 bounded retry，且不能隐藏 permanent client error。'],
    avoidEn: ['Credentials or unbounded retry ownership would be embedded in Logger.', 'The environment cannot provide fetch or an explicit HTTP adapter.'],
    avoidZh: ['credential 或 unbounded retry ownership 会被嵌入 Logger。', 'environment 无法提供 fetch 或显式 HTTP adapter。']
  }),
  'logger:plugins:level': createStorageContractGuide({
    purposeEn: 'Rejects entries below a minimum severity and applies additional predicates before downstream hooks and sinks perform work.',
    purposeZh: '在 downstream hook 与 sink 执行前，拒绝低于 minimum severity 的 entry，并应用 additional predicate。',
    quickStart: "const logger = new Logger({ plugins: [level({ level: 'info', filters: [(entry) => entry.tag !== 'healthcheck'] })] })",
    scenariosEn: ['Production output needs a stable minimum severity.', 'Several admission predicates must compose with logical AND at the pipeline entrance.'],
    scenariosZh: ['production output 需要稳定 minimum severity。', '多个 admission predicate 需要在 pipeline entrance 以 logical AND 组合。'],
    avoidEn: ['Filtering belongs to one remote query rather than the logging pipeline.', 'A predicate has side effects or may throw as normal control flow.'],
    avoidZh: ['filtering 只属于一次 remote query，而不是 logging pipeline。', 'predicate 含 side effect，或可能把 throw 当正常 control flow。']
  }),
  'logger:plugins:process': createStorageContractGuide({
    purposeEn: 'Bridges process signals, crashes, rejection events, and optional exit interception into bounded Logger drain and shutdown behavior.',
    purposeZh: '把 process signal、crash、rejection event 与 optional exit interception 接入 bounded Logger drain 与 shutdown behavior。',
    quickStart: 'const logger = new Logger({ plugins: [process({ captureCrashes: true, shutdownTimeoutMs: 2_000 })] })',
    scenariosEn: ['A process host must attempt bounded log drain before termination.', 'Uncaught failures need one observable capture and reporting path.'],
    scenariosZh: ['process host 需要在 termination 前尝试 bounded log drain。', 'uncaught failure 需要统一 observable capture 与 reporting path。'],
    avoidEn: ['Browser or Worker code has no process lifecycle authority.', 'Another framework already owns signals and process.exit interception.'],
    avoidZh: ['browser 或 Worker code 没有 process lifecycle authority。', '其他 framework 已经拥有 signal 与 process.exit interception。']
  }),
  'logger:plugins:reasoning': createStorageContractGuide({
    purposeEn: 'Adds explicit reasoning and response stream phase methods with configurable human labels while preserving structured entry tags.',
    purposeZh: '增加显式 reasoning 与 response stream phase method，并允许配置 human label，同时保留 structured entry tag。',
    quickStart: "const logger = new Logger({ plugins: [reasoning({ labels: { thinking: 'Thinking', response: 'Answer' } })] })\nlogger.reasoningStart()",
    scenariosEn: ['A streaming agent or CLI must separate thinking and response presentation phases.', 'Human labels and structured phase data must stay independently configurable.'],
    scenariosZh: ['streaming agent 或 CLI 需要区分 thinking 与 response presentation phase。', 'human label 与 structured phase data 需要独立配置。'],
    avoidEn: ['Ordinary application logs have no reasoning stream lifecycle.', 'The UI already owns all phase headings and methods add no semantic value.'],
    avoidZh: ['普通 application log 没有 reasoning stream lifecycle。', 'UI 已经拥有所有 phase heading，新增 method 没有 semantic value。']
  }),
  'logger:plugins:uuid': createStorageContractGuide({
    purposeEn: 'Adds one runtime-generated UUID to each entry for cross-sink correlation and optionally exposes it in human color output.',
    purposeZh: '为每个 entry 增加 runtime-generated UUID，用于 cross-sink correlation，并可选地在 human color output 中展示。',
    quickStart: 'const logger = new Logger({ plugins: [uuid({ display: false })] })',
    scenariosEn: ['One logical entry must be correlated across batching, HTTP, console, and diagnostics.', 'Tests provide a deterministic UUID source through the runtime manager.'],
    scenariosZh: ['同一 logical entry 需要跨 batching、HTTP、console 与 diagnostics 关联。', 'test 通过 runtime manager 提供 deterministic UUID source。'],
    avoidEn: ['The identifier would be mistaken for a security credential or distributed trace identifier.', 'The sink already assigns and owns the canonical correlation identity.'],
    avoidZh: ['identifier 会被误认为 security credential 或 distributed trace identifier。', 'sink 已经分配并拥有 canonical correlation identity。']
  }),
  'logger:index:setLoggerRuntimeManager': {
    en: {
      purpose:
        'Installs one process-wide Logger host-capability layer and returns an idempotent restoration callback. Layers may be restored out of order; the most recent still-active layer remains authoritative.',
      quickStart:
        "const restore = setLoggerRuntimeManager({\n  randomUUID: () => crypto.randomUUID(),\n  defer: (task) => queueMicrotask(task),\n  write: (text) => console.log(text),\n  fetch: (url, init) => fetch(url, init)\n})\n\ntry {\n  await runLoggerScenario()\n} finally {\n  restore()\n}",
      scenarios: [
        'A deterministic test must own UUID generation, deferred work, output, HTTP, or process events.',
        'A non-standard host must provide Logger capabilities without exposing Node globals to the core runtime.',
        'A bounded scope must temporarily replace capabilities and reliably restore the preceding active layer.'
      ],
      avoidWhen: [
        'Only one Logger instance needs different plugins or formatting; configure that Logger instead of replacing global host capabilities.',
        'Concurrent work cannot coordinate ownership of the process-wide layer stack.',
        'The replacement would silently drop required write, defer, or UUID behavior instead of providing an explicit implementation.'
      ],
      options: [
        {
          name: 'process',
          description:
            'Optional process adapter providing env, stdout, event listener registration, and exit for the process plugin.',
          defaultValue: 'undefined',
          type: 'ILoggerProcess',
          whenToUse: 'Provide it only when the host intentionally exposes process lifecycle capabilities.',
          example: 'setLoggerRuntimeManager({ ...manager, process: processAdapter })'
        },
        {
          name: 'createAbortController',
          description:
            'Optional factory used by HTTP cancellation so tests and hostile realms can own AbortController construction.',
          defaultValue: 'undefined',
          type: '() => AbortController',
          whenToUse: 'Provide it when the ambient AbortController is absent or must be instrumented.',
          example:
            'setLoggerRuntimeManager({ ...manager, createAbortController: () => new AbortController() })'
        },
        {
          name: 'randomUUID',
          description: 'Required UUID source used to create stable per-entry diagnostic identifiers.',
          defaultValue: 'required',
          optional: false,
          type: '() => string',
          whenToUse: 'Always provide a collision-resistant source, or a deterministic sequence in tests.',
          example: 'setLoggerRuntimeManager({ ...manager, randomUUID: () => crypto.randomUUID() })'
        },
        {
          name: 'defer',
          description:
            'Required scheduler that moves output work beyond the current synchronous stack while remaining observable by flush and shutdown.',
          defaultValue: 'required',
          optional: false,
          type: '(task: () => void) => void',
          whenToUse: 'Always provide a host-owned scheduling primitive with deterministic failure behavior.',
          example: 'setLoggerRuntimeManager({ ...manager, defer: (task) => queueMicrotask(task) })'
        },
        {
          name: 'write',
          description: 'Required raw text sink used when Logger emits already-rendered output.',
          defaultValue: 'required',
          optional: false,
          type: '(text: string) => void',
          whenToUse: 'Route it to the host output boundary; do not perform unbounded asynchronous work here.',
          example: 'setLoggerRuntimeManager({ ...manager, write: (text) => output.write(text) })'
        },
        {
          name: 'console',
          description:
            'Optional console-shaped sink for log, warning, and error fallback paths when structured output is unavailable.',
          defaultValue: 'undefined',
          type: '{ log(...args: unknown[]): void; warn(...args: unknown[]): void; error(...args: unknown[]): void }',
          whenToUse: 'Provide it when the host has a safe console boundary or tests need to capture fallback diagnostics.',
          example: 'setLoggerRuntimeManager({ ...manager, console: capturedConsole })'
        },
        {
          name: 'fetch',
          description:
            'Optional HTTP transport used by the HTTP plugin, including request headers, body, response status, Retry-After headers, and cancellation signal.',
          defaultValue: 'undefined',
          type: 'ILoggerRuntimeManager["fetch"]',
          whenToUse: 'Provide it before installing the HTTP plugin in hosts without a suitable global fetch.',
          example: 'setLoggerRuntimeManager({ ...manager, fetch: (url, init) => fetch(url, init) })'
        }
      ]
    },
    zh: {
      purpose:
        '安装一层进程级 Logger 宿主能力，并返回幂等恢复函数。各层可以乱序恢复；当前最后一个仍处于 active 的层继续拥有实际能力。',
      quickStart:
        "const restore = setLoggerRuntimeManager({\n  randomUUID: () => crypto.randomUUID(),\n  defer: (task) => queueMicrotask(task),\n  write: (text) => console.log(text),\n  fetch: (url, init) => fetch(url, init)\n})\n\ntry {\n  await runLoggerScenario()\n} finally {\n  restore()\n}",
      scenarios: [
        '确定性测试需要接管 UUID、延迟任务、输出、HTTP 或 process 事件。',
        '非标准宿主需要向 Logger 提供能力，但不能让核心运行时直接依赖 Node 全局对象。',
        '有界作用域需要临时替换能力，并可靠恢复替换前仍有效的上一层。'
      ],
      avoidWhen: [
        '只有一个 Logger 实例需要不同插件或格式；应配置该 Logger，而不是替换全局宿主能力。',
        '并发工作无法协调进程级 layer stack 的所有权。',
        '替换实现会静默丢弃必需的 write、defer 或 UUID 行为，而不是提供明确实现。'
      ],
      options: [
        {
          name: 'process',
          description: '可选 process adapter，为 process 插件提供 env、stdout、事件登记与 exit。',
          defaultValue: 'undefined',
          type: 'ILoggerProcess',
          whenToUse: '仅在宿主明确暴露 process 生命周期能力时提供。',
          example: 'setLoggerRuntimeManager({ ...manager, process: processAdapter })'
        },
        {
          name: 'createAbortController',
          description: 'HTTP 取消使用的可选工厂，让测试或 hostile realm 拥有 AbortController 构造权。',
          defaultValue: 'undefined',
          type: '() => AbortController',
          whenToUse: '环境没有 AbortController，或需要观测其构造与取消时提供。',
          example:
            'setLoggerRuntimeManager({ ...manager, createAbortController: () => new AbortController() })'
        },
        {
          name: 'randomUUID',
          description: '必填 UUID 来源，用于生成稳定的单条日志诊断标识。',
          defaultValue: '必填',
          optional: false,
          type: '() => string',
          whenToUse: '始终提供抗碰撞来源；测试中可提供确定性序列。',
          example: 'setLoggerRuntimeManager({ ...manager, randomUUID: () => crypto.randomUUID() })'
        },
        {
          name: 'defer',
          description: '必填调度器，把输出移出当前同步栈，同时让 flush 与 shutdown 仍能观察完成。',
          defaultValue: '必填',
          optional: false,
          type: '(task: () => void) => void',
          whenToUse: '始终提供由宿主拥有、失败行为明确的调度原语。',
          example: 'setLoggerRuntimeManager({ ...manager, defer: (task) => queueMicrotask(task) })'
        },
        {
          name: 'write',
          description: '必填原始文本 sink，用于输出 Logger 已经完成渲染的内容。',
          defaultValue: '必填',
          optional: false,
          type: '(text: string) => void',
          whenToUse: '连接宿主输出边界；不要在其中启动无界异步工作。',
          example: 'setLoggerRuntimeManager({ ...manager, write: (text) => output.write(text) })'
        },
        {
          name: 'console',
          description: '可选 console 形状 sink，在结构化输出不可用时承接 log、warning 与 error fallback。',
          defaultValue: 'undefined',
          type: '{ log(...args: unknown[]): void; warn(...args: unknown[]): void; error(...args: unknown[]): void }',
          whenToUse: '宿主拥有安全 console 边界，或测试需要捕获 fallback 诊断时提供。',
          example: 'setLoggerRuntimeManager({ ...manager, console: capturedConsole })'
        },
        {
          name: 'fetch',
          description:
            'HTTP 插件使用的可选 transport，负责请求头、body、响应状态、Retry-After 与取消 signal。',
          defaultValue: 'undefined',
          type: 'ILoggerRuntimeManager["fetch"]',
          whenToUse: '没有合适全局 fetch 的宿主在安装 HTTP 插件前提供。',
          example: 'setLoggerRuntimeManager({ ...manager, fetch: (url, init) => fetch(url, init) })'
        }
      ]
    }
  },
  'plugin-host:index:PluginHostError': {
    en: {
      purpose:
        'Represents PluginHost state and protocol failures that callers may classify by the stable (source, code) pair. The original failure remains reachable through cause, while immutable structured diagnostics belong in detail.',
      quickStart:
        "try {\n  await host.use(plugin)\n} catch (error) {\n  if (error instanceof PluginHostError) {\n    if (error.code === PluginHostErrorCode.pluginInstallFailed) {\n      console.error(error.detail?.failedName, error.cause)\n    }\n  }\n}",
      scenarios: [
        'A host operation failed and the caller must branch on a stable semantic code rather than message text.',
        'An installation or cleanup boundary must retain the primary cause together with immutable rollback or timeout diagnostics.',
        'A PluginHost subclass translates its protected disposal boundary while preserving the original error chain.'
      ],
      avoidWhen: [
        'The failure is invalid caller input that must retain its native TypeError or RangeError identity with an attached code.',
        'The value describes availability, lifecycle phase, or a graceful cleanup result rather than an exceptional failure.',
        'The caller only wants display text; compare source and code for control flow and treat message as diagnostic text.'
      ],
      options: [
        {
          name: 'code',
          description:
            'Required stable semantic code owned by PluginHostErrorCode. Together with source it forms the public failure identity.',
          defaultValue: 'required',
          optional: false,
          type: 'IPluginHostErrorCode',
          whenToUse: 'Choose the exact registered code for the boundary being reported; never invent a string.',
          example:
            'new PluginHostError(PluginHostErrorCode.hostDisposed, "host is disposed")'
        },
        {
          name: 'message',
          description:
            'Required human-readable diagnostic text. It may add context but must not become the caller control-flow contract.',
          defaultValue: 'required',
          optional: false,
          type: 'string',
          whenToUse: 'Use the canonical text maintained by this capability for the selected code.',
          example:
            'new PluginHostError(PluginHostErrorCode.hostDisposed, ERROR_TEXT.HOST_DISPOSED)'
        },
        {
          name: 'options.cause',
          description:
            'Original primary failure retained by identity so stack, native type, and nested cause traversal remain available.',
          defaultValue: 'undefined',
          type: 'unknown',
          whenToUse: 'Provide it when translating a lower-level failure at the PluginHost boundary.',
          example: 'new PluginHostError(code, message, { cause: originalError })'
        },
        {
          name: 'options.detail',
          description:
            'Immutable structured diagnostics such as failed plugin name, rollback identities, queue owner, or waited duration. It is not a replacement for cause.',
          defaultValue: 'undefined',
          type: 'TDetail',
          whenToUse:
            'Provide it for machine-readable context that is not itself the primary exception; publish a frozen snapshot.',
          example:
            'new PluginHostError(code, message, { cause, detail: Object.freeze({ failedName }) })'
        }
      ]
    },
    zh: {
      purpose:
        '表示调用方可按稳定 `(source, code)` 二元组分类的 PluginHost 状态与协议失败。原始失败通过 cause 保持可达，不可变结构化诊断放入 detail。',
      quickStart:
        "try {\n  await host.use(plugin)\n} catch (error) {\n  if (error instanceof PluginHostError) {\n    if (error.code === PluginHostErrorCode.pluginInstallFailed) {\n      console.error(error.detail?.failedName, error.cause)\n    }\n  }\n}",
      scenarios: [
        'Host 操作失败，调用方需要按稳定语义码分支，而不是比较 message。',
        '安装或清理边界必须同时保留主 cause，以及不可变的回滚或超时诊断。',
        'PluginHost 子类需要转换受保护的 disposal 边界，同时保留原始错误链。'
      ],
      avoidWhen: [
        '失败来自调用方无效输入，必须保留原生 TypeError 或 RangeError 身份并附加 code。',
        '值表达 availability、生命周期阶段或正常降级的清理结果，而不是异常失败。',
        '调用方只需要展示文本；控制流应比较 source 与 code，message 仅用于诊断。'
      ],
      options: [
        {
          name: 'code',
          description: '必填稳定语义码，由 PluginHostErrorCode 拥有；与 source 共同构成公开失败身份。',
          defaultValue: '必填',
          optional: false,
          type: 'IPluginHostErrorCode',
          whenToUse: '选择当前边界已经登记的精确错误码，禁止临时创造字符串。',
          example:
            'new PluginHostError(PluginHostErrorCode.hostDisposed, "host is disposed")'
        },
        {
          name: 'message',
          description: '必填人类可读诊断文本；可以补充上下文，但不能成为调用方控制流契约。',
          defaultValue: '必填',
          optional: false,
          type: 'string',
          whenToUse: '使用当前 code 对应、由本能力维护的规范文本。',
          example:
            'new PluginHostError(PluginHostErrorCode.hostDisposed, ERROR_TEXT.HOST_DISPOSED)'
        },
        {
          name: 'options.cause',
          description: '按身份保留原始主失败，使 stack、原生类型与嵌套 cause 遍历继续可用。',
          defaultValue: 'undefined',
          type: 'unknown',
          whenToUse: '在 PluginHost 边界转换下层失败时提供。',
          example: 'new PluginHostError(code, message, { cause: originalError })'
        },
        {
          name: 'options.detail',
          description:
            '不可变结构化诊断，例如失败插件名、回滚身份、队列 owner 或等待时长；不能替代 cause。',
          defaultValue: 'undefined',
          type: 'TDetail',
          whenToUse: '需要机器读取但本身不是主异常的上下文使用，并发布冻结快照。',
          example:
            'new PluginHostError(code, message, { cause, detail: Object.freeze({ failedName }) })'
        }
      ]
    }
  },
  'plugin-host:index:PluginHost': {
    zh: {
      purpose:
        '作为领域宿主的抽象基类，原子安装插件并发布不可变 view；它拥有配置、shared、pipeline、mutation 串行化以及逻辑撤销后的物理清理。构造时必须明确提供执行与 drain 预算。',
      quickStart:
        "type ICore = { write(message: string): void }\n\nclass AppHost extends PluginHost<ICore> {\n  protected createPluginDomainCore(): ICore {\n    return { write: (message) => console.log(message) }\n  }\n}\n\nconst host = new AppHost({\n  execution: {\n    mutationTimeoutMs: 5_000,\n    pipelineDrainTimeoutMs: 5_000\n  }\n})\n\nconst view = await host.use(greetingPlugin)\nview.extensions.greet('Migaia')\n\nconst removal = await view.unUse('greeting')\nif (removal.physicalCompletion) await removal.physicalCompletion\nawait host.dispose()",
      scenarios: [
        '应用需要按事务安装一组插件，并在其中一个安装失败时撤销整批候选状态。',
        '插件需要发布扩展、共享能力或 pipeline stage，同时由 Host 统一追踪其所有权。',
        '卸载必须先让能力从新 view 中消失，再等待在途 pipeline 与资源清理。'
      ],
      avoidWhen: [
        '功能集合在编译期固定且没有动态安装、撤销或资源所有权；直接组合对象更简单。',
        '需要自动解析插件依赖图；PluginHost 只执行已排序的安装/卸载，不维护依赖关系。',
        '需要跨进程插件沙箱或权限隔离；Host 只管理当前 JavaScript realm 内的组合。'
      ],
      options: [
        {
          name: 'execution',
          description:
            '必填的执行预算组。它分别约束已经取得执行权的 lifecycle mutation，以及插件 stage 被逻辑撤销后等待 pipeline lease 归零的时间。',
          whenToUse: '每次构造都必须提供；只有明确接受无限等待时才把子项设为 false。'
        },
        {
          name: 'execution.mutationTimeoutMs',
          description:
            '限制一次已经开始的 install、update 或 removal hook。超时会撤销该 operation 的提交资格，并通过 operation.signal 要求协作实现停止工作。',
          whenToUse:
            '按插件最慢的正常 lifecycle 操作设置有界毫秒数；无法安全规定上限时显式使用 false。',
          example:
            'new AppHost({ execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 } })'
        },
        {
          name: 'execution.pipelineDrainTimeoutMs',
          description:
            '逻辑撤销插件 stage 后，等待该插件已经开始的 pipeline lease 归零的最长时间。超时不会恢复可见能力，而是通过 cleanupComplete 与 physicalCompletion 暴露未完成清理。',
          whenToUse:
            'pipeline 可能跨 await 或持有外部工作时设置有界值；必须等待全部执行结束时显式使用 false。'
        },
        {
          name: 'pipeline',
          description:
            '选择 Host 的单一 pipeline 执行模型。构造后不可切换，插件注册方法必须与所选模式匹配。',
          defaultValue: "{ mode: 'sync' }",
          whenToUse: '领域入口需要按插件顺序变换、拦截或包围一个值时设置。'
        },
        {
          name: 'pipeline.mode',
          description:
            'sync 是返回后再进入下游的扁平链；async 是可在 await next() 后执行后置逻辑的洋葱模型；generator 与 async-generator 使用显式终止值。',
          defaultValue: "'sync'",
          whenToUse: '根据 stage 是否异步、是否需要洋葱后置逻辑或 generator 终止协议选择一次。'
        },
        {
          name: 'diagnostic',
          description:
            '接收迟到 next、被忽略的非枚举扩展、安装回滚二次失败和只诊断模式下的排队等待。回调自身失败会被隔离。',
          defaultValue: 'no-op',
          whenToUse: '需要把非终止性 Host 异常信号送入日志、telemetry 或开发工具时设置。'
        },
        {
          name: 'scheduler',
          description:
            '拥有 mutation、queue admission、pipeline drain 与 disposer timeout 的时间域和排程。构造时只读取一次。',
          defaultValue: 'systemScheduler',
          whenToUse: '测试需要确定性虚拟时间，或宿主不能使用系统 timer 时注入。'
        },
        {
          name: 'queueAdmissionTimeoutMs',
          description:
            '限制尚未开始的 mutation 在 FIFO 队列中等待的时间。undefined 只诊断不拒绝；false 关闭相关 timer；数字超时后以 MUTATION_QUEUE_TIMEOUT 拒绝该排队任务。',
          defaultValue: 'undefined',
          whenToUse: '产品必须拒绝排队过久且尚未开始的配置或插件变更时设置数字。'
        },
        {
          name: 'queueAdmissionDiagnosticMs',
          description:
            '仅在 queueAdmissionTimeoutMs 未配置时生效，等待越过阈值后发出诊断但继续排队。false 关闭诊断 timer。',
          defaultValue: '1000',
          whenToUse: '希望观测队列拥塞但不能据此拒绝 mutation 时调整。'
        },
        {
          name: 'disposeStepTimeoutMs',
          description:
            '限制单个 pipeline disposer、插件 dispose hook 或 onDispose 资源清理步骤。超时记入 cleanupErrors，Host 继续向逻辑终态收敛。',
          defaultValue: '5000',
          whenToUse:
            '外部资源清理可能挂起，且 Host 不能永久停在 closing 时保持有界值；false 表示无限等待。'
        }
      ]
    },
    en: {
      purpose:
        'Provides the abstract base for a domain host that installs plugins atomically and publishes immutable views. It owns configuration, shared capabilities, pipelines, serialized mutations, and physical cleanup after logical revocation. Construction requires explicit execution and drain budgets.',
      quickStart:
        "type ICore = { write(message: string): void }\n\nclass AppHost extends PluginHost<ICore> {\n  protected createPluginDomainCore(): ICore {\n    return { write: (message) => console.log(message) }\n  }\n}\n\nconst host = new AppHost({\n  execution: {\n    mutationTimeoutMs: 5_000,\n    pipelineDrainTimeoutMs: 5_000\n  }\n})\n\nconst view = await host.use(greetingPlugin)\nview.extensions.greet('Migaia')\n\nconst removal = await view.unUse('greeting')\nif (removal.physicalCompletion) await removal.physicalCompletion\nawait host.dispose()",
      scenarios: [
        'An application installs a plugin batch transactionally and revokes every candidate when one installation fails.',
        'Plugins publish extensions, shared capabilities, or pipeline stages whose ownership must be tracked centrally.',
        'Removal must hide capabilities from a new view before active pipelines and physical resources finish draining.'
      ],
      avoidWhen: [
        'The feature set is compile-time fixed and has no dynamic installation, revocation, or resource ownership; direct object composition is simpler.',
        'The system needs automatic dependency-graph resolution; PluginHost executes an already ordered plan and does not own dependency relationships.',
        'The system needs a cross-process plugin sandbox or permission boundary; the Host composes code only inside the current JavaScript realm.'
      ],
      options: [
        {
          name: 'execution',
          description:
            'Required execution-budget group. It bounds an admitted lifecycle mutation separately from the wait for pipeline leases to reach zero after a plugin stage is logically revoked.',
          whenToUse:
            'Provide it for every construction; set a child field to false only when unbounded waiting is an explicit product decision.'
        },
        {
          name: 'execution.mutationTimeoutMs',
          description:
            'Bounds one started install, update, or removal hook. Timeout revokes that operation’s commit authority and asks cooperative code to stop through operation.signal.',
          whenToUse:
            'Choose a bounded duration from the slowest legitimate lifecycle operation; use false explicitly when no safe limit exists.',
          example:
            'new AppHost({ execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 5_000 } })'
        },
        {
          name: 'execution.pipelineDrainTimeoutMs',
          description:
            'Bounds the wait for already-started pipeline leases after a plugin stage is logically revoked. Timeout never republishes the capability; cleanupComplete and physicalCompletion expose unfinished cleanup.',
          whenToUse:
            'Use a bounded value for pipelines that cross awaits or own external work; use false only when removal must wait for every run.'
        },
        {
          name: 'pipeline',
          description:
            'Selects the Host’s one pipeline execution model. It cannot change after construction, and plugin registration APIs must match it.',
          defaultValue: "{ mode: 'sync' }",
          whenToUse:
            'Set it when a domain entry point is transformed, intercepted, or wrapped by ordered plugin stages.'
        },
        {
          name: 'pipeline.mode',
          description:
            'sync is a flat chain that enters downstream after a stage returns; async is an onion model with post-next logic; generator and async-generator use explicit terminal values.',
          defaultValue: "'sync'",
          whenToUse:
            'Choose once from stage asynchrony, the need for onion-style post logic, or generator terminal semantics.'
        },
        {
          name: 'diagnostic',
          description:
            'Receives late next calls, ignored non-enumerable extensions, secondary rollback failures, and queue waits in diagnostic-only mode. Callback failure is contained.',
          defaultValue: 'no-op',
          whenToUse:
            'Set it when non-terminal Host signals must reach logging, telemetry, or developer tooling.'
        },
        {
          name: 'scheduler',
          description:
            'Owns the time domain and scheduling for mutation, queue admission, pipeline drain, and disposer timeouts. Construction snapshots it once.',
          defaultValue: 'systemScheduler',
          whenToUse:
            'Inject it for deterministic virtual time in tests or when the host cannot use system timers.'
        },
        {
          name: 'queueAdmissionTimeoutMs',
          description:
            'Bounds how long a not-yet-started mutation waits in the FIFO queue. undefined diagnoses without rejection, false disables its timer, and a number rejects the queued task with MUTATION_QUEUE_TIMEOUT.',
          defaultValue: 'undefined',
          whenToUse:
            'Set a number when the product must reject configuration or plugin mutations that have not started within an admission SLA.'
        },
        {
          name: 'queueAdmissionDiagnosticMs',
          description:
            'Applies only when queueAdmissionTimeoutMs is omitted. Crossing it reports queue pressure while the mutation remains queued; false disables the diagnostic timer.',
          defaultValue: '1000',
          whenToUse: 'Adjust it when queue congestion must be observed but cannot reject mutations.'
        },
        {
          name: 'disposeStepTimeoutMs',
          description:
            'Bounds one pipeline disposer, plugin dispose hook, or onDispose resource step. Timeout records cleanupErrors while the Host continues toward logical terminal state.',
          defaultValue: '5000',
          whenToUse:
            'Keep it bounded when external cleanup can hang and the Host must not remain closing forever; false waits without a limit.'
        }
      ]
    }
  },
  'event-subscriber:index:createEventChannel': {
    zh: {
      purpose:
        '创建进程内、瞬时、同步分发的事件 Channel。它保存订阅登记，并把每次 publish 的值按稳定顺序交给当前订阅快照；它不负责持久化、跨进程传输或任务排队。',
      quickStart:
        "const jobs = createEventChannel<Job>()\nconst stop = jobs.subscribe(({ value }) => {\n  processJob(value)\n})\n\njobs.publish({ id: 'job-1' })\nstop()",
      scenarios: [
        '一个生产者需要通知多个进程内监听者，并保留明确的订阅与退订边界。',
        '需要同步、可重入的事件分发，或显式切换为当前快照完成后再处理重入事件。',
        '需要按 taskId 选择监听者，或与 invokeSerial、invokeParallel 等调用 helper 组合。'
      ],
      avoidWhen: [
        '事件需要跨 Worker、网络或进程传输；此时应使用对应 transport/RPC 能力。',
        '事件需要重放、持久化或背压队列；Channel 不拥有这些语义。',
        '只有单个直接调用目标且不需要动态订阅；普通函数调用更清晰。'
      ],
      options: [
        {
          name: 'report',
          description:
            '接收 publish 已同步返回后才发生的 listener Promise/thenable rejection。同步抛错不进入这里，而是在本次发布完成后通过 AggregateError 抛出。',
          whenToUse: 'listener 可能返回 Promise，且调用方需要把迟到失败送入日志或诊断系统时。',
          example:
            "const channel = createEventChannel<Job>({\n  report: ({ event, error }) => logger.error('job listener failed', {\n    job: event.value,\n    error\n  })\n})"
        },
        {
          name: 'terminalReport',
          description:
            'report 缺失、抛错或返回拒绝的 thenable 时使用的最终诊断出口。它负责兜住“报告失败本身”，不会替代正常业务错误处理。',
          whenToUse: '应用有独立的应急诊断通道，并且不能接受异步 listener 失败静默丢失时。',
          example:
            'const channel = createEventChannel<Job>({\n  report: ({ error }) => telemetry.capture(error),\n  terminalReport: (error) => emergencyLog.write(error)\n})'
        },
        {
          name: 'dispatchPolicy',
          description:
            '控制 listener 在 publish 内再次 publish 时的交付顺序。recursive 立即进入嵌套发布；queued 先完成当前订阅快照，再处理重入值。',
          defaultValue: 'EventDispatchPolicy.recursive',
          whenToUse: '只有业务要求单次快照不可被重入事件穿插时才选择 queued。',
          example:
            'const channel = createEventChannel<Event>({\n  dispatchPolicy: EventDispatchPolicy.queued\n})'
        },
        {
          name: 'removalPolicy',
          description:
            '控制调用订阅句柄时移除的登记范围。handle 只移除该句柄对应的登记；listener-all 会移除同一 listener 的全部重复登记。',
          defaultValue: "'handle'",
          whenToUse:
            '兼容按函数整体退订的旧调用方时使用 listener-all；精确管理重复订阅时保持默认值。',
          example:
            "const channel = createEventChannel<Event>({\n  removalPolicy: 'listener-all'\n})"
        },
        {
          name: 'publishBudget',
          description:
            '限制一次顶层同步发布事务实际调用的 listener 总数，nested publish 也计入。耗尽后停止展开并抛出 PUBLISH_FAILED。',
          defaultValue: '100_000',
          whenToUse:
            '不可信 listener 可能递归发布，或应用需要更低的同步工作上限时。值必须是正安全整数。',
          example: 'const channel = createEventChannel<Event>({ publishBudget: 10_000 })'
        },
        {
          name: 'style',
          description:
            '在构造阶段为 subscribe、publish 和退订句柄增加命名投影。canonical 方法始终保留；style 不改变顺序、调度、错误或生命周期语义。',
          defaultValue: "'subscribe-publish'",
          whenToUse:
            '需要 on/emit、on/trigger、listen/fire 等领域命名，或需要稳定的自定义方法名时。',
          example:
            "const events = createEventChannel<number>({ style: 'on-emit' })\nconst stop = events.on(({ value }) => console.log(value))\nevents.emit(1)\nstop.off()\n\nconst domainStyle = defineEventApiStyle({\n  subscribe: 'observe',\n  publish: 'dispatch',\n  unsubscribe: 'dispose'\n})\nconst domainEvents = createEventChannel<number, void, typeof domainStyle>({\n  style: domainStyle\n})\nconst handle = domainEvents.observe(({ value }) => console.log(value))\ndomainEvents.dispatch(2)\nhandle.dispose()"
        },
        {
          name: 'valueConfig',
          description:
            '从原始 payload 的固定路径读取值，并以 alias 附加到 event context；event.value 仍保留原始对象。它不转换、保存或重放 payload。',
          whenToUse: '多个 listener 都需要读取同一深层字段，同时仍需访问完整原始 payload 时。',
          example:
            "type IMessage = { readonly data: { readonly id: number } }\nconst channel = createEventChannel<IMessage>({\n  valueConfig: { readPath: 'data.id', alias: 'resourceId' }\n})\nchannel.subscribe((event) => {\n  event.resourceId\n  event.value\n})"
        }
      ]
    },
    en: {
      purpose:
        'Creates an in-process, transient event channel with synchronous delivery. It owns subscription registrations and delivers each published value to the current snapshot in stable order; it does not provide persistence, cross-process transport, or a work queue.',
      quickStart:
        "const jobs = createEventChannel<Job>()\nconst stop = jobs.subscribe(({ value }) => {\n  processJob(value)\n})\n\njobs.publish({ id: 'job-1' })\nstop()",
      scenarios: [
        'One producer needs to notify multiple in-process listeners with explicit subscribe and unsubscribe boundaries.',
        'Delivery must be synchronous and reentrant, or reentrant values must be deferred until the current snapshot completes.',
        'Listeners need task IDs or composition with invocation helpers such as invokeSerial and invokeParallel.'
      ],
      avoidWhen: [
        'Events must cross a Worker, network, or process boundary; use the matching transport or RPC capability.',
        'Events require replay, persistence, or backpressure; a channel does not own those semantics.',
        'There is one fixed target and no dynamic subscription; a direct function call is clearer.'
      ],
      options: [
        {
          name: 'report',
          description:
            'Receives listener Promise or thenable rejections that happen after publish has returned. Synchronous failures bypass this hook and are thrown as an AggregateError after the publish traversal.',
          whenToUse:
            'Use when listeners may return Promises and late failures must reach logging or telemetry.',
          example:
            "const channel = createEventChannel<Job>({\n  report: ({ event, error }) => logger.error('job listener failed', {\n    job: event.value,\n    error\n  })\n})"
        },
        {
          name: 'terminalReport',
          description:
            'Final diagnostic sink used when report is missing, throws, or returns a rejected thenable. It contains failure of the reporting path itself; it is not normal business error handling.',
          whenToUse:
            'Use when the application has an emergency diagnostic sink and late listener failures must never disappear silently.',
          example:
            'const channel = createEventChannel<Job>({\n  report: ({ error }) => telemetry.capture(error),\n  terminalReport: (error) => emergencyLog.write(error)\n})'
        },
        {
          name: 'dispatchPolicy',
          description:
            'Controls delivery when a listener publishes again. recursive enters nested delivery immediately; queued completes the current subscription snapshot before processing the reentrant value.',
          defaultValue: 'EventDispatchPolicy.recursive',
          whenToUse:
            'Choose queued only when one snapshot must not be interleaved by reentrant events.',
          example:
            'const channel = createEventChannel<Event>({\n  dispatchPolicy: EventDispatchPolicy.queued\n})'
        },
        {
          name: 'removalPolicy',
          description:
            'Controls how much a subscription handle removes. handle removes only its own registration; listener-all removes every registration for the same listener.',
          defaultValue: "'handle'",
          whenToUse:
            'Use listener-all for compatibility with function-wide removal; keep the default for precise duplicate subscriptions.',
          example:
            "const channel = createEventChannel<Event>({\n  removalPolicy: 'listener-all'\n})"
        },
        {
          name: 'publishBudget',
          description:
            'Caps listener calls within one top-level synchronous publish transaction, including nested publishes. Exhaustion stops expansion and throws PUBLISH_FAILED.',
          defaultValue: '100_000',
          whenToUse:
            'Lower the budget when untrusted listeners may publish recursively or the application needs a tighter synchronous-work bound.',
          example: 'const channel = createEventChannel<Event>({ publishBudget: 10_000 })'
        },
        {
          name: 'style',
          description:
            'Adds naming projections for subscribe, publish, and the cancellation handle during construction. Canonical methods remain available; style does not change ordering, scheduling, errors, or lifecycle.',
          defaultValue: "'subscribe-publish'",
          whenToUse:
            'Use for domain names such as on/emit, on/trigger, listen/fire, or stable custom method names.',
          example:
            "const events = createEventChannel<number>({ style: 'on-emit' })\nconst stop = events.on(({ value }) => console.log(value))\nevents.emit(1)\nstop.off()\n\nconst domainStyle = defineEventApiStyle({\n  subscribe: 'observe',\n  publish: 'dispatch',\n  unsubscribe: 'dispose'\n})\nconst domainEvents = createEventChannel<number, void, typeof domainStyle>({\n  style: domainStyle\n})\nconst handle = domainEvents.observe(({ value }) => console.log(value))\ndomainEvents.dispatch(2)\nhandle.dispose()"
        },
        {
          name: 'valueConfig',
          description:
            'Reads one stable path from the original payload and exposes it under an alias on the event context. event.value keeps the original object; this does not transform, store, or replay payloads.',
          whenToUse:
            'Use when many listeners need the same nested value while retaining access to the complete payload.',
          example:
            "type IMessage = { readonly data: { readonly id: number } }\nconst channel = createEventChannel<IMessage>({\n  valueConfig: { readPath: 'data.id', alias: 'resourceId' }\n})\nchannel.subscribe((event) => {\n  event.resourceId\n  event.value\n})"
        }
      ]
    }
  },
  'event-subscriber:index:createEventHub': {
    zh: {
      purpose:
        '创建按事件键惰性分配 Channel 的进程内 Hub。它在同一边界内保持 key 与 payload 的类型对应，并以 O(1) 维护全部活跃订阅数量。',
      quickStart:
        "type IEvents = {\n  ready: { readonly at: number }\n  warning: { readonly message: string }\n}\nconst events = createEventHub<IEvents>()\nconst stop = events.subscribe('warning', ({ value }) => console.warn(value.message))\nevents.publish('warning', { message: 'cache is stale' })\nstop()",
      scenarios: [
        '多个事件种类需要共享一个入口，同时保持每个 key 对应的 payload 类型。',
        '事件种类按需出现，不希望预先创建所有 Channel。',
        '需要统一 clear、size、诊断与命名风格，但仍保留独立的事件订阅。'
      ],
      avoidWhen: [
        '只有一种事件；直接使用 createEventChannel 更清晰。',
        'key 在编译期未知且 payload 没有稳定映射；先定义领域事件映射。',
        '需要跨进程、持久化或重放；Hub 不拥有这些能力。'
      ],
      options: [
        {
          name: 'report',
          description:
            '接收迟到的异步 listener 失败，并额外提供 key，便于定位失败来自哪一种事件。同步失败仍由对应 publish 聚合抛出。',
          whenToUse:
            'Hub listener 可能返回 Promise，且诊断系统需要同时记录事件 key 与 payload 时。',
          example:
            'const events = createEventHub<IEvents>({\n  report: ({ key, event, error }) =>\n    telemetry.capture(error, { key, payload: event.value })\n})'
        },
        {
          name: 'terminalReport',
          description:
            'report 缺失或自身失败时的最终诊断出口。它与 Channel 的 terminalReport 语义相同。',
          whenToUse: '不能接受报告链路失败后静默丢失诊断时。',
          example:
            'const events = createEventHub<IEvents>({\n  terminalReport: (error) => emergencyLog.write(error)\n})'
        },
        {
          name: 'style',
          description:
            '为 Hub 增加 on/emit、on/trigger、listen/fire 或自定义命名投影。canonical subscribe/publish 始终保留，key 推导与惰性 Channel 归属不变。',
          defaultValue: "'subscribe-publish'",
          whenToUse: '领域代码需要统一事件动词，而不是改变 Hub 行为时。',
          example:
            "const events = createEventHub<IEvents>({ style: 'on-emit' })\nconst stop = events.on('warning', ({ value }) => console.warn(value.message))\nevents.emit('warning', { message: 'cache is stale' })\nstop.off()"
        },
        {
          name: 'valueConfig',
          description:
            '对所有事件 payload 使用同一静态路径与 alias 投影，同时保留 event.value 原始值。',
          whenToUse: '事件映射中的 payload 共享稳定嵌套结构，监听者需要统一读取该字段时。',
          example:
            "type IEvents = { saved: { data: { id: string } } }\nconst events = createEventHub<IEvents>({\n  valueConfig: { readPath: 'data.id', alias: 'resourceId' }\n})\nevents.subscribe('saved', (event) => console.log(event.resourceId))"
        }
      ]
    },
    en: {
      purpose:
        'Creates an in-process hub that lazily allocates channels by event key. It preserves the key-to-payload type mapping and tracks all active subscriptions in O(1).',
      quickStart:
        "type IEvents = {\n  ready: { readonly at: number }\n  warning: { readonly message: string }\n}\nconst events = createEventHub<IEvents>()\nconst stop = events.subscribe('warning', ({ value }) => console.warn(value.message))\nevents.publish('warning', { message: 'cache is stale' })\nstop()",
      scenarios: [
        'Several event kinds need one entry point while each key retains its own payload type.',
        'Event kinds appear on demand and channels should not be allocated eagerly.',
        'Clear, size, diagnostics, and naming style need one boundary without merging subscriptions.'
      ],
      avoidWhen: [
        'There is one event kind; createEventChannel is clearer.',
        'Keys are unknown at compile time and payloads have no stable mapping; define a domain event map first.',
        'Events require transport, persistence, or replay; a hub does not own those capabilities.'
      ],
      options: [
        {
          name: 'report',
          description:
            'Receives late asynchronous listener failures and includes the event key so diagnostics can identify the failing event kind. Synchronous failures are still aggregated by publish.',
          whenToUse:
            'Use when hub listeners may return Promises and telemetry needs both key and payload context.',
          example:
            'const events = createEventHub<IEvents>({\n  report: ({ key, event, error }) =>\n    telemetry.capture(error, { key, payload: event.value })\n})'
        },
        {
          name: 'terminalReport',
          description:
            'Final diagnostic sink when report is missing or fails. It follows the same semantics as terminalReport on a channel.',
          whenToUse:
            'Use when failure of the reporting chain must not silently discard diagnostics.',
          example:
            'const events = createEventHub<IEvents>({\n  terminalReport: (error) => emergencyLog.write(error)\n})'
        },
        {
          name: 'style',
          description:
            'Adds on/emit, on/trigger, listen/fire, or custom naming projections. Canonical subscribe/publish remain available, and key inference plus lazy channel ownership do not change.',
          defaultValue: "'subscribe-publish'",
          whenToUse:
            'Use when domain code needs different event verbs without changing hub behavior.',
          example:
            "const events = createEventHub<IEvents>({ style: 'on-emit' })\nconst stop = events.on('warning', ({ value }) => console.warn(value.message))\nevents.emit('warning', { message: 'cache is stale' })\nstop.off()"
        },
        {
          name: 'valueConfig',
          description:
            'Applies one static path and alias projection to every event payload while preserving the original event.value.',
          whenToUse:
            'Use when mapped payloads share a stable nested shape and listeners need one common projected field.',
          example:
            "type IEvents = { saved: { data: { id: string } } }\nconst events = createEventHub<IEvents>({\n  valueConfig: { readPath: 'data.id', alias: 'resourceId' }\n})\nevents.subscribe('saved', (event) => console.log(event.resourceId))"
        }
      ]
    }
  },
  'event-subscriber:index:defineEventApiStyle': {
    zh: {
      purpose:
        '校验自定义事件方法名并保留字符串字面量类型。它返回同一个对象，不创建 Channel、Hub 或新的分发层。',
      quickStart:
        "const style = defineEventApiStyle({\n  subscribe: 'observe',\n  publish: 'dispatch',\n  unsubscribe: 'dispose'\n})\nconst events = createEventChannel<number, void, typeof style>({ style })\nconst handle = events.observe(({ value }) => console.log(value))\nevents.dispatch(1)\nhandle.dispose()",
      scenarios: [
        '自定义 style 先保存到变量，并且需要保留精确 alias 类型。',
        '同一套领域命名需要复用于多个 Channel 或 Hub。'
      ],
      avoidWhen: [
        '使用内置 preset；直接传 EventApiStyle.onEmit 等稳定常量即可。',
        '试图改变调度、队列或错误语义；style 只负责命名投影。'
      ],
      options: []
    },
    en: {
      purpose:
        'Validates custom event method names while preserving their string literal types. It returns the same object and creates no channel, hub, or dispatch layer.',
      quickStart:
        "const style = defineEventApiStyle({\n  subscribe: 'observe',\n  publish: 'dispatch',\n  unsubscribe: 'dispose'\n})\nconst events = createEventChannel<number, void, typeof style>({ style })\nconst handle = events.observe(({ value }) => console.log(value))\nevents.dispatch(1)\nhandle.dispose()",
      scenarios: [
        'A custom style is declared before use and must retain exact alias types.',
        'One domain vocabulary needs to be reused across several channels or hubs.'
      ],
      avoidWhen: [
        'An included preset fits; pass a stable EventApiStyle member directly.',
        'Scheduling, queues, or error semantics must change; style only projects names.'
      ],
      options: []
    }
  },
  'event-subscriber:index:invokeParallelSettled': {
    zh: {
      purpose:
        '同时启动当前订阅快照中的全部 listener，并按登记顺序返回每个调用的 fulfilled/rejected 结果。单个 listener 失败不会阻止其他 listener，也不会让返回的 Promise 因业务失败而拒绝。',
      quickStart:
        'const results = await invokeParallelSettled(events, job)\nfor (const result of results) {\n  if (result.status === EventSubscriberState.rejected) {\n    logger.error(result.reason)\n  }\n}',
      scenarios: [
        '多个互不依赖的 listener 可以并发执行，并且调用方需要观察每个结果。',
        '部分失败属于预期结果，调用方希望自行决定记录、重试或忽略策略。'
      ],
      avoidWhen: [
        'listener 必须严格串行执行；使用 invokeSerialSettled。',
        '任何失败都应直接让调用拒绝；使用 invokeParallel。'
      ],
      options: []
    },
    en: {
      purpose:
        'Starts every listener in the current subscription snapshot concurrently and returns fulfilled or rejected results in registration order. One listener failure neither stops its peers nor rejects the returned Promise as a business failure.',
      quickStart:
        'const results = await invokeParallelSettled(events, job)\nfor (const result of results) {\n  if (result.status === EventSubscriberState.rejected) {\n    logger.error(result.reason)\n  }\n}',
      scenarios: [
        'Independent listeners may run concurrently and the caller needs every individual outcome.',
        'Partial failure is expected and the caller owns logging, retry, or ignore policy.'
      ],
      avoidWhen: [
        'Listeners must execute strictly in sequence; use invokeSerialSettled.',
        'Any failure should reject the invocation; use invokeParallel.'
      ],
      options: []
    }
  },
  'event-subscriber:index:invokeParallel': {
    zh: {
      purpose:
        '同时启动当前订阅快照中的全部 listener。全部成功时按登记顺序返回值；存在失败时，等待所有 listener settle 后以一个保留全部失败原因的 AggregateError 拒绝。',
      quickStart:
        'try {\n  const receipts = await invokeParallel(events, job)\n  console.log(receipts)\n} catch (error) {\n  // AggregateError.errors 保留每个失败原因\n  logger.error(error)\n}',
      scenarios: [
        '独立 listener 可以并发执行，并且只接受全部成功的结果。',
        '需要保留同一轮发布中的所有失败，而不是只看到第一个失败。'
      ],
      avoidWhen: [
        '需要逐项处理成功与失败；使用 invokeParallelSettled。',
        'listener 之间有先后依赖；使用 invokeSerial。'
      ],
      options: []
    },
    en: {
      purpose:
        'Starts every listener in the current subscription snapshot concurrently. It returns values in registration order when all succeed; after every listener settles, any failures reject as one AggregateError retaining every reason.',
      quickStart:
        'try {\n  const receipts = await invokeParallel(events, job)\n  console.log(receipts)\n} catch (error) {\n  // AggregateError.errors retains every listener failure\n  logger.error(error)\n}',
      scenarios: [
        'Independent listeners may run concurrently and only an all-success result is acceptable.',
        'Every failure from one publish must remain inspectable rather than stopping at the first one.'
      ],
      avoidWhen: [
        'Successes and failures must be handled individually; use invokeParallelSettled.',
        'Listeners depend on execution order; use invokeSerial.'
      ],
      options: []
    }
  },
  'event-subscriber:index:invokeSerialSettled': {
    zh: {
      purpose:
        '按登记顺序逐个调用当前订阅快照；前一个 listener settle 后才启动下一个。它返回每项 fulfilled/rejected 结果，失败不会中断后续 listener。',
      quickStart:
        'const results = await invokeSerialSettled(events, job)\nconst failures = results.filter(\n  (result) => result.status === EventSubscriberState.rejected\n)',
      scenarios: [
        'listener 共享限流资源或必须保持确定的启动顺序。',
        '仍需运行全部 listener，并由调用方分别处理失败。'
      ],
      avoidWhen: [
        'listener 相互独立且延迟更重要；使用 invokeParallelSettled。',
        '任意失败都应作为调用失败返回；使用 invokeSerial。'
      ],
      options: []
    },
    en: {
      purpose:
        'Invokes the current subscription snapshot one listener at a time in registration order; the next starts only after the previous one settles. It returns every fulfilled or rejected result and keeps running after failures.',
      quickStart:
        'const results = await invokeSerialSettled(events, job)\nconst failures = results.filter(\n  (result) => result.status === EventSubscriberState.rejected\n)',
      scenarios: [
        'Listeners share a rate-limited resource or require deterministic start order.',
        'Every listener must still run while the caller handles failures individually.'
      ],
      avoidWhen: [
        'Listeners are independent and latency matters; use invokeParallelSettled.',
        'Any failure should reject the invocation; use invokeSerial.'
      ],
      options: []
    }
  },
  'event-subscriber:index:invokeSerial': {
    zh: {
      purpose:
        '按登记顺序逐个调用当前订阅快照，并等待每个 listener settle。所有 listener 都会获得执行机会；最后只要存在失败，就以保留全部失败原因的 AggregateError 拒绝。',
      quickStart:
        'const steps = createEventChannel<Job, string>()\nsteps.subscribe(async ({ value }) => persist(value))\nsteps.subscribe(async ({ value }) => index(value))\nconst receipts = await invokeSerial(steps, job)',
      scenarios: [
        '异步步骤必须按登记顺序启动，但仍要求收集同一轮中的全部失败。',
        '只接受全部 listener 成功的返回值。'
      ],
      avoidWhen: [
        '第一个失败后必须立即停止；该 API 会继续执行剩余 listener。',
        'listener 可以安全并发；使用 invokeParallel 降低总延迟。'
      ],
      options: []
    },
    en: {
      purpose:
        'Invokes the current subscription snapshot one listener at a time and waits for each settlement. Every listener gets a chance to run; if any fail, the final Promise rejects with an AggregateError retaining every reason.',
      quickStart:
        'const steps = createEventChannel<Job, string>()\nsteps.subscribe(async ({ value }) => persist(value))\nsteps.subscribe(async ({ value }) => index(value))\nconst receipts = await invokeSerial(steps, job)',
      scenarios: [
        'Asynchronous steps must start in registration order while failures from the whole run remain available.',
        'Only an all-success value result is acceptable.'
      ],
      avoidWhen: [
        'Execution must stop at the first failure; this API continues with remaining listeners.',
        'Listeners are safe to overlap; use invokeParallel for lower latency.'
      ],
      options: []
    }
  },
  'event-subscriber:index:invokeTaskSettled': {
    zh: {
      purpose:
        '按 taskId 精确选择一个登记并返回其 fulfilled/rejected 结果。taskId 不存在或对应多个登记时会在返回 Promise 之前同步抛错。',
      quickStart:
        "events.subscribe(runIndexer, { taskId: 'search-index' })\nconst result = await invokeTaskSettled(events, 'search-index', job)\nif (result.status === EventSubscriberState.rejected) {\n  queueRetry(job, result.reason)\n}",
      scenarios: [
        '调用方需要精确寻址一个已命名 listener。',
        '任务业务失败需要作为数据处理，而不是 Promise rejection。'
      ],
      avoidWhen: [
        '同一 taskId 允许多个 listener；该 API 要求唯一匹配。',
        '需要向全部 listener 发布；使用 channel.publish 或批量 invoke helper。'
      ],
      options: []
    },
    en: {
      purpose:
        'Selects exactly one registration by taskId and returns its fulfilled or rejected result. A missing or non-unique taskId throws synchronously before a Promise is returned.',
      quickStart:
        "events.subscribe(runIndexer, { taskId: 'search-index' })\nconst result = await invokeTaskSettled(events, 'search-index', job)\nif (result.status === EventSubscriberState.rejected) {\n  queueRetry(job, result.reason)\n}",
      scenarios: [
        'The caller must address one named listener precisely.',
        'Task failure should be handled as data rather than a Promise rejection.'
      ],
      avoidWhen: [
        'Several listeners intentionally share the taskId; this API requires one unique match.',
        'The value must reach every listener; use channel.publish or a batch invocation helper.'
      ],
      options: []
    }
  },
  'event-subscriber:index:invokeTask': {
    zh: {
      purpose:
        '按 taskId 精确调用一个登记并返回其值。选择失败会同步抛错；listener 失败则由返回的 Promise 以 AggregateError 拒绝，并在 errors 中保留原始原因。',
      quickStart:
        "events.subscribe(runIndexer, { taskId: 'search-index' })\nconst receipt = await invokeTask(events, 'search-index', job)",
      scenarios: [
        '需要像调用命名任务一样调用一个唯一 listener。',
        '调用方希望通过正常 Promise rejection 处理 listener 失败。'
      ],
      avoidWhen: [
        '需要把业务失败作为结果值检查；使用 invokeTaskSettled。',
        'taskId 不是唯一稳定标识；先修正登记模型。'
      ],
      options: []
    },
    en: {
      purpose:
        'Invokes exactly one registration by taskId and returns its value. Selection failures throw synchronously; listener failure rejects the returned Promise with an AggregateError whose errors retain the original reason.',
      quickStart:
        "events.subscribe(runIndexer, { taskId: 'search-index' })\nconst receipt = await invokeTask(events, 'search-index', job)",
      scenarios: [
        'One uniquely named listener should behave like an addressable task.',
        'The caller wants normal Promise rejection for listener failure.'
      ],
      avoidWhen: [
        'Business failure should be inspected as a result value; use invokeTaskSettled.',
        'taskId is not a unique stable identity; correct the registration model first.'
      ],
      options: []
    }
  },
  'event-subscriber:index:subscribeOnce': {
    zh: {
      purpose:
        '在任意兼容 Event Channel 上登记一个最多执行一次的 listener。首次交付前先完成退订，因此 listener 内重入 publish 也不会触发第二次调用；返回的退订函数可提前取消且幂等。',
      quickStart:
        "const stop = subscribeOnce(events, ({ value }) => {\n  showWelcome(value)\n}, { taskId: 'first-login' })\n\n// 如果场景提前结束，可安全取消；重复调用无效果\nstop()\nstop()",
      scenarios: [
        '只关心下一次事件，例如首次就绪、一次性确认或首个状态变化。',
        '输入是结构兼容 Channel，不一定由 createEventChannel 创建。'
      ],
      avoidWhen: [
        '需要持续监听后续事件；使用普通 subscribe。',
        '需要等待符合谓词的事件；在 listener 内自行判断并退订，或使用更高层任务抽象。'
      ],
      options: [
        {
          name: 'taskId',
          description: '为这次一次性登记附加稳定任务标识，供 task 定向调用与诊断使用。',
          whenToUse: '只有调用方需要通过 invokeTask 精确寻址该登记时才设置。'
        }
      ]
    },
    en: {
      purpose:
        'Registers a listener that runs at most once on any compatible event channel. It unsubscribes before the first delivery, so a reentrant publish inside the listener cannot invoke it again; the returned cancellation function is early-safe and idempotent.',
      quickStart:
        "const stop = subscribeOnce(events, ({ value }) => {\n  showWelcome(value)\n}, { taskId: 'first-login' })\n\n// Cancel safely if the surrounding task ends first\nstop()\nstop()",
      scenarios: [
        'Only the next event matters, such as first-ready, one-time confirmation, or the first state change.',
        'The source is a structurally compatible channel, not necessarily one created by createEventChannel.'
      ],
      avoidWhen: [
        'Later events must remain observed; use normal subscribe.',
        'Only an event matching a predicate should finish the task; filter explicitly and unsubscribe or use a higher-level task abstraction.'
      ],
      options: [
        {
          name: 'taskId',
          description:
            'Attaches a stable task identity to this one-shot registration for directed invocation and diagnostics.',
          whenToUse:
            'Set it only when callers need to address this registration through invokeTask.'
        }
      ]
    }
  },
  'event-subscriber:index:subscribeSubscriber': {
    zh: {
      purpose:
        '把具有 handle(event) 方法的对象适配为 Channel 订阅，不引入基类或新的生命周期层。返回的退订函数直接拥有这次登记，并保持幂等。',
      quickStart:
        'class AuditSubscriber {\n  handle({ value }: IEventContext<Job>) {\n    audit.write(value)\n  }\n}\n\nconst stop = subscribeSubscriber(events, new AuditSubscriber())\nstop()',
      scenarios: [
        '现有领域对象以 handle 方法承载事件行为。',
        '需要结构化适配对象，但不希望对象继承框架类。'
      ],
      avoidWhen: [
        '只有一个局部回调；直接 channel.subscribe 更短更清晰。',
        '对象缺少可调用的 handle；这会以 INVALID_SUBSCRIBER 拒绝。'
      ],
      options: []
    },
    en: {
      purpose:
        'Adapts an object with a handle(event) method to a channel subscription without introducing a base class or another lifecycle layer. The returned unsubscribe function owns this registration and remains idempotent.',
      quickStart:
        'class AuditSubscriber {\n  handle({ value }: IEventContext<Job>) {\n    audit.write(value)\n  }\n}\n\nconst stop = subscribeSubscriber(events, new AuditSubscriber())\nstop()',
      scenarios: [
        'An existing domain object exposes event behavior through a handle method.',
        'Object-shaped subscribers are useful but framework inheritance is not.'
      ],
      avoidWhen: [
        'The behavior is one local callback; channel.subscribe is shorter and clearer.',
        'The object has no callable handle method; it is rejected as INVALID_SUBSCRIBER.'
      ],
      options: []
    }
  },
  'event-subscriber:index:subscribeUntil': {
    zh: {
      purpose:
        '把订阅生命周期绑定到 AbortSignal。signal 已中止时不会登记；之后中止会移除 source 订阅，并让同一交付竞争中的 event context 观察到 aborted 与原始 reason。返回的退订函数也可提前结束绑定。',
      quickStart:
        "const controller = new AbortController()\nconst stop = subscribeUntil(\n  events,\n  controller.signal,\n  ({ value, aborted, abortReason }) => {\n    if (!aborted) render(value)\n    else logger.debug(abortReason)\n  }\n)\n\ncontroller.abort('screen closed')\nstop()",
      scenarios: [
        '订阅应与页面、请求、任务或 lifecycle scope 的取消同步结束。',
        '竞争发生时 listener 需要从 event context 观察准确的中止原因。'
      ],
      avoidWhen: [
        '没有 AbortSignal 所有者；普通 subscribe 的所有权更清楚。',
        'signal 不是标准兼容对象，或 add/removeEventListener 具有副作用异常。'
      ],
      options: [
        {
          name: 'taskId',
          description: '为底层订阅附加可选任务标识，不改变中止所有权。',
          whenToUse: '需要通过 task helper 精确调用该登记时设置。'
        }
      ]
    },
    en: {
      purpose:
        'Binds a subscription lifetime to an AbortSignal. A pre-aborted signal creates no registration; a later abort removes the source subscription and lets an event context in the same delivery race observe aborted plus the original reason. The returned unsubscribe function may end the binding early.',
      quickStart:
        "const controller = new AbortController()\nconst stop = subscribeUntil(\n  events,\n  controller.signal,\n  ({ value, aborted, abortReason }) => {\n    if (!aborted) render(value)\n    else logger.debug(abortReason)\n  }\n)\n\ncontroller.abort('screen closed')\nstop()",
      scenarios: [
        'A subscription must end with a screen, request, task, or lifecycle-scope cancellation.',
        'A listener racing with abort must observe the exact cancellation reason through its event context.'
      ],
      avoidWhen: [
        'No AbortSignal owner exists; a normal subscription has clearer ownership.',
        'The signal is not structurally compatible or has throwing add/removeEventListener behavior.'
      ],
      options: [
        {
          name: 'taskId',
          description:
            'Adds an optional task identity to the source registration without changing abort ownership.',
          whenToUse: 'Set it when task helpers must address this registration precisely.'
        }
      ]
    }
  },
  'event-subscriber:index:withSnapshotEntries': {
    zh: {
      purpose:
        '取得一次不可变订阅快照，并把每个目标包装成最多可调用一次的 invocation 交给 visitor。visitor 返回或 settle 后所有 invocation 都会关闭，之后调用会以 INVOCATION_CLOSED 拒绝。',
      quickStart:
        "await withSnapshotEntries(events, job, async (entries) => {\n  for (const entry of entries) {\n    if (entry.taskId !== 'audit') continue\n    await entry.invoke()\n  }\n})",
      scenarios: [
        '需要先检查稳定目标集合，再由调用方选择或调度其中部分 listener。',
        '自定义编排必须确保每个快照目标最多调用一次，并有明确关闭边界。'
      ],
      avoidWhen: [
        '只是并发、串行或按 taskId 调用；优先使用现成 invoke helper。',
        '需要观察 visitor 期间新增的订阅；快照不会包含后续登记。'
      ],
      options: []
    },
    en: {
      purpose:
        'Captures one immutable subscription snapshot and gives the visitor one at-most-once invocation per target. Every invocation closes when the visitor returns or settles; calling it later rejects as INVOCATION_CLOSED.',
      quickStart:
        "await withSnapshotEntries(events, job, async (entries) => {\n  for (const entry of entries) {\n    if (entry.taskId !== 'audit') continue\n    await entry.invoke()\n  }\n})",
      scenarios: [
        'The caller must inspect a stable target set before selecting or scheduling a subset of listeners.',
        'Custom orchestration needs one-call-per-target enforcement and an explicit closure boundary.'
      ],
      avoidWhen: [
        'Only parallel, serial, or task-directed invocation is needed; prefer the ready-made invocation helpers.',
        'Registrations added during the visitor must be visible; an immutable snapshot excludes them.'
      ],
      options: []
    }
  },
  'event-subscriber:index:invokeEachLive': {
    zh: {
      purpose:
        '按 Channel 的当前 live 登记逐项交给 visitor，并允许同一遍历期间追加的订阅在本轮可见。每个 invocation 最多执行一次，遍历结束后关闭；这是高级自定义调度原语。',
      quickStart:
        "invokeEachLive(events, job, (entry) => {\n  if (entry.taskId?.startsWith('critical:')) {\n    entry.invoke()\n  }\n})",
      scenarios: [
        '编排器明确需要 append-live 语义：visitor 期间新增的登记也可能在本轮被访问。',
        '调用方需要自行选择目标，同时保留 Channel 的调用关闭与 bookkeeping 语义。'
      ],
      avoidWhen: [
        '业务只需要稳定快照；使用 withSnapshotEntries。',
        '普通发布、串行或并行调用已经足够；不要为常规业务引入 live 遍历复杂度。'
      ],
      options: []
    },
    en: {
      purpose:
        "Visits the channel's live registrations and may expose subscriptions appended during the same traversal. Each invocation is at-most-once and closes after visitation; this is an advanced custom-scheduling primitive.",
      quickStart:
        "invokeEachLive(events, job, (entry) => {\n  if (entry.taskId?.startsWith('critical:')) {\n    entry.invoke()\n  }\n})",
      scenarios: [
        'An orchestrator explicitly needs append-live semantics, so registrations added by the visitor may be seen in the same pass.',
        "The caller selects targets while retaining the channel's invocation closure and bookkeeping semantics."
      ],
      avoidWhen: [
        'A stable target set is required; use withSnapshotEntries.',
        'Normal publish, serial, or parallel invocation is sufficient; avoid live traversal complexity in ordinary application code.'
      ],
      options: []
    }
  },
  'lifecycle:scope:createLifecycleScope': {
    zh: {
      purpose:
        '创建一个异步资源所有权作用域。一组资源先通过 own() 归属作用域，close() 同步关闭接纳边界，dispose() 再按逆序执行释放并等待终态；并发 dispose() 复用同一个 Promise。',
      quickStart:
        "const scope = createLifecycleScope({ errorPolicy: 'collect' })\nconst socket = scope.own(connect(), {\n  graceful: () => socket.flush(),\n  gracefulTimeoutMs: 200,\n  force: () => socket.close()\n})\n\nscope.close()\nconst failures = await scope.dispose()",
      scenarios: [
        '一个页面、服务、插件或请求同时拥有多个异步可释放资源。',
        '关闭必须先停止接纳新资源，再统一逆序释放，并明确处理多个释放失败。'
      ],
      avoidWhen: [
        '所有释放都必须在当前调用栈同步完成；使用 createSyncLifecycleScope。',
        '只需要等待 Promise 完成而不拥有资源；使用 pending/quiescence tracker。'
      ],
      options: [
        {
          name: 'errorPolicy',
          description: "决定释放失败采用 throw、collect、report 或 firstError；默认 'throw'。",
          defaultValue: "'throw'",
          whenToUse:
            '库边界通常选择 collect 后自行投影；应用边界可按诊断和关闭策略选择 report 或 firstError。'
        },
        {
          name: 'report',
          description:
            'report/firstError 策略使用的最后诊断出口；其自身失败会被隔离，不能替换主要释放结果。',
          whenToUse: '选择 report 或 firstError，或需要记录被隔离的次要清理失败时。'
        },
        {
          name: 'deadlineAt',
          description: '本次 dispose 中所有资源共享的绝对截止时间；优雅释放超时后仍会进入 force。',
          whenToUse: '宿主关闭有统一时间预算，且资源不能各自无限等待时。'
        },
        {
          name: 'scheduler',
          description: '拥有 deadlineAt 与 gracefulTimeoutMs 的时间域，默认使用 systemScheduler。',
          defaultValue: 'systemScheduler',
          whenToUse: '测试需要确定性时间，或宿主使用非系统调度器时。'
        }
      ]
    },
    en: {
      purpose:
        'Creates an asynchronous resource-ownership scope. Resources enter through own(), close() synchronously seals admission, and dispose() releases them in reverse order before reaching terminal state; concurrent dispose calls share one Promise.',
      quickStart:
        "const scope = createLifecycleScope({ errorPolicy: 'collect' })\nconst socket = scope.own(connect(), {\n  graceful: () => socket.flush(),\n  gracefulTimeoutMs: 200,\n  force: () => socket.close()\n})\n\nscope.close()\nconst failures = await scope.dispose()",
      scenarios: [
        'A page, service, plugin, or request owns several asynchronously disposable resources.',
        'Shutdown must seal new ownership first, release in reverse order, and handle several disposal failures explicitly.'
      ],
      avoidWhen: [
        'Every release must finish synchronously in the current stack; use createSyncLifecycleScope.',
        'Only Promise completion needs tracking and no resources are owned; use a pending or quiescence tracker.'
      ],
      options: [
        {
          name: 'errorPolicy',
          description:
            "Selects throw, collect, report, or firstError for release failures; defaults to 'throw'.",
          defaultValue: "'throw'",
          whenToUse:
            'Library boundaries often collect then project their own contract; application boundaries may choose report or firstError for shutdown diagnostics.'
        },
        {
          name: 'report',
          description:
            'Final diagnostic sink used by report and firstError. Its own failure is contained and cannot replace the primary disposal result.',
          whenToUse:
            'Provide it with report or firstError, or when contained secondary cleanup failures must be recorded.'
        },
        {
          name: 'deadlineAt',
          description:
            'Absolute deadline shared by every resource in this dispose run. A graceful timeout still proceeds to force release.',
          whenToUse:
            'The host has one shutdown budget and individual resources must not wait indefinitely.'
        },
        {
          name: 'scheduler',
          description:
            'Owns the time domain for deadlineAt and gracefulTimeoutMs; defaults to systemScheduler.',
          defaultValue: 'systemScheduler',
          whenToUse: 'Inject deterministic time in tests or a host-specific scheduler.'
        }
      ]
    }
  },
  'lifecycle:generation:createGenerationController': {
    zh: {
      purpose:
        '管理递增 generation 及每代独立的 AbortSignal。新的 begin() 会使旧 token 失效；adopt() 只接纳当前代结果，过期结果立即调用 release 回收。',
      quickStart:
        'const generations = createGenerationController()\nconst request = generations.begin({ timeoutMs: 5_000 })\nconst result = await loadConfig(request.signal)\n\nif (generations.adopt(request.token, result, (value) => value.close())) {\n  applyConfig(result)\n}',
      scenarios: [
        '搜索联想、路由加载、刷新或重连只允许最新请求结果生效。',
        '旧任务需要收到取消信号，并且其迟到资源必须立即释放。'
      ],
      avoidWhen: [
        '所有异步任务都应独立完成并保留结果；不需要 generation 所有权。',
        '需要管理一组资源的统一关闭；使用 LifecycleScope。'
      ],
      options: [
        {
          name: 'parentSignal',
          description: '父级取消信号；中止时同步中止当前活跃 generation，但不改变原始 reason。',
          whenToUse: 'controller 的寿命从属于请求、页面或更高层 lifecycle owner 时。'
        },
        {
          name: 'onSuperseded',
          description:
            'adopt 遇到过期 token 时收到 GENERATION_SUPERSEDED 诊断；它不是业务失败通知。',
          whenToUse: '需要观测频繁覆盖或迟到结果，但不希望改变 adopt 返回值时。'
        },
        {
          name: 'scheduler',
          description: '驱动 begin({ timeoutMs }) 的时间与取消任务，默认 systemScheduler。',
          defaultValue: 'systemScheduler',
          whenToUse: '超时测试需要手动时间，或宿主拥有独立时间域时。'
        }
      ]
    },
    en: {
      purpose:
        'Owns an increasing generation and one AbortSignal per generation. A new begin() invalidates the old token; adopt() accepts only the current result and immediately calls release for stale resources.',
      quickStart:
        'const generations = createGenerationController()\nconst request = generations.begin({ timeoutMs: 5_000 })\nconst result = await loadConfig(request.signal)\n\nif (generations.adopt(request.token, result, (value) => value.close())) {\n  applyConfig(result)\n}',
      scenarios: [
        'Autocomplete, route loading, refresh, or reconnect must allow only the latest request result to take effect.',
        'Superseded work needs a cancellation signal and any late resource must be released immediately.'
      ],
      avoidWhen: [
        'Every asynchronous task should finish independently and retain its result; generation ownership is unnecessary.',
        'A group of resources needs coordinated shutdown; use LifecycleScope.'
      ],
      options: [
        {
          name: 'parentSignal',
          description:
            'Parent cancellation signal. Aborting it synchronously aborts the active generation while preserving the original reason.',
          whenToUse:
            'The controller lifetime belongs to a request, screen, or higher lifecycle owner.'
        },
        {
          name: 'onSuperseded',
          description:
            'Receives GENERATION_SUPERSEDED diagnostics when adopt sees a stale token; it is not a business-failure callback.',
          whenToUse:
            'Observe frequent replacement or late results without changing the adopt outcome.'
        },
        {
          name: 'scheduler',
          description:
            'Drives begin({ timeoutMs }) timing and cancellation tasks; defaults to systemScheduler.',
          defaultValue: 'systemScheduler',
          whenToUse: 'Timeout tests need manual time or the host owns a separate time domain.'
        }
      ]
    }
  },
  'lifecycle:index:createMutationQueue': {
    zh: {
      purpose:
        '创建严格 FIFO、单任务执行的 mutation 队列。它不提供并发池；后续任务只能在前一任务 settle 后进入，并可用 owner 检测不可能完成的同 owner 自依赖。',
      quickStart:
        "const queue = createMutationQueue({ queueAdmissionTimeoutMs: 5_000 })\nconst result = await queue.enqueue(\n  () => updateSchema(change),\n  { owner: 'schema-sync' }\n)",
      scenarios: [
        '配置、schema、注册表或拓扑变更必须严格串行提交。',
        '排队等待需要独立的超时拒绝或 SLA 诊断。'
      ],
      avoidWhen: [
        '任务可以并发执行；使用并发池或 Promise 组合。',
        '当前任务需要等待自己刚提交的同 owner 任务；FIFO 下这是自依赖，应重构调用边界。'
      ],
      options: [
        {
          name: 'queueAdmissionTimeoutMs',
          description:
            '任务等待进入执行的上限；数字会超时拒绝，undefined 只诊断，false 关闭入队计时。',
          defaultValue: 'undefined',
          whenToUse: '调用方宁愿失败也不能无限等待更早 mutation 时设置数字。'
        },
        {
          name: 'admissionDiagnosticMs',
          description: '没有 admission timeout 时触发慢入队诊断的阈值；默认 1000ms，false 关闭。',
          defaultValue: '1_000',
          whenToUse: '等待仍应继续，但需要发现拥塞和长事务时。'
        },
        {
          name: 'onAdmissionDiagnostic',
          description: '接收等待 owner 与实际 waitedMs，不拥有任务失败或取消。',
          whenToUse: '需要把排队 SLA 发送到日志、指标或 tracing 时。'
        },
        {
          name: 'scheduler',
          description: '拥有入队超时与诊断计时，默认 systemScheduler。',
          defaultValue: 'systemScheduler',
          whenToUse: '队列时间需要确定性测试或宿主调度器时。'
        }
      ]
    },
    en: {
      purpose:
        'Creates a strict FIFO mutation queue with one running task. It is not a concurrency pool: each task enters only after its predecessor settles, and owner identity detects impossible same-owner self-dependency.',
      quickStart:
        "const queue = createMutationQueue({ queueAdmissionTimeoutMs: 5_000 })\nconst result = await queue.enqueue(\n  () => updateSchema(change),\n  { owner: 'schema-sync' }\n)",
      scenarios: [
        'Configuration, schema, registry, or topology mutations must commit serially.',
        'Queue admission needs an independent rejection deadline or SLA diagnostic.'
      ],
      avoidWhen: [
        'Tasks may execute concurrently; use a pool or Promise composition.',
        'A running task waits for another task it just enqueued with the same owner; that is a FIFO self-dependency and the ownership boundary must be redesigned.'
      ],
      options: [
        {
          name: 'queueAdmissionTimeoutMs',
          description:
            'Maximum wait to enter execution. A number rejects on timeout, undefined diagnoses only, and false disables admission timing.',
          defaultValue: 'undefined',
          whenToUse:
            'Set a number when waiting behind earlier mutations is less acceptable than a bounded failure.'
        },
        {
          name: 'admissionDiagnosticMs',
          description:
            'Slow-admission diagnostic threshold when no admission timeout owns the wait; defaults to 1000ms and false disables it.',
          defaultValue: '1_000',
          whenToUse:
            'The wait should continue, but congestion and long mutations must be observable.'
        },
        {
          name: 'onAdmissionDiagnostic',
          description:
            'Receives the waiting owner and actual waitedMs; it owns neither task failure nor cancellation.',
          whenToUse: 'Send queue SLA signals to logs, metrics, or tracing.'
        },
        {
          name: 'scheduler',
          description: 'Owns admission timeout and diagnostic timing; defaults to systemScheduler.',
          defaultValue: 'systemScheduler',
          whenToUse: 'Queue timing needs deterministic tests or a host scheduler.'
        }
      ]
    }
  },
  'lifecycle:index:createSyncLifecycleScope': {
    zh: {
      purpose:
        '创建只接纳同步安全资源的所有权作用域。每个 descriptor 必须声明 syncSafe: true，dispose() 在当前调用栈逆序释放；任何 thenable 返回都会以 SCOPE_SYNC_VIOLATION 拒绝。',
      quickStart:
        "const scope = createSyncLifecycleScope({ errorPolicy: 'collect' })\nconst observer = scope.own(createObserver(), {\n  syncSafe: true,\n  force: () => observer.disconnect()\n})\n\nscope.close()\nconst failures = scope.dispose()",
      scenarios: [
        'DOM listener、observer 或 native handle 必须在当前调用栈内释放。',
        '公开 dispose 契约必须保持同步，不能泄漏未等待的 Promise。'
      ],
      avoidWhen: [
        '任何 resource 需要 await、graceful timeout 或异步 force；使用 createLifecycleScope。',
        '不能证明 disposer 同步安全；不要用断言绕过 syncSafe 契约。'
      ],
      options: [
        {
          name: 'errorPolicy',
          description:
            "同步释放失败策略，支持 throw、collect、report 与 firstError，默认 'throw'。",
          defaultValue: "'throw'",
          whenToUse: '需要收集全部同步清理失败或把诊断隔离上报时选择非默认策略。'
        },
        {
          name: 'report',
          description: 'report/firstError 策略的诊断出口；report 自身失败不会替换释放结果。',
          whenToUse: '选择 report 或 firstError 并需要把失败送到日志或 telemetry 时。'
        }
      ]
    },
    en: {
      purpose:
        'Creates an ownership scope that accepts only synchronously safe resources. Every descriptor must declare syncSafe: true, dispose() releases in reverse order in the current stack, and any thenable result is rejected as SCOPE_SYNC_VIOLATION.',
      quickStart:
        "const scope = createSyncLifecycleScope({ errorPolicy: 'collect' })\nconst observer = scope.own(createObserver(), {\n  syncSafe: true,\n  force: () => observer.disconnect()\n})\n\nscope.close()\nconst failures = scope.dispose()",
      scenarios: [
        'DOM listeners, observers, or native handles must release in the current call stack.',
        'The public dispose contract must remain synchronous and cannot leak unobserved Promises.'
      ],
      avoidWhen: [
        'Any resource needs await, a graceful timeout, or asynchronous force release; use createLifecycleScope.',
        'Synchronous safety cannot be proven; do not bypass the syncSafe contract with an assertion.'
      ],
      options: [
        {
          name: 'errorPolicy',
          description:
            "Synchronous release policy supporting throw, collect, report, and firstError; defaults to 'throw'.",
          defaultValue: "'throw'",
          whenToUse:
            'Choose a non-default policy to retain all synchronous cleanup failures or isolate diagnostics.'
        },
        {
          name: 'report',
          description:
            'Diagnostic sink for report and firstError; its own failure cannot replace the disposal outcome.',
          whenToUse:
            'Provide it with report or firstError when failures must reach logging or telemetry.'
        }
      ]
    }
  },
  'lifecycle:index:createLifecycleUnit': {
    zh: {
      purpose:
        '管理一个可启动/重启单元的 idle、loading、loaded、failed 状态。每次 start/restart 创建新 generation，旧异步结果迟到时被丢弃，不会覆盖当前 value 或 error。',
      quickStart:
        'const config = createLifecycleUnit<Config>({\n  report: (error) => logger.error(error)\n})\nconfig.start(() => fetchConfig())\n\n// 新一轮开始后，旧请求的迟到结果不会被采用\nconfig.restart(() => fetchConfig({ fresh: true }))',
      scenarios: [
        '服务初始化、懒加载模块或配置刷新需要一个明确的装载状态机。',
        '重启后旧 Promise 仍可能 settle，但绝不能覆盖最新状态。'
      ],
      avoidWhen: [
        '任务需要保留每一轮结果；使用独立 Promise 或队列。',
        '单元还拥有 socket、timer 等待释放资源；组合 LifecycleScope 管理资源所有权。'
      ],
      options: [
        {
          name: 'report',
          description:
            'start factory 同步抛错或 thenable reject 时收到带 UNIT_START_FAILED 的诊断；unit.error 仍保存原始错误。',
          whenToUse: '失败除进入状态机外还需要统一日志或 telemetry 时。'
        }
      ]
    },
    en: {
      purpose:
        'Manages idle, loading, loaded, and failed state for a startable or restartable unit. Each start or restart opens a new generation, so a late old result cannot replace the current value or error.',
      quickStart:
        'const config = createLifecycleUnit<Config>({\n  report: (error) => logger.error(error)\n})\nconfig.start(() => fetchConfig())\n\n// A late result from the old request cannot replace current state\nconfig.restart(() => fetchConfig({ fresh: true }))',
      scenarios: [
        'Service initialization, lazy module loading, or configuration refresh needs an explicit loading state machine.',
        'An earlier Promise may settle after restart but must never replace the latest state.'
      ],
      avoidWhen: [
        'Every run result must be retained; use independent Promises or a queue.',
        'The unit also owns sockets, timers, or other disposable resources; compose a LifecycleScope for ownership.'
      ],
      options: [
        {
          name: 'report',
          description:
            'Receives a UNIT_START_FAILED diagnostic when the start factory throws or its thenable rejects; unit.error still retains the original error.',
          whenToUse: 'A failed state also needs centralized logging or telemetry.'
        }
      ]
    }
  },
  'lifecycle:index:createProvisionalScope': {
    zh: {
      purpose:
        '提供构造期两阶段资源所有权。资源先暂存在 provisional scope；构造成功后 commitTo(parent) 转移，失败则 rollback() 逆序释放，两个终局互斥且只能选择一次。',
      quickStart:
        'const provisional = createProvisionalScope({ parentSignal: shutdown.signal })\nconst connection = provisional.own(await connect(), {\n  force: () => connection.close()\n})\ntry {\n  await provisional.commitTo(scope)\n} catch (error) {\n  await provisional.rollback()\n  throw error\n}',
      scenarios: [
        '插件安装、模块装配或连接组初始化必须全部成功后才转交 owner。',
        '构造中途失败时，尚未转移的资源必须可靠逆序回滚。'
      ],
      avoidWhen: [
        '资源从创建起就已归属稳定 parent；直接 parent.own。',
        '需要在 commit 后再次 rollback；settled scope 不允许第二个终局。'
      ],
      options: [
        {
          name: 'parentSignal',
          description: '把父级取消状态镜像到 provisional.signal，原始中止 reason 保持不变。',
          whenToUse: '构造过程必须随请求、宿主关闭或父作用域取消时。'
        }
      ]
    },
    en: {
      purpose:
        'Provides two-phase resource ownership during construction. Resources first belong to the provisional scope, then either commitTo(parent) transfers them or rollback() releases them in reverse order; the two terminal choices are mutually exclusive and one-shot.',
      quickStart:
        'const provisional = createProvisionalScope({ parentSignal: shutdown.signal })\nconst connection = provisional.own(await connect(), {\n  force: () => connection.close()\n})\ntry {\n  await provisional.commitTo(scope)\n} catch (error) {\n  await provisional.rollback()\n  throw error\n}',
      scenarios: [
        'Plugin installation, module assembly, or connection-group setup must transfer ownership only after full success.',
        'Resources not yet transferred must roll back reliably in reverse order after construction failure.'
      ],
      avoidWhen: [
        'A stable parent owns each resource from creation; call parent.own directly.',
        'Rollback must occur after a successful commit; a settled provisional scope does not allow a second outcome.'
      ],
      options: [
        {
          name: 'parentSignal',
          description:
            'Mirrors parent cancellation into provisional.signal while preserving the original abort reason.',
          whenToUse:
            'Construction must stop with request cancellation, host shutdown, or a parent scope.'
        }
      ]
    }
  },
  'lifecycle:index:boundedWait': {
    zh: {
      purpose:
        '等待一个 PromiseLike 直到绝对 deadlineAt，并以 boolean 表示任务还是截止时间先到。超时只停止等待，不会取消 task；其迟到 rejection 仍会被观察，避免未处理拒绝。',
      quickStart:
        "const deadlineAt = systemScheduler.now() + 1_000\nconst completed = await boundedWait(flush(), deadlineAt)\nif (!completed) {\n  logger.warn('flush is still running after the shutdown budget')\n}",
      scenarios: [
        'graceful shutdown 只能等待到统一绝对截止时间，但后台任务允许继续收尾。',
        '需要区分“没有完成”与“已被取消”；boundedWait 不制造取消语义。'
      ],
      avoidWhen: [
        '超时必须中止任务；应把 AbortSignal 传给任务并由其协作取消。',
        '任务失败必须直接传播给调用方；boundedWait 只回答谁先完成。'
      ],
      options: []
    },
    en: {
      purpose:
        'Waits for a PromiseLike until an absolute deadlineAt and returns whether the task or deadline won. Timeout stops only the wait and never cancels the task; a late rejection remains observed to avoid an unhandled rejection.',
      quickStart:
        "const deadlineAt = systemScheduler.now() + 1_000\nconst completed = await boundedWait(flush(), deadlineAt)\nif (!completed) {\n  logger.warn('flush is still running after the shutdown budget')\n}",
      scenarios: [
        'Graceful shutdown may wait only until one absolute deadline while background cleanup is allowed to continue.',
        'The caller must distinguish not-completed from cancelled; boundedWait creates no cancellation semantics.'
      ],
      avoidWhen: [
        'Timeout must abort the task; pass an AbortSignal and let the task cooperate.',
        'Task rejection must propagate directly; boundedWait only answers which side completed first.'
      ],
      options: []
    }
  },
  'lifecycle:index:createTerminalController': {
    zh: {
      purpose:
        '创建可复用的 open → closing → terminal 存活轴。close() 只同步封闭接纳，forceTerminal() 进入终态，whenTerminal() 始终返回同一个只解析一次的 Promise。',
      quickStart:
        'const terminal = createTerminalController()\nterminal.close()\nawait finishOwnedWork()\nterminal.forceTerminal()\nawait terminal.whenTerminal()',
      scenarios: [
        '自定义容器需要独立于资源释放实现一个幂等存活状态机。',
        '多个调用方需要等待同一个稳定终态 Promise。'
      ],
      avoidWhen: [
        '还需要资源登记与释放事务；直接使用 LifecycleScope。',
        '业务状态包含 ready、failed 等领域含义；不要把它们塞进生命周期轴。'
      ],
      options: []
    },
    en: {
      purpose:
        'Creates a reusable open → closing → terminal lifetime axis. close() synchronously seals admission, forceTerminal() enters terminal state, and whenTerminal() always returns the same Promise resolved once.',
      quickStart:
        'const terminal = createTerminalController()\nterminal.close()\nawait finishOwnedWork()\nterminal.forceTerminal()\nawait terminal.whenTerminal()',
      scenarios: [
        'A custom container needs an idempotent lifetime state machine independent of resource release.',
        'Several callers must await one stable terminal Promise.'
      ],
      avoidWhen: [
        'Resource registration and disposal transactions are also needed; use LifecycleScope directly.',
        'Domain state includes ready or failed; do not overload the lifecycle axis with business status.'
      ],
      options: []
    }
  },
  'lifecycle:disposal:createDisposeTransaction': {
    zh: {
      purpose:
        '编排多个 release descriptor 的完整释放事务。order 模式按 descriptor.order 稳定分组，plan 模式严格遵循调用方顺序；事务统一拥有错误策略、截止时间、中止镜像与 pending 排空。',
      quickStart:
        "const transaction = createDisposeTransaction(\n  { kind: 'plan' },\n  { errorPolicy: 'collect', signal: shutdown.signal }\n)\nconst failures = await transaction.run([\n  { source: 'database', descriptor: databaseRelease },\n  { source: 'socket', descriptor: socketRelease }\n])",
      scenarios: [
        '服务停机、连接池关闭或插件卸载需要对多个资源执行统一 graceful → force 语义。',
        '调用方需要显式选择弱排序 order 或强顺序 plan，并保留全部释放失败。'
      ],
      avoidWhen: [
        '只释放一个 descriptor；使用 executeReleaseDescriptor。',
        '资源还需要注册、反注册和 close 接纳边界；使用 LifecycleScope。'
      ],
      options: [
        {
          name: 'errorPolicy',
          description: "决定 item 失败采用 throw、collect、report 或 firstError，默认 'throw'。",
          defaultValue: "'throw'",
          whenToUse: '事务 owner 需要收集全部失败或把次要失败送入诊断通道时。'
        },
        {
          name: 'deadlineAt',
          description: '所有 item 共享的绝对截止时间，不会为每项重新计算完整预算。',
          whenToUse: '整个关闭流程只有一个宿主级时间预算时。'
        },
        {
          name: 'signal',
          description: '传入每个 release context 的取消信号；run 开始时也会镜像已中止状态。',
          whenToUse: '释放事务从属于更高层关闭或取消边界时。'
        },
        {
          name: 'pending',
          description: '每个 item 释放后调用 drain()，等待该释放触发的在途工作排空。',
          whenToUse: 'disposer 会启动必须在下一 item 前完成的异步尾部工作时。'
        }
      ]
    },
    en: {
      purpose:
        'Orchestrates a complete release transaction over several descriptors. Order mode groups stably by descriptor.order, while plan mode follows caller order exactly; the transaction owns error policy, deadline, abort mirroring, and pending drain.',
      quickStart:
        "const transaction = createDisposeTransaction(\n  { kind: 'plan' },\n  { errorPolicy: 'collect', signal: shutdown.signal }\n)\nconst failures = await transaction.run([\n  { source: 'database', descriptor: databaseRelease },\n  { source: 'socket', descriptor: socketRelease }\n])",
      scenarios: [
        'Service shutdown, pool closure, or plugin unload needs consistent graceful-to-force semantics across resources.',
        'The caller must choose weak order or a strict plan and retain every release failure.'
      ],
      avoidWhen: [
        'Only one descriptor is being released; use executeReleaseDescriptor.',
        'Resources also need registration, removal, and a closed admission boundary; use LifecycleScope.'
      ],
      options: [
        {
          name: 'errorPolicy',
          description:
            "Selects throw, collect, report, or firstError for item failures; defaults to 'throw'.",
          defaultValue: "'throw'",
          whenToUse:
            'The transaction owner must retain every failure or route secondary failures to diagnostics.'
        },
        {
          name: 'deadlineAt',
          description:
            'Absolute deadline shared by every item rather than resetting a full budget for each release.',
          whenToUse: 'The whole shutdown sequence has one host-level time budget.'
        },
        {
          name: 'signal',
          description:
            'Cancellation signal forwarded to every release context; run also mirrors a pre-aborted state.',
          whenToUse: 'The transaction belongs to a higher shutdown or cancellation boundary.'
        },
        {
          name: 'pending',
          description:
            'Calls drain() after each item so asynchronous tail work started by that release finishes before continuing.',
          whenToUse:
            'A disposer starts required background work that must finish before the next item.'
        }
      ]
    }
  },
  'lifecycle:disposal:executeReleaseDescriptor': {
    zh: {
      purpose:
        '独立执行一个 release descriptor：custom 完全接管，否则先尝试有界 graceful，再无条件执行 force。它返回全部失败数组且从不因 descriptor 失败抛出。',
      quickStart:
        'const errors = await executeReleaseDescriptor(descriptor, {\n  signal: shutdown.signal,\n  deadlineAt,\n  report: (error) => logger.error(error)\n})',
      scenarios: [
        '自定义编排器只需复用单个资源的标准 graceful → force 降级链。',
        '测试需要直接验证 descriptor 的释放与错误收集。'
      ],
      avoidWhen: [
        '多个资源需要顺序、错误策略或 pending 排空；使用 createDisposeTransaction。',
        '调用方期望失败直接抛出；应根据返回数组在领域边界自行投影。'
      ],
      options: []
    },
    en: {
      purpose:
        'Executes one release descriptor independently: custom takes full ownership; otherwise bounded graceful runs before unconditional force. It returns every failure and never throws because descriptor execution failed.',
      quickStart:
        'const errors = await executeReleaseDescriptor(descriptor, {\n  signal: shutdown.signal,\n  deadlineAt,\n  report: (error) => logger.error(error)\n})',
      scenarios: [
        'A custom orchestrator needs the standard graceful-to-force chain for one resource.',
        'A test needs to exercise descriptor release and raw error collection directly.'
      ],
      avoidWhen: [
        'Several resources need ordering, error policy, or pending drain; use createDisposeTransaction.',
        'The caller expects direct throwing behavior; project the returned errors at the domain boundary.'
      ],
      options: []
    }
  },
  'lifecycle:quiescence:createPendingTracker': {
    zh: {
      purpose:
        '用窄接口追踪在途 Promise。track() 原样返回输入并在 settle 后自动减计数；drain() 循环等待真正归零，包括排空期间新加入的任务。',
      quickStart:
        'const pending = createPendingTracker()\nconst save = pending.track(persistDraft())\nawait save\n\nawait pending.drain()\nconsole.log(pending.size) // 0',
      scenarios: [
        'flush、close、批处理或 SSR 请求结束前必须等待全部在途工作。',
        '任务可能在 drain 期间继续派生新任务，仍不能漏计。'
      ],
      avoidWhen: [
        '需要按 key 区分占用；使用 quiescence tracker 或 lease registry。',
        '需要取消任务；pending tracker 只计数和等待。'
      ],
      options: []
    },
    en: {
      purpose:
        'Tracks in-flight Promises through a narrow interface. track() returns its input unchanged and decrements after settlement; drain() loops until true zero, including work added while draining.',
      quickStart:
        'const pending = createPendingTracker()\nconst save = pending.track(persistDraft())\nawait save\n\nawait pending.drain()\nconsole.log(pending.size) // 0',
      scenarios: [
        'Flush, close, batching, or SSR completion must await all in-flight work.',
        'Tasks may create more tracked work during drain and none may be missed.'
      ],
      avoidWhen: [
        'Occupancy must be separated by key; use a quiescence tracker or lease registry.',
        'Tasks need cancellation; a pending tracker only counts and waits.'
      ],
      options: []
    }
  },
  'lifecycle:quiescence:createQuiescenceTracker': {
    zh: {
      purpose:
        '按对象 key 管理引用计数、封存与归零等待。retain() 返回幂等 release；seal() 禁止新增租约；whenZero() 只允许在 seal 后等待，确保闭世界归零。',
      quickStart:
        'const tracker = createQuiescenceTracker<object>()\nconst release = tracker.retain(session)\ntracker.seal(session)\nrelease()\nawait tracker.whenZero(session)',
      scenarios: [
        '共享 session、channel 或 cache entry 需要知道是否仍被对象 owner 占用。',
        '关闭前需要先封存新增租约，再证明当前租约全部释放。'
      ],
      avoidWhen: [
        'key 是稳定字符串；使用 createStringQuiescenceTracker。',
        '只追踪全局 Promise 数量；使用 createPendingTracker。'
      ],
      options: []
    },
    en: {
      purpose:
        'Tracks retain count, sealing, and zero wait per object key. retain() returns an idempotent release, seal() rejects new leases, and whenZero() is legal only after seal so the zero proof is closed-world.',
      quickStart:
        'const tracker = createQuiescenceTracker<object>()\nconst release = tracker.retain(session)\ntracker.seal(session)\nrelease()\nawait tracker.whenZero(session)',
      scenarios: [
        'A shared session, channel, or cache entry must know whether object owners still hold it.',
        'Shutdown must seal new leases before proving every current lease released.'
      ],
      avoidWhen: [
        'Keys are stable strings; use createStringQuiescenceTracker.',
        'Only one global Promise count matters; use createPendingTracker.'
      ],
      options: []
    }
  },
  'lifecycle:scheduler:createManualScheduler': {
    zh: {
      purpose:
        '创建不依赖真实等待的确定性虚拟时钟。schedule() 登记任务，advance(ms) 推进时间并一次性执行所有到期任务，包括到期 callback 新增的同截止任务。',
      quickStart:
        'const scheduler = createManualScheduler()\nlet fired = false\nscheduler.schedule(() => { fired = true }, 100)\nscheduler.advance(99)\nconsole.log(fired) // false\nscheduler.advance(1)\nconsole.log(fired) // true',
      scenarios: [
        'timeout、deadline、重试或队列 SLA 单测不能依赖真实时间。',
        '需要精确验证同一时刻任务的稳定执行和取消。'
      ],
      avoidWhen: [
        '生产宿主需要真实单调时间；使用 systemScheduler。',
        '代码直接调用 Date.now 或 setTimeout；先把 scheduler 注入真正的时间 owner。'
      ],
      options: []
    },
    en: {
      purpose:
        'Creates a deterministic virtual clock with no real waiting. schedule() registers work and advance(ms) flushes every due task, including same-deadline work scheduled by a due callback.',
      quickStart:
        'const scheduler = createManualScheduler()\nlet fired = false\nscheduler.schedule(() => { fired = true }, 100)\nscheduler.advance(99)\nconsole.log(fired) // false\nscheduler.advance(1)\nconsole.log(fired) // true',
      scenarios: [
        'Timeout, deadline, retry, or queue-SLA tests cannot depend on wall-clock time.',
        'Tests need exact verification of stable same-time execution and cancellation.'
      ],
      avoidWhen: [
        'A production host needs real monotonic time; use systemScheduler.',
        'Code still calls Date.now or setTimeout directly; inject the scheduler into the actual time owner first.'
      ],
      options: []
    }
  },
  'lifecycle:abort:createAbortController': {
    zh: {
      purpose:
        '取得当前宿主原生 AbortController 实例，保留 native brand、AbortSignal 事件分发与 reason identity。宿主不支持时以 ENV_UNSUPPORTED 快速失败。',
      quickStart:
        "const controller = createAbortController()\nconst request = fetch(url, { signal: controller.signal })\ncontroller.abort('navigation replaced')\nawait request",
      scenarios: [
        'runtime-neutral 代码需要真实平台取消信号，但不能静态依赖 DOM 类型实现。',
        '取消原因必须原样穿过 fetch、stream 或其他 signal-aware API。'
      ],
      avoidWhen: [
        '只需要测试时间超时而不需要原生 signal；使用 scheduler 驱动的原语。',
        '试图捕获外部 abort listener 抛错；该错误遵循宿主 EventTarget 通道。'
      ],
      options: []
    },
    en: {
      purpose:
        'Returns a native AbortController from the current host, preserving native brand, AbortSignal dispatch, and reason identity. An unsupported host fails fast with ENV_UNSUPPORTED.',
      quickStart:
        "const controller = createAbortController()\nconst request = fetch(url, { signal: controller.signal })\ncontroller.abort('navigation replaced')\nawait request",
      scenarios: [
        'Runtime-neutral code needs a real platform cancellation signal without statically owning a DOM implementation.',
        'Cancellation reason identity must pass through fetch, streams, or other signal-aware APIs.'
      ],
      avoidWhen: [
        'Only deterministic timeout testing is needed and no native signal is required; use scheduler-driven primitives.',
        'External abort-listener exceptions must be captured; they follow the host EventTarget error channel.'
      ],
      options: []
    }
  },
  'lifecycle:abort:observeAbortSubscription': {
    zh: {
      purpose:
        '以受控边界登记一个 AbortSignal listener，并返回显式 cleanup。它捕获读取 signal、安装、回调与移除阶段的失败，交给调用方提供的 failure sink，而不是让生命周期基础设施静默吞错。',
      quickStart:
        'const observed = observeAbortSubscription(\n  signal,\n  () => cancelOperation(signal.reason),\n  { report: (failure) => logger.error(failure) }\n)\n\nobserved.cleanup()',
      scenarios: [
        '生命周期原语内部需要观察结构化 AbortSignal，同时隔离 hostile getter 或 listener API。',
        '取消回调和清理失败必须进入明确诊断通道。'
      ],
      avoidWhen: [
        '应用代码只需普通 signal.addEventListener；直接使用原生 API 更清晰。',
        '需要创建信号；使用 createAbortController。'
      ],
      options: []
    },
    en: {
      purpose:
        'Registers an AbortSignal listener behind a controlled boundary and returns explicit cleanup. Failures while reading the signal, installing, invoking, or removing are sent to the caller-owned failure sink rather than silently swallowed by lifecycle infrastructure.',
      quickStart:
        'const observed = observeAbortSubscription(\n  signal,\n  () => cancelOperation(signal.reason),\n  { report: (failure) => logger.error(failure) }\n)\n\nobserved.cleanup()',
      scenarios: [
        'A lifecycle primitive must observe a structural AbortSignal while containing hostile getters or listener APIs.',
        'Cancellation callback and cleanup failures need an explicit diagnostic path.'
      ],
      avoidWhen: [
        'Application code only needs normal signal.addEventListener; use the native API directly.',
        'A signal must be created; use createAbortController.'
      ],
      options: []
    }
  },
  'lifecycle:disposal:createSyncStartedDisposalLedger': {
    zh: {
      purpose:
        '为“同步启动、异步完成”的 dispose API 建立唯一账本。start() 在当前调用栈执行 callback，seal() 关闭接纳并返回同步错误快照与稳定 completion；全部 thenable settle 后才进入 terminal。',
      quickStart:
        "const ledger = createSyncStartedDisposalLedger()\nledger.start('socket', () => socket.close())\nledger.start('cache', () => cache.flush())\n\nconst outcome = ledger.seal()\nhandleSyncErrors(outcome.synchronousErrors)\nconst allErrors = await outcome.completion",
      scenarios: [
        '公开 dispose() 必须同步返回，但它启动的异步清理仍需要可等待 completion。',
        '领域适配器自行决定顺序与错误投影，只需要 lifecycle 管 pending 和原始错误观察。'
      ],
      avoidWhen: [
        'dispose 本身可以返回 Promise；使用 LifecycleScope 或 DisposeTransaction。',
        '需要超时或取消永不 settle 的 thenable；ledger 不制造这些语义。'
      ],
      options: []
    },
    en: {
      purpose:
        'Provides one ledger for disposal that starts synchronously and completes asynchronously. start() invokes callbacks in the current stack, seal() closes admission and returns a synchronous-error snapshot plus stable completion, and terminal waits for every thenable settlement.',
      quickStart:
        "const ledger = createSyncStartedDisposalLedger()\nledger.start('socket', () => socket.close())\nledger.start('cache', () => cache.flush())\n\nconst outcome = ledger.seal()\nhandleSyncErrors(outcome.synchronousErrors)\nconst allErrors = await outcome.completion",
      scenarios: [
        'A public dispose() must return synchronously while asynchronous cleanup still needs awaitable completion.',
        'A domain adapter owns ordering and error projection but needs lifecycle-owned pending and raw error observation.'
      ],
      avoidWhen: [
        'dispose may return a Promise; use LifecycleScope or DisposeTransaction.',
        'A never-settling thenable needs timeout or cancellation; the ledger creates neither semantic.'
      ],
      options: []
    }
  },
  'lifecycle:errors:containAsyncRejection': {
    zh: {
      purpose:
        '检查一个本应为 void 的 callback 返回值；若它实际是 PromiseLike，则只读取一次 then 并观察 rejection，防止异步回调偷偷制造未处理拒绝。',
      quickStart:
        'const result = diagnosticReporter(error)\ncontainAsyncRejection(result, (reportError) => {\n  emergencyLog.write(reportError)\n})',
      scenarios: [
        '类型声明为 void 的诊断或 cleanup callback 在运行时可能返回 Promise。',
        '基础设施必须观察 hostile then getter 和迟到 rejection。'
      ],
      avoidWhen: [
        '调用方本来就能 await callback；直接 await 并处理 rejection。',
        '需要传播结果值；该 API 只负责 containment。'
      ],
      options: []
    },
    en: {
      purpose:
        'Inspects the return from a callback expected to be void. If it is PromiseLike, the function reads then once and observes rejection so an accidentally async callback cannot create an unhandled rejection.',
      quickStart:
        'const result = diagnosticReporter(error)\ncontainAsyncRejection(result, (reportError) => {\n  emergencyLog.write(reportError)\n})',
      scenarios: [
        'A diagnostic or cleanup callback typed as void may return a Promise at runtime.',
        'Infrastructure must observe hostile then getters and late rejection.'
      ],
      avoidWhen: [
        'The caller can already await the callback; await it and handle rejection directly.',
        'The result value must propagate; this API owns containment only.'
      ],
      options: []
    }
  },
  'lifecycle:errors:createErrorCollector': {
    zh: {
      purpose:
        '按 throw、collect、report 或 firstError 策略累积多项失败，并在 finalize() 统一产生返回值或抛错。source 与原始 error 保持分离，reporter 自身失败被隔离。',
      quickStart:
        "const errors = createErrorCollector('collect', undefined)\nfor (const item of items) {\n  try { await release(item) }\n  catch (error) { errors.add(item.id, error) }\n}\nconst failures = errors.finalize('release failed')",
      scenarios: [
        '自定义资源编排需要复用 lifecycle 的四种稳定错误策略。',
        '多个失败必须保留 source，并在末尾统一投影。'
      ],
      avoidWhen: [
        '只有单一操作失败；直接传播原错误。',
        '需要领域专属 AggregateError 结构；在 collector 输出后由领域层构造。'
      ],
      options: []
    },
    en: {
      purpose:
        'Accumulates item failures under throw, collect, report, or firstError and lets finalize() produce the final return or throw. Source remains separate from the original error, and reporter failure is contained.',
      quickStart:
        "const errors = createErrorCollector('collect', undefined)\nfor (const item of items) {\n  try { await release(item) }\n  catch (error) { errors.add(item.id, error) }\n}\nconst failures = errors.finalize('release failed')",
      scenarios: [
        "Custom resource orchestration needs lifecycle's four stable error policies.",
        'Several failures must retain their source and be projected once at the end.'
      ],
      avoidWhen: [
        'Only one operation can fail; propagate its original error directly.',
        'A domain-specific AggregateError shape is required; construct it from collector output at the domain boundary.'
      ],
      options: []
    }
  },
  'lifecycle:quiescence:createStringQuiescenceTracker': {
    zh: {
      purpose:
        '创建字符串 key 的 quiescence tracker。语义与对象版相同，但使用 Map，并在未 seal 的 key 归零后删除无状态条目，避免长期字符串 key 堆积。',
      quickStart:
        "const tracker = createStringQuiescenceTracker()\nconst release = tracker.retain('session:42')\ntracker.seal('session:42')\nrelease()\nawait tracker.whenZero('session:42')",
      scenarios: [
        'session id、channel name 或 cache key 是稳定字符串。',
        '需要 seal 后的闭世界归零证明。'
      ],
      avoidWhen: [
        'key 是对象且应随 GC 消失；使用 createQuiescenceTracker。',
        '只需要一个全局 pending 数量；使用 createPendingTracker。'
      ],
      options: []
    },
    en: {
      purpose:
        'Creates a string-keyed quiescence tracker. It shares object-tracker semantics but uses a Map and removes pristine unsealed entries at zero so long-lived string keys do not accumulate.',
      quickStart:
        "const tracker = createStringQuiescenceTracker()\nconst release = tracker.retain('session:42')\ntracker.seal('session:42')\nrelease()\nawait tracker.whenZero('session:42')",
      scenarios: [
        'Session IDs, channel names, or cache keys are stable strings.',
        'A closed-world zero proof is required after sealing.'
      ],
      avoidWhen: [
        'Keys are objects and should disappear with garbage collection; use createQuiescenceTracker.',
        'Only one global pending count is needed; use createPendingTracker.'
      ],
      options: []
    }
  },
  'lifecycle:quiescence:createObjectLeaseRegistry': {
    zh: {
      purpose:
        '以 lease 领域命名创建对象 key 的 quiescence tracker；实现与语义完全相同，不新增引用计数或生命周期层。',
      quickStart:
        'const leases = createObjectLeaseRegistry<object>()\nconst release = leases.retain(resource)\nleases.seal(resource)\nrelease()\nawait leases.whenZero(resource)',
      scenarios: [
        '调用点把 retain/release 关系称为对象租约时。',
        '仍需要 seal、whenZero 与 whenZeroOnce 的完整语义。'
      ],
      avoidWhen: [
        '需要不同于 quiescence tracker 的行为；该 API 只是领域别名。',
        'key 是字符串；使用 createStringLeaseRegistry。'
      ],
      options: []
    },
    en: {
      purpose:
        'Creates the object-keyed quiescence tracker under lease-oriented domain naming; implementation and semantics are identical and add no second counting or lifecycle layer.',
      quickStart:
        'const leases = createObjectLeaseRegistry<object>()\nconst release = leases.retain(resource)\nleases.seal(resource)\nrelease()\nawait leases.whenZero(resource)',
      scenarios: [
        'The call site describes retain and release as object leases.',
        'Full seal, whenZero, and whenZeroOnce semantics remain necessary.'
      ],
      avoidWhen: [
        'Behavior different from the quiescence tracker is expected; this API is a domain alias only.',
        'Keys are strings; use createStringLeaseRegistry.'
      ],
      options: []
    }
  },
  'lifecycle:quiescence:createStringLeaseRegistry': {
    zh: {
      purpose:
        '以 lease 领域命名创建字符串 key 的 quiescence tracker；零计数清理、seal 和等待语义与字符串 tracker 完全一致。',
      quickStart:
        "const leases = createStringLeaseRegistry()\nconst release = leases.retain('connection:primary')\nleases.seal('connection:primary')\nrelease()\nawait leases.whenZero('connection:primary')",
      scenarios: [
        '稳定字符串标识表示共享资源租约。',
        '调用方需要 closed-world drain，而不是轮询 count。'
      ],
      avoidWhen: [
        'key 是对象；使用 createObjectLeaseRegistry。',
        '只追踪 Promise；使用 createPendingTracker。'
      ],
      options: []
    },
    en: {
      purpose:
        'Creates the string-keyed quiescence tracker under lease-oriented naming; zero-count pruning, sealing, and wait semantics are identical to the string tracker.',
      quickStart:
        "const leases = createStringLeaseRegistry()\nconst release = leases.retain('connection:primary')\nleases.seal('connection:primary')\nrelease()\nawait leases.whenZero('connection:primary')",
      scenarios: [
        'Stable string identities represent shared-resource leases.',
        'The caller needs a closed-world drain instead of polling count.'
      ],
      avoidWhen: [
        'Keys are objects; use createObjectLeaseRegistry.',
        'Only Promises are tracked; use createPendingTracker.'
      ],
      options: []
    }
  },
  'lifecycle:scheduler:snapshotScheduler': {
    zh: {
      purpose:
        '把未知 duck-typed 值快照为稳定 ILifecycleScheduler。它只读取一次 now 与 schedule，绑定原 receiver；非 scheduler 返回 undefined，hostile getter 则以 INVALID_OPTION 抛错。',
      quickStart:
        "const scheduler = snapshotScheduler(candidate)\nif (!scheduler) {\n  throw new TypeError('A scheduler is required')\n}\nconst cancel = scheduler.schedule(run, 10)",
      scenarios: [
        '公开配置接受 unknown scheduler，需要在边界一次校验并冻结调用能力。',
        '必须防止 getter 二次读取或 receiver 丢失改变行为。'
      ],
      avoidWhen: [
        '值已经是内部可信 scheduler；无需重复快照。',
        '只需解析可选项与默认值；使用 resolveSchedulerOption。'
      ],
      options: []
    },
    en: {
      purpose:
        'Snapshots an unknown duck-typed value into a stable ILifecycleScheduler. It reads now and schedule once and preserves their receiver; a non-scheduler returns undefined while hostile getters throw INVALID_OPTION.',
      quickStart:
        "const scheduler = snapshotScheduler(candidate)\nif (!scheduler) {\n  throw new TypeError('A scheduler is required')\n}\nconst cancel = scheduler.schedule(run, 10)",
      scenarios: [
        'A public option accepts an unknown scheduler and needs one boundary validation plus capability snapshot.',
        'A second getter read or lost receiver must not change behavior.'
      ],
      avoidWhen: [
        'The value is already an internally trusted scheduler; another snapshot is unnecessary.',
        'Only optional-value parsing and a default are needed; use resolveSchedulerOption.'
      ],
      options: []
    }
  },
  'lifecycle:scheduler:systemScheduler': {
    zh: {
      purpose:
        'Lifecycle 的默认真实时间实现：now() 使用单调 performance.now，schedule() 使用可取消 host timer；模块加载不创建 timer，缺少宿主能力时首次调用才以 ENV_UNSUPPORTED 失败。',
      quickStart:
        'const startedAt = systemScheduler.now()\nconst task = systemScheduler.schedule(runCleanup, 250)\n// 如无需执行，取消是幂等的\ntask.cancel()',
      scenarios: [
        '生产运行时需要统一的单调时钟和有界延迟排程。',
        '调用 lifecycle API 时不需要自定义时间域，采用默认 scheduler。'
      ],
      avoidWhen: [
        '测试需要确定性虚拟时间；使用 createManualScheduler。',
        '宿主没有 performance.now 或 timer；应注入兼容 scheduler。'
      ],
      options: []
    },
    en: {
      purpose:
        "Lifecycle's default real-time implementation: now() uses monotonic performance.now and schedule() uses a cancellable host timer. Module loading creates no timer, and missing host capabilities fail lazily as ENV_UNSUPPORTED.",
      quickStart:
        'const startedAt = systemScheduler.now()\nconst task = systemScheduler.schedule(runCleanup, 250)\n// Cancellation is idempotent when the task is no longer needed\ntask.cancel()',
      scenarios: [
        'Production runtime needs one monotonic clock and bounded-delay scheduler.',
        'Lifecycle APIs can use their default time domain without custom injection.'
      ],
      avoidWhen: [
        'Tests need deterministic virtual time; use createManualScheduler.',
        'The host lacks performance.now or timers; inject a compatible scheduler.'
      ],
      options: []
    }
  },
  'lifecycle:scheduler:resolveScheduler': {
    zh: {
      purpose:
        '在 factory 边界把必填 unknown 值解析为稳定 scheduler snapshot。非法形状以 INVALID_OPTION 抛错，hostile accessor 的原始失败保留在 cause。',
      quickStart:
        'function createRuntime(options: { scheduler: unknown }) {\n  const scheduler = resolveScheduler(options.scheduler)\n  return { now: () => scheduler.now() }\n}',
      scenarios: [
        '公开 factory 要求调用方必须提供 scheduler。',
        '解析后不能再次读取调用方对象上的 now/schedule getter。'
      ],
      avoidWhen: [
        'scheduler 是可选项并有 fallback；使用 resolveSchedulerOption。',
        '探测失败应返回 undefined；使用 snapshotScheduler。'
      ],
      options: []
    },
    en: {
      purpose:
        'Resolves a required unknown value into a stable scheduler snapshot at a factory boundary. Invalid shape throws INVALID_OPTION, while an accessor failure remains reachable through cause.',
      quickStart:
        'function createRuntime(options: { scheduler: unknown }) {\n  const scheduler = resolveScheduler(options.scheduler)\n  return { now: () => scheduler.now() }\n}',
      scenarios: [
        'A public factory requires the caller to supply a scheduler.',
        'Caller-owned now and schedule getters must not be read again after admission.'
      ],
      avoidWhen: [
        'The scheduler option is optional and has a fallback; use resolveSchedulerOption.',
        'Probe failure should return undefined; use snapshotScheduler.'
      ],
      options: []
    }
  },
  'lifecycle:scheduler:resolveSchedulerOption': {
    zh: {
      purpose:
        '只读取一次 options.scheduler，并在创建 lifecycle 对象前快照；缺失时返回调用方 fallback 或 undefined，getter 失败则作为 INVALID_OPTION 保留 cause。',
      quickStart:
        "const scheduler = resolveSchedulerOption(options, systemScheduler)\nconst deadlineAt = addSchedulerTime(\n  scheduler.now(),\n  timeoutMs,\n  'deadlineAt'\n)",
      scenarios: [
        'factory 接受可选 scheduler 并需要稳定默认值。',
        '必须把 caller-owned options getter 风险隔离在构造入口。'
      ],
      avoidWhen: [
        'scheduler 值本身是必填参数；使用 resolveScheduler。',
        '需要保留缺失为 undefined 时，不要传 fallback。'
      ],
      options: []
    },
    en: {
      purpose:
        'Reads options.scheduler once and snapshots it before lifecycle-object construction. Absence returns the supplied fallback or undefined; getter failure becomes INVALID_OPTION with its cause retained.',
      quickStart:
        "const scheduler = resolveSchedulerOption(options, systemScheduler)\nconst deadlineAt = addSchedulerTime(\n  scheduler.now(),\n  timeoutMs,\n  'deadlineAt'\n)",
      scenarios: [
        'A factory accepts an optional scheduler with a stable default.',
        'Risk from caller-owned option getters must be contained at construction admission.'
      ],
      avoidWhen: [
        'The scheduler value is a required direct parameter; use resolveScheduler.',
        'Absence must remain undefined; omit the fallback.'
      ],
      options: []
    }
  },
  'lifecycle:scheduler:validateSchedulerTime': {
    zh: {
      purpose:
        '校验 scheduler 产生或消费的时间值必须是有限 number，并原样返回；类型错误保持 TypeError，NaN/Infinity 保持 RangeError，均带 INVALID_OPTION。',
      quickStart:
        "const now = validateSchedulerTime(candidate.now(), 'now()')\nconst deadlineAt = validateSchedulerTime(options.deadlineAt, 'deadlineAt')",
      scenarios: [
        '实现自定义 scheduler 时校验 now() 输出。',
        '公开配置接收绝对时间并需要统一错误契约。'
      ],
      avoidWhen: [
        '值还必须非负；使用 validateSchedulerDelay。',
        '需要把 base 与 delta 相加并检查溢出；使用 addSchedulerTime。'
      ],
      options: []
    },
    en: {
      purpose:
        'Validates that scheduler-produced or consumed time is a finite number and returns it unchanged. Wrong type remains TypeError, NaN or Infinity remains RangeError, and both carry INVALID_OPTION.',
      quickStart:
        "const now = validateSchedulerTime(candidate.now(), 'now()')\nconst deadlineAt = validateSchedulerTime(options.deadlineAt, 'deadlineAt')",
      scenarios: [
        'A custom scheduler implementation must validate its now() result.',
        'A public option accepts absolute time under the shared error contract.'
      ],
      avoidWhen: [
        'The value must also be non-negative; use validateSchedulerDelay.',
        'Base and delta must be added with overflow protection; use addSchedulerTime.'
      ],
      options: []
    }
  },
  'lifecycle:scheduler:validateSchedulerDelay': {
    zh: {
      purpose:
        '校验 delay 必须是有限非负 number，并返回校验值；负数、NaN 和 Infinity 以带 INVALID_OPTION 的 RangeError 拒绝。',
      quickStart:
        "function schedule(callback: () => void, delayMs: unknown) {\n  const delay = validateSchedulerDelay(delayMs, 'retryDelayMs')\n  return systemScheduler.schedule(callback, delay)\n}",
      scenarios: [
        '自定义 scheduler 或 timeout option 接受延迟值。',
        '需要与 lifecycle 内部相同的类型和范围错误。'
      ],
      avoidWhen: [
        '绝对时间允许负值；使用 validateSchedulerTime。',
        '还要计算绝对目标并防止加法溢出；再调用 addSchedulerTime。'
      ],
      options: []
    },
    en: {
      purpose:
        'Validates a delay as a finite non-negative number and returns it. Negative, NaN, and Infinity reject as a RangeError carrying INVALID_OPTION.',
      quickStart:
        "function schedule(callback: () => void, delayMs: unknown) {\n  const delay = validateSchedulerDelay(delayMs, 'retryDelayMs')\n  return systemScheduler.schedule(callback, delay)\n}",
      scenarios: [
        'A custom scheduler or timeout option accepts a delay value.',
        'The boundary needs the same type and range errors as lifecycle internals.'
      ],
      avoidWhen: [
        'An absolute time may be negative; use validateSchedulerTime.',
        'An absolute target must also be computed with overflow protection; then use addSchedulerTime.'
      ],
      options: []
    }
  },
  'lifecycle:scheduler:addSchedulerTime': {
    zh: {
      purpose:
        '把已校验的 base 与 delta 相加，并在有限操作数产生 Infinity 时以 RangeError 拒绝，防止 deadline 溢出后静默变成永不超时。',
      quickStart:
        "const delay = validateSchedulerDelay(timeoutMs, 'timeoutMs')\nconst deadlineAt = addSchedulerTime(\n  scheduler.now(),\n  delay,\n  'deadlineAt'\n)",
      scenarios: [
        '由 scheduler.now() 和相对 timeout 构造绝对 deadline。',
        '极大数输入不能静默关闭超时保护。'
      ],
      avoidWhen: ['操作数尚未验证；先调用时间/延迟 validator。', '只需要做普通业务数值加法。'],
      options: []
    },
    en: {
      purpose:
        'Adds validated base and delta and rejects with RangeError if finite operands produce Infinity, preventing deadline overflow from silently becoming no timeout.',
      quickStart:
        "const delay = validateSchedulerDelay(timeoutMs, 'timeoutMs')\nconst deadlineAt = addSchedulerTime(\n  scheduler.now(),\n  delay,\n  'deadlineAt'\n)",
      scenarios: [
        'An absolute deadline is derived from scheduler.now() plus a relative timeout.',
        'Extremely large input must not silently disable timeout protection.'
      ],
      avoidWhen: [
        'Operands are not validated yet; run the time and delay validators first.',
        'Only ordinary domain-number addition is needed.'
      ],
      options: []
    }
  },
  'lifecycle:errors:createLifecycleError': {
    zh: {
      purpose:
        '创建带 @migaia/lifecycle source、稳定 code、原生 stack 和可选 cause/phase/detail/errors 的 Error。它不覆盖 stack，errors 会冻结为快照。',
      quickStart:
        "throw createLifecycleError(\n  LifecycleErrorCode.scopeClosed,\n  LifecycleErrorText.scopeClosed,\n  { phase: 'own', cause: originalError }\n)",
      scenarios: [
        'lifecycle 自身需要创建没有更具体原生子类要求的边界错误。',
        '原始失败、阶段和诊断详情必须沿公开错误链可达。'
      ],
      avoidWhen: [
        '输入错误必须保持 TypeError 或 RangeError；使用对应 factory。',
        '已有 Error 实例需要保持 identity；使用 tagLifecycleError 或 createLifecycleFailure。'
      ],
      options: []
    },
    en: {
      purpose:
        'Creates an Error carrying @migaia/lifecycle source, stable code, native stack, and optional cause, phase, detail, or frozen errors snapshot. It never overwrites stack.',
      quickStart:
        "throw createLifecycleError(\n  LifecycleErrorCode.scopeClosed,\n  LifecycleErrorText.scopeClosed,\n  { phase: 'own', cause: originalError }\n)",
      scenarios: [
        'Lifecycle itself needs a boundary error with no more specific native subclass requirement.',
        'Original failure, phase, and diagnostic detail must remain reachable through the public error chain.'
      ],
      avoidWhen: [
        'Input failure must remain TypeError or RangeError; use the matching factory.',
        'An existing Error instance must retain identity; use tagLifecycleError or createLifecycleFailure.'
      ],
      options: []
    }
  },
  'lifecycle:errors:createLifecycleTypeError': {
    zh: {
      purpose:
        '创建保留原生 TypeError runtime type 的 lifecycle 错误，并附加 source/code、可选 cause 与 detail；适用于输入形状或可调用性错误。',
      quickStart:
        "throw createLifecycleTypeError(\n  LifecycleErrorCode.invalidOption,\n  LifecycleErrorText.schedulerAccessorFailed,\n  { cause: getterError, detail: { field: 'scheduler' } }\n)",
      scenarios: [
        '公开参数类型或对象形状不合法。',
        '调用方依赖 instanceof TypeError，同时还需要稳定 source/code。'
      ],
      avoidWhen: [
        '数值类型正确但范围非法；使用 createLifecycleRangeError。',
        '已有错误需要保持 identity；使用 createLifecycleFailure。'
      ],
      options: []
    },
    en: {
      purpose:
        'Creates a lifecycle error that remains a native TypeError while attaching source, code, and optional cause or detail. Use it for invalid input shape or callability.',
      quickStart:
        "throw createLifecycleTypeError(\n  LifecycleErrorCode.invalidOption,\n  LifecycleErrorText.schedulerAccessorFailed,\n  { cause: getterError, detail: { field: 'scheduler' } }\n)",
      scenarios: [
        'A public parameter type or object shape is invalid.',
        'Callers depend on instanceof TypeError while also requiring stable source and code.'
      ],
      avoidWhen: [
        'The value has the right type but an invalid numeric range; use createLifecycleRangeError.',
        'An existing error must retain identity; use createLifecycleFailure.'
      ],
      options: []
    }
  },
  'lifecycle:errors:createLifecycleRangeError': {
    zh: {
      purpose:
        '创建保留原生 RangeError runtime type 的 lifecycle 错误，并附加 source/code、可选 cause 与 detail；适用于有限性、非负或上限约束。',
      quickStart:
        "throw createLifecycleRangeError(\n  LifecycleErrorCode.invalidOption,\n  LifecycleErrorText.schedulerDelayRange,\n  { detail: { field: 'delayMs' } }\n)",
      scenarios: [
        '数值参数类型正确，但超出 lifecycle 接受范围。',
        '调用方需要通过 instanceof RangeError 区分类型与范围错误。'
      ],
      avoidWhen: [
        '值不是 number；使用 createLifecycleTypeError。',
        '错误不属于输入范围校验；使用更贴合语义的 factory。'
      ],
      options: []
    },
    en: {
      purpose:
        'Creates a lifecycle error that remains a native RangeError while attaching source, code, and optional cause or detail. Use it for finite, non-negative, or upper-bound constraints.',
      quickStart:
        "throw createLifecycleRangeError(\n  LifecycleErrorCode.invalidOption,\n  LifecycleErrorText.schedulerDelayRange,\n  { detail: { field: 'delayMs' } }\n)",
      scenarios: [
        "A numeric parameter has the correct type but lies outside lifecycle's accepted range.",
        'Callers use instanceof RangeError to separate type and range failures.'
      ],
      avoidWhen: [
        'The value is not a number; use createLifecycleTypeError.',
        'The failure is not input-range validation; use a semantically closer factory.'
      ],
      options: []
    }
  },
  'lifecycle:errors:tagLifecycleError': {
    zh: {
      purpose:
        '在已有 Error 上附加 lifecycle source/code，同时保留对象 identity、原生子类、message、stack 与 AggregateError.errors；跨 source 冲突保持 fail-closed。',
      quickStart:
        "const aggregate = new AggregateError(errors, 'dispose failed')\nthrow tagLifecycleError(\n  aggregate,\n  LifecycleErrorCode.disposeFailed\n)",
      scenarios: [
        '现有 AggregateError、DOMException 或其他原生错误类型必须原样保留。',
        '同包错误跨边界需要重新分类 code，但不能替换实例。'
      ],
      avoidWhen: [
        '还没有 Error 实例；使用 createLifecycleError 或原生子类 factory。',
        '任意 unknown throw 可能是 primitive 或冻结对象；使用 createLifecycleFailure。'
      ],
      options: []
    },
    en: {
      purpose:
        'Attaches lifecycle source and code to an existing Error while preserving object identity, native subclass, message, stack, and AggregateError.errors. Cross-source conflicts remain fail-closed.',
      quickStart:
        "const aggregate = new AggregateError(errors, 'dispose failed')\nthrow tagLifecycleError(\n  aggregate,\n  LifecycleErrorCode.disposeFailed\n)",
      scenarios: [
        'An existing AggregateError, DOMException, or other native error subtype must remain intact.',
        'A lifecycle-owned error crosses a boundary and needs code reclassification without instance replacement.'
      ],
      avoidWhen: [
        'No Error exists yet; use createLifecycleError or a native-subclass factory.',
        'An unknown throw may be primitive or frozen; use createLifecycleFailure.'
      ],
      options: []
    }
  },
  'lifecycle:errors:createLifecycleFailure': {
    zh: {
      purpose:
        '把任意 unknown throw 转为 lifecycle 边界失败。可扩展 Error 会原位打标以保持 identity；primitive、冻结或不可打标值会被包装，并通过 cause 保留原值。',
      quickStart:
        'try {\n  await releaseResource()\n} catch (error) {\n  throw createLifecycleFailure(\n    LifecycleErrorCode.disposeFailed,\n    LifecycleErrorText.disposeFailed,\n    error\n  )\n}',
      scenarios: [
        '调用用户 disposer、listener 或宿主能力后捕获到 unknown。',
        '必须同时保证原错误可达与 lifecycle source/code 契约。'
      ],
      avoidWhen: [
        '正在校验调用方输入且需要明确 TypeError/RangeError；使用对应 factory。',
        '确定拥有一个可扩展 Error 且只需打标；直接 tagLifecycleError。'
      ],
      options: []
    },
    en: {
      purpose:
        'Converts any unknown throw into a lifecycle-boundary failure. Extensible Errors are tagged in place to retain identity; primitive, frozen, or untaggable values are wrapped with the original retained through cause.',
      quickStart:
        'try {\n  await releaseResource()\n} catch (error) {\n  throw createLifecycleFailure(\n    LifecycleErrorCode.disposeFailed,\n    LifecycleErrorText.disposeFailed,\n    error\n  )\n}',
      scenarios: [
        'Calling a user disposer, listener, or host capability produces an unknown throw.',
        'Both original-error reachability and lifecycle source/code contract must be guaranteed.'
      ],
      avoidWhen: [
        'Caller input is being validated and needs an explicit TypeError or RangeError; use the matching factory.',
        'A known extensible Error only needs tagging; call tagLifecycleError directly.'
      ],
      options: []
    }
  },
  'reactive:reactive:Signal': {
    zh: {
      purpose:
        '表示一份可写的响应式状态。读取 value 会建立依赖，赋值会通知同一 Runtime 中真正受影响的派生值与副作用；peek() 则只读取当前值，不建立依赖。',
      quickStart:
        "const runtime = createRuntime()\nconst count = runtime.signal(0, { debugName: 'cart.count' })\n\nconst stop = runtime.effect(() => {\n  console.log(`count: ${count.value}`)\n})\n\ncount.value += 1\nstop()\ncount.dispose()",
      scenarios: [
        '保存会被命令式更新、同时需要驱动派生值或副作用的最小状态。',
        '组件、缓存单元或领域对象需要一个可显式释放、归属于特定 Runtime 的状态节点。'
      ],
      avoidWhen: [
        '值完全可以由其他 Signal 计算得到；使用 Computed，避免维护重复状态。',
        '只需要读取一次且不希望建立依赖；读取 signal.peek()，不要读取 value。'
      ],
      options: [
        {
          name: 'debugName',
          description:
            '为节点提供稳定的人类可读名称，供 trace、错误上下文和开发工具识别；不参与依赖计算。',
          defaultValue: 'undefined',
          whenToUse: '需要区分多个同类型状态节点，或需要定位生产 trace 时设置。',
          example: "runtime.signal(0, { debugName: 'cart.itemCount' })"
        }
      ]
    },
    en: {
      purpose:
        'Represents writable reactive state. Reading value records a dependency, assigning a new value notifies affected derivations and effects in the same Runtime, and peek() reads without tracking.',
      quickStart:
        "const runtime = createRuntime()\nconst count = runtime.signal(0, { debugName: 'cart.count' })\n\nconst stop = runtime.effect(() => {\n  console.log(`count: ${count.value}`)\n})\n\ncount.value += 1\nstop()\ncount.dispose()",
      scenarios: [
        'A small writable state value must drive derived values or side effects.',
        'A component, cache cell, or domain object needs an explicitly disposable state node owned by one Runtime.'
      ],
      avoidWhen: [
        'The value can be derived completely from other signals; use Computed instead of maintaining duplicate state.',
        'A one-time read must not create a dependency; read signal.peek() instead of value.'
      ],
      options: [
        {
          name: 'debugName',
          description:
            'Assigns a stable human-readable node name for traces, error context, and developer tooling; it does not affect dependency semantics.',
          defaultValue: 'undefined',
          whenToUse:
            'Set it when several similar nodes must be distinguished or production traces need a meaningful identity.',
          example: "runtime.signal(0, { debugName: 'cart.itemCount' })"
        }
      ]
    }
  },
  'reactive:reactive:Computed': {
    zh: {
      purpose:
        '声明一个只读派生值。Computed 会自动追踪求值期间读取的节点，按需计算并缓存结果；依赖变化只会将它标脏，下一次读取时才重新求值。',
      quickStart:
        "const runtime = createRuntime()\nconst price = runtime.signal(12)\nconst quantity = runtime.signal(2)\nconst total = runtime.computed(() => price.value * quantity.value, {\n  debugName: 'cart.total'\n})\n\nconsole.log(total.value) // 24\nquantity.value = 3\nconsole.log(total.value) // 36",
      scenarios: [
        '从一个或多个响应式节点推导可缓存的只读结果。',
        '派生计算较贵，希望没有读取者时不执行、依赖未变化时复用缓存。'
      ],
      avoidWhen: [
        '操作需要写入外部系统、DOM 或日志；使用 Effect 承担副作用。',
        '结果必须由调用方直接赋值；使用 Signal 作为事实来源。'
      ],
      options: [
        {
          name: 'equals',
          description: '比较新旧结果是否等价；返回 true 时保留已有值身份并避免无意义的下游更新。',
          defaultValue: 'Object.is',
          whenToUse: '派生结果会创建新对象，但领域上相等的结果不应触发下游时设置。',
          example: 'runtime.computed(selectUser, { equals: (a, b) => a.id === b.id })'
        },
        {
          name: 'keepAlive',
          description:
            '在最后一个观察者离开后仍保留依赖连接与缓存；false 时允许 Runtime 在空闲阶段挂起未观察的 Computed。',
          defaultValue: 'false',
          whenToUse: '重新订阅很频繁，且重新建立昂贵依赖的成本高于持续保持连接的成本时启用。',
          example: 'runtime.computed(buildIndex, { keepAlive: true })'
        },
        {
          name: 'debugName',
          description: '为派生节点提供 trace 和开发工具使用的稳定名称，不改变缓存或比较行为。',
          defaultValue: 'undefined',
          whenToUse: '需要在依赖图或错误报告中识别该派生值时设置。',
          example: "runtime.computed(calculateTotal, { debugName: 'cart.total' })"
        }
      ]
    },
    en: {
      purpose:
        'Declares a read-only derived value. Computed tracks nodes read during evaluation, calculates lazily, and caches the result; dependency changes mark it dirty and the next read recomputes it.',
      quickStart:
        "const runtime = createRuntime()\nconst price = runtime.signal(12)\nconst quantity = runtime.signal(2)\nconst total = runtime.computed(() => price.value * quantity.value, {\n  debugName: 'cart.total'\n})\n\nconsole.log(total.value) // 24\nquantity.value = 3\nconsole.log(total.value) // 36",
      scenarios: [
        'A read-only result is derived from one or more reactive nodes.',
        'An expensive derivation should stay lazy and reuse its cache while dependencies are unchanged.'
      ],
      avoidWhen: [
        'The operation writes to an external system, DOM, or logger; use Effect for that side effect.',
        'Callers must assign the result directly; make the source of truth a Signal.'
      ],
      options: [
        {
          name: 'equals',
          description:
            'Compares the previous and next result. Returning true preserves the existing identity and suppresses meaningless downstream updates.',
          defaultValue: 'Object.is',
          whenToUse:
            'Set it when a derivation creates new objects but domain-equivalent results should not invalidate consumers.',
          example: 'runtime.computed(selectUser, { equals: (a, b) => a.id === b.id })'
        },
        {
          name: 'keepAlive',
          description:
            'Keeps dependencies and cache connected after the last observer leaves. When false, the Runtime may suspend an unobserved Computed during idle cleanup.',
          defaultValue: 'false',
          whenToUse:
            'Enable it when resubscription is frequent and rebuilding expensive dependencies costs more than retaining them.',
          example: 'runtime.computed(buildIndex, { keepAlive: true })'
        },
        {
          name: 'debugName',
          description:
            'Assigns a stable name used by traces and developer tooling without changing caching or equality.',
          defaultValue: 'undefined',
          whenToUse:
            'Set it when this derivation must be identifiable in a dependency graph or error report.',
          example: "runtime.computed(calculateTotal, { debugName: 'cart.total' })"
        }
      ]
    }
  },
  'reactive:reactive:Effect': {
    zh: {
      purpose:
        '把响应式状态同步到外部世界。Effect 创建时立即执行，自动订阅本次执行读取的节点；重跑前先执行上一次返回的 cleanup，dispose() 后不再执行。',
      quickStart:
        "const runtime = createRuntime()\nconst roomId = runtime.signal('general')\n\nconst stop = runtime.effect(() => {\n  const connection = connect(roomId.value)\n  return () => connection.close()\n}, { debugName: 'chat.connection' })\n\nroomId.value = 'support'\nstop()",
      scenarios: [
        '根据响应式状态订阅外部资源，并在依赖变化时可靠地撤销旧资源。',
        '需要把状态同步到 DOM、日志、网络连接或其他命令式系统。'
      ],
      avoidWhen: [
        '只是计算另一个值；使用 Computed，避免把派生状态写回 Signal。',
        '回调或 cleanup 需要异步返回 Promise；Effect 契约是同步的，应在回调内显式启动并自行管理异步任务。'
      ],
      options: [
        {
          name: 'debugName',
          description: '为副作用提供 trace、错误上下文与开发工具使用的名称，不改变调度顺序。',
          defaultValue: 'undefined',
          whenToUse: '生产诊断需要知道哪一个 effect 执行或失败时设置。',
          example: "runtime.effect(syncSession, { debugName: 'session.sync' })"
        }
      ]
    },
    en: {
      purpose:
        'Synchronizes reactive state with the outside world. An Effect runs immediately, subscribes to nodes read during that run, executes the previous cleanup before rerunning, and stops permanently after disposal.',
      quickStart:
        "const runtime = createRuntime()\nconst roomId = runtime.signal('general')\n\nconst stop = runtime.effect(() => {\n  const connection = connect(roomId.value)\n  return () => connection.close()\n}, { debugName: 'chat.connection' })\n\nroomId.value = 'support'\nstop()",
      scenarios: [
        'An external resource must follow reactive state and its previous instance must be released when dependencies change.',
        'State must be synchronized with the DOM, logging, a connection, or another imperative system.'
      ],
      avoidWhen: [
        'Only another value is being calculated; use Computed instead of writing derived state back into a Signal.',
        'The body or cleanup needs to return a Promise. Effect is synchronous; start and own asynchronous work explicitly inside it.'
      ],
      options: [
        {
          name: 'debugName',
          description:
            'Names the effect for traces, error context, and developer tooling without changing scheduling order.',
          defaultValue: 'undefined',
          whenToUse: 'Set it when production diagnostics must identify which effect ran or failed.',
          example: "runtime.effect(syncSession, { debugName: 'session.sync' })"
        }
      ]
    }
  },
  'reactive:runtime:createRuntime': {
    zh: {
      purpose:
        '创建一张独立的响应式图以及它自己的版本时钟、依赖追踪器和调度队列。SSR 请求、测试、Worker 或相互隔离的应用根应各自拥有 Runtime。',
      quickStart:
        'const runtime = createRuntime({\n  maxFlushPasses: 100,\n  onError(error, context) {\n    reportReactiveFailure(error, context)\n  }\n})\n\nconst count = runtime.signal(0)\nconst doubled = runtime.computed(() => count.value * 2)',
      scenarios: [
        'SSR、测试或多应用根必须隔离依赖图、调度与错误通道。',
        '宿主需要注入微任务、时钟、trace 或错误报告能力。'
      ],
      avoidWhen: [
        '简单客户端模块明确接受进程级共享状态；可使用 defaultRuntime 的便捷 API。',
        '调用方准备手写一个结构相似的 Runtime；该能力不能结构伪造，应由工厂创建。'
      ],
      options: reactiveRuntimeOptions.zh
    },
    en: {
      purpose:
        'Creates an isolated reactive graph with its own version clock, dependency tracker, and scheduling queue. SSR requests, tests, Workers, and isolated application roots should own separate runtimes.',
      quickStart:
        'const runtime = createRuntime({\n  maxFlushPasses: 100,\n  onError(error, context) {\n    reportReactiveFailure(error, context)\n  }\n})\n\nconst count = runtime.signal(0)\nconst doubled = runtime.computed(() => count.value * 2)',
      scenarios: [
        'SSR, tests, or multiple application roots must isolate graphs, scheduling, and error channels.',
        'A host needs to inject microtasks, clocks, tracing, or error reporting.'
      ],
      avoidWhen: [
        'A simple client module deliberately accepts process-global shared state; defaultRuntime convenience APIs may be enough.',
        'A caller intends to imitate Runtime structurally; this capability is factory-created and cannot be forged safely.'
      ],
      options: reactiveRuntimeOptions.en
    }
  },
  'reactive:runtime:Runtime': {
    zh: {
      purpose:
        'Runtime 是 Signal、Computed 与 Effect 的所有权和执行边界。通常通过 createRuntime() 获得实例；其方法确保所有节点加入同一张图，并提供 batch、untracked、flush 与诊断能力。',
      quickStart:
        "const runtime = createRuntime()\nconst first = runtime.signal('Ada')\nconst last = runtime.signal('Lovelace')\nconst fullName = runtime.computed(() => `${first.value} ${last.value}`)\n\nruntime.batch(() => {\n  first.value = 'Grace'\n  last.value = 'Hopper'\n})\nconsole.log(fullName.value)",
      scenarios: [
        '需要明确拥有并组合一组响应式节点。',
        '需要批量更新、非追踪读取、显式冲刷或只读 trace 订阅。'
      ],
      avoidWhen: [
        '只需要创建实例；优先调用 createRuntime()，让工厂完成品牌登记。',
        '需要跨 Runtime 连接节点；不同 Runtime 的图刻意隔离。'
      ],
      options: reactiveRuntimeOptions.zh
    },
    en: {
      purpose:
        'Runtime is the ownership and execution boundary for Signal, Computed, and Effect. Obtain it through createRuntime() in normal use; its methods keep nodes in one graph and expose batching, untracked reads, flushing, and diagnostics.',
      quickStart:
        "const runtime = createRuntime()\nconst first = runtime.signal('Ada')\nconst last = runtime.signal('Lovelace')\nconst fullName = runtime.computed(() => `${first.value} ${last.value}`)\n\nruntime.batch(() => {\n  first.value = 'Grace'\n  last.value = 'Hopper'\n})\nconsole.log(fullName.value)",
      scenarios: [
        'A group of reactive nodes needs explicit ownership and composition.',
        'Batching, untracked reads, explicit flushing, or read-only trace subscriptions are required.'
      ],
      avoidWhen: [
        'Only instance creation is required; prefer createRuntime() so the factory registers its brand.',
        'Nodes must connect across runtimes; separate Runtime graphs are intentionally isolated.'
      ],
      options: reactiveRuntimeOptions.en
    }
  },
  'reactive:index:defaultRuntime': {
    zh: {
      purpose:
        '提供进程级共享的默认 Runtime，供 signal()、computed() 与 effect() 便捷函数使用。它降低简单客户端模块的启动成本，但其状态、队列和诊断通道会被同一进程中的所有使用者共享。',
      quickStart:
        'const count = signal(0)\nconst doubled = computed(() => count.value * 2)\nconst stop = effect(() => console.log(doubled.value))\n\ncount.value = 1\nstop()',
      scenarios: [
        '单一客户端应用根接受全局共享的响应式图。',
        '小型模块需要最少样板代码，且不存在请求级或测试级隔离要求。'
      ],
      avoidWhen: [
        'SSR 请求、测试用例、Worker 或多个应用根必须互相隔离；使用 createRuntime()。',
        '宿主需要自定义 adapter、错误通道或 trace；创建专用 Runtime。'
      ],
      options: []
    },
    en: {
      purpose:
        'Provides the process-wide default Runtime used by the signal(), computed(), and effect() convenience functions. It minimizes setup for simple clients but shares graph state, queues, and diagnostics across all users in the process.',
      quickStart:
        'const count = signal(0)\nconst doubled = computed(() => count.value * 2)\nconst stop = effect(() => console.log(doubled.value))\n\ncount.value = 1\nstop()',
      scenarios: [
        'One client application root deliberately shares a global reactive graph.',
        'A small module needs minimal setup and has no request-level or test-level isolation requirement.'
      ],
      avoidWhen: [
        'SSR requests, tests, Workers, or multiple application roots must be isolated; use createRuntime().',
        'The host needs a custom adapter, error channel, or trace sink; create a dedicated Runtime.'
      ],
      options: []
    }
  }
}

/** Returns curated reading content without falling back across locales. */
export function findApiGuide(
  library: string,
  moduleName: string,
  symbolName: string,
  locale: IGuideLocale
): IApiGuide | undefined {
  return apiGuides[`${library}:${moduleName}:${symbolName}`]?.[locale]
}

/** Builds a reference guide for non-callable public constants from their actual contract shape. */
export function createSupportingContractGuide(
  library: string,
  symbol: IApiSymbol,
  locale: IGuideLocale
): IApiGuide | undefined {
  if (symbol.kind !== 'const' || isCallableApiSymbol(symbol)) return undefined
  const member =
    symbol.signature.match(/readonly\s+([A-Za-z_$][\w$]*)\s*:/u)?.[1] ?? undefined
  const importPath = `@migaia/${library}${symbol.exportPath === '.' ? '' : symbol.exportPath.slice(1)}`
  const isSource = symbol.name.endsWith('_SOURCE')
  const isErrorCode = symbol.name.endsWith('ErrorCode')
  const isErrorText = symbol.name.endsWith('ErrorText')
  const isPluginName = symbol.name.endsWith('_PLUGIN_NAME')
  const isDisposalKey = symbol.name === 'disposeKey' || symbol.name === 'asyncDisposeKey'
  const isSentinel =
    symbol.name.startsWith('GENERATOR_') ||
    symbol.name.endsWith('_BRAND') ||
    symbol.name === 'FIELD_BUILDER'
  const purpose = locale === 'zh'
    ? isSource
      ? `${symbol.name} 是 ${library} 错误的稳定来源标识。捕获 unknown 错误时先比较 source，再读取 code；不要通过 message 文本猜测错误属于哪个库。`
      : isErrorCode
        ? `${symbol.name} 集中定义 ${library} 可公开处理的稳定错误码。调用方用这些成员比较 error.code，避免散写字符串或解析可能变化的 message。`
        : isErrorText
          ? `${symbol.name} 集中维护 ${library} 的公开诊断文本与文本工厂。错误创建代码引用这里的成员，确保同一语义不会在多个调用点产生不同文案。`
          : isPluginName
            ? `${symbol.name} 是插件注册、查找与诊断共同使用的稳定插件名。插件实现和 Host 使用同一常量，避免名称拼写不一致导致插件无法匹配。`
            : isDisposalKey
              ? `${symbol.name} 是 Plugin Host 识别资源清理方法的规范 symbol。资源可以用该 symbol 暴露清理函数，而不必依赖容易冲突的普通字符串属性。`
              : isSentinel
                ? `${symbol.name} 是跨模块传递控制语义的唯一协议标记。只比较或返回这个导出值，不要复制、伪造或把它当作业务数据。`
                : `${symbol.name} 集中定义 ${library} 的稳定状态、模式或策略值。使用命名成员进行配置与分支，可让编辑器检查合法值，并避免散写协议字符串。`
    : isSource
      ? `${symbol.name} is the stable source marker for ${library} errors. Compare source before reading code instead of guessing library ownership from message text.`
      : isErrorCode
        ? `${symbol.name} contains the stable public failure codes owned by ${library}. Compare error.code with these members instead of repeating strings or parsing messages.`
        : isErrorText
          ? `${symbol.name} owns the public diagnostic messages and message factories for ${library}, keeping one semantic failure consistent across every throw site.`
          : isPluginName
            ? `${symbol.name} is the stable plugin name shared by registration, lookup, and diagnostics so the plugin and Host cannot disagree through spelling.`
            : isDisposalKey
              ? `${symbol.name} is the canonical symbol used by Plugin Host to discover a resource cleanup method without relying on a collision-prone string property.`
              : isSentinel
                ? `${symbol.name} is the unique protocol marker for a cross-module control meaning. Compare or return the exported identity; never copy or forge it as application data.`
                : `${symbol.name} contains the stable ${library} state, mode, or policy values. Named members make invalid values visible to tooling and avoid repeated protocol strings.`
  const quickStart = isSource
    ? `import { ${symbol.name} } from '${importPath}'\n\nfunction isLibraryError(error: unknown): boolean {\n  return Boolean(\n    error &&\n    typeof error === 'object' &&\n    'source' in error &&\n    error.source === ${symbol.name}\n  )\n}`
    : isErrorCode
      ? `import { ${symbol.name} } from '${importPath}'\n\nfunction isKnownFailure(error: unknown): boolean {\n  return Boolean(\n    error &&\n    typeof error === 'object' &&\n    'code' in error &&\n    error.code === ${symbol.name}.${member ?? 'invalidOption'}\n  )\n}`
      : isPluginName
        ? `import { ${symbol.name} } from '${importPath}'\n\nconsole.log('registering plugin', ${symbol.name})`
        : isDisposalKey
          ? `import { ${symbol.name} } from '${importPath}'\n\nconst resource = {\n  [${symbol.name}]() {\n    console.log('resource released')\n  }\n}`
          : isSentinel
            ? `import { ${symbol.name} } from '${importPath}'\n\nconst result: unknown = ${symbol.name}\nconsole.log(result === ${symbol.name})`
            : `import { ${symbol.name} } from '${importPath}'\n\nconst value = ${symbol.name}.${member ?? 'value'}\nconsole.log(value)`
  return {
    purpose,
    quickStart,
    scenarios:
      locale === 'zh'
        ? [
            '配置、运行结果、诊断或跨模块数据需要使用该库定义的规范值。',
            '代码需要通过命名成员获得自动补全，并让未知值在类型检查或边界校验时暴露。'
          ]
        : [
            'Configuration, results, diagnostics, or cross-module data must use the canonical value owned by this library.',
            'Named members should provide completion and expose unknown values during type checking or boundary validation.'
          ],
    avoidWhen:
      locale === 'zh'
        ? [
            '不要把常量对象当作可调用 API，也不要在运行时修改它。',
            '不要复制成员字符串、symbol 或诊断文本到新的本地常量；直接引用规范导出。'
          ]
        : [
            'Do not treat the constant object as a callable API or mutate it at runtime.',
            'Do not copy member strings, symbols, or diagnostics into another local constant; reference the canonical export.'
          ],
    options: []
  }
}

/** Resolves an exact or library-wide localized option description. */
export function findOptionTranslation(
  library: string,
  moduleName: string,
  symbolName: string,
  fieldName: string,
  locale: IGuideLocale
): string | undefined {
  const pathParts = fieldName.split('.')
  const suffixes = pathParts.map((_, index) => pathParts.slice(index).join('.'))
  return (
    optionTranslations[`${library}:${moduleName}:${symbolName}:${fieldName}`]?.[locale] ??
    suffixes
      .map((suffix) => optionTranslations[`${library}:*:*:${suffix}`]?.[locale])
      .find((description) => description !== undefined)
  )
}
