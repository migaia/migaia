/** Atom definition kinds used to preserve primitive/derived write semantics. */
export const AtomKind = {
  primitive: 'primitive',
  primitiveFactory: 'primitive-factory',
  derived: 'derived',
  writableDerived: 'writable-derived'
} as const

export type IAtomKind = (typeof AtomKind)[keyof typeof AtomKind]
