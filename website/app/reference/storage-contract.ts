/**
 * Reference documentation of `@migaia/storage-contract`. Rules: `app/reference/contract.ts`.
 * Verified against every public barrel and all 17 source modules on 2026-10-17. Source
 * clarifications: capability/store inspection results and codec snapshots are not frozen, despite
 * some immutable/unchanged wording in their JSDoc or README. Operation-context snapshots are frozen
 * and reused by identity. A codec snapshot copies functions without binding them to their original
 * receiver. The collections codec ignores optional operation context parameters. Error backend/key
 * details are direct instance fields, not an error.details object.
 */
import type { ILibraryReference, IMemberDoc, IText } from './contract.js'

/** Creates the localized versions of a source-backed reference sentence. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** An existing implementation is supplied by the application; this package only narrows it. */
const storeExample = `import { asRecordStore, type IKeyValueStore } from '@migaia/storage-contract'

async function saveProfile(store: IKeyValueStore) {
  await store.set('theme', 'dark', { conflictPolicy: 'replace' })
  console.log(await store.get('theme'))
  const records = asRecordStore<{ name: string }>(store)
  await records.putRecord({ name: 'Ada' }, 'profile', { conflictPolicy: 'replace' })
  console.log(await records.getRecord('profile'))
}`

/** Collection encoding demonstrates both codec operations without requiring a storage backend. */
const codecExample = `import { collectionsJsonCodec } from '@migaia/storage-contract'

const raw = await collectionsJsonCodec.encode(new Map([['theme', 'dark']]))
const value = await collectionsJsonCodec.decode(raw)
console.log(value instanceof Map)`

/** Index handles always come from the same backend that executes subsequent index operations. */
const indexExample = `const indexed = asSecondaryIndexRecordStore<{ name: string }>(records)
const handle = await indexed.ensureRecordIndexes('users', [
  { name: 'byName', unique: false, multiEntry: false, revision: 1 }
])
await indexed.putIndexedRecord(
  { name: 'Ada' }, 'user-1', handle,
  { byName: { kind: 'single', key: 'Ada' } },
  { conflictPolicy: 'replace' }
)
for await (const [key, value] of indexed.iterateRecordIndex({ handle, index: 'byName' })) {
  console.log(key, value)
}`

/** Backend labels describe implementations; capability flags select supported operations. */
const backendValues = {
  local: t(
    'Local browser key-value storage whose data normally survives browsing sessions.',
    '浏览器本地键值存储，数据通常可跨浏览会话保留。'
  ),
  session: t(
    'Session-scoped browser key-value storage with the host’s session lifetime.',
    '浏览器会话范围的键值存储，生命周期由宿主会话决定。'
  ),
  cookie: t(
    'Cookie storage subject to document visibility, scope and small value limits.',
    '受文档可见性、作用域与较小值上限约束的网页小型存储。'
  ),
  indexeddb: t(
    'Structured browser database backend; inspect capability flags before using record extensions.',
    '浏览器结构化数据库后端，使用记录扩展前应检查能力标志。'
  ),
  memory: t(
    'In-process memory implementation whose data lifetime is owned by the concrete backend.',
    '进程内存实现，数据生命周期由具体后端持有。'
  )
}

/** Both public conflict tables expose the same value semantics without sharing object identity. */
const conflictValues = {
  conflict: t(
    'Reject a write colliding with an existing key instead of replacing its value.',
    '写入与已有键冲突时拒绝，不替换原有值。'
  ),
  replace: t(
    'Permit replacing the value at an existing key under the backend’s commit rules.',
    '按后端提交规则允许替换已有键对应的值。'
  )
}

/** Shared write-policy field used by asynchronous, synchronous and transactional writes. */
const conflictMember: IMemberDoc = {
  summary: t(
    'Caller-selected `IConflictPolicy` deciding whether an existing key is a conflict or an intentional replacement.',
    '调用方选择的 `IConflictPolicy`，决定已有键应产生冲突还是允许显式替换。'
  ),
  default: t(
    '`conflict`: reject an existing-key collision unless replacement is requested.',
    '`conflict`：除非明确要求替换，否则拒绝已有键冲突。'
  ),
  values: { enum: 'ConflictPolicy' }
}

/** Operation fields validate intent; concrete backends own execution and cancellation timing. */
const operationMembers: Readonly<Record<string, IMemberDoc>> = {
  signal: {
    summary: t(
      'Structural `IAbortSignal` from the caller’s controller or parent operation. Cancellation-aware implementations stop waiting with `ABORTED`; this type alone does not interrupt a physical commit.',
      '来自调用方控制器或父操作的结构 `IAbortSignal`。支持取消的实现以 `ABORTED` 停止等待；类型本身不会中断物理提交。'
    ),
    default: t(
      'Omitted: no external cancellation signal is requested.',
      '省略时不请求外部取消信号。'
    )
  },
  timeoutMs: {
    summary: t(
      'Caller-selected nonnegative safe integer milliseconds. A backend may compose it with signal so the first cancellation wins; the contract package only validates this field.',
      '调用方选择的非负安全整数毫秒数。后端可与信号组合并采用先触发的取消；契约包只校验字段。'
    ),
    default: t(
      'Omitted: no per-operation timeout is requested.',
      '省略时不请求每次操作的超时预算。'
    )
  },
  pageSize: {
    summary: t(
      'Caller-selected iterator page size, an integer from 1 through 4096; actual page acquisition belongs to the selected backend.',
      '调用方选择的迭代分页大小，必须为一至四千零九十六的整数；实际分页获取由后端负责。'
    ),
    default: t(
      'Omitted: leave page size to the backend implementation.',
      '省略时由后端实现选择分页大小。'
    )
  }
}

/** Common inputs for methods of an externally supplied storage implementation. */
const contextParam = t(
  'Optional `IOperationContext` authored by the caller; omitted means no explicit cancellation, timeout or paging override.',
  '调用方编写的可选 `IOperationContext`；省略时不显式覆盖取消、超时或分页设置。'
)

/** Write contexts combine operation intent with explicit existing-key policy. */
const writeContextParam = t(
  'Optional caller-authored `IWriteOptions`; operation fields are optional and conflict policy defaults to conflict.',
  '调用方编写的可选 `IWriteOptions`；操作字段可省略，冲突策略默认为冲突拒绝。'
)

/** String channel keys are application-selected and are not generated by the contract package. */
const stringKeyParam = t(
  'String key selected by the application for this channel; the same spelling identifies a later read or removal.',
  '应用为此通道选定的字符串键；后续读取或移除时使用相同拼写。'
)

/** Structured record keys use the backend-neutral domain validated by the key helpers. */
const recordKeyParam = t(
  'Application-selected `IStorageKey`, or a key returned by the same backend’s record write; preserve its logical value across later operations.',
  '应用选定的 `IStorageKey`，或同一后端记录写入返回的键；后续操作保留相同逻辑值。'
)

/** L0 methods describe the contract without promising an implementation supplied by this package. */
const storeMembers: Readonly<Record<string, IMemberDoc>> = {
  backend: {
    summary: t(
      'Implementation family declared by the backend; use capabilities rather than this label to choose optional operations.',
      '后端声明的实现家族；选择可选操作时使用能力描述，不仅依赖此标签。'
    ),
    values: backendValues
  },
  capabilities: {
    summary: t(
      'Backend-supplied `IStorageCapabilities` describing callable channels and their limits; admission snapshots these facts once.',
      '后端提供的 `IStorageCapabilities`，描述可调用通道与限制；接纳时对这些事实读取一次。'
    )
  },
  get: {
    summary: t(
      'Reads a string value from the L0 channel of the supplied backend, using optional operation intent.',
      '从所提供后端的基础通道读取字符串值，可携带可选操作上下文。'
    ),
    params: { key: stringKeyParam, ctx: contextParam },
    returns: t(
      'A promise of the stored string, or null when the key is absent; backend failures reject.',
      '已存字符串的异步结果，键不存在时为空对象值；后端失败会拒绝。'
    ),
    example: `console.log(await store.get('theme'))`
  },
  set: {
    summary: t(
      'Writes one string value through the supplied backend’s commit path and selected existing-key policy.',
      '通过所提供后端的提交路径写入一个字符串值，并采用选定的已有键策略。'
    ),
    params: {
      key: stringKeyParam,
      value: t(
        'Application-produced string payload; encode non-string data before using this channel.',
        '应用产生的字符串载荷；非字符串数据须先编码再使用此通道。'
      ),
      ctx: writeContextParam
    },
    returns: t(
      'A `Promise<void>` settling with the backend write; a conflict or backend failure rejects.',
      '随后端写入结算的 `Promise<void>`；冲突或后端失败会拒绝。'
    ),
    example: `await store.set('theme', 'dark', { conflictPolicy: 'replace' })`
  },
  remove: {
    summary: t(
      'Removes the application-selected string entry from the supplied backend’s value channel.',
      '从所提供后端的值通道移除应用指定的字符串条目。'
    ),
    params: { key: stringKeyParam, ctx: contextParam },
    returns: t(
      'A `Promise<void>` indicating removal has settled; backend failures reject.',
      '表示移除已结算的 `Promise<void>`；后端失败会拒绝。'
    ),
    example: `await store.remove('theme')`
  },
  has: {
    summary: t(
      'Checks whether one string-channel key currently exists in the backend.',
      '检查后端当前是否存在一个字符串通道键，不读取该键的业务载荷。'
    ),
    params: { key: stringKeyParam, ctx: contextParam },
    returns: t(
      'A promise of the existence flag for the selected key.',
      '所选键存在标志的异步结果。'
    ),
    example: `console.log(await store.has('theme'))`
  },
  keys: {
    summary: t(
      'Lists visible string-channel keys from the backend; visibility and opaque entries remain backend capabilities.',
      '列出后端可见的字符串通道键；可见性和不透明条目仍由后端能力决定。'
    ),
    params: { ctx: contextParam },
    returns: t(
      'A promise of visible string keys; ordering is not fixed by this interface.',
      '可见字符串键数组的异步结果；此接口不规定排列顺序。'
    ),
    example: `console.log(await store.keys())`
  },
  clearValues: {
    summary: t(
      'Clears the backend’s string value channel while leaving distinct byte and record channels to their own clear operations.',
      '清空后端字符串值通道；独立字节和记录通道由各自清空操作负责。'
    ),
    params: { ctx: contextParam },
    returns: t(
      'A `Promise<void>` settling after value-channel clearing.',
      '值通道清空后结算的 `Promise<void>`。'
    ),
    example: `await store.clearValues()`
  },
  clearAll: {
    summary: t(
      'Clears every data channel owned by the concrete store, including record and byte channels when present.',
      '清空具体存储持有的全部数据通道，包括存在时的记录和字节通道。'
    ),
    params: { ctx: contextParam },
    returns: t(
      'A `Promise<void>` for the concrete backend’s full clear operation.',
      '具体后端完整清空操作的 `Promise<void>`。'
    ),
    example: `await store.clearAll()`
  },
  dispose: {
    summary: t(
      'Releases the concrete store’s resources and ends its usable lifetime. Later operations fail with the storage contract disposed code; this package does not provide a disposal engine.',
      '释放具体存储资源并结束可用生命周期。后续操作按契约以存储已释放错误码失败；本包不提供释放引擎。'
    ),
    returns: t(
      'A `Promise<void>` owned by the backend; cleanup completion and repeated-call behavior are defined by that implementation.',
      '后端持有的 `Promise<void>`；清理完成和重复调用行为由具体实现定义。'
    ),
    example: `await store.dispose()`
  },
  sync: {
    summary: t(
      'Optional synchronous string channel supplied only by synchronous backends; asynchronous stores expose undefined.',
      '只有同步后端提供的可选同步字符串通道；异步存储提供空值。'
    ),
    default: t(
      'Absent when the backend does not provide synchronous access.',
      '后端不提供同步访问时缺失。'
    )
  }
}

