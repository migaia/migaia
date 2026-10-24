import { RedisOperation } from '../constants.js'
import { RedisCommand } from '../constants.js'
import { defineFeature, type IStorageFeatureOutput } from '@migaia/storage-host'
import type { IOperationContext } from '@migaia/storage-contract'
import { redisBackendKind } from '../plugin.js'
import { readNativeFeaturePort } from '../native-feature.js'
import { featureName, featureInteger } from '../feature-input.js'
import { RedisSuffix, replyInteger } from '../layout.js'
import { redisError } from '../errors.js'
import { RedisErrorCode } from '../error-code.js'
/** Fixed windows use only Redis's clock and reject without increasing an exhausted counter. */
export type IRedisRateLimitOptions = { readonly limit: number; readonly windowMs: number }
/** Reset time is the native TTL remaining in this same atomic server-side operation. */
export type IRedisRateLimitResult = {
  readonly allowed: boolean
  readonly remaining: number
  readonly resetAfterMs: number
}
/** Rate-limit methods run only on root native endpoints, outside interactive WATCH drafts. */
export type IRedisRateLimitApi = {
  readonly rateLimit: {
    consume(key: string, cost?: number, ctx?: IOperationContext): Promise<IRedisRateLimitResult>
  }
}
/** Exact Feature output carries no transaction or additional capability. */
export type IRedisRateLimitOutput = IStorageFeatureOutput<
  readonly [],
  {},
  { readonly store: IRedisRateLimitApi; readonly transaction: {} }
>
/** One Lua invocation checks and updates the window without client-side read/write races. */
const rateScript =
  "local current=tonumber(redis.call('GET',KEYS[1]) or '0'); local limit=tonumber(ARGV[1]); local cost=tonumber(ARGV[2]); local ttl=redis.call('PTTL',KEYS[1]); if cost>limit-current then return {0,limit-current,math.max(0,ttl)} end; local next=current+cost; if current==0 then redis.call('SET',KEYS[1],next,'PX',ARGV[3]) else redis.call('SET',KEYS[1],next,'KEEPTTL') end; return {1,limit-next,redis.call('PTTL',KEYS[1])}"
/** Capture finite policy once; each invocation uses the exact original pipeline and native lease. */
export function redisRateLimitFeature(options: IRedisRateLimitOptions) {
  const limit = featureInteger(options.limit),
    windowMs = featureInteger(options.windowMs)
  return defineFeature<typeof redisBackendKind, {}, IRedisRateLimitOutput>(
    redisBackendKind,
    () => ({
      capabilities: [] as const,
      chain: {},
      api: {
        transaction: {},
        store: {
          rateLimit: {
            async consume(
              key: string,
              cost = 1,
              ctx?: IOperationContext
            ): Promise<IRedisRateLimitResult> {
              const input = { name: featureName(key), cost: featureInteger(cost) }
              return readNativeFeaturePort(this.store).run(
                RedisOperation.rateLimitConsume,
                input,
                ctx,
                true,
                async (actual, connection, layout) => {
                  const result = await connection.command([
                    RedisCommand.eval,
                    rateScript,
                    '1',
                    layout.feature(RedisSuffix.rate, featureName(actual.name)),
                    String(limit),
                    String(featureInteger(actual.cost)),
                    String(windowMs)
                  ])
                  if (!Array.isArray(result) || result.length !== 3)
                    throw redisError(RedisErrorCode.decodeFailed, result)
                  const allowed = replyInteger(result[0]),
                    remaining = replyInteger(result[1]),
                    resetAfterMs = replyInteger(result[2])
                  if (
                    (allowed !== 0 && allowed !== 1) ||
                    remaining < 0 ||
                    remaining > limit ||
                    resetAfterMs < 0
                  )
                    throw redisError(RedisErrorCode.decodeFailed, result)
                  return { allowed: allowed === 1, remaining, resetAfterMs }
                },
                false
              )
            }
          }
        }
      }
    })
  )
}
