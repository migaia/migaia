# 存储宿主作者指南

泛型后端工厂先定义具名 descriptor，再交给 `definePlugin`。这样保留实际 store、字面量实例 id、client 与应用选择的 Feature 类型，调用方无需类型断言。

```ts
import { createStorageHost, definePlugin } from '@migaia/storage-host'

const health = definePlugin('health', (core) => ({
  install: () => {
    core.onDispose(() => undefined)
    return { status: () => 'ready' }
  }
}))
await using host = await createStorageHost({ plugins: [health] })
console.log(host.extensions.status())
```

普通插件可只提供业务扩展，不冒充存储后端，并保留原 PluginHost Feature 依赖协议。后端插件额外声明真实 kind 令牌，并登记一个准入 store。

`host.api[id]` 直接取用该已发布后端的原 `store.api`，两个实例可保留同名方法。每次读取返回冻结的后端 id 快照，旧快照不随 `use` 批次变动；失败批次不发布新 id。方法仍受原 Feature 有效期保护，关闭后提取的方法也会拒绝。

原生连接只通过 `featureExpose` 暴露惰性函数。它只接收自有、可枚举、字符串键的函数属性，包括 `getClient`。事务后端通过原事务 owner 提供 `getTransactionClient(scope)`。`getKind/getStore/getBackendId/getLifecycle/onDispose/getScheduler` 由宿主保留，作者不能覆盖。

资源在原安装窗口通过 `core.onDispose` 登记。真实操作在原生 I/O 前进入 `core.execution`。事务 owner、middleware runner、能力表与 Feature 图继续由原拥有者维护。`capabilityInstaller` 必须交出 `provideCapabilities` 发出的原端口；能力记录必须来自真实 `implement(...)`。

安装期限覆盖整批。失去发布权后才返回的 store 会被释放；失败批次不改变已发布成员。关闭同步停止新准入，等待原清理真实完成，并保留收集到的全部错误。

Schema 与 codec 适配位于 `@migaia/storage-host/entity`：`passthrough`、`fromStandardSchema`、`jsonCodec`、`structuredCodec`、`binaryCodec` 和 `selectCodec`。Codec 协议仍由 `@migaia/storage-contract` 拥有。JSON 路由名为 `json@1`，直接复用 portable JSON codec；undefined、非有限数字等不支持的值会被拒绝。编码和解码错误分别携带宿主 `SERIALIZE_FAILED`、`DESERIALIZE_FAILED`，cause 保留 contract 与原 codec 错误。Structured 和 binary 恒等 codec 保留原对象引用；文本后端可显式选择 binary 的 base64 路由。

实体入口同时拥有既有 `REPOSITORY_KEY_PREFIX` 与 `repositoryMigrationKey(entityName)` 布局标识，供 repository 与后端 raw-record firewall 共用；持久化字符串保持不变。

`host.hooks.on(name, listener)` 与构造选项 `hooks` 共用同一同步观察注册表。插件在原安装窗口使用 `core.hooks.on`，原 registration 负责取消句柄。`core.emit(name, () => payload)` 与 Feature 注入的 `emit` 仅在有监听时构造一次载荷。监听器同步抛错、then getter 失败和异步拒绝只报告，不改变存储结果。后端包可扩充公开 `IStorageHookMap` interface。

后端构造时通过 `core.stageBindings` 绑定真实 store，再交给 `registerStore`。七类 observer 只观察。`codecStages(store)`、`transactionStages(store)` 等宿主方法仅接受本宿主已发布的原 store；事务投影验证原事务 owner。先构造的 observer 仍实时响应之后的监听登记与取消。

环境检查通过 `core.registerDetect(check)` 或 Feature 注入的同名函数登记，只能在原安装窗口调用。检查按插件安装顺序和登记顺序执行，使用原 registration 的取消信号。`createStorageHost` 默认在返回前完成检查；失败保留原错误并逆序释放已构造资源。设置 `autoDetect: false` 可延迟到显式 `await host.detect()`：未完成时，真实执行终点在业务 I/O 前拒绝 contract `UNSUPPORTED_CAPABILITY`，不会隐式调用检查。并发 `detect()` 返回同一个 Promise，成功缓存，失败可重试；新增插件批次需要再显式检查新增登记。关闭沿原资源 scope 排空已经开始的检查。

`createOrgId()` 使用宿主原 `crypto.randomUUID()` 生成小写 UUID。`org` 选项在任何插件执行前经 contract 校验并捕获，省略时为零 UUID；观察事件使用这个不可变的默认组织身份。

`host.envelopeStages(store, { operation, targetVersion })` 绑定本宿主已发布的原 store，捕获本次不可变操作信息。其 `observe` 直接交给 contract 的 `migrateEnvelope` 或 `migrateEnvelopeSync`；其余回调观察原 envelope 检查与迁移完成边界。它不执行迁移，不携带 state，缺失版本保持 undefined，监听失败只报告。

