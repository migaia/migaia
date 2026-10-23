import {
  createStorageIteratorLifetime,
  StorageContractError,
  type IStorageResource
} from '@migaia/storage-contract'
import {
  asyncDisposeKey,
  createStorageOperationReporter,
  reportCleanupError
} from '@migaia/storage-host/authoring/backend'
import { isUint8Array } from '@migaia/utils/bytes'
import { RedisErrorCode } from './error-code.js'
import { redisExecCause } from './constants.js'
import {
  invalidArgument,
  normalizeRedisError,
  normalizeRedisTransactionFailure,
  redisError,
  unsupported
} from './errors.js'
import type { IRedisConnection, IRedisExecEntry } from './driver.js'

/** Command capture detaches binary input before any asynchronous connection acquisition. */
export function captureCommand(
  args: readonly (string | Uint8Array)[],
  binary: boolean
): (string | Uint8Array)[] {
  try {
    if (!Array.isArray(args)) throw invalidArgument()
    const count = args.length,
      captured: (string | Uint8Array)[] = []
    if (count === 0) throw invalidArgument()
    for (let index = 0; index < count; index++) {
      const value = args[index]
      if (typeof value === 'string') captured.push(value)
      else if (isUint8Array(value)) {
        if (!binary) unsupported()
        captured.push(new Uint8Array(value))
      } else throw invalidArgument()
    }
    if (typeof captured[0] !== 'string' || captured[0].length === 0) throw invalidArgument()
    return captured
  } catch (error) {
    if (error instanceof StorageContractError) throw error
    throw invalidArgument(error)
  }
}
/** A complete batch is captured before MULTI can enqueue any command. */
export function captureCommands(
  commands: readonly (readonly (string | Uint8Array)[])[],
  binary: boolean
): (string | Uint8Array)[][] {
  try {
    if (!Array.isArray(commands)) throw invalidArgument()
    const count = commands.length,
      captured: (string | Uint8Array)[][] = []
    for (let index = 0; index < count; index++)
      captured.push(captureCommand(commands[index]!, binary))
    return captured
  } catch (error) {
    if (error instanceof StorageContractError) throw error
    throw invalidArgument(error)
  }
}
/** Native byte APIs accept Buffer while the neutral port retains Uint8Array. */
export function nativeArguments(args: readonly (string | Uint8Array)[]): (string | Buffer)[] {
  return args.map((value) => (typeof value === 'string' ? value : Buffer.from(value)))
}
/** A native EXEC array retains its SDK aggregate as evidence without mutating original errors. */
export function execEntries(values: readonly unknown[], cause?: Error): readonly IRedisExecEntry[] {
  const entries: IRedisExecEntry[] = values.map((value) =>
    value instanceof Error
      ? Object.freeze({ ok: false, error: value })
      : Object.freeze({ ok: true, value })
  )
  if (cause !== undefined) Object.defineProperty(entries, redisExecCause, { value: cause })
  return Object.freeze(entries)
}
/** Fixed EXEC reply validation never fabricates a success for an unavailable native result. */
export function requireExecArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw redisError(RedisErrorCode.decodeFailed, value)
  return value
}
/** Two cached resource Promises and callback sealing remain in the original shared owner. */
export function subscriptionResource(close: () => Promise<void>): {
  readonly resource: IStorageResource
  readonly isClosing: () => boolean
  readonly report: (error: unknown) => void
} {
  const reporter = createStorageOperationReporter(),
    report = (error: unknown): void => reportCleanupError(reporter, normalizeRedisError(error)),
    lifetime = createStorageIteratorLifetime<never>({
      close: async () => {
        try {
          await close()
        } catch (error) {
          throw normalizeRedisError(error)
        }
      },
      report
    })
  return {
    resource: { dispose: lifetime.dispose, [asyncDisposeKey]: lifetime.symbolic },
    isClosing: lifetime.isClosing,
    report
  }
}

/**
 * The genuine connection callback owns its business failure; native methods already carry their own
 * codes.
 */
export async function runRedisCallback<TClient extends object, TResult>(
  run: (connection: IRedisConnection<TClient>) => Promise<TResult>,
  connection: IRedisConnection<TClient>
): Promise<TResult> {
  try {
    return await run(connection)
  } catch (error) {
    throw normalizeRedisTransactionFailure(error)
  }
}
