# @migaia/storage-contract

运行时中立的存储契约。根入口只拥有类型、能力 token/定义、错误、枚举式常量和纯校验；执行、资源与作者快照由 `@migaia/storage-host/authoring/*` 拥有。基础包不依赖 host、浏览器存储或数据库客户端。

## 入口与依赖方向

- `@migaia/storage-contract`：存储/codec/context/query/transaction 类型、标准 token、定义身份和纯校验。
- `@migaia/storage-contract/conformance`：由消费者现有 runner 执行的后端契约组；不内置 runner，也不依赖 host。
- 后端和 host 向内依赖本包。运行时作者 API 从下表入口导入；根入口不保留旧名称重导出或兼容别名。

| host 入口后缀            | 既有作者能力                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `/authoring/capability`  | provideCapabilities、hasStorageCapability、useStorageCapability、readTransactionImplementation |
| `/authoring/query`       | createRecordQuery、createVectorQuery、createRdfQuery、条件编译与快照                           |
| `/authoring/concurrency` | ConcurrencyPolicy、lockKey、runWithConcurrency、锁身份与快照                                   |
| `/authoring/transaction` | createTransactionOwner、createTransactionBuilder、事务执行与游标派生                           |
| `/authoring/key`         | 键快照、有序键/组织编码、批次键 capture/projection                                             |
| `/authoring/context`     | snapshotOperationContext、snapshotSyncWriteOptions                                             |
| `/authoring/store`       | store/capabilities 的 snapshot 准入                                                            |
| `/authoring/resource`    | createStorageIteratorLifetime                                                                  |
| `/authoring/sql`         | sqlFragment、createSqlTag、deriveStorageSqlQuery                                               |
| `/authoring/sparql`      | sparqlFragment、createSparqlTag                                                                |
| `/authoring/rdf`         | term、RDF 快照/编码、组织图映射                                                                |
| `/authoring/vector`      | 向量输入快照、recommendStorageVector                                                           |
| `/authoring/ttl`         | snapshotStorageTtlTarget                                                                       |
| `/authoring/counter`     | snapshotStorageCounterIncrement                                                                |
| `/authoring/blob`        | blob 输入快照、body reader 与 object 资源                                                      |
| `/authoring/codec`       | fromValueCodec、snapshotCodec                                                                  |
| `/authoring/migration`   | createMigrationPlan、迁移执行与 envelope 恢复                                                  |

这些入口属于 `@migaia/storage-host`。`/authoring/backend` 继续拥有既有有限后端接点；共享模板捕获仅是 SQL/SPARQL 的内部模块，不是公开子路径。使用步骤见 [USEGUIDE](./USEGUIDE.md) 与 [host 指南](../storage-host/USEGUIDE.md)。

## 类型与纯校验

`IStorageBase` 是 backend、capabilities 和原资源清理接口；`IKeyValueStore` 加入文本操作；`IRecordStore` 加入 bytes、records、iteration 与 transaction。`ISyncKeyValueStore` 只描述真实同步文本通道。query、transaction、vector、RDF、blob、TTL、counter、durable feed 的接口和输入类型继续从本包导入。

