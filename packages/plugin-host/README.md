# @migaia/plugin-host

**运行时中立的 TypeScript 插件宿主**——不依赖 Node、Bun、Deno、DOM 或任何具体框架，给你的类库/应用装上一套"可以被别人用插件扩展"的能力。

## 1. 这是什么

假设你在写一个库（比如一个 logger、一个状态管理器、一个网络客户端），一开始功能很简单，但很快就会有人想要："能不能加个颜色输出""能不能批量发送""能不能在退出前自动 flush"……如果每个需求都直接写进核心代码，核心会越来越臃肿，而且大部分用户根本用不到这些功能，却要背负它们的体积和复杂度。

更好的做法是把核心做薄，把具体能力做成一个个独立的"插件"，用户按需选装。但"插件系统"本身不好写：怎么给插件一个统一、安全的接口去访问核心能力？怎么保证一个插件出错时不会把整个宿主搞崩？怎么做到插件之间可以互相提供能力（A 插件提供的方法给 B 插件用）？卸载一个插件时怎么保证它注册的资源、监听器、扩展方法都被干净地撤销？这些问题几乎每个想做"可扩展"的库都会重新发明一遍轮子。

`@migaia/plugin-host` 就是把这套"插件宿主"基础设施抽出来、独立成包的实现。你的库只需要继承 `PluginHost` 这个抽象类，提供自己的"领域能力"（比如 logger 提供 `log()`，网络客户端提供 `request()`），插件系统的安装顺序、生命周期、配置管理、资源回收、共享能力注入、处理管线（pipeline）这些通用机制全部由它负责。`@migaia/logger` 就是用这套机制实现插件化的一个真实例子。

## 2. 适合什么场景

| 场景 | 说明 |
| --- | --- |
| 你在写一个需要"可插拔扩展"的库 | 核心保持精简，具体能力（格式化、批处理、上报、鉴权……）做成独立插件 |
| 需要插件之间共享能力 | 比如"批处理"插件提供的批量调度器，被"HTTP 上报"插件复用 |
| 需要统一的插件生命周期管理 | 安装失败自动回滚、卸载时资源自动清理、构造期同步安装 + 运行期动态安装并存 |
| 需要按插件维度做配置管理 | 每个插件独立配置、支持动态更新，互不干扰 |
| 需要一套通用的"处理链"机制 | 比如日志的加工管线、请求的中间件链——sync/async/generator 三种执行模型都支持 |

不适合的场景：如果你的"扩展点"少到只有一两个、且不需要动态装卸，直接写几个可选参数或者组合函数可能比引入一套插件系统更简单——这个包解决的是"扩展点会持续增长、需要统一治理"这个规模化问题。

## 3. 用了之后能得到什么

- **插件安装即失败即回滚**：一批插件里任何一个安装失败，之前已经安装成功的插件会按逆序自动清理，不会留下"装了一半"的宿主。
- **卸载彻底、不留垃圾**：`unUse(name)` 会撤销该插件注册的 extension 方法、shared 能力、pipeline stage、通过 `onDispose()` 登记的资源，全部按逆序执行。
- **类型随插件安装自动累加**：`await host.use(pluginA, pluginB)` 之后，`host` 的 TypeScript 类型上会自动出现插件暴露的方法，不需要手写类型断言。
- **插件间可以互相提供能力**：`shared()` 机制让后安装的插件能读到先安装插件暴露的能力，重复 key 直接在安装期报错，不会静默覆盖。
- **三种处理管线模型任选**：sync（扁平转换）、async（洋葱模型，可 await 下游）、generator（基于生成器的流程控制），一个宿主实例固定一种，插件按这个模型注册处理阶段。
- **资源清理协议标准化**：`onDispose()` 接受普通函数、`Symbol.dispose`、`Symbol.asyncDispose` 三种形式，不用每个插件自己发明清理约定。
- **运行时中立**：不 import DOM、不依赖 Node 内置模块，浏览器、Worker、Node、Bun、Deno、小程序、Electron 主进程/渲染进程都能跑。

## 4. 五分钟上手

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

看懂这个例子，你就理解了核心心智模型：**`PluginHost` 子类提供"领域能力"（`createPluginDomainCore`），插件通过 `install(core)` 拿到这份能力并返回"扩展方法"，`use()`/`unUse()` 管理插件的生命周期**。真实项目里，`@migaia/logger` 的 `level()`/`color()`/`http()` 等插件就是照这个模式写的。

## 5. 核心概念一览

| 概念 | 是什么 |
| --- | --- |
| **Host（宿主）** | 你继承 `PluginHost` 写出的类，代表"这个可扩展的东西" |
| **领域 Core（domain core）** | 宿主提供给插件的、业务相关的基础能力（`createPluginDomainCore()` 的返回值） |
| **Plugin（插件）** | 一个 `{ name, install, dispose?, shared?, update? }` 形状的对象 |
| **Extension（扩展）** | 插件 `install()` 的返回值，挂载到宿主实例上的方法/属性 |
| **Shared（共享能力）** | 插件通过 `shared()` 暴露给"后安装插件"读取的能力 |
| **Pipeline（处理管线）** | sync/async/generator 三选一的处理阶段链，插件可以往里插入处理逻辑 |
| **Disposer（清理器）** | 插件通过 `onDispose()` 登记的资源清理函数，卸载时逆序执行 |

