# @migaia/reactive

[English](./README.en.md)

界面上的合计、筛选结果、徽标数字都是由其他数据推导出来的。手动在每个修改点同步它们，迟早会漏掉一处；每次写入都立刻通知，又会让页面闪过一半新一半旧的值。`@migaia/reactive` 用 Signal（可写的值）、Computed（自动推导的值）和 Effect（值变化后要做的事）记录谁依赖谁，值变了只更新真正受影响的部分。它与 UI 框架和宿主环境无关，浏览器、Node、Worker 里都能用；store 系列包（集合、持久化、React 绑定等）都建立在它之上。

## 你可能遇到过

- **派生值漏更新**：合计、筛选结果单独存在变量里，每个修改点都要记得重算，漏掉一处页面就显示旧值。根因是依赖关系靠人记，没有被程序记录下来。
- **页面闪过一半新一半旧的值**：同时改名和姓，页头先显示 “Grace Lovelace”，再显示正确的名字。根因是每次写入都立刻通知监听者，监听者读到的是只改了一半的数据。
- **旧订阅没有取消**：切换聊天房间后还在接收旧房间的消息，内存慢慢上涨。根因是订阅的清理散落在各处，靠人记得调用。
- **标签页卡死**：两个副作用互相写对方读取的值，值始终对不上，就一直互相触发。根因是没有任何东西限制一次更新能连锁多少轮。
- **服务端渲染串数据**：状态放在模块级的全局变量里，一个请求写入的值被另一个请求读到。根因是所有请求共用了同一份状态图。

## 为什么选它

