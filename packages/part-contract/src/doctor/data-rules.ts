/** Data-layer rules: resource bindings and the field protocol. */
import { isResourceBinding, type IResourceBinding } from '../data.ts'
import { isRecord } from '../record.ts'
import { defineRule, type IRuleContext } from '../rules.ts'
import type { IJsonSchema, IPartFacets } from '../types.ts'
import { isStateBinding, partOf, target } from './shared.ts'

/** Facet groups whose values a resource binding may wrongly appear in; fixed size five. */
const VALUE_FACETS = ['attrs', 'aria', 'data', 'style', 'props'] as const

/** One resource binding found on a node, with where it sits. */
type IFoundBinding = {
  readonly facet: string
  readonly path: string
  readonly binding: IResourceBinding
}

/**
 * Every resource binding on a node: top-level values of the value facets, and bindings nested in a
 * resource binding's parameters. Linear in the node's facet values.
 */
function bindingsOf(facets: IPartFacets | undefined): IFoundBinding[] {
  /** Collected bindings. */
  const found: IFoundBinding[] = []
  for (const facet of VALUE_FACETS) {
    for (const [key, value] of Object.entries(facets?.[facet] ?? {})) {
      if (!isResourceBinding(value)) continue
      found.push({ facet, path: key, binding: value })
      for (const [name, param] of Object.entries(value.params ?? {}))
        if (isResourceBinding(param))
          found.push({ facet, path: `${key}.params.${name}`, binding: param })
    }
  }
  return found
}

/** Reports resource bindings whose id is missing or does not name a resource. */
function checkBindTarget(context: IRuleContext<unknown>): void {
  /** Node under check. */
  const { node, address } = target(context)
  for (const found of bindingsOf(node.facets))
    if (context.catalog.get(found.binding.$resource)?.kind !== 'resource')
      context.report({
        address,
        facet: found.facet,
        path: found.path,
        messageKey: 'resource.bind-target'
      })
}

/** Reports resource bindings outside the prop the part declares in `behavior.resource.prop`. */
function checkBindProp(context: IRuleContext<unknown>): void {
  /** Node under check. */
  const { node, address } = target(context)
  /** Prop allowed to carry the binding, when the part declares one. */
  const prop = partOf(context, node)?.behavior?.resource?.prop
  for (const found of bindingsOf(node.facets))
    if (found.facet !== 'props' || found.path !== prop)
      context.report({
        address,
        facet: found.facet,
        path: found.path,
        messageKey: 'resource.bind-prop'
      })
}

/** True when a literal fits a property schema's `type` and `enum`; other keywords are not checked. */
function fitsSchema(value: unknown, schema: unknown): boolean {
  if (!isRecord(schema)) return true
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false
  /** Declared type or types; at most seven JSON types, a fixed bound. */
  const types = schema.type === undefined ? [] : [schema.type].flat()
  return types.length === 0 || types.some((type) => jsonTypeOf(value, String(type)))
}

/** True when a literal has the given JSON Schema type. */
function jsonTypeOf(value: unknown, type: string): boolean {
  if (type === 'integer') return Number.isInteger(value)
  if (type === 'null') return value === null
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return isRecord(value)
  return typeof value === type
}

/** True for any binding object a parameter may carry instead of a literal. */
function isBindingValue(value: unknown): boolean {
  return (
    isRecord(value) &&
    (typeof value.$state === 'string' ||
      typeof value.$derive === 'string' ||
      typeof value.$row === 'string')
  )
}

/**
 * Checks literal parameters of the declared resource binding against the resource's parameter
 * schema: unknown keys and literals outside `type` / `enum`. Bindings are left to runtime.
 */
function checkParams(context: IRuleContext<unknown>): void {
  /** Node under check. */
  const { node, address } = target(context)
  /** Prop carrying the binding. */
  const prop = partOf(context, node)?.behavior?.resource?.prop
  /** The binding on that prop. */
  const binding = prop === undefined ? undefined : node.facets?.props?.[prop]
  if (prop === undefined || !isResourceBinding(binding)) return
  /** Parameter schema of the resource. */
  const args: IJsonSchema | undefined = context.catalog.get(binding.$resource)?.args
  /** Declared parameter properties. */
  const properties = isRecord(args?.properties) ? args.properties : undefined
  if (properties === undefined) return
  for (const [name, value] of Object.entries(binding.params ?? {})) {
    /** Whether the key is declared and the literal fits. */
    const valid =
      Object.hasOwn(properties, name) &&
      (isBindingValue(value) || fitsSchema(value, properties[name]))
    if (!valid)
      context.report({
        address,
        facet: 'props',
        path: `${prop}.params.${name}`,
        messageKey: 'resource.params'
      })
  }
}

/** Warns when a field part's value prop is not bound to state, so it cannot be written back. */
function checkValueBound(context: IRuleContext<unknown>): void {
  /** Node under check. */
  const { node, address } = target(context)
  /** Field protocol of the part. */
  const field = partOf(context, node)?.behavior?.field
  if (field === undefined) return
  if (!isStateBinding(node.facets?.props?.[field.value]))
    context.report({ address, facet: 'props', path: field.value, messageKey: 'field.value-bound' })
}

/** Data-layer rules; four rules in total, all on authored blueprints. */
export const dataRules = [
  defineRule({
    id: 'resource.bind-target',
    scope: 'part',
    phase: ['authored'],
    severity: 'error',
    check: checkBindTarget
  }),
  defineRule({
    id: 'resource.bind-prop',
    scope: 'part',
    phase: ['authored'],
    severity: 'error',
    check: checkBindProp
  }),
  defineRule({
    id: 'resource.params',
    scope: 'part',
    phase: ['authored'],
    severity: 'error',
    check: checkParams
  }),
  defineRule({
    id: 'field.value-bound',
    scope: 'part',
    phase: ['authored'],
    severity: 'warning',
    check: checkValueBound
  })
]
