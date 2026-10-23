import type { ICaseDoc, IText } from './contract.js'

/** Keeps complete bilingual cases beside their exact observable outputs. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Native graph readers and writers share the same reversible organization mapping. */
const orgGraphCase: ICaseDoc = {
  title: t(
    'Keep default and named graphs inside one organization',
    '把默认图和命名图限定在同一组织'
  ),
  problem: t(
    'Native RDF backends need graph isolation without inventing another IRI codec or default graph.',
    '原生 RDF 后端需要图隔离，不能另建 IRI codec 或默认图身份。'
  ),
  example: t(
    `import { getStorageOrgGraphPrefix, prefixStorageOrgGraph, unprefixStorageOrgGraph, term, RdfTermType, RdfDatatype } from '@migaia/storage-contract'
const orgId = '00000000-0000-0000-0000-000000000000'
const logical = term.iri('https://[::1]/图?x=%aB')
const physical = prefixStorageOrgGraph(orgId, logical)
console.log(prefixStorageOrgGraph(orgId, term.defaultGraph).value === getStorageOrgGraphPrefix(orgId) + 'd')
console.log(unprefixStorageOrgGraph(orgId, physical))
console.log(RdfTermType.namedNode, RdfDatatype.string)
// true
// { termType: 'NamedNode', value: 'https://[::1]/图?x=%aB' }
// NamedNode http://www.w3.org/2001/XMLSchema#string`,
    `import { getStorageOrgGraphPrefix, prefixStorageOrgGraph, unprefixStorageOrgGraph, term, RdfTermType, RdfDatatype } from '@migaia/storage-contract'
const orgId = '00000000-0000-0000-0000-000000000000'
const logical = term.iri('https://[::1]/图?x=%aB')
const physical = prefixStorageOrgGraph(orgId, logical)
console.log(prefixStorageOrgGraph(orgId, term.defaultGraph).value === getStorageOrgGraphPrefix(orgId) + 'd')
console.log(unprefixStorageOrgGraph(orgId, physical))
console.log(RdfTermType.namedNode, RdfDatatype.string)
// true
// { termType: 'NamedNode', value: 'https://[::1]/图?x=%aB' }
// NamedNode http://www.w3.org/2001/XMLSchema#string`
  ),
  result: t(
    'The default graph has its own native named identity. The logical IRI returns with exact spelling; foreign or malformed physical graphs throw INVALID_ARGUMENT.',
    '默认图具有独立原生命名身份；逻辑 IRI 原样返回。其它组织或无效物理图抛 INVALID_ARGUMENT。'
  )
}

/** One complete read-only lookup example is shared by the two exact public accessors. */
const capabilityReadCase: ICaseDoc = {
  title: t(
    'Read a capability without acquiring provider authority',
    '读取能力而不取得 provider 权限'
  ),
  problem: t(
    'Consumers need capability access without modifying a supplied base or receiving its installation/close controls.',
    '消费者需要访问能力，不应修改传入 base 或取得安装、关闭控制。'
  ),
  example: t(
    `import { hasStorageCapability, useStorageCapability, kv, type IStorageBase } from '@migaia/storage-contract'
async function readGreeting(store: IStorageBase) {
  if (!hasStorageCapability(store, kv)) return undefined
  return useStorageCapability(store, kv).get('greeting')
}`,
    `import { hasStorageCapability, useStorageCapability, kv, type IStorageBase } from '@migaia/storage-contract'
async function readGreeting(store: IStorageBase) {
  if (!hasStorageCapability(store, kv)) return undefined
  return useStorageCapability(store, kv).get('greeting')
}`
  ),
  result: t(
    'A provided KV store reads its original API. A raw/frozen resource without KV returns undefined without mutation or disposal. Published Feature APIs are read through the same provider table.',
    '已提供 KV 的 store 读取原 API；无 KV 的 raw/frozen 资源返回 undefined，不修改或释放；已发布 Feature API 从同一 provider 表读取。'
  )
}

/** Native authors share admission without acquiring any connection or search runner. */
const vectorInputCase: ICaseDoc = {
  title: t('Capture native vector arguments', '捕获原生向量参数'),
  problem: t(
    'Native backends need one input contract before performing their own I/O.',
    '原生后端在自己的 I/O 前需要同一输入契约。'
  ),
  example:
    "import { snapshotStorageVectorCollection, snapshotStorageVector, snapshotStorageVectorUpsert, snapshotStorageVectorFilter, snapshotStorageVectorSearch } from '@migaia/storage-contract'\nconst configuration = snapshotStorageVectorCollection('docs', { dimensions: 2, metric: 'cosine' }).options!\nconst query = snapshotStorageVector([1, 0], configuration)\nconst points = snapshotStorageVectorUpsert([{ id: 'a', vector: [1, 0], payload: { tag: 'docs' } }], configuration)\nconst filter = snapshotStorageVectorFilter({ field: 'tag', in: ['docs'] })\nconst search = snapshotStorageVectorSearch(query, { k: 0, filter }, configuration)\nconsole.log(points[0]?.id, search.options.k, search.options.withPayload)\n// a 0 false",
  result: t(
    'Prints a 0 false. Capture creates no collection or operation and validates zero-result searches.',
    '输出 a 0 false；捕获不创建 collection 或操作，零结果搜索也先校验。'
  )
}

/** TTL callers use their actual provided backend; the helper owns only target/duration admission. */
const ttlCase: ICaseDoc = {
  title: t('Expire an existing physical entry', '为已有物理条目设置期限'),
  problem: t(
    'TTL must identify the actual channel and use its backend’s original deadline owner.',
    'TTL 须标识实际通道，并沿后端原期限 owner 执行。'
  ),
  example: `import {
  ttl, snapshotStorageTtlTarget, assertStorageTtlDuration, type IStorageStore
} from '@migaia/storage-contract'
async function expireSession(store: IStorageStore<typeof ttl>) {
  const target = snapshotStorageTtlTarget({ channel: 'text', key: 'session' }, store.backend)
  assertStorageTtlDuration(1000, store.backend)
  await store.use(ttl).expire(target, 1000)
  return store.use(ttl).remaining(target)
}`,
  result: t(
    'An actual backend controls expiry. Missing or expired entries are not recreated; target capture starts no clock or operation budget.',
    '实际后端控制到期；不重建缺失或已过期条目；目标捕获不启动时钟或操作预算。'
  )
}
/** Counter authors reuse pure validation inside their existing atomic native text update. */
const counterCase: ICaseDoc = {
  title: t('Increment canonical text atomically', '原子递增规范文本'),
  problem: t(
    'Native backends must validate canonical decimal arithmetic without copying a second counter rule.',
    '原生后端须校验规范十进制运算，不能复制第二套计数规则。'
  ),
  example: `import { counter, snapshotStorageCounterIncrement, type IStorageStore } from '@migaia/storage-contract'
async function recordVisit(store: IStorageStore<typeof counter>) {
  return store.use(counter).increment('visits')
}
const increment = snapshotStorageCounterIncrement(undefined, 'memory')
// A backend applies increment(currentText) inside its existing atomic native operation.
const nextText = String(increment('41'))`,
  result: t(
    'The actual native increment is atomic. The pure captured calculation validates safe integers and canonical text but opens no transaction or resource.',
    '实际原生递增具原子性；纯捕获计算校验安全整数与规范文本，不打开事务或资源。'
  )
}

/** Pure ground RDF preparation is shared by actual native backends, without a fictional store. */
const rdfTermCase: ICaseDoc = {
  title: t('Prepare ground RDF identity once', '一次准备 ground RDF 身份'),
  problem: t(
    'Native writes and query patterns must agree on normalized literals and portable ground positions.',
    '原生写入与查询模式须统一规范 literal 和便携 ground 位置。'
  ),
  example: `import {
  term, snapshotStorageRdfTerm, snapshotStorageRdfPattern,
  snapshotStorageRdfQuad, encodeStorageRdfQuad
} from '@migaia/storage-contract'
const quad = snapshotStorageRdfQuad({
  subject: term.iri('urn:user:1'),
  predicate: term.iri('urn:label'),
  object: term.literal('Ada', { language: 'EN' }),
  graph: term.defaultGraph
}, 'memory')
const pattern = snapshotStorageRdfPattern({ subject: quad.subject }, 'memory')
const identityBytes = encodeStorageRdfQuad(quad, 'memory')
const responseLocalBlank = snapshotStorageRdfTerm(term.blank('response-local'), undefined)`,
  result: t(
    'Language becomes lowercase, IRI spelling stays exact, and omitted pattern graph covers all graphs. Identity bytes are self-delimiting; raw blank terms cannot enter ground quad positions.',
    'language 变为小写、IRI 拼写保持精确，模式省略 graph 时涵盖所有图。身份字节自定界；raw blank 项不能进入 ground quad 位置。'
  )
}

/** SQL capability access requires an actual native provider and reuses its original executor. */
const sqlCapabilityCase: ICaseDoc = {
  title: t('Use the native SQL capability', '使用原生 SQL 能力'),
  problem: t(
    'A consumer must select the published native SQL API by exact token.',
    '消费者须按精确令牌选择已发布的原生 SQL API。'
  ),
  example: `import { sql, type IStorageStore } from '@migaia/storage-contract'
async function readOne(store: IStorageStore<typeof sql>) {
  return store.use(sql).sql<{ value: number }>\`SELECT 1 AS value\`.get()
}`,
  result: t(
    'The actual backend executes one statement. Transaction projections use the same original draft and budget.',
    '实际后端执行一条语句；事务投影沿同一原 draft 与预算。'
  )
}
/** Terminal derivation changes only the finite callbacks of an authentic existing SQL node. */
const deriveSqlCase: ICaseDoc = {
  title: t('Derive an existing SQL query', '派生已有 SQL 查询'),
  problem: t(
    'A transaction wrapper must retain captured fragment identity without a second compiler.',
    '事务包装须保留已捕获片段身份，不能复制 compiler。'
  ),
  example: `import { deriveStorageSqlQuery, type ISqlQuery } from '@migaia/storage-contract'
function observe(query: ISqlQuery) {
  return deriveStorageSqlQuery(query, {
    all: ctx => query.all(ctx),
    get: ctx => query.get(ctx),
    run: ctx => query.run(ctx)
  })
}`,
  result: t(
    'Construction performs no I/O. The derived query shares its original node and forwards original terminal Promises.',
    '构造不做 I/O；派生查询共享原节点并转发原终端 Promise。'
  )
}

