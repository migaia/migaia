# 使用手册

本文是 `@migaia/store-light` 的完整参考手册。先看 [README.md](./README.md#4-五分钟上手) 的五分钟上手示例，跑起来之后再回来查这里的细节——README 讲"是什么、适合什么场景、5 分钟怎么跑起来"，本文讲"每一个字段规则、每一个 API 的精确签名、`StoreResource` 的完整状态机、每一条错误信息"。

## 目录

1. [导入与依赖](#1-导入与依赖)
2. [Store 定义规则](#2-store-定义规则)
3. [创建入口参考](#3-创建入口参考)
4. [ICreateStoreOptions 参考](#4-icreatestoreoptions-参考)
5. [`$`-API 完整参考](#5-api-完整参考)
6. [FieldBuilder：自定义字段扩展协议](#6-fieldbuilder自定义字段扩展协议)
7. [写入守卫：IMutationGuard / IMutationPolicy](#7-写入守卫imutationguard--imutationpolicy)
8. [StoreResource：Suspense 安全的异步值容器](#8-storeresourcesuspense-安全的异步值容器)
9. [错误信息全表](#9-错误信息全表)
10. [生命周期与释放语义](#10-生命周期与释放语义)
11. [贴近生产的组合示例](#11-贴近生产的组合示例)
12. [常见问题排查](#12-常见问题排查)

---

## 1. 导入与依赖

```ts
import {
  createStore,
  createStoreSync,
  createAsyncStore,
  createLegacyStore,
  storeReady,
  raw,
  isRaw,
  isFieldBuilder,
  FIELD_BUILDER,
  createStoreResource,
  createStoreResourceScope
} from '@migaia/store-light';
```

`store-light` 只依赖 `@migaia/reactive`（Signal/Computed/Effect/Runtime 内核）。所有节点默认创建在 `@migaia/reactive` 的 `defaultRuntime` 上；需要隔离运行时（多 root、SSR 每请求、单测互不串状态）时，通过 `@migaia/reactive` 的 `createRuntime()` 构造独立 Runtime，再传入 `options.runtime`。`store-light` 本身不 import 任何 UI 框架，也不假设特定宿主环境。

---

## 2. Store 定义规则

`createStore(shape, options?)` 接收一个对象字面量，逐个属性描述符（`Object.getOwnPropertyDescriptors`）按以下规则分类：

| 输入形状 | 归类为 | 说明 |
| --- | --- | --- |
| `get x() { ... }` 访问器 | **Computed** | `this` 绑定到 Store 自身；惰性求值，依赖变化才重新计算；对外只读，`store.x = v` 不做任何事（严格模式下抛 TypeError，因为底层是只有 getter 的属性） |
| `raw(value)` 包裹的值 | **原样字段** | 即使 `value` 是函数也不当 Action；可读可写可整体替换（典型用途：存 `onSubmit` 这类回调） |
| 普通函数 `method() {}` | **Action** | 自动包一层 `runtime.runTracedAction` + batch + untracked；`this` 绑定到 Store，方法内可以自然读写其他字段 |
| `FieldBuilder`（`isFieldBuilder(value)` 为真） | **自定义字段** | 交给 Builder 的 `create()` 产出实际字段对象，见 [§6](#6-fieldbuilder自定义字段扩展协议) |
| 其他普通值 | **Signal** | 读时自动订阅（在 Computed/Effect 内读取时建立依赖），写时触发通知 |

`IStoreDefinition<S>` 类型给输入对象附加了 `ThisType<IReactiveStore<S>>`——这意味着方法体和 getter 体内的 `this` 拿到的是**解析后**的 Store 类型（`FieldBuilder` 已经变成它 `create()` 产出的真实字段类型），而不是输入字面量里那个还没解析的 `FieldBuilder` 类型；不加这个类型标注，方法里写 `this.wasmField.value` 之类的代码会类型报错。

字段名到暴露类型的映射由 `IStoreShape<S>` 完成；工程上不需要手写这个映射，`createStore` 的返回值类型会自动推导正确。

---

## 3. 创建入口参考

| API | 签名 | 参数类型 | 同步/异步 | 行为 |
| --- | --- | --- | --- | --- |
| `createStore(shape, options?)` | `(S) => IReactiveStore<S>` | `shape: IStoreDefinition<S>`；`options?: ICreateStoreOptions` | 同步 | 同步创建；**shape 中任意字段是非 `mode: 'sync'` 的 `FieldBuilder`（`mode: 'async'` 或历史无 mode 的 Builder）会在读取属性描述符阶段直接抛错**，不会执行任何 I/O，提示改用 `createAsyncStore` |
| `createStoreSync(shape, options?)` | 同上 | 同上 | 同步 | `createStore` 的显式命名别名，行为完全一致，不是独立的生命周期语义 |
| `createAsyncStore(shape, options?)` | `(S) => Promise<IReactiveStore<S>>` | `shape: IStoreDefinition<S>`；`options?: ICreateStoreOptions` | 异步 | 允许异步 `FieldBuilder`；返回的 Promise 在全部异步字段初始化完成（或抛错）后才 resolve/reject，resolve 后每个字段都已就绪 |
| `createLegacyStore(shape, options?)` | `(S) => IReactiveStore<S>` | `shape: IStoreDefinition<S>`；`options?: ICreateStoreOptions` | 同步 | 历史兼容门面：不做同步字段限制，即使 shape 里有异步字段也立即同步返回 Store——此时异步字段还没就绪，调用方需要自行用 `storeReady(store)` 等待，或检查 `store.$async` |
| `storeReady(store)` | `(store: object) => Promise<void>` | `store: object` | 异步 | 返回该 Store 的就绪 Promise；只对通过上述任一入口创建的 Store 有效，传入非 Store 对象会抛 `[store] store has no asynchronous initialization` |

新代码建议只用 `createStore`（纯同步定义）和 `createAsyncStore`（含异步字段的定义）这两个入口；`createLegacyStore` 是为迁移期保留的兼容层。

**初始化失败的清理语义**：无论走哪个入口，构造过程中任何一步抛错（字段类型非法、Builder 的 `create()` 拒绝所有权等），已经创建的内部节点都会被回收（`scope.dispose()`），不会遗留半初始化的资源。异步字段初始化失败（`readyList` 中的 Promise reject）同样会把整个 Store 标记为 `disposed` 并回收资源，即使有的字段在此之前已经初始化成功。

---

## 4. ICreateStoreOptions 参考

```ts
const store = createStore(shape, {
  runtime,
  debugName: 'settings',
  warnAsyncActions: true,
  mutationPolicy: createMutationPolicy('actions-only')
});
```

| 选项 | 类型 | 必填性 | 默认值 | 作用 |
| --- | --- | --- | --- | --- |
| `runtime` | `IRuntime` | 可选 | `defaultRuntime` | 显式指定节点所属的 Runtime；同一个 Runtime 上的节点共享一张依赖图，跨 Runtime 的节点完全隔离 |
| `debugName` | `string` | 可选 | `'Store'` | 调试名前缀，出现在内部节点的 `debugName`（形如 `${debugName}.${key}`）里，不参与状态语义 |
| `warnAsyncActions` | `boolean` | 可选 | `false` | 开启后，若某个 Action 返回了一个 thenable（说明它是 async 方法），首次调用时会 `console.warn` 提示"只有首个 await 之前的写入被自动 batch" |
| `mutationPolicy` | `IMutationPolicy` | 可选 | 无 | 接入 MobX 风格的严格写入守卫，见 [§7](#7-写入守卫imutationguard--imutationpolicy) |

---

## 5. `$`-API 完整参考

`$`-前缀的方法/属性挂载为**不可枚举**属性，不会出现在 `for...in`、`Object.keys()` 或 `$snapshot()` 的用户字段遍历里。

| API | 签名 | 参数类型 | 同步/异步 | 副作用 / 边界 |
| --- | --- | --- | --- | --- |
| `$runtime` | `IRuntime` | 无（属性） | 同步 | 该 Store 所有节点所属的 Runtime；只读引用，供 React 适配层等在同一张图上建 Effect |
| `$async` | `boolean` | 无（属性） | 同步 | 定义里是否含异步 `FieldBuilder`；为 `false` 时整个 Store 同步就绪 |
| `$disposed` | `boolean`（getter） | 无（属性） | 同步 | 是否已释放，实时求值，不是构造时的静态快照 |
| `$snapshot()` | `() => IStoreShape<S>` | 无 | 同步 | 返回全部字段（signal + computed + wasm 字段）的一次性快照对象；**要求 Store 已就绪**，异步字段未就绪时抛 `[store] store is pending; use createAsyncStore()...` |
| `$plain()` | `() => Record<string, unknown>` | 无 | 同步 | 只返回 signal 支撑的标量字段（含 `raw()` 字段），**排除** computed/wasm 字段/方法；**不要求 Store 已就绪**，异步字段初始化期间也能调用；持久化层（`@migaia/store-persist`）基于它取快照 |
| `$hydrate(partial, options?)` | 见下 | `partial: Record<string, unknown>`；`options?: IHydrateOptions` | 同步 | 宽松写回：只写已知 signal 键，未知/computed/wasm 键按 `options.unknown` 处理；**不要求 Store 已就绪**；整批写入在一次 `runMutation` 事务内完成 |
| `$subscribe(fn, options?)` | `(fn, { fireImmediately? }) => IDisposer` | `fn: () => void`；`options?: ISubscribeOptions` | 同步 | 注册一个粗粒度订阅 Effect：只读取全部 signal 的 `.value` 和 wasm 字段 source 的 `track()`，**不主动读取 computed**——computed 的变化通过它依赖的 signal 间接触发这个订阅；`fireImmediately: true` 时订阅建立后立即调用一次 `fn`；`fn` 抛错会经 `runtime.reportError` 上报，不会中断订阅本身 |
| `$batch(recipe)` | `(recipe: (draft) => void) => void` | `recipe: (draft: IStoreShape<S>) => void` | 同步 | 整个 recipe 在一次 `batch` 内执行，多次字段写入只触发一次通知；`draft` 就是 Store 本身；**不是事务**，recipe 中途抛错不回滚已写入的字段；写只读 computed 字段会自然抛错（属性只有 getter） |
| `$set(patch)` | `(patch: IWritableStorePatch<S>) => void` | `patch: IWritableStorePatch<S>` | 同步 | 低层批量赋值；**编译期**只接受非 computed/非 FieldBuilder/非方法的字段（含 `raw()` 字段），**运行期**对每个 key 额外校验对应 signal 是否存在，不存在则抛 `[store] field is not settable: ${key}`（防御动态/非法输入） |
| `$own(resource)` | `<T extends IDisposable>(resource: T) => T` | `resource: T extends IDisposable` | 同步 | 把外部资源纳入本 Store 的所有权作用域，`$dispose()` 时一并释放；资源必须未归属或已归属本 Runtime，跨 Runtime 直接拒绝（见 [§9](#9-错误信息全表)） |
| `$dispose()` | `() => Promise<void>` | 无 | 异步、同步启动 | 首次调用同步切换 `$disposed`、中止在途异步字段初始化并启动全部内部节点清理；所有调用返回同一个 Promise，成功或失败均稳定重放，Promise settle 表示 owned cleanup 已完成 |

`ISubscribeOptions`：`{ fireImmediately?: boolean }`，默认 `false`。
`IHydrateOptions`：`{ unknown?: 'ignore' | 'report' | 'strict'; onUnknown?: (key: string) => void }`，默认 `unknown: 'ignore'`（向后兼容的部分 hydration）；`'strict'` 遇到未知 key 直接抛错；`'report'` 对每个未知 key 调用一次 `onUnknown`，写入过程本身继续。

---

## 6. FieldBuilder：自定义字段扩展协议

Store 定义协议，扩展去实现——`store-light` 不知道 WASM、也不知道任何具体字段实现，`FieldBuilder` 只是一份约定。`@migaia/store-wasm` 的 `number()`/`string()`/`boolean()`/`array()`/`record()` 都是这份协议的具体实现。

```ts
export type FieldContext = {
  runtime: IRuntime;
  signal: AbortSignal;          // Store dispose 时中止在途初始化
  createSource(debugName?: string): IFieldSource;
};

export type SyncFieldBuilder<F extends IDisposable> = {
  readonly [FIELD_BUILDER]: true;
  readonly mode: 'sync';
  create(context: FieldContext): F;
};

export type AsyncFieldBuilder<F extends IDisposable> = {
  readonly [FIELD_BUILDER]: true;
  readonly mode: 'async';
  create(context: FieldContext): Promise<F>;
};
```

| 名称 | 作用 |
| --- | --- |
| `FIELD_BUILDER` | 品牌 symbol，不导出为公共构造 API，只用于 `isFieldBuilder` 的身份判定（防止结构类似的普通对象被误判为 Builder） |
| `isFieldBuilder(value)` | 类型守卫，判断某个值是否为 `FieldBuilder` |
| `IFieldSource` | Runtime 为自定义存储签发的最小响应式能力：`track()`（建立依赖）、`notify()`（触发下游更新）、`commit(write)`（在发布前保留版本号，随后一次性 publish，避免"先写后通知"之间的撕裂）、`observed`（是否有人在观察） |
| `FieldContext` | Builder 的 `create()` 唯一入参：`runtime` 用于创建普通节点；`createSource` 接入同一张依赖图；`signal` 是 Store dispose 时用来中止在途初始化的 `AbortSignal` |

**所有权规则**：`FieldContext` 刻意不传 `scope`——所有权登记是 Store 的职责，不是 Builder 的职责。Builder 只管"造出字段"，Store 在拿到字段后统一 `claimOwnership` + `scope.own`；这样第三方 Builder 实现"创建了资源却忘了登记"时，`$dispose()` 也不会漏释放，因为登记这一步根本不由 Builder 完成。

**同步 vs 异步字段**：`mode: 'sync'` 的字段在 `createStore()`/`createAsyncStore()` 构造期间同步创建，构造完成即可用；`mode: 'async'`（或历史无 `mode` 字段的 `LegacyFieldBuilder`）的字段异步创建，读取会先 `assertReady()`——Store 未就绪时抛错，必须走 `createAsyncStore()` 并等待其 Promise resolve，或用 `createLegacyStore()` + `storeReady()`。

一个最小的自定义同步字段实现（改编自 `@migaia/store-wasm` 的 `number()`）：

```ts
import { FIELD_BUILDER, type FieldBuilder, type FieldContext } from '@migaia/store-light';
import type { IDisposable } from '@migaia/reactive';

type ICounterField = IDisposable & { value: number };

function counterField(initial: number): FieldBuilder<ICounterField> {
  return {
    [FIELD_BUILDER]: true,
    mode: 'sync',
    create({ createSource }: FieldContext): ICounterField {
      const source = createSource('CounterField');
      let value = initial;
      let disposed = false;
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
          if (disposed) return;
          disposed = true;
          source.dispose();
        }
      };
    }
  };
}
```

---

## 7. 写入守卫：IMutationGuard / IMutationPolicy

`store-light` 只定义协议，不提供具体策略实现：

```ts
export type IMutationGuard = { assertMutationAllowed(operation?: string): void };
export type IMutationPolicy = IMutationGuard & { runInAction<T>(fn: () => T): T };
```

- Store 与 collections 类的包只需要回答"能不能改"这一个问题（`IMutationGuard`）；
- Store facade 额外需要"把一次动作标记为正在动作内"这个能力（`IMutationPolicy`），因为方法/`$batch`/`$set`/`$hydrate` 内部的写入应该被放行，直接对字段赋值则由策略决定是否允许。

具体实现（MobX 风格 actions-only 模式）由 `@migaia/store-middleware` 提供：

```ts
import { createStore } from '@migaia/store-light';
import { createMutationPolicy } from '@migaia/store-middleware';

const store = createStore(
  {
    count: 0,
    increment() {
      this.count += 1; // 在 action 内，允许
    }
  },
  { mutationPolicy: createMutationPolicy('actions-only') }
);

store.increment(); // OK
store.count = 5; // 抛错：[store] set(count) is not allowed outside an action
```

不传 `mutationPolicy` 时（默认），任何地方直接赋值都允许，这是为了不改变既有 Store 的行为——严格模式是显式接入的。

---

## 8. StoreResource：Suspense 安全的异步值容器

`createStoreResource(factory, options?)` 创建一个独立于对象 facade 的异步值容器，`createStoreResourceScope()` 管理一组资源的统一释放。两者都不要求配合 `createStore` 使用。

### 8.1 状态机

```
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
- **`disposed`**：终态，`whenTerminal()` resolve，所有方法要么 no-op 要么抛 `[store] resource is disposed`。

### 8.2 API 参考

| API | 签名 | 参数类型 | 同步/异步 | 说明 |
| --- | --- | --- | --- | --- |
| `read()` | `() => T` | 无 | 同步 | 读取当前值；`loading` 中会 `throw` 正在进行的 Promise（React Suspense 协议），`failed` 会 `throw` 错误对象 |
| `preload()` | `() => void` | 无 | 同步 | 如果还没开始加载就触发 `start()`；不建立任何持有租约 |
| `retry()` | `() => void` | 无 | 同步 | 把当前值标记为 stale 后重新加载；重新加载完成前旧值仍可读 |
| `retainResource()` | `() => () => void` | 无 | 同步 | 获取一个"资源级"持有租约（不锁定具体版本），返回释放函数；有此类租约时资源不会因超时被回收 |
| `retainVersion(version)` | `(number \| VersionToken) => () => void` | `version: number \| VersionToken` | 同步 | 锁定某个具体版本不被回收（即使后续 `retry()` 产生了新版本），常用于"后台刷新但保留当前渲染值" |
| `retain(version?)` | `(version?) => () => void` | `version?: number \| VersionToken` | 同步 | `retainResource`/`retainVersion` 的兼容合并入口，**已废弃**，新代码请直接用上面两个 |
| `captureVersion(id)` | `(number) => IResourceCapture` | `id: number` | 同步 | 渲染期的临时保护：先拿到一个 capture token，不立即计入正式持有者 |
| `commitCapture(capture)` | `(IResourceCapture) => () => void` | `capture: IResourceCapture` | 同步 | 提交期把 capture 转成正式的版本持有租约；`captureVersion`/`commitCapture` 这一对是给 React"渲染可能被丢弃、提交才算数"的两阶段场景设计的（`@migaia/store-react` 的 `useStoreResource` 就是这样用的） |
| `dispose()` | `() => void` | 无 | 同步 | 优雅释放：仍有持有者时转入 `closing`，等最后一个持有者释放后才真正清理 |
| `forceDispose()` | `() => void` | 无 | 同步 | 无视持有者，立即转入终态并清理全部内部状态 |
| `whenTerminal()` | `() => Promise<void>` | 无 | 异步 | 到达 `disposed` 时 resolve；不依赖 GC，任何时候调用都能正确等到 |
| `subscribe(listener)` | `(() => void) => () => void` | `listener: () => void` | 同步 | 注册变更监听（配合 `getSnapshot()` 可直接喂给 `useSyncExternalStore`） |
| `getSnapshot()` | `() => number` | 无 | 同步 | 单调递增的 revision 号，每次状态变化都会自增 |
| `readSnapshot()` | `() => { value, version, token }` | 无 | 同步 | 同 `read()`，但额外带上版本号和 `VersionToken`，供需要精确版本信息的调用方使用 |
| `captureSnapshot(existingLease?)` | 见 `useStoreResource` 用法 | `existingLease?: object` | 同步 | 组合了读取快照与 `captureVersion` 的便捷方法，`existingLease` 传入上一次已提交的 release 函数用于跳过重复 capture |

### 8.3 StoreResourceOptions

| 字段 | 类型 | 必填性 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `keepAliveMs` | `number` | 可选 | `1000` | 无任何持有者（resource lease + version lease + 挂起的 capture）之后，缓存值继续存活的毫秒数；必须是有限非负数，否则构造时抛 `RangeError` |
| `dispose` | `(value: T) => void \| Promise<void>` | 可选 | 无 | 自定义清理函数；提供后，值必须是引用类型（对象/函数），否则抛 `TypeError`；不提供时，若值本身带 `$dispose` 方法（例如另一个 Store），会自动调用 |
| `onError` | `(error, phase: StoreResourceErrorPhase) => void` | 可选 | 无 | 观察 `'load' \| 'dispose' \| 'listener'` 三个阶段的失败；reporter 自身抛错会被吞掉，不影响资源状态 |
| `onTerminal` | `() => void` | 可选 | 无 | 资源到达终态时调用一次 |

`factory` 既可以是函数 `(context) => T \| Promise<T>`，也可以是 `{ load, dispose?, keepAliveMs?, onError?, onTerminal? }` 对象形式（等价于把这些字段和 `options` 合并）。`StoreResourceLoadContext` 提供 `{ signal, generation, token }`，`signal` 在该次加载被取代/资源关闭时中止。

构造时只读取上述已知字段并形成稳定快照：`load` 与每个已知 accessor 最多读取一次，不枚举或执行未知字段 getter；显式 `options` 的 own-enumerable 字段覆盖 factory 对象上的同名字段。`dispose`、`onError`、`onTerminal` 若存在必须是函数，否则在任何请求或 Resource 状态建立前同步抛出 tagged `INVALID_OPTION`。

自动 `$dispose` 与自定义 disposer 的返回值遵循 lifecycle 的统一接纳语义：disposer getter、then getter 均只读取一次，捕获函数分别以原资源、原 thenable 作为 receiver 调用。getter、调用或异步 rejection 的原始异常通过 `onError(error, 'dispose')` 可达；重复 `forceDispose()` 不会重复清理同一值。

### 8.4 createStoreResourceScope

```ts
const scope = createStoreResourceScope();
const userResource = scope.resource((ctx) => fetchUser(ctx.signal));
const settingsResource = scope.resource((ctx) => fetchSettings(ctx.signal));

// 组件卸载 / 请求结束
scope.dispose(); // 对组内每个资源调用 forceDispose()
```

`scope.resource()` 原样委托 `createStoreResource()` 的已知字段快照与 callback precedence，不会再次 spread/枚举 factory；用户的 effective `onTerminal` 保持不变。Scope 通过 `whenTerminal()` 从私有集合摘除自然终止的资源，不改写公开 disposer。`scope.dispose()` 会强制释放（`forceDispose`）组内所有仍然存在的资源，不等待持有者释放——它假定"整个作用域要关闭了，个别资源的持有者不再重要"。

---

## 9. 错误信息全表

| 错误信息 | 触发条件 |
| --- | --- |
| `[store] store is disposed` | `$dispose()` 之后读写任意字段/调用任意 `$`-方法（`$own` 除外，它先校验其他条件） |
| `[store] store is ${status}; use createAsyncStore() before accessing async fields` | 读取尚未就绪（`pending`）或已失败（`failed`）的异步字段 |
| `[store] createStore() only accepts synchronous fields; "${key}" is a FieldBuilder. Use createAsyncStore().` | `createStore()`（非 `createAsyncStore`）的 shape 里含非 `mode: 'sync'` 的 `FieldBuilder` |
| `[store] field is not settable: ${key}` | `$set()` 传入的 key 不对应任何 signal（computed/wasm/方法字段，或压根不存在的 key） |
| `[store] unknown hydration field: ${key}` | `$hydrate(partial, { unknown: 'strict' })` 遇到未知 key |
| `[store] store has no asynchronous initialization` | 对非 Store 对象（或未经 `createStore`/`createAsyncStore`/`createLegacyStore` 创建的对象）调用 `storeReady()` |
| `[store] this node is already owned by another Runtime` / `[store] ${what} belongs to a different Runtime than this scope` / `[store] ${what} is not a Runtime-owned reactive node` / `[store] ${what} belongs to another Runtime` | `$own(resource)` 传入已属于其他 Runtime 的资源，或资源不是本 Runtime 登记的响应式节点（来自 `@migaia/reactive` 的所有权校验） |
| `[store] resource is disposed` | 对已 `disposed`/`closing` 的 `StoreResource` 调用 `preload`/`retry`/`retain*`/`captureVersion`/`commitCapture` 等操作 |
| `[store] unknown resource version` | `retainVersion(version)`/`captureVersion(id)`/`commitCapture(capture)` 传入的版本号既不是当前版本，也不在 retired/stale/closing 列表里 |
| `[store] resource factory returned a disposed value` | `factory` 返回了一个已经被标记为 disposed 的值（复用了已释放的引用） |
| `[store] disposable resource values must use reference identity`（`TypeError`） | 配置了 `dispose` 但 `factory` 产出的是原始类型（非对象/函数），无法用引用去重和追踪生命周期 |
| `[store] invalid or consumed resource capture` | `commitCapture()`/`captures.inspect()` 收到的 capture 已提交过、已失效，或不是本资源签发的 |
| `[store] keepAliveMs must be a finite non-negative number`（`RangeError`） | `StoreResourceOptions.keepAliveMs` 传了负数、`NaN` 或 `Infinity` |

---

## 10. 生命周期与释放语义

**Store 构造失败**：`shape` 里任意字段处理阶段抛错（比如某个 `FieldBuilder.create()` 抛错），整个构造过程回滚——已创建的 scope 内节点被 `scope.dispose()`，内部的 `signals`/`computeds`/`wasmFields`/`fieldSources` 全部清空，原始错误继续向外抛出（清理阶段自身失败时，会尽量把清理错误挂到原错误的 `cause` 上，不会替换原始错误）。

**异步字段初始化失败**：`readyList` 中任一 Promise reject，Store 立即被标记为 `disposed = true`，中止其余在途初始化（`initAbort.abort()`），并回收已经创建的资源；这个转变发生在 `ready` Promise 的 reject 路径里，因此哪怕调用方没有 `await storeReady()`，Store 内部状态也已经正确收敛，不会有"部分字段可用"的僵尸状态。

**`$dispose()` 时机**：字段读写方法在闭包里直接引用底层节点（`node.value`），不经过任何"Store 对象本身"的代理层；因此 `$dispose()` 唯一要做的事就是把 `disposed` 标志位翻转、释放 scope、清空内部 Map。所有已经拿到 Store 引用的调用方，下一次任何操作都会立刻看到统一的 `[store] store is disposed`。

**`StoreResource` 的持有者概念**：一份值被判定为"没有持有者"（可以被回收）需要同时满足：没有 `retainResource()`/`retainVersion()` 产生的活跃 lease，也没有任何未提交/未过期的 `captureVersion()` provisional token（渲染阶段的临时保护，默认 4 秒内没有 commit/discard 会被视为放弃）。`keepAliveMs` 超时只在"当前没有任何持有者"时才开始计算，一旦有新的持有者出现，倒计时会被取消。

---

## 11. 贴近生产的组合示例

一个"用户设置面板"场景：本地可写字段用严格 action 守卫，远端用户资料用 `StoreResource` 异步加载，并在组件卸载时统一释放。

```ts
import { createStore } from '@migaia/store-light';
import { createMutationPolicy } from '@migaia/store-middleware';
import { createStoreResourceScope } from '@migaia/store-light';

const mutationPolicy = createMutationPolicy('actions-only');

const settingsStore = createStore(
  {
    theme: 'light' as 'light' | 'dark',
    fontSize: 14,
    get isDark() {
      return this.theme === 'dark';
    },
    setTheme(theme: 'light' | 'dark') {
      this.theme = theme;
    }
  },
  { debugName: 'settings', mutationPolicy }
);

const scope = createStoreResourceScope();
const profileResource = scope.resource(
  async ({ signal }) => {
    const res = await fetch('/api/profile', { signal });
    if (!res.ok) throw new Error(`profile fetch failed: ${res.status}`);
    return res.json() as Promise<{ name: string }>;
  },
  {
    keepAliveMs: 30_000,
    onError: (error, phase) => console.error(`[profile] ${phase} failed`, error)
  }
);

// 类 React 组件渲染路径：
// const profile = profileResource.read(); // loading 时 throw Promise，交给 Suspense 边界

// 组件卸载 / 页面销毁时统一收尾：
function teardown() {
  scope.dispose(); // 强制释放 profileResource
  settingsStore.$dispose();
}
```

---

## 12. 常见问题排查

**Q：我在 getter 里写 `this.x = 1` 报错了。**
Computed 只有 getter、没有 setter，属性描述符层面就不可写；ESM 严格模式下赋值给这样的属性会抛 `TypeError`。派生值只能通过它依赖的 signal 字段间接改变。

**Q：`store.field = x` 没报错，但我明明传了 `mutationPolicy`。**
检查是不是走了 `$batch`/`$set`/`$hydrate` 或方法（Action）内部——这几条路径会先 `runInAction()` 再执行，动作深度 > 0 时 `assertMutationAllowed` 自然放行。只有"在这些路径之外直接赋值"才会被拦截。

**Q：`createStore()` 报 "only accepts synchronous fields"，但我看代码是同步的。**
检查 `FieldBuilder` 的 `mode` 字段是不是显式写了 `'sync'`——没有 `mode` 字段的历史 `LegacyFieldBuilder` 会被当成非同步处理，`createStore()` 一律拒绝，只有 `createAsyncStore()`/`createLegacyStore()` 接受。

**Q：`StoreResource.read()` 一直抛同一个 Promise，界面卡在 loading。**
确认调用方确实在 Suspense 边界内 `await`/处理了这个抛出的 Promise；`read()` 抛 Promise 是设计如此（React Suspense 协议），不是错误——真正的问题通常是外层没有 `<Suspense>` 或没有等待 Promise settle 就再次同步渲染。

**Q：`retry()` 之后旧值突然消失了。**
`retry()` 只保证"重新加载完成前，旧值继续可读"；如果旧值没有任何 `retainVersion` 锁定，加载成功后旧值会按正常的 retire/回收流程被清理（触发 `dispose` 配置或值自身的 `$dispose`）。需要强制保留某个版本用 `retainVersion(version)`。

**Q：`$plain()`/`$hydrate()` 和 `$snapshot()` 有什么区别，该用哪个？**
`$snapshot()` 拿"当前展示状态"（含 computed/wasm 字段），要求 Store 已就绪；`$plain()`/`$hydrate()` 只处理可持久化的标量 signal 字段，且不要求 Store 已就绪——持久化/hydration 场景应该用后者，展示/调试场景用前者。
