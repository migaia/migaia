import {
  applyPatch,
  createAddressIndex,
  parseBlueprint,
  type IAddressIndex,
  type IBlueprint,
  type IJsonPatchOperation,
  type IPartNode
} from '@migaia/part-contract'

/** JSON Pointer escaping of one key. */
export function pointerKey(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1')
}

/**
 * One blueprint being edited: the document read from the draft (`read`) with its catalog hash
 * (`base`), the current local document, and the operations not saved yet. Every edit is a JSON
 * Patch applied to the local copy at once and appended to the pending list.
 */
export class EditorDocument {
  /** Blueprint id. */
  readonly id: string
  /** Document as read from the draft; the merge base after a conflict. */
  #read: IBlueprint
  /** Catalog hash of `#read`; the changeset base. */
  #base: string | null
  /** Current local document. */
  #current: IBlueprint
  /** Operations since the last save or merge. */
  #pending: IJsonPatchOperation[] = []
  /** Address index of the current document, rebuilt lazily after edits. */
  #index: IAddressIndex | undefined

  /** Starts from a draft document and its hash. */
  constructor(document: IBlueprint, base: string | null) {
    this.id = document.id
    this.#read = document
    this.#base = base
    this.#current = document
  }

  /** Current local document. */
  get current(): IBlueprint {
    return this.#current
  }

  /** Document as read. */
  get read(): IBlueprint {
    return this.#read
  }

  /** Changeset base hash. */
  get base(): string | null {
    return this.#base
  }

  /** True when edits wait to be saved. */
  get dirty(): boolean {
    return this.#pending.length > 0
  }

  /** Pending operations. */
  get pending(): readonly IJsonPatchOperation[] {
    return this.#pending
  }

  /** Address index of the current document; undefined while the document does not parse. */
  index(): IAddressIndex | undefined {
    if (this.#index === undefined) {
      try {
        this.#index = createAddressIndex(parseBlueprint(this.#current))
      } catch {
        // A document that does not parse has no index; the rule run reports why.
        return undefined
      }
    }
    return this.#index
  }

  /** Applies operations to the local document and records them. */
  apply(operations: readonly IJsonPatchOperation[]): void {
    this.#current = applyPatch(this.#current, operations) as IBlueprint
    this.#pending.push(...operations)
    this.#index = undefined
  }

  /** Marks the current document saved under a new catalog hash. */
  saved(hash: string): void {
    this.#read = this.#current
    this.#base = hash
    this.#pending = []
  }

  /** Replaces the local document after a merge: new read document and base, pending = whole root. */
  rebase(read: IBlueprint, base: string, merged: IBlueprint): void {
    this.#read = read
    this.#base = base
    this.#current = merged
    this.#pending = [{ op: 'replace', path: '/root', value: merged.root }]
    this.#index = undefined
  }
}

/** Operations setting `facets.<group>.<key>` of the node at `pointer`; `undefined` removes it. */
export function setFacetOps(
  node: IPartNode,
  pointer: string,
  group: string,
  key: string,
  value: unknown
): IJsonPatchOperation[] {
  /** Facets of the node. */
  const facets = (node as { facets?: Record<string, Record<string, unknown> | undefined> }).facets
  /** Path of the group. */
  const groupPath = `${pointer}/facets/${pointerKey(group)}`
  if (value === undefined)
    return facets?.[group]?.[key] === undefined
      ? []
      : [{ op: 'remove', path: `${groupPath}/${pointerKey(key)}` }]
  /** Parent creation operations. */
  const parents: IJsonPatchOperation[] = []
  if (facets === undefined) parents.push({ op: 'add', path: `${pointer}/facets`, value: {} })
  if (facets?.[group] === undefined) parents.push({ op: 'add', path: groupPath, value: {} })
  return [...parents, { op: 'add', path: `${groupPath}/${pointerKey(key)}`, value }]
}

/** Move operation one place up within the node's list, or none for the first item or the root. */
export function moveUpOps(pointer: string): IJsonPatchOperation[] {
  /** Position of the last separator. */
  const cut = pointer.lastIndexOf('/')
  /** Index within the list. */
  const index = Number(pointer.slice(cut + 1))
  if (!Number.isInteger(index) || index === 0) return []
  return [{ op: 'move', from: pointer, path: `${pointer.slice(0, cut)}/${index - 1}` }]
}
