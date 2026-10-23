import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import { defineFeaturePlugin } from '../plugin/define.js'
import type { IRpcFeaturePlugin } from '../plugin/types.js'
import type { IRpcHostFeatureContext } from '../host/types.js'
import type { IRuntimePeerDescription } from '@migaia/rpc-contract/runtime'
import { renderPeerDeclaration } from './typegen-render.js'
import { RpcFeatureName } from './text.js'

/** The caller owns actual file I/O; this feature receives no directory or native filesystem access. */
export type ITypegenOutput = Readonly<{
  /** Write one safe local filename and declaration text; failures are reported by the host. */
  write(fileName: string, text: string): void | PromiseLike<void>
}>

/** Generation is opt-in and has no effect outside an installed native plugin lifetime. */
export type ITypegenFeatureOptions = Readonly<{ out: ITypegenOutput }>

/** Subscribe before reading current accepted directories, using the native plugin cleanup receipt. */
function installTypegen(context: IRpcHostFeatureContext, out: ITypegenOutput): void {
  /** Cleanup can occur during a reentrant output callback and must prevent later snapshot writes. */
  let closed = false
  /** Only already-accepted wire descriptions enter the pure renderer. */
  const write = (description: IRuntimePeerDescription): void => {
    if (closed) return
    try {
      /** No peer-derived path or source configuration reaches the caller's write capability. */
      const declaration = renderPeerDeclaration(description)
      /** The canonical thenable observer reports rejected writes without retaining another queue. */
      const result = out.write(declaration.fileName, declaration.text)
      observeThenableRejection(result, inspectThenable(result), context.report)
    } catch (error) {
      context.report(error)
    }
  }
  /** The directory owner supplies an exact listener receipt rather than a second directory cache. */
  const unsubscribe = context.directories.onAccepted(write)
  context.onDispose(() => {
    closed = true
    unsubscribe()
  })
  for (const description of context.directories.current()) write(description)
}

/** Generate declarations for every language from the same canonical accepted peer directory. */
export const typegenFeature: (options: ITypegenFeatureOptions) => IRpcFeaturePlugin =
  /* @__PURE__ */ defineFeaturePlugin((options: ITypegenFeatureOptions) => ({
    name: RpcFeatureName.typegen,
    setup: (context) => installTypegen(context, options.out)
  }))

export default typegenFeature