/** Object reads acquire the backend's actual snapshot and dispose it through the original owner. */
const blobCase: ICaseDoc = {
  title: t('Read an independent object snapshot', '读取独立对象快照'),
  problem: t(
    'Object resources must be consumed once and released after reading.',
    '对象资源须单次消费，并在读取后释放。'
  ),
  example: `import { blob, type IStorageStore } from '@migaia/storage-contract'
async function readObject(store: IStorageStore<typeof blob>) {
  const object = await store.use(blob).get('readme')
  if (!object) return undefined
  await using owned = object
  return object.bytes()
}`,
  result: t(
    'The actual backend supplies detached bytes; the original object lifetime closes once.',
    '实际后端提供独立字节；原对象生命周期只关闭一次。'
  )
}
/** Replay cursors advance only after the consumer has processed the returned native commits. */
const durableChangeCase: ICaseDoc = {
  title: t('Replay durable commit summaries', '重放持久提交摘要'),
  problem: t(
    'Consumers must retain their cursor only after successful processing.',
    '消费者须在成功处理后才保存游标。'
  ),
  example: `import { durableChangeFeed, type IStorageStore, type IDurableStorageChange } from '@migaia/storage-contract'
async function replay(store: IStorageStore<typeof durableChangeFeed>, after: string, process: (change: IDurableStorageChange) => Promise<void>) {
  const batch = await store.use(durableChangeFeed).readChanges({ after })
  for (const change of batch.changes) await process(change)
  return batch.cursor
}`,
  result: t(
    'Actual retained commits replay at least once. A retention gap rejects CHANGE_CURSOR_EXPIRED and requires full invalidation.',
    '实际保留提交至少一次重放；保留期缺口拒绝 CHANGE_CURSOR_EXPIRED，并要求全量失效。'
  )
}

/** Organization prefix and native ordering consumers share the original byte identity owner. */
const orgByteOrderCase: ICaseDoc = {
  title: t('Order physical keys within one organization', '在同一组织中排列物理键'),
  problem: t(
    'Backends need ordered object pages without a second organization codec or sorting rule.',
    '后端需要有序对象页，不能复制组织 codec 或排序规则。'
  ),
  example: `import { prefixStorageOrgKey, encodeStorageOrgStringPrefix, encodeOrderedStorageKey, orderStorageKeysByBytes } from '@migaia/storage-contract'
const org = '12345678-1234-1234-1234-123456789abc'
const prefix = encodeStorageOrgStringPrefix(org, 'user/', 'memory')
const ordered = orderStorageKeysByBytes(['user/z', 'user/a'], key => encodeOrderedStorageKey(prefixStorageOrgKey(org, key), 'memory'))`,
  result: t(
    'ordered is user/a then user/z. The byte prefix matches only string keys under user/ in the exact organization.',
    'ordered 为 user/a 后 user/z；字节前缀只匹配精确组织内 user/ 下的 string key。'
  )
}

/** Native SPARQL selection consumes only a real published endpoint capability. */
const sparqlCase: ICaseDoc = {
  title: t('Compose safe RDF bindings for native SPARQL', '为原生 SPARQL 组合安全 RDF 绑定'),
  problem: t(
    'RDF values must not become unescaped query grammar.',
    'RDF 值不能变成未转义查询语法。'
  ),
  example: `import { sparql, sparqlFragment, term, type IStorageStore } from '@migaia/storage-contract'
async function readLabel(store: IStorageStore<typeof sparql>) {
  const condition = sparqlFragment\`FILTER (?label = \${term.literal('A"B')})\`
  return store.use(sparql)\`SELECT ?label WHERE { ?s ?p ?label . \${condition} }\`.select()
}`,
  result: t(
    'Only the native select terminal executes. The literal quote is escaped by the shared renderer before endpoint execution.',
    '只有原生 select 终端执行；literal 引号在 endpoint 执行前由同一 renderer 转义。'
  )
}
/** Lazy native binding retains admission and lifecycle authority with the original backend. */
const sparqlAuthorCase: ICaseDoc = {
  title: t('Bind original SPARQL callbacks', '绑定原 SPARQL 回调'),
  problem: t(
    'A native backend must reuse one fragment renderer without acquiring another executor.',
    '原生后端须复用同一片段 renderer，不能获得另一套 executor。'
  ),
  example: `import { createSparqlTag } from '@migaia/storage-contract'
function bindNative(original: Parameters<typeof createSparqlTag>[0]) {
  return createSparqlTag(original)
}`,
  result: t(
    'Callbacks own native admission and invoke lazy prepare afterward. Receiver, context and Promise identity remain exact.',
    '回调拥有原生准入并在准入后调用 lazy prepare；receiver、context 与 Promise 身份保持精确。'
  )
}

/** Vector selection uses the actual native engine behind its published capability. */
const vectorCapabilityCase: ICaseDoc = {
  title: t('Select a native bounded vector query', '选择原生有界向量查询'),
  problem: t(
    'Typed payload queries must share the canonical query family and require topK.',
    '类型化 payload 查询须共享规范 query family，并要求 topK。'
  ),
  example: `import { vector, type IStorageStore } from '@migaia/storage-contract'
type IPayload = { readonly label: string }
async function nearest(store: IStorageStore<typeof vector>) {
  return store.use(vector).collection<IPayload>('items', { dimensions: 2, metric: 'cosine' })
    .near([1, 0]).topK(5).all()
}`,
  result: t(
    'The actual native engine returns at most five ranked hits. Vectors remain omitted until withVector is selected.',
    '实际原生引擎返回至多五个排序命中；选择 withVector 前不返回向量。'
  )
}
/** Ground RDF writes and queries share their canonical term identity. */
const rdfCapabilityCase: ICaseDoc = {
  title: t('Write and match a ground RDF quad', '写入并匹配 ground RDF quad'),
  problem: t(
    'Native backends must share exact ground-term identity.',
    '原生后端须共享精确 ground term 身份。'
  ),
  example: `import { rdf, term, type IStorageStore } from '@migaia/storage-contract'
async function writeLabel(store: IStorageStore<typeof rdf>) {
  const subject = term.iri('urn:user:1')
  await store.use(rdf).add([{ subject, predicate: term.iri('urn:label'), object: term.literal('Ada'), graph: term.defaultGraph }])
  return store.use(rdf).match({ subject }).all()
}`,
  result: t(
    'The native backend writes atomically and the shared RDF family reads matching ground quads.',
    '原生后端原子写入，共享 RDF family 读取匹配 ground quad。'
  )
}

/** Deletion strategy remains explicit without broadening the shared numeric result. */
const vectorDeleteCountCase: ICaseDoc = {
  title: t('Choose a native vector deletion count strategy', '选择原生向量删除计数策略'),
  problem: t(
    'Qdrant callers must choose the declared native counting boundary.',
    'Qdrant 调用方须选择约定的原生计数边界。'
  ),
  example: `import { vector, DeleteCountMode, type IStorageStore } from '@migaia/storage-contract'
async function deleteDrafts(store: IStorageStore<typeof vector>) {
  return store.use(vector).collection<{ state: string }>('items')
    .deleteWhere({ state: 'draft' }, { count: DeleteCountMode.scroll })
}`,
  result: t(
    'The operation returns the strategy-defined number. Scroll counts collected IDs whose delete was submitted successfully; native affected-count engines keep their actual count.',
    '操作返回策略约定的数值；scroll 计已收集且成功提交删除的 ID，原生 affected-count 引擎保留实际数量。'
  )
}

