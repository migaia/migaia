/** Observe accepted directories and render inert declarations through the caller's output port. */
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import type { IRpcObservation, IRpcSessionView } from '@migaia/rpc-contract/interfaces'
import { defineFlowPlugin } from '../../sdk/define.ts'
import type { IRpcFlowPlugin } from '../../sdk/types.ts'
import { HostObservationKind } from '../../host/state-constants.ts'
import { RpcTypegenName } from './text.ts'
import { renderPeerDeclaration } from './render.ts'

/** Actual file I/O belongs to the caller; peer strings never become paths or native handles. */
export type ITypegenOutput = Readonly<{
  write(fileName: string, text: string): void | PromiseLike<void>
}>
/** One reusable host-level observer definition never shares live installation state. */
export type ITypegenOptions = Readonly<{
  out: ITypegenOutput
}>

/** One installed observer owns only its output port and terminal guard. */
class TypegenObserver {
  /** The application supplies the sole write capability. */
  readonly #out: ITypegenOutput
  /** Failed synchronous and asynchronous writes retain their original diagnostic destination. */
  readonly #report: (error: unknown) => void
  /** Reentrant disposal prevents any later observation from writing another declaration. */
  #closed = false

  /** Capture explicit collaborators for one native installation. */
  constructor(out: ITypegenOutput, report: (error: unknown) => void) {
    this.#out = out
    this.#report = report
  }

  /** Only actual accepted handshakes trigger generation; directory refresh is not another accept. */
  readonly observe = (event: IRpcObservation): void => {
    if (this.#closed || event.kind !== HostObservationKind.peerReady) return
    try {
      /**
       * Host observation supplies accepted readonly metadata, without giving this plugin Session
       * IO.
       */
      const view = event.data as IRpcSessionView
      /** The renderer consumes only this output-sized projection of the accepted method Map. */
      const declaration = renderPeerDeclaration({
        self: { name: view.name },
        methods: [...view.methods.values()]
      })
      /** The canonical observer catches hostile thenable access and reports the original rejection. */
      const result = this.#out.write(declaration.fileName, declaration.text)
      observeThenableRejection(result, inspectThenable(result), this.#report)
    } catch (error) {
      this.#report(error)
    }
  }

  /** Native rollback and disposal both retire this exact installed observer. */
  readonly dispose = (): void => {
    this.#closed = true
  }
}

/** Generate declarations from canonical accepted directories observed by this host installation. */
export function typegen(options: ITypegenOptions): IRpcFlowPlugin {
  return defineFlowPlugin({
    name: RpcTypegenName,
    setup(context) {
      /** Every receiving host gets an independent observer and exact disposal receipt. */
      const observer = new TypegenObserver(options.out, context.report)
      return { observe: observer.observe, dispose: observer.dispose }
    }
  })
}

export default typegen
