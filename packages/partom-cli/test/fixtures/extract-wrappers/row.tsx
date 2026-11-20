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

/** Context object; not a component and not extracted. */
declare function createContext<T>(value: T): { value: T }
export const RowContext = createContext({})