- **派生值只声明一次，依赖自动登记。** 手写时每个修改点都要记得重算；`computed` 在读取 `price.value` 时就记下了依赖，任何一个输入变化都会让它重算。[示例](./USEGUIDE.md#派生值自动更新)
- **多次写入只更新一次，看不到一半新一半旧的值。** 每次写入都立刻通知会渲染出混合值；Runtime 写入时只标记过期，副作用在下一次冲刷时按最终输入运行，从多条路径读取同一组值的派生值也一致。[示例](./USEGUIDE.md#多次写入只更新一次)
- **没人读取的派生值不计算。** 关着的面板也在重算是常见的浪费；`computed` 没人读取就不运行，最后一个读者离开后自动和输入断开，下次读取时才按需重算。[示例](./USEGUIDE.md#没人读取的派生值不计算)
- **副作用死循环会被截断，而不是卡死页面。** 互相触发的副作用可能无限运行；每次冲刷最多 `maxFlushPasses` 轮（默认 100），超过后停止并报告 `FLUSH_LOOP` 和相关的 `debugName`。[示例](./USEGUIDE.md#副作用互相触发时不会卡死)
- **每个 Runtime 完全隔离，混用会立刻报错。** 全局状态在服务端请求之间串用很难发现；不同 Runtime 的节点不能互相依赖，跨 Runtime 读取立刻抛 `CROSS_RUNTIME`。[示例](./USEGUIDE.md#服务端每个请求一个-runtime)

## 从这里开始

下面用购物车演示：合计由商品和折扣推导出来，两者都变了也只更新一次。用 Node 24 直接运行。

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()
const items = runtime.signal([{ name: '键盘', price: 300 }])
const discount = runtime.signal(0)
// 合计从商品和折扣推导出来，任何一个变了都会自动重算
const total = runtime.computed(
  () => items.value.reduce((sum, item) => sum + item.price, 0) * (1 - discount.value)
)

const badge = runtime.effect(() => console.log(`合计 ${total.value} 元`))

items.value = [...items.peek(), { name: '鼠标', price: 100 }]
discount.value = 0.1
await Promise.resolve() // 两次修改在下一个微任务里合并成一次更新
badge.dispose()
```

输出：

```text
合计 300 元
合计 360 元
```

`effect` 创建时立即运行一次，输出 300。之后的两次修改不会各自触发一次输出，而是在下一个微任务里合并成一次，直接得到 360（(300 + 100) × 0.9）。`total` 读了 `items.value` 和 `discount.value`，依赖就自动登记了，不需要另写订阅代码。

下一步：派生值和副作用的更多用法看 [USEGUIDE 的“按场景查找”](./USEGUIDE.md#按场景查找)；服务端渲染、测试要隔离状态时看 [服务端每个请求一个 Runtime](./USEGUIDE.md#服务端每个请求一个-runtime)。

## 手写时的隐患

下面是常见的手写“值变了就通知”。它能跑，但有三个隐患（只用于说明，不必运行）：

```ts doc-test=check
let price = 30
let quantity = 2
let total = price * quantity
const listeners = new Set<() => void>()

function setQuantity(next: number) {
  quantity = next
  // 隐患 1：每个修改点都要记得重算派生值；setPrice 里漏写这一行，页面就显示旧合计
  total = price * quantity
  // 隐患 2：每次写入都立刻通知，连续改两个值会渲染两次，第一次是一半新一半旧的结果
  listeners.forEach((listener) => listener())
}

// 隐患 3：订阅要手动取消；组件卸载时忘了 delete，监听器和它引用的对象一直留在内存里
listeners.add(() => console.log(total))
```

用 Runtime 时，`computed` 只声明一次推导规则，依赖在读取时自动登记；写入只把下游标记为过期，副作用在下一次冲刷时统一运行；副作用返回的清理函数会在重跑前和 `dispose()` 时自动执行。

## 三分钟心智模型

可以把一个 `Runtime` 想成一个独立的电子表格：`Signal` 是输入单元格，`Computed` 是带公式的单元格，`Effect` 是“某个单元格变了就打印或发请求”这类动作。

| 概念 | 一句话 |
| --- | --- |
| `Runtime` | 一套独立的依赖图、版本时钟和调度器；节点必须属于同一个 `Runtime` 才能互相依赖 |
| `Signal` | 可写的值，读 `.value` 会登记依赖，写 `.value` 会通知下游 |
| `Computed` | 惰性计算、带缓存的派生值，只在被读取时按需重算 |
| `Effect` | 读取依赖并执行副作用；创建时立即运行一次，依赖变化后被安排重跑 |
| `batch()` / `flush()` | 把多次写入合并成一次副作用刷新 / 立即同步冲刷待运行的副作用 |
| trace | 只读诊断事件：值变化、依赖连接和断开、副作用执行，不影响业务状态 |

几个说法：

- **依赖追踪**：`Computed` 或 `Effect` 运行时读了哪些 `Signal` / `Computed`，就自动依赖哪些。
- **冲刷（flush）**：真正运行排队中的副作用。默认在写入后的下一个微任务自动进行。
- **挂起**：没有读者的 `Computed` 断开和输入的连接，不再随写入重算；下次读取时先检查输入，变了才重算。

## 典型场景

| 场景 | 怎么组合 | 详细说明 |
| --- | --- | --- |
| 派生值随输入自动更新 | `runtime.computed` + `runtime.effect` | [USEGUIDE](./USEGUIDE.md#派生值自动更新) |
| 切换房间、页面时清理旧订阅 | `effect` 返回清理函数 | [USEGUIDE](./USEGUIDE.md#切换订阅时先清理旧的) |
| 同时修改多个值 | 默认微任务合并，或 `runtime.batch` | [USEGUIDE](./USEGUIDE.md#多次写入只更新一次) |
| 关闭的面板不再重算 | `computed` 自动挂起，`keepAlive` 可关闭 | [USEGUIDE](./USEGUIDE.md#没人读取的派生值不计算) |
| 防止副作用死循环 | `maxFlushPasses` + `onError` | [USEGUIDE](./USEGUIDE.md#副作用互相触发时不会卡死) |
| 服务端渲染、测试隔离 | 每个请求或用例一个 `createRuntime()` | [USEGUIDE](./USEGUIDE.md#服务端每个请求一个-runtime) |

## 安装

```bash
pnpm add @migaia/reactive
```

| 入口 | 内容 |
| --- | --- |
| `@migaia/reactive` | `createRuntime`、`defaultRuntime`、节点类型 `IReactiveSignal` / `IReactiveComputed` / `IReactiveEffect`、诊断常量与错误码 |
| `@migaia/reactive/extension` | 给 store、集合、资源和 UI 框架适配层用的扩展能力：所有权登记、自定义数据源、observer binding、只读的版本查询 |

## 常用 API

| API | 做什么 |
| --- | --- |
| `createRuntime(options?)` | 创建一个隔离的 Runtime；选项可设置调度方式、`maxFlushPasses`、`onError`、`onTrace` |
| `runtime.signal(value)` / `runtime.computed(fn)` / `runtime.effect(fn)` | 创建可写值、派生值和副作用；都有 `dispose()` |
| `runtime.batch(fn)` / `runtime.flush()` | 把多次写入合并成一次刷新 / 立即同步冲刷 |
| `runtime.untracked(fn)` | 在不登记依赖的情况下读取 |
| `runtime.subscribeTrace(listener)` | 订阅只读诊断事件 |
| `createObserverBinding`（`/extension`） | 写 UI 框架适配层：渲染期间采集依赖，提交后再订阅 |

## 契约细节

全部签名、边界行为与错误码见 [USEGUIDE.md](./USEGUIDE.md)。下面是使用时最需要记住的约束。

### 一张依赖图的完整生命周期

```ts
import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()

const count = runtime.signal(1)
const doubled = runtime.computed(() => count.value * 2)

const seen: number[] = []
const effect = runtime.effect(() => {
  seen.push(doubled.value)
}) // 创建时立即同步跑一次：seen = [2]

count.value = 3
runtime.flush() // 手动冲刷待处理的副作用：seen = [2, 6]

effect.dispose()
doubled.dispose()
count.dispose()
```

这段代码建立的是一张由当前 `runtime` 独占的依赖图。`runtime.effect()` 创建时会立即执行一次；执行过程中读取 `doubled.value`，使 `Effect → Computed → Signal` 三层依赖自动登记，所以 `seen` 首先得到 `2`。

`count.value = 3` 只会使 `doubled` 失效并把 `effect` 放入待执行队列，不会在 setter 内立刻重跑副作用。`runtime.flush()` 同步排空该 runtime 的队列：`doubled` 在被读取时按需重算为 `6`，随后 `effect` 把它写入 `seen`。生产代码通常让默认微任务自动冲刷；测试、服务端渲染或需要确定提交边界的代码才显式调用 `flush()`。

释放顺序按消费者到数据源执行：先停掉 `effect`，避免清理过程中再次观察数据；再释放派生节点 `doubled`；最后释放源节点 `count`。`dispose()` 断开依赖边并禁止继续读取已释放节点。`Runtime` 本身没有 `dispose()`；需要批量管理时，把这些节点交给 `@migaia/lifecycle` 的 `createLifecycleScope()` / `createSyncLifecycleScope()` 持有并统一释放。

### 生命周期、错误与边界

1. **不要跨 `Runtime` 混用节点**：一个 `Runtime` 创建的 `Signal` 被另一个 `Runtime` 的 `Computed` / `Effect` 读取会抛 `CROSS_RUNTIME`。
2. **统一经 Runtime 工厂创建节点**：`runtime.signal(value, options?)`、`runtime.computed(fn, config?)`、`runtime.effect(fn, options?)`，都有 `dispose()` / `disposed`。三个节点类是内部实现，不作为值导出。
3. **`runtime.effect(...)` 创建时会同步立即执行一次**，不是等到依赖变化才第一次运行。
4. **给 `Signal` 写入相同的值（`Object.is` 判定）不会触发任何通知**，也不会推进版本号。
5. **没有读者的 `Computed` 会被自动挂起**（断开依赖；下次读取先验证版本和拓扑，未变则复用缓存）。需要“暂时没人读也保持计算”时传 `{ keepAlive: true }`。
6. **`dispose()` 之后的读取会立刻抛 `NODE_DISPOSED`**，不会静默返回旧值，避免出现“看起来能用但永远不更新”的状态。
7. **`defaultRuntime` 是进程级单例**。服务端渲染的请求隔离、单测互不影响、Worker 独立运行，都应该显式调用 `createRuntime()`。
8. **调度可控**：默认在微任务里合并冲刷；创建 Runtime 时可用 `schedulerStrategy` 改为 `requestAnimationFrame`、空闲回调或自定义策略。
9. **诊断不进入业务状态**：trace 事件和错误上报走独立通道。

**不适合的场景**：只想要组件内部的局部状态（相当于 `useState`），不需要跨组件共享的依赖图；或者需要开箱即用的可观察集合、异步请求状态机。后两者由本仓的集合、resource 等包在本包之上提供，本包自身不包含。

通用的“一组资源集中释放”容器（原 `Scope` / `createScope()`）已移出本包，改用 `@migaia/lifecycle` 的 `createLifecycleScope()` / `createSyncLifecycleScope()`。

### 多份副本与扩展入口

扩展入口的 `claimOwnership`、`ownerOf`、`assertOwnedBy` 对普通对象和函数对象使用同一归属契约：已登记的函数可以查到原 Runtime，跨 Runtime 校验抛 `CROSS_RUNTIME`，另一模块副本的品牌抛 `COPY_CONFLICT`。

跨副本诊断使用 `@migaia/reactive.runtime-copies` 和 `@migaia/reactive.ownership-copy` 两个全局 Symbol key。升级时请让同一进程中的 reactive 副本保持同一版本：旧的 `@morning-watch/store` 命名空间与新版本互相不可见，混用时不会互相计数，也不会识别对方的归属标记。

`@migaia/reactive/extension` 提供 `getDefaultRuntime()`，给需要在导入时保持不创建任何东西的适配层使用。它在第一次调用时创建共享的默认 Runtime，返回的对象与根入口的 `defaultRuntime` 完全相同；导入根入口的 `defaultRuntime` 仍在导入时创建。`ReactiveErrorPhase` 也可以从扩展入口导入，与根入口导出的是同一个对象。

```ts
import { getDefaultRuntime } from '@migaia/reactive/extension'
const runtime = getDefaultRuntime()
const node = runtime.signal(1)
runtime.batch(() => {
  node.value = 2
})
console.log(node.value)
node.dispose()
```

`@migaia/reactive/extension` 的 `deferRuntimeCleanup(runtime, task)` 通过该 Runtime 的 `scheduleIdle` 通道安排一次同步的适配层清理（默认使用微任务）。清理抛出的错误交给 Runtime 的 `reportError`。它不返回可修改的调度器或依赖图能力，也不负责异步资源。

```ts
import { createRuntime } from '@migaia/reactive'
import { deferRuntimeCleanup } from '@migaia/reactive/extension'
const idle: Array<() => void> = []
const runtime = createRuntime({
  scheduleIdle: (task) => {
    idle.push(task)
  }
})
let released = false
deferRuntimeCleanup(runtime, () => {
  released = true
})
console.log(released) // false
idle.shift()?.()
console.log(released) // true
```
