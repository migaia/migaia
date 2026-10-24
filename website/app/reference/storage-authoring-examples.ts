import type { ISymbolDoc, IText } from './contract.js'
import { storageContractCases } from './storage-contract-cases.js'
import { storageContractReference } from './storage-contract.js'
import { storageHostAuthoringTypes } from './storage-host-authoring.js'

/** Give each memory example its own installed backend and guaranteed host cleanup. */
function memoryExample(imports: string, body: string): string {
  return `import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
${imports}

const host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
try {
  const store = host.backend('memory')
  ${body.replaceAll('\n', '\n  ')}
} finally {
  await host.dispose()
}`
}

/** Both error helpers preserve an already classified error and retain a native cause on wrapping. */
const errorFamilyExample = `import { StorageError, StorageErrorCode } from '@migaia/storage-host'
import { isStorageErrorFamily, normalizeError } from '@migaia/storage-host/authoring/backend'

const cause = new TypeError('driver rejected the value')
const createFailure = (error: unknown) => new StorageError(
  StorageErrorCode.extensionFailed,
  { operation: 'load-profile', cause: error }
)
const failure = normalizeError(cause, createFailure)
console.log(isStorageErrorFamily(failure), failure.cause === cause)
console.log(normalizeError(failure, createFailure) === failure)`

