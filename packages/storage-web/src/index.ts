// The root intentionally exposes only storage-web's stable error and namespace contract.
export {
  StorageError,
  StorageErrorCode,
  STORAGE_WEB_SOURCE,
  type IStorageErrorCode,
  type IStorageErrorDetails,
  type IStorageChannel,
  type IExtensionStage
} from './types/errors.js'
export { StorageErrorText } from './error-text.js'
export { lengthPrefixedNamespaceCodec } from './utils/key.js'
export type { INamespaceCodec } from './utils/key.js'
