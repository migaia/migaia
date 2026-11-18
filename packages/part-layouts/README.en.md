# @migaia/part-layouts

Page layouts for the part platform: `defineLayout` and four built-in layouts. A layout is a part with `behavior.layout`, and its regions are slots. This package only declares data and does not depend on the DOM or React. Browser behaviour (region landmarks, draggable separators, collapsing into a drawer on narrow screens, F6 moving focus between regions) is carried out by `@migaia/part-plugin-dom`; `@migaia/part-plugin-react` renders it.

## Start here

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
      props: { labels: { nav: 'Navigation' } },
      slots: { nav: [{ tag: 'menu@1' }], content: [{ tag: 'orders-table@1' }] }
    }
  }
})
```

## Built-in layouts

| id | Regions |
|---|---|
| `single@1` | `content` (main) |
| `nav-content@1` | `nav` (navigation, resizable 160–480, default 240, collapses below 720), `content` |
| `nav-tree-content@1` | `nav` (navigation, fixed 64, collapses below 960), `tree` (navigation, resizable 200–520, default 280, collapses below 720), `content` |
| `header-content-footer@1` | `header` (banner), `content`, `footer` (contentinfo) |

Region labels default to English (`Main navigation`, `Contents`); a blueprint localises them with `props.labels`.

See [USEGUIDE.en.md](./USEGUIDE.en.md) for more.
