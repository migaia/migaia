/**
 * Reference documentation of the `@migaia/utils` class facades and scheduling helpers:
 * `IdentifyError` (`/error`), `ConfigOwner` (`/config`) and `asyncTask`, time slicing and call-rate
 * helpers (`/scheduler`). Rules: `app/reference/contract.ts`. Verified against `packages/utils/src`
 * (identify-error.ts, config-owner.ts, internal/async-task.ts, internal/time-slice.ts,
 * internal/rate.ts) on 2026-10-21. Merged into `utilsReference`.
 */
import type { IEnumDoc, IMemberDoc, ISymbolDoc, IText, ITypeDoc } from './contract.js'

/** Builds one bilingual text. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Short type doc for type-only aliases. */
const alias = (en: string, zh: string): ITypeDoc => ({ summary: t(en, zh), members: {} })

// ---------------------------------------------------------------------------------------------
// IdentifyError
// ---------------------------------------------------------------------------------------------

/** End-to-end `IdentifyError` example. */
const identifyErrorExample: IText = {
  en: `import { IdentifyError } from '@migaia/utils/error'

const OrderError = IdentifyError.define('@app/orders', { notFound: 'NOT_FOUND' })

function load(id: string) {
  // the original failure stays on cause
  throw OrderError.notFound({ cause: new Error('no row'), detail: { id } })
}

try {
  load('42')
} catch (error) {
  if (OrderError.is(error, 'notFound')) console.log(error.detail?.id, error.native().message)
  const status = IdentifyError.match(error, { NOT_FOUND: () => 404, _: () => 500 })
  console.log(status)
}`,
  zh: `import { IdentifyError } from '@migaia/utils/error'

const OrderError = IdentifyError.define('@app/orders', { notFound: 'NOT_FOUND' })

function load(id: string) {
  // 原始失败保留在 cause 上
  throw OrderError.notFound({ cause: new Error('no row'), detail: { id } })
}

try {
  load('42')
} catch (error) {
  if (OrderError.is(error, 'notFound')) console.log(error.detail?.id, error.native().message)
  const status = IdentifyError.match(error, { NOT_FOUND: () => 404, _: () => 500 })
  console.log(status)
}`
}

/** Scenarios of `IdentifyError`. */
const identifyErrorScenarios = [
  t(
    'Give every failure that leaves a module a stable `source` and `code` so callers branch on codes, not on message text.',
    '给每个离开模块的失败加上稳定的 `source` 和 `code`，调用方按错误码分支，而不是匹配错误信息。'
  ),
  t(
    'Find a known failure deep inside a cause chain or an `AggregateError` with `find()` / `match()`.',
    '用 `find()` / `match()` 在原因链或 `AggregateError` 深处找到已知的失败。'
  )
]

/** Identity fields shared by `IdentifyError` and identity records. */
const identityFieldMembers: Readonly<Record<string, IMemberDoc>> = {
  source: {
    summary: t(
      'Package or module that owns the code, for example `@app/orders`; a readonly own property.',
      '拥有该错误码的包或模块，例如 `@app/orders`；是只读的自有属性。'
    )
  },
  code: {
    summary: t(
      'Semantic code, unique within `source`, for example `NOT_FOUND`; a readonly own property.',
      '语义错误码，在同一个 `source` 内唯一，例如 `NOT_FOUND`；是只读的自有属性。'
    )
  },
  phase: {
    summary: t(
      'Optional lifecycle phase in which the failure happened, for example `open` or `close`.',
      '可选的生命周期阶段，说明失败发生在哪一步，例如 `open` 或 `close`。'
    )
  },
  detail: {
    summary: t(
      'Optional frozen record of diagnostic values (ids, limits); never contains secrets you did not put there.',
      '可选的冻结诊断记录（编号、上限等），只包含调用方放进去的值。'
    )
  }
}

/** Instance members of `IdentifyError`. */
const identifyErrorMembers: Readonly<Record<string, IMemberDoc>> = {
  ...identityFieldMembers,
  identity: {
    summary: t(
      'Returns the frozen identity snapshot (`source`, `code`, optional `phase` and `detail`).',
      '返回冻结的身份快照（`source`、`code`，以及可选的 `phase` 与 `detail`）。'
    ),
    returns: t(
      'The same frozen object on every call; safe to share.',
      '每次调用都返回同一个冻结对象，可以放心共享。'
    ),
    example: `const { source, code } = error.identity()`
  },
  native: {
    summary: t(
      'Returns the original native error: the root native error of the wrapped cause, a `NON_ERROR_VALUE` wrapper when a non-error value was thrown, or the instance itself when no cause was given.',
      '返回原始的原生错误：被包装原因的原生根错误；抛出的不是错误对象时返回 `NON_ERROR_VALUE` 包装；没有原因时返回实例本身。'
    ),
    returns: t(
      'An `Error` whose native type and stack are unchanged.',
      '一个原生类型和调用栈都未改变的 `Error`。'
    ),
    example: `if (error.native() instanceof TypeError) reportBug(error)`
  },
  causes: {
    summary: t(
      'Lists every reachable link of the `cause` and `AggregateError.errors` chain, starting with this error.',
      '列出 `cause` 与 `AggregateError.errors` 链上所有可达的环节，第一个是本错误。'
    ),
    returns: t(
      'A readonly array in walk order, with duplicates removed.',
      '按遍历顺序排列、去除重复的只读数组。'
    ),
    example: `for (const link of error.causes()) console.log(link)`
  },
  has: {
    summary: t(
      'Tells whether any link of the chain, including this error, matches the partial identity.',
      '判断链上任一环节（包括本错误）是否匹配给定的部分身份。'
    ),
    params: {
      match: t(
        'Partial identity `{ source?, code?, phase? }`; omitted fields match anything.',
        '部分身份 `{ source?, code?, phase? }`；省略的字段匹配任意值。'
      )
    },
    returns: t('`true` when one link matches.', '有环节匹配时返回 `true`。'),
    example: `if (error.has({ code: 'DEADLINE_EXCEEDED' })) showRetry()`
  },
  equal: {
    summary: t(
      'Compares `source`, `code` and `phase` with any coded error or identity record; never throws, even for hostile values.',
      '与任意带错误码的错误或身份记录比较 `source`、`code` 和 `phase`；即使对方是恶意对象也不会抛错。'
    ),
    params: {
      other: t(
        'Any value: an error, an `IdentifyError` or a plain identity record.',
        '任意值：错误对象、`IdentifyError` 或普通身份记录。'
      )
    },
    returns: t('`true` when all three fields are equal.', '三个字段都相等时返回 `true`。'),
    example: `error.equal({ source: '@app/orders', code: 'NOT_FOUND' })`
  },
  compare: {
    summary: t(
      'Compares field by field and reports which identity fields are equal; `detail` uses shallow own-key equality.',
      '逐字段比较，报告哪些身份字段相等；`detail` 按自有键做浅比较。'
    ),
    params: {
      other: t(
        'Any value: an error, an `IdentifyError` or a plain identity record.',
        '任意值：错误对象、`IdentifyError` 或普通身份记录。'
      )
    },
    returns: t(
      'A frozen `IErrorIdentityComparison` with one boolean per field.',
      '冻结的 `IErrorIdentityComparison`，每个字段一个布尔值。'
    ),
    example: `const diff = error.compare(other)
if (!diff.detail) console.log('same code, different detail')`
  },
  clone: {
    summary: t(
      'Creates a new instance with the same identity, message and cause, so `native()` returns the same original error.',
      '创建身份、信息和原因都相同的新实例，因此 `native()` 返回同一个原始错误。'
    ),
    returns: t(
      'A new `IdentifyError` of the same literal type.',
      '同一字面量类型的新 `IdentifyError`。'
    ),
    example: `const copy = error.clone()`
  },
  mutable: {
    summary: t(
      'Returns a plain, editable identity draft; editing it never changes this error. Pass it back to `IdentifyError.from(error.native(), draft)` to build a changed error.',
      '返回一个普通、可编辑的身份草稿；修改它不会影响本错误。把它交给 `IdentifyError.from(error.native(), draft)` 就能得到修改后的错误。'
    ),
    returns: t(
      'An `IMutableErrorIdentity` with `source` and `code` widened to `string`.',
      '一个 `IMutableErrorIdentity`，其中 `source` 和 `code` 放宽为 `string`。'
    ),
    example: `const draft = error.mutable()
draft.code = 'RETRY_EXHAUSTED'
throw IdentifyError.from(error.native(), draft)`
  },
  withPhase: {
    summary: t(
      'Creates a new instance that differs only in `phase`; this error is not changed.',
      '创建一个只有 `phase` 不同的新实例；本错误保持不变。'
    ),
    params: { phase: t('New phase name, for example `close`.', '新的阶段名，例如 `close`。') },
    returns: t(
      'A new `IdentifyError` with the same source and code.',
      '来源与错误码相同的新 `IdentifyError`。'
    ),
    example: `throw error.withPhase('close')`
  },
  withDetail: {
    summary: t(
      'Creates a new instance whose `detail` is this detail shallow-merged with the given record; this error is not changed.',
      '创建新实例，其 `detail` 是本错误的明细与给定记录的浅合并；本错误保持不变。'
    ),
    params: {
      detail: t(
        'Plain record merged over the current detail; a non-record throws `INVALID_ARGUMENT`.',
        '覆盖合并到当前明细上的普通记录；不是普通记录时抛出 `INVALID_ARGUMENT`。'
      )
    },
    returns: t(
      'A new `IdentifyError` with the merged, frozen detail.',
      '带有合并后冻结明细的新 `IdentifyError`。'
    ),
    example: `throw error.withDetail({ attempt: 3 })`
  },
  combine: {
    summary: t(
      'Instance `error.combine(...others)` creates a new `IdentifyError` with the same semantic identity and message, a frozen `errors` array ordered as `[error, ...others]`, and `cause: error`. The original native error remains reachable through that cause chain.\n\nStatic `IdentifyError.combine(errors, message)` delegates to `combineErrors()`: it returns `undefined` for no failures, the normalized error for one, or an `AggregateError` for several. If iteration throws, it throws an `AggregateError` containing the collected failures followed by the iteration failure.',
      '实例方法 `error.combine(...others)` 创建语义身份与消息相同的新 `IdentifyError`，其冻结的 `errors` 数组按 `[error, ...others]` 排列，`cause` 指向 `error`，原生错误仍可沿原因链找到。\n\n静态方法 `IdentifyError.combine(errors, message)` 交给 `combineErrors()` 处理：没有失败时返回 `undefined`，只有一个时返回规范化后的错误，多个时返回 `AggregateError`。若遍历过程抛错，则抛出 `AggregateError`，其中先列出已收集的失败，再列出遍历失败。'
    ),
    params: {
      others: t(
        'Instance form only: further failures appended in argument order, without conversion; each original value keeps its identity.',
        '仅实例方法使用：按参数顺序追加的其他失败，不做转换，每个值保持原身份。'
      ),
      errors: t(
        'Static form only: iterable of failures normalized through `toError()`. Existing errors keep their native type and identity; other thrown values remain reachable as the wrapper’s cause.',
        '仅静态方法使用：要合并的可迭代失败集合，经 `toError()` 规范化；已有错误保留原生类型和身份，其他抛出值保留为包装错误的原因。'
      ),
      message: t(
        'Static form only: message of the `AggregateError` returned for several failures or thrown when iteration fails.',
        '仅静态方法使用：多个失败时返回的 `AggregateError`，或遍历失败时抛出的 `AggregateError` 所用的消息。'
      )
    },
    returns: t(
      'Instance form: a new `IdentifyError` with an `errors` array. Static form: `undefined`, the single normalized error, or an `AggregateError`.',
      '实例方法形式：带 `errors` 数组的新 `IdentifyError`。静态方法形式：`undefined`、唯一的规范化错误，或一个 `AggregateError`。'
    ),
    example: `throw error.combine(rollbackError, cleanupError)`
  },
  attachSecondary: {
    summary: t(
      'Appends secondary failures (rollback, cleanup) to this error’s `errors` without changing its identity. When the instance was frozen by the caller, the identity-preserving `AggregateError` is thrown instead of being dropped.',
      '把次要失败（回滚、清理）追加到本错误的 `errors`，身份不变。若实例已被调用方冻结，会抛出保留身份的 `AggregateError`，而不是丢掉这些失败。'
    ),
    params: { errors: t('Secondary failures to append.', '要追加的次要失败。') },
    returns: t('This same instance, for chaining.', '本实例本身，便于链式调用。'),
    example: `throw primary.attachSecondary(cleanupError)`
  },
  toJSON: {
    summary: t(
      'Serializes the whole chain through `serializeErrorChain`, so `JSON.stringify(error)` crosses a worker or RPC boundary with `source`, `code`, `stack` and causes.',
      '通过 `serializeErrorChain` 序列化整条链，使 `JSON.stringify(error)` 跨越线程或远程调用边界时仍带有 `source`、`code`、调用栈和原因。'
    ),
    returns: t(
      'An `ISerializedErrorChain`; restore it with `IdentifyError.deserialize()`.',
      '一个 `ISerializedErrorChain`；可用 `IdentifyError.deserialize()` 还原。'
    ),
    example: `port.postMessage(JSON.stringify(error))`
  },
  toString: {
    summary: t(
      'Formats the error as `[source:code] message` for logs.',
      '把错误格式化为 `[source:code] message`，便于写日志。'
    ),
    returns: t('The formatted string.', '格式化后的字符串。'),
    example: `console.warn(String(error))`
  }
}

