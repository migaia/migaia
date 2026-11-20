import type { ReactNode, Ref } from 'react'

/** Component loaded through `lazy`; receives `ref` as a prop. */
export default function LazyTarget(props: { readonly ref?: Ref<HTMLDivElement> }): ReactNode {
  return <div ref={props.ref}>lazy</div>
}
