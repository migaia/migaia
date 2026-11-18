import {
  formatAddress,
  modifierArgs,
  modifierId,
  normalizeEventEntry,
  parseAddress,
  type IEventDeclaration,
  type IEventSubscription,
  type IModifierRef
} from '@migaia/part-contract'
import type {
  IModifierContext,
  IModifierDefinition,
  IModifierInstance,
  IModifierPlacement
} from '@migaia/part-host'
import { ADDRESS_ATTRIBUTE } from './layer-constants.ts'
import { PartDomErrorCode, type IPartDomErrorCode } from './error-code.ts'
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

/** Host services the event adapter forwards to. */
export type IEventServices = {
  readonly dispatch: (address: string, event: string, detail: unknown) => Promise<void>
  readonly report: (error: unknown) => void
  readonly modifier: (id: string) => IModifierDefinition<unknown> | undefined
}

/** Fields a modifier error carries so the failing subscription can be located. */
type IModifierErrorFields = {
  readonly address: string
  readonly event: string
  readonly modifier: string
}

/** Creates a coded modifier error and attaches the location fields without rebuilding it. */
function modifierError(
  code: IPartDomErrorCode,
  message: string,
  fields: IModifierErrorFields,
  cause?: unknown
): Error {
  /** Coded error. */
  const error = createPartDomError(code, message, cause)
  for (const [name, value] of Object.entries(fields))
    Object.defineProperty(error, name, { value, enumerable: true })
  return error
}

/** One step of a chain: the modifier id and its instance for this subscription. */
type IStep = { readonly id: string; readonly instance: IModifierInstance }

/**
 * One pass of an event through a chain from a starting step. Each step's `next` takes effect once;
 * later calls and calls after the subscription was removed do nothing.
 */
class ChainPass {
  /** Chain the pass runs through. */
  readonly #chain: ListenerChain
  /** Event of the pass. */
  readonly #event: unknown
  /** Part element of the event: the subscribed element or the row instance. */
  readonly #element: unknown
  /** Address the effect receives. */
  readonly #address: string
  /** Detail the effect receives; `next(detail)` replaces it. */
  #detail: unknown
  /** Steps whose `next` was already used in this pass. */
  readonly #advanced = new Set<number>()

  /** Captures the pass inputs. */
  constructor(
    chain: ListenerChain,
    event: unknown,
    element: unknown,
    address: string,
    detail: unknown
  ) {
    this.#chain = chain
    this.#event = event
    this.#element = element
    this.#address = address
    this.#detail = detail
  }

