/**
 * Page JSX to blueprint conversion. Extracted components become their part nodes, native elements
 * become `html-<tag>@1` nodes, state variables become `$state` bindings and event handlers become
 * effect drafts. Anything else is kept as a black-box part around the smallest enclosing element.
 */
import { basename, dirname, extname, join, resolve } from 'node:path'
import type { IEventSubscription, IPartNode } from '@migaia/part-contract'
import type { IExtractedComponent } from '../extract.ts'
import { DATA_TABLE_PART } from '../extract/data-table.ts'
import { camel, kebab } from '../import/names.ts'
import { isNode, LineIndex, literalValue, unwrap, type INode } from './ast.ts'
import { blackboxModule, planBlackbox, type IBlackboxPlan, type IReferences } from './blackbox.ts'
import type { IEffectDraft } from './emit.ts'
import { patternNames, type IImportBinding, type PageScope } from './scope.ts'
import { convertTable, TABLE_CELL_PART, TABLE_ROW_PART } from './table.ts'
import { UsageReason } from './text.ts'

/** One uncertain item of the usage report. */
export type IUsageItem = {
  readonly file: string
  readonly line: number
  readonly reason: string
  readonly detail?: string
}

/** A generated file: path relative to the output root and its body. */
export type IUsageFile = { readonly path: string; readonly body: string }

/** Result of converting one page. */
export type IPageResult = {
  readonly blueprintId: string
  readonly blueprint:
    | { readonly id: string; readonly version: number; readonly root: IPartNode }
    | undefined
  readonly seeds: ReadonlyMap<string, unknown>
  readonly drafts: readonly IEffectDraft[]
  readonly blackboxes: readonly IUsageFile[]
  readonly tags: ReadonlySet<string>
  readonly items: readonly IUsageItem[]
  readonly usageNodes: number
  readonly usageConverted: number
}

/** Node under construction; frozen into the blueprint once the page is done. */
type INodeDraft = {
  tag: string
  id: string
  facets?: { props?: Record<string, unknown>; events?: Record<string, IEventSubscription> }
  children?: INodeDraft[]
  template?: { readonly rowKey: string; readonly node: IPartNode }
}

/** Black box waiting for its number, assigned in tree order once the page is done. */
type IPendingBox = {
  readonly plan: Extract<IBlackboxPlan, { ok: true }>
  readonly node: INodeDraft
}

/** Converted content of an element: zero or more nodes and what they bring along. */
type IFragment = {
  readonly nodes: INodeDraft[]
  total: number
  converted: number
  readonly items: IUsageItem[]
  readonly drafts: IEffectDraft[]
  readonly tags: string[]
  readonly boxes: IPendingBox[]
}

/** Signal that the element cannot be converted and its parent must become a black box. */
const BOX = Symbol('box')

/** Outcome of converting an element. */
type IOutcome = IFragment | typeof BOX

/** The react-hook-form field being converted inside a `FormField` render function. */
type IFieldContext = { readonly form: string; readonly name: string; readonly param: string }

/** Path segment grammar of `flow.bind-path`. */
const SEGMENT = /^[A-Za-z0-9_-]+$/
/** Native element names accepted as `html-<tag>` parts. */
const NATIVE_TAG = /^[a-z][a-z0-9-]*$/
/** Event attribute grammar. */
const EVENT_ATTRIBUTE = /^on[A-Z]/
/** Names of the form-file components the conversion treats structurally. */
const FORM_ROOT = 'Form'
/** Field wrapper of react-hook-form forms. */
const FORM_FIELD = 'FormField'
/** Message component of a form item. */
const FORM_MESSAGE = 'FormMessage'

/** Empty fragment. */
function emptyFragment(): IFragment {
  return { nodes: [], total: 0, converted: 0, items: [], drafts: [], tags: [], boxes: [] }
}

/** Appends a fragment's content to another. */
function merge(target: IFragment, source: IFragment): void {
  target.nodes.push(...source.nodes)
  target.total += source.total
  target.converted += source.converted
  target.items.push(...source.items)
  target.drafts.push(...source.drafts)
  target.tags.push(...source.tags)
  target.boxes.push(...source.boxes)
}

/**
 * Number of JSX elements in a subtree; recursion depth is the subtree depth. Counts are kept in
 * `memo`, so a black box that grows to its parent does not count the child's subtree again.
 */