/** Static members of `IdentifyError`. */
const identifyErrorStatics: Readonly<Record<string, IMemberDoc>> = {
  from: {
    summary: t(
      'Wraps any thrown value with an identity. An `IdentifyError` that already has the same identity is returned as is, so repeated boundary wrapping stays idempotent.',
      '给任意抛出的值加上身份。已经具有相同身份的 `IdentifyError` 原样返回，因此在多层边界重复包装也不会叠加。'
    ),
    params: {
      error: t('The caught value, kept on `cause`.', '捕获到的值，保存在 `cause` 上。'),
      identity: t('`IIdentifyErrorIdentity` to attach.', '要附加的身份 `IIdentifyErrorIdentity`。'),
      options: t(
        'Optional `{ message }`; the message defaults to the cause’s message.',
        '可选的 `{ message }`；信息默认取原因的错误信息。'
      )
    },
    returns: t(
      'An `IdentifyError` with literal `source` and `code` types.',
      '带字面量 `source` 与 `code` 类型的 `IdentifyError`。'
    ),
    example: `throw IdentifyError.from(cause, { source: '@app/db', code: 'QUERY_FAILED' })`
  },
  define: {
    summary: t(
      'Declares a package-scoped factory: one constructor function per code key plus `is` and `find` narrowed to the source. Keys `source`, `codes`, `is` and `find` are reserved and throw `INVALID_ARGUMENT`.',
      '声明包级工厂：每个错误码键一个构造函数，另有限定到该来源的 `is` 和 `find`。`source`、`codes`、`is`、`find` 是保留键，使用时抛出 `INVALID_ARGUMENT`。'
    ),
    params: {
      source: t(
        'Package name used as `source`, for example `@app/orders`.',
        '用作 `source` 的包名，例如 `@app/orders`。'
      ),
      codes: t(
        'Plain record from key to code, for example `{ notFound: "NOT_FOUND" }`.',
        '从键到错误码的普通记录，例如 `{ notFound: "NOT_FOUND" }`。'
      )
    },
    returns: t('A frozen `IIdentifyErrorFactory`.', '冻结的错误工厂 `IIdentifyErrorFactory`。'),
    example: `const OrderError = IdentifyError.define('@app/orders', { notFound: 'NOT_FOUND' })`
  },
  assert: {
    summary: t(
      'Throws an `IdentifyError` when the condition is falsy and narrows the condition otherwise.',
      '条件为假时抛出 `IdentifyError`，否则把条件收窄为真值类型。'
    ),
    params: {
      condition: t('Value that must be truthy.', '必须为真值的条件。'),
      identity: t('Identity of the thrown error.', '抛出错误时使用的身份。'),
      message: t('Optional message of the thrown error.', '抛出错误的可选信息。')
    },
    returns: t(
      'Nothing when the condition holds; TypeScript narrows it.',
      '条件成立时无返回值，类型系统会收窄它。'
    ),
    example: `IdentifyError.assert(user, { source: '@app/auth', code: 'NO_USER' })`
  },
  wrap: {
    summary: t(
      'Returns a function with the same signature that converts synchronous throws and asynchronous rejections into `IdentifyError.from(error, identity)`.',
      '返回签名相同的函数，把同步抛错和异步拒绝都转换成 `IdentifyError.from(error, identity)`。'
    ),
    params: {
      fn: t('Function to wrap.', '要包装的函数，同步或异步都可以。'),
      identity: t('Identity attached to every failure.', '附加到每个失败上的身份。')
    },
    returns: t('The wrapped function, typed like `fn`.', '包装后的函数，类型与 `fn` 相同。'),
    example: `const loadUser = IdentifyError.wrap(fetchUser, { source: '@app/users', code: 'LOAD_FAILED' })`
  },
  is: {
    summary: t(
      'Brand check that is `true` only for real `IdentifyError` instances (spoofed shapes fail); with a match it also requires the identity fields to match and narrows the literal types.',
      '品牌检查：只有真正的 `IdentifyError` 实例才返回 `true`（伪造的形状不通过）；传入匹配条件时还要求身份字段匹配，并收窄字面量类型。'
    ),
    params: {
      value: t('Any caught value.', '任意捕获到的值。'),
      match: t('Optional `IErrorIdentityMatch`.', '可选的部分身份 `IErrorIdentityMatch`。')
    },
    returns: t('`true` and a narrowed type when it matches.', '匹配时返回 `true` 并收窄类型。'),
    example: `if (IdentifyError.is(error, { code: 'NOT_FOUND' })) showEmpty()`
  },
  find: {
    summary: t(
      'Finds the first link of the cause and `AggregateError.errors` chain whose identity matches; works with any coded error, not only `IdentifyError`.',
      '在原因链和 `AggregateError.errors` 中找到第一个身份匹配的环节；对任意带错误码的错误都有效，不限于 `IdentifyError`。'
    ),
    params: {
      error: t('Any caught value.', '任意捕获到的值。'),
      match: t('`IErrorIdentityMatch` to look for.', '要查找的部分身份 `IErrorIdentityMatch`。')
    },
    returns: t(
      'The matching `IIdentifiedError`, or `undefined`.',
      '匹配的 `IIdentifiedError`，或 `undefined`。'
    ),
    example: `const timeout = IdentifyError.find(error, { source: 'foundation.utils', code: 'DEADLINE_EXCEEDED' })`
  },
  match: {
    summary: t(
      'Dispatches on the first chain link whose `code` has a handler; falls back to `_`, and without a fallback rethrows the original value unchanged.',
      '按原因链上第一个有处理函数的 `code` 分派；否则调用 `_`，没有后备处理时原样重新抛出原始值。'
    ),
    params: {
      error: t('Any caught value.', '任意捕获到的值。'),
      cases: t(
        '`IIdentifyErrorCases` handler table.',
        '按错误码分派的处理表 `IIdentifyErrorCases`。'
      ),
      options: t(
        'Optional `{ source }` that skips links of other packages.',
        '可选的 `{ source }`，跳过其他包的环节。'
      )
    },
    returns: t('The handler result.', '所调用处理函数的返回值。'),
    example: `const status = IdentifyError.match(error, { NOT_FOUND: () => 404, _: () => 500 })`
  },
  identityOf: {
    summary: t(
      'Reads the identity of any value without throwing, even for hostile proxies; values without a non-empty `source` and `code` have none.',
      '读取任意值的身份，即使遇到恶意代理也不会抛错；没有非空 `source` 和 `code` 的值视为没有身份。'
    ),
    params: { value: t('Any value.', '任意值，可以是错误或普通对象。') },
    returns: t('A frozen identity, or `undefined`.', '冻结的身份对象，或 `undefined`。'),
    example: `const identity = IdentifyError.identityOf(error)`
  },
  walk: {
    summary: t(
      'Walks the cause and `AggregateError.errors` chain with bounded depth; delegates to `walkErrorCauses()`.',
      '按有限深度遍历原因链和 `AggregateError.errors`；交给 `walkErrorCauses()` 处理。'
    ),
    params: {
      error: t('Start of the chain.', '遍历的起点错误。'),
      options: t('Optional `{ maxDepth }`, default 32.', '可选的 `{ maxDepth }`，默认为 32。')
    },
    returns: t('Every reachable link in walk order.', '按遍历顺序排列的所有可达环节。'),
    example: `IdentifyError.walk(error).forEach((link) => console.log(link))`
  },
  reason: {
    summary: t(
      'Reads a diagnostic message safely; delegates to `safeErrorReason()`.',
      '安全地读取诊断信息；交给 `safeErrorReason()` 处理。'
    ),
    params: {
      error: t('Any caught value.', '任意捕获到的值。'),
      fallback: t('Text used when the message cannot be read.', '无法读取信息时使用的文本。')
    },
    returns: t('The message or the fallback.', '错误信息或后备文本。'),
    example: `console.warn(IdentifyError.reason(error, 'unknown failure'))`
  },
  serialize: {
    summary: t(
      'Serializes the whole chain for a worker or RPC boundary; delegates to `serializeErrorChain()`.',
      '为线程或远程调用边界序列化整条错误链；交给 `serializeErrorChain()` 处理。'
    ),
    params: {
      error: t('Error to serialize.', '要序列化的错误。'),
      strategy: t('Optional `IErrorChainStrategy`.', '可选的序列化策略 `IErrorChainStrategy`。')
    },
    returns: t('An `ISerializedErrorChain`.', '序列化结果 `ISerializedErrorChain`。'),
    example: `port.postMessage(IdentifyError.serialize(error))`
  },
  deserialize: {
    summary: t(
      'Restores a serialized chain with its identities; delegates to `deserializeErrorChain()`.',
      '还原序列化的错误链及其身份；交给 `deserializeErrorChain()` 处理。'
    ),
    params: {
      value: t('Value received from the other side.', '从另一端收到的值。'),
      strategy: t('Optional `IErrorChainStrategy`.', '可选的序列化策略 `IErrorChainStrategy`。')
    },
    returns: t(
      'The restored `Error`; malformed input throws `ERROR_CHAIN_INVALID`.',
      '还原后的 `Error`；输入格式不对时抛出 `ERROR_CHAIN_INVALID`。'
    ),
    example: `const error = IdentifyError.deserialize(message.data)`
  }
}

// ---------------------------------------------------------------------------------------------
// ConfigOwner
// ---------------------------------------------------------------------------------------------

/** End-to-end `ConfigOwner` example. */
const configOwnerExample: IText = {
  en: `import { ConfigOwner } from '@migaia/utils/config'

type IAppConfig = { server: { host: string; port: number }; debug: boolean }

const config = new ConfigOwner<IAppConfig>(
  { server: { host: 'localhost', port: 80 }, debug: false },
  { validate: (value) => value.server.port > 0 }
)

// restart the server only when the port changed
const stop = config.watch('server.port', (port) => console.log('restart on', port))

config.set('server.port', 8080).patch({ debug: true })
console.log(config.get('server.port'), config.toString())
stop()`,
  zh: `import { ConfigOwner } from '@migaia/utils/config'

type IAppConfig = { server: { host: string; port: number }; debug: boolean }

const config = new ConfigOwner<IAppConfig>(
  { server: { host: 'localhost', port: 80 }, debug: false },
  { validate: (value) => value.server.port > 0 }
)

// 只有端口变化时才重启服务
const stop = config.watch('server.port', (port) => console.log('restart on', port))

config.set('server.port', 8080).patch({ debug: true })
console.log(config.get('server.port'), config.toString())
stop()`
}

/** Scenarios of `ConfigOwner`. */
const configOwnerScenarios = [
  t(
    'Keep one application config that many modules read, change it in place with validated, all-or-nothing writes, and notify only the modules whose path changed.',
    '维护一份被多个模块读取的应用配置，用经过校验、要么全成功要么不变的写入原地修改，并只通知路径真正变化的模块。'
  ),
  t(
    'Build the config from JSON text, a remote source or environment variables with `from()`, `fromAsync()` and `fromEnv()`.',
    '用 `from()`、`fromAsync()` 和 `fromEnv()` 从 JSON 文本、远程来源或环境变量构建配置。'
  )
]

/** Text shared by every typed path parameter. */
const pathParam = t(
  'Dot/bracket path typed from the config shape (`server.port`, `items.[0]`), or a pre-split segment list (`["server", "port"]`); dangerous keys such as `__proto__` throw `CONFIG_PATH_INVALID`.',
  '按配置结构推导类型的点号/方括号路径（`server.port`、`items.[0]`），或已拆分的段列表（`["server", "port"]`）；`__proto__` 等危险键抛出 `CONFIG_PATH_INVALID`。'
)

