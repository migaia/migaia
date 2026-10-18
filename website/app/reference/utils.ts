/**
 * Reference documentation of `@migaia/utils`. Rules: `app/reference/contract.ts`. Verified against
 * `packages/utils/src` (promise.ts, scheduler.ts, error.ts, error-chain*.ts, bytes.ts, object.ts,
 * object-path.ts, config.ts, function.ts, number.ts, string.ts, value.ts, url.ts, collector.ts),
 * README and USEGUIDE on 2026-10-17. Source correction: `withTimeout` with zero timeout and `start`
 * still schedules a zero-delay deadline; it does not disable the deadline.
 */
import type { ILibraryReference, IMemberDoc, IText, ITypeDoc } from './contract.js'

/** Builds one bilingual text. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Short type doc for type-only aliases. */
const alias = (en: string, zh: string): ITypeDoc => ({ summary: t(en, zh), members: {} })

/** Shared cancellation controls (`IAsyncControls`) member docs. */
const asyncControlMembers: Readonly<Record<string, IMemberDoc>> = {
  signal: {
    summary: t(
      'Cancels the operation when it aborts; the Promise rejects with `UtilsAbortError` whose `cause` is the abort reason. Cannot be combined with `signals`.',
      '中止时取消该操作，Promise 以 `UtilsAbortError` reject，`cause` 为中止原因。不能与 `signals` 同时使用。'
    ),
    default: t(
      'Not set: the operation cannot be cancelled from outside.',
      '不设置：无法从外部取消该操作。'
    )
  },
  signals: {
    summary: t(
      'Several signals; the operation is cancelled when any of them aborts. Cannot be combined with `signal` (`TypeError`).',
      '多个信号，任意一个中止就取消该操作。不能与 `signal` 同时使用（否则抛 `TypeError`）。'
    ),
    default: t('Not set: only `signal`, if any, cancels.', '不设置：只由 `signal`（如果有）取消。')
  },
  scheduler: {
    summary: t(
      'Clock and timers used for delays and deadlines; inject a manual scheduler in tests.',
      '计算延时与截止时间所用的时钟和计时器；测试中可注入手动调度器。'
    ),
    default: t('`systemScheduler` (native timers).', '`systemScheduler`，即宿主原生计时器。')
  },
  unref: {
    summary: t(
      'In Node, marks timers so they do not keep the process alive.',
      '在 Node 中把计时器标记为不阻止进程退出。'
    ),
    default: t('`false`: timers keep the process alive.', '`false`：计时器会让进程保持运行。')
  }
}

/** Reporter parameter text shared by promise helpers. */
const reportText = t(
  '`report(error, { operation, phase, attempt? })` receives failures that arrive after the result settled (late rejections, cleanup errors); default `hostRethrowReporter` rethrows them on a microtask so they are not lost.',
  '`report(error, { operation, phase, attempt? })` 接收结果确定之后才出现的失败（迟到的 reject、清理错误）；默认 `hostRethrowReporter` 会在微任务中重新抛出，避免错误被吞掉。'
)

/** Unknown-field policy shared by receiving and normalizing serialized error trees. */
const normalizeOptionDocs: Readonly<Record<string, IMemberDoc>> = {
  unknownFields: {
    summary: t(
      'Policy for fields outside the boundary strategy whitelist.',
      '如何处理边界策略白名单之外的字段。'
    ),
    default: t(
      '`reject`: fail validation on an unknown field.',
      '`reject`：遇到未知字段即校验失败。'
    ),
    values: {
      reject: t(
        'Reject the received tree when an unknown field is found.',
        '发现未知字段时拒绝接收整棵错误树。'
      ),
      ignore: t(
        'Drop unknown fields and invoke `onUnknownField` when supplied.',
        '丢弃未知字段，设置了 `onUnknownField` 时通知调用方。'
      )
    }
  },
  onUnknownField: {
    summary: t(
      'Synchronous callback receiving the tree pointer and discarded field name in `ignore` mode; a throw propagates.',
      '`ignore` 模式下同步接收树内路径与被丢弃的字段名；回调抛错会向外传播。'
    ),
    default: t(
      'Not set: unknown fields are dropped without a callback in `ignore` mode.',
      '不设置：在 `ignore` 模式下直接丢弃未知字段，不发送回调通知。'
    )
  }
}

/** Both error-tree walkers use the same reporting policy for unsafe property reads. */
const chainReportOptionDocs: Readonly<Record<string, IMemberDoc>> = {
  report: {
    summary: t(
      'Synchronous callback receiving `{ pointer, field, error }` when reading input fails; a callback throw propagates.',
      '读取输入失败时同步接收 `{ pointer, field, error }`，用于报告路径、字段和原始错误；回调抛错会向外传播。'
    ),
    default: t(
      'Not set: a caught input failure is rethrown as an error-chain violation.',
      '不设置：捕获到的输入读取失败以错误链违规错误重新抛出。'
    )
  }
}

/** Diagnostic default shared by the abort and deadline wrappers. */
const promiseReportOption: IMemberDoc = {
  summary: reportText,
  default: t(
    '`hostRethrowReporter`: rethrow unhandled late failures on a microtask.',
    '`hostRethrowReporter`：在微任务中重新抛出未处理的迟到失败。'
  )
}

/** Docs of a path probe member set. */
const probeMembers = (
  kind: 'missing' | 'blocked' | 'failed'
): Readonly<Record<string, IMemberDoc>> => ({
  kind: {
    summary: t(
      `Always \`${kind}\`; branch on it to tell probe results apart.`,
      `固定为 \`${kind}\`，用它区分不同的探测结果。`
    )
  },
  originKey: {
    summary: t('The path exactly as the caller passed it.', '调用方传入的原始路径，未经改写。')
  },
  segments: {
    summary: t(
      'The parsed path as a segment tuple.',
      '解析后的路径段元组，例如 `["user", "tags", 0]`。'
    )
  },
  failedAt: {
    summary: t('Index of the segment where reading stopped.', '读取停止时所在路径段的下标。')
  },
  failedKey: { summary: t('The segment where reading stopped.', '读取停止时所在的那个路径段。') },
  resolvedPath: {
    summary: t(
      'Segments that were read successfully before stopping.',
      '停止之前已经成功读取的路径段。'
    )
  },
  parent: {
    summary: t(
      'The value that was being read into when reading stopped.',
      '读取停止时正在读取其属性的那个父级值。'
    )
  },
  ...(kind === 'failed'
    ? {
        error: {
          summary: t(
            'The exact value thrown by the getter or proxy.',
            'getter 或 Proxy 抛出的原始错误值，未经包装。'
          )
        }
      }
    : {})
})

/** Docs of the collector members. */
const collectorMembers: Readonly<Record<string, IMemberDoc>> = {
  result: {
    summary: t(
      'Runs the query once on first read and caches it; later reads of the same query return the same array. Items keep their identity and source order.',
      '第一次读取时执行查询并缓存；同一查询再次读取返回同一个数组。结果中的元素保持原对象身份与原有顺序。'
    )
  },
  fieldBy: {
    summary: t(
      'Chooses the candidate fields used by `like`, `equals` and `oneOf`, and drops items where every candidate field is `undefined`. Those three methods only exist after `fieldBy`.',
      '选定 `like`、`equals`、`oneOf` 使用的候选字段，并过滤掉所有候选字段都为 `undefined` 的元素。这三个方法只有在调用 `fieldBy` 之后才可用。'
    ),
    params: {
      paths: t(
        'One or more field paths such as `profile.name`.',
        '一个或多个字段路径，例如 `profile.name`。'
      )
    },
    returns: t(
      'A field collector exposing `like`, `equals`, `oneOf`.',
      '具备 `like`、`equals`、`oneOf` 的字段筛选器。'
    ),
    example: `collect(users).fieldBy('profile.name-zh', 'profile.name-en').like('ada')`
  },
  where: {
    summary: t(
      'Keeps items for which `predicate` returns `true`.',
      '只保留判断函数 `predicate` 返回 `true` 的元素。'
    ),
    params: { predicate: t('Test called per source item.', '对每个源元素调用的判断函数。') },
    returns: t('The same collector, for chaining.', '同一个筛选器，可继续链式调用。'),
    example: `collect(users).where((user) => user.active)`
  },
  distinctBy: {
    summary: t(
      'Keeps only the first item for each value at `path`.',
      '对 `path` 处的每个取值只保留第一个元素。'
    ),
    params: { path: t('Field path whose value must be unique.', '取值需要唯一的字段路径。') },
    returns: t('The same collector.', '同一个筛选器，可继续链式调用。'),
    example: `collect(orders).distinctBy('customerId')`
  },
  skip: {
    summary: t(
      'Skips the first `count` matching items.',
      '跳过前 `count` 个匹配的元素，常与 `take` 一起用于分页。'
    ),
    params: { count: t('Non-negative integer.', '非负整数，要跳过的数量。') },
    returns: t('The same collector.', '同一个筛选器，可继续链式调用。'),
    example: `collect(rows).skip(20).take(20) // 第二页`
  },
  take: {
    summary: t('Keeps at most `count` matching items.', '最多保留 `count` 个匹配的元素。'),
    params: { count: t('Non-negative integer.', '非负整数，最多保留的数量。') },
    returns: t('The same collector.', '同一个筛选器，可继续链式调用。'),
    example: `collect(rows).take(10)`
  }
}

/** Collector instance scenarios and example. */
const collectorScenarios = [
  t(
    'Filter a search list by several language fields with a case-insensitive keyword.',
    '用一个关键字在多个语言字段中模糊筛选搜索列表。'
  ),
  t('Paginate an in-memory array with `skip` and `take`.', '用 `skip` 与 `take` 对内存数组分页。')
]
const collectorExample = `import { collect } from '@migaia/utils'

type IUser = { active: boolean; profile: { 'name-zh': string; 'name-en': string } }
const users: readonly IUser[] = [
  { active: true, profile: { 'name-zh': '阿达', 'name-en': 'Ada' } },
  { active: false, profile: { 'name-zh': '格蕾丝', 'name-en': 'Grace' } }
]
const collector = collect(users)
  .fieldBy('profile.name-zh', 'profile.name-en')
  .like('ada')
  .where((user) => user.active)
  .take(20)
console.log(collector.result.length) // 1`

