# `@migaia/part-host` guide

[中文](./USEGUIDE.md)

See the [README](./README.en.md) for what the package is for. The host depends on no DOM or UI framework; to render, also install `@migaia/part-plugin-dom` and a renderer plugin such as `@migaia/part-plugin-react`.

## Find by scenario

| Problem                                                    | API                                | Section                                              |
| ---------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------- |
| Load a blueprint and get its issue list                    | `createPartHost`, `blueprint.load` | [Load a blueprint](#load-a-blueprint)                |
| An editor changes one field; do not recompute the whole tree | `blueprint.patch`                | [Recompute only changed addresses](#recompute-only-changed-addresses) |
| Give every button the team's default configuration        | `defineEnhancer`                   | [Fill defaults with an enhancer](#fill-defaults-with-an-enhancer) |
| A value computed from other state                          | `defineDerive`                     | [Derive values from state](#derive-values-from-state) |
| Call an API and write state on click                       | `defineEffect`                     | [Side effects from events](#side-effects-from-events) |
| A click in a list row must know which row                  | `IEffectEvent.rowKey`              | [List-row events](#list-row-events)                  |
| `aria-expanded` follows a popup's open state               | `behavior.aria.fromState`          | [State-derived aria](#state-derived-aria)            |
| Remove a plugin; parts depending on it become unavailable  | `host.unUse`                       | [Replacing and removing plugins](#replacing-and-removing-plugins) |

## Load a blueprint

```ts
import { createPartHost, definePart, definePartPlugin } from '@migaia/part-host'

const app = definePartPlugin({ name: 'orders', parts: [definePart({ id: 'button@1' })] })
const host = await createPartHost({ plugins: [app], onError: (error) => console.error(error) })
const { tree, issues } = await host.blueprint.load(blueprint)
if (tree === undefined) console.table(issues)
```

`load` runs authored rules, applies enhancers per tag, then runs resolved rules. With any error-level issue `tree` is `undefined`; `issues` merges both phases without duplicates. The rule set is every built-in rule of `@migaia/part-contract/doctor` plus plugin `rules`; the host has no option to turn built-in rules off.

## Recompute only changed addresses

```ts
await host.blueprint.patch('orders', [
  { op: 'replace', path: '/root/children/0/facets/props/label', value: 'Refresh' }
])
```

`patch` takes JSON Patch. The host re-enhances only the affected addresses, and mounted renderers receive only the changed nodes.

## Fill defaults with an enhancer

An enhancer is a pure function per tag: it receives a frozen configuration and returns a new one; mutating the input throws `ENHANCER_MUTATED_INPUT`. `after` orders several enhancers, and a cycle throws `ENHANCER_CYCLE` at install. `writes` declares the fields it writes, which rules treat as provided in the authored phase.

```ts
import { defineEnhancer } from '@migaia/part-host'

const defaultSize = defineEnhancer({
  id: 'orders.default-size@1',
  targets: ['button'],
  writes: ['props.size'],
  transform: (config) => ({ ...config, props: { size: 'sm', ...config.props } })
})
```

## Derive values from state

A derive is a pure computation used through `{ $derive: 'id' }` bindings; writing state throws `DERIVE_WRITE`. One batch of state writes recomputes it once.

```ts
import { defineDerive } from '@migaia/part-host'

const total = defineDerive({
  id: 'orders.total@1',
  compute: (state) => (state.read('page.rows') as { amount: number }[]).reduce((sum, row) => sum + row.amount, 0)
})
```

## Side effects from events

An event subscription in a blueprint names an effect. One effect runs its calls serially in arrival order; `ctx.dispatch` only queues, so it never re-enters the running effect. When an effect throws, the host reports once through `onError` (`EFFECT_FAILED`, original error on `cause`). Services an effect needs are declared in `deps` as PH Feature references and read from `ctx.features`.

```ts
import { defineEffect } from '@migaia/part-host'

const reload = defineEffect({
  id: 'reload@1',
  deps: { api: apiPlugin.getFeature('api') },
  run: async (_event, ctx) => ctx.state.write('page.rows', await ctx.features.api.listOrders())
})
```

## List-row events

A template host declares a repeated subtree with `template: { rowKey, rows, node }`. Nodes inside a row have the address `<template node address>@row:<key>`. When `host.dispatch` receives such an address, it uses the template node's subscription and passes the key to the effect:

```ts
const remove = defineEffect({
  id: 'remove-row@1',
  run: (event, ctx) => {
    const rows = ctx.state.read('page.rows') as { id: string }[]
    ctx.state.write('page.rows', rows.filter((row) => row.id !== event.rowKey))
  }
})
```

The DOM plugin installs one delegated listener on the template host element, however many rows there are.

## State-derived aria

A part writes `{ fromState: 'stateName' }` in `behavior.aria`. The host resolves it to a state path on the resolved node's `ariaStates`: when the blueprint binds the prop of that name with `{ $state }`, the binding's path; otherwise `part.<address>.<stateName>`, seeded with the literal value or `false`. Renderers read these paths tracked and update only the matching `aria-*` attribute when the state changes.

```ts
definePart({
  id: 'disclosure@1',
  behavior: { states: { names: ['expanded'] }, aria: { expanded: { fromState: 'expanded' } } }
})
```

## Custom modifiers and fragments

`defineModifier` defines an event modifier; the DOM plugin runs it in the listener in subscription order:

```ts
const confirm = defineModifier({
  id: 'confirm@1',
  eventKinds: ['dom'],
  placement: false,
  create: () => ({ handle: (event, next) => { if (window.confirm('Sure?')) next() } })
})
```

`handle(event, next, element)` stops the event by not calling `next`; `next` takes effect once per event and may be called later (for example to debounce); `next(detail)` replaces the detail the effect receives. A modifier with `placement: true` must provide `place(element, args)` to choose where the listener sits; a mismatch throws `MODIFIER_PLACEMENT_MISMATCH`. Modifiers with an `args` schema have their arguments validated at load; failures are `event.modifier-args` issues.

`defineFragment` defines a reusable blueprint fragment:

```ts
const card = defineFragment({
  id: 'card@1',
  args: z.object({ title: z.string() }),
  slots: ['body'],
  node: { tag: 'box@1', children: [{ tag: 'text@1', id: 'heading', facets: { props: { text: { $param: 'title' } } } }, { $slot: 'body' }] }
})
```

A blueprint node with `tag: 'card@1'` is a usage: `facets.props` are its parameters and `facets.slots` fill its slots. Loading expands fragments first, then validates parameters (failures are `fragment.args` issues), then runs rules and enhancers. A patch on a usage recomputes only the nodes that usage expanded into; replacing a fragment definition recomputes only its usages. Cyclic, too deep or too large fragments make `load` throw.

Both register through `definePartPlugin({ modifiers, fragments })` with the same conflict and replacement rules as parts.

## Replacing and removing plugins

- `host.use(plugin)` installs a plugin; its parts, rules and implementations enter the catalog.
- `host.replace(name, next)` replaces a plugin with a new generation of the same name; plugin-host restarts its dependents.
- `host.unUse(name)` removes a plugin. Catalog entries of suspended dependents are marked unavailable, and the result's `errors` are also reported through `onError`.
- `host.dispose()` is idempotent and returns the plugin-host disposal result; later calls throw `HOST_DISPOSED`.

## Error codes

Source `part.host`: `CATALOG_CONFLICT`, `ENHANCER_CYCLE`, `ENHANCER_MUTATED_INPUT`, `DERIVE_WRITE`, `EFFECT_FAILED`, `RENDERER_MISSING`, `RENDERER_DUPLICATE`, `HOST_DISPOSED`, `BLUEPRINT_UNKNOWN`. Errors during plugin install are wrapped by plugin-host as `PLUGIN_INSTALL_FAILED` with the original on `cause`.

## Build and verify

```bash
pnpm --filter @migaia/part-host run fmt
pnpm --filter @migaia/part-host run lint
pnpm --filter @migaia/part-host run typecheck
pnpm --filter @migaia/part-host run test
```
