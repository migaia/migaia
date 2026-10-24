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
        '规范缓存请求键与分层策略契约。'
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
        '对规范 portable 请求参数取哈希，不访问存储。'
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
        '校验精确缓存 Feature 目标，不暴露原生 client。'
      )
    },
    CacheWriteMode: {
      role: 'constant',
      purpose: t(
        'Name through and back tier write policies.',
        '定义 through 与 back 分层写入策略。'
      )
    },
    CacheErrorCode: {
      role: 'constant',
      purpose: t(
        'Distinguish configuration, loader and embedding failures.',
        '区分配置、回源与嵌入失败。'
      )
    },
    ERROR_SOURCE: {
      role: 'constant',
      purpose: t(
        'Registered cache error domain storage.backend.cache.',
        '登记的缓存错误领域 storage.backend.cache。'
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
          )
        },
        maxAgeMs: {
          summary: t(
            'Overall wall-clock expiry bound recorded in the envelope.',
            '条目中保存的整体墙钟到期上界。'
          )
        },
        staleAfterMs: {
          summary: t(
            'Return older hits while one shared background refresh proceeds.',
            '共享后台刷新时立即返回旧命中。'
          )
        },
        negativeTtlMs: {
          summary: t(
            'Finite lifetime for cached undefined source results.',
            '无结果回源的有限缓存期限。'
          )
        },
        stampedeLock: {
          summary: t(
            'Existing tier whose native key transaction rechecks and loads the missing key.',
            '由原生键事务复查并回源缺失键的已有层。'
          )
        },
        writeBackIntervalMs: {
          summary: t(
            'Original scheduler interval for flushing the pending key table.',
            '原调度器刷出待写键表的间隔。'
          )
        },
        propagate: {
          summary: t(
            'Consume native invalidations; upper tiers need expiry bounds.',
            '消费原生失效通知，上层必须设期限上界。'
          )
        },
        clock: {
          summary: t(
            'Injected wall-clock milliseconds for shared timestamps.',
            '共享时间戳使用的注入墙钟毫秒。'
          )
        },
        jitterRatio: {
          summary: t(
            'Zero to one-half reduction; never extends a lifetime.',
            '零至二分之一的缩短比例，不延长期限。'
          )
        },
        random: {
          summary: t(
            'Sample source for the original numeric jitter helper.',
            '原数值抖动助手的随机源。'
          )
        },
        codec: {
          summary: t(
            'Original text-output value codec; defaults to strict JSON.',
            '原文字输出值编码器，缺省为严格 JSON。'
          )
        },
        tagIndex: {
          summary: t(
            'Earlier records and TTL backend indexing entry dependencies.',
            '索引条目依赖的更早记录与期限后端。'
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
          )
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
          )
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
          summary: t('The envelope records an undefined source result.', '条目记录无结果回源。')
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
            '原生 cosine、dot 或 euclid 度量，缺省 cosine。'
          )
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
          )
        },
        embed: {
          summary: t(
            'Application callback generating vectors; original failures remain on cause.',
            '生成向量的应用回调，原错误保留在 cause。'
          )
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
          )
        },
        set: {
          summary: t(
            'Store a response through the original vector upsert and native expiry owner.',
            '经原向量写入与原生期限拥有者保存响应。'
          )
        },
        getOrLoad: {
          summary: t(
            'Share a source load only after native semantic matching misses.',
            '仅在原生语义匹配缺失后共享回源。'
          )
        },
        invalidate: {
          summary: t(
            'Return the original counted native deletion result, including physically expired matches.',
            '返回原生带计数删除结果，包含物理上已过期的匹配点。'
          )
        }
      }
    }
  },
  enums: {
    CacheWriteMode: {
      summary: t('Choose when a tier receives its cached write.', '选择层接收缓存写入的时机。'),
      values: {
        through: t('Wait for this layer before returning.', '返回前完成本层写入。'),
        back: t(
          'Coalesce writes in the configured pending table.',
          '在配置的待写表中按键合并写入。'
        )
      }
    },
    CacheErrorCode: {
      summary: t('Registered orchestration failure categories.', '登记的编排失败类别。'),
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
          '通过 cause 检查原嵌入错误。'
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
        '在借用层后安装，调用前显式检测。'
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
        '在 cachePlugin 中选择，为存储暴露 api.semantic。'
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
