import { RpcError, RpcCoreErrorCode } from '../../../dist/core/errors.js'
import { RpcCoreErrorText } from '../../../dist/core/error-text.js'

/** Actual child business invocations remain independent of caller-side request counts. */
let effects = 0
/** This fixture pauses exactly one original provider, without replacing admission or cancellation. */
let release

/** Shared business routes run unchanged in every real process and Worker carrier. */
export const provide = {
  value: () => ++effects,
  fail: () => {
    throw new RpcError(
      RpcCoreErrorCode.capabilityUnsupported,
      RpcCoreErrorText.capabilityUnsupported
    )
  },
  hold: async () => {
    effects++
    await new Promise((resolve) => {
      release = resolve
    })
    return 42
  },
  release: () => {
    release?.()
    return 7
  },
  count: () => effects,
  values: async function* (_payload, context) {
    effects++
    yield { value: 1, caller: context.callerGeneration, target: context.targetGeneration }
    yield { value: 2 }
    return { final: 99, aborted: context.signal.aborted }
  }
}

/** Retain complete public failure classification while keeping bootstrap and token values private. */
export function report(error) {
  console.error(
    JSON.stringify({
      source: error?.source,
      code: error?.code,
      name: error?.name,
      message: String(error?.message ?? '').slice(0, 160)
    })
  )
}
