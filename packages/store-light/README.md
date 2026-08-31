# `@migaia/store-light`

普通对象状态的响应式门面：给它一个对象字面量，普通字段自动变 `Signal`，`get` 访问器自动变惰性缓存的 `Computed`，方法自动变自动 batch 的 `Action`。开发者只写"对象 / getter / 方法"，看不到 signal/computed/batch 这些底层概念。同一个包里还内置一个独立能力——`StoreResource`：Suspense 安全的异步值容器，处理"加载中/就绪/失败/正在关闭/已释放"整套状态机。

## 适用与不适用场景

**适用**：表单/设置/会话信息等中小型对象状态；需要"字段自动响应式"而不想手写 Signal；需要异步派生数据的 Suspense 安全渲染；需要跨 Runtime 隔离（SSR 每请求、单测、多 root 互不串状态）；需要接入自定义字段类型（如 WASM 字段）的扩展点。

**不适用**：

- 列表或高频增删的集合状态使用 `@migaia/store-indexed`。
- 需要按稳定业务 key 寻址时使用 `@migaia/store-keyed`。
- 需要持久化时使用 `@migaia/store-persist`；需要 React hooks 时使用 `@migaia/store-react`。
- `store-light` 只负责对象状态和异步资源。响应式内核、资源释放、内部事件与通用工具分别由 `@migaia/reactive`、`@migaia/lifecycle`、`@migaia/event-subscriber` 与 `@migaia/utils` 提供。

## 安装

```bash
pnpm add @migaia/store-light
```

## 目录