  /** Runs step `index`, or dispatches when the chain is exhausted. */
  run(index: number): void {
    if (this.#chain.removed) return
    /** Step at the index, if any. */
    const step = this.#chain.step(index)
    if (step === undefined) {
      this.#chain.dispatch(this.#address, this.#detail)
      return
    }
    this.#chain.remember(index, this.#element, this.#address)
    try {
      step.instance.handle(this.#event, (detail) => this.#advance(index, detail), this.#element)
    } catch (cause) {
      this.#chain.fail(step.id, cause)
    }
  }

  /** `next` of step `index`: once only, then the following step. */
  #advance(index: number, detail: unknown): void {
    if (this.#advanced.has(index)) return
    this.#advanced.add(index)
    if (detail !== undefined) this.#detail = detail
    this.run(index + 1)
  }
}

/**
 * Listener of one subscription: the modifier chain followed by host dispatch. Used as the native
 * listener object, so no closure is kept per subscription.
 */
class ListenerChain {
  /** Address of the subscribed part, or the static template-node address when delegated. */
  readonly #address: string
  /** Events record key; the host looks the subscription up by it. */
  readonly #key: string
  /** Host services. */
  readonly #services: IEventServices
  /** Whether the chain delegates for template-row instances on the template host. */
  readonly #delegated: boolean
  /** Element of the subscription (the template host when delegated). */
  readonly #element: Element | EventTarget
  /** Steps in subscription order, filled after creation. */
  #steps: readonly IStep[] = []
  /** Element and address the latest pass presented at each step, for `emit`. */
  readonly #seen = new Map<number, { readonly element: unknown; readonly address: string }>()
  /** Whether the subscription was removed. */
  removed = false

  /** Captures the subscription. */
  constructor(
    address: string,
    key: string,
    element: EventTarget,
    services: IEventServices,
    delegated: boolean
  ) {
    this.#address = address
    this.#key = key
    this.#element = element
    this.#services = services
    this.#delegated = delegated
  }

  /** Installs the created steps. */
  setSteps(steps: readonly IStep[]): void {
    this.#steps = steps
  }

  /** Step at an index. */
  step(index: number): IStep | undefined {
    return this.#steps[index]
  }

  /** Records what a pass presented at a step. */
  remember(index: number, element: unknown, address: string): void {
    this.#seen.set(index, { element, address })
  }

  /** Native listener entry: resolves the row instance when delegated and starts a pass. */
  handleEvent(event: Event): void {
    /** Row instance for a delegated listener. */
    const instance = this.#delegated
      ? rowInstanceOf(event, this.#address, event.currentTarget as Element)
      : undefined
    if (this.#delegated && instance === undefined) return
    new ChainPass(
      this,
      event,
      instance?.element ?? this.#element,
      instance?.address ?? this.#address,
      event instanceof CustomEvent ? event.detail : undefined
    ).run(0)
  }

  /** Runs the steps after `index` for an event a gesture produced. */
  emit(index: number, event: unknown, detail: unknown): void {
    /** Element and address of the pass that reached the emitting step. */
    const seen = this.#seen.get(index) ?? { element: this.#element, address: this.#address }
    new ChainPass(this, event, seen.element, seen.address, detail).run(index + 1)
  }

  /** Hands the event to the host; a failure the host did not report is reported here. */
  dispatch(address: string, detail: unknown): void {
    this.#services
      .dispatch(address, this.#key, detail)
      .catch((error: unknown) => this.#rejected(error))
  }

  /** Reports a throwing modifier step. */
  fail(id: string, cause: unknown): void {
    this.#services.report(
      modifierError(
        PartDomErrorCode.modifierFailed,
        PartDomErrorText.modifierFailed(id),
        { address: this.#address, event: this.#key, modifier: id },
        cause
      )
    )
  }

  /** Marks the chain removed and disposes instances in reverse creation order. */
  dispose(): void {
    this.removed = true
    for (let position = this.#steps.length - 1; position >= 0; position -= 1) {
      /** Step being disposed. */
      const step = this.#steps[position] as IStep
      try {
        step.instance.dispose?.()
      } catch (cause) {
        this.fail(step.id, cause)
      }
    }
  }

  /** Reports a dispatch failure unless the host already reported it. */
  #rejected(error: unknown): void {
    if ((error as { code?: unknown } | undefined)?.code !== ALREADY_REPORTED)
      this.#services.report(error)
  }
}

/** Context handed to the modifier at `index`; `emit` forwards to the chain. */
function modifierContext(
  chain: ListenerChain,
  index: number,
  address: string,
  element: EventTarget,
  siblings: readonly string[]
): IModifierContext {
  return {
    address,
    element,
    siblings,
    emit: (event, detail) => chain.emit(index, event, detail)
  }
}

/** A subscription resolved against the catalog, ready to install. */
type IPlan = {
  readonly name: string
  readonly subscription: IEventSubscription
  readonly refs: readonly IModifierRef[]
  readonly definitions: readonly IModifierDefinition<unknown>[]
}

/** No-op removal returned for subscriptions that install no listener. */
function noop(): void {}

/**
 * Adapts `dom` and `custom` events (and `native` subscriptions to component events) to host
 * dispatch through each subscription's modifier chain.
 */
export class EventAdapter {
  /** Host services. */
  readonly #services: IEventServices

  /** Binds the adapter to host services. */
  constructor(services: IEventServices) {
    this.#services = services
  }

  /**
   * Subscribes one events record entry and returns its removal. `key` may be shorthand
   * (`click.once.outside`). A placement modifier decides where the listener sits.
   */
  subscribe(
    address: string,
    target: EventTarget,
    key: string,
    subscription: IEventSubscription,
    declaration?: IEventDeclaration
  ): () => void {
    return this.#install(address, target, key, subscription, declaration, false)
  }

  /**
   * Subscribes one event of a template node once on its template host and returns the removal. Each
   * event is routed to the row instance (`…@row:<key>`) that contains its target; events outside
   * any row are ignored. Placement modifiers are not allowed here.
   */
  delegate(
    templateAddress: string,
    host: EventTarget,
    key: string,
    subscription: IEventSubscription,
    declaration?: IEventDeclaration
  ): () => void {
    return this.#install(templateAddress, host, key, subscription, declaration, true)
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

  /** Resolves, creates and installs one subscription; failures are reported, never thrown. */
  #install(
    address: string,
    target: EventTarget,
    key: string,
    raw: IEventSubscription,
    declaration: IEventDeclaration | undefined,
    delegated: boolean
  ): () => void {
    /** Plan of the subscription, or undefined when it installs nothing. */
    const plan = this.#plan(address, key, raw, declaration, delegated)
    if (plan === undefined) return noop
    /** Listener chain of the subscription. */
    const chain = new ListenerChain(address, key, target, this.#services, delegated)
    /** Ids of every modifier, in order. */
    const ids = plan.refs.map(modifierId)
    /** Instances created so far, disposed again if a later creation fails. */
    const steps: IStep[] = []
    /** Placement chosen by a placement modifier. */
    let placement: IModifierPlacement | undefined
    for (let position = 0; position < plan.refs.length; position += 1) {
      /** Definition and arguments of this step. */
      const definition = plan.definitions[position] as IModifierDefinition<unknown>
      /** Arguments of the reference. */
      const args = modifierArgs(plan.refs[position] as IModifierRef)
      try {
        if (definition.place !== undefined) placement = definition.place(target, args)
        steps.push({
          id: ids[position] as string,
          instance: definition.create(args, modifierContext(chain, position, address, target, ids))
        })
      } catch (cause) {
        chain.setSteps(steps)
        chain.dispose()
        chain.fail(ids[position] as string, cause)
        return noop
      }
    }
    chain.setSteps(steps)
    /** Object receiving the native listener. */
    const listenTarget = (placement?.target as EventTarget | undefined) ?? target
    /** Native listener options. */
    const options: AddEventListenerOptions = {
      capture: placement?.capture ?? plan.subscription.capture === true,
      once: plan.subscription.once === true,
      passive: plan.subscription.passive === true
    }
    listenTarget.addEventListener(plan.name, chain, options)
    return () => {
      listenTarget.removeEventListener(plan.name, chain, options)
      chain.dispose()
    }
  }

  /**
   * Normalizes the key and looks every modifier up. Component callbacks without `native` install
   * nothing; an unavailable modifier or a placement modifier on a delegated subscription is
   * reported and installs nothing.
   */
  #plan(
    address: string,
    key: string,
    raw: IEventSubscription,
    declaration: IEventDeclaration | undefined,
    delegated: boolean
  ): IPlan | undefined {
    /** Normalized entry. */
    const { name, subscription } = normalizeEventEntry(key, raw)
    if (declaration?.kind === 'component' && subscription.native !== true) return undefined
    /** Modifier references. */
    const refs = subscription.modifiers ?? []
    /** Definitions found. */
    const definitions: IModifierDefinition<unknown>[] = []
    for (const ref of refs) {
      /** Id of the reference. */
      const id = modifierId(ref)
      /** Definition, when available. */
      const definition = this.#services.modifier(id)
      if (definition === undefined || (delegated && definition.place !== undefined)) {
        /** Whether the problem is a placement modifier on a delegated subscription. */
        const placed = definition !== undefined
        this.#services.report(
          modifierError(
            placed
              ? PartDomErrorCode.modifierPlacementDelegated
              : PartDomErrorCode.modifierUnavailable,
            placed
              ? PartDomErrorText.modifierPlacementDelegated(id)
              : PartDomErrorText.modifierUnavailable(id),
            { address, event: key, modifier: id }
          )
        )
        return undefined
      }
      definitions.push(definition)
    }
    return { name, subscription, refs, definitions }
  }
}
