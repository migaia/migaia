# `@migaia/plugin-host`

**运行时中立的 TypeScript 插件宿主**——不依赖 Node、Bun、Deno、DOM 或任何具体框架，给你的类库/应用装上一套"可以被别人用插件扩展"的能力。

## 适用与不适用场景

**适用**：你在写一个库（logger、状态管理器、网络客户端……），希望核心保持精简，把颜色输出、批量发送、退出前 flush 这类可选能力做成独立插件，按需装卸；需要插件之间共享能力（比如"批处理"插件的调度器被"HTTP 上报"插件复用）；需要统一的安装失败回滚、卸载资源清理、按插件维度的配置管理；需要一套 sync/async/generator 三选一的处理管线机制。`@migaia/logger` 就是用这套机制实现插件化的真实例子。

**不适用**：如果你的"扩展点"只有一两个、且不需要动态装卸，直接写几个可选参数或组合函数比引入一套插件系统更简单——这个包解决的是"扩展点会持续增长、需要统一治理"这个规模化问题。它也不是通用的处理管线执行器：纯粹的 sync/async/generator middleware 执行算法在 [`@migaia/middleware-pipeline`](../middleware-pipeline/README.md)，本包只负责把插件注册的 stage 接入执行器,并叠加插件注册、生命周期、配置、diagnostic 这层。

## 安装

```bash
pnpm add @migaia/plugin-host
```

包只公开根入口 `@migaia/plugin-host`：`PluginHost`、插件/配置/pipeline 类型、状态常量、错误码与错误类、pipeline 适配器、`GENERATOR_*` 信号量、dispose symbol 均从这里导入。没有稳定的深层子路径；不要依赖 `src`/`dist` 内部文件。

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

---

<a id="核心心智模型五分钟上手"></a>

## 核心心智模型：五分钟上手

```ts
import { PluginHost, type IPlugin } from '@migaia/plugin-host';

// 第一步：定义你的领域能力——这是你的库真正想暴露的核心功能
type ICore = { emit(value: string): void };

class Host extends PluginHost<ICore, string> {
  protected createPluginDomainCore(): ICore {
    return { emit: (value) => console.log(value) };
  }
}

// 第二步：写一个插件——install() 拿到领域 core，返回要挂载到宿主上的方法
const upper: IPlugin<ICore, { upper(value: string): string }> = {
  name: 'upper',
  install: (core) => ({
    upper: (value: string) => {
      const result = value.toUpperCase();
      core.emit(result); // 插件可以调用领域能力
      return result;
    }
  })
};

// 第三步：安装、使用、卸载
const host = await new Host().use(upper);
host.upper('migai'); // 类型上直接就有 upper 方法，TypeScript 自动推导出来的
await host.unUse('upper');
await host.dispose();
```

`PluginHost<TDomainCore, TValue>` 子类唯一必须实现的是 `createPluginDomainCore()`——每次插件安装都会调用一次，产出一份独立的领域 core。插件通过 `install(core)` 拿到"领域能力 + 通用 core 能力"，返回要挂到宿主实例上的扩展方法。`use()`/`unUse()`/`dispose()` 管理插件的生命周期。

---

<a id="host-构造与生命周期-api"></a>

## Host 构造与生命周期 API

```ts
import { PluginHost, type IPluginHostOptions } from '@migaia/plugin-host';
```

**`new Host(options?)`** —— 构造函数，`TValue` 泛型不为 `never` 时才需要用到 pipeline。全部选项字段（`IPluginHostOptions`）：

