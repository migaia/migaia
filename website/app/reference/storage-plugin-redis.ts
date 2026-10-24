import type { ILibraryReference, IText } from './contract.js'
import { storagePluginRedisCases } from './storage-plugin-redis-cases.js'
/** Each adapter remains a separate entry; the neutral root imports no SDK. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** This inventory records the delivered native entries and their actual capability boundaries. */
export const storagePluginRedisReference: ILibraryReference = {
  modules: {
    'features/search': {
      summary: {
        en: 'Select native RediSearch vector ranking; module and binary support are detected before use.',
        zh: '选择原生向量排名扩展，使用前检测搜索模块与真实二进制端口是否可用。'
      }
    },
    'features/streams': {
      summary: {
        en: 'Select native stream entries and consumer groups; blocking reads retain a dedicated connection.',
        zh: '选择原生流条目与消费组功能，阻塞读取期间始终保留专用连接。'
      }
    },
    'features/pubsub': {
      summary: {
        en: 'Select best-effort Pub/Sub and namespace-filtered key events without promising reconnect replay.',
        zh: '选择尽力传递的发布订阅与命名空间键事件，不承诺断线后的历史重放。'
      }
    },
    'features/sorted-sets': {
      summary: {
        en: 'Select native ascending score sets with canonical UTF-16 ordering for equal scores.',
        zh: '选择原生升序分数集合，同分成员使用规范字符编码顺序保持确定结果。'
      }
    },
    'features/rate-limit': {
      summary: {
        en: 'Select Redis-clock fixed windows; an exhausted request does not increment the counter.',
        zh: '选择以服务端时钟计时的固定窗口，拒绝已耗尽请求时不再增加计数。'
      }
    },
    'features/change-stream': {
      summary: {
        en: 'Select committed stream history with durable cursors appended in the same native EXEC as data.',
        zh: '选择已提交的流历史与可靠游标，历史条目与数据在同一原生事务批次追加。'
      }
    },
    index: {
      summary: {
        en: 'Install the native Redis backend, select Features and borrow caller-owned driver ports.',
        zh: '安装原生存储后端并选择所需扩展，借用调用方驱动而不接管连接。'
      }
    },
    ioredis: {
      summary: {
        en: 'Adapt a caller-owned ioredis client; duplicates own callback and subscription lifetimes.',
        zh: '将调用方客户端适配为驱动，独立副本承载回调与订阅的完整生命周期。'
      }
    },
    'node-redis': {
      summary: {
        en: 'Adapt a caller-owned node-redis pool; start with nodeRedisDriver to retain complete native leases.',
        zh: '将调用方连接池适配为驱动，完整回调始终持有同一原生连接租约。'
      }
    },
    bun: {
      summary: {
        en: 'Adapt the built-in Bun RedisClient for text commands; this entry provides no binary command port.',
        zh: '适配运行时内置客户端的文本命令，明确不提供保留任意字节的命令端口。'
      }
    }
  },
  symbols: {
    rediSearchVectorFeature: {
      role: 'factory',
      purpose: {
        en: 'Publish standard vectors only after detecting the actual Search module and byte-preserving driver port.',
        zh: '检测真实搜索模块与保留字节的驱动端口后发布标准向量，排名由原生引擎完成。'
      },
      cases: storagePluginRedisCases.rediSearchVectorFeature,
      returns: {
        en: 'An exact-kind Feature selected by redisBackendPlugin; no transaction-specific native API is added.',
        zh: '返回由后端工厂选择的精确种类扩展，不额外增加专有事务内接口。'
      }
    },
    redisStreamsFeature: {
      role: 'factory',
      purpose: {
        en: 'Expose native Streams and consumer groups on the root store without fabricating transaction APIs.',
        zh: '在根存储提供原生流与消费组操作，不为专有扩展虚构事务内调用能力。'
      },
      cases: storagePluginRedisCases.nativeFeatures,
      returns: {
        en: 'An exact-kind Feature selected by redisBackendPlugin; no transaction-specific native API is added.',
        zh: '返回由后端工厂选择的精确种类扩展，不额外增加专有事务内接口。'
      }
    },
    redisPubSubFeature: {
      role: 'factory',
      purpose: {
        en: 'Expose native Pub/Sub with owned subscription resources and no automatic reconnect replay.',
        zh: '提供原生发布订阅及所属订阅资源，不通过自动重连伪造可靠历史重放。'
      },
      cases: storagePluginRedisCases.nativeFeatures,
      returns: {
        en: 'An exact-kind Feature selected by redisBackendPlugin; no transaction-specific native API is added.',
        zh: '返回由后端工厂选择的精确种类扩展，不额外增加专有事务内接口。'
      }
    },
    redisSortedSetsFeature: {
      role: 'factory',
      purpose: {
        en: 'Expose ascending native sorted sets with finite scores and deterministic equal-score members.',
        zh: '提供使用有限分数的原生升序集合，同分成员仍保持确定的规范排序。'
      },
      cases: storagePluginRedisCases.nativeFeatures,
      returns: {
        en: 'An exact-kind Feature selected by redisBackendPlugin; no transaction-specific native API is added.',
        zh: '返回由后端工厂选择的精确种类扩展，不额外增加专有事务内接口。'
      }
    },
    redisRateLimitFeature: {
      role: 'factory',
      purpose: {
        en: 'Expose native fixed-window admission; rejected requests leave the accepted counter unchanged.',
        zh: '提供原生固定窗口准入，拒绝耗尽请求时保持已接受请求的计数不变。'
      },
      cases: storagePluginRedisCases.nativeFeatures,
      returns: {
        en: 'An exact-kind Feature selected by redisBackendPlugin; no transaction-specific native API is added.',
        zh: '返回由后端工厂选择的精确种类扩展，不额外增加专有事务内接口。'
      },
      params: {
        options: {
          en: 'Positive integer accepted count and fixed-window duration.',
          zh: '正整数的接受次数上限与固定窗口持续时间。'
        }
      },
      options: 'IRedisRateLimitOptions',
      optionCases: [
        {
          covers: ['limit', 'windowMs'],
          title: {
            en: 'Select native retention or admission bounds',
            zh: '选择原生保留或准入上界'
          },
          problem: {
            en: 'The installed native Feature needs explicit bounded policy values selected by the application.',
            zh: '应用安装原生扩展时，需要明确选择有限的保留或准入策略数值。'
          },
          example:
            "import { redisRateLimitFeature } from '@migaia/storage-plugin-redis/features/rate-limit'\nexport const requests = redisRateLimitFeature({ limit: 100, windowMs: 60000 })",
          result: {
            en: 'Pass this exact-kind Feature to redisBackendPlugin during installation.',
            zh: '安装时将此精确种类扩展传给后端工厂，即可使用所选原生策略。'
          }
        }
      ]
    },
    redisChangeStreamFeature: {
      role: 'factory',
      purpose: {
        en: 'Publish durableChangeFeed from the original committed EXEC and native stream cursor owner.',
        zh: '从原提交批次与原生流游标拥有者发布可靠变更能力，不另建通知日志。'
      },
      cases: storagePluginRedisCases.nativeFeatures,
      returns: {
        en: 'An exact-kind Feature selected by redisBackendPlugin; no transaction-specific native API is added.',
        zh: '返回由后端工厂选择的精确种类扩展，不额外增加专有事务内接口。'
      },
      params: {
        options: {
          en: 'Native retention bound for the committed change stream.',
          zh: '已提交变更流的原生保留条数上界。'
        }
      },
      optionDocs: {
        maxLen: {
          summary: {
            en: 'Approximate native MAXLEN retention; older cursors may expire.',
            zh: '原生近似条数保留上界，超出保留范围的旧游标会过期。'
          }
        }
      },
      options: undefined,
      optionCases: [
        {
          covers: ['maxLen'],
          title: {
            en: 'Select native retention or admission bounds',
            zh: '选择原生保留或准入上界'
          },
          problem: {
            en: 'The installed native Feature needs explicit bounded policy values selected by the application.',
            zh: '应用安装原生扩展时，需要明确选择有限的保留或准入策略数值。'
          },
          example:
            "import { redisChangeStreamFeature } from '@migaia/storage-plugin-redis/features/change-stream'\nexport const history = redisChangeStreamFeature({ maxLen: 1000 })",
          result: {
            en: 'Pass this exact-kind Feature to redisBackendPlugin during installation.',
            zh: '安装时将此精确种类扩展传给后端工厂，即可使用所选原生策略。'
          }
        }
      ]
    },
    redisBackendKind: {
      role: 'constant',
      purpose: {
        en: 'Identify the exact Redis backend when authenticating native Feature installation.',
        zh: '标识精确的原生后端种类，在安装扩展时拒绝不匹配的目标存储。'
      }
    },
    redisBackendPlugin: {
      role: 'factory',
      purpose: t(
        'Install native storage and WATCH transactions. Private storageLogStore operations read current native state on each call; strong journal composition remains unavailable.',
        '安装原生存储及 WATCH 事务。私有 storageLogStore 每次操作读取当前原生状态；强日志组合仍不可用。'
      ),
      cases: storagePluginRedisCases.redisBackendPlugin,
      params: {
        options: {
          en: 'Caller configuration selecting the original driver and namespace.',
          zh: '调用方配置，指定原驱动与隔离命名空间。'
        },
        features: {
          en: 'Explicit native Feature factories for this exact backend kind.',
          zh: '显式选择与此后端种类完全匹配的原生扩展。'
        }
      },
      returns: {
        en: 'A lazy exact-id plugin descriptor; the caller retains driver and connection ownership.',
        zh: '返回惰性的精确标识插件描述，驱动与连接仍由调用方拥有。'
      },
      options: 'IRedisOptions',
      optionCases: [
        {
          covers: ['id', 'driver', 'prefix'],
          title: {
            en: 'Isolate one application store',
            zh: '隔离单个应用存储'
          },
          problem: {
            en: 'Independent application stores must not overwrite each other in a shared Redis deployment.',
            zh: '多个应用共用部署时，各自存储需要使用独立的物理命名空间。'
          },
          example:
            "import { redisBackendPlugin, type IRedisDriver } from '@migaia/storage-plugin-redis'\nexport const sessions = (driver: IRedisDriver) =>\n  redisBackendPlugin({ id: 'sessions', driver, prefix: 'application:sessions' })",
          result: {
            en: 'The application selects sessions; the supplied driver remains caller-owned.',
            zh: '应用使用指定标识选择会话存储，注入驱动仍由调用方拥有。'
          }
        },
        {
          covers: ['concurrency', 'owner', 'owner.label', 'maxLockMs'],
          title: {
            en: 'Bound native lock waiting',
            zh: '限制原生锁等待'
          },
          problem: {
            en: 'Contended writes need one authentic waiting policy and a finite native lease.',
            zh: '存在争用的写入需要真实的等待策略，同时保留有限的原生锁租期。'
          },
          example:
            "import { ConcurrencyPolicy } from '@migaia/storage-host/authoring/concurrency'\nimport { redisBackendPlugin, type IRedisDriver } from '@migaia/storage-plugin-redis'\nexport const writes = (driver: IRedisDriver) => redisBackendPlugin({\n  driver,\n  concurrency: ConcurrencyPolicy.wait(),\n  owner: { label: 'session-worker' },\n  maxLockMs: 30000\n})",
          result: {
            en: 'The original concurrency owner applies waiting and reports the selected diagnostic label.',
            zh: '原并发拥有者应用等待策略，并通过原诊断通道展示指定标签。'
          }
        }
      ]
    },
    ERROR_SOURCE: {
      role: 'constant',
      purpose: {
        en: 'Identify the registered storage.backend.redis domain on errors crossing this package boundary.',
        zh: '标识本包错误越过公开边界时使用的登记领域，便于追踪原生故障来源。'
      }
    },
    RedisErrorCode: {
      role: 'constant',
      purpose: {
        en: 'Distinguish native protocol failures, invalid persisted data and unknown business callback failures.',
        zh: '区分原生协议故障、持久数据解码失败与未知业务回调失败，保留原始原因。'
      }
    },
    ioredisDriver: {
      role: 'factory',
      purpose: {
        en: 'Retain original duplicates through callbacks and subscriptions while leaving the injected root client unchanged.',
        zh: '在回调与订阅期间持有原生副本，不关闭或重新配置调用方注入的根客户端。'
      },
      cases: storagePluginRedisCases.ioredisDriver,
      params: {
        client: {
          en: 'Connected native pool or client created and owned by the calling application.',
          zh: '由调用方应用创建并拥有的已连接原生连接池或客户端。'
        }
      },
      returns: {
        en: 'A borrowed driver that preserves original command replies and native resource settlement.',
        zh: '返回借用驱动，保留原生命令回复与资源的真实结算顺序。'
      }
    },
    nodeRedisDriver: {
      role: 'factory',
      purpose: {
        en: 'Hold the original pool lease until every callback or subscription operation has truly settled.',
        zh: '持有原连接池租约直到回调或订阅工作真实结算，再由原拥有者归还连接。'
      },
      cases: storagePluginRedisCases.nodeRedisDriver,
      params: {
        pool: {
          en: 'Connected native pool or client created and owned by the calling application.',
          zh: '由调用方应用创建并拥有的已连接原生连接池或客户端。'
        }
      },
      returns: {
        en: 'A borrowed driver that preserves original command replies and native resource settlement.',
        zh: '返回借用驱动，保留原生命令回复与资源的真实结算顺序。'
      }
    },
    bunRedisDriver: {
      role: 'factory',
      purpose: {
        en: 'Use the built-in duplicate, send and subscribe APIs without fabricating arbitrary-byte support.',
        zh: '使用内置副本、发送与订阅接口，不虚构运行时并未提供的任意字节支持。'
      },
      cases: storagePluginRedisCases.bunRedisDriver,
      params: {
        client: {
          en: 'Connected native pool or client created and owned by the calling application.',
          zh: '由调用方应用创建并拥有的已连接原生连接池或客户端。'
        }
      },
      returns: {
        en: 'A borrowed driver that preserves original command replies and native resource settlement.',
        zh: '返回借用驱动，保留原生命令回复与资源的真实结算顺序。'
      }
    }
  },
  types: {
    IRedisVectorFeatureOutput: {
      summary: t(
        'The original three-field Feature output with standard vector and change watch.',
        '标准 vector 与变更观察的原三字段 Feature 输出。'
      ),
      members: {}
    },
    IRedisStreamEntry: {
      summary: {
        en: 'One native stream entry retains its original ID and decoded byte-valued fields.',
        zh: '单条原生流记录保留原始标识及已解码的字节字段。'
      },
      members: {
        id: {
          summary: {
            en: 'Original stream ID returned by Redis XADD or stream reads.',
            zh: '由原生追加或流读取返回的原始流记录标识。'
          }
        },
        fields: {
          summary: {
            en: 'Decoded field bytes detached from the native wire reply.',
            zh: '从原生线路回复脱离并解码后的字段字节。'
          }
        }
      }
    },
    IRedisStreamsApi: {
      summary: {
        en: 'Root stream entry and consumer-group methods, absent from generic transaction views.',
        zh: '根存储上的流条目与消费组方法，不进入通用事务视图。'
      },
      members: {
        streams: {
          summary: {
            en: 'Root-only native stream and consumer-group method group.',
            zh: '仅根存储提供的原生流与消费组方法组。'
          }
        }
      }
    },
    IRedisStreamsOutput: {
      summary: {
        en: 'Feature output publishes the root streams API with no capability or transaction additions.',
        zh: '扩展输出发布根流接口，不额外增加标准能力或事务方法。'
      },
      members: {}
    },
    IRedisPubSubApi: {
      summary: {
        en: 'Root Pub/Sub publishing and owned subscriptions with best-effort delivery semantics.',
        zh: '根发布订阅提供消息发布与所属订阅，传递语义为尽力而为。'
      },
      members: {
        pubsub: {
          summary: {
            en: 'Root message publishing and independently disposable subscriptions.',
            zh: '根消息发布与可独立释放的订阅方法组。'
          }
        }
      }
    },
    IRedisPubSubOutput: {
      summary: {
        en: 'Feature output exposes root Pub/Sub and preserves an empty transaction API.',
        zh: '扩展输出公开根发布订阅功能，并保持事务接口为空。'
      },
      members: {}
    },
    IRedisSortedSetsApi: {
      summary: {
        en: 'Root native sorted-set operations preserve finite scores and canonical member ordering.',
        zh: '根原生有序集合操作保留有限分数与规范成员排序。'
      },
      members: {
        sortedSets: {
          summary: {
            en: 'Root native score-set writes, ranges and rank lookups.',
            zh: '根原生分数集合写入、范围读取与排名查询方法组。'
          }
        }
      }
    },
    IRedisSortedSetsOutput: {
      summary: {
        en: 'Feature output exposes the native root sortedSets API without new standard tokens.',
        zh: '扩展输出公开原生根有序集合接口，不增加新的标准令牌。'
      },
      members: {}
    },
    IRedisRateLimitOptions: {
      summary: {
        en: 'Positive accepted-count and duration bounds defining one native fixed-window policy.',
        zh: '定义单个原生固定窗口策略的正整数次数与持续时间上界。'
      },
      members: {
        limit: {
          summary: {
            en: 'Positive integer maximum number of accepted requests in a window.',
            zh: '单个窗口内允许接受的正整数请求次数上限。'
          }
        },
        windowMs: {
          summary: {
            en: 'Positive integer duration of the native fixed window in milliseconds.',
            zh: '原生固定窗口的正整数毫秒持续时间。'
          }
        }
      }
    },
    IRedisRateLimitResult: {
      summary: {
        en: 'One atomic native admission result reports capacity and the remaining window lifetime.',
        zh: '一次原子原生准入结果，报告剩余容量与当前窗口的剩余期限。'
      },
      members: {
        allowed: {
          summary: {
            en: 'True only when the native fixed-window counter accepted this request.',
            zh: '仅原生固定窗口计数接受本次请求时为真。'
          }
        },
        remaining: {
          summary: {
            en: 'Number of additional requests still accepted by the current window.',
            zh: '当前窗口仍可接受的后续请求次数。'
          }
        },
        resetAfterMs: {
          summary: {
            en: 'Remaining milliseconds until the current server-clock window expires.',
            zh: '当前服务端时钟窗口过期前的剩余毫秒数。'
          }
        }
      }
    },
    IRedisRateLimitApi: {
      summary: {
        en: 'Root fixed-window consumption returns original native admission and remaining capacity.',
        zh: '根固定窗口消费返回原生准入结果及剩余可接受容量。'
      },
      members: {
        rateLimit: {
          summary: {
            en: 'Root consume method for one atomic fixed-window decision.',
            zh: '根消费方法，用于一次原子固定窗口准入判断。'
          }
        }
      }
    },
    IRedisRateLimitOutput: {
      summary: {
        en: 'Feature output adds root rateLimit consumption while keeping native transaction extensions empty.',
        zh: '扩展输出增加根限流消费方法，并保持原生事务扩展为空。'
      },
      members: {}
    },
    IRedisChangeStreamOutput: {
      summary: {
        en: 'Feature output publishes the reliable native stream feed through the original capability map.',
        zh: '扩展输出通过原能力映射发布可靠的原生流变更来源。'
      },
      members: {}
    },

    IRedisOptions: {
      summary: t(
        'Borrowed driver and namespace, original concurrency policy and native lock lease.',
        '借用 driver、namespace、原并发策略与原生锁租期。'
      ),
      members: {
        id: {
          summary: {
            en: 'Application-assigned backend identifier used by host.backend.',
            zh: '应用指定的后端标识，供宿主选择对应的存储实例。'
          },
          default: {
            en: 'redis, the default installed backend identifier.',
            zh: '缺省使用后端标识 redis。'
          }
        },
        driver: {
          summary: {
            en: 'Caller-owned native driver from a public adapter or custom implementation.',
            zh: '来自公开适配器或自定义实现的调用方驱动，释放不关闭根连接。'
          }
        },
        prefix: {
          summary: {
            en: 'Physical namespace prefix; all owned channels retain the same Redis hash tag.',
            zh: '物理命名空间前缀，全部所属通道保留相同集群哈希标签。'
          },
          default: {
            en: 'migaia isolates the default managed namespace.',
            zh: '缺省使用 migaia 隔离托管命名空间。'
          }
        },
        concurrency: {
          summary: {
            en: 'Authentic shared concurrency policy applied by the original operation owner.',
            zh: '由原操作拥有者应用的真实共享并发策略，不接受伪造策略对象。'
          },
          default: {
            en: 'Use the shared owner default policy.',
            zh: '省略时使用共享拥有者的默认策略。'
          }
        },
        owner: {
          summary: {
            en: 'Optional diagnostic owner identity without exposing business values.',
            zh: '可选的诊断拥有者身份，不在诊断中暴露业务值。'
          },
          default: {
            en: 'No application owner label is attached.',
            zh: '省略时不附加应用拥有者标签。'
          }
        },
        'owner.label': {
          summary: {
            en: 'Application-assigned label displayed by original lock diagnostics.',
            zh: '应用指定的标签，由原锁诊断通道展示其拥有者身份。'
          },
          default: {
            en: 'No application label is attached.',
            zh: '省略时不附加应用标签。'
          }
        },
        maxLockMs: {
          summary: {
            en: 'Positive native lock lease bound measured with Redis server time.',
            zh: '使用服务端时钟计量的正整数原生锁租期上界。'
          },
          default: {
            en: '30000 milliseconds for each native lock lease.',
            zh: '缺省每次原生锁租期为三万毫秒。'
          }
        }
      }
    },
    IRedisCapabilities: {
      summary: {
        en: 'Native KV, records, TTL and counter tokens supplied before any selected Feature.',
        zh: '选择任何扩展之前已提供的原生键值、记录、期限与计数能力令牌。'
      },
      members: {}
    },
    IRedisStore: {
      summary: t(
        'Full asynchronous record store with original capabilities, native transactions and change hints.',
        '带原能力、原生事务与变更提示的完整异步记录存储。'
      ),
      members: {}
    },
    IRedisTransactionScope: {
      summary: t(
        'Authentic original transaction view; native Feature APIs are absent.',
        '真实原事务视图；不含专有原生 Feature API。'
      ),
      members: {}
    },
    IRedisCommandHookPayload: {
      summary: t(
        'Command name and elapsed time without arguments or payloads.',
        '仅命令名与耗时，不含参数或载荷。'
      ),
      members: {
        command: {
          summary: {
            en: 'Native command name only; arguments and business payloads are omitted.',
            zh: '仅原生命令名称，不包含参数与业务载荷。'
          }
        },
        elapsedMs: {
          summary: {
            en: 'Observed native command settlement time in milliseconds.',
            zh: '原生命令真实结算时观察到的毫秒耗时。'
          }
        }
      }
    },
    IRedisWatchConflictHookPayload: {
      summary: t(
        'Logical native WATCH key count without business key copies.',
        '原生 WATCH 逻辑键数量，不复制业务键。'
      ),
      members: {
        keyCount: {
          summary: {
            en: 'Number of canonical logical identities involved in the original WATCH attempt.',
            zh: '原始监听尝试涉及的规范逻辑身份数量。'
          }
        }
      }
    },
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
          ),
          example:
            "import { createClientPool } from 'redis'\nimport { nodeRedisDriver } from '@migaia/storage-plugin-redis/node-redis'\nconst pool = createClientPool({ url: process.env.MIGAIA_REDIS_URL! })\nawait pool.connect()\ntry {\n  const driver = nodeRedisDriver(pool)\n  console.log(await driver.command(['PING']))\n  console.log(await driver.withConnection(connection => connection.command(['PING'])))\n  await using subscription = await driver.subscribe('example:events', message => console.log(message))\n  await driver.command(['PUBLISH', 'example:events', 'ready'])\n} finally { await pool.close() }"
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
          ),
          example:
            "import { createClientPool } from 'redis'\nimport { nodeRedisDriver } from '@migaia/storage-plugin-redis/node-redis'\nconst pool = createClientPool({ url: process.env.MIGAIA_REDIS_URL! })\nawait pool.connect()\ntry {\n  const driver = nodeRedisDriver(pool)\n  console.log(await driver.command(['PING']))\n  console.log(await driver.withConnection(connection => connection.command(['PING'])))\n  await using subscription = await driver.subscribe('example:events', message => console.log(message))\n  await driver.command(['PUBLISH', 'example:events', 'ready'])\n} finally { await pool.close() }"
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
          ),
          example:
            "import { createClientPool } from 'redis'\nimport { nodeRedisDriver } from '@migaia/storage-plugin-redis/node-redis'\nconst pool = createClientPool({ url: process.env.MIGAIA_REDIS_URL! })\nawait pool.connect()\ntry {\n  const driver = nodeRedisDriver(pool)\n  console.log(await driver.command(['PING']))\n  console.log(await driver.withConnection(connection => connection.command(['PING'])))\n  await using subscription = await driver.subscribe('example:events', message => console.log(message))\n  await driver.command(['PUBLISH', 'example:events', 'ready'])\n} finally { await pool.close() }"
        }
      },
      scenarios: [
        {
          en: 'Share one caller-owned connection pool between storage installation and native commands.',
          zh: '在存储安装与原生命令之间共享由调用方拥有的同一连接池。'
        }
      ],
      example:
        "import { createClientPool } from 'redis'\nimport { nodeRedisDriver } from '@migaia/storage-plugin-redis/node-redis'\nconst pool = createClientPool({ url: process.env.MIGAIA_REDIS_URL! })\nawait pool.connect()\ntry {\n  const driver = nodeRedisDriver(pool)\n  console.log(await driver.command(['PING']))\n  console.log(await driver.withConnection(connection => connection.command(['PING'])))\n  await using subscription = await driver.subscribe('example:events', message => console.log(message))\n  await driver.command(['PUBLISH', 'example:events', 'ready'])\n} finally { await pool.close() }"
    },
    IRedisErrorCode: {
      summary: {
        en: 'Registered values from the Redis-owned semantic error table.',
        zh: '来自本后端唯一所属语义错误表的登记错误码值联合。'
      },
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
        transactionFailed: {
          en: 'Unknown callback, draft or finalizer business failure retains its original cause.',
          zh: '未知回调、事务草稿或终结任务失败，原始业务原因仍可追踪。'
        }
      }
    }
  },
  enhancers: {}
}
