/**
 * Adapter listener reference checked against core/internal/listener-safety.ts,
 * message-listener-hub.ts and safe-value.ts on 2026-10-17. The hub does not catch a dispatch
 * callback failure itself. Terminal draining waits for reporter promises already tracked in the
 * supplied states, not arbitrary outstanding listener work. Returned helper shapes are package
 * local types, documented here without claiming additional public exports.
 */
import type { ILibraryReference, IMemberDoc, IText, ISymbolDoc, ITypeDoc } from './contract.js'
import { transportReference } from './rpc-core-transports.js'

/** Both site languages receive complete authored prose. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** A helper operation specifies its actual arguments and completion behavior. */
const op = (
  en: string,
  zh: string,
  params: Record<string, IText>,
  returns: IText,
  example: string
): ISymbolDoc => ({ role: 'operation', purpose: t(en, zh), params, returns, example })
/** A method on the returned local helper has the same documentation obligations. */
const method = (
  en: string,
  zh: string,
  params: Record<string, IText>,
  returns: IText,
  example: string
): IMemberDoc => ({ summary: t(en, zh), params, returns, example })
/** Failure state must come from the actual state factory, retaining invocation order. */
const state = t(
  'State returned by `createListenerFailureState()` for this adapter boundary.',
  '由 `createListenerFailureState()` 为当前适配器边界返回的状态。'
)
/** The caller preserves primary failures before cleanup or reporter failures. */
const errors = t(
  'Original failure values in desired primary-first order; empty means no primary failure.',
  '按主错误优先排列的原始失败值，空数组表示没有主失败。'
)
/** These are optional local policy fields, not listener registration inputs. */
const boundary = t(
  'Optional policy: `code` defaults to `INTERNAL`; `message` is aggregate text; `secondaryFailures` selects factory-issued reporter states; `aggregateSingle` defaults to false except where the operation says otherwise.',
  '可选策略：错误码默认 `INTERNAL`，消息用于汇总错误，次要失败字段选择工厂签发的报告状态，单项汇总默认关闭，具体操作另有说明时以其为准。'
)
/** Physical removal callbacks remain caller supplied and run in reverse order. */
const removals = t(
  'Application callbacks removing already registered physical listeners; invoked in reverse array order without awaiting return values.',
  '应用提供的已登记物理监听器移除回调，按数组逆序调用，不等待其返回值。'
)
/** Callback reporting is synchronous at invocation, while returned thenables are observed. */
const reporter = t(
  'Application callback receiving the original listener error; a returned thenable is observed and its failure is retained in the supplied state.',
  '应用回调接收原始监听错误，返回类承诺时会观察其结算，并将失败保留在所提供状态中。'
)
/** A complete listener dispatch boundary reports failures and drains known reporter settlements. */
const listenerExample = `const failures = createListenerFailureState()
observeListener(() => listener(message), error => report(error), failures)
await drainTerminalListenerFailures([], { secondaryFailures: failures })`
/** Hub membership and actual carrier attachment are owned at the same boundary. */
const hubExample = `const hub = createMessageListenerHub<string>()
const failures = createListenerFailureState()
const receive = (value: string) => console.log(value)
hub.add(receive, () => port.addEventListener('message', onMessage))
function onMessage(event: { data: string }) {
  hub.dispatch(event.data, (listener, value) => observeListener(() => listener(value), report, failures))
}
hub.remove(receive, () => port.removeEventListener('message', onMessage))
console.log(hub.has(receive), hub.size)
hub.clear(() => port.removeEventListener('message', onMessage))
await drainTerminalListenerFailures([], { secondaryFailures: failures })`