/** L1 members extend the same store object with bytes, records and atomic callback scope. */
const recordMembers: Readonly<Record<string, IMemberDoc>> = {
  ...storeMembers,
  getBytes: {
    summary: t(
      'Reads one binary value from the record-capable backend’s separate byte channel.',
      '从具备记录能力后端的独立字节通道读取一个二进制值。'
    ),
    params: { key: stringKeyParam, ctx: contextParam },
    returns: t(
      'A promise of `Uint8Array` bytes or null when absent.',
      '`Uint8Array` 字节的异步结果，不存在时为空对象值。'
    ),
    example: `console.log(await records.getBytes('image'))`
  },
  setBytes: {
    summary: t(
      'Writes bytes through the binary channel with explicit existing-key conflict handling.',
      '通过二进制通道写入字节，并显式处理已有键冲突。'
    ),
    params: {
      key: stringKeyParam,
      value: t(
        'Caller-supplied `Uint8Array` payload for the byte channel.',
        '调用方为字节通道提供的 `Uint8Array` 载荷。'
      ),
      ctx: writeContextParam
    },
    returns: t(
      'A `Promise<void>` settling with the binary write.',
      '随二进制写入结算的 `Promise<void>`。'
    ),
    example: `await records.setBytes('image', new Uint8Array([1, 2]), { conflictPolicy: 'replace' })`
  },
  clearBytes: {
    summary: t(
      'Clears the backend’s byte channel without selecting the separate record or text channels.',
      '清空后端字节通道，不选择独立的记录或文本通道。'
    ),
    params: { ctx: contextParam },
    returns: t(
      'A `Promise<void>` completing byte-channel clearing.',
      '字节通道清空完成的 `Promise<void>`。'
    ),
    example: `await records.clearBytes()`
  },
  getRecord: {
    summary: t(
      'Reads a structured record by the caller’s backend-neutral key, preserving the backend’s stored value type.',
      '按调用方的后端无关键读取结构化记录，保持后端存储值类型。'
    ),
    params: { key: recordKeyParam, ctx: contextParam },
    returns: t(
      'A promise of the record or undefined when absent.',
      '记录的异步结果，不存在时为空值。'
    ),
    example: `console.log(await records.getRecord('profile'))`
  },
  putRecord: {
    summary: t(
      'Writes one structured record and returns its actual record key; key generation is owned by the backend.',
      '写入一条结构化记录并返回实际记录键；键生成属于后端职责。'
    ),
    params: {
      value: t(
        'Application-created record matching the store’s TValue type.',
        '应用创建、满足存储值类型的记录。'
      ),
      key: t(
        'Optional application-selected key or a key from an earlier write; omission requests the backend’s key-selection behavior.',
        '应用选定的可选键或之前写入返回的键；省略时请求后端选择键。'
      ),
      ctx: writeContextParam
    },
    returns: t(
      'A promise of the actual `IStorageKey`; use that result for later reads and deletion.',
      '实际 `IStorageKey` 的异步结果；后续读取和删除使用此结果。'
    ),
    example: `const key = await records.putRecord({ name: 'Ada' }, 'profile', { conflictPolicy: 'replace' })
console.log(await records.getRecord(key))`
  },
  deleteRecord: {
    summary: t(
      'Deletes one structured record using the same key domain as record reads and writes.',
      '使用与记录读写相同的键域删除一条结构化记录。'
    ),
    params: { key: recordKeyParam, ctx: contextParam },
    returns: t(
      'A `Promise<void>` settling with the backend’s record deletion.',
      '随后端记录删除结算的 `Promise<void>`。'
    ),
    example: `await records.deleteRecord('profile')`
  },
  clearRecords: {
    summary: t(
      'Clears structured records while keeping the backend’s independent string and byte channels separate.',
      '清空结构化记录，同时与后端独立的字符串和字节通道分离。'
    ),
    params: { ctx: contextParam },
    returns: t(
      'A `Promise<void>` completing record-channel clearing.',
      '记录通道清空完成的 `Promise<void>`。'
    ),
    example: `await records.clearRecords()`
  },
  metadata: {
    summary: t(
      'Optional backend-owned maintenance channel with async get, set and delete by string key. Get resolves unknown or undefined; writes accept normal write options. Metadata lifetime belongs to the backend.',
      '可选后端维护通道，按字符串键异步读取、写入和删除。读取返回未知值或空值，写入接受普通写选项；元数据生命周期由后端持有。'
    ),
    default: t(
      'Omitted: this backend provides no public maintenance metadata channel.',
      '省略时此后端不提供公开维护元数据通道。'
    ),
    example: `await records.metadata?.set('migration', { cursor: 1 }, { conflictPolicy: 'replace' })
console.log(await records.metadata?.get('migration'))
await records.metadata?.delete('migration')`
  },
  iterateRecords: {
    summary: t(
      'Streams key-record pairs within optional key bounds; the backend owns paging and iterator cleanup.',
      '在可选键边界内逐个产出键与记录；后端负责分页和迭代器清理。'
    ),
    params: {
      range: t(
        'Optional caller-authored `IKeyRange`; omitted means no explicit bounds.',
        '调用方编写的可选 `IKeyRange`；省略时不指定边界。'
      ),
      ctx: contextParam
    },
    returns: t(
      'An `AsyncIterableIterator` of `[IStorageKey, TValue]`; stop consumption normally so backend cleanup can run.',
      '产出 `[IStorageKey, TValue]` 的异步迭代器；应正常结束消费，以便后端运行清理。'
    ),
    example: `for await (const [key, value] of records.iterateRecords({ lower: 'a', upper: 'z' })) console.log(key, value)`
  },
  transaction: {
    summary: t(
      'Runs a caller-authored async callback with an `ITransactionScope` supplied by the backend. The backend owns commit and rollback; callback rejection aborts that transaction path.',
      '用后端提供的 `ITransactionScope` 执行调用方异步回调。后端负责提交与回滚；回调拒绝会中止该事务路径。'
    ),
    params: {
      run: t(
        'Async `(tx) => result` callback; tx comes from this transaction and must not escape its callback lifetime.',
        '异步 `(tx) => result` 回调；事务上下文由本次事务传入，不得逃逸回调生命周期。'
      ),
      ctx: contextParam
    },
    returns: t(
      'A `Promise<T>` for the callback result after the backend’s transaction outcome is known; failure rejects.',
      '后端事务结局已知后的回调结果 `Promise<T>`；失败会拒绝。'
    ),
    example: `await records.transaction(async (tx) => {
  const value = await tx.get('profile')
  if (value) await tx.put(value, 'profile', { conflictPolicy: 'replace' })
})`
  }
}

/** Scoped record operations remain valid only while their backend-owned transaction callback runs. */
const transactionMembers: Readonly<Record<string, IMemberDoc>> = {
  get: {
    summary: t(
      'Reads one record within the current transaction’s backend-owned view.',
      '在当前事务后端持有的视图中读取一条记录，不创建独立事务。'
    ),
    params: { key: recordKeyParam },
    returns: t(
      'A promise of the transactional record or undefined when absent.',
      '事务记录的异步结果，不存在时为空值。'
    ),
    example: `await records.transaction(async (tx) => { console.log(await tx.get('profile')) })`
  },
  put: {
    summary: t(
      'Writes a record within the current transaction; it shares that transaction’s final commit or rollback.',
      '在当前事务内写入记录，共享该事务最终的提交或回滚。'
    ),
    params: {
      value: t('Application record to stage in this transaction.', '应用要在当前事务暂存的记录。'),
      key: t(
        'Optional application key; omission delegates key selection to the backend.',
        '可选应用键；省略时把键选择交给后端。'
      ),
      options: t(
        'Optional `ITransactionWriteOptions`; conflict policy defaults to conflict.',
        '可选 `ITransactionWriteOptions`；冲突策略默认为冲突拒绝。'
      )
    },
    returns: t(
      'The written `IStorageKey` as a promise; final durability still belongs to the enclosing transaction.',
      '写入键 `IStorageKey` 的异步结果；最终持久性仍由外层事务决定。'
    ),
    example: `await records.transaction(async (tx) => { await tx.put({ name: 'Ada' }, 'profile', { conflictPolicy: 'replace' }) })`
  },
  delete: {
    summary: t(
      'Stages removal of one record in the current transaction; the backend applies the final transaction outcome.',
      '在当前事务暂存一条记录的移除，由后端应用最终事务结局。'
    ),
    params: { key: recordKeyParam },
    returns: t(
      'A `Promise<void>` for transactional deletion, without committing the surrounding transaction early.',
      '事务删除的 `Promise<void>`，不会提前提交外层事务。'
    ),
    example: `await records.transaction(async (tx) => { await tx.delete('profile') })`
  }
}

/** Codec instance methods are also the full surface of the built-in collection codec. */
const codecMembers: Readonly<Record<string, IMemberDoc>> = {
  name: {
    summary: t(
      'Stable caller- or implementation-issued codec name used to identify the persisted format.',
      '调用方或实现提供的稳定编解码器名称，用于标识持久化格式。'
    )
  },
  output: {
    summary: t(
      'Declared raw output form used by consumers to select a route compatible with backend capabilities.',
      '声明的原始输出形式，消费者据此选择与后端能力兼容的通道。'
    ),
    values: {
      text: t(
        'Encode a string suitable for the string-value channel.',
        '编码为适合字符串值通道的文本。'
      ),
      binary: t(
        'Encode bytes for a backend providing binary storage.',
        '为提供二进制存储的后端编码字节。'
      ),
      structured: t(
        'Encode structured values for a record-capable backend.',
        '为具备记录能力的后端编码结构化值。'
      )
    }
  },
  encode: {
    summary: t(
      'Encodes the caller’s domain value to the codec’s raw representation; the implementation returns a promise and rejects encoding failures.',
      '把调用方领域值编码为编解码器原始表达；实现返回异步结果，编码失败会拒绝。'
    ),
    params: {
      value: t(
        'Domain value created by the application, matching the codec’s T input.',
        '应用创建且满足编解码器输入类型的领域值。'
      ),
      ctx: contextParam
    },
    returns: t(
      'A promise of the raw output form declared by output; failure rejects with the implementation’s error contract.',
      '声明输出形式的原始结果异步值；失败按具体实现的错误契约拒绝。'
    ),
    example: codecExample
  },
  decode: {
    summary: t(
      'Decodes raw persisted data into the domain representation; malformed data rejects rather than becoming a successful fallback.',
      '把原始持久化数据解码为领域表达；格式错误会拒绝，不会变成成功后备值。'
    ),
    params: {
      raw: t(
        'Raw value produced by the matching codec or read from its persisted format.',
        '匹配编解码器产生或从对应持久化格式读取的原始值。'
      ),
      ctx: contextParam
    },
    returns: t(
      'A promise of the decoded T value, or a rejection under the codec’s implementation contract.',
      '解码后领域值的异步结果，或按编解码器实现契约拒绝。'
    ),
    example: codecExample
  }
}

/** Parameters shared by neutral key validation helpers. */
const keyValidationParams = {
  value: t(
    'Unknown candidate supplied by the application; the helper validates rather than coercing it.',
    '应用提供的未知候选值；辅助函数执行校验，不进行强制转换。'
  ),
  backend: t(
    'Backend family selected by the caller, normally read from store.backend; it labels errors and does not narrow the key domain.',
    '调用方选定的后端家族，通常读取存储后端字段；用于错误标注，不缩窄键域。'
  ),
  label: t(
    'Optional caller-selected diagnostic field name; defaults to key and affects error text only.',
    '调用方指定的可选诊断字段名；默认为键字段名，只影响错误文本。'
  )
}

