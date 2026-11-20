import * as React from 'react'
import { cva } from 'class-variance-authority'

/** Tag variants. */
const tagVariants = cva('tag', {
  variants: { tone: { neutral: 'n', danger: 'd' } },
  defaultVariants: { tone: 'neutral' }
})

export const Tag = React.memo(
  React.forwardRef(
    (props: { tone?: 'neutral' | 'danger'; text?: string }, ref: React.Ref<HTMLSpanElement>) => (
      <span ref={ref} className={tagVariants({ tone: props.tone })}>
        {props.text}
      </span>
    )
  )
)
