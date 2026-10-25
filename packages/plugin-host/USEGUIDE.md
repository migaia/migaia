# `@migaia/plugin-host` 使用指南

[English](./USEGUIDE.en.md) · [定位与快速开始](./README.md)

| 按场景查找                                                                | 入口            | 要确认的行为                |
| ------------------------------------------------------------------------- | --------------- | --------------------------- |
| [安装插件并读取扩展](#安装插件并读取扩展)                                 | `defineHost`    | 成功安装后取得扩展          |
| [批次失败时回滚新资源并保留原有插件](#批次失败时回滚新资源并保留原有插件) | `defineHost`    | 新批次回滚，旧插件保留      |
| [隔离配置与调用者后续修改](#隔离配置与调用者后续修改)                     | `definePlugin`  | 定义快照隔离外部修改        |
| [按取得逆序释放插件资源且只执行一次](#按取得逆序释放插件资源且只执行一次) | `definePlugin`  | 同一释放Promise与逆序资源栈 |
| [不依赖参数顺序，先启动提供方](#不依赖参数顺序先启动提供方)               | `defineFeature` | 拓扑顺序及输出原身份        |
| [缺少提供方时在安装器执行前拒绝](#缺少提供方时在安装器执行前拒绝)         | `defineFeature` | 缺依赖时安装调用为零        |

先安装根入口包；每段都是独立完整场景，与网站同名案例的代码相同。

```bash
pnpm add @migaia/plugin-host
```

共同参数：每例 defineHost 的 host 为必填构造选项；嵌套 execution.mutationTimeoutMs 与 execution.pipelineDrainTimeoutMs 均必填且无默认，分别限制变更执行与 pipeline 排空，本例各设 5000 毫秒，false 表示无限等待。pipeline.mode 未传时为 sync。省略 domainCore 时为空对象；省略自定义 dispose 时使用内核结构化清理。

## 安装插件并读取扩展

应用需要添加具名功能并在之后释放资源，消费者需要安装完成后可用的扩展，而不是尚未初始化完成的插件对象。

直接把插件方法挂到对象上，没有定义何时提交安装、谁负责清理；异步安装尚未完成就返回，还会在资源就绪前暴露方法。

`defineHost` 创建生命周期所有者，等待 `host.use()` 后取得已安装登记；两个执行预算均必填，本例各设为 `5000` 毫秒，没有隐式默认值，使用结束后销毁宿主。

本例 `definePlugin` 的 `name` 为必填非空名称 `greeting`，`install` 必填并返回普通扩展对象；`greet` 是插件自定方法，无运行时参数，返回字符串。`host.use` 接收插件批次，返回句柄顺序与输入一致。

```ts doc-test=run
import { defineHost, definePlugin } from '@migaia/plugin-host'

const host = defineHost({
  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 } }
})
const greeting = definePlugin({
  name: 'greeting',
  install: () => ({ greet: () => '你好' })
})
const [registration] = await host.use(greeting)
console.log(registration.extensions.greet())
await host.dispose()
```

输出：

```text
你好
```

输出 `你好`，登记扩展只在安装 `Promise` 完成后调用，最后一次等待用于等待宿主清理。

宿主句柄拥有宿主操作，插件拥有自己安装的扩展；`mutationTimeoutMs` 限制活动变更，`pipelineDrainTimeoutMs` 限制关闭排空，显式 `false` 去掉对应截止时间，这些限制不会抢占用户 JavaScript。

## 批次失败时回滚新资源并保留原有插件

一组功能安装多个插件，其中一个安装器拒绝配置；此前已安装的功能必须继续可用，本次失败批次里已经创建的资源则必须释放。

每装好一个扩展就立即发布，会在失败后留下半套可见功能；捕获失败后清空整个登记表，又会删除本批次之前已经提交的插件。

`defineHost` 在提交前保留 `use()` 批次的私有状态，在安装期间用 `core.onDispose` 登记草稿资源，再等待 `use(draft, broken)`，观察完成的回滚及原始失败原因。

`use(draft, broken)` 的两个参数为本批插件，既有 `existing` 不属于回滚范围。`core.onDispose(resource)` 的清理函数必填，安装期接管；`original` 是本地预建失败对象，`error.cause === original` 验证原身份。

```ts doc-test=run
import { defineHost, definePlugin } from '@migaia/plugin-host'

const host = defineHost({
  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 } }
})
const released: string[] = []
const [existing] = await host.use(
  definePlugin({
    name: 'existing',
    install: () => ({ read: () => '运行中' })
  })
)
const original = new TypeError('invalid plugin settings')
const draft = definePlugin({
  name: 'draft',
  install: (core) => {
    core.onDispose(() => {
      released.push('草稿')
    })
    return {}
  }
})
const broken = definePlugin({
  name: 'broken',
  install: () => {
    throw original
  }
})
try {
  await host.use(draft, broken)
} catch (error) {
  console.log((error as { code: string }).code, error instanceof Error && error.cause === original)
}
console.log(released.join(','))
console.log(existing.extensions.read())
await host.dispose()
```

输出：

```text
PLUGIN_INSTALL_FAILED true
草稿
运行中
```

逐行输出 `PLUGIN_INSTALL_FAILED true`、`草稿`、`运行中`；包装在 `cause` 保留原始 `TypeError`，失败批次释放草稿资源，原有登记仍可调用。

异步 `use()` 释放失败批次已登记的资源后才拒绝，本例取得一项资源，此前已提交登记继续可用；任意外部副作用不会自动撤销，回滚错误保留在次要详情中。

## 隔离配置与调用者后续修改

插件定义捕获应用设置后，调用者在安装前修改了原设置对象；安装后的配置应反映定义时的快照，而不是后来的外部修改。

浅拷贝只分离最外层对象，嵌套设置仍为共享引用，修改内层限制会悄悄改变后续安装器读到的内容。

`definePlugin` 在创建定义时对接纳的配置数据做快照并递归冻结，传入普通数据记录或数组，宿主随后通过 `config.get(path)` 读取自己的配置。

`config` 可选、默认空配置，本例字段为 `settings.limit: 3`；定义时捕获嵌套对象。`host.config.get(path)` 的必填路径 `meter.settings.limit` 依次选择插件、设置记录和限制值，未知路径返回 undefined。

```ts doc-test=run
import { defineHost, definePlugin } from '@migaia/plugin-host'

const settings = { limit: 3 }
const definition = definePlugin({
  name: 'meter',
  config: { settings },
  install: () => ({})
})
settings.limit = 99
const host = defineHost({
  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 } }
})
await host.use(definition)
console.log(host.config.get('meter.settings.limit'))
console.log(Object.isFrozen(definition.config), Object.isFrozen(definition.config?.settings))
await host.dispose()
```

输出：

```text
3
true true
```

逐行输出 `3`、`true true`；把外部 `settings.limit` 改为 `99` 没有改变安装值，捕获配置的两层对象也均已冻结。

省略 `config` 时使用空配置，这不是 JSON 序列化：支持的函数叶值保留身份，不支持的原型、访问器、符号、类 `Promise` 对象（带可调用 `then` 的对象）与环会被拒绝，已提交配置应通过 `host.config.update()` 修改。

## 按取得逆序释放插件资源且只执行一次

插件按顺序取得资源，需要先释放后取得的资源；多个调用方还可能同时请求关闭宿主，清理不能为每个调用方重复执行。

各自保存清理列表，容易把其中一张表的顺序反过来，或把同一个释放器调用两次；每次关闭请求都启动清理，还会重复释放同一资源。

在 `definePlugin` 的安装期间，`core.onDispose` 把资源交给该登记，`defineHost` 复用同一个销毁 `Promise`，等待它即可观察插件钩子及资源栈的释放。

`core.onDispose` 分别接收两个无参清理函数，`dispose` 是对象定义的可选插件清理 hook；没有 hook 时不执行该步。宿主 `dispose()` 无参数，默认内核共享其清理 Promise，资源按登记逆序释放。

```ts doc-test=run
import { defineHost, definePlugin } from '@migaia/plugin-host'

const host = defineHost({
  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 } }
})
const released: string[] = []
const resource = definePlugin({
  name: 'resource',
  install: (core) => {
    core.onDispose(() => {
      released.push('先取得')
    })
    core.onDispose(() => {
      released.push('后取得')
    })
    return {}
  },
  dispose: () => {
    released.push('插件')
  }
})
await host.use(resource)
const closing = host.dispose()
console.log(host.dispose() === closing)
await closing
console.log(released.join(','))
await host.dispose()
console.log(released.length)
```

输出：

```text
true
插件,后取得,先取得
3
```

逐行输出 `true`、`插件,后取得,先取得`、`3`；并发销毁调用复用同一个销毁 `Promise`，插件钩子先于其资源执行，再次销毁没有新增释放。

`onDispose` 在安装期间接纳资源，不是任意时刻登记清理的接口；宿主收集清理失败，`disposeStepTimeoutMs` 默认每步 `5000` 毫秒，超过预算时应检查 `cleanupComplete` 与 `physicalCompletion`。

## 不依赖参数顺序，先启动提供方

界面发现插件的顺序可能让消费方排在所需提供方之前，但消费方仍需要提供方的同一份输出，而不是重新构造的另一服务。

严格按数组顺序安装，会随发现顺序变化而失败；每个消费方内部重建依赖虽然避开缺值，却产生重复服务状态与不同生命周期。

`defineFeature` 声明同步工厂与依赖别名，`provider.getFeature()` 创建跨插件的必需引用，`host.use()` 校验依赖图并先启动提供方，再解析消费方。

`defineFeature(factory, dependencies?)` 的同步工厂必填，依赖表可选、默认空表；`summary` 的 `cache` 别名指向 `provider.getFeature("cache")`，默认必需。`features` 是插件可选的命名 Feature 表；`use(consumer, provider)` 故意逆序输入。

```ts doc-test=run
import { defineHost, definePlugin, defineFeature } from '@migaia/plugin-host'

const host = defineHost({
  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 } }
})
const order: string[] = []
const output = { read: () => 42 }
let sameOutput = false
const cache = defineFeature(() => {
  order.push('提供方')
  return output
})
const provider = definePlugin({ name: 'provider', features: { cache }, install: () => ({}) })
const summary = defineFeature(
  (_core, dependencies) => {
    order.push('消费方')
    sameOutput = dependencies.cache === output
    return { read: () => dependencies.cache.read() }
  },
  { cache: provider.getFeature('cache') }
)
const consumer = definePlugin({ name: 'consumer', features: { summary }, install: () => ({}) })
const [consumerHandle, providerHandle] = await host.use(consumer, provider)
console.log(order.join(' -> '))
console.log(sameOutput)
console.log(consumerHandle.name, providerHandle.name)
await host.dispose()
```

输出：

```text
提供方 -> 消费方
true
consumer provider
```

逐行输出 `提供方 -> 消费方`、`true`、`consumer provider`；工厂按依赖顺序执行，消费方收到同一输出对象，返回登记句柄仍保持输入顺序。

工厂必须同步返回对象，但其方法可以异步；输出按登记冻结，省略依赖时为空映射，必需引用要求提供方可用，此图安排功能依赖，不追踪响应式数据变化。

## 缺少提供方时在安装器执行前拒绝

一次部署启用了消费插件，却漏掉其必需提供方；宿主应在消费方取得资源之前指出缺失的前置依赖。

安装器内部才查找服务，会在先前初始化已经执行之后才发现问题；继续传递 `undefined` 则把失败转移到无关的消费代码里。

`getFeature()` 返回的引用默认必需，`defineFeature` 保留该依赖，`host.use()` 在安装前检查它，通过计数安装器调用来展示这一接纳边界。

`getFeature("cache")` 的名称必填且必须已声明；未提供 `{ optional: true }`，因此引用必需。`use(consumer)` 不含 provider，预检直接拒绝；`installs` 只在消费方的 install 中增加。

```ts doc-test=run
import { defineHost, definePlugin, defineFeature } from '@migaia/plugin-host'

const host = defineHost({
  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 } }
})
let installs = 0
const cache = defineFeature(() => ({ read: () => 42 }))
const provider = definePlugin({ name: 'provider', features: { cache }, install: () => ({}) })
const summary = defineFeature(
  (_core, dependencies) => ({
    read: () => dependencies.cache.read()
  }),
  { cache: provider.getFeature('cache') }
)
const consumer = definePlugin({
  name: 'consumer',
  features: { summary },
  install: () => {
    installs++
    return {}
  }
})
try {
  await host.use(consumer)
} catch (error) {
  console.log((error as { code: string }).code)
}
console.log(installs)
await host.dispose()
```

输出：

```text
PREREQUISITE_MISSING
0
```

逐行输出 `PREREQUISITE_MISSING`、`0`，缺失提供方被预检直接拒绝，消费安装器没有执行。

仅当消费方明确处理缺席输出 `undefined` 时，才用 `getFeature(name, { optional: true })`；提供方存在时必需和可选引用都参与排序，本例有意使用默认的必需引用。

## 按载荷类型声明多条管道

把数字校验和文本拆分放进不同管道，stage 参数和 next 的值会按名字推断。命名说明在 defineHost 顶层传入；插件只登记步骤，由持有 host handle 的 owner 发起执行。

```ts doc-test=run
import {
  defineHost,
  definePlugin,
  pipelineSpec,
  type IPluginHostCoreFor
} from '@migaia/plugin-host'

const pipelines = {
  count: pipelineSpec<number>()({ mode: 'sync' }),
  text: pipelineSpec<{ text: string }>()({ mode: 'async', next: 'multiple', order: 'reverse' })
}
const host = defineHost({
  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 } },
  pipelines
})
const format = definePlugin({
  name: 'format',
  install(core: IPluginHostCoreFor<typeof host>) {
    core.pipeline('count').use((value, next) => next(value + 1))
    core.pipeline('text').use(async (value, next) => {
      await next({ text: value.text.toUpperCase() })
      await next({ text: value.text.toLowerCase() })
    })
    return {}
  }
})
await host.use(format)
const count = host.pipeline('count').run(1, (value) => value)
const texts: string[] = []
await host.pipeline('text').run({ text: 'Hi' }, (value) => {
  texts.push(value.text)
})
console.log(count, texts.join(','))
await host.unUse('format')
console.log(host.pipeline('count').run(1, (value) => value))
await host.dispose()
```

输出 `2 HI,hi`，然后是 `1`。插件移除同时撤回两条管道上的步骤。`core.pipeline('text')` 没有 run，错误名字或把数字交给 text 的 next 都无法通过类型检查。owner 自行登记用 `host.pipeline(name).use(stage)`，不属于任何插件；执行期间不能登记。

### 显式填写泛型参数

已有代码显式给 defineHost 泛型时，命名轴要放在原四个轴之后。复用说明对象的类型即可：

```ts doc-test=check
import { defineHost, pipelineSpec } from '@migaia/plugin-host'

const pipelines = { count: pipelineSpec<number>()({}) }
const host = defineHost<
  Record<never, never>,
  number,
  readonly [],
  Record<never, never>,
  typeof pipelines
>({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } },
  pipelines
})
host.pipeline('count').use((value, next) => next(value + 1))
await host.dispose()
```

省略 pipelines 的旧泛型用法不需要新增轴。类入口则是 `PluginHost<TDomainCore, TValue, TInstalled, TPipelines>`，通过类构造选项传同一个映射，并从子类的领域方法调用 protected pipeline。

## 契约细节

### 定位、入口与类型轴

本包管理插件安装、Feature 依赖、配置、stage 归属与释放，不实现领域业务，也不重复实现管线执行算法。运行时依赖为 `@migaia/capability`、`@migaia/lifecycle`、`@migaia/middleware-pipeline`、`@migaia/utils`。管线运行和 stage 提升复用 middleware-pipeline；生命周期 scope、变更队列与清理复用 lifecycle。

只有根入口 `@migaia/plugin-host` 与稳定子入口 `@migaia/plugin-host/composition`。不要依赖内部文件。普通应用使用根入口的 Host、插件、Feature、句柄和错误工具；composition 是单一组合 owner 的窄协议，不是另一套应用 Host。

类 `PluginHost<TDomainCore, TValue, TInstalled, TPipelines>` 的首个类型参数 TDomainCore 必须提供；运行时 createPluginDomainCore 的默认实现返回空对象。末尾 TPipelines 轴默认 `Record<never, never>`；pipeline 值类型默认 `never`，安装类型清单默认 `readonly []`；defineHost 的领域类型参数另有默认值。`TInstalled` 参与安装约束和配置推导，运行期 `use()` 不改变 Host 变量的静态类型，而是按输入顺序返回精确句柄 tuple。插件合并、提取等仅类型 helper 以发布声明为准；`IPluginHostCoreFor<THost>` 从 Host 类型提取领域 core 与 pipeline 轴，类型元数据不会安装运行时能力。

扩展点少且不需要动态装卸时，普通选项或组合函数可能足够。只需执行 middleware 时可直接使用 middleware-pipeline；本包适合需要统一插件资源、依赖、配置和可达性的类库或应用。logger 是仓库内采用此宿主的实际消费者。

### 创建 Host 与全部选项

类入口可重写 `createPluginDomainCore()`，每次安装创建一份领域 core。默认返回空对象。领域 core 必须是普通对象、可枚举 data property，不能覆盖 `config`、`onDispose`、`pipeline` 或四个 `use*Pipeline` core 保留成员；无效表面以原生 TypeError / `INVALID_OPTION` 拒绝。

函数入口 `defineHost(options)` 返回冻结的 canonical handle。它提供与类入口相同的功能，并把类上的 protected `useSync`、`runPipeline` 暴露给持有 handle 的 owner。选项 `host` 必填，形状与类构造选项一致；其余字段如下：

| defineHost 字段                 | 默认与含义                                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `domainCore(request)`           | 可选；省略返回空对象。request 的 `pluginName`、从零开始的批内 `batchIndex`、`batch` 身份均由宿主提供 |
| `translateDisposalError(error)` | 可选；省略保留原 PluginHostError；默认结构化结果路径不调用此钩子，也不逐项转换 cleanupErrors         |
| `dispose(next)`                 | 可选；自定义释放中间件，回调自行调用 `next()` 纳入内核清理；重复内核释放仍复用原 Promise             |
| `surface`                       | 可选；默认无领域公开成员，第四类型参数默认空表面                                                     |
| `pipelines`                     | 可选；真实 `pipelineSpec<TPayload>()(config)` 组成的固定命名映射；defineHost 在顶层传入。            |

surface 的自有描述符在获取 Runtime 之前读取一次，访问器保持动态；领域方法、Host 身份、共享出口和 fluent 管线方法属于同一个冻结 handle。canonical Host 键（包括 identity）保留且优先。组合方应在这里提供自己的方法，不能复制返回的冻结 handle。surface 选项或描述符读取失败保持原错，经 `CALLBACK_FAILED` 边界分类。旧三类型参数调用仍有效。

类构造 `options` 必填，defineHost 的 `host` 同样必填：

| 字段                                                | 默认                                  | 行为                                                                |
| --------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------- |
| `identity?: { name?: string }`                      | name 为 `'DEFAULT'`                   | 可读名称可选，宿主另分配唯一 id                                     |
| `execution.mutationTimeoutMs: number \| false`      | 必填，无默认                          | 本次变更 hook 的执行预算；`false` 无期限                            |
| `execution.pipelineDrainTimeoutMs: number \| false` | 必填，无默认                          | pipeline 租约排空预算；`false` 等真实排空                           |
| `pipeline?.mode`                                    | `'sync'`                              | `'sync' \| 'async' \| 'generator' \| 'async-generator'`，构造后固定 |
| `diagnostic(message, code?, error?)`                | 空操作                                | 接收诊断及被包含的原始失败对象                                      |
| `onDiagnosticFailure(error)`                        | 宿主的 globalThis.reportError（若有） | 诊断器自身 throw/reject 的终端出口                                  |
| `scheduler?: IScheduler`                            | 内部 systemScheduler                  | 统一 `now()`、`schedule()` 的时间源                                 |
| `queueAdmissionTimeoutMs?: number \| false`         | `undefined`                           | 默认只诊断；数值表示排队拒绝阈值；false 关闭相关计时与诊断          |
| `queueAdmissionDiagnosticMs?: number \| false`      | `1000`                                | 仅未配置排队拒绝阈值时生效；false 关闭诊断计时器                    |
| `disposeStepTimeoutMs?: number \| false`            | `5000`                                | 单个普通释放步骤的等待预算；false 无期限                            |

所有时间数值须有限、非负；非法选项、非函数回调或不满足 scheduler 协议的对象以 TypeError / `INVALID_OPTION` 拒绝。直接导入 `@migaia/utils/scheduler` 的消费项目需直接安装 utils。

### 定义插件与发布句柄

`definePlugin(name, descriptorFactory, features?)` 只捕获定义。真正安装时同步创建一次 descriptor，再调用其 `install()`、`expose()`、`featureExpose()` hooks；后两者同步返回各自表面。需要配置、setup、更新和释放钩子时使用对象形 `definePlugin(definition)`。两种定义和有效原始描述符走相同准入路径，不在定义时执行安装或 Feature 工厂。名称必填、非空、不能包含 `.`，在 Host 内唯一。对象形定义捕获 own data 字段并冻结；退役的 `shared` 字段不会回退为旧共享行为，应迁移到 Feature，适配器共享出口仍由规范 owner 协议管理。

| 对象定义字段                                                      | 必填 / 默认与作用                                        |
| ----------------------------------------------------------------- | -------------------------------------------------------- |
| `name`、`install(core, setupOutput?)`                             | 必填；install 返回 plain extension record 或 PromiseLike |
| `config`                                                          | 可选；无配置时使用空记录，捕获为宿主拥有的冻结快照       |
| `features`、`featureExpose`                                       | 可选；声明 Feature 根及其可见能力                        |
| `setup(context)`                                                  | 可选，仅对象形；安装前准备，输出保留原身份               |
| `activation`                                                      | 默认 `'eager'`；另一值为 `'lazy'`                        |
| `update(next, core)`                                              | 可选；成功才提交配置，返回值不作为配置                   |
| `onEnable(context)`、`onDisable(context)`                         | 可选；状态提交后的通知，不拥有释放                       |
| `onDependencyReplaced(name, outputs)`                             | 可选；原地换绑已更换的 provider                          |
| `beforeRelease(context)`                                          | 可选；该代已安装注册真正释放前运行一次                   |
| `dispose(context?)`                                               | 可选；插件级清理，支持 PromiseLike                       |
| `[Symbol.dispose]`、`[asyncDisposeKey]` / `[Symbol.asyncDispose]` | 无 dispose 时的清理兜底                                  |

`use(...plugins)` 接收插件批次，按依赖拓扑安装，按原输入顺序返回句柄。`useSync` 不支持即时异步安装：install 的 Promise/thenable 导致 `PLUGIN_INSTALL_FAILED`，cause 为 `INSTALL_RESULT_THENABLE`，后续拒绝仍被观察；即时安装声明 setup 时在任何 hook 前抛顶层 `SETUP_REQUIRES_ASYNC_INSTALL`。构造选项没有 `plugins` 字段；类 owner 在构造期调用受保护的 `useSync(plugins)`，函数 handle 使用 `useSync(...plugins)`。惰性定义可先同步登记，之后异步 activate。

句柄有 `name`、只读 `extensions`、`getFeature(name)` 与 `config.get()/update(recipe)`。句柄按名称找到当前注册，替换后可读到新实现；卸载后访问抛 `PLUGIN_NOT_INSTALLED`。已经取出的 extension 函数绑定原注册，撤销后抛 `REGISTRATION_REVOKED`。`isPluginHandleCurrent(handle)` 检查创建句柄时的那一代是否仍为当前注册；禁用或挂起仍为 true，替换、移除、dispose 或未知对象为 false。名称句柄替换后仍可读取新实现，这个精确代探测不改变该行为。

extension 必须是普通对象。仅可枚举且 configurable 的 data property 发布；访问器和不可配置属性以 `INVALID_OPTION` 拒绝，非枚举键被忽略并报告 `EXTENSION_NON_ENUMERABLE_IGNORED`。不要直接返回冻结对象。Host 协议键、`then`、清理 symbols 是保留键；`catch` 与 `finally` 可用。已有普通扩展冲突为 `EXTENSION_DUPLICATE`，Host 保留键优先为 `EXTENSION_RESERVED`，Object.prototype 成员冲突为 `EXTENSION_OBJECT_PROTOTYPE`。安装路径再用 `PLUGIN_INSTALL_FAILED` 保留 cause；install 结果自带 then 的专门分类为 `INSTALL_RESULT_THENABLE`。

### 插件 core、setup 与资源归属

安装与更新 core 包含领域能力，以及 `config.get()`、`operation`、`lifecycle`、`features`、`featureExpose`、`onDispose(resource)` 、`pipeline(name)` 和四个 `use*Pipeline(stage)`。config 返回已提交的递归只读快照；operation 提供当前操作 `signal` 与绝对 `deadlineAt`，lifecycle 提供注册代际的 signal。stage 注册方法返回同一 core，只允许安装窗口使用，且受模式兼容约束。

`core.onDispose` 只在安装窗口接管资源；窗口外抛 `RESOURCE_OUTSIDE_INSTALL`，不会接管或释放新传入的资源，调用方仍负责它。资源可为清理函数、同步 disposable 或异步 disposable，PromiseLike 结果由生命周期 owner 同化。同步安装也能登记异步 disposer。

对象形 setup 的执行顺序是：创建领域 core → setup → featureExpose → 同步 Feature 工厂 → install。同一批次按依赖顺序串行。setup 仅得到 `config.get()`、`operation.{signal,deadlineAt,now()}`、`lifecycle.signal`、`onDispose(resource)`，没有 Feature 输出、pipeline 或 Host mutation 能力。setup 输出不克隆，原样作为 featureExpose 与 install 的第二参数；未声明 setup 时这两个 hook 仍只有一个 core 参数。

setup 与后续 install 共用本注册的 mutation 绝对期限；无期限时 deadlineAt 为 undefined，now 使用注入 scheduler 时钟。成功只关闭 setup 登记窗口，不中止 operation signal。期限到达或 Host 关闭时取消尝试并回滚已登记资源；永不兑现的 setup 不阻止关闭。迟到兑现不再安装，迟到拒绝经诊断报告；协作取消若回显同一 abort reason 不重复报告。

关闭后的 setup `context.onDispose` 会先尝试释放有效资源，再抛 `RESOURCE_OUTSIDE_INSTALL`；无有效 disposer 则为 `INVALID_OPTION`。这与 core 的窗口外资源责任不同。异步 use、replace 候选及组合预备的 setup 失败用 `PLUGIN_INSTALL_FAILED` 保留原 cause；lazy activate 保留原失败身份。恢复失败诊断只解开一层 PLUGIN_INSTALL_FAILED 包装，不剥离其他原错误的 cause。

### Feature 与依赖

`defineFeature(factory, dependencies?)` 或 `defineFeature({ install, dependencies? })` 创建同步的 opaque 定义，依赖默认空表。factory 的 `core.featureExpose` 是本插件显式提供的能力，第二参数只含声明的直接依赖别名。工厂不能返回 PromiseLike，但返回对象的方法可以异步。定义与引用靠本包身份存储验证，类型上的 `__feature` 不是真实运行时授权字段。

`definition.getFeature(name)` 只接受已声明的名称，默认是必需引用；`getFeature(name, { optional: true })` 声明可选引用，provider 缺席或尚未激活时输出可为 undefined；provider 已禁用仍抛 PREREQUISITE_DISABLED。`handle.getFeature(name)` 返回本次实例输出。引用保留 provider 名字字面量，`IPluginFeatureName`、`IPluginFeatureOutput` 可提取名称与输出。

Host 在任何 install 前检查必需 provider 和环，按依赖拓扑安装，不依赖 use 的输入顺序；消费者得到 provider 输出的原对象身份，实例输出按注册冻结。缓存的普通输出对象或纯函数不会自动附加撤销守卫；活性检查发生在 handle 读取、extension callable 和受保护的 featureExpose 入口。Feature 的本地依赖闭包也计入跨插件关系。缺失、禁用、移除分别为 `PREREQUISITE_MISSING`、`PREREQUISITE_DISABLED`、`PREREQUISITE_REMOVED`，环为 `DEPENDENCY_CYCLE`，这些前置条件码直接在顶层，不包安装失败。

`readPluginDependencies(input)` 返回只读 `{ provider, required }` 列表，遍历本地完整闭包，按首次 provider 引用排序，同一 provider 必需优先。它接收定义、有效原始描述符或 composition admission；admission 复用已捕获快照，不重读 getter，其他输入经标准准入捕获一次。它不执行 setup、install 或工厂，准入失败的原生类型、错误对象和 stack 原样保留。

### 配置与事务提交

`host.config` 重复访问保持同一 facade。get 的 path 必填，可为插件名、`插件名.键` 或 `插件名.[下标].键`，支持继续深入；不存在的插件或路径返回 undefined。`config.update(name, recipe)` 的名称与 recipe 必填；recipe 同步返回 partial plain record，插件不存在时以 `PLUGIN_NOT_INSTALLED` 拒绝。handle.config 在插件范围内提供同样的 get 与 update。

初始配置被复制并递归冻结；普通对象、数组及受支持的原始值可用，函数值保留身份，因此不是 JSON 序列化契约。Date、RegExp、Map、Set、类实例、访问器、非枚举嵌套属性、symbol 键和值、危险键 `__proto__/constructor/prototype`、可调用 then 以及循环被拒绝。无环共享引用不等于循环。非法值为 `INVALID_CONFIG_VALUE`，循环为 `CONFIG_CYCLE_REJECTED`，detail 带 path 和 reason。修改冻结快照遵循 JS 原生行为，不Promise本包错误码。

update 对 patch 执行 Copy-on-Write：新分支复制并冻结，未改分支复用旧快照。插件 update(next, core) 读取候选完整 next，而 core.config.get() 仍是旧的已提交配置；成功才提交。recipe、patch 准入、update hook 或期限失败都不提交，不改变既有配置、revision 与已发布扩展。未分类回调失败经 `CALLBACK_FAILED` 边界，保留原错或 cause；合法 PromiseLike 生命周期结果只同化一次。

get 与 update 都要求 active Host。通常 get 的入口失败同步抛出，update 在内部队列任务失败时 reject；setup/beforeRelease 窗口的同步禁止规则另见下节。

### 禁用、依赖策略、替换与惰性激活

`await host.plugin.disable(name)` 返回 `{ token }`；`await token.enable()` 精确恢复原注册，`host.plugin.enable(name)` 按名启用，`disabled()` 返回当前名称只读快照。禁用保留资源与 scope，不调用 disposer；extension、Feature 和 stage 暂不可达，配置仍可读取和更新。安装成功先通知一次 onEnable，之后每次真实状态切换通知对应 hook；通知失败仅诊断，不回滚状态。provider 仍禁用时不能单独启用依赖者，token 先检查整组，失败不部分启用。

disable 与 unUse 的选项是 `{ policy?: 'reject' | 'cascade' | 'suspend'; dryRun?: boolean }`，默认 policy 为 reject、dryRun 为 false。reject 保留状态并用 DEPENDENCY_BLOCKED 的 detail.blockedBy 列出全部传递依赖者；cascade 连同必需依赖闭包处理；suspend 只处理目标，保留已激活依赖者的实例与资源。挂起时句柄及取出的 extension 抛 `PLUGIN_SUSPENDED`，stage 不运行。同一 provider 重新启用可直接恢复；同名新 provider 按 capability 的 resume 计划换绑、重启或恢复。整图释放仍按依赖者优先处理挂起注册。

`dryRun: true` 返回冻结计划 `{ policy, order, steps, edges }`，不含 ok，不执行变更。真实 unUse 的成功与失败分支均带冻结 `affected`，只含已生效步骤；失败还返回 errors。**迁移**：严格比较旧 `{ ok: true }` 的调用方应改为检查 ok 并读取 affected；宽 boolean 先按值分支，字面量 dryRun true 选择计划重载，省略或 false 选择执行重载。旧 `{ cascade: true }` 以 INVALID_OPTION 拒绝。

replace(name, next) 要求同名，先安装候选，失败时旧实现继续服务。提交后新运行只含新代 stage，旧运行保留旧代租约，旧 extension 立即撤销，名称句柄指向新代；原禁用状态保留。已激活必需依赖者可用 onDependencyReplaced 换绑；缺钩子或钩子失败则连同必需闭包按依赖者优先排空释放，再按拓扑重装，保留运行时配置、原激活与禁用状态。旧代排空后释放。重装失败不撤回新 provider，失败依赖者保持卸载，抛 DEPENDENT_RESTART_FAILED，cause 为 AggregateError，顺序为重装失败、换绑错误、清理错误，detail.dependents 列出影响。清理次错经诊断保留。

lazy 插件 use 时只登记；扩展访问抛 PLUGIN_NOT_ACTIVATED。activate(name) 先激活必需惰性 provider，再安装自身；同名并发共享同一 Promise。非惰性安装也会先激活所需惰性 provider；只被惰性成员引用的惰性项不提前安装，依赖校验失败不激活。禁用项 activate 抛 PLUGIN_DISABLED。失败撤销尝试的 stage、extension 和共享 receipt，清理资源，保留 cold registration/handle；显式重试使用新 scope 与新 batch core。清理次错不覆盖主错，物理迟到工作继续被观察。

### 变更队列与重入边界

use、unUse、config.update 等变更共享 lifecycle 的 FIFO mutation 队列。默认排队超过 1000 ms 仅诊断且不带 code；显式 queueAdmissionTimeoutMs 数值才移出超时排队项并以 MUTATION_QUEUE_TIMEOUT 拒绝，已经运行的任务不受该准入计时器中断，后续 Host 仍可用。false 关闭计时器与诊断。dispose 以不受排队拒绝驱逐的终态任务进入队列。

生命周期 hook（含 setup、install、Feature/expose、update、beforeRelease、dispose、启停通知及换绑）禁止重入 Host mutation，失败为 `LIFECYCLE_MUTATION`。use/unUse/replace/config.update 的入口守卫可同步抛错，异步 enablement 入口则以 Promise 拒绝。setup 或 beforeRelease 整个等待窗口内，新变更也按对应入口形式拒绝；窗口前已入队任务仍 FIFO 等待，可能受到已配置的准入超时。

同步 hook 内 activate 在查共享请求前拒绝；但运行时无异步上下文，hook await 之后的同名 activate 与外部调用一样可能共享本次 Promise。等待自己的激活会自等待：有限 mutationTimeoutMs 最终以 MUTATION_EXECUTION_TIMEOUT 回滚，false 关闭期限时可能不结束。应在 hook 外发起激活。

### 命名管道：类型、权限与生命周期

在函数入口的顶层 `pipelines`，或类构造选项的 `pipelines`，声明一个固定的“名字 → `pipelineSpec<TPayload>()(config)`”映射。每条管道独立推断载荷和 mode；名字是非空的自有可枚举字符串键，值必须来自真实 `pipelineSpec`，不能用结构相同的普通对象替代。说明对象被冻结；构造后不再增删管道。

| config 字段 | 默认        | 取值与作用                                                                            |
| ----------- | ----------- | ------------------------------------------------------------------------------------- |
| `mode`      | `'sync'`    | `'sync'`、`'async'`、`'generator'`、`'async-generator'`；决定 stage 及 run 返回类型。 |
| `next`      | `'single'`  | `'single'` 或 `'multiple'`；直接采用 middleware-pipeline 的四模式继续及失败规则。     |
| `order`     | `'install'` | `'install'` 按分配顺序，`'reverse'` 按其逆序；同一插件在所有管道共享原排序 slot。     |

持有函数 handle 的 owner 调用 `host.pipeline(name).use(stage)` 或 `.run(value, done)`；类 owner 使用 protected `pipeline(name)`。安装中的插件 core 只得到 `core.pipeline(name).use(stage)`，没有 run 执行权；用 `IPluginHostCoreFor<typeof host>` 派生该 core 类型，无需重复编写载荷映射。未声明的名字在类型检查时拒绝；绕过类型检查时同步抛 `PIPELINE_UNKNOWN`。

sync、generator 的命名 run 返回 `TResult | undefined`；async、async-generator 返回 `Promise<Awaited<TResult> | undefined>`。短路返回 undefined，每次到达末端的遍历各调用一次 done。multiple 不返回结果数组；需要每次结果时，在 done 中明确收集。async 分支错误在被 next 的 then/await 观察后由 stage 处理；未观察的失败仍由 runner 拒绝，多个原错按启动顺序保留在 `MULTIPLE_DOWNSTREAM_FAILED` 中。generator 用 throw 把失败交回 yield；sync 遍历全部登记值后汇总错误。

所有管道在同一 Host 事务中提交；每条管道在同一可见 stage 修订内复用编译快照，reverse 也只在编译时处理。没有可见 stage 时直接调用终点，不取快照或 lease。有 stage 时，所有管道复用同一套登记、排序和 quiescence/lease owner。安装失败回滚、unUse、replace、禁用和挂起在一次提交中作用于该插件的全部管道；已有运行持有原快照和分管道的代际 lease，drain 等待这些实际运行，清理和排空预算仍由既有生命周期配置控制。任何管道执行期间，owner 向任一管道注册 stage 都会抛 `PIPELINE_EXECUTING`。

不传 pipelines 时，命名类型轴默认为 `Record<never, never>`，没有额外命名 runner、lane 或 lease key。原 `TValue`、`pipeline.mode`、四个 use*Pipeline、runPipeline/runPipelineSync/runPipelineAsync、pipelineMode 都只操作默认管道，原有显式泛型调用不变。默认管道使用内部 symbol，不占用任何字符串名字。显式填写 defineHost 泛型并同时声明命名管道时，要在第五个泛型参数传 `typeof pipelines`；省略它会保留空轴，pipeline(name) 只接受 never。

非法 map、名字、spec、order 以原生 TypeError / `INVALID_PIPELINE_OPTION` 在构造时拒绝，不返回 handle；mode 非法仍是 `INVALID_PIPELINE_MODE`。next 非法的外层码为 `INVALID_PIPELINE_OPTION`，cause 保留 middleware-pipeline 的 TypeError / `INVALID_OPTION`。spec 配置 getter 抛错时也以 `INVALID_PIPELINE_OPTION` 保留原 cause。

### Pipeline：模式、快照与取消

Host 侧四个注册方法返回 this，插件 core 的同名方法返回 core。兼容关系如下，不能提升时同步抛 PIPELINE_MODE_MISMATCH，cause 保留上游 middleware-pipeline TypeError / INVALID_OPTION：

| 注册方法                           | 允许的 Host mode                           |
| ---------------------------------- | ------------------------------------------ |
| `usePipeline(stage)`               | sync / async / generator / async-generator |
| `useAsyncPipeline(stage)`          | async                                      |
| `useGeneratorPipeline(stage)`      | generator / async-generator                |
| `useAsyncGeneratorPipeline(stage)` | async-generator                            |

默认管道由 class owner 从领域入口调用 protected runPipeline(value, done)，函数 handle 直接调用；value 与 done 必填，done 接收终值。sync 的 next 只记录值，当前 stage 返回后才执行下游；async 首次 next 立即启动下游，await next 可写下游完成后的后置逻辑。不调用 next 是正常短路，done 不执行但调用可正常完成。默认 single 策略下重复 next 为 PIPELINE_NEXT_DUPLICATE，迟到 next 被忽略并诊断 PIPELINE_NEXT_LATE。

默认 single 策略下，generator 与 async-generator 都先耗尽当前 stage，普通返回值交给下一步；隐式 undefined 或 GENERATOR_HALT 终止，GENERATOR_CONTINUE 采用最后 yield（零 yield 用输入），GENERATOR_UNDEFINED 才把业务 undefined 继续交付，类型必须允许它。async-generator 串行 await，不是流式 fan-out 或洋葱模式。模式、stage 类型与这三个唯一 symbol 从 middleware-pipeline 直接导入，消费项目应直接安装该包。

执行中（含外层尚未结束的嵌套调用）注册新 stage 抛 PIPELINE_EXECUTING。每次运行捕获已准入 stage；slot 按首次分配顺序与 Host stage 排列，禁用、恢复、替换不重排。新运行不再取得已撤销代，旧运行用自己的 lease 完成或协作退出。

四种 stage 的最后参数都有 context（generator 是第二参数），context.signal 是 Host 生命周期信号。dispose 开始时 abort，外部 I/O 仍需 stage 自己消费 signal；runner 在进入、返回、next 等协作检查点以 HOST_DISPOSING 或 HOST_DISPOSED 中止，不Promise强行取消任意 Promise。signal.reason 与稍后准入错误可同码但不保证同一对象。普通业务失败优先于同时取消；单个普通失败保留原对象。async 的 stage 与下游双失败为 AggregateError / PIPELINE_FAILED，errors 固定 [stageError, downstreamError]；async-generator 串行路径无此双帧聚合，factory/body/done 的单失败原样传播。

### beforeRelease、卸载与物理完成

已安装注册释放前最多运行一次 beforeRelease(context)；普通卸载的钩子期间，该代仍可服务已有调用。context.signal 属于注册生命周期，deadlineAt 与 remainingMs() 使用 Host 时钟和 disposeStepTimeoutMs；禁用、挂起和未激活 lazy 登记本身不触发此钩子。失败或超时收集为清理错误，卸载不回滚。定义迁移：旧非函数 beforeRelease 元数据现在以 TypeError / INVALID_OPTION 拒绝。

之后撤销注册与 stage 的新准入，排空相关 lease，执行插件 disposer，再逆序释放所登记资源。普通 unUse/dispose 使用 disposeStepTimeoutMs 的步骤预算，超时以 DISPOSE_STEP_TIMEOUT 结束等待并继续其余步骤，不会取消仍执行的 Promise。自定义 disposer 等待触发自身的 host.dispose 会形成自等待；有限步骤预算可让逻辑关闭继续，false 则无限等待。

unUse 返回 `{ ok: true, affected }` 或 `{ ok: false, errors, affected }`；排空到限记录 PIPELINE_DRAIN_TIMEOUT，仍继续有界清理。默认内核 dispose 重复调用及同步重入复用同一 Promise，返回 logicalTerminal、cleanupErrors、cleanupComplete 和可能的 physicalCompletion，不因清理错误重开 Host。**defineHost 自定义 options.dispose 中间件可 throw/reject**，此时该失败被分类并拒绝同一个记忆化 Promise；不能把内核的结果契约扩展为任意自定义回调绝不拒绝。

cleanupComplete false 不代表资源已释放。cleanupErrors 是当前快照，physicalCompletion 只提供之后新增的错误，可能继续带下一层 continuation；需要完整最终结果可使用 lifecycle 的 mergeCleanupResults([result])，直接导入时直接安装 lifecycle。有限预算不终止在途 lease 或 disposer，迟到错误仍被观察。

资源函数直接执行；资源对象优先选择异步 disposer，再同步 disposer。插件自有 dispose 优先，其次符号清理。asyncDisposeKey 在宿主有 Symbol.asyncDispose 时复用原生键，否则使用 fallback；同步资源使用原生 Symbol.dispose 或普通函数，不强制 polyfill。

### composition 与托管适配

`isManagedHost(value)` 探测本物理包实例构造的 Host；`openComposition(host)` 只接受这种身份，不接受伪造对象或另一份包副本的实例。身份登记 writer 不公开，defineHost 不接受 receiver 别名。

composition owner 可读取 revision/getCurrentSnapshot()，通过 createPluginAdmission 捕获定义、createDataOrderSlot(name) 保留 opaque 排序槽，再 prepareAdmissions([{ admission, slot }])。setup 可在准备期执行，但 extension、config、Feature、stage 暂不公开。commitPreparedAdmissions 同步发布、不执行用户代码，revision 已变化则拒绝；discardPreparedAdmissions 对暂存资源只回滚一次。返回 registration token 精确指向那次安装，不按名称误删新代。

createDataOrderSlot 调用即保留顺序；禁用、恢复和 replace 沿用 slot。只有定义永久删除或 session 结束才 retireDataOrderSlot。prepareUnUseBatch 按 owner 的清理顺序接收 exact tokens；commitPreparedUnUseBatch(prepared, { beforeCleanup? }) 先逻辑撤销，再等待 fence 和该代 pipeline lease。beforeCleanup 可选，无默认 Promise，但提供时始终先完成。

托管清理使用必填 execution.pipelineDrainTimeoutMs：数值是本批次 lease 与全部清理步骤共享的预算，耗尽继续后续步骤，即使普通 disposeStepTimeoutMs 为 false；显式 pipelineDrainTimeoutMs false 才逐项等待真实完成并绕过普通步骤预算。预算不撤销进行中的工作；要真实释放，应观察全部 physicalCompletion，或由拥有 realm 的外层终止其实际执行环境。

`createView(token)` 返回只含该 exact registration 的 extensions 的窄 view，无 Host、config、shared 或 mutation 能力。相同 token 的函数引用稳定，receiver 为 concrete Host。token view 禁用期间仍有效，完整 Host view 此时拒绝；启用恢复原函数引用，卸载两者均撤销。foreign/撤销 token 失败关闭。迁移：旧根 createRegistrationView 与 IPluginRegistrationReceipt 已移除，使用 composition createView/IRegistrationToken。

`inspectFeatures(roots)` 从 composition 入口只读检查可信 Feature 拓扑，不运行工厂。

适配器的 `getPluginRuntimeIntegration(core)` 只接受 canonical 本包 core，负责已声明的共享出口、Feature 与注册生命周期对接；不是给普通插件绕过准入的 API。同 family 规范贡献才可共享槽，普通扩展或其他 family 不可占用。不可扩展 Host 新共享 getter 发布失败保持原生 TypeError / PLUGIN_INSTALL_FAILED，不残留失败 family，普通 handle 扩展仍遵守既有不可扩展 Host 契约。

### 错误、诊断与状态

PluginHostError 继承 Error，携带只读 source、code、可选 detail；source 为 `plugin.host`，原始失败通过 cause/errors 可达。可写 native 回调错误原位附身份，不可写或非 Error 值保留在 cause，完整外包身份保留原 owner。INVALID_OPTION 形状错误保留 TypeError；配置值与循环错误是 PluginHostError。不要仅按类名处理所有错误，也不要解析诊断文案。

安装主错不被回滚失败覆盖。PLUGIN_INSTALL_FAILED.detail 包含 failedName、按回滚顺序的 rollbackErrors；异步 use 的 detail 已完成且冻结，同步 useSync 先公布冻结快照，通过 detail.completion 返回最终冻结详情。需要完整次错身份的转换应先 await completion。回滚失败另报 PLUGIN_INSTALL_ROLLBACK_FAILED。

diagnostic 的第三参数保留原失败身份；诊断回调自身失败不会改变 Host 控制流，而交给 onDiagnosticFailure，再失败或省略时交给宿主存在的 globalThis.reportError。Node 需要这类观测时显式提供 onDiagnosticFailure。PluginHostStatus 为 active/closing/disposed；PluginHostRegistrationLifecycle 为 idle/install/dispose。ERROR_TEXT 是根命名导出的稳定英文消息表，MiddlewarePipelineMode/Violation 属于 middleware-pipeline。

`PluginHostDisposalNodeKind` 区分清理错误、聚合及 disposer 包装；`readPluginHostDisposalProvenance(error)` 只读取本物理包登记的追溯信息，未知错误或重复包副本返回 undefined，不按形状猜测。它用于诊断，不替代 source/code/cause 分类。

| code                               | 含义与处置                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| `HOST_DISPOSED`                    | 宿主已终态，创建新 Host，不能复用。                                                               |
| `HOST_DISPOSING`                   | 宿主正在关闭，不能开始新变更。                                                                    |
| `PLUGIN_DUPLICATE`                 | 同一名称已占用或在批次中重复。                                                                    |
| `PLUGIN_NOT_INSTALLED`             | 目标名称不存在，或句柄已无对应安装。                                                              |
| `PLUGIN_DISABLED`                  | 插件禁用中，先恢复再调用。                                                                        |
| `PLUGIN_SUSPENDED`                 | 必需 provider 不可用使插件挂起，先恢复依赖。                                                      |
| `PLUGIN_NOT_ACTIVATED`             | lazy 插件未激活，先 await activate。                                                              |
| `FEATURE_NOT_DECLARED`             | 请求了未声明的 Feature 名称。                                                                     |
| `PREREQUISITE_MISSING`             | 必需 provider 从未安装，安装前直接拒绝。                                                          |
| `PREREQUISITE_DISABLED`            | 必需 provider 已禁用，启用后重试。                                                                |
| `PREREQUISITE_REMOVED`             | 必需 provider 已卸载，需要重新安装。                                                              |
| `DEPENDENCY_CYCLE`                 | Feature 跨插件引用成环，任何 install 前拒绝。                                                     |
| `DEPENDENCY_BLOCKED`               | 变更会遗留必需依赖者，detail.blockedBy 列出传递闭包。                                             |
| `REPLACE_NAME_MISMATCH`            | 替换候选名称不同，未安装候选。                                                                    |
| `DEPENDENT_RESTART_FAILED`         | 新 provider 已提交但依赖者重装失败，cause.errors 首项为重装失败。                                 |
| `PLUGIN_DEFINITION_INVALID`        | 退役或不支持的定义字段、非法依赖或非 canonical core，保留 TypeError。                             |
| `PLUGIN_INSTALL_FAILED`            | 安装/发布失败，原错在 cause，回滚详情保留次错。                                                   |
| `SETUP_REQUIRES_ASYNC_INSTALL`     | 即时 useSync 安装遇到 setup，改用异步 use。                                                       |
| `PLUGIN_INSTALL_ROLLBACK_FAILED`   | 仅诊断：回滚也失败，不替换原安装主错。                                                            |
| `INSTALL_RESULT_THENABLE`          | install 结果自带 then，或同步路径得到异步结果，不发布此扩展。                                     |
| `PLUGIN_DISPOSE_FAILED`            | beforeRelease 或插件释放步骤失败，cause 保留原错，其余清理继续。                                  |
| `EXTENSION_DUPLICATE`              | 扩展键已占用，Host 保留键优先分类为 EXTENSION_RESERVED。                                          |
| `EXTENSION_OBJECT_PROTOTYPE`       | 扩展键命中 Object.prototype。                                                                     |
| `EXTENSION_RESERVED`               | 扩展使用 Host 协议键、then 或清理 symbol。                                                        |
| `EXTENSION_NON_ENUMERABLE_IGNORED` | 仅诊断：有意忽略非枚举扩展键。                                                                    |
| `RESOURCE_OUTSIDE_INSTALL`         | core 在安装窗口外拒绝且不接管；setup 关闭后的有效资源先释放再拒绝。                               |
| `LIFECYCLE_MUTATION`               | 生命周期同步重入，或 setup / beforeRelease 等待期发起变更，不能执行。                             |
| `INVALID_PIPELINE_MODE`            | 构造时 mode 非四种合法值。                                                                        |
| `INVALID_PIPELINE_OPTION`          | 命名 map、名字、spec、next 或 order 非法；构造时同步抛原生 TypeError，已有上游失败由 cause 保留。 |
| `PIPELINE_UNKNOWN`                 | 查询的名字没有声明；修正查询或构造时的映射。                                                      |
| `ASYNC_STAGE_IN_SYNC_ENTRY`        | 默认同步入口遇到可见 async stage；任何 stage 或终点执行前拒绝。                                   |
| `PIPELINE_MODE_MISMATCH`           | stage 无法提升到 Host 模式，cause 保留上游 TypeError。                                            |
| `PIPELINE_NEXT_DUPLICATE`          | 同次 stage 重复调用 next，不重复派发。                                                            |
| `PIPELINE_NEXT_LATE`               | 仅诊断：stage 已结束后调用 next，忽略此调用。                                                     |
| `PIPELINE_EXECUTING`               | 管线执行期间注册新 stage。                                                                        |
| `PIPELINE_FAILED`                  | async 双失败，AggregateError.errors 固定为 stage、downstream。                                    |
| `MUTATION_QUEUE_TIMEOUT`           | 已配置准入期限且排队到限，任务移出并不再执行。                                                    |
| `DISPOSE_STEP_TIMEOUT`             | beforeRelease 或普通释放步骤超预算，结束等待并继续清理，不强行取消。                              |
| `INVALID_OPTION`                   | 入参形状不合法，保留原生 TypeError，修正输入。                                                    |
| `INVALID_CONFIG_VALUE`             | 配置不满足普通数据语法，detail 含 path/reason。                                                   |
| `CONFIG_CYCLE_REJECTED`            | 配置含引用环，提供无环值图。                                                                      |
| `CALLBACK_FAILED`                  | 未分类配置、surface 读取或 defineHost disposal 回调失败；保留原错或 cause。                       |
| `MUTATION_EXECUTION_TIMEOUT`       | hook 执行到限，丧失提交权限，迟到结果不能提交。                                                   |
| `REGISTRATION_REVOKED`             | 已取出的扩展属于已卸载或替换的旧注册。                                                            |
| `PIPELINE_DRAIN_TIMEOUT`           | 普通卸载排空超预算，ok false，继续有界清理并诊断。                                                |
| `CLEANUP_INCOMPLETE`               | 逻辑关闭已提交，清理有错或仍未完成；读取结果与 continuation。                                     |
| `COMPOSITION_TARGET_UNMANAGED`     | 组合目标非本物理包登记的 Host，不做结构兼容。                                                     |

### 支持环境与维护

产物语法基线为 ES2020，运行时需 Promise、Map、Symbol、AggregateError 等原生能力；可用于 Node、Bun、Deno、Worker、小程序及 Electron 主/渲染进程，不绑定具体框架。在 Chrome 85+、Edge 85+、Firefox 79+、Opera 71+、Safari 14+ 等浏览器使用时，也须具备所需的原生 API。可选清理 symbols 采用前述 fallback。

现有包脚本如下；test 先检查 dist 新鲜度，需要时构建本包再运行 Vitest，不应把未执行的结果当作通过。

```bash
pnpm --filter @migaia/plugin-host run fmt
pnpm --filter @migaia/plugin-host run lint
pnpm --filter @migaia/plugin-host run typecheck
pnpm --filter @migaia/plugin-host run typecheck:test
pnpm --filter @migaia/plugin-host run test
```

安装不返回时区分排队等待、hook 执行和自身激活等待；配置变更失败先读 code/cause，旧配置不变；句柄方法类型不出现时从 use 返回 tuple 取 handle.extensions；释放未完成时检查清理结果和 continuation，而不是把逻辑终态当作物理结束。

## 同一列表的两个执行入口

同步/异步宿主的拥有者可在 `defineHost` 句柄调用 `runPipelineSync(value, terminal)` 或 `runPipelineAsync(value, terminal)`；子类使用同名 protected 入口。两者共用登记列表、顺序和生命周期租约，同步 stage 在两边执行。存在可见异步 stage 时，同步入口在任何 stage 或终点执行前抛 `ASYNC_STAGE_IN_SYNC_ENTRY`；卸载或禁用该 stage 后恢复同步执行。

同步入口返回 `TResult | undefined`；异步入口接受返回 `Promise<TResult>` 的终点，返回 `Promise<TResult | undefined>`。stage 不调用 next 时以 undefined 停止。零 stage 直接调用终点，保留原值或 Promise 身份；非空异步管线等待真实终点结束再清理。生成器宿主继续使用 `runPipeline`，显式同步/异步入口以 `PIPELINE_MODE_MISMATCH` 拒绝该模式。

`getPluginRuntimeIntegration(core).assertPreparedRegistration()` 仅检查原注册：当前安装沿原 operation 准入；同一尚未发布批次已完成的候选沿原 batch 精确身份与当前安装检查；发布后沿原 handle 准入。回滚、移除或宿主关闭后拒绝，不返回注册对象，也不授予晚注册资源或安装权限。`assertCurrent()` 与 `core.config.get()` 的原有语义不变。
