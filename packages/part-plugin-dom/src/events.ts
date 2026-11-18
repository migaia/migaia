import {
  formatAddress,
  parseAddress,
  type IEventDeclaration,
  type IEventSubscription
} from '@migaia/part-contract'
import { ADDRESS_ATTRIBUTE } from './layer-constants.ts'
import { PartDomErrorCode } from './error-code.ts'
import { PartDomErrorText } from './error-text.ts'
import { createPartDomError } from './errors.ts'

/** Custom event name grammar: plugin name, colon, event name. */
const NAMESPACED_EVENT = /^[a-z0-9][a-z0-9-]*:[A-Za-z0-9-]+$/
/** Error code that marks a failure the host already reported. */
const ALREADY_REPORTED = 'EFFECT_FAILED'

/** Selector of elements that carry a part address. */
const ADDRESSED = `[${ADDRESS_ATTRIBUTE}]`

/** Element and address of the template-row instance an event came from. */
type IRowInstance = { readonly element: Element; readonly address: string }

/**
 * Finds the template-row instance of `templateAddress` that contains the event target, walking up
 * addressed ancestors inside the delegating host. The walk is bounded by the DOM depth.
 */
function rowInstanceOf(
  event: Event,
  templateAddress: string,
  host: Element
): IRowInstance | undefined {
  /** Nearest addressed element at or above the target. */
  let current = event.target instanceof Element ? event.target.closest(ADDRESSED) : null
  while (current !== null && current !== host && host.contains(current)) {
    /** Address carried by the element. */
    const address = current.getAttribute(ADDRESS_ATTRIBUTE) as string
    /** Static part and row key of the address. */
    const { segments, rowKey } = parseAddress(address)
    if (rowKey !== undefined && formatAddress({ segments }) === templateAddress)
      return { element: current, address }
    current = current.parentElement?.closest(ADDRESSED) ?? null
  }
  return undefined
}

/**
 * Native listener options of a subscription; `forceCapture` is set for document-level `outside`
 * listeners.
 */
function listenerOptions(
  subscription: IEventSubscription,
  forceCapture: boolean
): AddEventListenerOptions {
  return {
    capture: forceCapture || subscription.capture === true,
    once: subscription.once === true,
    passive: subscription.passive === true
  }
}

/** Host services the event adapter forwards to. */
export type IEventServices = {
  readonly dispatch: (address: string, event: string, detail: unknown) => Promise<void>
  readonly report: (error: unknown) => void
}

/** One DOM listener; an object listener avoids nested closures. */
class EventSubscription {
  /** Address of the subscribed part. */
  readonly #address: string
  /** Event name. */
  readonly #name: string
  /** Subscription options and modifiers. */
  readonly #subscription: IEventSubscription
  /** Host services. */
  readonly #services: IEventServices
  /**
   * Part element for an `outside` subscription: the listener sits on the document and fires only
   * for events whose path does not contain this element. `undefined` for ordinary subscriptions.
   */
  readonly #outsideOf: Element | undefined
  /**
   * Whether the listener delegates for template rows: it sits on the template host, `#address` is
   * the static template-node address, and each event is routed to the row instance it came from.
   */
  readonly #delegated: boolean

  /** Captures the subscription. */
  constructor(
    address: string,
    name: string,
    subscription: IEventSubscription,
    services: IEventServices,
    target: { readonly outsideOf?: Element; readonly delegated?: boolean }
  ) {
    this.#address = address
    this.#name = name
    this.#subscription = subscription
    this.#services = services
    this.#outsideOf = target.outsideOf
    this.#delegated = target.delegated === true
  }

