# `@migaia/storage-contract`

[English](./README.en.md)

为功能模块和存储实现提供共同接口、键域与校验边界，让业务按能力使用存储，并在文本中保留 Map/Set。实际读写由后端负责。

## 你可能遇到过

- 切换后端就要改业务代码，根因是功能模块依赖具体实现，没有共同接口。
- 权限中的 Map/Set 从 JSON 读回后变成普通对象，根因是原生 JSON 不表达集合类型。
- 等待异步写入时键悄悄变化，根因是操作仍引用调用方的数组、日期或缓冲区。
- 各层读出不同的超时或冲突策略，根因是重复访问可变化的选项 getter。
- 日志只剩一句失败消息，根因是边界重建错误时丢了来源、码值和原始 cause。

## 为什么选它

- **文本往返后仍是集合。** 普通 JSON 会丢掉 Map/Set；共享 serialize 集合 codec 在两端使用同一保留记录并还原嵌套类型。[运行证明](./USEGUIDE.md#从文本恢复嵌套的-map-与-set)。
- **键的可变组件不再与调用方共享。** 浅拷贝数组仍共享 Date 和缓冲区；键快照递归复制并复验这些组件。[运行证明](./USEGUIDE.md#在调用方修改前捕获复合键)。
- **能力分支基于接纳时的完整描述。** 只检查真假可能接纳错误字段，继续引用原对象又会让判断漂移；能力快照校验字段，只给旧版缺失的两个标志补 false，并返回独立记录。[运行证明](./USEGUIDE.md#选择通道前规范化旧版能力描述)。
- **同一次操作只有一份选项记录。** 重读 getter 可能改变意图；上下文快照各字段只读一次、冻结并可复用，同时把取消执行留给后端。[运行证明](./USEGUIDE.md#只读取一次操作选项把取消执行留给后端)。
- **错误可以追到同一个原始对象。** 只拼消息会丢失诊断链；契约错误保存稳定 source/code 和精确 cause。[运行证明](./USEGUIDE.md#报告契约错误时保留原始失败)。

## 从这里开始

把嵌套权限集合编码为文本，再恢复真实的集合实例：

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

遇到异步操作中键被修改，看[键快照](./USEGUIDE.md#在调用方修改前捕获复合键)；遇到各层重读选项，看[上下文快照](./USEGUIDE.md#只读取一次操作选项把取消执行留给后端)。

## 手写时的隐患

同一份权限数据直接用原生 JSON 处理会出现以下问题。此例只展示隐患，不运行：

```ts doc-test=check
const settings = { roles: new Map([['Ada', new Set(['read', 'write'])]]) }
const raw = JSON.stringify(settings) // 隐患：Map 的条目变成空对象，嵌套 Set 也无法保留。
const restored = JSON.parse(raw) as typeof settings // 隐患：类型断言不会恢复运行时集合。
console.log(restored.roles.get('Ada')) // 隐患：roles 是普通对象，调用 get 会抛错。
```

上一节的 codec 负责版本标记与集合还原，不需要调用方分别维护替换器和还原器。它仍受 JSON 数据模型限制，不支持循环，也不负责把文本保存到任何后端。

## 三分钟心智模型

| 你要处理的问题                     | 使用的工具                                             |
| ---------------------------------- | ------------------------------------------------------ |
| 功能模块只需要字符串读写           | IKeyValueStore（L0）                                   |
| 需要字节、记录、迭代和事务         | IRecordStore（L1），先用 asRecordStore 收窄            |
| 接纳外部描述或会变化的选项         | snapshotStorageCapabilities / snapshotOperationContext |
| 异步工作不能继续引用调用方的可变键 | snapshotStorageKey                                     |
| 文本需要保留 Map/Set               | fromValueCodec                                         |

“契约”是实现方与调用方共同遵守的输入、输出和错误规则；“能力”描述当前对象实际提供的操作；“收窄”是在运行时检查后使用更具体的接口；“快照”是捕获当前值，是否复制或冻结由具体 API 决定；“codec”是值与存储表示之间的编解码器。

## 典型场景

| 场景                                   | 怎么组合                      | 详细说明                                                       |
| -------------------------------------- | ----------------------------- | -------------------------------------------------------------- |
| 在调用方修改前捕获复合键               | `snapshotStorageKey`          | [完整示例](./USEGUIDE.md#在调用方修改前捕获复合键)             |
| 把普通对象作为记录键前先拒绝           | `snapshotStorageKey`          | [完整示例](./USEGUIDE.md#把普通对象作为记录键前先拒绝)         |
| 只读取一次操作选项，把取消执行留给后端 | `snapshotOperationContext`    | [完整示例](./USEGUIDE.md#只读取一次操作选项把取消执行留给后端) |
| 从文本恢复嵌套的 Map 与 Set            | `fromValueCodec`              | [完整示例](./USEGUIDE.md#从文本恢复嵌套的-map-与-set)          |
| 选择通道前规范化旧版能力描述           | `snapshotStorageCapabilities` | [完整示例](./USEGUIDE.md#选择通道前规范化旧版能力描述)         |
| 报告契约错误时保留原始失败             | `StorageContractError`        | [完整示例](./USEGUIDE.md#报告契约错误时保留原始失败)           |

## 安装

```bash
pnpm add @migaia/storage-contract
```

在工作区中使用时可以指定 `@migaia/storage-contract@workspace:^`。运行时依赖 `@migaia/utils`；需要实际后端时选择实现该契约的包。

## 常用 API

| API                                                | 什么时候用                                  |
| -------------------------------------------------- | ------------------------------------------- |
| IKeyValueStore / IRecordStore                      | 定义功能与实现之间的 L0/L1 边界             |
| asRecordStore                                      | 调用记录方法前确认完整能力                  |
| fromValueCodec                                     | 将 JSON 兼容数据中的 Map/Set 编成文本并还原 |
| snapshotStorageKey                                 | 在异步工作前校验并复制键                    |
| snapshotOperationContext                           | 一次捕获操作选项                            |
| snapshotStorageCapabilities / StorageContractError | 接纳能力描述，报告可追溯的契约失败          |

## 契约细节

### 公开入口、归属与边界

本包只有根入口 `@migaia/storage-contract`，没有子路径导出。它提供存储接口、能力描述、键域、操作上下文、编解码器接口、事务作用域和契约错误，也提供校验与快照函数、集合 JSON 编解码器。运行时依赖 `@migaia/utils`；结构化取消信号类型 `IAbortSignal` 来自 `@migaia/utils/promise`。

这里没有持久化后端，不打开数据库、不写磁盘，不依赖 DOM、IndexedDB 或 Node。真正的连接、读写、提交、隔离与重试属于实现包，例如 `@migaia/storage-web`。功能模块依赖接口；实现包依赖这份契约，契约不反向依赖实现。压缩、加密或 Worker 重编码可以实现同一个 codec 接口接入，但本包不实现这些扩展。

L0 指所有后端提供的字符串键值通道；L1 指额外提供字节、结构化记录、迭代与事务的通道。能力描述说“能做什么”，不是按后端名字猜测。收窄函数检查描述符和可调用方法，不执行后端读写。

### L0、同步通道与 L1

`IBackendKind` 为开放字符串类型；运行时准入要求符合 `[a-z][a-z0-9-]{0,63}`。名称用于描述后端，不授予能力访问权限。`IKeyValueStore` 的只读 `backend`、`capabilities` 描述后端与能力。下表的 key 均为字符串；异步方法的 ctx 默认 `undefined`，字段见操作上下文。

| IKeyValueStore 成员     | 返回与语义                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `get(key, ctx?)`        | `Promise<string \| null>`；不存在返回 null，不是 undefined。                                        |
| `set(key, value, ctx?)` | `set` 将字符串 value 写入指定 key，ctx 使用 IWriteOptions；返回用于等待这次写入的 `Promise<void>`。 |
| `remove(key, ctx?)`     | `remove` 删除字符串值通道中的指定 key，返回用于等待这次删除的 `Promise<void>`。                     |
| `has(key, ctx?)`        | 返回 `Promise<boolean>`。                                                                           |
| `keys(ctx?)`            | 返回 `Promise<string[]>`。                                                                          |
| `clearValues(ctx?)`     | 只清字符串值通道，返回 `Promise<void>`。                                                            |
| `clearAll(ctx?)`        | 清当前 store 的业务数据通道，返回 `Promise<void>`。                                                 |
| `dispose()`             | 结束后端实例的使用寿命，返回 `Promise<void>`。                                                      |
| `sync?`                 | 可选 ISyncKeyValueStore；仅同步后端提供，异步后端为 undefined。                                     |

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
| `transaction(run, ctx?)`                        | run 接收完整 scope 并返回 TResult；事务方法返回 `Promise<Awaited<TResult>>`。                                                                               |

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

| 字段               | 含义、默认与范围                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `syncRead`         | 必填 boolean，是否有同步读取能力。                                                                                        |
| `binary`           | 必填 boolean，是否有字节通道。                                                                                            |
| `records`          | 必填 boolean，是否有结构化记录通道。                                                                                      |
| `transactions`     | 必填 boolean，是否有事务能力。                                                                                            |
| `iteration`        | 必填 boolean，是否有迭代能力。                                                                                            |
| `secondaryIndexes` | secondaryIndexes 为 boolean，表示后端是否提供逻辑二级索引操作；旧描述符省略该字段时，快照把 secondaryIndexes 设为 false。 |
| `changeFeed`       | changeFeed 为 boolean，表示后端是否发送提交后的失效通知；旧描述符省略该字段时，快照把 changeFeed 设为 false。             |
| `maxValueBytes`    | 非负安全整数或 undefined，表示近似单值字节上限；undefined 表示没有这种单值限制声明，仍可能受总配额限制。                  |
| `opaqueEntries`    | 必填 boolean，是否可能存在脚本不可见的条目，例如 HttpOnly cookie。                                                        |

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

`snapshotOperationContext(ctx)` 接受上下文或 undefined。undefined 原样返回；合法对象的 signal、timeoutMs、pageSize、conflictPolicy、orgId 各读一次，返回冻结快照。再次传入本函数产物会返回同一个对象，不重复读取原 getter。非法对象、字段、信号结构或 getter 失败抛 INVALID_ARGUMENT，原始原因通过 cause 保留。`assertOperationContext(ctx)` 调用相同校验，只丢弃返回值。

冻结的是上下文字段，不是信号状态。已经 aborted 的有效信号也能通过形状校验；这些上下文工具不等待操作、不启动计时器、不创建取消引擎。取消感知后端用 ABORTED 结束等待，不保证原生 AbortError；已经进入原子提交的写应报告真实提交结果，不伪报回滚。

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

`ITransactionScope<TValue>` 覆盖文本 `get/set/remove/has`、字节 `getBytes/setBytes/removeBytes` 与记录 `getRecord/putRecord/deleteRecord/iterateRecords`。文本和字节缺失返回 null，记录缺失返回 undefined；记录键为 IStorageKey，putRecord 省略 key 请求后端生成。旧记录 put/delete 名称已移除，get 改为读文本。方法继承事务上下文，只有写入接收精简冲突选项。可选 putIndexedRecord/iterateRecordIndex 由 ISecondaryIndexTransactionScope 引用同一签名，不重复声明。

`createTransactionOwner` 登记原 store 与真实视图身份。后端私持 register/createScope/onFailure 和生命周期控制；功能模块通过 assertTransactionOwner、runTransactionOperation、registerTransactionFinalizer 与 nextTransactionIterator 接入。操作入口同步开始，并获得完整新视图。stopAdmission 只封闭用户视图，已接纳操作继续在自己的视图排空。每个检查和最后库内 beforeCommit 都使用新视图，只运行一次，排空子请求并释放迭代器后再运行下一检查。已 catch 或未 await 的操作失败仍锁定后端归一的首错并通知回滚。本包不创建数据库、runner 或隐式当前视图。

`register` 还可接收后端已捕获的 `context`。它复用 `snapshotOperationContext` 单次保存冻结字段与原 signal；`readTransactionOperationContext(scope)` 只在真实有效的用户、操作或检查视图返回同一快照，省略时返回 undefined，伪造或过期视图抛 INVALID_ARGUMENT。终态 close 释放原登记的上下文引用；该只读接点不授予登记、关闭或取消控制权，不创建第二套超时预算。

`ITransactionScope.isRecordIndexReady?(handle)` 是可选的同事务只读查询：缺失、待就绪或失效索引返回 false；只有当前原生快照中的完整元数据与句柄 generation、fingerprint 都一致才返回 true。它不建立或刷新索引，也不另开事务；未提供该方法的既有 scope 仍合法。`ISecondaryIndexTransactionScope` 仍只要求原来的索引读写方法。

`deriveTransactionIterator(iterator, read, close?)` 只从原 owner 已登记的实际 iterator 派生资源；未登记源返回 undefined，不调用 read 或 close。read 的参数依次是原推进函数、原首错传播函数和该次真实 next 的 `currentScope`，旧的两参数回调仍有效；当前视图只在本次完整推进结算前有效。可选 close 用于释放读取期间惰性创建的附属真实游标；原资源生命周期先等已准入推进真正结束，再按逆序先关闭附属源、后关闭原 source，两者都尝试。首个失败立即沿原 state 锁定，后续清理失败沿同一 cleanupFailure 聚合并保留 cause；无附属 close 时直接复用原 cleanup。该接点不授予自由构造视图、登记或关闭 store 的权限，不新增登记表或生命周期。

普通与索引记录迭代统一返回 IStorageIterator，IKeyValueStore 继承唯一 IStorageResource 声明。拥有者只登记真实迭代器，以当前有效视图推进每次 next，等已接纳推进结束，再按创建的相反顺序关闭剩余资源。dispose 返回缓存的拒绝主 Promise，固定符号方法返回独立缓存、报告后成功的 Promise；return 与自然结束使用同一次真实清理。缺少原生符号时由外层传入规范 asyncDisposeKey，契约不创建后备键。伪造、错 store 或过期 scope 的绑定同步抛 INVALID_ARGUMENT；过期数据方法拒绝预存的后端 TRANSACTION_FAILED，不再调用工厂或数据回调。

本包拥有中立事务协调，真实提交、隔离、取消与重试仍归后端。IndexedDB 严守原生活跃窗口：外部数据应先取再开事务，await 定时器后可能不能继续请求；memory 与 SQLite 自行管理活跃期。assertTransactionCallback 在分配后端资源前校验可调用性。声明与包内假后端验证不能替代真实后端原子持久化验收。

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
3. 在 records.transaction 的回调里使用 tx.getRecord/putRecord/deleteRecord，将上下文快照传给 transaction。
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

原 `IKeyValueStore` 与 raw KV 准入保留七个普通方法，不承诺缺失的原生批量入口。已发布的标准 `kv` API 及其平铺投影要求 `getMany`、`setMany`、`removeMany` 和 `removeByPrefix`。批量键接受 `IStorageKey`，单点与同步入口仍只接受字符串；同一字符串在两类入口共享值、锁、修订和期限。getMany 保持输入顺序与重复位置，缺失为 undefined；setMany 的规范重复键在 I/O 前拒绝，removeMany 去重后返回实际删除数。批写由后端在一次原生事务中执行，空批不打开事务或发观察事件；ttlMs 需要已登记 ttl 能力，否则在 I/O 前拒绝。provider 只转发原方法一次，保留输入、ctx、receiver 和 Promise。

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

### 保序键字节

`encodeOrderedStorageKey(key, backend)` 先复用 `snapshotStorageKey` 的校验与复制，再返回独立持有的 `Uint8Array`。字典字节序与 `compareStorageKeys` 一致，涵盖正负零、Date、UTF-16 码元、二进制前缀与嵌套数组前缀。写入器只测量一次，再顺序写入一份预分配空间，不排序，也不反复拼接已完成的子编码。此编码供记录索引与锁排序复用，不替换持久化值 codec 或旧平面存储键。

### 真实并发策略

```ts
import { ConcurrencyPolicy, defineConcurrencyPolicy } from '@migaia/storage-contract'

const wait = ConcurrencyPolicy.wait({ timeoutMs: 2_000 })
const fail = ConcurrencyPolicy.fail()
const optimistic = ConcurrencyPolicy.optimistic({ retries: 2, backoffMs: 10 })
const custom = defineConcurrencyPolicy({
  name: 'retry-twice',
  locking: 'pessimistic',
  decide: (conflict) =>
    conflict.attempt <= 2 ? { action: 'retry', delayMs: 10 } : { action: 'reject' }
})
console.log(wait.name, fail.name, optimistic.locking, custom.name)
// wait fail optimistic retry-twice
```

工厂只读取一次定义字段，冻结公开的 name/locking 元数据，私下保存原决策回调。复制或结构伪造的策略会被拒绝。允许零预算；时长与重试次数必须为非负安全整数。定义或选项 getter 失败以 INVALID_ARGUMENT 保留精确 cause。创建策略不执行决策回调、事务或取锁。

原事务 owner 只捕获一次 defaultPolicy 与 concurrencyStages；省略策略时只创建一次 wait 缺省值，真实显式覆盖值优先。缺省解析只使用同一私有 owner 登记，不读公开 store 字段，不建立另一套 store registry。wait 缺省逻辑准入预算为 30,000 ms，optimistic 缺省对三个冲突按 20 ms 退避。下文的决策循环仍须接入后端真实锁；策略元数据本身不能证明原生锁行为。

### 规范锁键

```ts
import { lockKey } from '@migaia/storage-contract'

const original = new Date(0)
const saved = lockKey.record(original)
original.setTime(1_000)
console.log(saved.channel, saved.key instanceof Date && saved.key.getTime())
// record 0
```

lockKey.text 与 lockKey.record 接收原有 typed storage-key 域，lockKey.bytes 只接收字符串。工厂立即校验并分离 Date、ArrayBuffer 与嵌套数组，只冻结通道/键容器。此时尚无 store，失败的 backend 诊断为 undefined；既有 assertStorageKey、snapshotStorageKey 与 assertStringStorageKey 的第二参数因此接纳 IBackendKind | undefined，函数 arity 与业务键域不变。

原并发 owner 的内部规范化传入真实 backend，锁字段只读一次，只添加物理通道前缀，并调用唯一保序键编码器。显式 MSD 后缀栈使用固定字节/结束桶与一份 scratch 数组，相邻规范字节去重等值 Date、buffer、tuple 与正负零。text、bytes、record 保持分离，typed text 数值 1 与字符串 '1' 也不同。工作与空间随总键字节及键数增长，不使用比较排序、最长键填充或全局身份缓存。实际取锁仍由后端执行边界负责。

### 组织键与上下文

`IOperationContext.orgId` 可选，接收规范小写、36 字符 UUID（包括全零 UUID）。`assertOperationContext({ orgId })` 复用同一准入；`snapshotOperationContext` 单次读取并捕获身份，省略或显式 undefined 均不新增 orgId 属性。默认组织与 UUID 生成由外层 host 负责。

`prefixStorageOrgKey(orgId, key)` 返回独立快照 `['$o', orgId, key]`，数组逻辑键保持嵌套在第三项。`unprefixStorageOrgKey(orgId, key)` 只接纳相同组织的精确三项封装，返回独立逻辑键快照。错误组织、大小写错误或无效封装为 INVALID_ARGUMENT；内部无效逻辑键仍为 INVALID_KEY。外层封装不占用逻辑键的深度与节点预算。这些纯函数不创建存储、不选择 namespace，也不执行跨组织 I/O。

### 并发执行

后端与 persist 作者直接把原 options 交给 `runWithConcurrency({ store, options }, port)`；原 store 必须已登记事务 owner。循环只捕获一次借用 getter，再解析捕获的覆盖策略或原 owner 默认策略；显式 request.policy 仍是唯一生效策略，保留原校验与错误。传入真实外层 attempt context 保留精确私有期限与规范锁，无需复制。循环在操作上下文字段前读取 lock/concurrency，只规范化一次锁身份；后端扩展选项仍由原后端准入。

`IConcurrencyPort.attempt(context)` 必须真正结束原生事务、回滚和清理后，才返回冲突或抛错。循环先 try，只对真实冲突决策；仅 acquire 可 wait，旧尝试结束后才能 retry。拒绝准入为 LOCK_REJECTED；拒绝提交冲突为 WRITE_CONFLICT，并保留精确后端 cause。非法决策或策略抛错为 CONCURRENCY_POLICY_FAILED。后端确认自身租约被替换时使用 LOCK_LOST。

`context.wait(pendingAdmission)` 统计逻辑准入等待并消耗策略预算；`context.waitPhysical(pendingPhysical)` 统计物理调度，不消耗逻辑预算。回调与清理时间均不计入等待。整体期限从入口开始，到期为 ABORTED，但物理等待期间到期为 LOCK_TIMEOUT。外部取消把原 reason 保留在 cause。零逻辑预算仍允许物理调度，省略整体期限不添加物理缺省上限。超时仅结束等待；port 仍负责取消/移除队列项，并等待已接纳工作真正结束后再结算。

内层 store 接收同一个 attempt context 时复用外层预算与组合 signal，仅最外层释放 signal。循环观察失败只报告，不改变结果。后端在真实生命周期边界发 acquired/released/lost；循环发准入入口、冲突、决策、等待和重试观察。包内测试通过不代表原生后端整体验收通过。

LOCK_REJECTED 与 LOCK_TIMEOUT 携只读 keys、holder。已确认身份时消息含逻辑/规范键身份与真实 label；交接窗口明确写 handing-off，不借用前任身份。物理调度无法提供身份时，物理超时仍携声明键，holder 为 undefined。

循环也把已捕获的原生扩展选项与 symbol 字段传给每次 attempt 及接收同一 context 的内层调用；覆盖规范上下文字段时不丢后端扩展，也不再读取固定字段 getter。

### 不可变事务 builder

`createTransactionBuilder(store, options?)` 接收具备真实 transaction 签名的原登记 store。根对象只有 lock/concurrency/signal/timeout，没有 run；声明至少一个锁后才启用 run。每次派生返回独立不可变分支，每次 lock 只快照新增键。run 用显式栈展开共享历史，经原 owner 只规范化一次，再直接调用原 transaction 一次；保留原 Promise 身份、完整原生 scope 与 options 类型。配置不创建期限、队列或 I/O。

`IRecordStore.transaction` 与索引事务选项包含原 `ITransactionOptions` 的 lock/concurrency 字段。具体 tx()/inspectLocks 方法仍由真实实现接入。对已安装且登记的记录 store：

```ts
import { createTransactionBuilder, lockKey, type IRecordStore } from '@migaia/storage-contract'
function readLocked(store: IRecordStore<{ count: number }>) {
  return createTransactionBuilder(store, { pageSize: 50 })
    .lock(lockKey.record('counter'))
    .timeout(2_000)
    .run((tx) => tx.getRecord('counter'))
}
```

### 声明式条件编译器

`compileStorageWhere<T>(where)` 只捕获一次 typed `IWhere<T>`，返回 `(value: T) => boolean`。嵌套对象字段与多个约束按 AND 组合，显式 and/or/not 保留短路顺序。`QueryOperator` 统一拥有 eq、ne、in、exists、gt、gte、lt、lte、between、startsWith、contains、has；in 列表只复制、编译为 Set 一次，路径复用原 utils 准入。

相等与成员判断使用 SameValueZero，包括 0/-0 同值与显式对象身份；普通 nested object 语法则检查其字段。Date 操作数捕获时间点。范围仅比较相同 number、bigint、string 或 Date 域，不强制转换类型；exists 区分缺失路径与存在的 undefined。操作数保留 portable 标量载体、已声明的 undefined/bigint/Date 比较、不透明对象身份及列表。后端只有结构等值时，显式对象身份比较必须在客户端执行。非法条件、路径和反射失败在读取候选前以 INVALID_ARGUMENT 保留精确 cause。编译器不打开数据源、不创建查询 owner。

```ts
import { compileStorageWhere } from '@migaia/storage-contract'
const accepts = compileStorageWhere<{ status: string; total: number }>({
  status: 'paid',
  total: { gte: 100 }
})
const rows = [
  { status: 'paid', total: 120 },
  { status: 'paid', total: 50 }
]
console.log(rows.filter(accepts).length) // 1
```

### 只读 capability 访问

`hasStorageCapability(store, token)` 与 `useStorageCapability(store, token)` 读取原 provider 表，不安装方法、不发布能力、不取得所有权，也不返回 provider/base 控制句柄。token 语义与原 store.has(token)/store.use(token) 完全一致：真实已发布 token 返回同一 API 身份；伪造 token 的 has 返回 false、use 抛 INVALID_ARGUMENT；真实缺失 token 抛 UNSUPPORTED_CAPABILITY。未提供能力的 raw 或 frozen 资源保持缺失且不被修改。已提供 store 复用捕获的 backend 诊断，不重新读取 getter；use 保留原生实现的精确扩展类型。晚发布 Feature 的 prepare/publish/release 通过同一表立即可见；原 store.has(stringKey) 的 KV 转发保持不变。

```ts
import {
  hasStorageCapability,
  useStorageCapability,
  kv,
  type IStorageBase
} from '@migaia/storage-contract'
async function readGreeting(store: IStorageBase) {
  if (!hasStorageCapability(store, kv)) return undefined
  return useStorageCapability(store, kv).get('greeting')
}
```

### 共用记录执行器

`createRecordQuery<T,TContext,TAugmentMethods>(source, methods?)` 创建共用记录执行器。`IRecordQuery` 在公共 where/select/all/stream/explain/requirePushdown 上增加普通 `limit(count)` 与 `orderByComparator(compare).limit(count)`。比较器声明显式上限前没有 typed 读取终点；绕过类型后的缺失上限与无效 limit 都在数据源执行前以 INVALID_ARGUMENT 拒绝。limit 接受非负安全整数。比较器通过稳定、有界堆选择结果，时间 O(c log k)、保留候选 O(k)，最后只排列堆内结果；本切片的两个控制都在客户端执行。选择后移除 where/select。TContext 为 undefined 时，编译期拒绝新的操作上下文。

`all` 与 `stream` 返回的真实 `IStorageIterator` 共用同一个节点读取器和原游标。普通 limit 达到上限后不再推进数据源。已登记事务流复用原迭代器登记，清理前排空已接纳的完整映射 next；原游标耗尽后的堆内结果仍需原 scope 准入。根流与事务流复用同一迭代器生命周期实现，主清理和符号清理都会等待已接纳的完整映射后才释放原数据源；mapper 失败保留在原 next 结果上，清理仍保留自身数据源失败策略。可选的 Feature 纯方法在每个派生链保留原函数引用，省略方法不分配空方法表。`IQueryShape` 与 `IQueryResultOf` 保留泛型终点结果推断。

数据源只捕获一次 `IQueryPushdown` 与原 execute 回调。不可变链节点共享历史，执行或 explain 只展开一次；记录查询把最长安全原生前缀作为规范条件 AST 与可选投影字段交给数据源。JS 谓词、mapper 与不透明对象身份比较在客户端执行；后续步骤不能越过客户端边界下推。`QueryOperation` 是共用词汇，不表示所有同名链方法都已实现。explain 不读数据；仅声明索引与原生条件时才保守地排除 fullScan。requirePushdown 在开游标前以 QUERY_NOT_PUSHABLE 与客户端原因拒绝。

`IRecordQuerySource.asyncDisposeKey?: typeof Symbol.asyncDispose` 是只读的来源资源键，也只读取并捕获一次；显式值须为 Symbol 或 undefined，否则以 INVALID_ARGUMENT 拒绝。省略或 undefined 时沿用原生 `Symbol.asyncDispose`；后端使用宿主既有后备键时，应传入同一个 `asyncDisposeKey`。根映射流的符号清理入口与原游标的诊断转发使用此键，保留独立缓存的主清理与符号清理 Promise，以及原清理 owner；契约不创建后备符号。

`execute({conditions,fields,ctx})` 返回原 `IStorageIterator<readonly [IStorageKey,unknown]>`，原生投影行不会谎称完整 T 域。all 按顺序处理候选，并始终等待原迭代器真实 dispose Promise；不创建第二资源 owner、计时器或事务，取消/期限仍由原数据源负责。原事务迭代器上的 all 同步把完整消费、mapper 与清理区间登记到同一 owner；回调未等待 all 也不能在其结束前提交，mapper 首错在清理前进入原 firstFailure。回调失败保留已有 coded 身份；未编码可变原生错误附 INVALID_ARGUMENT，附着失败由原错误工具保留原错。清理失败不能覆盖首错。不透明身份操作数，包括含 Date/bigint 的对象，从不遍历内容。

```ts
import { createRecordQuery, type IRecordQuerySource } from '@migaia/storage-contract'
function totals(execute: IRecordQuerySource['execute']) {
  return createRecordQuery<{ status: string; total: number }>({
    pushdown: { source: 'supplied-cursor', operations: [], operators: [] },
    execute
  })
    .where({ status: 'paid' })
    .where('total', 'gte', 100)
    .select('total')
    .all()
}
```

传入的游标必须是真实后端资源；当 paid total 为 120、50 时，totals 返回 `[{total:120}]` 并等待清理。完整方法与当前限制见后文。

### 标准 records 能力

`records` 是 `IRecordsApi<TValue>` 的真实标准 token；其 `query<R = TValue>()` 返回已实现的共用 `IRecordQuery<R>`：条件、一次 select、有界比较器排序、limit、all、stream、explain 与 requirePushdown。原生后端与 Feature 通过 `createRecordQuery` 提供查询，保持原迭代器/事务 owner，不另建查询执行器。标准准入只检查 query 与 removeByPrefix 可调用，不调用它们。旧 capabilities.records 布尔值不授予 token 权限，也不代替真实 Feature API。

`removeByPrefix(prefix, ctx?)` 属于所提供的原写入 pipeline，返回真实删除数；ctx 包含原 IWriteConcurrencyOptions。provider 返回精确 API 对象，保留原生默认行类型/API 扩展，不包装删除 Promise、不复制 prefix/ctx。具体后端删除、事务能力投影与其他查询终点仍待后续实现切片。

```ts
import { records, useStorageCapability, type IStorageBase } from '@migaia/storage-contract'
async function paidTotals(store: IStorageBase) {
  return useStorageCapability(store, records)
    .query<{ status: string; total: number }>()
    .where({ status: 'paid' })
    .select('total')
    .all()
}
```

`readConcurrencyLockIdentities(ctx)` 读取真实活跃 attempt 的原元数据，返回包含通道隔离、按规范排序去重的不可变小写十六进制身份列表；列表只从已有编码字节生成一次，重复读取与嵌套尝试共用同一列表，不重新编码逻辑键、不暴露可变内部字节。伪造、已结算或只有 builder 元数据的 context 抛 INVALID_ARGUMENT；函数不授予登记、取锁或资源控制权。

`snapshotConcurrencyLockHoldings(rows)` 对当前检查行制作独立快照，复用同一通道与键字节顺序稳定排序，保留每行的 holder、expired 与 expiresAt。相同键的行不会合并；返回值不关联内部锁表或授予锁权限。

`snapshotConcurrencyLockKeys(keys, backend)` 一次规范化、排序去重并返回配对的冻结 `{keys, identities}`；键为独立快照，identity 是原通道编码的十六进制字符串，不授予取锁权限。`snapshotConcurrencyLockRange({channel,prefix?}, backend)` 返回同一 identity 域的半开 `{lower,upper}`；省略 prefix 选整个通道，有值时复用原 typed 前缀规则，bytes 前缀仅接受字符串（含空串）。

`runWithConcurrency` 的可选 `request.lock(captured)` 在原固定上下文字段完成一次捕获后调用一次；返回的隐式锁与显式 options.lock 合并、排序去重，保留显式锁。嵌套调用只规范化新增键，复用原锁编码与同一预算；默认模式重试不重新调用派生函数。派生 getter、raw 回调失败沿 INVALID_ARGUMENT 保留 cause，已有 coded 回调错误保持原身份。`IWriteOptions` 以及根 remove/clear 各数据通道上下文包含 `IWriteConcurrencyOptions`，省略 concurrency 使用原 owner 默认策略。

后端可选用 `request.executeAttempt(captured, proceed)` 代替 `execute`，两者不能同时提供。默认 execute 仍只包围完整逻辑循环一次。executeAttempt 在每次真实原生提交尝试周围运行完整 pipeline；纯获取锁冲突的等待或重试留在当前段内，不重新干预输入。提交冲突必须先完成原生回滚与清理，proceed 再以该冲突的原 coded cause 拒绝；缺失或未编码的 cause 由同一 owner 包为保留 cause 的 WRITE_CONFLICT，形成该段唯一失败身份。只有 stage 完整收尾后仍抛同一失败，原循环才咨询策略并重开下一段；stage 恢复返回值或改抛其他身份时直接结算。stage 不调用 proceed 也可正常提前返回，重复调用则报 INVALID_ARGUMENT。每个新段从最初捕获的显式或继承锁重新派生本段变换输入的隐式锁，不积累上一段的锁。原 options 单读、整体 signal、期限与冲突计数始终共用；不新增循环、队列或超时拥有者。

`IConcurrencyAttemptContext.attempt` 等于原共用冲突计数加一；后端把此只读序号转发给观察，不自行计数，嵌套尝试沿同一预算来源。

## SQL 片段与后端绑定

`sqlFragment` 是无连接的纯标签，仅有 `id`、`join` 与 `empty`；没有 all/get/run。插值只接受 ISqlValue 或同一 owner 创建的真实片段；普通对象、Date、undefined 与伪造片段在构造时拒绝 INVALID_ARGUMENT。模板必须具有冻结的真实 cooked/raw 数组形状。id 独立引用每段名称并转义双引号；join 保留重复子片段。字节在构造时复制，不会把输入值拼入 SQL 文本。

片段按不可变节点引用增长，不复制历史 SQL；首次执行通过显式栈展开一次。SQLite 使用 ?，PostgreSQL 从 $1 连续编号。每次 prepare 都给驱动独立的字节副本；没有共享可变参数或全局语句缓存。

```ts
import { sqlFragment, type ISqlExecutor } from '@migaia/storage-contract'
async function readUser(executor: ISqlExecutor, id: number) {
  const columns = sqlFragment.join([sqlFragment.id('id'), sqlFragment.id('name')])
  return executor.sql<{
    id: number
    name?: string
  }>`SELECT ${columns} FROM ${sqlFragment.id('users')} WHERE id = ${id}`.get()
}
```

`createSqlTag({ dialect, all, get, run })` 供原后端作者把这些节点接入真实终点。三个回调接收 `prepare: () => ICompiledStorageSql` 与原 ctx，必须先进入自己的原 operation/transaction owner，再调用 prepare，随后执行原驱动方法。标签直接返回该回调的原 Promise，并保留回调 receiver 与 ctx；不创建连接、pipeline、lease、取消计时器或 dispose 拥有者。ICompiledStorageSql 只含 text 与 readonly values。首次完整文本会检查单语句、引号、注释、事务控制与 SQLite journal_mode 修改；拒绝发生在原准入内、原生调用前，进入同一事务首错。合法末尾分号和注释允许，CREATE TRIGGER 的内部多语句列表拒绝。

共享 ISqlValue 包含 boolean、bigint 与 Uint8Array；ISqlRunResult 只承诺 changes，不承诺插入 ID。后端用 ISqlTag<TValue, TResult>/ISqlExecutor<TValue, TResult> 保留具体输出值域和结果；显式行类型是调用方声明，不代表运行时验证了 SQL 输出 schema。SQLite 的布尔输入转换及 lastInsertRowid 由其原适配器负责；PostgreSQL 普通字符串采用受支持的 standard_conforming_strings=on，并支持 E 字符串、dollar quote 与嵌套块注释。真实连接、驱动错误、观察与事务清理由后端沿原拥有者执行。

## 原事务能力投影

`useTransactionCapability(scope, token)` 从真实 scope 的原 transaction owner 找到同一 store，再读取唯一 provider 表。它供后端原方法工厂的 `use: (token) => useTransactionCapability(scope, token)` 使用；不修改 scope，因此公开类型注解的完整 frozen scope 不需要私有 symbol 或 cast。纯 use 不调用 forTransaction、不执行 I/O；同视图、同实现重复 use 返回同一冻结投影，视图失效时清空缓存。

当前标准事务投影覆盖 kv 与 records。kv 提供完整 get/set/remove/has/getMany/setMany/removeMany/removeByPrefix，保留单个真实 native batch；没有根 keys/clear、普通操作 ctx 或独立策略。records 提供真实共用 query 与 removeByPrefix；query 的 all 不接受普通 ctx。`IWithTransactionQueryMethods<TScope,TAugmentMethods,TRdfAugmentMethods = {}>` 分别将记录与 RDF 纯方法投影到对应事务能力；第三泛型缺省为空，旧两参数调用只增强 records，query 与 rdf 组不互授方法，不增加根操作上下文、不改原生 scope 成员；规范 builder 类型复用此纯 helper 增强回调 scope。每个数据方法都进入原 runTransactionOperation，将新的完整操作视图交给 forTransaction；保存 query 的 all 也先进入同一 owner，严格计划失败、mapper 与真实 iterator 清理保持原首错和排空。关闭后的保存数据方法与 query 终点在 I/O 前拒绝原后端 TRANSACTION_FAILED。

```ts
import { kv, records, type ITransactionScope } from '@migaia/storage-contract'
async function paidValues(tx: ITransactionScope<{ state: string; value: number }, typeof records>) {
  await tx.use(kv).setMany([{ key: 'status', value: 'paid' }])
  return tx.use(records).query().where({ state: 'paid' }).select('value').all()
}
```

声明 transactions 的 base/Feature 必须为已提供的 kv、records 提供真实 forTransaction，provider 在发布或修改 base 前检查；binder 只绑定当前原生视图，不得返回根 API。查询构造保持纯函数，后端 source 必须把真实 iterator 登记到该 scope 的原 owner。ITransactionScope 的第二泛型与 ITransactionCapabilityView 保留能力集合的反变约束；provider 重新投影原 transaction/tx 的 use 类型，同时保留原生附加成员、options、builder 增强和 Awaited 结果。其它标准事务投影与根 KV 批量面待对应后续实现，不由此处宣称完成。

## 规范键前缀

`createStorageBatchKeyCapture(backend)` 返回每批独立的纯 `capture(key)` 函数，使用相同 `{ key, identity, firstIndex }` 事实。原生作者按既有逐项 getter 次序调用，再于原重复校验点根据 `firstIndex !== inputIndex` 拒绝。此函数不读取 value/TTL 字段、不捕获消费者回调，不创建资源或操作 owner；数组 helper 复用同一暂态相等索引。

`snapshotStorageBatchKeys(keys, backend, { rejectDuplicates? })` 单次捕获每个输入位置，按调用方顺序返回冻结的 `{ key, identity, firstIndex }` 行。`key` 为独立快照，`identity` 使用规范有序字节；读取保留重复位置，原生删除只处理当前位置等于 `firstIndex` 的行，原子写入传 `rejectDuplicates: true`，规范重复键在 I/O 前报 `INVALID_ARGUMENT`。非法逻辑键保留 `INVALID_KEY`。此函数不创建 store、事务或资源 owner。

`snapshotStorageKeyPrefix(prefix, backend)` 从原键域制作一次独立快照，返回 `{ key, lower, upper, matches }`。string 按 UTF-16 内容前缀匹配，ArrayBuffer 按字节前缀匹配；array 按完整的领先子键序列匹配，不把末尾子键也当成部分前缀；number 与 Date 只匹配精确规范身份，-0 与 0 相同。空 string/buffer 合法，空 array 仍由原键域拒绝。

原 encoder 的同一 writer 仅省略最外层变长键的终止符，保留子键全部边界与类型 tag。lower 为包含端，upper 是必有的严格字节后继、不包含端；完整 encodeOrderedStorageKey 输出不变。有序原生结构按这个范围定位；逻辑键 IndexedDB cursor 可从 key 做 lowerBound，遇第一个 matches=false 即停止，最多多读一条边界。文本 Web 的 origin 枚举例外也复用同一 prepared matches。函数不创建索引、不扫描存量；返回 key/bounds 的修改不影响捕获的私有 matcher，调用方应保持其用于查询的边界值不变。

```ts
import { snapshotStorageKeyPrefix } from '@migaia/storage-contract'
const prefix = snapshotStorageKeyPrefix(['cache', 'users'], 'memory')
const included = prefix.matches(['cache', 'users', 1])
const excluded = prefix.matches(['cache', 'users-extra'])
// included === true; excluded === false
// Native ordered stores use prefix.lower <= encodedKey < prefix.upper.
```

`ttl` 与 `counter` 是标准能力身份。后端发布完整原生 API；支持事务的 provider 同时提供 `forTransaction`。`store.use(ttl)` 对物理文本、字节或记录目标提供 `expire/remaining/persist`。期限为有限非负毫秒，含小数与零；缺失/已过期目标的写返回 false，缺失/无限期目标的 remaining 返回 undefined；对已无限期目标 persist 返回 false。事务投影使用原 draft 与预算。

`store.use(counter).increment(key, by?)` 原子修改规范十进制安全整数文本；缺失文本从零起算，省略 `by` 为一。空白、指数、前导零、负零、不安全增量和结果溢出均报 `INVALID_ARGUMENT`，不执行写入。后端作者在 I/O 前调用 `snapshotStorageCounterIncrement(by, backend)`，再在既有原子操作内部对当前文本应用其纯计算。`snapshotStorageTtlTarget` 复用原物理键 validator，`assertStorageTtlDuration` 接纳有限非负期限；这些 helper 不创建 store、期限状态或操作预算。

`term.iri/literal/blank/defaultGraph` 拥有纯 RDF 项。IRI 保留精确的绝对 RFC 3987 拼写，不通过 URL 解析、大小写转换或规范化改变身份。普通 literal 含 `xsd:string`；语言 literal 含 `rdf:langString` 与小写且格式正确的 BCP47 标签。raw/parser blank label 只在局部有效，不能进入标准 ground `IQuad` 位置；`IRawQuad` 为 raw 响应保留完整 RDF 1.1 blank 域。

`snapshotStorageRdfTerm`、`snapshotStorageRdfPattern` 与 `snapshotStorageRdfQuad` 单次捕获并复制结构字段；非法项或位置报 `INVALID_ARGUMENT`，保留 getter 原因。pattern 省略的字段不加约束，graph 也如此；完整 quad 必须提供四个位置。`encodeStorageRdfQuad` 通过规范 term 字段与既有自定界有序键 writer 生成独立身份字节。这些纯 helper 不打开原生 store、query 或资源。

`lockKey.vector(collection, id)` 与 `lockKey.rdf(quad)` 扩展原规范锁拥有者。通道顺序保留 text、bytes、record，再追加 vector、rdf。向量使用精确 collection/point 元组；RDF 与写入共用规范 ground quad 快照与保序字节。工厂分离调用方数据，归一时一次去重。整通道锁范围涵盖两个新通道；typed prefix 仍只支持 text、bytes、record。TTL 接受向量 collection/point 目标，在原生操作前拒绝 RDF。不支持某通道的后端必须明确拒绝。

`sql` 为标准嵌套原生执行能力：`store.use(sql).sql` 保留原 tag 与工具。事务 provider 提供 `forTransaction`；`tx.use(sql).sql` 只组合片段，不调用 binder 或根执行。每次 all/get/run 终端进入既有事务 owner，获得新的原生 operation view，并使用原事务预算；保存的查询在到期后不能执行。后端作者可用 `deriveStorageSqlQuery(fragment, terminals)`，只在同一真实片段节点上替换终端回调，保留原回调 receiver、context 与 Promise 身份；不创建 compiler、连接、队列或资源 owner。

`blob` 选择独立原生对象 API，使用 string key、不可变 metadata 和可释放的单次消费对象快照。流为平台 WHATWG `ReadableStream<Uint8Array>`；契约不导入 DOM 运行时或流实现。六个原生方法包括条件 put、范围 get、head、remove、有序 list 与 removeByPrefix。provider 只校验完整形状，不打开流；实际字节、范围、条件与生命周期语义由对象后端实现，令牌本身不实现存储。

`durableChangeFeed` 选择原生 `readChanges` 重放与可释放的 `tailChanges`。游标不透明，至少一次重放；调用方只持久化成功处理的游标。保留期缺口为携带 `StorageContractErrorCode.changeCursorExpired` 的原生 RangeError，调用方全量失效后从 now 恢复。普通变更可携带原 host context 的只读 orgId。blob 与 durable feed 不获得通用事务投影或平铺 KV；memory 发出短暂变更并不意味着获得 durable 令牌。

`orderStorageKeysByBytes(entries, key)` 对每个 selector 结果只读取一次、立即复制其字节，并按稳定字节序返回原条目。它与原锁归一共用同一 radix 实现，保留前缀顺序，不建立持久索引。`encodeStorageOrgStringPrefix(orgId, prefix, backend)` 使用原组织 envelope 与 key writer，只省略最后 string 和 tuple 两个终止符。空前缀与精确 UTF-16 码元有效；编码前缀不会跨组织，也不匹配 tuple 逻辑键。

SPARQL 通过纯 sparqlFragment 与原生 sparql 能力复用规范 RDF 项。插值只收 NamedNode、Literal 或真实片段；raw blank/default graph、普通 string 与假片段在 I/O 前拒绝。literal 转义引号、反斜杠与控制值；变量名采用完整 SPARQL VARNAME 语法，不带问号或美元前缀。join 默认空白分隔，empty 只有一个身份；深层与重复片段按实际输出位置迭代展开。

后端作者用 createSparqlTag({select,ask,construct,update}) 绑定原生回调。各回调接收返回不可变 body 的 lazy prepare 与原 context；后端先做既有操作准入，再 prepare。包装保留 receiver 与 Promise 身份。SELECT 保留未绑定字段的 undefined；CONSTRUCT 保留完整 raw quad 和响应局部 blank。纯组合不启动查询、parser、endpoint、retry loop 或资源。SPARQL 没有通用 KV/record 事务投影；端点专有原子 update 事务仍归原生后端。

## 向量与 RDF 查询作者入口

`createVectorQuery<TPayload,TGroupable>(source, methods?)` 返回不可变 builder；声明正安全整数 `topK(k)` 后才有读取终点。原生 execute 接收 `IVectorQueryInput`：全部可译 payload conditions、最终 topK/minScore、withVector 与原 context。声明式条件跨函数谓词下推，org/TTL 仍由后端在排名前处理；函数只过滤原引擎命中，不补搜。withVector 缺省 false，显式开启后结果类型才包含 vector。exact:true 的 explain 标记 fullScan。groupBy:true 才提供标准分组，在原 topK 命中上单遍按 payload 自有标量字段分组，每组保留 perGroup 个原序命中。

`createRdfQuery(source, pattern, methods?)` 捕获规范 ground pattern，保留省略 graph 的全 graph 语义。原生 execute 接收 `IRdfQueryInput`，其有序 steps 保留 where/follow/inverse/select 的原调用顺序；execute 的原生行载体为 unknown，实际 select 可返回 Pick 投影，无须伪装完整 quad；follow/inverse 只接受 ground IRI。当前读取单元提供原生安全前缀遍历与普通 limit；当前不能在客户端执行的遍历在 I/O 前拒绝 QUERY_NOT_PUSHABLE。RDF 客户端遍历与写终点由后续单元补齐；分页见后文。

两个作者入口复用记录查询的同一节点、planner、reader 与原 IStorageIterator，保留 asyncDisposeKey、取消、事务资源与清理首错。可选纯方法保留原函数引用；`VectorQueryMethod` 与 `RdfQueryMethod` 为同名冲突的规范保留表。

vector 与 rdf 现发布各自精确标准原生 API。向量 collection 返回共享 IVectorQueryBuilder/IVectorHit family，保留 topK 前类型状态与可选原生分组；借用 store 生命周期，不获得通用事务投影。payload 声明支持 readonly/optional 便携字段，拒绝 Date/function schema。DeleteCountMode 为 precount 或 scroll；返回真实删除数的引擎保留该计数，Qdrant 依其明确原生策略。发布令牌本身不实现搜索引擎。

RDF add/delete/match 沿同一规范 ground IQuad owner。支持事务的 provider 提供 forTransaction：写入绑定新原 operation view；match 保留真实 family query 与原 iterator 登记。全部完整读终端，包括选择结果、回调与数值终端，均在参数、strict 或空结果失败前进入同一事务 owner；保存查询在到期后拒绝。Feature 方法保持精确泛型投影。change-feed 类型参数先预留，直到共享 watch 契约实现；这些声明不虚称已有 watch 或持久投递。

### Blob 作者接点

后端在原生 I/O 前共用 `snapshotStorageBlobPut`、`snapshotStorageBlobGet` 与 `snapshotStorageBlobList`，独立捕获输入字节和元数据、校验互斥条件与闭区间范围，不消费上传流。`createStorageBlobObject(info, source, { close, report, backend? })` 将一次 stream 或 bytes 消费权接到原资源拥有者；EOF、cancel 与 dispose 释放同一原生内容。主清理保留可拒绝的缓存 Promise，符号清理使用独立缓存 Promise 并报告清理失败。

## 记录与 RDF 的行控制

`orderBy(selector, direction?)` 按规范 IStorageKey 排序，direction 缺省 asc；连续调用追加次级键。每个候选的每个 selector 只执行一次并立即编码快照，最终以原逻辑主键决胜，显式原 source 尾序仍保留。排序复用规范字节 radix，不执行比较排序；只有 selector 排序需要保留实际候选行，count 跳过不影响基数的排序回调；若其后 distinct/skip/limit 的选行会被后续条件或遍历观察，则保留决定行身份的 selector 排序，统计自身仍只保留标量累加器。selector 与 comparator 类型状态互斥，selector 函数不被解析或伪下推。

`distinct(field)` 保留当前顺序中的首行，用 Set 的 SameValueZero 字段身份单遍去重：0/-0 同值，NaN 同值，缺失与 undefined 同值，对象（含 Date）按原身份区分。`skip(count)` 接受非负安全整数，客户端显式逐行推进并在 explain 标出 O(n)，下游 limit 达到后不再读取。记录与 RDF 共用这些节点及 reader；向量仅提供保持排名的 distinct。

原生数据源显式提供 `nativeSteps:true` 后，原 execute 才接收有序 `IQueryNativeStep`（where/select/limit/skip/distinct），并按原声明顺序执行其真实支持的前缀；steps 是执行顺序的依据，兼容保留的 conditions/fields 不可再次乱序应用。未选择此端口的旧源保持原 execute 三字段参数及原客户端 limit 行为。原生 distinct 声明须兑现相同字段身份语义，不能把结构等值冒充对象身份。RDF 也显式选择扩展原生控制，原有遍历 steps 形状不变。事务的这些派生分支沿原包装投影，仍复用完整终端的同一 operation 准入。

### 键集分页

记录与 RDF 的 `page(size, ctx?)` 返回 `{ items, next? }`；`after(next)` 继续相同源、条件与排序。size 必须为正安全整数。未显式排序时使用规范主键顺序，selector 排序以原主键决胜。分页读取一条额外命中判断 next，函数映射只处理实际返回的 items，清理与回调仍属于原资源 operation。删除上一页记录不会使游标退回 offset；扫描期间新增记录遵循当前排序锚点，不提供跨页快照。

游标是进程内只读值，私有字段拒绝伪造与 Reflect 属性副本；不返回源、store、注册或关闭句柄。可选只读 `cursorSource` 在创建查询时单读，缺省为原 source 对象；同 collection 的新描述器需复用同一身份。后端须为不同 collection/index/组织隔离域使用不同身份。游标还匹配 source/index/key-tail 元数据、ctx.orgId、RDF ground pattern、有序条件/predicate、排序、distinct 与遍历；函数按原引用比较，不序列化闭包。投影/mapper、limit/skip、页大小和执行预算可变。不匹配在任何新 I/O 前报 INVALID_ARGUMENT。

新 keyset 执行中，条件、selector 排序与 distinct 在 after 之前，limit/skip 是其后的页控制；原来没有 page/after 的链保持声明顺序。comparator 的 after 在原 comparator+limit 有界堆之前比较，游标锚点使用 utils 原 structuredClone 快照域，不增加无界排序。`query.after(next).limit(2).all()` 返回锚点之后的两条。

原 `nativeSteps:true` 端口扩展主键 `order` 与 `{operation:'after',key,direction}`；后端仅声明其真实索引 seek 支持。具有相应索引的原 execute 可做 O(log n + 页大小) seek；共享 fallback 明确保留客户端排序/过滤成本，strict 会在 I/O 前拒绝。向量查询没有 page/after。

`compileStorageQueryCondition<T>(condition)` 只编译原生 source 回调已经收到的规范 `IQueryCondition`，直接复用原 compiler，不再捕获 IWhere、不增加 parser 或登记表。Date、对象身份、操作符和返回谓词的错误语义保持；编译失败沿原 INVALID_ARGUMENT。外部声明式输入仍用 `compileStorageWhere`。
