# `@migaia/plugin-host`

**运行时中立的 TypeScript 插件宿主**——不依赖 Node、Bun、Deno、DOM 或任何具体框架，给你的类库/应用装上一套"可以被别人用插件扩展"的能力。

## 适用与不适用场景

**适用**：你在写一个库（logger、状态管理器、网络客户端……），希望核心保持精简，把颜色输出、批量发送、退出前 flush 这类可选能力做成独立插件，按需装卸；需要插件之间共享能力（比如"批处理"插件的调度器被"HTTP 上报"插件复用）；需要统一的安装失败回滚、卸载资源清理、按插件维度的配置管理；需要一套 sync/async/generator 三选一的处理管线机制。`@migaia/logger` 就是用这套机制实现插件化的真实例子。

**不适用**：如果你的"扩展点"只有一两个、且不需要动态装卸，直接写几个可选参数或组合函数比引入一套插件系统更简单——这个包解决的是"扩展点会持续增长、需要统一治理"这个规模化问题。它也不是通用的处理管线执行器：纯粹的 sync/async/generator middleware 执行算法在 [`@migaia/middleware-pipeline`](../middleware-pipeline/README.md)，本包只负责把插件注册的 stage 接入执行器,并叠加插件注册、生命周期、配置、diagnostic 这层。

## 安装

```bash
pnpm add @migaia/plugin-host
```

包公开根入口 `@migaia/plugin-host`，另有稳定的 `@migaia/plugin-host/composition` 子路径。根入口
提供 `PluginHost`、插件/配置/pipeline 类型、状态常量、错误码与错误类、
`GENERATOR_*` 信号量与 dispose symbol；composition 子路径仅提供 opaque
`IRegistrationToken`、`IRegistrationView<TPlugin>` 与 `createView(token)`。不要依赖 `src`/`dist`
内部文件，也不要把 composition view 当成 Host mutation/config/shared 能力。

## 目录

