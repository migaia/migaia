# @migaia/store-react

## 1. 这是什么

`@migaia/reactive` 提供了一张响应式依赖图（Signal/Computed/Effect），`@migaia/store-light`、`@migaia/store-keyed`、`@migaia/resource` 在这张图上分别搭出了「甜 API 对象 Store」「按定义实例化的 Atom」「可取消的异步 Resource」。它们都不知道 React 的存在——不认识 `useSyncExternalStore`、不处理并发渲染下的撕裂窗口、也不管 StrictMode 的双调用。

`@migaia/store-react` 就是把这张图接到 React 组件树上的**驱动程序**：一组 hook 把「响应式读」转换成 React 认可的订阅（`useSyncExternalStore`），外加一个 `StoreProvider` 负责这张图的作用域、生命周期与就绪时机。你不需要因为换成 React 就重写业务里的 Store/Atom/Resource 定义，本包只负责“接线”这一层。

## 2. 适合 / 不适合什么场景

| 场景 | 说明 |
| --- | --- |
| 已经在用 `@migaia/store-light` 的 Store、`@migaia/store-keyed` 的 Atom，或 `@migaia/resource` 的 Resource，要在 React 里渲染它们 | 本包就是为此存在的适配层 |
| 需要按 Provider/请求作用域隔离状态（比如 SSR 每请求一份、多个独立小组件树互不干扰） | `StoreProvider` + `StoreRegistry` + `StoreToken` 提供作用域化的依赖注入 |
| 需要在渲染子树前挡住一个异步初始化（比如等 wasm 模块 ready） | `config.ready` 就绪屏障 + Suspense 风格 fallback |
| 只是想要一个简单的 React 状态管理方案，不关心底层是响应式图 | 可以用，但收益主要来自 Store/Atom/Resource 本身的能力（细粒度订阅、派生值、异步取消），不是本包独有 |
| 想要 Redux/Zustand 那种「全局单一 store + reducer」范式 | 不是本包的心智模型；这里的 Store 是对象字面量甜 API，状态可以任意拆分成多个独立 Store/Signal |

## 3. 用了之后能得到什么

- **精细订阅，不多渲染**：`useStore`/`useSignal`/`useAtomDefinition` 等 hook 只让组件在它真正读到的字段变化时重渲染，而不是整个 Store 变了就全量重渲染。
- **并发渲染安全**：selector 在 render 阶段的捕获与 commit 阶段的提交是分开的，被丢弃的并发渲染不会污染共享订阅状态；`useStoreResource` 对 Suspense 场景的资源版本做了单独的租约管理。
- **StrictMode 不误伤**：Provider 内部创建的 Registry 在 effect 的 mount → unmount → 重新 mount 探测下不会被提前释放。
- **可选的作用域化依赖注入**：`createStoreToken` + `StoreRegistry` 让你在一棵子树内注册"这棵树用的 Store 实例"，而不必到处 import 单例。
- **就绪屏障是一等公民**：`config.ready` 让你声明"子树渲染前必须等哪些 Promise 就绪"，不用手写一层 `if (!ready) return <Spinner/>`。
- **Suspense-safe 的异步值读取**：`useResourceValue`/`useAsyncAtomValue`/`useStore`（异步 Store）都能直接在 render 里 throw Promise，交给上层 `<Suspense>` 处理。

## 4. 安装

```bash
pnpm add @migaia/store-react react react-dom
```

`react`/`react-dom` 是 peer dependency（`>=18`）。本包与 `@migaia/reactive`、`@migaia/resource`、`@migaia/store-keyed`、`@migaia/store-light` 配合使用，这几个包按需装即可，不是全部都要用到。产物是纯 ESM；当前 `package.json` 只公开根入口，所有公开 API 都从 `@migaia/store-react` 导入。

## 5. 五分钟上手

```tsx
import { StoreProvider, useStore } from '@migaia/store-react';
import { createStore } from '@migaia/store-light';

const counterStore = createStore({
  count: 0,
  increment() {
    this.count += 1;
  }
});

function Counter() {
  const count = useStore(counterStore, (state) => state.count);
  return <button onClick={() => counterStore.increment()}>count: {count}</button>;
}

export function App() {
  return (
    <StoreProvider>
      <Counter />
    </StoreProvider>
  );
}
```

