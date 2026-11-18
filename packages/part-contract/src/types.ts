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
  /**
   * Expansion marker set by `expandFragments` on the root that replaced a fragment usage; holds the
   * fragment id. Authors never write it. The address index uses it to address inserted slot nodes.
   */
  readonly $fragment?: string
  /**
   * Expansion marker set by `expandFragments` on each node inserted for a `{ $slot }` placeholder;
   * holds the slot name. Such a node keeps its authored address `<usage>/slot.<name>/<segment>`.
   */
  readonly $slotOf?: string
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

/** Landmark a layout region renders as; `LandmarkElement` maps each to its HTML element. */
export type ILandmark =
  | 'banner'
  | 'navigation'
  | 'main'
  | 'complementary'
  | 'contentinfo'
  | 'region'

/**
 * One region of a layout, which is also a slot of the layout part. `size.default` is a pixel
 * number, `auto` or `<n>fr`; `min` and `max` are pixels. A resizable region needs a pixel default
 * inside `[min, max]`. `collapseBelow` is the layout container width in pixels under which the
 * region collapses into a drawer; it needs a `label` and is not allowed on `main`. `scroll`
 * defaults to true.
 */
export type ILayoutRegion = {
  readonly name: string
  readonly landmark: ILandmark
  readonly label?: string
  readonly size?: {
    readonly default: string | number
    readonly min?: number
    readonly max?: number
  }
  readonly resizable?: boolean
  readonly collapseBelow?: number
  readonly scroll?: boolean
}

/**
 * Layout behaviour group: regions in display order along `direction`. Exactly one region is `main`.
 * `skipLink` (default true) asks the outermost layout to render a skip-to-main link.
 */
export type ILayoutBehavior = {
  readonly direction: 'row' | 'column'
  readonly regions: readonly ILayoutRegion[]
  readonly skipLink?: boolean
}

/**
 * Behaviour groups of a part definition: semantics, aria, focus, keyboard, states, dismissal,
 * layer, layout.
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
  readonly layout?: ILayoutBehavior
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

/**
 * Subscription to an event in a blueprint; `handler` is an effect id. The events record key may be
 * shorthand: `click.once.capture.outside` is event `click` with native options `once` and `capture`
 * and modifier `outside@1`. `native` listens for the DOM event of that name on the part's root
 * element instead of the component callback.
 */
export type IEventSubscription = {
  readonly handler: string
  readonly filter?: Readonly<Record<string, unknown>>
  readonly modifiers?: readonly IModifierRef[]
  readonly capture?: boolean
  readonly once?: boolean
  readonly passive?: boolean
  readonly native?: boolean
  readonly sync?: boolean
}

/** Reference to a modifier: its `name@major` id, or the id with arguments. */
export type IModifierRef = string | { readonly id: string; readonly args?: unknown }

/** A placeholder inside a fragment subtree replaced by the usage's parameter of that name. */
export type IParamPlaceholder = { readonly $param: string }

/** Reusable subtree carried by a `fragment` descriptor; `slots` names its `{ $slot }` placeholders. */
export type IFragmentBody = { readonly node: IPartNode; readonly slots?: readonly string[] }

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
export type IBuiltinKind =
  | 'part'
  | 'enhancer'
  | 'derive'
  | 'resource'
  | 'effect'
  | 'rule'
  | 'modifier'
  | 'fragment'

/** Event kinds a modifier may apply to; component callbacks never reach the DOM. */
export type IModifierEventKind = 'dom' | 'custom'

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
  /** Modifier only: event kinds the modifier applies to. */
  readonly eventKinds?: readonly IModifierEventKind[]
  /** Modifier only: whether the modifier moves the listener (for example to the document). */
  readonly placement?: boolean
  /** Fragment only: the reusable subtree. */
  readonly fragment?: IFragmentBody
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
