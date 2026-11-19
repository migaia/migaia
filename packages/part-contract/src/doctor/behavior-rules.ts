import { eventEntries, modifierId } from '../event-key.ts'
import { defineRule, type IRuleContext } from '../rules.ts'
import type { IEventDeclaration, IEventSubscription, IPartAddress } from '../types.ts'
import { isDeriveBinding, isStateBinding, partOf, propValues, target } from './shared.ts'
import { DOM_EVENTS, NAMESPACED_EVENT, STATE_PATH, Z_INDEX_KEYS } from './tables.ts'

/** Both built-in phases. */
const BOTH = ['authored', 'resolved'] as const

/** Id of the built-in modifier that cancels the default action. */
const PREVENT_MODIFIER = 'prevent@1'

/**
 * One subscription of the node under check: its record key (issue path), event name, normalized
 * subscription and declaration. A `native` subscription listens for the DOM event, so it has no
 * declaration.
 */
type ISubscriptionView = {
  readonly key: string
  readonly name: string
  readonly subscription: IEventSubscription
  readonly declaration: IEventDeclaration | undefined
}

/** Subscriptions of the node under check, normalized from shorthand keys, with declarations. */
function subscriptionsOf(context: IRuleContext<unknown>): readonly ISubscriptionView[] {
  /** Node under check. */
  const { node } = target(context)
  /** Declarations of the part. */
  const declarations = partOf(context, node)?.events ?? {}
  return eventEntries(node.facets?.events).map((entry) => ({
    key: entry.key,
    name: entry.name,
    subscription: entry.subscription,
    declaration: entry.subscription.native === true ? undefined : declarations[entry.name]
  }))
}

/** Event kind a subscription listens to: native and undeclared subscriptions are DOM events. */
function kindOf(view: ISubscriptionView): IEventDeclaration['kind'] {
  return view.declaration?.kind ?? 'dom'
}

/** Reports one event issue at the node under check; `path` defaults to the record key. */
function reportEvent(
  context: IRuleContext<unknown>,
  key: string,
  messageKey: string,
  path: string = key
): void {
  context.report({ address: context.address as string, facet: 'events', path, messageKey })
}

/** Subscriptions to events the part does not declare and the DOM does not define. */
function checkDeclared(context: IRuleContext<unknown>): void {
  for (const view of subscriptionsOf(context))
    if (view.declaration === undefined && !DOM_EVENTS.has(view.name))
      reportEvent(context, view.key, 'event.declared')
}

/**
 * Component events are callbacks, not DOM listeners: they have no capture phase, no passive
 * listeners and no `once` option. Component callbacks dispatch by event name, so a key carrying
 * such options would never be found either.
 */
function checkComponentCapture(context: IRuleContext<unknown>): void {
  for (const view of subscriptionsOf(context))
    if (
      view.declaration?.kind === 'component' &&
      (view.subscription.capture === true ||
        view.subscription.passive === true ||
        view.subscription.once === true)
    )
      reportEvent(context, view.key, 'event.component-no-capture')
}

/** Filter keys must be `reason` or detail fields; reason values must be declared. */
function checkFilterFields(context: IRuleContext<unknown>): void {
  for (const view of subscriptionsOf(context)) {
    if (view.declaration === undefined || view.subscription.filter === undefined) continue
    /** Field names of the declared detail schema, as a set for constant-time lookup. */
    const fields = new Set(
      Object.keys(
        (view.declaration.detail?.properties as Record<string, unknown> | undefined) ?? {}
      )
    )
    /** Declared reason values, as a set. */
    const reasons = new Set(view.declaration.reason ?? [])
    for (const [key, value] of Object.entries(view.subscription.filter)) {
      /** Filter values as a list. */
      const values = Array.isArray(value) ? value : [value]
      /** Whether this filter entry is valid. */
      const valid =
        key === 'reason' ? values.every((reason) => reasons.has(String(reason))) : fields.has(key)
      if (!valid) reportEvent(context, view.key, 'event.filter-fields')
    }
  }
}

/** Custom events must carry a plugin namespace. */
function checkCustomNamespace(context: IRuleContext<unknown>): void {
  for (const view of subscriptionsOf(context))
    if (view.declaration?.kind === 'custom' && !NAMESPACED_EVENT.test(view.name))
      reportEvent(context, view.key, 'event.custom-namespace')
}

