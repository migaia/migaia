# `@migaia/store-keyed`

**定义化（definition-based）的键控状态层**——基于 [`@migaia/reactive`](../reactive) 的 Signal/Computed 内核，把"这是什么状态"（Definition）和"在哪个作用域里落地"（AtomStore）拆成两层，专为"同一份状态定义要在多个独立作用域各自持有一份值"设计：Atom 定义、AtomStore、definition 级 optics（投影/聚焦/按 key 拆分），以及按 key 产出定义的 family。

## 适用与不适用场景

**适用**：需要同一份状态定义在多个独立作用域下各自持有一份值——每个 React Provider 一份、每个 SSR 请求一份、每个测试用例一份、每个 AI 对话一份。典型场景：`familyDef` 按对话/频道 id 产出定义、`focusDef`/`splitDef` 把大对象或列表拆成可独立订阅写入的子定义、`store.override()` 在测试里替换某个定义的实现而不改动被测代码引用的 token。

**不适用**：整个应用只有一份全局状态、永远不需要多作用域隔离——直接用 `@migaia/reactive` 的 `Signal`/`Computed` 或更薄的 atom 库即可，不需要 definition/store 两层间接。本包不依赖 React、不依赖 DOM，也不提供 Provider/Hook；那是 `@migaia/store-react` 的职责。`familyDef`/`createFamily` 类原语只做同步初值/派生缓存，不支持异步初始值（`atomDef`/`atomDefFactory` 的初值/工厂遇到 thenable 会直接拒绝）。

## 安装

```bash
pnpm add @migaia/store-keyed @migaia/reactive
```

`@migaia/reactive` 是唯一的运行时依赖，`AtomStore` 必须绑定一个 `IRuntime`（`createRuntime()` 或 `defaultRuntime`）。

## 目录

