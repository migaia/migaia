/** Public data shapes of the part contract. Everything here is plain, serializable data. */

/** A part address such as `orders/button#0` or `orders/rows/status@row:12`. */
export type IPartAddress = string

/** Blueprint document: an identified, versioned tree of part nodes. */
export type IBlueprint = { readonly id: string; readonly version: number; readonly root: IPartNode }

/** One part instance in a blueprint. `tag` references a part definition as `name@major`. */
export type IPartNode = {
  readonly tag: string
  readonly id?: string
  readonly facets?: IPartFacets
  readonly children?: readonly IPartNode[]
  readonly template?: IPartTemplate
}

/**
 * Repeated subtree of a template host. `rows` is a `{ $state }` binding or a literal array of row
 * objects; `rowKey` names the row field whose value becomes the instance key in `…@row:<key>`
 * addresses. Inside `node`, `{ $row: 'field' }` reads a field of the current row.
 */
export type IPartTemplate = {
  readonly rowKey: string
  readonly rows?: unknown
  readonly node: IPartNode
}

/** Configuration groups of a node. Values may be literals or binding objects such as `{ $state }`. */
export type IPartFacets = {
  readonly attrs?: Readonly<Record<string, unknown>>
  readonly props?: Readonly<Record<string, unknown>>
  readonly aria?: Readonly<Record<string, unknown>>
  readonly data?: Readonly<Record<string, unknown>>
  readonly style?: Readonly<Record<string, unknown>>
  readonly slots?: Readonly<Record<string, readonly IPartNode[]>>
  readonly events?: Readonly<Record<string, IEventSubscription>>
}

/** Semantic layer names; the only declaration of the level domain across the platform. */
export const LayerLevel = {
  base: 'base',
  sticky: 'sticky',
  dropdown: 'dropdown',
  overlay: 'overlay',
  modal: 'modal',
  toast: 'toast'
} as const

/** One semantic layer name. */
export type LayerLevel = keyof typeof LayerLevel

/** WAI-ARIA Authoring Practices pattern names a part may claim. */
export type IApgPattern =
  | 'listbox'
  | 'menu'
  | 'menubar'
  | 'tabs'
  | 'radio-group'
  | 'toolbar'
  | 'tree'
  | 'dialog'
  | 'alertdialog'
  | 'disclosure'
  | 'accordion'
  | 'combobox'
  | 'slider'
  | 'switch'
  | 'checkbox'

/** How one aria attribute is derived: from a state name, or as a relation to another address. */
export type IAriaDerivation = { readonly fromState: string } | { readonly relation: IPartAddress }

/**
 * Behaviour groups of a part definition: semantics, aria, focus, keyboard, states, dismissal,
 * layer.
 */
export type IBehavior = {
  readonly semantics?: {
    readonly element?: string
    readonly role?: string
    readonly pattern?: IApgPattern
  }
  readonly aria?: Readonly<Record<string, IAriaDerivation>>
  readonly focus?: {
    readonly stops?: number
    readonly mode?: 'roving' | 'activedescendant'
    readonly initial?: string
    readonly restore?: boolean
    readonly trap?: boolean
  }
  readonly keyboard?: Readonly<Record<string, string>>
  readonly rtlMirror?: boolean
  readonly states?: {
    readonly names: readonly string[]
    readonly openState?: string
    readonly openChange?: string
  }
  readonly dismiss?: {
    readonly escape?: boolean
    readonly outside?: boolean
    readonly blur?: boolean
  }
  readonly layer?: 'top' | LayerLevel
  readonly managedBy?: 'host' | 'component'
}

/** Declaration of an event a part emits. */
export type IEventDeclaration = {
  readonly kind: 'dom' | 'custom' | 'component'
  readonly bubbles?: boolean
  readonly composed?: boolean
  readonly cancelable?: boolean
  readonly detail?: IJsonSchema
  readonly reason?: readonly string[]
}

/** Subscription to an event in a blueprint; `handler` is an effect id. */
export type IEventSubscription = {
  readonly handler: string
  readonly filter?: Readonly<Record<string, unknown>>
  readonly modifiers?: readonly ('stop' | 'prevent' | 'self' | 'outside')[]
  readonly capture?: boolean
  readonly once?: boolean
  readonly passive?: boolean
  readonly sync?: boolean
}

/** Content rule of a named slot. `accepts` lists part names without major. */
export type ISlotDeclaration = {
  readonly accepts?: readonly string[]
  readonly max?: number
  readonly interactive?: boolean
}

/** Value type of a style hook. */
export type IStyleHookType = 'color' | 'length' | 'token' | 'number' | 'string'

/** A JSON Schema object as stored in the catalog. */
export type IJsonSchema = Readonly<Record<string, unknown>>

/** Built-in descriptor kinds. */
export type IBuiltinKind = 'part' | 'enhancer' | 'derive' | 'resource' | 'effect' | 'rule'

/** Fields shared by every catalog descriptor. Part-only fields are optional on the same shape. */
export type IDescriptor = {
  readonly kind: string
  readonly id: string
  readonly title?: string
  readonly description?: string
  readonly targets?: readonly string[]
  readonly args?: IJsonSchema
  readonly meta?: Readonly<Record<string, unknown>>
  readonly reads?: readonly string[]
  readonly writes?: readonly string[]
  readonly after?: readonly string[]
  readonly phase?: 'config' | 'runtime'
  readonly pure?: boolean
  readonly status?: 'active' | 'deprecated'
  readonly replacedBy?: string
  readonly editor?: Readonly<Record<string, unknown>>
  readonly tier?: 'page' | 'restricted' | 'isolated'
  readonly inputs?: readonly string[]
  readonly behavior?: IBehavior
  readonly events?: Readonly<Record<string, IEventDeclaration>>
  readonly slots?: Readonly<Record<string, ISlotDeclaration>>
  readonly styleHooks?: Readonly<Record<string, IStyleHookType>>
}

/** Validation schema of an extension kind: required field names beyond the common ones. */
export type IKindSchema = { readonly required?: readonly string[] }

/** Read-only catalog view the rule engine consults. */
export type ICatalogView = {
  get(id: string): IDescriptor | undefined
  majors(name: string): readonly number[]
  writesFor(tag: string): readonly string[]
}

/** One JSON Patch operation, used for issue fixes and blueprint patches. */
export type IJsonPatchOperation = {
  readonly op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test'
  readonly path: string
  readonly value?: unknown
  readonly from?: string
}

/** A problem found by a rule. `cause` holds a thrown error for `RULE_FAILED`. */
export type IIssue = {
  readonly address: IPartAddress
  readonly facet: string
  readonly path: string
  readonly code: string
  readonly rule: string
  readonly messageKey: string
  readonly severity: 'error' | 'warning'
  readonly basis?: string
  readonly fix?: readonly IJsonPatchOperation[]
  readonly cause?: unknown
}
