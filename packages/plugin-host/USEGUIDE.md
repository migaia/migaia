# @migai/plugin-host 使用指南

## 1. 适用范围

`PluginHost<TDomainCore, TValue>` 是基础实现：它不知道业务领域，也不替你实现日志、网络、状态或 UI。子类只提供领域 core；插件通过该 core 使用领域能力，通过 PluginHost 注入通用能力。

```ts
type ICore = { publish(value: string): void };
class Host extends PluginHost<ICore, string> {
  protected createPluginDomainCore(): ICore {
    return { publish: (value) => console.log(value) };
  }
}
```

## 2. Host API

| API / 签名                         | 参数                                                           | 必填性          | 返回值                             | 作用                                                                                                                                                         |
| ---------------------------------- | -------------------------------------------------------------- | --------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `host.use(...plugins)`             | `plugins: IPlugin[]`，按顺序安装                               | 至少 1 个，必填 | `Promise<Host & Extensions>`       | 安装插件。同步安装会立刻挂载 extension；仍应 await 以处理异步安装或失败。                                                                                    |
| `host.unUse(name)`                 | `name: string`，插件唯一名称                                   | `name` 必填     | `Promise<void>`                    | 卸载该插件及其 extension、shared、stage、登记资源；未知名称无操作。                                                                                          |
| `host.dispose()`                   | 无                                                             | 无参数          | `Promise<void>`                    | 卸载所有插件并永久关闭 Host；重复调用复用同一 Promise。                                                                                                      |
| `host.config.get(name?)` | 可选插件名；省略时读取全部配置 | 无 | 配置快照 | 省略 name 时返回无原型对象（`Object.create(null)`）；请用 `Object.keys` / `in` 访问，不要调用 `hasOwnProperty` 或依赖 `toString`。 |
| `host.config.update(name, recipe)` | `name: string`；`recipe(previous) => patch`，同步 plain record | 两项都必填      | `Promise<void>`                    | 浅合并 patch，执行 `plugin.update(next, core)` 后提交；失败不提交；提交配置与 patch 完全隔离。                                                               |
| `host.config.get(name)`            | `name: string`                                                | `name` 可选      | `Readonly<T> \| undefined`         | 返回指定已安装插件的深拷贝配置；未知插件返回 `undefined`。                                                               |
| `host.config.get()`                | 无                                                           | 无参数          | `Readonly<Record<string, IPluginConfig>>` | 返回所有已安装插件配置的深拷贝快照；包含配置内容与插件名。                                                               |
| `host.getShared(key)`              | `key: PropertyKey`                                             | `key` 必填      | `T \| undefined`                   | 读取已安装 provider 的 shared 值。                                                                                                                           |
| `host.pipelineMode`                | 无                                                             | 无参数          | `'sync' \| 'async' \| 'generator'` | 构造时由 `new Host({ pipeline?: { mode?: ... } })` 固定；`pipeline`、`mode` 都可选。                                                                         |
| `host.usePipeline(stage)`          | `stage: (value, next) => void`                                 | `stage` 必填    | `this`                             | 按当前 mode 注册；async/generator mode 自动适配。`next(value)` 必须在函数返回前调用。                                                                          |
| `host.useAsyncPipeline(stage)`     | `stage: (value, next) => void \| Promise<void>`                | `stage` 必填    | `this`                             | 注册 async stage；`next(value)` 返回 Promise，通常应 await。                                                                                                 |
| `host.useGeneratorPipeline(stage)` | `stage: (value) => Generator<value, value \| control signal>`  | `stage` 必填    | `this`                             | 注册 generator stage；使用 `GENERATOR_HALT` 终止、`GENERATOR_CONTINUE` 采用最后一次 yield；只有 `TValue` 包含 `undefined` 时才能使用 `GENERATOR_UNDEFINED`。 |
| `PluginHost.setLocale(locale)`     | `locale: ILocaleKey`                                           | `locale` 必填   | `void`                             | 修改后续 Host 错误的本地化文本。                                                                                                                             |

`dispose()` 开始后拒绝新的 mutation；此前已经被接纳的 mutation 会先按队列完成。

`getShared()` 返回 provider 明确共享的原始引用，不提供 config 式深拷贝；provider 与 consumer 应共同约定其可变性和生命周期。

错误边界约定：`PluginHostError` 用于可由调用方按错误码处理的 host 状态/协议错误；`TypeError` 用于插件输入形状不符合 JavaScript API 约束（plain object、data property、disposer、extension descriptor 等），因此这类输入校验不提供 host 错误码。

## 3. 插件对象 API

