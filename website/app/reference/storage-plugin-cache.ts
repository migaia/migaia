import type { ILibraryReference, IText } from './contract.js'
import { storagePluginCacheCases } from './storage-plugin-cache-cases.js'
/** Bilingual prose retains the same public cache identities. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Cache metadata documents package-owned policies and canonical request keys. */
export const storagePluginCacheReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Canonical cache request keys and tier policy contracts.',
        '从缓存插件与规范请求键开始，组合已发布的原生存储层并声明回源及期限策略。'
      )
    },
    'features/semantic': {
      summary: t(
        'Select semanticCacheFeature with an earlier published native vector backend.',
        '以更早发布的原生向量后端选择语义缓存特性。'
      )
    }
  },
  symbols: {
    cachePlugin: {
      role: 'enhancer',
      options: 'ICacheOptions',
      optionDocs: {
        id: {
          summary: t(
            'Declare the ID later passed to host.backend.',
            '此处声明并随后传给 host.backend 的缓存后端标识。'
          ),
          default: t('cache is the default backend ID.', '缺省后端标识为 cache。')
        },
        'stampedeLock.backend': {
          summary: t(
            'One configured tier ID whose real key transaction owns miss rechecking.',
            '已配置层的后端标识，由其真实键事务负责缺失复查。'
          )
        },
        'stampedeLock.timeoutMs': {
          summary: t(
            'Positive lock-acquisition budget passed to the native transaction owner.',
            '传给原生事务拥有者的正整数锁获取毫秒预算。'
          ),
          default: t('30,000 milliseconds.', '缺省等待三万毫秒。')
        },
        'tagIndex.backend': {
          summary: t(
            'Earlier host backend ID providing the original records and TTL capabilities.',
            '更早宿主批次发布、提供原记录与期限能力的后端标识。'
          )
        }
      },
      optionCases: [
        {
          ...storagePluginCacheCases.cachePlugin![0]!,
          covers: ['id', 'tiers', 'prefix', 'maxAgeMs', 'staleAfterMs', 'negativeTtlMs']
        },
        {
          ...storagePluginCacheCases.cachePolicy![0]!,
          covers: ['stampedeLock', 'writeBackIntervalMs', 'propagate']
        },
        { ...storagePluginCacheCases.cacheClock![0]!, covers: ['clock', 'jitterRatio', 'random'] },
        { ...storagePluginCacheCases.cacheCodec![0]!, covers: ['codec', 'tagIndex'] }
      ],
      purpose: t(
        'Compose earlier published KV tiers without taking their client or transaction ownership.',
        '组合更早发布的键值层，不接管其客户端或事务所有权。'
      ),
      params: {
        options: t(
          'Ordered borrowed tiers and cache policy. Backend IDs come from an earlier host batch.',
          '有序借用层与缓存策略；后端标识来自更早宿主批次。'
        ),
        features: t(
          'Optional Features targeting the exact cache kind.',
          '以精确缓存种类为目标的可选特性。'
        )
      },
      returns: t(
        'Install with host.use after its tiers and explicitly detect before business operations.',
        '在各层之后经 host.use 安装，业务操作前显式检测。'
      ),
      cases: storagePluginCacheCases.cachePlugin
    },
    semanticCacheFeature: {
      role: 'enhancer',
      options: 'ISemanticCacheOptions',
      optionCases: [
        {
          ...storagePluginCacheCases.semanticCacheFeature![0]!,
          covers: ['backend', 'collection', 'dimensions', 'minScore', 'ttlMs']
        }
      ],
      purpose: t(
        'Add native semantic answer matching and bounded candidate verification to a cache.',
        '为缓存添加原生语义回答匹配与有界候选复核。'
      ),
      params: {
        options: t(
          'Earlier vector backend, collection schema, minimum score and application embedder.',
          '更早向量后端、集合模式、最低分与应用嵌入函数。'
        )
      },
      returns: t(
        'Select the Feature in cachePlugin; native query, expiry and deletion owners remain unchanged.',
        '在 cachePlugin 中选择特性；查询、期限与删除保留原拥有者。'
      ),
      cases: storagePluginCacheCases.semanticCacheFeature
    },

    cacheKey: {
      role: 'operation',
      purpose: t(
        'Hash canonical portable request parts without accessing storage.',
        '使用原可持久化投影规范请求参数并计算稳定哈希，整个过程不访问存储后端。'
      ),
      params: {
        parts: t(
          'Ordered portable request parts; at least one is required.',
          '按含义排列的可持久化请求参数，至少一个。'
        )
      },
      returns: t(
        'Lowercase SHA-256 identity after canonical portable projection, without storage I/O.',
        '经规范投影生成的 SHA-256 小写身份，不访问存储。'
      ),
      cases: storagePluginCacheCases.cacheKey
    },
    cacheBackendKind: {
      role: 'constant',
      purpose: t(
        'Authenticate the exact cache Feature target with no native client exposure.',
        '通过精确令牌身份校验缓存特性的挂载目标，不授予原生客户端访问或关闭权限。'
      )
    },
    CacheWriteMode: {
      role: 'constant',
      purpose: t(
        'Name through and back tier write policies.',
        '定义各缓存层的写入时机，选择等待原生写入完成或先合并待写条目再刷出。'
      )
    },
    CacheErrorCode: {
      role: 'constant',
      purpose: t(
        'Distinguish configuration, loader and embedding failures.',
        '区分缓存配置、应用回源与向量嵌入失败，原始回调或编码错误继续保留在原因链。'
      )
    },
    ERROR_SOURCE: {
      role: 'constant',
      purpose: t(
        'Registered cache error domain storage.backend.cache.',
        '以登记的 storage.backend.cache 领域识别缓存自有错误，借用后端的原始错误仍保留其归属。'
      )
    }
  },
  types: {
    ICacheOptions: {
      summary: t(
        'Installed cache policy over ordered borrowed tiers.',
        '面向有序借用层的缓存安装策略。'
      ),
      members: {
        tiers: {
          summary: t(
            'Nonempty distinct tiers ordered fastest to slowest; the final tier is through.',
            '从快到慢排列的非空不重复层；最后一层为 through。'
          )
        },
        prefix: {
          summary: t(
            'Physical managed string prefix; default includes the cache plugin ID.',
            '所管物理字符串前缀，缺省包含缓存插件标识。'
          ),
          default: t(
            'cache:<id>: isolates the selected cache ID.',
            '缺省使用 cache:<id>:，隔离所选缓存标识。'
          )
        },
        maxAgeMs: {
          summary: t(
            'Overall wall-clock expiry bound recorded in the envelope.',
            '条目中保存的整体墙钟到期上界。'
          ),
          default: t(
            'No cache-wide maximum age; native tier lifetimes still apply.',
            '不设置缓存整体年龄上限，原生各层期限仍然有效。'
          )
        },
        staleAfterMs: {
          summary: t(
            'Return older hits while one shared background refresh proceeds.',
            '共享后台刷新时立即返回旧命中。'
          ),
          default: t('No soft-stale refresh deadline.', '不设置软过期后台刷新期限。')
        },
        negativeTtlMs: {
          summary: t(
            'Finite lifetime for cached undefined source results.',
            '无结果回源的有限缓存期限。'
          ),
          default: t('Undefined source results are not cached.', '不缓存回源返回的未定义结果。')
        },
        stampedeLock: {
          summary: t(
            'Existing tier whose native key transaction rechecks and loads the missing key.',
            '由原生键事务复查并回源缺失键的已有层。'
          ),
          default: t(
            'Share loads only within this cache instance.',
            '缺省仅在当前缓存实例内共享回源。'
          )
        },
        writeBackIntervalMs: {
          summary: t(
            'Original scheduler interval for flushing the pending key table.',
            '原调度器刷出待写键表的间隔。'
          ),
          default: t('1,000 milliseconds.', '缺省刷出间隔为一千毫秒。')
        },
        propagate: {
          summary: t(
            'Consume native invalidations; upper tiers need expiry bounds.',
            '消费原生失效通知，上层必须设期限上界。'
          ),
          default: t(
            'true consumes supported native change feeds.',
            '缺省开启，消费受支持的原生变更通知。'
          ),
          values: {
            true: t(
              'Subscribe where available; upper tiers require finite expiry.',
              '在可用时订阅原生通知，上层必须具有有限期限。'
            ),
            false: t(
              'Use explicit invalidation and hard tier expiry.',
              '仅使用显式失效操作与各层硬期限。'
            )
          },
          whenToUse: t(
            'Disable native propagation when the application controls invalidation.',
            '应用自行控制失效通知时，可关闭原生传播。'
          ),
          example: storagePluginCacheCases.cachePolicy![0]!.example
        },
        clock: {
          summary: t(
            'Injected wall-clock milliseconds for shared timestamps.',
            '共享时间戳使用的注入墙钟毫秒。'
          ),
          default: t(
            'Date.now supplies wall-clock milliseconds.',
            '缺省由 Date.now 提供墙钟毫秒。'
          ),
          returns: t(
            'Comparable wall-clock milliseconds for expiry and age.',
            '返回用于到期与年龄比较的墙钟毫秒。'
          ),
          whenToUse: t(
            'Inject the application wall clock while preserving comparable timestamps.',
            '应用需要指定墙钟来源时使用，返回值须可比较。'
          ),
          example: storagePluginCacheCases.cacheClock![0]!.example
        },
        jitterRatio: {
          summary: t(
            'Zero to one-half reduction; never extends a lifetime.',
            '零至二分之一的缩短比例，不延长期限。'
          ),
          default: t('Zero disables expiry jitter.', '缺省为零，不对期限施加抖动。')
        },
        random: {
          summary: t(
            'Sample source for the original numeric jitter helper.',
            '原数值抖动助手的随机源。'
          ),
          default: t('Math.random supplies jitter samples.', '缺省使用 Math.random 产生抖动样本。'),
          returns: t(
            'A numeric sample consumed by the original jitter helper.',
            '返回由原数值抖动助手消费的随机样本。'
          ),
          whenToUse: t(
            'Choose an application random source for finite expiry reduction.',
            '需要指定有限期限缩短的随机来源时使用。'
          ),
          example: storagePluginCacheCases.cacheClock![0]!.example
        },
        codec: {
          summary: t(
            'Original text-output value codec; defaults to strict JSON.',
            '原文字输出值编码器，缺省为严格 JSON。'
          ),
          default: t(
            'The original version-one strict JSON text codec.',
            '缺省使用原版本一严格 JSON 文字编码器。'
          )
        },
        tagIndex: {
          summary: t(
            'Earlier records and TTL backend indexing entry dependencies.',
            '索引条目依赖的更早记录与期限后端。'
          ),
          default: t(
            'Dependency tags and tag invalidation are unavailable.',
            '缺省不启用依赖标签与标签失效操作。'
          )
        }
      }
    },
    ICacheTierOptions: {
      summary: t(
        'One native tier with explicit write timing and hard lifetime.',
        '具有显式写入时机与硬期限的原生层。'
      ),
      members: {
        backend: {
          summary: t(
            'ID published by an earlier host installation batch.',
            '更早宿主安装批次发布的后端标识。'
          )
        },
        ttlMs: {
          summary: t(
            'Native hard lifetime; per-call values can only shorten a configured bound.',
            '原生硬期限；单次调用仅能缩短配置上界。'
          )
        },
        write: {
          summary: t(
            'Through waits for the native write; back coalesces by key until flush.',
            'through 等待原生写入；back 按键合并至刷出。'
          ),
          values: { enum: 'CacheWriteMode' }
        },
        maxEntryBytes: {
          summary: t(
            'Skip entries exceeding this complete encoded byte size.',
            '跳过完整编码字节数超出此上界的条目。'
          )
        },
        offload: {
          summary: t(
            'Earlier blob backend and minimum encoded content byte size.',
            '更早发布的对象后端与最小编码内容字节数。'
          )
        }
      }
    },
    ICacheCallOptions: {
      summary: t(
        'Per-call policy only shortens configured deadlines.',
        '只能缩短配置期限的单次调用策略。'
      ),
      members: {
        ctx: {
          summary: t(
            'Original caller operation context and cancellation budget.',
            '原调用方操作上下文与取消预算。'
          )
        },
        ttlMs: {
          summary: t(
            'Native hard lifetime; per-call values can only shorten a configured bound.',
            '原生硬期限；单次调用仅能缩短配置上界。'
          )
        },
        staleAfterMs: {
          summary: t(
            'Return older hits while one shared background refresh proceeds.',
            '共享后台刷新时立即返回旧命中。'
          )
        },
        maxAgeMs: {
          summary: t(
            'Overall wall-clock expiry bound recorded in the envelope.',
            '条目中保存的整体墙钟到期上界。'
          )
        },
        negativeTtlMs: {
          summary: t(
            'Finite lifetime for cached undefined source results.',
            '无结果回源的有限缓存期限。'
          )
        },
        tags: {
          summary: t(
            'Dependency labels indexed before any cache entry is written.',
            '任何缓存条目写入前索引的依赖标签。'
          )
        },
        meta: {
          summary: t(
            'Detached scalar observations returned with the cached value.',
            '随缓存值返回的脱离引用标量观察。'
          )
        },
        cacheIf: {
          summary: t(
            'False returns the source result without storing it.',
            '返回 false 时仅返回回源结果而不存储。'
          )
        },
        mode: {
          summary: t(
            'Default reads; refresh forces loading; bypass avoids all tier I/O.',
            '缺省读取，refresh 强制回源，bypass 跳过各层读写。'
          ),
          values: {
            default: t(
              'Read existing tiers and load only on a miss.',
              '读取现有各层，仅在未命中时回源。'
            ),
            refresh: t(
              'Skip cached hits and request a source load.',
              '跳过缓存命中并请求重新回源。'
            ),
            bypass: t(
              'Call the source without tier reads or writes.',
              '调用回源函数，不读写任何缓存层。'
            )
          }
        }
      }
    },
    ICacheEntryInfo: {
      summary: t('Decoded value and original hit provenance.', '解码值与原命中来源信息。'),
      members: {
        value: {
          summary: t(
            'Decoded application value; source ownership stays with the caller.',
            '解码后的应用值，回源所有权属于调用方。'
          )
        },
        tier: {
          summary: t(
            'Zero-based hit tier; semantic diagnostics use minus one.',
            '从零开始的命中层号；语义诊断使用负一。'
          )
        },
        stale: {
          summary: t('The hit exceeded its selected soft deadline.', '命中已超过选定软期限。')
        },
        negative: {
          summary: t(
            'The envelope records an undefined source result.',
            '条目保存回源未返回值的负缓存结果。'
          )
        },
        ageMs: {
          summary: t('Elapsed wall-clock age since the original write.', '自原写入起的墙钟年龄。')
        },
        meta: {
          summary: t(
            'Detached scalar observations returned with the cached value.',
            '随缓存值返回的脱离引用标量观察。'
          )
        },
        tags: {
          summary: t(
            'Dependency labels indexed before any cache entry is written.',
            '任何缓存条目写入前索引的依赖标签。'
          )
        }
      }
    },
    ICacheStats: {
      summary: t(
        'Immutable counts without application keys or values.',
        '不携带应用键值的不可变计数。'
      ),
      members: {
        hits: {
          summary: t(
            'Observed hits count without stored application content.',
            '不保留应用内容的 hits 观察计数。'
          )
        },
        misses: {
          summary: t(
            'Observed misses count without stored application content.',
            '不保留应用内容的 misses 观察计数。'
          )
        },
        loads: {
          summary: t(
            'Observed loads count without stored application content.',
            '不保留应用内容的 loads 观察计数。'
          )
        },
        staleServed: {
          summary: t(
            'Observed staleServed count without stored application content.',
            '不保留应用内容的 staleServed 观察计数。'
          )
        },
        negativeHits: {
          summary: t(
            'Observed negativeHits count without stored application content.',
            '不保留应用内容的 negativeHits 观察计数。'
          )
        },
        invalidations: {
          summary: t(
            'Observed invalidations count without stored application content.',
            '不保留应用内容的 invalidations 观察计数。'
          )
        },
        writeBackDropped: {
          summary: t(
            'Observed writeBackDropped count without stored application content.',
            '不保留应用内容的 writeBackDropped 观察计数。'
          )
        },
        skipped: {
          summary: t(
            'Observed skipped count without stored application content.',
            '不保留应用内容的 skipped 观察计数。'
          )
        }
      }
    },
    ICacheStore: {
      summary: t(
        'KV orchestration, source loading and explicit cache invalidation.',
        '键值编排、回源与显式缓存失效。'
      ),
      members: {
        getOrLoad: {
          summary: t(
            'Read tiers and share one source load for a missing logical key.',
            '读取各层，并为缺失逻辑键共享一次回源。'
          )
        },
        getOrLoadEntry: {
          summary: t(
            'Load with the same policy and return hit provenance with the value.',
            '按相同策略回源，并随值返回命中来源。'
          )
        },
        getOrLoadMany: {
          summary: t(
            'Batch tier reads and load only missing keys without an existing flight.',
            '批量读取各层，仅回源缺失且尚未在途的键。'
          )
        },
        peek: {
          summary: t(
            'Inspect a live entry without invoking a source loader.',
            '检查有效条目，不调用回源函数。'
          )
        },
        invalidate: {
          summary: t(
            'Invalidate one key, a managed prefix or an indexed dependency tag.',
            '使单键、受管前缀或已索引依赖标签失效。'
          )
        },
        flush: {
          summary: t(
            'Await actual writes for the current coalesced back entries.',
            '等待当前合并待写条目的实际写入。'
          )
        },
        sweepOffload: {
          summary: t(
            'Delete unreferenced offloaded blobs beyond the shared retention bound.',
            '删除超过共享保留上界且未被引用的卸载对象。'
          )
        },
        stats: {
          summary: t(
            'Return immutable counters without retaining application content.',
            '返回不保留应用内容的不可变计数。'
          )
        }
      }
    },
    ICacheLoader: {
      summary: t(
        'Original source callback receiving only the cache closing signal.',
        '仅接收缓存关闭信号的原回源回调。'
      ),
      members: {}
    },
    ICacheBatchLoader: {
      summary: t(
        'One source call for missing keys not already in flight.',
        '一次接收缺失且尚未在途键的回源回调。'
      ),
      members: {}
    },
    ICacheTierHookPayload: {
      summary: t('Original host identity and observed tier number.', '原宿主身份与观察层号。'),
      members: {
        backendId: {
          summary: t(
            'Original host registration backendId identity.',
            '原宿主登记的 backendId 身份。'
          )
        },
        backend: {
          summary: t(
            'ID published by an earlier host installation batch.',
            '更早宿主安装批次发布的后端标识。'
          )
        },
        orgId: {
          summary: t('Original host registration orgId identity.', '原宿主登记的 orgId 身份。')
        },
        transactionId: {
          summary: t(
            'Original host registration transactionId identity.',
            '原宿主登记的 transactionId 身份。'
          )
        },
        tier: {
          summary: t(
            'Zero-based hit tier; semantic diagnostics use minus one.',
            '从零开始的命中层号；语义诊断使用负一。'
          )
        }
      }
    },
    ICacheErrorCode: {
      summary: t(
        'Registered cache configuration, source and embedding failure identities.',
        '已登记的缓存配置、回源与嵌入错误身份。'
      ),
      members: {}
    },
    ISemanticPayload: {
      summary: t(
        'Native scalar filter fields excluding reserved $cache. names.',
        '不包含 $cache. 保留名的原生标量过滤字段。'
      ),
      members: {}
    },
    ISemanticCacheOptions: {
      summary: t(
        'Native vector schema, score threshold and application embedder.',
        '原生向量模式、分数阈值与应用嵌入函数。'
      ),
      members: {
        backend: {
          summary: t(
            'ID published by an earlier host installation batch.',
            '更早宿主安装批次发布的后端标识。'
          )
        },
        collection: {
          summary: t(
            'Native collection storing semantic answer points.',
            '存储语义回答点的原生集合。'
          )
        },
        dimensions: {
          summary: t(
            'Exact positive vector dimension owned by the original schema.',
            '原模式拥有的精确正数向量维度。'
          )
        },
        metric: {
          summary: t(
            'Native cosine, dot or euclid metric; defaults to cosine.',
            '原生向量集合使用的余弦、点积或欧氏距离度量。'
          ),
          default: t('cosine uses the native cosine metric.', '缺省使用原生余弦度量。'),
          values: {
            cosine: t(
              'Compare vector direction with native cosine scores.',
              '使用原生余弦分数比较向量方向。'
            ),
            dot: t(
              'Use the native dot-product score and its magnitude sensitivity.',
              '使用原生点积分数，保留向量长度的影响。'
            ),
            euclid: t(
              'Use the engine’s normalized Euclidean-distance score.',
              '使用引擎规范化的欧氏距离分数。'
            )
          },
          whenToUse: t(
            'Match the metric used by the application embedder and existing collection.',
            '选择与应用嵌入函数及已有集合一致的向量度量。'
          ),
          example: storagePluginCacheCases.semanticCacheFeature![0]!.example
        },
        minScore: {
          summary: t(
            'Minimum native score before application acceptance.',
            '应用复核前的最低原生分数。'
          )
        },
        ttlMs: {
          summary: t(
            'Native hard lifetime; per-call values can only shorten a configured bound.',
            '原生硬期限；单次调用仅能缩短配置上界。'
          ),
          default: t(
            'Do not request a hard semantic point lifetime.',
            '不请求语义向量点的硬到期期限。'
          )
        },
        embed: {
          summary: t(
            'Application callback generating vectors; original failures remain on cause.',
            '生成向量的应用回调，原错误保留在 cause。'
          ),
          params: {
            text: t('The caller’s captured prompt text.', '调用方传入并已捕获的提示文本。'),
            signal: t(
              'The shared cache closing signal, independent of one caller.',
              '共享缓存关闭信号，不受单个调用方取消影响。'
            )
          },
          returns: t(
            'A promise for a finite vector of exactly the configured dimensions; failures retain the original cause.',
            '返回有限数值向量的承诺，维度须与配置一致，失败保留原始原因。'
          ),
          whenToUse: t(
            'Supply the application’s real embedding service for reads and stored answers.',
            '为语义读取与回答存储提供应用自己的真实嵌入服务。'
          ),
          example: storagePluginCacheCases.semanticCacheFeature![0]!.example
        }
      }
    },
    ISemanticHit: {
      summary: t(
        'Application response accepted from a native vector candidate.',
        '原生向量候选经复核后的应用响应。'
      ),
      members: {
        value: {
          summary: t(
            'Decoded application value; source ownership stays with the caller.',
            '解码后的应用值，回源所有权属于调用方。'
          )
        },
        score: {
          summary: t(
            'Original native engine score; source loads have no score.',
            '原生引擎分数，回源没有分数。'
          )
        },
        prompt: {
          summary: t(
            'Original prompt stored in the reserved semantic envelope.',
            '语义保留条目中存储的原提示词。'
          )
        }
      }
    },
    ISemanticLoaded: {
      summary: t(
        'Source value returned without inventing an engine score.',
        '不伪造引擎分数的回源结果。'
      ),
      members: {
        value: {
          summary: t(
            'Decoded application value; source ownership stays with the caller.',
            '解码后的应用值，回源所有权属于调用方。'
          )
        },
        score: {
          summary: t(
            'Original native engine score; source loads have no score.',
            '原生引擎分数，回源没有分数。'
          )
        },
        prompt: {
          summary: t(
            'Original prompt stored in the reserved semantic envelope.',
            '语义保留条目中存储的原提示词。'
          )
        }
      }
    },
    ISemanticGetOptions: {
      summary: t(
        'Bounded native candidates with optional ordered application acceptance.',
        '有界原生候选与可选有序应用复核。'
      ),
      members: {
        where: {
          summary: t(
            'Original declarative scalar filter excluding reserved fields.',
            '排除保留字段的原声明标量过滤。'
          )
        },
        minScore: {
          summary: t(
            'Minimum native score before application acceptance.',
            '应用复核前的最低原生分数。'
          )
        },
        candidates: {
          summary: t(
            'One to ten native candidates, defaulting to one.',
            '一至十个原生候选，缺省一个。'
          )
        },
        accept: {
          summary: t(
            'Ordered asynchronous verification; failures report and skip.',
            '有序异步复核，失败报告并跳过。'
          )
        },
        ctx: {
          summary: t(
            'Original caller operation context and cancellation budget.',
            '原调用方操作上下文与取消预算。'
          )
        }
      }
    },
    ISemanticCacheApi: {
      summary: t(
        'Native semantic reads, writes, shared source loads and counted deletion.',
        '原生语义读写、共享回源与带计数删除。'
      ),
      members: {
        get: {
          summary: t(
            'Embed the prompt and verify candidates in native score order.',
            '嵌入提示词，并按原生分数顺序复核候选。'
          ),
          params: {
            prompt: t(
              'Application question to embed for native matching.',
              '应用提交的待嵌入问题文本。'
            ),
            options: t(
              'Optional scalar filter, candidate limit, score, acceptance and caller context.',
              '可选标量过滤、候选数量、最低分、复核回调与调用上下文。'
            )
          },
          returns: t(
            'The first accepted live native candidate, or undefined; original vector ordering is preserved.',
            '返回首个通过复核的有效原生候选，未命中则返回 undefined，保留原向量排序。'
          ),
          example: storagePluginCacheCases.semanticCacheFeature![0]!.example
        },
        set: {
          summary: t(
            'Store a response through the original vector upsert and native expiry owner.',
            '经原向量写入与原生期限拥有者保存响应。'
          ),
          params: {
            prompt: t(
              'Prompt stored with the response and used for embedding.',
              '随响应保存并用于计算嵌入的提示文本。'
            ),
            value: t(
              'Application response encoded by the semantic strict JSON value codec.',
              '由语义严格 JSON 值编码器编码的应用响应。'
            ),
            options: t(
              'Optional scalar payload and original caller cancellation context.',
              '可选标量负载与调用方原取消上下文。'
            )
          },
          returns: t(
            'Resolves after the original native upsert settles; configured TTL is passed to that owner.',
            '原生写入完成后兑现，配置期限直接传给原生期限拥有者。'
          ),
          example: storagePluginCacheCases.semanticCacheFeature![0]!.example
        },
        getOrLoad: {
          summary: t(
            'Share a source load only after native semantic matching misses.',
            '仅在原生语义匹配缺失后共享回源。'
          ),
          params: {
            prompt: t(
              'Application question used for matching and the shared load identity.',
              '用于语义匹配与共享回源身份的应用问题。'
            ),
            load: t(
              'Application source callback receiving the shared cache closing signal.',
              '应用回源回调，接收共享缓存关闭信号。'
            ),
            options: t(
              'Read filters plus optional scalar payload, shorter TTL and cacheIf decision.',
              '读取过滤与可选标量负载、更短期限及是否缓存回调。'
            )
          },
          returns: t(
            'An accepted native hit with its score, or the shared fresh response with score undefined.',
            '返回带原分数的已接受命中，或分数为 undefined 的共享新回源响应。'
          ),
          example: storagePluginCacheCases.semanticCacheFeature![0]!.example
        },
        invalidate: {
          summary: t(
            'Return the original counted native deletion result, including physically expired matches.',
            '返回原生带计数删除结果，包含物理上已过期的匹配点。'
          ),
          params: {
            where: t(
              'Declarative scalar filter on user payload fields; reserved cache fields are rejected.',
              '针对用户负载字段的声明式标量过滤，不接受缓存保留字段。'
            ),
            ctx: t(
              'Original native deletion context with optional count mode; forwarded once unchanged.',
              '带可选计数模式的原生删除上下文，原样转发一次。'
            )
          },
          returns: t(
            'The original native numeric deletion result; count mode and expired-point rules follow the vector backend.',
            '返回原生数字删除结果，计数模式与过期点规则遵循向量后端。'
          ),
          example: storagePluginCacheCases.semanticCacheFeature![0]!.example
        }
      }
    }
  },
  enums: {
    CacheWriteMode: {
      summary: t('Choose when a tier receives its cached write.', '选择层接收缓存写入的时机。'),
      values: {
        through: t('Wait for this layer before returning.', '调用返回前等待本层原生写入完成。'),
        back: t(
          'Coalesce writes in the configured pending table.',
          '在配置的待写表中按键合并写入。'
        )
      }
    },
    CacheErrorCode: {
      summary: t(
        'Registered orchestration failure categories.',
        '登记的缓存编排失败分类，原始原因留在错误链。'
      ),
      values: {
        tierInvalid: t(
          'Correct invalid tier or call policy configuration.',
          '修正非法层或单次策略配置。'
        ),
        loadFailed: t(
          'Inspect the original loader or encoding failure on cause.',
          '通过 cause 检查原回源或编码错误。'
        ),
        embedFailed: t(
          'Inspect the original embedding failure on cause.',
          '通过 cause 检查应用嵌入回调的原始错误。'
        )
      }
    }
  },
  enhancers: {
    cachePlugin: {
      kind: 'plugin',
      target: 'IStorageHost',
      scenarios: [
        t('Compose published tiers in a later installation batch.', '在后续安装批次组合已发布层。')
      ],
      example: storagePluginCacheCases.cachePlugin![0]!.example,
      summary: t(
        'Install after borrowed tiers and detect explicitly before calls.',
        '在借用层发布之后安装缓存后端，调用业务方法之前显式完成宿主能力检测。'
      ),
      install: storagePluginCacheCases.cachePlugin![0]!.example,
      grants: [
        {
          signature: 'host.backend("cache"): ICacheStore',
          summary: t(
            'Access managed KV operations, source loading, invalidation, flushing and statistics.',
            '使用受管键值操作、回源、失效、刷出与统计。'
          )
        }
      ]
    },
    semanticCacheFeature: {
      kind: 'feature',
      target: 'ICacheStore',
      scenarios: [
        t(
          'Retrieve similar answers using a native vector collection.',
          '使用原生向量集合读取相似回答。'
        )
      ],
      example: storagePluginCacheCases.semanticCacheFeature![0]!.example,
      summary: t(
        'Select in cachePlugin to expose api.semantic on the store.',
        '在缓存插件中选择该特性，为存储增加语义匹配、保存、共享回源与带计数失效方法。'
      ),
      install: storagePluginCacheCases.semanticCacheFeature![0]!.example,
      grants: [
        {
          signature: 'cache.api.semantic: ISemanticCacheApi',
          summary: t(
            'Read, store and invalidate semantic responses using the earlier vector backend.',
            '使用更早向量后端读取、存储与删除语义响应。'
          )
        }
      ]
    }
  }
}
