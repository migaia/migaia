# Redis native drivers

The adapter entries borrow a genuine connected SDK client or pool. `ioredisDriver` accepts ioredis 6, `nodeRedisDriver` accepts a node-redis 6 pool, and `bunRedisDriver` accepts Bun's built-in `RedisClient`. The root entry does not load an SDK.

`withConnection` holds the native pool lease or owned duplicate for the complete callback. The injected client remains caller-owned. Borrowed `getClient()` types omit connection closing and duplication methods. Subscription resources seal callbacks before cleanup and use cached disposal Promises.

`exec` returns `null` for an aborted WATCH, otherwise one success or original native error per command. A command error can leave other commands committed. A connection error after EXEC can have an unknown outcome; the adapters never replay it. ioredis and node-redis expose binary commands. Bun's driver rejects binary input before MULTI.

Native command, connection and EXEC failures use `REDIS_FAILED`. Unknown user callback failures use `TRANSACTION_FAILED`. Existing contract, host and package errors retain their identity; native Error types, stacks and original failures remain reachable.
