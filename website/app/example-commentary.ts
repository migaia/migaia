import type { ILocale } from './content.js'

type ICommentedExample = {
  readonly code: string
  readonly notes: readonly string[]
}

export type IExampleCommentaryContext = {
  /** Public API whose maintained guide owns this example. */
  readonly apiName: string
  /** Distinguishes executable walkthroughs from compile-time declaration guidance. */
  readonly kind?: 'example' | 'signature'
  /** Public parameter names displayed beside a signature. */
  readonly parameterNames?: readonly string[]
  /** Concrete behavior promised by the maintained guide. */
  readonly purpose: string
  /** Representative production situation for this exact API. */
  readonly scenario?: string
}

/** Adds only capability-specific comments without changing executable statements. */
export function commentExample(
  code: string,
  language: string,
  locale: ILocale,
  context?: IExampleCommentaryContext
): ICommentedExample {
  /** Normalized language decides which comment syntax remains valid when copied. */
  const normalizedLanguage = language.toLowerCase()
  /** Only languages with line comments can safely receive inline annotations. */
  const commentPrefix = ['bash', 'sh', 'shell'].includes(normalizedLanguage) ? '#' : '//'
  if (
    !['bash', 'sh', 'shell', 'ts', 'tsx', 'typescript', 'js', 'jsx', 'javascript'].includes(
      normalizedLanguage
    )
  )
    return { code, notes: [] }

  /** Blank lines define the author-maintained logical stages of an example. */
  const segments = code.trim().split(/\n\s*\n/)
  /** Generated explanations are reused below the code as a compact walkthrough. */
  const notes: string[] = []
  /** A maintained API guide may contribute one precise fallback when no handwritten rule matches. */
  let usedContext = false
  /** Only stages with concrete capability semantics receive an explanation. */
  const commentedSegments = segments.map((segment) => {
    /** The stage explanation is derived from the first meaningful operation in the segment. */
    const note =
      describeSegment(segment, locale) ??
      describeCapabilityHostStage(segment, locale) ??
      (!usedContext && context && !isImportOnly(segment)
        ? describeMaintainedApiExample(code, segment, context, locale)
        : undefined)
    if (!note) return segment
    if (context && !usedContext) usedContext = true
    notes.push(note)
    return `${commentPrefix} ${note}\n${segment}`
  })
  return { code: commentedSegments.join('\n\n'), notes }
}