/** Real authoring examples use current public entries and borrow the existing native owners. */
export const storageAuthoringExamples: Readonly<Record<string, string | IText>> = {
  'storage-host:index:defineStorageBackendKind': `import { defineStorageBackendKind } from '@migaia/storage-host'
import type { IStorageBase } from '@migaia/storage-contract'

type IInvoiceBackend = IStorageBase & { total(): Promise<number> }
const invoiceKind = defineStorageBackendKind<IInvoiceBackend>()('invoices')
console.log(invoiceKind.name)`,
  'storage-host:authoring/backend:createStorageOperationReporter': `import {
  createStorageOperationReporter, reportCleanupError
} from '@migaia/storage-host/authoring/backend'

export async function closeNativeCursor(close: () => Promise<void>): Promise<void> {
  const reporter = createStorageOperationReporter()
  try {
    await close()
  } catch (error) {
    reportCleanupError(reporter, error)
  }
}`,
  'storage-host:authoring/backend:createStorageOperationRuntime': `import {
  createStorageOperationRuntime, reportCleanupError
} from '@migaia/storage-host/authoring/backend'

export async function releaseNativeReader(close: () => Promise<void>): Promise<void> {
  const runtime = createStorageOperationRuntime()
  try {
    await close()
  } catch (error) {
    reportCleanupError(runtime.reporter, error)
  }
}`,
  'storage-host:authoring/backend:isStorageErrorFamily': errorFamilyExample,
  'storage-host:authoring/backend:normalizeError': errorFamilyExample,
  'storage-host:authoring/backend:planChannelWrite':
    storageHostAuthoringTypes.IChannelMutationPlan.example!,
  'storage-host:authoring/backend:reportCleanupError': `import { reportCleanupError } from '@migaia/storage-host/authoring/backend'

const failures: unknown[] = []
const closeFailure = new TypeError('native cursor close failed')
reportCleanupError(error => { failures.push(error) }, closeFailure)
console.log(failures.length, failures[0] === closeFailure)`,
  'storage-host:authoring/backend:storageJournalLockKey': `import {
  StorageJournalLock, storageJournalLockKey
} from '@migaia/storage-host/authoring/backend'

const resource = storageJournalLockKey('orders-log', StorageJournalLock.resource)
const head = storageJournalLockKey('orders-log', StorageJournalLock.head)
console.log(resource.channel, head.channel)
console.log(JSON.stringify(resource) !== JSON.stringify(head))`,
  'storage-host:authoring/capability:provideCapabilities':
    storageContractCases.installerAuthor![0]!.example,
  'storage-host:authoring/capability:readTransactionImplementation': `import { rdf, type IStorageBase, type ITransactionScope } from '@migaia/storage-contract'
import { readTransactionImplementation } from '@migaia/storage-host/authoring/capability'
import { assertTransactionOwner } from '@migaia/storage-host/authoring/transaction'

export function nativeRdfTransaction(store: IStorageBase, scope: ITransactionScope) {
  assertTransactionOwner(store, scope)
  const binding = readTransactionImplementation(store, rdf)
  return binding.forTransaction(scope)
}`,
  'storage-host:authoring/concurrency:associateNormalizedLockKeys': memoryExample(
    `import type { ITransactionOptions } from '@migaia/storage-contract'
import { associateNormalizedLockKeys, lockKey, normalizeLockKeys } from '@migaia/storage-host/authoring/concurrency'`,
    `const locks = normalizeLockKeys([lockKey.text('inventory')], store.backend)
const options: ITransactionOptions = { lock: locks.map(entry => entry.key) }
associateNormalizedLockKeys(options, locks)
await store.transaction(async tx => {
  await tx.set('inventory', '12')
}, options)
console.log(await store.get('inventory'))`
  ),
  'storage-host:authoring/concurrency:normalizeLockKeys': `import { lockKey, normalizeLockKeys } from '@migaia/storage-host/authoring/concurrency'

const locks = normalizeLockKeys([
  lockKey.text('orders'),
  lockKey.record(['users', 1]),
  lockKey.record(['users', 1])
], 'memory')
console.log(locks.length)
console.log(locks.map(entry => entry.key.channel))`,
  'storage-host:authoring/concurrency:snapshotLockKey': `import { snapshotLockKey } from '@migaia/storage-host/authoring/concurrency'

const key = ['users', 1]
const captured = snapshotLockKey({ channel: 'record', key }, 'memory')
key[1] = 2
console.log(captured)`,
  'storage-host:authoring/key:createStorageBatchKeyProjection': `import { createStorageBatchKeyProjection } from '@migaia/storage-host/authoring/key'

const project = createStorageBatchKeyProjection('memory')
const entries = [project(['users', 1]), project(['users', 2]), project(['users', 1])]
console.log(entries.map(entry => entry.firstIndex))`,
  'storage-host:authoring/key:projectStorageBatchKeys': `import { projectStorageBatchKeys } from '@migaia/storage-host/authoring/key'

const entries = projectStorageBatchKeys([['users', 1], ['users', 2], ['users', 1]], 'memory')
console.log(entries.map(entry => entry.firstIndex))`,
  'storage-host:authoring/key:sortStorageByteIdentities': `import {
  encodeOrderedStorageKey, sortStorageByteIdentities
} from '@migaia/storage-host/authoring/key'

const entries = [
  { encoded: encodeOrderedStorageKey('z', 'memory'), name: 'last' },
  { encoded: encodeOrderedStorageKey('a', 'memory'), name: 'first' }
]
sortStorageByteIdentities(entries)
console.log(entries.map(entry => entry.name))`,
  'storage-host:authoring/key:storageKeyBytesIdentity': `import {
  encodeOrderedStorageKey, storageKeyBytesIdentity
} from '@migaia/storage-host/authoring/key'

const first = encodeOrderedStorageKey(['users', 1], 'memory')
const second = encodeOrderedStorageKey(['users', 1], 'memory')
console.log(storageKeyBytesIdentity(first) === storageKeyBytesIdentity(second))`,
  'storage-host:authoring/rdf:encodeRdfQuadSnapshot': `import {
  encodeRdfQuadSnapshot, snapshotStorageRdfQuad, term
} from '@migaia/storage-host/authoring/rdf'

const quad = snapshotStorageRdfQuad({
  subject: term.iri('urn:example:user:1'),
  predicate: term.iri('urn:example:name'),
  object: term.literal('Ada'),
  graph: term.defaultGraph
}, undefined)
console.log(encodeRdfQuadSnapshot(quad).byteLength > 0)`,
  'storage-host:authoring/transaction:assertTransactionOwner':
    storageContractCases.capabilityAuthor![0]!.example,
  'storage-host:authoring/transaction:createTransactionOwner':
    storageContractCases.ownerAuthor![0]!.example,
  'storage-host:authoring/transaction:deriveTransactionIterator': `import type { IStorageIterator } from '@migaia/storage-contract'
import { deriveTransactionIterator } from '@migaia/storage-host/authoring/transaction'

export function projectNames(source: IStorageIterator<{ name: string }>) {
  return deriveTransactionIterator(source, async next => {
    const item = await next()
    return item.done
      ? { done: true, value: undefined }
      : { done: false, value: item.value.name }
  })
}`,
  'storage-host:authoring/transaction:nextTransactionIterator': memoryExample(
    `import { nextTransactionIterator, runTransactionOperation } from '@migaia/storage-host/authoring/transaction'`,
    `await store.putRecord({ name: 'Ada' }, 'user:1')
await store.transaction(async tx => {
  await using cursor = tx.iterateRecords()
  const item = await runTransactionOperation(tx, current => nextTransactionIterator(current, cursor))
  console.log(item.done, item.value)
})`
  ),
  'storage-host:authoring/transaction:readTransactionConcurrency': memoryExample(
    `import { readTransactionConcurrency } from '@migaia/storage-host/authoring/transaction'`,
    `const configuration = readTransactionConcurrency(store)
console.log(configuration.backend, configuration.stages)`
  ),
  'storage-host:authoring/transaction:readTransactionOperationContext': memoryExample(
    `import { readTransactionOperationContext } from '@migaia/storage-host/authoring/transaction'`,
    `const controller = new AbortController()
await store.transaction(async tx => {
  const context = readTransactionOperationContext(tx)
  console.log(context?.signal === controller.signal)
  await tx.set('theme', 'dark')
}, { signal: controller.signal })`
  ),
  'storage-host:authoring/transaction:registerTransactionFinalizer': memoryExample(
    `import { registerTransactionFinalizer } from '@migaia/storage-host/authoring/transaction'`,
    `await store.transaction(async tx => {
  registerTransactionFinalizer(tx, async current => {
    console.log(await current.get('status'))
  })
  await tx.set('status', 'ready')
})`
  ),
  'storage-host:authoring/transaction:resolveConcurrencyPolicy': memoryExample(
    `import { ConcurrencyPolicy } from '@migaia/storage-host/authoring/concurrency'
import { resolveConcurrencyPolicy } from '@migaia/storage-host/authoring/transaction'`,
    `const override = ConcurrencyPolicy.fail()
console.log(resolveConcurrencyPolicy(store, override) === override)
console.log(resolveConcurrencyPolicy(store).name)`
  ),
  'storage-host:authoring/transaction:runTransactionIteratorOperation': memoryExample(
    `import { runTransactionIteratorOperation } from '@migaia/storage-host/authoring/transaction'`,
    `await store.putRecord({ name: 'Ada' }, 'user:1')
await store.transaction(async tx => {
  await using cursor = tx.iterateRecords()
  const first = await runTransactionIteratorOperation(cursor, async next => {
    const item = await next()
    return item.done ? undefined : item.value
  })
  console.log(first)
})`
  )
}

