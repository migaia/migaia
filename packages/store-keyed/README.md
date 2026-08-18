# @migaia/store-keyed

**定义化（definition-based）的键控状态层**——基于 [`@migaia/reactive`](../reactive) 的 Signal/Computed 内核，提供“先描述状态，再在某个作用域里落地”的一套原语：Atom 定义、`AtomStore`、definition 级 optics（投影/聚焦/按 key 拆分），以及按 key 产出定义的 family。

## 1. 这是什么

大多数 atom 状态库（Jotai 之类）里，`atom(0)` 既是"这是什么"的描述，也直接绑定了一份运行时状态——同一个 atom 对象在哪里用，状态就在哪里。这在单一全局 store 的场景下没问题，但一旦你需要**同一份状态定义在多个独立作用域下各自持有一份值**（每个 React Provider 一份、每个 SSR 请求一份、每个测试用例一份、每个 AI 对话一份），"atom 对象本身即状态"这个假设就会崩：要么全局单例互相污染，要么你得为每个作用域手写一遍状态。

`@migaia/store-keyed` 把这两件事拆开：

- **Definition（定义）**——纯数据，只说"这是什么"（初值/读函数/写函数），不 import 任何运行时内核，可以在模块顶层创建一次，然后到处复用。
- **AtomStore（实例化）**——把一批定义落到某个 `IRuntime` 上，回答"在我这个作用域里它现在是什么值"。同一个定义在两个不同的 `AtomStore` 里互不影响。

这个分层直接对应包名里的"keyed"：不是"key-value 数据库"意义上的 keyed store，而是"同一个定义 token，在不同作用域（key 可以是 Provider 实例、SSR 请求、测试用例）下各自持有独立状态"的意思；`familyDef`/`splitDef` 则是在这之上再加一层——按业务 key（对话 id、列表项 id）产出定义。

本包不依赖 React、不依赖 DOM，`@migaia/store-react` 在它之上构建了 Provider/Hook 适配层。

## 2. 适合什么场景

| 场景 | 说明 |
| --- | --- |
| 每个 React Provider / SSR 请求需要独立状态 | 定义只创建一次，`createAtomStore(runtime)` 在每个作用域各建一份实例，互不污染 |
| 按 key 产出状态（AI 对话、聊天频道、协作文档） | `familyDef(initial)` 把"这个 key 对应的定义"缓存起来，跨作用域仍是同一个 token，但每个作用域各有一份值 |
| 大对象里只关心某个字段，且要能单独订阅/单独写 | `focusDef`/`opticDef` 把嵌套字段投影成独立的可写定义，不用手写不可变更新样板代码 |
| 数组按 key 拆成可独立订阅/独立写的元素 | `splitDef` 把 `T[]` 拆成"按 key 稳定"的逐项可写定义，重排数组时未变化的元素仍是同一个订阅目标 |
| 测试里需要替换某个 atom 的实现 | `store.override(definition, replacement)` 运行期换路由，不用改被测代码引用的 token |

不适合的场景：如果整个应用只有一份全局状态、永远不需要多作用域隔离，直接用 `@migaia/reactive` 的 `Signal`/`Computed` 或更薄的 atom 库即可，不需要 definition/store 两层间接。

## 3. 用了之后能得到什么

- **定义可安全复用**：`atomDef`/`derivedDef` 产出的对象是 `Object.freeze` 过的纯描述，模块顶层建一次，多少个 `AtomStore` 都能实例化，互不干扰。
- **作用域清晰**：一个 `AtomStore` 就是一个状态边界；`store.dispose()` 逆序释放这个作用域建出的全部实例，不会牵连其它 store。
- **对象初值不会被跨作用域共享**：`atomDef({ list: [] })` 这种对象初值，每个 store 首次实例化时会自动 `structuredClone`，不用自己操心"要不要 deep clone 初值"。
- **读写分离，追踪可控**：`get()`（建立依赖边）、`peek()`（非追踪读）、`preview()`（React speculative 快照读）三种读法语义不同，适配不同调用场景，见 USEGUIDE。
- **函数式更新是一等公民**：`store.set(def, (prev) => next)` 和 `store.set(def, next)` 都支持，写在 `writableDef` 里的自定义写逻辑同样能拿到 `get`/`set` 去读写其它定义。
- **按 key 的定义有稳定身份**：`familyDef('chat')` 类型的 family 保证同一个 key 在任意作用域下拿到的都是同一个 token（强 LRU 缓存 + GC 后弱引用兜底），不会出现"同一个 key 意外创建了两个互不相关的定义"。
- **覆盖机制专为测试/替身设计**：`override()` 只做路由切换，不 dispose 原节点，撤销后状态原样保留。

## 4. 五分钟上手

```ts
import { createRuntime } from '@migaia/reactive';
import { atomDef, derivedDef, createAtomStore } from '@migaia/store-keyed';

const runtime = createRuntime();
const store = createAtomStore(runtime);

const count = atomDef(0, 'count');
const doubled = derivedDef((get) => get(count) * 2, 'doubled');

store.set(count, 1);
console.log(store.get(doubled)); // 2

const unsubscribe = store.sub(doubled, () => {
  console.log('doubled ->', store.peek(doubled));
});

store.set(count, (previous) => previous + 1); // 函数式更新，触发订阅，打印 "doubled -> 4"

unsubscribe();
store.dispose(); // 释放这个作用域建出的全部实例
```