`counterStore` 是模块级单例，`useStore` 直接订阅它——不需要注册到 `StoreProvider`。`StoreProvider` 在这里的作用是给整棵子树提供一个统一的 Registry/Runtime 作用域，供后面要用到的 `useAtomDefinition`、`useStoreFromProvider`、feature flag 等 hook 使用；只用 `useStore`/`useSignal` 读取自己 import 的 Store/Signal 时，理论上可以不套 `StoreProvider`，但项目里建议始终在根部套一层，以便后续按需接入其它能力。

## 6. 核心概念速览

| 概念 | 一句话 |
| --- | --- |
| **Runtime** | `@migaia/reactive` 的响应式图容器，Signal/Computed/Effect 都挂在某个 Runtime 上；同图节点才能互相订阅 |
| **Store**（`@migaia/store-light`） | 对象字面量甜 API：普通值→Signal、`get` 访问器→Computed（惰性缓存）、方法→Action（自动 batch） |
| **Atom 定义**（`@migaia/store-keyed`） | `atomDef`/`derivedDef`/`writableDef`/`familyDef` 产出的是纯 token（不含状态），要靠 `AtomStore` 才能实例化出真正的值 |
| **AtomStore** | Provider 的 `registry.atomStore`：同一份 Atom 定义在不同 Provider/请求作用域下各有一份独立状态 |
| **Resource**（`@migaia/resource`） | 可取消、可重试的异步值容器，天然支持 Suspense |
| **StoreRegistry / StoreToken** | 挂在 `StoreProvider` 上的作用域化容器；用 `createStoreToken` 定义 key，`registry.register` 注册实例，子树里用 `useStoreFromProvider(token)` 取回 |
| **就绪屏障（ready barrier）** | `StoreProvider` 的 `config.ready`：子树渲染前必须 settle 的一组 Promise/工厂 |
| **Feature flag** | `config.features.wasm` / `config.features.experimental`，配合 `useStoreFeature`/`useAssertStoreFeature` 做能力开关 |

## 7. Hook / 能力一览

