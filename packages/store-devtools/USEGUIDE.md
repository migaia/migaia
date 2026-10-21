# `@migaia/store-devtools` 使用手册

为已有 Store 记录本地诊断历史，并读取真实响应式依赖图。最短入口见 [README](./README.md)。

## 按场景查找

| 需要做什么                     | 怎么组合                                               | 完整示例                                      |
| ------------------------------ | ------------------------------------------------------ | --------------------------------------------- |
| 回放保留状态而不新增回放历史   | createStoreDevTools → retain id → jumpTo → edit        | [代码与输出](#回放保留状态而不新增回放历史)   |
| 分别限制历史与手动动作队列     | maxHistory / maxTrace → recordAction → clear           | [代码与输出](#分别限制历史与手动动作队列)     |
| 报告快照失败而不打断业务写入   | Runtime.onError → clone → record                       | [代码与输出](#报告快照失败而不打断业务写入)   |
| 释放诊断会话后继续使用 Store   | dispose → read history → use Store                     | [代码与输出](#释放诊断会话后继续使用-store)   |
| 展开共享依赖的两条路径         | Runtime.signal / computed / effect → getDependencyTree | [代码与输出](#展开共享依赖的两条路径)         |
| 在 effect 释放后查看当前订阅者 | getObserverTree → effect.dispose → getObserverTree     | [代码与输出](#在-effect-释放后查看当前订阅者) |

## 运行准备

每个场景是独立的 .ts 文件，可用 Node 24 在 ESM 项目中直接运行。它们只使用真实 Store、Runtime 和公开句柄，不需要浏览器扩展。

```bash
pnpm add @migaia/store-devtools @migaia/store-light @migaia/reactive
```

## 回放保留状态而不新增回放历史

排查问题时，需要回到较早的 Store 状态，再从那里继续修改。

普通变更监听若把回放触发的注水也当成用户编辑，每跳转一次就会多记一条历史。

把工具接到真实 Store，保留初始 id 后调用 `jumpTo()`；会话会抑制回放产生的历史，后续真实修改仍正常记录。

### 示例参数

runtime 是本例显式创建并交给 Store 的 Runtime。schedulerStrategy: (run) => run() 将调度改为同步，便于逐条观察；省略时 Runtime 默认通过注入的微任务调度。createStore 的初始 count 为 0，options.runtime 使用该实例；工具 captureRuntimeTrace: false 关闭自动 trace / action，仍保留状态历史。其余 maxHistory / maxTrace 为 100 / 1000，clone 为 diagnostic，now 为 Date.now。

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { createStore } from '@migaia/store-light'
import { createStoreDevTools } from '@migaia/store-devtools'

const runtime = createRuntime({ schedulerStrategy: (run) => run() })
const store = createStore({ count: 0 }, { runtime })
const tools = createStoreDevTools(store, { captureRuntimeTrace: false })
try {
  const initial = tools.history[0]!
  store.count = 1
  store.count = 2
  console.log(store.count, tools.history.length)
  tools.jumpTo(initial.id)
  console.log(store.count, tools.history.length)
  store.count = 1
  console.log(store.count, tools.history.length)
  console.log(initial.state.count, Object.isFrozen(initial.state))
} finally {
  tools.dispose()
  await store.$dispose()
}
```

输出：

```text
2 3
0 3
1 4
0 true
```

输出为 `2 3`、`0 3`、`1 4`、`0 true`：回放恢复计数但不追加历史，后续修改继续记录，初始状态保持浅冻结。

`jumpTo` 只向 Store 已知字段注水，不会撤销外部副作用、恢复已淘汰条目，也不保证所有诊断值都完全深度隔离。

## 分别限制历史与手动动作队列

长时间调试时，需要只保留少量最近状态，同时留下选定的手动动作说明。

共用一个队列会让动作说明挤掉状态；把清空当成新会话，还可能重用旧 id，留下含混的锚点。

分别设置 `maxHistory`、`maxTrace`，关闭自动追踪并追加手动动作，再清空并检查新的初始条目。

### 示例参数

maxHistory 和 maxTrace 均覆盖为 2，分别限制不同队列；captureRuntimeTrace 为 false 时手动 recordAction 仍可用。now: () => 100 返回确定时间戳，省略为 Date.now。recordAction.name 是说明，timestamp 由工具补；jumpTo 接收历史 id，clear 无参数且不重置序号。

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { createStore } from '@migaia/store-light'
import { createStoreDevTools } from '@migaia/store-devtools'

const runtime = createRuntime({ schedulerStrategy: (run) => run() })
const store = createStore({ count: 0 }, { runtime })
const tools = createStoreDevTools(store, {
  maxHistory: 2,
  maxTrace: 2,
  captureRuntimeTrace: false,
  now: () => 100
})
try {
  const initialId = tools.history[0]!.id
  store.count = 1
  store.count = 2
  store.count = 3
  for (const name of ['第一', '第二', '第三']) tools.recordAction({ name })
  console.log(tools.history.map((entry) => entry.state.count).join(','))
  console.log(tools.actions.map((entry) => entry.name).join(','), tools.trace.length)
  try {
    tools.jumpTo(initialId)
  } catch (error) {
    const failure = error as Error & { code?: string }
    if (failure.code !== 'UNKNOWN_HISTORY_ENTRY') throw error
    console.log(failure instanceof RangeError, failure.code)
  }
  tools.clear()
  console.log(
    tools.history[0]!.id,
    tools.history[0]!.label,
    tools.actions.length,
    tools.trace.length
  )
} finally {
  tools.dispose()
  await store.$dispose()
}
```

输出：

```text
2,3
第二,第三 0
true UNKNOWN_HISTORY_ENTRY
5 initial 0 0
```

输出为 `2,3`、`第二,第三 0`、`true UNKNOWN_HISTORY_ENTRY`、`5 initial 0 0`：两个队列各自保留最近条目，清空也不重置 id 序列。

`maxHistory` 默认 `100`；`maxTrace` 默认分别为 actions、trace 保留 `1000` 条，`captureRuntimeTrace: false` 也会关闭自动动作捕获。

## 报告快照失败而不打断业务写入

普通 Store 更新期间，诊断快照回调可能失败，但业务写入仍应可用。

让该回调从 Store 监听器直接逃出，就把调试失败变成业务失败；准备完成前先占用 id，也会在失败后留下空号。

使用真实 Runtime 报告入口和会失败的克隆回调；自动捕获报告原错，手动 `record()` 则在发布前抛出它。

### 示例参数

Runtime onError 接收真实错误，本例收集到 reports，省略时使用 Runtime 默认报告器。clone 是应用回调，这里只做浅展开；fail 开启后抛出同一个 TypeError，默认 clone 则为 diagnostic。captureRuntimeTrace 为 false 使本例只考察状态快照失败；手动 record 未传 label，默认 state change。

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { createStore } from '@migaia/store-light'
import { createStoreDevTools } from '@migaia/store-devtools'

const reports: unknown[] = []
const runtime = createRuntime({
  schedulerStrategy: (run) => run(),
  onError: (error) => {
    reports.push(error)
  }
})
const store = createStore({ count: 0 }, { runtime })
const original = new TypeError('诊断快照失败')
let fail = false
const tools = createStoreDevTools(store, {
  captureRuntimeTrace: false,
  clone: (state) => {
    if (fail) throw original
    return { ...state }
  }
})
try {
  fail = true
  store.count = 1
  console.log(store.count, tools.history.length)
  console.log(reports[0] === original, (original as Error & { code?: string }).code)
  try {
    tools.record()
  } catch (error) {
    if (error !== original) throw error
    console.log(error === original)
  }
  fail = false
  console.log(tools.record().id)
} finally {
  tools.dispose()
  await store.$dispose()
}
```

输出：

```text
1 1
true CALLBACK_FAILED
true
2
```

输出为 `1 1`、`true CALLBACK_FAILED`、`true`、`2`：写入成功，自动报告保留原 TypeError，手动记录抛出同一个错误，恢复后使用下一个 id。

这里隔离的只是诊断准备失败；回放克隆的未归属失败会带 `CALLBACK_FAILED` 抛出，Store 注水仍沿自身失败路径传播；此自定义克隆仅作浅展开。

## 释放诊断会话后继续使用 Store

调试面板关闭后，应用仍需要它刚才查看的 Store。

面板退出时连 Store 一起释放，会越过应用的所有权边界；保留诊断监听器，又会让隐藏历史继续增长。

只释放诊断会话，保留其只读队列，再继续写真实 Store；新的诊断修改会被拒绝。

### 示例参数

dispose 不接参数、同步且幂等；释放后 record 拒绝，但 history 数组快照仍可读取。Store 与 Runtime 是借用资源，tools.dispose 不销毁它们。本例 finally 另行调用 store.$dispose；Runtime 的调度与 Store 初始值同前几例。

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { createStore } from '@migaia/store-light'
import { createStoreDevTools } from '@migaia/store-devtools'

const runtime = createRuntime({ schedulerStrategy: (run) => run() })
const store = createStore({ count: 0 }, { runtime })
const tools = createStoreDevTools(store, { captureRuntimeTrace: false })
try {
  tools.dispose()
  tools.dispose()
  store.count = 1
  console.log(store.count, tools.history.length)
  try {
    tools.record()
  } catch (error) {
    const failure = error as Error & { code?: string }
    if (failure.code !== 'SESSION_DISPOSED') throw error
    console.log(failure.code)
  }
  store.count = 2
  console.log(store.count)
} finally {
  tools.dispose()
  await store.$dispose()
}
```

输出：

```text
1 1
SESSION_DISPOSED
2
```

输出为 `1 1`、`SESSION_DISPOSED`、`2`：重复释放无额外影响，旧历史仍可读且不增长，调用方拥有的 Store 仍能写入。

会话释放只移除 Store 与 Runtime 订阅，不清空队列，也不释放借用的 Store；调用方最后单独释放 Store。

## 展开共享依赖的两条路径

两个计算值共享一个信号，effect 同时读取两者；排查时需要看见回到同一信号的两条路径。

全局已访问集合可能把第二条共享路径误标为环，或直接省略它，尽管它并没有递归回到自身。

用真实 Runtime 句柄组成菱形依赖，再检查 effect；遍历只跟踪当前路径，并遵守显式深度上限。

### 示例参数

signal 的初值为 1，left / right 的函数分别读取来源信号，effect 读取两者以建立真实依赖。debugName 是诊断标签，省略时树依次回退到 constructor.name / AnonymousReactiveNode。getDependencyTree 的第二参数默认 20，本例另传 0 验证不展开直接边；函数不拥有这些句柄，最后由创建者释放。

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { getDependencyTree } from '@migaia/store-devtools'

const runtime = createRuntime()
const source = runtime.signal(1, { debugName: '来源' })
const left = runtime.computed(() => source.value + 1, { debugName: '左分支' })
const right = runtime.computed(() => source.value + 2, { debugName: '右分支' })
const view = runtime.effect(
  () => {
    void (left.value + right.value)
  },
  { debugName: '视图' }
)
try {
  const tree = getDependencyTree(view)
  console.log(tree.label, tree.children.map((node) => node.label).join(','))
  console.log(tree.children.map((node) => node.children[0]!.label).join(','))
  console.log(tree.children.every((node) => node.children[0]!.circular !== true))
  console.log(getDependencyTree(view, 0).children.length)
} finally {
  view.dispose()
  left.dispose()
  right.dispose()
  source.dispose()
}
```

输出：

```text
视图 左分支,右分支
来源,来源
true
0
```

输出为 `视图 左分支,右分支`、`来源,来源`、`true`、`0`：共享依赖的两条路径都展开，且没有环标记；深度为零时不展开直接边。

默认深度为 `20`，必须是非负安全整数；返回的是上游关系的即时视图，不会新增订阅，也不会执行 effect。

## 在 effect 释放后查看当前订阅者

一个信号通过计算值供两个 effect 使用，但其中一个面板已经停止观察。

另外维护订阅者清单，容易留下已经关闭的面板，误导排查人员判断哪些观察者还会重跑。

直接读取真实信号的下游树，用公开句柄释放一个 effect，再次检查；整个过程不需要创建诊断会话。

### 示例参数

count 初值 2，total 为 count × 2，两 effect 读取它；debugName 标识本例各节点。getObserverTree 接受真实 signal / computed 句柄，maxDepth 默认 20，显式 0 仅返回根。返回树不是持续订阅；first.dispose 后需重新调用函数取得当前关系。

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { getObserverTree } from '@migaia/store-devtools'

const runtime = createRuntime()
const count = runtime.signal(2, { debugName: '计数' })
const total = runtime.computed(() => count.value * 2, { debugName: '合计' })
const first = runtime.effect(
  () => {
    void total.value
  },
  { debugName: '第一个' }
)
const second = runtime.effect(
  () => {
    void total.value
  },
  { debugName: '第二个' }
)
try {
  const before = getObserverTree(count)
  console.log(before.label, before.children[0]!.label)
  console.log(before.children[0]!.children.map((node) => node.label).join(','))
  first.dispose()
  console.log(
    getObserverTree(count)
      .children[0]!.children.map((node) => node.label)
      .join(',')
  )
  console.log(getObserverTree(count, 0).children.length)
} finally {
  first.dispose()
  second.dispose()
  total.dispose()
  count.dispose()
}
```

输出：

```text
计数 合计
第一个,第二个
第二个
0
```

输出为 `计数 合计`、`第一个,第二个`、`第二个`、`0`：重新取得的树反映了公开 effect 释放，深度为零则省略全部订阅边。

默认深度为 `20`；返回的树是即时数据，下一次订阅变化后不会自行更新，需要再次读取。

## 契约细节

### 职责与完整公开面

本包是已有 Store 的本地诊断会话，不创建 Store，不改写或代理写入路径。它使用 Store 的 $subscribe、$runtime.subscribeTrace / reportError、$plain、$hydrate，记录内存历史和 action，另提供两个不依赖会话的响应式图遍历函数。适合排查字段变化、动作失败和节点依赖，不是持久化审计、网络回放或外部副作用的事务回滚。

唯一入口为 `@migaia/store-devtools`，导出 createStoreDevTools、getDependencyTree、getObserverTree、五种公开数据类型、错误码与三个错误工厂。reactive、store-light、store-middleware、utils 是运行时依赖；示例直接导入 reactive / store-light 时仍应直接安装它们。

本包不实现浏览器扩展协议。要连接 Redux DevTools，使用 [Store Middleware](../store-middleware/README.md) 的 createReduxDevToolsAdapter / connectDevTools。原 StoreDevtoolsCommand / IStoreDevtoolsCommand 已移出此入口；自建桥接改为从 store-middleware 导入 ReduxDevToolsCommand / IReduxDevToolsCommand。六个协议值保持 DISPATCH、COMMIT、JUMP_TO_STATE、JUMP_TO_ACTION、ROLLBACK、RESET；这是导入位置的迁移，不是新增协议层。

### 构造参数与订阅边界

`createStoreDevTools<S>(store, options?)` 同步返回 IStoreDevTools。store 必须是 createStore 返回的真实 `IReactiveStore<S>`；会话借用 Store 和 Runtime，不拥有或销毁它们。options 省略为空对象。

| 选项                | 默认值与行为                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------- |
| maxHistory          | 100；仅限制 history，必须是正安全整数。                                                   |
| maxTrace            | 1000；分别限制 actions 和 trace 的独立队列，没有 maxActions。                             |
| captureRuntimeTrace | 缺省启用；只有严格等于 false 才完全跳过 Runtime trace 订阅，actions 也不再自动填充。      |
| now                 | Date.now；为历史和 action 记录提供时间戳，显式提供时必须是函数。                          |
| clone               | ClonePolicy.diagnostic；接收 $plain() 或历史 state 并返回记录对象，显式提供时必须是函数。 |

null / 非对象 options 以 INVALID_OPTION 拒绝；反射或 option 属性读取失败也使用该码，并在 cause 保留捕获的原错。构造读取描述符后读取五个选项，getter 可能在这些属性读取中执行；它不是“完全不执行 getter”的接纳方式。maxHistory / maxTrace 经空值回退后校验，不把 0、负数、分数、无穷或 NaN 静默夹到合法值。now / clone 的非函数配置同样在订阅前拒绝。

通过配置校验后，先同步创建第一条 initial 历史，再订阅当前 Store 的粗粒度状态通知。开启 trace 时订阅的是这个 Store 所用的整个 Runtime，因此共享 Runtime 上其他 Store 或 runTracedAction 的动作也可能进入 actions / trace；它们不自动按本 Store 身份过滤。配置失败不建立订阅；订阅建立失败则尝试释放已取得订阅，主错与回滚错误的保留方式见错误章节。

### 历史、回放与清空

| 成员           | 输入、输出与效果                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| history        | 每次读取返回按时间顺序排列的新冻结数组，元素为 IStoreHistoryEntry。                                                |
| record(label?) | label 默认 state change；先准备时间戳和状态，再分配 id、追加记录，并返回该条目。                                   |
| jumpTo(id)     | 必填历史 id；找不到（含已裁剪）抛 UNKNOWN_HISTORY_ENTRY RangeError，找到则 clone(state) 后交给 Store 的 $hydrate。 |
| clear()        | 无参数；先准备新的 initial，再清三队列并发布这一条，id 继续递增，不归零。                                          |

IStoreHistoryEntry 含 id、timestamp、label、state；公开字段类型没有额外 readonly 修饰，但发布时 entry 与 state 顶层实际冻结。history 的数组快照不随之后入队而变化，嵌套 state 的隔离程度由 clone 决定，不保证任意对象图深冻结。超出 maxHistory 后淘汰最早条目，包括 initial；保留已裁剪 id 也不能继续 jumpTo。

默认 record 从 clone(store.$plain()) 取状态。$plain 只包含 Store 的 signal 支撑字段，不含 computed、方法或 WASM 字段。默认 diagnostic clone 通过公共 structured-clone-first owner 尽力复制；不可克隆或不安全子树可能保持引用，自定义类也不保证原型保持。它不自动脱敏；需要剔除 token 等字段时，应用应提供明确的 clone，或不让敏感值进入可记录状态。

record / clear 的准备失败不发布半条历史，也不消耗下一个 id；clear 准备失败保留全部旧队列。准备完成后还会检查会话是否已被回调释放，已释放则 SESSION_DISPOSED，不发布数据。

jumpTo 不是撤销业务的事务。$hydrate 只写已知 signal 字段，未知、派生、WASM 键按 Store 自身规则跳过；computed 随依赖重算，不直接恢复派生结果、外部资源或已发出的网络请求。回放深度计数只屏蔽同步回放期间新增 history，支持嵌套 jumpTo，不屏蔽 Runtime trace / action，也不承诺取消之后调度的通知。回放 clone 失败同样经既有 CALLBACK_FAILED 分类并保留原错或 cause；$hydrate 的失败继续沿 Store 上游路径传播，不把整次回放任意异常都改成本包码。

### Action 与 Runtime trace

| 数据                 | 字段与记录时机                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| IActionTrace         | timestamp、name，及可选 payload、durationMs、error。                                                        |
| actions              | Runtime action 的非 start 事件自动生成记录；maxTrace 限制条数。                                             |
| recordAction(action) | 必填去掉 timestamp 的 action 对象，通常至少 name；读取自身可枚举属性后由 now() 补时间戳，再检查终态并发布。 |
| trace                | 保存原始 IRuntimeTraceEvent，独立受 maxTrace 限制，不转换事件对象。                                         |

Store 定义中的方法由 Store 包装成具名 action，名称通常为 debugName.方法名。成功 end 和失败 error 都会记录，error 字段只在失败时提供。$batch / $set / $hydrate 不经 Store 方法的 runTracedAction 包装，不能因此期待自动出现 action；可自行 recordAction。captureRuntimeTrace 为 false 时 trace 保持空，actions 仍接受手动记录。它关闭一条诊断订阅，不关闭状态历史，也不改变 Store 写入策略。

| trace.type        | 主要字段与取值                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| observable-change | timestamp、observable、reason 为 set / notify。                                                                 |
| dependency        | timestamp、observable、observer，phase 为 connect / disconnect，可选 reason 为 retrack / invalidate / dispose。 |
| observer-run      | timestamp、observer，phase 为 start / end / error，可选 durationMs / error。                                    |
| action            | timestamp、name，phase 为 start / end / error，可选 durationMs / error。                                        |

节点描述符含 id、kind（observable / observer / computed）和可选 debugName；action 没有通用节点描述符。此联合由 reactive 维护，trace 的 timestamp 与 durationMs 使用 Runtime 的记录语义，不能假定都来自本会话 now。

actions / trace getter 每次也返回新冻结数组，但 action 条目和 trace 事件对象本身不被冻结，payload、error 等嵌套值保留引用。三条队列分别有界，不是总字节或整个应用内存上限；读取数组也会分配快照，不提供未经测量的速度结论。

### 回调失败与生命周期

记录准备中的 now、clone，回放 clone，以及 recordAction 属性读取失败由 CALLBACK_FAILED 分类。可注记、尚无身份的原生错误保留同一对象、类型和 stack；已有完整外包 source/code 则保留，冻结错误、非 Error 或身份冲突值以 cause 保留，反射身份读取失败也保留在聚合错误中。手动 record / recordAction / clear 及 jumpTo 的克隆准备抛错；自动 Store / Runtime 监听把失败交给 Runtime.reportError，phase 为 trace-listener，不反过来让已触发的正常业务写入因诊断失败而抛错。Runtime 自己负责收容 reporter 失败与宿主回退。

dispose() 无参数、同步且幂等：先把会话置为终态，再尝试 Store unsubscribe 和 trace unsubscribe 两个清理。一个清理失败直接重抛原错；多个失败生成 CLEANUP_FAILED AggregateError，errors 保留全部原错。即便第一次清理抛错，重复 dispose 也不重试或再次抛错。

终态后 record / recordAction / jumpTo / clear 均先抛 SESSION_DISPOSED；history / actions / trace 仍可读取，已有队列不清空，不再由会话监听增长。它不销毁借用的 Store / Runtime；调用方仍分别负责它们的释放。开发期按需创建会话，在组件卸载或调试结束时释放，避免持续保留诊断订阅与快照工作。

构造订阅失败时，按 trace unsubscribe、Store unsubscribe 尝试回滚；若回滚全成功原样抛出主错，有清理失败则 CLEANUP_FAILED AggregateError 的 errors 以主错开头，再列清理失败。订阅与单个清理异常保留实际提供者的公共身份，不强行改为本包码。

### 两个独立的响应式图工具

getDependencyTree(root, maxDepth?) 从 observer 沿 deps 查看依赖；接受真实 Runtime effect / computed 公开句柄，或 extension 的 IObserver。getObserverTree(root, maxDepth?) 从 observable 沿 subs 反向查看订阅者；接受 signal / computed 公开句柄，或 extension 的 IObservable。它们不需要 createStoreDevTools，不建立新的业务依赖，也不拥有节点。

maxDepth 缺省 20，必须是非负安全整数；0 连根的直接边也不展开。负数、分数、NaN、无穷均同步抛 INVALID_OPTION RangeError。深度按当前读取的图关系计算，不为了演示而伪造环或图节点。

| IDependencyTreeNode 字段 | 含义                                                                  |
| ------------------------ | --------------------------------------------------------------------- |
| kind                     | observable / observer，表示本次遍历方向中的节点角色。                 |
| label                    | debugName 优先，其次 constructor.name，最后 AnonymousReactiveNode。   |
| version                  | observable 节点的当前版本；dependency root 为 observer 时不带此字段。 |
| children                 | 本次展开的后继树节点数组。                                            |
| circular                 | 仅当前递归路径再次遇到同一节点时为 true，此处停止展开。               |

同一节点在两个不同分支出现的菱形共享不算循环，两边分别展开；真正路径回环才标 circular。达到深度上限直接停止，不标为 circular。Computed 兼具两个角色，因此从依赖方向是 observable 子节点，从反向订阅方向是 observer 子节点；不要把这些数据依赖与插件能力图混为一谈。

### 错误码、错误工厂与维护命令

STORE_DEVTOOLS_SOURCE 为 @migaia/store-devtools；按 source / code 分支，别匹配 message。

| StoreDevtoolsErrorCode 属性 / 值            | 触发与处理                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| sessionDisposed / SESSION_DISPOSED          | 释放后继续变更诊断会话；新建会话，不重试旧实例。                                              |
| unknownHistoryEntry / UNKNOWN_HISTORY_ENTRY | jumpTo 的 id 不在当前 history；RangeError，选仍保留的 id。                                    |
| invalidOption / INVALID_OPTION              | options / getter / 容量 / 回调配置或树深度不合法；options 通常为 Error，树深度为 RangeError。 |
| callbackFailed / CALLBACK_FAILED            | 未分类的记录准备回调、回放 clone 或 action 属性读取失败；修正回调，检查原错或 cause。         |
| cleanupFailed / CLEANUP_FAILED              | 多个 dispose 清理失败，或构造主错并伴随回滚失败；检查 AggregateError.errors。                 |

三个错误工厂均公开，但普通使用通常不需要它们：createStoreDevtoolsError(code, message, options?) 返回带身份的原生 Error，options.cause 可省略；createStoreDevtoolsRangeError(code, message) 返回 RangeError；createStoreDevtoolsAggregateError(code, errors, message) 返回 AggregateError，errors 必填只读列表，保留全部原值，不去重。code 与 message 均必填，code 类型为 IStoreDevtoolsErrorCode；工厂不覆盖 stack。

包维护使用已有 fmt、lint、typecheck、typecheck:test、test、build 脚本；构建、测试及文档执行结果由实际门禁报告给出，不把本节的命令清单当作已经运行的证据。
