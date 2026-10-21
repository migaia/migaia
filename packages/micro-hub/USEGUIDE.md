# `@migaia/micro-hub` 使用手册

[English](./USEGUIDE.en.md)

## 目录

- [1. Hub](#1-hub)
- [2. 契约](#2-契约)
- [3. 应用句柄](#3-应用句柄)
- [4. 状态](#4-状态)
- [5. 事件与请求](#5-事件与请求)
- [6. 持久化](#6-持久化)
- [7. 共享异步值](#7-共享异步值)
- [8. Web Components](#8-web-components)
- [9. 生命周期与并发](#9-生命周期与并发)
- [10. 公开常量](#10-公开常量)
- [错误码](#错误码)

## 1. Hub

| API | 说明 |
| --- | --- |
| `createMicroHub({ plugins, report? })` | 创建本页唯一的 hub。先检查每个插件的依赖，全部满足才安装。已有 hub 时报 `HUB_ALREADY_CREATED`。 |
| `getMicroHub()` | 取得 hub；尚未创建时报 `HUB_NOT_CREATED`。 |
| `hub.connect(name)` | 连接一个应用。名字非空且不含 `.`；同名应用仍在连接时报 `APP_ALREADY_CONNECTED`。 |
| `hub.apps` | 已连接应用的名字，按连接顺序。 |
| `hub.dispose()` | `hub.dispose()` 断开所有应用并返回等待应用卸载及宿主清理完成的 `Promise<void>`；同一 hub 的后续释放调用复用这次释放的 Promise，之后可以再次 `createMicroHub`。 |

`report(error)` 接收不应打断当前操作的错误：listener 和订阅回调的异常、清理失败。省略时使用 `globalThis.reportError`，没有则 `console.error`。`report` 自身抛错时，两个错误都交给默认 reporter。

## 2. 契约

`defineContract(name, spec)` 只做校验和冻结，没有副作用。hub 在某个应用第一次 `use()` 或 `own()` 时登记它。

| 字段 | 说明 |
| --- | --- |
| `version` | 正整数主版本。同名契约以第一次登记的版本为准，之后版本不同报 `CONTRACT_VERSION_MISMATCH`。 |
| `state` | 字段初始值，或 `keyed<T>()`。初始值用 `structuredClone` 复制后冻结顶层，因此必须可结构化克隆。 |
| `computed` | `(state) => value`。只依赖它实际读取的字段。 |
| `commands` | `(state, ...args) => patch`。必须同步；返回只包含要改的字段。 |
| `writers` | 除 owner 外允许调用 command 的应用名。默认只有 owner 能写。 |
| `events` | `event<T>()`。只有 owner 能 emit。 |
| `requests` | `request<In, Out>()`。owner 注册唯一 handler。 |
| `resources` | `resource<T>()`。owner 提供 fetcher。 |

非法名字、非正整数版本、section 中类型不对的成员都报 `INVALID_OPTION`（`TypeError`）。

## 3. 应用句柄

主应用与子应用拿到的 `IMicroApp` 完全一样：

| 成员 | 说明 |
| --- | --- |
| `name` / `connected` | 名字；`disconnect()` 后 `connected` 为 false。 |
| `use(contract)` | 返回契约视图。同一应用对同一契约重复调用返回同一个对象。 |
| `own(contract, options?)` | 认领 owner，返回视图加 owner 专属成员。已有 owner 时报 `CONTRACT_OWNED`。 |
| `disconnect()` | 应用的 `disconnect()` 先同步释放该应用的订阅、handler 和所有权，再从 plugin-host 卸载该应用；返回的 `Promise<void>` 用于等待这次卸载，同一句柄的后续断开调用复用它。 |

断开后再调用句柄或视图上的成员报 `APP_DISCONNECTED`。owner 专属成员：

| 成员 | 说明 |
| --- | --- |
| `events.<name>.emit(payload)` | 同步分发给所有 listener。 |
| `handle(name, handler)` | 注册请求 handler；重复注册报 `HANDLER_DUPLICATED`。返回注销函数。 |
| `provide(name, fetcher)` | 注册共享异步值的 fetcher。返回注销函数。 |
| `persistence` | 请求了持久化时为 store-persist 的 `IPersistHandle`，否则 `undefined`。 |
| `release()` | 放弃所有权，其它应用之后可以认领。状态保留。 |

## 4. 状态

视图上的 `state.<field>` 是 `IReadable<T>`；`keyed` 字段是 `{ at(id): IReadable<T | undefined>; ids: IReadable<readonly string[]> }`。

- `get()` 在下一次提交前返回同一个引用。
- `subscribe(listener)` 在之后每次提交后调用 `listener()`，不传值；回调里 `get()` 已是新值。返回的取消函数可重复调用；应用断开时自动取消。
- 一次 command 写多个字段，所有订阅者在同一批次后各收到一次通知。
- keyed 字段写某个 id，只通知这个 id 的订阅者；id 增删时 `ids` 才通知。

`commands.<name>(...args)` 返回 `{ revision }`。调用方既不是 owner 也不在 `writers` 中时报 `WRITE_DENIED`。command 返回 thenable 时报 `COMMAND_ASYNC`（`TypeError`），状态不变。patch 中出现契约里没有的字段报 `INVALID_OPTION`，同样不写入任何字段。

`select(selector, equals?)` 返回 `IReadable<R>`：只有 `equals`（默认 `Object.is`）判定结果变化时才通知；未订阅时 `get()` 按 revision 缓存，结果相等时保持旧引用。最后一个订阅者离开时释放内部节点。

`revision` 是契约的提交次数。

## 5. 事件与请求

- `events.<name>.on(listener)`：返回取消函数，断开时自动取消。
- owner 的 `emit` 同步分发，listener 按注册顺序调用；listener 中再次 emit 会排队，在当前分发结束后执行。单次顶层 emit 最多触发 `publishBudget`（默认 10 000）次 listener 调用，超过时停止并上报，避免两个应用互相 emit 形成死循环。
- listener 抛出的错误交给 `report`，不影响其它 listener，也不抛给 emit 方。

`requests.<name>(input, { waitForOwner? })`：

- owner 已注册 handler：调用它，返回 handler 的结果；handler 抛出的错误原样拒绝。
- 没有 handler 且未设置 `waitForOwner`：拒绝 `OWNER_ABSENT`。
- 设置了 `waitForOwner`：等待 handler 注册；超时拒绝 `OWNER_TIMEOUT`；等待期间调用方断开拒绝 `APP_DISCONNECTED`。
- 调用进行中 owner 断开或 `release()`：拒绝 `OWNER_GONE`。handler 的副作用可能已经发生，重试前先对账。

## 6. 持久化

`persist({ store, debounceMs?, keyPrefix? })` 需要 `state()`。`store` 是任意 `IKeyValueStore`，例如 `@migaia/storage-web/local-storage` 的 `localStorageHost({ namespace })` 或 `@migaia/storage-web/indexed-db` 的 `indexedDbHost({ dbName })`。这两个工厂名字带 `Host`，但只返回一个 store，不会创建 storage-web 的 host；micro-hub 也不使用 storage-web 的 `./plugins/*`（它们只能装进 storage host）。hub 只借用这个 store，不会释放它。

`own(contract, { persist: ['items'], persistKey? })` 把所选普通字段写到 `<keyPrefix><persistKey ?? 契约名>`，并在 owner 启动时读回。读回期间发生的写入不会被存档覆盖（store-persist 的 hydrate 合并规则）。同一 hub 内更换 owner 时，已恢复或已写入的字段保留内存值，不再被旧存档覆盖；新 hub 仍会恢复存档。存档版本取契约 `version`；主版本升级后旧存档被丢弃，字段从契约初始值开始。`owned.persistence.ready` 在首次读回成功后兑现。owner 断开或 `release()` 时停止持久化。keyed 字段不能持久化。

同一 hub、同一存储 key 的异步写入在 owner 交接时保持顺序：新 attachment 的读写与删除等待前任已接纳的写入及最终写入完成，因此 `persistence.ready` 可能等待前任释放。`hub.dispose()` 也等待这些写入结束；失败交给 hub 的 `report`，不阻止下一任恢复读写。

## 7. 共享异步值

`resources()` 需要可选 peer `@migaia/resource`。owner 调用 `provide(name, (signal) => fetch(...))` 后：

- `resources.<name>.read()`：已有值直接兑现；请求中返回同一个 Promise；否则发起请求。并发读取共享一次请求。
- `resources.<name>.state`：`IReadable<{ status, data, error }>`。订阅会开始观察资源。
- `resources.<name>.refetch()`：丢弃缓存重新请求；失败交给 `report`。
- owner 未提供时 `read()` 拒绝 `OWNER_ABSENT`，`state.get()` 为 `idle`。

## 8. Web Components

| API | 说明 |
| --- | --- |
| `MICRO_APP_CONTEXT` | Context Protocol 的 context key（字符串）。 |
| `provideMicroApp(element, app)` | 让 `element` 应答后代（含 shadow DOM）的 `context-request`；同时应答此前未被应答的 helper 请求，并发出 `context-provider` 以便外部 ContextRoot 重放订阅请求。返回停止函数。 |
| `consumeMicroApp(element, callback)` | 发出 `context-request`（`bubbles`、`composed`）；没有 provider 时等待。返回取消函数。 |

Lit consumer 可能早于 provider 连接时，在共同祖先先连接 `ContextRoot`，并设置 `@consume({ context: MICRO_APP_CONTEXT, subscribe: true })`。ContextRoot 记录未应答的订阅请求，收到 provider 的 `context-provider` 后从原 consumer 重新发出请求；本包复用这一协议，不创建自己的 ContextRoot。

## 9. 生命周期与并发

- 每个应用是 hub 内部 plugin-host 中的一个插件；`disconnect()` 先同步释放资源，再异步卸载插件，因此卸载过程中不会有回调到达已卸载的应用。立即以同名重新连接是允许的。
- command 同步执行，同一 realm 内天然串行。订阅回调中再调用 command，写入在当前批次结束后提交。
- owner 断开后状态保留；新的 owner 认领后可继续写。

## 10. 公开常量

根入口导出的三个常量对象都是冻结的字面量，取值本身就是公开约定。

| 常量 | 取值 | 用途 |
| --- | --- | --- |
| `MicroResourceStatus` | `idle`、`pending`、`success`、`error`、`cancelled` | `resources.<name>.state.get().status` 的取值。`idle` 表示 owner 还没有 `provide`；`cancelled` 表示请求被新的请求取代或 owner 已释放。比较状态时写 `status === MicroResourceStatus.success`。 |
| `MicroCapability` | `events`、`state`、`persist`、`resource` | 能力插件的种类名。每个插件声明一种；`PLUGIN_MISSING` 的消息里出现的就是这些名字。编写自定义插件或按缺失能力给出提示时使用。 |
| `MicroHubErrorText` | 每个错误码对应的消息文字或消息工厂 | 本包抛出的所有消息都来自这里，例如 `MicroHubErrorText.appDisconnected('cart')`。分支判断请用 `code`；只有在测试或日志里需要核对原文时才引用它。 |

```ts
import { MicroResourceStatus } from '@migaia/micro-hub'

const { status, data } = view.resources.profile.state.get()
if (status === MicroResourceStatus.success) render(data)
```

## 错误码

| 码 | 类型 | 触发 | 调用方处理 |
| --- | --- | --- | --- |
| `HUB_ALREADY_CREATED` | Error | 已有 hub 时再次 `createMicroHub` | 子应用用 `getMicroHub()` |
| `HUB_NOT_CREATED` | Error | hub 未创建或已释放 | 主应用先创建 hub |
| `APP_ALREADY_CONNECTED` | Error | 同名应用仍在连接 | 先断开旧实例 |
| `APP_DISCONNECTED` | Error | 断开后继续使用句柄 | 重新连接 |
| `PLUGIN_MISSING` | Error | 契约或插件依赖的能力未安装 | 在 `plugins` 中加入 |
| `CONTRACT_VERSION_MISMATCH` | Error | 同名契约主版本不同 | 对齐部署版本 |
| `CONTRACT_OWNED` | Error | 契约已有 owner | 等待 owner 断开或 `release()` |
| `WRITE_DENIED` | Error | 非 owner 且不在 writers | 加入 writers，或改用请求 |
| `EMIT_DENIED` | Error | `release()` 后继续调用 owner 专属成员（emit、handle、provide） | 重新认领 |
| `COMMAND_ASYNC` | TypeError | command 返回 thenable | 先完成异步工作再调用 command |
| `HANDLER_DUPLICATED` | Error | 重复 `handle` / `provide` | 去掉重复注册 |
| `OWNER_ABSENT` | Error | 请求时没有 handler | 传 `waitForOwner` 或稍后重试 |
| `OWNER_TIMEOUT` | Error | 等待 handler 超时 | 报告失败或稍后重试 |
| `OWNER_GONE` | Error | 请求进行中 owner 离开 | 对账后再重试 |
| `INVALID_OPTION` | TypeError | 名字、版本、成员或 patch 字段非法 | 修正调用 |
