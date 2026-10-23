/**
 * Reference documentation of `@migaia/storage-contract`. Rules: `app/reference/contract.ts`.
 * Operation-context snapshots are frozen and reused by identity; key and capability snapshots are
 * detached but mutable. Codec methods retain their original function references. Concrete backends
 * own I/O, cancellation and resource cleanup; this package supplies neutral contracts.
 */
import type { ILibraryReference, IMemberDoc, IText } from './contract.js'
import { storageContractCases } from './storage-contract-cases.ts'

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

/** Shared quick start also appears in the complete Map/Set task case. */
const codecExample = storageContractCases.fromValueCodec![0]!.example

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

/** The canonical public conflict table owns existing-key write policy values. */
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
  orgId: {
    summary: t(
      'Optional canonical lowercase UUID, including the zero UUID; the outer host owns defaults and namespace mapping.',
      '可选规范小写 UUID，包括全零 UUID；外层 host 负责默认值与 namespace 映射。'
    ),
    default: t(
      'Omitted: no orgId property is inserted into a snapshot.',
      '省略时快照不插入 orgId 属性。'
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
  'Optional caller-authored `IOperationContext`: `signal` is an object with boolean `aborted` and callable `addEventListener`/`removeEventListener`; `timeoutMs` is a nonnegative safe integer including 0; `pageSize` is an integer from 1 to 4096. `orgId` is an optional canonical lowercase UUID, including the zero UUID. Each field defaults to `undefined`. Concrete backends execute cancellation, timeouts and paging.',
  '调用方编写的可选 `IOperationContext`：`signal` 是含布尔 `aborted` 和可调用 `addEventListener`、`removeEventListener` 的对象；`timeoutMs` 为含 0 的非负安全整数；`pageSize` 为 1 至 4096 的整数。`orgId` 可选，须为规范小写 UUID（包括全零 UUID）。各字段默认 `undefined`，实际取消、超时和分页由具体后端执行。'
)

/** Write contexts combine operation intent with explicit existing-key policy. */
const writeContextParam = t(
  'Optional caller-authored `IWriteOptions`: `signal` has boolean `aborted` and callable `addEventListener`/`removeEventListener`; `timeoutMs` is a nonnegative safe integer including 0; `pageSize` is an integer from 1 to 4096. `orgId` is an optional canonical lowercase UUID. These fields default to `undefined`. `conflictPolicy` is `conflict` (reject an existing key) or `replace` (allow replacement). Snapshot helpers retain an omitted policy as `undefined`; the writing backend applies its conflict default.',
  '调用方编写的可选 `IWriteOptions`：`signal` 具有布尔 `aborted` 及可调用 `addEventListener`、`removeEventListener`；`timeoutMs` 为含 0 的非负安全整数；`pageSize` 为 1 至 4096 的整数。`orgId` 可选且须为规范小写 UUID。这些字段默认 `undefined`。`conflictPolicy` 为拒绝已有键的 `conflict` 或允许替换的 `replace`；快照工具把缺失策略保留为 `undefined`，由写入后端应用冲突默认值。'
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

/** Standard native batch methods belong to an installed KV API, beyond ordinary raw KV admission. */
const batchMembers: Readonly<Record<string, IMemberDoc>> = {
  getMany: {
    summary: t(
      'Read one native text snapshot in input order, including duplicate positions.',
      '按输入顺序读取同一原生文本快照，保留重复位置。'
    ),
    params: {
      keys: t(
        'Logical IStorageKey values; strings share the single-key text domain.',
        '逻辑 IStorageKey；字符串与单点文本键共享身份。'
      ),
      ctx: contextParam
    },
    returns: t(
      'Same-length values with undefined for missing keys; any decode failure rejects the batch.',
      '同长度值数组，缺失项为 undefined；任一解码失败拒绝整批。'
    ),
    example: "const values = await store.use(kv).getMany(['theme', ['profile', 1]])"
  },
  setMany: {
    summary: t(
      'Atomically write a text batch in one native transaction and one operation pipeline.',
      '在一个原生事务与一次操作管线中原子写入文本批量。'
    ),
    params: {
      entries: t(
        'Key/value entries with optional ttlMs; canonical duplicate keys reject before I/O. ttlMs requires ttl capability.',
        '键值条目与可选 ttlMs；规范重复键在 I/O 前拒绝，ttlMs 要求 ttl 能力。'
      ),
      ctx: writeContextParam
    },
    returns: t(
      'Original native Promise<void>; empty input opens no transaction.',
      '原生 Promise<void>；空输入不打开事务。'
    ),
    example: "await store.use(kv).setMany([{ key: 'theme', value: 'dark' }])"
  },
  removeMany: {
    summary: t(
      'Atomically delete distinct canonical text keys in one native transaction.',
      '在一个原生事务中原子删除去重后的规范文本键。'
    ),
    params: {
      keys: t(
        'Logical keys; equivalent duplicates count only once.',
        '逻辑键；等价重复项只计一次。'
      ),
      ctx: writeContextParam
    },
    returns: t(
      'Actual deleted count; an empty batch returns zero without a transaction.',
      '实际删除数；空批返回零且不开事务。'
    ),
    example: "const removed = await store.use(kv).removeMany(['theme', 'theme'])"
  },
  removeByPrefix: {
    summary: t(
      'Delete only current-organization text entries matching the canonical key prefix.',
      '仅删除当前组织内匹配规范键前缀的文本条目。'
    ),
    params: {
      prefix: t(
        'Canonical IStorageKey prefix, using the existing ordered key domain.',
        '既有保序键域中的规范 IStorageKey 前缀。'
      ),
      ctx: writeContextParam
    },
    returns: t(
      'Actual deleted count from the native prefix range.',
      '原生前缀范围内的实际删除数。'
    ),
    example: "const removed = await store.use(kv).removeByPrefix(['profile'])"
  }
}

/** L0 methods describe the ordinary raw contract without requiring native batches. */
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
      '已存字符串的异步结果，键不存在时为 `null`；后端失败会拒绝。'
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
      '后端写入完成后兑现的 `Promise<void>`；冲突或后端失败会拒绝。'
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
      '移除完成后兑现的 `Promise<void>`；后端失败会拒绝。'
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
  removeBytes: {
    summary: t(
      'Deletes only this key from the byte channel, leaving text values and records alone. A missing key succeeds without change, so repeated deletion is idempotent; asynchronous backends resolve after the deletion commits.',
      '只删除字节通道里的这个键，文本值和记录不受影响。键不存在时直接成功、不做修改，所以重复删除是幂等的；异步后端在删除提交后才完成。'
    ),
    params: { key: stringKeyParam, ctx: contextParam },
    returns: t(
      'A `Promise<void>` settling once the byte entry is gone or was already missing.',
      '字节条目删除完成或本来就不存在时结算的 `Promise<void>`。'
    ),
    example: `await records.removeBytes('image')`
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
      'An `IStorageIterator` of `[IStorageKey, TValue]`; stop consumption normally so backend cleanup can run.',
      '产出 `[IStorageKey, TValue]` 的异步迭代器；应正常结束消费，以便后端运行清理。'
    ),
    example: `for await (const [key, value] of records.iterateRecords({ lower: 'a', upper: 'z' })) console.log(key, value)`
  },
  transaction: {
    summary: t(
      'Runs a caller-authored callback with an `ITransactionScope` supplied by the backend. The backend owns commit and rollback; callback rejection aborts that transaction path.',
      '用后端提供的 `ITransactionScope` 执行调用方回调。后端负责提交与回滚；回调拒绝会中止该事务路径。'
    ),
    params: {
      run: t(
        'Synchronous, asynchronous or PromiseLike `(tx) => result` callback; tx comes from this transaction and must not escape its callback lifetime.',
        '同步、异步或 PromiseLike `(tx) => result` 回调；事务上下文由本次事务传入，不得逃逸回调生命周期。'
      ),
      ctx: contextParam
    },
    returns: t(
      'A `Promise<Awaited<TResult>>` for the callback result after the backend’s transaction outcome is known; failure rejects.',
      '后端事务结局已知后的回调结果 `Promise<Awaited<TResult>>`；失败会拒绝。'
    ),
    example: `await records.transaction(async (tx) => {
  const value = await tx.getRecord('profile')
  if (value) await tx.putRecord(value, 'profile', { conflictPolicy: 'replace' })
})`
  }
}

