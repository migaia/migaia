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

`/authoring/backend` 同时提供既有平面键 encode/decode、range 快照/比较、JSON 字节预算与 opaque token 函数；纯键与 context 校验仍直接从 contract 消费。`resolveStorageNamespace(configured, orgId, defaultOrgId)` 保留各实例配置前缀：缺省组织使用 configured，其它组织使用 `configured + "/" + orgId`。配置值本身以 `/` 加规范 UUID 结尾时拒绝 contract `INVALID_ARGUMENT`，单独 UUID 配置允许；空值和配置缺省规则仍由各后端处理。

opaque token 保留原格式和条件 fallback；原生 entropy 获取失败以 contract `UNSUPPORTED_CAPABILITY` 拒绝，原错误保留为 cause。

`planChannelWrite` 与 `collectUniqueIndexOwners` 复用同一套通道冲突和唯一索引规则，后端仅传入自身错误构造函数。`normalizeError`、`isStorageErrorFamily` 与 `invokeExtension` 保留真实错误对象、原 cause 和扩展上下文；取消与超时助手继续复用 utils 的原 signal 执行路径，清理失败走原 operation reporter。

`core.getPublishedBackend(id)` 与 Feature 的同名入口只在原安装窗口借用更早批次的已发布后端；本批、未来和未知 id 拒绝 `BACKEND_NOT_INSTALLED`。借用视图不暴露 `dispose` 或异步清理 symbol，组合释放不关闭被借资源；业务方法保留原 receiver、原 Promise 与原注册准入。视图的 `has`/`use` 直接读取 contract 的同一个能力表，冻结或未经过 provider 的合法 base 也可借用，后续能力发布和撤销立即可见。

后端 core 的 `createKeyLockPort()` 只在原安装窗口构造共享本地键锁端口；`/authoring/backend` 仅导出其 `IBackendKeyLockPort` 类型。`attempt(ctx, holder, native, stages?)` 消费 contract 原规范身份和尝试序号：先 try，只有 wait 决策进入原 utils FIFO，锁持续到 native attempt 真正提交、回滚和清理结束。`inspectLocks()` 返回按规范顺序排列的脱离快照。物理后端的原闭包持有端口并在最后一个引用释放时清理；共享端口不随首次创建它的插件自动关闭。端口释放先停止接纳并真正排空，主清理与 symbol 各保留缓存 Promise。
