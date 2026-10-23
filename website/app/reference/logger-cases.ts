import type { ICaseDoc, IText } from './contract.js'

/** Localized task explanation for the public logger entries. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Complete examples use in-memory sinks and the public host capability port. */
export const loggerCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  memoryLogStore: [
    {
      title: t(
        'Keep ordered records and explicit resource ownership',
        '保留有序记录与明确资源归属'
      ),
      problem: t(
        'Use durable log resources without changing ordinary output sinks. Each installed plugin borrows a distinct store; the creator closes it after accepted work ends.',
        '使用持久日志资源而不改变普通输出端。每个插件借用独立 store；已接纳工作结束后由创建者关闭。'
      ),
      example: t(
        "import { memoryLogStore } from '@migaia/logger/plugins/durable'\nimport type { ILogStore } from '@migaia/logger/plugins/durable'\n\nconst delegate = memoryLogStore()\n// A custom implementation must preserve this single owner's atomic commit and notices.\nconst custom: ILogStore = {\n  append: records => delegate.append(records),\n  read: (fromSeq, limit) => delegate.read(fromSeq, limit),\n  lastSeq: () => delegate.lastSeq(),\n  onAppend: listener => delegate.onAppend(listener),\n  truncate: beforeSeq => delegate.truncate(beforeSeq),\n  setState: (seq, state) => delegate.setState(seq, state),\n  states: filter => delegate.states(filter),\n  dispose: () => delegate.dispose(),\n  [Symbol.asyncDispose]: () => delegate[Symbol.asyncDispose]()\n}\nawait custom.append([{ kind: 'custom', payload: null }])\nawait custom.dispose()",
        "import { memoryLogStore } from '@migaia/logger/plugins/durable'\nimport type { ILogStore } from '@migaia/logger/plugins/durable'\n\nconst delegate = memoryLogStore()\n// A custom implementation must preserve this single owner's atomic commit and notices.\nconst custom: ILogStore = {\n  append: records => delegate.append(records),\n  read: (fromSeq, limit) => delegate.read(fromSeq, limit),\n  lastSeq: () => delegate.lastSeq(),\n  onAppend: listener => delegate.onAppend(listener),\n  truncate: beforeSeq => delegate.truncate(beforeSeq),\n  setState: (seq, state) => delegate.setState(seq, state),\n  states: filter => delegate.states(filter),\n  dispose: () => delegate.dispose(),\n  [Symbol.asyncDispose]: () => delegate[Symbol.asyncDispose]()\n}\nawait custom.append([{ kind: 'custom', payload: null }])\nawait custom.dispose()"
      ),
      result: t(
        'Records retain their JSON values. Initialization and whenIdle are explicit; shutdown completion alone does not prove all I/O ended. File stores use actual builtin SQLite, and external native transaction atomicity belongs to its original owner.',
        '记录保留 JSON 原值。初始化与 whenIdle 明确等待；仅 shutdown 返回不能证明全部 I/O 结束。文件资源使用实际内置 SQLite，外部原生事务原子性属于原拥有者。'
      )
    }
  ],
  fileLogStore: [
    {
      title: t(
        'Keep ordered records and explicit resource ownership',
        '保留有序记录与明确资源归属'
      ),
      problem: t(
        'Use durable log resources without changing ordinary output sinks. Each installed plugin borrows a distinct store; the creator closes it after accepted work ends.',
        '使用持久日志资源而不改变普通输出端。每个插件借用独立 store；已接纳工作结束后由创建者关闭。'
      ),
      example: t(
        "import { fileLogStore } from '@migaia/logger/plugins/durable/file'\n\nawait using store = await fileLogStore('./orders.sqlite')\nawait store.append([{ kind: 'order.created', payload: { id: 'o1' } }])\nconsole.log(await store.lastSeq())",
        "import { fileLogStore } from '@migaia/logger/plugins/durable/file'\n\nawait using store = await fileLogStore('./orders.sqlite')\nawait store.append([{ kind: 'order.created', payload: { id: 'o1' } }])\nconsole.log(await store.lastSeq())"
      ),
      result: t(
        'Records retain their JSON values. Initialization and whenIdle are explicit; shutdown completion alone does not prove all I/O ended. File stores use actual builtin SQLite, and external native transaction atomicity belongs to its original owner.',
        '记录保留 JSON 原值。初始化与 whenIdle 明确等待；仅 shutdown 返回不能证明全部 I/O 结束。文件资源使用实际内置 SQLite，外部原生事务原子性属于原拥有者。'
      )
    }
  ],
  binlog: [
    {
      title: t(
        'Keep ordered records and explicit resource ownership',
        '保留有序记录与明确资源归属'
      ),
      problem: t(
        'Use durable log resources without changing ordinary output sinks. Each installed plugin borrows a distinct store; the creator closes it after accepted work ends.',
        '使用持久日志资源而不改变普通输出端。每个插件借用独立 store；已接纳工作结束后由创建者关闭。'
      ),
      example: t(
        "import { Logger } from '@migaia/logger'\nimport { binlog, wal, undoLog, memoryLogStore } from '@migaia/logger/plugins/durable'\n\nawait using events = memoryLogStore()\nawait using intents = memoryLogStore()\nawait using images = memoryLogStore()\nconst log = new Logger({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  plugins: [binlog({ store: events }), wal({ store: intents }), undoLog({ store: images })]\n})\ntry {\n  await Promise.all([log.binlog.ready(), log.wal.ready(), log.undo.ready()])\n  const seq = await log.binlog.append('order.created', { id: 'o1' })\n  const off = log.binlog.subscribe(seq, record => console.log(record.seq))\n  const intent = await log.wal.begin('save-order', { id: 'o1' })\n  await log.undo.record('tx1', [{ target: 'o1', before: null, after: { total: 120 } }])\n  await log.wal.complete(intent)\n  console.log(await log.undo.get('tx1'))\n  await log.undo.forget('tx1')\n  off()\n} finally {\n  try { await log.shutdown('manual') }\n  finally { await Promise.all([log.binlog.whenIdle(), log.wal.whenIdle(), log.undo.whenIdle()]) }\n}",
        "import { Logger } from '@migaia/logger'\nimport { binlog, wal, undoLog, memoryLogStore } from '@migaia/logger/plugins/durable'\n\nawait using events = memoryLogStore()\nawait using intents = memoryLogStore()\nawait using images = memoryLogStore()\nconst log = new Logger({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  plugins: [binlog({ store: events }), wal({ store: intents }), undoLog({ store: images })]\n})\ntry {\n  await Promise.all([log.binlog.ready(), log.wal.ready(), log.undo.ready()])\n  const seq = await log.binlog.append('order.created', { id: 'o1' })\n  const off = log.binlog.subscribe(seq, record => console.log(record.seq))\n  const intent = await log.wal.begin('save-order', { id: 'o1' })\n  await log.undo.record('tx1', [{ target: 'o1', before: null, after: { total: 120 } }])\n  await log.wal.complete(intent)\n  console.log(await log.undo.get('tx1'))\n  await log.undo.forget('tx1')\n  off()\n} finally {\n  try { await log.shutdown('manual') }\n  finally { await Promise.all([log.binlog.whenIdle(), log.wal.whenIdle(), log.undo.whenIdle()]) }\n}"
      ),
      result: t(
        'Records retain their JSON values. Initialization and whenIdle are explicit; shutdown completion alone does not prove all I/O ended. File stores use actual builtin SQLite, and external native transaction atomicity belongs to its original owner.',
        '记录保留 JSON 原值。初始化与 whenIdle 明确等待；仅 shutdown 返回不能证明全部 I/O 结束。文件资源使用实际内置 SQLite，外部原生事务原子性属于原拥有者。'
      )
    }
  ],
  wal: [
    {
      title: t(
        'Keep ordered records and explicit resource ownership',
        '保留有序记录与明确资源归属'
      ),
      problem: t(
        'Use durable log resources without changing ordinary output sinks. Each installed plugin borrows a distinct store; the creator closes it after accepted work ends.',
        '使用持久日志资源而不改变普通输出端。每个插件借用独立 store；已接纳工作结束后由创建者关闭。'
      ),
      example: t(
        "import { Logger } from '@migaia/logger'\nimport { binlog, wal, undoLog, memoryLogStore } from '@migaia/logger/plugins/durable'\n\nawait using events = memoryLogStore()\nawait using intents = memoryLogStore()\nawait using images = memoryLogStore()\nconst log = new Logger({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  plugins: [binlog({ store: events }), wal({ store: intents }), undoLog({ store: images })]\n})\ntry {\n  await Promise.all([log.binlog.ready(), log.wal.ready(), log.undo.ready()])\n  const seq = await log.binlog.append('order.created', { id: 'o1' })\n  const off = log.binlog.subscribe(seq, record => console.log(record.seq))\n  const intent = await log.wal.begin('save-order', { id: 'o1' })\n  await log.undo.record('tx1', [{ target: 'o1', before: null, after: { total: 120 } }])\n  await log.wal.complete(intent)\n  console.log(await log.undo.get('tx1'))\n  await log.undo.forget('tx1')\n  off()\n} finally {\n  try { await log.shutdown('manual') }\n  finally { await Promise.all([log.binlog.whenIdle(), log.wal.whenIdle(), log.undo.whenIdle()]) }\n}",
        "import { Logger } from '@migaia/logger'\nimport { binlog, wal, undoLog, memoryLogStore } from '@migaia/logger/plugins/durable'\n\nawait using events = memoryLogStore()\nawait using intents = memoryLogStore()\nawait using images = memoryLogStore()\nconst log = new Logger({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  plugins: [binlog({ store: events }), wal({ store: intents }), undoLog({ store: images })]\n})\ntry {\n  await Promise.all([log.binlog.ready(), log.wal.ready(), log.undo.ready()])\n  const seq = await log.binlog.append('order.created', { id: 'o1' })\n  const off = log.binlog.subscribe(seq, record => console.log(record.seq))\n  const intent = await log.wal.begin('save-order', { id: 'o1' })\n  await log.undo.record('tx1', [{ target: 'o1', before: null, after: { total: 120 } }])\n  await log.wal.complete(intent)\n  console.log(await log.undo.get('tx1'))\n  await log.undo.forget('tx1')\n  off()\n} finally {\n  try { await log.shutdown('manual') }\n  finally { await Promise.all([log.binlog.whenIdle(), log.wal.whenIdle(), log.undo.whenIdle()]) }\n}"
      ),
      result: t(
        'Records retain their JSON values. Initialization and whenIdle are explicit; shutdown completion alone does not prove all I/O ended. File stores use actual builtin SQLite, and external native transaction atomicity belongs to its original owner.',
        '记录保留 JSON 原值。初始化与 whenIdle 明确等待；仅 shutdown 返回不能证明全部 I/O 结束。文件资源使用实际内置 SQLite，外部原生事务原子性属于原拥有者。'
      )
    }
  ],
  undoLog: [
    {
      title: t(
        'Keep ordered records and explicit resource ownership',
        '保留有序记录与明确资源归属'
      ),
      problem: t(
        'Use durable log resources without changing ordinary output sinks. Each installed plugin borrows a distinct store; the creator closes it after accepted work ends.',
        '使用持久日志资源而不改变普通输出端。每个插件借用独立 store；已接纳工作结束后由创建者关闭。'
      ),
      example: t(
        "import { Logger } from '@migaia/logger'\nimport { binlog, wal, undoLog, memoryLogStore } from '@migaia/logger/plugins/durable'\n\nawait using events = memoryLogStore()\nawait using intents = memoryLogStore()\nawait using images = memoryLogStore()\nconst log = new Logger({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  plugins: [binlog({ store: events }), wal({ store: intents }), undoLog({ store: images })]\n})\ntry {\n  await Promise.all([log.binlog.ready(), log.wal.ready(), log.undo.ready()])\n  const seq = await log.binlog.append('order.created', { id: 'o1' })\n  const off = log.binlog.subscribe(seq, record => console.log(record.seq))\n  const intent = await log.wal.begin('save-order', { id: 'o1' })\n  await log.undo.record('tx1', [{ target: 'o1', before: null, after: { total: 120 } }])\n  await log.wal.complete(intent)\n  console.log(await log.undo.get('tx1'))\n  await log.undo.forget('tx1')\n  off()\n} finally {\n  try { await log.shutdown('manual') }\n  finally { await Promise.all([log.binlog.whenIdle(), log.wal.whenIdle(), log.undo.whenIdle()]) }\n}",
        "import { Logger } from '@migaia/logger'\nimport { binlog, wal, undoLog, memoryLogStore } from '@migaia/logger/plugins/durable'\n\nawait using events = memoryLogStore()\nawait using intents = memoryLogStore()\nawait using images = memoryLogStore()\nconst log = new Logger({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  plugins: [binlog({ store: events }), wal({ store: intents }), undoLog({ store: images })]\n})\ntry {\n  await Promise.all([log.binlog.ready(), log.wal.ready(), log.undo.ready()])\n  const seq = await log.binlog.append('order.created', { id: 'o1' })\n  const off = log.binlog.subscribe(seq, record => console.log(record.seq))\n  const intent = await log.wal.begin('save-order', { id: 'o1' })\n  await log.undo.record('tx1', [{ target: 'o1', before: null, after: { total: 120 } }])\n  await log.wal.complete(intent)\n  console.log(await log.undo.get('tx1'))\n  await log.undo.forget('tx1')\n  off()\n} finally {\n  try { await log.shutdown('manual') }\n  finally { await Promise.all([log.binlog.whenIdle(), log.wal.whenIdle(), log.undo.whenIdle()]) }\n}"
      ),
      result: t(
        'Records retain their JSON values. Initialization and whenIdle are explicit; shutdown completion alone does not prove all I/O ended. File stores use actual builtin SQLite, and external native transaction atomicity belongs to its original owner.',
        '记录保留 JSON 原值。初始化与 whenIdle 明确等待；仅 shutdown 返回不能证明全部 I/O 结束。文件资源使用实际内置 SQLite，外部原生事务原子性属于原拥有者。'
      )
    }
  ],
  Logger: [
    {
      title: t(
        'Collect structured request details without a console formatter',
        '收集请求字段，不依赖控制台格式'
      ),
      problem: t(
        'An audit event needs a request path and an order id that a downstream collector can read as fields. Printing an object beside a message leaves every collector to interpret its shape.\n\nA trailing object passed to log() remains an argument, not metadata. A hand-written console wrapper can also mix formatting with delivery and hide which component owns completion.\n\nConstruct Logger with explicit execution budgets, register a sink, and pass named fields through dispatchRaw. context supplies the default entry path; shutdown waits for the logger cleanup boundary.',
        '审计事件需要请求路径和订单标识，供后续收集器按字段读取；把对象打印在消息旁边，会让各收集器自行猜测含义。\n\n传给 `log()` 的末尾对象仍是普通参数，不会自动成为元数据；手写控制台包装也容易把排版与交付混在一起，难以确定由谁负责完成输出。\n\n构造 `Logger` 时明确执行预算，登记输出端，再用 `dispatchRaw` 传入命名字段；`context` 提供条目的默认路径，结束时等待 `shutdown` 完成清理。'
      ),
      example: t(
        "import { Logger } from '@migaia/logger'\n\nconst log = new Logger({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  context: ['checkout']\n})\nlog.useSink((entry) => {\n  console.log(entry.context.join('.'), entry.message, entry.meta?.orderId)\n})\nlog.dispatchRaw({ tag: 'audit', message: 'order saved', meta: { orderId: 'A-17' } })\nawait log.shutdown('manual')",
        "import { Logger } from '@migaia/logger'\n\nconst log = new Logger({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  context: ['checkout']\n})\nlog.useSink((entry) => {\n  console.log(entry.context.join('.'), entry.message, entry.meta?.orderId)\n})\nlog.dispatchRaw({ tag: 'audit', message: '订单已保存', meta: { orderId: 'A-17' } })\nawait log.shutdown('manual')"
      ),
      result: t(
        'Prints `checkout order saved A-17`. The sink reads the default context, message and explicit metadata directly; no formatting plugin is needed for structured consumption.\n\nThe core installs no sink or level methods by default. This example supplies useSink itself; level() adds info/warn and color() adds console rendering. Both required execution budgets are false here, explicitly opting out of their Host time limits.',
        '输出 `checkout 订单已保存 A-17`，输出端直接读取默认路径、消息和显式元数据，不需要格式插件便可消费结构化条目。\n\n核心默认不安装输出端，也没有级别方法；本例自行登记 `useSink`，`level()` 才添加 `info`、`warn`，`color()` 才添加控制台渲染。两项必填执行预算均设为 `false`，显式取消对应的 Host 时限。'
      )
    },
    {
      title: t(
        'Keep one sink from rewriting another sink’s entry fields',
        '避免一个输出端改写另一个输出端的条目字段'
      ),
      problem: t(
        'A console sink annotates an entry for display, then an audit sink unexpectedly sees those annotations. At the same time, application objects inside arguments may be shared deliberately.\n\nPassing one mutable entry to every sink lets top-level formatting state leak between outputs. Deep-cloning everything has a different cost and changes application object identity.\n\nLogger supplies each sink with a shallow snapshot and a separate data record. Mutate one sink’s data and a nested argument, then observe the second sink to see the exact isolation boundary.',
        '控制台输出端为展示修改条目后，审计输出端意外读到了这些修改；与此同时，参数里的业务对象可能本就需要保留同一引用。\n\n把同一个可变条目交给所有输出端，会让表层格式状态互相污染；把全部值深拷贝，又会改变业务对象身份并增加不同的处理成本。\n\n`Logger` 为每个输出端提供浅快照和独立的 `data` 表；先修改一个输出端的 `data` 与嵌套参数，再观察另一个输出端，确认隔离具体到哪一层。'
      ),
      example: t(
        "import { Logger } from '@migaia/logger'\n\nconst log = new Logger({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n})\nconst details = { count: 1 }\nlog.useSink((entry) => {\n  entry.data.route = 'changed'\n  ;(entry.args[0] as { count: number }).count = 2\n})\nlog.useSink((entry) => {\n  console.log(entry.data.route, (entry.args[0] as { count: number }).count)\n})\nlog.dispatchRaw({ tag: 'audit', message: 'checkout', data: { route: 'original' }, args: [details] })\nconsole.log(details.count)\nawait log.shutdown('manual')",
        "import { Logger } from '@migaia/logger'\n\nconst log = new Logger({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n})\nconst details = { count: 1 }\nlog.useSink((entry) => {\n  entry.data.route = 'changed'\n  ;(entry.args[0] as { count: number }).count = 2\n})\nlog.useSink((entry) => {\n  console.log(entry.data.route, (entry.args[0] as { count: number }).count)\n})\nlog.dispatchRaw({ tag: 'audit', message: 'checkout', data: { route: 'original' }, args: [details] })\nconsole.log(details.count)\nawait log.shutdown('manual')"
      ),
      result: t(
        'Prints `original 2` and `2`. The second sink keeps the original data.route, but both sinks and the caller observe the same nested argument object after its count changes.\n\nIsolation is shallow: args, context, data, metadata and the Date container are copied for each sink, while nested application values remain shared. Redaction that must protect a nested value should replace it in the pipeline before delivery.',
        '逐行输出 `original 2`、`2`；第二个输出端的 `data.route` 保持原值，但两输出端与调用者都看到同一嵌套参数对象的计数变化。\n\n隔离是浅层的：每个输出端分别获得参数数组、路径、`data`、元数据及日期容器的副本，嵌套业务值仍共享；若脱敏必须保护嵌套值，应在管线中替换后再交付。'
      )
    },
    {
      title: t('Wait for asynchronous sink work before continuing', '继续执行前等待异步输出端完成'),
      problem: t(
        'A request finishes its log call and immediately closes its response or process. An asynchronous sink has started but has not saved the entry yet.\n\nA fire-and-forget sink hides its completion from the caller. Waiting only for a buffer callback does not cover promises returned directly by other sinks.\n\nReturn the sink’s actual Promise and await log.flush(). Logger tracks that completion along with deferred tasks and hooks; the example uses a microtask, so it needs no guessed delay.',
        '请求写完日志便立即结束响应或退出进程，异步输出端虽然已经启动，却还没保存条目。\n\n只发起、不暴露完成结果的输出端，无法让调用者知道何时写完；仅等待缓冲回调，也覆盖不了其他输出端直接返回的 Promise。\n\n输出端返回真实的 Promise，再等待 `log.flush()`；`Logger` 将其与延后任务、钩子一并追踪，本例使用微任务展示顺序，不依赖猜测延迟。'
      ),
      example: t(
        "import { Logger } from '@migaia/logger'\n\nconst log = new Logger({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n})\nconst saved: string[] = []\nlog.useSink(async (entry) => {\n  await Promise.resolve()\n  saved.push(entry.message)\n})\nlog.log('audit', 'saved')\nconsole.log(saved.length)\nawait log.flush()\nconsole.log(saved.length, saved[0])\nawait log.shutdown('manual')",
        "import { Logger } from '@migaia/logger'\n\nconst log = new Logger({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n})\nconst saved: string[] = []\nlog.useSink(async (entry) => {\n  await Promise.resolve()\n  saved.push(entry.message)\n})\nlog.log('audit', '已保存')\nconsole.log(saved.length)\nawait log.flush()\nconsole.log(saved.length, saved[0])\nawait log.shutdown('manual')"
      ),
      result: t(
        'Prints `0` and `1 saved`. The log call returns before the asynchronous sink commits, and flush completes after the tracked Promise has saved its entry.\n\nPublic flush() takes no argument and uses a 3000 ms drain budget on the logger scheduler. Deadline diagnostics go to onFailure; a deadline does not abort underlying work or prove remote receipt. A sink must return its Promise to participate.',
        '逐行输出 `0`、`1 已保存`；日志调用在异步输出提交前返回，`flush` 在所追踪 Promise 保存条目后完成。\n\n公开 `flush()` 不接收参数，使用日志调度器上的 `3000` 毫秒排空预算；截止诊断交给 `onFailure`，不会中止底层工作，也不证明远端已接收，输出端须返回 Promise 才会被追踪。'
      )
    },
    {
      title: t(
        'Write the final entry once during shared shutdown',
        '在共享关闭流程中写入最后一条日志'
      ),
      problem: t(
        'Several owners close a logger at the same time, and a shutdown callback still needs to record the final state. Repeating shutdown can duplicate the final entry or dispose resources too early.\n\nIndependent cleanup functions can race a final log call against sink disposal. Returning unrelated promises also makes it difficult for callers to share one terminal outcome.\n\nRegister the final entry through onShutdown, then retain shutdown’s Promise. dispose() returns that same completion; Logger attempts to drain final entries within its waiting budget before releasing the installed plugins.',
        '多个所有者同时关闭日志器，而关闭回调还要记录最终状态；重复启动关闭流程可能让最后一条日志写多次，或过早释放资源。\n\n分散的清理函数可能让最终日志与输出端释放同时发生，若各自返回不同 Promise，调用者也难以共享同一次终结结果。\n\n通过 `onShutdown` 登记最终日志，再保留 `shutdown` 的 Promise；`dispose()` 返回同一个完成结果，`Logger` 会先在等待预算内尝试排空最终条目，再释放所安装插件。'
      ),
      example: t(
        "import { Logger } from '@migaia/logger'\n\nconst log = new Logger({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n})\nconst entries: string[] = []\nlog.useSink((entry) => { entries.push(entry.message) })\nlog.onShutdown(() => { log.log('audit', 'final') })\nconst closing = log.shutdown('manual')\nconsole.log(closing === log.dispose())\nawait closing\nlog.log('audit', 'after close')\nconsole.log(entries.join(','))",
        "import { Logger } from '@migaia/logger'\n\nconst log = new Logger({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n})\nconst entries: string[] = []\nlog.useSink((entry) => { entries.push(entry.message) })\nlog.onShutdown(() => { log.log('audit', '最后一条') })\nconst closing = log.shutdown('manual')\nconsole.log(closing === log.dispose())\nawait closing\nlog.log('audit', '关闭后')\nconsole.log(entries.join(','))"
      ),
      result: t(
        'Prints `true` and `final`. shutdown and dispose share the same Promise, the callback’s final structured entry reaches the sink, and the later entry after closing is ignored.\n\nShutdown is terminal. Its handlers and flush share a 3000 ms waiting budget; subsequent Host disposal uses execution budgets separately. A disposal result reports cleanup status and errors, rather than serving as a delivery receipt.',
        '逐行输出 `true`、`最后一条`；`shutdown` 与 `dispose` 共享同一 Promise，回调中的最终结构化日志到达输出端，关闭后的条目被忽略。\n\n关闭后不能重新启用；关闭回调与排空共享 `3000` 毫秒等待预算，后续 Host 释放另用 `execution` 预算；释放结果报告清理状态及错误，不是日志送达回执。'
      )
    }
  ],
  level: [
    {
      title: t(
        'Apply a threshold and temporarily remove private entries',
        '按级别设门槛，并临时排除保密条目'
      ),
      problem: t(
        'A service wants warnings and errors normally, but one operation needs an extra privacy filter. Removing that temporary rule must leave the level threshold intact.\n\nScattered if statements duplicate level comparisons at every call site. A single shared mutable filter list makes it easy to remove another owner’s rule or forget to restore the threshold.\n\nInstall level({ level: LoggerLevel.warn }), then add a filter and retain its removal handle. setLevel changes the threshold independently; the sink shows which entries survive both checks.',
        '服务平常只需要警告和错误，某次操作又要额外过滤保密条目；撤掉临时规则时，级别门槛仍须保留。\n\n在各调用点散写条件，会重复级别比较；手动维护共享过滤列表，又容易误删别人的规则，或忘记恢复门槛。\n\n安装 `level({ level: LoggerLevel.warn })`，用 `addFilter` 添加规则并保留移除句柄；`setLevel` 独立调整门槛，输出端展示同时通过两项检查的条目。'
      ),
      example: t(
        "import { Logger, LoggerLevel } from '@migaia/logger'\nimport { level } from '@migaia/logger/plugins'\n\nconst log = new Logger({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  plugins: [level({ level: LoggerLevel.warn })]\n})\nconst entries: string[] = []\nlog.useSink((entry) => { entries.push(entry.tag + ':' + entry.message) })\nconst off = log.addFilter((entry) => entry.message !== 'private')\nlog.info('below threshold')\nlog.warn('private')\nlog.error('shown')\noff()\noff()\nlog.warn('private')\nlog.setLevel(LoggerLevel.info)\nlog.info('visible')\nconsole.log(entries.join(','))\nawait log.shutdown('manual')",
        "import { Logger, LoggerLevel } from '@migaia/logger'\nimport { level } from '@migaia/logger/plugins'\n\nconst log = new Logger({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  plugins: [level({ level: LoggerLevel.warn })]\n})\nconst entries: string[] = []\nlog.useSink((entry) => { entries.push(entry.tag + ':' + entry.message) })\nconst off = log.addFilter((entry) => entry.message !== '保密')\nlog.info('低于阈值')\nlog.warn('保密')\nlog.error('可见')\noff()\noff()\nlog.warn('保密')\nlog.setLevel(LoggerLevel.info)\nlog.info('已放行')\nconsole.log(entries.join(','))\nawait log.shutdown('manual')"
      ),
      result: t(
        'Prints `error:shown,warn:private,info:visible`. The first info entry fails the threshold and the first private warning fails the filter; removing that filter and lowering the threshold each affects later calls.\n\nDefaults are level: debug, filters: [], and asyncOutput: false. Standard levels are debug, info, warn, error and fatal; non-level tags bypass the threshold but still pass through filters. The off function removes matching filter function identities.',
        '输出 `error:可见,warn:保密,info:已放行`；首条信息被门槛挡住，首条保密警告被过滤，之后撤销过滤器与降低门槛分别影响后续调用。\n\n默认 `level: debug`、`filters: []`、`asyncOutput: false`；标准级别为 `debug`、`info`、`warn`、`error`、`fatal`，其他标签不受级别门槛限制，但仍经过过滤；移除句柄按过滤函数身份删除匹配项。'
      )
    }
  ],
  color: [
    {
      title: t(
        'Render an error chain as JSON through the chosen host console',
        '通过指定宿主控制台把错误输出为 JSON'
      ),
      problem: t(
        'A collector needs parseable JSON with an error name, message and stack. Printing an Error as a plain JSON object can lose its non-enumerable built-in fields.\n\nJSON.stringify(new Error()) usually produces an empty object. A custom console wrapper can also accidentally print JSON to a different host console than the one owned by its logger.\n\nInstall color({ format: "json" }) and supply the public runtimeManager.console port. The example borrows all other default capabilities and captures only console output in memory; it performs no file or HTTP write.',
        '收集器需要可解析 JSON，以及错误名称、消息与堆栈；直接把 `Error` 当普通对象序列化，会丢失不可枚举的内置字段。\n\n直接 `JSON.stringify(new Error())` 通常只得到空对象，手写控制台包装还可能把 JSON 写到另一份宿主控制台，而非当前日志器所使用的那份。\n\n安装 `color({ format: "json" })`，提供公开的 `runtimeManager.console` 接口；本例沿用其余默认能力，仅把控制台输出收集到内存，不写文件也不发送 HTTP。'
      ),
      example: t(
        "import { Logger, getLoggerRuntimeManager } from '@migaia/logger'\nimport { color } from '@migaia/logger/plugins'\n\nconst lines: string[] = []\nconst capture = (...args: unknown[]): void => { lines.push(String(args[0])) }\nconst log = new Logger({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  context: ['checkout'],\n  runtimeManager: {\n    ...getLoggerRuntimeManager(),\n    console: { log: capture, warn: capture, error: capture }\n  },\n  plugins: [color({ format: 'json' })]\n})\nconst original = new Error('insufficient balance')\nlog.log('error', 'checkout failed', original)\nawait log.flush()\nconst entry = JSON.parse(lines[0]!)\nconsole.log(entry.tag, entry.context, entry.error.name, entry.error.message)\nconsole.log(typeof entry.error.stack === 'string', Object.hasOwn(entry.error, 'raw'))\nawait log.shutdown('manual')",
        "import { Logger, getLoggerRuntimeManager } from '@migaia/logger'\nimport { color } from '@migaia/logger/plugins'\n\nconst lines: string[] = []\nconst capture = (...args: unknown[]): void => { lines.push(String(args[0])) }\nconst log = new Logger({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  context: ['checkout'],\n  runtimeManager: {\n    ...getLoggerRuntimeManager(),\n    console: { log: capture, warn: capture, error: capture }\n  },\n  plugins: [color({ format: 'json' })]\n})\nconst original = new Error('余额不足')\nlog.log('error', '结账失败', original)\nawait log.flush()\nconst entry = JSON.parse(lines[0]!)\nconsole.log(entry.tag, entry.context, entry.error.name, entry.error.message)\nconsole.log(typeof entry.error.stack === 'string', Object.hasOwn(entry.error, 'raw'))\nawait log.shutdown('manual')"
      ),
      result: t(
        'Prints `error checkout Error insufficient balance` and `true false`. The JSON payload keeps the error name, message and a stack string, while excluding the local raw Error reference.\n\nformat defaults to auto, color to auto, timestamp to true, colorMessage to none, and colorMap to no overrides. JSON rendering uses bounded error-chain serialization; nested args and application data still follow ordinary JSON semantics.',
        '逐行输出 `error checkout Error 余额不足`、`true false`；JSON 保留错误名称、消息与堆栈字符串，但不输出本地 `raw` 错误引用。\n\n默认 `format: auto`、`color: auto`、`timestamp: true`、`colorMessage: none`，`colorMap` 无覆盖项；JSON 渲染使用有界错误链投影，嵌套参数与业务数据仍遵循普通 JSON 语义。'
      )
    }
  ]
}
