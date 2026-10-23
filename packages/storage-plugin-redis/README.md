# Redis 原生驱动

适配入口借用真实已连接 SDK client 或 pool。`ioredisDriver` 接受 ioredis 6，`nodeRedisDriver` 接受 node-redis 6 pool，`bunRedisDriver` 接受 Bun 内置 `RedisClient`。根入口不加载 SDK。

`withConnection` 在整个回调完成前持有原生 pool 租约或自有 duplicate。注入的 client 仍由调用方关闭。借用的 `getClient()` 类型不提供关闭与复制方法。订阅资源先封闭回调，再清理连接；释放 Promise 由共享资源实现缓存。

`exec` 在 WATCH 冲突时返回 `null`，否则逐条返回成功值或原生错误。某条命令失败时，其它命令可能已经提交。EXEC 后断连可能无法确定结果，适配器不自动重放。ioredis 与 node-redis 提供二进制命令；Bun 驱动在 MULTI 前拒绝二进制输入。

原生命令、连接与 EXEC 故障使用 `REDIS_FAILED`；用户回调的未知业务失败使用 `TRANSACTION_FAILED`。已有 contract、host 与本包错误保留原身份，原生 Error 类型、stack 和原始错误仍可追踪。

ioredis 和 node-redis 的 `binaryCommand` 及 `exec` 保留任意原生 BLOB 字节。ioredis 的成功回复也可能是 Buffer，请按固定命令验证 `unknown` 回复。node-redis 6.3 的 multi builder 没有把类型映射传给最终 EXEC，适配器在同一真实 pool 租约内使用原生 raw MULTI/EXEC，并复用 SDK chainId；原始逐项 Error 保留，SDK 未产生聚合错误时不伪造 MultiErrorReply。连接在 EXEC 前变化会报 `REDIS_FAILED`，只有原生 EXEC 返回 null 才表示 WATCH 放弃。
