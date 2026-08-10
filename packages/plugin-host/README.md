# @migai/plugin-host

运行时中立的 TypeScript 插件宿主。它管理插件安装、配置、共享能力、管线和清理；不依赖 Node、Bun、Deno、DOM 或任意框架运行时。

## 安装与最小用法

```ts
import { PluginHost, type IPlugin } from '@migai/plugin-host'

type ICore = { emit(value: string): void }

class Host extends PluginHost<ICore, string> {
  protected createPluginDomainCore(): ICore {
    return { emit: (value) => console.log(value) }
  }
}

const upper: IPlugin<ICore, { upper(value: string): string }> = {
  name: 'upper',
  install: () => ({ upper: (value) => value.toUpperCase() })
}

const host = await new Host().use(upper)
host.upper('migai')
await host.unUse('upper')
await host.dispose()
```

`use(...plugins)` 返回 Promise。同步插件会在当前调用栈完成挂载，但仍应 `await`，以处理异步插件的安装和失败。

## 能力

- 顺序安装和顺序串行的 `use`、`unUse`、`config.update`、`dispose`
- 插件扩展方法与类型推导
- `shared()` 跨插件能力注入，重复 key 直接报错
- sync / async / generator 三种 pipeline
- generator pipeline exports `GENERATOR_HALT`, `GENERATOR_CONTINUE` and conditional `GENERATOR_UNDEFINED` control signals
- `PluginHostOptions.diagnostic` receives late-next diagnostics; diagnostic failures never escape the pipeline
- 资源回收：函数、`Symbol.dispose`、`Symbol.asyncDispose`
- 运行时 locale 错误文本：`PluginHost.setLocale(locale)`

## Browser Support List

- Chrome 85+
- Edge 85+
- Firefox 79+
- Opera 71+
- Safari 14+

产物基线为 ES2020，且需要 `Promise`、`Map`、`Symbol`、`AggregateError`。`Symbol.dispose` 和 `Symbol.asyncDispose` 仅作为存在时的清理兜底，不要求 polyfill。

完整 API、插件编写规范、管线模式、生命周期和错误语义见 [USEGUIDE.md](./USEGUIDE.md)。

## 错误码

`PluginHostErrorCode` 导出以下稳定错误码：

`HOST_DISPOSED`、`HOST_DISPOSING`、`PLUGIN_DUPLICATE`、`PLUGIN_NOT_INSTALLED`、
`EXTENSION_DUPLICATE`、`EXTENSION_OBJECT_PROTOTYPE`、`EXTENSION_RESERVED`、
`PLUGIN_INSTALL_FAILED`、`PLUGIN_DISPOSE_FAILED`、`HOST_DISPOSE_FAILED`、`SHARED_DUPLICATE`、
`RESOURCE_OUTSIDE_INSTALL`、`LIFECYCLE_MUTATION`、
`INVALID_PIPELINE_MODE`、`PIPELINE_EXECUTING`、`PIPELINE_NEXT_DUPLICATE`、
`PIPELINE_NEXT_LATE`。
