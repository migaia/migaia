import type { ILibraryReference, IText } from './contract.js'
import { storagePluginQdrantCases } from './storage-plugin-qdrant-cases.js'
/** Bilingual reference follows the actual finite package entries and shared storage contracts. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Native vector semantics remain separate from standard chain and resource ownership. */
export const storagePluginQdrantReference: ILibraryReference = {
  modules: {
    index: {
      summary: {
        en: 'Install native vector ranking and vector-target TTL without claiming KV or transactions.',
        zh: '安装原生向量排名与向量期限能力，不声明键值存储或交互式事务。'
      }
    },
    http: {
      summary: {
        en: 'Create the finite fetch protocol port; modification requests are sent once without redirect replay.',
        zh: '创建有限的网络协议端口，修改请求仅发送一次，不随重定向再次写入。'
      }
    },
    client: {
      summary: {
        en: 'Borrow the real SDK client and its native operation shapes without closing or replacing it.',
        zh: '借用真实客户端及其原生操作形状，不关闭、替换或重新配置客户端。'
      }
    },
    'features/hybrid': {
      summary: {
        en: 'Select two native dense/sparse RRF branches and sparse-only vector updates.',
        zh: '选择原生稠密与稀疏双分支融合，并支持仅更新稀疏向量字段。'
      }
    },
    'features/recommend': {
      summary: {
        en: 'Select native recommendation strategies and collection lookup without client-side scoring.',
        zh: '选择原生推荐策略与跨集合查找，保留引擎语义而不在客户端评分。'
      }
    },
    'features/group-by': {
      summary: {
        en: 'Select native multivalue groups; unsupported lookup forwarding is deliberately absent.',
        zh: '选择原生多值分组，明确不提供未被端口真实转发的分组查找选项。'
      }
    },
    'features/management': {
      summary: {
        en: 'Select native collection management and org-constrained physical deletion with operation records.',
        zh: '选择原生集合管理与组织范围内的物理删除，返回原生操作记录而非计数。'
      }
    }
  },
  symbols: {
    qdrantBackendPlugin: {
      role: 'factory',
      purpose: {
        en: 'Install native vector and expiry operations through the original host lifetime and capability owners.',
        zh: '经原宿主生命周期与能力拥有者安装原生向量和期限操作，工厂不进行网络访问。'
      },
      params: {
        features: t(
          'Selected exact-kind native Features; no transaction projection.',
          '所选精确kind原生Feature，无transaction投影。'
        )
      },
      optionDocs: {
        id: {
          summary: {
            en: 'Application-assigned backend identifier used by host.backend.',
            zh: '应用指定的后端标识，用于宿主选择对应存储实例。'
          },
          default: {
            en: 'qdrant is the default backend identifier.',
            zh: '缺省使用后端标识 qdrant。'
          }
        },
        url: {
          summary: {
            en: 'Absolute HTTP or HTTPS service URL configured by application deployment.',
            zh: '由应用部署配置提供的绝对网络服务地址。'
          }
        },
        apiKey: {
          summary: {
            en: 'Authentication key issued by the deployment; it is never included in hook payloads.',
            zh: '由部署方签发的认证密钥，绝不包含在钩子事件载荷中。'
          },
          default: {
            en: 'No API key header is sent.',
            zh: '省略时不发送密钥认证请求头。'
          }
        },
        collectionPrefix: {
          summary: {
            en: 'Configured managed namespace used to derive deterministic physical collection names.',
            zh: '用于派生确定性物理集合名称的托管命名空间配置。'
          },
          default: {
            en: 'migaia_ is the default namespace prefix.',
            zh: '缺省使用 migaia_ 作为命名空间前缀。'
          }
        },
        http: {
          summary: {
            en: 'Borrowed finite protocol port; original SDK or fetch ownership remains with the caller.',
            zh: '借用的有限协议端口，原客户端或网络请求对象仍归调用方拥有。'
          },
          default: {
            en: 'Create the native fetchHttp port from url and apiKey.',
            zh: '省略时根据地址与密钥创建原生网络协议端口。'
          }
        }
      },
      returns: {
        en: 'A pure plugin descriptor; only explicit host.detect probes native service readiness.',
        zh: '返回纯插件描述，仅显式宿主检测才探测原生服务就绪状态。'
      },
      cases: storagePluginQdrantCases.qdrantBackendPlugin,
      optionCases: [
        {
          covers: ['id', 'url', 'apiKey', 'collectionPrefix', 'http'],
          title: {
            en: 'Borrow one configured native client',
            zh: '借用已配置的原生客户端'
          },
          problem: {
            en: 'An application needs explicit connection identity while keeping the injected protocol object caller-owned.',
            zh: '应用需要明确连接身份，同时保留对注入协议对象与认证配置的拥有权。'
          },
          example:
            "import { qdrantBackendPlugin } from '@migaia/storage-plugin-qdrant'\nimport { fetchHttp } from '@migaia/storage-plugin-qdrant/http'\nconst url = process.env.MIGAIA_QDRANT_URL!\nconst apiKey = process.env.QDRANT_API_KEY\nexport const vectors = qdrantBackendPlugin({\n  id: 'vectors', url, apiKey, collectionPrefix: 'application_vectors', http: fetchHttp(url, apiKey)\n})",
          result: {
            en: 'The descriptor borrows the protocol port; host detection owns service readiness.',
            zh: '描述对象借用协议端口，服务就绪检查仍由宿主检测窗口负责。'
          }
        }
      ]
    },
    qdrantBackendKind: {
      role: 'constant',
      purpose: {
        en: 'Identify the exact native vector backend when authenticating selected Feature installation.',
        zh: '认证所选原生扩展的安装目标，拒绝与精确后端种类不一致的存储。'
      }
    },
    ERROR_SOURCE: {
      role: 'constant',
      purpose: {
        en: 'Identify the registered storage.backend.qdrant domain while retaining original native error evidence.',
        zh: '标识已登记的原生向量后端错误领域，同时保留原始故障证据与调用链。'
      }
    },
    QdrantErrorCode: {
      role: 'constant',
      purpose: {
        en: 'Distinguish native unavailability, explicit refusal and damaged responses without replacing the cause.',
        zh: '区分原生不可用、明确拒绝与损坏响应，不替换原始错误原因或伪造成功。'
      }
    },
    fetchHttp: {
      role: 'factory',
      purpose: t(
        'Use native fetch with one-send writes and complete evidence available at the adapter.',
        '使用原生fetch，一次发送写并保留适配端可取得的完整证据。'
      ),
      cases: storagePluginQdrantCases.fetchHttp,
      params: {
        url: {
          en: 'Absolute native service address supplied by application deployment.',
          zh: '由应用部署提供的绝对原生服务地址。'
        },
        apiKey: {
          en: 'Optional authentication key issued by deployment; omitted means no API-key header.',
          zh: '部署方签发的可选认证密钥，省略时不发送密钥请求头。'
        }
      },
      returns: {
        en: 'A finite native fetch port preserving available status and response evidence; dispatched writes are never replayed.',
        zh: '返回有限原生网络端口，保留可取得的状态与响应证据，已发送写不会重放。'
      }
    },
    qdrantClientHttp: {
      role: 'factory',
      purpose: {
        en: 'Adapt the borrowed original SDK method signatures and actual lifetime without mutating client configuration.',
        zh: '适配借用客户端的原始方法签名与真实生命周期，不修改其原有连接配置。'
      },
      cases: storagePluginQdrantCases.qdrantClientHttp,
      params: {
        client: {
          en: 'Real QdrantClient created and owned by the application with its existing configuration.',
          zh: '应用创建并拥有的真实客户端，保留其现有配置。'
        }
      },
      returns: {
        en: 'A finite borrowed protocol object; SDK 1.11 unexpected 202 errors retain only evidence the SDK exposes.',
        zh: '返回有限借用协议对象，旧客户端的异常响应仅保留其真实暴露的证据。'
      }
    },
    qdrantHybridFeature: {
      role: 'factory',
      purpose: {
        en: 'Expose native RRF fusion and sparse-only updates while leaving all ranking in the original engine.',
        zh: '提供原生排序融合与仅稀疏字段更新，全部评分与排名仍由原生引擎执行。'
      },
      cases: storagePluginQdrantCases.qdrantHybridFeature,
      returns: {
        en: 'An exact-kind native Feature installed by qdrantBackendPlugin; no transaction API is added.',
        zh: '返回由后端工厂安装的精确种类原生扩展，不增加事务接口。'
      }
    },
    qdrantRecommendFeature: {
      role: 'factory',
      purpose: {
        en: 'Expose native best_score and lookup semantics independently from the shared centroid recommendation chain.',
        zh: '提供原生最佳分数推荐与查找语义，独立于共享查询链的样本合成推荐。'
      },
      cases: storagePluginQdrantCases.qdrantRecommendFeature,
      returns: {
        en: 'An exact-kind native Feature installed by qdrantBackendPlugin; no transaction API is added.',
        zh: '返回由后端工厂安装的精确种类原生扩展，不增加事务接口。'
      }
    },
    qdrantGroupByFeature: {
      role: 'factory',
      purpose: {
        en: 'Expose native multivalue groups while excluding lookup options the original SDK cannot forward.',
        zh: '提供原生多值分组，并排除原客户端无法真实转发的分组查找选项。'
      },
      cases: storagePluginQdrantCases.qdrantGroupByFeature,
      returns: {
        en: 'An exact-kind native Feature installed by qdrantBackendPlugin; no transaction API is added.',
        zh: '返回由后端工厂安装的精确种类原生扩展，不增加事务接口。'
      }
    },
    qdrantManagementFeature: {
      role: 'factory',
      purpose: {
        en: 'Expose native operation-record deletion and expiry purge without changing standard numeric deleteWhere.',
        zh: '提供返回原生操作记录的条件删除与到期清理，标准条件删除仍返回数字。'
      },
      cases: storagePluginQdrantCases.qdrantManagementFeature,
      returns: {
        en: 'An exact-kind native Feature installed by qdrantBackendPlugin; no transaction API is added.',
        zh: '返回由后端工厂安装的精确种类原生扩展，不增加事务接口。'
      }
    }
  },
  types: {
    IQdrantOptions: {
      members: {
        url: {
          summary: {
            en: 'Absolute HTTP or HTTPS service URL configured by application deployment.',
            zh: '由应用部署配置提供的绝对网络服务地址。'
          }
        },
        apiKey: {
          summary: {
            en: 'Authentication key issued by the deployment; it is never included in hook payloads.',
            zh: '由部署方签发的认证密钥，绝不包含在钩子事件载荷中。'
          },
          default: {
            en: 'No API key header is sent.',
            zh: '省略时不发送密钥认证请求头。'
          }
        },
        collectionPrefix: {
          summary: {
            en: 'Configured managed namespace used to derive deterministic physical collection names.',
            zh: '用于派生确定性物理集合名称的托管命名空间配置。'
          },
          default: {
            en: 'migaia_ is the default namespace prefix.',
            zh: '缺省使用 migaia_ 作为命名空间前缀。'
          }
        },
        http: {
          summary: {
            en: 'Borrowed finite protocol port; original SDK or fetch ownership remains with the caller.',
            zh: '借用的有限协议端口，原客户端或网络请求对象仍归调用方拥有。'
          },
          default: {
            en: 'Create the native fetchHttp port from url and apiKey.',
            zh: '省略时根据地址与密钥创建原生网络协议端口。'
          }
        }
      },
      summary: t(
        'Connection options and an optional borrowed finite native port.',
        '连接配置与可选借用有限原生端口。'
      )
    },
    IQdrantHttp: {
      members: {
        getVersion: {
          summary: {
            en: 'Read the actual native server version through the original protocol port.',
            zh: '经原协议端口读取真实原生服务端版本。'
          },
          params: {
            ctx: {
              en: 'Original optional cancellation and timeout budget.',
              zh: '原可选取消信号与操作超时预算。'
            }
          },
          returns: {
            en: 'Actual server version text, never a fabricated supported-version value.',
            zh: '返回实际服务端版本文本，不伪造受支持版本。'
          },
          example:
            "import { fetchHttp } from '@migaia/storage-plugin-qdrant/http'\nconst http = fetchHttp(process.env.MIGAIA_QDRANT_URL!)\nconsole.log(await http.getVersion())"
        }
      },
      summary: t(
        'Actual SDK method shapes plus operation context, without an arbitrary request method.',
        '真实SDK方法形状加操作上下文，不提供任意request方法。'
      ),
      scenarios: [
        {
          en: 'Borrow one actual protocol port for host installation and native management observations.',
          zh: '借用同一真实协议端口完成宿主安装与原生管理观察。'
        }
      ],
      example:
        "import { fetchHttp } from '@migaia/storage-plugin-qdrant/http'\nconst http = fetchHttp(process.env.MIGAIA_QDRANT_URL!)\nconsole.log(await http.getVersion())"
    },
    IQdrantStore: {
      members: {},
      summary: t(
        'Exact vector and vector-target TTL store; every base boolean capability is false.',
        '精确vector及vector目标TTL store；base布尔能力全部false。'
      )
    },
    IQdrantUpdateResult: {
      members: {
        operationId: {
          summary: {
            en: 'Original native operation identifier returned by the server.',
            zh: '由服务端返回的原始原生操作标识符。'
          }
        },
        status: {
          summary: {
            en: 'Acknowledged means accepted; completed confirms completion, neither means a deletion count.',
            zh: '已确认状态表示接受，完成状态表示完成，两者都不是删除计数。'
          },
          values: {
            acknowledged: {
              en: 'The native operation was accepted, without confirming that all work has completed.',
              zh: '原生操作已接受，但尚未确认全部工作已经完成。'
            },
            completed: {
              en: 'The native operation completed; this is still an operation status, not a deleted-point count.',
              zh: '原生操作已经完成，仍为操作状态而非已删除点计数。'
            }
          }
        }
      },
      summary: t(
        'Native operationId and acknowledged/completed status, never a deletion count.',
        '原生operationId及acknowledged/completed状态，不是删除计数。'
      )
    },
    IQdrantHybridRequest: {
      members: {
        query: {
          summary: {
            en: 'Native fusion request restricted to the rrf strategy.',
            zh: '仅允许原生排名融合策略的融合查询请求。'
          }
        },
        prefetch: {
          summary: {
            en: 'Two named branches, exactly one dense and one sparse, without nested prefetch.',
            zh: '两个具名分支分别为稠密与稀疏，不允许嵌套预取。'
          }
        }
      },
      summary: {
        en: 'Exactly two named dense/sparse branches fused by native RRF.',
        zh: '恰好两个具名稠密与稀疏分支，由原生排序融合执行。'
      }
    },
    IQdrantSparseVectorsRequest: {
      members: {
        points: {
          summary: {
            en: 'Point IDs with configured sparse names, unique nonnegative indices and finite values.',
            zh: '带已配置稀疏名称的点标识，索引须唯一非负且数值有限。'
          }
        }
      },
      summary: t(
        'Configured sparse names with unique nonnegative indices and finite values.',
        '已配置sparse名，唯一非负indices及有限values。'
      )
    },
    IQdrantGroupByRequest: {
      members: {},
      summary: t(
        'Actual native grouping parameters with with_lookup omitted.',
        '真实原生分组参数，移除with_lookup。'
      )
    },
    IQdrantManagementApi: {
      members: {
        deleteByFilter: {
          summary: {
            en: 'Delete matching physical points in this org without an expiry filter or count request.',
            zh: '删除本组织匹配的物理点，不附加期限过滤也不请求计数。'
          },
          params: {
            collection: {
              en: 'Physical native collection name returned by management or assigned at collection creation.',
              zh: '由管理读取返回或创建时指定的物理原生集合名称。'
            },
            where: {
              en: 'Shared logical payload condition; org filtering is always added and expired points are included.',
              zh: '共享逻辑载荷条件，始终追加组织过滤并包含物理过期点。'
            },
            options: {
              en: 'Native wait and optional write ordering; these do not request a count.',
              zh: '原生等待与可选写入顺序配置，不请求删除计数。'
            },
            ctx: {
              en: 'Original optional operation cancellation and timeout budget.',
              zh: '原可选操作取消信号与超时预算。'
            }
          },
          returns: {
            en: 'Native operationId and status; standard deleteWhere remains numeric.',
            zh: '返回原生操作标识与状态，标准条件删除仍返回数字。'
          }
        },
        purgeExpired: {
          summary: {
            en: 'Explicitly delete this org points whose native expiry predates the captured client time.',
            zh: '显式删除本组织期限早于本次捕获客户端时间的物理点。'
          },
          params: {
            collection: {
              en: 'Physical native collection name returned by management or assigned at collection creation.',
              zh: '由管理读取返回或创建时指定的物理原生集合名称。'
            },
            options: {
              en: 'Optional native wait flag; purge never requests count, scroll or write ordering.',
              zh: '可选原生等待标记，清理不请求计数、分页扫描或写入顺序。'
            },
            ctx: {
              en: 'Original optional operation cancellation and timeout budget.',
              zh: '原可选操作取消信号与超时预算。'
            }
          },
          returns: {
            en: 'One native deletion operation record, with no count or scroll.',
            zh: '返回单次原生删除操作记录，不执行计数或分页扫描。'
          }
        }
      },
      summary: t(
        'Native results plus organization-constrained logical filter deletion and expired-point purge.',
        '原生结果及组织内逻辑filter删除、过期点清理。'
      )
    },
    IQdrantErrorCode: {
      summary: {
        en: 'Value union of the package-owned native protocol failure codes.',
        zh: '本包所属原生协议失败错误码的登记值联合。'
      },
      members: {}
    },
    IQdrantHttpHookPayload: {
      summary: {
        en: 'Original HTTP observation metadata without request bodies, API keys or business payloads.',
        zh: '原网络请求观察元数据，不包含请求正文、认证密钥或业务载荷。'
      },
      members: {}
    },
    IQdrantOperation: {
      summary: {
        en: 'Original SDK operation signature with one optional shared operation context appended.',
        zh: '在原客户端操作签名末尾追加单个可选共享操作上下文。'
      },
      members: {}
    },
    IQdrantOperationName: {
      summary: {
        en: 'Closed native operation-name union used by the backend and selected Features.',
        zh: '后端与所选扩展使用的封闭原生操作名称联合。'
      },
      members: {}
    },
    IQdrantHybridBranch: {
      summary: {
        en: 'One named native dense or sparse branch; nested prefetch is rejected.',
        zh: '单个具名原生稠密或稀疏分支，拒绝嵌套预取分支。'
      },
      members: {
        query: {
          summary: {
            en: 'Native vector input for this one dense or sparse branch.',
            zh: '此单个稠密或稀疏分支的原生向量输入。'
          }
        },
        using: {
          summary: {
            en: 'Configured native vector name assigned when creating the collection.',
            zh: '创建集合时指定并已配置的原生向量名称。'
          }
        }
      }
    },
    IQdrantHybridResult: {
      summary: {
        en: 'Actual native SDK query result with engine-owned ranking and scores.',
        zh: '真实原生客户端查询结果，排名与分数归引擎拥有。'
      },
      members: {}
    },
    IQdrantSparseVectorsResult: {
      summary: {
        en: 'Original native sparse update result without client-generated operation evidence.',
        zh: '原生稀疏更新结果，不在客户端生成操作成功证据。'
      },
      members: {}
    },
    IQdrantRecommendRequest: {
      summary: {
        en: 'Native SDK recommendation options retain strategy, samples and lookup semantics.',
        zh: '原生推荐请求保留策略、样本以及查找语义。'
      },
      members: {}
    },
    IQdrantRecommendResult: {
      summary: {
        en: 'Original engine recommendation results; scores are not recomputed in JavaScript.',
        zh: '原引擎推荐结果，不在客户端重新计算相似度分数。'
      },
      members: {}
    },
    IQdrantGroupByResult: {
      summary: {
        en: 'Original native grouped hits preserve multivalue group membership.',
        zh: '原生分组命中结果保留多值分组成员语义。'
      },
      members: {}
    },
    IQdrantHybridOutput: {
      summary: {
        en: 'Feature output exposes root api.qdrantHybrid with empty capabilities, chain and transaction additions.',
        zh: '扩展输出公开根原生方法组，标准能力、查询链与事务附加项均为空。'
      },
      members: {}
    },
    IQdrantRecommendOutput: {
      summary: {
        en: 'Feature output exposes root api.qdrantRecommend with empty capabilities, chain and transaction additions.',
        zh: '扩展输出公开根原生方法组，标准能力、查询链与事务附加项均为空。'
      },
      members: {}
    },
    IQdrantGroupByOutput: {
      summary: {
        en: 'Feature output exposes root api.qdrantGroupBy with empty capabilities, chain and transaction additions.',
        zh: '扩展输出公开根原生方法组，标准能力、查询链与事务附加项均为空。'
      },
      members: {}
    },
    IQdrantManagementOutput: {
      summary: {
        en: 'Feature output exposes root api.qdrantManagement with empty capabilities, chain and transaction additions.',
        zh: '扩展输出公开根原生方法组，标准能力、查询链与事务附加项均为空。'
      },
      members: {}
    },
    IQdrantHybridApi: {
      summary: {
        en: 'Root native hybrid fusion and sparse-only update methods; no interactive transaction projection.',
        zh: '根原生融合与仅稀疏更新方法，不提供交互式事务投影。'
      },
      members: {
        query: {
          summary: {
            en: 'Rank two native dense/sparse branches using RRF fusion.',
            zh: '以原生排序融合对稠密与稀疏双分支排名。'
          },
          params: {
            collection: {
              en: 'Physical native collection name returned by management or assigned at collection creation.',
              zh: '由管理读取返回或创建时指定的物理原生集合名称。'
            },
            request: {
              en: 'Native request retaining the exact SDK option shape documented by this Feature.',
              zh: '保持本扩展所说明的精确客户端选项形状的原生请求。'
            },
            ctx: {
              en: 'Original optional operation cancellation and timeout budget.',
              zh: '原可选操作取消信号与超时预算。'
            }
          },
          returns: {
            en: 'The original native query result.',
            zh: '返回原始原生查询结果。'
          }
        },
        updateSparseVectors: {
          summary: {
            en: 'Update configured sparse vectors without modifying dense vector fields.',
            zh: '更新已配置的稀疏向量，不修改稠密向量字段。'
          },
          params: {
            collection: {
              en: 'Physical native collection name returned by management or assigned at collection creation.',
              zh: '由管理读取返回或创建时指定的物理原生集合名称。'
            },
            request: {
              en: 'Native request retaining the exact SDK option shape documented by this Feature.',
              zh: '保持本扩展所说明的精确客户端选项形状的原生请求。'
            },
            ctx: {
              en: 'Original optional operation cancellation and timeout budget.',
              zh: '原可选操作取消信号与超时预算。'
            }
          },
          returns: {
            en: 'Original native operation evidence.',
            zh: '返回原始原生操作证据。'
          }
        }
      }
    },
    IQdrantRecommendApi: {
      summary: {
        en: 'Root native recommendation keeps best_score and lookup semantics separate from shared recommendation.',
        zh: '根原生推荐保留最佳分数与查找语义，独立于共享推荐方法。'
      },
      members: {
        recommend: {
          summary: {
            en: 'Execute the original engine recommendation request once.',
            zh: '执行一次原始引擎推荐请求并保留原生结果。'
          },
          params: {
            collection: {
              en: 'Physical native collection name returned by management or assigned at collection creation.',
              zh: '由管理读取返回或创建时指定的物理原生集合名称。'
            },
            request: {
              en: 'Native request retaining the exact SDK option shape documented by this Feature.',
              zh: '保持本扩展所说明的精确客户端选项形状的原生请求。'
            },
            ctx: {
              en: 'Original optional operation cancellation and timeout budget.',
              zh: '原可选操作取消信号与超时预算。'
            }
          },
          returns: {
            en: 'Native ranked recommendations without JavaScript rescoring.',
            zh: '返回原生排名推荐，不在客户端重新评分。'
          }
        }
      }
    },
    IQdrantGroupByApi: {
      summary: {
        en: 'Root native groups retain original multivalue membership and exclude unsupported with_lookup.',
        zh: '根原生分组保留原多值成员关系，排除不受支持的查找选项。'
      },
      members: {
        search: {
          summary: {
            en: 'Group native ranked hits with original multivalue membership.',
            zh: '按原多值成员关系对原生排名命中进行分组。'
          },
          params: {
            collection: {
              en: 'Physical native collection name returned by management or assigned at collection creation.',
              zh: '由管理读取返回或创建时指定的物理原生集合名称。'
            },
            request: {
              en: 'Native request retaining the exact SDK option shape documented by this Feature.',
              zh: '保持本扩展所说明的精确客户端选项形状的原生请求。'
            },
            ctx: {
              en: 'Original optional operation cancellation and timeout budget.',
              zh: '原可选操作取消信号与超时预算。'
            }
          },
          returns: {
            en: 'The original native grouped hit result.',
            zh: '返回原始原生分组命中结果。'
          }
        }
      }
    }
  },
  enums: {
    QdrantErrorCode: {
      summary: {
        en: 'Native protocol failures preserve the original SDK or HTTP evidence and never trigger write replay.',
        zh: '原生协议失败保留原客户端或网络证据，不触发写入重放。'
      },
      values: {
        unavailable: {
          en: 'Native network or server failure; a dispatched modification can have an unknown outcome.',
          zh: '原生网络或服务故障，已发送修改的结果可能未知。'
        },
        requestFailed: {
          en: 'Native request was explicitly refused; inspect the original response.',
          zh: '原生请求被明确拒绝，应检查原始响应内容。'
        },
        responseInvalid: {
          en: 'Required native response or persisted envelope cannot be decoded; SDK 202 may already be accepted.',
          zh: '必要响应或持久信封无法解码，客户端异常响应可能已经接受修改。'
        }
      }
    }
  },
  enhancers: {}
}