/** Returned helper members are retained as local shape documentation, never exported aliases. */
const types: Record<string, ITypeDoc> = {
  IRpcTransport: transportReference.types.IRpcTransport!,
  IRpcSendOptions: transportReference.types.IRpcSendOptions!,
  IListenerFailureState: {
    summary: t(
      'Adapter-local ordered reporter failure ledger returned by the state factory.',
      '状态工厂返回的适配器本地有序报告失败账本。'
    ),
    scenarios: [
      t(
        'Retain synchronous and asynchronous reporter failures until their owner drains them.',
        '将同步及异步报告失败保留到拥有者排空时。'
      )
    ],
    example: listenerExample,
    members: {
      failures: {
        summary: t(
          'Mutable entries `{ order, error }` awaiting drain; errors keep original identity.',
          '等待排空的可变顺序与错误条目，错误保留原始身份。'
        )
      },
      pending: {
        summary: t(
          'Set of tracked reporter settlement promises; terminal drain waits for this set to empty.',
          '已跟踪报告函数结算承诺的集合，终态排空等待此集合清空。'
        )
      },
      nextOrder: {
        summary: t(
          'Next adapter-local reporter invocation sequence number, starting at zero.',
          '下一个适配器本地报告调用序号，从零开始。'
        )
      }
    }
  },
  IMessageListenerHub: {
    summary: t(
      'Local Set-backed listener membership and one physical attachment boundary.',
      '由本地集合维护的监听成员与单次物理挂接边界。'
    ),
    scenarios: [
      t(
        'Share one native event listener among several transport subscriptions.',
        '让多个传输订阅共享同一个原生事件监听器。'
      )
    ],
    example: hubExample,
    members: {
      size: {
        summary: t(
          'Current number of distinct registered callback identities.',
          '当前登记的不同回调身份数量。'
        )
      },
      has: method(
        'Checks whether this exact callback is registered.',
        '检查当前是否登记了此精确回调。',
        {
          listener: t(
            'Original application callback passed to add.',
            '先前传给添加操作的原始应用回调。'
          )
        },
        t(
          'True only for a currently registered callback identity.',
          '仅当前已登记的回调身份返回真。'
        ),
        `console.log(hub.has(receive))`
      ),
      add: method(
        'Attaches the physical listener before adding the first callback; duplicate callbacks remain one Set member.',
        '加入首个回调前挂接物理监听器，重复回调仅占一个集合成员。',
        {
          listener: t('Application callback to retain by identity.', '按身份保留的应用回调。'),
          attach: t(
            'Synchronous physical registration callback; a throw leaves this callback unregistered.',
            '同步物理登记回调，抛错时不加入当前回调。'
          )
        },
        t(
          'No result; first successful attachment and membership are retained.',
          '无返回值，保留首次成功挂接及成员关系。'
        ),
        hubExample
      ),
      remove: method(
        'Detaches before removing the last callback; a detach throw keeps membership so release can be retried.',
        '移除最后回调前先解除物理挂接，解除抛错时保留成员以便重试释放。',
        {
          listener: t('Exact original callback supplied to add.', '添加时提供的精确原始回调。'),
          detach: t(
            'Synchronous physical removal callback invoked only for the last member.',
            '仅最后成员移除时调用的同步物理解除回调。'
          )
        },
        t(
          'True if removed, false if absent; detach failure propagates.',
          '已移除返回真，原本不存在返回假，解除失败向外传播。'
        ),
        `hub.remove(receive, detach)`
      ),
      dispatch: method(
        'Snapshots callbacks before invocation; reentrant membership changes affect subsequent dispatches, and an invoke throw stops this dispatch.',
        '调用前对回调取快照，重入成员变更影响后续派发，调用回调抛错会停止当前派发。',
        {
          message: t(
            'Actual message received from the physical carrier.',
            '物理载体实际接收到的消息。'
          ),
          invoke: t(
            'Synchronous dispatcher receiving each snapshot listener and the message; use observeListener to isolate failures.',
            '同步派发器接收每个快照监听器与消息，可使用 `observeListener()` 隔离失败。'
          )
        },
        t(
          'No result; invokes each snapshot member unless the dispatcher throws.',
          '无返回值，依次调用快照成员，派发器抛错时停止。'
        ),
        hubExample
      ),
      clear: method(
        'Detaches the physical listener before clearing all callbacks; failure keeps membership intact.',
        '清空全部回调前先解除物理监听，失败时保留成员关系。',
        { detach: t('Synchronous physical removal callback.', '同步物理解除回调。') },
        t(
          'No result; membership is empty after successful return.',
          '无返回值，成功返回后成员已清空。'
        ),
        `hub.clear(detach)`
      )
    }
  }
}

