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
