import {
  normalizeEventEntry,
  type IEventDeclaration,
  type IEventSubscription
} from '@migaia/part-contract'
import type { IResolvedNode } from '@migaia/part-host'
import type { IDomFeatures } from '@migaia/part-plugin-dom'

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
    ariaStates: Readonly<Record<string, unknown>> = {}
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
    if (this.#services.rowInstance !== true) {
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

  /** Removes listeners of the last apply without closing layers. */
  #detach(): void {
    for (const unsubscribe of this.#unsubscribers) unsubscribe()
    this.#unsubscribers = []
  }

  /** Full release: listeners, styles, open layer and focus. */
  #release(): void {
    this.#detach()
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
