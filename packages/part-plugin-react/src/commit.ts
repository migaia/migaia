import {
  normalizeEventEntry,
  type IEventDeclaration,
  type IEventSubscription,
  type IFieldBehavior
} from '@migaia/part-contract'
import type { IResolvedNode } from '@migaia/part-host'
import type { IDomFeatures } from '@migaia/part-plugin-dom'
import { fieldPathOf, fieldValue } from './data-node.ts'

/** Host services a commit needs besides the DOM features. */
export type ICommitServices = {
  readonly dom: IDomFeatures
  readonly write: (path: string, value: unknown) => void
  /**
   * Whether the node renders a template-row instance. Its DOM events are delegated by the template
   * host and its style rules are owned by the host, so the instance installs neither.
   */
  readonly rowInstance?: boolean
}

/** Declaration of the event a possibly shorthand key (`click.once`) subscribes to. */
function declarationOf(
  declarations: Readonly<Record<string, IEventDeclaration>>,
  key: string,
  subscription: IEventSubscription
): IEventDeclaration | undefined {
  return declarations[normalizeEventEntry(key, subscription).name]
}

/** DOM listener object of a field's change event; writes the new value to the bound path. */
class FieldListener {
  /** Field protocol of the part. */
  readonly #field: IFieldBehavior
  /** Bound state path. */
  readonly #path: string
  /** State writer of the mount. */
  readonly #write: (path: string, value: unknown) => void

  /** Captures the field, its path and the state writer. */
  constructor(field: IFieldBehavior, path: string, write: (path: string, value: unknown) => void) {
    this.#field = field
    this.#path = path
    this.#write = write
  }

  /** Writes the value the event carries. */
  handleEvent(event: Event): void {
    this.#write(this.#path, fieldValue(this.#field, event))
  }
}

/**
 * Commit-phase work of one node: aria, styles, DOM event listeners, and for host-managed parts the
 * layer and focus transitions. `release` undoes everything and is safe to call twice.
 */
export class NodeCommit {
  /** Services of the mount. */
  readonly #services: ICommitServices
  /** Listener removals of the last apply. */
  #unsubscribers: (() => void)[] = []
  /** Address and open state at the last apply. */
  #applied: { readonly node: IResolvedNode; readonly open: boolean } | undefined
  /** Element and names of the root attributes written by the last apply, removed on release. */
  #attributes: { readonly element: HTMLElement; readonly names: readonly string[] } | undefined

  /** Binds the commit to mount services. */
  constructor(services: ICommitServices) {
    this.#services = services
  }

  /** Releases listeners, styles and any open layer; React effect cleanup and unmount both call it. */
  readonly release = (): void => this.#release()

