# @migaia/store-keyed

[English](./README.en.md)

服务端每个请求、每个测试用例、每个对话窗口，都需要同一套状态的独立副本；放在模块变量里的状态却被所有人共用。`@migaia/store-keyed` 把“状态是什么”（定义）和“值放在哪里”（store）分开：定义写在模块顶层，不保存值；每个 `createAtomStore` 为这些定义各保存一份值。它还能把大对象拆到字段、把列表拆到每一项分别订阅，并按 id 产出定义。它建立在 `@migaia/reactive` 之上，不依赖 React 或 DOM。

## 你可能遇到过

- **请求或测试之间串状态**：服务端一个请求的购物车出现在另一个请求里，上一个测试留下的数据弄坏了下一个。根因是状态放在模块级变量里，被所有导入方共用。
- **改一个字段，整个对象的读取方都重新渲染**：资料对象里在线状态一变，只显示名字的组件也重新渲染。根因是订阅的粒度是整个对象。
- **改一行，整个列表都重新渲染**：勾选一条待办，每一行都重新渲染。根因是每一行读的都是同一个数组，而数组每次修改都会被替换。
- **按 id 保存的状态越来越多**：手写的 `Map<chatId, state>` 只增不减，同一个 id 还可能建出两份状态。根因是按 key 缓存需要保证同一性、容量和清理，手写很难都顾到。
- **测试要替换依赖，只能改被测代码**：价格依赖当前时间，想测夜间折扣只能等到晚上或改成注入参数。根因是被测代码直接引用了具体实现。

## 为什么选它