/** Text shared by every chainable write. */
const writeReturns = t(
  'This owner, for chaining. The write is all-or-nothing: on any error (validation, locked, reentrant) the previous snapshot stays committed.',
  '本实例本身，便于链式调用。写入要么全部生效、要么完全不变：任何错误（校验失败、已锁定、重入）都会保留之前的快照。'
)

/** Instance members of `ConfigOwner`. */
const configOwnerMembers: Readonly<Record<string, IMemberDoc>> = {
  locked: {
    summary: t(
      '`true` after `lock()`: every later write throws `CONFIG_READONLY`.',
      '调用 `lock()` 之后为 `true`：之后的每次写入都会抛出 `CONFIG_READONLY`。'
    )
  },
  get: {
    summary: t(
      'Reads the value at a typed path as a deep readonly view; nested writes through the view throw `CONFIG_READONLY`.',
      '按带类型的路径读取值，得到深只读视图；通过视图写入嵌套字段会抛出 `CONFIG_READONLY`。'
    ),
    params: { path: pathParam },
    returns: t(
      'The value typed from the path, or `undefined` when the path is missing.',
      '按路径推导出类型的值；路径不存在时为 `undefined`。'
    ),
    example: `const port = config.get('server.port') // number | undefined`
  },
  getOr: {
    summary: t(
      'Reads a path and falls back when it is missing; an own `undefined` value is returned as is, not replaced.',
      '读取路径，路径不存在时返回后备值；自有属性的值为 `undefined` 时原样返回，不会被替换。'
    ),
    params: {
      path: pathParam,
      fallback: t('Value returned when the path is missing.', '路径不存在时返回的值。')
    },
    returns: t('The stored value or `fallback`.', '已存储的值或 `fallback`。'),
    example: `const host = config.getOr('server.host', '0.0.0.0')`
  },
  require: {
    summary: t(
      'Reads a path that must exist; a missing path throws `CONFIG_VALUE_MISSING` naming the path.',
      '读取必须存在的路径；路径不存在时抛出带路径名的 `CONFIG_VALUE_MISSING`。'
    ),
    params: { path: pathParam },
    returns: t('The stored value, typed from the path.', '按路径推导出类型的已存储值。'),
    example: `const port = config.require('server.port')`
  },
  read: {
    summary: t(
      'Reads a path and tells a missing path apart from an own `undefined` value.',
      '读取路径，并区分“路径不存在”和“自有属性的值为 `undefined`”。'
    ),
    params: { path: pathParam },
    returns: t(
      '`{ kind: "missing" }` or `{ kind: "value", value }` (an `IConfigReadResult`).',
      '读取结果 `IConfigReadResult`：`{ kind: "missing" }` 或 `{ kind: "value", value }`。'
    ),
    example: `if (config.read('cache').kind === 'missing') enableDefaults()`
  },
  has: {
    summary: t(
      'Tells whether the path has an own value, which may be `undefined`.',
      '判断路径上是否有自有值（值本身可以是 `undefined`）。'
    ),
    params: { path: pathParam },
    returns: t('`true` when the path exists.', '路径存在时返回 `true`。'),
    example: `if (config.has('features')) render(config.get('features'))`
  },
  view: {
    summary: t(
      'Returns a deep readonly view of the current snapshot; structural writes through it throw `CONFIG_READONLY`.',
      '返回当前快照的深只读视图；通过它做结构性写入会抛出 `CONFIG_READONLY`。'
    ),
    returns: t(
      'The view typed as `IConfigView<T>`; it keeps showing the snapshot it was taken from after later writes.',
      '类型为 `IConfigView<T>` 的视图；之后再写入时，它仍显示取得时的那份快照。'
    ),
    example: `render(config.view())`
  },
  select: {
    summary: t(
      'Creates a new owner for a record subtree (for example `db`), sharing profile and limits but not listeners, validator or lock state.',
      '为某个记录子树（例如 `db`）创建新的配置实例，共享校验档位与上限，但不共享监听器、校验函数和锁定状态。'
    ),
    params: { path: pathParam },
    returns: t(
      'A new `ConfigOwner`; a missing path throws `CONFIG_VALUE_MISSING`, a non-record value throws `CONFIG_UNSUPPORTED`.',
      '新的 `ConfigOwner`；路径不存在时抛出 `CONFIG_VALUE_MISSING`，值不是记录时抛出 `CONFIG_UNSUPPORTED`。'
    ),
    example: `const db = config.select('db')`
  },
  diff: {
    summary: t(
      'Lists the paths that differ between this snapshot and another owner or plain record, comparing records and arrays key by key.',
      '列出本快照与另一个配置实例或普通记录之间不同的路径，记录和数组按键逐一比较。'
    ),
    params: {
      other: t(
        'A `ConfigOwner` or plain record to compare with, for example a freshly loaded config.',
        '用来比较的 `ConfigOwner` 或普通记录，例如刚加载的新配置。'
      )
    },
    returns: t(
      'A frozen array of `IConfigDiffEntry`; `added` means only in `other`, `removed` only in this snapshot.',
      '冻结的 `IConfigDiffEntry` 数组；`added` 表示只在 `other` 中，`removed` 表示只在本快照中。'
    ),
    example: `for (const change of config.diff(reloaded)) console.log(change.kind, change.path.join('.'))`
  },
  equals: {
    summary: t(
      'Tells whether another owner or plain record holds the same data (deep, own keys).',
      '判断另一个配置实例或普通记录是否持有相同的数据（深比较自有键）。'
    ),
    params: {
      other: t(
        'A `ConfigOwner` or plain record to compare with.',
        '用来比较的 `ConfigOwner` 或普通记录。'
      )
    },
    returns: t('`true` when `diff(other)` is empty.', '`diff(other)` 为空时返回 `true`。'),
    example: `if (!config.equals(reloaded)) config.combine(reloaded)`
  },
  set: {
    summary: t(
      'Writes one path with copy-on-write; missing intermediate records are created, and an intermediate that is neither a record nor an array throws `CONFIG_PATH_INVALID`.',
      '按写时复制写入一个路径；缺失的中间记录会自动创建，中间值既不是记录也不是数组时抛出 `CONFIG_PATH_INVALID`。'
    ),
    params: {
      path: pathParam,
      value: t(
        'New value; its type is checked against the path, with literal leaves widened (`8080` is accepted for a `number`).',
        '新值；其类型按路径检查，字面量会放宽（`number` 字段接受 `8080`）。'
      )
    },
    returns: writeReturns,
    example: `config.set('server.port', 8080).set('server.host', 'localhost')`
  },
  delete: {
    summary: t(
      'Removes one path; deleting a missing path does nothing, and an array item is removed by index.',
      '删除一个路径；删除不存在的路径不做任何事，数组元素按下标删除。'
    ),
    params: { path: pathParam },
    returns: writeReturns,
    example: `config.delete('server.host')`
  },
  patch: {
    summary: t(
      'Applies a root-level overlay through `patchConfig`; `CONFIG_DELETE` as a value removes that root key.',
      '通过 `patchConfig` 应用根级覆盖；值为 `CONFIG_DELETE` 时删除该根键。'
    ),
    params: {
      patch: t(
        'Plain record of root keys to replace or delete.',
        '要替换或删除的根键组成的普通记录。'
      ),
      options: t(
        'Optional `IConfigPatchOptions` forwarded to `patchConfig`; omitted keeps the owner’s profile and limits.',
        '可选的 `IConfigPatchOptions`，原样交给 `patchConfig`；省略时沿用本实例的档位与上限。'
      )
    },
    returns: writeReturns,
    example: `config.patch({ debug: true, legacy: CONFIG_DELETE })`
  },
  combine: {
    summary: t(
      'Merges sources into this owner through `combineConfig`, later sources winning and records merging deeply. Pass a list plus `IConfigCombineOptions` to choose merge strategies. The owner is retyped with the merged shape.',
      '通过 `combineConfig` 把来源合并进本实例：后面的来源优先，记录深度合并。传入列表和 `IConfigCombineOptions` 可以选择合并策略。实例的类型会更新为合并后的结构。'
    ),
    params: {
      sources: t(
        'Plain records or other owners, merged left to right; or, in the list form, an array of them.',
        '普通记录或其他配置实例，从左到右合并；列表形式时为它们组成的数组。'
      ),
      options: t(
        'List form only: `IConfigCombineOptions` (`strategies`, `pathRules`, `onConflict`).',
        '仅列表形式：`IConfigCombineOptions`（`strategies`、`pathRules`、`onConflict`）。'
      )
    },
    returns: t(
      'This owner retyped as `ConfigOwner<T & merged>`, for chaining; failures leave the previous snapshot.',
      '本实例本身，类型更新为 `ConfigOwner<T & 合并结构>`，便于链式调用；失败时保留之前的快照。'
    ),
    example: `config.combine({ cache: { ttl: 60 } }).get('cache.ttl')
config.combine([override], { strategies: { array: 'concat' } })`
  },
  batch: {
    summary: t(
      'Runs several writes as one commit: the validator and watchers run once at the end. If the callback throws or validation fails, every write of the batch is rolled back. Nested batches join the outer one.',
      '把多次写入作为一次提交：校验函数和监听器只在最后运行一次。回调抛错或校验失败时，整批写入全部回滚。嵌套的批处理并入外层。'
    ),
    params: {
      fn: t(
        'Synchronous callback that receives this owner and performs the writes.',
        '同步回调，接收本实例并执行写入。'
      )
    },
    returns: writeReturns,
    example: `config.batch((draft) => draft.set('server.host', 'h').set('server.port', 1))`
  },
  reset: {
    summary: t(
      'Restores the snapshot captured at construction; watchers fire when it differs from the current one.',
      '恢复构造时的快照；与当前快照不同时会触发监听器。'
    ),
    returns: writeReturns,
    example: `config.reset()`
  },
  lock: {
    summary: t(
      'Rejects every later write with `CONFIG_READONLY`; reads keep working. It cannot be undone; use `clone()` for a writable copy.',
      '之后的每次写入都以 `CONFIG_READONLY` 拒绝，读取不受影响。无法撤销；需要可写副本时用 `clone()`。'
    ),
    returns: t('This owner, now locked.', '已锁定的本实例。'),
    example: `export const appConfig = config.lock()`
  },
  watch: {
    summary: t(
      'Watches the whole snapshot, or one path (called only when data under that path changed). Listeners run after each commit in registration order; a throw goes to `report`, and a write from inside a listener throws `REENTRANT_CALL`.',
      '监听整份快照，或只监听一个路径（只有该路径下的数据变化时才调用）。每次提交后按注册顺序调用监听器；监听器抛错交给 `report`，在监听器内写入会抛出 `REENTRANT_CALL`。'
    ),
    params: {
      path: t(
        'Optional path to watch, typed like `get()`; omit it to watch the whole snapshot.',
        '可选的监听路径，类型与 `get()` 一致；省略时监听整份快照。'
      ),
      listener: t(
        'Callback `(next, prev)` receiving readonly views of the new and old value (or of the whole snapshot).',
        '回调 `(next, prev)`，接收新值和旧值的只读视图（或整份快照的只读视图）。'
      )
    },
    returns: t('An idempotent unsubscribe function.', '可重复调用的取消监听函数。'),
    example: `const stop = config.watch('server.port', (next, prev) => restart(next))`
  },
  clone: {
    summary: t(
      'Creates a new owner with the same snapshot, options and validator; listeners and lock state are not copied.',
      '创建快照、选项和校验函数都相同的新实例；不复制监听器和锁定状态。'
    ),
    returns: t('An independent `ConfigOwner` of the same type.', '同一类型的独立 `ConfigOwner`。'),
    example: `const draft = config.clone().set('debug', true)`
  },
  toJSON: {
    summary: t(
      'Converts the current snapshot into JSON data: dates become ISO strings, and values JSON cannot represent (Map, Set, functions) throw `CONFIG_UNSUPPORTED`.',
      '把当前快照转换为 JSON 数据：日期变成 ISO 字符串，JSON 无法表示的值（`Map`、`Set`、函数）抛出 `CONFIG_UNSUPPORTED`。'
    ),
    returns: t(
      'A plain JSON record; `JSON.stringify(config)` uses it.',
      '普通 JSON 记录；`JSON.stringify(config)` 会调用它。'
    ),
    example: `await writeFile('config.json', JSON.stringify(config))`
  },
  toString: {
    summary: t('Formats the current snapshot as JSON text.', '把当前快照格式化为 JSON 文本。'),
    params: {
      space: t(
        'Optional indentation forwarded to `JSON.stringify`.',
        '可选的缩进，原样交给 `JSON.stringify`。'
      )
    },
    returns: t('The JSON text of the snapshot.', '当前快照的 JSON 文本。'),
    example: `console.log(config.toString(2))`
  }
}

