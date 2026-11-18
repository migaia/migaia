# @migaia/part-layouts guide

## Build a page from a built-in layout

With `layoutsPlugin` installed, the blueprint root names the layout id and fills each region with `facets.slots.<region>`. Filling a region the layout does not have produces a `layout.region-unknown` issue.

```ts
const blueprint = {
  id: 'docs',
  version: 1,
  root: {
    tag: 'nav-tree-content@1',
    facets: {
      props: {
        labels: { nav: 'Navigation', tree: 'Table of contents' },
        sizes: { tree: 320 },
        skipLabel: 'Skip to content'
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

A layout node accepts three props:

- `labels`: overrides region labels. A label is the region's `aria-label` and the text of its toggle button once collapsed.
- `sizes`: initial pixel widths of resizable regions, inside the region's range, or `layout.size-range` is reported. After the user drags or uses the keyboard, the browser remembers the new width and prefers it next time.
- `skipLabel`: text of the skip-to-main link, `Skip to main content` by default.

A blueprint has at most one outermost layout. Placing a layout inside another layout's region is allowed; the inner layout's `main` region is not a second `main` landmark.

## Define your own layout

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

`defineLayout` creates one slot per region with no content type or count limit. An invalid declaration (duplicate region names, a main region count other than one, a resizable region without a pixel default or range, a collapsible `main`, a collapsible region without `label`, and so on) throws `DESCRIPTOR_INVALID` synchronously. `defineLayout` takes no `focus`, `layer` or `managedBy`: the layout behaviour decides focus and layering.

Region options:

- `landmark`: `banner`, `navigation`, `main`, `complementary`, `contentinfo` or `region`, rendered as `header`, `nav`, `main`, `aside`, `footer` or `section`.
- `size.default`: pixels, `auto` or `<n>fr`; a `main` region without a size fills the remaining space.
- `resizable`: the region can be dragged wider or narrower; needs a pixel default with `min` and `max`.
- `collapseBelow`: below this layout container width in pixels the region collapses into a drawer that a toggle button opens.
- `scroll`: the region scrolls on its own when its content overflows; `true` by default.
