# @migaia/store-middleware

**给 `@migaia/store-light` 装上"观察和约束"能力的中间件层**——它不改变 Store 本身怎么存数据，只负责回答三个问题：这次写入允不允许发生、状态改变前后是什么、出了错该怎么上报。可以把它类比成 Express 的 middleware 链，只不过流经的不是 HTTP 请求，而是 Store 的 action / state / error 事件。

## 1. 这是什么

`@migaia/store-light` 的 Store 本身很薄：存字段、通知订阅者。但生产应用几乎总会追问更多：哪个 action 改了状态、改之前改之后分别是什么、这次写入是不是发生在允许的地方、要不要把这些事件送到日志系统或 Redux DevTools。把这些能力直接塞进 Store 会让核心变臃肿，`@migaia/store-middleware` 就是把它们抽成独立一层——**它不重新发明一套插件系统**，而是继承 `@migaia/plugin-host` 的 `PluginHost`，中间件就是安装在这个 Host 上的插件。

## 2. 适合 / 不适合

| 场景 | 适合吗 |
| --- | --- |
| 需要知道"哪个 action 改了状态、耗时多久、有没有报错" | 适合——`action`/`state`/`error` 三类事件覆盖这些 |
| 需要禁止组件绕过 action 直接改字段（MobX 风格 strict mode） | 适合——`actions-only` 写入策略 |
| 需要接 Redux DevTools 或自定义调试面板 | 适合——内置 adapter + `connectDevTools()` |
| 需要日志、审计、指标等横切能力，且要能动态装卸 | 适合——中间件就是 `@migaia/plugin-host` 插件，装卸卸载、资源清理全部复用它的机制 |
| 只是想给单个 Store 加一个简单的 `console.log` | 可能杀鸡用牛刀——直接 `store.$subscribe()` 打日志更简单，不需要理解插件系统 |
| 需要状态持久化 / 时间旅行历史面板本体 | 不是这个包的职责，见 `@migaia/store-persist` / `@migaia/store-devtools` |

## 3. 核心卖点

- **三类领域事件**：`action`（start/end/error，带耗时）、`state`（previous/next 快照）、`error`（诊断错误），覆盖"谁改的、改成什么、错哪了"。
- **`actions-only` 写入策略**：与 `createStore({ mutationPolicy })` 联动后，禁止在 action 边界外直接写字段——需要共享同一个 `MutationPolicy` 实例，见下方踩坑清单。
- **一行接入已有 Store**：`bindStoreMiddleware(store)` 自动订阅 Store 的状态变化和 Runtime action trace，不用手写事件桥接代码。
- **DevTools 开箱即用**：`createReduxDevToolsAdapter()` + `host.connectDevTools()` 把事件转换成 Redux DevTools 协议，支持 `jump`/`reset`/`commit`。
- **中间件生命周期交给 `@migaia/plugin-host`**：安装失败自动回滚、卸载资源自动清理，这一层不用自己再写一遍。
- **三种"复制状态"的显式策略**（`ClonePolicy`）：需要真独立快照、零开销引用、还是尽力而为的诊断快照，各自命名清楚，不靠一个模糊的 `clone()` 猜你想要什么。

## 4. 安装

```bash
pnpm add @migaia/store-middleware
```

## 5. 快速开始

```ts
import { createStore } from '@migaia/store-light';
import {
  bindStoreMiddleware,
  createMutationPolicy,
  loggerMiddleware
} from '@migaia/store-middleware';

// 同一个 MutationPolicy 实例要同时交给 createStore 和 bindStoreMiddleware，
// 否则 actions-only 策略不会真正拦住 Store 的直接字段写入（见下方踩坑清单）。
const mutationPolicy = createMutationPolicy('actions-only');

const store = createStore(
  {
    count: 0,
    increment() {
      this.count++;
    }
  },
  { mutationPolicy }
);

const host = bindStoreMiddleware(store, { mutationPolicy });

await host.use(loggerMiddleware());

store.increment(); // 允许：在 action 内
// store.count = 1;  // 会抛错：actions-only 模式下不允许 action 外直接写

// 应用退出、组件卸载或请求结束时
await host.dispose();
```

`bindStoreMiddleware()` 只是监听 Store 的状态变化和 Runtime action trace，不接管 Store 或 Runtime 的所有权；`host.dispose()` 只释放这次绑定和已安装的中间件，Store 本身不受影响。

## 6. 概念速览

| 概念 | 一句话 |
| --- | --- |
| `IMiddlewareEvent<S>` | 流经中间件管线的领域事件，三种：`action`、`state`、`error` |
| `MutationPolicy` | 判断"这次写入允不允许发生"的写入策略，`off` 或 `actions-only` |
| `StoreMiddlewareHost<S>` | 承载中间件的 `PluginHost` 子类，暴露 `runAction`/`recordState`/`recordError`/`connectDevTools` |
| `IStoreMiddlewarePlugin<S>` | 新代码应该写的中间件插件形状，本质就是 `@migaia/plugin-host` 的 `IPlugin` |
| `IStoreMiddleware<S>` | 旧式 `(event, context, next) => void` 中间件函数形状，靠 `middlewarePlugin()` 适配成插件 |
| `ClonePolicy` | 三种复制状态快照的显式策略：`immutable`（真拷贝或抛错）、`opaque`（零拷贝引用）、`diagnostic`（尽力而为，不抛错） |

## 7. 模块一览

| 模块 | 提供什么 |
| --- | --- |
| `middleware.ts` | `MutationPolicy`、事件类型定义、Redux DevTools adapter |
| `store-middleware-host.ts` | `StoreMiddlewareHost`、`bindStoreMiddleware()`、`middlewarePlugin()`、`loggerMiddleware()` |
| `tolerant-clone.ts` | `ClonePolicy` 三个克隆函数，供自定义 `bindStoreMiddleware({ clone })` 或中间件内部使用 |

## 8. 踩坑清单

1. **`actions-only` 只在 `createStore` 和 `bindStoreMiddleware` 共享同一个 `MutationPolicy` 实例时才生效**——各自 `createMutationPolicy()` 出两个实例互不知道对方，策略形同虚设。
2. **`StoreMiddlewareHost` 的 pipeline 模式固定是 `sync`**，构造时传的 `pipeline.mode` 会被强制覆盖；中间件只能用 `core.usePipeline`，不能用 `useAsyncPipeline`/`useGeneratorPipeline`。
3. **`bindStoreMiddleware()` 已经在监听 Runtime action trace**，不要再用 `host.runAction()` 包一层同一个 Store 方法，否则同一个 action 会被记录两次。
4. **`getState()` 默认每次都做一次 `structuredClone`**——大状态树、高频事件下这是实打实的开销，需要时用 `options.clone` 换成 `ClonePolicy.opaque`/`ClonePolicy.diagnostic`。
5. **中间件抛错不会中断业务写入**，会被吞掉并通过 Runtime 上报；但 `runAction()` 包裹的业务函数本身抛错仍会正常向外传播。

更完整的 API 参考、写入策略的精确语义、DevTools 集成细节、错误处理边界，见 **[USEGUIDE.md](./USEGUIDE.md)**。

## 9. 包边界

`store-middleware` 只负责 Store 领域的事件语义和写入策略；通用插件生命周期、pipeline、配置和资源释放全部由 `@migaia/plugin-host` 提供。它不是 Store 本体，不提供持久化、React hooks 或网络传输——这些分别是 `@migaia/store-light`、`@migaia/store-persist` 和上层框架适配包的职责。
