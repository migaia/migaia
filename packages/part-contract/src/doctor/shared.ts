import { isResourceBinding } from '../data.ts'
import type { IRuleContext } from '../rules.ts'
import type { IDescriptor, IPartNode } from '../types.ts'

/** Binding object referencing a scope state path. */
export type IStateBinding = { readonly $state: string }
/** Binding object referencing a derive by id. */
export type IDeriveBinding = { readonly $derive: string }

/** True when a facet value is a state binding. */
export function isStateBinding(value: unknown): value is IStateBinding {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { $state?: unknown }).$state === 'string'
  )
}

/** True when a facet value is a derive binding. */
export function isDeriveBinding(value: unknown): value is IDeriveBinding {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { $derive?: unknown }).$derive === 'string'
  )
}

/** Part descriptor of a node, when the catalog has one of kind `part`. */
export function partOf(context: IRuleContext<unknown>, node: IPartNode): IDescriptor | undefined {
  /** Descriptor registered under the node's tag. */
  const descriptor = context.catalog.get(node.tag)
  return descriptor?.kind === 'part' ? descriptor : undefined
}

/** Node and address of a part-scope rule call; part rules always receive both. */
export function target(context: IRuleContext<unknown>): {
  readonly node: IPartNode
  readonly address: string
} {
  return { node: context.node as IPartNode, address: context.address as string }
}

/** One value of a node's props, with its path inside `props`. */
export type IPropValue = { readonly path: string; readonly value: unknown }

/**
 * Every props value a binding rule inspects: each top-level prop, plus each parameter of a `{
 * $resource }` binding (path `<prop>.params.<name>`). One nesting level only, so the work is linear
 * in the node's props and parameters.
 */
export function propValues(node: IPartNode): IPropValue[] {
  /** Collected values. */
  const values: IPropValue[] = []
  for (const [key, value] of Object.entries(node.facets?.props ?? {})) {
    values.push({ path: key, value })
    if (isResourceBinding(value))
      for (const [name, param] of Object.entries(value.params ?? {}))
        values.push({ path: `${key}.params.${name}`, value: param })
  }
  return values
}
