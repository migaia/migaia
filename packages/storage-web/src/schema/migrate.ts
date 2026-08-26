import {
  StorageContractError,
  StorageContractErrorCode,
  isStorageContractError
} from '@migaia/storage-contract'
import { raceWithAbort, UtilsAbortError } from '@migaia/utils/promise'
import { UtilsErrorCode } from '@migaia/utils/error'
import {
  createStorageOperationRuntime,
  type IStorageOperationRuntime
} from '../core/operation-reporter.js'
import { StorageError, StorageErrorCode } from '../types/errors.js'
import { assertOperationContext, throwIfAborted, type IWebAbortSignal } from '../core/operation.js'

export type IMigrationContext = {
  readonly fromVersion: number
  readonly toVersion: number
  /** Optional operation signal for cooperative migration cancellation. */
  readonly signal?: IWebAbortSignal
}

/** 迁移函数一律 async，允许迁移过程中读取其他存储或发请求。 */
export type IMigration = (previous: unknown, ctx: IMigrationContext) => Promise<unknown>

/**
 * 公开入口：创建新 runtime（一次 operation 一个 reporter），见 `docs/store-persist/storage-web-integration.sdd.md`
 * §4.4「公开 API 兼作内部步骤的拆分」。
 */
export const runMigrations = async (
  value: unknown,
  fromVersion: number,
  toVersion: number,
  migrations: Record<number, IMigration> | undefined,
  signal?: IWebAbortSignal
): Promise<unknown> => {
  const runtime = createStorageOperationRuntime()
  return runMigrationsWithRuntime(runtime, value, fromVersion, toVersion, migrations, signal)
}

/**
 * 内部实现：接收所属 operation 的 runtime，不自行创建第二个 reporter。
 *
 * 按序执行 `fromVersion → toVersion` 之间声明的迁移。缺失某一版本的迁移函数 视为该版本没有数据形状变化（no-op），不是错误。单条记录迁移失败不影响
 * 其他记录——调用方负责逐条捕获，这里只保证单次调用内的错误归一化。
 */
export const runMigrationsWithRuntime = async (
  runtime: IStorageOperationRuntime,
  value: unknown,
  fromVersion: number,
  toVersion: number,
  migrations: Record<number, IMigration> | undefined,
  signal?: IWebAbortSignal
): Promise<unknown> => {
  void runtime
  if (!Number.isSafeInteger(fromVersion) || fromVersion < 0)
    throw new StorageError(StorageErrorCode.invalidConfig, {
      cause: new RangeError('migration fromVersion must be a non-negative safe integer')
    })
  if (!Number.isSafeInteger(toVersion) || toVersion < 0)
    throw new StorageError(StorageErrorCode.invalidConfig, {
      cause: new RangeError('migration toVersion must be a non-negative safe integer')
    })
  if (
    migrations !== undefined &&
    (typeof migrations !== 'object' || migrations === null || Array.isArray(migrations))
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      cause: new TypeError('migrations must be an object')
    })
  assertOperationContext(signal === undefined ? undefined : { signal })
  throwIfAborted(signal)
  if (fromVersion >= toVersion) return value
  let current = value
  for (let version = fromVersion + 1; version <= toVersion; version += 1) {
    let migration: IMigration | undefined
    try {
      migration =
        migrations !== undefined && Object.hasOwn(migrations, version)
          ? migrations[version]
          : undefined
    } catch (cause) {
      throw new StorageError(StorageErrorCode.invalidConfig, { cause })
    }
    if (migration === undefined) continue
    if (typeof migration !== 'function')
      throw new StorageError(StorageErrorCode.invalidConfig, {
        cause: new TypeError(`migration ${version} must be a function`)
      })
    try {
      const migrationContext = signal
        ? { fromVersion: version - 1, toVersion: version, signal }
        : { fromVersion: version - 1, toVersion: version }
      const result = Promise.resolve().then(() => migration(current, migrationContext))
      if (!signal) {
        current = await result
        continue
      }
      current = await raceWithAbort(() => result, {
        signal,
        cleanupPolicy: 'report',
        report: (cause) => runtime.reporter(cause)
      })
    } catch (cause) {
      if (cause instanceof UtilsAbortError)
        throw new StorageContractError(StorageContractErrorCode.aborted, {
          cause: cause.cause
        })
      if (
        cause &&
        typeof cause === 'object' &&
        'code' in cause &&
        cause.code === UtilsErrorCode.invalidArgument
      )
        throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
      if (isStorageContractError(cause)) throw cause
      if (cause instanceof StorageError && cause.code === StorageErrorCode.invalidConfig)
        throw cause
      throw new StorageError(StorageErrorCode.migrationFailed, { cause })
    }
  }
  return current
}
