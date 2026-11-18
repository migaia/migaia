# @migaia/part-layouts

part 平台的页面布局：`defineLayout` 和四种内置布局。布局是带 `behavior.layout` 的 part，区域就是插槽；本包只声明数据，不依赖 DOM 或 React。区域地标、可拖动的分隔条、窄屏折叠成抽屉、F6 在区域间移动焦点等浏览器行为由 `@migaia/part-plugin-dom` 执行，`@migaia/part-plugin-react` 负责渲染。

## 从这里开始

```ts
import { createPartHost } from '@migaia/part-host'
import { layoutsPlugin } from '@migaia/part-layouts'

const host = await createPartHost({ plugins: [layoutsPlugin, domPlugin, reactPlugin, appPlugin] })
await host.blueprint.load({
  id: 'orders',
  version: 1,
  root: {
    tag: 'nav-content@1',
    facets: {
      props: { labels: { nav: '主导航' } },
      slots: { nav: [{ tag: 'menu@1' }], content: [{ tag: 'orders-table@1' }] }
    }
  }
})
```

## 内置布局

| id | 区域 |
|---|---|
| `single@1` | `content`（main） |
| `nav-content@1` | `nav`（导航，可调 160–480，默认 240，窄于 720 折叠）、`content` |
| `nav-tree-content@1` | `nav`（导航，固定 64，窄于 960 折叠）、`tree`（导航，可调 200–520，默认 280，窄于 720 折叠）、`content` |
| `header-content-footer@1` | `header`（banner）、`content`、`footer`（contentinfo） |

区域标签默认是英文（`Main navigation`、`Contents`），用蓝图的 `props.labels` 本地化。

更多用法见 [USEGUIDE.md](./USEGUIDE.md)。