/** Static members of `ConfigOwner`. */
const configOwnerStatics: Readonly<Record<string, IMemberDoc>> = {
  from: {
    summary: t(
      'Parses JSON text into an owner. Non-string input or invalid JSON throws `CONFIG_PARSE_FAILED` with the parser error on `cause`; a non-record root throws `CONFIG_UNSUPPORTED`.',
      '把 JSON 文本解析为配置实例。输入不是字符串或不是合法 JSON 时抛出 `CONFIG_PARSE_FAILED`，解析错误保存在 `cause` 上；根不是记录时抛出 `CONFIG_UNSUPPORTED`。'
    ),
    params: {
      text: t(
        'JSON text, for example the content of `config.json`.',
        'JSON 文本，例如 `config.json` 的内容。'
      ),
      options: t(
        'Optional `IConfigOwnerParseOptions`.',
        '可选的解析选项 `IConfigOwnerParseOptions`。'
      )
    },
    returns: t(
      'A new `ConfigOwner` typed by the generic argument.',
      '按泛型参数确定类型的新 `ConfigOwner`。'
    ),
    example: `const config = ConfigOwner.from<{ port: number }>('{"port":80}')`
  },
  fromAsync: {
    summary: t(
      'Builds an owner from an async source: a Promise, a value, or a factory that receives an abort signal; strings are parsed as JSON. Source rejections and factory throws become `CONFIG_SOURCE_FAILED`, retaining the original source failure on `cause`; `signal` and `timeoutMs` reject with the standard abort and timeout errors. Pair it with `createResource` from `@migaia/resource` to get a reactive config resource.',
      '从异步来源构建配置实例：Promise、普通值，或接收中止信号的工厂函数；字符串按 JSON 解析。来源拒绝或工厂抛错变为 `CONFIG_SOURCE_FAILED`，原始来源失败保存在 `cause` 上；`signal` 与 `timeoutMs` 以标准的中止和超时错误拒绝。把它放进 `@migaia/resource` 的 `createResource` 返回的加载函数里，就得到响应式的配置资源。'
    ),
    params: {
      source: t(
        '`IConfigAsyncSource`: value, Promise or factory.',
        '异步来源 `IConfigAsyncSource`：值、Promise 或工厂函数。'
      ),
      options: t(
        'Optional `IConfigOwnerAsyncOptions`.',
        '可选的异步选项 `IConfigOwnerAsyncOptions`。'
      )
    },
    returns: t('A Promise of a new `ConfigOwner`.', '以新的 `ConfigOwner` 完成的 Promise。'),
    example: `const config = createResource(() => ({ signal }) =>
  ConfigOwner.fromAsync(fetch('/config.json', { signal }).then((r) => r.text()), { timeoutMs: 5000 })
)`
  },
  fromEnv: {
    summary: t(
      'Builds a nested config from flat environment variables (`process.env`, `Deno.env.toObject()` or any record). Values stay strings unless `coerce` converts them; conflicting keys such as `APP__DB` and `APP__DB__PORT` throw `CONFIG_CONFLICT`.',
      '从扁平的环境变量（`process.env`、`Deno.env.toObject()` 或任意记录）构建嵌套配置。值保持字符串，除非 `coerce` 转换它们；`APP__DB` 与 `APP__DB__PORT` 这类冲突的键抛出 `CONFIG_CONFLICT`。'
    ),
    params: {
      env: t('Record of variable names to string values.', '变量名到字符串值的记录。'),
      options: t(
        'Optional `IConfigOwnerEnvOptions`.',
        '可选的环境变量选项 `IConfigOwnerEnvOptions`。'
      )
    },
    returns: t('A new `ConfigOwner` of the nested record.', '持有嵌套记录的新 `ConfigOwner`。'),
    example: `ConfigOwner.fromEnv(process.env, { prefix: 'APP__', key: (segment) => segment.toLowerCase() })`
  },
  merge: {
    summary: t(
      'Merges sources left to right into a new owner, later sources winning and records merging deeply; the result is typed with the merged shape.',
      '把来源从左到右合并成新的配置实例，后面的来源优先，记录深度合并；结果的类型为合并后的结构。'
    ),
    params: {
      sources: t('One or more plain records or owners.', '一个或多个普通记录或配置实例。')
    },
    returns: t(
      'A new `ConfigOwner`; the inputs are not changed.',
      '新的 `ConfigOwner`；输入不会被修改。'
    ),
    example: `const config = ConfigOwner.merge(defaults, fileConfig, envConfig)`
  },
  is: {
    summary: t(
      'Brand check that is `true` only for real `ConfigOwner` instances; objects created from its prototype fail.',
      '品牌检查：只有真正的 `ConfigOwner` 实例才返回 `true`；基于其原型伪造的对象不通过。'
    ),
    params: { value: t('Any value.', '任意待检查的值。') },
    returns: t('`true` for an owner.', '是配置实例时返回 `true`。'),
    example: `if (ConfigOwner.is(input)) input.combine(overrides)`
  }
}

/** Fields shared by every `ConfigOwner` options type. */
const configOwnerOptionMembers: Readonly<Record<string, IMemberDoc>> = {
  validate: {
    summary: t(
      'Validator `(view) => boolean | void` run on construction and before every commit (once per `batch`). Throwing or returning `false` rejects the change with `CONFIG_VALIDATION_FAILED`, the validator error on `cause`.',
      '校验函数 `(view) => boolean | void`，在构造时和每次提交前运行（`batch` 只运行一次）。抛错或返回 `false` 时以 `CONFIG_VALIDATION_FAILED` 拒绝修改，校验错误保存在 `cause` 上。'
    ),
    default: t(
      'Not set: every structurally valid snapshot is accepted.',
      '不设置：所有结构合法的快照都会被接受。'
    )
  },
  report: {
    summary: t(
      'Receives errors thrown by `watch()` listeners, so a failing listener is never swallowed and never stops the others.',
      '接收 `watch()` 监听器抛出的错误，失败的监听器不会被吞掉，也不会影响其他监听器。'
    ),
    default: t(
      'Not set: the error is rethrown from a microtask so the host reports it as uncaught.',
      '不设置：错误会在微任务中重新抛出，由宿主作为未捕获错误报告。'
    )
  },
  profile: {
    summary: t(
      'Validation profile forwarded to `ownConfig`: which values the config may contain.',
      '交给 `ownConfig` 的校验档位，决定配置中允许哪些值。'
    ),
    default: t('`data`: portable plain data only.', '`data`：只允许可移植的纯数据。'),
    values: { enum: 'ConfigProfile' }
  },
  limits: {
    summary: t(
      'Partial `IConfigLimits` forwarded to `ownConfig` (depth, node, key and path bounds).',
      '交给 `ownConfig` 的部分 `IConfigLimits`（深度、节点、键和路径长度上限）。'
    ),
    default: t('Not set: the package default limits apply.', '不设置：使用本包的默认上限。')
  }
}

/** Fields added by the parse options. */
const parseOptionMembers: Readonly<Record<string, IMemberDoc>> = {
  ...configOwnerOptionMembers,
  reviver: {
    summary: t(
      'Reviver forwarded to `JSON.parse`, for example to turn ISO strings back into dates.',
      '交给 `JSON.parse` 的还原函数，例如把 ISO 字符串还原成日期。'
    ),
    default: t('Not set: plain `JSON.parse`.', '不设置：直接使用 `JSON.parse`。')
  }
}

// ---------------------------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------------------------

/** Text shared by `signal` options of the scheduling helpers. */
const cancelSignal = (en: string, zh: string): IMemberDoc => ({
  summary: t(en, zh),
  default: t('Not set: the work cannot be cancelled from outside.', '不设置：无法从外部取消。')
})

/** Text shared by the injectable scheduler option. */
const schedulerOption: IMemberDoc = {
  summary: t(
    'Timer source implementing `IScheduler`; inject `createManualScheduler()` from `@migaia/utils/testing` to drive time in tests.',
    '实现 `IScheduler` 的定时器来源；测试时注入 `@migaia/utils/testing` 的 `createManualScheduler()` 来手动推进时间。'
  ),
  default: t(
    '`systemScheduler`: host timers and `performance.now()`.',
    '`systemScheduler`：宿主定时器和 `performance.now()`。'
  )
}

/** Strategy parameter text shared by several functions. */
const strategyParam = t(
  'One `AsyncTaskStrategy` key, or an ordered list of keys used as a fallback chain; the first one the host supports is used.',
  '一个 `AsyncTaskStrategy` 键，或作为回退顺序的键列表；使用宿主支持的第一个。'
)

/** Time-slice options doc. */
const timeSliceOptionMembers: Readonly<Record<string, IMemberDoc>> = {
  budget: {
    summary: t(
      'Milliseconds of work per slice before yielding to the host; at least one item always runs per slice.',
      '每个时间片在让出宿主之前最多工作的毫秒数；每片至少处理一项。'
    ),
    default: t('`8`: half a 60 Hz frame.', '`8`：约为 60 Hz 一帧的一半。')
  },
  strategy: {
    summary: t(
      'How to yield between slices: an `AsyncTaskStrategy` key or an ordered fallback list.',
      '时间片之间如何让出：一个 `AsyncTaskStrategy` 键或有序的回退列表。'
    ),
    default: t('`auto`: the fastest supported macrotask.', '`auto`：宿主支持的最快宏任务。'),
    values: { enum: 'AsyncTaskStrategy' }
  },
  signal: cancelSignal(
    'Stops at the next item boundary: the iterator is closed and the Promise rejects with `UtilsAbortError`.',
    '在下一项开始前停止：关闭迭代器，Promise 以 `UtilsAbortError` 拒绝。'
  ),
  onProgress: {
    summary: t(
      'Called with an `ITimeSliceReport` after every slice and once at the end; a throw stops the run like a handler throw.',
      '每个时间片结束后以及全部完成时，传入 `ITimeSliceReport` 调用；它抛错会像处理函数抛错一样停止整个处理。'
    ),
    default: t('Not set: no progress callbacks.', '不设置：不回调进度。')
  },
  'clock.now': {
    summary: t(
      'Returns the current monotonic time in milliseconds; read before and after items to measure the budget.',
      '返回当前单调时间（毫秒）；在处理数据项前后读取，用来计量时间预算。'
    )
  },
  clock: {
    summary: t(
      'Monotonic clock `{ now() }` that measures the budget; inject a fake one in tests.',
      '用来计量时间预算的单调时钟 `{ now() }`；测试时可注入假时钟。'
    ),
    default: t(
      '`systemScheduler` (`performance.now()`).',
      '使用系统调度器 `systemScheduler` 的单调时钟。'
    )
  }
}

/** Debounce option docs. */
const debounceOptionMembers: Readonly<Record<string, IMemberDoc>> = {
  leading: {
    summary: t(
      'Invoke on the first call of a burst instead of (or in addition to) its end.',
      '在一串调用的第一次就执行，而不只是（或同时也在）结束时执行。'
    ),
    default: t('`false`', '`false`：开头不执行。')
  },
  trailing: {
    summary: t(
      'Invoke once more with the latest arguments when the burst has been quiet for `wait` milliseconds.',
      '一串调用安静 `wait` 毫秒后，用最新参数再执行一次。'
    ),
    default: t('`true`', '`true`：结束时执行。')
  },
  maxWait: {
    summary: t(
      'Upper bound in milliseconds that a continuous burst may postpone an invocation; keeps autosave from never firing while the user keeps typing.',
      '连续调用最多能把执行推迟多少毫秒；用户一直输入时，自动保存也会按时触发。'
    ),
    default: t('Not set: a burst can postpone forever.', '不设置：连续调用可以一直推迟执行。')
  },
  signal: cancelSignal(
    'Disposes permanently when it aborts: the pending call is dropped and later calls are ignored.',
    '中止时永久失效：丢弃待执行的调用，之后的调用全部忽略。'
  ),
  scheduler: schedulerOption
}