```ts
import type { IPlugin } from '@migai/plugin-host';

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

| 字段 / 签名                                  | 输入                                                                         | 必填性 | 返回值                           | 作用                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------- | ------ | -------------------------------- | ----------------------------------------- |
| `name`                                       | `string`，非空                                                               | 必填   | 无                               | 当前 Host 内的唯一插件标识。              |
| `config`                                     | `TConfig extends Record<string, unknown>`                                    | 可选   | 无                               | 初始配置；Host 以浅只读快照保存。         |
| `install(core)`                              | 领域 core 与 `config.get()`、`getShared()`、`onDispose()`、pipeline 注册方法 | 必填   | `TExt \| Promise<TExt>`          | 初始化插件并返回 plain extension record。 |
| `shared(core)`                               | 同 install core                                                              | 可选   | `TShared` plain record           | 注册供后续插件读取的能力。                |
| `update(next, core)`                         | `next: Readonly<TConfig>`，候选完整配置                                      | 可选   | `void \| Promise<void>`          | 响应 `config.update`；成功才提交 `next`。 |
| `dispose()`                                  | 无                                                                           | 可选   | `void \| Promise<void>`          | 插件级清理。                              |
| `[Symbol.dispose]` / `[Symbol.asyncDispose]` | 无                                                                           | 可选   | `void` / `void \| Promise<void>` | 未声明 `dispose` 时的清理兜底。           |

extension 的可枚举 data property 会挂载到 host。`then` 被保留，不能作为 extension key；`catch`、`finally` 可以使用。

## 4. 插件 core API

安装时获得的 `core` 是稳定 facade。它包含子类提供的领域方法，加上下面的通用能力。

| API / 签名                         | 参数                                            | 必填性          | 返回值           | 作用                                                                                                       |
| ---------------------------------- | ----------------------------------------------- | --------------- | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `core.config.get<T>()`             | 可选泛型 `T`，通常由插件 config 推导            | 无运行时参数    | `Readonly<T>`    | 当前插件的已提交配置快照；plain object 嵌套值会深拷贝隔离，Date/Map/Set/RegExp 等非 plain 对象按引用共享。 |
| `core.getShared<T>(key)`           | `key: PropertyKey`                              | `key` 必填      | `T \| undefined` | 读取安装顺序中更早 provider 的 shared 值。                                                                 |
| `core.onDispose(resource)`         | disposer function 或 disposable object          | `resource` 必填 | `void`           | 仅 `install()` 期间可调用；卸载时按逆序执行。                                                              |
| `core.usePipeline(stage)`          | `stage: (value, next) => void`                  | `stage` 必填    | `core`           | 按当前 mode 注册；pipeline stage 执行期间不得注册 stage。                                                   |
| `core.useAsyncPipeline(stage)`     | `stage: (value, next) => void \| Promise<void>` | `stage` 必填    | `core`           | 仅 install 期间注册 async stage。                                                                          |
| `core.useGeneratorPipeline(stage)` | `stage: (value) => Generator`                   | `stage` 必填    | `core`           | 仅 install 期间注册 generator stage。                                                                      |

`onDispose` 接受函数、`{ [Symbol.dispose]() }` 或 `{ [Symbol.asyncDispose]() }`。资源、shared、pipeline stage 和 extension 都由安装记录拥有；`unUse()` 时会撤销它们。

不要把 `use`、`unUse`、`config.update` 或 `dispose` 暴露给插件 core。插件也不得在自己的 lifecycle hook 中等待同一 Host 的 mutation，否则会形成队列自等待。

TypeScript 的已安装插件类型只会随 `use()` 累加，不会因 `unUse()` 递减；卸载后的类型仍应视为静态能力记录，这是当前 API 的已知限制。

## 5. 配置

```ts
await host.config.update('prefix', (previous) => ({
  prefix: `${previous.prefix ?? 'hello'}!`
}));
```

`recipe` 必须同步返回 plain record。Host 对 patch 做浅合并；嵌套对象应视为不可变值。`update()` 失败时旧配置保持不变。插件在 `update(next)` 中通过 `next` 读取候选配置，`core.config.get()` 仍是已提交配置。

`host.config.get()` 与 `host.config.update()` 都要求 Host 处于 active 状态；Host 开始卸载或卸载完成后会抛出 `HOST_DISPOSING` 或 `HOST_DISPOSED`。`get(name)` 对不存在的插件返回 `undefined`，而 `update(name, ...)` 对不存在的插件抛出 `PLUGIN_NOT_INSTALLED`。配置读取每次返回隔离快照；`host.config` facade 本身在重复访问时保持同一引用。

## 6. shared 能力

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

shared 的顺序就是安装顺序。相同 key 会报错；Host 不维护依赖图，移除 provider 前必须先移除 consumer。已缓存的 shared 函数引用无法被 Host 追溯撤销。

## 7. Pipeline

构造时选择一种模式，不能混用。

```ts
const host = new Host({ pipeline: { mode: 'sync' } });
host.usePipeline((value, next) => next(value.trim()));
```

| 模式        | stage 形式                    | `next` 规则                                                                                                                                                                                       |
| ----------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sync`      | `(value, next) => void`       | 必须在 stage 返回前调用；延后调用会被忽略并告警。                                                                                                                                                 |
| `async`     | `async (value, next) => void` | `await next(value)`。                                                                                                                                                                             |
| `generator` | `function* (value)`           | `return value` 继续；`return undefined` 终止；`GENERATOR_CONTINUE` 采用最后一次 yield；`GENERATOR_HALT` 终止；`GENERATOR_UNDEFINED` 表示显式的 undefined 值（仅适用于允许 undefined 的 TValue）。 |

