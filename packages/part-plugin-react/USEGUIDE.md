# `@migaia/part-plugin-react` 使用手册

[English](./USEGUIDE.en.md)

包的定位见 [README](./README.md)。`react` 与 `react-dom` 19.x 是 peer 依赖，需与 `@migaia/part-plugin-dom` 一起安装。

## 按场景查找

| 你遇到的问题                                   | API / 写法                                   | 看这一节                                            |
| ---------------------------------------------- | -------------------------------------------- | --------------------------------------------------- |
| 把现有 shadcn 组件变成 part                    | `bindReactComponent`                         | [包装现有组件](#包装现有组件)                       |
| 组件的回调名和事件名不一样                     | `mapping.events`                             | [事件与回调](#事件与回调)                           |
| Radix 弹窗自己管焦点，但宿主要知道它开没开     | `managedBy: 'component'`、`states.openChange` | [组件自管的打开状态](#组件自管的打开状态)          |
| 改一个状态，不想整页重渲                       | `useTracked`（内部）                         | [只重渲读到状态的节点](#只重渲读到状态的节点)       |
| 渲染一个由状态驱动的列表                       | `template`、`$row`                           | [列表行](#列表行)                                   |
| `aria-expanded` 跟着状态变                     | `aria.fromState`                             | [由状态派生 aria](#由状态派生-aria)                 |
| 一个组件渲染失败不能拖垮整页                   | 节点错误边界                                 | [故障隔离](#故障隔离)                               |

## 包装现有组件

```tsx
import { definePart, definePartPlugin, createPartHost } from '@migaia/part-host'
import { domPlugin } from '@migaia/part-plugin-dom'
import { bindReactComponent, reactPlugin } from '@migaia/part-plugin-react'
import { Button } from '@/components/ui/button'

const button = definePart({ id: 'button@1', props: buttonProps })
const app = definePartPlugin({
  name: 'app',
  parts: [button],
  implementations: [bindReactComponent(button, Button)]
})

const host = await createPartHost({ plugins: [domPlugin, reactPlugin, app] })
await host.blueprint.load(blueprint)
host.mount(document.getElementById('root'), blueprint.id)
```

每次 `mount` 用一个独立的 React 根。根元素默认通过 `ref` 获得；组件不转发 `ref` 时用 `mapping.element: 'query'`。`partom extract` 能从 shadcn 源码生成这类绑定的草稿。

## 事件与回调

```ts
bindReactComponent(combobox, Combobox, {
  props: { value: 'selected' },
  events: { valueChange: 'onValueChange' },
  slots: { empty: 'emptyState' }
})
```

`props` 改名 part prop 到组件 prop；`events` 把组件回调接到 part 的 `component` 事件，回调参数成为事件 `detail`；`slots` 决定 slot 放进 `children` 还是具名 prop。

## 组件自管的打开状态

Radix 一类组件自己处理焦点、Esc 和层级。part 声明 `managedBy: 'component'`，宿主就不调用 DOM 插件的焦点与层级管理。打开状态仍由宿主保存：宿主把 `states.openState` 对应的 prop 绑到状态路径；组件触发 `states.openChange` 声明的回调时，渲染器先把新值写回该路径，再派发事件。

```ts
definePart({
  id: 'dialog@1',
  behavior: { managedBy: 'component', states: { names: ['open'], openState: 'open', openChange: 'openChange' } },
  events: { openChange: { kind: 'component' } }
})
```

## 只重渲读到状态的节点

每个节点只订阅自己的地址，绑定值在宿主的反应式运行时上追踪读取。写一个状态路径，只有读取过它的节点重渲；宿主 `patch` 后也只通知变化的地址。

## 列表行

```json
{
  "tag": "list@1",
  "id": "rows",
  "template": {
    "rowKey": "id",
    "rows": { "$state": "page.rows" },
    "node": {
      "tag": "item@1",
      "id": "item",
      "facets": { "props": { "label": { "$row": "name" } }, "events": { "click": { "handler": "open-row@1" } } }
    }
  }
}
```

模板宿主按 `rows` 每行渲染一次模板节点，追加在它的子节点之后。行键是该行 `rowKey` 字段的字符串值，同时作为 React key；行内所有节点的地址带 `@row:<行键>`，`$row` 绑定读取当前行。行实例自己不挂监听：宿主元素为模板节点的事件各挂一个委托监听，按点击位置找到行，再以行实例地址派发，effect 从 `event.rowKey` 得到行键。模板节点的样式规则由宿主元素写入和移除，所有行共享。

限制：模板节点若声明打开状态，各行共享同一个状态路径。

## 由状态派生 aria

part 声明 `aria: { expanded: { fromState: 'expanded' } }` 后，渲染器追踪读取对应状态路径。状态变化时只有这个节点重渲，并在提交期改写它的 `aria-expanded`。

## 故障隔离

每个节点包在错误边界里。未绑定的 part 报 `BINDING_MISSING`，渲染抛错报 `RENDER_FAILED`（原错误在 `cause`），都经宿主 `onError` 报告一次，只影响该节点及其子树。

## 错误码

source 为 `part.react`：`BINDING_MISSING`、`ELEMENT_UNRESOLVED`、`RENDER_FAILED`。

## 构建与验证

测试在真实 Chromium 中运行（vitest 浏览器模式）。

```bash
pnpm --filter @migaia/part-plugin-react run fmt
pnpm --filter @migaia/part-plugin-react run lint
pnpm --filter @migaia/part-plugin-react run typecheck
pnpm --filter @migaia/part-plugin-react run test
```
