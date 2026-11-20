import { memo, type ReactNode } from 'react'

/** Theme wrapper configured as transparent. */
declare function withTheme<T>(component: T): T

/** Card body. */
function CardBase(props: { title?: string }): ReactNode {
  return <section>{props.title}</section>
}

export const Card = withTheme(memo(CardBase))
