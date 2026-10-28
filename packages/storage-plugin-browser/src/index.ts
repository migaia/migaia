// The root intentionally exposes only storage-plugin-browser's stable error and namespace contract.
export {
  StorageError,
  type IStorageErrorDetails,
  type IStorageChannel,
  type IExtensionStage
} from './types/errors.js'
export { StorageErrorText } from './error-text.js'
export { lengthPrefixedNamespaceCodec } from './utils/key.js'
export type { INamespaceCodec } from './utils/key.js'
