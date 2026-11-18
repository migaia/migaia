# @migaia/part-plugin-dom

DOM plugin of part hosts: page-level focus, layers, style sheet writing, event adaptation and aria. It is framework-free; renderer plugins call it during commit.

## Usage

Install `domPlugin` before a renderer plugin such as `reactPlugin` from `@migaia/part-plugin-react`:

```ts
const host = await createPartHost({ plugins: [domPlugin, reactPlugin, appPlugin] })
```

Renderer plugins obtain the services through `domPlugin.getFeature('focus' | 'layer' | 'stylesheet' | 'events' | 'aria')`.

## Behavior

- **Focus**: opening a part with `focus.restore` records the focused element and restores it on close; a removed element falls back to the nearest focusable element still present, never `body`. While a modal part is open the other top-level elements are `inert`. Call `focus.open` before `layer.open`, and `layer.close` before `focus.close`.
- **Layers**: modal dialogs use `showModal()`; popups above a top-layer element enter the top layer as popovers; others get a semantic z-index written to a dedicated `stacking` cascade layer, never a `style` attribute. Escape closes only the topmost layer and notifies the caller through `onDismiss`. `close` is idempotent.
- **Styles**: one sheet per host, rules kept per (layer, address) and updated in place.
- **Events**: `dom` and `custom` events use `addEventListener` with modifiers applied synchronously; custom event names must start with the plugin name and a colon.
- **Aria**: addresses in relation attributes resolve to the target's id, and every element receives `data-part-address`.

Parts that manage their own focus and layering (`managedBy: 'component'`, for example Radix) bypass the focus and layer managers.

## Error codes (source `part.dom`)

`CUSTOM_EVENT_UNNAMESPACED`, `STYLESHEET_UNSUPPORTED`.
