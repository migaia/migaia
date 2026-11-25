import { createClient } from 'redis'
import { encodeOrderedStorageKey } from '@migaia/storage-host/sdk'
import type { IQdrantHttp } from '@migaia/storage-plugin-qdrant'

/**
 * Deletes every tracked Qdrant collection still present on the server, continuing past individual
 * errors so one failed deletion cannot leave remaining collections behind.
 */
export async function sweepQdrantCollections(
  native: IQdrantHttp,
  created: ReadonlySet<string>
): Promise<void> {
  if (created.size === 0) return
  /** Live collection names currently registered on Qdrant. */
  const existing = new Set((await native.getCollections()).collections.map((entry) => entry.name))
  /** Collected deletion failures rethrown after all remaining collections are attempted. */
  const failures: unknown[] = []
  for (const name of created) {
    if (!existing.has(name)) continue
    try {
      await native.deleteCollection(name)
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1)
    throw new AggregateError(failures, 'failed to delete one or more Qdrant test collections')
}

/**
 * Drops every RediSearch vector index and unlinks every key belonging to `prefix` on `url`, using a
 * dedicated short-lived client independent of any test pool.
 */
export async function sweepRedisNamespace(url: string, prefix: string): Promise<void> {
  /** Physical hash tag derived identically to `@migaia/storage-plugin-redis`'s layout. */
  const tag = '{' + Buffer.from(encodeOrderedStorageKey(prefix, undefined)).toString('hex') + '}'
  /** Dedicated short-lived client isolated from test pools. */
  const client = createClient({ url })
  await client.connect()
  /** Collected cleanup failures rethrown after attempting every index and key scan. */
  const failures: unknown[] = []
  try {
    /** COMMAND INFO returns a nil entry when RediSearch is not loaded. */
    const [info] = (await client.sendCommand(['COMMAND', 'INFO', 'FT._LIST'])) as unknown[]
    if (info !== null && info !== undefined) {
      /** All RediSearch indexes currently loaded on the server. */
      const indexes = (await client.sendCommand(['FT._LIST'])) as string[]
      for (const index of indexes) {
        if (!index.startsWith(tag + ':vi:')) continue
        try {
          await client.sendCommand(['FT.DROPINDEX', index])
        } catch (error) {
          failures.push(error)
        }
      }
    }
    for (const pattern of [tag + ':*', prefix + '*']) {
      try {
        for await (const keys of client.scanIterator({ MATCH: pattern, COUNT: 1000 }))
          if (keys.length) await client.unlink(keys)
      } catch (error) {
        failures.push(error)
      }
    }
  } finally {
    client.destroy()
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1)
    throw new AggregateError(failures, 'failed to clean up one or more Redis test resources')
}