- `pipeline?: { mode?: 'sync' | 'async' | 'generator' }` —— 默认 `'sync'`；运行期不能切换，非法值抛 `INVALID_PIPELINE_MODE`。
- `diagnostic?: (message: string, code?: IPluginHostErrorCode) => void` —— 接收"不构成错误但值得关注"的信号（如 `PIPELINE_NEXT_LATE`、`EXTENSION_NON_ENUMERABLE_IGNORED`、队列等待）；不是函数会抛 `TypeError`；诊断回调自身抛出的异常永远不会影响宿主正常执行流程。
- `scheduler?: ILifecycleScheduler`（来自 `@migaia/lifecycle`）—— 时间源，默认内部 `systemScheduler`；传入的对象必须提供 `now()`/`schedule()`，否则抛 `TypeError`。
- `queueAdmissionTimeoutMs?: number | false` —— mutation 在 FIFO 队列中等待被拒绝的阈值。**默认 `undefined`：只诊断、不拒绝**（即默认情况下排队再久也不会触发 `MUTATION_QUEUE_TIMEOUT`）；传 `false` 关闭一切队列等待相关的计时器和诊断；传具体数值后，等待超过该阈值会被移出队列并以 `MUTATION_QUEUE_TIMEOUT` reject。
- `queueAdmissionDiagnosticMs?: number | false` —— 未配置 `queueAdmissionTimeoutMs`（拒绝阈值）时使用的诊断阈值，默认 `1000`；传 `false` 关闭该诊断计时器。
- `disposeStepTimeoutMs?: number | false` —— 单个 disposer 步骤（pipeline disposer / 插件 dispose 钩子 / resource disposer）的最长等待时间，默认 `5000`；传 `false` 表示永久等待、不触发 `DISPOSE_STEP_TIMEOUT`。

超时类选项传入非 `false` 的非有限非负数（负数、`NaN`、`Infinity`、非 `number`）一律抛 `TypeError`（`INVALID_OPTION`）。

**Host 实例方法/属性**：

| API                                | 参数                                                               | 返回                               | 作用                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------- |
| `host.use(...plugins)`             | 至少 1 个 `IPlugin`，按顺序安装                                    | `Promise<Host & Extensions>`       | 运行期安装插件；批次内任一失败按逆序回滚整批。                                        |
| `host.unUse(name)`                 | `name: string`                                                     | `Promise<void>`                    | 卸载该插件及其 extension/shared/stage/资源；未知名称无操作。                          |
| `host.dispose()`                   | 无                                                                 | `Promise<void>`                    | 卸载全部插件并永久关闭宿主；重复调用复用同一 Promise。                                |
| `host.config.get(path)`            | `path: string`——插件名，或 `插件名.键` / `插件名.[下标].键`        | `unknown \| undefined`             | 同步读取；对象/数组返回 Readonly 懒代理；未知插件或路径返回 `undefined`。见下方说明。 |
| `host.config.update(name, recipe)` | `name: string`；`recipe(previous) => Partial<patch>`（须同步返回） | `Promise<void>`                    | Copy-on-Write 合并 patch，跑 `plugin.update(next, core)` 成功才提交。                 |
| `host.getShared(key)`              | `key: PropertyKey`                                                 | `T \| undefined`                   | 读取已安装 provider 的 shared 值，原始引用、不做只读包装。                            |
| `host.pipelineMode`                | 无（只读属性）                                                     | `'sync' \| 'async' \| 'generator'` | 构造时固定的 pipeline 模式。                                                          |
| `host.usePipeline(stage)`          | `(value, next) => void`                                            | `this`                             | 按当前 mode 注册；async/generator mode 会自动适配这个 sync 签名。                     |
| `host.useAsyncPipeline(stage)`     | `(value, next) => void \| Promise<void>`                           | `this`                             | 仅 async mode 可用；`next()` 返回 Promise。                                           |
| `host.useGeneratorPipeline(stage)` | `(value) => Generator<...>`                                        | `this`                             | 仅 generator mode 可用。                                                              |
| `PluginHost.setLocale(locale)`     | `locale: 'en' \| 'zh'`（静态方法）                                 | `void`                             | 切换内置错误文案语言，影响全局、全部 Host 实例。                                      |

**`host.config.get(path)` 的路径语义**：`path` 可以是"插件名"本身（返回该插件整份只读配置），也可以是 `插件名.键`（可继续 `.` 或 `.[下标]` 深入嵌套）。找不到匹配的插件、或路径中途缺失，返回 `undefined`（不抛错——读取是探测性操作）；`config.update(name, ...)` 对不存在的插件则抛 `PLUGIN_NOT_INSTALLED`（写入是明确的意图表达，语义不对称）。以上两个方法都要求 Host 处于 `active` 状态，否则抛 `HOST_DISPOSING`/`HOST_DISPOSED`。

