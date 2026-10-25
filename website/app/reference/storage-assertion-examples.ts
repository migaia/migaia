import type { ISymbolDoc, IText } from './contract.js'

/** Add a short localized explanation to a complete program shared by both language editions. */
function example(en: string, zh: string, program: string): IText {
  return { en: `// ${en}\n${program}`, zh: `// ${zh}\n${program}` }
}

/** Pure contract examples validate ordinary inputs or inspect definitions without opening storage. */
export const storageAssertionExamples: Readonly<Record<string, string | IText>> = {
  'storage-contract:index:assertConcurrencyPolicy': example(
    'Check a registered policy before using it with an optimistic backend.',
    '在乐观并发后端使用策略之前，先检查它是否为已登记的策略。',
    `import { assertConcurrencyPolicy, defineConcurrencyPolicy } from '@migaia/storage-contract'

const policy = defineConcurrencyPolicy({
  name: 'retry-conflicts',
  locking: 'optimistic',
  decide: () => ({ action: 'retry', delayMs: 25 })
})
assertConcurrencyPolicy(policy, 'optimistic', 'catalog')
console.log(policy.name, policy.locking)`
  ),
  'storage-contract:index:assertLockKey': example(
    'Validate a record key before requesting a lock; this check acquires no lock.',
    '请求锁之前先检查记录键；这一步不会取得锁。',
    `import { assertLockKey } from '@migaia/storage-contract'

const input: unknown = { channel: 'record', key: ['users', 'ada'] }
assertLockKey(input, 'catalog')
console.log(input.channel, input)`
  ),
  'storage-contract:index:assertRdfIri': example(
    'Check an absolute resource address without changing its spelling.',
    '检查资源的绝对地址，并保留它原来的写法。',
    `import { assertRdfIri } from '@migaia/storage-contract'

const address: unknown = 'https://example.com/people/ada'
assertRdfIri(address, 'catalog')
console.log(address)`
  ),
  'storage-contract:index:assertRdfLiteral': example(
    'A language-tagged value uses the RDF language-string datatype.',
    '带语言标签的文本需要使用 RDF 的语言文本类型。',
    `import { assertRdfLiteral, RdfDatatype } from '@migaia/storage-contract'

const value = 'bonjour'
const language = 'fr'
assertRdfLiteral(value, RdfDatatype.langString, language, 'catalog')
console.log(value, language)`
  ),
  'storage-contract:index:assertStorageBlobGet': example(
    'Check an inclusive byte range before reading an object; no content is opened here.',
    '读取对象前检查包含两端的字节范围；这一步不会打开内容。',
    `import { assertStorageBlobGet } from '@migaia/storage-contract'

const key = 'reports/summary.txt'
const options = { range: { start: 0, end: 99 }, ctx: { timeoutMs: 1_000 } }
assertStorageBlobGet(key, options, 'object-store')
console.log(key, options.range)`
  ),
  'storage-contract:index:assertStorageBlobList': example(
    'Check a listing prefix and page size before asking the backend for objects.',
    '向后端列出对象之前，先检查名称前缀和每页数量。',
    `import { assertStorageBlobList } from '@migaia/storage-contract'

const options = { prefix: 'reports/', limit: 20 }
assertStorageBlobList(options, { timeoutMs: 1_000 }, 'object-store')
console.log(options.prefix, options.limit)`
  ),
  'storage-contract:index:assertStorageBlobPut': example(
    'Check upload bytes and create-only options without writing the object.',
    '检查上传字节和仅创建选项，不执行对象写入。',
    `import { assertStorageBlobPut } from '@migaia/storage-contract'

const body = new TextEncoder().encode('hello')
const options = {
  contentType: 'text/plain',
  metadata: { author: 'Ada' },
  ifNoneMatch: true as const
}

assertStorageBlobPut('reports/summary.txt', body, options, 'object-store')
console.log(new TextDecoder().decode(body), options.contentType)`
  ),
  'storage-contract:index:assertStorageOrgId': example(
    'Validate a lowercase UUID before selecting an organization.',
    '选择组织之前，先检查小写 UUID 格式的组织编号。',
    `import { assertStorageOrgId } from '@migaia/storage-contract'

const organization: unknown = '9b8c7d6e-1234-4567-89ab-0123456789ab'
assertStorageOrgId(organization)
console.log(organization)`
  ),
  'storage-contract:index:assertStorageRdfPattern': example(
    'A partial RDF pattern can select one predicate without inventing other fields.',
    'RDF 部分匹配条件可以只指定关系，不必补上其它字段。',
    `import { assertStorageRdfPattern } from '@migaia/storage-contract'

const pattern: unknown = {
  predicate: { termType: 'NamedNode', value: 'https://example.com/name' }
}
assertStorageRdfPattern(pattern, 'catalog')
console.log(pattern.predicate?.value)`
  ),
  'storage-contract:index:assertStorageRdfQuad': example(
    'A complete RDF statement supplies subject, predicate, object and graph.',
    '一条完整的 RDF 陈述需要提供主体、关系、对象和所属图。',
    `import { assertStorageRdfQuad, RdfDatatype } from '@migaia/storage-contract'

const statement: unknown = {
  subject: { termType: 'NamedNode', value: 'https://example.com/people/ada' },
  predicate: { termType: 'NamedNode', value: 'https://example.com/name' },
  object: { termType: 'Literal', value: 'Ada', datatype: RdfDatatype.string },
  graph: { termType: 'DefaultGraph' }
}
assertStorageRdfQuad(statement, 'catalog')
console.log(statement.subject.value, statement.object)`
  ),
  'storage-contract:index:assertStorageRdfTerm': example(
    'Validate a resource term before placing it in an RDF statement.',
    '把资源放进 RDF 陈述之前，先检查它的结构和地址。',
    `import { assertStorageRdfTerm } from '@migaia/storage-contract'

const term: unknown = {
  termType: 'NamedNode', value: 'https://example.com/people/ada'
}
assertStorageRdfTerm(term, 'catalog')
console.log(term.termType)`
  ),
  'storage-contract:index:assertStorageTtlTarget': example(
    'Check which stored item should expire; validation does not change its lifetime.',
    '检查需要过期的数据位置；校验本身不会改变它的有效期。',
    `import { assertStorageTtlTarget } from '@migaia/storage-contract'

const target: unknown = { channel: 'text', key: 'session' }
assertStorageTtlTarget(target, 'memory')
console.log(target.channel, target)`
  ),
  'storage-contract:index:assertStorageVector': example(
    'Check component count and a nonzero direction before a cosine search.',
    '执行余弦搜索之前，先检查分量数量和非零方向。',
    `import { assertStorageVector } from '@migaia/storage-contract'

const direction = [1, 0, 0]
assertStorageVector(direction, { dimensions: 3, metric: 'cosine' }, 'catalog')
console.log(direction)`
  ),
  'storage-contract:index:assertStorageVectorCollection': example(
    'Check a collection name and its native vector settings before creating it.',
    '创建向量集合之前，先检查名称和向量设置。',
    `import { assertStorageVectorCollection } from '@migaia/storage-contract'

const options = { dimensions: 3, metric: 'cosine' } as const
assertStorageVectorCollection('articles', options, 'catalog')
console.log(options.dimensions, options.metric)`
  ),
  'storage-contract:index:assertStorageVectorIds': example(
    'Reject repeated IDs when the operation requires a distinct selection.',
    '需要选择不同记录时，检查编号并拒绝重复项。',
    `import { assertStorageVectorIds } from '@migaia/storage-contract'

const ids = ['article-one', 'article-two']
assertStorageVectorIds(ids, 'catalog', true)
console.log(ids)`
  ),
  'storage-contract:index:assertVectorObject': example(
    'Check that unknown vector options are an object before validating individual fields.',
    '逐项检查向量设置之前，先确认未知输入是对象。',
    `import { assertVectorObject } from '@migaia/storage-contract'

const options: unknown = { dimensions: 3, metric: 'cosine' }
assertVectorObject(options, 'catalog')
console.log(Object.keys(options))`
  ),
  'storage-contract:index:invalidBlobInput': example(
    'Create the standard upload-input error while keeping the original cause.',
    '创建标准上传参数错误，并保留最初的原因。',
    `import { invalidBlobInput } from '@migaia/storage-contract'

const cause = new TypeError('Upload bytes are required')
const failure = invalidBlobInput('object-store', cause)
console.log(failure.code, failure.cause)`
  ),
  'storage-contract:index:invalidCapability': example(
    'Create a capability-input error without losing the cause supplied by the caller.',
    '创建能力参数错误，并保留调用方提供的原因。',
    `import { invalidCapability } from '@migaia/storage-contract'

const cause = new TypeError('A capability token is required')
const failure = invalidCapability(cause)
console.log(failure.code, failure.cause)`
  ),
  'storage-contract:index:invalidConcurrencyArgument': example(
    'Create a policy-input error before starting a transaction.',
    '开始事务之前，可以先创建策略参数错误。',
    `import { invalidConcurrencyArgument } from '@migaia/storage-contract'

const cause = new TypeError('A registered policy is required')
const failure = invalidConcurrencyArgument(cause)
console.log(failure.code, failure.cause)`
  ),
  'storage-contract:index:invalidLockArgument': example(
    'Include the backend name when reporting an invalid lock request.',
    '报告无效的锁请求时，附上后端名称。',
    `import { invalidLockArgument } from '@migaia/storage-contract'

const failure = invalidLockArgument('catalog')
console.log(failure.source, failure.code, failure.backend)`
  ),
  'storage-contract:index:invalidRdf': example(
    'Create a standard RDF-input error for a backend author to throw or report.',
    '后端作者可以创建标准 RDF 参数错误，再抛出或报告它。',
    `import { invalidRdf } from '@migaia/storage-contract'

const failure = invalidRdf('catalog')
console.log(failure.source, failure.code, failure.backend)`
  ),
  'storage-contract:index:invalidVector': example(
    'This helper throws immediately; catch the coded vector-input failure at the caller.',
    '这个辅助函数会立即抛出错误；由调用方接收带错误码的向量参数错误。',
    `import { invalidVector, isStorageContractError } from '@migaia/storage-contract'

try {
  invalidVector('catalog')
} catch (error) {
  if (isStorageContractError(error)) console.log(error.source, error.code, error.backend)
  else console.error(error)
}`
  ),
  'storage-contract:index:isCapabilityToken': example(
    'Check an unknown selection before reading its capability name.',
    '读取所选能力的名称之前，先检查这个未知值。',
    `import { defineStorageCapability, isCapabilityToken } from '@migaia/storage-contract'

const selected: unknown = defineStorageCapability<{ note(message: string): void }>()('notes')
if (isCapabilityToken(selected)) console.log(selected.name)`
  ),
  'storage-contract:index:isStorageBase': example(
    'Inspect a real backend without closing it; the host still owns cleanup.',
    '检查真实后端但不关闭它；清理工作仍由宿主负责。',
    `import { isStorageBase } from '@migaia/storage-contract'
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'

await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
const backend = host.backend('memory')
if (isStorageBase(backend, { asyncDisposeKey: Symbol.asyncDispose })) {
  console.log(backend.backend, backend.capabilities)
}`
  ),
  'storage-contract:index:readCapabilityTokenFacts': example(
    'Inspect the standard key-value capability without opening a backend.',
    '无需打开后端，即可查看标准键值能力的说明。',
    `import { kv, readCapabilityTokenFacts } from '@migaia/storage-contract'

const facts = readCapabilityTokenFacts(kv)
console.log(facts?.transaction?.methods)`
  ),
  'storage-contract:index:readConcurrencyPolicy': example(
    'Evaluate the selected callback for a reported conflict without running a transaction.',
    '针对收到的冲突信息调用所选回调，但不运行事务。',
    `import { defineConcurrencyPolicy, readConcurrencyPolicy } from '@migaia/storage-contract'

const decide = () => ({ action: 'retry', delayMs: 25 } as const)
const policy = defineConcurrencyPolicy({
  name: 'retry-conflicts', locking: 'optimistic', decide
})
const callback = readConcurrencyPolicy(policy)
const decision = await callback?.({
  phase: 'commit', keys: [{ channel: 'record', key: 'article-one' }],
  attempt: 1, waitedMs: 0, holder: undefined
})
console.log(decision)`
  ),
  'storage-contract:index:readStorageImplementation': example(
    'Read an implementation definition while preserving its original API object.',
    '读取实现定义，并保留它最初提供的 API 对象。',
    `import {
  defineStorageCapability, implement, readStorageImplementation
} from '@migaia/storage-contract'

const notes = defineStorageCapability<{ note(message: string): void }>()('notes')
const api = { note(message: string) { console.log(message) } }
const definition = implement(notes, api)
const record = readStorageImplementation(definition)
console.log(record?.implementation.capability.name)`
  )
}

