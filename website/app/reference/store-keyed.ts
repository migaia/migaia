/**
 * Reference for `@migaia/store-keyed`, checked against current package source, README and USEGUIDE
 * on 2026-10-18. Advanced primitives belong to /optics. Definition identity, scoped state, protocol
 * implementations and cache retention have separate owners; source controls behavior where existing
 * package prose remains stale.
 */
import type { ILibraryReference, IMemberDoc, IOptionCaseDoc, IText, ITypeDoc } from './contract.js'
import { storeKeyedCases } from './store-keyed-cases.js'

/** Creates one bilingual sentence pair. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Creates property documentation with omission behavior only where it exists. */
const f = (en: string, zh: string, defaultEn?: string, defaultZh?: string): IMemberDoc => ({
  summary: t(en, zh),
  ...(defaultEn !== undefined && defaultZh !== undefined
    ? { default: t(defaultEn, defaultZh) }
    : {})
})

/** Definitions become state only through a caller-owned AtomStore. */
const storeExample = `import { createRuntime } from '@migaia/reactive'
import { atomDef, derivedDef, writableDef, createAtomStore } from '@migaia/store-keyed'

const count = atomDef(1, 'count')
const doubled = derivedDef((get) => get(count) * 2)
const increment = writableDef((get) => get(count), (get, set, delta: number) => {
  set(count, get(count) + delta)
  return get(count)
})
const store = createAtomStore(createRuntime())
const off = store.sub(doubled, () => console.log(store.peek(doubled)))
store.set(increment, 2)
console.log(store.get(doubled), store.isObserved(doubled), store.size)
const undo = store.override(doubled, derivedDef(() => 99))
console.log(store.get(doubled))
undo()
off()
store.release(count)
store.dispose()`

/** Projection, immutable focus and keyed splitting all write through the same store boundary. */
const opticsExample = `import { createRuntime } from '@migaia/reactive'
import { atomDef, createAtomStore, selectDef, focusDef, opticDef, splitDef } from '@migaia/store-keyed'

const user = atomDef({ name: 'guest', age: 20 })
const label = selectDef(user, (value) => value.name)
const name = focusDef(user, 'name')
const age = opticDef(user, { get: (value) => value.age, set: (value, age) => ({ ...value, age }) })
const rows = atomDef<readonly { id: string; done: boolean }[]>([{ id: 'a', done: false }])
const split = splitDef(rows, (row) => row.id)
const store = createAtomStore(createRuntime())
store.set(name, 'Ada')
store.set(age, (previous) => previous + 1)
store.set(split.of('a'), (row) => ({ ...row, done: true }))
split.insert(store, { id: 'b', done: false })
console.log(store.get(label), store.get(split.items))
console.log(split.remove(store, 'a'), split.prune(store))
store.dispose()`

/** Family identity is shared while state stays scoped to each store. */
const familyExample = `import { createRuntime } from '@migaia/reactive'
import { createAtomStore, familyDef, derivedFamilyDef } from '@migaia/store-keyed'

const values = familyDef((key: string) => ({ key, count: 0 }), { maxSize: 100 })
const totals = derivedFamilyDef((key: string) => (get) => get(values(key)).count)
const store = createAtomStore(createRuntime())
const token = values('chat-1')
store.set(token, (value) => ({ ...value, count: value.count + 1 }))
console.log(store.get(totals('chat-1')), values.size)
console.log(values.forget('chat-1'))
values.clear()
totals.clear()
store.dispose()`

/** Family options control definition retention and labels, independently of store values. */
const familyOptionCases: readonly IOptionCaseDoc[] = [
  {
    title: t(
      'Keep only a small set of recent drafts strongly cached',
      '只强保留少量最近访问的草稿定义'
    ),
    problem: t(
      'An embedded editor visits many rooms but needs only two recent definitions kept strongly in its family cache. The default keeps up to 4096. Set `maxSize: 2`; older live definitions remain reusable through weak references, so retaining a token still preserves its identity.',
      '嵌入式编辑器会访问许多房间，但定义族只需强保留最近两个定义。默认上限为 4096。设置 `maxSize: 2` 后，更早的存活定义仍可通过弱引用复用，持有令牌的代码不会失去原来的身份。'
    ),
    example: `import { familyDef } from '@migaia/store-keyed'

const drafts = familyDef((room: string) => ({ room, text: '' }), { maxSize: 2 })
const first = drafts('room-a')
drafts('room-b')
drafts('room-c')
console.log(drafts.size, drafts('room-a') === first)
drafts.clear()`,
    result: t(
      'The output is `2 true`: the strong cache stays bounded, and the retained first token is reused.',
      '输出 `2 true`：强缓存保持在上限以内，先前持有的令牌仍被复用。'
    ),
    covers: ['maxSize']
  },
  {
    title: t(
      'Distinguish source and derived room values in diagnostics',
      '在诊断信息里区分房间源值与派生值'
    ),
    problem: t(
      'Several room families appear in the same diagnostics. Without custom labels, source tokens all use `family` and derived tokens use `derived-family`. Give each family a clear `debugLabel`; the key is appended in brackets, while values and dependencies keep their normal behavior.',
      '同一份诊断信息里出现多个房间定义族。不设置标签时，所有源令牌都用 `family` 前缀，派生令牌都用 `derived-family`。为每个族设置清楚的 `debugLabel`，键会追加在方括号里；值和依赖关系仍按原有方式运行。'
    ),
    example: `import { createRuntime } from '@migaia/reactive'
import { createAtomStore, familyDef, derivedFamilyDef } from '@migaia/store-keyed'

const unread = familyDef((room: string) => room.length, { debugLabel: 'unread-source' })
const labels = derivedFamilyDef((room: string) => (get) => get(unread(room)), {
  debugLabel: 'unread-label'
})
const store = createAtomStore(createRuntime())
console.log(unread('ab').debugLabel, labels('ab').debugLabel)
console.log(store.get(labels('ab')))
store.set(unread('ab'), 5)
console.log(store.get(labels('ab')))
store.dispose()
unread.clear()
labels.clear()`,
    result: t(
      'The labels print `unread-source[ab] unread-label[ab]`. The derived value prints `2`, then `5` after the source changes.',
      '标签输出 `unread-source[ab] unread-label[ab]`。派生值先输出 `2`，源值变化后输出 `5`。'
    ),
    covers: ['debugLabel']
  }
]

/** Native error helpers retain both Error objects and structured application reasons. */
const errorOptionCases = (name: string, native: string): readonly IOptionCaseDoc[] => [
  {
    title: t('Keep a failed definition initializer', '保留定义初始化器的原始失败'),
    problem: t(
      'An adapter adds context to a failed initializer. A new error message alone loses the failure and its original stack. Set `cause` to keep that error available without changing its identity.',
      '适配器需要为初始化器失败补充上下文。只创建新错误消息会丢失原始失败及其堆栈。把原始错误传给 `cause`，便能按原身份保留它。'
    ),
    example: `import { ${name}, StoreKeyedErrorCode } from '@migaia/store-keyed'

const original = new Error('draft data could not be read')
const error = ${name}(StoreKeyedErrorCode.invalidOption, 'draft initialization failed', {
  cause: original
})
console.log(error instanceof ${native}, error.cause === original)`,
    result: t(
      'Both comparisons print `true`: the helper keeps its native error class and the exact original cause.',
      '两个比较都输出 `true`：辅助函数保留原生错误类型，以及同一个原始原因。'
    ),
    covers: ['cause']
  },
  {
    title: t('Keep the rejected input record', '保留被拒绝的输入记录'),
    problem: t(
      'A settings loader describes invalid family capacity with a record rather than an Error. Without `cause`, turning it into a message loses its fields. Pass the record directly so the caller can inspect it later.',
      '设置加载器用记录对象说明族容量无效，而不是提供 Error。只把记录转成消息会丢失其中的字段。直接把记录传给 `cause`，调用方之后仍能检查它。'
    ),
    example: `import { ${name}, StoreKeyedErrorCode } from '@migaia/store-keyed'

const reason = { field: 'maxSize', value: 0 }
const error = ${name}(StoreKeyedErrorCode.invalidOption, 'family settings rejected', {
  cause: reason
})
console.log(error.cause === reason)`,
    result: t(
      'The comparison prints `true`; the original input record remains on `error.cause`.',
      '比较输出 `true`；原始输入记录保留在 `error.cause` 上。'
    ),
    covers: ['cause']
  }
]

/** The public cache has no resource lifecycle; callers choose any eviction cleanup. */
const cacheExample = `import { KeyedSplitCache } from '@migaia/store-keyed/optics'

const cache = new KeyedSplitCache<string, { count: number }>()
const item = cache.of('a', () => ({ count: 1 }))
console.log(cache.get('a') === item, cache.size, [...cache.keys()], [...cache.values()])
console.log(cache.prune((key) => key === 'b', (value) => value.count > 0, (value) => console.log(value)))
cache.clear()`

/** Protocol examples adapt the canonical store rather than introducing another state owner. */
const protocolExample = `import { createRuntime } from '@migaia/reactive'
import { atomDef, createAtomStore } from '@migaia/store-keyed'
import { atomGetter, atomSetter, type IWritableAtom } from '@migaia/store-keyed/reactive/atom'

const runtime = createRuntime()
const store = createAtomStore(runtime)
const definition = atomDef(1)
let disposed = false
const atom: IWritableAtom<number, readonly [number], void> = {
  runtime,
  atomDefinition: definition,
  get disposed() { return disposed },
  get value() { return store.get(definition) },
  get observed() { return store.isObserved(definition) },
  read: () => store.get(definition),
  peek: () => store.peek(definition),
  write: (value) => store.set(definition, value),
  dispose: () => {
    if (disposed) return
    disposed = true
    store.release(definition)
  }
}
const get = atomGetter(runtime)
const set = atomSetter(runtime)
set(atom, 2)
console.log(get(atom), atom.peek())
atom.dispose()
store.dispose()`

/** Array helper example uses real caller-selected keys rather than generated identities. */
const arrayExample = `import { computeUniqueKeys, findKeyIndex, requireKeyIndex, spliceInsert, filterOutKey, replaceAtIndex, shallowArrayEquals } from '@migaia/store-keyed/optics'

const rows = [{ id: 'a', count: 1 }]
const keyOf = (row: { id: string }) => row.id
console.log(computeUniqueKeys(rows, keyOf, 'rows'), findKeyIndex(rows, keyOf, 'a'))
const index = requireKeyIndex(rows, keyOf, 'a', 'removed row')
const next = replaceAtIndex(rows, index, { id: 'a', count: 2 })
console.log(spliceInsert(next, { id: 'b', count: 0 }, Infinity))
console.log(filterOutKey(next, keyOf, 'a'), shallowArrayEquals(rows, next))`

/** Definition kinds are discriminants, not separate runtime implementations on their own. */
const kindValues = {
  primitive: t(
    'Initial-value source token; the store clones mutable templates before creating each scoped signal.',
    '初始值源令牌，存储在创建各作用域信号前复制可变模板。'
  ),
  primitiveFactory: t(
    'Per-store source factory token; preview is allowed only when previewSafe is true.',
    '每存储初始化工厂令牌，仅显式预览安全时允许预览求值。'
  ),
  derived: t(
    'Read-only token evaluated through the current store getter and reactive dependencies.',
    '通过当前存储读取器及响应依赖求值的只读令牌。'
  ),
  writableDerived: t(
    'Derived read token with a caller-defined write callback and exact argument/result contract.',
    '附调用者写回调及精确参数结果契约的派生读取令牌。'
  )
}

