# @migaia/store-light

[English](./README.en.md)

表单、设置、会话这类对象状态，手写时要在每个修改点记得重算派生值、通知界面，退出时还要记得清理。`@migaia/store-light` 直接接收你平时写的对象：普通字段变成响应式值，getter 变成自动更新的派生值，方法变成一次发布的 Action，并提供订阅、持久化和释放。它还带一个异步值容器 `createStoreResource`，负责在没人使用时释放加载到的连接、解码器这类对象。它建立在 `@migaia/reactive` 之上，不依赖任何 UI 框架。

## 你可能遇到过

- **派生值漏更新**：改了商品列表，忘了同时更新合计和摘要。根因是派生值靠人在每个修改点手动重算。
- **监听者看到写了一半的状态**：一个方法先改列表再改合计，监听者在两次写入之间运行，看到新列表配旧合计。根因是每次写入都单独通知。
- **恢复设置时数据悄悄丢失**：升级后恢复本地保存的设置，旧字段写进了状态，或者新版本没有的字段被丢掉也没人发现。根因是持久化用 `Object.assign` 之类的方法，给什么就拷什么。
- **退出后还显示上一个用户的数据**：会话状态已经不用了，某个没清理的回调还在读它。根因是普通对象不知道自己已经被释放。
- **异步加载的对象没有关**：组件卸载后连接、解码器还开着；重新加载后旧的那个一直留在内存里。根因是没人负责记录谁还在用它、何时该关。

## 为什么选它