function countElements(node: INode, memo: WeakMap<INode, number>): number {
  /** Count of an earlier call. */
  const known = memo.get(node)
  if (known !== undefined) return known
  /** Elements below and including the node. */
  let count = node.type === 'JSXElement' ? 1 : 0
  for (const value of Object.values(node))
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) count += countElements(item, memo)
    } else if (isNode(value)) count += countElements(value, memo)
  memo.set(node, count)
  return count
}

/**
 * Appends the children of an element or fragment to `out`, with nested fragments flattened in
 * source order; recursion depth is the fragment nesting depth.
 */
function appendContent(children: readonly INode[], out: INode[]): void {
  for (const child of children)
    if (child.type === 'JSXFragment') appendContent(child.children as INode[], out)
    else out.push(child)
}

/** Children of an element with nested fragments flattened. */
function contentOf(element: INode): INode[] {
  /** Flattened children. */
  const out: INode[] = []
  appendContent(element.children as INode[], out)
  return out
}

/** True for text content that is only whitespace, such as `{' '}` between elements. */
function isBlank(text: unknown): boolean {
  return typeof text === 'string' && text.trim() === ''
}

/**
 * Text of JSX text after JSX whitespace rules: lines trimmed, blank lines dropped, joined by
 * spaces.
 */
function jsxText(raw: string): string {
  /** Non-empty trimmed lines. */
  const lines: string[] = []
  for (const line of raw.split('\n')) {
    /** Trimmed line. */
    const trimmed = line.trim()
    if (trimmed !== '') lines.push(trimmed)
  }
  return lines.join(' ')
}

/** File path without its extension, for matching imports to extracted files. */
function stem(file: string): string {
  return file.slice(0, file.length - extname(file).length)
}

/** Extracted components indexed by file and export name. */
export class PartIndex {
  /** Entries by file stem, then component name. */
  readonly #byFile = new Map<string, Map<string, IExtractedComponent>>()
  /** Part ids present in the report. */
  readonly #ids = new Set<string>()

  /** Indexes a component report. */
  constructor(components: readonly IExtractedComponent[]) {
    for (const entry of components) {
      /** Key of the entry's file. */
      const key = stem(resolve(entry.file))
      /** Components of that file. */
      const byName = this.#byFile.get(key) ?? new Map<string, IExtractedComponent>()
      byName.set(entry.component, entry)
      this.#byFile.set(key, byName)
      if (entry.partId !== '') this.#ids.add(entry.partId)
    }
  }

  /** Whether a part id was extracted. */
  has(partId: string): boolean {
    return this.#ids.has(partId)
  }

  /**
   * Extracted component an import names. Relative specifiers resolve from the page; others (such as
   * `@/components/ui/button`) match an extracted file whose path ends with the specifier.
   */
  lookup(pageFile: string, binding: IImportBinding): IExtractedComponent | undefined {
    if (binding.source.startsWith('.'))
      return (
        this.#byFile.get(stem(resolve(dirname(pageFile), binding.source)))?.get(binding.imported) ??
        this.#byFile.get(resolve(dirname(pageFile), binding.source))?.get(binding.imported)
      )
    /** Specifier without a leading alias. */
    const tail = `/${binding.source.replace(/^[@~]\//, '')}`
    for (const [file, byName] of this.#byFile)
      if (file.endsWith(tail)) return byName.get(binding.imported)
    return undefined
  }
}

/** Converts one page module; one instance per page. */
export class PageConverter {
  /** Absolute page file. */
  readonly #file: string
  /** Page source text. */
  readonly #source: string
  /** Facts of the page module. */
  readonly #scope: PageScope
  /** Extracted components. */
  readonly #parts: PartIndex
  /** Blueprint id: the file name in kebab-case. */
  readonly #id: string
  /** Absolute output root, for the black-box import rewriting. */
  readonly #out: string
  /** Line lookup for report items. */
  readonly #lines: LineIndex
  /** References collected by black-box attempts, reused when a black box grows to its parent. */
  readonly #references = new WeakMap<INode, IReferences>()
  /** Element counts of subtrees, shared by every black box of the page. */
  readonly #counts = new WeakMap<INode, number>()
  /** Handler sources by effect name, so equal handlers share one draft and others get suffixes. */
  readonly #handlers = new Map<string, string>()

  /** Prepares the conversion of one parsed page. */
  constructor(file: string, source: string, scope: PageScope, parts: PartIndex, out: string) {
    this.#file = file
    this.#source = source
    this.#scope = scope
    this.#parts = parts
    this.#id = kebab(basename(file, extname(file)))
    this.#out = out
    this.#lines = new LineIndex(source)
  }

