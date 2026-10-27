# `@migaia/plugin-host`

[English](./README.en.md)

把插件安装、依赖、配置和资源释放交给一个运行时中立的宿主，让类库或应用在功能扩展后仍有明确的提交与退出边界。

## 你可能遇到过

- 安装一半失败却留下可调用扩展，根因是逐个发布而没有整个批次的提交与回滚边界。
- 外部改了一层嵌套设置，插件行为就变了，根因是宿主还持有调用者的配置引用。
- 关闭宿主时重复释放或顺序颠倒，根因是插件与资源各自管理清理列表。
- 换一个插件发现顺序就启动失败，根因是按参数顺序安装，没有表达提供方依赖。
- 缺了必需服务还先打开连接，根因是依赖检查放在安装器内部才进行。

## 为什么选它

- **批次失败只撤销本次新资源。** 逐个公开扩展容易留下半套功能，defineHost 把本批提交与回滚放在同一边界，原有插件继续可用。[运行证明](./USEGUIDE.md#批次失败时回滚新资源并保留原有插件)。
- **配置由宿主持有，外部修改不会悄悄生效。** 浅拷贝仍共享嵌套对象，definePlugin 复制并递归冻结准入配置；后续变更走 config.update。[运行证明](./USEGUIDE.md#隔离配置与调用者后续修改)。
- **资源按取得逆序释放，重复关闭复用同一 Promise。** 多份手写清理表容易顺序错误或重复释放，安装期间用 onDispose 登记资源，再由宿主统一释放。[运行证明](./USEGUIDE.md#按取得逆序释放插件资源且只执行一次)。
- **插件顺序由声明的能力依赖决定。** 按发现顺序安装会先运行消费者，Feature 引用让提供方先建，并把同一输出注入消费者。[运行证明](./USEGUIDE.md#不依赖参数顺序先启动提供方)。
- **缺少必需能力时，安装器还没有开始。** 在安装器里临时查服务会留下已取得资源，Feature 依赖预检先拒绝缺失 provider，再决定是否进入安装。[运行证明](./USEGUIDE.md#缺少提供方时在安装器执行前拒绝)。

## 从这里开始

问候功能已经在线。这时上线一批新功能：缓存插件先建好了连接，翻译插件却安装失败。宿主撤销这一整批：缓存连接被释放，问候功能照常响应。

```ts doc-test=run
import { defineHost, definePlugin } from '@migaia/plugin-host'

const host = defineHost()
const [greeting] = await host.use(
  definePlugin({ name: 'greeting', install: () => ({ greet: () => '你好' }) })
)

const cache = definePlugin({
  name: 'cache',
  install: (core) => {
    core.onDispose(() => console.log('缓存连接已释放'))
    return {}
  }
})
const translator = definePlugin({
  name: 'translator',
  install: () => {
    throw new Error('词典加载失败')
  }
})
await host.use(cache, translator).catch((error) => console.log(`新功能安装失败：${error.code}`))
console.log(greeting.extensions.greet())
await host.dispose()
```

输出：

```text
缓存连接已释放
新功能安装失败：PLUGIN_INSTALL_FAILED
你好
```

`use()` 按传入顺序返回句柄，`greeting.extensions` 就是 install 返回的方法。每个安装、更新或卸载 hook 默认最多等 5000 毫秒，超时回滚；卸载时等待在途 pipeline 排空也默认最多 5000 毫秒。需要更长期限或不设期限时，在 `defineHost({ host: { execution } })` 中覆盖，见[全部选项](#创建-host-与全部选项)。

遇到批次失败，看[保留原插件并回滚新资源](./USEGUIDE.md#批次失败时回滚新资源并保留原有插件)；遇到插件顺序问题，看[声明 Feature 依赖](./USEGUIDE.md#不依赖参数顺序先启动提供方)。

## 手写时的隐患

直接登记一个函数很容易，安装失败与退出时仍需一致的责任边界。以下只展示隐患，进行类型检查，不运行：

```ts doc-test=check
const extensions = new Map<string, { greet(): string }>()
extensions.set('greeting', { greet: () => '你好' }) // 隐患：立即发布没有定义整批安装成功的提交点。
const cached = extensions.get('greeting') // 隐患：删掉登记也不会撤销已缓存的方法。
const resources: Array<() => void> = []
const dispose = () => resources.forEach((release) => release()) // 隐患：正序清理且每次调用都会再释放。
void cached
void dispose
```

Host 在安装成功后返回能力句柄，并把注册资源收敛到统一释放路径。只有少数固定扩展点时，可保留简单组合函数；需要动态装卸、依赖与失败回滚时再使用宿主。

## 三分钟心智模型

| 你要处理的问题           | 对应工具                                 |
| ------------------------ | ---------------------------------------- |
| 创建统一生命周期所有者   | defineHost；需要继承时用 PluginHost      |
| 定义可安装功能与资源     | definePlugin，install 中 onDispose       |
| 在插件之间复用同一能力   | defineFeature + provider.getFeature      |
| 使用安装后的公开方法     | use 返回的 handle.extensions             |
| 变更配置而不直接修改快照 | host.config / handle.config.update       |
| 暂停可达性或真正回收     | plugin.disable / enable；unUse / dispose |

“Host”拥有安装与释放；“定义”只描述插件，不代表已安装；“注册”是一次具体安装；“句柄”按名称访问当前注册；“Feature”是声明了依赖的能力输出；“stage”是插件参与的数据处理步骤；“lease”记录仍使用某代插件的在途运行。关闭的逻辑结果与资源真正完成释放可能是两个时刻。

## 典型场景

| 场景                               | 怎么组合        | 详细说明                                                     |
| ---------------------------------- | --------------- | ------------------------------------------------------------ |
| 安装插件并读取扩展                 | `defineHost`    | [完整示例](./USEGUIDE.md#安装插件并读取扩展)                 |
| 批次失败时回滚新资源并保留原有插件 | `defineHost`    | [完整示例](./USEGUIDE.md#批次失败时回滚新资源并保留原有插件) |
| 隔离配置与调用者后续修改           | `definePlugin`  | [完整示例](./USEGUIDE.md#隔离配置与调用者后续修改)           |
| 按取得逆序释放插件资源且只执行一次 | `definePlugin`  | [完整示例](./USEGUIDE.md#按取得逆序释放插件资源且只执行一次) |
| 不依赖参数顺序，先启动提供方       | `defineFeature` | [完整示例](./USEGUIDE.md#不依赖参数顺序先启动提供方)         |
| 缺少提供方时在安装器执行前拒绝     | `defineFeature` | [完整示例](./USEGUIDE.md#缺少提供方时在安装器执行前拒绝)     |

## 安装

```bash
pnpm add @migaia/plugin-host
```

下面的完整场景只导入根入口，不需要框架或外部 I/O。运行时依赖 capability、lifecycle、middleware-pipeline 与 utils；直接使用其独立入口时，把相应包列为消费项目的直接依赖。

## 常用 API

| API                                         | 什么时候用                     |
| ------------------------------------------- | ------------------------------ |
| defineHost / PluginHost                     | 创建函数式或类式插件宿主       |
| definePlugin / defineFeature                | 声明插件与能力依赖             |
| host.use / host.activate                    | 安装批次或显式激活 lazy 插件   |
| handle.extensions / host.config             | 使用已安装能力、读取与更新配置 |
| host.plugin.disable / enable / host.replace | 暂停、恢复或更换实现           |
| host.unUse / host.dispose                   | 回收某插件或关闭整个宿主       |

## 类型化命名管道

用 `pipelineSpec<TPayload>()({ mode?, next?, order? })` 为每种载荷声明管道，再把映射放到 defineHost 顶层的 pipelines。owner 拿到 use/run，安装中的插件 core 只有 use/through 登记权；默认 sync、single、install 顺序。各管道共用既有 Host 修订、快照、排序和 lease 排空机制；不传配置时保留默认管道和旧泛型用法。

完整代码及显式泛型写法见[按载荷类型声明多条管道](./USEGUIDE.md#按载荷类型声明多条管道)，示例也展示卸载同时撤回两条管道的步骤。插件自有声明与 through 组合见[高阶用法](./USEGUIDE.md#高阶插件声明自己的管道)。

## 契约细节

### 定位、入口与类型轴

本包管理插件安装、Feature 依赖、配置、stage 归属与释放，不实现领域业务，也不重复实现管线执行算法。运行时依赖为 `@migaia/capability`、`@migaia/lifecycle`、`@migaia/middleware-pipeline`、`@migaia/utils`。管线运行和 stage 提升复用 middleware-pipeline；生命周期 scope、变更队列与清理复用 lifecycle。

只有根入口 `@migaia/plugin-host` 与稳定子入口 `@migaia/plugin-host/composition`。不要依赖内部文件。普通应用使用根入口的 Host、插件、Feature、句柄和错误工具；composition 是单一组合 owner 的窄协议，不是另一套应用 Host。

类 `PluginHost<TDomainCore, TValue, TInstalled, TPipelines>` 的首个类型参数 TDomainCore 必须提供；运行时 createPluginDomainCore 的默认实现返回空对象。末尾 TPipelines 轴默认 `Record<never, never>`；pipeline 值类型默认 `never`，安装类型清单默认 `readonly []`；defineHost 的领域类型参数另有默认值。`TInstalled` 参与安装约束和配置推导，运行期 `use()` 不改变 Host 变量的静态类型，而是按输入顺序返回精确句柄 tuple。插件合并、提取等仅类型 helper 以发布声明为准；`IPluginHostCoreFor<THost>` 从 Host 类型提取领域 core 与 pipeline 轴，类型元数据不会安装运行时能力。

扩展点少且不需要动态装卸时，普通选项或组合函数可能足够。只需执行 middleware 时可直接使用 middleware-pipeline；本包适合需要统一插件资源、依赖、配置和可达性的类库或应用。logger 是仓库内采用此宿主的实际消费者。

### 创建 Host 与全部选项

类入口可重写 `createPluginDomainCore()`，每次安装创建一份领域 core。默认返回空对象。领域 core 必须是普通对象、可枚举 data property，不能覆盖 `config`、`onDispose`、`pipeline` 或四个 `use*Pipeline` core 保留成员；无效表面以原生 TypeError / `INVALID_OPTION` 拒绝。

函数入口 `defineHost(options)` 返回冻结的 canonical handle。它提供与类入口相同的功能，并把类上的 protected `useSync`、`runPipeline` 暴露给持有 handle 的 owner。选项 `host` 可选，形状与类构造选项一致；其余字段如下：

| defineHost 字段                 | 默认与含义                                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `domainCore(request)`           | 可选；省略返回空对象。request 的 `pluginName`、从零开始的批内 `batchIndex`、`batch` 身份均由宿主提供 |
| `translateDisposalError(error)` | 可选；省略保留原 PluginHostError；默认结构化结果路径不调用此钩子，也不逐项转换 cleanupErrors         |
| `dispose(next)`                 | 可选；自定义释放中间件，回调自行调用 `next()` 纳入内核清理；重复内核释放仍复用原 Promise             |
| `surface`                       | 可选；默认无领域公开成员，第四类型参数默认空表面                                                     |
| `pipelines`                     | 可选；真实 `pipelineSpec<TPayload>()(config)` 组成的固定命名映射；defineHost 在顶层传入。            |

`surface` 支持对象或工厂。对象形式的自有描述符在获取 Runtime 之前读取一次，访问器保持动态，所有 canonical Host 键（包括 identity、use、unUse）仍为保留键。工厂形式 `surface: (native) => ({ ... })` 在创建最终 handle 时执行一次，收到冻结的原生 `use`、`unUse`，可组合并替换这两个方法；其他 canonical Host 键仍不能替换。领域方法、Host 身份、共享出口和 fluent 管线方法属于同一个冻结 handle，组合方应通过 surface 提供方法，不能复制返回的 handle。surface 读取或工厂失败保持原错，经 `CALLBACK_FAILED` 边界分类。旧对象写法和三类型参数调用仍有效。

类构造 `options` 可选，defineHost 的 `host` 同样可选；全部省略时使用下表默认值：

| 字段                                                 | 默认                                  | 行为                                                                |
| ---------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------- |
| `identity?: { name?: string }`                       | name 为 `'DEFAULT'`                   | 可读名称可选，宿主另分配唯一 id                                     |
| `execution.mutationTimeoutMs?: number \| false`      | `5000`                                | 本次变更 hook 的执行预算；`false` 无期限                            |
| `execution.pipelineDrainTimeoutMs?: number \| false` | `5000`                                | pipeline 租约排空预算；`false` 等真实排空                           |
| `pipeline?.mode`                                     | `'sync'`                              | `'sync' \| 'async' \| 'generator' \| 'async-generator'`，构造后固定 |
| `diagnostic(message, code?, error?)`                 | 空操作                                | 接收诊断及被包含的原始失败对象                                      |
| `onDiagnosticFailure(error)`                         | 宿主的 globalThis.reportError（若有） | 诊断器自身 throw/reject 的终端出口                                  |
| `scheduler?: IScheduler`                             | 内部 systemScheduler                  | 统一 `now()`、`schedule()` 的时间源                                 |
| `queueAdmissionTimeoutMs?: number \| false`          | `undefined`                           | 默认只诊断；数值表示排队拒绝阈值；false 关闭相关计时与诊断          |
| `queueAdmissionDiagnosticMs?: number \| false`       | `1000`                                | 仅未配置排队拒绝阈值时生效；false 关闭诊断计时器                    |
| `disposeStepTimeoutMs?: number \| false`             | `5000`                                | 单个普通释放步骤的等待预算；false 无期限                            |

所有时间数值须有限、非负；非法选项、非函数回调或不满足 scheduler 协议的对象以 TypeError / `INVALID_OPTION` 拒绝。直接导入 `@migaia/utils/scheduler` 的消费项目需直接安装 utils。

### 定义插件与发布句柄

`definePlugin(name, descriptorFactory, features?)` 只捕获定义。真正安装时同步创建一次 descriptor，再调用其 `install()`、`expose()`、`featureExpose()` hooks；后两者同步返回各自表面。需要配置、setup、更新和释放钩子时使用对象形 `definePlugin(definition)`。两种定义和有效原始描述符走相同准入路径，不在定义时执行安装或 Feature 工厂。名称必填、非空、不能包含 `.`，在 Host 内唯一。对象形定义捕获 own data 字段并冻结；退役的 `shared` 字段不会回退为旧共享行为，应迁移到 Feature，适配器共享出口仍由规范 owner 协议管理。

| 对象定义字段                                                      | 必填 / 默认与作用                                        |
| ----------------------------------------------------------------- | -------------------------------------------------------- |
| `name`、`install(core, setupOutput?)`                             | 必填；install 返回 plain extension record 或 PromiseLike |
| `config`                                                          | 可选；无配置时使用空记录，捕获为宿主拥有的冻结快照       |
| `features`、`featureExpose`                                       | 可选；声明 Feature 根及其可见能力                        |
| `pipelines`                                                       | 可选；插件拥有的管道约定，见下方高阶命名管道契约。       |
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

安装与更新 core 包含领域能力，以及 `config.get()`、`operation`、`lifecycle`、`features`、`featureExpose`、`onDispose(resource)` 、`pipeline(name)` 和四个 `use*Pipeline(stage)`。config 返回已提交的递归只读快照；operation 提供当前操作 `signal` 与绝对 `deadlineAt`，lifecycle 提供注册代际的 signal。四个 use*Pipeline 方法仍返回 core；命名管道的 use/through 返回带幂等 remove() 的登记句柄。登记只允许安装窗口使用，且受模式兼容约束。

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

在函数入口的顶层 `pipelines`，或类构造选项的 `pipelines`，声明一个固定的“名字 → `pipelineSpec<TPayload>()(config)`”映射。每条管道独立推断载荷和 mode；名字是非空的自有可枚举字符串键，值必须来自真实 `pipelineSpec`，不能用结构相同的普通对象替代。说明对象被冻结；Host 的声明在构造时固定；插件也可在 `definePlugin({ pipelines })` 声明自己的组，随安装创建、失败回滚、卸载按原预算排空后删除。插件不能覆盖 Host 的同名管道，冲突以 `INVALID_PIPELINE_OPTION` 拒绝。

| config 字段 | 默认        | 取值与作用                                                                            |
| ----------- | ----------- | ------------------------------------------------------------------------------------- |
| `mode`      | `'sync'`    | `'sync'`、`'async'`、`'generator'`、`'async-generator'`；决定 stage 及 run 返回类型。 |
| `next`      | `'single'`  | `'single'` 或 `'multiple'`；直接采用 middleware-pipeline 的四模式继续及失败规则。     |
| `order`     | `'install'` | `'install'` 按分配顺序，`'reverse'` 按其逆序；同一插件在所有管道共享原排序 slot。     |

持有函数 handle 的 owner 调用 `host.pipeline(name).use(stage)` 或 `.run(value, done)`；类 owner 使用 protected `pipeline(name)`。安装中的插件和 Feature core 只有 `use(stage)`、`through(name)` 登记权，没有 run。两种命名登记都返回带幂等 `remove()` 的句柄；移除影响后续运行，已取得的快照仍由原生命周期排空。

插件和它的 Feature 用原名访问 Host 管道、用短名访问自己的管道，并通过既有 Feature 依赖用 `插件名.管道名` 访问提供方的组。无依赖关系的插件不能访问别人的组。`IPluginHostCoreFor<typeof host>` 适合仅使用 Host 声明的 core；声明插件自己的管道时，保留 install 参数的推导，避免 Host-only 注解遮掉自己的短名。未知或不可见名字同步抛 `PIPELINE_UNKNOWN`；诊断包含查询的插件或 Feature、请求名和可见的 Host、本插件、依赖插件范围。

sync、generator 的命名 run 返回 `TResult | undefined`；async、async-generator 返回 `Promise<Awaited<TResult> | undefined>`。短路返回 undefined，每次到达末端的遍历各调用一次 done。multiple 不返回结果数组；需要每次结果时，在 done 中明确收集。multiple 模式下，stage 可以处理经 next 的 then/await 观察到的分支失败；未观察的失败仍由 runner 拒绝，多个原错按启动顺序保留在 `MULTIPLE_DOWNSTREAM_FAILED` 中。generator 用 throw 把失败交回 yield；sync 遍历全部登记值后汇总错误。

所有管道在同一 Host 事务中提交；每条管道在同一可见 stage 修订内复用编译快照，reverse 也只在编译时处理。没有可见 stage 时直接调用终点，不取快照或 lease。有 stage 时，所有管道复用同一套登记、排序和 quiescence/lease owner。安装失败回滚、unUse、replace、禁用和挂起在一次提交中作用于该插件的全部管道；已有运行持有原快照和分管道的代际 lease，drain 等待这些实际运行，清理和排空预算仍由既有生命周期配置控制。任何管道执行期间，owner 向任一管道注册 stage 都会抛 `PIPELINE_EXECUTING`。

Host 未声明 pipelines 时，其命名轴默认为 `Record<never, never>`；已知插件定义仍能推出其限定名。Host 和插件都没有命名组时，不分配额外的命名 runner、lane 或 lease key。原 `TValue`、`pipeline.mode`、四个 use*Pipeline、runPipeline/runPipelineSync/runPipelineAsync、pipelineMode 都只操作默认管道，原有显式泛型调用不变。默认管道使用内部 symbol，不占用任何字符串名字。显式填写 defineHost 泛型并同时声明命名管道时，要在第五个泛型参数传 `typeof pipelines`；省略它会保留空轴，pipeline(name) 只接受 never。

非法 map、名字、spec、order 以原生 TypeError / `INVALID_PIPELINE_OPTION` 在构造时拒绝，不返回 handle；mode 非法仍是 `INVALID_PIPELINE_MODE`。next 非法的外层码为 `INVALID_PIPELINE_OPTION`，cause 保留 middleware-pipeline 的 TypeError / `INVALID_OPTION`。spec 配置 getter 抛错时也以 `INVALID_PIPELINE_OPTION` 保留原 cause。

### 高阶：through 组合

`core.pipeline('y').through('z')` 在 y 的这个位置进入 z，z 的终点就是 y 剩余的步骤和原终点。z 可以改写同一载荷、短路，也可以在 async stage 的 `await next(value)` 后处理余下链路的结果。目标自己的 order 仍然有效。

两条管道的载荷类型和 mode 必须相同。mode 不同以 `PIPELINE_MODE_MISMATCH` 拒绝；目标允许 multiple 而来源不允许，或登记产生环时，以 `INVALID_PIPELINE_OPTION` 拒绝。环只在登记时检查。空目标直接调用来源的 next，不取目标快照或 lease。through 返回的登记句柄支持幂等 `remove()`，属于发起登记的插件，卸载时一起撤回。`use` 仍只接收 stage，不接收字符串或管道对象；Host owner 的入口仍是 use/run。

### Pipeline：模式、快照与取消

以下四个 use*Pipeline 方法在 Host 侧返回 this，在插件 core 上返回 core；命名 use/through 则返回登记句柄。兼容关系如下，不能提升时同步抛 PIPELINE_MODE_MISMATCH，cause 保留上游 middleware-pipeline TypeError / INVALID_OPTION：

| 注册方法                           | 允许的 Host mode                           |
| ---------------------------------- | ------------------------------------------ |
| `usePipeline(stage)`               | sync / async / generator / async-generator |
| `useAsyncPipeline(stage)`          | async                                      |
| `useGeneratorPipeline(stage)`      | generator / async-generator                |
| `useAsyncGeneratorPipeline(stage)` | async-generator                            |

默认管道由 class owner 从领域入口调用 protected runPipeline(value, done)，函数 handle 直接调用；value 与 done 必填，done 接收终值。sync 的 next 只记录值，当前 stage 返回后才执行下游；async 首次 next 立即启动下游，await next 可写下游完成后的后置逻辑。不调用 next 是正常短路，done 不执行但调用可正常完成。默认 single 策略下重复 next 为 PIPELINE_NEXT_DUPLICATE，迟到 next 被忽略并诊断 PIPELINE_NEXT_LATE。

默认 single 策略下，generator 与 async-generator 都先耗尽当前 stage，普通返回值交给下一步；隐式 undefined 或 GENERATOR_HALT 终止，GENERATOR_CONTINUE 采用最后 yield（零 yield 用输入），GENERATOR_UNDEFINED 才把业务 undefined 继续交付，类型必须允许它。async-generator 串行 await，不是流式 fan-out 或洋葱模式。模式、stage 类型与这三个唯一 symbol 从 middleware-pipeline 直接导入，消费项目应直接安装该包。

把这三个 symbol 作为 stage 返回值时，它们是控制信号，不是业务数据。

下面把输入 `migaia` 转成大写，再加上方括号。第一步返回 `GENERATOR_CONTINUE`，让最后一次 yield 的值进入第二步；第二步直接返回最终字符串。

```ts doc-test=run
import { defineHost } from '@migaia/plugin-host'
import { GENERATOR_CONTINUE, MiddlewarePipelineMode } from '@migaia/middleware-pipeline'

/** 这个宿主持有两步字符串转换与它们的释放责任。 */
const textHost = defineHost<Record<never, never>, string>({
  host: { pipeline: { mode: MiddlewarePipelineMode.generator } }
})
textHost.useGeneratorPipeline(function* (value) {
  yield value.toUpperCase()
  return GENERATOR_CONTINUE
})
textHost.useGeneratorPipeline(function* (value) {
  return `[${value}]`
})
textHost.runPipeline('migaia', (value) => console.log(value))
await textHost.dispose()
```

输出 `[MIGAIA]`：第二个 stage 收到 `MIGAIA`，完成回调收到加上方括号后的结果。中间 yield 不会逐个触发下游。

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

revision 是 Host 已提交修改的版本号，不是尝试操作的次数。composition owner 可读取 revision/getCurrentSnapshot()，通过 createPluginAdmission 捕获定义、createDataOrderSlot(name) 保留 opaque 排序槽，再 prepareAdmissions([{ admission, slot }])。setup 可在准备期执行，但 extension、config、Feature、stage 暂不公开。commitPreparedAdmissions 同步发布、不执行用户代码，revision 已变化则拒绝；discardPreparedAdmissions 对暂存资源只回滚一次。返回 registration token 精确指向那次安装，不按名称误删新代。

createDataOrderSlot 调用即保留顺序；禁用、恢复和 replace 沿用 slot。只有定义永久删除或 session 结束才 retireDataOrderSlot。prepareUnUseBatch 按 owner 的清理顺序接收 exact tokens；commitPreparedUnUseBatch(prepared, { beforeCleanup? }) 先逻辑撤销，再等待 fence 和该代 pipeline lease。beforeCleanup 可选，无默认 Promise，但提供时始终先完成。

托管清理使用 execution.pipelineDrainTimeoutMs（默认 5000）：数值是本批次 lease 与全部清理步骤共享的预算，耗尽继续后续步骤，即使普通 disposeStepTimeoutMs 为 false；显式 pipelineDrainTimeoutMs false 才逐项等待真实完成并绕过普通步骤预算。预算不撤销进行中的工作；确认物理释放前，应等待全部 physicalCompletion 延续完成，或由拥有 realm 的外层终止其实际执行环境。

`createView(token)` 返回只含该 exact registration 的 extensions 的窄 view，无 Host、config、shared 或 mutation 能力。相同 token 的函数引用稳定，receiver 为 concrete Host。token view 禁用期间仍有效，完整 Host view 此时拒绝；启用恢复原函数引用，卸载两者均撤销。foreign/撤销 token 失败关闭。迁移：旧根 createRegistrationView 与 IPluginRegistrationReceipt 已移除，使用 composition createView/IRegistrationToken。

`inspectFeatures(roots)` 从 composition 入口只读检查可信 Feature 拓扑，不运行工厂。

适配器的 `getPluginRuntimeIntegration(core)` 只接受 canonical 本包 core，负责已声明的共享出口、Feature 与注册生命周期对接；不是给普通插件绕过准入的 API。同 family 规范贡献才可共享槽，普通扩展或其他 family 不可占用。不可扩展 Host 新共享 getter 发布失败保持原生 TypeError / PLUGIN_INSTALL_FAILED，不残留失败 family，普通 handle 扩展仍遵守既有不可扩展 Host 契约。

### 错误、诊断与状态

PluginHostError 继承 Error，携带只读 source、code、可选 detail；source 为 `plugin.host`，原始失败通过 cause/errors 可达。可写 native 回调错误原位附身份，不可写或非 Error 值保留在 cause，完整外包身份保留原 owner。INVALID_OPTION 形状错误保留 TypeError；配置值与循环错误是 PluginHostError。不要仅按类名处理所有错误，也不要解析诊断文案。

安装主错不被回滚失败覆盖。PLUGIN_INSTALL_FAILED.detail 包含 failedName、按回滚顺序的 rollbackErrors；异步 use 的 detail 已完成且冻结，同步 useSync 先公布冻结快照，通过 detail.completion 返回最终冻结详情。需要完整次错身份的转换应先 await completion。回滚失败另报 PLUGIN_INSTALL_ROLLBACK_FAILED。

diagnostic 的第三参数保留原失败身份；诊断回调自身失败不会改变 Host 控制流，而交给 onDiagnosticFailure，再失败或省略时交给宿主存在的 globalThis.reportError。Node 需要这类观测时显式提供 onDiagnosticFailure。PluginHostStatus 为 active/closing/disposed；PluginHostRegistrationLifecycle 为 idle/install/dispose。ERROR_TEXT 是根命名导出的稳定英文消息表，MiddlewarePipelineMode/Violation 属于 middleware-pipeline。

`PluginHostDisposalNodeKind` 区分清理错误、聚合及 disposer 包装；`readPluginHostDisposalProvenance(error)` 只读取本物理包登记的追溯信息，未知错误或重复包副本返回 undefined，不按形状猜测。它用于诊断，不替代 source/code/cause 分类。

| code                               | 含义与处置                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `HOST_DISPOSED`                    | 宿主已终态，创建新 Host，不能复用。                                           |
| `HOST_DISPOSING`                   | 宿主正在关闭，不能开始新变更。                                                |
| `PLUGIN_DUPLICATE`                 | 同一名称已占用或在批次中重复。                                                |
| `PLUGIN_NOT_INSTALLED`             | 目标名称不存在，或句柄已无对应安装。                                          |
| `PLUGIN_DISABLED`                  | 插件禁用中，先恢复再调用。                                                    |
| `PLUGIN_SUSPENDED`                 | 必需 provider 不可用使插件挂起，先恢复依赖。                                  |
| `PLUGIN_NOT_ACTIVATED`             | lazy 插件未激活，先 await activate。                                          |
| `FEATURE_NOT_DECLARED`             | 请求了未声明的 Feature 名称。                                                 |
| `PREREQUISITE_MISSING`             | 必需 provider 从未安装，安装前直接拒绝。                                      |
| `PREREQUISITE_DISABLED`            | 必需 provider 已禁用，启用后重试。                                            |
| `PREREQUISITE_REMOVED`             | 必需 provider 已卸载，需要重新安装。                                          |
| `DEPENDENCY_CYCLE`                 | Feature 跨插件引用成环，任何 install 前拒绝。                                 |
| `DEPENDENCY_BLOCKED`               | 变更会遗留必需依赖者，detail.blockedBy 列出传递闭包。                         |
| `REPLACE_NAME_MISMATCH`            | 替换候选名称不同，未安装候选。                                                |
| `DEPENDENT_RESTART_FAILED`         | 新 provider 已提交但依赖者重装失败，cause.errors 首项为重装失败。             |
| `PLUGIN_DEFINITION_INVALID`        | 退役或不支持的定义字段、非法依赖或非 canonical core，保留 TypeError。         |
| `PLUGIN_INSTALL_FAILED`            | 安装/发布失败，原错在 cause，回滚详情保留次错。                               |
| `SETUP_REQUIRES_ASYNC_INSTALL`     | 即时 useSync 安装遇到 setup，改用异步 use。                                   |
| `PLUGIN_INSTALL_ROLLBACK_FAILED`   | 仅诊断：回滚也失败，不替换原安装主错。                                        |
| `INSTALL_RESULT_THENABLE`          | install 结果自带 then，或同步路径得到异步结果，不发布此扩展。                 |
| `PLUGIN_DISPOSE_FAILED`            | beforeRelease 或插件释放步骤失败，cause 保留原错，其余清理继续。              |
| `EXTENSION_DUPLICATE`              | 扩展键已占用，Host 保留键优先分类为 EXTENSION_RESERVED。                      |
| `EXTENSION_OBJECT_PROTOTYPE`       | 扩展键命中 Object.prototype。                                                 |
| `EXTENSION_RESERVED`               | 扩展使用 Host 协议键、then 或清理 symbol。                                    |
| `EXTENSION_NON_ENUMERABLE_IGNORED` | 仅诊断：有意忽略非枚举扩展键。                                                |
| `RESOURCE_OUTSIDE_INSTALL`         | core 在安装窗口外拒绝且不接管；setup 关闭后的有效资源先释放再拒绝。           |
| `LIFECYCLE_MUTATION`               | 生命周期同步重入，或 setup / beforeRelease 等待期发起变更，不能执行。         |
| `INVALID_PIPELINE_MODE`            | 构造时 mode 非四种合法值。                                                    |
| `INVALID_PIPELINE_OPTION`          | 声明非法、插件覆盖 Host 名字、through 的 next 不兼容或成环；保留已有 cause。  |
| `PIPELINE_UNKNOWN`                 | 名字未声明或对当前注册不可见；诊断包含调用方与可见范围。                      |
| `ASYNC_STAGE_IN_SYNC_ENTRY`        | 默认同步入口遇到可见 async stage；任何 stage 或终点执行前拒绝。               |
| `PIPELINE_MODE_MISMATCH`           | stage 无法提升，或 through 的两条管道 mode 不同；提升失败保留上游 TypeError。 |
| `PIPELINE_NEXT_DUPLICATE`          | 同次 stage 重复调用 next，不重复派发。                                        |
| `PIPELINE_NEXT_LATE`               | 仅诊断：stage 已结束后调用 next，忽略此调用。                                 |
| `PIPELINE_EXECUTING`               | 管线执行期间注册新 stage。                                                    |
| `PIPELINE_FAILED`                  | async 双失败，AggregateError.errors 固定为 stage、downstream。                |
| `MUTATION_QUEUE_TIMEOUT`           | 已配置准入期限且排队到限，任务移出并不再执行。                                |
| `DISPOSE_STEP_TIMEOUT`             | beforeRelease 或普通释放步骤超预算，结束等待并继续清理，不强行取消。          |
| `INVALID_OPTION`                   | 入参形状不合法，保留原生 TypeError，修正输入。                                |
| `INVALID_CONFIG_VALUE`             | 配置不满足普通数据语法，detail 含 path/reason。                               |
| `CONFIG_CYCLE_REJECTED`            | 配置含引用环，提供无环值图。                                                  |
| `CALLBACK_FAILED`                  | 未分类配置、surface 读取或 defineHost disposal 回调失败；保留原错或 cause。   |
| `MUTATION_EXECUTION_TIMEOUT`       | hook 执行到限，丧失提交权限，迟到结果不能提交。                               |
| `REGISTRATION_REVOKED`             | 已取出的扩展属于已卸载或替换的旧注册。                                        |
| `PIPELINE_DRAIN_TIMEOUT`           | 普通卸载排空超预算，ok false，继续有界清理并诊断。                            |
| `CLEANUP_INCOMPLETE`               | 逻辑关闭已提交，清理有错或仍未完成；读取结果与 continuation。                 |
| `COMPOSITION_TARGET_UNMANAGED`     | 组合目标非本物理包登记的 Host，不做结构兼容。                                 |

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
