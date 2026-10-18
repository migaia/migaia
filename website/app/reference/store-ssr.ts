/**
 * SSR reference checked against current source, README and USEGUIDE (2026-10-18). Async APIs reject
 * rather than synchronously throw. Resource dehydration decides inclusion, and timeout classifies
 * each pending Promise by its own settlement. Trusted state retains live references. Document
 * readers require an injected host. Resource snapshots use the canonical version-2 relative ages.
 */
import type { ILibraryReference, IMemberDoc, IText } from './contract.js'
import { reactiveReference } from './reactive.js'

/** Localized contract prose. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Request construction, real Store Light registration, snapshot and cleanup. */
const scopeExample = `import { createSSRRequestScope, serializeSSRState, deserializeSSRState } from '@migaia/store-ssr'
import { createStore } from '@migaia/store-light'

const scope = createSSRRequestScope()
try {
  const app = createStore({ count: 1 }, { runtime: scope.runtime })
  scope.register('app', app)
  const text = serializeSSRState(scope.dehydrate())
  scope.hydrate(deserializeSSRState(text))
  console.log(app.count)
} finally {
  await scope.disposeAsync()
}`
/** Resources and stores must use exactly the request Runtime. */
const resourceExample = `import { createSSRRequestScope } from '@migaia/store-ssr'
import { Resource } from '@migaia/resource'

const scope = createSSRRequestScope()
const profile = new Resource(async () => ({ name: 'Ada' }), scope.runtime)
scope.registerResource('profile', profile)
try {
  console.log(await scope.awaitResources({ timeoutMs: 3000 }))
  console.log(await scope.dehydrateAsync({
    timeoutMs: 3000,
    onResourceError: ({ key, error }) => console.error(key, error)
  }))
} finally {
  await scope.disposeAsync()
}`
/** Basic JSON embedding uses a host supplied by the caller. */
const jsonExample = `import { assertSSRState, createSSRStateScript, readSSRStateFromDocument } from '@migaia/store-ssr'
const state = { version: 1 as const, stores: { app: { count: 1 } } }
assertSSRState(state)
const html = createSSRStateScript(state)
const host = {
  getElementById: (id: string) => id === '__STORE_STATE__'
    ? { textContent: JSON.stringify(state), getAttribute: (_name: string) => null }
    : null
}
console.log(html, readSSRStateFromDocument(undefined, host))`
/** Registry construction uses the canonical serialize plugin API. */
const codecExample = `import { createSerializeRegistry } from '@migaia/serialize'
import { jsonPlugin } from '@migaia/serialize/plugins'
import { createSSRStateScriptWith, readSSRStateFromDocumentWith } from '@migaia/store-ssr'
const codecs = createSerializeRegistry([jsonPlugin()])
try {
  const state = { version: 1 as const, stores: { app: { text: '<hello>' } } }
  const html = await createSSRStateScriptWith(state, { codecs })
  const host = {
    getElementById: (_id: string) => ({
      textContent: JSON.stringify(state),
      getAttribute: (name: string) => name === 'data-codec' ? 'json' : 'text'
    })
  }
  console.log(html, await readSSRStateFromDocumentWith({ codecs, document: host }))
} finally {
  await codecs.dispose()
}`
/** No await or mutation may separate trusted production and serialization. */
const trustedExample = `import { createSSRRequestScope, serializeTrustedSSRState } from '@migaia/store-ssr'
import { createStore } from '@migaia/store-light'
const scope = createSSRRequestScope()
scope.register('fixture', createStore({ title: 'Fixed' }, { runtime: scope.runtime }))
const text = serializeTrustedSSRState(scope.dehydrateTrusted())
console.log(text)
await scope.disposeAsync()`
/** Stable keys select separate store/resource namespaces. */
const key = t(
  'Caller-stable nonempty string other than `__proto__`; store and resource keys use separate namespaces.',
  '调用者选定的非空稳定字符串，不能是 `__proto__`，状态容器与资源使用独立键空间。'
)
/** One wall-clock budget covers all waterfall rounds. */
const timeout: IMemberDoc = {
  summary: t(
    'Total milliseconds, finite from 0 through 2147483647. Zero waits only for already-settled Promise reactions, never for in-flight work. Invalid input returns a rejected Promise with RangeError INVALID_OPTION. At the deadline only unsettled resources receive RESOURCE_TIMEOUT; fulfilled work is omitted and rejected work keeps its original reason. Resources are not cancelled.',
    '所有轮次的总毫秒预算，须为零至 `2147483647` 的有限数；零只排空已结算承诺的反应，不等待在途工作。无效值返回以范围错误及 `INVALID_OPTION` 拒绝的承诺；截止时仅未结算资源记录 `RESOURCE_TIMEOUT`，已兑现项跳过，已拒绝项保留原始原因，不取消资源。'
  ),
  default: t(
    'Omitted: no deadline; waits until convergence or scope disposal.',
    '默认省略，无截止期限，等待收敛或作用域销毁。'
  )
}
/** Forward the canonical Runtime option contract rather than redefining it. */
const runtimeMembers: Readonly<Record<string, IMemberDoc>> = {
  runtime: {
    summary: t(
      'Existing IRuntime from @migaia/reactive createRuntime, mutually exclusive with runtimeOptions. The scope claims its own instance, not exclusive ownership of that Runtime. Applications provide a distinct Runtime and scope per request when isolation is required.',
      '由响应包创建的已有运行时，与运行时构造选项互斥；作用域仅登记自身实例的归属，不独占运行时，需要请求隔离时由应用为每请求装配独立运行时及作用域。'
    ),
    default: t('Creates an isolated Runtime.', '默认新建隔离运行时。')
  },
  runtimeOptions: {
    summary: t(
      'IRuntimeOptions forwarded to reactive createRuntime when runtime is absent; callback, adapter and scheduler contracts remain defined by reactive.',
      '未提供已有运行时时透传给响应包工厂的构造选项，回调、适配器及调度契约仍由响应包定义。'
    ),
    default: t(
      'Reactive defaults: microtask flushing, default host adapter and 100 maxFlushPasses.',
      '默认使用响应包微任务冲刷、默认宿主适配器及每轮一百次执行上限。'
    )
  },
  ...Object.fromEntries(
    Object.entries(reactiveReference.types!.IRuntimeOptions.members!).map(([name, doc]) => [
      `runtimeOptions.${name}`,
      doc
    ])
  )
}
/** Wire envelope fields accepted by both serializers and hydration. */
const stateMembers: Readonly<Record<string, IMemberDoc>> = {
  version: {
    summary: t(
      'Literal 1, the only accepted SSR envelope version.',
      '固定字面量 `1`，当前唯一支持的状态外层版本。'
    ),
    values: { '1': t('Current SSR state format.', '当前服务端状态格式。') }
  },
  stores: {
    summary: t(
      'Plain record of registration keys to plain IJSONValue field records; scope dehydration sorts keys and omits disposed stores.',
      '按注册键索引普通可序列化字段表的普通对象，作用域脱水按键排序并跳过已销毁容器。'
    )
  },
  resources: {
    summary: t(
      'Optional @migaia/resource IResourceCacheSnapshot record: version 2, finite nonnegative ageMs, finite nonnegative remainingTtlMs or null, and JSON data. Relative ages retain their canonical Resource meaning during hydration.',
      '可选资源包缓存快照表，各项版本为 `2`，缓存年龄为有限非负毫秒，剩余有效期为有限非负毫秒或空值，数据满足可序列化约束；相对年龄的复水语义由资源包拥有。'
    ),
    default: t(
      'Absent means no resource hydration; scope dehydration still emits an empty record when none exist.',
      '省略表示无资源复水，作用域无资源时脱水仍输出空表。'
    )
  }
}
/** Public instance operations preserve ownership and partial-failure behavior. */
const scopeMembers: Readonly<Record<string, IMemberDoc>> = {
  runtime: {
    summary: t(
      'Runtime fixed at construction, identical to the owner of every registered object. Cleanup releases registered owned objects; the scope does not dispose the Runtime itself.',
      '构造时固定的运行时，所有注册对象必须归属它；清理释放已注册且由作用域拥有的对象，不销毁运行时本体。'
    )
  },
  disposed: {
    summary: t(
      'Terminal flag set before cleanup; later active operations fail SCOPE_DISPOSED.',
      '清理前即设置的终态标记，此后活动操作抛 `SCOPE_DISPOSED`。'
    )
  },
  register: {
    summary: t(
      'Registers a same-Runtime store. Pending hydration runs before commit, followed by an active-state recheck. A hydration throw keeps the key free and pending data available; reentrant scope disposal rejects SCOPE_DISPOSED. Neither failure transfers ownership of the candidate, so the caller cleans it up. Duplicates fail INVALID_OPTION, other Runtime fails CROSS_RUNTIME.',
      '注册同运行时状态容器，待复水回调后重检活动状态再提交；回调抛错保留空闲键及待复水数据，重入销毁作用域则以 `SCOPE_DISPOSED` 拒绝；两种失败均不转移候选对象所有权，须由调用者清理。重复键抛 `INVALID_OPTION`，其他运行时抛 `CROSS_RUNTIME`。'
    ),
    params: {
      key,
      store: t(
        'ISSRStore, normally @migaia/store-light createStore with scope.runtime.',
        '状态容器协议对象，通常由轻量状态包使用作用域运行时创建。'
      ),
      options: t(
        'Optional ISSRRegistrationOptions; default owned true.',
        '可选注册选项，默认由作用域拥有。'
      )
    },
    returns: t('Void; retains the exact store by key.', '无返回值，按键保留精确实例。'),
    example: scopeExample
  },
  unregister: {
    summary: t(
      'Removes store registration, then starts requested owned cleanup. Synchronous failure leaves the key removed; asynchronous errors are retained for disposeAsync.',
      '先移除状态容器注册，再启动所需清理，同步失败时键已移除，异步失败保留给异步销毁边界。'
    ),
    params: {
      key,
      disposeOwned: t(
        'Default true; false leaves removed store alive.',
        '默认真，假则保留已移除容器存活。'
      )
    },
    returns: t(
      'Whether key existed; synchronous cleanup errors propagate.',
      '返回键是否存在，同步清理错误传播。'
    ),
    example: `scope.unregister('app', false)
await app.$dispose()`
  },
  detach: {
    summary: t(
      'Removes store registration without cleanup and transfers ownership to caller.',
      '移除注册但不清理，所有权转交调用者。'
    ),
    params: { key },
    returns: t('Exact ISSRStore or undefined.', '返回精确状态容器或 `undefined`。'),
    example: `const detached = scope.detach('app')
await detached?.$dispose()`
  },
  registerResource: {
    summary: t(
      'Registers a same-Runtime resource; pending hydration runs before commit and an active-state recheck. A thrown hydrate leaves the candidate unowned and pending data available; reentrant scope disposal rejects SCOPE_DISPOSED without admitting the candidate. Caller cleanup remains required. Duplicates fail INVALID_OPTION and mismatched owner fails CROSS_RUNTIME.',
      '注册同运行时资源，待复水回调后重检活动状态再提交；回调抛错保留待复水数据且不拥有候选对象，重入销毁作用域以 `SCOPE_DISPOSED` 拒绝且不接纳候选对象，清理仍归调用者；重复键抛 `INVALID_OPTION`，归属不同抛 `CROSS_RUNTIME`。'
    ),
    params: {
      key,
      resource: t(
        'ISSRResource, normally @migaia/resource Resource constructed with scope.runtime.',
        '资源协议对象，通常为使用作用域运行时构造的资源包实例。'
      ),
      options: t(
        'Optional registration policy, default owned true.',
        '可选注册策略，默认拥有资源。'
      )
    },
    returns: t(
      'Void; retains resource until removal or disposal.',
      '无返回值，保留资源至移除或销毁。'
    ),
    example: resourceExample
  },
  unregisterResource: {
    summary: t(
      'Disposes requested owned resource before deleting its registration; synchronous disposal failure leaves registration present.',
      '先按要求销毁所拥有资源，再删除注册，同步销毁失败会保留注册。'
    ),
    params: {
      key,
      disposeOwned: t('Default true; false skips cleanup.', '默认真，假则跳过清理。')
    },
    returns: t(
      'Whether registration was removed; original cleanup errors propagate.',
      '返回是否移除注册，原始清理错误传播。'
    ),
    example: `scope.unregisterResource('profile', false)
profile.dispose()`
  },
  detachResource: {
    summary: t(
      'Removes resource without disposing it; caller takes cleanup ownership.',
      '移除资源而不销毁，由调用者接管清理。'
    ),
    params: { key },
    returns: t('Exact ISSRResource or undefined.', '返回精确资源或 `undefined`。'),
    example: `scope.detachResource('profile')?.dispose()`
  },
  hydrate: {
    summary: t(
      'Validates, then applies entries best-effort. Missing registrations become pending hydration; each call replaces pending maps. Successful changes remain applied if another entry fails. One failure is rethrown unchanged; several become HYDRATE_FAILED AggregateError.',
      '先校验再尽力应用，未注册条目成为待复水数据，每次调用替换待复水表，其他项失败仍保留已成功变化，单项失败原样抛出，多项聚合为 `HYDRATE_FAILED`。'
    ),
    params: {
      state: t(
        'Version-1 ISSRState from deserializeSSRState or validated application data.',
        '由解析函数或有效应用数据得到的第一版状态。'
      )
    },
    returns: t('Void; no rollback protocol is provided.', '无返回值，不提供回滚协议。'),
    example: scopeExample
  },
  dehydrate: {
    summary: t(
      'Reads live registrations in key order. Store fields and resource data are validated, deeply copied and frozen; metadata is shallow copied. Disposed entries and resource snapshots returning undefined are omitted.',
      '按键序读取活动注册，状态字段及资源数据经校验、深拷贝与冻结，元数据浅拷贝，跳过已销毁条目及返回未定义快照的资源。'
    ),
    returns: t(
      'Frozen ISSRState; unsupported data fails SERIALIZE_UNSUPPORTED, entry access failures can become INVALID_SNAPSHOT with cause.',
      '返回冻结状态，不支持数据抛 `SERIALIZE_UNSUPPORTED`，字段读取失败可成为带原因的 `INVALID_SNAPSHOT`。'
    ),
    example: scopeExample
  },
  dehydrateTrusted: {
    summary: t(
      'Skips nested validation, copying and freezing. Only outer records are frozen; entry data remains live. Pair with serializeTrustedSSRState immediately for known immutable JSON fixtures.',
      '跳过嵌套校验、拷贝及冻结，仅外层表冻结，条目数据仍为活引用，对已知不可变且可序列化的数据立即搭配 `serializeTrustedSSRState`。'
    ),
    returns: t(
      'Branded ITrustedSSRState, not an immutable snapshot.',
      '返回带品牌状态，不是不可变快照。'
    ),
    example: trustedExample
  },
  awaitResources: {
    summary: t(
      'Waits in waterfall rounds, deduplicating last Promise identity per key. New retries/refetches participate. Getter failures and rejections become diagnostics. Continued new work after 64 rounds rejects RESOURCE_ROUND_LIMIT. Disposal returns already collected failures.',
      '按瀑布轮次等待，每键按上次承诺身份去重，新重试或刷新参与等待，读取器失败及拒绝收为诊断，六十四轮后继续新增工作以 `RESOURCE_ROUND_LIMIT` 拒绝，销毁返回已收集失败。'
    ),
    params: {
      options: t(
        'Optional IAwaitResourcesOptions, default empty with no deadline.',
        '可选资源等待选项，默认空且无截止期限。'
      )
    },
    returns: t(
      'Promise of readonly ISSRResourceFailure entries. At timeout only still-pending Promises receive RESOURCE_TIMEOUT; fulfilled entries are omitted and rejected entries retain their original reason. A zero budget recognizes already-settled work without awaiting in-flight resources. Invalid options reject the Promise rather than throwing synchronously.',
      '承诺返回只读失败条目；超时仅标记仍在途承诺，已兑现项跳过，已拒绝项保留原始原因；零预算仅识别已结算工作，不等待在途资源；无效选项使承诺拒绝而非同步抛错。'
    ),
    example: resourceExample
  },
  dehydrateAsync: {
    summary: t(
      'Waits, reports each failure, then calls dehydrate. It does not independently remove failed keys; inclusion follows resource.dehydrate. Disposal during waiting makes final dehydration reject SCOPE_DISPOSED.',
      '等待并报告每项失败，再脱水，不独立移除失败键，是否纳入由资源自身脱水决定，等待期间销毁会使最终脱水以 `SCOPE_DISPOSED` 拒绝。'
    ),
    params: {
      options: t(
        'Optional IDehydrateAsyncOptions, defaults to no deadline and Runtime reporting.',
        '可选异步脱水选项，默认无截止期限并交运行时报告。'
      )
    },
    returns: t(
      'Promise<ISSRState>; diagnostic throws/rejections are reported best-effort and do not stop other reports. Returned reporter thenables are observed without awaiting.',
      '承诺返回状态，诊断抛错或拒绝尽力报告且不停止其他报告，观察回调返回的类承诺但不等待。'
    ),
    example: resourceExample
  },
  dispose: {
    summary: t(
      'Marks terminal, wakes waits and clears registrations/pending state, then starts all owned cleanup: resources before stores, reverse registration order per group. Idempotent; one failure does not prevent other cleanup.',
      '标记终态、唤醒等待并清空注册与待复水状态，再启动所有所拥有对象清理，先资源后状态容器，组内按注册逆序，重复安全，单项失败不阻止其他清理。'
    ),
    returns: t(
      'Void without awaiting store cleanup. One synchronous failure is rethrown unchanged; several become SCOPE_DISPOSAL_FAILED AggregateError. Await disposeAsync for completion.',
      '无返回值且不等待状态容器清理，单项同步失败原样抛出，多项聚合为 `SCOPE_DISPOSAL_FAILED`，应等待异步销毁完成。'
    ),
    example: `scope.dispose()
await scope.disposeAsync()`
  },
  disposeAsync: {
    summary: t(
      'Starts disposal if needed and awaits every tracked owned cleanup. Completion is published before synchronous cleanup callbacks, so reentrant calls from dispose or disposeAsync share the same Promise. It waits for the full cleanup set admitted by the synchronous start pass and replays failures; the Runtime itself is retained.',
      '需要时启动销毁并等待全部已追踪清理；同步清理回调前发布完成承诺，因此从同步或异步销毁入口重入均共享同一承诺；等待本次同步启动阶段接纳的完整清理集合并重放失败，保留运行时本体。'
    ),
    returns: t(
      'Stable Promise<void>; exact single retained failure or SCOPE_DISPOSAL_FAILED AggregateError for multiple failures.',
      '返回稳定无值承诺，单项保留失败原样拒绝，多项聚合拒绝。'
    ),
    example: `const first = scope.disposeAsync()
console.log(first === scope.disposeAsync())
await first`
  }
}
/** Registry-owned cancellation and output contract. */
const scriptMembers: Readonly<Record<string, IMemberDoc>> = {
  codecs: {
    summary: t(
      'Required ISerializeRegistry from @migaia/serialize createSerializeRegistry; writer uses primaryType, reader uses data-codec and checks has.',
      '必需序列化包注册表，写端使用主格式，读端使用元素格式属性并先检查注册情况。'
    )
  },
  elementId: {
    summary: t(
      'Script identifier from caller configuration; writers enforce /^[A-Za-z_][A-Za-z0-9_:.-]*$/ or fail INVALID_STATE_SCRIPT.',
      '来自调用者的脚本标识符，写端要求首字符字母或下划线，后续为字母数字下划线冒号点连字符，否则抛 `INVALID_STATE_SCRIPT`。'
    ),
    default: t(
      'Uses the stable __STORE_STATE__ element identifier.',
      '默认使用 `__STORE_STATE__` 元素标识符。'
    )
  },
  signal: {
    summary: t(
      'External IAbortSignal forwarded to registry encode/decode; SSR neither owns nor aborts it.',
      '外部中止信号透传给注册表编解码，状态层不拥有也不主动中止。'
    ),
    default: t('Omitted: no caller cancellation signal.', '默认省略，无调用者取消信号。')
  }
}
/** Error is the only native helper accepting cause; others preserve errors or native type. */
const errorDoc = (native: string, aggregate = false) => ({
  role: 'error' as const,
  purpose: t(
    `Builds native ${native} tagged source @migaia/store-ssr and selected code, preserving stack and native class.`,
    `构造原生 \`${native}\` 并附加本包来源及所选错误码，保留堆栈与原生类别。`
  ),
  params: {
    code: t('Actual failure value from StoreSsrErrorCode.', '错误码表中对应实际失败的值。'),
    ...(aggregate
      ? {
          errors: t(
            'Original failures retained in AggregateError.errors.',
            '通过聚合子项保留的原始失败。'
          )
        }
      : {}),
    message: t('Caller-facing diagnostic message.', '调用者可读的诊断消息。')
  },
  ...(native === 'Error'
    ? {
        optionDocs: {
          cause: {
            summary: t(
              'Non-undefined original failure retained as cause.',
              '非未定义的原始失败作为原因保留。'
            ),
            default: t('Omitted; no cause attached.', '默认省略，不附加原因。')
          }
        }
      }
    : {}),
  returns: t(
    `Tagged ${native}; helper returns rather than throws it.`,
    `返回带身份的 \`${native}\`，辅助函数自身不抛出此返回值。`
  ),
  example: `import { createStoreSsr${native}, StoreSsrErrorCode } from '@migaia/store-ssr'
const error = createStoreSsr${native}(StoreSsrErrorCode.${aggregate ? 'hydrateFailed' : 'invalidOption'}, ${aggregate ? '[new Error("entry failed")], ' : ''}'Request state failed')
console.log(error)`
})
/** Public code descriptions identify concrete failure branches. */
const errors = {
  scopeDisposed: t(
    'Active operation after disposal; create a fresh request scope.',
    '销毁后继续活动操作，应新建请求作用域。'
  ),
  scopeDisposalFailed: t(
    'Several cleanup failures; inspect AggregateError.errors.',
    '多项清理失败，应检查聚合错误子项。'
  ),
  hydrateFailed: t(
    'Several hydration failures; successful entries remain applied.',
    '多项复水失败，成功条目仍保留变化。'
  ),
  invalidSnapshot: t(
    'Malformed stores/resources or resource metadata, property-access failures and invalid JSON syntax. Unclassified extensible native errors receive INVALID_SNAPSHOT in place with identity/class/stack preserved; frozen/non-Error failures remain on cause and complete foreign identities keep their owner.',
    '状态或资源外层、资源元数据无效、属性访问失败或语法无效；未编码且可扩展的原生错误原位附 `INVALID_SNAPSHOT`，保留身份、类型及堆栈；冻结或非错误值保留在原因链，完整外包身份保持原归属。'
  ),
  invalidStateScript: t(
    'Unsupported envelope version or invalid script ID.',
    '不支持的外层版本或无效脚本标识符。'
  ),
  invalidStoreKey: t(
    'Empty, non-string or `__proto__` registration/snapshot key.',
    '注册或快照键为空、非字符串或精确保留键 `__proto__`。'
  ),
  serializeUnsupported: t(
    'Non-JSON value, cycle, non-finite number, non-plain object, depth over 256 or traversal over one million nodes.',
    '非可序列化值、环、非有限数、非普通对象、深度超过二百五十六或遍历节点超过一百万。'
  ),
  invalidOption: t(
    'Invalid options, ownership, timeout, duplicate key, or simultaneous runtime/runtimeOptions.',
    '选项、所有权、超时、重复键无效，或同时传入已有运行时及构造选项。'
  ),
  crossRuntime: t('Registered object belongs to another Runtime.', '注册对象属于其他运行时。'),
  codecContract: t(
    'Writer codec returns value chunk or reader lacks named codec.',
    '写端格式返回值块，或读端未注册指定格式。'
  ),
  resourceRoundLimit: t(
    'Waterfall resources continue changing beyond the round limit.',
    '瀑布资源变化持续超出轮次上限。'
  ),
  resourceTimeout: t(
    'One resource Promise is still unsettled at the total deadline; completed siblings do not receive this code. Choose fallback or client refetch.',
    '单个资源承诺在总截止期限时仍未结算，已完成的同轮资源不附此码，应选择降级或客户端重新获取。'
  )
}

