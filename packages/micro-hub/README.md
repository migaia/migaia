# `@migaia/micro-hub`

[English](./README.en.md)

微前端（Module Federation remote 与 Web Components）之间的通信与共享存储。整个页面只有一个 hub：主应用创建它，主应用和每个子应用用同样的 `connect(name)` 拿到同形状的句柄，再通过**契约**读写状态、收发事件、发起请求。

## 为什么用它

社区方案大多只解决一个切面：qiankun 的 `initGlobalState` 是一个整体对象，任何变化都回调所有应用；事件总线没有当前值，晚到的订阅方直接丢事件；Module Federation 共享 zustand / redux 时，任何应用都能改任何状态。micro-hub 把这几件事放进一个模型：

- **每份状态有 owner。** 一个契约同一时刻只有一个 owner；只有 owner 和契约里列出的 `writers` 能写，其它应用只能读。出了问题能定位是谁改的。
- **契约带类型和版本。** 两个独立部署的应用对同一契约的主版本不一致时，`use()` 直接报 `CONTRACT_VERSION_MISMATCH`，不会静默错乱。
- **卸载即干净。** `disconnect()` 一次性释放这个应用登记的所有订阅、handler 和所有权，重挂载不会出现重复回调或幽灵回调。
- **按需通知。** 每个字段、每个实体 id、每个 `select()` 结果都是独立的订阅点；一次命令里的多个写入只通知一次。
- **命令同步提交。** command 是同步纯函数，不会出现跨 `await` 的丢失更新。
- **同 realm 零拷贝。** 不序列化、不 postMessage；提交的值顶层冻结，防止别的应用就地修改。
- **插件化。** 只要通信就装 `events()`，只要状态就装 `state()`，需要持久化再加 `persist()`。
- **与框架无关。** 对外只有 `get()` + `subscribe()`，React、Vue、Svelte、Solid、Angular、原生 Web Components 都能几行接入。

## 适用与不适用

**适用**：同一个页面（同一个 JS realm）里的多个应用——Module Federation 加载的 remote、以 Web Component 形式挂载的子应用、主应用本身。

**不适用**：

- iframe、Worker、跨标签页：这些是不同的 realm，用 [`@migaia/rpc-plugin-browser`](../rpc-plugin-browser/README.md)。
- 页面内单个应用自己的状态：直接用 [`@migaia/store-keyed`](../store-keyed/README.md) 或 [`@migaia/store-light`](../store-light/README.md)。

## 安装

```bash
pnpm add @migaia/micro-hub
```

需要共享异步值时再装可选 peer `@migaia/resource`；持久化需要一个存储后端，例如 `@migaia/storage-plugin-browser`。

### Module Federation 配置

hub 必须是整页唯一的一份。主应用和每个 remote 都把它声明为 singleton：

```ts
shared: {
  '@migaia/micro-hub': { singleton: true, requiredVersion: '^0.0.1' }
}
```

如果某个 remote 的 `requiredVersion` 超出主应用提供的版本范围，Module Federation 会退回到这个 remote 自带的副本，两边的事件和状态就会静默分裂。上线前确认所有应用的版本范围一致。入口使用异步边界（`import('./bootstrap')`），避免 "Shared module is not available for eager consumption"。

## 快速开始

### 1. 定义契约（由 owner 团队维护，通过 MF expose 共享）

```ts
import { defineContract, event, keyed, request } from '@migaia/micro-hub'

type ICartItem = { id: string; price: number }

export const cart = defineContract('cart', {
  version: 1,
  state: { items: [] as readonly ICartItem[], byId: keyed<ICartItem>() },
  computed: { total: (s) => s.items.reduce((sum, item) => sum + item.price, 0) },
  commands: {
    add: (s, item: ICartItem) => ({ items: [...s.items, item], byId: { [item.id]: item } })
  },
  writers: ['product'],
  events: { checkedOut: event<{ orderId: string }>() },
  requests: { checkout: request<{ coupon?: string }, { orderId: string }>() }
})
```

### 2. 主应用创建 hub

```ts
import { createMicroHub } from '@migaia/micro-hub'
import { events } from '@migaia/micro-hub/events'
import { state } from '@migaia/micro-hub/state'
import { persist } from '@migaia/micro-hub/persist'
import { localStorageHost } from '@migaia/storage-plugin-browser/local-storage'

createMicroHub({
  plugins: [events(), state(), persist({ store: localStorageHost({ namespace: 'shop' }) })]
})
```

### 3. 每个应用连接（主应用与子应用写法相同）