/** Every exported listener and safe-access operation describes its real failure behavior. */
const symbols: Record<string, ISymbolDoc> = {
  createListenerFailureState: {
    ...op(
      'Creates one adapter-local ordered state for reporter failures; retain it with the physical listener owner.',
      '为报告失败创建适配器本地有序状态，应与物理监听拥有者一同保留。',
      {},
      t(
        'Mutable `{ failures: [], pending: new Set(), nextOrder: 0 }`. failures retain original errors and invocation order; pending tracks reporter settlement promises. Pass this exact state to observation and drain operations.',
        '返回可变状态：失败列表与待结算集合初始为空，下一序号为零；失败列表保留原错误及调用顺序，待结算集合跟踪报告函数的承诺。将同一状态传给观察及排空操作。'
      ),
      listenerExample
    ),
    role: 'factory'
  },
  createMessageListenerHub: {
    ...op(
      'Creates a local listener fan-out hub sharing one physical attachment across distinct callback identities.',
      '创建本地监听扇出中心，让不同回调身份共享一次物理挂接。',
      {},
      t(
        'Local hub with size, has(listener), add(listener, attach), remove(listener, detach), dispatch(message, invoke) and clear(detach). add/remove/clear return void except remove returning whether a member was removed; has returns boolean. Dispatch snapshots membership and propagates invoke failures. Attach/detach callbacks are synchronous; failure leaves the logical change uncommitted.',
        '返回本地中心：`size` 为成员数，`has(listener)` 返回是否存在，`add(listener, attach)` 添加成员，`remove(listener, detach)` 返回是否移除，`dispatch(message, invoke)` 快照派发，`clear(detach)` 清空。其余操作不返回值，派发回调失败向外传播；挂接及解除回调必须同步，失败时不提交逻辑变更。'
      ),
      hubExample
    ),
    role: 'factory'
  },
  collectListenerCleanupFailures: op(
    'Runs all synchronous listener removals in reverse order and collects exact failures without stopping at the first.',
    '逆序执行全部同步监听移除操作，收集原始失败，不在首个失败处停止。',
    { removals },
    t(
      'New array of failures in reverse-removal encounter order; callbacks and input array are not altered.',
      '返回按逆序移除遇到的失败组成的新数组，不改变回调及输入数组。'
    ),
    `const cleanupErrors = collectListenerCleanupFailures([removeMessage, removeError])`
  ),
  collectListenerFailure: op(
    'Appends an already observed secondary failure using the next invocation order in the original state.',
    '使用原状态的下一调用序号追加已经观察到的次要失败。',
    {
      state,
      error: t('Exact secondary failure caught by the caller.', '调用方捕获的精确次要失败。')
    },
    t(
      'No result; one failure is appended and nextOrder advances.',
      '无返回值，已追加一项失败并推进下一序号。'
    ),
    `const state = createListenerFailureState()
collectListenerFailure(state, failure)`
  ),
  createListenerFailure: op(
    'Builds a package-tagged native cleanup failure without consuming reporter states; a single Error normally keeps its exact identity.',
    '构造带包标识的原生清理失败，不消费报告状态，单个错误通常保持精确身份。',
    { errors, boundary },
    t(
      'Undefined for no errors. A single Error is tagged in place unless already canonically tagged, except aggregateSingle forces AggregateError. Multiple or non-Error values use AggregateError with the original values in errors.',
      '没有错误时返回空值；单个错误原位加标识，已有规范标识则保留，强制单项汇总时使用汇总错误。多个或非错误值使用 `AggregateError`，原始值保留在错误列表。'
    ),
    `const failure = createListenerFailure([primary, cleanup], { aggregateSingle: true })
if (failure) throw failure`
  ),
  drainListenerFailures: op(
    'Consumes settled reporter failures once, after supplied primary failures, and throws their canonical native result.',
    '在所提供主失败之后一次消费已结算报告失败，并抛出规范原生结果。',
    { errors, boundary },
    t(
      'Returns void if no failure remains; otherwise throws. Settled state entries are removed in state order and reporter invocation order. Pending reporter promises are not awaited.',
      '没有剩余失败时不返回值，否则抛出。已结算状态条目按状态顺序及报告调用顺序取出并删除，不等待尚未完成的报告承诺。'
    ),
    `const failures = createListenerFailureState()
collectListenerFailure(failures, secondary)
drainListenerFailures([primary], { secondaryFailures: failures })`
  ),
  drainTerminalListenerFailures: op(
    'Waits for all currently tracked reporter promises to settle before consuming failures at a terminal boundary.',
    '在终态边界消费失败前等待当前跟踪的报告承诺全部结算。',
    { errors, boundary },
    t(
      'Void when supplied states have no pending reporters; otherwise a Promise. Throws or rejects with primary-first collected failures. It does not await unrelated pending listener work.',
      '所提供状态没有待结算报告时同步返回空值，否则返回承诺。以主失败优先的收集结果抛出或拒绝，不等待无关的待结算监听工作。'
    ),
    listenerExample
  ),
  observeListener: op(
    'Invokes a listener now, observes sync throws and thenable rejections, and reports them without throwing into the carrier dispatch.',
    '立即调用监听器，观察同步抛错及类承诺拒绝，通过报告路径处理，不抛进载体派发。',
    {
      invoke: t(
        'Zero-argument callback running the actual listener; its successful value is ignored.',
        '执行实际监听器的无参回调，不消费成功返回值。'
      ),
      report: reporter,
      reporterFailures: t(
        'Optional state returned by createListenerFailureState; omitted creates an internal state that the caller cannot later drain.',
        '可选工厂返回状态，省略时创建内部状态，调用方无法之后排空。'
      )
    },
    t(
      'No result and no wait for listener settlement; reporter failures collect in the selected state.',
      '无返回值，不等待监听结算，报告函数失败收集在所选状态中。'
    ),
    listenerExample
  ),
  reportListenerFailure: op(
    'Snapshots all reporters, invokes each with the original failure, and retains reporter failures without aborting later reporters.',
    '对报告函数取快照，逐个传入原始失败，保留报告失败且不阻止后续报告。',
    {
      error: t('Original adapter failure to fan out.', '需要扇出报告的原始适配器失败。'),
      reporters: t(
        'Application iterable of reporter functions; snapshot before invoking.',
        '应用报告函数可迭代集合，调用前先取快照。'
      ),
      reporterFailures: state
    },
    t(
      'No result; sync and async reporter failures are collected by invocation order.',
      '无返回值，同步及异步报告失败按调用顺序收集。'
    ),
    `const state = createListenerFailureState()
reportListenerFailure(error, [report], state)
await drainTerminalListenerFailures([], { secondaryFailures: state })`
  ),
  registerListeners: op(
    'Adds physical listeners in order and rolls back earlier successful registrations in reverse order if an add throws.',
    '按顺序添加物理监听器，添加抛错时逆序回滚先前成功登记。',
    {
      registrations: t(
        'Application records with synchronous add() and remove(); the failed add is not added to the rollback list.',
        '应用提供的同步添加及移除记录，失败的添加本身不会加入回滚列表。'
      ),
      boundary
    },
    t(
      'No result on success; on failure throws the original registration failure first, followed by rollback and settled reporter failures.',
      '成功时无返回值，失败时先保留原登记失败，再附回滚及已结算报告失败。'
    ),
    `registerListeners([
  { add: addMessage, remove: removeMessage },
  { add: addError, remove: removeError }
])`
  ),
  releaseListenerRegistration: op(
    'Removes every physical listener before committing logical removal; a cleanup failure preserves the logical registration for retry.',
    '先移除全部物理监听器再提交逻辑移除，清理失败时保留逻辑登记以便重试。',
    {
      removals,
      commitRelease: t(
        'Synchronous application callback publishing logical removal, invoked only if all removals succeed.',
        '同步应用回调，仅全部物理移除成功后发布逻辑移除。'
      ),
      boundary
    },
    t(
      'No result on success; cleanup failures throw with aggregateSingle default false. A commitRelease throw propagates directly.',
      '成功时无返回值，清理失败抛出，单项汇总默认关闭；逻辑提交回调抛错会直接传播。'
    ),
    `releaseListenerRegistration([removeMessage, removeError], () => active.delete(listener))`
  ),
  safeRead: op(
    'Reads one property of an object or function once; failed getters or proxy traps are reported synchronously or rethrown with the original cause.',
    '对对象或函数的单个属性只读取一次，失败的访问器或代理陷阱被同步报告，或保留原始原因重新抛出。',
    {
      value: t(
        'Untrusted received object or function; primitive and null inputs return undefined.',
        '收到的不可信对象或函数，原始值及空输入返回空值。'
      ),
      key: t('Application-selected property key to inspect.', '应用选择的待检查属性键。'),
      report: t(
        'Optional synchronous callback receiving `{ key, error }`, expected to return undefined; a successful callback converts the failed read to undefined.',
        '可选同步回调接收属性键及原始错误，契约要求返回空值，回调成功时将读取失败转为空值。'
      )
    },
    t(
      'Property value or undefined. Without report, throws TypeError with PROPERTY_READ_FAILED; if report also throws, its cause contains the read failure first and reporter failure second.',
      '返回属性值或空值。不提供报告函数时抛出 `PROPERTY_READ_FAILED` 类型错误；报告函数也抛错时，原因链先保留读取失败，再保留报告失败。'
    ),
    `const data = safeRead<unknown>(event, 'data', failure => { console.error(failure.error); return undefined })`
  ),
  safeString: op(
    'Converts an untrusted value to text once; failed conversion is reported synchronously or rethrown as a coded TypeError retaining the original cause.',
    '将不可信值一次转换为文本，转换失败时同步报告，或保留原始原因抛出带码类型错误。',
    {
      value: t('Any received value to stringify.', '需要转为文本的任意接收值。'),
      fallback: t(
        'Application fallback used only after conversion fails and reporting succeeds; omitted uses the canonical unknown-error text.',
        '仅转换失败且报告成功后使用的应用后备文本，省略时使用规范未知错误文本。'
      ),
      report: t(
        'Optional synchronous callback receiving `{ error }` and returning undefined.',
        '可选同步回调接收原始错误并返回空值。'
      )
    },
    t(
      'Converted string or reported-failure fallback; without a reporter, throws STRING_CONVERSION_FAILED with the original cause. Reporter failure retains both original failures in primary-first order.',
      '返回转换文本或报告成功后的后备文本；没有报告函数时抛出保留原始原因的 `STRING_CONVERSION_FAILED`。报告函数失败时按主错误优先保留两个原始失败。'
    ),
    `const reason = safeString(value, '未知错误', failure => { console.error(failure.error); return undefined })`
  )
}