  /** Converts the page's component and numbers its black boxes. */
  convert(): IPageResult {
    /** Root JSX of the component. */
    const root = this.#scope.root
    if (root === undefined) return this.#failed(UsageReason.noComponent, undefined)
    /** Root outcome; a root that is not one node becomes a black box. */
    let outcome = root.type === 'JSXElement' ? this.#element(root, undefined, new Map()) : BOX
    if (outcome !== BOX && outcome.nodes.length !== 1) outcome = BOX
    if (outcome === BOX) outcome = this.#blackbox(root, new Map())
    if (outcome === BOX) return this.#failed(UsageReason.pageUnconvertible, root)
    return this.#result(outcome)
  }

  /** Result of a page that produced no blueprint. */
  #failed(reason: string, node: INode | undefined): IPageResult {
    return {
      blueprintId: this.#id,
      blueprint: undefined,
      seeds: new Map(),
      drafts: [],
      blackboxes: [],
      tags: new Set(),
      items: [this.#item(reason, node)],
      usageNodes: node === undefined ? 0 : countElements(node, this.#counts),
      usageConverted: 0
    }
  }

  /** Builds the page result from the root fragment. */
  #result(fragment: IFragment): IPageResult {
    /** Black-box files. */
    const blackboxes: IUsageFile[] = []
    /** File name of the page without extension. */
    const name = basename(this.#file, extname(this.#file))
    fragment.boxes.forEach((box, index) => {
      /** Part id of the black box. */
      const partId = `${this.#id}-blackbox-${index + 1}@1`
      box.node.tag = partId
      blackboxes.push({
        path: `blackbox/${name}-${index + 1}.tsx`,
        body: blackboxModule(box.plan, `Blackbox${index + 1}`, partId)
      })
    })
    return {
      blueprintId: this.#id,
      blueprint: { id: this.#id, version: 1, root: fragment.nodes[0] as IPartNode },
      seeds: this.#seeds(),
      drafts: distinctDrafts(fragment.drafts),
      blackboxes,
      tags: new Set(fragment.tags),
      items: fragment.items,
      usageNodes: fragment.total,
      usageConverted: fragment.converted
    }
  }

  /** Literal initial values of the state variables, by state path. */
  #seeds(): Map<string, unknown> {
    /** Seeds by path. */
    const seeds = new Map<string, unknown>()
    for (const [name, state] of this.#scope.states)
      if (state.initial.ok && state.initial.value !== undefined && SEGMENT.test(name))
        seeds.set(`page.${name}`, state.initial.value)
    return seeds
  }

  /** Report item at a node. */
  #item(reason: string, node: INode | undefined, detail?: string): IUsageItem {
    return {
      file: this.#file,
      line: node === undefined ? 1 : this.#lines.lineOf(node.start),
      reason,
      ...(detail === undefined ? {} : { detail })
    }
  }

  /** Next sibling id for a base name: `<base>-<n>`, counted per parent. */
  #nextId(ids: Map<string, number>, base: string): string {
    /** Siblings with this base so far. */
    const count = ids.get(base) ?? 0
    ids.set(base, count + 1)
    return `${base}-${count}`
  }

  /** Converts one JSX element; `ids` counts sibling ids of the parent. */
  #element(element: INode, field: IFieldContext | undefined, ids: Map<string, number>): IOutcome {
    /** Element name node. */
    const name = (element.openingElement as INode).name as INode
    if (name.type !== 'JSXIdentifier') return this.#blackbox(element, ids)
    /** Element name text. */
    const tag = String(name.name)
    if (NATIVE_TAG.test(tag)) return this.#native(element, tag, field, ids)
    /** Import of the component. */
    const binding = this.#scope.imports.get(tag)
    /** Extracted component of the import. */
    const entry = binding === undefined ? undefined : this.#parts.lookup(this.#file, binding)
    if (entry === undefined) return this.#blackbox(element, ids)
    if (entry.substitute === 'form' && entry.component === FORM_ROOT)
      return this.#text(element) === undefined ? this.#children(element, field, ids) : BOX
    if (entry.substitute === 'form' && entry.component === FORM_FIELD)
      return this.#formField(element, ids)
    if (entry.substitute === 'data-table') return this.#table(element, ids)
    if (entry.partId === '') return this.#blackbox(element, ids)
    return this.#component(element, entry, field, ids)
  }

