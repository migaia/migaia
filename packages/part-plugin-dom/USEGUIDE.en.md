# `@migaia/part-plugin-dom` guide

[中文](./USEGUIDE.md)

See the [README](./README.en.md) for what the package is for. Applications rarely call this package directly: renderer plugins call it during commit. The sections below show what to write in blueprints and part definitions, and how a renderer plugin calls it.

## Find by scenario

| Problem                                                      | How                              | Section                                    |
| ------------------------------------------------------------ | -------------------------------- | ------------------------------------------ |
| Focus returns to the trigger after a dialog closes           | `focus.restore`                  | [Focus restore](#focus-restore)            |
| A dropdown inside a modal still shows on top                 | `behavior.layer`                 | [Layers](#layers)                          |
| Close a dropdown on a click outside it                       | `dismiss.outside`                | [Close on outside click](#close-on-outside-click) |
| Outside clicks, key filters, debounce, long press, swipe, drag | subscription modifiers, `click.once.stop` keys | [Modifiers and shorthand event keys](#modifiers-and-shorthand-event-keys) |
| Receive an event in the capture phase                        | subscription option `capture: true` | [Capture phase](#capture-phase)         |
| A thousand-row list without a thousand listeners             | `events.delegate`                | [List event delegation](#list-event-delegation) |
| Change a theme colour in one place                           | `styleHooks`, `stylesheet`       | [Styles](#styles)                          |
| Resizable sidebar, narrow-screen collapse, F6 between regions | `layout.attach` | [Layouts](#layouts) |

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

## Modifiers and shorthand event keys

A subscription can carry a modifier chain. Modifiers run in array order and each can stop the event; the effect is dispatched only after all of them pass. A modifier is written `name@major`, or as an object when it takes arguments:

```json
{ "events": { "click": { "handler": "save@1", "modifiers": ["stop@1", { "id": "debounce@1", "args": { "ms": 200 } }] } } }
```

An event key may also use dot shorthand: the first segment is the event name, `once`, `capture`, `passive` and `native` are listener options, and every other segment is a modifier (`@1` when the major is omitted). These two are equivalent:

```json
{ "events": { "click.once.stop.outside": { "handler": "close@1" } } }
{ "events": { "click": { "handler": "close@1", "once": true, "modifiers": ["stop@1", "outside@1"] } } }
```

`native` applies to component events: instead of the component callback, it listens for the native event of the same name on the part's root element (for example `click.native`).

Built-in modifiers registered by this plugin:

| Modifier | Effect |
|---|---|
| `stop`, `prevent`, `self` | Stop propagation; cancel the default action; continue only when the target is the part element itself |
| `outside` | Listens on the document in the capture phase and continues only for clicks outside the part, so an outer `stopPropagation` cannot hide them; DOM events only, not on template rows |
| `enter`, `esc`, `tab`, `space`, `up`, `down`, `delete` | Continue only for that key (`delete` accepts Delete and Backspace) |
| `left`, `right`, `middle` | Arrow key for keyboard events, mouse button for mouse events |
| `key` | `{ keys: [...] }`, filters by `KeyboardEvent.key` |
| `ctrl`, `shift`, `alt`, `meta`, `exact` | Require that system key; `exact` requires exactly the system keys written in the subscription |
| `debounce`, `throttle` | `{ ms }`, default 300; debounce passes only the last event, throttle the first of each window |
| `longpress` | On `pointerdown`; `{ ms, tolerance }`, dispatches `{ x, y, duration }` after a still hold |
| `swipe` | On `pointerdown`; `{ distance, direction }`, dispatches `{ direction, dx, dy }` at release |
| `drag` | On `pointerdown`; `{ threshold }`, captures the pointer and dispatches `{ phase: 'start' \| 'move' \| 'end', x, y, dx, dy }` |

Double click, touch, scroll and drag-and-drop are native events (`dblclick`, `touchstart`, `scroll`, `dragstart`, ...): subscribe to them directly and add modifiers as needed, for example `scroll.passive.throttle`.

Custom modifiers are defined with part-host's `defineModifier` and registered through `definePartPlugin({ modifiers })`. When a modifier is missing at runtime the subscription installs no listener and `MODIFIER_UNAVAILABLE` is reported through diagnostics; a throwing modifier reports `MODIFIER_FAILED` with the original error on `cause`. These errors carry `address`, `event` and `modifier`.

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

## Layouts

For a layout part (one with `behavior.layout`; see `@migaia/part-layouts`) the renderer creates the elements and calls `layout.attach({ blueprintId, node, element, regions, separators, toggles, skip })` at commit time, then the returned undo function before unmounting. Region element ids come from `layoutRegionId(address, region)`, so the skip link's `href` can be written while rendering.

- **Grid**: sizes go to a dedicated `layout` cascade layer of the style sheet (order `tokens, parts, blueprint, local, layout, stacking`), never a `style` attribute. Each resizable region has a 6-pixel separator track between it and `main`; `main` without a size fills the remaining space; each region scrolls on its own.
- **Separators**: drag with a pointer, or focus and use the arrow keys (10 pixels per press, 50 with Shift; Home and End go to the minimum and maximum). Moving toward `main` always widens the region; right-to-left pages follow the visual direction. The new width is saved in `localStorage` (key `part-layout:<blueprint id>:<layout address>:<region>`) and preferred next time; without `localStorage` it lasts for the current page only, with no error.
- **Collapse**: when the layout container is narrower than a region's `collapseBelow`, the region becomes a drawer and a toggle button named by the region label appears at the layout's top end corner. The drawer uses the browser Popover API: the toggle, Escape or an outside click closes it; opening moves focus into the drawer and closing returns it to the toggle. When the container widens again the drawer closes and the region returns to its place.
- **F6**: F6 and Shift+F6 move focus between every region on the page that is not collapsed (from outside any region they enter the first or last one). One listener per document is shared by all hosts. Some browsers use F6 to focus the address bar; on a page with a layout that shortcut no longer works inside the page.
- **Skip to main content**: the skip link is clipped to one pixel and appears at the layout's top start corner when it receives keyboard focus.

A renderer may also write the `layout` layer directly with `stylesheet.setLayout(address, rules)`: a rule's `target` is `root`, `region:<name>`, `separator:<name>`, `toggle:<name>` or `skip`, optionally with `state: 'focus-visible'`; this package generates the selectors.

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
