import { RedisOperation } from '../constants.js'
import { RedisCommand } from '../constants.js'
import { defineFeature, type IStorageFeatureOutput } from '@migaia/storage-host'
import type { IOperationContext } from '@migaia/storage-contract'
import { redisBackendKind } from '../plugin.js'
import { readNativeFeaturePort } from '../native-feature.js'
import { featureName, featureInteger, featureMember, readFeatureMember } from '../feature-input.js'
import { RedisSuffix, replyInteger, replyString } from '../layout.js'
import { invalidArgument, redisError } from '../errors.js'
import { RedisErrorCode } from '../error-code.js'
/** Native equal-score ordering follows the original canonical UTF-16 member encoding. */
export type IRedisSortedSetsApi = {
  readonly sortedSets: {
    add(
      key: string,
      entries: readonly { readonly member: string; readonly score: number }[],
      ctx?: IOperationContext
    ): Promise<number>
    rank(key: string, member: string, ctx?: IOperationContext): Promise<number | undefined>
    top(
      key: string,
      options?: { readonly count?: number },
      ctx?: IOperationContext
    ): Promise<readonly { readonly member: string; readonly score: number }[]>
  }
}
/** Native root methods deliberately do not augment WATCH transaction scopes. */
export type IRedisSortedSetsOutput = IStorageFeatureOutput<
  readonly [],
  {},
  { readonly store: IRedisSortedSetsApi; readonly transaction: {} }
>
/** Leaderboards return ascending native ranks and scores with deterministic same-score members. */
export function redisSortedSetsFeature() {
  return defineFeature<typeof redisBackendKind, {}, IRedisSortedSetsOutput>(
    redisBackendKind,
    () => ({
      capabilities: [] as const,
      chain: {},
      api: {
        transaction: {},
        store: {
          sortedSets: {
            async add(
              key: string,
              entries: readonly { readonly member: string; readonly score: number }[],
              ctx?: IOperationContext
            ) {
              const name = featureName(key)
              if (!Array.isArray(entries)) throw invalidArgument()
              const captured = entries.map((entry) => {
                if (!entry || typeof entry !== 'object') throw invalidArgument()
                const member = featureName(entry.member),
                  score = entry.score
                if (typeof score !== 'number' || !Number.isFinite(score)) throw invalidArgument()
                return { member, score }
              })
              if (captured.length === 0) return 0
              return readNativeFeaturePort(this.store).run(
                RedisOperation.sortedSetsAdd,
                { name, entries: captured },
                ctx,
                true,
                async (input, connection, layout) =>
                  replyInteger(
                    await connection.command([
                      RedisCommand.zadd,
                      layout.feature(RedisSuffix.sorted, featureName(input.name)),
                      ...input.entries.flatMap((entry) => {
                        if (!Number.isFinite(entry.score)) throw invalidArgument()
                        return [String(entry.score), featureMember(entry.member)]
                      })
                    ])
                  ),
                false
              )
            },
            async rank(key: string, member: string, ctx?: IOperationContext) {
              return readNativeFeaturePort(this.store).run(
                RedisOperation.sortedSetsRank,
                { name: featureName(key), member: featureName(member) },
                ctx,
                false,
                async (input, connection, layout) => {
                  const result = await connection.command([
                    RedisCommand.zrank,
                    layout.feature(RedisSuffix.sorted, featureName(input.name)),
                    featureMember(input.member)
                  ])
                  return result === null ? undefined : replyInteger(result)
                },
                false
              )
            },
            async top(key: string, options?: { readonly count?: number }, ctx?: IOperationContext) {
              const input = { name: featureName(key), count: featureInteger(options?.count ?? 10) }
              return readNativeFeaturePort(this.store).run(
                RedisOperation.sortedSetsTop,
                input,
                ctx,
                false,
                async (actual, connection, layout) => {
                  const result = await connection.command([
                    RedisCommand.zrange,
                    layout.feature(RedisSuffix.sorted, featureName(actual.name)),
                    '0',
                    String(featureInteger(actual.count) - 1),
                    RedisCommand.withscores
                  ])
                  if (!Array.isArray(result)) throw redisError(RedisErrorCode.decodeFailed, result)
                  const pairs = result.every(Array.isArray)
                    ? result
                    : (() => {
                        if (result.length % 2 !== 0)
                          throw redisError(RedisErrorCode.decodeFailed, result)
                        return Array.from({ length: result.length / 2 }, (_, index) => [
                          result[index * 2],
                          result[index * 2 + 1]
                        ])
                      })()
                  const rows: { member: string; score: number }[] = []
                  for (const pair of pairs) {
                    if (pair.length !== 2) throw redisError(RedisErrorCode.decodeFailed, result)
                    const score =
                      typeof pair[1] === 'number' ? pair[1] : Number(replyString(pair[1]))
                    if (!Number.isFinite(score))
                      throw redisError(RedisErrorCode.decodeFailed, result)
                    rows.push({ member: readFeatureMember(pair[0]), score })
                  }
                  return rows
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