/** `prevent` has no effect on a custom event that is not cancelable. */
function checkPreventCancelable(context: IRuleContext<unknown>): void {
  for (const view of subscriptionsOf(context))
    if (
      (view.subscription.modifiers ?? []).some((ref) => modifierId(ref) === PREVENT_MODIFIER) &&
      view.declaration?.kind === 'custom' &&
      view.declaration.cancelable !== true
    )
      reportEvent(context, view.key, 'event.prevent-cancelable')
}

/** Handlers must exist in the catalog. */
function checkHandlerExists(context: IRuleContext<unknown>): void {
  for (const view of subscriptionsOf(context))
    if (context.catalog.get(view.subscription.handler) === undefined)
      reportEvent(context, view.key, 'event.handler-exists')
}

/** Synchronous handlers must run in the page trust tier. */
function checkSyncTier(context: IRuleContext<unknown>): void {
  for (const view of subscriptionsOf(context)) {
    if (view.subscription.sync !== true) continue
    /** Tier of the handler, when the handler declares one. */
    const tier = context.catalog.get(view.subscription.handler)?.tier
    if (tier !== undefined && tier !== 'page') reportEvent(context, view.key, 'event.sync-tier')
  }
}

/** Path of one modifier inside a subscription, for issue locations. */
function modifierPath(key: string, position: number): string {
  return `${key}/modifiers/${position}`
}

/** Every referenced modifier must be available in the catalog. */
function checkModifierExists(context: IRuleContext<unknown>): void {
  for (const view of subscriptionsOf(context))
    (view.subscription.modifiers ?? []).forEach((ref, position) => {
      if (context.catalog.get(modifierId(ref))?.kind !== 'modifier')
        reportEvent(context, view.key, 'event.modifier-exists', modifierPath(view.key, position))
    })
}

/** A modifier applies only to the event kinds it declares; component callbacks take none. */
function checkModifierKind(context: IRuleContext<unknown>): void {
  for (const view of subscriptionsOf(context))
    (view.subscription.modifiers ?? []).forEach((ref, position) => {
      /** Event kinds the modifier declares, when it exists. */
      const kinds = context.catalog.get(modifierId(ref))?.eventKinds
      /** Kind of the subscribed event. */
      const kind = kindOf(view)
      if (kinds !== undefined && (kind === 'component' || !kinds.includes(kind)))
        reportEvent(context, view.key, 'event.modifier-kind', modifierPath(view.key, position))
    })
}

/**
 * True when the node lies in a template subtree: some ancestor's `template.node` is on its path.
 * The walk follows parent links, so it is bounded by the tree depth.
 */
function inTemplate(context: IRuleContext<unknown>, address: IPartAddress): boolean {
  /** Current entry on the walk up. */
  let current = context.index.get(address)
  while (current?.parent !== undefined) {
    /** Parent entry. */
    const parent = context.index.get(current.parent)
    if (parent?.node.template?.node === current.node) return true
    current = parent
  }
  return false
}

/**
 * At most one modifier per subscription may move the listener, and none on template nodes, whose
 * listeners the template host delegates.
 */
function checkModifierPlacement(context: IRuleContext<unknown>): void {
  /** Whether the node under check is delegated by a template host. */
  const delegated = inTemplate(context, context.address as string)
  for (const view of subscriptionsOf(context)) {
    /** Placement modifiers seen so far in this subscription. */
    let seen = 0
    ;(view.subscription.modifiers ?? []).forEach((ref, position) => {
      if (context.catalog.get(modifierId(ref))?.placement !== true) return
      seen += 1
      if (delegated || seen > 1)
        reportEvent(context, view.key, 'event.modifier-placement', modifierPath(view.key, position))
    })
  }
}

/** Each repeated occurrence of a modifier id in one subscription is reported. */
function checkModifierDuplicate(context: IRuleContext<unknown>): void {
  for (const view of subscriptionsOf(context)) {
    /** Ids seen so far. */
    const seen = new Set<string>()
    ;(view.subscription.modifiers ?? []).forEach((ref, position) => {
      /** Id of the reference. */
      const id = modifierId(ref)
      if (seen.has(id))
        reportEvent(context, view.key, 'event.modifier-duplicate', modifierPath(view.key, position))
      seen.add(id)
    })
  }
}