`atomDef`/`derivedDef` 在哪里创建都行——放在模块顶层，`store`/`runtime` 换成另一份，这两个定义在新作用域里状态是全新的、互不干扰。

## 5. 核心概念一览

| 概念 | 是什么 | 类比 |
| --- | --- | --- |
| **Definition（定义）** | `atomDef`/`atomDefFactory`/`derivedDef`/`writableDef` 产出的冻结对象，只描述"这是什么"，不含状态 | 类的声明，还没 `new` |
| **AtomStore** | `createAtomStore(runtime)` 返回的实例化容器，把定义落到某个 `IRuntime` 上 | 一次 `new` 出来的实例作用域 |
| **Optic（definition 级投影）** | `selectDef`/`opticDef`/`focusDef`，把"大对象里的一部分"变成独立的读/写定义 | 结构体上的一个 getter/setter 对 |
| **Split（按 key 拆分）** | `splitDef`，把数组拆成按 key 稳定的逐项可写定义 | 把一个列表变成"每行一个可订阅单元格" |
| **Family（definition 级）** | `familyDef`/`derivedFamilyDef`，按业务 key 缓存定义 token | 一个 `Map<Key, Definition>`，但带 LRU + GC 兜底 |
| **Override（覆盖）** | `store.override(def, replacement)`，运行期把某个定义的读路由到另一个定义 | 依赖注入里的"替换实现" |

## 6. 模块一览

主入口 `@migaia/store-keyed` 导出定义层、`AtomStore`、definition optics 和 definition family。只发布以下三个子路径；不要依赖未列出的 `src/` 内部文件：

| 导入路径 | 提供什么 |
| --- | --- |
| `@migaia/store-keyed`（主入口） | `atomDef`/`atomDefFactory`/`derivedDef`/`writableDef`、`createAtomStore`/`defaultAtomStore`、`selectDef`/`opticDef`/`focusDef`/`splitDef`、`familyDef`/`derivedFamilyDef`，以及 optics 底层工具函数 |
| `@migaia/store-keyed/reactive/atom` | "实例式" atom 的协议类型（`IReadableAtom`/`IWritableAtom`）与 `atomGetter`/`atomSetter` 构造器——只有类型与跨 Runtime 校验，本包不提供具体实现 |
| `@migaia/store-keyed/atom/store` | `IAtomStore`、`createAtomStore`、`defaultAtomStore`；和主入口对应导出相同的 Store API |
| `@migaia/store-keyed/atom/definition` | atom definition 类型与构造器；和主入口对应导出相同的 definition API |

## 7. 安装

```bash
pnpm add @migaia/store-keyed @migaia/reactive
```

`@migaia/reactive` 是唯一的运行时依赖，`AtomStore` 必须绑定一个 `IRuntime`（`createRuntime()` 或 `defaultRuntime`）。

## 8. 生命周期、错误与边界

1. **`store.get()` 会建立依赖边，`peek()`/`preview()` 不会**。在 React 适配层的 `getSnapshot` 之类"不该记进别人依赖集合"的地方，用 `peek`/`preview`，别用 `get`。
2. **`store.set()` 只接受 primitive / primitive-factory / writable-derived**；对纯只读的 `derivedDef` 调用 `set()`（包括通过 override 间接指向只读定义）会抛 `TypeError`。
3. **`override()` 只能保持原有写契约**：只读定义可以路由到任意同值定义；primitive 只能被 primitive/primitive-factory 替换；writable-derived 只能被 writable-derived 替换，否则抛 `TypeError`。
4. **`atomDefFactory` 的 `create()` 默认不允许在 `store.preview()` 里执行**，需要显式用 `previewSafeAtomDefFactory` 并保证该函数纯、无副作用。
5. **`splitDef(...).prune(store)` 只清理 splitDef 自己的 key→token 缓存**，不会释放 `AtomStore` 里已经实例化的对应节点——那部分需要自己 `store.release(itemDef)`，或者依赖整个 store 的 `dispose()`。
6. **释放粒度是"整个 store"，不是"单个定义"**：`store.release(def)` 只摘掉一个实例，真正回收内存要么显式 release 每个用过的 key，要么在作用域结束时 `store.dispose()` 整个 store。
7. **`familyDef` 需要宿主支持 `WeakRef` 和 `FinalizationRegistry`**，缺失时会在调用时直接抛出说明性错误（而不是静默降级）。

`AtomStore.dispose()` 幂等，已释放 Store 不可复活；包边界错误携带
`source: '@migaia/store-keyed'` 和稳定 `code`，例如 `ATOM_STORE_DISPOSED`、
`CROSS_RUNTIME`、`OVERRIDE_CONTRACT`。清理多项失败时为 `AggregateError`，逐项原因保留在
`errors`。

## 9. 深入参考

完整的定义类型、`AtomStore` 每个方法的精确语义与副作用、optics/split/family 的边界行为、全部错误类型及触发条件、以及 `reactive/atom` 子路径参考，见 **[USEGUIDE.md](./USEGUIDE.md)**。
