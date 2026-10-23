import type { ICaseDoc, IText } from './contract.js'
/** Bilingual examples preserve the genuine client's independent ownership. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Only delivered native driver entries appear in this package's current examples. */
export const storagePluginRedisCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  ioredisDriver: [
    {
      title: t('Borrow an ioredis client', '借用 ioredis client'),
      problem: t(
        'The adapter must retain one real duplicate until the callback settles.',
        '适配器需要持有真实 duplicate，直到回调完成。'
      ),
      example: `import { Redis } from 'ioredis'
import { ioredisDriver } from '@migaia/storage-plugin-redis/ioredis'
const client = new Redis(process.env.MIGAIA_REDIS_URL!)
try {
  const driver = ioredisDriver(client)
  console.log(await driver.withConnection(connection => connection.command(['PING'])))
} finally { await client.quit() }`,
      result: t(
        'Prints PONG. The caller closes its own root client.',
        '输出 PONG，由调用方关闭原 root client。'
      )
    }
  ],
  nodeRedisDriver: [
    {
      title: t('Hold the native pool lease', '持有原生 pool 租约'),
      problem: t(
        'The complete callback must stay inside RedisClientPool.execute.',
        '完整回调必须位于 RedisClientPool.execute 内。'
      ),
      example: `import { createClientPool } from 'redis'
import { nodeRedisDriver } from '@migaia/storage-plugin-redis/node-redis'
const pool = createClientPool({ url: process.env.MIGAIA_REDIS_URL! })
await pool.connect()
try {
  const driver = nodeRedisDriver(pool)
  console.log(await driver.withConnection(connection => connection.command(['PING'])))
} finally { await pool.close() }`,
      result: t(
        'Prints PONG. The adapter returns the lease after the callback settles.',
        '输出 PONG，适配器在回调完成后归还租约。'
      )
    }
  ],
  bunRedisDriver: [
    {
      title: t('Use Bun’s built-in client', '使用 Bun 内置 client'),
      problem: t(
        'Text-wire storage must work without fabricating a binary command port.',
        '文本 wire 存储不能虚构二进制命令端口。'
      ),
      example: `import { RedisClient } from 'bun'
import { bunRedisDriver } from '@migaia/storage-plugin-redis/bun'
const client = new RedisClient(process.env.MIGAIA_REDIS_URL!)
await client.connect()
try {
  const driver = bunRedisDriver(client)
  console.log(await driver.withConnection(connection => connection.command(['PING'])))
} finally { client.close() }`,
      result: t(
        'Prints PONG. This adapter does not expose binaryCommand.',
        '输出 PONG，该适配器不提供 binaryCommand。'
      )
    }
  ]
}
