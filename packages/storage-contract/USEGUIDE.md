# storage-contract 使用指南

[English](./USEGUIDE.en.md) · [返回 README](./README.md)

先按手头问题选择场景，再查接口、参数和实现责任。本指南只调用契约工具与内置 codec，不模拟存储后端。

## 按场景查找

| 场景                                   | 怎么组合                      | 详细说明                                                       |
| -------------------------------------- | ----------------------------- | -------------------------------------------------------------- |
| 在调用方修改前捕获复合键               | `snapshotStorageKey`          | [完整示例](./USEGUIDE.md#在调用方修改前捕获复合键)             |
| 把普通对象作为记录键前先拒绝           | `snapshotStorageKey`          | [完整示例](./USEGUIDE.md#把普通对象作为记录键前先拒绝)         |
| 只读取一次操作选项，把取消执行留给后端 | `snapshotOperationContext`    | [完整示例](./USEGUIDE.md#只读取一次操作选项把取消执行留给后端) |
| 从文本恢复嵌套的 Map 与 Set            | `fromValueCodec`              | [完整示例](./USEGUIDE.md#从文本恢复嵌套的-map-与-set)          |
| 选择通道前规范化旧版能力描述           | `snapshotStorageCapabilities` | [完整示例](./USEGUIDE.md#选择通道前规范化旧版能力描述)         |
| 报告契约错误时保留原始失败             | `StorageContractError`        | [完整示例](./USEGUIDE.md#报告契约错误时保留原始失败)           |

## 在调用方修改前捕获复合键

异步操作仍引用调用方的数组、日期和缓冲区，原对象变化可能改变后续使用的键。只浅拷贝数组仍会共享两个嵌套对象。`snapshotStorageKey()` 校验并递归复制键组件，再次校验副本；结果与原键分离，但没有冻结。

`value` 是调用方提供的未知键；本例为字符串、Date、ArrayBuffer 组成的数组。`backend: memory` 只标记错误归属，不创建内存存储；可选 label 默认 `key`。返回键会深拷贝这些可变组件，但不冻结。

```ts doc-test=run
import { snapshotStorageKey } from '@migaia/storage-contract'

const date = new Date(0)
const bytes = new Uint8Array([7, 8])
const original: [string, Date, ArrayBuffer] = ['orders', date, bytes.buffer]
const saved = snapshotStorageKey(original, 'memory') as readonly [string, Date, ArrayBuffer]
original[0] = 'changed'
date.setTime(1000)
bytes[0] = 99
console.log('原键:', original[0], date.getTime(), bytes[0])
console.log('快照:', saved[0], saved[1].getTime(), new Uint8Array(saved[2])[0])
console.log('独立数组:', saved !== original)
```

输出：

```text
原键: changed 1000 99
快照: orders 0 7
独立数组: true
```

依次输出 `原键: changed 1000 99`、`快照: orders 0 7`、`独立数组: true`。修改原数组、日期与字节都没有改变已捕获的键。调用方仍持有可变快照，操作期间应自行保管它。

## 把普通对象作为记录键前先拒绝

应用把普通对象当作记录键，直到后端开始工作才失败。手写字符串转换又可能把不同对象压成相同的键。`snapshotStorageKey()` 以 `INVALID_KEY` 拒绝对象，并保留后端标签、原值与类型错误原因；应改用由标量字段组成的数组等有效键。

`candidate` 是不被键域接受的普通对象。`memory` 仍只是后端标签，`orderKey` 覆盖默认 label `key`，只影响错误文字。错误码、backend、key 和 cause 来自本包的契约错误。

```ts doc-test=run
import { snapshotStorageKey, StorageContractError } from '@migaia/storage-contract'

const candidate = { orderId: 1 }
try {
  snapshotStorageKey(candidate, 'memory', 'orderKey')
} catch (error) {
  if (!(error instanceof StorageContractError)) throw error
  console.log('错误码:', error.code)
  console.log('后端:', error.backend)
  console.log('原始键:', (error.key as unknown) === candidate)
  console.log('类型原因:', error.cause instanceof TypeError)
}
```

输出：

```text
错误码: INVALID_KEY
后端: memory
原始键: true
类型原因: true
```

依次输出 `错误码: INVALID_KEY`、`后端: memory`、`原始键: true`、`类型原因: true`。无效值在同步调用时被拒绝，函数没有调用存储后端。

## 只读取一次操作选项，把取消执行留给后端

通过访问器提供的选项可能在校验和使用之间变化，各层重读又可能得到不同的超时或策略。`snapshotOperationContext()` 只读取一次四个字段并冻结记录；再次传入该快照会复用同一对象。已取消的信号仍可被接纳，因为函数只校验意图，实际取消与超时由后端实现。

本例四个字段各由一个 getter 提供：signal 是原生 AbortSignal，timeoutMs 为允许的 0，pageSize 为 1–4096 内的 100，conflictPolicy 为 `replace`（覆盖）。字段省略都保持 undefined；另一策略 `conflict` 表示已存在则失败。取消和计时由实际后端执行。

```ts doc-test=run
import { snapshotOperationContext } from '@migaia/storage-contract'

const controller = new AbortController()
controller.abort()
let reads = 0
const options = {
  get signal() {
    reads += 1
    return controller.signal
  },
  get timeoutMs() {
    reads += 1
    return 0
  },
  get pageSize() {
    reads += 1
    return 100
  },
  get conflictPolicy() {
    reads += 1
    return 'replace' as const
  }
}
const snapshot = snapshotOperationContext(options)
console.log('冻结:', Object.isFrozen(snapshot))
console.log('复用快照:', snapshotOperationContext(snapshot) === snapshot)
console.log('字段读取次数:', reads)
console.log('信号已取消:', snapshot?.signal?.aborted)
console.log('选项:', snapshot?.timeoutMs, snapshot?.pageSize, snapshot?.conflictPolicy)
```

输出：

```text
冻结: true
复用快照: true
字段读取次数: 4
信号已取消: true
选项: 0 100 replace
```

依次输出 `冻结: true`、`复用快照: true`、`字段读取次数: 4`、`信号已取消: true`、`选项: 0 100 replace`。两次调用合计每字段只读取一次，保留原信号且允许零超时；函数没有建立定时器或取消订阅。

## 从文本恢复嵌套的 Map 与 Set

`fromValueCodec` 适配 serialize codec，不另建值格式。组合 `defineCollectionsJsonCodec({ version: 1 })`，用 serialize 拥有的 `$rpc` map/entries 与 set/values 保留记录保存 Map/Set。适配器名称为 `collections-json@1`，output 为 text；不支持的值由 serialize 拒绝。

`encode(value, ctx?)` 将本例对象转成文本，`decode(raw, ctx?)` 接收该文本并恢复集合。两个 ctx 省略时都是 undefined。output 固定为 `text`；这里的类型断言只说明预期对象形状，Map/Set 实例由 codec 的还原器创建。

```ts doc-test=run
import { fromValueCodec } from '@migaia/storage-contract'
import { defineCollectionsJsonCodec } from '@migaia/serialize/codecs/collections-json'

const codec = fromValueCodec(defineCollectionsJsonCodec({ version: 1 }))

const settings = new Map([['Ada', new Set(['read', 'write'])]])
const raw = await codec.encode(settings)
const restored = await codec.decode(raw)
if (!(restored instanceof Map)) throw new Error('Expected Map')
const permissions = restored.get('Ada')
if (!(permissions instanceof Set)) throw new Error('Expected Set')
console.log('输出形式:', codec.output)
console.log('Map:', restored instanceof Map)
console.log('Set:', permissions instanceof Set)
console.log('权限:', [...permissions].join(', '))
```

输出：

```text
输出形式: text
Map: true
Set: true
权限: read, write
```

依次输出 `输出形式: text`、`Map: true`、`Set: true`、`权限: read, write`。编解码器从字符串中恢复两种嵌套集合，不负责保存字符串。其余值仍受 JSON 能力边界限制，不支持循环引用。

## 选择通道前规范化旧版能力描述

在二级索引和变更流支持之前创建的能力描述缺少两个新标志。只检查真假会掩盖字段类型错误，继续持有原描述又会让后续修改改变接纳判断。`snapshotStorageCapabilities()` 校验完整形状，只把这两个旧版缺失字段补为 `false`，并返回独立记录。

输入必须包含 syncRead、binary、records、transactions、iteration、opaqueEntries 的布尔值，以及 maxValueBytes 的非负安全整数或 undefined。本例省略旧版尚无的 secondaryIndexes/changeFeed，快照将二者补为 false。完整字段含义见后文能力描述符表。

```ts doc-test=run
import { snapshotStorageCapabilities } from '@migaia/storage-contract'

const legacy = {
  syncRead: true,
  binary: false,
  records: false,
  transactions: false,
  iteration: false,
  opaqueEntries: false,
  maxValueBytes: undefined
}
const snapshot = snapshotStorageCapabilities(legacy)
legacy.records = true
console.log('新增标志:', snapshot?.secondaryIndexes, snapshot?.changeFeed)
console.log('记录能力:', legacy.records, snapshot?.records)
console.log('独立记录:', snapshot !== legacy)
console.log('冻结:', Object.isFrozen(snapshot))
```

输出：

```text
新增标志: false false
记录能力: true false
独立记录: true
冻结: false
```

依次输出 `新增标志: false false`、`记录能力: true false`、`独立记录: true`、`冻结: false`。原描述修改后，捕获的标志仍保留接纳时的值。形状无效或访问器失败返回 `undefined`，成功返回的快照自身仍可修改。

## 报告契约错误时保留原始失败

校验边界捕获原生失败后只报告消息，调用方无法再检查原始原因。手写诊断字段也容易遗漏来源和错误码。用相应公开错误码及原始 `cause` 构造 `StorageContractError`，由它持有稳定身份字段和原生原因链。

第一个参数是公开码 INVALID_ARGUMENT；第二个参数的 backend 为 `memory`，cause 为同一个 TypeError。可选 key 本例省略，默认 undefined；details 默认空对象。可选第三个 message 省略，使用由 code 生成的默认消息。冻结错误实例不会冻结 cause。

```ts doc-test=run
import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'

const cause = new TypeError('分页大小无效')
const error = new StorageContractError(StorageContractErrorCode.invalidArgument, {
  backend: 'memory',
  cause
})
console.log('来源:', error.source)
console.log('错误码:', error.code)
console.log('后端:', error.backend)
console.log('保留原错:', error.cause === cause)
console.log('原错消息:', (error.cause as Error).message)
console.log('冻结:', Object.isFrozen(error))
```

输出：

```text
来源: @migaia/storage-contract
错误码: INVALID_ARGUMENT
后端: memory
保留原错: true
原错消息: 分页大小无效
冻结: true
```

依次输出 `来源: @migaia/storage-contract`、`错误码: INVALID_ARGUMENT`、`后端: memory`、`保留原错: true`、`原错消息: 分页大小无效`、`冻结: true`。原生原因链指向同一个原始对象。错误实例已冻结，但不会冻结原因对象。

## 契约细节

### 公开入口、归属与边界

本包只有根入口 `@migaia/storage-contract`，没有子路径导出。它提供存储接口、能力描述、键域、操作上下文、编解码器接口、事务作用域和契约错误，也提供校验与快照函数、集合 JSON 编解码器。运行时依赖 `@migaia/utils`；结构化取消信号类型 `IAbortSignal` 来自 `@migaia/utils/promise`。

这里没有持久化后端，不打开数据库、不写磁盘，不依赖 DOM、IndexedDB 或 Node。真正的连接、读写、提交、隔离与重试属于实现包，例如 `@migaia/storage-web`。功能模块依赖接口；实现包依赖这份契约，契约不反向依赖实现。压缩、加密或 Worker 重编码可以实现同一个 codec 接口接入，但本包不实现这些扩展。

L0 指所有后端提供的字符串键值通道；L1 指额外提供字节、结构化记录、迭代与事务的通道。能力描述说“能做什么”，不是按后端名字猜测。收窄函数检查描述符和可调用方法，不执行后端读写。

### L0、同步通道与 L1

`IBackendKind` 为开放字符串类型；运行时准入要求符合 `[a-z][a-z0-9-]{0,63}`。名称用于描述后端，不授予能力访问权限。`IKeyValueStore` 的只读 `backend`、`capabilities` 描述后端与能力。下表的 key 均为字符串；异步方法的 ctx 默认 `undefined`，字段见操作上下文。

| IKeyValueStore 成员     | 返回与语义                                                      |
| ----------------------- | --------------------------------------------------------------- |
| `get(key, ctx?)`        | `Promise<string \| null>`；不存在返回 null，不是 undefined。    |
| `set(key, value, ctx?)` | value 为字符串，ctx 使用 IWriteOptions，返回 `Promise<void>`。  |
| `remove(key, ctx?)`     | 返回 `Promise<void>`。                                          |
| `has(key, ctx?)`        | 返回 `Promise<boolean>`。                                       |
| `keys(ctx?)`            | 返回 `Promise<string[]>`。                                      |
| `clearValues(ctx?)`     | 只清字符串值通道，返回 `Promise<void>`。                        |
| `clearAll(ctx?)`        | 清当前 store 的业务数据通道，返回 `Promise<void>`。             |
| `dispose()`             | 结束后端实例的使用寿命，返回 `Promise<void>`。                  |
| `sync?`                 | 可选 ISyncKeyValueStore；仅同步后端提供，异步后端为 undefined。 |

`ISyncKeyValueStore` 有 `get(key): string | null`、`set(key, value, options?): void`、`remove(key): void`、`has(key): boolean`、`keys(): string[]`、`clearValues(): void`。同步 set 的唯一选项为 conflictPolicy，不接受有效 signal 或 timeoutMs。local、session、memory、cookie 等同步后端可暴露 sync；IndexedDB 等异步后端不提供它。`ISyncCapableStore<TStore>` 把某个 store 变体的可选 sync 字段收紧为必有，供实现方工厂标注返回类型，不创建同步实现。

`IRecordStore<TValue>` 保留完整 L0，增加下列成员。TValue 默认 unknown；记录主键使用 IStorageKey，字节与元数据仍用字符串键。

| IRecordStore 新成员                             | 返回与语义                                                                                                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getBytes(key, ctx?)`                           | `Promise<Uint8Array \| null>`；缺失为 null。                                                                                                                |
| `setBytes(key, value, ctx?)`                    | value 为 Uint8Array，ctx 为 IWriteOptions，返回 `Promise<void>`。                                                                                           |
| `removeBytes(key, ctx?)`                        | 只删除字节通道里的这个键，文本和记录通道不受影响；键不存在时直接成功，所以重复删除是幂等的。L1 必需方法。                                                   |
| `clearBytes(ctx?)`                              | 清字节通道。                                                                                                                                                |
| `getRecord(key, ctx?)`                          | `Promise<TValue \| undefined>`；缺失为 undefined。                                                                                                          |
| `putRecord(value, key?, ctx?)`                  | `Promise<IStorageKey>`；省略 key 由后端生成并返回，ctx 为 IWriteOptions。                                                                                   |
| `deleteRecord(key, ctx?)`、`clearRecords(ctx?)` | 删除记录，返回 `Promise<void>`。                                                                                                                            |
| `clearAll(ctx?)`                                | 同时清 values、bytes、records 三个业务通道。                                                                                                                |
| `metadata?`                                     | 后端自有的可选维护通道；get(key, ctx?) 返回 unknown 或 undefined，set(key, value, ctx?) 与 delete(key, ctx?) 返回 `Promise<void>`。set 使用 IWriteOptions。 |
| `iterateRecords(range?, ctx?)`                  | 返回异步迭代器，每项为 [IStorageKey, TValue]。                                                                                                              |
| `transaction(run, ctx?)`                        | run 接收 `ITransactionScope<TValue>` 并返回 `Promise<T>`；事务方法返回相同类型的 `Promise<T>`。                                                             |

metadata 供可恢复维护迁移使用，与 values、bytes、records 独立，不属于 clearAll/clearRecords 的清理范围。range 省略时没有显式范围参数；查询行为由实现解释。

#### 运行时准入与能力收窄

| API                                                             | 输入与结果                                                                                                                                                                     |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `isKeyValueStore(store)`                                        | store 为 unknown；要求合法 backend、完整能力描述符和全部 L0 方法可调用。返回布尔，不调用方法，属性访问失败返回 false。                                                         |
| `isRecordStore(store)`                                          | 接收 IKeyValueStore；额外要求全部 L1 方法可调用，并且 records、binary、transactions、iteration 都为 true。                                                                     |
| `asRecordStore<T>(store)`                                       | 返回同一对象的 `IRecordStore<T>` 视图，不包装、不降级；能力不足抛 UNSUPPORTED_CAPABILITY，默认 T 为 unknown。                                                                  |
| `snapshotKeyValueStore(store)`、`snapshotRecordStore<T>(store)` | 输入 unknown；合法时返回新说明对象 { store, backend, capabilities }，否则 undefined，store 仍是原引用。                                                                        |
| `snapshotKeyValueStoreDetailed(store)`                          | 成功为 { valid: true, store, backend, capabilities, dispose, receiver }；失败为 { valid: false, cause }。dispose 是接纳时取得的函数，receiver 是原 store，供所有者保持接收者。 |

准入一次读取相关属性，Detailed 保留精确的反射或 getter 失败原因。轻量谓词和快照返回失败结果；as 断言抛 StorageContractError，并把原始访问器错误保留在标准 cause。`asRecordStore` 的 backend 是探测到的合法后端名，探测失败为 undefined。说明快照不冻结原 store，也不证明后端方法的实现结果；已经拿到说明的组合方应复用它，避免再次触发同一 getter。

### 能力描述符

`IStorageCapabilities` 的九个字段均只读。snapshotStorageCapabilities(value) 接收 unknown，只读取一次并返回新说明对象；不是原引用，也不保证 Object.freeze。字段访问失败或类型非法返回 undefined，不抛错。`isStorageCapabilities(value)` 等价于该快照函数成功与否的布尔判断，不会把规范化字段写回原对象。

| 字段               | 含义、默认与范围                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| `syncRead`         | 必填 boolean，是否有同步读取能力。                                                                       |
| `binary`           | 必填 boolean，是否有字节通道。                                                                           |
| `records`          | 必填 boolean，是否有结构化记录通道。                                                                     |
| `transactions`     | 必填 boolean，是否有事务能力。                                                                           |
| `iteration`        | 必填 boolean，是否有迭代能力。                                                                           |
| `secondaryIndexes` | 新描述符为 boolean；旧描述符可省略，快照规范化为 false。                                                 |
| `changeFeed`       | 新描述符为 boolean；旧描述符可省略，快照规范化为 false。                                                 |
| `maxValueBytes`    | 非负安全整数或 undefined，表示近似单值字节上限；undefined 表示没有这种单值限制声明，仍可能受总配额限制。 |
| `opaqueEntries`    | 必填 boolean，是否可能存在脚本不可见的条目，例如 HttpOnly cookie。                                       |

原有后端说明中的近似值为 cookie 约 4096 字节、localStorage 约 5 MB；IndexedDB 常用 undefined 表示主要受总配额约束。这是能力说明，不是本包测量或实现的配额。

### 操作上下文、写选项与快照

`IOperationContext` 是异步方法末尾的可选参数；`IWriteOptions` 额外允许 conflictPolicy。

| 字段             | 省略值与约束                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| `signal`         | undefined。结构兼容 IAbortSignal：aborted 为 boolean，addEventListener/removeEventListener 为函数。保留原信号引用。 |
| `timeoutMs`      | undefined；提供时为非负安全整数，允许 0。实现层负责超时计时和与外部信号组合，本包只校验。                           |
| `pageSize`       | undefined；提供时必须为 1 到 4096 的整数，用于实现层的分页迭代。                                                    |
| `conflictPolicy` | 快照未提供时仍为 undefined；写入契约的缺省策略为 conflict。合法值是 'conflict'、'replace' 或 undefined。            |

`ConflictPolicy.conflict` 的值为 `'conflict'`，表示已存在则失败；`ConflictPolicy.replace` 的值为 `'replace'`，表示覆盖。使用该常量和 IConflictPolicy，不另造重复常量或别名。

`snapshotOperationContext(ctx)` 接受上下文或 undefined。undefined 原样返回；合法对象的 signal、timeoutMs、pageSize、conflictPolicy 各读一次，返回冻结快照。再次传入本函数产物会返回同一个对象，不重复读取原 getter。非法对象、字段、信号结构或 getter 失败抛 INVALID_ARGUMENT，原始原因通过 cause 保留。`assertOperationContext(ctx)` 调用相同校验，只丢弃返回值。

冻结的是上下文字段，不是信号状态。已经 aborted 的有效信号也能通过形状校验；本包不等待操作、不启动计时器、不创建取消引擎。取消感知后端用 ABORTED 结束等待，不保证原生 AbortError；已经进入原子提交的写应报告真实提交结果，不伪报回滚。

`ISyncWriteOptions` 只允许可选 conflictPolicy。`snapshotSyncWriteOptions(options)` 接受对象或 undefined，读取 signal、timeoutMs、conflictPolicy，拒绝非 undefined 的 signal/timeoutMs；显式的 undefined 字段合法。额外 pageSize 不读取，也不提供同步分页。返回新对象 { conflictPolicy }，不冻结，省略策略仍为 undefined；`assertSyncWriteOptions(options)` 只校验、不返回快照。非法结构、字段或 getter 失败均为 INVALID_ARGUMENT。

### 存储键与范围

`IStorageKey` 为 string、有限 number、有效 Date、ArrayBuffer，或这些值的非空嵌套只读数组。数组不能有空洞或循环。

| API 或常量                                       | 规则                                                                                                                                      |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `assertStorageKey(value, backend, label?)`       | value 为 unknown，backend 为调用方选用的 IBackendKind，只用于错误详情；label 默认 'key'，用于错误文字。非法键抛 INVALID_KEY，并记录原键。 |
| `snapshotStorageKey(value, backend, label?)`     | 同样参数；先校验，再复制 Date、ArrayBuffer 和嵌套数组，最后复验。字符串和数字原样返回；结果与可变原输入分离，但不冻结。                   |
| `assertStringStorageKey(value, backend, label?)` | L0、字节、元数据通道只接受字符串。label 默认 'key'；非字符串为 INVALID_ARGUMENT，不是 INVALID_KEY。                                       |
| `compareStorageKeys(a, b)`                       | 接受两个有效 IStorageKey，返回负数、零或正数，可直接交给 sort；不承诺只返回 -1/0/1。                                                      |
| `KEY_DOMAIN_LIMITS.maxDepth`                     | 32，根深度为 0。                                                                                                                          |
| `KEY_DOMAIN_LIMITS.maxNodes`                     | 4096，包含遍历中的数组和叶节点。                                                                                                          |
| `KEY_DOMAIN_LIMITS.maxBinaryBytes`               | 1,048,576 字节，每个二进制键组件的上限。                                                                                                  |

日期不能是 NaN，数字必须有限。日期和二进制在可用时通过 structuredClone 支持跨 realm 识别；没有该能力时日期使用本地 Date 识别。二进制品牌来自 utils/bytes；constructor.name 不能伪装有效键。复制或复验失败包装为 INVALID_KEY，已是 StorageContractError 的失败直接透传。

排序依次为 number < Date < string < ArrayBuffer < 数组。同类型数字按差值，日期按时间戳，字符串按字典顺序；二进制逐字节比较、相同前缀时短者优先；数组逐段递归比较、相同前缀时短者优先。

`IKeyRange` 有可选 lower、upper（IStorageKey）和 lowerOpen、upperOpen（boolean），表达下界、上界以及是否排除对应边界，语义对应 IDBKeyRange，但不依赖它。字段省略时本包不补默认值，交给实现解释。

### 编解码契约与集合 JSON

`ICodec<T, TRaw>` 的 T 默认 unknown，TRaw 声明默认值为 string | Uint8Array | unknown（等效 unknown）。它有必填 name、output、encode、decode；encode(value, ctx?) 返回 `Promise<TRaw>`，decode(raw, ctx?) 返回 `Promise<T>`。ctx 默认 undefined，使用操作上下文。`ICodecOutput` 的三个值为 text（文本）、binary（二进制）、structured（结构化值）。调用方按输出形态和后端能力选路；本包不把不支持的形态隐式转成其他形态。

`snapshotCodec(codec)` 接受 unknown；要求非 null、非数组的对象，也接纳满足结构的 class 实例。name 必须是 trim 后非空字符串，output 是三种值之一，encode/decode 必须可调用。四个属性各读取一次，返回新的浅说明对象 { name, output, encode, decode }；函数引用不变，不绑定旧 receiver，也不冻结。`assertCodec(codec)` 使用相同校验并将输入类型收窄，不返回说明对象。非法形状或读取失败为 INVALID_ARGUMENT。

`fromValueCodec` 适配 serialize codec，不另建值格式。组合 `defineCollectionsJsonCodec({ version: 1 })`，用 serialize 拥有的 `$rpc` map/entries 与 set/values 保留记录保存 Map/Set。适配器名称为 `collections-json@1`，output 为 text；不支持的值由 serialize 拒绝。

集合之外仍遵循 JSON 表达能力，不是任意对象图的无损序列化。无法表示的根值、循环、BigInt 等 JSON 编码失败，非字符串输入、坏 JSON 或坏保留集合内容，都以 INVALID_ARGUMENT 保留原始 cause。浏览器 structured/binary codec 属于 storage-web；压缩、加密等自定义 codec 实现同一接口接入，不在本包提供。

### 事务作用域与冲突策略

`ITransactionScope<TValue>` 只有 get(key): `Promise<TValue | undefined>`、put(value, key?, options?): `Promise<IStorageKey>`、delete(key): `Promise<void>`。key 为 IStorageKey；put 省略 key 时由实现生成。`ITransactionWriteOptions` 只有可选 conflictPolicy。

隔离级别、提交时机、失败重试由实现定义。本包不执行事务。run 回调 resolve 之后不要继续保存并使用 scope，连接或快照可能已经释放。`assertTransactionCallback(run, backend)` 在实现方分配资源前检查 run 是函数；否则抛 INVALID_ARGUMENT，附 backend。

`readTransactionConflictPolicy(options, backend)` 接受 undefined 或对象；省略 options 或 conflictPolicy 返回 conflict，replace 返回 replace。直接传策略字符串、非法对象或非法字段都会抛 INVALID_ARGUMENT，getter 失败保留精确 cause。它只读取策略，不执行写入。

### 变更通知与二级索引扩展

`IChangeFeedStore` 扩展 L0，提供 subscribeChanges(listener): unsubscribe。listener 接收提交后的 IStorageChange，取消函数由调用方持有并执行。change 的 sequence 是递增序号，origin 是来源；channel 取 value、bytes、record、all，kind 取 put、remove、clear、batch、migrate；scope 与 keys 可省略，keys 为 IStorageKey 数组。这里声明通知形状，不创建通道或跨窗口载体。

`isChangeFeedStore(candidate)` 要求完整 L0、changeFeed 为 true、subscribeChanges 可调用；`asChangeFeedStore(store)` 返回相同对象的能力视图。能力不完整为 UNSUPPORTED_CAPABILITY；方法或能力 getter 失败的原值保留在 cause。

`ISecondaryIndexRecordStore<TValue>` 保留完整 L1，增加以下五个方法：

| 方法                                                     | 输入和返回                                                                        |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `ensureRecordIndexes(scope, definitions, ctx?)`          | scope 是调用方命名的索引作用域，definitions 是定义数组，返回 IRecordIndexHandle。 |
| `getRecordIndexReadiness(handle, ctx?)`                  | handle 来自 ensureRecordIndexes，返回状态及 scanned/indexed 数量。                |
| `putIndexedRecord(value, key, handle, projection, ctx?)` | 使用明确主键、对应句柄和投影写入，ctx 为 IWriteOptions，返回主键。                |
| `iterateRecordIndex(query, ctx?)`                        | 按 query 返回 [主键, TValue] 的异步迭代器。                                       |
| `transactionIndexed(handle, run, ctx?)`                  | run 接收 ISecondaryIndexTransactionScope，返回与回调一致的 Promise 结果。         |

定义的必填字段是 name、unique、multiEntry、revision；句柄的必填字段是 scope、generation、fingerprint。readiness.status 为 pending、running、complete、failed，另有 scanned、indexed 数量。句柄绑定具体 generation，不要仅按索引名字绕过它。

query 必填 handle、index，可选 range、direction（next/prev）、limit；可选字段未提供时保持未设置，具体查询默认由实现决定。projection 按索引名映射到 undefined、{ kind: 'single', key } 或 { kind: 'multiple', keys }。索引事务 scope 有 get(key)、put(value, key, projection)、delete(key)，与普通事务 put 的可选 key/冲突选项形状不同。

`isSecondaryIndexRecordStore(candidate)` 与 `asSecondaryIndexRecordStore(store)` 同时要求完整 L1、secondaryIndexes 为 true、五个扩展方法可调用；不调用方法。断言失败为 UNSUPPORTED_CAPABILITY，反射或 getter 原错在 cause。扩展断言不额外承诺可用 backend 详情，失败时 backend 为 undefined。

### 错误与诊断归属

`new StorageContractError(code, details?, message?)` 创建错误后立即冻结。code 必填；details 默认 {}，字段 backend、key、cause 都可选，默认 undefined。backend 为 IBackendKind，key 为字符串或 IStorageKey，cause 是原始失败。message 省略时为 `[storage-contract] ${code}`。name 为 StorageContractError，source 恒为 `STORAGE_CONTRACT_SOURCE`，即 `'@migaia/storage-contract'`，不重写 stack，标准 cause 仍可追到原对象。

`isStorageContractError(value)` 使用本包类的 instanceof 判断。错误码属于公开 API；实现包自己的错误 source 与这里不同，使用 (source, code) 判断归属。web codec、迁移和扩展的附加诊断细节属于 storage-web，不扩进本包错误详情。

| StorageContractErrorCode 成员 | 码值                     | 应对                                                                 |
| ----------------------------- | ------------------------ | -------------------------------------------------------------------- |
| `invalidArgument`             | `INVALID_ARGUMENT`       | 描述符、上下文、同步写或事务选项等非法；修正参数，不重试相同坏输入。 |
| `invalidKey`                  | `INVALID_KEY`            | 键类型、深度、节点、字节限制、循环、空数组或空洞非法；修正键。       |
| `unsupported`                 | `UNSUPPORTED_CAPABILITY` | 所需能力不存在；先做能力分支或换实现，不静默降级。                   |
| `disposed`                    | `STORE_DISPOSED`         | 已结束的实例继续使用；新建 store。                                   |
| `aborted`                     | `ABORTED`                | 实现层操作被信号或超时取消；按取消处理，原子提交返回真实结果。       |

字节 guard 从 `@migaia/utils/bytes` 导入，不再从本包转出。内部槽品牌识别与字节是否仍可读是两件事，detached 对象仍可能保持品牌。`intrinsicConstructorName(value)` 只做尽力诊断：会观察可修改的原型、constructor 和 name，非对象、null 或读取失败返回 undefined。不能把它用于安全、类型或协议判断。

### 接入步骤与构建

功能模块可以只接受 IKeyValueStore，在真正需要记录能力时按以下顺序接入：

1. 用 snapshotOperationContext(ctx) 校验并保留本次上下文。
2. 用 `asRecordStore<IProfile>`(store) 收窄；不足时直接使用既有的 UNSUPPORTED_CAPABILITY，不另造裸 Error。
3. 在 records.transaction 的回调里使用 tx.get/put/delete，将上下文快照传给 transaction。
4. 返回回调结果；连接、原子提交与失败重试由实际后端负责。

只支持文本的后端需要调用方明确选文本 codec 或转换方式；不能仅看到 binary 标志就跳过完整记录能力准入。自定义 gzip、加密或 Worker codec 先用 assertCodec/snapshotCodec 校验，再交给实现层使用。

```bash
pnpm run fmt
pnpm run lint
pnpm run typecheck
pnpm run typecheck:test
pnpm run test
```

## 版本 envelope 与链式升级

`assertVersionedEnvelope` 校验普通对象上的自有 `version` 与非空 `state`，只读取每个属性一次，并保留 state 引用。计划在创建时快照并冻结连续的版本步骤。纯转换器不持有连接，不写存储，也不负责释放调用方资源。

```ts
import {
  assertVersionedEnvelope,
  createMigrationPlan,
  migrateEnvelopeSync,
  StorageContractError
} from '@migaia/storage-contract'

try {
  createMigrationPlan({ version: 3, steps: { 1: (value) => value, 3: (value) => value } })
} catch (error) {
  if (!(error instanceof StorageContractError)) throw error
  console.log(error.code) // MIGRATION_GAP
}

const plan = createMigrationPlan({ version: 2, steps: { 2: (value) => ({ previous: value }) } })
try {
  migrateEnvelopeSync(plan, assertVersionedEnvelope({ version: 3, state: {} }))
} catch (error) {
  if (!(error instanceof StorageContractError)) throw error
  console.log(error.code) // VERSION_UNSUPPORTED
}

const originalError = new Error('upgrade failed')
const failing = createMigrationPlan({
  version: 1,
  steps: {
    1: () => {
      throw originalError
    }
  }
})
try {
  migrateEnvelopeSync(failing, { version: 0, state: {} })
} catch (error) {
  if (!(error instanceof StorageContractError)) throw error
  console.log(error.code, error.cause === originalError) // MIGRATION_FAILED true
}
```

`migrateEnvelope` 支持异步步骤和取消信号；即使版本相等，也先检查取消。同步入口拒绝已知的异步步骤，运行期遇到 thenable 同样拒绝并消费迟到拒绝。`{ version, reset: () => ({}) }` 计划对旧档只重置一次，同版保留引用，未来版本仍拒绝。步骤对 state 的原地修改及外部副作用不会回滚。

`observe.beforeStep` 与 `observe.afterStep` 只观察，不等待返回值。观察失败交给同步 `observe.report`，不改变迁移结果；省略时使用 utils 的宿主异常报告。资源释放、宿主管线与存储写回由各自拥有者负责。

## 能力令牌与实现

`defineStorageCapability` 只创建冻结的 API 令牌，不提供存储实现。后端作者通过 `implement` 提供真实实现，再由 `provideCapabilities` 改装原有基础对象。种类名与能力名只用于诊断，同名令牌仍是不同权限。提供方保留类方法、非枚举成员以及具体 API 类型，不克隆基础对象。

```ts
import {
  defineStorageCapability,
  implement,
  provideCapabilities,
  type IStorageBase
} from '@migaia/storage-contract'

const catalog = defineStorageCapability<{ read(key: string): Promise<string | null> }>()('catalog')
function attachCatalog(base: IStorageBase, read: (key: string) => Promise<string | null>) {
  return provideCapabilities(base, [implement(catalog, { read })])
}
```

这是后端内部的装配函数，实际 store 仍由宿主安装与释放。`store.use(catalog)` 返回原实现对象；真实但未登记的令牌抛带后端名与能力名的 `UNSUPPORTED_CAPABILITY`，伪造令牌抛 `INVALID_ARGUMENT`。`store.has(token)` 同步返回布尔值。标准 `kv` 令牌同时提供原有平铺方法，`has(key, ctx)` 保留异步键查询。

宿主通过 `onInstaller` 捕获本 store 唯一的安装口。`prepare` 先验证整批真实记录并保留令牌，`publish` 才使能力可见，`release` 幂等撤回该批。失败不调用基础对象的 `dispose`；资源回滚仍由创建它的后端拥有。事务与查询链的实际执行由其既有拥有者实现，类型投影不会创建事务或获得连接。

### fromValueCodec

```ts
import { fromValueCodec } from '@migaia/storage-contract'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'

const codec = fromValueCodec(defineJsonCodec({ version: 2 }))
const raw = await codec.encode({ count: 1 })
console.log(codec.name, codec.output, await codec.decode(raw))
// json@2 text { count: 1 }
```

冻结适配器只读取一次五个元数据/回调字段。文本、字节与 unknown 载体分别映射为 text、binary 与 structured 存储路由。encode 与 decode 独立保留输入类型，因此 tagged codec 的旧格式解码输入不会丢失。两条回调各调用一次并等待结果；同步抛错与 Promise 拒绝统一包装为 contract `INVALID_ARGUMENT`，cause 保留原始错误。适配器不二次解析、复制值、派发 hooks 或创建资源/连接。`StorageStageKind` 与 `ICodecStageObserver` 仅描述观察；绑定真实 store 的派发仍归宿主。

### 资源基础准入与观察端口

`snapshotStorageBaseDetailed(candidate, { asyncDisposeKey }?)` 对 `IStorageBase` 准入，不要求键值方法。它只读取一次后端名、能力事实与清理函数。有效的 `IStorageBaseAdmission` 保留原 `store`、捕获的 `backend`、独立 `capabilities`、`dispose`、`receiver` 和可选 `asyncDispose`；普通形状失败返回 `{ valid: false, cause: undefined }`，反射失败则保留精确原错。冻结或已装配的基础对象仍可通过，因为准入不安装方法，也不取得资源所有权。

外层宿主可传入固定的规范 `asyncDisposeKey`；否则使用原生 `Symbol.asyncDispose`，原生键不存在时只要求显式释放。契约不会创建后备符号，也不会在准入时调用清理函数。提供方专属的可扩展性与安装条件仍由 `provideCapabilities` 校验。

`IBackendStageBindings` 连接 backend、operation、codec、transaction、concurrency、SQL 与 query 七个独立观察家族。规范 `kind` 字面量阻止不同家族误用。这些声明不提供执行器或第二套 registry；宿主将观察者绑定到原 store 与事务视图。`IConcurrencyHolder` 区分真实持有者与远端交接区间，`IConcurrencyDecision` 排除 wait/reject/retry 不相容的字段。