```ts
import { getMicroHub } from '@migaia/micro-hub'
import { cart } from 'cart/contract'

// owner：购物车应用
const app = getMicroHub().connect('cart')
const owned = app.own(cart, { persist: ['items'] })
owned.handle('checkout', async ({ coupon }) => {
  const orderId = await submitOrder(owned.state.items.get(), coupon)
  owned.events.checkedOut.emit({ orderId })
  return { orderId }
})

// 使用方：商品应用
const product = getMicroHub().connect('product')
const view = product.use(cart)
view.commands.add({ id: 'sku-1', price: 42 })          // product 在 writers 里，可以写
view.computed.total.subscribe(() => render(view.computed.total.get()))
view.events.checkedOut.on(({ orderId }) => toast(orderId))
const { orderId } = await view.requests.checkout({}, { waitForOwner: 3000 })

// 卸载时
await product.disconnect()
```

## 接入框架

`IReadable` 只有 `get()` 和 `subscribe()`：`get()` 在下一次提交前返回同一个引用；通知不带值，回调里调用 `get()` 拿到的已经是新值。

```ts
// React
const total = useSyncExternalStore(view.computed.total.subscribe, view.computed.total.get)

// Vue
const total = shallowRef(view.computed.total.get())
onScopeDispose(view.computed.total.subscribe(() => (total.value = view.computed.total.get())))

// Svelte
const total = readable(view.computed.total.get(), (set) =>
  view.computed.total.subscribe(() => set(view.computed.total.get()))
)
```

## Web Components

子应用以自定义元素挂载时，可以不经全局变量拿到 app 句柄。`@migaia/micro-hub/web-component` 实现了社区 Context Protocol 的 `context-request` 事件，Lit 的 `@consume({ context: MICRO_APP_CONTEXT })` 也能直接用：

```ts
import { consumeMicroApp, provideMicroApp } from '@migaia/micro-hub/web-component'

provideMicroApp(document.querySelector('#checkout-slot')!, app)   // 主应用

class CheckoutElement extends HTMLElement {
  connectedCallback() {
    consumeMicroApp(this, (app) => this.render(app.use(cart)))   // 子应用
  }
}
```

`consumeMicroApp` 比 provider 先挂载时，请求会等待，provider 出现后补发应答。外部 Lit consumer 若可能先挂载，应在共同祖先连接 `ContextRoot` 并使用 `@consume({ context: MICRO_APP_CONTEXT, subscribe: true })`；`provideMicroApp` 发出可跨 shadow DOM 的 `context-provider` 事件，触发 ContextRoot 重放早到请求。

## 插件

| 插件 | 子入口 | 依赖 | 提供 |
| --- | --- | --- | --- |
| `events(options?)` | `@migaia/micro-hub/events` | — | 契约的 `events`、`requests` |
| `state()` | `@migaia/micro-hub/state` | — | `state`、`computed`、`commands`、`select`、`keyed()` |
| `persist({ store })` | `@migaia/micro-hub/persist` | `state` | `own(contract, { persist })` |
| `resources()` | `@migaia/micro-hub/resource` | 可选 peer `@migaia/resource` | 契约的 `resources` |

契约用到了没装的插件时，`use()` / `own()` 报 `PLUGIN_MISSING`；插件依赖没装时，`createMicroHub()` 报 `PLUGIN_MISSING`，hub 不会被创建。

## 错误

所有错误带 `source: '@migaia/micro-hub'` 和 `code`（`MicroHubErrorCode`）：`HUB_ALREADY_CREATED`、`HUB_NOT_CREATED`、`APP_ALREADY_CONNECTED`、`APP_DISCONNECTED`、`PLUGIN_MISSING`、`CONTRACT_VERSION_MISMATCH`、`CONTRACT_OWNED`、`WRITE_DENIED`、`EMIT_DENIED`、`COMMAND_ASYNC`、`HANDLER_DUPLICATED`、`OWNER_ABSENT`、`OWNER_TIMEOUT`、`OWNER_GONE`、`INVALID_OPTION`。每个码的触发条件与处理方式见 [USEGUIDE](./USEGUIDE.md#错误码)。

需要按错误分支时，比较 `error.source === MICRO_HUB_SOURCE` 和 `error.code`，不要匹配消息文字。`MicroHubErrorText` 导出全部消息文字，测试或日志需要核对原文时引用它。

listener 和订阅回调抛出的错误不会打断其它 listener，也不会抛给 emit 方，而是交给 `createMicroHub({ report })`（默认 `globalThis.reportError`）。

## 相关包

| 包 | 关系 |
| --- | --- |
| [`@migaia/store-keyed`](../store-keyed/README.md) | 每个字段和实体 id 的 atom |
| [`@migaia/event-subscriber`](../event-subscriber/README.md) | 事件通道与请求 handler 选择 |
| [`@migaia/plugin-host`](../plugin-host/README.md) | 能力插件与每个应用的安装、卸载 |
| [`@migaia/store-persist`](../store-persist/README.md) | 持久化防抖、版本与 hydrate 竞态 |
| [`@migaia/rpc-plugin-browser`](../rpc-plugin-browser/README.md) | iframe / Worker 等跨 realm 通信 |
