# @migaia/reactive

**与 UI 框架、宿主环境无关的响应式内核**：`Signal`（可写值）、`Computed`（惰性派生值）、`Effect`（副作用）三个基础节点，加一个提供隔离依赖图与调度器的 `Runtime`。

## 1. 这是什么

如果把响应式状态管理拆成两层——"图怎么建、什么时候该重算、副作用什么时候该跑"是**引擎层**，"用 Map/Set 建模集合、给异步请求做状态机、跟某个 UI 框架的渲染时机对齐"是**应用层**——`@migaia/reactive` 只做引擎层。它不认识 React、不认识 DOM、不内置集合类型或异步资源状态机，只提供三个最小节点原语和一个把它们粘在一起的 `Runtime`：写一个 `Signal`，读它的 `Computed` 会被标记为"可能过期"，订阅了这个 `Computed` 的 `Effect` 会在下一次调度里重新跑一遍。

可以把 `Runtime` 类比成一个**独立的电子表格计算引擎实例**：`Signal` 是输入单元格，`Computed` 是带公式的单元格（只有被别的单元格引用时才会重算），`Effect` 是"某个单元格变了就打印/发请求"这类订阅动作。这个 monorepo 里的 `store-*` 系列包（集合、持久化、React 绑定等）都是在这个引擎之上搭建的上层能力。

## 2. 适合什么场景

| 场景 | 说明 |
| --- | --- |
| 自己搭建状态管理/Store 库 | 需要精确控制批处理、调度时机、依赖追踪细节，而不是套用某个框架自带的响应式实现 |
| 同一进程需要多个互不干扰的响应式图 | 每个 `Runtime` 完全隔离：SSR 每请求一个、单测每个用例一个、多个 Worker 各一个，互不污染 |
| 需要给响应式变化接可观测性 | `subscribeTrace` 提供只读事件流（节点创建、依赖连接、副作用执行），可以做 devtools 而不侵入核心逻辑 |
| 需要把响应式图接到某个 UI 框架 | 三段式 `capture`/`commit` 绑定原语（见 USEGUIDE）支持并发渲染安全的适配层实现 |

不适合的场景：只是想要组件内部的局部状态（等价于 `useState`），不需要跨组件共享的响应式图；需要开箱即用的可观察集合、异步资源状态机——这些是 monorepo 里其它包（如集合、resource 包）在本包之上构建的**上层能力**，`@migaia/reactive` 本身不提供。

## 3. 用了之后能得到什么

- **完全隔离的 Runtime**：不同 `Runtime` 的节点分属不同依赖图和版本时钟，混用会立即抛错，不会有全局单例串状态的问题。
- **惰性 + 缓存的 Computed**：没有订阅者时不计算；多个下游共享同一个上游变化（diamond 依赖）只重算一次；没人观察的 `Computed` 会在空闲时自动挂起（断开依赖、释放订阅），无需手动管理。
- **显式生命周期**：`Signal`/`Computed`/`Effect` 都要 `dispose()`；`Scope` 提供集中持有与一次性释放。读取已释放节点会立刻抛出明确错误，不会静默返回陈旧值。
- **可控的调度**：默认微任务合并触发；可用 `setSchedulerStrategy` 换成 `requestAnimationFrame`/`idle`/自定义策略；`batch()` 显式合并多次写入为一次副作用刷新；`flush()` 手动同步冲刷。
- **失控保护**：自触发无限循环会在超过 `maxFlushPasses`（默认 100 轮）后抛错并如实报告被丢弃了哪些待办，而不是让标签页卡死。
- **诊断即观测，不侵入业务**：trace 事件、错误上报都走独立通道，不会成为业务状态的一部分。

## 4. 安装

```bash
pnpm add @migaia/reactive
```

## 5. 五分钟上手

```ts
import { Computed, Effect, Signal, createRuntime } from '@migaia/reactive';

const runtime = createRuntime();

const count = new Signal(1, runtime);
const doubled = new Computed(() => count.value * 2, runtime);

const seen: number[] = [];
const effect = new Effect(() => {
  seen.push(doubled.value);
}, runtime); // 构造时立即同步跑一次：seen = [2]

count.value = 3;
runtime.flush(); // 手动冲刷待处理的副作用：seen = [2, 6]

effect.dispose();
doubled.dispose();
count.dispose();
```

不想自己管理 `Runtime` 生命周期时，可以用内置的全局单例 `defaultRuntime`（进程级共享，测试/SSR/Worker 场景不建议用它，见下方注意事项）。

## 6. 核心概念速览

| 概念 | 一句话 |
| --- | --- |
| `Runtime` | 一套独立的依赖图 + 版本时钟 + 调度器；节点必须属于同一个 `Runtime` 才能互相依赖 |
| `Signal` | 可写的响应式原子值 |
| `Computed` | 惰性求值、带缓存的派生值 |
| `Effect` | 读取依赖并执行副作用；依赖变化后被调度重跑；构造时立即跑一次 |
| `Scope` | 集中持有一组 `disposable` 资源，一次 `dispose()` 按后进先出顺序全部释放 |
| `batch()` / `flush()` | 把多次写入合并成一次副作用刷新 / 手动立即触发一次冲刷 |
| trace | 只读诊断事件流：节点创建、依赖连接/断开、副作用执行、显式 action，不影响业务状态 |

## 7. 包内入口一览

| 入口 | 提供什么 | 适用人群 |
| --- | --- | --- |
| `@migaia/reactive`（主入口） | `Signal`/`Computed`/`Effect`/`createRuntime`/`defaultRuntime` 及全部公共类型 | 日常使用，绝大多数场景只需要这一个入口 |
| `@migaia/reactive/runtime` | `createObserverBinding` 等面向框架适配层的并发安全绑定原语 | 自己实现 React/Vue/Solid 一类响应式绑定的作者 |
| `@migaia/reactive/runtime/*` | 更细粒度的扩展入口（自定义 Source、内部 Runtime 视图、多副本自检等） | 在本包之上构建 Store/集合/资源类库的作者 |

## 8. 最容易踩的坑

1. **不要跨 `Runtime` 混用节点**——一个 `Runtime` 创建的 `Signal` 被另一个 `Runtime` 的 `Computed`/`Effect` 读取会直接抛错。
2. **`Signal`/`Computed`/`Effect` 构造参数顺序是"先业务参数、后 `runtime`"**：`new Signal(value, runtime, options?)`、`new Computed(fn, runtime, config?)`、`new Effect(fn, runtime, options?)`。
3. **`new Effect(...)` 构造时会同步立即执行一次**，不是等到依赖变化才第一次运行。
4. **`Signal.value = 相同值`（`Object.is` 判定）不会触发任何通知**，也不会推进版本号。
5. **没有订阅者的 `Computed` 会被自动挂起**（断开依赖、下次读取重新计算），需要"即使暂时没人订阅也保持热态"时传 `{ keepAlive: true }`。
6. **`dispose()` 之后的节点读取会立刻抛错**，不会静默返回旧值——这是有意设计，避免"看起来能用但永不更新"的幽灵状态。
7. **`defaultRuntime` 是进程级单例**，请求隔离（SSR）、单测互不污染、Worker 独立场景都应该显式 `createRuntime()`。

更完整的 API 参考、生命周期细节、错误处理与调度语义、扩展 API 说明见 **[USEGUIDE.md](./USEGUIDE.md)**。