/** Reference of `@migaia/utils`. */
export const utilsReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Root entry point: re-exports the subpath modules and adds `collect()` (lazy field filtering) and the URL helpers `isUrlObject()` / `readUrlHref()`. Importing a subpath such as `@migaia/utils/promise` keeps bundles smaller.',
        '根入口：重新导出各子路径模块，并额外提供 `collect()`（惰性字段筛选）以及 URL 辅助函数 `isUrlObject()` / `readUrlHref()`。直接导入 `@migaia/utils/promise` 这类子路径可以让打包结果更小。'
      ),
      example: `import { collect, readUrlHref } from '@migaia/utils'

console.log(readUrlHref(new URL('https://example.com/a'))) // https://example.com/a`
    },
    bytes: {
      summary: t(
        'Use this entry when text must become bytes for storage or transport, or bytes must be represented as Base64 text. Import `@migaia/utils/bytes` when that conversion is your task, rather than selecting it from the general root utilities.\n\nStart with `encodeUtf8()` to turn text into a new byte array, or `bytesToBase64()` to turn bytes into Base64, a text representation of binary data. These helpers convert data; they do not read files or send messages.',
        '需要把文本转成字节以便保存或传输，或把字节表示成 `Base64` 文本时，使用此入口；`Base64` 是用文本表示二进制数据的编码方式。只处理这些转换时，可从 `@migaia/utils/bytes` 导入所需函数，不必从汇集多类工具的根入口选择。\n\n从 `encodeUtf8()` 开始把文本转成新的字节数组，或用 `bytesToBase64()` 把字节转成文本。这些函数只转换数据，不负责读取文件或发送消息。'
      ),
      example: `import { bytesToBase64, encodeUtf8 } from '@migaia/utils/bytes'

bytesToBase64(encodeUtf8('你好')) // '5L2g5aW9'`
    },
    config: {
      summary: t(
        'Use this entry to keep caller changes from altering configuration your component has already accepted. Choose `@migaia/utils/config` for configuration ownership and updates, rather than the root collection of general utilities.\n\n`ownConfig()` validates and copies the input so your component has its own configuration; `patchConfig()` derives an updated configuration without mutating the previous one. For reading or updating arbitrary nested application data without configuration ownership, use `@migaia/utils/object-path`.',
        '组件接收配置后，如果不希望调用方后续修改影响它，可使用此入口。需要接管配置并派生新版本时，从 `@migaia/utils/config` 导入，比从汇集多类工具的根入口选择更能表明用途。\n\n`ownConfig()` 检查并复制输入，让组件持有自己的配置；`patchConfig()` 生成更新后的配置，不修改旧版本。若只是读写普通业务对象的嵌套字段，不需要接管配置，应使用 `@migaia/utils/object-path`。'
      ),
      example: `import { ownConfig, patchConfig } from '@migaia/utils/config'

const base = ownConfig({ retries: 2 })
const next = patchConfig(base, { retries: 3 })`
    },
    error: {
      summary: t(
        'Use this entry when failures need a stable identity or several failures must remain traceable together. Import `@migaia/utils/error` for error handling rather than the root collection of unrelated helpers.\n\n`attachErrorIdentity()` adds `source` and `code` to an existing error object; `attachSecondaryErrors()` keeps cleanup failures alongside the primary error. If the primary cannot accept those extra failures, the latter returns an `AggregateError` with the primary first, so keep its return value.',
        '需要给错误标明来源，或同时保留主要失败与清理失败时，使用此入口。专门处理错误时，从 `@migaia/utils/error` 导入即可，不必从汇集其他工具的根入口选择。\n\n`attachErrorIdentity()` 给已有错误对象添加 `source` 与 `code`；`attachSecondaryErrors()` 把清理失败附在主要错误旁边。主要错误无法接收这些附加信息时，后者返回以主要错误为首项的 `AggregateError`，因此要使用它的返回值。'
      ),
      example: `import { attachErrorIdentity } from '@migaia/utils/error'

throw attachErrorIdentity(new Error('请求失败'), { source: 'my-app', code: 'FETCH_FAILED' })`
    },
    function: {
      summary: t(
        'Use this entry when several callers must share one initialization instead of running it repeatedly. Import `@migaia/utils/function` when you need reusable function behavior rather than the root collection of general helpers.\n\n`once()` remembers the first synchronous result, including a thrown failure; `onceAsync()` invokes an asynchronous function once and returns the same Promise on later calls. These helpers do not retry failed initialization; use the promise entry when retry is the intended behavior.',
        '多个调用方需要共用一次初始化结果，而不是重复执行时，可使用此入口。需要这类函数行为时，从 `@migaia/utils/function` 导入，不必从汇集多类工具的根入口选择。\n\n`once()` 记住首次同步调用的结果，包括抛出的错误；`onceAsync()` 只发起一次异步调用，后续调用返回同一个 `Promise`。它们不会在初始化失败后重试；需要重试时应使用 `@migaia/utils/promise`。'
      ),
      example: `import { once } from '@migaia/utils/function'

const getRegistry = once(() => buildRegistry())`
    },
    number: {
      summary: t(
        'Use this entry to display numbers in a chosen locale, including money and percentages. Choose `@migaia/utils/number` when formatting is the task, rather than the root collection of general utilities.\n\n`formatCurrency()` formats a value with the currency you specify; `createNumberFormatter()` creates a formatter you can reuse across many values. The functions use `Intl.NumberFormat`, the platform number formatter, and leave currency and precision choices to you; they do not parse numeric text.',
        '需要按指定地区的习惯显示数字、金额或百分比时，使用此入口。专门处理数字展示时，可从 `@migaia/utils/number` 导入，不必从汇集多类工具的根入口选择。\n\n`formatCurrency()` 按你指定的货币格式化数值；`createNumberFormatter()` 创建可反复处理多个数值的格式器。它们使用平台提供的数字格式器 `Intl.NumberFormat`，货币和精度仍由你决定，也不负责把文本解析成数字。'
      ),
      example: `import { formatCurrency } from '@migaia/utils/number'

formatCurrency(1234.5, 'CNY', { locales: 'zh-CN' }) // '¥1,234.50'`
    },
    object: {
      summary: t(
        'Use this entry to inspect object properties or copy supported data without hiding a failing property read. Choose `@migaia/utils/object` for these object operations rather than the root collection of general utilities.\n\n`probeProperty()` reads one property once and reports whether it returned a value or threw; `immutableSnapshot()` creates an independent immutable snapshot of supported plain data. If your task is specifically to follow a nested path, use the narrower `@migaia/utils/object-path` entry.',
        '需要检查对象属性，或复制支持的数据，同时明确处理属性读取失败时，使用此入口。专门进行对象操作时，从 `@migaia/utils/object` 导入，不必从汇集多类工具的根入口选择。\n\n`probeProperty()` 只读取一次指定属性，并区分读到值与读取时抛错；`immutableSnapshot()` 为支持的普通数据创建独立且不可修改的快照。如果只需要沿嵌套路径读写字段，可使用范围更集中的 `@migaia/utils/object-path`。'
      ),
      example: `import { probeProperty } from '@migaia/utils/object'

const read = probeProperty<string>(user, 'name')
if (read.kind === 'value') console.log(read.value)`
    },
    'object-path': {
      summary: t(
        'Use this entry when a field sits inside nested objects or arrays and you want to address it by a path. Import `@migaia/utils/object-path` for path operations rather than the root utilities or the broader object entry.\n\n`get()` reads a path and returns `undefined` for a missing or blocked segment; `set()` returns an updated object without mutating the original. A blocked segment means the path cannot continue through the value at that point; getter failures remain observable rather than becoming a missing value.',
        '字段位于嵌套对象或数组中，需要按路径访问时，使用此入口。专门读写路径时，从 `@migaia/utils/object-path` 导入，比从根入口或功能更多的对象入口选择更直接。\n\n`get()` 读取路径，遇到字段缺失或无法继续访问的中间值时返回 `undefined`；`set()` 返回更新后的对象，不修改原对象。路径受阻是指中间的值无法继续访问下一段；属性读取自身抛出的错误仍会显式暴露，不会当成字段缺失。'
      ),
      example: `import { get, set } from '@migaia/utils/object-path'

const next = set({ user: { name: 'Ada' } }, 'user.name', 'Grace')
get(next, 'user.name') // 'Grace'`
    },
    promise: {
      summary: t(
        'Use this entry when asynchronous work needs a deadline, cancellation, or a retry policy. Choose `@migaia/utils/promise` for those operations rather than the root collection of general helpers.\n\n`withTimeout()` starts an operation and limits how long its caller waits; `retry()` runs attempts within the configured retry and deadline rules. Cancellation is cooperative: pass the supplied `signal` to work that observes it, because ending the wait alone cannot stop that work.',
        '异步工作需要截止时间、取消或重试策略时，使用此入口。专门控制异步操作时，从 `@migaia/utils/promise` 导入，不必从汇集多类工具的根入口选择。\n\n`withTimeout()` 发起操作并限制调用方等待的时间；`retry()` 按配置的重试规则和截止时间执行多次尝试。取消需要操作配合：把收到的 `signal` 传给会响应它的工作，仅结束等待并不能让工作停止。'
      ),
      example: `import { withTimeout } from '@migaia/utils/promise'

await withTimeout(({ signal }) => fetch('/api', { signal }), { timeoutMs: 2000 })`
    },
    scheduler: {
      summary: t(
        'Use this entry when code must read elapsed time or schedule a callback through a shared clock and timer interface. Import `@migaia/utils/scheduler` for that contract and its normal implementation rather than the root collection of utilities.\n\n`systemScheduler.schedule()` arranges a callback and returns a handle that can cancel it; `systemWallClock.timestamp()` supplies a calendar timestamp. Scheduler time measures intervals, while calendar timestamps describe dates; use `@migaia/utils/testing` when you need to advance time manually.',
        '代码需要通过统一的时钟和定时器接口计算耗时或安排回调时，使用此入口。需要这套接口及其正常运行实现时，从 `@migaia/utils/scheduler` 导入，不必从汇集多类工具的根入口选择。\n\n`systemScheduler.schedule()` 安排回调并返回可取消它的句柄；`systemWallClock.timestamp()` 提供日历时间戳。调度器时间用于计算间隔，日历时间戳用于表示日期；需要手动推进时间时，使用 `@migaia/utils/testing`。'
      ),
      example: `import { systemScheduler } from '@migaia/utils/scheduler'

const task = systemScheduler.schedule(() => console.log('到时'), 1000)
task.cancel()`
    },
    testing: {
      summary: t(
        'Use this entry to check timer-driven behavior without waiting for real time to pass. Manual time controls are exported from `@migaia/utils/testing`, separately from the root and normal scheduler entries.\n\n`createManualScheduler()` creates a clock whose `advance(ms)` moves time forward and runs due callbacks synchronously. Pass that scheduler to the code under examination; use `systemScheduler` from `@migaia/utils/scheduler` for normal host timers.',
        '需要检查由定时器触发的行为，却不想等待真实时间流逝时，使用此入口。手动时间控制由 `@migaia/utils/testing` 单独导出，不在根入口或正常调度器入口中。\n\n`createManualScheduler()` 创建可手动控制的时钟，调用 `advance(ms)` 会推进时间，并同步执行已到期的回调。把它传给要检查的代码；正常使用宿主定时器时，应选 `@migaia/utils/scheduler` 中的 `systemScheduler`。'
      ),
      example: `import { createManualScheduler } from '@migaia/utils/testing'

const scheduler = createManualScheduler()
scheduler.schedule(() => console.log('ready'), 100)
scheduler.advance(100)`
    },
    string: {
      summary: t(
        'Use this entry to fill a text template from data or to handle a value whose conversion to text may fail. Choose `@migaia/utils/string` for these text operations rather than the root collection of general utilities.\n\n`format()` fills placeholders such as `{user.name}` from nested values; missing placeholders remain visible by default. `tryString()` attempts conversion once and returns either text or the original thrown value, leaving fallback and reporting to you.',
        '需要用数据填充文本模板，或处理可能在转成文本时失败的值，可使用此入口。专门处理文本时，从 `@migaia/utils/string` 导入，不必从汇集多类工具的根入口选择。\n\n`format()` 按嵌套字段填充 `{user.name}` 这样的占位符，默认保留找不到值的占位符。`tryString()` 尝试转换一次，返回文本或转换时抛出的原值；后备文本与错误报告由调用方决定。'
      ),
      example: `import { format } from '@migaia/utils/string'

format('你好，{user.name}', { user: { name: 'Ada' } }) // '你好，Ada'`
    },
    typing: {
      summary: t(
        'This entry contains only types. Import them with `import type` from `@migaia/utils/typing`; the import disappears from the compiled code, so no runtime module is loaded. Use it when your own module only needs to describe data in the same shapes Utils works with.\n\nIt holds two groups. The first is two grouping helpers that the root entry does not export: when a union of events or messages is told apart by a kind field, `IDiscriminatedByField` (kind at the top level) and `IDiscriminatedByPath` (kind deeper inside) give you a separate type for each kind, so a handler table can require one handler per kind.\n\nThe second is shared types also used elsewhere in Utils: object paths (`IObjectPath*`), cancellation signals (`IAbortSignal`, `INativeAbortSignal`), `IDeferred`, `IProbePropertyResult` and `IUrlLike`. Write them into your own signatures to accept the same inputs as Utils. None of these types checks data at runtime; the [type utilities guide](/en/docs/utils/type-utilities) explains when to use each.',
        '这个入口只包含类型。用 `import type` 从 `@migaia/utils/typing` 导入后，编译出的代码里不会留下这条导入，也不会加载任何运行时模块。当你的模块只需要描述数据形态，并且想和 Utils 使用同样的形态时，从这里导入。\n\n这里的类型分两组。第一组是两个分组工具，根入口不导出它们：当事件或消息的联合类型靠一个“种类”字段区分时，`IDiscriminatedByField`（种类字段在最外层）和 `IDiscriminatedByPath`（种类字段在内层）能为每个种类分别得到对应的类型，从而让处理表必须为每个种类提供一个处理函数。\n\n第二组是 Utils 其他功能也在用的共享类型：对象路径（`IObjectPath*` 系列）、取消信号（`IAbortSignal`、`INativeAbortSignal`）、`IDeferred`、`IProbePropertyResult` 和 `IUrlLike`。把它们写进自己的函数签名，就能接收和 Utils 相同的输入。这些类型都不会在运行时检查数据；各自什么时候用，见[类型工具指南](/zh/docs/utils/type-utilities)。'
      ),
      example: `import type { IDiscriminatedByField } from '@migaia/utils/typing'

type IEvent =
  | { readonly kind: 'created'; readonly userId: string }
  | { readonly kind: 'deleted'; readonly reason: string }

type IByKind = IDiscriminatedByField<'kind', IEvent>
// IByKind['created'] is { readonly kind: 'created'; readonly userId: string }.`
    },
    value: {
      summary: t(
        'Use this entry when form or configuration checks must distinguish missing input from valid values such as zero and false. Import `@migaia/utils/value` for value checks rather than the root collection of general utilities.\n\n`isNullish()` recognizes only `null` and `undefined`; `isEmptyValue()` also recognizes blank strings while keeping `0`, `0n`, and `false` as real values. These checks do not convert input types or decide whether arrays and objects count as empty.',
        '表单或配置校验需要区分缺失输入与零、假值等有效数据时，使用此入口。专门判断值时，可从 `@migaia/utils/value` 导入，不必从汇集多类工具的根入口选择。\n\n`isNullish()` 只识别 `null` 与 `undefined`；`isEmptyValue()` 还识别空字符串和纯空白字符串，同时保留 `0`、`0n` 与 `false`。这些判断不转换输入类型，也不替你决定数组和对象是否算空。'
      ),
      example: `import { isEmptyValue } from '@migaia/utils/value'

isEmptyValue('  ') // true
isEmptyValue(0) // false`
    }
  },
  symbols: {
    collect: {
      role: 'factory',
      purpose: t(
        'Starts a lazy filtering query over a read-only array. Chained calls (`fieldBy`, `like`, `where`, `take`, ...) only describe the query; the array is scanned once when `result` is first read, and the result is cached until the query changes.',
        '在只读数组上开始一个惰性筛选查询。链式调用（`fieldBy`、`like`、`where`、`take` 等）只描述查询；第一次读取 `result` 时才扫描一次数组，结果在查询不变时一直缓存。'
      ),
      params: {
        dataSource: t(
          'The array to query. It is borrowed, not copied: keep it and its items unchanged while the collector is in use.',
          '要查询的数组。它被借用而不是复制：使用期间不要修改数组及其元素。'
        )
      },
      returns: t('An `ICollector` to chain on.', '一个可以链式调用的筛选器 `ICollector`。'),
      example: collectorExample,
      scenarios: collectorScenarios
    },
    isUrlObject: {
      role: 'operation',
      purpose: t(
        'Tells whether a value is the object form of a URL (any non-null object with a string `href`, such as `new URL(...)`). It does not check that `href` parses.',
        '判断某个值是否为 URL 的对象形式（任何带字符串 `href` 的非空对象，例如 `new URL(...)`）。不会检查 `href` 能否被解析。'
      ),
      params: {
        value: t(
          'Any value, often a union of a URL and an options object.',
          '任意值，常见于“URL 或选项对象”这样的联合类型。'
        )
      },
      returns: t('`true` when `value.href` is a string.', '`value.href` 为字符串时返回 `true`。'),
      example: `const url = isUrlObject(input) ? input.href : input.url`
    },
    readUrlHref: {
      role: 'operation',
      purpose: t(
        'Returns the text form of a URL-like value: the string itself, or the `href` of a URL object. No parsing or validation happens.',
        '返回类 URL 值的文本形式：字符串原样返回，URL 对象返回其 `href`。不做任何解析或校验。'
      ),
      params: { value: t('A string or an object with `href`.', '字符串，或带 `href` 的对象。') },
      returns: t('The URL text.', 'URL 的文本形式。'),
      example: `fetch(readUrlHref(endpoint))`
    },
    base64ToBytes: {
      role: 'operation',
      purpose: t(
        'Decodes canonical RFC 4648 Base64 (with padding) into bytes. URL-safe or unpadded variants are rejected with `INVALID_ENCODING` instead of being decoded loosely.',
        '把规范的 RFC 4648 Base64（带补齐）解码为字节。URL 安全变体或省略补齐的输入会以 `INVALID_ENCODING` 拒绝，而不是宽松解码。'
      ),
      params: {
        value: t('Base64 text.', '要解码的 Base64 文本。'),
        target: t(
          'Optional buffer to decode into, avoiding an allocation; must have exactly the decoded byte length; a mismatch throws `INVALID_ARGUMENT`.',
          '可选，解码写入的目标缓冲区，用来避免分配；长度必须恰好等于解码后的字节数；不相等时抛 `INVALID_ARGUMENT`。'
        )
      },
      returns: t(
        'The decoded bytes (the `target` view when given).',
        '解码后的字节（传入 `target` 时返回写入后的视图）。'
      ),
      example: `base64ToBytes('AQID') // Uint8Array [1, 2, 3]`
    },
    bytesToBase64: {
      role: 'operation',
      purpose: t(
        'Encodes bytes as canonical padded Base64.',
        '把字节数组编码为带补齐的规范 Base64 文本，结果可以安全放进 JSON 等文本通道传输。'
      ),
      params: { value: t('Bytes to encode.', '要编码的字节。') },
      returns: t('The Base64 text.', '编码后的 Base64 文本。'),
      example: `bytesToBase64(new Uint8Array([1, 2, 3])) // 'AQID'`
    },
    decodeUtf8: {
      role: 'operation',
      optionDocs: {
        fatal: {
          summary: t(
            'Choose whether malformed byte sequences fail decoding instead of producing replacement characters.',
            '选择格式错误的字节序列应使解码失败，还是生成替换字符。'
          ),
          default: t(
            '`false`: replace malformed sequences with the Unicode replacement character.',
            '`false`：把格式错误的序列替换为统一替换字符。'
          ),
          values: {
            true: t(
              'Reject malformed byte sequences with an encoding error.',
              '遇到格式错误的字节序列时抛编码错误。'
            ),
            false: t(
              'Keep decoding with replacement characters for malformed input.',
              '遇到格式错误输入时以替换字符继续解码。'
            )
          }
        }
      },
      purpose: t(
        'Decodes UTF-8 bytes into a string.',
        '把 UTF-8 字节解码为 JavaScript 字符串，可选择遇到非法字节序列时直接报错。'
      ),
      params: {
        value: t('UTF-8 bytes.', '要解码的 UTF-8 字节。'),
        options: t(
          '`fatal: true` throws on invalid byte sequences; default `false` replaces them with U+FFFD.',
          '`fatal: true` 遇到非法字节序列时抛错；默认 `false` 时替换为 U+FFFD。'
        )
      },
      returns: t(
        'The decoded string; fatal malformed UTF-8 throws `INVALID_ENCODING` with UTF-8 diagnostic text.',
        '解码后的字符串；严格模式遇到非法 UTF-8 时抛 `INVALID_ENCODING`，诊断文本标明 UTF-8。'
      ),
      example: `decodeUtf8(bytes, { fatal: true })`
    },
    encodeUtf8: {
      role: 'operation',
      purpose: t(
        'Encodes a string as UTF-8 bytes.',
        '把字符串编码为 UTF-8 字节，每次调用都返回一个新分配的字节数组。'
      ),
      params: { value: t('Text to encode.', '要编码的文本。') },
      returns: t('A new `Uint8Array`.', '新分配的 `Uint8Array` 字节数组。'),
      example: `encodeUtf8('你好').length // 6`
    },
    isArrayBuffer: {
      role: 'operation',
      purpose: t(
        'Tells whether a value is a real `ArrayBuffer` by its internal slot, so values from other realms (iframes, workers) are recognised and look-alikes, proxies and `SharedArrayBuffer` are not.',
        '依据内部槽判断某个值是否为真正的 `ArrayBuffer`：能识别来自其它 realm（iframe、worker）的值，而外形仿造的对象、Proxy 和 `SharedArrayBuffer` 都会被排除。'
      ),
      params: { value: t('Any value.', '要检查的任意值。') },
      returns: t(
        '`true` for an `ArrayBuffer` (also a detached one).',
        '是 `ArrayBuffer` 时返回 `true`（包括已分离的）。'
      ),
      example: `isArrayBuffer(new ArrayBuffer(1)) // true`
    },
    isUint8Array: {
      role: 'operation',
      purpose: t(
        'Tells whether a value is a real `Uint8Array` (or subclass) by its internal slot; `Uint8ClampedArray`, proxies and look-alikes are rejected.',
        '依据内部槽判断某个值是否为真正的 `Uint8Array`（或其子类）；`Uint8ClampedArray`、Proxy 和外形仿造的对象都会被排除。'
      ),
      params: { value: t('Any value.', '要检查的任意值。') },
      returns: t('`true` for a `Uint8Array`.', '是 `Uint8Array` 时返回 `true`。'),
      example: `isUint8Array(new Uint8ClampedArray(1)) // false`
    },
    splitUtf8: {
      role: 'operation',
      purpose: t(
        'Splits a string into pieces whose UTF-8 size is at most `maxBytes`, never cutting a code point.',
        '把字符串切成若干段，每段的 UTF-8 字节数不超过 `maxBytes`，并且不会切断任何字符。'
      ),
      params: {
        value: t('Text to split.', '要切分的文本。'),
        maxBytes: t(
          'Maximum bytes per piece; a safe integer of at least 4.',
          '每段的最大字节数，必须是不小于 4 的安全整数。'
        )
      },
      returns: t('The pieces in order.', '按顺序排列的各段文本。'),
      example: `splitUtf8('你好世界', 6) // ['你好', '世界']`
    },
    streamBase64Chunks: {
      role: 'operation',
      purpose: t(
        'Encodes large byte arrays as a sequence of independently valid Base64 pieces, so each piece can be sent or stored separately.',
        '把大的字节数组编码为一串各自独立有效的 Base64 片段，每段都可以单独发送或保存。'
      ),
      params: {
        value: t('Bytes to encode.', '要编码的字节。'),
        maxChunkBytes: t(
          'Source bytes per piece, a safe integer ≥ 3, rounded down to a multiple of 3; default `32763`.',
          '每段对应的源字节数，必须是不小于 3 的安全整数，会向下取整到 3 的倍数；默认 `32763`。'
        )
      },
      returns: t('An iterable of Base64 strings.', '可迭代的 Base64 字符串序列。'),
      example: `for (const chunk of streamBase64Chunks(file, 4096)) socket.send(chunk)`
    },
    utf8ByteLength: {
      role: 'operation',
      purpose: t(
        'Counts the UTF-8 bytes of a string without allocating a buffer.',
        '计算字符串的 UTF-8 字节数，不分配缓冲区，适合在发送前检查长度上限。'
      ),
      params: { value: t('Text to measure.', '要计算的文本。') },
      returns: t('The byte count.', '字符串的 UTF-8 字节总数。'),
      example: `utf8ByteLength('你好') // 6`
    },
    combineConfig: {
      role: 'operation',
      purpose: t(
        'Merges several owned configurations in order (later wins) into an owned configuration, with configurable strategies for records, arrays, maps, sets and `undefined`, per-path overrides and a conflict resolver. Sources are not modified.',
        '按顺序把多份已拥有的配置合并为一份配置（后者覆盖前者），可分别配置对象、数组、Map、Set 与 `undefined` 的合并策略、按路径覆盖策略以及冲突裁决函数。来源配置不会被修改。'
      ),
      params: {
        sources: t(
          'Configurations created by `ownConfig()`, lowest priority first.',
          '由 `ownConfig()` 创建的配置，优先级从低到高排列。'
        )
      },
      returns: t(
        'An owned configuration; a single source with no configured options is returned unchanged. Incompatible profiles throw `CONFIG_CONFLICT`.',
        '一份已拥有配置；仅一个来源且未设置任何选项时原样返回。不兼容的校验档位抛 `CONFIG_CONFLICT`。'
      ),
      options: 'IConfigCombineOptions',
      example: `const merged = combineConfig([defaults, override], { strategies: { record: 'merge', array: 'concat' } })`
    },
    CONFIG_DELETE: {
      role: 'constant',
      purpose: t(
        'Marker used in a `patchConfig()` patch to delete a key.',
        '在 `patchConfig()` 的补丁中表示“删除这个键”的标记；与写入 `undefined` 不同，键会被真正移除。'
      ),
      example: `patchConfig(config, { debug: CONFIG_DELETE })`
    },
    ConfigProfile: {
      role: 'constant',
      purpose: t(
        'Validation profiles of owned configuration: `data` (portable plain data, the default) or `richRuntime` (also allows functions and constructors).',
        '已拥有配置的校验档位：`data`（可移植的纯数据，默认）或 `richRuntime`（还允许函数和构造器）。'
      ),
      example: `ownConfig({ onReady: () => {} }, { profile: ConfigProfile.richRuntime })`
    },
    ownConfig: {
      role: 'factory',
      purpose: t(
        'Accepts caller options at a boundary: validates the whole value graph, copies it (keeping cycles, shared nodes, `Date`, `RegExp`, `Map`, `Set`), and registers it as an owned configuration. Later changes by the caller do not affect it; the result is not frozen.',
        '在接收边界接纳调用方的配置：校验整张值图并复制（保留循环引用、共享节点、`Date`、`RegExp`、`Map`、`Set`），登记为“已拥有”的配置。调用方之后的修改不会影响它；结果对象本身不会被冻结。'
      ),
      params: { value: t('Plain configuration object.', '普通配置对象。') },
      returns: t(
        'An owned configuration accepted by the other config functions. Unsupported values throw `CONFIG_UNSUPPORTED`; oversized graphs throw `CONFIG_LIMIT_EXCEEDED`.',
        '一份可被其它配置函数接受的已拥有配置。值不受支持时抛 `CONFIG_UNSUPPORTED`；规模超限时抛 `CONFIG_LIMIT_EXCEEDED`。'
      ),
      options: 'IOwnConfigOptions',
      example: `const config = ownConfig(callerOptions)
callerOptions.retry.attempts = 99
config.retry.attempts // 仍是原值`
    },
    parseConfigPath: {
      role: 'operation',
      purpose: t(
        'Parses a dot path into safe segments, rejecting empty, oversized or dangerous segments (`CONFIG_PATH_INVALID`).',
        '把点路径解析为安全的路径段，拒绝空的、超长的或危险的路径段（`CONFIG_PATH_INVALID`）。'
      ),
      params: {
        path: t('Dot path such as `a.b.c`.', '点路径，例如 `a.b.c`。'),
        limits: t(
          '`maxPathLength` and `maxSegmentLength`; default 4096 and 512.',
          '`maxPathLength` 与 `maxSegmentLength`，默认分别为 4096 和 512。'
        )
      },
      returns: t('The segment array.', '路径段数组。'),
      example: `parseConfigPath('a.b.c') // ['a', 'b', 'c']`
    },
    patchConfig: {
      role: 'operation',
      purpose: t(
        'Derives a new owned configuration by applying `patch` copy-on-write; `CONFIG_DELETE` removes a key. Unchanged branches are shared; `base` is not modified.',
        '以写时复制方式应用 `patch`，派生新的已拥有配置；`CONFIG_DELETE` 用于删除键。未修改的分支共享引用，`base` 不会被修改。'
      ),
      params: {
        base: t('Owned configuration to start from.', '作为起点的已拥有配置。'),
        patch: t(
          'Root fields to replace as whole values; nested objects are not merged. `CONFIG_DELETE` deletes a root field.',
          '逐个整体替换的根字段；不合并嵌套对象，`CONFIG_DELETE` 表示删除根字段。'
        )
      },
      returns: t(
        'A new owned configuration (or `base` itself for an empty patch).',
        '新的已拥有配置（补丁为空时直接返回 `base`）。'
      ),
      options: 'IConfigPatchOptions',
      example: `import { CONFIG_DELETE, patchConfig } from '@migaia/utils/config'

const next = patchConfig(config, { retries: 3, debug: CONFIG_DELETE })`
    },
    readConfigPath: {
      role: 'operation',
      purpose: t(
        'Reads a nested value of an owned configuration and tells a missing key apart from a value that is `undefined`. Objects come back as read-only views.',
        '读取已拥有配置中的嵌套值，并能区分“键不存在”与“值为 `undefined`”。对象类型的值以只读视图返回。'
      ),
      params: {
        config: t('Owned configuration.', '已拥有的配置。'),
        path: t('Dot path or segment array.', '点路径或路径段数组。')
      },
      returns: t(
        '`{ kind: "value", value }` or `{ kind: "missing" }`.',
        '取到值时为 `{ kind: "value", value }`，键不存在时为 `{ kind: "missing" }`。'
      ),
      example: `readConfigPath(config, 'retry.attempts') // { kind: 'value', value: 2 }`
    },
    readonlyConfig: {
      role: 'operation',
      purpose: t(
        'Returns a read-only view of an owned configuration: reading works, but any write at any depth (assignment, delete, `Map.set`, `Date.setFullYear`, ...) throws `CONFIG_READONLY`. The same view is returned for the same configuration.',
        '返回已拥有配置的只读视图：可以正常读取，但任何层级的写入（赋值、删除、`Map.set`、`Date.setFullYear` 等）都会抛 `CONFIG_READONLY`。同一份配置总是返回同一个视图。'
      ),
      params: { value: t('Owned configuration.', '已拥有的配置。') },
      returns: t('A read-only view; no copy is made.', '只读视图，不会复制数据。'),
      example: `export const settings = readonlyConfig(config)`
    },
    attachErrorIdentity: {
      role: 'operation',
      purpose: t(
        'Adds non-writable `source`, `code`, optional `phase` and `detail` fields to an existing error without wrapping or replacing it. Re-attaching the same values is a no-op; different existing values throw `ERROR_IDENTITY_CONFLICT` unless `hooks` decide.',
        '为已有错误对象添加不可写的 `source`、`code`，以及可选的 `phase`、`detail` 字段，不包装也不替换原错误。重复附加相同的值不会产生变化；已有不同的值时抛 `ERROR_IDENTITY_CONFLICT`，除非由 `hooks` 决定如何处理。'
      ),
      params: {
        error: t('The error object to label.', '要附加身份的错误对象。'),
        identity: t(
          '`{ source, code, phase?, detail? }`.',
          '身份信息 `{ source, code, phase?, detail? }`。'
        ),
        hooks: t(
          '`onConflict` / `onFailure` choose a replacement object when a field clashes or cannot be defined.',
          '`onConflict` / `onFailure` 在字段冲突或无法定义时，选择用来替代的对象。'
        )
      },
      returns: t(
        'The same error (or the replacement chosen by a hook).',
        '同一个错误对象（或钩子选择的替代对象）。'
      ),
      example: `throw attachErrorIdentity(new Error('请求失败'), { source: 'my-app', code: 'FETCH_FAILED' })`
    },
    attachSecondaryErrors: {
      role: 'operation',
      purpose: t(
        'Attaches secondary failures (for example cleanup errors) to a primary error without changing the primary identity. If the primary cannot be extended, an `AggregateError` whose first entry is the primary is returned instead.',
        '把次要失败（例如清理错误）附加到主要错误上，不改变主要错误的身份。主要错误无法扩展时，改为返回一个首项为主要错误的 `AggregateError`。'
      ),
      params: {
        primary: t('The main failure.', '主要失败。'),
        secondaryErrors: t('Additional failures, in order.', '按顺序排列的附加失败。')
      },
      returns: t(
        'The primary (now carrying the secondaries) or a fallback `AggregateError`.',
        '附加了次要失败的主要错误，或作为后备的 `AggregateError`。'
      ),
      example: `throw attachSecondaryErrors(primary, cleanupErrors)`
    },
    combineErrors: {
      role: 'operation',
      purpose: t(
        'Combines failures: none gives `undefined`, one is returned (normalised with `toError`), several become an `AggregateError(errors, message)`.',
        '合并多个失败：没有失败返回 `undefined`；只有一个时原样返回（经 `toError` 规整）；多个时合并为 `AggregateError(errors, message)`。'
      ),
      params: {
        errors: t('Failures to combine.', '要合并的失败集合。'),
        message: t(
          'Message of the `AggregateError` when several are combined.',
          '合并为 `AggregateError` 时使用的错误信息。'
        )
      },
      returns: t(
        '`undefined`, the single error, or an `AggregateError`.',
        '`undefined`、单个错误或 `AggregateError`。'
      ),
      example: `const failure = combineErrors(results.filter(isRejected).map((r) => r.reason), '部分请求失败')
if (failure) throw failure`
    },
    deserializeErrorChain: {
      role: 'operation',
      optionDocs: normalizeOptionDocs,
      purpose: t(
        'Validates an untrusted serialized error tree (from a worker, process or network) and rebuilds native errors from it, keeping native types such as `TypeError` and the remote stacks.',
        '校验来自 worker、进程或网络的不可信序列化错误树，并据此重建原生错误，保留 `TypeError` 等原生类型以及远端的调用栈。'
      ),
      params: {
        value: t('Received data.', '接收到的数据。'),
        strategy: t(
          'Field whitelist, limits, extensions and restoration hooks of the boundary.',
          '该边界的字段白名单、上限、扩展与还原钩子。'
        ),
        options: t(
          '`unknownFields: "reject" | "ignore"` and `onUnknownField`.',
          '`unknownFields: "reject" | "ignore"` 以及 `onUnknownField` 回调。'
        )
      },
      returns: t(
        'A native `Error` graph; invalid input throws a violation error.',
        '一个原生 `Error` 图；输入不合法时抛出违规错误。'
      ),
      example: `const error = deserializeErrorChain(message.error)`
    },
    isNativeErrorValue: {
      role: 'operation',
      purpose: t(
        'Tells whether a value belongs to the native Error family by its prototype chain, also across realms, without calling its methods. A diagnostic shape check, not authentication.',
        '依据原型链判断某个值是否属于原生 Error 家族，也适用于跨 realm 的值，且不会调用它的方法。它只是诊断用的形状检查，不能用于认证。'
      ),
      params: { value: t('Any value.', '要检查的任意值。') },
      returns: t(
        '`true` for Error-family values; uninspectable proxies return `false`.',
        'Error 家族的值返回 `true`；无法检查的 Proxy 返回 `false`。'
      ),
      example: `if (isNativeErrorValue(failure)) console.log(failure.stack)`
    },
    isUtilsAbortError: {
      role: 'operation',
      purpose: t(
        'Type guard for `UtilsAbortError` (cancellation by a signal).',
        '`UtilsAbortError` 的类型守卫，用来判断操作是否因信号中止而被取消。'
      ),
      params: { value: t('A caught value.', '捕获到的值。') },
      returns: t('`true` when the operation was cancelled.', '操作是被取消的时返回 `true`。'),
      example: `if (isUtilsAbortError(error)) return // 用户取消，不算失败`
    },
    isUtilsError: {
      role: 'operation',
      purpose: t(
        'Diagnostic guard for an error-like shape with utils `source` and a registered utils `code`. It does not require local `instanceof Error` and does not authenticate the origin.',
        '诊断类型守卫：检查错误形状、工具包 `source` 与已登记的 `code`。不要求本地 `instanceof Error`，也不能认证真实来源。'
      ),
      params: { value: t('A caught value.', '捕获到的值。') },
      returns: t('`true` for errors of this package.', '是本包的错误时返回 `true`。'),
      example: `if (isUtilsError(error)) console.log(error.code)`
    },
    isUtilsTimeoutError: {
      role: 'operation',
      purpose: t(
        'Type guard for `UtilsTimeoutError` (a deadline passed).',
        '`UtilsTimeoutError` 的类型守卫，用来判断操作是否因超过截止时间而失败。'
      ),
      params: { value: t('A caught value.', '捕获到的值。') },
      returns: t(
        '`true` when a deadline was exceeded; read `scope` and `timeoutMs`.',
        '超过截止时间时返回 `true`；可读取 `scope` 和 `timeoutMs`。'
      ),
      example: `if (isUtilsTimeoutError(error)) console.log(error.scope, error.timeoutMs)`
    },
    normalizeSerializedErrorChain: {
      role: 'operation',
      optionDocs: normalizeOptionDocs,
      purpose: t(
        'Validates and freezes a received serialized error tree without rebuilding errors; use it when the boundary forwards the tree.',
        '校验并冻结接收到的序列化错误树，但不重建错误对象；适用于只需转发该错误树的边界。'
      ),
      params: {
        value: t('Received data.', '接收到的数据。'),
        strategy: t('Boundary strategy (whitelist, limits).', '边界策略（白名单、上限）。'),
        options: t('Unknown-field handling.', '未知字段的处理方式。')
      },
      returns: t(
        'A frozen `ISerializedErrorChain`.',
        '校验通过并已冻结的 `ISerializedErrorChain`。'
      ),
      example: `const tree = normalizeSerializedErrorChain(payload.error)`
    },
    reachErrorChain: {
      role: 'operation',
      optionDocs: chainReportOptionDocs,
      purpose: t(
        'Walks every value reachable through `cause` and `errors` (depth first, each object once), without the serialization depth limit.',
        '深度优先地遍历通过 `cause` 与 `errors` 可达的每一个值（每个对象只访问一次），不受序列化深度上限限制。'
      ),
      params: {
        value: t('Starting error.', '起始错误。'),
        strategy: t('Which fields to follow.', '要沿哪些字段遍历。'),
        options: t(
          '`report` receives property read failures instead of throwing.',
          '`report` 接收属性读取失败，而不是直接抛出。'
        )
      },
      returns: t(
        'A generator of reachable values, starting with `value`.',
        '可达值的生成器，以 `value` 本身开头。'
      ),
      example: `for (const node of reachErrorChain(error)) if (node === original) found = true`
    },
    safeErrorReason: {
      role: 'operation',
      purpose: t(
        'Reads a human-readable reason from any failure once, returning `fallback` when nothing safe can be read.',
        '从任意失败中只读取一次可读的原因文本；读不到安全的文本时返回 `fallback`。'
      ),
      params: {
        error: t('Any failure.', '任意失败值。'),
        fallback: t('Text to use when no message can be read.', '读不到信息时使用的文本。')
      },
      returns: t('The message or the fallback.', '错误信息或后备文本。'),
      example: `console.warn(safeErrorReason(error, '未知错误'))`
    },
    sanitizeErrorText: {
      role: 'operation',
      purpose: t(
        'Replaces lone surrogates and limits text to a UTF-8 byte budget, as error serialization does for every text field.',
        '替换孤立的代理项，并把文本限制在 UTF-8 字节预算内，与错误序列化对每个文本字段的处理一致。'
      ),
      params: {
        value: t('Text to clean.', '要清理的文本。'),
        maxBytes: t('Byte budget; default 4096.', '字节预算，默认 4096。'),
        truncate: t('Whether to cut text over the budget.', '超出预算时是否截断。')
      },
      returns: t(
        '`{ value, bytes, changed }`.',
        '`{ value, bytes, changed }`，`changed` 表示文本被修改过。'
      ),
      example: `sanitizeErrorText(message, 1024, true).value`
    },
    serializeErrorChain: {
      role: 'operation',
      optionDocs: chainReportOptionDocs,
      purpose: t(
        'Turns any thrown value into a bounded, frozen, JSON-safe error tree (`source`, `code`, `name`, `message`, `stack`, `cause`, `errors`, `data`) for crossing worker, process or network boundaries.',
        '把任意抛出值转换为有界、冻结、可 JSON 化的错误树（`source`、`code`、`name`、`message`、`stack`、`cause`、`errors`、`data`），用于跨越 worker、进程或网络边界。'
      ),
      params: {
        value: t('Thrown value.', '抛出的值。'),
        strategy: t(
          'Field whitelist, limits, redaction and extensions.',
          '字段白名单、上限、脱敏与扩展。'
        ),
        options: t('`report` receives property read failures.', '`report` 接收属性读取失败。')
      },
      returns: t(
        'An `ISerializedErrorChain`; oversized trees are cut and marked `truncated`.',
        '一个 `ISerializedErrorChain`；超限的部分会被截断并标记 `truncated`。'
      ),
      example: `port.postMessage({ error: serializeErrorChain(error) })`
    },
    toError: {
      role: 'operation',
      optionDocs: {
        message: {
          summary: t(
            'Caller-selected wrapper message used only when the input is not already error-shaped.',
            '调用方选定的包装消息，仅当输入不具备错误形状时使用。'
          ),
          default: t(
            'A thrown string is its own message; other values use `UtilsErrorText.nonErrorValue`.',
            '抛出的字符串直接作为消息，其他值使用 `UtilsErrorText.nonErrorValue`。'
          )
        }
      },
      purpose: t(
        'Normalises a thrown value to an error-like value: error-shaped objects are returned unchanged, including cross-realm objects; other values get an Error wrapper with the original on `cause` (`NON_ERROR_VALUE`). Local `instanceof Error` is not guaranteed.',
        '把抛出值规整为类错误值：具备错误形状的对象（含跨域对象）原样返回，其余值包装为错误并由 `cause` 保留（`NON_ERROR_VALUE`）。不保证通过本地 `instanceof Error`。'
      ),
      params: {
        value: t('Thrown value.', '抛出的值。'),
        options: t(
          '`message` overrides the derived message (a thrown string is used as message by default).',
          '`message` 覆盖自动推导的信息（默认抛出的字符串会作为信息）。'
        )
      },
      returns: t(
        'The same error-shaped object, or a native Error wrapper.',
        '原有类错误对象，或原生错误包装对象。'
      ),
      example: `catch (value) { report(toError(value)) }`
    },
    tryReadProperty: {
      role: 'operation',
      purpose: t(
        'Reads one property exactly once; when a getter or proxy throws, the thrown value is returned instead of propagating, so the caller chooses the policy.',
        '只读取一次属性；getter 或 Proxy 抛错时，不向外传播，而是把抛出值作为结果返回，由调用方决定如何处理。'
      ),
      params: {
        target: t('Object to read.', '要读取的对象。'),
        key: t('Property key to read.', '要读取的属性键。')
      },
      returns: t(
        '`{ threw: false, value }` or `{ threw: true, error }`.',
        '成功时为 `{ threw: false, value }`，抛错时为 `{ threw: true, error }`。'
      ),
      example: `const read = tryReadProperty(signal, 'reason')
if (read.threw) report(read.error)`
    },
    UtilsErrorCode: {
      role: 'constant',
      purpose: t(
        'Table of the stable error codes of this package (`source: "@migaia/utils"`); compare `error.code` with these keys instead of matching messages.',
        '本包稳定错误码的对照表（`source: "@migaia/utils"`）；用这些键比较 `error.code`，不要匹配错误信息文本。'
      ),
      example: `if (error.code === UtilsErrorCode.deadlineExceeded) showRetry()`
    },
    UtilsAbortError: {
      role: 'error',
      returns: t(
        'A UtilsAbortError extending Error with name AbortError, code ABORTED and the supplied reason retained as cause; this is not a native DOMException.',
        '返回继承原生错误的工具中止错误，带中止名称、稳定中止码，并把传入原因保留为原因属性；它不是原生域异常。'
      ),
      purpose: t(
        'Error thrown when a signal cancelled an operation of this package (`name: "AbortError"`, code `ABORTED`); the abort reason is kept on `cause`.',
        '本包的操作被信号取消时抛出的错误（`name: "AbortError"`，错误码 `ABORTED`）；中止原因保存在 `cause` 上。'
      ),
      params: { reason: t('Abort reason stored on `cause`.', '保存到 `cause` 上的中止原因。') },
      example: `throw new UtilsAbortError('用户取消')`
    },
    UtilsError: {
      role: 'error',
      params: {
        code: t(
          'Stable IUtilsErrorCode chosen by the subclass from UtilsErrorCode.',
          '子类从工具错误码表中选择的稳定工具错误码。'
        ),
        message: t(
          'Subclass-supplied concrete message forwarded to the native Error constructor.',
          '子类提供、转交原生错误构造器的具体消息文本。'
        )
      },
      returns: t(
        'The constructed subclass Error with utils source, selected code and optional original cause. UtilsError is abstract and its protected constructor cannot be invoked directly by ordinary consumers.',
        '返回附有工具包来源、所选错误码及可选原始原因的子类错误；此类为抽象类，其受保护构造器不能由普通消费方直接调用。'
      ),
      optionDocs: {
        cause: {
          summary: t(
            'Original failure passed through the protected base constructor to the native Error cause property.',
            '通过受保护基类构造函数传入原生错误原因属性的原始失败。'
          ),
          default: t(
            'Omitted: no original cause is supplied by the base constructor.',
            '省略时基类构造函数不提供原始原因。'
          )
        }
      },
      purpose: t(
        'Abstract base class of every error class of this package; carries `source: "@migaia/utils"` and a stable `code`.',
        '本包所有错误类的抽象基类，带有 `source: "@migaia/utils"` 和稳定的 `code`，可用 `instanceof` 统一识别。'
      ),
      example: `if (error instanceof UtilsError) console.log(error.code)`
    },
    UtilsTimeoutError: {
      role: 'error',
      returns: t(
        'A UtilsTimeoutError extending Error with name TimeoutError and code DEADLINE_EXCEEDED; scope and timeoutMs retain the supplied values. Construction does not run a timer.',
        '返回继承原生错误的工具超时错误，带超时名称与稳定截止超限码；范围及毫秒数保留传入值，构造不启动计时器。'
      ),
      purpose: t(
        'Error thrown when a deadline passed (`name: "TimeoutError"`, code `DEADLINE_EXCEEDED`); `scope` tells whether one operation, one retry attempt or the whole retry timed out.',
        '超过截止时间时抛出的错误（`name: "TimeoutError"`，错误码 `DEADLINE_EXCEEDED`）；`scope` 说明超时的是一次操作、一次重试尝试还是整个重试过程。'
      ),
      params: {
        scope: t(
          'operation identifies one bounded operation, attempt one retry attempt, and total the complete retry budget.',
          '`operation` 表示单次有界操作，`attempt` 表示一次重试尝试，`total` 表示完整重试预算。'
        ),
        timeoutMs: t('The deadline that passed, in milliseconds.', '被超过的截止时间，单位毫秒。')
      },
      example: `throw new UtilsTimeoutError('operation', 500)`
    },
    walkErrorCauses: {
      role: 'operation',
      optionDocs: {
        maxDepth: {
          summary: t(
            'Largest inclusive recursion depth followed through cause and aggregate errors; the starting value is depth zero.',
            '沿原因与聚合错误遍历的最大包含深度；起始值深度为零。'
          ),
          default: t(
            '`32`: visit nodes from depth zero through depth thirty-two, deduplicating identities.',
            '`32`：访问深度零至三十二的节点，并按身份去重。'
          )
        }
      },
      purpose: t(
        'Lists an error and everything reachable through `cause` and `AggregateError.errors`, each value once.',
        '列出某个错误以及通过 `cause` 与 `AggregateError.errors` 可达的所有值，每个值只出现一次。'
      ),
      params: {
        error: t('Starting error.', '起始错误。'),
        options: t(
          '`maxDepth` limits how deep to follow; default 32.',
          '`maxDepth` 限制最大遍历深度，默认 32。'
        )
      },
      returns: t(
        'The visited values, starting with `error`.',
        '访问到的值列表，以 `error` 本身开头。'
      ),
      example: `walkErrorCauses(error).some((node) => node === networkError)`
    },
    assimilateCapturedThen: {
      role: 'operation',
      purpose: t(
        'Turns an already captured `then` method into a native Promise by calling it once with the original thenable as `this`; a synchronous throw becomes a rejection.',
        '把已捕获的 `then` 方法转换为原生 Promise：以原 thenable 为 `this` 调用一次；同步抛错会变成 reject。'
      ),
      params: {
        thenFn: t(
          'The `then` function captured by `probeThenable()`.',
          '由 `probeThenable()` 捕获的 `then` 函数。'
        ),
        thenable: t('The object it was read from.', '读取该方法时所在的对象。')
      },
      returns: t('A Promise settled by the thenable.', '由该 thenable 结算的 Promise。'),
      example: `const probe = probeThenable(result)
if (probe.kind === 'thenable') await assimilateCapturedThen(probe.thenFn, result)`
    },
    inspectThenable: {
      role: 'operation',
      purpose: t(
        'Reads a callback result `then` once to enforce a synchronous contract: the result says whether it is a thenable, or holds the getter error.',
        '只读取一次回调返回值的 `then`，用于检查“必须同步返回”的约定：结果说明它是否为 thenable，或保存 getter 抛出的错误。'
      ),
      params: { value: t('A callback result.', '回调的返回值。') },
      returns: t(
        'A captured callable `then`, a retained getter `error`, or a result without a callable `then`; do not depend on an exact absent-property object shape.',
        '包含已捕获的可调用 `then`、保留的读取错误 `error`，或没有可调用 `then` 的结果；不要依赖缺失属性结果的精确对象形状。'
      ),
      example: `const inspection = inspectThenable(hookResult)
if ('then' in inspection && inspection.then) throw new TypeError('钩子必须同步返回')`
    },
    MAX_NATIVE_RECURSION_DEPTH: {
      role: 'constant',
      purpose: t(
        'Maximum synchronous re-entry depth (256) before libraries such as event-subscriber and middleware-pipeline move work off the native stack.',
        '同步重入的最大深度（256）；超过后 event-subscriber、middleware-pipeline 等库会把工作移出原生调用栈。'
      ),
      example: `if (depth > MAX_NATIVE_RECURSION_DEPTH) queueMicrotask(next)`
    },
    noop: {
      role: 'operation',
      purpose: t(
        'A function that does nothing and returns `undefined`; a stable default callback.',
        '什么也不做、返回 `undefined` 的函数，可作为稳定的默认回调。'
      ),
      returns: t('Always `undefined`.', '始终返回 `undefined`。'),
      example: `const onChange = options.onChange ?? noop`
    },
    observeThenableRejection: {
      role: 'operation',
      purpose: t(
        'Calls `onRejected` when a captured thenable rejects (or with the inspection error), sending synchronous failures of `onRejected` itself to the shared host exception queue. The captured thenable rejection remains observed.',
        '在已捕获的 thenable 被拒绝时（或检查本身出错时）调用 `onRejected`，并把 `onRejected` 自身的同步失败交给共享宿主异常队列；已捕获的异步拒绝仍被观察。'
      ),
      params: {
        value: t('The callback result.', '回调的返回值。'),
        inspection: t(
          'Result of `inspectThenable(value)`.',
          '先前对同一个值调用 `inspectThenable(value)` 得到的结果。'
        ),
        onRejected: t('Receives the rejection reason.', '接收拒绝原因的函数。')
      },
      example: `observeThenableRejection(result, inspectThenable(result), (error) => report(error))`
    },
    once: {
      role: 'operation',
      purpose: t(
        'Wraps a synchronous function so it runs once; later calls return the cached result or rethrow the cached error. Re-entering before the first call returned throws `REENTRANT_CALL`. Each `once()` call has its own cache.',
        '包装同步函数，使其只执行一次；之后的调用返回缓存的结果，或重新抛出缓存的错误。首次调用尚未返回时再次进入会抛 `REENTRANT_CALL`。每次调用 `once()` 都会创建独立的缓存。'
      ),
      params: { functionValue: t('The function to run once.', '只需执行一次的函数。') },
      returns: t('A wrapper with the same signature.', '签名相同的包装函数。'),
      example: `export const getRegistry = once(() => buildRegistry())`
    },
    onceAsync: {
      role: 'operation',
      purpose: t(
        'Wraps a function returning `PromiseLike<T>` so it starts once; every caller shares one native `Promise<T>`, including a rejection (no automatic retry).',
        '包装返回 `PromiseLike<T>` 的函数，使其只启动一次；所有调用者共享同一个原生 `Promise<T>`，拒绝结果也会共享（不会自动重试）。'
      ),
      params: { functionValue: t('Async function to start once.', '只需启动一次的异步函数。') },
      returns: t('A function returning the shared Promise.', '返回共享 Promise 的函数。'),
      example: `export const loadConfig = onceAsync(() => fetch('/config').then((r) => r.json()))`
    },
    probeThenable: {
      role: 'operation',
      purpose: t(
        'Reads `value.then` exactly once and tells whether the value is a thenable, keeping a getter failure as data.',
        '只读取一次 `value.then`，判断该值是否为 thenable，并把 getter 抛出的错误作为数据保留。'
      ),
      params: { value: t('Any value.', '要检查的任意值。') },
      returns: t(
        '`{ kind: "not-thenable" }`, `{ kind: "thenable", thenFn }` or `{ kind: "failed", error }`.',
        '不是 thenable 时为 `{ kind: "not-thenable" }`，是时为 `{ kind: "thenable", thenFn }`，读取失败时为 `{ kind: "failed", error }`。'
      ),
      example: `const probe = probeThenable(value)
if (probe.kind === ThenableProbeKind.failed) report(probe.error)`
    },
    ThenableProbeKind: {
      role: 'constant',
      purpose: t(
        'Kinds returned by `probeThenable()`.',
        '`probeThenable()` 返回结果中 `kind` 字段的全部取值，用于区分三种探测结果。'
      ),
      example: `if (probe.kind === ThenableProbeKind.thenable) await assimilateCapturedThen(probe.thenFn, value)`
    },
    createNumberFormatter: {
      role: 'factory',
      purpose: t(
        'Creates a reusable formatter so loops (tables, market data) parse the options once instead of per value.',
        '创建可复用的格式化函数，让循环（表格、行情数据）只解析一次选项，而不是每个值都解析。'
      ),
      returns: t(
        'A function `(value) => string`; invalid locales or options throw `NUMBER_FORMAT_INVALID`.',
        '一个函数 `(value) => string`；locale 或选项不合法时抛 `NUMBER_FORMAT_INVALID`。'
      ),
      options: 'INumberFormatOptions',
      example: `const price = createNumberFormatter({ locales: 'zh-CN', format: { minimumFractionDigits: 2 } })
rows.map((row) => price(row.amount))`
    },
    formatCompactNumber: {
      role: 'operation',
      purpose: t(
        'Formats large values with compact notation such as `1.2K` or `3.4M`, following the locale.',
        '用紧凑记数法格式化大数值，例如 `1.2万` 或 `1.2K`，具体写法取决于语言区域。'
      ),
      params: { value: t('Number or bigint to format.', '要格式化的数字或 bigint。') },
      returns: t('The formatted text.', '格式化后的文本。'),
      options: 'INumberFormatOptions',
      example: `formatCompactNumber(12345, { locales: 'zh-CN' }) // '1.2万'`
    },
    formatCurrency: {
      role: 'operation',
      purpose: t(
        'Formats money in the given currency; rounding policy stays with the caller.',
        '按指定币种格式化金额；舍入规则由调用方决定。'
      ),
      params: {
        value: t('Amount.', '金额数值。'),
        currency: t(
          'ISO 4217 code such as `CNY` or `USD`.',
          'ISO 4217 币种代码，例如 `CNY`、`USD`。'
        )
      },
      returns: t('The formatted text.', '格式化后的文本。'),
      options: 'INumberFormatOptions',
      example: `formatCurrency(1234.5, 'CNY', { locales: 'zh-CN' }) // '¥1,234.50'`
    },
    formatInteger: {
      role: 'operation',
      purpose: t(
        'Formats whole numbers (no fraction digits unless overridden).',
        '把数值格式化为整数形式（默认不显示小数，可通过选项覆盖）。'
      ),
      params: { value: t('Number or bigint to format.', '要格式化的数字或 bigint。') },
      returns: t('The formatted text.', '格式化后的文本。'),
      options: 'INumberFormatOptions',
      example: `formatInteger(1234567.8) // '1,234,568'`
    },
    formatNumber: {
      role: 'operation',
      purpose: t(
        'Formats one number or bigint with the given locale and `Intl` options, reusing cached formatters.',
        '用指定的 locale 与 `Intl` 选项格式化一个数字或 bigint，并复用缓存的格式器。'
      ),
      params: { value: t('Number or bigint to format.', '要格式化的数字或 bigint。') },
      returns: t('The formatted text.', '格式化后的文本。'),
      options: 'INumberFormatOptions',
      example: `formatNumber(1234.5, { locales: 'de-DE' }) // '1.234,5'`
    },
    formatPercent: {
      role: 'operation',
      purpose: t(
        'Formats a ratio as a percentage (`0.25` → `25%`).',
        '把比例数值格式化为本地化的百分比文本，例如 `0.25` 显示为 `25%`。'
      ),
      params: { value: t('Ratio.', '比例数值。') },
      returns: t('The formatted text.', '格式化后的文本。'),
      options: 'INumberFormatOptions',
      example: `formatPercent(0.256, { format: { maximumFractionDigits: 1 } }) // '25.6%'`
    },
    createSafeRecord: {
      role: 'factory',
      purpose: t(
        'Creates an empty dictionary without a prototype, so untrusted keys such as `__proto__` are stored as data and cannot trigger prototype setters.',
        '创建没有原型的空字典，`__proto__` 之类的不可信键会被当作普通数据保存，不会触发原型上的 setter。'
      ),
      returns: t('A null-prototype object.', '一个原型为 `null` 的对象。'),
      example: `const counts = createSafeRecord<number>()
counts[userInput] = (counts[userInput] ?? 0) + 1`
    },
    diagnosticSnapshot: {
      role: 'operation',
      purpose: t(
        'Best-effort deep copy: copies plain objects, arrays and clonable values, keeps unsupported leaves (functions, class instances) by reference, and lists every such path in `diagnostics` so callers know what is still shared.',
        '尽力而为的深拷贝：复制普通对象、数组和可克隆的值；不支持的叶子（函数、类实例）保留原引用，并在 `diagnostics` 中列出每个这样的路径，让调用方知道哪些仍然共享。'
      ),
      params: { value: t('Value to copy.', '要复制的值。') },
      returns: t(
        '`{ value, diagnostics }`; non-empty diagnostics mean the copy is not fully isolated.',
        '`{ value, diagnostics }`；`diagnostics` 非空表示副本没有完全隔离。'
      ),
      example: `const { value, diagnostics } = diagnosticSnapshot(payload)
if (diagnostics.length) logger.warn(diagnostics)`
    },
    identitySnapshot: {
      role: 'operation',
      purpose: t(
        'Returns the value itself. Use it only as the explicit zero-copy option of a configurable snapshot policy, meaning the caller accepts shared references.',
        '原样返回传入的值。只在可配置的快照策略中作为“零拷贝”选项使用，表示调用方接受共享引用。'
      ),
      params: { value: t('Any value; it is returned unchanged.', '要原样返回的任意值。') },
      returns: t('The same value.', '同一个值。'),
      example: `const snapshot = trusted ? identitySnapshot : immutableSnapshot`
    },
    immutableSnapshot: {
      role: 'operation',
      purpose: t(
        'Deep-copies a value with the host `structuredClone` (keeps cycles, shared references, `Date`, `Map`, `Set`, typed arrays). The copy is detached from the source but not frozen. All or nothing: unsupported members throw `CLONE_UNSUPPORTED`.',
        '用宿主的 `structuredClone` 深拷贝一个值（保留循环引用、共享引用、`Date`、`Map`、`Set` 与类型化数组）。副本与源对象断开引用，但不会被冻结。要么全部成功、要么失败：有不支持的成员时抛 `CLONE_UNSUPPORTED`。'
      ),
      params: { value: t('Value to copy.', '要复制的值。') },
      returns: t(
        'The independent copy; a host without `structuredClone` throws `ENV_UNSUPPORTED`.',
        '独立的副本；宿主没有 `structuredClone` 时抛 `ENV_UNSUPPORTED`。'
      ),
      example: `const fixture = immutableSnapshot(source)`
    },
    isPlainObject: {
      role: 'operation',
      purpose: t(
        'Checks for an object whose prototype is null or whose prototype has a null parent; this is not an equality check against local `Object.prototype`.',
        '检查对象的原型是否为空，或该原型的父原型是否为空；不是与本地 `Object.prototype` 作等值检查。'
      ),
      params: { value: t('Any value.', '要检查的任意值。') },
      returns: t(
        '`true` for `{}` and null-prototype objects; arrays and class instances return `false`.',
        '`{}` 与无原型对象返回 `true`；数组与类实例返回 `false`。'
      ),
      example: `isPlainObject(new Date()) // false`
    },
    probeProperty: {
      role: 'operation',
      purpose: t(
        'Reads a property once and tells a missing key apart from a failing getter, so a getter error is never mistaken for a default value.',
        '只读取一次属性，并区分“键不存在”与“getter 出错”，避免把 getter 的错误误当作缺省值。'
      ),
      params: {
        value: t('Object to read.', '要读取的对象。'),
        key: t('Property key to read.', '要读取的属性键。')
      },
      returns: t(
        '`{ kind: "value", value }`, `{ kind: "missing" }` or `{ kind: "failed", error }`.',
        '取到值时为 `{ kind: "value", value }`，键不存在时为 `{ kind: "missing" }`，读取出错时为 `{ kind: "failed", error }`。'
      ),
      example: `const result = probeProperty<string>(user, 'profile')
if (result.kind === 'failed') console.error(result.error)`
    },
    snapshotOwnDescriptors: {
      role: 'operation',
      purpose: t(
        'Captures the own property descriptors of a value at most once, containing revoked-proxy and trap failures; primitives give an empty snapshot.',
        '最多一次地捕获某个值的自有属性描述符，并拦截被撤销的 Proxy 或拦截器的失败；原始值返回空快照。'
      ),
      params: { value: t('Any value.', '要捕获的任意值。') },
      returns: t(
        '`{ kind: "captured", descriptors }` or a failed result with the error.',
        '`{ kind: "captured", descriptors }`，或带错误的失败结果。'
      ),
      example: `const snapshot = snapshotOwnDescriptors(options)
if (snapshot.ok) console.log(Object.keys(snapshot.descriptors))`
    },
    structuredDiagnosticSnapshot: {
      role: 'operation',
      purpose: t(
        'Tries a full `structuredClone` first; if it fails, falls back to `diagnosticSnapshot` and records the root failure. Use it when one bad field must not lose the whole telemetry record.',
        '先尝试完整的 `structuredClone`；失败时退回 `diagnosticSnapshot` 的逐项处理，并记录根级克隆失败。适用于不能因为一个坏字段而丢失整份遥测数据的场景。'
      ),
      params: { value: t('Value to copy.', '要复制的值。') },
      returns: t(
        '`{ value, diagnostics }`; empty diagnostics mean a fully isolated copy.',
        '`{ value, diagnostics }`；诊断为空表示副本完全隔离。'
      ),
      example: `const { value } = structuredDiagnosticSnapshot(event)`
    },
    createPathAccessor: {
      role: 'factory',
      purpose: t(
        'Creates a stateful reader/writer for one root object: `set` writes immutably and moves `value` to the new root, and hooks observe missing, blocked or failing paths and can replace read or written values.',
        '为一个根对象创建有状态的读写器：`set` 以不可变方式写入并把 `value` 更新为新根；钩子可以观察缺失、被阻断或读取失败的路径，并可替换读取或写入的值。'
      ),
      params: { object: t('Initial root object.', '初始根对象。') },
      returns: t('An `IPathAccessor`.', '一个路径读写器 `IPathAccessor`。'),
      options: 'IPathAccessorOptions',
      example: `const accessor = createPathAccessor({ count: 0 })
accessor.set('count', 5)
accessor.value // { count: 5 }`
    },
    get: {
      role: 'operation',
      purpose: t(
        'Reads a nested value by dot path or segment tuple.',
        '按点路径或路径段元组读取嵌套对象中的值，任一段缺失时返回 `undefined`。'
      ),
      params: {
        object: t('Root object to read or write.', '要读写的根对象。'),
        path: t(
          '`"user.tags.[0]"` or `["user", "tags", 0]`.',
          '要读取的路径，例如 `"user.tags.[0]"` 或 `["user", "tags", 0]`。'
        )
      },
      returns: t(
        'The value, or `undefined` when any segment is missing.',
        '读取到的值；任何路径段缺失时为 `undefined`。'
      ),
      example: `get(data, 'user.name') // 'Ada'`
    },
    parseObjectPath: {
      role: 'operation',
      purpose: t(
        'Parses a dot path into segments (`[n]` becomes a number). Rejects `__proto__`, `prototype`, `constructor` and oversized paths (`OBJECT_PATH_INVALID`).',
        '把点路径解析为路径段（`[n]` 解析为数字）。拒绝 `__proto__`、`prototype`、`constructor` 以及超长路径（`OBJECT_PATH_INVALID`）。'
      ),
      params: { path: t('String or segment tuple.', '字符串路径或路径段元组。') },
      returns: t('The segment tuple.', '路径段元组。'),
      example: `parseObjectPath('user.tags.[0]') // ['user', 'tags', 0]`
    },
    probeObjectPath: {
      role: 'operation',
      purpose: t(
        'Reads a path and explains the outcome: value, missing, blocked (a non-object on the way) or failed (a getter threw).',
        '读取路径并说明结果：取到值、缺失、被阻断（中途遇到非对象）或失败（getter 抛错）。'
      ),
      params: {
        object: t('Root object to read or write.', '要读写的根对象。'),
        path: t('Path to read.', '要读取的路径。')
      },
      returns: t(
        'An `IPathProbe` with `kind` and location details.',
        '带 `kind` 与位置信息的 `IPathProbe`。'
      ),
      example: `const probe = probeObjectPath(data, 'user.address.city')
if (probe.kind === 'blocked') console.warn('在', probe.failedKey, '处中断')`
    },
    probeObjectPathSegments: {
      role: 'operation',
      purpose: t(
        'Same as `probeObjectPath` for an already parsed segment tuple, skipping parsing.',
        '与 `probeObjectPath` 相同，但接收已解析的路径段元组，跳过解析步骤。'
      ),
      params: {
        object: t('Root object to read or write.', '要读写的根对象。'),
        segments: t(
          'Parsed tuple returned by `parseObjectPath()`; strings are not accepted.',
          '由 `parseObjectPath()` 返回的已解析元组；不接受字符串。'
        )
      },
      returns: t('An `IPathProbe`.', '一个路径探测结果 `IPathProbe`。'),
      example: `const segments = parseObjectPath('user.name')
probeObjectPathSegments(data, segments)`
    },
    set: {
      role: 'operation',
      purpose: t(
        'Writes a nested value without mutating the input: copies the objects along the path, shares untouched branches, and returns the new root (the same root when the value is unchanged by `Object.is`). The result is not frozen.',
        '写入嵌套值且不修改输入：复制路径上的对象、共享未改动的分支，并返回新根（值按 `Object.is` 未变化时返回原根）。结果不会被冻结。'
      ),
      params: {
        object: t('Root object to read or write.', '要读写的根对象。'),
        path: t('Path to write.', '要写入的路径。'),
        nextValue: t('Value to write.', '要写入的值。')
      },
      returns: t('The new root object.', '新的根对象。'),
      example: `const next = set(data, 'user.name', 'Grace')
next.settings === data.settings // true，未修改的分支共享`
    },
    admitAbortSignal: {
      role: 'operation',
      purpose: t(
        'Checks an untrusted signal-shaped value with one read of `aborted`, without throwing or subscribing; failures are returned as data so the caller applies its own error policy.',
        '用一次对 `aborted` 的读取检查不可信的“类信号”值，不抛错也不订阅；失败作为数据返回，由调用方套用自己的错误策略。'
      ),
      params: { candidate: t('Value passed as a signal.', '作为信号传入的值。') },
      returns: t(
        '`{ kind: "valid", signal, aborted }` or `{ kind: "invalid", reason, cause? }` with `reason` one of `not-object`, `aborted-not-boolean`, `aborted-threw`, `listener-not-function`.',
        '`{ kind: "valid", signal, aborted }`，或 `{ kind: "invalid", reason, cause? }`，其中 `reason` 为 `not-object`、`aborted-not-boolean`、`aborted-threw`、`listener-not-function` 之一。'
      ),
      example: `const admission = admitAbortSignal(options.signal)
if (admission.kind === 'invalid') throw new TypeError('signal 无效')`
    },
    createAbortTimeoutSignal: {
      role: 'factory',
      purpose: t(
        'Combines an outside signal and a deadline into one signal, without owning any Promise settlement. Pass the signal to several requests of one transaction and call `dispose()` when done.',
        '把外部信号与截止时间组合成一个信号，但不负责任何 Promise 的结算。把这个信号传给同一事务中的多个请求，完成后调用 `dispose()`。'
      ),
      returns: t(
        '`{ signal, dispose }`; without `timeoutMs` the outside signal is returned unchanged.',
        '`{ signal, dispose }`；未设置 `timeoutMs` 时原样返回外部信号。'
      ),
      options: 'IAbortTimeoutSignalOptions',
      example: `const deadline = createAbortTimeoutSignal({ signal: request.signal, timeoutMs: 500 })
try {
  await Promise.all([loadUser(deadline.signal), loadOrders(deadline.signal)])
} finally {
  deadline.dispose()
}`
    },
    createConcurrencyLimiter: {
      role: 'factory',
      optionDocs: {
        concurrency: {
          summary: t(
            'Caller-selected positive safe integer limiting simultaneously active tasks; queued tasks remain FIFO.',
            '调用方指定的正安全整数，限制同时执行的任务数；排队任务保持先入先出。'
          )
        },
        report: {
          summary: reportText,
          default: t(
            '`hostRethrowReporter`: surface late failures by rethrowing them in a host microtask.',
            '`hostRethrowReporter`：在宿主微任务中重新抛出迟到失败。'
          ),
          params: {
            error: t(
              'Original late failure delivered by the limiter.',
              '限制器传入的原始迟到失败。'
            ),
            context: t(
              'Limiter-supplied operation and phase metadata for this failure.',
              '限制器提供的此次失败所属操作和阶段元数据。'
            )
          },
          returns: t(
            'No value is consumed; the supplied reporter owns its diagnostic handling.',
            '不使用返回值；提供的上报器负责其诊断处理。'
          )
        }
      },
      purpose: t(
        'Creates a gate that runs at most `concurrency` tasks at once; extra tasks wait in FIFO order and can be cancelled while queued.',
        '创建一个并发闸门，同时最多运行 `concurrency` 个任务；其余任务按先进先出排队，排队期间可以单独取消。'
      ),
      params: {
        options: t(
          '`concurrency` (required, positive safe integer): maximum running tasks. `report` (optional): receives late failures; default `hostRethrowReporter`.',
          '`concurrency`（必填，正的安全整数）：同时运行的最大任务数。`report`（可选）：接收迟到的失败，默认 `hostRethrowReporter`。'
        )
      },
      returns: t('An `IConcurrencyLimiter`.', '一个并发限制器 `IConcurrencyLimiter`。'),
      example: `const limiter = createConcurrencyLimiter({ concurrency: 4 })
await Promise.all(urls.map((url) => limiter.run(({ signal }) => fetch(url, { signal }))))
await limiter.dispose()`
    },
    deferred: {
      role: 'factory',
      purpose: t(
        'Creates a Promise together with its `resolve` and `reject` functions. Prefer the native `Promise.withResolvers()` when the runtime supports it.',
        '创建一个 Promise 以及它的 `resolve`、`reject` 函数。运行时支持时，优先使用原生的 `Promise.withResolvers()`。'
      ),
      returns: t(
        '`{ promise, resolve, reject }`.',
        '包含 `promise`、`resolve`、`reject` 的 `IDeferred` 对象。'
      ),
      example: `const ready = deferred<void>()
socket.addEventListener('open', () => ready.resolve(), { once: true })
await ready.promise`
    },
    hostRethrowReporter: {
      role: 'constant',
      purpose: t(
        'Default reporter of the promise helpers: rethrows a late failure on a microtask so the host error handler sees it instead of it being lost.',
        'promise 系列函数的默认上报函数：在微任务中重新抛出迟到的失败，让宿主的全局错误处理看到它，而不是被吞掉。'
      ),
      example: `withTimeout(operation, { timeoutMs: 100, report: (error, context) => logger.warn(context.operation, error) })`
    },
    raceWithAbort: {
      role: 'operation',
      optionDocs: {
        signal: asyncControlMembers.signal!,
        signals: asyncControlMembers.signals!,
        report: promiseReportOption,
        cleanupPolicy: {
          summary: t(
            'How listener-removal failures affect the winning operation result.',
            '移除取消监听器失败时，如何处理已经胜出的操作结果。'
          ),
          default: t(
            '`reject`: cleanup failures reject the wrapper.',
            '`reject`：清理失败会使包装后的操作拒绝。'
          ),
          values: {
            reject: t(
              'Reject with cleanup failures, preserving the primary failure first when present.',
              '以清理错误拒绝，存在主错误时将其保留在汇总列表首位。'
            ),
            report: t(
              'Report cleanup failures and retain the original operation outcome.',
              '报告清理错误，保留原本的操作结果或失败。'
            )
          }
        }
      },
      purpose: t(
        'Runs `operation` and rejects as soon as an outside signal aborts (no deadline). The operation receives a signal to stop its own work; a late result after abort goes to `report`.',
        '执行 `operation`，外部信号一旦中止就立即 reject（不设截止时间）。操作会收到一个信号用来停止自己的工作；中止后才到达的结果交给 `report`。'
      ),
      params: {
        operation: t(
          '`({ signal }) => value | Promise`; called immediately.',
          '`({ signal }) => value | Promise`，会被立即调用。'
        ),
        options: t(
          '`signal` or `signals` (mutually exclusive); `report` (default `hostRethrowReporter`); `cleanupPolicy`: `reject` (default) rejects when removing listeners fails, `report` only reports it.',
          '`signal` 或 `signals`（二者互斥）；`report`（默认 `hostRethrowReporter`）；`cleanupPolicy`：`reject`（默认）在移除监听失败时 reject，`report` 只上报。'
        )
      },
      returns: t(
        'The operation result; rejects with `UtilsAbortError` when aborted first.',
        '操作的结果；先被中止时以 `UtilsAbortError` reject。'
      ),
      example: `await raceWithAbort(({ signal }) => fetch(url, { signal }), { signal: controller.signal })`
    },
    retry: {
      role: 'operation',
      purpose: t(
        'Runs `operation` again after failures, one attempt at a time, until it succeeds, `shouldRetry` says no, or `maxAttempts` is reached. Supports a delay between attempts, a per-attempt timeout and a total timeout.',
        '在失败后逐次重新执行 `operation`，直到成功、`shouldRetry` 返回否，或达到 `maxAttempts`。支持两次尝试之间的等待、单次尝试超时和总超时。'
      ),
      params: {
        operation: t(
          '`({ attempt, signal, remainingMs }) => value | Promise`.',
          '每次尝试调用的函数 `({ attempt, signal, remainingMs }) => value | Promise`，收到本次尝试的序号、信号与剩余时间。'
        ),
        options: t(
          '`maxAttempts` (required); `shouldRetry(error, context)` (required); `delay` ms or `(error, context) => ms` (default 0); `attemptTimeoutMs`; `totalTimeoutMs`; `signal` / `signals`; `zeroTimeoutBehavior`; `report`; `unref`; `scheduler`.',
          '`maxAttempts`（必填）；`shouldRetry(error, context)`（必填）；`delay`：毫秒数或 `(error, context) => 毫秒`（默认 0）；`attemptTimeoutMs`；`totalTimeoutMs`；`signal` / `signals`；`zeroTimeoutBehavior`；`report`；`unref`；`scheduler`。'
        )
      },
      returns: t(
        'The first successful result; otherwise the last failure (or `UtilsTimeoutError` with scope `attempt` / `total`).',
        '第一次成功的结果；否则为最后一次失败（或 `scope` 为 `attempt` / `total` 的 `UtilsTimeoutError`）。'
      ),
      example: `await retry(() => fetchJson(url), {
  maxAttempts: 3,
  shouldRetry: (error) => !isUtilsAbortError(error),
  delay: (_error, { attempt }) => attempt * 200
})`
    },
    sleep: {
      role: 'operation',
      options: 'IAsyncControls',
      purpose: t(
        'Waits `delayMs` milliseconds; can be cancelled by a signal.',
        '异步等待 `delayMs` 毫秒后继续；等待期间可以被信号取消并提前结束。'
      ),
      params: {
        delayMs: t('Finite, non-negative milliseconds.', '有限、非负的毫秒数。'),
        options: t(
          '`signal` / `signals`, `scheduler` (default `systemScheduler`), `unref`.',
          '可选的取消与计时设置：`signal` / `signals`、`scheduler`（默认 `systemScheduler`）、`unref`。'
        )
      },
      returns: t(
        'Resolves after the delay; rejects with `UtilsAbortError` when cancelled.',
        '等待结束后 resolve；被取消时以 `UtilsAbortError` reject。'
      ),
      example: `await sleep(1000, { signal: controller.signal })`
    },
    toPromise: {
      role: 'operation',
      purpose: t(
        'Runs `run` immediately and returns its result as a Promise; a synchronous throw becomes a rejection, and a native Promise is returned as is.',
        '立即执行 `run` 并以 Promise 形式返回结果；同步抛错会变成 reject，返回原生 Promise 时原样返回。'
      ),
      params: { run: t('Function to call now.', '立即调用的函数。') },
      returns: t('A Promise of the result.', '包装执行结果的 Promise。'),
      example: `const value = await toPromise(() => cache.get('key'))`
    },
    withTimeout: {
      role: 'operation',
      optionDocs: {
        ...asyncControlMembers,
        timeoutMs: {
          summary: t(
            'Caller-selected finite, non-negative deadline budget in milliseconds.',
            '调用方指定的截止时间预算，必须是有限且非负的毫秒数。'
          )
        },
        report: {
          ...promiseReportOption,
          summary: t(
            'Receives late operation rejections after another outcome won; late success is discarded. Timer and listener cleanup failures surface through the returned rejection or aggregate, rather than this late-rejection callback.',
            '接收其他结果胜出后的迟到操作拒绝；迟到成功值会丢弃。定时器与监听清理失败通过返回的拒绝或聚合暴露，而非这个迟到拒绝回调。'
          )
        },
        cooperativeCancellation: {
          summary: t(
            'Whether the operation receives an internal abort signal cancelled by timeout or external abort.',
            '操作是否接收内部取消信号，该信号会在超时或外部取消时中止。'
          ),
          default: t(
            '`true`: provide the internal abort signal.',
            '`true`：向操作提供内部取消信号。'
          )
        },
        zeroTimeoutBehavior: {
          summary: t(
            'Whether a zero budget skips the operation or starts it before the zero-delay deadline fires.',
            '零预算时，是跳过操作还是先启动操作再等待零延时截止计时器。'
          ),
          default: t(
            '`skip`: reject immediately without starting the operation.',
            '`skip`：立即拒绝，不启动该操作。'
          ),
          values: {
            skip: t(
              'Reject a zero budget before calling the operation.',
              '零预算时在调用操作之前就拒绝。'
            ),
            start: t(
              'Start the operation with a zero-delay deadline; an immediately settled operation may win.',
              '启动操作并设置零延时截止时间；立即确定结果的操作可能先完成。'
            )
          }
        }
      },
      purpose: t(
        'Runs `operation` with a deadline: the Promise rejects with `UtilsTimeoutError` (scope `operation`) when `timeoutMs` passes, and the operation signal aborts so cooperative code can stop. Late rejection goes to `report`; late success is discarded. Cleanup failures surface through rejection or aggregation.',
        '为 `operation` 设置截止时间：超过 `timeoutMs` 时 Promise 以 `UtilsTimeoutError`（`scope` 为 `operation`）reject，同时操作收到的信号中止，协作式代码可以据此停止。迟到拒绝交给 `report`；迟到成功值丢弃，清理失败通过拒绝或聚合暴露。'
      ),
      params: {
        operation: t(
          'Function run under the deadline: `({ signal }) => value | Promise`; the signal aborts on timeout.',
          '要限时执行的函数 `({ signal }) => value | Promise`，超时时 signal 会中止。'
        ),
        options: t(
          '`timeoutMs` (required, finite ≥ 0); cancellation, scheduler and reporter controls; `zeroTimeoutBehavior` chooses whether a zero budget skips or starts the operation under a zero-delay deadline.',
          '`timeoutMs`（必填，有限且不小于 0）；取消、调度与上报设置；`zeroTimeoutBehavior` 决定零预算时跳过操作，还是先启动操作并设置零延时截止时间。'
        )
      },
      returns: t(
        'The operation result, or a rejection with `UtilsTimeoutError` / `UtilsAbortError`.',
        '操作的结果，或以 `UtilsTimeoutError` / `UtilsAbortError` reject。'
      ),
      example: `await withTimeout(({ signal }) => fetch('/api', { signal }), { timeoutMs: 2000 })`
    },
    createManualScheduler: {
      role: 'factory',
      purpose: t(
        'Creates a deterministic scheduler for tests: virtual time only moves with `advance(ms)`. Intended for this repository tests and adapter checks; other projects should prefer their test framework fake timers.',
        '创建用于测试的确定性调度器：虚拟时间只随 `advance(ms)` 推进。供本仓库测试与适配器验证使用；其它项目应优先使用测试框架自带的假计时器。'
      ),
      returns: t('An `IManualScheduler`.', '一个手动调度器 `IManualScheduler`。'),
      example: `import { createManualScheduler } from '@migaia/utils/testing'

const scheduler = createManualScheduler()
scheduler.schedule(() => console.log('到期'), 100)
scheduler.advance(100)`
    },
    deferTask: {
      role: 'operation',
      purpose: t(
        'Schedules a callback through the scheduler `defer` capability when it has one, otherwise through `schedule(callback, 0)`. The system scheduler uses native microtask order.',
        '如果调度器提供 `defer`，就用它安排回调；否则改用 `schedule(callback, 0)`。系统调度器使用原生微任务顺序。'
      ),
      params: {
        scheduler: t('An `IScheduler`.', '一个调度器 `IScheduler`。'),
        callback: t('Work to run later.', '稍后执行的工作。')
      },
      example: `deferTask(systemScheduler, () => flush())`
    },
    systemScheduler: {
      role: 'constant',
      purpose: t(
        'Default scheduler: `now()` reads `performance.now()` (monotonic milliseconds, not epoch time) and `schedule()` uses native timers. Delays beyond the timer limit are split automatically.',
        '默认调度器：`now()` 读取 `performance.now()`（单调毫秒数，不是纪元时间），`schedule()` 使用宿主原生计时器。超过计时器上限的延时会自动分段等待。'
      ),
      example: `const started = systemScheduler.now()
const task = systemScheduler.schedule(() => console.log(systemScheduler.now() - started), 50)`
    },
    systemWallClock: {
      role: 'constant',
      purpose: t(
        'Epoch clock: `timestamp()` returns `Date.now()`. Use it for diagnostic timestamps only, never for deadlines.',
        '纪元时钟：`timestamp()` 返回 `Date.now()`。只用于诊断时间戳，不要用于计算截止时间。'
      ),
      example: `log({ at: systemWallClock.timestamp() })`
    },
    format: {
      role: 'operation',
      purpose: t(
        'Fills `{path}` placeholders of a template from a values object (nested paths read own properties only). Missing values are kept as placeholders by default; doubled delimiters output a literal delimiter.',
        '用值对象填充模板中的 `{path}` 占位符（嵌套路径只读取自有属性）。默认缺失的值保留占位符原样；连写两个边界字符可输出字面边界字符。'
      ),
      params: {
        source: t('Template text.', '模板文本。'),
        values: t('Object providing placeholder values.', '提供占位符取值的对象。')
      },
      returns: t(
        'The filled text; bad templates throw `FORMAT_INVALID`, missing values in `throw` mode `FORMAT_VALUE_MISSING`.',
        '填充后的文本；模板不合法抛 `FORMAT_INVALID`，`throw` 模式下缺值抛 `FORMAT_VALUE_MISSING`。'
      ),
      options: 'IFormatOptions',
      example: `format('你好，{user.name}', { user: { name: 'Ada' } }) // '你好，Ada'`
    },
    tryString: {
      role: 'operation',
      purpose: t(
        'Converts a value to text once with native `String()`, keeping strings unchanged; a throwing conversion is returned as data instead of propagating.',
        '用原生 `String()` 把值转换为文本一次，字符串原样保留；转换抛错时不向外传播，而是作为数据返回。'
      ),
      params: { value: t('Any value.', '要转换的任意值。') },
      returns: t(
        '`{ threw: false, value }` or `{ threw: true, error }`.',
        '成功时为 `{ threw: false, value }`，抛错时为 `{ threw: true, error }`。'
      ),
      example: `const converted = tryString(value)
const text = converted.threw ? '[无法显示]' : converted.value`
    },
    isBlankString: {
      role: 'operation',
      purpose: t(
        'Tells whether a value is a string that is empty or only whitespace; other types return `false`.',
        '判断某个值是否为空字符串或只含空白的字符串；其它类型返回 `false`。'
      ),
      params: { value: t('Any value.', '要检查的任意值。') },
      returns: t('`true` for `""` and `"  "`.', '空字符串 `""` 与纯空白 `"  "` 返回 `true`。'),
      example: `isBlankString('  ') // true`
    },
    isEmptyValue: {
      role: 'operation',
      purpose: t(
        'Detects form-style emptiness: `null`, `undefined`, blank strings and `NaN`. `0`, `0n`, `false`, arrays and objects count as real values.',
        '判断表单意义上的“空”：`null`、`undefined`、空白字符串和 `NaN`。`0`、`0n`、`false`、数组和对象都算有值。'
      ),
      params: { value: t('Any value.', '要检查的任意值。') },
      returns: t('`true` for empty values.', '是空值时返回 `true`。'),
      example: `isEmptyValue(0) // false`
    },
    isNullish: {
      role: 'operation',
      purpose: t(
        'Tells whether a value is `null` or `undefined` only (other falsy values are kept).',
        '判断值是否为空引用：只在值为 `null` 或 `undefined` 时返回 `true`（`0`、空字符串等其它假值不算）。'
      ),
      params: { value: t('Any value.', '要检查的任意值。') },
      returns: t('`true` for `null` / `undefined`.', '值为 `null` 或 `undefined` 时返回 `true`。'),
      example: `isNullish(0) // false`
    },
    isPrimitive: {
      role: 'operation',
      purpose: t(
        'Tells whether a value is one of the seven JavaScript primitives (functions are objects).',
        '判断某个值是否为 JavaScript 七种原始类型之一（函数属于对象）。'
      ),
      params: { value: t('Any value.', '要检查的任意值。') },
      returns: t('`true` for primitives.', '原始类型返回 `true`。'),
      example: `isPrimitive(Symbol('x')) // true`
    },
    isSafeIntegerValue: {
      role: 'operation',
      purpose: t(
        'Tells whether a value is a number that is a safe integer, without converting strings or bigints.',
        '判断某个值是否为安全整数的 number，不会转换字符串或 bigint。'
      ),
      params: { value: t('Any value.', '要检查的任意值。') },
      returns: t('`true` for safe integer numbers.', '安全整数时返回 `true`。'),
      example: `isSafeIntegerValue('3') // false`
    }
  },
  types: {
    ICollector: {
      summary: t(
        'The lazy query returned by `collect()`. Chained calls describe the query; `result` runs it once and caches it.',
        '`collect()` 返回的惰性查询。链式调用只描述查询，读取 `result` 时才执行一次并缓存。'
      ),
      scenarios: collectorScenarios,
      example: collectorExample,
      members: collectorMembers
    },
    IFieldCollector: {
      summary: t(
        'A collector after `fieldBy()`: adds field matching with `like`, `equals`, `oneOf`.',
        '调用 `fieldBy()` 之后的筛选器：增加 `like`、`equals`、`oneOf` 字段匹配。'
      ),
      scenarios: collectorScenarios,
      example: collectorExample,
      members: {
        ...collectorMembers,
        like: {
          summary: t(
            'Keeps items whose candidate fields contain `query` (strings only, case-insensitive; an empty trimmed query does nothing).',
            '保留候选字段包含 `query` 的元素（只匹配字符串、不区分大小写；去除空白后为空则不做筛选）。'
          ),
          params: { query: t('Text to search for.', '要搜索的文本。') },
          returns: t('The field collector.', '同一个字段筛选器。'),
          example: `.like(' world ')`
        },
        equals: {
          summary: t(
            'Keeps items where a candidate field equals `value`.',
            '保留候选字段等于 `value` 的元素。'
          ),
          params: { value: t('Value to compare with.', '要比较的值。') },
          returns: t('The field collector.', '同一个字段筛选器。'),
          example: `.equals('Ada')`
        },
        oneOf: {
          summary: t(
            'Keeps items where a candidate field equals any of the given values.',
            '保留候选字段等于给定值之一的元素。'
          ),
          params: {
            value: t('First accepted value.', '第一个可接受的值。'),
            values: t('More accepted values.', '更多可接受的值。')
          },
          returns: t('The field collector.', '同一个字段筛选器。'),
          example: `.oneOf('draft', 'review')`
        }
      }
    },
    IConfigCombineOptions: {
      scenarios: [
        t(
          'Keep both default and user-supplied menu entries by declaring array concatenation options for combineConfig().',
          '合并默认菜单与用户菜单时，用这个选项类型指定数组前后拼接。'
        )
      ],
      example: t(
        `/** Keep both default and user-supplied menu entries by declaring array concatenation options for combineConfig(). */
import { combineConfig, ownConfig, type IConfigCombineOptions } from '@migaia/utils/config'
const menuOptions: IConfigCombineOptions = { strategies: { array: 'concat' } }
const menu = combineConfig([
  ownConfig({ items: ['home'] }),
  ownConfig({ items: ['help'] })
], menuOptions)
console.log(menu.items)`,
        `/** 合并默认菜单与用户菜单时，用这个选项类型指定数组前后拼接。 */
import { combineConfig, ownConfig, type IConfigCombineOptions } from '@migaia/utils/config'
const menuOptions: IConfigCombineOptions = { strategies: { array: 'concat' } }
const menu = combineConfig([
  ownConfig({ items: ['home'] }),
  ownConfig({ items: ['help'] })
], menuOptions)
console.log(menu.items)`
      ),
      summary: t(
        'Options of `combineConfig()`.',
        '`combineConfig()` 的选项：合并策略、按路径规则与冲突裁决。'
      ),
      members: {
        strategies: {
          summary: t(
            'How each value kind merges when both sides have it (record, array, map, set, undefined).',
            '两侧都有值时各类值的合并方式（对象、数组、Map、Set、undefined）。'
          ),
          default: t(
            '`record: merge`, `array: replace`, `map: replace`, `set: replace`, `undefined: ignore`.',
            '默认策略为 `record: merge`、`array: replace`、`map: replace`、`set: replace`、`undefined: ignore`。'
          )
        },
        'strategies.record': {
          summary: t('How two objects at the same path merge.', '同一路径上的两个对象如何合并。'),
          default: t('`merge`.', '`merge`：逐键合并。'),
          values: {
            merge: t('Merge keys recursively.', '逐键递归合并。'),
            replace: t('The later object replaces the earlier.', '后者整体替换前者。')
          }
        },
        'strategies.array': {
          summary: t('How two arrays at the same path merge.', '同一路径上的两个数组如何合并。'),
          default: t('`replace`.', '`replace`：后者整体替换。'),
          values: {
            replace: t('The later array replaces the earlier.', '后者整体替换前者。'),
            concat: t('Concatenate earlier then later.', '前者在前、后者在后拼接。'),
            mergeByIndex: t(
              'Merge element by element at the same index.',
              '按相同下标逐个元素合并。'
            )
          }
        },
        'strategies.map': {
          summary: t('How two `Map` values merge.', '两个 `Map` 如何合并。'),
          default: t('`replace`.', '`replace`：后者整体替换。'),
          values: {
            replace: t('Later replaces earlier.', '后者整体替换前者。'),
            merge: t('Merge entries by key.', '按键合并条目。')
          }
        },
        'strategies.set': {
          summary: t('How two `Set` values merge.', '两个 `Set` 如何合并。'),
          default: t('`replace`.', '`replace`：后者整体替换。'),
          values: {
            replace: t('Later replaces earlier.', '后者整体替换前者。'),
            union: t('Union of both sets.', '取两个集合的并集。')
          }
        },
        'strategies.undefined': {
          summary: t('What a later `undefined` does.', '后者的值为 `undefined` 时如何处理。'),
          default: t('`ignore`.', '`ignore`：忽略，保留前者。'),
          values: {
            ignore: t('Keep the earlier value.', '保留前者的值。'),
            assign: t('Write `undefined`.', '写入 `undefined`。')
          }
        },
        pathRules: {
          summary: t(
            'Strategy overrides for path prefixes; the longest matching prefix wins.',
            '针对路径前缀覆盖合并策略；匹配最长前缀的规则生效。'
          ),
          default: t(
            'Not set: global strategies apply everywhere.',
            '不设置：所有路径都使用全局策略。'
          )
        },
        onConflict: {
          summary: t(
            'Decides values that cannot be merged: return `{ kind: "left" | "right" | "delete" }` or `{ kind: "value", value }`, synchronously.',
            '裁决无法合并的冲突值：同步返回 `{ kind: "left" | "right" | "delete" }` 或 `{ kind: "value", value }`。'
          ),
          default: t('Not set: the later (right) value wins.', '不设置：后者（右侧）的值胜出。')
        },
        profile: {
          summary: t(
            'Validation profile of the result; must match the sources.',
            '结果使用的校验档位，必须与来源一致。'
          ),
          default: t(
            'The first source profile, or `data` when sources are empty.',
            '继承第一个来源的档位；没有来源时使用 `data`。'
          ),
          values: { enum: 'ConfigProfile' }
        },
        limits: {
          summary: t('Tighter size limits for the result.', '为结果设置更严格的规模上限。'),
          default: t(
            'The per-field minimum across source limits and package defaults.',
            '各项分别取来源上限与包级默认上限的最小值。'
          )
        }
      }
    },
    IConfigConflictContext: {
      scenarios: [
        t(
          'Read the conflicting path in a merge callback to protect the default port while accepting other overrides.',
          '合并配置时，把冲突回调参数写成这个类型，按冲突路径保留默认端口。'
        )
      ],
      example: t(
        `/** Read the conflicting path in a merge callback to protect the default port while accepting other overrides. */
import { combineConfig, ownConfig, type IConfigConflictContext } from '@migaia/utils/config'
const settings = combineConfig([ownConfig({ port: 8080 }), ownConfig({ port: 9000 })], {
  onConflict: (conflict: IConfigConflictContext) =>
    conflict.path[0] === 'port' ? { kind: 'left' } : { kind: 'right' }
})
console.log(settings.port)`,
        `/** 合并配置时，把冲突回调参数写成这个类型，按冲突路径保留默认端口。 */
import { combineConfig, ownConfig, type IConfigConflictContext } from '@migaia/utils/config'
const settings = combineConfig([ownConfig({ port: 8080 }), ownConfig({ port: 9000 })], {
  onConflict: (conflict: IConfigConflictContext) =>
    conflict.path[0] === 'port' ? { kind: 'left' } : { kind: 'right' }
})
console.log(settings.port)`
      ),
      summary: t('Argument of `onConflict`.', '`onConflict` 回调收到的冲突信息：路径与两侧的值。'),
      members: {
        path: { summary: t('Path of the conflicting values.', '发生冲突的值所在的路径。') },
        left: {
          summary: t(
            'Earlier (left, lower priority) value.',
            '前者（左侧）的值，即优先级较低的来源。'
          )
        },
        right: {
          summary: t(
            'Later (right, higher priority) value.',
            '后者（右侧）的值，即优先级较高的来源。'
          )
        }
      }
    },
    IConfigConflictDecision: {
      scenarios: [
        t(
          'Give a conflict resolver an explicit return type when replacing two different timeout values with one application-selected value.',
          '需要把冲突的超时值统一成应用指定值时，用这个类型声明裁决函数的返回值。'
        )
      ],
      example: t(
        `/** Give a conflict resolver an explicit return type when replacing two different timeout values with one application-selected value. */
import { combineConfig, ownConfig, type IConfigConflictDecision } from '@migaia/utils/config'
function chooseTimeout(): IConfigConflictDecision {
  return { kind: 'value', value: 1500 }
}
const settings = combineConfig([ownConfig({ timeout: 1000 }), ownConfig({ timeout: 2000 })], {
  onConflict: chooseTimeout
})
console.log(settings.timeout)`,
        `/** 需要把冲突的超时值统一成应用指定值时，用这个类型声明裁决函数的返回值。 */
import { combineConfig, ownConfig, type IConfigConflictDecision } from '@migaia/utils/config'
function chooseTimeout(): IConfigConflictDecision {
  return { kind: 'value', value: 1500 }
}
const settings = combineConfig([ownConfig({ timeout: 1000 }), ownConfig({ timeout: 2000 })], {
  onConflict: chooseTimeout
})
console.log(settings.timeout)`
      ),
      summary: t(
        'Caller-authored return of the configuration conflict hook, selecting an existing side, deletion or an explicit replacement.',
        '配置冲突钩子由调用方编写的返回值，选择已有一侧、删除或显式替换。'
      ),
      members: {
        kind: {
          summary: t(
            'Conflict decision discriminant: keep left, keep right, delete the key or use an explicit value.',
            '冲突决策判别值：保留左值、保留右值、删除键或使用显式值。'
          ),
          values: {
            left: t(
              'Keep the earlier lower-priority input at this conflict.',
              '本次冲突保留较早、优先级较低的输入。'
            ),
            right: t(
              'Keep the later higher-priority input at this conflict.',
              '本次冲突保留较后、优先级较高的输入。'
            ),
            delete: t(
              'Remove the conflicting key from the combined configuration.',
              '从合并配置中删除这个发生冲突的键。'
            ),
            value: t(
              'Use the replacement carried by this decision’s value field.',
              '使用此决策的值字段携带的替换结果。'
            )
          }
        },
        value: {
          summary: t(
            'Caller-selected replacement present only when kind is value; it is admitted under the chosen configuration profile.',
            '仅显式值分支存在的调用方替换结果；按所选配置档位接纳。'
          )
        }
      }
    },
    IConfigLimits: {
      scenarios: [
        t(
          'Keep a complete size policy in a typed variable before passing it to ownConfig() for a small settings document.',
          '接收小型设置文档时，用这个类型保存完整的规模上限，再交给 ownConfig()。'
        )
      ],
      example: t(
        `/** Keep a complete size policy in a typed variable before passing it to ownConfig() for a small settings document. */
import { ownConfig, type IConfigLimits } from '@migaia/utils/config'
const settingsLimits: IConfigLimits = {
  maxDepth: 8, maxNodes: 100, maxKeys: 1000,
  maxPathLength: 256, maxSegmentLength: 64
}
const settings = ownConfig({ display: { scale: 2 } }, { limits: settingsLimits })
console.log(settings.display.scale)`,
        `/** 接收小型设置文档时，用这个类型保存完整的规模上限，再交给 ownConfig()。 */
import { ownConfig, type IConfigLimits } from '@migaia/utils/config'
const settingsLimits: IConfigLimits = {
  maxDepth: 8, maxNodes: 100, maxKeys: 1000,
  maxPathLength: 256, maxSegmentLength: 64
}
const settings = ownConfig({ display: { scale: 2 } }, { limits: settingsLimits })
console.log(settings.display.scale)`
      ),
      summary: t(
        'Safety limits of owned configuration; options can only tighten them.',
        '已拥有配置的安全上限；选项只能收紧，不能放宽。'
      ),
      members: {
        maxDepth: {
          summary: t('Maximum nesting depth; default 256.', '值图允许的最大嵌套深度，默认 256。')
        },
        maxNodes: {
          summary: t(
            'Maximum objects in the graph; default 100000.',
            '值图中对象的最大数量，默认 100000。'
          )
        },
        maxKeys: {
          summary: t(
            'Maximum keys in total; default 1000000.',
            '整个值图中键的总数上限，默认 1000000。'
          )
        },
        maxPathLength: {
          summary: t('Maximum path text length; default 4096.', '路径文本的最大长度，默认 4096。')
        },
        maxSegmentLength: {
          summary: t(
            'Maximum length of one path segment; default 512.',
            '单个路径段的最大长度，默认 512。'
          )
        }
      }
    },
    IConfigMergeStrategies: {
      scenarios: [
        t(
          'Store one complete merge policy for application settings so records merge while arrays are replaced.',
          '为应用配置保存一份完整合并策略，明确对象逐键合并、数组整体替换。'
        )
      ],
      example: t(
        `/** Store one complete merge policy for application settings so records merge while arrays are replaced. */
import { combineConfig, ownConfig, type IConfigMergeStrategies } from '@migaia/utils/config'
const settingsStrategies: IConfigMergeStrategies = {
  record: 'merge', array: 'replace', map: 'replace', set: 'replace', undefined: 'ignore'
}
const settings = combineConfig([
  ownConfig({ display: { theme: 'light' }, pages: ['home'] }),
  ownConfig({ display: { scale: 2 }, pages: ['help'] })
], { strategies: settingsStrategies })
console.log(settings)`,
        `/** 为应用配置保存一份完整合并策略，明确对象逐键合并、数组整体替换。 */
import { combineConfig, ownConfig, type IConfigMergeStrategies } from '@migaia/utils/config'
const settingsStrategies: IConfigMergeStrategies = {
  record: 'merge', array: 'replace', map: 'replace', set: 'replace', undefined: 'ignore'
}
const settings = combineConfig([
  ownConfig({ display: { theme: 'light' }, pages: ['home'] }),
  ownConfig({ display: { scale: 2 }, pages: ['help'] })
], { strategies: settingsStrategies })
console.log(settings)`
      ),
      summary: t('Merge strategy per value kind.', '两侧都有值时各类值使用的合并策略。'),
      members: {
        record: {
          summary: t(
            'Objects: `merge` or `replace`.',
            '同一路径上两个对象的合并方式：`merge` 或 `replace`。'
          ),
          values: {
            merge: t('Merge keys.', '逐键合并。'),
            replace: t('Later replaces.', '后者整体替换。')
          }
        },
        array: {
          summary: t(
            'Arrays: `replace`, `concat` or `mergeByIndex`.',
            '同一路径上两个数组的合并方式：`replace`、`concat` 或 `mergeByIndex`。'
          ),
          values: {
            replace: t('Later replaces.', '后者整体替换。'),
            concat: t('Concatenate.', '前后拼接。'),
            mergeByIndex: t('Merge by index.', '按下标合并。')
          }
        },
        map: {
          summary: t(
            'Maps: `replace` or `merge`.',
            '同一路径上两个 Map 的合并方式：`replace` 或 `merge`。'
          ),
          values: {
            replace: t('Later replaces.', '后者整体替换。'),
            merge: t('Merge entries.', '按键合并。')
          }
        },
        set: {
          summary: t(
            'Sets: `replace` or `union`.',
            '同一路径上两个 Set 的合并方式：`replace` 或 `union`。'
          ),
          values: {
            replace: t('Later replaces.', '后者整体替换。'),
            union: t('Union.', '取并集。')
          }
        },
        undefined: {
          summary: t(
            'A later `undefined`: `ignore` or `assign`.',
            '后来的来源值为 `undefined` 时的处理：`ignore` 或 `assign`。'
          ),
          values: {
            ignore: t('Keep earlier.', '保留前者。'),
            assign: t('Write undefined.', '写入 `undefined`。')
          }
        }
      }
    },
    IConfigPatch: {
      ...alias(
        'Patch accepted by `patchConfig()`: partial values plus `CONFIG_DELETE`.',
        '`patchConfig()` 接受的补丁：部分取值，外加用于删除的 `CONFIG_DELETE`。'
      ),
      scenarios: [
        t(
          'Type a saved settings edit as a partial patch, using CONFIG_DELETE to remove an obsolete field.',
          '保存设置编辑结果时，用补丁类型表示局部修改，并用 CONFIG_DELETE 删除不再需要的字段。'
        )
      ],
      example: t(
        `/** Type a saved settings edit as a partial patch, using CONFIG_DELETE to remove an obsolete field. */
import { CONFIG_DELETE, ownConfig, patchConfig, type IConfigPatch } from '@migaia/utils/config'
type IPreferences = { theme: string; legacyColor?: string }
const preferences = ownConfig<IPreferences>({ theme: 'light', legacyColor: 'blue' })
const edit: IConfigPatch<IPreferences> = { theme: 'dark', legacyColor: CONFIG_DELETE }
const updated = patchConfig(preferences, edit)
console.log(updated.theme, updated.legacyColor)`,
        `/** 保存设置编辑结果时，用补丁类型表示局部修改，并用 CONFIG_DELETE 删除不再需要的字段。 */
import { CONFIG_DELETE, ownConfig, patchConfig, type IConfigPatch } from '@migaia/utils/config'
type IPreferences = { theme: string; legacyColor?: string }
const preferences = ownConfig<IPreferences>({ theme: 'light', legacyColor: 'blue' })
const edit: IConfigPatch<IPreferences> = { theme: 'dark', legacyColor: CONFIG_DELETE }
const updated = patchConfig(preferences, edit)
console.log(updated.theme, updated.legacyColor)`
      )
    },
    IConfigPatchOptions: {
      scenarios: [
        t(
          'Choose a fresh root for an empty patch when a caller needs a separate configuration object.',
          '调用方需要独立配置对象时，用这个选项类型关闭空补丁的根对象复用。'
        )
      ],
      example: t(
        `/** Choose a fresh root for an empty patch when a caller needs a separate configuration object. */
import { ownConfig, patchConfig, type IConfigPatchOptions } from '@migaia/utils/config'
const copyOptions: IConfigPatchOptions = { reuseUnchangedRoot: false }
const original = ownConfig({ theme: 'light' })
const copy = patchConfig(original, {}, copyOptions)
console.log(copy === original)`,
        `/** 调用方需要独立配置对象时，用这个选项类型关闭空补丁的根对象复用。 */
import { ownConfig, patchConfig, type IConfigPatchOptions } from '@migaia/utils/config'
const copyOptions: IConfigPatchOptions = { reuseUnchangedRoot: false }
const original = ownConfig({ theme: 'light' })
const copy = patchConfig(original, {}, copyOptions)
console.log(copy === original)`
      ),
      summary: t('Options of `patchConfig()`.', '`patchConfig()` 的选项：复用策略、档位与上限。'),
      members: {
        reuseUnchangedRoot: {
          summary: t(
            'Return `base` itself when the patch is empty.',
            '补丁为空时直接返回 `base`，不做复制。'
          ),
          default: t('`true`.', '`true`：空补丁直接复用原配置。')
        },
        profile: {
          summary: t(
            'Must equal the profile of `base`, otherwise `CONFIG_CONFLICT`.',
            '必须与 `base` 的档位一致，否则抛 `CONFIG_CONFLICT`。'
          ),
          default: t('The profile of `base`.', '沿用 `base` 的档位。'),
          values: { enum: 'ConfigProfile' }
        },
        limits: {
          summary: t(
            'May not be wider than the limits of `base`.',
            '不能比 `base` 的上限更宽松，否则抛 `CONFIG_CONFLICT`。'
          ),
          default: t('The limits of `base`.', '沿用 `base` 的上限。')
        }
      }
    },
    IConfigPathRule: {
      scenarios: [
        t(
          'Concatenate menu entries under one configuration branch while other arrays keep the global replacement policy.',
          '只有菜单分支需要拼接数组时，用这个类型声明按路径生效的规则，其余数组沿用全局替换策略。'
        )
      ],
      example: t(
        `/** Concatenate menu entries under one configuration branch while other arrays keep the global replacement policy. */
import { combineConfig, ownConfig, type IConfigPathRule } from '@migaia/utils/config'
const menuRule: IConfigPathRule = { prefix: ['menu'], strategies: { array: 'concat' } }
const settings = combineConfig([
  ownConfig({ menu: { items: ['home'] }, tags: ['default'] }),
  ownConfig({ menu: { items: ['help'] }, tags: ['custom'] })
], { pathRules: [menuRule] })
console.log(settings)`,
        `/** 只有菜单分支需要拼接数组时，用这个类型声明按路径生效的规则，其余数组沿用全局替换策略。 */
import { combineConfig, ownConfig, type IConfigPathRule } from '@migaia/utils/config'
const menuRule: IConfigPathRule = { prefix: ['menu'], strategies: { array: 'concat' } }
const settings = combineConfig([
  ownConfig({ menu: { items: ['home'] }, tags: ['default'] }),
  ownConfig({ menu: { items: ['help'] }, tags: ['custom'] })
], { pathRules: [menuRule] })
console.log(settings)`
      ),
      summary: t(
        'One path-prefix rule of `combineConfig()`.',
        '`combineConfig()` 中的一条按路径前缀覆盖策略的规则。'
      ),
      members: {
        prefix: { summary: t('Path prefix the rule applies to.', '该规则作用的路径前缀。') },
        strategies: { summary: t('Strategies used under that prefix.', '该前缀下使用的合并策略。') }
      }
    },
    IConfigProfile: {
      ...alias('Union of `ConfigProfile` values.', '`ConfigProfile` 全部取值组成的联合类型。'),
      scenarios: [
        t(
          'Accept a named validation profile in your own configuration loader and pass it through to ownConfig().',
          '自己的配置加载函数需要选择校验档位时，用这个类型约束参数，再传给 ownConfig()。'
        )
      ],
      example: t(
        `/** Accept a named validation profile in your own configuration loader and pass it through to ownConfig(). */
import { ConfigProfile, ownConfig, type IConfigProfile } from '@migaia/utils/config'
function loadSettings(profile: IConfigProfile) {
  return ownConfig({ theme: 'light' }, { profile })
}
console.log(loadSettings(ConfigProfile.data))`,
        `/** 自己的配置加载函数需要选择校验档位时，用这个类型约束参数，再传给 ownConfig()。 */
import { ConfigProfile, ownConfig, type IConfigProfile } from '@migaia/utils/config'
function loadSettings(profile: IConfigProfile) {
  return ownConfig({ theme: 'light' }, { profile })
}
console.log(loadSettings(ConfigProfile.data))`
      )
    },
    IConfigReadResult: {
      summary: t(
        'Result of `readConfigPath()`, distinguishing an absent path from a present value that may itself be undefined.',
        '`readConfigPath()` 返回的结果，区分路径缺失和实际值本身为空值的情况。'
      ),
      scenarios: [
        t(
          'Read configuration without confusing an absent key with a present undefined value.',
          '读取配置时区分不存在的键与已存在但值为空的键。'
        )
      ],
      example: t(
        `import { readConfigPath, ownConfig } from '@migaia/utils/config'

const result = readConfigPath(ownConfig({ port: 8080 }), 'port')
if (result.kind === 'value') console.log(result.value)`,
        `import { readConfigPath, ownConfig } from '@migaia/utils/config'

const result = readConfigPath(ownConfig({ port: 8080 }), 'port')
if (result.kind === 'value') console.log(result.value)`
      ),
      members: {
        kind: {
          summary: t(
            'Read discriminant: missing means no reachable property, while value retains the result.',
            '读取判别值：缺失表示没有可达属性，值分支保留读取结果。'
          ),
          values: {
            missing: t(
              'The requested configuration path does not exist.',
              '所请求的配置路径不存在，不能读取结果。'
            ),
            value: t(
              'The path exists and its value is available without coercion.',
              '路径存在，可以取得未经强制转换的原始值。'
            )
          }
        },
        value: {
          summary: t(
            'Unmodified configuration value present only in the value branch, including an intentionally stored undefined.',
            '仅值分支存在的原配置值，包括有意存储的空值。'
          )
        }
      }
    },
    IConfigRecord: {
      ...alias('A configuration object (plain record).', '配置对象的类型，即普通键值记录。'),
      scenarios: [
        t(
          'Accept a configuration record with application-defined keys before ownConfig() validates and copies it.',
          '封装配置入口且字段由应用决定时，用这个类型接收键值记录，再交给 ownConfig() 校验和复制。'
        )
      ],
      example: t(
        `/** Accept a configuration record with application-defined keys before ownConfig() validates and copies it. */
import { ownConfig, type IConfigRecord } from '@migaia/utils/config'
function importSettings(input: IConfigRecord) {
  return ownConfig(input)
}
console.log(importSettings({ locale: 'zh-CN', pageSize: 20 }))`,
        `/** 封装配置入口且字段由应用决定时，用这个类型接收键值记录，再交给 ownConfig() 校验和复制。 */
import { ownConfig, type IConfigRecord } from '@migaia/utils/config'
function importSettings(input: IConfigRecord) {
  return ownConfig(input)
}
console.log(importSettings({ locale: 'zh-CN', pageSize: 20 }))`
      )
    },
    IOwnConfigOptions: {
      scenarios: [
        t(
          'Reuse a pure-data validation policy with a tighter nesting limit when importing user settings.',
          '导入用户设置时，用这个选项类型保存纯数据档位和更小的嵌套上限，供多次导入复用。'
        )
      ],
      example: t(
        `/** Reuse a pure-data validation policy with a tighter nesting limit when importing user settings. */
import { ConfigProfile, ownConfig, type IOwnConfigOptions } from '@migaia/utils/config'
const importOptions: IOwnConfigOptions = { profile: ConfigProfile.data, limits: { maxDepth: 8 } }
const imported = ownConfig({ locale: 'en-GB' }, importOptions)
console.log(imported.locale)`,
        `/** 导入用户设置时，用这个选项类型保存纯数据档位和更小的嵌套上限，供多次导入复用。 */
import { ConfigProfile, ownConfig, type IOwnConfigOptions } from '@migaia/utils/config'
const importOptions: IOwnConfigOptions = { profile: ConfigProfile.data, limits: { maxDepth: 8 } }
const imported = ownConfig({ locale: 'en-GB' }, importOptions)
console.log(imported.locale)`
      ),
      summary: t('Options of `ownConfig()`.', '`ownConfig()` 的选项：校验档位与规模上限。'),
      members: {
        profile: {
          summary: t(
            '`data` rejects functions; `richRuntime` allows functions and constructors (in-process only).',
            '`data` 拒绝函数；`richRuntime` 允许函数与构造器（只用于进程内）。'
          ),
          default: t('`data`.', '`data`：只接受可移植的纯数据。'),
          values: { enum: 'ConfigProfile' }
        },
        limits: {
          summary: t(
            'Tighter limits (`maxDepth`, `maxNodes`, `maxKeys`, `maxPathLength`, `maxSegmentLength`).',
            '为这份配置设置更严格的规模上限（`maxDepth`、`maxNodes`、`maxKeys`、`maxPathLength`、`maxSegmentLength`）。'
          ),
          default: t(
            'Package defaults: 256, 100000, 1000000, 4096, 512.',
            '包级默认值：256、100000、1000000、4096、512。'
          )
        }
      }
    },
    IOwnedConfig: {
      ...alias(
        'A configuration registered by `ownConfig()`; accepted by the other config functions.',
        '由 `ownConfig()` 登记的配置，可被其它配置函数接受。'
      ),
      scenarios: [
        t(
          'Require callers to pass a configuration produced by ownConfig() before applying a settings patch.',
          '封装设置修改函数时，用这个类型标注已由 ownConfig() 生成的配置参数，再调用 patchConfig()。'
        )
      ],
      example: t(
        `/** Require callers to pass a configuration produced by ownConfig() before applying a settings patch. */
import { ownConfig, patchConfig, type IOwnedConfig } from '@migaia/utils/config'
type ISettings = { pageSize: number }
function changePageSize(settings: IOwnedConfig<ISettings>) {
  return patchConfig(settings, { pageSize: 50 })
}
console.log(changePageSize(ownConfig({ pageSize: 20 })))`,
        `/** 封装设置修改函数时，用这个类型标注已由 ownConfig() 生成的配置参数，再调用 patchConfig()。 */
import { ownConfig, patchConfig, type IOwnedConfig } from '@migaia/utils/config'
type ISettings = { pageSize: number }
function changePageSize(settings: IOwnedConfig<ISettings>) {
  return patchConfig(settings, { pageSize: 50 })
}
console.log(changePageSize(ownConfig({ pageSize: 20 })))`
      )
    },
    IErrorChainData: {
      ...alias(
        'Plain JSON data allowed in a serialized error `data` field.',
        '序列化错误的 `data` 字段中允许的纯 JSON 数据。'
      ),
      scenarios: [
        t(
          'Type additional error details as portable JSON data before including them in a serialized error.',
          '需要随序列化错误发送重试次数等附加信息时，用这个类型约束可传输的纯数据。'
        )
      ],
      example: t(
        `/** Type additional error details as portable JSON data before including them in a serialized error. */
import { serializeErrorChain, type IErrorChainData } from '@migaia/utils/error'
const details: IErrorChainData = { attempts: 3, retryable: false }
const failure = Object.assign(new Error(), { data: details })
console.log(serializeErrorChain(failure).data)`,
        `/** 需要随序列化错误发送重试次数等附加信息时，用这个类型约束可传输的纯数据。 */
import { serializeErrorChain, type IErrorChainData } from '@migaia/utils/error'
const details: IErrorChainData = { attempts: 3, retryable: false }
const failure = Object.assign(new Error(), { data: details })
console.log(serializeErrorChain(failure).data)`
      )
    },
    IErrorChainStrategy: {
      scenarios: [
        t(
          'Set a smaller node and text budget when serializing errors for a diagnostic message.',
          '诊断消息需要限制体积时，用这个策略类型给错误序列化设置更小的节点数与文本预算。'
        )
      ],
      example: t(
        `/** Set a smaller node and text budget when serializing errors for a diagnostic message. */
import { serializeErrorChain, type IErrorChainStrategy } from '@migaia/utils/error'
const messagePolicy: IErrorChainStrategy = {
  limits: { maxNodes: 8, maxBytes: 4096, maxStringBytes: 512 }
}
const failure = new TypeError()
console.log(serializeErrorChain(failure, messagePolicy))`,
        `/** 诊断消息需要限制体积时，用这个策略类型给错误序列化设置更小的节点数与文本预算。 */
import { serializeErrorChain, type IErrorChainStrategy } from '@migaia/utils/error'
const messagePolicy: IErrorChainStrategy = {
  limits: { maxNodes: 8, maxBytes: 4096, maxStringBytes: 512 }
}
const failure = new TypeError()
console.log(serializeErrorChain(failure, messagePolicy))`
      ),
      summary: t(
        'Boundary policy of error serialization: fields, limits, privacy, data and restoration.',
        '错误序列化的边界策略：字段、上限、隐私、数据与还原方式。'
      ),
      members: {
        fields: {
          summary: t(
            'Ordered whitelist of fields to send and accept, starting with source/code/name/message/stack.',
            '发送与接收字段的有序白名单，以 source/code/name/message/stack 开头。'
          ),
          default: t(
            '`source`, `code`, `name`, `message`, `stack`, `cause`, `errors`, `data`, `truncated`.',
            '`source`、`code`、`name`、`message`、`stack`、`cause`、`errors`、`data`、`truncated`。'
          )
        },
        limits: {
          summary: t(
            'Nesting, node, byte and string budgets.',
            '嵌套层数、节点数、总字节数与字符串字节数的预算。'
          ),
          default: t(
            '32 levels, 128 nodes, 65536 bytes, 4096 bytes per string.',
            '32 层、128 个节点、65536 字节、每个字符串 4096 字节。'
          )
        },
        fallback: {
          summary: t(
            'Source, code and name used for values without valid identity.',
            '没有有效身份的值使用的 source、code 与 name。'
          ),
          default: t('`unknown` / `UNKNOWN` / `Error`.', '`unknown` / `UNKNOWN` / `Error`。')
        },
        presentation: {
          summary: t(
            'Replaces public code and message of selected errors (privacy).',
            '为选定的错误替换对外公开的 code 与信息（用于隐私保护）。'
          )
        },
        normalizeData: {
          summary: t('Validates and converts `data` values.', '校验并转换附加数据 `data` 中的值。')
        },
        dataTextLeaf: {
          summary: t(
            'Selects one text leaf of `data` for redaction.',
            '选出 `data` 中需要脱敏的文本叶子。'
          )
        },
        extensions: {
          summary: t(
            'Extra fields with their own read, normalize and restore.',
            '额外字段，各自带有读取、规整与还原函数。'
          )
        },
        createViolation: {
          summary: t('Builds the error thrown for invalid input.', '构造输入不合法时抛出的错误。')
        },
        sanitizeText: {
          summary: t(
            'Cleans every text unit (defaults to `sanitizeErrorText`).',
            '清理每段文本（默认使用 `sanitizeErrorText`）。'
          )
        },
        createError: {
          summary: t(
            'Builds a native error from a serialized node when deserializing.',
            '反序列化时根据节点构造原生错误。'
          )
        },
        attachIdentity: {
          summary: t(
            'Attaches source/code to a rebuilt error.',
            '为反序列化重建的错误附加 source/code。'
          )
        }
      }
    },
    IErrorIdentity: {
      scenarios: [
        t(
          'Keep an application error identity in a typed object and attach it to an existing native error.',
          '应用需要稳定识别一种错误时，用这个类型保存来源和错误码，再附加到已有的原生错误上。'
        )
      ],
      example: t(
        `/** Keep an application error identity in a typed object and attach it to an existing native error. */
import { attachErrorIdentity, type IErrorIdentity } from '@migaia/utils/error'
const identity: IErrorIdentity = { source: 'settings-app', code: 'INVALID_PORT' }
const failure = new RangeError()
const tagged = attachErrorIdentity(failure, identity)
console.log(tagged === failure, tagged instanceof RangeError)`,
        `/** 应用需要稳定识别一种错误时，用这个类型保存来源和错误码，再附加到已有的原生错误上。 */
import { attachErrorIdentity, type IErrorIdentity } from '@migaia/utils/error'
const identity: IErrorIdentity = { source: 'settings-app', code: 'INVALID_PORT' }
const failure = new RangeError()
const tagged = attachErrorIdentity(failure, identity)
console.log(tagged === failure, tagged instanceof RangeError)`
      ),
      summary: t(
        'Identity attached by `attachErrorIdentity()`.',
        '`attachErrorIdentity()` 附加到错误上的身份信息。'
      ),
      members: {
        source: {
          summary: t('Package or boundary that owns the error.', '拥有该错误的包或边界名称。')
        },
        code: { summary: t('Stable error code to branch on.', '供调用方分支处理的稳定错误码。') },
        phase: {
          summary: t('Optional phase in which the error happened.', '可选，错误发生时所处的阶段。')
        },
        detail: { summary: t('Optional structured details.', '可选，附加的结构化细节信息。') }
      }
    },
    IErrorIdentityHooks: {
      scenarios: [
        t(
          'Preserve an existing identity when another caller tries to attach a different code, recording the conflict through your hook.',
          '另一调用方尝试写入不同错误码时，用这个钩子类型记录冲突并保留原有身份。'
        )
      ],
      example: t(
        `/** Preserve an existing identity when another caller tries to attach a different code, recording the conflict through your hook. */
import { attachErrorIdentity, type IErrorIdentityHooks } from '@migaia/utils/error'
const failure = attachErrorIdentity(new Error(), { source: 'settings-app', code: 'FIRST' })
const preserveIdentity: IErrorIdentityHooks<Error> = {
  onConflict: ({ target, key }) => {
    console.warn(key)
    return target
  }
}
attachErrorIdentity(failure, { source: 'settings-app', code: 'SECOND' }, preserveIdentity)`,
        `/** 另一调用方尝试写入不同错误码时，用这个钩子类型记录冲突并保留原有身份。 */
import { attachErrorIdentity, type IErrorIdentityHooks } from '@migaia/utils/error'
const failure = attachErrorIdentity(new Error(), { source: 'settings-app', code: 'FIRST' })
const preserveIdentity: IErrorIdentityHooks<Error> = {
  onConflict: ({ target, key }) => {
    console.warn(key)
    return target
  }
}
attachErrorIdentity(failure, { source: 'settings-app', code: 'SECOND' }, preserveIdentity)`
      ),
      summary: t(
        'Hooks of `attachErrorIdentity()`.',
        '`attachErrorIdentity()` 的钩子，处理冲突与定义失败。'
      ),
      members: {
        onConflict: {
          summary: t(
            'Chooses an object to return when a field already has another value.',
            '字段已有不同值时，选择要返回的对象。'
          )
        },
        onFailure: {
          summary: t(
            'Chooses an object to return when a field cannot be defined (frozen error).',
            '字段无法定义时（如错误已冻结），选择要返回的对象。'
          )
        }
      }
    },
    IPropertyRead: {
      summary: t(
        'Single receiver-preserving property read from `tryReadProperty()`, with the exact getter failure retained as data.',
        '`tryReadProperty()` 保留接收者的单次属性读取结果，访问器原始失败作为数据保留。'
      ),
      scenarios: [
        t(
          'Inspect an untrusted getter once while keeping fallback or rethrow policy with the caller.',
          '只检查不可信访问器一次，由调用方决定回退或重新抛错。'
        )
      ],
      example: t(
        `import { tryReadProperty } from '@migaia/utils/error'

const result = tryReadProperty({ value: 1 }, 'value')
if (result.threw) console.error(result.error)
else console.log(result.value)`,
        `import { tryReadProperty } from '@migaia/utils/error'

const result = tryReadProperty({ value: 1 }, 'value')
if (result.threw) console.error(result.error)
else console.log(result.value)`
      ),
      members: {
        threw: {
          summary: t(
            'Boolean discriminant: true carries the exact getter error, false carries the read value.',
            '布尔判别值：真值携带访问器原错，假值携带读取结果。'
          ),
          values: {
            true: t(
              'Property access threw; inspect the retained original error.',
              '属性访问抛错，应检查保留的原始错误。'
            ),
            false: t(
              'Property access returned; inspect the value without a second read.',
              '属性访问返回，应读取结果而不再访问属性。'
            )
          }
        },
        value: {
          summary: t(
            'Value returned by the single successful property read; present only when threw is false.',
            '单次成功属性访问返回的值，仅在未抛错分支存在。'
          )
        },
        error: {
          summary: t(
            'Exact value thrown by property access; present only when threw is true.',
            '属性访问抛出的精确原值，仅在抛错分支存在。'
          )
        }
      }
    },
    ISerializedErrorChain: {
      summary: t(
        'A frozen, JSON-safe error tree produced by `serializeErrorChain()`.',
        '`serializeErrorChain()` 生成的冻结、可 JSON 化的错误树。'
      ),
      scenarios: [
        t(
          'Send an error from a worker or child process to the main thread.',
          '把 worker 或子进程中的错误发送到主线程。'
        )
      ],
      example: t(
        `import { serializeErrorChain, deserializeErrorChain } from '@migaia/utils/error'

const tree = serializeErrorChain(new Error('outer', { cause: new TypeError('inner') }))
console.log(tree.cause?.name) // 'TypeError'
const restored = deserializeErrorChain(tree)`,
        `import { serializeErrorChain, deserializeErrorChain } from '@migaia/utils/error'

const tree = serializeErrorChain(new Error('外层', { cause: new TypeError('内层') }))
console.log(tree.cause?.name) // 'TypeError'
const restored = deserializeErrorChain(tree)`
      ),
      members: {
        source: {
          summary: t(
            'Owner of the error (`unknown` when absent).',
            '错误的所有者（缺失时为 `unknown`）。'
          )
        },
        code: {
          summary: t(
            'Error code (`UNKNOWN` when absent).',
            '稳定错误码（原错误没有时为 `UNKNOWN`）。'
          )
        },
        name: {
          summary: t(
            'Error name such as `TypeError`.',
            '原生错误名称，例如 `TypeError`，反序列化时据此恢复类型。'
          )
        },
        message: {
          summary: t('Error message, sanitized and bounded.', '经过清理并限制长度的错误信息。')
        },
        stack: {
          summary: t(
            'Original stack text (kept, not regenerated).',
            '原始调用栈文本（原样保留，不重新生成）。'
          )
        },
        cause: {
          summary: t('Serialized `cause`, if any.', '序列化后的原因 `cause`（原错误有时才存在）。')
        },
        errors: {
          summary: t(
            'Serialized `AggregateError.errors`, if any.',
            '序列化后的 `AggregateError.errors`（原错误有时才存在）。'
          )
        },
        data: { summary: t('Portable extra data, if any.', '可移植的附加数据（如果有）。') },
        truncated: {
          summary: t(
            '`true` when something was cut to fit the limits.',
            '为满足上限而截断了内容时为 `true`。'
          )
        }
      }
    },
    UtilsError: {
      summary: t(
        'Base class of this package errors.',
        '本包所有错误的基类，带 `source` 与 `code`。'
      ),
      scenarios: [
        t('Branch on `code` for any error of this package.', '对本包的任意错误按 `code` 分支处理。')
      ],
      example: `if (error instanceof UtilsError && error.code === 'DEADLINE_EXCEEDED') retryLater()`,
      members: {
        source: {
          summary: t(
            'Always `@migaia/utils`; confirms the error came from this package.',
            '固定为 `@migaia/utils`，用来确认错误来源。'
          )
        },
        code: {
          summary: t(
            'Stable error code; see the error code table.',
            '稳定的错误码，含义见错误码表。'
          )
        }
      }
    },
    UtilsAbortError: {
      summary: t('Cancellation error of this package.', '本包的取消错误，表示操作被信号中止。'),
      scenarios: [
        t(
          'Ignore user cancellation while reporting real failures.',
          '忽略用户主动取消，只上报真正的失败。'
        )
      ],
      example: `try {
  await sleep(1000, { signal })
} catch (error) {
  if (!isUtilsAbortError(error)) throw error
}`,
      members: {
        name: {
          summary: t(
            'Always `AbortError`, like native abort errors.',
            '固定为 `AbortError`，与原生中止错误一致。'
          )
        },
        source: {
          summary: t(
            'Always `@migaia/utils`; confirms the error came from this package.',
            '固定为 `@migaia/utils`，用来确认错误来源。'
          )
        },
        code: {
          summary: t(
            'Always `ABORTED`: the operation was cancelled by a signal.',
            '固定为 `ABORTED`，表示操作被信号取消。'
          )
        }
      }
    },
    UtilsTimeoutError: {
      summary: t('Deadline error of this package.', '本包的超时错误，表示超过了截止时间。'),
      scenarios: [
        t(
          'Tell an attempt timeout apart from the total retry timeout.',
          '区分单次尝试超时与整个重试流程超时。'
        )
      ],
      example: `if (isUtilsTimeoutError(error) && error.scope === 'total') showOfflineBanner()`,
      members: {
        scope: {
          summary: t(
            '`operation`, `attempt` or `total`: which deadline passed.',
            '`operation`、`attempt` 或 `total`：被超过的是哪一层截止时间。'
          ),
          values: {
            operation: t('One `withTimeout` operation.', '一次 `withTimeout` 操作。'),
            attempt: t('One retry attempt.', '一次重试尝试。'),
            total: t('The whole retry.', '整个重试流程。')
          }
        },
        timeoutMs: { summary: t('The deadline in milliseconds.', '被超过的截止时间，单位毫秒。') },
        name: {
          summary: t(
            'Always `TimeoutError`, like native timeout errors.',
            '固定为 `TimeoutError`，与原生超时错误一致。'
          )
        },
        source: {
          summary: t(
            'Always `@migaia/utils`; confirms the error came from this package.',
            '固定为 `@migaia/utils`，用来确认错误来源。'
          )
        },
        code: {
          summary: t(
            'Always `DEADLINE_EXCEEDED`.',
            '固定为 `DEADLINE_EXCEEDED`，表示超过了截止时间。'
          )
        }
      }
    },
    IUtilsErrorCode: {
      ...alias('Union of `UtilsErrorCode` values.', '`UtilsErrorCode` 全部取值组成的联合类型。'),
      scenarios: [
        t(
          'Store a Utils error code after isUtilsError() has checked an unknown caught value.',
          '捕获未知错误后，先用 isUtilsError() 判断，再用这个类型保存已确认的工具库错误码。'
        )
      ],
      example: t(
        `/** Store a Utils error code after isUtilsError() has checked an unknown caught value. */
import { isUtilsError, type IUtilsErrorCode } from '@migaia/utils/error'
import { sleep } from '@migaia/utils/promise'
try {
  await sleep(-1)
} catch (error) {
  if (isUtilsError(error)) {
    const code: IUtilsErrorCode = error.code
    console.warn(code)
  } else {
    throw error
  }
}`,
        `/** 捕获未知错误后，先用 isUtilsError() 判断，再用这个类型保存已确认的工具库错误码。 */
import { isUtilsError, type IUtilsErrorCode } from '@migaia/utils/error'
import { sleep } from '@migaia/utils/promise'
try {
  await sleep(-1)
} catch (error) {
  if (isUtilsError(error)) {
    const code: IUtilsErrorCode = error.code
    console.warn(code)
  } else {
    throw error
  }
}`
      )
    },
    IThenableInspection: {
      summary: t(
        'Single-read inspection returned by `inspectThenable()`, preserving a captured then function or the original accessor failure.',
        '`inspectThenable()` 返回的单次读取检查，保留捕获的异步方法或原始访问器失败。'
      ),
      scenarios: [
        t(
          'Observe an unexpectedly asynchronous callback result without reading its then property twice.',
          '观察意外异步的回调结果，避免重复读取其异步方法属性。'
        )
      ],
      example: t(
        `import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'

const value = Promise.resolve(1)
const inspection = inspectThenable(value)
observeThenableRejection(value, inspection, console.error)`,
        `import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'

const value = Promise.resolve(1)
const inspection = inspectThenable(value)
observeThenableRejection(value, inspection, console.error)`
      ),
      members: {
        // oxlint-disable-next-line unicorn/no-thenable -- This key stores IMemberDoc metadata, not a Promise implementation.
        then: {
          summary: t(
            'Captured then function when callable, otherwise absent or undefined. Invoke it only through the original value’s receiver, such as `observeThenableRejection()`.',
            '可调用时捕获的异步方法，否则缺失或为空值。必须保留原值接收者执行，例如交给 `observeThenableRejection()`。'
          ),
          params: {
            resolve: t(
              'Fulfillment callback supplied by the assimilating promise owner.',
              '异步归化所有者提供的成功回调。'
            ),
            reject: t(
              'Rejection callback supplied by the assimilating promise owner.',
              '异步归化所有者提供的拒绝回调。'
            )
          },
          returns: t(
            'Its invocation settles the owner’s promise through callbacks; the return value is ignored.',
            '通过回调结算所有者的异步结果，不使用方法返回值。'
          )
        },
        error: {
          summary: t(
            'Exact thrown value from the single then-property read, present only in the failed inspection branch.',
            '单次读取异步方法属性时抛出的精确原值，仅在检查失败分支存在。'
          )
        }
      }
    },
    IThenableProbe: {
      summary: t(
        'Discriminated result of `probeThenable()` that captures the then method once and leaves error policy to its caller.',
        '`probeThenable()` 的判别结果，单次捕获异步方法，由调用方决定错误策略。'
      ),
      scenarios: [
        t(
          'Choose synchronous handling, one-time assimilation or explicit accessor-failure handling.',
          '选择同步处理、单次异步归化或明确处理访问器失败。'
        )
      ],
      example: t(
        `import { probeThenable, assimilateCapturedThen } from '@migaia/utils/function'

const value = Promise.resolve(1)
const probe = probeThenable(value)
if (probe.kind === 'thenable') console.log(await assimilateCapturedThen(probe.thenFn, value))
else if (probe.kind === 'failed') console.error(probe.error)`,
        `import { probeThenable, assimilateCapturedThen } from '@migaia/utils/function'

const value = Promise.resolve(1)
const probe = probeThenable(value)
if (probe.kind === 'thenable') console.log(await assimilateCapturedThen(probe.thenFn, value))
else if (probe.kind === 'failed') console.error(probe.error)`
      ),
      members: {
        kind: {
          summary: t(
            'Discriminant from `ThenableProbeKind` separating ordinary values, captured thenables and failed property reads.',
            '来自 `ThenableProbeKind` 的判别值，区分普通值、已捕获异步可等待值和属性读取失败。'
          ),
          values: { enum: 'ThenableProbeKind' }
        },
        thenFn: {
          summary: t(
            'Callable method captured from the original value, present only for thenable. Preserve that original receiver when using `assimilateCapturedThen()`.',
            '从原值捕获的可调用方法，仅异步分支存在。使用 `assimilateCapturedThen()` 时必须保留原接收者。'
          ),
          params: {
            resolve: t(
              'Fulfillment callback provided by the promise assimilation boundary.',
              '异步归化边界提供的成功回调。'
            ),
            reject: t(
              'Rejection callback provided by the promise assimilation boundary.',
              '异步归化边界提供的拒绝回调。'
            )
          },
          returns: t(
            'No return value is consumed; fulfillment or rejection is delivered through the callbacks.',
            '不使用返回值，成功或拒绝通过回调交付。'
          )
        },
        error: {
          summary: t(
            'Original then-property getter failure, present only when kind is failed and never reconstructed from text.',
            '原始异步方法访问器失败，仅失败分支存在，不会根据文本重新构造。'
          )
        }
      }
    },
    INumberFormatOptions: {
      scenarios: [
        t(
          'Reuse a locale and decimal precision policy when displaying prices in a table.',
          '表格中的价格需要统一地区格式和小数位数时，用这个选项类型保存显示规则。'
        )
      ],
      example: t(
        `/** Reuse a locale and decimal precision policy when displaying prices in a table. */
import { formatNumber, type INumberFormatOptions } from '@migaia/utils/number'
const priceOptions: INumberFormatOptions = {
  locales: 'en-GB', format: { minimumFractionDigits: 2, maximumFractionDigits: 2 }
}
console.log(formatNumber(12.5, priceOptions))`,
        `/** 表格中的价格需要统一地区格式和小数位数时，用这个选项类型保存显示规则。 */
import { formatNumber, type INumberFormatOptions } from '@migaia/utils/number'
const priceOptions: INumberFormatOptions = {
  locales: 'en-GB', format: { minimumFractionDigits: 2, maximumFractionDigits: 2 }
}
console.log(formatNumber(12.5, priceOptions))`
      ),
      summary: t(
        'Options shared by the number formatting functions.',
        '所有数字格式化函数共用的选项。'
      ),
      members: {
        locales: {
          summary: t(
            'Locale preference passed to `Intl` after canonicalisation, e.g. `zh-CN`.',
            '规范化后传给 `Intl` 的语言区域偏好，例如 `zh-CN`。'
          ),
          default: t('Not set: the host default locale.', '不设置：使用宿主默认的语言区域。')
        },
        format: {
          summary: t(
            'Native `Intl.NumberFormat` options (fraction digits, rounding, notation...) merged with the helper defaults.',
            '原生 `Intl.NumberFormat` 选项（小数位数、舍入、记数法等），与各函数的默认设置合并。'
          ),
          default: t(
            'Not set: only the helper defaults apply.',
            '不设置：只使用各函数自身的默认设置。'
          )
        }
      }
    },
    INumberFormatter: {
      ...alias(
        'Reusable formatter `(value) => string` from `createNumberFormatter()`.',
        '`createNumberFormatter()` 返回的可复用格式化函数 `(value) => string`。'
      ),
      scenarios: [
        t(
          'Pass a reusable number formatter to a table column instead of rebuilding display options for every row.',
          '表格列需要反复格式化数字时，用这个函数类型接收已创建的格式化函数。'
        )
      ],
      example: t(
        `/** Pass a reusable number formatter to a table column instead of rebuilding display options for every row. */
import { createNumberFormatter, type INumberFormatter } from '@migaia/utils/number'
function displayStock(formatStock: INumberFormatter): string[] {
  return [12, 1200, 3000n].map((stock) => formatStock(stock))
}
console.log(displayStock(createNumberFormatter({ locales: 'en-US' })))`,
        `/** 表格列需要反复格式化数字时，用这个函数类型接收已创建的格式化函数。 */
import { createNumberFormatter, type INumberFormatter } from '@migaia/utils/number'
function displayStock(formatStock: INumberFormatter): string[] {
  return [12, 1200, 3000n].map((stock) => formatStock(stock))
}
console.log(displayStock(createNumberFormatter({ locales: 'en-US' })))`
      )
    },
    INumericValue: {
      ...alias(
        'Numbers accepted by the formatters: `number` or `bigint` (no strings).',
        '格式化函数接受的数值：`number` 或 `bigint`（不接受字符串）。'
      ),
      scenarios: [
        t(
          'Allow both ordinary counts and bigint totals in your own numeric display function without accepting numeric strings.',
          '自己的数量显示函数同时接收普通数值和大整数时，用这个类型限制输入，不接收数字字符串。'
        )
      ],
      example: t(
        `/** Allow both ordinary counts and bigint totals in your own numeric display function without accepting numeric strings. */
import { formatInteger, type INumericValue } from '@migaia/utils/number'
function displayCount(count: INumericValue): string {
  return formatInteger(count, { locales: 'en-US' })
}
console.log(displayCount(1200), displayCount(9007199254740993n))`,
        `/** 自己的数量显示函数同时接收普通数值和大整数时，用这个类型限制输入，不接收数字字符串。 */
import { formatInteger, type INumericValue } from '@migaia/utils/number'
function displayCount(count: INumericValue): string {
  return formatInteger(count, { locales: 'en-US' })
}
console.log(displayCount(1200), displayCount(9007199254740993n))`
      )
    },
    IDiagnosticSnapshot: {
      summary: t(
        'Result of `diagnosticSnapshot()` and `structuredDiagnosticSnapshot()`.',
        '`diagnosticSnapshot()` 与 `structuredDiagnosticSnapshot()` 的结果：副本以及未能复制的路径。'
      ),
      scenarios: [
        t(
          'Keep a telemetry payload even when one field cannot be cloned.',
          '即使某个字段无法克隆，也保留整份遥测数据。'
        )
      ],
      example: t(
        `import { diagnosticSnapshot, type IDiagnosticSnapshot } from '@migaia/utils/object'

/** The diagnostic projection can be logged without invoking the accessor. */
const snapshot: IDiagnosticSnapshot<{ user: string }> = diagnosticSnapshot({
  get user() { return 'Ada' }
})
for (const item of snapshot.diagnostics) console.warn(item.path.join('.'), item.reason)`,
        `import { diagnosticSnapshot, type IDiagnosticSnapshot } from '@migaia/utils/object'

/** 诊断投影用于记录输入，不调用访问器。 */
const snapshot: IDiagnosticSnapshot<{ user: string }> = diagnosticSnapshot({
  get user() { return 'Ada' }
})
for (const item of snapshot.diagnostics) console.warn(item.path.join('.'), item.reason)`
      ),
      members: {
        value: {
          summary: t(
            'The copy (possibly sharing the reported paths).',
            '复制得到的值（报告的路径可能仍与源对象共享）。'
          )
        },
        diagnostics: {
          summary: t('Paths that were not copied and why.', '没有被复制的路径及其原因。')
        }
      }
    },
    IOwnDescriptorsSnapshot: {
      summary: t(
        'Own-property descriptor capture returned by `snapshotOwnDescriptors()`, preserving proxy-trap failure as data.',
        '`snapshotOwnDescriptors()` 返回的自身属性描述符捕获结果，代理陷阱失败作为数据保留。'
      ),
      scenarios: [
        t(
          'Inspect an object’s own shape without executing its getters and handle capture failure explicitly.',
          '不执行对象访问器地检查自身形状，并明确处理捕获失败。'
        )
      ],
      example: t(
        `import { snapshotOwnDescriptors } from '@migaia/utils/object'

const snapshot = snapshotOwnDescriptors({ value: 1 })
if (snapshot.ok) console.log(snapshot.descriptors.value)
else console.error(snapshot.error)`,
        `import { snapshotOwnDescriptors } from '@migaia/utils/object'

const snapshot = snapshotOwnDescriptors({ value: 1 })
if (snapshot.ok) console.log(snapshot.descriptors.value)
else console.error(snapshot.error)`
      ),
      members: {
        kind: {
          summary: t(
            'Capture discriminant: captured contains descriptors, while failed retains the original failure.',
            '捕获判别值：成功分支包含描述符，失败分支保留原始错误。'
          ),
          values: {
            captured: t(
              'Own property descriptors were captured without reading their getter values.',
              '已捕获自身属性描述符，未读取访问器对应值。'
            ),
            failed: t(
              'Descriptor capture failed; inspect the original error.',
              '描述符捕获失败，应检查对应原始错误。'
            )
          }
        },
        ok: {
          summary: t(
            'Boolean counterpart of kind; true narrows to descriptors and false narrows to the failure.',
            '种类判别值的布尔对应形式；真值缩窄到描述符，假值缩窄到错误。'
          ),
          values: {
            true: t(
              'Capture succeeded and descriptors are available.',
              '捕获已经成功，可以读取自身属性描述符。'
            ),
            false: t(
              'Capture failed and the original error is available.',
              '捕获已经失败，可以读取原始失败对象。'
            )
          }
        },
        descriptors: {
          summary: t(
            'Readonly own-property descriptor record present only after capture; getter functions are preserved rather than executed.',
            '仅捕获成功后存在的自身属性描述符只读记录；访问器函数被保留而非执行。'
          )
        },
        error: {
          summary: t(
            'Exact thrown value from descriptor capture, present only in the failed branch.',
            '描述符捕获抛出的精确原值，仅失败分支存在。'
          )
        }
      }
    },
    IProbePropertyResult: {
      summary: t(
        'Result of `probeProperty()`, distinguishing a missing property from a successful value or contained read failure.',
        '`probeProperty()` 的结果，区分属性缺失、成功读取值和被保留的读取失败。'
      ),
      scenarios: [
        t(
          'Read a possibly absent property while keeping getter failures distinct from missing values.',
          '读取可能缺失的属性，并区分访问器失败与值缺失。'
        )
      ],
      example: t(
        `import { probeProperty } from '@migaia/utils/object'

const result = probeProperty<number>({ value: 1 }, 'value')
if (result.kind === 'value') console.log(result.value)
else if (result.kind === 'failed') console.error(result.error)`,
        `import { probeProperty } from '@migaia/utils/object'

const result = probeProperty<number>({ value: 1 }, 'value')
if (result.kind === 'value') console.log(result.value)
else if (result.kind === 'failed') console.error(result.error)`
      ),
      members: {
        kind: {
          summary: t(
            'Property-read discriminant selecting missing, value or failed access.',
            '属性读取判别值，选择缺失、已读取值或访问失败分支。'
          ),
          values: {
            missing: t(
              'The property is absent according to the membership probe.',
              '成员探测认为该属性不存在，未读取属性值。'
            ),
            value: t(
              'Property access succeeded and the original value is retained.',
              '属性访问成功，并保留对应原始读取值。'
            ),
            failed: t(
              'Property access threw and the original failure is retained.',
              '属性访问抛错，并保留对应原始失败值。'
            )
          }
        },
        value: {
          summary: t(
            'Original read value, present only in the successful branch and never coerced.',
            '原始读取值，仅成功分支存在，不进行强制转换。'
          )
        },
        error: {
          summary: t(
            'Original getter or read failure, present only in the failed branch.',
            '原始访问器或读取失败，仅失败分支存在。'
          )
        }
      }
    },
    ISnapshotDiagnostic: {
      scenarios: [
        t(
          'Inspect field paths and reasons when a best-effort snapshot reports a property read or an unsupported value.',
          '尽力复制对象后，需要查看属性读取或不支持值的路径和原因时，用这个类型声明诊断处理函数的参数。'
        )
      ],
      example: t(
        `/** Inspect field paths and reasons when a best-effort snapshot reports a property read or an unsupported value. */
import { diagnosticSnapshot, type ISnapshotDiagnostic } from '@migaia/utils/object'
function reportField(problem: ISnapshotDiagnostic): void {
  console.warn(problem.path, problem.reason, problem.cause)
}
const snapshot = diagnosticSnapshot({ get current() { return 42 } })
snapshot.diagnostics.forEach(reportField)`,
        `/** 尽力复制对象后，需要查看属性读取或不支持值的路径和原因时，用这个类型声明诊断处理函数的参数。 */
import { diagnosticSnapshot, type ISnapshotDiagnostic } from '@migaia/utils/object'
function reportField(problem: ISnapshotDiagnostic): void {
  console.warn(problem.path, problem.reason, problem.cause)
}
const snapshot = diagnosticSnapshot({ get current() { return 42 } })
snapshot.diagnostics.forEach(reportField)`
      ),
      summary: t(
        'One path that `diagnosticSnapshot()` could not copy.',
        '`diagnosticSnapshot()` 无法完整复制的一个路径及其原因。'
      ),
      members: {
        path: {
          summary: t('Path of the value that was not copied.', '没有被复制的值所在的路径。')
        },
        reason: {
          summary: t(
            'Why the value was not copied; one of the values below.',
            '没有被复制的原因，取值见下方说明。'
          ),
          values: {
            accessor: t(
              'A getter was read and its value used.',
              '读取了 getter，并使用了它返回的值。'
            ),
            'read-failed': t('Reading the property threw.', '读取该属性时抛出了错误。'),
            unsupported: t(
              'The value cannot be cloned and is kept by reference.',
              '该值无法克隆，保留了原引用。'
            )
          }
        },
        cause: { summary: t('The value or the thrown error.', '对应的值，或读取时抛出的错误。') }
      }
    },
    IObjectPath: {
      ...alias('All dot-path strings of a type.', '某个类型所有合法的点路径字符串。'),
      scenarios: [
        t(
          'Restrict a settings selector to string paths that exist in the settings type.',
          '设置选择器只接收字符串路径时，用这个类型让编译器检查字段是否存在。'
        )
      ],
      example: t(
        `/** Restrict a settings selector to string paths that exist in the settings type. */
import { createPathAccessor, type IObjectPath } from '@migaia/utils/object-path'
type ISettings = { service: { port: number } }
const portPath: IObjectPath<ISettings> = 'service.port'
const settings = createPathAccessor<ISettings>({ service: { port: 8080 } })
console.log(settings.get(portPath))`,
        `/** 设置选择器只接收字符串路径时，用这个类型让编译器检查字段是否存在。 */
import { createPathAccessor, type IObjectPath } from '@migaia/utils/object-path'
type ISettings = { service: { port: number } }
const portPath: IObjectPath<ISettings> = 'service.port'
const settings = createPathAccessor<ISettings>({ service: { port: 8080 } })
console.log(settings.get(portPath))`
      )
    },
    IObjectPathInput: {
      ...alias(
        'A path given as dot string or segment tuple.',
        '路径的输入形式：点路径字符串或路径段元组。'
      ),
      scenarios: [
        t(
          'Let a form field selector accept either a checked string path or a checked tuple path.',
          '表单字段选择器需要同时支持字符串和元组路径时，用这个类型约束两种输入。'
        )
      ],
      example: t(
        `/** Let a form field selector accept either a checked string path or a checked tuple path. */
import { createPathAccessor, type IObjectPathInput } from '@migaia/utils/object-path'
type IForm = { contact: { email: string } }
const form = createPathAccessor<IForm>({ contact: { email: 'ada@example.com' } })
function readField(path: IObjectPathInput<IForm>) {
  return form.get(path)
}
console.log(readField('contact.email'), readField(['contact', 'email']))`,
        `/** 表单字段选择器需要同时支持字符串和元组路径时，用这个类型约束两种输入。 */
import { createPathAccessor, type IObjectPathInput } from '@migaia/utils/object-path'
type IForm = { contact: { email: string } }
const form = createPathAccessor<IForm>({ contact: { email: 'ada@example.com' } })
function readField(path: IObjectPathInput<IForm>) {
  return form.get(path)
}
console.log(readField('contact.email'), readField(['contact', 'email']))`
      )
    },
    IObjectPathSegment: {
      ...alias('One path segment: property name or array index.', '单个路径段：属性名或数组下标。'),
      scenarios: [
        t(
          'Build one array-index segment separately before assembling a tuple path for a selected table row.',
          '按表格所选行组装元组路径时，用这个类型标注单个数组下标段。'
        )
      ],
      example: t(
        `/** Build one array-index segment separately before assembling a tuple path for a selected table row. */
import { parseObjectPath, type IObjectPathSegment } from '@migaia/utils/object-path'
const selectedRow: IObjectPathSegment = 2
console.log(parseObjectPath(['rows', selectedRow, 'name']))`,
        `/** 按表格所选行组装元组路径时，用这个类型标注单个数组下标段。 */
import { parseObjectPath, type IObjectPathSegment } from '@migaia/utils/object-path'
const selectedRow: IObjectPathSegment = 2
console.log(parseObjectPath(['rows', selectedRow, 'name']))`
      )
    },
    IObjectPathTuple: {
      ...alias('A parsed path: array of segments.', '解析后的路径：路径段数组。'),
      scenarios: [
        t(
          'Store the parsed segments of a path for logging or later inspection without claiming they belong to a particular object type.',
          '需要记录或检查解析后的路径段时，用这个类型保存结果；它本身不证明字段属于某个对象。'
        )
      ],
      example: t(
        `/** Store the parsed segments of a path for logging or later inspection without claiming they belong to a particular object type. */
import { parseObjectPath, type IObjectPathTuple } from '@migaia/utils/object-path'
const segments: IObjectPathTuple = parseObjectPath('orders.[0].total')
console.log(segments.length, segments[1])`,
        `/** 需要记录或检查解析后的路径段时，用这个类型保存结果；它本身不证明字段属于某个对象。 */
import { parseObjectPath, type IObjectPathTuple } from '@migaia/utils/object-path'
const segments: IObjectPathTuple = parseObjectPath('orders.[0].total')
console.log(segments.length, segments[1])`
      )
    },
    IObjectPathTupleFor: {
      ...alias('Tuple paths valid for a given type.', '对某个类型合法的元组路径。'),
      scenarios: [
        t(
          'Select an array element with a numeric segment while checking the rest of the tuple against the document type.',
          '用数值下标选择数组元素时，用这个类型检查整条元组路径是否符合文档类型。'
        )
      ],
      example: t(
        `/** Select an array element with a numeric segment while checking the rest of the tuple against the document type. */
import { createPathAccessor, type IObjectPathTupleFor } from '@migaia/utils/object-path'
type IInvoice = { lines: { total: number }[] }
const totalPath: IObjectPathTupleFor<IInvoice> = ['lines', 0, 'total']
const invoice = createPathAccessor<IInvoice>({ lines: [{ total: 25 }] })
console.log(invoice.get(totalPath))`,
        `/** 用数值下标选择数组元素时，用这个类型检查整条元组路径是否符合文档类型。 */
import { createPathAccessor, type IObjectPathTupleFor } from '@migaia/utils/object-path'
type IInvoice = { lines: { total: number }[] }
const totalPath: IObjectPathTupleFor<IInvoice> = ['lines', 0, 'total']
const invoice = createPathAccessor<IInvoice>({ lines: [{ total: 25 }] })
console.log(invoice.get(totalPath))`
      )
    },
    IObjectPathValue: {
      ...alias('Type of the value at a path.', '某个路径处的值的类型。'),
      scenarios: [
        t(
          'Derive a callback parameter from a nested field so its value type stays aligned with the document.',
          '回调接收嵌套字段的值时，用这个类型从文档类型推导参数，避免另写一份字段类型。'
        )
      ],
      example: t(
        `/** Derive a callback parameter from a nested field so its value type stays aligned with the document. */
import type { IObjectPathValue } from '@migaia/utils/object-path'
type IOrder = { payment: { amount: number } }
function displayAmount(amount: IObjectPathValue<IOrder, 'payment.amount'>): string {
  return amount.toFixed(2)
}
console.log(displayAmount(19.5))`,
        `/** 回调接收嵌套字段的值时，用这个类型从文档类型推导参数，避免另写一份字段类型。 */
import type { IObjectPathValue } from '@migaia/utils/object-path'
type IOrder = { payment: { amount: number } }
function displayAmount(amount: IObjectPathValue<IOrder, 'payment.amount'>): string {
  return amount.toFixed(2)
}
console.log(displayAmount(19.5))`
      )
    },
    IObjectPathWriteValue: {
      ...alias(
        'Type accepted when writing at a path (literals widened).',
        '在某个路径写入时可接受的类型（字面量会被放宽）。'
      ),
      scenarios: [
        t(
          'Accept a new theme string even when the document type records the current theme as a single literal.',
          '文档类型把当前主题写成固定字面量，但编辑器需要接收另一个字符串时，用这个类型描述替换值。'
        )
      ],
      example: t(
        `/** Accept a new theme string even when the document type records the current theme as a single literal. */
import { createPathAccessor, type IObjectPathWriteValue } from '@migaia/utils/object-path'
type ITheme = { mode: 'light' }
const replacement: IObjectPathWriteValue<ITheme, 'mode'> = 'dark'
const theme = createPathAccessor<ITheme>({ mode: 'light' })
console.log(theme.set('mode', replacement))`,
        `/** 文档类型把当前主题写成固定字面量，但编辑器需要接收另一个字符串时，用这个类型描述替换值。 */
import { createPathAccessor, type IObjectPathWriteValue } from '@migaia/utils/object-path'
type ITheme = { mode: 'light' }
const replacement: IObjectPathWriteValue<ITheme, 'mode'> = 'dark'
const theme = createPathAccessor<ITheme>({ mode: 'light' })
console.log(theme.set('mode', replacement))`
      )
    },
    IPathAccessor: {
      summary: t(
        'Stateful path reader/writer from `createPathAccessor()`.',
        '`createPathAccessor()` 返回的有状态路径读写器。'
      ),
      scenarios: [
        t(
          'Edit a nested settings document by paths coming from a form.',
          '用来自表单的路径编辑嵌套的设置文档。'
        ),
        t(
          'Audit or redact values read by path before they reach the UI.',
          '在值到达界面之前，审计或脱敏按路径读取的值。'
        )
      ],
      example: t(
        `import { createPathAccessor } from '@migaia/utils/object-path'

const settings = createPathAccessor({ theme: { mode: 'light' } }, {
  ifMissing: (probe) => console.warn('Missing path', probe.segments)
})
settings.set('theme.mode', 'dark')
console.log(settings.get('theme.mode')) // 'dark'`,
        `import { createPathAccessor } from '@migaia/utils/object-path'

const settings = createPathAccessor({ theme: { mode: 'light' } }, {
  ifMissing: (probe) => console.warn('缺少路径', probe.segments)
})
settings.set('theme.mode', 'dark')
console.log(settings.get('theme.mode')) // 'dark'`
      ),
      members: {
        value: {
          summary: t('Current root after the latest `set`.', '最近一次 `set` 之后的当前根对象。')
        },
        get: {
          summary: t(
            'Reads a path; `undefined` when missing (hooks are notified).',
            '读取路径；缺失时返回 `undefined`（并通知钩子）。'
          ),
          params: { path: t('Path to read.', '要读取的路径。') },
          returns: t('The value or `undefined`.', '读取到的值或 `undefined`。'),
          example: `accessor.get('user.name')`
        },
        set: {
          summary: t(
            'Writes immutably and advances `value` to the new root.',
            '以不可变方式写入，并把 `value` 更新为新根。'
          ),
          params: {
            path: t('Path to write.', '要写入的路径。'),
            value: t('Value to write (`onSet` may replace it).', '要写入的值（`onSet` 可替换它）。')
          },
          returns: t('The new root.', '新的根对象。'),
          example: `accessor.set('user.name', 'Grace')`
        },
        probeValue: {
          summary: t(
            'Returns reflection failures as probe results; invalid path syntax still throws `OBJECT_PATH_INVALID`.',
            '把反射读取失败作为探测结果返回；路径语法不合法仍抛 `OBJECT_PATH_INVALID`。'
          ),
          params: { path: t('Path to probe.', '要探测的路径。') },
          returns: t('An `IPathProbe`.', '一个路径探测结果 `IPathProbe`。'),
          example: `accessor.probeValue('user.age').kind // 'missing'`
        },
        parsePath: {
          summary: t(
            'Parses a path with the same rules as `parseObjectPath`.',
            '按与 `parseObjectPath` 相同的规则解析路径。'
          ),
          params: { path: t('Path to parse.', '要解析的路径。') },
          returns: t('The segment tuple.', '路径段元组。'),
          example: `accessor.parsePath('a.[0]') // ['a', 0]`
        }
      }
    },
    IPathAccessorOptions: {
      scenarios: [
        t(
          'Keep a typed read policy that trims a display name whenever a path accessor reads it.',
          '界面每次读取姓名都需要去掉首尾空白时，用这个选项类型保存读取处理规则。'
        )
      ],
      example: t(
        `/** Keep a typed read policy that trims a display name whenever a path accessor reads it. */
import { createPathAccessor, type IPathAccessorOptions } from '@migaia/utils/object-path'
type IProfile = { name: string }
const displayPolicy: IPathAccessorOptions<IProfile> = {
  onGet: (event) => event.replace(event.value.trim())
}
const profile = createPathAccessor<IProfile>({ name: ' Ada ' }, displayPolicy)
console.log(profile.get('name'))`,
        `/** 界面每次读取姓名都需要去掉首尾空白时，用这个选项类型保存读取处理规则。 */
import { createPathAccessor, type IPathAccessorOptions } from '@migaia/utils/object-path'
type IProfile = { name: string }
const displayPolicy: IPathAccessorOptions<IProfile> = {
  onGet: (event) => event.replace(event.value.trim())
}
const profile = createPathAccessor<IProfile>({ name: ' Ada ' }, displayPolicy)
console.log(profile.get('name'))`
      ),
      summary: t(
        'Hooks of `createPathAccessor()`.',
        '`createPathAccessor()` 的钩子选项，用于观察和改写每次读写。'
      ),
      members: {
        ifMissing: {
          summary: t(
            'Called when a read finds a missing segment.',
            '读取时遇到缺失的路径段时调用。'
          ),
          default: t(
            'Not set: missing reads just return `undefined`.',
            '不设置：缺失时只返回 `undefined`。'
          )
        },
        ifBlocked: {
          summary: t(
            'Called when a read meets a non-object on the way.',
            '读取途中遇到非对象值时调用。'
          ),
          default: t('Not set.', '不设置：被阻断时只返回 `undefined`。')
        },
        ifFailed: {
          summary: t(
            'Called when a getter throws during a read.',
            '读取过程中 getter 抛错时调用。'
          ),
          default: t('Not set: the error is not reported.', '不设置：错误不会被上报。')
        },
        onGet: {
          summary: t(
            'Called after each successful `get`; `event.replace(value)` changes the returned value.',
            '每次成功 `get` 后调用；`event.replace(value)` 可改变返回值。'
          ),
          default: t('Not set.', '不设置：原样返回读取到的值。')
        },
        onSet: {
          summary: t(
            'Called before each `set` is applied; `event.replace(value)` changes the written value.',
            '每次 `set` 生效前调用；`event.replace(value)` 可改变写入的值。'
          ),
          default: t('Not set.', '不设置：原样写入传入的值。')
        }
      }
    },
    IPathBlockedProbe: {
      scenarios: [
        t(
          'Handle a path that stops at a null parent separately from an absent property.',
          '路径读取在空的父级值处停止时，用这个类型接收阻断信息，区别于属性不存在。'
        )
      ],
      example: t(
        `/** Handle a path that stops at a null parent separately from an absent property. */
import { createPathAccessor, type IPathBlockedProbe } from '@migaia/utils/object-path'
function showBlocked(problem: IPathBlockedProbe): void {
  console.warn(problem.failedKey, problem.parent)
}
const profile = createPathAccessor<{ user: { name: string } | null }>({ user: null }, {
  ifBlocked: showBlocked
})
profile.get('user.name')`,
        `/** 路径读取在空的父级值处停止时，用这个类型接收阻断信息，区别于属性不存在。 */
import { createPathAccessor, type IPathBlockedProbe } from '@migaia/utils/object-path'
function showBlocked(problem: IPathBlockedProbe): void {
  console.warn(problem.failedKey, problem.parent)
}
const profile = createPathAccessor<{ user: { name: string } | null }>({ user: null }, {
  ifBlocked: showBlocked
})
profile.get('user.name')`
      ),
      summary: t(
        'Probe result: a non-object was met on the way.',
        '探测结果：读取途中遇到了非对象值。'
      ),
      members: probeMembers('blocked')
    },
    IPathFailedProbe: {
      scenarios: [
        t(
          'Report the original thrown value when reading a path invokes a getter that fails.',
          '按路径读取属性时，如果取值函数抛错，用这个类型接收并报告原始错误。'
        )
      ],
      example: t(
        `/** Report the original thrown value when reading a path invokes a getter that fails. */
import { probeObjectPath, type IPathFailedProbe } from '@migaia/utils/object-path'
function reportReadFailure(problem: IPathFailedProbe): void {
  console.error(problem.failedKey, problem.error)
}
const result = probeObjectPath({ get balance(): number { throw new TypeError() } }, 'balance')
if (result.kind === 'failed') reportReadFailure(result)`,
        `/** 按路径读取属性时，如果取值函数抛错，用这个类型接收并报告原始错误。 */
import { probeObjectPath, type IPathFailedProbe } from '@migaia/utils/object-path'
function reportReadFailure(problem: IPathFailedProbe): void {
  console.error(problem.failedKey, problem.error)
}
const result = probeObjectPath({ get balance(): number { throw new TypeError() } }, 'balance')
if (result.kind === 'failed') reportReadFailure(result)`
      ),
      summary: t(
        'Probe result: a getter or proxy threw.',
        '探测结果：某个 getter 或 Proxy 抛出了错误。'
      ),
      members: probeMembers('failed')
    },
    IPathMissingProbe: {
      scenarios: [
        t(
          'Report which segment is absent when an optional settings branch has not been created.',
          '可选设置分支尚未建立时，用这个类型报告路径中缺失的具体字段。'
        )
      ],
      example: t(
        `/** Report which segment is absent when an optional settings branch has not been created. */
import { createPathAccessor, type IPathMissingProbe } from '@migaia/utils/object-path'
function showMissing(problem: IPathMissingProbe): void {
  console.warn(problem.failedKey, problem.resolvedPath)
}
const settings = createPathAccessor<{ display?: { scale: number } }>({}, {
  ifMissing: showMissing
})
settings.get('display.scale')`,
        `/** 可选设置分支尚未建立时，用这个类型报告路径中缺失的具体字段。 */
import { createPathAccessor, type IPathMissingProbe } from '@migaia/utils/object-path'
function showMissing(problem: IPathMissingProbe): void {
  console.warn(problem.failedKey, problem.resolvedPath)
}
const settings = createPathAccessor<{ display?: { scale: number } }>({}, {
  ifMissing: showMissing
})
settings.get('display.scale')`
      ),
      summary: t('Probe result: a segment does not exist.', '探测结果：某个路径段不存在。'),
      members: probeMembers('missing')
    },
    IPathValueProbe: {
      scenarios: [
        t(
          'Pass a successful path result to a function that only accepts a confirmed numeric field value.',
          '探测已确认读到数值后，用这个类型把成功结果传给只处理该字段的函数。'
        )
      ],
      example: t(
        `/** Pass a successful path result to a function that only accepts a confirmed numeric field value. */
import { probeObjectPath, type IPathValueProbe } from '@migaia/utils/object-path'
type IStock = { available: number }
function displayAvailable(result: IPathValueProbe<IStock, 'available'>): string {
  return String(result.value)
}
const result = probeObjectPath<IStock, 'available'>({ available: 12 }, 'available')
if (result.kind === 'value') console.log(displayAvailable(result))`,
        `/** 探测已确认读到数值后，用这个类型把成功结果传给只处理该字段的函数。 */
import { probeObjectPath, type IPathValueProbe } from '@migaia/utils/object-path'
type IStock = { available: number }
function displayAvailable(result: IPathValueProbe<IStock, 'available'>): string {
  return String(result.value)
}
const result = probeObjectPath<IStock, 'available'>({ available: 12 }, 'available')
if (result.kind === 'value') console.log(displayAvailable(result))`
      ),
      summary: t('Probe result: the value was read.', '探测结果：成功读取到了值。'),
      members: {
        kind: {
          summary: t('Always `value`: the read succeeded.', '固定为 `value`，表示读取已经成功。')
        },
        originKey: {
          summary: t('The path exactly as the caller passed it.', '调用方传入的原始路径。')
        },
        segments: { summary: t('The parsed path as a segment tuple.', '解析后得到的路径段元组。') },
        value: { summary: t('The value that was read at the path.', '在该路径上读取到的值。') }
      }
    },
    IPathProbe: {
      summary: t(
        'Union of value, missing, blocked and failed results returned by the object-path probe.',
        '对象路径探测返回的值、缺失、阻断和失败四种结果联合。'
      ),
      scenarios: [
        t(
          'Distinguish absent paths, non-object intermediates and thrown reads while inspecting nested configuration.',
          '检查嵌套配置时区分缺失路径、非对象中间值和读取抛错。'
        )
      ],
      example: t(
        `import { probeObjectPath } from '@migaia/utils/object-path'

const result = probeObjectPath({ user: { name: 'Ada' } }, 'user.name')
if (result.kind === 'value') console.log(result.value)
else console.log(result.kind, result.failedAt)`,
        `import { probeObjectPath } from '@migaia/utils/object-path'

const result = probeObjectPath({ user: { name: 'Ada' } }, 'user.name')
if (result.kind === 'value') console.log(result.value)
else console.log(result.kind, result.failedAt)`
      ),
      members: {}
    },
    IPathGetEvent: {
      scenarios: [
        t(
          'Declare a reusable read hook that replaces an empty display name before returning it to a caller.',
          '读取显示姓名时需要为空字符串提供替代值，可用这个类型声明可复用的读取回调参数。'
        )
      ],
      example: t(
        `/** Declare a reusable read hook that replaces an empty display name before returning it to a caller. */
import { createPathAccessor, type IPathGetEvent } from '@migaia/utils/object-path'
type IProfile = { name: string }
function fillDisplayName(event: IPathGetEvent<IProfile>): void {
  if (event.value === '') event.replace('Guest')
}
const profile = createPathAccessor<IProfile>({ name: '' }, { onGet: fillDisplayName })
console.log(profile.get('name'))`,
        `/** 读取显示姓名时需要为空字符串提供替代值，可用这个类型声明可复用的读取回调参数。 */
import { createPathAccessor, type IPathGetEvent } from '@migaia/utils/object-path'
type IProfile = { name: string }
function fillDisplayName(event: IPathGetEvent<IProfile>): void {
  if (event.value === '') event.replace('Guest')
}
const profile = createPathAccessor<IProfile>({ name: '' }, { onGet: fillDisplayName })
console.log(profile.get('name'))`
      ),
      summary: t('Event passed to `onGet`.', '每次成功读取后传给 `onGet` 的事件对象。'),
      members: {
        originKey: {
          summary: t('The path exactly as the caller passed it.', '调用方传入的原始路径。')
        },
        segments: { summary: t('The parsed path as a segment tuple.', '解析后得到的路径段元组。') },
        probe: {
          summary: t('The probe result of this successful read.', '本次成功读取对应的探测结果。')
        },
        value: { summary: t('The value that was read at the path.', '在该路径上读取到的值。') },
        replace: {
          summary: t('Replaces the value returned to the caller.', '替换返回给调用方的值。'),
          params: { value: t('Replacement value.', '替换后的值。') },
          returns: t('Nothing.', '无返回值；调用方将拿到替换后的值。')
        }
      }
    },
    IPathSetEvent: {
      scenarios: [
        t(
          'Declare a reusable write hook that keeps an edited page size within the application limit.',
          '编辑每页条数时需要限制最大值，可用这个类型声明写入回调参数，再替换本次写入值。'
        )
      ],
      example: t(
        `/** Declare a reusable write hook that keeps an edited page size within the application limit. */
import { createPathAccessor, type IPathSetEvent } from '@migaia/utils/object-path'
type IPagination = { pageSize: number }
function limitPageSize(event: IPathSetEvent<IPagination>): void {
  event.replace(Math.min(100, Math.max(1, event.value)))
}
const pagination = createPathAccessor<IPagination>({ pageSize: 20 }, { onSet: limitPageSize })
console.log(pagination.set('pageSize', 500))`,
        `/** 编辑每页条数时需要限制最大值，可用这个类型声明写入回调参数，再替换本次写入值。 */
import { createPathAccessor, type IPathSetEvent } from '@migaia/utils/object-path'
type IPagination = { pageSize: number }
function limitPageSize(event: IPathSetEvent<IPagination>): void {
  event.replace(Math.min(100, Math.max(1, event.value)))
}
const pagination = createPathAccessor<IPagination>({ pageSize: 20 }, { onSet: limitPageSize })
console.log(pagination.set('pageSize', 500))`
      ),
      summary: t('Event passed to `onSet`.', '每次写入生效前传给 `onSet` 的事件对象。'),
      members: {
        originKey: {
          summary: t('The path exactly as the caller passed it.', '调用方传入的原始路径。')
        },
        segments: { summary: t('The parsed path as a segment tuple.', '解析后得到的路径段元组。') },
        probe: {
          summary: t(
            'Synthetic successful probe containing the proposed new value; it does not read the old value.',
            '携带拟写入新值的合成成功探测结果；不会读取旧值。'
          )
        },
        value: {
          summary: t('The value about to be written at the path.', '即将写入该路径的新值。')
        },
        replace: {
          summary: t(
            'Replaces the actual written value without rewriting event.value or the synthetic probe value.',
            '替换实际写入值，但不回写事件的值或合成探测结果的值。'
          ),
          params: { value: t('Replacement value.', '替换后的值。') },
          returns: t('Nothing.', '无返回值；实际写入替换后的值。')
        }
      }
    },
    IAbortSignal: {
      scenarios: [
        t(
          'Accept a caller cancellation signal in a shared delay function without requiring a particular signal class.',
          '封装延时函数并接收调用方的取消信号时，用这个结构类型约束参数，不要求继承特定信号类。'
        )
      ],
      example: t(
        `/** Accept a caller cancellation signal in a shared delay function without requiring a particular signal class. */
import { sleep, type IAbortSignal } from '@migaia/utils/promise'
function waitBeforeRefresh(signal: IAbortSignal): Promise<void> {
  return sleep(250, { signal })
}
const controller = new AbortController()
await waitBeforeRefresh(controller.signal)`,
        `/** 封装延时函数并接收调用方的取消信号时，用这个结构类型约束参数，不要求继承特定信号类。 */
import { sleep, type IAbortSignal } from '@migaia/utils/promise'
function waitBeforeRefresh(signal: IAbortSignal): Promise<void> {
  return sleep(250, { signal })
}
const controller = new AbortController()
await waitBeforeRefresh(controller.signal)`
      ),
      summary: t(
        'Structural shape of an `AbortSignal` accepted by this package.',
        '本包接受的 `AbortSignal` 结构形状，原生信号天然满足。'
      ),
      members: {
        aborted: {
          summary: t('`true` once the signal has aborted.', '信号已经被中止之后为 `true`。')
        },
        reason: { summary: t('Reason passed to `abort()`.', '调用 `abort()` 时传入的中止原因。') },
        addEventListener: {
          summary: t(
            'Registers a listener for the `abort` event.',
            '为 `abort` 事件登记一个监听函数。'
          ),
          params: {
            type: t('Always the event name `abort`.', '固定为事件名 `abort`。'),
            listener: t('Callback.', '中止时调用的回调。'),
            options: t('Listener options such as `once`.', '监听选项，例如 `once`。')
          },
          returns: t('Nothing.', '无返回值；监听已登记。')
        },
        removeEventListener: {
          summary: t('Stops listening for `abort`.', '移除之前为 `abort` 事件登记的监听。'),
          params: {
            type: t('Always the event name `abort`.', '固定为事件名 `abort`。'),
            listener: t('The registered callback.', '之前登记的回调。')
          },
          returns: t('Nothing.', '无返回值；监听已移除。')
        }
      }
    },
    IAbortOperation: {
      ...alias(
        'Operation of `raceWithAbort()`: `({ signal }) => value | Promise`.',
        '`raceWithAbort()` 执行的操作函数，接收信号：`({ signal }) => value | Promise`。'
      ),
      scenarios: [
        t(
          'Name a cancellable request operation before passing it to raceWithAbort() with a caller-owned signal.',
          '需要先定义可取消的请求操作，再由调用方信号控制 raceWithAbort() 时，用这个函数类型。'
        )
      ],
      example: t(
        `/** Name a cancellable request operation before passing it to raceWithAbort() with a caller-owned signal. */
import { raceWithAbort, type IAbortOperation } from '@migaia/utils/promise'
const loadProfile: IAbortOperation<string> = async ({ signal }) => {
  const response = await fetch('/api/profile', { signal })
  return response.text()
}
const controller = new AbortController()
console.log(await raceWithAbort(loadProfile, { signal: controller.signal }))`,
        `/** 需要先定义可取消的请求操作，再由调用方信号控制 raceWithAbort() 时，用这个函数类型。 */
import { raceWithAbort, type IAbortOperation } from '@migaia/utils/promise'
const loadProfile: IAbortOperation<string> = async ({ signal }) => {
  const response = await fetch('/api/profile', { signal })
  return response.text()
}
const controller = new AbortController()
console.log(await raceWithAbort(loadProfile, { signal: controller.signal }))`
      )
    },
    IAbortSignalAdmission: {
      summary: t(
        'One structural signal admission result returned by `admitAbortSignal()`, preserving a captured aborted flag or rejection reason.',
        '`admitAbortSignal()` 返回的单次结构信号接纳结果，保留捕获的中止标志或拒绝原因。'
      ),
      scenarios: [
        t(
          'Admit a caller-supplied signal without subscribing or reading its cancellation reason.',
          '接纳调用方信号，同时不订阅也不读取取消原因。'
        )
      ],
      example: t(
        `import { admitAbortSignal } from '@migaia/utils/promise'

const result = admitAbortSignal(new AbortController().signal)
if (result.kind === 'valid') console.log(result.aborted)
else console.error(result.reason, result.cause)`,
        `import { admitAbortSignal } from '@migaia/utils/promise'

const result = admitAbortSignal(new AbortController().signal)
if (result.kind === 'valid') console.log(result.aborted)
else console.error(result.reason, result.cause)`
      ),
      members: {
        kind: {
          summary: t(
            'Admission discriminant: valid retains the signal and one flag read, invalid carries the rejection reason.',
            '接纳判别值：有效分支保留信号和一次标志读取，无效分支携带拒绝原因。'
          ),
          values: {
            valid: t(
              'Required structural methods and the boolean aborted value were admitted.',
              '必需结构方法与布尔中止状态均已通过接纳。'
            ),
            invalid: t(
              'The candidate failed admission without installing any listener.',
              '候选值未通过接纳，且没有安装任何监听。'
            )
          }
        },
        signal: {
          summary: t(
            'The exact caller-supplied structural signal, present only in the valid branch.',
            '调用方提供的同一个结构信号，仅有效分支存在。'
          )
        },
        aborted: {
          summary: t(
            'Boolean flag captured from the signal exactly once at admission; later mutation does not change this snapshot.',
            '接纳时从信号精确读取一次的布尔标志；后续变化不会改变快照。'
          )
        },
        reason: {
          summary: t(
            'Structural rejection reason supplied by admission, not the cancellation value from signal.reason.',
            '接纳提供的结构拒绝原因，不是信号原因属性中的取消值。'
          ),
          values: {
            'not-object': t(
              'Candidate is not an admissible object or function, or is an array.',
              '候选不是可接纳对象或函数，或属于数组。'
            ),
            'aborted-not-boolean': t(
              'The aborted field was read but did not return a boolean.',
              '已读取中止字段，但返回值不是布尔值。'
            ),
            'aborted-threw': t(
              'The single aborted property read threw an original value.',
              '单次读取中止属性时抛出原始失败值。'
            ),
            'listener-not-function': t(
              'Required listener methods are missing, non-callable or inaccessible.',
              '必需监听方法缺失、不可调用或无法访问。'
            )
          }
        },
        cause: {
          summary: t(
            'Optional exact failure thrown by shape inspection or an accessor; plain shape mismatches have no cause.',
            '形状检查或访问器抛出的可选精确失败；普通形状不匹配没有原因值。'
          )
        }
      }
    },
    IAbortSignalRejection: {
      ...alias(
        'Reasons why `admitAbortSignal()` rejects a value.',
        '`admitAbortSignal()` 拒绝某个值的原因取值。'
      ),
      scenarios: [
        t(
          'Store the rejection reason from admitAbortSignal() when checking an unknown signal supplied by another component.',
          '检查其他组件传来的未知信号时，用这个类型保存 admitAbortSignal() 返回的拒绝原因。'
        )
      ],
      example: t(
        `/** Store the rejection reason from admitAbortSignal() when checking an unknown signal supplied by another component. */
import { admitAbortSignal, type IAbortSignalRejection } from '@migaia/utils/promise'
const checked = admitAbortSignal({ aborted: 'no' })
if (checked.kind === 'invalid') {
  const rejection: IAbortSignalRejection = checked.reason
  console.warn(rejection)
}`,
        `/** 检查其他组件传来的未知信号时，用这个类型保存 admitAbortSignal() 返回的拒绝原因。 */
import { admitAbortSignal, type IAbortSignalRejection } from '@migaia/utils/promise'
const checked = admitAbortSignal({ aborted: 'no' })
if (checked.kind === 'invalid') {
  const rejection: IAbortSignalRejection = checked.reason
  console.warn(rejection)
}`
      )
    },
    IAbortTimeoutSignal: {
      summary: t(
        'Result of `createAbortTimeoutSignal()`.',
        '`createAbortTimeoutSignal()` 的结果：组合后的信号与释放函数。'
      ),
      scenarios: [
        t(
          'Share one deadline across parallel requests of one transaction.',
          '让同一事务中的多个并行请求共享同一个截止时间。'
        )
      ],
      example: t(
        `import { createAbortTimeoutSignal, sleep, type IAbortTimeoutSignal } from '@migaia/utils/promise'

/** Two parallel waits share one deadline and its cleanup. */
const deadline: IAbortTimeoutSignal = createAbortTimeoutSignal({ timeoutMs: 500 })
try {
  await Promise.all([sleep(10, { signal: deadline.signal }), sleep(20, { signal: deadline.signal })])
} finally {
  deadline.dispose()
}`,
        `import { createAbortTimeoutSignal, sleep, type IAbortTimeoutSignal } from '@migaia/utils/promise'

/** 两个并行等待共用一个截止时间和清理函数。 */
const deadline: IAbortTimeoutSignal = createAbortTimeoutSignal({ timeoutMs: 500 })
try {
  await Promise.all([sleep(10, { signal: deadline.signal }), sleep(20, { signal: deadline.signal })])
} finally {
  deadline.dispose()
}`
      ),
      members: {
        signal: {
          summary: t(
            'The combined signal; the outside signal itself without `timeoutMs`.',
            '组合后的信号；未设置 `timeoutMs` 时就是外部信号本身。'
          )
        },
        dispose: {
          summary: t(
            'Clears the timer and listeners; calling it again does nothing.',
            '清除计时器与监听；重复调用没有效果。'
          )
        }
      }
    },
    IAbortTimeoutSignalOptions: {
      scenarios: [
        t(
          'Prepare a combined caller signal and timeout for an adapter that consumes a cancellation signal.',
          '适配器只接收取消信号，但调用方还需要超时时，用这个选项类型配置外部信号与时限。'
        )
      ],
      example: t(
        `/** Prepare a combined caller signal and timeout for an adapter that consumes a cancellation signal. */
import { createAbortTimeoutSignal, type IAbortTimeoutSignalOptions } from '@migaia/utils/promise'
const controller = new AbortController()
const requestOptions: IAbortTimeoutSignalOptions = { signal: controller.signal, timeoutMs: 1000 }
const request = createAbortTimeoutSignal(requestOptions)
try {
  console.log(request.signal?.aborted)
} finally {
  request.dispose()
}`,
        `/** 适配器只接收取消信号，但调用方还需要超时时，用这个选项类型配置外部信号与时限。 */
import { createAbortTimeoutSignal, type IAbortTimeoutSignalOptions } from '@migaia/utils/promise'
const controller = new AbortController()
const requestOptions: IAbortTimeoutSignalOptions = { signal: controller.signal, timeoutMs: 1000 }
const request = createAbortTimeoutSignal(requestOptions)
try {
  console.log(request.signal?.aborted)
} finally {
  request.dispose()
}`
      ),
      summary: t(
        'Options of `createAbortTimeoutSignal()`.',
        '`createAbortTimeoutSignal()` 的选项：外部信号、截止时间与计时器。'
      ),
      members: {
        signal: {
          summary: t('Outside signal to follow.', '要跟随的外部信号，它中止时组合信号也随之中止。'),
          default: t('Not set: only the deadline aborts.', '不设置：只由截止时间触发中止。')
        },
        timeoutMs: {
          summary: t('Deadline in milliseconds.', '截止时间，单位毫秒；到期后组合信号中止。'),
          default: t(
            'Not set: no deadline; the outside signal is returned as is.',
            '不设置：没有截止时间，原样返回外部信号。'
          )
        },
        scheduler: {
          summary: t(
            'Clock and timers used to measure the deadline.',
            '计算截止时间所用的时钟与计时器。'
          ),
          default: t('`systemScheduler`.', '`systemScheduler`，宿主原生计时器。')
        },
        timeoutReason: {
          summary: t(
            'Builds the abort reason used when the deadline passes.',
            '构造截止时间到达时使用的中止原因。'
          ),
          default: t(
            'No custom reason: host `abort(undefined)` normalizes to its native AbortError.',
            '不指定原因：宿主 `abort(undefined)` 规整为其原生中止错误。'
          )
        },
        report: {
          summary: reportText,
          default: t('`hostRethrowReporter`.', '`hostRethrowReporter`，在微任务中重新抛出。')
        }
      }
    },
    IAsyncControls: {
      scenarios: [
        t(
          'Share one caller signal across several waits without repeating the cancellation options at every call.',
          '多个等待步骤共用调用方的取消信号时，用这个类型保存并传递公共控制选项。'
        )
      ],
      example: t(
        `/** Share one caller signal across several waits without repeating the cancellation options at every call. */
import { sleep, type IAsyncControls } from '@migaia/utils/promise'
const controller = new AbortController()
const refreshControls: IAsyncControls = { signal: controller.signal }
await sleep(100, refreshControls)
await sleep(200, refreshControls)`,
        `/** 多个等待步骤共用调用方的取消信号时，用这个类型保存并传递公共控制选项。 */
import { sleep, type IAsyncControls } from '@migaia/utils/promise'
const controller = new AbortController()
const refreshControls: IAsyncControls = { signal: controller.signal }
await sleep(100, refreshControls)
await sleep(200, refreshControls)`
      ),
      summary: t(
        'Cancellation and timing options shared by the promise helpers.',
        'promise 系列函数共用的取消与计时选项。'
      ),
      members: asyncControlMembers
    },
    IConcurrencyLimiter: {
      summary: t(
        'Task gate returned by `createConcurrencyLimiter()`.',
        '`createConcurrencyLimiter()` 返回的并发任务闸门，控制同时运行的任务数量。'
      ),
      scenarios: [
        t(
          'Fetch hundreds of URLs with at most four requests in flight.',
          '批量请求数百个地址，同时最多四个请求在途。'
        ),
        t(
          'Protect a rate-limited API from bursts inside one process.',
          '在单个进程内保护有限流的接口免受突发请求冲击。'
        )
      ],
      example: t(
        `import { createConcurrencyLimiter, type IConcurrencyLimiter } from '@migaia/utils/promise'

/** Preparation jobs share two available execution slots. */
const limiter: IConcurrencyLimiter = createConcurrencyLimiter({ concurrency: 2 })
try {
  /** Each job produces one prepared label. */
  const results = await Promise.allSettled(['cover', 'index', 'appendix'].map((section) =>
    limiter.run(async () => section.toUpperCase())
  ))
  console.log(results, limiter.activeCount, limiter.pendingCount)
} finally {
  await limiter.dispose()
}`,
        `import { createConcurrencyLimiter, type IConcurrencyLimiter } from '@migaia/utils/promise'

/** 准备任务共用两个可执行名额。 */
const limiter: IConcurrencyLimiter = createConcurrencyLimiter({ concurrency: 2 })
try {
  /** 每个任务生成一个准备完成的标签。 */
  const results = await Promise.allSettled(['cover', 'index', 'appendix'].map((section) =>
    limiter.run(async () => section.toUpperCase())
  ))
  console.log(results, limiter.activeCount, limiter.pendingCount)
} finally {
  await limiter.dispose()
}`
      ),
      members: {
        run: {
          summary: t(
            'Queues `task`; it starts when a slot is free.',
            '把 `task` 加入队列，有空位时开始执行。'
          ),
          params: {
            task: t(
              '`({ signal }) => value | Promise`; read the signal to stop early.',
              '`({ signal }) => value | Promise`；读取 signal 以便提前停止。'
            ),
            options: t(
              '`signal` cancels the task while it is still queued.',
              '`signal` 可以在任务仍在排队时取消它。'
            )
          },
          returns: t(
            'The task result; tasks submitted after `close()` reject with `LIMITER_CLOSED`.',
            '任务的结果；`close()` 之后提交的任务以 `LIMITER_CLOSED` reject。'
          ),
          example: `const user = await limiter.run(() => fetchUser(id))`
        },
        activeCount: { summary: t('Number of running tasks.', '当前正在运行的任务数量。') },
        pendingCount: {
          summary: t('Number of queued, not cancelled tasks.', '仍在排队且未被取消的任务数量。')
        },
        whenIdle: {
          summary: t(
            'Resolves when nothing runs and the queue is empty.',
            '没有任务运行且队列为空时 resolve。'
          ),
          returns: t('A shared Promise.', '多个调用共享的同一个 Promise。'),
          example: `await limiter.whenIdle()`
        },
        close: {
          summary: t(
            'Stops admission: queued tasks reject with `reason`; running tasks continue.',
            '停止接收任务：排队中的任务以 `reason` reject，运行中的任务继续执行。'
          ),
          params: {
            reason: t(
              'Rejection reason (default `LIMITER_CLOSED`).',
              '拒绝原因（默认 `LIMITER_CLOSED`）。'
            )
          },
          returns: t('Nothing.', '无返回值；之后提交的任务都会被拒绝。'),
          example: `limiter.close(new Error('服务关闭'))`
        },
        dispose: {
          summary: t(
            'Calls `close()` and resolves after running tasks finished.',
            '调用 `close()`，并在运行中的任务全部结束后 resolve。'
          ),
          params: { reason: t('Rejection reason for queued tasks.', '排队任务的拒绝原因。') },
          returns: t('Resolves when drained.', '全部排空后 resolve。'),
          example: `await limiter.dispose()`
        }
      }
    },
    IDeadlineOnlyOperation: {
      ...alias(
        'Operation of `withTimeout({ cooperativeCancellation: false })`; receives a never-aborting signal.',
        '`withTimeout({ cooperativeCancellation: false })` 的操作函数，收到的是永不中止的信号。'
      ),
      scenarios: [
        t(
          'Limit how long a caller waits for work that has no cancellation support, without treating the supplied signal as a native host signal.',
          '底层工作不支持取消、但调用方需要限制等待时间时，用这个函数类型配合关闭协作取消的选项。'
        )
      ],
      example: t(
        `/** Limit how long a caller waits for work that has no cancellation support, without treating the supplied signal as a native host signal. */
import { withTimeout, type IDeadlineOnlyOperation } from '@migaia/utils/promise'
const readCachedTitle: IDeadlineOnlyOperation<string> = () => Promise.resolve('Dashboard')
console.log(await withTimeout(readCachedTitle, {
  timeoutMs: 500, cooperativeCancellation: false
}))`,
        `/** 底层工作不支持取消、但调用方需要限制等待时间时，用这个函数类型配合关闭协作取消的选项。 */
import { withTimeout, type IDeadlineOnlyOperation } from '@migaia/utils/promise'
const readCachedTitle: IDeadlineOnlyOperation<string> = () => Promise.resolve('Dashboard')
console.log(await withTimeout(readCachedTitle, {
  timeoutMs: 500, cooperativeCancellation: false
}))`
      )
    },
    IDeferred: {
      summary: t(
        'A Promise with its resolve and reject functions.',
        '附带 resolve 与 reject 函数、可由外部结算的 Promise。'
      ),
      scenarios: [
        t(
          'Bridge an event API to a Promise another component awaits.',
          '把事件接口桥接为另一组件等待的 Promise。'
        )
      ],
      example: t(
        `import { deferred, type IDeferred } from '@migaia/utils/promise'

/** A callback completes a promise that its caller can await. */
const ready: IDeferred<string> = deferred<string>()
queueMicrotask(() => ready.resolve('connected'))
console.log(await ready.promise)`,
        `import { deferred, type IDeferred } from '@migaia/utils/promise'

/** 回调完成一个可供调用方等待的承诺。 */
const ready: IDeferred<string> = deferred<string>()
queueMicrotask(() => ready.resolve('connected'))
console.log(await ready.promise)`
      ),
      members: {
        promise: {
          summary: t(
            'The Promise that `resolve` and `reject` settle.',
            '尚未结算的 Promise，等待外部结算。'
          )
        },
        resolve: {
          summary: t(
            'Fulfils the Promise with the given value.',
            '以传入的值兑现该 Promise，等待者随即继续执行。'
          )
        },
        reject: {
          summary: t(
            'Rejects the Promise with the given reason.',
            '以传入的原因拒绝该 Promise，等待者随即收到错误。'
          )
        }
      }
    },
    INativeAbortSignal: {
      ...alias(
        'The host `AbortSignal` type passed to operations.',
        '传给操作函数的宿主原生 `AbortSignal` 类型。'
      ),
      scenarios: [
        t(
          'Type the signal parameter of a request function that receives the host signal produced by withTimeout().',
          '请求函数接收 withTimeout() 生成并传入的宿主信号时，用这个类型声明信号参数，再交给宿主请求接口。'
        )
      ],
      example: t(
        `/** Type the signal parameter of a request function that receives the host signal produced by withTimeout(). */
import { withTimeout, type INativeAbortSignal } from '@migaia/utils/promise'
async function requestTitle(signal: INativeAbortSignal): Promise<string> {
  const response = await fetch('/api/title', { signal })
  return response.text()
}
console.log(await withTimeout(({ signal }) => requestTitle(signal), { timeoutMs: 1000 }))`,
        `/** 请求函数接收 withTimeout() 生成并传入的宿主信号时，用这个类型声明信号参数，再交给宿主请求接口。 */
import { withTimeout, type INativeAbortSignal } from '@migaia/utils/promise'
async function requestTitle(signal: INativeAbortSignal): Promise<string> {
  const response = await fetch('/api/title', { signal })
  return response.text()
}
console.log(await withTimeout(({ signal }) => requestTitle(signal), { timeoutMs: 1000 }))`
      )
    },
    IRetryContext: {
      scenarios: [
        t(
          'Read the attempt number and pass the attempt signal to a request inside a reusable retry operation.',
          '编写可重用的重试操作时，用这个参数类型读取当前尝试次数，并把本次信号交给请求。'
        )
      ],
      example: t(
        `/** Read the attempt number and pass the attempt signal to a request inside a reusable retry operation. */
import { retry, type IRetryContext } from '@migaia/utils/promise'
async function loadStatus(context: IRetryContext): Promise<string> {
  console.log(context.attempt)
  const response = await fetch('/api/status', { signal: context.signal })
  return response.text()
}
console.log(await retry(loadStatus, { maxAttempts: 3, shouldRetry: () => true }))`,
        `/** 编写可重用的重试操作时，用这个参数类型读取当前尝试次数，并把本次信号交给请求。 */
import { retry, type IRetryContext } from '@migaia/utils/promise'
async function loadStatus(context: IRetryContext): Promise<string> {
  console.log(context.attempt)
  const response = await fetch('/api/status', { signal: context.signal })
  return response.text()
}
console.log(await retry(loadStatus, { maxAttempts: 3, shouldRetry: () => true }))`
      ),
      summary: t('Context passed to each retry attempt.', '每次重试尝试收到的上下文。'),
      members: {
        attempt: { summary: t('Attempt number, starting at 1.', '当前尝试的序号，从 1 开始。') },
        signal: {
          summary: t(
            'Signal of this attempt (aborts on timeout or cancellation).',
            '本次尝试的信号（超时或取消时中止）。'
          )
        },
        remainingMs: {
          summary: t(
            'Time left before the total deadline, if set.',
            '距离总截止时间的剩余毫秒数（设置了时才有）。'
          )
        }
      }
    },
    IRetryFailureContext: {
      scenarios: [
        t(
          'Use the current attempt and attempt limit in a retry policy that also reports each failed request.',
          '重试策略需要依据当前次数和次数上限作决定时，用这个类型声明失败回调的上下文，并报告失败。'
        )
      ],
      example: t(
        `/** Use the current attempt and attempt limit in a retry policy that also reports each failed request. */
import { retry, type IRetryFailureContext } from '@migaia/utils/promise'
function retryRequest(error: unknown, context: IRetryFailureContext): boolean {
  console.warn(context.attempt, error)
  return context.attempt < context.maxAttempts
}
const response = await retry(() => fetch('/api/status'), {
  maxAttempts: 3, shouldRetry: retryRequest
})
console.log(response.status)`,
        `/** 重试策略需要依据当前次数和次数上限作决定时，用这个类型声明失败回调的上下文，并报告失败。 */
import { retry, type IRetryFailureContext } from '@migaia/utils/promise'
function retryRequest(error: unknown, context: IRetryFailureContext): boolean {
  console.warn(context.attempt, error)
  return context.attempt < context.maxAttempts
}
const response = await retry(() => fetch('/api/status'), {
  maxAttempts: 3, shouldRetry: retryRequest
})
console.log(response.status)`
      ),
      summary: t(
        'Context passed to `shouldRetry` and `delay`.',
        '每次尝试失败后传给 `shouldRetry` 与 `delay` 的上下文。'
      ),
      members: {
        maxAttempts: {
          summary: t('Configured maximum attempts.', '重试选项中配置的最大尝试次数。')
        },
        attempt: { summary: t('Number of the attempt that failed.', '刚刚失败的那次尝试的序号。') },
        signal: {
          summary: t(
            'Signal of the attempt that just failed, not a total-retry signal; this context has no remainingMs field.',
            '刚失败的那次尝试的信号，并非整个重试共用信号；此上下文不提供剩余时间字段。'
          )
        }
      }
    },
    ITimeoutOperation: {
      ...alias(
        'Operation of `withTimeout()`: `({ signal }) => value | Promise`.',
        '`withTimeout()` 限时执行的操作函数，接收信号：`({ signal }) => value | Promise`。'
      ),
      scenarios: [
        t(
          'Declare a request operation separately from its timeout so different callers can choose their own waiting limit.',
          '同一请求操作需要由不同调用方设置时限时，用这个函数类型先定义操作，再交给 withTimeout()。'
        )
      ],
      example: t(
        `/** Declare a request operation separately from its timeout so different callers can choose their own waiting limit. */
import { withTimeout, type ITimeoutOperation } from '@migaia/utils/promise'
const loadName: ITimeoutOperation<string> = async ({ signal }) => {
  const response = await fetch('/api/name', { signal })
  return response.text()
}
console.log(await withTimeout(loadName, { timeoutMs: 800 }))`,
        `/** 同一请求操作需要由不同调用方设置时限时，用这个函数类型先定义操作，再交给 withTimeout()。 */
import { withTimeout, type ITimeoutOperation } from '@migaia/utils/promise'
const loadName: ITimeoutOperation<string> = async ({ signal }) => {
  const response = await fetch('/api/name', { signal })
  return response.text()
}
console.log(await withTimeout(loadName, { timeoutMs: 800 }))`
      )
    },
    IUtilsReporter: {
      ...alias(
        'Reporter `(error, { operation, phase, attempt? }) => void` for late failures.',
        '接收迟到失败与清理错误的上报函数 `(error, { operation, phase, attempt? }) => void`。'
      ),
      scenarios: [
        t(
          'Supply a typed reporter for cleanup failures or work that rejects after the public timeout result has already settled.',
          '限时调用结束后仍可能收到迟到失败或清理错误时，用这个函数类型接入应用的错误上报。'
        )
      ],
      example: t(
        `/** Supply a typed reporter for cleanup failures or work that rejects after the public timeout result has already settled. */
import { withTimeout, type IUtilsReporter } from '@migaia/utils/promise'
const reportBackgroundFailure: IUtilsReporter = (error, context) => {
  console.error(context.operation, context.phase, error)
}
console.log(await withTimeout(() => Promise.resolve('ready'), {
  timeoutMs: 500, report: reportBackgroundFailure
}))`,
        `/** 限时调用结束后仍可能收到迟到失败或清理错误时，用这个函数类型接入应用的错误上报。 */
import { withTimeout, type IUtilsReporter } from '@migaia/utils/promise'
const reportBackgroundFailure: IUtilsReporter = (error, context) => {
  console.error(context.operation, context.phase, error)
}
console.log(await withTimeout(() => Promise.resolve('ready'), {
  timeoutMs: 500, report: reportBackgroundFailure
}))`
      )
    },
    IManualScheduler: {
      summary: t(
        'Deterministic scheduler from `createManualScheduler()`.',
        '`createManualScheduler()` 返回的确定性调度器，时间只随手动推进而前进。'
      ),
      scenarios: [
        t('Test timeouts and retries without real waiting.', '无需真实等待即可测试超时与重试。')
      ],
      example: t(
        `import { createManualScheduler, type IManualScheduler } from '@migaia/utils/testing'
import { withTimeout } from '@migaia/utils/promise'

/** Virtual time makes this deadline observable without real waiting. */
const scheduler: IManualScheduler = createManualScheduler()
/** Observe the rejection before advancing the clock. */
const pending = withTimeout(() => new Promise<void>(() => {}), { timeoutMs: 100, scheduler })
  .catch((error: unknown) => console.log(error))
scheduler.advance(100)
await pending`,
        `import { createManualScheduler, type IManualScheduler } from '@migaia/utils/testing'
import { withTimeout } from '@migaia/utils/promise'

/** 使用虚拟时间观察截止行为，无需真实等待。 */
const scheduler: IManualScheduler = createManualScheduler()
/** 先接住拒绝结果，再推进时钟。 */
const pending = withTimeout(() => new Promise<void>(() => {}), { timeoutMs: 100, scheduler })
  .catch((error: unknown) => console.log(error))
scheduler.advance(100)
await pending`
      ),
      members: {
        advance: {
          summary: t(
            'Moves virtual time forward and runs due callbacks in order. Re-entering throws `REENTRANT_CALL`; more than 10000 callbacks in one call throw `SCHEDULER_RUNAWAY`.',
            '推进虚拟时间并按顺序执行到期回调。重入调用抛 `REENTRANT_CALL`；一次推进执行超过 10000 个回调抛 `SCHEDULER_RUNAWAY`。'
          ),
          params: { ms: t('Finite, non-negative milliseconds.', '有限、非负的毫秒数。') },
          returns: t('Nothing; due callbacks have run.', '无返回值；到期的回调都已执行。'),
          example: `scheduler.advance(50)`
        },
        pendingCount: {
          summary: t(
            'Callbacks scheduled but not yet run or cancelled.',
            '已安排但尚未执行或取消的回调数量。'
          )
        },
        now: {
          summary: t('Current virtual time in milliseconds.', '当前的虚拟时间，单位为毫秒。'),
          returns: t('Virtual milliseconds since creation.', '自创建以来的虚拟毫秒数。'),
          example: `scheduler.now() // 0`
        },
        schedule: {
          summary: t(
            'Schedules a callback after `delayMs` of virtual time.',
            '在虚拟时间经过 `delayMs` 后安排一个回调。'
          ),
          params: {
            callback: t('Work to run.', '要执行的工作。'),
            delayMs: t('Finite, non-negative delay.', '有限、非负的延时。')
          },
          returns: t('A task with `cancel()`.', '带 `cancel()` 的任务对象。'),
          example: `const task = scheduler.schedule(run, 10)`
        },
        defer: {
          summary: t('Queues a callback at the current time.', '在当前虚拟时刻排入一个回调。'),
          params: { callback: t('Work to run.', '要执行的工作。') },
          returns: t('Nothing.', '无返回值；回调将在下次推进时执行。'),
          example: `scheduler.defer?.(run)`
        }
      }
    },
    IScheduledTask: {
      summary: t(
        'Handle returned by `scheduler.schedule(callback, delayMs)`: keep it to cancel the callback before it runs.',
        '由 `scheduler.schedule(callback, delayMs)` 返回的句柄：保存它，以便在回调执行前取消。'
      ),
      scenarios: [
        t(
          'Cancel a pending timeout when the awaited work finished first.',
          '等待的工作先完成时，取消尚未触发的超时回调。'
        ),
        t(
          'Let a Node process exit while a periodic timer is still scheduled.',
          '让 Node 进程在周期性计时器仍在等待时可以正常退出。'
        )
      ],
      example: t(
        `import { systemScheduler, type IScheduledTask } from '@migaia/utils/scheduler'

/** Keep the cancellation handle when a view schedules a refresh. */
const refresh: IScheduledTask = systemScheduler.schedule(() => console.log('refresh'), 1000)
/** Leaving the view cancels the pending refresh. */
refresh.cancel()`,
        `import { systemScheduler, type IScheduledTask } from '@migaia/utils/scheduler'

/** 视图安排刷新时保留取消凭证。 */
const refresh: IScheduledTask = systemScheduler.schedule(() => console.log('refresh'), 1000)
/** 离开视图时取消尚未执行的刷新。 */
refresh.cancel()`
      ),
      members: {
        cancel: {
          summary: t(
            'Cancels the callback; calling it again, or after the callback ran, does nothing.',
            '取消该回调；重复调用或在回调执行后调用都没有效果。'
          ),
          returns: t('Nothing; the callback will not run.', '无返回值；回调不会再执行。'),
          example: `task.cancel()`
        },
        unref: {
          summary: t(
            'Optional, present on Node timers: lets the process exit while the timer is pending.',
            '可选，Node 计时器才有：允许进程在计时器等待时退出。'
          ),
          returns: t(
            'Nothing; the timer no longer keeps the process alive.',
            '无返回值；计时器不再阻止进程退出。'
          ),
          example: `task.unref?.()`
        }
      }
    },
    IScheduler: {
      scenarios: [
        t(
          'Accept the scheduler contract in a delayed notification function, using the system scheduler for ordinary calls.',
          '延时通知函数需要允许调用方选择计时器时，用这个类型约束参数，普通调用传系统调度器。'
        )
      ],
      example: t(
        `/** Accept the scheduler contract in a delayed notification function, using the system scheduler for ordinary calls. */
import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
function scheduleNotice(scheduler: IScheduler) {
  return scheduler.schedule(() => console.log('ready'), 250)
}
const notice = scheduleNotice(systemScheduler)
notice.cancel()`,
        `/** 延时通知函数需要允许调用方选择计时器时，用这个类型约束参数，普通调用传系统调度器。 */
import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
function scheduleNotice(scheduler: IScheduler) {
  return scheduler.schedule(() => console.log('ready'), 250)
}
const notice = scheduleNotice(systemScheduler)
notice.cancel()`
      ),
      summary: t(
        'The scheduler contract: monotonic `now()`, `schedule()` and optional `defer()`.',
        '调度器约定：单调的 `now()`、`schedule()` 以及可选的 `defer()`。'
      ),
      members: {
        now: {
          summary: t(
            'Monotonic milliseconds for durations and deadlines (not epoch time).',
            '用于计算时长与截止时间的单调毫秒数（不是纪元时间）。'
          ),
          returns: t('Milliseconds.', '当前毫秒数。')
        },
        schedule: {
          summary: t(
            'Runs `callback` once after `delayMs`; never synchronously inside the call.',
            '在 `delayMs` 后执行一次 `callback`；不会在调用内同步执行。'
          ),
          params: {
            callback: t('Work to run.', '要执行的工作。'),
            delayMs: t('Finite, non-negative delay.', '有限、非负的延时。')
          },
          returns: t('A task with `cancel()`.', '带 `cancel()` 的任务对象。')
        },
        defer: {
          summary: t(
            'Optional: queues a non-cancellable job (microtask for the system scheduler).',
            '可选：排入一个不可取消的任务（系统调度器使用微任务）。'
          ),
          params: { callback: t('Work to run.', '要执行的工作。') },
          returns: t('Nothing.', '无返回值；任务已排入队列。')
        }
      }
    },
    IWallClock: {
      scenarios: [
        t(
          'Accept a clock for diagnostic timestamps while keeping elapsed-time scheduling separate.',
          '诊断记录需要时间戳时，用这个类型接收时钟；计算经过时间仍由调度器负责。'
        )
      ],
      example: t(
        `/** Accept a clock for diagnostic timestamps while keeping elapsed-time scheduling separate. */
import { systemWallClock, type IWallClock } from '@migaia/utils/scheduler'
function stampNotice(clock: IWallClock) {
  return { timestamp: clock.timestamp(), event: 'ready' }
}
console.log(stampNotice(systemWallClock))`,
        `/** 诊断记录需要时间戳时，用这个类型接收时钟；计算经过时间仍由调度器负责。 */
import { systemWallClock, type IWallClock } from '@migaia/utils/scheduler'
function stampNotice(clock: IWallClock) {
  return { timestamp: clock.timestamp(), event: 'ready' }
}
console.log(stampNotice(systemWallClock))`
      ),
      summary: t('Epoch clock for diagnostic timestamps.', '用于诊断时间戳的纪元时钟。'),
      members: {
        timestamp: {
          summary: t(
            'Current epoch milliseconds (`Date.now()`).',
            '当前的纪元毫秒数，等同于 `Date.now()`。'
          ),
          returns: t('A safe integer timestamp.', '安全整数形式的时间戳。')
        }
      }
    },
    IFormatOptions: {
      scenarios: [
        t(
          'Choose how a display template handles absent fields and null values in one typed options object.',
          '显示模板需要约定缺失字段和空值的显示方式时，用这个选项类型保存规则。'
        )
      ],
      example: t(
        `/** Choose how a display template handles absent fields and null values in one typed options object. */
import { format, type IFormatOptions } from '@migaia/utils/string'
const displayOptions: IFormatOptions = { missing: 'empty', nullish: 'empty' }
console.log(format('{name}: {note} {suffix}', { name: 'Ada', note: null }, displayOptions))`,
        `/** 显示模板需要约定缺失字段和空值的显示方式时，用这个选项类型保存规则。 */
import { format, type IFormatOptions } from '@migaia/utils/string'
const displayOptions: IFormatOptions = { missing: 'empty', nullish: 'empty' }
console.log(format('{name}: {note} {suffix}', { name: 'Ada', note: null }, displayOptions))`
      ),
      summary: t(
        'Options of `format()`: delimiters, missing and nullish handling.',
        '`format()` 的选项：占位符边界、缺失值与空值的处理方式。'
      ),
      members: {
        placeholder: {
          summary: t(
            'Placeholder delimiters `{ open, close }`.',
            '占位符左右两侧的边界字符 `{ open, close }`。'
          ),
          default: t('`{ open: "{", close: "}" }`.', '`{ open: "{", close: "}" }`，即花括号。')
        },
        missing: {
          summary: t(
            'What happens to a placeholder without a value.',
            '占位符找不到取值时如何处理。'
          ),
          default: t('`preserve`: keep the placeholder text.', '`preserve`：保留占位符原文。'),
          values: {
            preserve: t('Keep `{name}` in the output.', '在输出中保留 `{name}` 原文。'),
            empty: t('Output nothing.', '输出空字符串。'),
            throw: t('Throw `FORMAT_VALUE_MISSING`.', '抛出 `FORMAT_VALUE_MISSING` 错误。')
          }
        },
        nullish: {
          summary: t(
            'How `null` / `undefined` values are written.',
            '占位符的取值为 `null` / `undefined` 时如何输出。'
          ),
          default: t('`empty`: write nothing.', '`empty`：输出空字符串。'),
          values: {
            empty: t('Write nothing.', '输出空字符串。'),
            stringify: t(
              'Write `null` / `undefined` as text.',
              '把 `null` / `undefined` 作为文本输出。'
            )
          }
        }
      }
    },
    IFormatPlaceholder: {
      scenarios: [
        t(
          'Choose different placeholder delimiters when curly braces already have another meaning in a display template.',
          '显示模板中的花括号另有用途时，用这个类型声明另一组占位符边界。'
        )
      ],
      example: t(
        `/** Choose different placeholder delimiters when curly braces already have another meaning in a display template. */
import { format, type IFormatPlaceholder } from '@migaia/utils/string'
const templateDelimiters: IFormatPlaceholder = { open: '[[', close: ']]' }
console.log(format('Hello [[name]]', { name: 'Ada' }, { placeholder: templateDelimiters }))`,
        `/** 显示模板中的花括号另有用途时，用这个类型声明另一组占位符边界。 */
import { format, type IFormatPlaceholder } from '@migaia/utils/string'
const templateDelimiters: IFormatPlaceholder = { open: '[[', close: ']]' }
console.log(format('Hello [[name]]', { name: 'Ada' }, { placeholder: templateDelimiters }))`
      ),
      summary: t('Placeholder delimiters of `format()`.', '`format()` 使用的占位符边界字符。'),
      members: {
        open: { summary: t('Opening delimiter, e.g. `{`.', '占位符的左边界字符，例如 `{`。') },
        close: { summary: t('Closing delimiter, e.g. `}`.', '占位符的右边界字符，例如 `}`。') }
      }
    },
    IStringConversion: {
      summary: t(
        'Native string-conversion outcome returned by `tryString()`, preserving the original coercion failure instead of throwing it.',
        '`tryString()` 返回的原生字符串转换结果，保留原始转换失败而不抛出。'
      ),
      scenarios: [
        t(
          'Build diagnostics from untrusted values while keeping hostile coercion failures inspectable.',
          '从不可信值构造诊断，同时保留可检查的恶意转换失败。'
        )
      ],
      example: t(
        `import { tryString } from '@migaia/utils/string'

const result = tryString(42)
if (result.threw) console.error(result.error)
else console.log(result.value)`,
        `import { tryString } from '@migaia/utils/string'

const result = tryString(42)
if (result.threw) console.error(result.error)
else console.log(result.value)`
      ),
      members: {
        threw: {
          summary: t(
            'Conversion discriminant: false carries a string, true carries the exact original thrown value.',
            '转换判别值：假值携带字符串，真值携带精确原始抛出值。'
          ),
          values: {
            true: t(
              'Native coercion threw and its original error is retained.',
              '原生强制转换抛错，并保留其原始失败。'
            ),
            false: t(
              'Native conversion succeeded or the input was already a string.',
              '原生转换成功，或输入原本就是字符串。'
            )
          }
        },
        value: {
          summary: t(
            'Successful native String result, or the unchanged input string, present only when threw is false.',
            '原生转换成功结果或未修改的输入字符串，仅未抛错分支存在。'
          )
        },
        error: {
          summary: t(
            'Exact value thrown during native coercion, present only in the throwing branch.',
            '原生强制转换抛出的精确原值，仅抛错分支存在。'
          )
        }
      }
    },
    IDiscriminatedByField: {
      ...alias(
        'Groups a discriminated union by a top-level tag field. Use it to require one handler for every top-level kind, with each handler receiving its corresponding member.',
        '按顶层判别字段对联合类型分组的类型工具。需要为最外层字段的每个种类提供处理函数，并让函数只接收对应成员时使用。'
      ),
      scenarios: [
        t(
          'Build a complete handler table for messages whose kind is stored directly on each message.',
          '消息把种类放在最外层字段时，用这个类型建立完整处理表，让每个处理函数接收对应消息。'
        )
      ],
      example: t(
        `/** Build a complete handler table for messages whose kind is stored directly on each message. */
import type { IDiscriminatedByField } from '@migaia/utils/typing'
type IMessage = { kind: 'text'; body: string } | { kind: 'image'; url: string }
type IMessagesByKind = IDiscriminatedByField<'kind', IMessage>
const renderers: { [K in keyof IMessagesByKind]: (message: IMessagesByKind[K]) => string } = {
  text: (message) => message.body,
  image: (message) => message.url
}
console.log(renderers.text({ kind: 'text', body: 'Hello' }))`,
        `/** 消息把种类放在最外层字段时，用这个类型建立完整处理表，让每个处理函数接收对应消息。 */
import type { IDiscriminatedByField } from '@migaia/utils/typing'
type IMessage = { kind: 'text'; body: string } | { kind: 'image'; url: string }
type IMessagesByKind = IDiscriminatedByField<'kind', IMessage>
const renderers: { [K in keyof IMessagesByKind]: (message: IMessagesByKind[K]) => string } = {
  text: (message) => message.body,
  image: (message) => message.url
}
console.log(renderers.text({ kind: 'text', body: 'Hello' }))`
      )
    },
    IDiscriminatedByPath: {
      ...alias(
        'Groups a discriminated union by a nested tag path. Use it when the kind is nested; inspect the result keys before building a handler table, because missing paths or non-key values can leave members out or produce no keys.',
        '按嵌套判别路径对联合类型分组的类型工具。种类字段位于深层时使用；建立处理表前先检查结果键名，因为路径缺失或叶值不能用作键时，可能遗漏成员或没有任何键。'
      ),
      scenarios: [
        t(
          'Group notifications by a kind stored inside metadata before defining a handler for each nested kind.',
          '通知的种类字段位于元信息内部时，用这个类型按嵌套路径分组，再为每个种类定义处理函数。'
        )
      ],
      example: t(
        `/** Group notifications by a kind stored inside metadata before defining a handler for each nested kind. */
import type { IDiscriminatedByPath } from '@migaia/utils/typing'
type INotice =
  | { meta: { kind: 'email' }; address: string }
  | { meta: { kind: 'sms' }; phone: string }
type INoticesByKind = IDiscriminatedByPath<INotice, 'meta.kind'>
const destinations: { [K in keyof INoticesByKind]: (notice: INoticesByKind[K]) => string } = {
  email: (notice) => notice.address,
  sms: (notice) => notice.phone
}
console.log(destinations.sms({ meta: { kind: 'sms' }, phone: '12345' }))`,
        `/** 通知的种类字段位于元信息内部时，用这个类型按嵌套路径分组，再为每个种类定义处理函数。 */
import type { IDiscriminatedByPath } from '@migaia/utils/typing'
type INotice =
  | { meta: { kind: 'email' }; address: string }
  | { meta: { kind: 'sms' }; phone: string }
type INoticesByKind = IDiscriminatedByPath<INotice, 'meta.kind'>
const destinations: { [K in keyof INoticesByKind]: (notice: INoticesByKind[K]) => string } = {
  email: (notice) => notice.address,
  sms: (notice) => notice.phone
}
console.log(destinations.sms({ meta: { kind: 'sms' }, phone: '12345' }))`
      )
    },
    IUrlLike: {
      summary: t(
        'Caller-supplied URL input as a string or an object exposing a string href, including native URL objects.',
        '调用方提供的网址输入，可为字符串或暴露字符串地址属性的对象，包括原生网址对象。'
      ),
      scenarios: [
        t(
          'Use it in a shared module signature that accepts URL text and native URL objects without requiring DOM or Node type declarations. See the [type utilities guide](/en/docs/utils/type-utilities#shared-signatures).',
          '共享模块的接口若要同时接收网址文本和原生网址对象，又不要求使用者引入浏览器或服务器宿主类型声明，可使用此类型。详见[类型工具指南](/zh/docs/utils/type-utilities#shared-signatures)。'
        )
      ],
      example: t(
        `import type { IUrlLike } from '@migaia/utils/typing'

/** Accept URL text and objects without requiring a host-specific URL type. */
function endpointText(value: IUrlLike): string {
  return typeof value === 'string' ? value : value.href
}
console.log(endpointText('https://example.com/api'))
console.log(endpointText({ href: 'https://example.com/api' }))`,
        `import type { IUrlLike } from '@migaia/utils/typing'

/** 同时接收网址文本与对象，无须依赖宿主的网址类型。 */
function endpointText(value: IUrlLike): string {
  return typeof value === 'string' ? value : value.href
}
console.log(endpointText('https://example.com/api'))
console.log(endpointText({ href: 'https://example.com/api' }))`
      ),
      members: {
        href: {
          summary: t(
            'URL text supplied by the object-form input; string-form inputs carry their text directly instead.',
            '对象形式输入提供的网址文本；字符串形式直接携带文本，不提供此字段。'
          )
        }
      }
    },
    IPrimitive: {
      ...alias(
        'The seven JavaScript primitive types.',
        'JavaScript 的七种原始类型组成的联合类型。'
      ),
      scenarios: [
        t(
          'Accept only primitive values in a display helper that should not traverse arrays or objects.',
          '显示辅助函数只处理原始值、不遍历数组或对象时，用这个类型声明参数。'
        )
      ],
      example: t(
        `/** Accept only primitive values in a display helper that should not traverse arrays or objects. */
import type { IPrimitive } from '@migaia/utils/value'
function displayCell(value: IPrimitive): string {
  return value == null ? '' : String(value)
}
console.log(displayCell(false), displayCell(0), displayCell(null))`,
        `/** 显示辅助函数只处理原始值、不遍历数组或对象时，用这个类型声明参数。 */
import type { IPrimitive } from '@migaia/utils/value'
function displayCell(value: IPrimitive): string {
  return value == null ? '' : String(value)
}
console.log(displayCell(false), displayCell(0), displayCell(null))`
      )
    }
  },
  enums: {
    UtilsErrorCode: {
      summary: t(
        'Stable error codes of `@migaia/utils` and what to do about each.',
        '`@migaia/utils` 的稳定错误码及各自的处理方式。'
      ),
      values: {
        invalidArgument: t(
          '`INVALID_ARGUMENT`: an argument is outside its domain (negative delay, bad concurrency...); fix the value, retrying it fails again.',
          '`INVALID_ARGUMENT`：参数超出允许范围（负的延时、非法的并发数等）；需要修正参数，原样重试仍会失败。'
        ),
        nonErrorValue: t(
          '`NON_ERROR_VALUE`: `toError()` wrapped a thrown non-Error; the original value is on `cause`.',
          '`NON_ERROR_VALUE`：`toError()` 包装了一个不是 Error 的抛出值；原始值在 `cause` 上。'
        ),
        envUnsupported: t(
          '`ENV_UNSUPPORTED`: the host lacks `structuredClone`, `performance.now` or timers; inject an implementation.',
          '`ENV_UNSUPPORTED`：宿主缺少 `structuredClone`、`performance.now` 或计时器；需要注入实现。'
        ),
        aborted: t(
          '`ABORTED`: a signal cancelled the operation (`UtilsAbortError`); treat it as cancellation.',
          '`ABORTED`：操作被信号取消（`UtilsAbortError`）；应当作取消处理，而不是失败。'
        ),
        deadlineExceeded: t(
          '`DEADLINE_EXCEEDED`: a deadline passed (`UtilsTimeoutError`); retry with more time or report.',
          '`DEADLINE_EXCEEDED`：超过截止时间（`UtilsTimeoutError`）；可放宽时间后重试或上报。'
        ),
        schedulerRunaway: t(
          '`SCHEDULER_RUNAWAY`: a manual scheduler ran over 10000 callbacks in one `advance()`; stop the self-scheduling loop.',
          '`SCHEDULER_RUNAWAY`：手动调度器一次 `advance()` 执行了超过 10000 个回调；需要停止自我重复安排的循环。'
        ),
        errorIdentityConflict: t(
          '`ERROR_IDENTITY_CONFLICT`: the error already has another `source` / `code`; pass `onConflict` or keep it.',
          '`ERROR_IDENTITY_CONFLICT`：错误上已有不同的 `source` / `code`；需提供 `onConflict` 或保留原身份。'
        ),
        errorChainInvalid: t(
          '`ERROR_CHAIN_INVALID`: a received serialized error tree breaks the field or size rules.',
          '`ERROR_CHAIN_INVALID`：接收到的序列化错误树违反了字段或大小规则。'
        ),
        cloneUnsupported: t(
          '`CLONE_UNSUPPORTED`: `structuredClone` rejected the value (functions, symbols, host objects).',
          '`CLONE_UNSUPPORTED`：`structuredClone` 拒绝了该值（函数、symbol、宿主对象）。'
        ),
        invalidEncoding: t(
          '`INVALID_ENCODING`: malformed Base64 or UTF-8 input; the message gives the offset.',
          '`INVALID_ENCODING`：Base64 或 UTF-8 输入格式错误；错误信息中给出出错位置。'
        ),
        limiterClosed: t(
          '`LIMITER_CLOSED`: `run()` after `close()` / `dispose()`; create a new limiter.',
          '`LIMITER_CLOSED`：在 `close()` / `dispose()` 之后调用了 `run()`；需要创建新的限制器。'
        ),
        reentrantCall: t(
          '`REENTRANT_CALL`: a non-reentrant call (such as `once` or `advance`) was entered again from inside itself.',
          '`REENTRANT_CALL`：不可重入的调用（如 `once` 或 `advance`）在自身执行过程中被再次调用。'
        ),
        configUnsupported: t(
          '`CONFIG_UNSUPPORTED`: the config contains values the profile does not accept.',
          '`CONFIG_UNSUPPORTED`：配置中包含当前档位不接受的值。'
        ),
        configReadonly: t(
          '`CONFIG_READONLY`: a write on a `readonlyConfig()` view; use `patchConfig()` instead.',
          '`CONFIG_READONLY`：对 `readonlyConfig()` 视图进行了写入；请改用 `patchConfig()`。'
        ),
        configConflict: t(
          '`CONFIG_CONFLICT`: sources have different profiles or limits; reconcile them first.',
          '`CONFIG_CONFLICT`：来源配置的档位或上限不一致；需要先统一。'
        ),
        configLimitExceeded: t(
          '`CONFIG_LIMIT_EXCEEDED`: the config graph exceeds `maxDepth`, `maxNodes` or `maxKeys`.',
          '`CONFIG_LIMIT_EXCEEDED`：配置值图的规模超过了上限 `maxDepth`、`maxNodes` 或 `maxKeys`。'
        ),
        configPathInvalid: t(
          '`CONFIG_PATH_INVALID`: a config path is empty, too long or dangerous.',
          '`CONFIG_PATH_INVALID`：配置路径为空、过长或包含危险的键。'
        ),
        objectPathInvalid: t(
          '`OBJECT_PATH_INVALID`: an object path cannot be parsed safely.',
          '`OBJECT_PATH_INVALID`：对象路径无法被安全地解析。'
        ),
        formatInvalid: t(
          '`FORMAT_INVALID`: the `format()` template or a value cannot be formatted.',
          '`FORMAT_INVALID`：`format()` 的模板或某个值无法被格式化。'
        ),
        formatValueMissing: t(
          '`FORMAT_VALUE_MISSING`: a placeholder has no value with `missing: "throw"`.',
          '`FORMAT_VALUE_MISSING`：在 `missing: "throw"` 时某个占位符没有取值。'
        ),
        numberFormatInvalid: t(
          '`NUMBER_FORMAT_INVALID`: `Intl` rejected the locale, options, currency or value.',
          '`NUMBER_FORMAT_INVALID`：`Intl` 拒绝了语言区域、选项、币种或数值。'
        )
      }
    },
    ConfigProfile: {
      summary: t(
        'Validation profiles of owned configuration.',
        '已拥有配置的校验档位，决定允许哪些值。'
      ),
      values: {
        data: t(
          '`data` (default): portable plain data only; functions and dangerous keys are rejected.',
          '`data`（默认）：只允许可移植的纯数据，函数和危险键会被拒绝。'
        ),
        richRuntime: t(
          '`richRuntime`: also allows functions and constructors; in-process only, not serialisable.',
          '`richRuntime`：还允许函数与构造器；只用于进程内，不可序列化。'
        )
      }
    },
    ThenableProbeKind: {
      summary: t(
        'Kinds returned by `probeThenable()`.',
        '`probeThenable()` 返回结果中 `kind` 字段的全部取值，用于区分三种探测结果。'
      ),
      values: {
        notThenable: t(
          '`not-thenable`: the value has no callable `then`.',
          '`not-thenable`：该值没有可调用的 `then`，按普通值处理。'
        ),
        thenable: t(
          '`thenable`: `then` was captured in `thenFn`.',
          '`thenable`：已把 `then` 方法捕获到 `thenFn` 中，可直接交给 `assimilateCapturedThen()`。'
        ),
        failed: t(
          '`failed`: reading `then` threw; the error is in `error`.',
          '`failed`：读取 `then` 时抛错，错误保存在 `error` 中。'
        )
      }
    }
  },
  enhancers: {}
}
