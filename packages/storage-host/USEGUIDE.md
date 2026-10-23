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
