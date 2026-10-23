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

`/authoring/backend` 同时提供既有平面键 encode/decode、range 快照/比较、JSON 字节预算与 opaque token 函数；纯键与 context 校验仍直接从 contract 消费。`resolveStorageNamespace(configured, orgId, defaultOrgId)` 保留各实例配置前缀：缺省组织使用 configured，其它组织使用 `configured + "/" + orgId`。配置值本身以 `/` 加规范 UUID 结尾时拒绝 contract `INVALID_ARGUMENT`，单独 UUID 配置允许；空值和配置缺省规则仍由各后端处理。

opaque token 保留原格式和条件 fallback；原生 entropy 获取失败以 contract `UNSUPPORTED_CAPABILITY` 拒绝，原错误保留为 cause。
