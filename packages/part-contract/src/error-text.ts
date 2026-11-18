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
  /** A descriptor kind is not known. */
  descriptorKind: (kind: string): string => `descriptor kind "${kind}" is not registered`,
  /** A schema yields no JSON Schema. */
  schemaNotSerializable: 'schema cannot be converted to JSON Schema and no jsonSchema was given',
  /** A schema transforms its value. */
  schemaTransforms: 'schema input and output differ; argument schemas must not transform',
  /** A value failed argument validation. */
  argsInvalid: 'arguments failed schema validation',
  /** A rule threw while checking. */
  ruleFailed: (rule: string): string => `rule ${rule} threw while checking`
} as const