- [核心心智模型：五分钟上手](#核心心智模型五分钟上手)
- [Host 构造与生命周期 API](#host-构造与生命周期-api)
- [插件对象与插件 core API](#插件对象与插件-core-api)
- [Pipeline 处理管线](#pipeline-处理管线)
- [错误、诊断与状态常量](#错误诊断与状态常量)
- [底层适配器与信号量](#底层适配器与信号量)
- [高阶组合示例](#高阶组合示例)
- [支持环境](#支持环境)
- [构建门禁](#构建门禁)

完整签名、每一种边界行为与错误码，见 [USEGUIDE.md](./USEGUIDE.md)。

### 与 Tray 托管组合

这一节只给 Tray 的 Host 适配器维护者看。普通应用安装和卸载插件时继续使用 `use()` / `unUse()`，不需要接触下面这些对象。

Tray 一次安装多个插件时，先让 PluginHost 完成插件的 `setup`，但暂时不让业务代码看见它们。这个“已经准备好、还没有正式发布”的批次叫 **prepared admission**，可以理解成数据库事务提交前的暂存区：整批都成功才一次性公开；其中一个失败，整批都不公开。

正式公开前，PluginHost 会检查准备期间是否有别人改过 Host。这里的 **Host revision** 就是 Host 的修改版本号；版本号变了，说明这批结果基于旧状态，提交会被拒绝。Tray 随后调用 `discardPreparedAdmissions()`，PluginHost 只清理这批暂存资源一次，不会重复执行插件的释放逻辑。

提交成功后，每个插件都会得到一张只能由当前 Host 签发和识别的“安装凭证”，正式类型名是 **exact receipt**。Tray 卸载或替换插件时拿这张凭证指向那一次具体安装，因此旧插件迟到的清理动作不会误删同名的新插件。**opaque data-order slot** 则是 Host 内部保存的排序位置：Tray 只能原样交还，不能读取或伪造；同一个插件定义重启或替换时沿用位置，定义删除或整个会话结束时才永久作废。宿主 stage 与插件槽位按首次分配的先后执行；禁用、恢复和替换不重排，替换发布后的新运行只执行新一代 stage。

托管卸载分两步。第一步先让新请求看不到待卸载插件，这叫“逻辑撤销”；排空期间发起的新 pipeline 运行不含该插件 stage，仍可正常完成。第二步等待已经拿到旧插件的请求和正在执行的 pipeline 全部结束，再真正调用插件与资源的 `dispose()`，这叫“物理完成”。如果等待时间达到调用方设置的上限，接口会先返回 `cleanupComplete: false`；这不代表资源已经释放，调用方仍须等待返回的 `physicalCompletion` Promise。超时只允许调用方先拿回控制权，不会跳过或打乱清理顺序。

---

<a id="核心心智模型五分钟上手"></a>

## 核心心智模型：五分钟上手

```ts
import { definePlugin, PluginHost } from '@migaia/plugin-host'

// 第一步：定义你的领域能力——这是你的库真正想暴露的核心功能
type ICore = { emit(value: string): void }

class Host extends PluginHost<ICore, string> {
  protected createPluginDomainCore(): ICore {
    return { emit: (value) => console.log(value) }
  }
}

// 第二步：definePlugin(name, descriptorFactory) 定义插件；这里只定义，不会立刻安装
const upper = definePlugin<ICore, { upper(value: string): string }>('upper', (core) => ({
  install: () => ({
    upper: (value: string) => {
      const result = value.toUpperCase()
      core.emit(result) // 插件可以调用领域能力
      return result
    }
  })
}))

// 第三步：安装、使用、卸载
const host = new Host({
  execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 }
})
const view = await host.use(upper)
view.extensions.upper('migaia') // 扩展只出现在成功安装后返回的 committed view 上
await view.unUse('upper')
await host.dispose()
```

`definePlugin()` 有两种写法。上面是函数形 `definePlugin(name, descriptorFactory)`：每次安装先同步创建一个 descriptor，再由其 `install`、`expose`、`featureExpose`、`shared` hooks 提供这次安装的能力。需要 `config`、`update`、`dispose` 等长期定义字段时使用保留对象形：`definePlugin({ name, config, install, shared, update, dispose })`。调用 `definePlugin()` 只会校验并保存定义，不会执行 descriptor 或 `install()`；真正的安装发生在 `host.use(plugin)`。

`PluginHost<TDomainCore, TValue>` 子类唯一必须实现的是 `createPluginDomainCore()`——每次插件安装都会调用一次，产出一份独立的领域 core。插件通过 `install(core)` 拿到“领域能力 + 通用 core 能力”，返回扩展方法。`use()` 成功后按输入顺序返回插件句柄，业务代码从 `handle.extensions` 调用这些方法；`host.unUse(name)` 卸载插件，`host.dispose()` 关闭整个宿主。

### 禁用不是卸载

`host.plugin.disable(name)` 暂时关闭该插件的 extension、Feature expose 与 pipeline stage，返回可精确还原的 `token`。`await token.enable()` 恢复原插件与 stage 顺序；按字符串操作时可用 `host.plugin.enable(name)`，当前禁用列表由 `host.plugin.disabled()` 返回。class 宿主与 `defineHost()` handle 使用同一套入口。

禁用保留资源与插件注册，不调用 `dispose` 或资源 disposer。`onDisable`/`onEnable` 只是通知：安装成功后先发一次 `onEnable`，之后每次真实状态切换各发一次；钩子失败只进入诊断，不回滚已提交状态。需要释放资源时调用 `unUse(name)`。安装依赖已禁用 provider 的插件抛 `PREREQUISITE_DISABLED`（可启用恢复），provider 已卸载抛 `PREREQUISITE_REMOVED`（需重装），从未安装抛 `PREREQUISITE_MISSING`；这些依赖码直接作为顶层错误抛出，不包在 `PLUGIN_INSTALL_FAILED` 里。provider 仍被禁用时单独 `enable` 其依赖者同样抛 `PREREQUISITE_DISABLED`。

依赖变更选项为 `{ policy?: 'reject' | 'cascade' | 'suspend'; dryRun?: boolean }`，默认 `reject`。`cascade` 会连同传递必需依赖者一起处理；`suspend` 只禁用或卸载目标，把已激活的必需依赖者挂起而不释放其实例。挂起期间句柄和已取出的 extension 抛 `PLUGIN_SUSPENDED`，stage 不参与 pipeline；同一 provider 重新启用时原实例直接恢复，同名新 provider 安装后按 capability `planResume` 换绑、恢复或重启。旧 `{ cascade: true }` 已删除并抛 `INVALID_OPTION`。

### 热替换与惰性激活

`await host.replace(name, next)` 先安装 `next`；失败时旧实现继续服务、错误照常以 `PLUGIN_INSTALL_FAILED` 抛出。成功后依赖者若实现 `onDependencyReplaced(name, outputs)` 就原地换绑，未实现或钩子抛错的依赖者（及其必需依赖闭包）重启；旧注册在其 pipeline 租约排空后才 dispose。若重启失败，替换仍然生效、旧实现已释放、重启失败的插件保持卸载，并抛 `DEPENDENT_RESTART_FAILED`（`cause` 为 `AggregateError`，首项是重启失败，其后是钩子与清理错误）。

`activation: 'lazy'` 的插件在 `use()` 时只登记不安装；`await host.activate(name)` 先按依赖顺序激活它必需的惰性 provider 再安装自身，并发调用共享同一个 Promise。非惰性插件安装时会先激活它必需的已登记惰性 provider；依赖校验失败时不激活任何插件。同步的 `useSync()` 无法等待激活，遇到未激活的必需 provider 抛 `PLUGIN_NOT_ACTIVATED`。

---

<a id="host-构造与生命周期-api"></a>

## Host 构造与生命周期 API

```ts
import { PluginHost, type IPluginHostOptions } from '@migaia/plugin-host'
```

**`new Host(options?)`** —— 构造函数，`TValue` 泛型不为 `never` 时才需要用到 pipeline。全部选项字段（`IPluginHostOptions`）：

- `pipeline?: { mode?: 'sync' | 'async' | 'generator' | 'async-generator' }` —— 默认 `'sync'`；运行期不能切换，非法值抛 `INVALID_PIPELINE_MODE`。
- `diagnostic?: (message: string, code?: IPluginHostErrorCode, error?: unknown) => void`（`IPluginHostDiagnostic`）—— 接收"不构成错误但值得关注"的信号（如 `PIPELINE_NEXT_LATE`、`EXTENSION_NON_ENUMERABLE_IGNORED`、队列等待）；被吞下而改为上报的错误（回滚/清理失败、换绑钩子失败、Feature 异步拒绝）会以原始对象经第三个参数送达，可沿 `cause`/`errors` 追溯；
- `onDiagnosticFailure?: (error: unknown) => void` —— 诊断回调自身抛错或 reject 时收到那个失败对象；未提供（或它也抛错）时交给运行时的 `globalThis.reportError`（浏览器/Deno/Bun；Node 没有该接口，需要在 Node 观测时请显式提供）。不是函数抛 `TypeError`（`INVALID_OPTION`）；不是函数会抛 `TypeError`；诊断回调自身抛出的异常永远不会影响宿主正常执行流程。
- `scheduler?: ILifecycleScheduler`（来自 `@migaia/lifecycle`）—— 时间源，默认内部 `systemScheduler`；传入的对象必须提供 `now()`/`schedule()`，否则抛 `TypeError`。
- `queueAdmissionTimeoutMs?: number | false` —— mutation 在 FIFO 队列中等待被拒绝的阈值。**默认 `undefined`：只诊断、不拒绝**（即默认情况下排队再久也不会触发 `MUTATION_QUEUE_TIMEOUT`）；传 `false` 关闭一切队列等待相关的计时器和诊断；传具体数值后，等待超过该阈值会被移出队列并以 `MUTATION_QUEUE_TIMEOUT` reject。
- `queueAdmissionDiagnosticMs?: number | false` —— 未配置 `queueAdmissionTimeoutMs`（拒绝阈值）时使用的诊断阈值，默认 `1000`；传 `false` 关闭该诊断计时器。
- `disposeStepTimeoutMs?: number | false` —— 单个 disposer 步骤（pipeline disposer / 插件 dispose 钩子 / resource disposer）的最长等待时间，默认 `5000`；传 `false` 表示永久等待、不触发 `DISPOSE_STEP_TIMEOUT`。

超时类选项传入非 `false` 的非有限非负数（负数、`NaN`、`Infinity`、非 `number`）一律抛 `TypeError`（`INVALID_OPTION`）。

**Host 实例方法/属性**：

| API                                     | 参数                                                               | 返回                                                    | 作用                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `host.use(...plugins)`                  | 至少 1 个插件定义                                                  | `Promise<PluginHandle[]>`                               | 按 Feature 依赖拓扑安装；返回与输入同序的名称句柄。                                   |
| `host.unUse(name)`                      | `name: string`                                                     | `Promise<IPluginRemoval>`                               | 依赖安全地卸载插件及其 extension/stage/资源。                                         |
| `host.dispose()`                        | 无                                                                 | `Promise<void>`                                         | 卸载全部插件并永久关闭宿主；重复调用复用同一 Promise。                                |
| `host.config.get(path)`                 | `path: string`——插件名，或 `插件名.键` / `插件名.[下标].键`        | `unknown \| undefined`                                  | 同步读取；对象/数组返回 Readonly 懒代理；未知插件或路径返回 `undefined`。见下方说明。 |
| `host.config.update(name, recipe)`      | `name: string`；`recipe(previous) => Partial<patch>`（须同步返回） | `Promise<void>`                                         | Copy-on-Write 合并 patch，跑 `plugin.update(next, core)` 成功才提交。                 |
| `host.pipelineMode`                     | 无（只读属性）                                                     | `'sync' \| 'async' \| 'generator' \| 'async-generator'` | 构造时固定的 pipeline 模式。                                                          |
| `host.usePipeline(stage)`               | `(value, next) => void`                                            | `this`                                                  | sync stage 可提升到任意 Host mode。                                                    |
| `host.useAsyncPipeline(stage)`          | `(value, next) => void \| Promise<void>`                           | `this`                                                  | 仅 async mode 可用；`next()` 返回 Promise。                                           |
| `host.useGeneratorPipeline(stage)`      | `(value) => Generator<...>`                                        | `this`                                                  | 可用于 generator 与 async-generator mode，后者由 runner 提升。                       |
| `host.useAsyncGeneratorPipeline(stage)` | `(value) => AsyncGenerator<...>`                                   | `this`                                                  | 仅 async-generator mode 可用。                                                        |
| `PluginHost.setLocale(locale)`          | `locale: 'en' \| 'zh'`（静态方法）                                 | `void`                                                  | 切换内置错误文案语言，影响全局、全部 Host 实例。                                      |

无法提升的组合会同步抛顶层 `PluginHostError`，`code === 'PIPELINE_MODE_MISMATCH'`；其 `cause` 是 middleware-pipeline 原始 `TypeError`，携带 `code === 'INVALID_OPTION'` 与 `source === '@migaia/middleware-pipeline'`。

**`host.config.get(path)` 的路径语义**：`path` 可以是"插件名"本身（返回该插件整份只读配置），也可以是 `插件名.键`（可继续 `.` 或 `.[下标]` 深入嵌套）。找不到匹配的插件、或路径中途缺失，返回 `undefined`（不抛错——读取是探测性操作）；`config.update(name, ...)` 对不存在的插件则抛 `PLUGIN_NOT_INSTALLED`（写入是明确的意图表达，语义不对称）。以上两个方法都要求 Host 处于 `active` 状态，否则抛 `HOST_DISPOSING`/`HOST_DISPOSED`。

**构造函数只接受同步安装的插件**：`new Host({ plugins: ... })` 这种写法不存在——构造期插件走的是子类内部调用受保护的 `useSync(plugins)`，其中任何一个插件的 `install()` 返回 Promise 都会立即抛错；需要异步安装的插件要在宿主构造完成后用 `await host.use(plugin)`。

---

<a id="插件对象与插件-core-api"></a>

## 插件对象与插件 core API

```ts
import type { IPlugin, IPluginConfig, IPluginDisposer, IPluginResource } from '@migaia/plugin-host'
```

**插件对象**（`IPlugin<TCore, TExt, TConfig>`）主要字段：

- `name: string`（必填）—— Host 内唯一标识，**不能包含 `.`**（会和 `config.get('plugin.key')` 的路径解析产生歧义，安装入口直接拒绝）。
- `config?: TConfig`（可选）—— 初始配置，Host 以深拷贝的所有权快照保存。
- `install(core)`（必填）—— 拿到"领域 core + 通用 core 能力"，返回 `TExt | Promise<TExt>`（plain 对象，构造期同步插件不允许返回 Promise）。
- `features?: Record<string, IFeature>`（可选）—— 声明实例能力；消费者通过 provider 定义的 `getFeature()` 引用建立依赖。
- `update?: (next, core) => void | Promise<void>`（可选）—— 响应 `config.update`；`next` 是候选完整配置的只读视图，成功返回才提交。
- `dispose?: () => void | Promise<void>`（可选）—— 插件级清理。
- `[Symbol.dispose]?: () => void` / `[Symbol.asyncDispose]?: () => void | Promise<void>`（可选）—— 未声明 `dispose` 时的清理兜底，也接受本包导出的 `disposeKey`/`asyncDisposeKey`。

`install()` 返回值只有**可枚举的 data property** 会被挂载到 host；非枚举 key 会被有意忽略并经 `diagnostic` 上报（`EXTENSION_NON_ENUMERABLE_IGNORED`）；getter/setter 形式的属性直接抛 `TypeError`。**保留键不能作为 extension key**：`then`（否则 `await host.use(plugin)` 会把返回值误当成 thenable 解包）、本包的 `disposeKey`/`asyncDisposeKey`（及宿主原生 `Symbol.dispose`/`Symbol.asyncDispose`，若存在），命中会抛 `EXTENSION_RESERVED`；与 Host 上已有属性冲突抛 `EXTENSION_DUPLICATE`；与 `Object.prototype` 成员（如 `toString`）冲突抛 `EXTENSION_OBJECT_PROTOTYPE`。`catch`、`finally` 可以正常使用。

**插件 core**（安装时 `install(core)`/`update(next, core)` 拿到的对象）在子类领域方法之上叠加：

| API                                     | 参数                                                                 | 返回                 | 说明                                                               |
| --------------------------------------- | -------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------ |
| `core.config.get<T>()`                  | 无运行时参数                                                         | `IReadonlyConfig<T>` | 当前插件已提交配置的只读懒代理；嵌套对象/数组按访问路径缓存代理。  |
| `core.onDispose(resource)`              | `IPluginResource`（函数 / `Symbol.dispose` / `Symbol.asyncDispose`） | `void`               | **仅 `install()` 期间可调用**；否则抛 `RESOURCE_OUTSIDE_INSTALL`。 |
| `core.usePipeline(stage)`               | `(value, next) => void`                                              | `core`               | 仅 install 期间注册；sync stage 可提升到任意 Host mode。           |
| `core.useAsyncPipeline(stage)`          | `(value, next) => void \| Promise<void>`                             | `core`               | 仅 install 期间、且 Host mode 为 `async` 时可用。                  |
| `core.useGeneratorPipeline(stage)`      | `(value) => Generator`                                               | `core`               | 仅 install 期间，可用于 `generator` 与 `async-generator` mode。    |
| `core.useAsyncGeneratorPipeline(stage)` | `(value) => AsyncGenerator`                                          | `core`               | 仅 install 期间、且 Host mode 为 `async-generator` 时可用。        |

领域 core（`createPluginDomainCore()` 的返回值）不能定义与上表同名的字段（`config`/`onDispose`/`usePipeline`/`useAsyncPipeline`/`useGeneratorPipeline`/`useAsyncGeneratorPipeline` 是保留键），且必须是普通对象、字段都是可枚举 data property，否则构造时抛 `TypeError`。

`useSync`（构造函数期）安装的插件允许注册 async disposer；Host 同步撤销可见状态并发布冻结的 `PLUGIN_INSTALL_FAILED.detail` 快照，随后通过 `detail.completion` 提供包含完整 rollback identities 的冻结结果。需要完整 secondary identity 的错误转换必须 await completion。**不要把 `use`/`unUse`/`config.update`/`dispose` 暴露给插件 core，插件生命周期钩子内也不能调用当前 Host 的这几个方法**——会同步抛 `LIFECYCLE_MUTATION`。

---

<a id="pipeline-处理管线"></a>

## Pipeline 处理管线

构造时选择一种模式，运行期不能切换：

```ts
const host = new Host({ pipeline: { mode: 'sync' } })
host.usePipeline((value, next) => next(value.trim()))
```

**`async-generator`｜10 秒上手**：

```ts
import { GENERATOR_CONTINUE } from '@migaia/plugin-host'

const host = new Host({ pipeline: { mode: 'async-generator' } })
host.useAsyncGeneratorPipeline(async function* (value) {
  await Promise.resolve() // 可以在 yield 之间做任意异步工作
  yield value.trim()
  yield value.trim().toUpperCase()
  return GENERATOR_CONTINUE // 下一 stage 收到最后一次 yield 的大写字符串
})
host.useAsyncGeneratorPipeline(async function* (value) {
  return `[${value}]` // 收到上一个 stage 的最后一次 yield，继续产生最终结果
})
```

`GENERATOR_CONTINUE` 是框架导出的唯一 `Symbol` 控制信号，不是需要下游处理的业务数据。generator 函数的 `return` 只能提供一个终值，而一个 stage 可能先后 `yield` 多个候选值；返回这个信号是在明确告诉 runner：“忽略这个 Symbol 本身，把本 stage **最后一次 `yield`** 的值交给下一 stage。”上例输入 `" migaia "` 时，第二个 stage 收到 `MIGAIA`，最终结果是 `[MIGAIA]`。如果该 stage 一次也没有 `yield`，`GENERATOR_CONTINUE` 会原样转发进入该 stage 时的输入。

它与另外三种返回方式不同：`return transformedValue` 直接把该值交给下一 stage；`return GENERATOR_HALT` 或普通的 `return`（即 `undefined`）终止整条 pipeline；只有业务类型本身允许 `undefined` 时，才用 `return GENERATOR_UNDEFINED` 把真正的 `undefined` 作为数据继续向下传。

| 模式              | stage 形式                    | `next` 规则                                                                                                                                                                                                |
| ----------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sync`            | `(value, next) => void`       | 必须在 stage 返回前调用；延后调用被忽略并触发 `PIPELINE_NEXT_LATE` 诊断。                                                                                                                                  |
| `async`           | `async (value, next) => void` | `await next(value)`；同一次调用重复 `next()` 抛 `PIPELINE_NEXT_DUPLICATE`。                                                                                                                                |
| `generator`       | `function* (value)`           | `return value` 继续；`return undefined` 终止；`GENERATOR_CONTINUE` 用最后一次 yield 的值；`GENERATOR_HALT` 终止整条链；`GENERATOR_UNDEFINED` 显式表达 `undefined`（仅 `TValue` 允许 `undefined` 时可用）。 |
| `async-generator` | `async function* (value)`     | terminal 语义与 `generator` 完全一致；区别是串行 `await` 耗尽每个 stage（中间 yield 不提前进入下一 stage），对应 `host.useAsyncGeneratorPipeline(stage)`。                                                 |

**sync 是扁平转换管道**：`next()` 只记录下一个值，下游 stage 在当前 stage 返回**之后**才执行。**async 是洋葱模型**：`await next(value)` 会等下游链跑完才继续，因此当前 stage 能在 `next()` 之后写"后置逻辑"。四种模式执行期间均拒绝注册新 stage（`PIPELINE_EXECUTING`），且嵌套调用用深度计数、外层未结束前依然拒绝。async pipeline 的 stage 与 downstream 同时失败会聚合成 `AggregateError`（`PIPELINE_FAILED`）——这是 async 洋葱模型特有的失败模式，async-generator 是串行 drain-then-terminal，没有等价的双失败场景。

Host 侧注册 stage 后，应由子类在自己的领域入口里调用受保护的 `runPipeline(value, done)` 触发一次遍历。四种模式的 stage 都会收到 `context.signal`，它就是 host 的生命周期 signal：`dispose()` 开始时被中止，长时间运行的 stage 可以据此提前退出。若 host 在遍历进行到一半时被 `dispose()`，遍历会在下一个协作检查点中止，抛出（sync/generator）或 reject（async/async-generator）`PluginHostError('HOST_DISPOSING' | 'HOST_DISPOSED', ...)`。已知限制：中止与 stage 或下游的普通失败同时发生时，中止错误优先，普通失败目前不会挂在中止错误上（由 middleware-pipeline 的修订版处理）。

---

<a id="错误诊断与状态常量"></a>

## 错误、诊断与状态常量

```ts
import {
  PluginHostError,
  ERROR_TEXT,
  type ILocaleKey,
  PluginHostErrorCode,
  type IPluginHostErrorCode,
  PluginHostStatus,
  PluginHostRegistrationLifecycle,
  MiddlewarePipelineMode,
  MiddlewarePipelineViolation
} from '@migaia/plugin-host'
```

- **`PluginHostError`**：本包语义化错误的基类，`extends Error`，携带只读 `source`（恒为 `'@migaia/plugin-host'`）、`code: IPluginHostErrorCode`、可选 `detail`（结构化诊断字段，如队列超时的 `owner`/`waitedMs`）。除此之外，插件名/配置路径/pipeline stage/extension/domain core/资源 disposer 等**入参校验失败一律用原生 `TypeError`**（挂 `code: 'INVALID_OPTION'`）表达，不是 `PluginHostError`——判断输入错误用 `error instanceof TypeError`，判断协议/状态错误用 `error instanceof PluginHostError` 或按 `error.code` 分支。
- **`PluginHostErrorCode`**：稳定错误码常量对象，取值见 [USEGUIDE §9](./USEGUIDE.md#9-错误码完整参考)。
- 句柄与依赖图新增的稳定码包括：`PLUGIN_DISABLED`、`PLUGIN_SUSPENDED`、`PLUGIN_NOT_ACTIVATED`、`FEATURE_NOT_DECLARED`、`PREREQUISITE_MISSING`、`DEPENDENCY_CYCLE`、`DEPENDENCY_BLOCKED`、`REPLACE_NAME_MISMATCH`、`DEPENDENT_RESTART_FAILED`、`PLUGIN_DEFINITION_INVALID`、`REGISTRATION_REVOKED`。其余生命周期、pipeline、配置与组合错误码及完整处理建议见 [USEGUIDE §9](./USEGUIDE.md#9-错误码完整参考)。

完整稳定码集合：`HOST_DISPOSED`、`HOST_DISPOSING`、`PLUGIN_DUPLICATE`、`PLUGIN_NOT_INSTALLED`、`PLUGIN_DISABLED`、`PLUGIN_SUSPENDED`、`PLUGIN_NOT_ACTIVATED`、`FEATURE_NOT_DECLARED`、`PREREQUISITE_MISSING`、`DEPENDENCY_CYCLE`、`DEPENDENCY_BLOCKED`、`REPLACE_NAME_MISMATCH`、`DEPENDENT_RESTART_FAILED`、`PLUGIN_DEFINITION_INVALID`、`PLUGIN_INSTALL_FAILED`、`PLUGIN_DISPOSE_FAILED`、`EXTENSION_DUPLICATE`、`EXTENSION_OBJECT_PROTOTYPE`、`EXTENSION_RESERVED`、`PREREQUISITE_DISABLED`、`PREREQUISITE_REMOVED`、`RESOURCE_OUTSIDE_INSTALL`、`LIFECYCLE_MUTATION`、`INVALID_PIPELINE_MODE`、`PIPELINE_MODE_MISMATCH`、`PIPELINE_NEXT_DUPLICATE`、`PIPELINE_NEXT_LATE`、`PIPELINE_EXECUTING`、`PIPELINE_FAILED`、`PLUGIN_INSTALL_ROLLBACK_FAILED`、`EXTENSION_NON_ENUMERABLE_IGNORED`、`MUTATION_QUEUE_TIMEOUT`、`DISPOSE_STEP_TIMEOUT`、`INVALID_OPTION`、`INVALID_CONFIG_VALUE`、`CONFIG_CYCLE_REJECTED`、`MUTATION_EXECUTION_TIMEOUT`、`REGISTRATION_REVOKED`、`INSTALL_RESULT_THENABLE`、`PIPELINE_DRAIN_TIMEOUT`、`CLEANUP_INCOMPLETE`、`COMPOSITION_TARGET_UNMANAGED`。
- **`ERROR_TEXT`**（默认导出）：本包内置的中/英双语错误文案表，主要供内部构造错误消息使用；对外暴露是为了让下游包在自定义 `diagnostic` 回调里复用同一套措辞，一般无需直接调用。
- **`PluginHost.setLocale(locale: ILocaleKey)`**：静态方法，`ILocaleKey = 'en' | 'zh'`，切换 `ERROR_TEXT` 与后续抛出错误的默认语言，默认 `'zh'`，全局生效（不是每个 Host 实例独立）。
- **`PluginHostStatus`**：`{ active, closing, disposed }`——Host 的三态生命周期，`closing` 是 `dispose()` 已开始、尚未收敛的窗口。
- **`MiddlewarePipelineMode`**：从 `@migaia/middleware-pipeline` 原名转发的模式常量；`host.pipelineMode` 返回其中之一。
- **`PluginHostRegistrationLifecycle`**：`{ idle, install, dispose }`——单个插件注册记录当前所处的阶段，决定 `onDispose()`/pipeline 注册是否合法（只在 `install` 阶段允许）。一般只在自定义诊断/调试时需要引用。
- **`MiddlewarePipelineViolation`**：从 `@migaia/middleware-pipeline` 原名转发的 `next()` 违规分类。

---

<a id="底层适配器与信号量"></a>

## Pipeline 类型与信号量

```ts
import {
  MiddlewarePipelineMode,
  MiddlewarePipelineViolation,
  type IMiddlewarePipelineMode,
  type ISyncMiddlewareStage,
  type IAsyncMiddlewareStage,
  type IGeneratorMiddlewareStage,
  type IAsyncGeneratorMiddlewareStage,
  GENERATOR_CONTINUE,
  GENERATOR_HALT,
  GENERATOR_UNDEFINED,
  disposeKey,
  asyncDisposeKey
} from '@migaia/plugin-host'
```

mode、violation 与四种 stage 类型均从 `@migaia/middleware-pipeline` **原名转发**，没有 plugin-host 自己的重复声明。Host 在 stage 注册时使用其唯一的 `createPipeline` runner 提升到宿主 mode；需要手工提升或执行时直接使用 middleware-pipeline 的 `createPipeline`。
- **`GENERATOR_CONTINUE`/`GENERATOR_HALT`/`GENERATOR_UNDEFINED`** —— generator pipeline 专用的哨兵值（`unique symbol`，直接从 `@migaia/middleware-pipeline` 转发，保持跨包同一身份）：generator stage 的 `return` 可以返回它们中的一个来表达"继续/终止/显式 undefined"，语义见上方 [Pipeline 处理管线](#pipeline-处理管线) 表格。
- **`disposeKey`/`asyncDisposeKey`** —— 本包自声明的 `unique symbol`（不依赖 `ESNext.Disposable` lib），语义等价于宿主原生 `Symbol.dispose`/`Symbol.asyncDispose`。插件/资源可以用这两个 key 之一声明清理方法，运行时会把自声明 symbol 与宿主真实 symbol（若存在）都识别为等价键。

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. 带配置、Feature 依赖、失败回滚的完整插件组合

```ts
import { defineFeature, definePlugin, PluginHost } from '@migaia/plugin-host'

type ICore = { write(text: string): void }
type IFormatterConfig = { prefix?: string }
const format = defineFeature(
  (core: { featureExpose: { format(value: string): string } }) => core.featureExpose.format
)
const formatter = definePlugin(
  'formatter',
  (core: ICore & { config: { get(): IFormatterConfig } }) => ({
    install: () => ({}),
    featureExpose: () => ({ format: (value: string) => `${core.config.get().prefix} ${value}` })
  }),
  { format }
)
const writer = definePlugin(
  'writer',
  (core: ICore & { features: { format: (value: string) => string } }) => ({
    install: () => ({ log: (msg: string) => core.write(core.features.format(msg)) })
  }),
  { format: formatter.getFeature('format') }
)

class Host extends PluginHost<ICore, never> {
  protected createPluginDomainCore(): ICore {
    return { write: (text) => console.log(text) }
  }
}

const [, writerHandle] = await new Host().use(formatter, writer)
writerHandle.extensions.log('server started') // "[app] server started"

await host.config.update('formatter', () => ({ prefix: '[api]' }))
host.log('request handled') // "[api] request handled"

await host.dispose()
```

### 2. async pipeline 做请求耗时统计（洋葱模型的"前置 + 后置"）

```ts
import { PluginHost } from '@migaia/plugin-host'

type IRequest = { path: string; startedAt?: number }

class Host extends PluginHost<{}, IRequest> {
  protected createPluginDomainCore() {
    return {}
  }
  handle(request: IRequest): Promise<void> {
    return this.runPipeline(request, (final) => console.log('handled', final.path)) as Promise<void>
  }
}

const host = new Host({ pipeline: { mode: 'async' } })
host.useAsyncPipeline(async (value, next) => {
  const startedAt = Date.now()
  await next({ ...value, startedAt }) // 前置：给下游打时间戳
  console.log(`${value.path} took ${Date.now() - startedAt}ms`) // 后置：下游跑完才执行
})

await host.handle({ path: '/users' })
```

### 3. 用 `diagnostic` + 自定义队列/清理超时观测宿主内部行为

```ts
import { PluginHost, type IPluginHostErrorCode } from '@migaia/plugin-host'

class Host extends PluginHost<{}, never> {
  protected createPluginDomainCore() {
    return {}
  }
}

const events: { message: string; code?: IPluginHostErrorCode }[] = []
const host = new Host({
  diagnostic: (message, code) => events.push({ message, code }),
  queueAdmissionTimeoutMs: 2000, // 显式开启拒绝阈值——默认是"只诊断不拒绝"
  queueAdmissionDiagnosticMs: 200, // 排队超过 200ms 先打一条诊断
  disposeStepTimeoutMs: 3000 // 单个 disposer 最多等 3 秒
})

await host.use({
  name: 'slow',
  install: (core) => {
    core.onDispose(async () => new Promise((resolve) => setTimeout(resolve, 10)))
    return {}
  }
})
await host.dispose()
// events 里可能包含排队等待、非枚举扩展被忽略等诊断，取决于实际时序
```

### 4. 优雅降级：安装失败时读出真实原因与回滚详情

```ts
import { PluginHost, PluginHostError, type IPlugin } from '@migaia/plugin-host'

class Host extends PluginHost<{}, never> {
  protected createPluginDomainCore() {
    return {}
  }
}

const broken: IPlugin<{}, {}> = {
  name: 'broken',
  install: () => {
    throw new Error('boom')
  }
}

try {
  await new Host().use(broken)
} catch (error) {
  if (error instanceof PluginHostError && error.code === 'PLUGIN_INSTALL_FAILED') {
    console.error('安装失败，原始错误:', (error.cause as Error).message) // 'boom'
  }
}
```

### 5. generator pipeline：用 `GENERATOR_HALT` 提前截断处理链

```ts
import { PluginHost, GENERATOR_HALT } from '@migaia/plugin-host'

type IEvent = { level: 'info' | 'debug'; message: string }

class Host extends PluginHost<{}, IEvent> {
  protected createPluginDomainCore() {
    return {}
  }
  emit(event: IEvent): void {
    this.runPipeline(event, (final) => console.log(final.level, final.message))
  }
}

const host = new Host({ pipeline: { mode: 'generator' } })
host.useGeneratorPipeline(function* (value) {
  if (value.level === 'debug') return GENERATOR_HALT // 直接丢弃 debug 事件，后续 stage 不再执行
  return value
})

host.emit({ level: 'info', message: 'ready' }) // 打印
host.emit({ level: 'debug', message: 'noisy' }) // 被截断，不打印
```

### 6. Async-generator：串行异步处理 + host 中途 dispose 自动止损

```ts
import { PluginHost, GENERATOR_CONTINUE } from '@migaia/plugin-host'

class FetchHost extends PluginHost<{}, string> {
  protected createPluginDomainCore() {
    return {}
  }
  run(url: string): Promise<string> {
    let result = url
    return Promise.resolve(
      this.runPipeline(url, (final) => {
        result = final
      })
    ).then(() => result)
  }
}

const host = new FetchHost({ pipeline: { mode: 'async-generator' } })
host.useAsyncGeneratorPipeline(async function* (url) {
  yield url // 中间 yield 仅用于观测，不会提前进入下一 stage
  const response = await fetch(url)
  return await response.text()
})

const text = await host.run('https://example.com/data')
```

若 `fetch` 还没返回、`host.dispose()` 就被调用，`run()` 返回的 Promise 会在下一个协作检查点自动以 `PluginHostError('HOST_DISPOSING' | 'HOST_DISPOSED', ...)` reject——不需要手动接一根 `AbortController` 去连 host 的生命周期。

### 7. Async-generator 多 stage 链式处理，复用已有的同步 generator stage

```ts
import {
  PluginHost,
  GENERATOR_CONTINUE,
  type IGeneratorMiddlewareStage
} from '@migaia/plugin-host'

// 已有的一个同步 generator stage（比如从 generator 模式的 Host 上迁移过来的）
const trimStage: IGeneratorMiddlewareStage<string> = function* (value) {
  yield value.trim()
  return GENERATOR_CONTINUE
}

class TextHost extends PluginHost<{}, string> {
  protected createPluginDomainCore() {
    return {}
  }
  run(value: string): Promise<string> {
    let result = value
    return Promise.resolve(
      this.runPipeline(value, (final) => {
        result = final
      })
    ).then(() => result)
  }
}

const host = new TextHost({ pipeline: { mode: 'async-generator' } })

// 不用重写或手工适配：Host runner 直接提升 generator stage
host.useGeneratorPipeline(trimStage)

// 第二个 stage 真正做异步工作
host.useAsyncGeneratorPipeline(async function* (value) {
  await new Promise((resolve) => setTimeout(resolve, 0))
  yield value.toUpperCase()
  return GENERATOR_CONTINUE
})

await host.run('  migaia  ') // 'MIGAIA'
```

async-generator Host 的 runner 会把"以前给 generator 模式写的 stage"原样提升，不需要公开适配器，也不需要重写成 `async function*`；两个 stage 都用 `GENERATOR_CONTINUE` 采用各自最后一次 `yield` 的值，链式往下传。

---

<a id="支持环境"></a>

## 支持环境

- Chrome 85+ / Edge 85+ / Firefox 79+ / Opera 71+ / Safari 14+
- Node、Bun、Deno、Worker、小程序、Electron 主/渲染进程
- 产物基线 ES2020，需要 `Promise`、`Map`、`Symbol`、`AggregateError`；`Symbol.dispose`/`Symbol.asyncDispose` 仅作为可用时的清理兜底，不强制要求 polyfill

---

<a id="构建门禁"></a>

## 构建门禁

```bash
pnpm --filter @migaia/plugin-host fmt
pnpm --filter @migaia/plugin-host lint
pnpm --filter @migaia/plugin-host typecheck
pnpm --filter @migaia/plugin-host typecheck:test
pnpm --filter @migaia/plugin-host test
```

`test` 会先执行本包的 `build`（`vite build && tsc --emitDeclarationOnly`）再跑 `vitest run`。完整的 API 参考、精确执行顺序、每个错误码的触发条件与更多组合示例，见 **[USEGUIDE.md](./USEGUIDE.md)**。