| 导出 | 参数类型 | 同步/异步 | 用途 | 需要 `StoreProvider`？ |
| --- | --- | --- | --- | --- |
| `StoreProvider` | `props: IStoreProviderProps` | 同步 | 建立 Registry/Runtime 作用域，可选就绪屏障与 feature 配置 | — |
| `useStore(store, selector, isEqual?)` | `store: IReactiveStore<S>`；`selector: (state: IStoreShape<S>) => R`；`isEqual?: (a: R, b: R) => boolean` | 同步 | 订阅 `@migaia/store-light` Store 的一个 selector；Store 若含异步字段会 Suspense | 否 |
| `useSignal(signal)` | `signal: ISignal<T>` | 同步 | 订阅单个 `ISignal`，返回 `[value, setValue]` | 否 |
| `useTracked(read, isEqual?, runtime?)` | `read: () => T`；`isEqual?: (a: T, b: T) => boolean`；`runtime?: IRuntime` | 同步 | 通用底层 hook：自动追踪 `read()` 里访问的任意节点 | 否 |
| `useResource(resource)` / `useResourceValue(resource)` | `resource: Resource<T>` | 同步 | 订阅 `@migaia/resource` 的 `Resource`；后者是 Suspense-safe 的取值版本 | 否 |
| `useStoreResource(resource)` | `resource: IStoreResource<T>` | 同步 | 订阅 `@migaia/store-light` 的 `IStoreResource`，带渲染期版本租约保护 | 否 |
| `useAtomDefinition(def)` / `useSetAtomDefinition(def)` | `definition: IAtomDefinition<T>` / `definition: IWritableAtomDefinition<T, Args, Result>` | 同步 | 读写 `atomDef`/`derivedDef`/`writableDef`/`familyDef` 产出的 Atom 定义 | **是** |
| `useAtomValue(atom)` / `useSetAtom(atom)` / `useAtom(atom)` | `atom: IReadableAtom<T>` / `atom: IWritableAtom<T, Args, Result>` | 同步 | 通用协议 hook：给任意实现了 `IReadableAtom`/`IWritableAtom` 的对象接上 React 订阅 | 否（有 Provider 时按 Provider 的 atomStore 走） |
| `useAsyncAtomValue(atom)` | `atom: { readonly resource: Resource<T> }` | 同步 | Suspense-safe 读取 `{ resource: Resource<T> }` 形状的异步 atom | 否 |
| `useNodeValue(node, runtime, enabled?)` | `node: IStableNode<T>`；`runtime: IRuntime`；`enabled?: boolean` | 同步 | 最底层：订阅任意 `{ value, peek() }` 稳定节点 | 否 |
| `useStoreRegistry()` / `useStoreRuntime()` | 无 | 同步 | 取当前 Registry / 其 Runtime | **是** |
| `useStoreFromProvider(token)` / `useProvidedStore(token, selector, isEqual?)` | `token: StoreToken<T>` / `token: StoreToken<IReactiveStore<S>>`；`selector: (state: IStoreShape<S>) => Result`；`isEqual?: (left: Result, right: Result) => boolean` | 同步 | 按 `StoreToken` 从 Registry 取回注册的实例 | **是** |
| `createStoreToken(name)` / `StoreRegistry` / `createStoreRegistry()` | `debugName: string` / —（类，非函数） / `runtime?: IRuntime` | 同步 / — / 同步 | 手动构造作用域化容器（Provider 之外，比如 SSR 请求作用域） | — |
| `useStoreConfig()` / `useStoreFeature(path)` / `useAssertStoreFeature(path)` | 无 / `path: 'wasm' \| \`experimental.${string}\`` / `path: 'wasm' \| \`experimental.${string}\``；`apiName?: string` | 同步 | 读取/断言 Provider 的 feature 配置 | 否（无 Provider 时分别返回 `null`/`false`/抛错） |

## 8. 注意事项（最容易踩的坑）

1. **`config.ready` 只在挂载时读取一次**。之后每次渲染传入新的数组/工厂身份，会在开发环境打印警告（生产环境是 `console.error`），并且**新值会被忽略，继续使用挂载时的旧屏障**——务必用 `useMemo`/模块级常量稳住它的元素身份。
2. **`features.wasm: true` 但 `ready` 为空会立刻触发一个本地报错屏障**，提示你去接 `@migaia/store-wasm` 的 `ensureWasm`，避免"开了开关却没人 init"的静默错误。
3. **Registry 释放不等于 Runtime 释放**。`StoreProvider` 默认只释放它自己创建/持有的 `StoreRegistry`（清理其中的 atomStore 与已注册的 owned 实例），传进来的外部 `runtime` prop 本身的生命周期永远由调用方负责。
4. **`useAtomDefinition`/`useSetAtomDefinition`/`useStoreFromProvider` 等必须有 `StoreProvider`**，没有会直接抛 `[store] hook requires a StoreProvider`；`useAtomValue`/`useSetAtom` 则容忍缺失 Provider，退化为直接订阅 atom 自身。
5. **render 阶段不要写状态**，`useStore`/`useSignal` 等的写操作（Action、`signal.value =`、`store.field =`）只应该出现在事件回调或 effect 里。
6. **selector/equality/atom 引用要稳定**，不要在组件 render 里 `new` 一个 Store/Signal/Resource；它们应该来自模块作用域、`useMemo`，或者 Provider 注入。

## 9. 深入参考

`StoreProvider` 的完整 props 与所有权规则、`StoreRegistry` 的注册/释放协议、Atom 定义系统（`atomDef`/`derivedDef`/`writableDef`/`familyDef`/optics）在 React 层的具体接入方式、Feature flag 与就绪屏障的精确语义、StrictMode 下的候选 Registry 回收机制、以及贴近生产的完整示例，见 **[USEGUIDE.md](./USEGUIDE.md)**。
