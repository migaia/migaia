import { defineRule, type IRuleContext } from '../rules.ts'
import type { IEventDeclaration, IEventSubscription } from '../types.ts'
import { isDeriveBinding, isStateBinding, partOf, target } from './shared.ts'
import { DOM_EVENTS, NAMESPACED_EVENT, STATE_PATH, Z_INDEX_KEYS } from './tables.ts'

/** Both built-in phases. */
const BOTH = ['authored', 'resolved'] as const

/** One subscription of the node under check with its declaration, if the part declares it. */
type ISubscriptionView = {
  readonly name: string
  readonly subscription: IEventSubscription
  readonly declaration: IEventDeclaration | undefined
}

/** Subscriptions of the node under check, paired with their declarations. */
function subscriptionsOf(context: IRuleContext<unknown>): readonly ISubscriptionView[] {
  /** Node under check. */
  const { node } = target(context)
  /** Declarations of the part. */
  const declarations = partOf(context, node)?.events ?? {}
  return Object.entries(node.facets?.events ?? {}).map(([name, subscription]) => ({
    name,
    subscription,
    declaration: declarations[name]
  }))
}

/** Reports one event issue at the node under check. */
function reportEvent(context: IRuleContext<unknown>, name: string, messageKey: string): void {
  context.report({ address: context.address as string, facet: 'events', path: name, messageKey })
}

/** Subscriptions to events the part does not declare and the DOM does not define. */
function checkDeclared(context: IRuleContext<unknown>): void {
  for (const view of subscriptionsOf(context))
    if (view.declaration === undefined && !DOM_EVENTS.has(view.name))
      reportEvent(context, view.name, 'event.declared')
}

/** Component events have no capture phase and no passive listeners. */
function checkComponentCapture(context: IRuleContext<unknown>): void {
  for (const view of subscriptionsOf(context))
    if (
      view.declaration?.kind === 'component' &&
      (view.subscription.capture === true || view.subscription.passive === true)
    )
      reportEvent(context, view.name, 'event.component-no-capture')
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
      if (!valid) reportEvent(context, view.name, 'event.filter-fields')
    }
  }
}

/** Custom events must carry a plugin namespace. */
function checkCustomNamespace(context: IRuleContext<unknown>): void {
  for (const view of subscriptionsOf(context))
    if (view.declaration?.kind === 'custom' && !NAMESPACED_EVENT.test(view.name))
      reportEvent(context, view.name, 'event.custom-namespace')
}

/** `prevent` has no effect on a custom event that is not cancelable. */
function checkPreventCancelable(context: IRuleContext<unknown>): void {
  for (const view of subscriptionsOf(context))
    if (
      view.subscription.modifiers?.includes('prevent') === true &&
      view.declaration?.kind === 'custom' &&
      view.declaration.cancelable !== true
    )
      reportEvent(context, view.name, 'event.prevent-cancelable')
}

/** Handlers must exist in the catalog. */
function checkHandlerExists(context: IRuleContext<unknown>): void {
  for (const view of subscriptionsOf(context))
    if (context.catalog.get(view.subscription.handler) === undefined)
      reportEvent(context, view.name, 'event.handler-exists')
}

/** Synchronous handlers must run in the page trust tier. */
function checkSyncTier(context: IRuleContext<unknown>): void {
  for (const view of subscriptionsOf(context)) {
    if (view.subscription.sync !== true) continue
    /** Tier of the handler, when the handler declares one. */
    const tier = context.catalog.get(view.subscription.handler)?.tier
    if (tier !== undefined && tier !== 'page') reportEvent(context, view.name, 'event.sync-tier')
  }
}

/** The `outside` modifier listens on the document, so it applies only to DOM events. */
function checkOutsideDom(context: IRuleContext<unknown>): void {
  for (const view of subscriptionsOf(context))
    if (
      view.subscription.modifiers?.includes('outside') === true &&
      view.declaration !== undefined &&
      view.declaration.kind !== 'dom'
    )
      reportEvent(context, view.name, 'event.outside-dom')
}

/** Handlers must be effects, not derives or other kinds. */
function checkCallTarget(context: IRuleContext<unknown>): void {
  for (const view of subscriptionsOf(context)) {
    /** Kind of the handler, if it exists. */
    const kind = context.catalog.get(view.subscription.handler)?.kind
    if (kind !== undefined && kind !== 'effect') reportEvent(context, view.name, 'flow.call-target')
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
  for (const [key, value] of Object.entries(node.facets?.props ?? {}))
    if (isStateBinding(value) && !STATE_PATH.test(value.$state))
      context.report({ address, facet: 'props', path: key, messageKey: 'flow.bind-path' })
}

/** Section state is readable only below the section node with that id. */
function checkScope(context: IRuleContext<unknown>): void {
  /** Node under check. */
  const { node, address } = target(context)
  /** Address segments of the node and its ancestors. */
  const lineage = new Set(address.split('/'))
  for (const [key, value] of Object.entries(node.facets?.props ?? {})) {
    if (!isStateBinding(value) || !value.$state.startsWith('section.')) continue
    /** Section id the binding names. */
    const section = value.$state.split('.')[1] ?? ''
    if (!lineage.has(section))
      context.report({ address, facet: 'props', path: key, messageKey: 'flow.scope' })
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

/** Event, flow and behavior rules; seventeen rules in total. */
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
    id: 'event.outside-dom',
    scope: 'part',
    phase: BOTH,
    severity: 'error',
    check: checkOutsideDom
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
