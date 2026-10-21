# `@migaia/store-indexed`

用显式方法按对象字段、数组下标或 Map/Set 成员建立依赖，让观察者只接收对应读取的变化。

## 你可能遇到过

- 只改年龄，姓名视图也重新运行：整个对象共用一个订阅。
- 改了一行内容，行数显示也跟着刷新：列表位置和值没有分开观察。
- 替换数据源读到一半失败，旧列表也丢了：清空旧值早于完整读取新输入。
- 导航次序已经改变，界面却保留旧顺序：替换时只比较成员，不比较插入顺序。
- 关闭一份选择列表，其他状态也失效：集合与借入运行时的清理责任混在一起。

## 为什么选它

- **只订阅需要的字段，并明确标出旁读。** get 追踪所选键，peek 不建立依赖，见[只订阅一个字段并旁读其他字段](./USEGUIDE.md#只订阅一个字段并旁读其他字段)。
- **把一行内容与列表长度分开更新。** at 订阅下标，length 订阅结构，见[分开观察一行下标与列表长度](./USEGUIDE.md#分开观察一行下标与列表长度)。
- **替换输入失败时保留完整旧集合。** replace 先完整物化输入再提交，并在 cause 保留迭代原错，见[替换输入读取失败时保留旧数组](./USEGUIDE.md#替换输入读取失败时保留旧数组)。
- **区分值修改与插入顺序变化。** Map 把键结构和值迭代分开，replace 还比较顺序，见[分别观察键顺序与值的变化](./USEGUIDE.md#分别观察键顺序与值的变化)。
- **观察一个成员，并独立结束集合的生命周期。** Set.has 按成员追踪，集合 dispose 只释放自身信号而不销毁借入运行时，见[只观察一个选中成员并独立释放集合](./USEGUIDE.md#只观察一个选中成员并独立释放集合)。

## 从这里开始

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

下一步：需要区分行与长度看[下标观察](./USEGUIDE.md#分开观察一行下标与列表长度)，需要整批换数据看[失败替换](./USEGUIDE.md#替换输入读取失败时保留旧数组)。

## 手写时的隐患

下面用原生对象和统一回调集合表示同一场景，只展示、不执行；两处注释标出全量通知与清理责任。

```ts doc-test=check
const user = { name: '艾达', age: 30 }
const subscribers = new Set<() => void>()
function observe(callback: () => void) {
  subscribers.add(callback) // 隐患：没有退订句柄，观察者会一直留在集合里。
  callback()
}
function set<K extends keyof typeof user>(key: K, value: (typeof user)[K]) {
  user[key] = value
  for (const run of subscribers) run() // 隐患：任意字段写入都通知姓名观察者。
}
observe(() => console.log(user.name))
set('age', 31)
```

## 三分钟心智模型

先选对应的数据形状，在同一个 Runtime 里创建集合与观察者，用 get/at/has 读取需要追踪的部分，用 peek 旁读，最后释放观察者与集合。

| 要解决的问题 / 术语       | 对应工具                                   | 白话含义                           |
| ------------------------- | ------------------------------------------ | ---------------------------------- |
| 只观察一个值 / cell       | Object.get、Array.at、Map.get/has、Set.has | 某个键、位置或成员自己的响应式格子 |
| 观察数量或排列 / 结构     | length、size、keys                         | 关心有哪些位置、键、成员及其顺序   |
| 观察全部内容 / 修订、迭代 | snapshot、valuesArray、entries             | 值变化后重新生成整体视图           |
| 读取但不订阅 / peek       | Object.peek、Array.peek、Map.peek          | 这次读取不成为观察者依赖           |
| 一起提交 / batch          | 集合写方法内的 runtime.batch               | 观察者不会看到同次写入的中间状态   |
| 结束使用 / dispose        | 先 observer.dispose，再 collection.dispose | 断开观察关系并释放内部信号         |

## 典型场景

| 场景                             | 怎么组合                                              | 详细说明                                                   |
| -------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------- |
| 只订阅一个字段并旁读其他字段     | `ObservableObject → get / peek → set`                 | [完整示例](./USEGUIDE.md#只订阅一个字段并旁读其他字段)     |
| 保留旧顶层快照并看清浅复制边界   | `snapshot → set → snapshot`                           | [完整示例](./USEGUIDE.md#保留旧顶层快照并看清浅复制边界)   |
| 分开观察一行下标与列表长度       | `ObservableArray → at / length → set / push / splice` | [完整示例](./USEGUIDE.md#分开观察一行下标与列表长度)       |
| 替换输入读取失败时保留旧数组     | `replace(iterable) → catch → replace(array)`          | [完整示例](./USEGUIDE.md#替换输入读取失败时保留旧数组)     |
| 分别观察键顺序与值的变化         | `ObservableMap → keys / valuesArray → replace`        | [完整示例](./USEGUIDE.md#分别观察键顺序与值的变化)         |
| 只观察一个选中成员并独立释放集合 | `ObservableSet → has → dispose`                       | [完整示例](./USEGUIDE.md#只观察一个选中成员并独立释放集合) |

## 安装

```bash
pnpm add @migaia/store-indexed @migaia/reactive
```

示例直接导入 reactive 创建独立 Runtime，因此显式安装；集合自身也可省略 runtime 使用 defaultRuntime。

## 常用 API

| API                                               | 用途                         |
| ------------------------------------------------- | ---------------------------- |
| `new ObservableObject(initial,runtime?,options?)` | 按字符串字段读写             |
| `new ObservableArray(initial?,runtime?,options?)` | 按位置观察列表               |
| `new ObservableMap(initial?,runtime?,options?)`   | 按任意 key 观察值与迭代      |
| `new ObservableSet(initial?,runtime?,options?)`   | 按成员观察选择状态           |
| `get / at / has / peek / snapshot`                | 选择依赖粒度与复制边界       |
| `dispose()`                                       | 结束集合，不销毁借入 Runtime |

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
