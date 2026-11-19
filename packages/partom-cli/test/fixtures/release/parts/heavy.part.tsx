import { definePart } from '@migaia/part-host'
import { bindReactComponent } from '@migaia/part-plugin-react'
import type { ReactNode } from 'react'

/** Records that this module was evaluated. */
;((globalThis as { partomLoads?: string[] }).partomLoads ??= []).push('heavy')

/** Panel with a long text, so its bundle exceeds the tight budget. */
function Heavy(): ReactNode {
  return <p>{'This panel carries enough text to exceed a ten byte budget.'}</p>
}

/** Heavy part with a size budget its bundle cannot meet. */
export const heavy = definePart({ id: 'heavy@1', budget: { size: 10 } })

/** React binding of the heavy part. */
export const heavyBinding = bindReactComponent(heavy, Heavy)