/** Throttle option docs. */
const throttleOptionMembers: Readonly<Record<string, IMemberDoc>> = {
  leading: {
    summary: t('Invoke on the first call of each window.', '每个窗口的第一次调用立即执行。'),
    default: t('`true`', '`true`：窗口开始时执行。')
  },
  trailing: {
    summary: t(
      'Invoke once at the end of a window with the latest arguments when calls arrived during it.',
      '窗口内有新的调用时，在窗口结束时用最新参数再执行一次。'
    ),
    default: t('`true`', '`true`：窗口结束时补一次。')
  },
  signal: debounceOptionMembers.signal,
  scheduler: schedulerOption
}

/** Methods of the controlled function returned by `debounce` / `throttle`. */
const controlledMembers: Readonly<Record<string, IMemberDoc>> = {
  cancel: {
    summary: t('Drops the pending invocation and its timers.', '丢弃待执行的调用及其定时器。'),
    returns: t(
      'Nothing; no invocation happens until the next call.',
      '无返回值；在下一次调用前不会执行。'
    ),
    example: `save.cancel()`
  },
  flush: {
    summary: t(
      'Runs the pending invocation now; errors throw to the caller.',
      '立即执行待执行的调用；错误直接抛给调用方。'
    ),
    returns: t(
      'The invocation result, or the last result when nothing was pending.',
      '本次执行的结果；没有待执行调用时返回上一次的结果。'
    ),
    example: `window.addEventListener('pagehide', () => save.flush())`
  },
  pending: {
    summary: t('Tells whether an invocation is waiting to run.', '判断是否有调用正在等待执行。'),
    returns: t('`true` while one is pending.', '有待执行的调用时返回 `true`。'),
    example: `if (save.pending()) showSavingBadge()`
  },
  '[Symbol.dispose]': {
    summary: t(
      'Same as `cancel()`, so a `using` declaration cleans up.',
      '与 `cancel()` 相同，使 `using` 声明能自动清理。'
    ),
    returns: t('Nothing; the pending invocation is dropped.', '无返回值；待执行的调用被丢弃。'),
    example: `using save = debounce(persist, 500)`
  }
}

/** Repeat option docs. */
const repeatOptionMembers: Readonly<Record<string, IMemberDoc>> = {
  signal: cancelSignal(
    'Stops the loop like `stop()` when it aborts; `done` resolves.',
    '中止时像 `stop()` 一样停止循环，`done` 正常完成。'
  ),
  immediate: {
    summary: t(
      'Run the first iteration right away instead of after one interval.',
      '第一轮立即执行，而不是等一个间隔。'
    ),
    default: t('`false`: the first run waits one interval.', '`false`：第一轮等待一个间隔。')
  },
  maxIterations: {
    summary: t(
      'Stop after this many iterations; `done` then resolves.',
      '执行这么多轮后停止，`done` 随之完成。'
    ),
    default: t('Unlimited.', '不限次数。')
  },
  onError: {
    summary: t('What a failing iteration does to the loop.', '某一轮失败时循环如何处理。'),
    default: t('`stop`', '`stop`：停止循环。'),
    values: {
      stop: t(
        'Stop the loop and reject `done` with the original error.',
        '停止循环，并以原始错误拒绝 `done`。'
      ),
      continue: t(
        'Report the error to the host and keep going; use it for polling that must survive network errors.',
        '把错误报告给宿主并继续；适合需要扛过网络错误的轮询。'
      )
    }
  },
  scheduler: schedulerOption
}

/** Async task options doc. */
const asyncTaskOptionMembers: Readonly<Record<string, IMemberDoc>> = {
  delay: {
    summary: t(
      'Milliseconds to wait before the strategy’s queue is used. `timeout` and the `postTask*` keys use the host’s native delay; the others wait on a timer first.',
      '进入所选队列之前等待的毫秒数。`timeout` 和 `postTask*` 使用宿主原生延迟，其余策略先用定时器等待。'
    ),
    default: t('`0`: no extra wait.', '`0`：不额外等待。')
  },
  signal: cancelSignal(
    'Cancels the task before the callback starts: the host registration is cancelled and the Promise rejects with `UtilsAbortError`; after the callback started it has no effect.',
    '在回调开始前取消任务：撤销宿主注册，Promise 以 `UtilsAbortError` 拒绝；回调开始后再中止不起作用。'
  ),
  idleTimeout: {
    summary: t(
      '`idleCallback` only: run after this many milliseconds even without an idle period (native `timeout` of `requestIdleCallback`).',
      '仅用于 `idleCallback`：即使一直没有空闲期，也在这么多毫秒后执行（即 `requestIdleCallback` 的 `timeout`）。'
    ),
    default: t('Not set: wait for a real idle period.', '不设置：等到真正的空闲期。')
  }
}

