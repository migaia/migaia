# `@migaia/tray`

按依赖启动和释放资源，把插件安装、加载产物与运行中回调交给同一条可观察的生命周期。

## 你可能遇到过

- 服务先于配置启动，退出时配置又先被关闭：资源先后只靠数组位置和分散的 finally。
- 提供者暂时未就绪，服务却永远停在旧状态：反复读取旧快照，没有区分 blocked 和最终失败。
- 插件先于依赖到达，半就绪能力就被公开：登记定义与真正安装没有分开。
- 插件转换失败后资源没释放，安装成功后却被提前释放：加载、转换和安装各自管理清理。
- 调用已经取消，回调却仍在使用资源：停止等待被误当成代码已经结束。

## 为什么选它

- **依赖顺序同时决定启动与释放。** 静态资源图复用 Capability Graph，[先启动依赖，再按反序释放服务](./USEGUIDE.md#先启动依赖再按反序释放服务) 在反向登记后仍先启动配置、先释放服务。
- **临时阻塞可以显式恢复，最终失败保持稳定。** readiness getter 只在 blocked 后重新采样，[仅重试暂时阻塞的就绪门](./USEGUIDE.md#仅重试暂时阻塞的就绪门) 同时核对了零提前启动与 failed Promise 缓存。
- **插件定义可以等待缺失依赖。** 托管 Host 通过 Feature 引用保留 blocked 定义，[等待提供者安装后再启用依赖插件](./USEGUIDE.md#等待提供者安装后再启用依赖插件) 展示提供者到达后启动、移除后再次阻塞。
- **加载资源按提交结果交接清理责任。** loadIntoHost 暂管加载产物并按 committed 转给插件，[提交成功后才交接加载制品的清理责任](./USEGUIDE.md#提交成功后才交接加载制品的清理责任) 核对成功后延后释放与转换失败回滚。
- **取消不提前释放回调仍在使用的资源。** Runtime 保留当前安装资源的使用权直到真实结算，[取消后仍等待回调实际结束](./USEGUIDE.md#取消后仍等待回调实际结束) 在信号中止后仍观察到一个运行，回调完成后才归零。

## 从这里开始

安装并在 Node 24 的 ESM TypeScript 文件中运行下面代码；它组合一个同一运行环境内的静态值，输出 42：

```bash
pnpm add @migaia/tray
```

```ts doc-test=run
import { createTrayGraph, type ITrayKey } from '@migaia/tray'
const key = 'answer' as ITrayKey
const tray = createTrayGraph([
  { key, kind: 'value', start: () => ({ value: 42, release: () => undefined }) }
])
try {
  await tray.ready()
  console.log(tray.get<number>(key))
} finally {
  await tray.dispose()
}
```

输出：

```text
42
```

依赖启动与释放看 [先启动依赖，再按反序释放服务](./USEGUIDE.md#先启动依赖再按反序释放服务)，插件缺少提供者看 [等待提供者安装后再启用依赖插件](./USEGUIDE.md#等待提供者安装后再启用依赖插件)；需要回调内自卸载时看 [回调结束后再卸载当前插件](./USEGUIDE.md#回调结束后再卸载当前插件)。

## 手写时的隐患

下面只展示原生函数的资源登记草图，检查类型但不运行：

```ts doc-test=check
const releases: Array<() => void> = []
const register = (start: () => number, release: () => void) => {
  const value = start() // 隐患：登记时就启动，依赖只靠调用顺序。
  releases.push(release)
  return value
}
const stop = () => {
  for (const release of releases) release() // 隐患：按登记正序释放，可能先关闭提供者。
  // 隐患：一次释放抛错就会跳过后续资源，缺少统一清理结果。
}
void register
void stop
```

上一节显式等待 ready 才读取值，dispose 沿 Graph 的所有权统一释放；声明 requires 后，启动与释放都遵循依赖，而不是调用位置。

## 三分钟心智模型

| 你要解决的问题                 | 工具                                                         |
| ------------------------------ | ------------------------------------------------------------ |
| 已知的一组配置、服务与资源     | createTrayGraph，声明完整依赖后 ready / get / dispose。      |
| 插件到达、依赖恢复、替换或卸载 | /host 的 createHost，管理 definition 与 ready 插件。         |
| 外部产物转成插件并交接资源     | /loader 的 loadIntoHost，配合 defineLoader / defineAdapter。 |
| 回调使用插件能力并支持合作取消 | /runtime 的 createRuntime，保留当前安装的使用权。            |
| 独立 Host 实例、路由和业务主题 | 根入口 defineTrayHost / createTray / serveTrayHost。         |

definition 是已登记的插件描述，ready 才表示能力可用；generation 是同名插件或实例的某次安装。lease 是一次运行对该次安装的使用权，结束后才允许实际释放。artifact 是加载得到的资源值，committed 表示它已交给对应定义，cleanupComplete 表示物理清理是否已经完成；这些状态不能互相代替。

## 典型场景

| 场景                       | 怎么组合                                                | 详细说明                                                                               |
| -------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 服务依赖配置并安全退出     | createTrayGraph → ready → get → dispose                 | [先启动依赖，再按反序释放服务](./USEGUIDE.md#先启动依赖再按反序释放服务)               |
| 外部提供者暂时不可用       | readiness getter → blocked → 显式 ready                 | [仅重试暂时阻塞的就绪门](./USEGUIDE.md#仅重试暂时阻塞的就绪门)                         |
| 插件到达顺序不同于依赖顺序 | createHost → use(provider) → unUse(provider)            | [等待提供者安装后再启用依赖插件](./USEGUIDE.md#等待提供者安装后再启用依赖插件)         |
| 加载产物成功转交或失败回滚 | defineLoader → defineAdapter → loadIntoHost → unUse     | [提交成功后才交接加载制品的清理责任](./USEGUIDE.md#提交成功后才交接加载制品的清理责任) |
| 取消时仍保留在用资源       | createRuntime → run(signal) → callback settle → dispose | [取消后仍等待回调实际结束](./USEGUIDE.md#取消后仍等待回调实际结束)                     |
| 回调结束后卸载自己         | run → self.unUse ticket → callback settle → completion  | [回调结束后再卸载当前插件](./USEGUIDE.md#回调结束后再卸载当前插件)                     |

## 安装

```bash
pnpm add @migaia/tray
```

托管插件示例直接导入 plugin-host，需直接安装：

```bash
pnpm add @migaia/plugin-host
```

静态 Graph 与实例注册表从根入口导入；托管 Host、Loader、Adapter、Runtime 使用各自精确子入口。这里的六个运行场景是同一运行环境内的组合，原生 Worker / process 由 Hosts 层沿 RPC 工厂另行接线。

## 常用 API

| API                         | 用途                                           |
| --------------------------- | ---------------------------------------------- |
| createTrayGraph             | 静态资源依赖启动、读取和逆序释放。             |
| createHost                  | 管理 PluginHost 的定义、依赖、代次与清理结果。 |
| loadIntoHost                | 加载、转换、安装或替换，并交接制品清理。       |
| createRuntime               | 借用插件能力运行回调，合作取消并保持使用权。   |
| defineTrayHost / createTray | 定义和管理独立 Host 实例。                     |
| serveTrayHost               | 在原生子入口服务父注册表。                     |

## 契约细节

### 职责与五个入口

Tray 组合已有的能力与生命周期，不另建一套协议。静态 Graph 管理同一运行环境内、构造前已知的完整资源集合；托管 Host 组合 PluginHost 定义；根入口的 Hosts 注册表管理独立实例。能力依赖由 capability 负责，插件安装由 plugin-host 负责，连接和原生执行由 RPC / supervision 负责；这些依赖图不等于响应式数据依赖。

| 入口                   | 用途                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `@migaia/tray`         | createTrayGraph；defineTrayHost、createTray、serveTrayHost；路由策略与实例状态、公开错误。 |
| `@migaia/tray/host`    | createHost 与托管 Host 的公开类型。                                                        |
| `@migaia/tray/loader`  | defineLoader、loadIntoHost 与加载合同。                                                    |
| `@migaia/tray/adapter` | defineAdapter 与转换合同。                                                                 |
| `@migaia/tray/runtime` | createRuntime 与回调运行、协作取消、自变更回执类型。                                       |

Loader、Adapter、Runtime 不从根入口聚合。直接导入 plugin-host、lifecycle 等依赖的示例应直接安装这些包。本包运行时依赖 capability、event-subscriber、lifecycle、plugin-host、rpc-contract、rpc-core、rpc-process、rpc-threads、supervision 与 utils。跨机器发现、浏览器 Worker 接入、UI、持久消息与自动故障转移重试不属于这里的组合保证。

### 静态 Graph：定义与启动

`createTrayGraph(entries)` 必填一个完整只读数组，构造时同步检查但不启动。ITrayKey 是带品牌的字符串，运行时要求 trim 后非空；业务应集中定义并复用键，不依赖库猜测或生成。

| Entry 字段 | 要求                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| key        | 必填且全数组唯一；重复键为 TRAY_DUPLICATE_ENTRY。                                                        |
| kind       | 必填，value / computed / resource / service；只是类别标签，不改变 value 的静态类型或自动创建响应式能力。 |
| requires   | 默认空数组；只能引用本次集合的其他键，不允许自身或未知键。                                               |
| readiness  | 默认 undefined；外部就绪快照，state 为 ready / blocked / failed。                                        |
| start      | 必填函数；依赖就绪后收到 context，返回或 resolve 为完整的 `{ value, release }`。                         |

key、kind、requires、readiness、start 的入场读取与依赖检查都在第一个 start 之前；异常或外形非法为 TRAY_INVALID_ENTRY。规范化后的 keys / requires 数组冻结，调用方后续修改原数组不会改变拓扑。readiness 属性值在入场捕获，首次 gate 使用该对象；这不是对任意业务值或快照对象做深克隆。

context.signal 在 Graph 关闭时中止；context.get(key) 只读取已声明、已就绪的直接依赖；context.own(resource, descriptor) 把辅助资源交给当前节点，完整 release descriptor 沿 lifecycle 处理。start 的主值 release(context) 接收 Graph 释放上下文，可同步返回或返回类 Promise 对象。部分构造失败时，entry 自己回滚尚未交出的资源。

第一次 ready() 按 entry 顺序检查入场捕获快照的 state / error；全缺省或 ready 才启动 Graph。blocked / failed 拒绝其 error，null / undefined 时使用 TRAY_UNAVAILABLE，其他假值仍是原失败。非法 state 为 TRAY_INVALID_ENTRY，之后不读取该快照的 error；getter 失败尽可能保留原生类型 / identity 并附 TRAY_GATE_READ_FAILED。

只有 blocked 允许下一次显式 ready() 重新读取各 entry.readiness 及新快照；提供 getter 才能取得提供者后来发布的新对象。failed、非法快照、getter 失败及 Graph 启动结果缓存同一个 Promise；启动成功后不再采样外部门，dispose 后不再重试。没有自动轮询或重试计时。

| ITrayGraph 成员 | 行为                                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| keys            | 冻结的入场键列表，保持声明顺序。                                                                         |
| state / error   | ready 前为 open；gate 失败投影 failed，之后沿 Graph 状态与原错误。                                       |
| ready()         | 无参数，显式门控并启动依赖；保留最终 Promise 身份。                                                      |
| `get<T>(key)`   | 只在 Graph 与节点可见时读 Graph 自己的 value；未知键 TRAY_UNKNOWN_ENTRY，其余不可用为 TRAY_UNAVAILABLE。 |
| entryState(key) | 读取单个节点状态，未知键同样拒绝。                                                                       |
| dispose()       | 无参数，关闭可见性并按依赖逆序释放，遵循原 Graph 的幂等与同 Promise 语义。                               |

没有第二份 Tray value 表；启动中、后续节点失败或关闭后都不会露出部分已启动值。主值与 context.own 资源均归节点，调用方不要重复释放。Graph 保留 primary 与清理错误的 cause / errors；Tray 不增加 timeout、scheduler 或强制终止，不结算的同运行环境 start / release 仍可能一直等待。

### 托管 Host：建立、变更与类型

`await createHost(options)` 只从 /host 导入；create() 构造唯一 concrete PluginHost class 实例或 defineHost() handle，facade 继续使用原 Host 身份、domain core、pipeline 和 constructor baseline。插件 install(core) 接收 domain core 与 lifecycle core，不接收 Host handle。

| ICreateHostOptions 字段 | 默认与要求                                                  |
| ----------------------- | ----------------------------------------------------------- |
| create                  | 必填函数，无默认，返回尚未被其他 Tray 会话认领的原 Host。   |
| plugins                 | 必填初始定义 tuple，无默认；一起入场并按 Feature 依赖启动。 |
| mutationAdmissionMs     | 必填，无默认；有限非负毫秒预算，控制串行图变更等待接纳。    |
| quiescenceMs            | 必填，无默认；有限非负预算，用于 bounded 的物理清理等待。   |
| shutdown.mode           | 必填，无默认；bounded 或 strict-drain。                     |
| report                  | undefined；接收被容纳的生命周期与清理诊断。                 |

Tray 使用同一份 PluginHost admission 快照的 Feature、config 与 disposer，通过公开依赖读取器建立动态图，再发布已就绪定义。必需 provider 缺失时 definition 保留 blocked；可选 provider 缺失不阻塞，存在时也先于使用者安装。依赖来自 Feature references，不接受旧插件依赖字段。无效描述子在图变更前拒绝，PluginHost 原错保留 cause；进入图变更后的失败按 mutation result 观察。

| 成员                   | 契约                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| plugins / readyPlugins | 前者包含全部已登记 definition 名称，后者仅包含 ready 名称。                              |
| pluginState(name)      | 查询状态；未知名称返回 blocked，不因此提供可用扩展。                                     |
| extensions / config    | 保留原 Host baseline 与已就绪插件的面。                                                  |
| use(plugin)            | 增加 definition，缺 provider 时可 committed 且 blocked。                                 |
| replace(plugin)        | 替换同名 exact generation，保留原排序位置。                                              |
| unUse(name)            | 删除 definition 并阻塞使用者闭包；未知名返回 ok true / committed false / removed false。 |
| dispose()              | 终止图、移除内部锚点并清理 concrete Host；重复与同步重入复用同一 Promise。               |

失败结果的 committed 表示候选是否已经成为当前 binding，不能用 ok 或“同名还存在”猜测。未提交 duplicate / cycle / replacement 候选回滚，不成为后来重启的隐式来源。真正 unUse 后原排序位置永久退休，同名后续 use 获得新的单调位置；provider 恢复与同名 replace 保留已有 definition 的位置。

成功结果携带 result.view；检查 ok 后把该 view 交给 createRuntime，才能延续新插件精确扩展类型。原 Host 变量的静态类型不会自动改变。ITrayResolvedHost 对有限、literal、最多 128 个定义且 provider/name 未泛化的 tuple 求 ready 闭包；超出预算或名称泛化使用 ITrayHostDynamic，保留 constructor baseline，未知动态键为 unknown。

Host.state 可为 active / closing / terminal / failed；失败时 facade.state 可为 failed，而返回清理结果仍标记 state terminal。工厂失败的 creation detail 带阶段与清理信息；phase 类型包含 factory / admission / graph / setup / commit，当前实际观察路径使用 factory / setup，不承诺逐项发出所有阶段。重复认领已在使用的 Host 只回滚本次 claim，不销毁已有会话；冻结 factory 异常通过 cause 保留，避免 detail 附加覆盖原错。绕过 facade 使用逃逸的 concrete Host 变更，会以 HOST_MUTATION_BYPASS 关闭后续可信访问。

### 逻辑完成与物理清理

Host mutation / disposal 的 ICleanupResult 来自 lifecycle：cleanupErrors 是当前快照，cleanupComplete false 表示仍需观察同一个 physicalCompletion，其结果只包含后来新增的错误。用 `mergeCleanupResults([result])` 合并当前及所有后续增量，包括跨运行环境的 Promise。

Graph 在释放 exact generation 前封闭该 binding 的新使用权，再等已取得使用权的工作结束；PluginHost 先等待这道屏障，再按使用者 / 提供者、插件 / 资源顺序清理。Host 的 bounded 可按 quiescenceMs 返回逻辑结果，strict-drain 等实际完成。原 PluginHost 必填 execution.pipelineDrainTimeoutMs 为数值时，共享本批预算到期后继续后续清理；false 才逐项等真实完成。预算不会取消仍在运行的 Promise，迟到工作与错误继续由 physicalCompletion 观察。

托管 Host 支持异步显式资源管理；环境不支持 await using 时，在 finally 中 await host.dispose()。不要把 cleanupComplete false 当成全部资源已释放，也不要丢弃物理结果。

### Loader、Adapter 与制品归属

defineLoader({ load }) 捕获一次 load 方法，返回冻结合同；每次 load(source, context) 调用该函数一次，接受同步、Promise 与外来类 Promise 对象。defineAdapter({ adapt }) 同样捕获转换方法并在每次 adapt 时调用；它们不创建 Host / Graph，也不独自接管制品清理。独立包装器保留执行结果，事务中的失败分类由 loadIntoHost 负责。

load 的结果须含 value 与 lifecycle release descriptor，至少有可调用 force；与静态 entry 的 release 函数不是同一外形。adapter 将 value 转成与原 Host core 兼容的插件描述子。非法合同 / 返回形状分别为 LOADER_CONTRACT_INVALID / ADAPTER_CONTRACT_INVALID。

| loadIntoHost(options) 字段       | 要求                                                     |
| -------------------------------- | -------------------------------------------------------- |
| host / source / loader / adapter | 必填，分别为托管 Host、输入、加载器与转换器。            |
| mutation                         | 必填 use 或 replace，无默认。                            |
| timeoutMs                        | 必填 false 或有限非负数，允许 0 / 小数；false 不设期限。 |
| signal                           | undefined，仅桥接本次事务接纳期间的取消。                |
| report                           | undefined；诊断不能取代事务原结果。                      |

loader context 提供原生 signal、deadlineAt（false 时 undefined）与 report；adapter context 提供 signal / deadlineAt。事务以 provisional scope 暂管制品，执行 load → adapt → use / replace；未 committed 则回滚，committed 后交给 exact definition generation。即使结果 ok false 或插件 blocked / failed，只要 committed true，制品仍由该代持有，后续 unUse / replace / dispose 才沿原路径释放。

取消和期限只通知协作信号，不独立阻止不合作的 loader / adapter 继续执行甚至提交；timeoutMs 必填，只有 false 才不设 deadlineAt。

成功 loadIntoHost 返回即取消本次 timer 并解除 caller signal 桥接，之后 caller abort 不影响已提交 generation 的 loader context；其 scope 仍归代际，scope 结束时 context.signal 中止。失败回滚的次要清理会报告，不替换 mutation primary；已有生命周期身份保持，不把所有清理改成本包码。

### Runtime：回调使用权、取消与自变更

createRuntime(host, options?) 只接受托管 Host 的真实能力，借用而不销毁 Host / Graph。options.shutdown.mode 默认 strict-drain，另一个值 bounded；options.report 默认 undefined。Runtime 无 quiescenceMs；物理清理等待预算配置在托管 Host。

run(name, options, execute) 取得目标 ready 插件的 exact generation 使用权，只发布该 registration 的 extensions 快照。字面量 ready 名称可精确推导，泛化名称使用只读 unknown 记录；不是把整个 Host 扩展交给回调。

| Run 参数或 context          | 要求与含义                                                                       |
| --------------------------- | -------------------------------------------------------------------------------- |
| name / execute              | 必填目标名和函数。                                                               |
| options.timeoutMs           | 必填 false 或有限非负数，允许 0 / 小数；deadlineAt 采用 systemScheduler 的时钟。 |
| options.signal              | undefined，调用方取消源。                                                        |
| context.runId / plugin      | 本次递增标识与目标插件名。                                                       |
| context.extensions          | 当前插件代次的扩展快照。                                                         |
| context.signal / deadlineAt | 合作式中止与单调截止点，false 时 deadlineAt 为 undefined。                       |
| context.self                | 只绑定当前 run、名字与 generation 的自变更能力。                                 |

同步值、Promise、外来 thenable、throw / reject 都在真实 callback settlement 后释放使用权；callback 原失败保留类型、stack、identity 或 cause。signal、期限、Runtime.dispose 只中止协作信号，不抢占代码，不提前释放；回调可以忽略取消并成功返回。目标租用失败仍释放本次 deadline 任务和 caller bridge，完整的 capability / graph 等外包身份保留，不能宣称每次失败都会变成 RUNTIME_ABORTED。

dispose() 停止新 run，abort 活跃信号，复用同一个 Promise。strict-drain 等回调真实结算并报告失败；bounded 立即给出 state terminal 与 cleanupComplete 当前值，未结束回调继续受原工作持有。Runtime activeRuns 统计尚未结算的回调；Runtime.dispose 不释放借用 Host，Host 发出 disposing 时 Runtime 同样停止接纳并中止活跃信号。Symbol.asyncDispose 等待 Runtime.dispose，丢弃其返回快照。

self.unUse() / self.replace(plugin) 同步返回非 thenable ticket；操作先等 callback settle、释放使用权，再进入 canonical Host queue。ticket.completion 只在回调外读取；回调内读取会得到 RUNTIME_CONTRACT_INVALID 的 rejected Promise，直接 await ticket 本身也不代表变更完成。替换继续按原 Host 的 core 能力准入，旧代的回执不授权变更新代。不要在 callback 捕获 concrete Host 进行自身卸载。

### Hosts：定义与运行方式

根入口的 defineTrayHost(definition) 创建冻结、有身份的 Host 定义；name、plugins、exposes 必填，定义阶段不调用插件工厂或 config 验证器。结构复制品没有该身份。exposes 用 plugin.feature 路径，调用用 plugin.feature.method；内部保留插件名不可作为业务暴露。

| 定义字段                  | 默认与约束                                                                  |
| ------------------------- | --------------------------------------------------------------------------- |
| runtime                   | coroutine；可选 thread / process。                                          |
| entry                     | 默认无；thread / process 必填 string / URL，coroutine 禁止。                |
| config(input)             | 默认无验证器；每次初始化校验转换输入。                                      |
| plugins(info, trayPlugin) | 每个 generation init 调用，info 含 id、host、generation 与验证后的 config。 |
| exposes                   | 必填只读 Feature 路径数组。                                                 |
| supervisor                | 默认沿原运行时策略；可覆写 restart 与 startupTimeoutMs。                    |
| limits.heapBytes          | 默认未指定，仅 thread。                                                     |
| sandbox                   | 默认未指定，仅 process，包含 name 与同步 wrap(command)。                    |
| routing                   | 默认未指定，只读可信 policy tuple，声明子插件可用的自定义路由。             |

supervisor.restart 的 mode 可为 never / on-failure / always；还可配置 maxRestarts、windowMs、initialDelayMs。sandbox.wrap 的输入输出为完整启动命令 `{ command, args, cwd?, env }`，env 包含 inherit / set；应用自行接入外部沙箱，本包不提供沙箱实现。

coroutine 共享事件循环，停止合作式；thread 是独立 Worker isolate，process 是子进程。Node 原生入口应导入共享 Host 定义并执行 serveTrayHost(host, { probe?, report? })；它只连接父 registry，等退出请求和插件清理后结束对应运行体，不再 spawn。Bun / Deno / browser Worker 的权限和原生退出能力不能由本地 Node 或运行时无关案例推断。

plugins 通过 Feature 引用依赖 trayPlugin.getFeature('tray')；deps.tray.self() 取身份，await deps.tray.to(host, id) 取得绑定当前接纳记录的 remote，deps.tray.exit(error?) 结束本实例。第一次 exit 决定 clean / crash，插件清理之后才结束 task / realm。根入口仅提供 ITrayClientPlugin 类型，不提供运行时 client 单例。

### 实例注册表与远端调用

createTray({ hosts, routing?, probe?, report? }) 返回 ITray；hosts 必填为可信定义数组，routing 与每个定义的 policy 合并。probe 默认未指定，可为单个 IRpcProbe 或只读数组；createTray.report 默认 Core 的 defaultRpcReporter。serveTrayHost 使用相同 probe / report 类型，默认 report 为 console.error。

| Registry API                              | 行为                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| spawn(name, { id, config? })              | 初始化并返回对应 remote；配置类型不允许 undefined 时 config 必填。              |
| instance(host, id)                        | 同步取得固定接纳记录的 remote。                                                 |
| list({ host?, runtime?, state? }?)        | 返回冻结快照，筛选字段未传不限制。                                              |
| get(id)                                   | 异步合并 RPC unit detail，generation 保持 Tray 数值类型。                       |
| stop / remove(id, { graceMs? }?)          | 默认 graceMs 5000，先尝试 child PluginHost cleanup，失败 / 超时报告后继续停止。 |
| restart(id) / replace(id, { config? }?)   | 每实例串行管理；替换 config 仅在新 generation init 成功后提交。                 |
| on(event, listener) / watch({ signal? }?) | 只观察生命周期；watch 最近 100 条未读记录，非持久日志。                         |
| dispose({ graceMs? }?)                    | 关闭注册表与所属实例，支持异步显式资源管理。                                    |

TrayInstanceState 为 starting / ready / restarting / failed / stopped；TrayInstanceEvent 为 spawned / ready / restarting / failed / stopped / removed。生命周期记录冻结且没有 emit；错误投影只保安全 source / code，不保证通过事件取得原 crash 对象。

remote.request / notify / stream 统一用 path、payload、第三个 options；无参数方法可省略 payload，有 options 时用 undefined 占第二位。ITrayCallOptions 仅 signal 与 timeoutMs，缺省未指定；不是把 options 塞进业务对象。业务对象里的 undefined 字段拒绝，只有 wire envelope 的 absent payload / config 会省略；Uint8Array 可跨三种运行方式，非 portable config 在创建连接前拒绝。

父端 list / get 的 config 保留 portable 的 spawn / replace 输入；配置验证在 child init 执行，plugins(info) 与 deps.tray.self() 才读取验证器输出，该输出保持子端本地数据，不再自动转成 wire 载荷。

非 ready 目标立即 TRAY_INSTANCE_NOT_READY；remove 后旧 remote 永久 TRAY_INSTANCE_UNKNOWN，同 id 重新 spawn 不会复活旧记录。已发送调用按原 RPC receipt 完成，不迁往新 generation。业务目标错误保留原 source / code / cause，Tray 校验与启动包装保留原 cause；inFlight 只计本接纳记录尚未结束的业务 request / notify / stream，不含 init 和主题投递。

### 路由与业务主题

tray.routing.roundRobin(host) 与 tray.routing('roundRobin', host) 共享同一选择序号，每次操作选择当前 ready 实例。leastInFlight 选最少待完成业务调用，平局保留 spawn 顺序；routed remote 有 host 而没有固定 id。剩余期限与取消信号交给所选目标，不自动改投其他实例或重试。

defineRoutingPolicy(name, pick) 创建有身份的冻结定义，定义时不执行 pick。name 符合 `^[a-z][A-Za-z0-9]*$`，不能占用内置名、函数 / 对象保留属性。pick(candidates, { host, sequence }) 在父端同步执行，收到当次独立冻结、按 spawn 顺序且反映当前 inFlight 的 ready 快照，返回其中一个 id；回调应短小。父端注册 createTray.routing 与 host DSL.routing 的合集，子插件须在自己的 host tuple 声明自定义名；只把名字跨 RPC，内置名无需声明。

未注册或未声明为 TRAY_ROUTING_UNKNOWN；非法定义、不同 policy 身份重名、非候选返回和 pick 抛错为 TRAY_ROUTING_INVALID，原 throw 留 cause。没有 ready 候选为 TRAY_HOST_UNAVAILABLE。

tray.publish(topic, payload?) 同步向当前订阅者分发；子端 deps.tray.publish 返回 Promise。父端 subscribe 返回同步退订函数，子端 await subscribe 返回异步幂等退订；第一位本地监听器登记父端 membership，最后一位释放时移除。重启后重新安装插件建立新代订阅，旧代操作不影响新 membership。

主题必须非空字符串，载荷必须 portable；名称 spawned 也只是业务主题，不触发生命周期事件。listener(payload, meta) 的 meta.from 由父端认证且冻结：实例为 `{ id, host, generation }`，父发布为 `{ parent: true }`；与载荷分离，载荷字段不能冒充发送者。

每个当前订阅最多投递一次；目标未 ready 会错过消息，没有 replay、持久性或业务完成确认。同步 listener throw 与异步 reject 在其侧报告，后续监听器继续；投递发送拒绝由父端报告，处理失败由子端报告，不以这些投递错误拒绝发布者。

### 错误与迁移

所有 Tray 自有边界码的 source 为 TRAY_SOURCE，即 `@migaia/tray`；按 source / code 分支，不匹配 message。可注记的原生错误保持类型、stack 与 identity；冻结或不可安全注记的值经带码 wrapper.cause 保留，完整外包身份不改写。Graph 启动 / 节点 / 释放错误继续属于 capability。

| TrayErrorCode 属性 / 值                           | 触发                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| hostUnavailable / TRAY_HOST_UNAVAILABLE           | 没有 ready 路由候选。                                                 |
| routingUnknown / TRAY_ROUTING_UNKNOWN             | policy 未注册或子端未声明。                                           |
| topicInvalid / TRAY_TOPIC_INVALID                 | 主题不是非空字符串。                                                  |
| routingInvalid / TRAY_ROUTING_INVALID             | policy 名称 / 回调 / 返回候选无效或执行抛错。                         |
| hostInvalid / TRAY_HOST_INVALID                   | Host DSL 或 registry 构造输入无效。                                   |
| hostUnknown / TRAY_HOST_UNKNOWN                   | spawn 使用未登记 Host。                                               |
| hostMismatch / TRAY_HOST_MISMATCH                 | remote 指向与当前接纳记录不同的 Host。                                |
| reservedName / TRAY_RESERVED_NAME                 | 暴露路径使用保留内部插件名。                                          |
| valueNotPortable / TRAY_VALUE_NOT_PORTABLE        | config 或 payload 不是支持的 portable 数据。                          |
| instanceDuplicate / TRAY_INSTANCE_DUPLICATE       | spawn 重用仍被接纳的 id。                                             |
| instanceUnknown / TRAY_INSTANCE_UNKNOWN           | lookup 或 remote 使用已结束接纳记录。                                 |
| instanceNotReady / TRAY_INSTANCE_NOT_READY        | 调用目标尚未 ready。                                                  |
| instanceStartFailed / TRAY_INSTANCE_START_FAILED  | 插件安装或 generation init 失败，原因留 cause。                       |
| pathNotExposed / TRAY_PATH_NOT_EXPOSED            | 调用路径不在声明暴露面。                                              |
| childStateInvalid / TRAY_CHILD_STATE_INVALID      | child init 重复或引用其他 Host。                                      |
| disposed / TRAY_DISPOSED                          | 已关闭 registry 继续接纳操作。                                        |
| loaderContractInvalid / LOADER_CONTRACT_INVALID   | Loader / result / release 外形非法。                                  |
| loaderExecutionFailed / LOADER_EXECUTION_FAILED   | 加载事务内未归属的 loader 执行失败。                                  |
| adapterContractInvalid / ADAPTER_CONTRACT_INVALID | Adapter 或插件返回外形非法。                                          |
| adapterExecutionFailed / ADAPTER_EXECUTION_FAILED | 加载事务内未归属的 adapter 执行失败。                                 |
| runtimeContractInvalid / RUNTIME_CONTRACT_INVALID | Runtime Host / 参数 / callback 或 self ticket 使用违约。              |
| runtimeDisposed / RUNTIME_DISPOSED                | Runtime 关闭后继续接纳 run。                                          |
| runtimeExecutionFailed / RUNTIME_EXECUTION_FAILED | 未归属的 callback throw / reject，使用权仍在结算后释放。              |
| runtimeAborted / RUNTIME_ABORTED                  | 运行租用接纳失败的回退分类；完整外包身份保留，信号取消不强制 reject。 |
| artifactCleanupFailed / ARTIFACT_CLEANUP_FAILED   | 未归属的制品次要清理失败；不替换 mutation primary。                   |
| invalidEntry / TRAY_INVALID_ENTRY                 | 静态 entry、托管 factory 返回或 Host claim 非法。                     |
| duplicateEntry / TRAY_DUPLICATE_ENTRY             | 静态 Graph 重复 key。                                                 |
| unknownEntry / TRAY_UNKNOWN_ENTRY                 | get / entryState 使用未接纳 key。                                     |
| unavailable / TRAY_UNAVAILABLE                    | Graph 或 entry 未 ready、gate 失败或已终结。                          |
| gateReadFailed / TRAY_GATE_READ_FAILED            | readiness 属性或 state/error getter 失败。                            |
| hostMutationBypass / HOST_MUTATION_BYPASS         | 绕开托管 facade 的 concrete Host 变更。                               |

旧四个托管类型辅助导出 IHostBaselinePlugins、IPluginWithSynchronousShared、ICanResolveReadyDefinitions、IResolveReadyTrayPlugins 已取消公开导出；外部标注使用 ITrayResolvedHost / ITrayHostDynamic 或 Runtime 推导。Runtime shutdown 只接收 mode，不再接收未使用的 quiescenceMs；对应预算在 managed Host 配置。Loader / Adapter 方法只读取一次，校验与执行复用同一函数。

包提供 fmt、lint、typecheck、typecheck:test、test、build；清理失败需沿 cause / errors 与 physicalCompletion 记录。此命令清单不声明本页已运行门禁，也不把本地案例当成其他运行时、原生隔离或性能证据。
