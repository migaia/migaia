# @migaia/part-plugin-react

React renderer plugin of part hosts: it renders resolved blueprints as React components and wraps existing React components (for example shadcn) as parts. `react` and `react-dom` (19.x) are peer dependencies.

## Usage

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

## Binding

The `mapping` of `bindReactComponent(part, Component, mapping)` declares part-to-component prop renames, whether a slot goes to `children` or a named prop, which component callback carries which event (for example `{ events: { valueChange: 'onValueChange' } }`), and whether the root element comes from `ref` or a query. Bindings are registered as `implementations` in the catalog and keep their object identity.

## Rendering

- One React root per mount; a state change re-renders only the nodes that read it (using `useTracked` from `@migaia/store-react`).
- During commit the DOM plugin applies aria, styles, events, focus and layers.
- For a part declaring `aria: { expanded: { fromState: 'expanded' } }`, the renderer reads the state path tracked, and a state change updates only that attribute.
- A template host renders its template node once per entry of `rows`. Every node inside a row has a `@row:<key>` address, and `$row` bindings read the current row. Row instances install no listeners: the host element delegates the template node's events and also writes and removes its style rules.
- For component-managed parts (`managedBy: 'component'`), when the component reports an open-state change (`states.openChange`), the renderer writes it back to host state before dispatching the event.
- Every node has an error boundary: an unbound part reports `BINDING_MISSING`, a render failure reports `RENDER_FAILED`, and only that node is affected.

## Error codes (source `part.react`)

`BINDING_MISSING`, `ELEMENT_UNRESOLVED`, `RENDER_FAILED`.
