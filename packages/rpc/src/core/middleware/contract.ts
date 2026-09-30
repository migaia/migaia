import { RpcMiddlewareErrorText } from './error-text.js'
import { validateContractData } from '../internal/contract.js'
import type {
  IRpcContractCapability,
  IRpcContractConfig,
  IRpcMethodSchema,
  IRpcSchema,
  IRpcPlugin,
  IRpcPluginInstallResult,
  IRpcPluginMetadata
} from '../typing.js'
import { RpcError, RpcCoreErrorCode } from '../errors.js'
import { createSafeRecord, safeRead } from '../internal/safe-value.js'
import { RpcPortName } from '../internal/plugin-shared-keys.js'

const contractClaims = {
  routes: [],
  provides: [],
  consumes: [],
  publicKeys: [],
  exposedKeys: [],
  activator: false
}

/** Normalizes contract configuration and snapshots schema ownership without registry writes. */
function createContractCapability(config: IRpcContractConfig): IRpcContractCapability {
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcMiddlewareErrorText.contractDescriptorIsInvalid
    )
  let version: IRpcContractConfig['version']
  let acceptVersions: IRpcContractConfig['acceptVersions']
  let maxIdentifierLength: IRpcContractConfig['maxIdentifierLength']
  try {
    version = config.version
    acceptVersions = config.acceptVersions
    maxIdentifierLength = config.maxIdentifierLength
  } catch (error) {
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcMiddlewareErrorText.contractDescriptorIsUnreadable,
      error
    )
  }
  let schemas: Record<string, IRpcMethodSchema> | undefined
  try {
    const source = safeRead<unknown>(config, 'schemas')
    if (source !== undefined) {
      if (!source || typeof source !== 'object' || Array.isArray(source))
        throw new RpcError(
          RpcCoreErrorCode.invalidConfig,
          RpcMiddlewareErrorText.schemasMustBeAnObject
        )
      schemas = createSafeRecord<IRpcMethodSchema>() as Record<string, IRpcMethodSchema>
      for (const method of Object.keys(source)) {
        const methodSchema = safeRead<unknown>(source, method)
        const params = safeRead<unknown>(methodSchema, 'params')
        const result = safeRead<unknown>(methodSchema, 'result')
        const isSchema = (value: unknown): value is IRpcSchema =>
          Boolean(value) &&
          typeof value === 'object' &&
          typeof safeRead<unknown>(value, 'parse') === 'function'
        if (!isSchema(params) || !isSchema(result))
          throw new RpcError(
            RpcCoreErrorCode.invalidConfig,
            RpcMiddlewareErrorText.schemaDescriptorInvalid(method)
          )
        schemas[method] = { params, result }
      }
    }
  } catch (error) {
    if (error instanceof RpcError) throw error
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcMiddlewareErrorText.contractSchemasMustContainParamsResultSchemasWithParseFunctions,
      error
    )
  }
  try {
    if (
      acceptVersions !== undefined &&
      (!Array.isArray(acceptVersions) ||
        acceptVersions.some((item) => typeof item !== 'string' || item.length === 0))
    )
      throw new RpcError(
        RpcCoreErrorCode.invalidConfig,
        RpcMiddlewareErrorText.contractAcceptVersionsMustContainNonEmptyStrings
      )
  } catch (error) {
    if (error instanceof RpcError) throw error
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcMiddlewareErrorText.contractAcceptVersionsIsUnreadable,
      error
    )
  }
  const snapshot = {
    version,
    maxIdentifierLength,
    acceptVersions: acceptVersions ? [...acceptVersions] : undefined,
    schemas
  }
  if (version !== undefined && (!version || typeof version !== 'string'))
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcMiddlewareErrorText.contractVersionMustBeANonEmptyString
    )
  if (
    maxIdentifierLength !== undefined &&
    (!Number.isSafeInteger(maxIdentifierLength) || maxIdentifierLength <= 0)
  )
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcMiddlewareErrorText.maxIdentifierLengthMustBeAPositiveSafeInteger
    )
  return {
    ...snapshot,
    validateData: (method, side, data) => validateContractData(snapshot, method, side, data)
  }
}

const contractMetadata: IRpcPluginMetadata = Object.freeze({
  claims: contractClaims,
  sharedProvides: Object.freeze([RpcPortName.contract])
})

/** Creates the admitted contract plugin and publishes only its typed shared capability. */
export const contract = (config: IRpcContractConfig = {}): IRpcPlugin =>
  Object.freeze({
    name: 'contract',
    metadata: contractMetadata,
    install: (): IRpcPluginInstallResult => {
      const capability = createContractCapability(config)
      return {
        extension: Object.freeze({}),
        ports: Object.freeze({ [RpcPortName.contract]: capability })
      }
    }
  })
