import { cacheBackendKind, cacheKey, type ICacheOptions, type ICacheStore } from '../src/index.ts'
import { kv } from '@migaia/storage-contract'
/** Configuration and business declarations preserve the exact common value and token domains. */
const options: ICacheOptions = { tiers: [{ backend: 'memory', ttlMs: 1000 }], random: () => 0.5 }
void options
void cacheBackendKind
const key: Promise<string> = cacheKey('model', { version: 1 })
void key
declare const store: ICacheStore
const value: Promise<string | undefined> = store.getOrLoad('key', async () => 'value')
const batch: Promise<ReadonlyMap<string, number | undefined>> = store.getOrLoadMany(
  ['key'],
  async () => new Map([['key', 1]])
)
void value
void batch
void store.use(kv).set('key', 'value')
// @ts-expect-error Cache does not expose a transaction owner.
store.transaction(() => undefined)
// @ts-expect-error Request values follow the portable codec domain.
cacheKey(() => undefined)