/** Package-local returned shapes are described on the factory page, without inventing exports. */
for (const [factory, shape] of [
  ['createMessageListenerHub', 'IMessageListenerHub'],
  ['createListenerFailureState', 'IListenerFailureState']
] as const) {
  const original = symbols[factory]!
  const members = Object.entries(types[shape]!.members)
  const describe = (locale: 'en' | 'zh') =>
    members
      .map(([name, doc]) =>
        [
          `\`${name}\`: ${doc.summary[locale]}`,
          ...Object.entries(doc.params ?? {}).map(
            ([parameter, description]) => `\`${parameter}\`: ${description[locale]}`
          ),
          doc.returns?.[locale] ?? ''
        ]
          .filter(Boolean)
          .join(' ')
      )
      .join('\n\n')
  symbols[factory] = {
    ...original,
    returns: t(
      `${original.returns!.en}\n\n${describe('en')}`,
      `${original.returns!.zh}\n\n${describe('zh')}`
    )
  }
}

/** Transport-kit data is merged into the full Core reference by its canonical owner. */
export const kitReference: ILibraryReference = {
  modules: {
    'transport-kit': {
      summary: t(
        'Adapter-facing transport types and local listener safety helpers. Start with createMessageListenerHub and createListenerFailureState, then preserve physical listener ownership through registration and terminal drain.',
        '面向适配器的传输类型及本地监听安全辅助能力。从 `createMessageListenerHub()` 和 `createListenerFailureState()` 开始，通过登记与终态排空保持物理监听所有权。'
      ),
      example: hubExample
    }
  },
  symbols,
  types: { IRpcTransport: types.IRpcTransport!, IRpcSendOptions: types.IRpcSendOptions! },
  enums: transportReference.enums,
  enhancers: {}
}
