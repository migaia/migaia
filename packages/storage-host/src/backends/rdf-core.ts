import { encodeStorageRdfTerm } from '../authoring/rdf.js'
import { type IQuad } from '@migaia/storage-contract'
import { STORAGE_MEMORY_BACKEND } from '../state-constants.js'
import { createOrderedRecordIndex, type IOrderedRecordIndex } from '../core/ordered-record-index.js'

/** The six native permutations share the original compressed radix and canonical term bytes. */
const rdfOrders = [
  ['subject', 'predicate', 'object', 'graph'],
  ['predicate', 'object', 'subject', 'graph'],
  ['object', 'subject', 'predicate', 'graph'],
  ['graph', 'subject', 'predicate', 'object'],
  ['graph', 'predicate', 'object', 'subject'],
  ['graph', 'object', 'subject', 'predicate']
] as const
/** Index names describe actual native access paths rather than a second query planner. */
const rdfIndexNames = ['rdf.spo', 'rdf.pos', 'rdf.osp', 'rdf.gspo', 'rdf.gpos', 'rdf.gosp'] as const
/** Each physical row retains these six independent native keys for exact removal. */
export type IMemoryRdfKeys = readonly Uint8Array[]

/** Concatenates already self-delimiting term bytes without reclassifying them as binary keys. */
function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  /** Only the actual selected components contribute to this native key. */
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0))
  /** Each component is copied once into the independently retained key. */
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}

/** Captures term bytes once, then constructs the six fixed physical permutations. */
export function memoryRdfKeys(quad: IQuad): IMemoryRdfKeys {
  /** Shared term admission and encoding remain the contract owner's sole codec. */
  const terms = {
    subject: encodeStorageRdfTerm(quad.subject, STORAGE_MEMORY_BACKEND),
    predicate: encodeStorageRdfTerm(quad.predicate, STORAGE_MEMORY_BACKEND),
    object: encodeStorageRdfTerm(quad.object, STORAGE_MEMORY_BACKEND),
    graph: encodeStorageRdfTerm(quad.graph, STORAGE_MEMORY_BACKEND)
  }
  return rdfOrders.map((order) => concatenate(order.map((position) => terms[position])))
}

/** A namespace or draft owns one six-index set; its first radix remains the original channel index. */
export function createMemoryRdfIndex<T>(primary: IOrderedRecordIndex<T>) {
  /** The primary tree is borrowed, so no seventh physical identity index is allocated. */
  const indexes = [primary, ...rdfOrders.slice(1).map(() => createOrderedRecordIndex<T>())]
  /** Select the longest consecutive bound prefix; fixed permutations cover every bound subset. */
  const select = (pattern: Readonly<Partial<IQuad>>) => {
    /** Each supplied canonical term contributes exactly one shared encoding to access-path choice. */
    const terms = new Map<keyof IQuad, Uint8Array>()
    for (const position of rdfOrders[0]) {
      /** Only supplied positions contribute to the native prefix, including explicit DefaultGraph. */
      const value = pattern[position]
      if (value !== undefined)
        terms.set(position, encodeStorageRdfTerm(value, STORAGE_MEMORY_BACKEND))
    }
    /** Ties retain the first stable permutation and never sort candidates. */
    let chosen = 0
    /** Bound component count alone chooses an access path; byte length does not bias it. */
    let count = 0
    for (const [index, order] of rdfOrders.entries()) {
      /** A gap terminates this access path; later components cannot be treated as a prefix. */
      let bound = 0
      for (const position of order) {
        if (!terms.has(position)) break
        bound++
      }
      if (bound > count) {
        chosen = index
        count = bound
      }
    }
    return {
      index: indexes[chosen]!,
      name: rdfIndexNames[chosen]!,
      prefix: concatenate(
        rdfOrders[chosen]!.slice(0, count).map((position) => terms.get(position)!)
      )
    }
  }
  return {
    select,
    set: (keys: IMemoryRdfKeys, value: T): void => {
      for (const [index, tree] of indexes.entries()) tree.set(keys[index]!, value)
    },
    delete: (keys: IMemoryRdfKeys): void => {
      for (const [index, tree] of indexes.entries()) tree.delete(keys[index]!)
    },
    clear: (): void => {
      for (const tree of indexes) tree.clear()
    },
    /**
     * Saves adjacency before yielding so deletion of the current physical row cannot truncate a
     * scan.
     */
    match: function* (pattern: Readonly<Partial<IQuad>>): IterableIterator<T> {
      const { index, prefix } = select(pattern)
      /** Seeking starts at the bound rather than walking preceding leaves. */
      let leaf = prefix.length === 0 ? index.first : index.lowerBound(prefix)
      while (leaf) {
        if (prefix.some((byte, index) => leaf!.key[index] !== byte)) return
        /** The caller may unlink this yielded row before requesting its successor. */
        const next = leaf.next
        yield leaf.value
        leaf = next
      }
    }
  }
}
