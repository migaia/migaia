// The root intentionally exposes only storage-plugin-browser's stable error and namespace contract.
export {
  StorageError,
  type IStorageErrorDetails,
  type IStorageChannel,
  type IExtensionStage
} from './types/errors.ts'
export { StorageErrorText } from './error-text.ts'
export { lengthPrefixedNamespaceCodec } from './utils/key.ts'
export type { INamespaceCodec } from './utils/key.ts'
