import { normalizePortable } from './normalize.js'
import { invalidRpcStream } from './stream-error.js'
import { RpcStreamViolation } from './stream-constants.js'
import type { IRpcPortableValue } from './types.js'
import type { IRpcStreamPayload } from './v1/stream.js'

/** Successful cold loading stores only the original canonical parser function. */
type IRpcStreamParser = typeof import('./v1/stream.js').normalizeStreamPayload
/** A loaded parser preserves the original synchronous validation path on later stream work. */
let parser: IRpcStreamParser | undefined
/** One module load is shared across current callers without retaining endpoint or iterator state. */
let loading: Promise<IRpcStreamParser> | undefined

/** Explicit full-parser imports register that exact implementation without loading another module. */
export function registerRpcStreamParser(loaded: IRpcStreamParser): void {
  parser = loaded
}

/** Load the canonical parser in an existing async continuation, preserving the cause on rejection. */
export function loadRpcStreamParser(): Promise<IRpcStreamParser> {
  if (loading) return loading
  loading = import('./v1/stream.js').then(
    (module) => {
      parser = module.normalizeStreamPayload
      return parser
    },
    (cause) => {
      loading = undefined
      throw invalidRpcStream(RpcStreamViolation.field, '', cause)
    }
  )
  return loading
}

/** An actual stream decode can yield for cold loading; scalar callers never invoke this function. */
export function normalizeStreamPayloadLazy(
  value: unknown,
  portable: (value: unknown) => IRpcPortableValue = normalizePortable
): IRpcStreamPayload | Promise<IRpcStreamPayload> {
  if (parser) return parser(value, portable)
  return loadRpcStreamParser().then((loaded) => loaded(value, portable))
}
