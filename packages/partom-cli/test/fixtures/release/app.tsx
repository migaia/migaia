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

/** Plain button. */
function Button(props: {
  readonly ref?: Ref<HTMLButtonElement>
  readonly label?: string
}): ReactNode {
  return <button ref={props.ref}>{props.label}</button>
}

/** Page part. */
const page = definePart({ id: 'page@1' })
/** Button part with a click event. */
const button = definePart({ id: 'button@1', events: { click: { kind: 'dom' } } })

/** Local application plugin. */
export const appPlugin = definePartPlugin({
  name: 'release-app',
  parts: [page, button],
  implementations: [bindReactComponent(page, Box), bindReactComponent(button, Button)]
})
