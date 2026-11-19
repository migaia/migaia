import { definePart, definePartPlugin } from '@migaia/part-host'
import { bindReactComponent } from '@migaia/part-plugin-react'
import type { ReactNode, Ref } from 'react'

/** Plain container. */
function Box(props: {
  readonly ref?: Ref<HTMLDivElement>
  readonly children?: ReactNode
}): ReactNode {
  return <div ref={props.ref}>{props.children}</div>
}

/** Part that busy-waits 50ms while rendering. */
function Slow(props: { readonly ref?: Ref<HTMLDivElement> }): ReactNode {
  /** End of the busy wait. */
  const until = performance.now() + 50
  while (performance.now() < until) {
    // Busy wait so the render takes measurable time.
  }
  return <div ref={props.ref}>slow</div>
}

/** Parts: an unbudgeted page, a fast part with a loose budget and a slow part with a tight one. */
const page = definePart({ id: 'page@1' })
const fast = definePart({ id: 'fast@1', budget: { render: 1000 } })
const slow = definePart({ id: 'slow@1', budget: { render: 5 } })

/** Fixture plugin with the React bindings. */
export const budgetPlugin = definePartPlugin({
  name: 'budget-fixtures',
  parts: [page, fast, slow],
  implementations: [
    bindReactComponent(page, Box),
    bindReactComponent(fast, Box),
    bindReactComponent(slow, Slow)
  ]
})
