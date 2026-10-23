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

`ITransactionScope<TValue>` 覆盖文本 `get/set/remove/has`、字节 `getBytes/setBytes/removeBytes` 与记录 `getRecord/putRecord/deleteRecord/iterateRecords`。文本和字节缺失返回 null，记录缺失返回 undefined；记录键为 IStorageKey，putRecord 省略 key 请求后端生成。旧记录 put/delete 名称已移除，get 改为读文本。方法继承事务上下文，只有写入接收精简冲突选项。可选 putIndexedRecord/iterateRecordIndex 由 ISecondaryIndexTransactionScope 引用同一签名，不重复声明。

`createTransactionOwner` 登记原 store 与真实视图身份。后端私持 register/createScope/onFailure 和生命周期控制；功能模块通过 assertTransactionOwner、runTransactionOperation、registerTransactionFinalizer 与 nextTransactionIterator 接入。操作入口同步开始，并获得完整新视图。stopAdmission 只封闭用户视图，已接纳操作继续在自己的视图排空。每个检查和最后库内 beforeCommit 都使用新视图，只运行一次，排空子请求并释放迭代器后再运行下一检查。已 catch 或未 await 的操作失败仍锁定后端归一的首错并通知回滚。本包不创建数据库、runner 或隐式当前视图。

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

原事务 owner 只捕获一次 defaultPolicy 与 concurrencyStages；省略策略时只创建一次 wait 缺省值，真实显式覆盖值优先。缺省解析只使用同一私有 owner 登记，不读公开 store 字段，不建立另一套 store registry。wait 缺省逻辑准入预算为 30,000 ms，optimistic 缺省对三个冲突按 20 ms 退避。决策循环与后端真实锁是另行接入的执行边界；仅有策略元数据不能证明锁或重试行为。
