import type { ILibraryReference, IText } from './contract.js'
import { storagePluginRedisCases } from './storage-plugin-redis-cases.js'
/** Each adapter remains a separate entry; the neutral root imports no SDK. */
const t = (en: string, zh: string): IText => ({ en, zh })
/**
 * This inventory describes the delivered driver boundary without claiming backend Feature
 * completion.
 */
export const storagePluginRedisReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Neutral native driver types and registered errors.',
        '中立原生驱动类型与登记错误。'
      )
    },
    ioredis: { summary: t('Borrow a real ioredis 6 client.', '借用真实 ioredis 6 client。') },
    'node-redis': {
      summary: t('Borrow a real node-redis 6 pool.', '借用真实 node-redis 6 pool。')
    },
    bun: {
      summary: t('Borrow Bun’s actual built-in RedisClient.', '借用 Bun 真实内置 RedisClient。')
    }
  },
  symbols: {
    ERROR_SOURCE: {
      role: 'constant',
      purpose: t('Registered domain storage.backend.redis.', '登记错误域 storage.backend.redis。')
    },
    RedisErrorCode: {
      role: 'constant',
      purpose: t(
        'Distinguish native, decode and business callback failures.',
        '区分原生、解码与业务回调失败。'
      )
    },
    ioredisDriver: {
      role: 'factory',
      purpose: t(
        'Own duplicates without closing or reconfiguring the caller’s client.',
        '拥有 duplicate，不关闭或重配调用方 client。'
      ),
      cases: storagePluginRedisCases.ioredisDriver
    },
    nodeRedisDriver: {
      role: 'factory',
      purpose: t(
        'Hold the original pool lease for each full callback or subscription.',
        '在完整回调或订阅期间持有原 pool 租约。'
      ),
      cases: storagePluginRedisCases.nodeRedisDriver
    },
    bunRedisDriver: {
      role: 'factory',
      purpose: t(
        'Use native duplicate/send/subscribe without a binary port.',
        '使用原生 duplicate/send/subscribe，不提供二进制端口。'
      ),
      cases: storagePluginRedisCases.bunRedisDriver
    }
  },
  types: {
    IRedisReply: {
      summary: t(
        'Unknown native replies are validated by each fixed command consumer.',
        'unknown 原生回复由各固定命令消费者校验。'
      ),
      members: {}
    },
    IRedisExecEntry: {
      summary: t(
        'One native success or original Error; failures do not imply rollback.',
        '单条原生成功或原始 Error；失败不表示回滚。'
      ),
      members: {
        ok: {
          summary: t(
            'Discriminates a native successful command from an executed command error.',
            '区分原生命令成功与已执行命令错误。'
          )
        },
        value: {
          summary: t(
            'Present on success; arbitrary bulk bytes remain Uint8Array-compatible.',
            '成功时存在；任意 bulk 字节保留为 Uint8Array 兼容值。'
          )
        },
        error: {
          summary: t(
            'Present on failure, retaining the exact original SDK Error.',
            '失败时存在，保留精确原 SDK Error。'
          )
        }
      }
    },
    IRedisBorrowedClient: {
      summary: t(
        'The actual native client type with connection ownership methods omitted.',
        '真实原生 client 类型，省略连接拥有权方法。'
      ),
      members: {}
    },
    IRedisConnection: {
      summary: t(
        'One genuine leased connection, valid throughout its original callback.',
        '一个真实租约连接，在原回调内有效。'
      ),
      members: {
        getClient: {
          summary: t(
            'Borrow the genuine native client without close or duplicate authority.',
            '借用真实原生 client，不授予关闭或复制权限。'
          ),
          returns: t(
            'The original SDK type with ownership methods omitted.',
            '省略拥有权方法的原 SDK 类型。'
          )
        },
        command: {
          summary: t(
            'Send a text-argument native command on this same connection.',
            '在同一连接发送文本参数原生命令。'
          ),
          params: {
            args: t('Command name followed by string arguments.', '命令名及后续字符串参数。')
          },
          returns: t(
            'The original native reply; native failures use REDIS_FAILED.',
            '原生回复；原生故障使用 REDIS_FAILED。'
          )
        },
        binaryCommand: {
          summary: t(
            'Use the native byte-preserving raw command API when provided.',
            '存在时使用原生保字节 raw 命令接口。'
          ),
          default: t(
            'Absent on Bun; no binary port is fabricated.',
            'Bun 不提供，不虚构二进制端口。'
          ),
          params: {
            args: t(
              'String command name, then strings or detached bytes.',
              '字符串命令名，后接字符串或独立字节。'
            )
          },
          returns: t(
            'A native reply with arbitrary bulk bytes intact.',
            '保留任意 bulk 字节的原生回复。'
          )
        },
        exec: {
          summary: t(
            'Execute one validated native batch without replaying unknown writes.',
            '执行一个已校验原生批，不重放结果未知的写。'
          ),
          params: {
            commands: t(
              'Captured command arrays; empty input performs no Redis I/O.',
              '捕获的命令数组；空输入不做 Redis I/O。'
            )
          },
          returns: t(
            'Native null for WATCH abort, otherwise every original command result. Item errors may follow partial execution.',
            '原生 null 表示 WATCH 放弃，否则返回每条原结果；逐项错误可能伴随部分执行。'
          )
        }
      }
    },
    IRedisDriver: {
      summary: t(
        'Native commands, complete connection callbacks and original subscription resources.',
        '原生命令、完整连接回调与原订阅资源。'
      ),
      members: {
        command: {
          summary: t(
            'Borrow a native connection for one string-argument command.',
            '为一条字符串参数命令借用原生连接。'
          ),
          params: { args: t('Command name and string arguments.', '命令名与字符串参数。') },
          returns: t(
            'The validated consumer receives the original unknown native reply.',
            '消费者接收原始 unknown 原生回复并校验。'
          )
        },
        withConnection: {
          summary: t(
            'Keep the real lease or duplicate until the complete callback settles.',
            '持有真实租约或 duplicate，直到完整回调完成。'
          ),
          params: {
            run: t(
              'Callback borrowing the genuine connection and its native methods.',
              '借用真实连接及原生方法的回调。'
            )
          },
          returns: t(
            'The original callback value; unknown business failures use TRANSACTION_FAILED.',
            '原回调值；未知业务失败使用 TRANSACTION_FAILED。'
          )
        },
        subscribe: {
          summary: t(
            'Subscribe on a dedicated genuine connection without closing the injected root.',
            '使用专用真实连接订阅，不关闭注入 root。'
          ),
          params: {
            channel: t('Native channel string.', '原生频道字符串。'),
            listener: t(
              'Text-message observer; thrown or rejected failures are reported.',
              '文本消息观察者；抛出或拒绝会被报告。'
            )
          },
          returns: t(
            'An original resource with cached primary and symbolic disposal Promises.',
            '原资源，主释放与符号释放 Promise 均缓存。'
          )
        }
      }
    },
    IRedisErrorCode: {
      summary: t('Registered Redis error code values.', '登记的 Redis 错误码值。'),
      members: {}
    }
  },
  enums: {
    RedisErrorCode: {
      summary: t(
        'Registered domain failures retain native classes and original causes.',
        '登记域错误保留原生类型与原始原因。'
      ),
      values: {
        failed: t(
          'Native command, connection or EXEC failure; unknown writes are never replayed.',
          '原生命令、连接或 EXEC 失败；未知写绝不重放。'
        ),
        decodeFailed: t(
          'A fixed reply or persisted value cannot be decoded.',
          '固定回复或持久化值无法解码。'
        ),
        transactionFailed: t(
          'Unknown callback, draft or finalizer business failure.',
          '未知回调、draft 或 finalizer 业务失败。'
        )
      }
    }
  },
  enhancers: {}
}
