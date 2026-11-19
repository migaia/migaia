import { definePart } from '@migaia/part-host'
import { bindReactComponent } from '@migaia/part-plugin-react'
import type { ReactNode } from 'react'

/** Records that this module was evaluated, so tests can see when the chunk loads. */
;((globalThis as { partomLoads?: string[] }).partomLoads ??= []).push('card')

/** Card with a title. */
function Card(props: { readonly title?: string }): ReactNode {
  return <section className="card">{props.title}</section>
}

/** Card part with a loose size budget. */
export const card = definePart({ id: 'card@1', budget: { size: 100000 } })

/** React binding of the card. */
export const cardBinding = bindReactComponent(card, Card)