- **写普通对象就行。** 常见的响应式写法要把每个字段包成 signal、每个派生值包成 computed；这里字段、getter、方法自动变成响应式值、派生值和 Action，状态仍然长得像它描述的对象。[示例](./USEGUIDE.md#写普通对象就得到响应式状态)
- **Action 在返回时一次发布。** 一个方法里的多次写入在方法返回时一起通知，监听者看不到写了一半的状态。[示例](./USEGUIDE.md#写普通对象就得到响应式状态)
- **持久化只取能恢复的字段。** `$plain()` 只返回可写字段；`$hydrate()` 只写回已有字段，并可以报告或拒绝未知字段。[示例](./USEGUIDE.md#只保存能恢复的字段)
- **释放后的访问立即报错。** `$dispose()` 之后读写字段、调用方法都抛 `STORE_DISPOSED`，过期的读取方会在读取处报错，而不是显示旧数据。[示例](./USEGUIDE.md#读取已释放的-store-会明确报错)
- **异步值有明确的主人。** `createStoreResource` 记录持有者，最后一个持有者离开 `keepAliveMs` 后释放值；重新加载时等新值发布后才释放旧值，每个值只释放一次。[示例](./USEGUIDE.md#重新加载时旧值只释放一次)

## 从这里开始

下面用购物车演示：列表、合计和摘要放在一个普通对象里，`add` 同时改两个字段。用 Node 24 直接运行。

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

`summary` 是普通 getter，读到的 `items` 和 `total` 变了它就重算。每次调用 `add` 只收到一次通知，通知时两个字段都已更新。

下一步：更多用法看 [USEGUIDE 的“按场景查找”](./USEGUIDE.md#按场景查找)；要加载之后需要释放的异步值，看 [没人使用之后自动释放异步值](./USEGUIDE.md#没人使用之后自动释放异步值)。

## 手写时的隐患

下面是常见的手写状态对象。它能跑，但有三个隐患（只用于说明，不必运行）：

```ts doc-test=check
const listeners = new Set<() => void>()
const cart = {
  items: [] as string[],
  total: 0,
  summary: '',
  add(name: string, price: number) {
    this.items = [...this.items, name]
    // 隐患 1：每次写入都单独通知，监听者在这里看到的是新列表配旧合计
    listeners.forEach((listener) => listener())
    this.total += price
    // 隐患 2：派生值要手动重算；另一个修改列表的方法漏写这一行，摘要就是旧的
    this.summary = `${this.items.length} 件，共 ${this.total} 元`
    listeners.forEach((listener) => listener())
  }
}

// 隐患 3：没有释放的概念；退出登录后，忘了取消的监听者还能读到上一个用户的数据
listeners.add(() => console.log(cart.summary))
cart.add('键盘', 300)
```

用 `createStore` 时，摘要写成 getter，读到的字段变了就自动重算；方法里的写入在方法返回时一起发布；`$dispose()` 之后任何访问都会报错。

## 三分钟心智模型

`createStore` 把对象的每个属性按写法归类：

| 你写的 | 变成 | 一句话 |
| --- | --- | --- |
| 普通值 `count: 0` | 响应式值 | 读取时登记依赖，写入时通知 |
| getter `get doubled()` | 派生值 | 只在被读取时计算，读到的字段变了才重算；只读 |
| 方法 `increment()` | Action | 一次调用里的写入在返回时一起发布；方法里读字段不会让调用方订阅它们 |
| `raw(value)` | 原样字段 | 函数也当作数据保存，可读可写 |
| 自定义字段（FieldBuilder） | 扩展字段 | 交给扩展创建，例如 WASM 支撑的字段 |

几个说法：

- **`$` API**：`$subscribe`、`$batch`、`$set`、`$plain`、`$hydrate`、`$own`、`$dispose` 等方法挂在 store 上，不可枚举，不会和你的字段混在一起；定义里不能用这些名字。
- **Runtime**：所有节点属于同一个 `@migaia/reactive` Runtime。默认用共享的那个；服务端渲染、测试需要隔离时传 `options.runtime`。
- **StoreResource**：独立于对象 store 的异步值容器。值由它持有，持有者（`retainResource()`、渲染中锁定的版本）都离开后才释放。

## 典型场景

| 场景 | 怎么组合 | 详细说明 |
| --- | --- | --- |
| 表单、购物车、设置面板 | `createStore` + getter + 方法 | [USEGUIDE](./USEGUIDE.md#写普通对象就得到响应式状态) |
| 保存到本地存储、升级后恢复 | `$plain()` + `$hydrate(partial, { unknown })` | [USEGUIDE](./USEGUIDE.md#只保存能恢复的字段) |
| 退出登录、页面销毁 | `$dispose()`，外部资源用 `$own()` 一起释放 | [USEGUIDE](./USEGUIDE.md#读取已释放的-store-会明确报错) |
| 存回调、外部实例 | `raw()` | [USEGUIDE](./USEGUIDE.md#把回调保存成可替换的字段) |
| 连接、解码器等加载后要释放的值 | `createStoreResource` + `retainResource()` | [USEGUIDE](./USEGUIDE.md#没人使用之后自动释放异步值) |
| 只允许在方法里改字段 | `mutationPolicy` | [USEGUIDE](./USEGUIDE.md#7-写入守卫imutationguard--imutationpolicy) |

## 安装

```bash
pnpm add @migaia/store-light
```

包只有根入口 `@migaia/store-light`。列表或频繁增删的集合用 `@migaia/store-indexed`，按稳定业务 key 寻址用 `@migaia/store-keyed`；持久化和 React 绑定分别由 `@migaia/store-persist` 和 `@migaia/store-react` 提供。

## 常用 API

| API | 做什么 |
| --- | --- |
| `createStore(shape, options?)` | 用普通对象创建 store；定义里不能有异步字段 |
| `createAsyncStore(shape, options?)` | 定义里有异步初始化的字段时使用，返回的 Promise 完成时字段都已就绪 |
| `store.$subscribe(fn)` / `store.$batch(recipe)` | 订阅任意字段变化 / 把多次写入合并成一次通知 |
| `store.$plain()` / `store.$hydrate(partial, options?)` | 取可持久化的字段 / 写回保存的字段 |
| `store.$dispose()` | 释放 store；之后的访问抛 `STORE_DISPOSED` |
| `createStoreResource(factory, options?)` | 创建按持有者释放的异步值 |

## 契约细节

全部签名、边界行为与错误信息见 [USEGUIDE.md](./USEGUIDE.md)。下面是使用时最需要记住的约束。

1. **getter 只读。** 派生值没有 setter，给它赋值会抛 `TypeError`；只能通过它读取的字段间接改变。
2. **异步方法只有第一个 `await` 之前的写入在同一个批次里。** `await` 之后的写入要放进 `$batch()`。开启 `warnAsyncActions` 后，Action 第一次返回 thenable 时会经 Runtime 报告 `ACTION_BATCH_BOUNDARY`。Action 保留方法原本的返回值或 Promise。
3. **`$batch()` 不是事务。** recipe 中途抛错不会回滚已经完成的写入；`$hydrate()` 也一样。
4. **`$dispose()` 先切换状态再释放。** `$disposed` 在释放任何资源之前就变成 `true`；之后读写字段、调用方法抛 `STORE_DISPOSED`，`$disposed`、`$runtime`、`$async` 和再次 `$dispose()` 仍可用。所有调用返回同一个 Promise，它在所有内部节点和 `$own()` 登记的资源释放完成后才完成。
5. **构造失败会回滚。** 构造过程中任一步出错，已经创建的节点按注册的逆序释放，原始错误继续向外抛；清理本身失败时附加到原错误上，不会替换它。
6. **导入时不创建默认 Runtime。** 第一次不传 `options.runtime` 创建 store 时才取得 reactive 的共享默认 Runtime，它和 `@migaia/reactive` 根入口导出的 `defaultRuntime` 是同一个对象。
7. **StoreResource 的值由它持有。** 配了 `dispose` 时值必须是对象或函数；没配而值自带 `$dispose` 时会调用它。没有持有者之后的回收倒计时是 `keepAliveMs`（默认 1000，`0` 表示同步回收）；React 渲染期间由 capture/commit 租约保护正在显示的版本。
8. **错误身份。** 本包产生的错误带 `source === STORE_LIGHT_SOURCE`（`@migaia/store-light`）和 `StoreLightErrorCode` 里的 `code`；来自 reactive 的所有权错误、来自 resource 的请求失败和取消保留原来的身份。

请求、数据、取消和共享 Promise 由 `@migaia/resource` 的一个实例负责，StoreResource 只在其上加值的所有权、渲染 capture、版本租约和恰好一次的释放。迁移说明（`StoreResourceDataKind`、`StoreResourceKind`、`retain()` 的移除）见 USEGUIDE 末尾。

**不适合的场景**：列表或频繁增删的集合、需要按 id 寻址的实体、需要索引查询的数据，分别用 store-indexed、store-keyed 等包。