/** Keep each authored API sentence in the reader's selected language. */
function t(en: string, zh: string): IText {
  return { en, zh }
}

/** A backend label identifies the caller's provider in diagnostics without selecting a backend. */
const backendDescription = t(
  'Your backend kind label for error details; undefined leaves the label unspecified.',
  '由调用方提供的后端种类名称，用于错误详情；传入未定义值表示不附加名称。'
)

/** Error factories share the contract error shape while each function documents its own cause. */
const createdFailure = t(
  'A StorageContractError with source @migaia/storage-contract and code INVALID_ARGUMENT. The function returns the error rather than throwing it; a supplied cause remains reachable on cause.',
  '返回来源为 `@migaia/storage-contract`、错误码为 `INVALID_ARGUMENT` 的 `StorageContractError`。函数只创建错误，不抛出；已提供的原因保留在 `cause` 上。'
)

/** Source-backed descriptions for the pure validators and definition readers shown above. */
export const storageAssertionSymbols: Readonly<Record<string, ISymbolDoc>> = {
  assertConcurrencyPolicy: {
    role: 'operation',
    purpose: t(
      'Validate that a policy came from defineConcurrencyPolicy and, when requested, matches the backend locking mode. This does not call its decision callback or acquire locks.',
      '检查策略是否由 `defineConcurrencyPolicy` 创建，并按需检查它是否符合后端的加锁方式。不会调用决策回调，也不会取得锁。'
    ),
    params: {
      policy: t('The policy object to validate.', '需要检查的策略对象。'),
      locking: t(
        'Optional required mode: pessimistic or optimistic. Omission accepts either registered mode.',
        '可选的指定方式：`pessimistic` 为先加锁，`optimistic` 为提交时检查冲突；省略时接受任一种已登记方式。'
      ),
      backend: backendDescription
    },
    returns: t(
      'No value; successful validation narrows policy to IConcurrencyPolicy. Unregistered input throws INVALID_ARGUMENT; a locking-mode mismatch throws UNSUPPORTED_CAPABILITY.',
      '无返回值；通过后将输入收窄为 `IConcurrencyPolicy`。未登记的输入抛出 `INVALID_ARGUMENT`；加锁方式不匹配抛出 `UNSUPPORTED_CAPABILITY`。'
    ),
    example: storageAssertionExamples['storage-contract:index:assertConcurrencyPolicy']
  },
  assertLockKey: {
    role: 'operation',
    purpose: t(
      'Validate the text, bytes, record, vector or RDF fields of a lock request before the backend uses it. This pure check does not copy the key or acquire a lock.',
      '在后端使用锁请求之前，检查文本、字节、记录、向量或 RDF 通道对应的字段。只做校验，不复制键，也不取得锁。'
    ),
    params: {
      value: t(
        'Unknown input containing a channel and that channel’s key fields.',
        '包含通道及其键字段的未知输入。'
      ),
      backend: backendDescription
    },
    returns: t(
      'No value; successful validation narrows value to ILockKey. An unknown channel or invalid channel fields throw INVALID_ARGUMENT.',
      '无返回值；通过后将输入收窄为 `ILockKey`。未知通道或无效通道字段抛出 `INVALID_ARGUMENT`。'
    ),
    example: storageAssertionExamples['storage-contract:index:assertLockKey']
  },
  assertRdfIri: {
    role: 'operation',
    purpose: t(
      'Validate an absolute RDF resource address while preserving its exact spelling. The check performs no URL normalization, resolution or network request.',
      '检查 RDF 资源的绝对地址，并保留它原来的写法。不会规范化地址、解析相对地址或发起网络请求。'
    ),
    params: {
      value: t(
        'The unknown value expected to be an absolute IRI string.',
        '预期为绝对资源地址字符串的未知值。'
      ),
      backend: backendDescription
    },
    returns: t(
      'No value; valid input is narrowed to string. Invalid address syntax throws INVALID_ARGUMENT.',
      '无返回值；合法输入收窄为字符串。地址格式无效时抛出 `INVALID_ARGUMENT`。'
    ),
    example: storageAssertionExamples['storage-contract:index:assertRdfIri']
  },
  assertRdfLiteral: {
    role: 'operation',
    purpose: t(
      'Validate RDF text, its datatype address and an optional language tag as one consistent value. Language-tagged text requires RdfDatatype.langString; checking does not rewrite the caller’s text or tag.',
      '一并检查 RDF 文本、数据类型地址和可选语言标签。带语言标签的文本必须使用 `RdfDatatype.langString`；校验不会改写调用方的文本或标签。'
    ),
    params: {
      value: t('Text made of valid Unicode scalar values.', '由合法 Unicode 字符组成的文本。'),
      datatype: t(
        'Absolute datatype IRI, such as RdfDatatype.string or RdfDatatype.langString.',
        '数据类型的绝对地址，例如 `RdfDatatype.string` 或 `RdfDatatype.langString`。'
      ),
      language: t(
        'Optional well-formed language tag; undefined means no language tag.',
        '可选的合法语言标签；未定义值表示没有语言标签。'
      ),
      backend: backendDescription
    },
    returns: t(
      'No value; text, datatype and language agree. Invalid text, address, tag or datatype/tag pairing throws INVALID_ARGUMENT.',
      '无返回值；通过表示文本、数据类型和语言相互匹配。无效文本、地址、标签或类型与标签组合抛出 `INVALID_ARGUMENT`。'
    ),
    example: storageAssertionExamples['storage-contract:index:assertRdfLiteral']
  },
  assertStorageBlobGet: {
    role: 'operation',
    purpose: t(
      'Check an object key, optional inclusive byte range and operation context before reading content. This does not open an object or allocate a replacement range.',
      '读取内容前检查对象键、可选的包含两端的字节范围，以及本次操作设置。不会打开对象或创建替代范围。'
    ),
    params: {
      key: t('The object’s string key.', '对象的字符串键。'),
      options: t(
        'Read options with optional range and ctx; pass undefined for an unrestricted read.',
        '读取选项，可带 `range` 和 `ctx`；传入未定义值表示不限制范围。'
      ),
      backend: backendDescription
    },
    optionDocs: {
      range: {
        summary: t(
          'Inclusive byte bounds; start is required and end is optional.',
          '包含两端的字节范围，必须提供起点，终点可省略。'
        ),
        default: t('Omitted: read the complete object.', '省略时读取完整对象。')
      },
      'range.start': {
        summary: t(
          'Nonnegative safe integer giving the first byte position.',
          '首个字节的位置，必须是非负安全整数。'
        )
      },
      'range.end': {
        summary: t(
          'Safe integer at or after start, included in the result.',
          '不小于起点的安全整数，对应字节包含在结果中。'
        ),
        default: t('Omitted: continue to the end of the object.', '省略时一直读取到对象末尾。')
      },
      ctx: {
        summary: t(
          'An optional IOperationContext carrying cancellation or a timeout.',
          '可选的 `IOperationContext`，携带取消信号或超时时间。'
        ),
        default: t('Omitted: no caller context is added.', '省略时不增加调用方操作设置。')
      }
    },
    returns: t(
      'No value; the request has valid domains. Invalid keys, bounds or operation options throw INVALID_ARGUMENT before content is opened.',
      '无返回值；通过表示请求参数有效。键、范围或操作设置无效时，在打开内容前抛出 `INVALID_ARGUMENT`。'
    ),
    example: storageAssertionExamples['storage-contract:index:assertStorageBlobGet']
  },
  assertStorageBlobList: {
    role: 'operation',
    purpose: t(
      'Check an object-list prefix, cursor, page size and operation context before listing. It validates the request without copying its options or contacting a backend.',
      '列出对象前检查名称前缀、游标、每页数量和本次操作设置。只检查请求，不复制选项，也不连接后端。'
    ),
    params: {
      options: t(
        'Optional prefix, after cursor and positive safe-integer limit.',
        '可选的名称前缀、`after` 游标和正安全整数每页上限。'
      ),
      ctx: t(
        'Optional IOperationContext for this listing; undefined adds no caller context.',
        '本次列出操作可选的 `IOperationContext`；未定义值表示不增加调用方设置。'
      ),
      backend: backendDescription
    },
    optionDocs: {
      prefix: {
        summary: t(
          'String prefix restricting matching object keys.',
          '用于筛选对象键的字符串前缀。'
        ),
        default: t('Omitted: the empty prefix accepts every key.', '省略时使用空前缀，接受所有键。')
      },
      after: {
        summary: t(
          'String cursor returned by the backend’s previous listing.',
          '由后端上一次列出操作返回的字符串游标。'
        ),
        default: t('Omitted: start without a cursor.', '省略时从没有游标的位置开始。')
      },
      limit: {
        summary: t(
          'Positive safe integer bounding the requested page.',
          '限制本次请求每页数量的正安全整数。'
        ),
        default: t('Omitted: 100.', '省略时为 100。')
      }
    },
    returns: t(
      'No value; the listing request is valid. Invalid prefix, cursor, limit or operation context throws INVALID_ARGUMENT.',
      '无返回值；通过表示列出请求有效。前缀、游标、上限或操作设置无效时抛出 `INVALID_ARGUMENT`。'
    ),
    example: storageAssertionExamples['storage-contract:index:assertStorageBlobList']
  },
  assertStorageBlobPut: {
    role: 'operation',
    purpose: t(
      'Validate upload bytes or an unlocked readable byte stream, metadata and conditional-write options before acquiring a reader. It does not consume the body or write an object.',
      '取得读取器之前，检查上传字节或尚未锁定的可读字节流、元数据及条件写入选项。不会消费内容，也不会写入对象。'
    ),
    params: {
      key: t('String key chosen for the uploaded object.', '为上传对象选择的字符串键。'),
      body: t(
        'A Uint8Array or unlocked ReadableStream<Uint8Array>.',
        '`Uint8Array` 或尚未锁定的 `ReadableStream<Uint8Array>`。'
      ),
      options: t(
        'Optional contentType, string metadata, one write condition and ctx.',
        '可选的 `contentType`、字符串元数据、一项写入条件及 `ctx`。'
      ),
      backend: backendDescription
    },
    optionDocs: {
      contentType: {
        summary: t('String media type supplied to the backend.', '交给后端的字符串媒体类型。'),
        default: t(
          'Omitted: no media type is supplied by this validator.',
          '省略时校验器不附加媒体类型。'
        )
      },
      metadata: {
        summary: t(
          'Object whose own enumerable values are strings.',
          '对象自身的可枚举字段值必须全部为字符串。'
        ),
        default: t('Omitted: no metadata is supplied.', '省略时不提供元数据。')
      },
      ifMatch: {
        summary: t(
          'String ETag requiring an existing matching object; cannot accompany ifNoneMatch.',
          '字符串实体标签，要求已有对象与之匹配；不能同时提供 `ifNoneMatch`。'
        ),
        default: t('Omitted: no match condition is requested.', '省略时不要求标签匹配。')
      },
      ifNoneMatch: {
        summary: t(
          'Only true is accepted; requests creation without replacing an existing object.',
          '只接受 `true`，表示仅创建，不替换已有对象。'
        ),
        default: t('Omitted: no create-only condition is requested.', '省略时不要求仅创建。')
      },
      ctx: {
        summary: t(
          'Optional IOperationContext for cancellation and timeout.',
          '可选的 `IOperationContext`，指定取消信号和超时。'
        ),
        default: t('Omitted: no caller context is added.', '省略时不增加调用方操作设置。')
      }
    },
    returns: t(
      'No value; upload arguments are valid. Invalid body shape, metadata, conflicting write conditions or context throws INVALID_ARGUMENT without reading bytes.',
      '无返回值；通过表示上传参数有效。内容结构、元数据、互斥写入条件或操作设置无效时，不读取字节便抛出 `INVALID_ARGUMENT`。'
    ),
    example: storageAssertionExamples['storage-contract:index:assertStorageBlobPut']
  },
  assertStorageOrgId: {
    role: 'operation',
    purpose: t(
      'Validate the exact lowercase UUID syntax used to select an organization, including the reserved zero UUID. It does not choose a default or change letter case.',
      '检查选择组织时使用的小写 UUID 格式，包括保留的全零编号。不会选择默认组织，也不会转换大小写。'
    ),
    params: {
      value: t('Organization identifier supplied by the application.', '应用提供的组织编号。')
    },
    returns: t(
      'No value; valid input is narrowed to string. Invalid syntax throws INVALID_ARGUMENT.',
      '无返回值；合法输入收窄为字符串。格式无效时抛出 `INVALID_ARGUMENT`。'
    ),
    example: storageAssertionExamples['storage-contract:index:assertStorageOrgId']
  },
  assertStorageRdfPattern: {
    role: 'operation',
    purpose: t(
      'Validate supplied positions of a partial RDF statement using ground-term rules. Omitted positions stay omitted, and blank-node labels are not accepted for repeated-identity storage.',
      '按可持久化资源的规则，检查 RDF 部分陈述中已提供的位置。省略的位置继续省略；不会把空白节点的局部标签当作可重复使用的存储身份。'
    ),
    params: {
      pattern: t(
        'Unknown object with any subset of subject, predicate, object and graph.',
        '未知对象，可包含主体、关系、对象和所属图中的任意部分。'
      ),
      backend: backendDescription
    },
    returns: t(
      'No value; successful input is narrowed to Partial<IQuad>. Invalid supplied positions throw INVALID_ARGUMENT; no default graph is inserted.',
      '无返回值；通过后收窄为 `Partial<IQuad>`。已提供位置无效时抛出 `INVALID_ARGUMENT`；不会补上默认图。'
    ),
    example: storageAssertionExamples['storage-contract:index:assertStorageRdfPattern']
  },
  assertStorageRdfQuad: {
    role: 'operation',
    purpose: t(
      'Validate a complete ground RDF statement before writing it. All four positions are required, including an explicit named or default graph.',
      '写入前检查一条完整的 RDF 陈述。四个位置都必须提供，包括明确指定的命名图或默认图。'
    ),
    params: {
      quad: t(
        'Unknown statement containing subject, predicate, object and graph.',
        '包含主体、关系、对象和所属图的未知陈述。'
      ),
      backend: backendDescription
    },
    returns: t(
      'No value; successful input is narrowed to IQuad. Missing or invalid positions throw INVALID_ARGUMENT.',
      '无返回值；通过后收窄为 `IQuad`。缺少位置或位置无效时抛出 `INVALID_ARGUMENT`。'
    ),
    example: storageAssertionExamples['storage-contract:index:assertStorageRdfQuad']
  },
  assertStorageRdfTerm: {
    role: 'operation',
    purpose: t(
      'Validate the raw structure of a named node, blank node, literal or default graph. Use the pattern or quad validator when its position in a stored statement also needs checking.',
      '检查命名节点、空白节点、文本值或默认图的原始结构。若还需要检查它在存储陈述中的位置，应使用部分陈述或完整陈述校验器。'
    ),
    params: {
      value: t(
        'Unknown RDF term carrying its termType and associated fields.',
        '带有 `termType` 及对应字段的未知 RDF 值。'
      ),
      backend: backendDescription
    },
    returns: t(
      'No value; successful input is narrowed to IRdfTerm. Unsupported tags or invalid lexical fields throw INVALID_ARGUMENT.',
      '无返回值；通过后收窄为 `IRdfTerm`。不支持的类型标签或无效文本字段抛出 `INVALID_ARGUMENT`。'
    ),
    example: storageAssertionExamples['storage-contract:index:assertStorageRdfTerm']
  },
  assertStorageTtlTarget: {
    role: 'operation',
    purpose: t(
      'Validate the text, bytes, record or vector item selected for expiry. It reuses lock-key validation and rejects RDF targets without changing any stored lifetime.',
      '检查需要设置有效期的文本、字节、记录或向量位置。复用锁键校验并拒绝 RDF 目标，不会改变已有数据的有效期。'
    ),
    params: {
      target: t(
        'Unknown channel-specific target identifying the item to expire.',
        '通过通道及其键字段指定待过期数据的未知目标。'
      ),
      backend: backendDescription
    },
    returns: t(
      'No value; successful input is narrowed to ITtlTarget. Invalid lock fields or an RDF channel throw INVALID_ARGUMENT.',
      '无返回值；通过后收窄为 `ITtlTarget`。锁字段无效或使用 RDF 通道时抛出 `INVALID_ARGUMENT`。'
    ),
    example: storageAssertionExamples['storage-contract:index:assertStorageTtlTarget']
  },
  assertStorageVector: {
    role: 'operation',
    purpose: t(
      'Validate a nonempty array of finite components against optional dimensions and distance settings. Cosine requires a nonzero direction; the function does not copy or normalize the vector.',
      '按可选分量数量和距离设置检查非空的有限数值数组。余弦距离要求非零方向；函数不会复制或归一化向量。'
    ),
    params: {
      input: t('Vector components supplied by the caller.', '调用方提供的向量分量。'),
      options: t(
        'Optional known dimensions and metric from the collection configuration.',
        '从集合设置取得的可选已知分量数量与距离类型。'
      ),
      backend: backendDescription
    },
    options: 'IStorageVectorValidation',
    returns: t(
      'No value; the vector satisfies every supplied constraint. Invalid settings, components, dimensions or a zero cosine direction throw INVALID_ARGUMENT.',
      '无返回值；通过表示向量符合全部已提供的限制。设置、分量或数量无效，或余弦方向为零时，抛出 `INVALID_ARGUMENT`。'
    ),
    example: storageAssertionExamples['storage-contract:index:assertStorageVector']
  },
  assertStorageVectorCollection: {
    role: 'operation',
    purpose: t(
      'Validate a collection name and optional native vector configuration before creation. It checks parameter domains, not whether a backend already has a collection with that name.',
      '创建前检查集合名称和可选的原生向量设置。只检查参数范围，不判断后端是否已有同名集合。'
    ),
    params: {
      name: t('String collection name chosen by the application.', '应用选择的字符串集合名称。'),
      options: t(
        'Optional positive dimensions and cosine, dot or euclid metric.',
        '可选的正分量数量，以及 `cosine`、`dot` 或 `euclid` 距离类型。'
      ),
      backend: backendDescription
    },
    options: 'IStorageVectorConfiguration',
    returns: t(
      'No value; the name and any supplied configuration are valid. Invalid types, dimensions or metric throw INVALID_ARGUMENT.',
      '无返回值；通过表示名称和已提供的设置有效。类型、分量数量或距离类型无效时抛出 `INVALID_ARGUMENT`。'
    ),
    example: storageAssertionExamples['storage-contract:index:assertStorageVectorCollection']
  },
  assertStorageVectorIds: {
    role: 'operation',
    purpose: t(
      'Check that every vector ID is a string and optionally reject repeated IDs. This does not copy the list, remove duplicates or read a collection.',
      '检查每个向量编号是否为字符串，并可选择拒绝重复编号。不会复制列表、删除重复项或读取集合。'
    ),
    params: {
      ids: t(
        'Caller-supplied array of vector ID strings; an empty list is allowed.',
        '调用方提供的向量编号字符串数组，允许空列表。'
      ),
      backend: backendDescription,
      rejectDuplicates: t(
        'Boolean, default false. Set true when repeated IDs should reject instead of remaining in the list.',
        '布尔值，默认为 `false`；设为 `true` 时重复编号会使校验失败，为 `false` 时不拒绝重复项。'
      )
    },
    returns: t(
      'No value; IDs satisfy the selected policy. Invalid input, a non-string ID or a forbidden duplicate throws INVALID_ARGUMENT.',
      '无返回值；通过表示编号符合所选策略。输入无效、编号不是字符串或出现不允许的重复项时，抛出 `INVALID_ARGUMENT`。'
    ),
    example: storageAssertionExamples['storage-contract:index:assertStorageVectorIds']
  },
  assertVectorObject: {
    role: 'operation',
    purpose: t(
      'Validate the outer shape of vector-related options before checking their fields. Non-null objects, including class instances, are accepted; arrays and primitive values are rejected.',
      '检查向量相关设置的外层结构，再由调用方逐项校验。接受非空对象，包括类实例；拒绝数组和原始值。'
    ),
    params: {
      value: t('Unknown vector options or metadata object.', '未知的向量选项或元数据对象。'),
      backend: backendDescription
    },
    returns: t(
      'No value; valid input is narrowed to object. Null, arrays and non-objects throw INVALID_ARGUMENT.',
      '无返回值；合法输入收窄为对象。空值、数组和非对象值抛出 `INVALID_ARGUMENT`。'
    ),
    example: storageAssertionExamples['storage-contract:index:assertVectorObject']
  },
  invalidBlobInput: {
    role: 'operation',
    purpose: t(
      'Create the shared object-input error for a malformed upload, range or listing request while preserving an optional original cause.',
      '为无效的上传、范围或列出请求创建统一对象参数错误，并保留可选的最初原因。'
    ),
    params: {
      backend: backendDescription,
      cause: t(
        'Optional original failure to retain as cause.',
        '可选的最初失败值，保留为 `cause`。'
      )
    },
    returns: createdFailure,
    example: storageAssertionExamples['storage-contract:index:invalidBlobInput']
  },
  invalidCapability: {
    role: 'operation',
    purpose: t(
      'Create the standard error for an invalid capability definition or implementation input without publishing a capability or losing the original cause.',
      '为无效的能力定义或实现参数创建标准错误，不发布能力，也不丢失最初原因。'
    ),
    params: {
      cause: t(
        'Optional original failure to retain as cause.',
        '可选的最初失败值，保留为 `cause`。'
      )
    },
    returns: createdFailure,
    example: storageAssertionExamples['storage-contract:index:invalidCapability']
  },
  invalidConcurrencyArgument: {
    role: 'operation',
    purpose: t(
      'Create the standard concurrency-argument error before any policy callback, lock acquisition or transaction work is started.',
      '在运行策略回调、取得锁或开始事务之前，创建标准并发参数错误。'
    ),
    params: {
      cause: t(
        'Optional original validation failure to retain as cause.',
        '可选的最初校验失败值，保留为 `cause`。'
      )
    },
    returns: createdFailure,
    example: storageAssertionExamples['storage-contract:index:invalidConcurrencyArgument']
  },
  invalidLockArgument: {
    role: 'operation',
    purpose: t(
      'Create the standard malformed-lock error with the caller’s backend label and optional cause; it does not acquire or release any lock.',
      '附上调用方的后端名称和可选原因，创建标准锁参数错误；不会取得或释放任何锁。'
    ),
    params: {
      backend: backendDescription,
      cause: t(
        'Optional original failure to retain as cause.',
        '可选的最初失败值，保留为 `cause`。'
      )
    },
    returns: createdFailure,
    example: storageAssertionExamples['storage-contract:index:invalidLockArgument']
  },
  invalidRdf: {
    role: 'operation',
    purpose: t(
      'Create the standard RDF-argument error for a malformed term or statement while retaining backend details and the optional original cause.',
      '为无效的 RDF 值或陈述创建标准参数错误，并保留后端详情与可选的最初原因。'
    ),
    params: {
      backend: backendDescription,
      cause: t(
        'Optional original failure to retain as cause.',
        '可选的最初失败值，保留为 `cause`。'
      )
    },
    returns: createdFailure,
    example: storageAssertionExamples['storage-contract:index:invalidRdf']
  },
  invalidVector: {
    role: 'operation',
    purpose: t(
      'Immediately reject malformed vector input with the standard contract error. Unlike the error factories, this helper throws instead of returning an error object.',
      '立即用标准契约错误拒绝无效的向量参数。与错误工厂不同，这个辅助函数直接抛出，不返回错误对象。'
    ),
    params: { backend: backendDescription },
    returns: t(
      'Never returns; throws StorageContractError with source @migaia/storage-contract and code INVALID_ARGUMENT.',
      '不会返回；抛出来源为 `@migaia/storage-contract`、错误码为 `INVALID_ARGUMENT` 的 `StorageContractError`。'
    ),
    example: storageAssertionExamples['storage-contract:index:invalidVector']
  },
  isCapabilityToken: {
    role: 'operation',
    purpose: t(
      'Check whether a value is a token created by the capability definition API. A same-name object does not become a token, and this check grants no store access.',
      '检查一个值是否为能力定义 API 创建的令牌。名称相同的普通对象不会因此成为令牌；检查本身也不授予存储访问权。'
    ),
    params: { value: t('Unknown value selected by the application.', '应用选择的未知值。') },
    returns: t(
      'Boolean; true narrows the original value to IAnyStorageCapability. Unregistered values return false without throwing.',
      '返回布尔值；为真时把原值收窄为 `IAnyStorageCapability`。未登记的值返回假，不抛出错误。'
    ),
    example: storageAssertionExamples['storage-contract:index:isCapabilityToken']
  },
  isStorageBase: {
    role: 'operation',
    purpose: t(
      'Inspect whether a value has a backend label, capability facts and the required cleanup methods. It does not require key-value operations, clone the resource or invoke cleanup.',
      '检查值是否具有后端名称、能力说明和所需清理方法。不要求键值操作，不复制资源，也不调用清理。'
    ),
    params: {
      store: t('Unknown backend resource supplied by the application.', '应用提供的未知后端资源。'),
      options: t(
        'Optional cleanup-symbol identity supplied by the host.',
        '宿主提供的可选清理符号身份。'
      )
    },
    optionDocs: {
      asyncDisposeKey: {
        summary: t(
          'The host’s existing asynchronous cleanup symbol; no substitute symbol is created.',
          '宿主已有的异步清理符号；不会创建替代符号。'
        ),
        default: t(
          'Omitted: use native Symbol.asyncDispose. When the runtime has no native symbol, only explicit dispose is required.',
          '省略时使用原生 `Symbol.asyncDispose`。运行时没有原生符号时，只要求显式的 `dispose`。'
        ),
        example: storageAssertionExamples['storage-contract:index:isStorageBase']
      }
    },
    returns: t(
      'Boolean; true narrows the original value to IStorageBase. A missing or invalid base shape returns false without opening or disposing anything.',
      '返回布尔值；为真时把原值收窄为 `IStorageBase`。缺少或无效的基础结构返回假，不打开或关闭任何资源。'
    ),
    example: storageAssertionExamples['storage-contract:index:isStorageBase']
  },
  readCapabilityTokenFacts: {
    role: 'operation',
    purpose: t(
      'Read validation and transaction facts attached to a standard capability token. This inspects its definition without installing it in a backend or invoking its validator.',
      '读取标准能力令牌携带的校验和事务说明。只查看定义，不把能力安装到后端，也不调用校验器。'
    ),
    params: {
      token: t(
        'A capability token, such as kv, records or a token from defineStorageCapability.',
        '能力令牌，例如 `kv`、`records` 或由 `defineStorageCapability` 创建的令牌。'
      )
    },
    returns: t(
      'The standard token’s ICapabilityTokenFacts, or undefined for custom tokens without standard facts. No new capability or resource is created.',
      '返回标准令牌的 `ICapabilityTokenFacts`；没有标准说明的自定义令牌返回未定义值。不创建新能力或资源。'
    ),
    example: storageAssertionExamples['storage-contract:index:readCapabilityTokenFacts']
  },
  readConcurrencyPolicy: {
    role: 'operation',
    purpose: t(
      'Read the decision callback retained for a policy created by defineConcurrencyPolicy. Reading does not execute the callback, acquire locks or start retries.',
      '读取由 `defineConcurrencyPolicy` 创建的策略所保留的决策回调。读取不会执行回调、取得锁或开始重试。'
    ),
    params: {
      policy: t('The original registered concurrency policy object.', '最初登记的并发策略对象。')
    },
    returns: t(
      'The original callback, or undefined when the object is not registered. Invoking a returned callback yields its decision; this reader does not apply that decision.',
      '返回最初的回调；对象未登记时返回未定义值。调用返回的回调会得到决策，但本函数不会执行该决策。'
    ),
    example: storageAssertionExamples['storage-contract:index:readConcurrencyPolicy']
  },
  readStorageImplementation: {
    role: 'operation',
    purpose: t(
      'Read the definition recorded by implement while preserving its API object and optional transaction callback. Inspecting a definition does not publish it to a store.',
      '读取由 `implement` 登记的定义，保留其 API 对象和可选事务回调。查看定义不会把它发布到存储实例。'
    ),
    params: {
      descriptor: t(
        'Unknown input expected to be the original descriptor returned by implement.',
        '预期为 `implement` 最初返回的描述对象的未知输入。'
      )
    },
    returns: t(
      'IStorageImplementationRecord for an authentic descriptor, or undefined for an unrelated value. The record retains the original implementation and any transaction callback.',
      '真实描述对象返回 `IStorageImplementationRecord`；无关值返回未定义值。记录保留最初的实现和已提供的事务回调。'
    ),
    example: storageAssertionExamples['storage-contract:index:readStorageImplementation']
  }
}
