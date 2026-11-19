# @migaia/part-contract

Data and validation contract of the part platform: blueprint format, part addresses, descriptors, behavior groups, Standard Schema intake and the rule engine. It does not depend on the DOM, Node, Bun or React, so the editor, servers, the CLI and hosts all run the same rules.

## Start here

```ts
import { createRuleEngine, parseBlueprint } from '@migaia/part-contract'
import { builtinRules } from '@migaia/part-contract/doctor'

const engine = createRuleEngine({ rules: builtinRules, catalog })
const issues = engine.run('authored', parseBlueprint(input))
```

`catalog` is a read-only view: `get(id)` returns a descriptor, `majors(name)` the available majors of a name, and `writesFor(tag)` the fields enhancers declare they write.

## Addresses

- A node with an `id` uses it as its segment; otherwise the tag name (without `@major`, other characters replaced by `-`).
- Repeated same-name siblings get ordinals: `orders/button#0`, `orders/button#1`.
- Slot members add a `slot.<name>` segment: `orders/filter/slot.empty/text`.
- Template row instances append the row key: `orders/rows/status@row:123`. A template host declares the repeated subtree as `template: { rowKey, rows, node }`; `rows` is a `{ $state }` binding or a literal array, and `{ $row: 'field' }` inside `node` reads the current row.

## Rules

`/doctor` exports 36 built-in rules in eleven groups: html, aria, slot, catalog, style, event, flow, behavior, layout, resource and field. Rules run in two phases, `authored` (the raw blueprint) and `resolved` (after enhancement); rendered checks belong to `partom doctor --rendered`. In the authored phase, fields an enhancer declares in `writes` count as provided.

A throwing rule does not stop the others; it produces a `RULE_FAILED` issue whose `cause` is the original error.

## Argument schemas

`toCatalogSchema` accepts any Standard Schema v1 library (zod, valibot, arktype) and stores its JSON Schema in the catalog. `assertNoTransform` rejects schemas that transform values, because remote arguments must validate unchanged.

## Error codes (source `part.contract`)

`BLUEPRINT_INVALID`, `ADDRESS_INVALID`, `ADDRESS_DUPLICATE`, `DESCRIPTOR_INVALID`, `SCHEMA_NOT_SERIALIZABLE`, `SCHEMA_TRANSFORMS`, `ARGS_INVALID`, `RULE_FAILED`.
