# @migaia/part-layouts 使用指南

## 用内置布局搭页面

安装 `layoutsPlugin` 后，蓝图根节点写布局的 id，再用 `facets.slots.<区域名>` 往各区域放内容。往布局没有的区域里放内容会得到一条 `layout.region-unknown` 问题。

```ts
const blueprint = {
  id: 'docs',
  version: 1,
  root: {
    tag: 'nav-tree-content@1',
    facets: {
      props: {
        labels: { nav: '主导航', tree: '目录' },
        sizes: { tree: 320 },
        skipLabel: '跳到主内容'
      },
      slots: {
        nav: [{ tag: 'rail@1' }],
        tree: [{ tag: 'toc@1' }],
        content: [{ tag: 'article@1' }]
      }
    }
  }
}
```

布局节点接受三个 props：

- `labels`：覆盖区域标签。标签用作区域的 `aria-label`，也是折叠后开关按钮的文字。
- `sizes`：可调区域的初始宽度（像素），必须在该区域的范围内，否则报 `layout.size-range`。用户拖动或用键盘调整后，浏览器会记住新宽度，下次优先使用。
- `skipLabel`：“跳到主内容”链接的文字，默认 `Skip to main content`。

一份蓝图只能有一个最外层布局；把布局放进另一个布局的区域里是允许的，内层布局的 `main` 区域不会再成为 `main` 地标。

## 定义自己的布局

```ts
import { defineLayout } from '@migaia/part-layouts'
import { definePartPlugin } from '@migaia/part-host'

export const inspectorLayout = defineLayout({
  id: 'acme.inspector@1',
  direction: 'row',
  regions: [
    { name: 'content', landmark: 'main' },
    {
      name: 'inspector',
      landmark: 'complementary',
      label: 'Inspector',
      resizable: true,
      size: { default: 320, min: 240, max: 560 },
      collapseBelow: 900
    }
  ]
})

export const acmeLayouts = definePartPlugin({ name: 'acme-layouts', parts: [inspectorLayout] })
```

`defineLayout` 为每个区域生成一个插槽，不限制内容类型和数量。声明不合法（区域重名、`main` 不是恰好一个、可调区域缺少像素默认值或范围、`main` 可折叠、可折叠区域缺 `label` 等）时同步抛 `DESCRIPTOR_INVALID`。`defineLayout` 不接受 `focus`、`layer`、`managedBy`：焦点与层级由布局行为决定。

区域可选项：

- `landmark`：`banner`、`navigation`、`main`、`complementary`、`contentinfo`、`region`，分别渲染为 `header`、`nav`、`main`、`aside`、`footer`、`section`。
- `size.default`：像素数、`auto` 或 `<n>fr`；`main` 不写时占满剩余空间。
- `resizable`：可拖动调宽，需要像素默认值与 `min`、`max`。
- `collapseBelow`：布局容器宽度小于该像素值时折叠成抽屉，由开关按钮打开。
- `scroll`：区域内容超出时独立滚动，默认 `true`。