后端作者从 `@migaia/storage-host/authoring/backend` 消费有限共享函数与 `IBackendChangeController` 类型。`core.createChangeController(options)` 与 `core.registerChangeController(store, controller)` 只在原安装窗口调用：先构造，再 `registerStore` 准入，最后登记同一个 store 的 controller。原 scope 负责未完成构造的回滚，controller 保留原 mutation lease、事件队列和幂等清理 Promise。Feature 用注入的 `getChangeController()` 读取自身原 store 的 controller，未登记时返回 undefined；作者不能覆盖该 getter。

`/authoring/backend` 同时提供既有平面键 encode/decode、range 快照/比较、JSON 字节预算与 opaque token 函数；纯键与 context 校验仍直接从 contract 消费。`resolveStorageNamespace(configured)` 仅校验配置并返回原值；三参形式 `resolveStorageNamespace(configured, orgId, defaultOrgId)` 保留各实例配置前缀：缺省组织使用 configured，其它组织使用 `configured + "/" + orgId`。配置值本身以 `/` 加规范 UUID 结尾时拒绝 contract `INVALID_ARGUMENT`，单独 UUID 配置允许；空值和配置缺省规则仍由各后端处理。

opaque token 保留原格式和条件 fallback；原生 entropy 获取失败以 contract `UNSUPPORTED_CAPABILITY` 拒绝，原错误保留为 cause。

`planChannelWrite` 与 `collectUniqueIndexOwners` 复用同一套通道冲突和唯一索引规则，后端仅传入自身错误构造函数。`normalizeError`、`isStorageErrorFamily` 与 `invokeExtension` 保留真实错误对象、原 cause 和扩展上下文；取消与超时助手继续复用 utils 的原 signal 执行路径，清理失败走原 operation reporter。

`observeStorageBatch(stages, scheduler, operation, count, invoke)` 复用同一份批量操作观察算法。作者先用原 store/scope 完成准入，再传入真实 operation stages 与宿主 scheduler；助手只调用一次原工作，发出一次 before/after 或 before/error，计时包含原 pipeline 与 native 终结。before/error 的 count 为输入条目数，after 对数字结果使用实际计数，其余结果使用输入条目数；异常对象原样拒绝。助手不拥有 pipeline、事务或关闭权，空批由调用方在准入后直接返回。

`core.getPublishedBackend(id)` 与 Feature 的同名入口只在原安装窗口借用更早批次的已发布后端；本批、未来和未知 id 拒绝 `BACKEND_NOT_INSTALLED`。借用视图不暴露 `dispose` 或异步清理 symbol，组合释放不关闭被借资源；业务方法保留原 receiver、原 Promise 与原注册准入。视图的 `has`/`use` 直接读取 contract 的同一个能力表，冻结或未经过 provider 的合法 base 也可借用，后续能力发布和撤销立即可见。

后端 core 的 `createKeyLockPort()` 只在原安装窗口构造共享本地键锁端口；`/authoring/backend` 仅导出其 `IBackendKeyLockPort` 类型。`attempt(ctx, holder, native, stages?, admissionSignal?, ranges?)` 消费 contract 原规范身份和尝试序号：先 try，只有 wait 决策进入原 utils FIFO，锁持续到 native attempt 真正提交、回滚和清理结束。`inspectLocks()` 返回按规范顺序排列的脱离快照。物理后端的原闭包持有端口并在最后一个引用释放时清理；共享端口不随首次创建它的插件自动关闭。端口释放先停止接纳并真正排空，主清理与 symbol 各保留缓存 Promise。 可选 ranges 为异步根写启用同一 FIFO 的点和范围保护（空数组仅保护点）；optimistic 仍等待已有悲观 holder，未传时保留原事务行为。

`probe(identities, ranges?, current?)` 从同一原锁表直接探测规范身份，返回首个脱离的 `ILockHolding` 或 undefined；单键最多进行固定三个通道的 Map.get，范围只扫描所选通道的活锁。范围项为 `{channel,lower,upper}`，边界来自 contract 的 `snapshotConcurrencyLockRange`。`attemptWrite(ctx,holder,write,stages?,admissionSignal?,ranges?,admit?)` 复用同一尝试与 FIFO，write 必须是同步原生修改；最终锁检查与 write 在同一同步执行段。optimistic 根写不创建持锁行，仍尊重已有悲观锁。等待或观察回调之后必须重新检查，排除本尝试已持有的 lease；不创建范围锁。可选 current 必须是原活跃 attempt context，只跳过其实际持有的同一 lease，继续查找其它 holder；声明键或相同 owner 文本不授予豁免。可选 admit(commit) 接后端已有物理准入：先逻辑键、再物理门，commit 至多一次且最终重查操作与成员 signal；原 lease 等物理清理真实结算后释放。

