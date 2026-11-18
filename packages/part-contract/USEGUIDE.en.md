# `@migaia/part-contract` guide

[中文](./USEGUIDE.md)

See the [README](./README.en.md) for what the package is for. The package holds only plain data and pure functions; the examples below run in Node, Bun and browsers.

## Find by scenario

| Problem                                              | API                                    | Section                                                               |
| ---------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------- |
| Confirm a blueprint is well formed before saving     | `parseBlueprint`                       | [Confirm a blueprint before saving](#confirm-a-blueprint-before-saving) |
| Give the same issue list on the server and in the editor | `createRuleEngine`, `builtinRules` | [The same issue list everywhere](#the-same-issue-list-everywhere)     |
| Turn a team convention into a rule                   | `defineRule`                           | [Turn a convention into a rule](#turn-a-convention-into-a-rule)       |
| Find a node from an address, list rows included      | `createAddressIndex`, `resolveAddress` | [Find a node from an address](#find-a-node-from-an-address)           |
| Define arguments with zod and get JSON Schema too    | `toCatalogSchema`, `assertNoTransform` | [Define arguments with a schema library](#define-arguments-with-a-schema-library) |

## Confirm a blueprint before saving

A blueprint is JSON. `parseBlueprint` checks its structure (`id`, `version`, and each node's `tag`, `facets`, `children`, `template`) and that no parent has two children with the same address. It returns a deeply frozen copy, or throws `BLUEPRINT_INVALID` or `ADDRESS_DUPLICATE`. It does not consult a catalog, so it cannot know whether a tag exists; rules do that.

```ts
import { parseBlueprint } from '@migaia/part-contract'

const blueprint = parseBlueprint({
  id: 'orders',
  version: 1,
  root: {
    tag: 'page@1',
    id: 'orders',
    children: [
      { tag: 'button@1', id: 'refresh', facets: { events: { click: { handler: 'reload@1' } } } }
    ]
  }
})
```

## The same issue list everywhere

The rule engine takes a rule list and a catalog view. The view has three methods: `get(id)` returns a descriptor, `majors(name)` returns the available major versions, and `writesFor(tag)` returns the fields enhancers declare they write. The host, the CLI and editors all implement this view, so they report the same issues.

```ts
import { createRuleEngine } from '@migaia/part-contract'
import { builtinRules } from '@migaia/part-contract/doctor'

const engine = createRuleEngine({ rules: builtinRules, catalog })
for (const issue of engine.run('authored', blueprint))
  console.log(issue.severity, issue.rule, issue.address, issue.path)
```

`authored` checks the raw blueprint; `resolved` checks it after enhancement. In the `authored` phase a field an enhancer declares in `writes` counts as provided, so a required prop that an enhancer fills in is not reported. When a rule throws, the engine records a `RULE_FAILED` issue with the original error on `cause`, and the other rules still run.

The 26 built-in rules cover html, aria, slot, catalog, style, event, flow and behavior. For example:

- `event.outside-dom`: the `outside` modifier applies only to DOM events, because it listens for native events on the document; `custom` and `component` events never reach the document.
- `behavior.no-zindex`: a blueprint cannot set `z-index`; `behavior.layer` decides layering.

## Turn a convention into a rule

A rule is a pure function. With `scope: 'part'` it runs once per node matching `targets`; with `scope: 'blueprint'` once per blueprint. `context.provided(node, 'props.label')` is true only in the `authored` phase and only when an enhancer declares that field in `writes`, so a rule first checks whether the blueprint itself sets the value. `messageKey` in `report` is a stable key that a user interface translates.

```ts
import { defineRule } from '@migaia/part-contract'

export const buttonNeedsLabel = defineRule({
  id: 'orders.button-label',
  targets: ['button'],
  scope: 'part',
  phase: ['authored', 'resolved'],
  severity: 'error',
  check(context) {
    const node = context.node!
    if (node.facets?.props?.label === undefined && !context.provided(node, 'props.label'))
      context.report({
        address: context.address!,
        facet: 'props',
        path: 'label',
        messageKey: 'orders.button-label'
      })
  }
})
```

Pass it to the host with `definePartPlugin({ rules: [buttonNeedsLabel] })`; host loading, `partom doctor` and editors then all run it.

## Find a node from an address

Issues, events and styles all locate nodes by address. A node with an `id` uses it as its segment, otherwise the tag name; siblings with the same name get `#n`; slot members get a `slot.<name>` segment. A list-row instance appends `@row:<key>` to the template node's address, with `% / # @ .` in the key percent-encoded.

```ts
import { createAddressIndex, parseAddress, resolveAddress } from '@migaia/part-contract'

const index = createAddressIndex(blueprint)
const hit = resolveAddress(index, 'orders/rows/item@row:a%2Fb')
// hit.node is the template node, hit.rowKey === 'a/b'
parseAddress('orders/rows/item@row:a%2Fb') // { segments: ['orders', 'rows', 'item'], rowKey: 'a/b' }
```

A template host declares a list like this:

```json
{
  "tag": "list@1",
  "id": "rows",
  "template": {
    "rowKey": "id",
    "rows": { "$state": "page.rows" },
    "node": { "tag": "item@1", "id": "item", "facets": { "props": { "label": { "$row": "name" } } } }
  }
}
```

## Define arguments with a schema library

Arguments of enhancers, derives and resources can use any Standard Schema v1 library. `toCatalogSchema` stores the library's JSON Schema in the catalog; for a library without JSON Schema support pass a hand-written JSON Schema too, or it throws `SCHEMA_NOT_SERIALIZABLE`. `assertNoTransform` rejects schemas that rewrite values (for example `z.string().transform(...)`) with `SCHEMA_TRANSFORMS`, because arguments from a remote caller must pass validation unchanged.

```ts
import { assertNoTransform, toCatalogSchema, validateArgs } from '@migaia/part-contract'
import { z } from 'zod'

const args = z.object({ pageSize: z.number().int().min(1) })
assertNoTransform(args)
const jsonSchema = toCatalogSchema(args)
await validateArgs(args, { pageSize: 20 }) // rejects with ARGS_INVALID, issue list on cause
```

## Error codes

Source `part.contract`: `BLUEPRINT_INVALID`, `ADDRESS_INVALID`, `ADDRESS_DUPLICATE`, `DESCRIPTOR_INVALID`, `SCHEMA_NOT_SERIALIZABLE`, `SCHEMA_TRANSFORMS`, `ARGS_INVALID`, `RULE_FAILED`.

## Build and verify

```bash
pnpm --filter @migaia/part-contract run fmt
pnpm --filter @migaia/part-contract run lint
pnpm --filter @migaia/part-contract run typecheck
pnpm --filter @migaia/part-contract run test
```
