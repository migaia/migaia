import { createClient } from 'redis'
import { createRedisLayout } from '../../src/layout.ts'

/** Every Redis-compatible endpoint a test file may write to; unset services are skipped. */
const serviceUrls = ['MIGAIA_REDIS_URL', 'MIGAIA_VALKEY_URL', 'MIGAIA_REDIS_STACK_URL'] as const

/** Open the dedicated short-lived client for one release pass. */
function createReleaseClient(url: string) {
  return createClient({ url })
}

/** Exact client type of one release pass. */
type IReleaseClient = ReturnType<typeof createReleaseClient>

/**
 * Test-owned Redis namespaces. Every random prefix or raw key a test file creates is recorded here
 * and removed after that file, together with the prefix's vector indexes, so repeated runs never
 * grow the shared test keyspace. A growing keyspace slows Redis 8 background index scans and breaks
 * deadline-sensitive cases.
 */
export class RedisTestNamespaces {
  /** Hash tags of allocated storage prefixes; their keys and `:vi:` indexes are released. */
  readonly #tags: string[] = []
  /** Raw key stems; every key starting with a stem is released. */
  readonly #stems: string[] = []

  /** Allocate one fresh storage prefix whose physical keys are released after the file. */
  prefix(): string {
    /** Random prefixes isolate concurrent files sharing one service. */
    const value = crypto.randomUUID()
    this.#tags.push(createRedisLayout(value, crypto.randomUUID()).tag)
    return value
  }

  /** Allocate one fresh raw key stem; every key under it is released after the file. */
  key(label: string): string {
    /** The UUID keeps the stem unique; it contains no glob metacharacters. */
    const value = label + crypto.randomUUID()
    this.#stems.push(value)
    return value
  }

  /** Remove every recorded key and vector index on each configured service. */
  async release(): Promise<void> {
    if (this.#tags.length === 0 && this.#stems.length === 0) return
    for (const service of serviceUrls) {
      /** The service address comes from scripts/storage-services.mts run. */
      const url = process.env[service]
      if (url) await releaseOn(url, this.#tags, this.#stems)
    }
    this.#tags.length = 0
    this.#stems.length = 0
  }
}

/** Release one endpoint with a dedicated short-lived client. */
async function releaseOn(
  url: string,
  tags: readonly string[],
  stems: readonly string[]
): Promise<void> {
  /** Independent of the clients the tests already closed. */
  const client = createReleaseClient(url)
  await client.connect()
  try {
    await dropIndexes(client, tags)
    for (const tag of tags) await unlinkMatching(client, tag + ':*')
    for (const stem of stems) await unlinkMatching(client, stem + '*')
  } finally {
    client.destroy()
  }
}

/** Drop vector indexes owned by the released prefixes; skipped where search is not loaded. */
async function dropIndexes(client: IReleaseClient, tags: readonly string[]): Promise<void> {
  /** COMMAND INFO returns a nil entry for a command the server does not provide (Valkey). */
  const [info] = (await client.sendCommand(['COMMAND', 'INFO', 'FT._LIST'])) as unknown[]
  if (info === null || info === undefined) return
  /** Tag lookup keeps the pass linear in the listed indexes. */
  const owned = new Set(tags)
  /** One listing serves every tag of this file. */
  const indexes = (await client.sendCommand(['FT._LIST'])) as string[]
  for (const index of indexes) {
    /** Vector indexes are named `<tag>:vi:<collection>`. */
    const marker = index.indexOf(':vi:')
    if (marker > 0 && owned.has(index.slice(0, marker)))
      await client.sendCommand(['FT.DROPINDEX', index])
  }
}

/** SCAN one pattern and UNLINK every match. */
async function unlinkMatching(client: IReleaseClient, pattern: string): Promise<void> {
  for await (const keys of client.scanIterator({ MATCH: pattern, COUNT: 1000 }))
    if (keys.length) await client.unlink(keys)
}

/** One registry per test file; vitest isolates modules per file. */
export const namespaces = new RedisTestNamespaces()