/** Definition callback fields retain their own inputs, outputs and throw behavior. */
const definitionMembers: Readonly<Record<string, IMemberDoc>> = {
  kind: {
    summary: t(
      'Discriminant chosen by the definition constructor; it selects source, factory, derived or writable-derived instantiation.',
      '由定义构造函数选择的判别标签，用于选择源、工厂、派生或可写派生实例化。'
    ),
    values: { enum: 'AtomKind' }
  },
  debugLabel: f(
    'Optional caller-selected diagnostic name; does not identify or merge definition tokens.',
    '调用者选择的可选诊断名称，不作为定义令牌身份，也不合并令牌。',
    'Omitted by ordinary constructors; family constructors supply their own label defaults.',
    '普通构造函数默认省略，族构造函数提供各自默认标签。'
  ),
  init: f(
    'Initial template supplied to atomDef; thenables reject at construction. Mutable object templates are cloned per store using host structuredClone.',
    '传给基础定义工厂的初始模板，构造时拒绝承诺式值，可变对象模板在各存储中经宿主结构化复制。'
  ),
  create: {
    summary: t(
      'No-argument synchronous initializer, called when a store first materializes this source or when permitted preview needs it. Return a nonthenable value; exceptions propagate and preview may be abandoned.',
      '无参数同步初始化回调，在存储首次实例化源或允许的预览需要时调用，返回非承诺式值，抛错传播且预览可能被放弃。'
    ),
    returns: t(
      'Initial T owned by this store; callers must create independent mutable containers. A thenable result rejects with INVALID_OPTION.',
      '返回当前存储拥有的初始值，调用者应创建独立可变容器，承诺式结果以 `INVALID_OPTION` 拒绝。'
    ),
    example: `import { createRuntime } from '@migaia/reactive'
import { atomDefFactory, createAtomStore } from '@migaia/store-keyed'
const token = atomDefFactory(() => ({ count: 0 }))
const store = createAtomStore(createRuntime())
console.log(store.get(token))
store.dispose()`
  },
  previewSafe: {
    summary: t(
      'Whether an unmaterialized source factory may run in speculative preview; safe factories must be pure and deterministic.',
      '未实例化源工厂能否在推测预览执行，安全工厂必须纯净且确定。'
    ),
    default: t(
      'false for atomDefFactory and true for previewSafeAtomDefFactory; fixed by the constructor.',
      '普通工厂为假，显式预览安全工厂为真，由构造函数固定。'
    )
  },
  read: {
    summary: t(
      'Synchronous derived callback receiving the current store getter. Read dependencies with get(definition), return T, and let throws propagate through the owning reactive evaluation.',
      '同步派生回调，接收当前存储读取器，经给定读取函数读取依赖并返回值，抛错通过所属响应求值传播。'
    ),
    params: {
      get: t(
        'Store-issued IAtomGet; takes a definition created by this package and returns its current scoped value with dependency tracking.',
        '存储签发的读取函数，接收当前包创建的定义并返回带依赖追踪的当前作用域值。'
      )
    },
    returns: t(
      'Derived T; no asynchronous result is awaited by the read contract.',
      '返回派生值，读取契约不等待异步结果。'
    ),
    example: storeExample
  },
  write: {
    summary: t(
      'Synchronous caller write callback receiving store get, store set and original args. The store invokes it inside batch and untracked; its return or throw is preserved.',
      '同步调用者写回调，接收存储读取、写入函数及原始参数，存储在批处理与不追踪上下文执行并保留返回或抛错。'
    ),
    params: {
      get: t(
        'Store-issued reader for current definition values.',
        '存储签发、读取当前定义值的函数。'
      ),
      set: t(
        'Store-issued writer accepting a writable definition followed by its exact arguments.',
        '存储签发、接收可写定义及其精确参数的写函数。'
      ),
      args: t(
        'Original arguments supplied by the caller to store.set for this writable definition.',
        '调用者写入当前可写定义时提供的原始参数。'
      )
    },
    returns: t(
      'Caller-defined Result, forwarded unchanged by store.set; no promise is awaited by the synchronous callback boundary.',
      '调用者定义的结果，由存储写入接口原样返回，同步回调边界不等待承诺。'
    ),
    example: storeExample
  },
  equals: {
    summary: t(
      'Synchronous equality callback for derived values. Receives new and previous candidates, returns true to retain equivalence; exceptions follow reactive computation or preview failure handling.',
      '派生值同步相等回调，接收新旧候选值，返回真表示等价，异常按响应计算或预览失败处理。'
    ),
    params: {
      a: t(
        'First candidate supplied by the owning computation or preview.',
        '所属计算或预览提供的第一个候选值。'
      ),
      b: t(
        'Second candidate supplied by the owning computation or preview.',
        '所属计算或预览提供的第二个候选值。'
      )
    },
    returns: t(
      'Boolean indicating semantic equality; comparisons are synchronous and are not awaited.',
      '同步返回语义相等布尔值，不等待异步比较。'
    ),
    default: t(
      'No custom comparator; the owning reactive computed uses its Object.is default.',
      '默认无自定义比较器，由所属响应计算使用对象同值比较。'
    ),
    example: storeExample
  }
}

/** One definition type helper reuses only exact shared definition member contracts. */
const definitionType = (
  summary: IText,
  keys: readonly string[],
  example = storeExample
): ITypeDoc => ({
  summary,
  scenarios: [
    t(
      'Share a pure definition between stores while keeping each store value and lifetime independent.',
      '跨存储共享纯定义，同时让各存储的值及生命周期保持独立。'
    )
  ],
  example,
  members: Object.fromEntries(keys.map((key) => [key, definitionMembers[key]!]))
})

/** Standard focus/split writes specialize the generic definition callback to one update and void. */
const standardDefinitionType = (summary: IText, keys: readonly string[]): ITypeDoc => {
  /** Shared definition members retain their canonical prose except the specialized writer. */
  const base = definitionType(summary, keys, opticsExample)
  return {
    ...base,
    members: {
      ...base.members,
      write: {
        ...definitionMembers.write!,
        params: {
          get: definitionMembers.write!.params!.get!,
          set: definitionMembers.write!.params!.set!,
          args: t(
            'Exactly one IAtomUpdate<T>: a replacement value or synchronous previous-to-next callback, supplied by store.set for this focused or split definition.',
            '恰好一个标准更新参数：新值或同步旧值转新值回调，由存储写入接口传给当前焦点或拆分定义。'
          )
        },
        returns: t(
          'No result; the standard writer commits the focused or split-item update through the owning store and returns void.',
          '无返回值；标准写入器经所属存储提交焦点或拆分条目的更新。'
        ),
        example: opticsExample
      }
    }
  }
}

/** Real definition source references come from factory calls or family lookup. */
const definitionParam = t(
  'Definition token returned by atomDef, a derived/optic constructor or family lookup; the store owns its scoped instance.',
  '由基础定义、派生或光学构造函数及族查找返回的令牌，存储拥有其作用域实例。'
)

/** One key extractor policy is used by the pure list helpers and splitDef. */
const keyOfParam = t(
  'Synchronous callback receiving the current source item and zero-based source index, returning the application key. A throw stops the operation unchanged; no asynchronous key is awaited.',
  '同步回调接收当前源条目与零起始源索引，返回应用键，抛错原样终止操作，不等待异步键。'
)

/** List keys are caller-owned values produced by the same source extractor. */
const keyParam = t(
  'Key obtained from the same keyOf callback or chosen by the application for that source item.',
  '来自同一个取键回调，或由应用为当前源条目选定的键。'
)

/** Complete operational surface of one scoped store. */
const storeMembers: Readonly<Record<string, IMemberDoc>> = {
  runtime: f(
    'The exact external IRuntime passed at store construction; it owns dependency tracking, batching and error reporting.',
    '构造时传入的精确外包运行时，拥有依赖追踪、批处理及错误报告。'
  ),
  disposed: f(
    'Terminal store flag set before disposal begins; subsequent state operations reject rather than recreating nodes.',
    '销毁开始前设置的存储终态标记，后续状态操作拒绝而非重建节点。'
  ),
  size: f(
    'Current number of instantiated definitions strongly retained by this store, excluding uncommitted preview entries.',
    '当前存储强保留的已实例化定义数量，不含未提交预览条目。'
  ),
  get: {
    summary: t(
      'Resolves active overrides, lazily materializes a definition and reads with Runtime dependency tracking.',
      '解析活动覆盖、惰性实例化定义，并在运行时依赖追踪下读取。'
    ),
    params: { definition: definitionParam },
    returns: t(
      'Current scoped T; disposed stores use ATOM_STORE_DISPOSED and invalid definitions use INVALID_OPTION. Initialization/read failures preserve their owning semantics.',
      '返回当前作用域值，已销毁使用 `ATOM_STORE_DISPOSED`，非法定义使用 `INVALID_OPTION`，初始化及读取失败保留所属语义。'
    ),
    example: storeExample
  },
  peek: {
    summary: t(
      'Resolves and lazily materializes a definition but reads without creating a dependency edge in the current capture.',
      '解析并惰性实例化定义，但读取不会在当前捕获中创建依赖边。'
    ),
    params: { definition: definitionParam },
    returns: t(
      'Current untracked T with the same admission and initialization failures as get.',
      '返回不追踪的当前值，接纳及初始化失败与普通读取一致。'
    ),
    example: storeExample
  },
  preview: {
    summary: t(
      'Reads speculative state without permanently materializing uncommitted definitions. Existing instances are peeked; new factory values require previewSafe and cached previews expire through Runtime idle cleanup.',
      '读取推测状态而不永久实例化未提交定义，已有实例直接无追踪读取，新工厂值要求预览安全，缓存预览经运行时空闲清理过期。'
    ),
    params: { definition: definitionParam },
    returns: t(
      'Speculative T. Unsafe source creation uses PREVIEW_UNSAFE, preview cycles use CIRCULAR_PREVIEW; abandoned values need not become committed state.',
      '返回推测值，不安全源创建使用 `PREVIEW_UNSAFE`，预览环使用 `CIRCULAR_PREVIEW`，放弃的值无需成为提交状态。'
    ),
    example: `import { createRuntime } from '@migaia/reactive'
import { previewSafeAtomDefFactory, createAtomStore } from '@migaia/store-keyed'
const token = previewSafeAtomDefFactory(() => ({ count: 0 }))
const store = createAtomStore(createRuntime())
console.log(store.preview(token), store.size)
store.dispose()`
  },
  set: {
    summary: t(
      'Writes the resolved target inside Runtime batch/untracked. Primitive targets accept value or update(previous); writable-derived targets receive their exact args.',
      '在运行时批处理及不追踪中写解析目标，基础目标接受新值或旧值更新函数，可写派生目标接收精确原参数。'
    ),
    params: {
      definition: definitionParam,
      update: t(
        'For a source definition (`atomDef`, `atomDefFactory`): the new value, or a function receiving the previous value and returning the next one. The function runs synchronously and its throw propagates.',
        '写源定义（`atomDef`、`atomDefFactory`）时传入：新值，或者接收旧值、返回新值的函数。函数同步执行，抛出的错误原样向外传播。'
      ),
      args: t(
        'Primitive: one value or synchronous previous-to-next callback, with throws propagated. Writable-derived: the Args declared by writableDef, forwarded unchanged.',
        '基础定义接收一个新值或同步旧值转新值回调，抛错传播，可写派生接收定义声明的精确参数并原样转发。'
      )
    },
    returns: t(
      'Undefined for primitive writes or the writable callback Result. Writing a read-only target rejects with OVERRIDE_CONTRACT.',
      '基础写入返回未定义，可写回调返回其结果，写只读目标以 `OVERRIDE_CONTRACT` 拒绝。'
    ),
    example: storeExample
  },
  sub: {
    summary: t(
      'Establishes dependency observation immediately without calling the listener initially. Later change callbacks run synchronously untracked; throws are reported to runtime.reportError and do not kill other subscriptions.',
      '立即建立依赖观察但首次不调用监听者，后续变更回调同步不追踪执行，抛错交给运行时报告且不终止其他订阅。'
    ),
    params: {
      definition: definitionParam,
      onChange: t(
        'Caller synchronous no-argument notification; read the current snapshot with store.peek if needed. No result is used or awaited.',
        '调用者提供的同步无参数通知，需要当前快照时经存储无追踪读取，不使用或等待返回值。'
      )
    },
    returns: t(
      'External IDisposer: a no-argument idempotent unsubscribe function. Store disposal also releases active subscriptions.',
      '返回外包无参数幂等取消订阅函数，存储销毁也释放活动订阅。'
    ),
    example: storeExample
  },
  override: {
    summary: t(
      'Adds one reversible read-routing layer while preserving write contracts. Read-only definitions accept same-value replacements; primitive targets require primitive/factory replacements; writable-derived targets preserve Args and Result.',
      '新增一个可撤销读取路由层并保留写契约，只读定义可用同值替代，基础目标只接受基础或工厂替代，可写派生保留参数及结果。'
    ),
    params: {
      definition: definitionParam,
      replacement: t(
        'Compatible definition token created by the same public constructors, with value and write types required by the corresponding overload.',
        '由同一套公开构造函数产生的兼容令牌，满足相应重载要求的值及写类型。'
      )
    },
    returns: t(
      'Idempotent undo function; target state is retained. Incompatible contracts use OVERRIDE_CONTRACT and cyclic routes use CYCLIC_OVERRIDE, rolling back the attempted layer.',
      '返回幂等撤销函数并保留目标状态，不兼容写契约使用 `OVERRIDE_CONTRACT`，环形路由使用 `CYCLIC_OVERRIDE` 并回滚尝试层。'
    ),
    example: storeExample
  },
  isObserved: {
    summary: t(
      'Checks the resolved definition existing node observation state without creating an instance.',
      '不创建实例，检查解析定义已有节点的观察状态。'
    ),
    params: { definition: definitionParam },
    returns: t(
      'True when an existing node is observed; false otherwise. Disposed stores and invalid definitions still reject.',
      '已有节点被观察时返回真，否则为假，已销毁存储及非法定义仍拒绝。'
    ),
    example: storeExample
  },
  release: {
    summary: t(
      'Releases only one instantiated definition, first trying its override-resolved target and trying the original definition only if the first removes no instance. Other store instances remain intact.',
      '只释放一个已实例化定义，先尝试覆盖解析目标，仅前者未释放实例时才尝试原定义，其他存储实例保持不变。'
    ),
    params: { definition: definitionParam },
    returns: t(
      'True if an instance was removed and disposed, false when neither key had one. Disposal failures propagate.',
      '实例被移除并销毁时返回真，两种键均无实例时返回假，销毁失败传播。'
    ),
    example: storeExample
  },
  dispose: {
    summary: t(
      'Idempotently marks terminal and clears uncommitted preview values plus overrides, releases subscriptions, then drains instance ownership in reverse order. Retaining the disposed store does not retain values through its preview cache.',
      '幂等标记终态，清除未提交预览值与覆盖，释放订阅后逆序释放实例所有权；保留已销毁存储不会再经预览缓存持有值。'
    ),
    returns: t(
      'No result after cleanup attempts. One collected failure is thrown unchanged; multiple failures throw DISPOSAL_FAILED AggregateError with original errors reachable.',
      '完成清理尝试后无返回值，单个收集失败原样抛出，多个失败抛保留原始错误的 `DISPOSAL_FAILED` 聚合错误。'
    ),
    example: storeExample
  }
}

