# @migaia/store-keyed 使用指南

本文是 `@migaia/store-keyed` 的完整参考手册。README 讲"是什么、适合什么场景、5 分钟怎么跑起来"，本文讲"每一个 API 的精确签名、每一种边界行为、每一个抛错条件"。阅读前建议先看过 [README.md](./README.md) 里的分层心智模型（Definition vs AtomStore）。

## 目录

1. [模块与源码分层](#1-模块与源码分层)
2. [Definition 层完整参考](#2-definition-层完整参考)
3. [AtomStore API 完整参考](#3-atomstore-api-完整参考)
4. [Definition Optics 完整参考](#4-definition-optics-完整参考)
5. [Definition Family 完整参考](#5-definition-family-完整参考)
6. [子路径：reactive/atom](#6-子路径-reactiveatom)
7. [子路径：reactive/family](#7-子路径-reactivefamily)
8. [错误参考](#8-错误参考)
9. [生命周期与资源释放细节](#9-生命周期与资源释放细节)
10. [注意事项详细展开](#10-注意事项详细展开)
11. [完整示例](#11-完整示例)
12. [常见问题排查](#12-常见问题排查)

---

## 1. 模块与源码分层

包内源码按依赖方向分成四层，越往下越不知道上层的存在：

```
atom/definition.ts   —— 纯定义：判别联合 + 冻结对象构造器，不 import 任何运行时
atom/store.ts         —— AtomStore：把定义落到 IRuntime 上，管理实例表/override/preview
atom/def-optics.ts    —— definition 级 optics：selectDef/opticDef/focusDef/splitDef
atom/optics-path.ts   —— optics 与 split 共用的纯函数（路径读写、按 key 拆分的原语）
family/definition.ts  —— definition 级 family：familyDef/derivedFamilyDef（按 key 缓存 token）
reactive/atom.ts       —— "实例式" atom 协议类型，只有类型和跨 Runtime 校验，无实现
reactive/family.ts     —— 与 key 无关的通用可释放值缓存：createFamily/computedFamily
```

主入口 `@migaia/store-keyed` 只导出前五个文件的内容；`reactive/atom`、`reactive/family` 刻意不从主入口导出，必须按子路径 `@migaia/store-keyed/reactive/atom`、`@migaia/store-keyed/reactive/family` 引入——这两个模块解决的是不同的问题（协议类型 vs 通用缓存），混进主入口会让"这个包到底管什么"变得模糊。

---

## 2. Definition 层完整参考

源文件：`src/atom/definition.ts`。所有构造器返回 `Object.freeze` 过的纯对象，内部用 `Symbol.for('morning-watch.store.atom-definition')` 打标（`Symbol.for` 使用全局注册表，因此同一个包的两份拷贝——比如应用主包和 worker 各自打包了一份——仍能互认对方产出的定义）。

| 构造器 | 签名 | 参数类型 | 同步/异步 | `kind` | 说明 |
| --- | --- | --- | --- | --- | --- |
| `atomDef` | `<T>(init: T, debugLabel?: string) => IPrimitiveDefinition<T>` | `init: T`；`debugLabel?: string` | 同步 | `'primitive'` | 源定义，只存初值。每个 `AtomStore` 首次实例化时都会对 `init` 跑一次 `cloneInitial`（见 [§9](#9-生命周期与资源释放细节)），因此同一个 `atomDef({ list: [] })` 在多个 store 下互不共享同一个对象引用。 |
| `atomDefFactory` | `<T>(create: () => T, debugLabel?: string) => IPrimitiveFactoryDefinition<T>` | `create: () => T`；`debugLabel?: string` | 同步 | `'primitive-factory'` | 源定义，用工厂函数代替静态初值；`create()` 在每个 store 首次实例化时调用一次。`previewSafe` 固定为 `false`——`store.preview()` 遇到它会直接抛错，除非改用下面的 `previewSafeAtomDefFactory`。 |
| `previewSafeAtomDefFactory` | 同上 | 同上 | 同步 | `'primitive-factory'` | 与 `atomDefFactory` 唯一区别是 `previewSafe: true`。只应包装纯函数、无副作用的 `create`——React 的 speculative preview 可能被放弃，`create()` 却已经真实执行过了。 |
| `derivedDef` | `<T>(read: IAtomRead<T>, debugLabel?: string, equals?: (a: T, b: T) => boolean) => IDerivedDefinition<T>` | `read: IAtomRead<T>`；`debugLabel?: string`；`equals?: (a: T, b: T) => boolean` | 同步 | `'derived'` | 只读派生，`read(get)` 里的 `get` 只能读同一个 store 内的其它定义。`equals` 默认走底层 Computed 的默认比较（`Object.is`），传自定义 `equals` 可以避免"值语义相等但引用不同"时的多余下游通知。 |
| `writableDef` | `<T, Args, Result>(read, write: IAtomWriter<Args, Result>, debugLabel?, equals?) => IWritableDerivedDefinition<T, Args, Result>` | `read: IAtomRead<T>`；`write: IAtomWriter<Args, Result>`；`debugLabel?: string`；`equals?: (a: T, b: T) => boolean` | 同步 | `'writable-derived'` | 可写派生，`write(get, set, ...args)` 拿到的 `get`/`set` 是同一个 store 上的 `IAtomGet`/`IAtomSet`，因此写逻辑里可以读写其它定义（典型用途：一次 `set` 同时更新两个关联字段）。 |
| `isAtomDefinition` | `(value: unknown) => value is IAtomDefinition<unknown>` | `value: unknown` | 同步 | — | 类型守卫，检查内部品牌 Symbol；`AtomStore` 的每个入口方法都用它校验参数，非法值抛 `TypeError('[store] not an atom definition')`。 |

四种 `kind` 组成的判别联合：

```ts
type IAtomDefinition<T> =
  | IPrimitiveDefinition<T>
  | IPrimitiveFactoryDefinition<T>
  | IDerivedDefinition<T>
  | IErasedWritableDerived<T>; // writable-derived 在读侧被擦除掉具体 Args
```

只有 `primitive`、`primitive-factory`、`writable-derived` 三种可以传给 `store.set()`（`IWritableAtomDefinition`）；`derived` 是纯只读，`store.set()` 遇到它必抛 `TypeError`（见 [§8](#8-错误参考)）。

`debugLabel` 只用于调试展示（会被底层 Signal/Computed 当作 `debugName`），不参与相等性判断，也不是 key——两个 `debugLabel` 相同的 `atomDef` 依然是两个独立的定义 token。

---

## 3. AtomStore API 完整参考

```ts
import { createRuntime } from '@migaia/reactive';
import { createAtomStore, defaultAtomStore } from '@migaia/store-keyed';

const store = createAtomStore(createRuntime());
```

| 构造函数 | 签名 | 参数类型 | 同步/异步 | 说明 |
| --- | --- | --- | --- | --- |
| `createAtomStore` | `(runtime: IRuntime) => IAtomStore` | `runtime: IRuntime` | 同步 | 每次调用都产出一个全新、互不干扰的作用域。 |
| `defaultAtomStore` | `(runtime: IRuntime) => IAtomStore` | `runtime: IRuntime` | 同步 | 每个 `IRuntime` 对应的**默认**（不是"唯一"）store，用 `WeakMap<IRuntime, IAtomStore>` 缓存；已 `dispose()` 的旧 store 会被丢弃并重新创建一份。专为不经 Provider 的实例式旧 API 准备，让它们在同一个 Runtime 上共享状态；Provider 场景应该用 `createAtomStore` 各建各的。 |

### 3.1 读

| 方法 | 签名 | 参数类型 | 同步/异步 | 语义 |
| --- | --- | --- | --- | --- |
| `store.get(def)` | `<T>(definition: IAtomDefinition<T>) => T` | `definition: IAtomDefinition<T>` | 同步 | 会在当前 Computed/Effect 的追踪窗口里建立依赖边；在追踪上下文之外调用等价于普通读取，不会报错。若目标定义还没有实例，会先按定义类型建一份（Signal 或 Computed）。 |
| `store.peek(def)` | 同上 | 同上 | 同步 | 非追踪读，绝不建边。用于"读一次但不想被记成依赖"的场景（React 适配层的 `getSnapshot` 就是典型例子）。 |
| `store.preview(def)` | 同上 | 同上 | 同步 | React 并发渲染下的**推测性**读。若该定义在本 store 已经有真实实例，直接返回该实例当前值（`peek()` 语义）；否则计算一个只在当前 runtime 版本内有效的临时值，不创建持久实例，一个 microtask 后若始终未被提交（即没有变成真实实例）就自动丢弃缓存。`primitive-factory` 必须显式标记 `previewSafe` 才能在这里执行，否则抛错；出现自我依赖的循环会抛 `[store] circular atom preview detected`。 |

### 3.2 写

```ts
store.set(countDef, 1);
store.set(countDef, (previous) => previous + 1); // 函数式更新
store.set(writableDerivedDef, ...customArgs);     // 走 write(get, set, ...args)
```

`store.set(definition, ...args)` 内部用 `runtime.batch(() => runtime.untracked(...))` 包裹：批量提交保证一次 `set` 触发的多次下游重算只通知一轮订阅者；`untracked` 保证 `set` 本身不会被外层正在追踪的 Computed/Effect 误记成依赖。

- 目标解析为 `primitive`/`primitive-factory`：直接写底层 Signal 的 `.value`，支持传值或传 `(previous) => next` 的更新函数。
- 目标解析为 `derived`（只读）：抛 `TypeError('[store] atom override resolved to a read-only definition')`——正常情况下 TypeScript 类型已经挡住了直接传只读定义，这条路径主要在 override 把一个可写定义路由到只读目标时触发。
- 目标解析为 `writable-derived`：调用 `write(store.get, store.set, ...args)`，返回值就是 `write` 的返回值。

### 3.3 订阅

```ts
const unsubscribe = store.sub(doubledDef, () => {
  console.log('changed ->', store.peek(doubledDef));
});
```

`store.sub(def, onChange)` 内部用一个 `Effect` 订阅，而不是把底层节点直接交给调用方——实例化策略（何时建 Signal/Computed、是否惰性）因此可以自由演进而不破坏订阅者。首次运行只建立依赖、不触发 `onChange`；此后每次依赖变化都会在 `runtime.untracked()` 里调用 `onChange`，`onChange` 内抛出的异常会被捕获并交给 `runtime.reportError(error, { phase: 'subscription-listener' })`，不会中断其它订阅者或让 Effect 失效。返回的 `unsubscribe` 幂等，可以安全多次调用。

### 3.4 Override（覆盖）

```ts
// 只读定义：可以路由到任意同值类型定义
store.override(derivedDef, replacement);
// primitive：只能被 primitive/primitive-factory 替换
store.override(primitiveDef, replacementPrimitiveDef);
// writable-derived：只能被同 Args/Result 的 writable-derived 替换
store.override(writableDerivedDef, replacementWritableDerivedDef);
```

三个重载对应三种"写契约必须保持不变"的规则（详细原因见 [§10](#10-注意事项详细展开) 第 3 条）；违反规则抛 `TypeError('[store] atom override must preserve the original write contract')`。

行为细节：

- override 是**路由变化**，不是节点销毁——旧定义、新定义的底层状态都完整保留，切换后旧定义的现有下游会被强制失效（`invalidateResolved`：只断开下游依赖边，不 dispose 节点本身），下一次读取会重新解析到新目标。
- 同一个定义可以叠加多层 override（后调用的排在栈顶，解析时总是取最后一层）；`override()` 返回的撤销函数只移除**自己那一层**，不管它当前是不是栈顶。
- override/撤销都会清空内部的 `preview` 缓存（`previews.clear()`），保证 `store.preview()` 不会读到覆盖前的陈旧推测值。
- 解析走的是可能多层的 override 链；出现循环引用会抛 `Error('[store] cyclic atom override')`。
- store 已 `dispose()` 后，调用 `override()` 会先在入口抛 `[store] cannot use a disposed atom store`；已经拿到的撤销函数在 store 已 disposed 后调用则直接是无操作（不会抛错）。

### 3.5 观察与释放

| 方法 | 签名 | 参数类型 | 同步/异步 | 语义 |
| --- | --- | --- | --- | --- |
| `store.isObserved(def)` | `<T>(definition: IAtomDefinition<T>) => boolean` | `definition: IAtomDefinition<T>` | 同步 | 该定义在本 store 内是否已建实例且有活跃订阅者；定义从未被 `get`/`sub` 过时返回 `false`，不会因为查询本身而建实例。 |
| `store.release(def)` | `<T>(definition: IAtomDefinition<T>) => boolean` | `definition: IAtomDefinition<T>` | 同步 | 只摘掉这一个定义对应的实例（断开依赖边、dispose 底层节点），不牵连同一 store 里的其它定义；返回是否确实释放了什么。会同时尝试"override 解析后的目标"与"传入的原始定义"两个 key，兼容"实例是在 override 生效前建的"这种情况。 |
| `store.size` | `number`（getter） | —（只读 getter，无参数） | 同步 | 当前已实例化的定义数量，可用作释放行为的可观测断言点。 |
| `store.dispose()` | `() => void` | 无 | 同步 | 释放整个作用域，见 [§9](#9-生命周期与资源释放细节)。幂等，重复调用是无操作。 |
| `store.runtime` | `IRuntime`（只读） | —（只读属性，无参数） | 同步 | 创建时传入的 runtime，供适配层交叉校验。 |
| `store.disposed` | `boolean`（getter） | —（只读 getter，无参数） | 同步 | 是否已经 dispose。 |

---

## 4. Definition Optics 完整参考

源文件：`src/atom/def-optics.ts`，与实例层的 `selectAtom`/`focusAtom`/`splitAtom`（吃"活的" atom 对象）是同一思路在 definition 层的对应物——这里产出的都是纯 def token，需要经某个 `AtomStore` 才能落地成状态。

### 4.1 selectDef —— 只读投影

```ts
function selectDef<Source, Selected>(
  source: IAtomDefinition<Source>,
  select: (value: Source) => Selected,
  equals?: (left: Selected, right: Selected) => boolean // 默认 Object.is
): IDerivedDefinition<Selected>;
```

等价于 `derivedDef((get) => select(get(source)), undefined, equals)`。`equals` 默认 `Object.is`：源对象其它字段变了但投影值没变（比如新对象但同一个子字段引用），下游不会被通知。

### 4.2 opticDef —— 自定义 lens 的可写投影

```ts
type IDefOptic<Source, Focus> = {
  get(source: Source): Focus;
  set(source: Source, focus: Focus): Source;
};

function opticDef<Source, Focus>(
  source: IStandardWritableDef<Source>, // 标准 set(update) 写语义的可写定义
  optic: IDefOptic<Source, Focus>
): IWritableDerivedDefinition<Focus, readonly [IAtomUpdate<Focus>], void>;
```

写入时会先用 `optic.get` 取出当前 focus 值，和函数式更新（或直接值）算出的新值做 `Object.is` 比较——相等就直接跳过 `set(source, ...)`，不产生一次空写。`source` 必须是"标准可写定义"（`set(update)` 语义），因为 `opticDef` 内部按这个契约调用 `set(source, optic.set(currentSource, nextFocus))`。

### 4.3 focusDef —— 按字段路径的内置 lens

```ts
focusDef(source, key1): IWritableDerivedDefinition<Source[key1], ...>;
focusDef(source, key1, key2): IWritableDerivedDefinition<Source[key1][key2], ...>;
focusDef(source, key1, key2, key3): IWritableDerivedDefinition<Source[key1][key2][key3], ...>;
```

是 `opticDef` 的一个内置特化：读路径用 `Reflect.get` 沿路径逐层取值，写路径沿路径逐层浅拷贝（数组用 `[...value]`、对象用 `{...value}`）再写回，不修改原对象，也不需要手写不可变更新样板代码。类型层最多支持到三层路径；更深的嵌套需要自己组合多个 `focusDef` 或直接写 `opticDef`。

边界行为：

- 调用时不传任何路径段，抛 `Error('[store] focusDef requires at least one path segment')`。
- 读到路径中途遇到 `null`/非对象值，抛 `TypeError('[store] focusDef cannot read path segment <key>')`。
- 写入时路径中途遇到 `null`/非对象值（且后面还有路径要走），抛 `TypeError('[store] focusDef cannot write path segment <key>')`。
- 写路径对 `__proto__` 这个 key 做了特殊处理，走 `Object.defineProperty` 而不是 `Reflect.set`，避免原型链污染。

### 4.4 splitDef —— 数组按 key 拆分

```ts
type ISplitDefinition<T, Key> = {
  readonly source: IStandardWritableDef<readonly T[]>;
  readonly items: IDerivedDefinition<readonly ISplitItemDef<T>[]>;
  of(key: Key): ISplitItemDef<T>;
  insert(store: IAtomStore, item: T, index?: number): void;
  remove(store: IAtomStore, key: Key): boolean;
  prune(store: IAtomStore): number;
};

function splitDef<T, Key = number>(
  source: IStandardWritableDef<readonly T[]>,
  keyOf?: (item: T, index: number) => Key // 默认按数组下标取 key
): ISplitDefinition<T, Key>;
```

| 成员 | 参数类型 | 同步/异步 | 说明 |
| --- | --- | --- | --- |
| `of(key)` | `key: Key` | 同步 | 返回该 key 对应的可写 item 定义；token 用内部 `Map` 缓存，同一个 key 永远拿到同一个对象引用，跨 store 也一样（因为这是 definition 层，不是实例）。读取时按 `keyOf` 在当前源数组里定位下标；找不到抛 `Error('[store] split def item was removed')`。写入同理，找不到抛 `Error('[store] cannot write a removed split def item')`。 |
| `items` | —（`derivedDef` 属性，非函数调用） | — | 一个 `derivedDef`，值是"当前源数组每一项对应的 `of(key)` 定义"组成的冻结数组；用自定义 `equals`（`shallowArrayEquals`：长度相同且逐项 `Object.is`）比较——重排/新增/删除之外的更新不会让这个数组本身触发下游重跑，数组顺序不变时各项 identity 也保持稳定。 |
| `insert(store, item, index?)` | `store: IAtomStore`；`item: T`；`index?: number` | 同步 | 等价于 `store.set(source, (previous) => spliceInsert(previous, item, index))`；`index` 默认 `+Infinity`（追加到末尾），越界会被夹到 `[0, length]` 区间。 |
| `remove(store, key)` | `store: IAtomStore`；`key: Key` | 同步 | 按 `keyOf` 过滤掉源数组里第一个匹配的元素，返回是否确实删除了。 |
| `prune(store)` | `store: IAtomStore` | 同步 | **只清理 `splitDef` 自己的 key → 定义 token 缓存**，不释放 `AtomStore` 里已经实例化的对应节点——那部分要么自己 `store.release(itemDef)`，要么整体 `store.dispose()`。返回本次清理掉的 key 数量。 |

源数组里出现重复 key（`keyOf` 算出同一个值）会在 `items` 求值时抛 `Error('[store] splitDef keys must be unique')`。

---

## 5. Definition Family 完整参考

源文件：`src/family/definition.ts`。旧的"实例式" family 缓存的是已经绑死 Runtime 的实例，同一个 key 在不同 Scope 下永远是同一份状态；definition family 把这一层拆开——**family 只缓存 token**，token 落到哪个 `AtomStore` 才决定它在哪个作用域下有一份独立的值。

```ts
type IFamilyDefOptions = {
  readonly maxSize?: number;   // 默认 4096，定义强缓存上限
  readonly debugLabel?: string; // 默认 'family' / 'derived-family'
};

type IFamilyDef<K, T, D = IAtomDefinition<T>> = {
  (key: K): D;
  readonly size: number;
  forget(key: K): boolean;
  clear(): void;
};

function familyDef<K extends IFamilyKey, T>(
  initial: (key: K) => T,
  options?: IFamilyDefOptions
): IFamilyDef<K, T, IWritableAtomDefinition<T>>;

function derivedFamilyDef<K extends IFamilyKey, T>(
  read: (key: K) => (get: IAtomGet) => T,
  options?: IFamilyDefOptions
): IFamilyDef<K, T>;
```

`IFamilyKey = string | number | symbol`。

- `familyDef(initial)` 内部对每个 key 产出 `atomDefFactory(() => initial(key), ...)`——也就是说 family 定义的 `kind` 恒为 `'primitive-factory'` 且 `previewSafe: false`；如果需要在 `store.preview()` 里读 family 成员，要么改用 `derivedFamilyDef`，要么接受它在 preview 路径下会抛错。
- `derivedFamilyDef(read)` 对每个 key 产出 `derivedDef(read(key), ...)`，是只读的。
- 两者都调用即返回缓存命中的 token；`family.size` 是当前强缓存的条目数；`family.forget(key)` 显式打破该 key 的 canonical identity（已经建出来的 `AtomStore` 实例不受影响，但同一个 key 之后再查会拿到一个新 token——调用方必须先停止使用旧 token，否则同一个逻辑 key 会分裂成两份互不相关的状态）；`family.clear()` 清空全部缓存条目。

### 5.1 LRU + 弱引用兜底

强缓存是一个按访问顺序重排的 `Map`（`maxSize` 条），超出上限时淘汰最久未访问的一条——但**淘汰只是从强缓存移除**，同时会把它登记进一张 `WeakMap<Key, WeakRef<Definition>>` 当"canonical"记录：只要这个 token 还被别处强引用着（比如某个 `AtomStore` 已经实例化过它，或者调用方自己存了一个变量），后续同 key 查找会通过 `WeakRef.deref()` 命中同一个 token 并把它重新提升回强缓存；只有当 token 真正被 GC 回收之后，同 key 才会创建一个全新 token。这套机制依赖宿主支持 `WeakRef` 和 `FinalizationRegistry`——缺失时 `familyDef(...)` 调用本身就会直接抛 `Error('[store] family definitions require WeakRef and FinalizationRegistry; enable these capabilities in the host sandbox')`，不会静默降级成"每次都创建新 token"。

`maxSize` 必须是正整数，否则抛 `RangeError('[store] family maxSize must be a positive integer')`。

---

## 6. 子路径：reactive/atom

```ts
import type { IReadableAtom, IWritableAtom } from '@migaia/store-keyed/reactive/atom';
import { atomGetter, atomSetter } from '@migaia/store-keyed/reactive/atom';
```

这个文件只定义"实例式" atom 的**协议形状**和跨 Runtime 校验，本包不提供任何具体实现——留在这里是因为 async / family / react 等上层包只需要认识这套类型，不需要认识 `atom/store.ts` 里的实例化策略。

| 导出 | 说明 |
| --- | --- |
| `IReadableAtom<T>` | `IDisposable & { runtime, atomDefinition?, value, observed, read(), peek() }`。`atomDefinition` 是可选的"桥接字段"，供 Provider 级 React 适配层从实例式 atom 反查其背后的纯定义。 |
| `IWritableAtom<T, Args, Result>` | `IReadableAtom<T> & { write(...args): Result }`。 |
| `IAtomGetter` / `IAtomSetter` | `<T>(atom) => T` / `<T, Args, Result>(atom, ...args) => Result`，用于实例式 `read`/`write` 回调。 |
| `atomGetter(runtime)` | 返回一个绑定到该 runtime 的 getter；读取前会校验 `atom.runtime === runtime`，不符抛 `Error('[store] cross-runtime atom access is not allowed')`。 |
| `atomSetter(runtime)` | 同上，写入前做同样的跨 Runtime 校验。 |

---

## 7. 子路径：reactive/family

```ts
import { createFamily, computedFamily } from '@migaia/store-keyed/reactive/family';
```

与上面"definition family"是两回事：这里管理的是**直接持有的可释放值**（`IDisposable`），不是定义 token；按 key 缓存、带 TTL + LRU，服务于"我想要一个通用的、会自动清理的对象池"这种需求（例如"每个对话一个订阅句柄"、"每个文档一个远端连接"）。

```ts
type IFamilyKey = string | number | bigint | boolean | symbol | null | undefined | object;

type IFamilyOptions = {
  maxSize?: number;      // 未观察条目的上限；被观察的条目永远不会被自动淘汰
  ttl?: number;           // 条目自创建起的存活时长（毫秒），默认 Infinity
  now?: () => number;     // 可注入的时钟，测试用；传入后不会启用后台定时淘汰
};

type IFamily<K, V extends IDisposable> = {
  (key: K): V;
  get(key: K): V;
  peek(key: K): V | undefined; // 只读查询，不创建
  has(key: K): boolean;
  remove(key: K): boolean;      // 强制释放，即使当前被观察
  clear(): void;                 // 释放全部可达条目（含被观察的）
  prune(): number;               // 只清理"已过期且未被观察"的条目 + 超出 maxSize 的未观察条目
  dispose(): void;
  readonly disposed: boolean;
  readonly size: number;
};
```

| 构造函数 | 签名 | 参数类型 | 同步/异步 | 说明 |
| --- | --- | --- | --- | --- |
| `createFamily` | `<K, V extends IDisposable>(options: IFamilyOptions & { create(key: K): V; isObserved(value: V): boolean }) => IFamily<K, V>` | `options: IFamilyOptions & { create(key: K): V; isObserved(value: V): boolean }` | 同步 | 通用版本，`create`/`isObserved` 必填——调用方自己决定"这个值是什么、怎么判断它还被使用"。 |
| `computedFamily` | `<K, T>(derive: (key: K) => T, runtime?: IRuntime, options?: IFamilyOptions & { computed?: IComputedConfig<T> }) => IFamily<K, IComputedValue<T>>` | `derive: (key: K) => T`；`runtime?: IRuntime`；`options?: IFamilyOptions & { computed?: IComputedConfig<T> }` | 同步 | `createFamily` 的特化：`create` 用 `runtime.computed(() => derive(key), options.computed)`，`isObserved` 用 `value.observed`。`runtime` 默认 `defaultRuntime`。 |

行为要点：

- **原始类型 key**（string/number/bigint/boolean/symbol/null/undefined）存进一个普通 `Map`，走确定性的 LRU + TTL；**对象/函数 key** 存进 `WeakMap`，family 不会成为该 key 对象的唯一持有者——key 对象被外部 GC 后，对应条目也会通过 `FinalizationRegistry` 被动清理，与 `maxSize`/`ttl` 无关。
- `maxSize` 只约束"未被观察"的条目；`get()` 每次插入新条目、以及 `prune()` 都会触发一次容量检查，超出部分按最久未访问（LRU）淘汰。
- `ttl` 到期的条目不会立刻消失：只要 `isObserved(value)` 仍为真就保留，等真正不再被观察时才在下次访问或 `prune()` 时回收；使用真实挂钟时间（未传自定义 `now`）还会启用一个后台定时器主动触发 `prune()`，避免"没人再访问但一直不清理"。
- `clear()`/`dispose()` 会强制释放**全部**可达条目，包括仍被观察的——这与 `prune()` 刻意保留被观察条目不同，语义上是"调用方明确要整体清空/整体收摊"。
- 淘汰/清空调用条目的 `.dispose()`；多个条目释放失败会聚合成 `AggregateError('[store] family disposal failed for multiple entries')`（`clear`/`dispose` 路径）或 `AggregateError('[store] family capacity eviction failed for multiple entries')`（容量淘汰路径）；只有一个失败则直接抛出该错误本身。
- 同 `familyDef`，需要宿主支持 `WeakRef` + `FinalizationRegistry`，否则 `createFamily(...)` 直接抛 `Error('[store] createFamily() requires WeakRef and FinalizationRegistry; enable these capabilities in the host sandbox')`。
- `maxSize`/`ttl` 校验：`maxSize` 必须是正整数，否则 `RangeError('[store] family maxSize must be a positive integer')`；`ttl` 必须非负，否则 `RangeError('[store] family ttl must be non-negative')`。
- 已 `dispose()` 的 family 上调用 `get`/`peek`/`has`/`remove`/`clear`/`prune` 都会先抛 `Error('[store] cannot use a disposed family')`。

---

## 8. 错误参考

本包没有独立的错误码枚举体系（不像 `plugin-host` 那样有 `PluginHostErrorCode`），统一用 `Error`/`TypeError`/`RangeError`，message 都以 `[store]` 前缀标记来源，可以按前缀或按具体文案做断言。

| 抛出者 | 错误类型 | message | 触发条件 |
| --- | --- | --- | --- |
| `AtomStore` 各方法入口 | `Error` | `cannot use a disposed atom store` | store 已 `dispose()` 后调用 `get`/`peek`/`preview`/`set`/`sub`/`override`/`isObserved`/`release`。 |
| `AtomStore` 各方法入口 | `TypeError` | `not an atom definition` | 传入的不是 `atomDef`/`derivedDef`/... 产出的合法定义对象。 |
| `store.set()` | `TypeError` | `atom override resolved to a read-only definition` | 目标（可能经 override 解析后）是 `derived`，没有写语义。 |
| `store.override()` | `TypeError` | `atom override must preserve the original write contract` | 违反 [§3.4](#34-override覆盖) 的三条替换规则。 |
| `store.override()` / `store.get()` 等解析路径 | `Error` | `cyclic atom override` | override 链形成环。 |
| `store.preview()` | `Error` | `atom factory is not marked preview-safe` | `preview()` 遇到 `previewSafe: false` 的 `primitive-factory`。 |
| `store.preview()` | `Error` | `circular atom preview detected` | 推测读之间出现循环依赖。 |
| `focusDef`（构造期） | `Error` | `focusDef requires at least one path segment` | 未传任何 key。 |
| `focusDef`（读/写期） | `TypeError` | `focusDef cannot read path segment <key>` / `focusDef cannot write path segment <key>` | 路径中途遇到 `null`/非对象值。 |
| `splitDef(...).of(key)` 读 | `Error` | `split def item was removed` | 读取时该 key 已不在源数组里。 |
| `splitDef(...).of(key)` 写 | `Error` | `cannot write a removed split def item` | 写入时该 key 已不在源数组里。 |
| `splitDef(...).items` 求值 | `Error` | `splitDef keys must be unique` | `keyOf` 对不同元素算出了相同的 key。 |
| `familyDef` / `derivedFamilyDef` | `RangeError` | `family maxSize must be a positive integer` | `maxSize` 非正整数。 |
| `familyDef` / `derivedFamilyDef` | `Error` | `family definitions require WeakRef and FinalizationRegistry; enable these capabilities in the host sandbox` | 宿主环境缺少这两个全局能力。 |
| `createFamily` | `Error` | `createFamily() requires WeakRef and FinalizationRegistry; enable these capabilities in the host sandbox` | 同上，通用 family 版本。 |
| `createFamily` | `RangeError` | `family maxSize must be a positive integer` / `family ttl must be non-negative` | 选项非法。 |
| `createFamily` 产出的 family | `Error` | `cannot use a disposed family` | family 已 `dispose()` 后继续使用。 |
| `atomGetter(runtime)` / `atomSetter(runtime)` | `Error` | `cross-runtime atom access is not allowed` | 实例式 atom 的 `runtime` 与调用方绑定的 runtime 不一致。 |
| `AtomStore` 内部所有权登记（继承自 `@migaia/reactive`） | `Error` | `this node is already owned by another Runtime` | 同一个 store 对象被 `claimOwnership` 到两个不同的 Runtime——正常使用路径下不会触发，出现即说明把同一个 store 错误地跨 Runtime 复用了。 |

---

## 9. 生命周期与资源释放细节

### 9.1 实例化与初值克隆

`AtomStore` 内部用一个可遍历的 `Map<definition, instance>` 保存实例，而不是 `WeakMap`——释放时需要遍历它们逐个断开依赖边、`dispose()` 底层节点，`WeakMap` 做不到这件事。**生命周期的最小单位是整个 store，不是单个定义**：store 强引用它建出的每一个实例，随 `store.dispose()` 一起批量释放；要提前释放某一个，用 `store.release(definition)`。

`atomDef(init)` 的 `init` 若是对象/数组，第一次在某个 store 里实例化时会跑一次 `cloneInitial`：优先用 `structuredClone`，宿主不支持时退化为手写的递归浅拷贝（保留属性描述符，处理循环引用）。这保证了同一个定义在多个 store 下不会意外共享同一份可变初值容器。

### 9.2 dispose() 的精确顺序

```ts
store.dispose();
```

1. 立即置 `disposed = true`（此后所有方法入口都会先抛 `[store] cannot use a disposed atom store`），清空 override 表。
2. 依次调用当时全部活跃订阅（`sub()` 返回的 unsubscribe）——单个订阅取消失败不会阻断其它订阅的取消，错误先收集起来。
3. 通过内部 `LifecycleScope` **按建出的逆序**释放全部实例节点（后建的派生通常依赖先建的源，逆序释放避免"源先没了、派生 dispose 时读到已释放状态"）——单个节点 dispose 失败同样先收集不中断。
4. 收集到 0 个错误：正常返回；收集到 1 个：原样 `throw`；收集到多个：包成 `AggregateError('[store] atom store disposal failed')` 抛出。

`dispose()` 幂等，重复调用是无操作，不会重复抛错。

### 9.3 release() vs dispose()

- `store.release(def)`：只摘一个实例。摘除时会依次尝试"当前 override 解析到的目标"和"传入的原始定义"两个 key，因此即便这个定义后来被 override 过，也能正确摘掉在 override 生效前就建好的旧实例。
- `store.dispose()`：摘整个作用域。

`splitDef(...).prune(store)`、`familyDef(...).forget/clear` 这类"family/split 自己的 key→token 缓存清理"都**不会**连带调用 `store.release()`——token 缓存和 store 的实例表是两张独立的表，各自负责各自的生命周期。

### 9.4 override 与 preview 的相互影响

`override()`/其撤销函数都会 `previews.clear()`——这保证 `store.preview()` 不会在 override 状态切换的瞬间读到一份对应旧路由的推测值。`preview()` 本身对已有真实实例的定义直接短路成 `peek()`，只有"还没有真实实例"的定义才会走推测计算路径，且该路径产出的值只在当前 `runtime.currentVersion()` 内复用，一个 microtask 后如果始终没有变成真实实例就会被丢弃——一个长期挂载的 Provider 不会因为一次被放弃的推测渲染而永久持有一份推测对象。

---

## 10. 注意事项详细展开

1. **`store.get()` 建依赖边，`peek()`/`preview()` 不建**。`get()` 在追踪上下文（Computed 的 `read`、Effect 的回调体）里调用才会真正建边；在普通同步代码里调用它和 `peek()` 效果一样，只是语义上更容易被误用成"以为在别处也会自动追踪"。React 适配层的 `getSnapshot`、`useSyncExternalStore` 的快照读必须用 `peek`/`preview`，用 `get` 会把这次读意外记进当前渲染帧之外某个别的 Computed 的依赖集合，产生难以复现的"串边"问题。

2. **`store.set()` 只接受 primitive / primitive-factory / writable-derived**。对 `derivedDef` 调用 `set()` 会抛 `TypeError`；这不只是 TypeScript 层的约束——即便通过 `override()` 把一个可写定义间接路由到只读定义，运行时同样会在真正执行写入时抛出，不存在"类型检查绕过后运行时也放行"的漏洞。

3. **`override()` 必须保持原有写契约**，原因是"读侧统一形态"的代价：`AtomStore.get()` 对全部 4 种 `kind` 一视同仁地读，但 `set()` 需要知道目标究竟按哪种写语义处理参数。如果允许 primitive 被 override 成一个自定义 `writable-derived`，`set(def, update)` 传进去的 `update` 参数在两种写语义下含义完全不同（前者是"新值或更新函数"，后者是"传给自定义 `write` 的任意参数列表"），运行时无法安全分辨该按哪套规则处理。只读定义没有这层顾虑——它自己没有公开的写契约，因此可以被路由到任意同值类型的定义。

4. **`atomDefFactory` 的 `create()` 默认不允许在 `store.preview()` 里执行**。React 的并发渲染可能发起一次推测渲染又整体放弃；如果 `create()` 有副作用（比如打开一个连接、往某个外部注册表写一条记录），一次被放弃的渲染也会让副作用真实发生且无法撤销。需要在 preview 路径执行的工厂必须显式用 `previewSafeAtomDefFactory` 声明，并且自己保证纯、幂等、无外部可观察副作用——这是调用方的承诺，包本身不做运行时验证。

5. **`splitDef(...).prune(store)` 只清理 splitDef 自己的 key→token 缓存**，不释放 `AtomStore` 里已经实例化的对应节点。这是刻意的职责分离：`splitDef` 只知道"哪些 key 的定义 token 还有意义"，不知道、也不该知道某个 `AtomStore` 有没有实例化过它——真正的实例释放要么调用方显式 `store.release(itemDef)`，要么依赖 `store.dispose()` 整体收尾。长期滚动大量 key（比如聊天消息列表持续增删）而只调用 `prune()` 不管 store 侧，`splitDef` 内部缓存不会泄漏，但对应 `AtomStore` 里的旧实例会一直累积。

6. **释放粒度是"整个 store"，不是"单个定义"**。这是 `atom/store.ts` 顶部注释里明确纠正过的一处历史设计——旧版本的注释宣称"定义不再被引用时实例可回收"，但同时又用数组强引用着全部实例，两者自相矛盾，实际什么都回收不了。现在的诚实做法是：store 强引用它建出的一切，`release(def)` 是唯一的"提前释放单个"入口，真正的批量回收只发生在 `store.dispose()`。

7. **`familyDef`/`createFamily` 都需要宿主支持 `WeakRef` 和 `FinalizationRegistry`**，缺失时在调用构造函数那一刻就直接抛出说明性错误，而不是静默降级成"每次都创建新 token / 永不回收"——后者会制造一个悄悄变慢或悄悄泄漏内存的包，比显式报错更难排查。少数嵌入式 JS 引擎或裁剪过的小程序沙箱可能缺这两个全局能力，需要确认目标运行环境或引入等价的 polyfill。

---

## 11. 完整示例

一个"每个会话（session）一份状态、字段可独立订阅、列表按 key 拆分、测试期可替身"的组合示例：

```ts
import { createRuntime, type IRuntime } from '@migaia/reactive';
import {
  atomDef,
  derivedDef,
  createAtomStore,
  focusDef,
  splitDef,
  familyDef,
  type IAtomStore
} from '@migaia/store-keyed';

type ITodo = { id: string; text: string; done: boolean };
type ISessionState = { user: { name: string }; todos: readonly ITodo[] };

// —— 模块顶层：只建一次，纯描述，不含状态 ——
const sessionDef = atomDef<ISessionState>({
  user: { name: 'guest' },
  todos: []
});
const userNameDef = focusDef(sessionDef, 'user', 'name');
const todosSplit = splitDef(
  focusDef(sessionDef, 'todos'),
  (todo) => todo.id
);
const doneCountDef = derivedDef(
  (get) => get(focusDef(sessionDef, 'todos')).filter((todo) => todo.done).length
);

// 每个会话各自的运行时状态由 familyDef 按 sessionId 缓存 token,
// 但真正落地成值仍要经某个 AtomStore
const sessionBySessionId = familyDef((sessionId: string) => ({
  user: { name: 'guest' },
  todos: [] as ITodo[]
}));

function openSession(runtime: IRuntime, sessionId: string): IAtomStore {
  const store = createAtomStore(runtime);
  const state = sessionBySessionId(sessionId);
  store.set(state, (previous) => ({ ...previous, user: { name: 'ada' } }));
  return store;
}

// —— 用法 ——
const runtime = createRuntime();
const store = createAtomStore(runtime);

store.set(userNameDef, 'ada');
todosSplit.insert(store, { id: 't1', text: '写文档', done: false });
todosSplit.insert(store, { id: 't2', text: '发版', done: false });

const item = todosSplit.of('t1');
store.set(item, (previous) => ({ ...previous, done: true }));
console.log(store.get(doneCountDef)); // 1

const unsubscribe = store.sub(doneCountDef, () => {
  console.log('doneCount ->', store.peek(doneCountDef));
});

// —— 测试里替换某个定义的实现 ——
const undo = store.override(
  doneCountDef,
  derivedDef(() => 999) // 只读定义可以路由到任意同值类型定义
);
console.log(store.get(doneCountDef)); // 999
undo(); // 撤销后状态原样保留

unsubscribe();
todosSplit.remove(store, 't2');
todosSplit.prune(store); // 只清 splitDef 自己的 key 缓存
store.dispose(); // 释放这个作用域建出的全部实例
```

---

## 12. 常见问题排查

**Q：`store.set(def, value)` 抛 `TypeError: [store] atom override resolved to a read-only definition`。**
`def`（或它被 override 之后解析到的目标）是一个 `derivedDef`。只读派生没有写语义；如果是通过 `override()` 间接路由过去的，检查 override 链条上是否有一步把可写定义指向了只读定义。

**Q：`store.override(a, b)` 抛 `TypeError: [store] atom override must preserve the original write contract`。**
`a`、`b` 的写语义不匹配：primitive/primitive-factory 只能互相替换，writable-derived 只能被同 Args/Result 的 writable-derived 替换。只有"只读定义"这一侧没有这个限制，可以路由到任意同值类型的定义，见 [§10](#10-注意事项详细展开) 第 3 条的原因说明。

**Q：`familyDef(...)` 或 `createFamily(...)` 一调用就抛 `requires WeakRef and FinalizationRegistry`。**
目标运行环境缺这两个 ES2021 全局能力（部分裁剪过的小程序/嵌入式 JS 引擎会缺）。需要确认宿主支持情况，或引入功能等价的 polyfill；这个错误不会静默吞掉，说明包作者刻意选择"宁可显式报错，也不要悄悄退化成不清理内存"。

**Q：`store.preview(def)` 抛 `Error: [store] atom factory is not marked preview-safe`。**
`def` 是用 `atomDefFactory` 建的（`previewSafe: false`），却在 React 的推测渲染路径（`preview()`）里被读取。要么确认这个工厂函数纯、无副作用后改用 `previewSafeAtomDefFactory`，要么避免在 preview 路径读它。

**Q：`splitDef(...).of(key)` 抛 `split def item was removed` / `cannot write a removed split def item`。**
该 key 已经不在源数组里了（可能被别处 `remove()` 过，或源数组被直接 `store.set()` 替换掉了该项）。读写前用 `todosSplit.items` 或直接查 `store.get(todosSplit.source)` 确认 key 是否还存在；`of(key)` 拿到的 token 本身在 key 消失后依然是同一个对象，但读写会持续失败直到该 key 重新出现在源数组里。

**Q：`store.dispose()` 之后再 `store.get(def)`，为什么直接抛错而不是拿到最后一次的值？**
`dispose()` 后的 store 处于终结状态，任何读写入口都会先抛 `[store] cannot use a disposed atom store`。这是有意的：一个已释放的作用域不应该被继续静默使用，否则很容易掩盖"忘记开新 store"的调用方 bug。需要新状态就 `createAtomStore(runtime)` 建一个新的。

**Q：`familyDef(...).forget(key)` 之后，之前拿到的旧 token 还能用吗？**
能，旧 token 依旧是一个合法的定义，已经用它实例化过的 `AtomStore` 状态不受影响。但 `forget` 之后同一个 key 再查会创建一个**新** token，新旧 token 互不相通——如果代码里还有地方持有旧 token 并继续用它读写，会和"新 token 那一份状态"永久分裂成两份。`forget` 之后应该确保调用方统一切换到新的查找结果，不要混用。
