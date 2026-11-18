/** Stable messages for errors thrown by the part contract; tests may assert them as contract text. */
export const PartContractErrorText = {
  /** The top-level blueprint value is not an object with `id`, `version` and `root`. */
  blueprintShape: 'blueprint must be an object with string id, integer version and root node',
  /** A node is not an object with a string tag. */
  nodeShape: (path: string): string =>
    `blueprint node at ${path} must be an object with a string tag`,
  /** A node id or slot name uses characters outside the address alphabet. */
  nameInvalid: (name: string): string =>
    `name "${name}" must contain only letters, digits, underscore and hyphen`,
  /** An address string does not match the grammar. */
  addressInvalid: (address: string): string => `address "${address}" does not match the grammar`,
  /** Two nodes received the same address. */
  addressDuplicate: (address: string): string => `two blueprint nodes share address "${address}"`,
  /** A descriptor is not an object with a kind and an id. */
  descriptorShape: 'descriptor must be an object with string kind and id',
  /** A descriptor id lacks the `@major` suffix. */
  descriptorId: (id: string): string => `descriptor id "${id}" must have the form name@major`,
  /** A meta key lacks a namespace. */
  descriptorMeta: (key: string): string => `meta key "${key}" must be namespaced as ns.name`,
  /** A layout behaviour group breaks a structural rule; `reason` comes from `LayoutInvalidReason`. */
  layoutInvalid: (region: string, reason: string): string =>
    region === ''
      ? `layout is invalid: ${reason}`
      : `layout region "${region}" is invalid: ${reason}`,
  /** A descriptor kind is not known. */
  descriptorKind: (kind: string): string => `descriptor kind "${kind}" is not registered`,
  /** A schema yields no JSON Schema. */
  schemaNotSerializable: 'schema cannot be converted to JSON Schema and no jsonSchema was given',
  /** A schema transforms its value. */
  schemaTransforms: 'schema input and output differ; argument schemas must not transform',
  /** A value failed argument validation. */
  argsInvalid: 'arguments failed schema validation',
  /** A rule threw while checking. */
  ruleFailed: (rule: string): string => `rule ${rule} threw while checking`,
  /** An events record key has a malformed shorthand segment. */
  eventKey: (key: string, segment: string): string =>
    `event key "${key}" has invalid segment "${segment}"`,
  /** A modifier reference is not `name@major` or `{ id: name@major }`. */
  modifierRef: (path: string): string =>
    `modifier at ${path} must be "name@major" or { id: "name@major", args? }`,
  /** A fragment usage carries children, a template or facets other than props and slots. */
  fragmentUsage: (path: string): string =>
    `fragment usage at ${path} may only carry id, props and slots`,
  /** A fragment descriptor's subtree is malformed. */
  fragmentBody: (id: string): string =>
    `fragment ${id} must carry a node; $param may not appear in id, tag or slot names; each $slot once`,
  /** A fragment expands into itself. */
  fragmentCycle: (id: string): string => `fragment ${id} expands into itself`,
  /** Fragment nesting is too deep. */
  fragmentTooDeep: (limit: number): string => `fragment expansion is nested deeper than ${limit}`,
  /** Fragment expansion produced too many nodes. */
  fragmentTooLarge: (limit: number): string =>
    `fragment expansion produced more than ${limit} nodes`
} as const

/**
 * Reasons appended to `PartContractErrorText.layoutInvalid`. They are contract text: tests and
 * tooling match them to tell layout structure problems apart.
 */
export const LayoutInvalidReason = {
  /** The group is not `{ direction, regions }` with at least one region. */
  shape: 'layout needs direction row or column and at least one region',
  /** A region is not an object with a valid name and a known landmark. */
  region: 'region needs a name in the address alphabet and a known landmark',
  /** `label` is not a string, or `resizable` / `scroll` are not booleans. */
  fieldType: 'label must be a string; resizable and scroll must be booleans',
  /** `collapseBelow` is not a number. */
  collapseBelow: 'collapseBelow must be a number of pixels',
  /** Two regions share a name. */
  duplicate: 'region name is used twice',
  /** The layout has no main region or more than one. */
  mainCount: 'layout needs exactly one main region',
  /** `size.default` is not a pixel number, `auto` or `<n>fr`, or min/max are not numbers. */
  size: 'size default must be pixels, auto or <n>fr; min and max must be numbers',
  /** A resizable region lacks a pixel default or min/max. */
  resizable: 'resizable region needs a pixel default with min and max',
  /** `min` is greater than `max`. */
  range: 'min is greater than max',
  /** The pixel default lies outside `[min, max]`. */
  defaultRange: 'default lies outside min and max',
  /** The main region declares `collapseBelow`. */
  mainCollapse: 'the main region cannot collapse',
  /** A collapsible region has no label for its toggle. */
  collapseLabel: 'a collapsible region needs a label',
  /** A landmark appears more than once and this region has no label. */
  landmarkLabel: 'a repeated landmark needs a label on each region'
} as const
