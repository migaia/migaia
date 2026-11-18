import type { IIndexedNode, IJsonPatchOperation } from '@migaia/part-contract'

/** Splits a JSON Pointer into unescaped tokens. */
function tokens(pointer: string): string[] {
  return pointer
    .split('/')
    .slice(1)
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'))
}

/** Returns a shallow copy of a container so the original document stays unchanged. */
function copy(value: unknown): Record<string, unknown> | unknown[] {
  return Array.isArray(value) ? [...value] : { ...(value as Record<string, unknown>) }
}

/** Writes one operation along a copied path and returns the new root. */
function applyOne(root: unknown, operation: IJsonPatchOperation): unknown {
  /** Path tokens of the operation. */
  const path = tokens(operation.path)
  /** New root, copied. */
  const next = copy(root)
  /** Container walk cursor. */
  let cursor: Record<string, unknown> | unknown[] = next
  for (let position = 0; position < path.length - 1; position += 1) {
    /** Key of the next container. */
    const key = path[position] as string
    /** Copied child container. */
    const child = copy((cursor as Record<string, unknown>)[key])
    ;(cursor as Record<string, unknown>)[key] = child
    cursor = child
  }
  /** Final key. */
  const last = path[path.length - 1] as string
  if (Array.isArray(cursor)) {
    /** Array index; `-` appends. */
    const index = last === '-' ? cursor.length : Number(last)
    if (operation.op === 'remove') cursor.splice(index, 1)
    else if (operation.op === 'add') cursor.splice(index, 0, operation.value)
    else cursor[index] = operation.value
  } else if (operation.op === 'remove') delete cursor[last]
  else cursor[last] = operation.value
  return next
}

/** Applies add, remove and replace operations without mutating the input document. */
export function applyPatch(document: unknown, operations: readonly IJsonPatchOperation[]): unknown {
  /** Document after each operation. */
  let current = document
  for (const operation of operations) current = applyOne(current, operation)
  return current
}

/**
 * Affected addresses of a patch: for each operation, the deepest node whose pointer prefixes the
 * operation path; a removed node counts as a change of its parent.
 */
export function affectedAddresses(
  entries: Iterable<IIndexedNode>,
  operations: readonly IJsonPatchOperation[]
): ReadonlySet<string> {
  /** Address by node pointer. */
  const byPointer = new Map<string, IIndexedNode>()
  for (const entry of entries) byPointer.set(entry.pointer, entry)
  /** Collected addresses. */
  const affected = new Set<string>()
  for (const operation of operations) {
    /** Pointer being walked up toward the root. */
    let pointer = operation.path
    /** Whether the operation removes a whole node at this pointer. */
    let removal = operation.op === 'remove'
    while (pointer !== '') {
      /** Node at this exact pointer. */
      const entry = byPointer.get(pointer)
      if (entry !== undefined && !removal) {
        affected.add(entry.address)
        break
      }
      if (entry !== undefined && removal && entry.parent !== undefined) {
        affected.add(entry.parent)
        break
      }
      removal = false
      pointer = pointer.slice(0, pointer.lastIndexOf('/'))
    }
  }
  return affected
}
