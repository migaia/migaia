import type { IEventDeclaration, IEventSubscription } from '@migaia/part-contract'
import { PartDomErrorCode } from './error-code.ts'
import { PartDomErrorText } from './error-text.ts'
import { createPartDomError } from './errors.ts'

/** Custom event name grammar: plugin name, colon, event name. */
const NAMESPACED_EVENT = /^[a-z0-9][a-z0-9-]*:[A-Za-z0-9-]+$/
/** Error code that marks a failure the host already reported. */
const ALREADY_REPORTED = 'EFFECT_FAILED'

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

  /** Captures the subscription. */
  constructor(
    address: string,
    name: string,
    subscription: IEventSubscription,
    services: IEventServices
  ) {
    this.#address = address
    this.#name = name
    this.#subscription = subscription
    this.#services = services
  }

  /** Applies modifiers synchronously, then hands the event to the host. */
  handleEvent(event: Event): void {
    /** Modifiers of the subscription. */
    const modifiers = this.#subscription.modifiers ?? []
    if (modifiers.includes('self') && event.target !== event.currentTarget) return
    if (modifiers.includes('stop')) event.stopPropagation()
    if (modifiers.includes('prevent')) event.preventDefault()
    this.#services
      .dispatch(this.#address, this.#name, event instanceof CustomEvent ? event.detail : undefined)
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

  /** Subscribes one event and returns its removal. */
  subscribe(
    address: string,
    target: EventTarget,
    name: string,
    subscription: IEventSubscription,
    declaration?: IEventDeclaration
  ): () => void {
    if (declaration?.kind === 'component') return () => undefined
    /** Listener object; the same identity is used for removal. */
    const listener = new EventSubscription(address, name, subscription, this.#services)
    /** Listener options from the subscription. */
    const options = {
      capture: subscription.capture === true,
      once: subscription.once === true,
      passive: subscription.passive === true
    }
    target.addEventListener(name, listener, options)
    return () => target.removeEventListener(name, listener, options)
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
