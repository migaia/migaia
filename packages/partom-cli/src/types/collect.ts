/**
 * Type data collected by `partom doctor --types` from resolved trees and the catalog. Runs in the
 * doctor process, which already loaded the project; the result is plain JSON.
 */
import type { IDescriptor, IJsonSchema, IStoreDescriptor } from '@migaia/part-contract'
import type { IResolvedNode } from '@migaia/part-host'

/** One address entry: a static address, or the prefix of template-row instance addresses. */
export type IAddressEntry = { readonly address: string; readonly row: boolean }

/** One state path with the schema of its value, when known. */
export type IStateEntry = { readonly path: string; readonly schema?: IJsonSchema }

/** One event with a declared detail schema at an address. */
export type IEventEntry = {
  readonly address: string
  readonly event: string
  readonly detail: IJsonSchema
}

/** One resource with its parameter, result and command schemas. */
export type IResourceEntry = {
  readonly id: string
  readonly params?: IJsonSchema
  readonly result?: IJsonSchema
  readonly commands: Readonly<Record<string, IJsonSchema | undefined>>
}

/**
 * Everything the `.d.ts` generator needs. `stores` lists the host's registered namespaces besides
 * `page`, `section` and `part`, with the JSON Schema of their values when declared.
 */
export type ITypesData = {
  readonly addresses: IAddressEntry[]
  readonly states: IStateEntry[]
  readonly events: IEventEntry[]
  readonly resources: IResourceEntry[]
  readonly stores: IStoreDescriptor[]
  readonly notes: string[]
}

/** Namespaces of the default store, never listed in `stores`. */
const DEFAULT_NAMESPACES: ReadonlySet<string> = new Set(['page', 'section', 'part'])

/** True for a `{ $state }` binding. */
function statePath(value: unknown): string | undefined {
  /** Path of the binding. */
  const path = (value as { $state?: unknown } | null | undefined)?.$state
  return typeof path === 'string' ? path : undefined
}

/**
 * Collects types data. State paths are kept once each (a Map in first-seen order); a path seen with
 * two different value schemas gets `unknown` and a note.
 */
export class TypesCollector {
  /** Addresses in document order. */
  readonly #addresses = new Map<string, IAddressEntry>()
  /** States by path. */
  readonly #states = new Map<string, IStateEntry>()
  /** Paths whose schemas conflict. */
  readonly #conflicts = new Set<string>()
  /** Events with details. */
  readonly #events: IEventEntry[] = []

  /** Walks one resolved tree. */
  addTree(root: IResolvedNode): void {
    this.#walk(root, false)
  }

  /** The collected data with the catalog's resources and registered store namespaces. */
  result(descriptors: Iterable<IDescriptor>, stores: readonly IStoreDescriptor[] = []): ITypesData {
    /** Resources of the catalog. */
    const resources: IResourceEntry[] = []
    for (const descriptor of descriptors) {
      if (descriptor.kind !== 'resource') continue
      /** Command entries of the descriptor editor block. */
      const commands: Record<string, IJsonSchema | undefined> = {}
      for (const [name, entry] of Object.entries(
        (descriptor.editor?.commands ?? {}) as Record<string, { args?: IJsonSchema }>
      ))
        commands[name] = entry.args
      resources.push({
        id: descriptor.id,
        ...(descriptor.args === undefined ? {} : { params: descriptor.args }),
        ...(descriptor.editor?.result === undefined
          ? {}
          : { result: descriptor.editor.result as IJsonSchema }),
        commands
      })
    }
    return {
      addresses: [...this.#addresses.values()],
      states: [...this.#states.values()],
      events: this.#events,
      resources,
      stores: stores.filter((store) => !DEFAULT_NAMESPACES.has(store.namespace)),
      notes: [...this.#conflicts]
    }
  }

  /** Visits a node and its subtree; `row` marks nodes inside a template. */
  #walk(node: IResolvedNode, row: boolean): void {
    this.#addresses.set(`${row ? 'row' : 'static'}\u0000${node.address}`, {
      address: node.address,
      row
    })
    this.#collectStates(node)
    if (!row) this.#collectEvents(node)
    for (const child of node.children) this.#walk(child, row)
    for (const members of Object.values(node.slots))
      for (const member of members) this.#walk(member, row)
    if (node.template !== undefined) this.#walk(node.template.node, true)
  }

  /** State paths of a node: prop bindings, resource parameter bindings, open and aria states. */
  #collectStates(node: IResolvedNode): void {
    /** Field protocol of the part. */
    const field = node.behavior.field
    /** Props schema of the part. */
    const props = node.definition.descriptor.args?.properties as
      | Readonly<Record<string, IJsonSchema>>
      | undefined
    for (const [key, value] of Object.entries(node.config.props ?? {})) {
      /** Bound path. */
      const path = statePath(value)
      if (path !== undefined) this.#addState(path, field?.value === key ? props?.[key] : undefined)
      /** Parameters of a resource binding. */
      const params = (
        value as { $resource?: unknown; params?: Record<string, unknown> } | null | undefined
      )?.params
      if (typeof (value as { $resource?: unknown } | null | undefined)?.$resource === 'string')
        for (const param of Object.values(params ?? {})) {
          /** Bound parameter path. */
          const paramPath = statePath(param)
          if (paramPath !== undefined) this.#addState(paramPath, undefined)
        }
    }
    /** Rows binding of a template host. */
    const rowsPath = statePath(node.template?.rows)
    if (rowsPath !== undefined) this.#addState(rowsPath, undefined)
    if (node.openStatePath !== undefined) this.#addState(node.openStatePath, { type: 'boolean' })
    for (const path of Object.values(node.ariaStates)) this.#addState(path, undefined)
  }

  /** Records a state path; a second, different schema turns the value into `unknown`. */
  #addState(path: string, schema: IJsonSchema | undefined): void {
    /** Existing entry. */
    const existing = this.#states.get(path)
    if (existing === undefined) {
      this.#states.set(path, schema === undefined ? { path } : { path, schema })
      return
    }
    if (schema === undefined || this.#conflicts.has(path)) return
    if (existing.schema === undefined) {
      this.#states.set(path, { path, schema })
      return
    }
    if (JSON.stringify(existing.schema) !== JSON.stringify(schema)) {
      this.#states.set(path, { path })
      this.#conflicts.add(path)
    }
  }

  /** Events with a declared detail schema. */
  #collectEvents(node: IResolvedNode): void {
    for (const [event, declaration] of Object.entries(node.definition.descriptor.events ?? {}))
      if (declaration.detail !== undefined)
        this.#events.push({ address: node.address, event, detail: declaration.detail })
  }
}
