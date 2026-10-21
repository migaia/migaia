/**
 * Bilingual reference verified against packages/store-indexed/src, README and USEGUIDE on
 * 2026-10-18. Clarifications: Map/Set snapshots are independent native copies, not frozen;
 * object/array snapshots are shallow-frozen and cached. Array has no prune(). Cross-runtime
 * protection is checked by value reads/snapshots using isTrackingIn; structural reads directly use
 * their owning signal. Class constructors are the sole creation entry points, ordered
 * initial/runtime/options.
 */
import type { ILibraryReference, IMemberDoc, ISymbolDoc, IText } from './contract.js'
import { storeIndexedCases } from './store-indexed-cases.js'

/** Builds one bilingual sentence. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Builds a fully described instance operation. */
const method = (
  en: string,
  zh: string,
  params: Readonly<Record<string, IText>>,
  returns: IText,
  example: string
): IMemberDoc => ({ summary: t(en, zh), params, returns, example })
/** Runtime ownership shared by every collection. */
const lifecycle: Readonly<Record<string, IMemberDoc>> = {
  runtime: {
    summary: t(
      'IRuntime selected at construction; tracked reads belong to its graph and mutations use its batching.',
      '构造时选择的响应式运行时；追踪读取归属其依赖图，写入使用其批处理。'
    )
  },
  disposed: {
    summary: t(
      'Whether terminal disposal has disconnected collection-owned signals; ordinary reads and writes then reject.',
      '是否已经终态释放并断开集合持有的信号；此后普通读写均拒绝。'
    )
  },
  dispose: method(
    'Idempotently disconnects collection-owned signals and releases cell-pool references without disposing the caller Runtime. Backing data and existing snapshots are not cleared.',
    '幂等断开集合持有的响应式信号并释放信号池引用，不释放调用方运行时；不会清空底层应用数据或已有快照。',
    {},
    t(
      'Nothing; the collection is terminal and later data access throws COLLECTION_DISPOSED.',
      '无返回值；集合进入终态，后续数据访问抛出集合已释放错误。'
    ),
    'const rows = new ObservableArray([1]); rows.dispose(); rows.dispose()'
  )
}
/** Key selected from the caller-owned data domain. */
const key = t(
  'Application-selected key from the initial data or a key the application has inserted.',
  '应用从初始数据或后续自行插入的数据中选择的键。'
)
/** Value submitted by application code. */
const value = t(
  'Application value to store; nested objects retain their original identity.',
  '应用要保存的值；嵌套对象保留原有身份。'
)
/** Shared explicit cell reclamation. */
const prune = method(
  'Reclaims cells for deleted keys or members only when no observer still holds them; active observations survive.',
  '仅在没有观察者持有时回收已删除键或成员的信号格，保留活跃观察。',
  {},
  t(
    'Number of stale cells actually released, not the number of deleted data entries.',
    '实际释放的过期信号格数量，不是已删除数据条目数。'
  ),
  "const users = new ObservableMap([['a', 1]]); users.delete('a'); console.log(users.prune()); users.dispose()"
)
/** Shared collection construction options. */
const options: Readonly<Record<string, IMemberDoc>> = {
  mutationGuard: {
    summary: t(
      'Caller-owned IMutationGuard from @migaia/store-light; each mutation invokes assertMutationAllowed(operation) before changing data. Existing foreign source/code stays unchanged. An unclassified extensible native error receives CALLBACK_FAILED without replacement; frozen errors and other values remain reachable through cause/errors. Failure prevents the outer mutation, not callback-owned side effects.',
      '调用方持有的 `@migaia/store-light` 变更守卫；每次写入前用操作名称调用许可检查，已有外包来源与错误码保持不变；未分类且可扩展的原生错误在原对象上附 `CALLBACK_FAILED`，冻结错误与其他值经原因或聚合列表保留。失败阻止本次外层写入，不回滚回调自己的副作用。'
    ),
    default: t(
      '`undefined`: mutations have no additional policy guard.',
      '`undefined`：写入没有额外策略守卫。'
    )
  },
  debugName: {
    summary: t(
      'Application-selected string prefix for internal signal diagnostics and mutation operation labels.',
      '应用指定的字符串前缀，用于内部信号诊断与变更操作标签。'
    ),
    default: t(
      'The concrete class name: `ObservableObject`, `ObservableArray`, `ObservableMap` or `ObservableSet`.',
      '默认分别使用具体类名 `ObservableObject`、`ObservableArray`、`ObservableMap` 或 `ObservableSet`。'
    )
  }
}
/** Application permissions reject a cart mutation before the shared view changes. */
const guardedCollectionExample = `import { ObservableMap } from '@migaia/store-indexed'
import { createRuntime } from '@migaia/reactive'

const quantities = new ObservableMap<string, number>([['item-1', 1]], createRuntime(), {
  mutationGuard: {
    assertMutationAllowed: () => permissions.assertCanEdit('cart')
  }
})
try {
  quantities.set(itemId, nextQuantity)
  renderCart(quantities.snapshot())
} catch (error) {
  showReadOnlyMessage(error)
}`
/** Feature names make the cart's reactive nodes recognizable in the trace panel. */
const namedCollectionExample = `import { ObservableArray } from '@migaia/store-indexed'
import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime({ onTrace: (event) => appendTraceToPanel(event) })
const rows = new ObservableArray([10], runtime, { debugName: 'cartRows' })
const view = runtime.effect(() => {
  renderCartRows(rows.snapshot())
})
rows.push(20)
onCartClosed(() => {
  view.dispose()
  rows.dispose()
})`
/** Object example shows tracked reading and explicit lifecycle ownership. */
const objectExample = `const user = new ObservableObject({ name: 'Ada', age: 30 })
const watch = user.runtime.effect(() => console.log(user.get('name')))
user.set('name', 'Grace')
watch.dispose()
user.dispose()`
/** Array example preserves index semantics. */
const arrayExample = `const rows = new ObservableArray([10, 20])
const watch = rows.runtime.effect(() => console.log(rows.at(0)))
rows.set(1, 21)
rows.splice(0, 1)
watch.dispose()
rows.dispose()`
/** Map example distinguishes keys and values. */
const mapExample = `const users = new ObservableMap<string, number>([['a', 1]])
const watch = users.runtime.effect(() => console.log(users.get('a')))
users.set('a', 2)
console.log(users.entries())
watch.dispose()
users.dispose()`
/** Set example observes one membership. */
const setExample = `const tags = new ObservableSet(['a'])
const watch = tags.runtime.effect(() => console.log(tags.has('a')))
tags.delete('a')
watch.dispose()
tags.dispose()`
/** Documents the sole class construction path and its ownership. */
const factory = (
  name: string,
  kind: string,
  zhKind: string,
  example: string,
  initial: IText
): ISymbolDoc => ({
  role: 'factory',
  purpose: t(
    'Creates an explicit reactive ' +
      kind +
      ' with lazy per-entry signals and collection-owned disposal. Constructor order is initial, runtime, options; options defaults to `{}`. The supplied Runtime is borrowed, while collection-owned signals are released by dispose.',
    '创建显式响应式' +
      zhKind +
      '，按需为所观察条目建立信号，并由集合负责释放这些信号；构造参数依次为初值、运行时、选项，选项默认 `{}`。传入的运行时只被借用，不随集合一起释放。'
  ),
  params: {
    initial,
    runtime: t(
      '`IRuntime` from `@migaia/reactive`; omitted uses `defaultRuntime`. Use its graph for observing this collection; collection disposal does not dispose the Runtime.',
      '来自 `@migaia/reactive` 的 `IRuntime`，省略时使用 `defaultRuntime`；观察此集合应使用其依赖图，集合释放不会释放运行时。'
    )
  },
  options: 'IObservableCollectionOptions',
  returns: t(
    `Caller-owned ${name}; dispose it after its observers are released. Invalid input throws a tagged TypeError with INVALID_OPTION.`,
    `返回调用方持有的${zhKind}实例；观察者释放后应释放集合。非法输入抛带无效选项错误码的原生类型错误。`
  ),
  exampleIntro: t(
    'Examples that import `createRuntime` require a direct installation of `@migaia/reactive` as well as this package. `createRuntime({ schedulerStrategy: (run) => run() })` selects synchronous effect flushing for deterministic output; it is a Runtime option, not a collection option. The callback receives the pending flush function and must return void. If omitted, Reactive schedules that function through the Runtime adapter’s `scheduleMicrotask`. `runtime.effect(callback)` tracks reads during the callback and returns an observer to dispose. Release observers before disposing their collection. The collection constructors’ own options are omitted in these examples: `mutationGuard` is `undefined`, and `debugName` is the class name.',
    '示例直接导入 `createRuntime` 时，须同时直接安装本包与 `@migaia/reactive`。`createRuntime({ schedulerStrategy: (run) => run() })` 选择同步执行响应式刷新，让输出确定；这是运行时选项，不是集合选项。该回调接收待执行的刷新函数，必须返回 `void`；省略时，响应式内核通过运行时适配器的 `scheduleMicrotask` 安排刷新。`runtime.effect(callback)` 追踪回调执行期间的读取，并返回需要释放的观察者；先释放观察者，再释放集合。本例省略集合自身选项，`mutationGuard` 为 `undefined`，`debugName` 使用类名。'
  ),
  example: storeIndexedCases[name]?.[0]?.example ?? example,
  cases: storeIndexedCases[name]
})
/** Error construction retains native identity and original cause. */
const errorFactory = (native: string, withCause: boolean): ISymbolDoc => ({
  role: 'operation',
  purpose: t(
    `Constructs a native ${native} with this package source and selected stable code, preserving the original stack without promising that it includes cause messages. The helper returns rather than throws the error.`,
    `构造带本包来源与所选稳定错误码的原生错误，保留原始堆栈，不保证堆栈字符串含原因消息全文；辅助函数只返回错误，不主动抛出。`
  ),
  params: {
    code: t(
      'A value selected from StoreIndexedErrorCode for the actual failure scenario.',
      '从 `StoreIndexedErrorCode` 选择、对应实际失败场景的码值。'
    ),
    message: t(
      'Caller-authored explanation for this concrete failure.',
      '调用方编写的具体失败说明文本。'
    )
  },
  ...(withCause
    ? {
        optionCases: [
          {
            title: t('Explain why cart rows could not be imported', '说明购物车行导入失败'),
            problem: t(
              'A cart importer decodes uploaded rows before adding them to a collection. A short import error should not hide the decoder exception. Keep it in `cause` so monitoring can inspect that exception while the page describes the failed operation.',
              '购物车导入器先解码上传行，再加入集合。简短的导入提示不应掩盖解码异常。用 `cause` 保留它，页面说明失败操作，监控仍能查看原始异常。'
            ),
            example: `import {
  createStoreIndexed${native === 'Error' ? '' : 'Type'}Error,
  StoreIndexedErrorCode
} from '@migaia/store-indexed'

try {
  await importCartRows(upload)
} catch (cause) {
  const error = createStoreIndexed${native === 'Error' ? '' : 'Type'}Error(
    StoreIndexedErrorCode.invalidOption,
    'Cart rows could not be imported',
    { cause }
  )
  showImportError(error.message)
  reportToMonitoring(error)
}`,
            result: t(
              'The cart shows an import error, with the original decoder exception retained in monitoring.',
              '购物车显示导入失败提示，监控记录保留原始解码异常。'
            ),
            covers: ['cause']
          },
          {
            title: t('Keep the row rejected by import validation', '保留导入校验拒绝的行详情'),
            problem: t(
              'Cart import validation returns the row and field that failed. Converting that record to a message loses the structured details. Keep it in `cause` when reporting the rejected upload.',
              '购物车导入校验会返回失败的行号和字段。只把记录变成文字会丢失结构化详情。报告上传被拒绝时，把记录保留在 `cause` 中。'
            ),
            example: `import {
  createStoreIndexed${native === 'Error' ? '' : 'Type'}Error,
  StoreIndexedErrorCode
} from '@migaia/store-indexed'

const rejection = validateCartRows(upload)
if (rejection) {
  const error = createStoreIndexed${native === 'Error' ? '' : 'Type'}Error(
    StoreIndexedErrorCode.invalidOption,
    'Cart upload rejected',
    { cause: rejection }
  )
  showImportError(error.message)
  reportToMonitoring(error)
}`,
            result: t(
              'The page reports the rejected upload, and monitoring keeps its row and field details.',
              '页面提示上传被拒绝，监控中保留对应的行号和字段。'
            ),
            covers: ['cause']
          }
        ],
        optionDocs: {
          cause: {
            summary: t(
              'Original failure retained by identity on the native error cause property.',
              '按对象身份保留在原生错误原因属性上的原始失败。'
            ),
            default: t('Omitted: no cause property is supplied.', '省略时不提供原始原因属性。')
          }
        }
      }
    : {}),
  returns: t(
    `A source/code-tagged ${native}; instanceof and the native stack remain intact.`,
    '返回附有来源与错误码的原生错误，保留运行时类型判断与堆栈。'
  ),
  example: `const error = createStoreIndexed${native === 'Error' ? '' : native === 'RangeError' ? 'Range' : 'Type'}Error(StoreIndexedErrorCode.invalidOption, 'Invalid collection input')`
})
/** Complete indexed collection reference. */
export const storeIndexedReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Explicit reactive Object, Array, Map and Set collections without user-object proxies. Start with ObservableObject, ObservableArray, ObservableMap or ObservableSet, then read and mutate through named methods. Ordinary dependencies are reactive, store-light and utils, with no peerDependencies; store-light supplies only the mutation-guard type to this layer.',
        '提供无需代理用户对象的显式响应式对象、数组、映射与集合；从 `ObservableObject`、`ObservableArray`、`ObservableMap` 或 `ObservableSet` 类构造开始，通过命名方法读取和写入。普通依赖为响应式内核、轻量仓库与基础工具，没有对等依赖；轻量仓库仅提供变更守卫类型。'
      ),
      example: `import { ObservableArray } from '@migaia/store-indexed'\n${arrayExample}`
    }
  },
  symbols: {
    ObservableObject: factory(
      'ObservableObject',
      'string-keyed object',
      '字符串键对象',
      objectExample,
      t(
        'Required initial object; key types are inferred from its declared shape.',
        '必填初始对象，键类型从声明形状推导。'
      )
    ),
    ObservableArray: factory(
      'ObservableArray',
      'index-based array',
      '索引数组',
      arrayExample,
      t(
        'Initial iterable, default `[]` for an empty array; strings are accepted as characters.',
        '初始可迭代值，默认 `[]` 创建空数组，字符串按字符接受。'
      )
    ),
    ObservableMap: factory(
      'ObservableMap',
      'key/value map',
      '键值映射',
      mapExample,
      t(
        'Initial map or entry iterable, default `[]` for an empty map. Construction and replace both validate every entry with native Map admission before ownership or data changes; invalid entries throw `INVALID_OPTION` and preserve the old collection.',
        '初始映射或条目可迭代值，默认 `[]` 创建空映射；构造与替换均先按原生映射规则验证条目，再取得所有权或改写数据，非法条目抛 `INVALID_OPTION` 且旧集合不变。'
      )
    ),
    ObservableSet: factory(
      'ObservableSet',
      'membership set',
      '成员集合',
      setExample,
      t(
        'Initial iterable, default `[]` for an empty membership set; strings are accepted as characters and duplicates collapse under native Set semantics.',
        '初始可迭代值，默认 `[]` 创建空成员集合；字符串按字符接受，重复成员按原生 `Set` 语义合并。'
      )
    ),
    createStoreIndexedError: errorFactory('Error', true),
    createStoreIndexedRangeError: errorFactory('RangeError', false),
    createStoreIndexedTypeError: errorFactory('TypeError', true),
    IndexedOperation: {
      role: 'constant',
      purpose: t(
        'Public read/write/delete vocabulary for consumer diagnostics. Collection mutation guards receive concrete operation labels instead of these constants.',
        '供消费方诊断使用的公开读、写、删除词表；集合变更守卫接收具体操作标签，不接收这些常量。'
      ),
      example: 'const operation = IndexedOperation.write'
    },
    STORE_INDEXED_SOURCE: {
      role: 'constant',
      purpose: t(
        'Stable @migaia/store-indexed source stamped on errors created by this package; combine it with the error code to identify an owned failure.',
        '本包创建错误时附加的稳定来源标记；读取来源与错误码可识别本包拥有的失败。'
      ),
      example: 'console.log(STORE_INDEXED_SOURCE)'
    },
    StoreIndexedErrorCode: {
      role: 'constant',
      purpose: t(
        'Stable semantic codes distinguishing invalid inputs, disposed collections, callback failures, invalid array indexes and reads across runtime graphs.',
        '稳定语义错误码，区分非法输入、已释放集合、回调失败、非法数组下标及跨运行时依赖图读取。'
      ),
      example: 'console.log(StoreIndexedErrorCode.collectionDisposed)'
    }
  },
  types: {
    IObservableCollectionOptions: {
      summary: t(
        'Construction policy shared by all explicit collection classes; it adds diagnostics and optional mutation admission.',
        '所有显式集合类共用的构造策略，提供诊断命名与可选写入接纳。'
      ),
      members: options,
      optionCases: [
        {
          title: t('Reject edits after permission changes', '权限变化后拒绝编辑'),
          problem: t(
            'A collection should stop accepting edits when its page becomes read-only. Without mutationGuard, writes have no extra permission check. A guard throws before changing the collection, so the previous value remains available.',
            '页面变成只读后，集合应停止接收编辑。不设置 mutationGuard 时，写入没有额外的权限检查。守卫在集合变更前抛错，因此原值仍然保留。'
          ),
          example: guardedCollectionExample,
          result: t(
            'An edit rejected by the permission policy shows the read-only message and leaves the stored quantity unchanged.',
            '权限策略拒绝编辑时，页面显示只读提示，已保存数量保持不变。'
          ),
          covers: ['mutationGuard']
        },
        {
          title: t('Name collection writes in diagnostics', '为诊断中的集合写入命名'),
          problem: t(
            'A support trace panel shows several observable arrays. Their default ObservableArray names do not identify the cart. Set `debugName` to name the cart signals in trace events, so support can locate changes from this view.',
            '支持追踪面板中有多个响应式数组。默认的 ObservableArray 名称无法识别购物车。用 `debugName` 为追踪事件中的购物车信号命名，支持人员就能定位该视图的变化。'
          ),
          example: namedCollectionExample,
          result: t(
            'The cart shows both rows, and its changed signals appear under the `cartRows` prefix in the trace panel.',
            '购物车显示两行数据，追踪面板中变化的信号以 `cartRows` 为前缀。'
          ),
          covers: ['debugName']
        }
      ]
    },
    IIndexedOperation: {
      summary: t(
        'Value union of IndexedOperation for consumer-defined read/write/delete diagnostic events.',
        '`IndexedOperation` 的值联合，用于消费方自定义的读写删除诊断事件。'
      ),
      members: {}
    },
    IStoreIndexedErrorCode: {
      summary: t(
        'Value union from StoreIndexedErrorCode, selected when constructing or recognizing this package errors.',
        '`StoreIndexedErrorCode` 的值联合，用于构造或识别本包错误。'
      ),
      members: {}
    },
    ObservableObject: {
      summary: t(
        'Owned string-keyed collection: value reads track one key, existence and key enumeration track structure, snapshots track all revisions.',
        '自持有的字符串键集合：值读取追踪单键，存在性与键枚举追踪结构，快照追踪全部修订。'
      ),
      scenarios: [
        t(
          'Edit a large object while subscribing to only selected properties.',
          '编辑大型对象时仅订阅少数指定属性。'
        )
      ],
      example: objectExample,
      members: {
        ...lifecycle,
        get: method(
          'Reads one key and lazily tracks its cell only inside the owning Runtime tracking context.',
          '读取单键，仅在所属运行时追踪上下文内按需追踪其信号格。',
          { key },
          t(
            'Stored value, or undefined for an absent key; cross-runtime tracked value reads reject.',
            '返回保存值，缺失键返回空值；跨运行时的追踪值读取会拒绝。'
          ),
          "const user = new ObservableObject({ age: 30 }); console.log(user.get('age')); user.dispose()"
        ),
        peek: method(
          'Reads one key without tracking or allocating a reactive cell, even during an active effect.',
          '读取单键，不追踪且不分配响应式信号格，即使当前正在执行响应副作用。',
          { key },
          t(
            'Current value, or undefined when absent, without creating a dependency.',
            '返回当前值，缺失时为空值，不建立依赖。'
          ),
          "const user = new ObservableObject({ age: 30 }); console.log(user.peek('age')); user.dispose()"
        ),
        has: method(
          'Reads key existence through the shared structure signal; changing only a value does not invalidate it.',
          '通过共享结构信号读取键存在性；仅改变已有值不会使其失效。',
          { key },
          t(
            'Whether the object currently contains the string key.',
            '返回对象当前是否含有所选字符串键。'
          ),
          "const user = new ObservableObject({ age: 30 }); console.log(user.has('age')); user.dispose()"
        ),
        set: method(
          'Runs the mutation guard, then assigns one key in a Runtime batch; Object.is-equal existing values do not bump the snapshot revision.',
          '先运行变更守卫，再在运行时批处理中赋值单键；已有值按同值比较相等时不提升快照修订。',
          { key, value },
          t(
            'Nothing; value observers update and insertion also updates structure.',
            '无返回值；值观察者更新，插入新键还会更新结构。'
          ),
          "const user = new ObservableObject({ age: 30 }); user.set('age', 31); user.dispose()"
        ),
        update: method(
          'After mutation admission, synchronously calls updater with the untracked current value and commits its result. A thrown updater leaves this outer assignment unapplied.',
          '通过变更接纳后，同步用未追踪的当前值调用更新函数并提交结果；更新函数抛错时不执行本次外层赋值。',
          {
            key,
            updater: t(
              'Synchronous callback receiving the current T[K] and returning the replacement T[K]; promises are not awaited. Existing error identity is preserved; otherwise CALLBACK_FAILED is attached to the original native error or retains the original through cause/errors.',
              '同步回调接收当前值并返回替换值，不会等待 Promise；保留已有错误身份，否则在原生错误上附 `CALLBACK_FAILED`，或经原因与聚合列表保留原值。'
            )
          },
          t(
            'Nothing; the returned replacement value has been committed in a Runtime batch.',
            '无返回值；更新函数返回的替换值已在运行时批处理中提交。'
          ),
          "const user = new ObservableObject({ age: 30 }); user.update('age', age => age + 1); user.dispose()"
        ),
        delete: method(
          'Removes one admitted key and updates value, structure and revision signals; observed deleted cells retain an absent tombstone.',
          '移除已获准的单键并更新值、结构与修订信号；仍受观察的已删除信号格保留缺失标记。',
          { key },
          t(
            'True only when a stored key was removed; false if already absent.',
            '仅实际移除已保存键时为真，原本缺失时为假。'
          ),
          "const user = new ObservableObject({ age: 30 }); console.log(user.delete('age')); user.dispose()"
        ),
        keys: method(
          'Enumerates current string keys and tracks only the object structure.',
          '枚举当前字符串键，仅追踪对象结构。',
          {},
          t(
            'Fresh key array in insertion order; its readonly type does not freeze the returned array.',
            '返回按插入顺序排列的新键数组；只读类型不冻结返回数组。'
          ),
          'const user = new ObservableObject({ age: 30 }); console.log(user.keys()); user.dispose()'
        ),
        snapshot: method(
          'Returns a shallow-frozen null-prototype object snapshot, cached until actual membership or value changes.',
          '返回浅冻结且无原型的对象快照，在成员或值实际改变前复用缓存。',
          {},
          t(
            'Readonly top-level copy; nested values retain identity and tracked reads depend on all revisions.',
            '返回顶层只读副本；嵌套值保留身份，追踪读取依赖全部修订。'
          ),
          'const user = new ObservableObject({ age: 30 }); console.log(user.snapshot()); user.dispose()'
        ),
        replace: method(
          'Reads all enumerable own entries before mutation and replaces keys in one batch; failed input getters leave existing data unchanged. The guard runs once at replace admission; internal deletion/insertion does not call public delete/set per key.',
          '变更前读取全部自有可枚举条目，再在一次批处理中替换键集；输入访问器失败时原数据不变；守卫仅在替换入口调用一次，内部删除与写入不会逐键调用公开删除或设置方法。',
          {
            next: t(
              'Caller-authored complete replacement object; omitted keys are deleted.',
              '调用方编写的完整替换对象，未出现的键会被删除。'
            )
          },
          t(
            'Nothing; deleted, inserted and changed keys are committed together.',
            '无返回值；删除、插入与值变更已一并提交。'
          ),
          'const user = new ObservableObject({ age: 30 }); user.replace({ age: 31 }); user.dispose()'
        ),
        prune: {
          ...prune,
          example:
            "const user = new ObservableObject({ age: 30 }); user.delete('age'); console.log(user.prune()); user.dispose()"
        }
      }
    },
    ObservableArray: {
      summary: t(
        'Owned index-based reactive array; inserts and deletions shift index values rather than preserving entity identity.',
        '自持有的索引响应式数组；插入与删除会移动下标对应的值，不保留实体定位身份。'
      ),
      scenarios: [
        t(
          'Observe a small visible subset of a large positional list.',
          '观察大型位置列表中少量可见下标。'
        )
      ],
      example: arrayExample,
      members: {
        ...lifecycle,
        length: {
          summary: t(
            'Current array length, tracked through the structure signal rather than individual index cells.',
            '当前数组长度，通过结构信号追踪，不依赖单个下标信号格。'
          )
        },
        at: method(
          'Reads one integer index; negative indexes are relative to the current end and also observe structure.',
          '读取整数下标；负数从当前末尾换算，并额外观察结构变化。',
          {
            index: t(
              'Integer position, accepting negative positions from the end; nonintegers throw INVALID_INDEX.',
              '整数位置，接受从末尾计数的负数；非整数抛非法下标错误。'
            )
          },
          t(
            'Element or undefined outside bounds; owning Runtime tracking observes that index.',
            '返回元素，越界时为空值；所属运行时追踪会观察该下标。'
          ),
          'const rows = new ObservableArray([1, 2]); console.log(rows.at(-1)); rows.dispose()'
        ),
        snapshot: method(
          'Reads the revision and caches a shallow-frozen array until length or element values change.',
          '读取修订并缓存浅冻结数组，直到长度或元素值改变。',
          {},
          t(
            'Readonly shallow array snapshot; nested values retain identity.',
            '返回浅只读数组快照，嵌套值保留身份。'
          ),
          'const rows = new ObservableArray([1]); console.log(rows.snapshot()); rows.dispose()'
        ),
        peek: method(
          'Makes a fresh shallow-frozen array copy without any dependency tracking.',
          '每次建立新的浅冻结数组副本，不进行任何依赖追踪。',
          {},
          t(
            'Untracked readonly shallow copy, independent of snapshot caching.',
            '返回不追踪的浅只读副本，与快照缓存独立。'
          ),
          'const rows = new ObservableArray([1]); console.log(rows.peek()); rows.dispose()'
        ),
        set: method(
          'Replaces an existing nonnegative index after guard admission; changed cell and revision commit in one Runtime batch, including synchronous schedulers. Object.is-equal values do not notify.',
          '通过守卫接纳后替换已有非负下标；信号格与修订在一次运行时批处理中提交，同步调度器也不见中间旧快照。同值比较相等时不通知。',
          {
            index: t(
              'Integer within [0, length); nonintegers throw INVALID_INDEX and other positions INDEX_OUT_OF_RANGE.',
              '必须是现有范围内的整数；非整数抛非法下标错误，其他越界位置抛范围错误。'
            ),
            value
          },
          t(
            'Nothing; the selected cell and revision update when the value changes.',
            '无返回值；值变化时更新所选信号格与修订。'
          ),
          'const rows = new ObservableArray([1]); rows.set(0, 2); rows.dispose()'
        ),
        push: method(
          'Appends values in one batch; an empty argument list leaves revisions unchanged.',
          '在一次批处理中追加多个值；参数列表为空时不改变修订。',
          {
            values: t(
              'Application values to append in argument order.',
              '应用提供的待追加值，保持参数顺序。'
            )
          },
          t('New array length after the append operation.', '返回追加操作完成后的数组长度。'),
          'const rows = new ObservableArray([1]); console.log(rows.push(2, 3)); rows.dispose()'
        ),
        pop: method(
          'Removes the final element, marks any observed index absent and updates structure in one batch.',
          '移除末尾元素，将受观察下标标记为缺失，并在一次批处理中更新结构。',
          {},
          t(
            'Removed final value, or undefined when already empty.',
            '返回被移除的末尾值，原本为空时返回空值。'
          ),
          'const rows = new ObservableArray([1]); console.log(rows.pop()); rows.dispose()'
        ),
        splice: method(
          'Applies native splice positioning and integer coercion to a copied array, then commits changed indexes in one batch.',
          '按原生切片插入语义对副本处理位置与整数转换，再在一次批处理中提交受影响下标。',
          {
            start: t(
              'Native splice start position; negative positions count from the end.',
              '原生切片插入起点，负数从末尾计算。'
            ),
            deleteCount: t(
              'Omitted removes through the end; explicitly undefined means zero removals.',
              '省略时删除到末尾；显式 `undefined` 表示不删除元素。'
            ),
            items: t(
              'Application values inserted at the selected position.',
              '应用提供的待插入值，放入选定位置。'
            )
          },
          t(
            'Shallow-frozen array of removed elements; inserted values keep identity.',
            '返回被移除元素的浅冻结数组；插入值保留身份。'
          ),
          'const rows = new ObservableArray([1, 2]); console.log(rows.splice(0, 1, 3)); rows.dispose()'
        ),
        replace: method(
          'Materializes the entire iterable before replacing data, then updates only materialized index cells in one batch. Equal-length inputs still require a full value comparison; this is not a constant-time replacement.',
          '先完整物化可迭代值，再替换数据，并在一次批处理中更新已物化的下标信号格；等长输入仍需逐值比较，不保证恒定替换成本。',
          {
            values: t(
              'Complete replacement iterable; strings are accepted as characters.',
              '完整替换可迭代值，字符串按字符接受。'
            )
          },
          t(
            'Nothing; values and changed length/revision are committed.',
            '无返回值；数据及变化的长度与修订已提交。'
          ),
          'const rows = new ObservableArray([1]); rows.replace([2, 3]); rows.dispose()'
        ),
        clear: method(
          'Replaces the array with an empty array through the same guarded replacement path.',
          '通过同一受守卫约束的替换路径，将数组替换为空数组。',
          {},
          t(
            'Nothing; the array is empty and affected observations are invalidated.',
            '无返回值；数组已清空，受影响观察已失效。'
          ),
          'const rows = new ObservableArray([1]); rows.clear(); rows.dispose()'
        )
      }
    },
    ObservableMap: {
      summary: t(
        'Owned reactive Map with per-key value or membership cells, plus separate structure and value-iteration dependencies.',
        '自持有的响应式映射，单键值或存在性使用信号格，结构与值迭代使用独立依赖。'
      ),
      scenarios: [
        t(
          'Track selected lookup keys while independently rendering the whole value list.',
          '追踪少数查询键，同时独立渲染完整值列表。'
        )
      ],
      example: mapExample,
      members: {
        ...lifecycle,
        size: {
          summary: t(
            'Current entry count; tracks structure and ignores updates that preserve key membership.',
            '当前条目数，追踪结构，忽略不改变键成员的值更新。'
          )
        },
        get: method(
          'Reads a key value and lazily tracks that key only in the owning Runtime context.',
          '读取键值，仅在所属运行时上下文内按需追踪该键。',
          { key },
          t('Current value or undefined for an absent key.', '返回当前保存值，缺失键返回空值。'),
          "const users = new ObservableMap([['a', 1]]); console.log(users.get('a')); users.dispose()"
        ),
        peek: method(
          'Reads the backing Map directly without tracking or creating any key cell.',
          '直接读取内部映射，不追踪也不创建任何键信号格。',
          { key },
          t(
            'Current stored value or undefined without dependency admission.',
            '返回当前值，缺失时为空值，不建立依赖。'
          ),
          "const users = new ObservableMap([['a', 1]]); console.log(users.peek('a')); users.dispose()"
        ),
        has: method(
          'Tracks the selected key cell for membership; updates to unrelated keys do not invalidate this observation.',
          '通过所选键信号格追踪成员存在性；无关键变化不使该观察失效。',
          { key },
          t(
            'True when the backing Map contains this key, even if its value is undefined.',
            '内部映射含有所选键时为真，即使保存的值为空值。'
          ),
          "const users = new ObservableMap([['a', 1]]); console.log(users.has('a')); users.dispose()"
        ),
        set: method(
          'Writes a key after admission; an unchanged existing value is a no-op, while insertion updates structure and iteration.',
          '接纳后写入单键；已有值未变时为空操作，插入时更新结构与迭代依赖。',
          { key, value },
          t(
            'This same ObservableMap for chaining; values retain original identity.',
            '返回同一响应式映射以继续链式写入，值保留原始身份。'
          ),
          "const users = new ObservableMap<string, number>(); users.set('a', 1).set('b', 2); users.dispose()"
        ),
        delete: method(
          'Removes one key in a batch and retains its missing cell while still observed.',
          '在一次批处理中移除单键，仍受观察时保留其缺失信号格。',
          { key },
          t(
            'True if an entry was removed; false when the key was absent.',
            '实际移除条目时为真，键原本缺失时为假。'
          ),
          "const users = new ObservableMap([['a', 1]]); console.log(users.delete('a')); users.dispose()"
        ),
        clear: method(
          'Clears stored entries and invalidates materialized cells, with one structure and iteration update.',
          '清空保存条目并使已物化信号格失效，仅更新一次结构与迭代依赖。',
          {},
          t(
            'Nothing; all entries are removed while observed tombstones survive.',
            '无返回值；全部条目已移除，受观察的缺失标记仍保留。'
          ),
          "const users = new ObservableMap([['a', 1]]); users.clear(); users.dispose()"
        ),
        replace: method(
          'Materializes all entries before a batched swap; key membership or insertion-order changes update structure and iteration, and value changes update iteration. Only identical entries in identical order avoid notification.',
          '先物化全部条目再批量交换；键成员或插入顺序改变时更新结构与迭代，值变化更新迭代依赖；仅条目及顺序均不变时不通知。',
          {
            next: t(
              'Complete map or entry iterable to replace existing entries.',
              '用于替换全部现有条目的映射或条目可迭代值。'
            )
          },
          t(
            'Nothing; the replacement is committed atomically after input preparation.',
            '无返回值；输入准备后原子提交替换。'
          ),
          "const users = new ObservableMap([['a', 1]]); users.replace([['b', 2]]); users.dispose()"
        ),
        keys: method(
          'Returns insertion-ordered keys while tracking membership structure only.',
          '返回按插入顺序排列的键，仅追踪成员结构。',
          {},
          t(
            'Fresh key array; readonly typing does not freeze the array.',
            '返回新的键数组，只读类型不会冻结该数组。'
          ),
          "const users = new ObservableMap([['a', 1]]); console.log(users.keys()); users.dispose()"
        ),
        valuesArray: method(
          'Reads value iteration and returns a shallow-frozen values array.',
          '读取值迭代依赖，返回浅冻结的值数组。',
          {},
          t(
            'Frozen top-level values in current Map iteration order.',
            '返回按当前映射迭代顺序排列的顶层冻结值数组。'
          ),
          "const users = new ObservableMap([['a', 1]]); console.log(users.valuesArray()); users.dispose()"
        ),
        entries: method(
          'Reads value iteration and returns a frozen array of frozen entry pairs.',
          '读取值迭代依赖，返回冻结条目对组成的冻结数组。',
          {},
          t(
            'Readonly key/value pairs; nested keys and values keep identity.',
            '返回只读键值对，嵌套键和值保持原有身份。'
          ),
          "const users = new ObservableMap([['a', 1]]); console.log(users.entries()); users.dispose()"
        ),
        snapshot: method(
          'Reads value iteration and creates a new independent native Map copy on each call.',
          '读取值迭代依赖，每次创建新的独立原生映射副本。',
          {},
          t(
            'ReadonlyMap-typed shallow copy; the native Map itself is not frozen and changes to it do not mutate the collection.',
            '返回只读映射类型的浅副本；原生映射本身未冻结，对副本的修改不改变原集合。'
          ),
          "const users = new ObservableMap([['a', 1]]); console.log(users.snapshot()); users.dispose()"
        ),
        prune
      }
    },
    ObservableSet: {
      summary: t(
        'Owned reactive Set with one cell per observed member and a shared structure dependency for count and iteration.',
        '自持有的响应式成员集合，按受观察成员建立信号格，数量与迭代共享结构依赖。'
      ),
      scenarios: [
        t(
          'Observe independent selection flags without subscribing to every selected item.',
          '观察独立选择状态，无需订阅全部已选条目。'
        )
      ],
      example: setExample,
      members: {
        ...lifecycle,
        size: {
          summary: t(
            'Current unique member count, read through the structure dependency.',
            '当前唯一成员数量，通过结构依赖读取。'
          )
        },
        has: method(
          'Reads one membership and lazily creates its boolean cell only while the owning Runtime tracks.',
          '读取单个成员存在性，仅在所属运行时追踪时按需建立布尔信号格。',
          { value },
          t(
            'Whether native Set semantics find the selected member.',
            '返回按原生成员集合语义是否存在所选成员。'
          ),
          "const tags = new ObservableSet(['a']); console.log(tags.has('a')); tags.dispose()"
        ),
        add: method(
          'Adds an admitted member and notifies its cell and structure; existing membership is unchanged.',
          '添加获准成员并通知其信号格与结构；已有成员保持不变。',
          { value },
          t('This same ObservableSet for chaining.', '返回同一响应式集合，以便继续链式添加。'),
          "const tags = new ObservableSet(['a']); tags.add('b').add('c'); tags.dispose()"
        ),
        delete: method(
          'Removes an admitted member, updates structure and retains observed missing-membership cells.',
          '移除获准成员、更新结构，并保留受观察的缺失成员信号格。',
          { value },
          t(
            'True only when the member existed before removal.',
            '仅移除前确实存在所选成员时返回真。'
          ),
          "const tags = new ObservableSet(['a']); console.log(tags.delete('a')); tags.dispose()"
        ),
        clear: method(
          'Removes all members in one batch and updates materialized membership cells plus structure.',
          '在一次批处理中移除所有成员，更新已物化成员信号格与结构。',
          {},
          t(
            'Nothing; membership is empty and affected observations are invalidated.',
            '无返回值；成员已清空，受影响观察已失效。'
          ),
          "const tags = new ObservableSet(['a']); tags.clear(); tags.dispose()"
        ),
        replace: method(
          'Materializes the iterable before swapping membership in one batch; only identical membership in identical iteration order avoids a structure update.',
          '先物化可迭代值，再在一次批处理中交换成员；仅成员与迭代顺序均相同时不提升结构修订。',
          {
            next: t(
              'Complete replacement iterable; duplicate values collapse using native Set semantics.',
              '完整替换可迭代值，重复值按原生成员集合语义合并。'
            )
          },
          t(
            'Nothing; replacement membership is committed after input preparation.',
            '无返回值；输入准备完成后已提交替换成员集。'
          ),
          "const tags = new ObservableSet(['a']); tags.replace(['b', 'c']); tags.dispose()"
        ),
        valuesArray: method(
          'Reads structure and returns a shallow-frozen array in Set iteration order.',
          '读取结构，按原生成员迭代顺序返回浅冻结数组。',
          {},
          t(
            'Frozen top-level member list; nested objects retain identity.',
            '返回顶层冻结成员列表，嵌套对象保留身份。'
          ),
          "const tags = new ObservableSet(['a']); console.log(tags.valuesArray()); tags.dispose()"
        ),
        snapshot: method(
          'Reads structure and creates a fresh independent native Set copy.',
          '读取结构，创建新的独立原生成员集合副本。',
          {},
          t(
            'ReadonlySet-typed shallow copy; the native Set is not frozen, and mutating it does not affect the source collection.',
            '返回只读集合类型的浅副本；原生集合未冻结，修改副本不影响源集合。'
          ),
          "const tags = new ObservableSet(['a']); console.log(tags.snapshot()); tags.dispose()"
        ),
        prune: {
          ...prune,
          example:
            "const tags = new ObservableSet(['a']); tags.delete('a'); console.log(tags.prune()); tags.dispose()"
        }
      }
    }
  },
  enums: {
    IndexedOperation: {
      summary: t(
        'Consumer diagnostic operation vocabulary; not a mutation admission policy.',
        '消费方诊断操作词表，不是变更接纳策略。'
      ),
      values: {
        read: t(
          'Classify an operation that observes data without changing it.',
          '分类为仅观察数据、不修改内容的操作。'
        ),
        write: t(
          'Classify an insertion or value replacement operation.',
          '分类为插入新值或替换已有值的操作。'
        ),
        delete: t(
          'Classify an operation removing a key or member.',
          '分类为移除已有键或成员的操作。'
        )
      }
    },
    StoreIndexedErrorCode: {
      summary: t(
        'Stable codes owned by the explicit observable collection package.',
        '显式响应式集合包拥有的稳定错误码。'
      ),
      values: {
        invalidOption: t(
          'Invalid constructor options, input/iterator shape, debugName, object key or updater; fix the supplied value.',
          '构造选项、输入或迭代器形状、诊断名、对象键或更新函数非法，应修正传入值。'
        ),
        collectionDisposed: t(
          'Data access after terminal collection disposal; create a new collection.',
          '集合终态释放后继续访问数据，应创建新的集合。'
        ),
        callbackFailed: t(
          'An unclassified synchronous mutation guard or updater fails; existing foreign identities stay unchanged, and original values remain reachable. The outer mutation is not committed.',
          '同步变更守卫或更新函数发生未分类失败；已有外包身份保持不变，原始值仍可追溯；本次外层写入不提交。'
        ),
        indexOutOfRange: t(
          'Array set index falls outside existing nonnegative positions.',
          '数组设置下标超出现有非负位置范围。'
        ),
        invalidIndex: t(
          'Array at or set received a noninteger index.',
          '数组读取或设置接收到非整数下标。'
        ),
        crossRuntime: t(
          'A tracked value read attempts to connect another Runtime graph.',
          '追踪值读取试图连接另一个运行时依赖图。'
        )
      }
    }
  },
  enhancers: {}
}