/** Runtime symbols added by the facades. */
export const utilsFacadeSymbols: Readonly<Record<string, ISymbolDoc>> = {
  IdentifyError: {
    role: 'error',
    purpose: t(
      'Error class with a stable identity (`source`, `code`, optional `phase` and `detail`) that gathers the error helpers of this module into one API. Identity fields are readonly own properties attached with `attachErrorIdentity`, the original failure stays on `cause` and is returned by `native()`, and `stack` is never rewritten. Statics build (`from`, `define`, `assert`, `wrap`) and inspect (`is`, `find`, `match`, `identityOf`) errors; instances compare and derive without mutation.',
      '带稳定身份（`source`、`code`，可选 `phase` 与 `detail`）的错误类，把本模块的错误工具集中成一个 API。身份字段由 `attachErrorIdentity` 写成只读自有属性，原始失败保留在 `cause` 上并由 `native()` 返回，调用栈不会被改写。静态方法用于创建（`from`、`define`、`assert`、`wrap`）和检查（`is`、`find`、`match`、`identityOf`）错误；实例方法只比较和派生，不修改原错误。'
    ),
    params: {
      identity: t(
        '`IIdentifyErrorIdentity`: non-empty `source` and `code`, optional `phase` string and plain-record `detail`.',
        '`IIdentifyErrorIdentity`：非空的 `source` 与 `code`，可选的 `phase` 字符串和普通记录 `detail`。'
      )
    },
    options: 'IIdentifyErrorOptions',
    returns: t(
      'A new `IdentifyError`; an invalid identity throws a coded `TypeError` (`INVALID_ARGUMENT`).',
      '新的 `IdentifyError`；身份不合法时抛出带错误码的 `TypeError`（`INVALID_ARGUMENT`）。'
    ),
    example: identifyErrorExample,
    scenarios: identifyErrorScenarios,
    avoid: [
      t(
        'Errors that never leave the function that throws them: a plain `Error` is enough.',
        '不会离开抛出它的函数的错误：用普通 `Error` 就够了。'
      )
    ]
  },
  ConfigOwner: {
    role: 'factory',
    purpose: t(
      'Stateful owner of one immutable config snapshot, built on `ownConfig`, `patchConfig`, `combineConfig` and `readonlyConfig`. Every write builds and validates a complete next snapshot before committing it, so a failed write changes nothing; writes return the owner for chaining, reads return deep readonly views typed from the path, and watchers run once per commit. Statics `from`, `fromAsync`, `fromEnv` and `merge` build owners from JSON text, async sources, environment variables and several sources.',
      '持有一份不可变配置快照的有状态对象，建立在 `ownConfig`、`patchConfig`、`combineConfig` 和 `readonlyConfig` 之上。每次写入先构建并校验完整的下一份快照再提交，失败的写入不会改变任何东西；写入返回实例本身便于链式调用，读取返回按路径推导类型的深只读视图，每次提交只触发一次监听。静态方法 `from`、`fromAsync`、`fromEnv` 和 `merge` 分别从 JSON 文本、异步来源、环境变量和多个来源构建实例。'
    ),
    params: {
      value: t(
        'Plain root record, copied and validated by `ownConfig`; arrays, symbol keys or unsupported values throw `CONFIG_UNSUPPORTED`.',
        '普通根记录，由 `ownConfig` 复制并校验；数组、符号键或不支持的值抛出 `CONFIG_UNSUPPORTED`。'
      )
    },
    options: 'IConfigOwnerOptions',
    returns: t(
      'A new `ConfigOwner`; a rejected initial value throws `CONFIG_VALIDATION_FAILED`.',
      '新的 `ConfigOwner`；初始值被校验函数拒绝时抛出 `CONFIG_VALIDATION_FAILED`。'
    ),
    example: configOwnerExample,
    scenarios: configOwnerScenarios,
    avoid: [
      t(
        'A config that is read once at startup and never changes: `readonlyConfig(ownConfig(value))` is simpler.',
        '启动时读取一次、之后不再变化的配置：直接用 `readonlyConfig(ownConfig(value))` 更简单。'
      )
    ]
  },
  AsyncTaskStrategy: {
    role: 'constant',
    purpose: t(
      'Every queue `asyncTask()` can schedule on: microtasks, Node tick and check queues, timers, message-channel tasks, animation frames, idle periods and the prioritized task scheduler. Pick the key by the queue you need; a key the host lacks throws `ENV_UNSUPPORTED` instead of silently degrading.',
      '`asyncTask()` 可以使用的全部队列：微任务、Node 的 tick 与 check 队列、定时器、消息通道任务、动画帧、空闲期以及按优先级排队的任务调度器。按需要的队列选择键；宿主不支持的键会抛出 `ENV_UNSUPPORTED`，不会静默降级。'
    ),
    example: `await asyncTask(AsyncTaskStrategy.postTaskBackground, flushLogs)`
  },
  asyncTask: {
    role: 'operation',
    purpose: t(
      'Runs a callback later on the chosen queue and resolves with its result. Pass a list of strategies to declare your own fallback order. Arguments and host support are checked synchronously: an unknown strategy or invalid delay throws `INVALID_ARGUMENT`, a strategy the host lacks throws `ENV_UNSUPPORTED`. The callback receives the concrete strategy that ran plus frame or idle data.',
      '在所选队列上稍后执行回调，并以回调结果完成。传入策略列表即可声明自己的回退顺序。参数与宿主支持情况同步检查：未知策略或非法延迟抛出 `INVALID_ARGUMENT`，宿主不支持的策略抛出 `ENV_UNSUPPORTED`。回调会收到实际使用的策略，以及帧时间或空闲期信息。'
    ),
    params: {
      strategy: strategyParam,
      callback: t(
        'Function `(context) => value | Promise`; `context.strategy` is the concrete strategy, `frameTime` comes with `animationFrame`, `didTimeout` and `timeRemaining()` with `idleCallback`. A throw or rejection rejects the returned Promise with the original error.',
        '函数 `(context) => value | Promise`；`context.strategy` 是实际使用的策略，`animationFrame` 额外提供 `frameTime`，`idleCallback` 额外提供 `didTimeout` 与 `timeRemaining()`。回调抛错或拒绝时，返回的 Promise 以原始错误拒绝。'
      ),
      delayOrOptions: t(
        'A delay in milliseconds, or `IAsyncTaskOptions` (`delay`, `signal`, `idleTimeout`).',
        '延迟毫秒数，或 `IAsyncTaskOptions`（`delay`、`signal`、`idleTimeout`）。'
      )
    },
    returns: t(
      'A Promise of the callback result; it rejects with `UtilsAbortError` when `signal` aborts before the callback starts.',
      '回调结果的 Promise；`signal` 在回调开始前中止时以 `UtilsAbortError` 拒绝。'
    ),
    example: `await asyncTask('idleCallback', ({ timeRemaining }) => prefetch(timeRemaining()), { idleTimeout: 2000 })
await asyncTask(['postTaskBackground', 'timeout'], flushLogs, 100)`,
    scenarios: [
      t(
        'Defer low-priority work (logging, prefetch) to background priority or idle time, with a fallback for hosts that lack it.',
        '把低优先级工作（日志、预取）放到后台优先级或空闲期执行，并为不支持的宿主准备回退。'
      ),
      t(
        'Run code right before the next paint with `animationFrame`.',
        '用 `animationFrame` 在下一次绘制之前执行代码。'
      )
    ],
    avoid: [
      t(
        'Waiting for a plain duration: `sleep()` is clearer.',
        '只是等待一段时间：用 `sleep()` 更清楚。'
      )
    ]
  },
  isAsyncTaskSupported: {
    role: 'operation',
    purpose: t(
      'Tells whether the current host provides the API behind one strategy, without scheduling anything; `auto` is supported whenever one of its fallbacks is.',
      '判断当前宿主是否提供某个策略所需的接口，不安排任何任务；只要 `auto` 的任一回退可用，它就算支持。'
    ),
    params: {
      strategy: t(
        'One `AsyncTaskStrategy` key to check.',
        '要检查的一个 `AsyncTaskStrategy` 策略键。'
      )
    },
    returns: t(
      '`true` when supported; unknown keys return `false`.',
      '支持时返回 `true`；未知键返回 `false`。'
    ),
    example: `const strategy = isAsyncTaskSupported('idleCallback') ? 'idleCallback' : 'timeout'`
  },
  resolveAsyncTaskStrategy: {
    role: 'operation',
    purpose: t(
      'Picks the first supported strategy of an ordered preference list (`auto` expands in place), the same choice `asyncTask()` makes.',
      '从有序的偏好列表中选出第一个宿主支持的策略（`auto` 原地展开），与 `asyncTask()` 的选择方式相同。'
    ),
    params: { preferred: strategyParam },
    returns: t(
      'The concrete strategy key; an empty list or unknown key throws `INVALID_ARGUMENT`, no supported entry throws `ENV_UNSUPPORTED`.',
      '具体的策略键；列表为空或含未知键时抛出 `INVALID_ARGUMENT`，没有可用项时抛出 `ENV_UNSUPPORTED`。'
    ),
    example: `console.log(resolveAsyncTaskStrategy(['postTaskBackground', 'idleCallback', 'timeout']))`
  },
  yieldToHost: {
    role: 'operation',
    purpose: t(
      'Resolves after yielding to the host once, so rendering, input, timers and I/O can run; `await` it inside long loops.',
      '让出宿主一次后完成，使渲染、输入、定时器和 I/O 有机会运行；在长循环里 `await` 它。'
    ),
    params: {
      strategy: t(
        'Optional strategy or fallback list; defaults to `auto`.',
        '可选的策略或回退列表；默认为 `auto`。'
      )
    },
    optionDocs: {
      signal: cancelSignal(
        'Rejects with `UtilsAbortError` when it aborts before the yield completes.',
        '让出完成前中止时，以 `UtilsAbortError` 拒绝。'
      )
    },
    returns: t('A Promise that resolves with `undefined`.', '以 `undefined` 完成的 Promise。'),
    example: `for (const [index, row] of rows.entries()) {
  index(row)
  if (index % 500 === 0) await yieldToHost()
}`
  },
  timeSlice: {
    role: 'operation',
    purpose: t(
      'Processes every item of a large or endless sequence in time slices: work runs until the slice budget is spent, then the host gets a turn. At least one item runs per slice, so progress is guaranteed. A handler throw closes the iterator and rejects with the original error; abort stops at the next item boundary.',
      '按时间片处理大量甚至无穷的数据：工作持续到本片预算用完，然后把执行权交还宿主。每片至少处理一项，保证一定有进展。处理函数抛错时关闭迭代器并以原始错误拒绝；中止时在下一项开始前停止。'
    ),
    params: {
      source: t(
        'Sync or async iterable: an array, a generator object, a stream iterator.',
        '同步或异步可迭代对象：数组、生成器对象、流的迭代器。'
      ),
      handler: t(
        'Function `(item, index)` called for each item; a returned Promise is awaited before the next item.',
        '对每一项调用的函数 `(item, index)`；返回 Promise 时等它完成再处理下一项。'
      )
    },
    options: 'ITimeSliceOptions',
    returns: t(
      'A Promise of the final `ITimeSliceReport` (`processed`, `slices`, `elapsedMs`); invalid arguments throw `INVALID_ARGUMENT` synchronously.',
      '最终 `ITimeSliceReport`（`processed`、`slices`、`elapsedMs`）的 Promise；参数不合法时同步抛出 `INVALID_ARGUMENT`。'
    ),
    example: `await timeSlice(rows, (row) => searchIndex.add(row), { budget: 5 })`,
    scenarios: [
      t(
        'Index, parse or render tens of thousands of rows in the browser without freezing input.',
        '在浏览器里索引、解析或渲染成千上万行数据，同时不让输入卡住。'
      ),
      t(
        'Keep a Node server responsive while a large batch job runs on the main thread.',
        '在主线程跑大批量任务时，让 Node 服务仍能及时响应请求。'
      )
    ],
    avoid: [
      t(
        'CPU work that must finish as fast as possible regardless of responsiveness: run it in a worker thread instead.',
        '不在乎响应性、只求尽快算完的计算：放到工作线程里执行。'
      )
    ]
  },
  timeSliceMap: {
    role: 'operation',
    purpose: t(
      'Time-sliced `map`: collects every mapper result in source order, with the same slicing, abort and error behaviour as `timeSlice()`.',
      '按时间片执行的 `map`：按原顺序收集每个映射结果，分片、中止和错误行为与 `timeSlice()` 相同。'
    ),
    params: {
      source: t('Sync or async iterable to map.', '要映射的同步或异步可迭代对象。'),
      mapper: t(
        'Function `(item, index) => result | Promise`; async results are awaited.',
        '函数 `(item, index) => result | Promise`；异步结果会被等待。'
      )
    },
    options: 'ITimeSliceOptions',
    returns: t('A Promise of the results array.', '结果数组的 Promise。'),
    example: `const parsed = await timeSliceMap(csvLines, parseLine)`
  },
  timeSliceReduce: {
    role: 'operation',
    purpose: t(
      'Time-sliced `reduce` with an explicit initial accumulator, with the same slicing, abort and error behaviour as `timeSlice()`.',
      '按时间片执行、带显式初始累加值的 `reduce`，分片、中止和错误行为与 `timeSlice()` 相同。'
    ),
    params: {
      source: t('Sync or async iterable to fold.', '要归约的同步或异步可迭代对象。'),
      reducer: t(
        'Function `(accumulator, item, index) => accumulator`.',
        '归约函数 `(accumulator, item, index) => accumulator`，返回新的累加值。'
      ),
      initial: t('Initial accumulator value.', '累加值的初始值。')
    },
    options: 'ITimeSliceOptions',
    returns: t('A Promise of the final accumulator.', '最终累加值的 Promise。'),
    example: `const total = await timeSliceReduce(orders, (sum, order) => sum + order.amount, 0)`
  },
  debounce: {
    role: 'operation',
    purpose: t(
      'Delays a function until calls stop for `wait` milliseconds, then runs it once with the latest arguments. `leading` also runs the first call of a burst, `maxWait` caps how long a continuous burst may postpone it. Errors of leading calls and `flush()` throw to the caller; errors of timer-driven calls are reported to the host.',
      '把函数推迟到调用停止 `wait` 毫秒之后，再用最新参数执行一次。`leading` 让一串调用的第一次也执行，`maxWait` 限制连续调用最多推迟多久。开头调用和 `flush()` 的错误抛给调用方；定时器触发的调用出错时报告给宿主。'
    ),
    params: {
      fn: t('Function to delay.', '要推迟执行的函数。'),
      wait: t('Quiet period in milliseconds.', '安静期，单位毫秒。')
    },
    options: 'IDebounceOptions',
    returns: t(
      'An `IControlledFunction` with `cancel()`, `flush()` and `pending()`; invalid arguments throw `INVALID_ARGUMENT`.',
      '带 `cancel()`、`flush()` 和 `pending()` 的 `IControlledFunction`；参数不合法时抛出 `INVALID_ARGUMENT`。'
    ),
    example: `const save = debounce((draft: string) => api.save(draft), 500, { maxWait: 5000 })
input.addEventListener('input', () => save(input.value))`
  },
  throttle: {
    role: 'operation',
    purpose: t(
      'Runs a function at most once per `wait` milliseconds, on the leading and trailing edge by default. Pass `animationFrame` to run at most once per rendered frame with the latest arguments (browser hosts only).',
      '让函数每 `wait` 毫秒最多执行一次，默认在窗口开头和结尾各执行。传入 `animationFrame` 时每帧最多执行一次并使用最新参数（仅浏览器宿主）。'
    ),
    params: {
      fn: t('Function to throttle.', '要限流的函数。'),
      wait: t(
        'Window in milliseconds, or `animationFrame` for once per frame.',
        '窗口长度（毫秒），或 `animationFrame` 表示每帧一次。'
      )
    },
    options: 'IThrottleOptions',
    returns: t(
      'An `IControlledFunction`; in frame mode a host without `requestAnimationFrame` reports `ENV_UNSUPPORTED` on the first call.',
      '一个 `IControlledFunction`；帧模式下宿主没有 `requestAnimationFrame` 时，第一次调用会报告 `ENV_UNSUPPORTED`。'
    ),
    example: `const onScroll = throttle(() => updateHeader(window.scrollY), 'animationFrame')
window.addEventListener('scroll', onScroll)`
  },
  coalesce: {
    role: 'operation',
    purpose: t(
      'Collects every call made before the chosen queue runs and delivers them in one invocation, in call order; useful for batching analytics events, writes or DOM reads of one tick.',
      '收集所选队列执行前的所有调用，按调用顺序一次性交给函数；适合把同一轮里的统计事件、写入或 DOM 读取合并处理。'
    ),
    params: {
      fn: t(
        'Function `(calls) => void` receiving a frozen array of argument lists; a throw is reported to the host.',
        '函数 `(calls) => void`，接收由各次参数组成的冻结数组；它抛错时报告给宿主。'
      ),
      strategy: t('When to deliver; defaults to `microtask`.', '何时交付；默认为 `microtask`。')
    },
    returns: t(
      'An `ICoalescedFunction` with `flush()`, `cancel()` and `size`.',
      '合并调用后的函数 `ICoalescedFunction`，带 `flush()`、`cancel()` 和 `size`。'
    ),
    example: `const track = coalesce((calls: [event: string][]) => send(calls.map(([event]) => event)))
track('open')
track('click') // one send(['open', 'click'])`
  },
  repeat: {
    role: 'operation',
    purpose: t(
      'Runs a task every `interval` milliseconds without overlap: the next run is scheduled only after the previous one settles. The schedule is corrected against the start time; after an overrun it realigns instead of firing a burst of catch-up runs.',
      '每隔 `interval` 毫秒执行一次任务，且不会重叠：上一轮结束后才安排下一轮。时间表按起点校正漂移；某一轮超时后重新对齐，而不是连发补跑。'
    ),
    params: {
      task: t(
        'Function `(context) => void | Promise`; `context.iteration` counts from 0 and `context.signal` aborts when the loop stops.',
        '函数 `(context) => void | Promise`；`context.iteration` 从 0 开始计数，`context.signal` 在循环停止时中止。'
      ),
      interval: t('Milliseconds between planned starts.', '两次计划开始之间的毫秒数。')
    },
    options: 'IRepeatOptions',
    returns: t(
      'An `IRepeatHandle` with `stop()`, `done` and `running`.',
      '循环句柄 `IRepeatHandle`，带 `stop()`、`done` 和 `running`。'
    ),
    example: `const poll = repeat(({ signal }) => refresh({ signal }), 30_000, { immediate: true, onError: 'continue' })
window.addEventListener('pagehide', () => poll.stop())`,
    scenarios: [
      t(
        'Poll an API without stacking requests when the server is slow.',
        '轮询接口时，即使服务端很慢也不会叠加请求。'
      )
    ],
    avoid: [
      t(
        'Server push is available: subscribe to it instead of polling.',
        '服务端能主动推送时：改用订阅，不要轮询。'
      )
    ]
  }
}