/** Family callable values own token caches rather than scoped graph resources. */
const familyMembers: Readonly<Record<string, IMemberDoc>> = {
  size: f(
    'Number of strongly retained tokens in the bounded LRU, excluding weak canonical references.',
    '有界最近使用缓存强保留的令牌数，不含规范弱引用。'
  ),
  forget: {
    summary: t(
      'Explicitly breaks canonical identity for one key; it never releases existing AtomStore instances of the old token.',
      '显式打破单个键的规范身份，不释放旧令牌已经建立的存储实例。'
    ),
    params: {
      key: t(
        'Application family key previously passed to the same family callable.',
        '此前传给同一族可调用值的应用键。'
      )
    },
    returns: t(
      'True when a strong or weak cached identity was removed; false when absent. Future lookup may create a new token.',
      '移除强或弱缓存身份时返回真，原本不存在时返回假，后续查找可创建新令牌。'
    ),
    example: familyExample
  },
  clear: {
    summary: t(
      'Clears strong and weak canonical token caches and unregisters finalizer entries; existing store state remains owned by its store.',
      '清空强缓存与规范弱令牌缓存并取消终结注册，已有存储状态仍归其存储拥有。'
    ),
    returns: t(
      'No result; future family lookups can create new identities for every key.',
      '无返回值，后续族查找可为每个键创建新身份。'
    ),
    example: familyExample
  }
}

/** All package-owned failures have stable native-preserving error identity. */
const errorValues = {
  atomStoreDisposed: t(
    'A state operation uses a disposed AtomStore; create a new store instead.',
    '状态操作使用已销毁原子存储，需要改用新存储。'
  ),
  disposalFailed: t(
    'Several store cleanup entries failed; inspect original errors in the aggregate.',
    '多个存储清理条目失败，需要检查聚合中的原始错误。'
  ),
  circularPreview: t(
    'Speculative definition evaluation loops back to its active preview stack.',
    '推测定义求值回到当前活动预览栈，形成循环。'
  ),
  cyclicOverride: t(
    'Override routing contains a cycle and cannot resolve a final definition.',
    '覆盖路由含环，无法解析最终定义。'
  ),
  overrideContract: t(
    'A write or override would break the definition read/write contract.',
    '写入或覆盖会破坏定义的读取与写入契约。'
  ),
  previewUnsafe: t(
    'An unmaterialized factory is evaluated speculatively without explicit preview safety.',
    '未实例化工厂在未显式标记预览安全时被推测求值。'
  ),
  crossRuntime: t(
    'A protocol atom is read or written through a helper bound to a different Runtime.',
    '协议原子通过绑定到另一个运行时的辅助函数读写。'
  ),
  envUnsupported: t(
    'Host capabilities such as WeakRef, FinalizationRegistry or structuredClone are required but unavailable.',
    '当前路径要求的宿主弱引用、终结注册或结构化复制能力缺失。'
  ),
  opticAccessFailed: t(
    'An accessor or proxy fails during a pure optic read or immutable copy. Existing foreign identities remain unchanged; mutable native errors retain identity and stack, while fallback cause/errors retain the original.',
    '纯光学读取或不可变复制中的访问器、代理失败；外包已有身份不变，可修改原生错误保留身份与堆栈，回退经原因或错误列表保留原值。'
  ),
  invalidOption: t(
    'Definition, family limit, thenable initial value, optic path or keyed-list input violates its supported contract.',
    '定义、族上限、承诺式初始值、光学路径或键列表输入违反支持契约。'
  )
}

/** Native constructors share cause options but retain distinct runtime classes. */
const causeOptions: Readonly<Record<string, IMemberDoc>> = {
  cause: f(
    'Caller-supplied original failure, retained by native Error.cause identity.',
    '调用者提供的原始失败，经原生错误原因属性按身份保留。',
    'Omitted; the native error has no supplied cause.',
    '默认省略，原生错误不附提供的原因。'
  )
}

/** Common primitive factory parameters keep identical callback and label semantics. */
const createParams = {
  create: t(
    'No-argument synchronous factory returning a nonthenable initial value for each store; create independent mutable containers and let exceptions propagate.',
    '无参数同步工厂，为各存储返回非承诺式初始值，应创建独立可变容器，异常原样传播。'
  ),
  debugLabel: t(
    'Optional application diagnostic string; defaults to undefined and never determines token identity.',
    '可选应用诊断字符串，默认未定义，不决定令牌身份。'
  )
}

