import type { IRpcFlowContext } from '@migaia/rpc-contract/interfaces'
import type { IRpcPortableValue } from '@migaia/rpc-contract/protocol'

/** Map synchronously to an error or diagnostic value; returning a Promise is unsupported. */
export type IRpcErrorMap = (
  error: unknown,
  context: IRpcFlowContext
) => Error | IRpcPortableValue | undefined
