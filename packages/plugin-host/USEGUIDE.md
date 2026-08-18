# 使用手册

本文是 `@migaia/plugin-host` 的完整参考手册。先看 [README.md](./README.md#4-五分钟上手) 的五分钟上手示例，跑起来之后再回来查这里的细节——README 讲"是什么、为什么用、5 分钟怎么跑起来"，本文讲"每一个 API 的精确签名、每一种边界行为、每一个错误码"。

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
11. [完整示例](#11-完整示例)
12. [常见问题排查](#12-常见问题排查)

---

## 1. 适用范围与设计定位

`PluginHost<TDomainCore, TValue>` 是一个抽象基类，本身不知道任何业务领域概念——它不实现日志、网络、状态管理，也不替你决定插件应该长什么样。它只负责"插件系统"这一层通用机制：安装顺序、生命周期、配置、资源清理、共享能力、处理管线。

管线执行算法已经抽到 `@migaia/middleware-pipeline`；本包只负责把插件注册的 stage 接入执行器，并提供 plugin-host 的 violation、active 和错误策略。不要从 plugin-host 的内部 wrapper 复制 runner 实现。

```ts
type ICore = { publish(value: string): void };

class Host extends PluginHost<ICore, string> {
  protected createPluginDomainCore(): ICore {
    return { publish: (value) => console.log(value) };
  }
}
```

两个类型参数：`TDomainCore` 是子类提供给插件的领域能力形状；`TValue` 是 pipeline 处理的值类型（不需要 pipeline 时传 `never`）。子类唯一必须实现的是 `createPluginDomainCore()`，每次插件安装都会调用它一次，产出一份独立的领域 core 实例。

---

## 2. Host 公开 API 参考

| API / 签名                         | 参数                                                           | 必填性          | 返回值                             | 同步/异步 | 作用                                                                                                                                                        |
| ---------------------------------- | -------------------------------------------------------------- | --------------- | ---------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `host.use(...plugins)`             | `plugins: IPlugin[]`，按顺序安装                               | 至少 1 个，必填 | `Promise<Host & Extensions>`       | 异步      | 安装插件。同步安装会立刻挂载 extension；仍应 `await` 以处理异步安装或失败。                                                                                 |
| `host.unUse(name)`                 | `name: string`，插件唯一名称                                   | `name` 必填     | `Promise<void>`                    | 异步      | 卸载该插件及其 extension、shared、stage、登记资源；未知名称无操作。                                                                                         |
| `host.dispose()`                   | 无                                                             | 无参数          | `Promise<void>`                    | 异步      | 卸载所有插件并永久关闭 Host；重复调用复用同一 Promise。                                                                                                     |
| `host.config.get(path)`            | `plugin.key` 或 `plugin.[index].key`                           | 必填            | `unknown \| undefined`             | 同步      | 只能读取嵌套配置值；直接传插件名是非法的（详见 [§5](#5-配置系统)）。返回目标路径值；未知插件或缺失路径返回 `undefined`。对象/数组目标返回 Readonly 懒代理。 |
| `host.config.update(name, recipe)` | `name: string`；`recipe(previous) => patch`，同步 plain record | 两项都必填      | `Promise<void>`                    | 异步      | Copy-on-Write 合并 patch，执行 `plugin.update(next, core)` 后提交；失败不提交；提交配置与 patch 完全隔离。                                                  |
| `host.getShared(key)`              | `key: PropertyKey`                                             | `key` 必填      | `T \| undefined`                   | 同步      | 读取已安装 provider 的 shared 值。                                                                                                                          |
| `host.pipelineMode`                | 无                                                             | 无参数          | `'sync' \| 'async' \| 'generator'` | 同步      | 构造时由 `new Host({ pipeline?: { mode?: ... } })` 固定；`pipeline`、`mode` 都可选，默认 `'sync'`。                                                         |
| `host.usePipeline(stage)`          | `stage: (value, next) => void`                                 | `stage` 必填    | `this`                             | 同步      | 按当前 mode 注册；async/generator mode 自动适配。`next(value)` 必须在函数返回前调用。                                                                       |
| `host.useAsyncPipeline(stage)`     | `stage: (value, next) => void \| Promise<void>`                | `stage` 必填    | `this`                             | 同步      | 注册 async stage；`next(value)` 返回 Promise，通常应 await。注册调用本身同步返回，异步的是被注册的 stage 执行。                                             |
| `host.useGeneratorPipeline(stage)` | `stage: (value) => Generator<value, value \| control signal>`  | `stage` 必填    | `this`                             | 同步      | 注册 generator stage；见 [§7](#7-pipeline-处理管线)。                                                                                                       |
| `PluginHost.setLocale(locale)`     | `locale: 'en' \| 'zh'`                                         | `locale` 必填   | `void`                             | 同步      | 修改后续 Host 错误的本地化文案，静态方法，影响全局。                                                                                                        |

`dispose()` 开始后拒绝新的 mutation；此前已经被接纳的 mutation 会先按队列完成后再进入卸载流程。

`getShared()` 返回 provider 明确共享的原始引用，不提供 config 式的只读隔离；provider 与 consumer 应共同约定其可变性和生命周期。

错误边界约定：`PluginHostError` 用于可由调用方按错误码处理的 host 状态/协议错误；`TypeError` 用于插件输入形状不符合 JavaScript API 约束（plain object、data property、disposer、extension descriptor 等），因此这类输入校验不提供 host 错误码——检查 `error instanceof TypeError` 而不是按 code 分支。

---

## 3. 插件对象 API 参考

```ts
import type { IPlugin } from '@migaia/plugin-host';

type IPluginConfig = { prefix?: string };
type IPluginCore = { emit(value: string): void };

const prefix: IPlugin<IPluginCore, { greet(name: string): void }, IPluginConfig> = {
  name: 'prefix',
  config: { prefix: 'hello' },
  install(core) {
    const config = core.config.get();
    return { greet: (name) => core.emit(`${config.prefix} ${name}`) };
  },
  update(next) {},
  dispose() {}
};
```

| 字段 / 签名             | 输入                                                                         | 必填性 | 返回值                  | 同步/异步 | 作用                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------- | ------ | ----------------------- | --------- | ------------------------------------------------------------------------------------------------------------------- |
| `name`                  | `string`，非空，**不能包含 `.`**                                             | 必填   | 无                      | —         | 当前 Host 内的唯一插件标识；含 `.` 会在安装入口直接被拒绝（避免和 `config.get('plugin.key')` 的路径解析产生歧义）。 |
| `config`                | `TConfig extends Record<string, unknown>`                                    | 可选   | 无                      | —         | 初始配置；Host 以浅只读快照保存。                                                                                   |
| `install(core)`         | 领域 core 与 `config.get()`、`getShared()`、`onDispose()`、pipeline 注册方法 | 必填   | `TExt \| Promise<TExt>` | 视情况    | 初始化插件并返回 plain extension record；可以同步返回也可以返回 `Promise`。                                         |
| `shared(core)`          | 同 `install` core                                                            | 可选   | `TShared` plain record  | 同步      | 注册供后续插件读取的能力；返回值不支持 `Promise`，必须同步产出。                                                    |
| `update(next, core)`    | `next: IReadonlyConfig<TConfig>`，候选完整配置                               | 可选   | `void \| Promise<void>` | 视情况    | 响应 `config.update`；成功才提交 `next`，且 next 只能读取。                                                         |
| `dispose()`             | 无                                                                           | 可选   | `void \| Promise<void>` | 视情况    | 插件级清理。                                                                                                        |
| `[Symbol.dispose]`      | 无                                                                           | 可选   | `void`                  | 同步      | 未声明 `dispose` 时的同步清理兜底。                                                                                 |
| `[Symbol.asyncDispose]` | 无                                                                           | 可选   | `void \| Promise<void>` | 视情况    | 未声明 `dispose` 时的清理兜底；构造函数同步安装的插件不支持这个形式，见 [§4](#4-插件-core-api-参考)。               |

`install()` 返回的 extension 对象上，只有**可枚举的 data property**会被挂载到 host——非枚举 key 会被有意忽略（并通过 `diagnostic` 回调上报，见 [§9](#9-错误码完整参考) 的 `EXTENSION_NON_ENUMERABLE_IGNORED`），getter/setter 形式的属性会直接抛错。`then` 被保留为禁用关键字，不能作为 extension key（否则 `await host.use(plugin)` 会把返回值误当成 thenable 解包）；`catch`、`finally` 可以正常使用。

---

## 4. 插件 core API 参考

安装时获得的 `core` 是一个稳定的 facade。它包含子类提供的领域方法，加上下面的通用能力：

| API / 签名                         | 参数                                            | 必填性          | 返回值               | 同步/异步 | 作用                                                                        |
| ---------------------------------- | ----------------------------------------------- | --------------- | -------------------- | --------- | --------------------------------------------------------------------------- |
| `core.config.get<T>()`             | 可选泛型 `T`，通常由插件 `config` 推导          | 无运行时参数    | `IReadonlyConfig<T>` | 同步      | 当前插件的已提交配置只读懒代理；嵌套对象/数组按访问时代理，不允许直接修改。 |
| `core.getShared<T>(key)`           | `key: PropertyKey`                              | `key` 必填      | `T \| undefined`     | 同步      | 读取安装顺序中更早的 provider 提供的 shared 值。                            |
| `core.onDispose(resource)`         | disposer 函数或 disposable 对象                 | `resource` 必填 | `void`               | 同步      | 仅 `install()` 期间可调用；卸载时按逆序执行。                               |
| `core.usePipeline(stage)`          | `stage: (value, next) => void`                  | `stage` 必填    | `core`               | 同步      | 按当前 mode 注册；pipeline stage 执行期间不得注册新 stage。                 |
| `core.useAsyncPipeline(stage)`     | `stage: (value, next) => void \| Promise<void>` | `stage` 必填    | `core`               | 同步      | 仅 install 期间注册 async stage；注册调用本身同步返回。                     |
| `core.useGeneratorPipeline(stage)` | `stage: (value) => Generator`                   | `stage` 必填    | `core`               | 同步      | 仅 install 期间注册 generator stage。                                       |

`onDispose` 接受函数、`{ [Symbol.dispose]() }` 或 `{ [Symbol.asyncDispose]() }`。**同步安装（构造函数里的 `plugins` 参数）的插件不能注册 async disposer**——声明为 `async function` 或提供 `Symbol.asyncDispose` 的资源会在注册那一刻就被同步拒绝，因为同步安装的回滚契约要求全部清理工作真正同步完成；异步 disposer 的副作用一旦开始执行就无法在回滚阶段撤销。资源、shared、pipeline stage 和 extension 都由这次安装记录拥有；`unUse()` 时会按逆序撤销它们。

**不要把 `use`、`unUse`、`config.update` 或 `dispose` 暴露给插件 core。** 插件也不得在自己的 lifecycle hook（`install`/`update`/`dispose`）内部调用当前 Host 的这几个方法——这会触发 `LIFECYCLE_MUTATION`，见 [§8](#8-生命周期与错误)。

TypeScript 的"已安装插件"类型只会随 `use()` 累加，不会因 `unUse()` 递减；卸载后的类型仍应视为静态能力记录，这是当前 API 的已知限制，不是 bug——运行时行为是正确的（方法确实被移除了），只是类型层面不会收窄。

---

## 5. 配置系统

```ts
await host.config.update('prefix', (previous) => ({
  prefix: `${previous.prefix ?? 'hello'}!`
}));
```

`recipe` 必须**同步**返回 plain record。Host 对 patch 做 Copy-on-Write：只复制新增或替换的分支，未修改分支继续共享 Host 持有的不可变快照。`update()` 失败时旧配置保持不变。插件在 `update(next)` 里通过只读参数 `next` 读取候选配置，而 `core.config.get()` 返回的始终是已提交的配置，两者在 `update` 执行期间可能不同。

`host.config.get(path)` 与 `host.config.update()` 都要求 Host 处于 active 状态；Host 开始卸载或卸载完成后会抛出 `HOST_DISPOSING` 或 `HOST_DISPOSED`。`get(path)` 对不存在的插件或缺失路径返回 `undefined`，而 `update(name, ...)` 对不存在的插件抛出 `PLUGIN_NOT_INSTALLED`——两者的"找不到"语义不对称，是有意的：读取是探测性操作，写入是明确的意图表达。`host.config` facade 本身在重复访问时保持同一引用（懒加载单例）。

### Readonly 懒代理与 Copy-on-Write

Host 在插件 admission 时取得配置所有权快照，防止调用方之后修改原始配置反向影响插件。读取对象或数组时才通过 WeakMap 缓存创建只读代理；代理上的 `set`、`delete`、`defineProperty` 都会抛出错误。`config.update()` 的 recipe 和 `update(next)` hook 都只能读取只读视图，patch 在提交前被复制，因此 patch 后续被调用方修改也不会污染已提交配置。

---

## 6. shared 共享能力

```ts
const provider: IPlugin<ICore, {}, {}, { format: (value: string) => string }> = {
  name: 'provider',
  install: () => ({}),
  shared: () => ({ format: (value) => value.trim() })
};

const consumer: IPlugin<ICore> = {
  name: 'consumer',
  install: (core) => {
    core.getShared('format')?.(' value ');
    return {};
  }
};

await host.use(provider, consumer);
```

shared 能力的可见顺序就是插件的安装顺序——后安装的插件能读到先安装插件的 shared，反过来不行。相同 key 会在安装期直接报错（`SHARED_DUPLICATE`）。Host **不维护依赖图**，如果要卸载一个 provider，必须先手动卸载依赖它的 consumer；已经被 consumer 缓存下来的 shared 函数引用，Host 无法追溯撤销（这也是为什么 shared 通常应该是无状态的纯函数或稳定引用，而不是持有可变内部状态的对象）。

---

## 7. Pipeline 处理管线

构造时选择一种模式，运行期不能切换：

```ts
const host = new Host({ pipeline: { mode: 'sync' } });
host.usePipeline((value, next) => next(value.trim()));
```

| 模式        | stage 形式                    | `next` 规则                                                                                                                                                                                                               |
| ----------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sync`      | `(value, next) => void`       | 必须在 stage 返回前调用；延后调用会被忽略并触发 diagnostic。                                                                                                                                                              |
| `async`     | `async (value, next) => void` | `await next(value)`。                                                                                                                                                                                                     |
| `generator` | `function* (value)`           | `return value` 继续；`return undefined` 终止；`GENERATOR_CONTINUE` 采用最后一次 yield 的值；`GENERATOR_HALT` 终止整条链；`GENERATOR_UNDEFINED` 表示显式的 undefined 值（仅当 `TValue` 类型允许 `undefined` 时才能使用）。 |

**sync 是扁平转换管道**：`next()` 只记录下一个值，下游 stage 在当前 stage 返回**之后**才执行，因此当前 stage 在调用 `next()` 之后无法观察到下游处理结果。**async 是洋葱模型**：`await next(value)` 会等待整个下游链执行完毕才继续，所以当前 stage 可以在 `next()` 之后写"后置逻辑"，且这段逻辑能看到下游已经处理完的效果。这个执行顺序差异是切换 pipeline mode 时最容易让人困惑的地方，务必注意。

Host 侧注册 stage 后，应由子类在其领域入口（比如 logger 的 `#process()`）调用受保护的 `runPipeline(value, done)`。三种 pipeline 在执行期间均拒绝注册新 stage（防止一个 stage 在执行中修改自己所在的处理链）；嵌套 pipeline 调用使用深度计数，外层执行未结束前依然拒绝注册。插件 stage 的自动清理不覆盖"正在执行中"的调用——调用方在 `unUse()` 或 `dispose()` 前应自行停止提交新工作并 drain 现有业务流程。

---

## 8. 生命周期与错误

1. `use()` 逐个安装批次内的插件；任一安装失败会把这次批次里已安装的插件按逆序回滚。
2. `unUse()` 依次移除 pipeline stage、shared、插件 cleanup、已挂载的 extension。
3. **插件 lifecycle hook 内禁止调用当前 Host 的 `use`、`unUse`、`config.update` 或 `dispose`**——这些调用会同步抛出 `LIFECYCLE_MUTATION`。应用组合层负责维护插件之间的安装/卸载拓扑，插件本身不应该自己触发宿主级变更。
4. cleanup 报错时，Host 仍会移除该插件的可发现状态（从注册表移除、撤销 extension），随后返回的 Promise 才 reject——错误上报和状态清理是分离的两件事，一个失败不会阻塞另一个。
5. Host 被 dispose 后，所有访问/变更 API 都会以 `PluginHostError` reject 或抛出；入口守卫（如 `#assertActive()`）同步抛出，队列内运行时失败以 rejected Promise 返回。

`use()` 的安装失败统一以 `PluginHostError`（`PLUGIN_INSTALL_FAILED`）返回，实际的插件安装错误位于 `cause`；若回滚过程本身也失败，`cause` 会是一个包含"安装错误 + 各阶段回滚错误"的 `AggregateError`（对应 `PLUGIN_INSTALL_ROLLBACK_FAILED`）。

pipeline stage 不调用 `next()` 时，该次 pipeline 会被拦截、`done` 回调不会执行，但发起这次 pipeline 调用的操作本身仍会正常完成——调用方需要自行保证每个 stage 按约定推进，Host 不会替你检测"这个 stage 是不是忘了调 next"。

### 排队等待的 5 秒 SLA

`use`/`unUse`/`config.update` 内部共用一个严格 FIFO 的 mutation 队列；`dispose()` 作为终态操作单独入队，不受此 SLA 驱逐。一个 mutation 排在正在执行的工作后面等待超过 5 秒仍未开始执行，会被移出队列并以稳定的 `MUTATION_QUEUE_TIMEOUT` 错误 reject——这是正式的公开行为，不是仅供调试的诊断兜底。等待中的计时只针对"排队未开始"的任务；已经开始执行的插件代码不会被强制中断（JS 无法安全撤销正在运行的代码），超时只影响排在它后面的任务。超时后前序工作仍会正常完成，Host 也仍可接受新的 mutation——一次排队超时不会把 Host 永久置为不可用状态。

如果某个插件的 `install()`/`dispose()`/`update()` 在自己执行期间又调用了宿主的 mutation 方法并且直接 `await` 其结果，会形成自依赖：这个新任务排在当前批次后面，而当前批次要等它完成才能继续——这正是上面 5 秒 SLA 存在的原因之一，它会把这种自依赖转成一次可捕获的 `MUTATION_QUEUE_TIMEOUT` 失败，而不是永久卡死。**正确的做法仍然是插件永远不要同步等待自己触发的宿主级 mutation**——需要联动的话用 fire-and-forget（发起调用但不 await 它的结果）。

同样的自依赖也可能发生在 `dispose()` 的清理阶段：如果某个 pipeline disposer、resource disposer 或插件的 `dispose()` 钩子反过来又 `await` 了触发它的这次 `host.dispose()` 调用，该调用会返回同一个仍在等待这一步完成的 Promise，形成循环等待。Host 为每一步 disposer 的等待单独设了 5 秒上限（`DISPOSE_STEP_TIMEOUT`）：超时后这一步被计为失败并继续清理流程，disposal 事务本身仍会收敛到 `disposed`，不会因为一个 disposer 的自依赖而永久停在 `closing`。

---

## 9. 错误码完整参考

`PluginHostErrorCode` 导出以下稳定错误码，均可通过 `error.code` 分支处理：

| code                               | 含义                                                                                                                                                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HOST_DISPOSED`                    | Host 已完成卸载，不能再访问或变更。                                                                                                                                                                                         |
| `HOST_DISPOSING`                   | Host 正在卸载，不能开始新的变更。                                                                                                                                                                                           |
| `PLUGIN_DUPLICATE`                 | 插件已安装，或同一批次中出现重复名字。                                                                                                                                                                                      |
| `PLUGIN_NOT_INSTALLED`             | 目标插件未安装（`unUse`/`config.update` 找不到对应插件）。                                                                                                                                                                  |
| `PLUGIN_INSTALL_FAILED`            | 插件安装失败；原始错误位于 `cause`。                                                                                                                                                                                        |
| `PLUGIN_INSTALL_ROLLBACK_FAILED`   | 诊断（非抛出）：插件安装失败且回滚清理也失败；原始安装错误**保持 primary**（顶层码 `PLUGIN_INSTALL_FAILED`），回滚失败经 `diagnostic` 上报。                                                                                |
| `PLUGIN_DISPOSE_FAILED`            | 单个插件卸载失败；原始错误位于 `cause`。                                                                                                                                                                                    |
| `HOST_DISPOSE_FAILED`              | Host 整体卸载失败；原始错误位于 `cause`。                                                                                                                                                                                   |
| `INVALID_OPTION`                   | 入参校验失败（`TypeError`）：插件名/配置路径/pipeline stage/extension/domain core/资源 disposer 等输入不满足契约。                                                                                                          |
| `EXTENSION_DUPLICATE`              | extension key 与已有成员冲突。                                                                                                                                                                                              |
| `EXTENSION_OBJECT_PROTOTYPE`       | extension key 与 `Object.prototype` 上的成员冲突（如 `toString`）。                                                                                                                                                         |
| `EXTENSION_RESERVED`               | extension key 是 Host 保留成员（如 `then`）。                                                                                                                                                                               |
| `EXTENSION_NON_ENUMERABLE_IGNORED` | 诊断（非抛出）：`install()` 返回值上的非枚举 key 被有意忽略，未挂载到 Host；通过 `diagnostic` 回调上报。                                                                                                                    |
| `MUTATION_QUEUE_TIMEOUT`           | mutation 在 FIFO 队列中等待达到 5 秒 SLA 后被拒绝；不会中断已经开始执行的插件代码。                                                                                                                                         |
| `DISPOSE_STEP_TIMEOUT`             | disposal 期间单个 pipeline disposer / 插件 dispose 钩子 / resource disposer 等待超过 5 秒仍未完成（含反过来 await 触发它的那次 `dispose()` 调用这种自依赖）；该步骤被计为失败，disposal 事务继续推进直至收敛到 `disposed`。 |
| `SHARED_DUPLICATE`                 | shared key 已被占用。                                                                                                                                                                                                       |
| `RESOURCE_OUTSIDE_INSTALL`         | 在允许的插件生命周期之外注册资源或 pipeline stage。                                                                                                                                                                         |
| `LIFECYCLE_MUTATION`               | 插件生命周期钩子内尝试变更 Host，见 [§8](#8-生命周期与错误)。                                                                                                                                                               |
| `INVALID_PIPELINE_MODE`            | 构造时传入的 pipeline mode 无效。                                                                                                                                                                                           |
| `PIPELINE_MODE_MISMATCH`           | Host mode 合法，但调用了与当前 mode 不匹配的 stage 注册方法（比如 sync 模式下调用了 `useAsyncPipeline`）。                                                                                                                  |
| `PIPELINE_EXECUTING`               | pipeline 执行期间尝试注册新 stage。                                                                                                                                                                                         |
| `PIPELINE_FAILED`                  | async pipeline 的 stage 与 downstream 同时失败，聚合为带 `(source, code)` 的 `AggregateError`。                                                                                                                             |
| `PIPELINE_NEXT_DUPLICATE`          | 同一次 stage 调用里重复调用了 `next()`。                                                                                                                                                                                    |
| `PIPELINE_NEXT_LATE`               | stage 已经返回/完成之后才调用 `next()`；通过 `diagnostic` 回调上报，不抛错。                                                                                                                                                |

`diagnostic` 是构造 `PluginHost` 时可选传入的回调（`(message: string, code?: IPluginHostErrorCode) => void`），用于接收"不构成错误、但值得关注"的信息（如 `PIPELINE_NEXT_LATE`、`EXTENSION_NON_ENUMERABLE_IGNORED`）。排队超时是正式的 `MUTATION_QUEUE_TIMEOUT` 错误，不再只通过 diagnostic 上报。diagnostic 回调自身抛出的异常永远不会影响宿主的正常执行流程。

---

## 10. 资源清理协议

`onDispose(resource)` 接受三种形状：

```ts
core.onDispose(() => cleanup()); // 普通函数
core.onDispose({ [Symbol.dispose]: () => cleanup() }); // 同步 disposable
core.onDispose({ [Symbol.asyncDispose]: async () => await cleanup() }); // 异步 disposable
```

同一个资源如果同时提供多种清理方式，优先级是：显式的函数 > `Symbol.asyncDispose` > `Symbol.dispose`。异步（`use()` 安装的）插件的资源清理支持完整的 async disposer；**构造函数同步安装（`useSync`）的插件不支持 async disposer**，见 [§4](#4-插件-core-api-参考)。

`unUse()`/`dispose()` 清理某个插件时，按以下顺序逆序执行：pipeline disposer → 插件自身的 `dispose()`/`Symbol.dispose`/`Symbol.asyncDispose` → 释放 shared key → 通过 `onDispose()` 登记的资源 disposer → 移除已挂载的 extension 属性。任何一步失败都会被收集而不是让后续步骤中断，最终如果有多个失败会聚合成 `AggregateError`。

---

## 11. 完整示例

### 11.1 带配置的插件 + shared 能力组合

```ts
import { PluginHost, type IPlugin } from '@migaia/plugin-host';

type ICore = { write(text: string): void };
type IFormatterConfig = { prefix?: string };
type IFormatterShared = { format: (value: string) => string };

const formatter: IPlugin<ICore, {}, IFormatterConfig, IFormatterShared> = {
  name: 'formatter',
  config: { prefix: '[app]' },
  install: () => ({}),
  shared: (core) => ({
    format: (value: string) => `${core.config.get().prefix} ${value}`
  })
};

const writer: IPlugin<ICore, { log(msg: string): void }> = {
  name: 'writer',
  install: (core) => ({
    log: (msg: string) => core.write(core.getShared<IFormatterShared['format']>('format')!(msg))
  })
};

class Host extends PluginHost<ICore, never> {
  protected createPluginDomainCore(): ICore {
    return { write: (text) => console.log(text) };
  }
}

const host = await new Host().use(formatter, writer);
host.log('server started'); // "[app] server started"

await host.config.update('formatter', () => ({ prefix: '[api]' }));
host.log('request handled'); // "[api] request handled"

await host.dispose();
```

### 11.2 使用 async pipeline 做请求耗时统计

```ts
type IRequest = { path: string; startedAt?: number };

class Host extends PluginHost<{}, IRequest> {
  protected createPluginDomainCore() {
    return {};
  }
  handle(request: IRequest): Promise<void> {
    return this.runPipeline(request, (final) => {
      console.log('handled', final.path);
    }) as Promise<void>;
  }
}

const host = new Host({ pipeline: { mode: 'async' } });
host.useAsyncPipeline(async (value, next) => {
  const startedAt = Date.now();
  await next({ ...value, startedAt });
  console.log(`${value.path} took ${Date.now() - startedAt}ms`);
});

await host.handle({ path: '/users' });
```

---

## 12. 常见问题排查

**Q：`await host.use(plugin)` 卡住不返回。**
检查插件的 `install()` 是否在自己内部同步等待了当前宿主的另一个 `use()`/`unUse()`/`config.update()` 调用——这会形成自等待死锁，见 [§8](#8-生命周期与错误)。打开 `diagnostic` 回调观察是否有排队超时提示。

**Q：插件安装失败，报 `PLUGIN_INSTALL_ROLLBACK_FAILED`。**
说明不仅插件安装本身失败了，回滚清理之前已安装插件时也出错了。`error.cause` 是一个 `AggregateError`，把它的 `errors` 数组打出来能看到具体是哪个环节的清理失败。

**Q：TypeScript 报 extension 方法不存在，但运行时明明有。**
检查该插件是否是"运行期动态安装"（`await host.use(plugin)`）——TypeScript 需要能静态分析到这次 `use()` 调用并把返回值赋值给一个新的变量/重新赋值给 `host`，才能推导出扩展后的类型；如果插件是根据运行时条件动态选择安装的，类型系统无法推导，需要手动标注类型。

**Q：`core.onDispose(asyncFn)` 在构造期插件里直接抛错。**
构造函数同步安装的插件不允许注册 async disposer，见 [§4](#4-插件-core-api-参考)。要么把这个资源的清理逻辑改成同步，要么把这个插件改成运行期通过 `await host.use(plugin)` 安装。

**Q：`config.get()` 读出来的嵌套对象不能修改。**
这是预期行为：配置通过 Readonly 懒代理保护。需要修改配置时，使用 `config.update()` 返回新的 patch，不要直接修改 `get()` 或 `update(next)` 收到的对象。
