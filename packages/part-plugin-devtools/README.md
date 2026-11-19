# @migaia/part-plugin-devtools

开发态的 part 检查面板：按 part 地址查看增强阶段追踪、解析后的配置、绑定的状态、推导依赖、事件与 effect 调用。只在 `development` 条件下生效，生产构建解析到同名的空插件，产物里没有面板代码。

## 从这里开始

```ts
import { devtoolsPlugin } from '@migaia/part-plugin-devtools'

const host = await createPartHost({ plugins: [domPlugin, reactPlugin, devtoolsPlugin, ...appPlugins] })
```

按 `Alt+Shift+D` 打开或关闭面板；点“Pick”后再点页面元素，选中它最近的带 `data-part-address` 的祖先。插件提供 Feature `devtools`：`open()`、`close()`、`select(address)`、`selected()`。

面板的数据全部来自宿主的 `trace` 与 `state` Feature，不读取宿主内部；面板是只读的，修改请用编辑器。详细用法见 [USEGUIDE.md](USEGUIDE.md)。