  /**
   * Applies DOM work for the node's current element, open value and state-derived aria values.
   * Re-applies keep an open layer open; only `release` (on unmount) closes it.
   */
  apply(
    node: IResolvedNode,
    element: HTMLElement | null,
    open: boolean,
    ariaStates: Readonly<Record<string, unknown>> = {},
    attributes: Readonly<Record<string, string>> = {}
  ): void {
    /** Previous open value, carried across re-applies. */
    const wasOpen = this.#applied?.open === true && this.#applied.node.address === node.address
    this.#detach()
    this.#applied = { node, open }
    if (element === null) return
    /** DOM services. */
    const dom = this.#services.dom
    dom.aria.apply(element, node)
    dom.aria.applyStates(element, ariaStates)
    this.#writeAttributes(element, attributes)
    if (this.#services.rowInstance !== true) {
      this.#listenField(node, element)
      dom.stylesheet.apply(node.styleRules)
      /** Event declarations of the part. */
      const declarations = node.definition.descriptor.events ?? {}
      for (const [key, subscription] of Object.entries(node.config.events ?? {}))
        this.#unsubscribers.push(
          dom.events.subscribe(
            node.address,
            element,
            key,
            subscription,
            declarationOf(declarations, key, subscription)
          )
        )
    }
    if (node.template !== undefined) this.#delegate(node.template.node, element)
    if (node.behavior.managedBy !== 'component' && node.openStatePath !== undefined)
      this.#transition(node, element, wasOpen, open)
  }

  /**
   * Installs the template node's style rules and one delegated listener per template-node event on
   * the template host element, instead of one listener per row.
   */
  #delegate(template: IResolvedNode, element: HTMLElement): void {
    /** DOM services. */
    const dom = this.#services.dom
    dom.stylesheet.apply(template.styleRules)
    /** Event declarations of the template part. */
    const declarations = template.definition.descriptor.events ?? {}
    for (const [key, subscription] of Object.entries(template.config.events ?? {}))
      this.#unsubscribers.push(
        dom.events.delegate(
          template.address,
          element,
          key,
          subscription,
          declarationOf(declarations, key, subscription)
        )
      )
  }

  /** Runs focus and layer transitions for a host-managed open state. */
  #transition(node: IResolvedNode, element: HTMLElement, wasOpen: boolean, open: boolean): void {
    /** DOM services. */
    const dom = this.#services.dom
    if (open && !wasOpen) {
      dom.focus.open(node.address, element, node)
      dom.layer.open(node.address, element, node, (address) => this.#dismiss(address))
    } else if (!open && wasOpen) {
      dom.layer.close(node.address)
      dom.focus.close(node.address)
    }
  }

  /** Writes the dismissed part's open state back to false. */
  #dismiss(address: string): void {
    /** Node whose open state is written. */
    const node = this.#applied?.node
    if (node?.address === address && node.openStatePath !== undefined)
      this.#services.write(node.openStatePath, false)
  }

  /** Writes root attributes, removing the ones the previous apply wrote and this one does not. */
  #writeAttributes(element: HTMLElement, attributes: Readonly<Record<string, string>>): void {
    this.#clearAttributes(attributes)
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
    /** Names written now. */
    const names = Object.keys(attributes)
    this.#attributes = names.length === 0 ? undefined : { element, names }
  }

  /** Removes previously written attributes that are not in `keep`. */
  #clearAttributes(keep: Readonly<Record<string, string>>): void {
    /** Previous write. */
    const previous = this.#attributes
    if (previous === undefined) return
    for (const name of previous.names) if (!(name in keep)) previous.element.removeAttribute(name)
    this.#attributes = undefined
  }

  /**
   * Listens on the root element for a field's DOM change event and writes the new value to the
   * bound state path. Component change events are handled by the renderer's callback bridge.
   */
  #listenField(node: IResolvedNode, element: HTMLElement): void {
    /** Field protocol of the part. */
    const field = node.behavior.field
    /** Bound state path. */
    const path = fieldPathOf(node)
    if (field === undefined || path === undefined) return
    if (node.definition.descriptor.events?.[field.change]?.kind === 'component') return
    /** Listener object writing the value. */
    const listener = new FieldListener(field, path, this.#services.write)
    element.addEventListener(field.change, listener)
    this.#unsubscribers.push(() => element.removeEventListener(field.change, listener))
  }

  /** Removes listeners of the last apply without closing layers. */
  #detach(): void {
    for (const unsubscribe of this.#unsubscribers) unsubscribe()
    this.#unsubscribers = []
  }

  /** Full release: listeners, styles, open layer and focus. */
  #release(): void {
    this.#detach()
    this.#clearAttributes({})
    /** Last applied state. */
    const applied = this.#applied
    if (applied === undefined) return
    if (this.#services.rowInstance !== true)
      this.#services.dom.stylesheet.remove(applied.node.address)
    if (applied.node.template !== undefined)
      this.#services.dom.stylesheet.remove(applied.node.template.node.address)
    if (applied.open && applied.node.behavior.managedBy !== 'component') {
      this.#services.dom.layer.close(applied.node.address)
      this.#services.dom.focus.close(applied.node.address)
    }
    this.#applied = { node: applied.node, open: false }
  }
}
