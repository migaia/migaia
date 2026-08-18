# @migaia/store-devtools

**`@migaia/store-light` 的本地诊断工具**——给一个响应式 Store 接上"状态历史 + 时间旅行 + action 追踪 + 依赖关系图"，回答"这个值为什么变了""哪次 action 报错了""能不能退回到变更前"这类开发期问题。

## 1. 这是什么

可以把它类比成"给你的 Store 装一个本地黑匣子"：不改动 Store 本身的任何行为，只是订阅它已有的通知机制（`$subscribe`、`$runtime.subscribeTrace`），把每次状态变化、每次 action 执行、每条 runtime trace 事件记下来,并提供两个独立的静态分析函数,把响应式依赖图渲染成可读的树。它**不是**浏览器扩展、不是远端监控、也不提供生产环境审计能力——纯粹是开发期的本地诊断记录器。

## 2. 适合 / 不适合

| 场景 | 说明 |
| --- | --- |
| 排查"这个字段为什么变了" | `history` 保存每次通知后的 `$plain()` 快照，配合 `jumpTo()` 可以退回任意一个历史点重新观察 |
| 排查"哪个 action 报错了 / 耗时多久" | Store 方法自动被 runtime 追踪为 action；`actions` 记录名称、耗时、错误 |
| 排查"这个 Effect 到底依赖了哪些节点" | `getDependencyTree(observer)` 把依赖图渲染成普通对象树，可直接喂给调试面板 |
| 排查"这个 Signal 变了会通知谁" | `getObserverTree(observable)` 是反方向的遍历 |
| 生产环境状态审计 / 持久化 | 不适合——历史只在内存里，只保存 `$plain()` 标量字段，`jumpTo()` 不是事务回滚 |
| 需要浏览器 DevTools 扩展协议 | 不适合——那是 `@migaia/store-middleware` 的 `connectDevTools()`，本包不实现该协议 |

## 3. 用了能得到什么

- **状态历史与时间旅行**：`createStoreDevTools(store)` 自动记录每次 Store 通知后的快照,`jumpTo(id)` 通过 `store.$hydrate()` 把状态退回到某个历史点。
- **action 追踪几乎零配置**：Store 上定义的方法本来就会被 runtime 自动包装成具名 action（`<debugName>.<方法名>`),只要不关闭 `captureRuntimeTrace`,`recordAction` 就会被自动调用,`actions` 里能看到名称/耗时/错误,不需要手动埋点。
- **依赖图两个方向都能看**：`getDependencyTree` 从观察者往上看依赖了什么,`getObserverTree` 从数据源往下看谁在订阅,都会正确标出循环引用而不是无限递归。
- **诊断故障不牵连业务**：内部记录快照/克隆失败时,通过 `store.$runtime.reportError()` 上报,不会让业务的一次普通赋值跟着抛错。
- **可控的内存占用**：`maxHistory`、`maxTrace` 限制各队列长度,超限后自动丢弃最旧的条目。

## 4. 安装

```bash
pnpm add @migaia/store-devtools
```

`store` 依赖 `@migaia/store-light`（对等依赖，需要一个已创建的 `IReactiveStore` 实例）。

## 5. 最小示例

```ts
import { createStoreDevTools } from '@migaia/store-devtools';

const tools = createStoreDevTools(store, { maxHistory: 200 });

store.increment(); // Store 自己定义的方法，被 runtime 自动追踪为一次 action

console.log(tools.history); // [{ id: 1, label: 'initial', state: {...} }, { id: 2, ... }]
console.log(tools.actions); // [{ name: 'store.increment', durationMs, error }]

tools.jumpTo(tools.history[0].id); // 用该快照调用 store.$hydrate()，状态退回初始值
tools.dispose(); // 用完必须调用，取消对 Store 的订阅
```

依赖图排查用两个独立的函数，不依赖 `createStoreDevTools`：

```ts
import { getDependencyTree, getObserverTree } from '@migaia/store-devtools';

console.log(getDependencyTree(someEffect)); // 这个 Effect/Computed 依赖了哪些节点
console.log(getObserverTree(someSignal)); // 这个 Signal 会通知哪些订阅者
```

## 6. 核心概念与公开 API 速览

| 概念 | 是什么 |
| --- | --- |
| **History（历史）** | 每次 Store 通知（或手动 `record()`）产生的一份 `IStoreHistoryEntry`（`id`/`timestamp`/`label`/`state`），`state` 是 `store.$plain()` 的克隆快照 |
| **Action trace（action 追踪）** | Store 自己方法的调用记录（`IActionTrace`）,由 runtime 的 `subscribeTrace` 自动喂入,也可以用 `recordAction()` 手动记 |
| **Runtime trace（运行时事件）** | `@migaia/reactive` runtime 广播的原始事件流（依赖建立/断开、observer 运行、action 起止）,`trace` 数组原样保存 |
| **Dependency tree（依赖树）** | `getDependencyTree`/`getObserverTree` 返回的普通对象树,`kind`（observable/observer）、`label`、`version`、`children`、`circular` |
| **ClonePolicy** | 快照克隆策略,默认用 `@migaia/store-middleware` 的 `ClonePolicy.diagnostic`（尽力克隆、遇到不可克隆值不抛错） |

## 7. 生命周期、错误与边界（详细原因见 USEGUIDE）

1. `history` 只保存 `$plain()` 的标量字段——computed、方法、WASM 字段和外部资源不会被记录，也不会被 `jumpTo()` 恢复。
2. `jumpTo()` 不是事务回滚，不能撤销网络请求、日志或已经发出的副作用。
3. `actions` 数组和 `maxTrace` 无关，它复用的是 `maxHistory` 这个上限。
4. 只有 Store **自己定义的方法**会被 runtime 自动记为 action；`$batch`/`$set`/`$hydrate` 这类底层写入不会自动出现在 `actions` 里。
5. 用完必须调用 `dispose()`，否则 Store 的订阅和 runtime trace 监听器不会被释放。
6. 敏感字段不要留在 `$plain()` 里，或者通过 `clone` 选项自行脱敏。

包边界抛出的错误保留原生 `Error`/`RangeError` 类型，并带有
`source: '@migaia/store-devtools'` 与稳定 `code`；`dispose()` 后的变更方法会以
`SESSION_DISPOSED` 失败，历史/trace 只读数组仍可检查。

## 8. 深入参考

完整的配置项、返回值字段、`jumpTo`/`clear`/`dispose` 的精确语义、依赖树遍历的循环判定规则、以及和 `ClonePolicy` 的取舍细节，见 **[USEGUIDE.md](./USEGUIDE.md)**。