/** Transaction members reuse original text/byte/record meanings without root timing contexts. */
const transactionMembers: Readonly<Record<string, IMemberDoc>> = {
  get: {
    summary: t(
      'Read text in this transaction; absent values are null.',
      '在本事务读取文本；缺失为 null。'
    ),
    params: { key: stringKeyParam },
    example: `await tx.get('theme')`
  },
  set: {
    summary: t(
      'Write text using optional reduced conflictPolicy; no separate ctx.',
      '写入文本，只接收可选精简 conflictPolicy，不另收 ctx。'
    ),
    example: `await tx.set('theme', 'dark', { conflictPolicy: 'replace' })`
  },
  remove: {
    summary: t('Remove transaction text by string key.', '按字符串键移除事务文本。'),
    params: { key: stringKeyParam },
    example: `await tx.remove('theme')`
  },
  has: {
    summary: t('Check a transaction text key.', '检查事务文本键。'),
    params: { key: stringKeyParam },
    example: `await tx.has('theme')`
  },
  getBytes: {
    summary: t('Read transaction bytes, or null when absent.', '读取事务字节，缺失为 null。'),
    params: { key: stringKeyParam },
    example: `await tx.getBytes('image')`
  },
  setBytes: {
    summary: t(
      'Write bytes using optional reduced conflictPolicy.',
      '写入字节，接收可选精简 conflictPolicy。'
    ),
    example: `await tx.setBytes('image', new Uint8Array([1]), { conflictPolicy: 'replace' })`
  },
  removeBytes: {
    summary: t('Remove only this transaction byte entry.', '只移除本事务的字节条目。'),
    params: { key: stringKeyParam },
    example: `await tx.removeBytes('image')`
  },
  getRecord: {
    summary: t(
      'Read a transaction record, or undefined when absent.',
      '读取事务记录，缺失为 undefined。'
    ),
    params: { key: recordKeyParam },
    example: `await tx.getRecord('profile')`
  },
  putRecord: {
    summary: t(
      'Write a transaction record; an omitted key requests backend key generation.',
      '写入事务记录，省略键请求后端生成。'
    ),
    example: `await tx.putRecord({ name: 'Ada' }, 'profile', { conflictPolicy: 'replace' })`
  },
  deleteRecord: {
    summary: t(
      'Delete one transaction record without committing early.',
      '删除一条事务记录，不提前提交。'
    ),
    params: { key: recordKeyParam },
    example: `await tx.deleteRecord('profile')`
  },
  iterateRecords: {
    summary: t(
      'Return a resource iterator from this same transaction and optional key range.',
      '由同一事务及可选键范围返回资源迭代器。'
    ),
    example: `await using cursor = tx.iterateRecords(); console.log(await cursor.next())`
  },
  putIndexedRecord: {
    summary: t(
      'Optional original indexed write; pass the handle and complete projection explicitly.',
      '可选原索引写入，显式传入句柄与完整投影。'
    ),
    example: `await tx.putIndexedRecord?.({ name: 'Ada' }, 'profile', handle, { byName: { kind: 'single', key: 'Ada' } })`
  },
  iterateRecordIndex: {
    summary: t(
      'Optional resource iterator for the original transaction index.',
      '原事务索引的可选资源迭代器。'
    ),
    example: `await using cursor = tx.iterateRecordIndex!({ handle, index: 'byName' }); console.log(await cursor.next())`
  },
  isRecordIndexReady: {
    summary: t(
      'Optional read of the current native transaction snapshot. Missing, pending or stale handles return false; complete metadata must match the generation and fingerprint. No index is built or refreshed.',
      '可选读取当前原生事务快照。缺失、待就绪或失效句柄返回 false；完整元数据须匹配 generation 与 fingerprint，不建立或刷新索引。'
    ),
    example: `const ready = await tx.isRecordIndexReady?.(handle)`
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

/** Lock factories validate keys before a real backend exists to supply a diagnostic label. */
const optionalKeyBackend = t(
  'Actual backend diagnostic label, or undefined before a store exists. This argument remains required; it never changes the accepted key domain.',
  '真实 backend 诊断名，尚无 store 时可传 undefined；此参数仍必填，不改变可接纳键域。'
)

/** Shared diagnostics remain separate from the canonical ordered encoder’s actual backend label. */
const keyValidationParams = {
  value: t(
    'Required unknown candidate from application input. Record keys accept strings, finite numbers, valid `Date`, `ArrayBuffer` up to 1048576 bytes each, or nonempty dense acyclic arrays of these values. Root depth is 0; maximum depth is 32 and maximum visited node count is 4096. The string-only helper accepts only strings. Values are validated without coercion.',
    '必填的应用未知输入。记录键接纳字符串、有限数字、有效 `Date`、逐个最多 `1048576` 字节的 `ArrayBuffer`，或这些值组成的非空、稠密、无环数组。根深度为 0，最大深度 32，最多访问 4096 个节点。纯字符串键工具只接纳字符串。执行校验，不强制转换。'
  ),
  backend: t(
    'Required caller-selected open `IBackendKind`, normally from the actual `store.backend`. It labels errors without choosing an implementation or narrowing the record-key domain.',
    '调用方必填的开放 `IBackendKind`，通常来自真实 `store.backend`；只标注错误，不选择实现或缩窄记录键域。'
  ),
  label: t(
    'Optional caller-selected diagnostic field name, default `key`; affects only error text, not validation or copying.',
    '调用方指定的可选诊断字段名，默认 `key`；只影响错误文本，不改变校验或复制行为。'
  )
}

/** Error fields stay on the frozen native error; the original cause remains independently reachable. */
const errorMembers: Readonly<Record<string, IMemberDoc>> = {
  capability: {
    summary: t(
      'Optional missing capability name retained before the original error is frozen; the name grants no authority.',
      '原错误冻结前保留的可选缺失能力名；名称不授予权限。'
    )
  },
  keys: {
    summary: t(
      'Detached read-only lock identities on LOCK_REJECTED and LOCK_TIMEOUT; physical timeout carries declared keys.',
      'LOCK_REJECTED 与 LOCK_TIMEOUT 的独立只读锁身份，物理超时携声明键。'
    )
  },
  holder: {
    summary: t(
      'Confirmed lock holder or undefined when genuinely unknown; handoff never borrows the previous owner.',
      '已确认的锁持有者，确实未知时 undefined；交接不借用前任身份。'
    )
  },
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
    term: {
      role: 'constant',
      purpose: t(
        'Pure RDF factories: iri preserves exact absolute IRI spelling, literal supplies mandatory datatype and lowercase well-formed language, blank is raw/parser-local, and defaultGraph is one frozen value.',
        '纯 RDF 工厂：iri 保留精确绝对 IRI，literal 补齐必需 datatype 与小写且格式正确的 language，blank 属 raw/parser 局部，defaultGraph 是一个冻结值。'
      ),
      example: storageContractCases.term![0]!.example,
      cases: storageContractCases.term
    },
    snapshotStorageRdfTerm: {
      role: 'operation',
      purpose: t(
        'Validate and detach a structural raw RDF term through the canonical term owner.',
        '通过规范 term owner 校验并复制结构化 raw RDF 项。'
      ),
      params: {
        value: t(
          'Direct IRdfTerm, including response-local blank terms.',
          '直接 IRdfTerm，含响应局部 blank 项。'
        ),
        backend: t('Actual backend diagnostic or undefined.', '真实后端诊断，或 undefined。')
      },
      returns: t(
        'Frozen normalized IRdfTerm; malformed fields throw INVALID_ARGUMENT with the exact getter cause.',
        '冻结规范 IRdfTerm；非法字段抛 INVALID_ARGUMENT，保留精确 getter 原因。'
      ),
      example: storageContractCases.snapshotStorageRdfTerm![0]!.example,
      cases: storageContractCases.snapshotStorageRdfTerm
    },
    snapshotStorageRdfPattern: {
      role: 'operation',
      purpose: t(
        'Capture only supplied ground positions without inserting a default graph.',
        '只捕获给定 ground 位置，不补入默认图。'
      ),
      params: {
        pattern: t(
          'Partial ground IQuad; an omitted field is unconstrained.',
          '部分 ground IQuad；省略字段不加约束。'
        ),
        backend: t('Actual backend diagnostic or undefined.', '真实后端诊断，或 undefined。')
      },
      returns: t(
        'Frozen detached partial IQuad; blank or invalid positional terms reject INVALID_ARGUMENT.',
        '冻结独立的部分 IQuad；blank 或非法位置项报 INVALID_ARGUMENT。'
      ),
      example: storageContractCases.snapshotStorageRdfPattern![0]!.example,
      cases: storageContractCases.snapshotStorageRdfPattern
    },
    snapshotStorageRdfQuad: {
      role: 'operation',
      purpose: t(
        'Capture every required ground position before native identity or writes.',
        '在原生身份处理或写入前捕获每个必需 ground 位置。'
      ),
      params: {
        quad: t(
          'Complete ground IQuad with all four positions.',
          '具四个完整位置的 ground IQuad。'
        ),
        backend: t('Actual backend diagnostic or undefined.', '真实后端诊断，或 undefined。')
      },
      returns: t(
        'Frozen detached IQuad; missing or illegal positions throw INVALID_ARGUMENT before I/O.',
        '冻结独立 IQuad；缺失或非法位置在 I/O 前抛 INVALID_ARGUMENT。'
      ),
      example: storageContractCases.snapshotStorageRdfQuad![0]!.example,
      cases: storageContractCases.snapshotStorageRdfQuad
    },
    encodeStorageRdfQuad: {
      role: 'operation',
      purpose: t(
        'Snapshot ground RDF identity and encode term boundaries with the original ordered-key writer.',
        '快照 ground RDF 身份，并用原有序键 writer 编码项边界。'
      ),
      params: {
        quad: t(
          'Complete ground IQuad; caller object identity is irrelevant.',
          '完整 ground IQuad；不使用调用方对象身份。'
        ),
        backend: t('Actual backend diagnostic or undefined.', '真实后端诊断，或 undefined。')
      },
      returns: t(
        'Independent Uint8Array identity bytes using term type, exact IRI/value and normalized datatype/language.',
        '独立 Uint8Array 身份字节，使用项类型、精确 IRI/value 和规范 datatype/language。'
      ),
      example: storageContractCases.encodeStorageRdfQuad![0]!.example,
      cases: storageContractCases.encodeStorageRdfQuad
    },
    createStorageBatchKeyCapture: {
      role: 'operation',
      purpose: t(
        'Capture native batch keys in the backend’s existing per-entry getter and failure order.',
        '按后端既有逐项 getter 与失败次序捕获原生批键。'
      ),
      params: {
        backend: t('Actual backend diagnostic or undefined.', '真实后端诊断，或 undefined。')
      },
      returns: t(
        'One pure IStorageBatchKeyCapture for this batch. Each call snapshots only the supplied key and returns canonical identity/firstIndex. The backend rejects duplicates at its original point; values and TTL remain backend-owned.',
        '本批次独立的纯 IStorageBatchKeyCapture。每次调用只快照给定键，返回规范身份/firstIndex；后端于原校验点拒绝重复，value 与 TTL 仍归后端。'
      ),
      example: storageContractCases.createStorageBatchKeyCapture![0]!.example,
      cases: storageContractCases.createStorageBatchKeyCapture
    },
    ttl: {
      role: 'constant',
      purpose: t(
        'Exact standard token for native physical-channel TTL.',
        '原生物理通道 TTL 的精确标准令牌。'
      ),
      example: storageContractCases.ttl![0]!.example,
      cases: storageContractCases.ttl
    },
    sql: {
      role: 'constant',
      purpose: t(
        'Exact standard token for a nested native SQL executor.',
        '嵌套原生 SQL executor 的精确标准令牌。'
      ),
      example: storageContractCases.sql![0]!.example,
      cases: storageContractCases.sql
    },
    blob: {
      role: 'constant',
      purpose: t(
        'Exact standard token for independent native byte objects.',
        '独立原生字节对象的精确标准令牌。'
      ),
      example: storageContractCases.blob![0]!.example,
      cases: storageContractCases.blob
    },
    durableChangeFeed: {
      role: 'constant',
      purpose: t(
        'Exact optional token for native durable replay and tails.',
        '原生持久重放与 tail 的精确可选令牌。'
      ),
      example: storageContractCases.durableChangeFeed![0]!.example,
      cases: storageContractCases.durableChangeFeed
    },
    sparql: {
      role: 'constant',
      purpose: t(
        'Exact native callable SPARQL capability, without a generic transaction projection.',
        '原生 callable SPARQL 的精确能力，不带通用事务投影。'
      ),
      example: storageContractCases.sparql![0]!.example,
      cases: storageContractCases.sparql
    },
    sparqlFragment: {
      role: 'operation',
      purpose: t(
        'Capture validated RDF values and authentic pure fragment references.',
        '捕获已校验 RDF 值与真实纯片段引用。'
      ),
      params: {
        strings: t('A real frozen template.', '真实冻结模板。'),
        values: t(
          'NamedNode, Literal or authentic fragment inputs.',
          'NamedNode、Literal 或真实片段输入。'
        )
      },
      returns: t(
        'Frozen pure ISparqlFragment without terminals. var/join/empty share the same identity owner.',
        '不带终端的冻结纯 ISparqlFragment；var/join/empty 共用同一身份 owner。'
      ),
      example: storageContractCases.sparqlFragment![0]!.example,
      cases: storageContractCases.sparqlFragment
    },
    createSparqlTag: {
      role: 'operation',
      purpose: t(
        'Bind pure SPARQL nodes to original native callbacks after their actual admission.',
        '将纯 SPARQL 节点绑定至实际准入后的原生回调。'
      ),
      params: {
        options: t(
          'Original select/ask/construct/update callbacks receiving lazy prepare and original ctx.',
          '接收 lazy prepare 与原 ctx 的 select/ask/construct/update 原回调。'
        )
      },
      returns: t(
        'Frozen ISparqlApi retaining native receiver and Promise identities; no endpoint or lifecycle is created.',
        '保留原生 receiver 与 Promise 身份的冻结 ISparqlApi；不创建 endpoint 或生命周期。'
      ),
      example: storageContractCases.createSparqlTag![0]!.example,
      cases: storageContractCases.createSparqlTag
    },
    vector: {
      role: 'constant',
      purpose: t(
        'Exact standard capability for native vector collections.',
        '原生向量 collection 的精确标准能力。'
      ),
      example: storageContractCases.vector![0]!.example,
      cases: storageContractCases.vector
    },
    rdf: {
      role: 'constant',
      purpose: t(
        'Exact standard ground RDF capability and original transaction projection.',
        '精确标准 ground RDF 能力与原事务投影。'
      ),
      example: storageContractCases.rdf![0]!.example,
      cases: storageContractCases.rdf
    },
    DeleteCountMode: {
      role: 'constant',
      purpose: t(
        'Precount or scroll strategy for native shared vector deletion counts.',
        '原生共享向量删除计数的 precount 或 scroll 策略。'
      ),
      example: storageContractCases.DeleteCountMode![0]!.example,
      cases: storageContractCases.DeleteCountMode
    },
    counter: {
      role: 'constant',
      purpose: t(
        'Exact standard token for atomic canonical decimal text increments.',
        '原子规范十进制文本递增的精确标准令牌。'
      ),
      example: storageContractCases.counter![0]!.example,
      cases: storageContractCases.counter
    },
    snapshotStorageTtlTarget: {
      role: 'operation',
      purpose: t(
        'Capture TTL targets with the original physical lock-key validator.',
        '通过原物理锁键 validator 捕获 TTL 目标。'
      ),
      params: {
        target: t(
          'Typed text, byte, record or vector target; use the channel containing the value.',
          'typed 文本、字节、记录或向量目标，选择实际持有值的通道。'
        ),
        backend: t('Actual backend diagnostic or undefined.', '真实后端诊断，或 undefined。')
      },
      returns: t(
        'Detached frozen ITtlTarget, with original INVALID_KEY or INVALID_ARGUMENT failures.',
        '独立冻结的 ITtlTarget，保留原 INVALID_KEY 或 INVALID_ARGUMENT 失败。'
      ),
      example: storageContractCases.snapshotStorageTtlTarget![0]!.example,
      cases: storageContractCases.snapshotStorageTtlTarget
    },
    assertStorageTtlDuration: {
      role: 'operation',
      purpose: t(
        'Admit finite nonnegative milliseconds before native TTL work.',
        '在原生 TTL 操作前接纳有限非负毫秒数。'
      ),
      params: {
        ms: t(
          'Finite nonnegative milliseconds, including zero and fractions.',
          '有限非负毫秒数，包含零与小数。'
        ),
        backend: t('Actual backend diagnostic or undefined.', '真实后端诊断，或 undefined。')
      },
      returns: t(
        'Returns void; invalid duration throws INVALID_ARGUMENT before I/O.',
        '返回 void；非法期限在 I/O 前抛 INVALID_ARGUMENT。'
      ),
      example: storageContractCases.assertStorageTtlDuration![0]!.example,
      cases: storageContractCases.assertStorageTtlDuration
    },
    snapshotStorageCounterIncrement: {
      role: 'operation',
      purpose: t(
        'Capture a safe integer delta before I/O for calculation inside an existing atomic text operation.',
        '在 I/O 前捕获安全整数增量，供既有原子文本操作内部计算。'
      ),
      params: {
        by: t(
          'Safe integer delta; undefined captures the default of one.',
          '安全整数增量；undefined 捕获默认值一。'
        ),
        backend: t('Actual backend diagnostic or undefined.', '真实后端诊断，或 undefined。')
      },
      returns: t(
        'Pure IStorageCounterIncrement from current text to the next safe integer. Missing text starts at zero; noncanonical text or overflow throws INVALID_ARGUMENT and never writes.',
        '从当前文本计算下一安全整数的纯 IStorageCounterIncrement。缺失文本从零起算；非规范文本或溢出抛 INVALID_ARGUMENT，不执行写入。'
      ),
      example: storageContractCases.snapshotStorageCounterIncrement![0]!.example,
      cases: storageContractCases.snapshotStorageCounterIncrement
    },
    snapshotStorageBatchKeys: {
      role: 'operation',
      purpose: t(
        'Capture detached native batch keys and canonical identities once before I/O.',
        '在 I/O 前单次捕获独立的原生批键与规范身份。'
      ),
      params: {
        keys: t(
          'The native batch logical keys in caller order.',
          '按调用方顺序排列的原生批次逻辑键。'
        ),
        backend: t('Actual backend diagnostic or undefined.', '真实后端诊断，或 undefined。'),
        options: t('Optional duplicate-write admission policy.', '可选的重复写键接纳策略。')
      },
      optionDocs: {
        rejectDuplicates: {
          summary: t(
            'Reject equivalent canonical keys before native writes; false preserves every position.',
            '在原生写入前拒绝相同规范键；false 保留每个位置。'
          ),
          default: t('Omitted: preserve duplicates.', '省略时保留重复位置。'),
          example: `snapshotStorageBatchKeys(keys, 'memory', { rejectDuplicates: true })`
        }
      },
      returns: t(
        'Frozen readonly IStorageBatchKey rows with detached key, canonical byte identity and firstIndex. Invalid lists/options or duplicate writes throw INVALID_ARGUMENT; invalid keys retain INVALID_KEY. No I/O or resource authority.',
        '冻结的只读 IStorageBatchKey 行，包含独立 key、规范字节身份和 firstIndex。非法列表/选项或重复写键抛 INVALID_ARGUMENT；非法键保留 INVALID_KEY；不创建 I/O 或资源权限。'
      ),
      example: storageContractCases.snapshotStorageBatchKeys![0]!.example,
      cases: storageContractCases.snapshotStorageBatchKeys
    },
    snapshotStorageKeyPrefix: {
      role: 'operation',
      purpose: t(
        'Snapshot one typed prefix through the canonical key validator/writer and produce native ordered bounds.',
        '通过规范键 validator/writer 快照一个 typed 前缀，生成原生有序边界。'
      ),
      params: {
        prefix: t(
          'Existing key domain: string/buffer content prefix, complete array-child prefix, or exact number/Date identity.',
          '现有键域：string/buffer 内容前缀、完整 array 子键前缀，或精确 number/Date 身份。'
        ),
        backend: t(
          'Actual backend diagnostic or undefined when no store exists.',
          '真实后端诊断；无 store 时为 undefined。'
        )
      },
      returns: t(
        'IStorageKeyPrefix with detached logical key, inclusive lower, exclusive upper and private canonical matches. No store scan, index or authority.',
        'IStorageKeyPrefix：独立逻辑键、包含 lower、不包含 upper 和私有规范 matches；无存量扫描、索引或权限。'
      ),
      example: storageContractCases.snapshotStorageKeyPrefix![0]!.example,
      cases: storageContractCases.snapshotStorageKeyPrefix
    },
    useTransactionCapability: {
      role: 'operation',
      purpose: t(
        'Read the sole capability table through an authentic original transaction view.',
        '通过真实原事务视图读取唯一能力表。'
      ),
      params: {
        scope: t(
          'Authentic live full scope with its precise admitted capability set; raw/frozen scopes are not modified.',
          '具备精确已接纳能力集合的真实活跃完整 scope；不修改 raw/frozen scope。'
        ),
        capability: t(
          'Authentic published kv or records with an original forTransaction binder.',
          '具备原 forTransaction 绑定的真实已发布 kv 或 records。'
        )
      },
      returns: t(
        'One frozen view-local projection with no binder/I/O during lookup. Data execution and complete query terminals enter the original owner; invalidation clears the cache.',
        '一个冻结的视图局部投影；取用时不调用 binder、不 I/O；数据执行和完整查询终点进入原 owner，失效清空缓存。'
      ),
      example: storageContractCases.useTransactionCapability![0]!.example,
      cases: storageContractCases.useTransactionCapability
    },
    sqlFragment: {
      role: 'operation',
      purpose: t(
        'Construct pure opaque SQL fragments with immutable node references and scalar/byte snapshots.',
        '通过不可变节点引用与标量、字节快照构造纯不透明 SQL 片段。'
      ),
      params: {
        strings: t(
          'Frozen cooked/raw template arrays; plain SQL strings are rejected.',
          '冻结 cooked/raw 模板数组；拒绝普通 SQL 字符串。'
        ),
        values: t(
          'ISqlValue or authentic shared fragments, in occurrence order.',
          '按出现顺序的 ISqlValue 或真实共用片段。'
        )
      },
      returns: t(
        'ISqlFragment only, with no all/get/run. id quotes components, join preserves repeated references and empty adds no text.',
        '仅 ISqlFragment，没有 all/get/run；id 引用各段，join 保留重复引用，empty 不增加文本。'
      ),
      example: storageContractCases.sqlFragment![0]!.example,
      cases: storageContractCases.sqlFragment
    },
    createSqlTag: {
      role: 'operation',
      purpose: t(
        'Bind the same fragment/scanner owner to original backend all/get/run callbacks.',
        '将同一片段与 scanner owner 绑定至原后端 all/get/run 回调。'
      ),
      params: {
        options: t(
          'dialect sqlite/postgres plus original all/get/run callbacks. Each receives lazy prepare and original ctx; perform original admission before prepare.',
          'sqlite/postgres 方言与原 all/get/run 回调；各自接收 lazy prepare 和原 ctx，先原准入，再 prepare。'
        )
      },
      returns: t(
        'ISqlTag preserving native value/result refinements and original callback Promise identity; no connection or resource authority.',
        '保留原生值域、结果细化与原回调 Promise 身份的 ISqlTag；无连接或资源权限。'
      ),
      example: storageContractCases.createSqlTag![0]!.example,
      cases: storageContractCases.createSqlTag
    },
    deriveStorageSqlQuery: {
      role: 'operation',
      purpose: t(
        'Derive terminal callbacks over the same authentic SQL node.',
        '在同一真实 SQL 节点上派生终端回调。'
      ),
      params: {
        fragment: t('An authentic existing SQL fragment or query.', '已有真实 SQL 片段或查询。'),
        terminals: t(
          'Original all/get/run callbacks, captured once.',
          '一次捕获的原 all/get/run 回调。'
        )
      },
      returns: t(
        'Frozen ISqlQuery sharing the original node; callback receiver, context and Promise identity remain exact.',
        '共享原节点的冻结 ISqlQuery；原回调 receiver、context 与 Promise 身份保持精确。'
      ),
      example: storageContractCases.deriveStorageSqlQuery![0]!.example,
      cases: storageContractCases.deriveStorageSqlQuery
    },
    orderStorageKeysByBytes: {
      role: 'operation',
      purpose: t(
        'Return original entries in stable canonical byte order.',
        '按稳定规范字节序返回原条目。'
      ),
      params: {
        entries: t('Input entries in their original order.', '原顺序输入条目。'),
        key: t(
          'One byte selector invocation per entry; copied immediately.',
          '每条目调用一次并立即复制的字节 selector。'
        )
      },
      returns: t(
        'Frozen array of original entries. Equal byte keys retain input order; selector failures retain cause.',
        '原条目的冻结数组；相同字节键保留输入顺序，selector 失败保留 cause。'
      ),
      example: storageContractCases.orderStorageKeysByBytes![0]!.example,
      cases: storageContractCases.orderStorageKeysByBytes
    },
    encodeStorageOrgStringPrefix: {
      role: 'operation',
      purpose: t(
        'Encode a string content prefix inside the exact original organization envelope.',
        '在精确原组织 envelope 内编码 string 内容前缀。'
      ),
      params: {
        orgId: t('Canonical lowercase UUID.', '规范小写 UUID。'),
        prefix: t(
          'Logical string prefix, including empty or lone UTF-16 surrogates.',
          '逻辑 string 前缀，含空值与单独 UTF-16 代理项。'
        ),
        backend: t('Original backend diagnostic.', '原后端诊断。')
      },
      returns: t(
        'Independent canonical byte prefix, without the final string/tuple terminators.',
        '独立规范字节前缀，不含最后 string/tuple 终止符。'
      ),
      example: storageContractCases.encodeStorageOrgStringPrefix![0]!.example,
      cases: storageContractCases.encodeStorageOrgStringPrefix
    },
    snapshotConcurrencyLockKeys: {
      role: 'operation',
      purpose: t(
        'Snapshot paired canonical keys and identities without acquiring locks.',
        '对配对规范键与身份制作快照，不取锁。'
      ),
      params: {
        keys: t(
          'Unknown lock array admitted once by the original normalizer.',
          '原规范化器一次准入的未知锁数组。'
        ),
        backend: t('Actual backend diagnostic name.', '实际后端诊断名。')
      },
      returns: t(
        'Frozen detached sorted/deduplicated keys and matching readonly hexadecimal identities, without authority.',
        '冻结的独立排序去重键与配对只读十六进制身份，不授予权限。'
      ),
      example: storageContractCases.snapshotConcurrencyLockKeys![0]!.example,
      cases: storageContractCases.snapshotConcurrencyLockKeys
    },
    snapshotConcurrencyLockRange: {
      role: 'operation',
      purpose: t(
        'Project a channel or typed prefix into canonical half-open lock identity bounds.',
        '将通道或 typed 前缀投影为规范半开锁身份边界。'
      ),
      params: {
        range: t(
          'Channel and optional typed prefix; byte prefixes must be strings, including empty.',
          '通道与可选 typed 前缀；bytes 前缀须为字符串，可为空。'
        ),
        backend: t('Actual backend diagnostic name.', '实际后端诊断名。')
      },
      returns: t(
        'Frozen lower/upper hexadecimal bounds using original channel ranks and key prefix encoding. No lock authority.',
        '冻结的 lower/upper 十六进制边界，复用原通道顺序与键前缀编码，无取锁权限。'
      ),
      example: storageContractCases.snapshotConcurrencyLockRange![0]!.example,
      cases: storageContractCases.snapshotConcurrencyLockRange
    },
    snapshotConcurrencyLockHoldings: {
      role: 'operation',
      purpose: t(
        'Snapshot current inspection rows using the original stable canonical lock order.',
        '复用原稳定规范锁顺序，对当前检查行制作快照。'
      ),
      params: {
        rows: t(
          'Current typed inspection rows; no acquisition or waiting occurs.',
          '当前 typed 检查行；不取锁、不等待。'
        )
      },
      returns: t(
        'Frozen detached key/holder rows preserving expired, expiresAt and separate equal-key rows, without lock authority.',
        '冻结的独立键与 holder 行，保留 expired、expiresAt 和相同键的独立行，不授予锁权限。'
      ),
      example: storageContractCases.snapshotConcurrencyLockHoldings![0]!.example,
      cases: storageContractCases.snapshotConcurrencyLockHoldings
    },
    readConcurrencyLockIdentities: {
      role: 'operation',
      purpose: t(
        'Read immutable lock identities from the original active attempt metadata without re-encoding logical keys.',
        '从原活跃 attempt 元数据读取不可变锁身份，不重新编码逻辑键。'
      ),
      params: {
        ctx: t(
          'Authentic active IConcurrencyAttemptContext; forged, settled or builder-only objects reject INVALID_ARGUMENT.',
          '真实活跃 IConcurrencyAttemptContext；伪造、已结算或只有 builder 元数据的对象抛 INVALID_ARGUMENT。'
        )
      },
      returns: t(
        'One frozen canonical channel-separated hexadecimal string list, shared across repeated reads and nested attempts. No mutable bytes, registration or control authority.',
        '一个冻结、带规范通道隔离的十六进制字符串列表，重复读取和嵌套尝试共用；无可变字节、登记或控制权限。'
      ),
      example: storageContractCases.readConcurrencyLockIdentities![0]!.example,
      cases: storageContractCases.readConcurrencyLockIdentities
    },
    records: {
      role: 'constant',
      purpose: t(
        'Authentic standard records API token, implemented by a native backend or a Feature through the same provider table.',
        '真实标准 records API token，由原生后端或 Feature 经同一 provider 表实现。'
      ),
      returns: t(
        'IRecordsApi query uses the implemented shared IQueryChain slice; removeByPrefix stays with the original native write pipeline.',
        'IRecordsApi 的 query 使用已实现的共用 IQueryChain 切片；removeByPrefix 保持原生写入 pipeline。'
      ),
      example: storageContractCases.records![0]!.example,
      cases: storageContractCases.records
    },
    hasStorageCapability: {
      role: 'operation',
      purpose: t(
        'Read authentic published token membership through the original provider table without modifying the base.',
        '通过原 provider 表读取真实已发布 token 成员关系，不修改 base。'
      ),
      params: {
        store: t(
          'Original IStorageBase, including raw/frozen resources.',
          '原 IStorageBase，包括 raw/frozen 资源。'
        ),
        capability: t(
          'Capability token; forged or missing tokens return false, exactly like store.has(token).',
          '能力 token；伪造或缺失返回 false，与 store.has(token) 相同。'
        )
      },
      returns: t(
        'Boolean membership only; no installation, ownership or base handle.',
        '仅 boolean 成员关系，不提供安装、所有权或 base 句柄。'
      ),
      example: storageContractCases.hasStorageCapability![0]!.example,
      cases: storageContractCases.hasStorageCapability
    },
    useStorageCapability: {
      role: 'operation',
      purpose: t(
        'Read the same original capability API and native refinements as store.use(token), without provider authority.',
        '读取与 store.use(token) 相同的原能力 API 与原生扩展，不取得 provider 权限。'
      ),
      params: {
        store: t(
          'Original IStorageBase; provided diagnostics reuse its captured backend.',
          '原 IStorageBase；已提供 store 的诊断复用捕获 backend。'
        ),
        capability: t(
          'Authentic published token. Forged tokens throw INVALID_ARGUMENT; authentic missing tokens throw UNSUPPORTED_CAPABILITY.',
          '真实已发布 token；伪造抛 INVALID_ARGUMENT，真实缺失抛 UNSUPPORTED_CAPABILITY。'
        )
      },
      returns: t(
        'The exact installed API object with native implementation types; late Feature publication uses the same table.',
        '精确已安装 API 对象与原生实现类型，晚发布 Feature 复用同一表。'
      ),
      example: storageContractCases.useStorageCapability![0]!.example,
      cases: storageContractCases.useStorageCapability
    },
    createRecordQuery: {
      role: 'factory',
      purpose: t(
        'Create the shared immutable record reader with conditions, projections, limit, bounded comparator ordering, all and stream over one original cursor.',
        '在原游标上创建共用、不可变的记录读取器，支持条件、投影、limit、有界比较器排序、all 与 stream。'
      ),
      params: {
        source: t(
          "IRecordQuerySource captures pushdown facts, execute and optional readonly asyncDisposeKey once. execute receives only safe-prefix conditions, optional fields and captured operation context; projected native rows are unknown. Pass the host's existing resource key when it supplies a fallback for native Symbol.asyncDispose.",
          'IRecordQuerySource 一次捕获下推事实、execute 与可选只读 asyncDisposeKey；execute 仅接收安全前缀条件、可选字段及捕获的操作上下文，原生投影行保持 unknown。宿主使用原生 Symbol.asyncDispose 的既有后备键时应传入同一个资源键。'
        ),
        methods: t(
          'Optional Feature-owned pure method object; capture once and retain each function reference on every where/select/requirePushdown result.',
          '可选的 Feature 自有纯方法对象；一次捕获，每个 where/select/requirePushdown 结果保留原函数引用。'
        )
      },
      returns: t(
        'IRecordQuery<T,TContext,TAugmentMethods> with three where forms, one select, all, real stream, explain, requirePushdown, limit and orderByComparator(compare).limit(k). Missing comparator bounds and invalid limits reject before source execution. Limit and comparator are client steps in this slice. all synchronously admits its full mapper/cleanup lifetime to the original transaction iterator owner and retains its first failure before cleanup.',
        '返回 IRecordQuery<T,TContext,TAugmentMethods>，具有三种 where、一次 select、all、真实 stream、explain、requirePushdown、limit 与 orderByComparator(compare).limit(k)；缺少比较器上限或 limit 无效时在源执行前拒绝，本切片 limit 与比较器为客户端步骤。all 同步把完整 mapper/清理区间登记到原事务迭代器 owner，清理前保留首错。'
      ),
      example: storageContractCases.createRecordQuery![0]!.example,
      cases: storageContractCases.createRecordQuery
    },
    createVectorQuery: {
      role: 'factory',
      purpose: t(
        'Create an immutable pre-topK vector builder over the native ranking cursor.',
        '在原生排名游标上创建 topK 前的不可变向量 builder。'
      ),
      params: {
        source: t(
          'IVectorQuerySource captures native support, execute, optional exact/groupBy and the original resource key.',
          'IVectorQuerySource 捕获原生支持、execute、可选 exact/groupBy 与原资源键。'
        ),
        methods: t(
          'Optional original pure Feature functions; reserved names reject before I/O.',
          '可选的原 Feature 纯函数；保留名冲突在 I/O 前拒绝。'
        )
      },
      returns: t(
        'IVectorQueryBuilder; topK enables shared reads. Native filters cross payload callbacks before ranking; callbacks never refill hits.',
        '返回 IVectorQueryBuilder；topK 开启共享读取。原生过滤跨 payload 回调在排名前执行；回调不补搜命中。'
      ),
      example: storageContractCases.createVectorQuery![0]!.example,
      cases: storageContractCases.createVectorQuery
    },
    createRdfQuery: {
      role: 'factory',
      purpose: t(
        'Create a ground RDF read query with ordered native traversal steps.',
        '创建带有序原生遍历步骤的 ground RDF 读取查询。'
      ),
      params: {
        source: t(
          'IRdfQuerySource returns its original storage iterator from the ordered safe native prefix.',
          'IRdfQuerySource 按有序安全原生前缀返回原 storage iterator。'
        ),
        pattern: t(
          'Canonical partial ground quad; omitted graph matches all graphs.',
          '规范部分 ground quad；省略 graph 匹配所有 graph。'
        ),
        methods: t('Optional original pure Feature functions.', '可选的原 Feature 纯函数。')
      },
      returns: t(
        'IRdfQuery with common reads, projection, limit and native follow/inverse. Client traversal, pages and writes remain subsequent units.',
        '返回 IRdfQuery，支持共享读取、投影、limit 与原生 follow/inverse；客户端遍历、分页与写入仍待后续单元。'
      ),
      example: storageContractCases.createRdfQuery![0]!.example,
      cases: storageContractCases.createRdfQuery
    },
    VectorQueryMethod: {
      role: 'constant',
      purpose: t(
        'Canonical reserved shared and vector query methods.',
        '共享与向量查询的规范保留方法。'
      ),
      example: 'console.log(VectorQueryMethod.topK, VectorQueryMethod.withVector)'
    },
    RdfQueryMethod: {
      role: 'constant',
      purpose: t(
        'Canonical reserved shared and RDF traversal methods.',
        '共享与 RDF 遍历的规范保留方法。'
      ),
      example: 'console.log(RdfQueryMethod.follow, RdfQueryMethod.inverse)'
    },
    RecordQueryMethod: {
      role: 'constant',
      purpose: t(
        'Canonical built-in record query names; Feature methods with these names reject before source execution.',
        '记录查询内建方法的规范名称；同名 Feature 方法在数据源执行前拒绝。'
      ),
      example: 'console.log(RecordQueryMethod.where, RecordQueryMethod.all) // where all'
    },
    TransactionBuilderMethod: {
      role: 'constant',
      purpose: t(
        'Canonical reserved builder methods shared by unlocked and locked branches.',
        '未锁定与已锁定分支共用的规范 builder 保留方法。'
      ),
      example:
        'console.log(TransactionBuilderMethod.lock, TransactionBuilderMethod.run) // lock run'
    },
    QueryOperation: {
      role: 'constant',
      purpose: t(
        'Canonical planner vocabulary. A backend declares its real operation subset; names alone do not install chain methods.',
        '规范规划词汇；后端声明真实支持的子集，名称本身不安装查询方法。'
      ),
      example: 'console.log(QueryOperation.where, QueryOperation.select) // where select'
    },
    compileStorageWhere: {
      role: 'operation',
      purpose: t(
        'Capture the canonical declarative AST once and compile a stateless typed candidate predicate.',
        '一次捕获规范声明式 AST，编译无状态 typed 候选谓词。'
      ),
      params: {
        where: t(
          'Typed IWhere<T> with nested fields, and/or/not and valid field operators; function predicates are not declarative input.',
          '包含嵌套字段、and/or/not 与有效字段操作符的 typed IWhere<T>，函数谓词不是声明式输入。'
        )
      },
      returns: t(
        '(value:T)=>boolean with one-time membership Sets, captured Date bounds and noncoercive comparison. Invalid conditions or paths reject before reading a source.',
        '(value:T)=>boolean；成员 Set 只编译一次，Date 边界捕获时间，比较不强制转换；无效条件或路径在读取数据源前拒绝。'
      ),
      example: storageContractCases.compileStorageWhere![0]!.example,
      cases: storageContractCases.compileStorageWhere
    },
    QueryOperator: {
      role: 'constant',
      purpose: t(
        'Single runtime table of supported declarative field operators.',
        '声明式字段操作符的唯一运行时表。'
      ),
      example: 'console.log(QueryOperator.eq, QueryOperator.in) // eq in'
    },
    createTransactionBuilder: {
      role: 'factory',
      purpose: t(
        'Create an immutable builder that preserves the actual native transaction scope and options without starting work.',
        '创建保留真实原生事务 scope 与 options 的不可变 builder，不启动工作。'
      ),
      params: {
        store: t(
          'Original registered storage resource with a real transaction method; full callback scope and options are inferred.',
          '具有真实 transaction 方法的原登记存储资源；推断完整回调 scope 与 options。'
        ),
        options: t(
          'Optional native transaction options excluding lock. Capture fields once; each derivation shares them without copying accumulated lock history.',
          '不含 lock 的可选原生事务选项；字段只捕获一次，各派生共享选项，不复制累计锁历史。'
        ),
        methods: t(
          'Optional Feature-owned pure methods. Configuration and lock branches retain the original references and complete inferred method types.',
          '可选的 Feature 自有纯方法；配置与 lock 分支保留原函数引用及完整推断方法类型。'
        )
      },
      returns: t(
        'Unlocked ITransactionBuilder with no run method. lock creates a locked builder; run normalizes once, invokes the original transaction once and preserves its Promise identity.',
        '没有 run 方法的未锁定 ITransactionBuilder；lock 创建已锁定 builder；run 只规范化一次、调用原 transaction 一次并保留 Promise 身份。'
      ),
      example: storageContractCases.createTransactionBuilder![0]!.example,
      cases: storageContractCases.createTransactionBuilder
    },
    runWithConcurrency: {
      role: 'operation',
      purpose: t(
        'Run the sole logical policy loop while awaiting every accepted native attempt through cleanup.',
        '运行唯一逻辑策略循环，并等待每次接纳的原生尝试完成清理。'
      ),
      params: {
        request: t(
          'Authentic registered store and original options or exact outer attempt; optional policy overrides the owner default. Optional execute(captured, invokeOriginalLoop) wraps the real native loop once so before-next, after-next and catch remain in the original pipeline and call budget. Optional prepare(captured) settles once under the original deadline and signal before lock derivation; it is never a native attempt. Optional lock(captured) merges implicit locks with explicit locks. Optional executeAttempt(captured, proceed), mutually exclusive with execute, wraps each native commit attempt: acquisition retries stay within one stage; a fully unwound commit conflict rethrows its exact coded identity before the original policy can retry. Stage halt/recovery settles directly. Each new segment derives from initial explicit/inherited locks while retaining the same captured options, signal and budget.',
          '真实登记 store 与原 options 或精确外层 attempt；policy 省略用原默认。可选 execute(captured, invokeOriginalLoop) 在原调用预算下包围一次真实循环，保留原 pipeline 的 before-next、after-next 与 catch。可选 prepare(captured) 在原期限与信号下完成一次，再派生锁；它不算原生尝试。可选 lock(captured) 合并隐式与显式锁。可选 executeAttempt(captured, proceed) 与 execute 互斥，包围每次原生提交尝试：纯获取冲突留在同一 stage；提交冲突完整收尾后仍抛同一 coded 身份，原策略才可重试。stage 提前返回或恢复直接结算；新段从最初显式/继承锁派生，沿用同一 options 捕获、signal 与预算。'
        ),
        port: t(
          'Real backend attempt port. Return committed or conflict only after native completion and cleanup; use context.wait for logical admission and waitPhysical for physical scheduling.',
          '真实后端 attempt 接点；原生终态与清理后才返回 committed/conflict；逻辑准入用 context.wait，物理调度用 waitPhysical。'
        )
      },
      returns: t(
        'Promise of the awaited committed value. Conflict errors preserve backend cause; cancellation awaits real attempt termination. Exact nested attempt contexts reuse the original budget and retain captured backend extension fields.',
        '完成提交值的 Promise；冲突保留后端 cause，取消仍等待真实尝试结束；相同嵌套 attempt context 复用原预算，并保留已捕获后端扩展字段。'
      ),
      example: storageContractCases.runWithConcurrency![0]!.example,
      cases: storageContractCases.runWithConcurrency
    },
    resolveConcurrencyPolicy: {
      role: 'operation',
      purpose: t(
        'Resolve an authentic override or captured default from the original transaction owner.',
        '从原事务 owner 解析真实覆盖策略或已捕获默认策略。'
      ),
      params: {
        store: t(
          'Original store registered by createTransactionOwner.',
          'createTransactionOwner 登记的原 store。'
        ),
        override: t(
          'Optional genuine policy; omission reuses the original registered default.',
          '可选真实策略，省略时复用原登记默认值。'
        )
      },
      returns: t(
        'The exact selected IConcurrencyPolicy identity; forged policies or stores throw INVALID_ARGUMENT.',
        '所选 IConcurrencyPolicy 的精确身份；伪造策略或 store 抛 INVALID_ARGUMENT。'
      ),
      example: storageContractCases.runWithConcurrency![0]!.example
    },
    prefixStorageOrgKey: {
      role: 'operation',
      purpose: t(
        'Wrap a detached logical key in one canonical organization segment without consuming its logical key budget.',
        '将独立逻辑键快照封装为一个规范组织段，不消耗逻辑键预算。'
      ),
      params: {
        orgId: t(
          'Canonical lowercase 36-character UUID, including zero; no default is inserted.',
          '规范小写 36 字符 UUID，包括全零值；不插入默认值。'
        ),
        key: recordKeyParam
      },
      returns: t(
        'Detached three-part IStorageKey envelope [marker, orgId, logicalKey]; tuple keys remain nested. Invalid org throws INVALID_ARGUMENT; invalid logical key throws INVALID_KEY.',
        '独立三项 IStorageKey 封装 [marker, orgId, logicalKey]；元组键保留嵌套。无效组织抛 INVALID_ARGUMENT，无效逻辑键抛 INVALID_KEY。'
      ),
      example: storageContractCases.prefixStorageOrgKey![0]!.example,
      cases: storageContractCases.prefixStorageOrgKey
    },
    unprefixStorageOrgKey: {
      role: 'operation',
      purpose: t(
        'Return a detached logical key only from the exact envelope for the requested organization.',
        '仅从指定组织的精确封装返回独立逻辑键快照。'
      ),
      params: {
        orgId: t(
          'Exact canonical lowercase UUID expected in the physical key.',
          '物理键中应匹配的精确规范小写 UUID。'
        ),
        key: t(
          'Three-part envelope returned by prefixStorageOrgKey.',
          'prefixStorageOrgKey 返回的三项封装。'
        )
      },
      returns: t(
        'Detached contained IStorageKey; a foreign or malformed envelope throws INVALID_ARGUMENT, while invalid logical key data retains INVALID_KEY.',
        '独立内部 IStorageKey；其他组织或无效封装抛 INVALID_ARGUMENT，内部无效逻辑键保留 INVALID_KEY。'
      ),
      example: storageContractCases.unprefixStorageOrgKey![0]!.example,
      cases: storageContractCases.unprefixStorageOrgKey
    },
    lockKey: {
      role: 'constant',
      purpose: t(
        'Canonical text, bytes and record lock factories validate and snapshot immediately without acquiring locks.',
        '规范文本、字节与记录锁工厂立即校验和快照，不取得锁。'
      ),
      example: storageContractCases.lockKey![0]!.example,
      cases: storageContractCases.lockKey
    },
    defineConcurrencyPolicy: {
      role: 'operation',
      purpose: t(
        'Capture authentic frozen policy metadata and a private decision callback without executing work.',
        '捕获真实冻结策略元数据与私有决策回调，不执行工作。'
      ),
      params: {
        definition: t(
          'Nonblank name, pessimistic/optimistic locking, and a synchronous or asynchronous decision callback; fields are read once.',
          '非空白 name、pessimistic/optimistic locking 与同步或异步决策回调；字段只读一次。'
        )
      },
      returns: t(
        'Immutable IConcurrencyPolicy retaining name/locking literals. Invalid metadata or option getters reject with INVALID_ARGUMENT and exact cause.',
        '保留 name/locking 字面量的不可变 IConcurrencyPolicy；无效元数据或选项 getter 失败以 INVALID_ARGUMENT 保留精确 cause。'
      ),
      example: storageContractCases.defineConcurrencyPolicy![0]!.example,
      cases: storageContractCases.defineConcurrencyPolicy
    },
    ConcurrencyPolicy: {
      role: 'constant',
      purpose: t(
        'Canonical wait, fail and optimistic factories create authentic identities through the original policy registry.',
        '规范 wait、fail 与 optimistic 工厂经原策略登记创建真实身份。'
      ),
      example: `const policy = ConcurrencyPolicy.wait({ timeoutMs: 2_000 })`
    },
    TransactionActivityMode: {
      role: 'constant',
      purpose: t(
        'Actual managed or native activity mode captured by the real backend owner.',
        '真实后端拥有者捕获的 managed 或 native 活跃模式。'
      )
    },
    TransactionBeforeStage: {
      role: 'constant',
      purpose: t(
        'Canonical transaction before-observation names; observations cannot delay or veto work.',
        '规范事务工作前观察名；观察不能延迟或否决工作。'
      )
    },
    TransactionObservedStage: {
      role: 'constant',
      purpose: t(
        'Canonical operation and terminal transaction observation names.',
        '规范操作与事务终态观察名。'
      )
    },
    createTransactionOwner: {
      role: 'operation',
      purpose: t(
        'Initialize one neutral owner for an original resource base. Backends retain registration and lifecycle authority; no database is opened.',
        '为原资源基础对象初始化唯一中立拥有者。后端保留登记与生命周期权限，不打开数据库。'
      ),
      params: {
        store: t(
          'Original IStorageBase, including specialized non-KV backends.',
          '原 IStorageBase，支持非 KV 专用后端。'
        ),
        normalizeFailure: t(
          'Backend-owned idempotent normalization retaining source, code, stack and cause.',
          '后端拥有的幂等归一，保留 source、code、stack 与 cause。'
        ),
        options: t(
          'Optional actual activityMode, outer fixed asyncDisposeKey, authentic defaultPolicy and canonical concurrencyStages; the same original owner captures them once.',
          '可选真实 activityMode、外层固定 asyncDisposeKey、真实 defaultPolicy 与规范 concurrencyStages；同一原 owner 只捕获一次。'
        )
      },
      returns: t(
        'Backend-held register and registerIterator ports. Register accepts an optional captured context without a second budget and returns stopAdmission, runFinalizers, closeIterators and terminal close.',
        '后端私持的 register 与 registerIterator；register 可接收已捕获 context，不创建第二预算，并返回 stopAdmission、runFinalizers、closeIterators 与终态 close。'
      ),
      example: `const owner = createTransactionOwner(store, normalizeFailure)
const control = owner.register(scope, { createScope, onFailure })`
    },
    assertTransactionOwner: {
      role: 'operation',
      purpose: t(
        'Check authentic live view identity for the exact original store.',
        '检查精确原 store 的真实有效视图身份。'
      ),
      params: {
        store: t('Original registered resource base.', '已登记原资源基础对象。'),
        scope: t('Actual current transaction or derived view.', '当前真实事务或派生视图。')
      },
      returns: t(
        'The same immutable ITransactionInfo for every live view; invalid identity throws INVALID_ARGUMENT.',
        '每个有效视图共用的不可变 ITransactionInfo；无效身份抛 INVALID_ARGUMENT。'
      ),
      example: `const info = assertTransactionOwner(store, scope)`
    },
    readTransactionOperationContext: {
      role: 'operation',
      purpose: t(
        'Read the original backend attempt context through the same authentic live view registration.',
        '通过同一真实有效视图登记读取原后端 attempt 上下文。'
      ),
      params: {
        scope: t(
          'Actual live user, operation or finalizer view.',
          '真实有效的用户、操作或最终检查视图。'
        )
      },
      returns: t(
        'The same frozen IOperationContext snapshot and original signal, or undefined when omitted at registration. Forged or expired views throw INVALID_ARGUMENT. No new budget or lifecycle authority is created.',
        '同一冻结 IOperationContext 快照与原 signal；登记省略上下文时返回 undefined。伪造或过期视图抛 INVALID_ARGUMENT，不创建新预算或生命周期权限。'
      ),
      example: `const context = readTransactionOperationContext(operationScope)
await codec.encode(value, context)`
    },
    deriveTransactionIterator: {
      role: 'operation',
      purpose: t(
        'Project an actual registered iterator through its original owner, including the current next operation view and reverse cleanup of an optional additional cursor.',
        '沿原 owner 派生真实已登记迭代器，提供当前 next 操作视图，并逆序清理可选附属游标。'
      ),
      params: {
        iterator: t(
          'Actual source iterator registered by the original owner.',
          '原 owner 已登记的真实源迭代器。'
        ),
        read: t(
          'Receives next, fail and the actual currentScope. The scope expires with this complete advance; existing two-argument callbacks remain valid.',
          '接收 next、fail 与真实 currentScope；视图在本次完整推进结束时失效，旧两参数回调保持有效。'
        ),
        close: t(
          'Optional cleanup for an actual lazily created additional source. Runs before original source cleanup; both are attempted and original first-failure aggregation applies.',
          '可选实际惰性附属源清理，先于原 source 清理运行；两者都尝试，并沿原首错聚合。'
        )
      },
      returns: t(
        'A resource iterator owned by the same registration, or undefined for an unregistered source without invoking callbacks. No free scope construction, registration or store-close authority.',
        '同一登记拥有的资源迭代器；未登记源返回 undefined 且不调用回调，不授予自由构造视图、登记或关闭 store 的权限。'
      ),
      example: `const projected = deriveTransactionIterator(cursor, async (next, _fail, currentScope) => {
  const context = readTransactionOperationContext(currentScope)
  const row = await next()
  if (row.done) return row
  return { done: false, value: await decode(row.value, context) }
})`
    },
    runTransactionOperation: {
      role: 'operation',
      purpose: t(
        'Synchronously admit and invoke one composed operation on a fresh complete view; drain its actual settlement.',
        '在新完整视图上同步接纳并调用组合操作，等待真实结算。'
      ),
      params: {
        scope: t(
          'Authentic live view; expired real views reject the backend expiry error.',
          '真实有效视图；真实过期视图拒绝后端失效错误。'
        ),
        run: t(
          'Callback receiving this operation’s independent complete view.',
          '接收本操作独立完整视图的回调。'
        )
      },
      returns: t(
        'Promise<Awaited<TResult>> with backend-normalized failure locked even when caught or unawaited.',
        'Promise<Awaited<TResult>>；即使 catch 或未 await，后端归一失败仍锁定。'
      ),
      example: storageContractCases.runTransactionOperation![0]!.example,
      cases: storageContractCases.runTransactionOperation
    },
    registerTransactionFinalizer: {
      role: 'operation',
      purpose: t(
        'Register an ordered once-only check before finalization freezes the accepted list.',
        '在最终检查冻结接纳列表前登记按序、只运行一次的检查。'
      ),
      params: {
        scope: t('A real active view of the owning transaction.', '所属事务的真实有效视图。'),
        check: t(
          'Receives a fresh complete check view and drains its own child operations before the next check.',
          '接收新完整检查视图，在下一检查前排空自己的子操作。'
        )
      },
      returns: t(
        'void; late registration throws INVALID_ARGUMENT.',
        'void；过晚登记抛 INVALID_ARGUMENT。'
      ),
      example: `registerTransactionFinalizer(scope, checkScope => checkScope.getRecord('profile').then(() => undefined))`
    },
    nextTransactionIterator: {
      role: 'operation',
      purpose: t(
        'Borrow the current authentic view to advance an actual iterator from the same transaction without reviving its creation view.',
        '借当前真实视图推进同事务真实迭代器，不复活创建视图。'
      ),
      params: {
        scope: t('Current live operation or check view.', '当前有效操作或检查视图。'),
        iterator: t(
          'Actual iterator registered by this transaction’s backend owner.',
          '本事务后端拥有者登记的真实迭代器。'
        )
      },
      returns: t(
        'One Promise<IteratorResult<T>>; forged or cross-transaction identity throws before port.next.',
        '一次 Promise<IteratorResult<T>>；伪造或跨事务身份在 port.next 前抛错。'
      ),
      example: `const result = await nextTransactionIterator(scope, iterator)`
    },
    ConcurrencyHolderState: {
      role: 'constant',
      purpose: t('Canonical held and remote handoff state names.', '规范的持有与远端交接状态名。')
    },
    defineStorageCapability: {
      role: 'operation',
      purpose: t(
        'Define a frozen identity token for an API contract without supplying an implementation or global name registry.',
        '定义 API 契约的冻结身份令牌，不提供实现，也不建立全局名称注册表。'
      ),
      params: {
        name: t(
          'Nonempty diagnostic name, chosen after the API type.',
          'API 类型之后指定的非空诊断名称。'
        )
      },
      returns: t(
        'A distinct authentic token; equal names never grant shared runtime authority.',
        '返回独立真实令牌；同名不会授予共享运行权限。'
      ),
      example: `const catalog = defineStorageCapability<{ read(): string }>()('catalog')`
    },
    implement: {
      role: 'operation',
      purpose: t(
        'Capture one authentic token/API pairing as a frozen descriptor; an optional standard forTransaction binder remains private and unexecuted.',
        '将真实令牌与 API 配对为冻结记录；可选的标准 forTransaction 绑定器私有保存，不在装配时执行。'
      ),
      params: {
        capability: t(
          'Authentic token from defineStorageCapability.',
          'defineStorageCapability 创建的真实令牌。'
        ),
        api: t(
          'Backend-owned API satisfying the token contract; its exact type is retained.',
          '满足令牌契约的后端 API，保留具体类型。'
        )
      },
      returns: t(
        'An authentic immutable descriptor; forged tokens throw INVALID_ARGUMENT.',
        '返回真实不可变记录；伪造令牌抛 INVALID_ARGUMENT。'
      ),
      example: `const implementation = implement(catalog, { read: () => 'value' })`
    },
    provideCapabilities: {
      role: 'operation',
      purpose: t(
        'Admit a complete implementation batch and modify the same resource-backed base, preserving its public class and hidden members.',
        '准入整批实现并改装同一资源基础对象，保留类公开方法与非枚举成员。'
      ),
      params: {
        base: t(
          'Unprovided resource base with valid backend, support facts and both cleanup entries.',
          '尚未装配能力且具有有效后端名、能力事实与两个清理入口的资源基础对象。'
        ),
        implementations: t(
          'Authentic implementation records with no duplicate tokens.',
          '没有重复令牌的真实实现记录。'
        ),
        options: t(
          'Optional onInstaller receives this store’s unique prepare/publish/release port.',
          '可选 onInstaller 接收本 store 唯一的 prepare/publish/release 安装口。'
        )
      },
      returns: t(
        'The exact original base refined with use/has and precise implementation types. Failure does not dispose the base.',
        '返回原基础对象并增强 use/has 与精确实现类型；失败不释放基础对象。'
      ),
      example: `function attachCatalog(base: IStorageBase) {
  return provideCapabilities(base, [implement(catalog, { read: () => 'value' })])
}`
    },
    kv: {
      role: 'operation',
      purpose: t(
        'Standard text key-value contract token; the backend still owns every operation and its lifecycle.',
        '标准文本键值契约令牌；每个操作及生命周期仍由后端拥有。'
      ),
      example: `const api = store.use(kv)
console.log(api === store.use(kv)) // true`
    },
    isBackendKind: {
      role: 'operation',
      purpose: t(
        'Validate an open backend name without admitting a store or granting capability authority.',
        '校验开放后端名称，不准入 store，也不授予能力权限。'
      ),
      params: { value: t('Unknown backend label.', '未知后端标签。') },
      returns: t(
        'True for lowercase letter followed by lowercase letters, digits or hyphens, at most 64 characters.',
        '小写字母开头，后接小写字母、数字或连字符，总长不超过 64 时为真。'
      ),
      example: `console.log(isBackendKind('example-catalog'), isBackendKind('Invalid Name')) // true false`
    },
    BACKEND_KIND_PATTERN: {
      role: 'operation',
      purpose: t(
        'Canonical backend label pattern used by all contract admission checks.',
        '全部契约准入检查共用的规范后端名模式。'
      ),
      example: `console.log(BACKEND_KIND_PATTERN.test('example-catalog')) // true`
    },
    assertVersionedEnvelope: {
      role: 'operation',
      purpose: t(
        'Validate a plain archive with own safe version and non-null state fields, reading each once without copying state.',
        '校验普通存档的自有安全版本与非空状态，每字段读取一次，不复制状态。'
      ),
      params: {
        value: t('Known envelope or unknown archive input.', '已知 envelope 或未知存档输入。')
      },
      returns: t(
        'A fresh envelope retaining state identity and known state type; invalid input throws ENVELOPE_INVALID.',
        '返回新 envelope，保留状态引用与已知类型；无效输入抛 ENVELOPE_INVALID。'
      ),
      example: `const state = { name: 'Ada' }
const archive = assertVersionedEnvelope({ version: 1, state })
console.log(archive.state === state) // true`
    },
    createMigrationPlan: {
      role: 'operation',
      purpose: t(
        'Snapshot and freeze canonical continuous version steps, or a constant-space reset callback.',
        '快照并冻结规范连续版本步骤，或常数空间的重置回调。'
      ),
      params: {
        options: t(
          'Current nonnegative safe version plus optional steps, or an exclusive reset callback.',
          '当前非负安全版本，加可选 steps 或互斥的 reset 回调。'
        )
      },
      returns: t(
        'An immutable plan; gaps throw MIGRATION_GAP and malformed options throw INVALID_ARGUMENT.',
        '返回不可变计划；断档抛 MIGRATION_GAP，配置形态错误抛 INVALID_ARGUMENT。'
      ),
      example: `const plan = createMigrationPlan({ version: 2, steps: { 2: value => ({ previous: value }) } })
console.log(plan.baseVersion, Object.isFrozen(plan.steps)) // 1 true`
    },
    migrateEnvelopeSync: {
      role: 'operation',
      purpose: t(
        'Run synchronous steps in target-version order. Refuse newer archives and preserve original errors as cause.',
        '按目标版本顺序执行同步步骤；拒绝未来存档，将原始错误保留在 cause。'
      ),
      params: {
        plan: t(
          'Immutable plan from createMigrationPlan.',
          'createMigrationPlan 创建的不可变计划。'
        ),
        envelope: t('Validated version/state archive.', '已校验的版本/状态存档。'),
        options: t(
          'Optional observation-only beforeStep, afterStep and synchronous report callbacks.',
          '可选的只观察 beforeStep、afterStep 与同步 report 回调。'
        )
      },
      returns: t(
        'Current state reference or migration result. Thenables fail with MIGRATION_FAILED; observer promises are not awaited.',
        '返回当前状态引用或迁移结果；thenable 导致 MIGRATION_FAILED，观察 Promise 不等待。'
      ),
      example: `const plan = createMigrationPlan({ version: 1, steps: { 1: value => ({ previous: value }) } })
console.log(migrateEnvelopeSync(plan, { version: 0, state: 'old' })) // { previous: 'old' }`
    },
    migrateEnvelope: {
      role: 'operation',
      purpose: t(
        'Run asynchronous migrations with shared cancellation and late-rejection reporting, including cancellation before unchanged-version returns.',
        '借用共享取消与迟到拒绝报告执行异步迁移，同版返回前仍检查取消。'
      ),
      params: {
        plan: t('Immutable migration plan.', '不可变迁移计划。'),
        envelope: t(
          'Validated archive; user state mutations are not rolled back.',
          '已校验存档；用户对状态的修改不会回滚。'
        ),
        options: t(
          'Optional signal, utils reporter and observation-only step callbacks.',
          '可选 signal、utils reporter 和只观察的步骤回调。'
        )
      },
      returns: t(
        'Promise for current or migrated state; cancellation rejects ABORTED with the signal reason as cause.',
        '返回当前或升级后状态的 Promise；取消以 ABORTED 拒绝，cause 为信号原因。'
      ),
      example: `const plan = createMigrationPlan({ version: 1, steps: { 1: async value => ({ previous: value }) } })
console.log(await migrateEnvelope(plan, { version: 0, state: 'old' })) // { previous: 'old' }`
    },
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
        'The exact store as `IRecordStore<T>`; insufficient shape or capabilities throws `UNSUPPORTED_CAPABILITY`. An original reflection or accessor failure remains reachable through `cause`.',
        '同一个存储，收窄为 `IRecordStore<T>`；形状或能力不足时抛 `UNSUPPORTED_CAPABILITY`，原始反射或访问器失败沿 `cause` 可达。'
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
        'The original store as `ISecondaryIndexRecordStore<T>`; missing capability or methods throws `UNSUPPORTED_CAPABILITY`. Original reflection or accessor failures remain reachable through `cause`.',
        '原存储收窄为 `ISecondaryIndexRecordStore<T>`；缺少能力或方法时抛 `UNSUPPORTED_CAPABILITY`，原始反射或访问器失败沿 `cause` 可达。'
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
        'The exact store as `IChangeFeedStore`; incomplete feed capability throws `UNSUPPORTED_CAPABILITY`. Original reflection or accessor failures remain reachable through `cause`.',
        '同一个存储收窄为 `IChangeFeedStore`；变更流能力不完整时抛 `UNSUPPORTED_CAPABILITY`，原始反射或访问器失败沿 `cause` 可达。'
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
    snapshotStorageBaseDetailed: {
      role: 'operation',
      purpose: t(
        'Admit the common resource, backend and capability facts without requiring key-value operations, mutating the base or taking cleanup ownership.',
        '准入共用资源、后端与能力事实，不强制键值操作，不修改基础对象，不取得清理所有权。'
      ),
      params: {
        store: t(
          'Unknown specialized or key-value base; each admitted field is captured once.',
          '未知专用或键值基础对象；准入字段各捕获一次。'
        ),
        options: t(
          'Optional fixed canonical asyncDisposeKey from the outer host; otherwise use native Symbol.asyncDispose, never a synthesized fallback.',
          '外层宿主可选的固定规范 asyncDisposeKey；否则使用原生 Symbol.asyncDispose，不创建后备键。'
        )
      },
      returns: t(
        'IStorageBaseAdmission retains store, backend, capabilities, dispose, receiver and optional asyncDispose on success; failure retains the exact cause without invoking cleanup.',
        '成功的 IStorageBaseAdmission 保留 store、backend、capabilities、dispose、receiver 与可选 asyncDispose；失败保留精确 cause，不调用清理。'
      ),
      example: storageContractCases.snapshotStorageBaseDetailed![0]!.example,
      cases: storageContractCases.snapshotStorageBaseDetailed
    },
    snapshotKeyValueStoreDetailed: {
      role: 'operation',
      purpose: t(
        'Performs one L0 admission while retaining the exact reflection or accessor failure for its owning boundary. A valid result also captures the raw disposer and its original receiver so later cleanup need not reread mutable accessors.',
        '执行单次基础存储接纳，并为所属边界保留精确反射或访问器失败。有效结果还捕获原释放函数及接收者，后续清理无需重读可变访问器。'
      ),
      params: {
        store: t(
          'Unknown application-injected store candidate whose public fields are inspected once.',
          '应用注入的未知存储候选值，其公开字段被检查一次。'
        )
      },
      returns: t(
        'An `IKeyValueStoreAdmission`; invalid plain shapes carry undefined cause, while observed reflection or getter failures retain their exact thrown value.',
        '一个 `IKeyValueStoreAdmission`；普通形状无效时原因为空值，反射或访问器失败则保留精确抛出值。'
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
          'Required unknown descriptor from a backend. `syncRead`, `binary`, `records`, `transactions`, `iteration` and `opaqueEntries` must each be boolean. `secondaryIndexes` and `changeFeed` accept booleans or omission, defaulting only omitted values to `false`. `maxValueBytes` is a nonnegative safe integer including 0, or `undefined` for no declared limit. No other field receives a default.',
          '必填的后端未知能力描述。`syncRead`、`binary`、`records`、`transactions`、`iteration`、`opaqueEntries` 均须为布尔值；`secondaryIndexes`、`changeFeed` 接纳布尔值，缺失时才补为 `false`。`maxValueBytes` 为含 0 的非负安全整数，或以 `undefined` 表示没有声明上限。其余字段不补默认值。'
        )
      },
      returns: t(
        'A fresh `IStorageCapabilities` plain snapshot, or undefined; maxValueBytes must be a nonnegative safe integer or undefined.',
        '新的普通 `IStorageCapabilities` 快照或空值；单值字节上限须为非负安全整数或空值。'
      ),
      exampleIntro: storageContractCases.snapshotStorageCapabilities![0]!.problem,
      example: storageContractCases.snapshotStorageCapabilities![0]!.example,
      exampleResult: storageContractCases.snapshotStorageCapabilities![0]!.result,
      cases: storageContractCases.snapshotStorageCapabilities
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
      params: { ...keyValidationParams, backend: optionalKeyBackend },
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
      params: { ...keyValidationParams, backend: optionalKeyBackend },
      returns: t(
        'An independent valid `IStorageKey`, recursively copied but not frozen. Invalid input or failed copying throws `INVALID_KEY` while retaining its cause.',
        '独立有效的 `IStorageKey`，递归复制但不冻结。输入无效或复制失败抛 `INVALID_KEY` 并保留原因。'
      ),
      exampleIntro: storageContractCases.snapshotStorageKey![0]!.problem,
      example: storageContractCases.snapshotStorageKey![0]!.example,
      exampleResult: storageContractCases.snapshotStorageKey![0]!.result,
      cases: storageContractCases.snapshotStorageKey
    },
    assertStringStorageKey: {
      role: 'operation',
      purpose: t(
        'Validates the string-only key contract used by value, byte and metadata channels. It does not accept numeric or structured keys and never converts them to strings.',
        '校验值、字节和元数据通道要求的纯字符串键契约。不接受数字或结构化键，也不会把它们转换为字符串。'
      ),
      params: { ...keyValidationParams, backend: optionalKeyBackend },
      returns: t(
        'No result; narrows value to string, or throws `INVALID_ARGUMENT` with a typed cause.',
        '没有结果；把值收窄为字符串，否则抛带类型原因的 `INVALID_ARGUMENT`。'
      ),
      example: `assertStringStorageKey('theme', 'local')`
    },
    encodeOrderedStorageKey: {
      role: 'operation',
      purpose: t(
        'Validate and copy a key, then encode independently owned bytes whose lexicographic order equals compareStorageKeys.',
        '校验并复制键，再编码成独立字节；字典序与 compareStorageKeys 相同。'
      ),
      params: keyValidationParams,
      returns: t(
        'Uint8Array in linear key size; invalid input reuses INVALID_KEY. Signed zero normalizes to the same encoding.',
        '线性键大小的 Uint8Array；无效输入复用 INVALID_KEY。正负零规范化为同一编码。'
      ),
      example: storageContractCases.encodeOrderedStorageKey![0]!.example,
      cases: storageContractCases.encodeOrderedStorageKey
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
        'Reads cancellation, timeout, paging, optional conflict policy and orgId once, validates them and freezes a field snapshot. Snapshots created by this helper are recognized and returned by identity on later calls.',
        '单次读取取消、超时、分页、可选冲突策略与 orgId，完成校验后冻结字段快照。此函数创建的快照会被识别，后续调用原样返回同一身份。'
      ),
      optionDocs: {
        ...operationMembers,
        conflictPolicy: {
          ...conflictMember,
          default: t(
            'Omitted: retain `undefined`; no conflict default is inserted by validation.',
            '省略时保留 `undefined`，校验不会补入冲突默认值。'
          )
        }
      },
      params: {
        ctx: t(
          'Required `IOperationContext` or `undefined`. All fields are optional and remain `undefined` when omitted: `signal` must be an object with boolean `aborted` and callable `addEventListener`/`removeEventListener`; `timeoutMs` a nonnegative safe integer including 0; `pageSize` an integer from 1 to 4096; `conflictPolicy` either `conflict` or `replace`; `orgId` a canonical lowercase UUID. An already-aborted signal is accepted unchanged. No timer, I/O or signal subscription starts.',
          '必填的 `IOperationContext` 或 `undefined`。所有字段可选，缺失时保持 `undefined`：`signal` 须含布尔 `aborted` 和可调用 `addEventListener`、`removeEventListener`；`timeoutMs` 为含 0 的非负安全整数；`pageSize` 为 1 至 4096 的整数；`conflictPolicy` 为 `conflict` 或 `replace`；`orgId` 为规范小写 UUID。已取消的信号也原样接纳，不启动定时器、I/O 或信号订阅。'
        )
      },
      returns: t(
        'An `IOperationContextSnapshot`, or undefined for omitted context; malformed values throw `INVALID_ARGUMENT` retaining the original accessor cause.',
        '一个 `IOperationContextSnapshot`，省略上下文时为空值；格式错误抛 `INVALID_ARGUMENT` 并保留原访问器原因。'
      ),
      exampleIntro: storageContractCases.snapshotOperationContext![0]!.problem,
      example: storageContractCases.snapshotOperationContext![0]!.example,
      exampleResult: storageContractCases.snapshotOperationContext![0]!.result,
      cases: storageContractCases.snapshotOperationContext
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
      example: `const run = async (tx: ITransactionScope) => tx.getRecord('profile')
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
      example: `const codec = snapshotCodec(fromValueCodec(defineCollectionsJsonCodec({ version: 1 })))
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
    fromValueCodec: {
      role: 'operation',
      purpose: t(
        'Snapshot a serialize codec and adapt its independently typed callbacks to asynchronous storage conversion. The adapter owns no value format or resource.',
        '快照 serialize codec，将独立类型的两条回调适配为异步存储转换；适配器不拥有值格式或资源。'
      ),
      params: {
        codec: t(
          'Concrete value codec with id, positive safe version, encodedType, encode and decode.',
          '包含 id、正安全版本、encodedType、encode 与 decode 的具体值 codec。'
        )
      },
      returns: t(
        'Frozen exact-name/route adapter. Callback failures become INVALID_ARGUMENT with original cause; encode and decode preserve their separate inputs and Awaited results.',
        '返回保留精确名称与路由的冻结适配器；回调失败以保留原 cause 的 INVALID_ARGUMENT 报告，两条回调保留各自输入与 Awaited 结果。'
      ),
      exampleIntro: storageContractCases.fromValueCodec![0]!.problem,
      example: storageContractCases.fromValueCodec![0]!.example,
      exampleResult: storageContractCases.fromValueCodec![0]!.result,
      cases: storageContractCases.fromValueCodec
    },
    StorageStageKind: {
      role: 'constant',
      purpose: t(
        'Canonical discriminants distinguish seven neutral observer families without granting store or transaction authority.',
        '七种中立观察接点的唯一判别常量，不授予 store 或事务权限。'
      ),
      example: `console.log(StorageStageKind.codec) // codec`
    },
    ConflictPolicy: {
      role: 'constant',
      purpose: t(
        'Frozen public existing-key policy values consumed by write and transaction contexts. Conflict rejects an existing key; replace deliberately allows overwriting under the backend’s commit semantics.',
        '写入与事务上下文使用的冻结公开已有键策略。冲突策略拒绝已有键，替换策略按后端提交语义明确允许覆盖。'
      ),
      example: `await store.set('theme', 'dark', { conflictPolicy: ConflictPolicy.replace })`
    },
    StorageContractError: {
      role: 'error',
      options: 'IStorageContractErrorDetails',
      purpose: t(
        'Constructs and freezes a native Error carrying storage-contract source, semantic code and optional backend/key context. The native stack and exact original cause remain reachable after construction.',
        '构造并冻结带存储契约来源、语义码和可选后端及键上下文的原生错误。构造后原生调用栈和精确原始原因仍保持可达。'
      ),
      params: {
        code: t(
          'Required semantic value from `StorageContractErrorCode`: input, key, capability, resource, cancellation, envelope and migration failures. The producer chooses the code matching the failed contract.',
          '必填的 `StorageContractErrorCode` 语义值：输入、键、能力、资源、取消、envelope 与迁移错误。生产者按失败契约选择。'
        ),
        details: t(
          'Optional producer-authored details, default `{}`. Optional `backend` is `local`, `session`, `cookie`, `indexeddb` or `memory`; optional `key` is a string or `IStorageKey`; optional `cause` is any original thrown value. All fields default to `undefined`; key and cause are retained by reference without validation or copying.',
          '生产者提供的可选详情，默认 `{}`。可选 `backend` 为 `local`、`session`、`cookie`、`indexeddb` 或 `memory`；可选 `key` 为字符串或 `IStorageKey`；可选 `cause` 为任意原始抛出值。各字段默认 `undefined`，键和原因按引用保留，不校验或复制。'
        ),
        message: t(
          'Optional producer-selected diagnostic message; default is exactly `[storage-contract] ${code}` using the supplied semantic code.',
          '生产者选择的可选诊断消息；默认精确为使用传入语义码的 `[storage-contract] ${code}`。'
        )
      },
      returns: t(
        'A frozen `StorageContractError`; backend and key are direct fields, while cause uses the native Error chain.',
        '冻结的 `StorageContractError`；后端和键是直接字段，原因使用原生错误链。'
      ),
      exampleIntro: storageContractCases.StorageContractError![0]!.problem,
      example: storageContractCases.StorageContractError![0]!.example,
      exampleResult: storageContractCases.StorageContractError![0]!.result,
      cases: storageContractCases.StorageContractError
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
    IRdfNamedNode: {
      summary: t(
        'An exact absolute RDF IRI, without URL normalization.',
        '精确绝对 RDF IRI，不做 URL 规范化。'
      ),
      members: {
        termType: { summary: t('NamedNode discriminator.', 'NamedNode 标记。') },
        value: { summary: t('Original absolute IRI spelling.', '原绝对 IRI 拼写。') }
      }
    },
    IRdfBlankNode: {
      summary: t(
        'A raw/parser-local blank term; labels are not portable repeated-identity keys.',
        'raw/parser 局部 blank 项；label 不是便携重复身份键。'
      ),
      members: {
        termType: { summary: t('BlankNode discriminator.', 'BlankNode 标记。') },
        value: {
          summary: t('Nonempty response/runtime-local label.', '非空的响应或运行时局部 label。')
        }
      }
    },
    IRdfLiteral: {
      summary: t(
        'An immutable lexical literal with mandatory datatype and consistent optional language.',
        '包含必需 datatype 与一致可选 language 的不可变词法 literal。'
      ),
      members: {
        termType: { summary: t('Literal discriminator.', 'Literal 标记。') },
        value: {
          summary: t(
            'Exact Unicode scalar string, including escaped control values.',
            '精确 Unicode 标量字符串，含可转义控制值。'
          )
        },
        datatype: {
          summary: t(
            'Absolute datatype IRI; plain strings use xsd:string and language tags require rdf:langString.',
            '绝对 datatype IRI；普通字符串用 xsd:string，language 标签要求 rdf:langString。'
          )
        },
        language: {
          summary: t(
            'Lowercase well-formed BCP47 tag, present exactly for rdf:langString.',
            '小写且格式正确的 BCP47 标签，恰在 rdf:langString 时存在。'
          )
        }
      }
    },
    IRdfDefaultGraph: {
      summary: t(
        'The default graph has no fabricated IRI or binding value.',
        '默认图不含伪造 IRI 或绑定值。'
      ),
      members: { termType: { summary: t('DefaultGraph discriminator.', 'DefaultGraph 标记。') } }
    },
    IRdfBindingTerm: {
      summary: t(
        'Raw binding union of NamedNode, BlankNode and Literal; DefaultGraph is excluded.',
        'NamedNode、BlankNode 与 Literal 的 raw 绑定联合；不含 DefaultGraph。'
      ),
      members: {}
    },
    IRdfTerm: {
      summary: t(
        'Full raw RDF term union including the default graph.',
        '含默认图的完整 raw RDF 项联合。'
      ),
      members: {}
    },
    IQuad: {
      summary: t(
        'Portable ground quad identity; standard repeated writes reject blank positions.',
        '便携 ground quad 身份；标准重复写入拒绝 blank 位置。'
      ),
      members: {
        subject: { summary: t('NamedNode subject.', 'NamedNode 主项。') },
        predicate: { summary: t('NamedNode relation IRI.', 'NamedNode 关系 IRI。') },
        object: {
          summary: t('NamedNode or normalized Literal value.', 'NamedNode 或规范 Literal 值。')
        },
        graph: {
          summary: t(
            'NamedNode or DefaultGraph, required even for the default graph.',
            'NamedNode 或 DefaultGraph；默认图也须明确提供。'
          )
        }
      }
    },
    IRawQuad: {
      summary: t(
        'Complete RDF 1.1 raw/parser quad, retaining request-local blank positions.',
        '完整 RDF 1.1 raw/parser quad，保留请求局部 blank 位置。'
      ),
      members: {
        subject: { summary: t('NamedNode or BlankNode.', 'NamedNode 或 BlankNode。') },
        predicate: { summary: t('NamedNode relation IRI.', 'NamedNode 关系 IRI。') },
        object: { summary: t('Any raw binding term.', '任意 raw 绑定项。') },
        graph: {
          summary: t(
            'NamedNode, BlankNode or DefaultGraph.',
            'NamedNode、BlankNode 或 DefaultGraph。'
          )
        }
      }
    },
    IStorageBatchKeyCapture: {
      summary: t(
        'Pure per-batch function from one logical key to IStorageBatchKey; it owns only a temporary equality map and input position, without resource authority.',
        '从一个逻辑键得到 IStorageBatchKey 的每批纯函数；仅持暂态相等 Map 与输入位置，不具资源权限。'
      ),
      members: {}
    },
    ITtlTarget: {
      summary: t(
        'The existing expiring physical lock-key channels, with the same logical key domain.',
        '既有可过期物理锁键通道，沿用相同逻辑键域。'
      ),
      members: {
        channel: {
          summary: t(
            'The physical text, bytes or record channel.',
            '物理 text、bytes 或 record 通道。'
          )
        },
        key: { summary: t('The channel’s original logical key.', '该通道原有逻辑键。') }
      }
    },
    ITtlApi: {
      summary: t(
        'Native point TTL operations on one physical channel; deadlines use the backend’s original clock, including database clocks and the documented Qdrant client-clock exception.',
        '单物理通道上的原生点 TTL；期限使用后端原时钟，数据库后端沿数据库时钟，Qdrant 沿已声明的客户端时钟例外。'
      ),
      members: {
        expire: {
          summary: t(
            'Assign a deadline; zero expires immediately. Missing or expired targets return false.',
            '设置期限；零立即到期。缺失或已过期目标返回 false。'
          ),
          params: {
            target: t('Original typed physical target.', '原 typed 物理目标。'),
            ms: t('Finite nonnegative milliseconds.', '有限非负毫秒数。'),
            ctx: writeContextParam
          },
          returns: t('Whether a live target received the deadline.', '是否为活目标设置了期限。'),
          example: `await store.use(ttl).expire({ channel: 'text', key: 'session' }, 1000)`
        },
        remaining: {
          summary: t(
            'Read nonnegative remaining milliseconds; missing or unlimited targets return undefined.',
            '读取非负剩余毫秒数；缺失或无限期目标返回 undefined。'
          ),
          params: {
            target: t('Original typed physical target.', '原 typed 物理目标。'),
            ctx: contextParam
          },
          returns: t('Remaining milliseconds or undefined.', '剩余毫秒数或 undefined。'),
          example: `await store.use(ttl).remaining({ channel: 'text', key: 'session' })`
        },
        persist: {
          summary: t(
            'Remove an active deadline. Missing, expired or already unlimited targets return false.',
            '移除活期限；缺失、已过期或已无限期目标返回 false。'
          ),
          params: {
            target: t('Original typed physical target.', '原 typed 物理目标。'),
            ctx: writeContextParam
          },
          returns: t('Whether an active deadline was removed.', '是否移除了活期限。'),
          example: `await store.use(ttl).persist({ channel: 'text', key: 'session' })`
        }
      }
    },
    ITransactionTtlApi: {
      summary: t(
        'The same TTL operations on the original native draft, without root context or another budget.',
        '原生 draft 上的相同 TTL 操作，不接根上下文，不另建预算。'
      ),
      members: {
        expire: {
          summary: t(
            'Set the current draft target deadline atomically with the transaction.',
            '随事务原子设置当前 draft 目标期限。'
          ),
          params: {
            target: t('Original typed target.', '原 typed 目标。'),
            ms: t('Finite nonnegative milliseconds.', '有限非负毫秒数。')
          },
          returns: t(
            'Whether a live draft target received the deadline.',
            '是否为活 draft 目标设置期限。'
          ),
          example: `await tx.use(ttl).expire({ channel: 'record', key: 'profile' }, 1000)`
        },
        remaining: {
          summary: t(
            'Read the draft’s captured deadline and value snapshot.',
            '读取 draft 捕获的期限和值快照。'
          ),
          params: { target: t('Original typed target.', '原 typed 目标。') },
          returns: t('Remaining milliseconds or undefined.', '剩余毫秒数或 undefined。'),
          example: `await tx.use(ttl).remaining({ channel: 'record', key: 'profile' })`
        },
        persist: {
          summary: t(
            'Remove the current draft deadline in this same transaction.',
            '在同一事务中移除当前 draft 期限。'
          ),
          params: { target: t('Original typed target.', '原 typed 目标。') },
          returns: t('Whether an active deadline was removed.', '是否移除了活期限。'),
          example: `await tx.use(ttl).persist({ channel: 'record', key: 'profile' })`
        }
      }
    },
    ICounterApi: {
      summary: t(
        'An atomic text-channel counter using canonical decimal safe integers.',
        '使用规范十进制安全整数的原子文本通道计数器。'
      ),
      members: {
        increment: {
          summary: t(
            'Missing values start at zero; invalid decimal text, unsafe delta or overflow rejects without a write.',
            '缺失值从零起算；非法十进制文本、不安全增量或溢出均拒绝且不写入。'
          ),
          params: {
            key: stringKeyParam,
            by: t('Safe integer delta; omitted means one.', '安全整数增量；省略为一。'),
            ctx: writeContextParam
          },
          returns: t('The committed safe integer value.', '已提交的安全整数值。'),
          example: `await store.use(counter).increment('visits', 2)`
        }
      }
    },
    ITransactionCounterApi: {
      summary: t(
        'Atomic counter updates in the same original transaction text draft.',
        '同一原事务文本 draft 中的原子计数更新。'
      ),
      members: {
        increment: {
          summary: t(
            'Increment without opening a root operation or budget.',
            '递增时不打开根操作或预算。'
          ),
          params: {
            key: stringKeyParam,
            by: t('Safe integer delta; omitted means one.', '安全整数增量；省略为一。')
          },
          returns: t('The draft safe integer value.', 'draft 安全整数值。'),
          example: `await tx.use(counter).increment('visits')`
        }
      }
    },
    IStorageCounterIncrement: {
      summary: t(
        'Pure captured calculation from current native text (null/undefined means zero) to the next safe integer; apply inside the existing atomic owner.',
        '从当前原生文本（null/undefined 代表零）到下一安全整数的纯捕获计算；须在既有原子 owner 内应用。'
      ),
      members: {}
    },
    IStorageBatchKey: {
      summary: t(
        'One captured position in a native typed-key batch.',
        '原生 typed 键批次中一个已捕获位置。'
      ),
      members: {
        key: { summary: t('Detached canonical logical key.', '独立的规范逻辑键。') },
        identity: {
          summary: t('Hex identity of the canonical ordered bytes.', '规范有序字节的十六进制身份。')
        },
        firstIndex: {
          summary: t(
            'First equivalent input position; use only that position for distinct native deletion.',
            '首次出现相同规范键的输入位置；原生去重删除只使用该位置。'
          )
        }
      }
    },
    IRecordsApi: {
      summary: t(
        'Standard record query and prefix deletion boundary; exact native row defaults are preserved by provided implementations.',
        '标准记录查询与前缀删除边界，所提供实现保留精确原生默认行类型。'
      ),
      members: {
        query: {
          summary: t(
            'query<R=TValue>() returns the implemented shared IQueryChain<R> without eager I/O.',
            'query<R=TValue>() 返回已实现的共用 IQueryChain<R>，不提前 I/O。'
          )
        },
        removeByPrefix: {
          summary: t(
            'Original native deletion Promise/count with exact prefix and operation/concurrency context; no wrapper or copied writer.',
            '原生删除 Promise/计数与精确 prefix、操作/并发上下文，不新增包装或复制 writer。'
          )
        }
      }
    },
    IFieldOps: {
      summary: t(
        'Field-specific operators retain their actual operand domains.',
        '按字段保留实际操作数域的操作符类型。'
      ),
      members: {
        eq: {
          summary: t(
            'SameValueZero equality or Date time equality; opaque object operands compare identity.',
            'SameValueZero 或 Date 时间值相等，显式对象操作数比较身份。'
          )
        },
        in: {
          summary: t(
            'One captured membership list compiled to Sets.',
            '捕获一次并编译为 Set 的成员列表。'
          )
        },
        exists: {
          summary: t(
            'Whether the path is present, including a present undefined value.',
            '路径是否存在，包括存在的 undefined 值。'
          )
        },
        between: {
          summary: t(
            'Inclusive endpoints in the same ordered field domain.',
            '同一有序字段域中的闭区间端点。'
          )
        }
      }
    },
    IWhere: {
      summary: t(
        'Typed nested field conditions and recursive and/or/not.',
        'typed 嵌套字段条件与递归 and/or/not。'
      ),
      members: {
        and: { summary: t('All declared conditions must match.', '所有条件必须匹配。') },
        or: { summary: t('At least one declared condition must match.', '至少一个条件必须匹配。') },
        not: { summary: t('Negates one nested condition.', '取反一个嵌套条件。') }
      }
    },
    IQueryCondition: {
      summary: t(
        'The sole canonical field/boolean AST shared by planning and client predicates.',
        '规划与客户端谓词共用的唯一规范字段/布尔 AST。'
      ),
      members: {
        kind: { summary: t('Field, and, or or not.', 'field、and、or 或 not。') },
        path: {
          summary: t(
            'Validated property segments owned by the canonical utils path parser.',
            '由规范 utils 路径解析器接纳的属性片段。'
          )
        },
        operator: {
          summary: t('A canonical QueryOperator for field nodes.', '字段节点的规范 QueryOperator。')
        },
        value: {
          summary: t(
            'Portable codec value, undefined, bigint, Date, opaque object identity, or an operator list. Identity objects are not traversed.',
            'portable codec 值、undefined、bigint、Date、不透明对象身份或操作符列表；不遍历身份对象内容。'
          )
        }
      }
    },
    IQueryPlanStep: {
      summary: t(
        'One immutable pushed/client operation with its optional reason and index.',
        '一个不可变的下推或客户端操作，含可选原因与索引。'
      ),
      members: {
        operation: { summary: t('Canonical operation name.', '规范操作名称。') },
        reason: { summary: t('Client execution reason when present.', '存在时解释客户端原因。') },
        index: { summary: t('Declared native index when applicable.', '适用的已声明原生索引。') }
      }
    },
    IQueryPlan: {
      summary: t(
        'pushed/client facts, conservative fullScan and native source/index, obtained without I/O.',
        '无需 I/O 得到 pushed/client 事实、保守 fullScan 与原生 source/index。'
      ),
      members: {
        pushed: { summary: t('Safe native prefix.', '安全原生前缀。') },
        client: { summary: t('Ordered client remainder with reasons.', '按序客户端余部与原因。') },
        fullScan: { summary: t('Conservative scan cost signal.', '保守扫描成本标记。') },
        source: { summary: t('Captured native source label.', '捕获的原生数据源标签。') }
      }
    },
    IQueryPushdown: {
      summary: t(
        'Captured native operator/operation subsets and source/index identity; support is declared once.',
        '捕获的原生操作符、操作子集与 source/index 身份，支持事实只声明一次。'
      ),
      members: {
        operators: { summary: t('Supported field operators.', '支持的字段操作符。') },
        operations: { summary: t('Supported native operations.', '支持的原生操作。') },
        source: { summary: t('Stable source label.', '稳定数据源标签。') },
        index: { summary: t('Optional native index label.', '可选原生索引标签。') }
      }
    },
    IVectorHit: {
      summary: t(
        'Native score/id/payload hit; withVector conditionally adds its vector.',
        '原生 score/id/payload 命中；withVector 条件加入 vector。'
      ),
      members: {
        id: { summary: t('Original point identifier.', '原点标识。') },
        score: { summary: t('Native score in engine result order.', '引擎结果顺序中的原生分数。') },
        payload: { summary: t('Optional original point payload.', '可选原点 payload。') },
        vector: {
          summary: t('Present in the type only after withVector.', '仅 withVector 后出现在类型中。')
        }
      }
    },
    IVectorQueryBuilderCore: {
      summary: t(
        'Pre-topK condition, threshold and vector-return controls.',
        'topK 前的条件、阈值与向量返回控制。'
      ),
      members: {
        where: {
          summary: t('Append payload conditions without I/O.', '无 I/O 追加 payload 条件。')
        },
        minScore: {
          summary: t('Declare the final finite native threshold.', '声明最终有限原生阈值。')
        },
        withVector: { summary: t('Enable vector-return result typing.', '开启向量返回结果类型。') },
        requirePushdown: {
          summary: t('Require a fully native plan before execution.', '执行前要求全原生计划。')
        },
        topK: {
          summary: t(
            'Declare a positive safe bound and enable reads.',
            '声明正安全上限并开启读取。'
          )
        }
      }
    },
    IVectorQueryBuilder: {
      summary: t(
        'Pre-topK core intersected with original Feature methods.',
        'topK 前核心与原 Feature 方法的交集。'
      ),
      members: {
        topK: {
          summary: t(
            'Transition to a bounded query while retaining Feature methods.',
            '转入有界查询并保留 Feature 方法。'
          )
        }
      }
    },
    IVectorQueryBase: {
      summary: t(
        'Bounded shared reads without record statistics or arbitrary ordering.',
        '有界共享读取，不含记录统计或任意排序。'
      ),
      members: {
        all: {
          summary: t(
            'Read bounded native hits with original cursor cleanup.',
            '读取有界原生命中并清理原游标。'
          )
        },
        where: {
          summary: t(
            'Filter payload through the shared condition dispatcher.',
            '通过共享条件分派过滤 payload。'
          )
        },
        select: {
          summary: t(
            'Project hits once; record statistics remain absent.',
            '一次投影命中，仍无记录统计。'
          )
        },
        topK: {
          summary: t('Refine the final native bound immutably.', '不可变细化最终原生上限。')
        },
        minScore: { summary: t('Refine the native score threshold.', '细化原生分数阈值。') },
        withVector: { summary: t('Enable vector-bearing hit types.', '开启带 vector 的命中类型。') }
      }
    },
    IVectorQuery: {
      summary: t(
        'Bounded vector query with grouping only when explicitly declared.',
        '有界向量查询，仅显式声明时提供分组。'
      ),
      members: {
        groupBy: {
          summary: t(
            'Conditionally group original topK hits by own scalar payload fields.',
            '条件提供按 payload 自有标量字段对原 topK 命中分组。'
          )
        }
      }
    },
    IVectorQueryInput: {
      summary: t(
        'Native pre-ranking conditions, topK, minScore, withVector and captured context.',
        '原生排名前条件、topK、minScore、withVector 与捕获上下文。'
      ),
      members: {
        conditions: {
          summary: t(
            'All translatable pre-ranking payload conditions.',
            '全部可译排名前 payload 条件。'
          )
        },
        topK: {
          summary: t('Final positive safe native ranking bound.', '最终正安全原生排名上限。')
        },
        minScore: {
          summary: t('Optional final native score threshold.', '可选最终原生分数阈值。')
        },
        withVector: {
          summary: t('Whether native hits include vectors.', '原生命中是否包含向量。')
        },
        ctx: { summary: t('Captured original operation context.', '捕获的原操作上下文。') }
      }
    },
    IVectorQuerySource: {
      summary: t(
        'Native ranking callback and captured support/resource facts.',
        '原生排名回调与捕获的支持、资源事实。'
      ),
      members: {
        pushdown: {
          summary: t('Original native operation/operator support.', '原生操作及操作符支持。')
        },
        execute: {
          summary: t('Open the original ranked storage iterator.', '打开原排名 storage iterator。')
        },
        asyncDisposeKey: {
          summary: t('Optional original resource cleanup key.', '可选原资源清理键。')
        },
        exact: { summary: t('Explicit full-scan explanation fact.', '显式 fullScan 解释事实。') },
        groupBy: {
          summary: t(
            'Declare standard topK scalar grouping support.',
            '声明标准 topK 标量分组支持。'
          )
        }
      }
    },
    IRdfQueryCore: {
      summary: t(
        'Ground quad reads, one projection, limit and native traversal.',
        'ground quad 读取、一次投影、limit 与原生遍历。'
      ),
      members: {
        where: { summary: t('Append shared quad binding conditions.', '追加共享 quad 绑定条件。') },
        select: { summary: t('Project quad bindings once.', '一次投影 quad 绑定。') },
        limit: {
          summary: t('Declare a nonnegative safe streaming bound.', '声明非负安全流式上限。')
        },
        follow: {
          summary: t(
            'Append a ground forward predicate/target step.',
            '追加 ground 正向 predicate/target 步骤。'
          )
        },
        inverse: {
          summary: t('Append a ground inverse predicate step.', '追加 ground 反向 predicate 步骤。')
        }
      }
    },
    IRdfQuery: {
      summary: t(
        'Ground RDF core intersected with original Feature methods.',
        'ground RDF 核心与原 Feature 方法的交集。'
      ),
      members: {
        follow: {
          summary: t(
            'Retain the RDF query and original Feature extension.',
            '保留 RDF 查询与原 Feature 扩展。'
          )
        }
      }
    },
    IRdfQueryTraversal: {
      summary: t(
        'Ordered ground forward/inverse predicate and optional target.',
        '有序 ground 正向或反向 predicate 与可选目标。'
      ),
      members: {
        operation: {
          summary: t('Canonical follow or inverse operation.', '规范 follow 或 inverse 操作。')
        },
        predicate: {
          summary: t('Captured ground named predicate.', '捕获的 ground named predicate。')
        },
        target: {
          summary: t('Optional captured ground forward target.', '可选捕获的 ground 正向目标。')
        }
      }
    },
    IRdfQueryInput: {
      summary: t(
        'Ground pattern, ordered native prefix steps and captured context.',
        'ground pattern、有序原生前缀步骤与捕获上下文。'
      ),
      members: {
        pattern: {
          summary: t(
            'Captured partial ground match; omitted graph matches all graphs.',
            '捕获的部分 ground 匹配，省略 graph 匹配所有 graph。'
          )
        },
        steps: {
          summary: t(
            'Safe native prefix in original declaration order.',
            '原声明顺序的安全原生前缀。'
          )
        },
        ctx: { summary: t('Captured original operation context.', '捕获的原操作上下文。') }
      }
    },
    IRdfQuerySource: {
      summary: t(
        'Original native RDF iterator callback with unknown projected rows and support/resource facts.',
        '原生 RDF 原迭代器回调及 unknown 投影行、支持与资源事实。'
      ),
      members: {
        pushdown: {
          summary: t('Original native traversal/operator support.', '原生遍历及操作符支持。')
        },
        execute: {
          summary: t('Open the original quad storage iterator.', '打开原 quad storage iterator。')
        },
        asyncDisposeKey: { summary: t('Optional original cleanup key.', '可选原清理键。') }
      }
    },
    IQueryRead: {
      summary: t(
        'Implemented all(ctx) and explain() terminals; all consumes and closes the original iterator.',
        '已实现的 all(ctx) 与 explain() 终点；all 消费并关闭原迭代器。'
      ),
      members: {
        all: {
          summary: t(
            'Collect results and await original cursor disposal.',
            '收集结果并等待原游标释放。'
          )
        },
        explain: { summary: t('Plan without reading data.', '不读取数据地规划。') }
      }
    },
    IQueryResult: {
      summary: t(
        'Selected all/explain/requirePushdown result. select is removed after its single transition.',
        '选择后的 all/explain/requirePushdown 结果；一次选择后移除 select。'
      ),
      members: {
        all: { summary: t('Collect selected results.', '收集选择后的结果。') },
        requirePushdown: {
          summary: t('Reject client work before opening a source.', '打开源前拒绝客户端步骤。')
        }
      }
    },
    IQueryChain: {
      summary: t(
        'Implemented three-form where, one select, all, explain and requirePushdown with precise field/output types.',
        '已实现三形态 where、一次 select、all、explain 与 requirePushdown，字段与输出类型精确。'
      ),
      members: {
        where: {
          summary: t(
            'Append object, typed path or function condition.',
            '追加对象、typed 路径或函数条件。'
          )
        },
        select: {
          summary: t('One field projection or awaited mapper.', '一次字段投影或等待 mapper。')
        },
        all: {
          summary: t('Execute the actual plan and close the source.', '执行真实计划并关闭数据源。')
        }
      }
    },
    IRecordQuerySource: {
      summary: t(
        'Author seam with one execute callback returning the original unknown-row IStorageIterator; no new resource owner.',
        '作者接点：一个 execute 回调返回原 unknown 行 IStorageIterator，不新增资源 owner。'
      ),
      members: {
        pushdown: { summary: t('Captured native support declaration.', '捕获的原生支持声明。') },
        asyncDisposeKey: {
          summary: t(
            "Optional readonly typeof Symbol.asyncDispose, captured once. An explicit symbol or undefined is accepted; other values reject with INVALID_ARGUMENT. Omission or undefined uses native Symbol.asyncDispose. Pass the host's existing fallback key when needed; mapped symbolic cleanup and source diagnostics share it while retaining separate cached cleanup Promises and the original owner. The contract creates no fallback symbol.",
            '可选只读 typeof Symbol.asyncDispose，只捕获一次。显式值接受 Symbol 或 undefined，否则以 INVALID_ARGUMENT 拒绝；省略或 undefined 时使用原生 Symbol.asyncDispose。需要时传宿主既有后备键；映射流的符号清理与来源诊断共用此键，保留独立缓存的清理 Promise 和原 owner。契约不创建后备符号。'
          )
        },
        execute: {
          summary: t(
            'Return the original cursor over only pushed conditions/fields.',
            '按已下推条件与字段返回原游标。'
          )
        }
      }
    },
    IConcurrencyAttempt: {
      summary: t(
        'A fully completed native attempt, either committed with a value or conflicted after rollback/cleanup.',
        '已完整结束的原生尝试：提交值，或回滚/清理后的冲突。'
      ),
      members: {
        status: {
          summary: t(
            'Committed or conflict, after all owned native resources have terminated.',
            '所有持有原生资源结束后的 committed 或 conflict。'
          )
        },
        value: {
          summary: t('Committed result, awaited by the outer loop.', '由外层循环等待的提交结果。')
        },
        phase: {
          summary: t(
            'Acquire or commit conflict; policy wait is valid only for acquire.',
            'acquire 或 commit 冲突；策略 wait 仅适用于 acquire。'
          )
        },
        keys: {
          summary: t(
            'Actual conflicting identities; policy receives detached snapshots.',
            '真实冲突身份；策略接收独立快照。'
          )
        },
        holder: {
          summary: t(
            'Actual holder metadata or undefined when unknown.',
            '真实持有者信息，未知时 undefined。'
          )
        },
        cause: {
          summary: t(
            'Original completed-attempt failure retained on final conflict.',
            '最终冲突保留的已结束尝试原错。'
          )
        }
      }
    },
    IConcurrencyAttemptContext: {
      summary: t(
        'Captured operation intent and shared admission budget for one genuine backend attempt.',
        '一次真实后端尝试的已捕获操作意图与共享准入预算。'
      ),
      members: {
        attempt: {
          summary: t(
            'Original shared conflict count plus one, forwarded to observations without backend counters.',
            '原共用冲突计数加一，直接转发给观察，不设后端计数器。'
          )
        },
        ...operationMembers,
        admission: {
          summary: t(
            'Try first; wait only after an acquire conflict decision.',
            '先 try，仅 acquire 冲突决策后 wait。'
          )
        },
        locking: {
          summary: t(
            'The authentic effective policy locking mode.',
            '真实生效策略的 locking 模式。'
          )
        },
        waitTimeoutMs: {
          summary: t(
            'Remaining logical budget; physical scheduling does not consume it.',
            '剩余逻辑预算，物理调度不消耗它。'
          )
        },
        wait: {
          summary: t(
            'Wait for logical admission, counting only its blocking interval.',
            '等待逻辑准入，仅统计阻塞区间。'
          )
        },
        waitPhysical: {
          summary: t(
            'Wait for physical admission under the original operation deadline; expiry is LOCK_TIMEOUT.',
            '在原操作期限内等待物理准入，到期为 LOCK_TIMEOUT。'
          )
        }
      }
    },
    IConcurrencyPort: {
      summary: t(
        'Backend-owned attempt lifecycle consumed by the sole policy loop.',
        '由唯一策略循环消费的后端 attempt 生命周期。'
      ),
      members: {
        attempt: {
          summary: t(
            'Settle only after real native commit/rollback and cleanup; never treat a signal as release.',
            '仅在真实原生提交/回滚和清理后结算；signal 不等于释放。'
          )
        }
      }
    },
    lockKey: {
      summary: t(
        'Factories preserve the exact physical channel while detaching caller-owned key components.',
        '工厂在分离调用方键组件的同时保留精确物理通道。'
      ),
      members: {
        text: {
          summary: t(
            'Snapshot the existing typed text key domain, including batch tuples.',
            '快照原 typed text 键域，包含批量 tuple。'
          ),
          example: `const key = lockKey.text(['orders', 1])`
        },
        bytes: {
          summary: t(
            'Snapshot a string-only byte-channel lock identity.',
            '快照仅字符串的字节通道锁身份。'
          ),
          example: `const key = lockKey.bytes('image')`
        },
        record: {
          summary: t(
            'Snapshot the existing record-key domain; Date/buffer/array values detach.',
            '快照原记录键域，分离 Date、buffer 与数组值。'
          ),
          example: `const key = lockKey.record(new Date(0))`
        }
      }
    },
    ConcurrencyPolicy: {
      summary: t(
        'Preset factories validate numeric configuration before execution.',
        '预设工厂在执行前校验数值配置。'
      ),
      members: {
        wait: {
          summary: t(
            'Logical acquisition wait, default 30,000 ms; zero is valid, and commit conflicts reject.',
            '逻辑获取等待，缺省 30,000 ms；允许零，提交冲突拒绝。'
          ),
          example: `const policy = ConcurrencyPolicy.wait({ timeoutMs: 0 })`
        },
        fail: {
          summary: t(
            'Pessimistic policy rejects each genuine conflict; it does not set a physical timeout.',
            '悲观策略拒绝每次真实冲突，不设置物理期限。'
          ),
          example: `const policy = ConcurrencyPolicy.fail()`
        },
        optimistic: {
          summary: t(
            'Retry up to three real conflicts with 20 ms backoff by default; retry counts and delays are nonnegative safe integers.',
            '缺省对三个真实冲突按 20 ms 重试；次数和延迟为非负安全整数。'
          ),
          example: `const policy = ConcurrencyPolicy.optimistic({ retries: 0, backoffMs: 0 })`
        }
      }
    },
    IConcurrencyConflict: {
      summary: t(
        'Per-conflict identity and wait data supplied only when a real attempt reports conflict.',
        '仅在真实尝试报告冲突时提供的单次冲突身份和等待数据。'
      ),
      members: {
        phase: {
          summary: t(
            'Acquire or commit conflict; commit cannot decide wait.',
            'acquire 或 commit 冲突；commit 不能决定 wait。'
          )
        },
        keys: {
          summary: t(
            'Independent lock-key snapshots for this decision, detached from internal identity.',
            '本次决策的独立锁键快照，与内部身份分离。'
          )
        },
        attempt: {
          summary: t('One-based real conflict sequence number.', '从一开始的真实冲突序号。')
        },
        waitedMs: {
          summary: t(
            'Actual accumulated blocking wait, excluding ordinary callback work.',
            '实际累计阻塞等待，不含普通回调工作。'
          )
        },
        holder: {
          summary: t(
            'Known real holder, explicit remote handoff, or undefined when unavailable.',
            '已知真实 holder、显式远端交接，或无法取得时的 undefined。'
          )
        },
        signal: {
          summary: t('Optional original composed cancellation signal.', '可选原组合取消信号。'),
          default: t('Omitted when no signal is provided.', '未提供信号时省略。')
        }
      }
    },
    ILockHolding: {
      summary: t(
        'One inspectable lock identity and lease state; expiry does not prove a process has died.',
        '一份可检查的锁身份和租约状态；到期不证明进程已死。'
      ),
      members: {
        key: { summary: t('Independent normalized lock identity.', '独立规范锁身份。') },
        holder: {
          summary: t(
            'Last known real holder or permitted remote handoff.',
            '最后已知真实 holder 或允许的远端交接。'
          )
        },
        expired: {
          summary: t('Whether its lease has expired before recovery.', '回收前租约是否已到期。')
        },
        expiresAt: {
          summary: t(
            'Lease deadline only when supported by this backend.',
            '仅在后端支持时提供租约到期时间。'
          ),
          default: t('Omitted for non-lease locks.', '非租约锁省略。')
        }
      }
    },
    ITransactionInfo: {
      summary: t(
        'Immutable shared transaction identity returned from authentic live views.',
        '真实有效视图返回的共享不可变事务身份。'
      ),
      members: {
        id: {
          summary: t(
            'One immutable identity shared by all real views of this transaction.',
            '本事务全部真实视图共用的不可变身份。'
          )
        },
        activityMode: {
          summary: t(
            'Actual mode captured from the backend owner.',
            '由真实后端拥有者捕获的模式。'
          ),
          values: { enum: 'TransactionActivityMode' }
        }
      }
    },
    ITransactionKeyValueApi: {
      summary: t(
        'Standard transaction text API bound to one original owner, without root operation contexts.',
        '绑定原拥有者的标准事务文本 API，不接受根操作上下文。'
      ),
      members: {}
    },
    ITransactionalCapability: {
      summary: t(
        'Select only standard tokens with declared transaction projections.',
        '仅选择声明了事务投影的标准令牌。'
      ),
      members: {}
    },
    ITransactionCapabilityApi: {
      summary: t(
        'Project a standard token to its transaction-owned API.',
        '将标准令牌投影为事务拥有者 API。'
      ),
      members: {}
    },
    IStorageResource: {
      summary: t(
        'One owned resource with explicit rejecting cleanup and separately cached report-only symbolic cleanup.',
        '自有资源的显式拒绝清理与独立缓存的只报告符号清理。'
      ),
      members: {
        dispose: {
          summary: t(
            'Return the cached main Promise of one actual cleanup; failures reject with the original error reachable.',
            '返回同一次真实清理的缓存主 Promise，失败拒绝并保留可达原错。'
          ),
          example: `await resource.dispose()`
        },
        '[Symbol.asyncDispose]': {
          summary: t(
            'Return a separately cached report-only Promise; failed cleanup is reported once and this entry resolves.',
            '返回独立缓存的只报告 Promise；清理失败报告一次，本入口完成。'
          ),
          example: `await resource[Symbol.asyncDispose]()`
        }
      }
    },
    IStorageIterator: {
      summary: t(
        'Asynchronous iterator and owned cleanup resource.',
        '异步迭代器及其自有清理资源。'
      ),
      members: {}
    },
    IStorageBaseAdmission: {
      summary: t(
        'Non-owning single-read base admission retains the original object, disposer receiver and exact reflection failure.',
        '不取得所有权的单读基础准入，保留原对象、释放接收者和精确反射失败。'
      ),
      members: {}
    },
    IBackendStageBindings: {
      summary: t(
        'One host binding surface for the seven distinct canonical observer families, without another registry or executor.',
        '七个独立规范观察家族的单一宿主绑定面，不创建另一套 registry 或执行器。'
      ),
      members: {
        backendStages: {
          summary: t(
            'Direct observer used before a store exists.',
            'store 存在前使用的直接观察者。'
          )
        },
        operationStages: {
          summary: t('Bind ordinary operations to the original store.', '把普通操作绑定原 store。'),
          example: `const operations = bindings.operationStages(store)`
        },
        codecStages: {
          summary: t(
            'Bind codec observations to the original store.',
            '把 codec 观察绑定原 store。'
          ),
          example: `const codecs = bindings.codecStages(store)`
        },
        transactionStages: {
          summary: t(
            'Bind transaction observations to the original store owner.',
            '把事务观察绑定原 store 拥有者。'
          ),
          example: `const transactions = bindings.transactionStages(store)`
        },
        concurrencyStages: {
          summary: t(
            'Bind lock observations without granting lock authority.',
            '绑定锁观察，不授予锁权限。'
          ),
          example: `const locks = bindings.concurrencyStages(store)`
        },
        sqlStages: {
          summary: t(
            'Bind SQL count observations to the original store.',
            '把 SQL 计数观察绑定原 store。'
          ),
          example: `const sql = bindings.sqlStages(store)`
        },
        queryStages: {
          summary: t(
            'Bind query plans and count observations to the original store.',
            '把查询计划与计数观察绑定原 store。'
          ),
          example: `const query = bindings.queryStages(store)`
        }
      }
    },
    IBackendStageObserver: {
      summary: t('Observe backend installation and disposal.', '观察后端安装与释放。'),
      members: {}
    },
    IStorageOperationStageObserver: {
      summary: t(
        'Observe store operations bound to original transaction views.',
        '观察绑定原事务视图的存储操作。'
      ),
      members: {}
    },
    ITransactionStageObserver: {
      summary: t(
        'Observe original transaction operations, commit and cleanup.',
        '观察原事务操作、提交与清理。'
      ),
      members: {}
    },
    IConcurrencyStageObserver: {
      summary: t('Observe canonical lock and concurrency decisions.', '观察规范锁与并发决策。'),
      members: {}
    },
    IStorageKeyPrefix: {
      summary: t(
        'Prepared canonical prefix data and matching, independent of any store or internal index.',
        'Prepared 规范前缀数据与判定，独立于任何 store 或内部索引。'
      ),
      members: {
        key: {
          summary: t(
            'Detached logical key suitable for native lowerBound cursors.',
            '适合原生 lowerBound cursor 的独立逻辑键。'
          )
        },
        lower: {
          summary: t('Inclusive typed encoded prefix bytes.', '包含端 typed 编码前缀字节。')
        },
        upper: {
          summary: t(
            'Guaranteed strict byte successor, exclusive.',
            '必有的严格字节后继，不包含端。'
          )
        },
        matches: {
          summary: t(
            'Validate and encode one candidate through the same owner, using the captured private prefix.',
            '通过同一 owner 验证与编码一个候选，并使用捕获的私有前缀判定。'
          )
        }
      }
    },
    ITransactionCapabilityView: {
      summary: t(
        'Public optional contravariant capability proof and typed transaction use; complete external scopes need no private symbol.',
        '公开可选反变能力证明与 typed 事务 use；完整外部 scope 不需要私有 symbol。'
      ),
      members: {
        use: {
          summary: t(
            'Accept only admitted finite transaction tokens and preserve record value inference.',
            '仅接受已接纳有限事务 token，保留记录值推断。'
          )
        }
      }
    },
    ITransactionRecordsApi: {
      summary: t(
        'Implemented original transaction record projection, without ordinary operation contexts.',
        '已实现原事务记录投影，不接受普通操作上下文。'
      ),
      members: {
        query: {
          summary: t(
            'Actual shared IQueryChain with undefined context and the original iterator owner.',
            '使用 undefined context 与原 iterator owner 的真实共用 IQueryChain。'
          )
        },
        removeByPrefix: {
          summary: t('Actual native transaction deletion count.', '原生事务实际删除数。')
        }
      }
    },
    ISqlValue: {
      summary: t(
        'Native SQL scalar input/output domain: null, string, number, bigint, boolean or Uint8Array.',
        '原生 SQL 标量输入、输出域：null、string、number、bigint、boolean 或 Uint8Array。'
      ),
      members: {}
    },
    ISqlRow: {
      summary: t(
        'Readonly default column-name mapping to the shared native scalar domain.',
        '默认 readonly 列名至共用原生标量域的映射。'
      ),
      members: {}
    },
    ISqlRunResult: {
      summary: t(
        'Shared changes count only; backend insertion identity requires a concrete refinement.',
        '仅共用 changes 计数；后端插入身份须由具体细化提供。'
      ),
      members: {
        changes: { summary: t('Actual native affected-row count.', '原生实际影响行数。') }
      }
    },
    ISqlFragment: {
      summary: t(
        'Opaque pure immutable fragment; runtime authenticity belongs to the original SQL WeakMap.',
        '不透明纯不可变片段；运行时真实性归原 SQL WeakMap。'
      ),
      members: {}
    },
    ISqlInput: {
      summary: t(
        'A shared native scalar or authentic SQL fragment, never arbitrary objects or raw SQL strings as a construction API.',
        '共用原生标量或真实 SQL 片段，不接纳任意对象或将原始 SQL 字符串作为构造 API。'
      ),
      members: {}
    },
    ISqlQuery: {
      summary: t(
        'A real backend-bound fragment with all/get/run and caller-declared object row schema. Native result refinements remain precise.',
        '具备真实后端 all/get/run 的片段，行对象 schema 由调用方声明；原生结果细化保持精确。'
      ),
      members: {
        all: {
          summary: t(
            'Return the original callback Promise of readonly declared rows.',
            '返回原回调的 readonly 声明行 Promise。'
          )
        },
        get: {
          summary: t(
            'Return the original callback Promise of a row or undefined.',
            '返回原回调的行或 undefined Promise。'
          )
        },
        run: {
          summary: t(
            'Return the original precise native execution result Promise.',
            '返回原精确原生执行结果 Promise。'
          )
        }
      }
    },
    ISqlTag: {
      summary: t(
        'Typed backend tag and pure id/join/empty tools; TValue constrains native output fields and TResult retains execution results.',
        'Typed 后端标签与纯 id/join/empty 工具；TValue 约束原生输出字段，TResult 保留执行结果。'
      ),
      members: {
        id: { summary: t('Quote each nonempty identifier segment.', '引用各非空标识符段。') },
        join: {
          summary: t(
            'Join authentic child references with an authentic separator.',
            '用真实分隔片段连接真实子节点引用。'
          )
        },
        empty: { summary: t('Canonical empty pure fragment.', '规范空纯片段。') }
      }
    },
    IStorageSqlQueryTerminals: {
      summary: t(
        'Finite callbacks replacing SQL query execution without altering fragment identity.',
        '替换 SQL 查询执行且不改变片段身份的有限回调。'
      ),
      members: {
        all: { summary: t('Return the native row Promise.', '返回原生行 Promise。') },
        get: { summary: t('Return the native first-row Promise.', '返回原生首行 Promise。') },
        run: { summary: t('Return the native write-result Promise.', '返回原生写结果 Promise。') }
      }
    },
    IBlobInfo: {
      summary: t(
        'Immutable metadata of an actual native object snapshot.',
        '实际原生对象快照的不可变 metadata。'
      ),
      members: {
        key: { summary: t('Logical string key.', '逻辑 string key。') },
        size: { summary: t('Byte length.', '字节长度。') },
        etag: { summary: t('Conditional-write identity.', '条件写身份。') },
        contentType: { summary: t('Optional media type.', '可选媒体类型。') },
        metadata: { summary: t('Frozen native string metadata.', '冻结的原生 string metadata。') },
        updatedAt: { summary: t('Native update timestamp.', '原生更新时间。') }
      }
    },
    IBlobObject: {
      summary: t(
        'One disposable, single-consumption native object snapshot.',
        '可释放且单次消费的原生对象快照。'
      ),
      members: {
        info: { summary: t('Snapshot metadata.', '快照 metadata。') },
        stream: {
          summary: t(
            'Consume through the platform WHATWG byte stream once.',
            '通过平台 WHATWG 字节流消费一次。'
          )
        },
        bytes: {
          summary: t(
            'Consume the same read right into detached bytes.',
            '将同一读取权消费为独立字节。'
          )
        }
      }
    },
    IBlobApi: {
      summary: t(
        'Native object operations, independent from KV and generic transactions.',
        '独立于 KV 与通用事务的原生对象操作。'
      ),
      members: {
        put: {
          summary: t('Write bytes or a stream with optional conditions.', '可带条件写入字节或流。')
        },
        get: {
          summary: t(
            'Get a disposable snapshot or inclusive range.',
            '读取可释放快照或 inclusive 范围。'
          )
        },
        head: { summary: t('Read metadata without content.', '只读 metadata，不读内容。') },
        remove: {
          summary: t(
            'Remove one object and report actual presence.',
            '移除一个对象并返回实际存在状态。'
          )
        },
        list: { summary: t('Read an ordered opaque-cursor page.', '读取有序不透明游标页。') },
        removeByPrefix: {
          summary: t(
            'Remove matching native objects and return the count.',
            '移除匹配原生对象并返回数量。'
          )
        }
      }
    },
    IDurableStorageChange: {
      summary: t(
        'A retained storage change with an opaque commit cursor.',
        '携带不透明提交游标的保留存储变更。'
      ),
      members: {
        cursor: { summary: t('Caller-persisted replay position.', '由调用方持久化的重放位置。') }
      }
    },
    IDurableChangeFeedApi: {
      summary: t(
        'Native at-least-once replay and disposable tails.',
        '原生至少一次重放与可释放 tail。'
      ),
      members: {
        readChanges: {
          summary: t('Read retained commits without acknowledging them.', '读取保留提交但不确认。')
        },
        tailChanges: {
          summary: t(
            'Follow commits, acknowledging only successful callbacks.',
            '跟随提交，仅确认成功回调。'
          )
        }
      }
    },
    ISparqlFragment: {
      summary: t('Opaque pure SPARQL node identity.', '不透明纯 SPARQL 节点身份。'),
      members: {}
    },
    ISparqlInput: {
      summary: t(
        'Named node, literal or authentic SPARQL fragment.',
        'Named node、literal 或真实 SPARQL 片段。'
      ),
      members: {}
    },
    ISparqlRow: {
      summary: t(
        'Readonly binding row retaining undefined for unbound columns.',
        '未绑定列保留 undefined 的只读绑定行。'
      ),
      members: {}
    },
    ISparqlQuery: {
      summary: t(
        'A native query retaining the same pure fragment identity.',
        '保留同一纯片段身份的原生查询。'
      ),
      members: {
        select: { summary: t('Return native binding rows.', '返回原生绑定行。') },
        ask: { summary: t('Return the native boolean.', '返回原生布尔值。') },
        construct: {
          summary: t(
            'Return raw quads including response-local blank terms.',
            '返回包含响应局部 blank 项的 raw quad。'
          )
        },
        update: { summary: t('Run one native body.', '执行一个原生 body。') }
      }
    },
    ISparqlTagTools: {
      summary: t(
        'Pure VARNAME, join and empty composition tools.',
        '纯 VARNAME、join 与 empty 组合工具。'
      ),
      members: {
        var: {
          summary: t(
            'Validate a full SPARQL variable name without a prefix.',
            '校验不含前缀的完整 SPARQL 变量名。'
          )
        },
        join: {
          summary: t(
            'Join authentic fragments, defaulting to whitespace.',
            '组合真实片段，默认空白分隔。'
          )
        },
        empty: { summary: t('The single empty fragment identity.', '唯一空片段身份。') }
      }
    },
    ISparqlApi: {
      summary: t(
        'Native callable template tag with pure tools and typed row output.',
        '带纯工具与行输出类型的原生 callable 模板 tag。'
      ),
      members: {
        var: { summary: t('Original pure variable tool.', '原纯变量工具。') },
        join: { summary: t('Original pure join tool.', '原纯 join 工具。') },
        empty: { summary: t('Original empty fragment.', '原空片段。') }
      }
    },
    DeleteCountMode: {
      summary: t(
        'Shared precount/scroll strategy-name union.',
        '共享 precount/scroll 策略名称联合。'
      ),
      members: {}
    },
    IVectorApi: {
      summary: t(
        'Native vector collection construction preserving payload schema and query family types.',
        '保留 payload schema 与 query family 类型的原生向量 collection 构造。'
      ),
      members: {
        collection: {
          summary: t(
            'Borrow a named native collection descriptor with consistent dimensions and metric.',
            '借用具有一致维度与 metric 的命名原生 collection 描述。'
          )
        }
      }
    },
    IVectorCollection: {
      summary: t(
        'Store-borrowed native point operations and shared bounded query construction.',
        '借用 store 的原生点操作与共享有界查询构造。'
      ),
      members: {
        near: {
          summary: t('Start the shared vector query before topK.', '在 topK 前开始共享向量查询。')
        },
        similarTo: {
          summary: t(
            'Use an existing point as the native query vector.',
            '使用已有点作为原生查询向量。'
          )
        },
        recommend: {
          summary: t('Compose standard positive/negative examples.', '组合标准正负样本。')
        },
        upsert: {
          summary: t(
            'Atomically write native points with optional TTL.',
            '可带 TTL 原子写入原生点。'
          )
        },
        deleteWhere: {
          summary: t(
            'Delete native matching points and return the declared numeric count.',
            '删除原生匹配点并返回约定数值计数。'
          )
        },
        delete: { summary: t('Delete named point IDs.', '按点 ID 删除。') },
        search: {
          summary: t('Execute the native direct search surface.', '执行原生直接搜索入口。')
        }
      }
    },
    IVectorFilter: {
      summary: t(
        'Own-path boolean/scalar/range native vector predicates.',
        '按自有路径求值的布尔、标量与范围原生向量谓词。'
      ),
      members: {}
    },
    IRdfApi: {
      summary: t(
        'Native atomic ground RDF writes and shared query construction.',
        '原生原子 ground RDF 写入与共享查询构造。'
      ),
      members: {
        add: { summary: t('Atomically add canonical ground quads.', '原子添加规范 ground quad。') },
        delete: {
          summary: t('Atomically delete canonical ground quads.', '原子删除规范 ground quad。')
        },
        match: {
          summary: t(
            'Construct the shared RDF family with an optional ground pattern.',
            '按可选 ground 模式构造共享 RDF family。'
          )
        }
      }
    },
    ITransactionRdfApi: {
      summary: t(
        'Original draft RDF writes and zero-context complete read admission.',
        '原 draft RDF 写入与无 context 完整读准入。'
      ),
      members: {
        add: {
          summary: t(
            'Write through a fresh original operation view.',
            '通过新的原 operation view 写入。'
          )
        },
        delete: {
          summary: t(
            'Delete through the same native draft owner.',
            '通过同一原生 draft owner 删除。'
          )
        },
        match: {
          summary: t(
            'Retain actual native iterators and shared read terminals.',
            '保留真实原生 iterator 与共享读终端。'
          )
        }
      }
    },
    ISqlExecutor: {
      summary: t(
        'One sql property containing the precise bound tag, shared by stores, original transaction views and ORM functions.',
        '仅含精确绑定标签 sql 属性，由 store、原事务视图与 ORM 函数共用。'
      ),
      members: {
        sql: { summary: t('The original backend bound SQL tag.', '原后端绑定的 SQL 标签。') }
      }
    },
    ICompiledStorageSql: {
      summary: t(
        'Pure execution-local text and readonly values projection; prepare supplies fresh bytes and no driver/control handles.',
        '纯执行局部 text 与 readonly values 投影；prepare 提供独立字节，无驱动或控制句柄。'
      ),
      members: {
        text: {
          summary: t(
            'Single validated statement with dialect placeholders.',
            '使用方言占位符的单条已验证语句。'
          )
        },
        values: {
          summary: t(
            'Readonly scalar list with execution-local copied byte views.',
            'Readonly 标量列表，字节视图为本次执行独立副本。'
          )
        }
      }
    },
    ISqlStageObserver: {
      summary: t(
        'Observe SQL execution counts without receiving statement payloads.',
        '观察 SQL 执行计数，不接收语句载荷。'
      ),
      members: {}
    },
    IQueryStageObserver: {
      summary: t(
        'Observe query plans and terminal counts without executing a query.',
        '观察查询计划与结束计数，不执行查询。'
      ),
      members: {}
    },
    IConcurrencyHolder: {
      summary: t(
        'Real holder identity or a remote handoff interval with no fabricated owner.',
        '真实持有者身份，或不伪造 owner 的远端交接区间。'
      ),
      members: {}
    },
    IConcurrencyDecision: {
      summary: t(
        'Exclusive wait, reject or retry decision fields.',
        '互斥的 wait、reject 或 retry 决策字段。'
      ),
      members: {}
    },
    IStorageBase: {
      summary: t(
        'Runtime-neutral resource, backend name and support facts without a KV requirement.',
        '不强制 KV 的中立资源、后端名与能力事实。'
      ),
      members: {
        backend: storeMembers.backend!,
        capabilities: storeMembers.capabilities!,
        dispose: {
          summary: t('Explicit cleanup owned by the original backend.', '原后端拥有的显式清理。'),
          example: `await base.dispose()`
        },
        '[Symbol.asyncDispose]': {
          summary: t(
            'Report-only cleanup at the canonical resource key.',
            '规范资源键上的只报告清理。'
          ),
          example: `await base[Symbol.asyncDispose]()`
        }
      }
    },
    IStorageStore: {
      summary: t(
        'Resource base with an exact contravariant capability set and token use/has.',
        '保留精确反变能力集合及令牌 use/has 的资源基础对象。'
      ),
      members: {}
    },
    IStorageCapability: {
      summary: t(
        'Opaque API token; its name does not grant runtime authority.',
        '不透明 API 令牌；名称不授予运行权限。'
      ),
      members: {}
    },
    IAnyStorageCapability: {
      summary: t(
        'Shared upper bound for capability identity tokens.',
        '能力身份令牌的共同类型上界。'
      ),
      members: {}
    },
    ICapabilityApi: {
      summary: t(
        'Type projection of the API associated with one token.',
        '一个令牌所关联 API 的类型投影。'
      ),
      members: {}
    },
    IKeyValueApi: {
      summary: t(
        'Standard KV methods: ordinary raw operations plus required native batch and prefix endpoints.',
        '标准 KV 方法：原 raw 普通操作加必需的原生批量与前缀入口。'
      ),
      members: {
        getMany: batchMembers.getMany!,
        setMany: batchMembers.setMany!,
        removeMany: batchMembers.removeMany!,
        removeByPrefix: batchMembers.removeByPrefix!
      }
    },
    ICapabilityImpl: {
      summary: t(
        'Authentic frozen pairing of one token and its precise backend API.',
        '一个令牌与精确后端 API 的真实冻结配对。'
      ),
      members: {}
    },
    ICapabilityStore: {
      summary: t(
        'Original base refined with exact APIs, full transaction scope and builder augmentation.',
        '保留具体 API、完整事务视图与构建器增强的基础对象投影。'
      ),
      members: {}
    },
    IStorageCapabilitySet: {
      summary: t(
        'Type-only capability union from an already provided store.',
        '已装配 store 的纯类型能力联合投影。'
      ),
      members: {}
    },
    IStorageImplementationsOf: {
      summary: t('Exact original provider implementation tuple.', '提供方原始实现元组的精确投影。'),
      members: {}
    },
    ICapabilityPublication: {
      summary: t(
        'Idempotent publish and release of one prepared capability batch.',
        '一批已准备能力的幂等发布与释放。'
      ),
      members: {}
    },
    ICapabilityInstallPort: {
      summary: t(
        'One store’s opaque prepare/publish/release installation authority.',
        '一个 store 的不透明 prepare/publish/release 安装权限。'
      ),
      members: {}
    },
    IChainMethods: {
      summary: t(
        'Finite query, transaction, vector and RDF chain method groups.',
        '有限的 query、事务、vector 与 RDF 链方法分组。'
      ),
      members: {}
    },
    IChainMethodsOf: {
      summary: t('Pure projection of existing chain method groups.', '已有链方法分组的纯投影。'),
      members: {}
    },
    IWithChainMethods: {
      summary: t(
        'Preserves original builder scope and augmentation while projecting host method groups.',
        '投影宿主方法分组时保留原构建器视图与增强。'
      ),
      members: {}
    },
    ILockKey: {
      summary: t(
        'Physical text, bytes or record channel and key identity.',
        'text、bytes 或 record 物理通道及键身份。'
      ),
      members: {
        channel: {
          summary: t(
            'Physical text, bytes or record channel; identical user keys in different channels never collide.',
            '物理 text、bytes 或 record 通道；不同通道的相同用户键不碰撞。'
          )
        },
        key: {
          summary: t(
            'Existing typed storage key for text/records, or string for bytes; factory snapshots mutable components.',
            'text/record 为原 typed storage key，bytes 为字符串；工厂快照可变组件。'
          )
        }
      }
    },
    IConcurrencyPolicy: {
      summary: t(
        'Public policy name and locking mode; runtime authority remains private.',
        '公开策略名与加锁模式；运行权限仍由私有拥有者掌握。'
      ),
      members: {
        name: {
          summary: t(
            'Captured diagnostic name; equal names do not share runtime policy authority.',
            '捕获的诊断名称；同名不共享策略运行权限。'
          )
        },
        locking: {
          summary: t(
            'Captured pessimistic or optimistic mode, independent of existing-key ConflictPolicy.',
            '捕获的悲观或乐观模式，独立于已有键 ConflictPolicy。'
          )
        }
      }
    },
    ITransactionOptions: {
      summary: t(
        'Operation timing, declared locks and a selected concurrency policy.',
        '操作时间选项、声明锁及选定并发策略。'
      ),
      members: {}
    },
    IWriteConcurrencyOptions: {
      summary: t('Per-write concurrency policy override.', '单次写入的并发策略覆盖。'),
      members: {}
    },
    ITransactionBuilder: {
      summary: t(
        'Immutable unlocked chain type retaining its original second augmentation generic.',
        '保留原第二增强泛型的不可变未加锁链类型。'
      ),
      members: {}
    },
    ILockedTransactionBuilder: {
      summary: t(
        'Locked chain type exposes run and retains full scope and method augmentation.',
        '加锁链类型公开 run，并保留完整视图与方法增强。'
      ),
      members: {}
    },
    IVersionedEnvelope: {
      summary: t(
        'Own safe version and caller-owned non-null state container.',
        '自有安全版本与调用方拥有的非空状态容器。'
      ),
      members: {}
    },
    IMigrationStepContext: {
      summary: t(
        'One source/target version transition with an optional borrowed cancellation signal.',
        '一次来源/目标版本转换及可选借用取消信号。'
      ),
      members: {}
    },
    IMigrationStep: {
      summary: t(
        'Unknown historical state conversion; return type inference decides synchronous admission.',
        '转换未知历史状态；返回类型推断决定同步准入。'
      ),
      members: {}
    },
    IMigrationReset: {
      summary: t(
        'Zero-argument fresh-state factory for resetting older archives once.',
        '对旧存档仅调用一次的零参数新状态工厂。'
      ),
      members: {}
    },
    ISyncMigrationSteps: {
      summary: t(
        'Retains callback inference while excluding known Promise and callable-then return types.',
        '保留回调推断，排除已知 Promise 与可调用 then 返回类型。'
      ),
      members: {}
    },
    IMigrationPlan: {
      summary: t(
        'Frozen current/base versions and captured step functions, with optional reset.',
        '冻结的当前/最低版本及步骤快照，可选 reset。'
      ),
      members: {}
    },
    IMigrationStepObserver: {
      summary: t(
        'Nonblocking before/after observers with a synchronous failure reporter.',
        '不阻塞的步骤前后观察器及同步失败报告。'
      ),
      members: {}
    },
    IMigrationRunOptions: {
      summary: t(
        'Borrowed cancellation, utility reporter and step observation configuration.',
        '借用的取消、工具报告器与步骤观察配置。'
      ),
      members: {}
    },
    ICodecStageObserver: {
      summary: t(
        'Observation-only encode/decode stages bound to the original real store and transaction owner.',
        '绑定原真实 store 与事务拥有者的只观察编解码阶段。'
      ),
      members: {}
    },
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
            'Exact observed reflection or getter failure for invalid admission, or undefined when rejection was a plain shape mismatch.',
            '无效接纳中观察到的精确反射或访问器失败；普通形状不匹配则为空值。'
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
      example: storageContractCases.snapshotStorageCapabilities![0]!.example,
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
          ),
          default: t(
            'Legacy omission normalizes to `false` during capability admission.',
            '接纳能力描述时，旧输入缺失此字段会规范化为 `false`。'
          )
        },
        changeFeed: {
          summary: t(
            'Whether the backend emits post-commit invalidation changes; legacy missing input flags normalize to false.',
            '后端是否发送提交后的失效变化；旧输入缺失此标志时规范化为假。'
          ),
          default: t(
            'Legacy omission normalizes to `false` during capability admission.',
            '接纳能力描述时，旧输入缺失此字段会规范化为 `false`。'
          )
        },
        maxValueBytes: {
          summary: t(
            'Optional nonnegative safe-integer approximate per-value byte limit; undefined means this descriptor supplies no per-value bound.',
            '可选非负安全整数形式的近似单值字节上限；空值表示此描述不提供单值上限。'
          ),
          default: t(
            '`undefined`: no per-value byte limit is declared.',
            '`undefined`：未声明单值字节上限。'
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
      example: storageContractCases.snapshotOperationContext![0]!.example,
      members: {
        ...operationMembers,
        conflictPolicy: {
          ...conflictMember,
          summary: t(
            'The conflict policy captured in this snapshot, preserving the caller’s choice between rejecting an existing key and allowing replacement.',
            '快照捕获的冲突策略，保留调用方选择的已有键处理方式：拒绝冲突，或允许替换。'
          ),
          default: t(
            'Omitted: snapshot retains undefined; the writing backend applies its normal conflict default.',
            '省略时快照保留空值，由写入后端应用常规冲突默认值。'
          )
        }
      }
    },
    IWriteOptions: {
      summary: t(
        'Asynchronous operation context extended with optional existing-key and authentic concurrency policies for backend writes.',
        '异步操作上下文加上后端写入的可选已有键策略与真实 concurrency 策略。'
      ),
      members: {
        ...operationMembers,
        conflictPolicy: conflictMember,
        concurrency: {
          summary: t(
            'Optional authentic policy; omission selects the original owner default.',
            '可选真实策略；省略时选择原 owner 默认。'
          )
        }
      }
    },
    ISyncWriteOptions: {
      summary: t(
        'Reduced synchronous write policy exposing only conflictPolicy. Validation rejects signal or timeoutMs only when their values are not undefined; an extra pageSize field is not read or validated.',
        '仅公开冲突策略的精简同步写策略。校验仅在 `signal` 或 `timeoutMs` 值非空值时拒绝；额外的 `pageSize` 字段不会被读取或校验。'
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
        'Complete text, byte and record transaction view; retain it only during its original callback or owned operation interval.',
        '完整文本、字节与记录事务视图；只在原回调或所属操作区间使用。'
      ),
      scenarios: [
        t(
          'Read and update records under one concrete backend transaction outcome.',
          '在同一具体后端事务结局下读取并更新记录。'
        )
      ],
      example: `await records.transaction(async (tx) => {
  const value = await tx.getRecord('profile')
  if (value) await tx.putRecord(value, 'profile', { conflictPolicy: 'replace' })
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
  await tx.putIndexedRecord({ name: 'Ada' }, 'user-1', handle, { byName: { kind: 'single', key: 'Ada' } })
})`,
      members: transactionMembers
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
              'Synchronous, asynchronous or PromiseLike `(tx) => result` callback receiving `ISecondaryIndexTransactionScope`; do not retain tx after the callback settles. Throw or rejection requests transaction failure.',
              '接收 `ISecondaryIndexTransactionScope` 的同步、异步或 PromiseLike `(tx) => result` 回调；回调结算后不可保留使用事务。抛错或拒绝请求事务失败。'
            ),
            ctx: contextParam
          },
          returns: t(
            'A promise of callback output once the backend transaction outcome is known.',
            '后端事务结局已知后返回回调输出的异步结果。'
          ),
          example: `await indexed.transactionIndexed(handle, async (tx) => {
  const value = await tx.getRecord('user-1')
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
            'Required flag: true requires projected keys to be unique across records; false permits different records to share a projected key. The backend enforces this constraint.',
            '必填标志：true 要求不同记录的投影键唯一，false 允许不同记录共享投影键；约束由后端执行。'
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
        'Open backend label string validated by BACKEND_KIND_PATTERN; a name does not grant capability authority.',
        '由 BACKEND_KIND_PATTERN 校验的开放后端名称字符串；名称不授予能力权限。'
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
    IStorageContractErrorCode: {
      summary: t(
        'Stable semantic code union from `StorageContractErrorCode`; source identity is required when interpreting these strings.',
        '来自 `StorageContractErrorCode` 的稳定语义码联合，解释字符串时必须确认来源身份。'
      ),
      members: {}
    },
    IStorageContractErrorDetails: {
      summary: t(
        'Producer-authored neutral error details containing optional backend, original key, lock identities, holder and causal failure.',
        '生产者编写的中立错误详情，包含可选后端、原始键、锁身份、持有者和原因失败。'
      ),
      members: {
        capability: errorMembers.capability!,
        keys: errorMembers.keys!,
        holder: errorMembers.holder!,
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
      example: storageContractCases.StorageContractError![0]!.example,
      members: errorMembers
    }
  },
  enums: {
    QueryOperation: {
      summary: t(
        'Shared planner vocabulary; actual native support is a declared subset.',
        '共用规划词汇，真实原生支持由子集声明。'
      ),
      values: {
        where: t('Declarative condition.', '声明式条件。'),
        predicate: t('Client function predicate.', '客户端函数谓词。'),
        select: t('Field projection.', '字段投影。'),
        mapper: t('Client mapping.', '客户端映射。'),
        order: t('Key selector ordering.', '键选择器排序。'),
        comparator: t('Comparator ordering.', '比较器排序。'),
        skip: t('Offset skip.', '偏移跳过。'),
        after: t('Keyset cursor.', '键集游标。'),
        limit: t('Result bound.', '结果上限。'),
        distinct: t('Distinct field.', '字段去重。'),
        count: t('Count terminal.', '计数终点。'),
        exists: t('Existence terminal.', '存在性终点。'),
        aggregate: t('Numeric aggregate.', '数值聚合。'),
        topK: t('Vector result bound.', '向量结果上限。'),
        minScore: t('Score threshold.', '分数阈值。'),
        follow: t('RDF forward relation.', 'RDF 正向关系。'),
        inverse: t('RDF reverse relation.', 'RDF 反向关系。'),
        groupBy: t('Group ranked hits.', '已排名命中分组。')
      }
    },
    QueryOperator: {
      summary: t('Canonical declarative operators.', '规范声明式操作符。'),
      values: {
        eq: t('SameValueZero or Date time equality.', 'SameValueZero 或 Date 时间相等。'),
        ne: t('Negated equality.', '相等判断取反。'),
        in: t('Membership compiled once to Sets.', '一次编译为 Set 的成员判断。'),
        exists: t('Presence independently of undefined.', '独立于 undefined 的存在性。'),
        gt: t('Greater than a same-domain bound.', '大于同域边界。'),
        gte: t('At least a same-domain bound.', '大于等于同域边界。'),
        lt: t('Less than a same-domain bound.', '小于同域边界。'),
        lte: t('At most a same-domain bound.', '小于等于同域边界。'),
        between: t('Inclusive same-domain interval.', '同域闭区间。'),
        startsWith: t('String prefix without coercion.', '不强制转换的字符串前缀。'),
        contains: t('String substring without coercion.', '不强制转换的字符串包含。'),
        has: t('Array element equality.', '数组元素相等。')
      }
    },
    TransactionActivityMode: {
      summary: t(
        'Actual activity constraint chosen by the backend owner.',
        '后端拥有者选择的真实活跃约束。'
      ),
      values: {
        managed: t(
          'The backend manages activity until its own transaction lifetime ends.',
          '后端在自身事务生命周期结束前管理活跃期。'
        ),
        native: t(
          'Native transaction activity windows govern every request.',
          '每次请求受原生事务活跃窗口约束。'
        )
      }
    },
    TransactionBeforeStage: {
      summary: t(
        'Observation boundaries before transaction work; all are report-only.',
        '事务工作前的观察边界，全部只报告。'
      ),
      values: {
        beforeTransaction: t('Before creating a real transaction.', '创建真实事务之前。'),
        beforeTxOperation: t('Before an admitted transaction operation.', '已接纳事务操作之前。'),
        beforeCommit: t(
          'Before the original transaction commits, on the final check view.',
          '原事务提交前，使用最后检查视图。'
        ),
        beforePersistFlush: t(
          'Before the current transactional persistence flush.',
          '本次事务持久化 flush 之前。'
        )
      }
    },
    TransactionObservedStage: {
      summary: t(
        'Canonical transaction observations retain the captured original identity.',
        '规范事务观察保留捕获的原身份。'
      ),
      values: {
        onTransactionStart: t('After a real transaction is registered.', '真实事务登记之后。'),
        afterTxOperation: t('After one actual transaction operation.', '一次实际事务操作之后。'),
        afterCommit: t('After native commit is known to have completed.', '确认原生提交完成之后。'),
        afterRollback: t('After native rollback completes.', '原生回滚完成之后。'),
        onTransactionClose: t(
          'After original transaction lifetime closes.',
          '原事务生命周期关闭之后。'
        ),
        afterPersistFlush: t(
          'After encoding and request completion; this does not claim commit.',
          '编码与请求完成之后，不声明已提交。'
        )
      }
    },
    ConcurrencyHolderState: {
      summary: t(
        'Real holder status and the remote handoff interval.',
        '真实持有状态与远端交接区间。'
      ),
      values: {
        held: t('A real local or remote owner holds the lock.', '真实本地或远端拥有者持锁。'),
        'handing-off': t(
          'Remote transfer is in progress; owner identity is intentionally absent.',
          '远端交接进行中，不提供 owner 身份。'
        )
      }
    },
    StorageStageKind: {
      summary: t(
        'Distinct canonical observer families; kinds grant no data authority.',
        '独立规范观察家族，kind 不授予数据权限。'
      ),
      values: {
        codec: t('Value codec observations.', '值编解码观察。'),
        backend: t('Backend construction and disposal.', '后端构造与释放。'),
        operation: t('Ordinary storage operations.', '普通存储操作。'),
        transaction: t('Original transaction lifecycle and operations.', '原事务生命周期与操作。'),
        concurrency: t('Lock and policy decisions.', '锁与策略决策。'),
        sql: t('SQL execution counts.', 'SQL 执行计数。'),
        query: t('Query plans and result counts.', '查询计划与结果计数。')
      }
    },
    ConflictPolicy: {
      summary: t(
        'Existing-key outcomes used by asynchronous, synchronous and transaction write options.',
        '异步、同步和事务写选项使用的已有键处理方式。'
      ),
      values: conflictValues
    },
    StorageContractErrorCode: {
      summary: t(
        'Stable contract failure codes covering invalid inputs, keys, capability absence, disposal and cancellation.',
        '涵盖无效输入、键、能力缺失、释放和取消的稳定契约失败码。'
      ),
      values: {
        queryNotPushable: t(
          'Strict execution includes client steps; inspect explain before reading.',
          '严格执行包含客户端步骤；读取前检查 explain。'
        ),
        concurrencyPolicyFailed: t(
          'A policy threw or returned an invalid decision; inspect its original cause.',
          '策略抛错或返回非法决策，检查原始 cause。'
        ),
        lockTimeout: t(
          'Logical admission budget or physical deadline expired after cleanup.',
          '清理后报告逻辑准入预算或物理期限到期。'
        ),
        lockRejected: t(
          'Policy rejected an actual acquisition conflict.',
          '策略拒绝了真实准入冲突。'
        ),
        writeConflict: t(
          'Policy rejected a commit conflict after completed rollback.',
          '回滚完成后策略拒绝提交冲突。'
        ),
        lockLost: t(
          'A backend proved its own expired lease was replaced.',
          '后端确认自身过期租约已被替换。'
        ),
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
        envelopeInvalid: t('Archive envelope shape is invalid.', '存档 envelope 形态无效。'),
        versionUnsupported: t(
          'Archive version is outside the supported plan range.',
          '存档版本不在计划支持范围。'
        ),
        migrationGap: t(
          'Migration target versions contain a gap or noncanonical key.',
          '迁移目标版本存在断档或非规范键。'
        ),
        migrationFailed: t(
          'A migration step failed; the original error remains on cause.',
          '迁移步骤失败；原始错误保留在 cause。'
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
