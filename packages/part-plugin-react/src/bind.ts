import type { IPartDefinition, IPartImplementation } from '@migaia/part-host'
import type { JSXElementConstructor } from 'react'

/** Renderer name under which React bindings are stored in the catalog. */
export const REACT_RENDERER = 'react'

/** How part configuration maps onto a component's props. */
export type IReactMapping<TPartProps, TComponentProps> = {
  readonly props?: { readonly [K in keyof TPartProps]?: keyof TComponentProps }
  readonly slots?: Readonly<Record<string, 'children' | keyof TComponentProps>>
  readonly events?: Readonly<Record<string, keyof TComponentProps>>
  readonly element?: 'ref' | 'query'
}

/** Binding stored as the opaque value of a React implementation entry. */
export type IReactBinding = {
  readonly component: JSXElementConstructor<Record<string, unknown>>
  readonly mapping: IReactMapping<Record<string, unknown>, Record<string, unknown>>
}

/**
 * Binds a part definition to a React component, including `memo`, `forwardRef` and `lazy` results.
 * The result goes into a part plugin's `implementations`; the catalog keeps the binding object as
 * is, so identities survive.
 */
export function bindReactComponent<TPartProps, TComponentProps>(
  part: IPartDefinition<TPartProps>,
  component: JSXElementConstructor<TComponentProps>,
  mapping: IReactMapping<TPartProps, TComponentProps> = {}
): IPartImplementation {
  /** Binding value with erased generics for storage. */
  const value: IReactBinding = {
    component: component as unknown as JSXElementConstructor<Record<string, unknown>>,
    mapping: mapping as IReactBinding['mapping']
  }
  return { renderer: REACT_RENDERER, partId: part.descriptor.id, value }
}