| 纯入口                                                                           | 行为与失败                                                                      |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `isStorageBase`、`isKeyValueStore`、`isRecordStore`                              | 检查当前完整 shape 与能力事实，不复制、不调用存储或清理方法                     |
| `asRecordStore`、`asSecondaryIndexRecordStore`、`asChangeFeedStore`              | 成功返回同一原对象；缺能力报 `UNSUPPORTED_CAPABILITY`                           |
| `isStorageCapabilities`                                                          | 检查布尔事实与可选非负安全整数 `maxValueBytes`；不补写调用方字段                |
| `assertStorageKey`、`assertStringStorageKey`                                     | 检查 typed-key 域或字符串域；分别沿 `INVALID_KEY` / `INVALID_ARGUMENT` 边界     |
| `assertOperationContext`、`assertSyncWriteOptions`                               | 校验字段，不分配快照、计时器或取消订阅                                          |
| `assertCodec`                                                                    | 校验非空 name、text/binary/structured output 和可调用 encode/decode；不执行转换 |
| `assertStorageOrgId`、`assertLockKey`                                            | 校验规范 UUID 或 text/bytes/record/vector/RDF 锁域                              |
| `assertStorageVectorCollection`、`assertStorageVector`、`assertStorageVectorIds` | 复用向量 schema、有限分量及稠密 ID 规则，不复制输入                             |
| `assertStorageRdfTerm`、`assertStorageRdfPattern`、`assertStorageRdfQuad`        | 复用 RDF 词法与位置规则；完整 quad 必须有四个位置                               |
| `assertStorageTtlTarget`、`assertStorageTtlDuration`                             | 复用锁目标及非负期限规则；TTL 不接纳 RDF 目标                                   |
| `assertStorageBlobPut/Get/List`                                                  | 只校验 blob 的 key/body/options 结构，不取得 reader                             |
| `assertVersionedEnvelope`、`assertTransactionCallback`                           | 校验原 envelope 或同步回调形状，不执行迁移/事务                                 |

shape guard 面向普通受支持输入，不承诺拦截抛错 getter、Proxy、恶意 thenable 或属性读取次数。异步执行、native 错误归一及取消结果属于相应运行时拥有者。

## 键、上下文与能力事实

`IStorageKey` 接纳有限数、字符串、有效 Date、ArrayBuffer，以及这些值构成的非空稠密嵌套数组。深度上限 32，节点上限 4096，每个二进制组件上限 1 MiB；循环、空数组、稀疏数组和普通对象不在键域内。纯 guard 不复制 Date、buffer 或数组。异步保留输入时使用 host 的键快照。

`IOperationContext.timeoutMs` 是非负安全整数，`pageSize` 是 1–4096 的整数；省略不插入缺省值。signal 使用结构化 `IAbortSignal`，已取消的有效信号仍可通过 shape 校验。同步写选项只接纳可选 `conflictPolicy`，不接纳非 undefined 的 signal/timeoutMs。

`IStorageCapabilities.batch` 声明完整 KV 批量写与计数前缀删除；省略表示不支持。共享 conformance 将未声明的 batch 组记为不适用。`secondaryIndexes`、`changeFeed` 的旧省略形状可通过 guard；需要独立规范化说明的 host 快照把这两项补 false。

## 定义身份与原生实现

`defineStorageCapability`、标准 `kv/records/sql/ttl/counter/vector/rdf/sparql/blob/durableChangeFeed` token 和 `implement` 留在本包。名称只作诊断；同名 token 不能互换。`readCapabilityTokenFacts` 与 `readStorageImplementation` 只读取原定义身份，不发布能力、不执行回调、不维护每 store 表。

publication、store has/use 和 transaction implementation lookup 统一由 host `/authoring/capability` 拥有。调用方继续使用同一 token 和原 API 实例；支持合法 class 的方法 receiver。查询/事务/锁/iterator 的状态表也只在 host 中存在。

## 错误与已接受边界

`StorageContractError` 保持 `source: '@migaia/storage-contract'`、公开 code、原 `cause`、原 stack 与扩展 details。未改名或新增错误码。`INVALID_ARGUMENT` 表示输入结构问题，`INVALID_KEY` 表示 typed-key 域问题，`UNSUPPORTED_CAPABILITY` 表示缺少已请求能力；执行拥有者继续使用本包既有生命周期、并发、查询和迁移码。

错误实例保留既有冻结行为，cause 对象不会随之冻结。归档迁移的进度错误通过既有 `onArchiveRunError` 通道报告，不修改已冻结错误实例。codec 不承诺冻结或复制：纯 `assertCodec` 只校验；host `snapshotCodec` 校验后返回同一实例，使 `#private` 方法保持 receiver。

普通 store/options/query 与输入快照不作为冻结协议。需要跨排队、native await 或公开返回值边界隔离可变 Date、bytes、数组、RDF term 时，由相应 host 作者入口说明并执行必要复制。公开锁诊断的键必须与仍活动的原 lease 分离。
