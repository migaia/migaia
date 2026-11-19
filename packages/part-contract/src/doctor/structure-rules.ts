import { parseAddress, tagSegmentName } from '../address.ts'
import { isDescriptorId, splitDescriptorId } from '../descriptor-id.ts'
import { defineRule, type IRuleContext } from '../rules.ts'
import type { IStyleHookType } from '../types.ts'
import { isDeriveBinding, partOf, propValues, target } from './shared.ts'
import {
  ELEMENT_ATTRIBUTES,
  GLOBAL_ATTRIBUTES,
  IDREF_ARIA,
  INTERACTIVE_ELEMENTS,
  INTERACTIVE_ROLES,
  NAMED_PATTERNS,
  Z_INDEX_KEYS
} from './tables.ts'

/** Both built-in phases; structural rules hold before and after enhancement. */
const BOTH = ['authored', 'resolved'] as const

/** Flags native attributes the rendered element does not accept. */
function checkHtmlAttrs(context: IRuleContext<unknown>): void {
  /** Node under check. */
  const { node, address } = target(context)
  /** Element the part renders; parts without semantics render a div. */
  const element = partOf(context, node)?.behavior?.semantics?.element ?? 'div'
  /** Element-specific allowances. */
  const specific = ELEMENT_ATTRIBUTES.get(element)
  for (const name of Object.keys(node.facets?.attrs ?? {}))
    if (!GLOBAL_ATTRIBUTES.has(name) && !specific?.has(name))
      context.report({
        address,
        facet: 'attrs',
        path: name,
        messageKey: 'html.attr-allowed',
        basis: 'HTML'
      })
}

/** Flags aria id-reference values that point at no address in the blueprint. */
function checkIdRefs(context: IRuleContext<unknown>): void {
  for (const entry of context.index.entries())
    for (const [name, value] of Object.entries(entry.node.facets?.aria ?? {})) {
      if (!IDREF_ARIA.has(name) || typeof value !== 'string') continue
      for (const reference of value.split(/\s+/).filter(Boolean))
        if (!referenceExists(context, reference))
          context.report({
            address: entry.address,
            facet: 'aria',
            path: name,
            messageKey: 'aria.idref-exists',
            basis: 'ARIA'
          })
    }
}

/** True when a reference parses as an address and the index holds its static node. */
function referenceExists(context: IRuleContext<unknown>, reference: string): boolean {
  try {
    return context.index.get(parseAddress(reference).segments.join('/')) !== undefined
  } catch {
    return false
  }
}

/** Requires an accessible name on parts that claim a pattern needing one. */
function checkRequiredAria(context: IRuleContext<unknown>): void {
  /** Node under check. */
  const { node, address } = target(context)
  /** Part descriptor of the node. */
  const descriptor = partOf(context, node)
  /** Pattern the part claims. */
  const pattern = descriptor?.behavior?.semantics?.pattern
  if (pattern === undefined || !NAMED_PATTERNS.has(pattern)) return
  /** Facets of the node. */
  const facets = node.facets ?? {}
  /** Aria derivations of the definition. */
  const derived = descriptor?.behavior?.aria ?? {}
  if (
    facets.aria?.label !== undefined ||
    facets.aria?.labelledby !== undefined ||
    facets.props?.label !== undefined ||
    derived.label !== undefined ||
    derived.labelledby !== undefined ||
    context.provided(node, 'aria.label') ||
    context.provided(node, 'props.label')
  )
    return
  context.report({
    address,
    facet: 'aria',
    path: 'label',
    messageKey: 'aria.required-props',
    basis: `APG ${pattern}`
  })
}

/** Checks slot members against the declaration's accepted part names. */
function checkSlotAccepts(context: IRuleContext<unknown>): void {
  /** Node under check. */
  const { node, address } = target(context)
  /** Slot declarations of the part. */
  const declarations = partOf(context, node)?.slots ?? {}
  for (const [slot, members] of Object.entries(node.facets?.slots ?? {})) {
    /** Accepted part names for the slot. */
    const accepts = declarations[slot]?.accepts
    if (accepts === undefined) continue
    for (const member of members)
      if (!accepts.includes(tagSegmentName(member.tag)))
        context.report({ address, facet: 'slots', path: slot, messageKey: 'slot.accepts' })
  }
}

/** Checks slot member counts against the declaration's maximum. */
function checkSlotMax(context: IRuleContext<unknown>): void {
  /** Node under check. */
  const { node, address } = target(context)
  /** Slot declarations of the part. */
  const declarations = partOf(context, node)?.slots ?? {}
  for (const [slot, members] of Object.entries(node.facets?.slots ?? {})) {
    /** Maximum member count for the slot. */
    const max = declarations[slot]?.max
    if (max !== undefined && members.length > max)
      context.report({ address, facet: 'slots', path: slot, messageKey: 'slot.max' })
  }
}