/** Handlers must be effects, not derives or other kinds. */
function checkCallTarget(context: IRuleContext<unknown>): void {
  for (const view of subscriptionsOf(context)) {
    /** Kind of the handler, if it exists. */
    const kind = context.catalog.get(view.subscription.handler)?.kind
    if (kind !== undefined && kind !== 'effect') reportEvent(context, view.key, 'flow.call-target')
  }
}

/** Derives must not declare writes. */
function checkDeriveNoWrite(context: IRuleContext<unknown>): void {
  /** Node under check. */
  const { node, address } = target(context)
  for (const [key, value] of Object.entries(node.facets?.props ?? {}))
    if (isDeriveBinding(value) && (context.catalog.get(value.$derive)?.writes?.length ?? 0) > 0)
      context.report({ address, facet: 'props', path: key, messageKey: 'flow.derive-no-write' })
}

/** State bindings must name a scope and a key path. */
function checkBindPath(context: IRuleContext<unknown>): void {
  /** Node under check. */
  const { node, address } = target(context)
  for (const { path, value } of propValues(node))
    if (isStateBinding(value) && !STATE_PATH.test(value.$state))
      context.report({ address, facet: 'props', path, messageKey: 'flow.bind-path' })
}

/** Section state is readable only below the section node with that id. */
function checkScope(context: IRuleContext<unknown>): void {
  /** Node under check. */
  const { node, address } = target(context)
  /** Address segments of the node and its ancestors. */
  const lineage = new Set(address.split('/'))
  for (const { path, value } of propValues(node)) {
    if (!isStateBinding(value) || !value.$state.startsWith('section.')) continue
    /** Section id the binding names. */
    const section = value.$state.split('.')[1] ?? ''
    if (!lineage.has(section))
      context.report({ address, facet: 'props', path, messageKey: 'flow.scope' })
  }
}

/** Derives referenced by the blueprint must not depend on each other in a cycle. */
function checkDeriveAcyclic(context: IRuleContext<unknown>): void {
  /** Visit state per derive id: 1 while on the stack, 2 when finished. */
  const state = new Map<string, 1 | 2>()
  for (const entry of context.index.entries())
    for (const [key, value] of Object.entries(entry.node.facets?.props ?? {}))
      if (isDeriveBinding(value) && hasCycle(context, value.$derive, state))
        context.report({
          address: entry.address,
          facet: 'props',
          path: key,
          messageKey: 'flow.derive-acyclic'
        })
}

/** Depth-first search over derive `inputs`; each derive is finished once, so total work is linear. */
function hasCycle(context: IRuleContext<unknown>, id: string, state: Map<string, 1 | 2>): boolean {
  /** Visit state of this derive. */
  const seen = state.get(id)
  if (seen === 1) return true
  if (seen === 2) return false
  state.set(id, 1)
  for (const input of context.catalog.get(id)?.inputs ?? [])
    if (hasCycle(context, input, state)) return true
  state.set(id, 2)
  return false
}

/** Tabindex may only be 0 or -1. */
function checkTabindex(context: IRuleContext<unknown>): void {
  /** Node under check. */
  const { node, address } = target(context)
  /** Authored tabindex value, if any. */
  const value = node.facets?.attrs?.tabindex
  if (value !== undefined && Number(value) !== 0 && Number(value) !== -1)
    context.report({
      address,
      facet: 'attrs',
      path: 'tabindex',
      messageKey: 'behavior.tabindex',
      basis: 'ARIA'
    })
}

/** Blueprints must not override aria the definition derives. */
function checkNoAriaOverride(context: IRuleContext<unknown>): void {
  /** Node under check. */
  const { node, address } = target(context)
  /** Derived aria attribute names. */
  const derived = partOf(context, node)?.behavior?.aria ?? {}
  for (const name of Object.keys(node.facets?.aria ?? {}))
    if (derived[name] !== undefined)
      context.report({
        address,
        facet: 'aria',
        path: name,
        messageKey: 'behavior.no-aria-override'
      })
}