/** Keep authored contract prose bilingual while sharing identical executable examples. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** New runtime helpers have one authored contract; migrated contracts retain their existing owner. */
export const storageAuthoringSymbols: Readonly<Record<string, ISymbolDoc>> = {
  readTransactionImplementation: {
    role: 'operation',
    purpose: t(
      'Read the installed capability definition and its transaction binder from the original store. The binder selects the backend’s real transaction API; it does not create a transaction or turn an arbitrary object into a valid scope. Missing capabilities and definitions without transaction support reject.',
      '从原存储读取已安装能力的定义及事务绑定函数。绑定函数选择后端真实的事务接口，不创建事务，也不会把普通对象变成有效事务视图；缺少能力或没有事务支持时拒绝。'
    ),
    params: {
      store: t('Original store on which the capability was published.', '已发布该能力的原存储。'),
      capability: t(
        'Authentic capability token whose transaction API is required.',
        '需要取得事务接口的真实能力标记。'
      )
    },
    returns: t(
      'The original implementation record with forTransaction(scope). Pass only a live scope belonging to this store; the backend binder keeps its own native transaction checks.',
      '返回含 forTransaction(scope) 的原实现记录。只传入属于该存储的活跃视图，后端绑定函数仍负责原生事务检查。'
    ),
    example:
      storageAuthoringExamples['storage-host:authoring/capability:readTransactionImplementation']
  },
  associateNormalizedLockKeys: {
    role: 'operation',
    purpose: t(
      'Attach already normalized lock metadata to the exact options object a transaction builder will submit. The native concurrency loop can reuse these byte identities instead of snapshotting and encoding the same locks again. This records metadata only; it acquires no lock and grants no transaction authority.',
      '把已规范化的锁资料关联到事务构建器即将提交的同一个选项对象。原并发流程可复用这些字节身份，不必再次复制和编码同一组锁。此调用只登记资料，不取得锁或事务权限。'
    ),
    params: {
      options: t(
        'The original options object passed unchanged to the real transaction.',
        '随后原样传给真实事务的选项对象。'
      ),
      locks: t(
        'The sorted, deduplicated entries returned by normalizeLockKeys.',
        'normalizeLockKeys 返回的已排序、去重条目。'
      )
    },
    optionDocs: {
      ...storageContractReference.types!.IOperationContext!.members,
      ...storageContractReference.types!.ITransactionOptions!.members
    },
    returns: t(
      'Nothing. The association is retained for this options identity; copying the object does not copy the association.',
      '无返回值。关联只属于该选项对象的身份，复制对象不会复制此关联。'
    ),
    example:
      storageAuthoringExamples['storage-host:authoring/concurrency:associateNormalizedLockKeys']
  },
  normalizeLockKeys: {
    role: 'operation',
    purpose: t(
      'Validate and capture a transaction’s lock list, encode each channel-specific identity once, then sort and deduplicate by its canonical bytes. Use this before queued acquisition so caller mutations cannot change the requested locks. Invalid lock descriptions reject before native work.',
      '校验并保存事务的锁列表，每个通道身份只编码一次，再按规范字节排序和去重。在排队取得锁之前使用，防止调用方修改输入后改变实际请求的锁；无效描述在原生工作前拒绝。'
    ),
    params: {
      keys: t(
        'Array of text, bytes, record, vector or RDF lock descriptions.',
        '文本、字节、记录、向量或 RDF 锁描述组成的数组。'
      ),
      backend: t(
        'Backend name used when reporting invalid input.',
        '报告无效输入时使用的后端名称。'
      )
    },
    returns: t(
      'Ordered entries containing the captured key and its encoded identity. Equivalent lock values appear once even when their input objects differ.',
      '返回有序条目，每项包含捕获的 key 与编码身份。即使输入对象不同，等价锁值也只保留一次。'
    ),
    example: storageAuthoringExamples['storage-host:authoring/concurrency:normalizeLockKeys']
  },
  snapshotLockKey: {
    role: 'operation',
    purpose: t(
      'Validate one supported lock description and detach its mutable key data before a queued acquisition or retry. This preserves the selected channel and identity without acquiring a native lock. Use the public lockKey factories when constructing a new description.',
      '校验一个受支持的锁描述，在排队取得锁或重试前分离其中可变的键数据。保留所选通道及身份，不实际取得原生锁；新建描述时可直接使用公开 lockKey 工厂。'
    ),
    params: {
      value: t('One channel-specific lock description.', '一个按通道定义的锁描述。'),
      backend: t(
        'Backend name for errors, or undefined before a backend is selected.',
        '错误中的后端名称；尚未选择后端时传 undefined。'
      )
    },
    returns: t(
      'An independent valid lock description. Invalid channels, keys or RDF terms reject synchronously.',
      '返回独立的有效锁描述；无效通道、键或 RDF 项同步拒绝。'
    ),
    example: storageAuthoringExamples['storage-host:authoring/concurrency:snapshotLockKey']
  },
  createStorageBatchKeyProjection: {
    role: 'operation',
    purpose: t(
      'Create one synchronous batch projector that tracks the first position of each equivalent key. It validates keys and borrows their existing values instead of copying them. Use it only in a native terminal with no intervening await; use createStorageBatchKeyCapture when work can be deferred.',
      '为一次同步批处理创建投影函数，记录每个等价键首次出现的位置。它校验键并借用原值，不复制键；只在没有中途 await 的原生执行末端使用，工作可能延后时改用 createStorageBatchKeyCapture。'
    ),
    params: {
      backend: t(
        'Backend name for validation errors, or undefined for a neutral helper.',
        '校验错误中的后端名称；中立辅助流程可传 undefined。'
      )
    },
    returns: t(
      'A per-batch function returning key, encoded identity and firstIndex for each call. Reuse it within one batch only; invalid keys reject without consuming a position.',
      '返回一次批处理专用的函数，每次调用给出 key、编码身份及 firstIndex。只在同一批次复用；无效键拒绝且不占用位置。'
    ),
    example: storageAuthoringExamples['storage-host:authoring/key:createStorageBatchKeyProjection']
  },
  projectStorageBatchKeys: {
    role: 'operation',
    purpose: t(
      'Recompute equality and first-position metadata for an entire synchronous batch after middleware may have changed its keys. Input order and repeated positions are preserved. The original key values remain borrowed, so this is not the snapshot boundary for work that will await.',
      '在中间件可能修改键后，为整个同步批次重新计算等价关系及首次位置。保留输入顺序和重复位置，继续借用原键值；它不是随后需要 await 的工作的快照边界。'
    ),
    params: {
      keys: t(
        'Validated storage-key domain values in native request order.',
        '按原生请求顺序提供的存储键域值。'
      ),
      backend: t(
        'Backend name for validation errors, or undefined.',
        '校验错误中的后端名称，也可为 undefined。'
      )
    },
    optionDocs: {
      rejectDuplicates: {
        summary: t(
          'Reject the complete input if two positions represent the same key.',
          '若两个位置表示同一个键，则拒绝整批输入。'
        ),
        default: t(
          'false: retain repeated positions and their common firstIndex.',
          'false：保留重复位置，并记录其共同的 firstIndex。'
        ),
        whenToUse: t(
          'Select true for a batch whose write contract forbids duplicate target keys.',
          '批量写入契约禁止重复目标键时设为 true。'
        ),
        example: storageAuthoringExamples['storage-host:authoring/key:projectStorageBatchKeys']
      }
    },
    returns: t(
      'One metadata entry per input position. Invalid keys or forbidden duplicates reject before native execution.',
      '每个输入位置返回一个资料条目；无效键或被禁止的重复项在原生执行前拒绝。'
    ),
    example: storageAuthoringExamples['storage-host:authoring/key:projectStorageBatchKeys']
  },
  sortStorageByteIdentities: {
    role: 'operation',
    purpose: t(
      'Stably reorder existing entries by their encoded byte sequences. Native lock and key preparation can share this ordering without comparing mutable logical keys or re-encoding them. Equal byte identities keep their input order; the entry array is changed in place.',
      '按已编码的字节序列稳定重排已有条目。原生锁及键准备流程可共用此排序，无须比较可变逻辑键或重新编码；等价字节身份保持原输入顺序，条目数组会原地改变。'
    ),
    params: {
      entries: t(
        'Mutable array of entries, each carrying its already computed encoded Uint8Array.',
        '可变条目数组，每项携带已经算好的 encoded Uint8Array。'
      )
    },
    returns: t(
      'Nothing. The same array contains the ordered entries; their payload fields and encoded bytes are not rewritten.',
      '无返回值。同一数组包含排序后的条目，各项业务字段及编码字节不会被改写。'
    ),
    example: storageAuthoringExamples['storage-host:authoring/key:sortStorageByteIdentities']
  },
  storageKeyBytesIdentity: {
    role: 'operation',
    purpose: t(
      'Represent already encoded canonical key bytes as a stable hexadecimal identity for maps or equality checks. It does not validate or traverse the logical storage key and must receive bytes from the same canonical encoder on both sides of a comparison.',
      '把已规范编码的键字节表示为稳定十六进制身份，供映射或等价判断使用。它不校验或遍历逻辑存储键，比较双方应使用同一个规范编码器产生的字节。'
    ),
    params: {
      encoded: t('The complete canonical byte encoding of one key.', '一个键的完整规范字节编码。')
    },
    returns: t(
      'Lowercase hexadecimal text with two digits per byte; equal byte content gives equal text.',
      '返回小写十六进制文本，每个字节占两位；字节内容相同，文本即相同。'
    ),
    example: storageAuthoringExamples['storage-host:authoring/key:storageKeyBytesIdentity']
  },
  encodeRdfQuadSnapshot: {
    role: 'operation',
    purpose: t(
      'Encode a previously validated RDF quad without blank nodes for an existing native key or lock path. This avoids repeating RDF input traversal after snapshotStorageRdfQuad has already admitted the terms. For a new external input, use encodeStorageRdfQuad or snapshot it first.',
      '为已有原生键或锁流程编码先前已校验且不含空白节点的 RDF 四元组，避免在 snapshotStorageRdfQuad 准入各项后再次遍历输入。新的外部输入应先做快照，或使用 encodeStorageRdfQuad。'
    ),
    params: {
      quad: t(
        'A valid captured quad with named subject/predicate, supported object and valid graph; no blank nodes.',
        '已捕获的有效四元组：subject 与 predicate 为命名项，object 和 graph 有效，不含 blank node。'
      )
    },
    returns: t(
      'Canonical ordered bytes for the four terms. This helper adds no namespace prefix and owns no RDF store.',
      '返回四项的规范有序字节；不添加命名空间前缀，也不拥有 RDF 存储。'
    ),
    example: storageAuthoringExamples['storage-host:authoring/rdf:encodeRdfQuadSnapshot']
  },
  readTransactionConcurrency: {
    role: 'operation',
    purpose: t(
      'Read the backend label and concurrency observer captured when the original transaction owner was registered. Use these facts to connect a backend’s existing attempt loop. A copied store, transaction view or unregistered resource cannot supply them.',
      '读取原事务拥有者登记时保存的后端名称和并发观察接点，用来连接后端已有的尝试流程。复制的存储对象、事务视图或未登记资源不能提供这些资料。'
    ),
    params: {
      store: t(
        'The original registered backend store, not a scope.',
        '已登记的原后端存储，不是事务视图。'
      )
    },
    returns: t(
      'The captured backend and stages observer, which may be undefined. Reading them acquires no lock and extends no resource lifetime.',
      '返回保存的 backend 与可能为 undefined 的 stages 观察接点；读取不会取得锁或延长资源生命周期。'
    ),
    example:
      storageAuthoringExamples['storage-host:authoring/transaction:readTransactionConcurrency']
  },
  runTransactionIteratorOperation: {
    role: 'operation',
    purpose: t(
      'Run a complete query terminal through an iterator’s existing transaction registration. Its advances remain part of that accepted operation while the original owner drains work and cleanup. Ordinary unregistered iterators use their own next method directly; this helper never creates a second transaction owner.',
      '让完整查询终结操作经过迭代器已有的事务登记。原拥有者排空工作并清理期间，各次推进仍属于已接受的操作。未登记的普通迭代器直接使用自身 next 方法；此辅助函数不创建第二个事务拥有者。'
    ),
    params: {
      iterator: t(
        'Original storage iterator consumed by this terminal.',
        '本次终结操作消费的原存储迭代器。'
      ),
      run: t(
        'Async terminal receiving next(), fail(error) and the active scope. Use the supplied functions so advancement and failure retain their original owner.',
        '异步终结操作，接收 next()、fail(error) 及活跃视图。使用传入函数，保持推进及失败归属原拥有者。'
      ),
      currentScope: t(
        'Optional authentic active scope borrowed by nested reads; omit for a top-level terminal.',
        '嵌套读取可借用的真实活跃视图；顶层终结操作省略。'
      )
    },
    returns: t(
      'The terminal’s Promise. Backend failures retain original classification and are recorded before cleanup, so cleanup does not replace the primary error.',
      '返回终结操作的 Promise。后端失败保留原分类，并在清理前记录，清理不会替换主要错误。'
    ),
    example:
      storageAuthoringExamples['storage-host:authoring/transaction:runTransactionIteratorOperation']
  }
}