- **定义和值分开。** 常见做法把状态包进工厂再到处传实例；这里定义放在模块顶层，每个 store 为它保存一份值，对象和数组初值在每个 store 里各复制一份。[示例](./USEGUIDE.md#一份定义每个请求或测试各有一份值)
- **字段级订阅。** `focusDef` 只在这个字段变化时通知读取方，写入时自动生成替换了该字段的新对象，不用手写不可变更新。[示例](./USEGUIDE.md#只订阅大对象里的一个字段)
- **列表项级订阅。** `splitDef` 按 key 把列表拆成逐项定义，改一项只通知这一项；读写已经删除的 key 会报错，而不是返回过期数据。[示例](./USEGUIDE.md#改一行不让整个列表重新渲染)
- **按 id 的定义稳定且有上限。** `familyDef` 对同一个 key 永远返回同一个定义，缓存有 `maxSize`，可以显式 `forget`。[示例](./USEGUIDE.md#每个对话一份状态不用手写-map)
- **测试替身不改被测代码。** `store.override()` 只在一个 store 里替换某个定义，撤销后状态原样保留，并检查替换前后写入方式一致。[示例](./USEGUIDE.md#测试时替换一个依赖不用改被测代码)

## 从这里开始

下面模拟服务端：两个请求用同一份购物车定义，各自创建 store。用 Node 24 直接运行。

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { atomDef, createAtomStore, derivedDef } from '@migaia/store-keyed'

// 定义只写一次，放在模块顶层；它不保存任何值
const cartDef = atomDef({ items: [] as string[] }, 'cart')
const countDef = derivedDef((get) => get(cartDef).items.length, 'count')

// 服务端每个请求（或每个测试用例）创建自己的 store，各自持有一份值
function handleRequest(user: string, items: string[]) {
  const store = createAtomStore(createRuntime())
  for (const item of items) store.set(cartDef, (cart) => ({ items: [...cart.items, item] }))
  console.log(`${user} 的购物车：${store.get(countDef)} 件`)
  store.dispose()
}

handleRequest('Ada', ['键盘', '鼠标'])
handleRequest('Grace', ['显示器'])

// 对象初值在每个 store 里各复制一份，原地修改也不会影响别的 store
const a = createAtomStore(createRuntime())
const b = createAtomStore(createRuntime())
a.get(cartDef).items.push('误改')
console.log(`另一个 store 的初值：${JSON.stringify(b.get(cartDef))}`)
a.dispose()
b.dispose()
```

输出：

```text
Ada 的购物车：2 件
Grace 的购物车：1 件
另一个 store 的初值：{"items":[]}
```

两个请求用的是同一份定义，但各自的 store 保存各自的值；在一个 store 里原地修改初值对象，也不会影响另一个。

下一步：更多用法看 [USEGUIDE 的“按场景查找”](./USEGUIDE.md#按场景查找)；列表很长、只想让变化的那一行更新时，看 [改一行不让整个列表重新渲染](./USEGUIDE.md#改一行不让整个列表重新渲染)。

## 手写时的隐患

下面是常见的手写共享状态。它能跑，但有三个隐患（只用于说明，不必运行）：

```ts doc-test=check
type ITodo = { id: string; done: boolean }

// 隐患 1：模块级状态被所有请求和测试共用，一个请求写入的数据另一个请求也能读到
let todos: ITodo[] = []
const listeners = new Set<() => void>()

function toggle(id: string) {
  todos = todos.map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo))
  // 隐患 2：改一项就通知所有监听者，每一行都要重新渲染
  listeners.forEach((listener) => listener())
}

// 隐患 3：按对话 id 缓存状态的 Map 只增不减，没人记得删除条目
const drafts = new Map<string, string>()
drafts.set('产品群', '明天发版')
toggle('t1')
```

用 store-keyed 时，定义不保存值，每个请求或测试用自己的 store；`splitDef` 让每一行只订阅自己那一项；`familyDef` 按 key 产出定义，有容量上限并可以显式删除。

## 三分钟心智模型

可以把定义想成“变量声明”，把 store 想成“一块内存”：同一个声明在每块内存里各有一份值。

| 概念 | 一句话 |
| --- | --- |
| 定义（`atomDef` / `derivedDef` / `writableDef`） | 冻结的描述对象，说明状态的初值或计算方式；不保存值，可以放在模块顶层 |
| store（`createAtomStore`） | 为定义保存值的作用域；第一次读取某个定义时才为它建一个响应式节点 |
| 读取 | `get` 登记依赖，`peek` 不登记，`preview` 供 React 并发渲染做推测读取 |
| optics（`focusDef` / `splitDef` / `selectDef` / `opticDef`） | 从一个定义派生出指向字段、列表项或投影的新定义 |
| family（`familyDef` / `derivedFamilyDef`） | 按 key 产出定义；同一个 key 得到同一个定义 |
| `override` | 在一个 store 里把对某个定义的读取转到另一个定义 |

几个说法：

- **释放的单位是整个 store。** store 持有它建出的每一个节点，`dispose()` 时按逆序全部释放；只想提前释放某一个，用 `release(definition)`。
- **定义可以跨 store 共用，节点不能。** 同一个定义在两个 store 里是两个独立的节点。
- **同步初值。** 初值和工厂函数不能返回 Promise；异步数据交给 `@migaia/resource`。

## 典型场景

| 场景 | 怎么组合 | 详细说明 |
| --- | --- | --- |
| 服务端渲染、测试隔离 | 模块级定义 + 每个请求或用例一个 `createAtomStore` | [USEGUIDE](./USEGUIDE.md#一份定义每个请求或测试各有一份值) |
| 大对象的字段级订阅 | `focusDef`，只读投影用 `selectDef` | [USEGUIDE](./USEGUIDE.md#只订阅大对象里的一个字段) |
| 长列表只更新变化的一行 | `splitDef` + `of(key)` | [USEGUIDE](./USEGUIDE.md#改一行不让整个列表重新渲染) |
| 每个对话、频道一份状态 | `familyDef` / `derivedFamilyDef` | [USEGUIDE](./USEGUIDE.md#每个对话一份状态不用手写-map) |
| 测试替换依赖 | `store.override()` | [USEGUIDE](./USEGUIDE.md#测试时替换一个依赖不用改被测代码) |

## 安装

```bash
pnpm add @migaia/store-keyed @migaia/reactive
```

| 入口 | 内容 |
| --- | --- |
| `@migaia/store-keyed` | 定义构造器、`createAtomStore` / `defaultAtomStore`、`selectDef` / `opticDef` / `focusDef` / `splitDef`、family、错误工具 |
| `@migaia/store-keyed/atom/store` | store 的窄入口，和根入口的对应导出相同 |
| `@migaia/store-keyed/atom/definition` | 定义的窄入口，另外导出 `assertNotThenable` |
| `@migaia/store-keyed/optics` | 手写自定义 optics 用的纯函数：路径读写、按 key 查找、不可变插入删除、`KeyedSplitCache` |
| `@migaia/store-keyed/reactive/atom` | 实例式 atom 的协议类型和跨 Runtime 校验（`atomGetter` / `atomSetter`） |

## 常用 API

| API | 做什么 |
| --- | --- |
| `atomDef(init)` / `derivedDef(read)` / `writableDef(read, write)` | 定义源状态、只读派生和可写派生 |
| `createAtomStore(runtime)` | 创建一个独立保存值的 store |
| `store.get` / `store.set` / `store.sub` | 读取（登记依赖）、写入、订阅 |
| `focusDef(def, ...path)` / `splitDef(def, keyOf)` | 字段级定义 / 列表按 key 拆分 |
| `familyDef(initial, options?)` | 按 key 产出定义 |
| `store.override(def, replacement)` / `store.dispose()` | 替换定义 / 释放整个 store |

## 契约细节

全部签名、边界行为与错误码见 [USEGUIDE.md](./USEGUIDE.md)。下面是使用时最需要记住的约束。

1. **`get` 登记依赖，`peek` / `preview` 不登记。** React 适配层的快照读取必须用 `peek` 或 `preview`。
2. **`set` 只接受可写定义**（`atomDef`、`atomDefFactory`、`writableDef` 及其 optics）。对只读派生写入抛 `TypeError`，经过 `override` 间接指向只读定义时也一样。`set` 在一个批次里执行，不会被外层的追踪记成依赖。
3. **`override` 必须保持写入方式。** 只读定义可以换成任何同值类型的定义；源定义只能换成源定义；可写派生只能换成参数和返回值相同的可写派生。override 链成环抛 `CYCLIC_OVERRIDE`。
4. **对象初值按 store 复制。** 复制用 `structuredClone`，值不可克隆（例如含函数）时抛 `INVALID_OPTION`，宿主缺少 `structuredClone` 时抛 `ENV_UNSUPPORTED`。
5. **`preview` 不执行未声明安全的工厂。** `atomDefFactory` 的工厂在 `preview` 里会抛 `PREVIEW_UNSAFE`；确认工厂纯、无副作用后改用 `previewSafeAtomDefFactory`。推测出的值在 Runtime 空闲清理（默认微任务）后，若始终没有变成真实节点就丢弃。
6. **`dispose()` 的顺序。** 先标记为已释放，再取消全部订阅，再按建出的逆序释放节点；单个失败不阻断其余步骤，多个失败合并成 `AggregateError`（`DISPOSAL_FAILED`）。释放后的任何访问抛 `ATOM_STORE_DISPOSED`。
7. **缓存清理和节点释放是两回事。** `splitDef(...).prune(store)`、`familyDef(...).forget()` / `clear()` 只清理定义的缓存，不释放 store 里已建的节点；节点用 `store.release()` 或 `store.dispose()` 释放。`forget` 之后同一个 key 会得到新定义，旧定义的状态与新定义互不相通。
8. **family 需要 `WeakRef` 和 `FinalizationRegistry`。** 宿主缺少它们时，调用 `familyDef` / `derivedFamilyDef` 就抛 `ENV_UNSUPPORTED`，不会悄悄退化。
9. **key 比较用 SameValueZero**，和 `Map` / `Set` 一致：`-0` 与 `+0` 是同一个 key，`NaN` 等于自身。
10. **错误身份。** 本包产生的错误带 `source === STORE_KEYED_SOURCE`（`@migaia/store-keyed`）和 `StoreKeyedErrorCode` 里的 `code`；其他包已有身份的错误保持原样。按 `source` / `code` 判断，不要比较 message。

**破坏性迁移**：十个高级 optics 原语只从 `@migaia/store-keyed/optics` 导出，`assertNotThenable` 只从 `@migaia/store-keyed/atom/definition` 导出，根入口不保留兼容别名。

**不适合的场景**：整个应用只有一份全局状态、永远不需要多个作用域时，直接用 `runtime.signal()` / `runtime.computed()` 更简单；需要 Provider 和 Hook 时用 `@migaia/store-react`。