/** Stacking order belongs to the page layer manager, never to a blueprint value. */
function checkNoZIndex(context: IRuleContext<unknown>): void {
  /** Node under check. */
  const { node, address } = target(context)
  for (const name of Object.keys(node.facets?.style ?? {}))
    if (Z_INDEX_KEYS.has(name))
      context.report({ address, facet: 'style', path: name, messageKey: 'behavior.no-zindex' })
}

/** The open-state prop must be writable: a literal or a state binding, never a derive. */
function checkOpenStateBinding(context: IRuleContext<unknown>): void {
  /** Node under check. */
  const { node, address } = target(context)
  /** Prop name holding the open state. */
  const openState = partOf(context, node)?.behavior?.states?.openState
  if (openState !== undefined && isDeriveBinding(node.facets?.props?.[openState]))
    context.report({
      address,
      facet: 'props',
      path: openState,
      messageKey: 'behavior.open-state-binding'
    })
}

/** Event, flow and behavior rules; twenty rules in total. */
export const behaviorRules = [
  defineRule({
    id: 'event.component-no-capture',
    scope: 'part',
    phase: BOTH,
    severity: 'error',
    check: checkComponentCapture
  }),
  defineRule({
    id: 'event.declared',
    scope: 'part',
    phase: BOTH,
    severity: 'error',
    check: checkDeclared
  }),
  defineRule({
    id: 'event.filter-fields',
    scope: 'part',
    phase: BOTH,
    severity: 'error',
    check: checkFilterFields
  }),
  defineRule({
    id: 'event.custom-namespace',
    scope: 'part',
    phase: BOTH,
    severity: 'error',
    check: checkCustomNamespace
  }),
  defineRule({
    id: 'event.prevent-cancelable',
    scope: 'part',
    phase: BOTH,
    severity: 'warning',
    check: checkPreventCancelable
  }),
  defineRule({
    id: 'event.handler-exists',
    scope: 'part',
    phase: BOTH,
    severity: 'error',
    check: checkHandlerExists
  }),
  defineRule({
    id: 'event.sync-tier',
    scope: 'part',
    phase: BOTH,
    severity: 'error',
    check: checkSyncTier
  }),
  defineRule({
    id: 'event.modifier-exists',
    scope: 'part',
    phase: BOTH,
    severity: 'error',
    check: checkModifierExists
  }),
  defineRule({
    id: 'event.modifier-kind',
    scope: 'part',
    phase: BOTH,
    severity: 'error',
    check: checkModifierKind
  }),
  defineRule({
    id: 'event.modifier-placement',
    scope: 'part',
    phase: BOTH,
    severity: 'error',
    check: checkModifierPlacement
  }),
  defineRule({
    id: 'event.modifier-duplicate',
    scope: 'part',
    phase: BOTH,
    severity: 'error',
    check: checkModifierDuplicate
  }),
  defineRule({
    id: 'flow.derive-no-write',
    scope: 'part',
    phase: BOTH,
    severity: 'error',
    check: checkDeriveNoWrite
  }),
  defineRule({
    id: 'flow.bind-path',
    scope: 'part',
    phase: BOTH,
    severity: 'error',
    check: checkBindPath
  }),
  defineRule({
    id: 'flow.call-target',
    scope: 'part',
    phase: BOTH,
    severity: 'error',
    check: checkCallTarget
  }),
  defineRule({
    id: 'flow.derive-acyclic',
    scope: 'blueprint',
    phase: BOTH,
    severity: 'error',
    check: checkDeriveAcyclic
  }),
  defineRule({
    id: 'flow.scope',
    scope: 'part',
    phase: BOTH,
    severity: 'error',
    check: checkScope
  }),
  defineRule({
    id: 'behavior.tabindex',
    scope: 'part',
    phase: BOTH,
    severity: 'error',
    check: checkTabindex
  }),
  defineRule({
    id: 'behavior.no-aria-override',
    scope: 'part',
    phase: BOTH,
    severity: 'error',
    check: checkNoAriaOverride
  }),
  defineRule({
    id: 'behavior.no-zindex',
    scope: 'part',
    phase: BOTH,
    severity: 'error',
    check: checkNoZIndex
  }),
  defineRule({
    id: 'behavior.open-state-binding',
    scope: 'part',
    phase: BOTH,
    severity: 'error',
    check: checkOpenStateBinding
  })
]