**构造函数只接受同步安装的插件**：`new Host({ plugins: ... })` 这种写法不存在——构造期插件走的是子类内部调用受保护的 `useSync(plugins)`，其中任何一个插件的 `install()` 返回 Promise 都会立即抛错；需要异步安装的插件要在宿主构造完成后用 `await host.use(plugin)`。

---

<a id="插件对象与插件-core-api"></a>

## 插件对象与插件 core API

```ts
import type { IPlugin, IPluginConfig, IPluginDisposer, IPluginResource } from '@migaia/plugin-host';
```

**插件对象**（`IPlugin<TCore, TExt, TConfig, TShared>`）全部字段：

- `name: string`（必填）—— Host 内唯一标识，**不能包含 `.`**（会和 `config.get('plugin.key')` 的路径解析产生歧义，安装入口直接拒绝）。
- `config?: TConfig`（可选）—— 初始配置，Host 以深拷贝的所有权快照保存。
- `install(core)`（必填）—— 拿到"领域 core + 通用 core 能力"，返回 `TExt | Promise<TExt>`（plain 对象，构造期同步插件不允许返回 Promise）。
- `shared?: (core) => TShared`（可选）—— 注册给后续插件读取的能力；必须**同步**返回，同名 key 已存在会在安装期抛 `SHARED_DUPLICATE`。
- `update?: (next, core) => void | Promise<void>`（可选）—— 响应 `config.update`；`next` 是候选完整配置的只读视图，成功返回才提交。
- `dispose?: () => void | Promise<void>`（可选）—— 插件级清理。
- `[Symbol.dispose]?: () => void` / `[Symbol.asyncDispose]?: () => void | Promise<void>`（可选）—— 未声明 `dispose` 时的清理兜底，也接受本包导出的 `disposeKey`/`asyncDisposeKey`。

`install()` 返回值只有**可枚举的 data property** 会被挂载到 host；非枚举 key 会被有意忽略并经 `diagnostic` 上报（`EXTENSION_NON_ENUMERABLE_IGNORED`）；getter/setter 形式的属性直接抛 `TypeError`。**保留键不能作为 extension key**：`then`（否则 `await host.use(plugin)` 会把返回值误当成 thenable 解包）、本包的 `disposeKey`/`asyncDisposeKey`（及宿主原生 `Symbol.dispose`/`Symbol.asyncDispose`，若存在），命中会抛 `EXTENSION_RESERVED`；与 Host 上已有属性冲突抛 `EXTENSION_DUPLICATE`；与 `Object.prototype` 成员（如 `toString`）冲突抛 `EXTENSION_OBJECT_PROTOTYPE`。`catch`、`finally` 可以正常使用。

**插件 core**（安装时 `install(core)`/`shared(core)`/`update(next, core)` 拿到的对象）在子类领域方法之上叠加：

| API                                | 参数                                                                 | 返回                 | 说明                                                               |
| ---------------------------------- | -------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------ |
| `core.config.get<T>()`             | 无运行时参数                                                         | `IReadonlyConfig<T>` | 当前插件已提交配置的只读懒代理；嵌套对象/数组按访问路径缓存代理。  |
| `core.getShared<T>(key)`           | `key: PropertyKey`                                                   | `T \| undefined`     | 读取安装顺序中更早的 provider 提供的 shared 值。                   |
| `core.onDispose(resource)`         | `IPluginResource`（函数 / `Symbol.dispose` / `Symbol.asyncDispose`） | `void`               | **仅 `install()` 期间可调用**；否则抛 `RESOURCE_OUTSIDE_INSTALL`。 |
| `core.usePipeline(stage)`          | `(value, next) => void`                                              | `core`               | 同 Host 侧 `usePipeline`，仅 install 期间可注册。                  |
| `core.useAsyncPipeline(stage)`     | `(value, next) => void \| Promise<void>`                             | `core`               | 仅 install 期间、且 Host mode 为 `async` 时可用。                  |
| `core.useGeneratorPipeline(stage)` | `(value) => Generator`                                               | `core`               | 仅 install 期间、且 Host mode 为 `generator` 时可用。              |

