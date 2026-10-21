# `@migaia/store-indexed` 使用指南

先按场景选择，再查看后半部分的完整方法、追踪与清理契约。每个示例独立运行；输出包括观察函数第一次执行。

## 按场景查找

| 场景                             | API                | 详细说明                                      |
| -------------------------------- | ------------------ | --------------------------------------------- |
| 只订阅一个字段并旁读其他字段     | `ObservableObject` | [完整示例](#只订阅一个字段并旁读其他字段)     |
| 保留旧顶层快照并看清浅复制边界   | `ObservableObject` | [完整示例](#保留旧顶层快照并看清浅复制边界)   |
| 分开观察一行下标与列表长度       | `ObservableArray`  | [完整示例](#分开观察一行下标与列表长度)       |
| 替换输入读取失败时保留旧数组     | `ObservableArray`  | [完整示例](#替换输入读取失败时保留旧数组)     |
| 分别观察键顺序与值的变化         | `ObservableMap`    | [完整示例](#分别观察键顺序与值的变化)         |
| 只观察一个选中成员并独立释放集合 | `ObservableSet`    | [完整示例](#只观察一个选中成员并独立释放集合) |

## 运行准备

```bash
pnpm add @migaia/store-indexed @migaia/reactive
```

出现 createRuntime 的场景直接导入 reactive；`schedulerStrategy: (run) => run()` 同步调用当前 flush 回调且返回 void，让计数确定。该字段省略时，默认通过 Runtime adapter 的 scheduleMicrotask 请求冲刷。集合参数与 Runtime 的调度参数各自归属不同；示例中的观察函数首次运行即计一次，末尾释放其返回句柄。

## 只订阅一个字段并旁读其他字段

资料视图显示姓名，同时读取年龄作本地判断；修改年龄不应重新运行姓名视图，修改姓名才需要更新。

订阅整个对象信号会把所有字段绑到同一次更新；无意中追踪年龄读取，也会给视图增加本来不需要的依赖。

用 `ObservableObject.get` 订阅所需字段，用 `peek` 旁读其他字段；直接安装 `@migaia/reactive`，本例的 `schedulerStrategy` 是运行时选项，用同步执行让输出顺序确定。

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { ObservableObject } from '@migaia/store-indexed'

const runtime = createRuntime({ schedulerStrategy: (run) => run() })
const user = new ObservableObject({ name: '艾达', age: 30 }, runtime)
const seen: string[] = []
const watch = runtime.effect(() => {
  seen.push(user.get('name'))
  user.peek('age')
})
user.set('age', 31)
user.set('name', '格蕾丝')
console.log(JSON.stringify(seen))
watch.dispose()
user.dispose()
```

输出：

```text
["艾达","格蕾丝"]
```

输出 `["艾达","格蕾丝"]`；年龄写入没有新增观察记录，姓名写入只追加一个新值。

只有追踪上下文中的 `get` 才订阅该键，`peek` 始终不追踪；`Object.has` 与 `keys` 则订阅整组键的结构，本例借用运行时，并显式释放观察者与集合。

### 示例参数

`initial` 是必填的姓名/年龄对象；`runtime` 使用本例 createRuntime 的实例，省略则 defaultRuntime。options 省略为 `{}`，mutationGuard 为 undefined，debugName 默认为 `'ObservableObject'`。get/set/peek 的 key 均为 initial 推导出的字符串键，set 接受该字段类型。

## 保留旧顶层快照并看清浅复制边界

历史面板需要保留此前顶层字段的值，也需要知道修改嵌套对象是否会改变那份旧记录。

直接保留底层对象引用，会在字段重新赋值后丢失历史；仅冻结外层结构，也不会让引用到的嵌套对象变成不可变数据。

`ObservableObject.snapshot` 返回浅冻结、空原型的对象，并在集合修订变化前复用缓存；它能保留旧顶层值，需要独立的嵌套数据时仍须由应用复制。

```ts doc-test=run
import { ObservableObject } from '@migaia/store-indexed'

const nested = { visits: 1 }
const user = new ObservableObject({ count: 1, nested })
const first = user.snapshot()
console.log(
  Object.isFrozen(first),
  Object.getPrototypeOf(first) === null,
  first === user.snapshot()
)
user.set('count', 2)
const second = user.snapshot()
console.log(first.count, second.count, first === second)
nested.visits = 9
console.log(first.nested.visits, second.nested.visits)
user.dispose()
console.log(first.count)
```

输出：

```text
true true true
1 2 false
9 9
1
```

逐行输出 `true true true`、`1 2 false`、`9 9`、`1`；修订未变时复用同一冻结结果，顶层赋值后产生新快照，但两者仍引用同一个嵌套对象。

集合释放后快照仍可读取；浅冻结不提供嵌套数据的历史版本，省略运行时时使用 `defaultRuntime`，省略集合选项时不设置 `mutationGuard`，诊断名使用类名。

### 示例参数

nested 对象属于应用，构造、snapshot、set 均不深拷贝它。省略 runtime/options 使用 defaultRuntime、无 guard 与类名诊断前缀；count 顶层赋值会产生新 revision，nested.visits 原地修改不会。

## 分开观察一行下标与列表长度

表格观察第一行并显示总行数；修改其他行不应影响这两处观察，追加行则只需更新数量。

观察整个数组会把每次编辑都当成列表变化；把下标当作稳定记录 ID，也会在删除首项、后续值向前移动时出错。

`ObservableArray.at` 订阅下标，`length` 订阅结构；本例直接安装并传入 `@migaia/reactive` 的运行时，用其同步 `schedulerStrategy` 明确展示观察次数。

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { ObservableArray } from '@migaia/store-indexed'

const runtime = createRuntime({ schedulerStrategy: (run) => run() })
const rows = new ObservableArray([10, 20], runtime)
let indexRuns = 0
let lengthRuns = 0
const indexWatch = runtime.effect(() => {
  rows.at(0)
  indexRuns += 1
})
const lengthWatch = runtime.effect(() => {
  void rows.length
  lengthRuns += 1
})
rows.set(1, 21)
console.log(indexRuns, lengthRuns)
rows.set(0, 11)
console.log(indexRuns, lengthRuns)
rows.push(30)
console.log(indexRuns, lengthRuns)
rows.splice(0, 1)
console.log(indexRuns, lengthRuns, rows.at(0))
indexWatch.dispose()
lengthWatch.dispose()
rows.dispose()
```

输出：

```text
1 1
2 1
2 2
3 3 21
```

逐行输出 `1 1`、`2 1`、`2 2`、`3 3 21`；旁边一行的修改被忽略，下标 `0` 独立更新，追加只更新长度，删除首项后 `21` 移入观察位置。

下标表示位置，不表示实体；`set` 只接受已有范围内的非负整数，`at` 还接受负整数，次数均包括首次运行观察函数，本例只借用运行时。

### 示例参数

initial 是可迭代数值序列，省略为 `[]`；runtime 显式传入，options 默认 `{}`、无 guard、debugName 为 `'ObservableArray'`。at 支持整数负下标，set 仅已有非负整数；push 使用 rest 参数，splice 本例 start=0/deleteCount=1。

## 替换输入读取失败时保留旧数组

替换数据源先产出一行，随后读取失败；界面集合应保留完整旧内容，不能只显示读到一半的新输入。

在消费迭代器前清空旧列表，等于过早提交；每拿到一项就追加，也会在下一次迭代抛错时暴露半份结果。

`ObservableArray.replace` 先完整读取可迭代输入，再提交替换；本例让真实生成器产出一项后抛错，随后再传入合法替换值。

```ts doc-test=run
import { ObservableArray } from '@migaia/store-indexed'

const rows = new ObservableArray([1, 2])
const original = new Error('输入中断')
function* incoming(): Generator<number> {
  yield 3
  throw original
}
try {
  rows.replace(incoming())
} catch (error) {
  if (!(error instanceof Error) || !('code' in error)) throw error
  console.log(error.code, error.cause === original)
}
console.log(JSON.stringify(rows.snapshot()))
rows.replace([4, 5])
console.log(JSON.stringify(rows.snapshot()))
rows.dispose()
```

输出：

```text
INVALID_OPTION true
[1,2]
[4,5]
```

逐行输出 `INVALID_OPTION true`、`[1,2]`、`[4,5]`；迭代错误保留在 `cause`，失败输入没有提交半份替换，之后合法输入仍能成功。

原子准备只保证当前集合不被部分修改，不撤销迭代器自身的副作用；替换保留嵌套值引用，也接受按字符迭代的字符串，等长输入仍须比较各项值。

### 示例参数

replace 的 values 是完整可迭代输入；默认构造 runtime 为 defaultRuntime，options 无 guard、debugName 为 `'ObservableArray'`。incoming 在产出一个值后抛出应用错误，catch 校验 code 与 cause 身份；有效数组替换随后仍可用。

## 分别观察键顺序与值的变化

导航列表需要映射的键，摘要区域需要值；更新已有值时，应刷新摘要，而不必重建键列表。

订阅整个映射无法区分值修改与结构变化；只比较成员是否相同，又会漏掉同一批条目调整插入顺序的替换。

`ObservableMap.keys` 订阅结构，`valuesArray` 订阅值迭代，`replace` 也检查插入顺序；直接安装 `@migaia/reactive`，本例选用同步运行时调度来展示准确次数。

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { ObservableMap } from '@migaia/store-indexed'

const runtime = createRuntime({ schedulerStrategy: (run) => run() })
const values = new ObservableMap<string, number>(
  [
    ['a', 1],
    ['b', 2]
  ],
  runtime
)
let keyRuns = 0
let valueRuns = 0
const keysWatch = runtime.effect(() => {
  values.keys()
  keyRuns += 1
})
const valuesWatch = runtime.effect(() => {
  values.valuesArray()
  valueRuns += 1
})
values.set('a', 10)
console.log(keyRuns, valueRuns)
values.replace([
  ['b', 2],
  ['a', 10]
])
console.log(keyRuns, valueRuns, JSON.stringify(values.keys()), JSON.stringify(values.valuesArray()))
values.replace([
  ['b', 2],
  ['a', 10]
])
console.log(keyRuns, valueRuns)
keysWatch.dispose()
valuesWatch.dispose()
values.dispose()
```

输出：

```text
1 2
2 3 ["b","a"] [2,10]
2 3
```

逐行输出 `1 2`、`2 3 ["b","a"] [2,10]`、`2 3`；修改 `a` 只更新值观察者，重排分别更新两者一次，重复相同有序内容则都不更新。

`size` 也订阅结构，重排时即使数量不变仍可能重跑；`Map.has` 复用所选键的值信号，因此同键换值也可能让它重跑，它不是独立的仅成员存在性信号。

### 示例参数

initial 为 `[key,value]` 可迭代条目，省略为空表；本例显式传 runtime，options 默认无 guard 与 `'ObservableMap'` 诊断名。set 的两个参数分别是 key 与 value；replace 使用给定条目的插入顺序，重复相同有序内容不通知。

## 只观察一个选中成员并独立释放集合

选择标记只关心条目 `a`，用户还会选择其他条目；关闭这份集合，也不能关闭其他应用状态共用的运行时。

观察整个 `Set` 会在每次无关选择时重跑标记；把借用的运行时和单个集合一起销毁，又会破坏运行时的其他使用者。

`ObservableSet.has` 订阅单个成员，显式释放观察者和集合后，传入的运行时仍可使用；直接安装 `@migaia/reactive`，同步运行时调度仅用于本例展示。

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { ObservableSet } from '@migaia/store-indexed'

const runtime = createRuntime({ schedulerStrategy: (run) => run() })
const selected = new ObservableSet(['a'], runtime)
let runs = 0
let present = false
const watch = runtime.effect(() => {
  present = selected.has('a')
  runs += 1
})
selected.add('b')
console.log(runs, present)
selected.delete('a')
console.log(runs, present)
selected.add('a')
console.log(runs, present)
watch.dispose()
selected.dispose()
selected.dispose()
const count = runtime.signal(1)
count.value = 2
console.log(selected.disposed, count.value)
count.dispose()
```

输出：

```text
1 true
2 false
3 true
true 2
```

逐行输出 `1 true`、`2 false`、`3 true`、`true 2`；添加 `b` 不重跑 `a` 的观察者，删除与恢复 `a` 会更新，幂等释放集合后，新建的运行时信号仍能使用。

集合拥有内部信号，不拥有运行时或嵌套应用对象；先释放观察者，集合释放后的数据访问会抛 `COLLECTION_DISPOSED`，`disposed` 状态本身仍可读取。

### 示例参数

initial 默认 `[]`，本例传入成员 `'a'`；runtime 显式借入，options 默认无 guard 与 `'ObservableSet'` 诊断名。has/add/delete 参数是成员值；dispose 没有参数，重复为空操作。最后 runtime.signal(1) 创建独立的值格子，证明运行时仍可使用。

## 契约细节

### 归属、入口与适用范围

本包只有根导出，提供四个集合类、`IObservableCollectionOptions`、`IndexedOperation`/`IIndexedOperation` 和错误码/错误构造函数。内部 cell pool 与 registry 不是导入入口。普通 dependencies 为 `@migaia/reactive`、`@migaia/utils`、`@migaia/store-light`；后者在集合代码中仅提供 `IMutationGuard` 类型，没有 peerDependencies。示例直接导入 reactive，安装时也要显式列出它。

适合表格行、消息列表等只观察部分位置的集合。只需一个整体值时，`runtime.signal(value)` 更直接。四类都用命名方法建立依赖，不拦截用户对象的属性访问；嵌套对象的原地修改不自动成为集合写入。数组按位置定位，splice/pop/replace 后同一索引可以表示另一条记录；按稳定实体标识定位时，应由应用选择按 key 的集合。

### 构造、参数与输入接纳

唯一创建入口是类构造，参数统一为 `(initial, runtime?, options?)`。旧薄工厂已经移除；原 `(initial, options, runtime)` 调用迁移时交换后两参数，没有工厂别名或兼容 wrapper。

| 类与类型参数                                          | initial                                             | 默认值与边界                                                                |
| ----------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------- |
| `ObservableObject<T extends Record<string, unknown>>` | 必填 T                                              | 读取自有可枚举字符串键及其值；键类型为 `keyof T & string`，符号键不进入集合 |
| `ObservableArray<T>`                                  | 可选 `Iterable<T>`                                  | 默认 `[]`，接受字符串并按字符物化                                           |
| `ObservableMap<K,V>`                                  | 可选 `ReadonlyMap<K,V> 或 Iterable<readonly [K,V]>` | 默认 `[]`；条目按原生 Map 规则接纳，拒绝字符串作为外层输入                  |
| `ObservableSet<T>`                                    | 可选 `Iterable<T>`                                  | 默认 `[]`，接受字符串，成员按原生 Set 规则去重                              |

四类的 `runtime` 默认 `defaultRuntime`，绑定后不转移；公开只读 `runtime` 和 `disposed:boolean`。默认 `options={}`：

| 字段                             | 默认值                           | 行为                                                |
| -------------------------------- | -------------------------------- | --------------------------------------------------- |
| `mutationGuard?: IMutationGuard` | `undefined`，无 guard            | 每次写入入口调用 `assertMutationAllowed(operation)` |
| `debugName?: string`             | 对应类名，如 `'ObservableArray'` | Signal 调试名前缀、disposed 信息与 guard 操作名前缀 |

options 为 null/非 object、debugName 非 undefined 且非 string，或读取选项失败，抛带 `INVALID_OPTION` 的 TypeError；读取失败的原错在 cause。构造先读完整初值，再接纳集合的 Runtime 所有权。Object 的 getter、Iterable 的 `Symbol.iterator` getter/调用/next、Map 条目形状失败也归 `INVALID_OPTION`，原错通过 cause 保留。迭代器入口 getter 和捕获的函数各使用一次，函数以原 iterable 为 receiver。replace 也先物化全部输入，输入失败不提交部分替换。

### 追踪与通知

cell 是“某个 key、索引或成员自己的响应式格子”。Object.get、Array.at、Map.get/has、Set.has 只在集合 Runtime 正在追踪时才物化对应 cell；普通同步读取直接访问 backing data，不创建 cell。peek 是显式非追踪读取，即使在 effect/computed 中也不建立依赖；Set 没有 peek。

| 读取                                       | 建立的依赖                                              |
| ------------------------------------------ | ------------------------------------------------------- |
| Object.get(key)                            | 此 key 的值 cell                                        |
| Object.has(key)、Object.keys()             | 全部 key 的结构信号；其他 key 增删也会触发 has 的观察者 |
| Object.snapshot()                          | 修订信号，任意实际值或键变化                            |
| Array.at(index)                            | 有效位置的值 cell；负索引及越界读取还依赖长度结构       |
| Array.length / snapshot()                  | 长度结构 / 整体修订                                     |
| Map.get(key)、Map.has(key)                 | 同一个 key 的值 cell；has 也会因该 key 的已有值改变重算 |
| Map.size / keys()                          | key 集合及插入顺序的结构信号                            |
| Map.valuesArray() / entries() / snapshot() | 值与迭代顺序的迭代信号                                  |
| Set.has(value)                             | 该成员自己的 boolean cell                               |
| Set.size / valuesArray() / snapshot()      | 成员与顺序的结构信号                                    |

追踪型读取不能接入另一个 Runtime 的依赖图；本包检测的跨图读取为 `CROSS_RUNTIME`，底层 reactive 检测的失败保留其实际错误归属。普通非追踪读取与 peek 可以跨 Runtime 取值。多请求或多应用隔离应显式构造 Runtime，并把对应观察者放进同一 Runtime。

keys() 仍会分配键数组，且在追踪中订阅结构；它不是零成本遍历。peek 不建 cell，但 Array.peek() 会复制整个数组。replace 只逐个通知已经物化的 cell；等长 Array 仍可能比较全部值，Map/Set 仍比较内容与顺序，不承诺常数开销或某个速度。

### ObservableObject 方法

| 方法                                                                  | 返回与行为                                                                  |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `get<K extends keyof T & string>(key:K):T[K]` / `peek<K>(key:K):T[K]` | 追踪 / 非追踪读取；删除后运行时可为 undefined，即使静态 T[K] 未含 undefined |
| `has(key:keyof T & string):boolean`                                   | 判断键是否存在，追踪整体结构                                                |
| `set<K>(key:K,value:T[K]):void`                                       | batch 内更新；新增键升结构，新增或 Object.is 不等的值升修订                 |
| `update<K>(key:K,updater:(value:T[K])=>T[K]):void`                    | 先 guard，再校验/调用 updater，再提交；updater 非函数为 INVALID_OPTION      |
| `delete(key):boolean`                                                 | 返回是否存在；缺失键不通知，存在则发布缺失值并提升结构/修订                 |
| `keys():readonly (keyof T & string)[]`                                | 当前键数组                                                                  |
| `snapshot():Readonly<T>`                                              | 按 revision 缓存、浅冻结、空原型对象                                        |
| `replace(next:T):void`                                                | 先读取所有属性，再一次 batch 删除缺失键、设置新值；只调用一次 guard         |
| `prune():number`                                                      | 回收已删除且无观察者的 cell，返回回收数                                     |
| `dispose():void`                                                      | 幂等关闭                                                                    |

Object 的 key 必须是字符串，否则 INVALID_OPTION；使用固定字面量 T 时不能通过 set 的类型签名新增未声明键，需要开放键集合可显式使用 `Record<string, V>`。snapshot 用空原型对象，让 `__proto__` 成为普通数据键；冻结只覆盖外层对象，嵌套值仍是原引用。

### ObservableArray 方法

| 方法                                                                          | 返回与行为                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `length:number`                                                               | 追踪长度                                                    |
| `at(index:number):T 或 undefined`                                             | 整数索引，支持负数从末尾计数；越界返回 undefined 并追踪结构 |
| `snapshot():readonly T[]`                                                     | revision 缓存的浅冻结数组                                   |
| `peek():readonly T[]`                                                         | 每次复制并浅冻结，不追踪                                    |
| `set(index:number,value:T):void`                                              | 必须在 [0,length)；不支持负索引，Object.is 相等不通知       |
| `push(...values:readonly T[]):number`                                         | 返回新长度；空参数不通知                                    |
| `pop():T 或 undefined`                                                        | 移除末项；空数组不通知                                      |
| `splice(start:number,deleteCount?:number,...items:readonly T[]):readonly T[]` | 按原生 splice 位置转换，返回浅冻结的被删除数组              |
| `replace(values:Iterable<T>):void` / `clear():void`                           | 物化后替换 / replace([])                                    |
| `dispose():void`                                                              | 幂等关闭，没有手动 prune                                    |

at/set 的非整数索引为 TypeError `INVALID_INDEX`；set 越界为 RangeError `INDEX_OUT_OF_RANGE`。splice 省略 deleteCount 删除到末尾，显式 undefined 按 0；JavaScript 零参数调用是空操作。显式零删除且无插入同样不改变集合。splice/replace/clear 在一次 batch 更新已物化 cell，长度变化才通知结构，长度或逐项 Object.is 变化才升修订。set 也把值 cell 与修订放在同一 batch，同步观察者不会看到“新元素、旧快照”的混合状态。

### ObservableMap 方法

| 方法                                                              | 返回与行为                                                                 |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `size:number`                                                     | 追踪结构的当前大小                                                         |
| `get(key:K):V 或 undefined` / `peek(key:K):V 或 undefined`        | 追踪 / 非追踪按 key 读取                                                   |
| `has(key:K):boolean`                                              | 追踪该 key 的值 cell，不是只在存在性变化时通知                             |
| `set(key:K,value:V):this`                                         | 已有值 Object.is 相等时不通知，否则更新值 cell 与迭代；新增 key 也更新结构 |
| `delete(key:K):boolean`                                           | 缺失返回 false；存在则发布缺失并更新结构/迭代                              |
| `clear():void`                                                    | 空表无通知；非空在一次 batch 清空、更新已物化 cell、各升一次结构/迭代      |
| `replace(next:ReadonlyMap<K,V> 或 Iterable<readonly [K,V]>):void` | 完整物化后原子替换；key、值及插入顺序相同才不通知                          |
| `keys():readonly K[]`                                             | 当前 key 数组，追踪结构                                                    |
| `valuesArray():readonly V[]`                                      | 浅冻结值数组，追踪迭代                                                     |
| `entries():readonly (readonly [K,V])[]`                           | 外数组和每个二元组均冻结；key/value 本身不深拷贝                           |
| `snapshot():ReadonlyMap<K,V>`                                     | 每次新建普通 Map，未冻结，key/value 仍是原引用                             |
| `prune():number` / `dispose():void`                               | 已删除 dormant cell 整理 / 幂等关闭                                        |

原生 Map 的 key 身份规则仍适用。replace 即使成员和值未变，只要重新排序，keys/迭代/snapshot 的观察者仍会失效；单 key 观察不因此变成整个集合订阅。clear/replace 不逐 key 调用公开写方法，guard 只在入口执行一次。

### ObservableSet 方法

| 方法                                | 返回与行为                                  |
| ----------------------------------- | ------------------------------------------- |
| `size:number`                       | 追踪结构                                    |
| `has(value:T):boolean`              | 追踪此成员的 boolean cell                   |
| `add(value:T):this`                 | 已有成员不通知，否则发布 true 并升结构      |
| `delete(value:T):boolean`           | 缺失返回 false；存在则发布 false 并升结构   |
| `clear():void`                      | 空集无通知；一次 batch 清空并更新已物化成员 |
| `replace(next:Iterable<T>):void`    | 完整物化后替换；成员及插入顺序相同才不通知  |
| `valuesArray():readonly T[]`        | 浅冻结的当前成员数组                        |
| `snapshot():ReadonlySet<T>`         | 每次新建普通 Set，未冻结、成员不深拷贝      |
| `prune():number` / `dispose():void` | 已删除 dormant cell 整理 / 幂等关闭         |

Set 采用原生成员身份规则，值就是成员，没有单独的 revision/iteration 信号，也没有 get 或 peek。replace 的重排属于可观察变化；clear/replace 只调用一次 guard、最多提升一次结构信号。

### Cell 生命周期、清理与 guard

新 cell 在最后一个订阅者离开时尝试回收；从未成功接上观察者的临时 cell 通过所属 Runtime 的 idle 通道清理，默认微任务。删除成员时仍有观察者的 cell 保留并发布缺失值，直到退订。Object/Map/Set 的 prune 只整理已删除且无观察者的 key/member，不释放活观察者；Array 仅走自动路径。

集合不会感知组件卸载或请求结束，应用必须调用 dispose。dispose 通过集合 owner 同时释放仍拥有的 Signal 与 pool 引用，重复是空操作；随后数据读写及 prune 拒绝，但仍可读 runtime/disposed。借入 Runtime 不由集合销毁。它不承诺清空 backing data、清除已有快照或销毁应用对象。

guard 是同步写入许可检查，签名 `assertMutationAllowed(operation?:string):void`，每个公开写入入口调用一次，包括最终没有变化的写入；读方法不调用。操作名如 `users.set(u1)`，来自 debugName 与具体方法，不是 IndexedOperation 值。Object.update 的 guard 先于 updater；拒绝时 updater 不执行。可组合 store-middleware 的 MutationPolicy 与 runInAction，策略及 action 范围由那个包负责；使用它应另行安装该包。本包只保证外层提交没有发生，不回滚回调自己的外部副作用。

### 操作词表与错误

`IndexedOperation` 为消费方诊断/日志提供 `read:'read'`、`write:'write'`、`delete:'delete'`；`IIndexedOperation` 是这些值的联合。本包方法不直接引用该词表。

| StoreIndexedErrorCode 属性 | code                | 触发                                                                         |
| -------------------------- | ------------------- | ---------------------------------------------------------------------------- |
| invalidOption              | INVALID_OPTION      | options、初值、iterator、Map 条目、debugName、Object key 或 updater 形状无效 |
| collectionDisposed         | COLLECTION_DISPOSED | 关闭后的数据访问/变更                                                        |
| callbackFailed             | CALLBACK_FAILED     | 没有已有包身份的 guard/updater 失败                                          |
| indexOutOfRange            | INDEX_OUT_OF_RANGE  | Array.set 越界                                                               |
| invalidIndex               | INVALID_INDEX       | Array.at/set 非整数                                                          |
| crossRuntime               | CROSS_RUNTIME       | 本包检测到跨 Runtime 追踪读取                                                |

本包错误的 source 为 `STORE_INDEXED_SOURCE='@migaia/store-indexed'`。已有外包 source/code 保持实际 owner。未编码 guard/updater 原生错误可附码时保留原对象、类型、message、stack；不可附码或非 Error 值经 cause/errors 保留。不要依赖 message 分支，下面列出稳定诊断供定位：

| message                                                                                       | 场景                                        |
| --------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `[store] observable collection options must be an object`                                     | options 形状或读取失败                      |
| `[store] observable collection debugName must be a string`                                    | debugName 类型无效                          |
| `[store] observable collection input must be a non-null object or iterable`                   | 初值/替换输入、iterator 或 updater 形状失败 |
| `[store] ObservableObject key must be a string`                                               | Object 的 key 非字符串                      |
| `[store] cross-runtime dependency is not allowed: collection read belongs to another Runtime` | 本包检测到跨 Runtime 追踪                   |
| `[store] {debugName} is disposed`                                                             | 关闭后使用                                  |
| `[store] ObservableArray index out of range`                                                  | set 越界                                    |
| `[store] ObservableArray index must be an integer`                                            | at/set 非整数                               |
| `[store] collection callback failed`                                                          | 无法直接附身份时的 callback wrapper         |

三个公开错误工厂的 code 均为必填 `IStoreIndexedErrorCode`、message 为必填 string。`createStoreIndexedError(code,message,options?)` 返回原生 Error，`createStoreIndexedTypeError(...)` 返回 TypeError，options 默认 undefined、只有可选 cause；前者在 options 自有 cause 存在时转发，后者在 cause 非 undefined 时转发。`createStoreIndexedRangeError(code,message)` 返回 RangeError，无第三参数。三者附不可写 source/code，不改 stack；cause 不保证显示进顶层 stack 文本。

### 排查与开发命令

没有重算时检查读取是否发生在 effect/computed、是否误用 peek，以及新旧值是否 Object.is 相同。删除后仍能看到 cell 时先检查活跃观察者，prune 不能强制释放它。跨图错误应对齐 Runtime；不要绕过它把独立依赖图连起来。关闭后创建新集合。

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test && pnpm run build
```

浏览器集成另有 `pnpm run typecheck:e2e` 与 `pnpm run test:e2e`；这些命令存在不代表本次已运行。
