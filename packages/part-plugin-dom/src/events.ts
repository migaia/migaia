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

/** A subscription resolved against the catalog, ready to install. */
type IPlan = {
  readonly name: string
  readonly subscription: IEventSubscription
  readonly refs: readonly IModifierRef[]
  readonly ids: readonly string[]
  readonly definitions: readonly IModifierDefinition<unknown>[]
}

/**
 * Modifier instances of one part element. A plain subscription has one group; a delegated
 * subscription has one group per row instance, so stateful modifiers (debounce, long press) keep
 * separate state per row. `element` is refreshed on every event because a row may re-render.
 */
type IStepGroup = { readonly address: string; element: unknown; readonly steps: readonly IStep[] }

/**
 * One pass of an event through a group's steps from a starting index. Each step's `next` takes
 * effect once; later calls and calls after the subscription was removed do nothing.
 */
class ChainPass {
  /** Chain the pass runs through. */
  readonly #chain: ListenerChain
  /** Group whose steps run. */
  readonly #group: IStepGroup
  /** Event of the pass. */
  readonly #event: unknown
  /** Detail the effect receives; `next(detail)` replaces it. */
  #detail: unknown
  /** Steps whose `next` was already used in this pass. */
  readonly #advanced = new Set<number>()

  /** Captures the pass inputs. */
  constructor(chain: ListenerChain, group: IStepGroup, event: unknown, detail: unknown) {
    this.#chain = chain
    this.#group = group
    this.#event = event
    this.#detail = detail
  }