领域 core（`createPluginDomainCore()` 的返回值）不能定义与上表同名的字段（`config`/`getShared`/`onDispose`/`usePipeline`/`useAsyncPipeline`/`useGeneratorPipeline` 是保留键），且必须是普通对象、字段都是可枚举 data property，否则构造时抛 `TypeError`。

**同步安装的插件不能注册 async disposer**：`useSync`（构造函数期）安装的插件，若声明 `async function dispose()` 或提供 `Symbol.asyncDispose`，会在 `onDispose()` 注册那一刻被同步拒绝——因为同步安装的回滚契约要求全部清理工作真正同步完成。**不要把 `use`/`unUse`/`config.update`/`dispose` 暴露给插件 core，插件生命周期钩子内也不能调用当前 Host 的这几个方法**——会同步抛 `LIFECYCLE_MUTATION`。

---

<a id="pipeline-处理管线"></a>

## Pipeline 处理管线

构造时选择一种模式，运行期不能切换：

```ts
const host = new Host({ pipeline: { mode: 'sync' } });
host.usePipeline((value, next) => next(value.trim()));
```

| 模式        | stage 形式                    | `next` 规则                                                                                                                                                                                                |
| ----------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sync`      | `(value, next) => void`       | 必须在 stage 返回前调用；延后调用被忽略并触发 `PIPELINE_NEXT_LATE` 诊断。                                                                                                                                  |
| `async`     | `async (value, next) => void` | `await next(value)`；同一次调用重复 `next()` 抛 `PIPELINE_NEXT_DUPLICATE`。                                                                                                                                |
| `generator` | `function* (value)`           | `return value` 继续；`return undefined` 终止；`GENERATOR_CONTINUE` 用最后一次 yield 的值；`GENERATOR_HALT` 终止整条链；`GENERATOR_UNDEFINED` 显式表达 `undefined`（仅 `TValue` 允许 `undefined` 时可用）。 |

**sync 是扁平转换管道**：`next()` 只记录下一个值，下游 stage 在当前 stage 返回**之后**才执行。**async 是洋葱模型**：`await next(value)` 会等下游链跑完才继续，因此当前 stage 能在 `next()` 之后写"后置逻辑"。三种模式执行期间均拒绝注册新 stage（`PIPELINE_EXECUTING`），且嵌套调用用深度计数、外层未结束前依然拒绝。async pipeline 的 stage 与 downstream 同时失败会聚合成 `AggregateError`（`PIPELINE_FAILED`）。

Host 侧注册 stage 后，应由子类在自己的领域入口里调用受保护的 `runPipeline(value, done)` 触发一次遍历。

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
  PluginHostPipelineMode,
  PluginHostRegistrationLifecycle,
  PluginHostPipelineViolation
} from '@migaia/plugin-host';
```

