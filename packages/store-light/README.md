# @migaia/store-light

**普通对象状态的响应式门面**——给它一个对象字面量，普通字段自动变 `Signal`，`get` 访问器自动变惰性缓存的 `Computed`，方法自动变自动 batch 的 `Action`。你只写"对象 / getter / 方法"，看不到 signal/computed/batch 这些底层概念。

## 1. 这是什么

如果说 `@migaia/reactive` 是响应式内核（Signal/Computed/Effect/Runtime），`store-light` 就是把这套内核包装成"像写一个普通对象/class 实例一样写业务状态"的门面——类似 MobX 的 `makeAutoObservable`，但直接建在本仓库自己的响应式运行时之上，不引入额外的响应式实现，也不和任何 UI 框架耦合。

除了对象状态本身，它还内置一个独立能力：`StoreResource`——一个 Suspense 安全的异步值容器，处理"加载中/就绪/失败/正在关闭/已释放"这一整套状态机，供 React 等消费方安全地渲染异步数据而不必自己管理竞态和过期值的释放时机。

## 2. 适合什么场景

| 场景 | 说明 |
| --- | --- |
| 表单、设置、会话信息等中小型对象状态 | 字段不多、结构相对固定，不需要按 key 做增删的集合语义 |
| 需要"字段自动响应式"而不想手写 Signal | 普通值/getter/方法写完就是完整的响应式对象，读写自动追踪依赖 |
| 需要异步派生数据的 Suspense 安全渲染 | `createStoreResource`/`createStoreResourceScope` 处理加载态、竞态取消、缓存过期 |
| 需要跨 Runtime 隔离（SSR 每请求、单测、多 root） | `options.runtime` 显式指定 Runtime，互不串状态 |
| 需要接入自定义字段类型（如 WASM 支撑的字段） | `FieldBuilder` 协议是公开的扩展点，`@migaia/store-wasm` 就是基于它实现的 |

**不适合**：列表/高频增删的集合状态用 `@migaia/store-indexed`；需要稳定业务 key 寻址用 `@migaia/store-keyed`；需要持久化用 `@migaia/store-persist`；需要 React hooks 用 `@migaia/store-react`。store-light 本身只提供"对象 facade + 异步资源"这两样东西，其余能力都是独立包按需组合。

## 3. 用了之后能得到什么

- **零样板的响应式对象**：`{ count: 0 }` 直接变成可读写、可订阅的状态；无需手写 `new Signal(0)`。
- **getter 自动惰性缓存**：`get double() { return this.count * 2 }` 是真正的 `Computed`，只在依赖变化时重新求值。
- **方法自动是 Action**：方法体自动 batch + untracked 执行，一次方法调用里改多个字段只触发一次通知。
- **释放语义统一**：`$dispose()` 之后所有字段读写、方法调用统一抛错，不留"部分字段还能用"的半死状态。
- **可插拔的写入守卫**：接入 `IMutationPolicy`（如 `@migaia/store-middleware` 的 `createMutationPolicy('actions-only')`）可以强制"只能在 action 里改状态"。
- **持久化友好**：`$plain()`/`$hydrate()` 只处理可持久化的标量 signal 字段，天然排除 computed/wasm/方法，`@migaia/store-persist` 直接基于它们实现快照持久化。
- **Suspense 安全的异步资源**：`StoreResource` 自己处理竞态取消、缓存 TTL、渲染期/提交期两阶段租约，组件不需要手写 `useEffect` 竞态保护。

## 4. 五分钟上手

```bash
pnpm add @migaia/store-light
```

```ts
import { createStore } from '@migaia/store-light';

const store = createStore({
  count: 0,
  get doubled() {
    return this.count * 2; // 依赖 count 的 Computed
  },
  increment() {
    this.count += 1; // Action：方法内的写入自动 batch
  }
});

console.log(store.count, store.doubled); // 0 0
store.increment();
console.log(store.count, store.doubled); // 1 2

const unsubscribe = store.$subscribe(() => {
  console.log('store changed');
});

store.$dispose(); // 释放全部内部节点；之后任何读写都会抛错
unsubscribe();
```

## 5. 核心概念一览

