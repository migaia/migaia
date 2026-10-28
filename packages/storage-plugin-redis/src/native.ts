import { type IStorageResource } from '@migaia/storage-contract'
import {
  createStorageIteratorLifetime,
  asyncDisposeKey,
  createStorageOperationReporter,
  reportCleanupError
} from '@migaia/storage-host/sdk'
import { isUint8Array } from '@migaia/utils/bytes'
import { RedisErrorCode } from '@migaia/storage-contract/error-code'
import { redisExecCause } from './constants.ts'
import {
  invalidArgument,
  normalizeRedisError,
  normalizeRedisTransactionFailure,
  redisError,
  unsupported
} from './errors.ts'
import type { IRedisConnection, IRedisExecEntry } from './driver.ts'

/** Command capture detaches binary input before any asynchronous connection acquisition. */
export function captureCommand(
  args: readonly (string | Uint8Array)[],
  binary: boolean
): (string | Uint8Array)[] {
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
}
/** A complete batch is captured before MULTI can enqueue any command. */
export function captureCommands(
  commands: readonly (readonly (string | Uint8Array)[])[],
  binary: boolean
): (string | Uint8Array)[][] {
  if (!Array.isArray(commands)) throw invalidArgument()
  const count = commands.length,
    captured: (string | Uint8Array)[][] = []
  for (let index = 0; index < count; index++)
    captured.push(captureCommand(commands[index]!, binary))
  return captured
}
/** Native byte APIs accept Buffer while the neutral port retains Uint8Array. */
export function nativeArguments(args: readonly (string | Uint8Array)[]): (string | Buffer)[] {
  return args.map((value) => (typeof value === 'string' ? value : Buffer.from(value)))
}
/** A native EXEC array retains its SDK aggregate as evidence without mutating original errors. */
export function execEntries(values: readonly unknown[], cause?: Error): readonly IRedisExecEntry[] {
  const entries: IRedisExecEntry[] = values.map((value) =>
    value instanceof Error ? { ok: false, error: value } : { ok: true, value }
  )
  if (cause !== undefined) Object.defineProperty(entries, redisExecCause, { value: cause })
  return entries
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

/** Idle dedicated connections a driver keeps for reuse; more than this are closed on return. */
export const REDIS_IDLE_CONNECTION_LIMIT = 16

/** How a driver opens, resets and closes one dedicated native connection. */
export type IRedisConnectionPoolPorts<TConnection> = {
  readonly open: () => Promise<TConnection>
  /** Clears per-callback server state (WATCH) before the connection is reused. */
  readonly reset: (connection: TConnection) => Promise<void>
  readonly close: (connection: TConnection) => Promise<void>
  readonly report: (error: unknown) => void
}

/**
 * Dedicated connections a driver opened itself, reused across callbacks so each operation does not
 * pay a connect and quit. A connection whose callback failed is closed instead of reused, since its
 * server state is unknown. `release` closes the idle set; the caller's root client is never
 * touched.
 */
export class RedisConnectionPool<TConnection> {
  /** Open, reset and close behaviour of the owning driver. */
  readonly #ports: IRedisConnectionPoolPorts<TConnection>
  /** Connections that finished a callback cleanly and wait for the next one. */
  readonly #idle: TConnection[] = []
  /** After release, returned connections are closed instead of kept. */
  #released = false
  /** Capture the driver's connection ports without opening anything. */
  constructor(ports: IRedisConnectionPoolPorts<TConnection>) {
    this.#ports = ports
  }
  /** Run one callback on an idle or new dedicated connection, then reuse or close it. */
  async run<TResult>(work: (connection: TConnection) => Promise<TResult>): Promise<TResult> {
    const connection = this.#idle.pop() ?? (await this.#ports.open())
    let result: TResult
    try {
      result = await work(connection)
    } catch (error) {
      await this.#discard(connection)
      throw error
    }
    await this.#restore(connection)
    return result
  }
  /** Close every idle connection; failures are reported, never thrown. */
  async release(): Promise<void> {
    this.#released = true
    for (const connection of this.#idle.splice(0)) await this.#discard(connection)
  }
  /** Reset and keep a clean connection, or close it when the pool is full or released. */
  async #restore(connection: TConnection): Promise<void> {
    if (this.#released || this.#idle.length >= REDIS_IDLE_CONNECTION_LIMIT)
      return this.#discard(connection)
    try {
      await this.#ports.reset(connection)
    } catch (error) {
      this.#ports.report(error)
      return this.#discard(connection)
    }
    this.#idle.push(connection)
  }
  /** Close one connection and report a close failure instead of replacing the caller's outcome. */
  async #discard(connection: TConnection): Promise<void> {
    try {
      await this.#ports.close(connection)
    } catch (error) {
      this.#ports.report(error)
    }
  }
}
