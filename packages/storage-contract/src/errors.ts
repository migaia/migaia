import type { IBackendKind } from './capabilities.js'
import type { IStorageKey } from './context.js'
import { StorageContractErrorCode, type IStorageContractErrorCode } from './error-code.js'

export { StorageContractErrorCode, type IStorageContractErrorCode }

/** `source` value stamped onto every contract-level error this package throws. */
export const STORAGE_CONTRACT_SOURCE = '@migaia/storage-contract'

/** 契约级错误详情：只含中立字段，不泄漏 web 诊断词汇（codec/migration/extension 等留 storage-web）。 */
export type IStorageContractErrorDetails = {
  readonly backend?: IBackendKind
  readonly key?: string | IStorageKey
  readonly cause?: unknown
}

/**
 * 契约级错误。`source` 恒为 `@migaia/storage-contract`，码表见 `StorageContractErrorCode`。 构造后
 * `Object.freeze`；不重写 `stack`；`cause` 链可达（`docs/contracts/error-codes.md` §3.2）。
 */
export class StorageContractError extends Error {
  readonly source: string
  readonly code: IStorageContractErrorCode
  readonly backend?: IBackendKind
  readonly key?: string | IStorageKey

  constructor(
    code: IStorageContractErrorCode,
    details: IStorageContractErrorDetails = {},
    message?: string
  ) {
    super(message ?? `[storage-contract] ${code}`, { cause: details.cause })
    this.name = 'StorageContractError'
    this.source = STORAGE_CONTRACT_SOURCE
    this.code = code
    this.backend = details.backend
    this.key = details.key
    Object.freeze(this)
  }
}

export const isStorageContractError = (value: unknown): value is StorageContractError =>
  value instanceof StorageContractError
