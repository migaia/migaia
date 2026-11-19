# @migaia/part-host

Runtime host of the part platform, built on `@migaia/plugin-host` and `@migaia/reactive`: it assembles plugins, loads blueprints, runs configuration enhancers, keeps scope state and derives, schedules effects and hands trees to a renderer through the render slot. It depends on no DOM or UI framework.

## Start here

```ts
import { createPartHost, defineEffect, definePart, definePartPlugin } from '@migaia/part-host'

const plugin = definePartPlugin({
  name: 'orders',
  parts: [definePart({ id: 'button@1' })],
  effects: [defineEffect({ id: 'open-detail@1', run: (event, ctx) => ctx.state.write('page.detail', event.detail) })]
})

const host = await createPartHost({ plugins: [plugin] })
const { tree, issues } = await host.blueprint.load(blueprint)
```

`load` runs authored rules, applies enhancers per tag, then runs resolved rules; with any error `tree` is `undefined`. `patch` takes JSON Patch operations and re-enhances only affected addresses.

Resolved nodes carry `ariaStates` (aria attribute to state path) and, on template hosts, `template: { rowKey, rows, node }`. When `host.dispatch` receives a row-instance address (`…@row:<key>`), it uses the static node's subscription and passes `rowKey` in the effect event.

## Definitions

- `definePart`: structure, behavior groups, events, slots and style hooks.
- `defineEnhancer`: a pure per-tag configuration transform ordered by `after`; cycles are rejected at install.
- `defineDerive`: a pure derive; writing state throws `DERIVE_WRITE`.
- `defineEffect`: side effects run by event subscriptions; one effect runs in arrival order and `ctx.dispatch` only enqueues.
- `defineResource`: a data resource with parameter, result and command schemas, a load function, cache key and invalidation tags; the host's resource store runs its asynchronous states.

## Wiring

Plugins reference each other only through PH `getFeature`: `partCorePlugin.getFeature('catalog' | 'state' | 'effect' | 'diagnostics' | 'renderSlot' | …)`. A renderer plugin registers its factory in `renderSlot` at install; `host.mount(target, blueprintId)` creates one renderer instance per mount.

Runtime errors are reported once through `diagnostics` to `createPartHost({ onError })`. `dispose()` is idempotent and returns the plugin-host disposal result.

## Error codes (source `part.host`)

`CATALOG_CONFLICT`, `ENHANCER_CYCLE`, `ENHANCER_MUTATED_INPUT`, `DERIVE_WRITE`, `EFFECT_FAILED`, `RENDERER_MISSING`, `RENDERER_DUPLICATE`, `HOST_DISPOSED`, `BLUEPRINT_UNKNOWN`, `EFFECT_FORBIDDEN`, `EFFECT_ISOLATION_UNAVAILABLE`. Errors thrown while a plugin installs are wrapped by plugin-host as `PLUGIN_INSTALL_FAILED` with the original on `cause`.