/** Rejects interactive members in slots declared non-interactive. */
function checkSlotInteractive(context: IRuleContext<unknown>): void {
  /** Node under check. */
  const { node, address } = target(context)
  /** Slot declarations of the part. */
  const declarations = partOf(context, node)?.slots ?? {}
  for (const [slot, members] of Object.entries(node.facets?.slots ?? {})) {
    if (declarations[slot]?.interactive !== false) continue
    for (const member of members) {
      /** Semantics of the member's definition. */
      const semantics = partOf(context, member)?.behavior?.semantics
      if (
        (semantics?.role !== undefined && INTERACTIVE_ROLES.has(semantics.role)) ||
        (semantics?.element !== undefined && INTERACTIVE_ELEMENTS.has(semantics.element))
      )
        context.report({ address, facet: 'slots', path: slot, messageKey: 'slot.non-interactive' })
    }
  }
}

/** Every `name@major` a node references: its tag and the derives its props bind. */
function referencesOf(
  context: IRuleContext<unknown>
): readonly { readonly id: string; readonly facet: string; readonly path: string }[] {
  /** Node under check. */
  const { node } = target(context)
  /** Collected references; the tag comes first. */
  const references = [{ id: node.tag, facet: 'tag', path: '' }]
  for (const { path, value } of propValues(node))
    if (isDeriveBinding(value)) references.push({ id: value.$derive, facet: 'props', path })
  return references
}

/** Classifies a reference: present, missing name, or missing major. */
function referenceState(context: IRuleContext<unknown>, id: string): 'present' | 'name' | 'major' {
  if (context.catalog.get(id) !== undefined) return 'present'
  if (!isDescriptorId(id)) return 'name'
  return context.catalog.majors(splitDescriptorId(id).name).length === 0 ? 'name' : 'major'
}

/** Reports references whose name has no available major at all. */
function checkCatalogId(context: IRuleContext<unknown>): void {
  for (const reference of referencesOf(context))
    if (referenceState(context, reference.id) === 'name')
      context.report({
        address: context.address as string,
        facet: reference.facet,
        path: reference.path,
        messageKey: 'catalog.id-exists'
      })
}

/** Reports references whose name exists but whose requested major does not. */
function checkCatalogMajor(context: IRuleContext<unknown>): void {
  for (const reference of referencesOf(context))
    if (referenceState(context, reference.id) === 'major')
      context.report({
        address: context.address as string,
        facet: reference.facet,
        path: reference.path,
        messageKey: 'catalog.major-exists'
      })
}

/** Value patterns per style hook type. The type union has five members, a fixed bound. */
const HOOK_PATTERNS: Readonly<Record<IStyleHookType, RegExp>> = {
  color: /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\([0-9.,%\s/-]+\)|var\(--[A-Za-z0-9-]+\))$/,
  length: /^(0|-?\d+(\.\d+)?(px|rem|em|%|vh|vw|ch)|var\(--[A-Za-z0-9-]+\))$/,
  token: /^var\(--[A-Za-z0-9-]+\)$/,
  number: /^-?\d+(\.\d+)?$/,
  string: /^[^;{}<>]*$/
}

/** Checks blueprint style values against the part's declared hooks and their types. */
function checkStyleHooks(context: IRuleContext<unknown>): void {
  /** Node under check. */
  const { node, address } = target(context)
  /** Declared hooks of the part. */
  const hooks = partOf(context, node)?.styleHooks ?? {}
  for (const [name, value] of Object.entries(node.facets?.style ?? {})) {
    if (Z_INDEX_KEYS.has(name)) continue
    /** Declared type of the hook, if declared. */
    const type = hooks[name]
    if (type === undefined || !HOOK_PATTERNS[type].test(String(value)))
      context.report({ address, facet: 'style', path: name, messageKey: 'style.hook-type' })
  }
}

/** HTML, aria, slot, catalog and style rules; nine rules in total. */
export const structureRules = [
  defineRule({
    id: 'html.attr-allowed',
    scope: 'part',
    phase: BOTH,
    severity: 'error',
    check: checkHtmlAttrs
  }),
  defineRule({
    id: 'aria.idref-exists',
    scope: 'blueprint',
    phase: BOTH,
    severity: 'error',
    check: checkIdRefs
  }),
  defineRule({
    id: 'aria.required-props',
    scope: 'part',
    phase: BOTH,
    severity: 'error',
    check: checkRequiredAria
  }),
  defineRule({
    id: 'slot.accepts',
    scope: 'part',
    phase: BOTH,
    severity: 'error',
    check: checkSlotAccepts
  }),
  defineRule({
    id: 'slot.max',
    scope: 'part',
    phase: BOTH,
    severity: 'error',
    check: checkSlotMax
  }),
  defineRule({
    id: 'slot.non-interactive',
    scope: 'part',
    phase: BOTH,
    severity: 'error',
    check: checkSlotInteractive
  }),
  defineRule({
    id: 'catalog.id-exists',
    scope: 'part',
    phase: BOTH,
    severity: 'error',
    check: checkCatalogId
  }),
  defineRule({
    id: 'catalog.major-exists',
    scope: 'part',
    phase: BOTH,
    severity: 'error',
    check: checkCatalogMajor
  }),
  defineRule({
    id: 'style.hook-type',
    scope: 'part',
    phase: BOTH,
    severity: 'error',
    check: checkStyleHooks
  })
]