  /** Native element: an `html-<tag>@1` node whose attributes are passed as props. */
  #native(
    element: INode,
    tag: string,
    field: IFieldContext | undefined,
    ids: Map<string, number>
  ): IOutcome {
    /** Node of the element. */
    const node: INodeDraft = { tag: `html-${tag}@1`, id: this.#nextId(ids, tag) }
    /** Fragment of the element. */
    const fragment = emptyFragment()
    fragment.tags.push(tag)
    if (!this.#attributes(element, node, undefined, field, fragment))
      return this.#blackbox(element, ids)
    return this.#finish(element, node, field, fragment, ids)
  }

  /** Extracted component: its part node with props mapped back through the binding mapping. */
  #component(
    element: INode,
    entry: IExtractedComponent,
    field: IFieldContext | undefined,
    ids: Map<string, number>
  ): IOutcome {
    /** Node of the element. */
    const node: INodeDraft = { tag: entry.partId, id: this.#nextId(ids, kebab(entry.component)) }
    /** Fragment of the element. */
    const fragment = emptyFragment()
    if (!this.#attributes(element, node, entry, field, fragment))
      return this.#blackbox(element, ids)
    if (field !== undefined && entry.substitute === 'form' && entry.component === FORM_MESSAGE)
      this.#props(node).message = { $state: `page.${field.form}-errors.${field.name}` }
    return this.#finish(element, node, field, fragment, ids)
  }

  /** Adds the element's children to its node and counts the element. */
  #finish(
    element: INode,
    node: INodeDraft,
    field: IFieldContext | undefined,
    fragment: IFragment,
    ids: Map<string, number>
  ): IOutcome {
    /** Items reported for the element itself. */
    const own = fragment.items.length
    /** Children of the element. */
    const children = this.#children(element, field, new Map())
    if (children === BOX) return this.#blackbox(element, ids)
    /** Text or binding content; blank spacing between child elements is dropped. */
    const raw = this.#text(element)
    /** Content kept for the node. */
    const text = isBlank(raw) && children.nodes.length > 0 ? undefined : raw
    if (text === BOX) return this.#blackbox(element, ids)
    if (text !== undefined && children.nodes.length > 0) return this.#blackbox(element, ids)
    if (text !== undefined) this.#props(node).children = text
    if (children.nodes.length > 0) node.children = children.nodes
    fragment.total += 1
    if (own === 0) fragment.converted += 1
    /** Child content without its nodes, which now hang below this node. */
    const rest: IFragment = { ...children, nodes: [] }
    merge(fragment, rest)
    fragment.nodes.push(node)
    return fragment
  }

  /** Props record of a node, created on first use. */
  #props(node: INodeDraft): Record<string, unknown> {
    node.facets ??= {}
    node.facets.props ??= {}
    return node.facets.props
  }

  /**
   * Text content of an element whose children are text, literals or one state binding; undefined
   * without text; BOX when text is mixed with other expressions.
   */
  #text(element: INode): unknown {
    /** Text pieces. */
    const pieces: string[] = []
    /** Binding child, when there is one. */
    let binding: unknown
    for (const child of contentOf(element)) {
      if (child.type === 'JSXText') {
        /** Normalised text. */
        const text = jsxText(String(child.value))
        if (text !== '') pieces.push(text)
        continue
      }
      if (child.type !== 'JSXExpressionContainer') continue
      /** Contained expression. */
      const expression = child.expression as INode
      if (expression.type === 'JSXEmptyExpression') continue
      /** Literal value, when the expression is one. */
      const literal = literalValue(expression)
      if (literal.ok && (typeof literal.value === 'string' || typeof literal.value === 'number')) {
        pieces.push(String(literal.value))
        continue
      }
      /** State binding of the expression. */
      const state = this.#stateBinding(expression)
      if (state === undefined || binding !== undefined) return BOX
      binding = state
    }
    if (binding !== undefined) return pieces.length === 0 ? binding : BOX
    return pieces.length === 0 ? undefined : pieces.join(' ')
  }

  /** Converts the element children; expression children are handled by `#text`. */
  #children(element: INode, field: IFieldContext | undefined, ids: Map<string, number>): IOutcome {
    /** Fragment of the children. */
    const fragment = emptyFragment()
    for (const child of contentOf(element)) {
      if (child.type !== 'JSXElement') continue
      /** Outcome of the child. */
      const outcome = this.#element(child, field, ids)
      if (outcome === BOX) return BOX
      merge(fragment, outcome)
    }
    return fragment
  }

  /**
   * Writes the attributes of an element into its node. Returns false when an attribute cannot be
   * converted (a spread, or an expression that is neither literal, state nor handler).
   */
  #attributes(
    element: INode,
    node: INodeDraft,
    entry: IExtractedComponent | undefined,
    field: IFieldContext | undefined,
    fragment: IFragment
  ): boolean {
    /** Component prop → blueprint prop. */
    const inverse = new Map<string, string>()
    for (const [prop, target] of Object.entries(entry?.mapping.props ?? {}))
      inverse.set(target, prop)
    /** Attribute expressions by name, for the field write-back check. */
    const values = new Map<string, INode | undefined>()
    for (const attribute of (element.openingElement as INode).attributes as INode[]) {
      if (attribute.type === 'JSXSpreadAttribute') {
        /** Spread argument. */
        const argument = unwrap(attribute.argument)
        if (field === undefined || argument?.type !== 'Identifier' || argument.name !== field.param)
          return false
        this.#props(node)[entry?.field?.value ?? 'value'] = {
          $state: `page.${field.form}.${field.name}`
        }
        continue
      }
      if ((attribute.name as INode).type !== 'JSXIdentifier') return false
      values.set(String((attribute.name as INode).name), attributeExpression(attribute))
    }
    for (const [name, expression] of values) {
      if (name === 'key') continue
      if (EVENT_ATTRIBUTE.test(name)) {
        if (!this.#event(name, expression, node, entry, values, fragment)) return false
        continue
      }
      if (name === 'className' && entry !== undefined) {
        fragment.items.push(this.#item(UsageReason.classDropped, element))
        continue
      }
      /** Value of the attribute. */
      const value = this.#value(expression)
      if (value === BOX) return false
      this.#props(node)[inverse.get(name) ?? name] = value
    }
    return true
  }

  /** Literal or state binding of an attribute expression; BOX for anything else. */
  #value(expression: INode | undefined): unknown {
    if (expression === undefined) return true
    /** Literal value. */
    const literal = literalValue(expression)
    if (literal.ok) return literal.value
    return this.#stateBinding(expression) ?? BOX
  }

  /** `{ $state }` binding of a state variable or a member path of one, or undefined. */
  #stateBinding(expression: INode): { readonly $state: string } | undefined {
    /** Member names from the outside in. */
    const members: string[] = []
    /** Current expression. */
    let current = unwrap(expression)
    while (current?.type === 'MemberExpression' && current.computed !== true) {
      members.unshift(String((current.property as INode).name))
      current = unwrap(current.object)
    }
    if (current?.type !== 'Identifier' || !this.#scope.states.has(String(current.name)))
      return undefined
    /** Path segments. */
    const segments = [String(current.name), ...members]
    return segments.every((segment) => SEGMENT.test(segment))
      ? { $state: `page.${segments.join('.')}` }
      : undefined
  }

  /**
   * Converts an event attribute: dropped when the field protocol already writes the value back,
   * otherwise a subscription to an effect draft. Returns false for an unusable handler.
   */
  #event(
    name: string,
    expression: INode | undefined,
    node: INodeDraft,
    entry: IExtractedComponent | undefined,
    values: ReadonlyMap<string, INode | undefined>,
    fragment: IFragment
  ): boolean {
    if (expression === undefined) return false
    if (this.#writesBack(name, expression, entry, values)) return true
    /** Declared event of the component for this callback, or the DOM event name. */
    const event =
      Object.entries(entry?.events ?? {}).find(([, callback]) => callback === name)?.[0] ??
      `${name.charAt(2).toLowerCase()}${name.slice(3)}`
    /** Submit handler of `form.handleSubmit(fn)`. */
    const submitted = this.#submitHandler(expression)
    /** Handler expression. */
    const handler = submitted ?? expression
    /** Draft of the handler. */
    const draft = this.#draft(handler, name)
    node.facets ??= {}
    node.facets.events ??= {}
    node.facets.events[submitted === undefined ? event : `${event}.prevent`] = { handler: draft.id }
    fragment.drafts.push(draft)
    fragment.items.push(this.#item(UsageReason.effectDraft, expression, draft.id))
    return true
  }

  /**
   * True when a field part's change callback is exactly the setter of the state its value prop is
   * bound to (`onValueChange={setX}` or `(v) => setX(v)`): the renderer writes the value back.
   */
  #writesBack(
    name: string,
    expression: INode,
    entry: IExtractedComponent | undefined,
    values: ReadonlyMap<string, INode | undefined>
  ): boolean {
    /** Field protocol of the part. */
    const field = entry?.field
    if (field === undefined || entry?.events[field.change] !== name) return false
    /** Value expression of the field. */
    const value = values.get(entry.mapping.props?.[field.value] ?? field.value)
    /** State variable bound to the value. */
    const state = value === undefined ? undefined : unwrap(value)
    if (state?.type !== 'Identifier') return false
    /** Setter of that state. */
    const setter = this.#scope.states.get(String(state.name))?.setter
    return setter !== undefined && setterCall(unwrap(expression), setter)
  }

  /** Function passed to `<form>.handleSubmit(fn)`, or undefined. */
  #submitHandler(expression: INode): INode | undefined {
    /** Call expression. */
    const call = unwrap(expression)
    /** Called member. */
    const callee = call?.type === 'CallExpression' ? unwrap(call.callee) : undefined
    if (callee?.type !== 'MemberExpression' || callee.computed === true) return undefined
    /** Object of the member. */
    const object = unwrap(callee.object)
    if (object?.type !== 'Identifier' || !this.#scope.forms.has(String(object.name)))
      return undefined
    if ((callee.property as INode).name !== 'handleSubmit') return undefined
    return unwrap(
      (call as INode).arguments instanceof Array
        ? ((call as INode).arguments as unknown[])[0]
        : undefined
    )
  }

  /** Effect draft of a handler: named after the referenced function or the attribute. */
  #draft(handler: INode | undefined, attribute: string): IEffectDraft {
    /** Referenced function name. */
    const reference = handler?.type === 'Identifier' ? String(handler.name) : undefined
    /** Source of the handler. */
    const source =
      reference === undefined
        ? handler === undefined
          ? ''
          : this.#source.slice(handler.start, handler.end)
        : (this.#scope.locals.get(reference) ??
          this.#scope.moduleBindings.get(reference) ??
          reference)
    /** Effect name. */
    const name = this.#handlerName(camel(reference ?? attribute), source)
    return { id: `${this.#id}.${name}@1`, name, source }
  }

  /** Unique effect name: the same source keeps its name, another source gets a numeric suffix. */
  #handlerName(base: string, source: string): string {
    /** Candidate name. */
    let candidate = base
    /** Next suffix. */
    let suffix = 2
    while (this.#handlers.has(candidate) && this.#handlers.get(candidate) !== source) {
      candidate = `${base}${suffix}`
      suffix += 1
    }
    this.#handlers.set(candidate, source)
    return candidate
  }

  /** `FormField`: its render function's JSX converted with the field bound to the form state. */
  #formField(element: INode, ids: Map<string, number>): IOutcome {
    /** Attribute expressions by name. */
    const values = new Map<string, INode | undefined>()
    for (const attribute of (element.openingElement as INode).attributes as INode[])
      if (attribute.type === 'JSXAttribute')
        values.set(String((attribute.name as INode).name), attributeExpression(attribute))
    /** Field name. */
    const name = literalValue(values.get('name')).value
    /** Form variable from `control={form.control}`. */
    const control = unwrap(values.get('control'))
    /** Form object of the control. */
    const form = control?.type === 'MemberExpression' ? unwrap(control.object) : undefined
    /** Render function and its JSX. */
    const render = renderOf(values.get('render'))
    if (
      typeof name !== 'string' ||
      !SEGMENT.test(name) ||
      form?.type !== 'Identifier' ||
      render === undefined
    )
      return this.#blackbox(element, ids)
    return this.#element(render.jsx, { form: String(form.name), name, param: render.param }, ids)
  }

  /** DataTable: the `data-table@1` node with columns and row template from the page. */
  #table(element: INode, ids: Map<string, number>): IOutcome {
    /** Attribute expressions by name. */
    const values = new Map<string, INode | undefined>()
    for (const attribute of (element.openingElement as INode).attributes as INode[])
      if (attribute.type === 'JSXAttribute')
        values.set(String((attribute.name as INode).name), attributeExpression(attribute))
    /** Table conversion. */
    const table = convertTable(values, this.#scope)
    /** Fragment of the table. */
    const fragment = emptyFragment()
    for (const reason of table.reasons) fragment.items.push(this.#item(reason, element))
    for (const part of [TABLE_ROW_PART, TABLE_CELL_PART])
      if (!this.#parts.has(part))
        fragment.items.push(this.#item(UsageReason.partMissing, element, part))
    fragment.nodes.push({
      tag: DATA_TABLE_PART,
      id: this.#nextId(ids, 'data-table'),
      facets: { props: { columns: table.columns } },
      template: table.template
    })
    fragment.total += 1
    if (fragment.items.length === 0) fragment.converted += 1
    return fragment
  }

  /**
   * Keeps an element as a black-box part; BOX when it references bindings that cannot leave the
   * page.
   */
  #blackbox(element: INode, ids: Map<string, number>): IOutcome {
    /** Plan of the black box. */
    const plan = planBlackbox(
      element,
      this.#source,
      this.#scope,
      this.#file,
      join(this.#out, 'blackbox', 'page.tsx'),
      this.#references
    )
    if (!plan.ok) return BOX
    /** Node whose tag is set when the black boxes are numbered. */
    const node: INodeDraft = { tag: '', id: this.#nextId(ids, 'blackbox') }
    for (const state of plan.states) this.#props(node)[state] = { $state: `page.${state}` }
    /** Fragment of the black box. */
    const fragment = emptyFragment()
    fragment.nodes.push(node)
    fragment.total = countElements(element, this.#counts)
    fragment.items.push(this.#item(UsageReason.blackbox, element))
    fragment.boxes.push({ plan, node })
    return fragment
  }
}

/**
 * Expression of a JSX attribute: undefined for a bare attribute, the literal or the contained
 * expression.
 */
function attributeExpression(attribute: INode): INode | undefined {
  /** Attribute value. */
  const value = attribute.value as INode | null
  if (value === null || value === undefined) return undefined
  return value.type === 'JSXExpressionContainer' ? (value.expression as INode) : value
}

/** True for `setX` or `(v) => setX(v)`. */
function setterCall(expression: INode | undefined, setter: string): boolean {
  if (expression?.type === 'Identifier') return expression.name === setter
  if (expression?.type !== 'ArrowFunctionExpression') return false
  /** Single parameter. */
  const [param] = expression.params as INode[]
  /** Arrow body. */
  const body = unwrap(expression.body)
  if (param?.type !== 'Identifier' || body?.type !== 'CallExpression') return false
  /** Call arguments. */
  const args = body.arguments as INode[]
  return (
    unwrap(body.callee)?.name === setter &&
    args.length === 1 &&
    unwrap(args[0])?.type === 'Identifier' &&
    unwrap(args[0])?.name === param.name
  )
}

/** `({ field }) => <JSX/>` of a FormField: the local name of `field` and the returned element. */
function renderOf(
  expression: INode | undefined
): { readonly param: string; readonly jsx: INode } | undefined {
  /** Render function. */
  const render = unwrap(expression)
  if (render?.type !== 'ArrowFunctionExpression') return undefined
  /** Destructured parameter. */
  const param = (render.params as INode[])[0]
  /** `field` binding of the parameter. */
  const property =
    param?.type === 'ObjectPattern'
      ? (param.properties as INode[]).find(
          (item) => item.type === 'Property' && (item.key as INode).name === 'field'
        )
      : undefined
  /** Local name of `field`. */
  const local = property === undefined ? undefined : patternNames(property.value as INode)[0]
  /** Returned JSX of an expression body, or of a block body with a single return. */
  const body = unwrap(render.body)
  /** Single return statement of a block body. */
  const returned =
    body?.type === 'BlockStatement'
      ? (body.body as INode[]).find((statement) => statement.type === 'ReturnStatement')
      : undefined
  /** JSX of the render function. */
  const jsx = unwrap(returned === undefined ? body : returned.argument)
  return local === undefined || jsx?.type !== 'JSXElement' ? undefined : { param: local, jsx }
}

/** Drafts with duplicate ids removed, first kept. */
function distinctDrafts(drafts: readonly IEffectDraft[]): IEffectDraft[] {
  /** Ids already kept. */
  const seen = new Set<string>()
  /** Kept drafts. */
  const kept: IEffectDraft[] = []
  for (const draft of drafts) {
    if (seen.has(draft.id)) continue
    seen.add(draft.id)
    kept.push(draft)
  }
  return kept
}