  /** Applies modifiers synchronously, then hands the event to the host. */
  handleEvent(event: Event): void {
    /** Row instance for a delegated listener; `undefined` when the event is not from a row. */
    const instance = this.#delegated
      ? rowInstanceOf(event, this.#address, event.currentTarget as Element)
      : undefined
    if (this.#delegated && instance === undefined) return
    /** Element the `self` modifier compares against. */
    const own = instance?.element ?? event.currentTarget
    /** Modifiers of the subscription. */
    const modifiers = this.#subscription.modifiers ?? []
    if (this.#outsideOf !== undefined && event.composedPath().includes(this.#outsideOf)) return
    if (modifiers.includes('self') && event.target !== own) return
    if (modifiers.includes('stop')) event.stopPropagation()
    if (modifiers.includes('prevent')) event.preventDefault()
    this.#services
      .dispatch(
        instance?.address ?? this.#address,
        this.#name,
        event instanceof CustomEvent ? event.detail : undefined
      )
      .catch((error: unknown) => this.#rejected(error))
  }

  /** Reports a dispatch failure unless the host already reported it. */
  #rejected(error: unknown): void {
    if ((error as { code?: unknown } | undefined)?.code !== ALREADY_REPORTED)
      this.#services.report(error)
  }
}

/**
 * Adapts `dom` and `custom` events to host dispatch; `component` events belong to the framework
 * layer.
 */
export class EventAdapter {
  /** Host services. */
  readonly #services: IEventServices

  /** Binds the adapter to host services. */
  constructor(services: IEventServices) {
    this.#services = services
  }

  /**
   * Subscribes one event and returns its removal. With the `outside` modifier the listener is
   * installed on the owner document in the capture phase and fires only for events outside the
   * target element, so a part inside a stopped subtree still sees outside clicks.
   */
  subscribe(
    address: string,
    target: EventTarget,
    name: string,
    subscription: IEventSubscription,
    declaration?: IEventDeclaration
  ): () => void {
    if (declaration?.kind === 'component') return () => undefined
    /** Whether the subscription listens outside its element. */
    const outside = subscription.modifiers?.includes('outside') === true && target instanceof Node
    /** Element the `outside` check excludes. */
    const outsideOf = outside ? (target as Element) : undefined
    /** Object that receives the native listener. */
    const listenTarget: EventTarget = outside
      ? ((target as Node).ownerDocument ?? document)
      : target
    /** Listener object; the same identity is used for removal. */
    const listener = new EventSubscription(address, name, subscription, this.#services, {
      outsideOf
    })
    /** Listener options from the subscription. */
    const options = listenerOptions(subscription, outside)
    listenTarget.addEventListener(name, listener, options)
    return () => listenTarget.removeEventListener(name, listener, options)
  }

  /**
   * Subscribes one event of a template node once on its template host and returns the removal. Each
   * event is routed to the row instance (`…@row:<key>`) that contains its target; events outside
   * any row are ignored. Row instances themselves install no listener.
   */
  delegate(
    templateAddress: string,
    host: EventTarget,
    name: string,
    subscription: IEventSubscription,
    declaration?: IEventDeclaration
  ): () => void {
    if (declaration?.kind === 'component') return () => undefined
    /** Listener object; the same identity is used for removal. */
    const listener = new EventSubscription(templateAddress, name, subscription, this.#services, {
      delegated: true
    })
    /** Listener options from the subscription. */
    const options = listenerOptions(subscription, false)
    host.addEventListener(name, listener, options)
    return () => host.removeEventListener(name, listener, options)
  }

  /** Dispatches a declared custom event with its declared propagation flags. */
  dispatchCustom(
    target: EventTarget,
    name: string,
    declaration: IEventDeclaration,
    detail: unknown
  ): boolean {
    if (!NAMESPACED_EVENT.test(name))
      throw createPartDomError(
        PartDomErrorCode.customEventUnnamespaced,
        PartDomErrorText.customEventUnnamespaced(name)
      )
    return target.dispatchEvent(
      new CustomEvent(name, {
        bubbles: declaration.bubbles === true,
        composed: declaration.composed === true,
        cancelable: declaration.cancelable === true,
        detail
      })
    )
  }
}
