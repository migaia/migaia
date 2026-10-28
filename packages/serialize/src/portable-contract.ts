/** Portable wire discriminants and walker rejection reasons; no traversal or consumer policy. */

/** Stable portable bytes fields belong to this codec owner, including legacy tag validation. */
export const PortableBytesField = {
  marker: '$rpc',
  data: 'base64url',
  kind: 'bytes'
} as const

/** Stable generic failure reasons supplied to consumer-owned error construction. */
export const PortableViolation = {
  depth: 'depth',
  cycle: 'cycle',
  ancestor: 'ancestor',
  access: 'access',
  scalar: 'scalar',
  prototype: 'prototype',
  binary: 'binary',
  tag: 'tag',
  sparse: 'sparse'
} as const

/** Collection tag fields extend the same reserved record namespace as portable bytes. */
export const PortableCollectionField = {
  map: 'map',
  set: 'set',
  entries: 'entries',
  values: 'values'
} as const
