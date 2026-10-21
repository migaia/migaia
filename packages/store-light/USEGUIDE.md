# `@migaia/store-light` 使用指南

[English](./USEGUIDE.en.md)

包的定位、亮点和心智模型见 [README](./README.md)。本指南先按场景给出可以直接运行的示例（Node 24），再逐项列出 Store 定义规则、全部公开 API 的签名、`StoreResource` 的完整状态机和每一条错误信息。

## 按场景查找

| 你遇到的问题 | 看这一节 |
| --- | --- |
| 改了字段忘了更新派生值，监听者看到写了一半的状态 | [写普通对象就得到响应式状态](#写普通对象就得到响应式状态) |
| 升级后恢复本地设置，旧字段写进状态或数据悄悄丢失 | [只保存能恢复的字段](#只保存能恢复的字段) |
| 退出登录后，没清理的回调还在显示旧数据 | [读取已释放的 store 会明确报错](#读取已释放的-store-会明确报错) |
| 回调函数存进状态，被当成了方法 | [把回调保存成可替换的字段](#把回调保存成可替换的字段) |
| 组件卸载后连接、解码器没有关 | [没人使用之后自动释放异步值](#没人使用之后自动释放异步值) |
| 重新加载后旧值泄漏或被释放两次 | [重新加载时旧值只释放一次](#重新加载时旧值只释放一次) |

## 写普通对象就得到响应式状态

购物车有商品列表、合计和一行摘要。手写时，每个改列表的方法都要记得重算摘要、通知监听者；监听者如果在两次写入之间运行，看到的是新列表配旧合计。

响应式库能解决这个问题，但通常要求把每个字段包成 signal、每个派生值包成 computed，状态就不再像它描述的那个对象了。

`createStore` 直接接收你平时写的对象：普通字段变成可写的响应式值，getter 变成派生值，读到的字段变了它就重算；方法变成 Action，一次调用里的所有写入在方法返回时一起发布。

```ts doc-test=run
import { createStore } from '@migaia/store-light'

const cart = createStore({
  items: [] as string[],
  total: 0,
  // getter 自动变成派生值：items 或 total 变了，它跟着变
  get summary() {
    return `${this.items.length} 件，共 ${this.total} 元`
  },
  // 方法自动变成 Action：里面的多次写入合并成一次通知
  add(name: string, price: number) {
    this.items = [...this.items, name]
    this.total += price
  }
})

const stop = cart.$subscribe(() => console.log(`通知：${cart.summary}`))

cart.add('键盘', 300)
cart.add('鼠标', 100)
await Promise.resolve() // 通知在微任务里发出

stop()
await cart.$dispose()
```

输出：

```text
通知：1 件，共 300 元
通知：2 件，共 400 元
```

调用两次 `add`，收到两次通知，每次通知里列表和合计都已经是新的。

Action 在返回时立即发布一次，监听者不会看到一个方法只写了一半的状态。不在方法里、直接给字段赋值的写入，则在下一个微任务里合并。

## 只保存能恢复的字段

设置项保存在本地存储里。升级之后，有些旧字段已经删掉，又新增了字段；恢复旧 JSON 时，要么写进状态里没有的键，要么悄悄丢掉数据却没人发现。

手写持久化通常把整个对象序列化，派生值和方法也带上，恢复时用 `Object.assign`，给什么就拷什么。

`$plain()` 只返回可写字段。`$hydrate()` 只写回这个 store 有的字段，并在一个批次里完成；传 `unknown: 'report'` 时，每跳过一个键就调用一次 `onUnknown`，传 `unknown: 'strict'` 则整份输入直接拒绝。

```ts doc-test=run
import { createStore } from '@migaia/store-light'

const settings = createStore({
  theme: 'light',
  fontSize: 14,
  get label() {
    return `${this.theme} / ${this.fontSize}px`
  },
  reset() {
    this.theme = 'light'
    this.fontSize = 14
  }
})

settings.$set({ theme: 'dark', fontSize: 16 })
// 只取可写字段：派生值和方法不会被存进去
const saved = JSON.stringify(settings.$plain())
console.log(`保存：${saved}`)

// 下个版本删掉了 fontSize，新增了 language；旧数据里还有 fontSize 和一个已废弃的字段
const next = createStore({ theme: 'light', language: 'zh' })
next.$hydrate(
  { ...JSON.parse(saved), legacyMode: true },
  { unknown: 'report', onUnknown: (key) => console.log(`忽略未知字段：${key}`) }
)
console.log(`恢复后：${JSON.stringify(next.$plain())}`)

await settings.$dispose()
await next.$dispose()
```

输出：

```text
保存：{"theme":"dark","fontSize":16}
忽略未知字段：fontSize
忽略未知字段：legacyMode
恢复后：{"theme":"dark","language":"zh"}
```

保存的 JSON 里只有 `theme` 和 `fontSize`，没有 `label` 和 `reset`。恢复到新版本时，`fontSize` 和 `legacyMode` 被报告为已忽略，结果保留了 `theme` 和新增的 `language`。

默认的 `unknown: 'ignore'` 会静默跳过未知键；想记录迁移情况就用 `report`，输入有误就必须整份拒绝时用 `strict`。

## 读取已释放的 store 会明确报错

退出登录后会话状态已经释放，但某个没清理的定时器或回调还在读它，悄悄显示出上一个用户的名字。

普通对象不知道自己已经不用了，过期的读取方拿到的是旧值而不是错误，问题只会表现为数据不对。

调用 `$dispose()` 之后，读写字段、调用方法都会抛 `STORE_DISPOSED`。`$disposed` 在释放任何资源之前就变成 `true`；重复调用 `$dispose()` 返回同一个 Promise。

```ts doc-test=run
import { createStore } from '@migaia/store-light'

const session = createStore({ user: 'Ada' })
await session.$dispose() // 用户退出登录，会话状态被释放

try {
  console.log(session.user) // 某个还没清理的回调仍在读取
} catch (error) {
  const failure = error as Error & { code?: string }
  console.log(`读取失败：${failure.code}`)
}
console.log(`已释放：${session.$disposed}`)
```

输出：

```text
读取失败：STORE_DISPOSED
已释放：true
```

迟到的读取以 `STORE_DISPOSED` 失败，`$disposed` 为 `true`。

被遗忘的读取方现在会在读取的那一行报错，而不是在界面上显示过期数据。

## 把回调保存成可替换的字段

表单在 store 里保存一个 `onSubmit` 回调，页面运行时会更换它。直接把函数写进 store 定义，它会被当成方法。

`createStore` 会把每个函数都变成 Action，光看对象没法分辨一个函数是字段还是方法。

用 `raw()` 包住这个值，就把它标记为数据：字段可读可写，赋一个新函数会通知订阅者，调用时执行的是当前的函数。

```ts doc-test=run
import { createStore, raw } from '@migaia/store-light'

const form = createStore({
  // 不包 raw 的函数会被当成方法；这里要的是一个可以替换的回调字段
  onSubmit: raw((data: string) => console.log(`默认提交：${data}`)),
  submit(data: string) {
    this.onSubmit(data)
  }
})

const stop = form.$subscribe(() => console.log('提交回调已更换'))
form.submit('草稿')

form.onSubmit = (data) => console.log(`发送到服务器：${data}`)
await Promise.resolve()
form.submit('正式稿')

stop()
await form.$dispose()
```

输出：

```text
默认提交：草稿
提交回调已更换
发送到服务器：正式稿
```

第一次提交运行默认回调；更换回调时订阅者收到通知，第二次提交运行的是新回调。

凡是要原样保存、不希望被解释的值，例如回调、外部传入的类实例、格式化函数，都用 `raw()` 包住。

## 没人使用之后自动释放异步值

组件挂载时打开一个连接或解码器，最后一个需要它的组件卸载后应该关掉它，但又不该马上关，因为下一个页面往往还要用。

手写时用一个模块变量数使用者，组件里任何一次提前返回或抛错都可能漏掉一次减一，资源就一直开着。

`createStoreResource` 持有加载到的值。`retainResource()` 返回一个释放函数；没有任何持有者之后，值再保留 `keepAliveMs`（默认 1000 毫秒），然后调用一次 `dispose`。

```ts doc-test=run
import { createStoreResource } from '@migaia/store-light'

// 模拟一个占用资源的对象，例如打开的连接或解码器
function openConnection(name: string) {
  console.log(`打开 ${name}`)
  return { name }
}

const connection = createStoreResource(() => openConnection('连接 #1'), {
  keepAliveMs: 20, // 没人使用后再保留 20ms
  dispose: (value) => console.log(`关闭 ${value.name}`)
})

const release = connection.retainResource() // 组件挂载，开始使用
connection.preload()
await new Promise((resolve) => setTimeout(resolve, 5))
console.log(`读取：${connection.read().name}`)

release() // 组件卸载，不再使用
console.log('组件卸载')
await new Promise((resolve) => setTimeout(resolve, 50))
console.log('结束')
```

输出：

```text
打开 连接 #1
读取：连接 #1
组件卸载
关闭 连接 #1
结束
```

连接只打开一次，组件持有期间可以读取，组件卸载约 20 毫秒后关闭。

没有传 `dispose` 选项、而值自带 `$dispose` 方法时，会改为调用它。`keepAliveMs: 0` 表示最后一个持有者离开时立即同步释放。

## 重新加载时旧值只释放一次

重新加载会创建一个新的解码器。旧的必须释放，但要等新的准备好之后再释放，界面才不会空着；而且绝不能释放两次。

手写的重新加载代码，往往在新值到达之前就释放了旧值，或者走到错误分支时忘了释放；被取代之后才返回的值更是直接泄漏。

`retry()` 发起新的加载，在新值发布之前一直保留旧值，之后把旧值释放一次。被取代之后才到达的值、资源释放之后才到达的值，也都会被释放。

```ts doc-test=run
import { createStoreResource } from '@migaia/store-light'

let opened = 0
const decoder = createStoreResource(
  () => {
    opened++
    console.log(`创建解码器 #${opened}`)
    return { id: opened }
  },
  { dispose: (value) => console.log(`释放解码器 #${value.id}`) }
)

const release = decoder.retainResource()
decoder.preload()
await new Promise((resolve) => setTimeout(resolve, 5))
console.log(`正在使用 #${decoder.read().id}`)

decoder.retry() // 用户点“重新加载”
await new Promise((resolve) => setTimeout(resolve, 5))
console.log(`正在使用 #${decoder.read().id}`)

release()
decoder.dispose()
await decoder.whenTerminal()
console.log('全部释放完成')
```

输出：

```text
创建解码器 #1
正在使用 #1
创建解码器 #2
释放解码器 #1
正在使用 #2
释放解码器 #2
全部释放完成
```

先创建 #2，再释放 #1，组件读到的是 #2。释放资源时释放了 #2，`whenTerminal()` 在全部释放完成后才完成。

加载函数创建的每个值，不管以哪种方式结束，都只被释放一次。

---

## API 手册

### 目录

1. [导入与依赖](#1-导入与依赖)
2. [Store 定义规则](#2-store-定义规则)
3. [创建入口参考](#3-创建入口参考)
4. [ICreateStoreOptions 参考](#4-icreatestoreoptions-参考)
5. [`$`-API 完整参考](#5-api-完整参考)
6. [FieldBuilder：自定义字段扩展协议](#6-fieldbuilder自定义字段扩展协议)
7. [写入守卫：IMutationGuard / IMutationPolicy](#7-写入守卫imutationguard--imutationpolicy)
8. [StoreResource：Suspense 安全的异步值容器](#8-storeresourcesuspense-安全的异步值容器)
9. [状态常量与错误构造工具](#9-状态常量与错误构造工具)
10. [错误信息全表](#10-错误信息全表)
11. [生命周期与释放语义](#11-生命周期与释放语义)
12. [贴近生产的组合示例](#12-贴近生产的组合示例)
13. [常见问题排查](#13-常见问题排查)

---

## 1. 导入与依赖

```ts doc-test=check
import {
  createStore,
  createAsyncStore,
  storeReady,
  raw,
  isRaw,
  isFieldBuilder,
  FIELD_BUILDER,
  createStoreResource,
  createStoreResourceScope
} from '@migaia/store-light'
```

`store-light` 依赖 `@migaia/reactive`（图与 Runtime）、`@migaia/resource`（请求）、`@migaia/lifecycle`（所有权与清理）、`@migaia/event-subscriber`（通知）及 `@migaia/utils`（基础协议与调度）。所有节点默认创建在 `@migaia/reactive` 的 `defaultRuntime` 上；需要隔离运行时（多 root、SSR 每请求、单测互不串状态）时，通过 `@migaia/reactive` 的 `createRuntime()` 构造独立 Runtime，再传入 `options.runtime`。`store-light` 本身不 import 任何 UI 框架，也不假设特定宿主环境。

---

## 2. Store 定义规则

`createStore(shape, options?)` 接收一个对象字面量，逐个属性描述符（`Object.getOwnPropertyDescriptors`）按以下规则分类：

| 输入形状                                       | 归类为         | 说明                                                                                                                                               |
| ---------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get x() { ... }` 访问器                       | **Computed**   | `this` 绑定到 Store 自身；惰性求值，依赖变化才重新计算；对外只读，`store.x = v` 不做任何事（严格模式下抛 TypeError，因为底层是只有 getter 的属性） |
| `raw(value)` 包裹的值                          | **原样字段**   | 即使 `value` 是函数也不当 Action；可读可写可整体替换（典型用途：存 `onSubmit` 这类回调）                                                           |
| 普通函数 `method() {}`                         | **Action**     | 自动包一层 `runtime.runTracedAction` + batch + untracked；`this` 绑定到 Store，方法内可以自然读写其他字段                                          |
| `FieldBuilder`（`isFieldBuilder(value)` 为真） | **自定义字段** | 交给 Builder 的 `create()` 产出实际字段对象，见 [第 6 节](#6-fieldbuilder自定义字段扩展协议)                                                            |
| 其他普通值                                     | **Signal**     | 读时自动订阅（在 Computed/Effect 内读取时建立依赖），写时触发通知                                                                                  |

`IStoreDefinition<S>` 类型给输入对象附加了 `ThisType<IReactiveStore<S>>`——这意味着方法体和 getter 体内的 `this` 拿到的是**解析后**的 Store 类型（`FieldBuilder` 已经变成它 `create()` 产出的真实字段类型），而不是输入字面量里那个还没解析的 `FieldBuilder` 类型；不加这个类型标注，方法里写 `this.wasmField.value` 之类的代码会类型报错。

字段名到暴露类型的映射由 `IStoreShape<S>` 完成；工程上不需要手写这个映射，`createStore` 的返回值类型会自动推导正确。

---

## 3. 创建入口参考

| API                                 | 签名                                | 参数类型                                                      | 同步/异步 | 行为                                                                                                                                                                                         |
| ----------------------------------- | ----------------------------------- | ------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createStore(shape, options?)`      | `(S) => IReactiveStore<S>`          | `shape: IStoreDefinition<S>`；`options?: ICreateStoreOptions` | 同步      | 同步创建；**shape 中任意字段是非 `mode: 'sync'` 的 `FieldBuilder`（`mode: 'async'` 或历史无 mode 的 Builder）会在读取属性描述符阶段直接抛错**，不会执行任何 I/O，提示改用 `createAsyncStore` |
| `createAsyncStore(shape, options?)` | `(S) => Promise<IReactiveStore<S>>` | `shape: IStoreDefinition<S>`；`options?: ICreateStoreOptions` | 异步      | 允许异步 `FieldBuilder`；返回的 Promise 在全部异步字段初始化完成（或抛错）后才 resolve/reject，resolve 后每个字段都已就绪                                                                    |
| `storeReady(store)`                 | `(store: object) => Promise<void>`  | `store: object`                                               | 异步      | 返回该 Store 的就绪 Promise；只对通过上述任一入口创建的 Store 有效，传入非 Store 对象会抛 `[store] store has no asynchronous initialization`                                                 |

创建入口只有 `createStore`（纯同步定义）和 `createAsyncStore`（含异步字段的定义）。

纯 Signal/Computed Store 不建立异步 lifecycle scope；遇到 FieldBuilder、source capability、订阅 Effect 或 `$own` 外部资源时才创建。相邻原生节点合为一个同步逆序释放段，在不同资源边界登记该段，保持原混合 LIFO。初始化 AbortController 只在第一个 Builder 准入时通过 lifecycle native factory 创建。`$dispose()` 的 Promise identity、外部异步清理与错误策略保持。

**初始化失败的清理语义**：无论走哪个入口，构造过程中任何一步抛错（字段类型非法、Builder 的 `create()` 拒绝所有权等），已经创建的内部节点都会按注册逆序回收，不会遗留半初始化的资源。异步字段初始化失败（`readyList` 中的 Promise reject）同样会把整个 Store 标记为 `disposed` 并回收资源，即使有的字段在此之前已经初始化成功。

---

## 4. ICreateStoreOptions 参考

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
const store = createStore(shape, {
  runtime,
  debugName: 'settings',
  warnAsyncActions: true,
  mutationPolicy: createMutationPolicy('actions-only')
})
```

| 选项               | 类型              | 必填性 | 默认值           | 作用                                                                                                                                                                       |
| ------------------ | ----------------- | ------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runtime`          | `IRuntime`        | 可选   | `defaultRuntime` | 显式指定节点所属的 Runtime；同一个 Runtime 上的节点共享一张依赖图，跨 Runtime 的节点完全隔离                                                                               |
| `debugName`        | `string`          | 可选   | `'Store'`        | 调试名前缀，出现在内部节点的 `debugName`（形如 `${debugName}.${key}`）里，不参与状态语义                                                                                   |
| `warnAsyncActions` | `boolean`         | 可选   | `false`          | 开启后，若某个 Action 返回了一个 thenable（说明它是 async 方法），首次调用时会 `Runtime.reportError` (`ACTION_BATCH_BOUNDARY`) 提示"只有首个 await 之前的写入被自动 batch" |
| `mutationPolicy`   | `IMutationPolicy` | 可选   | 无               | 接入 MobX 风格的严格写入守卫，见 [第 7 节](#7-写入守卫imutationguard--imutationpolicy)                                                                                          |

---

<a id="5-api-完整参考"></a>

## 5. `$`-API 完整参考

输入字段不能使用内置 API 的同名键（例如 `$snapshot`、`$dispose`）：冲突以 `INVALID_OPTION` TypeError 拒绝，已经创建的字段进入同一构造回滚。

`$`-前缀的方法/属性挂载为**不可枚举**属性，不会出现在 `for...in`、`Object.keys()` 或 `$snapshot()` 的用户字段遍历里。

| API                           | 签名                                        | 参数类型                                                        | 同步/异步      | 副作用 / 边界                                                                                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------------------- | --------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `$runtime`                    | `IRuntime`                                  | 无（属性）                                                      | 同步           | 该 Store 所有节点所属的 Runtime；可写 data 属性，供 React 适配层等在同一张图上建 Effect                                                                                                                                                                                                          |
| `$async`                      | `boolean`                                   | 无（属性）                                                      | 同步           | 定义里是否含异步 `FieldBuilder`；为 `false` 时整个 Store 同步就绪                                                                                                                                                                                                                          |
| `$disposed`                   | `boolean`（getter）                         | 无（属性）                                                      | 同步           | 是否已释放，实时求值，不是构造时的静态快照                                                                                                                                                                                                                                                 |
| `$snapshot()`                 | `() => IStoreShape<S>`                      | 无                                                              | 同步           | 返回全部字段（signal + computed + wasm 字段）的一次性快照对象；**要求 Store 已就绪**，异步字段未就绪时抛 `[store] store is pending; use createAsyncStore()...`                                                                                                                             |
| `$plain()`                    | `() => Record<string, unknown>`             | 无                                                              | 同步           | 只返回 signal 支撑的标量字段（含 `raw()` 字段），**排除** computed/wasm 字段/方法；**不要求 Store 已就绪**，异步字段初始化期间也能调用；持久化层（`@migaia/store-persist`）基于它取快照                                                                                                    |
| `$hydrate(partial, options?)` | 见下                                        | `partial: Record<string, unknown>`；`options?: IHydrateOptions` | 同步           | 宽松写回：只写已知 signal 键，未知/computed/wasm 键按 `options.unknown` 处理；**不要求 Store 已就绪**；整批写入经 mutation policy 与 `runtime.batch` 合并通知，不回滚已经完成的写入                                                                                                                                             |
| `$subscribe(fn, options?)`    | `(fn, { fireImmediately? }) => IDisposer`   | `fn: () => void`；`options?: ISubscribeOptions`                 | 同步           | 注册一个粗粒度订阅 Effect：读取全部 signal 与 computed 的 `.value` 和 wasm source 的 `track()`；首次建立订阅会求值 computed getter，也能追踪其 Store 外依赖；`fireImmediately: true` 时订阅建立后立即调用一次 `fn`；`fn` 抛错会经 `runtime.reportError` 上报，不会中断订阅本身 |
| `$batch(recipe)`              | `(recipe: (draft) => void) => void`         | `recipe: (draft: IStoreShape<S>) => void`                       | 同步           | 整个 recipe 在一次 `batch` 内执行，多次字段写入只触发一次通知；`draft` 就是 Store 本身；**不是事务**，recipe 中途抛错不回滚已写入的字段；写只读 computed 字段会自然抛错（属性只有 getter）                                                                                                 |
| `$set(patch)`                 | `(patch: IWritableStorePatch<S>) => void`   | `patch: IWritableStorePatch<S>`                                 | 同步           | 低层批量赋值；**编译期**只接受非 computed/非 FieldBuilder/非方法的字段（含 `raw()` 字段），**运行期**对每个 key 额外校验对应 signal 是否存在，不存在则抛 `[store] field is not settable: ${key}`（防御动态/非法输入）                                                                      |
| `$own(resource)`              | `<T extends IDisposable>(resource: T) => T` | `resource: T extends IDisposable`                               | 同步           | 把外部资源纳入本 Store 的所有权作用域，`$dispose()` 时一并释放；资源必须未归属或已归属本 Runtime，跨 Runtime 直接拒绝（见 [第 10 节](#10-错误信息全表)）                                                                                                                                        |
| `$dispose()`                  | `() => Promise<void>`                       | 无                                                              | 异步、同步启动 | 首次调用同步切换 `$disposed`、中止在途异步字段初始化并启动全部内部节点清理；所有调用返回同一个 Promise，成功或失败均稳定重放，Promise settle 表示 owned cleanup 已完成                                                                                                                     |

`ISubscribeOptions`：`{ fireImmediately?: boolean }`，默认 `false`。
`IHydrateOptions`：`{ unknown?: 'ignore' | 'report' | 'strict'; onUnknown?: (key: string) => void }`，默认 `unknown: 'ignore'`（向后兼容的部分 hydration）；`'strict'` 遇到未知 key 直接抛错；`'report'` 对每个未知 key 调用一次 `onUnknown`，写入过程本身继续。

---

## 6. FieldBuilder：自定义字段扩展协议

Store 定义协议，扩展去实现——`store-light` 不知道 WASM、也不知道任何具体字段实现，`FieldBuilder` 只是一份约定。`@migaia/store-wasm` 的 `number()`/`string()`/`boolean()`/`array()`/`record()` 都是这份协议的具体实现。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
export type IFieldContext = {
  runtime: IRuntime
  signal: AbortSignal // Store dispose 时中止在途初始化
  createSource(debugName?: string): IFieldSource
}

export type ISyncFieldBuilder<F extends IDisposable> = {
  readonly [FIELD_BUILDER]: true
  readonly mode: 'sync'
  create(context: IFieldContext): F
}

export type IAsyncFieldBuilder<F extends IDisposable> = {
  readonly [FIELD_BUILDER]: true
  readonly mode: 'async'
  create(context: IFieldContext): Promise<F>
}
```

| 名称                    | 作用                                                                                                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FIELD_BUILDER`         | 品牌 symbol，不导出为公共构造 API，只用于 `isFieldBuilder` 的身份判定（防止结构类似的普通对象被误判为 Builder）                                                                                                  |
| `isFieldBuilder(value)` | 类型守卫，判断某个值是否为 `IFieldBuilder`                                                                                                                                                                       |
| `IFieldSource`          | Runtime 为自定义存储签发的最小响应式能力：`track()`（建立依赖）、`notify()`（触发下游更新）、`commit(write)`（在发布前保留版本号，随后一次性 publish，避免"先写后通知"之间的撕裂）、`observed`（是否有人在观察） |
| `IFieldContext`         | Builder 的 `create()` 唯一入参：`runtime` 用于创建普通节点；`createSource` 接入同一张依赖图；`signal` 是 Store dispose 时用来中止在途初始化的 `AbortSignal`                                                      |

**所有权规则**：`IFieldContext` 刻意不传 `scope`——所有权登记是 Store 的职责，不是 Builder 的职责。Builder 只管"造出字段"，Store 在拿到字段后统一 `claimOwnership` + `scope.own`；这样第三方 Builder 实现"创建了资源却忘了登记"时，`$dispose()` 也不会漏释放，因为登记这一步根本不由 Builder 完成。

**同步 vs 异步字段**：所有 Builder 显式给出 `mode: 'sync'` 或 `mode: 'async'`。同步 Builder 可传任一创建入口；异步 Builder 仅传 `createAsyncStore()`。无 mode 的旧形式不再接受。

一个最小的自定义同步字段实现（改编自 `@migaia/store-wasm` 的 `number()`）：

```ts doc-test=check
import { FIELD_BUILDER, type IFieldBuilder, type IFieldContext } from '@migaia/store-light'
import type { IDisposable } from '@migaia/reactive'

type ICounterField = IDisposable & { value: number }

function counterField(initial: number): IFieldBuilder<ICounterField> {
  return {
    [FIELD_BUILDER]: true,
    mode: 'sync',
    create({ createSource }: IFieldContext): ICounterField {
      const source = createSource('CounterField')
      let value = initial
      let disposed = false
      return {
        get value() {
          source.track()
          return value
        },
        set value(v) {
          source.commit(() => {
            value = v
          })
        },
        get disposed() {
          return disposed
        },
        dispose() {
          if (disposed) return
          disposed = true
          source.dispose()
        }
      }
    }
  }
}
```

---

## 7. 写入守卫：IMutationGuard / IMutationPolicy

`store-light` 只定义协议，不提供具体策略实现：

```ts doc-test=skip reason="签名摘要，不是可运行模块"
export type IMutationGuard = { assertMutationAllowed(operation?: string): void }
export type IMutationPolicy = IMutationGuard & { runInAction<T>(fn: () => T): T }
```

- Store 与 collections 类的包只需要回答"能不能改"这一个问题（`IMutationGuard`）；
- Store facade 额外需要"把一次动作标记为正在动作内"这个能力（`IMutationPolicy`），因为方法/`$batch`/`$set`/`$hydrate` 内部的写入应该被放行，直接对字段赋值则由策略决定是否允许。

具体实现（MobX 风格 actions-only 模式）由 `@migaia/store-middleware` 提供：

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
import { createStore } from '@migaia/store-light'
import { createMutationPolicy } from '@migaia/store-middleware'

const store = createStore(
  {
    count: 0,
    increment() {
      this.count += 1 // 在 action 内，允许
    }
  },
  { mutationPolicy: createMutationPolicy('actions-only') }
)

store.increment() // OK
store.count = 5 // 抛错：[store] set(count) is not allowed outside an action
```

不传 `mutationPolicy` 时（默认），任何地方直接赋值都允许，这是为了不改变既有 Store 的行为——严格模式是显式接入的。

---

## 8. StoreResource：Suspense 安全的异步值容器

`createStoreResource(factory, options?)` 创建一个独立于对象 facade 的异步值容器，`createStoreResourceScope()` 管理一组资源的统一释放。两者都不要求配合 `createStore` 使用。

### 8.1 状态投影

请求、数据、取消和共享 Promise 由 `@migaia/resource` 唯一拥有；下图是 StoreLight 结合版本租约派生的视图。

```text
idle --start()--> loading --resolve--> ready --无持有者+超时--> idle（缓存过期，值被释放）
                     |                   |
                     +---reject--------> failed（若有 stale 值则退回 ready 并保留旧值）
ready/loading --dispose()（有持有者）--> closing --最后一个持有者释放--> disposed
任意非 disposed 状态 --forceDispose()/dispose()（无持有者）--> disposed
```

- **`idle`**：尚未开始加载。
- **`loading`**：`factory` 正在执行；若存在上一个已加载的值（`retry()` 触发的重新加载），该值作为 `previous` 保留，读取时可以拿到旧值而不是挂起。
- **`ready`**：已有值可读。
- **`failed`**：加载失败且没有可回退的旧值；有旧值时优先回退到 `ready`（保留旧值），不会转到 `failed`。
- **`closing`**：`dispose()` 时如果还有持有者（resource lease 或 version lease），资源进入这个中间态，等最后一个持有者释放才真正终止；不存在"半关闭"对外可见状态。
- **`disposed`**：逻辑终态，实际 disposer 完成后 `whenTerminal()` 才 resolve，所有方法要么 no-op 要么抛 `[store] resource is disposed`。

### 8.2 API 参考

| API                               | 签名                                     | 参数类型                           | 同步/异步 | 说明                                                                                                                                                                                                 |
| --------------------------------- | ---------------------------------------- | ---------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read()`                          | `() => T`                                | 无                                 | 同步      | 读取当前值；`loading` 中会 `throw` 正在进行的 Promise（React Suspense 协议），`failed` 会 `throw` 错误对象                                                                                           |
| `preload()`                       | `() => void`                             | 无                                 | 同步      | 如果还没开始加载就触发 `start()`；不建立任何持有租约                                                                                                                                                 |
| `retry()`                         | `() => void`                             | 无                                 | 同步      | 把当前值标记为 stale 后重新加载；重新加载完成前旧值仍可读                                                                                                                                            |
| `retainResource()`                | `() => () => void`                       | 无                                 | 同步      | 获取一个"资源级"持有租约（不锁定具体版本），返回释放函数；有此类租约时资源不会因超时被回收                                                                                                           |
| `retainVersion(version)`          | `(number \| IVersionToken) => () => void` | `version: number \| IVersionToken`  | 同步      | 锁定某个具体版本不被回收（即使后续 `retry()` 产生了新版本），常用于"后台刷新但保留当前渲染值"                                                                                                        |
| `captureVersion(id)`              | `(number) => IResourceCapture`           | `id: number`                       | 同步      | 渲染期的临时保护：先拿到一个 capture token，不立即计入正式持有者                                                                                                                                     |
| `commitCapture(capture)`          | `(IResourceCapture) => () => void`       | `capture: IResourceCapture`        | 同步      | 提交期把 capture 转成正式的版本持有租约；`captureVersion`/`commitCapture` 这一对是给 React"渲染可能被丢弃、提交才算数"的两阶段场景设计的（`@migaia/store-react` 的 `useStoreResource` 就是这样用的） |
| `dispose()`                       | `() => void`                             | 无                                 | 同步      | 优雅释放：仍有持有者时转入 `closing`，等最后一个持有者释放后才真正清理                                                                                                                               |
| `forceDispose()`                  | `() => void`                             | 无                                 | 同步      | 无视持有者，立即转入终态并清理全部内部状态                                                                                                                                                           |
| `whenTerminal()`                  | `() => Promise<void>`                    | 无                                 | 异步      | 逻辑 disposed 后等待实际 disposer 完成才 resolve；不依赖 GC，任何时候调用都能正确等到                                                                                                                                      |
| `subscribe(listener)`             | `(() => void) => () => void`             | `listener: () => void`             | 同步      | 注册变更监听（配合 `getSnapshot()` 可直接喂给 `useSyncExternalStore`）                                                                                                                               |
| `getSnapshot()`                   | `() => number`                           | 无                                 | 同步      | 单调递增的 revision 号，每次状态变化都会自增                                                                                                                                                         |
| `readSnapshot()`                  | `() => { value, version, token }`        | 无                                 | 同步      | 同 `read()`，但额外带上版本号和 `IVersionToken`，供需要精确版本信息的调用方使用                                                                                                                       |
| `captureSnapshot(existingLease?)` | 见 `useStoreResource` 用法               | `existingLease?: object`           | 同步      | 组合了读取快照与 `captureVersion` 的便捷方法，`existingLease` 传入上一次已提交的 release 函数用于跳过重复 capture                                                                                    |

### 8.3 IStoreResourceOptions

| 字段          | 类型                                              | 必填性   | 默认值            | 说明                                                                                                                                            |
| ------------- | ------------------------------------------------- | -------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `runtime`     | `IRuntime`                                        | 可选     | 共享 Runtime      | 负责延迟的空闲清理和诊断上报                                                                                                                    |
| `scheduler`   | `IScheduler`                                      | 可选     | `systemScheduler` | 创建时读取一次，用于缓存有效期和临时 capture 的过期；任务的取消与 unref 语义保持不变                                                            |
| `keepAliveMs` | `number`                                          | 可选     | `1000`            | 无任何持有者（resource lease + version lease + 挂起的 capture）之后，缓存值继续存活的毫秒数；必须是有限非负数，否则构造时抛 `RangeError`        |
| `dispose`     | `(value: T) => void \| PromiseLike<void>`             | 可选     | 无                | 自定义清理函数；提供后，值必须是引用类型（对象/函数），否则抛 `TypeError`；不提供时，若值本身带 `$dispose` 方法（例如另一个 Store），会自动调用 |
| `onError`     | `(error, phase: StoreResourceErrorPhase) => void` | 可选     | 无                | 观察 `'load' \| 'dispose' \| 'listener'` 三个阶段的失败；reporter 自身抛错或拒绝时，原失败与 reporter 失败均由所属 Runtime 报告，资源状态不变   |
| `onTerminal`  | `() => void`                                      | 可选     | 无                | 资源到达终态时调用一次                                                                                                                          |

`factory` 既可以是函数 `(context) => T \| Promise<T>`，也可以是 `{ load, runtime?, scheduler?, dispose?, keepAliveMs?, onError?, onTerminal? }` 对象形式（等价于把这些字段和 `options` 合并）。`IStoreResourceLoadContext` 提供 `{ signal, generation, token }`，`signal` 在该次加载被取代/资源关闭时中止。

构造时只读取上述已知字段并形成稳定快照：`load` 与每个已知 accessor 最多读取一次，不枚举或执行未知字段 getter；显式 `options` 的 own-enumerable 字段覆盖 factory 对象上的同名字段。`dispose`、`onError`、`onTerminal` 若存在必须是函数，否则在任何请求或 Resource 状态建立前同步抛出 tagged `INVALID_OPTION`。

自动 `$dispose` 与自定义 disposer 的返回值遵循 lifecycle 的统一接纳语义：disposer getter、then getter 均只读取一次，捕获函数分别以原资源、原 thenable 作为 receiver 调用。getter、调用或异步 rejection 的原始异常通过 `onError(error, 'dispose')` 可达；重复 `forceDispose()` 不会重复清理同一值。

### 8.4 createStoreResourceScope

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
const scope = createStoreResourceScope()
const userResource = scope.resource((ctx) => fetchUser(ctx.signal))
const settingsResource = scope.resource((ctx) => fetchSettings(ctx.signal))

// 组件卸载 / 请求结束
scope.dispose() // 对组内每个资源调用 forceDispose()
```

`scope.resource()` 原样委托 `createStoreResource()` 的已知字段快照与 callback precedence，不会再次 spread/枚举 factory；用户的 effective `onTerminal` 保持不变。Scope 通过 `whenTerminal()` 从私有集合摘除自然终止的资源，不改写公开 disposer。`scope.dispose()` 会强制释放（`forceDispose`）组内所有仍然存在的资源，不等待持有者释放——它假定"整个作用域要关闭了，个别资源的持有者不再重要"。

---

## 9. 状态常量与错误构造工具

除上述创建入口、`$`-API、FieldBuilder 协议之外，包根还导出以下常量与错误构造工具：

```ts doc-test=skip reason="签名摘要，不是可运行模块"
export const StoreFieldMode = { sync: 'sync', async: 'async' } as const
export type IStoreFieldMode = (typeof StoreFieldMode)[keyof typeof StoreFieldMode]
```

- `StoreFieldMode`：`FieldBuilder.mode` 的合法取值（`'sync'` / `'async'`），自定义 Builder 实现时用它标注 `mode` 字段，见 [第 6 节](#6-fieldbuilder自定义字段扩展协议)。

```ts doc-test=skip reason="签名摘要，不是可运行模块"
export const STORE_LIGHT_SOURCE = '@migaia/store-light'

function createStoreLightError(
  code: IStoreLightErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): Error
function createStoreLightRangeError(code: IStoreLightErrorCode, message: string): RangeError
function createStoreLightTypeError(
  code: IStoreLightErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): TypeError
function createStoreLightAggregateError(
  code: IStoreLightErrorCode,
  errors: unknown[],
  message: string
): AggregateError
```

- `STORE_LIGHT_SOURCE`：本包所有错误 `error.source` 的固定值 `'@migaia/store-light'`，用于按来源过滤/断言错误。
- `createStoreLightError(code, message, options?)`：构造一个携带 `(source, code)` 身份（经 `@migaia/utils/error` 的 `attachErrorIdentity`）的普通 `Error`；`options.cause` 可选，设置了才会传给 `Error` 构造器的 `cause`。
- `createStoreLightRangeError(code, message)`：同上，但构造 `RangeError`；无 `cause` 选项。
- `createStoreLightTypeError(code, message, options?)`：同上，但构造 `TypeError`；`options.cause` 可选。
- `createStoreLightAggregateError(code, errors, message)`：构造 `AggregateError(errors, message)` 并打上 `(source, code)` 身份；`errors: unknown[]`（必填）在结果的 `.errors` 上保持可达。

这四个工厂函数是本包内部构造所有错误时使用的同一套工具，导出给需要"以 `@migaia/store-light` 身份抛出自定义诊断错误"的高级集成方（例如自定义 `FieldBuilder` 实现想复用同一套错误身份约定）；日常业务代码通常不需要直接调用它们，直接 `catch` 本包抛出的错误、按 `error.code` 分支即可（见下表）。

---

## 10. 错误信息全表

本包创建的错误使用 `source: '@migaia/store-light'` 与稳定 `code`。Reactive 所有权错误、Resource 请求失败与取消保留其原 owner。FieldBuilder 初始化失败与晚到字段清理失败若已具有完整身份则保留；其余原生可扩展 Error 在原对象上标记 `INITIALIZATION_FAILED` / `FIELD_DISPOSE_FAILED`，保留类型、message 和 stack；不能附加身份的值通过 coded fallback 的 `cause` 保持可达。初始化与 cleanup 同时失败时，能写 cause 的主 Error 仍为原对象，已有 cause 与 cleanup 合并；不能写入时使用 `INIT_AND_CLEANUP_FAILED` AggregateError。

| `StoreLightErrorCode`  | 码值                      | 触发条件 / 处理                                                      |
| ---------------------- | ------------------------- | -------------------------------------------------------------------- |
| `storeDisposed`        | `STORE_DISPOSED`          | Store 终结后继续访问；创建新 Store，不复活旧实例                     |
| `resourceDisposed`     | `RESOURCE_DISPOSED`       | Resource closing/disposed 后读取或保留；停止使用并创建新资源         |
| `captureInvalid`       | `CAPTURE_INVALID`         | capture token 无效或已消费；重新捕获，token 只能提交一次             |
| `unknownVersion`       | `UNKNOWN_VERSION`         | 保留/捕获不可见版本；从当前 snapshot 重新取得版本                    |
| `identityRequired`     | `IDENTITY_REQUIRED`       | 带 dispose 的 factory 返回原始值；返回可追踪身份的对象或函数         |
| `noAsyncInit`          | `NO_ASYNC_INIT`           | 传入未在本包实例登记的对象；同步及异步 Store 均可等待 |
| `storeNotReady`        | `STORE_NOT_READY`         | 异步字段 pending/failed 时访问；先等待 `storeReady()`                |
| `initAndCleanupFailed` | `INIT_AND_CLEANUP_FAILED` | 不能在主错误上附加回滚失败；展开 `cause` / `errors`                   |
| `initializationFailed` | `INITIALIZATION_FAILED` | 未归类的 FieldBuilder 初始化失败；检查原错误及 cause |
| `fieldDisposeFailed` | `FIELD_DISPOSE_FAILED` | 晚到字段清理失败；由所属 Runtime 报告 |
| `syncFieldRequired`    | `SYNC_FIELD_REQUIRED`     | `createStore()` 收到异步 FieldBuilder；改用 `createAsyncStore()`     |
| `actionBatchBoundary`  | `ACTION_BATCH_BOUNDARY`   | 异步 action 首次 await 后继续写的诊断；把后续写显式放入 `$batch()`   |
| `envUnsupported`       | `ENV_UNSUPPORTED`         | 缺少 `WeakRef`/`FinalizationRegistry`；修复部署环境                  |
| `invalidOption`        | `INVALID_OPTION`          | keepAlive、写目标或 hydrate 选项非法；按 message 修正输入            |

| 错误信息                                                                                                                                                                                                                           | 触发条件                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `[store] store is disposed`                                                                                                                                                                                                        | `$dispose()` 后访问用户字段或受守卫方法（`$own` 先检查 disposed）；幂等 `$dispose()`、`$disposed`、`$runtime`、`$async` 仍可使用                                                       |
| `[store] store is ${status}; use createAsyncStore() before accessing async fields`                                                                                                                                                 | 读取尚未就绪（`pending`）或已失败（`failed`）的异步字段                                                                                |
| `[store] createStore() only accepts synchronous fields; "${key}" is a IFieldBuilder. Use createAsyncStore().`                                                                                                                       | `createStore()`（非 `createAsyncStore`）的 shape 里含非 `mode: 'sync'` 的 `FieldBuilder`                                               |
| `[store] field is not settable: ${key}`                                                                                                                                                                                            | `$set()` 传入的 key 不对应任何 signal（computed/wasm/方法字段，或压根不存在的 key）                                                    |
| `[store] unknown hydration field: ${key}`                                                                                                                                                                                          | `$hydrate(partial, { unknown: 'strict' })` 遇到未知 key                                                                                |
| `[store] store has no asynchronous initialization`                                                                                                                                                                                 | 对非 Store 对象（或未经 `createStore`/`createAsyncStore` 创建的对象）调用 `storeReady()`                                               |
| `this node is already owned by another Runtime` / `${what} belongs to a different Runtime than this scope` / `${what} is not a Runtime-owned reactive node` / `${what} belongs to another Runtime`                                         | `$own(resource)` 传入已属于其他 Runtime 的资源，或资源不是本 Runtime 登记的响应式节点（来自 `@migaia/reactive` 的所有权校验）          |
| `[store] resource is disposed`                                                                                                                                                                                                     | 对已 `disposed`/`closing` 的 `StoreResource` 调用 `preload`/`retry`/`retain*`/`captureVersion`/`commitCapture` 等操作                  |
| `[store] unknown resource version`                                                                                                                                                                                                 | `retainVersion(version)`/`captureVersion(id)`/`commitCapture(capture)` 传入的版本号既不是当前版本，也不在 retired/stale/closing 列表里 |
| `[store] resource factory returned a disposed value`                                                                                                                                                                               | `factory` 返回了一个已经被标记为 disposed 的值（复用了已释放的引用）                                                                   |
| `[store] disposable resource values must use reference identity`（`TypeError`）                                                                                                                                                    | 配置了 `dispose` 但 `factory` 产出的是原始类型（非对象/函数），无法用引用去重和追踪生命周期                                            |
| `[store] invalid or consumed resource capture`                                                                                                                                                                                     | `commitCapture()`/`captures.inspect()` 收到的 capture 已提交过、已失效，或不是本资源签发的                                             |
| `[store] keepAliveMs must be a finite non-negative number`（`RangeError`）                                                                                                                                                         | `IStoreResourceOptions.keepAliveMs` 传了负数、`NaN` 或 `Infinity`                                                                       |

---

## 11. 生命周期与释放语义

**Store 构造失败**：`shape` 里任意字段处理阶段抛错（比如某个 `FieldBuilder.create()` 抛错），整个构造过程回滚——原生节点同步分段释放、外部资源由 lifecycle scope 释放，内部的 `signals`/`computeds`/`wasmFields`/`fieldSources` 全部清空，原始错误继续向外抛出（清理阶段自身失败时，会尽量把清理错误挂到原错误的 `cause` 上，不会替换原始错误）。

**异步字段初始化失败**：`readyList` 中任一 Promise reject，Store 立即被标记为 `disposed = true`，中止其余在途初始化（`initAbort.abort()`），并回收已经创建的资源；这个转变发生在 `ready` Promise 的 reject 路径里，因此哪怕调用方没有 `await storeReady()`，Store 内部状态也已经正确收敛，不会有"部分字段可用"的僵尸状态。

**`$dispose()` 时机**：字段读写方法在闭包里直接引用底层节点（`node.value`），不经过任何"Store 对象本身"的代理层；因此 `$dispose()` 唯一要做的事就是把 `disposed` 标志位翻转、释放原生节点段与已有 scope、清空内部 Map。所有已经拿到 Store 引用的调用方，后续用户字段读写与受守卫方法调用会看到 `[store] store is disposed`。

**`StoreResource` 的持有者概念**：一份值被判定为"没有持有者"（可以被回收）需要同时满足：没有 `retainResource()`/`retainVersion()` 产生的活跃 lease，也没有任何未提交的 capture。直接 `captureVersion()` 不设 4 秒过期；只有 pending generation 成功后转换的 provisional capture 才有 4000ms 放弃窗口。`keepAliveMs` 超时只在"当前没有任何持有者"时才开始计算，一旦有新的持有者出现，倒计时会被取消。

---

## 12. 贴近生产的组合示例

一个"用户设置面板"场景：本地可写字段用严格 action 守卫，远端用户资料用 `StoreResource` 异步加载，并在组件卸载时统一释放。

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
import { createStore } from '@migaia/store-light'
import { createMutationPolicy } from '@migaia/store-middleware'
import { createStoreResourceScope } from '@migaia/store-light'

const mutationPolicy = createMutationPolicy('actions-only')

const settingsStore = createStore(
  {
    theme: 'light' as 'light' | 'dark',
    fontSize: 14,
    get isDark() {
      return this.theme === 'dark'
    },
    setTheme(theme: 'light' | 'dark') {
      this.theme = theme
    }
  },
  { debugName: 'settings', mutationPolicy }
)

const scope = createStoreResourceScope()
const profileResource = scope.resource(
  async ({ signal }) => {
    const res = await fetch('/api/profile', { signal })
    if (!res.ok) throw new Error(`profile fetch failed: ${res.status}`)
    return res.json() as Promise<{ name: string }>
  },
  {
    keepAliveMs: 30_000,
    onError: (error, phase) => console.error(`[profile] ${phase} failed`, error)
  }
)

// 类 React 组件渲染路径：
// const profile = profileResource.read(); // loading 时 throw Promise，交给 Suspense 边界

// 组件卸载 / 页面销毁时统一收尾：
function teardown() {
  scope.dispose() // 强制释放 profileResource
  settingsStore.$dispose()
}
```

---

## 13. 常见问题排查

**Q：我在 getter 里写 `this.x = 1` 报错了。**
Computed 只有 getter、没有 setter，属性描述符层面就不可写；ESM 严格模式下赋值给这样的属性会抛 `TypeError`。派生值只能通过它依赖的 signal 字段间接改变。

**Q：`store.field = x` 没报错，但我明明传了 `mutationPolicy`。**
检查是不是走了 `$batch`/`$set`/`$hydrate` 或方法（Action）内部——这几条路径会先 `runInAction()` 再执行，动作深度 > 0 时 `assertMutationAllowed` 自然放行。只有"在这些路径之外直接赋值"才会被拦截。

**Q：`createStore()` 报 "only accepts synchronous fields"，但我看代码是同步的。**
检查 `FieldBuilder.mode` 是否显式为 `'sync'`；异步字段使用 `'async'` 并交给 `createAsyncStore()`。无 mode 的历史形式已移除。

**Q：`StoreResource.read()` 一直抛同一个 Promise，界面卡在 loading。**
确认调用方确实在 Suspense 边界内 `await`/处理了这个抛出的 Promise；`read()` 抛 Promise 是设计如此（React Suspense 协议），不是错误——真正的问题通常是外层没有 `<Suspense>` 或没有等待 Promise settle 就再次同步渲染。

**Q：`retry()` 之后旧值突然消失了。**
`retry()` 只保证"重新加载完成前，旧值继续可读"；如果旧值没有任何 `retainVersion` 锁定，加载成功后旧值会按正常的 retire/回收流程被清理（触发 `dispose` 配置或值自身的 `$dispose`）。需要强制保留某个版本用 `retainVersion(version)`。

**Q：`$plain()`/`$hydrate()` 和 `$snapshot()` 有什么区别，该用哪个？**
`$snapshot()` 拿"当前展示状态"（含 computed/wasm 字段），要求 Store 已就绪；`$plain()`/`$hydrate()` 只处理可持久化的标量 signal 字段，且不要求 Store 已就绪——持久化/hydration 场景应该用后者，展示/调试场景用前者。

## 构建、测试与排查

仓库根目录：`pnpm --filter @migaia/store-light fmt` → `lint` → `typecheck` → `typecheck:test` → `test` → `build`。浏览器集成路径另跑 `typecheck:e2e` 与 `test:e2e`。

单独导入 Store light 不创建默认 Runtime。第一次未显式传入 `options.runtime` 的 store 创建才取得 reactive 的共享默认实例；显式 runtime 的构造路径直接使用给定 owner。该实例与随后导入 reactive root 的 `defaultRuntime` 保持同一 identity。

Action 在同步写入回调之外保留方法原本的返回值或 Promise。只有第一个 `await` 之前的写入属于同一个批次；`await` 之后的写入要用 `$batch()` 合并。写入守卫的回调保持同步。开启 `warnAsyncActions` 后，Action 第一次返回 thenable 时会经 Store 的 Runtime 报告 `ACTION_BATCH_BOUNDARY`。

StoreResource 用创建时捕获的 Runtime 做空闲清理和诊断，用准入的 scheduler 计算缓存有效期和 4000ms 的临时 capture 窗口。`keepAliveMs: 0` 仍然同步回收。没有 `onError` 时，原始失败转交给 Runtime；用户的上报函数自己抛错或拒绝时，原失败和上报失败都以原对象送到 Runtime。不会退回到宿主的 console 或全局 reportError。

### 迁移说明：请求统一交给 Resource

StoreLight 现在只适配一个 `@migaia/resource` 实例。它保留实际值的身份、渲染 capture、资源与版本租约以及值的释放，删除了自己重复的请求/数据控制器和请求协调器。`StoreResourceDataKind` 及其类型已删除；需要原生 Resource 状态时用 `ResourceStatus` / `ResourceFetchStatus`。`StoreResourceKind` 仍是门面内部的词汇；`readSnapshot()` 仍返回 `value`/`version`/`token`，没有公开的 kind 属性。

加载中的重复读取抛出的是同一个 Promise，它以原始值完成。`retry()` 或强制取消会让被取代的 Promise 立即以原生 `AbortError` 失败，`source` 为 `@migaia/resource`，`code` 为 `REQUEST_ABORTED`；以前，忽略中止信号的加载函数会让这个 Promise 一直挂起，直到它自己完成。手动驱动重试时要处理旧 Promise 的拒绝。迟到的返回值只释放一次。刷新失败时恢复旧数据；旧版本的租约会把它的释放推迟到租约释放之后。等待时钟结算的已加载值仍归资源所有，结算失败时也会被释放。临时 capture 的定时器准入失败时，已建立的部分 capture 和定时器会被释放，并作为释放过程的附带问题上报；已经加载成功的值仍可读，并会通知订阅者。不引入任何异步上下文机制。

### 迁移说明：公开 API 收敛

根入口不再导出 `StoreResourceKind` 和 `IStoreResourceKind`；所有权词汇留在内部，公开的资源只暴露快照和完成方法。`ILegacyFieldBuilder` 已删除，改用 `mode: 'async'` 的 `IAsyncFieldBuilder`。`IFieldBuilder` 仍是显式 sync/async Builder 的联合类型，store-wasm 的再导出也一样。`resource.retain()` 改为 `retainResource()`，`resource.retain(version)` 改为 `retainVersion(version)`。没有保留兼容别名。外部使用情况未知，应作为破坏性 API 变更发布。