- [`@migaia/store-keyed`：Definition 层](#definition-层)
- [`@migaia/store-keyed`：AtomStore](#atomstore)
- [`@migaia/store-keyed`：Definition Optics](#definition-optics)
- [`@migaia/store-keyed`：Optics 底层工具函数](#optics-底层工具函数)
- [`@migaia/store-keyed`：Definition Family](#definition-family)
- [`@migaia/store-keyed`：错误工具](#错误工具)
- [`@migaia/store-keyed/reactive/atom`：实例式 atom 协议](#reactiveatom-子路径)
- [子路径别名：`atom/store`、`atom/definition`](#子路径别名)
- [高阶组合示例](#高阶组合示例)
- [构建门禁](#构建门禁)

完整签名、边界行为与错误码，见 [USEGUIDE.md](./USEGUIDE.md)。

---

<a id="definition-层"></a>

## Definition 层

```ts
import {
  atomDef,
  atomDefFactory,
  previewSafeAtomDefFactory,
  derivedDef,
  writableDef,
  isAtomDefinition,
  assertNotThenable,
  AtomKind
} from '@migaia/store-keyed';
```

纯定义层：所有构造器都返回 `Object.freeze` 过的对象，不 import 任何运行时内核，模块顶层建一次即可到处复用。

**`atomDef`｜3 秒上手** —— 源定义，只有初值：

```ts
const count = atomDef(0, 'count');
```

全部参数：`init: T`（必填，禁止 thenable，否则抛 `TypeError`/`INVALID_OPTION`）、`debugLabel?: string`（可选，仅用于调试展示，不参与相等性判断）。对象/数组初值在每个 `AtomStore` 首次实例化时会自动 `structuredClone`，多个作用域之间不共享同一个可变容器。

**`atomDefFactory`｜5 秒上手** —— 用工厂函数代替静态初值：

```ts
const list = atomDefFactory(() => [], 'list');
```

全部参数：`create: () => T`（必填，每个 store 首次实例化时调用一次，禁止返回 thenable）、`debugLabel?: string`（可选）。产出的 `previewSafe` 固定为 `false`——`store.preview()` 遇到它会直接抛错。

**`previewSafeAtomDefFactory`｜5 秒上手** —— 与 `atomDefFactory` 唯一区别是标记 `previewSafe: true`，允许在 React 的推测性 `store.preview()` 里执行：

```ts
const list = previewSafeAtomDefFactory(() => [], 'list');
```

参数同 `atomDefFactory`：`create: () => T`（必填，必须纯、无副作用、无异步）、`debugLabel?: string`（可选）。

**`derivedDef`｜5 秒上手** —— 只读派生：

```ts
const doubled = derivedDef((get) => get(count) * 2, 'doubled');
```

全部参数：`read: (get: IAtomGet) => T`（必填，`get` 只能读同一个 store 内的其它定义）、`debugLabel?: string`（可选）、`equals?: (a: T, b: T) => boolean`（可选，默认沿用底层 Computed 的默认比较 `Object.is`；传自定义 `equals` 可避免"引用不同但值相等"时的多余下游通知）。

**`writableDef`｜10 秒上手** —— 可写派生，读一份、写另一份：

```ts
const filterText = writableDef(
  (get) => get(state).filter,
  (get, set, next) => set(state, (s) => ({ ...s, filter: next }))
);
```

全部参数：`read: (get) => T`（必填）、`write: (get, set, ...args: Args) => Result`（必填，拿到的是同一个 store 上的 `IAtomGet`/`IAtomSet`，因此可以在写逻辑里读写其它定义）、`debugLabel?: string`（可选）、`equals?: (a: T, b: T) => boolean`（可选，默认 `Object.is`）。

**`isAtomDefinition`｜3 秒上手** —— 类型守卫，检查内部品牌 Symbol：

```ts
isAtomDefinition(count); // true
isAtomDefinition({}); // false
```

单参数 `value: unknown`（必填），无其他选项。`AtomStore` 的每个入口方法都用它校验参数，非法值抛 `TypeError('[store] not an atom definition')`。

**`assertNotThenable`｜3 秒上手** —— 拒绝 thenable 值的守卫，`atomDef`/`atomDefFactory` 内部用它，也可直接复用：

```ts
assertNotThenable(value, 'myFactory create()');
```

全部参数：`value: unknown`（必填）、`context: string`（必填，出现在错误消息里标注调用点）。`value` 是 thenable（或读取 `then` 本身抛错）时抛 `TypeError`，`code: 'INVALID_OPTION'`。

**`AtomKind`｜3 秒上手** —— 四种定义种类的常量表，用于按 `definition.kind` 分支：

```ts
AtomKind.primitive; // 'primitive'
AtomKind.primitiveFactory; // 'primitive-factory'
AtomKind.derived; // 'derived'
AtomKind.writableDerived; // 'writable-derived'
```

无参数，是一个 `as const` 常量对象；`IAtomKind` 是其取值的联合类型。

---

<a id="atomstore"></a>

## AtomStore

```ts
import { createRuntime } from '@migaia/reactive';
import { createAtomStore, defaultAtomStore } from '@migaia/store-keyed';
```

**`createAtomStore`｜3 秒上手** —— 把一批定义落到某个 `IRuntime` 上：

```ts
const store = createAtomStore(createRuntime());
```

单参数 `runtime: IRuntime`（必填）。每次调用都产出一个全新、互不干扰的作用域。

**`defaultAtomStore`｜3 秒上手** —— 每个 `IRuntime` 对应的**默认**（非"唯一"）store：

```ts
const store = defaultAtomStore(defaultRuntime);
```

单参数 `runtime: IRuntime`（必填）。用 `WeakMap<IRuntime, IAtomStore>` 缓存；已 `dispose()` 的旧 store 会被丢弃并重新创建。专为不经 Provider 的实例式旧 API 准备，让它们在同一个 Runtime 上共享状态；Provider 场景应该用 `createAtomStore` 各建各的。

两者都返回同一形状的 `IAtomStore`：

**`store.get(definition)`｜3 秒上手** —— 追踪读，建立依赖边：

```ts
store.get(doubled); // 2
```

单参数 `definition: IAtomDefinition<T>`（必填）。在当前 Computed/Effect 的追踪窗口里调用会建边；追踪上下文之外调用等价于普通读取。目标还没有实例时会先按定义类型建一份。

**`store.peek(definition)`｜3 秒上手** —— 非追踪读，绝不建边（React 适配层的 `getSnapshot` 该用这个）：

```ts
store.peek(doubled);
```

单参数同上，无其他选项。

**`store.preview(definition)`｜5 秒上手** —— React 并发渲染下的推测性读：

```ts
store.preview(doubled);
```

单参数同上。已有真实实例时直接走 `peek()` 语义；否则计算一个只在当前 `runtime.currentVersion()` 内有效的临时值，一个 microtask 后若始终未提交就自动丢弃。`primitive-factory` 必须标记 `previewSafe: true` 才能在这里执行，否则抛 `Error('[store] atom factory is not marked preview-safe')`；出现循环自我依赖抛 `Error('[store] circular atom preview detected')`。

**`store.set(definition, ...args)`｜5 秒上手** —— 写：

```ts
store.set(count, 1);
store.set(count, (previous) => previous + 1); // 函数式更新
```

参数：`definition: IWritableAtomDefinition<T, Args, Result>`（必填，只接受 primitive / primitive-factory / writable-derived；对纯只读 `derivedDef` 调用会抛 `TypeError`）、`...args: Args`——primitive/primitive-factory 是 `[value | (previous) => value]`；writable-derived 透传给自定义 `write(get, set, ...args)`。内部用 `runtime.batch(() => runtime.untracked(...))` 包裹。

**`store.sub(definition, onChange)`｜5 秒上手** —— 订阅，返回退订函数：

```ts
const unsubscribe = store.sub(doubled, () => console.log('changed ->', store.peek(doubled)));
```

参数：`definition: IAtomDefinition<T>`（必填）、`onChange: () => void`（必填）。首次运行只建立依赖、不触发 `onChange`；`onChange` 内抛出的异常会被捕获并交给 `runtime.reportError`，不会中断其它订阅。返回的 `unsubscribe` 幂等。

**`store.override(definition, replacement)`｜10 秒上手** —— 运行期把某个定义的读路由到另一个定义：

```ts
const undo = store.override(
  doubled,
  derivedDef(() => 999)
); // 只读定义可路由到任意同值定义
undo(); // 撤销，状态原样保留
```

参数：`definition`（必填）、`replacement`（必填）——三个重载对应三条"写契约必须保持不变"的规则：只读定义可以路由到任意同值类型定义；primitive/primitive-factory 只能被 primitive/primitive-factory 替换；writable-derived 只能被同 `Args`/`Result` 的 writable-derived 替换，违反抛 `TypeError('[store] atom override must preserve the original write contract')`。同一定义可叠加多层 override；override/撤销都会清空内部 preview 缓存；override 链成环抛 `Error('[store] cyclic atom override')`。

**`store.isObserved(definition)`｜3 秒上手**：

```ts
store.isObserved(doubled); // 是否已建实例且有活跃订阅者
```

单参数同上，无其他选项。查询本身不会建实例。

**`store.release(definition)`｜3 秒上手** —— 只摘掉这一个定义的实例：

```ts
store.release(count); // 返回是否确实释放了什么
```

单参数同上，无其他选项。会依次尝试"override 解析后的目标"与"传入的原始定义"两个 key。

**`store.size`｜3 秒上手** —— 只读 getter，当前已实例化的定义数量：

```ts
store.size;
```

**`store.dispose()`｜3 秒上手** —— 释放整个作用域，逆序释放全部实例：

```ts
store.dispose();
```

无参数。幂等，重复调用是无操作。多项释放失败时抛 `AggregateError('[store] atom store disposal failed')`。

**`store.runtime`** / **`store.disposed`｜3 秒上手** —— 只读属性，无参数：

```ts
store.runtime; // 创建时传入的 IRuntime
store.disposed; // boolean
```

---

<a id="definition-optics"></a>

## Definition Optics

```ts
import { selectDef, opticDef, focusDef, splitDef } from '@migaia/store-keyed';
```

在 Definition 层做投影/聚焦/拆分——产出的都是纯 def token，需要经某个 `AtomStore` 才能落地成状态。

**`selectDef`｜5 秒上手** —— 只读投影：

```ts
const userName = selectDef(userDef, (user) => user.name);
```

全部参数：`source: IAtomDefinition<Source>`（必填）、`select: (value: Source) => Selected`（必填）、`equals?: (left, right) => boolean`（可选，默认 `Object.is`）。等价于 `derivedDef((get) => select(get(source)), undefined, equals)`。

**`opticDef`｜10 秒上手** —— 自定义 lens 的可写投影：

```ts
const nameField = opticDef(userDef, {
  get: (user) => user.name,
  set: (user, name) => ({ ...user, name })
});
```

全部参数：`source: IStandardWritableDef<Source>`（必填，须为标准 `set(update)` 写语义的可写定义）、`optic: { get(source): Focus; set(source, focus): Source }`（必填）。写入时会先算出新旧 focus 值做 `Object.is` 比较，相等则跳过一次空写。

**`focusDef`｜10 秒上手** —— 按字段路径的内置 lens（最多三层）：

```ts
const userName = focusDef(sessionDef, 'user', 'name');
```

参数：`source: IStandardWritableDef<Source>`（必填）、`...path`（1~3 个 key，必填至少一个，否则抛 `Error('[store] focusDef requires at least one path segment')`）。读路径中途遇到 `null`/非对象值抛 `TypeError('[store] focusDef cannot read path segment <key>')`；写路径同理抛 `cannot write path segment`；`__proto__` 段做了防原型污染的特殊处理。更深嵌套需要组合多个 `focusDef` 或直接写 `opticDef`。

**`splitDef`｜10 秒上手** —— 数组按 key 拆成可独立订阅/独立写的逐项定义：

```ts
const todosSplit = splitDef(todosDef, (todo) => todo.id);
const item = todosSplit.of('t1');
```

全部参数：`source: IStandardWritableDef<readonly T[]>`（必填）、`keyOf?: (item: T, index: number) => Key`（可选，默认按数组下标取 key）。返回对象：

- `source`——原样透传的源定义
- `items`——`derivedDef`，值是当前源数组每一项对应的 `of(key)` 定义组成的冻结数组，用 `shallowArrayEquals` 比较，重排数组时未变化的元素仍是同一订阅目标
- `of(key: Key)`——返回该 key 对应的可写 item 定义，token 用内部 `Map` 缓存；读/写时该 key 已不在源数组里分别抛 `Error('[store] split def item was removed')` / `Error('[store] cannot write a removed split def item')`
- `insert(store: IAtomStore, item: T, index?: number)`——`index` 默认 `+Infinity`（追加到末尾），越界会被夹到 `[0, length]`
- `remove(store: IAtomStore, key: Key): boolean`——过滤掉源数组里第一个匹配元素，返回是否确实删除
- `prune(store: IAtomStore): number`——只清理 `splitDef` 自己的 key→token 缓存，不释放 `AtomStore` 里已实例化的节点

源数组里出现重复 key 会在 `items` 求值时抛 `Error('[store] splitDef keys must be unique')`。

---

<a id="optics-底层工具函数"></a>

## Optics 底层工具函数

```ts
import {
  readOpticPath,
  writeOpticPath,
  findKeyIndex,
  requireKeyIndex,
  shallowArrayEquals,
  computeUniqueKeys,
  spliceInsert,
  filterOutKey,
  replaceAtIndex,
  KeyedSplitCache
} from '@migaia/store-keyed';
```

`focusDef`/`splitDef` 内部依赖的纯函数原语，随主入口一并导出，供需要手写自定义 optics（而不是用 `opticDef`/`splitDef` 现成实现）的调用方复用。

**`readOpticPath` / `writeOpticPath`｜5 秒上手** —— 不可变路径读写，是 `focusDef` 的底层实现：

```ts
readOpticPath({ a: { b: 1 } }, ['a', 'b'], 'myLens'); // 1
writeOpticPath({ a: { b: 1 } }, ['a', 'b'], 2, 'myLens'); // { a: { b: 2 } }，原对象不变
```

参数：`value: unknown`（必填）、`path: readonly PropertyKey[]`（必填）、`label: string`（必填，出现在错误消息里）；`writeOpticPath` 额外要求 `next: unknown`（必填，写入值）。路径中途遇到 `null`/非对象值抛 `TypeError`。

**`findKeyIndex`｜5 秒上手** —— 线性查找匹配 key 的下标，找不到返回 `-1`：

```ts
findKeyIndex(todos, (t) => t.id, 't1');
```

参数：`items: readonly T[]`（必填）、`keyOf: (item, index) => Key`（必填）、`key: Key`（必填），无可选项。

**`requireKeyIndex`｜3 秒上手** —— 同上，但找不到时抛错而不是返回 `-1`：

```ts
requireKeyIndex(todos, (t) => t.id, 't1', 'item was removed');
```

额外参数 `label: string`（必填，作为 `Error` 消息）。

**`shallowArrayEquals`｜3 秒上手** —— 长度相同且逐项 `Object.is` 相等：

```ts
shallowArrayEquals([1, 2], [1, 2]); // true
```

参数：`left: readonly T[]`、`right: readonly T[]`（均必填），无可选项。

**`computeUniqueKeys`｜5 秒上手** —— 计算并校验数组的 key 列表，出现重复 key 抛错：

```ts
computeUniqueKeys(todos, (t) => t.id, 'myList'); // 冻结的 Key[]
```

参数：`items`、`keyOf`、`label: string`（均必填）。

**`spliceInsert`｜3 秒上手** —— 不可变插入，返回新的冻结数组：

```ts
spliceInsert([1, 2], 3, 1); // [1, 3, 2]
```

参数：`list: readonly T[]`（必填）、`item: T`（必填）、`index: number`（必填，会被夹到 `[0, length]` 区间）。

**`filterOutKey`｜3 秒上手** —— 不可变删除匹配 key 的第一项：

```ts
filterOutKey(todos, (t) => t.id, 't1'); // { removed: boolean, next: readonly T[] }
```

参数：`list`、`keyOf`、`key`（均必填）。未删除任何项时 `next` 原样返回原引用。

**`replaceAtIndex`｜3 秒上手** —— 不可变按下标替换：

```ts
replaceAtIndex([1, 2, 3], 1, 9); // [1, 9, 3]
```

参数：`list: readonly T[]`、`index: number`、`value: T`（均必填）。

**`KeyedSplitCache`｜10 秒上手** —— `splitDef` 内部用的 key→token 缓存，`of(key, create)` 取即建：

```ts
const cache = new KeyedSplitCache<string, MyToken>();
const token = cache.of('k1', () => makeToken('k1'));
```

构造无参数。方法：`get(key)`（读缓存，不创建）、`of(key, create)`（缓存未命中时调用 `create()` 并存入）、`prune(isLive, shouldEvict?, onEvict?)`——`isLive: (key) => boolean`（必填）判断 key 是否仍存在，`shouldEvict?: (item) => boolean`（可选，默认 `() => true`）按项决定是否真的淘汰，`onEvict?: (item) => void`（可选，删除前回调，用于自行释放被淘汰的项）；只读 `size`；`keys()`/`values()` 迭代器；`clear()` 清空全部。

---

<a id="definition-family"></a>

## Definition Family

```ts
import { familyDef, derivedFamilyDef } from '@migaia/store-keyed';
```

按业务 key（对话 id、频道 id）产出定义 token——family 只缓存 token，token 落到哪个 `AtomStore` 才决定它在哪个作用域下有一份独立的值。

**`familyDef`｜5 秒上手** —— 按 key 产出可写源定义：

```ts
const sessionByChat = familyDef((chatId: string) => ({ messages: [] }));
const def = sessionByChat('chat-1'); // 同一个 key 永远拿到同一个 token
```

全部选项（第二参数 `IFamilyDefOptions`）：

- `maxSize?: number` —— 默认 `4096`，定义强缓存上限；必须是正整数，否则抛 `RangeError('[store] family maxSize must be a positive integer')`
- `debugLabel?: string` —— 默认 `'family'`；必须是字符串

内部对每个 key 产出 `atomDefFactory(() => initial(key), ...)`，`kind` 恒为 `'primitive-factory'` 且 `previewSafe: false`。

**`derivedFamilyDef`｜5 秒上手** —— 按 key 产出只读派生定义：

```ts
const doneCountByChat = derivedFamilyDef(
  (chatId: string) => (get) => get(sessionByChat(chatId)).messages.length
);
```

全部选项同 `familyDef`（`maxSize?`/`debugLabel?`，默认 `debugLabel` 为 `'derived-family'`）。第一参数 `read: (key) => (get: IAtomGet) => T`（必填）。

两者返回的 `IFamilyDef<K, T, D>` 都额外暴露：

- `family.size`（只读）—— 当前强缓存条目数
- `family.forget(key: K): boolean` —— 显式打破该 key 的 canonical identity；已建 `AtomStore` 实例不受影响，同 key 之后再查会得到新 token
- `family.clear(): void` —— 清空全部缓存条目

超出 `maxSize` 时按最久未取用降级为弱引用（`WeakMap<Key, WeakRef<Definition>>`）：只要 token 仍被强引用着（例如已被某个 `AtomStore` 实例化），后续同 key 查找仍能命中同一个 token；真正被 GC 后同 key 才会创建新 token。这套机制需要宿主支持 `WeakRef`/`FinalizationRegistry`，缺失时 `familyDef(...)`/`derivedFamilyDef(...)` 调用本身直接抛 `Error('[store] family definitions require WeakRef and FinalizationRegistry; enable these capabilities in the host sandbox')`。`IFamilyKey = string | number | symbol`。

---

<a id="错误工具"></a>

## 错误工具

```ts
import {
  createStoreKeyedError,
  createStoreKeyedRangeError,
  createStoreKeyedTypeError,
  createStoreKeyedAggregateError,
  StoreKeyedErrorCode,
  STORE_KEYED_SOURCE
} from '@migaia/store-keyed';
```

包内部用来构造带 `(source, code)` 身份的错误；一般应用代码只需要读取捕获到的错误上的 `code`/`source` 字段做分支，构造函数主要面向在本包基础上二次封装的场景。

**`createStoreKeyedError`｜5 秒上手**：

```ts
throw createStoreKeyedError(StoreKeyedErrorCode.invalidOption, 'bad input');
```

全部参数：`code: IStoreKeyedErrorCode`（必填）、`message: string`（必填）、`options?: { cause?: unknown }`（可选）。返回原生 `Error`，带 `source: '@migaia/store-keyed'` 与 `code`。

**`createStoreKeyedRangeError`｜3 秒上手** / **`createStoreKeyedTypeError`｜3 秒上手** —— 参数与返回类型（`RangeError`/`TypeError`）之外与上面完全一致：

```ts
throw createStoreKeyedRangeError(StoreKeyedErrorCode.invalidOption, 'maxSize must be positive');
throw createStoreKeyedTypeError(StoreKeyedErrorCode.invalidOption, 'not a definition');
```

**`createStoreKeyedAggregateError`｜5 秒上手** —— 多项失败时打包成 `AggregateError`：

```ts
throw createStoreKeyedAggregateError(
  StoreKeyedErrorCode.disposalFailed,
  [err1, err2],
  'disposal failed'
);
```

全部参数：`code: IStoreKeyedErrorCode`（必填）、`errors: unknown[]`（必填）、`message: string`（必填）。

**`StoreKeyedErrorCode`｜3 秒上手** —— 稳定错误码表，用于 `switch`/比较：

```ts
if (error.code === StoreKeyedErrorCode.atomStoreDisposed) {
  /* ... */
}
```

全部取值：`atomStoreDisposed`(`ATOM_STORE_DISPOSED`)、`familyDisposed`(`FAMILY_DISPOSED`)、`disposalFailed`(`DISPOSAL_FAILED`)、`evictionFailed`(`EVICTION_FAILED`)、`circularPreview`(`CIRCULAR_PREVIEW`)、`cyclicOverride`(`CYCLIC_OVERRIDE`)、`overrideContract`(`OVERRIDE_CONTRACT`)、`previewUnsafe`(`PREVIEW_UNSAFE`)、`crossRuntime`(`CROSS_RUNTIME`)、`envUnsupported`(`ENV_UNSUPPORTED`)、`invalidOption`(`INVALID_OPTION`)。

**`STORE_KEYED_SOURCE`｜3 秒上手** —— 字符串常量 `'@migaia/store-keyed'`，无调用参数：

```ts
error.source === STORE_KEYED_SOURCE;
```

---

<a id="reactiveatom-子路径"></a>

## `@migaia/store-keyed/reactive/atom`

```ts
import type {
  IReadableAtom,
  IWritableAtom,
  IAtomGetter,
  IAtomSetter
} from '@migaia/store-keyed/reactive/atom';
import { atomGetter, atomSetter } from '@migaia/store-keyed/reactive/atom';
```

"实例式" atom 的协议类型与跨 Runtime 校验，本包不提供任何具体实现——这个子路径独立于主入口，因为 async/family/react 等上层包只需要认识这套类型，不需要认识 `atom/store.ts` 里的实例化策略。

**`atomGetter`｜5 秒上手** —— 构造一个绑定到指定 Runtime 的 getter：

```ts
const get = atomGetter(runtime);
get(someInstanceAtom); // 读取前校验 atom.runtime === runtime
```

单参数 `runtime: IRuntime`（必填）。跨 Runtime 读取抛 `Error('[store] cross-runtime atom access is not allowed')`。

**`atomSetter`｜5 秒上手** —— 同上，写入版：

```ts
const set = atomSetter(runtime);
set(someWritableInstanceAtom, nextValue);
```

单参数 `runtime: IRuntime`（必填），跨 Runtime 校验同上。

类型：`IReadableAtom<T> = IDisposable & { runtime, atomDefinition?: IAtomDefinition<any>, value: T, observed: boolean, read(), peek() }`；`IWritableAtom<T, Args, Result> = IReadableAtom<T> & { write(...args): Result }`；`IAtomGetter = <T>(atom) => T`；`IAtomSetter = <T, Args, Result>(atom, ...args) => Result`。`atomDefinition` 是可选的桥接字段，供 Provider 级 React 适配层从实例式 atom 反查其背后的纯定义。

---

<a id="子路径别名"></a>

## 子路径别名：`atom/store`、`atom/definition`

```ts
import { createAtomStore, defaultAtomStore } from '@migaia/store-keyed/atom/store';
import { atomDef, derivedDef, writableDef } from '@migaia/store-keyed/atom/definition';
```

分别是 [AtomStore](#atomstore) 与 [Definition 层](#definition-层) 的窄导出——内容与主入口对应导出完全相同，仅在只想引入这两层、不想连带引入 optics/family 时使用，不引入新 API。

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. 每个会话一份状态 + 字段可独立订阅 + 列表按 key 拆分

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

const sessionDef = atomDef<ISessionState>({ user: { name: 'guest' }, todos: [] });
const userNameDef = focusDef(sessionDef, 'user', 'name');
const todosSplit = splitDef(focusDef(sessionDef, 'todos'), (todo) => todo.id);
const doneCountDef = derivedDef(
  (get) => get(focusDef(sessionDef, 'todos')).filter((todo) => todo.done).length
);

const runtime = createRuntime();
const store = createAtomStore(runtime);

store.set(userNameDef, 'ada');
todosSplit.insert(store, { id: 't1', text: '写文档', done: false });
store.set(todosSplit.of('t1'), (previous) => ({ ...previous, done: true }));
console.log(store.get(doneCountDef)); // 1

store.dispose(); // 释放这个作用域建出的全部实例
```

### 2. 按 key 产出的 family，跨会话共享定义但各自独立取值

```ts
import { createAtomStore, familyDef } from '@migaia/store-keyed';
import type { IRuntime } from '@migaia/reactive';

const sessionByChatId = familyDef((chatId: string) => ({ messages: [] as string[] }));

function openChat(runtime: IRuntime, chatId: string) {
  const store = createAtomStore(runtime);
  const state = sessionByChatId(chatId); // 同一 chatId 在任意作用域下都是同一个 token
  store.set(state, (previous) => ({ messages: [...previous.messages, 'hi'] }));
  return store;
}
```

### 3. 测试期用 `override` 替身某个派生定义

```ts
import { createAtomStore, derivedDef } from '@migaia/store-keyed';
import { createRuntime } from '@migaia/reactive';

const store = createAtomStore(createRuntime());
const undo = store.override(
  doneCountDef,
  derivedDef(() => 999)
);
console.log(store.get(doneCountDef)); // 999
undo(); // 撤销后状态原样保留
```

### 4. 用底层 optics 工具函数手写自定义拆分逻辑

```ts
import { findKeyIndex, replaceAtIndex, spliceInsert } from '@migaia/store-keyed';

const todos = [{ id: 't1', done: false }];
const index = findKeyIndex(todos, (t) => t.id, 't1');
const next = replaceAtIndex(todos, index, { id: 't1', done: true });
const withNew = spliceInsert(next, { id: 't2', done: false }, Infinity);
```

### 5. 捕获包边界错误并按 `code` 分支处理

```ts
import { StoreKeyedErrorCode } from '@migaia/store-keyed';

try {
  store.set(readOnlyDerivedDef as never, 1);
} catch (error) {
  if ((error as { code?: string }).code === StoreKeyedErrorCode.overrideContract) {
    // 处理"写契约不匹配"
  }
}
```

---

<a id="构建门禁"></a>

## 构建门禁

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```

浏览器集成路径另跑：

```bash
pnpm run typecheck:e2e && pnpm run test:e2e
```
