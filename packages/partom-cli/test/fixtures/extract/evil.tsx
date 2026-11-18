import { cva } from 'class-variance-authority'
import type { ReactNode } from 'react'

/** Variants whose names try to break out of generated code. */
const evilVariants = cva('x', {
  variants: { tone: { '"}; process.exit(9); ({"': 'a', calm: 'b' } }
})

/** Props with a key that is not an identifier. */
type IEvilProps = { readonly 'a-b'?: string; readonly tone?: string }

/** Component exercising the extraction safety rules. */
export function Evil(props: IEvilProps): ReactNode {
  return <span className={evilVariants({ tone: props.tone as 'calm' })} />
}