/** Keeps import declarations copyable without pretending they explain runtime behavior. */
function isImportOnly(segment: string): boolean {
  return segment
    .split('\n')
    .filter((line) => line.trim().length > 0 && !/^\s*(?:\/\/|#)/.test(line))
    .every((line) => /^\s*import\b/.test(line))
}

/** Explains each distinct lifecycle stage in the Capability Host maintained example. */
function describeCapabilityHostStage(segment: string, locale: ILocale): string | undefined {
  if (/\bconst\s+host\s*=\s*createCapabilityHost\s*\(/.test(segment))
    return locale === 'zh'
      ? 'host 隔离 tenantId 对应的能力状态；flags.persistence 只允许这一项能力启用，onError 把激活与释放失败交给应用诊断系统。修改传入的 flags 对象不会改变已经创建的 Host。'
      : 'host isolates capability state for this tenantId. flags.persistence admits only that capability, while onError forwards activation and release failures to application diagnostics. Mutating the input flags later does not change the created Host.'
  if (/\bhost\.register\s*\(/.test(segment))
    return locale === 'zh'
      ? "这里仅登记 persistence 的启动方法，并不会立即下载或打开存储；enable('persistence') 真正执行时才动态导入实现，并用当前 Host 的 tenantId 创建 handle。"
      : "This only registers how persistence starts; it neither downloads nor opens storage yet. The implementation is dynamically imported and receives this Host's tenantId only when enable('persistence') runs."
  if (/\bhost\.enable\s*\(/.test(segment) && /\bhost\.dispose\s*\(/.test(segment))
    return locale === 'zh'
      ? "enable('persistence') 返回结构化状态；只有 enabled 才能从 handle('persistence') 取得已激活对象并调用 sync()。finally 中 dispose() 会作废在途激活并释放已经打开或迟到返回的 handle。"
      : "enable('persistence') returns a structured status. Only enabled permits handle('persistence') to expose the activated object for sync(). The finally block invalidates in-flight activation and releases both current and late handles."
  return undefined
}

/** Builds one API-specific explanation from maintained prose and identifiers visible in the code. */
function describeMaintainedApiExample(
  fullCode: string,
  segment: string,
  context: IExampleCommentaryContext,
  locale: ILocale
): string {
  if (context.kind === 'signature') return describeApiSignature(fullCode, context, locale)
  /** Assignment name tells the reader which value carries this API's result. */
  const resultName = segment.match(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/)?.[1]
  /** Later method names show how the returned owner is consumed or released. */
  const methods = resultName
    ? [...fullCode.matchAll(new RegExp(`\\b${resultName}\\.([A-Za-z_$][\\w$]*)\\s*\\(`, 'g'))]
        .map((match) => match[1])
        .filter((method, index, values) => values.indexOf(method) === index)
    : []
  const resultUse = resultName
    ? locale === 'zh'
      ? `${resultName} 保存 ${context.apiName}() 返回的本次实例${methods.length > 0 ? `，后续通过 ${methods.map((method) => `${method}()`).join('、')} 消费或结束它` : ''}。`
      : `${resultName} holds this ${context.apiName}() result${methods.length > 0 ? `; later ${methods.map((method) => `${method}()`).join(', ')} calls consume or close it` : ''}.`
    : locale === 'zh'
      ? `这里直接执行 ${context.apiName}()，没有创建可供后续复用的实例。`
      : `This invokes ${context.apiName}() directly without creating a reusable instance.`
  if (locale === 'zh')
    return `${resultUse}${context.purpose}${context.scenario ? ` 本例对应的生产场景是：${context.scenario}` : ''}`
  return `${resultUse}${context.purpose}${context.scenario ? ` The production situation shown here is: ${context.scenario}` : ''}`
}

/** Explains how callers should read a declaration or overload set without narrating syntax. */
function describeApiSignature(
  code: string,
  context: IExampleCommentaryContext,
  locale: ILocale
): string {
  /** Repeated declarations of the same callable form its public overload set. */
  const overloadCount = [
    ...code.matchAll(new RegExp(`\\b(?:function|constructor)\\s+${context.apiName}\\b`, 'g'))
  ].length
  /** Only names backed by the extracted public contract are mentioned to readers. */
  const inputs =
    context.parameterNames
      ?.filter((name) => name.trim().length > 0)
      .filter((name, index, names) => names.indexOf(name) === index) ?? []
  const inputText = inputs.length > 0 ? inputs.map((name) => `\`${name}\``).join('、') : undefined
  if (locale === 'zh') {
    if (overloadCount > 1)
      return `${context.apiName} 共有 ${overloadCount} 个公开重载；它们是同一函数针对不同参数组合的类型分支。TypeScript 会根据调用时传入的${inputText ?? '参数'}选择匹配分支，并推导泛型与返回类型；调用方不需要手动选择某一行。`
    return `这是 ${context.apiName} 的编译期契约，不是另一种调用写法。${inputText ? `调用方通过 ${inputText} 传入数据；` : ''}可选标记、泛型约束与返回类型共同限定哪些调用能够通过类型检查。`
  }
  if (overloadCount > 1)
    return `${context.apiName} exposes ${overloadCount} overloads: type branches of the same function for different argument combinations. TypeScript selects a branch from the supplied ${inputs.join(', ') || 'arguments'} and infers its generics and return type; callers do not select a declaration manually.`
  return `This is the compile-time contract for ${context.apiName}, not another invocation form. ${inputs.length > 0 ? `${inputs.join(', ')} are its public inputs; ` : ''}optional markers, generic constraints, and the return type determine which calls type-check.`
}

/** Describes why a logical code segment exists rather than merely repeating its syntax. */
function describeSegment(segment: string, locale: ILocale): string | undefined {
  /** Comment-only file labels do not determine the behavior of the following statements. */
  const executable = segment
    .split('\n')
    .filter((line) => !/^\s*(?:\/\/|#)/.test(line))
    .join('\n')
  if (/\bidentitySnapshot\s*\(/.test(executable))
    return locale === 'zh'
      ? '这里刻意选择零拷贝策略：返回值与输入是同一对象，之后从任一引用修改，另一方都会看到。它只适合可信进程内、明确接受共享所有权的策略槽；单独包一层调用没有收益，跨边界数据也不应使用。'
      : 'This deliberately selects a zero-copy policy: the result and input are the same object, so mutations through either reference remain visible to the other. Use it only in a trusted in-process policy slot that explicitly accepts shared ownership; a standalone wrapper adds no value and must not be used across boundaries.'
  if (/\bownConfig\s*\(/.test(executable))
    return locale === 'zh'
      ? 'ownConfig() 在接收外部配置的边界验证并复制整张对象图，随后用内部 WeakMap 登记 profile 与 limits。调用方之后修改原对象不会影响已接纳配置；这份所有权登记还允许 readonlyConfig() 安全公开只读视图，并允许 patchConfig()、combineConfig() 继续派生受管理配置。'
      : 'ownConfig() validates and copies the complete graph at an external configuration boundary, then records its profile and limits in an internal WeakMap. Later caller mutations cannot change the admitted configuration, and the ownership record lets readonlyConfig() expose a guarded view while patchConfig() and combineConfig() derive managed successors.'
  if (/\breadonlyConfig\s*\(/.test(executable))
    return locale === 'zh'
      ? 'readonlyConfig() 返回一个只能读取、不能修改的对象。它没有复制第二份配置：读取仍来自原配置；任何层级的赋值、删除或 Map、Set、Date 修改都会报 CONFIG_READONLY。需要改配置时调用 patchConfig() 生成下一份。'
      : 'readonlyConfig() returns an object that can be read but not modified. It does not copy the configuration again: reads still come from the owned config, while assignments, deletions, and nested Map, Set, or Date mutations fail with CONFIG_READONLY. Use patchConfig() to produce the next configuration.'
  if (/(?:^|[^\w$.])set\s*\([^\n]+(?:\n|$)/m.test(executable))
    return locale === 'zh'
      ? 'set() 每次发生实际更新都会返回新根对象，原对象不变；只浅拷贝写入路径上的节点，其他分支继续共享引用。这里的 immutable 指更新方式，不表示整棵树深拷贝或返回值已冻结；新旧值相同时会直接复用原对象。'
      : 'Whenever a value actually changes, set() returns a new root without mutating the input. It shallow-copies only nodes on the written path and shares untouched branches. Immutable describes the update operation, not a deep clone or frozen result; an unchanged value reuses the original root.'
  if (/\bsystemScheduler\.now\s*\(/.test(executable))
    return locale === 'zh'
      ? '这里得到的数值与 Date.now() 相同；通过 IUtilsScheduler 读取，是为了让 now() 与 schedule() 能在测试中一起替换为虚拟时钟。普通业务只读真实时间可直接用 Date.now()，可注入的调度逻辑应使用 scheduler.now()。'
      : 'This returns the same value as Date.now(); reading through IUtilsScheduler lets tests replace now() and schedule() together with a virtual clock. Use Date.now() for ordinary wall-clock reads and scheduler.now() inside injectable scheduling logic.'
  if (/\bcreateAbortTimeoutSignal\s*\(/.test(executable)) {
    /** Assigned handle name makes the generated explanation traceable to this exact example. */
    const handle = executable.match(
      /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*createAbortTimeoutSignal/
    )?.[1]
    /** Literal deadline is quoted only when the example exposes one. */
    const timeoutMs = executable.match(/\btimeoutMs\s*:\s*([\d_]+)/)?.[1]
    const handleName = handle ?? '返回对象'
    const deadline = timeoutMs ? `${timeoutMs.replaceAll('_', '')} ms` : '配置的截止时间'
    return locale === 'zh'
      ? `${handleName}.signal 同时代表外部取消与 ${deadline} 截止时间；把它传给 request() 后，任一条件触发都会通知这次请求停止。${handleName}.dispose() 只清除该合并信号安装的监听器和计时器，不会替 request() 取消其他工作，所以应在这次请求结束后调用。`
      : `${handleName}.signal combines external cancellation with the ${deadline} deadline. Passing it to request() lets either condition stop this request. ${handleName}.dispose() removes only the listeners and timer installed for this combined signal; it does not cancel unrelated work owned by request(), so call it after this request settles.`
  }
  if (
    /\bcreateCapabilityGraph\s*\(/.test(executable) &&
    /\bgraph\.register\s*\(/.test(executable) &&
    /\bgraph\.ready\s*\(/.test(executable) &&
    /\bgraph\.get\s*\(/.test(executable) &&
    /\bgraph\.dispose\s*\(/.test(executable)
  )
    return locale === 'zh'
      ? '先登记谁提供能力、谁依赖它；ready() 会按依赖顺序启动，get() 读取已就绪的能力，dispose() 最后按相反顺序释放资源。'
      : 'Register providers and their consumers first; ready() starts them in dependency order, get() reads a ready capability, and dispose() releases resources in reverse order.'
  if (
    /\bcreateCapabilityHost\s*\(/.test(executable) &&
    /\bhost\.register\s*\(/.test(executable) &&
    /\bhost\.enable\s*\(/.test(executable) &&
    /\bhost\.(?:disable|dispose)\s*\(/.test(executable)
  )
    return locale === 'zh'
      ? '把功能登记到 Capability Host 后再启用；enable() 成功会得到可用句柄，disable() 或 dispose() 会关闭功能并释放它占用的资源。'
      : 'Register the feature with the Capability Host before enabling it; enable() returns a usable handle, while disable() or dispose() shuts it down and releases its resources.'
  if (/\btransaction\s*\(/.test(executable))
    return locale === 'zh'
      ? '回调里的读取和写入属于同一次事务：全部成功才提交；发生冲突时整段作废，必须重新读取最新值后重跑整个事务。'
      : 'The reads and writes in the callback belong to one transaction: they commit together, and a conflict invalidates the whole attempt so it must reread and retry.'
  if (
    /\bliveQuery\s*\(/.test(executable) &&
    /\bquery\.ready\b/.test(executable) &&
    /\bquery\.dispose\b/.test(executable)
  )
    return locale === 'zh'
      ? '这个查询会先读取一次结果；匹配的数据发生变化时自动重跑。ready 等首次结果，refresh 手动刷新，dispose 停止监听。'
      : 'This query reads once, then reruns when matching data changes. ready waits for the first result, refresh reruns manually, and dispose stops listening.'
  if (
    /\b(?:createManualScheduler|cookiesHost|indexedDbHost|localStorageHost|localStorage|memoryStorageHost|sessionStorageHost)\s*\(/.test(
      executable
    )
  )
    return describeConstruction(executable, locale)
  return undefined
}

/** Provides concrete construction guidance for common host and storage boundaries. */
function describeConstruction(executable: string, locale: ILocale): string | undefined {
  if (/\bcreateManualScheduler\s*\(/.test(executable))
    return locale === 'zh'
      ? '这是本仓测试与适配器验证专用的确定性时钟，不适合外部业务代码。外部项目应优先使用测试框架的 fake timers，生产代码使用默认的 systemScheduler。'
      : 'This deterministic clock exists for this repository’s tests and adapter verification, not external application code. External projects should prefer their test framework’s fake timers and use systemScheduler in production.'
  if (/\blocalStorage\s*\(/.test(executable))
    return describeLocalStorageConstruction(executable, locale)
  return undefined
}

/** Explains the concrete namespace and owner visible in a storage-host example. */
function describeLocalStorageConstruction(executable: string, locale: ILocale): string | undefined {
  /** Variable name identifies which object owns the generated backend resources. */
  const owner =
    executable.match(
      /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:localStorageHost|sessionStorageHost|cookiesHost|memoryStorageHost|indexedDbHost|localStorage)\(/
    )?.[1] ??
    executable.match(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*createStorageHost\(/)?.[1]
  /** Namespace literal identifies the exact key partition used by the example. */
  const namespace = executable.match(/\bnamespace\s*:\s*['"]([^'"]+)['"]/)?.[1]
  if (!owner || !namespace) return undefined
  return locale === 'zh'
    ? `${owner} 只读写 namespace 为 ${namespace} 的键空间，因此其他功能使用同名 key 也不会冲突。后续 get()、set() 与 sync 操作都复用这份隔离；${owner}.dispose() 只释放该实例的监听和连接，不会删除已经持久化的数据。`
    : `${owner} reads and writes only the ${namespace} namespace, so another feature can reuse the same key without collision. Later get(), set(), and sync operations keep this partition; ${owner}.dispose() releases this instance's listeners and connections without deleting persisted data.`
}
