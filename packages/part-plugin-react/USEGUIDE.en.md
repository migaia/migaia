# `@migaia/part-plugin-react` guide

[中文](./USEGUIDE.md)

See the [README](./README.en.md) for what the package is for. `react` and `react-dom` 19.x are peer dependencies; install the package together with `@migaia/part-plugin-dom`.

## Find by scenario

| Problem                                                         | API / how                                     | Section                                              |
| --------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| Turn an existing shadcn component into a part                   | `bindReactComponent`                          | [Wrap an existing component](#wrap-an-existing-component) |
| The component's callback name differs from the event name       | `mapping.events`                              | [Events and callbacks](#events-and-callbacks)        |
| A Radix dialog manages its own focus, but the host must know whether it is open | `managedBy: 'component'`, `states.openChange` | [Component-managed open state](#component-managed-open-state) |
| Change one state without re-rendering the page                  | `useTracked` (internal)                       | [Re-render only nodes that read the state](#re-render-only-nodes-that-read-the-state) |
| Render a list driven by state                                   | `template`, `$row`                            | [List rows](#list-rows)                              |
| `aria-expanded` follows state                                   | `aria.fromState`                              | [State-derived aria](#state-derived-aria)            |
| One failing component must not take the page down               | per-node error boundary                       | [Failure isolation](#failure-isolation)              |

## Wrap an existing component

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

Each `mount` uses its own React root. The root element comes from `ref` by default; for a component that does not forward `ref`, use `mapping.element: 'query'`. `partom extract` drafts such bindings from shadcn sources.

## Events and callbacks

```ts
bindReactComponent(combobox, Combobox, {
  props: { value: 'selected' },
  events: { valueChange: 'onValueChange' },
  slots: { empty: 'emptyState' }
})
```

`props` renames part props to component props; `events` connects component callbacks to the part's `component` events, with the callback argument as the event `detail`; `slots` puts a slot into `children` or a named prop.

## Component-managed open state

Components such as Radix handle focus, Escape and layering themselves. With `managedBy: 'component'` the host does not call the DOM plugin's focus and layer management. The host still owns the open state: it binds the prop named by `states.openState` to a state path, and when the component calls the callback declared as `states.openChange`, the renderer writes the new value to that path before dispatching the event.

```ts
definePart({
  id: 'dialog@1',
  behavior: { managedBy: 'component', states: { names: ['open'], openState: 'open', openChange: 'openChange' } },
  events: { openChange: { kind: 'component' } }
})
```

## Re-render only nodes that read the state

Each node subscribes only to its own address, and bound values are read tracked on the host's reactive runtime. Writing a state path re-renders only the nodes that read it; after a host `patch`, only changed addresses are notified.

## List rows

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

A template host renders its template node once per entry of `rows`, after its own children. The row key is the string value of the row's `rowKey` field and is also the React key. Every node inside a row has a `@row:<key>` address, and `$row` bindings read the current row. Row instances install no listeners: the host element installs one delegated listener per template-node event, finds the row from the event target and dispatches with the row-instance address, so the effect reads `event.rowKey`. The host element also writes and removes the template node's style rules, which all rows share.

Limit: if the template node declares an open state, all rows share one state path.

## State-derived aria

For a part declaring `aria: { expanded: { fromState: 'expanded' } }`, the renderer reads the state path tracked. A state change re-renders only that node, and the commit rewrites its `aria-expanded`.

## Failure isolation

Every node sits inside an error boundary. An unbound part reports `BINDING_MISSING`, and a render failure reports `RENDER_FAILED` with the original on `cause`. Each is reported once through the host's `onError` and affects only that node and its subtree.

## Error codes

Source `part.react`: `BINDING_MISSING`, `ELEMENT_UNRESOLVED`, `RENDER_FAILED`.

## Build and verify

Tests run in a real Chromium (vitest browser mode).

```bash
pnpm --filter @migaia/part-plugin-react run fmt
pnpm --filter @migaia/part-plugin-react run lint
pnpm --filter @migaia/part-plugin-react run typecheck
pnpm --filter @migaia/part-plugin-react run test
```
