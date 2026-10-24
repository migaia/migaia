/**
 * Reference documentation of `@migaia/storage-contract`. Rules: `app/reference/contract.ts`.
 * Operation-context snapshots are frozen and reused by identity; key and capability snapshots are
 * detached but mutable. Codec methods retain their original function references. Concrete backends
 * own I/O, cancellation and resource cleanup; this package supplies neutral contracts.
 */
import type { ILibraryReference, IMemberDoc, IText } from './contract.js'
import { storageContractCases } from './storage-contract-cases.ts'
import {
  storageContractVectorSymbols,
  storageContractVectorTypes,
  storageContractVectorEnums,
  storageVectorRerankMember
} from './storage-contract-vector.js'

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

/** Explain and author-plan views share the same detached source-selection diagnostics. */
const querySourceReasonMembers: Readonly<Record<string, IMemberDoc>> = {
  sourceReason: {
    summary: t(
      'Optional reason why this native source or index was selected, captured without I/O.',
      '无需访问数据即可捕获的可选理由，解释选择此原生来源或索引的原因。'
    )
  },
  sourceCandidates: {
    summary: t(
      'Detached readonly index/reason candidates explaining alternatives considered by the original source author.',
      '独立的只读索引与理由候选，解释原来源作者考虑过的其它选择。'
    )
  }
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
  fromVersion: {
    summary: t(
      'Archive version immediately before the failed migration step or reset, retained on the original error when supplied.',
      '失败迁移步骤或重置之前的存档版本，在提供时保留于原错误对象。'
    )
  },
  toVersion: {
    summary: t(
      'Target version of the failed migration step or reset, retaining the attempted upgrade boundary for diagnostics.',
      '失败迁移步骤或重置的目标版本，供诊断检查实际尝试的升级边界。'
    )
  },
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

/** Common read terminals consume the original backend cursor and await its cleanup. */
const queryReadMembers: Readonly<Record<string, IMemberDoc>> = {
  all: {
    summary: t(
      'Collect every row left by the query plan and await original cursor cleanup.',
      '收集查询计划最终保留的全部结果，并等待原后端游标清理完成。'
    ),
    params: { ctx: contextParam },
    returns: t(
      'An array in final query order; source, mapping and cleanup failures reject the promise.',
      '按最终查询顺序排列的数组；来源、映射及清理错误会拒绝此承诺。'
    ),
    example: 'const rows = await query.all()'
  },
  first: {
    summary: t(
      'Read at most the first matching row, then close the original cursor early.',
      '最多读取第一条匹配结果，随后提前关闭原后端持有的游标。'
    ),
    params: { ctx: contextParam },
    returns: t(
      'The first final row, or undefined when the query has no results.',
      '最终结果中的第一行；没有匹配结果时返回 undefined。'
    ),
    example: 'const row = await query.first()'
  },
  maybe: {
    summary: t(
      'Read the first matching row through the canonical tagged Maybe result.',
      '读取第一条匹配结果，并使用统一的带标签 Maybe 表达有值或空结果。'
    ),
    params: { ctx: contextParam },
    returns: t(
      'A { some: true, value } result or { some: false }; undefined values are not confused with absence.',
      '返回 { some: true, value } 或 { some: false }，避免把 undefined 值与没有结果混淆。'
    ),
    example: 'const result = await query.maybe()\nif (result.some) console.log(result.value)'
  },
  firstOrThrow: {
    summary: t(
      'Read the first row and reject an empty result instead of returning an optional value.',
      '读取首行；结果为空时拒绝操作，使调用方无需处理可选结果。'
    ),
    params: { ctx: contextParam },
    returns: t(
      'The first row; an empty query rejects with QUERY_EMPTY_RESULT after original cursor cleanup.',
      '返回第一行；空查询在完成原游标清理后以 QUERY_EMPTY_RESULT 拒绝。'
    ),
    example: 'const required = await query.firstOrThrow()'
  },
  pluck: {
    summary: t(
      'Collect one typed field from each final result while retaining query order.',
      '从每条最终结果提取一个有类型约束的字段，并保留原查询顺序。'
    ),
    params: {
      field: t(
        'An own result-field name selected by the caller from the current row type.',
        '调用方从当前结果类型中选择的字段名称，提取该字段的实际值。'
      ),
      ctx: contextParam
    },
    returns: t(
      'An array of the selected field values in the same order as all().',
      '按与 all() 相同的结果顺序，返回所选字段组成的值数组。'
    ),
    example: "const ids = await query.pluck('id')"
  },
  exists: {
    summary: t(
      'Determine whether any row survives the plan, stopping the original reader early when possible.',
      '判断计划执行后是否存在结果，并在可行时提前停止原读取器。'
    ),
    params: { ctx: contextParam },
    returns: t(
      'True for at least one final row, otherwise false; declared native reduction may answer directly.',
      '至少存在一条最终结果时为 true，否则为 false；已声明的原生统计可直接回答。'
    ),
    example: 'const present = await query.exists()'
  },
  count: {
    summary: t(
      'Count final query rows, using a declared native scalar reduction when the complete plan permits it.',
      '统计查询最终保留的行数；完整计划允许时使用已声明的原生标量统计。'
    ),
    params: { ctx: contextParam },
    returns: t(
      'The number of rows after filtering, bounds, distinct and projection semantics.',
      '返回经过过滤、数量边界、去重与投影语义后的最终结果数量。'
    ),
    example: 'const total = await query.count()'
  },
  each: {
    summary: t(
      'Visit final rows sequentially and await each callback before advancing the original cursor.',
      '按顺序访问最终结果，等待每次回调完成后才推进原后端游标。'
    ),
    params: {
      fn: t(
        'Caller callback receiving the current row and zero-based result index; a returned promise is awaited.',
        '调用方提供的回调，接收当前行及从零开始的结果索引；返回承诺时会等待完成。'
      ),
      ctx: contextParam
    },
    returns: t(
      'The number of visited rows; a callback failure rejects after original cleanup.',
      '返回已访问的行数；回调失败时，完成原资源清理后拒绝。'
    ),
    example: 'const visited = await query.each((row, index) => { console.log(index, row) })'
  },
  chunk: {
    summary: t(
      'Deliver bounded batches of final rows in order, awaiting the consumer before reading the next batch.',
      '按顺序交付有界结果批次，等待消费者处理完毕后才读取下一批。'
    ),
    params: {
      size: t(
        'Caller-selected positive safe integer bounding the number of rows per callback.',
        '调用方选定的正安全整数，限制每次回调接收的最大结果行数。'
      ),
      fn: t(
        'Caller callback receiving a readonly batch; the final batch may be smaller and returned promises are awaited.',
        '调用方回调接收只读批次，最后一批可以较小；回调返回的承诺会被等待。'
      ),
      ctx: contextParam
    },
    returns: t(
      'The total number of rows delivered across all completed batches.',
      '返回所有已交付批次包含的结果总行数。'
    ),
    example: 'const visited = await query.chunk(20, (rows) => { console.log(rows.length) })'
  },
  stream: {
    summary: t(
      'Expose the shared query reader as a storage iterator with original cancellation and cleanup ownership.',
      '以存储迭代器公开共享查询读取器，沿用原取消语义与资源清理归属。'
    ),
    params: { ctx: contextParam },
    returns: t(
      'An IStorageIterator over final rows; finish iteration or await dispose() when stopping early.',
      '返回最终结果的 IStorageIterator；应完成迭代，提前停止时等待 dispose()。'
    ),
    example:
      'const rows = query.stream()\ntry { console.log(await rows.next()) } finally { await rows.dispose() }'
  },
  explain: {
    summary: t(
      'Inspect captured native and client plan steps without opening a backend cursor or performing I/O.',
      '检查已捕获的原生与客户端计划步骤，不打开后端游标也不执行任何读写。'
    ),
    returns: t(
      'An IQueryPlan with pushed/client steps, source identity and conservative fullScan information.',
      '返回包含下推步骤、客户端步骤、来源身份及保守 fullScan 信息的 IQueryPlan。'
    ),
    example: 'const plan = query.explain()\nconsole.log(plan.pushed, plan.client, plan.fullScan)'
  }
}

/** Query refinements preserve the immutable original branch and the current family type. */
const queryChainMembers: Readonly<Record<string, IMemberDoc>> = {
  ...queryReadMembers,
  where: {
    summary: t(
      'Append an object condition, typed path condition or client predicate without executing the query.',
      '追加对象条件、有类型约束的路径条件或客户端谓词，不立即执行查询。'
    ),
    params: {
      condition: t(
        'Caller-authored IWhere object over the filter row type; the planner captures canonical field conditions.',
        '调用方按过滤行类型编写的 IWhere 对象，由计划器捕获为规范字段条件。'
      ),
      path: t(
        'Caller-selected typed object path in the filter row; vector queries address payload fields.',
        '调用方选择的过滤行类型路径；向量查询在此访问 payload 中的字段。'
      ),
      operator: t(
        'A field-compatible operator such as eq, gte, has or startsWith, selected for the path value type.',
        '根据路径值类型选择兼容操作符，例如 eq、gte、has 或 startsWith。'
      ),
      value: t(
        'Caller operand whose type matches the chosen path and operator; collection operators use their declared element domain.',
        '调用方传入的条件值，须匹配路径与操作符类型；集合操作符遵循声明的元素值域。'
      ),
      predicate: t(
        'Caller predicate over the filter row; JavaScript predicates stay on the client and cannot be pushed down.',
        '调用方针对过滤行的谓词；JavaScript 函数仅在客户端执行，不能下推。'
      )
    },
    returns: t(
      'A new query branch retaining its family and installed Feature methods; the source branch is unchanged.',
      '返回保留当前家族和已安装 Feature 方法的新查询分支，原分支不变。'
    ),
    example: "const paid = query.where({ status: 'paid' }).where('total', 'gte', 100)"
  },
  select: {
    summary: t(
      'Apply one field projection or awaited mapper and transition to a read-only selected-result shape.',
      '执行一次字段投影或等待映射函数，转为只提供读取终点的投影结果类型。'
    ),
    params: {
      fields: t(
        'One or more caller-selected field names from the current result row type.',
        '调用方从当前结果行类型中选择的一个或多个字段名称。'
      ),
      mapper: t(
        'Caller mapping function over a row; promised outputs are awaited and infer the selected result type.',
        '调用方提供的行映射函数；承诺结果会被等待，并推导投影后的结果类型。'
      )
    },
    returns: t(
      'A typed IQueryResult retaining installed Feature methods; select and later where refinements are absent.',
      '返回保留已安装 Feature 方法的精确 IQueryResult，后续不再提供 select 或 where。'
    ),
    example: "const totals = await query.select('total').all()"
  },
  distinct: {
    summary: t(
      'Retain the first current-order row for each SameValueZero identity of a selected field.',
      '按所选字段的 SameValueZero 身份去重，保留当前顺序中首次出现的行。'
    ),
    params: {
      field: t(
        'Caller-selected field name from the current row type whose values determine duplicate identity.',
        '调用方从当前行类型选择的字段名，以字段值决定重复身份。'
      )
    },
    returns: t(
      'A new query branch with distinct applied at this position in the ordered plan.',
      '返回新查询分支，在有序计划的当前位置应用字段去重。'
    ),
    example: "const categories = await query.distinct('category').all()"
  },
  requirePushdown: {
    summary: t(
      'Require a completely native plan; a terminal rejects client work before opening the source.',
      '要求整个计划均可原生执行；终点发现客户端步骤时在打开来源之前拒绝。'
    ),
    returns: t(
      'A new query branch carrying the native-only requirement without performing I/O.',
      '返回携带纯原生要求的新查询分支，构建过程不执行读写。'
    ),
    example: 'const native = query.requirePushdown()\nconsole.log(native.explain())'
  }
}

/** Numeric aggregate terminals skip absent samples and keep bounded accumulator state. */
const queryStatisticsMembers: Readonly<Record<string, IMemberDoc>> = Object.fromEntries(
  (['min', 'max', 'sum', 'avg'] as const).map((name) => [
    name,
    {
      summary: t(
        `${name} computes its numeric aggregate over final query rows, reusing a declared native scalar reduction when available.`,
        `${name} 对最终查询行计算数值统计；存在兼容的原生标量统计时复用原实现，缺失字段不计入样本。`
      ),
      params: {
        field: t(
          'Caller-selected numeric field of the current result type; optional numeric fields are accepted.',
          '调用方选择的当前结果类型数值字段，也接受类型为可选数值的字段。'
        ),
        ctx: contextParam
      },
      returns:
        name === 'sum'
          ? t(
              'The numeric sum; a query with no numeric samples returns 0.',
              '返回数值总和；查询没有数值样本时返回零。'
            )
          : t(
              'A tagged Maybe containing the aggregate, or { some: false } when no numeric samples remain.',
              '返回包含统计结果的带标签 Maybe；没有剩余数值样本时为 { some: false }。'
            ),
      example: `const value = await query.${name}('total')`
    }
  ])
)

/** Keyset pages borrow the original cursor owner and expose opaque process-local continuation. */
const queryPageMember: IMemberDoc = {
  summary: t(
    'Read a bounded page and one lookahead to determine whether a next cursor is needed.',
    '读取有界结果页，并通过一条前瞻结果判断是否需要提供后续游标。'
  ),
  params: {
    size: t(
      'Caller-selected positive safe integer specifying the maximum items in this page.',
      '调用方选定的正安全整数，指定本页最多返回的结果条数。'
    ),
    ctx: contextParam
  },
  returns: t(
    'Readonly page metadata with items and optional next; reuse next only with the same compatible source, conditions and ordering.',
    '返回含 items 与可选 next 的只读分页信息；next 仅用于来源、条件及排序兼容的同一查询。'
  ),
  example:
    'const firstPage = await query.page(20)\nif (firstPage.next) console.log(await query.after(firstPage.next).page(20))'
}

/** Record and RDF bounds share the original ordered plan and keyset cursor validation. */
const queryBoundsMembers: Readonly<Record<string, IMemberDoc>> = {
  limit: {
    summary: t(
      'Retain at most the caller-selected number of rows at this step of the query plan.',
      '在当前查询计划步骤最多保留调用方指定数量的行，后续操作沿用该边界。'
    ),
    params: {
      count: t(
        'A caller-selected nonnegative safe integer; zero produces an empty result without consuming rows.',
        '调用方选择的非负安全整数；零表示结果为空，不消费来源中的行。'
      )
    },
    returns: t(
      'A new branch retaining the current query family and its original Feature methods.',
      '返回保留当前查询家族与原 Feature 方法的新分支。'
    ),
    example: 'const rows = await query.limit(10).all()'
  },
  skip: {
    summary: t(
      'Discard a nonnegative number of rows at this plan position; client offset work is explicitly O(n).',
      '在当前计划位置跳过非负数量的行；客户端偏移需要明确的线性扫描成本。'
    ),
    params: {
      count: t(
        'Caller-selected nonnegative safe integer counting rows to discard before later plan steps.',
        '调用方选定的非负安全整数，指定后续计划步骤执行前需要丢弃的行数。'
      )
    },
    returns: t(
      'A new branch with the ordered offset step; explain reports client work when not natively supported.',
      '返回追加有序偏移步骤的新分支；无法原生支持时由 explain 报告客户端工作。'
    ),
    example: 'const rows = await query.skip(20).limit(10).all()'
  },
  after: {
    summary: t(
      'Resume strictly after an opaque keyset anchor produced by a compatible page operation.',
      '使用兼容分页操作产生的不透明键集锚点，从锚点之后继续读取结果。'
    ),
    params: {
      cursor: t(
        'The next value returned by page() for the same source and compatible conditions/order; never serialize or forge it.',
        '来自相同来源且条件与排序兼容的 page() 返回值 next；不得序列化或自行伪造。'
      )
    },
    returns: t(
      'A new query branch with the validated continuation anchor; incompatible cursors reject before reading.',
      '返回带已校验续读锚点的新查询分支；不兼容的游标会在读取前拒绝。'
    ),
    example:
      'const page = await query.page(10)\nif (page.next) console.log(await query.after(page.next).all())'
  }
}

/** Mutations run through the original backend write pipeline and count accepted distinct drafts. */
const queryDeleteMember: IMemberDoc = {
  summary: t(
    'Delete distinct rows selected by the complete query inside the original backend write transaction.',
    '在原后端写事务中，删除由完整查询选中的去重结果行。'
  ),
  params: {
    ctx: t(
      'Caller operation context and optional original concurrency policy; transaction-bound queries accept only undefined and inherit their scope.',
      '调用方操作上下文及可选原并发策略；绑定事务的查询仅接受 undefined，并继承原作用域。'
    )
  },
  returns: t(
    'The number of distinct selected drafts accepted for deletion; a root call waits for native commit confirmation.',
    '返回已接纳删除的去重选中草稿数量；根调用等待原生提交确认。'
  ),
  example: 'const removed = await query.where({ archived: true }).delete()'
}

/** Selector ordering compares canonical storage keys and uses original primary keys for ties. */
const queryOrderMember: IMemberDoc = {
  summary: t(
    'Append a canonical storage-key selector ordering with deterministic primary-key tie breaking.',
    '追加规范存储键选择器排序，并以原主键确定相同排序值的先后。'
  ),
  params: {
    selector: t(
      'Caller function mapping a row to an IStorageKey; retain the canonical supported key domain.',
      '调用方把结果行映射为 IStorageKey 的函数，返回值须符合规范支持的键值域。'
    ),
    direction: t(
      'Caller choice asc or desc; omitted defaults to ascending order for this selector.',
      '调用方选择 asc 或 desc；省略时该选择器默认按升序排列。'
    )
  },
  returns: t(
    'A new selector-ordered branch preserving original Feature methods; comparator ordering is no longer available.',
    '返回保留原 Feature 方法的选择器排序分支，不再提供比较器排序转换。'
  ),
  example: "const ordered = query.orderBy((row) => row.id, 'asc')"
}

/** All ordinary record families compose the same documented terminals and controls. */
const recordQueryMembers: Readonly<Record<string, IMemberDoc>> = {
  ...queryChainMembers,
  ...queryStatisticsMembers,
  ...queryBoundsMembers,
  page: queryPageMember,
  delete: queryDeleteMember,
  update: {
    summary: t(
      'Apply one detached partial-record patch to distinct query-selected rows through the original transaction.',
      '通过原事务，对查询选中的去重记录应用一次分离后的部分字段补丁。'
    ),
    params: {
      patch: t(
        'Caller partial record whose fields replace corresponding fields of selected rows; the original backend codec validates values.',
        '调用方提供的部分记录，字段替换选中行中的对应字段；值由原后端编解码器验证。'
      ),
      ctx: queryDeleteMember.params!.ctx!
    },
    returns: t(
      'The number of distinct selected drafts accepted for update, after native root commit confirmation.',
      '原生根提交确认后，返回已接纳更新的去重选中草稿数量。'
    ),
    example: "const updated = await query.where({ status: 'pending' }).update({ status: 'paid' })"
  }
}

/** Pre-ranking vector controls are also available after a finite topK bound has been declared. */
const vectorControlMembers: Readonly<Record<string, IMemberDoc>> = {
  where: {
    ...queryChainMembers.where!,
    summary: t(
      'Filter payload fields before ranking when natively translatable; client predicates filter original topK hits without refilling them.',
      '可原生翻译的 payload 条件在排名前过滤；客户端谓词仅过滤原 topK 命中，不补取其它结果。'
    ),
    example: 'const enabled = builder.where({ enabled: true }).topK(5)'
  },
  requirePushdown: queryChainMembers.requirePushdown!,
  topK: {
    summary: t(
      'Declare or refine the native ranking bound, enabling read terminals only after this finite bound exists.',
      '声明或细化原生排名上限，只有存在该有限边界后才提供读取终点。'
    ),
    params: {
      count: t(
        'Caller-selected positive safe integer limiting original native ranked hits before client post-processing.',
        '调用方选择的正安全整数，在客户端后处理之前限制原生排名命中数量。'
      )
    },
    returns: t(
      'A bounded vector query retaining payload inference, vector-return state and original Feature methods.',
      '返回保留 payload 推导、向量返回状态及原 Feature 方法的有界向量查询。'
    ),
    example: 'const hits = await builder.topK(5).all()'
  },
  minScore: {
    summary: t(
      'Declare the final finite score threshold passed to the original native ranking operation.',
      '声明传递给原生排名操作的最终有限分数阈值，不自行改写原生分数。'
    ),
    params: {
      score: t(
        'Caller-selected finite numeric threshold in the selected engine’s native score domain.',
        '调用方选择的有限数值阈值，使用所选引擎的原生分数值域。'
      )
    },
    returns: t(
      'A new vector branch retaining its current bounded or pre-topK state.',
      '返回保留当前有界状态或 topK 前状态的新向量分支。'
    ),
    example: 'const hits = await builder.minScore(0.5).topK(5).all()'
  },
  withVector: {
    summary: t(
      'Request vectors from the native engine and include vector in the inferred hit type.',
      '请求原生引擎返回向量，同时在推导的命中类型中加入 vector 字段。'
    ),
    returns: t(
      'A new vector branch whose hits carry readonly numeric vectors; original payload and Feature types remain intact.',
      '返回命中包含只读数值向量的新分支，保留原 payload 和 Feature 类型。'
    ),
    example: 'const hits = await builder.withVector().topK(5).all()\nconsole.log(hits[0]?.vector)'
  }
}

/** Bounded vector examples address hit fields for projection and payload fields for conditions. */
const vectorQueryMembers: Readonly<Record<string, IMemberDoc>> = {
  ...queryChainMembers,
  ...vectorControlMembers,
  select: {
    ...queryChainMembers.select!,
    example: "const scores = await query.select('id', 'score').all()"
  },
  distinct: {
    ...queryChainMembers.distinct!,
    example: "const ids = await query.distinct('id').all()"
  },
  rerank: storageVectorRerankMember,
  delete: queryDeleteMember
}

/** RDF traversal remains grounded in the original matcher and preserves same-graph semantics. */
const rdfQueryMembers: Readonly<Record<string, IMemberDoc>> = {
  ...queryChainMembers,
  ...queryStatisticsMembers,
  ...queryBoundsMembers,
  where: {
    ...queryChainMembers.where!,
    example: "const named = query.where((quad) => quad.object.termType === 'NamedNode')"
  },
  select: {
    ...queryChainMembers.select!,
    example: "const bindings = await query.select('subject', 'object').all()"
  },
  distinct: {
    ...queryChainMembers.distinct!,
    example: "const subjects = await query.distinct('subject').all()"
  },
  pluck: { ...queryReadMembers.pluck!, example: "const subjects = await query.pluck('subject')" },
  min: {
    ...queryStatisticsMembers.min!,
    example:
      "const minimum = await query.select((quad) => ({ length: quad.subject.value.length })).min('length')"
  },
  max: {
    ...queryStatisticsMembers.max!,
    example:
      "const maximum = await query.select((quad) => ({ length: quad.subject.value.length })).max('length')"
  },
  sum: {
    ...queryStatisticsMembers.sum!,
    example:
      "const sum = await query.select((quad) => ({ length: quad.subject.value.length })).sum('length')"
  },
  avg: {
    ...queryStatisticsMembers.avg!,
    example:
      "const average = await query.select((quad) => ({ length: quad.subject.value.length })).avg('length')"
  },
  page: queryPageMember,
  orderBy: {
    ...queryOrderMember,
    example: "const ordered = query.orderBy((quad) => quad.subject.value, 'asc')"
  },
  delete: { ...queryDeleteMember, example: 'const removed = await query.delete()' },
  follow: {
    summary: t(
      'Follow each current ground quad’s object as the next subject in the same graph.',
      '把当前 ground quad 的对象作为后续主语，在相同 graph 中继续匹配。'
    ),
    params: {
      predicate: t(
        'Caller-created named-node predicate, normally obtained from term.iri(), for the next ground match.',
        '调用方创建的具名节点谓词，通常来自 term.iri()，用于后续 ground 匹配。'
      ),
      target: t(
        'Optional caller-created named-node target constraining the next object; omitted leaves that object unbound.',
        '调用方创建的可选具名节点目标，用于限制后续对象；省略时该对象不受此约束。'
      )
    },
    returns: t(
      'A new RDF query branch; the original matcher owns child cursors and closes them before the root cursor.',
      '返回新的 RDF 查询分支；原匹配器持有子游标，并在根游标之前关闭它们。'
    ),
    example: "const next = query.follow(term.iri('urn:knows'), term.iri('urn:c'))"
  },
  inverse: {
    summary: t(
      'Append a reverse ground predicate traversal using the original matcher in the same graph.',
      '使用原匹配器在相同 graph 中追加反向 ground 谓词遍历步骤。'
    ),
    params: {
      predicate: t(
        'Caller-created named-node predicate, normally from term.iri(), selecting the reverse relation.',
        '调用方创建的具名节点谓词，通常来自 term.iri()，指定需要反向遍历的关系。'
      )
    },
    returns: t(
      'A new RDF branch with an ordered inverse step; execution retains the original matcher and cleanup owner.',
      '返回追加有序反向步骤的新 RDF 分支，执行仍使用原匹配器和清理归属。'
    ),
    example: "const previous = query.inverse(term.iri('urn:knows'))"
  },
  replace: {
    summary: t(
      'Replace only the canonical old ground quad selected by this query through the original write transaction.',
      '通过原写事务，仅替换被本查询选中的规范旧 ground quad。'
    ),
    params: {
      oldQuad: t(
        'Caller-supplied complete ground quad that must equal the canonical selected old value.',
        '调用方提供的完整 ground quad，必须与选中的规范旧值相等。'
      ),
      newQuad: t(
        'Caller-supplied complete replacement ground quad; RDF terms are validated by the canonical codec.',
        '调用方提供的完整替换 ground quad，由规范编解码器验证 RDF 词项。'
      ),
      ctx: queryDeleteMember.params!.ctx!
    },
    returns: t(
      'The number of distinct selected old drafts accepted for replacement after original native commit confirmation.',
      '原生提交确认后，返回已接纳替换的去重选中旧草稿数量。'
    ),
    example: 'const replaced = await query.replace(oldQuad, newQuad)'
  }
}

/** Complete bilingual contract reference; implementations remain external consumers. */
export const storageContractReference: ILibraryReference = {
  modules: {
    conformance: {
      summary: t(
        'Consumer-run storage conformance. Import runConformance and pass the existing runner plus a fresh fixture factory and complete capability manifest.',
        '由消费者 runner 执行的存储一致性套件。导入 runConformance，传入现有 runner、新 fixture 工厂与完整能力清单。'
      ),
      example: storageContractCases.runConformance![0]!.example
    },
    index: {
      summary: t(
        'Runtime-neutral storage shapes, capability narrowing, key validation, codecs, operation contexts and errors. Start with `IKeyValueStore` for an injected backend, use `asRecordStore()` when structured storage is required, or `snapshotCodec()` at a codec admission boundary. This package opens no database.',
        '提供运行时无关的存储结构、能力收窄、键校验、编解码器、操作上下文和错误。注入后端从 `IKeyValueStore` 开始，需要结构化存储时用 `asRecordStore()`，编解码器接纳边界用 `snapshotCodec()`；本包不打开数据库。'
      ),
      example: storeExample
    }
  },
  symbols: {
    runConformance: {
      role: 'operation',
      purpose: t(
        'Register all declared standard-token and Boolean behavior groups without acquiring a runner, host or driver dependency. Every case validates the complete manifest and finally disposes its original fixture; primary and cleanup failures remain reachable. Invalid-input assertions observe both synchronous native throws and Promise rejection without changing the required original semantic code.',
        '登记声明的标准 token 与布尔行为组，不依赖 runner、host 或 driver。每例核对完整清单并 finally 释放原 fixture，主体与清理错误均可追踪。输入错误断言同时观察原生同步抛错与Promise拒绝，仍要求原语义码。'
      ),
      params: {
        harness: t(
          'Original describe/it/expect registration and matchers. Notification waiting uses only this runner’s case timeout.',
          '原 describe/it/expect 与 matcher；通知等待仅沿该 runner 的 case 超时。'
        ),
        subject: t(
          'Name, independent create factory, complete authentic capability list and full features snapshot, plus optional prepareSecondaryIndexes(originalStore, originalHandle) calling only the native backfill owner. It may return the original record-key projection for fixture ids; complete readiness remains required. KV is selected by kv token; pure vector/SQL subjects need none.',
          '名称、独立 create 工厂、完整真实 token 清单与全量 features 快照；可选 prepareSecondaryIndexes(originalStore, originalHandle) 只调用原生 backfill 拥有者，可返回原record-key投影供fixture id使用，仍须complete就绪。KV 由 kv token 选择；纯 vector/SQL 无需 KV。'
        )
      },
      example: storageContractCases.runConformance![0]!.example,
      cases: storageContractCases.runConformance
    },
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
        '通过规范项拥有者校验并独立复制结构化原始项，保留响应局部空白项的原适用范围。'
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
        '只捕获调用方给定的规范四元组位置，省略的图保持不受约束，供原查询源匹配。'
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
        '在原生身份编码或写入前捕获四个完整规范位置，统一校验项类型、语言和数据类型。'
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
    encodeStorageRdfTerm: {
      role: 'operation',
      purpose: t(
        'Encode a canonical raw RDF term for native ordered index components using the original key writer.',
        '沿原键写入器编码规范原始项，作为原生索引的自定界分量，保留项类型与精确文字身份。'
      ),
      params: {
        value: t(
          'Structural raw term admitted by snapshotStorageRdfTerm; blank labels remain request-local.',
          'snapshotStorageRdfTerm 接纳的结构 raw term，blank 标签仍局限请求。'
        ),
        backend: t(
          'Optional diagnostic backend supplied explicitly as a name or undefined.',
          '显式传入后端名或 undefined，供可选诊断使用。'
        )
      },
      returns: t(
        'Independent self-delimiting Uint8Array. Native indexes concatenate components directly without the public binary-key limit; malformed terms throw INVALID_ARGUMENT with original getter cause.',
        '独立、自定界 Uint8Array。原生索引直接拼接分量，不施加公开 binary-key 限制；无效 term 抛 INVALID_ARGUMENT 并保留原 getter cause。'
      ),
      example: storageContractCases.encodeStorageRdfTerm![0]!.example,
      cases: storageContractCases.encodeStorageRdfTerm
    },
    encodeStorageRdfQuad: {
      role: 'operation',
      purpose: t(
        'Snapshot ground RDF identity and encode term boundaries with the original ordered-key writer.',
        '快照完整规范四元组身份，再由原保序键写入器编码项边界，保留文字与图的身份规则。'
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
    decodeOrderedStorageKey: {
      role: 'operation',
      purpose: t(
        'Read the original ordered physical key wire format.',
        '按原规范保序字节格式还原独立逻辑键，拒绝不完整、非规范或超出键域的输入。'
      ),
      params: {
        encoded: t(
          'Complete canonical key bytes from encodeOrderedStorageKey.',
          'encodeOrderedStorageKey 返回的完整规范键字节。'
        ),
        backend: t('Actual backend diagnostic or undefined.', '真实后端标签或 undefined。')
      },
      returns: t(
        'Detached IStorageKey; incomplete, noncanonical or out-of-domain bytes throw INVALID_KEY.',
        '独立 IStorageKey；不完整、非规范或超域字节抛 INVALID_KEY。'
      ),
      example: storageContractCases.decodeOrderedStorageKey![0]!.example,
      cases: storageContractCases.decodeOrderedStorageKey
    },
    snapshotStorageVectorCollection: {
      role: 'operation',
      optionDocs: {
        dimensions: {
          summary: t(
            'Positive safe integer dimension; a provided vector must have exactly this many components.',
            '正安全整数维度，已给定向量必须具有精确相同的分量数量。'
          ),
          example:
            "import { snapshotStorageVectorCollection } from '@migaia/storage-contract'\nconst schema = snapshotStorageVectorCollection('docs', {\n  dimensions: 2, metric: 'cosine'\n})"
        },
        metric: {
          summary: t(
            'Exact native metric fact used for validation, not a request to create or change a collection.',
            '用于校验的精确原生度量事实，真实集合的创建或修改仍由原生拥有者负责。'
          ),
          values: {
            cosine: t(
              'Cosine direction; reject a zero vector when this fact is supplied.',
              '余弦方向度量，提供此事实时拒绝零向量。'
            ),
            dot: t('Native dot-product metric.', '使用原生点积度量。'),
            euclid: t('Native Euclidean-distance metric.', '使用原生欧氏距离度量。')
          },
          whenToUse: t(
            'Match the schema supplied by the actual native collection.',
            '选择与实际原生集合提供的模式一致的度量。'
          ),
          example:
            "import { snapshotStorageVectorCollection } from '@migaia/storage-contract'\nconst schema = snapshotStorageVectorCollection('docs', {\n  dimensions: 2, metric: 'cosine'\n})"
        }
      },
      purpose: t(
        'Capture a collection name and optional declared configuration.',
        '捕获逻辑集合名称与可选完整模式，省略配置时保持未指定，真实模式仍由原生集合提供。'
      ),
      params: {
        name: t('Application-selected logical collection name.', '应用选定的逻辑向量集合名称。'),
        options: t(
          'Optional positive dimensions and cosine/dot/euclid metric; omission stays absent.',
          '可选正维度与 cosine/dot/euclid metric；省略仍缺省。'
        ),
        backend: t('Optional native diagnostic label.', '可选原生诊断标签。')
      },
      returns: t(
        'Detached input; INVALID_ARGUMENT preserves the original cause.',
        '独立输入；INVALID_ARGUMENT 保留原始 cause。'
      ),
      example: storageContractCases.snapshotStorageVectorCollection![0]!.example,
      cases: storageContractCases.snapshotStorageVectorCollection
    },
    snapshotStorageVector: {
      role: 'operation',
      optionDocs: {
        dimensions: {
          summary: t(
            'Positive safe integer dimension; a provided vector must have exactly this many components.',
            '正安全整数维度，已给定向量必须具有精确相同的分量数量。'
          ),
          default: t(
            'Omission captures finite dense components without a dimension comparison.',
            '省略时捕获有限稠密分量，不比较具体维度。'
          ),
          example:
            "import { snapshotStorageVector } from '@migaia/storage-contract'\nconst direction = snapshotStorageVector([1, 0], { dimensions: 2, metric: 'cosine' })"
        },
        metric: {
          summary: t(
            'Exact native metric fact used for validation, not a request to create or change a collection.',
            '用于校验的精确原生度量事实，真实集合的创建或修改仍由原生拥有者负责。'
          ),
          default: t('No metric-specific validation when omitted.', '省略时不进行度量专属校验。'),
          values: {
            cosine: t(
              'Cosine direction; reject a zero vector when this fact is supplied.',
              '余弦方向度量，提供此事实时拒绝零向量。'
            ),
            dot: t('Native dot-product metric.', '使用原生点积度量。'),
            euclid: t('Native Euclidean-distance metric.', '使用原生欧氏距离度量。')
          },
          whenToUse: t(
            'Match the schema supplied by the actual native collection.',
            '选择与实际原生集合提供的模式一致的度量。'
          ),
          example:
            "import { snapshotStorageVector } from '@migaia/storage-contract'\nconst direction = snapshotStorageVector([1, 0], { dimensions: 2, metric: 'cosine' })"
        }
      },
      purpose: t(
        'Detach finite dense components under optional dimension and metric facts.',
        '依可选维度与度量事实独立捕获有限稠密分量，已知余弦模式同时拒绝零向量。'
      ),
      params: {
        input: t('Readonly numeric component array.', '只读数字分量数组。'),
        options: t(
          'Optional dimensions/metric; cosine rejects zero vectors.',
          '可选 dimensions/metric；cosine 拒绝零向量。'
        ),
        backend: t('Optional native diagnostic label.', '可选原生诊断标签。')
      },
      returns: t(
        'Detached input; INVALID_ARGUMENT preserves the original cause.',
        '独立输入；INVALID_ARGUMENT 保留原始 cause。'
      ),
      example: storageContractCases.snapshotStorageVector![0]!.example,
      cases: storageContractCases.snapshotStorageVector
    },
    snapshotStorageVectorUpsert: {
      role: 'operation',
      purpose: t(
        'Prevalidate a complete point batch using the serialize payload owner.',
        '沿原便携负载与向量输入拥有者预校验完整点批次，重复标识保留最后一次给定的值。'
      ),
      params: {
        points: t(
          'Readonly points; every input is checked and duplicate IDs keep the last value.',
          '只读点；全部输入逐项校验，重复 ID 保留末值。'
        ),
        configuration: t(
          'Optional existing dimensions and metric. Omission captures finite components and portable payloads only; validate the detached vectors against the actual native schema before writing.',
          '可选已有维度与 metric。省略时仅捕获有限分量与便携 payload；写入前再按真实原生 schema 校验脱离的向量。'
        ),
        backend: t('Optional native diagnostic label.', '可选原生诊断标签。')
      },
      returns: t(
        'Detached input; INVALID_ARGUMENT preserves the original cause.',
        '独立输入；INVALID_ARGUMENT 保留原始 cause。'
      ),
      example: storageContractCases.snapshotStorageVectorUpsert![0]!.example,
      cases: storageContractCases.snapshotStorageVectorUpsert
    },
    snapshotStorageVectorFilter: {
      role: 'operation',
      purpose: t(
        'Snapshot a closed native vector filter AST without executing it.',
        '捕获封闭原生向量过滤语法树，统一检查逻辑组合、自有字段路径与有限标量边界。'
      ),
      params: {
        filter: t(
          'Own-path all/any/not, scalar equality, membership or finite numeric bounds.',
          '自有路径 all/any/not、标量相等、成员或有限数值边界。'
        ),
        backend: t('Optional native diagnostic label.', '可选原生诊断标签。')
      },
      returns: t(
        'Detached input; INVALID_ARGUMENT preserves the original cause.',
        '独立输入；INVALID_ARGUMENT 保留原始 cause。'
      ),
      example: storageContractCases.snapshotStorageVectorFilter![0]!.example,
      cases: storageContractCases.snapshotStorageVectorFilter
    },
    snapshotStorageVectorIds: {
      role: 'operation',
      purpose: t(
        'Capture dense string IDs once, preserving duplicates unless explicitly rejected.',
        '一次捕获稠密字符串 ID，默认保留重复，可显式拒绝。'
      ),
      params: {
        ids: t('Dense string array.', '稠密字符串数组。'),
        backend: t('Optional diagnostic backend.', '可选诊断后端。'),
        rejectDuplicates: t(
          'Reject duplicates when true; defaults false.',
          '为 true 时拒绝等价重复标识，缺省保留重复输入。'
        )
      },
      returns: t('Frozen ordered string array.', '冻结的有序字符串数组。'),
      example: storageContractCases.snapshotStorageVectorIds![0]!.example,
      cases: storageContractCases.snapshotStorageVectorIds
    },
    snapshotStorageDeleteCountMode: {
      role: 'operation',
      purpose: t(
        'Validate precount/scroll and resolve omission to precount without native I/O.',
        '校验条件删除计数模式，并将省略值解析为预计数；原生删除仍由所属后端执行。'
      ),
      params: {
        value: t(
          'precount, scroll or undefined.',
          '调用方选择 precount 预计数或 scroll 滚动收集，undefined 使用缺省模式。'
        ),
        backend: t('Optional diagnostic backend.', '可选诊断后端。')
      },
      returns: t(
        'Declared mode; omission defaults to precount.',
        '声明的模式；省略时默认 precount。'
      ),
      example: storageContractCases.snapshotStorageDeleteCountMode![0]!.example,
      cases: storageContractCases.snapshotStorageDeleteCountMode
    },
    snapshotStorageVectorSearch: {
      role: 'operation',
      purpose: t(
        'Capture direct-search arguments even for k=0 before native retrieval.',
        '在原生检索前完整捕获查询方向、数量与过滤参数，零结果请求仍执行相同输入校验。'
      ),
      params: {
        query: t(
          'Finite numeric query direction matching the collection.',
          '匹配 collection 的有限数字查询方向。'
        ),
        options: t(
          'Nonnegative safe k, optional filter/withPayload/exact; booleans default false.',
          '非负安全 k、可选 filter/withPayload/exact；布尔缺省 false。'
        ),
        configuration: t(
          'Optional existing schema. Omission snapshots the complete finite query/options/filter; validate the detached query against actual native dimensions and metric before searching.',
          '可选已有 schema。省略时完整捕获有限 query/options/filter；检索前按真实原生维度与 metric 校验脱离的 query。'
        ),
        backend: t('Optional native diagnostic label.', '可选原生诊断标签。')
      },
      returns: t(
        'Detached input; INVALID_ARGUMENT preserves the original cause.',
        '独立输入；INVALID_ARGUMENT 保留原始 cause。'
      ),
      example: storageContractCases.snapshotStorageVectorSearch![0]!.example,
      cases: storageContractCases.snapshotStorageVectorSearch
    },
    snapshotStorageBlobPut: {
      role: 'operation',
      purpose: t(
        'Detach upload bytes, metadata and conditions before native work.',
        '在原生工作前独立捕获上传字节、元数据与条件。'
      ),
      params: {
        key: t('Logical object string key.', '逻辑对象字符串键。'),
        body: t(
          'Uint8Array or unlocked WHATWG byte stream; admission never takes its reader.',
          'Uint8Array 或未锁定 WHATWG 字节流；准入不取得 reader。'
        ),
        options: t(
          'Optional contentType, string metadata, mutually exclusive conditions and operation context.',
          '可选 contentType、字符串 metadata、互斥条件与操作上下文。'
        ),
        backend: t('Actual backend label or undefined.', '真实后端标签或 undefined。')
      },
      returns: t(
        'Frozen input snapshot; malformed fields throw INVALID_ARGUMENT with the original cause.',
        '冻结输入快照；非法字段抛 INVALID_ARGUMENT 并保留原始 cause。'
      ),
      example: storageContractCases.snapshotStorageBlobPut![0]!.example,
      cases: storageContractCases.snapshotStorageBlobPut
    },
    snapshotStorageBlobGet: {
      role: 'operation',
      purpose: t(
        'Capture inclusive range bounds before opening object content.',
        '打开原生对象内容前捕获键与闭区间范围，统一校验安全整数端点与原调用上下文。'
      ),
      params: {
        key: t('Logical object string key.', '逻辑对象字符串键。'),
        options: t(
          'Optional safe-integer range with nonnegative start and end at least start, and context.',
          '可选安全整数范围，start 非负且 end 不小于 start，以及上下文。'
        ),
        backend: t('Actual backend label or undefined.', '真实后端标签或 undefined。')
      },
      returns: t(
        'Frozen key/options snapshot; no I/O or body reader.',
        '冻结键与选项快照；不进行 I/O 或取得 body reader。'
      ),
      example: storageContractCases.snapshotStorageBlobGet![0]!.example,
      cases: storageContractCases.snapshotStorageBlobGet
    },
    snapshotStorageBlobList: {
      role: 'operation',
      purpose: t(
        'Capture the shared bounded object-page request.',
        '捕获有界原生对象分页请求，保留不透明游标并应用相同前缀、页量与上下文校验。'
      ),
      params: {
        options: t(
          'Optional string prefix and cursor, with positive safe-integer limit defaulting to 100.',
          '可选字符串前缀和游标，limit 为正安全整数，默认 100。'
        ),
        ctx: t(
          'Optional operation context captured by its original owner.',
          '由原拥有者捕获的可选操作上下文。'
        ),
        backend: t('Actual backend label or undefined.', '真实后端标签或 undefined。')
      },
      returns: t(
        'Frozen prefix, after, limit and context; malformed input throws INVALID_ARGUMENT.',
        '冻结 prefix、after、limit 与上下文；非法输入抛 INVALID_ARGUMENT。'
      ),
      example: storageContractCases.snapshotStorageBlobList![0]!.example,
      cases: storageContractCases.snapshotStorageBlobList
    },
    createStorageBlobBodyReader: {
      role: 'operation',
      optionDocs: {
        report: {
          summary: t(
            'Observe cleanup failures through the original backend reporter; reporting does not grant storage control.',
            '通过所属后端的原报告函数观察清理失败，该接点不授予存储控制权。'
          ),
          whenToUse: t(
            'Connect the original report-only symbolic cleanup path.',
            '连接原符号清理的只报告路径。'
          ),
          example: storageContractCases.blobBodyAuthor![0]!.example,
          params: {
            error: t(
              'Original cleanup error, including failed symbolic disposal.',
              '原清理错误，包含符号释放失败。'
            )
          },
          returns: t(
            'The symbolic cleanup Promise adopts the callback result; the original reporter should finish successfully.',
            '符号清理承诺采用回调结果，原报告器应成功完成自身工作。'
          )
        },
        backend: {
          summary: t(
            'Actual backend diagnostic label captured from the original native store.',
            '从原生存储取得的实际后端诊断标签，用于标注所属实现。'
          ),
          default: t(
            'Undefined leaves the diagnostic backend absent.',
            '省略时不附加后端诊断名称。'
          ),
          example: storageContractCases.blobBodyAuthor![0]!.example
        },
        normalizeFailure: {
          summary: t(
            'Classify native read, cancellation or close failures while keeping the original cause and runtime type reachable.',
            '分类原生读取、取消或关闭失败，并使原始原因与运行时类型继续可追踪。'
          ),
          default: t('Identity: return the original thrown value.', '缺省直接返回原抛出值。'),
          whenToUse: t(
            'Pass the owning backend’s registered failure normalizer.',
            '传入所属后端已登记的失败规范化函数。'
          ),
          example: storageContractCases.blobBodyAuthor![0]!.example,
          params: { error: t('Original native thrown value.', '原生最初抛出的值。') },
          returns: t(
            'The backend-classified failure retaining the original cause.',
            '返回后端分类且保留原始原因的失败值。'
          )
        }
      },
      purpose: t(
        'Read detached upload chunks through the original iterator lifetime after native condition admission.',
        '原生条件通过后，沿原迭代器生命周期按需读取独立上传字节块，缓冲与写入归原后端。'
      ),
      params: {
        body: t(
          'Admitted bytes or an unclaimed WHATWG byte stream.',
          '已准入字节或尚未取用的 WHATWG 字节流。'
        ),
        options: t(
          'Original backend report and optional backend/normalizeFailure. Caller retains abort and native sink ownership.',
          '原 backend report 与可选 backend/normalizeFailure；取消和 native sink 仍归调用方。'
        )
      },
      returns: t(
        'IStorageIterator<Uint8Array>; unfinished disposal cancels before read drain and releases once. Main and symbolic cleanup retain distinct cached promises.',
        'IStorageIterator<Uint8Array>；提前释放先取消再排空 read，只 release 一次。主与符号清理保留独立缓存 Promise。'
      ),
      example: storageContractCases.createStorageBlobBodyReader![0]!.example,
      cases: storageContractCases.createStorageBlobBodyReader
    },
    createStorageBlobObject: {
      role: 'operation',
      optionDocs: {
        close: {
          summary: t(
            'Release the already-owned native resource after all accepted advances have settled.',
            '在全部已接纳推进结算之后释放后端已经持有的原生资源。'
          ),
          whenToUse: t(
            'Supply the existing native close operation when constructing this lifetime.',
            '创建生命周期时提供现有原生关闭操作。'
          ),
          example: storageContractCases.blobObjectAuthor![0]!.example,
          returns: t(
            'Awaited completion of native release; a failure remains observable on main disposal.',
            '等待原生释放完成，失败可通过主释放承诺观察。'
          )
        },
        report: {
          summary: t(
            'Observe cleanup failures through the original backend reporter; reporting does not grant storage control.',
            '通过所属后端的原报告函数观察清理失败，该接点不授予存储控制权。'
          ),
          whenToUse: t(
            'Connect the original report-only symbolic cleanup path.',
            '连接原符号清理的只报告路径。'
          ),
          example: storageContractCases.blobObjectAuthor![0]!.example,
          params: {
            error: t(
              'Original cleanup error, including failed symbolic disposal.',
              '原清理错误，包含符号释放失败。'
            )
          },
          returns: t(
            'The symbolic cleanup Promise adopts the callback result; the original reporter should finish successfully.',
            '符号清理承诺采用回调结果，原报告器应成功完成自身工作。'
          )
        },
        backend: {
          summary: t(
            'Actual backend diagnostic label captured from the original native store.',
            '从原生存储取得的实际后端诊断标签，用于标注所属实现。'
          ),
          default: t(
            'Undefined leaves the diagnostic backend absent.',
            '省略时不附加后端诊断名称。'
          ),
          example: storageContractCases.blobObjectAuthor![0]!.example
        },
        onSettled: {
          summary: t(
            'Synchronous native bookkeeping when shared cleanup settles, whether it fulfills or rejects.',
            '共享清理成功或拒绝结算时执行原生同步记账，保留原拥有者的资源登记。'
          ),
          default: t('No additional settlement callback.', '省略时不调用额外结算回调。'),
          whenToUse: t(
            'Release the original owner’s cursor registration after resource settlement.',
            '资源结算后清除原拥有者的游标登记时使用。'
          ),
          example: storageContractCases.blobObjectAuthor![0]!.example,
          returns: t(
            'No result; the original owner supplies a nonthrowing bookkeeping callback.',
            '无结果，由原拥有者提供不会抛错的记账回调。'
          )
        },
        normalizeFailure: {
          summary: t(
            'Classify native read, cancellation or close failures while keeping the original cause and runtime type reachable.',
            '分类原生读取、取消或关闭失败，并使原始原因与运行时类型继续可追踪。'
          ),
          default: t('Identity: return the original thrown value.', '缺省直接返回原抛出值。'),
          whenToUse: t(
            'Pass the owning backend’s registered failure normalizer.',
            '传入所属后端已登记的失败规范化函数。'
          ),
          example: storageContractCases.blobObjectAuthor![0]!.example,
          params: { error: t('Original native thrown value.', '原生最初抛出的值。') },
          returns: t(
            'The backend-classified failure retaining the original cause.',
            '返回后端分类且保留原始原因的失败值。'
          )
        }
      },
      purpose: t(
        'Give one native object snapshot one stream-or-bytes right and original resource cleanup.',
        '为一个原生对象快照提供一次 stream 或 bytes 权限及原资源清理。'
      ),
      params: {
        info: t(
          'Metadata belonging to the same native content snapshot.',
          '与原生内容快照相同对象的元数据。'
        ),
        source: t('The already-open native WHATWG byte stream.', '已打开的原生 WHATWG 字节流。'),
        options: t(
          'Native close, report, optional backend/onSettled, and optional normalizeFailure for backend-owned native error classification.',
          '原生 close、report、可选 backend/onSettled，以及供后端分类原生错误的 normalizeFailure。'
        )
      },
      returns: t(
        'IBlobObject; EOF/cancel/dispose share native cleanup. Main cleanup rejects, separate symbolic cleanup reports; second consumption throws INVALID_ARGUMENT.',
        'IBlobObject；EOF、cancel、dispose 共享原生清理。主清理拒绝，独立符号清理报告；第二次消费抛 INVALID_ARGUMENT。'
      ),
      example: storageContractCases.createStorageBlobObject![0]!.example,
      cases: storageContractCases.createStorageBlobObject
    },
    createStorageBatchKeyCapture: {
      role: 'operation',
      purpose: t(
        'Capture native batch keys in the backend’s existing per-entry getter and failure order.',
        '依后端原有逐项捕获次序记录规范键身份，保留重复键的首次位置供原校验点使用。'
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
        '实际物理通道期限能力的精确标准令牌，到期、持久化与剩余期限查询均沿原后端兑现。'
      ),
      example: storageContractCases.ttl![0]!.example,
      cases: storageContractCases.ttl
    },
    sql: {
      role: 'constant',
      purpose: t(
        'Exact standard token for a nested native SQL executor.',
        '嵌套原生关系查询能力的精确标准令牌，语句与值由共享片段拥有者准备，实际执行归原后端。'
      ),
      example: storageContractCases.sql![0]!.example,
      cases: storageContractCases.sql
    },
    blob: {
      role: 'constant',
      purpose: t(
        'Exact standard token for independent native byte objects.',
        '独立原生字节对象能力的精确标准令牌，实际内容读取、条件写入与释放均由后端实现。'
      ),
      example: storageContractCases.blob![0]!.example,
      cases: storageContractCases.blob
    },
    durableChangeFeed: {
      role: 'constant',
      purpose: t(
        'Exact optional token for native durable replay and tails.',
        '原生持久变更流的精确可选令牌，历史重放、游标确认和实时尾流均沿所属后端执行。'
      ),
      example: storageContractCases.durableChangeFeed![0]!.example,
      cases: storageContractCases.durableChangeFeed
    },
    sparql: {
      role: 'constant',
      purpose: t(
        'Exact native callable SPARQL capability, without a generic transaction projection.',
        '原生可调用查询能力的精确令牌，查询渲染与原生终端共用原端点，事务使用实际后端投影。'
      ),
      example: storageContractCases.sparql![0]!.example,
      cases: storageContractCases.sparql
    },
    sparqlFragment: {
      role: 'operation',
      purpose: t(
        'Capture validated RDF values and authentic pure fragment references.',
        '捕获已校验图项与真实纯片段引用，由共享渲染器转义参数后组合成原生查询语法。'
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
      optionDocs: {
        select: {
          summary: t(
            'Original native select callback; enter the existing operation owner before invoking prepare.',
            '原生 select 回调须先进入现有操作拥有者，再调用惰性准备函数生成文本。'
          ),
          whenToUse: t(
            'Bind the actual endpoint’s select terminal without another executor.',
            '绑定实际端点的 select 终端并保留原执行拥有者。'
          ),
          example: storageContractCases.createSparqlTag![0]!.example,
          params: {
            prepare: t(
              'Call after native admission to render the same captured query once.',
              '原生准入后调用，以同一已捕获查询准备文本。'
            ),
            ctx: t(
              'The unchanged optional caller operation context.',
              '原样传入的可选调用方操作上下文。'
            )
          },
          returns: t('The original Promise of native binding rows.', '原生绑定行数组的原承诺。')
        },
        ask: {
          summary: t(
            'Original native ask callback; enter the existing operation owner before invoking prepare.',
            '原生 ask 回调须先进入现有操作拥有者，再调用惰性准备函数生成文本。'
          ),
          whenToUse: t(
            'Bind the actual endpoint’s ask terminal without another executor.',
            '绑定实际端点的 ask 终端并保留原执行拥有者。'
          ),
          example: storageContractCases.createSparqlTag![0]!.example,
          params: {
            prepare: t(
              'Call after native admission to render the same captured query once.',
              '原生准入后调用，以同一已捕获查询准备文本。'
            ),
            ctx: t(
              'The unchanged optional caller operation context.',
              '原样传入的可选调用方操作上下文。'
            )
          },
          returns: t('The original Promise of the native boolean answer.', '原生布尔回答的原承诺。')
        },
        construct: {
          summary: t(
            'Original native construct callback; enter the existing operation owner before invoking prepare.',
            '原生 construct 回调须先进入现有操作拥有者，再调用惰性准备函数生成文本。'
          ),
          whenToUse: t(
            'Bind the actual endpoint’s construct terminal without another executor.',
            '绑定实际端点的 construct 终端并保留原执行拥有者。'
          ),
          example: storageContractCases.createSparqlTag![0]!.example,
          params: {
            prepare: t(
              'Call after native admission to render the same captured query once.',
              '原生准入后调用，以同一已捕获查询准备文本。'
            ),
            ctx: t(
              'The unchanged optional caller operation context.',
              '原样传入的可选调用方操作上下文。'
            )
          },
          returns: t(
            'The original Promise of raw response-local quads, including blank terms.',
            '原始响应局部四元组数组的原承诺，可含空白项。'
          )
        },
        update: {
          summary: t(
            'Original native update callback; enter the existing operation owner before invoking prepare.',
            '原生 update 回调须先进入现有操作拥有者，再调用惰性准备函数生成文本。'
          ),
          whenToUse: t(
            'Bind the actual endpoint’s update terminal without another executor.',
            '绑定实际端点的 update 终端并保留原执行拥有者。'
          ),
          example: storageContractCases.createSparqlTag![0]!.example,
          params: {
            prepare: t(
              'Call after native admission to render the same captured query once.',
              '原生准入后调用，以同一已捕获查询准备文本。'
            ),
            ctx: t(
              'The unchanged optional caller operation context.',
              '原样传入的可选调用方操作上下文。'
            )
          },
          returns: t(
            'The original Promise that settles native update execution.',
            '原生更新执行结算的原承诺。'
          )
        }
      },
      purpose: t(
        'Bind pure SPARQL nodes to original native callbacks after their actual admission.',
        '将纯查询节点接到原生回调，原后端先完成操作准入，再请求同一渲染器准备文本。'
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
        '原生向量集合能力的精确标准令牌，集合模式、检索排名与写入期限由实际后端持有。'
      ),
      example: storageContractCases.vector![0]!.example,
      cases: storageContractCases.vector
    },
    rdf: {
      role: 'constant',
      purpose: t(
        'Exact standard ground RDF capability and original transaction projection.',
        '规范四元组能力的精确标准令牌，根操作与事务投影均使用实际后端的原查询和写入拥有者。'
      ),
      example: storageContractCases.rdf![0]!.example,
      cases: storageContractCases.rdf
    },
    DeleteCountMode: {
      role: 'constant',
      purpose: t(
        'Precount or scroll strategy for native shared vector deletion counts.',
        '声明共享向量条件删除的预计数或滚动收集策略，具体计数及并发保证由后端兑现。'
      ),
      example: storageContractCases.DeleteCountMode![0]!.example,
      cases: storageContractCases.DeleteCountMode
    },
    counter: {
      role: 'constant',
      purpose: t(
        'Exact standard token for atomic canonical decimal text increments.',
        '原子十进制文本递增的精确标准令牌，安全整数校验与真实原子更新各沿原拥有者执行。'
      ),
      example: storageContractCases.counter![0]!.example,
      cases: storageContractCases.counter
    },
    snapshotStorageTtlTarget: {
      role: 'operation',
      purpose: t(
        'Capture TTL targets with the original physical lock-key validator.',
        '用原物理锁键校验器捕获实际期限目标，明确文本、字节、记录或向量所属通道。'
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
        '在原生期限操作开始前校验有限非负毫秒数，保留零值与小数的合法含义。'
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
        '原生操作前一次捕获独立批键与规范身份，保留读取位置并可在写入前拒绝等价重复键。'
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
        '通过规范键校验与写入器捕获类型化前缀，返回同一匹配规则及原生有序扫描边界。'
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
        '通过真实原事务视图读取唯一能力表的事务接口，实际终端继续进入同一事务准入和清理。'
      ),
      params: {
        scope: t(
          'Authentic live full scope with its precise admitted capability set; raw/frozen scopes are not modified.',
          '具备精确已接纳能力集合的真实活跃完整 scope；不修改 raw/frozen scope。'
        ),
        capability: t(
          'Authentic published transactional standard token with its original forTransaction binder.',
          '具备原 forTransaction 绑定的真实已发布事务标准令牌。'
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
      optionDocs: {
        dialect: {
          summary: t(
            'Native dialect determines placeholder numbering, identifier quoting and scanner restrictions.',
            '原生方言决定占位符编号、标识符引用与单语句扫描限制。'
          ),
          values: {
            sqlite: t(
              'Question-mark parameters and SQLite statement restrictions.',
              '问号参数与 SQLite 原语句限制。'
            ),
            postgres: t(
              'Numbered parameters and PostgreSQL statement restrictions.',
              '编号参数与 PostgreSQL 原语句限制。'
            )
          },
          whenToUse: t(
            'Use the original database dialect for every derived fragment.',
            '所有派生片段均使用原数据库方言时选择。'
          ),
          example: storageContractCases.createSqlTag![0]!.example
        },
        all: {
          summary: t(
            'Original native all callback; enter native admission before invoking prepare.',
            '原生 all 回调先进入实际操作准入，再调用惰性准备函数。'
          ),
          whenToUse: t(
            'Bind the real driver’s all terminal and preserve its returned Promise.',
            '绑定真实驱动的 all 终端并保留原返回承诺。'
          ),
          example: storageContractCases.createSqlTag![0]!.example,
          params: {
            prepare: t(
              'Return the captured statement text and original typed parameter values.',
              '返回已捕获语句文本与原类型参数值。'
            ),
            ctx: t(
              'Unchanged optional caller operation context.',
              '原样传入的可选调用方操作上下文。'
            )
          },
          returns: t('Original Promise of all native rows.', '全部原生结果行的原承诺。')
        },
        get: {
          summary: t(
            'Original native get callback; enter native admission before invoking prepare.',
            '原生 get 回调先进入实际操作准入，再调用惰性准备函数。'
          ),
          whenToUse: t(
            'Bind the real driver’s get terminal and preserve its returned Promise.',
            '绑定真实驱动的 get 终端并保留原返回承诺。'
          ),
          example: storageContractCases.createSqlTag![0]!.example,
          params: {
            prepare: t(
              'Return the captured statement text and original typed parameter values.',
              '返回已捕获语句文本与原类型参数值。'
            ),
            ctx: t(
              'Unchanged optional caller operation context.',
              '原样传入的可选调用方操作上下文。'
            )
          },
          returns: t(
            'Original Promise of the first native row or undefined.',
            '首条原生结果行或 undefined 的原承诺。'
          )
        },
        run: {
          summary: t(
            'Original native run callback; enter native admission before invoking prepare.',
            '原生 run 回调先进入实际操作准入，再调用惰性准备函数。'
          ),
          whenToUse: t(
            'Bind the real driver’s run terminal and preserve its returned Promise.',
            '绑定真实驱动的 run 终端并保留原返回承诺。'
          ),
          example: storageContractCases.createSqlTag![0]!.example,
          params: {
            prepare: t(
              'Return the captured statement text and original typed parameter values.',
              '返回已捕获语句文本与原类型参数值。'
            ),
            ctx: t(
              'Unchanged optional caller operation context.',
              '原样传入的可选调用方操作上下文。'
            )
          },
          returns: t(
            'Original Promise of the backend’s native write-result shape.',
            '后端原生写入结果形状的原承诺。'
          )
        }
      },
      purpose: t(
        'Bind the same fragment/scanner owner to original backend all/get/run callbacks.',
        '将共享片段与单语句扫描规则接到原后端回调，原生准入先于惰性文本与参数准备。'
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
        '在真实已有查询节点上替换有限终端回调，继续共享原片段身份、上下文与惰性准备。'
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
        '按一次捕获的规范字节键稳定排列原条目，相同字节身份继续保持输入的先后顺序。'
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
        '在精确组织封装内编码字符串内容前缀，为原生有序扫描提供相同字节边界规则。'
      ),
      params: {
        orgId: t(
          'Canonical lowercase UUID from the caller’s host configuration or organization view; use that same identity at read and write boundaries.',
          '来自调用方宿主配置或组织视图指定的规范小写 UUID，读写边界须使用相同身份。'
        ),
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
        '单次捕获配对的规范锁键与编码身份，输出稳定排序去重的独立只读快照供原锁拥有者使用。'
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
        '将通道及可选类型化前缀投影为半开身份区间，沿用原通道顺序与规范键前缀编码。'
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
        '真实标准记录能力令牌，经同一能力表发布；原后端或已选特性提供实际查询和记录操作。'
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
        '通过唯一原能力表只读检查真实令牌成员关系，返回值与原存储的能力判断完全一致。'
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
        '按真实令牌读取与原存储完全相同的已安装接口，保留具体原生类型及原能力错误语义。'
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
        'IRecordQuery<T,TContext,TAugmentMethods> with three where forms, one select, all, real stream, explain, requirePushdown, limit and orderByComparator(compare).limit(k). Missing comparator bounds and invalid limits reject before source execution. Selector ordering, distinct and skip share the same reader. Extended native controls require explicit nativeSteps:true; legacy limit/comparator behavior stays client-side. all synchronously admits its full mapper/cleanup lifetime to the original transaction iterator owner and retains its first failure before cleanup.',
        '返回 IRecordQuery<T,TContext,TAugmentMethods>，具有三种 where、一次 select、all、真实 stream、explain、requirePushdown、limit 与 orderByComparator(compare).limit(k)；缺少比较器上限或 limit 无效时在源执行前拒绝，selector 排序、distinct 与 skip 共用同一 reader；扩展原生控制需显式 nativeSteps:true，旧源 limit/comparator 仍在客户端。all 同步把完整 mapper/清理区间登记到原事务迭代器 owner，清理前保留首错。'
      ),
      example: storageContractCases.createRecordQuery![0]!.example,
      cases: storageContractCases.createRecordQuery
    },
    createVectorQuery: {
      role: 'factory',
      purpose: t(
        'Create an immutable pre-topK vector builder over the native ranking cursor.',
        '在原生排名数据源上创建不可变向量构建器，先处理可下推过滤，再由显式上限开启读取。'
      ),
      params: {
        source: t(
          'IVectorQuerySource captures the original ranking cursor, exact/groupBy support and optional original request origin. Native Features require native: true; new reranked operations borrow the optional original beginOperation lease until scorer and cleanup settle.',
          'IVectorQuerySource 捕获原排名游标、exact/groupBy 支持及可选原始请求来源；原生 Feature 需要 native: true，新增重排操作借可选原 beginOperation 租用，直到评分器和清理实际结算。'
        ),
        methods: t(
          'Optional original pure Feature functions; reserved names reject before I/O.',
          '可选的原 Feature 纯函数；保留名冲突在 I/O 前拒绝。'
        )
      },
      returns: t(
        'IVectorQueryBuilder; topK enables shared reads and one optional portable rerank over actual bounded hits. Native filters precede ranking; client predicates never refill hits. Reranked results retain engine score and add rerankScore without write, watch or strict-pushdown methods.',
        '返回 IVectorQueryBuilder；topK 开启共享读取，以及对实际有界命中执行的可选可移植重排。原生条件在排名前过滤，客户端谓词不补搜；重排保留引擎 score 并增加 rerankScore，不再提供写入、订阅或严格下推方法。'
      ),
      example: storageContractCases.createVectorQuery![0]!.example,
      cases: storageContractCases.createVectorQuery
    },
    createRdfQuery: {
      role: 'factory',
      purpose: t(
        'Create a ground RDF read query with ordered native traversal steps.',
        '在原数据源上创建不可变的规范四元组查询，依声明执行原生或客户端有序遍历步骤。'
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
        'IRdfQuery with common reads, projections, keyset pages, native/client ground follow/inverse, delete and replace through the original mutation owner.',
        '返回 IRdfQuery，支持共享读取、投影、键集分页、原生/客户端 ground 遍历，以及通过原 mutation owner 执行的 delete/replace。'
      ),
      example: storageContractCases.createRdfQuery![0]!.example,
      cases: storageContractCases.createRdfQuery
    },
    VectorQueryMethod: {
      role: 'constant',
      purpose: t(
        'Canonical reserved shared and vector query methods.',
        '共享读取与向量构建方法的规范保留名称，防止已选特性覆盖原排名、上限与向量投影规则。'
      ),
      example: 'console.log(VectorQueryMethod.topK, VectorQueryMethod.withVector)'
    },
    RdfQueryMethod: {
      role: 'constant',
      purpose: t(
        'Canonical reserved shared and RDF traversal methods.',
        '共享读取与规范图遍历方法的保留名称表，用于拒绝与内建查询方法冲突的特性名称。'
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
        '未锁定与已锁定事务分支共用的保留方法名，内建配置与运行终点不接受同名特性覆盖。'
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
    snapshotStorageWhere: {
      role: 'operation',
      purpose: t(
        'Capture the original immutable canonical query AST for native translation; reuse the same single-read parser, field validation and INVALID_ARGUMENT cause.',
        '捕获原不可变规范查询 AST 供原生翻译；复用同一单读 parser、字段校验及 INVALID_ARGUMENT 原因。'
      ),
      params: {
        where: t(
          'Declarative IWhere input; field accessors are captured once.',
          '声明式 IWhere 输入，字段访问器只读取一次。'
        )
      },
      returns: t(
        'The same frozen IQueryCondition domain supplied to native source callbacks; no I/O, compiler or owner is created.',
        '与原生 source 回调相同的冻结 IQueryCondition 值域；不创建 I/O、compiler 或 owner。'
      ),
      example: storageContractCases.snapshotStorageWhere![0]!.example,
      cases: storageContractCases.snapshotStorageWhere
    },
    compileStorageQueryCondition: {
      role: 'operation',
      purpose: t(
        'Compile an already canonical source AST using the original condition compiler.',
        '通过原条件编译器处理数据源已收到的规范语法树，使原生作者复用相同谓词语义。'
      ),
      params: {
        condition: t(
          'Canonical AST from the original native execute callback, without another IWhere snapshot.',
          '原生 execute 回调的规范 AST，不再捕获 IWhere。'
        )
      },
      returns: t(
        'The original stateless predicate with unchanged operator and error semantics.',
        '操作符及错误语义保持的原无状态谓词。'
      ),
      example: storageContractCases.compileStorageQueryCondition![0]!.example,
      cases: storageContractCases.compileStorageQueryCondition
    },
    compileStorageWhere: {
      role: 'operation',
      purpose: t(
        'Capture the canonical declarative AST once and compile a stateless typed candidate predicate.',
        '一次捕获声明式过滤条件并编译无状态候选谓词，字段校验与操作符规则沿用原实现。'
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
        '声明式字段比较操作符的唯一运行时常量表，由原解析器和原生下推声明共同使用。'
      ),
      example: 'console.log(QueryOperator.eq, QueryOperator.in) // eq in'
    },
    createTransactionBuilder: {
      role: 'factory',
      optionDocs: {
        lock: {
          summary: t(
            'Excluded from raw builder options; append physical keys with the default builder’s lock method instead.',
            '原始构建选项不接受锁列表，默认构建分支通过自身锁方法追加物理键。'
          ),
          default: t(
            'No raw lock option; the default branch requires a later lock call before run.',
            '缺省不含原始锁选项，默认分支运行前须调用锁方法。'
          ),
          whenToUse: t(
            'Declare locks on the original builder branch, preserving its single normalization.',
            '在原构建分支声明锁，保留原有单次规范化时使用。'
          ),
          example: storageContractCases.createTransactionBuilder![0]!.example
        },
        concurrency: {
          summary: t(
            'Authentic optimistic policy in explicit optimistic author mode; normal builders retain the actual store option domain.',
            '显式乐观作者模式接纳真实乐观策略，普通构建分支保留实际存储选项域。'
          ),
          default: t(
            'Defer to the same owner’s registered store policy.',
            '省略时沿用同一拥有者登记的存储策略。'
          ),
          example: storageContractCases.createTransactionBuilder![1]!.example
        }
      },
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
        ),
        mode: t(
          'Optional fourth author argument {mode:"optimistic"} enables the native unlocked builder: run exists immediately, lock is absent and only authentic optimistic policies are accepted.',
          '可选第四作者参数 {mode:"optimistic"} 启用原生无锁 builder：立即具备 run、不含 lock，且只接受真实乐观策略。'
        )
      },
      returns: t(
        'Default ITransactionBuilder requires lock before run; explicit optimistic author mode returns IOptimisticTransactionBuilder without physical key normalization. Both invoke the original transaction once and preserve its Promise, complete scope and native option fields.',
        '缺省 ITransactionBuilder 需先 lock 再 run；显式乐观作者模式返回 IOptimisticTransactionBuilder，不规范化物理锁键。两者均调用原 transaction 一次，保留原 Promise、完整 scope 与原生选项字段。'
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
    getStorageOrgGraphPrefix: {
      role: 'operation',
      purpose: t(
        'Return the canonical native graph prefix for exact organization filtering and deletion.',
        '返回精确组织筛选、删除使用的规范原生图前缀。'
      ),
      params: {
        orgId: t(
          'Canonical lowercase UUID from the caller’s host configuration or organization view; use that same identity at read and write boundaries.',
          '来自调用方宿主配置或组织视图指定的规范小写 UUID，读写边界须使用相同身份。'
        )
      },
      returns: t(
        'urn:migaia:org:<orgId>: without store creation or I/O. Invalid UUID throws INVALID_ARGUMENT.',
        'urn:migaia:org:<orgId>:，不创建 store 或执行 I/O。无效 UUID 抛 INVALID_ARGUMENT。'
      ),
      example: storageContractCases.getStorageOrgGraphPrefix![0]!.example,
      cases: storageContractCases.getStorageOrgGraphPrefix
    },
    prefixStorageOrgGraph: {
      role: 'operation',
      purpose: t(
        'Map logical default and named graphs to disjoint native named graph identities.',
        '把逻辑默认图、命名图映射到互不冲突的原生命名图身份。'
      ),
      params: {
        orgId: t(
          'Canonical lowercase UUID from the caller’s host configuration or organization view; use that same identity at read and write boundaries.',
          '来自调用方宿主配置或组织视图指定的规范小写 UUID，读写边界须使用相同身份。'
        ),
        graph: t(
          'Ground named or default graph captured once.',
          '单次捕获的 ground 命名图或默认图。'
        )
      },
      returns: t(
        'Frozen IRdfNamedNode: prefix plus d for default, or n: and canonical percent-encoded exact IRI. Invalid input throws INVALID_ARGUMENT.',
        '冻结 IRdfNamedNode：默认图为前缀加 d，命名图为前缀加 n: 与规范百分号编码的原样 IRI。无效输入抛 INVALID_ARGUMENT。'
      ),
      example: storageContractCases.prefixStorageOrgGraph![0]!.example,
      cases: storageContractCases.prefixStorageOrgGraph
    },
    unprefixStorageOrgGraph: {
      role: 'operation',
      purpose: t(
        'Restore a shared frozen RDF graph only from the exact canonical organization envelope.',
        '仅从精确组织的规范物理图封装还原逻辑图，保留共享冻结项以及原命名图的精确拼写。'
      ),
      params: {
        orgId: t(
          'Canonical lowercase UUID from the caller’s host configuration or organization view; use that same identity at read and write boundaries.',
          '来自调用方宿主配置或组织视图指定的规范小写 UUID，读写边界须使用相同身份。'
        ),
        graph: t(
          'Physical IRdfNamedNode returned by the shared writer.',
          '共享写入函数返回的物理 IRdfNamedNode。'
        )
      },
      returns: t(
        'IRdfNamedNode or IRdfDefaultGraph with exact original IRI spelling. Foreign or noncanonical graphs throw INVALID_ARGUMENT; getter and decoding failures retain their original cause.',
        '原样 IRI 的 IRdfNamedNode 或 IRdfDefaultGraph。其它组织或非规范图抛 INVALID_ARGUMENT；getter、解码失败保留原 cause。'
      ),
      example: storageContractCases.unprefixStorageOrgGraph![0]!.example,
      cases: storageContractCases.unprefixStorageOrgGraph
    },
    RdfTermType: {
      role: 'constant',
      purpose: t(
        'Canonical RDF structural discriminants reused by native parsers and adapters.',
        '规范原始图项的结构判别值，供项工厂、原生解析器与适配器按同一项类型协议处理。'
      ),
      example: storageContractCases.RdfTermType![0]!.example,
      cases: storageContractCases.RdfTermType
    },
    RdfDatatype: {
      role: 'constant',
      purpose: t(
        'Canonical RDF 1.1 string and language-string datatype IRIs.',
        '声明规范字符串与语言字符串的数据类型标识，项工厂与原生解析适配共用这些精确身份。'
      ),
      example: storageContractCases.RdfDatatype![0]!.example,
      cases: storageContractCases.RdfDatatype
    },
    prefixStorageOrgKey: {
      role: 'operation',
      purpose: t(
        'Wrap a detached logical key in one canonical organization segment without consuming its logical key budget.',
        '将独立逻辑键快照封装为一个规范组织段，不消耗逻辑键预算。'
      ),
      params: {
        orgId: t(
          'Canonical lowercase UUID from the caller’s host configuration or organization view; use that same identity at read and write boundaries.',
          '来自调用方宿主配置或组织视图指定的规范小写 UUID，读写边界须使用相同身份。'
        ),
        key: recordKeyParam,
        backend: optionalKeyBackend
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
          'Canonical lowercase UUID from the caller’s host configuration or organization view; use that same identity at read and write boundaries.',
          '来自调用方宿主配置或组织视图指定的规范小写 UUID，读写边界须使用相同身份。'
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
        '构造真实并发策略身份，由原逻辑循环执行等待、失败或乐观重试的既定规则。'
      ),
      example: `const policy = ConcurrencyPolicy.wait({ timeoutMs: 2_000 })`
    },
    TransactionActivityMode: {
      role: 'constant',
      purpose: t(
        'Actual managed or native activity mode captured by the real backend owner.',
        '声明真实后端采用的托管或原生活跃范围，决定事务视图如何沿原登记检查有效性。'
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
        '声明事务操作及确定终态的只观察事件名，原事务拥有者仍控制提交、回滚和错误顺序。'
      )
    },
    createStorageIteratorLifetime: {
      role: 'factory',
      optionDocs: {
        close: {
          summary: t(
            'Release the already-owned native resource after all accepted advances have settled.',
            '在全部已接纳推进结算之后释放后端已经持有的原生资源。'
          ),
          whenToUse: t(
            'Supply the existing native close operation when constructing this lifetime.',
            '创建生命周期时提供现有原生关闭操作。'
          ),
          example: storageContractCases.iteratorAuthor![0]!.example,
          returns: t(
            'Awaited completion of native release; a failure remains observable on main disposal.',
            '等待原生释放完成，失败可通过主释放承诺观察。'
          )
        },
        report: {
          summary: t(
            'Observe cleanup failures through the original backend reporter; reporting does not grant storage control.',
            '通过所属后端的原报告函数观察清理失败，该接点不授予存储控制权。'
          ),
          whenToUse: t(
            'Connect the original report-only symbolic cleanup path.',
            '连接原符号清理的只报告路径。'
          ),
          example: storageContractCases.iteratorAuthor![0]!.example,
          params: {
            error: t(
              'Original cleanup error, including failed symbolic disposal.',
              '原清理错误，包含符号释放失败。'
            )
          },
          returns: t(
            'The symbolic cleanup Promise adopts the callback result; the original reporter should finish successfully.',
            '符号清理承诺采用回调结果，原报告器应成功完成自身工作。'
          )
        },
        onSettled: {
          summary: t(
            'Synchronous native bookkeeping when shared cleanup settles, whether it fulfills or rejects.',
            '共享清理成功或拒绝结算时执行原生同步记账，保留原拥有者的资源登记。'
          ),
          default: t('No additional settlement callback.', '省略时不调用额外结算回调。'),
          whenToUse: t(
            'Release the original owner’s cursor registration after resource settlement.',
            '资源结算后清除原拥有者的游标登记时使用。'
          ),
          example: storageContractCases.iteratorAuthor![0]!.example,
          returns: t(
            'No result; the original owner supplies a nonthrowing bookkeeping callback.',
            '无结果，由原拥有者提供不会抛错的记账回调。'
          )
        }
      },
      purpose: t(
        'Reuse the original iterator drain and cached cleanup paths when authoring a native cursor; data admission and transaction registration stay with the original backend.',
        '编写原生游标时复用既有迭代器排空与缓存清理路径；数据准入和事务登记仍属于原后端。'
      ),
      params: {
        options: t(
          'Original close and report callbacks, plus optional onSettled. Submit each complete accepted advance through advance; the helper owns no query, policy loop or native client.',
          '原 close 与 report 回调，以及可选 onSettled；每次完整接纳的推进经 advance 提交；助手不拥有查询、策略循环或原生客户端。'
        )
      },
      returns: t(
        'IStorageIteratorLifetime<T> with accepted-advance drain, cached rejecting dispose, cached return and separately cached report-only symbolic cleanup.',
        'IStorageIteratorLifetime<T>：排空已接纳推进，缓存拒绝型 dispose、return，以及独立缓存的只报告符号清理。'
      ),
      example: storageContractCases.createStorageIteratorLifetime![0]!.example,
      cases: storageContractCases.createStorageIteratorLifetime
    },
    createTransactionOwner: {
      role: 'operation',
      optionDocs: {
        activityMode: {
          summary: t(
            'Use managed callback views or the backend’s actual native activity checks.',
            '选择托管回调视图或后端真实原生活跃检查，使视图失效沿原事务规则处理。'
          ),
          default: t(
            'managed uses the original managed activity mode.',
            '缺省使用原托管活跃模式。'
          ),
          values: { enum: 'TransactionActivityMode' },
          whenToUse: t(
            'Use native only when the actual backend owns transaction activity boundaries.',
            '仅在实际后端掌握事务活跃边界时选择原生模式。'
          ),
          example: storageContractCases.ownerAuthor![0]!.example
        },
        asyncDisposeKey: {
          summary: t(
            'The fixed resource symbol from the outer host; it must be a real symbol identity.',
            '来自外层宿主的固定资源释放符号，必须使用真实符号身份。'
          ),
          default: t(
            'Native Symbol.asyncDispose; absence requires the host’s existing fallback.',
            '缺省使用原生 Symbol.asyncDispose，原生缺失时须提供宿主既有后备符号。'
          ),
          example: storageContractCases.ownerAuthor![0]!.example
        },
        defaultPolicy: {
          summary: t(
            'Authentic store-default concurrency policy captured once by this owner.',
            '由本拥有者一次捕获的真实存储缺省并发策略，后续操作沿该身份解析。'
          ),
          default: t(
            'Create one authentic wait policy for this owner.',
            '省略时为本拥有者创建一个真实等待策略。'
          ),
          example: storageContractCases.ownerAuthor![0]!.example
        },
        concurrencyStages: {
          summary: t(
            'Original kind:concurrency observer supplied by the existing host stage registry.',
            '既有宿主阶段登记提供的并发观察接点，其判别值必须为 concurrency。'
          ),
          default: t('No concurrency-stage observer.', '省略时不连接并发阶段观察器。'),
          example: storageContractCases.ownerAuthor![0]!.example
        }
      },
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
        '按原登记核验事务视图是否仍然有效，并确认它属于所指定的精确存储对象。'
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
      purpose: t(
        'Canonical held and remote handoff state names.',
        '区分已确认持有与远端交接中的锁状态，使检查结果不会把旧持有者当作新持有者。'
      )
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
      optionDocs: {
        forTransaction: {
          summary: t(
            'Original standard-capability binder receiving a live precise scope; return that native draft’s transaction API.',
            '原标准能力绑定器接收精确活跃视图，并返回该原生草稿的事务接口。'
          ),
          default: t(
            'No transaction projection; a transactional standard publication requires this binder.',
            '省略时不提供事务投影，事务标准能力发布需要此绑定器。'
          ),
          whenToUse: t(
            'Publish a genuine native standard capability for the same transaction owner.',
            '为同一事务拥有者发布真实原生标准能力时使用。'
          ),
          example: storageContractCases.capabilityAuthor![0]!.example,
          params: {
            scope: t(
              'Authentic scope of the same native store; verify ownership before retrieving its draft API.',
              '同一原生存储的真实视图，取得草稿接口前须核对归属。'
            )
          },
          returns: t(
            'The original transaction API; it is used at an accepted operation, not descriptor creation.',
            '返回原事务接口，在已接纳操作中使用，创建描述时不执行。'
          )
        }
      },
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
        ),
        options: t(
          'Optional forTransaction(scope) sees ITransactionScope<ICodecValue,TCap>, so the actual implemented standard token is available through the original use. Existing KV members and original callback declarations remain compatible; no native API is cast or fabricated.',
          '可选 forTransaction(scope) 接收 ITransactionScope<ICodecValue,TCap>，可经原 use 使用实际实现的标准令牌；既有 KV 成员及原回调声明保持兼容，不强转或虚构原生 API。'
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
      optionDocs: {
        onInstaller: {
          summary: t(
            'Capture this store’s unique finite prepare/publish/release port after original base admission.',
            '原基础准入后捕获此存储唯一的有限准备、发布与释放接点。'
          ),
          default: t('No installer callback is invoked.', '省略时不调用安装接点回调。'),
          whenToUse: t(
            'Let the original host installation window retain the native publication port.',
            '让原宿主安装窗口保留原生发布接点时使用。'
          ),
          example: storageContractCases.installerAuthor![0]!.example,
          params: {
            port: t(
              'The same store’s original capability installation port.',
              '同一存储的原能力安装接点。'
            )
          },
          returns: t(
            'No result; the supplied base remains caller-owned.',
            '无结果，传入基础资源仍由调用方拥有。'
          )
        }
      },
      purpose: t(
        'Admit a complete implementation batch and modify the same resource-backed base, preserving its public class and hidden members.',
        '准入整批实现并改装同一资源基础对象，保留类公开方法与非枚举成员。'
      ),
      params: {
        base: t(
          'Unprovided resource base with valid backend, support facts and both cleanup entries.',
          '尚未装配能力且具有有效后端名、能力事实与两个清理入口的资源基础对象。'
        ),
        entries: t(
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
      role: 'constant',
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
        '校验开放后端名称的字符与长度规则，只接纳名称形状，存储能力仍由原准入检查。'
      ),
      params: { value: t('Unknown backend label.', '未知后端标签。') },
      returns: t(
        'True for lowercase letter followed by lowercase letters, digits or hyphens, at most 64 characters.',
        '小写字母开头，后接小写字母、数字或连字符，总长不超过 64 时为真。'
      ),
      example: `console.log(isBackendKind('example-catalog'), isBackendKind('Invalid Name')) // true false`
    },
    BACKEND_KIND_PATTERN: {
      role: 'constant',
      purpose: t(
        'Canonical backend label pattern used by all contract admission checks.',
        '全部契约准入共用的后端名称正则，约束小写开头、后续字符及最大长度。'
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
      optionDocs: {
        version: {
          summary: t(
            'Application’s current nonnegative safe integer archive version.',
            '应用定义的当前存档版本，必须为非负安全整数。'
          ),
          example:
            "import { createMigrationPlan, migrateEnvelopeSync } from '@migaia/storage-contract'\nconst plan = createMigrationPlan({\n  version: 1, steps: { 1: previous => ({ previous }) }\n})\nconsole.log(migrateEnvelopeSync(plan, { version: 0, state: 'old' }))"
        },
        reset: {
          summary: t(
            'Exclusive reset-plan callback returning one fresh state for any supported older archive; do not combine with steps.',
            '重置计划专用回调，为受支持旧存档返回一次新状态，与逐步迁移配置互斥。'
          ),
          whenToUse: t(
            'Discard old state instead of applying individual version transitions.',
            '需要舍弃旧状态而不逐个执行版本转换时使用。'
          ),
          example:
            "import { createMigrationPlan, migrateEnvelopeSync } from '@migaia/storage-contract'\nconst plan = createMigrationPlan({ version: 1, reset: () => ({ settings: {} }) })\nconsole.log(migrateEnvelopeSync(plan, { version: 0, state: 'old' }))",
          returns: t(
            'One replacement state, or a Promise used through migrateEnvelope.',
            '一个替换状态，或通过异步迁移入口使用的承诺。'
          )
        },
        steps: {
          summary: t(
            'Own canonical target-version keys mapped to conversion callbacks; the suffix through version must be continuous.',
            '以自有规范目标版本为键的转换回调表，直到当前版本的后缀必须连续。'
          ),
          default: t(
            'No steps supports only an archive already at the current version.',
            '没有步骤时只支持已经处于当前版本的存档。'
          ),
          example:
            "import { createMigrationPlan, migrateEnvelopeSync } from '@migaia/storage-contract'\nconst plan = createMigrationPlan({\n  version: 1, steps: { 1: previous => ({ previous }) }\n})\nconsole.log(migrateEnvelopeSync(plan, { version: 0, state: 'old' }))"
        }
      },
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
      optionDocs: {
        observe: {
          summary: t(
            'Optional beforeStep/afterStep observations share each actual conversion context; their results never veto migration.',
            '可选的步骤前后观察共用实际转换上下文，其返回结果不会否决迁移。'
          ),
          default: t('No migration step observations.', '省略时不发送迁移步骤观察。'),
          example: storageContractCases.migrationSyncOptions![0]!.example
        }
      },
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
      optionDocs: {
        observe: {
          summary: t(
            'Optional beforeStep/afterStep observations share each actual conversion context; their results never veto migration.',
            '可选的步骤前后观察共用实际转换上下文，其返回结果不会否决迁移。'
          ),
          default: t('No migration step observations.', '省略时不发送迁移步骤观察。'),
          example: storageContractCases.migrationAsyncOptions![0]!.example
        },
        signal: {
          summary: t(
            'Borrow the caller’s cancellation signal for waiting and per-step checks, including the unchanged-version path.',
            '借用调用方取消信号进行等待与逐步检查，同版直接返回前也检查取消。'
          ),
          default: t('No external cancellation signal.', '省略时没有外部取消信号。'),
          example: storageContractCases.migrationAsyncOptions![0]!.example
        },
        report: {
          summary: t(
            'Original utility reporter receives late rejections and cleanup/reporter context without changing the migration result.',
            '原工具报告函数接收迟到拒绝及清理或报告阶段上下文，不改变迁移结果。'
          ),
          default: t('Use the original host rethrow reporter.', '省略时使用原宿主重抛报告器。'),
          whenToUse: t(
            'Observe failures that arrive after a cancelled migration has already settled.',
            '需要观察已取消迁移结算后到达的迟到失败时使用。'
          ),
          example: storageContractCases.migrationAsyncOptions![0]!.example,
          params: {
            error: t('Original asynchronous failure.', '原异步失败值。'),
            context: t('Original utility operation and failure phase.', '原工具操作名与失败阶段。')
          },
          returns: t('No result; reporting stays observation-only.', '无返回结果，报告只作观察。')
        }
      },
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
        'Original known store with full capability/native/sync/transaction/Feature precision plus native text watch; missing either callable rejects with UNSUPPORTED_CAPABILITY and preserves getter cause.',
        '原已知 store，保留完整能力、原生、同步、事务与 Feature 类型并提供文本 watch；缺少任一方法时报 UNSUPPORTED_CAPABILITY，getter cause 保留。'
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
        'Boolean after real KV/flag/two-callable admission; known stores retain full precision, while unknown inputs narrow only to the original KV/text feed shape.',
        '真实 KV/flag/双 callable 准入后的布尔值；已知 store 保留完整类型，未知输入只缩窄到原 KV/text feed 形状。'
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
      optionDocs: {
        asyncDisposeKey: {
          summary: t(
            'Fixed canonical cleanup symbol from the outer host, including its existing fallback where native support is absent.',
            '来自外层宿主的固定规范清理符号，包括原生缺失环境中的既有后备符号。'
          ),
          default: t(
            'Use the native Symbol.asyncDispose identity when available.',
            '可用时缺省使用原生 Symbol.asyncDispose 身份。'
          ),
          example:
            "import { snapshotStorageBaseDetailed } from '@migaia/storage-contract'\nfunction inspectResource(candidate: unknown, asyncDisposeKey: typeof Symbol.asyncDispose) {\n  return snapshotStorageBaseDetailed(candidate, { asyncDisposeKey })\n}"
        }
      },
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
    snapshotStorageOrgKeyPrefix: {
      role: 'operation',
      purpose: t(
        'Project half-open native byte bounds from the original organization and logical prefix owners.',
        '从原组织与逻辑前缀拥有者投影原生半开字节界。'
      ),
      params: {
        orgId: t(
          'Canonical lowercase UUID from the caller’s host configuration or organization view; use that same identity at read and write boundaries.',
          '来自调用方宿主配置或组织视图指定的规范小写 UUID，读写边界须使用相同身份。'
        ),
        prefix: t(
          'Logical typed key prefix; explicit undefined selects all logical keys in this organization.',
          '逻辑类型化键前缀，显式 undefined 选择本组织的全部逻辑键。'
        ),
        backend: optionalKeyBackend
      },
      returns: t(
        'Detached lower/upper bytes; undefined prefix selects all logical keys in only that organization.',
        '独立lower/upper字节；undefined前缀仅选择该组织全部逻辑键。'
      ),
      example: storageContractCases.snapshotStorageOrgKeyPrefix![0]!.example,
      cases: storageContractCases.snapshotStorageOrgKeyPrefix
    },
    encodeStorageOrgKey: {
      role: 'operation',
      purpose: t(
        'Encode the original organization envelope without reducing logical key limits.',
        '使用原组织封装与保序编码写出物理字节，使不同组织中的相同逻辑键保持隔离。'
      ),
      params: {
        orgId: t(
          'Canonical lowercase UUID from the caller’s host configuration or organization view; use that same identity at read and write boundaries.',
          '来自调用方宿主配置或组织视图指定的规范小写 UUID，读写边界须使用相同身份。'
        ),
        key: recordKeyParam,
        backend: optionalKeyBackend
      },
      returns: t(
        'Original ordered bytes; only the logical key consumes depth and node budgets.',
        '原保序字节；只有逻辑键消耗深度和节点预算。'
      ),
      example: storageContractCases.encodeStorageOrgKey![0]!.example,
      cases: storageContractCases.encodeStorageOrgKey
    },
    decodeStorageOrgKey: {
      role: 'operation',
      purpose: t(
        'Validate the requested organization boundary and reuse the original logical decoder.',
        '从指定组织的规范物理字节中还原逻辑键，使用原键解码与组织身份检查规则。'
      ),
      params: {
        orgId: t(
          'Canonical lowercase UUID from the caller’s host configuration or organization view; use that same identity at read and write boundaries.',
          '来自调用方宿主配置或组织视图指定的规范小写 UUID，读写边界须使用相同身份。'
        ),
        encoded: t(
          'Complete bytes returned by encodeStorageOrgKey for that organization.',
          '该组织的 encodeStorageOrgKey 返回的完整物理字节。'
        ),
        backend: optionalKeyBackend
      },
      returns: t(
        'Detached logical key; foreign boundaries are INVALID_ARGUMENT, invalid logical bytes are INVALID_KEY.',
        '独立逻辑键；其它组织边界报INVALID_ARGUMENT，无效逻辑字节报INVALID_KEY。'
      ),
      example: storageContractCases.decodeStorageOrgKey![0]!.example,
      cases: storageContractCases.decodeStorageOrgKey
    },
    encodeOrderedStorageKey: {
      role: 'operation',
      purpose: t(
        'Validate and copy a key, then encode independently owned bytes whose lexicographic order equals compareStorageKeys.',
        '校验并复制键，再编码成独立字节；字典序与 compareStorageKeys 相同。'
      ),
      params: { key: keyValidationParams.value, backend: optionalKeyBackend },
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
          'Optional producer-authored details, default `{}`. Optional `backend` is the caller’s open diagnostic backend name; optional `key` is a string or `IStorageKey`; optional `cause` is any original thrown value. All fields default to `undefined`; key and cause are retained by reference without validation or copying.',
          '生产者提供的可选详情，默认 `{}`。可选 `backend` 为调用方的开放诊断后端名称；可选 `key` 为字符串或 `IStorageKey`；可选 `cause` 为任意原始抛出值。各字段默认 `undefined`，键和原因按引用保留，不校验或复制。'
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
    },
    ...storageContractVectorSymbols
  },
  types: {
    IRecordQuery: {
      summary: t(
        'Record query entry adds mutually exclusive canonical selector and bounded comparator ordering.',
        '记录查询入口支持规范选择器排序或有界比较器排序，两个转换路径互斥并保留原资源归属。'
      ),
      scenarios: [
        t(
          'Consume a backend-supplied record cursor through the immutable shared query plan.',
          '把后端提供的记录游标接入共享不可变查询，保留精确字段类型与原资源清理。'
        )
      ],
      example: storageContractCases.createRecordQuery![0]!.example,
      members: {
        ...recordQueryMembers,
        orderBy: queryOrderMember,
        orderByComparator: {
          summary: t(
            'Enter opaque comparison ordering; declare a finite limit before ordinary read terminals.',
            '进入不透明比较器排序；使用普通读取终点之前，必须声明有限数量上限。'
          ),
          params: {
            compare: t(
              'Caller function comparing two current record rows using a negative, zero or positive numeric result.',
              '调用方提供的当前记录行比较函数，以负数、零或正数表示先后关系。'
            )
          },
          returns: t(
            'An IRecordQueryNeedsLimit with limit(count) and first(ctx); arbitrary comparison stays on the client.',
            '返回提供 limit(count) 与 first(ctx) 的 IRecordQueryNeedsLimit，任意比较函数在客户端执行。'
          ),
          example:
            'const rows = await query.orderByComparator((left, right) => left.total - right.total).limit(10).all()'
        }
      }
    },
    IRecordQueryNeedsLimit: {
      summary: t(
        'An opaque comparator branch exposes an explicit bound or the one-row first shortcut.',
        '不透明比较器分支仅提供显式数量上限或单行 first 快捷终点，避免无界保存全部排序结果。'
      ),
      scenarios: [
        t(
          'Consume a backend-supplied record cursor through the immutable shared query plan.',
          '把后端提供的记录游标接入共享不可变查询，保留精确字段类型与原资源清理。'
        )
      ],
      example: storageContractCases.createRecordQuery![0]!.example,
      members: { limit: queryBoundsMembers.limit!, first: queryReadMembers.first! }
    },
    IRecordQueryBase: {
      summary: t(
        'Common record controls retain filtering, projection, statistics, keyset pages and original transactional mutations.',
        '记录公共控制保留过滤、一次投影、统计、键集分页与原事务变更，排序模式由当前类型决定。'
      ),
      scenarios: [
        t(
          'Consume a backend-supplied record cursor through the immutable shared query plan.',
          '把后端提供的记录游标接入共享不可变查询，保留精确字段类型与原资源清理。'
        )
      ],
      example: storageContractCases.createRecordQuery![0]!.example,
      members: recordQueryMembers
    },
    IQueryStatistics: {
      summary: t(
        'Numeric aggregates reuse the original reader or a declared compatible native reducer.',
        '数值统计复用原查询读取器或已声明且兼容的原生统计，不保存全部结果行。'
      ),
      scenarios: [
        t(
          'Consume a backend-supplied record cursor through the immutable shared query plan.',
          '把后端提供的记录游标接入共享不可变查询，保留精确字段类型与原资源清理。'
        )
      ],
      example: storageContractCases.createRecordQuery![0]!.example,
      members: queryStatisticsMembers
    },
    IRdfNamedNode: {
      summary: {
        en: 'Canonical absolute IRI term retaining original Unicode spelling without normalization.',
        zh: '保留原始字符拼写且不进行规范化改写的绝对资源项。'
      },
      members: {
        termType: {
          summary: {
            en: 'Canonical RDF term discriminator; native blank labels never become standard persistent ground identity.',
            zh: '规范三元组项区分字段，原生空白标签不变为标准持久完整身份。'
          }
        },
        value: {
          summary: {
            en: 'Original canonical term value, preserving validated IRI or lexical spelling without coercion.',
            zh: '原规范项值，保留已校验资源或字面拼写，不进行类型强制。'
          }
        }
      },
      example:
        "import { term } from '@migaia/storage-contract'\nexport const subject = term.iri('urn:example:subject')",
      scenarios: [
        {
          en: 'Construct a canonical RDF value before passing it to native ground storage.',
          zh: '传给原生完整三元组存储之前，构造规范三元组项值。'
        }
      ]
    },
    IRdfBlankNode: {
      summary: t(
        'A raw/parser-local blank term; labels are not portable repeated-identity keys.',
        'raw/parser 局部 blank 项；label 不是便携重复身份键。'
      ),
      members: {
        termType: {
          summary: {
            en: 'Canonical RDF term discriminator; native blank labels never become standard persistent ground identity.',
            zh: '规范三元组项区分字段，原生空白标签不变为标准持久完整身份。'
          }
        },
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
        termType: {
          summary: {
            en: 'Canonical RDF term discriminator; native blank labels never become standard persistent ground identity.',
            zh: '规范三元组项区分字段，原生空白标签不变为标准持久完整身份。'
          }
        },
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
      members: {
        termType: {
          summary: {
            en: 'Canonical RDF term discriminator; native blank labels never become standard persistent ground identity.',
            zh: '规范三元组项区分字段，原生空白标签不变为标准持久完整身份。'
          }
        }
      },
      example:
        "import { term } from '@migaia/storage-contract'\nexport const graph = term.defaultGraph",
      scenarios: [
        {
          en: 'Construct a canonical RDF value before passing it to native ground storage.',
          zh: '传给原生完整三元组存储之前，构造规范三元组项值。'
        }
      ]
    },
    IRdfBindingTerm: {
      summary: {
        en: 'Native SELECT binding term, including response-local blank labels outside persistent ground identity.',
        zh: '原生选择查询绑定项，可含不属于持久完整身份的响应内空白标签。'
      },
      members: {
        termType: {
          summary: {
            en: 'Canonical RDF term discriminator; native blank labels never become standard persistent ground identity.',
            zh: '规范三元组项区分字段，原生空白标签不变为标准持久完整身份。'
          }
        },
        value: {
          summary: {
            en: 'Original canonical term value, preserving validated IRI or lexical spelling without coercion.',
            zh: '原规范项值，保留已校验资源或字面拼写，不进行类型强制。'
          }
        }
      }
    },
    IRdfTerm: {
      summary: t(
        'Full raw RDF term union including the default graph.',
        '含默认图的完整 raw RDF 项联合。'
      ),
      members: {
        termType: {
          summary: {
            en: 'Canonical RDF term discriminator; native blank labels never become standard persistent ground identity.',
            zh: '规范三元组项区分字段，原生空白标签不变为标准持久完整身份。'
          }
        },
        value: {
          summary: {
            en: 'Original canonical term value, preserving validated IRI or lexical spelling without coercion.',
            zh: '原规范项值，保留已校验资源或字面拼写，不进行类型强制。'
          }
        }
      },
      example:
        "import { term } from '@migaia/storage-contract'\nexport const value = term.literal('bonjour', { language: 'FR' })",
      scenarios: [
        {
          en: 'Construct a canonical RDF value before passing it to native ground storage.',
          zh: '传给原生完整三元组存储之前，构造规范三元组项值。'
        }
      ]
    },
    IQuad: {
      summary: t(
        'Portable ground quad identity; standard repeated writes reject blank positions.',
        '便携 ground quad 身份；标准重复写入拒绝 blank 位置。'
      ),
      members: {
        subject: {
          summary: {
            en: 'Canonical named-node subject; blank identity is excluded from the standard ground contract.',
            zh: '规范具名主项，标准完整契约排除空白身份。'
          }
        },
        predicate: {
          summary: {
            en: 'Canonical named IRI predicate, never a literal or arbitrary grammar string.',
            zh: '规范具名资源谓词，不是字面项或任意语法字符串。'
          }
        },
        object: {
          summary: {
            en: 'Canonical named IRI or literal object within the standard ground identity.',
            zh: '标准完整身份内的规范具名资源或字面对象项。'
          }
        },
        graph: {
          summary: t(
            'NamedNode or DefaultGraph, required even for the default graph.',
            'NamedNode 或 DefaultGraph；默认图也须明确提供。'
          )
        }
      },
      example:
        "import { term, snapshotStorageRdfQuad } from '@migaia/storage-contract'\nexport const quad = snapshotStorageRdfQuad({\n  subject: term.iri('urn:example:s'), predicate: term.iri('urn:example:p'),\n  object: term.literal('ready'), graph: term.defaultGraph\n}, undefined)",
      scenarios: [
        {
          en: 'Construct a canonical RDF value before passing it to native ground storage.',
          zh: '传给原生完整三元组存储之前，构造规范三元组项值。'
        }
      ]
    },
    IRawQuad: {
      summary: t(
        'Complete RDF 1.1 raw/parser quad, retaining request-local blank positions.',
        '完整 RDF 1.1 raw/parser quad，保留请求局部 blank 位置。'
      ),
      members: {
        subject: {
          summary: {
            en: 'Raw named or blank subject retained by the native document or result owner.',
            zh: '由原生文档或结果拥有者保留的原始具名或空白主项。'
          }
        },
        predicate: {
          summary: {
            en: 'Canonical named IRI predicate, never a literal or arbitrary grammar string.',
            zh: '规范具名资源谓词，不是字面项或任意语法字符串。'
          }
        },
        object: {
          summary: {
            en: 'Raw named, blank or literal object in the original native RDF result.',
            zh: '原生三元组结果内的原始具名、空白或字面对象项。'
          }
        },
        graph: {
          summary: {
            en: 'Native default, named or blank graph identity limited by the raw document boundary.',
            zh: '受原始文档边界限制的原生缺省、具名或空白图身份。'
          }
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
          summary: {
            en: 'Canonical text, byte, record or vector channel, without crossing another physical domain.',
            zh: '规范文本、字节、记录或向量通道，不跨越其它物理领域。'
          }
        },
        key: {
          summary: {
            en: 'Original channel key assigned by the application or returned by the same backend.',
            zh: '应用指定或同一后端返回的原通道键。'
          }
        },
        collection: {
          summary: {
            en: 'Application-assigned vector collection belonging to this same organization.',
            zh: '属于同一组织且由应用指定的向量集合。'
          }
        },
        id: {
          summary: {
            en: 'Point ID returned or assigned by the original vector collection.',
            zh: '由原向量集合返回或指定的点标识符。'
          }
        }
      },
      example:
        "import { lockKey } from '@migaia/storage-contract'\nexport const target = lockKey.vector('documents', 'first')",
      scenarios: [
        {
          en: 'Address expiry on the same native channel that owns the underlying entry.',
          zh: '对底层条目所属的同一原生通道指定期限目标。'
        }
      ]
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
            target: {
              en: 'Canonical text, byte, record or vector target created for this same native store.',
              zh: '为同一原生存储创建的规范文本、字节、记录或向量目标。'
            },
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
          params: {
            target: {
              en: 'Canonical text, byte, record or vector target created for this same native store.',
              zh: '为同一原生存储创建的规范文本、字节、记录或向量目标。'
            }
          },
          returns: t('Remaining milliseconds or undefined.', '剩余毫秒数或 undefined。'),
          example: `await tx.use(ttl).remaining({ channel: 'record', key: 'profile' })`
        },
        persist: {
          summary: t(
            'Remove the current draft deadline in this same transaction.',
            '在同一事务中移除当前 draft 期限。'
          ),
          params: {
            target: {
              en: 'Canonical text, byte, record or vector target created for this same native store.',
              zh: '为同一原生存储创建的规范文本、字节、记录或向量目标。'
            }
          },
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
        key: {
          summary: {
            en: 'Detached logical key retained from the original captured input position.',
            zh: '从原始已捕获输入位置保留的独立逻辑键。'
          }
        },
        identity: {
          summary: t('Hex identity of the canonical ordered bytes.', '规范有序字节的十六进制身份。')
        },
        firstIndex: {
          summary: t(
            'First equivalent input position; use only that position for distinct native deletion.',
            '首次出现相同规范键的输入位置；原生去重删除只使用该位置。'
          )
        }
      },
      scenarios: [
        {
          en: 'Retain canonical input identity and first occurrence when capturing a native batch.',
          zh: '捕获原生批量时保留规范输入身份与首次出现位置。'
        }
      ],
      example:
        "import { snapshotStorageBatchKeys } from '@migaia/storage-contract'\nconsole.log(snapshotStorageBatchKeys(['theme', ['users', 1]], undefined))"
    },
    IRecordsApi: {
      summary: t(
        'Standard record query and prefix deletion boundary; exact native row defaults are preserved by provided implementations.',
        '标准记录查询与前缀删除边界，所提供实现保留精确原生默认行类型。'
      ),
      members: {
        query: {
          summary: {
            en: 'Build the shared query over the original native record source.',
            zh: '在原生记录来源上创建共享记录查询链。'
          },
          params: {},
          returns: {
            en: 'A typed persistent query builder, without scanning records at construction.',
            zh: '返回类型化持久查询构造器，创建时不扫描记录。'
          }
        },
        removeByPrefix: {
          summary: {
            en: 'Delete current-organization records matching one canonical ordered-key prefix.',
            zh: '删除当前组织内匹配单个规范保序键前缀的记录。'
          },
          params: {
            prefix: {
              en: 'Application-selected typed record prefix in the original key domain.',
              zh: '应用选择的原键域类型化记录前缀。'
            },
            ctx: {
              en: 'Original optional operation context carrying one captured cancellation and timeout budget.',
              zh: '原可选操作上下文，承载单次捕获的取消与超时预算。'
            }
          },
          returns: {
            en: 'The actual number of deleted records, confirmed by the original native commit.',
            zh: '返回原生提交确认的实际已删除记录数量。'
          }
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
        },
        ne: {
          summary: {
            en: 'Reject equality with the captured canonical operand using the shared comparison semantics.',
            zh: '按共享比较语义排除与已捕获规范操作数相等的值。'
          }
        }
      }
    },
    IWhere: {
      summary: {
        en: 'Portable declarative payload conditions captured into the original canonical AST.',
        zh: '捕获为原规范条件树的可移植声明式载荷条件。'
      },
      members: {
        and: {
          summary: {
            en: 'Conjunction of captured payload conditions, preserving the original declaration order.',
            zh: '保留原声明顺序的已捕获载荷条件合取集合。'
          }
        },
        or: { summary: t('At least one declared condition must match.', '至少一个条件必须匹配。') },
        not: {
          summary: {
            en: 'Negation of one captured canonical payload condition without another parser.',
            zh: '对单个已捕获规范载荷条件取反，不增加其它解析器。'
          }
        }
      }
    },
    IQueryCondition: {
      summary: t(
        'The sole canonical field/boolean AST shared by planning and client predicates.',
        '规划与客户端谓词共用的唯一规范字段/布尔 AST。'
      ),
      members: {
        kind: {
          summary: {
            en: 'Discriminate a field comparison, conjunctive list, alternative list or negation node.',
            zh: '区分字段比较、合取列表、替代列表与否定条件节点。'
          }
        },
        path: {
          summary: t(
            'Validated property segments owned by the canonical utils path parser.',
            '由规范 utils 路径解析器接纳的属性片段。'
          )
        },
        operator: {
          summary: {
            en: 'Canonical comparison operator supplied by the shared QueryOperator domain.',
            zh: '共享比较运算符领域提供的规范条件比较操作。'
          }
        },
        value: {
          summary: t(
            'Portable codec value, undefined, bigint, Date, opaque object identity, or an operator list. Identity objects are not traversed.',
            'portable codec 值、undefined、bigint、Date、不透明对象身份或操作符列表；不遍历身份对象内容。'
          )
        },
        conditions: {
          summary: {
            en: 'Captured child conditions whose order and boolean grouping are preserved.',
            zh: '保留声明顺序与布尔分组的已捕获子条件集合。'
          }
        },
        condition: {
          summary: {
            en: 'Single captured child condition negated by this canonical node.',
            zh: '由当前规范否定节点取反的单个已捕获子条件。'
          }
        }
      },
      example:
        "import { snapshotStorageWhere } from '@migaia/storage-contract'\nexport const condition = snapshotStorageWhere({ category: 'docs', score: { gte: 3 } })",
      scenarios: [
        {
          en: 'Capture a portable payload condition once before deciding faithful native pushdown.',
          zh: '决定忠实原生下推前，单次捕获可移植载荷条件。'
        }
      ]
    },
    IQueryPlanStep: {
      summary: t(
        'One immutable pushed/client operation with its optional reason and index.',
        '一个不可变的下推或客户端操作，含可选原因与索引。'
      ),
      members: {
        operation: {
          summary: {
            en: 'One canonical planner operation whose native or client placement is being explained.',
            zh: '当前解释其原生或客户端执行位置的规范计划操作。'
          },
          values: {
            enum: 'QueryOperation'
          }
        },
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
        ...querySourceReasonMembers,
        pushed: {
          summary: {
            en: 'Ordered operations executed by the native source before returning candidate rows.',
            zh: '返回候选条目前由原生来源执行的有序操作集合。'
          }
        },
        client: { summary: t('Ordered client remainder with reasons.', '按序客户端余部与原因。') },
        fullScan: {
          summary: {
            en: 'Whether the declared native plan must visit the complete source candidate domain.',
            zh: '已声明原生计划是否必须访问完整候选来源域。'
          }
        },
        source: { summary: t('Captured native source label.', '捕获的原生数据源标签。') },
        index: {
          summary: {
            en: 'Optional native index identity declared by the source; it is not a portable index manager.',
            zh: '来源声明的可选原生索引身份，不代表可移植索引管理器。'
          }
        }
      }
    },
    IQueryPushdown: {
      summary: t(
        'Captured native operator/operation subsets and source/index identity; support is declared once.',
        '捕获的原生操作符、操作子集与 source/index 身份，支持事实只声明一次。'
      ),
      members: {
        operators: {
          summary: {
            en: 'Operators this native source declares it can faithfully translate.',
            zh: '此原生来源声明能够忠实翻译的比较运算符集合。'
          }
        },
        operations: {
          summary: {
            en: 'Canonical operation kinds supported by this native source, in actual chain order.',
            zh: '此原生来源支持的规范操作种类，仍遵守真实查询链顺序。'
          }
        },
        source: {
          summary: {
            en: 'Diagnostic identity of the original native row source used by explain.',
            zh: '解释计划所使用的原始原生条目来源诊断身份。'
          }
        },
        index: {
          summary: {
            en: 'Optional diagnostic identity of the actual native index.',
            zh: '实际原生索引的可选诊断身份，不授予索引创建权。'
          }
        },
        canPushCondition: {
          summary: {
            en: 'Optional faithful-domain predicate over the captured canonical AST, without I/O or another parser.',
            zh: '针对已捕获规范条件树的可选忠实域判断，不进行访问或另建解析器。'
          }
        }
      }
    },
    IVectorHit: {
      summary: {
        en: 'Original native point ID, metric score and optional detached application payload.',
        zh: '原生点标识、度量分数与可选的已脱离引用应用载荷。'
      },
      members: {
        id: {
          summary: {
            en: 'Original point identity returned by the native vector collection.',
            zh: '由原生向量集合返回的原始点身份标识。'
          }
        },
        score: { summary: t('Native score in engine result order.', '引擎结果顺序中的原生分数。') },
        payload: {
          summary: {
            en: 'Optional detached application payload selected by the original native query.',
            zh: '由原生查询选择的可选独立应用载荷。'
          }
        },
        vector: {
          summary: t('Present in the type only after withVector.', '仅 withVector 后出现在类型中。')
        }
      }
    },
    IVectorQueryBuilderCore: {
      summary: t(
        'Pre-topK construction retains native controls and Feature methods without exposing read terminals or portable rerank.',
        'topK 前的向量构建保留原生排名控制与 Feature 方法，必须先声明有限 topK 才能读取或执行可移植重排。'
      ),
      scenarios: [
        t(
          'Declare a native ranking bound before consuming precisely typed vector hits.',
          '先声明原生 topK 排名边界，再使用保留 payload 类型与原始分数的查询终点。'
        )
      ],
      example: storageContractCases.createVectorQuery![0]!.example,
      members: vectorControlMembers
    },
    IVectorQueryBuilder: {
      summary: t(
        'Pre-topK construction retains native controls and Feature methods without exposing read terminals or portable rerank.',
        'topK 前的向量构建保留原生排名控制与 Feature 方法，必须先声明有限 topK 才能读取或执行可移植重排。'
      ),
      scenarios: [
        t(
          'Declare a native ranking bound before consuming precisely typed vector hits.',
          '先声明原生 topK 排名边界，再使用保留 payload 类型与原始分数的查询终点。'
        )
      ],
      example: storageContractCases.createVectorQuery![0]!.example,
      members: vectorControlMembers
    },
    IVectorQueryBase: {
      summary: t(
        'Bounded vector reads retain native ranking and payload filtering, with an optional final client rerank. Record aggregates, keyset pages and selector/comparator ordering remain unavailable.',
        '有界向量读取保留原生排名与 payload 过滤，可选择最终客户端重排；仍不提供记录统计、键集分页或选择器、比较器排序。'
      ),
      scenarios: [
        t(
          'Declare a native ranking bound before consuming precisely typed vector hits.',
          '先声明原生 topK 排名边界，再使用保留 payload 类型与原始分数的查询终点。'
        )
      ],
      example: storageContractCases.createVectorQuery![0]!.example,
      members: vectorQueryMembers
    },
    IVectorQuery: {
      summary: t(
        'Bounded queries preserve payload, explicit vector state and Feature types. TGroupable alone grants scalar payload grouping; portable rerank returns a read-only stage whose grouping observes only retained topN hits.',
        '有界查询保留负载、显式向量状态与 Feature 类型，仅 TGroupable 授予标量 payload 分组；可移植重排返回只读阶段，其分组只观察已保留的 topN 命中。'
      ),
      scenarios: [
        t(
          'Declare a native ranking bound before consuming precisely typed vector hits.',
          '先声明原生 topK 排名边界，再使用保留 payload 类型与原始分数的查询终点。'
        )
      ],
      example: storageContractCases.createVectorQuery![0]!.example,
      members: {
        ...vectorQueryMembers,
        groupBy: {
          summary: t(
            'Group original topK hits by an own scalar payload field with an explicit per-group bound.',
            '按 payload 自有标量字段对原 topK 命中分组，并遵循每组显式声明的数量边界。'
          ),
          params: {
            field: t(
              'Caller-selected own scalar payload field; only explicitly groupable sources expose this method.',
              '调用方选择的 payload 自有标量字段；仅显式声明分组支持的来源提供此方法。'
            ),
            options: t(
              'Required caller object containing perGroup, a positive safe integer bounding retained hits in each group; no default exists.',
              '调用方必须提供含 perGroup 的对象，该值为限制每组保留命中的正安全整数，没有默认值。'
            )
          },
          returns: t(
            'A selected result of { group, hits } rows retaining original ranking; grouping never refills hits beyond topK.',
            '返回由 { group, hits } 组成的投影结果，沿用原排名顺序，分组不补取 topK 之外的命中。'
          ),
          example: "const groups = await query.groupBy('category', { perGroup: 2 }).all()"
        }
      }
    },
    IVectorQueryInput: {
      summary: t(
        'Native pre-ranking conditions, topK, minScore, withVector and original captured context, plus opaque native data only after an explicit same-source refinement.',
        '原生排名前条件、topK、minScore、withVector 与原捕获上下文；只有显式选择同来源原生派生后才增加不透明 native 数据。'
      ),
      members: {
        conditions: {
          summary: {
            en: 'Canonical declarative conditions; faithful native conditions precede ranking.',
            zh: '规范声明式条件，忠实的原生条件在排名前应用。'
          }
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
        native: {
          summary: t(
            'Present only after an explicit native Feature refinement. The Feature captures and validates this opaque request; only the original execute callback interprets it.',
            '仅在显式原生 Feature 派生后出现，由 Feature 捕获并校验此不透明请求，仅原 execute 回调解释其内容。'
          )
        },
        ctx: {
          summary: {
            en: 'Original readonly vector-query operation context captured once; native refinement and portable rerank do not create a second budget or replace its caller signal.',
            zh: '捕获一次的原只读向量查询上下文，原生派生与可移植重排不创建第二预算，也不替换调用方信号。'
          }
        }
      }
    },
    IVectorQuerySource: {
      summary: t(
        'Native ranking callback and captured support/resource facts.',
        '原生排名回调与捕获的支持、资源事实。'
      ),
      members: {
        beginOperation: {
          summary: t(
            'Optional once-captured author callback returning the original provider operation release. Only a new accepted reranked terminal or stream next borrows it, and releases after the actual scorer and original cleanup settle; unselected paths and pre-I/O rejection acquire no lease.',
            '可选且单次捕获的作者回调，返回原 provider 操作释放函数；只有新接纳的重排终点或 stream next 借用，评分器与原清理实际结算后释放，未选择路径及 I/O 前拒绝不取得租用。'
          )
        },
        origin: {
          summary: t(
            'Optional once-captured original near vector, similarTo ID or recommendation ID lists, independent of native sample resolution. Original sources may omit it, but a new rerank then rejects before I/O with INVALID_ARGUMENT.',
            '可选且单次捕获的原 near 向量、similarTo 身份或推荐身份列表，独立于原生样本解析；旧来源可省略，但新增 rerank 此时在 I/O 前以 INVALID_ARGUMENT 拒绝。'
          )
        },
        native: {
          summary: t(
            'Optional exact true fact declaring that this original execute callback understands a selected Feature native request. Omission rejects new native refinement without changing ordinary queries.',
            '可选且只能为 true 的事实，声明原 execute 回调理解已选择 Feature 的 native 请求；省略时拒绝新原生派生，普通查询保持原语义。'
          )
        },
        watch: {
          summary: t(
            'Optional native subscription callback; accepts the same complete native input and returns the original change iterator. Client steps reject before subscription; no shared event queue or lifetime wrapper is added.',
            '可选原生订阅回调，接收同一完整原生输入并返回原 change iterator；客户端步骤在订阅前拒绝，不新增共享事件队列或生命周期包装。'
          )
        },
        mutate: {
          summary: t(
            'Optional original write pipeline/transaction callback. Supply transaction-bound execute and accept(key,row); only unique selected rows accepted with true count. Root completion must await native commit; ctx is the original snapshot and concurrency is separate original policy metadata.',
            '可选原写 pipeline/事务回调，提供事务内 execute 与 accept(key,row)；仅去重选中且返回 true 的行计数，根终点等待原生提交；ctx 为原快照，concurrency 为独立原策略元数据。'
          )
        },
        reduce: {
          summary: t(
            'Optional native one-row scalar cursor for declared count/exists/aggregate support; uses the original resource owner.',
            '可选原生单行标量游标，兑现声明的 count/exists/aggregate，复用原资源 owner。'
          )
        },
        pushdown: {
          summary: {
            en: 'Captured faithful native operation declarations consumed by the original shared planner.',
            zh: '由原共享计划消费的已捕获忠实原生操作声明。'
          }
        },
        execute: {
          summary: {
            en: 'Execute the native engine query and return its original ranked cursor without JavaScript rescoring.',
            zh: '执行原生引擎查询并返回原排名游标，不在客户端重新计算分数。'
          }
        },
        asyncDisposeKey: {
          summary: {
            en: 'Optional original async-disposal symbol captured once; omission uses the native symbol without creating another owner.',
            zh: '捕获一次的可选原异步释放符号，省略时使用原生符号，不创建其它资源拥有者。'
          }
        },
        exact: {
          summary: {
            en: 'Native exact-ranking support fact; an unsupported engine must reject instead of scanning all candidates in JavaScript.',
            zh: '原生精确排名支持事实，不支持时拒绝而非在客户端扫描全部候选。'
          }
        },
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
        'Ground RDF queries combine shared reads with same-graph traversal, bounds, pages and original transactional mutation.',
        'Ground RDF 查询组合共享读取、投影、同 graph 遍历、数量边界、分页及原事务变更。'
      ),
      scenarios: [
        t(
          'Traverse ground RDF through the original same-graph matcher and cursor owner.',
          '在原 ground 匹配器之上构建 RDF 查询，沿用同 graph 遍历与原资源清理。'
        )
      ],
      example: storageContractCases.createRdfQuery![0]!.example,
      members: rdfQueryMembers
    },
    IRdfQuery: {
      summary: t(
        'Ground RDF queries combine shared reads with same-graph traversal, bounds, pages and original transactional mutation.',
        'Ground RDF 查询组合共享读取、投影、同 graph 遍历、数量边界、分页及原事务变更。'
      ),
      scenarios: [
        t(
          'Traverse ground RDF through the original same-graph matcher and cursor owner.',
          '在原 ground 匹配器之上构建 RDF 查询，沿用同 graph 遍历与原资源清理。'
        )
      ],
      example: storageContractCases.createRdfQuery![0]!.example,
      members: rdfQueryMembers
    },
    IRdfQueryTraversal: {
      summary: t(
        'Ordered ground forward/inverse predicate and optional target.',
        '有序 ground 正向或反向 predicate 与可选目标。'
      ),
      members: {
        operation: {
          summary: {
            en: 'Forward follow or inverse edge traversal on the same original RDF graph.',
            zh: '在同一原三元组图上执行正向跟随或反向边遍历。'
          },
          values: {
            follow: {
              en: 'Follow the current named object to the next subject in the same graph.',
              zh: '在同图中从当前具名对象跟随到下个主项。'
            },
            inverse: {
              en: 'Find predecessors whose named object matches the current subject.',
              zh: '查找具名对象匹配当前主项的前驱成员。'
            }
          }
        },
        predicate: {
          summary: {
            en: 'Canonical named predicate followed by the original traversal owner.',
            zh: '原遍历拥有者跟随的规范具名谓词身份。'
          }
        },
        target: {
          summary: {
            en: 'Canonical selected traversal target under the same graph and term rules.',
            zh: '同图与同项身份规则下的规范选定遍历目标。'
          }
        }
      }
    },
    IRdfQueryInput: {
      summary: t(
        'Ground pattern, ordered native prefix steps and captured context.',
        'ground pattern、有序原生前缀步骤与捕获上下文。'
      ),
      members: {
        operationScope: {
          summary: t(
            'Optional readonly exact backend operation view for nested ground matches, valid only within the accepted operation; original owner checks remain authoritative.',
            '嵌套 ground match 可选借用的只读精确后端 operation view，仅在 accepted 操作内有效，仍以原 owner 校验为准。'
          )
        },
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
        ctx: {
          summary: {
            en: 'Original readonly query context captured once before source execution.',
            zh: '来源执行前捕获一次的原只读查询操作上下文。'
          }
        }
      }
    },
    IRdfQuerySource: {
      summary: t(
        'Original native RDF iterator callback with unknown projected rows and support/resource facts.',
        '原生 RDF 原迭代器回调及 unknown 投影行、支持与资源事实。'
      ),
      members: {
        watch: {
          summary: t(
            'Optional native subscription callback; accepts the same complete native input and returns the original change iterator. Client steps reject before subscription; no shared event queue or lifetime wrapper is added.',
            '可选原生订阅回调，接收同一完整原生输入并返回原 change iterator；客户端步骤在订阅前拒绝，不新增共享事件队列或生命周期包装。'
          )
        },
        mutate: {
          summary: t(
            'Optional original write pipeline/transaction callback. Supply transaction-bound execute and accept(key,row); only unique selected rows accepted with true count. Root completion must await native commit; ctx is the original snapshot and concurrency is separate original policy metadata.',
            '可选原写 pipeline/事务回调，提供事务内 execute 与 accept(key,row)；仅去重选中且返回 true 的行计数，根终点等待原生提交；ctx 为原快照，concurrency 为独立原策略元数据。'
          )
        },
        reduce: {
          summary: t(
            'Optional native one-row scalar cursor for declared count/exists/aggregate support; uses the original resource owner.',
            '可选原生单行标量游标，兑现声明的 count/exists/aggregate，复用原资源 owner。'
          )
        },
        cursorSource: {
          summary: t(
            'Optional single-read private collection identity, reused by equivalent query descriptors; never exposed by a cursor.',
            '可选单读的私有 collection 身份，等价描述器复用，游标不暴露此对象。'
          )
        },
        nativeSteps: {
          summary: t(
            'Explicitly opt into extended native row controls while retaining ordered traversal steps.',
            '显式选择扩展原生行控制，保留有序遍历步骤。'
          )
        },
        pushdown: {
          summary: {
            en: 'Captured faithful native operation declarations consumed by the original shared planner.',
            zh: '由原共享计划消费的已捕获忠实原生操作声明。'
          }
        },
        execute: {
          summary: {
            en: 'Execute pushed native RDF matching and return the original ground-quad cursor.',
            zh: '执行已下推的原生三元组匹配，返回原完整三元组游标。'
          }
        },
        asyncDisposeKey: {
          summary: {
            en: 'Optional original async-disposal symbol captured once; omission uses the native symbol without creating another owner.',
            zh: '捕获一次的可选原异步释放符号，省略时使用原生符号，不创建其它资源拥有者。'
          }
        }
      }
    },
    IWithTransactionQueryMethods: {
      summary: t(
        'Project independent record and RDF Feature groups onto an existing transaction scope. The optional third RDF group defaults empty, preserving two-argument record calls.',
        '把独立的记录与 RDF Feature 组投影到既有事务 scope；可选第三 RDF 组缺省为空，保留旧两参数记录调用。'
      ),
      example: t(
        'Standard KV scopes keep capability-set projection; a native RDF/raw scope keeps its original overloads and native refinements while only match receives the RDF Feature group.',
        '标准 KV scope 保留能力集合投影；原生 RDF/raw scope 保留原重载和原生扩展，仅 match 接收 RDF Feature 组。'
      ),
      members: {
        use: {
          summary: t(
            'Select only the matching token family methods; keep native scope members and undefined operation context.',
            '仅选择对应令牌家族的方法，保留原生 scope 成员与 undefined 操作上下文。'
          )
        }
      }
    },
    IQueryCursor: {
      summary: t(
        'Opaque readonly in-process keyset anchor, privately scoped to the original source, conditions and ordering.',
        '不透明只读进程内键集锚点，私有约束原数据源、条件与排序。'
      ),
      members: {}
    },
    IQueryPages: {
      summary: t(
        'Bounded keyset pages expose opaque in-process continuation and await original cleanup.',
        '有界键集分页返回仅在进程内有效的不透明续读锚点，并完成原游标清理。'
      ),
      scenarios: [
        t(
          'Consume a backend-supplied record cursor through the immutable shared query plan.',
          '把后端提供的记录游标接入共享不可变查询，保留精确字段类型与原资源清理。'
        )
      ],
      example: storageContractCases.createRecordQuery![0]!.example,
      members: { page: queryPageMember }
    },
    IRecordQueryInput: {
      summary: t(
        'Record execute input shared by native reductions; optional selection carries one original terminal plan fact.',
        '与原生统计共享的记录执行输入；可选 selection 仅携带原终点计划事实。'
      ),
      members: {
        selection: {
          summary: t(
            'Optional opaque author fact from this exact terminal plan, returned unchanged only to the original native source. Omission adds no input key.',
            '当前精确终点计划中的可选不透明作者事实，仅原样传回原生来源。省略时不增加输入键。'
          )
        },
        conditions: {
          summary: {
            en: 'Captured canonical payload conditions already validated by the shared parser.',
            zh: '共享解析器已经校验并捕获的规范载荷条件集合。'
          }
        },
        fields: {
          summary: {
            en: 'Captured selected property paths, or no native projection when omitted.',
            zh: '已捕获的选定属性路径，省略时不请求原生投影。'
          }
        },
        ctx: {
          summary: {
            en: 'Original operation context captured once for this query terminal.',
            zh: '本查询终点捕获一次的原始操作上下文。'
          }
        },
        steps: {
          summary: t('Opted-in authoritative native step order.', '显式选择的原生步骤顺序。')
        }
      }
    },
    IQueryWatch: {
      summary: t(
        'Native watch terminal constrained by this:IQueryShape; a pre-topK vector builder cannot call it. Declared change-feed APIs expose it, while transaction APIs do not.',
        '以 this:IQueryShape 约束的原生 watch 终点，topK 前向量 builder 不能调用；声明 changeFeed 的 API 才提供，事务 API 不提供。'
      ),
      members: {
        watch: {
          summary: {
            en: 'Subscribe to the selected original query source without rerunning the query as a polling loop.',
            zh: '订阅所选原查询来源，不将查询重新执行为轮询循环。'
          },
          params: {
            this: {
              en: 'The original typed query on which watch is invoked.',
              zh: '当前调用观察方法的原类型化查询。'
            },
            ctx: {
              en: 'Original optional operation context with cancellation and one captured timeout budget.',
              zh: '原可选操作上下文，承载取消信号与单次捕获的超时预算。'
            }
          },
          returns: {
            en: 'A disposable stream of native invalidation descriptions, not result rows.',
            zh: '返回可释放原生失效描述流，不返回查询结果行。'
          }
        }
      }
    },
    IQueryWatcher: {
      summary: t(
        'Backend author callback from the same native query input to the original IStorageIterator<IStorageChange>.',
        '后端作者回调，从同一原生查询输入返回原 IStorageIterator<IStorageChange>。'
      ),
      members: {}
    },
    IQueryWriteContext: {
      summary: t(
        'Conditional write context: transaction chains accept only undefined; root chains accept operation context and the original concurrency policy.',
        '条件写上下文：事务链仅接受 undefined，根链接受操作上下文和原并发策略。'
      ),
      members: {}
    },
    IQueryDelete: {
      summary: t(
        'Deletion request with the original operation snapshot and separate optional concurrency policy.',
        '删除请求，包含原操作快照和独立可选并发策略。'
      ),
      members: {
        operation: {
          summary: {
            en: 'Delete discriminator for the original backend mutation owner.',
            zh: '原后端修改拥有者使用的删除操作区分字段。'
          }
        },
        ctx: {
          summary: {
            en: 'Same frozen context captured once by the shared query terminal.',
            zh: '共享查询终点捕获一次后复用的同一冻结上下文。'
          }
        },
        concurrency: {
          summary: {
            en: 'Original optional write policy passed beside ctx without recapturing its budget.',
            zh: '与上下文并列传递的原可选写策略，不再次捕获预算。'
          }
        }
      }
    },
    IRecordQueryMutation: {
      summary: t(
        'Record delete/update request with one detached patch for update; the original backend codec validates its value domain.',
        '记录 delete/update 请求，update 包含一份已分离的 patch，值域由原后端 codec 验证。'
      ),
      members: {
        operation: {
          summary: {
            en: 'Delete or patch discriminator for the transaction-bound selected record mutation.',
            zh: '事务绑定的选定记录删除或补丁操作区分字段。'
          }
        },
        patch: {
          summary: {
            en: 'Captured portable patch applied only to records selected by this same chain.',
            zh: '已捕获可移植补丁，仅应用于同一查询链选中的记录。'
          }
        },
        ctx: {
          summary: {
            en: 'Original captured query-write context retained by identity.',
            zh: '按身份保留的原始已捕获查询写入上下文。'
          }
        },
        concurrency: {
          summary: {
            en: 'Original optional concurrency policy, separate from the captured operation context.',
            zh: '独立于已捕获操作上下文的原可选并发策略。'
          }
        }
      }
    },
    IRdfQueryMutation: {
      summary: t(
        'Ground delete/replace request; replacement applies only to the canonical old quad actually selected.',
        'ground delete/replace 请求；替换仅应用于实际选中的规范 old quad。'
      ),
      members: {
        operation: {
          summary: {
            en: 'Delete or ground replacement discriminator for the original RDF draft owner.',
            zh: '原三元组草稿拥有者使用的删除或完整替换操作区分字段。'
          }
        },
        oldQuad: {
          summary: {
            en: 'Canonical old ground quad; replacement accepts only an actually selected matching identity.',
            zh: '规范旧完整三元组，仅实际选中的匹配身份接受替换。'
          }
        },
        newQuad: {
          summary: {
            en: 'Canonical replacement ground quad captured before mutation begins.',
            zh: '修改开始前捕获的规范替换完整三元组。'
          }
        },
        ctx: {
          summary: {
            en: 'Original frozen operation context captured by the shared write terminal.',
            zh: '共享写入终点捕获的原冻结操作上下文。'
          }
        },
        concurrency: {
          summary: {
            en: 'Original optional write policy forwarded without rebuilding ctx.',
            zh: '不重建操作上下文而转发的原可选写入策略。'
          }
        }
      }
    },
    IQueryMutationPort: {
      summary: t(
        'Original transaction-bound execute and accept callbacks; no independent writer, lock or lifecycle authority.',
        '原事务内 execute/accept 回调，不具有独立写入、锁或生命周期权限。'
      ),
      members: {
        execute: {
          summary: {
            en: 'Original transaction-bound cursor source used by the same shared selection planner.',
            zh: '同一共享选择计划使用的原事务绑定游标来源。'
          }
        },
        accept: {
          summary: {
            en: 'Accept one canonical selected row in the same draft and return true only for a real accepted change.',
            zh: '在同一草稿接受单个规范选中条目，仅真实接受修改时返回真值。'
          }
        }
      }
    },
    IQueryMutator: {
      summary: t(
        'Original pipeline/transaction callback returning accepted draft count after root commit confirmation.',
        '原 pipeline/事务回调；根提交确认后返回已接纳 draft 数。'
      ),
      members: {}
    },
    IQueryReduction: {
      summary: t(
        'Finite native count/exists or numeric aggregate request without JavaScript callbacks.',
        '有限原生 count/exists 或数值 aggregate 请求，不含 JavaScript 回调。'
      ),
      members: {
        operation: {
          summary: {
            en: 'Request a native count, existence test or numeric aggregate on the current bounded query.',
            zh: '针对当前有界查询请求原生计数、存在判断或数字聚合。'
          },
          values: {
            count: {
              en: 'Count the current selected native query result.',
              zh: '计数当前选定原生查询结果。'
            },
            exists: {
              en: 'Return whether the current native selection has a member.',
              zh: '判断当前原生选择是否存在成员。'
            },
            aggregate: {
              en: 'Reduce the selected numeric field using the declared aggregate.',
              zh: '按声明聚合方式归约选定数字字段。'
            }
          }
        },
        aggregate: {
          summary: {
            en: 'Select the numeric scalar operation without materializing all rows in a second reader.',
            zh: '选择数字标量操作，不通过第二读取器载入全部行。'
          },
          values: {
            min: {
              en: 'Smallest selected numeric value.',
              zh: '选择最小的有效数字值。'
            },
            max: {
              en: 'Largest selected numeric value.',
              zh: '选择最大的有效数字值。'
            },
            sum: {
              en: 'Sum selected numeric values.',
              zh: '累计选定的有效数字值。'
            },
            avg: {
              en: 'Mean of selected numeric values.',
              zh: '求选定有效数字值的平均数。'
            }
          }
        },
        field: {
          summary: t('Numeric field in the current result domain.', '当前结果域的数值字段。')
        }
      }
    },
    IQueryReductionResult: {
      summary: t(
        'Number, boolean or the existing Maybe<number> returned in one native scalar row.',
        '原生单行标量携带的 number、boolean 或既有 Maybe<number>。'
      ),
      members: {}
    },
    IQueryReducer: {
      summary: t(
        'Family-typed optional native scalar cursor callback; no independent runner or lifetime.',
        '按家族精确类型的可选原生标量游标回调，不另建 runner 或生命周期。'
      ),
      members: {}
    },
    IQueryNativeStep: {
      summary: t(
        'Ordered native where/select/limit/skip/distinct/primary-order/keyset-after steps; no JavaScript callback translation.',
        '有序原生 where/select/limit/skip/distinct/主键order/键集after 步骤，不翻译 JavaScript 回调。'
      ),
      members: {
        operation: {
          summary: {
            en: 'Canonical native terminal step kind; ordered steps remain the authoritative planner history.',
            zh: '规范原生终点步骤种类，有序步骤仍是计划执行历史的依据。'
          },
          values: {
            enum: 'QueryOperation'
          }
        },
        condition: {
          summary: {
            en: 'Canonical payload condition already captured by the shared parser.',
            zh: '已由共享解析器捕获的规范载荷条件树。'
          }
        },
        fields: {
          summary: {
            en: 'Original selected property paths, preserving declared projection order.',
            zh: '原始选定属性路径，保留声明的投影顺序。'
          }
        },
        count: {
          summary: {
            en: 'Validated nonnegative bound used by the native limit step.',
            zh: '原生数量限制步骤使用的已校验非负上界。'
          }
        },
        field: {
          summary: t(
            'Distinct field with the shared SameValueZero identity contract.',
            '按共享 SameValueZero 身份语义去重的字段。'
          )
        },
        by: {
          summary: {
            en: 'The key-order discriminator selects canonical key ordering, never a separate property comparator.',
            zh: '键排序区分字段选择规范键顺序，不代表独立属性比较器。'
          }
        },
        direction: {
          summary: {
            en: 'Native order or cursor direction, preserving the same canonical ordered-key domain.',
            zh: '原生排序或游标方向，保留同一规范保序键领域。'
          },
          values: {
            asc: {
              en: 'Native ascending canonical key order.',
              zh: '按规范键采用原生升序。'
            },
            desc: {
              en: 'Native descending canonical key order.',
              zh: '按规范键采用原生降序。'
            },
            next: {
              en: 'Advance from the cursor in forward key order.',
              zh: '从游标按正向键顺序继续。'
            },
            prev: {
              en: 'Advance from the cursor in reverse key order.',
              zh: '从游标按反向键顺序继续。'
            }
          }
        },
        key: {
          summary: {
            en: 'Canonical native order key retained by the shared query planner.',
            zh: '由共享查询计划保留的规范原生排序键。'
          }
        }
      }
    },
    IRecordOrderedQueryCore: {
      summary: t(
        'Selector-ordered branches preserve their exact family and Feature methods through later refinements.',
        '选择器排序的记录分支在后续细化中保留精确家族与原 Feature 方法，不再转换为比较器排序。'
      ),
      scenarios: [
        t(
          'Consume a backend-supplied record cursor through the immutable shared query plan.',
          '把后端提供的记录游标接入共享不可变查询，保留精确字段类型与原资源清理。'
        )
      ],
      example: storageContractCases.createRecordQuery![0]!.example,
      members: { ...recordQueryMembers, orderBy: queryOrderMember }
    },
    IRecordOrderedQuery: {
      summary: t(
        'Selector-ordered branches preserve their exact family and Feature methods through later refinements.',
        '选择器排序的记录分支在后续细化中保留精确家族与原 Feature 方法，不再转换为比较器排序。'
      ),
      scenarios: [
        t(
          'Consume a backend-supplied record cursor through the immutable shared query plan.',
          '把后端提供的记录游标接入共享不可变查询，保留精确字段类型与原资源清理。'
        )
      ],
      example: storageContractCases.createRecordQuery![0]!.example,
      members: { ...recordQueryMembers, orderBy: queryOrderMember }
    },
    IRecordQueryCore: {
      summary: t(
        'Record query entry adds mutually exclusive canonical selector and bounded comparator ordering.',
        '记录查询入口支持规范选择器排序或有界比较器排序，两个转换路径互斥并保留原资源归属。'
      ),
      scenarios: [
        t(
          'Consume a backend-supplied record cursor through the immutable shared query plan.',
          '把后端提供的记录游标接入共享不可变查询，保留精确字段类型与原资源清理。'
        )
      ],
      example: storageContractCases.createRecordQuery![0]!.example,
      members: {
        ...recordQueryMembers,
        orderBy: queryOrderMember,
        orderByComparator: {
          summary: t(
            'Enter opaque comparison ordering; declare a finite limit before ordinary read terminals.',
            '进入不透明比较器排序；使用普通读取终点之前，必须声明有限数量上限。'
          ),
          params: {
            compare: t(
              'Caller function comparing two current record rows using a negative, zero or positive numeric result.',
              '调用方提供的当前记录行比较函数，以负数、零或正数表示先后关系。'
            )
          },
          returns: t(
            'An IRecordQueryNeedsLimit with limit(count) and first(ctx); arbitrary comparison stays on the client.',
            '返回提供 limit(count) 与 first(ctx) 的 IRecordQueryNeedsLimit，任意比较函数在客户端执行。'
          ),
          example:
            'const rows = await query.orderByComparator((left, right) => left.total - right.total).limit(10).all()'
        }
      }
    },
    IRecordQueryBaseCore: {
      summary: t(
        'Common record controls retain filtering, projection, statistics, keyset pages and original transactional mutations.',
        '记录公共控制保留过滤、一次投影、统计、键集分页与原事务变更，排序模式由当前类型决定。'
      ),
      scenarios: [
        t(
          'Consume a backend-supplied record cursor through the immutable shared query plan.',
          '把后端提供的记录游标接入共享不可变查询，保留精确字段类型与原资源清理。'
        )
      ],
      example: storageContractCases.createRecordQuery![0]!.example,
      members: recordQueryMembers
    },
    IQueryRead: {
      summary: t(
        'Shared read terminals retain precise row types and the original backend cursor lifetime.',
        '共享读取终点保留精确结果行类型，沿用原后端游标的生命周期与清理约定。'
      ),
      scenarios: [
        t(
          'Consume a backend-supplied record cursor through the immutable shared query plan.',
          '把后端提供的记录游标接入共享不可变查询，保留精确字段类型与原资源清理。'
        )
      ],
      example: storageContractCases.createRecordQuery![0]!.example,
      members: queryReadMembers
    },
    IQueryResult: {
      summary: t(
        'A projected result retains reads and Feature methods; statistics and pages exist only when TStatistics is true.',
        '投影结果保留读取与 Feature 方法；仅 TStatistics 为 true 时提供数值统计与键集分页。'
      ),
      scenarios: [
        t(
          'Consume a backend-supplied record cursor through the immutable shared query plan.',
          '把后端提供的记录游标接入共享不可变查询，保留精确字段类型与原资源清理。'
        )
      ],
      example: storageContractCases.createRecordQuery![0]!.example,
      members: {
        ...queryReadMembers,
        ...queryStatisticsMembers,
        page: queryPageMember,
        requirePushdown: queryChainMembers.requirePushdown!
      }
    },
    IQueryConditions: {
      summary: t(
        'Type-only reusable where overloads returning the caller-supplied exact branch type. Object, field/operator/value and synchronous predicate forms reuse the original field and operand constraints.',
        '仅包含类型的可复用 where 重载，返回调用方指定的精确分支类型。对象、字段与运算符和值、同步谓词三种写法复用原字段和操作数约束。'
      ),
      scenarios: [
        t(
          'Adapt an entity branch without widening its conditions or copying the shared query field domain.',
          '适配实体查询分支，同时保留精确条件约束，不复制共享查询字段域。'
        )
      ],
      example: storageContractCases.createRecordQuery![0]!.example,
      members: { where: queryChainMembers.where! }
    },
    IQueryChain: {
      summary: t(
        'Immutable filtering and one projection compose over the original read terminals.',
        '不可变过滤与一次投影建立在原读取终点上，分支保留所属家族和 Feature 方法。'
      ),
      scenarios: [
        t(
          'Consume a backend-supplied record cursor through the immutable shared query plan.',
          '把后端提供的记录游标接入共享不可变查询，保留精确字段类型与原资源清理。'
        )
      ],
      example: storageContractCases.createRecordQuery![0]!.example,
      members: queryChainMembers
    },
    IRecordQuerySourcePlan: {
      summary: t(
        'Readonly terminal-local source facts returned to the original planner. Only the author interprets selection; explain exposes source diagnostics without exposing that opaque fact.',
        '返回原规划器的只读终点局部来源事实。只有作者解释 selection；explain 仅公开来源诊断，不公开该不透明事实。'
      ),
      members: {
        fullScan: {
          summary: t(
            'Optional true-only conservative scan fact: the selected native source may fall back to scanning. It can enlarge explain.fullScan, never claim a proven no-scan path.',
            '只允许为 true 的可选保守扫描事实，表示选定原生来源仍可能回退扫描。只能扩大 explain.fullScan，不能声称已经证明无需扫描。'
          )
        },
        pushdown: {
          summary: t(
            'Faithful native operations and operators for this exact selected source or index.',
            '当前精确选定来源或索引能够忠实执行的原生操作与运算符。'
          )
        },
        selection: {
          summary: t(
            'Optional immutable author-owned source fact passed unchanged to original execute, reduce, scoped mutation reads and watch.',
            '可选的作者拥有的不可变来源事实，原样传给原 execute、reduce、事务写入读取与 watch。'
          )
        },
        ...querySourceReasonMembers
      }
    },
    IRecordQuerySource: {
      summary: t(
        'Author seam with one execute callback returning the original unknown-row IStorageIterator; no new resource owner.',
        '作者接点：一个 execute 回调返回原 unknown 行 IStorageIterator，不新增资源 owner。'
      ),
      members: {
        plan: {
          summary: t(
            'Optional pure source selection over the once-captured canonical leading where conditions. The original planner stops at its first chain barrier, captures the result once and reuses it for execution and explain; no extra parser or resource owner is added.',
            '针对一次捕获的前缀规范 where 条件进行可选纯来源选择。原规划器在首个链屏障处停止，捕获一次结果并供执行与 explain 共用，不新增解析器或资源拥有者。'
          )
        },
        watch: {
          summary: t(
            'Optional native subscription callback; accepts the same complete native input and returns the original change iterator. Client steps reject before subscription; no shared event queue or lifetime wrapper is added.',
            '可选原生订阅回调，接收同一完整原生输入并返回原 change iterator；客户端步骤在订阅前拒绝，不新增共享事件队列或生命周期包装。'
          )
        },
        mutate: {
          summary: t(
            'Optional original write pipeline/transaction callback. Supply transaction-bound execute and accept(key,row); only unique selected rows accepted with true count. Root completion must await native commit; ctx is the original snapshot and concurrency is separate original policy metadata.',
            '可选原写 pipeline/事务回调，提供事务内 execute 与 accept(key,row)；仅去重选中且返回 true 的行计数，根终点等待原生提交；ctx 为原快照，concurrency 为独立原策略元数据。'
          )
        },
        reduce: {
          summary: t(
            'Optional native one-row scalar cursor for declared count/exists/aggregate support; uses the original resource owner.',
            '可选原生单行标量游标，兑现声明的 count/exists/aggregate，复用原资源 owner。'
          )
        },
        cursorSource: {
          summary: t(
            'Optional single-read private collection identity, reused by equivalent query descriptors; never exposed by a cursor.',
            '可选单读的私有 collection 身份，等价描述器复用，游标不暴露此对象。'
          )
        },
        nativeSteps: {
          summary: t(
            'Opt in to authoritative ordered native steps; omission preserves legacy execute arguments.',
            '选择有序原生 steps 为执行依据；省略保留旧 execute 参数。'
          )
        },
        pushdown: {
          summary: {
            en: 'Captured faithful native operation declarations consumed by the original shared planner.',
            zh: '由原共享计划消费的已捕获忠实原生操作声明。'
          }
        },
        asyncDisposeKey: {
          summary: {
            en: 'Optional original async-disposal symbol captured once; omission uses the native symbol without creating another owner.',
            zh: '捕获一次的可选原异步释放符号，省略时使用原生符号，不创建其它资源拥有者。'
          }
        },
        execute: {
          summary: {
            en: 'Execute pushed native record conditions and projections through the original bounded cursor. ',
            zh: '通过原有界游标执行已下推的原生记录条件与投影。'
          }
        },
        tieBreakByKey: {
          summary: {
            en: 'Declare deterministic canonical-key ordering for equal native sort values when the source actually supplies it.',
            zh: '仅来源实际提供时，声明相同原生排序值按规范键确定顺序。'
          }
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
          summary: {
            en: 'Distinguish native acquisition refusal from a commit conflict after full rollback and cleanup.',
            zh: '区分原生获取拒绝与已完整回滚清理后的提交冲突。'
          },
          values: {
            acquire: {
              en: 'Native acquisition was refused before commit.',
              zh: '原生获取在提交前被拒绝。'
            },
            commit: {
              en: 'Commit validation conflicted after the attempt ended.',
              zh: '尝试结束后确认提交验证发生冲突。'
            }
          }
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
          summary: {
            en: 'Try immediately first; waiting is admitted only after an acquisition-conflict decision.',
            zh: '首次立即尝试，仅获取冲突决策允许后才进入等待准入。'
          },
          values: {
            try: {
              en: 'Attempt native admission without logical waiting.',
              zh: '不进行逻辑等待，直接尝试原生准入。'
            },
            wait: {
              en: 'Wait under the same original operation deadline.',
              zh: '在同一原操作期限内等待准入。'
            }
          }
        },
        locking: {
          summary: {
            en: 'Effective original pessimistic or optimistic policy mode.',
            zh: '当前实际生效的原悲观或乐观并发策略模式。'
          }
        },
        waitTimeoutMs: {
          summary: t(
            'Remaining logical budget; physical scheduling does not consume it.',
            '剩余逻辑预算，物理调度不消耗它。'
          )
        },
        wait: {
          summary: {
            en: 'Wait for logical admission and account only actual logical blocking.',
            zh: '等待逻辑准入，并仅累计实际逻辑阻塞时间。'
          },
          params: {
            pendingAdmission: {
              en: 'Original native admission Promise supplied by the backend attempt owner.',
              zh: '后端尝试拥有者提供的原生准入结果。'
            }
          },
          returns: {
            en: 'The original admission value; timeout or cancellation remains owned by the one outer budget.',
            zh: '返回原准入值，超时与取消仍由唯一外层预算拥有。'
          }
        },
        waitPhysical: {
          summary: {
            en: 'Wait for native physical admission under the unchanged original operation deadline.',
            zh: '在未改变的原操作期限内等待原生物理准入。'
          },
          params: {
            pendingAdmission: {
              en: 'Original native admission Promise supplied by the backend attempt owner.',
              zh: '后端尝试拥有者提供的原生准入结果。'
            }
          },
          returns: {
            en: 'The original admission value; timeout or cancellation remains owned by the one outer budget.',
            zh: '返回原准入值，超时与取消仍由唯一外层预算拥有。'
          }
        },
        lock: {
          summary: {
            en: 'Canonical identities captured once by the original transaction-options owner.',
            zh: '由原事务选项拥有者捕获一次的规范锁身份集合。'
          }
        },
        concurrency: {
          summary: {
            en: 'Original authentic policy inherited without changing the enclosing operation budget.',
            zh: '继承的原始真实策略，不改变外层操作预算。'
          }
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
          summary: {
            en: 'Run one native attempt through complete commit or rollback and resource cleanup.',
            zh: '执行单次原生尝试，直到完整提交或回滚及资源清理。'
          },
          params: {
            context: {
              en: 'Captured authentic attempt intent, lock identities and original operation budget.',
              zh: '已捕获的真实尝试意图、锁身份与原操作预算。'
            }
          },
          returns: {
            en: 'Committed value or a completed conflict; a signal alone never means native resources are released.',
            zh: '返回已提交值或已结束冲突，信号本身不表示原生资源已释放。'
          }
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
          summary: {
            en: 'Distinguish native acquisition refusal from a commit conflict after full rollback and cleanup.',
            zh: '区分原生获取拒绝与已完整回滚清理后的提交冲突。'
          },
          values: {
            acquire: {
              en: 'Native acquisition was refused before commit.',
              zh: '原生获取在提交前被拒绝。'
            },
            commit: {
              en: 'Commit validation conflicted after the attempt ended.',
              zh: '尝试结束后确认提交验证发生冲突。'
            }
          }
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
          summary: {
            en: 'Original optional operation signal observed by the canonical conflict decision.',
            zh: '规范冲突决策所观察到的原可选操作取消信号。'
          }
        }
      }
    },
    ILockHolding: {
      summary: t(
        'One inspectable lock identity and lease state; expiry does not prove a process has died.',
        '一份可检查的锁身份和租约状态；到期不证明进程已死。'
      ),
      members: {
        key: {
          summary: {
            en: 'Canonical channel-specific key returned by the original native inspection owner.',
            zh: '由原生检查拥有者返回的规范通道锁键。'
          }
        },
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
      },
      scenarios: [
        {
          en: 'Display native lock inspection without treating expiry as proof that a remote process died.',
          zh: '展示原生锁检查，不将租期过期当作远端进程死亡证据。'
        }
      ],
      example:
        "import type { ILockHolding } from '@migaia/storage-contract'\nexport function describe(holding: ILockHolding) {\n  console.log(holding.key, holding.expired, holding.expiresAt)\n}"
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
      },
      scenarios: [
        {
          en: 'Read the transaction identity supplied by the original admitted scope owner.',
          zh: '读取原准入作用域拥有者给出的事务身份。'
        }
      ],
      example:
        "import type { ITransactionInfo } from '@migaia/storage-contract'\nexport function inspect(info: ITransactionInfo) { console.log(info.id, info.activityMode) }"
    },
    ITransactionKeyValueApi: {
      summary: t(
        'Standard transaction text API bound to one original owner, without root operation contexts.',
        '绑定原拥有者的标准事务文本 API，不接受根操作上下文。'
      ),
      members: {
        get: {
          summary: {
            en: 'Read the current transaction text draft and its original native snapshot.',
            zh: '读取当前事务的文本草稿与原生快照，能看到本作用域写入。'
          },
          params: {
            key: {
              en: 'Application-assigned logical key, or the key returned by the same original backend.',
              zh: '应用指定的逻辑键，或同一原始后端返回的键。'
            }
          },
          returns: {
            en: 'Stored text or null for absence, without leaving the authentic transaction scope.',
            zh: '返回已存文本，不存在时为空，不离开真实事务作用域。'
          }
        },
        set: {
          summary: {
            en: 'Stage one text value in the original transaction draft.',
            zh: '在原事务草稿中暂存单个文本值，随原生终点提交。'
          },
          params: {
            key: {
              en: 'Application-assigned logical key, or the key returned by the same original backend.',
              zh: '应用指定的逻辑键，或同一原始后端返回的键。'
            },
            value: {
              en: 'Application text payload, encoded before entering this channel when necessary.',
              zh: '应用文本载荷，需要时应在进入此通道前完成编码。'
            },
            options: {
              en: 'Optional original conflict policy; execution context is inherited from the transaction.',
              zh: '可选原冲突策略，执行上下文继承所属事务。'
            }
          },
          returns: {
            en: 'The draft accepts the write; durability is confirmed only by the outer commit.',
            zh: '草稿接受写入，仅外层提交才能确认持久化。'
          }
        },
        remove: {
          summary: {
            en: 'Stage removal of one text identity in this original transaction.',
            zh: '在当前原事务中暂存单个文本身份的删除。'
          },
          params: {
            key: {
              en: 'Application-assigned logical key, or the key returned by the same original backend.',
              zh: '应用指定的逻辑键，或同一原始后端返回的键。'
            }
          },
          returns: {
            en: 'The draft accepts deletion; removing an absent entry is a no-op.',
            zh: '草稿接受删除，不存在的条目不产生修改。'
          }
        },
        has: {
          summary: {
            en: 'Check visible text membership in the current authentic transaction draft.',
            zh: '检查当前真实事务草稿中可见的文本成员关系。'
          },
          params: {
            key: {
              en: 'Application-assigned logical key, or the key returned by the same original backend.',
              zh: '应用指定的逻辑键，或同一原始后端返回的键。'
            }
          },
          returns: {
            en: 'True when the draft currently exposes an unexpired text value.',
            zh: '当前草稿存在未过期文本值时返回真值。'
          }
        },
        getMany: {
          summary: {
            en: 'Read one original transaction text snapshot in caller order, including duplicate positions.',
            zh: '按调用方顺序读取原事务文本快照，并保留重复位置。'
          },
          params: {
            keys: {
              en: 'Logical text keys captured before the shared batch is read.',
              zh: '共享批量读取前捕获的逻辑文本键集合。'
            }
          },
          returns: {
            en: 'Same-length values with undefined for missing entries; partial decode success is not returned.',
            zh: '返回同长度值数组，缺失为未定义，不返回部分解码成功。'
          }
        },
        setMany: {
          summary: {
            en: 'Stage a validated text batch inside the same original transaction draft.',
            zh: '在同一原事务草稿内暂存完整校验后的文本批量。'
          },
          params: {
            entries: {
              en: 'Dense key/value entries with optional TTL; duplicate canonical identities reject before mutation.',
              zh: '稠密键值条目与可选期限，规范重复身份在修改前拒绝。'
            }
          },
          returns: {
            en: 'All accepted entries join the original commit or rollback together.',
            zh: '全部已接受条目共同加入原提交或回滚。'
          }
        },
        removeMany: {
          summary: {
            en: 'Stage deletion of distinct canonical text identities in the same transaction.',
            zh: '在同一事务中暂存去重后的规范文本身份删除。'
          },
          params: {
            keys: {
              en: 'Logical text keys; equivalent duplicates are accepted only once for counting.',
              zh: '逻辑文本键，等价重复项仅参与一次删除计数。'
            }
          },
          returns: {
            en: 'Number of actual draft removals; final durability still follows outer commit.',
            zh: '返回草稿实际删除数，最终持久化仍随外层提交。'
          }
        },
        removeByPrefix: {
          summary: {
            en: 'Remove matching text entries from the current native and draft key range.',
            zh: '从当前原生与草稿键范围中删除匹配的文本条目。'
          },
          params: {
            prefix: {
              en: 'Canonical typed prefix in the existing ordered logical-key domain.',
              zh: '既有保序逻辑键域中的规范类型化前缀。'
            }
          },
          returns: {
            en: 'Actual accepted draft deletion count, without scanning unrelated channels.',
            zh: '返回草稿实际接受删除数，不扫描无关通道。'
          }
        }
      }
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
          summary: {
            en: 'Release accepted work and original native resources without acquiring any new close authority.',
            zh: '排空已接受工作并释放原生资源，不获取新的关闭权限。'
          },
          params: {},
          returns: {
            en: 'The original cached main cleanup Promise; native cleanup failure rejects with its original reachable cause.',
            zh: '返回原缓存主清理结果，原生清理失败以可追踪的原始原因拒绝。'
          }
        },
        '[Symbol.asyncDispose]': {
          summary: {
            en: 'Use the original asynchronous resource-disposal protocol after accepted work drains.',
            zh: '在已接受工作排空后使用原异步资源释放协议。'
          },
          params: {},
          returns: {
            en: 'The separately cached symbolic Promise reports cleanup failure and resolves, without replacing the main cleanup Promise.',
            zh: '单独缓存的符号清理报告失败后完成，不替换主清理结果。'
          }
        }
      }
    },
    IStorageIterator: {
      summary: t(
        'Asynchronous iterator and owned cleanup resource.',
        '异步迭代器及其自有清理资源。'
      ),
      members: {
        dispose: {
          summary: {
            en: 'Release accepted work and original native resources without acquiring any new close authority.',
            zh: '排空已接受工作并释放原生资源，不获取新的关闭权限。'
          },
          params: {},
          returns: {
            en: 'The original cached main cleanup Promise; native cleanup failure rejects with its original reachable cause.',
            zh: '返回原缓存主清理结果，原生清理失败以可追踪的原始原因拒绝。'
          },
          example:
            "import type { IStorageIterator } from '@migaia/storage-contract'\nexport async function consume(stream: IStorageIterator<string>) {\n  await using resource = stream\n  for await (const value of resource) console.log(value)\n}"
        },
        '[Symbol.asyncDispose]': {
          summary: {
            en: 'Use the original asynchronous resource-disposal protocol after accepted work drains.',
            zh: '在已接受工作排空后使用原异步资源释放协议。'
          },
          params: {},
          returns: {
            en: 'The separately cached symbolic Promise reports cleanup failure and resolves, without replacing the main cleanup Promise.',
            zh: '单独缓存的符号清理报告失败后完成，不替换主清理结果。'
          },
          example:
            "import type { IStorageIterator } from '@migaia/storage-contract'\nexport async function consume(stream: IStorageIterator<string>) {\n  await using resource = stream\n  for await (const value of resource) console.log(value)\n}"
        }
      },
      scenarios: [
        {
          en: 'Drain native asynchronous entries and release the same original iterator resource.',
          zh: '排空原生异步条目并释放同一原迭代资源。'
        }
      ],
      example:
        "import type { IStorageIterator } from '@migaia/storage-contract'\nexport async function consume(stream: IStorageIterator<string>) {\n  await using resource = stream\n  for await (const value of resource) console.log(value)\n}"
    },
    IStorageIteratorLifetime: {
      summary: t(
        'Original backend-author advance and cleanup functions. It supplies no admission check or transaction authority; native callers retain those responsibilities.',
        '原后端作者推进和清理函数，不提供准入检查或事务权限；这些职责仍由原生调用方持有。'
      ),
      members: {
        isClosing: {
          summary: {
            en: 'Read whether the original cached main cleanup has stopped accepting new work.',
            zh: '读取原缓存主清理是否已经停止接受新工作。'
          }
        },
        advance: {
          summary: {
            en: 'Track one accepted native iterator advance until settlement before cleanup can release resources.',
            zh: '追踪单次已接受的原生迭代推进，结算后清理才可释放资源。'
          }
        },
        dispose: {
          summary: {
            en: 'Return the cached main cleanup Promise that drains accepted advances before native close.',
            zh: '返回缓存主清理结果，在原生关闭前排空已接受推进。'
          }
        },
        returned: {
          summary: {
            en: 'Return the cached iterator-return result after the same original cleanup has settled.',
            zh: '同一原清理结算后返回缓存的迭代退出结果。'
          }
        },
        symbolic: {
          summary: {
            en: 'Use the separately cached symbolic cleanup Promise, reporting failures without rejecting disposal.',
            zh: '使用单独缓存的符号清理结果，报告失败但不拒绝符号释放。'
          }
        }
      },
      example:
        "import { createStorageIteratorLifetime } from '@migaia/storage-contract'\nconst life = createStorageIteratorLifetime<string>({ close: async () => undefined, report: error => console.error(error) })\nconsole.log(await life.advance(async () => ({ done: false, value: 'ready' })))\nawait life.dispose()",
      scenarios: [
        {
          en: 'Backend authors drain accepted iterator work before releasing an existing native cursor.',
          zh: '后端作者在释放既有原生游标前，排空已接受的迭代工作。'
        }
      ]
    },
    IStorageBaseAdmission: {
      summary: t(
        'Non-owning single-read base admission retains the original object, disposer receiver and exact reflection failure.',
        '不取得所有权的单读基础准入，保留原对象、释放接收者和精确反射失败。'
      ),
      members: {
        valid: {
          summary: {
            en: 'Discriminates complete admitted storage facts from a captured admission failure.',
            zh: '区分完整准入的存储事实与已捕获的准入失败。'
          }
        },
        store: {
          summary: {
            en: 'Exact original accepted base object, retaining its receiver and hidden members.',
            zh: '精确的原准入基础对象，保留接收者与隐藏成员。'
          }
        },
        backend: {
          summary: {
            en: 'Captured valid backend label without constructing a different backend.',
            zh: '捕获的合法后端标签，不创建其它后端实例。'
          }
        },
        capabilities: {
          summary: {
            en: 'Detached capability facts captured once from the original base.',
            zh: '从原基础对象捕获一次的独立能力事实。'
          }
        },
        dispose: {
          summary: {
            en: 'Original explicit cleanup function captured without invoking it.',
            zh: '不调用清理动作，仅捕获原显式清理函数。'
          }
        },
        receiver: {
          summary: {
            en: 'Exact original receiver required by the captured cleanup methods.',
            zh: '已捕获清理方法所需的精确原始接收者。'
          }
        },
        asyncDispose: {
          summary: {
            en: 'Original symbolic cleanup function captured for the same base lifetime.',
            zh: '为同一基础对象生命周期捕获的原符号清理函数。'
          }
        },
        cause: {
          summary: {
            en: 'Original reflection or accessor failure retained on rejected admission.',
            zh: '准入拒绝时保留的原反射或访问器失败原因。'
          }
        }
      },
      scenarios: [
        {
          en: 'Inspect unknown storage input without executing its operations or invoking its disposer.',
          zh: '检查未知存储输入，不执行操作或调用其释放器。'
        }
      ],
      example:
        "import { snapshotStorageBaseDetailed } from '@migaia/storage-contract'\nexport function inspect(value: unknown) {\n  const admission = snapshotStorageBaseDetailed(value)\n  if (admission.valid) console.log(admission.backend)\n}"
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
          summary: {
            en: 'Original public operation observer bindings, kept separate from native source execution.',
            zh: '原公开操作观察绑定，与原生来源执行保持独立。'
          }
        },
        codecStages: {
          summary: {
            en: 'Original encode/decode observer bindings owned by the selected codec.',
            zh: '由所选编解码器拥有的原编码与解码观察绑定。'
          }
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
          summary: {
            en: 'Original native SQL observer bindings on the same compiled statement path.',
            zh: '同一已编译语句路径上的原生查询观察绑定。'
          }
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
      summary: {
        en: 'Observation-only construction, publication and disposal callbacks using the original host registry.',
        zh: '使用原宿主登记表观察构造、发布与释放阶段的只读回调集合。'
      },
      members: {
        kind: {
          summary: {
            en: 'Backend stage discriminator retained by the original host observer registry.',
            zh: '原宿主观察者登记表保留的后端阶段区分字段。'
          },
          values: {
            enum: 'StorageStageKind'
          }
        },
        beforeBackendCreate: {
          summary: {
            en: 'Observe the original native backend before construction begins.',
            zh: '在原生后端开始构造之前观察原始构造阶段。'
          }
        },
        afterBackendCreate: {
          summary: {
            en: 'Observe the created native backend before public installation completes.',
            zh: '公开安装完成前观察已经创建的原生后端。'
          }
        },
        onBackendRejected: {
          summary: {
            en: 'Observe original backend construction or admission rejection without replacing its cause.',
            zh: '观察原后端构造或准入拒绝，不替换原始错误原因。'
          }
        },
        afterBackendInstall: {
          summary: {
            en: 'Observe successful public backend publication in the original install window.',
            zh: '在原安装窗口观察后端成功完成公开发布。'
          }
        },
        onBackendDisposeStart: {
          summary: {
            en: 'Observe the original backend entering disposal before accepted work drains.',
            zh: '在已接受工作排空前观察原后端开始进入释放。'
          }
        },
        afterBackendDispose: {
          summary: {
            en: 'Observe native resource cleanup after the original backend disposal settles.',
            zh: '原后端释放结算后观察原生资源清理结果。'
          }
        },
        report: {
          summary: {
            en: 'Report observer failures through the original owner without replacing the primary operation result.',
            zh: '经原拥有者报告观察者失败，不替换首要操作结果。'
          }
        }
      }
    },
    IStorageOperationStageObserver: {
      summary: t(
        'Observe store operations bound to original transaction views.',
        '观察绑定原事务视图的存储操作。'
      ),
      members: {
        kind: {
          summary: {
            en: 'Storage operation stage discriminator retained by the original operation owner.',
            zh: '原操作拥有者保留的存储操作阶段区分字段。'
          },
          values: {
            enum: 'StorageStageKind'
          }
        },
        forTransaction: {
          summary: {
            en: 'Bind operation observations to the authentic current transaction view.',
            zh: '将操作观察绑定到真实当前事务视图。'
          }
        },
        beforeStorageOperation: {
          summary: {
            en: 'Observe one admitted public storage endpoint before native work begins.',
            zh: '原生工作开始前观察单个已准入公开存储终点。'
          }
        },
        afterStorageOperation: {
          summary: {
            en: 'Observe completed public work once after the original accepted endpoint settles.',
            zh: '原已接受终点结算后观察一次完成的公开工作。'
          }
        },
        onStorageOperationError: {
          summary: {
            en: 'Observe original operation failure without replacing its primary native cause.',
            zh: '观察原操作失败，不替换首要原生错误原因。'
          }
        },
        onStorageIterationClose: {
          summary: {
            en: 'Observe original iterator closure after its accepted native advances drain.',
            zh: '已接受原生推进排空后观察原迭代器关闭。'
          }
        },
        report: {
          summary: {
            en: 'Report observer failures through the original owner without replacing the primary operation result.',
            zh: '经原拥有者报告观察者失败，不替换首要操作结果。'
          }
        }
      }
    },
    ITransactionStageObserver: {
      summary: t(
        'Observe original transaction operations, commit and cleanup.',
        '观察原事务操作、提交与清理。'
      ),
      members: {
        kind: {
          summary: {
            en: 'Transaction stage discriminator belonging to the original native transaction owner.',
            zh: '原生事务拥有者所属的事务阶段区分字段。'
          },
          values: {
            enum: 'StorageStageKind'
          }
        },
        forTransaction: {
          summary: {
            en: 'Bind observer callbacks to this same authentic native scope.',
            zh: '将观察回调绑定到同一真实原生事务作用域。'
          }
        },
        beforeTransaction: {
          summary: {
            en: 'Observe the captured original transaction intent before native admission.',
            zh: '原生准入前观察已捕获的原事务意图。'
          }
        },
        onTransactionStart: {
          summary: {
            en: 'Observe the actual admitted native attempt after original scope creation.',
            zh: '原作用域创建后观察实际准入的原生尝试。'
          }
        },
        beforeTxOperation: {
          summary: {
            en: 'Observe an admitted operation before it changes the original transaction draft.',
            zh: '改变原事务草稿前观察已经准入的单个操作。'
          }
        },
        afterTxOperation: {
          summary: {
            en: 'Observe original transaction-operation settlement without committing early.',
            zh: '观察原事务操作结算，不提前提交事务。'
          }
        },
        beforeCommit: {
          summary: {
            en: 'Observe final original draft validation before the native commit is issued.',
            zh: '发出原生提交前观察原草稿的最终验证。'
          }
        },
        afterCommit: {
          summary: {
            en: 'Observe confirmed native commit after the original commit evidence is available.',
            zh: '取得原提交证据后观察已确认的原生提交。'
          }
        },
        afterRollback: {
          summary: {
            en: 'Observe completed original rollback while preserving the primary transaction failure.',
            zh: '观察已完成原回滚，并保留首要事务失败。'
          }
        },
        onTransactionClose: {
          summary: {
            en: 'Observe original scope closure after native work and accepted resources settle.',
            zh: '原生工作与已接受资源结算后观察原作用域关闭。'
          }
        },
        beforePersistFlush: {
          summary: {
            en: 'Observe original persistence flushing within the same transaction scope.',
            zh: '在同一事务作用域内观察原持久化刷新开始。'
          }
        },
        afterPersistFlush: {
          summary: {
            en: 'Observe completed original persistence flush without adding another transaction.',
            zh: '观察原持久化刷新完成，不创建第二事务。'
          }
        },
        report: {
          summary: {
            en: 'Report observer failures through the original owner without replacing the primary operation result.',
            zh: '经原拥有者报告观察者失败，不替换首要操作结果。'
          }
        }
      }
    },
    IConcurrencyStageObserver: {
      summary: t('Observe canonical lock and concurrency decisions.', '观察规范锁与并发决策。'),
      members: {
        kind: {
          summary: {
            en: 'Concurrency stage discriminator belonging to the original policy-loop observer.',
            zh: '原策略循环观察者所属的并发阶段区分字段。'
          },
          values: {
            enum: 'StorageStageKind'
          }
        },
        beforeLockAcquire: {
          summary: {
            en: 'Observe original policy name and canonical lock count before native acquisition.',
            zh: '原生获取前观察原策略名称与规范锁数量。'
          }
        },
        onLockAcquired: {
          summary: {
            en: 'Observe actual native acquisition and its original attempt number.',
            zh: '观察实际原生获取成功及其原尝试编号。'
          }
        },
        onLockConflict: {
          summary: {
            en: 'Observe acquisition or completed-rollback conflicts with detached key and holder facts.',
            zh: '观察获取或完整回滚后的冲突，以及独立键和持有者事实。'
          }
        },
        onLockWait: {
          summary: {
            en: 'Observe actual accumulated logical waiting in the original admission budget.',
            zh: '观察原准入预算中实际累计的逻辑等待时间。'
          }
        },
        onConcurrencyDecision: {
          summary: {
            en: 'Observe the authentic policy decision without authorizing another retry loop.',
            zh: '观察真实策略决策，不授予其它重试循环权限。'
          }
        },
        onRetry: {
          summary: {
            en: 'Observe original retry count, bounded delay and physical or write-conflict reason.',
            zh: '观察原重试计数、有界延迟以及物理或写冲突原因。'
          }
        },
        onLockReleased: {
          summary: {
            en: 'Observe final native lock release after the attempt owner has settled.',
            zh: '尝试拥有者结算后观察最终原生锁释放。'
          }
        },
        onLockLost: {
          summary: {
            en: 'Observe genuine native ownership loss without treating it as a successful unlock.',
            zh: '观察真实原生拥有权丢失，不将其当作成功解锁。'
          }
        },
        beforeLockInspect: {
          summary: {
            en: 'Observe the original lock inspection before the native read starts.',
            zh: '在原生读取开始前观察原锁检查阶段。'
          }
        },
        afterLockInspect: {
          summary: {
            en: 'Observe actual native inspection count without copying business payloads.',
            zh: '观察真实原生检查数量，不复制业务数据载荷。'
          }
        },
        onLockInspectError: {
          summary: {
            en: 'Observe original inspection error code while retaining its native error owner.',
            zh: '观察原检查错误码，并保留其原生错误拥有者。'
          }
        },
        report: {
          summary: {
            en: 'Report observer failures through the original owner without replacing the primary operation result.',
            zh: '经原拥有者报告观察者失败，不替换首要操作结果。'
          }
        }
      }
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
          summary: {
            en: 'Inclusive encoded lower bound from the original canonical ordered-key codec.',
            zh: '原规范保序键编解码器返回的包含式编码下界。'
          }
        },
        upper: {
          summary: t(
            'Guaranteed strict byte successor, exclusive.',
            '必有的严格字节后继，不包含端。'
          )
        },
        matches: {
          summary: {
            en: 'Compare one logical key against this already captured canonical typed prefix.',
            zh: '将单个逻辑键与已捕获的规范类型化前缀比较。'
          },
          params: {
            key: {
              en: 'Logical key supplied by the application or returned by its backend.',
              zh: '由应用提供或其后端返回的逻辑键。'
            }
          },
          returns: {
            en: 'True only when the original key-prefix semantics match.',
            zh: '仅符合原键前缀语义时返回真值。'
          },
          example:
            "import { snapshotStorageKeyPrefix } from '@migaia/storage-contract'\nconst prefix = snapshotStorageKeyPrefix(['users'], undefined)\nconsole.log(prefix.matches(['users', 1]))"
        }
      },
      scenarios: [
        {
          en: 'Share one canonical prefix boundary between ordered native ranges and logical matching.',
          zh: '在原生保序范围与逻辑匹配之间共用单个规范前缀边界。'
        }
      ],
      example:
        "import { snapshotStorageKeyPrefix } from '@migaia/storage-contract'\nconst prefix = snapshotStorageKeyPrefix(['users'], undefined)\nconsole.log(prefix.matches(['users', 1]))"
    },
    ITransactionCapabilityView: {
      summary: t(
        'Public optional contravariant capability proof and typed transaction use; complete external scopes need no private symbol.',
        '公开可选反变能力证明与 typed 事务 use；完整外部 scope 不需要私有 symbol。'
      ),
      members: {
        use: {
          summary: {
            en: 'Borrow the standard API projected by the same authentic transaction scope.',
            zh: '借用同一真实事务作用域投影的标准能力接口。'
          },
          params: {
            capability: {
              en: 'Original transactional token whose owner implements this projection.',
              zh: '由原拥有者实现事务投影的原始能力令牌。'
            }
          },
          returns: {
            en: 'The current draft-bound API, without new ownership or a second transaction.',
            zh: '返回绑定当前草稿的接口，不创建新的拥有权或第二事务。'
          }
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
          summary: {
            en: 'Build the shared record query against this authentic transaction draft.',
            zh: '在此真实事务草稿上创建共享记录查询链。'
          },
          params: {},
          returns: {
            en: 'A draft-bound query whose accepted writes settle with the original outer transaction.',
            zh: '返回绑定草稿的查询，写入随原外层事务结算。'
          }
        },
        removeByPrefix: {
          summary: {
            en: 'Delete matching record identities from the same native and draft prefix range.',
            zh: '从同一原生与草稿前缀范围删除匹配记录身份。'
          },
          params: {
            prefix: {
              en: 'Canonical typed prefix captured before the draft range is read.',
              zh: '读取草稿范围前捕获的规范类型化前缀。'
            }
          },
          returns: {
            en: 'Actual accepted draft deletion count, without committing early.',
            zh: '返回草稿实际接受删除数，不提前提交事务。'
          }
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
        changes: {
          summary: {
            en: 'Native number of rows changed by the executed statement, without a client-side recount.',
            zh: '已执行语句的原生影响行数，不在客户端重新计数。'
          }
        }
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
          summary: {
            en: 'Read every native row from the compiled parameterized SQL query.',
            zh: '从已编译参数化查询中读取全部原生结果行。'
          },
          params: {
            ctx: {
              en: 'Original optional operation context carrying one captured cancellation and timeout budget.',
              zh: '原可选操作上下文，承载单次捕获的取消与超时预算。'
            }
          },
          returns: {
            en: 'An ordered native row array using the backend scalar domain.',
            zh: '返回按原生顺序排列的数据行数组。'
          },
          example:
            "import type { ISqlTag } from '@migaia/storage-contract'\nexport async function read(sql: ISqlTag) {\n  const table = sql.id('notes')\n  const fields = sql.join([sql.id('id')], sql.empty)\n  const query = sql`SELECT ${fields} FROM ${table} WHERE id = ${1}`\n  console.log(await query.all(), await query.get())\n  await query.run()\n}"
        },
        get: {
          summary: {
            en: 'Read the first native row without inventing an empty-row object.',
            zh: '读取原生首行，不在空结果时虚构数据行对象。'
          },
          params: {
            ctx: {
              en: 'Original optional operation context carrying one captured cancellation and timeout budget.',
              zh: '原可选操作上下文，承载单次捕获的取消与超时预算。'
            }
          },
          returns: {
            en: 'The first native row, or undefined when the result is empty.',
            zh: '返回首个原生数据行，空结果时为未定义。'
          },
          example:
            "import type { ISqlTag } from '@migaia/storage-contract'\nexport async function read(sql: ISqlTag) {\n  const table = sql.id('notes')\n  const fields = sql.join([sql.id('id')], sql.empty)\n  const query = sql`SELECT ${fields} FROM ${table} WHERE id = ${1}`\n  console.log(await query.all(), await query.get())\n  await query.run()\n}"
        },
        run: {
          summary: {
            en: 'Execute the native compiled statement through its original SQL owner.',
            zh: '经原查询拥有者执行已编译的原生语句。'
          },
          params: {
            ctx: {
              en: 'Original optional operation context carrying one captured cancellation and timeout budget.',
              zh: '原可选操作上下文，承载单次捕获的取消与超时预算。'
            }
          },
          returns: {
            en: 'The native run result; confirmed row-change counts remain backend-owned.',
            zh: '返回原生执行结果，确认的行变更数仍归后端拥有。'
          },
          example:
            "import type { ISqlTag } from '@migaia/storage-contract'\nexport async function read(sql: ISqlTag) {\n  const table = sql.id('notes')\n  const fields = sql.join([sql.id('id')], sql.empty)\n  const query = sql`SELECT ${fields} FROM ${table} WHERE id = ${1}`\n  console.log(await query.all(), await query.get())\n  await query.run()\n}"
        }
      },
      example:
        "import type { ISqlTag } from '@migaia/storage-contract'\nexport async function read(sql: ISqlTag) {\n  const table = sql.id('notes')\n  const fields = sql.join([sql.id('id')], sql.empty)\n  const query = sql`SELECT ${fields} FROM ${table} WHERE id = ${1}`\n  console.log(await query.all(), await query.get())\n  await query.run()\n}",
      scenarios: [
        {
          en: 'Compose parameterized application queries while the concrete SQL backend owns execution and cleanup.',
          zh: '组合参数化应用查询，由具体数据库后端拥有执行与清理。'
        }
      ]
    },
    ISqlTag: {
      summary: t(
        'Typed backend tag and pure id/join/empty tools; TValue constrains native output fields and TResult retains execution results.',
        'Typed 后端标签与纯 id/join/empty 工具；TValue 约束原生输出字段，TResult 保留执行结果。'
      ),
      members: {
        id: {
          summary: {
            en: 'Quote a nonempty identifier path using the original SQL dialect owner.',
            zh: '由原查询方言拥有者引用非空标识符路径。'
          },
          params: {
            parts: {
              en: 'Application-assigned table, schema or column name segments, never raw SQL grammar.',
              zh: '应用指定的表、模式或列名称片段，不是原始查询语法。'
            }
          },
          returns: {
            en: 'An authentic quoted identifier fragment for this compiler.',
            zh: '返回此编译器的真实已引用标识符片段。'
          },
          example:
            "import type { ISqlTag } from '@migaia/storage-contract'\nexport async function read(sql: ISqlTag) {\n  const table = sql.id('notes')\n  const fields = sql.join([sql.id('id')], sql.empty)\n  const query = sql`SELECT ${fields} FROM ${table} WHERE id = ${1}`\n  console.log(await query.all(), await query.get())\n  await query.run()\n}"
        },
        join: {
          summary: {
            en: 'Join authentic SQL fragments without promoting arbitrary values into grammar.',
            zh: '连接真实查询片段，不将任意数据值提升为语法。'
          },
          params: {
            fragments: {
              en: 'Authentic fragments returned by the original SQL tag or identifier helper.',
              zh: '由原查询标签或标识符助手返回的真实片段。'
            },
            separator: {
              en: 'Authentic separator fragment; omission uses the original default separator.',
              zh: '真实分隔片段，省略时使用原默认分隔符。'
            }
          },
          returns: {
            en: 'A new authentic joined fragment, retaining parameter order.',
            zh: '返回新的真实连接片段，并保留参数顺序。'
          },
          example:
            "import type { ISqlTag } from '@migaia/storage-contract'\nexport async function read(sql: ISqlTag) {\n  const table = sql.id('notes')\n  const fields = sql.join([sql.id('id')], sql.empty)\n  const query = sql`SELECT ${fields} FROM ${table} WHERE id = ${1}`\n  console.log(await query.all(), await query.get())\n  await query.run()\n}"
        },
        empty: {
          summary: {
            en: 'Authentic empty SQL fragment used when a conditional grammar branch contributes no text.',
            zh: '条件语法分支不贡献正文时使用的真实空查询片段。'
          }
        }
      },
      example:
        "import type { ISqlTag } from '@migaia/storage-contract'\nexport async function read(sql: ISqlTag) {\n  const table = sql.id('notes')\n  const fields = sql.join([sql.id('id')], sql.empty)\n  const query = sql`SELECT ${fields} FROM ${table} WHERE id = ${1}`\n  console.log(await query.all(), await query.get())\n  await query.run()\n}",
      scenarios: [
        {
          en: 'Compose parameterized application queries while the concrete SQL backend owns execution and cleanup.',
          zh: '组合参数化应用查询，由具体数据库后端拥有执行与清理。'
        }
      ]
    },
    IStorageSqlQueryTerminals: {
      summary: t(
        'Finite callbacks replacing SQL query execution without altering fragment identity.',
        '替换 SQL 查询执行且不改变片段身份的有限回调。'
      ),
      members: {
        all: {
          summary: {
            en: 'Read every native row from the compiled parameterized SQL query.',
            zh: '从已编译参数化查询中读取全部原生结果行。'
          },
          params: {
            ctx: {
              en: 'Original optional operation context carrying one captured cancellation and timeout budget.',
              zh: '原可选操作上下文，承载单次捕获的取消与超时预算。'
            }
          },
          returns: {
            en: 'An ordered native row array using the backend scalar domain.',
            zh: '返回按原生顺序排列的数据行数组。'
          },
          example:
            "import type { ISqlTag } from '@migaia/storage-contract'\nexport async function read(sql: ISqlTag) {\n  const table = sql.id('notes')\n  const fields = sql.join([sql.id('id')], sql.empty)\n  const query = sql`SELECT ${fields} FROM ${table} WHERE id = ${1}`\n  console.log(await query.all(), await query.get())\n  await query.run()\n}"
        },
        get: {
          summary: {
            en: 'Read the first native row without inventing an empty-row object.',
            zh: '读取原生首行，不在空结果时虚构数据行对象。'
          },
          params: {
            ctx: {
              en: 'Original optional operation context carrying one captured cancellation and timeout budget.',
              zh: '原可选操作上下文，承载单次捕获的取消与超时预算。'
            }
          },
          returns: {
            en: 'The first native row, or undefined when the result is empty.',
            zh: '返回首个原生数据行，空结果时为未定义。'
          },
          example:
            "import type { ISqlTag } from '@migaia/storage-contract'\nexport async function read(sql: ISqlTag) {\n  const table = sql.id('notes')\n  const fields = sql.join([sql.id('id')], sql.empty)\n  const query = sql`SELECT ${fields} FROM ${table} WHERE id = ${1}`\n  console.log(await query.all(), await query.get())\n  await query.run()\n}"
        },
        run: {
          summary: {
            en: 'Execute the native compiled statement through its original SQL owner.',
            zh: '经原查询拥有者执行已编译的原生语句。'
          },
          params: {
            ctx: {
              en: 'Original optional operation context carrying one captured cancellation and timeout budget.',
              zh: '原可选操作上下文，承载单次捕获的取消与超时预算。'
            }
          },
          returns: {
            en: 'The native run result; confirmed row-change counts remain backend-owned.',
            zh: '返回原生执行结果，确认的行变更数仍归后端拥有。'
          },
          example:
            "import type { ISqlTag } from '@migaia/storage-contract'\nexport async function read(sql: ISqlTag) {\n  const table = sql.id('notes')\n  const fields = sql.join([sql.id('id')], sql.empty)\n  const query = sql`SELECT ${fields} FROM ${table} WHERE id = ${1}`\n  console.log(await query.all(), await query.get())\n  await query.run()\n}"
        }
      }
    },
    IBlobInfo: {
      summary: t(
        'Immutable metadata of an actual native object snapshot.',
        '实际原生对象快照的不可变 metadata。'
      ),
      members: {
        key: {
          summary: {
            en: 'Logical object key assigned by the application within this store namespace.',
            zh: '应用在当前存储命名空间内指定的逻辑对象键。'
          }
        },
        size: {
          summary: {
            en: 'Actual native object body length in bytes for this snapshot.',
            zh: '此快照所对应的真实原生对象正文字节长度。'
          }
        },
        etag: {
          summary: {
            en: 'Opaque original object version token used by native conditional writes.',
            zh: '原生条件写使用的不透明原始对象版本令牌。'
          }
        },
        contentType: {
          summary: {
            en: 'Optional content media type captured with the native object.',
            zh: '随原生对象一同捕获的可选内容媒体类型。'
          }
        },
        metadata: {
          summary: {
            en: 'Detached immutable string metadata belonging to this native object snapshot.',
            zh: '属于此原生对象快照的独立不可变字符串元数据。'
          }
        },
        updatedAt: {
          summary: {
            en: 'Native object last-modification time expressed in epoch milliseconds.',
            zh: '以纪元毫秒表示的原生对象最近修改时间。'
          }
        }
      }
    },
    IBlobObject: {
      summary: t(
        'One disposable, single-consumption native object snapshot.',
        '可释放且单次消费的原生对象快照。'
      ),
      members: {
        info: {
          summary: {
            en: 'Immutable native object metadata captured with this same open body snapshot.',
            zh: '与本次打开的正文快照同时捕获的不可变原生对象元数据。'
          }
        },
        stream: {
          summary: {
            en: 'Consume the one body right as a byte stream, mutually exclusive with bytes.',
            zh: '以字节流消费唯一正文读取权，与完整字节读取互斥。'
          },
          params: {},
          returns: {
            en: 'The original snapshot stream; a second consumption rejects before native reading.',
            zh: '返回原快照流，第二次消费在原生读取前拒绝。'
          },
          example:
            "import { blob, type IBlobApi } from '@migaia/storage-contract'\nexport async function read(api: IBlobApi) {\n  await api.put('manual', new TextEncoder().encode('ready'))\n  const bytes = await api.get('manual')\n  if (bytes) { await using object = bytes; console.log(await object.bytes()) }\n  const stream = await api.get('manual')\n  if (stream) { await using object = stream; console.log(await new Response(object.stream()).text()) }\n}"
        },
        bytes: {
          summary: {
            en: 'Consume the one body right into detached complete bytes.',
            zh: '将唯一正文读取权消费为已脱离引用的完整字节。'
          },
          params: {},
          returns: {
            en: 'Complete bytes of this snapshot; stream and bytes cannot both consume it.',
            zh: '返回本快照完整字节，流式与完整读取不能同时消费。'
          },
          example:
            "import { blob, type IBlobApi } from '@migaia/storage-contract'\nexport async function read(api: IBlobApi) {\n  await api.put('manual', new TextEncoder().encode('ready'))\n  const bytes = await api.get('manual')\n  if (bytes) { await using object = bytes; console.log(await object.bytes()) }\n  const stream = await api.get('manual')\n  if (stream) { await using object = stream; console.log(await new Response(object.stream()).text()) }\n}"
        },
        dispose: {
          summary: {
            en: 'Release accepted work and original native resources without acquiring any new close authority.',
            zh: '排空已接受工作并释放原生资源，不获取新的关闭权限。'
          },
          params: {},
          returns: {
            en: 'The original cached main cleanup Promise; native cleanup failure rejects with its original reachable cause.',
            zh: '返回原缓存主清理结果，原生清理失败以可追踪的原始原因拒绝。'
          },
          example:
            "import { blob, type IBlobApi } from '@migaia/storage-contract'\nexport async function read(api: IBlobApi) {\n  await api.put('manual', new TextEncoder().encode('ready'))\n  const bytes = await api.get('manual')\n  if (bytes) { await using object = bytes; console.log(await object.bytes()) }\n  const stream = await api.get('manual')\n  if (stream) { await using object = stream; console.log(await new Response(object.stream()).text()) }\n}"
        },
        '[Symbol.asyncDispose]': {
          summary: {
            en: 'Use the original asynchronous resource-disposal protocol after accepted work drains.',
            zh: '在已接受工作排空后使用原异步资源释放协议。'
          },
          params: {},
          returns: {
            en: 'The separately cached symbolic Promise reports cleanup failure and resolves, without replacing the main cleanup Promise.',
            zh: '单独缓存的符号清理报告失败后完成，不替换主清理结果。'
          },
          example:
            "import { blob, type IBlobApi } from '@migaia/storage-contract'\nexport async function read(api: IBlobApi) {\n  await api.put('manual', new TextEncoder().encode('ready'))\n  const bytes = await api.get('manual')\n  if (bytes) { await using object = bytes; console.log(await object.bytes()) }\n  const stream = await api.get('manual')\n  if (stream) { await using object = stream; console.log(await new Response(object.stream()).text()) }\n}"
        }
      },
      scenarios: [
        {
          en: 'Read a download once while preserving its native snapshot and explicit resource release.',
          zh: '仅消费下载一次，同时保留原生快照与显式资源释放边界。'
        }
      ],
      example:
        "import { blob, type IBlobApi } from '@migaia/storage-contract'\nexport async function read(api: IBlobApi) {\n  await api.put('manual', new TextEncoder().encode('ready'))\n  const bytes = await api.get('manual')\n  if (bytes) { await using object = bytes; console.log(await object.bytes()) }\n  const stream = await api.get('manual')\n  if (stream) { await using object = stream; console.log(await new Response(object.stream()).text()) }\n}"
    },
    IBlobApi: {
      summary: t(
        'Native object operations, independent from KV and generic transactions.',
        '独立于 KV 与通用事务的原生对象操作。'
      ),
      members: {
        put: {
          summary: {
            en: 'Store one object through the native conditional write and upload owner.',
            zh: '通过原生条件写与上传拥有者存储单个对象。'
          },
          params: {
            key: {
              en: 'Object key assigned by the application or returned by this same backend.',
              zh: '应用指定或同一后端返回的对象存储键。'
            },
            body: {
              en: 'Detached bytes or an unconsumed byte stream; native conditions are checked before reader ownership.',
              zh: '已脱离引用的字节或尚未消费的字节流，取得读取权前检查原生条件。'
            },
            options: {
              en: 'Optional content type, string metadata, exclusive ifMatch/ifNoneMatch and original ctx.',
              zh: '可选内容类型、字符串元数据、互斥写入前提及原操作上下文。'
            }
          },
          returns: {
            en: 'Immutable metadata of the committed object; failed conditions leave the old object intact.',
            zh: '返回已提交对象的不可变元数据，条件失败时保留旧对象。'
          }
        },
        get: {
          summary: {
            en: 'Open one native object snapshot with a single stream-or-bytes consumption right.',
            zh: '打开单个原生对象快照，只授予一次流式或字节消费权。'
          },
          params: {
            key: {
              en: 'Object key assigned by the application or returned by this same backend.',
              zh: '应用指定或同一后端返回的对象存储键。'
            },
            options: {
              en: 'Optional inclusive byte range and original operation context; end may be omitted.',
              zh: '可选的包含末字节的范围与原上下文，结束位置可省略。'
            }
          },
          returns: {
            en: 'A disposable snapshot object, or undefined if absent; consumers must release the resource.',
            zh: '返回可释放的快照对象，不存在时为未定义，消费者必须释放资源。'
          }
        },
        head: {
          summary: {
            en: 'Read native snapshot metadata without opening a body reader.',
            zh: '不打开正文读取器，仅获取原生快照元数据。'
          },
          params: {
            key: {
              en: 'Object key assigned by the application or returned by this same backend.',
              zh: '应用指定或同一后端返回的对象存储键。'
            },
            ctx: {
              en: 'Original optional operation cancellation, timeout and organization context.',
              zh: '原可选操作取消信号、超时预算与组织上下文。'
            }
          },
          returns: {
            en: 'Object metadata or undefined when no object is present.',
            zh: '返回对象元数据，对象不存在时为未定义。'
          }
        },
        remove: {
          summary: {
            en: 'Delete one native object in the current organization.',
            zh: '删除当前组织内的单个原生对象内容。'
          },
          params: {
            key: {
              en: 'Object key assigned by the application or returned by this same backend.',
              zh: '应用指定或同一后端返回的对象存储键。'
            },
            ctx: {
              en: 'Original optional operation cancellation, timeout and organization context.',
              zh: '原可选操作取消信号、超时预算与组织上下文。'
            }
          },
          returns: {
            en: 'True only when an existing physical object was deleted.',
            zh: '仅实际删除已有物理对象时返回真值。'
          }
        },
        list: {
          summary: {
            en: 'Read one ordered native object page without materializing every body.',
            zh: '读取单个有序原生对象页，不载入全部对象正文。'
          },
          params: {
            options: {
              en: 'Optional string prefix, opaque after cursor and positive page limit.',
              zh: '可选字符串前缀、不透明恢复游标与正整数页上界。'
            },
            ctx: {
              en: 'Original optional operation cancellation, timeout and organization context.',
              zh: '原可选操作取消信号、超时预算与组织上下文。'
            }
          },
          returns: {
            en: 'Metadata items and an optional next cursor, never complete object bodies.',
            zh: '返回元数据条目及可选下一页游标，不包含完整对象正文。'
          }
        },
        removeByPrefix: {
          summary: {
            en: 'Delete native object identities matching this organization-bound string prefix.',
            zh: '删除当前组织内匹配指定字符串前缀的原生对象。'
          },
          params: {
            prefix: {
              en: 'Application-assigned object key prefix, without accessing another namespace.',
              zh: '应用指定的对象键前缀，不访问其它命名空间。'
            },
            ctx: {
              en: 'Original optional operation cancellation, timeout and organization context.',
              zh: '原可选操作取消信号、超时预算与组织上下文。'
            }
          },
          returns: {
            en: 'Number of physical objects actually removed.',
            zh: '返回实际删除的物理对象数量。'
          }
        }
      }
    },
    IDurableStorageChange: {
      summary: t(
        'A retained storage change with an opaque commit cursor.',
        '携带不透明提交游标的保留存储变更。'
      ),
      members: {
        cursor: { summary: t('Caller-persisted replay position.', '由调用方持久化的重放位置。') },
        orgId: {
          summary: {
            en: 'Organization identity supplied by the original host view, never permission to route into another organization.',
            zh: '原宿主视图给出的组织身份，不授予进入其它组织的路由权限。'
          }
        }
      }
    },
    IDurableChangeFeedApi: {
      summary: t(
        'Native at-least-once replay and disposable tails.',
        '原生至少一次重放与可释放 tail。'
      ),
      members: {
        readChanges: {
          summary: {
            en: 'Replay retained native commit summaries from an opaque saved cursor.',
            zh: '从已保存的不透明游标重放仍保留的原生提交摘要。'
          },
          params: {
            options: {
              en: 'Optional after cursor and positive bounded page limit; a retained native source is required.',
              zh: '可选恢复游标与正整数页上界，要求真实保留的原生来源。'
            },
            ctx: {
              en: 'Original optional operation context with cancellation and one captured timeout budget.',
              zh: '原可选操作上下文，承载取消信号与单次捕获的超时预算。'
            }
          },
          returns: {
            en: 'Changes and the original resume cursor; an expired retained position rejects with CHANGE_CURSOR_EXPIRED.',
            zh: '返回变更与原恢复游标，已过期位置以游标过期错误拒绝。'
          }
        },
        tailChanges: {
          summary: {
            en: 'Own a native reliable tail whose cursor advances only after each awaited callback succeeds.',
            zh: '持有原生可靠尾部流，仅每次等待回调成功后推进游标。'
          },
          params: {
            options: {
              en: 'Saved from cursor or now, awaited onChange, and optional error observer; persist successfully processed cursors.',
              zh: '恢复游标或当前起点、等待的变更回调与可选错误观察者，应保存处理成功的游标。'
            },
            ctx: {
              en: 'Original optional operation context with cancellation and one captured timeout budget.',
              zh: '原可选操作上下文，承载取消信号与单次捕获的超时预算。'
            }
          },
          returns: {
            en: 'A native resource that drains accepted callbacks on disposal; replay remains at least once.',
            zh: '返回释放时排空已接受回调的原生资源，重放保持至少一次语义。'
          }
        }
      }
    },
    ISparqlFragment: {
      summary: {
        en: 'Authentic SPARQL grammar fragment produced by the single shared compiler owner.',
        zh: '由唯一共享编译器拥有者产生的真实图查询语法片段。'
      },
      members: {}
    },
    ISparqlInput: {
      summary: {
        en: 'Shared compiler input consisting of canonical RDF terms or authentic grammar fragments.',
        zh: '共享编译器输入，由规范三元组项或真实语法片段构成。'
      },
      members: {
        termType: {
          summary: {
            en: 'Canonical RDF term discriminator; native blank labels never become standard persistent ground identity.',
            zh: '规范三元组项区分字段，原生空白标签不变为标准持久完整身份。'
          }
        },
        value: {
          summary: {
            en: 'Original canonical term value, preserving validated IRI or lexical spelling without coercion.',
            zh: '原规范项值，保留已校验资源或字面拼写，不进行类型强制。'
          }
        }
      }
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
        select: {
          summary: {
            en: 'Execute native SELECT and decode standard term bindings.',
            zh: '执行原生选择查询，并解码标准项绑定。'
          },
          params: {
            ctx: {
              en: 'Original optional operation context carrying one captured cancellation and timeout budget.',
              zh: '原可选操作上下文，承载单次捕获的取消与超时预算。'
            }
          },
          returns: {
            en: 'Rows of canonical binding terms; native blank labels remain response-local.',
            zh: '返回规范绑定项数据行，原生空白标签仅属于当前响应。'
          }
        },
        ask: {
          summary: {
            en: 'Execute native ASK and validate its actual boolean response.',
            zh: '执行原生存在查询，并校验真实布尔响应。'
          },
          params: {
            ctx: {
              en: 'Original optional operation context carrying one captured cancellation and timeout budget.',
              zh: '原可选操作上下文，承载单次捕获的取消与超时预算。'
            }
          },
          returns: {
            en: 'The original validated native boolean, without client-side scanning.',
            zh: '返回已验证原生布尔值，不在客户端扫描数据。'
          }
        },
        construct: {
          summary: {
            en: 'Execute native CONSTRUCT and decode complete raw quads.',
            zh: '执行原生构造查询，并解码完整原始三元组。'
          },
          params: {
            ctx: {
              en: 'Original optional operation context carrying one captured cancellation and timeout budget.',
              zh: '原可选操作上下文，承载单次捕获的取消与超时预算。'
            }
          },
          returns: {
            en: 'Raw quads may contain native blank labels under the declared raw boundary.',
            zh: '返回可含原生空白标签的原始三元组，遵守已声明原始边界。'
          }
        },
        update: {
          summary: {
            en: 'Execute one compiled native SPARQL modification without request replay.',
            zh: '执行单次已编译原生图修改，不重放请求正文。'
          },
          params: {
            ctx: {
              en: 'Original optional operation context carrying one captured cancellation and timeout budget.',
              zh: '原可选操作上下文，承载单次捕获的取消与超时预算。'
            }
          },
          returns: {
            en: 'Resolves only on confirmed native success; unknown commit evidence remains an error.',
            zh: '仅原生成功确认后完成，提交证据未知仍为错误。'
          }
        }
      }
    },
    ISparqlTagTools: {
      summary: {
        en: 'Shared authentic variable, fragment-join and empty-fragment tools without a second parser.',
        zh: '共享真实变量、片段连接与空片段工具，不增加第二解析器。'
      },
      members: {
        var: {
          summary: {
            en: 'Create an authentic variable fragment with a validated SPARQL variable name.',
            zh: '使用已校验变量名称创建真实图查询变量片段。'
          },
          params: {
            name: {
              en: 'Application-assigned variable name without the leading question mark.',
              zh: '应用指定的变量名称，不包含开头问号。'
            }
          },
          returns: {
            en: 'An authentic variable fragment owned by the shared compiler.',
            zh: '返回由共享编译器拥有的真实变量片段。'
          },
          example:
            "import { sparqlFragment, term, type ISparqlApi } from '@migaia/storage-contract'\nexport async function read(api: ISparqlApi) {\n  const subject = api.var('subject')\n  const pattern = api.join([sparqlFragment`${subject} ?predicate ?object`], api.empty)\n  console.log(await api`SELECT ?subject WHERE { ${pattern} }`.select())\n  console.log(await api`ASK { ${pattern} }`.ask())\n  console.log(await api`CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }`.construct())\n  await api`INSERT DATA { ${term.iri('urn:example:s')} ${term.iri('urn:example:p')} ${term.literal('ready')} }`.update()\n}"
        },
        join: {
          summary: {
            en: 'Join authentic SPARQL fragments while preserving bound RDF values.',
            zh: '连接真实图查询片段，同时保留已绑定的三元组项值。'
          },
          params: {
            fragments: {
              en: 'Authentic fragments produced by the shared SPARQL compiler.',
              zh: '共享图查询编译器产生的真实片段集合。'
            },
            separator: {
              en: 'Optional authentic separator fragment, never an unchecked grammar string.',
              zh: '可选真实分隔片段，不是未检查的语法字符串。'
            }
          },
          returns: {
            en: 'A joined authentic fragment retaining original term identities.',
            zh: '返回保留原项身份的真实连接片段。'
          },
          example:
            "import { sparqlFragment, term, type ISparqlApi } from '@migaia/storage-contract'\nexport async function read(api: ISparqlApi) {\n  const subject = api.var('subject')\n  const pattern = api.join([sparqlFragment`${subject} ?predicate ?object`], api.empty)\n  console.log(await api`SELECT ?subject WHERE { ${pattern} }`.select())\n  console.log(await api`ASK { ${pattern} }`.ask())\n  console.log(await api`CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }`.construct())\n  await api`INSERT DATA { ${term.iri('urn:example:s')} ${term.iri('urn:example:p')} ${term.literal('ready')} }`.update()\n}"
        },
        empty: {
          summary: {
            en: 'Authentic empty SPARQL fragment for a conditional branch that contributes no grammar.',
            zh: '条件分支不贡献图查询语法时使用的真实空片段。'
          }
        }
      }
    },
    ISparqlApi: {
      summary: t(
        'Native callable template tag with pure tools and typed row output.',
        '带纯工具与行输出类型的原生 callable 模板 tag。'
      ),
      members: {
        var: {
          summary: {
            en: 'Create an authentic variable fragment with a validated SPARQL variable name.',
            zh: '使用已校验变量名称创建真实图查询变量片段。'
          },
          params: {
            name: {
              en: 'Application-assigned variable name without the leading question mark.',
              zh: '应用指定的变量名称，不包含开头问号。'
            }
          },
          returns: {
            en: 'An authentic variable fragment owned by the shared compiler.',
            zh: '返回由共享编译器拥有的真实变量片段。'
          },
          example:
            "import { sparqlFragment, term, type ISparqlApi } from '@migaia/storage-contract'\nexport async function read(api: ISparqlApi) {\n  const subject = api.var('subject')\n  const pattern = api.join([sparqlFragment`${subject} ?predicate ?object`], api.empty)\n  console.log(await api`SELECT ?subject WHERE { ${pattern} }`.select())\n  console.log(await api`ASK { ${pattern} }`.ask())\n  console.log(await api`CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }`.construct())\n  await api`INSERT DATA { ${term.iri('urn:example:s')} ${term.iri('urn:example:p')} ${term.literal('ready')} }`.update()\n}"
        },
        join: {
          summary: {
            en: 'Join authentic SPARQL fragments while preserving bound RDF values.',
            zh: '连接真实图查询片段，同时保留已绑定的三元组项值。'
          },
          params: {
            fragments: {
              en: 'Authentic fragments produced by the shared SPARQL compiler.',
              zh: '共享图查询编译器产生的真实片段集合。'
            },
            separator: {
              en: 'Optional authentic separator fragment, never an unchecked grammar string.',
              zh: '可选真实分隔片段，不是未检查的语法字符串。'
            }
          },
          returns: {
            en: 'A joined authentic fragment retaining original term identities.',
            zh: '返回保留原项身份的真实连接片段。'
          },
          example:
            "import { sparqlFragment, term, type ISparqlApi } from '@migaia/storage-contract'\nexport async function read(api: ISparqlApi) {\n  const subject = api.var('subject')\n  const pattern = api.join([sparqlFragment`${subject} ?predicate ?object`], api.empty)\n  console.log(await api`SELECT ?subject WHERE { ${pattern} }`.select())\n  console.log(await api`ASK { ${pattern} }`.ask())\n  console.log(await api`CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }`.construct())\n  await api`INSERT DATA { ${term.iri('urn:example:s')} ${term.iri('urn:example:p')} ${term.literal('ready')} }`.update()\n}"
        },
        empty: {
          summary: {
            en: 'Authentic empty SPARQL fragment for a conditional branch that contributes no grammar.',
            zh: '条件分支不贡献图查询语法时使用的真实空片段。'
          }
        }
      },
      example:
        "import { sparqlFragment, term, type ISparqlApi } from '@migaia/storage-contract'\nexport async function read(api: ISparqlApi) {\n  const subject = api.var('subject')\n  const pattern = api.join([sparqlFragment`${subject} ?predicate ?object`], api.empty)\n  console.log(await api`SELECT ?subject WHERE { ${pattern} }`.select())\n  console.log(await api`ASK { ${pattern} }`.ask())\n  console.log(await api`CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }`.construct())\n  await api`INSERT DATA { ${term.iri('urn:example:s')} ${term.iri('urn:example:p')} ${term.literal('ready')} }`.update()\n}",
      scenarios: [
        {
          en: 'Compose native queries from RDF terms and authentic fragments without string interpolation of grammar.',
          zh: '使用三元组项与真实片段组合原生查询，避免以字符串插入语法。'
        }
      ]
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
          summary: {
            en: 'Borrow a logical named collection backed by the installed native vector engine.',
            zh: '借用由已安装原生向量引擎支撑的逻辑具名集合。'
          },
          params: {
            name: {
              en: 'Collection name assigned by the application within the current organization.',
              zh: '应用在当前组织内指定的集合名称。'
            },
            options: {
              en: 'Dimensions and metric when declaring a new collection; omission borrows existing native configuration.',
              zh: '声明新集合时指定维度与度量，省略时借用既有原生配置。'
            }
          },
          returns: {
            en: 'A shared collection API; native schema and scoring remain with the real backend.',
            zh: '返回共享集合接口，原生配置与评分仍由真实后端拥有。'
          }
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
          summary: {
            en: 'Build a bounded native nearest-vector query without computing scores in JavaScript.',
            zh: '创建有界原生最近向量查询，不在客户端计算分数。'
          },
          params: {
            query: {
              en: 'Finite query vector matching the collection dimensions.',
              zh: '维度符合集合声明的有限查询向量。'
            },
            options: {
              en: 'Native exact/metric or bounded search settings; unsupported exact search is rejected.',
              zh: '原生精确或度量及有界检索配置，不支持精确时拒绝。'
            }
          },
          returns: {
            en: 'A shared persistent native ranking chain.',
            zh: '返回共享持久原生排名查询链。'
          }
        },
        similarTo: {
          summary: {
            en: 'Read one native sample and search with the shared sample semantics, excluding its own ID.',
            zh: '按共享样本语义读取原生样本并搜索，排除样本自身标识。'
          },
          params: {
            id: {
              en: 'Point ID assigned by the application or returned by the same collection.',
              zh: '应用指定或同一集合返回的点标识符。'
            }
          },
          returns: {
            en: 'A native ranking query; a missing sample rejects instead of inventing a zero vector.',
            zh: '返回原生排名查询，样本缺失时拒绝，不虚构零向量。'
          }
        },
        recommend: {
          summary: {
            en: 'Synthesize the query from positive and negative samples through the single shared recommendation owner.',
            zh: '经唯一共享推荐拥有者从正负样本合成查询向量。'
          },
          params: {
            examples: {
              en: 'Nonempty positive IDs and optional negative IDs from this same collection.',
              zh: '同一集合内非空正样本标识与可选负样本标识。'
            }
          },
          returns: {
            en: 'A native engine ranking query, with sample IDs excluded from results.',
            zh: '返回排除样本标识的原生引擎排名查询。'
          }
        },
        upsert: {
          summary: {
            en: 'Validate and detach a complete point batch before the native engine changes any point.',
            zh: '原生引擎修改任何点之前，校验并分离完整点批量。'
          },
          params: {
            points: {
              en: 'Dense captured point IDs, finite vectors and portable payloads; duplicate IDs reject before native mutation.',
              zh: '稠密捕获的点标识、有限向量与可移植载荷，重复标识在原生修改前拒绝。'
            },
            ctx: {
              en: 'Original optional operation context with cancellation and one captured timeout budget.',
              zh: '原可选操作上下文，承载取消信号与单次捕获的超时预算。'
            }
          },
          returns: {
            en: 'Resolves after actual native acceptance; optional TTL is applied by the original owner.',
            zh: '原生实际接受后完成，可选期限由原拥有者应用。'
          }
        },
        deleteWhere: {
          summary: {
            en: 'Delete physical matching points through the selected native counting strategy.',
            zh: '经所选原生计数策略删除物理匹配点。'
          },
          params: {
            where: {
              en: 'Canonical declarative payload condition; physical expired matches remain eligible for deletion.',
              zh: '规范声明式载荷条件，物理过期匹配点仍参与删除。'
            },
            ctx: {
              en: 'Original optional operation context with cancellation and one captured timeout budget.',
              zh: '原可选操作上下文，承载取消信号与单次捕获的超时预算。'
            }
          },
          returns: {
            en: 'Promise<number>; Qdrant precount is a prior count and scroll counts collected IDs, without a cross-page snapshot.',
            zh: '返回异步数字，向量服务预统计为先前计数，分页为已收集标识数，不承诺跨页快照。'
          }
        },
        delete: {
          summary: {
            en: 'Delete specified native point identities without returning a fabricated row count.',
            zh: '删除指定原生点身份，不返回虚构的数据行计数。'
          },
          params: {
            ids: {
              en: 'Point identities from this same collection, without client-side payload enumeration.',
              zh: '来自同一集合的点身份，不在客户端枚举载荷。'
            },
            ctx: {
              en: 'Original optional operation context with cancellation and one captured timeout budget.',
              zh: '原可选操作上下文，承载取消信号与单次捕获的超时预算。'
            }
          },
          returns: {
            en: 'Resolves after native deletion settles.',
            zh: '原生删除结算后完成。'
          }
        },
        search: {
          summary: {
            en: 'Execute bounded native ranking with the selected filter and payload projection.',
            zh: '使用所选条件与载荷投影执行有界原生排名。'
          },
          params: {
            query: {
              en: 'Finite query vector matching the collection dimensions.',
              zh: '维度符合集合声明的有限查询向量。'
            },
            options: {
              en: 'Native exact/metric or bounded search settings; unsupported exact search is rejected.',
              zh: '原生精确或度量及有界检索配置，不支持精确时拒绝。'
            },
            ctx: {
              en: 'Original optional operation context with cancellation and one captured timeout budget.',
              zh: '原可选操作上下文，承载取消信号与单次捕获的超时预算。'
            }
          },
          returns: {
            en: 'Original native IDs, scores and optional payloads in engine order.',
            zh: '按引擎顺序返回原生标识、分数及可选载荷。'
          }
        }
      }
    },
    IStorageVectorConfiguration: {
      summary: t(
        'Native collection dimensions and metric, without connection ownership.',
        '原生 collection 维度与 metric，不持有连接。'
      ),
      members: {
        dimensions: {
          summary: {
            en: 'Positive safe vector dimension count validated by the original vector-input owner.',
            zh: '由原向量输入拥有者校验的正安全整数向量维数。'
          }
        },
        metric: {
          summary: {
            en: 'Native cosine, dot or Euclidean metric chosen for the original collection schema.',
            zh: '为原集合配置选择的原生余弦、点积或欧氏度量。'
          },
          values: {
            cosine: {
              en: 'Cosine similarity under native engine precision.',
              zh: '采用原生引擎精度的余弦相似度。'
            },
            dot: {
              en: 'Native finite inner product.',
              zh: '使用原生有限向量内积。'
            },
            euclid: {
              en: 'Native Euclidean distance converted to the shared score order.',
              zh: '将原生欧氏距离转换为共享分数顺序。'
            }
          }
        }
      }
    },
    IStorageVectorValidation: {
      summary: t(
        'Optional validation facts for detached vector input.',
        '独立向量输入的可选校验事实。'
      ),
      members: {
        dimensions: {
          summary: {
            en: 'Positive safe vector dimension count validated by the original vector-input owner.',
            zh: '由原向量输入拥有者校验的正安全整数向量维数。'
          }
        },
        metric: {
          summary: {
            en: 'Native cosine, dot or Euclidean metric chosen for the original collection schema.',
            zh: '为原集合配置选择的原生余弦、点积或欧氏度量。'
          },
          values: {
            cosine: {
              en: 'Cosine similarity under native engine precision.',
              zh: '采用原生引擎精度的余弦相似度。'
            },
            dot: {
              en: 'Native finite inner product.',
              zh: '使用原生有限向量内积。'
            },
            euclid: {
              en: 'Native Euclidean distance converted to the shared score order.',
              zh: '将原生欧氏距离转换为共享分数顺序。'
            }
          }
        }
      }
    },
    IStorageVectorPoint: {
      summary: t(
        'Declared point input with detached portable payload output.',
        '声明点输入，返回独立便携 payload。'
      ),
      members: {
        id: {
          summary: {
            en: 'Nonempty portable point identifier assigned by the application within its collection.',
            zh: '应用在集合内指定的非空可移植点标识符。'
          }
        },
        vector: {
          summary: {
            en: 'Detached finite component array, with signed zero normalized by the original owner.',
            zh: '已脱离外部引用的有限分量数组，符号零由原拥有者归一化。'
          }
        },
        payload: {
          summary: t('Optional caller-declared portable fields.', '可选调用方声明便携字段。')
        }
      },
      scenarios: [
        {
          en: 'Capture an application point before passing its finite components to a real vector engine.',
          zh: '传给真实向量引擎前，捕获应用点及其有限分量。'
        }
      ],
      example:
        "import { snapshotStorageVectorUpsert } from '@migaia/storage-contract'\nexport const points = snapshotStorageVectorUpsert([\n  { id: 'first', vector: [1, 0], payload: { category: 'docs' } }\n], { dimensions: 2, metric: 'dot' })"
    },
    IVectorFilter: {
      summary: t(
        'Own-path boolean/scalar/range native vector predicates.',
        '按自有路径求值的布尔、标量与范围原生向量谓词。'
      ),
      members: {
        all: {
          summary: {
            en: 'All child native vector filters must match.',
            zh: '全部子原生向量过滤条件必须同时匹配。'
          }
        },
        any: {
          summary: {
            en: 'At least one child native vector filter must match.',
            zh: '至少一个子原生向量过滤条件必须匹配。'
          }
        },
        not: {
          summary: {
            en: 'Negate the one nested native vector filter.',
            zh: '对单个嵌套原生向量过滤条件取反。'
          }
        },
        field: {
          summary: {
            en: 'Canonical application payload field path used by the native filter.',
            zh: '原生过滤使用的规范应用载荷字段路径。'
          }
        },
        eq: {
          summary: {
            en: 'Captured scalar operand compared for exact native equality.',
            zh: '用于原生精确相等比较的已捕获标量操作数。'
          }
        },
        in: {
          summary: {
            en: 'Captured portable scalar alternatives for native membership testing.',
            zh: '用于原生成员判断的已捕获可移植标量候选。'
          }
        },
        gte: {
          summary: {
            en: 'Inclusive native lower comparison bound for this payload field.',
            zh: '当前载荷字段的包含式原生比较下界。'
          }
        },
        lte: {
          summary: {
            en: 'Inclusive native upper comparison bound for this payload field.',
            zh: '当前载荷字段的包含式原生比较上界。'
          }
        }
      },
      scenarios: [
        {
          en: 'Build a portable declarative payload filter that the native source must translate faithfully.',
          zh: '构造原生来源必须忠实翻译的可移植声明式载荷过滤条件。'
        }
      ],
      example:
        "import { snapshotStorageVectorFilter } from '@migaia/storage-contract'\nexport const filter = snapshotStorageVectorFilter({ field: 'category', eq: 'docs' })"
    },
    IRdfApi: {
      summary: t(
        'Native atomic ground RDF writes and shared query construction.',
        '原生原子 ground RDF 写入与共享查询构造。'
      ),
      members: {
        add: {
          summary: {
            en: 'Add canonical RDF membership through the original native draft owner.',
            zh: '经原生草稿拥有者加入规范三元组成员关系。'
          },
          params: {
            quads: {
              en: 'Canonical ground quads, with named subjects/predicates and default or named IRI graph.',
              zh: '规范完整三元组，使用具名主谓与缺省或具名资源图。'
            },
            ctx: {
              en: 'Original optional operation context carrying one captured cancellation and timeout budget.',
              zh: '原可选操作上下文，承载单次捕获的取消与超时预算。'
            }
          },
          returns: {
            en: 'The original write settles; duplicate membership does not create duplicate rows.',
            zh: '原写入完成，重复成员关系不会产生重复记录。'
          }
        },
        delete: {
          summary: {
            en: 'Remove canonical RDF membership through the same native owner.',
            zh: '经同一原生拥有者移除规范三元组成员关系。'
          },
          params: {
            quads: {
              en: 'Canonical ground quads, with named subjects/predicates and default or named IRI graph.',
              zh: '规范完整三元组，使用具名主谓与缺省或具名资源图。'
            },
            ctx: {
              en: 'Original optional operation context carrying one captured cancellation and timeout budget.',
              zh: '原可选操作上下文，承载单次捕获的取消与超时预算。'
            }
          },
          returns: {
            en: 'The original write settles; absent membership is a no-op.',
            zh: '原写入完成，不存在的成员关系不会产生修改。'
          }
        },
        match: {
          summary: {
            en: 'Build the original ground RDF chain from captured bound positions.',
            zh: '根据已捕获绑定位置创建原完整三元组查询链。'
          },
          params: {
            pattern: {
              en: 'Optional bound ground subject, predicate, object and graph positions.',
              zh: '可选绑定的完整主项、谓词、对象与图位置。'
            }
          },
          returns: {
            en: 'A persistent shared RDF query; source I/O begins only at an execution terminal.',
            zh: '返回持久化的共享三元组查询，仅执行终点开始来源访问。'
          }
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
          summary: {
            en: 'Add canonical RDF membership through the original native draft owner.',
            zh: '经原生草稿拥有者加入规范三元组成员关系。'
          },
          params: {
            quads: {
              en: 'Canonical ground quads, with named subjects/predicates and default or named IRI graph.',
              zh: '规范完整三元组，使用具名主谓与缺省或具名资源图。'
            }
          },
          returns: {
            en: 'The original write settles; duplicate membership does not create duplicate rows.',
            zh: '原写入完成，重复成员关系不会产生重复记录。'
          }
        },
        delete: {
          summary: {
            en: 'Remove canonical RDF membership through the same native owner.',
            zh: '经同一原生拥有者移除规范三元组成员关系。'
          },
          params: {
            quads: {
              en: 'Canonical ground quads, with named subjects/predicates and default or named IRI graph.',
              zh: '规范完整三元组，使用具名主谓与缺省或具名资源图。'
            }
          },
          returns: {
            en: 'The original write settles; absent membership is a no-op.',
            zh: '原写入完成，不存在的成员关系不会产生修改。'
          }
        },
        match: {
          summary: {
            en: 'Build the original ground RDF chain from captured bound positions.',
            zh: '根据已捕获绑定位置创建原完整三元组查询链。'
          },
          params: {
            pattern: {
              en: 'Optional bound ground subject, predicate, object and graph positions.',
              zh: '可选绑定的完整主项、谓词、对象与图位置。'
            }
          },
          returns: {
            en: 'A persistent shared RDF query; source I/O begins only at an execution terminal.',
            zh: '返回持久化的共享三元组查询，仅执行终点开始来源访问。'
          }
        }
      }
    },
    ISqlExecutor: {
      summary: t(
        'One sql property containing the precise bound tag, shared by stores, original transaction views and ORM functions.',
        '仅含精确绑定标签 sql 属性，由 store、原事务视图与 ORM 函数共用。'
      ),
      members: {
        sql: {
          summary: {
            en: 'Original parameterized SQL tag with canonical identifier and fragment construction.',
            zh: '带规范标识符与片段构造功能的原参数化查询标签。'
          }
        }
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
      members: {
        kind: {
          summary: {
            en: 'SQL stage discriminator for the original compiled native statement owner.',
            zh: '原已编译原生语句拥有者使用的查询阶段区分字段。'
          },
          values: {
            enum: 'StorageStageKind'
          }
        },
        forTransaction: {
          summary: {
            en: 'Bind native SQL observations to the same reserved transaction connection.',
            zh: '将原生查询观察绑定到同一保留事务连接。'
          }
        },
        beforeSql: {
          summary: {
            en: 'Observe compiled statement metadata before original native SQL execution.',
            zh: '原生查询执行前观察已编译语句元数据。'
          }
        },
        afterSql: {
          summary: {
            en: 'Observe original native SQL settlement without rewriting rows or row counts.',
            zh: '观察原生查询结算，不改写结果行或行计数。'
          }
        },
        onSqlError: {
          summary: {
            en: 'Observe the original SQL failure while retaining native response evidence.',
            zh: '观察原查询失败，同时保留原生响应证据。'
          }
        },
        report: {
          summary: {
            en: 'Report observer failures through the original owner without replacing the primary operation result.',
            zh: '经原拥有者报告观察者失败，不替换首要操作结果。'
          }
        }
      }
    },
    IQueryStageObserver: {
      summary: t(
        'Observe query plans and terminal counts without executing a query.',
        '观察查询计划与结束计数，不执行查询。'
      ),
      members: {
        kind: {
          summary: {
            en: 'Query stage discriminator for the same canonical query execution owner.',
            zh: '同一规范查询执行拥有者使用的查询阶段区分字段。'
          },
          values: {
            enum: 'StorageStageKind'
          }
        },
        forTransaction: {
          summary: {
            en: 'Bind native query observations to the original transaction operation view.',
            zh: '将原生查询观察绑定到原事务操作视图。'
          }
        },
        beforeQuery: {
          summary: {
            en: 'Observe the captured original plan before native source execution.',
            zh: '原生来源执行前观察已捕获的原查询计划。'
          }
        },
        afterQuery: {
          summary: {
            en: 'Observe the settled query without rescanning results or changing selected rows.',
            zh: '观察已结算查询，不重新扫描结果或改变所选条目。'
          }
        },
        onQueryError: {
          summary: {
            en: 'Observe original query failure without converting it into an empty result.',
            zh: '观察原查询失败，不将其转换为空查询结果。'
          }
        },
        report: {
          summary: {
            en: 'Report observer failures through the original owner without replacing the primary operation result.',
            zh: '经原拥有者报告观察者失败，不替换首要操作结果。'
          }
        }
      }
    },
    IConcurrencyHolder: {
      summary: t(
        'Real holder identity or a remote handoff interval with no fabricated owner.',
        '真实持有者身份，或不伪造 owner 的远端交接区间。'
      ),
      members: {
        status: {
          summary: {
            en: 'Distinguish a real native holder from a remote handoff interval with no borrowed prior identity.',
            zh: '区分真实原生持有者与远端交接间隔，交接不借用前持有者身份。'
          },
          values: {
            held: {
              en: 'Native ownership is held with original owner metadata.',
              zh: '原生拥有权已持有，并带原拥有者元数据。'
            },
            'handing-off': {
              en: 'Remote transfer is underway; no previous holder metadata is reused.',
              zh: '远端正在交接，不复用前持有者元数据。'
            }
          }
        },
        owner: {
          summary: {
            en: 'Original owner identity returned by the native lock holder, absent during handoff.',
            zh: '原生锁持有者返回的原拥有者身份，交接时不存在。'
          }
        },
        label: {
          summary: {
            en: 'Optional diagnostic label assigned by the owning application.',
            zh: '由拥有者应用指定的可选诊断标签。'
          }
        },
        pid: {
          summary: {
            en: 'Optional actual native process identifier when available.',
            zh: '可取得时报告的真实原生进程标识符。'
          }
        },
        since: {
          summary: {
            en: 'Original lock acquisition timestamp, absent when only remote handoff is known.',
            zh: '原始锁获取时间，仅知远端交接时不存在。'
          }
        },
        scope: {
          summary: {
            en: 'Whether the original holder is local or remote to this lock owner.',
            zh: '原持有者相对此锁拥有者属于本地还是远端。'
          },
          values: {
            local: {
              en: 'The holder belongs to this local owner.',
              zh: '持有者属于当前本地拥有者。'
            },
            remote: {
              en: 'The native holder or handoff is remote.',
              zh: '原生持有者或交接状态属于远端。'
            }
          }
        }
      }
    },
    IConcurrencyDecision: {
      summary: {
        en: 'One authentic conflict decision selects waiting, rejection or a bounded retry without owning native resources.',
        zh: '单个真实冲突决策选择等待、拒绝或有界重试，不拥有原生资源。'
      },
      members: {
        action: {
          summary: {
            en: 'Choose logical waiting, rejection or a new optimistic attempt after the original conflict.',
            zh: '在原冲突后选择逻辑等待、拒绝或新的乐观尝试。'
          },
          values: {
            wait: {
              en: 'Wait only for acquisition admission within the shared budget.',
              zh: '仅在共享预算内等待获取准入。'
            },
            reject: {
              en: 'Reject the completed conflict without starting another attempt.',
              zh: '拒绝已结束冲突，不启动新的尝试。'
            },
            retry: {
              en: 'Start a new allowed attempt after optional bounded delay.',
              zh: '可选有界延迟后启动新的允许尝试。'
            }
          }
        },
        timeoutMs: {
          summary: {
            en: 'Optional logical acquisition-wait bound; forbidden on reject and retry decisions.',
            zh: '可选逻辑准入等待上界，拒绝与重试决策不允许此字段。'
          }
        },
        delayMs: {
          summary: {
            en: 'Optional retry delay; forbidden when waiting or rejecting a conflict.',
            zh: '可选重试延迟，等待或拒绝冲突时不允许此字段。'
          }
        }
      }
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
          summary: {
            en: 'Release accepted work and original native resources without acquiring any new close authority.',
            zh: '排空已接受工作并释放原生资源，不获取新的关闭权限。'
          },
          params: {},
          returns: {
            en: 'The original cached main cleanup Promise; native cleanup failure rejects with its original reachable cause.',
            zh: '返回原缓存主清理结果，原生清理失败以可追踪的原始原因拒绝。'
          }
        },
        '[Symbol.asyncDispose]': {
          summary: {
            en: 'Use the original asynchronous resource-disposal protocol after accepted work drains.',
            zh: '在已接受工作排空后使用原异步资源释放协议。'
          },
          params: {},
          returns: {
            en: 'The separately cached symbolic Promise reports cleanup failure and resolves, without replacing the main cleanup Promise.',
            zh: '单独缓存的符号清理报告失败后完成，不替换主清理结果。'
          }
        }
      }
    },
    IStorageStore: {
      summary: t(
        'Resource base with an exact contravariant capability set and token use/has.',
        '保留精确反变能力集合及令牌 use/has 的资源基础对象。'
      ),
      members: {
        dispose: {
          summary: {
            en: 'Release accepted work and original native resources without acquiring any new close authority.',
            zh: '排空已接受工作并释放原生资源，不获取新的关闭权限。'
          },
          params: {},
          returns: {
            en: 'The original cached main cleanup Promise; native cleanup failure rejects with its original reachable cause.',
            zh: '返回原缓存主清理结果，原生清理失败以可追踪的原始原因拒绝。'
          }
        },
        '[Symbol.asyncDispose]': {
          summary: {
            en: 'Use the original asynchronous resource-disposal protocol after accepted work drains.',
            zh: '在已接受工作排空后使用原异步资源释放协议。'
          },
          params: {},
          returns: {
            en: 'The separately cached symbolic Promise reports cleanup failure and resolves, without replacing the main cleanup Promise.',
            zh: '单独缓存的符号清理报告失败后完成，不替换主清理结果。'
          }
        },
        use: {
          summary: {
            en: 'Read the original capability implementation by the authentic token identity.',
            zh: '按真实令牌身份读取原能力实现，不创建替代提供者。'
          },
          params: {
            capability: {
              en: 'Original token exported by its owner or returned by defineStorageCapability.',
              zh: '由所属包导出或能力工厂返回的原始令牌。'
            }
          },
          returns: {
            en: 'The original implementation API; an unsupported authentic token throws UNSUPPORTED_CAPABILITY synchronously.',
            zh: '返回原实现接口；不支持的真实令牌同步抛出 UNSUPPORTED_CAPABILITY。'
          }
        },
        has: {
          summary: {
            en: 'Inspect the original capability map without invoking native I/O.',
            zh: '只读检查原能力映射，不调用原生访问操作。'
          },
          params: {
            capability: {
              en: 'Authentic capability token from its canonical owner.',
              zh: '来自规范拥有者的真实能力令牌。'
            }
          },
          returns: {
            en: 'True only when that exact token identity has a published implementation.',
            zh: '仅该精确令牌身份具有已发布实现时返回真值。'
          }
        }
      }
    },
    IStorageCapability: {
      summary: t(
        'Opaque API token; its name does not grant runtime authority.',
        '不透明 API 令牌；名称不授予运行权限。'
      ),
      members: {
        name: {
          summary: {
            en: 'Stable diagnostic name assigned by the capability factory; identity remains the original token object.',
            zh: '由能力工厂指定的稳定诊断名称，真实身份仍是原令牌对象。'
          }
        }
      }
    },
    IAnyStorageCapability: {
      summary: t(
        'Shared upper bound for capability identity tokens.',
        '能力身份令牌的共同类型上界。'
      ),
      members: {
        name: {
          summary: {
            en: 'Stable diagnostic name carried by an authentic capability token, without granting publication authority.',
            zh: '真实能力令牌承载的稳定诊断名称，不授予能力发布权限。'
          }
        }
      }
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
        removeByPrefix: batchMembers.removeByPrefix!,
        get: storeMembers.get,
        set: storeMembers.set,
        remove: storeMembers.remove,
        has: storeMembers.has,
        keys: storeMembers.keys,
        clearValues: storeMembers.clearValues,
        clearAll: storeMembers.clearAll,
        sync: storeMembers.sync
      }
    },
    ICapabilityImpl: {
      summary: t(
        'Authentic frozen pairing of one token and its precise backend API.',
        '一个令牌与精确后端 API 的真实冻结配对。'
      ),
      members: {
        capability: {
          summary: {
            en: 'Exact authentic token captured by implement, never a structurally equivalent replacement.',
            zh: '实现工厂捕获的精确真实令牌，不接受结构相似的替代对象。'
          }
        },
        api: {
          summary: {
            en: 'Original implementation object retained without taking ownership; standard API shape admission occurs when the descriptor is published.',
            zh: '保留而不接管原实现对象；标准接口形状在描述符实际发布时准入。'
          }
        }
      },
      scenarios: [
        {
          en: 'Prepare an authentic token/API descriptor before a backend publishes its implementation batch.',
          zh: '后端发布实现批次前，准备真实令牌与接口描述符。'
        }
      ],
      example:
        "import { defineStorageCapability, implement } from '@migaia/storage-contract'\nconst token = defineStorageCapability<{ read(): string }>()('application-catalog')\nexport const implementation = implement(token, { read: () => 'ready' })"
    },
    ICapabilityStore: {
      summary: t(
        'Original base refined with exact APIs, full transaction scope and builder augmentation.',
        '保留具体 API、完整事务视图与构建器增强的基础对象投影。'
      ),
      members: {
        dispose: {
          summary: {
            en: 'Release accepted work and original native resources without acquiring any new close authority.',
            zh: '排空已接受工作并释放原生资源，不获取新的关闭权限。'
          },
          params: {},
          returns: {
            en: 'The original cached main cleanup Promise; native cleanup failure rejects with its original reachable cause.',
            zh: '返回原缓存主清理结果，原生清理失败以可追踪的原始原因拒绝。'
          },
          example:
            "import type { IStorageResource } from '@migaia/storage-contract'\nexport async function close(resource: IStorageResource) { await resource.dispose() }"
        },
        '[Symbol.asyncDispose]': {
          summary: {
            en: 'Use the original asynchronous resource-disposal protocol after accepted work drains.',
            zh: '在已接受工作排空后使用原异步资源释放协议。'
          },
          params: {},
          returns: {
            en: 'The separately cached symbolic Promise reports cleanup failure and resolves, without replacing the main cleanup Promise.',
            zh: '单独缓存的符号清理报告失败后完成，不替换主清理结果。'
          },
          example:
            "import type { IStorageResource } from '@migaia/storage-contract'\nexport async function close(resource: IStorageResource) { await resource.dispose() }"
        },
        use: {
          summary: {
            en: 'Read the original capability implementation by the authentic token identity.',
            zh: '按真实令牌身份读取原能力实现，不创建替代提供者。'
          },
          params: {
            capability: {
              en: 'Original token exported by its owner or returned by defineStorageCapability.',
              zh: '由所属包导出或能力工厂返回的原始令牌。'
            }
          },
          returns: {
            en: 'The original implementation API; an unsupported authentic token throws UNSUPPORTED_CAPABILITY synchronously.',
            zh: '返回原实现接口；不支持的真实令牌同步抛出 UNSUPPORTED_CAPABILITY。'
          },
          example:
            "import { kv, type ICapabilityStore, type IStorageBase } from '@migaia/storage-contract'\nexport async function read(store: ICapabilityStore<IStorageBase, typeof kv>) {\n  if (store.has(kv)) console.log(await store.use(kv).get('theme'))\n}"
        },
        has: {
          summary: {
            en: 'Inspect the original capability map without invoking native I/O.',
            zh: '只读检查原能力映射，不调用原生访问操作。'
          },
          params: {
            capability: {
              en: 'Authentic capability token from its canonical owner.',
              zh: '来自规范拥有者的真实能力令牌。'
            }
          },
          returns: {
            en: 'True only when that exact token identity has a published implementation.',
            zh: '仅该精确令牌身份具有已发布实现时返回真值。'
          },
          example:
            "import { kv, type ICapabilityStore, type IStorageBase } from '@migaia/storage-contract'\nexport async function read(store: ICapabilityStore<IStorageBase, typeof kv>) {\n  if (store.has(kv)) console.log(await store.use(kv).get('theme'))\n}"
        },
        backend: storeMembers.backend,
        capabilities: storeMembers.capabilities
      },
      scenarios: [
        {
          en: 'Borrow the exact standard API published under an authentic capability token.',
          zh: '按真实能力令牌借用已发布的精确标准接口。'
        }
      ],
      example:
        "import { kv, type ICapabilityStore, type IStorageBase } from '@migaia/storage-contract'\nexport async function read(store: ICapabilityStore<IStorageBase, typeof kv>) {\n  if (store.has(kv)) console.log(await store.use(kv).get('theme'))\n}"
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
      members: {
        publish: {
          summary: {
            en: 'Publish the prepared batch through the same store-owned capability map.',
            zh: '通过同一存储所属能力映射发布已准备批次。'
          },
          params: {},
          returns: {
            en: 'The prepared capability APIs become available without changing store ownership.',
            zh: '已准备能力接口变为可用，不改变存储拥有权。'
          }
        },
        release: {
          summary: {
            en: 'Remove only this publication through its original installation owner.',
            zh: '仅经原安装拥有者移除此发布批次，不影响其它能力。'
          },
          params: {},
          returns: {
            en: 'This batch is released; no store or borrowed backend is closed.',
            zh: '本批次完成释放，不关闭存储或借用后端。'
          }
        }
      }
    },
    ICapabilityInstallPort: {
      summary: t(
        'One store’s opaque prepare/publish/release installation authority.',
        '一个 store 的不透明 prepare/publish/release 安装权限。'
      ),
      members: {
        prepare: {
          summary: {
            en: 'Validate one complete implementation batch before publishing any capability.',
            zh: '发布任何能力前校验整批真实实现，避免部分可见。'
          },
          params: {
            implementations: {
              en: 'Authentic descriptors returned by implement, without duplicate token identities.',
              zh: '实现工厂返回的真实描述符，不含重复令牌身份。'
            }
          },
          returns: {
            en: 'A publication handle for this batch; preparation alone does not make the APIs visible.',
            zh: '返回本批次发布句柄，仅准备不会使接口可见。'
          }
        }
      }
    },
    IChainMethods: {
      summary: t(
        'Finite query, transaction, vector and RDF chain method groups.',
        '有限的 query、事务、vector 与 RDF 链方法分组。'
      ),
      members: {
        query: {
          summary: {
            en: 'Record query method augmentations projected by the original selected Feature set.',
            zh: '由原所选扩展集合投影的记录查询方法增强。'
          }
        },
        tx: {
          summary: {
            en: 'Transaction builder augmentations retained by the original scope owner.',
            zh: '由原作用域拥有者保留的事务构造器方法增强。'
          }
        },
        vector: {
          summary: {
            en: 'Vector query method augmentations without changing native scoring ownership.',
            zh: '不改变原生评分拥有权的向量查询方法增强。'
          }
        },
        rdf: {
          summary: {
            en: 'RDF query augmentations preserving original ground-term and traversal semantics.',
            zh: '保留原完整项与遍历语义的三元组查询方法增强。'
          }
        }
      }
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
      example: t(
        'Root records, vector and RDF lookups retain native API/collection methods, generic payload constraints, original and selected methods, and actual feed/grouping availability. Only the corresponding Feature group is added.',
        '根 records/vector/RDF lookup 保留原生 API/collection 方法、generic payload 约束、原方法与 select 后方法，以及真实 feed/groupBy 能力；仅加入对应 Feature 组。'
      ),
      members: {}
    },
    ILockKey: {
      summary: {
        en: 'Canonical channel-specific identity; equivalent structured values share the original ordered lock domain.',
        zh: '规范通道身份，等价结构值共享原保序锁身份领域。'
      },
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
        },
        collection: {
          summary: {
            en: 'Vector collection name assigned by the application for this point identity.',
            zh: '应用为此向量点身份指定的集合名称。'
          }
        },
        id: {
          summary: {
            en: 'Point identifier assigned by upsert within the same collection.',
            zh: '由向量写入在同一集合内指定的点标识符。'
          }
        },
        quad: {
          summary: {
            en: 'Canonical ground RDF quad that identifies the locked member.',
            zh: '用于标识被锁成员的规范完整三元组。'
          }
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
      },
      scenarios: [
        {
          en: 'Choose original lock admission and bounded waiting before starting a backend operation.',
          zh: '启动后端操作前选择原锁准入与有界等待策略。'
        }
      ],
      example:
        "import { ConcurrencyPolicy } from '@migaia/storage-contract'\nexport const policy = ConcurrencyPolicy.wait({ timeoutMs: 1000 })"
    },
    ITransactionOptions: {
      summary: t(
        'Operation timing, declared locks and a selected concurrency policy.',
        '操作时间选项、声明锁及选定并发策略。'
      ),
      members: {
        lock: {
          summary: {
            en: 'Captured canonical channel lock identities; empty and duplicate handling belong to the original owner.',
            zh: '已捕获规范通道锁身份，空集合与重复处理属于原拥有者。'
          }
        },
        concurrency: {
          summary: {
            en: 'Original authentic policy selecting lock admission and conflict behavior under the same operation budget.',
            zh: '在同一操作预算内选择锁准入与冲突行为的原真实策略。'
          }
        }
      }
    },
    IWriteConcurrencyOptions: {
      summary: t('Per-write concurrency policy override.', '单次写入的并发策略覆盖。'),
      members: {
        concurrency: {
          summary: {
            en: 'Optional authentic policy applied by the existing write owner without a second retry loop.',
            zh: '由既有写入拥有者应用的可选真实策略，不增加第二重试循环。'
          }
        }
      }
    },
    ITransactionBuilder: {
      summary: t(
        'Immutable unlocked chain type retaining its original second augmentation generic.',
        '保留原第二增强泛型的不可变未加锁链类型。'
      ),
      members: {
        concurrency: {
          summary: {
            en: 'Return an immutable builder carrying the selected authentic original policy.',
            zh: '返回携带所选真实原策略的不可变构造器。'
          },
          params: {
            policy: {
              en: 'Authentic ConcurrencyPolicy identity; only optimistic mode is accepted by unlocked native builders.',
              zh: '真实并发策略身份，无锁原生构造器仅接受乐观模式。'
            }
          },
          returns: {
            en: 'A new builder; no native operation or timing budget starts yet.',
            zh: '返回新构造器，此时不启动原生操作或计时预算。'
          },
          example:
            "import { createTransactionBuilder, lockKey, type IRecordStore } from '@migaia/storage-contract'\nexport async function save(store: IRecordStore) {\n  return createTransactionBuilder(store).lock(lockKey.text('theme')).timeout(1000).run(async scope => {\n    await scope.set('theme', 'dark')\n  })\n}"
        },
        signal: {
          summary: {
            en: 'Carry the original caller cancellation signal into the eventual transaction.',
            zh: '将原调用方取消信号传入最终执行的事务。'
          },
          params: {
            signal: {
              en: 'Original caller signal inherited by the transaction without a second timeout owner.',
              zh: '事务继承的原调用方信号，不产生第二超时拥有者。'
            }
          },
          returns: {
            en: 'A new builder preserving its original scope and method augmentations.',
            zh: '返回保留原作用域与方法增强的新构造器。'
          },
          example:
            "import { createTransactionBuilder, lockKey, type IRecordStore } from '@migaia/storage-contract'\nexport async function save(store: IRecordStore) {\n  return createTransactionBuilder(store).lock(lockKey.text('theme')).timeout(1000).run(async scope => {\n    await scope.set('theme', 'dark')\n  })\n}"
        },
        timeout: {
          summary: {
            en: 'Capture a nonnegative safe millisecond budget for the eventual original operation.',
            zh: '为最终原操作捕获非负安全整数毫秒预算。'
          },
          params: {
            ms: {
              en: 'Application-chosen nonnegative safe integer milliseconds, including zero.',
              zh: '应用选择的非负安全整数毫秒数，允许为零。'
            }
          },
          returns: {
            en: 'A new builder; configuration itself consumes no execution budget.',
            zh: '返回新构造器，配置本身不消耗执行预算。'
          },
          example:
            "import { createTransactionBuilder, lockKey, type IRecordStore } from '@migaia/storage-contract'\nexport async function save(store: IRecordStore) {\n  return createTransactionBuilder(store).lock(lockKey.text('theme')).timeout(1000).run(async scope => {\n    await scope.set('theme', 'dark')\n  })\n}"
        },
        lock: {
          summary: {
            en: 'Append canonical channel identities and enable the original transaction terminal.',
            zh: '追加规范通道身份，并启用原事务执行终点。'
          },
          params: {
            first: {
              en: 'First canonical lock identity from lockKey or the same backend owner.',
              zh: '来自锁键工厂或同一后端拥有者的首个规范锁身份。'
            },
            rest: {
              en: 'Further canonical identities, copied only for this new builder step.',
              zh: '其它规范身份，仅为当前新构造步骤进行复制。'
            }
          },
          returns: {
            en: 'A locked immutable builder retaining the exact native scope.',
            zh: '返回保留精确原生作用域的已声明锁不可变构造器。'
          },
          example:
            "import { createTransactionBuilder, lockKey, type IRecordStore } from '@migaia/storage-contract'\nexport async function save(store: IRecordStore) {\n  return createTransactionBuilder(store).lock(lockKey.text('theme')).timeout(1000).run(async scope => {\n    await scope.set('theme', 'dark')\n  })\n}"
        }
      },
      example:
        "import { createTransactionBuilder, lockKey, type IRecordStore } from '@migaia/storage-contract'\nexport async function save(store: IRecordStore) {\n  return createTransactionBuilder(store).lock(lockKey.text('theme')).timeout(1000).run(async scope => {\n    await scope.set('theme', 'dark')\n  })\n}",
      scenarios: [
        {
          en: 'Declare the application lock identities before starting the original native transaction.',
          zh: '启动原生事务前先声明应用所需的锁身份。'
        }
      ]
    },
    ILockedTransactionBuilder: {
      summary: t(
        'Locked chain type exposes run and retains full scope and method augmentation.',
        '加锁链类型公开 run，并保留完整视图与方法增强。'
      ),
      members: {
        concurrency: {
          summary: {
            en: 'Return an immutable builder carrying the selected authentic original policy.',
            zh: '返回携带所选真实原策略的不可变构造器。'
          },
          params: {
            policy: {
              en: 'Authentic ConcurrencyPolicy identity; only optimistic mode is accepted by unlocked native builders.',
              zh: '真实并发策略身份，无锁原生构造器仅接受乐观模式。'
            }
          },
          returns: {
            en: 'A new builder; no native operation or timing budget starts yet.',
            zh: '返回新构造器，此时不启动原生操作或计时预算。'
          },
          example:
            "import { createTransactionBuilder, lockKey, type IRecordStore } from '@migaia/storage-contract'\nexport async function save(store: IRecordStore) {\n  return createTransactionBuilder(store).lock(lockKey.text('theme')).timeout(1000).run(async scope => {\n    await scope.set('theme', 'dark')\n  })\n}"
        },
        signal: {
          summary: {
            en: 'Carry the original caller cancellation signal into the eventual transaction.',
            zh: '将原调用方取消信号传入最终执行的事务。'
          },
          params: {
            signal: {
              en: 'Original caller signal inherited by the transaction without a second timeout owner.',
              zh: '事务继承的原调用方信号，不产生第二超时拥有者。'
            }
          },
          returns: {
            en: 'A new builder preserving its original scope and method augmentations.',
            zh: '返回保留原作用域与方法增强的新构造器。'
          },
          example:
            "import { createTransactionBuilder, lockKey, type IRecordStore } from '@migaia/storage-contract'\nexport async function save(store: IRecordStore) {\n  return createTransactionBuilder(store).lock(lockKey.text('theme')).timeout(1000).run(async scope => {\n    await scope.set('theme', 'dark')\n  })\n}"
        },
        timeout: {
          summary: {
            en: 'Capture a nonnegative safe millisecond budget for the eventual original operation.',
            zh: '为最终原操作捕获非负安全整数毫秒预算。'
          },
          params: {
            ms: {
              en: 'Application-chosen nonnegative safe integer milliseconds, including zero.',
              zh: '应用选择的非负安全整数毫秒数，允许为零。'
            }
          },
          returns: {
            en: 'A new builder; configuration itself consumes no execution budget.',
            zh: '返回新构造器，配置本身不消耗执行预算。'
          },
          example:
            "import { createTransactionBuilder, lockKey, type IRecordStore } from '@migaia/storage-contract'\nexport async function save(store: IRecordStore) {\n  return createTransactionBuilder(store).lock(lockKey.text('theme')).timeout(1000).run(async scope => {\n    await scope.set('theme', 'dark')\n  })\n}"
        },
        lock: {
          summary: {
            en: 'Append canonical channel identities and enable the original transaction terminal.',
            zh: '追加规范通道身份，并启用原事务执行终点。'
          },
          params: {
            first: {
              en: 'First canonical lock identity from lockKey or the same backend owner.',
              zh: '来自锁键工厂或同一后端拥有者的首个规范锁身份。'
            },
            rest: {
              en: 'Further canonical identities, copied only for this new builder step.',
              zh: '其它规范身份，仅为当前新构造步骤进行复制。'
            }
          },
          returns: {
            en: 'A locked immutable builder retaining the exact native scope.',
            zh: '返回保留精确原生作用域的已声明锁不可变构造器。'
          },
          example:
            "import { createTransactionBuilder, lockKey, type IRecordStore } from '@migaia/storage-contract'\nexport async function save(store: IRecordStore) {\n  return createTransactionBuilder(store).lock(lockKey.text('theme')).timeout(1000).run(async scope => {\n    await scope.set('theme', 'dark')\n  })\n}"
        },
        run: {
          summary: {
            en: 'Invoke the original backend transaction exactly once with the captured builder intent.',
            zh: '携带已捕获构造意图，精确调用一次原后端事务。'
          },
          params: {
            run: {
              en: 'Application callback receiving the exact authentic native scope.',
              zh: '接收精确真实原生作用域的应用回调。'
            }
          },
          returns: {
            en: 'The original transaction Promise and awaited callback value, after real native settlement.',
            zh: '返回原事务结果及等待后的回调值，均在原生工作真实结算后完成。'
          },
          example:
            "import { createTransactionBuilder, lockKey, type IRecordStore } from '@migaia/storage-contract'\nexport async function save(store: IRecordStore) {\n  return createTransactionBuilder(store).lock(lockKey.text('theme')).timeout(1000).run(async scope => {\n    await scope.set('theme', 'dark')\n  })\n}"
        }
      },
      example:
        "import { createTransactionBuilder, lockKey, type IRecordStore } from '@migaia/storage-contract'\nexport async function save(store: IRecordStore) {\n  return createTransactionBuilder(store).lock(lockKey.text('theme')).timeout(1000).run(async scope => {\n    await scope.set('theme', 'dark')\n  })\n}",
      scenarios: [
        {
          en: 'Declare the application lock identities before starting the original native transaction.',
          zh: '启动原生事务前先声明应用所需的锁身份。'
        }
      ]
    },
    IOptimisticTransactionBuilder: {
      summary: t(
        'Native immutable transaction chain with run from the root, no lock method and only authentic optimistic policies; the original transaction retains execution authority.',
        '原生不可变事务链：根部具备 run、没有 lock，仅接受真实乐观策略；执行权限仍属于原 transaction。'
      ),
      members: {
        concurrency: {
          summary: {
            en: 'Return an immutable builder carrying the selected authentic original policy.',
            zh: '返回携带所选真实原策略的不可变构造器。'
          },
          params: {
            policy: {
              en: 'Authentic ConcurrencyPolicy identity; only optimistic mode is accepted by unlocked native builders.',
              zh: '真实并发策略身份，无锁原生构造器仅接受乐观模式。'
            }
          },
          returns: {
            en: 'A new builder; no native operation or timing budget starts yet.',
            zh: '返回新构造器，此时不启动原生操作或计时预算。'
          },
          example:
            "import { createTransactionBuilder, type IRecordStore } from '@migaia/storage-contract'\nexport async function save(store: IRecordStore) {\n  return createTransactionBuilder(store, undefined, undefined, { mode: 'optimistic' })\n    .timeout(1000).run(scope => scope.set('theme', 'dark'))\n}"
        },
        signal: {
          summary: {
            en: 'Carry the original caller cancellation signal into the eventual transaction.',
            zh: '将原调用方取消信号传入最终执行的事务。'
          },
          params: {
            signal: {
              en: 'Original caller signal inherited by the transaction without a second timeout owner.',
              zh: '事务继承的原调用方信号，不产生第二超时拥有者。'
            }
          },
          returns: {
            en: 'A new builder preserving its original scope and method augmentations.',
            zh: '返回保留原作用域与方法增强的新构造器。'
          },
          example:
            "import { createTransactionBuilder, type IRecordStore } from '@migaia/storage-contract'\nexport async function save(store: IRecordStore) {\n  return createTransactionBuilder(store, undefined, undefined, { mode: 'optimistic' })\n    .timeout(1000).run(scope => scope.set('theme', 'dark'))\n}"
        },
        timeout: {
          summary: {
            en: 'Capture a nonnegative safe millisecond budget for the eventual original operation.',
            zh: '为最终原操作捕获非负安全整数毫秒预算。'
          },
          params: {
            ms: {
              en: 'Application-chosen nonnegative safe integer milliseconds, including zero.',
              zh: '应用选择的非负安全整数毫秒数，允许为零。'
            }
          },
          returns: {
            en: 'A new builder; configuration itself consumes no execution budget.',
            zh: '返回新构造器，配置本身不消耗执行预算。'
          },
          example:
            "import { createTransactionBuilder, type IRecordStore } from '@migaia/storage-contract'\nexport async function save(store: IRecordStore) {\n  return createTransactionBuilder(store, undefined, undefined, { mode: 'optimistic' })\n    .timeout(1000).run(scope => scope.set('theme', 'dark'))\n}"
        },
        run: {
          summary: {
            en: 'Invoke the original backend transaction exactly once with the captured builder intent.',
            zh: '携带已捕获构造意图，精确调用一次原后端事务。'
          },
          params: {
            run: {
              en: 'Application callback receiving the exact authentic native scope.',
              zh: '接收精确真实原生作用域的应用回调。'
            }
          },
          returns: {
            en: 'The original transaction Promise and awaited callback value, after real native settlement.',
            zh: '返回原事务结果及等待后的回调值，均在原生工作真实结算后完成。'
          },
          example:
            "import { createTransactionBuilder, type IRecordStore } from '@migaia/storage-contract'\nexport async function save(store: IRecordStore) {\n  return createTransactionBuilder(store, undefined, undefined, { mode: 'optimistic' })\n    .timeout(1000).run(scope => scope.set('theme', 'dark'))\n}"
        }
      },
      example:
        "import { createTransactionBuilder, type IRecordStore } from '@migaia/storage-contract'\nexport async function save(store: IRecordStore) {\n  return createTransactionBuilder(store, undefined, undefined, { mode: 'optimistic' })\n    .timeout(1000).run(scope => scope.set('theme', 'dark'))\n}",
      scenarios: [
        {
          en: 'Execute a native atomic optimistic backend without inventing a key-lock domain.',
          zh: '执行原生原子乐观后端，不虚构键锁领域。'
        }
      ]
    },
    IOptimisticTransactionBuilderMode: {
      summary: t(
        'Optional fourth author descriptor {mode:"optimistic"}; omission preserves the existing lock-required builder.',
        '可选第四作者描述符 {mode:"optimistic"}；省略时保持既有需声明锁的 builder。'
      ),
      members: {
        mode: {
          summary: {
            en: 'Explicit author-only optimistic mode exposes native run without any fabricated key lock.',
            zh: '显式作者乐观模式公开原生执行入口，不虚构任何键锁。'
          }
        }
      }
    },
    IVersionedEnvelope: {
      summary: t(
        'Own safe version and caller-owned non-null state container.',
        '自有安全版本与调用方拥有的非空状态容器。'
      ),
      members: {
        version: {
          summary: {
            en: 'Own nonnegative safe integer archive version validated before migration.',
            zh: '升级前校验的自有非负安全整数存档版本。'
          }
        },
        state: {
          summary: {
            en: 'Original non-null archived state, retained by identity rather than cloned by envelope admission.',
            zh: '原非空存档状态，信封准入保留其身份而不进行克隆。'
          }
        }
      },
      scenarios: [
        {
          en: 'Validate archive version and preserve original state identity before migration.',
          zh: '升级前校验存档版本，并保留原始状态身份。'
        }
      ],
      example:
        "import { assertVersionedEnvelope } from '@migaia/storage-contract'\nexport const archive = assertVersionedEnvelope({ version: 1, state: { theme: 'dark' } })"
    },
    IMigrationStepContext: {
      summary: t(
        'One source/target version transition with an optional borrowed cancellation signal.',
        '一次来源/目标版本转换及可选借用取消信号。'
      ),
      members: {
        fromVersion: {
          summary: {
            en: 'Original safe source version assigned by the migration runner.',
            zh: '升级运行器指定的原始安全来源版本号。'
          }
        },
        toVersion: {
          summary: {
            en: 'Next target version assigned by the canonical continuous plan.',
            zh: '规范连续升级计划指定的下一个目标版本号。'
          }
        },
        signal: {
          summary: {
            en: 'Original operation signal borrowed by this one asynchronous step.',
            zh: '当前单个异步步骤借用的原操作取消信号。'
          }
        }
      }
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
      members: {
        reset: {
          summary: {
            en: 'Application callback receiving the old state and producing a replacement for the selected version.',
            zh: '应用回调接收旧状态，并为指定版本产生替换状态。'
          }
        }
      }
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
      members: {
        version: {
          summary: {
            en: 'Current nonnegative safe version chosen by the application.',
            zh: '应用选择的当前非负安全整数版本号。'
          }
        },
        baseVersion: {
          summary: {
            en: 'Earliest source version supported by the captured continuous step chain.',
            zh: '已捕获连续升级步骤链支持的最早来源版本。'
          }
        },
        steps: {
          summary: {
            en: 'Frozen target-version callbacks captured once during plan creation.',
            zh: '创建计划时捕获一次并冻结的目标版本回调集合。'
          }
        },
        reset: {
          summary: {
            en: 'Optional exclusive reset callback replacing step traversal with one new state.',
            zh: '可选且与步骤遍历互斥的重置回调，产生单个新状态。'
          }
        }
      },
      scenarios: [
        {
          en: 'Upgrade a known archived state through the declared continuous target-version steps.',
          zh: '按声明的连续目标版本步骤升级已知存档状态。'
        }
      ],
      example:
        "import { createMigrationPlan, migrateEnvelope } from '@migaia/storage-contract'\nconst plan = createMigrationPlan({ version: 1, steps: { 1: old => ({ previous: old }) } })\nconsole.log(await migrateEnvelope(plan, { version: 0, state: 'draft' }))"
    },
    IMigrationStepObserver: {
      summary: t(
        'Nonblocking before/after observers with a synchronous failure reporter.',
        '不阻塞的步骤前后观察器及同步失败报告。'
      ),
      members: {
        beforeStep: {
          summary: {
            en: 'Observe source and target versions before the original step callback starts.',
            zh: '在原步骤回调开始前观察来源版本与目标版本。'
          }
        },
        afterStep: {
          summary: {
            en: 'Observe the completed original step without replacing its returned state.',
            zh: '观察已完成的原步骤，不替换其返回状态。'
          }
        },
        report: {
          summary: {
            en: 'Report observer failures while leaving the migration primary result intact.',
            zh: '报告观察者失败，同时保持升级首要结果不变。'
          }
        }
      }
    },
    IMigrationRunOptions: {
      summary: t(
        'Borrowed cancellation, utility reporter and step observation configuration.',
        '借用的取消、工具报告器与步骤观察配置。'
      ),
      members: {
        observe: {
          summary: {
            en: 'Optional original before/after step observer; it cannot change migration values.',
            zh: '可选原步骤前后观察者，不能修改升级返回值。'
          }
        },
        signal: {
          summary: {
            en: 'Original caller cancellation signal checked by the asynchronous migration owner.',
            zh: '由异步升级拥有者检查的原调用方取消信号。'
          }
        },
        report: {
          summary: {
            en: 'Original reporter for observation or late cleanup failures, preserving the primary error.',
            zh: '观察或迟到清理失败使用的原报告器，不替换首要错误。'
          }
        }
      }
    },
    ICodecStageObserver: {
      summary: t(
        'Observation-only encode/decode stages bound to the original real store and transaction owner.',
        '绑定原真实 store 与事务拥有者的只观察编解码阶段。'
      ),
      members: {
        kind: {
          summary: {
            en: 'Codec stage discriminator used by the original codec observer owner.',
            zh: '原编解码观察者拥有者使用的阶段区分字段。'
          },
          values: {
            enum: 'StorageStageKind'
          }
        },
        forTransaction: {
          summary: {
            en: 'Bind observations to the original authentic transaction view, without creating a second codec.',
            zh: '将观察绑定到原真实事务视图，不创建第二套编解码器。'
          }
        },
        beforeEncode: {
          summary: {
            en: 'Observe the original value immediately before its selected encoder runs.',
            zh: '在选定编码器运行之前观察原始待编码数据值。'
          }
        },
        afterEncode: {
          summary: {
            en: 'Observe completion of original encoding without replacing the encoded result.',
            zh: '观察原编码完成，不替换已编码结果。'
          }
        },
        onEncodeError: {
          summary: {
            en: 'Observe the original encoding failure while preserving its primary cause.',
            zh: '观察原编码失败，同时保留首要错误原因。'
          }
        },
        beforeDecode: {
          summary: {
            en: 'Observe native stored bytes or text before the original decoder runs.',
            zh: '在原解码器运行之前观察原生已存字节或文本。'
          }
        },
        afterDecode: {
          summary: {
            en: 'Observe the original decoded value without changing its clone boundary.',
            zh: '观察原已解码值，不改变数据克隆边界。'
          }
        },
        onDecodeError: {
          summary: {
            en: 'Observe original decoding failure without substituting successful data.',
            zh: '观察原解码失败，不以成功数据替代该错误。'
          }
        },
        report: {
          summary: {
            en: 'Report observer failures through the original owner without replacing the primary operation result.',
            zh: '经原拥有者报告观察者失败，不替换首要操作结果。'
          }
        }
      }
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
      members: {
        ...storeMembers,
        dispose: {
          summary: {
            en: 'Release accepted work and original native resources without acquiring any new close authority.',
            zh: '排空已接受工作并释放原生资源，不获取新的关闭权限。'
          },
          params: {},
          returns: {
            en: 'The original cached main cleanup Promise; native cleanup failure rejects with its original reachable cause.',
            zh: '返回原缓存主清理结果，原生清理失败以可追踪的原始原因拒绝。'
          }
        },
        '[Symbol.asyncDispose]': {
          summary: {
            en: 'Use the original asynchronous resource-disposal protocol after accepted work drains.',
            zh: '在已接受工作排空后使用原异步资源释放协议。'
          },
          params: {},
          returns: {
            en: 'The separately cached symbolic Promise reports cleanup failure and resolves, without replacing the main cleanup Promise.',
            zh: '单独缓存的符号清理报告失败后完成，不替换主清理结果。'
          }
        }
      }
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
      members: {
        ...recordMembers,
        dispose: {
          summary: {
            en: 'Release accepted work and original native resources without acquiring any new close authority.',
            zh: '排空已接受工作并释放原生资源，不获取新的关闭权限。'
          },
          params: {},
          returns: {
            en: 'The original cached main cleanup Promise; native cleanup failure rejects with its original reachable cause.',
            zh: '返回原缓存主清理结果，原生清理失败以可追踪的原始原因拒绝。'
          },
          example:
            "import type { IRecordStore } from '@migaia/storage-contract'\nexport async function close(store: IRecordStore) { await store.dispose() }"
        },
        '[Symbol.asyncDispose]': {
          summary: {
            en: 'Use the original asynchronous resource-disposal protocol after accepted work drains.',
            zh: '在已接受工作排空后使用原异步资源释放协议。'
          },
          params: {},
          returns: {
            en: 'The separately cached symbolic Promise reports cleanup failure and resolves, without replacing the main cleanup Promise.',
            zh: '单独缓存的符号清理报告失败后完成，不替换主清理结果。'
          },
          example:
            "import type { IRecordStore } from '@migaia/storage-contract'\nexport async function close(store: IRecordStore) { await store.dispose() }"
        }
      }
    },
    IConformanceHarness: {
      summary: t(
        'Existing consumer runner adapter; the contract owns no execution scheduler or notification deadline.',
        '现有消费者 runner 接点；契约不拥有执行调度或通知期限。'
      ),
      members: {
        describe: {
          summary: {
            en: 'Register the conformance group in the caller-supplied existing runner.',
            zh: '在调用方提供的既有运行器中登记一致性用例分组。'
          },
          params: {
            name: {
              en: 'Human-readable backend and capability group name chosen by the suite.',
              zh: '套件选择的可读后端与能力分组名称。'
            },
            run: {
              en: 'Synchronous registration callback executed by the original runner.',
              zh: '由原运行器执行的同步用例登记回调。'
            }
          },
          returns: {
            en: 'Registration completes; execution and failure reporting remain runner-owned.',
            zh: '登记完成，执行与失败报告仍归运行器拥有。'
          }
        },
        it: {
          summary: {
            en: 'Register one original conformance case without creating a test runtime.',
            zh: '登记单个原一致性用例，不创建新的测试运行时。'
          },
          params: {
            name: {
              en: 'Human-readable behavior label selected by the canonical suite.',
              zh: '由规范套件选择的可读行为标签。'
            },
            run: {
              en: 'Original synchronous or asynchronous case body; rejection is observed by the supplied runner.',
              zh: '原同步或异步用例正文，拒绝由所提供运行器观察。'
            }
          },
          returns: {
            en: 'The existing runner receives this case and owns its assertion failures.',
            zh: '既有运行器接收此用例，并拥有其断言失败。'
          }
        },
        expect: {
          summary: {
            en: 'Borrow the existing runner assertion object for one actual value.',
            zh: '为单个实际值借用既有运行器的断言对象。'
          },
          params: {
            actual: {
              en: 'Actual runtime value or Promise returned by the native behavior under test.',
              zh: '被检验原生行为返回的实际运行时值或异步结果。'
            }
          },
          returns: {
            en: 'The original matcher facade; this contract does not implement another assertion engine.',
            zh: '返回原匹配器门面，契约不实现第二套断言引擎。'
          }
        }
      }
    },
    IConformanceMatchers: {
      summary: t(
        'Required consumer assertions; assertion failures retain their runner identity.',
        '必需的消费者断言；失败保留 runner 原错误身份。'
      ),
      members: {
        toBe: {
          summary: {
            en: 'Assert original runner identity equality for the actual value.',
            zh: '按原运行器规则断言实际值的身份相等。'
          },
          params: {
            expected: {
              en: 'Expected original value, shape or supported error matcher supplied by this case.',
              zh: '当前用例给出的预期原值、形状或受支持错误匹配器。'
            }
          },
          returns: {
            en: 'The original runner assertion succeeds or throws its own failure.',
            zh: '原运行器断言成功，或抛出其自身的断言失败。'
          }
        },
        toEqual: {
          summary: {
            en: 'Assert original runner structural equality for the actual value.',
            zh: '按原运行器规则断言实际值的结构相等。'
          },
          params: {
            expected: {
              en: 'Expected original value, shape or supported error matcher supplied by this case.',
              zh: '当前用例给出的预期原值、形状或受支持错误匹配器。'
            }
          },
          returns: {
            en: 'The original runner assertion succeeds or throws its own failure.',
            zh: '原运行器断言成功，或抛出其自身的断言失败。'
          }
        },
        toBeNull: {
          summary: {
            en: 'Assert that the actual runtime value is exactly null.',
            zh: '断言实际运行时值精确为空值，而非未定义。'
          },
          params: {},
          returns: {
            en: 'The original runner assertion succeeds or throws its own failure.',
            zh: '原运行器断言成功，或抛出其自身的断言失败。'
          }
        },
        toBeUndefined: {
          summary: {
            en: 'Assert that the actual runtime value is exactly undefined.',
            zh: '断言实际运行时值精确为未定义，而非空值。'
          },
          params: {},
          returns: {
            en: 'The original runner assertion succeeds or throws its own failure.',
            zh: '原运行器断言成功，或抛出其自身的断言失败。'
          }
        },
        toBeDefined: {
          summary: {
            en: 'Assert that the actual runtime value is defined under the original runner.',
            zh: '按原运行器规则断言实际运行时值已定义。'
          },
          params: {},
          returns: {
            en: 'The original runner assertion succeeds or throws its own failure.',
            zh: '原运行器断言成功，或抛出其自身的断言失败。'
          }
        },
        toThrow: {
          summary: {
            en: 'Assert original thrown failure matching without replacing the original error.',
            zh: '匹配原抛出失败，不替换其原始错误对象。'
          },
          params: {
            expected: {
              en: 'Expected original value, shape or supported error matcher supplied by this case.',
              zh: '当前用例给出的预期原值、形状或受支持错误匹配器。'
            }
          },
          returns: {
            en: 'The original runner assertion succeeds or throws its own failure.',
            zh: '原运行器断言成功，或抛出其自身的断言失败。'
          }
        },
        toMatchObject: {
          summary: {
            en: 'Assert the expected semantic fields on the actual native result or failure.',
            zh: '断言实际原生结果或失败具有预期语义字段。'
          },
          params: {
            expected: {
              en: 'Expected original value, shape or supported error matcher supplied by this case.',
              zh: '当前用例给出的预期原值、形状或受支持错误匹配器。'
            }
          },
          returns: {
            en: 'The original runner assertion succeeds or throws its own failure.',
            zh: '原运行器断言成功，或抛出其自身的断言失败。'
          }
        }
      }
    },
    IConformanceAsyncMatchers: {
      summary: {
        en: 'Promise-valued assertion facade supplied by the caller-selected existing test runner.',
        zh: '调用方所选既有运行器提供的异步结果断言门面类型。'
      },
      members: {}
    },
    ITextWatchApi: {
      summary: t(
        'Native text-key invalidation stream through watch(key,ctx?), returning the original resource iterator.',
        'watch(key,ctx?) 提供的原生文本键失效流，返回原资源迭代器。'
      ),
      members: {
        watch: {
          summary: {
            en: 'Stream native invalidation descriptions for one text key, without replay or value delivery guarantees.',
            zh: '流式读取单个文本键的原生失效描述，不保证重放或值传递。'
          },
          params: {
            key: {
              en: 'Text key assigned by the application in this same store namespace.',
              zh: '应用在同一存储命名空间内指定的文本键。'
            },
            ctx: {
              en: 'Original optional operation context with cancellation and one captured timeout budget.',
              zh: '原可选操作上下文，承载取消信号与单次捕获的超时预算。'
            }
          },
          returns: {
            en: 'Original disposable invalidation iterator; it is not a durable change log.',
            zh: '返回原可释放失效迭代器，不是可靠变更日志。'
          }
        }
      }
    },
    ITextChangeFeedApi: {
      summary: {
        en: 'Original post-commit observer and native text-watch stream with provider-owned delivery guarantees.',
        zh: '原提交后观察者与原生文本观察流，传递保证由提供者拥有。'
      },
      members: {
        watch: {
          summary: {
            en: 'Stream native invalidation descriptions for one text key, without replay or value delivery guarantees.',
            zh: '流式读取单个文本键的原生失效描述，不保证重放或值传递。'
          },
          params: {
            key: {
              en: 'Text key assigned by the application in this same store namespace.',
              zh: '应用在同一存储命名空间内指定的文本键。'
            },
            ctx: {
              en: 'Original optional operation context with cancellation and one captured timeout budget.',
              zh: '原可选操作上下文，承载取消信号与单次捕获的超时预算。'
            }
          },
          returns: {
            en: 'Original disposable invalidation iterator; it is not a durable change log.',
            zh: '返回原可释放失效迭代器，不是可靠变更日志。'
          },
          example:
            "import type { ITextChangeFeedApi } from '@migaia/storage-contract'\nexport async function observe(feed: ITextChangeFeedApi) {\n  await using stream = feed.watch('theme')\n  for await (const change of stream) console.log(change.kind)\n}"
        },
        subscribeChanges: {
          summary: {
            en: 'Register an original post-commit invalidation listener without creating a durable history source.',
            zh: '登记原提交后失效监听者，不创建可靠历史来源。'
          },
          params: {
            listener: {
              en: 'Receives original channel/key identity; thrown or rejected observer failures are reported.',
              zh: '接收原通道与键身份，观察者抛出或拒绝时会报告。'
            }
          },
          returns: {
            en: 'An unsubscribe function removing only this original listener.',
            zh: '返回仅移除当前原监听者的取消订阅函数。'
          },
          example:
            "import type { ITextChangeFeedApi } from '@migaia/storage-contract'\nexport function observe(feed: ITextChangeFeedApi) {\n  return feed.subscribeChanges(change => console.log(change.channel, change.kind))\n}"
        }
      },
      example:
        "import type { ITextChangeFeedApi } from '@migaia/storage-contract'\nexport function observe(feed: ITextChangeFeedApi) {\n  return feed.subscribeChanges(change => console.log(change.channel, change.kind))\n}",
      scenarios: [
        {
          en: 'Invalidate a local projection only after the provider reports a committed native change.',
          zh: '仅在提供者报告原生提交变更后，失效本地数据投影。'
        }
      ]
    },
    IWithChangeFeedCapabilities: {
      summary: t(
        'Known-store type refinement retaining native, sync, metadata, transaction and Feature types; only existing records/vector/RDF APIs gain the declared feed.',
        '已知 store 类型细化，保留原生、同步、元数据、事务与 Feature；仅既有 records/vector/RDF API 获得 feed 声明。'
      ),
      members: {
        capabilities: {
          summary: {
            en: 'Original immutable capability facts refined only with changeFeed:true after genuine provider admission.',
            zh: '真实提供者准入后，仅将原不可变能力事实收窄为支持变更通知。'
          }
        }
      },
      scenarios: [
        {
          en: 'Refine a genuinely admitted store that already supplies native invalidation notifications.',
          zh: '收窄已真实准入且已提供原生失效通知的存储类型。'
        }
      ],
      example:
        "import { asChangeFeedStore, type IKeyValueStore } from '@migaia/storage-contract'\nexport function observe(store: IKeyValueStore) {\n  const feed = asChangeFeedStore(store)\n  const off = feed.subscribeChanges(change => console.log(change.kind))\n  return off\n}"
    },
    IChangeFeedStore: {
      summary: t(
        'Existing key-value store with real subscribeChanges and watch(key,ctx?) functions; native invalidation does not promise reliable replay.',
        '同时具有真实 subscribeChanges 与 watch(key,ctx?) 的既有键值存储；原生失效通知不承诺可靠重放。'
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
        },
        dispose: {
          summary: {
            en: 'Release accepted work and original native resources without acquiring any new close authority.',
            zh: '排空已接受工作并释放原生资源，不获取新的关闭权限。'
          },
          params: {},
          returns: {
            en: 'The original cached main cleanup Promise; native cleanup failure rejects with its original reachable cause.',
            zh: '返回原缓存主清理结果，原生清理失败以可追踪的原始原因拒绝。'
          }
        },
        '[Symbol.asyncDispose]': {
          summary: {
            en: 'Use the original asynchronous resource-disposal protocol after accepted work drains.',
            zh: '在已接受工作排空后使用原异步资源释放协议。'
          },
          params: {},
          returns: {
            en: 'The separately cached symbolic Promise reports cleanup failure and resolves, without replacing the main cleanup Promise.',
            zh: '单独缓存的符号清理报告失败后完成，不替换主清理结果。'
          }
        },
        watch: {
          summary: {
            en: 'Stream native invalidation descriptions for one text key, without replay or value delivery guarantees.',
            zh: '流式读取单个文本键的原生失效描述，不保证重放或值传递。'
          },
          params: {
            key: {
              en: 'Text key assigned by the application in this same store namespace.',
              zh: '应用在同一存储命名空间内指定的文本键。'
            },
            ctx: {
              en: 'Original optional operation context with cancellation and one captured timeout budget.',
              zh: '原可选操作上下文，承载取消信号与单次捕获的超时预算。'
            }
          },
          returns: {
            en: 'Original disposable invalidation iterator; it is not a durable change log.',
            zh: '返回原可释放失效迭代器，不是可靠变更日志。'
          }
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
      members: operationMembers,
      scenarios: [
        {
          en: 'Capture caller cancellation and paging intent once before crossing an asynchronous boundary.',
          zh: '跨越异步边界之前，单次捕获调用方取消与分页意图。'
        }
      ],
      example:
        "import { snapshotOperationContext } from '@migaia/storage-contract'\nexport const context = snapshotOperationContext({ timeoutMs: 1000, pageSize: 64 })"
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
      members: {
        ...transactionMembers,
        use: {
          summary: {
            en: 'Read the original capability implementation by the authentic token identity.',
            zh: '按真实令牌身份读取原能力实现，不创建替代提供者。'
          },
          params: {
            capability: {
              en: 'Original token exported by its owner or returned by defineStorageCapability.',
              zh: '由所属包导出或能力工厂返回的原始令牌。'
            }
          },
          returns: {
            en: 'The original implementation API; unsupported tokens reject with UNSUPPORTED_CAPABILITY.',
            zh: '返回原实现接口，不支持的令牌以不支持能力错误拒绝。'
          }
        },
        get: {
          summary: {
            en: 'Read the current transaction text draft and its original native snapshot.',
            zh: '读取当前事务的文本草稿与原生快照，能看到本作用域写入。'
          },
          params: {
            key: {
              en: 'Application-assigned logical key, or the key returned by the same original backend.',
              zh: '应用指定的逻辑键，或同一原始后端返回的键。'
            }
          },
          returns: {
            en: 'Stored text or null for absence, without leaving the authentic transaction scope.',
            zh: '返回已存文本，不存在时为空，不离开真实事务作用域。'
          }
        },
        set: {
          summary: {
            en: 'Stage one text value in the original transaction draft.',
            zh: '在原事务草稿中暂存单个文本值，随原生终点提交。'
          },
          params: {
            key: {
              en: 'Application-assigned logical key, or the key returned by the same original backend.',
              zh: '应用指定的逻辑键，或同一原始后端返回的键。'
            },
            value: {
              en: 'Application text payload, encoded before entering this channel when necessary.',
              zh: '应用文本载荷，需要时应在进入此通道前完成编码。'
            },
            options: {
              en: 'Optional original conflict policy; execution context is inherited from the transaction.',
              zh: '可选原冲突策略，执行上下文继承所属事务。'
            }
          },
          returns: {
            en: 'The draft accepts the write; durability is confirmed only by the outer commit.',
            zh: '草稿接受写入，仅外层提交才能确认持久化。'
          }
        },
        remove: {
          summary: {
            en: 'Stage removal of one text identity in this original transaction.',
            zh: '在当前原事务中暂存单个文本身份的删除。'
          },
          params: {
            key: {
              en: 'Application-assigned logical key, or the key returned by the same original backend.',
              zh: '应用指定的逻辑键，或同一原始后端返回的键。'
            }
          },
          returns: {
            en: 'The draft accepts deletion; removing an absent entry is a no-op.',
            zh: '草稿接受删除，不存在的条目不产生修改。'
          }
        },
        has: {
          summary: {
            en: 'Check visible text membership in the current authentic transaction draft.',
            zh: '检查当前真实事务草稿中可见的文本成员关系。'
          },
          params: {
            key: {
              en: 'Application-assigned logical key, or the key returned by the same original backend.',
              zh: '应用指定的逻辑键，或同一原始后端返回的键。'
            }
          },
          returns: {
            en: 'True when the draft currently exposes an unexpired text value.',
            zh: '当前草稿存在未过期文本值时返回真值。'
          }
        },
        getMany: {
          summary: {
            en: 'Read one original transaction text snapshot in caller order, including duplicate positions.',
            zh: '按调用方顺序读取原事务文本快照，并保留重复位置。'
          },
          params: {
            keys: {
              en: 'Logical text keys captured before the shared batch is read.',
              zh: '共享批量读取前捕获的逻辑文本键集合。'
            }
          },
          returns: {
            en: 'Same-length values with undefined for missing entries; partial decode success is not returned.',
            zh: '返回同长度值数组，缺失为未定义，不返回部分解码成功。'
          }
        },
        setMany: {
          summary: {
            en: 'Stage a validated text batch inside the same original transaction draft.',
            zh: '在同一原事务草稿内暂存完整校验后的文本批量。'
          },
          params: {
            entries: {
              en: 'Dense key/value entries with optional TTL; duplicate canonical identities reject before mutation.',
              zh: '稠密键值条目与可选期限，规范重复身份在修改前拒绝。'
            }
          },
          returns: {
            en: 'All accepted entries join the original commit or rollback together.',
            zh: '全部已接受条目共同加入原提交或回滚。'
          }
        },
        removeMany: {
          summary: {
            en: 'Stage deletion of distinct canonical text identities in the same transaction.',
            zh: '在同一事务中暂存去重后的规范文本身份删除。'
          },
          params: {
            keys: {
              en: 'Logical text keys; equivalent duplicates are accepted only once for counting.',
              zh: '逻辑文本键，等价重复项仅参与一次删除计数。'
            }
          },
          returns: {
            en: 'Number of actual draft removals; final durability still follows outer commit.',
            zh: '返回草稿实际删除数，最终持久化仍随外层提交。'
          }
        },
        removeByPrefix: {
          summary: {
            en: 'Remove matching text entries from the current native and draft key range.',
            zh: '从当前原生与草稿键范围中删除匹配的文本条目。'
          },
          params: {
            prefix: {
              en: 'Canonical typed prefix in the existing ordered logical-key domain.',
              zh: '既有保序逻辑键域中的规范类型化前缀。'
            }
          },
          returns: {
            en: 'Actual accepted draft deletion count, without scanning unrelated channels.',
            zh: '返回草稿实际接受删除数，不扫描无关通道。'
          }
        },
        getBytes: {
          summary: {
            en: 'Read detached bytes from the original transaction draft.',
            zh: '从原事务草稿读取已脱离外部引用的字节。'
          },
          params: {
            key: {
              en: 'Application-assigned logical key, or the key returned by the same original backend.',
              zh: '应用指定的逻辑键，或同一原始后端返回的键。'
            }
          },
          returns: {
            en: 'Stored bytes or null when the byte identity is absent.',
            zh: '返回已存字节，字节身份不存在时为空。'
          }
        },
        setBytes: {
          summary: {
            en: 'Stage bytes through the original byte-channel transaction owner.',
            zh: '经原字节通道事务拥有者暂存字节内容。'
          },
          params: {
            key: {
              en: 'Application-assigned logical key, or the key returned by the same original backend.',
              zh: '应用指定的逻辑键，或同一原始后端返回的键。'
            },
            value: {
              en: 'Application record or byte payload; writes capture it before native mutation.',
              zh: '应用记录或字节载荷，写入会在原生修改前捕获。'
            },
            options: {
              en: 'Original draft conflict policy, without a separate operation budget.',
              zh: '原草稿冲突策略，不提供独立操作预算。'
            }
          },
          returns: {
            en: 'The captured byte write joins the same commit or rollback.',
            zh: '已捕获字节写入加入同一提交或回滚。'
          }
        },
        removeBytes: {
          summary: {
            en: 'Stage deletion in the original byte channel only.',
            zh: '仅在原字节通道中暂存删除操作。'
          },
          params: {
            key: {
              en: 'Application-assigned logical key, or the key returned by the same original backend.',
              zh: '应用指定的逻辑键，或同一原始后端返回的键。'
            }
          },
          returns: {
            en: 'Removal is staged without altering an unrelated text or record identity.',
            zh: '删除已暂存，不改变无关文本或记录身份。'
          }
        },
        getRecord: {
          summary: {
            en: 'Read the current record draft through the original clone boundary.',
            zh: '经原克隆边界读取当前记录草稿内容。'
          },
          params: {
            key: {
              en: 'Application-assigned logical key, or the key returned by the same original backend.',
              zh: '应用指定的逻辑键，或同一原始后端返回的键。'
            }
          },
          returns: {
            en: 'The original record result, or undefined when absent.',
            zh: '返回原记录结果，不存在时为未定义。'
          }
        },
        putRecord: {
          summary: {
            en: 'Stage a detached record under an explicit or backend-generated key.',
            zh: '以显式键或后端生成键暂存已脱离外部引用的记录。'
          },
          params: {
            value: {
              en: 'Application record or byte payload; writes capture it before native mutation.',
              zh: '应用记录或字节载荷，写入会在原生修改前捕获。'
            },
            key: {
              en: 'Application-assigned logical key, or the key returned by the same original backend.',
              zh: '应用指定的逻辑键，或同一原始后端返回的键。'
            },
            options: {
              en: 'Original draft conflict policy, without a separate operation budget.',
              zh: '原草稿冲突策略，不提供独立操作预算。'
            }
          },
          returns: {
            en: 'The accepted logical record key, generated only by the original backend.',
            zh: '返回已接受逻辑记录键，仅原后端负责生成新键。'
          }
        },
        deleteRecord: {
          summary: {
            en: 'Stage deletion of one record identity in this transaction.',
            zh: '在当前事务中暂存单个记录身份的删除。'
          },
          params: {
            key: {
              en: 'Application-assigned logical key, or the key returned by the same original backend.',
              zh: '应用指定的逻辑键，或同一原始后端返回的键。'
            }
          },
          returns: {
            en: 'The original draft accepts deletion without committing early.',
            zh: '原草稿接受删除，不提前提交事务。'
          }
        },
        iterateRecords: {
          summary: {
            en: 'Iterate the bounded native record snapshot merged with current draft changes.',
            zh: '遍历有界原生记录快照，并合并当前草稿修改。'
          },
          params: {
            range: {
              en: 'Optional canonical lower/upper record-key bounds with open-end flags.',
              zh: '可选规范记录键上下界与开区间标记。'
            }
          },
          returns: {
            en: 'Original asynchronous entries; callback expiry and iterator disposal retain their owner.',
            zh: '返回原异步条目，回调过期与迭代释放仍由原拥有者管理。'
          }
        },
        putIndexedRecord: {
          summary: {
            en: 'Stage a record and its declared index projection in the same original draft.',
            zh: '在同一原草稿中暂存记录及其已声明索引投影。'
          },
          params: {
            value: {
              en: 'Application record or byte payload; writes capture it before native mutation.',
              zh: '应用记录或字节载荷，写入会在原生修改前捕获。'
            },
            key: {
              en: 'Application-assigned logical key, or the key returned by the same original backend.',
              zh: '应用指定的逻辑键，或同一原始后端返回的键。'
            },
            handle: {
              en: 'Authentic index handle returned by this same backend and index scope.',
              zh: '同一后端与索引作用域返回的真实索引句柄。'
            },
            projection: {
              en: 'Application-produced index entries matching the handle definitions.',
              zh: '与句柄定义一致、由应用产生的索引条目投影。'
            },
            options: {
              en: 'Original draft conflict policy, without a separate operation budget.',
              zh: '原草稿冲突策略，不提供独立操作预算。'
            }
          },
          returns: {
            en: 'The accepted record key; uniqueness conflicts reject before publication.',
            zh: '返回已接受记录键，唯一性冲突在发布前拒绝。'
          }
        },
        isRecordIndexReady: {
          summary: {
            en: 'Inspect readiness of the same native index scope and generation.',
            zh: '检查同一原生索引作用域与代次是否就绪。'
          },
          params: {
            handle: {
              en: 'Authentic index handle returned by this same backend and index scope.',
              zh: '同一后端与索引作用域返回的真实索引句柄。'
            }
          },
          returns: {
            en: 'True only for the authentic current ready index generation.',
            zh: '仅真实且当前已就绪的索引代次返回真值。'
          }
        },
        iterateRecordIndex: {
          summary: {
            en: 'Iterate an authentic native index range within the original transaction.',
            zh: '在原事务内遍历真实原生索引范围。'
          },
          params: {
            query: {
              en: 'Index handle, index name, bounds, direction and optional limit.',
              zh: '索引句柄、索引名、范围、方向与可选数量上界。'
            }
          },
          returns: {
            en: 'Original ordered key/value entries, including accepted draft changes.',
            zh: '返回原保序键值条目，包含已接受草稿修改。'
          }
        }
      }
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
      members: {
        ...transactionMembers,
        use: {
          summary: {
            en: 'Read the original capability implementation by the authentic token identity.',
            zh: '按真实令牌身份读取原能力实现，不创建替代提供者。'
          },
          params: {
            capability: {
              en: 'Original token exported by its owner or returned by defineStorageCapability.',
              zh: '由所属包导出或能力工厂返回的原始令牌。'
            }
          },
          returns: {
            en: 'The original implementation API; unsupported tokens reject with UNSUPPORTED_CAPABILITY.',
            zh: '返回原实现接口，不支持的令牌以不支持能力错误拒绝。'
          }
        },
        get: {
          summary: {
            en: 'Read the current transaction text draft and its original native snapshot.',
            zh: '读取当前事务的文本草稿与原生快照，能看到本作用域写入。'
          },
          params: {
            key: {
              en: 'Application-assigned logical key, or the key returned by the same original backend.',
              zh: '应用指定的逻辑键，或同一原始后端返回的键。'
            }
          },
          returns: {
            en: 'Stored text or null for absence, without leaving the authentic transaction scope.',
            zh: '返回已存文本，不存在时为空，不离开真实事务作用域。'
          }
        },
        set: {
          summary: {
            en: 'Stage one text value in the original transaction draft.',
            zh: '在原事务草稿中暂存单个文本值，随原生终点提交。'
          },
          params: {
            key: {
              en: 'Application-assigned logical key, or the key returned by the same original backend.',
              zh: '应用指定的逻辑键，或同一原始后端返回的键。'
            },
            value: {
              en: 'Application text payload, encoded before entering this channel when necessary.',
              zh: '应用文本载荷，需要时应在进入此通道前完成编码。'
            },
            options: {
              en: 'Optional original conflict policy; execution context is inherited from the transaction.',
              zh: '可选原冲突策略，执行上下文继承所属事务。'
            }
          },
          returns: {
            en: 'The draft accepts the write; durability is confirmed only by the outer commit.',
            zh: '草稿接受写入，仅外层提交才能确认持久化。'
          }
        },
        remove: {
          summary: {
            en: 'Stage removal of one text identity in this original transaction.',
            zh: '在当前原事务中暂存单个文本身份的删除。'
          },
          params: {
            key: {
              en: 'Application-assigned logical key, or the key returned by the same original backend.',
              zh: '应用指定的逻辑键，或同一原始后端返回的键。'
            }
          },
          returns: {
            en: 'The draft accepts deletion; removing an absent entry is a no-op.',
            zh: '草稿接受删除，不存在的条目不产生修改。'
          }
        },
        has: {
          summary: {
            en: 'Check visible text membership in the current authentic transaction draft.',
            zh: '检查当前真实事务草稿中可见的文本成员关系。'
          },
          params: {
            key: {
              en: 'Application-assigned logical key, or the key returned by the same original backend.',
              zh: '应用指定的逻辑键，或同一原始后端返回的键。'
            }
          },
          returns: {
            en: 'True when the draft currently exposes an unexpired text value.',
            zh: '当前草稿存在未过期文本值时返回真值。'
          }
        },
        getMany: {
          summary: {
            en: 'Read one original transaction text snapshot in caller order, including duplicate positions.',
            zh: '按调用方顺序读取原事务文本快照，并保留重复位置。'
          },
          params: {
            keys: {
              en: 'Logical text keys captured before the shared batch is read.',
              zh: '共享批量读取前捕获的逻辑文本键集合。'
            }
          },
          returns: {
            en: 'Same-length values with undefined for missing entries; partial decode success is not returned.',
            zh: '返回同长度值数组，缺失为未定义，不返回部分解码成功。'
          }
        },
        setMany: {
          summary: {
            en: 'Stage a validated text batch inside the same original transaction draft.',
            zh: '在同一原事务草稿内暂存完整校验后的文本批量。'
          },
          params: {
            entries: {
              en: 'Dense key/value entries with optional TTL; duplicate canonical identities reject before mutation.',
              zh: '稠密键值条目与可选期限，规范重复身份在修改前拒绝。'
            }
          },
          returns: {
            en: 'All accepted entries join the original commit or rollback together.',
            zh: '全部已接受条目共同加入原提交或回滚。'
          }
        },
        removeMany: {
          summary: {
            en: 'Stage deletion of distinct canonical text identities in the same transaction.',
            zh: '在同一事务中暂存去重后的规范文本身份删除。'
          },
          params: {
            keys: {
              en: 'Logical text keys; equivalent duplicates are accepted only once for counting.',
              zh: '逻辑文本键，等价重复项仅参与一次删除计数。'
            }
          },
          returns: {
            en: 'Number of actual draft removals; final durability still follows outer commit.',
            zh: '返回草稿实际删除数，最终持久化仍随外层提交。'
          }
        },
        removeByPrefix: {
          summary: {
            en: 'Remove matching text entries from the current native and draft key range.',
            zh: '从当前原生与草稿键范围中删除匹配的文本条目。'
          },
          params: {
            prefix: {
              en: 'Canonical typed prefix in the existing ordered logical-key domain.',
              zh: '既有保序逻辑键域中的规范类型化前缀。'
            }
          },
          returns: {
            en: 'Actual accepted draft deletion count, without scanning unrelated channels.',
            zh: '返回草稿实际接受删除数，不扫描无关通道。'
          }
        },
        getBytes: {
          summary: {
            en: 'Read detached bytes from the original transaction draft.',
            zh: '从原事务草稿读取已脱离外部引用的字节。'
          },
          params: {
            key: {
              en: 'Application-assigned logical key, or the key returned by the same original backend.',
              zh: '应用指定的逻辑键，或同一原始后端返回的键。'
            }
          },
          returns: {
            en: 'Stored bytes or null when the byte identity is absent.',
            zh: '返回已存字节，字节身份不存在时为空。'
          }
        },
        setBytes: {
          summary: {
            en: 'Stage bytes through the original byte-channel transaction owner.',
            zh: '经原字节通道事务拥有者暂存字节内容。'
          },
          params: {
            key: {
              en: 'Application-assigned logical key, or the key returned by the same original backend.',
              zh: '应用指定的逻辑键，或同一原始后端返回的键。'
            },
            value: {
              en: 'Application record or byte payload; writes capture it before native mutation.',
              zh: '应用记录或字节载荷，写入会在原生修改前捕获。'
            },
            options: {
              en: 'Original draft conflict policy, without a separate operation budget.',
              zh: '原草稿冲突策略，不提供独立操作预算。'
            }
          },
          returns: {
            en: 'The captured byte write joins the same commit or rollback.',
            zh: '已捕获字节写入加入同一提交或回滚。'
          }
        },
        removeBytes: {
          summary: {
            en: 'Stage deletion in the original byte channel only.',
            zh: '仅在原字节通道中暂存删除操作。'
          },
          params: {
            key: {
              en: 'Application-assigned logical key, or the key returned by the same original backend.',
              zh: '应用指定的逻辑键，或同一原始后端返回的键。'
            }
          },
          returns: {
            en: 'Removal is staged without altering an unrelated text or record identity.',
            zh: '删除已暂存，不改变无关文本或记录身份。'
          }
        },
        getRecord: {
          summary: {
            en: 'Read the current record draft through the original clone boundary.',
            zh: '经原克隆边界读取当前记录草稿内容。'
          },
          params: {
            key: {
              en: 'Application-assigned logical key, or the key returned by the same original backend.',
              zh: '应用指定的逻辑键，或同一原始后端返回的键。'
            }
          },
          returns: {
            en: 'The original record result, or undefined when absent.',
            zh: '返回原记录结果，不存在时为未定义。'
          }
        },
        putRecord: {
          summary: {
            en: 'Stage a detached record under an explicit or backend-generated key.',
            zh: '以显式键或后端生成键暂存已脱离外部引用的记录。'
          },
          params: {
            value: {
              en: 'Application record or byte payload; writes capture it before native mutation.',
              zh: '应用记录或字节载荷，写入会在原生修改前捕获。'
            },
            key: {
              en: 'Application-assigned logical key, or the key returned by the same original backend.',
              zh: '应用指定的逻辑键，或同一原始后端返回的键。'
            },
            options: {
              en: 'Original draft conflict policy, without a separate operation budget.',
              zh: '原草稿冲突策略，不提供独立操作预算。'
            }
          },
          returns: {
            en: 'The accepted logical record key, generated only by the original backend.',
            zh: '返回已接受逻辑记录键，仅原后端负责生成新键。'
          }
        },
        deleteRecord: {
          summary: {
            en: 'Stage deletion of one record identity in this transaction.',
            zh: '在当前事务中暂存单个记录身份的删除。'
          },
          params: {
            key: {
              en: 'Application-assigned logical key, or the key returned by the same original backend.',
              zh: '应用指定的逻辑键，或同一原始后端返回的键。'
            }
          },
          returns: {
            en: 'The original draft accepts deletion without committing early.',
            zh: '原草稿接受删除，不提前提交事务。'
          }
        },
        iterateRecords: {
          summary: {
            en: 'Iterate the bounded native record snapshot merged with current draft changes.',
            zh: '遍历有界原生记录快照，并合并当前草稿修改。'
          },
          params: {
            range: {
              en: 'Optional canonical lower/upper record-key bounds with open-end flags.',
              zh: '可选规范记录键上下界与开区间标记。'
            }
          },
          returns: {
            en: 'Original asynchronous entries; callback expiry and iterator disposal retain their owner.',
            zh: '返回原异步条目，回调过期与迭代释放仍由原拥有者管理。'
          }
        },
        putIndexedRecord: {
          summary: {
            en: 'Stage a record and its declared index projection in the same original draft.',
            zh: '在同一原草稿中暂存记录及其已声明索引投影。'
          },
          params: {
            value: {
              en: 'Application record or byte payload; writes capture it before native mutation.',
              zh: '应用记录或字节载荷，写入会在原生修改前捕获。'
            },
            key: {
              en: 'Application-assigned logical key, or the key returned by the same original backend.',
              zh: '应用指定的逻辑键，或同一原始后端返回的键。'
            },
            handle: {
              en: 'Authentic index handle returned by this same backend and index scope.',
              zh: '同一后端与索引作用域返回的真实索引句柄。'
            },
            projection: {
              en: 'Application-produced index entries matching the handle definitions.',
              zh: '与句柄定义一致、由应用产生的索引条目投影。'
            },
            options: {
              en: 'Original draft conflict policy, without a separate operation budget.',
              zh: '原草稿冲突策略，不提供独立操作预算。'
            }
          },
          returns: {
            en: 'The accepted record key; uniqueness conflicts reject before publication.',
            zh: '返回已接受记录键，唯一性冲突在发布前拒绝。'
          }
        },
        isRecordIndexReady: {
          summary: {
            en: 'Inspect readiness of the same native index scope and generation.',
            zh: '检查同一原生索引作用域与代次是否就绪。'
          },
          params: {
            handle: {
              en: 'Authentic index handle returned by this same backend and index scope.',
              zh: '同一后端与索引作用域返回的真实索引句柄。'
            }
          },
          returns: {
            en: 'True only for the authentic current ready index generation.',
            zh: '仅真实且当前已就绪的索引代次返回真值。'
          }
        },
        iterateRecordIndex: {
          summary: {
            en: 'Iterate an authentic native index range within the original transaction.',
            zh: '在原事务内遍历真实原生索引范围。'
          },
          params: {
            query: {
              en: 'Index handle, index name, bounds, direction and optional limit.',
              zh: '索引句柄、索引名、范围、方向与可选数量上界。'
            }
          },
          returns: {
            en: 'Original ordered key/value entries, including accepted draft changes.',
            zh: '返回原保序键值条目，包含已接受草稿修改。'
          }
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
        },
        dispose: {
          summary: {
            en: 'Release accepted work and original native resources without acquiring any new close authority.',
            zh: '排空已接受工作并释放原生资源，不获取新的关闭权限。'
          },
          params: {},
          returns: {
            en: 'The original cached main cleanup Promise; native cleanup failure rejects with its original reachable cause.',
            zh: '返回原缓存主清理结果，原生清理失败以可追踪的原始原因拒绝。'
          },
          example:
            "import type { ISecondaryIndexRecordStore } from '@migaia/storage-contract'\nexport async function close(store: ISecondaryIndexRecordStore) { await store.dispose() }"
        },
        '[Symbol.asyncDispose]': {
          summary: {
            en: 'Use the original asynchronous resource-disposal protocol after accepted work drains.',
            zh: '在已接受工作排空后使用原异步资源释放协议。'
          },
          params: {},
          returns: {
            en: 'The separately cached symbolic Promise reports cleanup failure and resolves, without replacing the main cleanup Promise.',
            zh: '单独缓存的符号清理报告失败后完成，不替换主清理结果。'
          },
          example:
            "import type { ISecondaryIndexRecordStore } from '@migaia/storage-contract'\nexport async function close(store: ISecondaryIndexRecordStore) { await store.dispose() }"
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
        },
        orgId: {
          summary: {
            en: 'Organization identity supplied by the original host view, never permission to route into another organization.',
            zh: '原宿主视图给出的组织身份，不授予进入其它组织的路由权限。'
          }
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
        },
        fromVersion: {
          summary: {
            en: 'Original archive source version attached to a migration failure.',
            zh: '附加在升级失败上的原存档来源版本号。'
          }
        },
        toVersion: {
          summary: {
            en: 'Attempted target version assigned by the migration plan.',
            zh: '升级计划指定且当前尝试到达的目标版本号。'
          }
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
    },
    IQueryResultOf: {
      summary: t(
        'Infer the complete awaited result of a structural all terminal while preserving row arrays and Feature-dependent output types.',
        '从结构化 all 终点推导完整兑现结果，保留行数组与依赖 Feature 的输出类型。'
      ),
      example:
        "import type { IQueryResultOf, IRecordQuery } from '@migaia/storage-contract'\ntype IRows = IQueryResultOf<IRecordQuery<{ id: string }>>\nconst rows: IRows = [{ id: 'a' }]",
      members: {}
    },
    INumericKeys: {
      summary: {
        en: 'Payload key union whose declared values support the shared numeric aggregate domain.',
        zh: '声明值支持共享数字聚合领域的载荷键名联合。'
      },
      members: {}
    },
    IQueryShape: {
      summary: {
        en: 'Minimal structural all-terminal shape used for query-result inference, without granting execution ownership.',
        zh: '用于查询结果推断的最小结构化全量终点形状，不授予执行拥有权。'
      },
      members: {
        all: {
          summary: {
            en: 'Expose the promised result array shape used by the shared type projection.',
            zh: '公开共享类型投影使用的异步结果数组形状。'
          },
          params: {
            ctx: {
              en: 'Original optional operation context with cancellation and one captured timeout budget.',
              zh: '原可选操作上下文，承载取消信号与单次捕获的超时预算。'
            }
          },
          returns: {
            en: 'The declared result array; native execution remains with the implementing query owner.',
            zh: '返回所声明结果数组，原生执行仍归实现查询的拥有者。'
          }
        }
      }
    },
    IStorageCapabilityApiOf: {
      summary: {
        en: 'Extract the original API type carried by one authentic capability token type.',
        zh: '提取单个真实能力令牌类型承载的原始接口类型。'
      },
      members: {}
    },
    ...storageContractVectorTypes
  },
  enums: (() => {
    /** The three reservation tables share original record names; reservation grants no family API. */
    const reservedQueryValues = {
      where: t(
        'Reserve declarative and client predicate filtering; Feature admission rejects this native name.',
        '保留声明式条件与客户端谓词过滤名称，特性不能覆盖此原生方法。'
      ),
      select: t(
        'Reserve field selection or mapping; the actual query family decides its available projection form.',
        '保留字段选择或映射名称，具体查询族决定可用的投影形式。'
      ),
      all: t(
        'Reserve the terminal collecting current rows; callers await the original reader and cleanup.',
        '保留收集当前结果行的终点名称，调用方等待原读取器与资源清理。'
      ),
      first: t(
        'Reserve the first-result terminal, returning undefined when the query has no match.',
        '保留首条结果终点名称，查询没有匹配项时返回未定义值。'
      ),
      maybe: t(
        'Reserve the explicit Maybe result carrying either an item or the empty branch.',
        '保留显式可选结果终点名称，用判别分支区分结果项与空结果。'
      ),
      firstOrThrow: t(
        'Reserve required-first reading, which rejects an empty result with QUERY_EMPTY_RESULT.',
        '保留必须存在首项的读取名称，空结果以明确的查询空结果错误拒绝。'
      ),
      pluck: t(
        'Reserve the terminal extracting one selected field from each result row.',
        '保留从每条结果行提取一个已选字段的读取终点名称。'
      ),
      exists: t(
        'Reserve existence reduction; the original reader may stop after the first accepted row.',
        '保留存在性归约名称，原读取器可在首条被接受的结果后停止。'
      ),
      count: t(
        'Reserve row counting; this reserved word does not grant statistics to every query family.',
        '保留结果行计数名称，该保留字本身不向所有查询族授予统计能力。'
      ),
      each: t(
        'Reserve sequential callback consumption through the original managed row iterator.',
        '保留通过原有受管结果迭代器依次执行回调的消费名称。'
      ),
      chunk: t(
        'Reserve bounded chunk consumption without inventing a second row-source lifetime.',
        '保留有界分块消费名称，不建立第二份行来源生命周期。'
      ),
      min: t(
        'Reserve the numeric minimum reduction on the family that exposes statistics.',
        '保留数值最小值归约名称，只有公开统计能力的查询族提供该方法。'
      ),
      max: t(
        'Reserve the numeric maximum reduction on the family that exposes statistics.',
        '保留数值最大值归约名称，只有公开统计能力的查询族提供该方法。'
      ),
      sum: t(
        'Reserve numeric summation; actual source support controls native or client execution.',
        '保留数值求和名称，由实际来源能力决定原生或客户端执行。'
      ),
      avg: t(
        'Reserve numeric averaging through the original reduction owner.',
        '保留数值平均值名称，计算仍由原有归约拥有者完成。'
      ),
      explain: t(
        'Reserve pure plan inspection without opening a native data source.',
        '保留纯查询计划检查名称，检查时不打开原生数据来源。'
      ),
      requirePushdown: t(
        'Reserve strict native execution selection; unsupported client steps reject before I/O.',
        '保留严格原生执行选择名称，不支持的客户端步骤在读写前拒绝。'
      ),
      stream: t(
        'Reserve the original storage iterator terminal with its existing cleanup ownership.',
        '保留原存储迭代器终点名称，继续使用已有资源清理拥有者。'
      ),
      limit: t(
        'Reserve a finite result bound that remains part of the immutable query descriptor.',
        '保留有限结果上限名称，该上限属于不可变查询描述的一部分。'
      ),
      orderByComparator: t(
        'Reserve comparator ordering, executable only with the required finite result bound.',
        '保留比较器排序名称，只有具备要求的有限结果上限时才能执行。'
      ),
      orderBy: t(
        'Reserve selector ordering by canonical storage keys rather than arbitrary comparison sorting.',
        '保留按规范存储键选择器排序的名称，不改为任意比较排序。'
      ),
      distinct: t(
        'Reserve canonical field-value deduplication through the original query reader.',
        '保留规范字段值去重名称，由原查询读取器执行去重。'
      ),
      skip: t(
        'Reserve offset skipping within the existing ordered query operation sequence.',
        '保留偏移跳过名称，其位置仍属于原有有序查询操作序列。'
      ),
      after: t(
        'Reserve keyset continuation from an opaque cursor bound to the original query source.',
        '保留键集继续读取名称，使用绑定原查询来源的不透明游标。'
      ),
      page: t(
        'Reserve bounded keyset pages and their original continuation cursor.',
        '保留有界键集分页名称，并返回原查询拥有者产生的继续读取游标。'
      ),
      delete: t(
        'Reserve selected-row deletion through the actual backend mutation owner.',
        '保留选中行删除名称，必须通过真实后端修改拥有者执行。'
      ),
      update: t(
        'Reserve record updates through the original writer; this does not add vector update semantics.',
        '保留原记录写入器的更新名称，本表不额外声明向量更新语义。'
      ),
      watch: t(
        'Reserve native invalidation watching only when the actual source exposes change-feed support.',
        '保留原生失效观察名称，只有实际来源提供变更流支持时才可调用。'
      )
    }
    return {
      RecordQueryMethod: {
        summary: t(
          'Native record method names reserved before Feature admission; this table cannot be used to override original methods.',
          '原生记录方法在特性准入之前保留这些名称，不能借此覆盖原方法或创建第二查询拥有者。'
        ),
        values: reservedQueryValues
      },
      VectorQueryMethod: {
        summary: t(
          'Vector collision vocabulary includes record names for admission safety; only the actual vector query type grants callable methods.',
          '向量冲突词汇为准入安全保留记录名称，实际可调用方法仍以原向量查询类型为准。'
        ),
        values: {
          ...reservedQueryValues,
          topK: t(
            'Reserve the required finite vector ranking bound.',
            '保留向量排名必须提供的有限结果数量上限名称。'
          ),
          minScore: t(
            'Reserve filtering by the native vector score threshold.',
            '保留按原生向量分数门槛排除命中的方法名称。'
          ),
          withVector: t(
            'Reserve explicit vector inclusion in returned hits.',
            '保留明确要求在返回命中中包含向量数据的方法名称。'
          ),
          rerank: t(
            'Reserve the portable client scorer available only after topK; its result is read-only and retains original engine scores.',
            '保留仅在 topK 后提供的可移植客户端评分方法，其结果为只读并保留原引擎分数。'
          ),
          groupBy: t(
            'Reserve grouping only where native vector grouping is supported.',
            '保留分组名称，仅在原生向量来源确实支持分组时使用。'
          )
        }
      },
      RdfQueryMethod: {
        summary: t(
          'RDF collision vocabulary shares original read reservations and adds ground traversal and replacement names.',
          '资源描述查询复用原有读取保留名称，并额外保留已确定关系遍历与替换的方法名称。'
        ),
        values: {
          ...reservedQueryValues,
          follow: t(
            'Reserve forward traversal over a ground named predicate.',
            '保留沿已确定命名谓词进行正向关系遍历的方法名称。'
          ),
          inverse: t(
            'Reserve reverse traversal over a ground named predicate.',
            '保留沿已确定命名谓词进行反向关系遍历的方法名称。'
          ),
          replace: t(
            'Reserve exact selected-quad replacement through the original mutation owner.',
            '保留通过原修改拥有者精确替换已选中四元组的方法名称。'
          )
        }
      },
      TransactionBuilderMethod: {
        summary: t(
          'Reserved fluent transaction names preserve the original immutable builder and backend scope owner.',
          '事务链保留名称维护原不可变构造器与后端作用域拥有者，特性不能覆盖这些基础方法。'
        ),
        values: {
          lock: t(
            'Declare canonical lock keys before running a pessimistic transaction.',
            '在执行悲观事务之前声明规范锁键，保留原键快照顺序。'
          ),
          concurrency: t(
            'Select an authentic policy without creating another retry loop.',
            '选择真实策略对象，不为该事务建立另一份重试循环。'
          ),
          signal: t(
            'Capture the caller cancellation signal in a new immutable builder.',
            '在新的不可变事务构造器中捕获调用方取消信号。'
          ),
          timeout: t(
            'Set the original operation budget without adding a separate timeout owner.',
            '设置原有操作预算，不增加独立的超时或取消拥有者。'
          ),
          run: t(
            'Execute once through the backend original transaction and terminal lifecycle.',
            '通过后端原有事务与终态生命周期执行调用方工作。'
          )
        }
      },
      RdfTermType: {
        summary: t(
          'Canonical RDF term tags are shared by snapshots, query bindings and native protocol adapters.',
          '规范资源描述词项标签由快照、查询绑定与原生协议适配器共同使用，不另建标签编码。'
        ),
        values: {
          namedNode: t(
            'An absolute IRI node whose exact spelling is retained.',
            '绝对资源标识节点，规范快照保留输入的精确字符拼写。'
          ),
          blankNode: t(
            'A parser-local blank identifier, not a portable repeated-identity mutation key.',
            '解析器局部的空白标识，不能作为可移植重复身份的写入键。'
          ),
          literal: t(
            'A lexical value with datatype and an optional normalized language.',
            '具有数据类型及可选规范化语言标签的字面文本值。'
          ),
          defaultGraph: t(
            'The default graph identity, with no fabricated IRI or binding value.',
            '表示缺省图身份，不伪造资源标识或查询绑定值。'
          )
        }
      },
      RdfDatatype: {
        summary: t(
          'RDF string datatype IRIs are canonical shared values for plain and language-tagged literal snapshots.',
          '普通字符串与带语言标签字面值的规范数据类型标识，由同一词项快照实现共享。'
        ),
        values: {
          string: t(
            'The XML Schema string datatype for an ordinary literal without a language tag.',
            '普通不带语言标签的字面值采用标准模式字符串数据类型。'
          ),
          langString: t(
            'The RDF language-string datatype used with a normalized language tag.',
            '带有规范化语言标签的字面值采用标准资源描述语言字符串类型。'
          )
        }
      },
      DeleteCountMode: {
        summary: t(
          'Delete-count strategy is explicit: precount estimates before deletion, while scroll counts collected unique IDs.',
          '删除计数策略必须明确选择，预先计数与逐页收集身份计数具有不同的并发边界。'
        ),
        values: {
          precount: t(
            'Count matches before native deletion; concurrent changes may make it differ from actual deleted IDs.',
            '原生删除前先计数匹配项，并发变化可能导致它与实际删除身份数量不同。'
          ),
          scroll: t(
            'Collect unique IDs actually read across pages, delete that finite set and report its size; no cross-page snapshot is promised.',
            '收集分页实际读到的去重身份，只删除并报告该有限集合，不承诺跨页快照。'
          )
        }
      },
      QueryOperation: {
        summary: t(
          'Canonical planner vocabulary records ordered native or client work; each source declares its supported subset.',
          '规范查询规划词汇记录有序的原生或客户端工作，每个来源只声明自己实际支持的子集。'
        ),
        values: {
          where: t(
            'Apply a canonical declarative condition within the ordered native prefix.',
            '在有序原生前缀中应用规范声明式条件，不重新解释用户谓词。'
          ),
          predicate: t(
            'Execute a JavaScript predicate on the client after its required native prefix.',
            '在所需原生前缀之后，由客户端执行调用方提供的函数谓词。'
          ),
          select: t(
            "Project selected fields while retaining each family's original row identity.",
            '投影选定字段，同时保留各查询族原有的结果行身份。'
          ),
          mapper: t(
            'Execute a client mapping callback without claiming native pushdown.',
            '由客户端执行映射回调，不声称该回调能够下推为原生请求。'
          ),
          order: t(
            'Order by the canonical encoded storage-key selector.',
            '按规范编码后的存储键选择器顺序排列当前结果行。'
          ),
          comparator: t(
            'Use comparator ordering only with the required finite limit.',
            '只有提供所要求的有限结果上限时，才能采用比较器排序。'
          ),
          skip: t(
            'Skip the requested count at this exact point of the query descriptor.',
            '在查询描述的当前精确位置跳过调用方要求的结果数量。'
          ),
          after: t(
            'Seek beyond a compatible opaque keyset anchor.',
            '从兼容的不透明键集锚点之后继续读取当前查询结果。'
          ),
          limit: t(
            'Bound the results at this point without reordering earlier operations.',
            '限制当前位置的结果数量，不重新排列此前已经声明的操作。'
          ),
          distinct: t(
            'Deduplicate the selected field using canonical value identity.',
            '按照规范值身份，对选定字段执行结果去重。'
          ),
          count: t(
            'Reduce accepted rows to their count through a declared native or client path.',
            '沿已声明的原生或客户端路径，将被接受的结果行归约为数量。'
          ),
          exists: t(
            'Determine whether an accepted row exists and close the original source.',
            '判断是否存在被接受的结果行，并关闭原有结果来源。'
          ),
          aggregate: t(
            'Execute supported numeric aggregation through the original reader or reducer.',
            '通过原读取器或归约器执行已支持的数值聚合操作。'
          ),
          topK: t(
            'Keep the bounded highest-ranked vector results using the declared metric.',
            '按照已声明的度量保留有限数量且排名最靠前的向量结果。'
          ),
          minScore: t(
            'Reject ranked vector hits below the selected score threshold.',
            '排除相似度分数低于所选门槛的已排名向量结果。'
          ),
          rerank: t(
            'Score the actual bounded vector hits on the client, then keep stable descending rerankScore order and the selected topN.',
            '在客户端为实际有界向量命中评分，再按 rerankScore 稳定降序保留所选 topN。'
          ),
          follow: t(
            'Follow a ground RDF predicate from the current forward relation.',
            '从当前正向关系沿已确定的资源描述谓词继续遍历。'
          ),
          inverse: t(
            'Traverse the inverse ground RDF predicate relation.',
            '沿已确定的资源描述谓词关系执行反向遍历。'
          ),
          groupBy: t(
            'Group bounded ranked hits only when the actual vector family supports grouping.',
            '仅在实际向量查询族支持分组时，对有界排名结果执行分组。'
          )
        }
      },
      QueryOperator: {
        summary: t(
          'Canonical declarative predicates preserve value domains and compile through one shared condition owner.',
          '规范声明式谓词保留原值域，并通过同一个共享条件拥有者完成编译与执行。'
        ),
        values: {
          eq: t(
            'Compare in the same domain using SameValueZero and Date timestamps.',
            '只在相同值域比较，普通值采用同值零语义，日期采用时间戳。'
          ),
          ne: t(
            'Negate same-domain equality without coercing values.',
            '对相同值域的相等判断取反，不隐式转换被比较的值。'
          ),
          in: t(
            'Test membership using a once-compiled canonical set of candidates.',
            '使用只编译一次的规范候选集合检查成员身份。'
          ),
          exists: t(
            'Test property presence independently of its stored undefined value.',
            '独立于属性是否保存未定义值，判断该属性本身是否存在。'
          ),
          gt: t(
            'Compare against an exclusive lower bound in the same ordered domain.',
            '在相同有序值域内与开区间下界比较，要求严格大于边界。'
          ),
          gte: t(
            'Compare against an inclusive lower bound in the same ordered domain.',
            '在相同有序值域内与闭区间下界比较，允许等于边界。'
          ),
          lt: t(
            'Compare against an exclusive upper bound in the same ordered domain.',
            '在相同有序值域内与开区间上界比较，要求严格小于边界。'
          ),
          lte: t(
            'Compare against an inclusive upper bound in the same ordered domain.',
            '在相同有序值域内与闭区间上界比较，允许等于边界。'
          ),
          between: t(
            'Accept values within both inclusive same-domain bounds.',
            '只接受同时位于相同值域两个闭区间边界之内的值。'
          ),
          startsWith: t(
            'Match a string prefix without converting other value types to text.',
            '匹配字符串前缀，不把其它类型的值隐式转换为文本。'
          ),
          contains: t(
            'Match a string substring without converting other domains.',
            '匹配字符串内部的子串，不隐式转换其它值域。'
          ),
          has: t(
            'Test array element equality within the supported canonical value domain.',
            '在受支持的规范值域内检查数组是否含有相等元素。'
          )
        }
      },
      TransactionActivityMode: {
        summary: t(
          'Backend owners declare the original transaction activity window; this fact grants no commit or resource authority.',
          '后端拥有者声明原事务活跃窗口，这一事实不授予提交权限或独立资源所有权。'
        ),
        values: {
          managed: t(
            'The backend maintains activity until its original transaction lifetime ends.',
            '由后端维护活跃状态，直到其原有事务生命周期实际结束。'
          ),
          native: t(
            'Every request remains subject to the platform native transaction activity window.',
            '每一次请求都继续受到平台原生事务活跃窗口的约束。'
          )
        }
      },
      TransactionBeforeStage: {
        summary: t(
          'Before-stage observers are report-only boundaries; only the original backend performs writes and commit.',
          '事务前置观察均为只报告边界，实际写入与提交仍只能由原后端拥有者执行。'
        ),
        values: {
          beforeTransaction: t(
            'Observe before original transaction creation, without controlling its outcome.',
            '在原事务创建之前进行观察，不借此控制事务执行结局。'
          ),
          beforeTxOperation: t(
            'Observe before one already-admitted operation on an authentic transaction view.',
            '在真实事务视图上已经接纳的一次操作之前进行观察。'
          ),
          beforeCommit: t(
            'Observe the original final-check view before native commit; observation cannot commit or veto.',
            '在原生提交之前观察最后检查视图，观察本身不能提交或否决。'
          ),
          beforePersistFlush: t(
            'Observe before this original transactional persistence flush begins.',
            '在本次原有事务持久化刷新开始之前进行观察。'
          )
        }
      },
      TransactionObservedStage: {
        summary: t(
          'Completed observations use captured original identity and never reopen a closed transaction scope.',
          '已完成观察使用捕获的原事务身份，不能重新打开已关闭的事务作用域。'
        ),
        values: {
          onTransactionStart: t(
            'Observe after the original transaction has been registered successfully.',
            '原有事务成功登记之后观察其已捕获身份与状态。'
          ),
          afterTxOperation: t(
            'Observe after one actual transaction operation settles.',
            '一次真实事务操作完成结算之后进行只报告观察。'
          ),
          afterCommit: t(
            'Observe only after the original native owner confirms commit completion.',
            '只有原生拥有者确认提交完成之后，才观察已提交结果。'
          ),
          afterRollback: t(
            'Observe after original native rollback completes without changing the primary failure.',
            '原生回滚完成之后进行观察，不替换原始主要失败。'
          ),
          onTransactionClose: t(
            'Observe after the original transaction lifetime has closed.',
            '在原事务生命周期已经关闭之后观察终态，不恢复操作准入。'
          ),
          afterPersistFlush: t(
            'Observe encoding and native request completion, which alone does not certify commit.',
            '观察编码与原生请求完成，仅该阶段本身不能证明事务已经提交。'
          )
        }
      },
      ConcurrencyHolderState: {
        summary: t(
          'Holder observations distinguish an actual owner from the handoff interval without inventing another lock authority.',
          '锁持有者观察区分真实拥有者与交接区间，不另建锁权限或生命周期拥有者。'
        ),
        values: {
          held: t(
            'A real local or remote owner currently holds the original lock.',
            '当前确有一个本地或远端拥有者持有该原始锁。'
          ),
          handingOff: t(
            'Remote transfer is in progress and intentionally exposes no owner identity.',
            '远端交接正在进行，观察记录刻意不提供拥有者身份。'
          )
        }
      },
      StorageStageKind: {
        summary: t(
          'Canonical observer family names choose diagnostics only and do not grant backend, data or lifecycle authority.',
          '规范观察家族名称只选择诊断类别，不授予后端、数据或生命周期管理权限。'
        ),
        values: {
          codec: t(
            'Observe the original value encoding and decoding boundaries.',
            '观察原有值编码与解码边界，不执行额外的数据转换。'
          ),
          query: t(
            'Observe query plans, pushdown choices and actual result counts.',
            '观察查询计划、下推选择与实际结果数量，不重跑查询。'
          ),
          transaction: t(
            'Observe the original transaction lifetime and admitted operations.',
            '观察原事务生命周期及已准入操作，不代替提交或回滚。'
          ),
          backend: t(
            'Observe original backend construction, admission and cleanup.',
            '观察原后端构造、准入与清理，不取得后端关闭权限。'
          ),
          sql: t(
            'Observe the actual native SQL statement execution counts.',
            '观察实际原生语句执行数量，不新增原生请求或诊断查询。'
          ),
          operation: t(
            'Observe ordinary storage operation entry and settlement.',
            '观察普通存储操作的进入与结算，不改变其输入或结果。'
          ),
          concurrency: t(
            'Observe original lock admission and concurrency policy decisions.',
            '观察原锁准入与并发策略决策，不建立另一份锁或重试循环。'
          )
        }
      },
      ConflictPolicy: {
        summary: t(
          'Existing-key outcomes are shared by asynchronous, synchronous and authentic transaction write options.',
          '异步、同步与真实事务写入选项共用已有键处理方式，不维护第二套冲突规则。'
        ),
        values: conflictValues
      },
      StorageContractErrorCode: {
        summary: t(
          'Stable contract failure codes covering invalid inputs, keys, capability absence, disposal and cancellation.',
          '涵盖无效输入、键、能力缺失、释放和取消的稳定契约失败码。'
        ),
        values: {
          rerankFailed: t(
            'The application scorer threw or rejected; inspect the original error on cause without treating it as a native engine failure.',
            '应用评分器抛错或拒绝，应检查 cause 上的原始错误，不将其误归为原生引擎失败。'
          ),
          rerankResultInvalid: t(
            'The scorer result is not a dense array containing one finite numeric score for every candidate; correct the scorer output.',
            '评分结果不是为每个候选提供一个有限数字的稠密数组，应修正评分器输出。'
          ),
          queryEmptyResult: t(
            'A required-first terminal exhausted its original query; choose first or maybe when absence is expected.',
            '必须存在首项的终点耗尽了原查询；允许缺失时应改用首项或显式可选终点。'
          ),
          changeCursorExpired: t(
            'A durable replay cursor was evicted; invalidate the full cache and subscribe from the current position.',
            '持久重放游标已被淘汰，应让完整缓存失效并从当前进度重新订阅。'
          ),
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
          envelopeInvalid: t(
            'Archive envelope shape is invalid.',
            '保存的数据不是自有版本与状态字段构成的合法存档结构。'
          ),
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
      },
      ...storageContractVectorEnums
    }
  })(),
  enhancers: {}
}