| 概念 | 是什么 |
| --- | --- |
| **Signal（信号字段）** | 普通值字段，读时自动订阅、写时触发通知 |
| **Computed（派生字段）** | `get` 访问器，惰性缓存，依赖变化才重新求值，只读 |
| **Action（动作方法）** | 普通方法简写，自动 batch + untracked 执行，统一收尾通知 |
| **Raw（原样值字段）** | `raw(fn)` 包裹的函数值字段——不当 Action，可读可写可整体替换（如存 `onSubmit` 回调） |
| **FieldBuilder（字段构造协议）** | 自定义字段类型的扩展点（如 WASM 字段），Store 负责其所有权登记与释放 |
| **`$`-API** | `$snapshot`/`$subscribe`/`$batch`/`$set`/`$plain`/`$hydrate`/`$own`/`$dispose` 等不可枚举的运行时方法 |
| **StoreResource** | 独立于对象 facade 的 Suspense 安全异步值容器 |

## 6. 模块/能力一览

| 导出 | 作用 |
| --- | --- |
| `createStore` / `createStoreSync` | 同步创建 Store；含异步 `FieldBuilder` 会直接抛错，提示改用 `createAsyncStore` |
| `createAsyncStore` | 支持异步字段（如 WASM）的创建入口，返回 Promise，resolve 时字段已全部就绪 |
| `createLegacyStore` / `storeReady` | 历史兼容 API：不做同步字段限制，需要调用方自行用 `storeReady()` 等待就绪 |
| `raw` / `isRaw` | 标记"函数值当普通字段存"而不是当 Action |
| `FieldBuilder` 协议（`FIELD_BUILDER`、`isFieldBuilder`、`FieldContext`、`IFieldSource` 等类型） | 自定义字段类型扩展点，`@migaia/store-wasm` 基于它实现 |
| `IMutationGuard` / `IMutationPolicy` 类型 | 写入守卫协议；具体实现见 `@migaia/store-middleware` |
| `createStoreResource` / `createStoreResourceScope` | Suspense 安全的异步值容器，独立于对象 facade 使用 |

## 7. 生命周期、错误与边界

1. **`createStore()` 拒绝异步字段**。定义里含 `mode !== 'sync'` 的 `FieldBuilder` 会直接抛错，必须改用 `createAsyncStore()`。
2. **`$batch` 不是事务**。recipe 中途抛错不会回滚已经写入的字段，改名自 `$patch` 就是为了避免被误解成 Immer draft 那种"要么全成要么全不成"的语义。
3. **`$subscribe` 是粗粒度订阅**。它只追踪源字段（signal/wasm 字段），不主动读取每个 computed；想知道具体哪个字段变了，需要在回调里自己读快照比较。
4. **`mutationPolicy` 默认关闭**。不传这个 options 时，`store.field = x` 在任何地方都允许；要强制"只能在 action 里改状态"需要显式接入 `IMutationPolicy` 实现（如 `@migaia/store-middleware` 的 `createMutationPolicy('actions-only')`）。
5. **`$dispose()` 之后所有字段读写统一抛 `[store] store is disposed`**，不存在"只有部分字段失效"的中间状态。
6. **异步 action 只在首个 `await` 之前自动 batch**。续体里的写入需要调用方自己包一层 `$batch()` 才会合并通知。
7. **`StoreResource` 的 `dispose()` 和 `forceDispose()` 不等价**：前者会等所有持有者释放后才真正清理，后者立即强制清理，不管是否还有人在用。

Store 与 resource 的边界错误保留原生类型，并携带
`source: '@migaia/store-light'` 和稳定 `code`；例如已释放 Store 是 `STORE_DISPOSED`，
未就绪异步字段是 `STORE_NOT_READY`。`$dispose()` 返回同一清理 Promise，不能用来复活实例。

## 8. 深入参考

完整的 `createStore`/`createAsyncStore` 行为差异、`$`-API 精确签名与副作用、`FieldBuilder` 协议怎么实现自定义字段、`StoreResource` 的完整状态机与生命周期方法、全部错误信息、以及贴近生产的组合示例，见 **[USEGUIDE.md](./USEGUIDE.md)**。