/** Complete reference for definition, scoped instantiation, optics and protocol subpaths. */
export const storeKeyedReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Pure definition-based keyed state, scoped AtomStore, family identity caches and immutable optics. Start with atomDef and createAtomStore; definitions are reusable tokens and each store owns its values. Runtime dependencies point inward to reactive, lifecycle and utils.',
        '提供纯定义键状态、作用域原子存储、族身份缓存及不可变光学操作，从基础定义与存储工厂开始，定义是可复用令牌，各存储拥有自身值；运行时依赖向内指向响应式内核、生命周期与基础工具。'
      ),
      example: storeExample
    },
    'atom/definition': {
      summary: t(
        'Describe reusable pieces of state before choosing where their values will live. Import this subpath for definition constructors and their callback types when you do not need the other helpers collected at the root.\n\nStart with `atomDef()` for an initial value and `derivedDef()` for a value computed by reading other definitions. These functions create descriptions rather than reactive nodes; pass the descriptions to an atom store to read or change actual state.',
        '先描述可复用的状态单元，再决定在哪里保存它们的值。只需定义构造函数及其回调类型时导入此子路径，无需从根入口选择其他辅助接口。\n\n从 `atomDef()` 声明初始值，用 `derivedDef()` 描述如何读取其他定义并计算结果。这些函数只创建描述，不创建响应式节点；实际状态的读写由消费这些定义的原子存储完成。'
      ),
      example: storeExample
    },
    'atom/store': {
      summary: t(
        'Give reusable state definitions a place to hold values, read dependencies and notify subscribers. Choose this subpath when you need store construction and its types, rather than the broader definition and helper exports at the root.\n\nStart with `createAtomStore(runtime)` for independent state within an existing reactive runtime, then read and write definitions through the store. Use `defaultAtomStore(runtime)` only when callers should share the default store associated with that runtime.',
        '为可复用的状态定义保存实际值、记录读取关系，并通知订阅者。只需存储构造接口及其类型时选择此子路径；根入口还汇集定义与其他辅助接口。\n\n从 `createAtomStore(runtime)` 开始，在已有响应式运行时中创建独立状态，再通过存储读写定义。只有需要多个调用者共享该运行时关联的默认存储时，才使用 `defaultAtomStore(runtime)`。'
      ),
      example: storeExample
    },
    optics: {
      summary: t(
        'Build custom operations that read or replace a nested value without mutating its parent data. This subpath exposes the low-level path and keyed-array tools that the package root does not export.\n\nStart with `readOpticPath()` to read along a property path and `writeOpticPath()` to return a replacement with copied containers along that path. Keyed-array helpers are also available for custom splitting; these tools do not create an atom store or own reactive state.',
        '编写自定义操作，读取或替换嵌套值，同时不修改原有的父级数据。此子路径公开根入口不导出的底层路径操作和按键处理数组的工具。\n\n从 `readOpticPath()` 沿属性路径读取值，用 `writeOpticPath()` 复制路径上的容器并返回更新结果。自定义数组拆分还可使用按键处理工具；这些接口不创建原子存储，也不持有响应式状态。'
      ),
      example: arrayExample
    },
    'reactive/atom': {
      summary: t(
        'Adapt an existing object to the readable or writable atom protocol, the shape an adapter uses to access one state value. Choose this subpath for that instance protocol; use definitions and an atom store when creating application state.\n\nStart with `atomGetter(runtime)` to read an atom and `atomSetter(runtime)` to forward a write. Both reject atoms from another runtime, and neither constructs a concrete atom implementation.',
        '把已有对象接入可读或可写原子协议；该协议规定适配器如何访问一个状态值。适配实例接口时选择此子路径；创建应用状态则使用定义与原子存储。\n\n从 `atomGetter(runtime)` 读取原子值，用 `atomSetter(runtime)` 转交写入。两者都会拒绝属于其他运行时的原子，且都不创建具体原子实现。'
      ),
      example: protocolExample
    }
  },
  symbols: {
    atomDef: {
      role: 'factory',
      purpose: t(
        'Creates a frozen branded initial-value definition without a Runtime or node. Pair with createAtomStore to read or write it; mutable templates are cloned at store instantiation and function values are data rather than factories.',
        '创建不含运行时或节点的冻结品牌初值定义，搭配 `createAtomStore` 读写，可变模板在存储实例化时复制，函数值作为数据而非工厂。'
      ),
      params: {
        init: t(
          'Application initial value; thenables reject immediately with INVALID_OPTION, while ordinary functions remain values.',
          '应用初始值，承诺式值立即以 `INVALID_OPTION` 拒绝，普通函数仍作为值保存。'
        ),
        debugLabel: createParams.debugLabel
      },
      returns: t(
        'IPrimitiveDefinition token; no resources are acquired until a store materializes it.',
        '返回基础定义令牌，存储实例化前不接纳资源。'
      ),
      example: storeExample
    },
    atomDefFactory: {
      role: 'factory',
      purpose: t(
        'Creates a frozen per-store initializer definition with previewSafe false. Pair with createAtomStore for independent mutable initial state; construction does not execute the callback and unmaterialized preview rejects.',
        '创建预览安全标记为假的冻结每存储初始化定义，搭配 `createAtomStore` 创建独立可变初值，构造不执行回调，未实例化预览会拒绝。'
      ),
      params: createParams,
      returns: t(
        'IPrimitiveFactoryDefinition; callback execution or thenable validation occurs at materialization, with INVALID_OPTION for thenable results.',
        '返回基础工厂定义，实例化时才执行回调或检查承诺式结果，后者使用 `INVALID_OPTION`。'
      ),
      example: definitionMembers.create!.example
    },
    previewSafeAtomDefFactory: {
      role: 'factory',
      purpose: t(
        'Creates the explicitly preview-safe source factory kind. The callback must be pure, deterministic and free of external effects because preview can execute and be abandoned. Pair with createAtomStore for preview or committed state.',
        '创建显式预览安全源工厂，回调必须纯净、确定且无外部副作用，因预览可执行后被放弃，搭配 `createAtomStore` 进行预览或提交状态。'
      ),
      params: createParams,
      returns: t(
        'IPrimitiveFactoryDefinition with previewSafe true; no callback executes during definition construction.',
        '返回预览安全标记为真的基础工厂定义，定义构造期间不执行回调。'
      ),
      example: storeMembers.preview!.example
    },
    derivedDef: {
      role: 'factory',
      purpose: t(
        'Creates a frozen read-only derived token; its callback reads other definitions through the current store getter. Pair with createAtomStore to instantiate scoped dependencies; the definition itself owns no graph.',
        '创建冻结只读派生令牌，回调通过当前存储读取器读取其他定义，搭配 `createAtomStore` 实例化作用域依赖，定义自身不拥有依赖图。'
      ),
      params: {
        read: t(
          'Synchronous IAtomRead receiving store-issued get(definition) and returning T; thrown failures follow owning reactive evaluation.',
          '同步派生读取回调，接收存储签发读取函数并返回值，抛错按所属响应求值处理。'
        ),
        debugLabel: createParams.debugLabel,
        equals: t(
          'Optional synchronous (a, b) => boolean equality check; defaults to reactive Object.is. Return true for equal candidates; throwing follows computation failure.',
          '可选同步双候选相等回调，默认响应对象同值比较，真表示等价，抛错按计算失败处理。'
        )
      },
      returns: t(
        'IDerivedDefinition token for later store reads and subscriptions.',
        '返回供后续存储读取及订阅的只读派生令牌。'
      ),
      example: storeExample
    },
    writableDef: {
      role: 'factory',
      purpose: t(
        'Creates a frozen derived token with independent read type, write argument tuple and write result. Pair with createAtomStore so its writer receives that store get/set and executes inside batch/untracked.',
        '创建读取类型、写参数元组及写结果相互独立的冻结派生令牌，搭配 `createAtomStore` 获得所属存储读写函数并在批处理与不追踪中执行。'
      ),
      params: {
        read: t(
          'Synchronous reader receiving IAtomGet and returning the visible T; reads establish dependencies and failures propagate.',
          '接收存储读取函数并返回可见值的同步读取回调，读取建立依赖，失败传播。'
        ),
        write: t(
          'Synchronous writer receiving IAtomGet, IAtomSet and original Args, returning Result. Thrown failures propagate to store.set and async results are not awaited by the callback boundary.',
          '同步写回调接收存储读写函数及原参数并返回结果，抛错传播给存储写入接口，回调边界不等待异步结果。'
        ),
        debugLabel: createParams.debugLabel,
        equals: t(
          'Optional synchronous equality callback for read candidates, defaulting to reactive Object.is.',
          '可选读取候选值同步相等回调，默认响应对象同值比较。'
        )
      },
      returns: t(
        'IWritableDerivedDefinition preserving T, Args and Result for store.set type checking.',
        '返回保留值、参数及结果类型的可写派生定义，供存储写入类型检查。'
      ),
      example: storeExample
    },
    isAtomDefinition: {
      role: 'operation',
      purpose: t(
        'Checks that a value is a nonnull object with the shared definition brand. This recognizes duplicate package copies only within one realm; it provides no worker/realm transport protocol and does not deep-validate fields.',
        '检查值为非空对象且含共享定义品牌，仅支持同领域重复包副本互认，不提供工作线程或跨领域传输协议，也不深校验字段。'
      ),
      params: {
        value: t(
          'Unknown candidate supplied by application or adapter code.',
          '应用或适配代码提供的未知候选值。'
        )
      },
      returns: t(
        'Boolean type guard; a brand getter or proxy reflection failure returns false rather than throwing.',
        '返回布尔类型守卫；品牌访问器或代理反射失败时返回假，不向外抛出。'
      ),
      example: `import { atomDef, isAtomDefinition } from '@migaia/store-keyed'
console.log(isAtomDefinition(atomDef(1)), isAtomDefinition(1))`
    },
    assertNotThenable: {
      role: 'operation',
      purpose: t(
        'Rejects Promise-like values at synchronous initial-state boundaries, including failures while reading a then property. It does not execute an admitted thenable.',
        '在同步初始状态边界拒绝承诺式值，也处理读取承诺属性时失败，不执行被检查的承诺式值。'
      ),
      params: {
        value: t(
          'Initial value or factory result supplied by the caller.',
          '调用者提供的初值或工厂返回值。'
        ),
        context: t(
          'Application diagnostic label identifying the construction or initialization call site.',
          '应用提供、标识构造或初始化调用位置的诊断标签。'
        )
      },
      returns: t(
        'Returns normally for a nonthenable; throws TypeError with INVALID_OPTION, preserving a property-access failure as cause when present.',
        '非承诺式值正常返回，否则抛带 `INVALID_OPTION` 的类型错误，存在属性访问失败时保留为原因。'
      ),
      example: `import { assertNotThenable } from '@migaia/store-keyed/atom/definition'
assertNotThenable({ count: 1 }, 'initial state')`
    },
    createAtomStore: {
      role: 'factory',
      purpose: t(
        'Creates a store: a scope that keeps its own value for every definition it reads. Definitions (`atomDef`, `derivedDef`, ...) hold no value, so the same definitions give separate values in each store, for example one store per server request or per test. A value is created the first time its definition is read and kept until `release(definition)` or `dispose()`.',
        '创建一个 store：为它读到的每个定义各保存一份值的作用域。定义（`atomDef`、`derivedDef` 等）本身不保存值，所以同一批定义在每个 store 里各有一份值，例如每个服务端请求或每个测试用一个 store。某个定义第一次被读取时才创建它的值，一直保留到 `release(definition)` 或 `dispose()`。'
      ),
      params: {
        runtime: t(
          'IRuntime returned by @migaia/reactive createRuntime; it owns dependency graphs, batching, idle cleanup and error reporting.',
          '由响应包运行时工厂返回的运行时，拥有依赖图、批处理、空闲清理及错误报告。'
        )
      },
      returns: t(
        'Caller-owned IAtomStore; dispose it to release its subscriptions and instantiated graph nodes.',
        '返回调用者拥有的原子存储，销毁以释放订阅与已实例化图节点。'
      ),
      example: storeExample,
      cases: storeKeyedCases.createAtomStore
    },
    defaultAtomStore: {
      role: 'factory',
      purpose: t(
        'Returns the current live default store associated with one Runtime, creating a replacement after the prior default was disposed. Use createAtomStore for independent state scopes rather than sharing this default.',
        '返回单个运行时关联的当前存活默认存储，旧默认存储销毁后创建替代，独立状态作用域应使用创建存储而非共享默认。'
      ),
      params: {
        runtime: t(
          'Runtime identity from createRuntime, used as the default-store WeakMap key.',
          '运行时工厂返回的身份，作为默认存储弱映射的键。'
        )
      },
      returns: t(
        'Same live IAtomStore for repeated calls with that Runtime; a disposed default is replaced.',
        '同运行时重复调用返回同一存活存储，已销毁默认存储会被替换。'
      ),
      example: `import { createRuntime } from '@migaia/reactive'
import { defaultAtomStore } from '@migaia/store-keyed/atom/store'
const runtime = createRuntime()
const store = defaultAtomStore(runtime)
console.log(defaultAtomStore(runtime) === store)
store.dispose()`
    },
    selectDef: {
      role: 'factory',
      purpose: t(
        'Builds a read-only projection with a synchronous selection function and equality policy. Pair with createAtomStore to observe only selected-value changes; unchanged selected values do not notify downstream observers.',
        '使用同步选择函数及相等策略构造只读投影，搭配 `createAtomStore` 仅观察选中值变化，选中值不变时不通知下游。'
      ),
      params: {
        source: definitionParam,
        select: t(
          'Synchronous callback receiving the current source value and returning Selected; errors propagate during derived evaluation.',
          '同步接收当前源值并返回选中值的回调，错误在派生求值期间传播。'
        ),
        equals: t(
          'Synchronous selected-value comparison receiving left and right; return true for equal values. Defaults to Object.is; throws follow derived evaluation.',
          '同步接收左右选中值的比较，真表示等价，默认对象同值比较，抛错按派生求值处理。'
        )
      },
      returns: t(
        'IDerivedDefinition<Selected> retaining the source as a store-resolved dependency.',
        '返回选中值只读派生定义，源作为经存储解析的依赖。'
      ),
      example: opticsExample
    },
    opticDef: {
      role: 'factory',
      purpose: t(
        'Creates a writable projection using a caller-owned immutable lens. Pair with createAtomStore for reads and updates; equal focus updates skip a source write, otherwise the lens returns a replacement source.',
        '使用调用者不可变透镜创建可写投影，搭配 `createAtomStore` 读写，相同焦点更新跳过源写入，否则透镜返回替代源值。'
      ),
      params: {
        source: t(
          'IStandardWritableDef created by a source or standard-update writable definition; it must support one value-or-updater argument.',
          '源构造函数或标准更新可写定义提供的标准写入定义，接受单个新值或更新回调参数。'
        ),
        optic: t(
          'IDefOptic with synchronous get(source) returning focus and set(source, focus) returning a new source; throws propagate and async lenses are not awaited.',
          '包含同步取焦点及以源和焦点返回新源的透镜，抛错传播且不等待异步透镜。'
        )
      },
      returns: t(
        'Writable-derived focus token with one IAtomUpdate<Focus> argument and void write result.',
        '返回接受一个焦点更新参数、写入无返回值的可写派生令牌。'
      ),
      example: opticsExample
    },
    focusDef: {
      role: 'factory',
      purpose: t(
        'Defines one field of a writable definition, one to three keys deep. Reading it subscribes only to that field, so readers are not notified when other fields change; writing it produces a new source object with the field replaced, without hand-written immutable updates. A missing intermediate object throws instead of returning `undefined`.',
        '定义一个可写定义里的某个字段，路径一到三层。读取它只订阅这个字段，其他字段变化时读取方不会收到通知；写入它会生成替换了该字段的新源对象，不用手写不可变更新。路径中间的对象不存在时会抛错，而不是返回 `undefined`。'
      ),
      params: {
        source: t(
          'Standard-update writable source definition produced by this package.',
          '当前包产生、支持标准更新语义的可写源定义。'
        ),
        key1: t(
          'Required first property key from the source value type.',
          '源值类型中的必填第一层属性键。'
        ),
        key2: t(
          'Optional second key in the two- or three-segment overload; obtained from the first property type.',
          '两层或三层重载的第二个键，取自第一层属性类型，不选择该重载时省略。'
        ),
        key3: t(
          'Third key only for the three-segment overload, obtained from the second property type.',
          '仅三层重载使用的第三个键，取自第二层属性类型。'
        )
      },
      returns: t(
        'Writable-derived focused token. Empty runtime paths or inaccessible segments use INVALID_OPTION; unclassified accessor failures use OPTIC_ACCESS_FAILED, retaining original native identity or cause, while existing foreign identities stay unchanged.',
        '返回焦点可写派生令牌，运行时空路径或不可达段使用 `INVALID_OPTION`，未分类访问器失败使用 `OPTIC_ACCESS_FAILED`，保留原生身份或原始原因，已有外包身份不变。'
      ),
      example: opticsExample,
      cases: storeKeyedCases.focusDef
    },
    splitDef: {
      role: 'factory',
      purpose: t(
        'Splits a writable array definition into one writable definition per key (`of(key)`) plus `items`, the list of those definitions in current order. Each row can read and write its own item and is notified only when that item changes; reordering keeps the same definition for the same key. Create it once at module level, not inside a derived callback.',
        '把一个可写数组定义按 key 拆成逐项的可写定义（`of(key)`），另有 `items` 按当前顺序列出这些定义。每一行只读写自己那一项，只在这一项变化时收到通知；重新排序时同一个 key 仍是同一个定义。在模块顶层创建一次，不要放在派生回调里创建。'
      ),
      params: {
        source: t(
          'Standard writable readonly-array definition, commonly atomDef<readonly T[]>(initial).',
          '支持标准写入的只读数组定义，通常由基础数组定义工厂产生。'
        ),
        keyOf: t(
          'Optional synchronous (item, index) key extractor, defaulting to source index. Return a stable application key and let errors propagate; duplicate keys reject list evaluation.',
          '可选同步条目及索引取键回调，默认源下标，返回稳定应用键且错误传播，重复键会拒绝列表求值。'
        )
      },
      returns: t(
        'ISplitDefinition with cached of(key), derived items and insert/remove/prune operations. Missing item access or duplicate keys use INVALID_OPTION; prune does not release store instances.',
        '返回含缓存逐键定义、派生条目及插入删除裁剪操作的拆分对象，缺失条目访问或重复键使用 `INVALID_OPTION`，裁剪不释放存储实例。'
      ),
      example: opticsExample,
      cases: storeKeyedCases.splitDef
    },
    familyDef: {
      role: 'factory',
      purpose: t(
        'Creates a function from key to source definition, for state per chat, channel or document id. The same key always returns the same definition, and each store keeps its own value for it. At most `maxSize` definitions are held strongly; older ones are held weakly and still found while something uses them. `forget(key)` drops a key without releasing values already created in stores.',
        '创建一个“key → 源定义”的函数，用于每个对话、频道或文档 id 各一份状态。同一个 key 永远返回同一个定义，每个 store 为它保存自己的值。最多强引用 `maxSize` 个定义，更早的改为弱引用，只要还有地方在用就仍能找到。`forget(key)` 删除一个 key，但不会释放 store 里已经创建的值。'
      ),
      params: {
        initial: t(
          'Synchronous callback receiving the application family key at store initialization and returning a nonthenable value. It is deferred in atomDefFactory, not executed on token lookup; throws propagate at initialization.',
          '同步初始化回调，在存储初始化时接收应用族键并返回非承诺式值，延迟到源工厂执行而非令牌查找执行，抛错在初始化时传播。'
        )
      },
      options: 'IFamilyDefOptions',
      returns: t(
        'IFamilyDef callable: family(key) returns a writable source-factory token with previewSafe false; size/forget/clear control token caches. Missing WeakRef or FinalizationRegistry uses ENV_UNSUPPORTED.',
        '返回可调用族，传键取得预览不安全可写源工厂令牌，大小、遗忘及清空控制令牌缓存，缺少弱引用或终结注册能力使用 `ENV_UNSUPPORTED`。'
      ),
      example: familyExample,
      cases: storeKeyedCases.familyDef
    },
    derivedFamilyDef: {
      role: 'factory',
      purpose: t(
        'Creates a callable keyed family of read-only derived tokens. The outer callback chooses a per-key reader at token creation and the inner reader resolves dependencies in its current store. Pair with familyDef for keyed source-derived state.',
        '创建可调用只读派生令牌族，外层回调在令牌创建时选择逐键读取器，内层在当前存储解析依赖，搭配 `familyDef` 构成逐键源与派生状态。'
      ),
      params: {
        read: t(
          'Synchronous outer callback (key) => reader; reader(get) returns T using the store-issued IAtomGet. Outer throws abort token creation, inner throws follow derived evaluation; async readers are not awaited.',
          '同步外层回调按键返回读取器，内层接收存储读取函数并返回值，外层抛错终止令牌创建，内层抛错按派生求值处理，不等待异步读取器。'
        )
      },
      options: 'IFamilyDefOptions',
      returns: t(
        'IFamilyDef callable returning read-only tokens; default debugLabel is derived-family rather than family. Cache options and host capability errors match familyDef.',
        '返回只读令牌的可调用族，默认标签为派生族而非源族，缓存选项与宿主能力失败同源族。'
      ),
      example: familyExample
    },
    readOpticPath: {
      role: 'operation',
      purpose: t(
        'Reads a property-key path with native Reflect.get semantics. Empty paths return the original value; inaccessible intermediate containers reject with a coded TypeError and supplied diagnostic label.',
        '按原生反射读取语义读取属性键路径，空路径返回原值，不可达中间容器以带码类型错误及提供标签拒绝。'
      ),
      params: {
        value: t('Application root object or array to traverse.', '待遍历的应用根对象或数组。'),
        path: t(
          'Ordered caller-provided string, number or symbol property keys.',
          '调用者提供的有序字符串、数字或符号属性键。'
        ),
        label: t(
          'Application diagnostic prefix used in inaccessible-segment messages.',
          '不可达段消息使用的应用诊断前缀。'
        )
      },
      returns: t(
        'Value at the path, or original root for an empty path. Invalid intermediate containers use INVALID_OPTION; unclassified accessor failures use OPTIC_ACCESS_FAILED while existing foreign identities remain unchanged. Mutable native errors retain identity/type/stack; fallback cause/errors retain the original.',
        '返回路径值，空路径返回原根，不可达中间容器使用 `INVALID_OPTION`，未分类访问失败使用 `OPTIC_ACCESS_FAILED`，外包已有身份保持不变；可修改原生错误保留身份、类型与堆栈，回退通过原因或错误列表保留原值。'
      ),
      example: `import { readOpticPath, writeOpticPath } from '@migaia/store-keyed/optics'
const source = { a: { b: 1 } }
console.log(readOpticPath(source, ['a', 'b'], 'field'))
console.log(writeOpticPath(source, ['a', 'b'], 2, 'field'))`
    },
    writeOpticPath: {
      role: 'operation',
      purpose: t(
        'Immutably replaces one nested path through shallow container copies; __proto__ is defined as an own data field. This low-level helper does not validate path length; focusDef performs its own nonempty check.',
        '通过浅复制沿途容器不可变替换嵌套路径，原型特殊键定义为自有数据字段，底层辅助函数不校验路径长度，焦点工厂自行检查非空。'
      ),
      params: {
        value: t(
          'Application root object or array whose path is copied.',
          '需要沿路径复制的应用根对象或数组。'
        ),
        path: t(
          'Explicit ordered property-key path supplied by the caller; normal use includes at least one segment.',
          '调用者提供的显式有序属性路径，常规用法至少包含一个段。'
        ),
        next: t(
          'Replacement value supplied by the caller for the final path segment.',
          '调用者提供、用于最终路径段的替代值。'
        ),
        label: t(
          'Caller diagnostic prefix for inaccessible write segments.',
          '调用者提供、标识不可达写段的诊断前缀。'
        )
      },
      returns: t(
        'New root with copied containers along the path. Invalid containers use INVALID_OPTION; unclassified accessor or native copy failures use OPTIC_ACCESS_FAILED while preserving mutable native errors or retaining the original through cause/errors; foreign identities stay unchanged.',
        '返回沿路径复制容器的新根，不合法容器使用 `INVALID_OPTION`，未分类访问器或原生复制失败使用 `OPTIC_ACCESS_FAILED` 并保留可修改原生错误，或经原因与错误列表保留原值；外包已有身份不变。'
      ),
      example: `import { writeOpticPath } from '@migaia/store-keyed/optics'
const source = { a: { b: 1 } }
console.log(writeOpticPath(source, ['a', 'b'], 2, 'field'), source)`
    },
    computeUniqueKeys: {
      role: 'operation',
      purpose: t(
        'Computes source keys synchronously and rejects duplicates using Set membership. The returned key array is frozen; source items are unchanged.',
        '同步计算源键并使用集合成员规则拒绝重复，返回键数组被冻结，源条目不变。'
      ),
      params: {
        items: t('Application source array in its current order.', '按当前顺序排列的应用源数组。'),
        keyOf: keyOfParam,
        label: t(
          'Application label used when duplicate keys produce INVALID_OPTION; the implementation adds [store], so do not repeat that prefix.',
          '重复键产生选项错误时使用的应用标签；实现会添加 `[store]` 前缀，调用方不要重复。'
        )
      },
      returns: t(
        'Frozen readonly key array, or Error with INVALID_OPTION for a duplicate key; extractor exceptions propagate.',
        '返回冻结只读键数组，重复键抛带 `INVALID_OPTION` 的错误，取键回调异常传播。'
      ),
      example: arrayExample
    },
    findKeyIndex: {
      role: 'operation',
      purpose: t(
        'Linearly finds the first matching extracted key using SameValueZero equality, so signed zeros share one key and NaN matches itself; does not allocate or mutate the input array.',
        '按原生映射与集合的键等价规则线性查找首个匹配提取键，正负零共享一键且非数值与自身匹配，不分配或修改输入数组。'
      ),
      params: {
        items: t(
          'Application array whose current item order defines indices.',
          '当前条目顺序决定下标的应用数组。'
        ),
        keyOf: keyOfParam,
        key: keyParam
      },
      returns: t(
        'First matching zero-based index, or minus one if absent; extractor throws propagate unchanged.',
        '返回首个匹配零起始下标，缺失时返回负一，取键回调抛错原样传播。'
      ),
      example: arrayExample
    },
    requireKeyIndex: {
      role: 'operation',
      purpose: t(
        'Resolves the same first SameValueZero key match as findKeyIndex but makes a missing item a coded error.',
        '解析与 `findKeyIndex` 相同的首个键等价匹配，但把条目缺失转为带码错误。'
      ),
      params: {
        items: t('Application source array to search.', '需要查找的应用源数组。'),
        keyOf: keyOfParam,
        key: keyParam,
        label: t(
          'Caller-owned message used when the target key is absent; the implementation adds [store], so omit that prefix from this value.',
          '目标键缺失时使用的调用者消息；实现添加 `[store]` 前缀，传入值不要重复包含它。'
        )
      },
      returns: t(
        'Matching zero-based index; missing keys throw Error with INVALID_OPTION and the supplied label.',
        '返回匹配零起始下标，键缺失抛带 `INVALID_OPTION` 与提供标签的错误。'
      ),
      example: arrayExample
    },
    shallowArrayEquals: {
      role: 'operation',
      purpose: t(
        'Compares equal lengths and applies Object.is through native left.every for each present left index; nested objects are compared by identity.',
        '比较相同长度，并经左数组原生逐项判断对各已存在下标使用对象同值比较，嵌套对象按身份比较。'
      ),
      params: {
        left: t(
          'First application array whose present entries drive native every traversal.',
          '第一个应用数组，其已存在条目驱动原生遍历。'
        ),
        right: t(
          'Second application array compared at matching indices.',
          '在相同下标被比较的第二个应用数组。'
        )
      },
      returns: t(
        'Boolean shallow comparison result; no elements are cloned.',
        '返回浅比较布尔结果，不复制元素。'
      ),
      example: arrayExample
    },
    spliceInsert: {
      role: 'operation',
      purpose: t(
        'Shallow-copies a list and inserts one item with a clamped native splice index, returning a frozen new array.',
        '浅复制列表并按钳制后的原生插入下标插入条目，返回冻结新数组。'
      ),
      params: {
        list: t('Application source list retained unchanged.', '保持不变的应用源列表。'),
        item: t(
          'Application item reference to insert without cloning.',
          '应用提供、不经复制而插入的条目引用。'
        ),
        index: t(
          'Caller index clamped to zero through list length; Infinity appends and native splice applies integer conversion.',
          '调用者下标钳制在零至列表长度间，无穷大追加，原生插入执行整数转换。'
        )
      },
      returns: t(
        'New frozen readonly array; original item references are retained.',
        '返回冻结只读新数组，保留原条目引用。'
      ),
      example: arrayExample
    },
    filterOutKey: {
      role: 'operation',
      purpose: t(
        'Filters out every item whose extracted key SameValueZero-matches the requested key, including signed-zero equivalence. A missing key preserves the original array identity.',
        '过滤掉全部提取键与请求键等价匹配的条目，正负零共享一键，缺失键保留原数组身份。'
      ),
      params: {
        list: t('Application list to filter without mutating.', '需要不变式过滤的应用列表。'),
        keyOf: keyOfParam,
        key: keyParam
      },
      returns: t(
        '{ removed, next }: true plus a frozen filtered array if any match existed; otherwise false and the original list reference.',
        '返回移除标记及后继列表，有匹配时为真及冻结过滤数组，无匹配时为假及原列表引用。'
      ),
      example: arrayExample
    },
    replaceAtIndex: {
      role: 'operation',
      purpose: t(
        'Shallow-copies a list, applies native indexed assignment and freezes the result. It does not validate or clamp the index; keyed optics pass a resolved existing index.',
        '浅复制列表后按原生下标赋值并冻结结果，不校验或钳制下标，键光学操作传入已解析现存下标。'
      ),
      params: {
        list: t('Application list to copy without mutation.', '需要不变式复制的应用列表。'),
        index: t(
          'Caller-selected array index, normally returned by requireKeyIndex.',
          '调用者选择的数组下标，通常来自必需键下标查找。'
        ),
        value: t(
          'Application replacement item reference assigned at the index.',
          '应用提供、赋到该下标的替代条目引用。'
        )
      },
      returns: t(
        'New frozen array using native index-assignment semantics and shared remaining item references.',
        '返回按原生下标赋值语义生成的新冻结数组，其他条目保留引用。'
      ),
      example: arrayExample
    },
    KeyedSplitCache: {
      role: 'factory',
      purpose: t(
        'Constructs an empty keyed get-or-create cache used by split definitions. Constructor takes no arguments and owns no disposer. Truthy cached items are reused; a falsy cached value causes of() to invoke its creator again.',
        '无参数构造拆分定义使用的空逐键取或建缓存，不拥有清理器，真值缓存项复用，假值缓存项会使取或建方法再次调用创建回调。'
      ),
      returns: t(
        'New empty KeyedSplitCache with strong key/item retention until prune or clear. Cache removal never disposes items automatically; provide prune onEvict when the caller owns item cleanup.',
        '返回强保留键及项目的新空缓存，直至裁剪或清空，移除不会自动销毁项目，调用者拥有项目清理时应提供裁剪淘汰回调。'
      ),
      example: cacheExample
    },
    atomGetter: {
      role: 'factory',
      purpose: t(
        'Creates a function bound to one Runtime, validating the protocol atom runtime before reading atom.value. It provides no atom implementation and allocates no graph nodes.',
        '创建绑定单个运行时的读取函数，在读协议原子值前校验所属运行时，不提供原子实现也不分配图节点。'
      ),
      params: {
        runtime: t(
          'External IRuntime from the atom implementation, normally returned by createRuntime.',
          '来自原子实现、通常由运行时工厂创建的外包运行时。'
        )
      },
      returns: t(
        'IAtomGetter: get(atom) synchronously returns its current value; mismatched runtime throws CROSS_RUNTIME and atom getter failures propagate.',
        '返回读取函数，同步接收协议原子并返回当前值，运行时不匹配抛 `CROSS_RUNTIME`，原子访问器失败传播。'
      ),
      example: protocolExample
    },
    atomSetter: {
      role: 'factory',
      purpose: t(
        'Creates a function bound to one Runtime, validating protocol atom ownership before forwarding exact write arguments. State and lifecycle remain owned by the supplied atom implementation.',
        '创建绑定单个运行时的写函数，在转发精确写参数前校验协议原子所有权，状态及生命周期仍归提供的原子实现。'
      ),
      params: {
        runtime: t(
          'External IRuntime shared with the protocol atom implementation.',
          '与协议原子实现共享的外包运行时。'
        )
      },
      returns: t(
        'IAtomSetter: set(atom, ...args) returns the exact write Result; mismatch uses CROSS_RUNTIME and original write failures propagate.',
        '返回写函数，接收原子及参数并返回精确写结果，不匹配使用 `CROSS_RUNTIME`，原写入失败传播。'
      ),
      example: protocolExample
    },
    ...Object.fromEntries(
      [
        ['createStoreKeyedError', 'Error'],
        ['createStoreKeyedTypeError', 'TypeError'],
        ['createStoreKeyedRangeError', 'RangeError']
      ].map(([name, native]) => [
        name!,
        {
          role: 'operation' as const,
          purpose: t(
            `Creates a native ${native} carrying STORE_KEYED_SOURCE and the chosen semantic code, preserving its native runtime type, stack and optional original cause.`,
            `创建带规范存储来源及所选语义码的原生 \`${native}\`，保留原生运行时类型、堆栈及可选原始原因。`
          ),
          params: {
            code: t(
              'Code chosen from StoreKeyedErrorCode for the current failure.',
              '从规范存储错误码表选择、对应当前失败的错误码。'
            ),
            message: t(
              'Caller-owned diagnostic text describing the concrete failure.',
              '调用者拥有、描述具体失败的诊断文本。'
            )
          },
          optionDocs: causeOptions,
          optionCases: errorOptionCases(name!, native!),
          returns: t(
            `A tagged native ${native}; the caller chooses whether to throw it.`,
            `返回已标记原生 \`${native}\`，由调用者决定是否抛出。`
          ),
          example: `import { ${name}, StoreKeyedErrorCode } from '@migaia/store-keyed'
console.log(${name}(StoreKeyedErrorCode.invalidOption, 'invalid input'))`
        }
      ])
    ),
    createStoreKeyedAggregateError: {
      role: 'operation',
      purpose: t(
        'Constructs a native AggregateError tagged with package source and code, retaining original failures in errors. It does not add a separate cause or replace member errors.',
        '构造带包来源及码的原生聚合错误，经错误列表保留原始失败，不新增单独原因或替换成员错误。'
      ),
      params: {
        code: t(
          'Code chosen from StoreKeyedErrorCode, normally disposalFailed for grouped cleanup failure.',
          '从存储错误码表选择的码，分组清理失败通常使用销毁失败。'
        ),
        errors: t(
          'Caller-supplied original failures retained by native AggregateError.errors.',
          '调用者提供、由原生聚合错误列表保留的原始失败。'
        ),
        message: t(
          'Caller-owned message describing the grouped failure.',
          '调用者拥有、描述分组失败的消息。'
        )
      },
      returns: t(
        'Native AggregateError whose errors list retains the supplied original failure values.',
        '返回错误列表保留提供的原始失败值的原生聚合错误。'
      ),
      example: `import { createStoreKeyedAggregateError, StoreKeyedErrorCode } from '@migaia/store-keyed'
const cause = new Error('cleanup failed')
console.log(createStoreKeyedAggregateError(StoreKeyedErrorCode.disposalFailed, [cause], 'disposal failed').errors[0] === cause)`
    },
    STORE_KEYED_SOURCE: {
      role: 'error',
      purpose: t(
        'Canonical @migaia/store-keyed error source string; classify package failures with this source and StoreKeyedErrorCode rather than message prefixes.',
        '规范键存储错误来源字符串，与语义错误码一起分类包失败，不依赖消息前缀。'
      ),
      example: `import { STORE_KEYED_SOURCE, StoreKeyedErrorCode } from '@migaia/store-keyed'
console.log(STORE_KEYED_SOURCE, StoreKeyedErrorCode.invalidOption)`
    },
    StoreKeyedErrorCode: {
      role: 'error',
      purpose: t(
        'Stable package semantic codes for scoped stores, previews, overrides, runtime access, optic access, environment capability and input validation. Native errors preserve original runtime classes and causes.',
        '提供作用域存储、预览、覆盖、跨运行时、光学访问、环境能力及输入校验的稳定包语义码，原生错误保留运行时类型及原因。'
      ),
      example: `import { StoreKeyedErrorCode } from '@migaia/store-keyed'
console.log(StoreKeyedErrorCode.previewUnsafe)`
    },
    AtomKind: {
      role: 'constant',
      purpose: t(
        'Discriminates pure definition token kinds so AtomStore can select source cloning, per-store initialization, derived computation or custom writing. Kind values allocate no state by themselves. The object is statically readonly through as const, not frozen at runtime.',
        '区分纯定义令牌种类，让原子存储选择源复制、每存储初始化、派生计算或自定义写入，种类值自身不分配状态；常量仅在类型上只读，运行时并未冻结。'
      ),
      example: `import { AtomKind, atomDef } from '@migaia/store-keyed'
console.log(atomDef(1).kind === AtomKind.primitive)`
    }
  },
  types: {
    IAtomDefinition: definitionType(
      t(
        'Readable union of all four branded pure definition kinds; writable argument types are erased on this read-only boundary.',
        '四种品牌纯定义的可读联合，当前读取边界擦除可写参数类型。'
      ),
      ['kind', 'debugLabel', 'init', 'create', 'previewSafe', 'read', 'write', 'equals']
    ),
    IWritableAtomDefinition: definitionType(
      t(
        'Writable union of primitive, factory and writable-derived tokens; default source writes accept one value-or-updater argument and return void.',
        '基础、工厂及可写派生令牌的可写联合，默认源写入接受一个新值或更新回调并无返回值。'
      ),
      ['kind', 'debugLabel', 'init', 'create', 'previewSafe', 'read', 'write', 'equals']
    ),
    IPrimitiveDefinition: definitionType(
      t(
        'Frozen branded source template from atomDef; scoped stores clone mutable templates and retain their own signal.',
        '基础工厂返回的冻结品牌源模板，作用域存储复制可变模板并保留自身信号。'
      ),
      ['kind', 'debugLabel', 'init']
    ),
    IPrimitiveFactoryDefinition: definitionType(
      t(
        'Frozen branded per-store initialization token; callback and explicit preview safety determine how speculative and committed values are created.',
        '冻结品牌每存储初始化令牌，回调及显式预览安全决定推测与提交值如何创建。'
      ),
      ['kind', 'debugLabel', 'create', 'previewSafe'],
      definitionMembers.create!.example as string
    ),
    IDerivedDefinition: definitionType(
      t(
        'Frozen read-only token whose synchronous reader resolves dependencies through the active AtomStore.',
        '冻结只读令牌，其同步读取器经活动存储解析依赖。'
      ),
      ['kind', 'debugLabel', 'read', 'equals']
    ),
    IWritableDerivedDefinition: definitionType(
      t(
        'Frozen token combining a synchronous visible reader and a caller-defined writer with exact Args and Result types.',
        '组合同步可见读取器及精确参数结果调用者写回调的冻结令牌。'
      ),
      ['kind', 'debugLabel', 'read', 'write', 'equals']
    ),
    ISplitItemDef: standardDefinitionType(
      t(
        'Alias of a writable-derived item token with standard value-or-updater writes and void result; tied to the source key rather than a fixed list position.',
        '标准新值或更新回调写入、无返回值的可写派生条目令牌别名，绑定源键而非固定列表位置。'
      ),
      ['kind', 'debugLabel', 'read', 'write', 'equals']
    ),
    IStandardWritableDef: standardDefinitionType(
      t(
        'Writable definition restricted to one standard IAtomUpdate argument and void result, as required by immutable focus and split operations.',
        '限制为一个标准更新参数及无返回值的可写定义，供不可变焦点及拆分操作使用。'
      ),
      ['kind', 'debugLabel', 'init', 'create', 'previewSafe', 'read', 'write', 'equals']
    ),
    IAtomStore: {
      summary: t(
        'A store returned by `createAtomStore` or `defaultAtomStore`: it keeps one value per definition, and its caller decides when to dispose it.',
        '由 `createAtomStore` 或 `defaultAtomStore` 返回的 store：为每个定义保存一份值，何时释放由调用方决定。'
      ),
      scenarios: [
        t(
          'Reuse definitions across independent component or server-request scopes without sharing mutable initial values.',
          '跨独立组件或服务请求作用域复用定义，不共享可变初值。'
        )
      ],
      example: storeExample,
      members: storeMembers
    },
    IDefOptic: {
      summary: t(
        'Caller-owned synchronous immutable lens; get extracts a focus and set constructs replacement source data rather than mutating the original.',
        '调用者拥有的同步不可变透镜，读取提取焦点，写入构造替代源而非修改原值。'
      ),
      example: opticsExample,
      members: {
        get: {
          summary: t(
            'Reads a focus from one source supplied by opticDef evaluation or writing.',
            '从光学定义求值或写入提供的源读取焦点。'
          ),
          params: {
            source: t(
              'Current scoped source value from the owning AtomStore.',
              '所属存储提供的当前作用域源值。'
            )
          },
          returns: t(
            'Focus synchronously; throws propagate through the owning read or write.',
            '同步返回焦点，抛错经所属读写传播。'
          ),
          example: opticsExample
        },
        set: {
          summary: t(
            'Constructs a replacement source containing the supplied focus, preserving immutable source ownership.',
            '构造包含给定焦点的替代源，保留不可变源所有权。'
          ),
          params: {
            source: t(
              'Current source supplied after reading through the owning store.',
              '经所属存储读取的当前源值。'
            ),
            focus: t(
              'Next focused value after applying a caller value or update callback.',
              '应用调用者新值或更新回调后取得的下一个焦点值。'
            )
          },
          returns: t(
            'Replacement Source; async setters are not awaited and thrown failures propagate.',
            '返回替代源，不等待异步写入器，抛错传播。'
          ),
          example: opticsExample
        }
      }
    },
    ISplitDefinition: {
      summary: t(
        'Source definition, derived item-token list and explicit keyed list operations returned by splitDef; owns token cache only, while store owns graph instances.',
        '拆分工厂返回的源定义、派生条目令牌列表及显式键列表操作，仅拥有令牌缓存，图实例归存储拥有。'
      ),
      scenarios: [
        t(
          'Keep per-row subscriptions stable while list items reorder or source arrays are replaced.',
          '列表条目重排或源数组替换时保持逐行订阅稳定。'
        )
      ],
      example: opticsExample,
      members: {
        source: f(
          'Exact standard-writable array source supplied to splitDef.',
          '传给拆分工厂的精确标准可写数组源。'
        ),
        items: f(
          'Derived definition yielding a frozen array of cached item definitions; duplicate source keys reject and shallow token-array equality suppresses unchanged lists.',
          '产生冻结缓存条目定义数组的派生定义，重复源键拒绝，浅令牌数组比较抑制未变列表。'
        ),
        of: {
          summary: t(
            'Gets or creates a stable writable token for an application key without checking whether the source currently contains it.',
            '按应用键取得或创建稳定可写令牌，不检查当前源是否包含该键。'
          ),
          params: { key: keyParam },
          returns: t(
            'ISplitItemDef for that key; later read/write of a missing source item rejects INVALID_OPTION.',
            '返回当前键的拆分条目定义，后续读写缺失源条目以 `INVALID_OPTION` 拒绝。'
          ),
          example: opticsExample
        },
        insert: {
          summary: t(
            'Writes a shallow immutable source array containing the new item through the supplied store.',
            '经给定存储写入包含新条目的浅不可变源数组。'
          ),
          params: {
            store: t(
              'AtomStore created by createAtomStore or defaultAtomStore for this state scope.',
              '当前状态作用域的存储，由公开存储工厂取得。'
            ),
            item: t(
              'Application item whose key comes from this split keyOf callback.',
              '应用条目，其键取自当前拆分取键回调。'
            ),
            index: t(
              'Optional insertion position, default Infinity to append; clamped to zero through current length.',
              '可选插入位置，默认无穷大追加，钳制在零至当前长度间。'
            )
          },
          returns: t(
            'No result; source state is updated and store subscriptions observe normal reactive change.',
            '无返回值，源状态已更新，存储订阅观察普通响应变更。'
          ),
          example: opticsExample
        },
        remove: {
          summary: t(
            'Filters matching keys from the source through the supplied store, preserving source reference when absent.',
            '经给定存储从源中过滤匹配键，缺失时保留源引用。'
          ),
          params: {
            store: t('Store for the scoped source state.', '拥有作用域源状态的存储。'),
            key: keyParam
          },
          returns: t(
            'True if any matching item was removed, false otherwise; duplicate matches are all removed by the shared helper.',
            '移除任何匹配条目时返回真，否则为假，共享辅助函数会移除全部重复匹配。'
          ),
          example: opticsExample
        },
        prune: {
          summary: t(
            'Drops cached item tokens whose key no longer appears in the current store source list. It does not release their already instantiated store nodes.',
            '删除当前存储源列表不再出现键的缓存条目令牌，不释放其已有存储实例节点。'
          ),
          params: {
            store: t(
              'Store whose current source value determines live keys.',
              '其当前源值决定存活键的存储。'
            )
          },
          returns: t(
            'Number of token cache entries removed; store instance count is unchanged by this operation alone.',
            '返回移除令牌缓存条目数量，仅此操作不会改变存储实例数。'
          ),
          example: opticsExample
        }
      }
    },
    IFamilyDef: {
      summary: t(
        'Callable family(key) returning a pure definition from familyDef or derivedFamilyDef. Keys are application string, number or symbol values; same live canonical token is reused until explicit forgetting or collection.',
        '源族或派生族返回的可调用值，按应用字符串、数字或符号键返回纯定义，显式遗忘或回收前复用同一存活规范令牌。'
      ),
      scenarios: [
        t(
          'Allocate conversation or entity definitions lazily without sharing their store state.',
          '惰性分配会话或实体定义而不共享其存储状态。'
        )
      ],
      example: familyExample,
      members: familyMembers
    },
    IFamilyDefOptions: {
      summary: t(
        'Construction settings for both definition-family factories; only bounded strong retention and diagnostic naming are configured.',
        '两种定义族工厂的构造设置，仅配置有界强保留及诊断命名。'
      ),
      example: familyExample,
      optionCases: familyOptionCases,
      members: {
        maxSize: f(
          'Positive safe integer maximum number of strongly retained recent tokens; live weak canonical tokens can still be reused after LRU eviction.',
          '强保留最近令牌数量的正安全整数上限，最近使用淘汰后仍可复用存活弱规范令牌。',
          '4096 strong entries for either family factory.',
          '两种族工厂默认强保留四千零九十六条。'
        ),
        debugLabel: f(
          'Application string prefix for generated token labels, followed by the stringified key in brackets.',
          '应用提供的生成令牌标签字符串前缀，后接括号内字符串化键。',
          'family for source families; derived-family for derived families.',
          '源族默认 `family`，派生族默认 `derived-family`。'
        )
      }
    },
    IFamilyKey: {
      summary: t(
        'Application-owned family identity union of string, number and symbol; object keys are not part of this public family contract.',
        '应用拥有的族身份联合，包含字符串、数字及符号，对象键不属于公开族契约。'
      ),
      example: familyExample,
      members: {}
    },
    KeyedSplitCache: {
      summary: t(
        'Explicit Map-backed token cache created with no constructor arguments; public generic items may be arbitrary, but of() treats falsy values as a cache miss.',
        '无构造参数的显式映射令牌缓存，公开泛型条目可任意，但取或建方法将假值视为缓存缺失。'
      ),
      scenarios: [
        t(
          'Reuse stable split item tokens and prune obsolete keys with caller-defined eviction cleanup.',
          '复用稳定拆分条目令牌，并用调用者清理回调裁剪过时键。'
        )
      ],
      example: cacheExample,
      members: {
        get: {
          summary: t(
            'Looks up a stored value without creation or truthiness filtering.',
            '查找已存值，不创建条目也不进行真值筛选。'
          ),
          params: {
            key: t(
              'Application key previously supplied to this cache of method.',
              '此前传给当前缓存取或建方法的应用键。'
            )
          },
          returns: t(
            'Stored Item or undefined for an absent key.',
            '返回已存条目，键不存在时为未定义。'
          ),
          example: cacheExample
        },
        of: {
          summary: t(
            'Returns a truthy cached item or synchronously invokes the creator and replaces the value for that key.',
            '返回真值缓存项，否则同步调用创建器并替换当前键的值。'
          ),
          params: {
            key: t(
              'Application key used to own and retrieve the cache entry.',
              '应用提供、用于拥有及取得缓存条目的键。'
            ),
            create: t(
              'Synchronous no-argument callback returning Item; throwing leaves the new entry uninstalled and propagates unchanged.',
              '同步无参数条目创建回调，抛错时不安装新条目且原样传播。'
            )
          },
          returns: t(
            'Truthy existing Item or freshly created Item; no promise is awaited and falsy cached values are recreated.',
            '返回已有真值条目或新创建条目，不等待承诺，假值缓存会重新创建。'
          ),
          example: cacheExample
        },
        prune: {
          summary: t(
            'Visits a snapshot of entries, evicting nonlive keys when shouldEvict permits; onEvict runs immediately before deletion.',
            '遍历条目快照，当键不存活且允许淘汰时删除，淘汰回调紧接删除前执行。'
          ),
          params: {
            isLive: t(
              'Synchronous (key) => boolean callback; receives a cached application key and true retains it. Throwing aborts traversal.',
              '同步取缓存应用键返回布尔值的回调，真表示保留，抛错终止遍历。'
            ),
            shouldEvict: t(
              'Optional synchronous (item) => boolean gate for a nonlive key, default true. Throwing aborts before deleting that entry.',
              '可选非存活键条目同步淘汰门，默认真，抛错在当前条目删除前终止。'
            ),
            onEvict: t(
              'Optional synchronous (item) => void cleanup, default absent; no return is used and a throw prevents this deletion while preserving earlier deletions.',
              '可选同步条目清理回调，默认省略，不使用返回值，抛错阻止本次删除但保留此前删除。'
            )
          },
          returns: t(
            'Number of removed entries on normal completion; callback failures propagate unchanged.',
            '正常完成时返回移除条目数量，回调失败原样传播。'
          ),
          example: cacheExample
        },
        size: f(
          'Current Map entry count, including cached falsy values.',
          '当前映射条目数量，包含缓存的假值。'
        ),
        keys: {
          summary: t(
            'Returns the native live Map key iterator in insertion order.',
            '按插入顺序返回原生活动映射键迭代器。'
          ),
          returns: t(
            'IterableIterator<Key>; no snapshot copy is made.',
            '返回键迭代器，不制作快照副本。'
          ),
          example: cacheExample
        },
        values: {
          summary: t(
            'Returns the native live Map value iterator in insertion order.',
            '按插入顺序返回原生活动映射值迭代器。'
          ),
          returns: t(
            'IterableIterator<Item>; original item references remain shared.',
            '返回条目迭代器，保留共享原始条目引用。'
          ),
          example: cacheExample
        },
        clear: {
          summary: t(
            'Clears all map entries without invoking any item disposer or eviction callback.',
            '清空全部映射条目，不调用条目清理器或淘汰回调。'
          ),
          returns: t(
            'No result; the same cache object can be reused.',
            '无返回值，可继续复用同一缓存对象。'
          ),
          example: cacheExample
        }
      }
    },
    IAtomGet: {
      summary: t(
        'Store-issued synchronous generic reader get(definition), returning scoped T with dependency tracking. Definition comes from a public constructor or family lookup; errors follow store reads.',
        '存储签发的同步泛型读取函数，接收公开构造或族查找定义，返回带依赖追踪作用域值，错误按存储读取处理。'
      ),
      example: storeExample,
      members: {}
    },
    IAtomSet: {
      summary: t(
        'Store-issued synchronous generic writer set(definition, ...args), preserving each writable token argument tuple and Result; primitive writes use value or updater.',
        '存储签发的同步泛型写函数，接收可写定义及精确参数并保留结果，基础写入使用新值或更新回调。'
      ),
      example: storeExample,
      members: {}
    },
    'atom/definition:IAtomRead': {
      summary: t(
        'Synchronous definition reader (get: IAtomGet) => T; get is issued by the evaluating store, and thrown failures follow its reactive computation.',
        '同步定义读取回调，接收求值存储签发读取函数并返回值，抛错按所属响应计算处理。'
      ),
      example: storeExample,
      members: {}
    },
    IAtomWriter: {
      summary: t(
        'Synchronous definition writer (get, set, ...args) => Result. Store injects its own IAtomGet and IAtomSet, and the caller supplies the original write arguments.',
        '同步定义写回调，存储注入自身读取及写入函数，调用者提供原始写参数，结果或抛错原样返回。'
      ),
      example: storeExample,
      members: {}
    },
    IAtomUpdate: {
      summary: t(
        'Either a new T or a synchronous previous-to-next callback; function forms are interpreted as updaters at the standard primitive write boundary. The declaration is owned by atom/definition and type-re-exported by reactive/atom; both import paths remain supported.',
        '新值或同步旧值转新值回调的联合，标准基础写入边界把函数形式解释为更新回调；定义层持有唯一声明，协议入口仅作类型重导出，两条导入路径均保留。'
      ),
      example: storeExample,
      members: {}
    },
    IAtomGetter: {
      summary: t(
        'Runtime-bound protocol reader from atomGetter: get(atom) synchronously validates ownership then reads atom.value, preserving implementation failures.',
        '读取辅助工厂返回的运行时绑定协议读取器，同步校验所有权后读取原子值并保留实现失败。'
      ),
      scenarios: [
        t(
          'Adapt protocol atoms while rejecting cross-runtime dependency access.',
          '适配协议原子并拒绝跨运行时依赖访问。'
        )
      ],
      example: protocolExample,
      members: {}
    },
    IAtomSetter: {
      summary: t(
        'Runtime-bound protocol writer from atomSetter: set(atom, ...args) validates ownership then forwards exact write arguments and Result.',
        '写辅助工厂返回的运行时绑定协议写入器，校验所有权后转发精确写参数及结果。'
      ),
      scenarios: [
        t(
          'Keep protocol writes in the same runtime dependency graph as their atom implementation.',
          '让协议写入与原子实现位于同一运行时依赖图。'
        )
      ],
      example: protocolExample,
      members: {}
    },
    'reactive/atom:IAtomRead': {
      summary: t(
        'Synchronous protocol reader (get: IAtomGetter) => T, distinct from definition readers; its injected getter accepts live protocol atoms rather than definition tokens.',
        '同步协议读取回调，注入的读取器接受存活协议原子而非定义令牌，与定义读取回调不同。'
      ),
      example: protocolExample,
      members: {}
    },
    IAtomWrite: {
      summary: t(
        'Synchronous protocol writer receiving runtime-bound atom getter, setter and application args; returns the original Result and propagates implementation throws.',
        '同步协议写回调，接收运行时绑定原子读写函数及应用参数，返回原始结果并传播实现抛错。'
      ),
      example: protocolExample,
      members: {}
    },
    IReadableAtom: {
      summary: t(
        'External IDisposable composed with a caller-implemented live atom protocol; the package supplies no concrete instance factory. Implementation owns resource cleanup and its reactive node.',
        '外包可销毁契约与调用者实现的存活原子协议组合，当前包不提供具体实例工厂，实现拥有资源清理及响应节点。'
      ),
      example: protocolExample,
      members: {
        disposed: f(
          'Implementation-owned terminal flag required by the external IDisposable protocol; disposal updates it idempotently.',
          '外包可销毁协议要求的实现终态标记，释放时幂等更新。'
        ),
        runtime: f(
          'Implementation-owned IRuntime whose identity atomGetter and atomSetter validate.',
          '实现拥有、由协议读写辅助函数校验身份的运行时。'
        ),
        atomDefinition: f(
          'Optional pure definition bridge issued by a public definition constructor for store or UI adapters.',
          '可选纯定义桥，由公开定义构造函数产生，供存储或界面适配器使用。',
          'Absent when the implementation has no definition bridge.',
          '实现没有定义桥时省略。'
        ),
        value: f(
          'Current implementation-owned value; protocol getter reads this property after runtime validation.',
          '实现拥有的当前值，协议读取器校验运行时后读取此属性。'
        ),
        observed: f(
          'Implementation-reported active observer state; no observer is created by reading this flag.',
          '实现报告的活动观察状态，读取此标记不会创建观察者。'
        ),
        read: {
          summary: t(
            'Implementation-supplied synchronous tracked read of the current atom value.',
            '实现提供的当前原子值同步追踪读取。'
          ),
          returns: t(
            'Current T or the implementation original read failure.',
            '返回当前值，或传播实现原始读取失败。'
          ),
          example: protocolExample
        },
        peek: {
          summary: t(
            'Implementation-supplied synchronous read without adding reactive dependency edges.',
            '实现提供、不新增响应依赖边的同步读取。'
          ),
          returns: t(
            'Current untracked T; implementation failures propagate.',
            '返回当前不追踪值，实现失败传播。'
          ),
          example: protocolExample
        },
        dispose: {
          summary: t(
            'External IDisposable cleanup implemented by the atom owner, releasing only its own resources.',
            '由原子拥有者实现的外包销毁清理，仅释放自身资源。'
          ),
          returns: t(
            'No result; idempotency and cleanup error semantics belong to the implementation contract.',
            '无返回值，幂等及清理错误语义归实现契约拥有。'
          ),
          example: protocolExample
        }
      }
    },
    IWritableAtom: {
      summary: t(
        'Live readable protocol atom plus an implementation-owned write(...args) method; exact Args and Result remain visible to atomSetter.',
        '存活可读协议原子加实现拥有的写方法，精确参数与结果对协议写入器保持可见。'
      ),
      example: protocolExample,
      members: {
        disposed: f(
          'Implementation-owned terminal flag required by the external IDisposable protocol; disposal updates it idempotently.',
          '外包可销毁协议要求的实现终态标记，释放时幂等更新。'
        ),
        runtime: f(
          'Same external Runtime identity as the readable atom protocol.',
          '与可读原子协议相同的外包运行时身份。'
        ),
        atomDefinition: f(
          'Optional public definition token bridging this live atom to store adapters.',
          '把当前存活原子桥接到存储适配器的可选公开定义令牌。',
          'Absent when no definition bridge is supplied.',
          '没有定义桥时省略。'
        ),
        value: f('Implementation-owned current atom value.', '实现拥有的当前原子值。'),
        observed: f('Implementation-reported active observer state.', '实现报告的活动观察者状态。'),
        read: {
          summary: t(
            'Reads current value with implementation tracking semantics.',
            '按实现追踪语义读取当前值。'
          ),
          returns: t('Current T or original implementation error.', '返回当前值或原实现错误。'),
          example: protocolExample
        },
        peek: {
          summary: t(
            'Reads current value without adding a dependency edge.',
            '不新增依赖边地读取当前值。'
          ),
          returns: t(
            'Current untracked T or original implementation error.',
            '返回不追踪当前值或原实现错误。'
          ),
          example: protocolExample
        },
        write: {
          summary: t(
            'Implementation-owned synchronous write callback receiving the exact application argument tuple.',
            '实现拥有、接收精确应用参数元组的同步写回调。'
          ),
          params: {
            args: t(
              'Original application arguments forwarded by atomSetter after runtime validation.',
              '运行时校验后由协议写入器转发的原应用参数。'
            )
          },
          returns: t(
            'Original implementation Result; throws are propagated unchanged.',
            '返回原实现结果，抛错原样传播。'
          ),
          example: protocolExample
        },
        dispose: {
          summary: t(
            'Releases implementation-owned atom resources through the external IDisposable contract.',
            '经外包可销毁契约释放实现拥有的原子资源。'
          ),
          returns: t(
            'No result; cleanup policy is defined by the atom implementation.',
            '无返回值，清理策略由原子实现定义。'
          ),
          example: protocolExample
        }
      }
    },
    IAtomKind: {
      summary: t(
        'Value union of AtomKind selecting the four definition construction and instantiation modes.',
        '选择四种定义构造及实例化模式的原子种类值联合。'
      ),
      example: storeExample,
      members: {}
    },
    IStoreKeyedErrorCode: {
      summary: t(
        'Value union of StoreKeyedErrorCode for stable package failure classification with STORE_KEYED_SOURCE.',
        '用于与规范来源一起稳定分类包失败的存储错误码值联合。'
      ),
      example: storeExample,
      members: {}
    }
  },
  enums: {
    AtomKind: {
      summary: t(
        'Pure definition discriminants selecting scoped instantiation and write behavior.',
        '选择作用域实例化及写入行为的纯定义判别标签。'
      ),
      values: kindValues
    },
    StoreKeyedErrorCode: {
      summary: t(
        'Package error classifications with native class and original cause preservation.',
        '保留原生类型及原始原因的包错误分类。'
      ),
      values: errorValues
    }
  },
  enhancers: {}
}