- [Store 创建](#store-创建)
- [`$`-API：读写、订阅、持久化、释放](#api)
- [`raw`：原样值字段](#raw)
- [FieldBuilder：自定义字段扩展协议](#fieldbuilder)
- [StoreResource：Suspense 安全的异步值容器](#storeresource)
- [高阶组合示例](#高阶组合示例)
- [构建门禁](#构建门禁)

完整签名、边界行为与错误码，见 [USEGUIDE.md](./USEGUIDE.md)。

---

<a id="store-创建"></a>

## Store 创建

```ts
import {
  createStore,
  createStoreSync,
  createAsyncStore,
  createLegacyStore,
  storeReady
} from '@migaia/store-light';
```

**`createStore`｜10 秒上手** —— 普通值变 Signal，`get` 变 Computed，方法变 Action：

```ts
const store = createStore({
  count: 0,
  get doubled() {
    return this.count * 2; // Computed，依赖 count
  },
  increment() {
    this.count += 1; // Action：方法体自动 batch + untracked
  }
});

store.count; // 0
store.doubled; // 0
store.increment();
store.count; // 1
```

签名：`(shape: IStoreDefinition<S>, options?: ICreateStoreOptions) => IReactiveStore<S>`。`shape` 中任意字段是非 `mode: 'sync'` 的 `FieldBuilder`（`mode: 'async'` 或历史无 `mode` 的 Builder）会在构造阶段直接抛错，提示改用 `createAsyncStore`。

`options: ICreateStoreOptions` 全部字段：

- `runtime?: IRuntime` —— 默认 `defaultRuntime`；显式隔离运行时（SSR 每请求、单测、多 root 互不串状态）
- `debugName?: string` —— 默认 `'Store'`；仅用作内部节点 `debugName` 前缀，不参与语义
- `warnAsyncActions?: boolean` —— 默认 `false`；开启后若某个 Action 返回 thenable（即 async 方法），首次调用 `console.warn` 提示"只有首个 await 之前的写入被自动 batch"
- `mutationPolicy?: IMutationPolicy` —— 默认无；接入 MobX 风格的严格写入守卫（见 [USEGUIDE §7](./USEGUIDE.md#7-写入守卫imutationguard--imutationpolicy)）

**`createStoreSync`｜3 秒上手** —— `createStore` 的显式命名别名，行为完全一致：

```ts
const store = createStoreSync({ count: 0 });
```

**`createAsyncStore`｜10 秒上手** —— 定义里含异步 `FieldBuilder` 时使用，返回的 Promise resolve 时全部字段已就绪：

```ts
const store = await createAsyncStore({
  count: 0,
  wasmField: someAsyncFieldBuilder() // mode: 'async'
});
```

参数与 `createStore` 相同（`shape`、`options?: ICreateStoreOptions`），区别只在于接受异步 `FieldBuilder` 且返回 `Promise<IReactiveStore<S>>`。

**`createLegacyStore`｜5 秒上手** —— 历史兼容入口：不做同步字段限制，异步字段未就绪时需自行等待：

```ts
const store = createLegacyStore(shapeWithAsyncField);
await storeReady(store); // 或检查 store.$async
```

参数与 `createStore` 相同；新代码优先用 `createStore`/`createAsyncStore`。

**`storeReady`｜3 秒上手** —— 取任意 Store 的就绪 Promise：

```ts
await storeReady(store);
```

单参数 `store: object`（必填），无其他选项；传入非 Store 对象抛 `[store] store has no asynchronous initialization`。

---

<a id="api"></a>

## `$`-API：读写、订阅、持久化、释放

`$`-前缀方法挂载为不可枚举属性，直接在 `createStore` 返回值上调用，无需额外 import。

**`store.$snapshot()`｜3 秒上手** —— 全字段（含 computed/wasm）一次性快照，要求 Store 已就绪：

```ts
store.$snapshot(); // { count: 1, doubled: 2 }
```

无参数、无选项；异步字段未就绪时抛 `[store] store is pending; ...`。

**`store.$subscribe(fn, options?)`｜5 秒上手** —— 粗粒度订阅，只追踪 signal/wasm 字段（不主动读取 computed）：

```ts
const unsubscribe = store.$subscribe(() => console.log('changed'), { fireImmediately: true });
```

第二参数 `ISubscribeOptions` 全部字段：`fireImmediately?: boolean`（默认 `false`，为 `true` 时订阅建立后立即调用一次 `fn`）。返回值 `IDisposer`（调用即退订）。

**`store.$batch(recipe)`｜5 秒上手** —— 一个 batch 里改多个字段，只触发一次通知（不是事务，中途抛错不回滚）：

```ts
store.$batch((draft) => {
  draft.count = 10;
});
```

单参数 `recipe: (draft: IStoreShape<S>) => void`（必填），无其他选项。

**`store.$set(patch)`｜3 秒上手** —— 低层批量赋值，编译期只接受可写 signal 字段：

```ts
store.$set({ count: 5 });
```

单参数 `patch: IWritableStorePatch<S>`（必填）；运行期发现 key 不对应任何 signal 会抛 `[store] field is not settable: ${key}`。

**`store.$plain()`｜3 秒上手** —— 只取可持久化的标量 signal 字段（排除 computed/wasm/方法），不要求 Store 已就绪：

```ts
store.$plain(); // { count: 1 }
```

无参数、无选项。

**`store.$hydrate(partial, options?)`｜5 秒上手** —— 宽松写回 signal 字段（持久化恢复用）：

```ts
store.$hydrate({ count: 42, unknownKey: 'x' });
```

参数：`partial: Record<string, unknown>`（必填）；第二参数 `IHydrateOptions` 全部字段：

- `unknown?: 'ignore' | 'report' | 'strict'` —— 默认 `'ignore'`；`'strict'` 遇到未知 key 抛错；`'report'` 对每个未知 key 调用一次 `onUnknown`
- `onUnknown?: (key: string) => void` —— 配合 `unknown: 'report'` 使用

**`store.$own(resource)`｜5 秒上手** —— 把外部资源纳入本 Store 的所有权作用域，`$dispose()` 时一并释放：

```ts
const owned = store.$own(someDisposableResource);
```

单参数 `resource: T extends IDisposable`（必填），无其他选项；资源必须未归属或已归属本 Runtime，跨 Runtime 直接拒绝。

**`store.$dispose()`｜3 秒上手** —— 释放全部内部节点，之后任何字段读写/方法调用统一抛 `[store] store is disposed`：

```ts
await store.$dispose();
```

无参数；返回 `Promise<void>`，多次调用返回同一个 Promise。`$disposed`（只读 getter）、`$runtime`（只读 `IRuntime`）、`$async`（只读 `boolean`，是否含异步字段）无需调用，直接读属性。

---

<a id="raw"></a>

## `raw`：原样值字段

```ts
import { raw, isRaw } from '@migaia/store-light';
```

**`raw`｜5 秒上手** —— 让一个函数值当普通可读写字段存，而不是被误判为 Action：

```ts
const store = createStore({
  onSubmit: raw((data: FormData) => console.log(data))
});
store.onSubmit = (data) => save(data); // 可读可写可整体替换
```

单参数 `value: T`（必填），无其他选项；返回 `IRaw<T>`。

**`isRaw`｜3 秒上手** —— 类型守卫，单参数 `value: unknown`，无其他选项：

```ts
isRaw(raw(() => {})); // true
```

---

<a id="fieldbuilder"></a>

## FieldBuilder：自定义字段扩展协议

```ts
import { FIELD_BUILDER, isFieldBuilder } from '@migaia/store-light';
import type {
  IFieldBuilder,
  IFieldContext,
  IFieldSource,
  IMutationGuard,
  IMutationPolicy
} from '@migaia/store-light';
```

Store 定义协议，扩展去实现——`store-light` 不知道任何具体字段类型，`@migaia/store-wasm` 等包基于此协议接入自定义字段（如 WASM 支撑的字段）。

**`isFieldBuilder`｜3 秒上手**（单参数 `value: unknown`，无选项）：

```ts
isFieldBuilder(someValue); // 是否为 IFieldBuilder（sync/async/legacy 任一形态）
```

**`FIELD_BUILDER`｜3 秒上手** —— 品牌 symbol，供自定义 Builder 实现打标，不单独调用：

```ts
const myBuilder: IFieldBuilder<MyField> = {
  [FIELD_BUILDER]: true,
  mode: 'sync',
  create(context: IFieldContext) {
    /* ... */
  }
};
```

完整的 `IFieldContext`/`IFieldSource` 接口、`IMutationGuard`/`IMutationPolicy` 协议与一个从零实现的自定义同步字段示例，见 [USEGUIDE §6-7](./USEGUIDE.md#6-fieldbuilder自定义字段扩展协议)。

---

<a id="storeresource"></a>

## StoreResource：Suspense 安全的异步值容器

```ts
import { createStoreResource, createStoreResourceScope } from '@migaia/store-light';
```

**`createStoreResource`｜10 秒上手** —— 独立于对象 facade 的异步值容器，`read()` 在 `loading` 时抛出 Promise（React Suspense 协议）：

```ts
const userResource = createStoreResource(
  async ({ signal }) => {
    const res = await fetch('/api/user', { signal });
    return res.json();
  },
  { keepAliveMs: 30_000 }
);

userResource.preload(); // 提前触发加载
// 组件渲染路径中：const user = userResource.read(); // loading 时 throw Promise
```

第二参数 `IStoreResourceOptions<T>` 全部字段（也可作为第一参数对象形式 `{ load, ...options }` 传入）：

- `keepAliveMs?: number` —— 默认 `1000`；无持有者之后缓存值继续存活的毫秒数，必须是有限非负数
- `dispose?: (value: T) => void | PromiseLike<void>` —— 自定义清理；提供后值必须是引用类型，否则抛 `TypeError`；不提供时若值自带 `$dispose` 方法会自动调用
- `onError?: (error: unknown, phase: 'load' | 'dispose' | 'listener') => void` —— 观察三个阶段的失败
- `onTerminal?: () => void` —— 资源到达终态时调用一次

**`createStoreResourceScope`｜5 秒上手** —— 统一管理一组资源的释放：

```ts
const scope = createStoreResourceScope();
const profile = scope.resource((ctx) => fetchProfile(ctx.signal));
scope.dispose(); // 强制释放该 scope 内全部资源，不等待持有者
```

无入参；返回 `{ resource(factory, options?), dispose() }`，`resource()` 原样委托 `createStoreResource()`。

`StoreResource` 完整状态机（idle/loading/ready/failed/closing/disposed）、`read`/`retain*`/`captureVersion`/`commitCapture`/`whenTerminal`/`subscribe`/`getSnapshot` 等全部方法签名，见 [USEGUIDE §8](./USEGUIDE.md#8-storeresourcesuspense-安全的异步值容器)。

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. 严格写入守卫 + 异步资源：用户设置面板

本地字段用 action-only 守卫，远端用户资料用 `StoreResource` 异步加载，组件卸载时统一释放。

```ts
import { createStore, createStoreResourceScope } from '@migaia/store-light';
import { createMutationPolicy } from '@migaia/store-middleware';

const settingsStore = createStore(
  {
    theme: 'light' as 'light' | 'dark',
    setTheme(theme: 'light' | 'dark') {
      this.theme = theme;
    }
  },
  { debugName: 'settings', mutationPolicy: createMutationPolicy('actions-only') }
);

const scope = createStoreResourceScope();
const profileResource = scope.resource(
  async ({ signal }) => (await fetch('/api/profile', { signal })).json(),
  { keepAliveMs: 30_000, onError: (error, phase) => console.error(`[profile] ${phase}`, error) }
);

function teardown() {
  scope.dispose();
  void settingsStore.$dispose();
}
```

### 2. `$hydrate` + `$plain`：往返持久化快照

```ts
const store = createStore({ count: 0, name: 'guest' });
const snapshot = store.$plain(); // { count: 0, name: 'guest' }
localStorage.setItem('state', JSON.stringify(snapshot));

const restored = JSON.parse(localStorage.getItem('state') ?? '{}');
store.$hydrate(restored, {
  unknown: 'report',
  onUnknown: (key) => console.warn('unknown field', key)
});
```

### 3. `$own` 把外部资源纳入 Store 生命周期

```ts
import { createStore } from '@migaia/store-light';
import { createObjectLeaseRegistry } from '@migaia/lifecycle';

const store = createStore({ items: [] as string[] });
const registry = store.$own(createObjectLeaseRegistry());
// registry 会在 store.$dispose() 时一并释放，无需单独管理
```

### 4. 自定义 FieldBuilder 接入 Store

```ts
import {
  createStore,
  FIELD_BUILDER,
  type IFieldBuilder,
  type IFieldContext
} from '@migaia/store-light';
import type { IDisposable } from '@migaia/reactive';

type ICounterField = IDisposable & { value: number };

function counterField(initial: number): IFieldBuilder<ICounterField> {
  return {
    [FIELD_BUILDER]: true,
    mode: 'sync',
    create({ createSource }: IFieldContext): ICounterField {
      const source = createSource('CounterField');
      let value = initial;
      return {
        get value() {
          source.track();
          return value;
        },
        set value(v) {
          source.commit(() => {
            value = v;
          });
        },
        dispose() {
          source.dispose();
        }
      };
    }
  };
}

const store = createStore({ counter: counterField(0) });
store.counter.value; // 0
```

---

<a id="构建门禁"></a>

## 构建门禁

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test && pnpm run build
```

浏览器集成路径另跑：

```bash
pnpm run typecheck:e2e && pnpm run test:e2e
```
