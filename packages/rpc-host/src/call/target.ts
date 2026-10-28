/** Copy accepted identity and native IO ports once for every ordinary or pooled operation. */
import type { IRpcSessionSelection } from '@migaia/rpc-contract/interfaces'
import type { ICallTargetRef } from './types.ts'

/** Held capabilities keep their exact generation while media state stays in its native owner. */
export function callTarget(selection: IRpcSessionSelection): ICallTargetRef {
  return Object.freeze({
    namespace: selection.view.namespace,
    carrierId: selection.carrierId,
    peerId: selection.view.peerId,
    name: selection.view.name,
    generation: Object.freeze({ ...selection.view.generation }),
    callTimeoutCap: selection.view.callTimeoutCap,
    ...(selection.source === undefined ? {} : { source: selection.source }),
    ...(selection.origin === undefined ? {} : { origin: selection.origin })
  })
}
