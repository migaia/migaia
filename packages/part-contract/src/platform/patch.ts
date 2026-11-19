import type { IIndexedNode } from '../address.ts'
import { PartContractErrorCode } from '../error-code.ts'
import { PartContractErrorText } from '../error-text.ts'
import { createPartContractError } from '../errors.ts'
import type { IJsonPatchOperation } from '../types.ts'

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

/** Reads the value at a pointer without copying; `undefined` when a step is missing. */
function readAt(root: unknown, pointer: string): unknown {
  /** Container walk cursor. */
  let cursor: unknown = root
  for (const token of tokens(pointer)) {
    if (cursor === null || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[token]
  }
  return cursor
}

/**
 * Writes one `add`, `remove` or `replace` step along a copied path and returns the new root. The
 * `value` argument is the value to place; it is ignored for `remove`.
 */
function writeAt(
  root: unknown,
  pointer: string,
  op: 'add' | 'remove' | 'replace',
  value: unknown
): unknown {
  /** Path tokens of the operation. */
  const path = tokens(pointer)
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
    if (op === 'remove') cursor.splice(index, 1)
    else if (op === 'add') cursor.splice(index, 0, value)
    else cursor[index] = value
  } else if (op === 'remove') delete cursor[last]
  else cursor[last] = value
  return next
}

/** Applies one operation; `move` removes at `from` and then adds at `path` (RFC 6902). */
function applyOne(root: unknown, operation: IJsonPatchOperation): unknown {
  if (operation.op === 'move') {
    /** The value being moved, read before removal. */
    const moved = readAt(root, operation.from)
    return writeAt(writeAt(root, operation.from, 'remove', undefined), operation.path, 'add', moved)
  }
  if (operation.op === 'remove') return writeAt(root, operation.path, 'remove', undefined)
  return writeAt(root, operation.path, operation.op, operation.value)
}

/**
 * Throws PATCH_OP_UNSUPPORTED for the first operation whose `op` is not add, remove, replace or
 * move; the operation index and op are on `cause`. Callers reject the whole patch, so no document
 * is ever written with an unknown operation.
 */
function assertSupported(operations: readonly IJsonPatchOperation[]): void {
  for (let index = 0; index < operations.length; index += 1) {
    /** Operation op as received; input may come from untrusted JSON. */
    const op = (operations[index] as { readonly op: unknown }).op
    if (op !== 'add' && op !== 'remove' && op !== 'replace' && op !== 'move') {
      throw createPartContractError(
        PartContractErrorCode.patchOpUnsupported,
        PartContractErrorText.patchOpUnsupported(index, String(op)),
        { index, op }
      )
    }
  }
}

/**
 * Applies add, remove, replace and move operations without mutating the input document. Any other
 * operation makes the whole call throw PATCH_OP_UNSUPPORTED before anything is applied.
 */
export function applyPatch(document: unknown, operations: readonly IJsonPatchOperation[]): unknown {
  assertSupported(operations)
  /** Document after each operation. */
  let current = document
  for (const operation of operations) current = applyOne(current, operation)
  return current
}

/**
 * Address of the node a pointer changes: the deepest node whose pointer prefixes it; a pointer that
 * names a whole node changes that node's parent when `asChildList` is true (removal, insertion or
 * reordering among siblings). `undefined` when no indexed node prefixes the pointer.
 */
function addressOf(
  byPointer: ReadonlyMap<string, IIndexedNode>,
  pointer: string,
  asChildList: boolean
): string | undefined {
  /** Pointer being walked up toward the root. */
  let current = pointer
  /** Whether the next exact match should resolve to its parent. */
  let parentOfExact = asChildList
  while (current !== '') {
    /** Node at this exact pointer. */
    const entry = byPointer.get(current)
    if (entry !== undefined && !parentOfExact) return entry.address
    if (entry !== undefined && parentOfExact && entry.parent !== undefined) return entry.parent
    parentOfExact = false
    current = current.slice(0, current.lastIndexOf('/'))
  }
  return undefined
}

/**
 * Affected addresses of a patch: for each operation, the deepest node whose pointer prefixes the
 * operation path; a removed node counts as a change of its parent, and a `move` counts as a change
 * of the parents at both `from` and `path` (sibling order belongs to the parent's children).
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
    /** Addresses this operation changes. */
    const found =
      operation.op === 'move'
        ? [addressOf(byPointer, operation.from, true), addressOf(byPointer, operation.path, true)]
        : [addressOf(byPointer, operation.path, operation.op === 'remove')]
    for (const address of found) if (address !== undefined) affected.add(address)
  }
  return affected
}
