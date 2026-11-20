import type { ReactNode } from 'react'

/** Store connector, opaque to extraction. */
declare function connect(map: unknown): <T>(component: T) => T

/** Row body. */
function RowBase(props: { id?: string }): ReactNode {
  return <div>{props.id}</div>
}

/** State mapper. */
const map = (state: unknown) => state

export const Row = connect(map)(RowBase)