/** Types added by the facades. */
export const utilsFacadeTypes: Readonly<Record<string, ITypeDoc>> = {
  IdentifyError: {
    summary: t(
      'An error with a stable identity, created by `new IdentifyError()`, `IdentifyError.from()` or a `define()` factory; the instance is immutable and every derive method returns a new one.',
      '带稳定身份的错误，由 `new IdentifyError()`、`IdentifyError.from()` 或 `define()` 工厂创建；实例不可修改，派生方法都会返回新实例。'
    ),
    scenarios: identifyErrorScenarios,
    example: identifyErrorExample,
    members: { ...identifyErrorMembers, ...identifyErrorStatics }
  },
  IIdentifyErrorIdentity: {
    summary: t(
      'Identity accepted by `IdentifyError`; literal `source` and `code` types flow into the created error.',
      '`IdentifyError` 接受的身份；`source` 与 `code` 的字面量类型会带到创建出的错误上。'
    ),
    members: identityFieldMembers
  },
  IIdentifyErrorOptions: {
    summary: t(
      'Construction inputs of `IdentifyError` besides the identity.',
      '除身份以外，创建 `IdentifyError` 时可传的输入。'
    ),
    members: {
      message: {
        summary: t('Error message shown to developers.', '给开发者看的错误信息。'),
        default: t(
          'The cause’s message, or `[source] code` without a cause.',
          '取原因的错误信息；没有原因时为 `[source] code`。'
        )
      },
      cause: {
        summary: t(
          'Original failure kept on `cause`; its native root is returned by `native()`.',
          '保存在 `cause` 上的原始失败；`native()` 返回其原生根错误。'
        ),
        default: t(
          'Not set: the error has no cause and `native()` returns itself.',
          '不设置：没有原因，`native()` 返回错误本身。'
        )
      }
    }
  },
  IErrorIdentityMatch: {
    summary: t(
      'Partial identity used by `has()`, `is()` and `find()`; omitted fields match anything.',
      '`has()`、`is()` 和 `find()` 使用的部分身份；省略的字段匹配任意值。'
    ),
    members: {
      source: {
        summary: t(
          'Required `source`, when given; omitted matches any source.',
          '指定时要求 `source` 相等；省略时匹配任意来源。'
        )
      },
      code: {
        summary: t(
          'Required `code`, when given; omitted matches any code.',
          '指定时要求 `code` 相等；省略时匹配任意错误码。'
        )
      },
      phase: {
        summary: t(
          'Required `phase`, when given; omitted matches any phase.',
          '指定时要求 `phase` 相等；省略时匹配任意阶段。'
        )
      }
    }
  },
  IIdentifiedError: {
    summary: t(
      'Any native error that carries a readable identity, as returned by `IdentifyError.find()`; it need not be an `IdentifyError` instance.',
      '带可读身份的任意原生错误，即 `IdentifyError.find()` 的返回类型；不一定是 `IdentifyError` 实例。'
    ),
    members: identityFieldMembers
  },
  IMutableErrorIdentity: {
    summary: t(
      'Editable identity draft returned by `mutable()`; fields are plain writable properties.',
      '`mutable()` 返回的可编辑身份草稿；字段都是普通的可写属性。'
    ),
    members: identityFieldMembers
  },
  IErrorIdentityComparison: {
    summary: t(
      'Per-field result of `compare()`.',
      '`compare()` 的逐字段比较结果，每个字段一个布尔值。'
    ),
    members: {
      source: {
        summary: t(
          'Whether `source` is equal on both sides.',
          '两边的 `source` 是否相等，即是否来自同一个包。'
        )
      },
      code: {
        summary: t(
          'Whether `code` is equal on both sides.',
          '两边的 `code` 是否相等，即是否为同一个错误码。'
        )
      },
      phase: {
        summary: t(
          'Whether `phase` is equal (both absent counts as equal).',
          '`phase` 是否相等（两边都没有也算相等）。'
        )
      },
      detail: {
        summary: t(
          'Whether `detail` has the same own keys and values.',
          '`detail` 的自有键和值是否都相同。'
        )
      }
    }
  },
  IIdentifyErrorFactoryOptions: {
    summary: t(
      'Options of one factory call produced by `IdentifyError.define()`.',
      '`IdentifyError.define()` 生成的工厂函数每次调用时的选项。'
    ),
    members: {
      message: {
        summary: t('Error message shown to developers.', '给开发者看的错误信息。'),
        default: t(
          'The cause’s message, or `[source] code`.',
          '取原因的错误信息，否则为 `[source] code`。'
        )
      },
      cause: {
        summary: t(
          'Original failure kept on `cause` of the created error.',
          '保存在新错误 `cause` 上的原始失败对象。'
        ),
        default: t('Not set: no cause.', '不设置：没有原因。')
      },
      phase: {
        summary: t('Lifecycle phase of the failure.', '失败发生时所处的生命周期阶段。'),
        default: t('Not set: no phase.', '不设置：没有阶段。')
      },
      detail: {
        summary: t(
          'Plain record of diagnostic values; frozen on the error.',
          '诊断值组成的普通记录；在错误上被冻结。'
        ),
        default: t('Not set: no detail.', '不设置：没有明细。')
      }
    }
  },
  IIdentifyErrorFactory: {
    summary: t(
      'Package-scoped factory returned by `IdentifyError.define(source, codes)`: one constructor function per code key plus `is` and `find` narrowed to the source.',
      '`IdentifyError.define(source, codes)` 返回的包级工厂：每个错误码键一个构造函数，另有限定到该来源的 `is` 和 `find`。'
    ),
    scenarios: [
      t(
        'Declare all error codes of one package in one place and create errors by key.',
        '把一个包的所有错误码集中声明，再按键创建错误。'
      )
    ],
    example: identifyErrorExample,
    members: {
      source: {
        summary: t(
          'The `source` given to `define()`, shared by every error of the factory.',
          '传给 `define()` 的 `source`，该工厂创建的所有错误都使用它。'
        )
      },
      codes: {
        summary: t(
          'Frozen copy of the code table given to `define()`.',
          '传给 `define()` 的错误码表的冻结副本。'
        )
      },
      is: {
        summary: t(
          'Tells whether a value is an `IdentifyError` of this source, optionally of one code key.',
          '判断某个值是否为本来源的 `IdentifyError`，可选地限定到某个错误码键。'
        ),
        params: {
          value: t('Any caught value.', '任意捕获到的值。'),
          key: t(
            'Optional code key from the table, for example `notFound`.',
            '可选的错误码键，例如 `notFound`。'
          )
        },
        returns: t('`true` and a narrowed type when it matches.', '匹配时返回 `true` 并收窄类型。'),
        example: `if (OrderError.is(error, 'notFound')) showEmpty()`
      },
      find: {
        summary: t(
          'Finds the first chain link of this source (and code key, when given).',
          '在原因链中找到第一个属于本来源（指定时还要求错误码键一致）的环节。'
        ),
        params: {
          error: t('Any caught value.', '任意捕获到的值。'),
          key: t('Optional code key from the table.', '可选的错误码键。')
        },
        returns: t('The matching error, or `undefined`.', '匹配的错误，或 `undefined`。'),
        example: `const missing = OrderError.find(error, 'notFound')`
      }
    }
  },
  IIdentifyErrorCases: {
    summary: t(
      'Handler table of `IdentifyError.match()`, keyed by semantic code; the `_` key is the fallback for unmatched errors.',
      '`IdentifyError.match()` 的处理表，以语义错误码为键；`_` 键是未匹配时的后备处理。'
    ),
    members: {
      _: {
        summary: t(
          'Fallback handler called with the original value when no code matched; without it the original value is rethrown.',
          '没有错误码匹配时，以原始值调用的后备处理函数；不提供时原样重新抛出原始值。'
        )
      }
    }
  },
  ConfigOwner: {
    summary: t(
      'Owner of one immutable config snapshot, created by `new ConfigOwner()` or its `from*` statics; it is replaced, never mutated, on every write.',
      '持有一份不可变配置快照的对象，由 `new ConfigOwner()` 或 `from*` 静态方法创建；每次写入都会替换快照，而不是修改它。'
    ),
    scenarios: configOwnerScenarios,
    example: configOwnerExample,
    members: { ...configOwnerMembers, ...configOwnerStatics }
  },
  IConfigOwnerOptions: {
    summary: t(
      'Options of `new ConfigOwner()`: ownership profile and limits plus validator and listener-error reporting.',
      '`new ConfigOwner()` 的选项：所有权档位与上限，以及校验函数和监听器错误报告。'
    ),
    members: configOwnerOptionMembers
  },
  IConfigOwnerParseOptions: {
    summary: t(
      'Options of `ConfigOwner.from()`: owner options plus a `JSON.parse` reviver.',
      '`ConfigOwner.from()` 的选项：在实例选项之外增加 `JSON.parse` 的还原函数。'
    ),
    members: parseOptionMembers
  },
  IConfigOwnerAsyncOptions: {
    summary: t(
      'Options of `ConfigOwner.fromAsync()`: parse options plus cancellation and a deadline.',
      '`ConfigOwner.fromAsync()` 的选项：在解析选项之外增加取消信号和截止时间。'
    ),
    members: {
      ...parseOptionMembers,
      signal: cancelSignal(
        'Stops waiting for the source; the Promise rejects with `UtilsAbortError`, and a factory source receives the signal to cancel its request.',
        '停止等待来源；Promise 以 `UtilsAbortError` 拒绝，工厂形式的来源会收到该信号用来取消请求。'
      ),
      timeoutMs: {
        summary: t(
          'Deadline in milliseconds; when it passes the Promise rejects with `UtilsTimeoutError` (`DEADLINE_EXCEEDED`).',
          '截止时间（毫秒）；超过后 Promise 以 `UtilsTimeoutError`（`DEADLINE_EXCEEDED`）拒绝。'
        ),
        default: t('Not set: wait as long as the source takes.', '不设置：来源多久都等。')
      }
    }
  },
  IConfigOwnerEnvOptions: {
    summary: t(
      'Options of `ConfigOwner.fromEnv()`: owner options plus how flat variable names map to nested paths.',
      '`ConfigOwner.fromEnv()` 的选项：在实例选项之外增加扁平变量名如何映射为嵌套路径。'
    ),
    members: {
      ...configOwnerOptionMembers,
      prefix: {
        summary: t(
          'Only names starting with this prefix are read; the prefix is removed.',
          '只读取以此前缀开头的变量名，并去掉前缀。'
        ),
        default: t('Empty: every variable is read.', '空字符串：读取所有变量。')
      },
      separator: {
        summary: t(
          'Nesting separator inside a name (`APP__DB__PORT` becomes `db.port` with prefix `APP__`).',
          '变量名中的层级分隔符（前缀为 `APP__` 时，`APP__DB__PORT` 变成 `db.port`）。'
        ),
        default: t('`__`', '`__`：两个下划线。')
      },
      key: {
        summary: t(
          'Maps each name segment, for example to lower case.',
          '转换每一段名称，例如转成小写。'
        ),
        default: t('Identity: segments keep their case.', '原样保留：各段大小写不变。')
      },
      coerce: {
        summary: t(
          'Converts each raw string value, receiving the value and its path, for example to numbers or booleans.',
          '转换每个原始字符串值，接收值和它的路径，例如转成数字或布尔值。'
        ),
        default: t('Identity: values stay strings.', '原样保留：值仍是字符串。')
      }
    }
  },
  IConfigAsyncSource: alias(
    'Source accepted by `ConfigOwner.fromAsync()`: a value, a Promise, or a factory `({ signal }) => value | Promise`; strings are parsed as JSON.',
    '`ConfigOwner.fromAsync()` 接受的来源：一个值、一个 Promise，或工厂函数 `({ signal }) => value | Promise`；字符串按 JSON 解析。'
  ),
  IConfigDiffEntry: {
    summary: t(
      'One difference reported by `ConfigOwner.diff()`.',
      '`ConfigOwner.diff()` 报告的一处差异，包含路径和差异类型。'
    ),
    members: {
      path: {
        summary: t('Frozen segment list of the differing path.', '有差异路径的冻结段列表。')
      },
      kind: {
        summary: t(
          'How the path differs between the two sides.',
          '该路径在两边是如何不同的：新增、删除或修改。'
        ),
        values: {
          added: t('Present only in the other source.', '只存在于另一个来源中。'),
          removed: t('Present only in this snapshot.', '只存在于本快照中。'),
          changed: t('Present in both with a different value.', '两边都有，但值不同。')
        }
      }
    }
  },
  IConfigOwnerPath: alias(
    'Path accepted by `ConfigOwner` reads and writes: a typed dot/bracket string or a segment list.',
    '`ConfigOwner` 读写接受的路径：带类型的点号/方括号字符串，或段列表。'
  ),
  IConfigOwnerPathValue: alias(
    'Value type at a typed path; `unknown` for segment lists whose type cannot be inferred.',
    '带类型路径上的值类型；无法推导类型的段列表为 `unknown`。'
  ),
  IConfigOwnerWriteValue: alias(
    'Accepted replacement type at a typed path, with literal leaves widened.',
    '带类型路径上可接受的替换值类型，字面量会放宽。'
  ),
  IConfigSource: {
    summary: t(
      'Source accepted by `combine()`, `merge()` and `diff()`: another `ConfigOwner` of any shape or a plain record.',
      '`combine()`、`merge()` 和 `diff()` 接受的来源：任意结构的 `ConfigOwner` 或普通记录。'
    ),
    members: { ...configOwnerMembers, ...configOwnerStatics }
  },
  IConfigValidator: alias(
    'Validator `(view) => boolean | void` of `IConfigOwnerOptions.validate`; throwing or returning `false` rejects the candidate snapshot.',
    '`IConfigOwnerOptions.validate` 的校验函数 `(view) => boolean | void`；抛错或返回 `false` 会拒绝候选快照。'
  ),
  IConfigView: alias(
    'Deep readonly view type returned by `view()`, `get()` and watch listeners; functions, dates and regular expressions keep their own type.',
    '`view()`、`get()` 和监听器得到的深只读视图类型；函数、日期和正则表达式保持原类型。'
  ),
  IMergedConfig: alias(
    'Merged value type of several sources, used to retype `combine()` and `merge()` results.',
    '多个来源合并后的值类型，用来更新 `combine()` 与 `merge()` 结果的类型。'
  ),
  IAsyncTaskOptions: {
    summary: t(
      'Options of `asyncTask()`; a bare number argument is shorthand for `{ delay }`.',
      '`asyncTask()` 的选项；直接传数字等同于 `{ delay }`。'
    ),
    members: asyncTaskOptionMembers
  },
  IAsyncTaskContext: alias(
    'Context passed to the `asyncTask()` callback: `strategy` is the concrete strategy that ran; `animationFrame` adds `frameTime`, `idleCallback` adds `didTimeout` and `timeRemaining()`.',
    '传给 `asyncTask()` 回调的上下文：`strategy` 是实际使用的策略；`animationFrame` 额外提供 `frameTime`，`idleCallback` 额外提供 `didTimeout` 与 `timeRemaining()`。'
  ),
  IConcreteAsyncTaskStrategy: alias(
    'Every `AsyncTaskStrategy` key except `auto`: the strategy actually used.',
    '除 `auto` 以外的全部 `AsyncTaskStrategy` 键，即实际使用的策略。'
  ),
  ITimeSliceOptions: {
    summary: t(
      'Options shared by `timeSlice()`, `timeSliceMap()` and `timeSliceReduce()`.',
      '`timeSlice()`、`timeSliceMap()` 和 `timeSliceReduce()` 共用的选项，控制时间片预算、让出方式和进度回调。'
    ),
    members: timeSliceOptionMembers
  },
  ITimeSliceReport: {
    summary: t(
      'Progress of one time-sliced run.',
      '一次时间片处理的进度，交给 `onProgress` 并作为最终结果返回。'
    ),
    scenarios: [
      t(
        'Drive a progress bar while a large import runs in time slices.',
        '大批量导入按时间片运行时，用它驱动进度条。'
      )
    ],
    example: `await timeSlice(rows, importRow, { onProgress: ({ processed }) => bar.set(processed / rows.length) })`,
    members: {
      processed: {
        summary: t('Number of items handled so far.', '到目前为止已经处理完成的数据项数量。')
      },
      slices: { summary: t('Slices started so far, at least 1.', '已开始的时间片数，至少为 1。') },
      elapsedMs: {
        summary: t(
          'Monotonic milliseconds since the run started.',
          '从开始处理到现在经过的毫秒数（单调时钟）。'
        )
      }
    }
  },
  IControlledFunction: {
    summary: t(
      'Function returned by `debounce()` and `throttle()`: calling it schedules the wrapped function; the extra methods control the pending invocation.',
      '`debounce()` 和 `throttle()` 返回的函数：调用它会安排被包装函数的执行，附加的方法用来控制待执行的调用。'
    ),
    scenarios: [
      t(
        'Save the pending draft right away when the page closes with `flush()`.',
        '页面关闭时用 `flush()` 立即保存还在等待的草稿。'
      )
    ],
    example: `const save = debounce(persist, 500)
save(draft)
window.addEventListener('pagehide', () => save.flush())`,
    members: controlledMembers
  },
  IDebounceOptions: {
    summary: t(
      'Options of `debounce()`: edges, maximum wait, cancellation and timer source.',
      '`debounce()` 的选项，控制何时执行以及如何取消。'
    ),
    members: debounceOptionMembers
  },
  IThrottleOptions: {
    summary: t(
      'Options of `throttle()`: edges, cancellation and timer source.',
      '`throttle()` 的选项，控制窗口两端是否执行以及如何取消。'
    ),
    members: throttleOptionMembers
  },
  ICoalescedFunction: {
    summary: t(
      'Function returned by `coalesce()`: each call queues its arguments for the next delivery.',
      '`coalesce()` 返回的函数：每次调用把参数排进下一次交付。'
    ),
    scenarios: [
      t(
        'Send every analytics event of one tick in a single request.',
        '把同一轮里的所有统计事件放进一次请求发送。'
      )
    ],
    example: `const track = coalesce((calls: [string][]) => send(calls))
track('open')
track.flush()`,
    members: {
      flush: {
        summary: t('Delivers the queued calls now.', '立即交付已排队的调用。'),
        returns: t('Nothing; the queue is empty afterwards.', '无返回值；之后队列为空。'),
        example: `track.flush()`
      },
      cancel: {
        summary: t(
          'Drops the queued calls without delivering them.',
          '丢弃已排队的调用，不再交付给函数。'
        ),
        returns: t(
          'Nothing; no delivery happens until the next call.',
          '无返回值；在下一次调用前不会交付。'
        ),
        example: `track.cancel()`
      },
      size: {
        summary: t(
          'Number of calls queued for the next delivery.',
          '等待下一次交付的已排队调用数量。'
        )
      }
    }
  },
  IRepeatOptions: {
    summary: t(
      'Options of `repeat()`: first run, iteration limit, error policy and cancellation.',
      '`repeat()` 的选项，控制首轮、次数、错误策略和取消。'
    ),
    members: repeatOptionMembers
  },
  IRepeatContext: {
    summary: t('Context of one `repeat()` iteration.', '`repeat()` 每一轮执行时收到的上下文对象。'),
    members: {
      iteration: {
        summary: t('Zero-based iteration number.', '本轮的轮次编号，从 0 开始依次递增。')
      },
      signal: {
        summary: t(
          'Aborted when the loop stops; pass it to `fetch` so an in-flight request stops too.',
          '循环停止时中止；把它传给 `fetch`，进行中的请求也会一起停止。'
        )
      }
    }
  },
  IRepeatHandle: {
    summary: t('Handle of a running `repeat()` loop.', '正在运行的 `repeat()` 循环的句柄。'),
    scenarios: [
      t(
        'Stop polling when the page closes and wait for the loop to settle.',
        '页面关闭时停止轮询，并等待循环结束。'
      )
    ],
    example: `const poll = repeat(refresh, 30_000)
poll.stop()
await poll.done`,
    members: {
      stop: {
        summary: t(
          'Stops the loop; a running iteration finishes but no new one starts. Calling it again does nothing.',
          '停止循环；正在执行的一轮会跑完，但不再开始新的一轮。重复调用不做任何事。'
        ),
        returns: t('Nothing; `done` resolves.', '无返回值；`done` 随之完成。'),
        example: `poll.stop()`
      },
      done: {
        summary: t(
          'Resolves when the loop stops normally; rejects with the failing error under `onError: "stop"`.',
          '循环正常停止时完成；`onError: "stop"` 下以失败的原始错误拒绝。'
        )
      },
      running: {
        summary: t('Whether the loop is still running.', '循环是否仍在运行；停止后变为 `false`。')
      },
      '[Symbol.dispose]': {
        summary: t(
          'Same as `stop()`, so a `using` declaration stops the loop.',
          '与 `stop()` 相同，使 `using` 声明能自动停止循环。'
        ),
        returns: t('Nothing; the loop stops.', '无返回值；循环停止。'),
        example: `using poll = repeat(refresh, 1000)`
      }
    }
  }
}

