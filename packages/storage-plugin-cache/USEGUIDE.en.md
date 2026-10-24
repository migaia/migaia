# Multi-tier cache contracts

`cacheKey(...parts)` projects values through the original portable serializer, preserves part order and hashes canonical JSON bytes with SHA-256. Equivalent object field orders produce the same lowercase hexadecimal key. Unsupported values retain the serializer error.

```ts
import { cacheKey, type ICacheOptions } from '@migaia/storage-plugin-cache'
const key = await cacheKey('response', { model: 'model-one', version: 1 })
const options: ICacheOptions = { tiers: [{ backend: 'memory', ttlMs: 30000 }] }
console.log(key, options.tiers.length)
```

Tier options refer to already-published backends. The cache kind grants no native tier client or transaction ownership. `CacheWriteMode` names through and back writes. Call policy can shorten configured deadlines; the optional random source belongs to the original jitter helper. The error domain is `storage.backend.cache`; configuration, loader and embedding failures have separate registered codes, and callback failures retain their original cause and native error class.
