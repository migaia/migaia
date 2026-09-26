import { WebRpcConfigurationError, WebRpcError, WebRpcErrorCode } from '../errors.js'
import type { IWebRpcUuidConfig, IWebRpcUuidContext } from '../typing.js'

/** Stable diagnostic for a UUID descriptor whose generator property cannot be read. */
const UUID_GENERATOR_UNREADABLE = 'UUID generator configuration is unreadable'

/** Stable diagnostic for a UUID descriptor whose generator is not callable. */
const UUID_GENERATOR_NOT_CALLABLE = 'UUID generator must be a function'

/** Stable diagnostic for a UUID generator that throws while producing an identifier. */
const UUID_GENERATOR_FAILED = 'UUID generator invocation failed'

/** Allocates collision-checked wire identifiers for one endpoint. */
export function allocateRpcId(
  config: IWebRpcUuidConfig,
  variation: IWebRpcUuidContext['variation'],
  senderId: string,
  targetId: string,
  isUsed: (id: string) => boolean
): string {
  /** Cached generator value; caching closes the validation/invocation getter race. */
  let generate: IWebRpcUuidConfig['generate']
  try {
    // Read once so a mutable or hostile descriptor cannot change the generator between
    // validation and invocation.
    generate = config.generate
  } catch (error) {
    throw new WebRpcConfigurationError(UUID_GENERATOR_UNREADABLE, error)
  }
  if (generate !== undefined && typeof generate !== 'function')
    throw new WebRpcConfigurationError(UUID_GENERATOR_NOT_CALLABLE)
  let generated: string
  if (generate === undefined) {
    generated = defaultRpcId()
  } else {
    try {
      // Keep the cached callable invocation unchanged: the generator contract is receiver-free.
      generated = generate({ variation, senderId, targetId })
    } catch (error) {
      throw new WebRpcConfigurationError(UUID_GENERATOR_FAILED, error)
    }
  }
  if (typeof generated !== 'string' || generated.length === 0)
    throw new WebRpcError(
      WebRpcErrorCode.invalidConfig,
      'UUID generator must return a non-empty string'
    )
  const id = `${variation.toUpperCase()}:${senderId}:${generated}`
  if (isUsed(id)) throw new WebRpcError(WebRpcErrorCode.invalidConfig, `UUID conflict: ${id}`)
  return id
}

/** Generates a cryptographically random fallback identifier. */
function defaultRpcId(): string {
  const cryptoApi = globalThis.crypto as
    | { randomUUID?: () => string; getRandomValues?: (array: Uint8Array) => Uint8Array }
    | undefined
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID()
  if (cryptoApi?.getRandomValues) {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16))
    return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
  }
  throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'UUID unavailable')
}
