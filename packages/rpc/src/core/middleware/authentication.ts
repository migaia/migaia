import { RpcAuthenticationError, RpcError, RpcCoreErrorCode } from '../errors.js'
import { RpcPortName } from '../internal/plugin-shared-keys.js'
import { freezePlugin } from '../internal/plugin-descriptor.js'
import type {
  IRpcAuthenticationCapability,
  IRpcAuthenticationConfig,
  IRpcAuthenticationTransform,
  IRpcPlugin
} from '../typing.js'

/** Installs optional per-frame encryption and signing transforms. */
export const authentication = (config: IRpcAuthenticationConfig): IRpcPlugin => {
  const plugin: IRpcPlugin = {
    name: 'authentication',
    metadata: {
      claims: {
        routes: [],
        provides: [],
        consumes: [],
        publicKeys: [],
        exposedKeys: [],
        activator: false
      },
      sharedProvides: [RpcPortName.authentication]
    },
    install: () => ({
      extension: {},
      ports: { [RpcPortName.authentication]: createAuthenticationCapability(config) }
    })
  }
  return freezePlugin(plugin)
}

/** Validates one immutable authentication snapshot and creates its complete typed port. */
function createAuthenticationCapability(
  config: IRpcAuthenticationConfig
): IRpcAuthenticationCapability {
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw new RpcError(RpcCoreErrorCode.invalidConfig, 'authentication descriptor is invalid')
  let encrypt: IRpcAuthenticationTransform | undefined
  let decrypt: IRpcAuthenticationTransform | undefined
  let sign: IRpcAuthenticationTransform | undefined
  let verify: IRpcAuthenticationTransform | undefined
  let encodedType: IRpcAuthenticationConfig['encodedType']
  try {
    ;({ encrypt, decrypt, sign, verify, encodedType } = config)
  } catch (error) {
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      'authentication descriptor is unreadable',
      error
    )
  }
  for (const [name, transform] of Object.entries({ encrypt, decrypt, sign, verify }))
    if (transform !== undefined && typeof transform !== 'function')
      throw new RpcError(
        RpcCoreErrorCode.invalidConfig,
        `authentication.${name} must be a function`
      )
  if (!!encrypt !== !!decrypt)
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      'authentication encrypt/decrypt must be configured together'
    )
  if (!!sign !== !!verify)
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      'authentication sign/verify must be configured together'
    )
  if (!encrypt && !sign)
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      'authentication requires encryption or signing transforms'
    )
  if (encodedType !== undefined && !['any', 'string', 'uint8array'].includes(encodedType))
    throw new RpcError(RpcCoreErrorCode.invalidConfig, 'authentication.encodedType is invalid')

  /** Runs outbound encryption before signing. */
  const protect: IRpcAuthenticationTransform = async (value, context) => {
    try {
      const encrypted = encrypt ? await encrypt(value, context) : value
      return sign ? await sign(encrypted, context) : encrypted
    } catch (error) {
      if (error instanceof RpcAuthenticationError) throw error
      throw new RpcAuthenticationError('Outbound frame authentication failed', error)
    }
  }
  /** Runs inbound verification before decryption. */
  const unprotect: IRpcAuthenticationTransform = async (value, context) => {
    try {
      const verified = verify ? await verify(value, context) : value
      return decrypt ? await decrypt(verified, context) : verified
    } catch (error) {
      if (error instanceof RpcAuthenticationError) throw error
      throw new RpcAuthenticationError('Inbound frame authentication failed', error)
    }
  }
  return Object.freeze({
    enabled: true,
    encodedType: encodedType ?? 'any',
    protect,
    unprotect
  })
}
