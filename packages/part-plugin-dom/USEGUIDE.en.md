# `@migaia/part-plugin-dom` guide

[中文](./USEGUIDE.md)

See the [README](./README.en.md) for what the package is for. Applications rarely call this package directly: renderer plugins call it during commit. The sections below show what to write in blueprints and part definitions, and how a renderer plugin calls it.

## Find by scenario

| Problem                                                      | How                              | Section                                    |
| ------------------------------------------------------------ | -------------------------------- | ------------------------------------------ |
| Focus returns to the trigger after a dialog closes           | `focus.restore`                  | [Focus restore](#focus-restore)            |
| A dropdown inside a modal still shows on top                 | `behavior.layer`                 | [Layers](#layers)                          |
| Close a dropdown on a click outside it                       | `dismiss.outside`                | [Close on outside click](#close-on-outside-click) |
| Learn about outside clicks even after an outer `stopPropagation` | subscription modifier `outside` | [Outside subscriptions](#outside-subscriptions) |
| Receive an event in the capture phase                        | subscription option `capture: true` | [Capture phase](#capture-phase)         |
| A thousand-row list without a thousand listeners             | `events.delegate`                | [List event delegation](#list-event-delegation) |
| Change a theme colour in one place                           | `styleHooks`, `stylesheet`       | [Styles](#styles)                          |

## Focus restore

A part with `focus: { restore: true }` records the focused element when it opens and restores it on close. When that element was removed, focus falls back to the nearest focusable element that still exists, never `body`. While a modal part is open, the page's other top-level elements are `inert`.

Renderer plugins call `focus.open` before `layer.open` when opening, and `layer.close` before `focus.close` when closing.

## Layers

- `layer: 'top'` on a `<dialog>`: `showModal()`.
- A popup opened while a top-layer element is open: a popover in the top layer, so a dropdown inside a modal is never covered.
- Otherwise: a z-index from the semantic level (`dropdown`, `overlay`, `modal`, `toast` and so on), written to a dedicated `stacking` cascade layer, never a `style` attribute.

Escape closes only the topmost layer and notifies the caller through `onDismiss`. Blueprints cannot set `z-index` (rule `behavior.no-zindex`).

## Close on outside click

```ts
definePart({
  id: 'menu@1',
  behavior: { layer: 'dropdown', dismiss: { outside: true }, states: { names: ['open'], openState: 'open' } }
})
```

A pointer press (`pointerdown`, capture phase) outside the topmost part closes only that part, like Escape. The click is not blocked and still reaches its target. A click on a modal dialog's `::backdrop` targets the dialog itself, so for modals the dialog's box decides whether the press was outside. Parts that manage their own layering (`managedBy: 'component'`, such as Radix) do not pass through here; the component handles it.

## Outside subscriptions

```json
{ "events": { "click": { "handler": "close-panel@1", "modifiers": ["outside"] } } }
```

`outside` installs the listener on the document in the capture phase and fires only when the event path does not contain the part element. Because it runs in the capture phase, an outer `stopPropagation` cannot hide the event. It applies to DOM events only; rule `event.outside-dom` reports it on `custom` or `component` events.

## Capture phase

```json
{ "events": { "click": { "handler": "track@1", "capture": true } } }
```

`capture`, `once` and `passive` become native listener options. `component` events have no capture phase; rule `event.component-no-capture` reports that.

## List event delegation

For a template host, the renderer plugin calls `delegate` once per template-node event on the host element; row instances install no listeners:

```ts
dom.events.delegate('orders/rows/item', listElement, 'click', subscription, declaration)
```

For each event, the listener walks up from the target through elements with `data-part-address` until it finds a row instance of that template node (`orders/rows/item@row:<key>`), then dispatches with that address. Events outside every row are ignored. The `self` modifier compares against the row instance element; `stop` and `prevent` work as usual.

## Styles

Each host has one constructed style sheet keeping rules per (layer, address) and updating them in place. A rule for an address also matches every row instance of it, so list rows share one set of rules. Blueprints can style only through the `styleHooks` a part declares, and values are checked against the hook type.

## Aria

`aria.apply` writes `data-part-address`, a stable `id`, relation attributes (addresses resolved to target ids) and `tabindex`. `aria.applyStates` writes state-derived values as `aria-<name>`: booleans become `"true"` / `"false"`, and `undefined` and `null` remove the attribute.

## Error codes

Source `part.dom`: `CUSTOM_EVENT_UNNAMESPACED` (a custom event name lacks the plugin prefix) and `STYLESHEET_UNSUPPORTED` (the environment has no constructable style sheets).

## Build and verify

Tests run in a real Chromium (vitest browser mode).

```bash
pnpm --filter @migaia/part-plugin-dom run fmt
pnpm --filter @migaia/part-plugin-dom run lint
pnpm --filter @migaia/part-plugin-dom run typecheck
pnpm --filter @migaia/part-plugin-dom run test
```