/** Error fields stay on the frozen native error; the original cause remains independently reachable. */
const errorMembers: Readonly<Record<string, IMemberDoc>> = {
  source: {
    summary: t(
      'Fixed `STORAGE_CONTRACT_SOURCE` marker identifying this package’s contract errors.',
      '固定 `STORAGE_CONTRACT_SOURCE` 标记，用于识别本包契约错误。'
    )
  },
  code: {
    summary: t(
      'Semantic code selected from `StorageContractErrorCode`; interpret together with the source marker.',
      '从 `StorageContractErrorCode` 选择的语义码，应与来源标记共同解释。'
    )
  },
  backend: {
    summary: t(
      'Optional backend label supplied in construction details; absent when the producer cannot establish a backend.',
      '构造详情提供的可选后端标签；生产者无法确认后端时缺失。'
    ),
    values: backendValues
  },
  key: {
    summary: t(
      'Optional original application key retained in construction details for diagnosis, not a generated replacement.',
      '构造详情保留的可选原始应用键，用于诊断，不是生成的替换键。'
    )
  }
}

/** Complete bilingual contract reference; implementations remain external consumers. */
export const storageContractReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Runtime-neutral storage shapes, capability narrowing, key validation, codecs, operation contexts and errors. Start with `IKeyValueStore` for an injected backend, use `asRecordStore()` when structured storage is required, or `snapshotCodec()` at a codec admission boundary. This package opens no database.',
        '提供运行时无关的存储结构、能力收窄、键校验、编解码器、操作上下文和错误。注入后端从 `IKeyValueStore` 开始，需要结构化存储时用 `asRecordStore()`，编解码器接纳边界用 `snapshotCodec()`；本包不打开数据库。'
      ),
      example: storeExample
    }
  },
  symbols: {
    asRecordStore: {
      role: 'operation',
      purpose: t(
        'Checks a supplied L0 store for the full record, binary, transaction and iteration surface. Returns the original object after capability narrowing, and fails explicitly instead of constructing a backend or silently falling back.',
        '检查所提供基础存储是否具备完整记录、二进制、事务和迭代表面。能力收窄后返回原对象；不创建后端，也不静默降级，失败会明确抛错。'
      ),
      params: {
        store: t(
          'Existing application-supplied `IKeyValueStore`, obtained from a concrete backend package.',
          '应用从具体后端包取得的既有 `IKeyValueStore`。'
        )
      },
      returns: t(
        'The exact store as `IRecordStore<T>`; insufficient shape or capabilities throws `UNSUPPORTED_CAPABILITY`.',
        '同一个存储，收窄为 `IRecordStore<T>`；形状或能力不足时抛 `UNSUPPORTED_CAPABILITY`。'
      ),
      example: storeExample
    },
    asSecondaryIndexRecordStore: {
      role: 'operation',
      purpose: t(
        'Narrows a record store only when its secondaryIndexes capability and all five index operations are present. Index projection and persistence remain owned by the backend implementation.',
        '仅在记录存储具有二级索引能力且全部五个索引操作存在时收窄。索引投影与持久化仍由具体后端实现负责。'
      ),
      params: {
        store: t(
          'Existing `IRecordStore<T>` supplied by the application or returned by `asRecordStore()`.',
          '应用提供或由 `asRecordStore()` 返回的既有 `IRecordStore<T>`。'
        )
      },
      returns: t(
        'The original store as `ISecondaryIndexRecordStore<T>`; missing capability or methods throws `UNSUPPORTED_CAPABILITY`.',
        '原存储收窄为 `ISecondaryIndexRecordStore<T>`；缺少能力或方法时抛 `UNSUPPORTED_CAPABILITY`。'
      ),
      example: indexExample
    },
    asChangeFeedStore: {
      role: 'operation',
      purpose: t(
        'Narrows an existing store to its post-commit invalidation feed when changeFeed is true and subscribeChanges is callable. It does not install a listener or add change production to a backend.',
        '当变更流能力为真且订阅方法可调用时，把既有存储收窄为提交后失效通知流。本函数不安装监听，也不为后端新增变更生产能力。'
      ),
      params: {
        store: t(
          'Existing backend-owned `IKeyValueStore` supplied by the application.',
          '应用提供的既有后端所有 `IKeyValueStore`。'
        )
      },
      returns: t(
        'The exact store as `IChangeFeedStore`; incomplete feed capability throws `UNSUPPORTED_CAPABILITY`.',
        '同一个存储收窄为 `IChangeFeedStore`；变更流能力不完整时抛 `UNSUPPORTED_CAPABILITY`。'
      ),
      example: `const feed = asChangeFeedStore(store)
const unsubscribe = feed.subscribeChanges((change) => console.log(change.channel, change.kind))
await feed.set('theme', 'dark', { conflictPolicy: 'replace' })
unsubscribe()`
    },
    isKeyValueStore: {
      role: 'operation',
      purpose: t(
        'Checks an unknown object’s backend name, capability descriptor and every L0 callable method without invoking a storage operation. Accessor failures become an invalid result rather than escaping the predicate.',
        '检查未知对象的后端名称、能力描述和全部基础可调用方法，不执行存储操作。访问器失败转换为无效结果，不会逃出此判断函数。'
      ),
      params: {
        store: t(
          'Unknown candidate from application injection or an extension boundary.',
          '来自应用注入或扩展边界的未知候选值。'
        )
      },
      returns: t(
        'True when the inspected shape is a valid `IKeyValueStore`, otherwise false; this is shape admission, not behavioral verification.',
        '检查形状满足 `IKeyValueStore` 时为真，否则为假；这是形状接纳，不是行为验证。'
      ),
      example: `if (isKeyValueStore(candidate)) console.log(await candidate.get('theme'))`
    },
    isRecordStore: {
      role: 'operation',
      purpose: t(
        'Checks the complete record-store method set and required record, binary, transaction and iteration flags. Missing capability or a throwing accessor returns false without performing storage I/O.',
        '检查完整记录存储方法集及所需记录、二进制、事务和迭代标志。能力缺失或访问器抛错时返回假值，不执行存储读写。'
      ),
      params: {
        store: t(
          'Existing `IKeyValueStore` from the caller’s concrete backend.',
          '来自调用方具体后端的既有 `IKeyValueStore`。'
        )
      },
      returns: t(
        'A boolean type guard narrowing to `IRecordStore` on success.',
        '成功时收窄到 `IRecordStore` 的布尔类型守卫。'
      ),
      example: `if (isRecordStore(store)) console.log(await store.getRecord('profile'))`
    },
    isSecondaryIndexRecordStore: {
      role: 'operation',
      purpose: t(
        'Inspects the full record surface, the secondary-index flag and each index method. It admits existing capability without creating index declarations or starting backfill work.',
        '检查完整记录表面、二级索引标志与各索引方法。只接纳既有能力，不创建索引声明，也不启动回填工作。'
      ),
      params: {
        store: t(
          'Unknown application-injected candidate; non-record stores cannot pass.',
          '应用注入的未知候选值；非记录存储无法通过。'
        )
      },
      returns: t(
        'True for a complete `ISecondaryIndexRecordStore` shape, otherwise false including accessor failures.',
        '完整满足 `ISecondaryIndexRecordStore` 形状时为真，否则为假，包括访问器失败。'
      ),
      example: `if (isSecondaryIndexRecordStore(candidate)) console.log(candidate.capabilities.secondaryIndexes)`
    },
    isChangeFeedStore: {
      role: 'operation',
      purpose: t(
        'Checks the base store shape, changeFeed flag and callable change subscription method. It does not invoke the subscription or promise that an arbitrary implementation produces correct events.',
        '检查基础存储形状、变更流标志和可调用订阅方法。不调用订阅，也不保证任意实现一定产生正确事件。'
      ),
      params: {
        store: t(
          'Unknown store candidate supplied by the application or plugin boundary.',
          '应用或插件边界提供的未知存储候选值。'
        )
      },
      returns: t(
        'A boolean narrowing to `IChangeFeedStore`; access failures return false.',
        '收窄到 `IChangeFeedStore` 的布尔值；访问失败返回假值。'
      ),
      example: `if (isChangeFeedStore(candidate)) {
  const unsubscribe = candidate.subscribeChanges((change) => console.log(change.sequence))
  unsubscribe()
}`
    },
    snapshotKeyValueStore: {
      role: 'operation',
      purpose: t(
        'Reads the L0 boundary once and returns the original store with captured backend and normalized capabilities. The returned wrapper is ordinary data, while store behavior remains owned by the original object.',
        '单次读取基础存储边界，返回原存储、捕获的后端与规范化能力。返回包装是普通数据，存储行为仍由原对象持有。'
      ),
      params: {
        store: t(
          'Unknown candidate supplied by the application’s backend factory or plugin.',
          '应用后端工厂或插件提供的未知候选值。'
        )
      },
      returns: t(
        '`{ store, backend, capabilities }` on valid admission, otherwise undefined; captured capabilities are a fresh plain snapshot.',
        '接纳成功返回 `{ store, backend, capabilities }`，否则为空值；能力是新的普通字段快照。'
      ),
      example: `const snapshot = snapshotKeyValueStore(candidate)
if (snapshot) console.log(await snapshot.store.get('theme'))`
    },
    snapshotKeyValueStoreDetailed: {
      role: 'operation',
      purpose: t(
        'Performs one L0 admission while retaining the exact accessor failure for its owning boundary. A valid result also captures the raw disposer and its original receiver so later cleanup need not reread mutable accessors.',
        '执行单次基础存储接纳，并为所属边界保留精确访问器失败。有效结果还捕获原释放函数及接收者，后续清理无需重读可变访问器。'
      ),
      params: {
        store: t(
          'Unknown application-injected store candidate whose public fields are inspected once.',
          '应用注入的未知存储候选值，其公开字段被检查一次。'
        )
      },
      returns: t(
        'An `IKeyValueStoreAdmission`; invalid plain shapes carry undefined cause, while observed getter failures retain their exact thrown value.',
        '一个 `IKeyValueStoreAdmission`；普通形状无效时原因为空值，访问器失败则保留精确抛出值。'
      ),
      example: `const admission = snapshotKeyValueStoreDetailed(candidate)
if (admission.valid) await Reflect.apply(admission.dispose, admission.receiver, [])
else console.error(admission.cause)`
    },
    snapshotRecordStore: {
      role: 'operation',
      purpose: t(
        'Captures the complete L1 shape and required capabilities once, returning the original record store and normalized facts. It neither clones records nor wraps backend methods.',
        '单次捕获完整记录存储形状与所需能力，返回原记录存储和规范化事实。不会复制记录，也不包装后端方法。'
      ),
      params: {
        store: t(
          'Unknown existing store supplied by the caller; the record capability set must be complete.',
          '调用方提供的未知既有存储，必须具有完整记录能力集。'
        )
      },
      returns: t(
        '`{ store: IRecordStore<T>, backend, capabilities }` or undefined on missing shape, capability or failed access.',
        '`{ store: IRecordStore<T>, backend, capabilities }`，形状或能力缺失、访问失败时为空值。'
      ),
      example: `const snapshot = snapshotRecordStore<{ name: string }>(candidate)
if (snapshot) console.log(await snapshot.store.getRecord('profile'))`
    },
    snapshotStorageCapabilities: {
      role: 'operation',
      purpose: t(
        'Reads each capability field once and normalizes legacy missing changeFeed and secondaryIndexes flags to false. Invalid types or thrown accessors return undefined; no storage method is invoked.',
        '对各能力字段读取一次，把旧式缺失变更流和二级索引标志规范化为假。类型无效或访问器抛错时返回空值，不调用存储方法。'
      ),
      params: {
        value: t(
          'Unknown capability object issued by a concrete backend implementation.',
          '具体后端实现提供的未知能力对象。'
        )
      },
      returns: t(
        'A fresh `IStorageCapabilities` plain snapshot, or undefined; maxValueBytes must be a nonnegative safe integer or undefined.',
        '新的普通 `IStorageCapabilities` 快照或空值；单值字节上限须为非负安全整数或空值。'
      ),
      example: `const capabilities = snapshotStorageCapabilities(store.capabilities)
console.log(capabilities?.records)`
    },
    isStorageCapabilities: {
      role: 'operation',
      purpose: t(
        'Checks the runtime capability descriptor through the same single-read snapshot admission. It accepts omitted legacy change-feed and secondary-index flags without mutating the supplied object.',
        '通过相同单次快照接纳检查运行时能力描述。允许旧式描述省略变更流与二级索引标志，不修改传入对象。'
      ),
      params: {
        value: t(
          'Unknown descriptor obtained from a backend or extension boundary.',
          '从后端或扩展边界取得的未知能力描述。'
        )
      },
      returns: t(
        'True when a normalized capability snapshot can be created, otherwise false.',
        '可以创建规范化能力快照时为真，否则为假。'
      ),
      example: `console.log(isStorageCapabilities(store.capabilities))`
    },
    assertStorageKey: {
      role: 'operation',
      purpose: t(
        'Validates the IndexedDB-compatible record-key domain without coercion. It rejects invalid dates, nonfinite numbers, oversized binary keys, cyclic or empty/sparse arrays, excessive depth and excessive node count.',
        '不强制转换地校验兼容结构化数据库的记录键域。拒绝无效日期、非有限数字、过大二进制键、循环或空及稀疏数组，以及超出深度和节点上限的值。'
      ),
      params: keyValidationParams,
      returns: t(
        'No result; narrows value to `IStorageKey`, or throws `INVALID_KEY` with backend, original key and cause.',
        '没有结果；把值收窄为 `IStorageKey`，否则抛包含后端、原始键和原因的 `INVALID_KEY`。'
      ),
      example: `assertStorageKey(['users', 1], 'memory')`
    },
    snapshotStorageKey: {
      role: 'operation',
      purpose: t(
        'Validates and detaches one record key before asynchronous work can observe later caller mutation. Arrays, dates and binary buffers are copied recursively, then the copy is validated again.',
        '在异步工作观察到调用方后续修改前，校验并分离一个记录键。递归复制数组、日期和二进制缓冲区，再次校验复制结果。'
      ),
      params: keyValidationParams,
      returns: t(
        'An independent valid `IStorageKey`; invalid input or failed copying throws `INVALID_KEY` while retaining its cause.',
        '独立有效的 `IStorageKey`；输入无效或复制失败抛 `INVALID_KEY` 并保留原因。'
      ),
      example: `const original = ['users', new Date(0)]
const key = snapshotStorageKey(original, 'memory')
console.log(key !== original)`
    },
    assertStringStorageKey: {
      role: 'operation',
      purpose: t(
        'Validates the string-only key contract used by value, byte and metadata channels. It does not accept numeric or structured keys and never converts them to strings.',
        '校验值、字节和元数据通道要求的纯字符串键契约。不接受数字或结构化键，也不会把它们转换为字符串。'
      ),
      params: keyValidationParams,
      returns: t(
        'No result; narrows value to string, or throws `INVALID_ARGUMENT` with a typed cause.',
        '没有结果；把值收窄为字符串，否则抛带类型原因的 `INVALID_ARGUMENT`。'
      ),
      example: `assertStringStorageKey('theme', 'local')`
    },
    compareStorageKeys: {
      role: 'operation',
      purpose: t(
        'Compares already-valid keys by number, date, string, binary and array rank. Binary values compare lexicographically; arrays compare recursively by segments and then length. It is a comparator, not key admission.',
        '按数字、日期、字符串、二进制和数组的等级比较已有效键。二进制按字节字典序，数组按段递归比较后再比较长度。本函数负责比较，不负责接纳键。'
      ),
      params: {
        a: t(
          'First valid `IStorageKey`, obtained from application input validation or backend record keys.',
          '来自应用输入校验或后端记录键的第一个有效 `IStorageKey`。'
        ),
        b: t(
          'Second valid `IStorageKey` using the same domain as the first.',
          '与首个键采用相同键域的第二个有效 `IStorageKey`。'
        )
      },
      returns: t(
        'A negative, zero or positive number for ascending ordering; the magnitude is not restricted to one.',
        '升序比较的负数、零或正数；结果绝对值不限定为一。'
      ),
      example: `const keys: IStorageKey[] = [2, 1, 'a']
keys.sort(compareStorageKeys)`
    },
    KEY_DOMAIN_LIMITS: {
      role: 'constant',
      purpose: t(
        'Frozen public bounds used by record-key validation: root depth starts at zero, every visited node counts, and the binary byte limit applies to each buffer. Consumers can report these constraints before constructing keys.',
        '记录键校验使用的冻结公开上限：根深度从零计数，每个访问节点均计数，二进制字节限制逐缓冲区适用。消费者可以在构造键前展示这些约束。'
      ),
      example: `console.log(KEY_DOMAIN_LIMITS.maxDepth, KEY_DOMAIN_LIMITS.maxNodes, KEY_DOMAIN_LIMITS.maxBinaryBytes)`
    },
    snapshotOperationContext: {
      role: 'operation',
      purpose: t(
        'Reads cancellation, timeout, paging and optional conflict policy once, validates them and freezes a field snapshot. Snapshots created by this helper are recognized and returned by identity on later calls.',
        '单次读取取消、超时、分页及可选冲突策略，完成校验后冻结字段快照。此函数创建的快照会被识别，后续调用原样返回同一身份。'
      ),
      params: {
        ctx: t(
          'Caller-authored `IOperationContext` optionally including conflictPolicy, or undefined; no timers or signal subscriptions start during validation.',
          '调用方编写、可附带冲突策略的 `IOperationContext`，或空值；校验不会启动定时器或信号订阅。'
        )
      },
      returns: t(
        'An `IOperationContextSnapshot`, or undefined for omitted context; malformed values throw `INVALID_ARGUMENT` retaining the original accessor cause.',
        '一个 `IOperationContextSnapshot`，省略上下文时为空值；格式错误抛 `INVALID_ARGUMENT` 并保留原访问器原因。'
      ),
      example: `const context = snapshotOperationContext({ timeoutMs: 500, pageSize: 100 })
console.log(snapshotOperationContext(context) === context)`
    },
    assertOperationContext: {
      role: 'operation',
      purpose: t(
        'Validates operation context through the canonical snapshot path, then discards the snapshot. It is useful at a backend boundary that only needs rejection of invalid input before resource acquisition.',
        '通过统一快照路径校验操作上下文，然后丢弃快照。适用于后端只需在取得资源前拒绝无效输入的边界。'
      ),
      params: {
        ctx: t(
          'Caller-supplied operation context, optional conflict policy included, or undefined for no overrides.',
          '调用方操作上下文，可含冲突策略；无覆盖设置时传空值。'
        )
      },
      returns: t(
        'No result; throws `INVALID_ARGUMENT` for malformed fields or failed access.',
        '没有结果；字段格式错误或访问失败时抛 `INVALID_ARGUMENT`。'
      ),
      example: `assertOperationContext({ timeoutMs: 500 })`
    },
    snapshotSyncWriteOptions: {
      role: 'operation',
      purpose: t(
        'Reads synchronous write options once and rejects supplied cancellation or timeout values. Only conflict policy is returned; the plain result preserves omission rather than inserting a default policy.',
        '单次读取同步写选项，拒绝已提供的取消或超时值。只返回冲突策略；普通结果保留缺失状态，不自行补入默认策略。'
      ),
      params: {
        options: t(
          'Unknown caller-supplied options object or undefined; signal and timeoutMs must be absent or undefined.',
          '调用方提供的未知选项对象或空值；信号和超时必须缺失或为空值。'
        )
      },
      returns: t(
        'A fresh `{ conflictPolicy? }` object; invalid shape, policy or access throws `INVALID_ARGUMENT`.',
        '新的 `{ conflictPolicy? }` 对象；形状、策略或访问无效时抛 `INVALID_ARGUMENT`。'
      ),
      example: `console.log(snapshotSyncWriteOptions({ conflictPolicy: 'replace' }))`
    },
    assertSyncWriteOptions: {
      role: 'operation',
      purpose: t(
        'Runs the same reduced synchronous-write validation and discards its captured policy. This ensures synchronous channels cannot appear to honor asynchronous cancellation options.',
        '执行相同的精简同步写校验并丢弃捕获策略，确保同步通道不会看似支持异步取消选项。'
      ),
      params: {
        options: t(
          'Unknown application-authored synchronous write options, or undefined.',
          '应用编写的未知同步写选项，或空值。'
        )
      },
      returns: t(
        'No result; invalid fields throw `INVALID_ARGUMENT` before a backend write begins.',
        '没有结果；无效字段在后端写入前抛 `INVALID_ARGUMENT`。'
      ),
      example: `assertSyncWriteOptions({ conflictPolicy: 'replace' })`
    },
    assertTransactionCallback: {
      role: 'operation',
      purpose: t(
        'Checks only that the transaction callback is a function before a backend allocates transaction state. It does not invoke the callback or validate its eventual result.',
        '仅检查事务回调是否为函数，以便后端在分配事务状态前拒绝无效输入。不调用回调，也不校验最终结果。'
      ),
      params: {
        run: t(
          'Unknown callback supplied by the application for a backend transaction.',
          '应用为后端事务提供的未知回调。'
        ),
        backend: keyValidationParams.backend
      },
      returns: t(
        'No result for a function; otherwise `INVALID_ARGUMENT` with backend and native TypeError cause.',
        '函数输入没有结果；否则抛包含后端和原生类型错误原因的 `INVALID_ARGUMENT`。'
      ),
      example: `const run = async (tx: ITransactionScope) => tx.get('profile')
assertTransactionCallback(run, 'memory')`
    },
    readTransactionConflictPolicy: {
      role: 'operation',
      purpose: t(
        'Reads the transaction conflict policy once and applies the conflict default only after validating the options container. It does not start or commit a transaction.',
        '单次读取事务冲突策略，先校验选项容器再应用冲突默认值。本函数不启动或提交事务。'
      ),
      params: {
        options: t(
          'Unknown caller-authored `{ conflictPolicy? }` object, or undefined to request the default.',
          '调用方编写的未知 `{ conflictPolicy? }` 对象，或空值以请求默认策略。'
        ),
        backend: keyValidationParams.backend
      },
      returns: t(
        '`conflict` when omitted, otherwise the validated `conflict` or `replace`; invalid input throws `INVALID_ARGUMENT`.',
        '省略时为冲突拒绝，否则返回校验后的冲突或替换策略；无效输入抛 `INVALID_ARGUMENT`。'
      ),
      example: `console.log(readTransactionConflictPolicy(undefined, 'memory'))`
    },
    snapshotCodec: {
      role: 'operation',
      purpose: t(
        'Reads codec name, output and both methods once, checks the declared surface and returns a new plain four-field object. Functions are copied unchanged, so implementations should not require the original descriptor as receiver.',
        '单次读取编解码器名称、输出形式和两个方法，校验后返回新的普通四字段对象。函数原样复制，因此实现不应依赖原描述器接收者。'
      ),
      params: {
        codec: t(
          'Unknown caller-authored descriptor or a codec from an implementation package.',
          '调用方编写的未知描述器或具体实现包提供的编解码器。'
        )
      },
      returns: t(
        'An `ICodec` shallow snapshot; empty name, invalid output or nonfunction methods throw `INVALID_ARGUMENT`.',
        '一个 `ICodec` 浅快照；名称为空、输出无效或方法不可调用时抛 `INVALID_ARGUMENT`。'
      ),
      example: `const codec = snapshotCodec(collectionsJsonCodec)
console.log(await codec.decode(await codec.encode(new Set([1, 2]))))`
    },
    assertCodec: {
      role: 'operation',
      purpose: t(
        'Checks an unknown codec through the canonical snapshot admission and narrows its static type. It does not replace the caller’s original descriptor with the captured copy.',
        '通过统一快照接纳检查未知编解码器并收窄静态类型。不把调用方原描述器替换为捕获的副本。'
      ),
      params: {
        codec: t(
          'Unknown candidate descriptor supplied by the application or an extension.',
          '应用或扩展提供的未知候选描述器。'
        )
      },
      returns: t(
        'No result; narrows codec to `ICodec`, or throws `INVALID_ARGUMENT` with a retained cause.',
        '没有结果；把候选收窄为 `ICodec`，否则抛保留原因的 `INVALID_ARGUMENT`。'
      ),
      example: `assertCodec(candidate)
console.log(candidate.name, candidate.output)`
    },
    collectionsJsonCodec: {
      role: 'constant',
      purpose: t(
        'Frozen text codec preserving real Map and Set values with exact versioned tuples while retaining ordinary JSON behavior. It only revives its exact three-slot marker; ordinary similar arrays remain arrays. Optional operation contexts are ignored by this implementation.',
        '使用精确版本元组保留真实映射与集合的冻结文本编解码器，同时保留普通文本序列化行为。只还原精确三位置标记，相似普通数组仍为数组；此实现忽略可选操作上下文。'
      ),
      returns: t(
        'The shared `ICodec<unknown, string>` instance; encoding unsupported roots, malformed collections, non-string raw input or parse failure rejects with `INVALID_ARGUMENT` and cause.',
        '共享的 `ICodec<unknown, string>` 实例；根值不受支持、集合格式错误、原始输入非字符串或解析失败时，以带原因的 `INVALID_ARGUMENT` 拒绝。'
      ),
      example: codecExample
    },
    COLLECTIONS_JSON_CODEC_NAME: {
      role: 'constant',
      purpose: t(
        'Stable format identity `migaia-collections-json-v1` used by the collection codec name and tuple discriminator. Persist the format consistently so a different generic JSON decoder does not silently discard collection identity.',
        '集合编解码器名称与元组判别共同使用的稳定格式身份。持久化时应保持格式一致，避免其他通用解码器丢失集合身份。'
      ),
      example: `console.log(collectionsJsonCodec.name === COLLECTIONS_JSON_CODEC_NAME)`
    },
    ConflictPolicy: {
      role: 'constant',
      purpose: t(
        'Frozen public existing-key policy values consumed by write and transaction contexts. Conflict rejects an existing key; replace deliberately allows overwriting under the backend’s commit semantics.',
        '写入与事务上下文使用的冻结公开已有键策略。冲突策略拒绝已有键，替换策略按后端提交语义明确允许覆盖。'
      ),
      example: `await store.set('theme', 'dark', { conflictPolicy: ConflictPolicy.replace })`
    },
    StorageContractConflictPolicy: {
      role: 'constant',
      purpose: t(
        'Canonical declaration table for conflict and replacement values. It has the same value semantics as `ConflictPolicy`, while callers should not rely on the two table objects having identical reference identity.',
        '冲突和替换值的统一声明表。与 `ConflictPolicy` 具有相同值语义，但调用方不应依赖两个表对象的引用身份相同。'
      ),
      example: `console.log(StorageContractConflictPolicy.replace === ConflictPolicy.replace)`
    },
    StorageContractError: {
      role: 'error',
      purpose: t(
        'Constructs and freezes a native Error carrying storage-contract source, semantic code and optional backend/key context. The native stack and exact original cause remain reachable after construction.',
        '构造并冻结带存储契约来源、语义码和可选后端及键上下文的原生错误。构造后原生调用栈和精确原始原因仍保持可达。'
      ),
      params: {
        code: t(
          'Semantic error value selected from `StorageContractErrorCode` by the producer.',
          '生产者从 `StorageContractErrorCode` 选择的语义错误值。'
        ),
        details: t(
          'Optional `IStorageContractErrorDetails` containing backend, original key and cause; defaults to an empty details object.',
          '可选 `IStorageContractErrorDetails`，包含后端、原始键和原因；默认为空详情对象。'
        ),
        message: t(
          'Optional producer-selected diagnostic message; omitted uses the package prefix followed by the supplied code.',
          '生产者选择的可选诊断消息；省略时使用包前缀加上传入错误码。'
        )
      },
      returns: t(
        'A frozen `StorageContractError`; backend and key are direct fields, while cause uses the native Error chain.',
        '冻结的 `StorageContractError`；后端和键是直接字段，原因使用原生错误链。'
      ),
      example: `const cause = new TypeError('invalid key')
const error = new StorageContractError(StorageContractErrorCode.invalidKey, { backend: 'memory', key: 'profile', cause })
console.log(error.cause === cause, error.source, error.code)`
    },
    StorageContractErrorCode: {
      role: 'error',
      purpose: t(
        'Frozen table of stable contract error codes. The source/code pair identifies input, key, capability, lifecycle and cancellation failures independently of a concrete backend implementation.',
        '冻结的稳定契约错误码表。来源和错误码共同标识输入、键、能力、生命周期与取消失败，不依赖具体后端实现。'
      ),
      example: `if (isStorageContractError(error) && error.code === StorageContractErrorCode.aborted) console.log(error.cause)`
    },
    STORAGE_CONTRACT_SOURCE: {
      role: 'constant',
      purpose: t(
        'Fixed source identity attached to this package’s contract error class. Interpret an error code together with this marker when inspecting errors without relying on a shared constructor instance.',
        '本包契约错误类附加的固定来源身份。不依赖共享构造函数实例检查错误时，应把错误码与此标记共同解释。'
      ),
      example: `console.log(error.source === STORAGE_CONTRACT_SOURCE)`
    },
    isStorageContractError: {
      role: 'operation',
      purpose: t(
        'Recognizes instances of this loaded package copy’s `StorageContractError` constructor. It uses instanceof rather than structural source-code matching, so independently loaded constructors are distinct.',
        '识别当前加载包副本的 `StorageContractError` 构造函数实例。使用实例关系而非来源码结构匹配，因此独立加载的构造函数有所区别。'
      ),
      params: {
        value: t(
          'Unknown caught value supplied by the caller for inspection.',
          '调用方提供、用于检查的未知捕获值。'
        )
      },
      returns: t(
        'True only for instances recognized by the current `StorageContractError` constructor.',
        '仅当前 `StorageContractError` 构造函数识别的实例返回真值。'
      ),
      example: `if (isStorageContractError(error)) console.log(error.backend, error.code)`
    },
    isArrayBuffer: {
      role: 'operation',
      purpose: t(
        'Compatibility re-export preserving the canonical `@migaia/utils/bytes` function identity. Detects genuine ArrayBuffer internal slots across supported realms rather than trusting a mutable constructor name.',
        '保留 `@migaia/utils/bytes` 统一函数身份的兼容转出。按真实缓冲区内部槽识别受支持执行环境中的值，不信任可变构造名称。'
      ),
      params: {
        value: t(
          'Unknown candidate from the caller’s binary input boundary.',
          '来自调用方二进制输入边界的未知候选值。'
        )
      },
      returns: t(
        'A boolean narrowing to native `ArrayBuffer` for genuine matching values.',
        '真实匹配值收窄到原生 `ArrayBuffer` 的布尔结果。'
      ),
      example: `console.log(isArrayBuffer(new ArrayBuffer(1)))`
    },
    isUint8Array: {
      role: 'operation',
      purpose: t(
        'Compatibility re-export of the canonical `@migaia/utils/bytes` typed-byte predicate, preserving function identity and native internal-slot classification.',
        '统一字节工具的类型字节判断兼容转出，保留函数身份与原生内部槽分类，不依赖本包重复实现。'
      ),
      params: {
        value: t('Unknown application-supplied binary candidate.', '应用提供的未知二进制候选值。')
      },
      returns: t(
        'A boolean narrowing to genuine `Uint8Array` byte views.',
        '收窄到真实 `Uint8Array` 字节视图的布尔值。'
      ),
      example: `console.log(isUint8Array(new Uint8Array([1])))`
    },
    intrinsicConstructorName: {
      role: 'operation',
      purpose: t(
        'Best-effort diagnostic lookup through mutable prototype, constructor and name fields. It is suitable for display only and must not choose a storage type, codec or protocol branch.',
        '通过可变原型、构造函数和名称字段执行尽力诊断查询。只适合展示，不得据此选择存储类型、编解码器或协议分支。'
      ),
      params: {
        value: t('Unknown diagnostic value provided by the caller.', '调用方提供的未知诊断值。')
      },
      returns: t(
        'Observed constructor name, or undefined for nonobjects, absent name or failed access.',
        '观察到的构造名称；非对象、名称缺失或访问失败时为空值。'
      ),
      example: `console.log(intrinsicConstructorName(new Date(0)))`
    }
  },
  types: {
    IKeyValueStore: {
      summary: t(
        'Base asynchronous string-channel contract implemented by a concrete backend and admitted by the store shape helpers.',
        '具体后端实现并由存储形状辅助函数接纳的基础异步字符串通道契约。'
      ),
      scenarios: [
        t(
          'Accept an injected storage capability without importing its database or browser implementation.',
          '接收注入存储能力，而不导入其数据库或浏览器实现。'
        )
      ],
      example: storeExample,
      members: storeMembers
    },
    ISyncKeyValueStore: {
      summary: t(
        'Synchronous string channel supplied by sync-capable implementations; it supports reduced write options without cancellation or timeouts.',
        '同步能力实现提供的字符串通道；采用不包含取消或超时的精简写选项。'
      ),
      scenarios: [
        t(
          'Read synchronous persisted configuration before asynchronous application startup.',
          '异步应用启动前同步读取已持久化配置。'
        )
      ],
      example: `const sync = store.sync
if (sync) {
  sync.set('theme', 'dark', { conflictPolicy: 'replace' })
  console.log(sync.get('theme'))
}`,
      members: {
        get: {
          summary: t(
            'Synchronously reads one string value from the implementation’s synchronous channel.',
            '从实现的同步通道立即读取一个字符串值，不创建异步等待。'
          ),
          params: { key: stringKeyParam },
          returns: t(
            'The stored string, or null when absent; backend errors throw synchronously.',
            '已存字符串，不存在时为空对象值；后端错误同步抛出。'
          ),
          example: `console.log(store.sync?.get('theme'))`
        },
        set: {
          summary: t(
            'Synchronously writes a string using the selected existing-key policy; asynchronous operation fields are unsupported.',
            '按选择的已有键策略同步写字符串，不支持异步操作字段。'
          ),
          params: {
            key: stringKeyParam,
            value: t(
              'Application-produced string payload for this key.',
              '应用为此键产生的字符串载荷。'
            ),
            options: t(
              'Optional `ISyncWriteOptions`; omitted conflict policy rejects existing-key collisions.',
              '可选 `ISyncWriteOptions`；省略冲突策略时拒绝已有键冲突。'
            )
          },
          returns: t(
            'The synchronous write completed or threw a backend error.',
            '同步写入已经完成，否则抛出后端错误。'
          ),
          example: `store.sync?.set('theme', 'dark', { conflictPolicy: 'replace' })`
        },
        remove: {
          summary: t(
            'Synchronously removes the application-selected value-channel entry.',
            '同步移除应用指定的值通道条目，不创建异步等待。'
          ),
          params: { key: stringKeyParam },
          returns: t(
            'Removal completed or threw synchronously.',
            '移除已经完成，否则同步抛出错误。'
          ),
          example: `store.sync?.remove('theme')`
        },
        has: {
          summary: t(
            'Synchronously checks the existence of one application-selected string key.',
            '同步检查应用指定的字符串键是否存在，不返回业务载荷。'
          ),
          params: { key: stringKeyParam },
          returns: t(
            'True when this visible key exists, otherwise false.',
            '此可见键存在时为真，否则为假。'
          ),
          example: `console.log(store.sync?.has('theme'))`
        },
        keys: {
          summary: t(
            'Synchronously lists the implementation’s currently visible string-channel keys.',
            '同步列出实现当前可见的字符串通道键，具体排列顺序由实现决定。'
          ),
          returns: t(
            'An array of visible string keys; the interface does not fix ordering.',
            '可见字符串键数组；接口不固定顺序。'
          ),
          example: `console.log(store.sync?.keys())`
        },
        clearValues: {
          summary: t(
            'Synchronously clears only the string-value channel of this backend.',
            '同步清空此后端的字符串值通道，不选择独立记录通道。'
          ),
          returns: t(
            'The synchronous value clear completed or threw.',
            '同步值清空已经完成，否则抛出错误。'
          ),
          example: `store.sync?.clearValues()`
        }
      }
    },
    ISyncCapableStore: {
      summary: t(
        'Type refinement requiring a supplied store’s sync property; concrete backend factories use it when synchronous access is guaranteed.',
        '要求传入存储具备同步属性的类型收紧；具体后端工厂在保证同步访问时使用。'
      ),
      members: {
        sync: {
          summary: t(
            'Required non-null synchronous channel inherited from the concrete store’s original sync type.',
            '从具体存储原同步类型继承的必填非空同步通道。'
          )
        }
      }
    },
    IRecordStore: {
      summary: t(
        'Base store plus independent byte and structured-record channels, bounded iteration and backend-owned transactional callbacks.',
        '基础存储加上独立字节与结构化记录通道、范围迭代和后端所有事务回调。'
      ),
      scenarios: [
        t(
          'Persist structured data while keeping the consumer independent of memory or browser database implementations.',
          '持久化结构化数据，同时让消费者独立于内存或浏览器数据库实现。'
        )
      ],
      example: storeExample,
      members: recordMembers
    },
    IChangeFeedStore: {
      summary: t(
        'Existing key-value store with a post-commit invalidation subscription, admitted through the change-feed capability guard.',
        '具有提交后失效通知订阅的既有键值存储，通过变更流能力守卫接纳。'
      ),
      scenarios: [
        t(
          'Invalidate cached reads after a backend reports committed data changes.',
          '后端报告已提交的数据变化后，使缓存读取失效。'
        )
      ],
      example: `const feed = asChangeFeedStore(store)
const stop = feed.subscribeChanges((change) => console.log(change.sequence, change.kind))
await feed.set('theme', 'dark', { conflictPolicy: 'replace' })
stop()`,
      members: {
        ...storeMembers,
        subscribeChanges: {
          summary: t(
            'Registers a synchronous change callback. Pair with `set()` or another backend mutation to observe committed invalidation, then call the returned unsubscribe function.',
            '登记同步变更回调。搭配 `set()` 或其他后端变更观察已提交失效通知，最后调用返回的退订函数。'
          ),
          params: {
            listener: t(
              'Synchronous `(change) => void` receiving backend-issued `IStorageChange`; no return value is used. Listener failure policy belongs to the backend, so do not return an unobserved async task.',
              '同步 `(change) => void`，接收后端提供的 `IStorageChange`；不使用返回值。监听失败策略属于后端，不应返回未被观察的异步任务。'
            )
          },
          returns: t(
            'A synchronous unsubscribe function owned by the caller; callback disposal semantics are defined by the backend.',
            '调用方持有的同步退订函数；回调释放语义由后端定义。'
          ),
          example: `const feed = asChangeFeedStore(store)
const stop = feed.subscribeChanges((change) => console.log(change.keys))
await feed.set('theme', 'dark', { conflictPolicy: 'replace' })
stop()`
        }
      }
    },
    IKeyValueStoreAdmission: {
      summary: t(
        'Discriminated single-read store admission returned by `snapshotKeyValueStoreDetailed()`, retaining either source facts or the exact failure.',
        '`snapshotKeyValueStoreDetailed()` 返回的判别式单次存储接纳结果，保留来源事实或精确失败。'
      ),
      scenarios: [
        t(
          'Own store cleanup without rereading a mutable disposer accessor after admission.',
          '接纳后不重读可变释放访问器地管理存储清理。'
        )
      ],
      example: `const admission = snapshotKeyValueStoreDetailed(candidate)
if (admission.valid) await Reflect.apply(admission.dispose, admission.receiver, [])
else console.error(admission.cause)`,
      members: {
        valid: {
          summary: t(
            'Admission discriminant: true carries the captured store facts, false carries the original observed failure.',
            '接纳判别值：真值携带捕获的存储事实，假值携带观察到的原始失败。'
          ),
          values: {
            true: t(
              'The inspected base store shape and capabilities were accepted.',
              '被检查的基础存储形状和能力已经接纳。'
            ),
            false: t(
              'The candidate shape failed admission without invoking storage operations.',
              '候选形状未通过接纳，且未调用存储操作。'
            )
          }
        },
        store: {
          summary: t(
            'Exact original backend object supplied to admission; no method facade or store clone is created.',
            '接纳时提供的精确原后端对象；不创建方法外观或存储副本。'
          )
        },
        backend: storeMembers.backend!,
        capabilities: storeMembers.capabilities!,
        dispose: {
          summary: t(
            'Raw dispose function captured from the candidate exactly once; invoke it with the separately retained receiver.',
            '从候选精确捕获一次的原释放函数；执行时使用单独保留的接收者。'
          ),
          returns: t(
            'Backend-owned cleanup promise; the original receiver must remain attached at invocation.',
            '后端持有的清理异步结果；调用时必须保留原接收者。'
          ),
          example: `const admission = snapshotKeyValueStoreDetailed(candidate)
if (admission.valid) await Reflect.apply(admission.dispose, admission.receiver, [])`
        },
        receiver: {
          summary: t(
            'Exact candidate object retained to invoke the captured disposer with its original receiver semantics.',
            '为执行捕获释放器保留的精确候选对象，维持原接收者语义。'
          )
        },
        cause: {
          summary: t(
            'Exact observed getter failure for invalid admission, or undefined when rejection was a plain shape mismatch.',
            '无效接纳中观察到的精确访问器失败；普通形状不匹配则为空值。'
          )
        }
      }
    },
    IStorageCapabilities: {
      summary: t(
        'Backend-issued capability facts used to select channels and limits; this package validates fields but does not implement the advertised operations.',
        '后端提供的能力事实，用于选择通道与限制；本包校验字段，不实现被宣告操作。'
      ),
      scenarios: [
        t(
          'Choose a supported storage path before requesting structured records, binary data or notifications.',
          '请求结构化记录、二进制数据或通知前选择受支持存储路径。'
        )
      ],
      example: `const capabilities = snapshotStorageCapabilities(store.capabilities)
if (capabilities?.records) console.log(await asRecordStore(store).getRecord('profile'))`,
      members: {
        syncRead: {
          summary: t(
            'Whether the implementation declares a synchronous access channel; actual access is exposed through store.sync.',
            '实现是否声明同步访问通道；实际访问通过存储同步属性提供。'
          )
        },
        binary: {
          summary: t(
            'Whether the backend supports raw byte values in its binary channel.',
            '后端是否通过二进制通道支持原始字节值。'
          )
        },
        records: {
          summary: t(
            'Whether the backend supports structured record reads and writes in addition to string values.',
            '后端是否在字符串值之外支持结构化记录读写。'
          )
        },
        transactions: {
          summary: t(
            'Whether the backend declares transactional record callbacks with its own commit/rollback engine.',
            '后端是否声明使用自身提交回滚引擎的记录事务回调。'
          )
        },
        iteration: {
          summary: t(
            'Whether the backend supports asynchronous range iteration over structured records.',
            '后端是否支持结构化记录上的异步范围迭代。'
          )
        },
        secondaryIndexes: {
          summary: t(
            'Whether the backend exposes the complete logical secondary-index extension; legacy missing input flags normalize to false.',
            '后端是否暴露完整逻辑二级索引扩展；旧输入缺失此标志时规范化为假。'
          )
        },
        changeFeed: {
          summary: t(
            'Whether the backend emits post-commit invalidation changes; legacy missing input flags normalize to false.',
            '后端是否发送提交后的失效变化；旧输入缺失此标志时规范化为假。'
          )
        },
        maxValueBytes: {
          summary: t(
            'Optional nonnegative safe-integer approximate per-value byte limit; undefined means this descriptor supplies no per-value bound.',
            '可选非负安全整数形式的近似单值字节上限；空值表示此描述不提供单值上限。'
          )
        },
        opaqueEntries: {
          summary: t(
            'Whether entries invisible to the JavaScript-facing channel may still exist, such as HTTP-only cookies.',
            '是否可能仍存在脚本可见通道之外的条目，例如仅服务器可见的网页存储项。'
          )
        }
      }
    },
    IOperationContext: {
      summary: t(
        'Caller-authored optional operation intent for asynchronous storage methods, using structural signals and backend-owned execution.',
        '调用方为异步存储方法编写的可选操作意图，使用结构信号和后端所有执行流程。'
      ),
      members: operationMembers
    },
    IOperationContextSnapshot: {
      summary: t(
        'Frozen operation fields returned by `snapshotOperationContext()`, optionally including a validated conflict policy and preserving snapshot identity on readmission.',
        '`snapshotOperationContext()` 返回的冻结操作字段，可含已校验冲突策略，再次接纳时保持快照身份。'
      ),
      scenarios: [
        t(
          'Capture getters before an asynchronous backend starts acquiring resources or scheduling waits.',
          '异步后端开始取得资源或安排等待前捕获访问器字段。'
        )
      ],
      example: `const context = snapshotOperationContext({ timeoutMs: 500 })
console.log(Object.isFrozen(context), snapshotOperationContext(context) === context)`,
      members: {
        ...operationMembers,
        conflictPolicy: {
          ...conflictMember,
          default: t(
            'Omitted: snapshot retains undefined; the writing backend applies its normal conflict default.',
            '省略时快照保留空值，由写入后端应用常规冲突默认值。'
          )
        }
      }
    },
    IWriteOptions: {
      summary: t(
        'Asynchronous operation context extended with an explicit existing-key policy for backend writes.',
        '异步操作上下文加上后端写入的显式已有键策略。'
      ),
      members: { ...operationMembers, conflictPolicy: conflictMember }
    },
    ISyncWriteOptions: {
      summary: t(
        'Reduced synchronous write policy with no signal, timeout or paging fields accepted by the synchronous validation helpers.',
        '同步校验辅助函数接受的精简同步写策略，不包含信号、超时或分页字段。'
      ),
      members: { conflictPolicy: conflictMember }
    },
    ITransactionWriteOptions: {
      summary: t(
        'Existing-key policy supplied to a write inside an already-open backend transaction scope.',
        '传给已打开后端事务作用域内写入的已有键策略。'
      ),
      members: { conflictPolicy: conflictMember }
    },
    ITransactionScope: {
      summary: t(
        'Backend-issued minimal record transaction view; retain it only inside the asynchronous transaction callback that supplied it.',
        '后端提供的最小记录事务视图；只能在提供它的异步事务回调内保留使用。'
      ),
      scenarios: [
        t(
          'Read and update records under one concrete backend transaction outcome.',
          '在同一具体后端事务结局下读取并更新记录。'
        )
      ],
      example: `await records.transaction(async (tx) => {
  const value = await tx.get('profile')
  if (value) await tx.put(value, 'profile', { conflictPolicy: 'replace' })
})`,
      members: transactionMembers
    },
    ISecondaryIndexTransactionScope: {
      summary: t(
        'Backend-issued index-aware transaction scope in which every write supplies both a record key and its complete index projection.',
        '后端提供的索引事务作用域；每次写入必须同时提供记录键和完整索引投影。'
      ),
      scenarios: [
        t(
          'Keep a record mutation and its secondary-index projection under one backend transaction.',
          '把记录变更与二级索引投影置于同一后端事务。'
        )
      ],
      example: `await indexed.transactionIndexed(handle, async (tx) => {
  await tx.put({ name: 'Ada' }, 'user-1', { byName: { kind: 'single', key: 'Ada' } })
})`,
      members: {
        get: transactionMembers.get!,
        delete: transactionMembers.delete!,
        put: {
          summary: t(
            'Writes a record and its explicit per-index projection within the current index transaction.',
            '在当前索引事务内写入记录及其显式的逐索引投影。'
          ),
          params: {
            value: t(
              'Application-created record staged in this transaction.',
              '应用创建、暂存于此事务的记录。'
            ),
            key: recordKeyParam,
            projection: t(
              'Caller-produced `IRecordIndexProjection` for the definitions selected by the transaction handle.',
              '调用方为事务句柄选定定义产生的 `IRecordIndexProjection`。'
            )
          },
          returns: t(
            'A promise of the stored record key; enclosing transaction completion still determines commit.',
            '存储记录键的异步结果；仍由外层事务完成决定提交。'
          ),
          example: `await indexed.transactionIndexed(handle, async (tx) => {
  await tx.put({ name: 'Ada' }, 'user-1', { byName: { kind: 'single', key: 'Ada' } })
})`
        }
      }
    },
    ISecondaryIndexRecordStore: {
      summary: t(
        'Record backend extended with declarations, readiness, projected writes, index iteration and index-aware transactions.',
        '记录后端扩展的索引声明、就绪状态、投影写入、索引迭代和索引事务表面。'
      ),
      scenarios: [
        t(
          'Query logical secondary keys without coupling the consumer to a native database index format.',
          '按逻辑二级键查询，同时不让消费者依赖原生数据库索引格式。'
        )
      ],
      example: indexExample,
      members: {
        ...recordMembers,
        ensureRecordIndexes: {
          summary: t(
            'Admits declarations for a caller-owned logical scope and returns the backend-issued handle used by later index operations. Readiness may still be pending.',
            '为调用方逻辑作用域接纳索引声明，返回后端签发的后续操作句柄；就绪过程仍可能待完成。'
          ),
          params: {
            scope: t(
              'Stable application-selected scope identifying this entity’s index family.',
              '应用选定的稳定作用域，用于标识此实体的索引家族。'
            ),
            definitions: t(
              'Caller-authored readonly `IRecordIndexDefinition` list naming each projection and revision.',
              '调用方编写的只读 `IRecordIndexDefinition` 列表，声明各投影名称与修订号。'
            ),
            ctx: contextParam
          },
          returns: t(
            'A promise of `IRecordIndexHandle` from this backend; retain it with its corresponding declarations.',
            '此后端返回的 `IRecordIndexHandle` 异步结果；与对应声明一起保留。'
          ),
          example: indexExample
        },
        getRecordIndexReadiness: {
          summary: t(
            'Reads backfill or preparation progress for an existing backend-issued index handle.',
            '读取既有后端签发索引句柄对应的回填或准备进度，不创建新声明。'
          ),
          params: {
            handle: t(
              'Handle returned by this same store’s `ensureRecordIndexes()` call.',
              '由同一存储的 `ensureRecordIndexes()` 调用返回的句柄。'
            ),
            ctx: contextParam
          },
          returns: t(
            'A promise of `IRecordIndexReadiness`; stale-handle errors belong to the implementing backend.',
            '`IRecordIndexReadiness` 的异步结果；过期句柄错误由具体后端定义。'
          ),
          example: `console.log(await indexed.getRecordIndexReadiness(handle))`
        },
        putIndexedRecord: {
          summary: t(
            'Writes one record with explicit projections under a previously admitted index handle.',
            '在此前已接纳的索引句柄下，使用显式投影写入一条记录。'
          ),
          params: {
            value: t(
              'Application record matching the store’s TValue type.',
              '满足存储值类型的应用记录。'
            ),
            key: recordKeyParam,
            handle: t(
              'Exact handle returned by this store’s `ensureRecordIndexes()` for these definitions.',
              '此存储为这些定义执行 `ensureRecordIndexes()` 返回的精确句柄。'
            ),
            projection: t(
              'Caller-produced `IRecordIndexProjection` keyed by the admitted definition names; undefined omits one projection.',
              '调用方产生、以已接纳定义名称为键的 `IRecordIndexProjection`；空值省略一个投影。'
            ),
            ctx: writeContextParam
          },
          returns: t(
            'A promise of the stored key after the backend’s projected write outcome.',
            '后端投影写入结局确定后的存储键异步结果。'
          ),
          example: indexExample
        },
        iterateRecordIndex: {
          summary: t(
            'Iterates records through a declared logical secondary index using the backend’s ordering and range path.',
            '通过已声明逻辑二级索引迭代记录，采用后端的顺序与范围路径。'
          ),
          params: {
            query: t(
              'Caller-authored `IRecordIndexQuery` using the handle from ensureRecordIndexes and an index name from its declarations.',
              '调用方编写的 `IRecordIndexQuery`，使用索引接纳返回的句柄和对应声明名称。'
            ),
            ctx: contextParam
          },
          returns: t(
            'An async iterator of primary record-key and value pairs; query validation and concurrent invalidation follow the backend contract.',
            '主记录键和值对的异步迭代器；查询校验和并发失效遵循后端契约。'
          ),
          example: indexExample
        },
        transactionIndexed: {
          summary: t(
            'Runs an async callback with an index-aware transaction scope tied to an admitted handle; record and projection writes share one backend outcome.',
            '用绑定到已接纳句柄的索引事务作用域执行异步回调；记录和投影写入共享同一后端结局。'
          ),
          params: {
            handle: t(
              'Handle returned by this same backend’s ensureRecordIndexes operation.',
              '同一后端索引接纳操作返回的句柄。'
            ),
            run: t(
              'Async `(tx) => result` callback receiving `ISecondaryIndexTransactionScope`; do not retain tx after the callback settles. Throw or rejection requests transaction failure.',
              '接收 `ISecondaryIndexTransactionScope` 的异步 `(tx) => result` 回调；回调结算后不可保留使用事务。抛错或拒绝请求事务失败。'
            ),
            ctx: contextParam
          },
          returns: t(
            'A promise of callback output once the backend transaction outcome is known.',
            '后端事务结局已知后返回回调输出的异步结果。'
          ),
          example: `await indexed.transactionIndexed(handle, async (tx) => {
  const value = await tx.get('user-1')
  if (value) console.log(value)
})`
        }
      }
    },
    IRecordIndexDefinition: {
      summary: t(
        'Application-authored logical index declaration supplied before index operations; the backend owns its physical representation.',
        '索引操作前由应用编写的逻辑索引声明；物理表达由后端持有。'
      ),
      members: {
        name: {
          summary: t(
            'Application-issued index name, unique within the selected logical scope and reused as the projection/query key.',
            '应用指定的索引名，在所选逻辑作用域内唯一，并复用作投影和查询键。'
          )
        },
        unique: {
          summary: t(
            'Required flag declaring whether a projected key may belong to several different records.',
            '必填标志，声明投影键是否允许属于多个不同记录。'
          )
        },
        multiEntry: {
          summary: t(
            'Required flag declaring whether one record may contribute multiple logical keys to this index.',
            '必填标志，声明一条记录是否可以向此索引贡献多个逻辑键。'
          )
        },
        revision: {
          summary: t(
            'Application-selected projection revision included in the backend’s definition fingerprint.',
            '应用指定的投影修订号，纳入后端的定义指纹。'
          )
        }
      }
    },
    IRecordIndexHandle: {
      summary: t(
        'Backend-issued handle returned by `ensureRecordIndexes()`, binding scope, generation and definition fingerprint for subsequent index work.',
        '`ensureRecordIndexes()` 返回的后端签发句柄，绑定后续索引工作的作用域、世代和定义指纹。'
      ),
      members: {
        scope: {
          summary: t(
            'Logical scope originally selected by the caller and retained by the backend-issued handle.',
            '调用方最初选择、由后端句柄保留的逻辑作用域。'
          )
        },
        generation: {
          summary: t(
            'Backend-issued generation identity from index admission; do not construct it from a counter or substitute another handle’s generation.',
            '索引接纳时后端签发的世代身份，不得由计数器构造或换用其他句柄的世代。'
          )
        },
        fingerprint: {
          summary: t(
            'Backend-produced fingerprint of the admitted definition set, retained with its scope and generation.',
            '后端为已接纳定义集生成的指纹，与作用域和世代一同保留。'
          )
        }
      }
    },
    IRecordIndexReadiness: {
      summary: t(
        'Backend-issued index preparation progress containing status and record processing counters.',
        '后端提供的索引准备进度，包含状态与记录处理计数。'
      ),
      members: {
        status: {
          summary: t(
            'Preparation discriminant separating not-yet-started, running, complete and failed index work.',
            '准备过程判别状态，区分尚未开始、进行中、已完成和失败的索引工作。'
          ),
          values: {
            pending: t(
              'Preparation is admitted but not yet running.',
              '准备已经接纳，但尚未开始执行。'
            ),
            running: t(
              'Preparation or backfill is actively processing records.',
              '准备或回填正在处理已有记录。'
            ),
            complete: t(
              'The backend reports preparation complete for this handle.',
              '后端报告此句柄对应的准备已经完成。'
            ),
            failed: t(
              'Preparation failed and callers must follow the backend’s recovery policy.',
              '准备失败，调用方需遵循后端恢复策略。'
            )
          }
        },
        scanned: {
          summary: t(
            'Backend-reported count of records examined during index preparation.',
            '后端报告的索引准备期间已检查记录数量。'
          )
        },
        indexed: {
          summary: t(
            'Backend-reported count of records indexed during preparation; it need not equal the number scanned.',
            '后端报告的准备期间已索引记录数，不一定等于已扫描数量。'
          )
        }
      }
    },
    IRecordIndexProjectionValue: {
      summary: t(
        'Caller-produced projection for one index: one logical key or an explicit list of logical keys.',
        '调用方为单个索引产生的投影：一个逻辑键或显式逻辑键列表。'
      ),
      members: {
        kind: {
          summary: t(
            'Projection discriminant separating a single logical key from multiple explicit keys.',
            '投影判别值，区分单个逻辑键与多个显式逻辑键。'
          ),
          values: {
            single: t('Read one index key from the key field.', '从单键字段取得一个索引逻辑键。'),
            multiple: t(
              'Read all projected index keys from the keys array.',
              '从键数组取得全部投影索引逻辑键。'
            )
          }
        },
        key: {
          summary: t(
            'Caller-produced `IStorageKey` for a single projection; it is an index key, not necessarily the primary record key.',
            '调用方为单项投影产生的 `IStorageKey`；它是索引键，不一定是记录主键。'
          )
        },
        keys: {
          summary: t(
            'Caller-produced readonly index-key list in the multiple branch; backend admission validates each key.',
            '调用方在多项分支产生的只读索引键列表，后端接纳时校验各键。'
          )
        }
      }
    },
    IRecordIndexProjection: {
      summary: t(
        'Readonly map from admitted index names to explicit projection values; undefined skips a projection for that record.',
        '从已接纳索引名称到显式投影值的只读映射；空值跳过此记录的对应投影。'
      ),
      example: indexExample,
      members: {}
    },
    IRecordIndexQuery: {
      summary: t(
        'Caller-authored logical index query pairing a backend-issued handle with a declared index name and optional bounds.',
        '调用方编写的逻辑索引查询，使用后端签发句柄、已声明索引名与可选边界。'
      ),
      members: {
        handle: {
          summary: t(
            'Handle returned by the same store’s ensureRecordIndexes call for the queried index definitions.',
            '同一存储为所查询索引定义执行接纳后返回的句柄。'
          )
        },
        index: {
          summary: t(
            'Application index name from the definitions passed to ensureRecordIndexes, not an arbitrary primary-key value.',
            '来自索引接纳定义的应用索引名，不是任意主键值。'
          )
        },
        range: {
          summary: t(
            'Optional `IKeyRange` over logical index keys rather than primary record keys.',
            '针对逻辑索引键而非记录主键的可选 `IKeyRange`。'
          ),
          default: t(
            'Omitted: request no explicit logical index-key bounds.',
            '省略时不请求显式逻辑索引键边界。'
          )
        },
        direction: {
          summary: t(
            'Requested index traversal direction: next for ascending, prev for descending.',
            '请求的索引遍历方向：向后为升序，向前为降序。'
          ),
          default: t(
            'Omitted: use the concrete backend’s normal index traversal direction.',
            '省略时使用具体后端的常规索引遍历方向。'
          ),
          values: {
            next: t(
              'Traverse logical index keys in ascending order.',
              '按逻辑索引键的升序遍历记录。'
            ),
            prev: t(
              'Traverse logical index keys in descending order.',
              '按逻辑索引键的降序遍历记录。'
            )
          }
        },
        limit: {
          summary: t(
            'Optional maximum result count selected by the application; the backend validates and applies it.',
            '应用选择的可选最大结果数量，由后端校验和应用。'
          ),
          default: t(
            'Omitted: no explicit result-count limit is requested.',
            '省略时不请求显式结果数量上限。'
          )
        }
      }
    },
    IStorageChange: {
      summary: t(
        'Backend-issued post-commit invalidation record, identifying the affected channel and operation without carrying authoritative stored values.',
        '后端提供的提交后失效记录，标识受影响通道与操作，不携带权威存储值。'
      ),
      members: {
        sequence: {
          summary: t(
            'Sequence issued by the feed producer to order its own changes; compare within that producer’s stream.',
            '变更流生产者签发、用于自身变化排序的编号；只在该生产者流内比较。'
          )
        },
        origin: {
          summary: t(
            'Origin label issued by the backend change producer, identifying which stream produced the invalidation.',
            '后端变更生产者签发的来源标签，标识发出失效通知的流。'
          )
        },
        channel: {
          summary: t(
            'Data channel affected by this invalidation, or all when the mutation crosses channels.',
            '此次失效影响的数据通道，跨通道变更时标记为全部。'
          ),
          values: {
            value: t('The string-value channel changed.', '字符串值通道已经发生变化。'),
            bytes: t('The binary-byte channel changed.', '二进制字节通道已经发生变化。'),
            record: t('The structured-record channel changed.', '结构化记录通道已经发生变化。'),
            all: t(
              'Several or all data channels may have changed.',
              '多个或全部数据通道可能发生变化。'
            )
          }
        },
        kind: {
          summary: t(
            'Committed mutation category describing a write, removal, clear, transaction batch or migration.',
            '已提交变更类别，描述写入、移除、清空、事务批次或迁移。'
          ),
          values: {
            put: t(
              'A value or record was written under the backend’s commit path.',
              '值或记录已经通过后端提交路径写入。'
            ),
            remove: t('A value or record was removed.', '值或记录已经从对应通道移除。'),
            clear: t('The indicated data channel was cleared.', '所指数据通道已经执行清空操作。'),
            batch: t(
              'A batch or transaction committed multiple changes.',
              '一个批次或事务提交了多个变化。'
            ),
            migrate: t(
              'Maintenance migration changed the indicated stored data.',
              '维护迁移改变了所指持久化数据。'
            )
          }
        },
        scope: {
          summary: t(
            'Optional logical scope issued by the change producer, such as an indexed entity scope.',
            '变更生产者提供的可选逻辑作用域，例如带索引实体的作用域。'
          ),
          default: t(
            'Omitted: this record supplies no narrower logical scope.',
            '省略时此记录不提供更窄逻辑作用域。'
          )
        },
        keys: {
          summary: t(
            'Optional affected keys issued by the backend; absence does not prove that no keys changed.',
            '后端提供的可选受影响键列表；缺失不代表没有键发生变化。'
          ),
          default: t(
            'Omitted: the event does not enumerate affected keys.',
            '省略时事件不枚举受影响的键。'
          )
        }
      }
    },
    ICodec: {
      summary: t(
        'Open asynchronous serialization contract accepted from implementation packages; name and output select the persisted representation.',
        '从具体实现包接纳的开放异步序列化契约；名称和输出形式选择持久化表达。'
      ),
      scenarios: [
        t(
          'Admit a codec once before routing domain values into a compatible storage channel.',
          '把领域值路由到兼容存储通道前，单次接纳编解码器。'
        )
      ],
      example: codecExample,
      members: codecMembers
    },
    ICodecOutput: {
      summary: t(
        'Raw representation union from the codec contract: text, binary or structured; backend routing checks the selected form.',
        '编解码器契约的原始表达联合：文本、二进制或结构化；后端路由检查所选形式。'
      ),
      members: {}
    },
    IBackendKind: {
      summary: t(
        'Implementation-family label union for local, session, cookie, indexeddb or memory backends; it does not substitute for capability flags.',
        '本地、会话、小型网页存储、索引数据库或内存的实现家族标签联合，不能替代能力标志。'
      ),
      members: {}
    },
    IStorageKey: {
      summary: t(
        'Recursive structured-key domain: string, finite number, valid Date, bounded ArrayBuffer or a nonempty dense array of valid keys.',
        '递归结构键域：字符串、有限数字、有效日期、有界缓冲区，或有效键组成的非空稠密数组。'
      ),
      example: `const key = snapshotStorageKey(['users', 1], 'memory')
console.log(compareStorageKeys(key, ['users', 2]))`,
      members: {}
    },
    IKeyRange: {
      summary: t(
        'Backend-neutral lower and upper record/index key bounds following native key-range endpoint semantics.',
        '遵循原生键范围端点语义的后端无关记录或索引上下边界。'
      ),
      members: {
        lower: {
          summary: t(
            'Optional caller-selected lower bound in the same key domain as the queried channel.',
            '调用方选择的可选下界，与查询通道采用相同键域。'
          ),
          default: t('Omitted: no lower bound is requested.', '省略时不请求下界限制。')
        },
        lowerOpen: {
          summary: t(
            'Whether an explicitly supplied lower endpoint is excluded from results.',
            '是否从结果中排除显式提供的下界端点值。'
          ),
          default: t(
            '`false`: include the lower endpoint when a lower bound exists.',
            '`false`：存在下界时包含该端点。'
          )
        },
        upper: {
          summary: t(
            'Optional caller-selected upper bound in the queried channel’s logical key domain.',
            '调用方在查询通道逻辑键域中选择的可选上界。'
          ),
          default: t('Omitted: no upper bound is requested.', '省略时不请求上界限制。')
        },
        upperOpen: {
          summary: t(
            'Whether an explicitly supplied upper endpoint is excluded from results.',
            '是否从结果中排除显式提供的上界端点值。'
          ),
          default: t(
            '`false`: include the upper endpoint when an upper bound exists.',
            '`false`：存在上界时包含该端点。'
          )
        }
      }
    },
    IConflictPolicy: {
      summary: t(
        'Value union of `ConflictPolicy`, selecting existing-key rejection or explicit replacement for writes.',
        '`ConflictPolicy` 的值联合，为写入选择已有键拒绝或显式替换。'
      ),
      members: {}
    },
    IStorageContractConflictPolicy: {
      summary: t(
        'Value union of the canonical `StorageContractConflictPolicy` declaration table, matching normal write policy semantics.',
        '统一 `StorageContractConflictPolicy` 声明表的值联合，采用常规写策略语义。'
      ),
      members: {}
    },
    IStorageContractErrorCode: {
      summary: t(
        'Stable semantic code union from `StorageContractErrorCode`; source identity is required when interpreting these strings.',
        '来自 `StorageContractErrorCode` 的稳定语义码联合，解释字符串时必须确认来源身份。'
      ),
      members: {}
    },
    IStorageContractErrorDetails: {
      summary: t(
        'Producer-authored neutral error details containing optional backend, original key and causal failure.',
        '生产者编写的中立错误详情，包含可选后端、原始键和原因失败。'
      ),
      members: {
        backend: {
          ...errorMembers.backend!,
          default: t('Omitted: no backend label is attached.', '省略时不附加后端标签。')
        },
        key: {
          ...errorMembers.key!,
          default: t('Omitted: no application key is attached.', '省略时不附加应用键。')
        },
        cause: {
          summary: t(
            'Exact original failure supplied by the producer; retained through native Error.cause without replacing the new error stack.',
            '生产者提供的精确原始失败，通过原生错误原因保留，不替换新错误调用栈。'
          ),
          default: t('Omitted: native cause is undefined.', '省略时原生错误原因为空值。')
        }
      }
    },
    StorageContractError: {
      summary: t(
        'Frozen native Error constructed by `StorageContractError`, retaining direct source, code, backend and key fields plus a native cause chain.',
        '`StorageContractError` 构造的冻结原生错误，保留直接来源、错误码、后端和键字段，以及原生原因链。'
      ),
      scenarios: [
        t(
          'Inspect a neutral storage boundary failure while retaining the exact underlying cause.',
          '检查中立存储边界失败，同时保留精确底层原因。'
        )
      ],
      example: `const cause = new TypeError('invalid key')
const error = new StorageContractError(StorageContractErrorCode.invalidKey, { backend: 'memory', cause })
console.log(error.code, error.backend, error.cause === cause)`,
      members: errorMembers
    }
  },
  enums: {
    ConflictPolicy: {
      summary: t(
        'Existing-key outcomes used by asynchronous, synchronous and transaction write options.',
        '异步、同步和事务写选项使用的已有键处理方式。'
      ),
      values: conflictValues
    },
    StorageContractConflictPolicy: {
      summary: t(
        'Canonical existing-key policy domain used by contract implementations.',
        '契约实现使用的统一已有键策略取值域。'
      ),
      values: conflictValues
    },
    StorageContractErrorCode: {
      summary: t(
        'Stable contract failure codes covering invalid inputs, keys, capability absence, disposal and cancellation.',
        '涵盖无效输入、键、能力缺失、释放和取消的稳定契约失败码。'
      ),
      values: {
        invalidArgument: t(
          'A public descriptor, context, synchronous write option or callback shape is invalid; correct the input before retrying.',
          '公开描述器、上下文、同步写选项或回调形状无效，重试前应修正输入。'
        ),
        invalidKey: t(
          'A record key violates its type, finiteness, array, depth, node or binary-size domain.',
          '记录键违反类型、有限性、数组、深度、节点或二进制大小键域要求。'
        ),
        unsupported: t(
          'The supplied backend lacks the required capability or callable methods; select a suitable implementation.',
          '所提供后端缺少所需能力或可调用方法，应选择合适实现。'
        ),
        disposed: t(
          'A caller uses a backend after its disposal; create or obtain a new store.',
          '调用方在后端释放后继续使用，应创建或取得新存储。'
        ),
        aborted: t(
          'A signal or timeout cancels waiting; writes already in atomic commit report the actual commit outcome.',
          '信号或超时取消等待；已经进入原子提交的写入报告实际提交结局。'
        )
      }
    },
    KEY_DOMAIN_LIMITS: {
      summary: t(
        'Public hard bounds used during structured record-key validation.',
        '结构化记录键校验使用的公开硬性规模上限。'
      ),
      values: {
        maxDepth: t(
          'Depth thirty-two is allowed with the root at zero; deeper nested key arrays are rejected.',
          '根深度为零，允许深度三十二，更深的嵌套键数组被拒绝。'
        ),
        maxNodes: t(
          'At most 4096 visited nodes per key, including the root and nested array elements.',
          '每个键最多访问四千零九十六个节点，包含根和嵌套数组元素。'
        ),
        maxBinaryBytes: t(
          'Each binary key buffer may contain at most 1048576 bytes; this is not a sum over all buffers.',
          '每个二进制键缓冲区最多 `1048576` 字节，不累加全部缓冲区。'
        )
      }
    }
  },
  enhancers: {}
}