`core.registerValueCommit(store, commit)` 只在原安装窗口接纳已交接的同一 store。`/authoring/backend` 的 `IBackendValueCommit` 接收固定 `{prefix,expected,key,value}` 与可选写上下文；expected 是原始字符串键值快照。实体在异步 schema/codec/投影准备完成后借用该终点，原生后端在原物理准入内同步复核与写入，期间没有 await。它与 controller、envelope 观察共享同一内部 row，卸载由原 scope 清理；登记权与关闭权不向实体开放。 同一个 frozen/raw store 被多个宿主接纳时，envelope 边界向其仍登记的原宿主观察者扇出；释放只移除所属绑定，单宿主保持原观察接点。

controller 的只读 `closingSignal` 代表原关闭阶段。将其作为可选 admission signal 传入，可在直接释放成员时移除该成员的排队请求；不关闭共享 provider，也不提前释放已运行的 native attempt。

后端原安装 core 的 `defaultOrgId` 只读返回宿主已捕获的缺省组织身份。`createRevisionPort()` 在同一安装窗口创建本地修订事实；一个物理数据宇宙共享该对象，`read/write/epoch/clear` 使用既有 text/bytes/record 通道和后端已捕获的键身份。仅原生提交成功后推进修订；clear 清墓碑并推进通道 epoch，防止旧快照通过 ABA 检查。此口不拥有资源或其它成员的关闭权。

`memoryBackendPlugin()` 与 `memoryBackendKind` 由宿主根入口提供。每次安装拥有独立内存数据，即使 namespace 相同也不共享。文本、字节、记录事务复用原事务 owner、并发策略和本地锁；`scope.use(kv)` 提供同事务的八个文本方法，`scope.use(records)` 使用同一实际记录游标执行查询。配置的 owner.label 捕获后保持稳定；没有标签时使用运行时与 pid，浏览器使用 browser。原生 client getter 返回 undefined，事务 client 校验原 scope 后返回 undefined。 所选 Feature 记录独立放在最后一个参数：`memoryBackendPlugin(options, features)`；省略 options 可传 undefined，缺省 id 仍为 memory。

memory 的根异步 `set/setBytes/putRecord/remove/removeBytes/deleteRecord`、clear 与 records 前缀删除使用同一原并发策略和单次预算；单次 ctx.concurrency 覆盖原默认。replace 按固定顺序保护目标和可能删除的其它通道。同步 set/remove/clearValues 只直接探测活锁，忙时立即 LOCK_REJECTED，不运行异步策略。clear 和前缀删除只检查受影响通道的活锁；最终检查与实际数据、修订修改无 await 间隙。输入键与可变 payload 在等待前捕获。读取不加写锁；并发策略不改变 ConflictPolicy 的 duplicate/replace 语义。

```ts
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { records } from '@migaia/storage-contract'

type Order = { state: string; total: number }
await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
const memory = host.backend('memory')
await memory.transaction(async (tx) => {
  await tx.set('status', 'ready')
  await tx.setBytes('receipt', new Uint8Array([1, 2]))
  await tx.putRecord({ state: 'paid', total: 20 }, 'order-1')
})
console.log(await memory.use(records).query<Order>().where({ state: 'paid' }).select('total').all())
```

memory 的根 `getMany`、`setMany`、`removeMany` 与 `removeByPrefix` 也可从 `use(kv)` 取用。批量结构键与原文本通道共享身份；字符串写入可由单点与 sync 方法读取。非空写批量在原事务草稿里一次提交，失败不留下先前项；重复写键在事务前拒绝，重复删除只计一次。每次高层调用只进入一次 pipeline 和一组操作观察，空批不进入 pipeline 或新事务；前缀删除沿原 radix 范围定位。

记录查询的 where/select/all 复用 contract 查询核心；当前内存 source 如实声明客户端执行。tx 文本批量方法支持规范结构键与 prefix；显式 ttlMs 当前以 UNSUPPORTED_CAPABILITY 拒绝。事务失败丢弃草稿，提交前检查键修订和 clear epoch，实际提交后发布批量变化。根资源关闭会取消本实例排队锁准入，并等待已接纳的事务真实结算。

普通范围、事务草稿与前缀删除复用同一包内压缩 radix 索引。基础数据仍用哈希点查；范围仅定位边界并归并命中草稿，tombstone 抑制同键基础项。树维护首尾与相邻叶，不在查询时全量排序；记录和文本各自拥有独立索引实例。

