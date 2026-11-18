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