export const storeSsrReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Runtime-neutral request ownership, snapshots and safe HTML embedding. Resource, reactive and codec semantics remain in their owning packages. Create one scope per request and finish with disposeAsync.',
        '宿主无关的请求所有权、快照与安全页面内联，资源、响应与格式语义仍由所属包定义，每请求创建作用域并以异步销毁收尾。'
      ),
      example: scopeExample
    }
  },
  symbols: {
    SSRRequestScope: {
      role: 'factory',
      purpose: t(
        'Creates one fixed-Runtime request registry, equivalent to createSSRRequestScope.',
        '创建固定运行时的请求注册表，等价于请求作用域工厂。'
      ),
      options: 'ISSRRequestScopeOptions',
      optionDocs: runtimeMembers,
      returns: t(
        'New request-owned SSRRequestScope with empty registries and fixed Runtime; finish with disposeAsync. Invalid options or simultaneous runtime/runtimeOptions throw INVALID_OPTION before a usable scope is returned.',
        '返回具有空注册表及固定运行时的新请求作用域，应以异步销毁收尾，无效选项或同时传入已有运行时及构造选项在返回可用作用域前抛无效选项错误。'
      ),
      example: scopeExample
        .replace('const scope = createSSRRequestScope()', 'const scope = new SSRRequestScope()')
        .replace('createSSRRequestScope,', 'SSRRequestScope,')
    },
    createSSRRequestScope: {
      role: 'factory',
      purpose: t(
        'Constructs a fresh request scope; objects from a different Runtime cannot be registered.',
        '构造新请求作用域，不能注册其他运行时的对象。'
      ),
      options: 'ISSRRequestScopeOptions',
      optionDocs: runtimeMembers,
      returns: t(
        'SSRRequestScope to retain through rendering and await disposeAsync afterward.',
        '返回供渲染期间保留、结束后等待异步销毁的作用域。'
      ),
      example: scopeExample
    },
    assertSSRState: {
      role: 'operation',
      purpose: t(
        'Validates version-1 envelope and recursive plain JSON data without cloning/freezing.',
        '校验第一版外层及递归普通可序列化数据，不拷贝也不冻结。'
      ),
      params: {
        value: t(
          'Unknown parsed/request value to narrow to ISSRState.',
          '需收窄为状态类型的未知解析或请求值。'
        )
      },
      returns: t(
        'Void with type assertion. Validation errors retain their semantic identity. Unclassified extensible native getter failures receive INVALID_SNAPSHOT in place with class, stack and identity preserved; frozen/non-Error failures remain on cause, while complete foreign source/code identities remain unchanged.',
        '无返回值并收窄类型，校验错误保留语义身份；未编码且可扩展的原生读取器错误原位附 `INVALID_SNAPSHOT`，保留类型、堆栈及身份；冻结或非错误值保留在原因链，完整外包来源及错误码不变。'
      ),
      example: jsonExample
    },
    serializeSSRState: {
      role: 'operation',
      purpose: t(
        'Validates then JSON-stringifies, escaping &, <, > and Unicode line separators as \\u0026, \\u003c, \\u003e, \\u2028 and \\u2029 for non-executable HTML embedding.',
        '先校验再序列化，将与号、左右尖括号及统一码行分隔符分别转义为 `\\u0026`、`\\u003c`、`\\u003e`、`\\u2028`、`\\u2029`，以供不可执行页面内联。'
      ),
      params: {
        state: t(
          'ISSRState from scope.dehydrate or valid application data.',
          '来自作用域脱水或有效应用数据的状态。'
        )
      },
      returns: t(
        'HTML-escaped JSON string; validation/native JSON failures propagate.',
        '返回页面安全转义文本，校验及原生序列化失败传播。'
      ),
      example: scopeExample
    },
    serializeTrustedSSRState: {
      role: 'operation',
      purpose: t(
        'Serializes branded live data without validation; pair with dehydrateTrusted immediately before any await/mutation.',
        '不校验而序列化带品牌活数据，应在任何等待或变更前立即搭配 `dehydrateTrusted`。'
      ),
      params: {
        state: t(
          'Exact branded ITrustedSSRState produced by scope; a type cast provides no runtime guarantee.',
          '作用域产生的精确带品牌状态，类型断言不提供运行时保证。'
        )
      },
      returns: t(
        'HTML-escaped JSON; native stringify failures propagate.',
        '返回页面安全转义文本，原生序列化失败传播。'
      ),
      example: trustedExample
    },
    deserializeSSRState: {
      role: 'operation',
      purpose: t(
        'JSON-parses then validates the envelope; parsed state is not frozen.',
        '解析文本后校验完整状态外层及嵌套数据，不冻结也不额外拷贝解析状态。'
      ),
      params: {
        serialized: t(
          'Serialized JSON or script textContent, never a complete script tag.',
          '序列化文本或脚本正文，不能传完整脚本标签。'
        )
      },
      returns: t(
        'ISSRState; invalid JSON keeps its native SyntaxError class, stack and identity with INVALID_SNAPSHOT attached in place. Invalid payloads retain their validation identity; complete foreign identities remain unchanged.',
        '返回状态，无效语法保留原生语法错误类别、堆栈及身份，并原位附 `INVALID_SNAPSHOT`；无效载荷保留校验身份，完整外包错误身份不变。'
      ),
      example: scopeExample
    },
    createSSRStateScript: {
      role: 'operation',
      purpose: t(
        'Builds an application/json script with validated ID and safe JSON. Pair with readSSRStateFromDocument using the same ID.',
        '校验标识符并安全序列化后构造不可执行脚本，使用相同标识符搭配 `readSSRStateFromDocument`。'
      ),
      params: {
        state: t('Valid version-1 SSR state.', '有效第一版状态。'),
        elementId: t(
          'Optional ID from caller configuration, default __STORE_STATE__; must match the safe identifier pattern.',
          '来自调用者的可选标识符，默认 `__STORE_STATE__`，须符合安全标识符规则。'
        )
      },
      returns: t(
        'Complete script HTML; invalid ID throws INVALID_STATE_SCRIPT.',
        '返回完整脚本标签文本，无效标识符抛 `INVALID_STATE_SCRIPT`。'
      ),
      example: jsonExample
    },
    readSSRStateFromDocument: {
      role: 'operation',
      purpose: t(
        'Reads text from an explicitly injected host; never reads global document or checks script metadata.',
        '读取显式注入宿主的正文，不读取全局文档也不检查脚本元数据。'
      ),
      params: {
        elementId: t(
          'Optional matching ID from caller configuration, default __STORE_STATE__.',
          '来自调用者的可选匹配标识符，默认 `__STORE_STATE__`。'
        ),
        documentValue: t(
          'Optional ISSRDocument, e.g. browser document or caller adapter; absent means no element.',
          '可选文档协议对象，例如浏览器文档或调用者适配器，省略视为无元素。'
        )
      },
      returns: t(
        'ISSRState or undefined when text/element absent or empty. Whitespace is parsed and may throw.',
        '返回状态，正文或元素缺失或空时为 `undefined`，空白文本仍解析且可能抛错。'
      ),
      example: jsonExample
    },
    createSSRStateScriptWith: {
      role: 'operation',
      purpose: t(
        'Encodes via registry.primaryType. JSON text uses JSON-safe HTML escapes; other text/bytes become base64 in text/plain. Value chunks reject CODEC_CONTRACT.',
        '按注册表主格式编码，普通序列化文本使用保持语法的页面转义，其他文本或字节转为 Base64 放入纯文本脚本，值块以 `CODEC_CONTRACT` 拒绝。'
      ),
      params: { state: t('Valid ISSRState, checked before encoding.', '编码前校验的有效状态。') },
      options: 'ISSRScriptOptions',
      returns: t(
        'Promise of complete script with codec/wire metadata; codec/abort failures follow serialize.',
        '承诺返回含格式与传输元数据的完整脚本，格式及取消失败遵循序列化包。'
      ),
      example: codecExample
    },
    readSSRStateFromDocumentWith: {
      role: 'operation',
      purpose: t(
        'Decodes data-codec (default json) and data-wire (default text). b64 becomes bytes; other wire values become text. Validates decoded state.',
        '按格式属性默认普通序列化格式、传输属性默认文本解码，Base64 标记转字节，其他传输值视为文本，再校验状态。'
      ),
      options: 'ISSRReadOptions',
      returns: t(
        'Promise<ISSRState | undefined>; missing/empty text yields undefined, unregistered codec rejects CODEC_CONTRACT, host/codec failures propagate.',
        '承诺返回状态或 `undefined`，正文缺失或空则无结果，未注册格式以 `CODEC_CONTRACT` 拒绝，宿主及格式失败传播。'
      ),
      example: codecExample
    },
    createStoreSsrError: errorDoc('Error'),
    createStoreSsrRangeError: errorDoc('RangeError'),
    createStoreSsrTypeError: errorDoc('TypeError'),
    createStoreSsrAggregateError: errorDoc('AggregateError', true),
    STORE_SSR_SOURCE: {
      role: 'constant',
      purpose: t(
        'Source @migaia/store-ssr for package-owned failures; complete foreign source/code identities retain their owner.',
        '本包拥有的失败所附精确来源标记 `@migaia/store-ssr`，须与错误码联合识别，完整外包错误身份保持原归属。'
      ),
      example: `import { STORE_SSR_SOURCE } from '@migaia/store-ssr'
console.log(STORE_SSR_SOURCE)`
    },
    StoreSsrErrorCode: {
      role: 'constant',
      purpose: t(
        'Stable public error codes, interpreted together with source and cause/errors chains.',
        '稳定公开错误码，应当联合包来源以及原始原因和聚合子错误链共同理解。'
      ),
      example: `import { StoreSsrErrorCode } from '@migaia/store-ssr'
console.log(StoreSsrErrorCode.resourceTimeout)`
    },
    SsrWireType: {
      role: 'constant',
      purpose: t(
        'JSON codec identifier and text/bytes chunk-kind labels used by SSR.',
        '服务端状态使用的普通序列化格式标识与文本、字节块种类标签。'
      ),
      example: `import { SsrWireType } from '@migaia/store-ssr'
console.log(SsrWireType.json, SsrWireType.text, SsrWireType.bytes)`
    }
  },
  types: {
    SSRRequestScope: {
      summary: t(
        'Request registry from createSSRRequestScope or the class constructor.',
        '作用域工厂或类构造返回的请求注册表。'
      ),
      scenarios: [
        t(
          'Own stores/resources through rendering, snapshot, then await cleanup.',
          '在渲染期间拥有状态容器与资源，取快照后等待清理。'
        )
      ],
      example: scopeExample,
      members: scopeMembers
    },
    ISSRRequestScopeOptions: {
      summary: t('Mutually exclusive Runtime construction choices.', '互斥的运行时构造选择。'),
      members: runtimeMembers,
      example: scopeExample
    },
    ISSRRegistrationOptions: {
      summary: t('Ownership policy fixed at registration.', '注册时固定的所有权策略。'),
      members: {
        owned: {
          summary: t(
            'Boolean true gives scope cleanup responsibility, false keeps it with caller.',
            '真表示作用域负责清理，假由调用者负责。'
          ),
          default: t('True.', '默认真。')
        }
      },
      example: `scope.register('app', app, { owned: false })
scope.detach('app')
await app.$dispose()`
    },
    IAwaitResourcesOptions: {
      summary: t('Resource waterfall wait budget.', '等待资源瀑布的整体时间预算选项。'),
      members: { timeoutMs: timeout },
      example: resourceExample
    },
    IDehydrateAsyncOptions: {
      summary: t('Prefetch wait and diagnostic callback options.', '预取等待与诊断回调选项。'),
      members: {
        timeoutMs: timeout,
        onResourceError: {
          summary: t(
            'Synchronous callback for each {key,error} failure in collected order; return void. Throws and rejected returned thenables are reported best-effort to Runtime phase ssr-resource; returned thenables are not awaited.',
            '按收集顺序为各项含键及原始错误的失败同步调用，返回空值，抛错及返回类承诺的拒绝尽力交运行时资源阶段报告，不等待返回类承诺。'
          ),
          default: t(
            'Runtime.reportError(failure.error, {phase: ssr-resource}).',
            '默认交运行时报告原始错误及服务端资源阶段。'
          )
        }
      },
      example: resourceExample
    },
    ISSRState: {
      summary: t(
        'Versioned JSON-compatible envelope; readonly typing alone does not freeze all producers.',
        '带版本且可序列化的外层，只读类型自身不保证所有生产者都会冻结。'
      ),
      scenarios: [
        t(
          'Transfer server state into client hydration or a non-executable script.',
          '把服务端状态传给客户端复水或不可执行脚本。'
        )
      ],
      example: jsonExample,
      members: stateMembers
    },
    ITrustedSSRState: {
      summary: t(
        'ISSRState intersected with inaccessible unique-symbol brand, produced by dehydrateTrusted. Nested references remain live; do not fabricate via cast.',
        '普通状态与不可访问唯一符号品牌的交叉类型，由可信脱水产生，嵌套引用仍是活数据，不应断言伪造。'
      ),
      example: trustedExample,
      members: stateMembers
    },
    IJSONPrimitive: {
      members: {},
      summary: t(
        'String, number, boolean or null; runtime validation rejects non-finite numbers despite the broad number type.',
        '字符串、数字、布尔值或空值，数字类型虽宽泛，运行时拒绝非有限数。'
      ),
      example: `import type { IJSONPrimitive } from '@migaia/store-ssr'
const value: IJSONPrimitive = 1`
    },
    IJSONValue: {
      members: {},
      summary: t(
        'Recursive primitives, readonly arrays or string-keyed records. Runtime requires plain objects, no cycles and bounded depth/nodes; bigint, undefined, functions and class instances are unsupported.',
        '递归基本值、只读数组或字符串键表，运行时要求普通对象、无环及深度节点限制，不支持大整数、未定义、函数及类实例。'
      ),
      example: `import type { IJSONValue } from '@migaia/store-ssr'
const value: IJSONValue = { title: 'Ready', flags: [true, null] }`
    },
    ISSRStore: {
      scenarios: [
        t(
          'Adapt a Store Light instance into request-owned cleanup and snapshots.',
          '把轻量状态实例纳入请求所拥有的清理及快照。'
        )
      ],
      summary: t(
        'A request scope groups the stores used by one server request. This type lists the methods it needs to save state, restore it, and release a store. [Store Light’s createStore](/en/docs/store-light/api/createStore) returns a compatible object. Create the store with runtime: scope.runtime, sharing the scope’s execution context, then pass it to scope.register. The scope can then collect its state for a request snapshot and owns cleanup by default. Without registration, the scope does not collect or clean up that store. Using a different runtime makes registration throw CROSS_RUNTIME.',
        '请求作用域集中管理一次服务端请求使用的存储。这个类型规定保存状态、恢复状态和释放存储时需要的方法。[Store Light 的 createStore](/zh/docs/store-light/api/createStore) 会返回符合要求的对象。创建存储时设置 runtime: scope.runtime，与作用域共用负责执行数据更新的运行时对象，再传给 scope.register。注册后，作用域可以收集这份存储的状态来生成请求快照，并默认负责清理。未注册时，作用域不会收集或清理它；若使用了不同的运行时，注册会抛出 CROSS_RUNTIME。'
      ),
      example: scopeExample,
      members: {
        $runtime: {
          summary: t(
            'Exact owner Runtime, identical to scope.runtime.',
            '精确所属运行时，须与作用域运行时相同。'
          )
        },
        $disposed: {
          summary: t(
            'Terminal flag checked for dehydration/cleanup omission.',
            '脱水及清理用于跳过对象的终态标记。'
          )
        },
        $plain: {
          summary: t(
            'Synchronous plain data callback, never a Promise.',
            '同步普通数据回调，不能返回承诺。'
          ),
          returns: t(
            'Record<string, unknown>; validated/copied by dehydrate or retained live by trusted path. Throws propagate.',
            '返回普通字段表，安全脱水校验拷贝，可信路径保留活引用，抛错传播。'
          ),
          example: `console.log(app.$plain())`
        },
        $hydrate: {
          summary: t(
            'Synchronous data application callback without transactional rollback.',
            '同步数据应用回调，无事务回滚。'
          ),
          params: {
            state: t('Store field record from validated state.', '已校验状态中的容器字段表。')
          },
          returns: t(
            'Void; original failures are retained by hydration or propagate from registration.',
            '无返回值，原始失败由复水保留或从注册传播。'
          ),
          example: `app.$hydrate({ count: 2 })`
        },
        $dispose: {
          summary: t(
            'Releases owned store resources, possibly asynchronously.',
            '可同步或异步释放所拥有容器资源。'
          ),
          returns: t(
            'Void or PromiseLike<void>; scope observes rejection and disposeAsync awaits completion.',
            '返回空值或无值类承诺，作用域观察拒绝并通过异步销毁等待完成。'
          ),
          example: `await app.$dispose()`
        }
      }
    },
    ISSRResource: {
      scenarios: [
        t(
          'Prefetch a resource and transfer its cache through the request scope.',
          '预取资源并通过请求作用域传输缓存。'
        )
      ],
      summary: t(
        'The methods needed to manage loaded data within one server request: wait for loading, save or restore cached data, and release the resource. [Resource](/en/docs/resource/api/Resource) provides these methods. Construct it with scope.runtime, the request scope’s execution context, and pass it to scope.registerResource. The scope can then wait for it, ask it for cached data, and clean it up by default. Without registration, the scope does not manage it. A resource using a different runtime makes registration throw CROSS_RUNTIME. Resource itself defines whether cached data is available to save.',
        '规定在一次服务端请求内管理加载数据所需的方法，包括等待加载、保存或恢复缓存，以及释放资源。[Resource](/zh/docs/resource/api/Resource) 提供这些方法。创建时传入 scope.runtime，也就是请求作用域用来执行和管理数据更新的运行时对象，再传给 scope.registerResource。作用域随后可以等待它、向它收集缓存，并默认负责清理。未注册的资源不会由作用域管理；若使用不同的运行时，注册会抛出 CROSS_RUNTIME。是否有可保存的缓存，由 Resource 自身决定。'
      ),
      example: resourceExample,
      members: {
        runtime: {
          summary: t(
            'Exact Runtime owner, identical to scope.runtime.',
            '精确运行时归属，须与作用域相同。'
          )
        },
        disposed: {
          summary: t(
            'Terminal flag checked by dehydration and cleanup.',
            '脱水及清理检查的终态标记。'
          )
        },
        promise: {
          summary: t(
            'Current prefetch Promise, reread each round and deduplicated by identity per key; continuous getter failure is captured once.',
            '当前预取承诺，每轮重读且逐键按身份去重，持续读取器失败只记录一次。'
          )
        },
        dehydrate: {
          summary: t(
            'Synchronous optional resource cache snapshot producer.',
            '同步产生可选资源缓存快照。'
          ),
          returns: t(
            'IResourceCacheSnapshot or undefined to omit; errors propagate.',
            '返回资源包缓存快照或以未定义跳过，错误传播。'
          ),
          example: `console.log(profile.dehydrate())`
        },
        hydrate: {
          summary: t('Synchronously applies external resource snapshot.', '同步应用外包资源快照。'),
          params: {
            snapshot: t(
              'Version-2 IResourceCacheSnapshot with relative ageMs/remainingTtlMs from validated SSR state.',
              '来自已校验状态、携带相对缓存年龄及剩余有效期的第二版资源快照。'
            )
          },
          returns: t(
            'Void; failures remain reachable through scope hydration.',
            '无返回值，失败通过作用域复水保留。'
          ),
          example: `const cached = profile.dehydrate()
if (cached) profile.hydrate(cached)`
        },
        dispose: {
          summary: t(
            'Synchronous resource cleanup; this protocol does not accept async disposal.',
            '同步资源清理，此协议不接受异步销毁。'
          ),
          returns: t(
            'Void; scope disposal retains failures, unregisterResource propagates them.',
            '无返回值，作用域销毁保留失败，资源注销直接传播。'
          ),
          example: `profile.dispose()`
        }
      }
    },
    ISSRResourceFailure: {
      summary: t(
        'Resource wait diagnostic preserving original rejection/getter failure or tagged timeout.',
        '保留原始拒绝、读取器失败或带身份超时的资源等待诊断。'
      ),
      example: resourceExample,
      members: {
        key: {
          summary: t('Failed pending round entry registration key.', '失败等待轮次条目的注册键。')
        },
        error: {
          summary: t(
            'Unknown original failure or RESOURCE_TIMEOUT Error; do not assume every value is an Error.',
            '未知原始失败或带超时码的错误，不应假设所有值均为错误实例。'
          )
        }
      }
    },
    ISSRScriptOptions: {
      summary: t(
        'Required registry and optional script encoding controls.',
        '必需注册表与可选脚本编码控制。'
      ),
      members: scriptMembers,
      example: codecExample
    },
    ISSRReadOptions: {
      summary: t(
        'Required registry and explicitly injected document host.',
        '必需注册表与显式文档宿主。'
      ),
      members: {
        ...scriptMembers,
        document: {
          summary: t(
            'Application ISSRDocument; browser document is structurally compatible. No global fallback.',
            '应用注入的文档协议对象，浏览器文档结构兼容，不回退至全局。'
          ),
          default: t(
            'Omitted: returns undefined without decoding.',
            '默认省略，不解码并返回未定义。'
          )
        }
      },
      example: codecExample
    },
    ISSRDocument: {
      summary: t(
        'Minimal injected document protocol without browser dependency.',
        '不依赖浏览器的最小注入文档协议。'
      ),
      example: jsonExample,
      members: {
        getElementById: {
          summary: t(
            'Synchronous host callback; host errors propagate with their existing identity. Element textContent is string/null; getAttribute(name) synchronously returns metadata string/null.',
            '宿主同步回调，错误保留已有身份传播，元素正文为字符串或空值，属性读取同步返回元数据字符串或空值。'
          ),
          params: {
            elementId: t(
              'Element identifier received from caller configuration and passed unchanged by the reader.',
              '来自调用者配置并由读取器原样传入的元素标识符。'
            )
          },
          returns: t(
            'Element-like {textContent,getAttribute(name)} or null; basic reader reads text only, codec reader also reads data-codec/data-wire.',
            '返回含正文及属性读取函数的类元素对象或空值，基本读取器仅使用正文，格式读取器还读取格式与传输属性。'
          ),
          example: jsonExample
        }
      }
    },
    IStoreSsrErrorCode: {
      members: {},
      summary: t('Value union of the StoreSsrErrorCode runtime table.', '运行时错误码表的值联合。'),
      example: `import { StoreSsrErrorCode, type IStoreSsrErrorCode } from '@migaia/store-ssr'
const code: IStoreSsrErrorCode = StoreSsrErrorCode.invalidOption`
    },
    ISsrWireType: {
      members: {},
      summary: t(
        'Union json, text or bytes from SsrWireType; b64 is HTML metadata outside this union.',
        '传输标签表中的普通序列化格式、文本或字节联合，Base64 是联合外的页面元数据。'
      ),
      example: `import { SsrWireType, type ISsrWireType } from '@migaia/store-ssr'
const wire: ISsrWireType = SsrWireType.text`
    }
  },
  enums: {
    SsrWireType: {
      summary: t('Codec and chunk labels used for HTML embedding.', '页面内联使用的格式及块标签。'),
      values: {
        json: t(
          'JSON codec, eligible for syntax-preserving escaping.',
          '可使用保持语法转义的普通序列化格式。'
        ),
        text: t(
          'A text chunk whose payload is a JavaScript string.',
          '载荷为普通字符串值的文本数据块。'
        ),
        bytes: t(
          'A binary chunk whose payload is a Uint8Array.',
          '载荷为无符号字节数组的二进制数据块。'
        )
      }
    },
    StoreSsrErrorCode: {
      summary: t('Interpret each code with STORE_SSR_SOURCE.', '应与本包来源联合识别错误码。'),
      values: errors
    }
  },
  enhancers: {}
}