sync 是扁平转换管道：`next()` 只记录下一个值，下游 stage 在当前 stage 返回后执行，因此 stage 在 `next()` 后不能观察下游结果。async 是洋葱模型：`await next(value)` 会等待下游完成，随后继续执行当前 stage 的后置逻辑。切换 pipeline mode 会改变这一执行顺序。

Host 侧注册 stage 后，应由子类在其领域入口调用受保护的 `runPipeline(value, done)`。三种 pipeline 在执行期间均拒绝注册新 stage；嵌套 pipeline 使用深度计数，外层执行未结束前仍保持拒绝。插件 stage 的自动清理不覆盖正在执行的调用；调用方在 `unUse()` 或 `dispose()` 前应自行停止提交并 drain 现有业务工作。

## 8. 生命周期与错误

1. `use` 逐个安装；批次中任一安装失败会回滚已安装项。
2. `unUse` 依次移除 pipeline、shared、插件 cleanup、已挂载 extension。
3. plugin lifecycle hook 内禁止调用当前 Host 的 `use`、`unUse`、`config.update` 或 `dispose`；这些违规会同步抛出 `LIFECYCLE_MUTATION`。应用组合层负责维护插件拓扑。
4. cleanup 报错时，Host 仍移除可发现状态，随后 Promise reject。
5. Host 被 dispose 后，所有访问/变更 API 都会以 `PluginHostError` reject 或抛出；入口守卫同步抛出，队列内运行失败以 rejected Promise 返回。

`use()` 的安装失败统一以 `PluginHostError`（`PLUGIN_INSTALL_FAILED`）返回，实际安装错误位于 `cause`；若回滚也失败，`cause` 为包含各阶段错误的 `AggregateError`。pipeline stage 不调用 `next()` 时，该次 pipeline 会被拦截且 `done` 不执行，但调用仍会正常完成；调用方应自行保证每个 stage 按约定推进。

错误码通过 `PluginHostErrorCode` 导出：

| code | 含义 |
| --- | --- |
| `HOST_DISPOSED` | Host 已完成卸载，不能再访问或变更。 |
| `HOST_DISPOSING` | Host 正在卸载，不能开始新的变更。 |
| `PLUGIN_DUPLICATE` | 插件已安装或同一批次中重复。 |
| `PLUGIN_NOT_INSTALLED` | 目标插件未安装。 |
| `PLUGIN_INSTALL_FAILED` | 插件安装失败；原始错误位于 `cause`。 |
| `PLUGIN_DISPOSE_FAILED` | 单个插件卸载失败；原始错误位于 `cause`。 |
| `HOST_DISPOSE_FAILED` | Host 整体卸载失败；原始错误位于 `cause`。 |
| `EXTENSION_DUPLICATE` | extension key 与已有成员冲突。 |
| `EXTENSION_OBJECT_PROTOTYPE` | extension key 与 `Object.prototype` 成员冲突。 |
| `EXTENSION_RESERVED` | extension key 为 Host 保留成员。 |
| `SHARED_DUPLICATE` | shared key 已被占用。 |
| `RESOURCE_OUTSIDE_INSTALL` | 在允许的插件生命周期外注册资源或 stage。 |
| `LIFECYCLE_MUTATION` | 插件 lifecycle hook 内尝试变更 Host。 |
| `INVALID_PIPELINE_MODE` | pipeline mode 无效或与当前模式不匹配。 |
| `PIPELINE_MODE_MISMATCH` | Host mode 合法，但调用了与当前 mode 不匹配的 stage 注册方法。 |
| `PIPELINE_EXECUTING` | pipeline 执行期间尝试注册 stage。 |
| `PIPELINE_NEXT_DUPLICATE` | 同一 stage 重复调用 `next`。 |
| `PIPELINE_NEXT_LATE` | stage 返回后调用 `next`。 |