/entity 的 registerRecordIndexBackfillStore 只登记原后端工厂捕获的补录 provider；RecordIndexBackfillPhase 保留原持久化 canonical/legacy 值。原生后端创建既有 coded 争用错误后调用 markRecordIndexBackfillContentionFailure，原对象不变。会话、checkpoint 与真实原生事务仍归后端，实体编排复用这同一原私表。

后端原 scope factory 在冻结同一个视图前调用 `core.createTransactionApi(scope)`；没有选中事务方法时返回 undefined。已选方法通过原 `runTransactionOperation` 登记、排空和保留首错，再进入同一 execution 与当前 scope 的惰性 client getter；过期方法保留原后端事务错误。`core.getChainMethods(family)` 把已选链方法交给原 query/builder creator，所有派生分支保留同一方法引用和原 this。纯链配置同步执行且不进入干预阶段，实际 I/O 终点才进入原 runner；内置方法和重复名称在能力发布前拒绝。

memory 的根操作在原并发 budget 内包住完整 pipeline：阶段修改一次输入，终点调用唯一原 loop，`await next()` 仍等待实际写入和失败。阶段等待计入同一期限；取消后不派生锁或执行原生写入。事务的 loop 位于 pipeline 外，每个真实 attempt 重新进入同一 pipeline，提交冲突重放 callback 时也重新运行阶段。

`defineEntity` 从 `@migaia/storage-host/entity` 导入。记录仓储通过原 `repo.in(scope)` 组合，`repo.batch` 只开一个原生事务。schema、codec 与迁移借用该事务的原 signal。唯一约束检查最终草稿，交换和删除后重用保持原子性。历史索引句柄只有经当前原生 scope 确认就绪才使用；否则在同一 scope 扫描，不建索引。

实体存档使用 `{version, state}` 与共享冻结迁移计划。畸形读取和非法写入保留宿主 `DESERIALIZE_FAILED`/`SERIALIZE_FAILED`，第一层 cause 为 contract `ENVELOPE_INVALID`；不支持版本和迁移失败保留宿主错误码与原 contract cause。不接纳旧 `{__v,data}`。比较函数必须有有限 limit，复用共享有界堆；流返回实际可释放迭代器。

实体查询复用原不可变核心：`repo.query().index(name, keyOrRange).where(...).select(...).all()` 替代 `findManyBy`，`.stream()` 替代 `streamBy`。根查询与事务查询保留已安装的 query Feature 方法。此源的对象与字段条件在客户端执行；显式索引查询仍使用原生索引准备或权威扫描回退。比较器必须指定有限上限，候选由原有界堆保留。事务查询继承原 signal 和期限，终点不接另一个 context。

```ts
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { defineEntity } from '@migaia/storage-host/entity'

await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
const memory = host.backend('memory')
const orders = defineEntity<{ id: string; state: string; total: number }>()({
  name: 'orders',
  key: 'id',
  indexes: { byState: { path: 'state' } }
}).connect(memory)
const paid = await orders
  .query()
  .index('byState', 'paid')
  .where('total', 'gt', 100)
  .orderByComparator((left, right) => right.total - left.total)
  .limit(20)
  .select('id', 'total')
  .all()
await using stream = orders.query().limit(20).stream()
for await (const order of stream) console.log(order)
await memory.transaction(async (tx) => {
  await orders.in(tx).put({ id: 'next', state: 'paid', total: 200 })
  console.log(await orders.in(tx).query().where({ state: 'paid' }).select('id').all())
})
```

`connect(store, {codecStages, queryStages})` 接收原宿主相应的观察接点。codec 围绕每次实际转换；query 的每次 `all` 和 stream 的每次 `next` 观察实际操作。stream 统计累计，消费方两次推进之间的停顿不计执行时间。观察不等待、不否决，抛错与迟到拒绝进入原报告渠道。

自定义 value-only 后端的 unique 写入必须具备 record 事务或原子 value commit 接点；仅有 sync 通道不等于具备该原子终点。两者都缺少时，仅这个 unique 写入组合在修改前拒绝 `UNSUPPORTED_CAPABILITY`；普通 KV 写入仍可使用。原后端安装窗口内，先 `core.registerStore(store)`，再 `core.registerValueCommit(store, commit)`。`IBackendValueCommit` 从 `@migaia/storage-host/authoring/backend` 导出：`commit({prefix, expected, key, value}, ctx?)` 返回 `Promise<void>`；`expected` 是该前缀捕获的原始 `[key,value]` 对。异步 schema/codec 准备完成后，后端须原子复核这份前缀快照并写入 `key/value`，复核和修改之间不得有 await 缝隙；快照变化时以 `WRITE_CONFLICT` 拒绝且不修改数据。该接点只借用原 native store，不新增资源或关闭权。
