# `@migaia/store-persist`

把 Store、集合或单个键的快照接到存储后端，协调启动恢复、本地修改和有序写回。

## 你可能遇到过

- 存档恢复完成后用户刚改的字段又变回旧值，因为读取结果直接覆盖了启动后的内存状态。
- 坏存档还没查清就被默认值覆盖，因为“读取结束”被误当成“恢复成功”。
- 升级后旧字段没有转换，临时字段却进入了存档，因为 schema 迁移和写入裁剪没有分开。
- 购物车的 Map 保存后变成空对象，因为普通 JSON 不保留集合条目。
- 离开一个用户页面却影响其他用户的保存，因为整个定义族共用持久化生命周期。

## 为什么选它

- **恢复旧字段，同时保留启动后的本地修改。** 不直接用晚到存档覆盖整个对象，例子保留本地计数并恢复未改主题，再保存两者，见[同名场景](./USEGUIDE.md#恢复存档时保留启动期修改)。
- **恢复失败时先关闭写入，修复成功后再继续。** 不让默认状态提前覆盖坏存档，例子检查原档不变、相同错误对象和重试后的保存，见[同名场景](./USEGUIDE.md#修复坏存档后再恢复写入)。
- **版本转换与保存字段分别声明。** 不把旧结构当成新结构，也不每次保存全部会话状态，例子迁移主题并排除临时字段，见[同名场景](./USEGUIDE.md#迁移旧设置并只保存指定字段)。
- **集合条目由默认 codec 往返保存。** 不让普通 JSON 把 Map 静默变空，例子在新集合恢复书籍数量并移除过时键，见[同名场景](./USEGUIDE.md#完整恢复-map-条目)。
- **每个键的保存会话独立释放。** 不用一个族级开关耦合所有用户，例子停止一个键后另一个仍保存，且内存值继续可用，见[同名场景](./USEGUIDE.md#独立停止某个键的持久化)。

## 从这里开始

在 ESM 项目保存为 overview.ts，用 Node 24 运行；示例使用真实内存后端，内容只在该后端实例存活期间保留：

```bash
pnpm add @migaia/store-persist @migaia/store-light @migaia/storage-web
```

```ts doc-test=run
import { createStore } from '@migaia/store-light'
import { memoryStorageHost } from '@migaia/storage-web/memory'
import { persist } from '@migaia/store-persist/light'

const storage = memoryStorageHost()
const settings = createStore({ theme: 'light' })
const handle = persist(settings, { key: 'settings', storage })
await handle.ready
settings.theme = 'dark'
await handle.flush()
console.log('已保存：', (await storage.get('settings')) !== null)
handle.dispose()
await settings.$dispose()
storage.dispose()
```

输出：

```text
已保存： true
```

启动期修改被覆盖时看[恢复存档时保留启动期修改](./USEGUIDE.md#恢复存档时保留启动期修改)，读取失败时看[修复坏存档后再恢复写入](./USEGUIDE.md#修复坏存档后再恢复写入)。

key 是本例存档名，storage 为调用方创建的内存后端；persist 从 /light 子入口导入。默认 version 为 0、codec 为 defaultJsonCodec、debounceMs 为 0、partialize 为恒等，scheduler 为 systemScheduler；flush 会等待首次水合并检查是否失败，再等待写入结果。Store、handle 与 storage 的释放分别由调用方管理。

## 手写时的隐患

同一设置保存场景，只展示手写方式，不运行：

```ts doc-test=check
import { createStore } from '@migaia/store-light'
import { memoryStorageHost } from '@migaia/storage-web/memory'

const store = createStore({ count: 0 })
const storage = memoryStorageHost()
const off = store.$subscribe(() => {
  void storage.set('settings', JSON.stringify(store.$plain())) // 未串行，也不等待写入结果
})
void storage.get('settings').then((raw) => {
  if (raw !== null) store.$hydrate(JSON.parse(raw)) // 晚到存档可能覆盖本地新修改
})
store.count = 1
void off // 没有安排退订和资源释放
```

上一节通过 flush 等待持久化的实际写入结果，再分别释放保存句柄和业务资源；恢复时的字段协调则由共同引擎处理。手写片段只展示同一保存场景的隐患，不运行。

## 三分钟心智模型

| 状态形状或问题                       | 工具                          | 需要记住                                       |
| ------------------------------------ | ----------------------------- | ---------------------------------------------- |
| createStore 的扁平状态               | /light 的 persist             | $plain 保存，$hydrate 恢复。                   |
| ObservableObject / Array / Map / Set | /indexed 的 persistCollection | snapshot 跟踪，replace 恢复。                  |
| AtomStore 的一个可写定义             | /keyed 的 persistKeyed        | 显式 id，每个键各有 handle。                   |
| 删除一族存档                         | /keyed 的 clearFamily         | 不清内存，也不停止活跃 handle。                |
| 首次恢复或恢复重试                   | ready / retryHydrate          | ready 不会因重试变成新 Promise。               |
| 明确保存与结束                       | flush / dispose               | flush 等结果，dispose 同步释放且不等最终写入。 |

**水合** 是把存档恢复到当前状态；**信封** 是一起保存的 version 与 state；**三向合并** 是对照启动值、当前值和存档值决定字段来源；**防抖窗口** 只决定何时请求写入，不是后端完成期限；**handle** 持有一份持久化订阅与状态，借用业务资源。

## 典型场景

| 场景                       | 怎么组合                                                | 详细说明                                             |
| -------------------------- | ------------------------------------------------------- | ---------------------------------------------------- |
| 恢复存档时保留启动期修改   | persist → local edit → ready → flush                    | [完整代码](./USEGUIDE.md#恢复存档时保留启动期修改)   |
| 修复坏存档后再恢复写入     | ready rejection → repair storage → retryHydrate → flush | [完整代码](./USEGUIDE.md#修复坏存档后再恢复写入)     |
| 迁移旧设置并只保存指定字段 | version / migrate → partialize → flush                  | [完整代码](./USEGUIDE.md#迁移旧设置并只保存指定字段) |
| 完整恢复 Map 条目          | persistCollection → flush → new Map → ready             | [完整代码](./USEGUIDE.md#完整恢复-map-条目)          |
| 独立停止某个键的持久化     | persistKeyed × 2 → ready → dispose one → flush          | [完整代码](./USEGUIDE.md#独立停止某个键的持久化)     |
| 清理存档而不重置内存值     | clearFamily → inspect memory → change → flush           | [完整代码](./USEGUIDE.md#清理存档而不重置内存值)     |

## 安装

```bash
pnpm add @migaia/store-persist @migaia/store-light @migaia/storage-web
```

只安装所用 Store 模型的可选 peer；上面的 light 示例需要 store-light，集合和 keyed 场景按需安装：

```bash
pnpm add @migaia/store-indexed @migaia/store-keyed @migaia/reactive
```

## 常用 API

| API                            | 什么时候用                          |
| ------------------------------ | ----------------------------------- |
| /light 的 persist              | 持久化 createStore 支持的状态字段。 |
| /indexed 的 persistCollection  | 持久化一种可观察集合。              |
| /keyed 的 persistKeyed         | 按显式 id 接入一个可写定义。        |
| /keyed 的 clearFamily          | 删除某命名空间的存档，不改内存。    |
| handle.ready / retryHydrate    | 判断首次恢复与一次修复重试的结果。  |
| handle.flush / clear / dispose | 等待保存、删除档案或停止该持久化。  |

## 契约细节

### 职责、入口与安装边界

本包把状态变化接到存储读写：加载存档、协调水合期间的本地修改、排队写入、管理防抖与释放。它不提供具体存储后端、加密或页面卸载时的可靠保存保证。只需一次性读写而不需要状态同步时，直接使用 storage-contract 和所需后端即可。敏感数据应由应用选择合适的存储与加密 codec，不要把默认 JSON 编码当作加密。

| 入口                            | 公开内容                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `@migaia/store-persist`         | persistUnit 核心、handle / options / envelope 类型、codec 工具、状态与错误。根入口不导出三个 Store 适配函数。 |
| `@migaia/store-persist/light`   | persist、IPersistableStore、IPersistOptions。                                                                 |
| `@migaia/store-persist/indexed` | persistCollection、IPersistableCollection、IPersistCollectionOptions。                                        |
| `@migaia/store-persist/keyed`   | persistKeyed、clearFamily、IPersistKeyedOptions、IPersistKeyedHandle。                                        |

reactive、storage-contract、utils、lifecycle 是运行时依赖。store-light、store-indexed、store-keyed 是可选 peer，只安装所用模型；storage-web 仅在使用其后端或 codec 时安装。代码直接导入的包应直接安装，不能依赖传递依赖恰好可见。memoryStorageHost、localStorageHost、indexedDbHost 从 storage-web 的精确后端子入口取得；本包不在运行时依赖具体 storage-web 值。

### 共同配置与同步回调

persistUnit(unit, options) 是三个适配器共用的引擎。unit 必须提供同步 snapshot()、同步 restore(state) 和 subscribe(onChange)，后者返回退订函数。核心 options 必填 key、runtime、storage；三个 facade 自动使用 Store / collection / AtomStore 自己的 Runtime。状态单位、Runtime 和 storage 均为借用资源。

| 选项       | 默认值与含义                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| key        | 必填字符串；决定存档键，字符串不被强制转型。                                                                                   |
| runtime    | 仅核心显式必填；持有状态信号，facade 自动提供。                                                                                |
| storage    | 必填，满足最小 KeyValueStore 投影；见后文选路。                                                                                |
| codec      | defaultJsonCodec；编码完整的 version / state 信封，而不只编码 state。                                                          |
| version    | 0；必须是非负安全整数。                                                                                                        |
| migrate    | 未设置；存档版本不同时执行 migrate(persisted, fromVersion)，缺失则水合失败。keyed facade 不公开此选项。                        |
| partialize | 恒等函数；写入前从当前快照裁出需要保存的字段。                                                                                 |
| merge      | 核心 / indexed / keyed 可自定义 merge(persisted, current)；缺省浅三向合并普通对象，其他形状整体替换。light 不公开 merge 选项。 |
| debounceMs | 0，不防抖；有限数，范围 0 到 2147483647，允许小数。                                                                            |
| maxWaitMs  | 未设置；同一数值范围，限制防抖窗口，不是 I/O 期限。                                                                            |
| scheduler  | canonical systemScheduler；提供单调 now 与可取消 schedule 任务。                                                               |

facade 先捕获 options 自身属性；getter 使用原 options 作为 receiver 读取一次。核心也在创建时捕获配置字段，恢复使用已捕获并验证的 merge，不重新读取调用方的 getter。非对象、反射或 getter 失败以 INVALID_OPTION TypeError 报告，捕获的原因为 cause。key、namespace、id 在拼接前检查字符串，不把对象或数字悄悄转成键，也不额外要求非空字符串。容量时间、version 与回调形状在创建持久化状态前按实际配置校验。

migrate、partialize、merge 都是同步回调，不能返回 Promise / thenable；异步结果或读取 then 失败以 INVALID_OPTION 拒绝，避免 Promise 被当作业务状态写入。普通同步业务回调或后端异常保留原来的公共错误路径；不要把所有失败都改判为某一个本包码。

### 三个状态适配器

| 适配器                                    | 接受的状态面                                                                     | 读写与订阅                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| persist(store, options)                   | $runtime、$plain、$subscribe、$hydrate 的结构类型，createStore 返回值满足。      | snapshot 用 $plain，restore 用 $hydrate，subscribe 显式 fireImmediately: false。           |
| persistCollection(collection, options)    | runtime、snapshot()、replace(state)，支持 ObservableObject / Array / Map / Set。 | runtime.effect 读取 tracked snapshot，跳过 Effect 构造时的首次同步执行，之后变化触发写入。 |
| persistKeyed(atomStore, def, id, options) | AtomStore 与可写定义。                                                           | peek 取快照，set 恢复，sub 订阅；每次调用建立一个独立单位。                                |

light 的 $plain 只包含 signal 支撑字段，不含 computed、WASM 字段或方法。$hydrate 是宽松写回：只更新已知 signal 字段，未知字段默认跳过。因此 partialize 只保存部分字段时，不会要求恢复未保存字段；本适配器不另设 merge。核心普通对象合并仍负责水合期间的同字段本地修改。

indexed 的 snapshot 保持各集合自身形状，replace 遵循集合整体替换的原子准入；坏存档、版本不匹配等水合前置失败不会调用 restore，不能把“没有进入恢复”夸大为任意外部副作用可回滚。数组 / Map / Set 的部分持久化需要应用提供匹配的 merge，否则缺省整替换可能丢掉未存部分。普通对象的浅字段规则也不代替深层业务合并。

keyed 必填 namespace、storage，其他共同选项按其公开类型提供；实际存储键是 namespace + ':' + id。它没有枚举整个 family 的能力，每个 handle 只管理这一个定义与键。handle.value 是水合前首次获取的值快照，不是实时 AtomStore 值；实时值从 AtomStore 读取。扩展保留原引擎的 live disposed getter，dispose 后立即反映终态。

clearFamily(storage, namespace) 的两个参数均必填，返回 `Promise<number>`。它枚举 storage.keys()，按 namespace + ':' 前缀筛选后逐个 await remove；返回枚举时匹配的数量，不是 remove 返回 true 的独占计数。它不清 AtomStore 内存、不停止现有 handle；活跃值下次变化可再次写入。登出若要同时清业务值，应用还须操作 AtomStore，并按需先停止相关持久化，避免把删除当成永久禁写。

### 加载、版本迁移与本地修改

构造时先捕获启动快照并建立变化订阅，再异步读取存档。存档不存在时水合成功，保留内存初值。存档存在时先解码、验证 envelope，再在 version 不同且提供 migrate 时迁移，最后合并并同步 restore。版本相同不调用 migrate；版本不同而未提供 migrate 以 ENVELOPE_INVALID 拒绝，不把旧值冒充新 schema。

缺省 merge 对普通对象（Object.prototype 或 null 原型）按字段浅比较：以构造时启动快照为基线，用 Object.is 比较当前字段；本地已改字段保留当前值，未改字段接受存档值，同时保留未归档的当前字段。它不是深度冲突解决，嵌套引用内部变化不自动得到逐层比较；重试也沿用这一启动基线。非普通对象、数组、Map、Set 等整体接受持久化形状，自定义 merge 则负责应用自己的规则。

水合期间通知只标 dirty，不提前覆盖未知存档；恢复时的同步通知也归入这个窗口。水合成功后有 dirty 才重新安排写入。水合失败保留错误和 dirty 状态，flush / clear 不写而抛原水合错误；修复配置或存档后，成功 retryHydrate 才重新打开写入。恢复期间再次调用不会另起并行重读，但不保证它等待当前恢复或返回相同 Promise；需要恢复结果时等待发起重试的那次调用。

### Handle 状态与等待

| 成员                 | 取值或行为                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| status               | loading / ready / error / disposed；disposed 优先，水合 loading 次之，水合或写入失败为 error。写入中由独立 writeStatus 表示。 |
| error                | hydrationError 或 writeError；两者都有时生成 HYDRATE_AND_WRITE_FAILED AggregateError，errors 按水合、写入顺序保留。           |
| hydrated             | hydrationStatus 是否为 success，不等同于 handle 尚未释放。                                                                    |
| hydrationStatus      | loading / success / error，重试时重新经历该状态。                                                                             |
| hydrationError       | 当前水合错误，成功后清除。                                                                                                    |
| writeStatus          | idle / writing / error / disposed。                                                                                           |
| writeError           | 最近写入错误；正常成功写入清除，释放后的最终写入失败也可保留在这里。                                                          |
| ready                | 首次 hydrate 尝试的 Promise：成功 resolve，失败或完成前被释放中断则 reject；重试不替换原 Promise。                            |
| settled              | 首次尝试无论成功失败都 resolve 的等待屏障，不表示以后 retry 已完成。                                                          |
| retryHydrate()       | 无参数；失败后重读，成功恢复写入；应等待此调用本身判断恢复结果。                                                              |
| flush() / clear()    | 无参数，返回 `Promise<void>`，具体串行与删除规则见后文。                                                                      |
| disposed / dispose() | live 布尔 getter / 同步幂等释放。                                                                                             |
| disposeAsync()       | 同步停止后等待已接纳的写入/删除及最终写入结束；最终写入失败见 writeError；已有 flush/clear 保留原结果。                       |

status、error、hydrated 是 Runtime computed；hydration / write 的细分状态通过 IReadonlyPersistValue.value 暴露。公开 PersistState 只有 idle、loading、writing、ready、success、error、disposed；没有 active。IPersistCodecOutput 已移除，类型使用 storage-contract 的 ICodecOutput；运行时 PersistCodecOutput 仍保留 text / structured / binary。旧类型与成员导入需迁移，没有兼容 alias。

### 写入、防抖、flush 与 clear

写入先读最新 unit.snapshot，再同步 partialize，构造 { version, state } 后交给 codec。所有写入和删除沿一条串行链，防止慢的旧写入在新写入后覆盖它。变化会合并为写入请求，但每次实际编码使用排到执行时的快照，不承诺每个中间值都形成一份存档。

debounceMs 大于 0 时等待安静间隔；maxWaitMs 从成功水合后第一个待写变化起固定窗口上限，后续变化只延长安静间隔。maxWaitMs 为 0 是下一次 0ms 调度请求入队；debounceMs 为 0 则直接请求写入，不使用这一防抖窗口。maxWait 只限制请求入队时间，不限制排队等待或后端完成时间。

flush 取消当前防抖窗口，等待首次水合屏障；若水合失败抛原错，否则等待它已经观察到的实际写入，再请求当前快照写入并等待。并发严格 flush 与后台写共享真实 drain 结果，全部等待者能看到同一次原始失败；仅供后续调度恢复的 catch 链不会把这次失败改成成功。各 async 方法的公开 Promise 不被声明为相同 identity。

clear 同样取消窗口并等待水合，然后在写队列后删除此键，不重置业务内存。之后状态变化仍可重新写回。clearFamily 只处理匹配的存储键，不与所有活跃 keyed handle 合成原子事务。浏览器 beforeunload 也不保证等待 flush；应在明确的应用保存边界 await flush，并理解后端完成语义，而非只在卸载事件里 fire-and-forget。

### dispose、取消与最终快照

dispose 同步、幂等：标记终态、请求 abort 所有在途适配器操作、取消防抖窗口、停止订阅。它不 dispose 借用的 Store、collection、AtomStore、Runtime 或 storage。释放后 flush / clear / retryHydrate 拒绝为带 ABORTED_BY_DISPOSE 的原生 AbortError，不复用旧 handle。

如果释放截断了一个已排定但未触发的防抖 timer，或者一次已接纳但还没完成的写入（`debounceMs: 0` 时每次变化都会立即接纳一次写入），会当场捕获最后快照，并在既有写链之后发起一次最终写入。被截断的那次写入会中止或不再开始，所以释放前刚刚发生的变化由这次最终写入落盘。该写入不等待、不传已中止的 signal；最终编码 / I/O 或捕获失败保留在 writeError，即使 status 已 disposed。既没有 pending timer、也没有未完成的写入时，dispose 不会再保存一次。

取消复用 lifecycle 的原生 AbortController 工厂与默认 AbortError reason。后端若忽略 signal，已经发出的操作仍可能完成；等待者会在实际操作结算后观察终态，晚到原始失败保留在 AbortError cause。dispose 不是硬期限或强制终止后端的机制。需要确定保存结果时在资源仍可用时 await flush，再按应用顺序释放 handle 和业务资源。

### 存档、默认 codec 与兼容读取

信封格式为 version（非负安全整数）与 state（非 null / undefined）。assertEnvelope(value, key) 拒绝非对象、数组、非法 version 或缺失 state，返回捕获的 version / state；两属性各读一次，属性访问或反射失败由 PersistEnvelopeError 包装并在 cause 保留。PersistEnvelopeError 继承 TypeError、携带 ENVELOPE_INVALID，key 用于标明存档身份。

defaultJsonCodec 名称为 migaia-collections-json-v1，output 为 text；委托 storage-contract 的 collectionsJsonCodec，支持真实 Map / Set（含跨 realm）往返，避免普通 JSON 将集合静默编码为空对象。它仍继承 JSON 的循环引用、BigInt 等限制，不是任意对象图的无损编码。新格式用版本化元组，其精确保留形状不是可任意占用的普通业务数组。

读取旧存档时，仅唯一自有键为 `__migaia_persist_map__` 或 `__migaia_persist_set__` 且值为数组的对象是旧保留 marker；多字段同名 lookalike 保持全部数据。发现精确旧 marker 后沿 legacy reviver 读取，不把其中原本的普通应用数组重新解释为新元组；没有精确旧 marker 才委托新格式解码。新写入格式与 codec name 不变，不使用相似字段猜集合。

defaultJsonCodec.encode 失败抛 ENCODE_FAILED TypeError，原因为 cause；decode 非字符串或坏 JSON / marker 抛 ENVELOPE_INVALID TypeError，解析失败的原因为 cause。默认 codec 不做加密或脱敏；自定义 codec 必须处理自己声明的数据形状。

### 存储投影与 codec 选路

IPersistStorage 是内部最小类型投影，不作为包入口具名导出：capabilities、get、set、remove、keys 来自 IKeyValueStore；不要求 backend、has、clearValues、clearAll 或 dispose。可选 getBytes / setBytes / removeBytes 来自 IRecordStore，不是 IKeyValueStore 本身。binary codec 的 clear() 用 removeBytes 只删除这个 byte key，不清空其他 byte key 或 text/record 通道；声明 binary 却缺少 removeBytes 时，clear 以 BACKEND_CAPABILITY 的 TypeError 拒绝，不回落到 text 删除。后端和 codec 的错误保留各自公共身份与原因，不保证都改成本包 source。

| 工具                                           | 选路与失败                                                                                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| writeEnvelope(storage, key, codec, value, ctx) | ctx 必填，可为空对象，signal 可省略；structured output 写入明确 CODEC_OUTPUT_MISMATCH，不走 record 通道。                                                                                   |
| binary 写入                                    | capabilities.binary 为真时要求两个字节方法，缺失为 BACKEND_CAPABILITY；编码值必须是 Uint8Array，否则 CODEC_OUTPUT_MISMATCH。                                                                |
| 其余写入分支                                   | 编码值必须为 string，交 storage.set；不自动 base64 降级。                                                                                                                                   |
| readEnvelope(storage, key, codec, ctx)         | binary 且 capabilities.binary 为真时走 getBytes，再 codec.decode；缺方法为 BACKEND_CAPABILITY，binary 能力为假则 CODEC_OUTPUT_MISMATCH。非 binary 走 get + decode。不存在时返回 undefined。 |
| removeEnvelope(storage, key, ctx, codec?)      | 按 codec 选择通道删除单个存档：默认 text 走 storage.remove；binary codec 且后端声明 binary 时走 removeBytes，缺少时抛 BACKEND_CAPABILITY 的 TypeError。不改变内存状态。                     |

二进制写入按真实 Uint8Array brand 判断，支持其他 realm 的 intrinsic / 子类，不接受只是包装了 Uint8Array 的 Proxy 冒充。仅有 text 后端却配置 binary 时应选合适后端或 text codec；不要认为有某个方法或一个 output 字符串就建立全部后端能力。

### 错误与排查

STORE_PERSIST_SOURCE 为 @migaia/store-persist；稳定码由 StorePersistErrorCode 维护：

| 属性 / 码                                        | 含义                                                          |
| ------------------------------------------------ | ------------------------------------------------------------- |
| codecNotResolved / CODEC_NOT_RESOLVED            | 未解析到 codec，显式配置或修正默认解析。                      |
| codecOutputMismatch / CODEC_OUTPUT_MISMATCH      | codec output、实际 payload 与后端路由不一致。                 |
| backendCapability / BACKEND_CAPABILITY           | 进入 binary 分支但缺字节方法。                                |
| envelopeInvalid / ENVELOPE_INVALID               | 坏存档、版本不合法或不匹配且无 migrate。                      |
| encodeFailed / ENCODE_FAILED                     | 默认 codec 编码失败，查看 cause 与待存值。                    |
| hydrateAndWriteFailed / HYDRATE_AND_WRITE_FAILED | 水合和写入均失败，展开 AggregateError.errors。                |
| abortedByDispose / ABORTED_BY_DISPOSE            | 释放中止，保持 DOMException / AbortError 及原始 cause。       |
| invalidOption / INVALID_OPTION                   | key、namespace、version、时间、回调、scheduler 或配置不合法。 |

配置 version 非负安全整数等非法项同步 TypeError；信封问题由 PersistEnvelopeError 报告。水合失败后 flush / clear 继续抛 hydrationError，成功 retry 才解锁；写入失败查 writeError，并检查 codec 与后端是否匹配。已释放 handle 不能重用，业务内存和存档删除需分别管理。

公开错误工厂 createStorePersistError / createStorePersistTypeError 接收必填 code、message 和可选 options.cause；createStorePersistAbortError 接收 code、message、可选 cause，返回原生 DOMException，保持 name 为 AbortError；createStorePersistAggregateError 接收 code、errors、message，errors 保留原失败。code 类型为 IStorePersistErrorCode，工厂附加身份但不覆盖 stack。底层工具不需要在普通 Store 使用中自行重复实现。

包已有 fmt、lint、typecheck、typecheck:test、test、build 和 test:packed 脚本；实际报告说明哪些被执行，不以手册列出命令当成验证结论。排查未保存字段先看 partialize 与 debounce，再看 hydrationError / writeError；Map / Set 形状不对时检查是否换用了不支持集合的 codec。
