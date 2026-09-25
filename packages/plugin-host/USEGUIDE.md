# 使用手册

本文是 `@migaia/plugin-host` 的应用与框架适配器参考手册。先看 [README.md](./README.md#核心心智模型五分钟上手) 的五分钟上手示例，跑起来之后再回来查这里的细节——README 讲“是什么、为什么用、5 分钟怎么跑起来”，本文覆盖公开运行时 API、关键配置类型、边界行为和错误码；只参与插件合并/提取的 type-only helper 以发布的 `.d.ts` 为准。

## 目录

1. [适用范围与设计定位](#1-适用范围与设计定位)
2. [Host 公开 API 参考](#2-host-公开-api-参考)
3. [插件对象 API 参考](#3-插件对象-api-参考)
4. [插件 core API 参考](#4-插件-core-api-参考)
5. [配置系统](#5-配置系统)
6. [shared 共享能力](#6-shared-共享能力)
7. [Pipeline 处理管线](#7-pipeline-处理管线)
8. [生命周期与错误](#8-生命周期与错误)
9. [错误码完整参考](#9-错误码完整参考)
10. [资源清理协议](#10-资源清理协议)
11. [底层适配器与信号量](#11-底层适配器与信号量)
12. [完整示例](#12-完整示例)
13. [构建、测试与常见问题排查](#13-构建测试与常见问题排查)

---

## 1. 适用范围与设计定位

`PluginHost<TDomainCore, TValue, TInstalled>` 是一个抽象基类，本身不知道任何业务领域概念——它不实现日志、网络、状态管理，也不替你决定插件应该长什么样。它只负责"插件系统"这一层通用机制：安装顺序、生命周期、配置、资源清理、共享能力、处理管线。

管线执行算法已经抽到 [`@migaia/middleware-pipeline`](../middleware-pipeline/README.md)；本包只负责把插件注册的 stage 接入执行器，并叠加 plugin-host 自己的 violation、active 状态与错误策略。不要从 plugin-host 的内部 wrapper（`src/pipeline.ts`）复制 runner 实现，也不要依赖 `src`/`dist` 内部文件——包只公开根入口 `@migaia/plugin-host`，没有稳定的深层子路径。

```ts
type ICore = { publish(value: string): void }

class Host extends PluginHost<ICore, string> {
  protected createPluginDomainCore(): ICore {
    return { publish: (value) => console.log(value) }
  }
}
```

三个类型参数：`TDomainCore` 是子类提供给插件的领域能力形状；`TValue` 是 pipeline 处理的值类型（不需要 pipeline 时传 `never`，默认值即 `never`）；`TInstalled`（默认 `readonly []`）是内部用于随 `use()` 累加已安装插件类型的元组，一般不需要手写。子类唯一必须实现的是受保护方法 `createPluginDomainCore(): TDomainCore`，每次插件安装都会调用它一次，产出一份**独立的**领域 core 实例（不在插件之间共享同一个对象引用）。领域 core 的返回值必须是普通对象（原型为 `Object.prototype` 或 `null`），且字段都是可枚举 data property，否则在安装时抛出携带 `code: 'INVALID_OPTION'` 的 `TypeError`；同时不能定义与 core 保留键同名的字段（见 [§4](#4-插件-core-api-参考)）。

---

## 2. Host 公开 API 参考

```ts
import { PluginHost, type IPluginHostOptions } from '@migaia/plugin-host'
```

### 构造函数

**`new Host(options?: IPluginHostOptions)`**

`IPluginHostOptions` 全部字段：

| 字段                          | 类型                                                               | 默认值                 | 说明                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pipeline?`                   | `{ mode?: 'sync' \| 'async' \| 'generator' \| 'async-generator' }` | `{ mode: 'sync' }`     | Pipeline 模式；构造后不能切换。`mode` 不在合法取值集合内会抛 `INVALID_PIPELINE_MODE`。                                                                           |
| `onDiagnosticFailure?`        | `(error: unknown) => void` | 交给 `globalThis.reportError`（若存在） | `diagnostic` 自身抛错/reject 时收到原失败对象；Node 无 `reportError`，需要观测时显式提供。不是函数抛 `TypeError`（`INVALID_OPTION`）。 |
| `diagnostic?`                 | `(message: string, code?: IPluginHostErrorCode, error?: unknown) => void` | 空操作（no-op）        | 接收"不构成错误但值得关注"的信号，见 [§9](#9-错误码完整参考)。不是函数会抛 `TypeError`（`INVALID_OPTION`）；诊断回调自身抛出的异常永远不会影响宿主正常执行流程。 |
| `scheduler?`                  | `ILifecycleScheduler`（来自 `@migaia/lifecycle`）                  | 内部 `systemScheduler` | 队列排队计时、disposal 计时共用的时间源。传入对象必须提供 `now()`/`schedule()`，否则抛 `TypeError`（`INVALID_OPTION`）。                                         |
| `queueAdmissionTimeoutMs?`    | `number \| false`                                                  | `undefined`            | mutation 在 FIFO 队列中排队被拒绝的阈值。见下方说明。                                                                                                            |
| `queueAdmissionDiagnosticMs?` | `number \| false`                                                  | `1000`                 | 未配置 `queueAdmissionTimeoutMs`（拒绝阈值）时使用的诊断阈值。见下方说明。                                                                                       |
| `disposeStepTimeoutMs?`       | `number \| false`                                                  | `5000`                 | 单个 disposer 步骤的最长等待时间。见下方说明。                                                                                                                   |

**排队/超时三个可配置字段的精确语义**（源码见 `src/host-runtime.ts`）：

- `queueAdmissionTimeoutMs`——**默认 `undefined`：只诊断、不拒绝**，即默认情况下 mutation 排队再久也不会触发 `MUTATION_QUEUE_TIMEOUT`。传 `false` 会连计时器都不建，彻底关闭队列等待相关的一切计时与诊断。传具体数值（必须有限非负）后，一个 mutation 排在正在执行的工作后面，等待超过该阈值仍未开始执行，会被移出队列并以 `MUTATION_QUEUE_TIMEOUT` reject——这是正式的公开行为，测试可精确断言在配置的时刻触发（见 `test/adversarial.test.ts` "rejects exactly at the configured time"）。已经开始执行的插件代码不会被强制中断（JS 无法安全撤销正在运行的代码），超时只影响排在它后面、尚未开始的任务；超时后前序工作仍会正常完成，Host 也仍可接受新的 mutation。`dispose()` 作为终态操作会以 `queueAdmissionTimeoutMs: false` 单独入队，永远不受这个阈值驱逐。
- `queueAdmissionDiagnosticMs`——只在**未配置** `queueAdmissionTimeoutMs`（即处于"只诊断"模式）时生效，默认 `1000`：mutation 排队超过这个毫秒数会通过 `diagnostic` 回调上报一条 `[plugin-host] mutation waited in the queue for ${waitedMs}ms...` 消息（**不带错误码**，因为它不是拒绝事件）。传 `false` 关闭这个诊断计时器。若已经配置了拒绝阈值 `queueAdmissionTimeoutMs`，这个诊断阈值不再单独生效（等待超过拒绝阈值直接以错误终止,不会先走诊断）。
- `disposeStepTimeoutMs`——单个 disposer 步骤（pipeline disposer / 插件 `dispose()` 钩子 / `onDispose()` 登记的资源 disposer）的最长等待时间，默认 `5000`。传 `false` 表示永久等待，不触发 `DISPOSE_STEP_TIMEOUT`（`test/adversarial.test.ts` "disposeStepTimeoutMs: false waits forever instead of forcing"）。这个超时**降级继续**而不是终止：超时的那一步被记为失败（`DISPOSE_STEP_TIMEOUT`），但不会强行打断仍在运行的 Promise 链，disposal 事务仍会继续处理剩余步骤直至收敛到 `disposed`。它专门覆盖"某个 disposer 反过来 `await` 了触发它的那次 `host.dispose()` 调用"这种自依赖循环等待，让这种死锁转成一次可捕获、可继续的失败而不是永久卡在 `closing`。

超时类选项（三者）传入非 `false` 的非有限非负数（负数、`NaN`、`Infinity`、非 `number`）一律抛 `TypeError`（`code: 'INVALID_OPTION'`）。

```ts
const host = new Host({
  diagnostic: (message, code) => console.debug(message, code),
  queueAdmissionTimeoutMs: 2000, // 显式开启拒绝阈值——默认是"只诊断不拒绝"
  disposeStepTimeoutMs: 3000 // 单个 disposer 最多等 3 秒，超过记为失败但不阻断其余清理
})
```

**构造函数只接受同步安装的插件**：`new Host({ plugins: ... })` 这种写法不存在——`IPluginHostOptions` 没有 `plugins` 字段。构造期插件走的是子类内部调用受保护的 `useSync(plugins)`，其中任何一个插件的 `install()` 返回 Promise（或 thenable）都会立即抛 `TypeError`；需要异步安装的插件要在宿主构造完成后用 `await host.use(plugin)`。

### 实例 API

| API                                     | 参数                                                               | 返回                                                    | 作用                                                                              |
| --------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `host.use(...plugins)`                  | 至少 1 个 `IPlugin`，按顺序安装                                    | `Promise<Host & Extensions>`                            | 运行期安装插件；批次内任一失败按逆序回滚整批，见 [§8](#8-生命周期与错误)。        |
| `host.unUse(name)`                      | `name: string`                                                     | `Promise<IPluginRemoval>`                               | 依赖安全地卸载插件及其 extension/stage/资源。                                     |
| `host.dispose()`                        | 无                                                                 | `Promise<void>`                                         | 卸载全部插件并永久关闭宿主；重复调用复用同一 Promise。                            |
| `host.config.get(path)`                 | `path: string`——插件名，或 `插件名.键` / `插件名.[下标].键`        | `unknown \| undefined`                                  | 同步读取；对象/数组返回 Readonly 懒代理；未知插件或路径返回 `undefined`。         |
| `host.config.update(name, recipe)`      | `name: string`；`recipe(previous) => Partial<patch>`（须同步返回） | `Promise<void>`                                         | Copy-on-Write 合并 patch，跑 `plugin.update(next, core)` 成功才提交。             |
| `host.pipelineMode`                     | 无（只读属性）                                                     | `'sync' \| 'async' \| 'generator' \| 'async-generator'` | 构造时固定的 pipeline 模式。                                                      |
| `host.usePipeline(stage)`               | `stage: (value, next) => void`                                     | `this`                                                  | sync stage 可提升到任意 Host mode。                                                |
| `host.useAsyncPipeline(stage)`          | `stage: (value, next) => void \| Promise<void>`                    | `this`                                                  | 仅 async mode 可用；`next()` 返回 Promise。                                       |
| `host.useGeneratorPipeline(stage)`      | `stage: (value) => Generator<...>`                                 | `this`                                                  | 可用于 generator 与 async-generator mode，后者由 runner 提升。                   |
| `host.useAsyncGeneratorPipeline(stage)` | `stage: (value) => AsyncGenerator<...>`                            | `this`                                                  | 仅 async-generator mode 可用。                                                    |
| `PluginHost.setLocale(locale)`          | `locale: 'en' \| 'zh'`（静态方法）                                 | `void`                                                  | 切换内置错误文案语言，默认 `'zh'`，影响全局、全部 Host 实例（非按实例隔离）。     |

无法提升的组合会同步抛顶层 `PluginHostError`，`code === 'PIPELINE_MODE_MISMATCH'`；其 `cause` 是 middleware-pipeline 原始 `TypeError`，携带 `code === 'INVALID_OPTION'` 与 `source === '@migaia/middleware-pipeline'`。

`host.config.get(path)` 与 `host.config.update()` 都要求 Host 处于 `active` 状态，否则前者同步抛 `HOST_DISPOSING`/`HOST_DISPOSED`，后者在其内部队列任务中以同样的错误 reject。两者的"找不到插件"语义不对称：`get(path)` 对不存在的插件或缺失路径返回 `undefined`（读取是探测性操作）；`update(name, ...)` 对不存在的插件抛出 `PLUGIN_NOT_INSTALLED`（写入是明确的意图表达）。`host.config` facade 本身在重复访问时保持同一引用（懒加载单例）。

跨插件能力由 Feature 引用表达；Host 依据引用拓扑排序安装，并在 provider 缺失、禁用或移除时给出对应的前置条件错误。

错误边界约定：`PluginHostError` 用于可由调用方按错误码处理的 host 状态/协议错误；入参形状校验（插件名/配置路径/pipeline stage/extension/domain core/资源 disposer 等不满足 JavaScript API 约束）一律用原生 `TypeError`（挂 `code: 'INVALID_OPTION'`）表达，不是 `PluginHostError`——判断输入错误用 `error instanceof TypeError`，判断协议/状态错误用 `error instanceof PluginHostError` 或按 `error.code` 分支。

---

## 3. 插件对象 API 参考

```ts
import type { IPlugin, IPluginConfig, IPluginDisposer, IPluginResource } from '@migaia/plugin-host'
```

```ts
type IPluginConfig = { prefix?: string }
type IPluginCore = { emit(value: string): void }

const prefix: IPlugin<IPluginCore, { greet(name: string): void }, IPluginConfig> = {
  name: 'prefix',
  config: { prefix: 'hello' },
  install(core) {
    const config = core.config.get()
    return { greet: (name) => core.emit(`${config.prefix} ${name}`) }
  },
  update(next) {},
  dispose() {}
}
```

`IPlugin<TCore, TExt, TConfig>` 全部字段：

| 字段 / 签名                                     | 输入                                                                        | 必填性 | 返回值                  | 同步/异步 | 作用                                                                                                                |
| ----------------------------------------------- | --------------------------------------------------------------------------- | ------ | ----------------------- | --------- | ------------------------------------------------------------------------------------------------------------------- |
| `name: string`                                  | 非空字符串，**不能包含 `.`**                                                | 必填   | 无                      | —         | 当前 Host 内的唯一插件标识；含 `.` 会在安装入口直接被拒绝（避免和 `config.get('plugin.key')` 的路径解析产生歧义）。 |
| `config?: TConfig`                              | `TConfig extends Record<string, unknown>`                                   | 可选   | 无                      | —         | 初始配置；Host 以深拷贝的所有权快照保存（见 [§5](#5-配置系统)）。                                                   |
| `install(core)`                                 | 领域 core 与 `config.get()`、Feature 输出、`onDispose()`、pipeline 注册方法 | 必填   | `TExt \| Promise<TExt>` | 视情况    | 初始化插件并返回 plain extension record；同步安装（`useSync`）不允许返回 Promise。                                  |
| `features`                                      | 命名 Feature 定义或 provider 的 Feature 引用                                | 可选   | Feature record          | 同步      | 声明本插件提供和消费的实例能力；依赖拓扑由 Host 统一解析。                                                          |
| `update?(next, core)`                           | `next: IReadonlyConfig<TConfig>`，候选完整配置                              | 可选   | `void \| Promise<void>` | 视情况    | 响应 `config.update`；成功返回才提交 `next`，且 `next` 只能读取。                                                   |
| `dispose?()`                                    | 无                                                                          | 可选   | `void \| Promise<void>` | 视情况    | 插件级清理。                                                                                                        |
| `[disposeKey]?` / `[Symbol.dispose]?`           | 无                                                                          | 可选   | `void`                  | 同步      | 未声明 `dispose` 时的同步清理兜底；也接受宿主原生 `Symbol.dispose`（若存在）。                                      |
| `[asyncDisposeKey]?` / `[Symbol.asyncDispose]?` | 无                                                                          | 可选   | `void \| Promise<void>` | 视情况    | 未声明 `dispose` 时的清理兜底；同步安装（`useSync`）的插件不支持这个异步形式，见 [§4](#4-插件-core-api-参考)。      |

`install()` 返回的 extension 对象上，只有**可枚举的 data property** 会被挂载到 host——非枚举 key 会被有意忽略并经 `diagnostic` 回调上报（`EXTENSION_NON_ENUMERABLE_IGNORED`）；getter/setter 形式的属性、或非 `configurable` 的属性直接抛 `TypeError`（`INVALID_OPTION`）。extension 对象本身必须是普通对象（`null`/`Object.prototype` 原型），否则抛 `TypeError`。**保留键不能作为 extension key**：`then`（否则 `await host.use(plugin)` 会把返回值误当成 thenable 解包）、本包的 `disposeKey`/`asyncDisposeKey`（及宿主原生 `Symbol.dispose`/`Symbol.asyncDispose`，若存在），命中会抛 `EXTENSION_RESERVED`；与 Host 上已有属性冲突抛 `EXTENSION_DUPLICATE`；与 `Object.prototype` 成员（如 `toString`）冲突抛 `EXTENSION_OBJECT_PROTOTYPE`。`catch`、`finally` 可以正常使用（不在保留键集合内）。

---

## 4. 插件 core API 参考

推荐用 `definePlugin()` 创建插件定义，而不是手写类型断言：

```ts
import { definePlugin } from '@migaia/plugin-host'

const health = definePlugin('health', () => ({
  install: () => ({ check: () => ({ ok: true as const }) })
}))

const configurable = definePlugin({
  name: 'configurable',
  config: { prefix: '[app]' },
  install: (core) => ({ readPrefix: () => core.config.get().prefix }),
  dispose: () => undefined
})
```

第一种是函数形 `definePlugin(name, descriptorFactory)`：descriptor factory 为每次安装同步返回可选的 `install`、`expose`、`featureExpose` hooks；第二种对象形可提供 `config`、`features`、`featureExpose`、`update`、`dispose`。两者都只创建定义，不执行 descriptor 或生命周期代码；`install()` 要到 `host.use(plugin)` 时才运行。`defineHost()` 与 `PluginHost` 都只接收这类由 `definePlugin()` 创建的定义，借此在执行任何插件代码前完成可信准入和类型推导。

安装时获得的 `core` 是一个稳定的 facade（`src/core.ts` 的 `createPluginCore`）。它包含子类提供的领域方法，加上下面的通用能力：

| API / 签名                              | 参数                                                                 | 必填性          | 返回值               | 同步/异步 | 作用                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------- | --------------- | -------------------- | --------- | ------------------------------------------------------------------------------------ |
| `core.config.get<T>()`                  | 可选泛型 `T`，通常由插件 `config` 推导                               | 无运行时参数    | `IReadonlyConfig<T>` | 同步      | 当前插件已提交配置的只读懒代理；嵌套对象/数组按访问路径缓存代理，不允许修改。        |
| `core.onDispose(resource)`              | `IPluginResource`（函数 / `Symbol.dispose` / `Symbol.asyncDispose`） | `resource` 必填 | `void`               | 同步      | **仅 `install()` 期间可调用**；否则抛 `RESOURCE_OUTSIDE_INSTALL`；卸载时按逆序执行。 |
| `core.usePipeline(stage)`               | `stage: (value, next) => void`                                       | `stage` 必填    | `core`               | 同步      | 仅 install 期间注册；sync stage 可提升到任意 Host mode。                            |
| `core.useAsyncPipeline(stage)`          | `stage: (value, next) => void \| Promise<void>`                      | `stage` 必填    | `core`               | 同步      | 仅 install 期间、且 Host mode 为 `async` 时可用。                                    |
| `core.useGeneratorPipeline(stage)`      | `stage: (value) => Generator`                                        | `stage` 必填    | `core`               | 同步      | 仅 install 期间，可用于 `generator` 与 `async-generator` mode。                      |
| `core.useAsyncGeneratorPipeline(stage)` | `stage: (value) => AsyncGenerator`                                   | `stage` 必填    | `core`               | 同步      | 仅 install 期间、且 Host mode 为 `async-generator` 时可用。                          |

`core.config`/`core.onDispose`/`core.usePipeline`/`core.useAsyncPipeline`/`core.useGeneratorPipeline`/`core.useAsyncGeneratorPipeline` 是 core facade 的**保留键**：领域 core（`createPluginDomainCore()` 的返回值）若定义了同名字段，会在构造 core 时抛 `TypeError`（`INVALID_OPTION`）。

`onDispose` 接受函数、`{ [Symbol.dispose]() }` 或 `{ [Symbol.asyncDispose]() }`。同步安装（构造函数期通过 `useSync` 安装）的插件也可注册 async disposer：Host 会先同步撤销可见状态，再通过 `PLUGIN_INSTALL_FAILED.detail.completion` 提供包含完整 rollback identities 的冻结结果；需要完整 secondary identity 的错误转换必须 await completion。资源、shared、pipeline stage 和 extension 都由这次安装记录拥有；`unUse()` 时会按逆序撤销它们（见 [§10](#10-资源清理协议)）。

**不要把 `use`、`unUse`、`config.update` 或 `dispose` 暴露给插件 core。** 插件也不得在自己的 lifecycle hook（`install`/`update`/`dispose`）内部调用当前 Host 的这几个方法——这会同步抛出 `LIFECYCLE_MUTATION`，见 [§8](#8-生命周期与错误)。

TypeScript 的"已安装插件"类型（`TInstalled` 元组）只会随 `use()` 累加，不会因 `unUse()` 递减；卸载后的类型仍应视为静态能力记录，这是当前 API 的已知限制，不是 bug——运行时行为是正确的（方法确实被移除了），只是类型层面不会收窄。

### Composition owner 协议

`IPluginHostCompositionIntegration` 面向 Tray 这类唯一 owner，不是业务插件的第二套 Host API：

- **prepared admission**：插件 setup 已完成、但尚未对业务读取和 pipeline 发布的临时批次；作用类似“事务待提交区”。
- **registration receipt**：某一次成功安装的不可伪造凭证；卸载凭证指向的具体安装，不按插件名猜测目标。
- **data-order slot**：Host 私有的排序位置；Tray 只能保存并原样传回，不能查看内部序号或自行构造。
- **Host revision**：Host 的修改版本号；准备和提交之间版本变化时拒绝提交，避免把基于旧状态的插件批次发布出去。

1. `createPluginAdmission()` 快照插件；`createDataOrderSlot()` 分配 opaque definition lane。
2. `prepareAdmissions()` 可执行异步 setup，但 candidate extension/config/shared/stage 仍不可见。
3. `commitPreparedAdmissions()` 是同步、无用户代码的发布点；若 capsule 创建后的 Host revision 已变化，
   commit fail closed，随后 `discardPreparedAdmissions()` 执行 exactly-once rollback。
4. `prepareUnUseBatch()` 绑定 exact registration receipts；`commitPreparedUnUseBatch()` 先逻辑撤销，
   再等待 owner 提供的 `beforeCleanup` fence 和 exact pipeline generation lease。
5. `retireDataOrderSlot()` 只在 definition 真正删除或 session 终结时调用；replace 与 blocked restart 必须复用
   原 slot。

宿主直接注册的 stage 与插件槽位共用单调分配序号，按首次分配顺序执行；禁用、启用、挂起、恢复和替换不重排。`createDataOrderSlot(name)` 在调用时即保留位置，所以之后注册的宿主 stage 排在该插件 stage 后。替换在发布点切换可见代，新运行只含新代；旧运行继续持有旧代租约。

managed cleanup 的 `physicalCompletion` 是全批次共享的严格链：前一 provider/resource 未真实 settle 时，
后一项不会开始。`pipelineDrainTimeoutMs` 只决定何时向调用方返回逻辑 incomplete，不取消 lease 或 disposer。排空开始时先解除旧代的 stage 可见性，再封存租约 key；此后新运行不含该 stage，也不会因 `QUIESCENCE_SEALED` 失败。
因此不要把 `cleanupComplete: false` 当成已释放；应 await `physicalCompletion`，或由 realm owner 在更外层执行
可证明的强制终止。

---

## 5. 配置系统

```ts
await host.config.update('prefix', (previous) => ({
  prefix: `${previous.prefix ?? 'hello'}!`
}))
```

`recipe` 必须**同步**返回 plain record（`readPlainDataRecord`：普通对象、非数组、可枚举 data property；`symbol` 键、`__proto__`/`constructor`/`prototype` 键一律拒绝，抛 `TypeError`）。Host 对 patch 做 Copy-on-Write：只复制新增或替换的分支，未修改分支继续共享 Host 持有的不可变快照。`update()` 失败（插件 `update` 钩子抛错/拒绝）时旧配置保持不变，patch 不会被提交。插件在 `update(next)` 里通过只读参数 `next` 读取候选配置，而 `core.config.get()` 返回的始终是已提交的配置，两者在 `update` 执行期间可能不同。

`host.config.get(path)` 与 `host.config.update()` 都要求 Host 处于 active 状态；Host 开始卸载或卸载完成后会分别抛出 `HOST_DISPOSING` 或 `HOST_DISPOSED`。`get(path)` 对不存在的插件或缺失路径返回 `undefined`，而 `update(name, ...)` 对不存在的插件抛出 `PLUGIN_NOT_INSTALLED`——两者的"找不到"语义不对称，是有意的：读取是探测性操作，写入是明确的意图表达。

### Readonly 懒代理与 Copy-on-Write

Host 在插件 admission（安装/`update`）时取得配置所有权快照，防止调用方之后修改原始配置反向影响插件；深拷贝时会正确处理 `Date`/`RegExp`/`Map`/`Set`（构造对应新实例而非展开字段）与循环引用（内部用 `WeakMap` 保留同一图结构）。读取对象或数组时才通过 `WeakMap` 缓存创建只读代理；代理上的 `set`、`delete`、`defineProperty`、以及 `Map`/`Set`/`Date` 上的变更方法（`.set()`/`.add()`/`.setFullYear()` 等）都会抛出 `TypeError`（`code: 'INVALID_OPTION'`，文案固定为 `config is readonly`）。`config.update()` 的 recipe 和插件 `update(next)` hook 都只能读取只读视图，patch 在提交前被复制，因此 patch 后续被调用方修改也不会污染已提交配置。

---

## 6. Feature 跨插件能力

```ts
const formatFeature = defineFeature(
  (core: { featureExpose: { format(value: string): string } }) => core.featureExpose.format
)

const provider = definePlugin(
  'provider',
  () => ({
    install: () => ({}),
    featureExpose: () => ({ format: (value: string) => value.trim() })
  }),
  { format: formatFeature }
)

const consumer = definePlugin(
  'consumer',
  (core) => ({
    install: () => ({ formatValue: (value: string) => core.features.format(value) })
  }),
  { format: provider.getFeature('format') }
)

const [, consumerHandle] = await host.use(consumer, provider)
consumerHandle.extensions.formatValue(' value ')
```

Feature 引用同时表达能力与依赖。Host 会按引用拓扑排序，所以调用方传入顺序不影响安装；必需 provider 缺失、禁用或移除时分别抛前置条件错误。可选依赖用 `provider.getFeature('format', { optional: true })` 声明。

---

## 7. Pipeline 处理管线

构造时选择一种模式，运行期不能切换：

```ts
const host = new Host({ pipeline: { mode: 'sync' } })
host.usePipeline((value, next) => next(value.trim()))
```

| 模式              | stage 形式                    | `next` 规则                                                                                                                                                                                                                                                                          |
| ----------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sync`            | `(value, next) => void`       | 必须在 stage 返回前调用；延后调用被忽略并触发 `PIPELINE_NEXT_LATE` 诊断（不抛错）。                                                                                                                                                                                                  |
| `async`           | `async (value, next) => void` | `await next(value)`；同一次调用重复 `next()` 抛 `PIPELINE_NEXT_DUPLICATE`。                                                                                                                                                                                                          |
| `generator`       | `function* (value)`           | `return value` 继续；`return undefined` 终止；`GENERATOR_CONTINUE` 用最后一次 yield 的值；`GENERATOR_HALT` 终止整条链；`GENERATOR_UNDEFINED` 显式表达 `undefined`（仅当 `TValue` 类型允许 `undefined` 时才能使用）。                                                                 |
| `async-generator` | `async function* (value)`     | terminal 语义与 `generator` 完全一致（同一套 `GENERATOR_CONTINUE`/`GENERATOR_HALT`/`GENERATOR_UNDEFINED` 判定）；区别是每个 stage 被完整、串行 `await` 耗尽（`await iterator.next()` 循环），中间 yield 只用于本 stage 内部观测，不会提前进入下一 stage，也不产生流式/fan-out 效果。 |

`GENERATOR_CONTINUE` 是 runner 识别的唯一 `Symbol` 控制信号，不是业务数据。一个 generator stage 可以 `yield` 多次，返回该信号表示“采用最后一次 `yield` 的值作为下一 stage 输入”；如果一次也没有 `yield`，则沿用进入当前 stage 的原输入。比如输入 `" migaia "`，依次 `yield value.trim()`、`yield value.trim().toUpperCase()` 后返回 `GENERATOR_CONTINUE`，下一 stage 得到的是 `MIGAIA`。相对地，`return transformedValue` 直接采用返回值，`return GENERATOR_HALT` 或普通 `return` 终止 pipeline，`return GENERATOR_UNDEFINED` 才是把真正的 `undefined` 作为业务值继续传递。

**sync 是扁平转换管道**：`next()` 只记录下一个值，下游 stage 在当前 stage 返回**之后**才执行，因此当前 stage 在调用 `next()` 之后无法观察到下游处理结果。**async 是洋葱模型**：`await next(value)` 会等待整个下游链执行完毕才继续，所以当前 stage 可以在 `next()` 之后写"后置逻辑"，且这段逻辑能看到下游已经处理完的效果。这个执行顺序差异是切换 pipeline mode 时最容易让人困惑的地方，务必注意。`async-generator` 既不是洋葱模型也不是流式管道，是纯粹的"stage 顺序执行、每个 stage 各自异步跑完取一个终值"，介于 `async` 与 `generator` 之间。

四种模式在**执行期间均拒绝注册新 stage**（`PIPELINE_EXECUTING`，防止一个 stage 在执行中修改自己所在的处理链）；嵌套 pipeline 调用使用深度计数，外层执行未结束前依然拒绝注册。async pipeline 的 stage 与 downstream 同时失败时，会聚合成一个携带 `code: 'PIPELINE_FAILED'` 的 `AggregateError`（`errors` 顺序固定为 `[stageError, downstreamError]`）——这是 async 洋葱模型（`next()` 立即启动、可并发观察的下游帧）特有的失败模式；`async-generator` 是严格串行 drain-then-terminal，不存在"stage 与已启动 downstream 同时失败"这种情形，因此没有等价的聚合码，`async-generator` pipeline 里 stage factory 抛错、iterator body 抛错、`done` 抛错都以 exact value 直接传播。

Host 侧注册 stage 后，应由子类在自己的领域入口里调用受保护的 `runPipeline(value, done)` 触发一次遍历；插件 stage 的自动清理不覆盖"正在执行中"的调用——调用方在 `unUse()` 或 `dispose()` 前应自行停止提交新工作并 drain 现有业务流程。pipeline stage 不调用 `next()` 时，该次 pipeline 会被拦截、`done` 回调不会执行，但发起这次 pipeline 调用的操作本身仍会正常完成——调用方需要自行保证每个 stage 按约定推进，Host 不会替你检测"这个 stage 是不是忘了调 next"。

### 遍历中途 dispose 与生命周期 signal

四种模式的 stage 都会在最后一个参数收到 `context`（generator 类 stage 是第二个参数），其中 `context.signal` 就是 host 的生命周期 signal：`dispose()` 开始时被中止，`reason` 是与 `assertActive()` 同一个 `PluginHostError` 实例。等待外部 I/O 的 stage 应监听或轮询它，以便及时退出。

遍历期间 `dispose()` 被调用后，遍历会在下一个协作检查点（进入 stage 前、stage 返回后、`next()` 派发时）中止：sync/generator 同步抛出，async/async-generator 的 Promise reject，错误为 `PluginHostError('HOST_DISPOSING', ...)`（仍在 `closing` 窗口）或 `PluginHostError('HOST_DISPOSED', ...)`（已到达 terminal）。两种都可能出现，调用方应统一按 `instanceof PluginHostError` 处理，不要依赖某个固定的 code。

已知限制：中止与 stage 或下游的普通失败同时发生时，中止错误作为主错误，普通失败目前不会出现在它的 `cause` 上。这由 `@migaia/middleware-pipeline` 的修订版处理，届时本节更新。

---

## 8. 生命周期与错误

1. `use()` 逐个安装批次内的插件；任一安装失败会把这次批次里已安装的插件按逆序回滚。
2. `unUse()` 依次移除 pipeline stage → 插件自身的 `dispose()`/`Symbol.dispose`/`Symbol.asyncDispose` → 释放 shared key → `onDispose()` 登记的资源 disposer → 移除已挂载的 extension 属性。
3. **插件 lifecycle hook 内禁止调用当前 Host 的 `use`、`unUse`、`config.update` 或 `dispose`**——这些调用会同步抛出 `LIFECYCLE_MUTATION`。应用组合层负责维护插件之间的安装/卸载拓扑，插件本身不应该自己触发宿主级变更。
4. cleanup 报错时，Host 仍会移除该插件的可发现状态（从注册表移除、撤销 extension），随后返回的 Promise 才 reject——错误上报和状态清理是分离的两件事，一个失败不会阻塞另一个。
5. Host 被 dispose 后，所有访问/变更 API 都会以 `PluginHostError` reject 或抛出；入口守卫（如内部的 `#assertActive()`）同步抛出，队列内运行时失败以 rejected Promise 返回。

安装失败统一以 `PluginHostError`（`PLUGIN_INSTALL_FAILED`）返回，实际的插件安装错误位于 `cause`——**原始安装错误恒为 primary，不会被后续的回滚失败覆盖**。错误的 `detail` 同时保留失败插件名 `failedName` 与按回滚顺序排列的原始错误身份 `rollbackErrors`；异步 `use()` 的 detail 已完成，`useSync()` 的 detail 是不可变快照，完整 secondary identity 通过 `detail.completion` 的最终冻结结果取得。调用方应按身份处理，不应解析诊断文本。若回滚过程本身也失败，回滚失败仍经 `diagnostic` 回调上报（`code: 'PLUGIN_INSTALL_ROLLBACK_FAILED'`），是诊断信号，不是抛出的错误，也不会改写 primary 错误的 `cause`。

### FIFO mutation 队列与可配置超时

`use`/`unUse`/`config.update` 内部共用一个严格 FIFO 的 mutation 队列（基于 `@migaia/lifecycle` 的 `createMutationQueue`）；`dispose()` 作为终态操作单独入队，永远不受排队拒绝阈值驱逐。排队等待多久会被拒绝**完全由构造选项决定，不是固定值**——见 [§2](#2-host-公开-api-参考) 的 `queueAdmissionTimeoutMs`/`queueAdmissionDiagnosticMs`：默认（两者都不传）只在等待超过 1 秒时发一条诊断，不拒绝；只有显式传入 `queueAdmissionTimeoutMs: <number>` 才会在等待超过该阈值时以 `MUTATION_QUEUE_TIMEOUT` reject 排队中的任务。已经开始执行的插件代码不会被强制中断，超时只影响排在它后面、尚未开始执行的任务；超时后前序工作仍会正常完成，Host 也仍可接受新的 mutation——一次排队超时不会把 Host 永久置为不可用状态。

如果某个插件的 `install()`/`dispose()`/`update()` 在自己执行期间又调用了宿主的 mutation 方法并且直接 `await` 其结果，会形成自依赖：这个新任务排在当前批次后面，而当前批次要等它完成才能继续。若配置了 `queueAdmissionTimeoutMs`，这种自依赖会在阈值到达后转成一次可捕获的 `MUTATION_QUEUE_TIMEOUT` 失败，而不是永久卡死；若未配置（默认），这种自依赖只会持续触发诊断，不会自动解开。**正确的做法始终是插件永远不要同步等待自己触发的宿主级 mutation**——需要联动的话用 fire-and-forget（发起调用但不 await 它的结果）。

同样的自依赖也可能发生在 `dispose()` 的清理阶段：如果某个 pipeline disposer、resource disposer 或插件的 `dispose()` 钩子反过来又 `await` 了触发它的这次 `host.dispose()` 调用，该调用会返回同一个仍在等待这一步完成的 Promise，形成循环等待。Host 为每一步 disposer 的等待设了 `disposeStepTimeoutMs`（默认 5000ms，可配置或用 `false` 关闭）：超时后这一步被计为失败（`DISPOSE_STEP_TIMEOUT`）并继续清理流程，disposal 事务本身仍会收敛到 `disposed`，不会因为一个 disposer 的自依赖而永久停在 `closing`。

---

## 禁用与启用

`host.plugin.disable(name)` 只切换可达性并返回恢复 token；对应句柄在禁用期间抛 `PLUGIN_DISABLED`。`await token.enable()` 用同一注册恢复原 stage 位置。`host.plugin.disabled()` 返回当前禁用插件名的只读快照。`PluginHost` class 与 `defineHost()` handle 都提供这个门面。

禁用不会调用插件 `dispose`、资源 disposer，也不释放 scope；它不是轻量卸载。`onDisable`/`onEnable` 是通知钩子，失败经 `diagnostic` 上报而不回滚。初装成功后也会触发一次 `onEnable`。要回收资源须调用 `unUse(name)`。禁用期间 `host.config` 仍可读取和更新该插件配置。

安装依赖者时，必需 Feature provider 被禁用抛 `PREREQUISITE_DISABLED`，被卸载抛 `PREREQUISITE_REMOVED`，从未安装抛 `PREREQUISITE_MISSING`，批内成环抛 `DEPENDENCY_CYCLE`；它们都在任何 install 执行前、以顶层错误抛出。provider 仍被禁用时单独 `enable` 依赖者抛 `PREREQUISITE_DISABLED`；`token.enable()` 会先检查整组恢复集合，不满足则一个都不启用。

依赖感知的 `disable`/`unUse` 接受 `{ policy?: 'reject' | 'cascade' | 'suspend'; dryRun?: boolean }`，默认 `reject`；`detail.blockedBy` 按级联处理顺序列出**全部**传递依赖者。`policy: 'cascade'` 连同依赖者一起处理；`policy: 'suspend'` 保留已激活依赖者的实例与资源，但句柄和已取出的 extension 抛 `PLUGIN_SUSPENDED`，stage 暂时离开 pipeline。`dryRun` 返回 `{ policy, order, steps, edges }`。旧 `{ cascade: true }` 被拒绝为 `INVALID_OPTION`。同一 provider 重新启用时直接恢复；同名新 provider 安装后按 capability `planResume` 对直接依赖者 rebind/restart，其余可满足的传递依赖者 resume。托管组合协议仍拒绝留下必需依赖者，并按依赖者优先顺序清理；`host.dispose()` 也按依赖者优先顺序释放，包括挂起注册。

## 热替换与惰性激活

`await host.replace(name, next)`（`next.name` 必须等于 `name`，否则 `REPLACE_NAME_MISMATCH`）：

1. 安装 `next`。失败时整体回滚，旧注册继续服务，错误以 `PLUGIN_INSTALL_FAILED` 抛出、原始错误在 `cause`。
2. 发布 `next`，并在这一点把同名 stage 槽位切到新一代；之后开始的 pipeline 运行只含新 stage，既有运行继续持有旧代租约。旧注册上已取出的 extension 立即抛 `REGISTRATION_REVOKED`，句柄自动指向新实现。旧注册若处于禁用状态，新注册同样保持禁用。
3. 对每个已激活的必需依赖者：实现了 `onDependencyReplaced(name, outputs)` 的调用钩子换绑；未实现或钩子抛错（原错误对象经 `diagnostic` 第三个参数上报）的，连同其必需依赖闭包一起按依赖者优先顺序排空 pipeline 租约并 dispose，再按拓扑序重装（沿用重启前的运行时 config，原先已激活的惰性插件重新激活、原先禁用的保持禁用）。
4. 旧注册在其 pipeline 租约排空后 dispose；清理失败以 `CLEANUP_INCOMPLETE` 经 `diagnostic` 上报原始错误对象。
5. 若第 3 步重装失败，替换依然生效，重启失败的插件保持卸载（之后依赖它们的安装得到 `PREREQUISITE_REMOVED`），并抛 `DEPENDENT_RESTART_FAILED`：`cause` 是 `AggregateError`，首项为重装失败，其后依次为钩子错误与清理错误，`detail.dependents` 列出受影响插件。

`activation: 'lazy'` 的插件在 `use()` 时只做准入与依赖校验并登记名称，句柄访问抛 `PLUGIN_NOT_ACTIVATED`。`await host.activate(name)` 先按依赖顺序激活它必需的惰性 provider，再安装自身；对同一插件的并发调用共享同一个 Promise，失败后插件保持未激活，可重试；已禁用的插件不能激活（`PLUGIN_DISABLED`）。非惰性插件安装时先激活它必需的已登记惰性 provider；同批中只被惰性成员依赖的惰性成员保持未激活；依赖校验失败时不会激活任何插件。`useSync()` 无法等待激活，遇到未激活的必需 provider 抛 `PLUGIN_NOT_ACTIVATED`。

## 9. 错误码完整参考

`PluginHostErrorCode` 导出以下稳定错误码，均可通过 `error.code` 分支处理：

| code                               | 含义                                                                                                                                                                                                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HOST_DISPOSED`                    | Host 已完成卸载，不能再访问或变更。                                                                                                                                                                                                                                              |
| `HOST_DISPOSING`                   | Host 正在卸载，不能开始新的变更。                                                                                                                                                                                                                                                |
| `PLUGIN_DUPLICATE`                 | 插件已安装，或同一批次中出现重复名字。                                                                                                                                                                                                                                           |
| `PLUGIN_NOT_INSTALLED`             | 目标插件未安装（`unUse`/`config.update` 找不到对应插件）。                                                                                                                                                                                                                       |
| `PLUGIN_DISABLED`                  | 句柄所指插件当前已禁用；先启用该插件再访问。                                                                                                                                                                                                                                     |
| `PLUGIN_SUSPENDED`                 | 插件因必需 provider 不可用而挂起；恢复 provider，或显式卸载该插件。                                                                                                                                                                                                               |
| `PLUGIN_NOT_ACTIVATED`             | 惰性插件尚未激活；先执行 `await host.activate(name)`。                                                                                                                                                                                                                           |
| `FEATURE_NOT_DECLARED`             | `getFeature(name)` 请求了插件未声明的 feature。                                                                                                                                                                                                                                  |
| `PREREQUISITE_MISSING`             | 必需 feature provider 尚未安装。                                                                                                                                                                                                                                                 |
| `DEPENDENCY_CYCLE`                 | feature 引用形成依赖环；本批次不会执行任何 install。                                                                                                                                                                                                                             |
| `DEPENDENCY_BLOCKED`               | 卸载或禁用 provider 时仍有必需依赖者；查看 `detail.blockedBy`，或使用 `policy: 'cascade'`、`policy: 'suspend'` 或 `dryRun`。                                                                                                                                                    |
| `REPLACE_NAME_MISMATCH`            | `replace(name, next)` 的两个插件名不一致。                                                                                                                                                                                                                                       |
| `DEPENDENT_RESTART_FAILED`         | `replace()` 已提交新实现，但需要重启的依赖者重装失败；它们保持卸载。`cause` 为 `AggregateError`（首项为重装失败），`detail.dependents` 列出受影响插件；修复后重新安装它们。 |
| `PLUGIN_DEFINITION_INVALID`        | 插件定义含已退役或不受支持的字段（例如 `shared`）。                                                                                                                                                                                                                              |
| `PLUGIN_INSTALL_FAILED`            | 插件安装失败；原始错误位于 `cause`。                                                                                                                                                                                                                                             |
| `PLUGIN_INSTALL_ROLLBACK_FAILED`   | 诊断（非抛出）：插件安装失败且回滚清理也失败；原始安装错误**保持 primary**（顶层码 `PLUGIN_INSTALL_FAILED`），回滚失败经 `diagnostic` 上报。                                                                                                                                     |
| `INSTALL_RESULT_THENABLE`          | 插件 `install()` 返回值自带 `then` key；同步 `useSync()` 与异步 `use()` 一致拒绝，不会发布可被误当作 Promise 的扩展。                                                                                                                                                            |
| `COMPOSITION_TARGET_UNMANAGED`     | `openComposition()` 的目标不是本包登记的托管宿主。托管协议只对本包构造出的宿主开放，普通对象、另一份包副本产出的宿主都会被拒绝；组合方应先用 `isManagedHost()` 判定。                                                                                                            |
| `PLUGIN_DISPOSE_FAILED`            | 单个插件卸载失败；原始错误位于 `cause`。                                                                                                                                                                                                                                         |
| `EXTENSION_DUPLICATE`              | extension key 与已有成员冲突。                                                                                                                                                                                                                                                   |
| `EXTENSION_OBJECT_PROTOTYPE`       | extension key 与 `Object.prototype` 上的成员冲突（如 `toString`）。                                                                                                                                                                                                              |
| `EXTENSION_RESERVED`               | extension key 是 Host 保留成员（如 `then`、`disposeKey`、`asyncDisposeKey`）。                                                                                                                                                                                                   |
| `EXTENSION_NON_ENUMERABLE_IGNORED` | 诊断（非抛出）：`install()` 返回值上的非枚举 key 被有意忽略，未挂载到 Host；通过 `diagnostic` 回调上报。                                                                                                                                                                         |
| `PREREQUISITE_DISABLED`            | feature provider 被禁用；可启用该插件后重试。                                                                                                                                                                                                                                    |
| `PREREQUISITE_REMOVED`             | feature provider 已卸载；需重新安装 provider。                                                                                                                                                                                                                                   |
| `RESOURCE_OUTSIDE_INSTALL`         | 在允许的插件生命周期之外注册资源或 pipeline stage。                                                                                                                                                                                                                              |
| `LIFECYCLE_MUTATION`               | 插件生命周期钩子内尝试变更 Host，见 [§8](#8-生命周期与错误)。                                                                                                                                                                                                                    |
| `INVALID_PIPELINE_MODE`            | 构造时传入的 pipeline mode 无效。                                                                                                                                                                                                                                                |
| `PIPELINE_MODE_MISMATCH`           | stage 不能由 middleware-pipeline runner 提升到 Host mode；顶层为带 Host 身份的 `PluginHostError`，`cause` 保留上游 `TypeError`（`INVALID_OPTION`，source 为 `@migaia/middleware-pipeline`）。                                                                                       |
| `PIPELINE_NEXT_DUPLICATE`          | 同一次 stage 调用里重复调用了 `next()`。                                                                                                                                                                                                                                         |
| `PIPELINE_NEXT_LATE`               | 诊断（非抛出）：stage 已经返回/完成之后才调用 `next()`；通过 `diagnostic` 回调上报，该次调用被忽略。                                                                                                                                                                             |
| `PIPELINE_EXECUTING`               | pipeline 执行期间尝试注册新 stage。                                                                                                                                                                                                                                              |
| `PIPELINE_FAILED`                  | async pipeline 的 stage 与 downstream 同时失败，聚合为 `errors` 顺序固定为 `[stageError, downstreamError]` 的 `AggregateError`。                                                                                                                                                 |
| `MUTATION_QUEUE_TIMEOUT`           | mutation 在 FIFO 队列中等待超过**已配置**的 `queueAdmissionTimeoutMs` 阈值后被拒绝（默认未配置该阈值，不会触发）；不会中断已经开始执行的插件代码。语义是**终止**：该 mutation 不会再被执行。                                                                                     |
| `DISPOSE_STEP_TIMEOUT`             | disposal 期间单个 pipeline disposer / 插件 dispose 钩子 / resource disposer 等待超过 `disposeStepTimeoutMs`（默认 5000ms）仍未完成（含反过来 await 触发它的那次 `dispose()` 调用这种自依赖）。语义是**降级继续**：该步骤被计为失败，disposal 事务继续推进直至收敛到 `disposed`。 |
| `MUTATION_EXECUTION_TIMEOUT`       | 已取得执行权的 lifecycle hook 超过 mutation 预算；提交资格已撤销，协作插件应停止并清理其 operation 资源。                                                                                                                                                                        |
| `REGISTRATION_REVOKED`             | 已取出的 extension 函数所属 registration 已被卸载、禁用或替换；调用方应从当前句柄重新读取 extension。                                                                                                                                                                            |
| `PIPELINE_DRAIN_TIMEOUT`           | Host 进入逻辑终态前 active pipeline 未在 drain 预算内归零；检查返回的 disposal result 与 physical completion。                                                                                                                                                                   |
| `CLEANUP_INCOMPLETE`               | 逻辑清理已提交但仍有物理 cleanup 未完成；调用方应观察 `physicalCompletion`。                                                                                                                                                                                                     |
| `INVALID_CONFIG_VALUE`             | config 值不满足准入的 plain-data 语法（如 symbol、非法原型、危险键名、descriptor、thenable）；调用方需改用受支持的取值。                                                                                                                                                         |
| `CONFIG_CYCLE_REJECTED`            | config 输入存在引用循环；调用方需提供无环的值图。                                                                                                                                                                                                                                |
| `INVALID_OPTION`                   | 入参校验失败（`TypeError`）：插件名/配置路径/pipeline stage/extension/domain core/资源 disposer/构造选项等输入不满足契约，检查用 `error instanceof TypeError`，不按 `PluginHostError` 分支。                                                                                     |

```ts
import { PluginHostErrorCode, type IPluginHostErrorCode } from '@migaia/plugin-host'

PluginHostErrorCode.mutationQueueTimeout // 'MUTATION_QUEUE_TIMEOUT'
```

`diagnostic` 是构造 `PluginHost` 时可选传入的回调（`IPluginHostDiagnostic`：`(message: string, code?: IPluginHostErrorCode, error?: unknown) => void`；被吞下改为上报的错误会以原始对象经 `error` 送达），用于接收"不构成错误、但值得关注"的信息：`PIPELINE_NEXT_LATE`、`EXTENSION_NON_ENUMERABLE_IGNORED`、`PLUGIN_INSTALL_ROLLBACK_FAILED`，以及未配置 `queueAdmissionTimeoutMs` 时的队列排队等待提示（这一条**不携带错误码**）。`MUTATION_QUEUE_TIMEOUT` 与 `DISPOSE_STEP_TIMEOUT` 是正式抛出/reject 的错误，不再只经 `diagnostic` 上报。diagnostic 回调自身抛出的异常永远不会影响宿主的正常执行流程。

---

## 10. 资源清理协议

```ts
core.onDispose(() => cleanup()) // 普通函数
core.onDispose({ [Symbol.dispose]: () => cleanup() }) // 同步 disposable
core.onDispose({ [Symbol.asyncDispose]: async () => await cleanup() }) // 异步 disposable
```

`onDispose(resource)` 接受三种形状（`IPluginResource`）：普通函数、带 `[disposeKey]`/`Symbol.dispose` 的同步 disposable、带 `[asyncDisposeKey]`/`Symbol.asyncDispose` 的异步 disposable。同一个资源如果同时提供多种清理方式，优先级是：显式的函数形态 > `Symbol.asyncDispose`/`asyncDisposeKey` > `Symbol.dispose`/`disposeKey`（源码 `src/disposal.ts` 的 `snapshotDisposer`：先扫描全部 async 候选键，再扫描 sync 候选键，取第一个值为函数的）。异步（`use()` 或 `useSync`）插件的资源清理支持完整的 async disposer；`useSync` 安装失败时通过 `detail.completion` 取得最终 rollback detail，见 [§4](#4-插件-core-api-参考)。

`unUse()`/`dispose()` 清理某个插件时，按以下顺序逆序执行：pipeline disposer → 插件自身的 `dispose()`/`Symbol.dispose`/`Symbol.asyncDispose` → 释放 shared key → 通过 `onDispose()` 登记的资源 disposer → 移除已挂载的 extension 属性。每一步都以自己的 `disposeStepTimeoutMs` 为界（见 [§8](#8-生命周期与错误)）；任何一步失败都会被收集而不是让后续步骤中断，最终如果同一次卸载/dispose 有多个失败会聚合成 `AggregateError`（单个失败则直接是携带该 `cause` 的 `Error`）。

---

## 11. Pipeline 类型与信号量

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
  PluginHostDisposalNodeKind,
  invokeCaptured,
  readPluginHostDisposalProvenance,
  disposeKey,
  asyncDisposeKey
} from '@migaia/plugin-host'
```

mode、violation 与四种 stage 类型都从 `@migaia/middleware-pipeline` **原名转发**。plugin-host 不再维护重复的 mode/stage 声明或公开适配器；宿主在注册 stage 时通过其唯一的 `createPipeline` runner 执行提升。需要手工提升或直接执行 pipeline 时使用 `@migaia/middleware-pipeline` 的 `createPipeline`。
- **`GENERATOR_CONTINUE` / `GENERATOR_HALT` / `GENERATOR_UNDEFINED`**——generator/async-generator pipeline 共用的哨兵值（`unique symbol`，从 `@migaia/middleware-pipeline` 转发，保持跨包同一身份）：stage 的 `return` 可以返回它们中的一个来表达"继续/终止/显式 undefined"，语义见 [§7](#7-pipeline-处理管线) 表格。
- **`disposeKey: unique symbol` / `asyncDisposeKey: unique symbol`**——本包自声明的 symbol（不依赖 `ESNext.Disposable` lib，因此不强制要求该 lib 的类型声明）。插件/资源可以用这两个 key 之一声明清理方法，运行时会把自声明 symbol 与宿主原生 `Symbol.dispose`/`Symbol.asyncDispose`（若当前运行时提供）都识别为等价键；宿主不提供原生 symbol 时，只有自声明 symbol 生效。
- **`invokeCaptured(callable, receiver, args)`**——框架适配器用于保留 JavaScript receiver、参数顺序和抛出值身份的低层调用边界。业务插件应直接调用自己的函数；只有已经独立完成 callable/receiver/args 准入的适配器才应使用它。
- **`PluginHostDisposalNodeKind` / `readPluginHostDisposalProvenance(error)`**——清理诊断协议。前者区分 host error、aggregate 和 disposer wrapper；后者只读取本物理包实例登记的 provenance，未知错误或另一份重复安装的包实例会返回 `undefined`，不会按对象外形猜测。它用于日志与审计，不应代替 `source`/`code`/`cause` 错误处理。

---

## 12. 完整示例

### 12.1 带配置的插件 + Feature 能力组合

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
  (core: ICore & { features: { format(value: string): string } }) => ({
    install: () => ({ log: (msg: string) => core.write(core.features.format(msg)) })
  }),
  { format: formatter.getFeature('format') }
)

class Host extends PluginHost<ICore, never> {
  protected createPluginDomainCore(): ICore {
    return { write: (text) => console.log(text) }
  }
}

const host = new Host()
const [, writerHandle] = await host.use(formatter, writer)
writerHandle.extensions.log('server started') // "[app] server started"

await host.config.update('formatter', () => ({ prefix: '[api]' }))
writerHandle.extensions.log('request handled') // "[api] request handled"

await host.dispose()
```

### 12.2 async pipeline 做请求耗时统计（洋葱模型的"前置 + 后置"）

```ts
import { PluginHost } from '@migaia/plugin-host'

type IRequest = { path: string; startedAt?: number }

class Host extends PluginHost<{}, IRequest> {
  protected createPluginDomainCore() {
    return {}
  }
  handle(request: IRequest): Promise<void> {
    return this.runPipeline(request, (final) => {
      console.log('handled', final.path)
    }) as Promise<void>
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

### 12.3 用 `diagnostic` + 自定义队列/清理超时观测宿主内部行为

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
  queueAdmissionDiagnosticMs: 200, // 未配置拒绝阈值时才会用到；这里已配置拒绝阈值，实际不会走这一条
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
// events 里可能包含非枚举扩展被忽略等诊断，取决于实际时序
```

### 12.4 优雅降级：安装失败时读出真实原因与回滚详情

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
    console.error('失败插件:', error.detail?.failedName)
    console.error('回滚错误身份:', error.detail?.rollbackErrors)
  }
}
```

### 12.5 generator pipeline：用 `GENERATOR_HALT` 提前截断处理链

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

---

## 13. 构建、测试与常见问题排查

在仓库根目录运行以下包级门禁；`test` 会先执行本包的 `build`（`vite build && tsc --emitDeclarationOnly`）再跑 `vitest run`。

```bash
pnpm --filter @migaia/plugin-host fmt
pnpm --filter @migaia/plugin-host lint
pnpm --filter @migaia/plugin-host typecheck
pnpm --filter @migaia/plugin-host typecheck:test
pnpm --filter @migaia/plugin-host test
```

**Q：`await host.use(plugin)` 卡住不返回。**
检查插件的 `install()` 是否在自己内部同步等待了当前宿主的另一个 `use()`/`unUse()`/`config.update()` 调用——这会形成自等待死锁，见 [§8](#8-生命周期与错误)。默认情况下这种自依赖只会持续触发诊断（打开 `diagnostic` 回调观察排队等待提示）而不会自动解开；如果需要一个明确的上限，构造 Host 时显式传入 `queueAdmissionTimeoutMs`，超时会以 `MUTATION_QUEUE_TIMEOUT` 结束这次等待。

**Q：插件安装失败，报 `PLUGIN_INSTALL_ROLLBACK_FAILED`。**
说明不仅插件安装本身失败了，回滚清理之前已安装插件时也出错了；这是通过 `diagnostic` 回调上报的附加信号，抛给调用方的错误仍然是原始安装错误（`PLUGIN_INSTALL_FAILED`，`cause` 是最初触发失败的那个错误）。想看到回滚失败的详情需要注入 `diagnostic` 回调。

**Q：TypeScript 报 extension 方法不存在，但运行时明明有。**
检查该插件是否是"运行期动态安装"（`await host.use(plugin)`）——TypeScript 需要能静态分析到这次 `use()` 调用并把返回值赋值给一个新的变量/重新赋值给 `host`，才能推导出扩展后的类型；如果插件是根据运行时条件动态选择安装的，类型系统无法推导，需要手动标注类型。

**Q：`core.onDispose(asyncFn)` 在构造期插件里直接抛错。**
构造函数同步安装的插件不允许注册 async disposer，见 [§4](#4-插件-core-api-参考)。要么把这个资源的清理逻辑改成同步，要么把这个插件改成运行期通过 `await host.use(plugin)` 安装。

**Q：`config.get()` 读出来的嵌套对象不能修改。**
这是预期行为：配置通过 Readonly 懒代理保护，写操作会抛携带 `code: 'INVALID_OPTION'` 的 `TypeError`。需要修改配置时，使用 `config.update()` 返回新的 patch，不要直接修改 `get()` 或 `update(next)` 收到的对象。

**Q：为什么排队再久也没有报 `MUTATION_QUEUE_TIMEOUT`？**
这是默认行为，不是缺陷——`queueAdmissionTimeoutMs` 默认 `undefined`，代表"只诊断不拒绝"；只有显式传入具体数值才会在排队超过该阈值时拒绝。需要有拒绝行为的场景（例如探测死锁）应显式配置这个选项，见 [§2](#2-host-公开-api-参考)。

**Q：`host.dispose()` 卡住不 resolve。**
先检查是否存在某个 disposer 反过来 `await` 了触发它的这次 `dispose()` 调用——这是循环等待，见 [§8](#8-生命周期与错误)。默认情况下 `disposeStepTimeoutMs` 是 5000ms，超时后这一步会被计为 `DISPOSE_STEP_TIMEOUT` 失败并继续推进，最终仍会收敛到 `disposed`；如果 `dispose()` 迟迟不 resolve，检查是否传了 `disposeStepTimeoutMs: false`（永久等待，不会强制推进）。

## Composition registration view

`@migaia/plugin-host/composition` 是独立的 composition 子路径：

```ts
import {
  createView,
  type IRegistrationToken,
  type IRegistrationView
} from '@migaia/plugin-host/composition'
```

`createView(token)` 只发布该 exact registration 的 extensions。token 是 opaque identity，foreign
或已撤销 token 会 fail closed；view 不包含 Host、config、shared 或 mutation 能力。历史
`IPluginRegistrationReceipt` 仍是 deprecated 的 `IRegistrationToken` 类型别名，保持编译兼容。
