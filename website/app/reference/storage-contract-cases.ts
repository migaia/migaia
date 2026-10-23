import type { ICaseDoc, IText } from './contract.js'

/** Keeps complete bilingual cases beside their exact observable outputs. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Exercises public contract tools without supplying a fictional storage implementation. */
export const storageContractCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
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
        'Options supplied through getters can change between validation and use. One storage layer may validate a timeout while another later reads a different timeout or write policy.\n\nRe-reading the original object at each layer repeats those getters. Copying selected fields in several places also leaves no shared indication that admission has already captured the values.\n\nPass `snapshotOperationContext()` the original options once, then pass its result inward. It captures the four fields and freezes their record; passing that snapshot back reuses its identity. An already-aborted signal is accepted because the helper validates intent only; the backend implements cancellation and timeouts.',
        '通过访问器提供的选项可能在校验和使用之间变化。存储的一层校验了某个超时，另一层稍后却可能读到不同的超时或写入策略。\n\n各层继续读取原对象，就会重复触发访问器。各自复制几个字段也无法共同识别这些值是否已经在接纳操作时捕获。\n\n先把原选项交给 `snapshotOperationContext()`，再向内传递返回值。它只读取一次四个字段并冻结记录，再次传入该快照会复用同一对象；已取消的信号也可接纳，因为工具只校验意图，实际取消和超时由后端执行。'
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
  collectionsJsonCodec: [
    {
      title: t('Restore nested Map and Set values from text', '从文本恢复嵌套的 Map 与 Set'),
      problem: t(
        'A permissions object contains a Map of users to permission Sets. Ordinary JSON serialization writes these collections as empty objects, so loading the saved text loses the permissions.\n\nJSON does not turn Map entries or Set elements into object fields. A handwritten replacer and reviver must also agree on collection tags and handle nested collections; implementing only one side cannot restore the original types.\n\nUse `collectionsJsonCodec.encode()` and `decode()` as a pair. Both use the same versioned tuple format, preserving Map and Set inside otherwise JSON-compatible data; pass the encoded string to a storage implementation separately.',
        '权限对象用 `Map` 保存用户，每个用户对应一个权限 `Set`。普通 JSON 序列化把集合写成空对象，重新加载保存的文本后，权限内容就丢失了。\n\nJSON 不会把 Map 条目或 Set 元素转换成对象字段。手写替换器和还原器还需要协调集合标记、处理嵌套集合，只实现一端无法恢复原类型。\n\n配对使用 `collectionsJsonCodec.encode()` 和 `decode()`。两端采用同一版本元组格式，在其余部分兼容 JSON 的数据中保留 Map 与 Set；编码得到的字符串另交给存储实现保存。'
      ),
      example: t(
        "import { collectionsJsonCodec } from '@migaia/storage-contract'\n\nconst settings = { roles: new Map([['Ada', new Set(['read', 'write'])]]) }\nconst raw = await collectionsJsonCodec.encode(settings)\nconst restored = await collectionsJsonCodec.decode(raw) as typeof settings\nconsole.log('output:', collectionsJsonCodec.output)\nconsole.log('Map:', restored.roles instanceof Map)\nconsole.log('Set:', restored.roles.get('Ada') instanceof Set)\nconsole.log('permissions:', [...(restored.roles.get('Ada') ?? [])].join(', '))",
        "import { collectionsJsonCodec } from '@migaia/storage-contract'\n\nconst settings = { roles: new Map([['Ada', new Set(['read', 'write'])]]) }\nconst raw = await collectionsJsonCodec.encode(settings)\nconst restored = await collectionsJsonCodec.decode(raw) as typeof settings\nconsole.log('输出形式:', collectionsJsonCodec.output)\nconsole.log('Map:', restored.roles instanceof Map)\nconsole.log('Set:', restored.roles.get('Ada') instanceof Set)\nconsole.log('权限:', [...(restored.roles.get('Ada') ?? [])].join(', '))"
      ),
      result: t(
        'Prints `output: text`, `Map: true`, `Set: true`, then `permissions: read, write`.\n\nThe codec restores both nested collection types from a string and does not store that string anywhere. Other values retain JSON limitations; cycles are unsupported. Arrays matching the codec’s exact reserved tuple format are decoded as collections, so avoid using that format as ordinary application data.',
        '依次输出 `输出形式: text`、`Map: true`、`Set: true`、`权限: read, write`。\n\n编解码器从字符串中恢复两种嵌套集合，不负责保存字符串。其余值仍受 JSON 能力边界限制，不支持循环引用；与保留元组格式完全匹配的数组会被解码为集合，因此普通业务数据应避开该格式。'
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