/** Enum-like constants added by the facades. */
export const utilsFacadeEnums: Readonly<Record<string, IEnumDoc>> = {
  AsyncTaskStrategy: {
    summary: t(
      'Queues `asyncTask()`, `yieldToHost()`, `timeSlice()` and `coalesce()` can schedule on.',
      '`asyncTask()`、`yieldToHost()`、`timeSlice()` 和 `coalesce()` 可以安排任务的全部宿主队列，按需要的执行时机选择。'
    ),
    values: {
      promise: t(
        'Available in every host, `Promise.resolve().then()` queues a promise microtask after the current code and before timers or I/O.',
        '所有宿主都支持 `Promise.resolve().then()`，它把任务放入 Promise 微任务队列，在当前代码之后、定时器和 I/O 之前执行。'
      ),
      microtask: t(
        '`queueMicrotask()`: the same microtask queue without allocating a Promise.',
        '`queueMicrotask()`：同一个微任务队列，但不创建 Promise。'
      ),
      nextTick: t(
        'In Node and Bun, `process.nextTick()` uses Node’s tick queue, which drains before promise microtasks when scheduled from a macrotask.',
        '在 Node 和 Bun 中，`process.nextTick()` 把任务放入 Node 的 tick 队列；在宏任务中调度时，该队列先于 Promise 微任务执行。'
      ),
      timeout: t(
        'Supported in every host, `setTimeout()` queues a timer macrotask with native delay; browsers clamp nested timers to 4 ms.',
        '所有宿主都可用 `setTimeout()` 安排带原生延迟的定时器宏任务；浏览器中的嵌套定时器至少延迟 4 毫秒。'
      ),
      immediate: t(
        'Node and Bun provide `setImmediate()` for work in Node’s check phase, right after I/O polling.',
        'Node 和 Bun 的 `setImmediate()` 把任务安排在 Node 的 check 阶段，紧跟 I/O 轮询执行。'
      ),
      messageChannel: t(
        '`MessageChannel`: a macrotask without the nested-timer clamp, the usual fast way to yield. Browsers, workers, Node, Deno and Bun.',
        '`MessageChannel`：没有嵌套定时器钳制的宏任务，是常用的快速让出方式。浏览器、工作线程、Node、Deno 和 Bun 都可用。'
      ),
      animationFrame: t(
        '`requestAnimationFrame()`: right before the next paint, with the frame time; paused in hidden tabs. Browser windows only.',
        '`requestAnimationFrame()`：在下一次绘制之前执行并提供帧时间；后台标签页中会暂停。仅浏览器窗口可用。'
      ),
      idleCallback: t(
        '`requestIdleCallback()`: in an idle period, with `timeRemaining()`; `idleTimeout` forces a run. Chromium, Firefox and Safari 18+.',
        '`requestIdleCallback()`：在空闲期执行并提供 `timeRemaining()`；`idleTimeout` 可强制执行。Chromium、Firefox 和 Safari 18 及以上可用。'
      ),
      postTaskUserBlocking: t(
        'Chromium and Firefox support `scheduler.postTask()` with `user-blocking` priority and native delay for work that blocks user input.',
        '在 Chromium 和 Firefox 中，可用 `scheduler.postTask()` 的 `user-blocking` 优先级安排会阻塞用户输入的工作，并设置原生延迟。'
      ),
      postTaskUserVisible: t(
        'Chromium and Firefox support `scheduler.postTask()` with `user-visible` priority and native delay for work whose result the user sees soon.',
        '在 Chromium 和 Firefox 中，可用 `scheduler.postTask()` 的 `user-visible` 优先级安排用户很快会看到结果的工作，并设置原生延迟。'
      ),
      postTaskBackground: t(
        'Chromium and Firefox support `scheduler.postTask()` with `background` priority and native delay for logging, prefetching and other deferrable work.',
        '在 Chromium 和 Firefox 中，可用 `scheduler.postTask()` 的 `background` 优先级安排日志、预取等可推迟的工作，并设置原生延迟。'
      ),
      schedulerYield: t(
        'In Chromium and Firefox, `scheduler.yield()` yields and resumes ahead of other tasks of the same priority, making it the recommended way to split long tasks.',
        '在 Chromium 和 Firefox 中，`scheduler.yield()` 让出后优先于同优先级的其他任务恢复，是拆分长任务的推荐方式。'
      ),
      auto: t(
        'Available in every host, `auto` selects the first supported strategy in this order: `schedulerYield`, `postTaskUserVisible`, `messageChannel`, `immediate`, `timeout`.',
        '`auto` 在所有宿主都可用，依次选用第一个可用的 `schedulerYield`、`postTaskUserVisible`、`messageChannel`、`immediate`、`timeout`。'
      )
    }
  }
}