- **`PluginHostError`**：本包语义化错误的基类，`extends Error`，携带只读 `source`（恒为 `'@migaia/plugin-host'`）、`code: IPluginHostErrorCode`、可选 `detail`（结构化诊断字段，如队列超时的 `owner`/`waitedMs`）。除此之外，插件名/配置路径/pipeline stage/extension/domain core/资源 disposer 等**入参校验失败一律用原生 `TypeError`**（挂 `code: 'INVALID_OPTION'`）表达，不是 `PluginHostError`——判断输入错误用 `error instanceof TypeError`，判断协议/状态错误用 `error instanceof PluginHostError` 或按 `error.code` 分支。
- **`PluginHostErrorCode`**：24 个稳定错误码常量对象，取值见 [USEGUIDE §9](./USEGUIDE.md#9-错误码完整参考)。
- 导出的稳定码包括：`HOST_DISPOSED`、`HOST_DISPOSING`、`PLUGIN_DUPLICATE`、`PLUGIN_NOT_INSTALLED`、`PLUGIN_INSTALL_FAILED`、`PLUGIN_DISPOSE_FAILED`、`HOST_DISPOSE_FAILED`、`EXTENSION_DUPLICATE`、`EXTENSION_OBJECT_PROTOTYPE`、`EXTENSION_RESERVED`、`SHARED_DUPLICATE`、`RESOURCE_OUTSIDE_INSTALL`、`LIFECYCLE_MUTATION`、`INVALID_PIPELINE_MODE`、`PIPELINE_MODE_MISMATCH`、`PIPELINE_NEXT_DUPLICATE`、`PIPELINE_NEXT_LATE`、`PIPELINE_EXECUTING`、`PIPELINE_FAILED`、`PLUGIN_INSTALL_ROLLBACK_FAILED`、`EXTENSION_NON_ENUMERABLE_IGNORED`、`MUTATION_QUEUE_TIMEOUT`、`DISPOSE_STEP_TIMEOUT`、`INVALID_OPTION`。完整触发条件与处理建议见 [USEGUIDE §9](./USEGUIDE.md#9-错误码完整参考)。
- **`ERROR_TEXT`**（默认导出）：本包内置的中/英双语错误文案表，主要供内部构造错误消息使用；对外暴露是为了让下游包在自定义 `diagnostic` 回调里复用同一套措辞，一般无需直接调用。
- **`PluginHost.setLocale(locale: ILocaleKey)`**：静态方法，`ILocaleKey = 'en' | 'zh'`，切换 `ERROR_TEXT` 与后续抛出错误的默认语言，默认 `'zh'`，全局生效（不是每个 Host 实例独立）。
- **`PluginHostStatus`**：`{ active, closing, disposed }`——Host 的三态生命周期，`closing` 是 `dispose()` 已开始、尚未收敛的窗口。
- **`PluginHostPipelineMode`**：`{ sync, async, generator }`——即构造选项 `pipeline.mode` 的合法取值集合，`host.pipelineMode` 返回其中之一。
- **`PluginHostRegistrationLifecycle`**：`{ idle, install, dispose }`——单个插件注册记录当前所处的阶段，决定 `onDispose()`/pipeline 注册是否合法（只在 `install` 阶段允许）。一般只在自定义诊断/调试时需要引用。
- **`PluginHostPipelineViolation`**：`{ late, duplicate }`——pipeline `next()` 违规的两种分类，供内部诊断分支使用；公开导出主要用于类型层面的穷尽性检查。

---

<a id="底层适配器与信号量"></a>

## 底层适配器与信号量

```ts
import {
  adaptSyncStageToAsync,
  adaptSyncStageToGenerator,
  GENERATOR_CONTINUE,
  GENERATOR_HALT,
  GENERATOR_UNDEFINED,
  disposeKey,
  asyncDisposeKey
} from '@migaia/plugin-host';
```

这一组导出面向**自己动手拼装 pipeline 执行、或直接对接 `@migaia/middleware-pipeline`** 的场景，日常使用 `host.use()`/`usePipeline()` 不需要它们。

- **`adaptSyncStageToAsync(stage, onViolation?)`** —— 把一个 `(value, next) => void` 形状的 sync stage 包装成 async stage（`(value, next) => Promise<void> | void`），语义与 Host 内部把 `usePipeline()` 注册的 stage 适配进 async/generator mode 时完全一致。`onViolation` 默认空函数。
- **`adaptSyncStageToGenerator(stage, onViolation)`** —— 同上，适配成 generator stage；`onViolation` 必填。
- **`GENERATOR_CONTINUE`/`GENERATOR_HALT`/`GENERATOR_UNDEFINED`** —— generator pipeline 专用的哨兵值（`unique symbol`，直接从 `@migaia/middleware-pipeline` 转发，保持跨包同一身份）：generator stage 的 `return` 可以返回它们中的一个来表达"继续/终止/显式 undefined"，语义见上方 [Pipeline 处理管线](#pipeline-处理管线) 表格。
- **`disposeKey`/`asyncDisposeKey`** —— 本包自声明的 `unique symbol`（不依赖 `ESNext.Disposable` lib），语义等价于宿主原生 `Symbol.dispose`/`Symbol.asyncDispose`。插件/资源可以用这两个 key 之一声明清理方法，运行时会把自声明 symbol 与宿主真实 symbol（若存在）都识别为等价键。

```ts
import { adaptSyncStageToAsync } from '@migaia/plugin-host';

// 直接对接 @migaia/middleware-pipeline 的 async runner，复用同一个 sync stage 实现
const asyncStage = adaptSyncStageToAsync<string>((value, next) => next(value.trim()));
```

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. 带配置、shared 能力、失败回滚的完整插件组合

```ts
import { PluginHost, type IPlugin } from '@migaia/plugin-host';

type ICore = { write(text: string): void };
type IFormatterConfig = { prefix?: string };
type IFormatterShared = { format: (value: string) => string };

const formatter: IPlugin<ICore, {}, IFormatterConfig, IFormatterShared> = {
  name: 'formatter',
  config: { prefix: '[app]' },
  install: () => ({}),
  shared: (core) => ({ format: (value: string) => `${core.config.get().prefix} ${value}` })
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

### 2. async pipeline 做请求耗时统计（洋葱模型的"前置 + 后置"）

```ts
import { PluginHost } from '@migaia/plugin-host';

type IRequest = { path: string; startedAt?: number };

class Host extends PluginHost<{}, IRequest> {
  protected createPluginDomainCore() {
    return {};
  }
  handle(request: IRequest): Promise<void> {
    return this.runPipeline(request, (final) =>
      console.log('handled', final.path)
    ) as Promise<void>;
  }
}

const host = new Host({ pipeline: { mode: 'async' } });
host.useAsyncPipeline(async (value, next) => {
  const startedAt = Date.now();
  await next({ ...value, startedAt }); // 前置：给下游打时间戳
  console.log(`${value.path} took ${Date.now() - startedAt}ms`); // 后置：下游跑完才执行
});

await host.handle({ path: '/users' });
```

### 3. 用 `diagnostic` + 自定义队列/清理超时观测宿主内部行为

```ts
import { PluginHost, type IPluginHostErrorCode } from '@migaia/plugin-host';

class Host extends PluginHost<{}, never> {
  protected createPluginDomainCore() {
    return {};
  }
}

const events: { message: string; code?: IPluginHostErrorCode }[] = [];
const host = new Host({
  diagnostic: (message, code) => events.push({ message, code }),
  queueAdmissionTimeoutMs: 2000, // 显式开启拒绝阈值——默认是"只诊断不拒绝"
  queueAdmissionDiagnosticMs: 200, // 排队超过 200ms 先打一条诊断
  disposeStepTimeoutMs: 3000 // 单个 disposer 最多等 3 秒
});

await host.use({
  name: 'slow',
  install: (core) => {
    core.onDispose(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    return {};
  }
});
await host.dispose();
// events 里可能包含排队等待、非枚举扩展被忽略等诊断，取决于实际时序
```

### 4. 优雅降级：安装失败时读出真实原因与回滚详情

```ts
import { PluginHost, PluginHostError, type IPlugin } from '@migaia/plugin-host';

class Host extends PluginHost<{}, never> {
  protected createPluginDomainCore() {
    return {};
  }
}

const broken: IPlugin<{}, {}> = {
  name: 'broken',
  install: () => {
    throw new Error('boom');
  }
};

try {
  await new Host().use(broken);
} catch (error) {
  if (error instanceof PluginHostError && error.code === 'PLUGIN_INSTALL_FAILED') {
    console.error('安装失败，原始错误:', (error.cause as Error).message); // 'boom'
  }
}
```

### 5. generator pipeline：用 `GENERATOR_HALT` 提前截断处理链

```ts
import { PluginHost, GENERATOR_HALT } from '@migaia/plugin-host';

type IEvent = { level: 'info' | 'debug'; message: string };

class Host extends PluginHost<{}, IEvent> {
  protected createPluginDomainCore() {
    return {};
  }
  emit(event: IEvent): void {
    this.runPipeline(event, (final) => console.log(final.level, final.message));
  }
}

const host = new Host({ pipeline: { mode: 'generator' } });
host.useGeneratorPipeline(function* (value) {
  if (value.level === 'debug') return GENERATOR_HALT; // 直接丢弃 debug 事件，后续 stage 不再执行
  return value;
});

host.emit({ level: 'info', message: 'ready' }); // 打印
host.emit({ level: 'debug', message: 'noisy' }); // 被截断，不打印
```

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
