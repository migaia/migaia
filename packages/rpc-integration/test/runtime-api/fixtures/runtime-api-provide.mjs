import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RPC_CORE_ERROR_SOURCE } from '@migaia/rpc-host'
import { attachErrorIdentity } from '@migaia/utils/error'

/** Fixture-only historical diagnostics pin existing forwarded wire values, not Core identity. */
const FixtureErrorText = {
  capabilityUnsupported: 'Runtime operation capability is unavailable',
  cancelled: 'Web RPC request cancelled'
}
/** Only the retained wire vectors own these diagnostic names; they do not mint live Core families. */
const FixtureErrorFamily = { rpc: 'RpcError', abort: 'AbortError' }

/**
 * Create only a native diagnostic Error; no Core factory or private operation identity is used.
 *
 * @param {string} code Historical fixture wire code.
 * @param {string} name Historical fixture native family name.
 * @param {string} message Fixture-owned diagnostic wording.
 * @param {unknown} [cause] Original diagnostic cause retained for forwarding assertions.
 * @returns {Error} The native Error with public fields, without Core's private decision identity.
 */
function diagnosticError(code, name, message, cause) {
  /** These fields preserve the existing fixture wire contract without minting Core's WeakMap. */
  const error = attachErrorIdentity(new Error(message, { cause }), {
    source: RPC_CORE_ERROR_SOURCE,
    code
  })
  error.name = name
  return error
}

/** Actual child business invocations remain independent of caller-side request counts. */
let effects = 0
/** This fixture pauses exactly one original provider, without replacing admission or cancellation. */
let release

/** Native signal/deadline cancellation keeps the actual handler alive until explicit release. */
let ordinarySignal,
  ordinaryRelease,
  ordinaryStarted = false,
  followed = 0
/** Portable-copy admission and transfer refusal use an independent business count. */
let binaryCalls = 0

/** Shared business routes run unchanged in every real process and Worker carrier. */
export const provide = {
  echo: (value) => {
    binaryCalls++
    return value
  },
  binaryCount: () => binaryCalls,
  holdOrdinary: async (_value, context) => {
    ordinarySignal = context.signal
    ordinaryStarted = true
    await new Promise((resolve) => {
      ordinaryRelease = resolve
    })
    return 42
  },
  ordinaryState: () => ({
    started: ordinaryStarted,
    aborted: ordinarySignal?.aborted ?? false,
    followed
  }),
  ordinaryRelease: () => {
    ordinaryRelease?.()
    ordinaryStarted = false
    return 7
  },
  follower: () => ++followed,

  value: () => ++effects,
  fail: () => {
    throw diagnosticError(
      RpcCoreErrorCode.capabilityUnsupported,
      FixtureErrorFamily.rpc,
      FixtureErrorText.capabilityUnsupported
    )
  },
  cancelled: () => {
    throw diagnosticError(
      RpcCoreErrorCode.cancelled,
      FixtureErrorFamily.abort,
      FixtureErrorText.cancelled,
      diagnosticError(
        RpcCoreErrorCode.capabilityUnsupported,
        FixtureErrorFamily.rpc,
        FixtureErrorText.capabilityUnsupported
      )
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
