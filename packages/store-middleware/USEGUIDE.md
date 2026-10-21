# `@migaia/store-middleware` 使用指南

先按生产任务选择示例，再查询事件、策略、管道、克隆与清理契约。每份代码独立运行，不依赖浏览器扩展或外部服务。

## 按场景查找

| 场景                            | API                         | 详细说明                                     |
| ------------------------------- | --------------------------- | -------------------------------------------- |
| 观察 Store 并在解绑后继续使用   | `bindStoreMiddleware`       | [完整示例](#观察-store-并在解绑后继续使用)   |
| 让 Store 与宿主共享同一严格策略 | `bindStoreMiddleware`       | [完整示例](#让-store-与宿主共享同一严格策略) |
| 区分诊断接收器失败与业务失败    | `createStoreMiddlewareHost` | [完整示例](#区分诊断接收器失败与业务失败)    |
| 逆序释放绑定并保留清理失败      | `createStoreMiddlewareHost` | [完整示例](#逆序释放绑定并保留清理失败)      |
| 在 await 后重新进入动作作用域   | `MutationPolicy`            | [完整示例](#在-await-后重新进入动作作用域)   |
| 明确选择独立副本或引用共享      | `ClonePolicy`               | [完整示例](#明确选择独立副本或引用共享)      |

## 运行准备

```bash
pnpm add @migaia/store-middleware @migaia/store-light @migaia/reactive
```

绑定场景直接导入 store-light，独立 Host 场景直接导入 reactive。每个 Host 的 execution.mutationTimeoutMs 与 execution.pipelineDrainTimeoutMs 均必填、无默认；本例都用 false 明确不设对应截止时间。Store.$runtime.flush() 是公开同步冲刷入口，使状态订阅在读取输出前完成，不改变动作作用域。

## 观察 Store 并在解绑后继续使用

诊断面板需要观察已有 Store 的动作与状态事件；关闭面板应停止观察，同时让应用状态继续可用。

把已经发出追踪事件的 Store 动作再包进一层动作，会增加重复边界；把绑定当作 Store 所有者，又会让面板清理销毁应用状态。

`bindStoreMiddleware` 转发 Store 自身的动作追踪与状态通知；直接安装 `@migaia/store-light`，用 `loggerMiddleware` 收集事件类型，刷新 Store 运行时后，独立释放绑定。

```ts doc-test=run
import { createStore } from '@migaia/store-light'
import { bindStoreMiddleware, loggerMiddleware } from '@migaia/store-middleware'
const events: string[] = []
const store = createStore({
  count: 0,
  increment() {
    this.count += 1
  }
})
const host = bindStoreMiddleware(store, {
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
})
await host.use(
  loggerMiddleware((event) => {
    events.push(event.type)
  })
)
store.increment()
store.$runtime.flush()
console.log(
  events.filter((type) => type === 'action').length,
  events.includes('state'),
  store.count
)
await host.dispose()
events.length = 0
store.increment()
store.$runtime.flush()
console.log(events.length, store.count)
await store.$dispose()
```

输出：

```text
2 true 1
0 2
```

逐行输出 `2 true 1`、`0 2`；首次动作产生两条动作事件及状态事件，绑定释放后，另一次动作仍改变 Store，却不再进入原中间件。

执行预算必填，`false` 显式取消对应截止时间；绑定只借用 Store 和运行时，默认诊断克隆尽力复制，不支持的子树仍可能按引用共享。

### 示例参数

createStore 的 shape 包含 count 字段与 increment 方法；未传自定义 mutationPolicy。binding 的 execution 两字段明确为 false，其余选项省略：Host 使用 off 策略，actionPrefix 为 undefined，clone 使用 diagnostic。loggerMiddleware 的 sink 收集 event.type；省略 sink 时输出到 console.log。Store 与 Runtime 只借入，最后由应用显式 $dispose Store。

## 让 Store 与宿主共享同一严格策略

组件不能直接赋值，但 Store 方法与宿主管理的动作都需要修改同一状态。

分别创建两个 `actions-only` 策略会产生两套动作深度；进入宿主策略的作用域，不能替另一个 Store 策略授权写入。

创建一份 `actions-only` 策略，把同一对象交给 `createStore` 与 `bindStoreMiddleware`；直接安装 `@migaia/store-light`，由 Store 执行守卫，`host.runAction` 进入共享作用域。

```ts doc-test=run
import { createStore } from '@migaia/store-light'
import { bindStoreMiddleware, createMutationPolicy } from '@migaia/store-middleware'

const policy = createMutationPolicy('actions-only')
const store = createStore(
  {
    count: 0,
    increment() {
      this.count += 1
    }
  },
  { mutationPolicy: policy }
)
const host = bindStoreMiddleware(store, {
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  mutationPolicy: policy
})
try {
  try {
    store.count = 1
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error)) throw error
    console.log(error.code)
  }
  host.runAction('set', () => {
    store.count = 2
  })
  console.log(host.mutationPolicy === policy, store.count)
  store.increment()
  console.log(store.count)
} finally {
  await host.dispose()
  await store.$dispose()
}
```

输出：

```text
ACTION_SCOPE_REQUIRED
true 2
3
```

逐行输出 `ACTION_SCOPE_REQUIRED`、`true 2`、`3`；直接赋值被拒绝，宿主持有同一个策略且能在动作内写入，Store 自身动作仍可使用。

策略模式默认 `off`；它检查写入许可，不是事务，也不会撤销用户副作用，作用域只覆盖同步执行，`await` 后的写入须重新进入作用域。

### 示例参数

createMutationPolicy 的 mode 默认为 off，本例明确 actions-only。Store options.mutationPolicy 与 binding options.mutationPolicy 是同一个对象；两 execution 预算为 false。runAction 的 name 是诊断名，fn 同步写入，metadata 省略为 undefined。Store action 进入自身作用域，直接字段写入先经过守卫。

## 区分诊断接收器失败与业务失败

日志接收器在观察动作时失败；应用仍须执行业务函数，而真正的业务异常必须交给调用者。

在业务路径上直接调用诊断接收器，会让日志故障中断动作；反过来吞掉所有异常，又会掩盖真实业务失败，还可能让人误以为状态已经回滚。

`createStoreMiddlewareHost` 隔离 `runAction` 的观察事件，并向传入运行时报告失败；直接安装 `@migaia/reactive`，本例用 `onError` 收集诊断，业务回调仍正常返回或抛错。

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { createStoreMiddlewareHost, loggerMiddleware } from '@migaia/store-middleware'

const reports: unknown[] = []
const runtime = createRuntime({
  onError: (error) => {
    reports.push(error)
  }
})
const state = { count: 0 }
const diagnostic = new Error('诊断接收器失败')
const business = new Error('业务操作失败')
const host = createStoreMiddlewareHost({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  runtime,
  getState: () => state
})
try {
  await host.use(
    loggerMiddleware(() => {
      throw diagnostic
    })
  )
  const result = host.runAction('save', () => {
    state.count = 1
    return 42
  })
  console.log(result, state.count, reports.length)
  try {
    host.runAction('fail', () => {
      state.count = 2
      throw business
    })
  } catch (error) {
    console.log(error === business, state.count, reports.length)
  }
} finally {
  await host.dispose()
}
```

输出：

```text
42 1 2
true 2 4
```

逐行输出 `42 1 2`、`true 2 4`；成功业务结果不受两次诊断报告影响，失败动作交付原业务错误，失败前的赋值仍已生效。

`runAction`、`recordState/recordError` 隔离观察失败，公开 `emit` 则可能抛出流水线错误；`runAction` 同步批处理，不回滚写入，也不等待返回的 Promise。

### 示例参数

createRuntime.onError 接收诊断错误；省略时使用 Runtime adapter.reportError。Host runtime 与 getState 必填，getState 返回本例 state 引用，不自动克隆；applyState 省略，mutationPolicy 默认为 off。两 execution 为 false。logger sink 同步抛诊断错误；两个 runAction 分别返回值或抛本地原错。

## 逆序释放绑定并保留清理失败

面板拥有两项绑定清理和一个插件资源；其中一项绑定清理失败，另一项绑定与插件仍须释放。

遇到第一个清理异常就停止，会遗留后续资源；多个调用者各自启动释放，也可能重复执行同一清理。

把同步绑定清理交给 `createStoreMiddlewareHost.attachBindingDisposer`，插件清理通过 `core.onDispose` 登记；直接安装 `@migaia/reactive`，`host.dispose` 先逆序执行绑定清理，再委托插件清理。

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { createStoreMiddlewareHost, type IStoreMiddlewarePlugin } from '@migaia/store-middleware'

type IState = { count: number }
const order: string[] = []
const original = new Error('绑定清理失败')
const host = createStoreMiddlewareHost({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  runtime: createRuntime(),
  getState: () => ({ count: 0 })
})
host.attachBindingDisposer(() => {
  order.push('一号')
})
host.attachBindingDisposer(() => {
  order.push('二号')
  throw original
})
const plugin: IStoreMiddlewarePlugin<IState> = {
  name: 'owned',
  install: (core) => {
    core.onDispose(() => {
      order.push('插件')
    })
    return {}
  }
}
await host.use(plugin)
const first = host.dispose()
const second = host.dispose()
console.log(first === second)
const result = await first
console.log(JSON.stringify(order))
console.log(
  result.cleanupComplete,
  result.cleanupErrors.length,
  result.cleanupErrors[0] === original
)
```

输出：

```text
true
["二号","一号","插件"]
true 1 true
```

逐行输出 `true`、`["二号","一号","插件"]`、`true 1 true`；释放调用共享同一个 Promise，清理按输出顺序继续执行，原始失败保留在 `cleanupErrors`。

`cleanupComplete` 表示委托清理已完成，不等于错误列表为空，已完成的绑定清理失败仍会记录；此处绑定清理函数是同步函数，不据此推断所有插件钩子都串行执行。

### 示例参数

Host 传入 createRuntime() 与 getState，execution 均为 false。attachBindingDisposer 接受同步无参函数；后登记的先执行。插件的 name 在该 Host 内唯一，install(core) 用 core.onDispose 登记插件资源并返回空扩展。dispose 无参数，cleanupComplete 和 cleanupErrors 各自描述完成情况与失败。

## 在 await 后重新进入动作作用域

异步流程从获准动作开始，等待下一步后再尝试受保护写入；后续执行不应继承已经返回的同步许可作用域。

一直把全局动作标记留到 Promise 完成，会让期间的无关工作也得到授权；把同步守卫当作异步事务，又会隐藏许可真正结束的位置。

`MutationPolicy.runInAction` 只在调用回调期间增加深度，并在 `finally` 恢复；比较返回前后的 `insideAction`，等待失败后，再显式进入一次同步写入作用域。

```ts doc-test=run
import { MutationPolicy } from '@migaia/store-middleware'

const policy = new MutationPolicy('actions-only')
let insideBeforeAwait = false
const pending = policy.runInAction(async () => {
  insideBeforeAwait = policy.insideAction
  await Promise.resolve()
  policy.assertMutationAllowed('deferred write')
})
console.log(insideBeforeAwait, policy.insideAction)
try {
  await pending
} catch (error) {
  if (!(error instanceof Error) || !('code' in error)) throw error
  console.log(error.code, policy.insideAction)
}
policy.runInAction(() => {
  policy.assertMutationAllowed('synchronous write')
})
console.log('已重新进入')
```

输出：

```text
true false
ACTION_SCOPE_REQUIRED false
已重新进入
```

逐行输出 `true false`、`ACTION_SCOPE_REQUIRED false`、`已重新进入`；异步回调开始时在作用域内，`await` 后的执行被拒绝，显式重新进入后检查通过。

模式默认 `off`，本例选择 `actions-only`；`runInAction` 立即返回回调结果，支持同步嵌套，不等待也不自动捕获稍后的 Promise 拒绝。

### 示例参数

MutationPolicy mode 明确为 actions-only，省略则 off。runInAction 的 fn 立即返回 Promise，后续 await 不保留同步作用域；assertMutationAllowed 的 operation 默认为 'mutation'，本例自定义字符串只作诊断。insideAction 是只读状态，不是可外部设置的授权开关。

## 明确选择独立副本或引用共享

审计历史需要独立的嵌套数据，诊断却可能需要保留无法克隆的回调；调用者必须明确选择需要哪种保证。

含糊的回退克隆可能在历史记录要求隔离时，悄悄返回实时引用；把结果称作不可变，还可能让人误以为返回对象已经冻结。

`ClonePolicy.immutable` 要求支持的数据图得到独立副本，`opaque` 返回原引用，`diagnostic` 尽力复制；严格路径在执行访问器 getter 前就拒绝该输入。

```ts doc-test=run
import { ClonePolicy } from '@migaia/store-middleware/tolerant-clone'

const source = { nested: { count: 1 } }
const independent = ClonePolicy.immutable(source)
const same = ClonePolicy.opaque(source)
source.nested.count = 2
console.log(independent.nested.count, same.nested.count, independent === source, same === source)
let reads = 0
const accessor = Object.defineProperty({}, 'value', {
  enumerable: true,
  get: () => {
    reads += 1
    return 1
  }
})
try {
  ClonePolicy.immutable(accessor)
} catch (error) {
  if (!(error instanceof Error) || !('code' in error)) throw error
  console.log(error.code, reads)
}
const callback = () => 1
const candidate = { nested: { count: 1 }, callback }
const diagnostic = ClonePolicy.diagnostic(candidate)
candidate.nested.count = 9
console.log(diagnostic.nested.count, diagnostic.callback === callback)
console.log(Object.isFrozen(independent))
```

输出：

```text
1 2 false true
CLONE_UNSUPPORTED 0
1 true
false
```

逐行输出 `1 2 false true`、`CLONE_UNSUPPORTED 0`、`1 true`、`false`；严格副本独立，不透明策略共享引用，getter 没被执行，诊断策略复制嵌套数据并保留回调身份。

独立不等于冻结；缺少 `structuredClone` 时严格策略可能抛 `ENV_UNSUPPORTED`，不支持的数据可能抛 `CLONE_UNSUPPORTED`，诊断策略仍可能共享不支持的子树，不透明策略始终返回原值。

### 示例参数

三种策略均只接收 value，无 options；本例 source 为普通记录与嵌套数据。immutable 得到独立可变副本，opaque 保持严格引用身份；diagnostic 复制支持的嵌套数据并保留函数引用。Object.defineProperty 的 getter 被严格准入拒绝，reads=0；immutable 不是冻结函数。

## 契约细节

### 归属、入口与迁移

本包为 Store 提供写入许可、action/state/error 事件和可装卸诊断插件；状态字段、订阅、$plain/$hydrate 属于 store-light，依赖图与上报属于 reactive，安装/卸载和 pipeline 属于 plugin-host。它不实现持久化或历史面板，相关功能分别由 store-persist、store-devtools 组合。只要简单监听状态时，Store.$subscribe 已足够。

根入口导出 MutationPolicy/createMutationPolicy、事件与命令词表、Host/binding/logger/DevTools adapter 和错误；克隆策略只从 `@migaia/store-middleware/tolerant-clone` 导入。普通依赖为 middleware-pipeline、plugin-host、reactive、store-light、utils。示例直接导入 store-light/reactive 时要显式安装对应包。

旧 middlewarePlugin/IStoreMiddleware/IMiddlewareContext 已移除，改用 `IStoreMiddlewarePlugin` 的 install(core) 与 core.usePipeline。旧 tolerantClone 名在两入口都已删除；ClonePolicy、immutableSnapshotClone、opaqueReferenceClone、diagnosticClone 以及 IClonePolicyMode 都归窄入口。IMutationGuard/IMutationPolicy 直接从 store-light 导入，没有本包别名。原 store-devtools 的 StoreDevtoolsCommand/IStoreDevtoolsCommand 迁移到本包 ReduxDevToolsCommand/IReduxDevToolsCommand，协议字符串不变。

### MutationPolicy：同步写入许可

`new MutationPolicy(mode?)` 与 `createMutationPolicy(mode?)` 等价，mode 默认 `'off'`，联合为 `'off' | 'actions-only'`。off 放行；actions-only 在当前 action 深度为 0 时拒绝 assertMutationAllowed，错误为 ACTION_SCOPE_REQUIRED，信息为 `[store] {operation} is not allowed outside an action`。

| 成员                                            | 参数、默认与行为                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| `insideAction:boolean`                          | 只读，反映至少一层 runInAction 正在同步执行                         |
| `assertMutationAllowed(operation?:string):void` | operation 默认 `'mutation'`，只用于诊断；检查当前许可，不自行改状态 |
| `runInAction<T>(fn:()=>T):T`                    | 同步执行并返回原值；用深度计数支持嵌套，finally 恢复深度            |

返回 Promise 不延长作用域，不等待其结算；await 后写入要重新进入 action。它不是事务，不回滚已完成写入或回调的外部副作用。同步 fn 失败保留已有包身份，未编码失败按 CALLBACK_FAILED 附码或通过 cause/errors 保留原值。

要让 host.runAction 授权 Store 写入，createStore 和 binding 必须共享同一个 mutationPolicy。不同实例不会取消 Store 自己的直接写守卫；Store action、$set/$batch 等仍进入其自身策略，但 Host 不能授权另一个实例。策略放行与真正拦截字段写入是两回事，后者由 Store 负责。

### 事件与公共词表

`IMiddlewareEvent<S>` 为以下三类的联合。metadata 均可省略，类型为 `Readonly<Record<string,unknown>>`，没有隐含复制策略。

| 事件类型       | 字段                                                         | 含义                                      |
| -------------- | ------------------------------------------------------------ | ----------------------------------------- |
| action / start | name:string、timestamp:number、metadata?                     | 同步 action 开始                          |
| action / end   | 同上，另 durationMs:number                                   | 同步调用返回，不代表所返回 Promise 已完成 |
| action / error | 同上，另 durationMs:number、error:unknown                    | 同步调用抛错                              |
| state          | name:string、timestamp:number、previous:S、next:S、metadata? | 一次状态观察，副本保证取决于 clone        |
| error          | phase:string、timestamp:number、error:unknown、metadata?     | 诊断失败；phase 是调用者标识来源的字符串  |

Host 自行生成的 timestamp 使用 Date.now；runAction 的 durationMs 使用 performance.now，缺失时退回 Date.now。binding 转发 Runtime trace 原有的 timestamp，durationMs 缺省按 0。它记录的是同步工作持续时间。

常量与值联合分别为 MiddlewareEventType/IMiddlewareEventType（action/state/error）、MiddlewareEventPhase/IMiddlewareEventPhase（start/end/error）、MiddlewareCommandType/IMiddlewareCommandType（commit/jump/reset）。这些是枚举式对象，无调用参数。

### Host 构造与参数

`createStoreMiddlewareHost<S>(options):IStoreMiddlewareHost<S>` 创建唯一的冻结 managed Host 句柄，不是可 new 的类。其 use/unUse、配置、插件身份和稳定返回句柄复用 plugin-host；Store 领域成员在同一个 canonical 句柄冻结前装入，没有二次包装。输入非对象、选项反射或读取失败为 INVALID_OPTION，原错在 cause。

| 字段                             | 默认值          | 行为                                                               |
| -------------------------------- | --------------- | ------------------------------------------------------------------ |
| runtime:IRuntime                 | 必填            | 批处理与 reportError 的借入运行时                                  |
| getState:()=>S                   | 必填            | 每次插件读取调用此函数；不隐含复制                                 |
| applyState?:(state:S)=>void      | undefined       | DevTools jump/reset 所需；缺失时执行状态命令为 DEVTOOLS_CAPABILITY |
| mutationPolicy?:MutationPolicy   | 新建 off 策略   | 与 Store 共用实例才能统一授权                                      |
| execution.mutationTimeoutMs      | 必填，无默认    | 有限非负毫秒数或 false；单次变更 hook 预算，false 无期限           |
| execution.pipelineDrainTimeoutMs | 必填，无默认    | 有限非负毫秒数或 false；pipeline 排空预算                          |
| identity.name?:string            | `'DEFAULT'`     | 非空可读标签；唯一 id 由 Host 签发                                 |
| pipeline.mode                    | 强制 `'sync'`   | 即使传 async/generator/async-generator 也被覆盖                    |
| diagnostic?                      | 空操作          | plugin-host 清理、迟到失败与排队观察                               |
| onDiagnosticFailure?             | undefined       | diagnostic 自身失败接收器，缺失或再失败走宿主 reportError          |
| scheduler?                       | systemScheduler | 排队与清理的时钟/计时来源                                          |
| queueAdmissionTimeoutMs?         | undefined       | 仅报告不拒绝；false 关闭计时/报告/拒绝；数值超时移除排队工作       |
| queueAdmissionDiagnosticMs?      | 1000            | 未设排队拒绝阈值时的报告阈值；false 关闭                           |
| disposeStepTimeoutMs?            | 5000            | 单清理步骤预算，false 无限等待，不强制中断 JS                      |

execution 数值允许 0 与有限小数，false 才明确无期限；两字段均不能省略。Host 的预算不把同步 runAction 变为可取消任务，也不保证停止不合作的用户代码。

### Host 成员、插件与管道

| 成员                                                               | 参数与行为                                                                        |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| mutationPolicy                                                     | 只读的实际策略实例                                                                |
| `emit(event:IMiddlewareEvent<S>):void`                             | 直接同步执行 pipeline，pipeline 错误可向调用者抛出                                |
| `runAction<T>(name:string,fn:()=>T,metadata?):T`                   | 隔离派发 start→策略作用域内 runtime.batch(fn)→end/error，返回原结果或传播业务失败 |
| `recordState(name:string,previous:S,next:S,metadata?):void`        | 隔离派发 state，插件失败向 Runtime 报告                                           |
| `recordError(phase:string,error:unknown,metadata?):void`           | 隔离派发 error；处理 error 时重入直接 reportError，不再递归 pipeline              |
| `connectDevTools(adapter:IDevToolsAdapter<S>,name?):Promise<void>` | name 默认 `'store-devtools'`，把 adapter 装成插件                                 |
| `attachBindingDisposer(disposer:IDisposer):void`                   | 登记同步清理函数；关闭后登记立即调用，失败同步传播                                |
| `dispose()`                                                        | 返回稳定 Promise 与结构化清理结果，见生命周期                                     |

runAction 不等待返回 Promise；同步返回即发 end，后续 rejection 不会自动变成这次 action:error。它本身不克隆状态或撤销失败 action 之前的写入。recordState/recordError 和 runAction 的观察事件通过隔离通道报告诊断失败；公开 emit 不在该隔离保证内。

`IStoreMiddlewarePlugin<S,TExt,TConfig,TShared>` 直接复用通用 IPlugin；后三个类型默认分别为 Record<string,never>、Record<string,unknown>、Record<string,never>。install(core) 同时拿到通用 config/getShared/onDispose/usePipeline 和领域 runtime/getState()/applyState(state)/reportError(error,phase)。领域错误上报透传 Runtime。

只能 usePipeline 注册同步 stage；useAsyncPipeline/useGeneratorPipeline 模式不匹配，由 plugin-host 的 PIPELINE_MODE_MISMATCH 拒绝。next(event) 只记录继续值，下游在当前 stage 返回后执行；不能用 next 后的代码同步观察下游完成。只第一次 next 生效，重复/迟到按 PIPELINE_NEXT_DUPLICATE/PIPELINE_NEXT_LATE 报告。遗漏 next 阻止后续事件处理并向 Runtime trace-listener 报 MIDDLEWARE_NOT_CHAINED，不撤销已经发生的 Store 写入。

`loggerMiddleware<S=any>(sink?)` 创建名称固定 `'store-logger'` 的插件。sink 默认 `console.log('[store]',event,state)`，参数为 `(IMiddlewareEvent<unknown>,unknown)=>void`；不依赖状态类型，S 仅用于约束目标 Host。它先调用 next 记录继续值，再在当前 stage 读取 core.getState 并调用 sink；此时下游 stage 还未运行。state 是调用 sink 时读到的值，不是事件生成时自动固定的快照。sink 的返回 Promise 不被等待。

### bindStoreMiddleware：借用 Store 并桥接观察

`bindStoreMiddleware<S extends Record<string,unknown>>(store:IReactiveStore<S>,options:IStoreMiddlewareBindingOptions):IStoreMiddlewareBinding<S>` 的两个参数均必填。返回同一个冻结 canonical Host，含只读 store 属性，严格等于传入实例；并非另建 Store 或 Runtime。

| options 字段                                                  | 默认值                                   | 作用                                                       |
| ------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------- |
| execution                                                     | 必填，两预算无默认                       | 同 Host 的 mutationTimeoutMs/pipelineDrainTimeoutMs        |
| mutationPolicy?                                               | Host 新建 off 策略                       | 共享 Store 的实际策略以统一 host.runAction 许可            |
| actionPrefix?:string                                          | undefined                                | 只转发 name 以此前缀开头的 action trace；空字符串不过滤    |
| clone?:(state:Record<string,unknown>)=>Record<string,unknown> | `state => ClonePolicy.diagnostic(state)` | 绑定、状态通知及 getState 每次尽力复制，可能共享不支持子树 |

绑定时把 clone(store.$plain()) 记为 previous；首次同步读取/clone 失败复用 callback 身份规则，未编码失败归 CALLBACK_FAILED，可附码原生错误保持原实例，冻结错误经 cause 保留；后续订阅与 Host 读取仍沿各自 owner 的错误路径处理。之后每次 Store 通知重新复制为 next，调用 recordState('store:update',previous,next)，再更新 previous。绑定前的历史不会回放，第一份 previous 是绑定当时的值。getState 每次重新 clone($plain)，applyState 桥接 $hydrate。

只桥接 $plain 暴露的普通字段；computed、方法、WASM 支撑字段及外部资源不进入 previous/next。Runtime action trace 直接 host.emit 转发，不再 host.runAction，因此不重复进入策略；不要再手动用 host.runAction 包装同一个 Store action，否则两条路径各自发事件。actionPrefix 过滤的是同一 Runtime 的 trace 名称，不是 Store 所有权鉴别。

订阅构造失败时先尝试退订 trace 与状态，再关闭 Host；若同步回滚也失败，用 CLEANUP_FAILED AggregateError，errors[0] 为主错，其后保留原清理错误。清理失败没有抹掉原始绑定失败。成功绑定的正常 dispose 走结构化结果，不沿此异常路径。

### DevTools 协议与边界

`IDevToolsAdapter<S>` 有同步 init(state:S)、send(event:IMiddlewareEvent<S>,state:S)，可选 subscribe(listener:(command:IDevToolsCommand<S>)=>void):IDisposer。init/send 必须为函数，subscribe 若存在也必须为函数，否则 connectDevTools 拒绝 INVALID_OPTION。

领域命令为 `{type:'commit'} | {type:'jump',state:S} | {type:'reset',state:S}`。连接时立即 init(core.getState())；每事件 stage 中 next 后调用 send，仍遵循“当前 stage 返回才到下游”。commit 重新 init 当前状态；jump/reset 用 runAction('devtools:<type>',()=>applyState(state)) 执行，会产生真正 action 事件。未提供 applyState 时 DEVTOOLS_CAPABILITY；binding 已桥接 $hydrate。只恢复普通字段，不还原外部副作用、方法、computed 或 WASM 资源。

`createReduxDevToolsAdapter<S>(connection:IReduxDevToolsConnection<S>,runtime?)` 的 connection 必填且含 init(state)、send(action:unknown,state)、subscribe(listener):IDisposer；runtime 默认共享 Runtime，仅用于解析失败报告。IReduxDevToolsMessage 的 type、payload.type、state 都可省略，state 是 JSON 字符串。

| ReduxDevToolsCommand 属性 | 协议值         | adapter 处理                |
| ------------------------- | -------------- | --------------------------- |
| dispatch                  | DISPATCH       | 只接纳这种 message.type     |
| commit                    | COMMIT         | 产生 commit，无需 state     |
| jumpToState               | JUMP_TO_STATE  | 有 state 时解析并产生 jump  |
| jumpToAction              | JUMP_TO_ACTION | 同上                        |
| rollback                  | ROLLBACK       | 同上                        |
| reset                     | RESET          | 有 state 时解析并产生 reset |

非 DISPATCH、未知 payload.type、状态命令缺少 state 都忽略。支持命令中的坏 JSON 不执行，向指定 Runtime 以 trace-listener 报原 SyntaxError/DEVTOOLS_MESSAGE_INVALID，后续合法命令仍可用。JSON.parse 成功不等于验证 S 的领域形状。adapter.send 的 action 标签为 action 的 name:phase、state 的 name、或 error:phase，且同时携带原 event。IReduxDevToolsCommand 是协议值联合，与领域 MiddlewareCommandType 分开。

### 显式克隆策略

窄入口提供三个单参数泛型函数 `(value:T)=>T`，无额外选项；ClonePolicy 把它们聚合为以下属性，IClonePolicyMode 为三种属性名的联合：

| 策略 / 函数                        | 保证与边界                                                         |
| ---------------------------------- | ------------------------------------------------------------------ |
| immutable / immutableSnapshotClone | 独立深拷贝或拒绝，不静默返回共享子树；不等于 Object.freeze         |
| opaque / opaqueReferenceClone      | 原值原引用，不进行复制；明确接受共享                               |
| diagnostic / diagnosticClone       | 尽力复制且不抛复制失败；不支持的子树可按引用保留，不是严格历史记录 |

immutable 先接纳严格数据图，再委托 Utils 唯一 structuredClone 实现。允许普通/null 原型记录、普通数组、当前 realm 原生 Map/Set/Date/RegExp/ArrayBuffer，以及非共享 ArrayBuffer 支撑的标准 TypedArray/DataView。递归检查 Map key/value、Set 成员和记录/数组数据属性；循环与共享引用交由原克隆引擎保持。自定义 class（含内建子类）、未接纳的原生类型拒绝；记录/数组访问器在求值前拒绝，不运行 getter。函数、symbol 等由 canonical clone 拒绝。缺 structuredClone 为 ENV_UNSUPPORTED，不支持值为 CLONE_UNSUPPORTED；Utils 错误整个保留在 cause，其下再到原生失败，不跳过中间层。

旧版 class 静默丢方法、getter 求值、跨 realm 或未列内建值应迁移为支持的数据，或明确选择 diagnostic/opaque。Utils 自身的投影契约没有被本策略改写。

diagnostic 优先 structuredClone，失败时复用 canonical 递归复制：plain object/array 递归，支持的 Date/RegExp/Map/Set/ArrayBuffer/TypedArray 子树单独克隆，函数/类/宿主子树可保留引用。枚举访问器按 Utils 行为读取并记录，`__proto__` 通过 defineProperty 写入；循环和共享结构由该遍历处理，不另建 clone 引擎。默认 binding 的 diagnostic 不能保证全树隔离；opaque 只是省去复制，不承诺实测速度。

### 清理与错误身份

Host 的 use/unUse/dispose、插件失败回滚、配置与资源逆序清理归 plugin-host。同一 Host 插件名唯一。dispose 首先关闭 binding disposer 登记，再同步按后进先出调用，尝试全部清理，之后卸载插件；不等待 disposer 返回的 Promise，应登记同步函数。重入登记立即执行；晚登记失败按 callback 身份规则同步传播。

重复 dispose 返回同一 Promise，结果为 `{logicalTerminal,cleanupComplete,cleanupErrors}`，可保留 plugin-host 的其它物理清理信息。绑定 disposer 失败排在 cleanupErrors 前面，然后是插件清理失败；这些被收集而不以清理异常拒绝 Promise。cleanupComplete 沿用插件清理完成状态，表示物理完成，不表示 cleanupErrors 必为空。关闭不会销毁借入 Store/Runtime；Store 可继续工作，只是不再被这一绑定观察。领域闭包没有统一的 open 守卫，保留的 runAction 仍可执行 fn；关闭插件接纳不等于取消任意业务回调。

| StoreMiddlewareErrorCode 属性 | code                     | 场景                                                                   |
| ----------------------------- | ------------------------ | ---------------------------------------------------------------------- |
| invalidOption                 | INVALID_OPTION           | Host options 或 DevTools adapter 形状/读取失败                         |
| middlewareNotChained          | MIDDLEWARE_NOT_CHAINED   | stage 遗漏 next，向 Runtime 报告                                       |
| actionScopeRequired           | ACTION_SCOPE_REQUIRED    | actions-only 作用域外写入                                              |
| cloneUnsupported              | CLONE_UNSUPPORTED        | immutable 数据不受支持或克隆失败                                       |
| callbackFailed                | CALLBACK_FAILED          | 没有已有身份的同步 action、初始 binding clone 或 binding disposer 失败 |
| devtoolsMessageInvalid        | DEVTOOLS_MESSAGE_INVALID | 支持的 Redux 状态命令 JSON 无效，报告并跳过                            |
| devtoolsCapability            | DEVTOOLS_CAPABILITY      | 状态命令没有 applyState                                                |
| envUnsupported                | ENV_UNSUPPORTED          | immutable 环境缺 structuredClone                                       |
| cleanupFailed                 | CLEANUP_FAILED           | 绑定设置失败且同步回滚也失败                                           |

`IStoreMiddlewareErrorCode` 是码值联合，`STORE_MIDDLEWARE_SOURCE='@migaia/store-middleware'` 只标识本包创建的错误；Reactive、pipeline 及其它已有 source/code 保持实际 owner。能附码的原生错误保留原实例、类型、message、stack，不可附码或非 Error 值经 cause/errors 保留。不要把记录状态、业务失败与诊断失败混成一个控制流。

`createStoreMiddlewareError(code,message,options?)` 返回原生 Error；code:IStoreMiddlewareErrorCode、message:string 均必填，options 默认 undefined，唯一字段可选 cause；显式自有 cause（包括 undefined）转发原生 Error。`createStoreMiddlewareAggregateError(code,errors:readonly unknown[],message)` 返回原生 AggregateError，三参必填，errors 保留原对象。两者只构造、不自动 throw，附不可写 source/code、不改 stack。

### 排查与开发命令

action 外写入未被拦截时先检查 Store 构造的实际策略实例。异步代码应在每段同步提交时重新进入 action。事件重复先查是否把已绑定的 Store 方法又包了一层 runAction。快照被后续编辑污染时检查 opaque 和 diagnostic 的共享子树；严格独立时选择 immutable 并处理拒绝。

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```

列出命令不表示本次由文档任务运行；构建脚本另有 pnpm run build。