  /** Runs step `index`, or dispatches when the steps are exhausted. */
  run(index: number): void {
    if (this.#chain.removed) return
    /** Step at the index, if any. */
    const step = this.#group.steps[index]
    if (step === undefined) {
      this.#chain.dispatch(this.#group.address, this.#detail)
      return
    }
    try {
      step.instance.handle(
        this.#event,
        (detail) => this.#advance(index, detail),
        this.#group.element
      )
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
 * Listener of one subscription: per-element modifier steps followed by host dispatch. Used as the
 * native listener object. `once` is enforced here, after a dispatch, rather than as a native
 * listener option, so an event a modifier stops does not consume it.
 */
class ListenerChain {
  /** Address of the subscribed part, or the static template-node address when delegated. */
  readonly #address: string
  /** Events record key; the host looks the subscription up by it. */
  readonly #key: string
  /** Resolved modifiers of the subscription. */
  readonly #plan: IPlan
  /** Host services. */
  readonly #services: IEventServices
  /** Whether the chain delegates for template-row instances on the template host. */
  readonly #delegated: boolean
  /** Subscribed element (the template host when delegated); placement may listen elsewhere. */
  readonly #target: EventTarget
  /** Step groups by part address; a delegated chain adds one per row, a failed creation is null. */
  readonly #groups = new Map<string, IStepGroup | null>()
  /** Native registration, removed after the first dispatch when the subscription is `once`. */
  #registration: NativeRegistration | undefined
  /** Whether the subscription was removed. */
  removed = false

  /** Captures the subscription. */
  constructor(
    address: string,
    key: string,
    target: EventTarget,
    plan: IPlan,
    services: IEventServices,
    delegated: boolean
  ) {
    this.#target = target
    this.#address = address
    this.#key = key
    this.#plan = plan
    this.#services = services
    this.#delegated = delegated
  }

  /** Records the native registration so `once` can remove it. */
  attach(registration: NativeRegistration): void {
    this.#registration = registration
  }

  /**
   * Returns the step group of a part element, creating its modifier instances on first use. A
   * creation failure is reported once and the element's events are ignored afterwards.
   */
  group(address: string, element: unknown): IStepGroup | undefined {
    /** Existing group, null after a failed creation. */
    const existing = this.#groups.get(address)
    if (existing === null) return undefined
    if (existing !== undefined) {
      existing.element = element
      return existing
    }
    /** Created group, or null on failure. */
    const created = this.#create(address, element)
    this.#groups.set(address, created)
    return created ?? undefined
  }

  /** Creates the modifier instances of one element in subscription order. */
  #create(address: string, element: unknown): IStepGroup | null {
    /** Instances created so far, disposed again if a later creation fails. */
    const steps: IStep[] = []
    /** Group under construction; steps are filled in place. */
    const group: IStepGroup = { address, element, steps }
    for (let position = 0; position < this.#plan.refs.length; position += 1) {
      /** Id of the step. */
      const id = this.#plan.ids[position] as string
      try {
        steps.push({
          id,
          instance: (this.#plan.definitions[position] as IModifierDefinition<unknown>).create(
            modifierArgs(this.#plan.refs[position] as IModifierRef),
            modifierContext(this, group, position, this.#plan.ids)
          )
        })
      } catch (cause) {
        this.#disposeSteps(steps)
        this.fail(id, cause)
        return null
      }
    }
    return group
  }

  /** Native listener entry: resolves the row instance when delegated and starts a pass. */
  handleEvent(event: Event): void {
    /** Row instance for a delegated listener. */
    const instance = this.#delegated
      ? rowInstanceOf(event, this.#address, event.currentTarget as Element)
      : undefined
    if (this.#delegated && instance === undefined) return
    /** Steps of the element the event belongs to. */
    const group = this.group(instance?.address ?? this.#address, instance?.element ?? this.#target)
    if (group === undefined) return
    new ChainPass(this, group, event, event instanceof CustomEvent ? event.detail : undefined).run(
      0
    )
  }

  /** Runs a group's steps after `index` for an event a gesture produced. */
  emit(group: IStepGroup, index: number, event: unknown, detail: unknown): void {
    new ChainPass(this, group, event, detail).run(index + 1)
  }

  /** Hands the event to the host; a `once` subscription is removed first. */
  dispatch(address: string, detail: unknown): void {
    if (this.#plan.subscription.once === true) this.#registration?.remove()
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

  /** Marks the chain removed and disposes every group's instances in reverse creation order. */
  dispose(): void {
    if (this.removed) return
    this.removed = true
    for (const group of this.#groups.values()) if (group !== null) this.#disposeSteps(group.steps)
  }

  /** Disposes steps in reverse order; a throwing disposal is reported and the rest continue. */
  #disposeSteps(steps: readonly IStep[]): void {
    for (let position = steps.length - 1; position >= 0; position -= 1) {
      /** Step being disposed. */
      const step = steps[position] as IStep
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

/** Native listener registration of one chain; `remove` is idempotent. */
class NativeRegistration {
  /** Object holding the native listener. */
  readonly #target: EventTarget
  /** Native event name. */
  readonly #name: string
  /** Chain registered as the listener. */
  readonly #chain: ListenerChain
  /** Options used for both registration and removal. */
  readonly #options: AddEventListenerOptions

  /** Registers the chain. */
  constructor(
    target: EventTarget,
    name: string,
    chain: ListenerChain,
    options: AddEventListenerOptions
  ) {
    this.#target = target
    this.#name = name
    this.#chain = chain
    this.#options = options
    target.addEventListener(name, chain, options)
  }

  /** Removes the listener and disposes the chain's modifier instances. */
  remove(): void {
    if (this.#chain.removed) return
    this.#target.removeEventListener(this.#name, this.#chain, this.#options)
    this.#chain.dispose()
  }
}

/** Context handed to the modifier at `index` of a group; `emit` forwards to the chain. */
function modifierContext(
  chain: ListenerChain,
  group: IStepGroup,
  index: number,
  siblings: readonly string[]
): IModifierContext {
  return {
    address: group.address,
    element: group.element,
    siblings,
    emit: (event, detail) => chain.emit(group, index, event, detail)
  }
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
   * any row are ignored. Each row gets its own modifier instances. Placement modifiers are not
   * allowed here.
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
    const chain = new ListenerChain(address, key, target, plan, this.#services, delegated)
    /** Placement chosen by a placement modifier, or a failure already reported. */
    const placement = this.#placement(chain, plan, target)
    if (placement === null) return noop
    if (!delegated && chain.group(address, target) === undefined) return noop
    /** Native registration; `once` is enforced by the chain, not by the native option. */
    const registration = new NativeRegistration(
      (placement?.target as EventTarget | undefined) ?? target,
      plan.name,
      chain,
      {
        capture: placement?.capture ?? plan.subscription.capture === true,
        passive: plan.subscription.passive === true
      }
    )
    chain.attach(registration)
    return () => registration.remove()
  }

  /** Listener position from the placement modifier, if any; null after a reported failure. */
  #placement(
    chain: ListenerChain,
    plan: IPlan,
    target: EventTarget
  ): IModifierPlacement | undefined | null {
    for (let position = 0; position < plan.refs.length; position += 1) {
      /** Definition of the step. */
      const definition = plan.definitions[position] as IModifierDefinition<unknown>
      if (definition.place === undefined) continue
      try {
        return definition.place(target, modifierArgs(plan.refs[position] as IModifierRef))
      } catch (cause) {
        chain.fail(plan.ids[position] as string, cause)
        return null
      }
    }
    return undefined
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
    return { name, subscription, refs, ids: refs.map(modifierId), definitions }
  }
}
