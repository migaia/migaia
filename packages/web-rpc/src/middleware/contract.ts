import { validateContractData } from '../internal/contract.js';
import { WebRpcCapabilityKey } from '../internal/runtime.js';
import type {
  IWebRpcContractCapability,
  IWebRpcContractConfig,
  IWebRpcMethodSchema,
  IWebRpcSchema,
  IWebRpcMiddleware
} from '../typing.js';
import { WebRpcError, WebRpcErrorCode } from '../errors.js';
import { createSafeRecord, safeRead } from '../internal/safe-value.js';
export const contract = (config: IWebRpcContractConfig = {}): IWebRpcMiddleware => ({
  name: 'contract',
  install: ({ capabilities }) => {
    if (!config || typeof config !== 'object' || Array.isArray(config))
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'contract descriptor is invalid');
    let version: IWebRpcContractConfig['version'];
    let acceptVersions: IWebRpcContractConfig['acceptVersions'];
    let maxIdentifierLength: IWebRpcContractConfig['maxIdentifierLength'];
    try {
      version = config.version;
      acceptVersions = config.acceptVersions;
      maxIdentifierLength = config.maxIdentifierLength;
    } catch (error) {
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'contract descriptor is unreadable',
        error
      );
    }
    let schemas: Record<string, IWebRpcMethodSchema> | undefined;
    try {
      const source = safeRead<unknown>(config, 'schemas');
      if (source !== undefined) {
        if (!source || typeof source !== 'object' || Array.isArray(source))
          throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'schemas must be an object');
        schemas = createSafeRecord<IWebRpcMethodSchema>() as Record<string, IWebRpcMethodSchema>;
        for (const method of Object.keys(source)) {
          const methodSchema = safeRead<unknown>(source, method);
          const params = safeRead<unknown>(methodSchema, 'params');
          const result = safeRead<unknown>(methodSchema, 'result');
          const isSchema = (value: unknown): value is IWebRpcSchema =>
            Boolean(value) &&
            typeof value === 'object' &&
            typeof safeRead<unknown>(value, 'parse') === 'function';
          if (!isSchema(params) || !isSchema(result))
            throw new WebRpcError(
              WebRpcErrorCode.invalidConfig,
              `schema descriptor is invalid: ${method}`
            );
          schemas[method] = { params, result };
        }
      }
    } catch (error) {
      if (error instanceof WebRpcError) throw error;
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'contract.schemas must contain params/result schemas with parse functions',
        error
      );
    }
    try {
      if (
        acceptVersions !== undefined &&
        (!Array.isArray(acceptVersions) ||
          acceptVersions.some((version) => typeof version !== 'string' || version.length === 0))
      )
        throw new WebRpcError(
          WebRpcErrorCode.invalidConfig,
          'contract.acceptVersions must contain non-empty strings'
        );
    } catch (error) {
      if (error instanceof WebRpcError) throw error;
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'contract.acceptVersions is unreadable',
        error
      );
    }
    const snapshot = {
      version,
      maxIdentifierLength,
      acceptVersions: acceptVersions ? [...acceptVersions] : undefined,
      schemas
    };
    if (version !== undefined && (!version || typeof version !== 'string'))
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'contract version must be a non-empty string'
      );
    if (
      maxIdentifierLength !== undefined &&
      (!Number.isSafeInteger(maxIdentifierLength) || maxIdentifierLength <= 0)
    )
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'maxIdentifierLength must be a positive safe integer'
      );
    const capability: IWebRpcContractCapability = {
      ...snapshot,
      validateData: (method, side, data) => validateContractData(snapshot, method, side, data)
    };
    capabilities.set(WebRpcCapabilityKey.contract, capability);
    capabilities.set(WebRpcCapabilityKey.contractCapability, capability);
  }
});
