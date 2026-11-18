# @migaia/part-plugin-react

part 宿主的 React 渲染插件：把解析后的蓝图渲染为 React 组件，并把现有 React 组件（例如 shadcn）包装成 part。`react` 与 `react-dom`（19.x）是 peer 依赖。

## 用法

```ts
import { definePart, definePartPlugin, createPartHost } from '@migaia/part-host'
import { domPlugin } from '@migaia/part-plugin-dom'
import { bindReactComponent, reactPlugin } from '@migaia/part-plugin-react'

const button = definePart({ id: 'button@1' })
const app = definePartPlugin({
  name: 'app',
  parts: [button],
  implementations: [bindReactComponent(button, Button)]
})

const host = await createPartHost({ plugins: [domPlugin, reactPlugin, app] })
await host.blueprint.load(blueprint)
host.mount(document.getElementById('root'), blueprint.id)
```

## 绑定

`bindReactComponent(part, Component, mapping)` 的 `mapping` 可以声明：part props 到组件 props 的改名、slot 放进 `children` 还是具名 prop、组件回调对应的事件名（例如 `{ events: { valueChange: 'onValueChange' } }`）、根元素通过 `ref` 还是查询获得。绑定作为 `implementations` 登记到目录，对象身份保持不变。

## 渲染

- 每次挂载各用一个 React 根；状态变化只重渲读取了该状态的节点（复用 `@migaia/store-react` 的 `useTracked`）。
- 提交期依次调用 DOM 插件的 aria、样式、事件、焦点和层级。
- 声明了 `aria: { expanded: { fromState: 'expanded' } }` 的 part，渲染器按状态路径追踪读取，状态变化时只更新该属性。
- 模板宿主按 `rows` 每行渲染一次模板节点；行内所有节点的地址带 `@row:<键>`，`$row` 绑定读取当前行。行实例自己不挂监听，模板节点的事件由宿主元素统一委托；模板节点的样式规则也由宿主元素负责写入和移除。
- 组件自管的 part（`managedBy: 'component'`）在组件报告打开状态变化时（`states.openChange`），渲染器先把新值写回宿主状态，再派发事件。
- 每个节点有错误边界：未绑定的 part 报 `BINDING_MISSING`，渲染抛错报 `RENDER_FAILED`，只影响该节点。

## 错误码（source `part.react`）

`BINDING_MISSING`、`ELEMENT_UNRESOLVED`、`RENDER_FAILED`。