## 6. 常用能力速览

| 方法/签名 | 参数类型 | 同步/异步 | 用途 |
| --- | --- | --- | --- |
| `host.use(...plugins)` | `plugins: IPlugin[]` | 异步 | 安装一批插件（构造期用 `useSync`，运行期用 `use`） |
| `host.unUse(name)` | `name: string` | 异步 | 按名字卸载单个插件，自动清理其全部资源 |
| `host.dispose()` | 无 | 异步 | 卸载全部插件并永久关闭宿主 |
| `host.config.get(path)` | `path: string` | 同步 | 按插件维度读取配置 |
| `host.config.update(name, recipe)` | `name: string`；`recipe: (previous) => patch` | 异步 | 按插件维度更新配置 |
| `host.getShared(key)` | `key: PropertyKey` | 同步 | 读取插件通过 `shared()` 暴露的能力 |
| `host.usePipeline(stage)` | `stage: (value, next) => void` | 同步 | 注册处理管线阶段（sync mode） |
| `host.useAsyncPipeline(stage)` | `stage: (value, next) => void \| Promise<void>` | 同步 | 注册处理管线阶段（async mode，注册调用本身同步） |
| `host.useGeneratorPipeline(stage)` | `stage: (value) => Generator` | 同步 | 注册处理管线阶段（generator mode） |
| `PluginHost.setLocale(locale)` | `locale: 'en' \| 'zh'` | 同步 | 切换内置错误文案的语言 |

## 7. 支持环境

- Chrome 85+ / Edge 85+ / Firefox 79+ / Opera 71+ / Safari 14+
- Node、Bun、Deno、Worker、小程序、Electron 主/渲染进程
- 产物基线 ES2020，需要 `Promise`、`Map`、`Symbol`、`AggregateError`；`Symbol.dispose`/`Symbol.asyncDispose` 仅作为可用时的清理兜底，不强制要求 polyfill

## 8. 注意事项（最容易踩的坑）

1. **构造函数只接受同步安装的插件**。`new Host({ plugins: [...] })` 里任何一个插件的 `install()` 返回 Promise 都会立即抛错；需要异步安装的插件要在宿主构造完成后用 `await host.use(plugin)`。
2. **插件生命周期钩子内禁止调用当前宿主的 `use`/`unUse`/`config.update`/`dispose`**，这类调用会同步抛出 `LIFECYCLE_MUTATION`——插件的组合关系应该由应用层统一编排，不要在插件内部自己触发宿主变更。
3. **一个插件对象只能安装一次**，不要把同一个有状态的插件实例复用到多个宿主——每次安装应该重新调用一次插件工厂函数，否则内部状态可能在多个宿主之间串联。
4. **`config.get()`/`core.config.get()` 只做一层浅拷贝**，嵌套对象/数组仍是原始引用共享，这是有意的设计取舍（详见 USEGUIDE），不是深拷贝的阉割版。
5. **`then` 不能作为 extension 方法名**（会被当成 thenable 处理，导致 `await host.use(...)` 的结果被错误地解包）；`catch`、`finally` 可以正常使用。
6. **`unUse()` 之后 TypeScript 类型不会自动收窄**——已安装插件的类型记录只会随 `use()` 累加，这是当前实现的已知限制，见 USEGUIDE。

## 9. 深入参考

插件对象/领域 core 完整字段参考、三种 pipeline 模型的精确执行顺序、配置系统的读写边界、shared 能力的依赖管理、生命周期与错误码完整表、`Symbol.dispose`/`Symbol.asyncDispose` 清理协议细节、以及更多贴近真实场景的组合示例，见 **[USEGUIDE.md](./USEGUIDE.md)**。

公开错误码：`HOST_DISPOSED`、`HOST_DISPOSING`、`PLUGIN_DUPLICATE`、`PLUGIN_NOT_INSTALLED`、`PLUGIN_INSTALL_FAILED`、`PLUGIN_DISPOSE_FAILED`、`HOST_DISPOSE_FAILED`、`EXTENSION_DUPLICATE`、`EXTENSION_OBJECT_PROTOTYPE`、`EXTENSION_RESERVED`、`SHARED_DUPLICATE`、`RESOURCE_OUTSIDE_INSTALL`、`LIFECYCLE_MUTATION`、`INVALID_PIPELINE_MODE`、`PIPELINE_MODE_MISMATCH`、`PIPELINE_NEXT_DUPLICATE`、`PIPELINE_NEXT_LATE`、`PIPELINE_EXECUTING`、`PLUGIN_INSTALL_ROLLBACK_FAILED`、`EXTENSION_NON_ENUMERABLE_IGNORED`、`MUTATION_QUEUE_TIMEOUT`、`DISPOSE_STEP_TIMEOUT`。
