# @migaia/storage-host

运行时中立的存储宿主与后端作者 API。宿主复用唯一 PluginHost 生命周期，负责原子安装、精确后端查找和清理；浏览器适配与数据库客户端由各自后端拥有。

```ts
import { createStorageHost, definePlugin } from '@migaia/storage-host'

const labels = definePlugin('labels', () => ({
  install: () => ({ label: (name: string) => name.toUpperCase() })
}))
await using host = await createStorageHost({ plugins: [labels] })
console.log(host.extensions.label('draft'))
```

后端 descriptor 声明真实 `kind`、仅包含函数的惰性 `featureExpose` 与安装函数；需要由 Feature 补充能力时，交出原 provider 的 `capabilityInstaller`。通过 `defineStorageBackendKind<Store, Client, ExtraExpose>()('name')` 创建种类令牌。安装中只登记一次完整 store，准入后由宿主负责回滚与最终释放。

后端 Feature 使用 `defineFeature(kind, factory, dependencies?)`。同步工厂只返回 `capabilities`、`chain`、`api`；API 方法分为 `store` 与 `transaction` 两组。只有应用选中的根输出参与发布，依赖输出只用于构造，不自动成为运行服务。Feature 工厂先于后端安装，因此 store/client getter 必须保持惰性。

`core.execution.run/runSync` 转发同一原 middleware owner。宿主固定 async 模式；存在异步阶段时，同步操作在阶段与终点执行前拒绝 `ASYNC_STAGE_IN_SYNC_ENTRY`。阶段截断且未调用终点时，操作报 storage-contract 已有的 `ABORTED`。零阶段保留原值或原 Promise 身份。

`host.backend(id)` 返回准入的原对象；`host.backends()` 返回脱离内部状态的 Map。`host.use(...)` 整批成功后发布；重叠批次拒绝 `STORAGE_HOST_BUSY`。宿主错误 source 为 `@migaia/storage-host`，原错误保留在 cause 链。

显式 `dispose()` 保留清理失败，重复调用返回同一个 Promise。资源语法使用另一个缓存 Promise，报告清理失败后成功完成，避免覆盖外层主错误。两个入口只执行一次实际清理。宿主释放自己的登记与准入 store，不关闭调用方借来的原生客户端。

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

`core.getPublishedBackend(id)` 与 Feature 的同名入口只在原安装窗口借用更早批次的已发布后端；本批、未来和未知 id 拒绝 `BACKEND_NOT_INSTALLED`。借用视图不暴露 `dispose` 或异步清理 symbol，组合释放不关闭被借资源；业务方法保留原 receiver、原 Promise 与原注册准入。视图的 `has`/`use` 直接读取 contract 的同一个能力表，冻结或未经过 provider 的合法 base 也可借用，后续能力发布和撤销立即可见。

后端 core 的 `createKeyLockPort()` 只在原安装窗口构造共享本地键锁端口；`/authoring/backend` 仅导出其 `IBackendKeyLockPort` 类型。`attempt(ctx, holder, native, stages?, admissionSignal?)` 消费 contract 原规范身份和尝试序号：先 try，只有 wait 决策进入原 utils FIFO，锁持续到 native attempt 真正提交、回滚和清理结束。`inspectLocks()` 返回按规范顺序排列的脱离快照。物理后端的原闭包持有端口并在最后一个引用释放时清理；共享端口不随首次创建它的插件自动关闭。端口释放先停止接纳并真正排空，主清理与 symbol 各保留缓存 Promise。

`probe(identities, ranges?)` 从同一原锁表直接探测规范身份，返回首个脱离的 `ILockHolding` 或 undefined；单键最多进行固定三个通道的 Map.get，范围只扫描所选通道的活锁。范围项为 `{channel,lower,upper}`，边界来自 contract 的 `snapshotConcurrencyLockRange`。`attemptWrite(ctx,holder,write,stages?,admissionSignal?,ranges?)` 复用同一尝试与 FIFO，write 必须是同步原生修改；最终锁检查与 write 在同一同步执行段。optimistic 根写不创建持锁行，仍尊重已有悲观锁。等待或观察回调之后必须重新检查，排除本尝试已持有的 lease；不创建范围锁。

controller 的只读 `closingSignal` 代表原关闭阶段。将其作为可选 admission signal 传入，可在直接释放成员时移除该成员的排队请求；不关闭共享 provider，也不提前释放已运行的 native attempt。

后端原安装 core 的 `defaultOrgId` 只读返回宿主已捕获的缺省组织身份。`createRevisionPort()` 在同一安装窗口创建本地修订事实；一个物理数据宇宙共享该对象，`read/write/epoch/clear` 使用既有 text/bytes/record 通道和后端已捕获的键身份。仅原生提交成功后推进修订；clear 清墓碑并推进通道 epoch，防止旧快照通过 ABA 检查。此口不拥有资源或其它成员的关闭权。

`memoryBackendPlugin()` 与 `memoryBackendKind` 由宿主根入口提供。每次安装拥有独立内存数据，即使 namespace 相同也不共享。文本、字节、记录事务复用原事务 owner、并发策略和本地锁；`scope.use(kv)` 提供同事务的八个文本方法，`scope.use(records)` 使用同一实际记录游标执行查询。配置的 owner.label 捕获后保持稳定；没有标签时使用运行时与 pid，浏览器使用 browser。原生 client getter 返回 undefined，事务 client 校验原 scope 后返回 undefined。

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

记录查询的 where/select/all 复用 contract 查询核心；当前内存 source 如实声明客户端执行。tx 文本批量方法支持规范结构键与 prefix；显式 ttlMs 当前以 UNSUPPORTED_CAPABILITY 拒绝。事务失败丢弃草稿，提交前检查键修订和 clear epoch，实际提交后发布批量变化。根资源关闭会取消本实例排队锁准入，并等待已接纳的事务真实结算。

普通范围、事务草稿与前缀删除复用同一包内压缩 radix 索引。基础数据仍用哈希点查；范围仅定位边界并归并命中草稿，tombstone 抑制同键基础项。树维护首尾与相邻叶，不在查询时全量排序；记录和文本各自拥有独立索引实例。
