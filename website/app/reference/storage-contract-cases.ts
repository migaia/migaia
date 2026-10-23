import type { ICaseDoc, IText } from './contract.js'

/** Keeps complete bilingual cases beside their exact observable outputs. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Exercises public contract tools without supplying a fictional storage implementation. */
export const storageContractCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
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
        `import { resolveConcurrencyPolicy, runWithConcurrency, type IStorageBase, type ITransactionOptions, type IConcurrencyPort } from '@migaia/storage-contract'
async function execute(store: IStorageBase, capturedOptions: ITransactionOptions, port: IConcurrencyPort<boolean>) {
  const policy = resolveConcurrencyPolicy(store, capturedOptions.concurrency)
  return runWithConcurrency({ store, options: capturedOptions, policy }, port)
}`,
        `import { resolveConcurrencyPolicy, runWithConcurrency, type IStorageBase, type ITransactionOptions, type IConcurrencyPort } from '@migaia/storage-contract'
async function execute(store: IStorageBase, capturedOptions: ITransactionOptions, port: IConcurrencyPort<boolean>) {
  const policy = resolveConcurrencyPolicy(store, capturedOptions.concurrency)
  return runWithConcurrency({ store, options: capturedOptions, policy }, port)
}`
      ),
      result: t(
        'The function returns the real port’s committed boolean. The caller supplies a registered original store and captured options; no fictional backend is created by this example.',
        '函数返回真实 port 的提交布尔值。调用方提供原登记 store 与已捕获选项；示例不构造虚拟后端。'
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