/** Exercises public contract tools without supplying a fictional storage implementation. */
export const storageContractCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  getStorageOrgGraphPrefix: [orgGraphCase],
  prefixStorageOrgGraph: [orgGraphCase],
  unprefixStorageOrgGraph: [orgGraphCase],
  RdfTermType: [orgGraphCase],
  RdfDatatype: [orgGraphCase],
  sql: [sqlCapabilityCase],
  vector: [vectorCapabilityCase],
  rdf: [rdfCapabilityCase],
  DeleteCountMode: [vectorDeleteCountCase],
  sparql: [sparqlCase],
  sparqlFragment: [sparqlCase],
  createSparqlTag: [sparqlAuthorCase],
  orderStorageKeysByBytes: [orgByteOrderCase],
  encodeStorageOrgStringPrefix: [orgByteOrderCase],
  blob: [blobCase],
  durableChangeFeed: [durableChangeCase],
  deriveStorageSqlQuery: [deriveSqlCase],
  term: [rdfTermCase],
  snapshotStorageRdfTerm: [rdfTermCase],
  snapshotStorageRdfPattern: [rdfTermCase],
  snapshotStorageRdfQuad: [rdfTermCase],
  encodeStorageRdfQuad: [rdfTermCase],
  ttl: [ttlCase],
  snapshotStorageVectorCollection: [vectorInputCase],
  snapshotStorageVector: [vectorInputCase],
  snapshotStorageVectorUpsert: [vectorInputCase],
  snapshotStorageVectorFilter: [vectorInputCase],
  snapshotStorageVectorSearch: [vectorInputCase],
  snapshotStorageBlobPut: [
    {
      title: t('snapshotStorageBlobPut', 'snapshotStorageBlobPut'),
      problem: t(
        'Backend authors need the original shared blob input and resource semantics.',
        '后端作者需要原共享 blob 输入与资源语义。'
      ),
      example: t(
        "import { snapshotStorageBlobPut } from '@migaia/storage-contract'\nconst body = new Uint8Array([1, 2])\nconst input = snapshotStorageBlobPut('file', body, { metadata: { owner: 'Ada' } }, 'object')\nbody[0] = 9\nconsole.log(input.body instanceof Uint8Array && input.body[0], input.options.metadata?.owner)",
        "import { snapshotStorageBlobPut } from '@migaia/storage-contract'\nconst body = new Uint8Array([1, 2])\nconst input = snapshotStorageBlobPut('file', body, { metadata: { owner: 'Ada' } }, 'object')\nbody[0] = 9\nconsole.log(input.body instanceof Uint8Array && input.body[0], input.options.metadata?.owner)"
      ),
      result: t(
        'Prints 1 Ada; input bytes and metadata are detached without I/O.',
        '输出 1 Ada；输入字节与元数据独立捕获，不进行 I/O。'
      )
    }
  ],
  snapshotStorageBlobGet: [
    {
      title: t('snapshotStorageBlobGet', 'snapshotStorageBlobGet'),
      problem: t(
        'Backend authors need the original shared blob input and resource semantics.',
        '后端作者需要原共享 blob 输入与资源语义。'
      ),
      example: t(
        "import { snapshotStorageBlobGet } from '@migaia/storage-contract'\nconst input = snapshotStorageBlobGet('file', { range: { start: 2, end: 4 } }, 'object')\nconsole.log(input.options.range?.start, input.options.range?.end)",
        "import { snapshotStorageBlobGet } from '@migaia/storage-contract'\nconst input = snapshotStorageBlobGet('file', { range: { start: 2, end: 4 } }, 'object')\nconsole.log(input.options.range?.start, input.options.range?.end)"
      ),
      result: t(
        'Prints 2 4; end is inclusive and native content remains unopened.',
        '输出 2 4；end 为闭区间，尚未打开原生内容。'
      )
    }
  ],
  snapshotStorageBlobList: [
    {
      title: t('snapshotStorageBlobList', 'snapshotStorageBlobList'),
      problem: t(
        'Backend authors need the original shared blob input and resource semantics.',
        '后端作者需要原共享 blob 输入与资源语义。'
      ),
      example: t(
        "import { snapshotStorageBlobList } from '@migaia/storage-contract'\nconst input = snapshotStorageBlobList({ prefix: 'files/' }, undefined, 'object')\nconsole.log(input.prefix, input.limit)",
        "import { snapshotStorageBlobList } from '@migaia/storage-contract'\nconst input = snapshotStorageBlobList({ prefix: 'files/' }, undefined, 'object')\nconsole.log(input.prefix, input.limit)"
      ),
      result: t(
        'Prints files/ 100; the backend still owns actual pagination and cursor binding.',
        '输出 files/ 100；后端继续拥有实际分页与游标绑定。'
      )
    }
  ],
  createStorageBlobObject: [
    {
      title: t('createStorageBlobObject', 'createStorageBlobObject'),
      problem: t(
        'Backend authors need the original shared blob input and resource semantics.',
        '后端作者需要原共享 blob 输入与资源语义。'
      ),
      example: t(
        "import { createStorageBlobObject } from '@migaia/storage-contract'\nconst object = createStorageBlobObject(\n  { key: 'file', size: 1, etag: 'native', updatedAt: 1, metadata: {} },\n  new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([7])); controller.close() } }),\n  { close: async () => undefined, report: console.error, backend: 'object' }\n)\ntry { console.log((await object.bytes())[0]) } finally { await object.dispose() }",
        "import { createStorageBlobObject } from '@migaia/storage-contract'\nconst object = createStorageBlobObject(\n  { key: 'file', size: 1, etag: 'native', updatedAt: 1, metadata: {} },\n  new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([7])); controller.close() } }),\n  { close: async () => undefined, report: console.error, backend: 'object' }\n)\ntry { console.log((await object.bytes())[0]) } finally { await object.dispose() }"
      ),
      result: t(
        'Prints 7; bytes consumes the single content right and EOF releases the original resource.',
        '输出 7；bytes 消费唯一内容权限，EOF 释放原资源。'
      )
    }
  ],
  snapshotStorageTtlTarget: [ttlCase],
  assertStorageTtlDuration: [ttlCase],
  counter: [counterCase],
  snapshotStorageCounterIncrement: [counterCase],
  createStorageBatchKeyCapture: [
    {
      title: t('Retain the native entry capture order', '保留原生条目捕获次序'),
      problem: t(
        'Existing backends validate key, duplicate, value and TTL at different original points.',
        '已有后端在各自原校验点处理 key、重复、value 与 TTL。'
      ),
      example: `import { createStorageBatchKeyCapture } from '@migaia/storage-contract'
const capture = createStorageBatchKeyCapture('memory')
const first = capture(['users', 1])
// Capture this entry’s original value/TTL fields at the backend’s original point.
const second = capture(['users', 1])
// second.firstIndex is 0; native authors reject at their original duplicate check.`,
      result: t(
        'Each call captures one key and retains the shared canonical identity. No later entry, value, TTL or consumer callback is read by the helper.',
        '每次调用捕获一个键并保留共享规范身份；helper 不读取后项、value、TTL 或消费者回调。'
      )
    }
  ],
  snapshotStorageBatchKeys: [
    {
      title: t('Prepare one canonical native batch', '准备一个规范原生批次'),
      problem: t(
        'Native readers preserve duplicate positions while removals count each canonical key once.',
        '原生读取保留重复位置，删除则每个规范键只计一次。'
      ),
      example: `import { snapshotStorageBatchKeys } from '@migaia/storage-contract'
const reads = snapshotStorageBatchKeys([0, -0, ['users', 1]], 'memory')
const removals = reads.filter((entry, index) => entry.firstIndex === index)
const writes = snapshotStorageBatchKeys(['first', 'second'], 'memory', {
  rejectDuplicates: true
})
// Use reads in input order, removals once per identity, and writes in one native operation.`,
      result: t(
        'The first two read positions share one identity. Duplicate write keys reject INVALID_ARGUMENT before native work; malformed logical keys retain INVALID_KEY.',
        '前两个读取位置共享同一身份。重复写键在原生操作前抛 INVALID_ARGUMENT；非法逻辑键保留 INVALID_KEY。'
      )
    }
  ],
  snapshotStorageKeyPrefix: [
    {
      title: t('Locate one typed canonical prefix', '定位一个 typed 规范前缀'),
      problem: t(
        'Backends need identical prefix rules and ordered bounds without copying validators or scanning unrelated data.',
        '后端需要一致前缀规则与有序边界，不能复制验证器或扫描无关数据。'
      ),
      example: t(
        `import { snapshotStorageKeyPrefix } from '@migaia/storage-contract'
const prefix = snapshotStorageKeyPrefix(['cache', 'users'], 'memory')
const included = prefix.matches(['cache', 'users', 1])
const excluded = prefix.matches(['cache', 'users-extra'])
// included === true; excluded === false
// Native ordered stores use prefix.lower <= encodedKey < prefix.upper.`,
        `import { snapshotStorageKeyPrefix } from '@migaia/storage-contract'
const prefix = snapshotStorageKeyPrefix(['cache', 'users'], 'memory')
const included = prefix.matches(['cache', 'users', 1])
const excluded = prefix.matches(['cache', 'users-extra'])
// included === true; excluded === false
// Native ordered stores use prefix.lower <= encodedKey < prefix.upper.`
      ),
      result: t(
        'The complete child sequence matches the extended tuple but excludes a different last child. lower/upper bound the same canonical byte range; the matcher is independent of exposed mutable copies.',
        '完整子键序列匹配扩展 tuple，排除不同末子键；lower/upper 定位同一规范字节范围，matcher 独立于外露可变副本。'
      )
    }
  ],
  useTransactionCapability: [
    {
      title: t(
        'Keep transaction capability execution in its original owner',
        '将事务能力执行保持在原 owner'
      ),
      problem: t(
        'Capability lookup must not expose root APIs, mutate frozen scopes or bypass transaction first failure and lifetime.',
        '能力取用不能暴露根 API、修改冻结 scope 或绕过事务首错与生命周期。'
      ),
      example: t(
        `import { kv, records, type ITransactionScope } from '@migaia/storage-contract'
async function paidValues(tx: ITransactionScope<{ state: string; value: number }, typeof records>) {
  await tx.use(kv).setMany([{ key: 'status', value: 'paid' }])
  return tx.use(records).query().where({ state: 'paid' }).select('value').all()
}`,
        `import { kv, records, type ITransactionScope } from '@migaia/storage-contract'
async function paidValues(tx: ITransactionScope<{ state: string; value: number }, typeof records>) {
  await tx.use(kv).setMany([{ key: 'status', value: 'paid' }])
  return tx.use(records).query().where({ state: 'paid' }).select('value').all()
}`
      ),
      result: t(
        'KV batches and record queries use the same native transaction. Pure repeated lookup is cached without I/O; each data call receives an original fresh operation view, and expired terminals reject before I/O.',
        'KV 批量与记录查询使用同一原生事务；重复纯取用缓存但不 I/O；每次数据调用得到原新操作视图，过期终点在 I/O 前拒绝。'
      )
    }
  ],
  sqlFragment: [
    {
      title: t(
        'Bind values while composing identifiers and fragments',
        '组合标识符与片段，并独立绑定值'
      ),
      problem: t(
        'SQL composition must preserve parameter identity without granting pure fragments a connection or copying accumulated prefixes.',
        'SQL 组合必须保留参数身份，不能给纯片段连接权限或反复复制历史前缀。'
      ),
      example: t(
        `import { sqlFragment, type ISqlExecutor } from '@migaia/storage-contract'
async function readUser(executor: ISqlExecutor, id: number) {
  const columns = sqlFragment.join([sqlFragment.id('id'), sqlFragment.id('name')])
  return executor.sql<{ id: number; name?: string }>\`SELECT \${columns} FROM \${sqlFragment.id('users')} WHERE id = \${id}\`.get()
}`,
        `import { sqlFragment, type ISqlExecutor } from '@migaia/storage-contract'
async function readUser(executor: ISqlExecutor, id: number) {
  const columns = sqlFragment.join([sqlFragment.id('id'), sqlFragment.id('name')])
  return executor.sql<{ id: number; name?: string }>\`SELECT \${columns} FROM \${sqlFragment.id('users')} WHERE id = \${id}\`.get()
}`
      ),
      result: t(
        'The original injected executor runs one statement with bound id. Pure fragments own no terminals; byte inputs are snapshotted and each prepare supplies fresh copies.',
        '原注入 executor 执行单条语句并绑定 id；纯片段没有终点；字节输入制作快照，每次 prepare 提供独立副本。'
      )
    }
  ],
  createSqlTag: [
    {
      title: t('Prepare only after original operation admission', '在原操作准入后才 prepare'),
      problem: t(
        'Backend authors need the shared scanner and bindings without a second connection, transaction or resource owner.',
        '后端作者需要共用 scanner 与绑定，不能新增连接、事务或资源拥有者。'
      ),
      example: t(
        `import { createSqlTag } from '@migaia/storage-contract'
function bindNative(
  original: Omit<Parameters<typeof createSqlTag>[0], 'dialect'>
) {
  return createSqlTag({ dialect: 'postgres', ...original })
}`,
        `import { createSqlTag } from '@migaia/storage-contract'
function bindNative(
  original: Omit<Parameters<typeof createSqlTag>[0], 'dialect'>
) {
  return createSqlTag({ dialect: 'postgres', ...original })
}`
      ),
      result: t(
        'execute must own original admission and call prepare before its native driver. The factory returns each supplied callback Promise directly, adds no I/O and keeps lexical failure in the original owner.',
        'execute 必须拥有原准入，并在原生驱动前调用 prepare；工厂直接返回各原回调 Promise，不新增 I/O，词法失败保持原 owner。'
      )
    }
  ],
  snapshotConcurrencyLockKeys: [
    {
      title: t('Use one canonical identity snapshot', '使用一份规范身份快照'),
      problem: t(
        'A synchronous key probe must not copy channel ranks or encode a second key domain.',
        '同步键探测不能复制通道顺序或再编码另一键域。'
      ),
      example: t(
        `import { lockKey, snapshotConcurrencyLockKeys } from '@migaia/storage-contract'
const snapshot = snapshotConcurrencyLockKeys([lockKey.text('a'), lockKey.text('a')], 'memory')
console.log(snapshot.keys.length, snapshot.identities.length)`,
        `import { lockKey, snapshotConcurrencyLockKeys } from '@migaia/storage-contract'
const snapshot = snapshotConcurrencyLockKeys([lockKey.text('a'), lockKey.text('a')], 'memory')
console.log(snapshot.keys.length, snapshot.identities.length)`
      ),
      result: t(
        'Both counts are 1; paired frozen identity data grants no acquisition authority.',
        '两个计数均为 1；配对冻结身份数据不授予取锁权限。'
      )
    }
  ],
  snapshotConcurrencyLockRange: [
    {
      title: t('Bound one channel prefix', '界定一个通道前缀'),
      problem: t(
        'Native range checks need the exact canonical lock bounds without scanning or duplicating encoding.',
        '原生范围检查需要精确规范锁边界，不能扫描或复制编码。'
      ),
      example: t(
        `import { lockKey, snapshotConcurrencyLockKeys, snapshotConcurrencyLockRange } from '@migaia/storage-contract'
const bounds = snapshotConcurrencyLockRange({ channel: 'text', prefix: 'users/' }, 'memory')
const id = snapshotConcurrencyLockKeys([lockKey.text('users/1')], 'memory').identities[0]!
console.log(bounds.lower <= id && id < bounds.upper)`,
        `import { lockKey, snapshotConcurrencyLockKeys, snapshotConcurrencyLockRange } from '@migaia/storage-contract'
const bounds = snapshotConcurrencyLockRange({ channel: 'text', prefix: 'users/' }, 'memory')
const id = snapshotConcurrencyLockKeys([lockKey.text('users/1')], 'memory').identities[0]!
console.log(bounds.lower <= id && id < bounds.upper)`
      ),
      result: t(
        'true; the half-open range includes the text prefix and excludes other channels.',
        'true；半开范围包含该 text 前缀，排除其它通道。'
      )
    }
  ],
  snapshotConcurrencyLockHoldings: [
    {
      title: t('Inspect detached holdings in canonical order', '按规范顺序检查独立持锁快照'),
      problem: t(
        'Native lock tables keep insertion order and must not duplicate canonical sorting.',
        '原生锁表保留插入顺序，不能复制规范排序实现。'
      ),
      example: t(
        `import { snapshotConcurrencyLockHoldings, type ILockHolding } from '@migaia/storage-contract'
function inspect(rows: readonly ILockHolding[]) {
  return snapshotConcurrencyLockHoldings(rows)
}`,
        `import { snapshotConcurrencyLockHoldings, type ILockHolding } from '@migaia/storage-contract'
function inspect(rows: readonly ILockHolding[]) {
  return snapshotConcurrencyLockHoldings(rows)
}`
      ),
      result: t(
        'Returns frozen independent key/holder rows in stable channel/key order, retaining expired and expiresAt and separate equal-key rows. No internal lock table or authority is exposed.',
        '返回冻结的独立键与 holder 行，按通道与键稳定排序，保留 expired、expiresAt 和相同键的独立行；不暴露内部锁表或权限。'
      )
    }
  ],
  readConcurrencyLockIdentities: [
    {
      title: t(
        'Read canonical identities without encoding another key set',
        '读取规范身份，不重新编码键集合'
      ),
      problem: t(
        'A native key-lock provider must use the same normalized identities as its original active attempt.',
        '原生键锁 provider 必须使用与原活跃 attempt 相同的规范身份。'
      ),
      example: t(
        `import { readConcurrencyLockIdentities, type IConcurrencyAttemptContext } from '@migaia/storage-contract'
function lockIdentities(ctx: IConcurrencyAttemptContext) {
  return readConcurrencyLockIdentities(ctx)
}`,
        `import { readConcurrencyLockIdentities, type IConcurrencyAttemptContext } from '@migaia/storage-contract'
function lockIdentities(ctx: IConcurrencyAttemptContext) {
  return readConcurrencyLockIdentities(ctx)
}`
      ),
      result: t(
        'The active original attempt supplies one frozen sorted/deduplicated hex string list, reused by nested attempts. Forged or settled contexts throw INVALID_ARGUMENT; no mutable bytes or control handles are returned.',
        '原活跃 attempt 提供一个冻结、排序去重的十六进制字符串列表，嵌套尝试复用；伪造或已结算 context 抛 INVALID_ARGUMENT，不返回可变字节或控制句柄。'
      )
    }
  ],
  records: [
    {
      title: t('Use one standard record query entry', '使用唯一标准记录查询入口'),
      problem: t(
        'Native record backends and record Features must share the same typed query executor instead of interpreting the legacy support flag as permission.',
        '原生记录后端与 records Feature 必须共用 typed 查询执行器，不能把旧支持标记解释成权限。'
      ),
      example: t(
        `import { records, useStorageCapability, type IStorageBase } from '@migaia/storage-contract'
async function paidTotals(store: IStorageBase) {
  return useStorageCapability(store, records).query<{ status: string; total: number }>()
    .where({ status: 'paid' }).select('total').all()
}`,
        `import { records, useStorageCapability, type IStorageBase } from '@migaia/storage-contract'
async function paidTotals(store: IStorageBase) {
  return useStorageCapability(store, records).query<{ status: string; total: number }>()
    .where({ status: 'paid' }).select('total').all()
}`
      ),
      result: t(
        'An actual provided records API executes the shared query and returns selected paid totals. Missing tokens throw UNSUPPORTED_CAPABILITY; admission alone performs no query. Other terminals are not advertised by this slice.',
        '真实已提供 records API 执行共用查询并返回 paid total；缺失 token 抛 UNSUPPORTED_CAPABILITY，准入本身不执行查询，本切片不声明其他终点。'
      )
    }
  ],
  hasStorageCapability: [capabilityReadCase],
  useStorageCapability: [capabilityReadCase],
  createRecordQuery: [
    {
      title: t('Use an indexed native count cursor', '使用有索引的原生计数游标'),
      problem: t(
        'Count a native filtered result without returning its records.',
        '原生过滤后计数，无须返回记录。'
      ),
      example: t(
        `import { createRecordQuery, type IRecordQuerySource } from '@migaia/storage-contract'
function count(execute: IRecordQuerySource['execute'], reduce: NonNullable<IRecordQuerySource['reduce']>) {
  return createRecordQuery<{ enabled: boolean }>({
    pushdown: { source: 'indexed', operators: ['eq'], operations: ['where', 'count'] }, execute, reduce
  }).where({ enabled: true }).requirePushdown().count()
}`,
        `import { createRecordQuery, type IRecordQuerySource } from '@migaia/storage-contract'
function count(execute: IRecordQuerySource['execute'], reduce: NonNullable<IRecordQuerySource['reduce']>) {
  return createRecordQuery<{ enabled: boolean }>({
    pushdown: { source: 'indexed', operators: ['eq'], operations: ['where', 'count'] }, execute, reduce
  }).where({ enabled: true }).requirePushdown().count()
}`
      ),
      result: t(
        'Consumes one scalar from the provided original native cursor and awaits its cleanup. No matching records cross the boundary.',
        '从提供的原生原游标读取一个标量并等待清理，匹配记录不跨越边界。'
      )
    },
    {
      title: t('Share a record executor over an original cursor', '在原游标上共用记录执行器'),
      problem: t(
        'A backend needs declarative conditions and typed projections without another fluent chain or resource owner.',
        '后端需要声明式条件与 typed 投影，不应另建查询链或资源 owner。'
      ),
      example: t(
        `import { createRecordQuery, type IRecordQuerySource } from '@migaia/storage-contract'
function totals(execute: IRecordQuerySource['execute']) {
  return createRecordQuery<{ status: string; total: number }>({
    pushdown: { source: 'supplied-cursor', operations: [], operators: [] }, execute
  }).where({ status: 'paid' }).where('total', 'gte', 100).select('total').all()
}`,
        `import { createRecordQuery, type IRecordQuerySource } from '@migaia/storage-contract'
function totals(execute: IRecordQuerySource['execute']) {
  return createRecordQuery<{ status: string; total: number }>({
    pushdown: { source: 'supplied-cursor', operations: [], operators: [] }, execute
  }).where({ status: 'paid' }).where('total', 'gte', 100).select('total').all()
}`
      ),
      result: t(
        'Given an original cursor over paid totals 120 and 50, totals returns [{total:120}]. all awaits its actual disposal on success or failure. The empty support declaration keeps all steps client-side.',
        '传入 paid total 为 120、50 的原游标后，totals 返回 [{total:120}]；all 在成功或失败时都等待真实释放，空支持声明使所有步骤在客户端执行。'
      )
    },
    {
      title: t(
        'Stream the three smallest totals with a bounded heap',
        '用有界堆流式读取最小的三个金额'
      ),
      problem: t(
        'An entity list needs comparator ordering without materializing every source row. The explicit limit bounds retained candidates.',
        '实体列表需要比较器排序，却不应物化全部源记录；显式上限约束保留的候选数量。'
      ),
      example: t(
        `import { createRecordQuery, type IRecordQuerySource } from '@migaia/storage-contract'
function smallest(execute: IRecordQuerySource['execute']) {
  return createRecordQuery<{ total: number }>({
    pushdown: { source: 'supplied-cursor', operations: [], operators: [] }, execute
  }).orderByComparator((left, right) => left.total - right.total).limit(3).stream()
}`,
        `import { createRecordQuery, type IRecordQuerySource } from '@migaia/storage-contract'
function smallest(execute: IRecordQuerySource['execute']) {
  return createRecordQuery<{ total: number }>({
    pushdown: { source: 'supplied-cursor', operations: [], operators: [] }, execute
  }).orderByComparator((left, right) => left.total - right.total).limit(3).stream()
}`
      ),
      result: t(
        'Given totals 8, 2, 5 and 1, the returned real storage iterator yields 1, 2 and 5. Equal totals retain source order; iterator cleanup stays with the original source owner.',
        '源金额为 8、2、5、1 时，返回的真实存储迭代器依次产出 1、2、5；同金额保留源顺序，清理仍由原数据源 owner 负责。'
      )
    },
    {
      title: t('Continue a keyset page without an offset', '通过键集继续分页'),
      problem: t(
        'Keep continuity after deleting prior-page rows using the original query and source identity.',
        '删除前页记录后，通过原查询与数据源身份保持连续。'
      ),
      example: t(
        `import { createRecordQuery, type IRecordQuerySource } from '@migaia/storage-contract'
async function pages(source: IRecordQuerySource) {
  const query = createRecordQuery<{ id: string }>(source)
  const first = await query.page(2)
  const second = first.next ? await query.after(first.next).limit(2).all() : []
  return [first.items, second]
}`,
        `import { createRecordQuery, type IRecordQuerySource } from '@migaia/storage-contract'
async function pages(source: IRecordQuerySource) {
  const query = createRecordQuery<{ id: string }>(source)
  const first = await query.page(2)
  const second = first.next ? await query.after(first.next).limit(2).all() : []
  return [first.items, second]
}`
      ),
      result: t(
        'With canonical keys a,b,c,d, returns pages a,b and c,d. A different source, condition or ordering rejects before new I/O.',
        '规范键为 a,b,c,d 时返回 a,b 与 c,d 两页；源、条件或排序不匹配在新 I/O 前拒绝。'
      )
    }
  ],
  compileStorageQueryCondition: [
    {
      title: t(
        'Filter native candidates with the original canonical AST',
        '用原规范 AST 过滤原生候选'
      ),
      problem: t(
        'A native source receives canonical conditions and must not duplicate query operators.',
        '原生数据源收到规范条件，不应复制查询操作符。'
      ),
      example: t(
        `import { compileStorageQueryCondition, type IQueryCondition } from '@migaia/storage-contract'
function matching(conditions: readonly IQueryCondition[], rows: readonly { total: number }[]) {
  const tests = conditions.map((condition) => compileStorageQueryCondition<{ total: number }>(condition))
  return rows.filter((row) => tests.every((test) => test(row)))
}`,
        `import { compileStorageQueryCondition, type IQueryCondition } from '@migaia/storage-contract'
function matching(conditions: readonly IQueryCondition[], rows: readonly { total: number }[]) {
  const tests = conditions.map((condition) => compileStorageQueryCondition<{ total: number }>(condition))
  return rows.filter((row) => tests.every((test) => test(row)))
}`
      ),
      result: t(
        'Uses only the source-supplied canonical conditions and the existing predicate compiler.',
        '仅使用 source 已提供的规范条件与现有谓词 compiler。'
      )
    }
  ],
  compileStorageWhere: [
    {
      title: t(
        'Compile one business condition before scanning candidates',
        '扫描候选前编译一次业务条件'
      ),
      problem: t(
        'A prefix candidate stream needs the same declarative semantics without constructing another query or rebuilding membership lists per row.',
        '有序前缀候选流需要相同声明语义，不应另建查询或逐行重建成员列表。'
      ),
      example: t(
        "import { compileStorageWhere } from '@migaia/storage-contract'\nconst accepts = compileStorageWhere<{ status: string; total: number }>({\n  status: 'paid', total: { gte: 100 }\n})\nconst rows = [{ status: 'paid', total: 120 }, { status: 'paid', total: 50 }]\nconsole.log(rows.filter(accepts).length) // 1",
        "import { compileStorageWhere } from '@migaia/storage-contract'\nconst accepts = compileStorageWhere<{ status: string; total: number }>({\n  status: 'paid', total: { gte: 100 }\n})\nconst rows = [{ status: 'paid', total: 120 }, { status: 'paid', total: 50 }]\nconsole.log(rows.filter(accepts).length) // 1"
      ),
      result: t(
        'Prints 1. Only the paid row with total at least 100 matches; compilation reads no storage.',
        '输出 1；仅 total 至少 100 的 paid 记录匹配，编译不读取存储。'
      )
    }
  ],
  createTransactionBuilder: [
    {
      title: t('Declare locks without starting a transaction', '声明锁而不提前启动事务'),
      problem: t(
        'Independent builder branches must not copy old lock prefixes or start operation deadlines during configuration.',
        '独立 builder 分支不能反复复制旧锁前缀，也不能在配置期间启动操作期限。'
      ),
      example: t(
        `import { createTransactionBuilder, lockKey, type IRecordStore } from '@migaia/storage-contract'
function readLocked(store: IRecordStore<{ count: number }>) {
  return createTransactionBuilder(store, { pageSize: 50 })
    .lock(lockKey.record('counter')).timeout(2_000)
    .run(tx => tx.getRecord('counter'))
}`,
        `import { createTransactionBuilder, lockKey, type IRecordStore } from '@migaia/storage-contract'
function readLocked(store: IRecordStore<{ count: number }>) {
  return createTransactionBuilder(store, { pageSize: 50 })
    .lock(lockKey.record('counter')).timeout(2_000)
    .run(tx => tx.getRecord('counter'))
}`
      ),
      result: t(
        'The supplied registered store starts one transaction at run, returning its original Promise. The scope remains that store’s complete native scope.',
        '所提供登记 store 在 run 时启动一次事务，返回原 Promise；scope 保留该 store 的完整原生结构。'
      )
    },
    {
      title: t('Expose an original native optimistic transaction', '公开原生乐观事务'),
      problem: t(
        'A native backend with no physical key locks must reuse the original builder without exposing lock or creating another policy loop.',
        '没有物理键锁的原生后端须复用原 builder，不公开 lock，也不创建第二策略循环。'
      ),
      example: t(
        `import { createTransactionBuilder, ConcurrencyPolicy, type IRecordStore } from '@migaia/storage-contract'
function readNative(store: IRecordStore<{ count: number }>) {
  return createTransactionBuilder(store, undefined, undefined, { mode: 'optimistic' })
    .concurrency(ConcurrencyPolicy.optimistic({ retries: 1 })).timeout(2_000)
    .run(tx => tx.getRecord('counter'))
}`,
        `import { createTransactionBuilder, ConcurrencyPolicy, type IRecordStore } from '@migaia/storage-contract'
function readNative(store: IRecordStore<{ count: number }>) {
  return createTransactionBuilder(store, undefined, undefined, { mode: 'optimistic' })
    .concurrency(ConcurrencyPolicy.optimistic({ retries: 1 })).timeout(2_000)
    .run(tx => tx.getRecord('counter'))
}`
      ),
      result: t(
        'Run receives the original scope and returns the original Promise. Native fields are preserved, no lock option is injected, and wait/fail policies reject synchronously with UNSUPPORTED_CAPABILITY.',
        'run 接收原 scope、返回原 Promise，保留原生字段，不注入 lock 选项；wait/fail 策略同步报 UNSUPPORTED_CAPABILITY。'
      )
    }
  ],
  createStorageIteratorLifetime: [
    {
      title: t('Share native cursor cleanup', '共享原生游标清理'),
      problem: t(
        'A native backend needs the existing accepted-advance drain and two cleanup Promises without another resource owner.',
        '原生后端需要既有接纳推进排空与双清理 Promise，不能另建资源 owner。'
      ),
      example: t(
        `import { createStorageIteratorLifetime } from '@migaia/storage-contract'
let closed = 0
const lifetime = createStorageIteratorLifetime<number>({
  close: async () => { closed += 1 }, report: console.error
})
await lifetime.advance(async () => ({ done: false, value: 1 }))
const cleanup = lifetime.dispose()
console.log(cleanup === lifetime.dispose()) // true
await cleanup
console.log(closed) // 1`,
        `import { createStorageIteratorLifetime } from '@migaia/storage-contract'
let closed = 0
const lifetime = createStorageIteratorLifetime<number>({
  close: async () => { closed += 1 }, report: console.error
})
await lifetime.advance(async () => ({ done: false, value: 1 }))
const cleanup = lifetime.dispose()
console.log(cleanup === lifetime.dispose()) // true
await cleanup
console.log(closed) // 1`
      ),
      result: t(
        'Prints true and 1. The original backend must still check admission before advance and register native transaction iterators with its original scope.',
        '输出 true 与 1；原后端仍须在 advance 前检查准入，并把原生事务迭代器登记到原 scope。'
      )
    }
  ],
  runWithConcurrency: [
    {
      title: t(
        'Compose a real backend with the original policy owner',
        '把真实后端接到原策略 owner'
      ),
      problem: t(
        'Backend and persist composition must retain native option fields without adding a second retry loop or restarting operation deadlines.',
        '后端与 persist 组合须保留原生选项字段，不能另建重试循环或重开操作期限。'
      ),
      example: t(
        `import { runWithConcurrency, type IStorageBase, type ITransactionOptions, type IConcurrencyPort } from '@migaia/storage-contract'
async function execute(store: IStorageBase, options: ITransactionOptions, port: IConcurrencyPort<boolean>) {
  return runWithConcurrency({ store, options }, port)
}`,
        `import { runWithConcurrency, type IStorageBase, type ITransactionOptions, type IConcurrencyPort } from '@migaia/storage-contract'
async function execute(store: IStorageBase, options: ITransactionOptions, port: IConcurrencyPort<boolean>) {
  return runWithConcurrency({ store, options }, port)
}`
      ),
      result: t(
        'The function returns the real port’s committed boolean. The caller supplies the registered original store and original options or exact outer attempt; the loop captures policy once.',
        '函数返回真实 port 的提交布尔值。调用方提供原登记 store 与原选项或精确外层 attempt；循环只捕获一次策略。'
      )
    }
  ],
  prefixStorageOrgKey: [
    {
      title: t('Preserve tuple keys inside an organization segment', '在组织段内保留元组键'),
      problem: t(
        'Scalar and tuple keys must retain distinct identities when a physical backend adds organization isolation.',
        '物理后端添加组织隔离时，标量与元组键必须保持不同身份。'
      ),
      example: t(
        `import { prefixStorageOrgKey, unprefixStorageOrgKey } from '@migaia/storage-contract'
const orgId = '00000000-0000-0000-0000-000000000000'
const wrapped = prefixStorageOrgKey(orgId, ['orders', 1])
console.log(JSON.stringify(wrapped))
console.log(JSON.stringify(unprefixStorageOrgKey(orgId, wrapped)))
// ["$o","00000000-0000-0000-0000-000000000000",["orders",1]]
// ["orders",1]`,
        `import { prefixStorageOrgKey, unprefixStorageOrgKey } from '@migaia/storage-contract'
const orgId = '00000000-0000-0000-0000-000000000000'
const wrapped = prefixStorageOrgKey(orgId, ['orders', 1])
console.log(JSON.stringify(wrapped))
console.log(JSON.stringify(unprefixStorageOrgKey(orgId, wrapped)))
// ["$o","00000000-0000-0000-0000-000000000000",["orders",1]]
// ["orders",1]`
      ),
      result: t(
        'Prints the three-part physical envelope followed by the original tuple; no backend runs.',
        '先输出三项物理封装，再输出原元组；不运行后端。'
      )
    }
  ],
  unprefixStorageOrgKey: [
    {
      title: t(
        'Reject another organization before returning a logical key',
        '返回逻辑键前拒绝其他组织'
      ),
      problem: t(
        'Reading a physical key from another organization must not expose its logical key through this boundary.',
        '从其他组织取得的物理键不能经此边界暴露逻辑键。'
      ),
      example: t(
        `import { prefixStorageOrgKey, unprefixStorageOrgKey, StorageContractError } from '@migaia/storage-contract'
const first = '12345678-1234-1234-1234-123456789abc'
const second = '12345678-1234-1234-1234-123456789abd'
try { unprefixStorageOrgKey(second, prefixStorageOrgKey(first, 'orders')) }
catch (error) { if (!(error instanceof StorageContractError)) throw error; console.log(error.code) }
// INVALID_ARGUMENT`,
        `import { prefixStorageOrgKey, unprefixStorageOrgKey, StorageContractError } from '@migaia/storage-contract'
const first = '12345678-1234-1234-1234-123456789abc'
const second = '12345678-1234-1234-1234-123456789abd'
try { unprefixStorageOrgKey(second, prefixStorageOrgKey(first, 'orders')) }
catch (error) { if (!(error instanceof StorageContractError)) throw error; console.log(error.code) }
// INVALID_ARGUMENT`
      ),
      result: t(
        'Prints INVALID_ARGUMENT; the original envelope is not changed.',
        '输出 INVALID_ARGUMENT；原封装不变。'
      )
    }
  ],
  snapshotStorageBaseDetailed: [
    {
      title: t('Keep failed base admission inspectable', '基础准入失败仍可检查原错'),
      problem: t(
        'A plugin getter can fail before resource ownership transfers. Admission must retain that exact failure without attempting cleanup.',
        '插件 getter 可在资源所有权转移前失败。准入必须保留精确原错，不尝试清理。'
      ),
      example: t(
        `import { snapshotStorageBaseDetailed } from '@migaia/storage-contract'
const original = new Error('backend getter failed')
const candidate = { get backend(): never { throw original } }
const result = snapshotStorageBaseDetailed(candidate)
console.log(result.valid, !result.valid && result.cause === original)
// false true`,
        `import { snapshotStorageBaseDetailed } from '@migaia/storage-contract'
const original = new Error('backend getter failed')
const candidate = { get backend(): never { throw original } }
const result = snapshotStorageBaseDetailed(candidate)
console.log(result.valid, !result.valid && result.cause === original)
// false true`
      ),
      result: t(
        'Prints false true; no resource method is called.',
        '输出 false true；不调用资源方法。'
      )
    }
  ],
  runTransactionOperation: [
    {
      title: t('Reject a forged transaction before work starts', '在工作前拒绝伪造事务'),
      problem: t(
        'Copied method names are not transaction authority. A composed operation must be admitted by its original private owner.',
        '复制方法名不是事务权限；组合操作必须由原私有拥有者接纳。'
      ),
      example: t(
        `import { runTransactionOperation, StorageContractError } from '@migaia/storage-contract'
let calls = 0
try { runTransactionOperation({}, () => { calls += 1 }) }
catch (error) { if (!(error instanceof StorageContractError)) throw error; console.log(error.code, calls) }
// INVALID_ARGUMENT 0`,
        `import { runTransactionOperation, StorageContractError } from '@migaia/storage-contract'
let calls = 0
try { runTransactionOperation({}, () => { calls += 1 }) }
catch (error) { if (!(error instanceof StorageContractError)) throw error; console.log(error.code, calls) }
// INVALID_ARGUMENT 0`
      ),
      result: t(
        'Prints INVALID_ARGUMENT 0; the callback never starts.',
        '输出 INVALID_ARGUMENT 0；回调没有开始。'
      )
    }
  ],
  lockKey: [
    {
      title: t(
        'Capture mutable lock identity before the caller changes it',
        '在调用方修改前捕获可变锁身份'
      ),
      problem: t(
        'A transaction may be configured before it starts. A changed Date must not silently select a different physical lock.',
        '事务可先配置再开始；Date 被修改后不能悄然选择另一把物理锁。'
      ),
      example: t(
        `import { lockKey } from '@migaia/storage-contract'
const original = new Date(0)
const saved = lockKey.record(original)
original.setTime(1_000)
console.log(saved.channel, saved.key instanceof Date && saved.key.getTime())
// record 0`,
        `import { lockKey } from '@migaia/storage-contract'
const original = new Date(0)
const saved = lockKey.record(original)
original.setTime(1_000)
console.log(saved.channel, saved.key instanceof Date && saved.key.getTime())
// record 0`
      ),
      result: t(
        'Prints record 0; the original Date remains caller-owned and no lock is acquired.',
        '输出 record 0；原 Date 仍由调用方持有，没有取得锁。'
      )
    }
  ],
  defineConcurrencyPolicy: [
    {
      title: t('Capture a genuine policy without executing it', '捕获真实策略而不执行'),
      problem: t(
        'A backend needs an immutable policy identity before opening resources; copying metadata must not copy decision authority.',
        '后端须在打开资源前捕获不可变策略身份；复制元数据不能复制决策权限。'
      ),
      example: t(
        `import { defineConcurrencyPolicy, ConcurrencyPolicy } from '@migaia/storage-contract'
let calls = 0
const custom = defineConcurrencyPolicy({ name: 'custom', locking: 'pessimistic', decide: () => { calls += 1; return { action: 'reject' } } })
console.log(custom.name, Object.isFrozen(custom), calls, ConcurrencyPolicy.optimistic().locking)
// custom true 0 optimistic`,
        `import { defineConcurrencyPolicy, ConcurrencyPolicy } from '@migaia/storage-contract'
let calls = 0
const custom = defineConcurrencyPolicy({ name: 'custom', locking: 'pessimistic', decide: () => { calls += 1; return { action: 'reject' } } })
console.log(custom.name, Object.isFrozen(custom), calls, ConcurrencyPolicy.optimistic().locking)
// custom true 0 optimistic`
      ),
      result: t(
        'Prints custom true 0 optimistic. No callback, transaction or lock is executed.',
        '输出 custom true 0 optimistic，不执行回调、事务或锁。'
      )
    }
  ],
  defineStorageCapability: [
    {
      title: t('Keep equal capability names independent', '同名能力仍保持独立身份'),
      problem: t(
        'Two backend authors may choose the same diagnostic name. A name cannot grant runtime access to the other author’s API; only the authentic token identity can select an implementation.',
        '两个后端作者可能选择同一诊断名称。名称不能授予另一个作者 API 的运行权限；只有真实令牌身份才能选择实现。'
      ),
      example: t(
        `import { defineStorageCapability, implement } from '@migaia/storage-contract'
const first = defineStorageCapability<{ read(): string }>()('catalog')
const second = defineStorageCapability<{ read(): string }>()('catalog')
const api = { read: () => 'value' }
const descriptor = implement(first, api)
console.log(first !== second, Object.isFrozen(first), Object.isFrozen(descriptor), descriptor.api === api)
// true true true true`,
        `import { defineStorageCapability, implement } from '@migaia/storage-contract'
const first = defineStorageCapability<{ read(): string }>()('catalog')
const second = defineStorageCapability<{ read(): string }>()('catalog')
const api = { read: () => 'value' }
const descriptor = implement(first, api)
console.log(first !== second, Object.isFrozen(first), Object.isFrozen(descriptor), descriptor.api === api)
// true true true true`
      ),
      result: t(
        'Prints true true true true. No backend is opened and the implementation API is retained by identity.',
        '输出 true true true true。不打开后端，并保留实现 API 引用。'
      )
    }
  ],
  createMigrationPlan: [
    {
      title: t(
        'Reject gaps and future archives while preserving migration errors',
        '拒绝断档与未来存档并保留迁移原错'
      ),
      problem: t(
        'A persistence reader must reject incomplete plans at creation and avoid applying older code to a newer archive. Conversion failures must retain the original error identity.',
        '持久化读取器必须在创建时拒绝不完整计划，避免旧代码处理未来存档，并保留转换原错身份。'
      ),
      example: t(
        `import { createMigrationPlan, migrateEnvelopeSync, StorageContractError } from '@migaia/storage-contract'
try {
  createMigrationPlan({ version: 3, steps: { 1: value => value, 3: value => value } })
} catch (error) {
  if (!(error instanceof StorageContractError)) throw error
  console.log(error.code) // MIGRATION_GAP
}
const plan = createMigrationPlan({ version: 1, reset: () => ({}) })
try {
  migrateEnvelopeSync(plan, { version: 2, state: {} })
} catch (error) {
  if (!(error instanceof StorageContractError)) throw error
  console.log(error.code) // VERSION_UNSUPPORTED
}
const originalError = new Error('upgrade failed')
const failing = createMigrationPlan({ version: 1, steps: { 1: () => { throw originalError } } })
try {
  migrateEnvelopeSync(failing, { version: 0, state: {} })
} catch (error) {
  if (!(error instanceof StorageContractError)) throw error
  console.log(error.code, error.cause === originalError) // MIGRATION_FAILED true
}`,
        `const plan = createMigrationPlan({ version: 1, steps: { 1: value => ({ previous: value }) } })
console.log(migrateEnvelopeSync(plan, { version: 0, state: 'old' })) // { previous: 'old' }`
      ),
      result: t(
        'The complete example prints MIGRATION_GAP, VERSION_UNSUPPORTED and MIGRATION_FAILED true. No storage writes occur; current-version state identity is preserved.',
        '完整示例依次输出 MIGRATION_GAP、VERSION_UNSUPPORTED 与 MIGRATION_FAILED true。不会写存储；同版状态保留原引用。'
      )
    }
  ],
  encodeOrderedStorageKey: [
    {
      title: t('Preserve nested key prefix order', '保留嵌套键前缀顺序'),
      problem: t(
        'Record indexes and locks must share the existing key order, including UTF-16 and nested prefixes.',
        '记录索引与锁须共用现有键顺序，包含 UTF-16 与嵌套前缀。'
      ),
      example: t(
        `import { encodeOrderedStorageKey } from '@migaia/storage-contract'
console.log([...encodeOrderedStorageKey([''], 'memory')].join(','))
// 5,3,0,0`,
        `import { encodeOrderedStorageKey } from '@migaia/storage-contract'
console.log([...encodeOrderedStorageKey([''], 'memory')].join(','))
// 5,3,0,0`
      ),
      result: t(
        'Prints 5,3,0,0; the output has its own buffer.',
        '输出 5,3,0,0；结果持有独立缓冲区。'
      )
    }
  ],
  snapshotStorageKey: [
    {
      title: t('Capture a composite key before its owner changes it', '在调用方修改前捕获复合键'),
      problem: t(
        'An async operation still holds a caller’s array, Date and buffer. Before that operation uses its key, another part of the application changes the original date and bytes, so the operation can address a different record.\n\nA shallow array copy creates a new outer array but leaves the Date and buffer shared. Saving the array alone therefore does not capture the logical key at admission time.\n\nCall `snapshotStorageKey()` before passing the key to asynchronous work. It validates and recursively copies these components, then validates the copy. The returned key is detached, not frozen; keep that copy private until the operation finishes.',
        '异步操作仍引用调用方的数组、日期和缓冲区。操作尚未使用键时，应用的另一部分已经修改日期与字节，后续操作可能指向另一条记录。\n\n浅拷贝只会创建外层数组，日期和缓冲区仍与原键共享。因此，保存一份数组并没有捕获接纳操作时的完整逻辑键。\n\n把键交给异步操作之前调用 `snapshotStorageKey()`。它先校验，再递归复制这些组件，最后校验副本；结果与原键分离，但没有冻结，操作结束前应自行保管副本。'
      ),
      example: t(
        "import { snapshotStorageKey } from '@migaia/storage-contract'\n\nconst date = new Date(0)\nconst bytes = new Uint8Array([7, 8])\nconst original: [string, Date, ArrayBuffer] = ['orders', date, bytes.buffer]\nconst saved = snapshotStorageKey(original, 'memory') as readonly [string, Date, ArrayBuffer]\noriginal[0] = 'changed'\ndate.setTime(1000)\nbytes[0] = 99\nconsole.log('original:', original[0], date.getTime(), bytes[0])\nconsole.log('snapshot:', saved[0], saved[1].getTime(), new Uint8Array(saved[2])[0])\nconsole.log('separate array:', saved !== original)",
        "import { snapshotStorageKey } from '@migaia/storage-contract'\n\nconst date = new Date(0)\nconst bytes = new Uint8Array([7, 8])\nconst original: [string, Date, ArrayBuffer] = ['orders', date, bytes.buffer]\nconst saved = snapshotStorageKey(original, 'memory') as readonly [string, Date, ArrayBuffer]\noriginal[0] = 'changed'\ndate.setTime(1000)\nbytes[0] = 99\nconsole.log('原键:', original[0], date.getTime(), bytes[0])\nconsole.log('快照:', saved[0], saved[1].getTime(), new Uint8Array(saved[2])[0])\nconsole.log('独立数组:', saved !== original)"
      ),
      result: t(
        'Prints `original: changed 1000 99`, `snapshot: orders 0 7`, then `separate array: true`.\n\nMutation of the original array, Date and bytes does not change the captured key. The caller still owns the mutable snapshot; keep it private for the duration of the operation. This helper captures a key and does not submit a storage operation.',
        '依次输出 `原键: changed 1000 99`、`快照: orders 0 7`、`独立数组: true`。\n\n修改原数组、日期与字节都没有改变已捕获的键。调用方仍持有可变快照，操作期间应自行保管它；这个工具只捕获键，不会发起存储操作。'
      )
    },
    {
      title: t(
        'Reject an object before treating it as a record key',
        '把普通对象作为记录键前先拒绝'
      ),
      problem: t(
        'An application passes a plain object as a record key and only discovers the mistake after backend work starts. The failure then arrives far from the code that chose the key.\n\nConverting any object to a string is not a substitute for key validation: different objects can produce the same string and address the same record. A record key must belong to the supported key domain.\n\nCall `snapshotStorageKey()` at the boundary. It rejects this object with `INVALID_KEY`, retaining the backend label, original value and typed cause. Choose a supported key such as an array of its scalar fields instead.',
        '应用把普通对象当作记录键，直到后端开始工作才发现错误。失败位置因此远离最初选择键的代码。\n\n把任意对象转成字符串不能替代键校验：不同对象可能得到相同字符串，最终指向同一条记录。记录键需要符合约定的键类型。\n\n在入口调用 `snapshotStorageKey()`。它以 `INVALID_KEY` 拒绝这个对象，并保留后端标签、原值与类型错误原因；应改用由标量字段组成的数组等有效键。'
      ),
      example: t(
        "import { snapshotStorageKey, StorageContractError } from '@migaia/storage-contract'\n\nconst candidate = { orderId: 1 }\ntry {\n  snapshotStorageKey(candidate, 'memory', 'orderKey')\n} catch (error) {\n  if (!(error instanceof StorageContractError)) throw error\n  console.log('code:', error.code)\n  console.log('backend:', error.backend)\n  console.log('original key:', (error.key as unknown) === candidate)\n  console.log('typed cause:', error.cause instanceof TypeError)\n}",
        "import { snapshotStorageKey, StorageContractError } from '@migaia/storage-contract'\n\nconst candidate = { orderId: 1 }\ntry {\n  snapshotStorageKey(candidate, 'memory', 'orderKey')\n} catch (error) {\n  if (!(error instanceof StorageContractError)) throw error\n  console.log('错误码:', error.code)\n  console.log('后端:', error.backend)\n  console.log('原始键:', (error.key as unknown) === candidate)\n  console.log('类型原因:', error.cause instanceof TypeError)\n}"
      ),
      result: t(
        'Prints `code: INVALID_KEY`, `backend: memory`, `original key: true`, then `typed cause: true`.\n\nThis invalid object is rejected synchronously and remains reachable as `error.key`; this helper does not call a storage backend. For a channel whose keys must be strings, use `assertStringStorageKey()` instead of accepting the wider record-key domain.',
        '依次输出 `错误码: INVALID_KEY`、`后端: memory`、`原始键: true`、`类型原因: true`。\n\n这个无效对象在同步调用时被拒绝，仍可通过 `error.key` 找到；函数没有调用存储后端。通道只允许字符串键时，应使用 `assertStringStorageKey()`，而不是接纳更宽的记录键类型。'
      )
    }
  ],
  snapshotOperationContext: [
    {
      title: t(
        'Read operation options once without claiming to execute cancellation',
        '只读取一次操作选项，把取消执行留给后端'
      ),
      problem: t(
        'Options supplied through getters can change between validation and use. One storage layer may validate a timeout while another later reads a different timeout or write policy.\n\nRe-reading the original object at each layer repeats those getters. Copying selected fields in several places also leaves no shared indication that admission has already captured the values.\n\nPass `snapshotOperationContext()` the original options once, then pass its result inward. It captures the operation fields, including optional orgId, and freezes their record; passing that snapshot back reuses its identity. An already-aborted signal is accepted because the helper validates intent only; the backend implements cancellation and timeouts.',
        '通过访问器提供的选项可能在校验和使用之间变化。存储的一层校验了某个超时，另一层稍后却可能读到不同的超时或写入策略。\n\n各层继续读取原对象，就会重复触发访问器。各自复制几个字段也无法共同识别这些值是否已经在接纳操作时捕获。\n\n先把原选项交给 `snapshotOperationContext()`，再向内传递返回值。它只读取一次操作字段（包括可选 orgId）并冻结记录，再次传入该快照会复用同一对象；已取消的信号也可接纳，因为工具只校验意图，实际取消和超时由后端执行。'
      ),
      example: t(
        "import { snapshotOperationContext } from '@migaia/storage-contract'\n\nconst controller = new AbortController()\ncontroller.abort()\nlet reads = 0\nconst options = {\n  get signal() { reads += 1; return controller.signal },\n  get timeoutMs() { reads += 1; return 0 },\n  get pageSize() { reads += 1; return 100 },\n  get conflictPolicy() { reads += 1; return 'replace' as const }\n}\nconst snapshot = snapshotOperationContext(options)\nconsole.log('frozen:', Object.isFrozen(snapshot))\nconsole.log('same snapshot:', snapshotOperationContext(snapshot) === snapshot)\nconsole.log('field reads:', reads)\nconsole.log('signal aborted:', snapshot?.signal?.aborted)\nconsole.log('options:', snapshot?.timeoutMs, snapshot?.pageSize, snapshot?.conflictPolicy)",
        "import { snapshotOperationContext } from '@migaia/storage-contract'\n\nconst controller = new AbortController()\ncontroller.abort()\nlet reads = 0\nconst options = {\n  get signal() { reads += 1; return controller.signal },\n  get timeoutMs() { reads += 1; return 0 },\n  get pageSize() { reads += 1; return 100 },\n  get conflictPolicy() { reads += 1; return 'replace' as const }\n}\nconst snapshot = snapshotOperationContext(options)\nconsole.log('冻结:', Object.isFrozen(snapshot))\nconsole.log('复用快照:', snapshotOperationContext(snapshot) === snapshot)\nconsole.log('字段读取次数:', reads)\nconsole.log('信号已取消:', snapshot?.signal?.aborted)\nconsole.log('选项:', snapshot?.timeoutMs, snapshot?.pageSize, snapshot?.conflictPolicy)"
      ),
      result: t(
        'Prints `frozen: true`, `same snapshot: true`, `field reads: 4`, `signal aborted: true`, then `options: 0 100 replace`.\n\nEach field is read once across both calls; validation preserves the original signal and accepts zero timeout. No timer or abort subscription is created. Omitted fields remain `undefined`; freezing the record does not freeze or replace the live signal.',
        '依次输出 `冻结: true`、`复用快照: true`、`字段读取次数: 4`、`信号已取消: true`、`选项: 0 100 replace`。\n\n两次调用合计每字段只读取一次，保留原信号且允许零超时；函数没有建立定时器或取消订阅。省略字段保留为 `undefined`，冻结记录不会冻结或替换仍在变化的信号。'
      )
    }
  ],
  createVectorQuery: [
    {
      title: t('Bind a native ranked source to the shared query', '把原生排名数据源接入共享查询'),
      problem: t(
        'Keep filtering before native ranking while using one shared client reader.',
        '原生排名前过滤，并复用同一个客户端读取器。'
      ),
      example: t(
        "import { createVectorQuery, type IVectorQuerySource } from '@migaia/storage-contract'\nfunction ranked(execute: IVectorQuerySource<{ enabled: boolean }>['execute']) {\n  const builder = createVectorQuery({ pushdown: { source: 'engine', index: 'ann', operators: ['eq'], operations: ['where', 'topK', 'minScore'] }, execute })\n  return [builder.topK(1), builder.where({ enabled: true }).topK(5), builder.withVector().minScore(0.5).topK(3)]\n}\n// Each result uses the supplied native cursor; construction performs no I/O.",
        "import { createVectorQuery, type IVectorQuerySource } from '@migaia/storage-contract'\nfunction ranked(execute: IVectorQuerySource<{ enabled: boolean }>['execute']) {\n  const builder = createVectorQuery({ pushdown: { source: 'engine', index: 'ann', operators: ['eq'], operations: ['where', 'topK', 'minScore'] }, execute })\n  return [builder.topK(1), builder.where({ enabled: true }).topK(5), builder.withVector().minScore(0.5).topK(3)]\n}\n// 每个结果复用提供的原生游标；构建不执行 I/O。"
      ),
      result: t(
        'Returns three independent bounded queries; only withVector adds vector to its hit type.',
        '返回三条独立有界查询，只有 withVector 在命中类型中加入 vector。'
      )
    }
  ],
  createRdfQuery: [
    {
      title: t('Traverse after a client predicate', '在客户端谓词之后遍历'),
      problem: t(
        'Keep one original ground-match backend while a function predicate creates a client boundary.',
        '函数谓词形成客户端边界时，继续复用原 ground-match 后端。'
      ),
      example: t(
        `import { createRdfQuery, term, type IRdfQuerySource } from '@migaia/storage-contract'
function next(source: IRdfQuerySource) {
  return createRdfQuery(source, { subject: term.iri('urn:a') })
    .where((quad) => quad.object.termType === 'NamedNode')
    .follow(term.iri('urn:knows'), term.iri('urn:c')).limit(1).all()
}`,
        `import { createRdfQuery, term, type IRdfQuerySource } from '@migaia/storage-contract'
function next(source: IRdfQuerySource) {
  return createRdfQuery(source, { subject: term.iri('urn:a') })
    .where((quad) => quad.object.termType === 'NamedNode')
    .follow(term.iri('urn:knows'), term.iri('urn:c')).limit(1).all()
}`
      ),
      result: t(
        'Uses the supplied native ground matcher for the next subject and same graph, closing the child cursor before the root cursor.',
        '用所提供的原生 ground matcher 匹配下一 subject 与同 graph，先关闭子游标，再关闭根游标。'
      )
    },
    {
      title: t('Bind ground RDF traversal to its original cursor', '把 ground RDF 遍历接入原游标'),
      problem: t(
        'Capture ground patterns and pass ordered native traversal steps without another query runner.',
        '捕获 ground pattern，传递有序原生遍历步骤，不建立另一查询执行器。'
      ),
      example: t(
        "import { createRdfQuery, term, type IRdfQuerySource } from '@migaia/storage-contract'\nfunction linked(execute: IRdfQuerySource['execute']) {\n  const source = { pushdown: { source: 'rdf', operators: [], operations: ['follow', 'inverse'] as const }, execute }\n  return [createRdfQuery(source, {}), createRdfQuery(source, { subject: term.iri('urn:a') }).follow(term.iri('urn:knows')), createRdfQuery(source, { graph: term.defaultGraph }).inverse(term.iri('urn:parent'))]\n}\n// Construction only captures immutable patterns and steps.",
        "import { createRdfQuery, term, type IRdfQuerySource } from '@migaia/storage-contract'\nfunction linked(execute: IRdfQuerySource['execute']) {\n  const source = { pushdown: { source: 'rdf', operators: [], operations: ['follow', 'inverse'] as const }, execute }\n  return [createRdfQuery(source, {}), createRdfQuery(source, { subject: term.iri('urn:a') }).follow(term.iri('urn:knows')), createRdfQuery(source, { graph: term.defaultGraph }).inverse(term.iri('urn:parent'))]\n}\n// 构建仅捕获不可变 pattern 与步骤。"
      ),
      result: t(
        'Returns match, forward and inverse queries with the original native resource owner.',
        '返回 match、正向与反向查询，保留原生资源 owner。'
      )
    }
  ],
  fromValueCodec: [
    {
      title: t('Adapt the shared collection codec for storage', '把共享集合 codec 适配到存储'),
      problem: t(
        'Storage must use one serialize-owned value format. The adapter maps metadata to a storage route while retaining independent encode and decode input domains.',
        '存储应使用 serialize 唯一拥有的值格式。适配器将元数据映射到存储路由，并独立保留 encode 与 decode 的输入类型。'
      ),
      example: t(
        "import { fromValueCodec } from '@migaia/storage-contract'\nimport { defineCollectionsJsonCodec } from '@migaia/serialize/codecs/collections-json'\nconst codec = fromValueCodec(defineCollectionsJsonCodec({ version: 1 }))\nconst raw = await codec.encode(new Map([['Ada', new Set(['read', 'write'])]]))\nconst restored = await codec.decode(raw)\nconsole.log(codec.name, codec.output, restored instanceof Map)\n// collections-json@1 text true",
        "import { fromValueCodec } from '@migaia/storage-contract'\nimport { defineCollectionsJsonCodec } from '@migaia/serialize/codecs/collections-json'\nconst codec = fromValueCodec(defineCollectionsJsonCodec({ version: 1 }))\nconst raw = await codec.encode(new Map([['Ada', new Set(['read', 'write'])]]))\nconst restored = await codec.decode(raw)\nconsole.log(codec.name, codec.output, restored instanceof Map)\n// collections-json@1 text true"
      ),
      result: t(
        'Prints collections-json@1 text true. Serialize owns Map/Set revival; adaptation adds no second parser, clone or storage write.',
        '输出 collections-json@1 text true。Map/Set 还原由 serialize 拥有；适配不增加第二次解析、克隆或存储写入。'
      )
    }
  ],
  snapshotStorageCapabilities: [
    {
      title: t(
        'Normalize an older capability descriptor before choosing a channel',
        '选择通道前规范化旧版能力描述'
      ),
      problem: t(
        'A provider created before secondary indexes and change feeds were added omits those two capability flags. Application code choosing a channel still needs an explicit answer about whether either operation is supported.\n\nTruthy checks accept invalid field types as well as true booleans. Retaining the original descriptor also lets a later mutation change the facts used by an earlier admission decision.\n\nCall `snapshotStorageCapabilities()` before selecting optional operations. It validates the full descriptor, defaults only the two missing legacy flags to false and returns a separate record whose values are independent of later changes to the original.',
        '二级索引和变更流加入之前创建的提供方没有这两个能力标志。应用选择通道时，仍需要明确知道是否支持这些操作。\n\n只检查真假会把非法字段类型也当成布尔能力。继续持有原描述，又会让后续修改改变先前接纳操作时使用的事实。\n\n选择可选操作前调用 `snapshotStorageCapabilities()`。它校验完整描述，只把这两个旧版缺失标志补为 `false`，并返回独立记录，使捕获的值不受原描述后续修改影响。'
      ),
      example: t(
        "import { snapshotStorageCapabilities } from '@migaia/storage-contract'\n\nconst legacy = {\n  syncRead: true, binary: false, records: false, transactions: false,\n  iteration: false, opaqueEntries: false, maxValueBytes: undefined\n}\nconst snapshot = snapshotStorageCapabilities(legacy)\nlegacy.records = true\nconsole.log('new flags:', snapshot?.secondaryIndexes, snapshot?.changeFeed)\nconsole.log('record capability:', legacy.records, snapshot?.records)\nconsole.log('separate record:', snapshot !== legacy)\nconsole.log('frozen:', Object.isFrozen(snapshot))",
        "import { snapshotStorageCapabilities } from '@migaia/storage-contract'\n\nconst legacy = {\n  syncRead: true, binary: false, records: false, transactions: false,\n  iteration: false, opaqueEntries: false, maxValueBytes: undefined\n}\nconst snapshot = snapshotStorageCapabilities(legacy)\nlegacy.records = true\nconsole.log('新增标志:', snapshot?.secondaryIndexes, snapshot?.changeFeed)\nconsole.log('记录能力:', legacy.records, snapshot?.records)\nconsole.log('独立记录:', snapshot !== legacy)\nconsole.log('冻结:', Object.isFrozen(snapshot))"
      ),
      result: t(
        'Prints `new flags: false false`, `record capability: true false`, `separate record: true`, then `frozen: false`.\n\nThe captured flags retain their admission-time values after the original descriptor changes. Only secondaryIndexes and changeFeed default to false when absent. Invalid shapes or accessor failures return `undefined`; a successful snapshot remains mutable and does not create the declared capabilities.',
        '依次输出 `新增标志: false false`、`记录能力: true false`、`独立记录: true`、`冻结: false`。\n\n原描述修改后，捕获的标志仍保留接纳时的值；只有缺失的 secondaryIndexes 和 changeFeed 默认补为 `false`。形状无效或访问器失败返回 `undefined`，成功快照仍可修改，也不会凭空创建所声明的能力。'
      )
    }
  ],
  StorageContractError: [
    {
      title: t(
        'Keep the original failure when reporting a contract error',
        '报告契约错误时保留原始失败'
      ),
      problem: t(
        'A validation boundary catches a native failure and reports only its message. The caller can read a description but can no longer inspect the original error object or distinguish this package’s classification.\n\nBuilding a new message does not preserve cause identity. Handwritten diagnostic fields also make it easy to omit the source or code, leaving callers dependent on message text.\n\nConstruct `StorageContractError` with the appropriate public code and the exact original cause. It owns the stable source and code fields, retains the native cause link and freezes its own instance after construction.',
        '校验边界捕获原生失败后只报告消息。调用方看得到描述，却无法再检查原始错误对象，也无法识别该包给出的错误分类。\n\n重新拼接消息不会保留原因对象的身份。手写诊断字段也容易遗漏来源或错误码，让调用方只能依赖消息文字判断。\n\n用相应公开错误码及原始 `cause` 构造 `StorageContractError`。它持有稳定的来源和错误码字段，保留原生原因链，并在构造结束后冻结自身。'
      ),
      example: t(
        "import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'\n\nconst cause = new TypeError('invalid page size')\nconst error = new StorageContractError(StorageContractErrorCode.invalidArgument, {\n  backend: 'memory', cause\n})\nconsole.log('source:', error.source)\nconsole.log('code:', error.code)\nconsole.log('backend:', error.backend)\nconsole.log('same cause:', error.cause === cause)\nconsole.log('cause message:', (error.cause as Error).message)\nconsole.log('frozen:', Object.isFrozen(error))",
        "import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'\n\nconst cause = new TypeError('分页大小无效')\nconst error = new StorageContractError(StorageContractErrorCode.invalidArgument, {\n  backend: 'memory', cause\n})\nconsole.log('来源:', error.source)\nconsole.log('错误码:', error.code)\nconsole.log('后端:', error.backend)\nconsole.log('保留原错:', error.cause === cause)\nconsole.log('原错消息:', (error.cause as Error).message)\nconsole.log('冻结:', Object.isFrozen(error))"
      ),
      result: t(
        'Prints `source: @migaia/storage-contract`, `code: INVALID_ARGUMENT`, `backend: memory`, `same cause: true`, `cause message: invalid page size`, then `frozen: true`.\n\nThe native cause is the exact original object. Freezing the error does not freeze the cause object. Omitted details default to an empty object and an omitted message becomes `[storage-contract] INVALID_ARGUMENT` for this code; another package should use its own error identity rather than relabel its failures as storage-contract errors.',
        '依次输出 `来源: @migaia/storage-contract`、`错误码: INVALID_ARGUMENT`、`后端: memory`、`保留原错: true`、`原错消息: 分页大小无效`、`冻结: true`。\n\n原生原因链指向同一个原始对象，冻结错误实例不会冻结原因对象。省略 details 时使用空对象，这个错误码未指定消息时采用 `[storage-contract] INVALID_ARGUMENT`；其他包应使用自己拥有的错误身份，不应把自身失败改称为 storage-contract 错误。'
      )
    }
  ]
}
