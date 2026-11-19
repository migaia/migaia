# `@migaia/part-contract` guide

[中文](./USEGUIDE.md)

See the [README](./README.en.md) for what the package is for. The package holds only plain data and pure functions; the examples below run in Node, Bun and browsers.

## Find by scenario

| Problem                                              | API                                    | Section                                                               |
| ---------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------- |
| Confirm a blueprint is well formed before saving     | `parseBlueprint`                       | [Confirm a blueprint before saving](#confirm-a-blueprint-before-saving) |
| Give the same issue list on the server and in the editor | `createRuleEngine`, `builtinRules` | [The same issue list everywhere](#the-same-issue-list-everywhere)     |
| Declare data models, resource bindings and form fields | `defineModel`, `checkModels`         | [Declare data models](#declare-data-models-resource-bindings-and-form-fields) |
| Turn a team convention into a rule                   | `defineRule`                           | [Turn a convention into a rule](#turn-a-convention-into-a-rule)       |
| Find a node from an address, list rows included      | `createAddressIndex`, `resolveAddress` | [Find a node from an address](#find-a-node-from-an-address)           |
| Define arguments with zod and get JSON Schema too    | `toCatalogSchema`, `assertNoTransform` | [Define arguments with a schema library](#define-arguments-with-a-schema-library) |
| Build a version snapshot, check a client's capabilities, merge drafts | `collectDefinitions`, `checkDelivery`, `mergeBlueprint` | [Release, delivery and merge](#release-delivery-and-merge) |

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

The 37 built-in rules cover html, aria, slot, catalog, style, event, flow, behavior, layout, resource, field and security. For example:

- `event.modifier-exists`, `event.modifier-kind`, `event.modifier-placement`, `event.modifier-duplicate`: a referenced modifier must be in the catalog, must declare the subscribed event kind (component callbacks take no modifiers), at most one modifier may move the listener and none on template rows, and an id may appear once per subscription.
- Fragments: `expandFragments(blueprint, catalog)` replaces every node whose tag names a fragment by the fragment's subtree, substitutes `{ $param }` placeholders with the usage's props and inserts slot fills at `{ $slot }`; slot nodes keep their authored address `<usage>/slot.<name>/<segment>`. It reports `fragment.param-missing` and `fragment.slot-unknown`, and throws `FRAGMENT_CYCLE`, `FRAGMENT_TOO_DEEP` (16 levels) and `FRAGMENT_TOO_LARGE` (10000 nodes).
- `behavior.no-zindex`: a blueprint cannot set `z-index`; `behavior.layer` decides layering.
- `layout.single-main`, `layout.region-unknown`, `layout.size-range`: a blueprint has at most one outermost layout (a layout placed inside another layout's region does not count), because only the outermost layout's `main` region becomes the page's `main` landmark; a blueprint may only fill regions the layout has; `props.sizes` may only set initial widths of resizable regions, inside that region's `min` and `max`.

## Declare a layout

A layout is a part with `behavior.layout`. Regions are slots: a blueprint fills them with `facets.slots.<region>`. Each region declares a landmark (which decides whether it renders as `header`, `nav`, `main`, `aside`, `footer` or `section`; the mapping is `LandmarkElement`), an optional size, whether it can be resized, and the container width in pixels below which it collapses into a drawer.

```ts
const layout = {
  direction: 'row',
  regions: [
    { name: 'nav', landmark: 'navigation', label: 'Main navigation', resizable: true,
      size: { default: 240, min: 160, max: 480 }, collapseBelow: 720 },
    { name: 'content', landmark: 'main' }
  ]
}
```

`validateDescriptor` rejects the following with `DESCRIPTOR_INVALID`: duplicate region names, a main region count other than one, a resizable region without a pixel default or `min`/`max`, a default outside the range, a collapsible `main`, a collapsible region without `label`, and a repeated landmark where some region lacks `label`. A layout node in a blueprint accepts the three props listed in `LayoutProp`: `sizes` (initial widths of resizable regions), `labels` (region label overrides, for localisation) and `skipLabel` (text of the skip-to-main link).

## Declare data models, resource bindings and form fields

`defineModel` declares a backend-neutral data model: a field schema (a Standard Schema; the catalog stores its JSON Schema, or the one you pass as `jsonSchema`), the primary key `key`, display hints `display` (label, a format from `ModelFieldFormat`, enum labels) and `relations` to other models. Fields named in the key, hints and relations must be in the schema's `properties`, otherwise `DESCRIPTOR_INVALID` is thrown.

```ts
const order = defineModel({
  id: 'order@1',
  schema: z.object({ id: z.string(), customer: z.string().min(1), status: z.enum(['open', 'closed']) }),
  key: ['id'],
  display: { status: { format: 'enum', enumLabels: { open: 'Open', closed: 'Closed' } } }
})
```

A part declares with `behavior.resource = { prop, slots }` which prop receives a resource snapshot (`IResourceSnapshot`: `status` from `ResourceStatus`, plus `data`, `error`, `refreshing`, `page`) and which slots show while loading, empty or failed. The blueprint writes `{ $resource: 'orders@1', params: { status: { $state: 'page.status' } } }` on that prop. A form control declares the field protocol with `behavior.field = { value, change, read }`: the value prop, the change event and how the event carries the value (`FieldRead`); the renderer uses it to write input back to the bound state.

Rules `resource.bind-target`, `resource.bind-prop` and `resource.params` check a resource binding's id, position and literal parameters; `field.value-bound` warns when a field value is not bound to state. State paths and derives bound inside `params` are checked by `flow.bind-path`, `flow.scope` and `catalog.id-exists` as well. `checkModels(catalog)` checks that model relations point at existing models; `partom doctor` calls it once per run.

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

## Release, delivery and merge

The stage-4 release path (catalog service, `partom build`/`pull`, the client delivery plugin, the editor) shares these shapes and pure functions instead of each writing its own.

- **Snapshots and version identity.** `IPartSnapshot` holds the `lock`, the blueprints and the descriptors of every referenced definition. `collectDefinitions(blueprints, catalog)` returns every definition id the blueprints reference (node tags, fragments, event handlers and modifiers, `$derive`, `$resource`, model relations, enhancers targeting those parts), each once. A version is identified by `hashBytes` of the raw `snapshot.json` bytes, so every party gets the same value for the same bytes. `parseSnapshot(bytes)` checks the shape and throws `SNAPSHOT_INVALID`, with `cause.pointer` naming the first problem.
- **Remote module names.** `IRemoteModuleRef.name` is the source path relative to the remote-module root and stays stable across versions. `isModuleName` refuses `..`, `.`, absolute paths and names that are not `.ts`/`.tsx`; the catalog and the CLI check it before writing files.
- **Delivery check.** `checkDelivery(snapshot, manifest)` lists every definition id that neither the client build nor a remote module provides.
- **Merge and audit.** `mergeBlueprint(base, ours, theirs)` merges three ways by address and configuration group. Different values on both sides, deleting a node the other side changed, and different child orders are conflicts that keep `ours`. `auditTargets(before, after)` returns the changed addresses and groups.
- **JSON Patch.** `applyPatch` supports `add`, `remove`, `replace` and `move` and rejects any other op as a whole (`PATCH_OP_UNSUPPORTED`) without writing anything. `affectedAddresses` counts a `move` as a change of the parents at both ends.
- **No secrets in blueprints.** The built-in rule `security.secret` reports private-key headers, cloud-key shapes and literal `password`/`secret`/`token`/`apiKey` values as errors; the issue never echoes the value.
- **Budget and virtual-scroll fields.** Descriptors may declare `budget: { size, render }` (bytes, milliseconds) and templates `virtual: { rowHeight, overscan }`; `partom` and the React renderer check them.

## Error codes

Source `part.contract`: `BLUEPRINT_INVALID`, `ADDRESS_INVALID`, `ADDRESS_DUPLICATE`, `DESCRIPTOR_INVALID`, `SCHEMA_NOT_SERIALIZABLE`, `SCHEMA_TRANSFORMS`, `ARGS_INVALID`, `RULE_FAILED`, `FRAGMENT_CYCLE`, `FRAGMENT_TOO_DEEP`, `FRAGMENT_TOO_LARGE`, `PATCH_OP_UNSUPPORTED`, `SNAPSHOT_INVALID`.

## Build and verify

```bash
pnpm --filter @migaia/part-contract run fmt
pnpm --filter @migaia/part-contract run lint
pnpm --filter @migaia/part-contract run typecheck
pnpm --filter @migaia/part-contract run test
```
